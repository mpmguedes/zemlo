/**
 * Rotas de lembretes pela fronteira HTTP (`TEST-001`).
 *
 * ## Porque é que esta suite existe
 *
 * `apps/api/src/http/routes/reminders.ts` não tinha um único ficheiro de teste em `npm test`.
 * A lógica pura de avaliação está coberta por `domain.test.ts`, mas isso não responde à
 * pergunta que interessa: *"o que o cliente recebe quando conclui um lembrete está certo?"*.
 * Entre `evaluateReminder` e a resposta ficam o serviço, a repetição automática, o evento
 * gravado e o mapeamento — quatro elos que uma alteração pode partir sem que nenhum teste de
 * domínio se aperceba.
 *
 * ## O que é que estes testes provam
 *
 *  - **percurso completo** — criar, ler, listar, editar e apagar pelo contrato público, com o
 *    `Location` da criação e o estado observável a cada passo;
 *  - **conclusão** (§16) — um lembrete repetível gera a ocorrência seguinte, com a data a
 *    contar a partir da conclusão; `createNext: false` não gera nada; e **concluir duas vezes
 *    não duplica** a ocorrência seguinte (a idempotência descrita no serviço);
 *  - **adiar** (§21) — a data efetiva avança a partir de hoje, mesmo para um lembrete em atraso;
 *  - **idempotência de criação** — a mesma `dedupeKey` no mesmo veículo devolve **409**, não um
 *    segundo lembrete;
 *  - **validação** — a API recusa o que o contrato recusa (422) e o que o serviço recusa por
 *    falta de condição (um lembrete por tempo sem data, um por km sem alvo), em vez de gravar
 *    um lembrete que nunca dispara;
 *  - **autenticação** — sem sessão e com token inválido, **401** em todas as rotas do router.
 *    E **404** para um endereço que o router não serve: a autenticação tem correspondência
 *    exata, pelo que um caminho desconhecido não é autenticado à força (a distinção 401/404
 *    documentada no próprio router);
 *  - **isolamento entre contas** — outra conta autenticada recebe **404** (e não 403) para um
 *    lembrete alheio, em todas as operações; o lembrete do dono fica intacto; e criar um
 *    lembrete sobre o veículo de outra conta também é 404.
 *
 * ## O que estes testes não fazem
 *
 * Não reimplementam a lógica que vigiam (`AUD-004`): tudo passa por `createApp()` e pelo
 * contrato HTTP, contra a base de dados a sério. Não substituem serviços nem repositórios.
 *
 * ## A base de dados
 *
 * Como em `documents-http.test.ts`, `fuel-consumption-http.test.ts` e `vehicles-http.test.ts`:
 * a `DATABASE_URL` é definida **antes** de a aplicação ser importada, porque o `core/db.ts`
 * instancia o cliente no import. A base é temporária, vive fora do repositório e é destruída
 * no fim — mesmo que um teste falhe. Cada teste cria a sua própria conta, para não depender da
 * ordem de limpeza das tabelas com chaves estrangeiras (um lembrete gera eventos).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@zemlo/prisma-sqlite';

import { createTestDb, type TestDb } from './helpers/db.js';

/* -------------------------------------------------------------------------- */
/* Infraestrutura                                                              */
/* -------------------------------------------------------------------------- */

let db: TestDb;
let app: Express;
let appPrisma: PrismaClient;
let token: string;

beforeAll(async () => {
  db = await createTestDb();

  process.env.DATABASE_URL = db.url;
  process.env.DATABASE_PROVIDER = 'sqlite';
  process.env.NODE_ENV = 'test';

  const [{ createApp }, { prisma }] = await Promise.all([
    import('../src/app.js'),
    import('../src/core/db.js'),
  ]);

  appPrisma = prisma;
  app = createApp();

  const sonda = await appPrisma.user.create({
    data: { email: 'sonda-lembretes@zemlo.test', name: 'Sonda' },
    select: { id: true },
  });
  expect(
    await db.prisma.user.findUnique({ where: { id: sonda.id } }),
    'A aplicação não está ligada à base de dados temporária. O DATABASE_URL não foi aplicado antes de a app ser importada.',
  ).not.toBeNull();
  await appPrisma.user.deleteMany();
}, 120_000);

