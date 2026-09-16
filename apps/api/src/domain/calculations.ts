/**
 * Cálculos de consumo e custo.
 *
 * Este módulo é puro: não conhece a base de dados nem HTTP. É a parte do produto
 * onde um erro silencioso é mais caro — um consumo mal calculado destrói a confiança
 * no Zemlo mais depressa do que uma funcionalidade em falta (§60). Por isso todas as
 * funções devolvem `null` em vez de inventar um número quando faltam dados (§49) e
 * nenhuma delas assume que os dados estão completos.
 *
 * Convenções:
 *  - distâncias em km;
 *  - combustível em litros, energia em kWh;
 *  - montantes em cêntimos inteiros;
 *  - consumos em `L/100 km` e `kWh/100 km` (unidade do mercado português).
 */

import { roundOrNull, safeRatio, sumCents } from '@zemlo/shared';

/* -------------------------------------------------------------------------- */
/* Tipos de entrada — deliberadamente mínimos                                  */
/* -------------------------------------------------------------------------- */

export interface FuelEntryInput {
  id: string;
  /** Data civil `YYYY-MM-DD`. */
  date: string;
  litres: number;
  amountCents: number;
  odometerKm: number | null;
  /** Só um depósito atestado permite fechar um intervalo de consumo. */
  fullTank: boolean;
  pricePerLitreCents: number | null;
}

export interface ChargingEntryInput {
  id: string;
  date: string;
  energyKwh: number;
  amountCents: number;
  odometerKm: number | null;
  pricePerKwhCents: number | null;
}

export interface DerivedConsumption {
  /** Distância desde o registo anterior com odómetro conhecido. */
  distanceSincePreviousKm: number | null;
  /** Consumo do intervalo, quando este é um intervalo fechado e fiável. */
  consumptionPer100Km: number | null;
  costPer100KmCents: number | null;
  /** `true` quando o consumo foi calculado entre dois depósitos atestados. */
  reliable: boolean;
}

/* -------------------------------------------------------------------------- */
/* Consumo de combustível (§13)                                                */
/* -------------------------------------------------------------------------- */

/** Preço por litro em cêntimos, calculado quando não foi indicado. */
export function pricePerLitreCents(litres: number, amountCents: number): number | null {
  const value = safeRatio(amountCents, litres);
  return value === null ? null : Math.round(value);
}

/** Preço por kWh em cêntimos, calculado quando não foi indicado. */
export function pricePerKwhCents(energyKwh: number, amountCents: number): number | null {
  const value = safeRatio(amountCents, energyKwh);
  return value === null ? null : Math.round(value);
}

/**
 * Calcula, para cada abastecimento, a distância percorrida desde o anterior e o
 * consumo do intervalo.
 *
 * Método: "depósito a depósito". O consumo de um intervalo `i-1 → i` é fiável apenas
 * quando **ambos** os abastecimentos enchem o depósito e ambos têm odómetro. Um
 * abastecimento parcial no meio significa que os litros registados não correspondem
 * ao combustível consumido, e o Zemlo prefere mostrar "sem dados suficientes" a
 * mostrar um consumo errado (§49, §60).
 *
 * As entradas devem vir ordenadas por data ascendente.
 */
