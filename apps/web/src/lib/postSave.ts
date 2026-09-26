import { RECORD_KINDS, type RecordKind } from '@zemlo/shared';
import type { ToastAction } from '../ui/Toaster';
import { recordDetailPath, recordKindLabel } from './recordKinds';

/**
 * Pós-gravação de um registo (decisões §52–§54).
 *
 * Tudo o que acontece **depois** de guardar está aqui, fora dos formulários, por uma razão de
 * prova: sem `jsdom` não se observa um clique, mas observa-se uma função. As duas decisões —
 * «que ações o aviso oferece» (§52) e «o que faz o Novo registo» (§53) — são decisões puras, e
 * é isso que permite afirmá-las num teste em vez de as dar por implícitas no JSX.
 *
 * ## O que a §54 exige, e porque é que quase não se vê no código
 *
 * «Depois da operação: se o utilizador estava numa lista de registos → regressar à lista
 * atualizada; se veio de outra página/contexto → preservar esse contexto; **Ver registo**
 * continua a permitir abrir explicitamente o detalhe criado. Evitar navegação inesperada.»
 *
 * A resposta é: **não se navega ao guardar**. A folha fecha-se sobre o ecrã onde o utilizador
 * estava; a lista por baixo já foi invalidada pelo React Query (`invalidateRecords`) e mostra o
 * registo novo sem um passo de navegação. Só «Ver registo» — uma escolha explícita — muda de
 * ecrã. É por isso que estas ações são a **única** fonte de navegação do fluxo, e por isso o
 * formulário não tem um `navigate` solto: se o tivesse, o contexto deixaria de ser preservado
 * em silêncio.
 */

/** Rótulo da ação que abre o detalhe do registo criado (§52). */
export const VER_REGISTO = 'Ver registo';
/** Rótulo da ação que inicia um registo novo sem sair do fluxo (§52). */
export const NOVO_REGISTO = 'Novo registo';
/** Rótulo da opção que abre a lista de tipos, no seletor de novo registo (§53). */
export const ESCOLHER_OUTRO_TIPO = 'Escolher outro tipo';

export interface PostSaveHandlers {
  /** Navegar para um caminho. Injetado para que a decisão seja testável sem um router. */
  navigate: (to: string) => void;
  /** Abrir o seletor de novo registo, com o tipo acabado de gravar como sugestão de repetição. */
  novoRegisto: (kind: RecordKind) => void;
}

/**
 * Ações do aviso de confirmação, por tipo (§52).
 *
 * - **Ver registo** — só quando existe um ecrã de detalhe. No odómetro não existe
 *   (`recordDetailPath` devolve `null`), e por isso a ação é omitida: oferecer um botão que
 *   levaria a uma página inexistente é pior do que não o oferecer.
 * - **Novo registo** — sempre, e é a ação que evita o regresso ao início do fluxo (§53).
 *
 * A ordem é estável: ver primeiro, repetir depois. Uma ordem que mudasse com o tipo obrigaria
 * o utilizador a reler o aviso sempre que mudasse de tipo de registo.
 */
export function postSaveActions(
  kind: RecordKind,
  recordId: string | null,
  handlers: PostSaveHandlers,
): ToastAction[] {
  const actions: ToastAction[] = [];

  const detail = recordDetailPath(kind, recordId);
  if (detail) {
    actions.push({ label: VER_REGISTO, onClick: () => handlers.navigate(detail) });
  }

  actions.push({ label: NOVO_REGISTO, onClick: () => handlers.novoRegisto(kind) });

  return actions;
}

/**
 * Rótulo da opção de repetição (§53), ex.: «Repetir despesa».
 *
 * O substantivo vem do `RECORD_KINDS` do contrato (`Despesa`, `Abastecimento`, …) em minúsculas,
 * e não de uma segunda tabela de vocabulário: um rótulo próprio divergiria do que a folha mostra
 * à primeira alteração de nome de tipo.
 */
export function repeatLabel(kind: RecordKind): string {
  return `Repetir ${recordKindLabel(kind).toLowerCase()}`;
}

/**
 * Tipos oferecidos por «Escolher outro tipo» (§53) — a ordem é a do contrato partilhado.
 *
 * **Sem `icon`.** O campo existia a transportar o emoji do contrato (`RECORD_KINDS[].icon`) até
 * ao `QuickLogChooser`, que era o único consumidor. Com a família de ícones local (UX-01), a
 * representação visual de um tipo de registo passou a ser um `IconName` e não uma cadeia de
 * emoji: manter aqui o campo seria manter viva a via antiga, e o próximo ecrã que o lesse
 * voltaria a desenhar emojis ao lado de SVGs. Quem desenha pede o ícone a
 * `recordIconName(kind)` (`lib/registerMenu.ts`), que é a **única** porta de entrada.
 *
 * O `label` fica: é vocabulário do contrato e é texto, não desenho.
 */
export function novoRegistoKinds(): Array<{ kind: RecordKind; label: string }> {
  return RECORD_KINDS.map((item) => ({ kind: item.code, label: item.label }));
}
