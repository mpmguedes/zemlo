import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type {
  DashboardResponse,
  HomeAssistantSpec,
  ReminderState,
  ReminderCompleteRequest,
  StatsResponse,
  UpdatePreferencesRequest,
  UpdateProfileRequest,
  UserPreferences,
  UserProfile,
  VehicleCreateRequest,
  VehicleUpdateRequest,
} from '@zemlo/shared';
import { ApiError, api } from './client';
import { queryKeys } from './queryKeys';
import type {
  DocumentsExpiringResponse,
  MetricsResponse,
  NotificationListResponse,
  OdometerResult,
  ReminderListResponse,
  SessionsResponse,
  TwoFactorConfirmResponse,
  TwoFactorSetupResponse,
  VehicleListResponse,
} from './queryKeys';
import * as q from './queries';

/**
 * Hooks de servidor.
 *
 * Cada ecrã pede o que precisa através de um hook com nome de domínio
 * (`useDashboard(vehicleId)`), nunca através de um `useQuery` solto no componente. Assim a
 * chave de consulta, o tempo de validade e o que invalidar depois de uma mutação ficam
 * definidos num sítio só — e a invalidação correta deixa de depender de quem escreveu o
 * formulário se ter lembrado de a escrever.
 */

/* -------------------------------------------------------------------------- */
/* Conta                                                                       */
/* -------------------------------------------------------------------------- */

export function useProfile(): UseQueryResult<UserProfile> {
  return useQuery({ queryKey: queryKeys.me, queryFn: q.fetchProfile });
}

export function useUpdateProfile(): UseMutationResult<UserProfile, Error, UpdateProfileRequest> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: q.updateProfile,
    onSuccess: (profile) => {
      client.setQueryData(queryKeys.me, profile);
    },
  });
}

export function usePreferences(): UseQueryResult<UserPreferences> {
  return useQuery({ queryKey: queryKeys.preferences, queryFn: q.fetchPreferences });
}

export function useUpdatePreferences(): UseMutationResult<UserPreferences, Error, UpdatePreferencesRequest> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: q.updatePreferences,
    onSuccess: (preferences) => {
      client.setQueryData(queryKeys.preferences, preferences);
    },
  });
}

export function useSessions(): UseQueryResult<SessionsResponse> {
  return useQuery({ queryKey: queryKeys.sessions, queryFn: q.fetchSessions });
}

export function useRevokeSession() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: q.revokeSession,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.sessions }),
  });
}

export function useChangePassword() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: q.changePassword,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.sessions }),
  });
}

export function useTwoFactorSetup(): UseMutationResult<TwoFactorSetupResponse, Error, string> {
  return useMutation({ mutationFn: q.startTwoFactorSetup });
}

export function useConfirmTwoFactor() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: q.confirmTwoFactorSetup,
    onSuccess: (result: TwoFactorConfirmResponse) => {
      void result;
      // O perfil traz `twoFactorEnabled`, que aparece no cartão de segurança e na
      // sugestão do dashboard: invalidar o perfil é o que faz o aviso desaparecer.
      void client.invalidateQueries({ queryKey: queryKeys.me });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useDisableTwoFactor() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: q.disableTwoFactor,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.me });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Veículos                                                                    */
/* -------------------------------------------------------------------------- */

export function useVehicles(includeArchived = false): UseQueryResult<VehicleListResponse> {
  return useQuery({
    queryKey: queryKeys.vehicles.list(includeArchived),
    queryFn: () => q.fetchVehicles(includeArchived),
  });
}

export function useVehicle(vehicleId: string | undefined): UseQueryResult<import('@zemlo/shared').VehicleDetail> {
  return useQuery({
    queryKey: queryKeys.vehicles.detail(vehicleId ?? ''),
    queryFn: () => q.fetchVehicle(vehicleId as string),
    // Sem identificador não há pedido: `enabled` evita um 404 garantido enquanto a rota
    // ainda está a resolver.
    enabled: Boolean(vehicleId),
  });
}

export function useOdometerReadings(vehicleId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.vehicles.odometer(vehicleId ?? ''),
    queryFn: () => q.fetchOdometerReadings(vehicleId as string),
    enabled: Boolean(vehicleId),
  });
}

