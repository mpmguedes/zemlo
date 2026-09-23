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

/**
 * Tintas de estado — a variante de cada cor de estado que sobrevive como TEXTO.
 *
 * Uma cor de estado serve, em primeiro lugar, superfícies, barras e marcadores. Como texto
 * sobre superfícies claras, duas das cores de `STATE` não atingem os 4,5:1 que a WCAG exige
 * a texto normal (e todo o texto do Zemlo tem 12–15 px, logo nada se qualifica como "texto
 * grande"): `ok` dá 4,33:1 sobre branco e 3,82:1 sobre o verde suave; `danger` dá 4,43:1
 * sobre o laranja suave.
 *
 * Escurecer as cores originais seria a correção óbvia — e a errada: estragaria a marca
 * precisamente onde o contraste não é exigido (a barra de um cartão de estado, o marcador
 * de um dia no calendário). Por isso as originais ficam intactas e acrescenta-se a tinta.
 *
 * O tom foi escolhido por **medição**, não a olho: é o mais próximo do original que mantém
 * margem sobre o limiar em TODOS os fundos em que é usado (≥ 4,75:1, e não 4,50:1, para não
 * ficar no limite). Medições e prova em `docs/PROPOSAL-A3-WEB-011.md` (`WEB-011` / `PC-24`).
 *
 * `info` e `warn` não precisam de tinta própria: como texto usam tons que já existem nas
 * escalas — `petrol-800`/`petrol-200` e `amber-900`.
 */
export const STATE_INK = {
  ok: '#1b784f',
  danger: '#ba3e0c',
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
  stateInk: STATE_INK,
} as const;

/**
 * Validade do link de recuperação de password, em minutos.
 *
 * Vive aqui — e não escrita à mão em cada sítio que a menciona — porque é afirmada em
 * três pontos que têm de concordar sempre: a constante que o servidor usa para expirar o
 * token (`PASSWORD_RESET_TTL_MINUTES` em `services/auth.ts`, que importa esta), o texto
 * do email que o utilizador recebe ("o link é válido durante X minutos") e o ecrã que
 * confirma o pedido. Se divergissem, o produto mentia à pessoa no momento exacto em que
 * ela está sem acesso à conta — o pior sítio possível para uma mentira pequena.
 *
 * A unidade é minutos, como no email e no servidor. Converter para "1 hora" no texto é
 * responsabilidade de quem apresenta.
 */
export const PASSWORD_RESET_TTL_MINUTES = 60;

/**
 * Validade do link de verificação de email, em minutos.
 *
 * Vive aqui pela mesma razão que a do reset — é afirmada em três sítios que têm de
 * concordar: a expiração do token no servidor, o texto do email que o utilizador recebe e
 * o ecrã que explica o que fazer quando o link já não serve.
 *
 * O valor é **muito maior** do que o do reset, e a diferença é intencional. O reset
 * protege uma conta cujo acesso se perdeu: um link que vive uma hora é uma janela curta
 * para um ataque, e quem o pediu está à espera dele nesse momento. A verificação é o
 * contrário — é um email que chega sem ninguém o pedir de imediato, muitas vezes para uma
 * caixa que só é aberta horas depois, no telemóvel. Um prazo curto aqui não aumentaria a
 * segurança de nada: não há nada a proteger do lado do servidor que o token de reset não
 * proteja, e o único efeito de o encurtar seria obrigar a pessoa a pedir um link novo.
 *
 * 24 horas cobre "vi o email no dia seguinte" sem deixar um link vivo indefinidamente.
 * Converter para dias/horas no texto é responsabilidade de quem apresenta.
 */
export const EMAIL_VERIFICATION_TTL_MINUTES = 60 * 24;

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
  for (const [key, value] of Object.entries(STATE_INK)) {
    lines.push(`  --z-state-${key}-ink: ${value};`);
  }
  return `:root {\n${lines.join('\n')}\n}`;
}
