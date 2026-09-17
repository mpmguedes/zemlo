#!/usr/bin/env node
/**
 * Gera o schema Prisma para SQLite a partir do schema canónico PostgreSQL.
 *
 * Porquê: o Zemlo é um produto com um alvo de produção definido (PostgreSQL em
 * infraestrutura própria, §36) mas o desenvolvimento e os testes têm de correr sem
 * servidor de base de dados. Manter dois schemas escritos à mão garante que ficam
 * divergentes — e a divergência aparece sempre em produção, no pior momento.
 *
 * Aqui o schema PostgreSQL é a **fonte única de verdade** e a variante SQLite é
 * derivada de forma determinística. `--check` falha se o ficheiro em disco estiver
 * desatualizado, o que permite usar isto como verificação em CI (§37).
 *
 * Uso:
 *   node scripts/sync-sqlite-schema.mjs           # escreve o schema SQLite
 *   node scripts/sync-sqlite-schema.mjs --check   # falha se estiver desatualizado
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptDir, '..');
const canonicalPath = join(apiRoot, 'prisma', 'schema.prisma');
const sqliteDir = join(apiRoot, 'prisma', 'sqlite');
const sqlitePath = join(sqliteDir, 'schema.sqlite.prisma');

/**
 * O valor por omissão do ficheiro de base de dados SQLite (`file:./dev.db`) vive em
 * `core/config.ts`, que é o único sítio onde os valores por omissão de ambiente existem.
 * O schema gerado limita-se a ler `DATABASE_URL`.
 */

/**
 * Pasta de saída do cliente SQLite, relativa à pasta do schema SQLite.
 *
 * Tem de ser DIFERENTE da saída do cliente PostgreSQL (`./generated/postgres`, em
 * `prisma/`). Enquanto ambos escreviam em `node_modules/.prisma/client`, gerar os dois
 * significava que o último ganhava — e o último era sempre o SQLite. O resultado era uma
 * produção a escrever num ficheiro local com `DATABASE_URL` a apontar para PostgreSQL,
 * sem qualquer erro visível.
 */
const SQLITE_CLIENT_OUTPUT = '../generated/sqlite';

/**
 * O SQLite não tem tipos de coluna próprios no Prisma: todas as anotações `@db.*`
 * têm de ser removidas. Algumas perdem informação que importa preservar no schema
 * canónico (`Decimal` para dinheiro, `Date` para datas civis) e por isso são
 * convertidas para o equivalente mais próximo antes de remover a anotação.
 */
const TYPE_ATTRIBUTE_MAP = [
  // Dinheiro e quantidades decimais: `Decimal(10,2)` -> `Float`.
  [/@db\.(?:Decimal|Money)\(\s*\d+\s*,\s*\d+\s*\)/g, ''],
  [/@db\.(?:Decimal|Money)\b/g, ''],
  // Datas civis: `@db.Date` -> `DateTime` (a data civil é validada na aplicação).
  [/@db\.Date\b/g, ''],
  // Texto longo: `@db.Text` -> `String` (o SQLite não distingue).
  [/@db\.Text\b/g, ''],
  // Restantes tipos específicos de PostgreSQL (`@db.VarChar(120)`, `@db.Citext`, ...).
  [/@db\.[A-Za-z]+(?:\([^)]*\))?/g, ''],
];

/**
 * `Json` no PostgreSQL aceita `DbNull` como valor por omissão; no SQLite o
 * equivalente é `JsonNull`.
 */
function convertJsonDefaults(body) {
  return body.replace(/@default\(DbNull\)/g, '@default(JsonNull)');
}

/** Colapsa espaços múltiplos deixados pela remoção de anotações e reindenta. */
function tidy(body) {
  return body
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, '').replace(/[ \t]{2,}(?=\/\/|$)/g, ' '))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

function buildSqliteSchema(canonical) {
  let body = canonical;

  // 1. Substituir o bloco `datasource` pelo equivalente SQLite.
  //
  // `env("DATABASE_URL")` e não um caminho fixo: o cliente tem de obedecer à mesma
  // variável que `core/config.ts` lê. Com o caminho fixo, `DATABASE_URL` era ignorado pelo
  // cliente SQLite, pelo que a aplicação podia reportar um alvo e escrever noutro.
  // O valor por omissão (`file:./dev.db`) é aplicado em `core/config.ts`, que é o único
  // sítio onde os valores por omissão de ambiente vivem.
  const datasourcePattern = /datasource\s+db\s*\{[^}]*\}/;
  if (!datasourcePattern.test(body)) {
    throw new Error('Não foi encontrado o bloco `datasource db` no schema canónico.');
  }
  body = body.replace(
    datasourcePattern,
    ['datasource db {', '  provider = "sqlite"', '  url      = env("DATABASE_URL")', '}'].join(
      '\n',
    ),
  );

  // 2. Substituir o bloco `generator` para dar ao cliente SQLite uma saída própria.
  const generatorPattern = /generator\s+client\s*\{[^}]*\}/;
  if (!generatorPattern.test(body)) {
    throw new Error('Não foi encontrado o bloco `generator client` no schema canónico.');
  }
  body = body.replace(
    generatorPattern,
    [
      'generator client {',
      '  provider = "prisma-client-js"',
      `  output   = "${SQLITE_CLIENT_OUTPUT}"`,
      '}',
    ].join('\n'),
  );

  // 3. Remover anotações de tipo específicas do PostgreSQL.
  for (const [pattern, replacement] of TYPE_ATTRIBUTE_MAP) {
    body = body.replace(pattern, replacement);
  }

  // 4. Ajustar valores por omissão de JSON.
  body = convertJsonDefaults(body);

  // 5. Limpar espaços residuais.
  body = tidy(body);

  const header = [
    '// ⚠️  FICHEIRO GERADO — NÃO EDITAR À MÃO.',
    '//',
    '// Derivado de `prisma/schema.prisma` (PostgreSQL) por',
    '// `scripts/sync-sqlite-schema.mjs`. Qualquer alteração ao modelo faz-se no',
    '// schema canónico e depois corre-se `npm run db:generate`.',
    '//',
    '// Esta variante existe para desenvolvimento e testes locais sem servidor de',
    '// base de dados. A produção usa PostgreSQL (§36 da especificação).',
    '',
  ].join('\n');

  return `${header}${body}\n`;
}

function main() {
  const checkOnly = process.argv.includes('--check');

  if (!existsSync(canonicalPath)) {
    console.error(`Schema canónico não encontrado: ${canonicalPath}`);
    process.exit(1);
  }

  const canonical = readFileSync(canonicalPath, 'utf8');
  const generated = buildSqliteSchema(canonical);

  if (checkOnly) {
    if (!existsSync(sqlitePath)) {
      console.error('O schema SQLite não existe. Corre `npm run db:sync-schema`.');
      process.exit(1);
    }
    const current = readFileSync(sqlitePath, 'utf8');
    if (current !== generated) {
      console.error(
        'O schema SQLite está desatualizado em relação ao schema canónico.\n' +
          'Corre `npm run db:sync-schema` e inclui o resultado no commit.',
      );
      process.exit(1);
    }
    console.log('Schema SQLite sincronizado com o schema canónico.');
    return;
  }

  mkdirSync(sqliteDir, { recursive: true });
  writeFileSync(sqlitePath, generated, 'utf8');
  console.log(`Schema SQLite gerado: prisma/sqlite/schema.sqlite.prisma`);
}

main();
