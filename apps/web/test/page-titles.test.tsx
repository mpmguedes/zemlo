import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  PAGE_TITLES,
  RELATIVE_ROUTE_PATHS,
  SITE_NAME,
  documentTitleFor,
  missingPageTitles,
  pageTitleFor,
} from '../src/app/pageTitles';
import { FOCUS_TARGET_SELECTORS } from '../src/app/useRouteAnnouncement';

/*
 * Título e foco na mudança de página (`WEB-012`).
 *
 * ## O que estes testes provam, e o que não podem provar
 *
 * Provam: (a) que **cada rota declarada tem título** — o teste que a tarefa pede, o que falha
 * quando alguém acrescenta uma rota sem lhe dar título; (b) que a resolução de um URL concreto
 * devolve o título certo, no formato decidido; (c) que o alvo de foco existe no HTML e é
 * focável.
 *
 * **Não** provam: que o foco se move. Isso é comportamento de DOM, e o projeto não tem `jsdom`
 * nem `@testing-library` — a regra da casa, escrita em `page-states.test.tsx`, é não os
 * acrescentar. Um teste que clicasse num link e verificasse `document.activeElement` não poderia
 * correr aqui. Fica **declarado como limitação**, em vez de simulado com um stub que fingiria
 * observar o que não observa.
 */

/* -------------------------------------------------------------------------- */
/* A invariante: nenhuma rota declarada fica sem título                       */
/* -------------------------------------------------------------------------- */

const APP_SRC = readFileSync(fileURLToPath(new URL('../src/App.tsx', import.meta.url)), 'utf8');

/**
 * Os `path` declarados no routing, lidos do **código-fonte** e não de uma lista escrita à mão.
 *
 * É o que dá sentido ao teste: uma lista à mão teria de ser atualizada por quem acrescenta a
 * rota — exatamente a pessoa que se esquece do título. Lendo o routing, o conjunto esperado
 * cresce sozinho e a rota nova aparece como «sem título» sem ninguém ter de se lembrar.
 */
/*
 * O `!` do grupo de captura e obrigatorio por causa de `noUncheckedIndexedAccess` (que a app
 * liga em `apps/web/tsconfig.json`): sem ele, `m[1]` e `string | undefined` e a lista deixa de
 * ser aceite por `missingPageTitles(readonly string[])` — `TS2345` na chamada.
 *
 * Nao e um cast cego: o grupo `([^"]+)` **nao** e opcional no padrao, logo `m[1]` existe sempre
 * que ha casamento; e a assercao de contagem logo abaixo (33 ocorrencias, 32 distintas) faz
 * falhar o teste se alguma captura se perder. E a mesma forma que `bundle-import-transport.test.ts`
 * ja usa para `captured[0]!`.
 */
const DECLARED_PATHS = [...APP_SRC.matchAll(/path="([^"]+)"/g)].map((m) => m[1]!);
const UNIQUE_DECLARED_PATHS = [...new Set(DECLARED_PATHS)];

/** Quantas rotas o routing declara. Fixado: é o número que o ROADMAP documenta. */
const TOTAL_ROTAS = 32;

describe('WEB-012 · A5 · cada rota declarada tem título', () => {
  it('a extração encontra as 32 rotas (não passa por vacuidade)', () => {
    /*
     * Sem esta asserção, uma expressão que deixasse de casar com o `App.tsx` — reformatar a
     * etiqueta, mudar as aspas — faria o teste seguinte passar para sempre com zero rotas
     * encontradas. É a diferença entre um teste e um ornamento.
     *
     * O valor é exato e não uma margem: acrescentar uma rota legítima **deve** obrigar a mexer
     * aqui e no mapa, e é isso que se quer. Uma margem folgada deixaria o mapa encolher em
     * silêncio.
     */
    expect(DECLARED_PATHS.length).toBe(33); // 32 distintas + o `*` repetido (App e onboarding)
    expect(UNIQUE_DECLARED_PATHS.length).toBe(TOTAL_ROTAS);
  });

  it('nenhuma rota declarada fica sem título', () => {
    // A asserção central da tarefa. Falha com o **nome** da rota em falta, para que a correção
    // seja acrescentar a entrada e não investigar.
    expect(missingPageTitles(UNIQUE_DECLARED_PATHS)).toEqual([]);
  });

  it('o mapa não tem títulos a mais (nem rotas inventadas)', () => {
    // A recíproca: uma entrada que já não corresponde a nenhuma rota é um título morto, e um
    // título morto é a próxima pessoa a acreditar que a rota existe.
    const chaves = Object.keys(PAGE_TITLES);
    const orfas = chaves.filter((chave) => !UNIQUE_DECLARED_PATHS.includes(chave));
    expect(orfas).toEqual([]);
    expect(chaves.length).toBe(TOTAL_ROTAS);
  });

  it('a invariante morde numa rota sem título', () => {
    // Prova de que `missingPageTitles` deteta o defeito que existe para detetar — e não só que
    // devolve uma lista vazia quando está tudo bem. Sem isto, uma função que devolvesse sempre
    // `[]` passaria nos dois testes anteriores.
    expect(missingPageTitles(['/login', '/rota-que-nao-existe'])).toEqual(['/rota-que-nao-existe']);
  });

  it('as únicas chaves não resolvíveis são as três etapas do onboarding', () => {
    /*
     * Uma chave do mapa que não seja resolvível a partir de um URL é um título que ninguém
     * consegue ver. Aqui isso é legítimo — as três etapas são `path` relativos, cobertos pelo
     * `*` do pai — mas tem de ser **a exceção declarada**, e não uma surpresa: se alguém
     * acrescentar um `path` relativo novo e o puser no mapa, este teste obriga a acrescentá-lo
     * também a `RELATIVE_ROUTE_PATHS`, onde a decisão fica visível.
     */
    const naoResolviveis = Object.keys(PAGE_TITLES).filter(
      (chave) => !chave.startsWith('/') && chave !== '*',
    );
    expect(naoResolviveis.sort()).toEqual([...RELATIVE_ROUTE_PATHS].sort());
    // E nenhuma delas é o `*`, que **tem** de ser resolvível.
    expect(RELATIVE_ROUTE_PATHS).not.toContain('*');
  });
});