export function deriveFuelConsumption(entries: readonly FuelEntryInput[]): Map<string, DerivedConsumption> {
  const result = new Map<string, DerivedConsumption>();
  const ordered = [...entries].sort(compareByDateThenOdometer);

  /** Último abastecimento atestado com odómetro conhecido — o início do intervalo atual. */
  let anchor: FuelEntryInput | null = null;
  /** Litros acumulados desde a âncora, incluindo abastecimentos parciais pelo meio. */
  let litresSinceAnchor = 0;
  let costsSinceAnchor = 0;
  /** Último registo com odómetro, para calcular a distância imediata. */
  let previousWithOdometer: FuelEntryInput | null = null;

  for (const entry of ordered) {
    const distanceSincePreviousKm =
      entry.odometerKm !== null && previousWithOdometer?.odometerKm != null
        ? entry.odometerKm - previousWithOdometer.odometerKm
        : null;

    let consumptionPer100Km: number | null = null;
    let costPer100KmCents: number | null = null;
    let reliable = false;

    if (anchor && anchor.odometerKm !== null && entry.odometerKm !== null) {
      // Os litros do intervalo incluem o próprio abastecimento atual.
      const intervalLitres = litresSinceAnchor + entry.litres;
      const intervalCostCents = costsSinceAnchor + entry.amountCents;
      const intervalKm = entry.odometerKm - anchor.odometerKm;

      // Um intervalo de menos de 20 km quase sempre significa um erro de introdução
      // ou dois abastecimentos no mesmo dia; não é base para um consumo.
      if (intervalKm >= 20 && intervalLitres > 0) {
        const consumption = (intervalLitres / intervalKm) * 100;
        consumptionPer100Km = roundOrNull(consumption, 2);
        costPer100KmCents = Math.round((intervalCostCents / intervalKm) * 100);
        // Só é fiável se o intervalo inteiro ficou compreendido entre dois atestos.
        reliable = entry.fullTank;
      }
    }

    result.set(entry.id, {
      distanceSincePreviousKm,
      consumptionPer100Km,
      costPer100KmCents,
      reliable,
    });

    if (entry.odometerKm !== null) previousWithOdometer = entry;

    if (entry.fullTank && entry.odometerKm !== null) {
      // Fecha o intervalo: este atestado passa a ser a nova âncora.
      anchor = entry;
      litresSinceAnchor = 0;
      costsSinceAnchor = 0;
    } else {
      // Abastecimento parcial: acumula litros e custo para o próximo intervalo fechado.
      litresSinceAnchor += entry.litres;
      costsSinceAnchor += entry.amountCents;
    }
  }

  return result;
}

/**
 * Consumo médio ponderado de um conjunto de abastecimentos.
 *
 * Ponderar por litros e quilómetros (em vez de fazer a média das médias) evita o
 * erro clássico de atribuir o mesmo peso a um depósito de 20 L e a um de 70 L.
 * Devolve `null` quando não há um único intervalo fiável.
 */
export function averageFuelConsumption(entries: readonly FuelEntryInput[]): number | null {
  const derived = deriveFuelConsumption(entries);
  const ordered = [...entries].sort(compareByDateThenOdometer);

  let totalLitres = 0;
  let totalKm = 0;

  for (let index = 1; index < ordered.length; index += 1) {
    const entry = ordered[index] as FuelEntryInput;
    const previous = ordered[index - 1] as FuelEntryInput;
    const info = derived.get(entry.id);
    if (!info?.reliable) continue;
    if (previous.odometerKm === null || entry.odometerKm === null) continue;
    const km = entry.odometerKm - previous.odometerKm;
    if (km < 20) continue;
    // Os litros consumidos no intervalo são os que entraram no abastecimento final
    // mais eventuais parciais que tenham sido acumulados.
    totalLitres += litresBetween(ordered, previous, entry);
    totalKm += km;
  }

  if (totalKm <= 0 || totalLitres <= 0) return null;
  return roundOrNull((totalLitres / totalKm) * 100, 2);
}

/** Litros que entraram entre dois abastecimentos (exclusive no inicial, inclusive no final). */
function litresBetween(
  ordered: readonly FuelEntryInput[],
  from: FuelEntryInput,
  to: FuelEntryInput,
): number {
  const startIndex = ordered.indexOf(from);
  const endIndex = ordered.indexOf(to);
  let litres = 0;
  for (let index = startIndex + 1; index <= endIndex; index += 1) {
    litres += (ordered[index] as FuelEntryInput).litres;
  }
  return litres;
}

