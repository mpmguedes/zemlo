/**
 * Análises agregadas por veículo (§8, §21, §23, §24).
 *
 * Este módulo carrega os dados de um veículo uma única vez e alimenta o dashboard, as
 * estatísticas, o calendário e a lista de sugestões. A alternativa — cada endpoint a
 * fazer as suas próprias consultas — produziria números ligeiramente diferentes no
 * dashboard e no ecrã de estatísticas para o mesmo veículo, que é a forma mais rápida
 * de perder a confiança do utilizador num produto de números.
 */

import type {
  CalendarEntry,
  CalendarResponse,
  CivilDate,
  DashboardResponse,
  DashboardVehicleRef,
  ExpenseCategory,
  Page,
  StatsResponse,
  StatusCard,
  TimelineItem,
  VehicleType,
} from '@zemlo/shared';
import {
  addDays,
  addMonths,
  endOfMonth,
  formatCents,
  formatKm,
  formatNumber,
  monthsBetween,
  optionIcon,
  startOfMonth,
  supportsCharging,
  supportsRefuelling,
  VEHICLE_TYPES,
} from '@zemlo/shared';
import { prisma } from '../core/db.js';
import { notFound } from '../core/errors.js';
import {
  advancedStats,
  comparePeriods,
  consumptionSummary,
  dataGaps,
  inRange,
  periodDistance,
  sumExpenses,
  totalsByCategory,
  totalsByMonth,
  unitCosts,
  type ExpenseEntry,
  type OdometerEntry,
} from '../domain/analysis.js';
import type { ChargingEntryInput, FuelEntryInput } from '../domain/calculations.js';
import { vehicleTitle, toCivilDate } from '../domain/payload.js';
import { reminderHeadlineValue, stateRank } from '../domain/reminders.js';
import { actionableReminders, loadReminderContext } from './reminders.js';
import { documentsExpiringSoon } from './documents.js';
import { generateSuggestions, loadSuggestionState, type SuggestionInput } from './suggestions.js';
import { buildTimeline, loadTimeline, toEventRows } from './timeline.js';
import { listVehicleEvents } from './events.js';

/* -------------------------------------------------------------------------- */
/* Carregamento                                                                */
/* -------------------------------------------------------------------------- */

export interface VehicleAnalytics {
  vehicle: {
    id: string;
    plateDisplay: string;
    make: string | null;
    model: string | null;
    nickname: string | null;
    odometerKm: number | null;
    odometerUpdatedAt: Date | null;
    fuelType: string;
    vehicleType: string;
    vin: string | null;
    year: number | null;
    /** Autonomia homologada, usada para estimar a autonomia a partir do estado de carga. */
    nominalRangeKm: number | null;
    purchaseDate: CivilDate | null;
    purchasePriceCents: number | null;
    purchaseOdometerKm: number | null;
    archived: boolean;
  };
  expenses: ExpenseEntry[];
  fuel: FuelEntryInput[];
  charging: ChargingEntryInput[];
  odometer: OdometerEntry[];
  counts: {
    expenses: number;
    fuel: number;
    charging: number;
    maintenance: number;
    insurance: number;
    inspections: number;
    taxes: number;
    documents: number;
    activeReminders: number;
  };
  firstRecordDate: CivilDate | null;
  lifetimeCostCents: number;
  /**
   * Estado de carga mais recente registado num carregamento.
   *
   * Vive aqui e não em `charging` porque `ChargingEntryInput` é a forma mínima de que o
   * cálculo de consumo precisa (data, energia, custo, odómetro) e não deve crescer com
   * campos que só servem a apresentação. Este é o único campo de estado da bateria que o
   * Zemlo conhece, e é uma medição datada — não uma leitura em tempo real.
   */
  latestSocPercent: number | null;
}

/** Número máximo de registos carregados por veículo para as agregações. */
const ANALYTICS_WINDOW = 5000;

/**
 * Carrega tudo o que é necessário para analisar um veículo.
 *
 * Os consumos de combustível e energia não podem ser calculados por SQL: dependem da
 * série cronológica completa (o consumo de um depósito depende do anterior), por isso
 * os registos são carregados e o cálculo acontece em `domain/calculations.ts`. Para o
 * volume de um veículo pessoal isto são algumas centenas de linhas — o mesmo
 * compromisso documentado em `records-financial.ts`.
 */
