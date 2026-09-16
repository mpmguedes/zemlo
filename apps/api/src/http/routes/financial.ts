/**
 * Rotas de despesas (§12), abastecimentos (§13) e carregamentos (§14).
 *
 * Cada tipo de registo tem dois padrões de URL, ambos válidos:
 *  - `/records/expenses` — a coleção do utilizador, com filtro opcional por veículo;
 *  - `/vehicles/:vehicleId/expenses` — a coleção do veículo.
 *
 * Existem os dois porque servem fluxos diferentes: o registo rápido (§43) não conhece
 * o identificador do veículo e não deve ter de o conhecer; os ecrãs do veículo já
 * estão nesse contexto. Implementar apenas um obrigaria o cliente a traduzir entre os
 * dois, que é onde nascem as inconsistências.
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
  zChargingCreateRequest,
  zChargingUpdateRequest,
  zExpenseCreateRequest,
  zExpenseUpdateRequest,
  zFuelCreateRequest,
  zFuelUpdateRequest,
  zListQuery,
  type ChargingCreateRequest,
  type ChargingUpdateRequest,
  type ExpenseCreateRequest,
  type ExpenseUpdateRequest,
  type FuelCreateRequest,
  type FuelUpdateRequest,
  type ListQuery,
} from '@zemlo/shared';
import { asyncHandler, created, noContent, parseBody, parseQuery, requireUser } from '../../http/handlers.js';
import { requireAuth } from '../../http/middleware.js';
import {
  createChargingSession,
  createExpense,
  createFuelSession,
  deleteChargingSession,
  deleteExpense,
  deleteFuelSession,
  getChargingSession,
  getExpense,
  getFuelSession,
  listChargingSessions,
  listExpenses,
  listFuelSessions,
  updateChargingSession,
  updateExpense,
  updateFuelSession,
} from '../../services/records-financial.js';

export const financialRouter = Router();

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
const financialRouterAuth = [
  '/records/expenses',
  '/records/expenses/:expenseId',
  '/records/fuel',
  '/records/fuel/:sessionId',
  '/records/charging',
  '/records/charging/:sessionId',
  '/vehicles/:vehicleId/expenses',
  '/vehicles/:vehicleId/fuel',
  '/vehicles/:vehicleId/charging',
].map(toRouteRegExp);

financialRouter.use((request, response, next) => {
  const belongsHere = financialRouterAuth.some((pattern) => pattern.test(request.path));
  if (!belongsHere) {
    next();
    return;
  }
  requireAuth()(request, response, next);
});

/* -------------------------------------------------------------------------- */
/* Despesas (§12)                                                              */
/* -------------------------------------------------------------------------- */

financialRouter.get(
  '/records/expenses',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const query = parseQuery(zListQuery, request) as ListQuery;
    response.json(await listExpenses(user.id, query));
  }),
);

financialRouter.post(
  '/records/expenses',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zExpenseCreateRequest, request) as ExpenseCreateRequest;
    const expense = await createExpense(user.id, body);
    created(response, `/api/v1/records/expenses/${expense.id}`, expense);
  }),
);

financialRouter.get(
  '/records/expenses/:expenseId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    response.json(await getExpense(user.id, request.params.expenseId ?? ''));
  }),
);

financialRouter.patch(
  '/records/expenses/:expenseId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zExpenseUpdateRequest, request) as ExpenseUpdateRequest;
    response.json(await updateExpense(user.id, request.params.expenseId ?? '', body));
  }),
);

financialRouter.delete(
  '/records/expenses/:expenseId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    await deleteExpense(user.id, request.params.expenseId ?? '');
    noContent(response);
  }),
);

/* -------------------------------------------------------------------------- */
/* Abastecimentos (§13)                                                        */
/* -------------------------------------------------------------------------- */

financialRouter.get(
  '/records/fuel',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const query = parseQuery(zListQuery, request) as ListQuery;
    response.json(await listFuelSessions(user.id, query));
  }),
);

