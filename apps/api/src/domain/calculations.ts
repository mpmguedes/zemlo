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
 * Intervalo mínimo para um consumo ser credível. Abaixo disto, quase sempre é um erro de
 * introdução ou dois abastecimentos no mesmo dia, e não uma base para um consumo (§13).
 *
 * Vive aqui, e não repetido em cada função, porque faz parte da regra de A8: o consumo
 * por sessão e o consumo médio têm de aplicar o mesmo limiar, senão divergem.
 */
const MIN_CONSUMPTION_INTERVAL_KM = 20;

/**
 * Calcula, para cada abastecimento, a distância percorrida desde o anterior e o
 * consumo do intervalo.
 *
 * Método: "depósito a depósito". O consumo de um intervalo é fiável apenas quando
 * **ambos** os abastecimentos que o delimitam enchem o depósito e têm odómetro: a âncora,
 * que é o último depósito atestado com odómetro, e o abastecimento que o fecha. Os litros
 * dos abastecimentos parciais pelo meio **acumulam-se** nesse intervalo, em vez de serem
 * descartados; o que o torna não fiável é um abastecimento parcial a **fechá-lo**. Nesse
 * caso os litros registados não correspondem ao combustível consumido, e o Zemlo prefere
 * mostrar "sem dados suficientes" a mostrar um consumo errado (§49, §60).
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

      if (intervalKm >= MIN_CONSUMPTION_INTERVAL_KM && intervalLitres > 0) {
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
 *
 * O intervalo é medido **entre dois depósitos atestados com odómetro** (A8): os litros
 * dos abastecimentos parciais pelo meio somam-se ao intervalo em vez de serem
 * descartados, e a distância é a que separa os dois depósitos atestados. Medir pares
 * adjacentes produziria um número diferente do consumo por sessão que a lista de
 * abastecimentos mostra para o mesmo veículo.
 *
 * Devolve `null` quando não há um único intervalo fiável.
 */
export function averageFuelConsumption(entries: readonly FuelEntryInput[]): number | null {
  const ordered = [...entries].sort(compareByDateThenOdometer);

  let totalLitres = 0;
  let totalKm = 0;

  /** Último depósito atestado com odómetro — o início do intervalo corrente. */
  let anchor: FuelEntryInput | null = null;
  /**
   * Fica `true` quando passou, desde a âncora, um abastecimento sem odómetro. Nesse caso o
   * intervalo não pode ser fechado: não se sabe em que ponto do intervalo é que esses
   * litros entraram, e o Zemlo prefere "sem dados" a um consumo errado (§49).
   */
  let ambiguous = false;

  for (const entry of ordered) {
    const currentAnchor = anchor;

    if (
      currentAnchor &&
      currentAnchor.odometerKm !== null &&
      entry.fullTank &&
      entry.odometerKm !== null
    ) {
      const intervalKm = entry.odometerKm - currentAnchor.odometerKm;
      // Os litros do intervalo são os do abastecimento que o fecha mais os parciais
      // acumulados desde a âncora (A8).
      const intervalLitres = litresBetween(ordered, currentAnchor, entry);

      if (!ambiguous && intervalKm >= MIN_CONSUMPTION_INTERVAL_KM && intervalLitres > 0) {
        totalLitres += intervalLitres;
        totalKm += intervalKm;
      }
    }

    if (entry.odometerKm === null) {
      ambiguous = true;
    }

    if (entry.fullTank && entry.odometerKm !== null) {
      // Fecha o intervalo: este depósito passa a ser a nova âncora.
      anchor = entry;
      ambiguous = false;
    }
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