/** Custo médio por litro, ponderado pelos litros abastecidos. */
export function averageFuelPriceCents(entries: readonly FuelEntryInput[]): number | null {
  const totalLitres = entries.reduce((sum, entry) => sum + entry.litres, 0);
  const totalCents = sumCents(entries.map((entry) => entry.amountCents));
  if (totalLitres <= 0) return null;
  return Math.round(totalCents / totalLitres);
}

/* -------------------------------------------------------------------------- */
/* Consumo elétrico (§14)                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Consumo elétrico por intervalo.
 *
 * Ao contrário do combustível, aqui não existe "depósito atestado": a energia
 * carregada entre dois odómetros conhecidos é aproximada, porque a bateria pode não
 * ficar no mesmo estado de carga. Quando existem SOC inicial e final, a diferença
 * permite corrigir a estimativa; quando não existem, o valor é apresentado como
 * aproximado e não como medição.
 */
export function deriveChargingConsumption(
  entries: readonly ChargingEntryInput[],
): Map<string, DerivedConsumption & { socCorrected: boolean }> {
  const result = new Map<string, DerivedConsumption & { socCorrected: boolean }>();
  const ordered = [...entries].sort(compareByDateThenOdometer);
  let previousWithOdometer: ChargingEntryInput | null = null;

  for (const entry of ordered) {
    const distanceSincePreviousKm =
      entry.odometerKm !== null && previousWithOdometer?.odometerKm != null
        ? entry.odometerKm - previousWithOdometer.odometerKm
        : null;

    let consumptionPer100Km: number | null = null;
    let costPer100KmCents: number | null = null;
    let reliable = false;

    if (
      previousWithOdometer?.odometerKm != null &&
      entry.odometerKm !== null &&
      distanceSincePreviousKm !== null &&
      distanceSincePreviousKm >= 20 &&
      entry.energyKwh > 0
    ) {
      const consumption = (entry.energyKwh / distanceSincePreviousKm) * 100;
      consumptionPer100Km = roundOrNull(consumption, 2);
      costPer100KmCents = Math.round((entry.amountCents / distanceSincePreviousKm) * 100);
      reliable = true;
    }

    result.set(entry.id, {
      distanceSincePreviousKm,
      consumptionPer100Km,
      costPer100KmCents,
      reliable,
      socCorrected: false,
    });

    if (entry.odometerKm !== null) previousWithOdometer = entry;
  }

  return result;
}

/** Consumo elétrico médio ponderado, em `kWh/100 km`. */
export function averageEnergyConsumption(entries: readonly ChargingEntryInput[]): number | null {
  const derived = deriveChargingConsumption(entries);
  const ordered = [...entries].sort(compareByDateThenOdometer);

  let totalKwh = 0;
  let totalKm = 0;
  for (const entry of ordered) {
    const info = derived.get(entry.id);
    if (!info?.reliable || info.distanceSincePreviousKm === null) continue;
    totalKwh += entry.energyKwh;
    totalKm += info.distanceSincePreviousKm;
  }
  if (totalKm <= 0 || totalKwh <= 0) return null;
  return roundOrNull((totalKwh / totalKm) * 100, 2);
}

/** Custo médio por kWh, ponderado. */
export function averageEnergyPriceCents(entries: readonly ChargingEntryInput[]): number | null {
  const totalKwh = entries.reduce((sum, entry) => sum + entry.energyKwh, 0);
  const totalCents = sumCents(entries.map((entry) => entry.amountCents));
  if (totalKwh <= 0) return null;
  return Math.round(totalCents / totalKwh);
}

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                  */
/* -------------------------------------------------------------------------- */

function compareByDateThenOdometer<T extends { date: string; odometerKm: number | null }>(
  a: T,
  b: T,
): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const aKm = a.odometerKm ?? -1;
  const bKm = b.odometerKm ?? -1;
  if (aKm !== bKm) return aKm - bKm;
  return 0;
}
