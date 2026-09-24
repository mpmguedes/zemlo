import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { documentTitleFor } from './pageTitles';

/*
 * Anúncio da mudança de página (`WEB-012`, defeitos A5 e A6 — WCAG 2.4.2, 2.4.3 e 4.1.3).
 *
 * ## O problema, medido
 *
 * A aplicação é uma SPA: ao navegar, o browser **não** recarrega o documento. Sem um efeito
 * dedicado, `document.title` fica «Zemlo» em todas as rotas (o `index.html` é o único sítio que
 * o escreve) e o foco cai no `<body>`. Quem usa leitor de ecrã não ouve nada; quem navega por
 * teclado perde a posição e recomeça a tabular a partir do topo da página.
 *
 * ## A estratégia de foco, e porque é esta
 *
 * 1. **O alvo é o `<main>`**, não o `<h1>`. O `main` já existe, já tem `id="conteudo"` (é o
 *    destino do link «Saltar para o conteúdo») e é o contentor de tudo o que muda. Focar o
 *    `h1` obrigaria a garantir que existe um em cada ecrã — e o painel, no estado normal, não
 *    tem nenhum. É também o que a WCAG recomenda para gestão de foco em SPA.
 * 2. **`tabIndex={-1}`**, declarado no `AppShell` e garantido aqui em tempo de execução para
 *    qualquer alvo que não o traga. Um elemento não focável não recebe `.focus()`; sem isto o
 *    efeito correria e não faria nada — o pior tipo de correção, porque parece feita.
 * 3. **`focus({ preventScroll: true })`** — é isto que evita o «salto visual» que a decisão de
 *    política pediu para evitar. Sem `preventScroll`, focar o `main` faz o browser rolar até
 *    ele, e o utilizador perde a posição de leitura que tinha.
 * 4. **Nada de `outline: none`.** O anel do projeto é `:focus-visible` (`app.css`), que um
 *    foco programático normalmente **não** ativa — logo não há anel desnecessário. Removê-lo à
 *    força apagaria também o indicador de quem usou o link «Saltar para o conteúdo», que é
 *    precisamente o utilizador que mais precisa dele.
 * 5. **A primeira renderização não mexe no foco.** Abrir um link direto para `/stats` não é
 *    uma navegação: o browser já pôs o foco no topo, e roubá-lo para o `main` só serviria para
 *    deslocar quem estava a ler. O **título**, esse, é escrito logo na primeira renderização —
 *    senão um carregamento direto ficaria com «Zemlo».
 */

/**
 * Ordem de preferência do alvo de foco, do mais específico para o mais genérico.
 *
 * Exportada para que o teste possa afirmar que o `#conteudo` vem **primeiro** — se alguém
 * trocar a ordem, o foco passa a cair num `h1` (ou em nada) e isso tem de ser visível.
 */
export const FOCUS_TARGET_SELECTORS = ['#conteudo', 'main', '[role="main"]', 'h1'] as const;

/**
 * Devolve o primeiro alvo de foco que existir no documento, ou `null`.
 *
 * Recebe o `Document` por parâmetro (em vez de o ir buscar) para deixar explícita a única
 * dependência externa desta função — e para que ela possa ser exercitada sem depender do
 * documento global do ambiente de teste.
 */
export function findFocusTarget(doc: Document): HTMLElement | null {
  for (const seletor of FOCUS_TARGET_SELECTORS) {
    const alvo = doc.querySelector<HTMLElement>(seletor);
    if (alvo) return alvo;
  }
  return null;
}

/**
 * Anuncia a mudança de página: escreve o título e move o foco para o conteúdo principal.
 *
 * Chamado **uma só vez**, no topo do `App` — dentro do router, para poder ler a localização.
 */
export function useRouteAnnouncement(): void {
  const { pathname } = useLocation();
  const primeiraRenderizacao = useRef(true);

  useEffect(() => {
    // O título é escrito sempre, incluindo na primeira renderização: um carregamento direto
    // de `/settings/security` tem de ficar com o título certo e não com o do `index.html`.
    document.title = documentTitleFor(pathname);

    if (primeiraRenderizacao.current) {
      primeiraRenderizacao.current = false;
      return;
    }

    const alvo = findFocusTarget(document);
    if (!alvo) return;

    // Garantir a focabilidade em vez de a assumir: um alvo sem `tabindex` aceita `.focus()`
    // sem erro e **sem efeito**, e o defeito passaria despercebido.
    if (!alvo.hasAttribute('tabindex')) alvo.setAttribute('tabindex', '-1');

    alvo.focus({ preventScroll: true });
  }, [pathname]);
}
