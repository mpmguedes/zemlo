/**
 * Quilometragem: validação de progressão e ritmo (§11).
 *
 * A quilometragem é o dado central do Zemlo: alimenta o custo/km, os lembretes por
 * distância, a previsão de manutenção e a deteção de anomalias. Um valor absurdo
 * introduzido sem confirmação contamina todas essas funcionalidades, mas bloquear o
 * utilizador também é inaceitável — quem está a corrigir um erro de introdução
 * anterior precisa de o poder fazer (§49).
 *
 * A regra adotada: **avisar sempre, bloquear nunca**. Um recuo de quilometragem
 * devolve um aviso explícito em linguagem de produto; o cliente reenvia o pedido com
 * a confirmação do utilizador e o Zemlo regista o evento como correção (§33, §51).
 */

import { describeKm, roundOrNull, type CivilDate, daysBetween } from '@zemlo/shared';

/* -------------------------------------------------------------------------- */
/* Limites de plausibilidade                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Distância diária acima da qual um salto de quilometragem é implausível.
 * 1500 km/dia excede qualquer utilização rodoviária civil, mas deixa margem para
 * viagens longas com dois condutores e para registos espaçados no tempo.
 */
export const MAX_PLAUSIBLE_KM_PER_DAY = 1500;

/** Salto absoluto sempre aceite sem aviso, independentemente do tempo decorrido. */
export const ALWAYS_PLAUSIBLE_JUMP_KM = 5000;

/** Progressão mínima para considerar que houve movimento real. */
export const MIN_PROGRESSION_KM = 1;

export interface OdometerSnapshot {
  odometerKm: number | null;
  /** Data civil da última leitura conhecida. */
  recordedAt: CivilDate | null;
}

export interface OdometerGuardInput {
  next: number;
  /** Data civil da nova leitura; por omissão hoje. */
  recordedAt: CivilDate;
  current: OdometerSnapshot;
  /** Valor mais alto já registado para o veículo, para detetar retrocessos face ao histórico. */
  historicalMaxKm?: number | null;
  /** Quando `true`, o utilizador já confirmou o valor. */
  userConfirmed?: boolean;
}

export interface OdometerGuardResult {
  ok: boolean;
  /** Avisos que **não** impedem a gravação mas devem ser mostrados. */
  warnings: string[];
  /** Avisos que exigem confirmação explícita antes de gravar. */
  requiresConfirmation: boolean;
  /** Diferença face à leitura anterior (negativa num recuo). */
  deltaKm: number | null;
  /** Dias decorridos desde a leitura anterior. */
  daysSincePrevious: number | null;
}

/**
 * Avalia uma nova leitura de odómetro contra o estado conhecido do veículo.
 *
 * Não lança erros: devolve uma avaliação. A decisão de bloquear pertence à camada
 * que conhece o pedido HTTP, porque a mesma função é usada por integrações que não
 * têm um utilizador disponível para confirmar.
 */
export function evaluateOdometerReading(input: OdometerGuardInput): OdometerGuardResult {
  const { next, recordedAt, current, historicalMaxKm } = input;
  const warnings: string[] = [];
  let requiresConfirmation = false;

  if (!Number.isInteger(next) || next < 0) {
    return {
      ok: false,
      warnings: ['A quilometragem tem de ser um número inteiro de quilómetros.'],
      requiresConfirmation: false,
      deltaKm: null,
      daysSincePrevious: null,
    };
  }

  const previousKm = current.odometerKm;
  const daysSincePrevious =
    current.recordedAt !== null ? daysBetween(current.recordedAt, recordedAt) : null;
  const deltaKm = previousKm === null ? null : next - previousKm;

  if (previousKm === null) {
    // Primeira leitura: nada a validar. O Zemlo aceita começar com zero informação (§49).
    return { ok: true, warnings, requiresConfirmation: false, deltaKm, daysSincePrevious };
  }

  if (deltaKm !== null && deltaKm < 0) {
    const reference = historicalMaxKm !== null && historicalMaxKm !== undefined
      ? Math.max(previousKm, historicalMaxKm)
      : previousKm;
    const deltaVsMax = next - reference;
    const message =
      previousKm === next
        ? `A quilometragem é igual à última leitura (${next.toLocaleString('pt-PT')} km). Confirmas?`
        : `A quilometragem recuou ${Math.abs(deltaKm).toLocaleString('pt-PT')} km face à última leitura (${previousKm.toLocaleString('pt-PT')} km).${deltaVsMax < deltaKm ? ` É também inferior ao valor mais alto já registado (${reference.toLocaleString('pt-PT')} km).` : ''} Confirmas que corrigiste o valor?`;
    warnings.push(message);
    requiresConfirmation = true;
  } else if (deltaKm !== null && deltaKm > 0 && deltaKm < MIN_PROGRESSION_KM) {
    warnings.push('A quilometragem não avançou o suficiente para ser considerada uma nova leitura.');
    requiresConfirmation = true;
  }

  // Verificação de plausibilidade: um salto grande face ao tempo decorrido.
  // Um salto aceite por omissão é sempre inferior a `ALWAYS_PLAUSIBLE_JUMP_KM`; o que
  // interessa avaliar é se esse salto é compatível com o tempo que passou.
  if (deltaKm !== null && deltaKm > ALWAYS_PLAUSIBLE_JUMP_KM) {
    const elapsed = Math.max(daysSincePrevious ?? 1, 1);
    const perDay = deltaKm / elapsed;
    if (perDay > MAX_PLAUSIBLE_KM_PER_DAY) {
      warnings.push(
        `Um salto de ${deltaKm.toLocaleString('pt-PT')} km em ${elapsed} ${elapsed === 1 ? 'dia' : 'dias'} parece demasiado. Confirmas este valor?`,
      );
      requiresConfirmation = true;
    }
  }

  // Data anterior à última leitura conhecida: não bloqueia, mas o histórico fica fora de ordem.
  if (daysSincePrevious !== null && daysSincePrevious < 0) {
    warnings.push(
      'A data indicada é anterior à da última leitura registada. O histórico será ordenado pela data, não pela ordem de introdução.',
    );
  }

  const confirmed = input.userConfirmed === true;
  return {
    ok: !requiresConfirmation || confirmed,
    warnings,
    requiresConfirmation,
    deltaKm,
    daysSincePrevious,
  };
}

