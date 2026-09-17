/**
 * Validação estrutural e semântica de um bundle (§9).
 *
 * ## A regra de ouro (§9.2)
 *
 * > Um registo com problemas **nunca** é criado parcialmente em silêncio. Ou entra
 * > completo, ou entra com uma lacuna que o relatório nomeia, ou não entra e o relatório
 * > diz porquê.
 *
 * Toda a forma deste ficheiro decorre dessa frase. Um resultado de validação não é um
 * booleano — é uma lista de problemas localizados, cada um com uma gravidade que
 * determina o que acontece ao registo.
 *
 * ## As três gravidades (§9.1)
 *
 *  - **bloqueante** — a importação **não** avança, detetado **antes** de escrever. É a
 *    categoria que existe para impedir o estado que mais dano causa: dados criados
 *    parcialmente sem ninguém saber;
 *  - **recuperável** — o registo entra com a lacuna declarada, ou fica em quarentena;
 *  - **informativo** — nada muda no resultado.
 *
 * ## Porque é que as referências quebradas são bloqueantes (§9.4)
 *
 * Uma referência quebrada significa que o bundle está **internamente inconsistente**.
 * Importá-lo parcialmente produziria exatamente o estado que os princípios proíbem: dados
 * criados sem o utilizador saber que faltam outros. Reparar automaticamente — inventar o
 * veículo que falta, ou largar o registo órfão — é pior, porque torna invisível uma perda
 * de dados.
 *
 * A saída existe e é explícita: o utilizador pode escolher *"importar sem estes
 * registos"*, e nesse caso o plano passa a declarar desde o início o que fica de fora.
 * O que nunca acontece é a degradação silenciosa.
 */

import {
  isValidBundleId,
  isValidLocalId,
  type LocalIdPrefix,
} from './ids.js';
import {
  hasUsablePlate,
  normalizeCentsForCompare,
  normalizeCivilDateForCompare,
  normalizeKwhForCompare,
  normalizeLitresForCompare,
  normalizeOdometerForCompare,
} from './normalize.js';
import type { ImportIssue, IssueSeverity } from '@zemlo/shared';

/* -------------------------------------------------------------------------- */
/* Vocabulário                                                                 */
/* -------------------------------------------------------------------------- */

/** Tipos de registo que o bundle transporta. Chave de `CanonicalRecord.kind`. */
export type RecordKind =
  | 'vehicle'
  | 'odometer'
  | 'expense'
  | 'fuel'
  | 'charging'
  | 'maintenance'
  | 'insurance'
  | 'inspection'
  | 'tax'
  | 'document'
  | 'reminder'
  | 'event'
  | 'suggestion'
  | 'notification';

/**
 * Qualidade de um registo depois da validação (§9.2).
 *
 *  - `complete`     — entra inteiro;
 *  - `partial`      — entra com uma lacuna que o relatório nomeia;
 *  - `quarantined`  — não entra sem decisão do utilizador.
 *
 * `partial` não é um estado degradado a tolerar: é a representação honesta de um registo
 * que o Zemlo aceita (§49 — dados incompletos são a norma, não a exceção). O que a
 * especificação proíbe é a **lacuna não declarada**.
 */
export type RecordQuality = 'complete' | 'partial' | 'quarantined';

/**
 * Um registo normalizado, já com as relações resolvidas para `localId`.
 *
 * Este é o contrato que garante o critério de sucesso da §4.3: acrescentar um adaptador
 * novo não pode obrigar a tocar no Validator. Como o `CanonicalRecord` é um formato
 * interno — distinto do formato do bundle e distinto do formato de um CSV — um adaptador
 * novo só precisa de produzir isto.
 */
