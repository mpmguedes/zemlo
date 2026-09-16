/**
 * Veículos e quilometragem (§9, §10, §11, §50, §51).
 *
 * Toda a função que toca num veículo começa por `requireVehicleAccess`. É a única
 * forma de garantir a separação entre dados de utilizadores (§30): não há uma consulta
 * a um veículo que não passe pela verificação de que pertence a quem pede.
 */

import type {
  OdometerCreateRequest,
  ProviderKind,
  SourceInfo,
  VehicleCreateRequest,
  VehicleDetail,
  VehicleSummary,
  VehicleUpdateRequest,
} from '@zemlo/shared';
import {
  MAX_PLAUSIBLE_KM_PER_DAY,
  evaluateOdometerReading,
  estimateUsageRate,
  type UsageRate,
} from '../domain/odometer.js';
import { mapOdometerReading, mapVehicleDetail, mapVehicleSummary, toCivilDate, fromCivilDate } from '../domain/payload.js';
import { prisma } from '../core/db.js';
import { conflict, notFound, translatePrismaError, unprocessable } from '../core/errors.js';
import { jsonOrNull, writeJson } from '../core/json.js';
import {
  DEFAULT_TIME_ZONE,
  isValidVin,
  normalizePlate,
  normalizeVin,
  todayIn,
  type CivilDate,
} from '@zemlo/shared';
import { audit } from './audit.js';
import { recordEvent } from './events.js';

/* -------------------------------------------------------------------------- */
/* Acesso                                                                      */
/* -------------------------------------------------------------------------- */

/** Garante que o veículo existe e pertence ao utilizador; devolve-o. */
export async function requireVehicleAccess(userId: string, vehicleId: string) {
  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId } });
  if (!vehicle) {
    // A mesma resposta para "não existe" e "não é teu": distinguir os casos revelaria
    // a existência de veículos de outros utilizadores.
    throw notFound('Não encontrámos esse veículo.');
  }
  return vehicle;
}

/**
 * Normaliza um VIN: maiúsculas e sem separadores.
 *
 * Não valida nem recusa — a decisão de aceitar um VIN que não cumpre a letra de controlo
 * pertence ao produto, e o Zemlo aceita (§49). Devolve `null` para um valor vazio.
 */
function normalizeVinOrNull(vin: string | null | undefined): string | null {
  if (vin === null || vin === undefined) return null;
  const normalized = normalizeVin(vin);
  return normalized === '' ? null : normalized;
}

/**
 * Fuso horário do utilizador.
 *
 * "Hoje" tem de ser o dia do utilizador, não o do servidor (§ dates.ts, decisão A4). Sem
 * isto, uma leitura de odómetro registada por um utilizador em UTC+14 ficaria com a data
 * do servidor — um dia antes — e o mesmo instante produziria datas diferentes conforme o
 * ecrã por onde o registo entrou. A divergência apareceria como uma inconsistência
 * interna, não como um desvio uniforme, o que a torna muito mais difícil de diagnosticar.
 */
async function userTimeZone(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } });
  return user?.timeZone ?? DEFAULT_TIME_ZONE;
}

/** Lista os veículos do utilizador, ordenados por atividade recente. */
export async function listVehicles(userId: string, includeArchived = false): Promise<VehicleSummary[]> {
  const vehicles = await prisma.vehicle.findMany({
    where: { userId, ...(includeArchived ? {} : { archived: false }) },
    orderBy: [{ archived: 'asc' }, { updatedAt: 'desc' }],
  });
  return vehicles.map(mapVehicleSummary);
}

/**
 * Resolve o veículo a que um registo pertence.
 *
 * Quando o pedido não indica veículo, usamos o mais recentemente atualizado. Com um
 * único veículo — o caso da esmagadora maioria no início — isto significa que o
 * utilizador nunca vê o campo "veículo", que é exatamente o objetivo (§44). Com vários
 * veículos, o cliente envia o identificador e a escolha é explícita.
 */