/** Invalida tudo o que depende de um veículo depois de ele mudar. */
function invalidateVehicle(client: ReturnType<typeof useQueryClient>, vehicleId?: string): void {
  void client.invalidateQueries({ queryKey: queryKeys.vehicles.all });
  void client.invalidateQueries({ queryKey: ['dashboard'] });
  void client.invalidateQueries({ queryKey: ['stats'] });
  void client.invalidateQueries({ queryKey: ['timeline'] });
  void client.invalidateQueries({ queryKey: ['records'] });
  void client.invalidateQueries({ queryKey: ['calendar'] });
  void client.invalidateQueries({ queryKey: queryKeys.reminders.all });
  void client.invalidateQueries({ queryKey: ['documents'] });
  if (vehicleId) void client.invalidateQueries({ queryKey: queryKeys.vehicles.detail(vehicleId) });
}

export function useCreateVehicle() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: VehicleCreateRequest) => q.createVehicle(payload),
    onSuccess: () => invalidateVehicle(client),
  });
}

export function useUpdateVehicle(vehicleId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: VehicleUpdateRequest) => q.updateVehicle(vehicleId, payload),
    onSuccess: () => invalidateVehicle(client, vehicleId),
  });
}

export function useDeleteVehicle() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vehicleId: string) => q.deleteVehicle(vehicleId),
    onSuccess: () => invalidateVehicle(client),
  });
}

/* -------------------------------------------------------------------------- */
/* Quilometragem (§11)                                                         */
/* -------------------------------------------------------------------------- */

export interface OdometerSubmission {
  odometerKm: number;
  recordedAt?: string;
  confirmRegression?: boolean;
  notes?: string;
}

/**
 * Resultado de uma tentativa de registo de quilometragem.
 *
 * Modelado como união discriminada, e não como um resultado com um campo opcional de erro:
 * o compilador passa a exigir que quem trata o sucesso diferencie os dois casos, o que
 * torna impossível mostrar "Guardado" quando a API pediu confirmação.
 */
export type OdometerOutcome =
  | { kind: 'recorded'; result: OdometerResult }
  | { kind: 'needs_confirmation'; message: string; values: OdometerSubmission };

/**
 * Registo de quilometragem com confirmação de recuo.
 *
 * O fluxo é o comportamento central da §11 e está implementado **aqui**, não no ecrã:
 *
 *  1. `submit(values)` envia com `confirmRegression: false`;
 *  2. se a API responder 422 `unprocessable`, o hook **não** a trata como falha: guarda a
 *     mensagem em `confirmation` e devolve `{ needsConfirmation: true }`;
 *  3. o ecrã mostra a mensagem da API (que já explica o recuo em km e a leitura anterior)
 *     e pede um "sim";
 *  4. `confirm()` reenvia os **mesmos** valores com `confirmRegression: true`.
 *
 * Manter o segundo envio dentro do hook garante que os valores reenviados são os que o
 * utilizador confirmou, e não um estado de formulário que entretanto mudou.
 */
export function useRecordOdometer(vehicleId: string | undefined) {
  const client = useQueryClient();
  const [confirmation, setConfirmation] = useState<{ message: string; values: OdometerSubmission } | null>(
    null,
  );

  const mutation = useMutation<OdometerOutcome, Error, OdometerSubmission>({
    mutationFn: async (values) => {
      const payload = {
        odometerKm: values.odometerKm,
        ...(values.recordedAt ? { recordedAt: values.recordedAt } : {}),
        ...(values.notes ? { notes: values.notes } : {}),
        confirmRegression: values.confirmRegression ?? false,
      };
      try {
        const result = vehicleId
          ? await q.recordOdometer(vehicleId, payload)
          : await q.recordOdometerForOnboarding(payload);
        return { kind: 'recorded', result };
      } catch (error) {
        if (error instanceof ApiError && error.isUnprocessable) {
          // A mensagem vem da API já em português e com os números formatados
          // («recuou 2 381 km face à última leitura (43 560 km)»). Reescrevê-la aqui
          // seria duplicar a regra de apresentação e divergir dela à primeira alteração.
          return { kind: 'needs_confirmation', message: error.message, values };
        }
        throw error;
      }
    },
    onSuccess: (outcome) => {
      if (outcome.kind === 'needs_confirmation') {
        setConfirmation({ message: outcome.message, values: outcome.values });
        return;
      }
      setConfirmation(null);
      invalidateVehicle(client, vehicleId);
    },
  });

  const submit = useCallback(
    (values: OdometerSubmission) => {
      setConfirmation(null);
      return mutation.mutateAsync(values);
    },
    [mutation],
  );

  const confirm = useCallback(
    () => (confirmation ? mutation.mutateAsync({ ...confirmation.values, confirmRegression: true }) : null),
    [confirmation, mutation],
  );

  return { ...mutation, submit, confirm, confirmation, dismissConfirmation: () => setConfirmation(null) };
}

/* -------------------------------------------------------------------------- */
/* Registos                                                                    */
/* -------------------------------------------------------------------------- */

type VehicleId = string | undefined;