export interface CanonicalRecord {
  readonly kind: RecordKind;
  readonly localId: string;
  /** Ficheiro do bundle de onde o registo veio, para localizar problemas. */
  readonly file?: string;
  /** Linha do `.jsonl`, para localizar problemas. */
  readonly line?: number;
  /** Campos já normalizados pelo Normalizer, prontos para validação de regras. */
  readonly fields: Readonly<Record<string, unknown>>;
  /** Referências para outros `localId`. Validadas contra o conjunto completo. */
  readonly references: Readonly<Record<string, string | null | undefined>>;
  /** `externalIds` transportados, quando existem (§2.3). */
  readonly externalIds?: ReadonlyArray<{ source: string; id: string }>;
}

/** Um registo acompanhado do seu resultado de validação. */
export interface ValidatedRecord {
  readonly record: CanonicalRecord;
  readonly quality: RecordQuality;
  readonly issues: readonly ImportIssue[];
}

/** Resultado da validação de um conjunto de registos. */
export interface ValidationResult {
  readonly records: readonly ValidatedRecord[];
  readonly issues: readonly ImportIssue[];
  /**
   * `true` quando existe pelo menos um problema bloqueante. Nesse caso a importação não
   * avança — nem parcialmente (§9.1, §9.4).
   */
  readonly blocked: boolean;
}

/* -------------------------------------------------------------------------- */
/* Construção de problemas                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Cria um problema localizado.
 *
 * Uma função e não um objeto literal em cada sítio, por duas razões: garante que nenhum
 * problema fica sem mensagem legível — um problema sem descrição não é acionável (§9.2) —
 * e permite que o `localId`, o ficheiro e a linha sejam preenchidos a partir do registo
 * em vez de repetidos à mão, que é onde se introduzem erros de localização.
 */
export function issue(
  severity: IssueSeverity,
  code: string,
  message: string,
  context: {
    localId?: string;
    field?: string;
    file?: string;
    line?: number;
  } = {},
): ImportIssue {
  return {
    severity,
    code,
    message,
    ...(context.localId ? { localId: context.localId } : {}),
    ...(context.field ? { field: context.field } : {}),
    ...(context.file ? { file: context.file } : {}),
    ...(context.line !== undefined ? { line: context.line } : {}),
  };
}

/** Problema que impede a importação de avançar. */
export function blocking(
  code: string,
  message: string,
  context: Parameters<typeof issue>[3] = {},
): ImportIssue {
  return issue('blocking', code, message, context);
}

/** Problema que o registo sobrevive, com a lacuna declarada. */
export function recoverable(
  code: string,
  message: string,
  context: Parameters<typeof issue>[3] = {},
): ImportIssue {
  return issue('recoverable', code, message, context);
}

/** Problema que não altera o resultado. */
export function informational(
  code: string,
  message: string,
  context: Parameters<typeof issue>[3] = {},
): ImportIssue {
  return issue('info', code, message, context);
}

/* -------------------------------------------------------------------------- */
/* Consistência interna do bundle (§13.4)                                      */
/* -------------------------------------------------------------------------- */

/**
 * Verifica a coerência entre o `bundleId` do manifest e os identificadores que o
 * acompanham.
 *
 * Não verifica **autenticidade** — um `bundleId` não é um segredo nem uma credencial. A
 * autorização vem do token de sessão, e a chave do livro de idempotência inclui sempre o
 * `userId`, pelo que um bundle forjado de outra conta não colide com nada (§13.4).
 */
export function validateBundleId(bundleId: unknown): ImportIssue | null {
  if (!isValidBundleId(bundleId)) {
    return blocking(
      'manifest.bundle_id_invalid',
      'Este ficheiro não traz um identificador de bundle válido. Pode estar corrompido ou ter sido editado.',
      { field: 'bundleId', file: 'manifest.json' },
    );
  }
  return null;
}

/**
 * Verifica que não há dois registos com o mesmo `localId`.
 *
 * Uma colisão é bloqueante porque torna as referências **ambíguas**: se `veh_1` designa
 * dois veículos, não é possível saber para qual aponta `vehicleLocalId: "veh_1"`. O
 * resultado de importar seria decidido pela ordem de chegada, que é precisamente o tipo
 * de não-determinismo que a §13.3 proíbe ("a ordem dos registos não altera o resultado").
 */