export async function resolveVehicleId(userId: string, vehicleId: string | undefined): Promise<string>;
export async function resolveVehicleId(
  userId: string,
  vehicleId: string | undefined,
  options: { optional: true },
): Promise<string | null>;
export async function resolveVehicleId(
  userId: string,
  vehicleId: string | undefined,
  options: { optional?: true } = {},
): Promise<string | null> {
  if (vehicleId) {
    await requireVehicleAccess(userId, vehicleId);
    return vehicleId;
  }
  if (options.optional) return null;

  const vehicle = await prisma.vehicle.findFirst({
    where: { userId, archived: false },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });
  if (!vehicle) {
    throw unprocessable(
      'Ainda não tens veículos. Adiciona o teu primeiro veículo para começares a registar.',
      { action: 'create_vehicle' },
    );
  }
  return vehicle.id;
}

/** Ficha completa do veículo, com contadores e custo total. */
export async function getVehicleDetail(userId: string, vehicleId: string): Promise<VehicleDetail> {
  const vehicle = await requireVehicleAccess(userId, vehicleId);

  const [expenses, fuel, charging, maintenance, documents, reminders, expenseTotal] = await Promise.all([
    prisma.expense.count({ where: { vehicleId } }),
    prisma.fuelSession.count({ where: { vehicleId } }),
    prisma.chargingSession.count({ where: { vehicleId } }),
    prisma.maintenanceRecord.count({ where: { vehicleId } }),
    prisma.document.count({ where: { vehicleId } }),
    prisma.reminder.count({ where: { vehicleId, completedAt: null } }),
    prisma.expense.aggregate({ where: { vehicleId }, _sum: { amountCents: true } }),
  ]);

  return mapVehicleDetail(
    vehicle,
    {
      expenses,
      fuel,
      charging,
      maintenance,
      documents,
      reminders,
    },
    expenseTotal._sum.amountCents ?? 0,
  );
}

/* -------------------------------------------------------------------------- */
/* Criação                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Cria um veículo.
 *
 * Só a matrícula é obrigatória (§5). O Zemlo aceita deliberadamente um veículo com
 * apenas uma matrícula — é o que permite o onboarding de três passos existir — e
 * enriquece-o depois, à medida que o utilizador quiser (§6, §49).
 */
