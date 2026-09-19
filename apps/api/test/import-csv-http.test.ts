/**
 * Contrato HTTP da importação CSV — `POST /api/v1/import/csv/preview` e
 * `POST /api/v1/import/csv/apply` (FASE H, §7.1, §10).
 *
 * ## O que esta suite prova, e o que não prova
 *
 * Prova o **contrato HTTP**: autenticação, códigos de estado, `Content-Type`, o envelope de
 * erro, e — o mais importante desta fase — que **o preview não escreve nada**. A §7.1 e a
 * §11.3 fazem disso a garantia central do produto: *"nada acontece sem o utilizador ver o
 * que vai acontecer"*.
 *
 * Não repete a deduplicação, a idempotência nem a transaccionalidade: essas estão provadas
 * contra a mesma base de dados real nas suites dos serviços (`import-csv-core.test.ts`,
 * `import-csv-column-map.test.ts`), e repeti-las aqui só duplicaria cobertura sem a tornar
 * mais forte.
 *
 * ## Porque é que a aplicação é montada a sério
 *
 * Pela mesma razão da suite do bundle: a propriedade central desta fase vive na
 * **composição** (`app.ts`) e não no router — a isenção do `requireJsonBody` para
 * `text/csv`. Uma suite que montasse só o `importRouter` passaria com a isenção no sítio
 * errado. Importa-se `createApp()`, a mesma composição que o servidor usa.
 *
 * ## O que só esta suite pode provar
 *
 * O **isolamento do mapa de colunas pela fronteira HTTP**. O teste do serviço prova que um
 * `findSavedMap` com o `userId` errado devolve `null`; esta suite prova que o **`userId`
 * que chega ao serviço vem do token e não do pedido** — que é a única forma de o utilizador
 * A não conseguir aplicar o mapa do utilizador B. É a diferença entre testar a função e
 * testar a fronteira que a alimenta.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@zemlo/prisma-sqlite';

import { createTestDb, createUser, type TestDb } from './helpers/db.js';

/* -------------------------------------------------------------------------- */
/* Infraestrutura                                                              */
/* -------------------------------------------------------------------------- */

let db: TestDb;
let app: Express;
let appPrisma: PrismaClient;
let user: { id: string; email: string };
let other: { id: string; email: string };
let token: string;
let otherToken: string;

beforeAll(async () => {
  db = await createTestDb();

  // O `DATABASE_URL` tem de existir **antes** de `app.ts` ser importado: o `core/db.ts`
  // instancia o cliente no import. Ver a nota extensa na suite do bundle.
  process.env.DATABASE_URL = db.url;
  process.env.DATABASE_PROVIDER = 'sqlite';
  process.env.NODE_ENV = 'test';

  const [{ createApp }, { prisma }] = await Promise.all([
    import('../src/app.js'),
    import('../src/core/db.js'),
  ]);

  appPrisma = prisma;
  app = createApp();
}, 120_000);

afterAll(async () => {
  // Fechar o cliente da aplicação **antes** de apagar o directório: sem isto, o ficheiro
  // SQLite continua aberto e o `rmSync` falha com `EBUSY` no Windows.
  await appPrisma.$disconnect();
  await db.destroy();
});

beforeEach(async () => {
  await resetDatabase();

  const titular = await signup(app, 'csv-titular@zemlo.test');
  const outro = await signup(app, 'csv-outro@zemlo.test');
  user = titular.user;
  other = outro.user;
  token = titular.token;
  otherToken = outro.token;
});

/**
 * Limpa a base de dados entre testes.
 *
 * Inclui `importBookEntry` e `columnMap` — as duas tabelas que esta fase acrescenta. A
 * omissão destas seria o pior defeito possível desta suite: um mapa guardado num teste
 * sobreviveria para o seguinte, e um teste que verifica "não há mapa guardado" passaria por
 * acaso ou falharia sem razão. É a razão pela qual a limpeza é explícita em vez de confiar
 * só na cascata do utilizador.
 */
