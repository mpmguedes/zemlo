/**
 * Rotas de veículos pela fronteira HTTP (`TEST-001`).
 *
 * ## Porque é que esta suite existe
 *
 * Antes de a escrever, `apps/api/src/http/routes/vehicles.ts` **não tinha um único ficheiro
 * de teste** em `npm test`. A verificação existia — mas só em `verify.ts` e `verify:auth`, que
 * exigem um servidor a correr e uma base de dados semeada, e que por isso **não correm
 * automaticamente**. Um commit que partisse a criação de veículos passava `npm test` a 100%.
 *
 * ## O que é que estes testes provam
 *
 *  - **percurso completo** — criar, ler, editar e apagar, pelo contrato público, e o estado
 *    observável a cada passo (não o código que o produziu);
 *  - **quilometragem** — o endpoint do veículo e o de conveniência (§5, onboarding);
 *  - **validação** — a API recusa o que o contrato recusa (422), em vez de gravar lixo;
 *  - **autenticação** — sem sessão e com token inválido, 401. E 401 **mesmo para um id que não
 *    existe**: a autenticação é avaliada antes da existência, pelo que a resposta não revela
 *    se o veículo existe;
 *  - **isolamento entre contas** — outra conta autenticada recebe **404** (e não 403) para um
 *    veículo alheio: um 403 confirmaria que ele existe. O veículo do dono fica intacto.
 *
 * ## O que estes testes não fazem
 *
 * Não reimplementam a lógica que vigiam (`AUD-004`): tudo passa por `createApp()` e pelo
 * contrato HTTP. Não substituem a base de dados nem os serviços — é a cadeia inteira que é
 * exercida, que é o que dá valor a um teste de rota.
 *
 * ## A base de dados
 *
 * Como em `documents-http.test.ts` e `fuel-consumption-http.test.ts`: a `DATABASE_URL` é
 * definida **antes** de a aplicação ser importada, porque o `core/db.ts` instancia o cliente
 * no import. A base é temporária, vive fora do repositório e é destruída no fim — mesmo que um
 * teste falhe. Cada teste cria a sua própria conta, para não depender da ordem de limpeza das
 * tabelas com chaves estrangeiras.
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
    data: { email: 'sonda-veiculos@zemlo.test', name: 'Sonda' },
    select: { id: true },
  });
  expect(
    await db.prisma.user.findUnique({ where: { id: sonda.id } }),
    'A aplicação não está ligada à base de dados temporária. O DATABASE_URL não foi aplicado antes de a app ser importada.',
  ).not.toBeNull();
  await appPrisma.user.deleteMany();
}, 120_000);

afterAll(async () => {
  // Fechar o cliente da aplicação primeiro: no Windows, o ficheiro SQLite aberto impediria a
  // remoção do directório com `EBUSY`.
  await appPrisma.$disconnect();
  await db.destroy();
});

beforeEach(async () => {
  token = await signup(`veiculos-${Math.random().toString(36).slice(2, 10)}@zemlo.test`);
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

/** Cria um veículo pela rota e devolve o `id`. Falha alto se a rota recusar. */
async function createVehicle(
  body: Record<string, unknown> = {},
  session: string = token,
): Promise<string> {
  const response = await request(app)
    .post('/api/v1/vehicles')
    .set('Authorization', `Bearer ${session}`)
    .set('Content-Type', 'application/json')
    .send({ plate: 'AA-00-AA', ...body });

  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.id as string;
}

function auth(method: 'get' | 'patch' | 'delete', url: string, session: string) {
  return request(app)[method](url).set('Authorization', `Bearer ${session}`);
}

/* -------------------------------------------------------------------------- */
/* Percurso completo                                                           */
/* -------------------------------------------------------------------------- */

