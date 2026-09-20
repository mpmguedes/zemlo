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
import type { BundleApplyResponse, BundlePreviewResponse } from './bundleImport';
import type {
  CsvApplyResponse,
  CsvImportParams,
  CsvPreviewResponse,
} from './csvImport';
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

export const fetchDocument = (documentId: string): Promise<DocumentRecord> =>
  api.get<DocumentRecord>(`/documents/${encodeURIComponent(documentId)}`);

export const updateDocument = (
  documentId: string,
  payload: Record<string, unknown>,
): Promise<DocumentRecord> =>
  api.patch<DocumentRecord>(`/documents/${encodeURIComponent(documentId)}`, payload);

export const deleteDocument = (documentId: string): Promise<void> =>
  api.delete(`/documents/${encodeURIComponent(documentId)}`);

/**
 * Transferência dos bytes de um documento.
 *
 * O nome do ficheiro vem do `Content-Disposition` da API, que já o sanitizou — reconstruí-lo
 * aqui a partir do nome do documento produziria um nome diferente do que ficou registado em
 * auditoria e desfaria a sanitização.
 */
export const downloadDocument = (
  documentId: string,
): Promise<{ blob: Blob; fileName: string | null }> =>
  api.download(`/documents/${encodeURIComponent(documentId)}/content`);

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

/**
 * Descarrega o **bundle nativo** — o ZIP que o importador do Zemlo sabe reabrir (§5.2).
 *
 * ## Porque é que isto é uma função própria e não um `format` a mais
 *
 * Os dois artefactos servem propósitos diferentes e têm formas diferentes: o JSON/CSV
 * legado existe para o utilizador **ler** os seus dados (uma folha de cálculo, um
 * script), e o bundle existe para os **trazer de volta** com fidelidade total. Juntá-los
 * atrás de um `format` faria a interface tratar como variantes dois ficheiros que não
 * partilham nem o tipo MIME nem o consumidor.
 *
 * O `vehicleId` é o único filtro do bundle. O âmbito temporal não existe deste lado, e a
 * ausência é deliberada (§5.7): um bundle com referências entre registos não pode ser
 * cortado por datas sem decidir o que fazer com o que fica órfão.
 */
export const fetchExportBundle = (params: {
  vehicleId?: string;
}): Promise<{ blob: Blob; fileName: string | null }> =>
  api.download('/export/bundle', { query: { ...params } });

/* -------------------------------------------------------------------------- */
/* Importação de CSV (Camada 2, §10)                                           */
/* -------------------------------------------------------------------------- */

/**
 * O `Content-Type` com que o CSV é enviado.
 *
 * `text/csv` e não `text/plain` porque é o tipo verdadeiro do ficheiro, e a API aceita os
 * dois. O `charset` fica de fora de propósito: a codificação é detetada **pelos bytes**, e
 * declará-la aqui seria uma afirmação do browser que poderia contradizer o conteúdo — um
 * `charset=utf-8` num ficheiro CP1252 produziria uma deteção a discutir com o cabeçalho.
 */
const CSV_CONTENT_TYPE = 'text/csv';

/**
 * O `Content-Type` com que o bundle nativo é enviado.
 *
 * `application/zip` é o tipo verdadeiro do ficheiro e o primeiro da lista fechada que a
 * rota de importação aceita. Enviar `application/octet-stream` também funcionaria — está
 * na mesma lista —, mas declarar o tipo correto é o que permite à API nomear a causa
 * quando o ficheiro enviado não é o que se esperava.
 *
 * Ao contrário do CSV, aqui **não há** deteção de codificação nem de separador: o tipo
 * não é uma hipótese a confirmar, é o formato do artefacto. O que a API valida é a
 * assinatura do ZIP e a integridade declarada no manifest.
 */
const BUNDLE_CONTENT_TYPE = 'application/zip';