export async function loadVehicleAnalytics(
  userId: string,
  vehicleId: string,
): Promise<VehicleAnalytics> {
  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId } });
  if (!vehicle) throw notFound('Não encontrámos esse veículo.');

  const [expenseRows, fuelRows, chargingRows, odometerRows, maintenanceCount, documents, activeReminders, totals] =
    await Promise.all([
      prisma.expense.findMany({
        where: { vehicleId },
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
        take: ANALYTICS_WINDOW,
      }),
      prisma.fuelSession.findMany({
        where: { vehicleId },
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
        take: ANALYTICS_WINDOW,
      }),
      prisma.chargingSession.findMany({
        where: { vehicleId },
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
        take: ANALYTICS_WINDOW,
      }),
      prisma.odometerReading.findMany({
        where: { vehicleId },
        orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
        select: { recordedAt: true, odometerKm: true, isCorrection: true },
        take: ANALYTICS_WINDOW,
      }),
      prisma.maintenanceRecord.count({ where: { vehicleId } }),
      prisma.document.count({ where: { vehicleId } }),
      prisma.reminder.count({ where: { vehicleId, completedAt: null } }),
      prisma.expense.aggregate({ where: { vehicleId }, _sum: { amountCents: true } }),
    ]);

  const [insuranceCount, inspectionCount, taxCount] = await Promise.all([
    prisma.insurancePolicy.count({ where: { vehicleId } }),
    prisma.inspectionRecord.count({ where: { vehicleId } }),
    prisma.taxRecord.count({ where: { vehicleId } }),
  ]);

  const expenses: ExpenseEntry[] = expenseRows.map((row) => ({
    date: toCivilDate(row.date) as CivilDate,
    amountCents: row.amountCents,
    category: row.category as ExpenseCategory,
  }));

  const fuel: FuelEntryInput[] = fuelRows.map((row) => ({
    id: row.id,
    date: toCivilDate(row.date) as CivilDate,
    litres: row.litres,
    amountCents: row.amountCents,
    odometerKm: row.odometerKm,
    fullTank: row.fullTank,
    pricePerLitreCents: row.pricePerLitreCents,
  }));

  const charging: ChargingEntryInput[] = chargingRows.map((row) => ({
    id: row.id,
    date: toCivilDate(row.date) as CivilDate,
    energyKwh: row.energyKwh,
    amountCents: row.amountCents,
    odometerKm: row.odometerKm,
    pricePerKwhCents: row.pricePerKwhCents,
  }));

  const odometer: OdometerEntry[] = odometerRows.map((row) => ({
    date: toCivilDate(row.recordedAt) as CivilDate,
    odometerKm: row.odometerKm,
    isCorrection: row.isCorrection,
  }));

  const firstRecordDate =
    expenses[0]?.date ?? fuel[0]?.date ?? charging[0]?.date ?? odometer[0]?.date ?? null;

  // Estado de carga mais recente: procuramos de trás para a frente para usar a medição
  // mais recente que tenha SOC final registado.
  let latestSocPercent: number | null = null;
  for (let index = chargingRows.length - 1; index >= 0; index -= 1) {
    const session = chargingRows[index];
    if (session && session.endSocPercent !== null && session.endSocPercent !== undefined) {
      latestSocPercent = session.endSocPercent;
      break;
    }
  }

  return {
    vehicle: {
      id: vehicle.id,
      plateDisplay: vehicle.plateDisplay,
      make: vehicle.make,
      model: vehicle.model,
      nickname: vehicle.nickname,
      odometerKm: vehicle.odometerKm,
      odometerUpdatedAt: vehicle.odometerUpdatedAt,
      fuelType: vehicle.fuelType,
      vehicleType: vehicle.vehicleType,
      vin: vehicle.vin,
      year: vehicle.year,
      nominalRangeKm: vehicle.rangeKm,
      purchaseDate: toCivilDate(vehicle.purchaseDate),
      purchasePriceCents: vehicle.purchasePriceCents,
      purchaseOdometerKm: vehicle.purchaseOdometerKm,
      archived: vehicle.archived,
    },
    expenses,
    fuel,
    charging,
    odometer,
    counts: {
      expenses: expenses.length,
      fuel: fuel.length,
      charging: charging.length,
      maintenance: maintenanceCount,
      insurance: insuranceCount,
      inspections: inspectionCount,
      taxes: taxCount,
      documents,
      activeReminders,
    },
    firstRecordDate,
    lifetimeCostCents: totals._sum.amountCents ?? 0,
    latestSocPercent,
  };
}

/* -------------------------------------------------------------------------- */
/* Estatísticas (§23)                                                          */
/* -------------------------------------------------------------------------- */

export interface StatsOptions {
  year?: number | undefined;
  months?: number | undefined;
}

