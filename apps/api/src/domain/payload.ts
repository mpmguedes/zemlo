/**
 * Mapeadores entre modelos Prisma e as formas públicas da API.
 *
 * Porquê uma camada dedicada e não devolver o modelo diretamente: o modelo tem
 * campos que nunca devem sair do servidor (`twoFactorSecret`, `credentials`,
 * `passwordHash`) e tem tipos que o cliente não deve ter de conhecer (`Date`,
 * colunas JSON serializadas como texto em SQLite).
 *
 * Esta camada é a fronteira de segurança e de contrato ao mesmo tempo (§30, §34):
 * um campo novo na base de dados só aparece na API se for explicitamente mapeado aqui.
 */

import type {
  AppNotification,
  ChargingSession as ChargingSessionView,
  DocumentRecord,
  Expense as ExpenseView,
  FuelSession as FuelSessionView,
  InsurancePolicy as InsuranceView,
  InspectionRecord as InspectionView,
  IntegrationRecord,
  MaintenanceRecord as MaintenanceView,
  NotificationChannel,
  NotificationTopic,
  OdometerReading as OdometerReadingView,
  ProviderKind,
  Reminder as ReminderView,
  ReminderEvaluation,
  SourceInfo,
  TaxRecord as TaxView,
  UserProfile,
  VehicleDetail,
  VehicleSummary,
} from '@zemlo/shared';
import {
  normalizePlate,
  optionIcon,
  VEHICLE_TYPES,
  type CivilDate,
  type DocumentCategory,
  type ExpenseCategory,
  type FuelType,
  type IntegrationCategory,
  type MaintenanceType,
  type ReminderTrigger,
  type VehicleType,
} from '@zemlo/shared';
import { readJsonArray, readJsonObject } from '../core/json.js';

/* -------------------------------------------------------------------------- */
/* Utilitários                                                                 */
/* -------------------------------------------------------------------------- */

/** Converte um `DateTime @db.Date` do Prisma numa data civil `YYYY-MM-DD`. */
export function toCivilDate(value: Date | null | undefined): CivilDate | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

/** Converte uma data civil num `Date` UTC à meia-noite, para gravação. */
export function fromCivilDate(value: CivilDate | null | undefined): Date | null {
  if (!value) return null;
  return new Date(`${value}T00:00:00.000Z`);
}

/** `true` quando o valor é um objeto simples (e não `null`, `Date` ou array). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/**
 * Normaliza a coluna `source`, que é `Json` em PostgreSQL e texto em SQLite.
 * Devolve sempre a forma pública de `SourceInfo`, sem campos a mais.
 */
export function mapSource(value: unknown): SourceInfo {
  const raw = isPlainObject(value) ? value : readJsonObject(value);
  const kind = typeof raw.kind === 'string' ? (raw.kind as ProviderKind) : null;
  return {
    kind,
    label: typeof raw.label === 'string' ? raw.label : kind ? optionLabelSafe(kind) : null,
    integrationId: typeof raw.integrationId === 'string' ? raw.integrationId : null,
    observedAt: typeof raw.observedAt === 'string' ? raw.observedAt : null,
  };
}

function optionLabelSafe(kind: string): string {
  const labels: Record<string, string> = {
    manual: 'Manual',
    api: 'API',
    obd: 'OBD',
    import: 'Importação',
    document: 'Documento',
    estimated: 'Estimado',
  };
  return labels[kind] ?? kind;
}

/** `true` quando a origem é uma introdução manual do utilizador. */
export function isManualSource(source: SourceInfo): boolean {
  return source.kind === null || source.kind === 'manual';
}

/* -------------------------------------------------------------------------- */
/* Veículos                                                                    */
/* -------------------------------------------------------------------------- */

interface VehicleLike {
  id: string;
  plate: string;
  plateDisplay?: string | null;
  make: string | null;
  model: string | null;
  version?: string | null;
  year?: number | null;
  vehicleType: string;
  fuelType: string;
  nickname?: string | null;
  archived: boolean;
  odometerKm: number | null;
  odometerSource?: unknown;
  odometerUpdatedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  vin?: string | null;
  engineCode?: string | null;
  powerCv?: number | null;
  engineDisplacementCc?: number | null;
  transmission?: string | null;
  drivetrain?: string | null;
  batteryCapacityKwh?: number | null;
  usableBatteryKwh?: number | null;
  rangeKm?: number | null;
  tankCapacityL?: number | null;
  tyreSize?: string | null;
  wheelSize?: string | null;
  weightKg?: number | null;
  co2GKm?: number | null;
  color?: string | null;
  purchaseDate?: Date | null;
  purchasePriceCents?: number | null;
  purchaseOdometerKm?: number | null;
  registrationDate?: Date | null;
  firstRegistrationDate?: Date | null;
  notes?: string | null;
}

