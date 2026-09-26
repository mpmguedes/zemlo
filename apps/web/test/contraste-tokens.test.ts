import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Contraste dos tokens do sistema de desenho (`WEB-011`, achado `PC-24`).
 *
 * ## O que isto mede
 *
 * O contraste de cada par (tinta, fundo) que o produto usa, calculado pela fórmula de
 * luminância relativa da WCAG 2.x: sRGB → linear → `0.2126R + 0.7152G + 0.0722B`, e depois
 * `(maior + 0.05) / (menor + 0.05)`. Limiar **4,5:1** para texto normal e **3:1** para
 * objetos gráficos.
 *
 * ## Porque é que os valores são lidos, e não escritos aqui
 *
 * O oráculo é o `theme.css`. Se o teste fixasse as cores à mão, mudar um token deixaria o
 * teste verde a medir o passado — o falso verde exato que esta tarefa existe para eliminar.
 * Por isso o teste faz o parse do bloco `:root` de cada tema, resolve as cadeias
 * `var(--…)` e só depois calcula.
 *
 * ## Como é que isto não passa por vacuidade
 *
 * Três guardas, todas capazes de fazer o teste falhar:
 *
 *  1. O leitor afirma que encontrou os dois temas e um número mínimo de tokens, e que
 *     contém dois valores sentinela conhecidos. Um `theme.css` que deixasse de ser lido
 *     (mudança de caminho, bloco renomeado) falha aqui em vez de passar com zero pares.
 *  2. Cada par resolve as suas tintas; um token inexistente **lança**, não é ignorado.
 *  3. O número de grupos de pares é afirmado exatamente: apagar pares para ficar verde
 *     exige editar o número, ou seja, é uma decisão e não um acidente.
 *
 * ## O que isto não prova
 *
 * Não é um teste de browser: não sabe que elementos existem no DOM nem qual é o fundo
 * efetivo de cada um. Mede o que os tokens prometem. A ligação entre o token e o seletor é
 * afirmada à parte, no último bloco, por leitura do CSS.
 */

const TEMA = fileURLToPath(new URL('../src/styles/theme.css', import.meta.url));
const APP = fileURLToPath(new URL('../src/styles/app.css', import.meta.url));
const SHELL = fileURLToPath(new URL('../src/app/AppShell.tsx', import.meta.url));

/* ---------------------------------------------------------------- aritmética */

function paraRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const inteiro = Number.parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return { r: (inteiro >> 16) & 255, g: (inteiro >> 8) & 255, b: inteiro & 255 };
}

