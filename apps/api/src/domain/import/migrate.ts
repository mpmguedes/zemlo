/**
 * Migrações para a frente (§12.1, §12.2).
 *
 * ## O problema que este ficheiro resolve
 *
 * Um bundle exportado pela versão 1 tem de continuar a importar-se quando a aplicação já
 * for a versão 3. Mas a §12.1 recusa o inverso: um bundle **mais recente** do que a
 * aplicação é recusado explicitamente, e nunca se tenta adivinhar.
 *
 * ```
 * formatVersion igual    → importação normal
 * formatVersion menor    → migração para a frente, registada no relatório
 * formatVersion maior    → recusa explícita
 * format desconhecido    → recusa, com encaminhamento para a camada 2
 * ```
 *
 * ## As cinco regras da §12.2, e como se manifestam aqui
 *
 * 1. **Só se acrescenta.** Campos novos são opcionais e têm valor por omissão. Nenhuma
 *    migração remove um campo;
 * 2. **Nunca se remove um campo** sem subir `formatVersion` e manter um caminho de
 *    leitura durante pelo menos uma versão;
 * 3. **As migrações são funções puras**, uma por salto de versão, testáveis isoladamente,
 *    e cada uma regista o que fez. É por isso que cada uma devolve `notes` — a §12.1
 *    exige que a conversão apareça no relatório ("convertido do formato 1 para o 2: …");
 * 4. **O exportador só produz a versão atual.** Bundles antigos são lidos, não reescritos;
 * 5. **Um bundle nunca é migrado em disco.** A conversão acontece em memória, durante a
 *    importação — e é por isso que este ficheiro não tem nada que se pareça com escrita.
 *
 * ## Testes de versões suportadas e incompatíveis
 *
 * A política de compatibilidade é uma função que **recusa**: um erro aqui não corrompe
 * dados, mas deixa o utilizador com um ficheiro que ele sabe ser dele e que a aplicação
 * se recusa a abrir. As mensagens importam tanto quanto a decisão, e por isso carregam
 * sempre o que fazer a seguir (§11.3, "nunca um beco sem saída").
 */

import {
  EXPORT_FORMAT,
  FORMAT_VERSION,
  MANIFEST_VERSION,
  MIN_SUPPORTED_FORMAT_VERSION,
} from '@zemlo/shared';

/* -------------------------------------------------------------------------- */
/* Compatibilidade (§12.1)                                                     */
/* -------------------------------------------------------------------------- */

export type CompatibilityVerdict =
  /** Versão igual: importação normal. */
  | { readonly kind: 'current' }
  /** Versão menor: migrar para a frente, com o registo do que foi feito. */
  | { readonly kind: 'migrate'; readonly from: number; readonly to: number }
  /** Versão maior: recusa explícita. Nunca tentar adivinhar. */
  | { readonly kind: 'too-new'; readonly bundleVersion: number; readonly supported: number }
  /** Versão mais antiga do que a aplicação ainda sabe migrar. */
  | { readonly kind: 'too-old'; readonly bundleVersion: number; readonly minimum: number }
  /** `format` diferente de `zemlo-export`. */
  | { readonly kind: 'wrong-format'; readonly format: string }
  /** `formatVersion` ausente ou não numérico. */
  | { readonly kind: 'malformed'; readonly detail: string };

/**
 * Decide o que fazer com um bundle, a partir de `format` e `formatVersion`.
 *
 * ## Porque é que a ordem das verificações é esta
 *
 * O `format` é verificado **antes** da versão. Um CSV com um número de versão partido
 * deve ser encaminhado para a camada 2 ("isto é um ficheiro externo, e há um caminho
 * próprio para ele"), não recusado como "bundle demasiado recente" — que enviaria o
 * utilizador a atualizar uma aplicação que já está atualizada.
 *
 * A §12.1 acrescenta uma verificação que **não** é feita aqui, deliberadamente: um
 * `manifestVersion` desconhecido, mas com as chaves necessárias, **importa** — a
 * compatibilidade para a frente é responsabilidade do parse do manifest, não da política
 * de versões. Recusá-lo aqui contradiria a §12.1.
 */
