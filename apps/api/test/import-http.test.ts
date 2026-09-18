/**
 * Contrato HTTP da importação nativa — `POST /api/v1/import/preview` e
 * `POST /api/v1/import/apply`.
 *
 * ## O que é verificado, e o que não é
 *
 * Verifica-se o **contrato HTTP**: autenticação, códigos de estado, `Content-Type`, o
 * envelope de erro, e o âmbito da isenção do `requireJsonBody`. Não se verifica aqui a
 * deduplicação, a idempotência nem a transaccionalidade — isso está provado nos testes dos
 * serviços, contra a mesma base de dados real, e repeti-lo só duplicaria a cobertura sem a
 * tornar mais forte.
 *
 * ## Porque é que esta suite sobe a aplicação a sério
 *
 * A propriedade central desta fase é a **isenção do `requireJsonBody`**, e ela vive na
 * composição da aplicação (`app.ts`), não no router. Uma suite que montasse só o
 * `importRouter` provaria o contrato das rotas mas não que a isenção está no sítio certo
 * com o âmbito certo: passaria com a isenção montada no router (**onde nunca corre**, porque
 * o middleware global vem primeiro) e passaria com uma isenção global (**que é o que se quer
 * evitar**). É por isso que se importa `createApp()` — a mesma composição que o servidor usa.
 *
 * ## Como a base de dados de teste chega à aplicação
 *
 * `core/db.ts` resolve o cliente a partir de `config`, que lê `DATABASE_URL` **uma vez, no
 * import do módulo**. Não há injecção de dependência nessa camada e não se introduz uma
 * agora: seria alterar a arquitectura para servir um teste. Usa-se o mecanismo que já
 * existe — a variável é definida para o ficheiro temporário **antes** de a aplicação ser
 * importada (import dinâmico no `beforeAll`), que é exactamente o que o servidor faz.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@zemlo/prisma-sqlite';

import { createTestDb, createUser, type TestDb } from './helpers/db.js';
import { buildBundle, minimalBundle } from './helpers/bundle-builder.js';

/* -------------------------------------------------------------------------- */
/* Infraestrutura                                                              */
/* -------------------------------------------------------------------------- */

let db: TestDb;
let app: Express;
/**
 * O cliente Prisma **da aplicação** — distinto do `db.prisma` do helper.
 *
 * São objectos diferentes: o `db.prisma` é criado pelo `createTestDb()` com um
 * `datasources` explícito, e o da aplicação é criado por `core/prisma-client.ts` a partir
 * do `DATABASE_URL`. Os dois apontam para o **mesmo ficheiro** — é isso que os torna úteis:
 * o pedido HTTP escreve pelo cliente da app e o teste observa (e limpa) pelo seu.
 *
 * Guardado aqui apenas para o poder fechar no `afterAll`; ver o comentário lá.
 */
let appPrisma: PrismaClient;
let user: { id: string; email: string };
let other: { id: string; email: string };
let token: string;
let otherToken: string;

beforeAll(async () => {
  db = await createTestDb();

  /*
   * O `DATABASE_URL` tem de estar definido **antes** de `app.ts` ser carregado: o
   * `core/db.ts` instancia o cliente no import, e o `config` lê o ambiente na mesma altura.
   * Um import estático no topo deste ficheiro correria antes desta linha e ligaria a
   * aplicação à `dev.db` — que é exactamente o que não pode acontecer.
   */
  process.env.DATABASE_URL = db.url;
  process.env.DATABASE_PROVIDER = 'sqlite';
  process.env.NODE_ENV = 'test';

  const [{ createApp }, { prisma }] = await Promise.all([
    import('../src/app.js'),
    import('../src/core/db.js'),
  ]);

  appPrisma = prisma;
  app = createApp();

  /*
   * Rede de segurança da suite inteira: a aplicação tem de estar ligada à base de dados
   * temporária, e não à `dev.db`.
   *
   * A prova é feita **escrevendo com o cliente da aplicação e lendo com o cliente do
   * teste** — o que é a propriedade que interessa, e não uma igualdade de referências.
   *
   * Não se usa `expect(prisma).toBe(db.prisma)`: são objectos diferentes por construção
   * (`core/prisma-client.ts` instancia o seu próprio cliente) e a asserção falharia por uma
   * razão que não tem nada a ver com o que se quer garantir. Pior: perante um cliente
   * Prisma o Vitest tenta construir a mensagem de diferença e **recursa até estourar a
   * pilha** (`RangeError: Maximum call stack size exceeded`), o que transformaria uma
   * mensagem clara numa falha ilegível. A asserção abaixo falha com uma mensagem simples.
   */
  const sonda = await appPrisma.user.create({
    data: { email: 'sonda-de-arranque@zemlo.test', name: 'Sonda de arranque' },
    select: { id: true },
  });
  const vista = await db.prisma.user.findUnique({ where: { id: sonda.id } });
  expect(
    vista,
    'A aplicação não está ligada à base de dados temporária: o cliente da app escreveu uma linha que o cliente do teste não vê. O DATABASE_URL não foi aplicado antes de a app ser importada.',
  ).not.toBeNull();
  await appPrisma.user.deleteMany();
}, 120_000);

