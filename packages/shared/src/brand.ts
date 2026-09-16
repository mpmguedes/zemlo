/**
 * Cores partilhadas Zemlo.
 *
 * Fonte: identidade da marca (§57 da especificação).
 *  - Primária: verde-petróleo.
 *  - Secundária/acento: âmbar.
 *
 * O verde-petróleo `#178186` é o valor oficial extraído do logótipo (`logo_zemlo.svg`).
 * A restante escala é derivada dele de forma determinística para manter a interface
 * coerente e evitar "excesso de cores" (§57).
 */

export interface ColorScale {
  /** Tom base da marca. */
  readonly 500: string;
  readonly 50: string;
  readonly 100: string;
  readonly 200: string;
  readonly 300: string;
  readonly 400: string;
  readonly 600: string;
  readonly 700: string;
  readonly 800: string;
  readonly 900: string;
}

/** Verde-petróleo — cor primária da marca. */
export const PETROL: ColorScale = {
  50: '#eaf6f5',
  100: '#cdeae8',
  200: '#9ed6d3',
  300: '#66bcba',
  400: '#3a9d9e',
  500: '#178186',
  600: '#126a70',
  700: '#0e545a',
  800: '#0b4046',
  900: '#082e33',
};

/** Âmbar — acento, reservado para ações, destaque e alertas. */
export const AMBER: ColorScale = {
  50: '#fdf7e7',
  100: '#fbecc2',
  200: '#f7db8a',
  300: '#f2c74f',
  400: '#eeb424',
  500: '#d99b0b',
  600: '#b47c07',
  700: '#8c5f08',
  800: '#6b480a',
  900: '#4d340a',
};

/** Neutros com ligeiro desvio para o verde, para não parecer um cinzento genérico. */
export const NEUTRAL: ColorScale = {
  50: '#f7faf9',
  100: '#eef3f2',
  200: '#dfe7e6',
  300: '#c6d1d0',
  400: '#9aa8a7',
  500: '#6f7d7c',
  600: '#55605f',
  700: '#3f4847',
  800: '#2a3231',
  900: '#182020',
};

/** Semânticas de estado. */
export const STATE = {
  ok: '#1f8a5b',
  info: '#178186',
  warn: '#d99b0b',
  danger: '#c2410c',
} as const;

/** Marca completa, pronta a serializar para CSS custom properties. */
export const BRAND = {
  name: 'Zemlo',
  tagline: 'O teu veículo, sem ruído.',
  domain: 'appzemlo.com',
  petrol: PETROL,
  amber: AMBER,
  neutral: NEUTRAL,
  state: STATE,
} as const;

export type BrandState = keyof typeof STATE;

/** Gera o bloco `:root { --z-... }` consumido por `apps/web`. */
export function brandCssVariables(): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(PETROL)) {
    lines.push(`  --z-petrol-${key}: ${value};`);
  }
  for (const [key, value] of Object.entries(AMBER)) {
    lines.push(`  --z-amber-${key}: ${value};`);
  }
  for (const [key, value] of Object.entries(NEUTRAL)) {
    lines.push(`  --z-neutral-${key}: ${value};`);
  }
  for (const [key, value] of Object.entries(STATE)) {
    lines.push(`  --z-state-${key}: ${value};`);
  }
  return `:root {\n${lines.join('\n')}\n}`;
}
