/**
 * Agregações financeiras e de utilização (§8, §23).
 *
 * Módulo puro, sem base de dados. Todas as funções recebem listas já carregadas.
 *
 * A regra que atravessa todo este ficheiro: **nunca inventar um número**. Quando não
 * há dados suficientes para calcular custo/km, o Zemlo devolve `null` e a interface
 * explica o que falta — em vez de mostrar um valor plausível mas falso (§49, §60).
 * Um custo/km errado é pior do que um custo/km ausente, porque leva o utilizador a
 * decisões erradas sobre o seu veículo.
 */

import {
  EXPENSE_CATEGORIES,
  categoryLabel,
  formatCents,
  formatKm,
  formatNumber,
  monthsBetween,
  optionIcon,
  percentageChange,
  roundOrNull,
  safeRatio,
  sumCents,
  type CategoryTotal,
  type CivilDate,
  type ExpenseCategory,
  type MonthlyTotal,
} from '@zemlo/shared';
import {
  averageEnergyConsumption,
  averageEnergyPriceCents,
  averageFuelConsumption,
  averageFuelPriceCents,
  type ChargingEntryInput,
  type FuelEntryInput,
} from './calculations.js';

/* -------------------------------------------------------------------------- */
/* Entradas                                                                    */
/* -------------------------------------------------------------------------- */

export interface ExpenseEntry {
  date: CivilDate;
  amountCents: number;
  category: ExpenseCategory;
}

export interface OdometerEntry {
  date: CivilDate;
  odometerKm: number;
  isCorrection?: boolean;
}

export interface AnalysisInput {
  from: CivilDate;
  to: CivilDate;
  expenses: readonly ExpenseEntry[];
  fuel: readonly FuelEntryInput[];
  charging: readonly ChargingEntryInput[];
  odometer: readonly OdometerEntry[];
}

/* -------------------------------------------------------------------------- */
/* Categorias                                                                  */
/* -------------------------------------------------------------------------- */

/** Categorias que contam como energia. */
const ENERGY_CATEGORIES: readonly ExpenseCategory[] = ['fuel', 'charging'];
/** Categorias de custo fixo recorrente (seguro, imposto, inspeção). */
const FIXED_CATEGORIES: readonly ExpenseCategory[] = ['insurance', 'tax', 'inspection'];
/** Categorias de manutenção e desgaste. */
const MAINTENANCE_CATEGORIES: readonly ExpenseCategory[] = ['maintenance', 'tyres', 'repairs'];

export function isEnergyCategory(category: ExpenseCategory): boolean {
  return ENERGY_CATEGORIES.includes(category);
}

export function isFixedCategory(category: ExpenseCategory): boolean {
  return FIXED_CATEGORIES.includes(category);
}

export function isMaintenanceCategory(category: ExpenseCategory): boolean {
  return MAINTENANCE_CATEGORIES.includes(category);
}

/* -------------------------------------------------------------------------- */
/* Filtros                                                                     */
/* -------------------------------------------------------------------------- */

export function inRange<T extends { date: CivilDate }>(items: readonly T[], from: CivilDate, to: CivilDate): T[] {
  return items.filter((item) => item.date >= from && item.date <= to);
}

export function sumExpenses(items: readonly ExpenseEntry[]): number {
  return sumCents(items.map((item) => item.amountCents));
}

/* -------------------------------------------------------------------------- */
/* Totais por categoria                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Totais por categoria, incluindo as categorias com zero.
 *
 * Incluir as categorias vazias é intencional: a interface mostra ao utilizador que
 * "Pneus: 0 €" faz parte do conjunto que está a ser acompanhado, em vez de deixar em
 * aberto se a categoria existe ou não (§45).
 */
export function totalsByCategory(items: readonly ExpenseEntry[]): CategoryTotal[] {
  const totals = new Map<ExpenseCategory, { amountCents: number; count: number }>();
  for (const category of EXPENSE_CATEGORIES) {
    totals.set(category.code as ExpenseCategory, { amountCents: 0, count: 0 });
  }
  for (const item of items) {
    const current = totals.get(item.category) ?? { amountCents: 0, count: 0 };
    totals.set(item.category, {
      amountCents: current.amountCents + item.amountCents,
      count: current.count + 1,
    });
  }

  const total = sumExpenses(items);
  return [...totals.entries()]
    .map(([category, value]) => {
      const meta = EXPENSE_CATEGORIES.find((option) => option.code === category);
      return {
        category,
        label: categoryLabel(category),
        icon: optionIcon(EXPENSE_CATEGORIES, category),
        amountCents: value.amountCents,
        share: roundOrNull(safeRatio(value.amountCents, total), 4),
        count: value.count,
        order: meta?.order ?? 999,
      };
    })
    .sort((a, b) => b.amountCents - a.amountCents || a.order - b.order)
    .map(({ order: _order, ...rest }) => rest);
}