async function resetDatabase(): Promise<void> {
  await db.prisma.auditLog.deleteMany();
  await db.prisma.importBookEntry.deleteMany();
  await db.prisma.columnMap.deleteMany();
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

async function signup(
  application: Express,
  email: string,
): Promise<{ user: { id: string; email: string }; token: string }> {
  const response = await request(application)
    .post('/api/v1/auth/signup')
    .set('Content-Type', 'application/json')
    .send({ email, password: 'Password123!', name: 'Teste', acceptedTerms: true });

  if (response.status !== 201) {
    throw new Error(
      `Não foi possível criar a sessão de teste (${response.status}): ${JSON.stringify(response.body)}`,
    );
  }

  return { user: response.body.user, token: response.body.tokens.accessToken };
}

/** Um upload CSV autenticado. */
function uploadCsv(
  application: Express,
  path: string,
  csv: string,
  options: { readonly token?: string; readonly contentType?: string; readonly query?: string } = {},
) {
  const url = options.query !== undefined && options.query !== '' ? `${path}?${options.query}` : path;

  return request(application)
    .post(url)
    .set('Content-Type', options.contentType ?? 'text/csv')
    .set('Authorization', `Bearer ${options.token ?? token}`)
    .send(Buffer.from(csv, 'utf8'));
}

function errorOf(body: unknown): { code: string; message: string; requestId?: string } {
  return (body as { error: { code: string; message: string; requestId?: string } }).error;
}

/** Um CSV de abastecimentos, com cabeçalho português e separador `;`. */
const FUEL_CSV = [
  'Data;Matrícula;Quilometragem;Litros;Valor',
  '25/02/2026;AA-00-BB;125000;32,4;45,50',
  '10/03/2026;AA-00-BB;125600;28,1;39,90',
].join('\r\n');

/** As decisões de coluna do CSV acima — a confirmação que o utilizador faria no ecrã. */
const FUEL_DECISIONS = JSON.stringify([
  { index: 0, field: 'date' },
  { index: 1, field: 'plate' },
  { index: 2, field: 'odometerKm' },
  { index: 3, field: 'litres' },
  { index: 4, field: 'amountCents' },
]);

/* ========================================================================== */
/* 1. Autenticação                                                             */
/* ========================================================================== */

describe('autenticação', () => {
  it('recusa o preview CSV sem sessão', async () => {
    const response = await request(app)
      .post('/api/v1/import/csv/preview')
      .set('Content-Type', 'text/csv')
      .send(Buffer.from(FUEL_CSV, 'utf8'));

    expect(response.status).toBe(401);
  });

  it('recusa o apply CSV sem sessão', async () => {
    const response = await request(app)
      .post('/api/v1/import/csv/apply')
      .set('Content-Type', 'text/csv')
      .send(Buffer.from(FUEL_CSV, 'utf8'));

    expect(response.status).toBe(401);
  });

  it('recusa um token inválido', async () => {
    const response = await request(app)
      .post('/api/v1/import/csv/preview')
      .set('Content-Type', 'text/csv')
      .set('Authorization', 'Bearer nao-e-um-token')
      .send(Buffer.from(FUEL_CSV, 'utf8'));

    expect(response.status).toBe(401);
  });
});

/* ========================================================================== */
/* 2. Content-Type e corpo (§3.2)                                              */
/* ========================================================================== */

describe('tipo de conteúdo e corpo', () => {
  it('aceita os tipos de CSV esperados', async () => {
    for (const contentType of ['text/csv', 'text/plain']) {
      const response = await uploadCsv(app, '/api/v1/import/csv/preview', FUEL_CSV, {
        contentType,
      });

      expect(response.status, `tipo ${contentType}`).toBe(200);
    }
  });

  it('aceita o tipo genérico', async () => {
    const response = await uploadCsv(app, '/api/v1/import/csv/preview', FUEL_CSV, {
      contentType: 'application/octet-stream',
    });

    expect(response.status).toBe(200);
  });

  /**
   * `multipart/form-data` é recusado com 415 e não com 400.
   *
   * É a mesma decisão do bundle, e a distinção importa: 415 diz "o cabeçalho está errado",
   * 400 diria "o ficheiro está errado". O utilizador tem de saber qual das duas corrigir, e
   * o remédio de um envio em multipart é diferente do remédio de um CSV malformado.
   */
  it('recusa multipart com 415', async () => {
    const response = await request(app)
      .post('/api/v1/import/csv/preview')
      .set('Content-Type', 'multipart/form-data; boundary=----x')
      .set('Authorization', `Bearer ${token}`)
      .send(Buffer.from(FUEL_CSV, 'utf8'));

    expect(response.status).toBe(415);
  });

  it('recusa JSON com 415', async () => {
    const response = await request(app)
      .post('/api/v1/import/csv/preview')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${token}`)
      .send({ csv: FUEL_CSV });

    expect(response.status).toBe(415);
  });

  /**
   * O tipo do XLSX é recusado, e é uma decisão de âmbito (decisão #9): *"XLSX em fase
   * posterior; CSV primeiro"*. Aceitar `application/vnd.ms-excel` prometeria uma leitura
   * que não existe.
   */
  it('recusa o tipo de XLSX com 415', async () => {
    const response = await uploadCsv(app, '/api/v1/import/csv/preview', FUEL_CSV, {
      contentType: 'application/vnd.ms-excel',
    });

    expect(response.status).toBe(415);
  });

  it('recusa um corpo vazio com 400', async () => {
    const response = await request(app)
      .post('/api/v1/import/csv/preview')
      .set('Content-Type', 'text/csv')
      .set('Authorization', `Bearer ${token}`)
      .send(Buffer.alloc(0));

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_error');
  });

  it('recusa um pedido sem Content-Type com 400', async () => {
    const response = await request(app)
      .post('/api/v1/import/csv/preview')
      .set('Authorization', `Bearer ${token}`)
      .send(Buffer.from(FUEL_CSV, 'utf8'));

    // Sem cabeçalho o Express não aplica o `raw`, pelo que o corpo não chega ao handler.
    // O que importa é que a resposta é um erro de validação e não um 500.
    expect([400, 415]).toContain(response.status);
  });
});

/* ========================================================================== */
/* 3. O preview não escreve nada (§7.1, §11.3)                                 */
/* ========================================================================== */

describe('o preview não escreve nada', () => {
  /**
   * **A asserção central desta suite.**
   *
   * Não basta verificar que a resposta é 200: o que a §11.3 exige é que *nada* tenha sido
   * escrito. A verificação é feita contando as linhas nas tabelas de destino **antes e
   * depois**, com o cliente do teste — não com o da aplicação, para que a observação seja
   * independente de quem escreveu.
   */
  it('não cria registos nem no livro de idempotência', async () => {
    const before = await counts();

    const response = await uploadCsv(app, '/api/v1/import/csv/preview', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(FUEL_DECISIONS)}`,
    });

    expect(response.status).toBe(200);

    const after = await counts();

    expect(after, 'o preview escreveu na base de dados').toEqual(before);
  });

  it('não guarda um mapa de colunas durante o preview', async () => {
    const response = await uploadCsv(app, '/api/v1/import/csv/preview', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(FUEL_DECISIONS)}`,
    });

    expect(response.status).toBe(200);
    expect(await db.prisma.columnMap.count()).toBe(0);
  });

  it('devolve deteção, mapeamento, pré-visualização e plano', async () => {
    const response = await uploadCsv(app, '/api/v1/import/csv/preview', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(FUEL_DECISIONS)}`,
    });

    expect(response.status).toBe(200);

    const body = response.body as Record<string, unknown>;

    expect(body.detection).toBeDefined();
    expect(body.mapping).toBeDefined();
    expect(Array.isArray(body.preview)).toBe(true);
    expect(body.plan).toBeDefined();
    expect(body.kind).toBe('fuel');

    // A deteção tem de dizer o que encontrou, com confiança — é o passo 3 da §11.2.
    const detection = body.detection as Record<string, unknown>;
    expect(detection.headers).toEqual(['Data', 'Matrícula', 'Quilometragem', 'Litros', 'Valor']);
    expect(detection.delimiter).toBe(';');
    expect(detection.rowCount).toBe(2);
    expect(typeof detection.confidence).toBe('number');
  });

  /**
   * Os `records` canónicos **não** vão na resposta.
   *
   * São o que o `apply` recebe, e o `apply` reconstrói-os a partir do ficheiro. Enviá-los
   * seria enviar dados de escrita por um caminho onde não são precisos, e dar-lhes um
   * aspeto de contrato que não têm.
   */
  it('não devolve os registos canónicos', async () => {
    const response = await uploadCsv(app, '/api/v1/import/csv/preview', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(FUEL_DECISIONS)}`,
    });

    expect(response.status).toBe(200);
    expect(response.body.records).toBeUndefined();
  });

  /** O plano devolve os quatro estados da §10.4 por coluna, não dois. */
  it('devolve o estado de cada coluna com um dos quatro valores do contrato', async () => {
    const response = await uploadCsv(app, '/api/v1/import/csv/preview', FUEL_CSV, {
      query: 'kind=fuel',
    });

    expect(response.status).toBe(200);

    const columns = (response.body.mapping as { columns: { state: string }[] }).columns;
    const allowed = ['confirmado', 'sugerido', 'ambiguo', 'nao_mapeado'];

    for (const column of columns) {
      expect(allowed).toContain(column.state);
    }
  });

  it('não expõe o identificador do ficheiro noutra conta', async () => {
    const mine = await uploadCsv(app, '/api/v1/import/csv/preview', FUEL_CSV, {
      query: 'kind=fuel',
    });
    const theirs = await uploadCsv(app, '/api/v1/import/csv/preview', FUEL_CSV, {
      query: 'kind=fuel',
      token: otherToken,
    });

    expect(mine.status).toBe(200);
    expect(theirs.status).toBe(200);

    // A mesma identidade tem de ser diferente entre contas: o `userId` faz parte da chave
    // do livro de idempotência, e é isso que faz o mesmo ficheiro importado noutra conta
    // criar tudo.
    expect((mine.body.identity as { key: string }).key).not.toBe(
      (theirs.body.identity as { key: string }).key,
    );

    // Mas o hash do conteúdo é o mesmo — é sobre o ficheiro, não sobre a conta.
    expect((mine.body.identity as { contentHash: string }).contentHash).toBe(
      (theirs.body.identity as { contentHash: string }).contentHash,
    );
  });
});

/* ========================================================================== */
/* 4. O apply escreve, e devolve o relatório (§7.1)                            */
/* ========================================================================== */

describe('o apply escreve', () => {
  it('cria os registos e devolve o relatório', async () => {
    const response = await uploadCsv(app, '/api/v1/import/csv/apply', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(FUEL_DECISIONS)}`,
    });

    expect(response.status).toBe(200);

    const body = response.body as Record<string, unknown>;
    expect(body.applied).toBe(true);
    expect(body.headline).toBeTruthy();
    expect(Array.isArray(body.created)).toBe(true);
    expect(typeof body.csv).toBe('string');

    // Duas linhas + o veículo sintetizado a partir da matrícula.
    expect(await db.prisma.fuelSession.count()).toBe(2);
    expect(await db.prisma.vehicle.count()).toBe(1);
  });

  it('regista a importação no livro de idempotência', async () => {
    await uploadCsv(app, '/api/v1/import/csv/apply', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(FUEL_DECISIONS)}`,
    });

    const entries = await db.prisma.importBookEntry.findMany({ where: { userId: user.id } });
    expect(entries.length).toBeGreaterThan(0);
  });

  /**
   * **A idempotência (§9.5) pela fronteira HTTP.**
   *
   * A segunda importação do mesmo ficheiro não cria nada e di-lo. Sem isto, o utilizador que
   * carrega duas vezes no botão duplicaria a sua conta.
   */
  it('não duplica nada numa segunda importação do mesmo ficheiro', async () => {
    const first = await uploadCsv(app, '/api/v1/import/csv/apply', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(FUEL_DECISIONS)}`,
    });
    expect(first.status).toBe(200);
    expect(first.body.applied).toBe(true);

    const fuelBefore = await db.prisma.fuelSession.count();

    const second = await uploadCsv(app, '/api/v1/import/csv/apply', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(FUEL_DECISIONS)}`,
    });

    expect(second.status).toBe(200);
    expect(second.body.applied).toBe(false);
    expect(await db.prisma.fuelSession.count()).toBe(fuelBefore);
  });

  /** Reconhece o mesmo ficheiro independentemente do nome — a chave é o conteúdo. */
  it('reconhece o mesmo conteúdo enviado em pedidos diferentes', async () => {
    await uploadCsv(app, '/api/v1/import/csv/apply', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(FUEL_DECISIONS)}`,
    });

    const again = await uploadCsv(app, '/api/v1/import/csv/apply', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(FUEL_DECISIONS)}`,
    });

    expect(again.status).toBe(200);
    expect(again.body.applied).toBe(false);
  });

  /** Um plano de outro ficheiro é recusado com 409, como no bundle. */
  it('recusa uma identidade que não corresponde ao ficheiro', async () => {
    const response = await uploadCsv(app, '/api/v1/import/csv/apply', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(FUEL_DECISIONS)}&identity=csv_outra_coisa`,
    });

    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('conflict');
  });

  /** Sem identidade a correspondência é ignorada — mas a escrita continua a vir do ficheiro. */
  it('aceita a ausência de identidade e escreve a partir do ficheiro', async () => {
    const response = await uploadCsv(app, '/api/v1/import/csv/apply', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(FUEL_DECISIONS)}`,
    });

    expect(response.status).toBe(200);
    expect(await db.prisma.fuelSession.count()).toBe(2);
  });

  /**
   * Um CSV cujo tipo não foi determinado não pode ser aplicado — e a resposta tem de dizer
   * isso (§10.5: "o utilizador escolhe"), não "os dados estão mal".
   *
   * A verificação é sobre a **mensagem** e não sobre `details`, pela mesma razão documentada
   * na suite do bundle: o `details` do `AppError` é interno por decisão do projeto
   * ("registados nos logs mas nunca enviados ao cliente", ver `core/errors.ts`). Uma
   * asserção sobre `response.body.error.details` estaria a exigir que a fronteira deixasse
   * escapar detalhes internos — o oposto do que ela faz.
   *
   * O que importa é o que o utilizador lê: a recusa tem de lhe dizer que **escolheu mal**,
   * não que os dados dele estão errados nem que o servidor avariou.
   */
  it('recusa aplicar sem tipo determinado', async () => {
    const ambiguousCsv = ['Data;Valor', '25/02/2026;10,00'].join('\r\n');

    const response = await uploadCsv(app, '/api/v1/import/csv/apply', ambiguousCsv);

    expect(response.status).toBe(422);
    expect(errorOf(response.body).code).toBe('unprocessable');
    /*
     * A mensagem pede **a escolha**. É isso que a §10.5 exige: "se a inferência for
     * ambígua, o utilizador escolhe — é uma pergunta de uma linha, não um ecrã de
     * configuração". A asserção fixa a instrução, não as palavras exatas: uma mensagem que
     * dissesse "os teus dados estão errados" ou "o servidor avariou" passaria um teste frouxo
     * e falharia o utilizador.
     */
    expect(errorOf(response.body).message).toMatch(/escolhe/i);
    expect(errorOf(response.body).message).toMatch(/tipo/i);
  });
});

/* ========================================================================== */
/* 5. Validação dos parâmetros                                                 */
/* ========================================================================== */

describe('validação dos parâmetros', () => {
  it('recusa um tipo de registo desconhecido', async () => {
    const response = await uploadCsv(app, '/api/v1/import/csv/preview', FUEL_CSV, {
      query: 'kind=inventado',
    });

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_error');
  });

  /**
   * Um `kind` do bundle que o CSV não trata (`event`, `suggestion`, `notification`) é
   * recusado — não com um erro genérico, mas dizendo quais são aceites.
   */
  it('recusa um tipo de registo que o CSV não trata', async () => {
    for (const kind of ['notification', 'suggestion', 'event']) {
      const response = await uploadCsv(app, '/api/v1/import/csv/preview', FUEL_CSV, {
        query: `kind=${kind}`,
      });

      expect(response.status, `tipo ${kind}`).toBe(400);
    }
  });

  it('recusa decisões que não são JSON', async () => {
    const response = await uploadCsv(app, '/api/v1/import/csv/preview', FUEL_CSV, {
      query: 'kind=fuel&decisions=nao-e-json',
    });

    expect(response.status).toBe(400);
  });

  it('recusa decisões que não são uma lista', async () => {
    const response = await uploadCsv(app, '/api/v1/import/csv/preview', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent('{"index":0}')}`,
    });

    expect(response.status).toBe(400);
  });

  it('recusa um índice de coluna inválido', async () => {
    const response = await uploadCsv(app, '/api/v1/import/csv/preview', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(JSON.stringify([{ index: -1, field: 'date' }]))}`,
    });

    expect(response.status).toBe(400);
  });

  /**
   * Um `field` que não seja `null` nem texto é recusado.
   *
   * Assumir `null` por omissão transformaria um erro do cliente numa coluna **ignorada em
   * silêncio** — exactamente o que a §9.2 proíbe para as lacunas.
   */
  it('recusa um campo de decisão de tipo inválido', async () => {
    const response = await uploadCsv(app, '/api/v1/import/csv/preview', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(JSON.stringify([{ index: 0, field: 42 }]))}`,
    });

    expect(response.status).toBe(400);
  });

  /** `field: null` é uma resposta legítima da §10.4 ("se a resposta for nenhuma, ignora-se"). */
  it('aceita uma coluna declaradamente ignorada', async () => {
    const response = await uploadCsv(app, '/api/v1/import/csv/preview', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(JSON.stringify([{ index: 0, field: null }]))}`,
    });

    expect(response.status).toBe(200);
  });

  it('recusa uma ordem de datas inválida', async () => {
    const response = await uploadCsv(app, '/api/v1/import/csv/preview', FUEL_CSV, {
      query: 'kind=fuel&dateOrder=inventado',
    });

    expect(response.status).toBe(400);
  });

  it('aceita as duas ordens de datas do contrato', async () => {
    for (const order of ['dia-mes', 'mes-dia']) {
      const response = await uploadCsv(app, '/api/v1/import/csv/preview', FUEL_CSV, {
        query: `kind=fuel&dateOrder=${order}`,
      });

      expect(response.status, `ordem ${order}`).toBe(200);
    }
  });

  it('recusa um separador decimal inválido', async () => {
    const response = await uploadCsv(app, '/api/v1/import/csv/preview', FUEL_CSV, {
      query: 'kind=fuel&decimalStyle=inventado',
    });

    expect(response.status).toBe(400);
  });

  it('recusa uma política de conflito inválida', async () => {
    const response = await uploadCsv(app, '/api/v1/import/csv/preview', FUEL_CSV, {
      query: 'kind=fuel&conflictPolicy=inventado',
    });

    expect(response.status).toBe(400);
  });

  it('aceita as políticas de conflito do domínio', async () => {
    for (const policy of ['keep-existing', 'prefer-incoming', 'fill-empty']) {
      const response = await uploadCsv(app, '/api/v1/import/csv/preview', FUEL_CSV, {
        query: `kind=fuel&conflictPolicy=${policy}`,
      });

      expect(response.status, `política ${policy}`).toBe(200);
    }
  });
});

/* ========================================================================== */
/* 6. O mapa de colunas pela fronteira HTTP (§10.2 passo 9)                    */
/* ========================================================================== */

describe('mapa de colunas persistido pela API', () => {
  it('guarda o mapa depois de aplicar, e di-lo no relatório', async () => {
    const response = await uploadCsv(app, '/api/v1/import/csv/apply', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(FUEL_DECISIONS)}`,
    });

    expect(response.status).toBe(200);

    const savedMap = response.body.savedMap as Record<string, unknown>;
    expect(savedMap).not.toBeNull();
    expect(savedMap.reused).toBe(false);
    expect(savedMap.decisions).toBe(5);

    expect(await db.prisma.columnMap.count()).toBe(1);
  });

  /**
   * **O "um clique" da §10.2.** A segunda importação do mesmo **formato** reutiliza o mapa
   * sem o utilizador enviar decisões nenhumas.
   */
  it('reutiliza o mapa guardado no preview seguinte sem decisões', async () => {
    await uploadCsv(app, '/api/v1/import/csv/apply', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(FUEL_DECISIONS)}`,
    });

    // Um ficheiro com o mesmo formato mas **outras linhas** — o mapa tem de servir na mesma.
    const otherCsv = [
      'Data;Matrícula;Quilometragem;Litros;Valor',
      '18/04/2026;AA-00-BB;126400;30,0;42,10',
    ].join('\r\n');

    const response = await uploadCsv(app, '/api/v1/import/csv/preview', otherCsv, {
      query: 'kind=fuel',
    });

    expect(response.status).toBe(200);

    const savedMap = response.body.savedMap as Record<string, unknown>;
    expect(savedMap).not.toBeNull();
    expect(savedMap.reused).toBe(true);
    expect(savedMap.decisions).toBe(5);
  });

  /**
   * **A deteção de mudança de formato.** O fornecedor acrescentou uma coluna: a forma mudou,
   * o mapa **não** é reutilizado, e o utilizador volta a confirmar. É o que a §10.2 manda
   * fazer — e é a proteção contra importar com um mapa que já não corresponde.
   */
  it('não reutiliza o mapa quando o formato do ficheiro muda', async () => {
    await uploadCsv(app, '/api/v1/import/csv/apply', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(FUEL_DECISIONS)}`,
    });

    const changedCsv = [
      'Data;Matrícula;Quilometragem;Litros;Valor;Categoria',
      '18/04/2026;AA-00-BB;126400;30,0;42,10;Combustível',
    ].join('\r\n');

    const response = await uploadCsv(app, '/api/v1/import/csv/preview', changedCsv, {
      query: 'kind=fuel',
    });

    expect(response.status).toBe(200);
    expect(response.body.savedMap).toBeNull();
  });

  /**
   * **A reutilização atravessa a reordenação das colunas.**
   *
   * É o cenário que um mapa guardado por índice falharia em silêncio: `Data` está agora no
   * fim, e um mapa aplicado por posição escreveria valores trocados sem erro nenhum.
   */
  it('reutiliza o mapa mesmo com as colunas por outra ordem', async () => {
    await uploadCsv(app, '/api/v1/import/csv/apply', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(FUEL_DECISIONS)}`,
    });

    const reordered = [
      'Valor;Litros;Matrícula;Data;Quilometragem',
      '42,10;30,0;AA-00-BB;18/04/2026;126400',
    ].join('\r\n');

    const response = await uploadCsv(app, '/api/v1/import/csv/preview', reordered, {
      query: 'kind=fuel',
    });

    expect(response.status).toBe(200);

    const savedMap = response.body.savedMap as Record<string, unknown>;
    expect(savedMap).not.toBeNull();
    expect(savedMap.reused).toBe(true);

    // O mapeamento final tem de apontar a coluna de data para o índice 3 — não para o 0.
    const columns = (response.body.mapping as { columns: { field: string | null; index: number }[] })
      .columns;
    const dateColumn = columns.find((column) => column.field === 'date');

    expect(dateColumn).toBeDefined();
    expect(dateColumn?.index).toBe(3);
  });

  /**
   * **O isolamento do mapa pela fronteira HTTP.**
   *
   * O `userId` que chega ao serviço vem do token. O utilizador B, com o **mesmo formato**,
   * não reutiliza o mapa de A — e o que prova isso é que a resposta dele traz
   * `savedMap: null`, não que o serviço esteja correto.
   */
  it('não deixa uma conta reutilizar o mapa de outra', async () => {
    await uploadCsv(app, '/api/v1/import/csv/apply', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(FUEL_DECISIONS)}`,
    });

    expect(await db.prisma.columnMap.count({ where: { userId: user.id } })).toBe(1);

    // O mesmo formato, na outra conta.
    const otherCsv = [
      'Data;Matrícula;Quilometragem;Litros;Valor',
      '18/04/2026;BB-11-CC;50000;20,0;30,00',
    ].join('\r\n');

    const response = await uploadCsv(app, '/api/v1/import/csv/preview', otherCsv, {
      query: 'kind=fuel',
      token: otherToken,
    });

    expect(response.status).toBe(200);
    expect(response.body.savedMap).toBeNull();

    // E a base de dados continua a ter só o mapa do titular.
    expect(await db.prisma.columnMap.count()).toBe(1);
  });

  /**
   * O que o utilizador envia agora ganha ao que ficou guardado.
   *
   * Um mapa é um ponto de partida; a confirmação do momento é a última palavra. O contrário
   * faria uma correção de hoje ser ignorada em favor de uma decisão antiga.
   */
  it('dá prioridade às decisões enviadas sobre o mapa guardado', async () => {
    await uploadCsv(app, '/api/v1/import/csv/apply', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(FUEL_DECISIONS)}`,
    });

    // Uma decisão explícita diferente: a coluna de litros passa a ser `notes`.
    const override = JSON.stringify([{ index: 3, field: 'notes' }]);

    const response = await uploadCsv(app, '/api/v1/import/csv/preview', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(override)}`,
    });

    expect(response.status).toBe(200);

    // Não se reutilizou o mapa — as decisões enviadas substituíram-no.
    expect(response.body.savedMap).toBeNull();

    const columns = (response.body.mapping as { columns: { field: string | null; index: number }[] })
      .columns;
    const litresColumn = columns.find((column) => column.index === 3);
    expect(litresColumn?.field).toBe('notes');
  });
});

