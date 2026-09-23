#!/usr/bin/env node
/**
 * Corre a suíte e **distingue falha de teste de falha de ambiente**.
 *
 * ## Porque é que isto existe
 *
 * Medido (`PC-26`): a suíte da API terminou com **todos os testes verdes** e **exit code 1**,
 * porque um ficheiro foi marcado como falhado por um `EBUSY` no teardown — o `rmSync` do
 * directório temporário a colidir com o handle do SQLite que o Windows ainda não tinha
 * libertado. Num CI isto é pior do que um erro: é um semáforo vermelho **ao acaso**, e ao
 * segundo dia alguém desliga o CI. É exactamente o que o critério de `OPS-001` proíbe.
 *
 * A causa raiz foi corrigida em `apps/api/test/helpers/db.ts` (repetição com espera sobre
 * `EBUSY`/`EPERM`/`ENOTEMPTY`). Este script é a **segunda linha**: apanha um artefacto **novo**
 * de ambiente sem transformar o CI num semáforo ao acaso. A ordem importa — sem a correção da
 * causa raiz, um classificador seria só uma forma de esconder o problema.
 *
 * ## O que conta como ambiente (e só isto)
 *
 * Um ficheiro de teste com `status: failed` e **zero asserções falhadas**, cuja mensagem tenha
 * **as duas coisas**: um código de sistema de ficheiros (`EBUSY`, `EPERM`, `ENOTEMPTY`) **e** uma
 * operação de sistema de ficheiros (`unlink`, `rmdir`, `directory not empty`,
 * `resource busy or locked`). Exigir as duas evita que um `EBUSY` solto, sem relação com o
 * teardown, seja perdoado.
 *
 * ## O que falha sempre o CI
 *
 * Qualquer asserção falhada; qualquer suite que não chegue a carregar (erro de sintaxe, import
 * partido, `ReferenceError` no arranque — foi assim que `PC-27` se manifestou, com **0 testes
 * corridos**); e **qualquer coisa que este script não consiga explicar**.
 *
 * ## A propriedade que interessa: falha para o lado seguro
 *
 * Se o formato da saída do Vitest mudar e o resumo deixar de ser reconhecido, este script **não**
 * declara verde: cai no ramo «saiu diferente de zero sem explicação» e **falha**. Um falso
 * vermelho é chato e vê-se; um falso verde é invisível e é o que se quer evitar.
 *
 * Uso:
 *   node scripts/ci/run-tests.mjs                 # corre `npm test`
 *   node scripts/ci/run-tests.mjs npm test -- -t "x"
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const argumentos = process.argv.slice(2);
const comando = argumentos.length > 0 ? argumentos : ['npm', 'test'];

const ANSI = /\u001b\[[0-9;]*m/g;
const limpar = (texto) => texto.replace(ANSI, '');

const resultado = spawnSync(comando[0], comando.slice(1), {
  encoding: 'utf8',
  shell: process.platform === 'win32',
  maxBuffer: 512 * 1024 * 1024,
  stdio: ['inherit', 'pipe', 'pipe'],
});

const saida = limpar((resultado.stdout ?? '') + (resultado.stderr ?? ''));
// O log tem de continuar a ser o log: o CI mostra-o e é a única evidência que fica.
process.stdout.write(saida);

const codigo = resultado.status ?? 1;

/** Resumo de uma linha do Vitest (`Tests  12 passed (12)`, `Test Files  1 failed | …`). */
function resumo(rotulo) {
  const encontrado = new RegExp('^\\s*' + rotulo + '\\s+(.+)$', 'm').exec(saida);
  if (encontrado === null) return null;
  const linha = encontrado[1];
  const falhados = /(\d+)\s+failed/.exec(linha);
  return { linha: linha.trim(), falhados: falhados === null ? 0 : Number(falhados[1]) };
}

/** Blocos da secção «Failed Suites» (não da secção «Failed Tests»). */
function suitesFalhadas() {
  const blocos = [];
  let dentro = false;
  let atual = null;
  for (const linha of saida.split(/\r?\n/)) {
    if (/Failed Suites\s+\d+/.test(linha)) {
      dentro = true;
      continue;
    }
    if (/Failed Tests\s+\d+/.test(linha)) {
      dentro = false;
      continue;
    }
    if (!dentro) continue;
    const inicio = /^\s*FAIL\s+(\S+)/.exec(linha);
    if (inicio !== null) {
      if (atual !== null) blocos.push(atual);
      atual = { ficheiro: inicio[1], texto: '' };
      continue;
    }
    if (atual !== null) atual.texto += linha + '\n';
  }
  if (atual !== null) blocos.push(atual);
  return blocos;
}

