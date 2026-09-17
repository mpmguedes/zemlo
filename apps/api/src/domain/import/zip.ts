/**
 * Leitura de ZIP do bundle de importação — **contrato** (§7.3, §13.4).
 *
 * ## Estado deste ficheiro
 *
 * Este ficheiro define **apenas o contrato**: os limites, os motivos de recusa, os tipos
 * e as assinaturas. **Não há implementação.** Todas as funções lançam
 * `ZipNotImplementedError`.
 *
 * A ordem é deliberada. O ZIP é a única entrada do importador que vem de fora e que o
 * Zemlo interpreta *como estrutura* — offsets, tamanhos, uma tabela de índice. O histórico
 * de vulnerabilidades em torno de arquivos é longo e quase todo vem de leitores que
 * confiaram no que o ficheiro dizia sobre si próprio. Escrever primeiro os testes que
 * definem o que é recusado torna esse contrato verificável antes de existir código capaz
 * de o violar em silêncio.
 *
 * ## Porque é que esta interface existe
 *
 * Os testes adversariais em `test/import-zip-reader.test.ts` precisam de um nome para
 * aquilo que testam. Sem uma interface, ou os testes importariam caminhos inexistentes
 * (falhando por erro de *import*, que não é o mesmo que falhar por implementação ausente),
 * ou seriam escritos contra o detalhe interno da implementação futura — e nesse caso
 * testariam a implementação, não o contrato.
 *
 * ## O que este módulo não faz
 *
 * Não extrai para o sistema de ficheiros. Não escreve nada. Não abre descritores. Devolve
 * entradas em memória e a decisão de as usar é de quem chama. A §7.3 é explícita: os nomes
 * **nunca** são usados diretamente no sistema de ficheiros — o conteúdo é guardado com uma
 * chave própria. Um leitor que nunca escreve não pode escrever fora da raiz.
 */

import zlib from 'node:zlib';

import { BUNDLE_DOCUMENTS_DIR, BUNDLE_MANIFEST_FILE } from '@zemlo/shared';

/* ========================================================================== */
/* Limites (§7.3 "Bomba de descompressão" e "Limites")                        */
/* ========================================================================== */

/**
 * Limites do leitor de ZIP.
 *
 * Centralizados aqui pela mesma razão que os limiares de qualidade estão centralizados no
 * validador: um limite repetido em cinco sítios diverge em três. Os testes importam estas
 * constantes em vez de escreverem números próprios, para que alterar um limite não deixe
 * testes a verificar um valor que já não é o contrato.
 *
 * Todos os valores são **iniciais** — a §7.2 estabelece o princípio para o limite de
 * registos ("é configurável, 10 000 é o valor inicial") e a mesma lógica aplica-se aqui.
 */
export const ZIP_LIMITS = {
  /**
   * Número máximo de entradas.
   *
   * §13.4 exige que um ZIP com 10 000 entradas seja recusado, e §7.2 fixa o mesmo número
   * como valor inicial para o limite de registos ("o limite é configurável, 10 000 é o
   * valor inicial"). O valor aqui é o mesmo de propósito: um bundle que caiba no limite de
   * registos não deve ser recusado por causa do número de ficheiros que os transporta.
   *
   * O limite é verificado **antes** de extrair (§7.3), não durante: um ZIP com um milhão de
   * entradas não pode obrigar o Zemlo a alocar um milhão de descritores primeiro e a
   * recusar depois.
   */
  maxEntries: 10_000,

  /** Tamanho máximo do ficheiro comprimido, em bytes. */
  maxCompressedBytes: 64 * 1024 * 1024,

  /**
   * Tamanho máximo do **total descomprimido**, em bytes.
   *
   * §7.3 é explícito quanto ao que se mede: "limite de bytes **descomprimidos**, não apenas
   * comprimidos". Um ZIP de 1 MB pode descomprimir para 10 GB (§13.4) e é este limite — não
   * o comprimido — que o trava.
   */
  maxUncompressedBytes: 256 * 1024 * 1024,

  /** Tamanho máximo de uma entrada individual, em bytes. */
  maxEntryBytes: 64 * 1024 * 1024,

  /**
   * Rácio máximo de compressão admitido (`tamanho descomprimido / comprimido`).
   *
   * **Este valor não vem da especificação funcional.** A §7.3 exige que haja um limite de
   * rácio de compressão e um limite de bytes descomprimidos, mas não fixa números para
   * nenhum dos dois; a §13.4 só descreve o caso (um ZIP de 1 MB que descomprime para 10 GB).
   * `maxCompressionRatio` é, por isso, um **limite de segurança da implementação**: existe
   * para que o Zemlo não gaste memória e CPU a descomprimir um fluxo cuja razão de
   * expansão já o denuncia, e é verificável **sem** descomprimir nada.
   *
   * 200:1 é folgado para o que o Zemlo produz — JSONL e CSV de dados reais ficam tipicamente
   * entre 3:1 e 15:1, e um PDF (já comprimido) perto de 1:1 — e ainda assim ordens de
   * magnitude abaixo de uma *decompression bomb* (zeros comprimem acima de 1000:1). Se um
   * bundle legítimo de algum utilizador esbarrar aqui, o valor muda-se numa linha; o que não
   * se faz é aceitar um fluxo por o `inflate` conseguir lidar com ele.
   */
  maxCompressionRatio: 200,

  /**
   * Comprimento máximo de um nome de entrada, em bytes.
   *
   * O nome não é usado no sistema de ficheiros (§7.3), mas é guardado, comparado e
   * eventualmente apresentado. Um limite explícito evita que um nome hostil ocupe memória
   * ou cabeçalhos sem limite.
   */
  maxEntryNameBytes: 512,
} as const;

export type ZipLimits = typeof ZIP_LIMITS;

/* ========================================================================== */
/* Motivos de recusa                                                          */
/* ========================================================================== */

