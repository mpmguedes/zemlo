/**
 * Datas e durações.
 *
 * Convenções do Zemlo:
 *  - Instantes (criação de registos, auditoria) são `Date`/ISO 8601 em UTC.
 *  - Datas civis (data de uma despesa, data de inspeção, validade de um documento)
 *    são strings `YYYY-MM-DD`. Uma despesa "de ontem" não tem fuso horário nem hora:
 *    guardá-la como instante produziria deslocamentos de um dia em relatórios (§23).
 */

/** Data civil no formato `YYYY-MM-DD`. */
export type CivilDate = string;

const MS_PER_DAY = 86_400_000;

/** Valida e normaliza `YYYY-MM-DD` (ou um `Date`) para data civil. */
export function toCivilDate(input: Date | string): CivilDate {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) throw new TypeError('Data inválida');
    return `${input.getUTCFullYear()}-${pad(input.getUTCMonth() + 1)}-${pad(input.getUTCDate())}`;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!match) throw new TypeError(`Data civil inválida (esperado YYYY-MM-DD): ${input}`);
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new TypeError(`Data civil inexistente: ${input}`);
  }
  return `${y}-${m}-${d}`;
}

/** `true` quando a string é uma data civil válida. */
export function isCivilDate(input: unknown): input is CivilDate {
  if (typeof input !== 'string') return false;
  try {
    toCivilDate(input);
    return true;
  } catch {
    return false;
  }
}

/** Converte uma data civil no instante UTC correspondente à meia-noite. */
export function civilDateToUtc(date: CivilDate): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Fuso horário usado quando o do utilizador não é utilizável.
 *
 * O Zemlo é um produto português e este é o fuso de referência da operação.
 */
export const DEFAULT_TIME_ZONE = 'Europe/Lisbon';

/**
 * `true` quando um identificador de fuso horário IANA é utilizável.
 *
 * Não existe uma lista fiável de fusos em JavaScript — a base de dados IANA muda com as
 * decisões políticas sobre fronteiras e horários de verão. A forma correta de validar é
 * pedir ao motor que o use: `Intl` aceita qualquer identificador que conheça e lança
 * `RangeError` para os que não conhece. É a única fonte de verdade disponível.
 */
export function isValidTimeZone(timeZone: string | null | undefined): boolean {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * "Hoje" segundo um fuso horário IANA.
 *
 * O Zemlo serve utilizadores em Portugal (`Europe/Lisbon`) mas suporta fuso por
 * utilizador, porque "hoje" determina se uma inspeção está em atraso.
 *
 * **Degradação controlada, e é isto que impede um defeito de se tornar permanente.** Um
 * fuso inválido guardado numa conta — por um cliente antigo, por um pedido manual, por um
 * erro de escrita antes de a validação existir — faria `Intl` lançar `RangeError` em cada
 * cálculo de "hoje". Como praticamente tudo no Zemlo depende de "hoje" (dashboard,
 * estatísticas, calendário, lembretes, alertas de validade, criação de registos), o
 * resultado era uma conta **permanentemente inutilizável**: 500 em quase todos os ecrãs,
 * sem forma de o utilizador se corrigir, porque até o pedido que corrigiria o problema
 * exige que "hoje" seja calculável.
 *
 * Cair para `Europe/Lisbon` é a escolha certa: mostra datas ligeiramente erradas a quem
 * esteja noutro fuso — um problema visível e corrigível — em vez de deixar a conta sem
 * funcionar. A validação de entrada (`contracts.ts`) impede que novos valores inválidos
 * cheguem à base de dados; este fallback trata dos que já lá estão.
 */
export function todayIn(timeZone = DEFAULT_TIME_ZONE, now: Date = new Date()): CivilDate {
  const safeZone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now);
}

/** Diferença em dias inteiros entre duas datas civis (`to - from`). */
export function daysBetween(from: CivilDate, to: CivilDate): number {
  return Math.round((civilDateToUtc(to).getTime() - civilDateToUtc(from).getTime()) / MS_PER_DAY);
}

/** Soma dias a uma data civil. */
export function addDays(date: CivilDate, days: number): CivilDate {
  const base = civilDateToUtc(date);
  return toCivilDate(new Date(base.getTime() + days * MS_PER_DAY));
}

