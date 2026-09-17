/**
 * Cliente Prisma para SQLite — apenas desenvolvimento e testes locais.
 *
 * ⚠️  FICHEIRO GERADO — NÃO EDITAR À MÃO.
 *
 * O cliente em si é produzido por `npm run prisma:sqlite` (ou `db:generate`) em
 * `prisma/generated/sqlite`, a partir de `prisma/sqlite/schema.sqlite.prisma` — ele
 * próprio derivado do schema canónico.
 *
 * Ver a nota em `client-postgres.ts` sobre porque é que os dois clientes têm de ter
 * saídas distintas, e `core/prisma-client-identity.ts` sobre porque é que o motor é lido
 * do schema gerado em vez de ser afirmado numa constante.
 *
 * O especificador abaixo tem de ser mantido **igual** ao do `import`.
 */

import { fileURLToPath } from 'node:url';
import { Prisma, PrismaClient } from '@zemlo/prisma-sqlite';
import {
  generatedClientDirectory,
  readGeneratedProviderAt,
} from './prisma-client-identity.js';

const SPECIFIER = '@zemlo/prisma-sqlite';

/** Pasta que este módulo tem obrigação de carregar. */
const EXPECTED_DIRECTORY = new URL('../../prisma/generated/sqlite/', import.meta.url);

/** Pasta do cliente efetivamente importado, resolvida a partir do especificador. */
export const CLIENT_DIRECTORY = generatedClientDirectory(SPECIFIER, import.meta.url);

// Ver `client-postgres.ts` sobre o motivo das duas verificações independentes.
if (CLIENT_DIRECTORY !== fileURLToPath(EXPECTED_DIRECTORY)) {
  throw new Error(
    `Este módulo deve carregar o cliente SQLite, mas "${SPECIFIER}" resolve para ${CLIENT_DIRECTORY}. ` +
      'Corre `npm run db:generate`.',
  );
}

/** Motor real do cliente nesta pasta, lido do schema gerado. */
export const CLIENT_PROVIDER = readGeneratedProviderAt('sqlite');

if (CLIENT_PROVIDER !== 'sqlite') {
  throw new Error(
    `A pasta do cliente de desenvolvimento contém um cliente compilado para "${CLIENT_PROVIDER}" e não ` +
      'para SQLite. Corre `npm run db:generate`.',
  );
}

export { Prisma, PrismaClient };
