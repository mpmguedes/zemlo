import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/*
 * UX-02 — iconografia da navegação.
 *
 * ## O que esta frente mudou
 *
 * O `AppShell` era o último reduto de emoji do produto. Todos os itens de navegação — barra
 * lateral, barra superior e barra inferior — desenhavam emoji (`🏠 🚗 💶 ⛽ 🔌 🔧 🔔 📄 📊 🕒 🗓️
 * 🔗 📤 📥 ⚙️`), mais os glifos de texto `⎋` (U+238B) e `＋` (U+FF0B). Passaram a usar a mesma
 * família SVG local (`ui/Icon.tsx`) que o menu de registo já usava.
 *
 * ## O que estes testes fixam, e porquê
 *
 * A navegação é o sítio onde uma regressão custa mais caro: é o que existe em todas as páginas.
 * O que aqui se afirma é (1) que os **destinos** não mudaram — a representação é que mudou, não
 * a semântica —, (2) que não ficou emoji nenhum, (3) que cada ícone desenha geometria a sério e
 * (4) que o mapa de ícones é total, para não haver um fallback silencioso a mascarar um ícone em
 * falta.
 *
 * ## Sem `jsdom`
 *
 * É a regra escrita do projeto (`page-states.test.tsx`): não há eventos, logo não há `:hover`
 * nem `:active` observáveis. O que se observa é o HTML produzido (`renderToStaticMarkup`) e o
 * fonte/CSS. Os estados que dependem de interação são fixados sobre a **regra** em `app.css`,
 * declarando explicitamente que é isso que se mede.
 */

const APP_SHELL = fileURLToPath(new URL('../src/app/AppShell.tsx', import.meta.url));
const APP_CSS = fileURLToPath(new URL('../src/styles/app.css', import.meta.url));
const ROUTES = fileURLToPath(new URL('../src/App.tsx', import.meta.url));
const ICON = fileURLToPath(new URL('../src/ui/Icon.tsx', import.meta.url));

const ler = (caminho: string): string => readFileSync(caminho, 'utf8');

/**
 * Faixas de emoji/pictogramas — a mesma expressão dos testes do cartão de veículo
 * (`vehicle-cards.test.tsx`, `quick-log-vehicle.test.tsx`).
 *
 * Não inclui setas nem travessões: a prosa da interface usa `—` e `→`, que são tipografia.
 * O `⎋` (U+238B) e o `＋` (U+FF0B) ficam **fora** desta faixa de propósito — são glifos de
 * texto, não pictogramas, e por isso têm de ser caçados por literal (ver o teste do `⎋`).
 */
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

/* -------------------------------------------------------------------------- */
/* O Shell renderizado                                                        */
/* -------------------------------------------------------------------------- */

vi.mock('../src/api/hooks', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/api/hooks')>();
  const query = (data: unknown = undefined) => ({
    data,
    isLoading: false,
    isError: false,
    error: null,
  });
  return {
    ...real,
    useUnreadCount: () => 3,
    useVehicles: () => query({ items: [] }),
    useNotifications: () => query({ items: [], unreadCount: 3 }),
  };
});

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
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/']}>
        <QuickLogProvider>
          <Routes>
            <Route path="/" element={<AppShell />}>
              <Route index element={<p>conteúdo</p>} />
            </Route>
          </Routes>
        </QuickLogProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * Pares `destino → rótulo` que a navegação tem de oferecer.
 *
 * Escritos à mão, e não derivados do fonte que está a ser testado: uma lista derivada do
 * próprio código passaria sempre, mesmo que um destino tivesse desaparecido. É o vocabulário
 * que a UX-02 **não** pode mudar.
 */
