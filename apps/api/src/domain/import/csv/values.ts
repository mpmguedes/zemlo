/**
 * Interpretação de valores de CSV e as ambiguidades que exigem decisão (§10.4).
 *
 * Este módulo é puro: não toca em disco, rede, base de dados nem relógio. Recebe os
 * valores de uma coluna (mais o campo canónico a que a coluna foi mapeada) e devolve:
 *
 *  - os valores **interpretados** quando a interpretação é inequívoca;
 *  - uma **ambiguidade declarada** quando não é — com as interpretações possíveis e uma
 *    pré-visualização de cada uma.
 *
 * ## Porque é que isto não é uma função de parsing
 *
 * `parseCents("1.234,56")` devolve 1234.56 só porque a implementação assumiu a convenção
 * portuguesa. Nada no texto o diz. Para um ficheiro exportado de outro sistema, a mesma
 * string pode significar 1.23456 ou 123456. Uma função de parsing **não tem como** saber;
 * só o conjunto da coluna tem.
 *
 * Por isso a unidade de trabalho aqui é a **coluna**, não o valor: a decisão de separador
 * decimal toma-se uma vez, olhando para o padrão dominante de toda a coluna — exatamente o
 * que a §10.4 descreve. Fazer isto valor a valor produziria uma coluna com os dois
 * significados misturados, que é o pior resultado possível.
 *
 * ## As quatro ambiguidades da §10.4
 *
 *  1. **Datas ambíguas** (`03/04/2026`) — quando todos os valores de um dos campos são
 *     ≤ 12, as duas leituras são possíveis. Pré-visualização das duas.
 *  2. **Separador decimal** (`1.234,56` vs `1,234.56`) — deteta-se pelo padrão dominante
 *     e confirma-se.
 *  3. **Duas moedas na mesma coluna** — erro recuperável, com quarentena das linhas.
 *  4. **Uma coluna que pode ser duas coisas** (`Km/l`) — pergunta-se; "nenhuma" → ignora-se.
 */

import { isCivilDate, type CivilDate } from '@zemlo/shared';

/* -------------------------------------------------------------------------- */
/* Vocabulário                                                                 */
/* -------------------------------------------------------------------------- */

/** Códigos de ambiguidade. Cada um corresponde a um caso explícito da §10.4. */
export const AMBIGUITY_CODES = [
  'data_ambigua',
  'separador_decimal',
  'moedas_multiplas',
  'unidade_ambigua',
] as const;
export type AmbiguityCode = (typeof AMBIGUITY_CODES)[number];

/** Convenção de data escolhida. */
export type DateOrder = 'dia-mes' | 'mes-dia';

/** Convenção de separador decimal escolhida. */
export type DecimalStyle = 'virgula' | 'ponto';

/** Uma interpretação possível de um valor, para pré-visualização. */
export interface ValueInterpretation {
  /** Etiqueta legível da interpretação. */
  readonly label: string;
  /** O valor interpretado, na forma canónica do Zemlo. */
  readonly value: string | number | boolean;
  /** Valores de amostra tal como ficariam nesta interpretação. */
  readonly preview: readonly string[];
}

/** Uma ambiguidade declarada, com as suas interpretações. */
export interface ColumnAmbiguity {
  readonly code: AmbiguityCode;
  /** Campo canónico da coluna (o que o mapeamento propôs). */
  readonly field: string;
  /** Pergunta a fazer ao utilizador, em português, pronta a apresentar. */
  readonly question: string;
  /** Interpretações possíveis, para pré-visualização lado a lado. */
  readonly alternatives: readonly ValueInterpretation[];
  /**
   * Linhas afetadas. Para `moedas_multiplas` são as linhas a pôr em quarentena; para as
   * outras é vazio (a ambiguidade é da coluna, não da linha).
   */
  readonly affectedLines: readonly number[];
}

/** Resultado da interpretação de uma coluna. */
export interface ColumnInterpretation {
  readonly field: string;
  /** Ambiguidade a resolver, quando existe. */
  readonly ambiguity: ColumnAmbiguity | null;
  /**
   * Convenções aplicadas. Quando há ambiguidade, são a **hipótese preferida** — o
   * utilizador vê-as em pré-visualização e confirma ou troca.
   */
  readonly conventions: readonly AppliedConvention[];
  /**
   * Valores interpretados, por linha. Vazio quando há ambiguidade por resolver — nesse
   * caso só a pré-visualização está disponível, porque gravar um valor seria adivinhar.
   */
  readonly values: ReadonlyMap<number, string | number | boolean>;
  /** Problemas por linha (valor ilegível, moeda estranha), para o relatório. */
  readonly issues: readonly ValueIssue[];
}