afterAll(async () => {
  // Fechar o cliente da aplicação primeiro: no Windows, o ficheiro SQLite aberto impediria
  // a remoção do directório com `EBUSY`.
  await appPrisma.$disconnect();
  await db.destroy();
});

beforeEach(async () => {
  token = await signup(`lembretes-${Math.random().toString(36).slice(2, 10)}@zemlo.test`);
});

/* -------------------------------------------------------------------------- */
/* Utilitários                                                                 */
/* -------------------------------------------------------------------------- */

async function signup(email: string): Promise<string> {
  const response = await request(app)
    .post('/api/v1/auth/signup')
    .set('Content-Type', 'application/json')
    .send({ email, password: 'Password123!', name: 'Teste', acceptedTerms: true });

  if (response.status !== 201) {
    throw new Error(
      `Não foi possível criar a sessão de teste (${response.status}): ${JSON.stringify(response.body)}`,
    );
  }

  return response.body.tokens.accessToken as string;
}

async function createVehicle(
  tk: string,
  plate = 'AA0001',
  extra: Record<string, unknown> = {},
): Promise<string> {
  const response = await request(app)
    .post('/api/v1/vehicles')
    .set('Authorization', `Bearer ${tk}`)
    .set('Content-Type', 'application/json')
    .send({ plate, fuelType: 'diesel', ...extra });

  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.id as string;
}

/**
 * Pedido autenticado genérico.
 *
 * O método é escolhido pelo nome para que as asserções leiam como o contrato: `auth('get', …)`
 * é o que o cliente faz, e não uma construção de teste.
 */
function auth(
  method: 'get' | 'post' | 'patch' | 'delete',
  url: string,
  tk: string | null = token,
): request.Test {
  const probe = request(app)[method](url);
  return tk === null ? probe : probe.set('Authorization', `Bearer ${tk}`);
}

/** Corpo mínimo válido para um lembrete por tempo, com a data que o teste quiser. */
function timeReminder(vehicleId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { vehicleId, title: 'Mudar o filtro do ar', trigger: 'time', dueDate: '2026-12-01', ...extra };
}

