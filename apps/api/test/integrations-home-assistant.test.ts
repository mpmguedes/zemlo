/**
 * Especificação do Home Assistant pela fronteira HTTP (§26, §27, §28).
 *
 * ## Porque é que esta suite existe
 *
 * O endpoint `GET /integrations/home-assistant/spec` decide, para cada entidade, se ela
 * está `available` com os dados que a conta tem. Essa decisão não é decorativa: é ela que
 * diz ao Home Assistant se o sensor de Consumo existe ou não. E o valor vem de longe —
 * `fuelL100Km` nasce em `averageFuelConsumption` (A8), atravessa o serviço de análise e
 * chega aqui como um booleano:
 *
 *     hasFuelConsumption = stats.consumption.fuelL100Km !== null
 *
 * Ou seja, uma alteração à regra de A8 **muda o valor de um booleano numa integração
 * externa**. Até esta suite, nada o vigiava: `grep` de `hasFuelConsumption` só encontrava
 * produção, e nenhum teste mencionava `home-assistant`.
 *
 * ## O que é que estes testes fixam
 *
 *  - com dois depósitos atestados com odómetro, o sensor de Consumo está disponível;
 *  - sem dados suficientes, está indisponível;
 *  - quando um abastecimento sem odómetro impede determinar o intervalo, está
 *    indisponível — e é aqui que o teste morde: a implementação anterior de
 *    `averageFuelConsumption` (pares adjacentes) devolvia um número para esta série, logo
 *    o sensor aparecia disponível com um consumo que não era determinável.
 *
 * ## A base de dados
 *
 * Como em `documents-http.test.ts` e `fuel-consumption-http.test.ts`: a `DATABASE_URL` é
 * definida **antes** de a aplicação ser importada, porque o `core/db.ts` instancia o
 * cliente no import. A base de dados é temporária e é destruída no fim, mesmo que um teste
 * falhe.
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
    data: { email: 'sonda-home-assistant@zemlo.test', name: 'Sonda' },
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
 * Cada teste cria a sua própria conta, em vez de limpar a base de dados inteira: a
 * especificação depende dos dados da conta, e contas separadas isolam sem depender da
 * ordem de todas as tabelas com chaves estrangeiras.
 */
beforeEach(async () => {
  token = await signup(`ha-${Math.random().toString(36).slice(2, 10)}@zemlo.test`);
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

/**
 * A entidade de Consumo de combustível da especificação.
 *
 * O identificador é procurado por igualdade exata, e não por sufixo: `_consumption` também
 * corresponde a `sensor.zemlo_car_energy_consumption`, e depender da ordem do array
 * esconderia a entidade errada.
 */
async function fuelConsumptionEntity(
  vehicleId: string,
): Promise<{ available: boolean; requires: string; unitOfMeasurement: string | null }> {
  const response = await request(app)
    .get('/api/v1/integrations/home-assistant/spec')
    .query({ vehicleId })
    .set('Authorization', `Bearer ${token}`);

  expect(response.status, JSON.stringify(response.body)).toBe(200);

  const entity = (response.body.entities as Array<Record<string, unknown>>).find(
    (candidate) => candidate.entityId === 'sensor.zemlo_car_consumption',
  );

  expect(entity, 'A especificação não trouxe a entidade do consumo de combustível.').toBeDefined();

  return {
    available: entity?.available as boolean,
    requires: entity?.requires as string,
    unitOfMeasurement: entity?.unitOfMeasurement as string | null,
  };
}

/* -------------------------------------------------------------------------- */
/* Testes                                                                      */
/* -------------------------------------------------------------------------- */

describe('especificação do Home Assistant — disponibilidade do consumo de combustível', () => {
  it('marca o consumo como disponível quando há dois depósitos atestados com odómetro', async () => {
    const vehicleId = await createDieselVehicle();

    await addFuel(vehicleId, { date: '2026-01-01', litres: 40, odometerKm: 10_000, fullTank: true });
    await addFuel(vehicleId, { date: '2026-02-01', litres: 50, odometerKm: 11_000, fullTank: true });

    const entity = await fuelConsumptionEntity(vehicleId);

    expect(entity.available).toBe(true);
    expect(entity.unitOfMeasurement).toBe('L/100 km');
    expect(entity.requires.length).toBeGreaterThan(0);
  });

  it('marca o consumo como indisponível quando os dados não chegam para um intervalo', async () => {
    const vehicleId = await createDieselVehicle();

    // Um único abastecimento: não há intervalo nenhum a fechar.
    await addFuel(vehicleId, { date: '2026-01-01', litres: 40, odometerKm: 10_000, fullTank: true });

    const entity = await fuelConsumptionEntity(vehicleId);

    expect(entity.available).toBe(false);
  });

  it('marca o consumo como indisponível quando um abastecimento sem odómetro impede fechar o intervalo', async () => {
    const vehicleId = await createDieselVehicle();

    // A série que distingue as duas implementações: um abastecimento sem odómetro, seguido
    // de um parcial **com** odómetro, e só depois o depósito atestado que fecharia o
    // intervalo. Medir pares adjacentes — o defeito de 🔴-1 — encontra aqui o par
    // (parcial, atestado) e devolve 10,00 L/100 km, dando o sensor como disponível com um
    // consumo que não é determinável. A regra de A8 (âncora → fecho) devolve "sem dados",
    // e é isso que a especificação tem de refletir.
    await addFuel(vehicleId, { date: '2026-01-01', litres: 60, odometerKm: 10_000, fullTank: true });
    await addFuel(vehicleId, { date: '2026-01-10', litres: 20, odometerKm: null, fullTank: false });
    await addFuel(vehicleId, { date: '2026-01-15', litres: 15, odometerKm: 10_600, fullTank: false });
    await addFuel(vehicleId, { date: '2026-01-20', litres: 40, odometerKm: 11_000, fullTank: true });

    const entity = await fuelConsumptionEntity(vehicleId);

    expect(entity.available).toBe(false);
  });
});
