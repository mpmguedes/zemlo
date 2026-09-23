/**
 * Rotas de documentos (§17).
 *
 * Os documentos têm uma particularidade: podem não estar associados a nenhum veículo
 * (carta de condução, seguro de vida associado a crédito). Por isso a coleção de topo
 * agrega tudo o que o utilizador tem, e o filtro por veículo é opcional.
 *
 * ## As três rotas de conteúdo, e porque são simétricas
 *
 * ```
 * POST /documents/:documentId/content   → cria o ficheiro   (§17, upload)
 * PUT  /documents/:documentId/content   → troca o ficheiro  (§17, substituição, PROD-008)
 * GET  /documents/:documentId/content   → serve os bytes    (§17, transferência)
 * ```
 *
 * O mesmo caminho, três verbos, e a divisão entre eles é a decisão de `PROD-008`: o `POST`
 * cria, e recusa (`409`) quando já existe ficheiro; o `PUT` define o conteúdo, exista ele ou
 * não. A alternativa — um só verbo que substitui sempre — foi recusada porque faria da
 * destruição do ficheiro anterior um efeito lateral de um pedido repetível.
 *
 * O que se mantém de `PROD-001` (decisão `A`): o contrato de criação fica **intocado**.
 * `POST /documents` continua a criar metadados em JSON e a não transportar bytes, pelo que
 * acrescentar verbos de conteúdo não obriga nenhum cliente existente a mudar nem obriga a
 * coordenar uma alteração de contrato partilhado (§6).
 *
 * A alternativa — `POST /documents` a aceitar corpo cru **e** metadados — foi recusada por
 * isso mesmo: mudaria `zDocumentCreateRequest` e faria com que um pedido passasse a ter dois
 * formatos possíveis, decididos pelo `Content-Type`.
 *
 * ## Porque é que o upload não é `multipart/form-data`
 *
 * Mesma razão do importador (`routes/import.ts`), e vale a pena não a repetir mal: traria
 * uma dependência para transportar **um** ficheiro, e o modo de falha seria pior. Ver o
 * docblock de `ACCEPTED_DOCUMENT_UPLOAD_TYPES` para o que isso implica na validação.
 */

import { Router, type Request } from 'express';

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
  replaceDocumentContent,
  updateDocument,
  uploadDocumentContent,
  type DocumentContent,
} from '../../services/documents.js';
import { today } from '../../http/middleware.js';

/* -------------------------------------------------------------------------- */
/* Upload do conteúdo (§17)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Limite de tamanho do corpo de um upload de documento, em bytes.
 *
 * ## Porque é que 25 MiB, e não os 64 MiB do bundle
 *
 * São grandezas diferentes e por isso números diferentes. Um bundle é a exportação de uma
 * conta inteira; um documento é uma fotografia de um certificado ou um PDF de uma apólice.
 * A nota de arquitetura de `services/documents.ts` delimita o produto a "dezenas de KB a
 * alguns MB", e é isso que este número traduz.
 *
 * O limite é aplicado **durante a leitura** do corpo (`express.raw({ limit })`, montado em
 * `app.ts`), e não depois: um limite verificado sobre um buffer já em memória é um limite
 * aplicado depois de o custo ter sido pago.
 *
 * O valor vive numa constante exportada — e não escrito no parser — porque o teste de
 * fronteira precisa de o importar. Um teste que repetisse `25 * 1024 * 1024` deixaria de
 * verificar o limite no dia em que o limite mudasse.
 */
export const DOCUMENT_UPLOAD_LIMITS = {
  maxUploadBytes: 25 * 1024 * 1024,
} as const;

/** Alias legível para o `app.ts`, que não deve conhecer o nome `DOCUMENT_UPLOAD_LIMITS`. */
export const DOCUMENT_UPLOAD_MAX_BYTES = DOCUMENT_UPLOAD_LIMITS.maxUploadBytes;

/**
 * Tipos de conteúdo aceites para o corpo de um upload de documento.
 *
 * A lista é **fechada** e é a mesma que a transferência sabe servir com um tipo específico
 * (ver `safeContentType`, em `services/documents.ts`), mais o genérico. A correspondência
 * não é coincidência: aceitar um tipo que depois não se sabe anunciar produziria um ficheiro
 * que sai como `application/octet-stream` e abre na aplicação errada.
 *
 *  - `application/pdf` — o documento por excelência (Documento Único, apólices);
 *  - `image/*` — fotografias de certificados e de comprovativos. `heic`/`heif` estão porque
 *    é o que um iPhone produz por omissão, e o utilizador não tem forma de o mudar;
 *  - `text/plain` — notas e comprovativos textuais;
 *  - `application/octet-stream` — o genérico, que um cliente que não conheça a extensão
 *    envia. Aceitá-lo não enfraquece nada: o ficheiro é guardado **byte a byte** e servido
 *    depois com o tipo que aqui ficou registado, rebaixado a `octet-stream` se não for
 *    seguro — o que é exatamente o que ele já é.
 *
 * `multipart/form-data` **não** está, e é a decisão do cabeçalho deste ficheiro.
 *
 * `text/html` e `image/svg+xml` **não** estão, e a ausência é deliberada: são tipos
 * **ativos**. Servidos na origem da API, executariam script e leriam os tokens do
 * utilizador. `safeContentType` já os rebaixaria na transferência, mas recusá-los à entrada
 * é a defesa no sítio certo — o ficheiro nunca chega a ser guardado, e a mensagem ao
 * utilizador é clara em vez de silenciosamente diferente do que ele enviou.
 */