export function buildStats(
  analytics: VehicleAnalytics,
  options: StatsOptions & { today: CivilDate },
): StatsResponse {
  const today = options.today;
  const months = options.months ?? 12;
  const year = options.year ?? Number(today.slice(0, 4));

  const yearFrom = `${year}-01-01`;
  const yearTo = `${year}-12-31`;

  // Janela de análise: os últimos N meses até hoje.
  const windowFrom = addDays(addMonths(startOfMonth(today), -(months - 1)), 0);
  const windowTo = today;

  const yearExpenses = inRange(analytics.expenses, yearFrom, yearTo);
  const windowExpenses = inRange(analytics.expenses, windowFrom, windowTo);

  const distanceYear = periodDistance({
    from: yearFrom,
    to: yearTo,
    odometer: analytics.odometer,
    fuel: analytics.fuel,
    charging: analytics.charging,
  });
  const distanceWindow = periodDistance({
    from: windowFrom,
    to: windowTo,
    odometer: analytics.odometer,
    fuel: analytics.fuel,
    charging: analytics.charging,
  });

  const distanceAll = periodDistance({
    from: '1900-01-01',
    to: today,
    odometer: analytics.odometer,
    fuel: analytics.fuel,
    charging: analytics.charging,
  });

  const costs = unitCosts({
    from: yearFrom,
    to: yearTo,
    expenses: yearExpenses,
    distance: distanceYear,
  });

  const consumption = consumptionSummary({
    from: addMonths(startOfMonth(today), -(months - 1)),
    to: endOfMonth(today),
    fuel: analytics.fuel,
    charging: analytics.charging,
  });

  // Período anterior de igual duração, para a comparação (§23).
  //
  // A janela atual é inclusiva nas duas pontas, ou seja `windowDays` dias contados de
  // `windowFrom` a `windowTo`. O período anterior tem de ter exatamente o mesmo número de
  // dias: começa no dia seguinte ao fim desse intervalo e acaba na véspera do início da
  // janela atual. O `- windowDays - 1` anterior produzia uma janela de `windowDays + 1`
  // dias, pelo que a comparação opunha 16 dias a 32 — e o `deltaPercent` que alimenta a
  // frase "gastaste mais do que no período anterior" podia inverter de sinal no início de
  // um mês.
  const windowDays = daySpan(windowFrom, windowTo) + 1;
  const previousFrom = addDays(windowFrom, -windowDays);
  const previousTo = addDays(windowFrom, -1);
  const previousExpenses = inRange(analytics.expenses, previousFrom, previousTo);
  const previousDistance = periodDistance({
    from: previousFrom,
    to: previousTo,
    odometer: analytics.odometer,
    fuel: analytics.fuel,
    charging: analytics.charging,
  });

  const maintenanceCents = sumExpenses(
    yearExpenses.filter((item) => ['maintenance', 'tyres', 'repairs'].includes(item.category)),
  );
  const energyCents = sumExpenses(
    yearExpenses.filter((item) => ['fuel', 'charging'].includes(item.category)),
  );
  const fixedCents = sumExpenses(
    yearExpenses.filter((item) => ['insurance', 'tax', 'inspection'].includes(item.category)),
  );
  const totalCents = sumExpenses(yearExpenses);

  const advanced = advancedStats({
    purchaseDate: analytics.vehicle.purchaseDate,
    purchasePriceCents: analytics.vehicle.purchasePriceCents,
    purchaseOdometerKm: analytics.vehicle.purchaseOdometerKm,
    currentOdometerKm: analytics.vehicle.odometerKm,
    lifetimeCostCents: analytics.lifetimeCostCents,
    firstRecordDate: analytics.firstRecordDate,
    today,
  });

  const supportsRefuel = supportsRefuelling(analytics.vehicle.fuelType);
  const supportsCharge = supportsCharging(analytics.vehicle.fuelType);

  return {
    scope: {
      vehicleId: analytics.vehicle.id,
      vehicleLabel: vehicleTitle({
        make: analytics.vehicle.make,
        model: analytics.vehicle.model,
        nickname: analytics.vehicle.nickname,
        plateDisplay: analytics.vehicle.plateDisplay,
        plate: analytics.vehicle.plateDisplay,
      }),
      year,
      from: yearFrom,
      to: yearTo,
      months,
    },
    totals: {
      totalCents,
      energyCents,
      maintenanceCents,
      fixedCents,
      otherCents: totalCents - energyCents - maintenanceCents - fixedCents,
      count: yearExpenses.length,
    },
    distance: {
      kmThisYear: distanceYear.km,
      kmInWindow: distanceWindow.km,
      kmPerMonth:
        distanceWindow.km !== null && months > 0 ? Math.round(distanceWindow.km / months) : null,
      kmPerYear:
        distanceAll.km !== null && analytics.firstRecordDate !== null
          ? estimateKmPerYear(distanceAll.km, analytics.firstRecordDate, today)
          : null,
      firstReadingDate: distanceAll.firstReadingDate,
      lastReadingDate: distanceAll.lastReadingDate,
    },
    unitCosts: {
      costPerKmCents: costs.costPerKmCents,
      costPerMonthCents: costs.costPerMonthCents,
      costPerDayCents: costs.costPerDayCents,
      energyCostPerKmCents: costs.energyCostPerKmCents,
      maintenanceCostPerKmCents: costs.maintenanceCostPerKmCents,
    },
    consumption: {
      fuelL100Km: supportsRefuel ? consumption.fuelL100Km : null,
      fuelCostPerLitreCents: supportsRefuel ? consumption.fuelCostPerLitreCents : null,
      energyKwh100Km: supportsCharge ? consumption.energyKwh100Km : null,
      energyCostPerKwhCents: supportsCharge ? consumption.energyCostPerKwhCents : null,
      fuelMonthly: supportsRefuel ? consumption.fuelMonthly : [],
      energyMonthly: supportsCharge ? consumption.energyMonthly : [],
    },
    byCategory: totalsByCategory(yearExpenses),
    monthly: totalsByMonth(windowExpenses, windowFrom, endOfMonth(today)),
    comparison: comparePeriods({
      current: windowExpenses,
      previous: previousExpenses,
      previousKm: previousDistance.km,
      currentKm: distanceWindow.km,
    }),
    advanced: {
      ownershipMonths: advanced.ownershipMonths,
      totalCostOfOwnershipCents: advanced.totalCostOfOwnershipCents,
      depreciationCents: advanced.depreciationCents,
      residualValueCents: advanced.residualValueCents,
      valuePerKmCents: advanced.valuePerKmCents,
      assumptions: advanced.assumptions,
    },
  };
}

