/**
 * Cliente Prisma para PostgreSQL — o cliente de produção.
 *
 * ⚠️  FICHEIRO GERADO — NÃO EDITAR À MÃO.
 *
 * O cliente em si é produzido por `npm run prisma:postgres` (ou `db:generate`) em
 * `prisma/generated/postgres`, a partir de `prisma/schema.prisma`. A pasta `generated/`
 * está no `.gitignore`: o cliente é sempre reconstruído a partir do schema, que é a fonte
 * única de verdade.
 *
 * ## Porque é que este ficheiro existe
 *
 * Antes, os dois clientes escreviam no mesmo caminho (`node_modules/.prisma/client`) e o
 * último gerado ganhava — na prática o SQLite substituía o de PostgreSQL, e a produção
 * escrevia num ficheiro local com `DATABASE_URL` a apontar para PostgreSQL, sem erro
 * nenhum. Separar as saídas elimina a colisão; este módulo identifica o cliente que está
 * de facto carregado, para que a seleção em `core/prisma-client.ts` não dependa de uma
 * afirmação sobre si própria.
 *
 * O especificador abaixo tem de ser mantido **igual** ao do `import`, porque é ele que
 * liga a verificação ao módulo carregado. Ver `core/prisma-client-identity.ts`.
 */

import { fileURLToPath } from 'node:url';
import { Prisma, PrismaClient } from '@zemlo/prisma-postgres';
import {
  generatedClientDirectory,
  readGeneratedProviderAt,
} from './prisma-client-identity.js';

const SPECIFIER = '@zemlo/prisma-postgres';

/**
 * Pasta que este módulo tem obrigação de carregar.
 *
 * Derivada da posição do ficheiro (`src/core/` e `dist/core/` estão à mesma profundidade),
 * pelo que é a mesma em desenvolvimento e em produção.
 */
const EXPECTED_DIRECTORY = new URL('../../prisma/generated/postgres/', import.meta.url);

/** Pasta do cliente efetivamente importado, resolvida a partir do especificador. */
export const CLIENT_DIRECTORY = generatedClientDirectory(SPECIFIER, import.meta.url);

/*
 * Duas verificações independentes:
 *
 *  1. o pacote importado é mesmo o de PostgreSQL (ligado ao `import` através de
 *     `CLIENT_DIRECTORY`, resolvido a partir do especificador);
 *  2. o cliente que está na pasta foi compilado para PostgreSQL.
 *
 * Só a segunda detecta o defeito original — a pasta de produção a conter o cliente
 * SQLite. A primeira trava uma troca de `import` que apontasse este módulo ao cliente
 * errado, que é a mesma falha por outra via.
 */
if (CLIENT_DIRECTORY !== fileURLToPath(EXPECTED_DIRECTORY)) {
  throw new Error(
    `Este módulo deve carregar o cliente PostgreSQL, mas "${SPECIFIER}" resolve para ${CLIENT_DIRECTORY}. ` +
      'Corre `npm run db:generate`.',
  );
}

/** Motor real do cliente nesta pasta, lido do schema gerado. */
export const CLIENT_PROVIDER = readGeneratedProviderAt('postgres');

if (CLIENT_PROVIDER !== 'postgresql') {
  throw new Error(
    `A pasta do cliente de produção contém um cliente compilado para "${CLIENT_PROVIDER}" e não para ` +
      'PostgreSQL. Corre `npm run db:generate` para o reconstruir a partir do schema canónico.',
  );
}

export { Prisma, PrismaClient };