/** Convenção aplicada a uma coluna. */
export interface AppliedConvention {
  readonly kind: 'data' | 'decimal' | 'moeda';
  readonly choice: string;
  readonly confidence: number;
}

/** Um problema num valor concreto. */
export interface ValueIssue {
  readonly line: number;
  readonly code: 'valor_ilegivel' | 'moeda_nao_suportada' | 'fora_de_intervalo';
  readonly message: string;
  /** O valor original, para o relatório poder mostrá-lo. */
  readonly raw: string;
}

/** Linha de entrada: número da linha + valor cru. */
export interface ValueRow {
  readonly line: number;
  readonly value: string;
}

export interface InterpretOptions {
  /**
   * Convenções já decididas (pelo utilizador ou por um mapa guardado). Quando presentes,
   * não há ambiguidade a declarar: aplicam-se.
   */
  readonly dateOrder?: DateOrder;
  readonly decimalStyle?: DecimalStyle;
  /** Interpretação escolhida para uma coluna ambígua de unidade. */
  readonly resolvedUnit?: string | null;
}

/* -------------------------------------------------------------------------- */
/* Campos que este módulo interpreta                                           */
/* -------------------------------------------------------------------------- */

/** Campos que são datas civis (ISO `YYYY-MM-DD` no modelo). */
const DATE_FIELDS = new Set([
  'date',
  'recordedAt',
  'dueDate',
  'startDate',
  'endDate',
  'expiresAt',
  'nextDate',
]);

/** Campos que são valores monetários em cêntimos. */
const MONEY_FIELDS = new Set([
  'amountCents',
  'vatCents',
  'premiumCents',
  'pricePerLitreCents',
  'pricePerKwhCents',
]);

/** Campos que são quantidades decimais. */
const DECIMAL_FIELDS = new Set([
  'litres',
  'energyKwh',
  'startSocPercent',
  'endSocPercent',
  'latitude',
  'longitude',
]);

/** Campos que são inteiros simples. */
const INTEGER_FIELDS = new Set(['odometerKm', 'year', 'durationMinutes', 'dueOdometerKm', 'nextOdometerKm', 'sizeBytes']);

/** Campos que são booleanos. */
const BOOLEAN_FIELDS = new Set(['paid', 'fullTank', 'isPublic', 'isCorrection']);

/** True quando o campo é uma data civil. */
export function isDateField(field: string): boolean {
  return DATE_FIELDS.has(field);
}

/** True quando o campo é um valor monetário. */
export function isMoneyField(field: string): boolean {
  return MONEY_FIELDS.has(field);
}

/* -------------------------------------------------------------------------- */
/* Interpretação de uma coluna                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Interpreta uma coluna completa.
 *
 * A ordem das decisões importa: primeiro resolve-se o tipo (data, dinheiro, quantidade),
 * e só depois se procura ambiguidade dentro desse tipo. Um valor que não é do tipo do
 * campo é reportado como problema da linha, não como ambiguidade — são coisas diferentes.
 */
export function interpretColumn(
  field: string,
  rows: readonly ValueRow[],
  options: InterpretOptions = {},
): ColumnInterpretation {
  if (isDateField(field)) return interpretDateColumn(field, rows, options);
  if (isMoneyField(field)) return interpretMoneyColumn(field, rows, options);
  if (DECIMAL_FIELDS.has(field)) return interpretDecimalColumn(field, rows, options);
  if (INTEGER_FIELDS.has(field)) return interpretIntegerColumn(field, rows);
  if (BOOLEAN_FIELDS.has(field)) return interpretBooleanColumn(field, rows);
  return interpretTextColumn(field, rows);
}

/* -------------------------------------------------------------------------- */
/* Datas (§10.4, primeiro caso)                                                 */
/* -------------------------------------------------------------------------- */

/** Formatos de data aceites, com ou sem hora, já com o separador normalizado. */
const DATE_PATTERNS: readonly RegExp[] = [
  /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
  /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/,
  /^(\d{4})-(\d{1,2})-(\d{1,2})[T ].*$/,
];

/**
 * Interpreta uma coluna de datas.
 *
 * A ambiguidade nasce de uma assimetria real: `2026-04-03` (ISO) é inequívoco, mas
 * `03/04/2026` não é — pode ser 3 de abril ou 4 de março. A §10.4 dá o critério: se
 * **todos** os valores de um dos campos forem ≤ 12, pergunta-se. Se algum valor tiver o
 * primeiro componente > 12, esse valor prova que o primeiro componente é o dia, e a
 * convenção fica determinada sem perguntar nada.
 *
 * Casos particulares tratados deliberadamente:
 *  - ISO (`YYYY-MM-DD`) nunca é ambíguo e resolve a coluna sozinho;
 *  - um ficheiro só com datas ISO e datas portuguesas é aceite (mistura é comum em
 *    exportações parciais), sem ambiguidade;
 *  - `31/02/2026` é uma data inválida em qualquer leitura: problema da linha.
 */
