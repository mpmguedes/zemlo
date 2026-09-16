/*
 * Deteta mojibake (UTF-8 lido como Latin-1 e regravado) nos ficheiros TypeScript do projeto.
 *
 * Isto é uma ferramenta de manutenção, não parte da aplicação: existe porque a codificação de
 * ficheiros é exatamente o tipo de defeito que não dá erro de compilação — dá um emoji
 * partido ou um acento trocado, e só se vê a olhar para o ecrã.
 *
 * Execução: node apps/web/scripts/check-encoding.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['apps/web/src', 'apps/web'];

/** Assinaturas de mojibake: não existem em texto português correto. */
const PATTERNS = [
  { name: 'sequencia C3 dupla', regex: /\u00c3[\u0080-\u00bf]/u },
  { name: 'sequencia E2 82/80 (simbolos)', regex: /\u00e2\u0080|\u00e2\u0082/u },
  { name: 'emoji F0 9F partido', regex: /\u00f0\u009f|\u00f0\u0178/u },
  { name: 'caracter de substituicao', regex: /\ufffd/u },
];

/** Extensões inspecionadas. */
const EXTENSIONS = ['.ts', '.tsx', '.css', '.html', '.svg', '.json', '.mjs'];

/**
 * Linhas dispensadas da verificação.
 *
 * Há um caso legítimo em que a assinatura de mojibake aparece de propósito: o comentário da
 * exportação CSV, que cita o resultado da falta de BOM como exemplo do que o BOM evita — e o
 * comentário deste próprio ficheiro, que explica o mesmo. Uma verificação com um falso
 * positivo permanente é uma verificação que se aprende a ignorar.
 */
const ALLOWED = [/em vez de/, /como exemplo/];

function walk(directory, onFile) {
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(directory, entry);
    const info = statSync(full);
    if (info.isDirectory()) walk(full, onFile);
    else onFile(full);
  }
}

let problems = 0;
const seen = new Set();

for (const root of ROOTS) {
  walk(root, (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (!EXTENSIONS.some((extension) => file.endsWith(extension))) return;

    const text = readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    const offending = lines
      .map((line, index) => ({ line, index }))
      .filter((entry) => !ALLOWED.some((allowed) => allowed.test(entry.line)))
      .filter((entry) => PATTERNS.some((pattern) => pattern.regex.test(entry.line)));

    if (offending.length === 0) return;

    problems += 1;
    console.log(`\n${file}`);
    for (const entry of offending) {
      console.log(`  ${entry.index + 1}: ${entry.line.trim().slice(0, 120)}`);
    }
    console.log(`  padroes: ${PATTERNS.filter((pattern) => offending.some((entry) => pattern.regex.test(entry.line))).map((hit) => hit.name).join(', ')}`);
  });
}

console.log(problems === 0 ? '\nCodificacao correta em todos os ficheiros.' : `\n${problems} ficheiro(s) com mojibake.`);
process.exitCode = problems === 0 ? 0 : 1;