describe('veículos · percurso completo', () => {
  it('criar devolve 201 com o Location do recurso novo', async () => {
    // O `Location` é parte do contrato de criação: é o que permite ao cliente seguir o
    // recurso sem o construir ele próprio. Sem esta asserção, remover o cabeçalho da rota
    // não fazia falhar nada (medido por mutação — ver `TEST-001`).
    const response = await request(app)
      .post('/api/v1/vehicles')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ plate: 'AA-00-XX' });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.headers.location).toBe(`/api/v1/vehicles/${response.body.id}`);
  });

  it('cria, lê, edita e apaga, e o estado acompanha cada passo', async () => {
    const id = await createVehicle({ plate: 'AA-11-BB', make: 'Renault', model: 'Clio' });

    const lido = await auth('get', `/api/v1/vehicles/${id}`, token);
    expect(lido.status, JSON.stringify(lido.body)).toBe(200);
    expect(lido.body.plate ?? lido.body.vehicle?.plate).toBeDefined();

    const editado = await auth('patch', `/api/v1/vehicles/${id}`, token)
      .set('Content-Type', 'application/json')
      .send({ nickname: 'O pequeno' });
    expect(editado.status, JSON.stringify(editado.body)).toBe(200);

    const apagado = await auth('delete', `/api/v1/vehicles/${id}`, token);
    expect(apagado.status).toBe(204);

    const depois = await auth('get', `/api/v1/vehicles/${id}`, token);
    expect(depois.status).toBe(404);
  });

  it('a lista inclui o veículo criado e conta-o', async () => {
    const id = await createVehicle({ plate: 'CC-22-DD' });

    const lista = await auth('get', '/api/v1/vehicles', token);
    expect(lista.status).toBe(200);
    expect(lista.body.items.map((item: { id: string }) => item.id)).toContain(id);
    expect(lista.body.total).toBe(lista.body.items.length);
  });

  it('regista quilometragem pelo veículo e pelo atalho de onboarding', async () => {
    const id = await createVehicle({ plate: 'EE-33-FF' });

    const peloVeiculo = await request(app)
      .post(`/api/v1/vehicles/${id}/odometer`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ odometerKm: 120_000 });
    expect(peloVeiculo.status, JSON.stringify(peloVeiculo.body)).toBe(201);

    const leituras = await auth('get', `/api/v1/vehicles/${id}/odometer`, token);
    expect(leituras.status).toBe(200);
    expect(leituras.body.items.length).toBeGreaterThanOrEqual(1);

    // O atalho resolve o veículo sozinho: o utilizador não sabe que existe um id (§5).
    const peloAtalho = await request(app)
      .post('/api/v1/odometer')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ odometerKm: 120_500 });
    expect(peloAtalho.status, JSON.stringify(peloAtalho.body)).toBe(201);
    expect(peloAtalho.body.vehicleId).toBe(id);
  });
});

/* -------------------------------------------------------------------------- */
/* Validação                                                                   */
/* -------------------------------------------------------------------------- */

describe('veículos · validação recusa o que o contrato recusa', () => {
  const INVALIDOS: Array<[string, Record<string, unknown>]> = [
    ['sem matrícula', { plate: undefined }],
    ['matrícula de um caracter', { plate: 'A' }],
    ['ano anterior ao automóvel', { year: 1800 }],
    ['ano no futuro distante', { year: 2200 }],
    ['quilometragem negativa', { odometerKm: -1 }],
    ['VIN com forma impossível', { vin: 'ABC' }],
    ['potência negativa', { powerCv: -10 }],
  ];

  it.each(INVALIDOS)('recusa %s com 422', async (_nome, corpo) => {
    const response = await request(app)
      .post('/api/v1/vehicles')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ plate: 'AA-00-AA', ...corpo });

    expect(response.status, JSON.stringify(response.body)).toBe(422);
  });

  it('não grava nada quando a validação falha', async () => {
    await request(app)
      .post('/api/v1/vehicles')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ plate: 'A' });

    const lista = await auth('get', '/api/v1/vehicles', token);
    expect(lista.body.items).toHaveLength(0);
  });

  it('recusa uma quilometragem negativa no registo de odómetro', async () => {
    const id = await createVehicle({ plate: 'GG-44-HH' });

    const response = await request(app)
      .post(`/api/v1/vehicles/${id}/odometer`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ odometerKm: -5 });

    expect(response.status, JSON.stringify(response.body)).toBe(422);
  });
});