function interpretDateColumn(
  field: string,
  rows: readonly ValueRow[],
  options: InterpretOptions,
): ColumnInterpretation {
  const issues: ValueIssue[] = [];
  const values = new Map<number, string | number | boolean>();

  const parsed: { line: number; raw: string; day?: number; month?: number; year?: number; iso?: CivilDate }[] = [];

  for (const row of rows) {
    const raw = row.value.trim();
    if (raw === '') continue;

    const iso = tryIsoDate(raw);
    if (iso) {
      parsed.push({ line: row.line, raw, iso });
      continue;
    }

    const parts = tryDayMonthYear(raw);
    if (parts) {
      parsed.push({ line: row.line, raw, ...parts });
      continue;
    }

    issues.push({
      line: row.line,
      code: 'valor_ilegivel',
      message: `"${raw}" não é uma data reconhecida.`,
      raw,
    });
  }

  const withIso = parsed.filter((p) => p.iso !== undefined);
  const withParts = parsed.filter((p) => p.day !== undefined || p.month !== undefined);

  if (withParts.length === 0) {
    // Só ISO (ou nada): sem ambiguidade possível.
    for (const entry of withIso) {
      if (entry.iso) values.set(entry.line, entry.iso);
    }
    return {
      field,
      ambiguity: null,
      conventions: withIso.length > 0 ? [{ kind: 'data', choice: 'iso', confidence: 1 }] : [],
      values,
      issues,
    };
  }

  // A evidência que resolve: qualquer valor com primeiro componente > 12 prova que o
  // primeiro componente é o dia (não pode ser mês).
  const provesDayFirst = withParts.some((p) => (p.day ?? 0) > 12);
  // Qualquer valor com segundo componente > 12 prova que o primeiro é o mês.
  const provesMonthFirst = withParts.some((p) => (p.month ?? 0) > 12);

  if (options.dateOrder) {
    return finishDateColumn(field, parsed, withIso, issues, options.dateOrder, 1);
  }

  if (provesDayFirst && !provesMonthFirst) {
    return finishDateColumn(field, parsed, withIso, issues, 'dia-mes', 0.98);
  }

  if (provesMonthFirst && !provesDayFirst) {
    return finishDateColumn(field, parsed, withIso, issues, 'mes-dia', 0.98);
  }

  if (provesDayFirst && provesMonthFirst) {
    // Contradição: nenhuma convenção explica a coluna inteira. Isto não é ambiguidade,
    // é um problema de dados — algumas linhas estão num formato e outras noutro.
    issues.push({
      line: withParts[0]?.line ?? 0,
      code: 'valor_ilegivel',
      message:
        'A coluna mistura datas que só fazem sentido em formatos diferentes; verifica o formato de origem.',
      raw: withParts.map((p) => p.raw).join(', '),
    });
    return {
      field,
      ambiguity: null,
      conventions: [],
      values,
      issues,
    };
  }

  // Ambiguidade genuína: todos os valores têm os dois componentes ≤ 12.
  const alternatives = buildDateAlternatives(withParts);
  return {
    field,
    ambiguity: {
      code: 'data_ambigua',
      field,
      question: `As datas desta coluna podem ser dia/mês ou mês/dia. Qual é a ordem correta?`,
      alternatives,
      affectedLines: [],
    },
    conventions: [
      { kind: 'data', choice: 'dia-mes', confidence: 0.5 },
      { kind: 'data', choice: 'mes-dia', confidence: 0.5 },
    ],
    // Sem valores: gravar uma das duas leituras seria adivinhar.
    values,
    issues,
  };
}

