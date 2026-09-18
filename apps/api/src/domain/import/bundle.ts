/**
 * Leitura do **bundle de importação** — o que fica entre o ZIP e o domínio (§5, §12.1).
 *
 * ## Onde este ficheiro se situa
 *
 * ```
 *   bytes do ZIP
 *        │  readZip()            ← Fase 2: "este ZIP é legível e seguro?"
 *        ▼
 *   ZipEntry[]
 *        │  indexBundleEntries() ← Fase 2: "este ZIP é um bundle?" (tem manifest.json?)
 *        ▼
 *   { manifest, dataFiles, documentBytes }
 *        │  ★ readBundle()        ← este ficheiro: "o bundle é válido e coerente?"
 *        ▼
 *   BundleReadResult  →  validateRecords()  →  buildPlan()
 * ```
 *
 * Recebe entradas já extraídas e verificadas e produz o manifest validado, os registos
 * canónicos e os avisos. **Não conhece Prisma, não conhece HTTP, não lê a base de dados e
 * não escreve nada.** É a mesma disciplina do resto de `domain/import/`: a única forma de
 * esta lógica ser testável exaustivamente é não depender de uma base de dados para ser
 * exercitada.
 *
 * ## O que este ficheiro garante, e porque é que cada garantia existe
 *
 * As quatro regras vêm da decisão **A26** e não são preferências de implementação — são o
 * que impede que um bundle hostil, ou apenas desalinhado, produza uma importação que o
 * utilizador não autorizou:
 *
 * 1. **Um ficheiro de dados presente mas não declarado no manifest é uma recusa.** (§9.4)
 *    Aceitá-lo obrigaria o Zemlo a importar dados que o próprio bundle não assume, e a
 *    contagem declarada deixaria de significar seja o que for.
 *
 * 2. **Contagens divergentes são um aviso, não uma recusa.** A verdade são as linhas
 *    efectivamente presentes; um contador desactualizado não é corrupção de dados. Recusar
 *    por um resumo desalinhado tornaria o bundle irrecuperável por um detalhe sem
 *    consequência — e a §11.3 exige que o utilizador consiga sempre sair do estado de erro.
 *
 * 3. **Os bytes de documentos são verificados por `sha256`, mas não persistidos.** Não há
 *    camada de armazenamento nesta fase (decisão 2). Verificar é conferir integridade;
 *    persistir seria alargar o âmbito. Os documentos sem bytes mantêm `missingContent`.
 *
 * 4. **Todos os limites são aplicados aos dados efectivamente lidos.** Nunca aos
 *    `counts` declarados no manifest. Um `count` enganador — para menos ou para mais — não
 *    pode contornar um limite nem autorizar trabalho que os dados não justificam. É a mesma
 *    lógica da Fase 2: o declarado serve para recusar cedo, o real serve para decidir.
 */

import { createHash } from 'node:crypto';

import type { ImportIssue, Manifest, ManifestFile } from '@zemlo/shared';
import { BUNDLE_CSV_DIR, BUNDLE_DOCUMENTS_DIR, BUNDLE_README_FILE, zManifest } from '@zemlo/shared';

import { checkCompatibility } from './migrate.js';
import type { ZipEntry } from './zip.js';
import { indexBundleEntries } from './zip.js';

/* ========================================================================== */
/* Limites do bundle (A26: aplicados aos dados lidos, nunca aos declarados)   */
/* ========================================================================== */

/**
 * Limites de leitura do bundle.
 *
 * **Estes valores não vêm da especificação funcional.** A §5 define o formato e a §13.4
 * descreve os casos de segurança do ZIP, mas nenhum documento fixa um teto de registos por
 * ficheiro nem um tamanho máximo por ficheiro de dados. São por isso **limites de segurança
 * e operacionais da implementação**, no mesmo espírito de `maxCompressionRatio` na Fase 2:
 * existem para que o processo não dependa de um bundle de tamanho arbitrário para decidir
 * quanta memória usa.
 *
 * `maxRecords` reutiliza o teto aprovado em A26 — os 10 000 da §7.2 são o limite de
 * *transação*; os 100 000 são o teto absoluto acima do qual a importação é recusada **antes
 * de qualquer alteração na base de dados**.
 */