/** Bloqueio do sistema de ficheiros: precisa do **código** e da **operação**. */
function bloqueioDeFicheiro(texto) {
  const codigo = /(EBUSY|EPERM|ENOTEMPTY)/.exec(texto);
  const operacao = /(unlink|rmdir|directory not empty|resource busy or locked)/i.test(texto);
  return codigo !== null && operacao;
}

function anotar(tipo, titulo, mensagem) {
  const umaLinha = mensagem.replace(/\s+/g, ' ').trim();
  process.stdout.write(`\n::${tipo} title=${titulo}::${umaLinha}\n`);
}

function resumir(texto) {
  const destino = process.env.GITHUB_STEP_SUMMARY;
  if (!destino) return;
  try {
    appendFileSync(destino, texto + '\n');
  } catch {
    /* o resumo é um extra: não pode fazer falhar o passo */
  }
}

if (codigo === 0) {
  const testes = resumo('Tests');
  process.stdout.write(`\n[ci] suíte verde${testes === null ? '' : ` — ${testes.linha}`}\n`);
  process.exit(0);
}

const testes = resumo('Tests');
const ficheiros = resumo('Test Files');

// 1) Asserção falhada é sempre falha real — sem excepções.
if (testes !== null && testes.falhados > 0) {
  anotar('error', 'Falha de teste', `${testes.falhados} teste(s) falhado(s).`);
  process.exit(1);
}

// 2) Saída diferente de zero que não se consegue explicar: falhar (lado seguro).
if (ficheiros === null || ficheiros.falhados === 0) {
  anotar(
    'error',
    'Falha não classificada',
    `A suíte saiu com ${codigo} mas o resumo não é reconhecido ` +
      `(Tests: ${testes === null ? 'ausente' : testes.linha} | ` +
      `Test Files: ${ficheiros === null ? 'ausente' : ficheiros.linha}). ` +
      'Um erro de carregamento, um erro de sintaxe ou uma mudança de formato contam como falha.',
  );
  process.exit(1);
}

// 3) Só ficheiros falhados, nenhum teste falhado: ambiente **se** a assinatura for de bloqueio.
const culpados = suitesFalhadas();
const ambiente = culpados.filter((bloco) => bloqueioDeFicheiro(bloco.texto));

if (culpados.length === 0) {
  anotar(
    'error',
    'Falha não classificada',
    `${ficheiros.falhados} ficheiro(s) falhado(s) sem bloco «Failed Suites» legível — ` +
      'contado como falha real.',
  );
  process.exit(1);
}

if (ambiente.length === culpados.length) {
  const nomes = ambiente.map((bloco) => bloco.ficheiro).join(', ');
  anotar(
    'warning',
    'Falha de ambiente, não de teste',
    `${ambiente.length} ficheiro(s) falharam no teardown por bloqueio de ficheiro (${nomes}), ` +
      `com **zero** asserções falhadas${testes === null ? '' : ` (${testes.linha})`}. ` +
      'O CI não fica vermelho por isto — ver `PC-26`.',
  );
  resumir(
    `### Falha de ambiente (não de teste)\n\n` +
      `\`${nomes}\` falhou no teardown por bloqueio de ficheiro, com zero asserções falhadas. ` +
      `Ver \`PC-26\`. O trabalho **não** é dado como verificado por este passo.`,
  );
  process.stdout.write(
    `\n[ci] ${ambiente.length} ficheiro(s) falharam por ambiente (bloqueio de ficheiro no ` +
      `teardown), com zero asserções falhadas. Não conta como falha de teste — ver PC-26.\n`,
  );
  process.exit(0);
}

// 4) Mistura: pelo menos um bloco não é ambiente → falha real.
const reais = culpados
  .filter((bloco) => !bloqueioDeFicheiro(bloco.texto))
  .map((bloco) => bloco.ficheiro)
  .join(', ');
anotar(
  'error',
  'Falha real em suite',
  `${culpados.length - ambiente.length} ficheiro(s) falharam por algo que não é ambiente: ${reais}`,
);
process.exit(1);