/**
 * Porque é que um ZIP foi recusado.
 *
 * Códigos estáveis e legíveis por máquina, no mesmo espírito dos códigos de
 * `ImportIssue` (§9.1): um motivo genérico ("ZIP inválido") não permite ao utilizador
 * corrigir nada nem a nós distinguir um ataque de um ficheiro truncado na transferência.
 *
 * A distinção entre `malformed` e `truncated` é intencional. São diagnósticos diferentes:
 * um ficheiro truncado é quase sempre um download interrompido e a mensagem deve sugerir
 * repetir a transferência; um ficheiro malformado na assinatura é outra coisa.
 */
export const ZIP_REFUSAL_REASONS = [
  /** Não começa pela assinatura `PK\x03\x04` / `PK\x05\x06`. */
  'zip.invalid_signature',
  /** Ficheiro mais curto do que o mínimo estrutural. */
  'zip.truncated',
  /** End of Central Directory ausente ou impossível de localizar. */
  'zip.missing_central_directory',
  /** Central directory declarada mas inconsistente com o próprio ficheiro. */
  'zip.invalid_central_directory',
  /** Cabeçalho local de uma entrada inválido ou inconsistente com o índice. */
  'zip.invalid_local_header',
  /** Offsets apontam para fora do ficheiro ou sobrepõem-se de forma impossível. */
  'zip.impossible_offsets',
  /** Tamanhos declarados contradizem-se entre índice e cabeçalho local. */
  'zip.inconsistent_sizes',
  /** ZIP sem entradas. */
  'zip.empty_archive',
  /** O ZIP está bem formado mas o CRC de uma entrada não bate certo. */
  'zip.crc_mismatch',
  /** Os dados comprimidos não descomprimem. */
  'zip.corrupt_data',
  /** O conteúdo descomprimido não corresponde aos metadados declarados. */
  'zip.content_metadata_mismatch',
  /** Caminho relativo com `..` que escaparia da raiz (§7.3). */
  'zip.path_traversal',
  /** Caminho absoluto Unix (`/etc/passwd`) ou Windows (`C:\...`). */
  'zip.absolute_path',
  /** Caminho UNC (`\\server\share`). */
  'zip.unc_path',
  /** Nome de entrada duplicado, exato ou após normalização. */
  'zip.duplicate_entry',
  /** Nome de entrada vazio ou só com separadores. */
  'zip.invalid_entry_name',
  /** Nome de entrada acima de `maxEntryNameBytes`. */
  'zip.entry_name_too_long',
  /** Entrada que é um symlink. Rejeitada, nunca seguida (§7.3). */
  'zip.symlink_entry',
  /** Número de entradas acima de `maxEntries`. */
  'zip.too_many_entries',
  /** Total descomprimido acima de `maxUncompressedBytes`. */
  'zip.uncompressed_too_large',
  /** Entrada individual acima de `maxEntryBytes`. */
  'zip.entry_too_large',
  /** Rácio de compressão acima de `maxCompressionRatio`. */
  'zip.compression_ratio_exceeded',
  /** Comprimido acima de `maxCompressedBytes`. */
  'zip.compressed_too_large',
] as const;

export type ZipRefusalReason = (typeof ZIP_REFUSAL_REASONS)[number];

/**
 * Recusa de um ZIP.
 *
 * A §9.1 estabelece três gravidades para problemas de registo; aqui há uma só, porque um
 * ZIP que não se consegue ler com segurança não tem importação parcial possível: não há
 * "quase importado". É a mesma lógica da §9.2 — um registo com problemas nunca é criado
 * parcialmente em silêncio — aplicada uma camada acima: um bundle com problemas não
 * produz plano nenhum.
 */
export interface ZipRefusal {
  readonly reason: ZipRefusalReason;
  /** Mensagem para o utilizador. Nunca contém o conteúdo do bundle. */
  readonly message: string;
  /** Caminho da entrada em causa, quando o motivo é específico de uma entrada. */
  readonly entryName?: string;
}

/**
 * Erro lançado quando o ZIP é recusado.
 *
 * A §7.3 pede explicitamente "sem execução" e que um manifest malformado seja "um erro de
 * validação, não uma exceção não tratada". Este erro é o veículo dessa distinção: quem
 * chama apanha-o e converte-o numa recusa do utilizador, em vez de deixar subir uma
 * exceção de baixo nível com uma mensagem de biblioteca.
 */
export class ZipRefusalError extends Error {
  readonly refusal: ZipRefusal;

  constructor(refusal: ZipRefusal) {
    super(`${refusal.reason}: ${refusal.message}`);
    this.name = 'ZipRefusalError';
    this.refusal = refusal;
  }
}

/**
 * A implementação ainda não existe.
 *
 * Existe para que os testes adversariais falhem **pela razão certa**. Um teste que importa
 * um símbolo inexistente falha no *import*; um teste que chama uma função declarada mas
 * não implementada falha aqui, e a mensagem diz exatamente o que falta. A diferença
 * importa: a primeira falha não distingue "o contrato está errado" de "o código não está
 * escrito".
 */
export class ZipNotImplementedError extends Error {
  readonly operation: string;

  constructor(operation: string) {
    super(`Leitor de ZIP ainda não implementado: ${operation}`);
    this.name = 'ZipNotImplementedError';
    this.operation = operation;
  }
}

/* ========================================================================== */
/* Resultado da leitura                                                       */
/* ========================================================================== */

/**
 * Uma entrada lida do ZIP.
 *
 * `name` é o caminho **normalizado e validado** — depois de canonicalizado e confirmado
 * como descendente da raiz (§7.3). Um leitor que devolva `entries` não pode ter devolvido
 * nada com `..`, nada absoluto e nada UNC, porque a validação é uma pré-condição da
 * leitura e não uma verificação que quem chama possa esquecer.
 *
 * `data` são os bytes descomprimidos. Um leitor que nunca escreve no sistema de ficheiros
 * não pode escrever fora da raiz de extração: a defesa contra zip-slip aqui é deixar de
 * existir o alvo, não apenas filtrar o caminho.
 */