/** Termina a interpretação de uma coluna de datas com uma ordem decidida. */
function finishDateColumn(
  field: string,
  parsed: readonly { line: number; raw: string; day?: number; month?: number; year?: number; iso?: CivilDate }[],
  withIso: readonly { line: number; raw: string; iso?: CivilDate }[],
  issues: readonly ValueIssue[],
  order: DateOrder,
  confidence: number,
): ColumnInterpretation {
  const values = new Map<number, string | number | boolean>();
  const localIssues = [...issues];

  for (const entry of withIso) {
    if (entry.iso) values.set(entry.line, entry.iso);
  }

  for (const entry of parsed) {
    if (entry.iso) continue;
    const day = order === 'dia-mes' ? entry.day : entry.month;
    const month = order === 'dia-mes' ? entry.month : entry.day;
    if (day === undefined || month === undefined || entry.year === undefined) continue;

    const civil = buildCivilDate(entry.year, month, day);
    if (!civil) {
      localIssues.push({
        line: entry.line,
        code: 'valor_ilegivel',
        message: `"${entry.raw}" não é uma data válida na ordem ${order === 'dia-mes' ? 'dia/mês' : 'mês/dia'}.`,
        raw: entry.raw,
      });
      continue;
    }
    values.set(entry.line, civil);
  }

  return {
    field,
    ambiguity: null,
    conventions: [{ kind: 'data', choice: order, confidence }],
    values,
    issues: localIssues,
  };
}

/** Tenta ler uma data ISO. */
function tryIsoDate(raw: string): CivilDate | null {
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(raw);
  if (!isoMatch) return null;
  const [, y, m, d] = isoMatch;
  return buildCivilDate(Number(y), Number(m), Number(d));
}

/** Tenta ler uma data nos formatos com separador, devolvendo os componentes crus. */
function tryDayMonthYear(raw: string): { day: number; month: number; year: number } | null {
  for (const pattern of DATE_PATTERNS) {
    const match = pattern.exec(raw);
    if (!match) continue;
    const [, a, b, c] = match;
    if (a === undefined || b === undefined || c === undefined) continue;

    // O primeiro formato já foi tratado por tryIsoDate; os restantes têm ano no fim.
    const first = Number(a);
    const second = Number(b);
    let year = Number(c);
    if (c.length === 2) year += year >= 70 ? 1900 : 2000;
    return { day: first, month: second, year };
  }
  return null;
}