/** Estatísticas agregadas de todos os veículos do utilizador. */
export function buildAccountStats(
  analyticsList: VehicleAnalytics[],
  options: StatsOptions & { today: CivilDate; label: string },
): StatsResponse {
  const merged: VehicleAnalytics = {
    vehicle: {
      id: 'account',
      plateDisplay: options.label,
      make: null,
      model: null,
      nickname: options.label,
      odometerKm: sumOrNull(analyticsList.map((item) => item.vehicle.odometerKm)),
      odometerUpdatedAt: null,
      fuelType: 'other',
      vehicleType: 'car',
      vin: null,
      year: null,
      nominalRangeKm: null,
      purchaseDate: null,
      purchasePriceCents: null,
      purchaseOdometerKm: null,
      archived: false,
    },
    expenses: analyticsList.flatMap((item) => item.expenses),
    fuel: analyticsList.flatMap((item) => item.fuel),
    charging: analyticsList.flatMap((item) => item.charging),
    // A quilometragem não se soma entre veículos: somar odómetros não tem significado.
    // A distância agregada é calculada por veículo e somada no fim.
    odometer: [],
    counts: analyticsList.reduce(
      (accumulator, item) => ({
        expenses: accumulator.expenses + item.counts.expenses,
        fuel: accumulator.fuel + item.counts.fuel,
        charging: accumulator.charging + item.counts.charging,
        maintenance: accumulator.maintenance + item.counts.maintenance,
        insurance: accumulator.insurance + item.counts.insurance,
        inspections: accumulator.inspections + item.counts.inspections,
        taxes: accumulator.taxes + item.counts.taxes,
        documents: accumulator.documents + item.counts.documents,
        activeReminders: accumulator.activeReminders + item.counts.activeReminders,
      }),
      {
        expenses: 0,
        fuel: 0,
        charging: 0,
        maintenance: 0,
        insurance: 0,
        inspections: 0,
        taxes: 0,
        documents: 0,
        activeReminders: 0,
      },
    ),
    firstRecordDate: earliest(analyticsList.map((item) => item.firstRecordDate)),
    lifetimeCostCents: analyticsList.reduce((total, item) => total + item.lifetimeCostCents, 0),
    // O estado de carga não se agrega entre veículos: somar ou fazer a média de
    // percentagens de baterias diferentes não tem significado.
    latestSocPercent: null,
  };

  const stats = buildStats(merged, options);

  // A distância agregada é a soma das distâncias por veículo, não a distância de
  // odómetros somados — que não significaria nada.
  const perVehicleKm = analyticsList
    .map((item) =>
      periodDistance({
        from: `${options.year ?? Number(options.today.slice(0, 4))}-01-01`,
        to: `${options.year ?? Number(options.today.slice(0, 4))}-12-31`,
        odometer: item.odometer,
        fuel: item.fuel,
        charging: item.charging,
      }).km,
    )
    .filter((km): km is number => km !== null);

  const totalKm = perVehicleKm.length > 0 ? perVehicleKm.reduce((sum, km) => sum + km, 0) : null;

  return {
    ...stats,
    distance: {
      ...stats.distance,
      kmThisYear: totalKm,
      kmPerMonth: totalKm !== null && options.months ? Math.round(totalKm / (options.months ?? 12)) : null,
    },
    unitCosts: {
      ...stats.unitCosts,
      costPerKmCents:
        totalKm !== null && totalKm > 0 ? Math.round(stats.totals.totalCents / totalKm) : null,
      energyCostPerKmCents:
        totalKm !== null && totalKm > 0 ? Math.round(stats.totals.energyCents / totalKm) : null,
      maintenanceCostPerKmCents:
        totalKm !== null && totalKm > 0 ? Math.round(stats.totals.maintenanceCents / totalKm) : null,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Dashboard (§8)                                                              */
/* -------------------------------------------------------------------------- */

export interface BuildDashboardInput {
  userId: string;
  timeZone: string;
  vehicles: Array<{ id: string; plateDisplay: string; odometerKm: number | null; make: string | null; model: string | null; nickname: string | null; fuelType: string; vehicleType: string; vin: string | null; year: number | null }>;
  analytics: VehicleAnalytics | null;
  today: CivilDate;
}

export async function buildDashboard(input: BuildDashboardInput): Promise<DashboardResponse> {
  const { userId, timeZone, vehicles, analytics, today } = input;

  const vehicleRefs: DashboardVehicleRef[] = vehicles.map((vehicle) => ({
    id: vehicle.id,
    plateDisplay: vehicle.plateDisplay,
    title: vehicleTitle({
      make: vehicle.make,
      model: vehicle.model,
      nickname: vehicle.nickname,
      plateDisplay: vehicle.plateDisplay,
      plate: vehicle.plateDisplay,
    }),
    subtitle: [vehicle.make, vehicle.model].filter(Boolean).join(' ') || null,
    emoji: optionIcon(VEHICLE_TYPES, vehicle.vehicleType as VehicleType),
    odometerKm: vehicle.odometerKm,
    odometerSourceLabel: null,
  }));

  if (!analytics) {
    // Conta sem veículos: o dashboard devolve a estrutura completa mas vazia, para que
    // o cliente possa mostrar o ecrã de boas-vindas sem casos especiais (§46).
    return {
      vehicle: null,
      vehicles: vehicleRefs,
      status: [],
      finance: {
        year: Number(today.slice(0, 4)),
        yearTotalCents: 0,
        monthTotalCents: 0,
        monthAverageCents: null,
        previousYearSamePeriodCents: 0,
        byCategory: totalsByCategory([]),
        monthly: [],
      },
      usage: {
        odometerKm: null,
        kmThisYear: null,
        costPerKmCents: null,
        kmPerMonth: null,
        fuelConsumptionL100Km: null,
        energyConsumptionKwh100Km: null,
      },
      suggestions: [],
      upcoming: [],
      counts: { vehicles: 0, recordsThisYear: 0, documents: 0 },
      dataGaps: [
        {
          key: 'vehicle',
          title: 'Primeiro veículo',
          message: 'Adiciona o teu primeiro veículo e o Zemlo começa a organizar tudo por ti.',
          href: '/onboarding',
        },
      ],
    };
  }

  const currentYear = Number(today.slice(0, 4));
  const yearFrom = `${currentYear}-01-01`;
  const yearTo = `${currentYear}-12-31`;
  const yearExpenses = inRange(analytics.expenses, yearFrom, yearTo);

  const monthFrom = startOfMonth(today);
  const monthTo = endOfMonth(today);
  const monthTotalCents = sumExpenses(inRange(analytics.expenses, monthFrom, monthTo));

  // Comparação com o mesmo período do ano anterior — até ao mesmo dia, para não
  // comparar um ano inteiro com um ano a meio.
  const previousYearFrom = `${currentYear - 1}-01-01`;
  const previousYearTo = `${currentYear - 1}${today.slice(4)}`;
  const previousYearSamePeriodCents = sumExpenses(
    inRange(analytics.expenses, previousYearFrom, previousYearTo),
  );

  const distanceYear = periodDistance({
    from: yearFrom,
    to: yearTo,
    odometer: analytics.odometer,
    fuel: analytics.fuel,
    charging: analytics.charging,
  });

  const costs = unitCosts({ from: yearFrom, to: yearTo, expenses: yearExpenses, distance: distanceYear });

  const consumption = consumptionSummary({
    from: addMonths(startOfMonth(today), -11),
    to: endOfMonth(today),
    fuel: analytics.fuel,
    charging: analytics.charging,
  });

  const supportsRefuel = supportsRefuelling(analytics.vehicle.fuelType);
  const supportsCharge = supportsCharging(analytics.vehicle.fuelType);

  const status = await buildStatusCards(userId, analytics, { today, timeZone });

  const events = await listVehicleEvents(analytics.vehicle.id, 20);
  const upcoming = buildTimeline(
    toEventRows(events),
    { plateDisplay: analytics.vehicle.plateDisplay },
    { from: today, to: addDays(today, 120) },
  );

  const suggestionState = await loadSuggestionState(userId);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      createdAt: true,
      twoFactorEnabled: true,
      preferences: {
        select: {
          suggestionsEnabled: true,
          securityNudgeSnoozeDays: true,
          frequentExpenseCategories: true,
        },
      },
    },
  });

  const suggestions = generateSuggestions(
    buildSuggestionInput({
      userId,
      analytics,
      suggestionState,
      timeZone,
      twoFactorEnabled: user?.twoFactorEnabled ?? false,
      accountCreatedAt: user?.createdAt ?? new Date(),
      securityNudgeSnoozeDays: user?.preferences?.securityNudgeSnoozeDays ?? 90,
      suggestionsEnabled: user?.preferences?.suggestionsEnabled ?? true,
      frequentCategories: readCategoryList(user?.preferences?.frequentExpenseCategories),
    }),
  );

  const gaps = dataGaps({
    odometerKm: analytics.vehicle.odometerKm,
    hasInsurance: analytics.counts.insurance > 0,
    hasInspection: analytics.counts.inspections > 0,
    hasMaintenancePlan: analytics.counts.activeReminders > 0,
    hasExpenses: analytics.counts.expenses > 0,
    hasFuelOrCharging: analytics.counts.fuel + analytics.counts.charging > 0,
    vehicleId: analytics.vehicle.id,
    supportsRefuelling: supportsRefuel,
    supportsCharging: supportsCharge,
  });

  const monthlyWindow = totalsByMonth(
    inRange(analytics.expenses, addMonths(startOfMonth(today), -11), endOfMonth(today)),
    addMonths(startOfMonth(today), -11),
    endOfMonth(today),
  );

  return {
    vehicle: vehicleRefs.find((ref) => ref.id === analytics.vehicle.id) ?? null,
    vehicles: vehicleRefs,
    status,
    finance: {
      year: currentYear,
      yearTotalCents: sumExpenses(yearExpenses),
      monthTotalCents,
      monthAverageCents: computeMonthAverage(yearExpenses, today),
      previousYearSamePeriodCents,
      byCategory: totalsByCategory(yearExpenses),
      monthly: monthlyWindow,
    },
    usage: {
      odometerKm: analytics.vehicle.odometerKm,
      kmThisYear: distanceYear.km,
      costPerKmCents: costs.costPerKmCents,
      kmPerMonth:
        distanceYear.km !== null
          ? Math.round(distanceYear.km / Math.max(monthsBetween(yearFrom, today).length, 1))
          : null,
      fuelConsumptionL100Km: supportsRefuel ? consumption.fuelL100Km : null,
      energyConsumptionKwh100Km: supportsCharge ? consumption.energyKwh100Km : null,
    },
    suggestions,
    upcoming: upcoming.slice(0, 5),
    counts: {
      vehicles: vehicles.length,
      recordsThisYear: analytics.expenses.filter((item) => item.date >= yearFrom).length,
      documents: analytics.counts.documents,
    },
    dataGaps: gaps,
  };
}