afterAll(async () => {
  /*
   * A aplicação abre o **seu próprio** cliente Prisma, e o `destroy()` do helper só fecha o
   * que ele criou. Sem esta linha o ficheiro SQLite continua aberto e a remoção do
   * directório temporário falha com `EBUSY: resource busy or locked` — no Windows, sempre.
   *
   * A ordem importa: primeiro fecha-se o cliente da aplicação, e só depois se apaga o
   * ficheiro. Fazê-lo ao contrário daria o mesmo erro.
   */
  await appPrisma.$disconnect();
  await db.destroy();
});

beforeEach(async () => {
  await resetDatabase();

  /*
   * As contas são criadas **pelo signup**, que é o caminho real: não se cria o utilizador
   * com Prisma e depois se pede uma sessão para ele. Esse atalho não funcionaria — o signup
   * recusa um email que já existe (409) — e, pior, provaria uma fronteira diferente da que a
   * aplicação tem. O que interessa é exactamente o contrato de quem se registra.
   *
   * A sessão nasce aqui e não no `beforeAll`: os utilizadores são apagados entre testes, e um
   * token emitido antes do `deleteMany` apontaria para um utilizador que já não existe —
   * todos os testes receberiam 401 por uma razão que nada tem a ver com o que verificam.
   */
  const titular = await signup(app, 'titular@zemlo.test');
  const outro = await signup(app, 'outro@zemlo.test');
  user = titular.user;
  other = outro.user;
  token = titular.token;
  otherToken = outro.token;
});

/**
 * Limpa a base de dados entre testes, pela ordem inversa das dependências.
 *
 * O `User` leva cascata em quase tudo, mas apagar explicitamente primeiro o que não tem
 * cascata (auditoria, livro de idempotência) torna a intenção clara e não depende de as
 * cascatas estarem bem declaradas.
 */
async function resetDatabase(): Promise<void> {
  await db.prisma.auditLog.deleteMany();
  await db.prisma.importBookEntry.deleteMany();
  await db.prisma.expense.deleteMany();
  await db.prisma.fuelSession.deleteMany();
  await db.prisma.odometerReading.deleteMany();
  await db.prisma.document.deleteMany();
  await db.prisma.vehicle.deleteMany();
  await db.prisma.user.deleteMany();
}

/* -------------------------------------------------------------------------- */
/* Utilitários                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Cria uma conta e devolve um token de acesso.
 *
 * O `signup` devolve a sessão diretamente, pelo que não é preciso um segundo pedido de
 * login. A password tem de satisfazer a validação da fronteira.
 */
async function signup(
  application: Express,
  email: string,
): Promise<{ user: { id: string; email: string }; token: string }> {
  const response = await request(application)
    .post('/api/v1/auth/signup')
    .set('Content-Type', 'application/json')
    .send({ email, password: 'Password123!', name: 'Teste', acceptedTerms: true, acceptedTerms: true });

  if (response.status !== 201) {
    throw new Error(
      `Não foi possível criar a sessão de teste (${response.status}): ${JSON.stringify(response.body)}`,
    );
  }

  /*
   * A sessão vem em `tokens`, e não em `accessToken` na raiz do corpo. Ler o campo errado
   * daria `undefined`, o cabeçalho sairia `Bearer undefined` e todos os testes receberiam
   * 401 — uma falha em massa com uma causa que não aparece na asserção.
   */
  return { user: response.body.user, token: response.body.tokens.accessToken };
}