export function findDuplicateLocalIds(records: readonly CanonicalRecord[]): ImportIssue[] {
  const seen = new Map<string, CanonicalRecord>();
  const issues: ImportIssue[] = [];

  for (const record of records) {
    const previous = seen.get(record.localId);
    if (previous) {
      issues.push(
        blocking(
          'bundle.duplicate_local_id',
          `O identificador "${record.localId}" aparece mais do que uma vez neste ficheiro. Sem identificadores únicos não é possível saber a que registo as relações se referem.`,
          { localId: record.localId, file: record.file, line: record.line },
        ),
      );
      continue;
    }
    seen.set(record.localId, record);
  }

  return issues;
}

/* -------------------------------------------------------------------------- */
/* Referências quebradas (§9.4)                                                */
/* -------------------------------------------------------------------------- */

export interface BrokenReference {
  readonly record: CanonicalRecord;
  readonly field: string;
  readonly missingLocalId: string;
}

/**
 * Encontra referências para `localId` que não existem no bundle.
 *
 * Distingue **ausência** de **quebra**, e a distinção é essencial:
 *
 *  - uma referência `null` ou ausente é uma relação **opcional** não preenchida — uma
 *    carta de condução não tem veículo, uma despesa manual não tem registo ligado. Não é
 *    um problema;
 *  - uma referência **preenchida** que aponta para um `localId` inexistente é uma
 *    inconsistência interna do bundle.
 *
 * Confundir as duas faria com que todos os registos sem relação opcional fossem
 * reportados como quebrados, e o relatório deixaria de ser consultável — o mesmo defeito
 * que a §30 descreve para os logs de auditoria.
 */
export function findBrokenReferences(records: readonly CanonicalRecord[]): BrokenReference[] {
  const known = new Set(records.map((record) => record.localId));
  const broken: BrokenReference[] = [];

  for (const record of records) {
    for (const [field, target] of Object.entries(record.references)) {
      // Só uma referência preenchida pode estar quebrada.
      if (target === null || target === undefined) continue;
      if (typeof target !== 'string' || target.length === 0) continue;
      if (!known.has(target)) {
        broken.push({ record, field, missingLocalId: target });
      }
    }
  }

  return broken;
}

/**
 * Converte referências quebradas em problemas bloqueantes (§9.4).
 *
 * A mensagem diz **quantos** registos são afetados e **o que** falta, mas é escrita para
 * ser lida por uma pessoa. Um utilizador que vê "3 registos apontam para um veículo que
 * não existe neste ficheiro" sabe o que fazer; um que vê "referência inválida" não sabe.
 */
export function brokenReferenceIssues(broken: readonly BrokenReference[]): ImportIssue[] {
  return broken.map((item) =>
    blocking(
      'bundle.broken_reference',
      `Este registo refere "${item.missingLocalId}", que não existe neste ficheiro. Importar só esta parte deixaria dados incompletos na tua conta.`,
      {
        localId: item.record.localId,
        field: item.field,
        file: item.record.file,
        line: item.record.line,
      },
    ),
  );
}

/**
 * Verifica se uma referência opcional tem forma de `localId` válida.
 *
 * Uma referência com forma inválida — por exemplo `../x` — é bloqueante mesmo que o
 * alvo viesse a existir. Um `localId` inválido nunca pode ser um alvo legítimo, e deixá-lo
 * passar só adiaria a falha para o estágio de escrita.
 */
export function invalidReferenceFormatIssues(records: readonly CanonicalRecord[]): ImportIssue[] {
  const issues: ImportIssue[] = [];

  for (const record of records) {
    for (const [field, target] of Object.entries(record.references)) {
      if (target === null || target === undefined) continue;
      if (typeof target !== 'string' || target.length === 0) continue;
      if (!isValidLocalId(target)) {
        issues.push(
          blocking(
            'bundle.invalid_reference_format',
            `Uma relação deste registo aponta para um identificador inválido ("${target}").`,
            { localId: record.localId, field, file: record.file, line: record.line },
          ),
        );
      }
    }
  }

  return issues;
}