export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
  /** Tamanho descomprimido em bytes. Alias legível de `data.byteLength`. */
  readonly uncompressedBytes: number;
  /** Tamanho comprimido em bytes, como veio no arquivo. */
  readonly compressedBytes: number;
  /** CRC-32 declarado no índice e confirmado contra os dados. */
  readonly crc32: number;
  /** `false` quando a entrada está guardada sem compressão (método *stored*). */
  readonly compressed: boolean;
}

/** Resultado de uma leitura bem-sucedida. */
export interface ZipReadResult {
  readonly entries: readonly ZipEntry[];
  /** Total de bytes comprimidos do arquivo. */
  readonly compressedBytes: number;
  /** Soma dos bytes descomprimidos de todas as entradas. */
  readonly uncompressedBytes: number;
}

/* ========================================================================== */
/* Superfície pública — contrato, ainda sem implementação                     */
/* ========================================================================== */

/**
 * Opções de leitura. Todos os limites são sobreponíveis para os testes poderem exercitar
 * fronteiras sem construir ficheiros de 256 MB.
 */
export interface ZipReadOptions {
  readonly limits?: Partial<ZipLimits>;
}

/**
 * Verifica se os bytes começam pela assinatura de um ZIP.
 *
 * Verificação barata, feita no *upload* antes de guardar seja o que for (§7.1: "verifica
 * tipo, tamanho e assinatura"). Aceita as duas assinaturas válidas: `PK\x03\x04` (arquivo
 * com entradas) e `PK\x05\x06` (arquivo vazio, que depois é recusado por
 * `zip.empty_archive` — a distinção entre "não é um ZIP" e "é um ZIP vazio" é necessária
 * para a mensagem ser útil).
 */
export function hasZipSignature(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false;
  const signature =
    (bytes[0]! | (bytes[1]! << 8) | (bytes[2]! << 16) | (bytes[3]! << 24)) >>> 0;
  // `PK\x03\x04` — arquivo com entradas. `PK\x05\x06` — arquivo vazio: é um ZIP válido e
  //          é reconhecido como tal para a recusa poder dizer "não é um bundle" em vez de
  //          "não é um ZIP".
  // `PK\x07\x08` — *data descriptor*: aparece no início de um ZIP truncado a meio de uma
  //          entrada em streaming. Reconhecê-lo aqui permite recusar mais adiante com um
  //          motivo específico em vez de o tratar como assinatura inválida.
  return (
    signature === ZIP_SIGNATURES.localFileHeader ||
    signature === ZIP_SIGNATURES.endOfCentralDirectory ||
    signature === ZIP_SIGNATURES.dataDescriptor
  );
}

/**
 * Valida um **caminho de entrada** e devolve-o normalizado, ou recusa.
 *
 * É a defesa contra zip-slip, isolada do resto da leitura para poder ser testada sozinha:
 * a §13.4 lista a recusa de `../../etc/passwd` como teste de segurança independente, e uma
 * função que só faz isto torna esse teste direto em vez de exigir um ZIP completo para o
 * exercitar.
 *
 * Devolve o caminho normalizado quando é seguro, ou lança `ZipRefusalError` com o motivo
 * específico. Nunca devolve um caminho inseguro.
 */