/* -------------------------------------------------------------------------- */
/* Cartões de estado (§8)                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Constrói os cartões de estado do dashboard.
 *
 * Os cartões são o que o utilizador vê primeiro, por isso a ordem é fixa e previsível:
 * manutenção, seguro, inspeção. Um cartão sem dados aparece com estado `unknown` e uma
 * instrução, em vez de desaparecer — é assim que o Zemlo pede o dado em falta sem
 * parecer um erro (§6, §46).
 */
export async function buildStatusCards(
  userId: string,
  analytics: VehicleAnalytics,
  context: { today: CivilDate; timeZone: string },
): Promise<StatusCard[]> {
  const { today, timeZone } = context;
  const cards: StatusCard[] = [];

  const vehicles = [
    {
      id: analytics.vehicle.id,
      odometerKm: analytics.vehicle.odometerKm,
      plateDisplay: analytics.vehicle.plateDisplay,
    },
  ];

  const reminders = await actionableReminders(userId, vehicles, { timeZone });
  const nextService = reminders.find((item) => item.reminder.evaluation.state !== 'ok');

  if (nextService) {
    cards.push({
      key: 'next_service',
      label: nextService.reminder.title,
      value: reminderHeadlineValue(nextService.reminder.evaluation),
      hint: nextService.reminder.evaluation.summary,
      state: nextService.reminder.evaluation.state,
      icon: '🔧',
      href: `/vehicles/${analytics.vehicle.id}?tab=reminders`,
    });
  } else {
    cards.push({
      key: 'next_service',
      label: 'Próxima manutenção',
      value: 'Sem plano',
      hint:
        analytics.vehicle.odometerKm === null
          ? 'Adiciona a quilometragem para projetarmos a próxima revisão.'
          : 'Define a próxima revisão e avisamos-te na altura certa.',
      state: 'unknown',
      icon: '🔧',
      href: `/vehicles/${analytics.vehicle.id}?sheet=reminder`,
    });
  }

  // Seguro e inspeção vivem nas respetivas tabelas, não em lembretes: o cartão lê o
  // documento diretamente, para que a data mostrada seja a da apólice e não uma cópia.
  const [latestInsurance, latestInspection, expiringDocuments] = await Promise.all([
    prisma.insurancePolicy.findFirst({
      where: { vehicleId: analytics.vehicle.id },
      orderBy: { endDate: 'desc' },
    }),
    prisma.inspectionRecord.findFirst({
      // Só conta uma inspeção que tenha a próxima data registada. Uma inspeção sem
      // validade (importada, ou registada antes de o utilizador a conhecer) não deve
      // fazer o cartão dizer "Por registar" quando existe outra com data conhecida —
      // e também não deve aparecer à frente dela por ordem alfabética de nulos (§46).
      where: { vehicleId: analytics.vehicle.id, nextDueDate: { not: null } },
      orderBy: { nextDueDate: 'desc' },
    }),
    documentsExpiringSoon(userId, today, 60),
  ]);

  const vehicleReminders = await loadReminderContext(userId, {
    id: analytics.vehicle.id,
    odometerKm: analytics.vehicle.odometerKm,
  });

  if (latestInsurance) {
    const endDate = toCivilDate(latestInsurance.endDate) as CivilDate;
    const daysRemaining = daySpan(today, endDate);
    cards.push({
      key: 'insurance',
      label: 'Seguro',
      value: `${Math.abs(daysRemaining)} ${Math.abs(daysRemaining) === 1 ? 'dia' : 'dias'}`,
      hint: `${latestInsurance.insurer}${daysRemaining < 0 ? ' · expirado' : ''}`,
      state: reminderStateForDays(daysRemaining, vehicleReminders.leadDays),
      icon: '🛡️',
      href: `/vehicles/${analytics.vehicle.id}?tab=insurance`,
    });
  } else {
    cards.push({
      key: 'insurance',
      label: 'Seguro',
      value: 'Por registar',
      hint: 'Falta apenas o seguro deste veículo.',
      state: 'unknown',
      icon: '🛡️',
      href: `/vehicles/${analytics.vehicle.id}?sheet=insurance`,
    });
  }

  const inspectionDue = latestInspection?.nextDueDate
    ? (toCivilDate(latestInspection.nextDueDate) as CivilDate)
    : null;

  if (inspectionDue) {
    const daysRemaining = daySpan(today, inspectionDue);
    cards.push({
      key: 'inspection',
      label: 'Inspeção',
      value: `${Math.abs(daysRemaining)} ${Math.abs(daysRemaining) === 1 ? 'dia' : 'dias'}`,
      hint: `${inspectionDue}${daysRemaining < 0 ? ' · em atraso' : ''}`,
      state: reminderStateForDays(daysRemaining, vehicleReminders.leadDays),
      icon: '📋',
      href: `/vehicles/${analytics.vehicle.id}?tab=inspections`,
    });
  } else {
    cards.push({
      key: 'inspection',
      label: 'Inspeção',
      value: 'Por registar',
      hint: 'Regista a última inspeção e lembramos-te da próxima.',
      state: 'unknown',
      icon: '📋',
      href: `/vehicles/${analytics.vehicle.id}?sheet=inspection`,
    });
  }

  // Documentos: só aparece quando existe algo a expirar, para não ocupar espaço com
  // uma categoria vazia (§3.5).
  const upcomingDocument = expiringDocuments.find((document) => document.vehicleId === analytics.vehicle.id);
  if (upcomingDocument && upcomingDocument.daysToExpiry !== null) {
    cards.push({
      key: 'documents',
      label: 'Documento',
      value: `${Math.abs(upcomingDocument.daysToExpiry)} ${Math.abs(upcomingDocument.daysToExpiry) === 1 ? 'dia' : 'dias'}`,
      hint: upcomingDocument.name,
      state: reminderStateForDays(upcomingDocument.daysToExpiry, vehicleReminders.leadDays),
      icon: '📄',
      href: `/vehicles/${analytics.vehicle.id}?tab=documents`,
    });
  }

  return cards.sort((a, b) => stateRank(a.state) - stateRank(b.state));
}

