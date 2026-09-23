/**
 * Verificação dos números do `README.md`.
 *
 * ## Porque existe
 *
 * O README é o primeiro documento que alguém lê e o único sítio do projeto onde os números
 * são escritos **à mão**. Todos os outros — as suítes de verificação — reportam o seu próprio
 * total quando correm. Três não reportavam nada: «27 tabelas», «30 rotas» e «30 decisões»
 * viviam só na cabeça de quem os escreveu, e envelheceram sem ninguém dar por isso (`PC-7`,
 * `AUD-010`). Medido em 2026-09-22, os três estavam errados ao mesmo tempo, e a mesma deriva
 * tinha levado mais cinco números do mesmo documento.
 *
 * ## O que este comando mede
 *
 * Mede o que é **estático e determinístico** — contar ocorrências num ficheiro — e por isso
 * corre em menos de um segundo, sem servidor, sem base de dados e sem rede:
 *
 *  - **tabelas** — modelos do schema canónico (`prisma/schema.prisma`), com verificação
 *    cruzada da variante SQLite, que é **gerada** e tem de concordar;
 *  - **rotas da web** — atributos `path="…"` em `apps/web/src/App.tsx`, excluindo o
 *    apanha-tudo `path="*"` (que não é um ecrã: é o `NotFound`, e há um segundo no
 *    onboarding que reencaminha para a primeira etapa);
 *  - **decisões** — secções `## A<n>` de `docs/DECISIONS.md`.
 *
 * ## O que este comando **não** mede, e porquê
 *
 * Os totais das suítes (`npm test`, `verify`, `verify:regressions`, `verify:config`,
 * `verify:integration`) não são medidos aqui: cada um já é reportado pelo comando que o
 * corre, e medi-los obrigaria este script a arrancar uma base de dados, uma API e, no caso
 * da integração, um build de produção com PostgreSQL — transformando uma verificação de um
 * segundo numa de dez minutos, que ninguém correria.
 *
 * Para esses, o que se verifica é a **coerência interna**: o mesmo total declarado em sítios
 * diferentes do README tem de ser o mesmo número. Isto não prova que o número está certo —
 * prova que não está a divergir de si próprio, que é como a deriva começa.
 *
 * ## Uso
 *
 *   node scripts/check-readme-numbers.mjs            # mede e mostra
 *   node scripts/check-readme-numbers.mjs --check    # exit 1 se divergir
 *
 * Códigos de saída, e porque não são os mesmos:
 *
 *  - **0** — o README concorda com o repositório no que este comando mede;
 *  - **1** — o README diverge, mas só em `--check` (sem ele é um relatório que se lê);
 *  - **1 sempre** — o comando deixou de encontrar um valor que devia vigiar. Isto não é um
 *    facto sobre o README, é um defeito **deste** comando, e um verificador cego nunca é um
 *    estado normal. Foi uma mutação que o revelou: a frase de `:153` foi reescrita, o
 *    comando disse «não encontrado» e saiu **0** — passava por omissão exatamente no caso
 *    que a expressão regular existe para apanhar.
 *
 * A comparação lê os valores **declarados** no README com expressões regulares. Se uma
 * dessas frases for reescrita sem manter o número na mesma forma, a comparação deixa de
 * encontrar o valor e **falha** — em vez de passar por omissão. É deliberado: um verificador
 * que deixa de ver o que devia vigiar é pior do que não existir.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Raiz do repositório, ancorada na localização deste ficheiro (nunca no `cwd`). */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function ler(caminho) {
  return readFileSync(resolve(ROOT, caminho), 'utf8');
}

/**
 * O README escreve os milhares com um espaço (pt-PT): «42 381 km». Normalizar aqui permite
 * declarar `1 841` no documento e continuar a compará-lo como o número 1841.
 */
function paraNumero(texto) {
  return Number(texto.replace(/[\s\u00a0\u202f\u2009]/g, ''));
}

/** Linha (1-based) onde uma posição cai — para o relatório apontar o sítio, não só o valor. */
function linhaDe(texto, indice) {
  return texto.slice(0, indice).split('\n').length;
}

/**
 * Escreve o número como o README o escreve (milhares separados por um espaço). Não se usa
 * `toLocaleString('pt-PT')` porque o resultado depende do ICU que o Node tiver embutido —
 * neste ambiente devolve `1841` e no README está `1 841`, e um relatório que escreve os
 * números de outra maneira do que o documento que vigia é uma comparação a mais para fazer
 * de olhos.
 */
