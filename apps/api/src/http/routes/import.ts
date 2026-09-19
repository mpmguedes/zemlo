/**
 * Rotas de importação nativa — bundle Zemlo (§3.1, §7.1).
 *
 * ## O que esta camada é, e o que não é
 *
 * É uma camada **fina** de HTTP: traduz um pedido em bytes num `ZipReadResult`, chama os
 * dois serviços que já existem (`previewImport` e `applyImport`), e traduz o resultado em
 * JSON. Não valida registos, não deduplica, não decide estados — tudo isso vive no domínio
 * e nos serviços da Fase 1–3, que estão fechados e validados.
 *
 * A única razão para este ficheiro existir é a fronteira HTTP: autenticação, `Content-Type`,
 * códigos de estado, e o `userId` que vem **sempre** do token.
 *
 * ## As duas rotas, e porque são duas
 *
 * ```
 * POST /import/preview   → nada escrito. Devolve o plano (§7.1: "review")
 * POST /import/apply     → escreve. Devolve o relatório (§7.1: "apply" + "report")
 * ```
 *
 * A separação não é estética: a §7.1 e a §11.3 exigem que **nada seja escrito antes de o
 * utilizador ver o que vai acontecer**. Duas rotas tornam essa garantia estrutural — não
 * existe um caminho de código que escreva e devolva um plano ao mesmo tempo. Um único
 * endpoint com um `?dryRun=true` teria a mesma semântica e uma garantia mais fraca: a de
 * que o ramo de escrita está bem separado do ramo de leitura *dentro* do handler.
 *
 * ## Porque é que o `apply` recebe o plano de volta
 *
 * O segundo pedido reenvia o ZIP **e** o plano que o primeiro aprovou. Isto parece
 * redundante e não é: a §11.3 estabelece que o que o utilizador aprovou é exatamente o que
 * é escrito. Recalcular o plano no `apply` abriria uma janela entre a revisão e a escrita
 * em que a conta muda (outra importação, outra sessão, um pedido concorrente) e o resultado
 * deixaria de corresponder ao que foi mostrado. O `previewImport` já devolve os
 * `CanonicalRecord` precisamente para que o `apply` não tenha de os reconstruir.
 *
 * ## Pacotes e método
 *
 * `Content-Type: application/zip` (ou `application/x-zip-compressed`, ou
 * `application/octet-stream`) com o corpo **cru**, não `multipart/form-data`. A escolha é
 * deliberada:
 *
 *  - **`multipart/form-data` traria uma dependência** (multer e o seu analisador) para
 *    transportar **um único** ficheiro. O bundle é um só artefacto; um envelope multipart
 *    para um só ficheiro é uma camada de protocolo sem conteúdo;
 *  - **o modo de falha é melhor.** Com corpo cru, o que chega ao leitor é o ficheiro tal
 *    como o browser o leu, e `hasZipSignature` decide sobre os primeiros bytes. Com
 *    multipart, chegaria ao leitor um envelope cujo *primeiro* erro possível seria um
 *    prefixo `------WebKitFormBoundary…` — e a mensagem ao utilizador seria "isto não é um
 *    ZIP" para um ZIP perfeitamente válido que foi apenas embrulhado.
 *
 * O browser envia o corpo cru com `fetch(file)` ou `XMLHttpRequest.send(file)` e o
 * `Content-Type` definido pela aplicação; é o que a interface da Fase 5 fará.
 *
 * ## Limites
 *
 * Ver `UPLOAD_LIMITS` abaixo. A regra que os governa vem do A26: os limites aplicam-se aos
 * **dados efetivamente presentes/lidos**, nunca ao que o manifest declara. É por isso que
 * o corte por tamanho acontece aqui, sobre os bytes que chegaram, e não a partir de
 * `manifest.counts` — um `count` enganador não pode contornar um limite.
 */