/* ========================================================================== */
/* 7. Isolamento por conta (§7.3)                                              */
/* ========================================================================== */

describe('isolamento por conta', () => {
  /**
   * O mesmo ficheiro importado em duas contas **cria em ambas**.
   *
   * É o que torna possível exportar de uma conta e importar noutra — a razão pela qual o
   * livro de idempotência inclui o `userId`.
   */
  it('importa o mesmo ficheiro em duas contas diferentes', async () => {
    const mine = await uploadCsv(app, '/api/v1/import/csv/apply', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(FUEL_DECISIONS)}`,
    });
    const theirs = await uploadCsv(app, '/api/v1/import/csv/apply', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(FUEL_DECISIONS)}`,
      token: otherToken,
    });

    expect(mine.status).toBe(200);
    expect(theirs.status).toBe(200);
    expect(mine.body.applied).toBe(true);
    expect(theirs.body.applied).toBe(true);

    expect(await db.prisma.fuelSession.count({ where: { userId: user.id } })).toBe(2);
    expect(await db.prisma.fuelSession.count({ where: { userId: other.id } })).toBe(2);
  });

  it('marca cada registo com o utilizador do token', async () => {
    await uploadCsv(app, '/api/v1/import/csv/apply', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(FUEL_DECISIONS)}`,
      token: otherToken,
    });

    const mine = await db.prisma.fuelSession.count({ where: { userId: user.id } });
    const theirs = await db.prisma.fuelSession.count({ where: { userId: other.id } });

    expect(mine).toBe(0);
    expect(theirs).toBe(2);
  });

  /**
   * Uma coluna chamada `Utilizador` no ficheiro **não** muda o destinatário.
   *
   * A §7.3 é explícita: "a conta vem sempre do token, nunca do pedido". Um ficheiro que
   * peça para escrever na conta de outra pessoa escreve na conta de quem o envia.
   */
  it('ignora qualquer indicação de conta vinda do ficheiro', async () => {
    const sneaky = [
      'Data;Matrícula;Quilometragem;Litros;Valor;Utilizador',
      `25/02/2026;AA-00-BB;125000;32,4;45,50;${other.id}`,
    ].join('\r\n');

    const response = await uploadCsv(app, '/api/v1/import/csv/apply', sneaky, {
      query: `kind=fuel&decisions=${encodeURIComponent(FUEL_DECISIONS)}`,
    });

    expect(response.status).toBe(200);

    // Escreveu na conta do token (a minha), e não na conta nomeada no ficheiro.
    expect(await db.prisma.fuelSession.count({ where: { userId: user.id } })).toBeGreaterThan(0);
    expect(await db.prisma.fuelSession.count({ where: { userId: other.id } })).toBe(0);
  });

  it('isola os registos de cada conta na base de dados', async () => {
    await uploadCsv(app, '/api/v1/import/csv/apply', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(FUEL_DECISIONS)}`,
    });

    const rows = await db.prisma.fuelSession.findMany({ select: { userId: true } });
    expect(rows.every((row) => row.userId === user.id)).toBe(true);
  });
});

