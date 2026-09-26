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
 * Nasceu com os ícones do menu de registo (decisões 46–47). O UX-02 estendeu-o à
 * **navegação** (barra lateral, barra superior, barra inferior), que era o último reduto de
 * emoji do produto — dez glifos que mudavam de desenho entre Windows, Android e iOS e
 * ignoravam o tema. A migração do contrato partilhado (`registry.ts`) e do mobile continua a
 * ser uma frente própria e está fora desta.
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
  | 'repeat'
  // Navegação (UX-02)
  | 'home'
  | 'car'
  | 'list'
  | 'bell'
  | 'document'
  | 'chart'
  | 'clock'
  | 'calendar'
  | 'link'
  | 'upload'
  | 'download'
  | 'settings'
  | 'logout'
  | 'plus';

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

  /* ---------------------------------------------------------------- navegação */

  /** Painel — casa. */
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V21h13V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </>
  ),

  /** Veículos — perfil de automóvel. */
  car: (
    <>
      <path d="M4 15.5V12l1.8-4.2A2 2 0 0 1 7.6 6.5h8.8a2 2 0 0 1 1.8 1.3L20 12v3.5" />
      <path d="M3 12h18" />
      <path d="M4 15.5h16V19h-2.5v-1.5h-11V19H4z" />
      <circle cx="7.5" cy="17" r=".75" />
      <circle cx="16.5" cy="17" r=".75" />
    </>
  ),

  /** Registos — lista com linhas. Distinto do `receipt` (despesa) de propósito. */
  list: (
    <>
      <path d="M8 6.5h12" />
      <path d="M8 12h12" />
      <path d="M8 17.5h12" />
      <path d="M4 6.5h.01" />
      <path d="M4 12h.01" />
      <path d="M4 17.5h.01" />
    </>
  ),

  /** Avisos / lembretes — sino. */
  bell: (
    <>
      <path d="M18 8.5a6 6 0 1 0-12 0c0 4.5-1.5 5.5-1.5 5.5h15S18 13 18 8.5" />
      <path d="M13.7 18a2 2 0 0 1-3.4 0" />
    </>
  ),

  /** Documentos — folha com dobra. */
  document: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 16.5h4" />
    </>
  ),

  /** Estatísticas — barras. */
  chart: (
    <>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M3 20h18" />
    </>
  ),

  /** Histórico — relógio. */
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),

  /** Calendário. */
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </>
  ),

  /** Integrações — elo de corrente. */
  link: (
    <>
      <path d="M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7l-1.4 1.4" />
      <path d="M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.4-1.4" />
    </>
  ),

  /** Exportar — seta para fora da caixa. */
  upload: (
    <>
      <path d="M12 15V3.5" />
      <path d="m8 7.5 4-4 4 4" />
      <path d="M4 15v3.5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V15" />
    </>
  ),

  /** Importar — seta para dentro da caixa. */
  download: (
    <>
      <path d="M12 3.5V15" />
      <path d="m8 11 4 4 4-4" />
      <path d="M4 15v3.5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V15" />
    </>
  ),

  /** Definições — roda dentada. */
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.2" />
      <path d="M12 19.3v2.2" />
      <path d="m5.3 5.3 1.6 1.6" />
      <path d="m17.1 17.1 1.6 1.6" />
      <path d="M2.5 12h2.2" />
      <path d="M19.3 12h2.2" />
      <path d="m5.3 18.7 1.6-1.6" />
      <path d="m17.1 6.9 1.6-1.6" />
    </>
  ),

  /** Terminar sessão — porta com seta de saída. */
  logout: (
    <>
      <path d="M15 4.5h2.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H15" />
      <path d="M10 12h10" />
      <path d="m13 8.5-3.5 3.5 3.5 3.5" />
      <path d="M10 4.5H5.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H10" />
    </>
  ),

  /** Registar — mais. Usado no botão de ação da barra lateral e no centro da barra inferior. */
  plus: (
    <>
      <path d="M12 5.5v13" />
      <path d="M5.5 12h13" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  /** Lado do quadrado, em px. 20 px em listas e botões; 22 px na navegação. */
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