export async function createVehicle(userId: string, input: VehicleCreateRequest): Promise<VehicleDetail> {
  const plate = normalizePlate(input.plate);
  if (!plate.valid) {
    throw unprocessable('A matrícula indicada não parece válida. Podes corrigi-la mais tarde na ficha do veículo.');
  }

  const existing = await prisma.vehicle.findFirst({ where: { userId, plate: plate.value } });
  if (existing) {
    throw conflict('Já tens um veículo registado com esta matrícula.');
  }

  const today = todayIn(await userTimeZone(userId));

  try {
    const vehicle = await prisma.vehicle.create({
      data: {
        userId,
        plate: plate.value,
        plateDisplay: plate.display,
        // O VIN é normalizado e a sua **forma** é validada (17 caracteres, sem I/O/Q).
        // A letra de controlo (ISO 3779) é verificada mas apenas gera um evento com aviso:
        // recusar a gravação com base nela impediria de registar veículos legítimos que
        // não a cumprem (anteriores à norma, alguns mercados). O utilizador é informado
        // sem ser bloqueado (§49).
        vin: normalizeVinOrNull(input.vin),
        make: input.make ?? null,
        model: input.model ?? null,
        version: input.version ?? null,
        year: input.year ?? null,
        vehicleType: input.vehicleType ?? 'car',
        fuelType: input.fuelType ?? 'gasoline',
        color: input.color ?? null,
        nickname: input.nickname ?? null,
        engineCode: input.engineCode ?? null,
        powerCv: input.powerCv ?? null,
        engineDisplacementCc: input.engineDisplacementCc ?? null,
        transmission: input.transmission ?? null,
        drivetrain: input.drivetrain ?? null,
        batteryCapacityKwh: input.batteryCapacityKwh ?? null,
        usableBatteryKwh: input.usableBatteryKwh ?? null,
        rangeKm: input.rangeKm ?? null,
        tankCapacityL: input.tankCapacityL ?? null,
        tyreSize: input.tyreSize ?? null,
        wheelSize: input.wheelSize ?? null,
        weightKg: input.weightKg ?? null,
        co2GKm: input.co2GKm ?? null,
        purchaseDate: fromCivilDate(input.purchaseDate ?? null),
        purchasePriceCents: input.purchasePriceCents ?? null,
        purchaseOdometerKm: input.purchaseOdometerKm ?? null,
        registrationDate: fromCivilDate(input.registrationDate ?? null),
        firstRegistrationDate: fromCivilDate(input.firstRegistrationDate ?? null),
        notes: input.notes ?? null,
        odometerKm: input.odometerKm ?? null,
        odometerSource:
          input.odometerKm !== undefined && input.odometerKm !== null
            ? writeJson(normalizeSource(input.source, 'manual'))
            : jsonOrNull(null),
        odometerUpdatedAt: input.odometerKm !== undefined && input.odometerKm !== null ? new Date() : null,
      },
    });

    await recordEvent({
      vehicleId: vehicle.id,
      userId,
      type: 'vehicle.created',
      date: today,
      title: 'Veículo criado',
      summary: plate.display,
      amountCents: null,
      odometerKm: vehicle.odometerKm,
      recordType: 'vehicle',
      recordId: vehicle.id,
      source: normalizeSource(input.source, 'manual'),
    });

    /*
     * VIN com forma válida mas letra de controlo errada.
     *
     * Não bloqueia o registo — há veículos legítimos que não cumprem a ISO 3779, e recusar
     * o veículo por causa disso seria pior do que o problema. Mas fica registado na
     * timeline, para que o utilizador possa confirmar o número quando for compará-lo com
     * uma integração ou com um documento. Sem isto, um erro de um dígito no VIN passaria a
     * ser um identificador permanente e invisível.
     */
    if (vehicle.vin && !isValidVin(vehicle.vin)) {
      await recordEvent({
        vehicleId: vehicle.id,
        userId,
        type: 'note',
        date: today,
        title: 'Confirma o número de chassis',
        summary: `O VIN ${vehicle.vin} não passa a verificação da letra de controlo. Pode estar correto, mas vale a pena confirmá-lo na ficha do veículo.`,
        amountCents: null,
        odometerKm: null,
        recordType: 'vehicle',
        recordId: vehicle.id,
        source: null,
      });
    }

    if (input.odometerKm !== undefined && input.odometerKm !== null) {
      await prisma.odometerReading.create({
        data: {
          vehicleId: vehicle.id,
          odometerKm: input.odometerKm,
          recordedAt: fromCivilDate(today) as Date,
          source: writeJson(normalizeSource(input.source, 'manual')),
          origin: 'vehicle',
        },
      });
      await recordEvent({
        vehicleId: vehicle.id,
        userId,
        type: 'odometer.recorded',
        date: today,
        title: 'Quilometragem registada',
        summary: null,
        amountCents: null,
        odometerKm: input.odometerKm,
        recordType: 'odometer',
        recordId: null,
        source: normalizeSource(input.source, 'manual'),
      });
    }

    await audit('vehicle.created', {
      userId,
      entityType: 'vehicle',
      entityId: vehicle.id,
      metadata: { matricula: plate.display },
    });

    return getVehicleDetail(userId, vehicle.id);
  } catch (error) {
    throw translatePrismaError(error, 'criar veículo');
  }
}

/* -------------------------------------------------------------------------- */
/* Atualização                                                                 */
/* -------------------------------------------------------------------------- */