/**
 * Verifica que o `localId` de cada registo tem forma válida.
 *
 * Bloqueante, e não recuperável: o `localId` é o que liga os registos entre si e o que
 * alimenta o livro de idempotência. Um `localId` inválido compromete as duas funções —
 * e, por acabar num caminho de pasta para documentos (§5.6), tem também implicações de
 * segurança (§13.4).
 */
export function invalidLocalIdIssues(records: readonly CanonicalRecord[]): ImportIssue[] {
  return records
    .filter((record) => !isValidLocalId(record.localId))
    .map((record) =>
      blocking(
        'bundle.invalid_local_id',
        'Um registo deste ficheiro tem um identificador interno inválido e não pode ser importado com segurança.',
        { localId: String(record.localId).slice(0, 40), file: record.file, line: record.line },
      ),
    );
}

/* -------------------------------------------------------------------------- */
/* Regras por tipo de registo (§9.3)                                           */
/* -------------------------------------------------------------------------- */

/**
 * Campos obrigatórios por tipo de registo.
 *
 * Só os que tornam o registo **sem sentido** sem eles. A tentação é acrescentar muitos —
 * e cada campo obrigatório a mais transforma num erro bloqueante um dado que o Zemlo
 * aceitaria alegremente (§49, enriquecimento progressivo).
 *
 * ## A matrícula é a identidade mínima de um veículo
 *
 * `vehicle: ['plate']` é deliberado, e não o caso geral descrito acima. O README é
 * explícito — *"uma matrícula é suficiente para começar"* e *"Só a matrícula é
 * obrigatória para criar um veículo"*. A importação segue a **mesma regra do onboarding**:
 * um veículo importado tem de trazer matrícula utilizável.
 *
 * A §49 — "aceitar dados incompletos" — refere-se aos dados **complementares**: VIN,
 * combustível, bateria, potência, pneus, aquisição. `Kia EV3 · 42 381 km` é um veículo
 * válido porque está identificado pela matrícula, não porque a matrícula seja dispensável.
 * Sem matrícula não há identidade, e sem identidade o registo não pode ser comparado com
 * o que já existe — que é precisamente o que a §8 exige antes de escrever seja o que for.
 *
 * A ausência desta leitura é o que faz um veículo importado sem matrícula entrar em
 * quarentena, enquanto `vehiclePlausibilityIssues` classifica a mesma ausência como
 * informativa. As duas coisas são compatíveis: a plausibilidade descreve a **forma** do
 * valor (curta, estrangeira, atípica) e continua a ser informativa; a obrigatoriedade
 * decide se o registo **entra**. Ver A25 em `docs/DECISIONS.md`.
 */
const REQUIRED_FIELDS: Readonly<Record<RecordKind, readonly string[]>> = {
  vehicle: ['plate'],
  odometer: ['odometerKm', 'recordedAt'],
  expense: ['amountCents', 'date', 'category'],
  fuel: ['date', 'litres', 'amountCents'],
  charging: ['date', 'energyKwh', 'amountCents'],
  maintenance: ['date', 'type'],
  insurance: ['insurer', 'startDate', 'endDate'],
  inspection: ['date'],
  tax: ['year', 'amountCents'],
  document: ['name', 'category'],
  reminder: ['title'],
  event: ['type', 'date', 'title'],
  suggestion: ['key', 'type'],
  notification: ['topic', 'title', 'body'],
};

/**
 * Verifica presença de campos obrigatórios.
 *
 * Um campo **presente mas nulo** conta como ausente. A §5.3 diz que a ausência é
 * representada por omissão ou `null`; tratar `null` como preenchido faria com que um
 * registo com `"amountCents": null` passasse a validação e falhasse na escrita, longe da
 * causa.
 *
 * A ausência de um campo obrigatório é bloqueante (§9.1) — mas apenas nos registos
 * essenciais, e é por isso que a lista acima é curta.
 */
