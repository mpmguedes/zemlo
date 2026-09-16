import type {
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
  OdometerCreateRequest,
  Page,
  Reminder,
  ReminderCompleteRequest,
  ReminderState,
  StatsResponse,
  TimelineItem,
  TimelineItemKind,
  TwoFactorSetupResponse,
  UpdatePreferencesRequest,
  UpdateProfileRequest,
  UserPreferences,
  UserProfile,
  VehicleCreateRequest,
  VehicleDetail,
  VehicleSummary,
  VehicleUpdateRequest,
} from '@zemlo/shared';
import { api } from './client';
import {
  queryKeys,
  type ChangePasswordResponse,
  type DocumentsExpiringResponse,
  type MetricsResponse,
  type NotificationListResponse,
  type OdometerListResponse,
  type OdometerResult,
  type ReminderListResponse,
  type SessionsResponse,
  type TwoFactorConfirmResponse,
  type VehicleListResponse,
} from './queryKeys';

/**
 * Funções de acesso à API, uma por endpoint.
 *
 * São funções simples — recebem parâmetros, devolvem a promessa — e não *hooks*. Essa
 * separação permite usá-las fora do React (invalidações depois de uma mutação,
 * pré-carregamento, testes) e mantém os hooks reduzidos a uma linha de configuração.
 */

/* -------------------------------------------------------------------------- */
/* Conta                                                                       */
/* -------------------------------------------------------------------------- */

export const fetchProfile = (): Promise<UserProfile> => api.get<UserProfile>('/me');

export const updateProfile = (payload: UpdateProfileRequest): Promise<UserProfile> =>
  api.patch<UserProfile>('/me', payload);

export const fetchPreferences = (): Promise<UserPreferences> =>
  api.get<UserPreferences>('/me/preferences');

export const updatePreferences = (payload: UpdatePreferencesRequest): Promise<UserPreferences> =>
  api.patch<UserPreferences>('/me/preferences', payload);

export const fetchSessions = (): Promise<SessionsResponse> => api.get<SessionsResponse>('/me/sessions');

export const revokeSession = (sessionId: string): Promise<void> =>
  api.delete(`/me/sessions/${encodeURIComponent(sessionId)}`);

export const changePassword = (payload: {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions?: boolean;
}): Promise<ChangePasswordResponse> => api.post<ChangePasswordResponse>('/me/password', payload);

export const startTwoFactorSetup = (password: string): Promise<TwoFactorSetupResponse> =>
  api.post<TwoFactorSetupResponse>('/me/2fa/setup', { password });

export const confirmTwoFactorSetup = (payload: {
  secret: string;
  totp: string;
  recoveryCodes?: string[];
}): Promise<TwoFactorConfirmResponse> => api.post<TwoFactorConfirmResponse>('/me/2fa/confirm', payload);

export const disableTwoFactor = (payload: {
  password: string;
  totp?: string;
}): Promise<{ twoFactorEnabled: boolean }> => api.post('/me/2fa/disable', payload);

/* -------------------------------------------------------------------------- */
/* Veículos                                                                    */
/* -------------------------------------------------------------------------- */

export const fetchVehicles = (includeArchived = false): Promise<VehicleListResponse> =>
  api.get<VehicleListResponse>('/vehicles', { query: { includeArchived } });

export const fetchVehicle = (vehicleId: string): Promise<VehicleDetail> =>
  api.get<VehicleDetail>(`/vehicles/${encodeURIComponent(vehicleId)}`);

export const createVehicle = (payload: VehicleCreateRequest): Promise<VehicleSummary> =>
  api.post<VehicleSummary>('/vehicles', payload);

export const updateVehicle = (vehicleId: string, payload: VehicleUpdateRequest): Promise<VehicleDetail> =>
  api.patch<VehicleDetail>(`/vehicles/${encodeURIComponent(vehicleId)}`, payload);

