/**
 * Rotas financeiras pela fronteira HTTP (`TEST-001`).
 *
 * ## Porque é que esta suite existe
 *
 * `http/routes/financial.ts` tem 15 rotas — despesas, abastecimentos e carregamentos — e
 * **zero** cobertura em `npm test` antes deste ficheiro. A verificação existia em `verify.ts`,
 * que exige servidor a correr e não é automática.
 *
 * ## O que é que estes testes provam
 *
 *  - **percurso completo** dos três recursos: criar, ler, editar, apagar, e a lista;
 *  - **métricas derivadas na resposta** (§13, §14) — o consumo de combustível do intervalo
 *    atestado e as derivadas do carregamento vêm calculadas na criação, e não a `null`;
 *  - **a despesa ligada** — um abastecimento cria a despesa correspondente (`category: 'fuel'`,
 *    `linkedRecordId` a apontar para ele), e apagar o abastecimento apaga a despesa. É a
 *    invariante que impede despesas órfãs a duplicar o custo por km;
 *  - **validação** — o que o contrato recusa devolve 422, e não é gravado;
 *  - **autenticação** — 401 sem sessão e com token inválido;
 *  - **isolamento entre contas** — 404 para registos alheios, e o registo do dono fica intacto.
 *
 * ## O que estes testes não fazem
 *
 * Não reimplementam o cálculo que vigiam (`AUD-004`): o consumo é afirmado contra o número que
 * a API devolve, e a aritmética esperada é a do domínio, escrita no teste como valor literal —
 * não há uma segunda implementação da regra A8 aqui dentro.
 *
 * ## A base de dados
 *
 * `DATABASE_URL` antes do import da aplicação, base temporária fora do repositório, destruída
 * no fim, conta própria por teste — como em `documents-http.test.ts`.
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
    data: { email: 'sonda-financeiro@zemlo.test', name: 'Sonda' },
    select: { id: true },
  });
  expect(
    await db.prisma.user.findUnique({ where: { id: sonda.id } }),
    'A aplicação não está ligada à base de dados temporária. O DATABASE_URL não foi aplicado antes de a app ser importada.',
  ).not.toBeNull();
  await appPrisma.user.deleteMany();
}, 120_000);

afterAll(async () => {
  await appPrisma.$disconnect();
  await db.destroy();
});

beforeEach(async () => {
  token = await signup(`financeiro-${Math.random().toString(36).slice(2, 10)}@zemlo.test`);
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

function post(url: string, session: string, body: Record<string, unknown>) {
  return request(app)
    .post(url)
    .set('Authorization', `Bearer ${session}`)
    .set('Content-Type', 'application/json')
    .send(body);
}

function auth(method: 'get' | 'patch' | 'delete', url: string, session: string) {
  return request(app)[method](url).set('Authorization', `Bearer ${session}`);
}

async function createVehicle(session: string = token): Promise<string> {
  const response = await post('/api/v1/vehicles', session, { plate: 'AA-00-AA' });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.id as string;
}

async function listExpenses(session: string = token) {
  const response = await auth('get', '/api/v1/records/expenses', session);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as { items: Array<Record<string, unknown>>; total: number };
}

/** Um abastecimento atestado. Devolve o corpo da resposta. */
async function addFuel(
  vehicleId: string,
  fuel: { date: string; litres: number; odometerKm: number | null; fullTank?: boolean },
  session: string = token,
) {
  const response = await post('/api/v1/records/fuel', session, {
    vehicleId,
    date: fuel.date,
    litres: fuel.litres,
    amountCents: Math.round(fuel.litres * 170),
    odometerKm: fuel.odometerKm,
    fullTank: fuel.fullTank ?? true,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body as Record<string, unknown>;
}

/** Um carregamento. Devolve o corpo da resposta. */
async function addCharging(
  vehicleId: string,
  charging: {
    date: string;
    energyKwh: number;
    amountCents: number;
    odometerKm: number | null;
    durationMinutes?: number;
    startSocPercent?: number;
    endSocPercent?: number;
  },
  session: string = token,
) {
  const response = await post('/api/v1/records/charging', session, { vehicleId, ...charging });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body as Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Despesas (§12)                                                              */
/* -------------------------------------------------------------------------- */

describe('despesas · percurso completo', () => {
  it('cria, lê, edita e apaga, e o estado acompanha cada passo', async () => {
    // Uma despesa exige que a conta tenha pelo menos um veículo: a API recusa registar
    // custos numa conta sem veículos, porque não haveria a que os atribuir (§12).
    await createVehicle();

    const criada = await post('/api/v1/records/expenses', token, {
      amountCents: 4500,
      category: 'tolls',
      vendor: 'Via Verde',
    });
    expect(criada.status, JSON.stringify(criada.body)).toBe(201);
    const id = criada.body.id as string;

    const lida = await auth('get', `/api/v1/records/expenses/${id}`, token);
    expect(lida.status).toBe(200);
    expect(lida.body.amountCents).toBe(4500);

    const editada = await auth('patch', `/api/v1/records/expenses/${id}`, token)
      .set('Content-Type', 'application/json')
      .send({ amountCents: 5000 });
    expect(editada.status, JSON.stringify(editada.body)).toBe(200);
    expect(editada.body.amountCents).toBe(5000);

    const apagada = await auth('delete', `/api/v1/records/expenses/${id}`, token);
    expect(apagada.status).toBe(204);

    expect((await auth('get', `/api/v1/records/expenses/${id}`, token)).status).toBe(404);
  });

  it('a lista inclui a despesa e conta-a', async () => {
    await createVehicle();
    await post('/api/v1/records/expenses', token, { amountCents: 1234, category: 'wash' });

    const lista = await listExpenses();
    expect(lista.total).toBe(1);
    expect(lista.items).toHaveLength(1);
    expect(lista.items[0]?.amountCents).toBe(1234);
  });

  it('recusa o que o contrato recusa, com 422', async () => {
    await createVehicle();

    const INVALIDAS: Array<[string, Record<string, unknown>]> = [
      ['valor zero', { amountCents: 0, category: 'tolls' }],
      ['valor negativo', { amountCents: -100, category: 'tolls' }],
      ['categoria inexistente', { amountCents: 100, category: 'nao-existe' }],
      ['sem categoria', { amountCents: 100 }],
    ];

    for (const [nome, corpo] of INVALIDAS) {
      const response = await post('/api/v1/records/expenses', token, corpo);
      expect(response.status, `${nome}: ${JSON.stringify(response.body)}`).toBe(422);
    }

    expect((await listExpenses()).total).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Abastecimentos (§13)                                                        */
/* -------------------------------------------------------------------------- */

describe('abastecimentos · percurso e derivadas', () => {
  it('calcula o consumo do intervalo atestado', async () => {
    const vehicleId = await createVehicle();
    await addFuel(vehicleId, { date: '2026-01-01', litres: 40, odometerKm: 10_000 });
    const segundo = await addFuel(vehicleId, { date: '2026-02-01', litres: 30, odometerKm: 10_500 });

    // 30 L em 500 km = 6,00 L/100 km. O valor é afirmado tal como a API o devolve.
    const derivadas = segundo.derived as { consumptionL100Km: number | null };
    expect(derivadas.consumptionL100Km).toBe(6);
  });

  it('cria a despesa ligada e apaga-a com o abastecimento', async () => {
    const vehicleId = await createVehicle();
    const abastecimento = await addFuel(vehicleId, {
      date: '2026-01-01',
      litres: 40,
      odometerKm: 10_000,
    });

    const comDespesa = await listExpenses();
    expect(comDespesa.total).toBe(1);
    // O contrato público de `Expense` expõe `category` e `linkedRecordId` — o
    // `linkedRecordType` existe na base de dados mas não sai na resposta (é interno, usado pela
    // navegação reversa). Afirmar o que a API promete, não o que ela guarda.
    expect(comDespesa.items[0]?.category).toBe('fuel');
    expect(comDespesa.items[0]?.linkedRecordId).toBe(abastecimento.id);

    const apagado = await auth('delete', `/api/v1/records/fuel/${abastecimento.id}`, token);
    expect(apagado.status).toBe(204);

    // A despesa ligada não pode sobreviver: duplicaria o custo por km.
    expect((await listExpenses()).total).toBe(0);
  });

  it('recusa litros não positivos com 422', async () => {
    const vehicleId = await createVehicle();
    for (const litres of [0, -5]) {
      const response = await post('/api/v1/records/fuel', token, {
        vehicleId,
        litres,
        amountCents: 5000,
      });
      expect(response.status, `litros=${litres}`).toBe(422);
    }
  });

  it('edita e apaga o abastecimento, e o estado acompanha cada passo', async () => {
    const vehicleId = await createVehicle();
    const criado = await addFuel(vehicleId, { date: '2026-01-01', litres: 40, odometerKm: 10_000 });

    const editado = await auth('patch', `/api/v1/records/fuel/${criado.id}`, token)
      .set('Content-Type', 'application/json')
      .send({ station: 'Galp' });
    expect(editado.status, JSON.stringify(editado.body)).toBe(200);
    expect(editado.body.station).toBe('Galp');

    const apagado = await auth('delete', `/api/v1/records/fuel/${criado.id}`, token);
    expect(apagado.status).toBe(204);
    expect((await auth('get', `/api/v1/records/fuel/${criado.id}`, token)).status).toBe(404);
  });
});

/* -------------------------------------------------------------------------- */
/* Carregamentos (§14)                                                         */
/* -------------------------------------------------------------------------- */

describe('carregamentos · percurso e derivadas', () => {
  it('devolve as derivadas já calculadas na criação', async () => {
    const vehicleId = await createVehicle();
    await addCharging(vehicleId, {
      date: '2026-01-01',
      energyKwh: 40,
      amountCents: 1200,
      odometerKm: 10_000,
      durationMinutes: 120,
      startSocPercent: 20,
      endSocPercent: 70,
    });
    const segundo = await addCharging(vehicleId, {
      date: '2026-02-01',
      energyKwh: 50,
      amountCents: 1500,
      odometerKm: 10_500,
      durationMinutes: 60,
      startSocPercent: 30,
      endSocPercent: 80,
    });

    // As derivadas vêm no objeto `derived` da resposta (tal como o consumo dos
    // abastecimentos): 500 km desde o carregamento anterior, 50 kWh em 500 km = 10 kWh/100 km,
    // 1500 cêntimos em 500 km = 300 cêntimos/100 km, 30 %→80 % = 50 pontos, 50 kWh em 1 h = 50 kW.
    const derivadas = segundo.derived as {
      distanceSincePreviousKm: number | null;
      consumptionKwh100Km: number | null;
      costPer100KmCents: number | null;
      addedSocPercent: number | null;
      averagePowerKw: number | null;
    };
    expect(derivadas.distanceSincePreviousKm).toBe(500);
    expect(derivadas.consumptionKwh100Km).toBe(10);
    expect(derivadas.costPer100KmCents).toBe(300);
    expect(derivadas.addedSocPercent).toBe(50);
    expect(derivadas.averagePowerKw).toBe(50);
  });

  it('a leitura seguinte concorda com a criação', async () => {
    const vehicleId = await createVehicle();
    await addCharging(vehicleId, {
      date: '2026-01-01',
      energyKwh: 40,
      amountCents: 1200,
      odometerKm: 10_000,
      durationMinutes: 120,
      startSocPercent: 20,
      endSocPercent: 70,
    });
    const criado = await addCharging(vehicleId, {
      date: '2026-02-01',
      energyKwh: 50,
      amountCents: 1500,
      odometerKm: 10_500,
      durationMinutes: 60,
      startSocPercent: 30,
      endSocPercent: 80,
    });

    const lido = await auth('get', `/api/v1/records/charging/${criado.id}`, token);
    expect(lido.status).toBe(200);
    const criadas = criado.derived as Record<string, unknown>;
    const lidas = lido.body.derived as Record<string, unknown>;
    expect(lidas.consumptionKwh100Km).toBe(criadas.consumptionKwh100Km);
    expect(lidas.costPer100KmCents).toBe(criadas.costPer100KmCents);
    expect(lidas.distanceSincePreviousKm).toBe(criadas.distanceSincePreviousKm);
  });

  it('recusa energia não positiva e custo negativo com 422', async () => {
    const vehicleId = await createVehicle();
    const INVALIDOS: Array<[string, Record<string, unknown>]> = [
      ['energia zero', { energyKwh: 0, amountCents: 1000 }],
      ['energia negativa', { energyKwh: -1, amountCents: 1000 }],
      ['custo negativo', { energyKwh: 10, amountCents: -1 }],
    ];

    for (const [nome, corpo] of INVALIDOS) {
      const response = await post('/api/v1/records/charging', token, { vehicleId, ...corpo });
      expect(response.status, `${nome}: ${JSON.stringify(response.body)}`).toBe(422);
    }
  });

  it('edita e apaga o carregamento, e o estado acompanha cada passo', async () => {
    const vehicleId = await createVehicle();
    const criado = await addCharging(vehicleId, {
      date: '2026-01-01',
      energyKwh: 40,
      amountCents: 1200,
      odometerKm: 10_000,
    });

    const editado = await auth('patch', `/api/v1/records/charging/${criado.id}`, token)
      .set('Content-Type', 'application/json')
      .send({ location: 'Casa' });
    expect(editado.status, JSON.stringify(editado.body)).toBe(200);
    expect(editado.body.location).toBe('Casa');

    const apagado = await auth('delete', `/api/v1/records/charging/${criado.id}`, token);
    expect(apagado.status).toBe(204);
    expect((await auth('get', `/api/v1/records/charging/${criado.id}`, token)).status).toBe(404);
  });
});

/* -------------------------------------------------------------------------- */
/* Autenticação                                                                */
/* -------------------------------------------------------------------------- */

describe('registos financeiros · autenticação', () => {
  const ROTAS: Array<[string, string]> = [
    ['get', '/api/v1/records/expenses'],
    ['get', '/api/v1/records/fuel'],
    ['get', '/api/v1/records/charging'],
    ['get', '/api/v1/records/expenses/nao-existe'],
    ['get', '/api/v1/records/fuel/nao-existe'],
    ['get', '/api/v1/records/charging/nao-existe'],
  ];

  it.each(ROTAS)('exige sessão em %s %s', async (metodo, url) => {
    const response = await request(app)[metodo as 'get'](url);
    expect(response.status).toBe(401);
  });

  it('recusa um token inválido', async () => {
    const response = await request(app)
      .get('/api/v1/records/expenses')
      .set('Authorization', 'Bearer nao-e-um-token');
    expect(response.status).toBe(401);
  });

  it('recusa criar sem sessão', async () => {
    const response = await request(app)
      .post('/api/v1/records/expenses')
      .set('Content-Type', 'application/json')
      .send({ amountCents: 100, category: 'tolls' });
    expect(response.status).toBe(401);
  });
});

/* -------------------------------------------------------------------------- */
/* Isolamento entre contas                                                     */
/* -------------------------------------------------------------------------- */

describe('registos financeiros · isolamento entre contas', () => {
  let vehicleId: string;
  let despesaId: string;
  let abastecimentoId: string;
  let carregamentoId: string;
  let outraSessao: string;

  beforeEach(async () => {
    vehicleId = await createVehicle();

    const despesa = await post('/api/v1/records/expenses', token, {
      amountCents: 2000,
      category: 'parking',
    });
    despesaId = despesa.body.id as string;

    abastecimentoId = (await addFuel(vehicleId, {
      date: '2026-01-01',
      litres: 40,
      odometerKm: 10_000,
    })).id as string;

    carregamentoId = (await addCharging(vehicleId, {
      date: '2026-01-02',
      energyKwh: 20,
      amountCents: 600,
      odometerKm: 10_100,
    })).id as string;

    outraSessao = await signup(`intruso-${Math.random().toString(36).slice(2, 10)}@zemlo.test`);
  });

  it('a lista de outra conta está vazia', async () => {
    expect((await listExpenses(outraSessao)).total).toBe(0);
    const fuel = await auth('get', '/api/v1/records/fuel', outraSessao);
    expect(fuel.body.total).toBe(0);
    const charging = await auth('get', '/api/v1/records/charging', outraSessao);
    expect(charging.body.total).toBe(0);
  });

  const ALHEIOS: Array<[string, () => string]> = [
    ['expenses', () => '/api/v1/records/expenses'],
    ['fuel', () => '/api/v1/records/fuel'],
    ['charging', () => '/api/v1/records/charging'],
  ];

  it.each(ALHEIOS)('ler %s alheio dá 404', async (recurso, base) => {
    const id = recurso === 'expenses' ? despesaId : recurso === 'fuel' ? abastecimentoId : carregamentoId;
    const response = await auth('get', `${base()}/${id}`, outraSessao);
    expect(response.status).toBe(404);
  });

  it.each(ALHEIOS)('editar %s alheio dá 404 e não altera', async (recurso, base) => {
    const id = recurso === 'expenses' ? despesaId : recurso === 'fuel' ? abastecimentoId : carregamentoId;
    const response = await auth('patch', `${base()}/${id}`, outraSessao)
      .set('Content-Type', 'application/json')
      .send({ notes: 'roubado' });

    expect(response.status).toBe(404);

    const doDono = await auth('get', `${base()}/${id}`, token);
    expect(doDono.status).toBe(200);
    expect(JSON.stringify(doDono.body)).not.toContain('roubado');
  });

  it.each(ALHEIOS)('apagar %s alheio dá 404 e ele continua a existir', async (recurso, base) => {
    const id = recurso === 'expenses' ? despesaId : recurso === 'fuel' ? abastecimentoId : carregamentoId;
    const response = await auth('delete', `${base()}/${id}`, outraSessao);
    expect(response.status).toBe(404);

    expect((await auth('get', `${base()}/${id}`, token)).status).toBe(200);
  });

  it('não deixa acrescentar um registo a um veículo alheio', async () => {
    const response = await post('/api/v1/records/fuel', outraSessao, {
      vehicleId,
      litres: 10,
      amountCents: 1700,
    });

    expect(response.status).toBe(404);
    // E o dono não ganhou nada.
    const doDono = await auth('get', '/api/v1/records/fuel', token);
    expect(doDono.body.total).toBe(1);
  });
});