export const BUNDLE_LIMITS = {
  /** Teto absoluto de registos numa importação inteira (A26). */
  maxRecords: 100_000,

  /** Tamanho máximo de um ficheiro de dados individual (JSONL ou `account.json`). */
  maxDataFileBytes: 64 * 1024 * 1024,

  /**
   * Comprimento máximo de uma linha JSONL, em caracteres.
   *
   * Guarda contra uma única linha de gigabytes que obrigaria a memória do processo a
   * acomodar um registo antes de o conseguir rejeitar. Um registo de veículo real tem
   * algumas centenas de caracteres; 1 MB por linha é folgado por três ordens de grandeza.
   */
  maxLineChars: 1024 * 1024,

  /** Tamanho máximo dos bytes de um documento, quando vêm no bundle. */
  maxDocumentBytes: 64 * 1024 * 1024,
} as const;

export type BundleLimits = typeof BUNDLE_LIMITS;

/**
 * O ficheiro de conta (§5.2).
 *
 * Não é um ficheiro de registos: tem um objecto único com dados de perfil, e por isso é
 * lido à parte dos `*.jsonl`. Tratá-lo como um ficheiro de registos produziria um "registo"
 * de tipo `account` a partir de um objecto que não é um registo de domínio.
 */
const ACCOUNT_FILE = 'account.json';

/* ========================================================================== */
/* Motivos de recusa                                                          */
/* ========================================================================== */

/**
 * Porque é que um bundle foi recusado.
 *
 * Códigos estáveis e legíveis por máquina, como em `zip.ts` e em `ImportIssue`: um motivo
 * genérico ("bundle inválido") não permite ao utilizador corrigir o que está mal nem a nós
 * diagnosticar. Nenhum é produzido por defeito sem ser testado.
 */
export const BUNDLE_REFUSAL_REASONS = [
  /** O `manifest.json` não é JSON válido. */
  'bundle.manifest_malformed',
  /** O `manifest.json` é JSON mas não satisfaz o contrato `zManifest`. */
  'bundle.manifest_invalid',
  /** `format` desconhecido — não é um bundle do Zemlo (§12.1). */
  'bundle.format_unknown',
  /** `formatVersion` superior à suportada (§12.1). */
  'bundle.version_too_new',
  /** `formatVersion` inferior ao mínimo suportado (§12.1). */
  'bundle.version_too_old',
  /** Existe um ficheiro de dados na raiz que o manifest não declara (A26). */
  'bundle.undeclared_file',
  /** Um ficheiro de dados declarado no manifest não existe no ZIP. */
  'bundle.missing_file',
  /** O `sha256` de um ficheiro não coincide com o declarado (§5.5 integridade). */
  'bundle.checksum_mismatch',
  /** Ficheiro de dados acima do limite de bytes. */
  'bundle.file_too_large',
  /** Linha JSONL acima do limite de comprimento. */
  'bundle.line_too_long',
  /** Ficheiro de dados acima do teto absoluto de registos (A26). */
  'bundle.too_many_records',
  /** Uma linha do JSONL não é JSON válido. */
  'bundle.line_malformed',
  /** Uma linha do JSONL não é um objecto JSON. */
  'bundle.line_not_an_object',
  /** O manifest declara um ficheiro de dados com um nome que não pertence ao contrato. */
  'bundle.unknown_data_file',
  /** Caminho de documento que não segue `documents/<localId>/<nome>` (§5.2). */
  'bundle.document_path_invalid',
  /** Os bytes de um documento excedem o limite. */
  'bundle.document_too_large',
] as const;

export type BundleRefusalReason = (typeof BUNDLE_REFUSAL_REASONS)[number];

/** Uma recusa, com o motivo estável e a mensagem para o utilizador. */
export interface BundleRefusal {
  readonly reason: BundleRefusalReason;
  /** Mensagem para o utilizador. Nunca contém o conteúdo do bundle (§11.3). */
  readonly message: string;
  /** Ficheiro em causa, quando o motivo é específico de um ficheiro. */
  readonly file?: string;
  /** Linha em causa, quando o motivo é específico de uma linha. */
  readonly line?: number;
}

/**
 * Erro lançado quando o bundle é recusado.
 *
 * Mesma razão de ser que `ZipRefusalError`: a §7.3 exige que um manifest malformado seja
 * "um erro de validação, não uma exceção não tratada". Quem chama apanha este erro e
 * converte-o numa resposta ao utilizador, em vez de deixar subir um `SyntaxError` do
 * `JSON.parse` com uma mensagem de biblioteca.
 */
export class BundleRefusalError extends Error {
  readonly refusal: BundleRefusal;

  constructor(refusal: BundleRefusal) {
    super(`${refusal.reason}: ${refusal.message}`);
    this.name = 'BundleRefusalError';
    this.refusal = refusal;
  }
}

/* ========================================================================== */
/* Resultado da leitura                                                       */
/* ========================================================================== */