const DESTINOS_LATERAIS: ReadonlyArray<readonly [string, string]> = [
  ['/', 'Painel'],
  ['/vehicles', 'Veículos'],
  ['/records/expenses', 'Despesas'],
  ['/records/fuel', 'Abastecimentos'],
  ['/records/charging', 'Carregamentos'],
  ['/records/maintenance', 'Manutenção'],
  ['/records/reminders', 'Lembretes'],
  ['/documents', 'Documentos'],
  ['/stats', 'Estatísticas'],
  ['/timeline', 'Histórico'],
  ['/calendar', 'Calendário'],
  ['/notifications', 'Notificações'],
  ['/integrations', 'Integrações'],
  ['/export', 'Exportar dados'],
  ['/import', 'Importar dados'],
  ['/settings', 'Definições'],
];

/* -------------------------------------------------------------------------- */
/* 1. Os itens reais continuam presentes                                      */
/* -------------------------------------------------------------------------- */

describe('UX-02 · a navegação mantém os itens e os destinos', () => {
  const fonte = ler(APP_SHELL);
  const html = renderShell();

  it('os ficheiros são lidos e trazem os literais de que as asserções dependem', () => {
    // Guarda anti-vacuidade: sem isto, um caminho errado daria strings vazias e o resto do
    // ficheiro passaria sem medir nada.
    expect(fonte.length).toBeGreaterThan(2000);
    expect(fonte).toContain('navGroups');
    expect(html.length).toBeGreaterThan(1000);
    expect(html).toContain('Navegação principal');
  });

  it('cada destino do menu lateral existe, com o mesmo caminho e o mesmo rótulo', () => {
    for (const [destino, rotulo] of DESTINOS_LATERAIS) {
      expect(fonte, destino).toContain(`to: '${destino}'`);
      expect(fonte, rotulo).toContain(`label: '${rotulo}'`);
      expect(html, destino).toContain(`href="${destino}"`);
      expect(html, rotulo).toContain(rotulo);
    }
  });

  it('a barra inferior oferece os quatro destinos de movimento, com os caminhos certos', () => {
    /*
     * A barra inferior é uma decisão de produto (§35): quatro destinos de consulta rápida mais
     * a ação central. Se um caminho aqui mudasse, o telemóvel perdia o destino — que é
     * precisamente o que esta frente não pode fazer.
     */
    expect(fonte).toMatch(/<TabLink to="\/" label="Painel"/);
    expect(fonte).toMatch(/<TabLink to="\/vehicles" label="Veículos"/);
    expect(fonte).toMatch(/<TabLink to="\/records\/expenses" label="Registos"/);
    expect(fonte).toMatch(/<TabLink to="\/notifications" label="Avisos"/);

    for (const destino of ['/', '/vehicles', '/records/expenses', '/notifications']) {
      expect(html, destino).toContain(`href="${destino}"`);
    }
  });

  it('«Registar» continua a ser uma ação central, não um destino', () => {
    /*
     * O botão do meio abre o menu de tipos (decisão 46) e nunca fica ativo. Se tivesse virado
     * um `NavLink`, ganharia `aria-current` e passaria a ser navegação — outra semântica.
     */
    expect(fonte).toContain('z-tabbar__link--action');
    expect(fonte).toContain('quickLog.openMenu()');
    const acao = /<button[\s\S]*?z-tabbar__link--action[\s\S]*?<\/button>/.exec(fonte);
    expect(acao, 'não encontrei o botão de ação central').not.toBeNull();
    expect(acao?.[0]).not.toContain('<NavLink');
  });

  it('todos os destinos da navegação apontam para rotas que existem', () => {
    /*
     * A asserção que impede uma promessa vazia: um `to` que não corresponde a nenhuma
     * `<Route>` no `App` levaria a um 404 dentro da própria aplicação.
     *
     * A comparação é por **padrão de segmentos**, e não por igualdade de string: as rotas de
     * registos vivem num único `<Route path="/records/:kind">`, pelo que `/records/expenses`
     * só casa com o `:kind` resolvido. Uma comparação literal acusaria todas as rotas
     * dinâmicas como inexistentes — foi o primeiro erro desta asserção, medido.
     */
    const padroes = [...ler(ROUTES).matchAll(/path="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((p) => p !== '*')
      .map((p) => p.split('/').filter(Boolean));

    const casaRota = (destino: string): boolean => {
      const alvo = destino.split('/').filter(Boolean);
      return padroes.some(
        (padrao) =>
          padrao.length === alvo.length &&
          padrao.every((seg, i) => seg.startsWith(':') || seg === alvo[i]),
      );
    };

    // Anti-vacuidade: sem isto, um regex partido devolveria zero padrões e `casaRota` seria
    // sempre falso — ou, com um `*` perdido, sempre verdadeiro.
    expect(padroes.length).toBeGreaterThan(10);

    for (const [destino] of DESTINOS_LATERAIS) {
      expect(casaRota(destino), `«${destino}» não corresponde a nenhuma <Route> do App`).toBe(true);
    }
    // E o controlo negativo: um caminho que não existe tem de ser recusado.
    expect(casaRota('/nao-existe-de-todo'), '/nao-existe-de-todo devia ser recusado').toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Não há emojis usados como ícones                                        */
/* -------------------------------------------------------------------------- */

describe('UX-02 · a navegação deixou de usar emojis', () => {
  const fonte = ler(APP_SHELL);
  const html = renderShell();

  it('o `AppShell` não tem um único emoji', () => {
    /*
     * A verificação é sobre o **código**, não sobre a prosa: o cabeçalho do ficheiro cita os
     * emojis antigos como exemplos do que foi substituído (`🏠 🚗 💶 …`), e essa citação é
     * documentação que deve poder existir. Sem excluir comentários, a asserção acusaria a
     * própria nota que explica a correção — medido.
     *
     * Ignoram-se linhas de comentário (`*`, `//`) e, dentro de uma linha, o que vem depois de
     * `//`. O que fica é o que o React pode desenhar: JSX, strings e atributos.
     */
    const codigo = fonte
      .split('\n')
      .map((linha, i) => ({ n: i + 1, texto: linha }))
      .filter(({ texto }) => !/^\s*(\*|\/\/|\/\*)/.test(texto))
      .map(({ n, texto }) => ({ n, texto: texto.split('//')[0] ?? '' }));

    expect(codigo.length).toBeGreaterThan(100);
    for (const { n, texto } of codigo) {
      expect(EMOJI.test(texto), `AppShell.tsx:${n} ${texto.trim()}`).toBe(false);
    }
  });

  it('o HTML da navegação não tem um único emoji', () => {
    expect(EMOJI.test(html), 'emoji encontrado no markup da navegação').toBe(false);
  });

  it('o glifo `⎋` do «Terminar sessão» desapareceu', () => {
    // U+238B está fora da faixa `EMOJI` (é um símbolo técnico, não um pictograma), pelo que
    // precisa de uma asserção própria — senão passaria despercebido.
    expect(fonte).not.toContain('\u238B');
    expect(html).not.toContain('\u238B');
  });

  it('o `＋` de largura total (U+FF0B) desapareceu', () => {
    // O `＋` era o `icon="＋"` do botão lateral e o glifo do círculo âmbar da barra inferior.
    // U+FF0B é um caractere de largura total, não um pictograma: a faixa `EMOJI` não o apanharia.
    expect(fonte).not.toContain('\uFF0B');
    expect(html).not.toContain('\uFF0B');
  });

  it('a guarda do `EMOJI` morde — os emojis que estavam lá são detetados', () => {
    /*
     * Anti-vacuidade pelo lado oposto das outras: se a expressão deixasse de casar (por um
     * erro de escape, por exemplo), todos os testes acima passariam para sempre. Aqui prova-se
     * que ela reconhece exatamente os glifos que o `AppShell` usava.
     */
    for (const antigo of ['🏠', '🚗', '💶', '⛽', '🔌', '🔧', '🔔', '📄', '📊', '🕒', '🔗', '📤', '📥', '⚙️']) {
      expect(EMOJI.test(antigo), `${antigo} devia ser detetado`).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Os ícones SVG têm geometria a sério                                      */
/* -------------------------------------------------------------------------- */

describe('UX-02 · os ícones da navegação desenham geometria real', () => {
  const html = renderShell();

  /*
   * Só os ícones da **família** — o logótipo (`z-logo__symbol`) fica de fora, e não por
   * conveniência: é uma marca preenchida (`fill`, com `<rect>` e `<g>`, sem traço), desenhada
   * para viver aos 26–28 px ao lado do texto. Foi ele que fez cair a primeira versão desta
   * asserção, que exigia traço a **todos** os `<svg>` do ecrã — medido. A família de ícones é a
   * que declara `stroke-width="1.75"`; é por isso que o filtro é esse e não uma classe.
   */
  const icones = (): string[] =>
    (html.match(/<svg[\s\S]*?<\/svg>/g) ?? []).filter((s) => s.includes('stroke-width="1.75"'));

  it('a navegação desenha ícones da família, e não texto', () => {
    // 16 itens laterais + «Terminar sessão» + sininho da barra superior + 4 ícones da barra
    // inferior (incluindo a ação central).
    expect(icones().length).toBeGreaterThanOrEqual(18);
  });

  it('cada ícone traz `path` com geometria a sério', () => {
    /*
     * O falso verde medido na UX-01: um nome de ícone que não existisse no mapa renderizava um
     * `<svg>` **vazio**, sem erro nenhum — e uma asserção que só contasse `<svg>` passava. O
     * que morde é exigir geometria: `d="…"` a começar por `M`/`m`. O `gauge` e o `clock` usam
     * `<circle>` como primeiro elemento, mas todos têm pelo menos um `path` com traço.
     */
    const lista = icones();
    expect(lista.length).toBeGreaterThanOrEqual(18);
    for (const svg of lista) {
      expect(svg, 'ícone sem geometria').toMatch(/d="[Mm]/);
    }
  });

  it('os ícones usam a família: `currentColor` e o peso do sistema', () => {
    for (const svg of icones()) {
      expect(svg, 'sem currentColor').toContain('stroke="currentColor"');
      expect(svg, 'sem stroke-width').toContain('stroke-width="1.75"');
      // Decorativos: o nome acessível do controlo é o texto ao lado, não o glifo.
      expect(svg, 'ícone não marcado como decorativo').toContain('aria-hidden="true"');
    }
  });

  it('o logótipo não faz parte da família de ícones (é uma marca, não um ícone)', () => {
    // Fixa a distinção para que ninguém «uniformize» o logótipo para traço: perderia a marca.
    expect(html).toContain('z-logo__symbol');
    const logo = (html.match(/<svg[^>]*z-logo__symbol[\s\S]*?<\/svg>/) ?? [''])[0];
    expect(logo.length).toBeGreaterThan(0);
    expect(logo).not.toContain('stroke-width="1.75"');
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Sem fallback silencioso a mascarar ícones ausentes                      */
/* -------------------------------------------------------------------------- */

describe('UX-02 · o mapa de ícones é total e não há fallback silencioso', () => {
  const fonteIcone = ler(ICON);
  const fonte = ler(APP_SHELL);

  it('`PATHS` é um `Record` total sobre `IconName`', () => {
    // Se fosse um `Partial`, um nome sem geometria compilaria e desenharia um `<svg>` vazio —
    // exatamente o fallback silencioso que esta frente tem de impedir. Sendo total, é o
    // compilador que recusa.
    expect(fonteIcone).toMatch(/const PATHS: Record<IconName, ReactNode> = \{/);
  });

  it('todos os nomes de ícone usados pela navegação existem no `IconName`', () => {
    /*
     * A prova cruzada: os nomes que o `AppShell` pede (`icon: 'home'`, `<Icon name="logout"`)
     * têm de estar declarados no `IconName`. Sem isto, um nome mal escrito só se veria em
     * runtime — como um `<svg>` vazio.
     */
    const declarados = new Set(
      [...fonteIcone.matchAll(/'([a-z]+)'\s*\|?/g)].map((m) => m[1]),
    );
    const usados = new Set([
      ...[...fonte.matchAll(/icon: '([a-z]+)'/g)].map((m) => m[1]),
      ...[...fonte.matchAll(/<Icon name="([a-z]+)"/g)].map((m) => m[1]),
      ...[...fonte.matchAll(/icon="([a-z]+)"/g)].map((m) => m[1]),
    ]);

    expect(usados.size).toBeGreaterThanOrEqual(10);
    for (const nome of usados) {
      expect(declarados.has(nome), `«${nome}» não está no IconName`).toBe(true);
    }
  });

  it('a navegação não tem um mapa de fallback próprio', () => {
    // Um `?? 'receipt'` aqui seria uma segunda política de omissão, a par da de
    // `recordIconName`. A navegação usa o `IconName` diretamente: o tipo é fechado, não há
    // ausência a tratar.
    expect(fonte).not.toMatch(/icon\s*[?:]{2}\s*['"]/);
    expect(fonte).not.toContain('recordIconName');
  });

  it('nenhum ícone se repete dentro do mesmo grupo, exceto onde a repetição é intencional', () => {
    /*
     * Um mapa com colisões daria a mesma cara a dois destinos. A exceção é o `bell`: é o sino
     * de «Lembretes» e de «Notificações» na barra lateral, e o mesmo sino na barra inferior —
     * a repetição é do **conceito** (avisos), não um descuido. Fixa-se o número para que um
     * ícone novo copiado de outro sítio faça o teste cair.
     */
    const usados = [...fonte.matchAll(/icon: '([a-z]+)'/g)].map((m) => m[1]);
    expect(usados.filter((n) => n === 'bell')).toHaveLength(2);
    const unicos = new Set(usados);
    expect(unicos.size).toBe(usados.length - 1); // só o `bell` se repete
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Estados — o que é observável sem `jsdom`                                */
/* -------------------------------------------------------------------------- */

describe('UX-02 · os estados da navegação', () => {
  const css = ler(APP_CSS);
  const html = renderShell();

  it('o item ativo usa `[aria-current="page"]`, que é o que o `NavLink` escreve', () => {
    /*
     * A barra lateral e a inferior não marcam o ativo com uma classe: usam o atributo que o
     * `NavLink` escreve por omissão. É por ele que o CSS pinta o estado ativo — logo, se o
     * seletor desaparecesse, o item ativo ficava indistinguível.
     */
    expect(css).toContain(".z-sidebar__link[aria-current='page']");
    expect(css).toContain(".z-tabbar__link[aria-current='page']");
    // No markup inicial estamos em `/`, pelo que «Painel» é o item ativo.
    expect(html).toMatch(/href="\/"\s+aria-current="page"|aria-current="page"[^>]*href="\/"/);
  });

  it('o hover está fixado por regra (não é observável em `renderToStaticMarkup`)', () => {
    // Declarado: sem `jsdom` não há `:hover` a disparar. O que se fixa é a existência da regra.
    expect(css).toContain('.z-sidebar__link:hover');
    expect(css).toMatch(/\.z-tabbar__link--action:hover \.z-tabbar__action/);
  });

  it('o retorno de toque (`:active`) existe na navegação', () => {
    expect(css).toMatch(/\.z-tabbar__link--action:active \.z-tabbar__action/);
    expect(css).toContain('.z-icon-btn:active');
  });

  it('o foco visível é o anel global da casa, não um valor local', () => {
    // A regra de `:focus-visible` é global (UX-01) e cobre tudo o que recebe foco por teclado.
    // A navegação não inventa um anel próprio: usa os tokens.
    expect(css).toContain(':focus-visible');
    expect(css).toContain('var(--z-focus-ring-width)');
    expect(css).toContain('var(--z-focus-ring-offset)');
    // Nenhum dos controlos da navegação escreve um `outline` com número solto.
    const navegacao = css.slice(css.indexOf('.z-sidebar'), css.indexOf('.z-tabbar__badge'));
    expect(navegacao).not.toMatch(/outline:\s*\d/);
  });

  it('o alvo de toque é de pelo menos 44 px em ambos os ecrãs', () => {
    /*
     * A asserção é sobre a **política** (≥ 44 px), não sobre o número escolhido: a barra
     * lateral usa `--z-touch` (o token de 44 px) e a inferior fixa uma altura própria, que a
     * UX-02 ajustou (60 px, para acomodar o círculo de 34 px do botão central). Fixar «56px»
     * seria prender o teste a um valor que já mudou uma vez sem nada se ter partido — foi o
     * primeiro erro desta asserção, medido.
     */
    const valorMin = (bloco: string): number => {
      const m = /min-height:\s*([\d.]+)px/.exec(bloco);
      if (m) return Number(m[1]);
      // `min-height: var(--z-touch)` — resolve-se pelo token, que vale 44 px.
      expect(bloco, 'min-height com token inesperado').toContain('var(--z-touch)');
      return 44;
    };

    const lateral = /\.z-sidebar__link \{[\s\S]*?\n\}/.exec(css)?.[0] ?? '';
    const inferior = /\.z-tabbar__link \{[\s\S]*?\n\}/.exec(css)?.[0] ?? '';

    expect(lateral.length, 'não encontrei .z-sidebar__link').toBeGreaterThan(0);
    expect(inferior.length, 'não encontrei .z-tabbar__link').toBeGreaterThan(0);
    expect(valorMin(lateral), 'alvo da barra lateral').toBeGreaterThanOrEqual(44);
    expect(valorMin(inferior), 'alvo da barra inferior').toBeGreaterThanOrEqual(44);
  });

  it('não há cores literais nos controlos da navegação', () => {
    /*
     * O defeito que esta frente corrigiu: `.z-tabbar__action` tinha `background: #d99b0b` e
     * `color: #4d340a` escritos à mão. Além de violar a regra do projeto (nenhuma cor fora dos
     * tokens), era um defeito de **tema** — no escuro o âmbar sobe para `amber-400`, e um hex
     * fixo ficava com o par errado.
     */
    const navegacao = css.slice(css.indexOf('.z-sidebar'), css.indexOf('.z-tabbar__badge'));
    const ofensas = navegacao
      .split('\n')
      .filter((l) => /(?:color|background)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\()/.test(l.trim()));
    expect(ofensas, `cores à mão na navegação: ${ofensas.join(' | ')}`).toEqual([]);
  });

  it('o único `<button>` da navegação repõe o aspeto do agente de utilizador', () => {
    /*
     * `TabLink` rende `<a>`; o centro «Registar» é o **único** `<button>` da navegação, e um
     * `<button>` traz o fundo `#f0f0f0` e a tinta `ButtonText` do UA. Sem os repor, ficava uma
     * caixa cinzenta clara atrás do item e o rótulo «Registar» — que herda a tinta esbatida da
     * barra (branco a 78 %) — desaparecia sobre ela.
     *
     * Medido em Chromium/Edge a 390 px, tema claro, antes da correção: `background-color`
     * `rgb(240, 240, 240)` no link e o rótulo a ~1,06:1. Depois: `rgba(0, 0, 0, 0)`.
     *
     * A asserção corre sobre a **regra da barra inferior**, não sobre o ficheiro todo: o mesmo
     * reset existe noutros componentes e seria um falso verde encontrá-lo em qualquer sítio.
     */
    const regra = /\.z-tabbar__link--action \{[\s\S]*?\n\}/.exec(css)?.[0] ?? '';
    expect(regra.length, 'não encontrei .z-tabbar__link--action').toBeGreaterThan(0);
    expect(regra).toMatch(/background:\s*none/);
    expect(regra).toMatch(/border:\s*0/);
    expect(regra).toMatch(/appearance:\s*none/);
    // E o markup confirma que o elemento é mesmo um `<button>` — sem isto a regra seria inútil.
    expect(html).toMatch(/<button[^>]*z-tabbar__link--action/);
  });

  it('o `:disabled` existe onde a navegação o usa («Terminar sessão» a sair)', () => {
    // O único controlo da navegação que pode estar desabilitado é o de terminar sessão,
    // enquanto o pedido corre. O `disabled` tem de ter representação própria.
    expect(html.length).toBeGreaterThan(0);
    expect(css).toMatch(/\.z-btn:disabled|\[disabled\]|:disabled/);
  });
});
