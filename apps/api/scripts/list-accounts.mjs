/**
 * Lista as contas existentes na base de dados, para identificar o que é resto de testes.
 *
 * Uso: node scripts/list-accounts.mjs
 */

import { PrismaClient } from '@zemlo/prisma-sqlite';

const prisma = new PrismaClient();

const accounts = await prisma.user.findMany({
  select: {
    email: true,
    name: true,
    createdAt: true,
    _count: { select: { vehicles: true, expenses: true } },
  },
  orderBy: { createdAt: 'asc' },
});

console.log(`\n${accounts.length} contas na base de dados\n`);
for (const account of accounts) {
  const flag = account._count.vehicles === 0 && account._count.expenses === 0 ? '  (sem dados)' : '';
  console.log(
    `  ${account.email.padEnd(42)} veículos=${String(account._count.vehicles).padStart(2)} despesas=${String(account._count.expenses).padStart(3)}${flag}`,
  );
}
console.log('');

await prisma.$disconnect();