export function missingRequiredFieldIssues(record: CanonicalRecord): ImportIssue[] {
  const required = REQUIRED_FIELDS[record.kind] ?? [];
  const issues: ImportIssue[] = [];

  for (const field of required) {
    const value = record.fields[field];
    if (value === null || value === undefined || value === '') {
      issues.push(
        blocking('record.missing_required_field', `Falta um campo obrigatório: ${field}.`, {
          localId: record.localId,
          field,
          file: record.file,
          line: record.line,
        }),
      );
    }
  }

  return issues;
}

/**
 * Valores que o Zemlo aceita guardar mas que merecem ser **declarados** ao utilizador.
 *
 * Recuperáveis, nunca bloqueantes (§9.1): um valor negativo, uma data futura ou uma
 * quilometragem em falta entram — com a lacuna nomeada no relatório. Recusar estes
 * registos seria recusar dados reais; aceitá-los em silêncio seria esconder o problema.
 */
export function semanticIssues(record: CanonicalRecord): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const context = { localId: record.localId, file: record.file, line: record.line };
  const fields = record.fields;

  const amount = normalizeCentsForCompare(fields.amountCents as number | null | undefined);
  if (amount !== null && amount < 0) {
    issues.push(
      recoverable(
        'record.negative_amount',
        'Este registo tem um valor negativo. Vai entrar como está — confirma se é uma devolução ou um erro.',
        { ...context, field: 'amountCents' },
      ),
    );
  }

  const litres = normalizeLitresForCompare(fields.litres as number | null | undefined);
  if (litres !== null && litres <= 0) {
    issues.push(
      recoverable(
        'record.non_positive_litres',
        'Este abastecimento tem uma quantidade de litros que não é positiva.',
        { ...context, field: 'litres' },
      ),
    );
  }

  const energy = normalizeKwhForCompare(fields.energyKwh as number | null | undefined);
  if (energy !== null && energy <= 0) {
    issues.push(
      recoverable(
        'record.non_positive_energy',
        'Este carregamento tem uma energia que não é positiva.',
        { ...context, field: 'energyKwh' },
      ),
    );
  }

  const odometer = normalizeOdometerForCompare(fields.odometerKm as number | null | undefined);
  if (odometer !== null && odometer < 0) {
    issues.push(
      recoverable(
        'record.negative_odometer',
        'A quilometragem deste registo é negativa.',
        { ...context, field: 'odometerKm' },
      ),
    );
  }

  // Datas impossíveis ou implausíveis. Uma data no futuro distante é quase sempre um ano
  // mal introduzido, e vale a pena dizê-lo — mas o Zemlo aceita datas futuras legítimas
  // (um seguro que começa para o mês que vem), pelo que não é bloqueante.
  const date = normalizeCivilDateForCompare(fields.date as string | null | undefined);
  if (fields.date !== null && fields.date !== undefined && fields.date !== '' && date === null) {
    issues.push(
      recoverable(
        'record.unparseable_date',
        'Não foi possível interpretar a data deste registo. Vai entrar sem data.',
        { ...context, field: 'date' },
      ),
    );
  }

  return issues;
}

/* -------------------------------------------------------------------------- */
/* Documento sem ficheiro (§9.3)                                               */
/* -------------------------------------------------------------------------- */

/**
 * Avalia um documento cujo conteúdo não está disponível (§5.6, decisão 2).
 *
 * **Não bloqueante.** O registo é criado apenas com metadados e o relatório lista-o em
 * "documentos sem ficheiro", com ação para os adicionar depois.
 *
 * O que esta função impede é o oposto: que alguém trate a ausência como normal e a deixe
 * de reportar. A lacuna existe, é conhecida, e tem de chegar ao utilizador — é a decisão
 * explícita de que "não quero que esta limitação fique escondida".
 */