export function validateEntryPath(rawName: string): string {
  // 1. Nome tem de existir e não pode ser só separadores. Um nome vazio não identifica
  //    nada e um nome só com `/` produziria um caminho vazio depois de normalizado.
  if (rawName.length === 0) {
    throw refuse('zip.invalid_entry_name', 'O ZIP tem uma entrada sem nome.');
  }

  // O limite mede-se em bytes UTF-8, não em caracteres: um nome de 200 caracteres
  // cirílicos ocupa 400 bytes e é esse o custo real de o guardar e comparar.
  const nameBytes = byteLengthOf(rawName);
  if (nameBytes > ZIP_LIMITS.maxEntryNameBytes) {
    throw refuse(
      'zip.entry_name_too_long',
      `O ZIP tem uma entrada com um nome demasiado longo (${nameBytes} bytes).`,
      rawName,
    );
  }

  // 2. Bytes nulos e caracteres de controlo. Não são perigosos por si, mas um nome com
  //    `\0` é a assinatura clássica de um nome truncado de propósito para enganar uma
  //    verificação que pare num byte nulo e outra que não pare.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(rawName)) {
    throw refuse(
      'zip.invalid_entry_name',
      'O ZIP tem uma entrada com caracteres de controlo no nome.',
      rawName,
    );
  }

  // 3. Caminhos absolutos e UNC. Verificados **antes** da regra geral sobre separadores,
  //    porque uma recusa genérica ("separadores Windows") seria menos útil do que dizer ao
  //    utilizador o que realmente se passa (`C:\` é absoluto; `\\server` é UNC). A ordem
  //    das verificações é a ordem da especificidade: do diagnóstico mais preciso para o
  //    mais vago.
  if (rawName.startsWith('\\\\')) {
    throw refuse('zip.unc_path', 'O ZIP tem uma entrada com um caminho de rede UNC.', rawName);
  }
  if (rawName.startsWith('/')) {
    throw refuse('zip.absolute_path', 'O ZIP tem uma entrada com um caminho absoluto.', rawName);
  }
  if (/^[a-zA-Z]:/.test(rawName)) {
    throw refuse(
      'zip.absolute_path',
      'O ZIP tem uma entrada com um caminho absoluto (letra de unidade).',
      rawName,
    );
  }
  // Um nome que começa por uma única barra invertida é um caminho enraizado no volume
  // atual do Windows (`\Windows\win.ini`) — absoluto na prática, ainda que sem letra.
  if (rawName.startsWith('\\')) {
    throw refuse('zip.absolute_path', 'O ZIP tem uma entrada com um caminho absoluto.', rawName);
  }

  // 4. Separadores Windows em nomes **relativos**. Aqui a barra invertida não é travessia
  //    nem absoluto — é só um separador que o formato do Zemlo não usa. Recusar em vez de
  //    traduzir para `/`: traduzir inventaria um caminho que o arquivo não declarava, e é
  //    assim que `..\..\etc\passwd` se transformaria silenciosamente num caminho a validar.
  //    A recusa é a mesma do que um nome com separador errado, e o motivo di-lo.
  if (rawName.includes('\\')) {
    throw refuse(
      'zip.invalid_entry_name',
      'O ZIP tem uma entrada com separadores Windows no nome.',
      rawName,
    );
  }

  // 5. Normalização. Aqui, e não antes, porque todas as verificações anteriores são sobre
  //    a forma **literal** do nome: normalizar primeiro esconderia `\\server` ou `C:`.
  //
  //    A normalização é feita segmento a segmento, resolvendo `.` e `..` à medida. É o que
  //    faz `foo/../../manifest.json` (que não começa por `..` mas sai da raiz) ser apanhado
  //    pelo mesmo teste que apanharia `../manifest.json`. Não se usa `path.normalize` do
  //    Node porque ele depende da plataforma: no Windows transformaria `/` em `\` e
  //    alteraria o resultado consoante onde o servidor corre.
  const segments: string[] = [];
  for (const segment of rawName.split('/')) {
    if (segment === '' || segment === '.') {
      // Segmento vazio (`a//b`) e `.` não contribuem. Recolhê-los em vez de recusar é o
      // que permite detetar colisões de nomes que só diferem nisto — a comparação de
      // duplicados faz-se sobre o caminho normalizado, precisamente por isso.
      continue;
    }
    if (segment === '..') {
      if (segments.length === 0) {
        throw refuse(
          'zip.path_traversal',
          'O ZIP tem uma entrada que tentaria sair da pasta de destino.',
          rawName,
        );
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  // 6. Sobrou algo? `..` sozinho ou `a/..` normalizam para nada — o nome não designa
  //    ficheiro nenhum. É inválido, não é travessia: não há destino a alcançar.
  if (segments.length === 0) {
    throw refuse(
      'zip.invalid_entry_name',
      'O ZIP tem uma entrada cujo nome não designa nenhum ficheiro.',
      rawName,
    );
  }

  return segments.join('/');
}

/* ========================================================================== */
/* Implementação da leitura                                                   */
/* ========================================================================== */

/** Lança uma recusa com o motivo indicado. Açúcar para as vinte chamadas que se seguem. */
function refuse(reason: ZipRefusalReason, message: string, entryName?: string): ZipRefusalError {
  return new ZipRefusalError(entryName === undefined ? { reason, message } : { reason, message, entryName });
}

/**
 * Comprimento em bytes UTF-8 de uma string.
 *
 * `Buffer.byteLength` é exato e não aloca uma cópia, ao contrário de `new TextEncoder()`,
 * que seria chamado uma vez por entrada.
 */
function byteLengthOf(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/**
 * Resolve os limites efetivos, sobrepondo as opções ao valor por omissão.
 *
 * Uma sobreposição **não pode aumentar** um limite por omissão: quem chama pode apertar
 * (é o que os testes fazem), nunca afrouxar. Sem isto, bastaria passar
 * `{ limits: { maxUncompressedBytes: Infinity } }` para desligar a defesa mais importante
 * do leitor — e um caminho de código que aceite essa opção é uma porta aberta à espera de
 * ser encontrada.
 */
function resolveLimits(overrides: Partial<ZipLimits> | undefined): ZipLimits {
  if (overrides === undefined) return ZIP_LIMITS;

  const resolved: Record<string, number> = { ...ZIP_LIMITS };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 0) {
      throw refuse('zip.inconsistent_sizes', `Limite inválido: ${key}.`);
    }
    const base = (ZIP_LIMITS as Record<string, number>)[key];
    if (base !== undefined && value > base) {
      throw refuse(
        'zip.inconsistent_sizes',
        `O limite ${key} não pode exceder o valor por omissão (${base}).`,
      );
    }
    resolved[key] = value;
  }
  return resolved as unknown as ZipLimits;
}

/** Leitura de inteiros little-endian, sem `DataView` para não alocar por campo. */
function u16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8)) >>> 0;
}

function u32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

/** CRC-32 de um bloco, sobre a tabela do `zlib`. Usado para confirmar o declarado. */
function crc32Of(bytes: Uint8Array): number {
  return zlib.crc32(bytes) >>> 0;
}

/** Entrada do *central directory*, já interpretada. */
interface DirectoryEntry {
  readonly name: string;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
  readonly compressionMethod: number;
  readonly externalAttributes: number;
  readonly flags: number;
}