/* -------------------------------------------------------------------------- */
/* Ritmo de utilização                                                         */
/* -------------------------------------------------------------------------- */

export interface OdometerSample {
  date: CivilDate;
  odometerKm: number;
  /** `true` quando a leitura é uma correção confirmada; excluída do cálculo do ritmo. */
  isCorrection?: boolean;
}

export interface UsageRate {
  /** Quilómetros por dia, pela regressão sobre as leituras recentes. */
  kmPerDay: number | null;
  kmPerMonth: number | null;
  kmPerYear: number | null;
  /** Número de leituras usadas na estimativa. */
  samplesUsed: number;
  /** `true` quando a estimativa assenta em pelo menos 3 leituras e 14 dias. */
  confident: boolean;
}

/**
 * Estima o ritmo de utilização a partir do histórico de leituras.
 *
 * Usa regressão linear (mínimos quadrados) sobre as leituras recentes em vez de
 * dividir a diferença total pelo tempo total. Uma única leitura aberrante — uma
 * correção, um erro de digitação aceite pelo utilizador — distorceria gravemente uma
 * média simples, e este valor determina quando a próxima revisão é projetada.
 */
export function estimateUsageRate(
  samples: readonly OdometerSample[],
  options: { maxSamples?: number; minDays?: number } = {},
): UsageRate {
  const maxSamples = options.maxSamples ?? 24;
  const minDays = options.minDays ?? 14;

  const usable = samples
    .filter((sample) => !sample.isCorrection && Number.isFinite(sample.odometerKm))
    .slice(-maxSamples);

  if (usable.length < 2) {
    return { kmPerDay: null, kmPerMonth: null, kmPerYear: null, samplesUsed: usable.length, confident: false };
  }

  const first = usable[0] as OdometerSample;
  const last = usable[usable.length - 1] as OdometerSample;
  const spanDays = daysBetween(first.date, last.date);
  if (spanDays <= 0) {
    return { kmPerDay: null, kmPerMonth: null, kmPerYear: null, samplesUsed: usable.length, confident: false };
  }

  // Regressão linear sobre os dias decorridos desde a primeira leitura.
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const sample of usable) {
    const x = daysBetween(first.date, sample.date);
    const y = sample.odometerKm;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const n = usable.length;
  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) {
    return { kmPerDay: null, kmPerMonth: null, kmPerYear: null, samplesUsed: n, confident: false };
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;
  if (!Number.isFinite(slope) || slope <= 0) {
    // Ritmo nulo ou negativo: o veículo está parado ou o histórico é inconsistente.
    return { kmPerDay: null, kmPerMonth: null, kmPerYear: null, samplesUsed: n, confident: false };
  }

  const kmPerDay = roundOrNull(slope, 2) as number;
  const confident = n >= 3 && spanDays >= minDays;

  return {
    kmPerDay,
    kmPerMonth: roundOrNull(kmPerDay * 30.4375, 0),
    kmPerYear: roundOrNull(kmPerDay * 365.25, 0),
    samplesUsed: n,
    confident,
  };
}

/** Data prevista para atingir uma determinada quilometragem, ao ritmo atual. */
export function projectDateForOdometer(
  targetKm: number,
  currentKm: number | null,
  rate: UsageRate,
  today: CivilDate,
): CivilDate | null {
  if (currentKm === null || rate.kmPerDay === null || rate.kmPerDay <= 0) return null;
  const remainingKm = targetKm - currentKm;
  if (remainingKm <= 0) return today;
  const days = Math.ceil(remainingKm / rate.kmPerDay);
  // Uma projeção a mais de 5 anos não é informação útil; é ruído apresentado como facto.
  if (days > 1826) return null;
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const projected = new Date(Date.UTC(y, m - 1, d + days));
  return projected.toISOString().slice(0, 10);
}

/** Resumo em linguagem de produto para uma diferença de quilometragem. */
export function describeOdometerDelta(deltaKm: number | null): string {
  if (deltaKm === null) return 'Primeira leitura registada';
  return describeKm(deltaKm);
}
