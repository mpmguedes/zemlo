/**
 * Repara referências inversas em falta.
 *
 * Substitui o comportamento antigo de `deleteExpense`, que apagava a despesa sem limpar o
 * `expenseId` que o abastecimento, o carregamento ou a manutenção guardavam. Esses
 * registos ficaram a apontar para uma despesa inexistente.
 *
 * É um script de migração pontual: existe para poder ser corrido uma vez sobre bases de
 * dados criadas antes da correção. `scripts/check-integrity.mjs` confirma o resultado.
 *
 * Uso: node scripts/repair-dangling-expense-links.mjs
 */

import { PrismaClient } from '@zemlo/prisma-sqlite';
import { loadEnv } from './load-env.mjs';

// O `.env` tem de ser carregado antes de instanciar o cliente: ver `load-env.mjs`.
loadEnv();

const prisma = new PrismaClient();

const TARGETS = [
  { model: 'fuelSession', label: 'abastecimentos' },
  { model: 'chargingSession', label: 'carregamentos' },
  { model: 'maintenanceRecord', label: 'manutenções' },
];

async function main() {
  console.log('\nReparação de referências a despesas inexistentes\n');
  let total = 0;

  for (const target of TARGETS) {
    const rows = await prisma[target.model].findMany({
      where: { expenseId: { not: null } },
      select: { id: true, expenseId: true },
    });

    let repaired = 0;
    for (const row of rows) {
      if (!row.expenseId) continue;
      const expense = await prisma.expense.findUnique({
        where: { id: row.expenseId },
        select: { id: true },
      });
      if (!expense) {
        await prisma[target.model].update({ where: { id: row.id }, data: { expenseId: null } });
        repaired += 1;
      }
    }

    total += repaired;
    console.log(`  ${target.label.padEnd(16)} ${repaired} ${repaired === 1 ? 'referência limpa' : 'referências limpas'} (de ${rows.length})`);
  }

  console.log(`\nTotal: ${total}.\n`);
}

main()
  .catch((error) => {
    console.error('A reparação falhou:', error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