export function mapVehicleSummary(vehicle: VehicleLike): VehicleSummary {
  const normalized = normalizePlate(vehicle.plate);
  const vehicleType = (vehicle.vehicleType ?? 'car') as VehicleType;
  return {
    id: vehicle.id,
    plate: vehicle.plate,
    // A forma legível é recalculada quando o registo não a tem (dados antigos ou
    // criados por uma integração).
    plateDisplay: vehicle.plateDisplay ?? normalized.display,
    make: vehicle.make,
    model: vehicle.model,
    version: vehicle.version ?? null,
    year: vehicle.year ?? null,
    vehicleType,
    fuelType: (vehicle.fuelType ?? 'gasoline') as FuelType,
    nickname: vehicle.nickname ?? null,
    archived: vehicle.archived,
    odometerKm: vehicle.odometerKm,
    odometerSource: vehicle.odometerSource === undefined ? null : mapSource(vehicle.odometerSource),
    odometerUpdatedAt: vehicle.odometerUpdatedAt ? vehicle.odometerUpdatedAt.toISOString() : null,
    emoji: optionIcon(VEHICLE_TYPES, vehicleType),
    createdAt: vehicle.createdAt.toISOString(),
    updatedAt: vehicle.updatedAt.toISOString(),
  };
}

/** Título curto apresentado no cabeçalho do dashboard e nas listas (§8, §9). */
export function vehicleTitle(vehicle: Pick<VehicleLike, 'make' | 'model' | 'nickname' | 'plateDisplay' | 'plate'>): string {
  if (vehicle.nickname) return vehicle.nickname;
  const name = [vehicle.make, vehicle.model].filter(Boolean).join(' ');
  if (name) return name;
  return normalizePlate(vehicle.plate).display;
}

export function mapVehicleDetail(
  vehicle: VehicleLike & Record<string, unknown>,
  counts: VehicleDetail['counts'],
  totalCostCents: number,
): VehicleDetail {
  return {
    ...mapVehicleSummary(vehicle),
    vin: vehicle.vin ?? null,
    engineCode: vehicle.engineCode ?? null,
    powerCv: vehicle.powerCv ?? null,
    engineDisplacementCc: vehicle.engineDisplacementCc ?? null,
    transmission: vehicle.transmission ?? null,
    drivetrain: vehicle.drivetrain ?? null,
    batteryCapacityKwh: vehicle.batteryCapacityKwh ?? null,
    usableBatteryKwh: vehicle.usableBatteryKwh ?? null,
    rangeKm: vehicle.rangeKm ?? null,
    tankCapacityL: vehicle.tankCapacityL ?? null,
    tyreSize: vehicle.tyreSize ?? null,
    wheelSize: vehicle.wheelSize ?? null,
    weightKg: vehicle.weightKg ?? null,
    co2GKm: vehicle.co2GKm ?? null,
    color: vehicle.color ?? null,
    purchaseDate: toCivilDate(vehicle.purchaseDate),
    purchasePriceCents: vehicle.purchasePriceCents ?? null,
    purchaseOdometerKm: vehicle.purchaseOdometerKm ?? null,
    registrationDate: toCivilDate(vehicle.registrationDate),
    firstRegistrationDate: toCivilDate(vehicle.firstRegistrationDate),
    notes: vehicle.notes ?? null,
    counts,
    totalCostCents,
  };
}

/* -------------------------------------------------------------------------- */
/* Registos                                                                    */
/* -------------------------------------------------------------------------- */

export function mapOdometerReading(reading: {
  id: string;
  vehicleId: string;
  odometerKm: number;
  recordedAt: Date;
  source: unknown;
  notes: string | null;
  createdAt: Date;
}): OdometerReadingView {
  return {
    id: reading.id,
    vehicleId: reading.vehicleId,
    odometerKm: reading.odometerKm,
    recordedAt: toCivilDate(reading.recordedAt) as CivilDate,
    source: mapSource(reading.source),
    notes: reading.notes,
    createdAt: reading.createdAt.toISOString(),
  };
}