/** Um upload autenticado, com o `Content-Type` de ZIP. */
function upload(application: Express, path: string, zip: Uint8Array) {
  return request(application)
    .post(path)
    .set('Content-Type', 'application/zip')
    .set('Authorization', `Bearer ${token}`)
    .send(Buffer.from(zip));
}

/** O envelope de erro da API: `{ error: { code, message, requestId } }`. */
function errorOf(body: unknown): { code: string; message: string; requestId?: string } {
  return (body as { error: { code: string; message: string; requestId?: string } }).error;
}

/* ========================================================================== */
/* 1. Autenticação                                                             */
/* ========================================================================== */

describe('autenticação', () => {
  it('recusa o preview sem sessão', async () => {
    const response = await request(app)
      .post('/api/v1/import/preview')
      .set('Content-Type', 'application/zip')
      .send(Buffer.from(minimalBundle().zip));

    expect(response.status).toBe(401);
    expect(errorOf(response.body).code).toBe('unauthorized');
  });

  it('recusa o apply sem sessão', async () => {
    const response = await request(app)
      .post('/api/v1/import/apply')
      .set('Content-Type', 'application/zip')
      .send(Buffer.from(minimalBundle().zip));

    expect(response.status).toBe(401);
    expect(errorOf(response.body).code).toBe('unauthorized');
  });

  it('recusa um token inválido', async () => {
    const response = await request(app)
      .post('/api/v1/import/preview')
      .set('Content-Type', 'application/zip')
      .set('Authorization', 'Bearer nao-e-um-token')
      .send(Buffer.from(minimalBundle().zip));

    expect(response.status).toBe(401);
  });

  /*
   * A autenticação corre antes da leitura do corpo: um pedido sem sessão **e** sem ficheiro
   * responde 401 e não "falta o ficheiro". A ordem importa para o diagnóstico — quem não tem
   * sessão não deve receber uma mensagem sobre o ficheiro.
   */
  it('verifica a sessão antes de olhar para o ficheiro', async () => {
    const response = await request(app)
      .post('/api/v1/import/preview')
      .set('Content-Type', 'application/zip');

    expect(response.status).toBe(401);
  });
});

/* ========================================================================== */
/* 2. A isenção do `requireJsonBody` — âmbito                                  */
/* ========================================================================== */

