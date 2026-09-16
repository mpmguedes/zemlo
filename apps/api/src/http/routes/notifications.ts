/**
 * Rotas de notificações (§22).
 *
 * O contador de não lidas sai em todas as respostas de listagem: o cliente atualiza o
 * badge sem precisar de um pedido adicional, o que num produto mobile-first importa
 * (§3.6).
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
  zNotificationsQuery,
  zNotificationsReadRequest,
  type NotificationsQuery,
  type NotificationsReadRequest,
} from '@zemlo/shared';
import { asyncHandler, noContent, parseBody, parseQuery, requireUser } from '../../http/handlers.js';
import { requireAuth } from '../../http/middleware.js';
import {
  deleteNotification,
  listNotifications,
  markNotificationsRead,
} from '../../services/notifications.js';

export const notificationsRouter = Router();

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
const notificationsRouterAuth = [
  '/notifications',
  '/notifications/read',
  '/notifications/:notificationId',
].map(toRouteRegExp);

notificationsRouter.use((request, response, next) => {
  const belongsHere = notificationsRouterAuth.some((pattern) => pattern.test(request.path));
  if (!belongsHere) {
    next();
    return;
  }
  requireAuth()(request, response, next);
});

notificationsRouter.get(
  '/notifications',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const query = parseQuery(zNotificationsQuery, request) as NotificationsQuery;
    response.json(
      await listNotifications(user.id, {
        unreadOnly: query.unreadOnly,
        limit: query.limit,
        cursor: query.cursor,
      }),
    );
  }),
);

notificationsRouter.post(
  '/notifications/read',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zNotificationsReadRequest, request) as NotificationsReadRequest;
    const updated = await markNotificationsRead(user.id, { ids: body.ids, all: body.all });
    response.json({ updated });
  }),
);

notificationsRouter.delete(
  '/notifications/:notificationId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    await deleteNotification(user.id, request.params.notificationId ?? '');
    noContent(response);
  }),
);