export function mapExpense(expense: {
  id: string;
  vehicleId: string;
  amountCents: number;
  vatCents: number | null;
  category: string;
  date: Date;
  vendor: string | null;
  odometerKm: number | null;
  description: string | null;
  paymentMethod: string | null;
  paid: boolean;
  linkedRecordId: string | null;
  notes: string | null;
  source: unknown;
  createdAt: Date;
  updatedAt: Date;
}): ExpenseView {
  return {
    id: expense.id,
    vehicleId: expense.vehicleId,
    amountCents: expense.amountCents,
    vatCents: expense.vatCents,
    category: expense.category as ExpenseCategory,
    date: toCivilDate(expense.date) as CivilDate,
    vendor: expense.vendor,
    odometerKm: expense.odometerKm,
    description: expense.description,
    paymentMethod: expense.paymentMethod,
    paid: expense.paid,
    linkedRecordId: expense.linkedRecordId,
    notes: expense.notes,
    source: mapSource(expense.source),
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString(),
  };
}

export function mapFuelSession(
  session: {
    id: string;
    vehicleId: string;
    date: Date;
    litres: number;
    amountCents: number;
    pricePerLitreCents: number | null;
    odometerKm: number | null;
    fullTank: boolean;
    station: string | null;
    fuelType: string | null;
    latitude: number | null;
    longitude: number | null;
    paymentMethod: string | null;
    notes: string | null;
    source: unknown;
    createdAt: Date;
    updatedAt: Date;
    /** Despesa gerada a partir deste abastecimento, quando o utilizador indicou valor. */
    expenseId?: string | null;
  },
  derived: FuelSessionView['derived'],
): FuelSessionView {
  return {
    id: session.id,
    vehicleId: session.vehicleId,
    date: toCivilDate(session.date) as CivilDate,
    litres: session.litres,
    amountCents: session.amountCents,
    pricePerLitreCents: session.pricePerLitreCents,
    odometerKm: session.odometerKm,
    fullTank: session.fullTank,
    station: session.station,
    fuelType: session.fuelType as FuelType | null,
    latitude: session.latitude,
    longitude: session.longitude,
    paymentMethod: session.paymentMethod,
    notes: session.notes,
    source: mapSource(session.source),
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    derived,
  };
}

export function mapChargingSession(
  session: {
    id: string;
    vehicleId: string;
    date: Date;
    energyKwh: number;
    amountCents: number;
    pricePerKwhCents: number | null;
    odometerKm: number | null;
    location: string | null;
    charger: string | null;
    durationMinutes: number | null;
    startSocPercent: number | null;
    endSocPercent: number | null;
    powerKw: number | null;
    provider: string | null;
    tariff: string | null;
    isPublic: boolean | null;
    isHome: boolean | null;
    notes: string | null;
    source: unknown;
    createdAt: Date;
    updatedAt: Date;
    /** Despesa gerada a partir deste carregamento, quando o utilizador indicou valor. */
    expenseId?: string | null;
  },
  derived: ChargingSessionView['derived'],
): ChargingSessionView {
  return {
    id: session.id,
    vehicleId: session.vehicleId,
    date: toCivilDate(session.date) as CivilDate,
    energyKwh: session.energyKwh,
    amountCents: session.amountCents,
    pricePerKwhCents: session.pricePerKwhCents,
    odometerKm: session.odometerKm,
    location: session.location,
    charger: session.charger,
    durationMinutes: session.durationMinutes,
    startSocPercent: session.startSocPercent,
    endSocPercent: session.endSocPercent,
    powerKw: session.powerKw,
    provider: session.provider,
    tariff: session.tariff,
    isPublic: session.isPublic,
    isHome: session.isHome,
    notes: session.notes,
    source: mapSource(session.source),
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    derived,
  };
}