financialRouter.post(
  '/records/fuel',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zFuelCreateRequest, request) as FuelCreateRequest;
    const session = await createFuelSession(user.id, body);
    created(response, `/api/v1/records/fuel/${session.id}`, session);
  }),
);

financialRouter.get(
  '/records/fuel/:sessionId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    response.json(await getFuelSession(user.id, request.params.sessionId ?? ''));
  }),
);

financialRouter.patch(
  '/records/fuel/:sessionId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zFuelUpdateRequest, request) as FuelUpdateRequest;
    response.json(await updateFuelSession(user.id, request.params.sessionId ?? '', body));
  }),
);

financialRouter.delete(
  '/records/fuel/:sessionId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    await deleteFuelSession(user.id, request.params.sessionId ?? '');
    noContent(response);
  }),
);

/* -------------------------------------------------------------------------- */
/* Carregamentos (§14)                                                         */
/* -------------------------------------------------------------------------- */

financialRouter.get(
  '/records/charging',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const query = parseQuery(zListQuery, request) as ListQuery;
    response.json(await listChargingSessions(user.id, query));
  }),
);

financialRouter.post(
  '/records/charging',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zChargingCreateRequest, request) as ChargingCreateRequest;
    const session = await createChargingSession(user.id, body);
    created(response, `/api/v1/records/charging/${session.id}`, session);
  }),
);

financialRouter.get(
  '/records/charging/:sessionId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    response.json(await getChargingSession(user.id, request.params.sessionId ?? ''));
  }),
);

financialRouter.patch(
  '/records/charging/:sessionId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zChargingUpdateRequest, request) as ChargingUpdateRequest;
    response.json(await updateChargingSession(user.id, request.params.sessionId ?? '', body));
  }),
);

financialRouter.delete(
  '/records/charging/:sessionId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    await deleteChargingSession(user.id, request.params.sessionId ?? '');
    noContent(response);
  }),
);

/* -------------------------------------------------------------------------- */
/* Aliases por veículo                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Registar um recurso no contexto de um veículo.
 *
 * O identificador do caminho **sobrepõe-se** ao do corpo: se forem diferentes, o
 * caminho ganha, porque é o contexto explícito em que o utilizador está a trabalhar.
 * A alternativa — recusar com um erro — obrigaria o cliente a apagar um campo antes de
 * enviar, trabalho sem valor para ninguém.
 */
function withVehicleId(vehicleId: string, body: Record<string, unknown>): Record<string, unknown> {
  return { ...body, vehicleId };
}

for (const path of ['expenses', 'fuel', 'charging'] as const) {
  financialRouter.post(
    `/vehicles/:vehicleId/${path}`,
    asyncHandler(async (request, response) => {
      const user = requireUser(request);
      const vehicleId = request.params.vehicleId ?? '';
      // O corpo é validado já com o `vehicleId` do caminho injetado, para que o esquema
      // valide exatamente o que vai ser persistido (e não uma versão intermédia).
      // `Object.assign` sobre um objeto com o mesmo protótipo mantém todos os campos do
      // pedido (utilizador, metadados) e substitui apenas o corpo.
      const source = Object.assign(Object.create(Object.getPrototypeOf(request)) as typeof request, request, {
        body: withVehicleId(vehicleId, (request.body ?? {}) as Record<string, unknown>),
      });

      if (path === 'expenses') {
        const parsed = parseBody(zExpenseCreateRequest, source) as ExpenseCreateRequest;
        const expense = await createExpense(user.id, parsed);
        created(response, `/api/v1/records/expenses/${expense.id}`, expense);
        return;
      }
      if (path === 'fuel') {
        const parsed = parseBody(zFuelCreateRequest, source) as FuelCreateRequest;
        const session = await createFuelSession(user.id, parsed);
        created(response, `/api/v1/records/fuel/${session.id}`, session);
        return;
      }
      const parsed = parseBody(zChargingCreateRequest, source) as ChargingCreateRequest;
      const session = await createChargingSession(user.id, parsed);
      created(response, `/api/v1/records/charging/${session.id}`, session);
    }),
  );
}