/**
 * Uma linha crua do bundle, antes de se tornar num registo canónico.
 *
 * `fields` é o objecto JSON tal como veio. O leitor **não** interpreta os campos: traduzir
 * `Expense.amountCents` para o campo `amountCents` do registo canónico é trabalho do
 * Normalizer, não do leitor. Um leitor que conhecesse os campos de cada tipo seria uma
 * segunda fonte de verdade para o formato, e as duas divergiriam.
 */
export interface RawBundleRecord {
  /** Tipo do registo, derivado do ficheiro de origem. */
  readonly kind: string;
  /** Ficheiro de onde veio (`expenses.jsonl`, …). Para o relatório e para os avisos. */
  readonly file: string;
  /** Número da linha no ficheiro, 1-based. Para o utilizador poder ir ver. */
  readonly line: number;
  /** O objecto JSON, sem interpretação. */
  readonly fields: Readonly<Record<string, unknown>>;
}

/**
 * Os bytes de um documento, verificados mas **não** persistidos (A26, decisão 2).
 *
 * Existe para que o relatório possa declarar quantos bytes foram verificados e descartados
 * — a limitação não pode ficar escondida (§11.3). O `sha256` de cada um já foi conferido
 * contra o manifest quando este o declara.
 */
export interface DocumentBytes {
  /** Caminho no bundle: `documents/<localId>/<nome>`. */
  readonly path: string;
  /** `localId` extraído do caminho. É a chave para ligar aos metadados. */
  readonly localId: string;
  /** Nome original do ficheiro, tal como consta no caminho. */
  readonly fileName: string;
  readonly bytes: number;
  /** `sha256` calculado sobre os bytes **reais**, não sobre o declarado. */
  readonly sha256: string;
}

/**
 * O conteúdo de `account.json`, ainda sem interpretação.
 *
 * Só os dados de perfil são considerados. Credenciais, sessões e tokens **nunca** entram
 * (§6.2 / decisão 5), e o leitor não tem sequer um campo para os transportar: um campo que
 * não existe não pode ser preenchido por engano.
 */
export type RawAccountData = Readonly<Record<string, unknown>>;

/** Resultado de uma leitura bem-sucedida do bundle. */
export interface BundleReadResult {
  /** Manifest validado pelo contrato `zManifest`. */
  readonly manifest: Manifest;
  /** `bundleId` do manifest, promovido por conveniência (é a chave da idempotência). */
  readonly bundleId: string;
  /** A versão de formato efectiva — igual à do manifest, validada. */
  readonly formatVersion: number;
  /** Registos de todos os ficheiros, por ordem de ficheiro e de linha. */
  readonly records: readonly RawBundleRecord[];
  /** Dados de conta, se `account.json` vier no bundle. */
  readonly account: RawAccountData | null;
  /** Bytes de documentos verificados e não persistidos. */
  readonly documentBytes: readonly DocumentBytes[];
  /**
   * Avisos não bloqueantes. Ao contrário das recusas, não impedem a importação.
   *
   * É por aqui que a divergência de `counts` chega ao utilizador (A26): informada, não
   * imposta.
   */
  readonly issues: readonly ImportIssue[];
  /** Ficheiros de dados efectivamente lidos, com as contagens reais. */
  readonly files: readonly {
    readonly path: string;
    readonly records: number;
    readonly bytes: number;
  }[];
}

/** O manifest validado, derivado do contrato partilhado para não duplicar a forma. */
export type { Manifest };

/** Opções de leitura. Os limites são sobreponíveis para os testes exercitarem fronteiras. */
export interface BundleReadOptions {
  readonly limits?: Partial<BundleLimits>;
}

/* ========================================================================== */
/* Superfície pública                                                         */
/* ========================================================================== */

/**
 * Lê e valida um bundle a partir das entradas de um ZIP já verificado.
 *
 * Pré-condição: `entries` vem de `readZip()`, pelo que os caminhos já foram validados
 * contra zip-slip, os tamanhos já respeitam `ZIP_LIMITS` e os CRCs já foram conferidos.
 * Este ficheiro **não repete** essas verificações — repeti-las seria uma segunda
 * implementação da mesma regra, e a primeira divergência entre as duas seria uma brecha.
 *
 * Lança `BundleRefusalError` com um motivo de `BUNDLE_REFUSAL_REASONS` quando o bundle não
 * pode ser importado. Devolve `BundleReadResult` quando pode, mesmo que com avisos.
 */
