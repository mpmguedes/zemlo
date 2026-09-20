import type {
  AppNotification,
  CalendarResponse,
  ChargingSession,
  DashboardResponse,
  DocumentRecord,
  Expense,
  FuelSession,
  HomeAssistantSpec,
  InsurancePolicy,
  InspectionRecord,
  IntegrationRecord,
  MaintenanceRecord,
  OdometerReading,
  Page,
  Reminder,
  ReminderState,
  StatsResponse,
  TimelineItem,
  TimelineItemKind,
  UserPreferences,
  UserProfile,
  VehicleDetail,
  VehicleSummary,
} from '@zemlo/shared';

/**
 * Fábrica de chaves de consulta do React Query.
 *
 * Centralizar as chaves não é arrumação: é o que impede que uma invalidação escrita à mão
 * (`['expenses']`) deixe de corresponder à chave usada por uma consulta já em cache
 * (`['expenses', { vehicleId }]`). Um erro desses não dá erro — dá números desatualizados
 * no ecrã, que é a pior forma de falhar num produto de custos.
 *
 * A convenção é `[recurso, âmbito, filtros]` e a hierarquia é sempre da esquerda para a
 * direita: `queryKeys.records.all` invalida tudo o que começa por `records`.
 */
export const queryKeys = {
  me: ['me'] as const,

  vehicles: {
    all: ['vehicles'] as const,
    list: (includeArchived = false) => ['vehicles', 'list', { includeArchived }] as const,
    detail: (vehicleId: string) => ['vehicles', 'detail', vehicleId] as const,
    odometer: (vehicleId: string) => ['vehicles', 'odometer', vehicleId] as const,
  },

  dashboard: (vehicleId?: string) => ['dashboard', vehicleId ?? 'default'] as const,

  stats: (params: { vehicleId?: string; year?: number; months?: number }) =>
    ['stats', params.vehicleId ?? 'account', params.year ?? 'current', params.months ?? 12] as const,

  timeline: (params: { vehicleId?: string; kinds?: string; from?: string; to?: string }) =>
    ['timeline', params.vehicleId ?? 'all', params.kinds ?? 'all', params.from ?? '', params.to ?? ''] as const,

  calendar: (from: string, to: string, vehicleId?: string) =>
    ['calendar', from, to, vehicleId ?? 'all'] as const,

  reminders: {
    all: ['reminders'] as const,
    list: (params: { vehicleId?: string; state?: ReminderState; includeCompleted?: boolean }) =>
      [
        'reminders',
        'list',
        params.vehicleId ?? 'all',
        params.state ?? 'any',
        params.includeCompleted ?? false,
      ] as const,
  },

  records: {
    expenses: (params: { vehicleId?: string; category?: string; from?: string; to?: string; limit?: number }) =>
      [
        'records',
        'expenses',
        params.vehicleId ?? 'all',
        params.category ?? 'all',
        params.from ?? '',
        params.to ?? '',
        params.limit ?? 50,
      ] as const,
    fuel: (params: { vehicleId?: string; from?: string; to?: string; limit?: number }) =>
      ['records', 'fuel', params.vehicleId ?? 'all', params.from ?? '', params.to ?? '', params.limit ?? 50] as const,
    charging: (params: { vehicleId?: string; from?: string; to?: string; limit?: number }) =>
      [
        'records',
        'charging',
        params.vehicleId ?? 'all',
        params.from ?? '',
        params.to ?? '',
        params.limit ?? 50,
      ] as const,
    maintenance: (params: { vehicleId?: string; from?: string; to?: string; limit?: number }) =>
      [
        'records',
        'maintenance',
        params.vehicleId ?? 'all',
        params.from ?? '',
        params.to ?? '',
        params.limit ?? 50,
      ] as const,
    insurance: (vehicleId?: string) => ['records', 'insurance', vehicleId ?? 'all'] as const,
    inspections: (vehicleId?: string) => ['records', 'inspections', vehicleId ?? 'all'] as const,
    taxes: (vehicleId?: string) => ['records', 'taxes', vehicleId ?? 'all'] as const,
    /** Detalhe de um registo isolado, para as rotas `/records/:kind/:id`. */
    detail: (kind: string, id: string) => ['records', 'detail', kind, id] as const,
  },

  documents: {
    list: (params: { vehicleId?: string; limit?: number }) =>
      ['documents', 'list', params.vehicleId ?? 'all', params.limit ?? 50] as const,
    detail: (documentId: string) => ['documents', 'detail', documentId] as const,
    expiring: (withinDays: number) => ['documents', 'expiring', withinDays] as const,
  },

  notifications: (unreadOnly = false) => ['notifications', { unreadOnly }] as const,
  notificationCount: ['notifications', 'unreadCount'] as const,

  integrations: {
    all: ['integrations'] as const,
    list: () => ['integrations', 'list'] as const,
    homeAssistant: (vehicleId?: string) => ['integrations', 'home-assistant', vehicleId ?? 'auto'] as const,
  },

  preferences: ['me', 'preferences'] as const,
  sessions: ['me', 'sessions'] as const,
  metrics: ['metrics'] as const,
};