/* -------------------------------------------------------------------------- */
/* Calendário (§21)                                                            */
/* -------------------------------------------------------------------------- */

export async function buildCalendar(
  userId: string,
  options: { from: CivilDate; to: CivilDate; vehicleId?: string | undefined; timeZone: string },
): Promise<CalendarResponse> {
  const vehicles = await prisma.vehicle.findMany({
    where: { userId, ...(options.vehicleId ? { id: options.vehicleId } : {}) },
    select: { id: true, plateDisplay: true, odometerKm: true },
  });
  if (vehicles.length === 0) {
    return { from: options.from, to: options.to, entries: [], days: [] };
  }

  const entries: CalendarEntry[] = [];

  // 1. Lembretes (incluindo os projetados por quilometragem).
  const reminders = await actionableReminders(userId, vehicles, {
    from: options.from,
    to: options.to,
    timeZone: options.timeZone,
  });

  for (const item of reminders) {
    const date = item.reminder.evaluation.projectedDate ?? item.reminder.dueDate;
    if (!date) continue;
    entries.push({
      id: `reminder:${item.reminder.id}`,
      date,
      kind: 'reminder',
      title: item.reminder.title,
      subtitle: item.reminder.evaluation.summary,
      icon: '🔔',
      state: item.reminder.evaluation.state,
      vehicleId: item.vehicleId,
      vehiclePlateDisplay: item.plateDisplay,
      amountCents: null,
      href: `/vehicles/${item.vehicleId}?tab=reminders`,
      // Uma data projetada a partir do ritmo de quilometragem não é um compromisso:
      // o calendário tem de a distinguir visualmente de uma data confirmada.
      projected: item.reminder.evaluation.projectedDate !== null && item.reminder.dueDate === null,
    });
  }

  // 2. Datas de validade (seguro, inspeção, impostos, documentos).
  const vehicleIds = vehicles.map((vehicle) => vehicle.id);
  const [insurances, inspections, taxes, documents] = await Promise.all([
    prisma.insurancePolicy.findMany({
      where: { vehicleId: { in: vehicleIds }, endDate: { gte: new Date(`${options.from}T00:00:00.000Z`), lte: new Date(`${options.to}T00:00:00.000Z`) } },
    }),
    prisma.inspectionRecord.findMany({
      where: {
        vehicleId: { in: vehicleIds },
        nextDueDate: { gte: new Date(`${options.from}T00:00:00.000Z`), lte: new Date(`${options.to}T00:00:00.000Z`) },
      },
    }),
    prisma.taxRecord.findMany({
      where: {
        vehicleId: { in: vehicleIds },
        dueDate: { gte: new Date(`${options.from}T00:00:00.000Z`), lte: new Date(`${options.to}T00:00:00.000Z`) },
        paid: false,
      },
    }),
    prisma.document.findMany({
      where: {
        userId,
        /*
         * O filtro por veículo é obrigatório aqui.
         *
         * Sem ele, o calendário de um veículo mostrava validades dos documentos de **todos**
         * os veículos da conta: selecionar o carro A mostrava o documento do carro B numa
         * data que nada tem a ver com A, e sem placa que permitisse perceber de onde vinha.
         * O contador de entradas por dia — que é o objetivo do resumo do calendário —
         * ficava igualmente inflacionado.
         *
         * Os documentos sem veículo (carta de condução, por exemplo) continuam a aparecer
         * na vista agregada da conta, que é o único sítio onde fazem sentido.
         */
        ...(options.vehicleId ? { vehicleId: options.vehicleId } : {}),
        expiresAt: {
          gte: new Date(`${options.from}T00:00:00.000Z`),
          lte: new Date(`${options.to}T00:00:00.000Z`),
        },
      },
    }),
  ]);

  const plateFor = (vehicleId: string): string =>
    vehicles.find((vehicle) => vehicle.id === vehicleId)?.plateDisplay ?? '';

  for (const insurance of insurances) {
    entries.push({
      id: `insurance:${insurance.id}`,
      date: toCivilDate(insurance.endDate) as CivilDate,
      kind: 'insurance',
      title: `Fim do seguro · ${insurance.insurer}`,
      subtitle: insurance.premiumCents !== null ? formatCents(insurance.premiumCents) : null,
      icon: '🛡️',
      state: null,
      vehicleId: insurance.vehicleId,
      vehiclePlateDisplay: plateFor(insurance.vehicleId),
      amountCents: insurance.premiumCents,
      href: `/vehicles/${insurance.vehicleId}?tab=insurance`,
      projected: false,
    });
  }

  for (const inspection of inspections) {
    if (!inspection.nextDueDate) continue;
    entries.push({
      id: `inspection:${inspection.id}`,
      date: toCivilDate(inspection.nextDueDate) as CivilDate,
      kind: 'inspection',
      title: 'Inspeção periódica',
      subtitle: inspection.station,
      icon: '📋',
      state: null,
      vehicleId: inspection.vehicleId,
      vehiclePlateDisplay: plateFor(inspection.vehicleId),
      amountCents: null,
      href: `/vehicles/${inspection.vehicleId}?tab=inspections`,
      projected: false,
    });
  }

  for (const tax of taxes) {
    if (!tax.dueDate) continue;
    entries.push({
      id: `tax:${tax.id}`,
      date: toCivilDate(tax.dueDate) as CivilDate,
      kind: 'tax',
      title: tax.kind === 'iuc' ? `IUC ${tax.year}` : `Imposto ${tax.year}`,
      subtitle: formatCents(tax.amountCents),
      icon: '🏛️',
      state: null,
      vehicleId: tax.vehicleId,
      vehiclePlateDisplay: plateFor(tax.vehicleId),
      amountCents: tax.amountCents,
      href: `/vehicles/${tax.vehicleId}?tab=taxes`,
      projected: false,
    });
  }

  for (const document of documents) {
    if (!document.expiresAt) continue;
    entries.push({
      id: `document:${document.id}`,
      date: toCivilDate(document.expiresAt) as CivilDate,
      kind: 'document',
      title: `Validade · ${document.name}`,
      subtitle: null,
      icon: '📄',
      state: null,
      vehicleId: document.vehicleId ?? '',
      vehiclePlateDisplay: document.vehicleId ? plateFor(document.vehicleId) : '',
      amountCents: null,
      href: document.vehicleId ? `/vehicles/${document.vehicleId}?tab=documents` : '/settings',
      projected: false,
    });
  }

  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.title.localeCompare(b.title)));

  // Resumo por dia, para desenhar a grelha do mês sem percorrer as entradas.
  const dayMap = new Map<string, { count: number; hasOverdue: boolean }>();
  for (const entry of entries) {
    const current = dayMap.get(entry.date) ?? { count: 0, hasOverdue: false };
    dayMap.set(entry.date, {
      count: current.count + 1,
      hasOverdue: current.hasOverdue || entry.state === 'overdue',
    });
  }

  return {
    from: options.from,
    to: options.to,
    entries,
    days: [...dayMap.entries()].map(([date, value]) => ({ date, ...value })),
  };
}