/**
 * Analisa um bundle nativo **sem escrever nada** (§7.1).
 *
 * O ficheiro é enviado tal como o utilizador o escolheu — sem reencodar, sem recomprimir,
 * sem reabrir. É a mesma razão do CSV: o `bundleId` e os `sha256` declarados no manifest
 * referem-se aos bytes **originais**, e tocar neles invalidaria a verificação de
 * integridade que o leitor faz.
 *
 * Não há `decisions` nem convenções a enviar. Um bundle já traz os seus valores
 * interpretados: a única coisa que o utilizador decide é aplicar ou não.
 */
export const previewBundleImport = (file: Blob): Promise<BundlePreviewResponse> =>
  api.upload<BundlePreviewResponse>('/import/preview', file, BUNDLE_CONTENT_TYPE);

/**
 * Aplica o plano aprovado. **Escreve** — e devolve o relatório (§11.5).
 *
 * O corpo é o **mesmo** ZIP que o `preview` leu, e o plano aprovado viaja na *query*, em
 * `?plan=…`. É a assinatura que a rota define: o corpo já está ocupado pelo ficheiro, e o
 * servidor **reanalisa os bytes** em vez de confiar no plano que recebe. O plano diz o que
 * fazer; os registos vêm sempre da fonte que os sabe interpretar — o bundle lido neste
 * pedido.
 *
 * ## Porque é que o plano é confiado apesar de ser recalculado
 *
 * Não é uma contradição: o `apply` reconstrói os registos a partir dos bytes e usa o
 * plano recebido para saber **o que fazer com eles**. Recalcular o plano no `apply` abriria
 * a janela de divergência entre a revisão e a escrita que a §11.3 não perdoa.
 *
 * ## Porque é que se aceita a resposta do preview inteira
 *
 * O plano que a rota do `apply` lê é um subconjunto do corpo do `preview` — o `bundleId`,
 * para confronto. Como a forma do `preview` já **contém** tudo o que o `apply` usa, exigir
 * aqui um tipo separado obrigaria a interface a desembrulhar a resposta antes de a
 * reenviar, e esse desembrulho seria um sítio a mais onde um campo se pode perder. Reenviar
 * o corpo tal como veio é o que garante que o que o utilizador aprovou é o que chega.
 */
export const applyBundleImport = (
  file: Blob,
  plan: BundlePreviewResponse,
): Promise<BundleApplyResponse> =>
  api.upload<BundleApplyResponse>('/import/apply', file, BUNDLE_CONTENT_TYPE, {
    query: { plan: JSON.stringify(plan) },
  });

/**
 * Analisa um CSV **sem escrever nada** (§7.1).
 *
 * O `bytes` é o `File` escolhido pelo utilizador, enviado sem qualquer transformação: é o
 * `sha256` destes bytes que identifica o ficheiro no livro de idempotência, pelo que
 * reencodar o conteúdo aqui mudaria a identidade e faria a segunda importação do mesmo
 * ficheiro parecer uma importação nova.
 *
 * `decisions` só é enviado quando há decisões: um array vazio na *query* seria interpretado
 * como "o utilizador decidiu não mapear nada", que é diferente de "ainda não decidiu".
 */
export const previewCsvImport = (
  file: Blob,
  params: CsvImportParams,
): Promise<CsvPreviewResponse> =>
  api.upload<CsvPreviewResponse>(
    '/import/csv/preview',
    file,
    CSV_CONTENT_TYPE,
    { query: csvQuery(params) },
  );

/** Aplica o plano revisto. **Escreve** — e devolve o relatório (§10.2, passos 8–9). */
export const applyCsvImport = (
  file: Blob,
  params: CsvImportParams,
): Promise<CsvApplyResponse> =>
  api.upload<CsvApplyResponse>(
    '/import/csv/apply',
    file,
    CSV_CONTENT_TYPE,
    { query: csvQuery(params) },
  );

