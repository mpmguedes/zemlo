/**
 * Rotas de manutenção (§15, §16), seguro (§18), inspeção (§19) e impostos (§20).
 *
 * Estes quatro tipos partilham estrutura porque partilham comportamento: cada um cria
 * ou atualiza um lembrete. A API expõe-nos separadamente porque, para o utilizador,
 * são coisas distintas com campos próprios.
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
  zInsuranceCreateRequest,
  zInsuranceUpdateRequest,
  zInspectionCreateRequest,
  zInspectionUpdateRequest,
  zListQuery,
  zMaintenanceCreateRequest,
  zMaintenanceUpdateRequest,
  zTaxCreateRequest,
  zTaxUpdateRequest,
  type InsuranceCreateRequest,
  type InsuranceUpdateRequest,
  type InspectionCreateRequest,
  type InspectionUpdateRequest,
  type ListQuery,
  type MaintenanceCreateRequest,
  type MaintenanceUpdateRequest,
  type TaxCreateRequest,
  type TaxUpdateRequest,
} from '@zemlo/shared';
import { asyncHandler, created, noContent, parseBody, parseQuery, requireUser } from '../../http/handlers.js';
import { requireAuth } from '../../http/middleware.js';
import {
  createInspection,
  createInsurance,
  createMaintenance,
  createTax,
  deleteInspection,
  deleteInsurance,
  deleteMaintenance,
  deleteTax,
  getInspection,
  getInsurance,
  getMaintenance,
  getTax,
  listInspections,
  listInsurance,
  listMaintenance,
  listTaxes,
  updateInspection,
  updateInsurance,
  updateMaintenance,
  updateTax,
} from '../../services/records-compliance.js';

export const complianceRouter = Router();

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
const complianceRouterAuth = [
  '/records/maintenance',
  '/records/maintenance/:recordId',
  '/records/insurance',
  '/records/insurance/:policyId',
  '/records/inspections',
  '/records/inspections/:recordId',
  '/records/taxes',
  '/records/taxes/:recordId',
].map(toRouteRegExp);

complianceRouter.use((request, response, next) => {
  const belongsHere = complianceRouterAuth.some((pattern) => pattern.test(request.path));
  if (!belongsHere) {
    next();
    return;
  }
  requireAuth()(request, response, next);
});

/* -------------------------------------------------------------------------- */
/* Manutenção (§15)                                                            */
/* -------------------------------------------------------------------------- */

complianceRouter.get(
  '/records/maintenance',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const query = parseQuery(zListQuery, request) as ListQuery;
    response.json(await listMaintenance(user.id, query));
  }),
);

complianceRouter.post(
  '/records/maintenance',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zMaintenanceCreateRequest, request) as MaintenanceCreateRequest;
    const record = await createMaintenance(user.id, body);
    created(response, `/api/v1/records/maintenance/${record.id}`, record);
  }),
);

complianceRouter.get(
  '/records/maintenance/:recordId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    response.json(await getMaintenance(user.id, request.params.recordId ?? ''));
  }),
);

complianceRouter.patch(
  '/records/maintenance/:recordId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zMaintenanceUpdateRequest, request) as MaintenanceUpdateRequest;
    response.json(await updateMaintenance(user.id, request.params.recordId ?? '', body));
  }),
);

complianceRouter.delete(
  '/records/maintenance/:recordId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    await deleteMaintenance(user.id, request.params.recordId ?? '');
    noContent(response);
  }),
);

/* -------------------------------------------------------------------------- */
/* Seguro (§18)                                                                */
/* -------------------------------------------------------------------------- */

complianceRouter.get(
  '/records/insurance',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const query = parseQuery(zListQuery, request) as ListQuery;
    response.json(await listInsurance(user.id, query));
  }),
);

complianceRouter.post(
  '/records/insurance',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zInsuranceCreateRequest, request) as InsuranceCreateRequest;
    const policy = await createInsurance(user.id, body);
    created(response, `/api/v1/records/insurance/${policy.id}`, policy);
  }),
);

complianceRouter.get(
  '/records/insurance/:policyId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    response.json(await getInsurance(user.id, request.params.policyId ?? ''));
  }),
);

complianceRouter.patch(
  '/records/insurance/:policyId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zInsuranceUpdateRequest, request) as InsuranceUpdateRequest;
    response.json(await updateInsurance(user.id, request.params.policyId ?? '', body));
  }),
);

complianceRouter.delete(
  '/records/insurance/:policyId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    await deleteInsurance(user.id, request.params.policyId ?? '');
    noContent(response);
  }),
);

/* -------------------------------------------------------------------------- */
/* Inspeção (§19)                                                              */
/* -------------------------------------------------------------------------- */

complianceRouter.get(
  '/records/inspections',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const query = parseQuery(zListQuery, request) as ListQuery;
    response.json(await listInspections(user.id, query));
  }),
);

complianceRouter.post(
  '/records/inspections',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zInspectionCreateRequest, request) as InspectionCreateRequest;
    const record = await createInspection(user.id, body);
    created(response, `/api/v1/records/inspections/${record.id}`, record);
  }),
);

complianceRouter.get(
  '/records/inspections/:recordId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    response.json(await getInspection(user.id, request.params.recordId ?? ''));
  }),
);

complianceRouter.patch(
  '/records/inspections/:recordId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zInspectionUpdateRequest, request) as InspectionUpdateRequest;
    response.json(await updateInspection(user.id, request.params.recordId ?? '', body));
  }),
);

complianceRouter.delete(
  '/records/inspections/:recordId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    await deleteInspection(user.id, request.params.recordId ?? '');
    noContent(response);
  }),
);

/* -------------------------------------------------------------------------- */
/* Impostos (§20)                                                              */
/* -------------------------------------------------------------------------- */

complianceRouter.get(
  '/records/taxes',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const query = parseQuery(zListQuery, request) as ListQuery;
    response.json(await listTaxes(user.id, query));
  }),
);

complianceRouter.post(
  '/records/taxes',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zTaxCreateRequest, request) as TaxCreateRequest;
    const record = await createTax(user.id, body);
    created(response, `/api/v1/records/taxes/${record.id}`, record);
  }),
);

complianceRouter.get(
  '/records/taxes/:recordId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    response.json(await getTax(user.id, request.params.recordId ?? ''));
  }),
);

complianceRouter.patch(
  '/records/taxes/:recordId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zTaxUpdateRequest, request) as TaxUpdateRequest;
    response.json(await updateTax(user.id, request.params.recordId ?? '', body));
  }),
);

complianceRouter.delete(
  '/records/taxes/:recordId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    await deleteTax(user.id, request.params.recordId ?? '');
    noContent(response);
  }),
);