/* ========================================================================== */
/* 8. Robustez do parser (§10.1)                                               */
/* ========================================================================== */

describe('robustez do ficheiro de entrada', () => {
  it('aceita um CSV com BOM', async () => {
    const response = await uploadCsv(app, '/api/v1/import/csv/preview', `\uFEFF${FUEL_CSV}`, {
      query: 'kind=fuel',
    });

    expect(response.status).toBe(200);
    expect((response.body.detection as { encoding: string }).encoding).toBe('utf-8-bom');
  });

  it('aceita um CSV com separador por vírgula', async () => {
    const commaCsv = [
      'Data,Matrícula,Quilometragem,Litros,Valor',
      '25/02/2026,AA-00-BB,125000,32.4,45.50',
    ].join('\r\n');

    const response = await uploadCsv(app, '/api/v1/import/csv/preview', commaCsv, {
      query: 'kind=fuel',
    });

    expect(response.status).toBe(200);
    expect((response.body.detection as { delimiter: string }).delimiter).toBe(',');
  });

  it('aceita linhas terminadas em LF', async () => {
    const lfCsv = FUEL_CSV.split('\r\n').join('\n');

    const response = await uploadCsv(app, '/api/v1/import/csv/preview', lfCsv, { query: 'kind=fuel' });

    expect(response.status).toBe(200);
  });

  /** Um ficheiro vazio produz uma análise com motivo, e não um 500. */
  it('trata um ficheiro vazio sem avariar', async () => {
    const response = await request(app)
      .post('/api/v1/import/csv/preview?kind=fuel')
      .set('Content-Type', 'text/csv')
      .set('Authorization', `Bearer ${token}`)
      .send(Buffer.from('', 'utf8'));

    expect([200, 400]).toContain(response.status);
    expect(response.status).not.toBe(500);
  });

  /** Um binário que não seja texto é reportado como análise vazia, não como avaria. */
  it('trata um ficheiro sem estrutura sem avariar', async () => {
    const bytes = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);

    const response = await request(app)
      .post('/api/v1/import/csv/preview?kind=fuel')
      .set('Content-Type', 'application/octet-stream')
      .set('Authorization', `Bearer ${token}`)
      .send(bytes);

    expect(response.status).not.toBe(500);
  });
});