/**
 * Traduz as opções para a *query string*.
 *
 * As decisões de coluna viajam como **JSON** (`decisions=[{"index":0,"field":"date"}]`).
 *
 * ## Porque é que não é um formato compacto
 *
 * Um par `índice:campo` separado por vírgulas seria mais curto, mas parte de uma premissa
 * falsa: que o campo é um identificador simples. Não é — o servidor valida-o contra o
 * vocabulário canónico, e um dia poderá ser qualquer texto. Nesse momento uma vírgula ou um
 * `&` dentro do valor seria indistinguível do separador, e a codificação passaria a ser um
 * problema de aspas a resolver em dois sítios.
 *
 * O JSON é também o formato que a API **já analisa** (`parseCsvOptions`), com uma validação
 * explícita por entrada: índice inteiro não negativo, campo texto ou `null`. Um formato
 * compacto obrigaria a acrescentar um segundo analisador no servidor, e dois analisadores
 * para o mesmo conceito divergem à primeira alteração.
 *
 * ## O que não é enviado
 *
 *  - `decisions` vazio fica de fora: um array vazio dentro do JSON é uma lista vazia válida,
 *    mas enviá-lo seria dizer «o utilizador decidiu não mapear nada», que é diferente de
 *    «ainda não decidiu». Ausente, o campo não é tocado.
 *  - `identity` vazio fica de fora pela mesma razão: `parseIdentityParam` trata a ausência
 *    como «sem identificador a confrontar», e uma cadeia vazia seria um identificador que
 *    nunca corresponde — recusaria sempre com 409.
 */
function csvQuery(params: CsvImportParams): Record<string, string | number | undefined> {
  const decisions = params.decisions;
  return {
    ...(params.kind !== undefined ? { kind: params.kind } : {}),
    ...(params.dateOrder !== undefined ? { dateOrder: params.dateOrder } : {}),
    ...(params.decimalStyle !== undefined ? { decimalStyle: params.decimalStyle } : {}),
    ...(params.conflictPolicy !== undefined ? { conflictPolicy: params.conflictPolicy } : {}),
    ...(params.identity !== undefined && params.identity !== '' ? { identity: params.identity } : {}),
    ...(decisions !== undefined && decisions.length > 0
      ? { decisions: JSON.stringify(decisions) }
      : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Reexportações úteis para os ecrãs                                           */
/* -------------------------------------------------------------------------- */

export { queryKeys };
export type { OdometerResult, TimelineItemKind };
/*
 * `RecordKind` é reexportado por conveniência dos ecrãs de importação, que precisam de o
 * nomear para o tipo escolhido. Vem do pacote partilhado — é um tipo de domínio — mas
 * reexportá-lo aqui mantém a regra de `queryKeys.ts`: um ecrã importa de `@/api` e não de
 * `@zemlo/shared`, para que uma mudança de sítio seja um único ficheiro a ajustar.
 */
export type { RecordKind } from '@zemlo/shared';

/*
 * Os tipos da Camada 1 (bundle nativo) são reexportados ao lado dos da Camada 2, para que
 * um ecrã de importação tenha uma única origem — `/api` — e não precise de saber em que
 * ficheiro cada camada declara o seu contrato.
 */
export type {
  BundleApplyResponse,
  BundleConflictKind,
  BundleIssueSummary,
  BundleMatchedRecord,
  BundlePlan,
  BundlePlanAction,
  BundlePlanCounts,
  BundlePlanEntry,
  BundlePlanState,
  BundlePreviewResponse,
  BundleReportedEnrichment,
  BundleReportedRecord,
  BundleReportedSkip,
} from './bundleImport';

export type {
  ColumnDecision,
  ColumnMapping,
  ColumnState,
  CsvApplyResponse,
  CsvDetection,
  CsvImportParams,
  CsvMappingView,
  CsvPreviewResponse,
  CsvRecordPreview,
  CsvSkippedRow,
  CsvValueIssue,
  DateOrder,
  DecimalStyle,
  ConflictPolicy,
  FieldCandidate,
  ImportIssue,
  ImportPlanView,
  KindInference,
  PlanCounts,
  PlanEntry,
  SavedMapSummary,
} from './csvImport';
