/**
 * Navegação de teclado num `role="tablist"` (`WEB-006`, achado A2).
 *
 * Vive fora do componente por uma razão prática: é a única parte do padrão ARIA de
 * separadores que pode ser **provada sem um DOM**. Disparar um `keydown` a sério exigiria
 * `jsdom`, que o projeto decidiu não ter (`test/email-verification-ui.test.ts`). A
 * alternativa seria deixar sem teste nenhum exatamente o que se engana com facilidade: o
 * ciclo nas pontas (`←` no primeiro separador) e os saltos para o princípio e o fim.
 *
 * O que fica fora daqui — e portanto fora da prova — é a ligação ao DOM: mover o foco para
 * o separador novo. Essa parte está escrita no `Tabs` e não tem teste; está dito no relatório
 * em vez de ser dado por coberto.
 *
 * Devolve o índice do separador que deve passar a estar ativo, ou `null` quando a tecla não
 * pertence ao padrão — nesse caso quem chamou não deve fazer nada, e o evento segue o seu
 * caminho normal (é o que permite que `Tab` continue a sair da lista).
 */
export function nextTabIndex(key: string, current: number, count: number): number | null {
  // Um separador fora dos limites significa que quem chamou se enganou; não vale a pena
  // adivinhar qual era o separador ativo.
  if (count <= 0 || current < 0 || current >= count) return null;

  // Com um só separador, `←` e `→` dão no mesmo índice — e é o comportamento certo: a lista
  // não tem para onde andar. Não vale a pena tratar como caso especial.
  if (key === 'ArrowRight') return (current + 1) % count;
  if (key === 'ArrowLeft') return (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;

  return null;
}