/** Soma meses a uma data civil, fixando o dia no último dia do mês quando necessário. */
export function addMonths(date: CivilDate, months: number): CivilDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const targetMonthIndex = m - 1 + months;
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${targetYear}-${pad(normalizedMonth + 1)}-${pad(day)}`;
}

/** Soma anos a uma data civil. 29 de fevereiro passa a 28 em anos não bissextos. */
export function addYears(date: CivilDate, years: number): CivilDate {
  return addMonths(date, years * 12);
}

/** Início do mês de uma data civil. */
export function startOfMonth(date: CivilDate): CivilDate {
  return `${date.slice(0, 7)}-01`;
}

/** Fim do mês de uma data civil. */
export function endOfMonth(date: CivilDate): CivilDate {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${pad(m)}-${pad(lastDay)}`;
}

/** Início do ano civil. */
export function startOfYear(date: CivilDate): CivilDate {
  return `${date.slice(0, 4)}-01-01`;
}

/** Fim do ano civil. */
export function endOfYear(date: CivilDate): CivilDate {
  return `${date.slice(0, 4)}-12-31`;
}

/** ISO em UTC, sempre com milissegundos. Formato usado em toda a API. */
export function toIso(date: Date | string | number): string {
  return new Date(date).toISOString();
}

/**
 * Texto relativo curto em português para um número de dias.
 * Usado nos cartões de estado do dashboard (`63 dias`, `em atraso`).
 */
export function describeDays(days: number): string {
  if (days === 0) return 'hoje';
  if (days === 1) return 'amanhã';
  if (days === -1) return 'ontem';
  if (days > 0) return `em ${days} dias`;
  return `há ${Math.abs(days)} dias`;
}

/** Texto relativo para uma distância em quilómetros. */
export function describeKm(km: number): string {
  const rounded = Math.round(km);
  if (rounded === 0) return 'agora';
  if (rounded > 0) return `em ${formatKm(rounded)} km`;
  return `há ${formatKm(Math.abs(rounded))} km`;
}

/**
 * Lista de meses (`YYYY-MM`) entre duas datas civis, inclusive nas duas pontas.
 *
 * Devolver a lista completa — e não apenas os meses com dados — é o que permite
 * desenhar gráficos sem buracos e calcular médias mensais honestas (§23).
 */
export function monthsBetween(from: CivilDate, to: CivilDate): string[] {
  if (from > to) return [];
  const months: string[] = [];
  let cursor = from.slice(0, 7);
  const last = to.slice(0, 7);
  // Guarda contra um intervalo absurdo (ex.: 1900 → 2100) que geraria uma lista enorme.
  for (let guard = 0; guard < 1200; guard += 1) {
    months.push(cursor);
    if (cursor === last) break;
    const [year, month] = cursor.split('-').map(Number) as [number, number];
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    cursor = `${nextYear}-${pad(nextMonth)}`;
  }
  return months;
}

/** Número de meses completos entre duas datas civis. */
export function monthSpan(from: CivilDate, to: CivilDate): number {
  const [y1, m1] = from.split('-').map(Number) as [number, number];
  const [y2, m2] = to.split('-').map(Number) as [number, number];
  return (y2 - y1) * 12 + (m2 - m1);
}

/**
 * Variação percentual entre dois valores.
 *
 * Devolve `null` quando a base é zero: uma variação de infinito por cento não é
 * informação, é ruído, e apresentá-la ao utilizador seria alarmista (§59).
 */
export function percentageChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 10_000) / 100;
}

/** Ano civil de uma data civil, como número. */
export function yearOf(date: CivilDate): number {
  return Number(date.slice(0, 4));
}

/** Formata quilómetros com separador de milhares e espaço estreito (`42 381`). */
export function formatKm(km: number | null | undefined, decimals = 0): string {
  if (km === null || km === undefined || !Number.isFinite(km)) return '—';
  try {
    return new Intl.NumberFormat('pt-PT', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(km);
  } catch {
    return km.toFixed(decimals);
  }
}

/** Número genérico com casas decimais fixas, para gráficos e tabelas. */
export function formatNumber(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat('pt-PT', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  } catch {
    return value.toFixed(decimals);
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
