/**
 * Verificação rápida da ligação à base de dados.
 *
 * Confirma que o cliente Prisma gerado consegue falar com a base de dados configurada
 * e que todas as tabelas do modelo existem. É o primeiro sítio a olhar quando algo
 * falha no arranque.
 *
 * Uso: node scripts/smoke-db.mjs
 */

import { PrismaClient } from '@zemlo/prisma-sqlite';

const prisma = new PrismaClient();

/** Modelos que devem existir nos dois schemas (PostgreSQL e SQLite). */
const MODELS = [
  'user',
  'userPreference',
  'notificationPreference',
  'session',
  'oneTimeToken',
  'auditLog',
  'vehicle',
  'odometerReading',
  'expense',
  'fuelSession',
  'chargingSession',
  'maintenanceRecord',
  'insurancePolicy',
  'inspectionRecord',
  'taxRecord',
  'document',
  'reminder',
  'notification',
  'suggestionState',
  'vehicleEvent',
  'integration',
  'homeAssistantEntity',
  'appSetting',
  'household',
  'householdMember',
  'organization',
  'organizationMember',
];

async function main() {
  const started = Date.now();
  const results = [];

  for (const model of MODELS) {
    try {
      const count = await prisma[model].count();
      results.push({ model, count, ok: true });
    } catch (error) {
      results.push({ model, ok: false, error: error.message.split('\n')[0] });
    }
  }

  const failed = results.filter((entry) => !entry.ok);
  const latency = Date.now() - started;

  for (const entry of results) {
    if (entry.ok) {
      console.log(`  ok    ${entry.model.padEnd(24)} ${entry.count} registos`);
    } else {
      console.log(`  FALHA ${entry.model.padEnd(24)} ${entry.error}`);
    }
  }

  console.log(`\n${MODELS.length - failed.length}/${MODELS.length} tabelas acessíveis em ${latency} ms`);

  if (failed.length > 0) {
    console.error(
      '\nCorre `npm run db:push` (SQLite) ou `npm run db:migrate:pg` (PostgreSQL) para criar as tabelas em falta.',
    );
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('Não foi possível ligar à base de dados:', error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
