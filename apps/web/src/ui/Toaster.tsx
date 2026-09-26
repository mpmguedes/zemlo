import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * Avisos flutuantes.
 *
 * Existem para dar resposta imediata a uma ação que não muda de ecrã: "Abastecimento
 * registado", "Sessão terminada". Não substituem estados vazios nem erros de formulário —
 * um aviso que desaparece é o pior sítio para colocar informação que o utilizador tem de
 * poder reler.
 */

export type ToastVariant = 'info' | 'ok' | 'danger';

/** Uma ação do aviso: um rótulo curto e o que fazer quando é escolhida. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  /**
   * Ações opcionais — ex.: «Ver registo» · «Novo registo» depois de guardar (§52), ou «Anular»
   * depois de marcar uma notificação como lida.
   *
   * É uma **lista** e não uma ação única: a decisão 52 pede duas escolhas na mesma confirmação,
   * e forçar um formato de uma só ação obrigaria o segundo sítio a inventar o seu próprio aviso
   * — que é precisamente a duplicação que se quer evitar. A ordem é a da lista.
   */
  actions?: ToastAction[];
}

interface ToastContextValue {
  toasts: Toast[];
  show: (message: string, options?: { variant?: ToastVariant; actions?: ToastAction[]; durationMs?: number }) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION = 4500;
/** Com ações, o aviso fica mais tempo: escolher leva mais do que ler. */
const ACTION_DURATION = 7000;

/**
 * Cartão de um aviso.
 *
 * Extraído do provedor para poder ser **renderizado num teste** (`renderToStaticMarkup`) sem um
 * DOM e sem disparar eventos: é a única forma de afirmar que as duas ações da decisão 52
 * aparecem de facto no aviso, e não apenas que o código as constrói.
 */
export function ToastView({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const temAcoes = (toast.actions?.length ?? 0) > 0;

  return (
    /*
     * `z-toast--acoes` muda só a arrumação: com ações, a mensagem ocupa a linha inteira e as
     * ações descem para a sua própria linha. Dois alvos de 44 px (`--z-touch`) mais o fechar
     * não cabem ao lado de um texto num aviso de 360 px — e espremer a mensagem numa coluna
     * de duas letras seria pior do que acrescentar uma linha (ver `app.css`).
     */
    <div className={`z-toast z-toast--${toast.variant}${temAcoes ? ' z-toast--acoes' : ''}`}>
      <span className="z-toast__message">{toast.message}</span>
      {toast.actions?.map((action) => (
        <button
          key={action.label}
          type="button"
          /*
           * Sem `z-btn--sm`: essa variante fixa 36 px de altura, abaixo dos 44 px da política
           * de toque. Sem `style` inline: o tamanho e a tinta vivem em `.z-toast__action`.
           */
          className="z-btn z-btn--ghost z-toast__action"
          onClick={() => {
            action.onClick();
            onDismiss(toast.id);
          }}
        >
          {action.label}
        </button>
      ))}
      <button
        type="button"
        className="z-toast__close"
        aria-label="Fechar aviso"
        onClick={() => onDismiss(toast.id)}
      >
        ×
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  // Os temporizadores são guardados para poderem ser cancelados quando o aviso é fechado
  // à mão: sem isto, o `setTimeout` dispararia sobre um identificador já removido (inócuo)
  // e, pior, manteria a referência viva depois de desmontar.
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback<ToastContextValue['show']>(
    (message, options = {}) => {
      const id = nextId.current++;
      const toast: Toast = {
        id,
        message,
        variant: options.variant ?? 'info',
        ...(options.actions && options.actions.length > 0 ? { actions: options.actions } : {}),
      };
      setToasts((current) => [...current, toast]);
      const duration = options.durationMs ?? (toast.actions ? ACTION_DURATION : DEFAULT_DURATION);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), duration),
      );
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  const value = useMemo<ToastContextValue>(() => ({ toasts, show, dismiss }), [toasts, show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/*
        `polite` e não `assertive`: uma confirmação de gravação não deve interromper a
        leitura do que está no ecrã. Só um erro bloqueante justificaria uma interrupção, e
        esses são mostrados dentro do próprio formulário.
      */}
      <div className="z-toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <ToastView key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    // Um `useToast` fora do provedor é um erro de programação, e falhar alto em
    // desenvolvimento é preferível a um aviso que silenciosamente não aparece.
    throw new Error('useToast tem de ser usado dentro de <ToastProvider>.');
  }
  return context;
}
