/**
 * Composição da aplicação Express.
 *
 * Este ficheiro é a única descrição da ordem dos middlewares. Está separado de
 * `server.ts` porque os testes criam a aplicação sem abrir uma porta — o que torna a
 * suite de integração rápida e determinística.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express, type Router, raw } from 'express';
import { API_BASE_PATH, PRODUCT } from '@zemlo/shared';
import { describeConfig } from './core/config.js';
import { logger } from './core/logger.js';
import {
  corsMiddleware,
  errorHandler,
  generalRateLimit,
  jsonBodyParser,
  noStore,
  notFoundHandler,
  optionalAuth,
  requestContext,
  requireJsonBody,
  securityHeaders,
  urlEncodedParser,
} from './http/middleware.js';
import { authRouter } from './http/routes/auth.js';
import { complianceRouter } from './http/routes/compliance.js';
import { documentsRouter } from './http/routes/documents.js';
import { financialRouter } from './http/routes/financial.js';
import { healthRouter, metricsRouter } from './http/routes/health.js';
import {
  ACCEPTED_CSV_UPLOAD_TYPES,
  ACCEPTED_UPLOAD_TYPES,
  IMPORT_UPLOAD_MAX_BYTES,
  importRouter,
  isNativeImportUpload,
} from './http/routes/import.js';
import { insightsRouter } from './http/routes/insights.js';
import { exportRouter, integrationsRouter } from './http/routes/integrations.js';
import { notificationsRouter } from './http/routes/notifications.js';
import { remindersRouter } from './http/routes/reminders.js';
import { vehiclesRouter } from './http/routes/vehicles.js';

export function createApp(): Express {
  const app = express();

  // Atrás do Cloudflare Tunnel (§36) o IP real vem em cabeçalhos de proxy. Confiar no
  // primeiro salto é o que permite que a limitação por IP funcione de forma correta.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.set('etag', false);

  app.use(requestContext());
  app.use(securityHeaders());
  app.use(corsMiddleware());
  app.use(generalRateLimit());

  /*
   * Isenção do `requireJsonBody` para o upload do bundle de importação.
   *
   * ## Porque é que isto está aqui, e não dentro de `routes/import.ts`
   *
   * O `requireJsonBody()` corre na aplicação, **antes** de qualquer router ser resolvido —
   * logo um router montado em `/api/v1` nunca veria o pedido que o middleware já recusou.
   * A isenção tem de correr antes dele, e é por isso que é uma linha nesta lista e não uma
   * opção da rota.
   *
   * ## As três linhas
   *
   * ```ts
   * if (!isNativeImportUpload(request.method, request.path)) { next(); return; }
   * ```
   *
   * Uma condição, avaliada por `isNativeImportUpload()` (ver `routes/import.ts`). Não usa
   * prefixo — `startsWith('/api/v1/import')` isentaria tudo o que começasse por esse
   * caminho, incluindo rotas futuras que ninguém considerou —, não usa expressão regular, e
   * não consulta o `Content-Type`. Compara o caminho **exato** das duas rotas que
   * transportam bytes, e nada mais.
   *
   * ## Porque é que não pode ser global
   *
   * Alargar o `requireJsonBody` a `application/zip` em toda a aplicação aceitaria um
   * `Content-Type: application/zip` num endpoint de despesas; o `jsonBodyParser` continuaria
   * a não o interpretar, e o handler responderia "o campo `amountCents` é obrigatório" — a
   * mensagem enganadora que o middleware existe precisamente para evitar. A proteção é útil;
   * o que se quer é uma exceção **estreita** e legível.
   *
   * ## O que a isenção troca, e o que não troca
   *
   * Troca a proteção de tipo global por uma proteção **mais forte**, específica desta rota:
   * o `Content-Type` é validado contra uma lista fechada de três tipos dentro do handler, o
   * tamanho é limitado por `IMPORT_UPLOAD_MAX_BYTES` **durante a leitura**, e o conteúdo é
   * verificado pela assinatura do ZIP.
   *
   * O limite de 1 MB do `jsonBodyParser` e o `requireJsonBody` continuam a proteger todas as
   * outras rotas e todos os outros caminhos sob `/import/`.
   */
  /*
   * As rotas de upload leem o corpo em bruto. O `type` é a união das listas fechadas dos
   * dois formatos: sem ele, o `raw` consumiria também `application/json` e um pedido JSON a
   * estas rotas deixaria de produzir a mensagem "isto não é um ficheiro". O limite é
   * verificado **enquanto** o corpo é lido.
   *
   * A união é feita **aqui**, no parser, e não nas listas de cada rota. As listas têm de
   * ficar separadas (ver o docblock de `ACCEPTED_CSV_UPLOAD_TYPES`: partilhá-las fez um
   * `text/plain` com bytes de ZIP passar a ser aceite como bundle), mas o parser que lê o
   * corpo é um só e tem de saber ler tudo o que qualquer das rotas aceita. Juntá-las neste
   * único ponto é o que mantém as duas propriedades: cada rota valida contra a sua lista, e
   * o parser não fica cego para metade dos pedidos legítimos.
   */
  const parseNativeUpload = raw({
    type: [...ACCEPTED_UPLOAD_TYPES, ...ACCEPTED_CSV_UPLOAD_TYPES],
    limit: IMPORT_UPLOAD_MAX_BYTES,
  });

  /*
   * O router montado no mesmo prefixo da v1, criado uma só vez na composição.
   *
   * A montagem não é um detalhe: é o que retira `/api/v1` antes de o router ver o
   * pedido. O `importRouter` compara `request.path` com `/import/preview` e
   * `/import/apply` — caminhos **relativos** ao ponto de montagem — tal como as suas
   * rotas, declaradas com o mesmo prefixo. Chamá-lo diretamente deixaria `request.path`
   * a ser `/api/v1/import/preview`, e nem as rotas nem o guarda de autenticação
   * corresponderiam ao caminho que esperam.
   */
  const mountedImportRouter = express.Router();
  mountedImportRouter.use(API_BASE_PATH, importRouter);

  /*
   * Isenção do `requireJsonBody` para o upload do bundle de importação.
   *
   * ## Porque é que isto está aqui, e não dentro de `routes/import.ts`
   *
   * O `requireJsonBody()` corre na aplicação, **antes** de qualquer router ser resolvido —
   * logo um router montado em `/api/v1` nunca veria o pedido que o middleware já recusou.
   * A isenção tem de correr antes dele, e é por isso que é uma linha nesta lista e não uma
   * opção da rota.
   *
   * ## Porque é que a camada entrega o pedido ao router, e não apenas lê o corpo
   *
   * Ler o corpo não basta, e foi o defeito que esta versão corrige. A cadeia de `app.use`
   * não tem saltos: um pedido que faça `next()` a partir daqui continua para os
   * middlewares seguintes, e o `requireJsonBody()` da linha imediatamente a seguir
   * recusá-lo-ia com 415 — porque o tipo dele é `application/zip` e não JSON. O corpo já
   * teria sido lido, mas a resposta seria a recusa e o `importRouter` nunca chegaria a
   * correr.
   *
   * A isenção tem, por isso, de **entregar** o pedido ao router. E tem de o entregar a um
   * router que **responda**: se o `importRouter` deixasse o pedido seguir, ele continuaria
   * para o `requireJsonBody()` e acabaria recusado com 415 de qualquer forma. A entrega
   * funciona porque as duas rotas de upload respondem sempre — qualquer pedido que nelas
   * não seja servido acaba, dentro do próprio router, numa resposta (uma recusa de upload
   * ou uma recusa de autenticação), e nunca num `next()` que devolva o pedido à cadeia.
   *
   * ## Porque é que a montagem é feita com `app.use(API_BASE_PATH, ...)`
   *
   * O `importRouter` compara `request.path` com `/import/preview` e `/import/apply` —
   * caminhos **relativos** ao ponto de montagem. Ao montá-lo em `API_BASE_PATH`, o Express
   * retira esse prefixo antes de o router ver o pedido, exatamente como faz na v1. Sem a
   * montagem — chamando o router diretamente — o `request.path` lá dentro continuaria a ser
   * `/api/v1/import/preview`, e nem as rotas nem o guarda de autenticação corresponderiam.
   *
   * ## O âmbito
   *
   * Uma condição, avaliada por `isNativeImportUpload()` (ver `routes/import.ts`). Não usa
   * prefixo — `startsWith('/api/v1/import')` isentaria tudo o que começasse por esse
   * caminho, incluindo rotas futuras que ninguém considerou —, não usa expressão regular, e
   * não consulta o `Content-Type`. Compara o caminho **exato** das duas rotas que
   * transportam bytes, e nada mais.
   *
   * Não há duplicação de rota: é o **mesmo** router, montado também aqui para os dois
   * caminhos exatos que a isenção identifica. Para todo o resto, a lista da v1 continua a
   * ser o único caminho, e o `requireJsonBody()` continua intacto a proteger tudo o que não
   * sejam estes dois caminhos.
   *
   * ## O que a isenção troca, e o que não troca
   *
   * Troca a proteção de tipo global por uma proteção **mais forte**, específica desta rota:
   * o `Content-Type` é validado contra uma lista fechada de três tipos dentro do handler, o
   * tamanho é limitado por `IMPORT_UPLOAD_MAX_BYTES` **durante a leitura**, e o conteúdo é
   * verificado pela assinatura do ZIP.
   */
  app.use((request, response, next) => {
    if (!isNativeImportUpload(request.method, request.path)) {
      next();
      return;
    }

    /*
     * O `optionalAuth` e o `noStore` correm aqui, e não mais abaixo, porque o pedido
     * não vai seguir a cadeia normal: ao ser entregue ao router dentro desta camada,
     * nunca passaria pela linha que os monta. Sem o `optionalAuth` o `request.user`
     * ficaria por preencher e o `requireAuth` do router responderia 401 a um pedido
     * com um token perfeitamente válido.
     *
     * São exatamente os mesmos middlewares e na mesma ordem — o contrato de
     * autenticação é o da aplicação, não uma segunda versão paralela.
     */
    optionalAuth()(request, response, (error?: unknown) => {
      if (error) {
        next(error);
        return;
      }
      noStore()(request, response, () => {
        parseNativeUpload(request, response, (parseError?: unknown) => {
          if (parseError) {
            next(parseError);
            return;
          }
          mountedImportRouter(request, response, next);
        });
      });
    });
  });

  app.use(requireJsonBody());
  app.use(jsonBodyParser());
  app.use(urlEncodedParser());

  /*
   * `optionalAuth` e `noStore` são montados **dentro** do router da API, não na
   * aplicação.
   *
   * Montados na aplicação, corriam antes de a rota ser conhecida, o que tinha dois
   * efeitos indesejados:
   *
   *  1. um endereço inexistente sob `/api/v1/` respondia **401** em vez de 404 — o
   *     utilizador ou o integrador ficava a pensar que o problema era de autenticação
   *     quando o problema era o endereço. A resposta 404 existe exatamente para dizer
   *     "este endereço não existe";
   *  2. o `no-store` era aplicado a todos os ficheiros estáticos da aplicação web,
   *     incluindo os que têm hash no nome e são imutáveis por construção. Isso obrigava o
   *     browser a voltar a descarregar o bundle completo em cada navegação — o oposto do
   *     que um ficheiro com hash no nome serve para fazer.
   *
   * A regra mantém-se onde importa: nenhuma resposta **autenticada** é cacheável.
   */
  app.use((request, response, next) => {
    if (!request.path.startsWith('/api')) {
      next();
      return;
    }
    optionalAuth()(request, response, (error?: unknown) => {
      if (error) {
        next(error);
        return;
      }
      noStore()(request, response, next);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Raiz e saúde                                                             */
  /* ------------------------------------------------------------------------ */

  /**
   * Raiz da API: identifica o serviço e aponta para a documentação.
   * Útil para quem descobre o domínio e tenta `GET /` — em vez de um 404 opaco,
   * encontra uma resposta que explica o que é isto.
   */
  app.get('/api', (_request, response) => {
    response.json({
      name: PRODUCT.name,
      tagline: PRODUCT.tagline,
      version: PRODUCT.version,
      apiVersion: PRODUCT.apiVersion,
      basePath: API_BASE_PATH,
      documentation: '/api/v1/health',
    });
  });

  // A saúde vive fora do prefixo versionado: um orquestrador não deve ter de saber que
  // versão da API está a correr para verificar se o processo responde.
  app.use(healthRouter);

  /* ------------------------------------------------------------------------ */
  /* API v1                                                                   */
  /* ------------------------------------------------------------------------ */

  const v1 = express.Router();

  /*
   * Ordem de montagem dos routers da v1.
   *
   * Cada router traz o seu próprio handler de endereço inexistente (`http/notFound.ts`),
   * registado como última camada do próprio router. A razão de ser assim, e não um único
   * handler no fim da v1, está explicada nesse ficheiro: é o que permite que um endereço
   * inexistente responda 404 em JSON, em vez de cair no fallback da aplicação web e
   * receber `index.html` com estado 200.
   *
   * A ordem importa apenas para a resolução de caminhos sobrepostos: `financialRouter` e
   * `complianceRouter` partilham o prefixo `/records`, e cada um responde apenas às suas
   * próprias rotas.
   */
  const v1Routers: Router[] = [
    authRouter,
    vehiclesRouter,
    financialRouter,
    complianceRouter,
    documentsRouter,
    remindersRouter,
    insightsRouter,
    notificationsRouter,
    integrationsRouter,
    exportRouter,
    importRouter,
    metricsRouter,
  ];

  for (const router of v1Routers) {
    v1.use(router);
  }

  app.use(API_BASE_PATH, v1);

  /*
   * Fallback da API: um endereço inexistente sob o prefixo versionado responde sempre em
   * JSON, nunca com a página HTML da aplicação web.
   *
   * Está aqui — e não no fim de cada router — porque é uma regra única e não deve depender
   * de oito ficheiros estarem coerentes entre si. A posição é o que importa: depois de
   * todos os routers da API (que já responderam ao que lhes pertencia) e antes de servir a
   * aplicação web.
   *
   * Sem isto, um pedido a `/api/v1/nao-existe` cairia no fallback da aplicação de página
   * única e receberia `index.html` com estado 200: um cliente que erre no endereço
   * obtém HTML e, ao tentar `JSON.parse`, um erro de sintaxe em vez de "este endereço não
   * existe".
   */
  app.use(API_BASE_PATH, (request, response) => {
    response.status(404).json({
      error: {
        code: 'not_found',
        message: `Este endereço não existe na API do Zemlo: ${request.method} ${API_BASE_PATH}${request.path}`,
        requestId: request.requestId,
      },
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Aplicação web (produção)                                                 */
  /* ------------------------------------------------------------------------ */

  mountWebApp(app);

  /* ------------------------------------------------------------------------ */
  /* Erros                                                                    */
  /* ------------------------------------------------------------------------ */

  app.use(notFoundHandler());
  app.use(errorHandler());

  return app;
}

/**
 * Serve a aplicação web compilada, quando existe.
 *
 * Porquê a API servir o frontend: em produção isto reduz o sistema a **um** serviço, um
 * domínio e um certificado atrás do Cloudflare Tunnel (§36, §38). Duas origens obrigariam
 * a configurar CORS, a manter duas políticas de cabeçalhos, e a explicar ao utilizador
 * porque é que `appzemlo.com` e `api.appzemlo.com` são sítios diferentes para o browser.
 *
 * A montagem é condicional e silenciosa quando `apps/web/dist` não existe: em
 * desenvolvimento o frontend corre no servidor do Vite, com proxy para a API, e a API não
 * deve falhar por não encontrar ficheiros que, nesse modo, não têm de existir.
 */
function mountWebApp(app: Express): void {
  const here = dirname(fileURLToPath(import.meta.url));
  // `dist/app.js` → `apps/api/dist` → a raiz da aplicação web fica em `apps/web/dist`,
  // tanto a partir de `dist/` como a partir de `src/`.
  const candidates = [
    resolve(here, '..', '..', 'web', 'dist'),
    resolve(here, '..', '..', '..', 'apps', 'web', 'dist'),
  ];

  const webRoot = candidates.find((candidate) => existsSync(resolve(candidate, 'index.html')));
  if (!webRoot) return;

  logger.info('A servir a aplicação web compilada', { raiz: webRoot });

  app.use(
    express.static(webRoot, {
      /*
       * Política de cache, em duas regras:
       *
       *  - o `index.html` **nunca** é cacheado, para que uma nova versão da aplicação
       *    chegue ao utilizador no pedido seguinte e não daqui a uma hora;
       *  - os restantes ficheiros de `assets/` têm um hash de conteúdo no nome e são
       *    imutáveis por construção: o nome muda quando o conteúdo muda. Podem ser
       *    cacheados para sempre.
       *
       * O padrão do hash tem de aceitar o alfabeto do Vite, que é base64url (`B27aNzqz`:
       * maiúsculas, minúsculas, dígitos, `-` e `_`) e **não** apenas hexadecimal. Uma
       * versão anterior só aceitava `[0-9a-f]`, pelo que nenhum asset real correspondia e
       * todos acabavam sem cabeçalho de cache — o browser voltava a descarregar o bundle
       * completo em cada navegação, que é exatamente o que o hash existe para evitar.
       */
      setHeaders(response, filePath) {
        const normalized = filePath.replace(/\\/g, '/');
        if (normalized.endsWith('/index.html')) {
          response.setHeader('Cache-Control', 'no-cache');
          return;
        }
        if (/\/assets\/.+-[A-Za-z0-9_-]{6,}\.(js|css|woff2?|png|jpe?g|svg|webp)$/.test(normalized)) {
          response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );

  /*
   * Fallback da aplicação de página única: qualquer rota que não seja da API devolve o
   * `index.html`, para que um URL profundo como `/vehicles/abc` funcione num recarregamento
   * direto do browser. As rotas da API ficam de fora — um endpoint inexistente tem de
   * devolver o 404 em JSON da API, e não uma página HTML.
   */
  app.get(/^\/(?!api\/).*/, (_request, response) => {
    response.setHeader('Cache-Control', 'no-cache');
    response.sendFile(resolve(webRoot, 'index.html'));
  });
}

/** Regista no log o resumo da configuração no arranque, sem revelar segredos. */
export function logStartup(): void {
  logger.info(`${PRODUCT.name} API a arrancar`, { versao: PRODUCT.version });
  for (const line of describeConfig()) logger.info(`  ${line}`);
}
