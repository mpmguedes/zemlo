/**
 * Contrato do *import* de CSV (Camada 2, §10).
 *
 * ## Porque é que estes tipos vivem aqui e não em `@zemlo/shared`
 *
 * O `@zemlo/shared` é o contrato entre a API e **todos** os consumidores — hoje a web, amanhã
 * a app mobile. As formas abaixo descrevem o passo-a-passo de um ecrã (deteção, mapeamento com
 * candidatos, pré-visualização normalizada, plano) e nenhuma delas é um conceito de domínio
 * partilhado: são a *vista* que a API constrói para a Camada 2 ser confirmável.
 *
 * Enquanto forem só da web, declaradas aqui mantêm a fronteira honesta — se um dia a app
 * mobile precisar do mesmo fluxo, mudam-se para o pacote e há um único ficheiro de importações
 * a ajustar (é a mesma regra que `queryKeys.ts` já documenta).
 *
 * ## O que **não** está aqui
 *
 * - `records` — os registos canónicos que o `apply` vai escrever. A API **constrói-os** (é
 *   com eles que a escrita acontece) mas não os devolve no `preview`: o que a resposta traz é
 *   a `preview`, as primeiras linhas já normalizadas. A distinção importa a quem lê este
 *   ficheiro — a interface não envia registos para o servidor escrever, e não há forma de
 *   escrever algo que não esteja nos bytes do ficheiro.
 * - `error.details` — o envelope de erro expõe `code`, `message`, `fields` e `requestId`; os
 *   detalhes internos nunca chegam ao cliente (`core/errors.ts`).
 */

import type { RecordKind } from '@zemlo/shared';

/* -------------------------------------------------------------------------- */
/* Deteção (passos 1 e 2 da §10.2)                                             */
/* -------------------------------------------------------------------------- */

/** Problema sintático do ficheiro — aspas por fechar, linha com contagem irregular. */
export interface CsvSyntaxIssue {
  code: string;
  line?: number;
  column?: number;
  message: string;
}

/**
 * O que o sistema percebeu do ficheiro antes de o interpretar.
 *
 * `confidence` é o **mínimo** das três confianças (codificação, separador, cabeçalho) e não a
 * média: é o elo mais fraco que decide se vale a pena pedir confirmação ao utilizador. Uma
 * média esconderia uma codificação duvidosa atrás de um separador óbvio.
 */
export interface CsvDetection {
  encoding: string;
  encodingConfidence: number;
  /** `true` quando a codificação é uma hipótese e não uma certeza (ficheiro só-ASCII). */
  encodingUncertain: boolean;
  delimiter: string;
  delimiterLabel: string;
  delimiterConfidence: number;
  hasHeader: boolean;
  headers: string[];
  rowCount: number;
  physicalLineCount: number;
  confidence: number;
  issues: CsvSyntaxIssue[];
  /** Frases prontas a apresentar — a interface não as reconstroi. */
  reasons: string[];
}

/* -------------------------------------------------------------------------- */
/* Mapeamento (passos 3 e 4)                                                   */
/* -------------------------------------------------------------------------- */

/** O estado de cada coluna. É o vocabulário da §10.2 e não se substitui por sinónimos. */
export type ColumnState = 'confirmado' | 'sugerido' | 'ambiguo' | 'nao_mapeado';

/** Uma leitura possível para uma coluna, com a força da evidência que a suporta. */
export interface FieldCandidate {
  field: string;
  confidence: number;
  /** `exact` — o cabeçalho é o próprio nome do campo; `strong`/`weak` — sinónimo. */
  match: 'exact' | 'strong' | 'weak';
  /** `false` quando o campo não existe no vocabulário do tipo inferido. */
  compatibleWithKind: boolean;
}

export interface ColumnMapping {
  index: number;
  header: string;
  normalized: string;
  state: ColumnState;
  field: string | null;
  confidence: number;
  candidates: FieldCandidate[];
  /** Porque é que não foi possível decidir — já escrito para ser lido. */
  reason: string | null;
  /** Valores de exemplo da coluna, para o utilizador reconhecer o que está a mapear. */
  sample: string[];
}