/* -------------------------------------------------------------------------- */
/* Tipos das respostas que não existem em `@zemlo/shared`                      */
/* -------------------------------------------------------------------------- */

/*
 * A API devolve algumas formas que o pacote partilhado não declara. Documentá-las aqui, e
 * não as inventar em cada ecrã, mantém a fronteira explícita: se um dia forem para o
 * `@zemlo/shared` (por exemplo, quando a app mobile precisar delas), há um único sítio a
 * mudar.
 */

/** Resultado de registar uma leitura de quilometragem (§11). */
export interface OdometerResult {
  odometerKm: number;
  recordedAt: string;
  /** Avisos não bloqueantes em português (ex.: salto grande face à leitura anterior). */
  warnings: string[];
  /** `true` quando o registo foi aceite como correção — excluído do ritmo de utilização. */
  isCorrection: boolean;
  deltaKm: number | null;
  source: { kind: string | null; label: string | null; integrationId: string | null; observedAt: string | null };
  vehicleId?: string;
}

/**
 * Lista de veículos.
 *
 * `GET /vehicles` responde `{ items, total }` — sem `nextCursor`, porque a lista de
 * veículos de uma pessoa não precisa de paginação por cursor. É por isso que esta resposta
 * não é o `Page<VehicleSummary>` genérico, que tem `nextCursor` opcional mas sugere
 * paginação que não existe aqui.
 */
export interface VehicleListResponse {
  items: VehicleSummary[];
  total: number;
}

export interface OdometerListResponse {
  items: OdometerReading[];
  total: number;
}

export interface ReminderListResponse {
  items: Reminder[];
  /**
   * Contagens por estado.
   *
   * Tipadas como parciais de propósito: a API devolve apenas os estados que têm pelo menos
   * um lembrete, pelo que ler `counts.due` sem verificar produziria `undefined` num ecrã que
   * só quer escrever «0 a vencer». O tipo obriga a tratar a ausência, que é o comportamento
   * correto — um `0` está ausente e vazio ao mesmo tempo.
   */
  counts: Partial<Record<ReminderState, number>>;
  total: number;
}

export interface NotificationListResponse extends Page<AppNotification> {
  unreadCount: number;
}

export interface DocumentsExpiringResponse {
  items: DocumentRecord[];
  total: number;
}

export interface SessionsResponse {
  items: Array<{
    id: string;
    deviceLabel: string | null;
    userAgent: string | null;
    ipAddress: string | null;
    createdAt: string;
    lastUsedAt: string;
    expiresAt: string;
    current: boolean;
  }>;
  currentSessionId: string | null;
}

export interface MetricsResponse {
  uptimeSeconds: number;
  version: string;
  environment: string;
  memoryMb: number;
  account: {
    vehicles: number;
    expenses: number;
    fuel: number;
    charging: number;
    maintenance: number;
    documents: number;
    activeReminders: number;
    integrations: number;
    events: number;
  };
}

export interface TwoFactorConfirmResponse {
  twoFactorEnabled: boolean;
  recoveryCodesRemaining: number;
}

/** Resposta de `POST /me/2fa/setup`: segredo, URI `otpauth://` e códigos de recuperação. */
export interface TwoFactorSetupResponse {
  secret: string;
  otpauthUri: string;
  recoveryCodes: string[];
}

export interface ChangePasswordResponse {
  changed: boolean;
  revokedSessions: number;
}

/**
 * Reexporta os tipos de resposta do domínio partilhado que os ecrãs consomem.
 *
 * Os ecrãs importam sempre de `@/api`, e não diretamente de `@zemlo/shared`, por uma
 * razão de manutenção: o dia em que uma destas formas mudar de sítio (por exemplo, se a
 * API passar a devolver o resultado do odómetro no pacote partilhado), há um único
 * ficheiro de importações a ajustar.
 */
export type {
  AppNotification,
  CalendarResponse,
  ChargingSession,
  DashboardResponse,
  DocumentRecord,
  Expense,
  FuelSession,
  HomeAssistantSpec,
  InsurancePolicy,
  InspectionRecord,
  IntegrationRecord,
  MaintenanceRecord,
  Page,
  Reminder,
  ReminderState,
  StatsResponse,
  TimelineItem,
  TimelineItemKind,
  UserPreferences,
  UserProfile,
  VehicleDetail,
  VehicleSummary,
};