export const deleteVehicle = (vehicleId: string): Promise<void> =>
  api.delete(`/vehicles/${encodeURIComponent(vehicleId)}`);

export const fetchOdometerReadings = (vehicleId: string): Promise<OdometerListResponse> =>
  api.get<OdometerListResponse>(`/vehicles/${encodeURIComponent(vehicleId)}/odometer`);

/**
 * Regista uma leitura de quilometragem (§11).
 *
 * O parâmetro `confirmRegression` é o coração do fluxo de confirmação: a primeira
 * tentativa vai com `false`; se a API responder 422 `unprocessable`, o chamador mostra a
 * mensagem da API (`"A quilometragem recuou 2 381 km… Confirmas?"`) e reenvia com `true`.
 * O pedido é o mesmo — não há um segundo endpoint "forçado", o que evita que exista na
 * API um caminho que salta a validação sem confirmação.
 */
export const recordOdometer = (
  vehicleId: string,
  payload: Omit<OdometerCreateRequest, 'confirmRegression'> & { confirmRegression?: boolean },
): Promise<OdometerResult> =>
  api.post<OdometerResult>(`/vehicles/${encodeURIComponent(vehicleId)}/odometer`, payload);

/** Mesma operação sem indicar o veículo — o fluxo do onboarding (§5). */
export const recordOdometerForOnboarding = (
  payload: Omit<OdometerCreateRequest, 'confirmRegression'> & { confirmRegression?: boolean },
): Promise<OdometerResult> => api.post<OdometerResult>('/odometer', payload);

/* -------------------------------------------------------------------------- */
/* Registos financeiros                                                        */
/* -------------------------------------------------------------------------- */

export interface RecordListParams {
  vehicleId?: string;
  from?: string;
  to?: string;
  category?: string;
  limit?: number;
  cursor?: string;
}

export const fetchExpenses = (params: RecordListParams): Promise<Page<Expense>> =>
  api.get<Page<Expense>>('/records/expenses', { query: { ...params } });

export const createExpense = (
  payload: Record<string, unknown>,
  vehicleId?: string,
): Promise<Expense> =>
  api.post<Expense>(
    vehicleId ? `/vehicles/${encodeURIComponent(vehicleId)}/expenses` : '/records/expenses',
    payload,
  );

export const fetchFuel = (params: RecordListParams): Promise<Page<FuelSession>> =>
  api.get<Page<FuelSession>>('/records/fuel', { query: { ...params } });

export const createFuel = (payload: Record<string, unknown>, vehicleId?: string): Promise<FuelSession> =>
  api.post<FuelSession>(
    vehicleId ? `/vehicles/${encodeURIComponent(vehicleId)}/fuel` : '/records/fuel',
    payload,
  );

export const fetchCharging = (params: RecordListParams): Promise<Page<ChargingSession>> =>
  api.get<Page<ChargingSession>>('/records/charging', { query: { ...params } });

export const createCharging = (
  payload: Record<string, unknown>,
  vehicleId?: string,
): Promise<ChargingSession> =>
  api.post<ChargingSession>(
    vehicleId ? `/vehicles/${encodeURIComponent(vehicleId)}/charging` : '/records/charging',
    payload,
  );

export const fetchMaintenance = (params: RecordListParams): Promise<Page<MaintenanceRecord>> =>
  api.get<Page<MaintenanceRecord>>('/records/maintenance', { query: { ...params } });

export const createMaintenance = (
  payload: Record<string, unknown>,
  vehicleId?: string,
): Promise<MaintenanceRecord> =>
  api.post<MaintenanceRecord>(
    vehicleId ? `/vehicles/${encodeURIComponent(vehicleId)}/maintenance` : '/records/maintenance',
    payload,
  );

export const fetchInsurance = (vehicleId?: string): Promise<Page<InsurancePolicy>> =>
  api.get<Page<InsurancePolicy>>('/records/insurance', { query: { vehicleId, limit: 200 } });