/* -------------------------------------------------------------------------- */
/* A resolução: o URL concreto leva ao título certo, no formato decidido      */
/* -------------------------------------------------------------------------- */

/**
 * Um URL concreto para cada padrão resolvível. Os padrões com parâmetros recebem um valor
 * plausível (`v1`, `d1`), porque é isso que um URL real traz.
 *
 * Os três `path` **relativos** do onboarding não estão aqui de propósito: não são resolvíveis a
 * partir de um URL absoluto (ver `pageTitles.ts`), e têm um teste próprio a seguir.
 */
const CONCRETO: Record<string, string> = {
  '/login': '/login',
  '/signup': '/signup',
  '/recuperar-password': '/recuperar-password',
  '/repor-password': '/repor-password',
  '/verificar-email': '/verificar-email',
  '/auth/verify-email': '/auth/verify-email',
  '/onboarding/*': '/onboarding/conta',
  '/': '/',
  '/vehicles': '/vehicles',
  '/vehicles/new': '/vehicles/new',
  '/vehicles/:vehicleId': '/vehicles/v1',
  '/records/:kind': '/records/expenses',
  '/records/reminders': '/records/reminders',
  '/documents': '/documents',
  '/documents/:documentId': '/documents/d1',
  '/stats': '/stats',
  '/timeline': '/timeline',
  '/calendar': '/calendar',
  '/notifications': '/notifications',
  '/integrations': '/integrations',
  '/integrations/home-assistant': '/integrations/home-assistant',
  '/export': '/export',
  '/import': '/import',
  '/settings': '/settings',
  '/settings/profile': '/settings/profile',
  '/settings/preferences': '/settings/preferences',
  '/settings/security': '/settings/security',
  '/records/:kind/:recordId': '/records/expenses/e1',
  '*': '/nao-existe-mesmo',
};