/** Cria um lembrete por tempo e devolve o objeto devolvido pela API (201). */
async function createTimeReminder(
  vehicleId: string,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const response = await auth('post', '/api/v1/reminders', token).send(timeReminder(vehicleId, extra));
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body as Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* §1 — Percurso completo                                                      */
/* -------------------------------------------------------------------------- */

describe('lembretes: percurso completo', () => {
  it('criar devolve 201 com Location, e o lembrete é legível no endereço indicado', async () => {
    const vehicleId = await createVehicle(token);

    const created = await auth('post', '/api/v1/reminders').send(timeReminder(vehicleId));

    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.headers.location).toBe(`/api/v1/reminders/${created.body.id}`);

    const read = await auth('get', `/api/v1/reminders/${created.body.id}`);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body.id).toBe(created.body.id);
    expect(read.body.title).toBe('Mudar o filtro do ar');
    expect(read.body.trigger).toBe('time');
    expect(read.body.dueDate).toBe('2026-12-01');
    expect(read.body.completedAt).toBeNull();
  });

  it('a listagem inclui o lembrete criado e conta-o', async () => {
    const vehicleId = await createVehicle(token);
    const created = await createTimeReminder(vehicleId);

    const list = await auth('get', '/api/v1/reminders');

    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.total).toBe(1);
    expect((list.body.items as Array<{ id: string }>).map((item) => item.id)).toContain(created.id);
  });

  it('editar o título reflete-se na leitura seguinte', async () => {
    const vehicleId = await createVehicle(token);
    const created = await createTimeReminder(vehicleId);

    const patched = await auth('patch', `/api/v1/reminders/${created.id}`).send({
      title: 'Filtro do ar (novo)',
      notes: 'Comprado na oficina da esquina',
    });

    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.title).toBe('Filtro do ar (novo)');
    expect(patched.body.notes).toBe('Comprado na oficina da esquina');

    const read = await auth('get', `/api/v1/reminders/${created.id}`);
    expect(read.body.title).toBe('Filtro do ar (novo)');
  });

  it('apagar devolve 204 e a leitura seguinte passa a 404', async () => {
    const vehicleId = await createVehicle(token);
    const created = await createTimeReminder(vehicleId);

    const removed = await auth('delete', `/api/v1/reminders/${created.id}`);
    expect(removed.status, JSON.stringify(removed.body)).toBe(204);

    const read = await auth('get', `/api/v1/reminders/${created.id}`);
    expect(read.status).toBe(404);
  });

  it('aceita um lembrete por tempo cuja condição é só o intervalo, e materializa a data', async () => {
    const vehicleId = await createVehicle(token);

    const created = await auth('post', '/api/v1/reminders').send({
      vehicleId,
      title: 'Revisão anual',
      trigger: 'time',
      intervalMonths: 12,
    });

    expect(created.status, JSON.stringify(created.body)).toBe(201);
    // O intervalo é traduzido numa data concreta: é isso que faz dele uma condição. Sem esta
    // materialização, o lembrete existiria sem nada que o pudesse fazer disparar.
    expect(created.body.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(created.body.intervalMonths).toBe(12);
  });

  it('aceita um lembrete por quilometragem cuja condição é só o intervalo em km', async () => {
    const vehicleId = await createVehicle(token, 'AA0001', { odometerKm: 42_000 });

    const created = await auth('post', '/api/v1/reminders').send({
      vehicleId,
      title: 'Trocar o óleo',
      trigger: 'distance',
      intervalKm: 15_000,
    });

    expect(created.status, JSON.stringify(created.body)).toBe(201);
    // O intervalo é traduzido num alvo concreto: é isso que faz dele uma condição. Sem esta
    // materialização, o lembrete existiria sem nada que o pudesse fazer disparar.
    //
    // O alvo é afirmado, e não só o intervalo, porque era o alvo que ficava por verificar: a
    // versão anterior deste teste — com um veículo **sem** quilometragem — passava com
    // `dueOdometerKm: null` e `state: 'unknown'`, isto é, fixava como esperado um lembrete morto.
    expect(created.body.intervalKm).toBe(15_000);
    expect(created.body.dueOdometerKm).toBe(57_000);
    expect(created.body.evaluation.state).not.toBe('unknown');
  });

  it('recusa um intervalo em km quando o veículo não tem quilometragem para o ancorar', async () => {
    // Sem uma quilometragem de partida não há como materializar o alvo, e o lembrete nasceria
    // morto (`dueOdometerKm: null`, `state: 'unknown'`) — o estado exato que `AUD-014` veio
    // eliminar. A recusa é sobre o **estado final**, não sobre o pedido (`AUD-015`).
    const vehicleId = await createVehicle(token);

    const created = await auth('post', '/api/v1/reminders').send({
      vehicleId,
      title: 'Trocar o óleo',
      trigger: 'distance',
      intervalKm: 15_000,
    });

    expect(created.status, JSON.stringify(created.body)).toBe(422);
    expect(String(created.body.error.message)).toMatch(/quilometragem/i);

    const list = await auth('get', '/api/v1/reminders');
    expect(list.body.total).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* §1b — Edição: a invariante é sobre o estado final (AUD-015)                 */
/* -------------------------------------------------------------------------- */

describe('lembretes: edição e a condição resultante', () => {
  /** Lembrete por tempo cuja única condição é a data (`2026-12-01`). */
  async function reminderComData(): Promise<Record<string, unknown>> {
    return createTimeReminder(await createVehicle(token));
  }

  /** Lembrete por quilometragem cuja única condição é o alvo (57 000 km). */
  async function reminderComAlvo(): Promise<Record<string, unknown>> {
    const vehicleId = await createVehicle(token, 'AA0002', { odometerKm: 42_000 });

    const created = await auth('post', '/api/v1/reminders').send({
      vehicleId,
      title: 'Trocar o óleo',
      trigger: 'distance',
      dueOdometerKm: 57_000,
    });

    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return created.body as Record<string, unknown>;
  }

  it('apagar a data de um lembrete por tempo devolve 422 e não grava', async () => {
    const created = await reminderComData();

    const patched = await auth('patch', `/api/v1/reminders/${created.id}`).send({ dueDate: null });

    expect(patched.status, JSON.stringify(patched.body)).toBe(422);

    const read = await auth('get', `/api/v1/reminders/${created.id}`);
    expect(read.body.dueDate).toBe('2026-12-01');
  });

  it('apagar o alvo de um lembrete por quilometragem devolve 422 e não grava', async () => {
    const created = await reminderComAlvo();

    const patched = await auth('patch', `/api/v1/reminders/${created.id}`).send({ dueOdometerKm: null });

    expect(patched.status, JSON.stringify(patched.body)).toBe(422);

    const read = await auth('get', `/api/v1/reminders/${created.id}`);
    expect(read.body.dueOdometerKm).toBe(57_000);
  });

  it('trocar o trigger para um que o estado não satisfaz devolve 422', async () => {
    // O pedido não menciona data nem alvo: o que está errado é o **estado resultante**, em que
    // um lembrete por quilometragem fica sem alvo nenhum. É a diferença entre validar o pedido
    // e validar o resultado.
    const created = await reminderComData();

    const patched = await auth('patch', `/api/v1/reminders/${created.id}`).send({ trigger: 'distance' });

    expect(patched.status, JSON.stringify(patched.body)).toBe(422);

    const read = await auth('get', `/api/v1/reminders/${created.id}`);
    expect(read.body.trigger).toBe('time');
  });

  it('um PATCH que mantém a condição continua a passar', async () => {
    const created = await reminderComData();

    const patched = await auth('patch', `/api/v1/reminders/${created.id}`).send({
      dueDate: '2027-03-15',
      title: 'Filtro do ar (novo)',
    });

    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.dueDate).toBe('2027-03-15');
    expect(patched.body.title).toBe('Filtro do ar (novo)');
  });

  it('uma edição que não toca na condição não é afetada pela guarda', async () => {
    const created = await reminderComData();

    const patched = await auth('patch', `/api/v1/reminders/${created.id}`).send({
      notes: 'Comprado na oficina da esquina',
    });

    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.notes).toBe('Comprado na oficina da esquina');
    expect(patched.body.dueDate).toBe('2026-12-01');
  });
});

/* -------------------------------------------------------------------------- */
/* §2 — Conclusão e repetição (§16)                                            */
/* -------------------------------------------------------------------------- */

describe('lembretes: conclusão e repetição', () => {
  it('concluir um lembrete repetível cria a ocorrência seguinte', async () => {
    const vehicleId = await createVehicle(token);
    const created = await createTimeReminder(vehicleId, {
      dueDate: '2026-01-01',
      repeat: true,
      intervalMonths: 12,
    });

    const response = await auth('post', `/api/v1/reminders/${created.id}/complete`).send({
      completedAt: '2026-09-21',
      odometerKm: 42_000,
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.completed.completedAt).not.toBeNull();
    expect(response.body.next, 'Um lembrete repetível devia gerar a ocorrência seguinte.').not.toBeNull();
    // A data seguinte conta a partir da conclusão, não da data que estava agendada (§16).
    expect(response.body.next.dueDate).toBe('2027-09-21');
    expect(response.body.next.id).not.toBe(created.id);
  });

  it('concluir com createNext:false não cria ocorrência seguinte', async () => {
    const vehicleId = await createVehicle(token);
    const created = await createTimeReminder(vehicleId, {
      dueDate: '2026-01-01',
      repeat: true,
      intervalMonths: 12,
    });

    const response = await auth('post', `/api/v1/reminders/${created.id}/complete`).send({
      createNext: false,
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.next).toBeNull();
  });

  it('concluir duas vezes não duplica a ocorrência seguinte', async () => {
    const vehicleId = await createVehicle(token);
    const created = await createTimeReminder(vehicleId, {
      dueDate: '2026-01-01',
      repeat: true,
      intervalMonths: 12,
    });

    const primeira = await auth('post', `/api/v1/reminders/${created.id}/complete`).send({
      completedAt: '2026-09-21',
    });
    const segunda = await auth('post', `/api/v1/reminders/${created.id}/complete`).send({
      completedAt: '2026-09-21',
    });

    expect(primeira.status, JSON.stringify(primeira.body)).toBe(200);
    expect(segunda.status, JSON.stringify(segunda.body)).toBe(200);
    expect(segunda.body.next?.id, 'A segunda conclusão devolveu outra ocorrência.').toBe(
      primeira.body.next?.id,
    );

    const list = await auth('get', '/api/v1/reminders').query({ includeCompleted: true });
    const ids = (list.body.items as Array<{ id: string }>).map((item) => item.id);
    expect(ids.filter((id) => id === primeira.body.next.id)).toHaveLength(1);
    expect(ids).toHaveLength(2);
  });

  it('adiar afasta a data para o futuro, mesmo para um lembrete em atraso', async () => {
    const vehicleId = await createVehicle(token);
    const created = await createTimeReminder(vehicleId, { dueDate: '2026-01-01' });

    const antes = await auth('get', `/api/v1/reminders/${created.id}`);
    expect(antes.body.evaluation.state, 'O lembrete devia estar em atraso antes de ser adiado.').toBe(
      'overdue',
    );

    const adiado = await auth('post', `/api/v1/reminders/${created.id}/snooze`).send({ days: 30 });

    expect(adiado.status, JSON.stringify(adiado.body)).toBe(200);
    expect(adiado.body.dueDate > '2026-01-01', `Data não avançou: ${adiado.body.dueDate}`).toBe(true);
    expect(adiado.body.evaluation.state).not.toBe('overdue');
  });
});

/* -------------------------------------------------------------------------- */
/* §3 — Idempotência de criação                                                */
/* -------------------------------------------------------------------------- */

describe('lembretes: idempotência de criação', () => {
  it('a mesma dedupeKey no mesmo veículo devolve 409 em vez de duplicar', async () => {
    const vehicleId = await createVehicle(token);

    const primeira = await auth('post', '/api/v1/reminders').send(
      timeReminder(vehicleId, { dedupeKey: 'filtro-ar-2026' }),
    );
    expect(primeira.status, JSON.stringify(primeira.body)).toBe(201);

    const segunda = await auth('post', '/api/v1/reminders').send(
      timeReminder(vehicleId, { dedupeKey: 'filtro-ar-2026' }),
    );

    expect(segunda.status, JSON.stringify(segunda.body)).toBe(409);

    const list = await auth('get', '/api/v1/reminders');
    expect(list.body.total).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* §4 — Validação                                                              */
/* -------------------------------------------------------------------------- */

describe('lembretes: validação', () => {
  const INVALIDOS: Array<[string, (vehicleId: string) => Record<string, unknown>]> = [
    ['corpo vazio', () => ({})],
    ['sem veículo', () => ({ title: 'X', trigger: 'time', dueDate: '2026-12-01' })],
    ['título vazio', (v) => ({ vehicleId: v, title: '   ', trigger: 'time', dueDate: '2026-12-01' })],
    ['título demasiado longo', (v) => ({ ...timeReminder(v), title: 'a'.repeat(161) })],
    ['trigger desconhecido', (v) => ({ ...timeReminder(v), trigger: 'por-tempo' })],
    ['data inexistente no calendário', (v) => ({ ...timeReminder(v), dueDate: '2026-13-45' })],
    [
      'lembrete por tempo sem data nem intervalo',
      (v) => ({ vehicleId: v, title: 'X', trigger: 'time' }),
    ],
    [
      'lembrete por tempo sem data nem intervalo (null explícito)',
      (v) => ({ vehicleId: v, title: 'X', trigger: 'time', dueDate: null, intervalMonths: null }),
    ],
    [
      'lembrete por quilometragem sem alvo nem intervalo',
      (v) => ({ vehicleId: v, title: 'X', trigger: 'distance' }),
    ],
    [
      'lembrete por quilometragem sem alvo nem intervalo (null explícito)',
      (v) => ({ vehicleId: v, title: 'X', trigger: 'distance', dueOdometerKm: null, intervalKm: null }),
    ],
    ['intervalo de meses a zero', (v) => ({ ...timeReminder(v), dueDate: null, intervalMonths: 0 })],
    ['intervalo de km abaixo do mínimo', (v) => ({ ...timeReminder(v), intervalKm: 50 })],
    ['quilometragem alvo negativa', (v) => ({ ...timeReminder(v), dueOdometerKm: -1 })],
  ];

  it.each(INVALIDOS)('recusa: %s', async (_nome, corpo) => {
    const vehicleId = await createVehicle(token);

    const response = await auth('post', '/api/v1/reminders').send(corpo(vehicleId));

    expect(response.status, JSON.stringify(response.body)).toBe(422);
  });

  it('nada foi gravado depois de uma vaga de pedidos inválidos', async () => {
    const vehicleId = await createVehicle(token);

    for (const [, corpo] of INVALIDOS) {
      await auth('post', '/api/v1/reminders').send(corpo(vehicleId));
    }

    const list = await auth('get', '/api/v1/reminders');
    expect(list.body.total).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* §5 — Autenticação                                                           */
/* -------------------------------------------------------------------------- */

describe('lembretes: autenticação', () => {
  const ROTAS: Array<[string, 'get' | 'post' | 'patch' | 'delete', string]> = [
    ['listar', 'get', '/api/v1/reminders'],
    ['criar', 'post', '/api/v1/reminders'],
    ['ler', 'get', '/api/v1/reminders/nao-existe'],
    ['editar', 'patch', '/api/v1/reminders/nao-existe'],
    ['apagar', 'delete', '/api/v1/reminders/nao-existe'],
    ['concluir', 'post', '/api/v1/reminders/nao-existe/complete'],
    ['adiar', 'post', '/api/v1/reminders/nao-existe/snooze'],
  ];

  it.each(ROTAS)('%s sem sessão devolve 401', async (_nome, method, url) => {
    const response = await auth(method, url, null).send({});
    expect(response.status, JSON.stringify(response.body)).toBe(401);
  });

  it.each(ROTAS)('%s com token inválido devolve 401', async (_nome, method, url) => {
    const response = await auth(method, url, 'isto-nao-e-um-token').send({});
    expect(response.status, JSON.stringify(response.body)).toBe(401);
  });

  it('um endereço que o router não serve devolve 404, não 401', async () => {
    // A autenticação tem correspondência exata de rota: um caminho desconhecido não é
    // autenticado à força. Sem isto, `/api/v1/reminders-x` responderia 401 por começar
    // como um prefixo conhecido — e o cliente não distinguiria "não existe" de "entra".
    const response = await auth('get', '/api/v1/reminders/nao-existe/desconhecido', null);
    expect(response.status).toBe(404);
  });
});

/* -------------------------------------------------------------------------- */
/* §6 — Isolamento entre contas                                                */
/* -------------------------------------------------------------------------- */

describe('lembretes: isolamento entre contas', () => {
  it('criar um lembrete sobre o veículo de outra conta devolve 404', async () => {
    const vehicleId = await createVehicle(token);
    const intruso = await signup(`intruso-${Math.random().toString(36).slice(2, 10)}@zemlo.test`);

    const response = await auth('post', '/api/v1/reminders', intruso).send(timeReminder(vehicleId));

    expect(response.status, JSON.stringify(response.body)).toBe(404);
  });

  const OPERACOES: Array<[string, 'get' | 'post' | 'patch' | 'delete', string, Record<string, unknown>]> = [
    ['ler', 'get', '', {}],
    ['editar', 'patch', '', { title: 'roubado' }],
    ['apagar', 'delete', '', {}],
    ['concluir', 'post', '/complete', {}],
    ['adiar', 'post', '/snooze', { days: 7 }],
  ];

  it.each(OPERACOES)('%s o lembrete de outra conta devolve 404', async (_nome, method, sufixo, corpo) => {
    const vehicleId = await createVehicle(token);
    const created = await createTimeReminder(vehicleId);
    const intruso = await signup(`intruso-${Math.random().toString(36).slice(2, 10)}@zemlo.test`);

    const response = await auth(
      method,
      `/api/v1/reminders/${created.id}${sufixo}`,
      intruso,
    ).send(corpo);

    expect(response.status, JSON.stringify(response.body)).toBe(404);
  });

  it('depois das tentativas, o lembrete do dono está intacto', async () => {
    const vehicleId = await createVehicle(token);
    const created = await createTimeReminder(vehicleId, { dueDate: '2026-12-01' });
    const intruso = await signup(`intruso-${Math.random().toString(36).slice(2, 10)}@zemlo.test`);

    await auth('patch', `/api/v1/reminders/${created.id}`, intruso).send({ title: 'roubado' });
    await auth('delete', `/api/v1/reminders/${created.id}`, intruso).send({});
    await auth('post', `/api/v1/reminders/${created.id}/complete`, intruso).send({});
    await auth('post', `/api/v1/reminders/${created.id}/snooze`, intruso).send({ days: 7 });

    const read = await auth('get', `/api/v1/reminders/${created.id}`);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body.title).toBe('Mudar o filtro do ar');
    expect(read.body.dueDate).toBe('2026-12-01');
    expect(read.body.completedAt).toBeNull();
  });
});