/** Interpreta o *central directory* e devolve as entradas, ou recusa. */
function readCentralDirectory(bytes: Uint8Array, limits: ZipLimits): DirectoryEntry[] {
  // O EOCD é o último registo e tem 22 bytes fixos mais um comentário opcional de até
  // 65 535 bytes. Procura-se de trás para a frente, dentro dessa janela, porque o
  // comentário pode conter a assinatura — um leitor que procurasse para a frente a partir
  // do início poderia encontrar uma assinatura forjada no comentário.
  const minEocd = 22;
  if (bytes.byteLength < minEocd) {
    throw refuse('zip.truncated', 'O ficheiro é curto demais para ser um ZIP.');
  }
  const maxComment = 0xffff;
  const searchStart = Math.max(0, bytes.byteLength - minEocd - maxComment);
  let eocd = -1;
  for (let i = bytes.byteLength - minEocd; i >= searchStart; i -= 1) {
    if (u32(bytes, i) === ZIP_SIGNATURES.endOfCentralDirectory) {
      // Confirma que o comentário declarado cabe no ficheiro: se não couber, esta não é a
      // assinatura verdadeira mas sim uma que aparece por acaso dentro de dados.
      const commentLength = u16(bytes, i + 20);
      if (i + minEocd + commentLength === bytes.byteLength) {
        eocd = i;
        break;
      }
    }
  }
  if (eocd < 0) {
    // Distinguir dois diagnósticos que um leitor descuidado confunde:
    //
    //  - o ficheiro **começa** por um cabeçalho local válido → é um ZIP cortado a meio (um
    //    download interrompido). A mensagem deve sugerir repetir a transferência.
    //  - não começa → falta realmente o índice, e o ficheiro não é um ZIP utilizável.
    //
    // A diferença é acionável para o utilizador, e é a razão de existirem dois códigos.
    const startsLikeArchive =
      bytes.byteLength >= 4 && u32(bytes, 0) === ZIP_SIGNATURES.localFileHeader;
    throw refuse(
      startsLikeArchive ? 'zip.truncated' : 'zip.missing_central_directory',
      startsLikeArchive
        ? 'O ZIP está truncado: falta o índice final.'
        : 'O ZIP não tem o índice final (end of central directory).',
    );
  }

  const totalEntries = u16(bytes, eocd + 10);
  // Discos múltiplos: um ZIP dividido em vários ficheiros não é suportado, e tratá-lo como
  // um só produziria uma leitura parcial silenciosa. O Zemlo produz arquivos de um só disco.
  if (u16(bytes, eocd + 4) !== 0 || u16(bytes, eocd + 6) !== 0) {
    throw refuse('zip.invalid_central_directory', 'O ZIP está dividido em vários discos.');
  }
  if (u16(bytes, eocd + 8) !== totalEntries) {
    throw refuse(
      'zip.invalid_central_directory',
      'O ZIP declara um número de entradas inconsistente no índice.',
    );
  }

  // ZIP64: o campo de 16 bits satura em 0xffff e o valor real vive num registo extra. Um
  // bundle do Zemlo não se aproxima deste tamanho, e um ZIP64 mal interpretado como ZIP
  // normal leria offsets truncados — pior do que recusar.
  if (totalEntries === 0xffff) {
    throw refuse('zip.invalid_central_directory', 'O ZIP usa ZIP64, que não é suportado.');
  }

  if (totalEntries === 0) {
    throw refuse('zip.empty_archive', 'O ZIP não tem nenhuma entrada.');
  }

  // **Limite verificado antes de qualquer leitura de entrada.** §7.3: os limites são
  // verificados antes de extrair. Aqui é o sítio onde isso se cumpre para o número de
  // entradas — sabemos quantas são pelo índice, sem tocar em nenhuma.
  if (totalEntries > limits.maxEntries) {
    throw refuse(
      'zip.too_many_entries',
      `O ZIP tem ${totalEntries} entradas, acima do limite de ${limits.maxEntries}.`,
    );
  }

  const centralSize = u32(bytes, eocd + 12);
  const centralOffset = u32(bytes, eocd + 16);

  // O índice tem de terminar exatamente onde começa o EOCD. Esta é a invariante estrutural
  // mais forte do formato e é verificada **antes** de percorrer o índice e antes das
  // verificações de limites: um tamanho ou offset declarado que não feche no EOCD está
  // errado por definição, e interpretá-lo primeiro produziria diagnósticos enganadores
  // ("aponta para fora do ficheiro") para um ficheiro cujo problema real é o índice estar
  // corrompido. Verificar a relação primeiro dá o motivo certo à primeira.
  //
  // A soma é feita em ponto flutuante de 64 bits (o `number` do JavaScript), onde
  // `centralOffset + centralSize` até 2^33 é exato: não há overflow possível aqui.
  if (centralOffset + centralSize !== eocd) {
    throw refuse(
      'zip.invalid_central_directory',
      'O ZIP tem dados inesperados entre o índice e o fim do ficheiro.',
    );
  }

  // Só depois de a relação fechar é que os valores fazem sentido para comparar com o
  // ficheiro. Aqui a subtração evita somar valores que poderiam passar 2^32.
  if (centralOffset > bytes.byteLength || centralSize > bytes.byteLength - centralOffset) {
    throw refuse('zip.impossible_offsets', 'O ZIP aponta o índice para fora do ficheiro.');
  }

  const entries: DirectoryEntry[] = [];
  const seen = new Set<string>();
  let cursor = centralOffset;

  for (let i = 0; i < totalEntries; i += 1) {
    if (cursor + 46 > bytes.byteLength) {
      throw refuse('zip.truncated', 'O índice do ZIP está truncado.');
    }
    if (u32(bytes, cursor) !== ZIP_SIGNATURES.centralFileHeader) {
      throw refuse(
        'zip.invalid_central_directory',
        'O ZIP tem uma entrada de índice com assinatura inválida.',
      );
    }

    const flags = u16(bytes, cursor + 8);
    const compressionMethod = u16(bytes, cursor + 10);
    const crc = u32(bytes, cursor + 16);
    const compressedSize = u32(bytes, cursor + 20);
    const uncompressedSize = u32(bytes, cursor + 24);
    const nameLength = u16(bytes, cursor + 28);
    const extraLength = u16(bytes, cursor + 30);
    const commentLength = u16(bytes, cursor + 32);
    const externalAttributes = u32(bytes, cursor + 38);
    const localHeaderOffset = u32(bytes, cursor + 42);

    const nameEnd = cursor + 46 + nameLength;
    if (nameEnd > bytes.byteLength) {
      throw refuse('zip.truncated', 'O índice do ZIP está truncado.');
    }

    // Nome em UTF-8 quando a flag 0x0800 está posta; caso contrário o formato é o CP437
    // histórico. Um bundle do Zemlo escreve sempre UTF-8 e a flag, e o Zemlo **lê** UTF-8.
    // Um nome que não seja UTF-8 válido decodifica para caracteres de substituição, que a
    // validação de caminho recusa por não corresponderem a nada — o que é aceitável, mas
    // não silencioso.
    const rawName = new TextDecoder('utf-8', { fatal: false }).decode(
      bytes.subarray(cursor + 46, nameEnd),
    );

    // Os bytes de nome/extra/comentário avançam o cursor. As somas são verificadas antes
    // de serem usadas como índice.
    const entryEnd = nameEnd + extraLength + commentLength;
    if (entryEnd > bytes.byteLength) {
      throw refuse('zip.truncated', 'O índice do ZIP está truncado.');
    }

    // **Fronteira entre o índice e o arquivo.** Antes de guardar seja o que for, o caminho
    // é validado e normalizado. Um ZIP com uma entrada hostil é recusado aqui, antes de se
    // ler um único byte de dados.
    const name = validateEntryPath(rawName);

    // Duplicados: a comparação é sobre o nome **normalizado**, para que `a//b` e `a/b`
    // contem como o mesmo destino. `Set.has` é a verificação, e é feita por entrada
    // porque é a única forma de apanhar a colisão seja qual for a ordem.
    if (seen.has(name)) {
      throw refuse(
        'zip.duplicate_entry',
        `O ZIP tem duas entradas com o mesmo nome: ${name}.`,
        name,
      );
    }
    seen.add(name);

    // Symlinks. Em ZIP de Unix o tipo de ficheiro vive no nibble alto dos atributos
    // externos (S_IFLNK = 0xa000). §7.3: rejeitados, nunca seguidos.
    if ((externalAttributes >>> 16 & 0xf000) === 0xa000) {
      throw refuse('zip.symlink_entry', `O ZIP contém um link simbólico: ${name}.`, name);
    }

    // Métodos suportados: 0 (*stored*) e 8 (*deflate*). Qualquer outro — bzip2, LZMA,
    // PPMd, AES — exigiria código que o Zemlo não tem e que não deve tentar adivinhar.
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw refuse(
        'zip.corrupt_data',
        `O ZIP usa um método de compressão não suportado (${compressionMethod}) em ${name}.`,
        name,
      );
    }

    // Tamanhos declarados a 0xffffffff indicam ZIP64. Recusar em vez de truncar.
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw refuse('zip.invalid_central_directory', 'O ZIP usa ZIP64, que não é suportado.', name);
    }

    entries.push({
      name,
      crc32: crc,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      compressionMethod,
      externalAttributes,
      flags,
    });
    cursor = entryEnd;
  }

  return entries;
}