/* -------------------------------------------------------------------------- */
/* Autenticação                                                                */
/* -------------------------------------------------------------------------- */

describe('veículos · autenticação', () => {
  it('exige sessão', async () => {
    const response = await request(app).get('/api/v1/vehicles');
    expect(response.status).toBe(401);
  });

  it('recusa um token inválido', async () => {
    const response = await request(app)
      .get('/api/v1/vehicles')
      .set('Authorization', 'Bearer nao-e-um-token');
    expect(response.status).toBe(401);
  });

  it('devolve 401 e não 404 para um id inexistente e sem sessão', async () => {
    // O endereço existe e é protegido: a resposta não pode revelar se o veículo existe.
    const response = await request(app).get('/api/v1/vehicles/nao-existe');
    expect(response.status).toBe(401);
  });

  it('recusa criar sem sessão', async () => {
    const response = await request(app)
      .post('/api/v1/vehicles')
      .set('Content-Type', 'application/json')
      .send({ plate: 'II-55-JJ' });

    expect(response.status).toBe(401);
  });
});

/* -------------------------------------------------------------------------- */
/* Isolamento entre contas                                                     */
/* -------------------------------------------------------------------------- */

describe('veículos · isolamento entre contas', () => {
  let idDoDono: string;
  let outraSessao: string;

  beforeEach(async () => {
    idDoDono = await createVehicle({ plate: 'KK-66-LL' });
    outraSessao = await signup(`intruso-${Math.random().toString(36).slice(2, 10)}@zemlo.test`);
  });

  it('a lista de outra conta não contém o veículo alheio', async () => {
    const lista = await auth('get', '/api/v1/vehicles', outraSessao);
    expect(lista.status).toBe(200);
    expect(lista.body.items).toHaveLength(0);
  });

  it('ler um veículo alheio dá 404 e não 403', async () => {
    // 403 confirmaria que o veículo existe; 404 não diz nada a quem não é dono.
    const response = await auth('get', `/api/v1/vehicles/${idDoDono}`, outraSessao);
    expect(response.status).toBe(404);
  });

  it('editar um veículo alheio dá 404 e não o altera', async () => {
    const response = await auth('patch', `/api/v1/vehicles/${idDoDono}`, outraSessao)
      .set('Content-Type', 'application/json')
      .send({ nickname: 'roubado' });

    expect(response.status).toBe(404);

    const doDono = await auth('get', `/api/v1/vehicles/${idDoDono}`, token);
    expect(doDono.status).toBe(200);
    expect(JSON.stringify(doDono.body)).not.toContain('roubado');
  });

  it('apagar um veículo alheio dá 404 e ele continua a existir', async () => {
    const response = await auth('delete', `/api/v1/vehicles/${idDoDono}`, outraSessao);
    expect(response.status).toBe(404);

    const doDono = await auth('get', `/api/v1/vehicles/${idDoDono}`, token);
    expect(doDono.status).toBe(200);
  });

  it('registar quilometragem num veículo alheio dá 404', async () => {
    const response = await request(app)
      .post(`/api/v1/vehicles/${idDoDono}/odometer`)
      .set('Authorization', `Bearer ${outraSessao}`)
      .set('Content-Type', 'application/json')
      .send({ odometerKm: 999_999 });

    expect(response.status).toBe(404);

    // E não ficou lá nada.
    const leituras = await auth('get', `/api/v1/vehicles/${idDoDono}/odometer`, token);
    expect(leituras.body.items).toHaveLength(0);
  });
});
