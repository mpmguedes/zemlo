/**
 * Dinheiro em cêntimos.
 *
 * Toda a API expõe e aceita montantes como **inteiros em cêntimos** (`amountCents`).
 * Nunca usar vírgula flutuante para dinheiro: somas de `0.1 + 0.2` produzem erros
 * que se acumulam em relatórios de custos (§23) e em exportações (§54).
 */

const CENTS_PER_UNIT = 100;

/** Converte um valor decimal (ex.: `184.5`) em cêntimos (`18450`), arredondando ao cêntimo. */
export function toCents(value: number): number {
  if (!Number.isFinite(value)) throw new TypeError(`Valor monetário inválido: ${value}`);
  // `Math.round` evita o viés de `Math.floor` em valores negativos (notas de crédito).
  return Math.round(value * CENTS_PER_UNIT);
}

/** Converte cêntimos num valor decimal. Apenas para apresentação. */
export function fromCents(cents: number): number {
  if (!Number.isInteger(cents)) throw new TypeError(`Cêntimos devem ser inteiros: ${cents}`);
  return cents / CENTS_PER_UNIT;
}

/** Aceita `12`, `"12,34"`, `"12.34"` ou `"12,34 €"` e devolve cêntimos. */
export function parseCents(input: string | number): number {
  if (typeof input === 'number') return toCents(input);
  const cleaned = input
    .replace(/\s/g, '')
    .replace(/€/g, '')
    .replace(/\.(?=\d{3}\b)/g, '')
    .replace(',', '.');
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) throw new TypeError(`Montante inválido: ${input}`);
  return toCents(parsed);
}

/** Soma montantes em cêntimos sem erros de vírgula flutuante. */
export function sumCents(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/**
 * Formata cêntimos em euros para apresentação em `pt-PT`.
 * Por omissão usa o espaço estreito como separador de milhares, como na especificação
 * (`2 291,90 €`). Em ambientes sem ICU completo há uma degradação controlada.
 */
export function formatCents(cents: number, options: { compact?: boolean; signed?: boolean } = {}): string {
  const value = fromCents(cents);
  let formatted: string;
  try {
    formatted = new Intl.NumberFormat('pt-PT', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: options.compact ? 0 : 2,
      maximumFractionDigits: options.compact ? 0 : 2,
    }).format(Math.abs(value));
  } catch {
    formatted = `${fromCents(Math.abs(cents)).toFixed(options.compact ? 0 : 2)} €`;
  }
  if (value < 0) return `-${formatted}`;
  if (options.signed && value > 0) return `+${formatted}`;
  return formatted;
}

/** Formata cêntimos sem símbolo de moeda (`2 291,90`). Para gráficos e tabelas densas. */
export function formatCentsPlain(cents: number, decimals = 2): string {
  try {
    return new Intl.NumberFormat('pt-PT', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(fromCents(cents));
  } catch {
    return fromCents(cents).toFixed(decimals);
  }
}

/**
 * Calcula uma percentagem segura: devolve `null` em vez de `Infinity`/`NaN`
 * quando o denominador é zero. Importante porque grande parte das estatísticas do
 * Zemlo é calculada sobre dados incompletos, que o produto aceita por design (§49).
 */
export function safeRatio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

/** Arredonda para `decimals` casas, devolvendo `null` quando não há valor. */
export function roundOrNull(value: number | null, decimals = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
