import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Contraste dos indicadores de estado do cartão de veículo (decisão UX/UI 43).
 *
 * ## Porque é que isto é um teste e não um comentário
 *
 * O cartão de veículo é petróleo escuro nos DOIS temas — o gradiente assenta em
 * `--z-petrol-900` e `--z-petrol-700`, que o tema escuro não altera. Logo as tintas de
 * estado do tema claro (`--z-state-ok` #1f8a5b, `--z-state-danger` #c2410c) **não servem
 * lá**: dão 1,99:1 e 1,67:1 sobre `--z-petrol-700`, abaixo dos 3:1 exigidos a um objeto
 * gráfico (WCAG 2.1, 1.4.11). Foi por isso que `theme.css` ganhou `--z-*-on-inverse`.
 *
 * Um comentário a dizer «3,67:1» envelhece mal: alguém muda um tom e o comentário continua
 * lá, a mentir. Este teste lê os valores **do ficheiro** e volta a medir, pelo que a
 * afirmação só se mantém enquanto for verdadeira.
 *
 * ## O que ele NÃO prova
 *
 * Prova o contraste dos tokens entre si. Não prova que a regra CSS que os usa escolhe o
 * token certo, nem que o elemento tem o tamanho mínimo. O que liga o token ao elemento é
 * `vehicle-cards.test.tsx` (a classe está lá) e a leitura do `app.css`.
 */

/* -------------------------------------------------------------------------- */
/* Leitura dos tokens do ficheiro real                                         */
/* -------------------------------------------------------------------------- */

const THEME_CSS = fileURLToPath(new URL('../src/styles/theme.css', import.meta.url));

/** Extrai `--z-nome: valor;` do `:root` — só o primeiro bloco, que é o tema claro. */
function readTokens(): Map<string, string> {
  const css = readFileSync(THEME_CSS, 'utf8');
  const tokens = new Map<string, string>();
  for (const match of css.matchAll(/^\s*(--z-[a-z0-9-]+)\s*:\s*([^;]+);/gim)) {
    const name = match[1];
    const value = match[2];
    if (name && value && !tokens.has(name)) tokens.set(name, value.trim());
  }
  return tokens;
}

const TOKENS = readTokens();

/** Resolve cadeias `var(--x)` até chegar a um literal. Falha alto se não resolver. */
function resolve(name: string, depth = 0): string {
  if (depth > 8) throw new Error(`cadeia de var() demasiado funda em ${name}`);
  const raw = TOKENS.get(name);
  if (raw === undefined) throw new Error(`token ${name} não existe em theme.css`);
  const varMatch = raw.match(/^var\((--z-[a-z0-9-]+)\)$/i);
  if (varMatch?.[1]) return resolve(varMatch[1], depth + 1);
  return raw;
}

/* -------------------------------------------------------------------------- */
/* Contraste WCAG 2.1                                                          */
/* -------------------------------------------------------------------------- */

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  if (h.length !== 6) throw new Error(`cor não é hex de 6 dígitos: ${hex}`);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/* -------------------------------------------------------------------------- */

const GRADIENT_START = resolve('--z-petrol-900');
const GRADIENT_END = resolve('--z-petrol-700');
const GRADIENT_ENDS = [
  ['--z-petrol-900', GRADIENT_START],
  ['--z-petrol-700', GRADIENT_END],
] as const;

describe('contraste dos indicadores de estado no cartão de veículo', () => {
  it('os extremos do gradiente são os que se julga que são', () => {
    // Guarda contra o teste passar por ler o token errado: se o gradiente mudar de tom,
    // isto obriga a revisitar as medições abaixo em vez de as deixar a medir outra coisa.
    expect(GRADIENT_START).toBe('#082e33');
    expect(GRADIENT_END).toBe('#0e545a');
  });

  it.each([
    ['--z-ok-on-inverse', '--z-ok-on-inverse'],
    ['--z-warn-on-inverse', '--z-warn-on-inverse'],
    ['--z-danger-on-inverse', '--z-danger-on-inverse'],
  ])('%s passa 3:1 sobre os dois extremos do gradiente', (_label, token) => {
    const colour = resolve(token);
    for (const [endName, endValue] of GRADIENT_ENDS) {
      const ratio = contrast(colour, endValue);
      expect(ratio, `${token} (${colour}) sobre ${endName} (${endValue}) deu ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    }
  });

  it('as tintas de estado do tema CLARO não passam no gradiente — é por isso que existem as on-inverse', () => {
    // Controlo negativo deliberado. Se este teste deixar de passar, é sinal de que o
    // `--z-state-ok`/`--z-state-danger` claro passaram a ter contraste suficiente sobre
    // petróleo — e nesse caso as `--z-*-on-inverse` deixariam de ter razão para existir.
    const ok = contrast(resolve('--z-state-ok'), GRADIENT_END);
    const danger = contrast(resolve('--z-state-danger'), GRADIENT_END);
    expect(ok).toBeLessThan(3);
    expect(danger).toBeLessThan(3);
  });

  it('o rótulo do estado passa 4,5:1 — é texto, não é ornamento', () => {
    // O rótulo («Em dia») NÃO usa a tinta do ponto: a 12 px é texto normal e precisa dos
    // 4,5:1. Usa `--z-text-on-inverse`.
    const text = resolve('--z-text-on-inverse');
    for (const [endName, endValue] of GRADIENT_ENDS) {
      const ratio = contrast(text, endValue);
      expect(ratio, `${text} sobre ${endName} deu ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('o texto secundário do cartão passa 4,5:1', () => {
    // `--z-text-on-inverse-muted` é `rgba(255,255,255,0.78)`. Sobre petróleo-700 dá
    // 5,96:1 — acima do limiar, e é o pior dos dois extremos (o -900 é mais escuro).
    const rgba = resolve('--z-text-on-inverse-muted');
    const alpha = Number(rgba.match(/rgba\(255,\s*255,\s*255,\s*([\d.]+)\)/)?.[1]);
    expect(Number.isFinite(alpha), `não consegui ler o alfa de ${rgba}`).toBe(true);

    const end = GRADIENT_END.replace('#', '');
    const blended = [0, 2, 4]
      .map((i) => parseInt(end.slice(i, i + 2), 16))
      .map((c) => Math.round(alpha * 255 + (1 - alpha) * c))
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('');

    const ratio = contrast(`#${blended}`, GRADIENT_END);
    expect(ratio, `muted sobre petróleo-700 deu ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });
});
