import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { RecordKind } from '@zemlo/shared';
import { QuickLogSheet } from './QuickLogSheet';
import { QuickLogChooser } from './QuickLogChooser';
import { RegisterMenu } from './RegisterMenu';

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
  /**
   * Abre o seletor de novo registo (§53), com o tipo acabado de gravar para oferecer a
   * repetição. `null` quando não há um tipo anterior conhecido — o seletor abre então na
   * lista, sem um botão «Repetir» que não teria sentido.
   */
  openNovoRegisto: (previousKind: QuickLogKind | null) => void;
  /**
   * `true` quando está aberto o **menu de tipos** (decisão 46) — a folha que pergunta *que*
   * registo, em vez de assumir a despesa.
   *
   * É um estado próprio e não um valor de `kind`: o menu não é um tipo de registo, e
   * representá-lo como um sexto `kind` obrigaria a inventar um tipo que o contrato não tem.
   */
  menuOpen: boolean;
  /** Abre o menu de tipos. Substitui o antigo «abrir logo a despesa». */
  openMenu: () => void;
}

const QuickLogContext = createContext<QuickLogContextValue | null>(null);

export function QuickLogProvider({ children }: { children: ReactNode }) {
  const [kind, setKind] = useState<QuickLogKind | null>(null);
  /*
   * O seletor (§53) é um estado próprio e não um valor de `kind`: são duas folhas diferentes —
   * uma pergunta **que tipo**, a outra preenche **esse tipo**. Guardar `previousKind` em vez de
   * um booleano permite oferecer «Repetir despesa» sem uma segunda variável de estado.
   */
  const [chooser, setChooser] = useState<{ previousKind: QuickLogKind | null } | null>(null);
  /*
   * Menu de tipos (decisão 46). Os três estados — `kind`, `chooser` e `menu` — são **mutuamente
   * exclusivos**: cada abertura fecha os outros dois. Não é só arrumação: a `Sheet` usa um
   * `id` de título fixo (`ui/Sheet.tsx:111`), pelo que duas folhas vivas ao mesmo tempo
   * produziriam dois `aria-labelledby` a apontar para o mesmo `id` e dois `scrim` empilhados.
   */
  const [menu, setMenu] = useState(false);

  const open = useCallback((next: QuickLogKind) => {
    setChooser(null);
    setMenu(false);
    setKind(next);
  }, []);
  const close = useCallback(() => {
    setKind(null);
    setChooser(null);
    setMenu(false);
  }, []);
  const openNovoRegisto = useCallback((previousKind: QuickLogKind | null) => {
    setKind(null);
    setMenu(false);
    setChooser({ previousKind });
  }, []);
  const openMenu = useCallback(() => {
    setKind(null);
    setChooser(null);
    setMenu(true);
  }, []);

  const value = useMemo<QuickLogContextValue>(
    () => ({ kind, open, close, openNovoRegisto, menuOpen: menu, openMenu }),
    [kind, open, close, openNovoRegisto, menu, openMenu],
  );

  return (
    <QuickLogContext.Provider value={value}>
      {children}
      <QuickLogSheet kind={kind} onClose={close} onNovoRegisto={openNovoRegisto} />
      {menu ? <RegisterMenu onSelect={open} onClose={() => setMenu(false)} /> : null}
      {chooser ? (
        <QuickLogChooser
          previousKind={chooser.previousKind}
          onSelect={open}
          onClose={() => setChooser(null)}
        />
      ) : null}
    </QuickLogContext.Provider>
  );
}

export function useQuickLog(): QuickLogContextValue {
  const context = useContext(QuickLogContext);
  if (!context) throw new Error('useQuickLog tem de ser usado dentro de <QuickLogProvider>.');
  return context;
}