describe('isenção do requireJsonBody', () => {
  /*
   * A prova mais directa: um upload de ZIP passa. Sem a isenção, o `requireJsonBody` global
   * responderia 415 antes de a rota correr, e nenhum teste desta secção passaria.
   */
  it('aceita o corpo como ZIP nas duas rotas', async () => {
    const preview = await upload(app, '/api/v1/import/preview', minimalBundle().zip);
    expect(preview.status).toBe(200);

    const apply = await upload(app, '/api/v1/import/apply', minimalBundle().zip);
    // 400 porque falta o plano, não 415 pelo `Content-Type` — é a distinção que se verifica:
    // o corpo foi aceite, e o que falta é outra coisa.
    expect(apply.status).toBe(400);
    expect(errorOf(apply.body).code).toBe('validation_error');
  });

  it('aceita application/x-zip-compressed', async () => {
    const response = await request(app)
      .post('/api/v1/import/preview')
      .set('Content-Type', 'application/x-zip-compressed')
      .set('Authorization', `Bearer ${token}`)
      .send(Buffer.from(minimalBundle().zip));

    expect(response.status).toBe(200);
  });

  it('aceita application/octet-stream', async () => {
    const response = await request(app)
      .post('/api/v1/import/preview')
      .set('Content-Type', 'application/octet-stream')
      .set('Authorization', `Bearer ${token}`)
      .send(Buffer.from(minimalBundle().zip));

    expect(response.status).toBe(200);
  });

  it('aceita o tipo com parâmetros (charset)', async () => {
    const response = await request(app)
      .post('/api/v1/import/preview')
      .set('Content-Type', 'application/zip; charset=binary')
      .set('Authorization', `Bearer ${token}`)
      .send(Buffer.from(minimalBundle().zip));

    expect(response.status).toBe(200);
  });

  /*
   * ## A propriedade central: a isenção não pode apanhar mais do que devia
   *
   * Os três casos seguintes são caminhos que um `startsWith('/api/v1/import')` teria
   * isentado. Nenhum é igual a um dos dois caminhos exatos, pelo que todos continuam
   * sujeitos ao middleware global e recebem 415.
   *
   * `/api/v1/imports` é o mais importante dos três: é um caminho **diferente** que partilha
   * o prefixo, e uma rota futura sob ele teria perdido a proteção sem que ninguém o tivesse
   * decidido.
   */
  it('não isenta /api/v1/imports', async () => {
    const response = await request(app)
      .post('/api/v1/imports')
      .set('Content-Type', 'application/zip')
      .send(Buffer.from(minimalBundle().zip));

    expect(response.status).toBe(415);
  });

  it('não isenta /api/v1/import/preview/extra', async () => {
    const response = await request(app)
      .post('/api/v1/import/preview/extra')
      .set('Content-Type', 'application/zip')
      .send(Buffer.from(minimalBundle().zip));

    expect(response.status).toBe(415);
  });

  it('não isenta /api/v1/import/preview-x', async () => {
    const response = await request(app)
      .post('/api/v1/import/preview-x')
      .set('Content-Type', 'application/zip')
      .send(Buffer.from(minimalBundle().zip));

    expect(response.status).toBe(415);
  });

  /*
   * A proteção das restantes rotas continua intacta. Uma despesa com `Content-Type` de ZIP
   * tem de continuar a receber a mensagem que diz o que se esperava — é precisamente o caso
   * que uma isenção global estragaria, substituindo-a pelo enganador "o campo X é
   * obrigatório".
   */
  it('as outras rotas continuam a exigir JSON', async () => {
    const response = await request(app)
      .post('/api/v1/expenses')
      .set('Content-Type', 'application/zip')
      .set('Authorization', `Bearer ${token}`)
      .send(Buffer.from(minimalBundle().zip));

    expect(response.status).toBe(415);
    expect(errorOf(response.body).message).toContain('JSON');
  });

  it('uma rota normal continua a funcionar com JSON', async () => {
    const response = await request(app)
      .get('/api/v1/vehicles')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
  });

  /*
   * Um `GET` não é um upload. A isenção exclui os métodos sem corpo, e o caminho
   * encontra o fallback da API — 404, e não uma tentativa de ler um corpo inexistente.
   */
  it('um GET ao preview responde 404', async () => {
    const response = await request(app)
      .get('/api/v1/import/preview')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
  });
});

/* ========================================================================== */
/* 3. Validação do upload                                                      */
/* ========================================================================== */

