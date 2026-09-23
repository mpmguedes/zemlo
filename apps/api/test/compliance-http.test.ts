/**
 * Rotas de conformidade pela fronteira HTTP (`TEST-001`).
 *
 * ## Porque é que esta suite existe
 *
 * `http/routes/compliance.ts` tem 20 rotas — manutenção, seguro, inspeções e impostos — e
 * **zero** cobertura em `npm test` antes deste ficheiro. São as áreas com datas legais e prazos
 * (inspeção, IUC, seguro), onde um erro silencioso custa dinheiro ao utilizador.
 *
 * ## O que é que estes testes provam
 *
 *  - **percurso completo** dos quatro recursos: criar, ler, editar, apagar, e a lista;
 *  - **validação** — o que o contrato recusa devolve 422 e não é gravado;
 *  - **autenticação** — 401 sem sessão e com token inválido;
 *  - **isolamento entre contas** — 404 para registos alheios, sem os alterar;
 *  - **a ligação à manutenção preventiva (§16)** — uma manutenção com `intervalMonths` cria o
 *    lembrete da próxima intervenção, sem que ninguém o peça. É a promessa que distingue o
 *    Zemlo de um livro de despesas, e é verificada aqui de ponta a ponta.
 *
 * ## Porque é que os quatro recursos partilham uma tabela
 *
 * Os quatro têm exatamente a mesma forma de rota e as mesmas garantias transversais. Descrevê-los
 * numa tabela evita quatro blocos quase iguais — mas os dados de cada um (payload válido, campo
 * editado, entradas inválidas) são **explícitos e distintos**, para que cada caso morda aquilo
 * que diz morder. Uma abstração que tornasse os quatro intercambiáveis não provaria nada sobre
 * nenhum.
 *
 * ## A base de dados
 *
 * `DATABASE_URL` antes do import da aplicação, base temporária fora do repositório, destruída no
 * fim, conta própria por teste — como em `documents-http.test.ts`.
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
    data: { email: 'sonda-conformidade@zemlo.test', name: 'Sonda' },
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
  token = await signup(`conformidade-${Math.random().toString(36).slice(2, 10)}@zemlo.test`);
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

/* -------------------------------------------------------------------------- */
/* Os quatro recursos                                                          */
/* -------------------------------------------------------------------------- */

interface Recurso {
  nome: string;
  base: string;
  /** Payload válido. `vehicleId` é acrescentado pelo teste. */
  valido: Record<string, unknown>;
  /** Alteração válida, e o campo que ela deve mudar. */
  edicao: Record<string, unknown>;
  campoEditado: string;
  valorEditado: unknown;
  invalidos: Array<[string, Record<string, unknown>]>;
}