import { Router, type Request } from 'express';
import { asyncHandler, requireUser } from '../handlers.js';
import { requireAuth } from '../middleware.js';
import { AppError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { prisma } from '../../core/db.js';
import { readZip, hasZipSignature, ZipRefusalError } from '../../domain/import/zip.js';
import { BundleRefusalError } from '../../domain/import/bundle.js';
import { parseCsv } from '../../domain/import/csv/parse.js';
import {
  applySavedMapToTable,
  type ColumnDecision,
} from '../../domain/import/csv/mapping.js';
import type { DateOrder, DecimalStyle } from '../../domain/import/csv/values.js';
import { CSV_SUPPORTED_KINDS, isCsvSupportedKind } from '../../domain/import/csv/infer-kind.js';
import type { RecordKind } from '../../domain/import/validate.js';
import { CONFLICT_POLICIES, type ConflictPolicy } from '../../domain/import/plan.js';
import { previewImport } from '../../services/import/read.js';
import { previewCsv } from '../../services/import/csv-preview.js';
import {
  findSavedMap,
  saveColumnMap,
} from '../../services/import/column-map.js';
import {
  applyImport,
  ImportNotApplicableError,
} from '../../services/import/apply.js';
import { buildImportReport, reportToCsv } from '../../services/import/report.js';
import { audit } from '../../services/audit.js';

/* -------------------------------------------------------------------------- */
/* Limites do upload                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Limites do *upload*, aplicados antes de o ZIP ser interpretado.
 *
 * ## Porque é que existe um limite aqui, e outro não bastaria
 *
 * O `ZIP_LIMITS.maxCompressedBytes` (64 MiB) é verificado **dentro** de `readZip`, sobre um
 * `Uint8Array` que já está em memória. Entre o socket e essa verificação há dois passos que
 * podem consumir memória sem limite: ler o corpo do pedido, e convertê-lo num buffer. Um
 * limite aplicado só no leitor seria um limite aplicado depois de o custo já ter sido pago.
 *
 * `maxUploadBytes` corta no passo anterior — é o mesmo valor que `maxCompressedBytes`, e a
 * igualdade é intencional: dois números diferentes para a mesma grandeza seriam um convite
 * a que um deles ficasse desatualizado, e o mais permissivo passaria a ser o efetivo. É a
 * mesma razão pela qual o `requireJsonBody` e o `jsonBodyParser` partilham o `1mb`.
 *
 * O valor é `UPLOAD_LIMITS` e não uma constante solta porque o teste de fronteira precisa
 * de o importar em vez de escrever o número — um teste que repita `64 * 1024 * 1024` deixa
 * de verificar o limite no dia em que o limite muda.
 */
export const UPLOAD_LIMITS = {
  /**
   * Tamanho máximo do corpo do pedido, em bytes.
   *
   * Igual a `ZIP_LIMITS.maxCompressedBytes`. Se algum dia divergirem, o menor dos dois
   * governa e o maior é uma promessa falsa.
   */
  maxUploadBytes: 64 * 1024 * 1024,
} as const;

/**
 * Caminhos exatos das rotas que transportam bytes.
 *
 * Cada um é o caminho **completo** sob o prefixo da API, e não o relativo ao ponto de
 * montagem do router. A distinção importa: a isenção do `requireJsonBody` corre em `app.ts`,
 * **antes** de o router ser resolvido, pelo que o único caminho que existe nessa altura é o
 * do pedido inteiro (`request.path` = `/api/v1/import/preview`).
 */
export const IMPORT_UPLOAD_PATHS = [
  '/api/v1/import/preview',
  '/api/v1/import/apply',
  '/api/v1/import/csv/preview',
  '/api/v1/import/csv/apply',
] as const;

/** Alias legível para o `app.ts`, que não deve conhecer o nome `UPLOAD_LIMITS`. */
export const IMPORT_UPLOAD_MAX_BYTES = UPLOAD_LIMITS.maxUploadBytes;

/**
 * `true` quando o pedido é um upload de bundle para uma das duas rotas de importação.
 *
 * ## O que este predicado é
 *
 * É a **isenção**, reduzida a uma pergunta com nome. Existe como função — e não como a
 * condição inline em `app.ts` — para que:
 *
 *  1. a lista de caminhos (`IMPORT_UPLOAD_PATHS`) e a lista de tipos
 *     (`ACCEPTED_UPLOAD_TYPES`) vivam no mesmo ficheiro que as rotas a que se aplicam, e não
 *     em dois sítios que podem divergir;
 *  2. o teste possa exercitar a fronteira diretamente (`/api/v1/import/preview-x` → `false`),
 *     em vez de a inferir de uma resposta HTTP.
 *
 * ## Porque é que compara o caminho exato, e porque isso é a propriedade que interessa
 *
 * `includes` sobre uma lista de dois caminhos literalmente escritos:
 *
 *  - **não pode apanhar mais do que devia.** `/api/v1/import/preview-x`,
 *    `/api/v1/import/preview/extra`, `/api/v1/import`, `/api/v1/imports` — nenhum é igual a
 *    nenhum dos dois, pelo que todos seguem sujeitos ao `requireJsonBody` global. Um
 *    `startsWith('/api/v1/import')` alargaria a exceção a tudo o que comece por esse
 *    caminho, hoje e no futuro, sem que ninguém revisitasse esta decisão;
 *  - **não depende do método.** A isenção é do *caminho*, e um `GET /api/v1/import/preview`
 *    não é isentado por acidente: o `requireJsonBody` já deixa passar `GET`/`HEAD`/`DELETE`
 *    antes de olhar para o `Content-Type`, e um `GET` a esta rota encontra o fallback da
 *    API — 404, sem nunca tentar ler um corpo inexistente. Restringir por método aqui seria
 *    uma segunda condição para o mesmo efeito.
 *
 * O caminho vem do Express já normalizado e sem a *query string*, pelo que
 * `/api/v1/import/preview?x=1` compara igual — o que é correto: é a mesma rota.
 */
export function isNativeImportUpload(method: string, path: string): boolean {
  // `HEAD` acompanha `GET` na semântica do `requireJsonBody` (não transporta corpo) e um
  // `HEAD` a estas rotas não deve ser lido como upload. A verificação é sobre o caminho,
  // mas excluir os métodos sem corpo evita consumir um corpo que não existe.
  if (method === 'GET' || method === 'HEAD' || method === 'DELETE') return false;
  return (IMPORT_UPLOAD_PATHS as readonly string[]).includes(path);
}

/**
 * Tipos de conteúdo aceites para o corpo do pedido.
 *
 * Três, e a lista é fechada:
 *
 *  - `application/zip` — o tipo correto, e o que a aplicação enviará;
 *  - `application/x-zip-compressed` — o que o Windows (e o Internet Explorer antes dele)
 *    atribui a um `.zip`. Recusá-lo seria recusar um ficheiro válido por causa de um
 *    cabeçalho que o sistema operativo do utilizador escreveu, e o utilizador não tem
 *    forma de o mudar;
 *  - `application/octet-stream` — o tipo genérico. Está aqui porque um cliente que não
 *    conheça a extensão envia este por omissão, e o conteúdo é verificado a seguir pela
 *    assinatura de qualquer forma. Aceitar o genérico **não** enfraquece nada: a decisão
 *    real sobre "isto é um ZIP?" é a assinatura, não o cabeçalho.
 *
 * `multipart/form-data` **não** está na lista, e é uma decisão (ver o cabeçalho do
 * ficheiro): traria uma dependência para transportar um único ficheiro, e converteria um
 * erro claro ("envia o ficheiro tal como está") num erro enganador ("isto não é um ZIP").
 */
/**
 * Tipos de conteúdo aceites para o corpo de um **bundle**.
 *
 * Três, e a lista é fechada:
 *
 *  - `application/zip` — o tipo correto, e o que a aplicação enviará;
 *  - `application/x-zip-compressed` — o que o Windows (e o Internet Explorer antes dele)
 *    atribui a um `.zip`. Recusá-lo seria recusar um ficheiro válido por causa de um
 *    cabeçalho que o sistema operativo do utilizador escreveu, e o utilizador não tem
 *    forma de o mudar;
 *  - `application/octet-stream` — o tipo genérico. Está aqui porque um cliente que não
 *    conheça a extensão envia este por omissão, e o conteúdo é verificado a seguir pela
 *    assinatura de qualquer forma. Aceitar o genérico **não** enfraquece nada: a decisão
 *    real sobre "isto é um ZIP?" é a assinatura, não o cabeçalho.
 *
 * `multipart/form-data` **não** está na lista, e é uma decisão: traria uma dependência para
 * transportar um único ficheiro, e converteria um erro claro ("envia o ficheiro tal como
 * está") num erro enganador ("isto não é um ZIP").
 *
 * `text/plain` também **não** está, e a ausência é deliberada e verificada por teste: com
 * ele, um ficheiro de texto com bytes que por acaso começassem pela assinatura de ZIP
 * entraria como bundle. A verificação de tipo existe para recusar **antes** de olhar para o
 * conteúdo, e alargá-la aqui torná-la-ia decorativa para metade dos casos que a motivaram.
 */
export const ACCEPTED_UPLOAD_TYPES = [
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
] as const;

/**
 * Tipos de conteúdo aceites para o corpo de um **CSV** (Camada 2, §10).
 *
 * Lista própria, e não uma extensão da de cima. As duas chegaram a ser a mesma, e o efeito
 * foi um defeito real apanhado por um teste existente: acrescentar `text/plain` para o CSV
 * fez um `text/plain` com bytes de ZIP passar a ser aceite na rota do **bundle**, que é
 * exatamente o que o teste `recusa um tipo textual mesmo que os bytes sejam de ZIP` proíbe.
 *
 * As duas rotas recebem ficheiros de naturezas diferentes, e a lista de tipos é a expressão
 * dessa diferença. Partilhá-la faz com que alargar uma alargue a outra em silêncio — e o
 * sentido do alargamento é sempre o mais permissivo.
 *
 *  - `text/csv` — o tipo correto;
 *  - `text/plain` — o que muitos sistemas operativos e exportadores atribuem a um `.csv`;
 *  - `application/octet-stream` — o genérico.
 *
 * `application/vnd.ms-excel` **não** está, de propósito: é o tipo do XLSX e do XLS, que a
 * decisão #9 deixou explicitamente fora desta versão. Aceitá-lo prometeria uma leitura que
 * não existe.
 *
 * Nem `application/zip`: um bundle não é um CSV, e o caminho do CSV não tem leitor de ZIP.
 */
export const ACCEPTED_CSV_UPLOAD_TYPES = [
  'text/csv',
  'text/plain',
  'application/octet-stream',
] as const;

/* -------------------------------------------------------------------------- */
/* Router                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * O router das duas rotas de importação.
 *
 * A isenção do `requireJsonBody` **não** está aqui: vive em `app.ts`, antes do middleware
 * global, porque um router é montado depois de toda a cadeia da aplicação e nunca veria um
 * pedido que o `requireJsonBody` já tivesse recusado. O que está aqui é o que pertence ao
 * router: autenticação, as rotas, e o handler de endereço inexistente.
 */
export const importRouter = Router();

/* -------------------------------------------------------------------------- */
/* Leitura do corpo                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Extrai os bytes do ZIP do pedido, ou lança um erro que o utilizador consegue resolver.
 *
 * Três recusas distintas, e a distinção é o valor desta função:
 *
 *  - **sem corpo** → 400. O ficheiro não foi enviado. É um erro do cliente;
 *  - **`Content-Type` não aceite** → 415, com a lista do que é aceite. Distinto do
 *    anterior porque o remédio é diferente: um é "envia o ficheiro", o outro é "o cabeçalho
 *    está errado";
 *  - **não é um ZIP** → 400, verificado pela assinatura. Distinto de tudo o resto porque o
 *    ficheiro chegou inteiro e o problema é o formato — e é o único caso em que a mensagem
 *    pode nomear o que o utilizador fez ("escolheste outro ficheiro?").
 *
 * A ordem destas verificações é a ordem em que o utilizador as consegue corrigir: enviar,
 * depois rotular, depois escolher bem o ficheiro.
 */
function readUploadedZip(request: Request): Uint8Array {
  const contentType = request.headers['content-type'] ?? '';
  // O `Content-Type` pode trazer parâmetros (`; charset=`), pelo que se compara o tipo
  // base. `split(';')[0]` e não `startsWith`: um tipo como `application/zipfoo` começaria
  // por `application/zip` e passaria indevidamente.
  const mediaType = contentType.split(';')[0]?.trim().toLowerCase() ?? '';

  /*
   * O `Content-Type` é verificado **antes** do corpo, e a ordem não é arbitrária.
   *
   * Quando o tipo não é aceite, o `express.raw` desta rota não consome o corpo (o `type` é a
   * lista fechada), pelo que `request.body` fica `undefined`. Verificar o corpo primeiro
   * produziria "não recebemos nenhum ficheiro" para um pedido em que o ficheiro chegou
   * perfeitamente — o utilizador voltaria a enviá-lo, vezes sem conta, e o problema é o
   * cabeçalho que o cliente escreveu. O diagnóstico só é correto se a causa for nomeada
   * primeiro.
   *
   * O custo é aceitar que um pedido sem corpo **e** com tipo errado recebe 415 e não 400 —
   * o que é correto: há duas coisas erradas e a que o utilizador consegue corrigir com uma
   * linha de código é o tipo.
   */
  if (!ACCEPTED_UPLOAD_TYPES.includes(mediaType as (typeof ACCEPTED_UPLOAD_TYPES)[number])) {
    throw new AppError(
      mediaType === ''
        ? 400
        : 415,
      'validation_error',
      mediaType === ''
        ? 'O ficheiro tem de ser enviado com o cabeçalho Content-Type: application/zip.'
        : 'O ficheiro tem de ser enviado como um ZIP, com o cabeçalho Content-Type: application/zip.',
      { fields: [{ path: 'content-type', message: `Tipo de conteúdo não suportado: ${mediaType || '(ausente)'}.` }] },
    );
  }

  const body = request.body as unknown;

  if (body === undefined || body === null || (Buffer.isBuffer(body) && body.byteLength === 0)) {
    throw new AppError(
      400,
      'validation_error',
      'Não recebemos nenhum ficheiro. Escolhe o ficheiro do Zemlo e volta a tentar.',
      { fields: [{ path: 'body', message: 'O ficheiro é obrigatório.' }] },
    );
  }

  if (!Buffer.isBuffer(body)) {
    throw new AppError(400, 'validation_error', 'O corpo do pedido não pôde ser lido como um ficheiro.');
  }

  const bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);

  if (!hasZipSignature(bytes)) {
    throw new AppError(
      400,
      'validation_error',
      'O ficheiro não é um bundle do Zemlo. Verifica se escolheste o ZIP da exportação.',
    );
  }

  return bytes;
}