export async function updateVehicle(
  userId: string,
  vehicleId: string,
  input: VehicleUpdateRequest,
): Promise<VehicleDetail> {
  const vehicle = await requireVehicleAccess(userId, vehicleId);

  const data: Record<string, unknown> = {};
  const changed: string[] = [];

  const assign = <K extends keyof VehicleUpdateRequest>(field: K, column: string): void => {
    const value = input[field];
    if (value === undefined) return;
    data[column] = value;
    changed.push(column);
  };

  if (input.plate !== undefined) {
    const plate = normalizePlate(input.plate);
    if (!plate.valid) throw unprocessable('A matrícula indicada não parece válida.');
    const duplicate = await prisma.vehicle.findFirst({
      where: { userId, plate: plate.value, id: { not: vehicleId } },
    });
    if (duplicate) throw conflict('Já tens outro veículo registado com esta matrícula.');
    data.plate = plate.value;
    data.plateDisplay = plate.display;
    changed.push('plate');
  }

  assign('make', 'make');
  assign('model', 'model');
  assign('version', 'version');
  assign('year', 'year');
  assign('vehicleType', 'vehicleType');
  assign('fuelType', 'fuelType');
  assign('color', 'color');
  assign('nickname', 'nickname');
  assign('vin', 'vin');
  assign('engineCode', 'engineCode');
  assign('powerCv', 'powerCv');
  assign('engineDisplacementCc', 'engineDisplacementCc');
  assign('transmission', 'transmission');
  assign('drivetrain', 'drivetrain');
  assign('batteryCapacityKwh', 'batteryCapacityKwh');
  assign('usableBatteryKwh', 'usableBatteryKwh');
  assign('rangeKm', 'rangeKm');
  assign('tankCapacityL', 'tankCapacityL');
  assign('tyreSize', 'tyreSize');
  assign('wheelSize', 'wheelSize');
  assign('weightKg', 'weightKg');
  assign('co2GKm', 'co2GKm');
  assign('purchasePriceCents', 'purchasePriceCents');
  assign('purchaseOdometerKm', 'purchaseOdometerKm');
  assign('notes', 'notes');

  if (input.purchaseDate !== undefined) {
    data.purchaseDate = fromCivilDate(input.purchaseDate ?? null);
    changed.push('purchaseDate');
  }
  if (input.registrationDate !== undefined) {
    data.registrationDate = fromCivilDate(input.registrationDate ?? null);
    changed.push('registrationDate');
  }
  if (input.firstRegistrationDate !== undefined) {
    data.firstRegistrationDate = fromCivilDate(input.firstRegistrationDate ?? null);
    changed.push('firstRegistrationDate');
  }

  if (input.archived !== undefined) {
    data.archived = input.archived;
    data.archivedAt = input.archived ? new Date() : null;
    changed.push('archived');
  }

  // A quilometragem não é um campo editável comum: passa pelo mesmo guarda de
  // progressão que as leituras (§11), para que uma edição no formulário não seja uma
  // porta lateral para introduzir valores implausíveis.
  if (input.odometerKm !== undefined && input.odometerKm !== null) {
    const guard = evaluateOdometerReading({
      next: input.odometerKm,
      recordedAt: todayIn(await userTimeZone(userId)),
      current: { odometerKm: vehicle.odometerKm, recordedAt: toCivilDate(vehicle.odometerUpdatedAt) },
      userConfirmed: false,
    });
    if (guard.requiresConfirmation) {
      throw unprocessable(
        guard.warnings[0] ?? 'Confirma a nova quilometragem antes de a guardar.',
        { requiresConfirmation: true, warnings: guard.warnings },
      );
    }
    data.odometerKm = input.odometerKm;
    data.odometerSource = writeJson(
      normalizeSource(undefined, (input.odometerSource as ProviderKind | undefined) ?? 'manual'),
    );
    data.odometerUpdatedAt = new Date();
    changed.push('odometerKm');
  }

  if (changed.length === 0) {
    return getVehicleDetail(userId, vehicleId);
  }

  try {
    await prisma.vehicle.update({ where: { id: vehicleId }, data });
  } catch (error) {
    throw translatePrismaError(error, 'atualizar veículo');
  }

  await recordEvent({
    vehicleId,
    userId,
    type: 'vehicle.updated',
    date: todayIn(await userTimeZone(userId)),
    title: 'Veículo atualizado',
    summary: changed.join(', '),
    amountCents: null,
    odometerKm: null,
    recordType: 'vehicle',
    recordId: vehicleId,
    source: null,
  });

  await audit(input.archived === true ? 'vehicle.archived' : 'vehicle.updated', {
    userId,
    entityType: 'vehicle',
    entityId: vehicleId,
    metadata: { campos: changed },
  });

  return getVehicleDetail(userId, vehicleId);
}