/**
 * Extrai e verifica uma entrada: cabeçalho local, limites, descompressão e CRC.
 *
 * A ordem das verificações é o ponto central deste ficheiro e está fixada em comentário
 * porque é fácil de quebrar sem que nenhum teste óbvio falhe.
 */
function extractEntry(
  bytes: Uint8Array,
  entry: DirectoryEntry,
  limits: ZipLimits,
): ZipEntry {
  const { name } = entry;

  // Os tamanhos declarados são validados **antes** de descomprimir. §7.3 exige que os
  // limites sejam verificados antes de extrair: aceitar um ZIP porque o `inflate` consegue
  // lidar com ele é exatamente o erro que este leitor existe para não cometer.
  if (entry.uncompressedSize > limits.maxEntryBytes) {
    throw refuse(
      'zip.entry_too_large',
      `A entrada ${name} tem ${entry.uncompressedSize} bytes descomprimidos, acima do limite.`,
      name,
    );
  }
  if (entry.compressedSize > limits.maxEntryBytes || entry.compressedSize > limits.maxCompressedBytes) {
    throw refuse('zip.compressed_too_large', `A entrada ${name} é demasiado grande.`, name);
  }

  // Rácio de compressão, também sem descomprimir: é uma divisão sobre os dois números
  // declarados. A multiplicação evita a divisão por zero quando o comprimido é 0.
  if (
    entry.compressionMethod === 8 &&
    entry.compressedSize > 0 &&
    entry.uncompressedSize > entry.compressedSize * limits.maxCompressionRatio
  ) {
    throw refuse(
      'zip.compression_ratio_exceeded',
      `A entrada ${name} expande demasiado para o tamanho que ocupa.`,
      name,
    );
  }

  // Cabeçalho local: 30 bytes fixos + nome + extra.
  const headerOffset = entry.localHeaderOffset;
  if (headerOffset + 30 > bytes.byteLength) {
    throw refuse('zip.impossible_offsets', `A entrada ${name} aponta para fora do ficheiro.`, name);
  }
  if (u32(bytes, headerOffset) !== ZIP_SIGNATURES.localFileHeader) {
    throw refuse('zip.invalid_local_header', `A entrada ${name} tem um cabeçalho inválido.`, name);
  }

  const localFlags = u16(bytes, headerOffset + 6);
  const localMethod = u16(bytes, headerOffset + 8);
  const localCrc = u32(bytes, headerOffset + 14);
  const localCompressedSize = u32(bytes, headerOffset + 18);
  const localUncompressedSize = u32(bytes, headerOffset + 22);
  const localNameLength = u16(bytes, headerOffset + 26);
  const localExtraLength = u16(bytes, headerOffset + 28);

  // O método tem de concordar entre índice e cabeçalho. Discordar significa que um dos dois
  // mente e não há forma de saber qual.
  if (localMethod !== entry.compressionMethod) {
    throw refuse(
      'zip.inconsistent_sizes',
      `A entrada ${name} declara métodos de compressão diferentes no índice e no cabeçalho.`,
      name,
    );
  }

  // Nome local tem de coincidir com o do índice. É o ataque clássico de uma biblioteca
  // validar o nome do índice (que leu primeiro) e extrair o do cabeçalho local (que é
  // outro). Aqui, ambos são lidos e comparados.
  const localNameStart = headerOffset + 30;
  const localNameEnd = localNameStart + localNameLength;
  if (localNameEnd > bytes.byteLength) {
    throw refuse('zip.truncated', `O cabeçalho da entrada ${name} está truncado.`, name);
  }
  const localName = new TextDecoder('utf-8', { fatal: false }).decode(
    bytes.subarray(localNameStart, localNameEnd),
  );
  if (localName !== name) {
    throw refuse(
      'zip.invalid_local_header',
      `A entrada ${name} tem nomes diferentes no índice e no cabeçalho.`,
      name,
    );
  }

  const dataStart = localNameEnd + localExtraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataStart > bytes.byteLength || dataEnd > bytes.byteLength) {
    throw refuse('zip.impossible_offsets', `A entrada ${name} aponta para fora do ficheiro.`, name);
  }

  const compressed = bytes.subarray(dataStart, dataEnd);

  // Flag 0x0008: os tamanhos e o CRC verdadeiros vivem num *data descriptor* **depois** dos
  // dados, e os campos do cabeçalho estão a zero. O Zemlo escreve sempre os tamanhos nos
  // cabeçalhos, por isso recusa-se o formato em streaming em vez de o tentar ler às cegas.
  if ((localFlags & 0x0008) !== 0 || (entry.flags & 0x0008) !== 0) {
    throw refuse(
      'zip.invalid_local_header',
      `A entrada ${name} usa tamanhos em data descriptor, que não é suportado.`,
      name,
    );
  }

  // Coerência entre índice e cabeçalho local: CRC, tamanho comprimido e descomprimido.
  // Um leitor que confie apenas num dos dois está a aceitar a palavra de uma das partes.
  if (localCrc !== entry.crc32) {
    throw refuse('zip.inconsistent_sizes', `A entrada ${name} tem CRC diferentes no índice e no cabeçalho.`, name);
  }
  if (localCompressedSize !== entry.compressedSize) {
    throw refuse(
      'zip.inconsistent_sizes',
      `A entrada ${name} tem tamanhos comprimidos diferentes no índice e no cabeçalho.`,
      name,
    );
  }
  if (localUncompressedSize !== entry.uncompressedSize) {
    throw refuse(
      'zip.inconsistent_sizes',
      `A entrada ${name} tem tamanhos descomprimidos diferentes no índice e no cabeçalho.`,
      name,
    );
  }

  // **Só agora se descomprime.** Tudo o que podia ser verificado sem tocar nos dados foi
  // verificado: nome, método, limites, rácio, offsets, coerência dos metadados. O
  // `inflate` é a operação mais caro do leitor e corre por último, sobre bytes cujo tamanho
  // declarado já se sabe estar dentro dos limites.
  let data: Uint8Array;
  if (entry.compressionMethod === 0) {
    // *Stored*: o tamanho descomprimido tem de ser o comprimido, ou os metadados mentem.
    if (entry.uncompressedSize !== entry.compressedSize) {
      throw refuse(
        'zip.content_metadata_mismatch',
        `A entrada ${name} está sem compressão mas declara tamanhos diferentes.`,
        name,
      );
    }
    data = compressed;
  } else {
    try {
      const inflated = zlib.inflateRawSync(compressed, {
        // Teto duro no `inflate`: mesmo que o tamanho declarado esteja dentro do limite,
        // um fluxo pode expandir muito mais do que declara. Este é o segundo travão, a
        // par do rácio — o `zlib` para em vez de alocar sem limite.
        maxOutputLength: Math.min(entry.uncompressedSize || limits.maxEntryBytes, limits.maxEntryBytes),
      });
      data = new Uint8Array(inflated.buffer, inflated.byteOffset, inflated.byteLength);
    } catch {
      // `inflateRawSync` lança com dados corrompidos. §7.3: "sem execução" — isto é um erro
      // de validação, convertido numa recusa, não uma exceção não tratada.
      throw refuse('zip.corrupt_data', `Os dados da entrada ${name} não descomprimem.`, name);
    }
  }

  // O tamanho real tem de corresponder ao declarado. É a verificação que apanha um fluxo
  // que descomprime bem mas produz menos bytes do que os metadados prometiam.
  if (data.byteLength !== entry.uncompressedSize) {
    throw refuse(
      'zip.content_metadata_mismatch',
      `A entrada ${name} tem ${data.byteLength} bytes, mas declarava ${entry.uncompressedSize}.`,
      name,
    );
  }

  // CRC por último entre as verificações de conteúdo: é o veredicto final sobre os bytes.
  const actualCrc = crc32Of(data);
  if (actualCrc !== entry.crc32) {
    throw refuse('zip.crc_mismatch', `A entrada ${name} está corrompida (CRC inválido).`, name);
  }

  return {
    name,
    data,
    uncompressedBytes: data.byteLength,
    compressedBytes: entry.compressedSize,
    crc32: entry.crc32,
    compressed: entry.compressionMethod === 8,
  };
}

