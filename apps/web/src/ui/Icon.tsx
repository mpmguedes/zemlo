import type { ReactNode } from 'react';

/**
 * Ícones da interface — conjunto local, em SVG, sem dependência.
 *
 * ## Porque é que este ficheiro existe
 *
 * Até aqui, **todos** os ícones de interface do produto eram emoji vindos do contrato
 * partilhado (`packages/shared/src/registry.ts`, `icon: string`). O emoji tem três problemas
 * que se medem, não se discutem: o mesmo código renderiza desenhos diferentes em Windows,
 * Android e iOS; é um glifo colorido que ignora `prefers-color-scheme` e o contraste do
 * tema; e não aceita `stroke-width`, cor nem tamanho — só `font-size`. Numa barra lateral
 * ao lado de um logótipo geométrico, o resultado é o que as quatro auditorias UX/UI
 * registaram: «parece funcional, não desenhado».
 *
 * ## Porque é que é local e não um pacote
 *
 * A política do projeto é explícita (`app.css`: «a aplicação não pode acrescentar
 * dependências»). Trazer `lucide-react` para usar sete ícones custaria um pacote de runtime
 * inteiro — e a interface deixaria de arrancar sem rede, que é uma promessa do produto.
 * A geometria dos `path` é inspirada em conjuntos abertos (Lucide, licença ISC), mas vive
 * **aqui**, em primeira mão: sem versão para acompanhar, sem `import` de terceiros, e
 * auditável linha a linha.
 *
 * ## Âmbito
 *
 * Só os ícones que o menu de registo usa (decisões 46–47). Não é uma migração da
 * iconografia do produto: essa é uma frente própria, que toca `registry.ts` e o mobile, e
 * está fora desta. Manter o conjunto pequeno é deliberado — um sprite com vinte ícones
 * «para o que der e vier» é código sem chamador, e é o primeiro a divergir.
 *
 * ## Regras (as mesmas que as auditorias fixam)
 *
 *  - `fill="none"`, `stroke="currentColor"`, `stroke-width="1.75"`, `linecap`/`linejoin`
 *    redondos — coerente com o logótipo e com os gráficos (`charts.tsx`).
 *  - O SVG é **decorativo** (`aria-hidden`): quem dá o nome ao controlo é o texto ao lado.
 *    Um ícone dentro de um botão com rótulo não deve ser lido duas vezes.
 *  - Nunca multicolorido. A cor vem do contexto, por `currentColor`.
 */

export type IconName =
  | 'receipt'
  | 'fuel'
  | 'bolt'
  | 'wrench'
  | 'gauge'
  | 'repeat';

/**
 * Geometria de cada ícone, numa grelha de 24 × 24.
 *
 * Um `Record` total sobre `IconName`: acrescentar um nome sem lhe dar geometria é um erro de
 * compilação, não um ícone invisível em produção.
 */
const PATHS: Record<IconName, ReactNode> = {
  /** Despesa — recibo com o bordo inferior rasgado. */
  receipt: (
    <>
      <path d="M6 2.75h12v18.5l-3-2-3 2-3-2-3 2z" />
      <path d="M9.5 7.5h5" />
      <path d="M9.5 11.5h5" />
    </>
  ),

  /** Abastecimento — bomba com mangueira. */
  fuel: (
    <>
      <path d="M5.5 21V5.5a2 2 0 0 1 2-2h4.5a2 2 0 0 1 2 2V21" />
      <path d="M3.5 21h13" />
      <path d="M7.5 7h4.5v4H7.5z" />
      <path d="M14 10h2a2 2 0 0 1 2 2v5.5a1.5 1.5 0 0 0 3 0V9.8L19 8" />
    </>
  ),

  /** Carregamento — raio. */
  bolt: <path d="M13 2 4 13.5h6.5L10 22l9-11.5h-6.5L13 2z" />,

  /** Manutenção — chave de bocas. */
  wrench: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  ),

  /** Quilometragem — velocímetro. */
  gauge: (
    <>
      <path d="m12 14 4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </>
  ),

  /** Repetir — duas setas em ciclo. */
  repeat: (
    <>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  /** Lado do quadrado, em px. 20 px em listas e botões; 24 px em navegação. */
  size?: number;
  /** 1,75 é o valor do sistema; 2 apenas em destaque. */
  strokeWidth?: number;
  className?: string;
}

export function Icon({ name, size = 20, strokeWidth = 1.75, className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorativo: o nome acessível do controlo é o texto que o acompanha.
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
