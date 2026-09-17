#!/usr/bin/env node
/**
 * Remove as contas descartáveis criadas pelas verificações automáticas.
 *
 * Porque é necessário: `verify.ts`, `verify-config.ts` e os scripts de diagnóstico criam
 * contas novas a cada execução — é a forma correta de garantir isolamento entre corridas,
 * porque um teste que reutiliza uma conta arrasta o estado da execução anterior e passa ou
 * falha por razões que não são as que está a medir.
 *
 * A contrapartida é que essas contas ficam na base de dados e acumulam-se: ao fim de
 * algumas dezenas de execuções, a base de dados de desenvolvimento tem centenas de
 * veículos que ninguém reconhece. Este script fecha esse ciclo.
 *
 * **Nunca toca nas contas de demonstração** (`demo@zemlo.pt`, `vazio@zemlo.pt`), que são
 * criadas pelo seed e são o que se abre para ver a aplicação a funcionar.
 *
 * Uso:
 *   node scripts/cleanup-test-accounts.mjs           # remove
 *   node scripts/cleanup-test-accounts.mjs --dry-run # só mostra o que removeria
 */

import { PrismaClient } from '@zemlo/prisma-sqlite';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

/**
 * Prefixos usados pelos scripts de verificação e de diagnóstico.
 *
 * A lista é explícita, e não um padrão genérico como "tudo o que não seja demo": um
 * critério demasiado amplo apagaria contas de desenvolvimento criadas à mão durante o
 * trabalho normal, o que seria um efeito colateral destrutivo e difícil de explicar.
 */
const TEST_EMAIL_PREFIXES = [
  'verificacao-',
  'outra-',
  'vitima-',
  'atacante-',
  'debug-',
  'dbl-',
  'orph-',
  'insp-',
  'flow-',
  'wh-',
  'rec-',
  'tr-',
  'fk-',
  'fixa-',
  'fixb-',
  'teste-',
  'a-',
  'b-',
  'probe-',
  'probea',
  'probeb',
  'probec',
  'probed',
  'rev',
  're2',
];

/**
 * Domínios reservados para documentação e testes (RFC 2606 e RFC 6761).
 *
 * Qualquer conta com um destes domínios é, por definição, descartável: `example.test`,
 * `example.com`, `example.invalid` e `example.localhost` nunca podem pertencer a uma
 * pessoa real, e são o que a documentação e as ferramentas de teste recomendam
 * precisamente para não enviar email a estranhos. É um critério melhor do que uma lista
 * de prefixos, porque abrange também as contas de um script de revisão futuro que ninguém
 * se lembrou de registar aqui.
 */
const RESERVED_TEST_DOMAINS = ['@example.test', '@example.com', '@example.invalid', '@example.localhost', '@test'];

/** Contas que este script nunca remove, independentemente do que aconteça. */
const PROTECTED_EMAILS = new Set(['demo@zemlo.pt', 'vazio@zemlo.pt']);

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, email: true, createdAt: true } });

  const candidates = users.filter((user) => {
    if (PROTECTED_EMAILS.has(user.email)) return false;
    if (RESERVED_TEST_DOMAINS.some((domain) => user.email.endsWith(domain))) return true;
    return TEST_EMAIL_PREFIXES.some((prefix) => user.email.startsWith(prefix));
  });

  console.log(`\nLimpeza de contas de verificação${dryRun ? ' (simulação)' : ''}\n`);
  console.log(`  contas na base de dados : ${users.length}`);
  console.log(`  contas de teste a remover: ${candidates.length}`);

  if (candidates.length === 0) {
    console.log('\nNada para remover.\n');
    return;
  }

  if (dryRun) {
    for (const user of candidates.slice(0, 20)) {
      console.log(`    ${user.email}`);
    }
    if (candidates.length > 20) console.log(`    … e mais ${candidates.length - 20}`);
    console.log('\nCorre sem `--dry-run` para remover.\n');
    return;
  }

  // As relações em cascata no schema tratam dos veículos e de tudo o que deles depende.
  const result = await prisma.user.deleteMany({
    where: { id: { in: candidates.map((user) => user.id) } },
  });

  console.log(`\n  ${result.count} ${result.count === 1 ? 'conta removida' : 'contas removidas'}.\n`);
}

main()
  .catch((error) => {
    console.error('A limpeza falhou:', error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
