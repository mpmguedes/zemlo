/**
 * Edição de um carregamento pela fronteira HTTP (`AUD-005`, 🔴-5).
 *
 * ## Porque é que esta suite existe
 *
 * O `PATCH /records/charging/:sessionId` devolvia o registo com as **cinco métricas derivadas
 * a `null`** — `averagePowerKw`, `addedSocPercent`, `distanceSincePreviousKm`,
 * `consumptionKwh100Km` e `costPer100KmCents` —, porque terminava em
 * `mapChargingSession(updated, zeroChargingDerived())` em vez de recalcular. O `GET` do mesmo
 * registo, logo a seguir, trazia-as preenchidas.
 *
 * Consequência para quem usa o produto: editava um carregamento, via os números desaparecerem
 * e não sabia se os tinha estragado. A §43 — "a regra dos 10 segundos" — diz o contrário: o
 * resultado da alteração tem de estar visível sem um segundo pedido. O irmão
 * `updateFuelSession` já delegava em `getFuelSession`; o carregamento não.
 *
 * ## O que estes testes provam
 *
 *  - o `PATCH` devolve as derivadas **recalculadas** a partir do estado novo, e não as antigas;
 *  - o `PATCH` e o `GET` **concordam** — a resposta da edição é a mesma coisa que uma leitura;
 *  - uma alteração **parcial** (só a energia) também recalcula o que depende dela;
 *  - uma sessão sem leitura anterior com quilometragem devolve `null`, não `0` (§49).
 *
 * ## A base de dados
 *
 * Como em `fuel-consumption-http.test.ts`: a `DATABASE_URL` é definida **antes** de a aplicação
 * ser importada, porque o `core/db.ts` instancia o cliente no import. A base é temporária, vive
 * fora do repositório e é destruída no fim.
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
    data: { email: 'sonda-charging@zemlo.test', name: 'Sonda' },
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

/** Cada teste cria a sua conta — ver a nota equivalente em `fuel-consumption-http.test.ts`. */
beforeEach(async () => {
  token = await signup(`charging-${Math.random().toString(36).slice(2, 10)}@zemlo.test`);
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

async function createElectricVehicle(): Promise<string> {
  const response = await request(app)
    .post('/api/v1/vehicles')
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .send({ plate: 'EV0001', fuelType: 'electric' });

  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.id as string;
}

interface ChargingInput {
  date: string;
  energyKwh: number;
  amountCents: number;
  odometerKm: number | null;
  durationMinutes?: number | null;
  startSocPercent?: number | null;
  endSocPercent?: number | null;
}

async function addCharging(vehicleId: string, input: ChargingInput): Promise<string> {
  const response = await request(app)
    .post('/api/v1/records/charging')
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .send({ vehicleId, ...input });

  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.id as string;
}

async function getCharging(sessionId: string): Promise<{ derived: Record<string, unknown> }> {
  const response = await request(app)
    .get(`/api/v1/records/charging/${sessionId}`)
    .set('Authorization', `Bearer ${token}`);

  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as { derived: Record<string, unknown> };
}

async function patchCharging(
  sessionId: string,
  body: Record<string, unknown>,
): Promise<{ derived: Record<string, unknown> }> {
  const response = await request(app)
    .patch(`/api/v1/records/charging/${sessionId}`)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .send(body);

  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as { derived: Record<string, unknown> };
}

/**
 * Duas sessões com quilometragem, para haver um intervalo calculável.
 *
 * A primeira (10 000 km) é a leitura anterior da segunda (10 500 km). Sem a segunda, a primeira
 * fica sem distância e o consumo é `null` — que é o comportamento correto (§49).
 */
async function seedTwoSessions(vehicleId: string): Promise<{ first: string; second: string }> {
  const first = await addCharging(vehicleId, {
    date: '2026-01-01',
    energyKwh: 40,
    amountCents: 800,
    odometerKm: 10_000,
    durationMinutes: 120,
    startSocPercent: 20,
    endSocPercent: 70,
  });

  const second = await addCharging(vehicleId, {
    date: '2026-02-01',
    energyKwh: 50,
    amountCents: 1500,
    odometerKm: 10_500,
    durationMinutes: 60,
    startSocPercent: 30,
    endSocPercent: 80,
  });

  return { first, second };
}

/* -------------------------------------------------------------------------- */
/* Testes                                                                      */
/* -------------------------------------------------------------------------- */

describe('edição de um carregamento pela API (AUD-005)', () => {
  it('o PATCH devolve as derivadas recalculadas, não zeros', async () => {
    const vehicleId = await createElectricVehicle();
    const { second } = await seedTwoSessions(vehicleId);

    /*
     * Antes da edição: 50 kWh em 500 km = 10,00 kWh/100 km; 15,00 € em 500 km = 3,00 €/100 km;
     * 50 kWh em 1 h = 50 kW; 80 − 30 = 50 pontos de bateria.
     */
    expect(await getCharging(second).then((body) => body.derived)).toEqual({
      averagePowerKw: 50,
      addedSocPercent: 50,
      distanceSincePreviousKm: 500,
      consumptionKwh100Km: 10,
      costPer100KmCents: 300,
    });

    /*
     * Depois da edição: 60 kWh em 1 000 km = 6,00 kWh/100 km; 18,00 € em 1 000 km = 1,80 €/100 km;
     * 60 kWh em 30 min = 120 kW; 90 − 30 = 60 pontos.
     */
    const edited = await patchCharging(second, {
      energyKwh: 60,
      amountCents: 1800,
      odometerKm: 11_000,
      durationMinutes: 30,
      endSocPercent: 90,
    });

    expect(edited.derived).toEqual({
      averagePowerKw: 120,
      addedSocPercent: 60,
      distanceSincePreviousKm: 1000,
      consumptionKwh100Km: 6,
      costPer100KmCents: 180,
    });
  });

  it('o PATCH e o GET concordam — não é preciso um segundo pedido', async () => {
    const vehicleId = await createElectricVehicle();
    const { second } = await seedTwoSessions(vehicleId);

    const edited = await patchCharging(second, {
      energyKwh: 60,
      amountCents: 1800,
      odometerKm: 11_000,
      durationMinutes: 30,
      endSocPercent: 90,
    });

    expect(await getCharging(second).then((body) => body.derived)).toEqual(edited.derived);
  });

  it('uma alteração parcial da energia recalcula o que depende dela', async () => {
    const vehicleId = await createElectricVehicle();
    const { second } = await seedTwoSessions(vehicleId);

    // Só a energia muda: a distância tem de continuar 500 km, e o consumo passar a 80/500×100.
    const edited = await patchCharging(second, { energyKwh: 80 });

    expect(edited.derived.distanceSincePreviousKm).toBe(500);
    expect(edited.derived.consumptionKwh100Km).toBe(16);
    // O valor antigo era 10,00 — não pode ter ficado.
    expect(edited.derived.consumptionKwh100Km).not.toBe(10);
    // A potência média acompanha a energia nova: 80 kWh em 1 h.
    expect(edited.derived.averagePowerKw).toBe(80);
  });

  it('a primeira sessão fica sem distância e sem consumo — null, não zero (§49)', async () => {
    const vehicleId = await createElectricVehicle();
    const { first } = await seedTwoSessions(vehicleId);

    // A distância vem da leitura anterior **com** quilometragem. A primeira não tem nenhuma.
    expect(await getCharging(first).then((body) => body.derived)).toEqual({
      averagePowerKw: 20,
      addedSocPercent: 50,
      distanceSincePreviousKm: null,
      consumptionKwh100Km: null,
      costPer100KmCents: null,
    });

    // E uma edição não inventa um número onde não há base para ele.
    const edited = await patchCharging(first, { energyKwh: 44 });

    expect(edited.derived.distanceSincePreviousKm).toBeNull();
    expect(edited.derived.consumptionKwh100Km).toBeNull();
    expect(edited.derived.costPer100KmCents).toBeNull();
    expect(edited.derived.averagePowerKw).toBe(22);
  });
});
