/**
 * Formas de resposta da API do Zemlo.
 *
 * Estes tipos descrevem o que a API **devolve** (as entradas estão em `contracts.ts`).
 * São tipos simples, sem dependência de Zod, para poderem ser usados tanto pelo
 * backend como pelo frontend sem custo em tempo de execução.
 */

import type { CivilDate } from './dates.js';
import type {
  DocumentCategory,
  EventType,
  ExpenseCategory,
  FuelType,
  IntegrationCategory,
  MaintenanceType,
  NotificationChannel,
  NotificationFrequency,
  NotificationTopic,
  ProviderKind,
  ReminderState,
  ReminderTrigger,
  SuggestionType,
  VehicleType,
} from './registry.js';

/** Envelope de erro uniforme. Nunca expor stack traces em produção (§30). */
export interface ApiErrorBody {
  error: {
    /** Código estável para o cliente decidir o comportamento. */
    code: ApiErrorCode;
    /** Mensagem em português, pronta a apresentar (§59). */
    message: string;
    /** Detalhes por campo, quando o erro é de validação. */
    fields?: Array<{ path: string; message: string }>;
    /** Identificador do pedido, para correlacionar com os logs (§56). */
    requestId?: string;
  };
}

export type ApiErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'unprocessable'
  | 'internal_error'
  | 'service_unavailable'
  | 'payload_too_large'
  | 'gone';

/** Envelope de lista paginada por cursor. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  /** Total conhecido apenas quando a consulta o permite; caso contrário `null`. */
  total?: number | null;
}

/** Origem de um dado (§50). */
export interface SourceInfo {
  kind: ProviderKind | null;
  label: string | null;
  integrationId: string | null;
  observedAt: string | null;
}

export interface MoneyView {
  amountCents: number;
  vatCents: number | null;
}

/* -------------------------------------------------------------------------- */
/* Conta e preferências                                                        */
/* -------------------------------------------------------------------------- */

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  locale: string;
  timeZone: string;
  distanceUnit: 'km' | 'mi';
  volumeUnit: 'l' | 'gal_us' | 'gal_uk';
  currency: 'EUR';
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  createdAt: string;
  /** Estatísticas de conta apresentadas em Definições. */
  counts: {
    vehicles: number;
    expenses: number;
    documents: number;
    integrations: number;
  };
  /** Passos de configuração ainda em falta, na ordem em que devem ser sugeridos (§6). */
  onboarding: {
    hasVehicle: boolean;
    hasOdometer: boolean;
    hasInsurance: boolean;
    hasInspection: boolean;
    hasMaintenancePlan: boolean;
    complete: boolean;
  };
}

export interface AuthTokens {
  accessToken: string;
  /** Segundos até à expiração do `accessToken`. */
  expiresIn: number;
  tokenType: 'Bearer';
  /**
   * Token de renovação opaco, devolvido apenas no registo, no início de sessão e na
   * renovação.
   *
   * **Sem este valor, `POST /auth/refresh` é inutilizável** — e foi isso que aconteceu na
   * primeira versão: o endpoint exigia um `refreshToken` em que o servidor nunca dizia
   * qual era, pelo que a renovação silenciosa era impossível e a sessão terminava ao fim
   * de uma hora, independentemente dos 90 dias configurados.
   *
   * É guardado como hash na tabela `Session`; este é o único momento em que existe em
   * claro. O cliente trata-o como um segredo: nunca em `sessionStorage` partilhado com o
   * token de acesso, nunca em logs.
   */
  refreshToken: string;
}

export interface AuthSessionResponse {
  user: UserProfile;
  tokens: AuthTokens;
}

export interface TwoFactorSetupResponse {
  /** Segredo em base32, para introduzir manualmente na app autenticadora. */
  secret: string;
  /** URI `otpauth://` para gerar o QR code no cliente. */
  otpauthUri: string;
  recoveryCodes: string[];
}

export interface NotificationPreference {
  topic: NotificationTopic;
  channel: NotificationChannel;
  frequency: NotificationFrequency;
}