/* -------------------------------------------------------------------------- */
/* Tradução de recusas do domínio                                              */
/* -------------------------------------------------------------------------- */

/**
 * Converte uma recusa de domínio numa resposta HTTP.
 *
 * As duas recusas (`ZipRefusalError`, `BundleRefusalError`) descrevem **o que está errado
 * com o ficheiro do utilizador** — são erros de entrada, não defeitos. Um 500 para elas
 * seria errado duas vezes: diz que o problema é do servidor (não é) e não dá ao utilizador
 * nada para corrigir (§11.3: "nunca um beco sem saída").
 *
 *  - **422** e não 400: o corpo está sintaticamente bem (é um ZIP, é um stream válido) mas
 *    não satisfaz as regras da representação. É a definição de `unprocessable`, e é o que o
 *    `AppError` desta casa já usa para esse caso;
 *  - **`reason` no `details`**: o código estável da recusa acompanha a resposta. O cliente
 *    não deve mostrar `bundle.version_too_new` ao utilizador (a §11.3 proíbe conceitos
 *    técnicos), mas a interface precisa dele para escolher *que* remédio oferecer — e é a
 *    única forma de o teste verificar a recusa **específica** em vez de "deu 422".
 */
function refusalResponse(error: ZipRefusalError | BundleRefusalError): AppError {
  const refusal = error.refusal;

  /*
   * As duas recusas nomeiam o ficheiro em causa de forma diferente — o leitor de ZIP chama-lhe
   * `entryName` (é uma entrada do arquivo) e o leitor de bundle chama-lhe `file` (é um
   * ficheiro de dados). A normalização é feita aqui, na fronteira, e não nos dois módulos de
   * domínio: alinhar os nomes lá obrigaria a mexer em dois ficheiros fechados e validados
   * para servir uma resposta HTTP, e a diferença de vocabulário é real — uma entrada de ZIP
   * não é a mesma coisa que um ficheiro declarado no manifest.
   */
  const source =
    'entryName' in refusal
      ? { file: refusal.entryName }
      : 'file' in refusal && refusal.file !== undefined
        ? { file: refusal.file }
        : {};

  return new AppError(422, 'unprocessable', refusal.message, {
    details: {
      reason: refusal.reason,
      ...source,
      ...('line' in refusal && refusal.line !== undefined ? { line: refusal.line } : {}),
    },
  });
}

/**
 * Executa uma fase e traduz as recusas conhecidas.
 *
 * As recusas de domínio são apanhadas aqui e não no `errorHandler` global de propósito: o
 * `errorHandler` não conhece estas classes, e ensinar-lhe duas formas de erro que só uma
 * rota produz seria espalhar pelo ficheiro mais consultado do projeto o conhecimento de uma
 * funcionalidade. Apanhá-las ao pé de quem as provoca mantém as duas definições juntas.
 */
async function withRefusals<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ZipRefusalError || error instanceof BundleRefusalError) {
      throw refusalResponse(error);
    }
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* Rotas                                                                       */
/* -------------------------------------------------------------------------- */

/*
 * Autenticação — as rotas de upload, e sem exceções.
 *
 * `request.path` aqui é relativo ao ponto de montagem, pelo que a comparação é sobre o
 * mesmo espaço de nomes que a isenção acima. Ver a nota sobre autenticação com
 * correspondência exata em `vehicles.ts`.
 *
 * O utilizador **nunca** vem do ficheiro (§7.3: "a conta vem sempre do token, nunca do
 * pedido"). O `manifest` pode declarar o que quiser sobre a conta de origem, e um CSV pode
 * ter uma coluna chamada `Utilizador` — `requireUser` é a única fonte do `userId`, e é
 * isso que torna impossível importar para outra conta.
 *
 * A lista é a mesma de `IMPORT_UPLOAD_PATHS`, mas em caminhos **relativos** ao ponto de
 * montagem — e as duas têm de ser mantidas em sincronia. É por isso que a verificação é
 * feita a partir de uma só lista interna, e não por duas condições escritas à mão: uma rota
 * nova que ficasse a faltar aqui seria uma rota de importação **sem autenticação**, que é o
 * pior defeito possível neste ficheiro.
 */
const AUTHENTICATED_IMPORT_PATHS = IMPORT_UPLOAD_PATHS.map((path) =>
  path.replace(/^\/api\/v1/, ''),
);

importRouter.use((request, response, next) => {
  if (!AUTHENTICATED_IMPORT_PATHS.includes(request.path)) {
    next();
    return;
  }
  requireAuth()(request, response, next);
});

/**
 * Analisa um bundle e devolve o plano. **Não escreve nada.**
 *
 * É a fase `review` da §7.1. O corpo da resposta é o que o ecrã mostra: as contagens do
 * plano, os problemas por gravidade, e o estado (`ready` / `blocked` / `nothing-to-do`).
 *
 * O plano é devolvido **inteiro**, e não resumido para apresentação: a interface precisa de
 * o reenviar ao `apply`, e é isso que garante que o que o utilizador aprovou é o que é
 * escrito. Filtrá-lo aqui obrigaria o `apply` a reconstruí-lo — exatamente o que a §11.3
 * proíbe.
 *
 * Nunca devolve 500 por um ficheiro mau: um ZIP corrompido é 422 com o motivo.
 */