export function documentContentIssues(record: CanonicalRecord): ImportIssue[] {
  if (record.kind !== 'document') return [];

  const state = record.fields.contentState;
  const context = { localId: record.localId, file: record.file, line: record.line };

  if (state === 'missingContent') {
    return [
      recoverable(
        'document.content_missing',
        'Este documento não trouxe o ficheiro original. Vais poder adicioná-lo mais tarde, na página do documento.',
        { ...context, field: 'contentState' },
      ),
    ];
  }

  if (state === 'included') {
    // `included` sem caminho nem hash é uma contradição: o bundle afirma ter os bytes e
    // não diz onde estão nem como verificá-los.
    const path = record.fields.contentPath;
    const sha = record.fields.contentSha256;
    if (!path || !sha) {
      return [
        blocking(
          'document.content_path_missing',
          'Este documento diz trazer o ficheiro original, mas não traz o caminho ou o resumo que o identificam. O ficheiro pode estar corrompido.',
          { ...context, field: 'contentPath' },
        ),
      ];
    }
  }

  return [];
}

/* -------------------------------------------------------------------------- */
/* Validação de um conjunto completo                                           */
/* -------------------------------------------------------------------------- */

/**
 * Valida uma coleção de registos normalizados.
 *
 * ## Ordem das verificações, e porque importa
 *
 * As verificações **de conjunto** — `localId` duplicados, referências quebradas —
 * correm primeiro e sobre **todos** os registos, incluindo os que falharam regras
 * individuais. A razão é a §9.4: uma referência quebrada significa que o bundle está
 * inconsistente, e importar o resto na mesma produziria dados criados com o utilizador a
 * pensar que estavam todos.
 *
 * Se um registo falha um campo obrigatório e outro aponta para ele, o utilizador tem de
 * saber **as duas coisas** antes de decidir — não descobrir a segunda depois de resolver
 * a primeira.
 *
 * ## O que esta função não faz
 *
 * Não decide nada sobre duplicados (§8) e não escreve nada. Classifica e reporta. A
 * decisão sobre os duplicados prováveis pertence ao utilizador (§8.3), e a escrita
 * pertence ao estágio Transaction.
 */
export function validateRecords(records: readonly CanonicalRecord[]): ValidationResult {
  const issues: ImportIssue[] = [];

  /* ---- Problemas de conjunto, sobre todos os registos ---- */

  issues.push(...invalidLocalIdIssues(records));
  issues.push(...findDuplicateLocalIds(records));
  issues.push(...invalidReferenceFormatIssues(records));
  issues.push(...brokenReferenceIssues(findBrokenReferences(records)));

  /* ---- Problemas por registo ---- */

  const validated: ValidatedRecord[] = records.map((record) => {
    const recordIssues: ImportIssue[] = [
      ...missingRequiredFieldIssues(record),
      ...semanticIssues(record),
      ...documentContentIssues(record),
    ];

    return {
      record,
      quality: qualityFrom(recordIssues),
      issues: recordIssues,
    };
  });

  for (const entry of validated) issues.push(...entry.issues);

  return {
    records: validated,
    issues,
    // Uma referência quebrada ou um `localId` duplicado bloqueiam **o bundle inteiro**,
    // não apenas os registos afetados (§9.4).
    blocked: issues.some((item) => item.severity === 'blocking'),
  };
}

/**
 * Determina a qualidade de um registo a partir dos seus problemas (§9.2).
 *
 * A ausência de problemas é `complete`. Qualquer problema recuperável torna o registo
 * `partial` — entra, mas com uma lacuna que o relatório nomeia. Um problema bloqueante
 * põe o registo em `quarantined`: não entra sem uma decisão explícita.
 */
export function qualityFrom(issues: readonly ImportIssue[]): RecordQuality {
  if (issues.some((item) => item.severity === 'blocking')) return 'quarantined';
  if (issues.some((item) => item.severity === 'recoverable')) return 'partial';
  return 'complete';
}

/* -------------------------------------------------------------------------- */
/* Agregação, para o relatório (§9.2)                                          */
/* -------------------------------------------------------------------------- */