export interface UserPreferences {
  reminderLeadDays: number;
  reminderLeadKm: number;
  suggestionsEnabled: boolean;
  securityNudgeSnoozeDays: number;
  frequentExpenseCategories: ExpenseCategory[];
  hiddenFields: string[];
  notifications: NotificationPreference[];
}

/* -------------------------------------------------------------------------- */
/* Veículo                                                                     */
/* -------------------------------------------------------------------------- */

export interface VehicleSummary {
  id: string;
  plate: string;
  plateDisplay: string;
  make: string | null;
  model: string | null;
  version: string | null;
  year: number | null;
  vehicleType: VehicleType;
  fuelType: FuelType;
  nickname: string | null;
  archived: boolean;
  /** Quilometragem atual conhecida, com a origem (§11, §50). */
  odometerKm: number | null;
  odometerSource: SourceInfo | null;
  odometerUpdatedAt: string | null;
  /** Identificador visual: emoji do tipo de veículo. */
  emoji: string;
  createdAt: string;
  updatedAt: string;
}

export interface VehicleDetail extends VehicleSummary {
  vin: string | null;
  engineCode: string | null;
  powerCv: number | null;
  engineDisplacementCc: number | null;
  transmission: string | null;
  drivetrain: string | null;
  batteryCapacityKwh: number | null;
  usableBatteryKwh: number | null;
  rangeKm: number | null;
  tankCapacityL: number | null;
  tyreSize: string | null;
  wheelSize: string | null;
  weightKg: number | null;
  co2GKm: number | null;
  color: string | null;
  purchaseDate: CivilDate | null;
  purchasePriceCents: number | null;
  purchaseOdometerKm: number | null;
  registrationDate: CivilDate | null;
  firstRegistrationDate: CivilDate | null;
  notes: string | null;
  /** Contadores agregados mostrados no cabeçalho da ficha. */
  counts: {
    expenses: number;
    fuel: number;
    charging: number;
    maintenance: number;
    documents: number;
    reminders: number;
  };
  /** Total gasto desde sempre, em cêntimos. */
  totalCostCents: number;
}

/* -------------------------------------------------------------------------- */
/* Registos                                                                    */
/* -------------------------------------------------------------------------- */

export interface OdometerReading {
  id: string;
  vehicleId: string;
  odometerKm: number;
  recordedAt: CivilDate;
  source: SourceInfo;
  notes: string | null;
  createdAt: string;
}

export interface Expense {
  id: string;
  vehicleId: string;
  amountCents: number;
  vatCents: number | null;
  category: ExpenseCategory;
  date: CivilDate;
  vendor: string | null;
  odometerKm: number | null;
  description: string | null;
  paymentMethod: string | null;
  paid: boolean;
  linkedRecordId: string | null;
  notes: string | null;
  source: SourceInfo;
  createdAt: string;
  updatedAt: string;
}

export interface FuelSession {
  id: string;
  vehicleId: string;
  date: CivilDate;
  litres: number;
  amountCents: number;
  pricePerLitreCents: number | null;
  odometerKm: number | null;
  fullTank: boolean;
  station: string | null;
  fuelType: FuelType | null;
  latitude: number | null;
  longitude: number | null;
  paymentMethod: string | null;
  notes: string | null;
  source: SourceInfo;
  createdAt: string;
  updatedAt: string;
  /** Métricas derivadas; `null` quando faltam dados (§49). */
  derived: {
    costPerLitreCents: number | null;
    distanceSincePreviousKm: number | null;
    consumptionL100Km: number | null;
    costPer100KmCents: number | null;
  };
}

export interface ChargingSession {
  id: string;
  vehicleId: string;
  date: CivilDate;
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
  source: SourceInfo;
  createdAt: string;
  updatedAt: string;
  derived: {
    averagePowerKw: number | null;
    addedSocPercent: number | null;
    distanceSincePreviousKm: number | null;
    consumptionKwh100Km: number | null;
    costPer100KmCents: number | null;
  };
}

export interface MaintenanceRecord {
  id: string;
  vehicleId: string;
  date: CivilDate;
  type: MaintenanceType;
  odometerKm: number | null;
  amountCents: number | null;
  partsCents: number | null;
  labourCents: number | null;
  workshop: string | null;
  description: string | null;
  warrantyMonths: number | null;
  notes: string | null;
  nextDueDate: CivilDate | null;
  nextDueOdometerKm: number | null;
  source: SourceInfo;
  createdAt: string;
  updatedAt: string;
}