export const ACCEPTED_DOCUMENT_UPLOAD_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'text/plain',
  'application/octet-stream',
] as const;

/**
 * O caminho **completo** do upload, sob o prefixo da API.
 *
 * É o caminho do pedido inteiro (`request.path` = `/api/v1/documents/<id>/content`) e não o
 * relativo ao ponto de montagem do router: a isenção do `requireJsonBody` corre em `app.ts`,
 * **antes** de o router ser resolvido, pelo que é o único caminho que existe nessa altura.
 *
 * O `documentId` é variável, pelo que não pode ser uma lista de literais como a do
 * importador — daí a expressão regular. Está ancorada nas duas pontas: `/…/content` e
 * `/…/content/extra` são endereços diferentes, e só o primeiro é isentado.
 */
const DOCUMENT_UPLOAD_PATH = /^\/api\/v1\/documents\/[^/]+\/content$/;

/**
 * `true` quando o pedido é um upload de bytes para o conteúdo de um documento.
 *
 * ## O que este predicado é
 *
 * É a **isenção** do `requireJsonBody`, reduzida a uma pergunta com nome — a mesma forma de
 * `isNativeImportUpload` (`routes/import.ts`), e pela mesma razão: a lista de caminhos e a
 * lista de tipos vivem no ficheiro das rotas a que se aplicam, e o teste pode exercitar a
 * fronteira diretamente em vez de a inferir de uma resposta HTTP.
 *
 * ## Porque é que aqui o método faz parte da condição
 *
 * O predicado do importador é agnóstico ao método, e pode sê-lo: os quatro caminhos que
 * identifica são só de upload. Aqui o caminho é **partilhado** com a transferência —
 * `GET /documents/:id/content` é a mesma string. Isentar por caminho e método tornaria o
 * download dependente de uma decisão sobre uploads.
 *
 * `POST` e `PUT`, e nada mais. As duas rotas que esta isenção serve escrevem bytes — o
 * `POST` cria o ficheiro, o `PUT` troca-o — e as duas **encontram sempre** um handler que
 * responde: não há um caminho em que a isenção entregue o pedido e ele volte a cair no
 * `requireJsonBody` — que é o defeito que a versão anterior do importador tinha e que o seu
 * docblock descreve. O `GET`, que é o terceiro verbo do mesmo caminho, fica de fora: não
 * transporta corpo e não há nada a isentar.
 *
 * É a regra `A31` aplicada ao segundo verbo de escrita: um caminho que serve mais de uma
 * representação isenta-se por **método + caminho**, nunca pelo caminho sozinho.
 */
export function isDocumentUpload(method: string, path: string): boolean {
  return (method === 'POST' || method === 'PUT') && DOCUMENT_UPLOAD_PATH.test(path);
}

/**
 * Extrai os bytes do ficheiro do pedido, ou lança um erro que o utilizador consegue resolver.
 *
 * Três recusas distintas, pela ordem em que o utilizador as consegue corrigir — a mesma
 * ordem e a mesma lógica de `readUploadedZip` (`routes/import.ts`):
 *
 *  1. **`Content-Type` não aceite** → 415, com a lista do que é aceite. Vem primeiro porque
 *     quando o tipo não serve, o `express.raw` não consome o corpo e `request.body` fica
 *     `undefined`: verificar o corpo antes produziria "não recebemos nenhum ficheiro" para um
 *     pedido em que o ficheiro chegou inteiro, e o utilizador voltaria a enviá-lo vezes sem
 *     conta quando o problema é uma linha de código do cliente. Sem `Content-Type` de todo é
 *     400 e não 415 — não há cabeçalho errado a corrigir, há um cabeçalho em falta;
 *  2. **sem corpo** → 400. O ficheiro não foi enviado;
 *  3. **corpo ilegível como ficheiro** → 400. Defensivo: com o parser certo não acontece.
 *
 * O tipo devolvido é o **tipo base**, sem parâmetros (`; charset=`). É esse que fica gravado
 * no documento e é esse que a transferência anuncia.
 */