importRouter.post(
  '/import/preview',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const bytes = readUploadedZip(request);

    const zip = await withRefusals(async () => readZip(bytes));
    const preview = await withRefusals(async () =>
      previewImport({ zip, userId: user.id, prisma }),
    );

    response.json(toPreviewBody(preview));
  }),
);

/**
 * Aplica um plano. **Escreve**, e devolve o relatório.
 *
 * O corpo do pedido é o ZIP (o mesmo que o `preview` leu) e o plano aprovado vem na
 * *query string*, em `?plan=…`, codificado como JSON.
 *
 * ## Porque é que o plano viaja na query e não no corpo
 *
 * O corpo já está ocupado pelo ZIP, e o corpo é um só. As alternativas eram piores:
 *
 *  - **`multipart/form-data`** para transportar os dois — a dependência que este ficheiro
 *    decidiu não trazer, agora para transportar um ficheiro *e* um campo. E o plano é
 *    pequeno: é uma lista de `localId` e ações, não os registos;
 *  - **recalcular o plano no `apply`** — abriria a janela de divergência entre a revisão e
 *    a escrita que a §11.3 não perdoa;
 *  - **guardar o plano no servidor entre os dois pedidos** — exigiria estado de sessão de
 *    importação, com expiração, e um identificador que o cliente teria de transportar de
 *    qualquer forma. Mais máquina para o mesmo efeito.
 *
 * A query string tem limite de tamanho (o Node aceita ~8 kB de URL por omissão), o que
 * torna esta escolha adequada **porque** o plano é uma lista de identificadores e não os
 * registos. Não é uma limitação: é o que confirma que o plano é um artefacto de
 * apresentação pequeno, e não uma cópia dos dados.
 *
 * ## O `bundleId` e a idempotência
 *
 * O `bundleId` vem do `plan` recebido, e não do ZIP relido. É deliberado: a §9.5 faz dele a
 * chave de idempotência, e a chave tem de ser a do bundle que o utilizador aprovou. Reler o
 * ZIP para o extrair daria o mesmo valor hoje e um valor diferente no dia em que os dois
 * pedidos vissem ficheiros diferentes — e nesse dia a idempotência deixaria de proteger
 * exatamente quando é precisa.
 *
 * `bundleId` é um **identificador de idempotência, não uma autorização**: um utilizador que
 * invente um `bundleId` escreve na sua própria conta e só nela — o `userId` vem do token.
 */
importRouter.post(
  '/import/apply',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const bytes = readUploadedZip(request);

    const zip = await withRefusals(async () => readZip(bytes));
    const preview = await withRefusals(async () =>
      previewImport({ zip, userId: user.id, prisma }),
    );

    /*
     * Os registos vêm do `preview` recém-calculado, e não do plano enviado.
     *
     * O plano diz **o que fazer**; os registos dizem **com que valores**. O `apply` precisa
     * dos dois, e os valores têm de vir da fonte que os sabe interpretar — o bundle lido
     * neste pedido. Aceitar registos vindos do cliente seria aceitar dados de escrita
     * arbitrários do exterior, que é a razão pela qual o `plan` na query é validado como
     * estrutura antes de ser usado.
     *
     * O `preview` corre outra vez porque a cadeia até aos registos é: ZIP → bundle →
     * normalizar → validar. Não é um custo desperdiçado: é o que garante que o `apply`
     * escreve a partir dos mesmos passos que o `preview` mostrou, e não de um estado
     * intermédio transportado pelo cliente.
     */
    const plan = parsePlanParam(request);

    /*
     * A defesa contra "o plano não é deste bundle".
     *
     * O plano enviado é confrontado com o `bundleId` do bundle que este pedido leu. Se não
     * coincidirem, o cliente está a aplicar um plano a um ficheiro diferente do que o
     * originou — e escrever nesse estado seria escrever algo que ninguém aprovou.
     */
    if (plan.bundleId !== null && preview.bundle.bundleId !== plan.bundleId) {
      throw new AppError(
        409,
        'conflict',
        'O plano não corresponde a este ficheiro. Analisa o ficheiro novamente antes de importar.',
        { details: { reason: 'plan.bundle_mismatch' } },
      );
    }

    /*
     * Uma importação bloqueada é uma **recusa**, não uma avaria. A §7.1 prevê-a: o
     * `apply` confirma que nada foi escrito e devolve o motivo, para o utilizador o poder
     * resolver e tentar de novo.
     *
     * Sem esta tradução, a recusa saía como erro não tratado e chegava ao cliente como
     * 500 — que diz "o servidor avariou" e não diz "corrige estes registos". O `reason`
     * distingue os quatro casos (`blocked`, `pending-decisions`, `too-many-records`,
     * `nothing-to-do`), e é `422` o estado que corresponde a um corpo compreensível e
     * corrigível pelo cliente.
     */
    let applied;
    try {
      applied = await applyImport({
        plan: preview.plan,
        records: preview.records,
        bundleId: preview.bundle.bundleId,
        userId: user.id,
        prisma,
      });
    } catch (error) {
      if (error instanceof ImportNotApplicableError) {
        throw new AppError(422, 'unprocessable', error.message, {
          details: { reason: `import.${error.reason}` },
        });
      }
      throw error;
    }

    const report = buildImportReport({
      plan: preview.plan,
      applied,
      bundleId: preview.bundle.bundleId,
    });

    /*
     * Auditoria (§7.3): a importação escreve na conta do utilizador e é a operação simétrica
     * da exportação, que já é auditada (`user.exported_data`). O evento `user.imported_data`
     * segue a convenção existente — `user.<ação>` para operações sobre os dados do próprio
     * utilizador.
     *
     * Regista o `bundleId` e as contagens, **nunca** o conteúdo (§7.3, §30).
     *
     * Só se regista quando houve escrita: uma reimportação do mesmo bundle (§9.5) não
     * alterou nada, e registá-la encheria o histórico com operações que não o são.
     */
    if (report.applied) {
      await audit('user.imported_data', {
        userId: user.id,
        ipAddress: request.meta.ipAddress,
        userAgent: request.meta.userAgent,
        entityType: 'import',
        entityId: preview.bundle.bundleId,
        metadata: {
          records: report.created.length,
          enriched: report.enriched.length,
          batches: report.batches,
        },
      });
    } else {
      logger.info('importação sem alterações', {
        userId: user.id,
        bundleId: preview.bundle.bundleId,
      });
    }

    response.json(toReportBody(report));
  }),
);

/* -------------------------------------------------------------------------- */
/* Corpo das respostas                                                         */
/* -------------------------------------------------------------------------- */

/** O plano, sem os registos canónicos — que são volumosos e não são para apresentação. */
function toPreviewBody(preview: Awaited<ReturnType<typeof previewImport>>): Record<string, unknown> {
  const { plan, bundle } = preview;

  return {
    bundleId: bundle.bundleId,
    state: plan.state,
    counts: plan.counts,
    issueSummary: plan.issueSummary,
    issues: plan.issues,
    /*
     * As entradas vão completas: a interface mostra "3 precisam de decisão ▸" e precisa de
     * as nomear quando o utilizador abre a lista (§11.2, §11.4). É por isso que a §11.2
     * desenha "Ver ▸" ao lado de cada linha — a contagem sozinha não é acionável.
     */
    entries: plan.entries,
    files: bundle.files,
    summary: {
      vehicles: bundle.manifest.counts?.vehicles ?? null,
      declaredCounts: bundle.manifest.counts ?? null,
    },
  };
}