/* -------------------------------------------------------------------------- */
/* Timeline (§24)                                                              */
/* -------------------------------------------------------------------------- */

export async function getTimeline(
  userId: string,
  options: {
    vehicleId?: string | undefined;
    limit: number;
    cursor?: string | undefined;
    kinds?: string[] | undefined;
    from?: CivilDate | undefined;
    to?: CivilDate | undefined;
    timeZone: string;
  },
): Promise<Page<TimelineItem>> {
  const vehicles = await prisma.vehicle.findMany({
    where: { userId, ...(options.vehicleId ? { id: options.vehicleId } : {}) },
    select: { id: true, plateDisplay: true },
  });
  if (options.vehicleId && vehicles.length === 0) throw notFound('Não encontrámos esse veículo.');

  return loadTimeline(vehicles, options);
}

/* -------------------------------------------------------------------------- */
/* Auxiliares internos                                                         */
/* -------------------------------------------------------------------------- */

function buildSuggestionInput(input: {
  userId: string;
  analytics: VehicleAnalytics;
  suggestionState: Awaited<ReturnType<typeof loadSuggestionState>>;
  timeZone: string;
  twoFactorEnabled: boolean;
  accountCreatedAt: Date;
  securityNudgeSnoozeDays: number;
  suggestionsEnabled: boolean;
  frequentCategories: string[];
}): SuggestionInput {
  return {
    userId: input.userId,
    vehicle: {
      id: input.analytics.vehicle.id,
      plateDisplay: input.analytics.vehicle.plateDisplay,
      odometerKm: input.analytics.vehicle.odometerKm,
      fuelType: input.analytics.vehicle.fuelType,
      make: input.analytics.vehicle.make,
      model: input.analytics.vehicle.model,
      vin: input.analytics.vehicle.vin,
      year: input.analytics.vehicle.year,
    },
    counts: {
      expenses: input.analytics.counts.expenses,
      fuelAndCharging: input.analytics.counts.fuel + input.analytics.counts.charging,
      insurance: input.analytics.counts.insurance,
      inspections: input.analytics.counts.inspections,
      activeReminders: input.analytics.counts.activeReminders,
      documents: input.analytics.counts.documents,
    },
    frequentCategories: input.frequentCategories,
    enabled: input.suggestionsEnabled,
    timeZone: input.timeZone,
    completedKeys: input.suggestionState.completedKeys,
    states: input.suggestionState.states,
    twoFactorEnabled: input.twoFactorEnabled,
    securityNudgeSnoozeDays: input.securityNudgeSnoozeDays,
    securityNudgeSnoozedUntil: null,
    accountCreatedAt: input.accountCreatedAt,
  };
}