export function checkCompatibility(input: {
  format?: unknown;
  formatVersion?: unknown;
}): CompatibilityVerdict {
  const format = input.format;

  if (format !== EXPORT_FORMAT) {
    return { kind: 'wrong-format', format: typeof format === 'string' ? format : '(ausente)' };
  }

  const version = input.formatVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { kind: 'malformed', detail: 'formatVersion ausente ou inválido' };
  }

  if (version > FORMAT_VERSION) {
    return { kind: 'too-new', bundleVersion: version, supported: FORMAT_VERSION };
  }

  if (version < MIN_SUPPORTED_FORMAT_VERSION) {
    return { kind: 'too-old', bundleVersion: version, minimum: MIN_SUPPORTED_FORMAT_VERSION };
  }

  if (version === FORMAT_VERSION) return { kind: 'current' };

  return { kind: 'migrate', from: version, to: FORMAT_VERSION };
}

/**
 * Converte um veredicto de compatibilidade numa mensagem para o utilizador.
 *
 * A §11.3 exige zero conceitos técnicos e "nunca um beco sem saída". Por isso nenhuma
 * mensagem diz "formatVersion 2 > 1": a primeira diz ao utilizador o que fazer
 * (atualizar), a segunda diz-lhe que o ficheiro não é um bundle Zemlo e para onde ir.
 */
export function describeCompatibility(verdict: CompatibilityVerdict): string {
  switch (verdict.kind) {
    case 'current':
      return 'Este ficheiro pode ser importado.';
    case 'migrate':
      return `Este ficheiro foi criado por uma versão anterior do Zemlo. Vai ser convertido automaticamente.`;
    case 'too-new':
      return 'Este ficheiro foi criado por uma versão mais recente do Zemlo. Atualiza a aplicação e tenta outra vez.';
    case 'too-old':
      return 'Este ficheiro é demasiado antigo para ser lido por esta versão. Exporta-o de novo na aplicação onde o criaste.';
    case 'wrong-format':
      return 'Este ficheiro não foi criado pelo Zemlo. Se é uma folha de cálculo ou um CSV, usa a importação de ficheiros.';
    case 'malformed':
      return 'Não foi possível ler a versão deste ficheiro. Pode estar corrompido ou ter sido editado.';
  }
}

/* -------------------------------------------------------------------------- */
/* Contexto de migração                                                        */
/* -------------------------------------------------------------------------- */

/**
 * O que uma migração pode ler e alterar.
 *
 * Cada migração recebe os dados de **um** tipo de registo por vez e devolve-os
 * convertidos. Não vê o bundle inteiro: uma migração que precisasse de olhar para todos
 * os registos ao mesmo tempo seria, quase sempre, uma migração que está a fazer trabalho
 * que pertence a outro estágio.
 */
export interface MigrationContext {
  /** Devolve os registos de um tipo, tal como estão no bundle. */
  recordsOf(kind: string): readonly Record<string, unknown>[];
  /** Substitui os registos de um tipo pelos convertidos. */
  replaceRecords(kind: string, records: readonly Record<string, unknown>[]): void;
  /** Metadados operacionais do manifest que uma migração possa precisar de reescrever. */
  readonly manifestMeta: Record<string, unknown>;
}