function canalLinear(canal: number): number {
  const s = canal / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminancia(hex: string): number {
  const { r, g, b } = paraRgb(hex);
  return 0.2126 * canalLinear(r) + 0.7152 * canalLinear(g) + 0.0722 * canalLinear(b);
}

/** Rácio de contraste. A divisão é sempre maior/menor: ordenar por ordem descendente. */
function razao(a: string, b: string): number {
  const [maior, menor] = [luminancia(a), luminancia(b)].sort((x, y) => y - x) as [number, number];
  return (maior + 0.05) / (menor + 0.05);
}

/* ------------------------------------------------------------------ leitura */

/** Corpo do primeiro bloco `:root` do texto dado (as declarações, sem as chaves). */
function corpoRoot(css: string, rotulo: string): string {
  const encontrado = /(?:^|\n)[ \t]*:root[ \t]*\{/.exec(css);
  if (!encontrado) throw new Error(`${rotulo}: bloco ":root" não encontrado`);
  const abre = css.indexOf('{', encontrado.index);
  const fecha = css.indexOf('}', abre);
  if (abre < 0 || fecha < 0) throw new Error(`${rotulo}: bloco ":root" mal formado`);
  return css.slice(abre + 1, fecha);
}

function lerTokens(corpo: string): Map<string, string> {
  const mapa = new Map<string, string>();
  const re = /(--[a-z0-9-]+)[ \t]*:[ \t]*([^;]+);/g;
  let achado: RegExpExecArray | null;
  while ((achado = re.exec(corpo)) !== null) {
    const nome = achado[1];
    const valor = achado[2];
    if (nome === undefined || valor === undefined) continue;
    mapa.set(nome, valor.trim());
  }
  return mapa;
}

const bruto = readFileSync(TEMA, 'utf8');
const fronteira = bruto.indexOf('@media (prefers-color-scheme: dark)');
if (fronteira < 0) throw new Error('theme.css: bloco do tema escuro não encontrado');

/** Tema claro: escalas e papéis. Tema escuro: só os papéis que o tema redefine. */
const claro = lerTokens(corpoRoot(bruto.slice(0, fronteira), 'tema claro'));
const escuro = lerTokens(corpoRoot(bruto.slice(fronteira), 'tema escuro'));

/**
 * Resolve um token até um `#rrggbb`, seguindo cadeias `var(--x)`.
 *
 * No tema escuro as escalas (`--z-petrol-300`, …) não são redefinidas — vivem no `:root`
 * global —, por isso o mapa escuro cai no claro quando não encontra o nome. É a semântica
 * real da cascata, não uma conveniência do teste.
 */
function resolver(nome: string, mapa: Map<string, string>, fallback?: Map<string, string>): string {
  const visto = new Set<string>();
  let atual = nome;
  for (let passo = 0; passo < 20; passo++) {
    if (visto.has(atual)) throw new Error(`${nome}: ciclo de var() em ${atual}`);
    visto.add(atual);
    const valor = mapa.get(atual) ?? fallback?.get(atual);
    if (valor === undefined) throw new Error(`${nome}: token "${atual}" não existe em theme.css`);
    const referencia = /^var\((--[a-z0-9-]+)\)$/.exec(valor);
    if (referencia) {
      const seguinte = referencia[1];
      if (seguinte === undefined) break;
      atual = seguinte;
      continue;
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(valor)) {
      throw new Error(`${nome}: "${atual}" não é uma cor medível (valor: ${valor})`);
    }
    return valor;
  }
  throw new Error(`${nome}: não foi possível resolver (demasiados passos)`);
}

const corClaro = (nome: string): string => resolver(nome, claro);
const corEscuro = (nome: string): string => resolver(nome, escuro, claro);

/* -------------------------------------------------------------------- pares */

type Grupo = readonly [tinta: string, fundos: readonly string[], limiar: number];

const TEXTO = 4.5;
const GRAFICO = 3;

const FUNDOS_CLAROS = [
  '--z-bg-elevated',
  '--z-bg',
  '--z-bg-sunken',
  '--z-bg-soft',
  '--z-accent-soft',
  '--z-ok-soft',
  '--z-danger-soft',
  '--z-warn-soft',
  '--z-info-soft',
] as const;

const GRUPOS_CLARO: readonly Grupo[] = [
  ['--z-text', FUNDOS_CLAROS, TEXTO],
  ['--z-ink', ['--z-bg-elevated', '--z-bg', '--z-bg-sunken', '--z-bg-soft'], TEXTO],
  [
    '--z-text-muted',
    ['--z-bg-elevated', '--z-bg', '--z-bg-sunken', '--z-warn-soft', '--z-accent-soft', '--z-ok-soft', '--z-danger-soft', '--z-info-soft'],
    TEXTO,
  ],
  ['--z-text-subtle', ['--z-bg-elevated', '--z-bg', '--z-bg-sunken', '--z-bg-soft'], TEXTO],
  ['--z-accent-ink', ['--z-bg-elevated', '--z-bg', '--z-bg-sunken', '--z-accent-soft', '--z-bg-soft'], TEXTO],
  ['--z-accent-contrast', ['--z-accent'], TEXTO],
  ['--z-highlight-ink', ['--z-warn-soft'], TEXTO],
  ['--z-highlight-contrast', ['--z-highlight'], TEXTO],
  ['--z-ok-ink', ['--z-ok-soft', '--z-bg-elevated', '--z-bg', '--z-bg-sunken'], TEXTO],
  ['--z-ok-contrast', ['--z-ok-ink'], TEXTO],
  ['--z-danger-ink', ['--z-danger-soft', '--z-bg-elevated', '--z-bg', '--z-bg-sunken'], TEXTO],
  ['--z-danger-contrast', ['--z-danger'], TEXTO],
  ['--z-danger', ['--z-bg-elevated', '--z-bg', '--z-bg-sunken'], TEXTO],
  ['--z-info-ink', ['--z-info-soft'], TEXTO],
  ['--z-text-on-inverse', ['--z-bg-inverse'], TEXTO],
  ['--z-border-focus', ['--z-bg-elevated', '--z-bg', '--z-bg-sunken', '--z-accent-soft'], GRAFICO],
  ['--z-accent', ['--z-bg-elevated', '--z-bg', '--z-accent-soft'], GRAFICO],
  ['--z-danger', ['--z-bg-elevated', '--z-danger-soft'], GRAFICO],
  ['--z-ok', ['--z-bg-elevated', '--z-ok-soft'], GRAFICO],
  ['--z-highlight-strong', ['--z-bg-elevated', '--z-bg', '--z-bg-sunken', '--z-warn-soft'], GRAFICO],
  ['--z-petrol-400', ['--z-bg-elevated', '--z-bg'], GRAFICO],
];

const GRUPOS_ESCURO: readonly Grupo[] = [
  ['--z-text', FUNDOS_CLAROS, TEXTO],
  ['--z-ink', ['--z-bg-elevated', '--z-bg', '--z-bg-sunken', '--z-bg-soft'], TEXTO],
  [
    '--z-text-muted',
    ['--z-bg-elevated', '--z-bg', '--z-bg-sunken', '--z-warn-soft', '--z-accent-soft', '--z-ok-soft', '--z-danger-soft', '--z-info-soft'],
    TEXTO,
  ],
  ['--z-text-subtle', ['--z-bg-elevated', '--z-bg', '--z-bg-sunken', '--z-bg-soft'], TEXTO],
  ['--z-accent-ink', ['--z-bg-elevated', '--z-bg', '--z-bg-sunken', '--z-accent-soft', '--z-bg-soft'], TEXTO],
  ['--z-accent-contrast', ['--z-accent'], TEXTO],
  ['--z-highlight-ink', ['--z-warn-soft'], TEXTO],
  ['--z-highlight-contrast', ['--z-highlight'], TEXTO],
  ['--z-ok-ink', ['--z-ok-soft', '--z-bg-elevated', '--z-bg', '--z-bg-sunken'], TEXTO],
  ['--z-ok-contrast', ['--z-ok-ink'], TEXTO],
  ['--z-danger-ink', ['--z-danger-soft', '--z-bg-elevated', '--z-bg', '--z-bg-sunken'], TEXTO],
  ['--z-danger-contrast', ['--z-danger'], TEXTO],
  ['--z-danger', ['--z-bg-elevated', '--z-bg', '--z-bg-sunken', '--z-danger-soft'], TEXTO],
  ['--z-info-ink', ['--z-info-soft'], TEXTO],
  ['--z-text-on-inverse', ['--z-bg-inverse'], TEXTO],
  ['--z-border-focus', ['--z-bg-elevated', '--z-bg', '--z-bg-sunken', '--z-accent-soft'], GRAFICO],
  ['--z-accent', ['--z-bg-elevated', '--z-bg', '--z-accent-soft'], GRAFICO],
  ['--z-danger', ['--z-bg-elevated'], GRAFICO],
  ['--z-ok', ['--z-bg-elevated', '--z-ok-soft'], GRAFICO],
  ['--z-highlight-strong', ['--z-bg-elevated', '--z-bg', '--z-bg-sunken', '--z-warn-soft'], GRAFICO],
  ['--z-petrol-400', ['--z-bg-elevated', '--z-bg'], GRAFICO],
];

/* ------------------------------------------------------------------- testes */

describe('leitura de theme.css (guardas anti-vacuidade)', () => {
  it('encontrou os dois temas e um número plausível de tokens', () => {
    expect(claro.size).toBeGreaterThanOrEqual(70);
    expect(escuro.size).toBeGreaterThanOrEqual(30);
  });

  it('os valores sentinela são os esperados (o leitor leu mesmo o ficheiro certo)', () => {
    expect(corClaro('--z-neutral-900')).toBe('#182020');
    expect(corClaro('--z-petrol-500')).toBe('#178186');
    expect(corEscuro('--z-bg-elevated')).toBe('#1f2727');
    expect(corEscuro('--z-petrol-300')).toBe('#66bcba');
  });

  it('a lista de pares não encolheu', () => {
    expect(GRUPOS_CLARO).toHaveLength(21);
    expect(GRUPOS_ESCURO).toHaveLength(21);
  });
});

describe('contraste — tema claro', () => {
  for (const [tinta, fundos, limiar] of GRUPOS_CLARO) {
    it(`${tinta} ≥ ${limiar}:1 em todos os fundos em que é usado`, () => {
      const cor = corClaro(tinta);
      const falhas = fundos
        .map((fundo) => ({ fundo, r: razao(cor, corClaro(fundo)) }))
        .filter((x) => x.r < limiar)
        .map((x) => `${x.fundo} = ${x.r.toFixed(2)}:1`);
      expect(falhas, `${tinta} (${cor}) falhou em: ${falhas.join(', ')}`).toEqual([]);
    });
  }
});

describe('contraste — tema escuro', () => {
  for (const [tinta, fundos, limiar] of GRUPOS_ESCURO) {
    it(`${tinta} ≥ ${limiar}:1 em todos os fundos em que é usado`, () => {
      const cor = corEscuro(tinta);
      const falhas = fundos
        .map((fundo) => ({ fundo, r: razao(cor, corEscuro(fundo)) }))
        .filter((x) => x.r < limiar)
        .map((x) => `${x.fundo} = ${x.r.toFixed(2)}:1`);
      expect(falhas, `${tinta} (${cor}) falhou em: ${falhas.join(', ')}`).toEqual([]);
    });
  }
});

describe('os tokens corrigidos', () => {
  it('--z-text-muted sobe de neutral-500 (#6f7d7c) para neutral-600', () => {
    expect(corClaro('--z-text-muted')).toBe('#55605f');
  });

  it('a tinta de `ok` é o tom escurecido medido, e não o tom de marca', () => {
    expect(corClaro('--z-ok-ink')).toBe('#1b784f');
    expect(corClaro('--z-ok-ink')).not.toBe(corClaro('--z-ok'));
  });

  it('a tinta de `danger` é o tom escurecido medido', () => {
    expect(corClaro('--z-danger-ink')).toBe('#ba3e0c');
  });

  it('a tinta de acento é petróleo-600 no claro e petróleo-300 no escuro', () => {
    expect(corClaro('--z-accent-ink')).toBe('#126a70');
    expect(corEscuro('--z-accent-ink')).toBe('#66bcba');
  });

  it('no escuro a faixa informativa deixou de assentar escuro sobre escuro', () => {
    expect(corEscuro('--z-info-ink')).toBe('#9ed6d3');
    expect(razao(corEscuro('--z-info-ink'), corEscuro('--z-info-soft'))).toBeGreaterThanOrEqual(4.5);
  });

  it('o texto sobre âmbar usa âmbar-900 nos dois temas', () => {
    expect(corClaro('--z-highlight-contrast')).toBe('#4d340a');
    expect(corEscuro('--z-highlight-contrast')).toBe('#4d340a');
  });
});

describe('as cores originais da marca continuam disponíveis', () => {
  it('o `#1f8a5b` de `ok` não foi substituído', () => {
    expect(corClaro('--z-state-ok')).toBe('#1f8a5b');
    expect(corClaro('--z-ok')).toBe('#1f8a5b');
  });

  it('o `#c2410c` de `danger` não foi substituído', () => {
    expect(corClaro('--z-state-danger')).toBe('#c2410c');
    expect(corClaro('--z-danger')).toBe('#c2410c');
  });

  it('as superfícies suaves ficaram como estavam (a correção foi nas tintas)', () => {
    expect(corClaro('--z-ok-soft')).toBe('#e5f4ec');
    expect(corClaro('--z-danger-soft')).toBe('#fbeae3');
    expect(corClaro('--z-accent-soft')).toBe('#cdeae8');
    expect(corClaro('--z-warn-soft')).toBe('#fbecc2');
  });
});

describe('a correção está nos tokens, não em cores escritas nos componentes', () => {
  it('app.css não tem nenhuma cor literal em `color:`', () => {
    const ofensas = readFileSync(APP, 'utf8')
      .split('\n')
      .map((linha, i) => ({ texto: linha.trim(), n: i + 1 }))
      .filter(({ texto }) => /^color:[ \t]*(#[0-9a-fA-F]{3,8}|rgba?\()/.test(texto))
      .map(({ texto, n }) => `app.css:${n} ${texto}`);
    expect(ofensas, `cores escritas à mão: ${ofensas.join(' | ')}`).toEqual([]);
  });

  it('o `＋` da barra inferior usa o token de tinta sobre âmbar', () => {
    /*
     * UX-02: a tinta do «Registar» deixou de estar num `style` inline no `AppShell` e passou
     * para a classe `.z-tabbar__action` em `app.css` — que é onde as regras da barra vivem
     * agora, a par do resto do bloco. A asserção continua a medir o que interessa («a tinta
     * de âmbar vem do token, não de um `#fff` escrito à mão»), no sítio onde a regra está.
     */
    const css = readFileSync(APP, 'utf8');
    const regra = /\.z-tabbar__action\s*\{[^}]*\}/.exec(css);
    expect(regra, 'regra .z-tabbar__action não encontrada em app.css').not.toBeNull();
    expect(regra?.[0]).toContain('var(--z-highlight-contrast)');
    expect(regra?.[0]).toContain('background: var(--z-highlight)');

    // O `AppShell` já não escreve cor nenhuma à mão — nem em `style`, nem em token solto.
    const shell = readFileSync(SHELL, 'utf8');
    expect(shell).not.toMatch(/color:[ \t]*'#/);
  });

  it('a faixa informativa não usa um tom fixo da escala', () => {
    expect(readFileSync(APP, 'utf8')).not.toMatch(/color:[ \t]*var\(--z-petrol-800\)/);
  });
});

/*
 * Consolidação do movimento e do foco (UX-01).
 *
 * ## Porque é que isto é um teste, e não uma nota no `theme.css`
 *
 * A A1 criou os tokens (`--z-duration-*`, `--z-ease*`, `--z-focus-ring-*`) mas **nada em
 * `app.css` os consumia**: medido, `grep -c "z-duration" app.css` dava 0. Um token que ninguém
 * lê é decoração — e a frente UX-01 existe para que o ritmo do produto se possa mudar num sítio
 * só. O que se fixa aqui é a **ligação**, não o valor: os literais `0.12s`/`140ms`/`0.15s`/`0.2s`
 * que estavam espalhados voltaram a um token, e o foco deixou de ter um `2px`/`3px` solto.
 *
 * A mutação que prova que isto morde: repor `outline: 2px` na regra global de `:focus-visible`
 * não fazia cair teste NENHUM antes desta frente (medido: 411 passados com a mutação aplicada).
 * Com as asserções abaixo, cai.
 */
describe('o movimento e o foco usam os tokens da UX-01 (A1)', () => {
  const css = (): string => readFileSync(APP, 'utf8');

  it('os tokens de movimento e foco existem no tema', () => {
    const tema = readFileSync(TEMA, 'utf8');
    for (const token of [
      '--z-duration-fast',
      '--z-duration',
      '--z-duration-slow',
      '--z-ease',
      '--z-ease-out',
      '--z-focus-ring-width',
      '--z-focus-ring-offset',
    ]) {
      expect(tema, token).toContain(`${token}:`);
    }
  });

  it('nenhuma duração de transição vive como literal em `app.css`', () => {
    /*
     * As três notações que existiam (`0.12s`, `140ms`, `0.15s`) e as duas que restavam (`0.2s`,
     * o `0.18s` da folha) foram para token. Se alguém voltar a escrever uma duração de interação
     * à mão numa `transition`/`animation`, isto cai.
     *
     * ## O que fica de fora, e porquê — deliberadamente
     *
     *  - `prefers-reduced-motion` (`0.001ms !important`): é a regra que DESLIGA o movimento; um
     *    token de duração não a pode substituir. Fixada no teste seguinte.
     *  - Animações de **ciclo infinito** (`z-spin` 0.7s, `z-shimmer` 1.4s): são ambientes, não
     *    transições. As durações de A1 (`0.14`/`0.16`/`0.18s`) são o ritmo de uma interação; um
     *    indicador de carregamento a 0.16s por volta é um risco de convulsões, não uma
     *    consolidação. O jogo de tokens de A1 **não tem** um token ambiente, e inventar um aqui
     *    seria criar um segundo vocabulário de movimento — exatamente o que a UX-01 evita. Fica
     *    registado: se o produto quiser um ritmo ambiente, é um token novo a decidir pela A1.
     */
    const ofensas = css()
      .split('\n')
      .map((linha, i) => ({ texto: linha.trim(), n: i + 1 }))
      .filter(({ texto }) => !texto.startsWith('*') && !texto.startsWith('/*'))
      .filter(({ texto }) => /^(transition|animation)(-duration)?[ \t]*:/.test(texto))
      // Um ciclo infinito é ambiente: fora do âmbito das durações de interação.
      .filter(({ texto }) => !/\binfinite\b/.test(texto))
      .filter(({ texto }) => /[0-9.]+m?s\b/.test(texto.replace(/0\.001ms/g, '').replace(/\b0s\b/g, '')))
      .map(({ texto, n }) => `app.css:${n} ${texto}`);
    expect(ofensas, `durações escritas à mão: ${ofensas.join(' | ')}`).toEqual([]);

    /*
     * Anti-vacuidade do filtro: se um dia as únicas animações infinitas desaparecerem, este
     * teste continua a valer — mas se a regex deixar de casar as transições, falha aqui em vez
     * de passar sobre uma lista vazia. Os dois loops ambiente conhecidos são fixados por nome.
     */
    expect(css()).toMatch(/animation: z-spin [0-9.]+s linear infinite/);
    expect(css()).toMatch(/animation: z-shimmer [0-9.]+s ease infinite/);
    expect(css()).toContain('var(--z-duration)');
  });

  it('as regras de transição consomem os tokens de duração e curva', () => {
    // Anti-vacuidade: se a consolidação não tivesse acontecido, isto falhava no primeiro par.
    expect(css()).toContain('var(--z-duration)');
    expect(css()).toContain('var(--z-duration-fast)');
    expect(css()).toContain('var(--z-duration-slow)');
    expect(css()).toContain('var(--z-ease)');
    expect(css()).toContain('var(--z-ease-out)');
  });

  it('o anel de foco não tem números soltos — nem na regra global, nem nos cartões', () => {
    /*
     * O `:focus-visible` global usava `2px`/`2px` e o cartão de veículo `3px`/`3px` — o mesmo
     * anel em duas espessuras. Ambos passam pelos tokens. `outline: none` no `.z-input:focus` é
     * legítimo e não é tocado: é a supressão deliberada do contorno nativo, com o anel próprio
     * desenhado por `box-shadow`.
     */
    const ofensas = css()
      .split('\n')
      .map((linha, i) => ({ texto: linha.trim(), n: i + 1 }))
      .filter(({ texto }) => !texto.startsWith('*') && !texto.startsWith('/*'))
      .filter(({ texto }) => /^outline(-offset)?[ \t]*:[ \t]*[0-9]/.test(texto))
      .map(({ texto, n }) => `app.css:${n} ${texto}`);
    expect(ofensas, `espessuras de foco escritas à mão: ${ofensas.join(' | ')}`).toEqual([]);

    // A regra global e os dois casos especiais leem o token.
    const regraGlobal = /:focus-visible \{[\s\S]{0,200}?\}/.exec(css())?.[0] ?? '';
    expect(regraGlobal).toContain('var(--z-focus-ring-width)');
    expect(regraGlobal).toContain('var(--z-focus-ring-offset)');
    expect(css()).toContain(
      '.z-vehicle-card:focus-visible {\n  outline: var(--z-focus-ring-width) solid var(--z-border-focus);',
    );
  });

  it('`prefers-reduced-motion` continua a desligar movimento, e por isso não passa pelo token', () => {
    /*
     * A regra global mata a transição com `0.001ms !important`. É deliberadamente literal: um
     * token de duração não pode substituí-la, ou o produto perderia a única garantia de que a
     * preferência é respeitada em todo o lado. O teste fixa-a para que uma consolidação futura
     * não a «arrume» para dentro do sistema de tokens.
     */
    expect(css()).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]{0,400}?transition-duration: 0\.001ms !important/,
    );
    expect(css()).toMatch(/animation-duration: 0\.001ms !important/);
  });

  /*
   * Retorno de pressão nos controlos (UX-01).
   *
   * Medido antes desta guarda: apagar a regra `.z-btn--ghost:active:not(:disabled)` de
   * `app.css` deixava a suite inteira verde (416 passados). Sem cobertura, o `:active` que
   * esta frente acrescentou aos botões de contorno/texto era uma alteração que nada protegia —
   * e o defeito que ele corrige é real: em ecrã tátil não há `:hover`, pelo que um botão sem
   * `:active` não devolve retorno nenhum ao toque (o mesmo achado da §43 no cartão de veículo).
   */
  it('os botões de contorno, texto e perigo devolvem retorno de pressão', () => {
    const c = css();
    for (const seletor of [
      '.z-btn--secondary:active:not(:disabled)',
      '.z-btn--ghost:active:not(:disabled)',
      '.z-btn--danger:active:not(:disabled)',
      '.z-btn--highlight:active:not(:disabled)',
    ]) {
      expect(c, seletor).toContain(seletor);
    }
    // O `:not(:disabled)` empata a especificidade com o `:hover` da casa; sem ele, a regra de
    // pressão perderia a cascata para o `:hover` e o retorno de toque não apareceria.
    expect(c).toMatch(
      /\.z-btn--ghost:active:not\(:disabled\) \{[\s\S]{0,120}?background: var\(--z-accent-soft\)/,
    );
    expect(c).toMatch(
      /\.z-btn--secondary:active:not\(:disabled\) \{[\s\S]{0,120}?background: var\(--z-bg-sunken\)/,
    );
  });

  it('o botão de ícone também responde ao toque', () => {
    // `z-icon-btn` não tem `:disabled` em uso nenhum; o que lhe faltava era o `:active`.
    expect(css()).toMatch(/\.z-icon-btn:active \{[\s\S]{0,120}?background: var\(--z-border\)/);
  });
});

/*
 * Invariante de família: toda a regra que PINTA uma superfície de marca/estado e escreve
 * texto por cima é medida, nos dois temas. É exactamente o sítio onde viviam os `#fff`
 * escritos à mão — e a razão pela qual o teste não se limita a uma lista de regras
 * conhecidas: uma regra nova com o par errado entra aqui sozinha.
 *
 * É este bloco que morde quando alguém volta a pôr `background: var(--z-ok)` no aviso de
 * sucesso, ou `color: var(--z-ok)` na etiqueta: o par (superfície, tinta) deixa de passar
 * sem que nenhum token tenha mudado.
 */
describe('toda a superfície pintada com texto por cima passa o limiar', () => {
  /*
   * Superfícies que a regra pinta. Inclui as sólidas (o fundo é a própria cor de marca) e
   * as suaves — a etiqueta `ok` assenta em `--z-ok-soft`, e sem estas o teste deixava passar
   * uma etiqueta ligada ao tom errado. As `--z-bg-*` entram porque são superfícies reais de
   * cartão e de página.
   */
  const SUPERFICIES = [
    '--z-ok',
    '--z-ok-ink',
    '--z-danger',
    '--z-accent',
    '--z-highlight',
    '--z-bg-inverse',
    '--z-ok-soft',
    '--z-danger-soft',
    '--z-warn-soft',
    '--z-accent-soft',
    '--z-info-soft',
    '--z-bg-soft',
    '--z-bg-sunken',
    '--z-bg-elevated',
  ];

  const TEMAS: [string, Map<string, string>, Map<string, string> | undefined][] = [
    ['claro', claro, undefined],
    ['escuro', escuro, claro],
  ];

  it('encontra as regras e mede-as nos dois temas', () => {
    const regras: { seletor: string; fundo: string; tinta: string }[] = [];
    /*
     * `color: inherit` é a única tinta aceitável que não é um token: herda a cor de texto da
     * página, que o grupo `--z-text` mede à parte. Qualquer OUTRA tinta que não seja um
     * token falha aqui — é a guarda contra "não consegui medir, portanto passo".
     */
    const naoMediveis: string[] = [];

    for (const achado of readFileSync(APP, 'utf8').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const decls = achado[2] ?? '';
      const fundo = /(?:^|\s)background(?:-color)?[ \t]*:[ \t]*([^;]+);/.exec(decls);
      const tinta = /(?:^|\s)color[ \t]*:[ \t]*([^;]+);/.exec(decls);
      if (!fundo || !tinta) continue;
      const alvo = /^var\((--[a-z0-9-]+)\)$/.exec((fundo[1] ?? '').trim());
      if (!alvo || !SUPERFICIES.includes(alvo[1] as string)) continue;

      const seletor = (achado[1] ?? '').trim().replace(/\s+/g, ' ').slice(-70);
      const texto = /^var\((--[a-z0-9-]+)\)$/.exec((tinta[1] ?? '').trim());
      if (!texto) {
        const valor = (tinta[1] ?? '').trim();
        if (valor !== 'inherit') naoMediveis.push(`${seletor} -> ${valor}`);
        continue;
      }
      regras.push({ seletor, fundo: alvo[1] as string, tinta: texto[1] as string });
    }

    expect(naoMediveis, `tintas não medíveis (só "inherit" é aceitável): ${naoMediveis.join(' | ')}`).toEqual([]);
    /* Anti-vacuidade: se o leitor deixar de encontrar regras, falha em vez de passar. */
    expect(regras.length, `regras com superfície pintada e texto: ${regras.length}`).toBeGreaterThanOrEqual(30);

    const falhas: string[] = [];
    for (const regra of regras) {
      for (const [tema, mapa, fallback] of TEMAS) {
        const r = razao(resolver(regra.fundo, mapa, fallback), resolver(regra.tinta, mapa, fallback));
        if (r < TEXTO) {
          falhas.push(`${regra.seletor} [${tema}] ${regra.fundo} com ${regra.tinta} = ${r.toFixed(2)}:1`);
        }
      }
    }
    expect(falhas, falhas.join(' | ')).toEqual([]);
  });
});

/*
 * Barra inferior e barra lateral — UX-02.
 *
 * ## Porque é que esta frente precisava de guardas
 *
 * O UX-02 acrescentou à `app.css` uma superfície nova (a barra inferior em petróleo escuro),
 * três classes novas (`.z-tabbar__action`, `.z-tabbar__link--action`, `.z-icon-btn__glyph`) e
 * um indicador que **não depende só da cor** (o traço de âmbar sob o rótulo ativo). Medido
 * antes destas guardas: apagar a regra `.z-tabbar__action` ou o `::after` do item ativo não
 * fazia cair teste nenhum — a suite ficava verde sobre uma barra sem círculo e sem indicador.
 * As asserções de texto que já existiam (`expect(css).toContain('.x')`) casam por SUBSTRING e
 * por isso não bastam: é preciso medir a regra.
 *
 * ## O que se mede
 *
 *  1. O círculo do «Registar»: 34 px, **deliberadamente menor** que o alvo de 56 px da barra
 *     (o pedido diz «sem dimensão exagerada»), com tinta de âmbar-900 sobre âmbar — medida
 *     nos dois temas.
 *  2. Os cinco alvos da barra: `min-height` ≥ `--z-touch` (44 px).
 *  3. A grelha de 5 colunas iguais (a barra tem de ter cinco itens, não quatro nem seis).
 *  4. A marca de âmbar é UMA só: um `::before` de 2 px, no topo da CÉLULA ativa, com a
 *     largura toda dela (20 % da barra). Não há `border-top` global de 100 % nem traço de
 *     18 px junto ao ícone — as duas marcas que a UX-02 tinha e que eram defeito. A cor lê
 *     o token, não se escreve à mão.
 *  5. O conteúdo nunca por baixo da barra: `.z-main` reserva `--z-tabbar-height` no `padding`.
 *  6. O `:active` do círculo mantém a tinta legível (a razão pela qual a correção desta frente
 *     trocou `--z-highlight-strong` por `--z-highlight-hover`).
 */
describe('a navegação (UX-02) mede o que afirma', () => {
  const css = (): string => readFileSync(APP, 'utf8');
  const shell = (): string => readFileSync(SHELL, 'utf8');

  /** Declarações da regra cujo seletor começa exatamente por `seletor` + `{`. */
  function regra(cssTexto: string, seletor: string): string {
    const re = new RegExp(
      `${seletor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
    );
    const achado = re.exec(cssTexto);
    if (!achado) throw new Error(`app.css: regra "${seletor}" não encontrada`);
    return achado[1] ?? '';
  }

  it('o círculo do «Registar» é 34 px — pequeno, não um botão sobressalente', () => {
    const decls = regra(css(), '.z-tabbar__action');
    expect(decls, 'largura do círculo').toMatch(/width:[ \t]*34px;/);
    expect(decls, 'altura do círculo').toMatch(/height:[ \t]*34px;/);
    /*
     * Anti-vacuidade e contra-pedido: o círculo NÃO pode ser maior que o alvo dos vizinhos.
     * Se alguém o «melhorar» para 48/56 px (o que o pedido proíbe — «sem dimensão exagerada»),
     * esta contagem pega-o. O alvo da barra tem de cobrir os 44 px do `--z-touch`, e o círculo
     * tem de ficar ABAIXO disso — é isso que o mantém «sem dimensão exagerada».
     */
    const alvo = regra(css(), '.z-tabbar__link');
    const m = /min-height:[ \t]*(\d+)px;/.exec(alvo);
    expect(m, 'min-height do alvo da barra').not.toBeNull();
    expect(Number.parseInt(m?.[1] ?? '0', 10), 'alvo da barra cobre os 44 px').toBeGreaterThanOrEqual(44);
    expect(34).toBeLessThan(44);
  });

  it('a barra tem cinco colunas iguais e cinco itens no componente', () => {
    expect(regra(css(), '.z-tabbar'), 'grelha da barra').toMatch(
      /grid-template-columns:[ \t]*repeat\(5,[ \t]*1fr\);/,
    );
    /*
     * O componente tem de ter exatamente 5 filhos diretos de navegação. Contam-se as tags de
     * topo do `<nav className="z-tabbar">`: dois `<TabLink>` de texto, o botão de ação e mais
     * dois `<TabLink>` — 4 componentes + 1 `<button>`. Fixar o número prova o «5 itens», que é
     * um requisito explícito; se alguém acrescentar um destino, isto cai.
     */
    const nav = /<nav className="z-tabbar"[\s\S]*?<\/nav>/.exec(shell());
    expect(nav, 'bloco <nav class="z-tabbar"> não encontrado em AppShell.tsx').not.toBeNull();
    const corpo = nav?.[0] ?? '';
    const etiquetas = [...corpo.matchAll(/<(TabLink|button)\b/g)].map((m) => m[1]);
    expect(etiquetas, `itens de topo da barra: ${etiquetas.join(', ')}`).toHaveLength(5);
    expect(etiquetas.filter((t) => t === 'button'), 'o «Registar» é o único botão').toHaveLength(1);
  });

  it('o alvo de toque de cada item da barra cobre os 44 px do desenho', () => {
    // 56 px declarados; acima do mínimo de 44 px. O número está fixado, não derivado, para
    // que baixá-lo para 40 px (abaixo do mínimo tátil) faça cair o teste.
    const decls = regra(css(), '.z-tabbar__link');
    const m = /min-height:[ \t]*(\d+)px;/.exec(decls);
    expect(m, 'min-height do item da barra').not.toBeNull();
    const altura = Number.parseInt(m?.[1] ?? '0', 10);
    expect(altura, 'altura do alvo').toBeGreaterThanOrEqual(44);
    // O token do desenho (`--z-touch`) continua a prometer os 44 px. Não é uma cor, por isso
    // não passa pelo `resolver` — lê-se do texto do tema, com o número fixado.
    const toque = /--z-touch:[ \t]*(\d+)px;/.exec(readFileSync(TEMA, 'utf8'));
    expect(toque?.[1], '--z-touch em theme.css').toBe('44');
  });

  it('a barra NÃO tem linha de âmbar global no topo (a marca é uma só, na célula ativa)', () => {
    /*
     * A UX-02 tinha DUAS marcas de âmbar: uma `border-top` contínua de 100 % no `.z-tabbar` e
     * um traço de 18 px junto ao ícone. As duas estavam erradas e foram removidas — a marca
     * é UMA, de 2 px, com a largura da CÉLULA ativa.
     *
     * A guarda é uma AUSÊNCIA, e é deliberadamente **global ao ficheiro**: procura um
     * `border-top` com a tinta de destaque em QUALQUER regra cujo seletor seja `.z-tabbar` ou
     * comece por `.z-tabbar` (as variantes `:hover`, `[aria-current]` incluídas).
     *
     * Porque não basta ler só a regra `.z-tabbar`: uma regra *acrescentada antes* dela (por
     * exemplo `.z-tabbar { border-top: … }` inserida no topo do ficheiro) perde a cascata
     * para a regra original que se segue, e um leitor da primeira regra dava falso verde.
     * Provar o ABSENTE obriga a olhar para todas as ocorrências.
     */
    const regrasBarra = [...css().matchAll(/\.z-tabbar(?:\b[\s:.\[][^\n{]*?)?\s*\{([^}]*)\}/g)];
    expect(regrasBarra.length, 'regras `.z-tabbar*` encontradas').toBeGreaterThanOrEqual(2);
    const comLinha = regrasBarra
      .filter(([, decls]) => /border-top:[^;]*(?:--z-highlight|#[0-9a-fA-F]{3,8})/.test(decls))
      .map(([sel]) => sel.trim().split('{')[0].trim());
    expect(comLinha, `regras com border-top de âmbar: ${comLinha.join(' | ') || '(nenhuma)'}`).toEqual([]);

    /*
     * E o traço de 18 px junto ao ícone também não pode voltar: era um `::after` na caixa do
     * ícone. A regra não existe; se reaparecer, cai.
     */
    expect(
      () => regra(css(), ".z-tabbar__link[aria-current='page'] .z-tabbar__icon::after"),
      'o `::after` do ícone não pode voltar',
    ).toThrow(/não encontrada/);
  });

  it('o indicador do destino ativo ocupa a CÉLULA inteira, no topo dela, e lê o token', () => {
    /*
     * O indicador vive na célula (`[aria-current='page']`), não no ícone: a célula é 20 % da
     * barra e é o que se toca, por isso o indicador tem de ter exatamente essa largura.
     *
     * `left: 0; right: 0` (em vez de `width: 18px`) é o que garante que ele cobra a largura da
     * célula seja ela qual for — com `grid-template-columns: repeat(5, 1fr)` são 20 % da barra,
     * e nenhuma medida fixa em px o conseguiria acompanhar.
     */
    const indicador = regra(css(), ".z-tabbar__link[aria-current='page']::before");
    expect(indicador, 'o indicador lê o token, não um hexadecimal').toContain(
      'background: var(--z-highlight);',
    );
    expect(indicador, 'o indicador não pode ser uma cor escrita à mão').not.toMatch(
      /#[0-9a-fA-F]{3,8}/,
    );
    // Está no TOPO da célula (não em baixo, não entre o ícone e o rótulo).
    expect(indicador, 'o indicador está no topo').toMatch(/top:[ \t]*0;/);
    // Ocupa a largura TODA da célula: as duas âncoras, não uma medida em px.
    expect(indicador, 'o indicador começa no bordo esquerdo da célula').toMatch(/left:[ \t]*0;/);
    expect(indicador, 'o indicador acaba no bordo direito da célula').toMatch(/right:[ \t]*0;/);
    expect(indicador, 'o indicador não tem uma largura fixa (perderia a célula)').not.toMatch(
      /width:[ \t]*\d+px;/,
    );
    // Espessura de 2 px — o mesmo peso da linha que substitui.
    expect(indicador, 'o indicador tem 2 px').toMatch(/height:[ \t]*2px;/);

    /*
     * A âncora é a CÉLULA. Sem `position: relative` na `.z-tabbar__link`, um `absolute`
     * resolver-se-ia contra a `.z-tabbar` (que é `fixed`) e a linha sairia no topo da BARRA —
     * o defeito exato que esta correção remove. A guarda fixa a âncora.
     *
     * Lê a ÚLTIMA declaração `position:` do bloco, e não a presença da string: dentro do mesmo
     * bloco, um `position: static;` acrescentado depois vence o `relative` na cascata e um
     * `toMatch(/relative/)` continuaria verde — um falso verde que a mutação M6 expôs.
     */
    const posicoes = [...regra(css(), '.z-tabbar__link').matchAll(/position:[ \t]*([a-z-]+);/g)].map(
      (m) => m[1],
    );
    expect(posicoes.length, 'declarações `position` na célula').toBeGreaterThanOrEqual(1);
    expect(posicoes.at(-1), 'a célula é o contexto de posicionamento (última `position`)').toBe(
      'relative',
    );
  });

  it('o `:active` do círculo mantém a tinta acima de 4,5:1 (âmbar-400, não âmbar-600)', () => {
    /*
     * Esta é a guarda do defeito que o UX-02 corrigiu. O `:active` usava `--z-highlight-strong`
     * (âmbar-600): âmbar-900 sobre âmbar-600 dá 3,22:1 no tema claro — abaixo dos 4,5:1. A
     * correção lê `--z-highlight-hover` (âmbar-400), que sobe a tinta a 6,18:1.
     *
     * A asserção é dupla de propósito: (a) a regra lê o token certo — se voltar a
     * `--z-highlight-strong`, cai; (b) a tinta sobre esse token PASSA o limiar — se um dia o
     * token for redefinido para um tom escuro, cai também.
     */
    const decls = regra(css(), '.z-tabbar__link--action:active .z-tabbar__action');
    expect(decls, 'o `:active` do círculo').toContain('background: var(--z-highlight-hover);');
    expect(decls, 'o `:active` não usa o tom que reprovava').not.toContain('--z-highlight-strong');

    const tinta = corClaro('--z-highlight-contrast');
    const fundoClaro = corClaro('--z-highlight-hover');
    const fundoEscuro = corEscuro('--z-highlight-hover');
    expect(
      razao(tinta, fundoClaro),
      `tinta ${tinta} sobre o preenchimento premido (claro) ${fundoClaro}`,
    ).toBeGreaterThanOrEqual(TEXTO);
    expect(
      razao(corEscuro('--z-highlight-contrast'), fundoEscuro),
      `tinta sobre o preenchimento premido (escuro) ${fundoEscuro}`,
    ).toBeGreaterThanOrEqual(TEXTO);

    // Contra-prova: o tom antigo NÃO passava. Se alguém o repuser, os números explicam-no.
    expect(razao(tinta, corClaro('--z-highlight-strong'))).toBeLessThan(TEXTO);
  });

  it('o círculo e o traço distinguem-se do chão em petróleo (objeto gráfico ≥3:1)', () => {
    // A barra é a única superfície que inverte: petróleo-900. Como objeto gráfico, o âmbar
    // tem de se destacar dela — nos dois temas, já que `--z-highlight` muda (500→400).
    const chao = corClaro('--z-petrol-900');
    expect(chao).toBe(resolver('--z-petrol-900', escuro, claro));
    expect(razao(corClaro('--z-highlight'), chao), 'âmbar sobre petróleo (claro)').toBeGreaterThanOrEqual(GRAFICO);
    expect(razao(corEscuro('--z-highlight'), chao), 'âmbar sobre petróleo (escuro)').toBeGreaterThanOrEqual(GRAFICO);
  });

  it('o conteúdo nunca fica atrás da barra: `.z-main` reserva a altura dela', () => {
    const decls = regra(css(), '.z-main');
    expect(decls, 'o `padding-block-end` de `.z-main`').toMatch(
      /padding:[^;]*calc\(var\(--z-tabbar-height\) \+ var\(--z-space-6\)\)/,
    );
  });

  it('a barra lateral tem `aria-current` com fundo de acento e ícone a acompanhar', () => {
    const ativo = regra(css(), ".z-sidebar__link[aria-current='page']");
    expect(ativo, 'item ativo da barra lateral').toContain('background: var(--z-accent-soft);');
    expect(ativo).toContain('color: var(--z-accent-ink);');
    // O ícone acompanha por `currentColor` — sem uma regra própria ficaria com a tinta muted
    // e a linha «ativa» teria um ícone desalinhado da cor do rótulo.
    const iconeAtivo = regra(css(), ".z-sidebar__link[aria-current='page'] .z-sidebar__icon");
    expect(iconeAtivo, 'ícone do item ativo').toContain('color: var(--z-accent-ink);');
  });

  it('o estado premido da barra lateral e do botão de ícone devolve retorno', () => {
    // Em ecrãs táteis largos não há `:hover`: sem `:active` o toque não devolve nada (§43).
    expect(regra(css(), '.z-sidebar__link:active')).toContain('background: var(--z-border);');
    expect(regra(css(), '.z-icon-btn:active')).toContain('background: var(--z-border);');
  });

  it('a envolvente do ícone com badge é `relative`, ou o número foge do glifo', () => {
    // `.z-icon-btn__glyph` existe para ancorar o `.z-tabbar__badge` absoluto no glifo e não no
    // botão (que é maior). Sem `position: relative`, o badge afasta-se do ícone.
    const glyph = regra(css(), '.z-icon-btn__glyph');
    expect(glyph, 'posicionamento da envolvente').toContain('position: relative;');
    expect(shell(), 'o Topbar usa a envolvente').toContain('z-icon-btn__glyph');
  });

  it('a transição da barra e da lateral usam os tokens de movimento da UX-01', () => {
    // Nenhuma duração nova: as três (`0.14`/`0.16`/`0.18`) já existem; a barra usa a do meio.
    for (const seletor of ['.z-tabbar__link', '.z-tabbar__action', '.z-sidebar__link', '.z-sidebar__icon']) {
      expect(regra(css(), seletor), seletor).toMatch(/transition(-property)?:[^;]*var\(--z-duration\)/);
    }
  });

  /*
   * O «Registar» é um `<button>` e os vizinhos são `<a>`. Medido no browser (UX-02):
   * sem `appearance: none` + `border: 0` + `background: none`, o `<button>` herda o estilo
   * padrão do motor — `background: rgb(240, 240, 240)` e `border: 2px outset rgb(0,0,0)` —
   * e o centro da barra aparece como um retângulo cinzento com moldura preta. Nenhuma
   * asserção de cor apanhava isto (é cromo, não cor de tinta), e por isso fica aqui: o
   * reset do cromo do botão é medido por leitura do CSS.
   */
  it('o «Registar» repõe o cromo padrão do `<button>` antes de se pintar', () => {
    const decls = regra(css(), '.z-tabbar__link--action');
    for (const prop of ['appearance: none;', 'border: 0;', 'background: none;']) {
      expect(decls, `o reset do botão precisa de \`${prop}\``).toContain(prop);
    }
    // O botão é o único item com o reset; os outros são `<a>` e não têm cromo para repor.
    expect(css(), 'o reset não pode ir para o item genérico').not.toMatch(
      /\.z-tabbar__link \{[^}]*appearance: none;/,
    );
  });
});