export function readBundle(
  entries: readonly ZipEntry[],
  options?: BundleReadOptions,
): BundleReadResult {
  const limits = resolveBundleLimits(options?.limits);
  const index = indexBundleEntries(entries);

  // 1. Manifest: JSON válido e contrato satisfeito. Vem primeiro porque tudo o resto
  //    depende do que ele declara — sem manifest válido não há lista de ficheiros a
  //    confrontar, e um ficheiro "não declarado" seria uma afirmação sem referência.
  //    A compatibilidade de formato e versão é verificada dentro de `parseManifest`,
  //    deliberadamente antes do contrato completo — ver a nota nessa função.
  const manifest = parseManifest(index.manifest);

  // 2. Ficheiros declarados vs presentes. A ordem importa: recusar um ficheiro não
  //    declarado antes de ler qualquer linha garante que nenhum dado de um bundle
  //    inconsistente chega a ser interpretado.
  const declared = checkDeclaredFiles(manifest, index.dataFiles);

  const issues: ImportIssue[] = [];
  const records: RawBundleRecord[] = [];

  // 4. Leitura dos ficheiros de dados, pela ordem do manifest — determinística. O
  //    `account.json` fica de fora: não é um registo a importar, é lido à parte no passo 6.
  for (const declaredFile of declared) {
    if (declaredFile.path === ACCOUNT_FILE) continue;

    const entry = index.dataFiles.find((item) => item.name === declaredFile.path);

    // Um ficheiro declarado sem entrada correspondente já foi recusado no passo 3; aqui
    // só pode faltar por incoerência interna, o que não deve acontecer.
    if (!entry) continue;

    records.push(...readDataFile(entry, limits));

    // 5. Teto absoluto de registos, verificado sobre os registos **reais** (A26): um
    //    `count` declarado a mentir não pode autorizar mais trabalho do que os dados
    //    justificam. A verificação é incremental para não ler 200 000 linhas antes de
    //    recusar as primeiras 100 001.
    if (records.length > limits.maxRecords) {
      throw refuse(
        'bundle.too_many_records',
        `Este ficheiro tem mais de ${limits.maxRecords} registos. Divide-o em partes mais pequenas e importa uma de cada vez.`,
        entry.name,
      );
    }
  }

  // 6. `account.json` — dados de perfil, lidos à parte por não ser um registo.
  const account = readAccountFile(index.dataFiles, limits);

  // 7. Documentos: bytes lidos, `sha256` conferido, **nada persistido** (A26, decisão 2).
  const documentBytes = readDocumentBytes(index.documentBytes, limits);

  // 8. Contagens declaradas vs reais. Divergência é **aviso**, nunca recusa (A26).
  collectCountMismatches(manifest, records, issues);

  return {
    manifest,
    bundleId: manifest.bundleId,
    formatVersion: manifest.formatVersion,
    records,
    account,
    documentBytes,
    issues,
    files: declared
      // O `account.json` não é um ficheiro de registos e não entra no resumo por ficheiro.
      .filter((file) => file.path !== ACCOUNT_FILE)
      .map((file) => {
        const matching = index.dataFiles.find((item) => item.name === file.path);
        const count = records.filter((record) => record.file === file.path).length;
        return { path: file.path, records: count, bytes: matching?.uncompressedBytes ?? 0 };
      }),
  };
}

/**
 * Verifica um ficheiro de dados contra o `sha256` declarado no manifest.
 *
 * Função separada porque é uma verificação de integridade isolável: a §5.5 exige que o
 * bundle cubra **todos** os ficheiros, e um teste directo sobre `sha256` é mais claro do
 * que um que precise de construir um bundle inteiro para o exercitar.
 */
export function verifyFileChecksum(data: Uint8Array, declaredSha256: string): boolean {
  const actual = sha256Hex(data);
  // Comparação insensível à caixa: um digest em maiúsculas é o mesmo digest. O que não se
  // aceita é um digest diferente — a caixa é formatação, o valor é integridade.
  return actual === declaredSha256.toLowerCase();
}

/**
 * Calcula o `sha256` de bytes, em hexadecimal minúsculo.
 *
 * Exportado para os testes poderem construir bundles com hashes corretos sem duplicarem a
 * função — e para que um teste e a implementação não possam divergir no formato do digest.
 */
export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** A implementação ainda não existe. Ver `ZipNotImplementedError` para a razão de ser. */
export class BundleNotImplementedError extends Error {
  readonly operation: string;

  constructor(operation: string) {
    super(`Leitor de bundle ainda não implementado: ${operation}`);
    this.name = 'BundleNotImplementedError';
    this.operation = operation;
  }
}

/* ========================================================================== */
/* Implementação — internos                                                   */
/* ========================================================================== */