export interface IssueSummary {
  readonly blocking: number;
  readonly recoverable: number;
  readonly info: number;
  /** Contagem por código, para o relatório agrupar sem repetir milhares de mensagens. */
  readonly byCode: Readonly<Record<string, number>>;
}

/**
 * Agrega problemas por gravidade e por código.
 *
 * Numa importação de 8 000 registos, listar 400 mensagens iguais não é um relatório — é
 * ruído. Agrupar por código permite dizer *"412 registos com data ilegível"* e manter a
 * lista completa disponível para quem a queira examinar (§9.2).
 */
export function summarizeIssues(issues: readonly ImportIssue[]): IssueSummary {
  const byCode: Record<string, number> = {};
  let blocking = 0;
  let recoverable = 0;
  let info = 0;

  for (const item of issues) {
    byCode[item.code] = (byCode[item.code] ?? 0) + 1;
    if (item.severity === 'blocking') blocking += 1;
    else if (item.severity === 'recoverable') recoverable += 1;
    else info += 1;
  }

  return { blocking, recoverable, info, byCode };
}

/**
 * Verifica que um prefixo de `localId` corresponde ao tipo de registo.
 *
 * **Informativo apenas, e nunca bloqueante.** O formato do `localId` é opaco por
 * definição (§2.1) e o importador não o interpreta: um adaptador externo legítimo pode
 * usar identificadores que não seguem os nossos prefixos. Esta verificação existe para
 * diagnosticar um exportador nosso que esteja a numerar mal, não para julgar bundles
 * alheios — e é por isso que não pode recusar nada.
 */
export function localIdPrefixHint(record: CanonicalRecord): ImportIssue | null {
  const expected: Partial<Record<RecordKind, LocalIdPrefix>> = {
    vehicle: 'veh',
    odometer: 'odo',
    expense: 'exp',
    fuel: 'fuel',
    charging: 'chg',
    maintenance: 'mnt',
    insurance: 'ins',
    inspection: 'isp',
    tax: 'tax',
    document: 'doc',
    reminder: 'rem',
    event: 'evt',
    suggestion: 'sug',
    notification: 'ntf',
  };

  const prefix = expected[record.kind];
  if (!prefix) return null;
  if (record.localId.startsWith(`${prefix}_`)) return null;

  return informational(
    'bundle.unexpected_local_id_prefix',
    `O identificador deste registo não segue a convenção habitual do Zemlo para este tipo de dado.`,
    { localId: record.localId, file: record.file, line: record.line },
  );
}

/**
 * Verificações de plausibilidade de um veículo que valem um aviso informativo.
 *
 * Deliberadamente informativas e não recuperáveis: uma matrícula curta, ou ausente, é a
 * **norma** num onboarding por completar (§49). Tratá-las como problema tornaria o
 * relatório inútil no caso mais comum.
 *
 * ## Porque é que isto convive com a matrícula obrigatória
 *
 * Esta verificação descreve a **forma** do valor — se a matrícula é aproveitável como
 * chave de comparação. Não decide se o registo entra: essa decisão é de
 * `missingRequiredFieldIssues`, que trata a matrícula ausente como bloqueante (A25).
 *
 * As duas coexistem sem se contradizerem porque respondem a perguntas diferentes. Um
 * veículo com uma matrícula curta mas presente passa a obrigatoriedade e recebe este
 * aviso; um veículo sem matrícula nenhuma não passa a obrigatoriedade e é isso que o
 * relatório mostra em primeiro lugar. O aviso informativo nunca é a última palavra.
 */
export function vehiclePlausibilityIssues(record: CanonicalRecord): ImportIssue[] {
  if (record.kind !== 'vehicle') return [];
  const issues: ImportIssue[] = [];

  if (!hasUsablePlate(record.fields.plate as string | null | undefined)) {
    issues.push(
      informational(
        'vehicle.plate_missing_or_short',
        'Este veículo não tem uma matrícula utilizável. Vai entrar assim mesmo.',
        { localId: record.localId, field: 'plate', file: record.file, line: record.line },
      ),
    );
  }

  return issues;
}