/** Elimina um veículo e tudo o que dele depende (cascata no schema). */
export async function deleteVehicle(userId: string, vehicleId: string): Promise<void> {
  await requireVehicleAccess(userId, vehicleId);
  await prisma.vehicle.delete({ where: { id: vehicleId } });
  await audit('vehicle.deleted', { userId, entityType: 'vehicle', entityId: vehicleId });
}

/* -------------------------------------------------------------------------- */
/* Quilometragem (§11, §50, §51)                                               */
/* -------------------------------------------------------------------------- */

export interface OdometerResult {
  odometerKm: number;
  recordedAt: CivilDate;
  warnings: string[];
  /** `true` quando o valor é inferior ao anterior e foi aceite como correção. */
  isCorrection: boolean;
  deltaKm: number | null;
  source: SourceInfo;
}

/**
 * Registra uma leitura de quilometragem.
 *
 * Fluxo de confirmação (§11): quando a leitura recua, a primeira chamada devolve 422
 * com os avisos; o cliente mostra-os ao utilizador e, se este confirmar, reenvia o
 * mesmo pedido com `confirmRegression: true`. Só então o valor é gravado — e fica
 * registado como correção, para não contaminar o cálculo do ritmo de utilização.
 */
export async function recordOdometer(
  userId: string,
  vehicleId: string,
  input: OdometerCreateRequest,
): Promise<OdometerResult> {
  const vehicle = await requireVehicleAccess(userId, vehicleId);
  const recordedAt = input.recordedAt ?? todayIn(await userTimeZone(userId));

  const [aggregate] = await Promise.all([
    prisma.odometerReading.aggregate({
      where: { vehicleId, isCorrection: false },
      _max: { odometerKm: true },
    }),
  ]);

  const source = normalizeSource(input.source, 'manual');

  const guard = evaluateOdometerReading({
    next: input.odometerKm,
    recordedAt,
    current: { odometerKm: vehicle.odometerKm, recordedAt: toCivilDate(vehicle.odometerUpdatedAt) },
    historicalMaxKm: aggregate._max.odometerKm ?? null,
    userConfirmed: input.confirmRegression === true,
  });

  if (!guard.ok) {
    throw unprocessable(
      guard.warnings[0] ?? 'Confirma este valor antes de o guardar.',
      { requiresConfirmation: true, warnings: guard.warnings, deltaKm: guard.deltaKm },
    );
  }

  const isCorrection = (guard.deltaKm ?? 0) < 0;

  await prisma.odometerReading.create({
    data: {
      vehicleId,
      odometerKm: input.odometerKm,
      recordedAt: fromCivilDate(recordedAt) as Date,
      source: writeJson(source),
      notes: input.notes ?? null,
      origin: 'manual',
      isCorrection,
    },
  });

  // Só atualizamos a quilometragem atual do veículo quando o novo valor é mais alto
  // (ou quando é uma correção confirmada). Caso contrário, o dashboard mostraria um
  // valor inferior ao máximo histórico conhecido.
  const shouldUpdateCurrent =
    vehicle.odometerKm === null || input.odometerKm >= vehicle.odometerKm || isCorrection;

  if (shouldUpdateCurrent) {
    await prisma.vehicle.update({
      where: { id: vehicleId },
      data: {
        odometerKm: input.odometerKm,
        odometerSource: writeJson(source),
        odometerUpdatedAt: new Date(),
      },
    });
  }

  await recordEvent({
    vehicleId,
    userId,
    type: isCorrection ? 'odometer.corrected' : 'odometer.recorded',
    date: recordedAt,
    title: isCorrection ? 'Quilometragem corrigida' : 'Quilometragem registada',
    summary: guard.warnings.length > 0 ? guard.warnings.join(' ') : null,
    amountCents: null,
    odometerKm: input.odometerKm,
    recordType: 'odometer',
    recordId: null,
    source,
  });

  if (isCorrection) {
    await audit('odometer.corrected', {
      userId,
      entityType: 'vehicle',
      entityId: vehicleId,
      metadata: { anterior: vehicle.odometerKm, novo: input.odometerKm },
    });
  }

  return {
    odometerKm: input.odometerKm,
    recordedAt,
    warnings: guard.warnings,
    isCorrection,
    deltaKm: guard.deltaKm,
    source,
  };
}