export interface InsurancePolicy {
  id: string;
  vehicleId: string;
  insurer: string;
  policyNumber: string | null;
  startDate: CivilDate;
  endDate: CivilDate;
  premiumCents: number | null;
  coverage: string | null;
  deductibleCents: number | null;
  contactPhone: string | null;
  documentId: string | null;
  notes: string | null;
  source: SourceInfo;
  createdAt: string;
  updatedAt: string;
  /** Dias até ao fim da apólice, calculados no fuso do utilizador. */
  daysRemaining: number;
  /** `true` quando é a apólice em vigor numa dada data. */
  active: boolean;
}

export interface InspectionRecord {
  id: string;
  vehicleId: string;
  date: CivilDate;
  result: string;
  odometerKm: number | null;
  amountCents: number | null;
  nextDueDate: CivilDate | null;
  station: string | null;
  defects: string | null;
  documentId: string | null;
  notes: string | null;
  source: SourceInfo;
  createdAt: string;
  updatedAt: string;
}

export interface TaxRecord {
  id: string;
  vehicleId: string;
  kind: string;
  year: number;
  amountCents: number;
  date: CivilDate | null;
  dueDate: CivilDate | null;
  paid: boolean;
  documentId: string | null;
  notes: string | null;
  source: SourceInfo;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentRecord {
  id: string;
  vehicleId: string | null;
  name: string;
  category: DocumentCategory;
  date: CivilDate | null;
  expiresAt: CivilDate | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  storageKey: string | null;
  notes: string | null;
  source: SourceInfo;
  createdAt: string;
  updatedAt: string;
  /** Dias até expirar; `null` quando não tem validade. */
  daysToExpiry: number | null;
}

/* -------------------------------------------------------------------------- */
/* Sugestões, lembretes, notificações                                          */
/* -------------------------------------------------------------------------- */

export interface Suggestion {
  id: string;
  type: SuggestionType;
  title: string;
  body: string;
  vehicleId: string | null;
  /** Etiqueta do botão de aceitação; o texto vem da API para manter o tom (§59). */
  actionLabel: string;
  /** Rota sugerida na aplicação web/mobile. */
  actionHref: string | null;
  /** Quando `true`, pode ser silenciada definitivamente com "Não mostrar novamente". */
  dismissibleForever: boolean;
  priority: number;
}

export interface Reminder {
  id: string;
  vehicleId: string;
  title: string;
  trigger: ReminderTrigger;
  dueDate: CivilDate | null;
  dueOdometerKm: number | null;
  intervalMonths: number | null;
  intervalKm: number | null;
  repeat: boolean;
  notes: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Avaliação calculada no momento do pedido (§16). */
  evaluation: ReminderEvaluation;
}

export interface ReminderEvaluation {
  state: ReminderState;
  /** Dias até ao vencimento; negativo quando já passou. */
  daysRemaining: number | null;
  /** Quilómetros até ao vencimento; negativo quando já passou. */
  kmRemaining: number | null;
  /** Qual das condições dispara primeiro (`distance` | `time` | `both` | `null`). */
  drivingCondition: 'distance' | 'time' | 'both' | null;
  /** Data prevista, quando só há condição de quilometragem mas há ritmo conhecido. */
  projectedDate: CivilDate | null;
  /** Resumo em português: `em 1 200 km`, `63 dias`, `em atraso`. */
  summary: string;
}

export interface AppNotification {
  id: string;
  topic: NotificationTopic;
  channel: NotificationChannel;
  title: string;
  body: string;
  /** Rota para abrir o contexto relevante. */
  href: string | null;
  vehicleId: string | null;
  reminderId: string | null;
  readAt: string | null;
  createdAt: string;
  /** Chave de deduplicação, quando a notificação nasce de um lembrete. */
  dedupeKey: string | null;
}

/* -------------------------------------------------------------------------- */
/* Timeline (§24)                                                              */
/* -------------------------------------------------------------------------- */

export type TimelineItemKind =
  | 'expense'
  | 'fuel'
  | 'charging'
  | 'maintenance'
  | 'insurance'
  | 'inspection'
  | 'tax'
  | 'document'
  | 'odometer'
  | 'reminder'
  | 'event';

export interface TimelineItem {
  /** Identificador estável: `kind:recordId`. */
  id: string;
  kind: TimelineItemKind;
  eventType: EventType | null;
  vehicleId: string;
  vehiclePlateDisplay: string;
  date: CivilDate;
  /** Instante de criação, para ordenar registos do mesmo dia. */
  createdAt: string;
  title: string;
  subtitle: string | null;
  icon: string;
  amountCents: number | null;
  odometerKm: number | null;
  /** Métricas já formatadas em português, para renderização direta. */
  metrics: Array<{ label: string; value: string }>;
  /** Rota para o detalhe do registo. */
  href: string | null;
  source: SourceInfo;
}

/* -------------------------------------------------------------------------- */
/* Dashboard (§8)                                                              */
/* -------------------------------------------------------------------------- */

export interface StatusCard {
  /** Identificador estável usado pelo frontend para escolher o ícone. */
  key: 'next_service' | 'insurance' | 'inspection' | 'tax' | 'documents' | 'odometer';
  label: string;
  /** Valor principal já formatado (`1 200 km`, `63 dias`, `142 dias`). */
  value: string;
  /** Contexto secundário (`Revisão · 50 000 km ou 12 meses`). */
  hint: string | null;
  state: ReminderState;
  icon: string;
  href: string | null;
}

export interface CategoryTotal {
  category: ExpenseCategory;
  label: string;
  icon: string;
  amountCents: number;
  /** Fração do total no período (0–1); `null` quando o total é zero. */
  share: number | null;
  count: number;
}

export interface MonthlyTotal {
  /** `YYYY-MM`. */
  month: string;
  label: string;
  amountCents: number;
  /** Total apenas de energia (combustível + carregamento), para distinguir tendências. */
  energyCents: number;
}

export interface DashboardVehicleRef {
  id: string;
  plateDisplay: string;
  title: string;
  subtitle: string | null;
  emoji: string;
  odometerKm: number | null;
  odometerSourceLabel: string | null;
}

export interface DashboardResponse {
  /** Veículo em foco; `null` quando a conta ainda não tem veículos. */
  vehicle: DashboardVehicleRef | null;
  vehicles: DashboardVehicleRef[];
  status: StatusCard[];
  finance: {
    year: number;
    yearTotalCents: number;
    monthTotalCents: number;
    /** Média mensal do ano em curso. */
    monthAverageCents: number | null;
    /** Total do mesmo período do ano anterior, para comparação honesta. */
    previousYearSamePeriodCents: number;
    byCategory: CategoryTotal[];
    monthly: MonthlyTotal[];
  };
  usage: {
    odometerKm: number | null;
    /** Km percorridos no ano em curso, quando há dados suficientes. */
    kmThisYear: number | null;
    costPerKmCents: number | null;
    kmPerMonth: number | null;
    fuelConsumptionL100Km: number | null;
    energyConsumptionKwh100Km: number | null;
  };
  suggestions: Suggestion[];
  upcoming: TimelineItem[];
  counts: {
    vehicles: number;
    recordsThisYear: number;
    documents: number;
  };
  /** Relatório de dados em falta, em linguagem de produto — nunca como erro (§49, §59). */
  dataGaps: Array<{ key: string; title: string; message: string; href: string | null }>;
}

/* -------------------------------------------------------------------------- */
/* Estatísticas (§23)                                                          */
/* -------------------------------------------------------------------------- */

export interface StatsResponse {
  scope: {
    vehicleId: string | null;
    vehicleLabel: string;
    year: number;
    from: CivilDate;
    to: CivilDate;
    months: number;
  };
  totals: {
    /** Custo total do período, incluindo todas as categorias. */
    totalCents: number;
    energyCents: number;
    maintenanceCents: number;
    fixedCents: number;
    otherCents: number;
    count: number;
  };
  distance: {
    kmThisYear: number | null;
    kmInWindow: number | null;
    kmPerMonth: number | null;
    /** Km/ano estimados a partir do ritmo observado. */
    kmPerYear: number | null;
    firstReadingDate: CivilDate | null;
    lastReadingDate: CivilDate | null;
  };
  unitCosts: {
    costPerKmCents: number | null;
    costPerMonthCents: number | null;
    costPerDayCents: number | null;
    energyCostPerKmCents: number | null;
    maintenanceCostPerKmCents: number | null;
  };
  consumption: {
    fuelL100Km: number | null;
    fuelCostPerLitreCents: number | null;
    energyKwh100Km: number | null;
    energyCostPerKwhCents: number | null;
    /** Série mensal de consumos, para o gráfico de evolução. */
    fuelMonthly: Array<{ month: string; label: string; value: number | null }>;
    energyMonthly: Array<{ month: string; label: string; value: number | null }>;
  };
  byCategory: CategoryTotal[];
  monthly: MonthlyTotal[];
  /** Comparação entre o período e o anterior de igual duração (§23). */
  comparison: {
    previousPeriodTotalCents: number;
    deltaCents: number;
    deltaPercent: number | null;
    previousPeriodKm: number | null;
    deltaKm: number | null;
  };
  /** Estatísticas avançadas (§23), apresentadas apenas quando fazem sentido (§3.2). */
  advanced: {
    ownershipMonths: number | null;
    totalCostOfOwnershipCents: number | null;
    depreciationCents: number | null;
    residualValueCents: number | null;
    valuePerKmCents: number | null;
    /** Notas metodológicas apresentadas ao utilizador para evitar números opacos. */
    assumptions: string[];
  };
}

/* -------------------------------------------------------------------------- */
/* Calendário (§21)                                                            */
/* -------------------------------------------------------------------------- */

export interface CalendarEntry {
  id: string;
  date: CivilDate;
  kind: TimelineItemKind | 'reminder';
  title: string;
  subtitle: string | null;
  icon: string;
  state: ReminderState | null;
  vehicleId: string;
  vehiclePlateDisplay: string;
  amountCents: number | null;
  href: string | null;
  /** `true` quando a data é uma projeção e não um compromisso confirmado. */
  projected: boolean;
}

export interface CalendarResponse {
  from: CivilDate;
  to: CivilDate;
  entries: CalendarEntry[];
  /** Resumo por dia, para desenhar a grelha do calendário sem percorrer as entradas. */
  days: Array<{ date: CivilDate; count: number; hasOverdue: boolean }>;
}

/* -------------------------------------------------------------------------- */
/* Integrações (§26 – §28)                                                     */
/* -------------------------------------------------------------------------- */

export interface IntegrationRecord {
  id: string;
  category: IntegrationCategory;
  provider: string;
  label: string | null;
  vehicleId: string | null;
  enabled: boolean;
  /** Configuração não sensível. Segredos nunca são devolvidos. */
  config: Record<string, unknown>;
  /** Nomes das credenciais guardadas (sem valores). */
  credentialKeys: string[];
  lastSyncAt: string | null;
  lastSyncStatus: 'ok' | 'error' | 'never';
  lastSyncMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Resultado da verificação de saúde da API, consumido por monitorização (§56). */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  uptimeSeconds: number;
  database: { reachable: boolean; provider: string; latencyMs: number | null };
  time: string;
}

/** Documento raiz da especificação da integração Home Assistant (§27). */
export interface HomeAssistantSpec {
  /** Versão do formato de descoberta MQTT suportado. */
  discoveryVersion: 1;
  /** Prefixo de descoberta usado nos tópicos MQTT. */
  discoveryPrefix: string;
  /** Tópico base onde o Zemlo publica o estado. */
  stateTopic: string;
  /** Entidades possíveis e a condição de dados que as torna disponíveis. */
  entities: Array<{
    entityId: string;
    name: string;
    component: 'sensor' | 'binary_sensor' | 'device_tracker';
    deviceClass: string | null;
    unitOfMeasurement: string | null;
    stateClass: 'measurement' | 'total_increasing' | null;
    /** Requisito de dados em linguagem de produto. */
    requires: string;
    available: boolean;
  }>;
  /** Instruções para o utilizador, no tom da marca (§59). */
  instructions: string[];
}