export function mapMaintenance(record: {
  id: string;
  vehicleId: string;
  date: Date;
  type: string;
  odometerKm: number | null;
  amountCents: number | null;
  partsCents: number | null;
  labourCents: number | null;
  workshop: string | null;
  description: string | null;
  warrantyMonths: number | null;
  notes: string | null;
  nextDueDate: Date | null;
  nextDueOdometerKm: number | null;
  source: unknown;
  createdAt: Date;
  updatedAt: Date;
}): MaintenanceView {
  return {
    id: record.id,
    vehicleId: record.vehicleId,
    date: toCivilDate(record.date) as CivilDate,
    type: record.type as MaintenanceType,
    odometerKm: record.odometerKm,
    amountCents: record.amountCents,
    partsCents: record.partsCents,
    labourCents: record.labourCents,
    workshop: record.workshop,
    description: record.description,
    warrantyMonths: record.warrantyMonths,
    notes: record.notes,
    nextDueDate: toCivilDate(record.nextDueDate),
    nextDueOdometerKm: record.nextDueOdometerKm,
    source: mapSource(record.source),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function mapInsurance(
  policy: {
    id: string;
    vehicleId: string;
    insurer: string;
    policyNumber: string | null;
    startDate: Date;
    endDate: Date;
    premiumCents: number | null;
    coverage: string | null;
    deductibleCents: number | null;
    contactPhone: string | null;
    documentId: string | null;
    notes: string | null;
    source: unknown;
    createdAt: Date;
    updatedAt: Date;
  },
  today: CivilDate,
): InsuranceView {
  const endDate = toCivilDate(policy.endDate) as CivilDate;
  const startDate = toCivilDate(policy.startDate) as CivilDate;
  const daysRemaining = daysUntil(today, endDate);
  return {
    id: policy.id,
    vehicleId: policy.vehicleId,
    insurer: policy.insurer,
    policyNumber: policy.policyNumber,
    startDate,
    endDate,
    premiumCents: policy.premiumCents,
    coverage: policy.coverage,
    deductibleCents: policy.deductibleCents,
    contactPhone: policy.contactPhone,
    documentId: policy.documentId,
    notes: policy.notes,
    source: mapSource(policy.source),
    createdAt: policy.createdAt.toISOString(),
    updatedAt: policy.updatedAt.toISOString(),
    daysRemaining,
    active: daysUntil(today, startDate) <= 0 && daysRemaining >= 0,
  };
}

export function mapInspection(record: {
  id: string;
  vehicleId: string;
  date: Date;
  result: string;
  odometerKm: number | null;
  amountCents: number | null;
  nextDueDate: Date | null;
  station: string | null;
  defects: string | null;
  documentId: string | null;
  notes: string | null;
  source: unknown;
  createdAt: Date;
  updatedAt: Date;
}): InspectionView {
  return {
    id: record.id,
    vehicleId: record.vehicleId,
    date: toCivilDate(record.date) as CivilDate,
    result: record.result,
    odometerKm: record.odometerKm,
    amountCents: record.amountCents,
    nextDueDate: toCivilDate(record.nextDueDate),
    station: record.station,
    defects: record.defects,
    documentId: record.documentId,
    notes: record.notes,
    source: mapSource(record.source),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function mapTax(record: {
  id: string;
  vehicleId: string;
  kind: string;
  year: number;
  amountCents: number;
  date: Date | null;
  dueDate: Date | null;
  paid: boolean;
  documentId: string | null;
  notes: string | null;
  source: unknown;
  createdAt: Date;
  updatedAt: Date;
}): TaxView {
  return {
    id: record.id,
    vehicleId: record.vehicleId,
    kind: record.kind,
    year: record.year,
    amountCents: record.amountCents,
    date: toCivilDate(record.date),
    dueDate: toCivilDate(record.dueDate),
    paid: record.paid,
    documentId: record.documentId,
    notes: record.notes,
    source: mapSource(record.source),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function mapDocument(
  document: {
    id: string;
    vehicleId: string | null;
    name: string;
    category: string;
    date: Date | null;
    expiresAt: Date | null;
    fileName: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    storageKey: string | null;
    notes: string | null;
    source: unknown;
    createdAt: Date;
    updatedAt: Date;
  },
  today: CivilDate,
): DocumentRecord {
  const expiresAt = toCivilDate(document.expiresAt);
  return {
    id: document.id,
    vehicleId: document.vehicleId,
    name: document.name,
    category: document.category as DocumentCategory,
    date: toCivilDate(document.date),
    expiresAt,
    fileName: document.fileName,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    storageKey: document.storageKey,
    notes: document.notes,
    source: mapSource(document.source),
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
    daysToExpiry: expiresAt ? daysUntil(today, expiresAt) : null,
  };
}

export function mapReminder(
  reminder: {
    id: string;
    vehicleId: string;
    title: string;
    trigger: string;
    dueDate: Date | null;
    dueOdometerKm: number | null;
    intervalMonths: number | null;
    intervalKm: number | null;
    repeat: boolean;
    notes: string | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  },
  evaluation: ReminderEvaluation,
): ReminderView {
  return {
    id: reminder.id,
    vehicleId: reminder.vehicleId,
    title: reminder.title,
    trigger: reminder.trigger as ReminderTrigger,
    dueDate: toCivilDate(reminder.dueDate),
    dueOdometerKm: reminder.dueOdometerKm,
    intervalMonths: reminder.intervalMonths,
    intervalKm: reminder.intervalKm,
    repeat: reminder.repeat,
    notes: reminder.notes,
    completedAt: reminder.completedAt ? reminder.completedAt.toISOString() : null,
    createdAt: reminder.createdAt.toISOString(),
    updatedAt: reminder.updatedAt.toISOString(),
    evaluation,
  };
}

export function mapNotification(notification: {
  id: string;
  topic: string;
  channel: string;
  title: string;
  body: string;
  href: string | null;
  vehicleId: string | null;
  reminderId: string | null;
  readAt: Date | null;
  createdAt: Date;
  dedupeKey: string | null;
}): AppNotification {
  return {
    id: notification.id,
    topic: notification.topic as NotificationTopic,
    channel: notification.channel as NotificationChannel,
    title: notification.title,
    body: notification.body,
    href: notification.href,
    vehicleId: notification.vehicleId,
    reminderId: notification.reminderId,
    readAt: notification.readAt ? notification.readAt.toISOString() : null,
    createdAt: notification.createdAt.toISOString(),
    dedupeKey: notification.dedupeKey,
  };
}

export function mapIntegration(integration: {
  id: string;
  category: string;
  provider: string;
  label: string | null;
  vehicleId: string | null;
  enabled: boolean;
  config: unknown;
  credentials: unknown;
  lastSyncAt: Date | null;
  lastSyncStatus: string;
  lastSyncMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}): IntegrationRecord {
  // As credenciais são cifradas e guardadas como texto; o cliente só sabe *que*
  // existem chaves, nunca os valores (§30).
  const credentialKeys =
    typeof integration.credentials === 'string' && integration.credentials.length > 0
      ? readJsonArray<string>(integration.credentials)
      : [];

  return {
    id: integration.id,
    category: integration.category as IntegrationCategory,
    provider: integration.provider,
    label: integration.label,
    vehicleId: integration.vehicleId,
    enabled: integration.enabled,
    config: readJsonObject(integration.config) as Record<string, unknown>,
    credentialKeys: Array.isArray(credentialKeys) ? credentialKeys : [],
    lastSyncAt: integration.lastSyncAt ? integration.lastSyncAt.toISOString() : null,
    lastSyncStatus: (integration.lastSyncStatus as IntegrationRecord['lastSyncStatus']) ?? 'never',
    lastSyncMessage: integration.lastSyncMessage,
    createdAt: integration.createdAt.toISOString(),
    updatedAt: integration.updatedAt.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Conta                                                                       */
/* -------------------------------------------------------------------------- */

export function mapUserProfile(
  user: {
    id: string;
    email: string;
    name: string | null;
    locale: string;
    timeZone: string;
    distanceUnit: string;
    volumeUnit: string;
    currency: string;
    emailVerified: boolean;
    twoFactorEnabled: boolean;
    createdAt: Date;
  },
  counts: UserProfile['counts'],
  onboarding: UserProfile['onboarding'],
): UserProfile {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    locale: user.locale,
    timeZone: user.timeZone,
    distanceUnit: (user.distanceUnit as 'km' | 'mi') ?? 'km',
    volumeUnit: (user.volumeUnit as UserProfile['volumeUnit']) ?? 'l',
    currency: 'EUR',
    emailVerified: user.emailVerified,
    twoFactorEnabled: user.twoFactorEnabled,
    createdAt: user.createdAt.toISOString(),
    counts,
    onboarding,
  };
}

/* -------------------------------------------------------------------------- */
/* Utilitários internos                                                        */
/* -------------------------------------------------------------------------- */

function daysUntil(today: CivilDate, target: CivilDate): number {
  const [y1, m1, d1] = today.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = target.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}