describe('WEB-012 · A5 · a resolução do título', () => {
  it('cada URL concreto devolve o título do seu padrão, no formato `<Título> · Zemlo`', () => {
    for (const [padrao, caminho] of Object.entries(CONCRETO)) {
      expect(documentTitleFor(caminho), `${padrao} -> ${caminho}`).toBe(
        `${PAGE_TITLES[padrao]} · ${SITE_NAME}`,
      );
    }
  });

  it('o sufixo do título é literalmente «Zemlo»', () => {
    /*
     * Esta asserção existe por causa de uma **mutação sobrevivente**. A anterior compara com o
     * `SITE_NAME` importado do próprio módulo: mudar a constante muda os dois lados da
     * igualdade e o teste continua verde — passava sem verificar nada sobre o valor. Foi a
     * mutação **M7** (`SITE_NAME = 'ZemloApp'`) que o mostrou, e é o único sobrevivente da
     * primeira ronda da prova.
     *
     * O valor fica aqui **escrito**, que é o que o produto promete: `<Título da página> · Zemlo`.
     * Uma constante que se move com o código não consegue fixar o código.
     */
    expect(SITE_NAME).toBe('Zemlo');
    expect(documentTitleFor('/')).toBe('Painel · Zemlo');
    expect(documentTitleFor('/settings/security')).toBe('Segurança · Zemlo');
    expect(documentTitleFor('/nao-existe')).toBe('Página não encontrada · Zemlo');
  });

  it('a resolução é discriminante (não devolve o mesmo para tudo)', () => {
    /*
     * Guarda anti-vacuidade: se o `matchRoutes` deixasse de casar (ou o formato do mapa
     * mudasse), `pageTitleFor` cairia no `FALLBACK_TITLE` para **todos** os caminhos e o teste
     * anterior continuaria a passar — contra um produto que não distingue uma página de outra.
     * Exigir diversidade é o que separa «resolve» de «devolve sempre a mesma coisa».
     */
    const titulos = Object.values(CONCRETO).map((caminho) => pageTitleFor(caminho));
    expect(new Set(titulos).size).toBeGreaterThanOrEqual(25);
    for (const titulo of titulos) expect(titulo).not.toBe(SITE_NAME);
  });

  it('o padrão mais específico ganha ao genérico', () => {
    // É a razão de a resolução usar o `matchRoutes` do router em vez de um casador escrito à
    // mão: a ordem de declaração do mapa não pode decidir isto.
    expect(pageTitleFor('/records/reminders')).toBe(PAGE_TITLES['/records/reminders']);
    expect(pageTitleFor('/integrations/home-assistant')).toBe(
      PAGE_TITLES['/integrations/home-assistant'],
    );
    // E o genérico continua a apanhar o que é dele.
    expect(pageTitleFor('/records/fuel')).toBe(PAGE_TITLES['/records/:kind']);
    expect(pageTitleFor('/integrations')).toBe(PAGE_TITLES['/integrations']);
  });

  it('as etapas do onboarding resolvem pelo título do fluxo', () => {
    // As três etapas são `path` relativos: um URL absoluto casa com `/onboarding/*`, que é o
    // título do fluxo. O utilizador vê «Primeiros passos» em qualquer das três, que é o que
    // elas são.
    for (const etapa of ['/onboarding/conta', '/onboarding/veiculo', '/onboarding/pronto']) {
      expect(documentTitleFor(etapa), etapa).toBe(`Primeiros passos · ${SITE_NAME}`);
    }
  });

  it('um URL desconhecido tem título, e não um documento sem nome', () => {
    expect(documentTitleFor('/isto-nao-existe-de-todo')).toBe(
      `${PAGE_TITLES['*']} · ${SITE_NAME}`,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* O alvo de foco                                                             */
/* -------------------------------------------------------------------------- */

vi.mock('../src/api/hooks', () => ({
  useUnreadCount: () => 3,
  useResendEmailVerification: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../src/hooks', () => ({
  useSelectedVehicle: () => ({
    vehicleId: 'all',
    vehicle: null,
    vehicles: [],
    isLoading: false,
    isError: false,
    select: () => {},
    isEmpty: true,
  }),
}));

vi.mock('../src/app/SessionContext', () => ({
  useSession: () => ({
    profile: { id: 'u1', email: 'a@b.pt', name: 'Ana', emailVerified: true },
    signOut: vi.fn(),
  }),
}));

const { AppShell } = await import('../src/app/AppShell');
const { QuickLogProvider } = await import('../src/components/QuickLogContext');

function renderShell(): string {
  return renderToStaticMarkup(
    // O `AppShell` usa `useMutation` (terminar sessão), que exige um cliente de consultas.
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/']}>
        <QuickLogProvider>
          <Routes>
            <Route path="/" element={<AppShell />} />
          </Routes>
        </QuickLogProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('WEB-012 · A6 · o alvo de foco existe e é focável', () => {
  it('o `<main>` do shell tem o `id` do alvo e `tabindex="-1"`', () => {
    /*
     * Um elemento sem `tabindex` aceita `.focus()` **sem erro e sem efeito** — o efeito de
     * navegação correria para nada e o defeito pareceria corrigido. Por isso o atributo é
     * afirmado, e não assumido.
     *
     * A expressão é insensível a maiúsculas: em JSX escreve-se `tabIndex` e o React escreve
     * `tabindex` no HTML. Prender o teste à grafia de uma versão do React seria fazê-lo falhar
     * numa atualização sem nada se ter partido no produto (mesma convenção de
     * `accessibility.test.tsx`).
     */
    const html = renderShell();
    expect(html).toMatch(/id="conteudo"[^>]*tabindex="-1"/i);
    expect(html).toMatch(/<main[^>]*id="conteudo"/i);
  });

  it('o alvo preferido é o `#conteudo`, e não um `h1`', () => {
    // A ordem importa: o `main` é o contentor de tudo o que muda e existe em todos os ecrãs
    // autenticados; o `h1` não existe no painel em estado normal. Trocar a ordem mudaria o
    // comportamento sem partir mais nada — é exatamente o que este teste fixa.
    expect(FOCUS_TARGET_SELECTORS[0]).toBe('#conteudo');
    expect(FOCUS_TARGET_SELECTORS).toContain('h1'); // a rede, no fim, não no princípio
  });

  it('o efeito está ligado no `App` (guarda estática de convenção)', () => {
    /*
     * Verificação ESTÁTICA, e rotulada como tal: sem DOM não há como observar o foco, pelo que
     * o que se afirma é que a ligação existe. Uma ligação removida por engano deixaria o mapa de
     * títulos correto e nenhum título escrito — o defeito original, outra vez.
     *
     * A expressão é **ancorada ao início da linha** de propósito: um `toContain('useRouteAnnouncement()')`
     * passaria com a chamada **comentada** (`// useRouteAnnouncement();`), que é exatamente a
     * forma como uma ligação é desligada sem apagar código. Foi uma mutação que o mostrou.
     */
    expect(APP_SRC).toMatch(/^\s*useRouteAnnouncement\(\);/m);
    expect(APP_SRC).toContain("from './app/useRouteAnnouncement'");
  });
});