/** Constrói uma recusa. */
function refuse(
  reason: BundleRefusalReason,
  message: string,
  file?: string,
  line?: number,
): BundleRefusalError {
  return new BundleRefusalError({
    reason,
    message,
    ...(file !== undefined ? { file } : {}),
    ...(line !== undefined ? { line } : {}),
  });
}

/**
 * Resolve os limites efectivos, permitindo **apertar, nunca afrouxar**.
 *
 * Mesma disciplina de `resolveLimits` no leitor de ZIP: um pedido que eleve um limite
 * acima do contrato é recusado em vez de obedecido. Sem isto, um único
 * `{ limits: { maxRecords: Infinity } }` desligaria o teto que a A26 aprovou, e a defesa
 * passaria a depender de quem chama — que é o sítio errado para ela viver.
 */
function resolveBundleLimits(overrides?: Partial<BundleLimits>): BundleLimits {
  if (!overrides) return BUNDLE_LIMITS;

  const resolved: Record<string, number> = { ...BUNDLE_LIMITS };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    const base = (BUNDLE_LIMITS as Record<string, number>)[key];
    if (base === undefined) continue;

    if (!Number.isInteger(value) || value <= 0) {
      throw refuse(
        'bundle.manifest_invalid',
        'Os limites de leitura têm de ser inteiros positivos.',
      );
    }

    if (value > base) {
      throw refuse(
        'bundle.manifest_invalid',
        'Os limites de leitura podem ser apertados, nunca afrouxados.',
      );
    }

    resolved[key] = value;
  }

  return resolved as unknown as BundleLimits;
}

/**
 * Lê o `manifest.json`, com diagnóstico distinguindo malformado, incompatível e inválido.
 *
 * ## Porque é que a compatibilidade vem ANTES do contrato completo
 *
 * A ordem não é arbitrária e foi um teste que a fixou. O `zManifest` é estrito quanto a
 * `format` (`z.literal('zemlo-export')`) e quanto a `formatVersion` (`>= 1`). Se
 * validássemos primeiro o contrato, **todos** os casos que a §12.1 manda diagnosticar com
 * precisão cairiam no mesmo balde:
 *
 * ```
 *   manifest com formatVersion 99  →  "o manifest não tem a estrutura esperada"
 *   manifest com formatVersion 0   →  "o manifest não tem a estrutura esperada"
 *   manifest com format 'outra'    →  "o manifest não tem a estrutura esperada"
 * ```
 *
 * Três situações radicalmente diferentes — "atualiza a aplicação", "este ficheiro é
 * demasiado antigo", "escolheste o ficheiro errado" — a receber a mesma mensagem inútil.
 * A §11.3 proíbe exatamente isto: *"zero conceitos técnicos"* mas também *"o utilizador
 * tem sempre de saber o que fazer a seguir"*.
 *
 * Por isso a extração dos dois campos de compatibilidade é feita de forma tolerante
 * primeiro, o veredicto é emitido com a mensagem específica, e só depois se valida o
 * contrato completo. Um manifest genuinamente incompleto continua a ser `manifest_invalid`
 * — que é o diagnóstico certo para ele.
 */
function parseManifest(entry: ZipEntry): Manifest {
  const text = utf8Decode(entry.data);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A §7.3 é explícita: um manifest malformado é "um erro de validação, não uma exceção
    // não tratada". Este é o ponto onde essa exigência se cumpre.
    throw refuse(
      'bundle.manifest_malformed',
      'O ficheiro manifest.json não é JSON válido. O ficheiro pode estar corrompido.',
      entry.name,
    );
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw refuse(
      'bundle.manifest_invalid',
      'O manifest.json não tem a estrutura esperada de um bundle do Zemlo.',
      entry.name,
    );
  }

  // 1. Compatibilidade primeiro, com tolerância quanto ao resto do contrato: é o que
  //    permite à mensagem ser específica em vez de genérica.
  const raw = parsed as Record<string, unknown>;
  checkRawCompatibility(raw);

  // 2. Só agora o contrato completo. Chegando aqui, `format` e `formatVersion` já são
  //    compatíveis, pelo que uma falha de zod é mesmo um manifest mal formado.
  const result = zManifest.safeParse(parsed);
  if (!result.success) {
    throw refuse(
      'bundle.manifest_invalid',
      'O manifest.json não tem a estrutura esperada de um bundle do Zemlo.',
      entry.name,
    );
  }

  return result.data;
}

/**
 * Emite o veredicto de compatibilidade a partir dos campos crus do manifest.
 *
 * Delega em `checkCompatibility` (migrate.ts) para não duplicar a regra da §12.1: aquele
 * ficheiro é a única autoridade sobre o que é "demasiado novo", "demasiado antigo" e
 * "formato errado". Aqui só se extraem os dois campos e se traduz o veredicto numa recusa.
 */