function readCategoryList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

function reminderStateForDays(days: number, leadDays: number) {
  if (days < 0) return 'overdue' as const;
  if (days === 0) return 'due' as const;
  if (days <= leadDays) return 'soon' as const;
  return 'ok' as const;
}

/** Número de dias entre duas datas civis. */
function daySpan(from: CivilDate, to: CivilDate): number {
  const [y1, m1, d1] = from.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = to.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

function computeMonthAverage(expenses: readonly ExpenseEntry[], today: CivilDate): number | null {
  if (expenses.length === 0) return null;
  const months = Math.max(monthsBetween(`${today.slice(0, 4)}-01-01`, today).length, 1);
  return Math.round(sumExpenses(expenses) / months);
}

function estimateKmPerYear(km: number, from: CivilDate, to: CivilDate): number | null {
  const days = Math.max(daySpan(from, to), 1);
  if (days < 30) return null;
  return Math.round((km / days) * 365.25);
}

function sumOrNull(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : present.reduce((sum, value) => sum + value, 0);
}

function earliest(dates: Array<CivilDate | null>): CivilDate | null {
  const present = dates.filter((date): date is CivilDate => date !== null).sort();
  return present[0] ?? null;
}

/** Formata uma quantidade de energia para os cartões do dashboard. */
export function formatEnergyShort(kwh: number): string {
  return `${formatNumber(kwh, 1)} kWh`;
}

/** Formata uma quilometragem para os cartões do dashboard. */
export function formatDistanceShort(km: number): string {
  return `${formatKm(km)} km`;
}