export function useExpenses(params: q.RecordListParams) {
  return useQuery({
    queryKey: queryKeys.records.expenses(params),
    queryFn: () => q.fetchExpenses(params),
  });
}

export function useFuelSessions(params: q.RecordListParams) {
  return useQuery({ queryKey: queryKeys.records.fuel(params), queryFn: () => q.fetchFuel(params) });
}

export function useChargingSessions(params: q.RecordListParams) {
  return useQuery({
    queryKey: queryKeys.records.charging(params),
    queryFn: () => q.fetchCharging(params),
  });
}

export function useMaintenanceRecords(params: q.RecordListParams) {
  return useQuery({
    queryKey: queryKeys.records.maintenance(params),
    queryFn: () => q.fetchMaintenance(params),
  });
}

export function useInsurance(vehicleId?: string) {
  return useQuery({
    queryKey: queryKeys.records.insurance(vehicleId),
    queryFn: () => q.fetchInsurance(vehicleId),
  });
}

export function useInspections(vehicleId?: string) {
  return useQuery({
    queryKey: queryKeys.records.inspections(vehicleId),
    queryFn: () => q.fetchInspections(vehicleId),
  });
}

export function useTaxes(vehicleId?: string) {
  return useQuery({ queryKey: queryKeys.records.taxes(vehicleId), queryFn: () => q.fetchTaxes(vehicleId) });
}

/**
 * Invalidação depois de criar um registo.
 *
 * Um registo novo mexe em quase tudo: o total do ano, o custo por km, a timeline, o
 * calendário (quando gera lembrete) e os contadores dos veículos. Invalidar por prefixo
 * é o que garante que nenhum desses ecrãs fica a mostrar o valor antigo — e é uma lista
 * que se mantém num sítio só.
 */
function invalidateRecords(client: ReturnType<typeof useQueryClient>, vehicleId?: VehicleId): void {
  void client.invalidateQueries({ queryKey: ['records'] });
  void client.invalidateQueries({ queryKey: ['dashboard'] });
  void client.invalidateQueries({ queryKey: ['stats'] });
  void client.invalidateQueries({ queryKey: ['timeline'] });
  void client.invalidateQueries({ queryKey: ['calendar'] });
  void client.invalidateQueries({ queryKey: queryKeys.reminders.all });
  void client.invalidateQueries({ queryKey: ['notifications'] });
  void client.invalidateQueries({ queryKey: queryKeys.me });
  void client.invalidateQueries({ queryKey: queryKeys.vehicles.all });
  if (vehicleId) void client.invalidateQueries({ queryKey: queryKeys.vehicles.detail(vehicleId) });
}

export function useCreateExpense() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, vehicleId }: { payload: Record<string, unknown>; vehicleId?: string }) =>
      q.createExpense(payload, vehicleId),
    onSuccess: (_data, variables) => invalidateRecords(client, variables.vehicleId),
  });
}

export function useCreateFuel() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, vehicleId }: { payload: Record<string, unknown>; vehicleId?: string }) =>
      q.createFuel(payload, vehicleId),
    onSuccess: (_data, variables) => invalidateRecords(client, variables.vehicleId),
  });
}

export function useCreateCharging() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, vehicleId }: { payload: Record<string, unknown>; vehicleId?: string }) =>
      q.createCharging(payload, vehicleId),
    onSuccess: (_data, variables) => invalidateRecords(client, variables.vehicleId),
  });
}

export function useCreateMaintenance() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, vehicleId }: { payload: Record<string, unknown>; vehicleId?: string }) =>
      q.createMaintenance(payload, vehicleId),
    onSuccess: (_data, variables) => invalidateRecords(client, variables.vehicleId),
  });
}

export function useCreateInsurance() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => q.createInsurance(payload),
    onSuccess: () => invalidateRecords(client),
  });
}

export function useCreateInspection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => q.createInspection(payload),
    onSuccess: () => invalidateRecords(client),
  });
}

export function useCreateTax() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => q.createTax(payload),
    onSuccess: () => invalidateRecords(client),
  });
}

/* -------------------------------------------------------------------------- */
/* Documentos                                                                  */
/* -------------------------------------------------------------------------- */

export function useDocuments(vehicleId?: string, limit = 100) {
  return useQuery({
    queryKey: queryKeys.documents.list({ vehicleId, limit }),
    queryFn: () => q.fetchDocuments(vehicleId, limit),
  });
}

export function useExpiringDocuments(withinDays = 60): UseQueryResult<DocumentsExpiringResponse> {
  return useQuery({
    queryKey: queryKeys.documents.expiring(withinDays),
    queryFn: () => q.fetchExpiringDocuments(withinDays),
  });
}