/**
 * O relatório, na forma que o cliente consome.
 *
 * Inclui o `csv` já serializado para que a interface possa oferecer o download sem um
 * segundo pedido — o relatório é pequeno e a serialização é pura. Não inclui os `records`
 * canónicos: o relatório não os usa, e a §11.3 proíbe conceitos técnicos na apresentação.
 */
function toReportBody(report: ReturnType<typeof buildImportReport>): Record<string, unknown> {
  return {
    bundleId: report.bundleId,
    applied: report.applied,
    headline: report.headline,
    summary: report.summary,
    created: report.created,
    enriched: report.enriched,
    skipped: report.skipped,
    batches: report.batches,
    issues: report.issues,
    csv: reportToCsv(report),
  };
}

/* -------------------------------------------------------------------------- */
/* Validação do plano recebido                                                 */
/* -------------------------------------------------------------------------- */

/** O plano aprovado, reduzido ao que o `apply` precisa de identificar. */
interface SubmittedPlan {
  readonly bundleId: string | null;
}

/**
 * Lê e valida o plano recebido na query string.
 *
 * ## Porque é que se valida um valor que veio de nós
 *
 * O plano foi produzido pelo `preview` e devolvido ao cliente — mas o cliente é um
 * intermediário, não uma testemunha: o que chega no segundo pedido passou pela rede e pode
 * ter sido alterado. Validar a **forma** do que se aceita é o que impede que um valor
 * arbitrário entre no caminho de escrita.
 *
 * O que se extrai é apenas o `bundleId` — o confronto que interessa. As ações e os
 * `localId` **não** são lidos daqui: vêm do `preview` recalculado. Isso é deliberado e é a
 * defesa mais forte disponível: o plano que governa a escrita é sempre produzido pelo
 * servidor a partir do ficheiro, e o valor recebido só pode fazer uma coisa — **falhar a
 * correspondência** e provocar um 409. Não há forma de o `plan` na query instruir o `apply`
 * a escrever algo diferente do que o bundle deste pedido produz.
 *
 * Uma query ausente ou ilegível é 400 com uma mensagem que diz o que fazer. Não é tolerada
 * por omissão: aceitar "sem plano" transformaria a verificação de correspondência numa
 * verificação que nunca corre.
 */
