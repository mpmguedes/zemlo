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

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  /** Ação opcional, ex.: "Anular" depois de marcar uma notificação como lida. */
  action?: { label: string; onClick: () => void };
}

interface ToastContextValue {
  toasts: Toast[];
  show: (message: string, options?: { variant?: ToastVariant; action?: Toast['action']; durationMs?: number }) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION = 4500;

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
        ...(options.action ? { action: options.action } : {}),
      };
      setToasts((current) => [...current, toast]);
      const duration = options.durationMs ?? (options.action ? 7000 : DEFAULT_DURATION);
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
          <div key={toast.id} className={`z-toast z-toast--${toast.variant}`}>
            <span className="z-toast__message">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="z-btn z-btn--sm z-btn--ghost"
                style={{ color: 'inherit', minHeight: 28 }}
                onClick={() => {
                  toast.action?.onClick();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              className="z-toast__close"
              aria-label="Fechar aviso"
              onClick={() => dismiss(toast.id)}
            >
              ×
            </button>
          </div>
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