/**
 * Lê um ZIP inteiro em memória, aplicando todos os limites e validações.
 *
 * É o ponto de entrada único. Não há variante que salte validações: um ZIP que não passe
 * por aqui não é lido, e é isso que impede que a validação seja opcional em algum caminho.
 *
 * ## Ordem das verificações
 *
 * A ordem não é arbitrária e é a parte do leitor que mais importa para a segurança:
 *
 *  1. assinatura e tamanho mínimo        — barato, sem índices
 *  2. índice (*central directory*)       — nome, duplicados, symlinks, método, tamanho
 *  3. limites agregados                   — total descomprimido, calculado a partir do índice
 *  4. **só então** cada entrada: cabeçalho local, coerência, descompressão, CRC
 *
 * O passo 3 é o que cumpre a exigência de "limites e metadados validados antes de
 * descomprimir dados potencialmente grandes". O total descomprimido é a soma dos valores
 * **declarados** no índice: conhece-se sem tocar num único byte de dados. Um ZIP que
 * declare 10 GB é recusado aqui, sem que o `inflate` seja chamado uma vez.
 */
export function readZip(bytes: Uint8Array, options?: ZipReadOptions): ZipReadResult {
  const limits = resolveLimits(options?.limits);

  // 1. Comprimento mínimo **antes** da assinatura. Um ficheiro com menos de 4 bytes — ou
  //    vazio — não pode sequer ter assinatura, e o diagnóstico útil é "está truncado"
  //    (download interrompido), não "não é um ZIP" (ficheiro errado). A ordem destas duas
  //    verificações determina qual das duas mensagens o utilizador recebe.
  if (bytes.byteLength < 22) {
    throw refuse('zip.truncated', 'O ficheiro é curto demais para ser um ZIP.');
  }

  // A assinatura no início é verificada, mas **não** é a última palavra: um ZIP cujo
  // primeiro cabeçalho local esteja corrompido continua a ter um índice válido, e o
  // diagnóstico correto é então "cabeçalho local inválido" e não "isto não é um ZIP". Se o
  // índice também não existir, aí sim o ficheiro não é um ZIP. `readCentralDirectory` é
  // quem decide, e por isso corre antes desta recusa ser definitiva.
  if (bytes.byteLength > limits.maxCompressedBytes) {
    throw refuse('zip.compressed_too_large', 'O ficheiro excede o tamanho máximo admitido.');
  }
  if (!hasZipSignature(bytes)) {
    try {
      readCentralDirectory(bytes, limits);
    } catch (error) {
      // Sem índice válido e sem assinatura inicial: não é um ZIP.
      if (error instanceof ZipRefusalError && error.refusal.reason === 'zip.missing_central_directory') {
        throw refuse('zip.invalid_signature', 'O ficheiro não é um ZIP.');
      }
      if (error instanceof ZipRefusalError && error.refusal.reason === 'zip.truncated') {
        throw error;
      }
      // Havia índice: o problema está no cabeçalho local. Deixa-se seguir para a extração,
      // que produz o motivo específico.
      if (!(error instanceof ZipRefusalError)) throw error;
    }
  }

  // 2. Índice. Recusa aqui tudo o que é visível sem tocar nos dados.
  const directory = readCentralDirectory(bytes, limits);

  // 3. Limites agregados, sobre o índice. Nenhum byte de dados foi descomprimido até aqui.
  let declaredUncompressed = 0;
  for (const entry of directory) {
    if (entry.uncompressedSize > limits.maxEntryBytes) {
      throw refuse(
        'zip.entry_too_large',
        `A entrada ${entry.name} excede o tamanho máximo por entrada.`,
        entry.name,
      );
    }
    if (
      entry.compressionMethod === 8 &&
      entry.compressedSize > 0 &&
      entry.uncompressedSize > entry.compressedSize * limits.maxCompressionRatio
    ) {
      throw refuse(
        'zip.compression_ratio_exceeded',
        `A entrada ${entry.name} expande demasiado para o tamanho que ocupa.`,
        entry.name,
      );
    }
    declaredUncompressed += entry.uncompressedSize;
    // Soma verificada a cada passo: nunca se deixa o acumulador passar o limite, para que
    // um índice com entradas enormes não possa provocar overflow no somatório.
    if (declaredUncompressed > limits.maxUncompressedBytes) {
      throw refuse(
        'zip.uncompressed_too_large',
        `O ZIP descomprime para mais de ${limits.maxUncompressedBytes} bytes.`,
      );
    }
  }

  // 4. Extração. Por ordem do índice, para que a recusa seja determinística.
  const entries: ZipEntry[] = [];
  let uncompressedBytes = 0;
  let compressedBytes = 0;
  for (const entry of directory) {
    const extracted = extractEntry(bytes, entry, limits);
    entries.push(extracted);
    uncompressedBytes += extracted.uncompressedBytes;
    compressedBytes += extracted.compressedBytes;
  }

  return { entries, compressedBytes, uncompressedBytes };
}