/** Constrói uma data civil validando o calendário. */
function buildCivilDate(year: number, month: number, day: number): CivilDate | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const padded = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (!isCivilDate(padded)) return null;
  // `isCivilDate` aceita 2026-02-31? Verificamos o calendário real comparando de volta.
  const date = new Date(`${padded}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return padded as CivilDate;
}

/** Constrói as duas leituras possíveis de uma coluna de datas ambíguas. */
function buildDateAlternatives(
  parsed: readonly { raw: string; day?: number; month?: number; year?: number }[],
): readonly ValueInterpretation[] {
  const preview = (order: DateOrder): string[] =>
    parsed.slice(0, 3).map((entry) => {
      const day = order === 'dia-mes' ? entry.day : entry.month;
      const month = order === 'dia-mes' ? entry.month : entry.day;
      const civil = buildCivilDate(entry.year ?? 2026, month ?? 1, day ?? 1);
      return civil ?? entry.raw;
    });

  return [
    {
      label: 'Dia/mês/ano (3 de abril)',
      value: 'dia-mes',
      preview: preview('dia-mes'),
    },
    {
      label: 'Mês/dia/ano (4 de março)',
      value: 'mes-dia',
      preview: preview('mes-dia'),
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Dinheiro (§10.4, segundo e terceiro casos)                                   */
/* -------------------------------------------------------------------------- */

/** Símbolos de moeda reconhecidos, com o código ISO correspondente. */
const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  '€': 'EUR',
  eur: 'EUR',
  euro: 'EUR',
  euros: 'EUR',
  $: 'USD',
  usd: 'USD',
  '£': 'GBP',
  gbp: 'GBP',
  r$: 'BRL',
  brl: 'BRL',
  chf: 'CHF',
  '¥': 'JPY',
};

/**
 * Interpreta uma coluna de valores monetários.
 *
 * Duas ambiguidades possíveis, e a ordem de deteção importa:
 *
 *  1. **Moeda** — se aparecerem símbolos de moedas diferentes, é um erro recuperável: as
 *     linhas afetadas vão para quarentena (§10.4). Não se pergunta qual é a moeda: as
 *     linhas de moeda diferente é que estão erradas no ficheiro de origem.
 *     Quando a moeda é uniforme mas não é EUR, o Zemlo avisa e trata o valor como EUR —
 *     o produto é português e não converte câmbios (§15); converter seria inventar uma
 *     taxa que o ficheiro não tem.
 *
 *  2. **Separador decimal** — `1.234,56` contra `1,234.56`. Decide-se pelo padrão
 *     **dominante da coluna**: quantos valores têm o padrão português contra o anglo-saxónico.
 *     Em empate ou quando nenhum padrão aparece, assume-se o português (o mercado do
 *     produto) e declara-se a ambiguidade para confirmação.
 */
function interpretMoneyColumn(
  field: string,
  rows: readonly ValueRow[],
  options: InterpretOptions,
): ColumnInterpretation {
  const issues: ValueIssue[] = [];
  const entries: { line: number; raw: string; currency: string; numeric: string }[] = [];

  for (const row of rows) {
    const raw = row.value.trim();
    if (raw === '') continue;

    const extracted = extractCurrency(raw);
    if (extracted.unsupported) {
      issues.push({
        line: row.line,
        code: 'moeda_nao_suportada',
        message: `"${raw}" usa uma moeda que o Zemlo não reconhece.`,
        raw,
      });
      continue;
    }

    const numeric = extracted.numeric;
    if (numeric === '' || !/\d/.test(numeric)) {
      // Sem um único dígito não há montante. Antes isto era ignorado em silêncio —
      // a linha desaparecia da importação sem ninguém saber. É exatamente o tipo de
      // lacuna não declarada que a §9.2 proíbe.
      issues.push({
        line: row.line,
        code: 'valor_ilegivel',
        message: `"${raw}" não é um montante legível.`,
        raw,
      });
      continue;
    }
    if (!/^[\d.,\s-]+$/.test(numeric)) {
      issues.push({
        line: row.line,
        code: 'valor_ilegivel',
        message: `"${raw}" não é um montante legível.`,
        raw,
      });
      continue;
    }

    entries.push({ line: row.line, raw, currency: extracted.currency ?? 'EUR', numeric });
  }

  const currencies = new Set(entries.map((e) => e.currency));
  if (currencies.size > 1) {
    // Duas moedas na mesma coluna: quarentena das linhas da moeda minoritária.
    const counts = new Map<string, number>();
    for (const entry of entries) counts.set(entry.currency, (counts.get(entry.currency) ?? 0) + 1);

    let dominant = 'EUR';
    let best = -1;
    for (const [currency, count] of counts) {
      if (count > best) {
        dominant = currency;
        best = count;
      }
    }

    const affectedLines = entries.filter((e) => e.currency !== dominant).map((e) => e.line);

    return {
      field,
      ambiguity: {
        code: 'moedas_multiplas',
        field,
        question: `Esta coluna tem valores em mais do que uma moeda (${[...currencies].join(', ')}). As linhas em moeda diferente não podem ser importadas como estão.`,
        alternatives: [
          {
            label: `Importar apenas as linhas em ${dominant}`,
            value: dominant,
            preview: entries
              .filter((e) => e.currency === dominant)
              .slice(0, 3)
              .map((e) => e.raw),
          },
          {
            label: 'Corrigir o ficheiro e voltar a tentar',
            value: 'corrigir',
            preview: [],
          },
        ],
        affectedLines,
      },
      conventions: [{ kind: 'moeda', choice: dominant, confidence: 0.8 }],
      values: new Map(),
      issues,
    };
  }

  // Separador decimal: padrão dominante da coluna.
  const detection = detectDecimalStyle(entries.map((e) => e.numeric));

  const chosen = options.decimalStyle ?? detection.style;
  const values = new Map<number, string | number | boolean>();

  for (const entry of entries) {
    const cents = parseMoneyToCents(entry.numeric, chosen);
    if (cents === null) {
      issues.push({
        line: entry.line,
        code: 'valor_ilegivel',
        message: `"${entry.raw}" não é um montante legível.`,
        raw: entry.raw,
      });
      continue;
    }
    values.set(entry.line, cents);
  }

  const ambiguity =
    options.decimalStyle !== undefined || !detection.ambiguous
      ? null
      : {
          code: 'separador_decimal' as const,
          field,
          question:
            'Não é possível saber se o ponto é separador de milhares ou decimal. Qual é a leitura correta?',
          alternatives: buildDecimalAlternatives(entries),
          affectedLines: [],
        };

  return {
    field,
    ambiguity,
    conventions: [
      {
        kind: 'decimal',
        choice: chosen,
        confidence: options.decimalStyle ? 1 : detection.confidence,
      },
    ],
    values: ambiguity ? new Map() : values,
    issues,
  };
}

/** Extrai o símbolo de moeda e o texto numérico de um valor. */
function extractCurrency(raw: string): { numeric: string; currency: string | null; unsupported: boolean } {
  const lower = raw.toLowerCase();
  let currency: string | null = null;
  let unsupported = false;

  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (lower.includes(symbol)) {
      currency = code;
      break;
    }
  }

  // Símbolo de moeda presente mas desconhecido (ex.: kr, zł).
  if (currency === null && /[^\d.,\s€$£¥-]/.test(raw.replace(/[a-zçãõáéíóúâêôà]/gi, ''))) {
    const letters = raw.replace(/[\d.,\s€$£¥-]/g, '').trim();
    if (letters !== '' && !Object.keys(CURRENCY_SYMBOLS).includes(letters.toLowerCase())) {
      unsupported = true;
    }
  }

  const numeric = raw
    .replace(/[€$£¥]/g, '')
    .replace(/[a-z]{3}/gi, '')
    .replace(/[a-záéíóúâêôãõç]/gi, '')
    .trim();

  return { numeric, currency, unsupported };
}

interface DecimalDetection {
  readonly style: DecimalStyle;
  readonly confidence: number;
  readonly ambiguous: boolean;
  readonly portugueseVotes: number;
  readonly angloVotes: number;
}

/**
 * Deteta o separador decimal pelo padrão dominante da coluna (§10.4).
 *
 * Vota por padrão estrutural, não por presença de caráter:
 *  - `1.234,56` (ponto de milhares + vírgula decimal) → voto português, forte;
 *  - `1,234.56` (vírgula de milhares + ponto decimal) → voto anglo, forte;
 *  - `12,50` (só vírgula, dois dígitos) → voto português;
 *  - `12.50` (só ponto, dois dígitos) → voto anglo;
 *  - `1234` → não vota (não diz nada);
 *  - `1,234` (vírgula + três dígitos) → **ambíguo**: pode ser 1,234 (mil e duzentos e
 *    trinta e quatro) ou 1.234 (mil duzentos e trinta e quatro). Não vota a favor de
 *    nenhum; contribui para a incerteza.
 */
function detectDecimalStyle(values: readonly string[]): DecimalDetection {
  let portugueseVotes = 0;
  let angloVotes = 0;
  let ambiguousPatterns = 0;

  for (const value of values) {
    const cleaned = value.replace(/\s/g, '');
    if (cleaned === '' || !/\d/.test(cleaned)) continue;

    const hasDot = cleaned.includes('.');
    const hasComma = cleaned.includes(',');

    if (hasDot && hasComma) {
      // Os dois presentes: o último é o decimal.
      if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) portugueseVotes += 1;
      else angloVotes += 1;
      continue;
    }

    if (hasComma) {
      const decimals = cleaned.split(',')[1] ?? '';
      if (decimals.length === 2) portugueseVotes += 1;
      else if (decimals.length === 3) ambiguousPatterns += 1;
      continue;
    }

    if (hasDot) {
      const decimals = cleaned.split('.')[1] ?? '';
      if (decimals.length === 2) angloVotes += 1;
      else if (decimals.length === 3) ambiguousPatterns += 1;
      continue;
    }

    // Sem separadores: não vota.
  }

  const total = portugueseVotes + angloVotes;

  if (total === 0) {
    return {
      style: 'virgula',
      confidence: 0.4,
      ambiguous: ambiguousPatterns > 0,
      portugueseVotes,
      angloVotes,
    };
  }

  if (portugueseVotes === angloVotes) {
    return { style: 'virgula', confidence: 0.5, ambiguous: true, portugueseVotes, angloVotes };
  }

  const portuguese = portugueseVotes > angloVotes;
  const winner = Math.max(portugueseVotes, angloVotes);
  return {
    style: portuguese ? 'virgula' : 'ponto',
    confidence: Math.min(0.98, 0.6 + (winner / total) * 0.38),
    ambiguous: false,
    portugueseVotes,
    angloVotes,
  };
}

/** Constrói as duas leituras possíveis de uma coluna com separador incerto. */
function buildDecimalAlternatives(
  entries: readonly { raw: string }[],
): readonly ValueInterpretation[] {
  const preview = entries.slice(0, 3).map((e) => e.raw);
  return [
    {
      label: 'Separador decimal é a vírgula (1.234,56 = mil duzentos e trinta e quatro)',
      value: 'virgula',
      preview,
    },
    {
      label: 'Separador decimal é o ponto (1,234.56 = mil duzentos e trinta e quatro)',
      value: 'ponto',
      preview,
    },
  ];
}

/**
 * Converte um montante textual em cêntimos, segundo uma convenção de separador.
 *
 * Não reutiliza `parseCents` de `@zemlo/shared` porque essa função **assume** a convenção
 * portuguesa. Aqui a convenção é um parâmetro explícito, que é precisamente o ponto: a
 * mesma string produz resultados diferentes e é isso que estamos a decidir.
 */
function parseMoneyToCents(value: string, style: DecimalStyle): number | null {
  const cleaned = value.replace(/\s/g, '');
  if (cleaned === '') return null;

  let normalized: string;
  if (style === 'virgula') {
    // Pontos são separadores de milhares; a vírgula é decimal.
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    // Vírgulas são separadores de milhares; o ponto é decimal.
    normalized = cleaned.replace(/,/g, '');
  }

  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

/* -------------------------------------------------------------------------- */
/* Decimais, inteiros e booleanos                                              */
/* -------------------------------------------------------------------------- */

/**
 * Interpreta uma coluna de decimais (litros, kWh, percentagens, coordenadas).
 *
 * Aqui a ambiguidade é mais rara do que no dinheiro — não há símbolo de moeda a confundir —
 * mas existe, e pelo mesmo motivo: `1,234` tanto pode ser um litro e duzentos e trinta e
 * quatro mililitros como mil duzentos e trinta e quatro litros.
 */
function interpretDecimalColumn(
  field: string,
  rows: readonly ValueRow[],
  options: InterpretOptions,
): ColumnInterpretation {
  const issues: ValueIssue[] = [];
  const entries: { line: number; raw: string; numeric: string }[] = [];

  for (const row of rows) {
    const raw = row.value.trim();
    if (raw === '') continue;
    const numeric = raw.replace(/[^\d.,\s-]/g, '').trim();
    if (numeric === '' || !/\d/.test(numeric)) {
      issues.push({
        line: row.line,
        code: 'valor_ilegivel',
        message: `"${raw}" não é um número.`,
        raw,
      });
      continue;
    }
    entries.push({ line: row.line, raw, numeric });
  }

  const detection = detectDecimalStyle(entries.map((e) => e.numeric));
  const chosen = options.decimalStyle ?? detection.style;

  const values = new Map<number, string | number | boolean>();
  for (const entry of entries) {
    const parsed = parseDecimalToNumber(entry.numeric, chosen);
    if (parsed === null) {
      issues.push({
        line: entry.line,
        code: 'valor_ilegivel',
        message: `"${entry.raw}" não é um número legível.`,
        raw: entry.raw,
      });
      continue;
    }
    values.set(entry.line, parsed);
  }

  const ambiguity =
    options.decimalStyle !== undefined || !detection.ambiguous
      ? null
      : {
          code: 'separador_decimal' as const,
          field,
          question:
            'O separador decimal desta coluna é incerto. Qual é a leitura correta?',
          alternatives: buildDecimalAlternatives(entries),
          affectedLines: [],
        };

  return {
    field,
    ambiguity,
    conventions: [
      {
        kind: 'decimal',
        choice: chosen,
        confidence: options.decimalStyle ? 1 : detection.confidence,
      },
    ],
    values: ambiguity ? new Map() : values,
    issues,
  };
}

/** Converte um decimal textual em número, segundo a convenção. */
function parseDecimalToNumber(value: string, style: DecimalStyle): number | null {
  const cleaned = value.replace(/\s/g, '');
  const normalized =
    style === 'virgula' ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Interpreta uma coluna de inteiros (quilometragem, ano, minutos).
 *
 * Aceita separadores de milhares (`12 345`, `12.345`, `12,345`) porque quilometragens
 * escritas assim são a norma em Portugal, mas **rejeita casas decimais**: uma quilometragem
 * com decimais é um erro do ficheiro, não um valor a arredondar em silêncio.
 *
 * A implementação tem de distinguir "separador de milhares" de "vírgula decimal", e a
 * tentação de limitar a `replace(/[^\d]/g, '')` produz um erro grave: `125000,5` passaria a
 * `1250005`, dez vezes o valor real, sem qualquer aviso. É por isso que a validação é
 * estrutural, e não uma limpeza de caracteres.
 */
function interpretIntegerColumn(field: string, rows: readonly ValueRow[]): ColumnInterpretation {
  const issues: ValueIssue[] = [];
  const values = new Map<number, string | number | boolean>();

  for (const row of rows) {
    const raw = row.value.trim();
    if (raw === '') continue;

    const cleaned = raw.replace(/\s/g, '');

    // Um separador seguido de exatamente um ou dois dígitos é decimal, não milhares:
    // `125000,5` e `125000,50` são valores com decimais, e a coluna é de inteiros.
    if (/[.,]\d{1,2}$/.test(cleaned)) {
      issues.push({
        line: row.line,
        code: 'fora_de_intervalo',
        message: `"${raw}" tem casas decimais, mas este campo é um número inteiro.`,
        raw,
      });
      continue;
    }

    // Remove separadores de milhares (sempre seguidos de grupos de três dígitos).
    const normalized = cleaned.replace(/[.,](?=\d{3}\b)/g, '');

    if (!/^-?\d+$/.test(normalized)) {
      issues.push({
        line: row.line,
        code: 'valor_ilegivel',
        message: `"${raw}" não é um número inteiro.`,
        raw,
      });
      continue;
    }

    values.set(row.line, Number(normalized));
  }

  return {
    field,
    ambiguity: null,
    conventions: [],
    values,
    issues,
  };
}

/** Vocabulário de booleanos aceites em português e inglês. */
const TRUE_VALUES = new Set(['1', 'sim', 's', 'true', 'verdadeiro', 'yes', 'y', 'x', 'pago', 'cheio']);
const FALSE_VALUES = new Set(['0', 'não', 'nao', 'n', 'false', 'falso', 'no', 'não pago']);

function interpretBooleanColumn(field: string, rows: readonly ValueRow[]): ColumnInterpretation {
  const issues: ValueIssue[] = [];
  const values = new Map<number, string | number | boolean>();

  for (const row of rows) {
    const raw = row.value.trim();
    if (raw === '') continue;
    const lower = raw.toLowerCase();
    if (TRUE_VALUES.has(lower)) {
      values.set(row.line, true);
      continue;
    }
    if (FALSE_VALUES.has(lower)) {
      values.set(row.line, false);
      continue;
    }
    issues.push({
      line: row.line,
      code: 'valor_ilegivel',
      message: `"${raw}" não é um valor de sim/não reconhecido.`,
      raw,
    });
  }

  return { field, ambiguity: null, conventions: [], values, issues };
}

/** Campos livres: o valor é preservado como está. */
function interpretTextColumn(field: string, rows: readonly ValueRow[]): ColumnInterpretation {
  const values = new Map<number, string | number | boolean>();
  for (const row of rows) {
    const raw = row.value.trim();
    if (raw !== '') values.set(row.line, raw);
  }
  return { field, ambiguity: null, conventions: [], values, issues: [] };
}

/* -------------------------------------------------------------------------- */
/* Unidades ambíguas (§10.4, quarto caso)                                      */
/* -------------------------------------------------------------------------- */

/**
 * Colunas cujo nome sugere uma **razão** e não uma quantidade — o caso `Km/l` da §10.4.
 *
 * Uma razão pode ser lida em dois sentidos inversos (km por litro vs litros por 100 km), e
 * confundi-los inverte o significado sem mudar o número. Não há forma de o saber pelo
 * valor: `15` é plausível nas duas leituras. Por isso pergunta-se, sempre.
 */
export const AMBIGUOUS_RATIO_PATTERNS: readonly {
  readonly pattern: RegExp;
  readonly question: string;
  readonly alternatives: readonly { label: string; value: string }[];
}[] = [
  {
    pattern: /km\s*\/\s*(l|litro)|km\s*por\s*litro/i,
    question: 'A coluna "Km/l" é consumo em km por litro ou litros por 100 km?',
    alternatives: [
      { label: 'Quilómetros por litro (km/l)', value: 'km-por-litro' },
      { label: 'Litros por 100 km (l/100km)', value: 'litros-por-100km' },
      { label: 'Ignorar esta coluna', value: 'ignorar' },
    ],
  },
  {
    pattern: /l\s*\/\s*100|litros?\s*por\s*100/i,
    question: 'A coluna é litros por 100 km ou quilómetros por litro?',
    alternatives: [
      { label: 'Litros por 100 km (l/100km)', value: 'litros-por-100km' },
      { label: 'Quilómetros por litro (km/l)', value: 'km-por-litro' },
      { label: 'Ignorar esta coluna', value: 'ignorar' },
    ],
  },
];

/**
 * Deteta se o nome de uma coluna corresponde a uma razão ambígua.
 *
 * Chamada **depois** do mapeamento de sinónimos e independentemente dele: uma coluna
 * `Km/l` não corresponde a nenhum campo canónico (é uma razão derivada, não um dado que o
 * Zemlo guarde), e é exatamente por isso que precisa de pergunta própria em vez de cair em
 * `nao_mapeado` — cair em `nao_mapeado` seria silencioso e o utilizador não perceberia
 * porque é que os consumos não entraram.
 */
export function detectAmbiguousRatio(header: string): ColumnAmbiguity | null {
  for (const entry of AMBIGUOUS_RATIO_PATTERNS) {
    if (!entry.pattern.test(header)) continue;
    return {
      code: 'unidade_ambigua',
      field: '',
      question: entry.question,
      alternatives: entry.alternatives.map((alt) => ({
        label: alt.label,
        value: alt.value,
        preview: [],
      })),
      affectedLines: [],
    };
  }
  return null;
}
