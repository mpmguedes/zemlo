/**
 * Rotas de leitura agregada: dashboard (§8), estatísticas (§23), timeline (§24),
 * calendário (§21) e sugestões (§7).
 *
 * Estão juntas porque partilham o mesmo carregamento de dados: o dashboard e as
 * estatísticas leem exatamente o mesmo conjunto (`loadVehicleAnalytics`) e diferem
 * apenas na apresentação. Mantê-las no mesmo router torna evidente que partilham a
 * fonte — e evita que alguém, mais tarde, "otimize" uma delas com consultas próprias e
 * faça os números divergirem.
 */

import { Router } from 'express';

/**
 * Converte um caminho com `:parametros` numa expressão regular ancorada.
 *
 * Ancorada nas duas pontas de propósito: `/dashboard` corresponde a `/dashboard` e não a
 * `/dashboard-x`, que é um endereço diferente e inexistente.
 */
function toRouteRegExp(route: string): RegExp {
  const source = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z0-9_]+/g, '[^/]+');
  return new RegExp('^' + source + '$');
}
import {
  zCalendarQuery,
  zDashboardQuery,
  zStatsQuery,
  zSuggestionActionRequest,
  zTimelineQuery,
  type CalendarQuery,
  type DashboardQuery,
  type StatsQuery,
  type SuggestionActionRequest,
  type TimelineQuery,
} from '@zemlo/shared';
import { asyncHandler, parseBody, parseQuery, requireUser } from '../../http/handlers.js';
import { requireAuth, today } from '../../http/middleware.js';
import { prisma } from '../../core/db.js';
import { notFound } from '../../core/errors.js';
import {
  buildAccountStats,
  buildCalendar,
  buildDashboard,
  buildStats,
  getTimeline,
  loadVehicleAnalytics,
} from '../../services/analytics.js';
import { recordSuggestionDecision } from '../../services/suggestions.js';
import { listReminders } from '../../services/reminders.js';
import { syncNotifications } from '../../services/notifications.js';
import { documentsExpiringSoon } from '../../services/documents.js';

export const insightsRouter = Router();

/*
 * Autenticação com correspondência **exata** de rota.
 *
 * Só se aplica aos endereços que este router realmente serve, e é isso que torna a
 * distinção entre 401 e 404 previsível:
 *
 *  - endereço que não existe  -> **404**, com ou sem token;
 *  - endereço que existe sem autenticação -> **401**.
 *
 * Um `use(requireAuth())` sem âmbito correria para tudo e devolveria 401 num endereço
 * inexistente. Com prefixos, `/dashboard-x` receberia 401 por começar como um prefixo
 * conhecido. A correspondência exata elimina as duas ambiguidades.
 *
 * Os caminhos são declarados como texto e convertidos uma única vez aqui: uma expressão
 * regular escrita à mão precisa de escapar as barras, e um erro desses deixa o ficheiro
 * com sintaxe inválida.
 */
const insightsRouterAuth = [
  '/dashboard',
  '/stats',
  '/timeline',
  '/calendar',
  '/suggestions/:key',
].map(toRouteRegExp);

insightsRouter.use((request, response, next) => {
  const belongsHere = insightsRouterAuth.some((pattern) => pattern.test(request.path));
  if (!belongsHere) {
    next();
    return;
  }
  requireAuth()(request, response, next);
});

/* -------------------------------------------------------------------------- */
/* Dashboard (§8)                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Dashboard.
 *
 * Antes de responder, sincroniza as notificações internas: abrir a aplicação é o
 * momento natural para materializar os avisos de lembretes que entretanto mudaram de
 * estado. No MVP isto substitui um trabalho agendado — e, quando o agendador existir,
 * passa a ser uma otimização, não uma dependência.
 */
insightsRouter.get(
  '/dashboard',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    parseQuery(zDashboardQuery, request) as DashboardQuery;

    const vehicles = await prisma.vehicle.findMany({
      where: { userId: user.id, archived: false },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        plateDisplay: true,
        odometerKm: true,
        make: true,
        model: true,
        nickname: true,
        fuelType: true,
        vehicleType: true,
        vin: true,
        year: true,
      },
    });

    const focusId = typeof request.query.vehicleId === 'string' ? request.query.vehicleId : undefined;
    const focus = focusId ? vehicles.find((vehicle) => vehicle.id === focusId) : (vehicles[0] ?? null);

    if (focusId && !focus) throw notFound('Não encontrámos esse veículo.');

    const analytics = focus ? await loadVehicleAnalytics(user.id, focus.id) : null;

    const dashboard = await buildDashboard({
      userId: user.id,
      timeZone: user.timeZone,
      vehicles,
      analytics,
      today: today(request),
    });

    // Sincronização de notificações: best-effort. Uma falha aqui não deve impedir o
    // utilizador de ver o seu dashboard.
    try {
      const reminderList = await listReminders(user.id, {
        includeCompleted: false,
        windowDays: 180,
        windowKm: 5000,
      });
      const expiring = await documentsExpiringSoon(user.id, today(request), 30);
      await syncNotifications({
        userId: user.id,
        timeZone: user.timeZone,
        vehicles: vehicles.map((vehicle) => ({
          id: vehicle.id,
          plateDisplay: vehicle.plateDisplay,
          odometerKm: vehicle.odometerKm,
        })),
        reminders: reminderList.items.map((reminder) => ({
          id: reminder.id,
          vehicleId: reminder.vehicleId,
          title: reminder.title,
          topic: topicForReminder(reminder.title),
          state: reminder.evaluation.state,
          summary: reminder.evaluation.summary,
          daysRemaining: reminder.evaluation.daysRemaining,
          kmRemaining: reminder.evaluation.kmRemaining,
          dueDate: reminder.dueDate,
          projectedDate: reminder.evaluation.projectedDate,
        })),
        expiringDocuments: expiring.map((document) => ({
          id: document.id,
          name: document.name,
          expiresAt: document.expiresAt,
          daysToExpiry: document.daysToExpiry,
          vehicleId: document.vehicleId,
        })),
      });
    } catch {
      // Silencioso de propósito: ver comentário acima.
    }

    response.json(dashboard);
  }),
);

