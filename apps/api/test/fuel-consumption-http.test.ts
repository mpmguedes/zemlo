/**
 * Consumo de combustível pela fronteira HTTP (A8, §13).
 *
 * ## Porque é que esta suite existe
 *
 * `domain.test.ts` prova a regra de A8 na função pura e no agregado `consumptionSummary`.
 * Nenhuma das duas responde à pergunta que interessa a quem usa o produto — *"o número que o
 * painel me mostra está certo?"* — porque entre a função e o ecrã ficam o serviço de análise,
 * o mapeamento da resposta e a rota.
 *
 * Esta suite sobe a aplicação a sério (`createApp()`), cria os abastecimentos pelo contrato
 * público (`POST /records/fuel`) e lê o resultado pelo contrato público (`GET /dashboard`,
 * `GET /stats`). Se a acumulação dos abastecimentos parciais se perder em qualquer elo da
 * cadeia, estes testes falham. É a prova de que a correção chega ao cliente.
 *
 * ## O que é que estes testes provam
 *
 *  - o painel devolve o consumo **acumulado** (6,00 L/100 km) para uma série com um
 *    abastecimento parcial entre dois depósitos atestados, e não o do intervalo adjacente
 *    (que daria 10,00);
 *  - o painel e as estatísticas **concordam** no mesmo veículo: não há dois números para a
 *    mesma realidade;
 *  - um abastecimento **sem odómetro** entre os dois atestados continua a dar "sem dados",
 *    em vez de repartir os litros por uma distância que não é verificável.
 *
 * ## A base de dados
 *
 * Como em `documents-http.test.ts`: a `DATABASE_URL` é definida **antes** de a aplicação ser
 * importada, porque o `core/db.ts` instancia o cliente no import. A base de dados é
 * temporária, vive fora do repositório e é destruída no fim — mesmo que um teste falhe.
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
    data: { email: 'sonda-consumo@zemlo.test', name: 'Sonda' },
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

/*
 * Cada teste cria a sua própria conta, em vez de limpar a base de dados inteira: uma
 * limpeza obrigaria a acertar na ordem de todas as tabelas com chaves estrangeiras (um
 * abastecimento gera uma despesa, o arranque materializa notificações) e um esquecimento
 * produziria falhas intermitentes alheias ao que se quer medir. Contas separadas isolam
 * sem depender dessa ordem.
 */
beforeEach(async () => {
  token = await signup(`consumo-${Math.random().toString(36).slice(2, 10)}@zemlo.test`);
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

/** Veículo a gasóleo: só os tipos com depósito têm consumo de combustível calculável. */
async function createDieselVehicle(): Promise<string> {
  const response = await request(app)
    .post('/api/v1/vehicles')
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .send({ plate: 'AA0001', fuelType: 'diesel' });

  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.id as string;
}

async function addFuel(
  vehicleId: string,
  fuel: { date: string; litres: number; odometerKm: number | null; fullTank: boolean },
): Promise<void> {
  const response = await request(app)
    .post('/api/v1/records/fuel')
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .send({
      vehicleId,
      date: fuel.date,
      litres: fuel.litres,
      amountCents: Math.round(fuel.litres * 170),
      odometerKm: fuel.odometerKm,
      fullTank: fuel.fullTank,
    });

  expect(response.status, JSON.stringify(response.body)).toBe(201);
}

/** Consumo que o painel apresenta para este veículo, em `L/100 km`. */
async function dashboardConsumption(vehicleId: string): Promise<number | null> {
  const response = await request(app)
    .get('/api/v1/dashboard')
    .query({ vehicleId })
    .set('Authorization', `Bearer ${token}`);

  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.usage.fuelConsumptionL100Km as number | null;
}

/** Consumo que as estatísticas apresentam para este veículo, em `L/100 km`. */
async function statsConsumption(vehicleId: string): Promise<number | null> {
  const response = await request(app)
    .get('/api/v1/stats')
    .query({ vehicleId })
    .set('Authorization', `Bearer ${token}`);

  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.consumption.fuelL100Km as number | null;
}

/**
 * A série do defeito: um depósito atestado, um parcial, outro atestado.
 *
 * (10 + 50) L / (11 000 - 10 000) km = 6,00 L/100 km. Medir o intervalo adjacente — o
 * defeito original — daria 50 L / 500 km = 10,00 L/100 km.
 */
async function seedPartialBetweenFulls(vehicleId: string): Promise<void> {
  await addFuel(vehicleId, { date: '2026-01-01', litres: 40, odometerKm: 10_000, fullTank: true });
  await addFuel(vehicleId, { date: '2026-01-15', litres: 10, odometerKm: 10_500, fullTank: false });
  await addFuel(vehicleId, { date: '2026-02-01', litres: 50, odometerKm: 11_000, fullTank: true });
}

/* -------------------------------------------------------------------------- */
/* Testes                                                                      */
/* -------------------------------------------------------------------------- */

describe('consumo de combustível pela API (A8)', () => {
  it('o painel mostra o consumo acumulado, não o do intervalo adjacente', async () => {
    const vehicleId = await createDieselVehicle();
    await seedPartialBetweenFulls(vehicleId);

    expect(await dashboardConsumption(vehicleId)).toBe(6);
  });

  it('o painel e as estatísticas concordam no mesmo veículo', async () => {
    const vehicleId = await createDieselVehicle();
    await seedPartialBetweenFulls(vehicleId);

    const painel = await dashboardConsumption(vehicleId);
    const estatisticas = await statsConsumption(vehicleId);

    expect(painel).toBe(6);
    expect(estatisticas).toBe(painel);
  });

  it('um abastecimento sem odómetro entre os dois atestados não produz consumo', async () => {
    const vehicleId = await createDieselVehicle();

    await addFuel(vehicleId, { date: '2026-01-01', litres: 60, odometerKm: 10_000, fullTank: true });
    await addFuel(vehicleId, { date: '2026-01-15', litres: 20, odometerKm: null, fullTank: true });
    await addFuel(vehicleId, { date: '2026-02-01', litres: 40, odometerKm: 11_000, fullTank: true });

    expect(await dashboardConsumption(vehicleId)).toBeNull();
  });
});