function parsePlanParam(request: Request): SubmittedPlan {
  const raw = request.query.plan;

  if (typeof raw !== 'string' || raw.length === 0) {
    throw new AppError(
      400,
      'validation_error',
      'Falta o plano a aplicar. Analisa o ficheiro primeiro e volta a tentar.',
      { fields: [{ path: 'plan', message: 'O plano é obrigatório.' }] },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError(400, 'validation_error', 'O plano enviado não é válido.', {
      fields: [{ path: 'plan', message: 'O plano não é JSON válido.' }],
    });
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new AppError(400, 'validation_error', 'O plano enviado não é válido.', {
      fields: [{ path: 'plan', message: 'O plano tem de ser um objeto.' }],
    });
  }

  const bundleId = (parsed as { bundleId?: unknown }).bundleId;
  if (bundleId !== undefined && bundleId !== null && typeof bundleId !== 'string') {
    throw new AppError(400, 'validation_error', 'O plano enviado não é válido.', {
      fields: [{ path: 'plan.bundleId', message: 'O identificador do bundle tem de ser texto.' }],
    });
  }

  return { bundleId: typeof bundleId === 'string' ? bundleId : null };
}

/* -------------------------------------------------------------------------- */
/* Camada 2 — rotas de CSV (§3.2, §10)                                         */
/* -------------------------------------------------------------------------- */

/**
 * As duas rotas de CSV, e porque são as mesmas duas do bundle.
 *
 * ```
 * POST /import/csv/preview   → nada escrito. Deteção, mapeamento, plano.
 * POST /import/csv/apply     → escreve. Relatório, e o mapa guardado.
 * ```
 *
 * A separação é a mesma, e pela mesma razão (§7.1, §11.3): **nada acontece sem o
 * utilizador ver o que vai acontecer**. Um `?dryRun=true` num só endpoint teria a mesma
 * semântica e uma garantia mais fraca, exatamente como para o bundle.
 *
 * ## Porque é que são rotas novas e não um parâmetro no `/import/preview`
 *
 * Porque o que o cliente **envia** e o que **recebe** é diferente, e o tipo de conteúdo é
 * diferente (`application/zip` vs `text/csv`). Um único endpoint teria de ramificar sobre o
 * `Content-Type` para decidir qual dos dois pipelines corre — e um `Content-Type` errado
 * passaria a produzir o pipeline errado com um erro confuso. Duas rotas tornam o pipeline
 * explícito no caminho, que é o único sítio onde o cliente o pode declarar sem ambiguidade.
 *
 * ## O que é reutilizado, sem exceção
 *
 * Tudo o que é escrever. O `apply` chama o **mesmo** `applyImport` que o bundle usa, com os
 * mesmos argumentos, e produz o **mesmo** `buildImportReport`. O que o CSV acrescenta é
 * apenas o que é específico do CSV: a deteção, o mapeamento, e o mapa guardado no fim.
 * Não há uma segunda transação, uma segunda idempotência nem um segundo relatório.
 *
 * ## O `bundleId` de um CSV é a chave de identidade do conteúdo
 *
 * O `apply` recebe `bundleId: preview.identity.key` — que é `csv_<userId>_<sha256>[_<tipo>]`.
 * O livro de idempotência (§9.5) não sabe nem precisa de saber que o identificador vem de
 * um CSV: para ele é uma string opaca, como o `bundleId` de um bundle. É isso que faz
 * reimportar o mesmo CSV não criar nada, sem uma linha de código a mais.
 */

/**
 * Lê o ficheiro CSV do pedido.
 *
 * Distinta de `readUploadedZip` porque as verificações são diferentes na mesma ordem —
 * presença, tipo, conteúdo. O `Content-Type` é validado contra a lista fechada; o conteúdo
 * **não** é verificado por assinatura, porque um CSV não tem uma: é texto, e o que prova
 * que é um CSV é o parser conseguir encontrar linhas e colunas.
 *
 * A verificação que falta aqui é feita por `previewCsv`: um ficheiro vazio, um binário, ou
 * um texto sem estrutura produzem lá uma análise com `emptyReason` preenchido, e a resposta
 * diz ao utilizador o que se passou — que é melhor do que uma assinatura a dizer "não é um
 * CSV" para um ficheiro que ele exportou de outra aplicação.
 */
function readUploadedCsv(request: Request): Uint8Array {
  const contentType = request.headers['content-type'] ?? '';
  const mediaType = contentType.split(';')[0]?.trim().toLowerCase() ?? '';

  if (
    !ACCEPTED_CSV_UPLOAD_TYPES.includes(mediaType as (typeof ACCEPTED_CSV_UPLOAD_TYPES)[number])
  ) {
    throw new AppError(
      mediaType === '' ? 400 : 415,
      'validation_error',
      mediaType === ''
        ? 'O ficheiro tem de ser enviado com o cabeçalho Content-Type: text/csv.'
        : 'O ficheiro tem de ser enviado como texto CSV, com o cabeçalho Content-Type: text/csv.',
      {
        fields: [
          { path: 'content-type', message: `Tipo de conteúdo não suportado: ${mediaType || '(ausente)'}.` },
        ],
      },
    );
  }

  const body = request.body as unknown;

  if (body === undefined || body === null || (Buffer.isBuffer(body) && body.byteLength === 0)) {
    throw new AppError(
      400,
      'validation_error',
      'Não recebemos nenhum ficheiro. Escolhe o ficheiro CSV e volta a tentar.',
      { fields: [{ path: 'body', message: 'O ficheiro é obrigatório.' }] },
    );
  }

  if (!Buffer.isBuffer(body)) {
    throw new AppError(400, 'validation_error', 'O corpo do pedido não pôde ser lido como um ficheiro.');
  }

  return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
}

/**
 * Lê as opções do fluxo CSV a partir da query string.
 *
 * ## Porque é que as decisões viajam na query
 *
 * Pelo mesmo motivo do plano do bundle: o corpo está ocupado pelo ficheiro, e o corpo é um
 * só. As decisões são uma lista de `{ index, field }` — pequena, e não os dados.
 *
 * ## Porque é que tudo é validado, apesar de vir do nosso cliente
 *
 * Porque o cliente é um intermediário. Uma decisão com um `index` que não existe ou um
 * `field` inventado não pode entrar no caminho de escrita — e, mais importante, **não pode
 * entrar no mapa guardado**. Um mapa guardado com um campo inválido envenenaria todas as
 * importações futuras daquele formato, e o utilizador não teria como saber porquê.
 *
 * A validação é de **forma**; a validação de **coerência** (o campo é candidato daquela
 * coluna?) é feita por `resolveMapping`, que já a sabe fazer e a reporta em `invalid`. Não
 * se duplica aqui.
 */
function parseCsvOptions(request: Request): {
  kind?: RecordKind;
  decisions?: readonly ColumnDecision[];
  dateOrder?: DateOrder;
  decimalStyle?: DecimalStyle;
  conflictPolicy?: ConflictPolicy;
  decoded: Record<string, unknown>;
} {
  const decoded: Record<string, unknown> = {};

  const readJson = (name: string): unknown => {
    const raw = request.query[name];
    if (typeof raw !== 'string' || raw.length === 0) return undefined;

    try {
      const parsed: unknown = JSON.parse(raw);
      decoded[name] = parsed;
      return parsed;
    } catch {
      throw new AppError(400, 'validation_error', `O campo «${name}» não é válido.`, {
        fields: [{ path: name, message: 'Não é JSON válido.' }],
      });
    }
  };

  const options: {
    kind?: RecordKind;
    decisions?: readonly ColumnDecision[];
    dateOrder?: DateOrder;
    decimalStyle?: DecimalStyle;
    conflictPolicy?: ConflictPolicy;
    decoded: Record<string, unknown>;
  } = { decoded };

  /* ---- tipo de registo (§10.5: "o utilizador escolhe") ---- */

  const kindRaw = request.query.kind;
  if (typeof kindRaw === 'string' && kindRaw.length > 0) {
    /*
     * A validação usa `isCsvSupportedKind` e não uma lista local.
     *
     * É a mesma lista que o serviço usa para decidir se consegue construir registos. Uma
     * segunda lista aqui divergiria da primeira, e o efeito seria aceitar um `kind` que o
     * serviço depois recusa — ou pior, recusar um que ele sabe tratar.
     */
    if (!isCsvSupportedKind(kindRaw)) {
      throw new AppError(
        400,
        'validation_error',
        `«${kindRaw}» não é um tipo de registo que se possa importar de um ficheiro.`,
        {
          fields: [
            {
              path: 'kind',
              message: `Tipos aceites: ${CSV_SUPPORTED_KINDS.join(', ')}.`,
            },
          ],
        },
      );
    }
    options.kind = kindRaw as RecordKind;
  }

  /* ---- decisões de coluna ---- */

  const decisionsRaw = readJson('decisions');
  if (decisionsRaw !== undefined) {
    if (!Array.isArray(decisionsRaw)) {
      throw new AppError(400, 'validation_error', 'As decisões enviadas não são válidas.', {
        fields: [{ path: 'decisions', message: 'Tem de ser uma lista.' }],
      });
    }

    const decisions: ColumnDecision[] = [];
    for (const entry of decisionsRaw) {
      if (typeof entry !== 'object' || entry === null) {
        throw new AppError(400, 'validation_error', 'As decisões enviadas não são válidas.', {
          fields: [{ path: 'decisions', message: 'Cada decisão tem de ser um objeto.' }],
        });
      }

      const { index, field } = entry as { index?: unknown; field?: unknown };

      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
        throw new AppError(400, 'validation_error', 'As decisões enviadas não são válidas.', {
          fields: [{ path: 'decisions.index', message: 'O índice tem de ser um inteiro não negativo.' }],
        });
      }

      /*
       * `null` é aceite e é uma resposta legítima (§10.4: "se a resposta for 'nenhuma',
       * ignora-se"). A distinção entre `null` e ausente é deliberada e é validada: um
       * `field` que não seja `null` nem string é um erro, e não se assume `null` por
       * omissão — assumir seria transformar um erro do cliente numa coluna ignorada em
       * silêncio, que é o que a §9.2 proíbe.
       */
      if (field !== null && typeof field !== 'string') {
        throw new AppError(400, 'validation_error', 'As decisões enviadas não são válidas.', {
          fields: [
            { path: 'decisions.field', message: 'O campo tem de ser texto ou null para ignorar a coluna.' },
          ],
        });
      }

      decisions.push({ index, field });
    }

    options.decisions = decisions;
  }

  /* ---- convenções da §10.4 ---- */

  const dateOrderRaw = request.query.dateOrder;
  if (typeof dateOrderRaw === 'string' && dateOrderRaw.length > 0) {
    if (dateOrderRaw !== 'dia-mes' && dateOrderRaw !== 'mes-dia') {
      throw new AppError(400, 'validation_error', 'A ordem de datas indicada não é válida.', {
        fields: [{ path: 'dateOrder', message: 'Tem de ser «dia-mes» ou «mes-dia».' }],
      });
    }
    options.dateOrder = dateOrderRaw;
  }

  const decimalRaw = request.query.decimalStyle;
  if (typeof decimalRaw === 'string' && decimalRaw.length > 0) {
    if (decimalRaw !== 'virgula' && decimalRaw !== 'ponto') {
      throw new AppError(400, 'validation_error', 'O separador decimal indicado não é válido.', {
        fields: [{ path: 'decimalStyle', message: 'Tem de ser «virgula» ou «ponto».' }],
      });
    }
    options.decimalStyle = decimalRaw;
  }

  /* ---- política de conflito (decisão 8; por omissão `fill-empty`) ---- */

  const policyRaw = request.query.conflictPolicy;
  if (typeof policyRaw === 'string' && policyRaw.length > 0) {
    /*
     * Os identificadores da política vêm de `CONFLICT_POLICIES`, a fonte única do domínio.
     * A mensagem lista-os a partir de lá em vez de os repetir: uma lista escrita à mão na
     * mensagem de erro é a primeira a ficar desatualizada, e uma mensagem que enumera
     * opções que já não existem é pior do que uma que não enumera nenhuma.
     */
    if (!(CONFLICT_POLICIES as readonly string[]).includes(policyRaw)) {
      throw new AppError(400, 'validation_error', 'A política de conflito indicada não é válida.', {
        fields: [
          {
            path: 'conflictPolicy',
            message: `Políticas aceites: ${CONFLICT_POLICIES.join(', ')}.`,
          },
        ],
      });
    }
    options.conflictPolicy = policyRaw as ConflictPolicy;
  }

  return options;
}

/**
 * Analisa um CSV e devolve deteção, mapeamento, pré-visualização e plano.
 *
 * **Não escreve nada**, como o `/import/preview`. É o passo 3 do fluxo da §11.2 — o
 * "Analisar" depois do qual a conta ainda está exatamente como estava.
 *
 * ## O mapa guardado (§10.2 passo 9)
 *
 * Quando o utilizador ainda não enviou decisões e existe um mapa guardado para esta forma
 * de ficheiro **nesta conta**, as decisões do mapa são aplicadas. É o "um clique" que a
 * §10.2 pede: o utilizador reconhece o formato e não repete o mapeamento.
 *
 * A ordem é deliberada: o que o utilizador envia agora **ganha** ao que ficou guardado. Um
 * mapa é um ponto de partida, e a confirmação do momento é a última palavra — o contrário
 * faria uma correção de hoje ser ignorada em favor de uma decisão antiga.
 *
 * ## O que a resposta diz sobre o mapa
 *
 * A resposta inclui `savedMap` com o que foi reutilizado e o que não foi (`uncoveredColumns`,
 * `unmatchedHeaders`, `ambiguousHeaders`). É a informação que o ecrã do passo 4 (§10.2) usa
 * para destacar colunas não reconhecidas — que é precisamente o que a especificação exige
 * depois de um formato mudar.
 */