function readUploadedDocument(request: Request): { bytes: Uint8Array; mimeType: string } {
  const contentType = request.headers['content-type'] ?? '';
  // `split(';')[0]` e não `startsWith`: um tipo como `application/pdfx` começaria por
  // `application/pdf` e passaria indevidamente.
  const mediaType = contentType.split(';')[0]?.trim().toLowerCase() ?? '';

  if (!ACCEPTED_DOCUMENT_UPLOAD_TYPES.includes(mediaType as (typeof ACCEPTED_DOCUMENT_UPLOAD_TYPES)[number])) {
    throw new AppError(
      mediaType === '' ? 400 : 415,
      'validation_error',
      mediaType === ''
        ? 'O ficheiro tem de ser enviado com o cabeçalho Content-Type do seu tipo (por exemplo, application/pdf).'
        : 'Este tipo de ficheiro não é aceite. Envia um PDF, uma imagem, um ficheiro de texto ou um ficheiro genérico.',
      {
        fields: [
          {
            path: 'content-type',
            message: `Tipo de conteúdo não suportado: ${mediaType || '(ausente)'}.`,
          },
        ],
      },
    );
  }

  const body = request.body as unknown;

  if (body === undefined || body === null || (Buffer.isBuffer(body) && body.byteLength === 0)) {
    throw new AppError(400, 'validation_error', 'Não recebemos nenhum ficheiro. Escolhe o ficheiro e volta a tentar.', {
      fields: [{ path: 'body', message: 'O ficheiro é obrigatório.' }],
    });
  }

  if (!Buffer.isBuffer(body)) {
    throw new AppError(400, 'validation_error', 'O corpo do pedido não pôde ser lido como um ficheiro.');
  }

  return {
    bytes: new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
    mimeType: mediaType,
  };
}

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
 * Recepção dos bytes de um documento.
 *
 * O corpo é **cru** (o ficheiro tal como o cliente o leu), pelo que a rota não tem corpo
 * JSON para validar: o que valida é o cabeçalho `Content-Type` contra uma lista fechada, o
 * tamanho durante a leitura, e a existência do ficheiro. A metadata **não** vem no pedido —
 * já está no documento, e é por isso que esta rota não a pode reescrever.
 *
 * O `:documentId` identifica um documento que **tem de existir e ser do utilizador**. A
 * verificação é feita no serviço, por consulta filtrada pelo `userId`; um id de outra conta
 * responde 404 antes de qualquer byte ser escrito, e não 403 — um 403 confirmaria que o
 * documento existe.
 *
 * O que **não** aparece nesta rota, e é o ponto da decisão `A`:
 *
 *  - não há `storageKey` no pedido nem na resposta de erro. A chave é gerada pelo servidor
 *    (`uploadDocumentContent`) e o cliente só a vê de volta como campo do documento criado;
 *  - não há parâmetro de caminho, de directório nem de nome de ficheiro. Não existe, nesta
 *    rota, nada que o cliente possa usar para sugerir onde o ficheiro fica.
 */
documentsRouter.post(
  '/documents/:documentId/content',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const documentId = request.params.documentId ?? '';

    const { bytes, mimeType } = readUploadedDocument(request);
    const document = await uploadDocumentContent(user.id, documentId, bytes, mimeType);

    // Uma linha que nomeia o documento e o tamanho, e nunca os bytes nem a chave — a mesma
    // disciplina do registo da transferência.
    logger.info('documento recebido', {
      userId: user.id,
      documentId,
      sizeBytes: bytes.byteLength,
      mimeType,
    });

    response.json(document);
  }),
);

/**
 * Substituição dos bytes de um documento (`PROD-008`).
 *
 * Mesma leitura do corpo, mesmas recusas e mesma lista de tipos que o `POST` — é a **mesma**
 * função (`readUploadedDocument`), e é isso que garante que o limite de tamanho e as
 * restrições de MIME não possam divergir entre os dois verbos.
 *
 * A diferença está no serviço: o `POST` recusa um documento que já tem ficheiro (`409`); o
 * `PUT` define o conteúdo, exista ele ou não. A ordem em que o serviço guarda, aponta e limpa
 * está descrita em `replaceDocumentContent`, e é ela que impede que o documento fique a
 * apontar para um ficheiro inexistente quando uma das etapas falha.
 */
documentsRouter.put(
  '/documents/:documentId/content',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const documentId = request.params.documentId ?? '';

    const { bytes, mimeType } = readUploadedDocument(request);
    const document = await replaceDocumentContent(user.id, documentId, bytes, mimeType);

    // A mesma disciplina do `POST` e da transferência: nomeia o documento e o tamanho, e
    // nunca os bytes nem a chave.
    logger.info('documento substituído', {
      userId: user.id,
      documentId,
      sizeBytes: bytes.byteLength,
      mimeType,
    });

    response.json(document);
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