export function useCreateDocument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => q.createDocument(payload),
    onSuccess: () => invalidateRecords(client),
  });
}

/** Um documento pelo id, para a página de detalhe (§17). */
export function useDocument(documentId: string) {
  return useQuery({
    queryKey: queryKeys.documents.detail(documentId),
    queryFn: () => q.fetchDocument(documentId),
    enabled: documentId.length > 0,
  });
}

/**
 * Edição dos metadados. Invalida a lista **e** o detalhe: o `PATCH` devolve o documento
 * atualizado, mas a lista e o cartão de validades derivam de outros campos (os dias para
 * expirar são calculados no servidor, com o fuso do utilizador), pelo que reutilizar a
 * resposta em vez de refazer a consulta mostraria valores que o servidor não confirmou.
 */
export function useUpdateDocument(documentId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => q.updateDocument(documentId, payload),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.documents.detail(documentId) });
      invalidateRecords(client);
    },
  });
}

/**
 * Transferência dos bytes. É uma mutação, e não uma consulta: dispara um efeito no browser
 * (guardar um ficheiro), não produz estado a cachear, e interessa saber se está em curso
 * para desativar o botão.
 */
export function useDownloadDocument() {
  return useMutation({
    mutationFn: (documentId: string) => q.downloadDocument(documentId),
  });
}

export function useDeleteDocument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => q.deleteDocument(documentId),
    onSuccess: () => invalidateRecords(client),
  });
}

/* -------------------------------------------------------------------------- */
/* Lembretes                                                                   */
/* -------------------------------------------------------------------------- */

export function useReminders(params: {
  vehicleId?: string;
  state?: ReminderState;
  includeCompleted?: boolean;
}): UseQueryResult<ReminderListResponse> {
  return useQuery({
    queryKey: queryKeys.reminders.list(params),
    queryFn: () => q.fetchReminders(params),
  });
}

export function useCreateReminder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => q.createReminder(payload),
    onSuccess: () => invalidateRecords(client),
  });
}

export function useCompleteReminder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ reminderId, payload }: { reminderId: string; payload?: ReminderCompleteRequest }) =>
      q.completeReminder(reminderId, payload ?? { createNext: true }),
    onSuccess: () => invalidateRecords(client),
  });
}

export function useSnoozeReminder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ reminderId, days }: { reminderId: string; days: number }) =>
      q.snoozeReminder(reminderId, days),
    onSuccess: () => invalidateRecords(client),
  });
}

export function useDeleteReminder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (reminderId: string) => q.deleteReminder(reminderId),
    onSuccess: () => invalidateRecords(client),
  });
}

/* -------------------------------------------------------------------------- */
/* Dashboard, estatísticas, timeline, calendário                               */
/* -------------------------------------------------------------------------- */

export function useDashboard(vehicleId?: string): UseQueryResult<DashboardResponse> {
  return useQuery({
    queryKey: queryKeys.dashboard(vehicleId),
    queryFn: () => q.fetchDashboard(vehicleId),
  });
}

export function useStats(params: {
  vehicleId?: string;
  year?: number;
  months?: number;
}): UseQueryResult<StatsResponse> {
  return useQuery({ queryKey: queryKeys.stats(params), queryFn: () => q.fetchStats(params) });
}

export function useMetrics(): UseQueryResult<MetricsResponse> {
  return useQuery({ queryKey: queryKeys.metrics, queryFn: q.fetchMetrics, staleTime: 120_000 });
}

/* -------------------------------------------------------------------------- */
/* Sugestões (§7)                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Decisão sobre uma sugestão, com remoção otimista.
 *
 * O gesto é "esta sugestão já não me interessa": se o cartão ficasse no ecrã durante a
 * ida à rede (e o dashboard é a consulta mais pesada da aplicação), o utilizador
 * carregaria outra vez. A remoção é feita já, a lista é reposta se o pedido falhar — e as
 * sugestões não são semeadas na base de dados, pelo que a reposição é a única forma de
 * manter a interface honesta.
 */
export function useSuggestionAction(vehicleId?: string) {
  const client = useQueryClient();
  const key = queryKeys.dashboard(vehicleId);

  return useMutation({
    mutationFn: ({ suggestionKey, action, snoozeDays }: {
      suggestionKey: string;
      action: 'done' | 'dismiss' | 'snooze' | 'never';
      snoozeDays?: number;
    }) => q.actOnSuggestion(suggestionKey, action, snoozeDays),

    onMutate: async ({ suggestionKey }) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<DashboardResponse>(key);
      if (previous) {
        client.setQueryData<DashboardResponse>(key, {
          ...previous,
          suggestions: previous.suggestions.filter((suggestion) => suggestion.id !== suggestionKey),
        });
      }
      return { previous };
    },

    onError: (_error, _variables, context) => {
      const previous = (context as { previous?: DashboardResponse } | undefined)?.previous;
      if (previous) client.setQueryData(key, previous);
    },

    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['dashboard'] });
      void client.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Notificações                                                                */
