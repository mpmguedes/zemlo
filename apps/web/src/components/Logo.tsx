import type { CSSProperties } from 'react';

/**
 * Símbolo "Z-estrada" do Zemlo.
 *
 * Implementa `docs/BRAND.md` — a construção não é decorativa, é a especificação:
 *
 *  - malha de 100 × 100 com 8 unidades de margem de segurança;
 *  - barras de 84 × 14 com raio 4 (os dois troços de estrada paralelos ao observador);
 *  - diagonal desenhada por **dois pontos**, não por um retângulo inclinado, para que a
 *    espessura variável (12 no topo, 22 na base) seja exata. Uma diagonal uniforme lê-se
 *    como uma letra; a variação é o que a lê como estrada em perspetiva.
 */
export type LogoVariant = 'icon' | 'lockup' | 'favicon';

/** Acabamentos previstos na identidade. O âmbar só acompanha ações destacadas (§3). */
export type LogoFinish = 'petrol' | 'mono' | 'inverse' | 'amber';

export interface LogoProps {
  variant?: LogoVariant;
  finish?: LogoFinish;
  /** Altura do símbolo em px. A assinatura horizontal exige ≥ 24 px (§5). */
  size?: number;
  className?: string;
  /** Texto acessível; `null` para símbolo puramente decorativo (já rotulado ao lado). */
  title?: string | null;
}

const FINISH_COLOR: Record<LogoFinish, string> = {
  petrol: 'var(--z-petrol-500)',
  mono: 'var(--z-ink)',
  inverse: '#ffffff',
  amber: 'var(--z-amber-500)',
};

/**
 * Abaixo deste limiar o tracejado central transforma-se numa mancha ilegível e é
 * removido (§2). É também o limiar a partir do qual a assinatura horizontal deixa de
 * fazer sentido — a palavra desaparece antes do símbolo.
 */
const ROAD_DASH_MIN_SIZE = 32;
const LOCKUP_MIN_SIZE = 24;

export function Logo({
  variant = 'icon',
  finish = 'petrol',
  size = 32,
  className,
  title = 'Zemlo',
}: LogoProps) {
  const color = FINISH_COLOR[finish];
  // Uma assinatura horizontal com altura de símbolo inferior a 24 px não é permitida
  // pela identidade: a palavra deixaria de ser legível. Elevamos à altura mínima em vez
  // de recusar renderizar — a interface nunca deve desaparecer por causa de uma regra
  // de marca mal aplicada num sítio qualquer.
  const symbolSize = variant === 'lockup' ? Math.max(size, LOCKUP_MIN_SIZE) : size;
  const showRoad = symbolSize >= ROAD_DASH_MIN_SIZE;
  const variantClass = `z-logo z-logo--${variant}${className ? ` ${className}` : ''}`;
  // `currentColor` no texto permite que a assinatura herde a cor do contexto (por
  // exemplo, branca dentro do cabeçalho em verde-petróleo).
  const style: CSSProperties =
    variant === 'lockup' ? { fontSize: `${symbolSize * 0.72}px` } : {};

  return (
    <span className={variantClass} style={style} data-finish={finish}>
      <Symbol size={symbolSize} color={color} showRoad={showRoad} variant={variant} title={title} />
      {variant === 'lockup' && (
        <span className="z-logo__wordmark" aria-hidden={title === null ? true : undefined}>
          Zemlo
        </span>
      )}
    </span>
  );
}

interface SymbolProps {
  size: number;
  color: string;
  showRoad: boolean;
  variant: LogoVariant;
  title: string | null;
}

function Symbol({ size, color, showRoad, variant, title }: SymbolProps) {
  // O favicon é a única variante que traz o seu próprio fundo (§3): num separador de
  // browser não existe contexto de página que garanta contraste.
  const withPlate = variant === 'favicon';

  return (
    <svg
      className="z-logo__symbol"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role={title ? 'img' : 'presentation'}
      aria-label={title ?? undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {withPlate && <rect width="100" height="100" rx="22" fill={color} />}
      {/* Dentro da placa o símbolo é branco; fora dela usa a cor do acabamento. */}
      <g fill={withPlate ? '#ffffff' : color}>
        <rect x="8" y="8" width="84" height="14" rx="4" />
        <polygon points="20,22 32,22 84,86 62,86" />
        <rect x="8" y="78" width="84" height="14" rx="4" />
      </g>
      {showRoad && (
        /*
          Tracejado central: a leitura de "estrada vista de cima" (§2).

          A linha segue o **eixo médio** da diagonal, não uma das arestas: a diagonal tem
          12 de espessura em cima e 22 em baixo, pelo que a mediana vai de (26, 22) a
          (73, 86). Os extremos são prolongados até dentro das barras (20 → 88) para que o
          tracejado nasça e morra escondido sob elas, em vez de acabar a meio do vazio.
          O `stroke-dasharray` não usa `vectorEffect`, de propósito: o tracejado tem de
          escalar com o símbolo, não fixar-se em 2 px absolutos.
        */
        <line
          x1="24"
          y1="20"
          x2="75"
          y2="88"
          stroke={withPlate ? '#178186' : 'var(--z-logo-plate, #ffffff)'}
          strokeWidth="2"
          strokeDasharray="6 5"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
