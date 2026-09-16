import {
  addDays,
  civilDateToUtc,
  daysBetween,
  formatCents,
  formatKm,
  formatNumber,
  todayIn,
  type CivilDate,
} from '@zemlo/shared';

/**
 * Apresentação de unidades em português.
 *
 * Tudo o que formata dinheiro, distância ou datas vem de `@zemlo/shared`. Este ficheiro não
 * redefine essas regras — acrescenta apenas as apresentações que o produto usa e que não
 * pertencem ao domínio partilhado: valores instantâneos, diferenças relativas e rótulos
 * de contexto que só existem na interface.
 *
 * Um `toFixed` escrito à mão num ecrã seria o primeiro passo para a interface e a API
 * discordarem sobre o valor de um euro.
 */

/** Fuso por omissão do produto, quando o perfil ainda não chegou. */
export const DEFAULT_TIME_ZONE = 'Europe/Lisbon';

export function today(timeZone = DEFAULT_TIME_ZONE): CivilDate {
  return todayIn(timeZone);
}

/** Moeda: `2 291,90 €`. */
export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return formatCents(cents);
}

/** Moeda compacta para gráficos e cartões densos: `2 292 €`. */
export function moneyCompact(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return formatCents(cents, { compact: true });
}

/** Dinheiro com sinal explícito, para comparações de período. */
export function moneySigned(cents: number): string {
  return formatCents(cents, { signed: true });
}

/** Custo unitário em cêntimos que se lê em euros e cêntimos: `0,32 €/km`. */
export function unitMoney(cents: number | null | undefined, unit: string): string {
  if (cents === null || cents === undefined) return '—';
  return `${formatCents(cents)}/${unit}`;
}

/** Quilómetros: `43 560 km`. */
export function km(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined) return '—';
  return `${formatKm(value, decimals)} km`;
}

/** Litros: `65,10 L`. */
export function litres(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return '—';
  return `${formatNumber(value, decimals)} L`;
}

/** Energia: `49,30 kWh`. */
export function kwh(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return '—';
  return `${formatNumber(value, decimals)} kWh`;
}

/** Consumo de combustível: `5,86 L/100 km`. */
export function consumption(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return '—';
  return `${formatNumber(value, decimals)} L/100 km`;
}

/** Consumo elétrico: `15,41 kWh/100 km`. */
export function econsumption(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return '—';
  return `${formatNumber(value, decimals)} kWh/100 km`;
}

/** Percentagem: `58 %`. */
export function percent(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined) return '—';
  return `${formatNumber(value, decimals)} %`;
}

/** Fração (0–1) como percentagem: `0.58` → `58 %`. */
export function share(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined) return '—';
  return `${formatNumber(value * 100, decimals)} %`;
}

/* -------------------------------------------------------------------------- */
/* Datas                                                                       */
/* -------------------------------------------------------------------------- */

const DATE_FORMATTER = new Intl.DateTimeFormat('pt-PT', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat('pt-PT', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'UTC',
});

const MONTH_FORMATTER = new Intl.DateTimeFormat('pt-PT', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('pt-PT', { weekday: 'long', timeZone: 'UTC' });

/*
 * As datas civis (`YYYY-MM-DD`) são convertidas para o instante UTC de meia-noite antes de
 * serem formatadas, e todos os formatadores fixam `timeZone: 'UTC'`. Sem esta precaução,
 * uma despesa datada de 1 de setembro apareceria como 31 de agosto num browser a oeste de
 * Greenwich — um erro de um dia que passaria despercebido em Lisboa e apareceria a quem
 * viajasse.
 */

/** `16 set 2026`. */
export function dateLong(date: CivilDate | null | undefined): string {
  if (!date) return '—';
  return DATE_FORMATTER.format(civilDateToUtc(date));
}

/** `16/09`. */
export function dateShort(date: CivilDate | null | undefined): string {
  if (!date) return '—';
  return SHORT_DATE_FORMATTER.format(civilDateToUtc(date));
}

/** `setembro de 2026`. */
export function monthLong(date: CivilDate | null | undefined): string {
  if (!date) return '—';
  return MONTH_FORMATTER.format(civilDateToUtc(date));
}

/** `quarta-feira`. */
export function weekday(date: CivilDate): string {
  return WEEKDAY_FORMATTER.format(civilDateToUtc(date));
}

/**
 * Data relativa a hoje: `hoje`, `ontem`, `há 3 dias`, `em 12 dias`.
 *
 * Existe porque uma data absoluta obriga a fazer a conta de cabeça, e nos cartões de
 * estado do dashboard a pergunta do utilizador é sempre a mesma: falta muito?
 */
export function relativeDate(date: CivilDate | null | undefined, reference = today()): string {
  if (!date) return '—';
  const difference = daysBetween(reference, date);
  if (difference === 0) return 'hoje';
  if (difference === 1) return 'amanhã';
  if (difference === -1) return 'ontem';
  if (difference > 0) return `em ${difference} dias`;
  return `há ${Math.abs(difference)} dias`;
}

/**
 * Prazo com plural correto e sem alarmismo (§59).
 *
 * `1 dia` / `12 dias` / `142 dias`. A versão anterior desta função escrevia `1 dias` na
 * primeira apólice com um dia para expirar — que é exatamente o momento em que o
 * utilizador está mais atento à mensagem.
 */
export function daysLabel(days: number): string {
  if (days === 0) return 'hoje';
  if (days === 1) return '1 dia';
  if (days === -1) return '1 dia em atraso';
  if (days > 0) return `${formatNumber(days, 0)} dias`;
  return `${formatNumber(Math.abs(days), 0)} dias em atraso`;
}

/** Intervalo `1 set 2026 — 30 set 2026`, encurtado quando partilham o mês ou o ano. */
export function dateRange(from: CivilDate | null, to: CivilDate | null): string {
  if (!from || !to) return '—';
  if (from.slice(0, 7) === to.slice(0, 7)) return `${dateShort(from)} — ${dateLong(to)}`;
  if (from.slice(0, 4) === to.slice(0, 4)) return `${dateShort(from)} — ${dateLong(to)}`;
  return `${dateLong(from)} — ${dateLong(to)}`;
}

/** Primeiro e último dia de um mês, a partir de um `YYYY-MM`. */
export function monthBounds(month: string): { from: CivilDate; to: CivilDate } {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    from: `${year}-${String(monthNumber).padStart(2, '0')}-01`,
    to: `${year}-${String(monthNumber).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

export { addDays, daysBetween };