/* -------------------------------------------------------------------------- */
/* Totais mensais                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Série mensal, com os meses sem atividade incluídos a zero.
 *
 * Um gráfico com buracos é mentiroso: sugere uma interrupção de custos onde apenas
 * não houve registos. Preencher os meses dá ao utilizador uma leitura correta da
 * evolução (§23).
 */
export function totalsByMonth(
  items: readonly ExpenseEntry[],
  from: CivilDate,
  to: CivilDate,
): MonthlyTotal[] {
  const months = monthsBetween(from, to);
  const buckets = new Map<string, { amountCents: number; energyCents: number }>();
  for (const month of months) buckets.set(month, { amountCents: 0, energyCents: 0 });

  for (const item of items) {
    const month = item.date.slice(0, 7);
    const bucket = buckets.get(month);
    if (!bucket) continue;
    bucket.amountCents += item.amountCents;
    if (isEnergyCategory(item.category)) bucket.energyCents += item.amountCents;
  }

  return months.map((month) => {
    const bucket = buckets.get(month) ?? { amountCents: 0, energyCents: 0 };
    return {
      month,
      label: monthLabel(month),
      amountCents: bucket.amountCents,
      energyCents: bucket.energyCents,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Distância e ritmo                                                           */
/* -------------------------------------------------------------------------- */

export interface DistanceResult {
  /** Quilómetros percorridos no período, com a fonte usada no cálculo. */
  km: number | null;
  /** `odometer` quando há leituras suficientes; `records` quando derivado de registos. */
  basedOn: 'odometer' | 'records' | null;
  firstReadingDate: CivilDate | null;
  lastReadingDate: CivilDate | null;
}

/**
 * Distância percorrida num período.
 *
 * Preferência: leituras de odómetro do próprio período. Se não existirem pelo menos
 * duas, tenta-se derivar dos registos de abastecimento/carregamento com quilometragem.
 * Reconstruir a distância a partir de registos de despesa seria sempre uma estimativa
 * pior: uma oficina pode registar a quilometragem, mas uma portagem não.
 */
export function periodDistance(input: {
  from: CivilDate;
  to: CivilDate;
  odometer: readonly OdometerEntry[];
  fuel: readonly FuelEntryInput[];
  charging: readonly ChargingEntryInput[];
}): DistanceResult {
  const readings = input.odometer
    .filter((entry) => entry.date >= input.from && entry.date <= input.to && !entry.isCorrection)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.odometerKm - b.odometerKm));

  if (readings.length >= 2) {
    const first = readings[0] as OdometerEntry;
    const last = readings[readings.length - 1] as OdometerEntry;
    const km = last.odometerKm - first.odometerKm;
    if (km > 0) {
      return { km, basedOn: 'odometer', firstReadingDate: first.date, lastReadingDate: last.date };
    }
  }

  const recordPoints = [
    ...input.fuel
      .filter((entry) => entry.date >= input.from && entry.date <= input.to && entry.odometerKm !== null)
      .map((entry) => ({ date: entry.date, odometerKm: entry.odometerKm as number })),
    ...input.charging
      .filter((entry) => entry.date >= input.from && entry.date <= input.to && entry.odometerKm !== null)
      .map((entry) => ({ date: entry.date, odometerKm: entry.odometerKm as number })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.odometerKm - b.odometerKm));

  if (recordPoints.length >= 2) {
    const first = recordPoints[0] as { date: CivilDate; odometerKm: number };
    const last = recordPoints[recordPoints.length - 1] as { date: CivilDate; odometerKm: number };
    const km = last.odometerKm - first.odometerKm;
    if (km > 0) {
      return { km, basedOn: 'records', firstReadingDate: first.date, lastReadingDate: last.date };
    }
  }

  return {
    km: null,
    basedOn: null,
    firstReadingDate: readings[0]?.date ?? null,
    lastReadingDate: readings.length > 0 ? (readings[readings.length - 1] as OdometerEntry).date : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Custos unitários                                                            */
/* -------------------------------------------------------------------------- */

export interface UnitCosts {
  costPerKmCents: number | null;
  costPerMonthCents: number | null;
  costPerDayCents: number | null;
  energyCostPerKmCents: number | null;
  maintenanceCostPerKmCents: number | null;
}

export function unitCosts(input: {
  from: CivilDate;
  to: CivilDate;
  expenses: readonly ExpenseEntry[];
  distance: DistanceResult;
}): UnitCosts {
  const totalCents = sumExpenses(input.expenses);
  const days = Math.max(dayCount(input.from, input.to), 1);
  const months = Math.max(monthsBetween(input.from, input.to).length, 1);
  const km = input.distance.km;

  const energyCents = sumExpenses(input.expenses.filter((item) => isEnergyCategory(item.category)));
  const maintenanceCents = sumExpenses(
    input.expenses.filter((item) => isMaintenanceCategory(item.category)),
  );

  return {
    costPerKmCents: km && km > 0 ? Math.round(totalCents / km) : null,
    costPerMonthCents: input.expenses.length > 0 ? Math.round(totalCents / months) : null,
    costPerDayCents: input.expenses.length > 0 ? Math.round(totalCents / days) : null,
    energyCostPerKmCents: km && km > 0 ? Math.round(energyCents / km) : null,
    maintenanceCostPerKmCents: km && km > 0 ? Math.round(maintenanceCents / km) : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Consumos                                                                    */
/* -------------------------------------------------------------------------- */

export interface ConsumptionSummary {
  fuelL100Km: number | null;
  fuelCostPerLitreCents: number | null;
  energyKwh100Km: number | null;
  energyCostPerKwhCents: number | null;
  fuelMonthly: Array<{ month: string; label: string; value: number | null }>;
  energyMonthly: Array<{ month: string; label: string; value: number | null }>;
}

/**
 * Consumos agregados e série mensal.
 *
 * O consumo mensal é calculado **dentro de cada mês**, não interpolado a partir da
 * média global. Um mês com um consumo anómalo tem de aparecer como anómalo na série
 * mensal — é precisamente esse o sinal que ajuda o utilizador a detetar um problema
 * (pneus, travões, filtro entupido) antes de a oficina o fazer (§48).
 */
export function consumptionSummary(input: {
  from: CivilDate;
  to: CivilDate;
  fuel: readonly FuelEntryInput[];
  charging: readonly ChargingEntryInput[];
}): ConsumptionSummary {
  const fuelInRange = inRange(input.fuel, input.from, input.to);
  const chargingInRange = inRange(input.charging, input.from, input.to);

  const months = monthsBetween(input.from, input.to);

  const fuelMonthly = months.map((month) => {
    const monthEntries = fuelInRange.filter((entry) => entry.date.slice(0, 7) === month);
    return {
      month,
      label: monthLabel(month),
      value: monthEntries.length >= 2 ? averageFuelConsumption(monthEntries) : null,
    };
  });

  const energyMonthly = months.map((month) => {
    const monthEntries = chargingInRange.filter((entry) => entry.date.slice(0, 7) === month);
    return {
      month,
      label: monthLabel(month),
      value: monthEntries.length >= 2 ? averageEnergyConsumption(monthEntries) : null,
    };
  });

  return {
    fuelL100Km: averageFuelConsumption(fuelInRange),
    fuelCostPerLitreCents: averageFuelPriceCents(fuelInRange),
    energyKwh100Km: averageEnergyConsumption(chargingInRange),
    energyCostPerKwhCents: averageEnergyPriceCents(chargingInRange),
    fuelMonthly,
    energyMonthly,
  };
}

/* -------------------------------------------------------------------------- */
/* Comparação entre períodos (§23)                                             */
/* -------------------------------------------------------------------------- */

export interface PeriodComparison {
  previousPeriodTotalCents: number;
  deltaCents: number;
  deltaPercent: number | null;
  previousPeriodKm: number | null;
  deltaKm: number | null;
}

/**
 * Compara o período com o período imediatamente anterior de igual duração.
 *
 * Devolve `null` na percentagem quando o período anterior foi zero — uma variação de
 * infinito por cento não é informação, e apresentá-la seria alarmista (§59).
 */
export function comparePeriods(input: {
  current: readonly ExpenseEntry[];
  previous: readonly ExpenseEntry[];
  previousKm: number | null;
  currentKm: number | null;
}): PeriodComparison {
  const currentTotal = sumExpenses(input.current);
  const previousTotal = sumExpenses(input.previous);
  const deltaCents = currentTotal - previousTotal;

  return {
    previousPeriodTotalCents: previousTotal,
    deltaCents,
    deltaPercent: percentageChange(currentTotal, previousTotal),
    previousPeriodKm: input.previousKm,
    deltaKm:
      input.currentKm !== null && input.previousKm !== null ? input.currentKm - input.previousKm : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Estatísticas avançadas (§23) — apresentadas apenas quando fazem sentido     */
/* -------------------------------------------------------------------------- */

export interface AdvancedStatsInput {
  purchaseDate: CivilDate | null;
  purchasePriceCents: number | null;
  purchaseOdometerKm: number | null;
  currentOdometerKm: number | null;
  /** Total gasto desde sempre. */
  lifetimeCostCents: number;
  /** Data da primeira atividade registada, usada para estimar a posse. */
  firstRecordDate: CivilDate | null;
  today: CivilDate;
  /** Taxa de depreciação anual aplicada quando não há valor de mercado conhecido. */
  annualDepreciationRate?: number;
}

export interface AdvancedStats {
  ownershipMonths: number | null;
  totalCostOfOwnershipCents: number | null;
  depreciationCents: number | null;
  residualValueCents: number | null;
  valuePerKmCents: number | null;
  assumptions: string[];
}

/**
 * TCO e depreciação.
 *
 * A depreciação é a parte mais fácil de apresentar de forma enganadora. O Zemlo não
 * tem acesso ao valor de mercado real do veículo, por isso usa uma curva de
 * depreciação decrescente conservadora: 15% no primeiro ano, 10% nos anos seguintes,
 * com um piso de 15% do valor de compra. Todas as premissas são **devolvidas ao
 * utilizador** em `assumptions`, porque um número sem metodologia é um número em que
 * não se pode confiar (§48, §59).
 */
export function advancedStats(input: AdvancedStatsInput): AdvancedStats {
  const assumptions: string[] = [];
  const rate = input.annualDepreciationRate ?? 0.1;

  const ownershipStart = input.purchaseDate ?? input.firstRecordDate;
  const ownershipMonths =
    ownershipStart !== null ? Math.max(monthsBetween(ownershipStart, input.today).length - 1, 0) : null;

  let depreciationCents: number | null = null;
  let residualValueCents: number | null = null;

  if (input.purchasePriceCents !== null && ownershipStart !== null) {
    const years = (ownershipMonths ?? 0) / 12;
    let factor: number;
    if (years <= 0) {
      factor = 1;
    } else if (years <= 1) {
      factor = 1 - 0.15 * years;
    } else {
      factor = 0.85 * (1 - rate) ** (years - 1);
    }
    // Piso de 15%: um veículo, por muito antigo que seja, raramente vale zero.
    factor = Math.max(factor, 0.15);
    residualValueCents = Math.round(input.purchasePriceCents * factor);
    depreciationCents = input.purchasePriceCents - residualValueCents;
    assumptions.push(
      'A depreciação é estimada com uma curva decrescente (15% no primeiro ano, 10% nos seguintes, mínimo de 15% do valor de compra), porque o Zemlo não conhece o valor de mercado real do teu veículo.',
    );
  } else if (input.purchasePriceCents === null) {
    assumptions.push('Adiciona o preço de compra na ficha do veículo para veres a depreciação estimada.');
  }

  const totalCostOfOwnershipCents =
    input.purchasePriceCents !== null || input.lifetimeCostCents > 0
      ? (input.purchasePriceCents ?? 0) + input.lifetimeCostCents
      : null;

  if (totalCostOfOwnershipCents !== null) {
    assumptions.push(
      'O custo total de propriedade soma o preço de compra aos custos registados no Zemlo; não inclui impostos nem juros de financiamento que não tenhas registado.',
    );
  }

  const kmOwned =
    input.purchaseOdometerKm !== null && input.currentOdometerKm !== null
      ? input.currentOdometerKm - input.purchaseOdometerKm
      : null;

  return {
    ownershipMonths,
    totalCostOfOwnershipCents,
    depreciationCents,
    residualValueCents,
    valuePerKmCents:
      kmOwned !== null && kmOwned > 0 && input.lifetimeCostCents > 0
        ? Math.round(input.lifetimeCostCents / kmOwned)
        : null,
    assumptions,
  };
}

/* -------------------------------------------------------------------------- */
/* Dicas de dados em falta (§6, §46, §49)                                      */
/* -------------------------------------------------------------------------- */

export interface DataGap {
  key: string;
  /** Título curto do passo em falta, usado como cabeçalho de cada linha (§59). */
  title: string;
  message: string;
  href: string | null;
}

/**
 * Dados em falta, em linguagem de produto.
 *
 * Nota de tom (§59): isto **não** é uma lista de erros. É uma lista de coisas que o
 * Zemlo faria por ti se soubesse mais um pouco. É por isso que as frases estão na
 * primeira pessoa do plural e nunca usam a palavra "falta" em tom de censura.
 */
export function dataGaps(input: {
  odometerKm: number | null;
  hasInsurance: boolean;
  hasInspection: boolean;
  hasMaintenancePlan: boolean;
  hasExpenses: boolean;
  hasFuelOrCharging: boolean;
  vehicleId: string;
  supportsRefuelling: boolean;
  supportsCharging: boolean;
}): DataGap[] {
  const gaps: DataGap[] = [];
  const base = `/vehicles/${input.vehicleId}`;

  if (input.odometerKm === null) {
    gaps.push({
      key: 'odometer',
      title: 'Quilometragem',
      message: 'Com a quilometragem atual, passamos a calcular o custo por km e a avisar-te das revisões.',
      href: `${base}?sheet=odometer`,
    });
  }
  if (!input.hasInsurance) {
    gaps.push({
      key: 'insurance',
      title: 'Seguro',
      message: 'Falta apenas o seguro deste veículo para te avisarmos antes da renovação.',
      href: `${base}?sheet=insurance`,
    });
  }
  if (!input.hasInspection) {
    gaps.push({
      key: 'inspection',
      title: 'Inspeção',
      message: 'Regista a última inspeção e lembramos-te da próxima na altura certa.',
      href: `${base}?sheet=inspection`,
    });
  }
  if (!input.hasMaintenancePlan && input.odometerKm !== null) {
    gaps.push({
      key: 'maintenance',
      title: 'Próxima manutenção',
      message: 'Define a próxima revisão e o Zemlo avisa-te por quilómetros, por tempo, ou por ambos.',
      href: `${base}?sheet=reminder`,
    });
  }
  if (!input.hasExpenses) {
    gaps.push({
      key: 'expenses',
      title: 'Primeira despesa',
      message:
        'Ainda não tens despesas registadas. Quando adicionares a primeira, começamos a somar os custos do teu veículo.',
      href: `${base}?sheet=expense`,
    });
  }
  if (!input.hasFuelOrCharging && input.supportsRefuelling) {
    gaps.push({
      key: 'fuel',
      title: 'Primeiro abastecimento',
      message: 'Um abastecimento é suficiente para começarmos a medir o consumo real deste veículo.',
      href: `${base}?sheet=fuel`,
    });
  }
  if (!input.hasFuelOrCharging && !input.supportsRefuelling && input.supportsCharging) {
    gaps.push({
      key: 'charging',
      title: 'Primeiro carregamento',
      message: 'Um carregamento é suficiente para começarmos a medir o consumo real deste veículo.',
      href: `${base}?sheet=charging`,
    });
  }

  return gaps;
}

/* -------------------------------------------------------------------------- */
/* Descrições para cartões e resumos                                           */
/* -------------------------------------------------------------------------- */

/** Resumo financeiro do dashboard: `Este ano · 2 291,90 €`. */
export function financeSummaryLabel(year: number, totalCents: number): string {
  return `Em ${year} · ${formatCents(totalCents)}`;
}

/** Texto do custo por km, com contexto sobre a base de cálculo. */
export function costPerKmLabel(costPerKmCents: number | null, basedOn: DistanceResult['basedOn']): string {
  if (costPerKmCents === null) return 'Ainda sem dados suficientes';
  const suffix = basedOn === 'records' ? ' (estimado a partir dos registos)' : '';
  return `${formatCents(costPerKmCents)}/km${suffix}`;
}

/** Texto do consumo, com a unidade adequada ao tipo de veículo. */
export function consumptionLabel(
  fuelL100Km: number | null,
  energyKwh100Km: number | null,
  supportsRefuelling: boolean,
  supportsCharging: boolean,
): string {
  const parts: string[] = [];
  if (supportsRefuelling && fuelL100Km !== null) {
    parts.push(`${formatNumber(fuelL100Km, 2)} L/100 km`);
  }
  if (supportsCharging && energyKwh100Km !== null) {
    parts.push(`${formatNumber(energyKwh100Km, 2)} kWh/100 km`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Ainda sem dados suficientes';
}

/* -------------------------------------------------------------------------- */
/* Utilidades internas                                                         */
/* -------------------------------------------------------------------------- */

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split('-') as [string, string];
  const names = [
    'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
    'jul', 'ago', 'set', 'out', 'nov', 'dez',
  ];
  const index = Number(monthNumber) - 1;
  const name = names[index] ?? monthNumber;
  return `${name} ${year.slice(2)}`;
}

function dayCount(from: CivilDate, to: CivilDate): number {
  const [y1, m1, d1] = from.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = to.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000) + 1;
}

/** Quilometragem pronta para o cabeçalho do dashboard (§8). */
export function formatOdometer(odometerKm: number | null): string {
  if (odometerKm === null) return 'Quilometragem por registar';
  return `${formatKm(odometerKm)} km`;
}
