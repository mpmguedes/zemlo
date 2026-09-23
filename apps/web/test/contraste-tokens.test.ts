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
    const shell = readFileSync(SHELL, 'utf8');
    expect(shell).toContain('var(--z-highlight-contrast)');
    expect(shell).not.toMatch(/color:[ \t]*'#/);
  });

  it('a faixa informativa não usa um tom fixo da escala', () => {
    expect(readFileSync(APP, 'utf8')).not.toMatch(/color:[ \t]*var\(--z-petrol-800\)/);
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