function checkRawCompatibility(raw: Record<string, unknown>): void {
  // Campos ausentes ou de tipo inesperado não são assunto desta verificação: um manifest
  // sem `formatVersion` é um manifest inválido, e dizê-lo com precisão é trabalho do zod.
  if (typeof raw['format'] !== 'string') return;
  if (typeof raw['formatVersion'] !== 'number' || !Number.isInteger(raw['formatVersion'])) {
    return;
  }

  switchCompatibility(raw['format'], raw['formatVersion']);
}

/** Traduz um veredicto de compatibilidade numa recusa, ou não faz nada se for aceitável. */
function switchCompatibility(format: string, formatVersion: number): void {
  const verdict = checkCompatibility({ format, formatVersion });

  switch (verdict.kind) {
    case 'current':
    case 'migrate':
      // `migrate` é aceite aqui: a migração é aplicada depois, sobre registos já lidos.
      // Recusar no leitor impediria uma versão antiga legítima de entrar.
      return;
    case 'wrong-format':
      throw refuse(
        'bundle.format_unknown',
        'Este ficheiro não é uma exportação do Zemlo. Verifica se escolheste o ficheiro certo.',
      );
    case 'too-new':
      throw refuse(
        'bundle.version_too_new',
        `Este ficheiro foi criado por uma versão mais recente do Zemlo (versão ${verdict.bundleVersion}; esta versão lê até à ${verdict.supported}). Atualiza a aplicação para o importar.`,
      );
    case 'too-old':
      throw refuse(
        'bundle.version_too_old',
        `Este ficheiro é demasiado antigo para ser importado (versão ${verdict.bundleVersion}; o mínimo é ${verdict.minimum}).`,
      );
    case 'malformed':
      throw refuse(
        'bundle.manifest_invalid',
        'O manifest.json não declara uma versão de formato válida.',
      );
  }
}

/**
 * Confronta o que o manifest declara com o que o ZIP contém.
 *
 * Três verificações, todas recusas antes de se ler um único registo:
 *
 *  - um ficheiro declarado que não existe no ZIP — o bundle está incompleto;
 *  - um ficheiro presente que o manifest não declara — o bundle não assume os seus
 *    próprios dados (A26, regra 1);
 *  - um ficheiro cujo `sha256` não corresponde ao declarado — o conteúdo foi alterado
 *    depois de o bundle ser criado (§5.5).
 *
 * A integridade é verificada aqui, e não mais tarde, pela mesma razão que os limites do ZIP
 * são verificados antes de descomprimir: um bundle cujo conteúdo não corresponde ao que o
 * manifest promete não deve chegar a ser interpretado. Verificar depois de ler seria
 * confiar em dados que já sabemos estar alterados.
 *
 * O `README.txt` e a pasta `csv/` são explicitamente ignorados: fazem parte do contrato do
 * artefacto (§5.2) e não são dados a importar. Tratá-los como "não declarados" tornaria
 * qualquer bundle real impossível de importar.
 */
function checkDeclaredFiles(
  manifest: Manifest,
  dataFiles: readonly ZipEntry[],
): readonly ManifestFile[] {
  const declaredPaths = new Set(manifest.files.map((file) => file.path));
  const presentPaths = new Set(dataFiles.map((entry) => entry.name));

  // 1. Declarado mas ausente.
  for (const file of manifest.files) {
    if (!presentPaths.has(file.path)) {
      throw refuse(
        'bundle.missing_file',
        `O ficheiro ${file.path} faz falta neste bundle. Volta a exportar e tenta de novo.`,
        file.path,
      );
    }
  }

  // 2. Presente mas não declarado. O `README.txt` e a pasta `csv/` são parte do artefacto
  //    (§5.2) e não entram nesta verificação.
  for (const entry of dataFiles) {
    if (isNonDataArtifact(entry.name)) continue;
    if (!declaredPaths.has(entry.name)) {
      throw refuse(
        'bundle.undeclared_file',
        `O bundle tem um ficheiro (${entry.name}) que o manifest não declara. Por segurança, nada foi importado.`,
        entry.name,
      );
    }
  }

  // 3. Integridade: o `sha256` de cada ficheiro tem de corresponder ao declarado. Um
  //    `sha256` em falta no manifest não é verificado aqui — o contrato (`zManifest`) já
  //    exige o campo, e um manifest sem ele foi recusado como inválido.
  for (const file of manifest.files) {
    const entry = dataFiles.find((item) => item.name === file.path);
    if (!entry) continue;

    if (!verifyFileChecksum(entry.data, file.sha256)) {
      throw refuse(
        'bundle.checksum_mismatch',
        `O conteúdo de ${file.path} não corresponde ao que o bundle declara. O ficheiro pode ter sido alterado desde que foi exportado.`,
        file.path,
      );
    }
  }

  // Devolve os ficheiros declarados por ordem do manifest, para a leitura ser determinística.
  return manifest.files;
}

