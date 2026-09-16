/**
 * Rotas de lembretes (§16, §21, §22).
 *
 * O endpoint de conclusão devolve o lembrete concluído **e** a ocorrência seguinte,
 * quando a repetição está ativa. O cliente não deve ter de fazer dois pedidos nem
 * adivinhar qual é o próximo: a informação sai junta na resposta que o utilizador
 * desencadeou.
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
  zReminderCompleteRequest,
  zReminderCreateRequest,
  zReminderListQuery,
  zReminderUpdateRequest,
  type ReminderCompleteRequest,
  type ReminderCreateRequest,
  type ReminderListQuery,
  type ReminderUpdateRequest,
} from '@zemlo/shared';
import { asyncHandler, created, noContent, parseBody, parseQuery, requireUser } from '../../http/handlers.js';
import { requireAuth } from '../../http/middleware.js';
import {
  completeReminder,
  createReminder,
  deleteReminder,
  getReminder,
  listReminders,
  snoozeReminder,
  updateReminder,
} from '../../services/reminders.js';

export const remindersRouter = Router();

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
const remindersRouterAuth = [
  '/reminders',
  '/reminders/:reminderId',
  '/reminders/:reminderId/complete',
  '/reminders/:reminderId/snooze',
].map(toRouteRegExp);

remindersRouter.use((request, response, next) => {
  const belongsHere = remindersRouterAuth.some((pattern) => pattern.test(request.path));
  if (!belongsHere) {
    next();
    return;
  }
  requireAuth()(request, response, next);
});

remindersRouter.get(
  '/reminders',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const query = parseQuery(zReminderListQuery, request) as ReminderListQuery;
    const result = await listReminders(user.id, query);
    response.json({ ...result, total: result.items.length });
  }),
);

remindersRouter.post(
  '/reminders',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zReminderCreateRequest, request) as ReminderCreateRequest;
    const reminder = await createReminder(user.id, body);
    created(response, `/api/v1/reminders/${reminder.id}`, reminder);
  }),
);

remindersRouter.get(
  '/reminders/:reminderId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    response.json(await getReminder(user.id, request.params.reminderId ?? ''));
  }),
);

remindersRouter.patch(
  '/reminders/:reminderId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zReminderUpdateRequest, request) as ReminderUpdateRequest;
    response.json(await updateReminder(user.id, request.params.reminderId ?? '', body));
  }),
);

remindersRouter.delete(
  '/reminders/:reminderId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    await deleteReminder(user.id, request.params.reminderId ?? '');
    noContent(response);
  }),
);

remindersRouter.post(
  '/reminders/:reminderId/complete',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zReminderCompleteRequest, request) as ReminderCompleteRequest;
    response.json(await completeReminder(user.id, request.params.reminderId ?? '', body));
  }),
);

/**
 * Adiar um lembrete.
 *
 * Existe como endpoint próprio (e não como um `PATCH` da data) porque "adiar" tem
 * semântica de produto: o utilizador está a dizer "não quero ver isto agora", não
 * "a data correta é outra". A data efetiva é calculada a partir de hoje, para que
 * adiar um lembrete já em atraso o traga para o futuro em vez de o manter no passado.
 */
remindersRouter.post(
  '/reminders/:reminderId/snooze',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const days = Number.parseInt(String(request.body?.days ?? '14'), 10);
    response.json(
      await snoozeReminder(
        user.id,
        request.params.reminderId ?? '',
        Number.isFinite(days) ? Math.min(Math.max(days, 1), 365) : 14,
      ),
    );
  }),
);