/* -------------------------------------------------------------------------- */

export function useNotifications(unreadOnly = false): UseQueryResult<NotificationListResponse> {
  return useQuery({
    queryKey: queryKeys.notifications(unreadOnly),
    queryFn: () => q.fetchNotifications(unreadOnly),
    // As notificações são materializadas durante os pedidos ao dashboard (§22). Sem
    // intervalo, o contador no cabeçalho ficaria preso ao valor do último carregamento;
    // com um intervalo curto, dois separadores abertos gerariam pedidos constantes.
    refetchInterval: 120_000,
  });
}

export function useUnreadCount(): number {
  const { data } = useNotifications(false);
  return data?.unreadCount ?? 0;
}

/**
 * Marcar como lida — com atualização otimista.
 *
 * Este é o caso em que a otimização não é cosmética: marcar como lida é instantâneo do
 * ponto de vista do utilizador, e um atraso de rede faria o indicador de "não lidas"
 * ficar visivelmente desatualizado no ecrã que o utilizador está a olhar.
 */
export function useMarkNotificationsRead() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (payload: { ids?: string[]; all?: boolean }) => q.markNotificationsRead(payload),

    onMutate: async (payload) => {
      await client.cancelQueries({ queryKey: ['notifications'] });
      const snapshots = client.getQueriesData<NotificationListResponse>({ queryKey: ['notifications'] });
      const now = new Date().toISOString();

      for (const [queryKey, data] of snapshots) {
        if (!data || !Array.isArray(data.items)) continue;
        const items = data.items.map((notification) =>
          !notification.readAt && (payload.all || (payload.ids ?? []).includes(notification.id))
            ? { ...notification, readAt: now }
            : notification,
        );
        client.setQueryData<NotificationListResponse>(queryKey, {
          ...data,
          items,
          unreadCount: items.filter((notification) => !notification.readAt).length,
        });
      }

      return { snapshots };
    },

    onError: (_error, _variables, context) => {
      const snapshots = (context as { snapshots?: Array<[readonly unknown[], unknown]> } | undefined)?.snapshots;
      for (const [queryKey, data] of snapshots ?? []) {
        client.setQueryData(queryKey as readonly unknown[], data);
      }
    },

    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useDeleteNotification() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => q.deleteNotification(notificationId),
    onMutate: async (notificationId) => {
      await client.cancelQueries({ queryKey: ['notifications'] });
      const snapshots = client.getQueriesData<NotificationListResponse>({ queryKey: ['notifications'] });
      for (const [queryKey, data] of snapshots) {
        if (!data || !Array.isArray(data.items)) continue;
        const items = data.items.filter((notification) => notification.id !== notificationId);
        client.setQueryData<NotificationListResponse>(queryKey, {
          ...data,
          items,
          unreadCount: items.filter((notification) => !notification.readAt).length,
        });
      }
      return { snapshots };
    },
    onError: (_error, _variables, context) => {
      const snapshots = (context as { snapshots?: Array<[readonly unknown[], unknown]> } | undefined)?.snapshots;
      for (const [queryKey, data] of snapshots ?? []) {
        client.setQueryData(queryKey as readonly unknown[], data);
      }
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Integrações                                                                 */
/* -------------------------------------------------------------------------- */

export function useIntegrations() {
  return useQuery({ queryKey: queryKeys.integrations.list(), queryFn: q.fetchIntegrations });
}

export function useHomeAssistantSpec(vehicleId?: string): UseQueryResult<HomeAssistantSpec> {
  return useQuery({
    queryKey: queryKeys.integrations.homeAssistant(vehicleId),
    queryFn: () => q.fetchHomeAssistantSpec(vehicleId),
  });
}

export function useCreateIntegration() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => q.createIntegration(payload),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.integrations.all });
      void client.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

export function useUpdateIntegration() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ integrationId, payload }: { integrationId: string; payload: Record<string, unknown> }) =>
      q.updateIntegration(integrationId, payload),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.integrations.all }),
  });
}

export function useDeleteIntegration() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (integrationId: string) => q.deleteIntegration(integrationId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.integrations.all });
      void client.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

/** Reexportado para os formulários que precisam de classificar erros da API. */
export { ApiError, api };