/** Histórico de leituras de quilometragem. */
export async function listOdometerReadings(userId: string, vehicleId: string, limit = 100) {
  await requireVehicleAccess(userId, vehicleId);
  const readings = await prisma.odometerReading.findMany({
    where: { vehicleId },
    orderBy: [{ recordedAt: 'desc' }, { createdAt: 'desc' }],
    take: Math.min(limit, 500),
  });
  return readings.map(mapOdometerReading);
}

/** Ritmo de utilização estimado, usado nos lembretes por quilometragem (§11, §16). */
export async function getUsageRate(vehicleId: string): Promise<UsageRate> {
  const readings = await prisma.odometerReading.findMany({
    where: { vehicleId },
    orderBy: { recordedAt: 'asc' },
    select: { recordedAt: true, odometerKm: true, isCorrection: true },
    take: 200,
  });

  return estimateUsageRate(
    readings.map((reading) => ({
      date: toCivilDate(reading.recordedAt) as CivilDate,
      odometerKm: reading.odometerKm,
      isCorrection: reading.isCorrection,
    })),
  );
}

/* -------------------------------------------------------------------------- */
/* Normalização da origem (§50)                                                */
/* -------------------------------------------------------------------------- */

/**
 * Normaliza a origem de um dado.
 *
 * A origem é obrigatória em todos os registos porque, quando existirem integrações
 * (§26), o utilizador precisa de perceber de onde veio cada valor — e porque a
 * resolução de conflitos entre fontes (§51) depende de saber quem afirmou o quê.
 */
export function normalizeSource(
  source: { kind?: ProviderKind; label?: string; integrationId?: string | null; observedAt?: string | null } | undefined,
  fallbackKind: ProviderKind,
): SourceInfo {
  const labelFor = (kind: ProviderKind): string => {
    // `Record<string, string>` e não `Record<ProviderKind, string>`: com
    // `noUncheckedIndexedAccess` ativo, indexar por uma união de literais continua a
    // devolver `string | undefined`, obrigando a um `??` redundante em cada acesso.
    const labels: Record<string, string> = {
      manual: 'Manual',
      api: 'API',
      obd: 'OBD',
      import: 'Importação',
      document: 'Documento',
      estimated: 'Estimado',
    };
    return labels[kind] ?? kind;
  };

  const kind = source?.kind ?? fallbackKind;
  return {
    kind,
    label: source?.label ?? labelFor(kind),
    integrationId: source?.integrationId ?? null,
    observedAt: source?.observedAt ?? null,
  };
}

/** Verifica se um valor de odómetro excede o ritmo plausível, para uso em integrações. */
export function exceedsPlausibleRate(deltaKm: number, days: number): boolean {
  const safeDays = Math.max(days, 1);
  return deltaKm / safeDays > MAX_PLAUSIBLE_KM_PER_DAY;
}