/* -------------------------------------------------------------------------- */
/* Estatísticas (§23)                                                          */
/* -------------------------------------------------------------------------- */

insightsRouter.get(
  '/stats',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const query = parseQuery(zStatsQuery, request) as StatsQuery;
    const options = { year: query.year, months: query.months, today: today(request) };

    if (query.vehicleId) {
      const analytics = await loadVehicleAnalytics(user.id, query.vehicleId);
      response.json(buildStats(analytics, options));
      return;
    }

    // Sem veículo indicado: estatísticas da conta inteira.
    const vehicles = await prisma.vehicle.findMany({
      where: { userId: user.id, archived: false },
      select: { id: true },
    });

    if (vehicles.length === 0) {
      response.json(
        buildAccountStats([], {
          ...options,
          label: 'Sem veículos',
        }),
      );
      return;
    }

    const analyticsList = await Promise.all(
      vehicles.map((vehicle) => loadVehicleAnalytics(user.id, vehicle.id)),
    );

    response.json(
      buildAccountStats(analyticsList, {
        ...options,
        label: vehicles.length === 1 ? 'O teu veículo' : `${vehicles.length} veículos`,
      }),
    );
  }),
);

/* -------------------------------------------------------------------------- */
/* Timeline (§24)                                                              */
/* -------------------------------------------------------------------------- */

insightsRouter.get(
  '/timeline',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const query = parseQuery(zTimelineQuery, request) as TimelineQuery;
    const kinds = query.kinds
      ? query.kinds
          .split(',')
          .map((kind) => kind.trim())
          .filter(Boolean)
      : undefined;

    response.json(
      await getTimeline(user.id, {
        vehicleId: query.vehicleId,
        limit: query.limit,
        cursor: query.cursor,
        kinds,
        from: query.from,
        to: query.to,
        timeZone: user.timeZone,
      }),
    );
  }),
);

/* -------------------------------------------------------------------------- */
/* Calendário (§21)                                                            */
/* -------------------------------------------------------------------------- */

insightsRouter.get(
  '/calendar',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const query = parseQuery(zCalendarQuery, request) as CalendarQuery;

    response.json(
      await buildCalendar(user.id, {
        from: query.from,
        to: query.to,
        vehicleId: query.vehicleId,
        timeZone: user.timeZone,
      }),
    );
  }),
);

/* -------------------------------------------------------------------------- */
/* Sugestões (§7)                                                              */
/* -------------------------------------------------------------------------- */

insightsRouter.post(
  '/suggestions/:key',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zSuggestionActionRequest, request) as SuggestionActionRequest;
    // A chave identifica a sugestão de forma estável: `tipo` ou `tipo:veiculoId`.
    // É enviada no caminho codificada, porque contém `:`.
    await recordSuggestionDecision(
      user.id,
      decodeURIComponent(request.params.key ?? ''),
      { action: body.action, snoozeDays: body.snoozeDays ?? 14 },
      user.timeZone,
    );
    response.status(204).end();
  }),
);

/* -------------------------------------------------------------------------- */
/* Auxiliares                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Tópico de notificação inferido do título do lembrete.
 *
 * O modelo `Reminder` já tem uma coluna `topic`, mas os lembretes criados antes de essa
 * coluna existir têm o valor por omissão (`maintenance`). Inferir pelo título mantém as
 * notificações corretas para dados antigos e é o tipo de compatibilidade que se paga
 * uma vez e se esquece.
 */
function topicForReminder(title: string): string {
  const normalized = title.toLowerCase();
  if (normalized.includes('seguro') || normalized.includes('apólice') || normalized.includes('apolice')) {
    return 'insurance';
  }
  if (normalized.includes('inspeção') || normalized.includes('inspecao')) return 'inspection';
  if (normalized.includes('iuc') || normalized.includes('imposto')) return 'tax';
  if (normalized.includes('validade') || normalized.includes('documento')) return 'document';
  return 'maintenance';
}
