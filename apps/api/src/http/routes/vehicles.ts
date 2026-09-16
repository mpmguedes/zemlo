/**
 * Rotas de veículos e quilometragem (§9, §10, §11).
 *
 * A quilometragem tem um fluxo de confirmação em dois passos (§11): quando o valor
 * recua, a resposta é 422 com os avisos; o cliente mostra-os e reenvia o mesmo pedido
 * com `confirmRegression: true`. É o mesmo endpoint, o que mantém a validação num
 * único sítio e deixa a decisão sobre a plausibilidade onde ela pertence.
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
  zOdometerCreateRequest,
  zVehicleCreateRequest,
  zVehicleUpdateRequest,
  type OdometerCreateRequest,
  type VehicleCreateRequest,
  type VehicleUpdateRequest,
} from '@zemlo/shared';
import { asyncHandler, created, noContent, parseBody, requireUser } from '../../http/handlers.js';
import { requireAuth } from '../../http/middleware.js';
import {
  createVehicle,
  deleteVehicle,
  getVehicleDetail,
  listOdometerReadings,
  listVehicles,
  recordOdometer,
  resolveVehicleId,
  updateVehicle,
} from '../../services/vehicles.js';

export const vehiclesRouter = Router();

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
const vehiclesRouterAuth = [
  '/vehicles',
  '/vehicles/:vehicleId',
  '/vehicles/:vehicleId/odometer',
  '/odometer',
].map(toRouteRegExp);

vehiclesRouter.use((request, response, next) => {
  const belongsHere = vehiclesRouterAuth.some((pattern) => pattern.test(request.path));
  if (!belongsHere) {
    next();
    return;
  }
  requireAuth()(request, response, next);
});

/* -------------------------------------------------------------------------- */
/* Veículos                                                                    */
/* -------------------------------------------------------------------------- */

vehiclesRouter.get(
  '/vehicles',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const includeArchived = request.query.includeArchived === 'true';
    const items = await listVehicles(user.id, includeArchived);
    response.json({ items, total: items.length });
  }),
);

vehiclesRouter.post(
  '/vehicles',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zVehicleCreateRequest, request) as VehicleCreateRequest;
    const vehicle = await createVehicle(user.id, body);
    created(response, `/api/v1/vehicles/${vehicle.id}`, vehicle);
  }),
);

vehiclesRouter.get(
  '/vehicles/:vehicleId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    response.json(await getVehicleDetail(user.id, request.params.vehicleId ?? ''));
  }),
);

vehiclesRouter.patch(
  '/vehicles/:vehicleId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zVehicleUpdateRequest, request) as VehicleUpdateRequest;
    response.json(await updateVehicle(user.id, request.params.vehicleId ?? '', body));
  }),
);

vehiclesRouter.delete(
  '/vehicles/:vehicleId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    await deleteVehicle(user.id, request.params.vehicleId ?? '');
    noContent(response);
  }),
);

/* -------------------------------------------------------------------------- */
/* Quilometragem (§11)                                                         */
/* -------------------------------------------------------------------------- */

vehiclesRouter.get(
  '/vehicles/:vehicleId/odometer',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const limit = Number.parseInt(String(request.query.limit ?? '100'), 10);
    const items = await listOdometerReadings(
      user.id,
      request.params.vehicleId ?? '',
      Number.isFinite(limit) ? limit : 100,
    );
    response.json({ items, total: items.length });
  }),
);

vehiclesRouter.post(
  '/vehicles/:vehicleId/odometer',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zOdometerCreateRequest, request) as OdometerCreateRequest;
    const result = await recordOdometer(user.id, request.params.vehicleId ?? '', body);
    response.status(result.warnings.length > 0 ? 200 : 201).json(result);
  }),
);

/**
 * Endpoint de conveniência: regista quilometragem sem indicar o veículo.
 *
 * Serve o fluxo de onboarding, em que o utilizador ainda não sabe que existe um
 * conceito de "identificador de veículo" (§5). Com um único veículo, o Zemlo resolve-o
 * sozinho — e o utilizador nunca vê um campo a mais (§44).
 */
vehiclesRouter.post(
  '/odometer',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zOdometerCreateRequest, request) as OdometerCreateRequest;

    const vehicleId = await resolveVehicleId(user.id, undefined);
    const result = await recordOdometer(user.id, vehicleId, body);
    response.status(result.warnings.length > 0 ? 200 : 201).json({ ...result, vehicleId });
  }),
);
