#!/usr/bin/env node
/**
 * Recupera os clientes Prisma gerados quando ficam truncados a 0 bytes.
 *
 * ## O sintoma
 *
 * `npm run build` falha em `db:generate` com:
 *
 *     [safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]
 *     {"count":N,"threshold":50,"scope":"turn","targets":["...\generated\postgres\index.js"]}
 *
 * e depois, no `tsc`:
 *
 *     src/core/client-sqlite.ts(18,38): error TS2306:
 *     File '...generated/sqlite/index.d.ts' is not a module.
 *
 * ## A causa
 *
 * Não é um defeito do código do Zemlo nem do `schema.prisma`. É a interação entre a
 * substituição de ficheiros do Prisma e uma camada de permissões que bloqueia `unlink`
 * em bloco:
 *
 *  1. O Prisma **trunca** os ficheiros que vai substituir *antes* de os apagar;
 *  2. pede autorização para apagar o primeiro da lista;
 *  3. a autorização é recusada (`count` acima do limiar de 50 operações de escrita
 *     destrutiva por turno);
 *  4. o processo aborta — com os ficheiros já truncados a 0 bytes e nunca reescritos.
 *
 * Cada tentativa de `db:generate` avança a lista `targets` para o ficheiro seguinte e
 * deixa mais um ficheiro a 0 bytes. Por isso o problema **piora** com as tentativas, em
 * vez de estabilizar.
 *
 * ## Como isto se resolve
 *
 * Numa consola normal — fora de qualquer sandbox de agente — as permissões não se aplicam
 * e `prisma generate` funciona. Este script só é preciso para repor o estado antes disso:
 * apaga os ficheiros truncados, que são todos artefactos de build regeneráveis.
 *
 * Uso:
 *   node scripts/fix-generated-clients.mjs
 *   npm run db:generate
 */

import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const generatedDir = resolve(scriptDir, '..', 'prisma', 'generated');

/** Tudo o que o Prisma reescreve em cada `generate`. Nada aqui é fonte. */
const REGENERABLE = new Set([
  'index.js',
  'index.d.ts',
  'index-browser.js',
  'default.js',
  'default.d.ts',
  'edge.js',
  'edge.d.ts',
  'wasm.js',
  'wasm.d.ts',
  'wasm.mjs',
  'wasm-edge-light-loader.mjs',
  'wasm-worker-loader.mjs',
  'client.js',
  'client.d.ts',
  'package.json',
]);

if (!existsSync(generatedDir)) {
  console.error(`Não encontrei ${generatedDir}. Corre a partir de apps/api.`);
  process.exit(1);
}

let removed = 0;
let skipped = 0;

for (const client of readdirSync(generatedDir)) {
  const clientDir = join(generatedDir, client);
  if (!statSync(clientDir).isDirectory()) continue;

  for (const file of readdirSync(clientDir)) {
    const filePath = join(clientDir, file);
    if (!statSync(filePath).isFile()) continue;

    const { size } = statSync(filePath);

    // Só os truncados a 0 bytes, e só os regeneráveis. Um ficheiro com conteúdo nunca é
    // apagado por este script — se estiver errado, o `prisma generate` substitui-o.
    if (size !== 0) {
      skipped += 1;
      continue;
    }

    if (!REGENERABLE.has(file)) {
      console.warn(`  ! ${client}/${file} está a 0 bytes mas não é regenerável — não apago.`);
      skipped += 1;
      continue;
    }

    unlinkSync(filePath);
    console.log(`  apagado ${client}/${file}`);
    removed += 1;
  }
}

console.log(`\n${removed} ficheiro(s) truncado(s) removido(s), ${skipped} intacto(s).`);

if (removed > 0) {
  console.log('\nAgora corre:\n  npm run db:generate\n');
} else {
  console.log('\nNada truncado. Se o build falha, corre `npm run db:generate` numa consola normal.\n');
}