/**
 * Uma leitura possível de um valor ambíguo, com os valores de amostra já calculados.
 *
 * A pré-visualização existe porque a §10.4 exige que a pergunta seja feita «com
 * pré-visualização das duas interpretações»: quem não sabe se o ficheiro vem de um Excel
 * português ou inglês sabe ainda menos se `1,589` são 159 cêntimos ou 1589.
 */
export interface ValueInterpretation {
  label: string;
  value: string;
  preview: string[];
}

/**
 * Uma ambiguidade de **valor** por resolver — o outro eixo da §10.4.
 *
 * `ambiguousColumns` cobre ambiguidades de **mapeamento** (a coluna «Km/l» pode ser dois
 * campos). Esta cobre o caso em que o mapeamento está certo e o valor é que tem mais do que
 * uma leitura: `03/04/2026` é 3 de abril ou 4 de março.
 *
 * A resposta a cada uma viaja de volta como `dateOrder` / `decimalStyle` — as mesmas
 * convenções que o mapa guardado persiste —, pelo que responder aqui e responder no seletor
 * de convenções são a mesma operação.
 */
export interface ColumnAmbiguity {
  code: 'data_ambigua' | 'separador_decimal' | 'moedas_multiplas' | 'unidade_ambigua';
  /** Campo canónico da coluna afetada. */
  field: string;
  /** Pergunta pronta a apresentar, já em português. */
  question: string;
  alternatives: ValueInterpretation[];
  /** Linhas afetadas. Vazio quando a ambiguidade é da coluna inteira. */
  affectedLines: number[];
}

/** O mapeamento, pronto a apresentar e a corrigir. */
export interface CsvMappingView {
  columns: ColumnMapping[];
  /** Colunas que exigem uma decisão antes de continuar. */
  ambiguousColumns: ColumnMapping[];
  unmappedColumns: ColumnMapping[];
  /** 0..1 — proporção de colunas resolvidas sem intervenção. */
  coverage: number;
  /** `true` quando se pode avançar sem decidir nada. */
  readyWithoutInput: boolean;
  requiredFields: string[];
  /** Ambiguidades de valor por resolver (§10.4). Ver `ColumnAmbiguity`. */
  valueAmbiguities: ColumnAmbiguity[];
}

/** Uma decisão sobre uma coluna: mapear a um campo, ou ignorá-la (`field: null`). */
export interface ColumnDecision {
  index: number;
  field: string | null;
}

/* -------------------------------------------------------------------------- */
/* Tipo de registo (passo 5 da §10.5)                                          */
/* -------------------------------------------------------------------------- */

export type InferenceState = 'inferido' | 'ambiguo' | 'insuficiente';

export interface KindInference {
  state: InferenceState;
  kind: RecordKind | null;
  confidence: number;
  alternatives: Array<{ kind: RecordKind; label: string; score: number }>;
  /** Explicação legível, pronta a apresentar. */
  reason: string;
}

/* -------------------------------------------------------------------------- */
/* Pré-visualização, problemas e plano (passos 5–7)                            */
/* -------------------------------------------------------------------------- */

/** Uma linha já normalizada — o que vai ser escrito, não o que está no ficheiro. */
export interface CsvRecordPreview {
  localId: string;
  line: number;
  kind: RecordKind;
  fields: Record<string, unknown>;
  /** Campos obrigatórios que ficarão vazios. Declarados, nunca escondidos (§9.2). */
  emptyFields: string[];
}

/** Uma linha ignorada, com o motivo — nunca em silêncio. */
export interface CsvSkippedRow {
  line: number;
  reason: string;
}

/** Um valor ilegível, com a coluna e o texto original. */
export interface CsvValueIssue {
  line: number;
  field: string;
  code: string;
  message: string;
  raw: string;
}

export type PlanState = 'ready' | 'blocked' | 'nothing-to-do';

export type PlanAction = 'create' | 'exact' | 'probable' | 'quarantined' | 'skipped';

export type ConflictKind = 'new' | 'duplicate' | 'enrich' | 'conflict';

export type IssueSeverity = 'blocking' | 'recoverable' | 'info';

export interface ImportIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  localId?: string;
  field?: string;
  file?: string;
  line?: number;
}

export interface IssueSummary {
  blocking: number;
  recoverable: number;
  info: number;
  byCode: Record<string, number>;
}

