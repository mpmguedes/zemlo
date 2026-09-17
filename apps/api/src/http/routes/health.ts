/**
 * Rotas de saúde e diagnóstico (§56).
 *
 * Distinção importante entre os dois endpoints:
 *  - `/health` é **público** e diz apenas se o serviço está de pé e se a base de dados
 *    responde. Não expõe versões de dependências, contagens nem configuração;
 *  - `/admin/metrics` exige autenticação. Não há um papel de administrador no MVP, por
 *    isso qualquer utilizador autenticado pode consultar as suas próprias métricas — mas
 *    não as da plataforma.
 *
 * Um endpoint de saúde pública que devolva detalhes internos é um presente para quem
 * está a fazer reconhecimento (§30).
 */

import { Router } from 'express';
import type { HealthResponse } from '@zemlo/shared';
import { PLATFORM_VERSION } from '@zemlo/shared';
import { activeProvider, checkDatabase, prisma } from '../../core/db.js';
import { config } from '../../core/config.js';
import { asyncHandler, parseQuery, requireUser } from '../../http/handlers.js';
import { requireAuth } from '../../http/middleware.js';
import { zDashboardQuery } from '@zemlo/shared';

const startedAt = Date.now();

export const healthRouter = Router();

/**
 * Verificação de saúde.
 *
 * Devolve 503 quando a base de dados não responde: um balanceador ou o Cloudflare devem
 * retirar a instância de rotação. Responder 200 com `status: "degraded"` deixaria o
 * tráfego a chegar a um serviço que não consegue servir nada.
 *
 * O campo `database.provider` reporta o motor **efetivamente em uso** — o do cliente
 * Prisma que foi carregado —, não a variável de ambiente `DATABASE_PROVIDER`. A diferença
 * importa: enquanto o cliente era escolhido por um caminho partilhado, a aplicação podia
 * estar a escrever em SQLite com `DATABASE_PROVIDER=postgresql`, e um `/health` que
 * repetisse a variável confirmaria a configuração errada em vez de a denunciar. Reportar
 * o cliente carregado faz deste campo uma verificação e não um eco.
 *
 * A incoerência entre ambos é impossível em runtime: `core/prisma-client.ts` recusa
 * arrancar se não coincidirem, e recusa SQLite quando `NODE_ENV=production`.
 */
healthRouter.get(
  '/health',
  asyncHandler(async (_request, response) => {
    const database = await checkDatabase();

    const body: HealthResponse = {
      status: database.reachable ? 'ok' : 'degraded',
      version: PLATFORM_VERSION,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      database: {
        reachable: database.reachable,
        provider: activeProvider,
        latencyMs: database.latencyMs,
      },
      time: new Date().toISOString(),
    };

    response.status(database.reachable ? 200 : 503).json(body);
  }),
);

/**
 * Sonda de prontidão, para o orquestrador.
 * Deliberadamente mais barata: não toca na base de dados.
 */
healthRouter.get('/health/live', (_request, response) => {
  response.json({ status: 'ok' });
});

/* -------------------------------------------------------------------------- */
/* Métricas do utilizador (§56)                                                */
/* -------------------------------------------------------------------------- */

export const metricsRouter = Router();

/*
 * Autenticação com correspondência exata, pela mesma razão que nos restantes routers: um
 * `use(requireAuth())` sem âmbito corre para **qualquer** pedido que chegue ao router,
 * incluindo endereços inexistentes, e devolve 401 onde a resposta correta é 404. Era o que
 * fazia `/api/v1/nao-existe` responder 401 em vez de 404 — o último router da cadeia.
 */
metricsRouter.use((request, response, next) => {
  if (request.path !== '/metrics') {
    next();
    return;
  }
  requireAuth()(request, response, next);
});

/**
 * Métricas da conta do utilizador autenticado.
 *
 * São as métricas que importam ao produto: quantos veículos, quantos registos, qual a
 * completude dos dados. Servem o ecrã "Estado dos teus dados" — e são também o que
 * permite responder à pergunta central do MVP (§39): o Zemlo é útil mesmo sem
 * integrações avançadas?
 */
metricsRouter.get(
  '/metrics',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    parseQuery(zDashboardQuery, request);

    const [vehicles, expenses, fuel, charging, maintenance, documents, reminders, integrations, events] =
      await Promise.all([
        prisma.vehicle.count({ where: { userId: user.id } }),
        prisma.expense.count({ where: { userId: user.id } }),
        prisma.fuelSession.count({ where: { userId: user.id } }),
        prisma.chargingSession.count({ where: { userId: user.id } }),
        prisma.maintenanceRecord.count({ where: { userId: user.id } }),
        prisma.document.count({ where: { userId: user.id } }),
        prisma.reminder.count({ where: { userId: user.id, completedAt: null } }),
        prisma.integration.count({ where: { userId: user.id } }),
        prisma.vehicleEvent.count({ where: { userId: user.id } }),
      ]);

    response.json({
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      version: PLATFORM_VERSION,
      environment: config.nodeEnv,
      memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      account: {
        vehicles,
        expenses,
        fuel,
        charging,
        maintenance,
        documents,
        activeReminders: reminders,
        integrations,
        events,
      },
    });
  }),
);