/** `true` para o que faz parte do artefacto mas não é dado a importar (§5.2). */
function isNonDataArtifact(name: string): boolean {
  if (name === BUNDLE_README_FILE) return true;
  if (name === BUNDLE_CSV_DIR || name.startsWith(`${BUNDLE_CSV_DIR}/`)) return true;
  return false;
}

/**
 * Lê um ficheiro de dados (JSONL) e devolve os registos crus.
 *
 * Os limites são aplicados sobre os **bytes e linhas reais**, nunca sobre o que o manifest
 * declara (A26). É por isso que o tamanho é medido em `entry.uncompressedBytes` — o que o
 * ZIP efectivamente continha — e não em `manifest.files[].bytes`.
 */
function readDataFile(entry: ZipEntry, limits: BundleLimits): RawBundleRecord[] {
  if (entry.uncompressedBytes > limits.maxDataFileBytes) {
    throw refuse(
      'bundle.file_too_large',
      `O ficheiro ${entry.name} é demasiado grande para importar de uma vez.`,
      entry.name,
    );
  }

  const text = utf8Decode(entry.data);
  const kind = kindFromFileName(entry.name);
  const records: RawBundleRecord[] = [];

  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lineNumber = index + 1;

    // Linha vazia — incluindo o `\n` final de um JSONL bem-formado — é ignorada. Recusá-la
    // tornaria o bundle irrecuperável por causa de uma tecla Enter a mais.
    if (line.trim() === '') continue;

    if (line.length > limits.maxLineChars) {
      throw refuse(
        'bundle.line_too_long',
        `A linha ${lineNumber} de ${entry.name} é demasiado longa para ser lida.`,
        entry.name,
        lineNumber,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw refuse(
        'bundle.line_malformed',
        `A linha ${lineNumber} de ${entry.name} não é JSON válido. O ficheiro pode estar corrompido.`,
        entry.name,
        lineNumber,
      );
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw refuse(
        'bundle.line_not_an_object',
        `A linha ${lineNumber} de ${entry.name} não é um registo válido.`,
        entry.name,
        lineNumber,
      );
    }

    records.push({
      kind,
      file: entry.name,
      line: lineNumber,
      // Os campos são copiados **sem interpretação**: traduzir campos é trabalho do
      // Normalizer, e um leitor que conhecesse os campos de cada tipo seria uma segunda
      // fonte de verdade para o formato.
      fields: parsed as Readonly<Record<string, unknown>>,
    });
  }

  return records;
}

/** `vehicles.jsonl` → `vehicle`. O singular é o `kind` usado em todo o domínio. */
function kindFromFileName(fileName: string): string {
  const base = fileName.replace(/\.jsonl$/, '');
  return SINGULAR[base] ?? base;
}

/** Plural do ficheiro → singular do tipo de registo (§5.2). */
const SINGULAR: Readonly<Record<string, string>> = {
  vehicles: 'vehicle',
  odometer: 'odometer',
  expenses: 'expense',
  fuel: 'fuel',
  charging: 'charging',
  maintenance: 'maintenance',
  insurance: 'insurance',
  inspections: 'inspection',
  taxes: 'tax',
  reminders: 'reminder',
  events: 'event',
  documents: 'document',
  suggestions: 'suggestion',
  notifications: 'notification',
  audit: 'audit',
};

/**
 * Lê `account.json`, se existir.
 *
 * Só dados de perfil. Credenciais, sessões e tokens **nunca** entram (§6.2 / decisão 5), e
 * este leitor não tem sequer um campo para os transportar: um campo que não existe não
 * pode ser preenchido por engano.
 */
function readAccountFile(
  dataFiles: readonly ZipEntry[],
  limits: BundleLimits,
): RawAccountData | null {
  const entry = dataFiles.find((item) => item.name === 'account.json');
  if (!entry) return null;

  if (entry.uncompressedBytes > limits.maxDataFileBytes) {
    throw refuse(
      'bundle.file_too_large',
      'O ficheiro account.json é demasiado grande para importar de uma vez.',
      entry.name,
    );
  }

  const text = utf8Decode(entry.data);
  if (text.trim() === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw refuse(
      'bundle.line_malformed',
      'O ficheiro account.json não é JSON válido.',
      entry.name,
    );
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw refuse(
      'bundle.line_not_an_object',
      'O ficheiro account.json não tem a estrutura esperada.',
      entry.name,
    );
  }

  return parsed as RawAccountData;
}

