import { useEffect, useRef, type FormEventHandler, type ReactNode } from 'react';

/**
 * Folha modal.
 *
 * É o veículo da interação mais importante do produto (§43, §44): registar algo em poucos
 * segundos a partir do dashboard. Optámos por uma folha própria em vez do `<dialog>` nativo
 * por uma razão concreta: o `<dialog>` centra-se e não permite o encaixe inferior no
 * telemóvel sem reescrever o posicionamento com `::backdrop` — e a animação de entrada
 * teria de ser feita duas vezes, para dois modelos de posicionamento. Aqui há um só.
 *
 * O que a implementação garante, e que é o motivo pelo qual não se usa um `<div>` solto:
 *  - **foco preso** dentro da folha enquanto está aberta (Tab não escapa para a página);
 *  - **foco devolvido** ao elemento que a abriu, ao fechar;
 *  - **Escape fecha**, e o clique fora também;
 *  - **`aria-modal` + `role="dialog"` + rótulo**, para leitores de ecrã;
 *  - **scroll da página bloqueado**, para que o conteúdo por baixo não se mova.
 */
export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /**
   * Linha de contexto por baixo do título.
   *
   * Tipada como texto e não como `ReactNode`: uma folha modal é sempre um formulário ou uma
   * confirmação curta, e restringir o subtítulo a uma frase impede que a folha se transforme
   * num ecrã inteiro — que é exatamente o que a §44 pede que ela não seja.
   */
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** `form` transforma a folha num formulário — o rodapé submete-o. */
  onSubmit?: FormEventHandler<HTMLFormElement>;
  /**
   * Suspende os atalhos globais (Escape e ciclo de Tab) enquanto uma folha **filha** está
   * aberta por cima desta.
   *
   * ## Porque é que isto é necessário, e porque é um `prop` explícito
   *
   * Os dois atalhos são registados em `document` (fase de captura), pelo que **duas** folhas
   * abertas ao mesmo tempo ficam as duas a ouvir. Sem esta suspensão, o Escape dentro da folha
   * filha fechava também a folha-mãe — e o utilizador perderia o formulário que estava a
   * preencher por ter carregado em Escape para fechar a escolha do veículo. O ciclo de Tab
   * tinha o mesmo problema ao contrário: prenderia o foco na folha-mãe, e a folha filha ficaria
   * inalcançável por teclado.
   *
   * A alternativa era uma pilha de modais em estado de módulo (só a folha do topo responde).
   * Preferiu-se o `prop` porque a relação é conhecida **por quem abre a folha filha** e um
   * estado global mutável é mais difícil de provar: aqui, o pai diz explicitamente «tenho uma
   * folha por cima» e a folha não adivinha. Uma folha sozinha — o caso de todos os ecrãs atuais
   * — não passa esta propriedade e comporta-se exatamente como antes.
   */
  suspendGlobalKeys?: boolean;
}

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  onSubmit,
  suspendGlobalKeys = false,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Guardar e devolver o foco. Sem isto, fechar a folha devolve o foco ao `<body>` e quem
  // navega por teclado perde a posição no ecrã — num formulário de rápida entrada de
  // dados, isso significa voltar a percorrer a página toda.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    // O primeiro controlo focável, ou o próprio painel se não houver nenhum (é preciso
    // que algo receba o foco para que o Tab continue dentro da folha).
    const focusable = panel?.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not([disabled]), select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? panel)?.focus();

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = overflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    /*
     * `suspendGlobalKeys` desliga **este** tratamento enquanto uma folha filha está por cima.
     * O efeito acima (foco e bloqueio do scroll) continua ativo: a folha-mãe está aberta e o
     * corpo da página tem de continuar sem scroll. Ver a nota da propriedade.
     */
    if (!open || suspendGlobalKeys) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      // Prender o foco: calcular os focáveis a cada Tab é mais robusto do que guardar a
      // lista na abertura, porque a folha acrescenta e remove campos (a divulgação
      // progressiva dos detalhes muda o conteúdo a meio da interação).
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;

      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose, suspendGlobalKeys]);

  if (!open) return null;

  const body = (
    <>
      <div className="z-sheet__header">
        <div style={{ flex: 1 }}>
          <h2 className="z-sheet__title" id="z-sheet-title">
            {title}
          </h2>
          {subtitle ? <p className="z-sheet__subtitle">{subtitle}</p> : null}
        </div>
        <button type="button" className="z-icon-btn" onClick={onClose} aria-label="Fechar">
          ✕
        </button>
      </div>
      <div className="z-sheet__body">{children}</div>
      {footer}
    </>
  );

  return (
    <div className="z-sheet">
      <button
        type="button"
        className="z-sheet__scrim"
        aria-label="Fechar"
        onClick={onClose}
        tabIndex={-1}
      />
      <div
        className="z-sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="z-sheet-title"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="z-sheet__grabber" aria-hidden="true" />
        {onSubmit ? (
          <form
            onSubmit={onSubmit}
            style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}
          >
            {body}
          </form>
        ) : (
          body
        )}
      </div>
    </div>
  );
}