importRouter.post(
  '/import/csv/preview',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const bytes = readUploadedCsv(request);
    const options = parseCsvOptions(request);

    /*
     * As decisões guardadas só são usadas quando o cliente não enviou nenhumas.
     *
     * Misturar as duas seria pior do que qualquer das alternativas: uma decisão guardada
     * que o utilizador já substituiu voltaria a aparecer, e o ecrã mostraria um mapeamento
     * que não corresponde ao que ele acabou de confirmar.
     */
    let decisions = options.decisions;
    let savedMap: SavedMapSummary | null = null;

    if ((decisions === undefined || decisions.length === 0) && options.kind !== undefined) {
      const table = parseCsv(bytes, {
        ...(typeof request.query.maxRows === 'string'
          ? { maxRows: Number.parseInt(request.query.maxRows, 10) }
          : {}),
      });

      const found = await findSavedMap(prisma, {
        userId: user.id,
        kind: options.kind,
        headers: table.headers,
      });

      if (found !== null) {
        const applied = applySavedMapToTable(table, found);
        decisions = applied.decisions;

        savedMap = {
          reused: true,
          decisions: applied.decisions.length,
          timesUsed: found.timesUsed,
          lastUsedAt: found.lastUsedAt.toISOString(),
          /**
           * As colunas que o mapa **não** cobre sobem para a resposta.
           *
           * É o mecanismo que deteta a mudança de formato: se o fornecedor acrescentou uma
           * coluna, a assinatura já não coincide e o mapa não é encontrado. Mas se a
           * assinatura coincidir e **ainda assim** houver colunas não cobertas — o que
           * acontece quando o mapa guardado não decidiu tudo, porque o utilizador só
           * corrigiu as ambíguas —, o utilizador tem de as ver na mesma.
           */
          uncoveredColumns: applied.uncoveredColumns,
          unmatchedHeaders: applied.unmatchedHeaders,
          ambiguousHeaders: applied.ambiguousHeaders,
        };
      }
    }

    const preview = await previewCsv({
      bytes,
      userId: user.id,
      prisma,
      ...(options.kind !== undefined ? { kind: options.kind } : {}),
      ...(decisions !== undefined && decisions.length > 0 ? { decisions } : {}),
      ...(options.dateOrder !== undefined ? { dateOrder: options.dateOrder } : {}),
      ...(options.decimalStyle !== undefined ? { decimalStyle: options.decimalStyle } : {}),
      ...(options.conflictPolicy !== undefined ? { conflictPolicy: options.conflictPolicy } : {}),
    });

    response.json(toCsvPreviewBody(preview, savedMap));
  }),
);

/**
 * Aplica um plano de CSV. **Escreve**, e devolve o relatório.
 *
 * O corpo é o CSV. O plano aprovado e as decisões viajam na *query string*.
 *
 * ## A defesa contra "o plano não é deste ficheiro"
 *
 * O `preview` recalcula tudo a partir dos **bytes deste pedido**, e o identificador que
 * recebe é confrontado com o do plano enviado. A comparação é a mesma do bundle, e é uma
 * comparação de **conteúdo** e não de nome: o `identity.key` inclui o `sha256` dos bytes,
 * pelo que um ficheiro diferente falha a correspondência mesmo que tenha o mesmo nome. Um
 * ficheiro com o **mesmo** conteúdo é, para todos os efeitos, o mesmo ficheiro — e aí não
 * há nada a proteger.
 *
 * ## Porque é que o plano enviado não instrui a escrita
 *
 * Exatamente como no bundle: o plano que governa a escrita é o que o servidor acabou de
 * produzir a partir dos bytes. O valor recebido só pode fazer uma coisa — falhar a
 * correspondência. Não há forma de o cliente escrever algo que não esteja no ficheiro.
 *
 * ## O mapa guardado é escrito **depois** de a escrita ter sucesso
 *
 * A ordem importa. Guardar o mapa antes seria guardar uma decisão que pode não ter
 * resultado em nada — e o utilizador teria um mapa para um formato que nunca importou, que
 * voltaria a ser aplicado na tentativa seguinte mesmo que o problema fosse outro.
 *
 * Só se guarda quando houve escrita (`report.applied`) e quando houve pelo menos uma
 * decisão. Uma importação que não escreveu nada não confirma mapeamento nenhum, e guardar
 * um mapa vazio seria guardar uma promessa sem conteúdo.
 */
importRouter.post(
  '/import/csv/apply',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const bytes = readUploadedCsv(request);
    const options = parseCsvOptions(request);

    const decisions = options.decisions;

    const preview = await previewCsv({
      bytes,
      userId: user.id,
      prisma,
      ...(options.kind !== undefined ? { kind: options.kind } : {}),
      ...(decisions !== undefined && decisions.length > 0 ? { decisions } : {}),
      ...(options.dateOrder !== undefined ? { dateOrder: options.dateOrder } : {}),
      ...(options.decimalStyle !== undefined ? { decimalStyle: options.decimalStyle } : {}),
      ...(options.conflictPolicy !== undefined ? { conflictPolicy: options.conflictPolicy } : {}),
    });

    /* --- Correspondência plano/ficheiro --- */

    const submitted = parseIdentityParam(request);

    if (submitted.identity !== null && submitted.identity !== preview.identity.key) {
      throw new AppError(
        409,
        'conflict',
        'O plano não corresponde a este ficheiro. Analisa o ficheiro novamente antes de importar.',
        { details: { reason: 'plan.csv_mismatch' } },
      );
    }

    /*
     * Um CSV que não produziu tipo não pode ser aplicado.
     *
     * Não é o mesmo que um plano bloqueado: aqui não houve sequer registos a construir. A
     * §10.5 termina com "se a inferência for ambígua, o utilizador escolhe" — pelo que a
     * mensagem tem de pedir **a escolha**, e não descrever os dados.
     *
     * O `emptyReason` do serviço é reaproveitado quando explica algo sobre o **ficheiro**
     * (linhas ilegíveis, valores que não se interpretam), porque nesse caso é a informação
     * mais útil que existe. Mas quando ele é o texto genérico de "não consegui construir
     * nada", não acrescenta nada ao utilizador — e vale mais a mensagem que nomeia a ação
     * em falta. A distinção é feita pela presença de `kind`, não pelo texto do `emptyReason`:
     * comparar strings de apresentação seria frágil e quebraria à primeira tradução.
     */
    if (preview.kind === null) {
      throw new AppError(
        422,
        'unprocessable',
        'Não foi possível perceber que tipo de registos este ficheiro contém. Escolhe o tipo e volta a tentar.',
        {
          details: {
            reason: 'import.csv.kind-undetermined',
            inference: preview.inference.state,
            ...(preview.emptyReason !== null ? { detail: preview.emptyReason } : {}),
          },
        },
      );
    }

    /* --- Escrita: o mesmo `applyImport` do núcleo da Camada 1 --- */

    let applied;
    try {
      applied = await applyImport({
        plan: preview.plan,
        records: preview.records,
        // O `bundleId` de um CSV é a chave de identidade do conteúdo. Ver o docblock acima.
        bundleId: preview.identity.key,
        userId: user.id,
        prisma,
      });
    } catch (error) {
      if (error instanceof ImportNotApplicableError) {
        throw new AppError(422, 'unprocessable', error.message, {
          details: { reason: `import.${error.reason}` },
        });
      }
      throw error;
    }

    const report = buildImportReport({
      plan: preview.plan,
      applied,
      bundleId: preview.identity.key,
    });

    /* --- Mapa guardado: só depois de a escrita ter sucesso --- */

    let savedMap: SavedMapSummary | null = null;

    if (report.applied && decisions !== undefined && decisions.length > 0) {
      const saved = await saveColumnMap(prisma, {
        userId: user.id,
        kind: preview.kind,
        headers: preview.detection.headers,
        decisions: decisions.map((decision) => ({ index: decision.index, field: decision.field })),
        delimiter: preview.detection.delimiter,
        encoding: preview.detection.encoding,
        dateOrder: options.dateOrder ?? null,
        decimalStyle: options.decimalStyle ?? null,
      });

      savedMap = {
        reused: false,
        decisions: saved.decisions.length,
        timesUsed: saved.timesUsed,
        lastUsedAt: saved.lastUsedAt.toISOString(),
        uncoveredColumns: [],
        unmatchedHeaders: [],
        ambiguousHeaders: [],
      };
    }

    /* --- Auditoria (§7.3) --- */

    if (report.applied) {
      await audit('user.imported_data', {
        userId: user.id,
        ipAddress: request.meta.ipAddress,
        userAgent: request.meta.userAgent,
        entityType: 'import',
        entityId: preview.identity.key,
        metadata: {
          source: 'csv',
          records: report.created.length,
          enriched: report.enriched.length,
          batches: report.batches,
          // Nunca o conteúdo do ficheiro (§7.3, §30) — só o tipo de registo.
          kind: preview.kind,
        },
      });
    } else {
      logger.info('importação CSV sem alterações', {
        userId: user.id,
        kind: preview.kind,
      });
    }

    response.json(toCsvReportBody(report, savedMap));
  }),
);