export const createInsurance = (payload: Record<string, unknown>): Promise<InsurancePolicy> =>
  api.post<InsurancePolicy>('/records/insurance', payload);

export const fetchInspections = (vehicleId?: string): Promise<Page<InspectionRecord>> =>
  api.get<Page<InspectionRecord>>('/records/inspections', { query: { vehicleId, limit: 200 } });

export const createInspection = (payload: Record<string, unknown>): Promise<InspectionRecord> =>
  api.post<InspectionRecord>('/records/inspections', payload);

export const fetchTaxes = (vehicleId?: string): Promise<Page<Record<string, unknown>>> =>
  api.get<Page<Record<string, unknown>>>('/records/taxes', { query: { vehicleId, limit: 200 } });

export const createTax = (payload: Record<string, unknown>): Promise<Record<string, unknown>> =>
  api.post<Record<string, unknown>>('/records/taxes', payload);

/** Detalhe de um registo, por tipo. As rotas de detalhe partilham o prefixo `/records`. */
export async function fetchRecordDetail(kind: string, id: string): Promise<unknown> {
  const segment: Record<string, string> = {
    expenses: 'expenses',
    expense: 'expenses',
    fuel: 'fuel',
    charging: 'charging',
    maintenance: 'maintenance',
    insurance: 'insurance',
    inspections: 'inspections',
    inspection: 'inspections',
    taxes: 'taxes',
    tax: 'taxes',
    reminders: 'reminders',
    reminder: 'reminders',
  };
  const path = segment[kind] ?? kind;
  return api.get<unknown>(`/records/${path}/${encodeURIComponent(id)}`);
}

/* -------------------------------------------------------------------------- */
/* Documentos                                                                  */
/* -------------------------------------------------------------------------- */

export const fetchDocuments = (vehicleId?: string, limit = 100): Promise<Page<DocumentRecord>> =>
  api.get<Page<DocumentRecord>>('/documents', { query: { vehicleId, limit } });

export const fetchExpiringDocuments = (withinDays = 60): Promise<DocumentsExpiringResponse> =>
  api.get<DocumentsExpiringResponse>('/documents/expiring', { query: { withinDays } });

export const createDocument = (payload: Record<string, unknown>): Promise<DocumentRecord> =>
  api.post<DocumentRecord>('/documents', payload);

export const deleteDocument = (documentId: string): Promise<void> =>
  api.delete(`/documents/${encodeURIComponent(documentId)}`);

/* -------------------------------------------------------------------------- */
/* Lembretes                                                                   */
/* -------------------------------------------------------------------------- */

export const fetchReminders = (params: {
  vehicleId?: string;
  state?: ReminderState;
  includeCompleted?: boolean;
}): Promise<ReminderListResponse> =>
  api.get<ReminderListResponse>('/reminders', { query: { ...params } });

export const createReminder = (payload: Record<string, unknown>): Promise<Reminder> =>
  api.post<Reminder>('/reminders', payload);

/**
 * Concluir um lembrete.
 *
 * O corpo é opcional e o valor por omissão da API é `createNext: true`: concluir uma revisão
 * anual cria a ocorrência do ano seguinte contada **a partir da data de conclusão** (§16).
 * Passar o valor explicitamente (em vez de confiar no corpo vazio) torna essa intenção
 * visível no cliente — e evita que uma alteração ao valor por omissão do servidor mude o
 * comportamento da interface sem ninguém notar.
 */
export const completeReminder = (
  reminderId: string,
  payload: ReminderCompleteRequest = { createNext: true },
): Promise<{ completed: unknown; next: Reminder | null }> =>
  api.post(`/reminders/${encodeURIComponent(reminderId)}/complete`, payload);

export const snoozeReminder = (reminderId: string, days: number): Promise<Reminder> =>
  api.post<Reminder>(`/reminders/${encodeURIComponent(reminderId)}/snooze`, { days });

