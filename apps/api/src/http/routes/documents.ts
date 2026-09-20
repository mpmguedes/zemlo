/**
 * Rotas de documentos (§17).
 *
 * Os documentos têm uma particularidade: podem não estar associados a nenhum veículo
 * (carta de condução, seguro de vida associado a crédito). Por isso a coleção de topo
 * agrega tudo o que o utilizador tem, e o filtro por veículo é opcional.
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
  zDocumentCreateRequest,
  zDocumentUpdateRequest,
  zListQuery,
  type DocumentCreateRequest,
  type DocumentUpdateRequest,
  type ListQuery,
} from '@zemlo/shared';
import { asyncHandler, created, noContent, parseBody, parseQuery, requireUser } from '../../http/handlers.js';
import { requireAuth } from '../../http/middleware.js';
import { AppError, notFound } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import {
  createDocument,
  deleteDocument,
  documentsExpiringSoon,
  downloadDocument,
  getDocument,
  listDocuments,
  updateDocument,
  type DocumentContent,
} from '../../services/documents.js';
import { today } from '../../http/middleware.js';

export const documentsRouter = Router();

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
const documentsRouterAuth = [
  '/documents',
  '/documents/expiring',
  '/documents/:documentId',
  '/documents/:documentId/content',
].map(toRouteRegExp);

documentsRouter.use((request, response, next) => {
  const belongsHere = documentsRouterAuth.some((pattern) => pattern.test(request.path));
  if (!belongsHere) {
    next();
    return;
  }
  requireAuth()(request, response, next);
});

documentsRouter.get(
  '/documents',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const query = parseQuery(zListQuery, request) as ListQuery;
    response.json(await listDocuments(user.id, query));
  }),
);

/** Documentos a expirar, para o cartão de estado e para o calendário (§8, §21). */
documentsRouter.get(
  '/documents/expiring',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const withinDays = Number.parseInt(String(request.query.withinDays ?? '60'), 10);
    const items = await documentsExpiringSoon(
      user.id,
      today(request),
      Number.isFinite(withinDays) ? Math.min(Math.max(withinDays, 1), 365) : 60,
    );
    response.json({ items, total: items.length });
  }),
);

documentsRouter.post(
  '/documents',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zDocumentCreateRequest, request) as DocumentCreateRequest;
    const document = await createDocument(user.id, body);
    created(response, `/api/v1/documents/${document.id}`, document);
  }),
);

documentsRouter.get(
  '/documents/:documentId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    response.json(await getDocument(user.id, request.params.documentId ?? ''));
  }),
);

documentsRouter.patch(
  '/documents/:documentId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zDocumentUpdateRequest, request) as DocumentUpdateRequest;
    response.json(await updateDocument(user.id, request.params.documentId ?? '', body));
  }),
);

/**
 * Transferência dos bytes de um documento.
 *
 * Segue a convenção já usada no exportador (`http/routes/integrations.ts`):
 * `Content-Disposition` com o nome do ficheiro, depois o tipo, depois os bytes — e uma
 * linha de registo que nomeia o documento mas não o seu conteúdo.
 *
 * Duas notas sobre o que **não** aparece nesta rota:
 *
 *  - **A `storageKey` não é lida do pedido.** O serviço resolve-a a partir do documento,
 *    já filtrado pelo dono. Não há aqui caminho nem parâmetro de chave, pelo que não há
 *    nada para manipular.
 *  - **O 403 do serviço é convertido em 404.** Um documento cuja chave aponta para fora do
 *    espaço do utilizador é um defeito de dados que merece ser distinguido no serviço;
 *    servido ao cliente como 403, diria que o documento existe. Fora daqui, os dois casos
 *    são o mesmo "não encontrámos esse documento".
 */
documentsRouter.get(
  '/documents/:documentId/content',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const documentId = request.params.documentId ?? '';

    let content: DocumentContent;
    try {
      content = await downloadDocument(user.id, documentId);
    } catch (error) {
      if (error instanceof AppError && error.status === 403) {
        throw notFound('Não encontrámos esse documento.');
      }
      throw error;
    }

    /*
     * O nome já vem sanitizado do serviço; aqui só se escreve o cabeçalho. `attachment`
     * impede que um tipo ativo seja renderizado na origem da API, mesmo que a lista de
     * tipos seguros deixasse passar algum.
     */
    response.setHeader('Content-Disposition', `attachment; filename="${content.fileName}"`);
    response.type(content.contentType);
    response.setHeader('Content-Length', String(content.bytes.byteLength));

    logger.info('documento transferido', {
      userId: user.id,
      documentId,
      vehicleId: content.vehicleId,
      sizeBytes: content.sizeBytes,
    });

    response.send(content.bytes);
  }),
);

documentsRouter.delete(
  '/documents/:documentId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    await deleteDocument(user.id, request.params.documentId ?? '');
    noContent(response);
  }),
);