/**
 * Índice do bundle a partir das entradas.
 *
 * Distinto de `readZip`: aquele responde "este ZIP é legível e seguro?", este responde
 * "este ZIP **é um bundle do Zemlo**?" — §12.1 exige recusa quando falta o
 * `manifest.json`, que é o único ficheiro obrigatório.
 */
export function indexBundleEntries(
  entries: readonly ZipEntry[],
): {
  readonly manifest: ZipEntry;
  readonly dataFiles: readonly ZipEntry[];
  readonly documentBytes: readonly ZipEntry[];
} {
  const documentPrefix = `${BUNDLE_DOCUMENTS_DIR}/`;

  let manifest: ZipEntry | undefined;
  const dataFiles: ZipEntry[] = [];
  const documentBytes: ZipEntry[] = [];

  for (const entry of entries) {
    if (entry.name === BUNDLE_MANIFEST_FILE) {
      manifest = entry;
      continue;
    }
    if (entry.name.startsWith(documentPrefix)) {
      documentBytes.push(entry);
      continue;
    }
    // Tudo o que está na raiz e não é o manifest é um ficheiro de dados reconhecido
    // (`vehicles.jsonl`, `account.json`, …). O `README.txt` e a pasta `csv/` fazem parte
    // do contrato do artefacto e não são dados a importar (§5.2).
    dataFiles.push(entry);
  }

  if (manifest === undefined) {
    throw refuse(
      'zip.invalid_entry_name',
      'O bundle não tem manifest.json. É o único ficheiro obrigatório.',
      BUNDLE_MANIFEST_FILE,
    );
  }

  return { manifest, dataFiles, documentBytes };
}

/**
 * Campos de um cabeçalho local de ZIP, para os testes construírem arquivos à mão.
 *
 * Vive aqui, e não no ficheiro de testes, porque descreve o formato que o leitor terá de
 * interpretar: se um campo mudar de nome, ambos mudam juntos. Os testes importam
 * `ZIP_SIGNATURES` para não escreverem `0x04034b50` à mão em vinte sítios.
 */
export const ZIP_SIGNATURES = {
  /** Cabeçalho local de ficheiro. */
  localFileHeader: 0x04034b50,
  /** Cabeçalho do *central directory*. */
  centralFileHeader: 0x02014b50,
  /** Fim do *central directory*. */
  endOfCentralDirectory: 0x06054b50,
  /** Entrada de dados (streaming, usado em ZIPs de tamanho desconhecido à partida). */
  dataDescriptor: 0x08074b50,
} as const;