export const deleteReminder = (reminderId: string): Promise<void> =>
  api.delete(`/reminders/${encodeURIComponent(reminderId)}`);

/* -------------------------------------------------------------------------- */
/* Dashboard, estatísticas, timeline, calendário                               */
/* -------------------------------------------------------------------------- */

export const fetchDashboard = (vehicleId?: string): Promise<DashboardResponse> =>
  api.get<DashboardResponse>('/dashboard', { query: { vehicleId } });

export const fetchStats = (params: { vehicleId?: string; year?: number; months?: number }): Promise<StatsResponse> =>
  api.get<StatsResponse>('/stats', { query: { ...params } });

export const fetchTimeline = (params: {
  vehicleId?: string;
  limit?: number;
  cursor?: string;
  kinds?: string;
  from?: string;
  to?: string;
}): Promise<Page<TimelineItem>> => api.get<Page<TimelineItem>>('/timeline', { query: { ...params } });

export const fetchCalendar = (params: {
  from: string;
  to: string;
  vehicleId?: string;
}): Promise<CalendarResponse> => api.get<CalendarResponse>('/calendar', { query: { ...params } });

export const fetchMetrics = (): Promise<MetricsResponse> => api.get<MetricsResponse>('/metrics');

export const actOnSuggestion = (
  key: string,
  action: 'done' | 'dismiss' | 'snooze' | 'never',
  snoozeDays?: number,
): Promise<void> =>
  api.post(
    `/suggestions/${encodeURIComponent(key)}`,
    snoozeDays ? { action, snoozeDays } : { action },
  );

/* -------------------------------------------------------------------------- */
/* Notificações                                                                */
/* -------------------------------------------------------------------------- */

export const fetchNotifications = (unreadOnly = false): Promise<NotificationListResponse> =>
  api.get<NotificationListResponse>('/notifications', { query: { unreadOnly, limit: 100 } });

export const markNotificationsRead = (payload: { ids?: string[]; all?: boolean }): Promise<void> =>
  api.post('/notifications/read', payload);

export const deleteNotification = (notificationId: string): Promise<void> =>
  api.delete(`/notifications/${encodeURIComponent(notificationId)}`);

/* -------------------------------------------------------------------------- */
/* Integrações                                                                 */
/* -------------------------------------------------------------------------- */

export const fetchIntegrations = (): Promise<Page<IntegrationRecord>> =>
  api.get<Page<IntegrationRecord>>('/integrations');

export const createIntegration = (payload: Record<string, unknown>): Promise<IntegrationRecord> =>
  api.post<IntegrationRecord>('/integrations', payload);

export const updateIntegration = (
  integrationId: string,
  payload: Record<string, unknown>,
): Promise<IntegrationRecord> =>
  api.patch<IntegrationRecord>(`/integrations/${encodeURIComponent(integrationId)}`, payload);

export const deleteIntegration = (integrationId: string): Promise<void> =>
  api.delete(`/integrations/${encodeURIComponent(integrationId)}`);

export const fetchHomeAssistantSpec = (vehicleId?: string): Promise<HomeAssistantSpec> =>
  api.get<HomeAssistantSpec>('/integrations/home-assistant/spec', { query: { vehicleId } });

/* -------------------------------------------------------------------------- */
/* Exportação (§54)                                                            */
/* -------------------------------------------------------------------------- */

export const fetchExport = (params: {
  format: 'json' | 'csv';
  vehicleId?: string;
  from?: string;
  to?: string;
}): Promise<{ blob: Blob; fileName: string | null }> =>
  api.download('/export', { query: { ...params } });

/* -------------------------------------------------------------------------- */
/* Reexportações úteis para os ecrãs                                           */
/* -------------------------------------------------------------------------- */

export { queryKeys };
export type { OdometerResult, TimelineItemKind };