/* -------------------------------------------------------------------------- */
/* Corpo das respostas de CSV                                                  */
/* -------------------------------------------------------------------------- */

/** O que a resposta diz sobre um mapa guardado — reutilizado ou recém-guardado. */
interface SavedMapSummary {
  /** `true` quando veio da base de dados; `false` quando foi guardado agora. */
  readonly reused: boolean;
  readonly decisions: number;
  readonly timesUsed: number;
  readonly lastUsedAt: string;
  readonly uncoveredColumns: readonly string[];
  readonly unmatchedHeaders: readonly string[];
  readonly ambiguousHeaders: readonly string[];
}

/**
 * A resposta do `/import/csv/preview`.
 *
 * ## O que vai, e o que não vai
 *
 * Vai a deteção (passos 1–2), o mapeamento com os quatro estados (passos 3–4), a
 * pré-visualização normalizada de ~20 linhas (passo 5), os erros por linha (passo 6), os
 * duplicados via plano (passo 7) e as contagens do plano.
 *
 * **Não** vão os `records` canónicos. São o que o `apply` recebe, e o `apply` reconstrói-os
 * a partir do ficheiro — enviá-los ao cliente seria enviar dados de escrita por um caminho
 * onde eles não são precisos, e dar-lhes um aspeto de contrato que não têm. O `plan` sim,
 * porque é o que o utilizador aprovou e o que identifica a operação.
 */
function toCsvPreviewBody(
  preview: Awaited<ReturnType<typeof previewCsv>>,
  savedMap: SavedMapSummary | null,
): Record<string, unknown> {
  return {
    identity: preview.identity,
    detection: preview.detection,
    mapping: preview.mapping,
    inference: preview.inference,
    kind: preview.kind,
    preview: preview.preview,
    skipped: preview.skipped,
    valueIssues: preview.valueIssues,
    emptyReason: preview.emptyReason,
    savedMap,
    plan: {
      state: preview.plan.state,
      counts: preview.plan.counts,
      issueSummary: preview.plan.issueSummary,
      issues: preview.plan.issues,
      entries: preview.plan.entries,
    },
  };
}

/**
 * A resposta do `/import/csv/apply`.
 *
 * Mesma forma do relatório do bundle, mais o `savedMap` — que é o que permite ao passo 9 da
 * §10.2 dizer *"Guardei este mapa para a próxima vez"* com um número em vez de uma promessa.
 */
function toCsvReportBody(
  report: ReturnType<typeof buildImportReport>,
  savedMap: SavedMapSummary | null,
): Record<string, unknown> {
  return {
    bundleId: report.bundleId,
    applied: report.applied,
    headline: report.headline,
    summary: report.summary,
    created: report.created,
    enriched: report.enriched,
    skipped: report.skipped,
    batches: report.batches,
    issues: report.issues,
    csv: reportToCsv(report),
    savedMap,
  };
}

/* -------------------------------------------------------------------------- */
/* Validação dos parâmetros de identidade                                      */
/* -------------------------------------------------------------------------- */

/** A identidade do ficheiro a aplicar, reduzida ao que interessa confrontar. */
interface SubmittedIdentity {
  readonly identity: string | null;
}

/**
 * Lê o identificador do ficheiro a partir da query.
 *
 * Aceita `identity` e, por compatibilidade com o vocabulário do bundle, `bundleId` — a
 * mesma coisa com dois nomes, e o nome do bundle continua a ser aceite porque é o que a
 * interface já conhece. Não se aceitam os dois em simultâneo: seria ambíguo, e uma
 * ambiguidade num caminho de escrita resolve-se recusando, não escolhendo.
 *
 * Ausente é `null`, e `null` **não** faz a verificação passar por omissão — faz a
 * correspondência ser **ignorada**, o que é diferente e é deliberado: sem identificador não
 * há nada a confrontar. A defesa que resta é a mais forte de todas e não depende deste
 * valor: os registos a escrever são sempre os que o servidor acabou de construir a partir
 * dos bytes deste pedido.
 */
function parseIdentityParam(request: Request): SubmittedIdentity {
  const identity = request.query.identity;
  const bundleId = request.query.bundleId;

  if (typeof identity === 'string' && identity.length > 0) {
    return { identity };
  }

  if (typeof bundleId === 'string' && bundleId.length > 0) {
    return { identity: bundleId };
  }

  return { identity: null };
}

/* -------------------------------------------------------------------------- */
/* Endereço inexistente                                                        */
/* -------------------------------------------------------------------------- */

/*
 * Aqui **não** se registava o `v1NotFound`. Registá-lo parecia a extensão natural do
 * contrato descrito em `notFound.ts` — "um endereço sob `/api/v1/` responde sempre em
 * JSON" —, mas é um terminador de cadeia, não um handler de router.
 *
 * ## O que acontecia
 *
 * `v1NotFound` responde **sempre** e nunca chama `next()` (ver `http/notFound.ts`). Montado
 * como última camada deste router, ele respondia 404 a *tudo* o que chegasse até ali — não
 * só aos endereços sob `/import`, mas também aos pedidos destinados aos routers montados
 * **depois** deste na lista `v1Routers` de `app.ts`. O `metricsRouter` é um deles:
 * `GET /api/v1/metrics` deixou de ser alcançável e passou a responder 404 em vez de 401
 * (sem token) ou 200 (com token). O mesmo aconteceria a qualquer router que viesse a ser
 * acrescentado no fim da lista.
 *
 * ## Porque é que remover isto não deixa nada a descoberto
 *
 * O 404 não desapareceu: mudou de sítio. Há **um** fallback da API em `app.ts`, montado
 * sobre `API_BASE_PATH` **depois** de todos os routers da v1, exatamente para isto. É o
 * contrato que os outros dez routers já seguem — nenhum deles regista o `v1NotFound` —, e
 * concentrá-lo num só sítio é o que garante que a resposta a um endereço inexistente não
 * depende de qual router calhou ser o último a tocar no pedido.
 *
 * A garantia que importa mantém-se intacta: um endereço sob `/api/v1/` continua a responder
 * em JSON (`404`, `code: "not_found"`), nunca com a página HTML da aplicação web.
 *
 * ## Nota sobre a isenção
 *
 * A partir daqui, um `GET /api/v1/import/preview` — que a isenção exclui por não transportar
 * corpo — deixa de encontrar o 404 deste router e passa a encontrá-lo no fallback da
 * aplicação. A resposta é a mesma: `404` com `code: "not_found"`.
 */