export interface PlanCounts {
  create: number;
  exact: number;
  probable: number;
  quarantined: number;
  skipped: number;
  total: number;
  enriching: number;
  conflicting: number;
  documentsMissingContent: number;
}

export interface PlanEntry {
  localId: string;
  kind: RecordKind;
  line?: number;
  action: PlanAction;
  conflict: ConflictKind;
  /** Registos existentes que coincidiram. Mais do que um é um sinal a mostrar. */
  matched: Array<{ localId: string; kind: string; label?: string }>;
  /** Razão legível, nunca um código técnico (§11.3). */
  reason?: string;
  enrichableFields: string[];
  conflictingFields: string[];
  issues: ImportIssue[];
}

/** O plano não traz `records` nem `byKind`: a interface mostra contagens e entradas. */
export interface ImportPlanView {
  state: PlanState;
  counts: PlanCounts;
  issueSummary: IssueSummary;
  issues: ImportIssue[];
  /** Limitado pelo servidor — a lista completa vive no relatório. */
  entries: PlanEntry[];
}

/* -------------------------------------------------------------------------- */
/* Mapa de colunas guardado (passo 9 da §10.2)                                 */
/* -------------------------------------------------------------------------- */

export interface SavedMapSummary {
  /** `true` quando o mapa veio de uma importação anterior deste mesmo formato. */
  reused: boolean;
  decisions: number;
  timesUsed: number;
  lastUsedAt: string;
  /** Colunas do ficheiro atual que o mapa guardado não cobre. */
  uncoveredColumns: string[];
  /** Cabeçalhos do mapa que já não existem no ficheiro. */
  unmatchedHeaders: string[];
  /** Cabeçalhos repetidos no ficheiro, que impedem uma tradução inequívoca. */
  ambiguousHeaders: string[];
}

/* -------------------------------------------------------------------------- */
/* Respostas da API                                                            */
/* -------------------------------------------------------------------------- */

/** `POST /import/csv/preview` — **nada foi escrito**. */
export interface CsvPreviewResponse {
  identity: { key: string; contentHash: string };
  detection: CsvDetection;
  mapping: CsvMappingView;
  inference: KindInference;
  /** Tipo efetivamente usado. `null` quando a inferência não decidiu. */
  kind: RecordKind | null;
  preview: CsvRecordPreview[];
  skipped: CsvSkippedRow[];
  valueIssues: CsvValueIssue[];
  /** Aviso quando nada pôde ser construído, com a causa mais provável. */
  emptyReason: string | null;
  savedMap: SavedMapSummary | null;
  plan: ImportPlanView;
}

/** `POST /import/csv/apply` — escreveu, e isto é o que aconteceu. */
export interface CsvApplyResponse {
  bundleId: string;
  applied: boolean;
  headline: string;
  summary: Record<string, unknown>;
  created: Array<{ kind: RecordKind; localId: string; id?: string }>;
  enriched: Array<{ kind: RecordKind; localId: string; id?: string }>;
  skipped: Array<{ kind: RecordKind; localId: string; reason?: string }>;
  batches: number;
  issues: ImportIssue[];
  /** O relatório em CSV, pronto a descarregar (§11.3). */
  csv: string;
  savedMap: SavedMapSummary | null;
}

/* -------------------------------------------------------------------------- */
/* Parâmetros do pedido                                                        */
/* -------------------------------------------------------------------------- */

export type DateOrder = 'dia-mes' | 'mes-dia';
export type DecimalStyle = 'virgula' | 'ponto';
export type ConflictPolicy = 'keep-existing' | 'prefer-incoming' | 'fill-empty' | 'manual';

/**
 * As opções que viajam na *query string*.
 *
 * A `query` e não o corpo porque o corpo **é** o CSV — enviar o ficheiro em JSON obrigaria a
 * uma codificação (base64 ou lista de linhas) que multiplicaria o tamanho do pedido e
 * perderia a noção de "estes são os bytes originais", que é o que a identidade do ficheiro
 * (`sha256`) protege.
 */
export interface CsvImportParams {
  kind?: RecordKind;
  decisions?: ColumnDecision[];
  dateOrder?: DateOrder;
  decimalStyle?: DecimalStyle;
  conflictPolicy?: ConflictPolicy;
  /** Confrontado com a identidade dos bytes; divergir é 409. */
  identity?: string;
}