/** Uma migração de uma versão para a seguinte. */
export interface Migration {
  /** Versão de origem. A migração leva de `fromVersion` para `fromVersion + 1`. */
  readonly fromVersion: number;
  /** Versão de destino. Sempre `fromVersion + 1` — um salto, nunca mais. */
  readonly toVersion: number;
  /** Descrição do que faz, em linguagem de utilizador. Vai para o relatório (§12.1). */
  readonly description: string;
  /** Aplica a conversão, em memória. Devolve as notas do que fez. */
  apply(context: MigrationContext): readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Registo de migrações                                                        */
/* -------------------------------------------------------------------------- */

/**
 * As migrações conhecidas, uma por salto de versão (§12.2, regra 3).
 *
 * ## Porque é que esta lista está vazia
 *
 * `FORMAT_VERSION` é 1 e `MIN_SUPPORTED_FORMAT_VERSION` é 1: não existe ainda nenhum
 * salto. A lista vazia não é um lugar-comum — é o estado correto do projeto, e a
 * alternativa (inventar migrações hipotéticas para demonstrar o mecanismo) seria pior:
 * criaria caminhos de conversão que ninguém testou contra dados reais.
 *
 * O que fica implementado é o **mecanismo**: quando a versão 2 existir, acrescenta-se uma
 * entrada a esta lista e mais nada. Os testes cobrem o mecanismo com migrações de teste,
 * que é onde ele deve ser exercido — não no caminho de produção com conversões fictícias.
 */
export const MIGRATIONS: readonly Migration[] = [];

/**
 * Encontra a cadeia de migrações necessária para levar um bundle de `from` até `to`.
 *
 * Devolve **uma migração por salto**, nunca um salto directo. A §12.2 exige-o
 * explicitamente, e a razão é prática: uma cadeia de saltos pequenos é testável passo a
 * passo, e a única migração que precisa de estar correta quando se publica a versão 3 é a
 * de 2→3.
 *
 * Devolve `null` quando falta uma migração da cadeia. Não é um erro a recuperar com um
 * salto forçado: significa que a aplicação não sabe ler aquele bundle, e a resposta certa
 * é dizê-lo.
 */
export function findMigrationPath(
  from: number,
  to: number,
  migrations: readonly Migration[] = MIGRATIONS,
): readonly Migration[] | null {
  if (from === to) return [];

  if (from > to) {
    // Um bundle mais recente nunca é "migrado para trás": §12.1 diz recusar.
    return null;
  }

  const path: Migration[] = [];
  let current = from;

  while (current < to) {
    const step = migrations.find((migration) => migration.fromVersion === current);
    if (!step) return null;

    // Salvaguarda contra uma migração mal declarada que aponte para trás ou salte duas
    // versões. Sem isto, o ciclo poderia não terminar, ou terminar cedo em silêncio.
    if (step.toVersion !== step.fromVersion + 1) return null;

    path.push(step);
    current = step.toVersion;
  }

  return path;
}

/**
 * Executa a cadeia de migrações sobre um contexto.
 *
 * Determinística e sem mutações implícitas: cada migração declara o que alterou através
 * de `replaceRecords`, e as notas devolvidas são agregadas na ordem em que as migrações
 * correram. Nada é alterado fora deste contrato.
 *
 * Devolve `null` quando a cadeia não existe — o chamador distingue "não havia nada a
 * fazer" (`notes` vazio) de "não sei ler isto" (`null`).
 */
export function runMigrations(
  context: MigrationContext,
  from: number,
  to: number,
  migrations: readonly Migration[] = MIGRATIONS,
): readonly string[] | null {
  const path = findMigrationPath(from, to, migrations);
  if (path === null) return null;

  const notes: string[] = [];
  for (const migration of path) {
    const stepNotes = migration.apply(context);
    for (const note of stepNotes) notes.push(note);
  }
  return notes;
}

/* -------------------------------------------------------------------------- */
/* Auxiliares puros para migrações futuras                                     */
/* -------------------------------------------------------------------------- */

/**
 * Acrescenta um campo com valor por omissão a todos os registos de um tipo.
 *
 * É a operação que a regra 1 da §12.2 descreve ("campos novos são opcionais e têm valor
 * por omissão"), e por isso vem pré-implementada: a primeira migração real vai querer
 * exatamente isto, e escrevê-la de novo em cada migração seria a forma mais fácil de
 * introduzir uma diferença entre elas.
 *
 * **Não sobrescreve valores existentes.** Um campo já presente é deixado intacto — se uma
 * migração futura precisar de reescrever um valor, isso é uma mudança de semântica, não
 * um acrescento, e merece código explícito em vez de um auxiliar que o faz sem se notar.
 */
export function addOptionalField(
  records: readonly Record<string, unknown>[],
  field: string,
  defaultValue: unknown,
): { records: Array<Record<string, unknown>>; changed: number } {
  let changed = 0;
  const converted = records.map((record) => {
    if (record[field] !== undefined) return record;
    changed += 1;
    return { ...record, [field]: defaultValue };
  });
  return { records: converted, changed };
}

/**
 * Renomeia um campo, preservando o valor.
 *
 * Existe porque renomear é a forma mais comum de "mudar a semântica de um campo
 * existente" — que a §12.3 lista como motivo para subir `formatVersion`. Ter a operação
 * disponível num só sítio, com o comportamento de colisão explícito, evita que uma
 * migração futura a reimplemente e decida de outra maneira o que fazer quando o nome de
 * destino já existe.
 *
 * Quando o nome de destino já existe, o valor de origem é **descartado** e o facto é
 * reportado. A alternativa — sobrepor — perderia o valor que já lá estava sem o dizer.
 */
export function renameField(
  records: readonly Record<string, unknown>[],
  from: string,
  to: string,
): { records: Array<Record<string, unknown>>; changed: number; skipped: number } {
  let changed = 0;
  let skipped = 0;

  const converted = records.map((record) => {
    if (record[from] === undefined) return record;
    if (record[to] !== undefined) {
      skipped += 1;
      return record;
    }
    changed += 1;
    const { [from]: value, ...rest } = record;
    return { ...rest, [to]: value };
  });

  return { records: converted, changed, skipped };
}

/**
 * Converte um campo em todos os registos de um tipo.
 *
 * Para mudanças de unidade ou de representação — a §12.3 dá "cêntimos → euros" como
 * exemplo de subida de `formatVersion`. A função não decide **como** converter; recebe a
 * conversão, para que cada migração declare a sua regra em vez de a esconder num
 * auxiliar genérico.
 */
export function mapField(
  records: readonly Record<string, unknown>[],
  field: string,
  convert: (value: unknown) => unknown,
): { records: Array<Record<string, unknown>>; changed: number } {
  let changed = 0;
  const converted = records.map((record) => {
    const value = record[field];
    if (value === undefined || value === null) return record;
    const next = convert(value);
    if (next === value) return record;
    changed += 1;
    return { ...record, [field]: next };
  });
  return { records: converted, changed };
}

/* -------------------------------------------------------------------------- */
/* Estado da migração, para o relatório (§12.1)                                */
/* -------------------------------------------------------------------------- */

/**
 * O resultado da migração de um bundle, tal como aparece no relatório.
 *
 * A §12.1 exige que uma conversão fique **registada** ("convertido do formato 1 para o
 * 2: …"). Um utilizador que vê os seus dados mudarem de forma precisa de saber que a
 * mudança foi deliberada e qual foi — caso contrário, a diferença entre "convertido" e
 * "corrompido" é indistinguível para ele.
 */
export interface MigrationOutcome {
  readonly migrated: boolean;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly notes: readonly string[];
  /** Presente quando a cadeia não pôde ser construída. */
  readonly failure?: string;
}

/**
 * Migra um bundle até à versão atual, devolvendo o resultado para o relatório.
 *
 * Ponto de entrada único do chamador. Concentra aqui a decisão de compatibilidade e a
 * execução para que o serviço, na Fase 3, não tenha de orquestrar duas coisas que andam
 * sempre juntas — e para que não possa esquecer-se de reportar a conversão.
 */
export function migrateBundle(
  context: MigrationContext,
  formatVersion: number,
  migrations: readonly Migration[] = MIGRATIONS,
): MigrationOutcome {
  if (formatVersion === FORMAT_VERSION) {
    return {
      migrated: false,
      fromVersion: formatVersion,
      toVersion: FORMAT_VERSION,
      notes: [],
    };
  }

  if (formatVersion > FORMAT_VERSION) {
    // Nunca migrar para trás (§12.1). Chegar aqui indica que a verificação de
    // compatibilidade não foi feita, e é melhor falhar de forma explícita do que
    // produzir um bundle interpretado com regras erradas.
    return {
      migrated: false,
      fromVersion: formatVersion,
      toVersion: FORMAT_VERSION,
      notes: [],
      failure: 'Este ficheiro foi criado por uma versão mais recente do Zemlo.',
    };
  }

  const notes = runMigrations(context, formatVersion, FORMAT_VERSION, migrations);
  if (notes === null) {
    return {
      migrated: false,
      fromVersion: formatVersion,
      toVersion: FORMAT_VERSION,
      notes: [],
      failure: `Não é possível converter dados no formato ${formatVersion} para o formato ${FORMAT_VERSION}.`,
    };
  }

  return {
    migrated: true,
    fromVersion: formatVersion,
    toVersion: FORMAT_VERSION,
    notes,
  };
}

/* -------------------------------------------------------------------------- */
/* Informação de versões, para diagnóstico                                     */
/* -------------------------------------------------------------------------- */

/**
 * Descreve o suporte de versões desta instalação.
 *
 * Exposto para que um diagnóstico ou uma página de estado possa dizer ao utilizador
 * **quais** os formatos que a aplicação lê, em vez de apenas recusar. É a diferença entre
 * um erro acionável e um erro opaco.
 */
export function describeVersionSupport(): {
  manifestVersion: number;
  formatVersion: number;
  minSupportedFormatVersion: number;
  supportedRange: string;
} {
  return {
    manifestVersion: MANIFEST_VERSION,
    formatVersion: FORMAT_VERSION,
    minSupportedFormatVersion: MIN_SUPPORTED_FORMAT_VERSION,
    // O limite superior não é um número mas a própria noção de "mais recente do que eu":
    // a §12.1 recusa versões superiores, e por isso a gama é fechada em cima.
    supportedRange: `${MIN_SUPPORTED_FORMAT_VERSION}–${FORMAT_VERSION}`,
  };
}
