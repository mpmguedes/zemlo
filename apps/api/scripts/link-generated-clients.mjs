#!/usr/bin/env node
/**
 * Liga os clientes Prisma gerados a nomes de pacote resolúveis.
 *
 * ## Porquê
 *
 * Os dois clientes têm de ter saídas **distintas** — foi a partilha de um único caminho
 * (`node_modules/.prisma/client`) que permitiu ao cliente SQLite substituir o de
 * PostgreSQL, em silêncio, pondo a produção a escrever num ficheiro local.
 *
 * Saídas distintas resolvem o problema de origem, mas criam um problema de resolução: o
 * TypeScript em modo `NodeNext` não consegue resolver um import relativo para dentro de
 * uma pasta com `package.json` cujo mapa `exports` não declara a condição `types`, e o
 * `paths` do `tsconfig` só serve para o TypeScript — o Node continuaria sem encontrar o
 * módulo em runtime.
 *
 * Este script fecha essa lacuna criando, para cada cliente, um nome de pacote em
 * `node_modules/@zemlo/` que aponta para a pasta gerada. Assim **o mesmo especificador
 * resolve no TypeScript e no Node**:
 *
 *     import { PrismaClient } from '@zemlo/prisma-postgres';
 *
 * Também acrescenta a condição `types` ao `package.json` que o Prisma escreve, porque é
 * isso que faz o TypeScript seguir `exports` em vez de desistir.
 *
 * ## Porque é que isto não é um `paths` do tsconfig
 *
 * `paths` só afeta a compilação: o JavaScript emitido manteria o especificador e o Node
 * falharia no arranque. Um alias que não existe em runtime é uma falha adiada para
 * produção.
 *
 * Uso:
 *   node scripts/link-generated-clients.mjs
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptDir, '..');

/**
 * `node_modules` do monorepo — o mesmo sítio onde o npm coloca `@zemlo/api` e
 * `@zemlo/shared`. Não é o `node_modules` da API: a resolução sobe a partir de
 * `apps/api/src` e encontra ambos, mas manter o mesmo sítio dos outros pacotes do
 * âmbito `@zemlo` evita dois mecanismos a competir.
 */
const rootNodeModules = resolve(apiRoot, '..', '..', 'node_modules');

const CLIENTS = [
  { dir: join(apiRoot, 'prisma', 'generated', 'postgres'), name: '@zemlo/prisma-postgres' },
  { dir: join(apiRoot, 'prisma', 'generated', 'sqlite'), name: '@zemlo/prisma-sqlite' },
];

/**
 * Acrescenta a condição `types` ao mapa `exports` que o `prisma generate` escreve.
 *
 * Sem ela o TypeScript lê `exports`, não encontra tipos e reporta TS2307 — apesar de o
 * Node resolver o mesmo especificador sem dificuldade.
 */
function ensureTypesCondition(pkgPath) {
  if (!existsSync(pkgPath)) return 'sem package.json';

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  let changed = false;

  for (const subpath of ['.', './client', './index']) {
    const entry = pkg.exports?.[subpath];
    if (!entry || typeof entry !== 'object' || entry.types === './index.d.ts') continue;
    // A ordem importa: o TypeScript usa a primeira condição que corresponde.
    const { types: _ignored, ...rest } = entry;
    pkg.exports[subpath] = { types: './index.d.ts', ...rest };
    changed = true;
  }

  if (pkg.types !== 'index.d.ts') {
    pkg.types = 'index.d.ts';
    changed = true;
  }

  if (!changed) return 'já correto';
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  return 'condição `types` acrescentada';
}

function link(client) {
  const { dir, name } = client;

  if (!existsSync(join(dir, 'index.js'))) {
    return { name, status: 'não gerado (corre `npm run prisma:sqlite` ou `prisma:postgres`)' };
  }

  const typesStatus = ensureTypesCondition(join(dir, 'package.json'));

  const [scope, bare] = name.split('/');
  const scopeDir = join(rootNodeModules, scope);
  const linkPath = join(scopeDir, bare);
  mkdirSync(scopeDir, { recursive: true });

  // Recriar sempre: um link antigo a apontar para uma pasta removida é pior do que nenhum.
  rmSync(linkPath, { recursive: true, force: true });
  symlinkSync(dir, linkPath, 'junction');

  return { name, status: `ligado (${typesStatus})` };
}

function main() {
  const results = CLIENTS.map(link);
  for (const r of results) console.log(`  ${r.name}: ${r.status}`);

  const missing = results.filter((r) => r.status.startsWith('não gerado'));
  if (missing.length > 0) {
    console.error(
      '\nClientes em falta. Gera-os antes de ligar:\n' +
        '  npm run prisma:sqlite      # desenvolvimento e testes\n' +
        '  npm run prisma:postgres    # produção',
    );
    process.exit(1);
  }
}

main();