function formatar(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Fragmento que casa com um número com separador de milhares opcional.
 *
 * O espaço é escrito à mão (`[\d\u00a0\u202f\u2009 ]`) em vez de `\s` de propósito: `\s`
 * inclui a mudança de linha, e um padrão que atravessa linhas apanha o número da frase
 * seguinte — o género de correspondência larga que faz um verificador parecer sensível
 * quando não é.
 */
const NUM = String.raw`(\d[\d\u00a0\u202f\u2009 ]*)`;

/* -------------------------------------------------------------------------- */
/* Medições estáticas                                                          */
/* -------------------------------------------------------------------------- */

function medirTabelas() {
  const canonico = (ler('apps/api/prisma/schema.prisma').match(/^model /gm) ?? []).length;
  const sqlite = (ler('apps/api/prisma/sqlite/schema.sqlite.prisma').match(/^model /gm) ?? [])
    .length;
  return {
    valor: canonico,
    nota: `schema canónico e variante SQLite: ${canonico} / ${sqlite}`,
    problema:
      canonico === sqlite
        ? null
        : 'os dois schemas divergem — correr `npm run db:sync-schema` (o SQLite é gerado)',
  };
}

function medirRotasWeb() {
  const caminhos = (ler('apps/web/src/App.tsx').match(/path="[^"]*"/g) ?? []).map((p) =>
    p.slice('path="'.length, -1),
  );
  const apanhaTudo = caminhos.filter((c) => c === '*').length;
  return {
    valor: caminhos.length - apanhaTudo,
    nota: `\`path="…"\` em \`App.tsx\`, sem o apanha-tudo (${apanhaTudo} de ${caminhos.length} excluído(s))`,
    problema: null,
  };
}

function medirDecisoes() {
  const ids = ler('docs/DECISIONS.md').match(/^## A\d+/gm) ?? [];
  return {
    valor: ids.length,
    nota: `última: ${ids.at(-1)?.replace('## ', '') ?? '(nenhuma)'}`,
    problema: null,
  };
}

/**
 * Grupos **medidos**: o script sabe o valor e exige que todas as declarações do README
 * concordem com ele. `padroes` são fontes de expressão regular; cada uma captura o número
 * declarado no grupo 1.
 */
const MEDIDOS = [
  {
    rotulo: 'tabelas',
    medir: medirTabelas,
    padroes: [String.raw`Modelo de dados \(${NUM} tabelas`],
  },
  {
    rotulo: 'rotas da web',
    medir: medirRotasWeb,
    padroes: [String.raw`mobile-first, ${NUM} rotas`],
  },
  {
    rotulo: 'decisões',
    medir: medirDecisoes,
    padroes: [String.raw`${NUM} decisões`],
  },
];

/**
 * Grupos **de coerência**: o script não sabe o valor (só a suíte o reporta), mas exige que
 * todas as declarações do mesmo total sejam iguais entre si.
 */
const COERENTES = [
  {
    rotulo: 'testes automáticos',
    padroes: [
      String.raw`Testes \(${NUM} automáticos`,
      String.raw`npm test\s+#\s+${NUM} testes automáticos`,
    ],
    comando: '`npm test`',
  },
  {
    rotulo: 'ponta a ponta',
    padroes: [String.raw`${NUM} ponta a ponta`, String.raw`${NUM} verificações ponta a ponta`],
    comando: '`npm run verify`',
  },
  {
    rotulo: 'regressões',
    padroes: [String.raw`${NUM} regressões`],
    comando: '`npm run verify:regressions`',
  },
  {
    rotulo: 'guardas de configuração',
    padroes: [String.raw`${NUM} guardas`, String.raw`${NUM} cenários`],
    comando: '`npm run verify:config`',
  },
  {
    rotulo: 'integração em produção',
    padroes: [String.raw`${NUM} integração`, String.raw`${NUM} verificações da integração`],
    comando: '`npm run verify:integration`',
  },
  {
    rotulo: 'testes do domínio',
    padroes: [String.raw`${NUM} testes do domínio`],
    comando: '`npm test` (ficheiro `test/domain.test.ts`)',
  },
];

/** Recolhe todas as declarações de um grupo, com a linha onde estão. */
function declaracoes(readme, padroes) {
  const out = [];
  for (const fonte of padroes) {
    for (const m of readme.matchAll(new RegExp(fonte, 'g'))) {
      out.push({ valor: paraNumero(m[1]), linha: linhaDe(readme, m.index) });
    }
  }
  return out.sort((a, b) => a.linha - b.linha);
}

/* -------------------------------------------------------------------------- */
/* Relatório                                                                   */
/* -------------------------------------------------------------------------- */

const apenasVerificar = process.argv.includes('--check');
const readme = ler('README.md');

console.log('\n\u001b[1mZemlo — números do README\u001b[0m');
console.log(
  '\u001b[90m  Medido aqui: estático e determinístico — sem servidor, sem base de dados, sem rede.\u001b[0m\n',
);

let divergencias = 0;
let ilegiveis = 0;

console.log('  \u001b[1mMedido\u001b[0m');
for (const grupo of MEDIDOS) {
  const { valor, nota, problema } = grupo.medir();
  const vistas = declaracoes(readme, grupo.padroes);

  if (vistas.length === 0) {
    ilegiveis += 1;
    console.log(`  \u001b[31m? ${grupo.rotulo}: não encontrado no README\u001b[0m`);
    continue;
  }

  const declarados = [...new Set(vistas.map((v) => v.valor))];
  const erradas = vistas.filter((v) => v.valor !== valor);
  const marca = erradas.length === 0 ? '\u001b[32m✓\u001b[0m' : '\u001b[31m✗\u001b[0m';
  const onde = vistas.map((v) => `:${v.linha}`).join(', ');

  console.log(
    `  ${marca} ${grupo.rotulo}: medido ${valor}, declarado ${declarados.join(' / ')} \u001b[90m(${onde})\u001b[0m`,
  );
  console.log(`      \u001b[90m${nota}\u001b[0m`);

  if (erradas.length > 0) {
    console.log(
      `      \u001b[31mdeclarado errado em ${erradas.map((v) => `:${v.linha}`).join(', ')} — corrigir no README\u001b[0m`,
    );
    divergencias += 1;
  }
  if (problema) {
    console.log(`      \u001b[31m${problema}\u001b[0m`);
    divergencias += 1;
  }
}

console.log(
  '\n  \u001b[1mCoerência interna\u001b[0m \u001b[90m(o mesmo total tem de ser igual em todos os sítios)\u001b[0m',
);
for (const grupo of COERENTES) {
  const vistas = declaracoes(readme, grupo.padroes);

  if (vistas.length === 0) {
    ilegiveis += 1;
    console.log(`  \u001b[31m? ${grupo.rotulo}: não encontrado no README\u001b[0m`);
    continue;
  }

  const distintos = [...new Set(vistas.map((v) => v.valor))];
  const marca = distintos.length === 1 ? '\u001b[32m✓\u001b[0m' : '\u001b[31m✗\u001b[0m';
  const onde = vistas.map((v) => `:${v.linha}`).join(', ');

  console.log(
    `  ${marca} ${grupo.rotulo}: ${distintos.map(formatar).join(' / ')} \u001b[90m(${vistas.length} declarações — ${onde})\u001b[0m`,
  );

  if (distintos.length > 1) {
    console.log(
      `      \u001b[31mo mesmo total aparece com valores diferentes — o valor verdadeiro é o que ${grupo.comando} reportar\u001b[0m`,
    );
    divergencias += 1;
  }
}

console.log(`
  \u001b[90mNão medido aqui, e porquê: os totais das suítes são reportados por elas próprias.\u001b[0m
  \u001b[90m  npm test · npm run verify · npm run verify:regressions · npm run verify:config\u001b[0m
  \u001b[90m  npm run verify:integration — exige o build de produção com PostgreSQL (OPS-006)\u001b[0m
  \u001b[90mO «223 verificações» da nota sobre os testes é um total HISTÓRICO — de quando os três\u001b[0m
  \u001b[90mdefeitos passaram por ele — e não uma afirmação sobre o repositório de hoje: não se mede.\u001b[0m
`);

if (ilegiveis > 0) {
  console.log(
    `  \u001b[31m${ilegiveis} valor(es) não encontrado(s) no README. Se a frase foi reescrita,\u001b[0m\n` +
      '  \u001b[31matualizar aqui a expressão regular — não remover a verificação.\u001b[0m\n',
  );
}

if (divergencias === 0 && ilegiveis === 0) {
  console.log('  \u001b[32mO README concorda com o repositório no que este comando mede.\u001b[0m\n');
  process.exit(0);
}

console.log(
  `  \u001b[31m${divergencias} divergência(s)` +
    (ilegiveis > 0 ? ` e ${ilegiveis} valor(es) que este comando deixou de conseguir vigiar` : '') +
    '.\u001b[0m\n',
);

// Dois casos, dois comportamentos — de propósito.
//
//  - **Não encontrado** é um defeito **deste** comando, não do README: significa que uma
//    frase foi reescrita e a verificação deixou de ver o que devia vigiar. Sai sempre 1,
//    mesmo sem `--check`: um estado em que o verificador é cego nunca é normal.
//  - **Divergência** é um facto sobre o README, que se pode querer ler sem que o comando
//    falhe. Sai 1 só em `--check`, que é o que o CI corre.
if (ilegiveis > 0) process.exit(1);
process.exit(apenasVerificar ? 1 : 0);