/**
 * Lê os bytes dos documentos, **verificando mas não persistindo** (A26, regra 4).
 *
 * Não há camada de armazenamento nesta fase (decisão 2). Estes bytes existem para que o
 * relatório possa declarar quantos foram verificados e descartados — a limitação não pode
 * ficar escondida (§11.3). Persistir seria alargar o âmbito, não cumpri-lo.
 *
 * Um caminho que não siga `documents/<localId>/<nome>` é recusado: o `localId` é a única
 * ligação entre os bytes e os metadados do documento, e sem ele os bytes são inúteis.
 */
function readDocumentBytes(
  documentEntries: readonly ZipEntry[],
  limits: BundleLimits,
): DocumentBytes[] {
  const documentPrefix = `${BUNDLE_DOCUMENTS_DIR}/`;
  const result: DocumentBytes[] = [];

  for (const entry of documentEntries) {
    // `documents/` já foi verificado pelo índice do ZIP (Fase 2); aqui valida-se a
    // **estrutura interna** que o índice não conhece: `<localId>/<nome>`.
    const rest = entry.name.slice(documentPrefix.length);
    const separator = rest.indexOf('/');

    if (separator <= 0 || separator === rest.length - 1) {
      throw refuse(
        'bundle.document_path_invalid',
        `O ficheiro de documento (${entry.name}) não está na pasta do documento a que pertence.`,
        entry.name,
      );
    }

    if (entry.uncompressedBytes > limits.maxDocumentBytes) {
      throw refuse(
        'bundle.document_too_large',
        `O ficheiro de documento (${entry.name}) é demasiado grande para ser lido.`,
        entry.name,
      );
    }

    result.push({
      path: entry.name,
      localId: rest.slice(0, separator),
      fileName: rest.slice(separator + 1),
      bytes: entry.uncompressedBytes,
      // Digest sobre os bytes REAIS. É verificação de integridade, não persistência.
      sha256: sha256Hex(entry.data),
    });
  }

  return result;
}

/**
 * Compara as contagens declaradas com as reais e produz avisos (A26, regra 3).
 *
 * Nunca recusa. A verdade são as linhas; um contador desactualizado não é corrupção de
 * dados, e recusar por um resumo desalinhado tornaria o bundle irrecuperável por um
 * detalhe sem consequência — contra a §11.3, que exige que o utilizador consiga sempre
 * sair do estado de erro.
 *
 * ## A chave é o nome do ficheiro, não o tipo de registo pluralizado
 *
 * O `counts` do manifest é indexado pelo **nome do ficheiro sem `.jsonl`** — o contrato
 * (§5.2) mostra `"fuel": 18` para `fuel.jsonl`, e não `"fuels"`. Contar por `${kind}s`
 * parecia equivalente porque coincide em `vehicle`→`vehicles` e `document`→`documents`,
 * mas diverge em `fuel` e em qualquer tipo cujo ficheiro não siga esse padrão — e a
 * divergência aparece **ao contrário**: um bundle perfeitamente coerente passa a
 * produzir um aviso a dizer que as contagens não batem.
 *
 * Contar pelo `file` que o próprio registo traz elimina a inferência: o nome do ficheiro
 * está no registo, o `counts` é indexado por esse nome, e não há nada a adivinhar.
 */
function collectCountMismatches(
  manifest: Manifest,
  records: readonly RawBundleRecord[],
  issues: ImportIssue[],
): void {
  const actual = new Map<string, number>();
  for (const record of records) {
    const key = record.file.replace(/^.*\//, '').replace(/\.jsonl$/, '');
    actual.set(key, (actual.get(key) ?? 0) + 1);
  }

  for (const [file, declared] of Object.entries(manifest.counts)) {
    if (typeof declared !== 'number') continue;
    const count = actual.get(file) ?? 0;
    if (count === declared) continue;

    issues.push({
      severity: 'info',
      code: 'bundle.count_mismatch',
      message: `O manifest declara ${declared} registo(s) em ${file}.jsonl, mas o ficheiro tem ${count}. Importamos os ${count} que existem.`,
      field: file,
    });
  }
}

/** Descodifica UTF-8. Função local para não depender de um utilitário externo. */
function utf8Decode(data: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(data);
}