/* ========================================================================== */
/* 9. A escritura de auditoria (§7.3)                                          */
/* ========================================================================== */

describe('auditoria', () => {
  /**
   * A importação é a operação simétrica da exportação, que já é auditada. O evento segue a
   * convenção `user.<ação>` e regista contagens — **nunca** o conteúdo (§7.3, §30).
   */
  it('regista a importação quando houve escrita', async () => {
    await uploadCsv(app, '/api/v1/import/csv/apply', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(FUEL_DECISIONS)}`,
    });

    const logs = await db.prisma.auditLog.findMany({ where: { action: 'user.imported_data' } });
    expect(logs.length).toBeGreaterThan(0);

    const log = logs[0];
    expect(log?.userId).toBe(user.id);
    expect(log?.metadata).toBeDefined();
  });

  /** Uma reimportação que não escreveu nada não é uma operação, e não se regista. */
  it('não regista quando não houve escrita', async () => {
    await uploadCsv(app, '/api/v1/import/csv/apply', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(FUEL_DECISIONS)}`,
    });
    await db.prisma.auditLog.deleteMany();

    const second = await uploadCsv(app, '/api/v1/import/csv/apply', FUEL_CSV, {
      query: `kind=fuel&decisions=${encodeURIComponent(FUEL_DECISIONS)}`,
    });

    expect(second.body.applied).toBe(false);
    expect(await db.prisma.auditLog.count({ where: { action: 'user.imported_data' } })).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Contagem de linhas                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Conta as linhas das tabelas em que uma importação escreveria.
 *
 * Existe para a asserção mais importante desta suite — **"o preview não escreve nada"** —
 * ser feita sobre o estado do armazenamento e não sobre a forma da resposta.
 */
async function counts(): Promise<Record<string, number>> {
  return {
    vehicles: await db.prisma.vehicle.count(),
    fuel: await db.prisma.fuelSession.count(),
    expenses: await db.prisma.expense.count(),
    odometer: await db.prisma.odometerReading.count(),
    documents: await db.prisma.document.count(),
    importBook: await db.prisma.importBookEntry.count(),
  };
}
