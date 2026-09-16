import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { RecordKind } from '@zemlo/shared';
import { QuickLogSheet } from './QuickLogSheet';

/**
 * Estado do registo rápido (§43, §44).
 *
 * Existe como contexto — e não como estado local do painel — porque o botão de registo
 * aparece em três sítios diferentes (painel, barra de separadores, barra lateral) e o
 * mesmo formulário tem de poder ser aberto a partir de qualquer um deles. Alternativas:
 * repetir o estado em cada sítio (três formulários, três comportamentos que divergem) ou
 * passar um `onOpen` por cinco níveis de componentes (que é o que acontece quando não se
 * usa contexto e se acaba a usar contexto mal).
 *
 * A folha é desenhada **uma vez**, no topo da aplicação, e não dentro do ecrã: assim o
 * registo rápido sobrevive a uma mudança de ecrã por baixo dela, e não há dois formulários
 * vivos ao mesmo tempo.
 */

export type QuickLogKind = RecordKind;

interface QuickLogContextValue {
  /** Tipo de registo aberto, ou `null` quando a folha está fechada. */
  kind: QuickLogKind | null;
  open: (kind: QuickLogKind) => void;
  close: () => void;
}

const QuickLogContext = createContext<QuickLogContextValue | null>(null);

export function QuickLogProvider({ children }: { children: ReactNode }) {
  const [kind, setKind] = useState<QuickLogKind | null>(null);

  const open = useCallback((next: QuickLogKind) => setKind(next), []);
  const close = useCallback(() => setKind(null), []);

  const value = useMemo<QuickLogContextValue>(() => ({ kind, open, close }), [kind, open, close]);

  return (
    <QuickLogContext.Provider value={value}>
      {children}
      <QuickLogSheet kind={kind} onClose={close} />
    </QuickLogContext.Provider>
  );
}

export function useQuickLog(): QuickLogContextValue {
  const context = useContext(QuickLogContext);
  if (!context) throw new Error('useQuickLog tem de ser usado dentro de <QuickLogProvider>.');
  return context;
}