describe('validação do ficheiro enviado', () => {
  it('recusa um pedido sem corpo', async () => {
    const response = await request(app)
      .post('/api/v1/import/preview')
      .set('Content-Type', 'application/zip')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_error');
  });

  it('recusa multipart com 415 e diz o que se esperava', async () => {
    const response = await request(app)
      .post('/api/v1/import/preview')
      .set('Content-Type', 'multipart/form-data; boundary=xyz')
      .set('Authorization', `Bearer ${token}`)
      .send(Buffer.from(minimalBundle().zip));

    expect(response.status).toBe(415);
    expect(errorOf(response.body).message).toContain('application/zip');
  });

  /*
   * Um `text/plain` com bytes de ZIP é recusado pelo **tipo**, não pela assinatura. É a
   * verificação que a isenção transferiu para o handler, e o teste prova que ela existe
   * mesmo: se o handler confiasse só na assinatura, este pedido passaria.
   */
  it('recusa um tipo textual mesmo que os bytes sejam de ZIP', async () => {
    const response = await request(app)
      .post('/api/v1/import/preview')
      .set('Content-Type', 'text/plain')
      .set('Authorization', `Bearer ${token}`)
      .send(Buffer.from(minimalBundle().zip));

    expect(response.status).toBe(415);
  });

  it('distingue "não é um ZIP" de "não é um bundle"', async () => {
    const response = await request(app)
      .post('/api/v1/import/preview')
      .set('Content-Type', 'application/zip')
      .set('Authorization', `Bearer ${token}`)
      .send(Buffer.from('isto não é um zip, é texto'));

    expect(response.status).toBe(400);
    const error = errorOf(response.body);
    expect(error.code).toBe('validation_error');
    // A mensagem não pode ser técnica (§11.3) e tem de sugerir o que fazer.
    expect(error.message).toMatch(/não é um bundle/i);
  });

  it('recusa um ZIP vazio com um motivo do domínio', async () => {
    const emptyZip = Buffer.from([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]);
    const response = await request(app)
      .post('/api/v1/import/preview')
      .set('Content-Type', 'application/zip')
      .set('Authorization', `Bearer ${token}`)
      .send(emptyZip);

    // É um ZIP, logo passa a assinatura; a recusa vem do leitor, como 422 com motivo.
    expect(response.status).toBe(422);
    expect(errorOf(response.body).code).toBe('unprocessable');
  });
});

/* ========================================================================== */
/* 4. Preview — o plano, e nada escrito                                        */
/* ========================================================================== */

describe('POST /import/preview', () => {
  it('devolve o plano de um bundle válido', async () => {
    const response = await upload(app, '/api/v1/import/preview', minimalBundle().zip);

    expect(response.status).toBe(200);
    expect(response.body.bundleId).toBe('bnd_0123456789abcdef0123456789abcdef');
    expect(response.body.state).toBe('ready');
    expect(response.body.counts.create).toBe(1);
  });

  /*
   * A garantia central da §7.1: "nenhuma escrita acontece antes da fase apply". É
   * verificada contra a base de dados, e não contra a resposta — se o handler escrevesse e
   * devolvesse o plano correcto, um teste que só olhasse para o corpo passaria.
   */
  it('não escreve absolutamente nada na base de dados', async () => {
    const before = await db.prisma.vehicle.count();

    const response = await upload(app, '/api/v1/import/preview', minimalBundle().zip);
    expect(response.status).toBe(200);

    expect(await db.prisma.vehicle.count()).toBe(before);
    expect(await db.prisma.importBookEntry.count()).toBe(0);
  });

  it('não escreve nada mesmo quando o bundle está bloqueado', async () => {
    const broken = buildBundle({
      dataFiles: [
        { path: 'vehicles.jsonl', content: JSON.stringify({ localId: 'veh_1', make: 'Kia' }) + '\n' },
      ],
    });

    const response = await upload(app, '/api/v1/import/preview', broken.zip);

    expect(response.status).toBe(200);
    expect(response.body.state).toBe('blocked');
    expect(await db.prisma.vehicle.count()).toBe(0);
  });

  it('identifica os registos que já existem na conta', async () => {
    await db.prisma.vehicle.create({
      data: {
        userId: user.id,
        plate: 'AA-00-BB',
        plateDisplay: 'AA-00-BB',
        make: 'Kia',
        model: 'EV3',
      },
    });

    const response = await upload(app, '/api/v1/import/preview', minimalBundle().zip);

    expect(response.status).toBe(200);
    expect(response.body.counts.create).toBe(0);
    expect(response.body.state).toBe('nothing-to-do');
  });

  it('devolve a lista de entradas, para o ecrã de revisão', async () => {
    const response = await upload(app, '/api/v1/import/preview', minimalBundle().zip);

    expect(response.body.entries).toBeInstanceOf(Array);
    expect(response.body.entries[0]).toMatchObject({
      localId: 'veh_1',
      kind: 'vehicle',
      action: 'create',
    });
  });

  /*
   * O isolamento por `userId` na camada HTTP: a conta do token é a única que conta. Um
   * veículo da **outra** conta não pode influenciar o plano — e é por isso que o preview do
   * titular continua a classificar o seu veículo como `create`.
   */
  it('não vê os dados de outra conta', async () => {
    await db.prisma.vehicle.create({
      data: {
        userId: other.id,
        plate: 'AA-00-BB',
        plateDisplay: 'AA-00-BB',
        make: 'Kia',
        model: 'EV3',
      },
    });

    const response = await upload(app, '/api/v1/import/preview', minimalBundle().zip);

    expect(response.status).toBe(200);
    expect(response.body.counts.create).toBe(1);
  });

  it('devolve 422 com o motivo quando o manifest não é JSON válido', async () => {
    const malformed = buildBundle({
      rawManifest: '{ isto não é json',
      dataFiles: [{ path: 'vehicles.jsonl', content: '{}\n' }],
    });

    const response = await upload(app, '/api/v1/import/preview', malformed.zip);

    expect(response.status).toBe(422);
    const error = errorOf(response.body);
    expect(error.code).toBe('unprocessable');
    /*
     * A recusa específica verifica-se pela `message`, e não por `details`.
     *
     * O campo `details` do `AppError` é **interno por decisão do projeto** ("registados
     * nos logs mas nunca enviados ao cliente", ver `core/errors.ts`) — existe para o log
     * ter contexto técnico sem o expor. Uma asserção sobre `response.body.error.details`
     * estaria a exigir que a fronteira deixasse escapar detalhes internos, que é o
     * oposto do que ela faz.
     */
    expect(error.message).toMatch(/manifest/i);
  });

  it('devolve 422 quando o manifest declara um formato desconhecido', async () => {
    const foreign = buildBundle({
      format: 'outra-app',
      dataFiles: [{ path: 'vehicles.jsonl', content: '{"localId":"veh_1"}\n' }],
    });

    const response = await upload(app, '/api/v1/import/preview', foreign.zip);

    expect(response.status).toBe(422);
    /*
     * A mensagem não fala de "formato": fala do que o utilizador reconhece — o ficheiro
     * não é uma exportação da aplicação — e diz-lhe o que fazer. O que o teste fixa é
     * isso: que a recusa é explicada em linguagem de utilizador, sem vocabulário interno
     * e sem "422" nem "manifest" (a §11.3 proíbe conceitos técnicos no que o utilizador
     * lê).
     */
    expect(errorOf(response.body).message).toBe(
      'Este ficheiro não é uma exportação do Zemlo. Verifica se escolheste o ficheiro certo.',
    );
  });
});

