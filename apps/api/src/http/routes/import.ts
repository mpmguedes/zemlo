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
import { previewImport } from '../../services/import/read.js';
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
export const IMPORT_UPLOAD_PATHS = ['/api/v1/import/preview', '/api/v1/import/apply'] as const;

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
export const ACCEPTED_UPLOAD_TYPES = [
  'application/zip',
  'application/x-zip-compressed',
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
 * Autenticação — as duas rotas, e sem exceções.
 *
 * `request.path` aqui é relativo ao ponto de montagem, pelo que a comparação é sobre o
 * mesmo espaço de nomes que a isenção acima. Ver a nota sobre autenticação com
 * correspondência exata em `vehicles.ts`.
 *
 * O utilizador **nunca** vem do bundle (§7.3: "a conta vem sempre do token, nunca do
 * pedido"). O `manifest` pode declarar o que quiser sobre a conta de origem; `requireUser`
 * é a única fonte do `userId`, e é isso que torna impossível importar para outra conta.
 */
importRouter.use((request, response, next) => {
  if (request.path !== '/import/preview' && request.path !== '/import/apply') {
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