const RECURSOS: Recurso[] = [
  {
    nome: 'manutenção',
    base: '/api/v1/records/maintenance',
    valido: { type: 'service', amountCents: 12_000, workshop: 'Oficina Central', odometerKm: 50_000 },
    edicao: { workshop: 'Oficina Nova' },
    campoEditado: 'workshop',
    valorEditado: 'Oficina Nova',
    invalidos: [
      ['tipo inexistente', { type: 'nao-existe' }],
      ['data impossível', { date: '2026-02-30' }],
      ['quilometragem negativa', { odometerKm: -1 }],
      ['valor negativo', { amountCents: -1 }],
    ],
  },
  {
    nome: 'seguro',
    base: '/api/v1/records/insurance',
    valido: {
      insurer: 'Seguradora X',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      premiumCents: 30_000,
    },
    edicao: { insurer: 'Seguradora Y' },
    campoEditado: 'insurer',
    valorEditado: 'Seguradora Y',
    invalidos: [
      ['sem seguradora', { insurer: undefined }],
      ['seguradora vazia', { insurer: '' }],
      ['sem data de início', { startDate: undefined }],
      ['data impossível', { startDate: '2026-02-30' }],
      ['cobertura inexistente', { coverage: 'nao-existe' }],
    ],
  },
  {
    nome: 'inspeção',
    base: '/api/v1/records/inspections',
    valido: { date: '2026-03-01', result: 'passed', station: 'Centro de Inspeções' },
    edicao: { station: 'Outro Centro' },
    campoEditado: 'station',
    valorEditado: 'Outro Centro',
    invalidos: [
      ['sem data', { date: undefined }],
      ['data impossível', { date: '2026-02-30' }],
      ['resultado inexistente', { result: 'nao-existe' }],
      ['quilometragem negativa', { odometerKm: -1 }],
    ],
  },
  {
    nome: 'imposto',
    base: '/api/v1/records/taxes',
    valido: { year: 2026, amountCents: 15_000, kind: 'iuc' },
    edicao: { amountCents: 16_000 },
    campoEditado: 'amountCents',
    valorEditado: 16_000,
    invalidos: [
      ['ano anterior ao permitido', { year: 1800 }],
      ['sem valor', { amountCents: undefined }],
      ['tipo inexistente', { kind: 'nao-existe' }],
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Percurso completo                                                           */
/* -------------------------------------------------------------------------- */

describe.each(RECURSOS)('$nome · percurso completo', (recurso) => {
  it('cria, lê, edita e apaga, e o estado acompanha cada passo', async () => {
    const vehicleId = await createVehicle();

    const criado = await post(recurso.base, token, { vehicleId, ...recurso.valido });
    expect(criado.status, JSON.stringify(criado.body)).toBe(201);
    const id = criado.body.id as string;

    const lido = await auth('get', `${recurso.base}/${id}`, token);
    expect(lido.status, JSON.stringify(lido.body)).toBe(200);

    const editado = await auth('patch', `${recurso.base}/${id}`, token)
      .set('Content-Type', 'application/json')
      .send(recurso.edicao);
    expect(editado.status, JSON.stringify(editado.body)).toBe(200);
    expect(editado.body[recurso.campoEditado]).toBe(recurso.valorEditado);

    const apagado = await auth('delete', `${recurso.base}/${id}`, token);
    expect(apagado.status).toBe(204);

    expect((await auth('get', `${recurso.base}/${id}`, token)).status).toBe(404);
  });

  it('a lista inclui o registo criado e conta-o', async () => {
    const vehicleId = await createVehicle();
    const criado = await post(recurso.base, token, { vehicleId, ...recurso.valido });
    expect(criado.status, JSON.stringify(criado.body)).toBe(201);

    const lista = await auth('get', recurso.base, token);
    expect(lista.status).toBe(200);
    expect(lista.body.total).toBe(1);
    expect(lista.body.items.map((item: { id: string }) => item.id)).toContain(criado.body.id);
  });
});

/* -------------------------------------------------------------------------- */
/* Validação                                                                   */
/* -------------------------------------------------------------------------- */

describe.each(RECURSOS)('$nome · validação', (recurso) => {
  it.each(recurso.invalidos)('recusa %s com 422', async (_nome, corpo) => {
    const vehicleId = await createVehicle();
    const response = await post(recurso.base, token, { vehicleId, ...recurso.valido, ...corpo });

    expect(response.status, JSON.stringify(response.body)).toBe(422);
  });

  it('não grava nada quando a validação falha', async () => {
    const vehicleId = await createVehicle();
    const [, corpo] = recurso.invalidos[0] as [string, Record<string, unknown>];

    await post(recurso.base, token, { vehicleId, ...recurso.valido, ...corpo });

    const lista = await auth('get', recurso.base, token);
    expect(lista.body.total).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Autenticação                                                                */
/* -------------------------------------------------------------------------- */

describe.each(RECURSOS)('$nome · autenticação', (recurso) => {
  it('exige sessão na lista', async () => {
    expect((await request(app).get(recurso.base)).status).toBe(401);
  });

  it('devolve 401 e não 404 para um id inexistente e sem sessão', async () => {
    const response = await request(app).get(`${recurso.base}/nao-existe`);
    expect(response.status).toBe(401);
  });

  it('recusa um token inválido', async () => {
    const response = await request(app)
      .get(recurso.base)
      .set('Authorization', 'Bearer nao-e-um-token');
    expect(response.status).toBe(401);
  });

  it('recusa criar sem sessão', async () => {
    const response = await request(app)
      .post(recurso.base)
      .set('Content-Type', 'application/json')
      .send(recurso.valido);
    expect(response.status).toBe(401);
  });
});

/* -------------------------------------------------------------------------- */
/* Isolamento entre contas                                                     */
/* -------------------------------------------------------------------------- */

describe.each(RECURSOS)('$nome · isolamento entre contas', (recurso) => {
  let idDoDono: string;
  let outraSessao: string;

  beforeEach(async () => {
    const vehicleId = await createVehicle();
    const criado = await post(recurso.base, token, { vehicleId, ...recurso.valido });
    expect(criado.status, JSON.stringify(criado.body)).toBe(201);
    idDoDono = criado.body.id as string;

    outraSessao = await signup(`intruso-${Math.random().toString(36).slice(2, 10)}@zemlo.test`);
  });

  it('a lista de outra conta está vazia', async () => {
    const lista = await auth('get', recurso.base, outraSessao);
    expect(lista.status).toBe(200);
    expect(lista.body.total).toBe(0);
  });

  it('ler o registo alheio dá 404 e não 403', async () => {
    const response = await auth('get', `${recurso.base}/${idDoDono}`, outraSessao);
    expect(response.status).toBe(404);
  });

  it('editar o registo alheio dá 404 e não o altera', async () => {
    const response = await auth('patch', `${recurso.base}/${idDoDono}`, outraSessao)
      .set('Content-Type', 'application/json')
      .send(recurso.edicao);

    expect(response.status).toBe(404);

    const doDono = await auth('get', `${recurso.base}/${idDoDono}`, token);
    expect(doDono.status).toBe(200);
    expect(doDono.body[recurso.campoEditado]).not.toBe(recurso.valorEditado);
  });

  it('apagar o registo alheio dá 404 e ele continua a existir', async () => {
    const response = await auth('delete', `${recurso.base}/${idDoDono}`, outraSessao);
    expect(response.status).toBe(404);

    expect((await auth('get', `${recurso.base}/${idDoDono}`, token)).status).toBe(200);
  });
});

/* -------------------------------------------------------------------------- */
/* Manutenção preventiva (§16) — a promessa do produto                         */
/* -------------------------------------------------------------------------- */

describe('manutenção preventiva · o lembrete nasce com a manutenção', () => {
  it('uma manutenção com intervalo cria o lembrete da próxima intervenção', async () => {
    const vehicleId = await createVehicle();

    const antes = await auth('get', '/api/v1/reminders', token);
    expect(antes.status).toBe(200);
    expect(antes.body.total).toBe(0);

    const criada = await post('/api/v1/records/maintenance', token, {
      vehicleId,
      type: 'oil',
      date: '2026-01-15',
      odometerKm: 50_000,
      intervalMonths: 12,
      intervalKm: 15_000,
    });
    expect(criada.status, JSON.stringify(criada.body)).toBe(201);

    const depois = await auth('get', '/api/v1/reminders', token);
    expect(depois.status).toBe(200);
    expect(depois.body.total).toBe(1);
    expect(depois.body.items[0]?.vehicleId).toBe(vehicleId);
  });

  it('uma manutenção sem intervalo não cria lembrete nenhum', async () => {
    const vehicleId = await createVehicle();

    const criada = await post('/api/v1/records/maintenance', token, {
      vehicleId,
      type: 'brakes',
      amountCents: 9000,
    });
    expect(criada.status, JSON.stringify(criada.body)).toBe(201);

    const lembretes = await auth('get', '/api/v1/reminders', token);
    expect(lembretes.body.total).toBe(0);
  });
});