/* ========================================================================== */
/* 5. Apply — escrita, idempotência e relatório                                */
/* ========================================================================== */

describe('POST /import/apply', () => {
  /**
   * Corre o par preview + apply e devolve as duas respostas.
   *
   * É o fluxo real da §11.2: o cliente analisa, o utilizador vê, e o cliente reenvia o ZIP
   * com o plano aprovado.
   */
  async function previewThenApply(zip: Uint8Array, bearer: string = token) {
    const preview = await request(app)
      .post('/api/v1/import/preview')
      .set('Content-Type', 'application/zip')
      .set('Authorization', `Bearer ${bearer}`)
      .send(Buffer.from(zip));
    expect(preview.status).toBe(200);

    const applied = await request(app)
      .post('/api/v1/import/apply')
      .query({ plan: JSON.stringify({ bundleId: preview.body.bundleId }) })
      .set('Content-Type', 'application/zip')
      .set('Authorization', `Bearer ${bearer}`)
      .send(Buffer.from(zip));

    return { preview, applied };
  }

  it('cria os registos e devolve o relatório', async () => {
    const { applied } = await previewThenApply(minimalBundle().zip);

    expect(applied.status).toBe(200);
    expect(applied.body.applied).toBe(true);
    expect(applied.body.created).toHaveLength(1);
    expect(applied.body.batches).toBe(1);
    expect(applied.body.headline).toMatch(/importei/i);

    expect(await db.prisma.vehicle.count()).toBe(1);
  });

  it('resolve o localId para o id criado', async () => {
    const { applied } = await previewThenApply(minimalBundle().zip);

    const created = applied.body.created[0];
    expect(created.localId).toBe('veh_1');

    const vehicle = await db.prisma.vehicle.findUnique({ where: { id: created.id } });
    /*
     * A matrícula é gravada **normalizada** — maiúsculas e sem separadores —, que é a
     * forma canónica do projeto e a razão pela qual `@@unique([userId, plate])` consegue
     * comparar duas grafias da mesma matrícula. O `plateDisplay` é que guarda a forma
     * legível; a asserção verifica as duas, para não confundir "normalizou" com "perdeu
     * a informação".
     */
    expect(vehicle?.plate).toBe('AA00BB');
    expect(vehicle?.plateDisplay).toBe('AA-00-BB');
  });

  it('grava a entrada no livro de idempotência', async () => {
    await previewThenApply(minimalBundle().zip);

    const entries = await db.prisma.importBookEntry.findMany({ where: { userId: user.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0].bundleId).toBe('bnd_0123456789abcdef0123456789abcdef');
    expect(entries[0].localId).toBe('veh_1');
  });

  /*
   * A §9.5: "reimportar o mesmo bundle não cria nada". O relatório é devolvido — não é um
   * erro — e `applied` é `false`. É a diferença entre "não posso escrever" e "não tenho o
   * que escrever" (A28).
   */
  it('reimportar o mesmo bundle não cria nada e devolve relatório', async () => {
    const zip = minimalBundle().zip;
    await previewThenApply(zip);

    const { applied } = await previewThenApply(zip);

    expect(applied.status).toBe(200);
    expect(applied.body.applied).toBe(false);
    expect(applied.body.created).toHaveLength(0);
    expect(applied.body.headline).toMatch(/já tinha sido importado/i);
    expect(await db.prisma.vehicle.count()).toBe(1);
  });

  /*
   * A importação escreve na conta do **token**, e em nenhuma outra. O plano na query não
   * transporta utilizador nenhum, e o bundle também não: a única fonte é a sessão (§7.3).
   */
  it('importa para a conta do token e não para outra', async () => {
    const zip = minimalBundle().zip;
    const preview = await upload(app, '/api/v1/import/preview', zip);

    const applied = await request(app)
      .post('/api/v1/import/apply')
      .query({ plan: JSON.stringify({ bundleId: preview.body.bundleId }) })
      .set('Content-Type', 'application/zip')
      .set('Authorization', `Bearer ${otherToken}`)
      .send(Buffer.from(zip));

    expect(applied.status).toBe(200);

    expect(await db.prisma.vehicle.count({ where: { userId: other.id } })).toBe(1);
    expect(await db.prisma.vehicle.count({ where: { userId: user.id } })).toBe(0);
  });

  /*
   * O mesmo bundle em duas contas cria tudo nas duas: a chave do livro inclui `userId`. É o
   * que torna possível exportar de uma conta e importar noutra (§9.5).
   */
  it('o mesmo bundle noutra conta cria tudo', async () => {
    const zip = minimalBundle().zip;
    await previewThenApply(zip);
    await previewThenApply(zip, otherToken);

    expect(await db.prisma.vehicle.count()).toBe(2);
  });

  it('exige o plano', async () => {
    const response = await request(app)
      .post('/api/v1/import/apply')
      .set('Content-Type', 'application/zip')
      .set('Authorization', `Bearer ${token}`)
      .send(Buffer.from(minimalBundle().zip));

    expect(response.status).toBe(400);
    expect(errorOf(response.body).message).toMatch(/plano/i);
  });

  it('recusa um plano que não é JSON', async () => {
    const response = await request(app)
      .post('/api/v1/import/apply')
      .query({ plan: 'isto-nao-e-json' })
      .set('Content-Type', 'application/zip')
      .set('Authorization', `Bearer ${token}`)
      .send(Buffer.from(minimalBundle().zip));

    expect(response.status).toBe(400);
  });

  it('recusa um plano que não é um objeto', async () => {
    const response = await request(app)
      .post('/api/v1/import/apply')
      .query({ plan: '"apenas uma string"' })
      .set('Content-Type', 'application/zip')
      .set('Authorization', `Bearer ${token}`)
      .send(Buffer.from(minimalBundle().zip));

    expect(response.status).toBe(400);
  });

  /*
   * A defesa contra "o plano é de outro ficheiro": um `bundleId` que não corresponde ao
   * bundle deste pedido produz 409 e nada é escrito. Sem esta verificação, um cliente
   * poderia aplicar a um ficheiro o plano aprovado de outro — e o que fosse escrito não
   * seria o que alguém aprovou.
   */
  it('recusa aplicar um plano de outro bundle', async () => {
    const response = await request(app)
      .post('/api/v1/import/apply')
      .query({ plan: JSON.stringify({ bundleId: 'bnd_outro_bundle_qualquer' }) })
      .set('Content-Type', 'application/zip')
      .set('Authorization', `Bearer ${token}`)
      .send(Buffer.from(minimalBundle().zip));

    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('conflict');
    expect(await db.prisma.vehicle.count()).toBe(0);
  });

  /*
   * Um plano bloqueado recusa a escrita: 422 com o motivo, base de dados intacta. É a
   * garantia da §7.1 do lado do HTTP — a recusa acontece antes da primeira escrita.
   */
  it('recusa um plano bloqueado sem escrever', async () => {
    const broken = buildBundle({
      dataFiles: [
        { path: 'vehicles.jsonl', content: JSON.stringify({ localId: 'veh_1', make: 'Kia' }) + '\n' },
      ],
    });

    const preview = await request(app)
      .post('/api/v1/import/preview')
      .set('Content-Type', 'application/zip')
      .set('Authorization', `Bearer ${token}`)
      .send(Buffer.from(broken.zip));

    expect(preview.body.state).toBe('blocked');

    const applied = await request(app)
      .post('/api/v1/import/apply')
      .query({ plan: JSON.stringify({ bundleId: preview.body.bundleId }) })
      .set('Content-Type', 'application/zip')
      .set('Authorization', `Bearer ${token}`)
      .send(Buffer.from(broken.zip));

    expect(applied.status).toBe(422);
    expect(await db.prisma.vehicle.count()).toBe(0);
  });

  it('devolve o relatório em CSV', async () => {
    const { applied } = await previewThenApply(minimalBundle().zip);

    expect(typeof applied.body.csv).toBe('string');
    expect(applied.body.csv).toContain('secção');
    expect(applied.body.csv).toContain('veh_1');
  });

  /*
   * A auditoria regista a importação com o `bundleId` e as contagens, e **nunca** com o
   * conteúdo (§7.3). Verificam-se os dois: o evento existe, e o conteúdo não aparece.
   */
  it('regista a importação em auditoria sem conteúdo', async () => {
    await previewThenApply(minimalBundle().zip);

    const entries = await db.prisma.auditLog.findMany({ where: { action: 'user.imported_data' } });
    expect(entries).toHaveLength(1);

    const entry = entries[0];

    /*
     * O `bundleId` identifica **o que** foi importado e vive em `entityId`; o `metadata`
     * leva as contagens. É a forma que a §7.3 pede — o evento regista o `bundleId` e as
     * contagens, e nunca o conteúdo.
     */
    expect(entry?.entityType).toBe('import');
    expect(entry?.entityId).toBe('bnd_0123456789abcdef0123456789abcdef');

    /* A prova que interessa: nada do conteúdo do bundle foi parar à auditoria. */
    const registo = JSON.stringify(entry);
    expect(registo).not.toContain('Kia');
    expect(registo).not.toContain('AA-00-BB');
    expect(registo).not.toContain('veh_1');
  });

  /* Uma reimportação não é auditada: não alterou nada, e registá-la encheria o histórico. */
  it('não audita uma reimportação sem alterações', async () => {
    const zip = minimalBundle().zip;
    await previewThenApply(zip);
    await previewThenApply(zip);

    const entries = await db.prisma.auditLog.findMany({ where: { action: 'user.imported_data' } });
    expect(entries).toHaveLength(1);
  });
});

/* ========================================================================== */
/* 6. Endereços sob /import                                                    */
/* ========================================================================== */

describe('endereços sob /import', () => {
  it('responde 404 em JSON a um caminho que não existe', async () => {
    const response = await request(app)
      .get('/api/v1/import/inexistente')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(errorOf(response.body).code).toBe('not_found');
  });
});
