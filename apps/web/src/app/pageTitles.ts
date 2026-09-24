import { matchRoutes, type RouteObject } from 'react-router-dom';

/*
 * Títulos de página (`WEB-012`, defeito A5 — WCAG 2.4.2).
 *
 * ## Porque é que o título vive aqui, e não em cada página
 *
 * Decisão de política do utilizador: **um mapa central** `rota → título` como fonte única de
 * verdade. A alternativa — cada página declarar o seu título — foi rejeitada por ter dois
 * sítios onde a mesma coisa pode ser esquecida (a rota e a página). Aqui há um só.
 *
 * ## Porque é que a chave é o `path` **como está escrito** em `App.tsx`
 *
 * É o que torna a cobertura **verificável**. O teste lê os `path=` do routing e exige igualdade
 * com estas chaves; acrescentar uma rota sem lhe dar título fica vermelho sem que ninguém tenha
 * de se lembrar de o pedir. Um mapa indexado por «nome da página» não permitiria essa
 * verificação, porque não há como derivar do routing o conjunto de nomes esperados.
 *
 * Consequência aceite e declarada: os três `path` **relativos** do onboarding (`conta`,
 * `veiculo`, `pronto`, dentro de `/onboarding/*`) são chaves legítimas — são rotas declaradas —
 * mas não são resolvíveis a partir de um URL absoluto. Quem resolve um URL concreto passa
 * sempre pelo `*` do pai (`/onboarding/*`), que carrega o título do fluxo. Um segundo
 * agrupamento aninhado obrigaria a qualificar as chaves; hoje há um só, e está dito aqui.
 */

/** O nome do produto, usado no sufixo do título do documento. */
export const SITE_NAME = 'Zemlo';

/**
 * O mapa central. **Trinta e duas entradas — uma por cada `path` declarado em `App.tsx`.**
 *
 * O título de cada rota usa o **vocabulário do produto** (o mesmo que o `<h1>` do ecrã), e não
 * uma paráfrase: «Adicionar veículo» é o que o ecrã diz, «Veículos» é o que a navegação diz.
 * Onde a página é dinâmica (`/records/:kind` mostra Despesas, Seguros, Impostos…), o título é
 * o **genérico da família** — especializá-lo exigiria uma segunda fonte de verdade, que é
 * exatamente o que a política proíbe. Está registado como limitação no relatório da tarefa.
 */
export const PAGE_TITLES: Record<string, string> = {
  // Autenticação e recuperação de conta.
  '/login': 'Entrar',
  '/signup': 'Criar conta',
  '/recuperar-password': 'Recuperar password',
  '/repor-password': 'Nova password',
  '/verificar-email': 'Verificar email',
  // Alias do anterior, pedido no briefing. Mesmo título de propósito: é o mesmo ecrã.
  '/auth/verify-email': 'Verificar email',

  // Onboarding: um fluxo, quatro `path` declarados (`/onboarding/*` mais as três etapas
  // relativas). Um só título porque para o utilizador é uma coisa só — «primeiros passos».
  '/onboarding/*': 'Primeiros passos',
  conta: 'Primeiros passos',
  veiculo: 'Primeiros passos',
  pronto: 'Primeiros passos',

  // Aplicação autenticada.
  '/': 'Painel',
  '/vehicles': 'Veículos',
  '/vehicles/new': 'Adicionar veículo',
  '/vehicles/:vehicleId': 'Veículo',
  '/records/:kind': 'Registos',
  '/records/reminders': 'Lembretes',
  '/documents': 'Documentos',
  '/documents/:documentId': 'Documento',
  '/stats': 'Estatísticas',
  '/timeline': 'Histórico',
  '/calendar': 'Calendário',
  '/notifications': 'Notificações',
  '/integrations': 'Integrações',
  '/integrations/home-assistant': 'Home Assistant',
  '/export': 'Exportar dados',
  '/import': 'Importar de um ficheiro',
  '/settings': 'Definições',
  '/settings/profile': 'Perfil',
  '/settings/preferences': 'Preferências',
  '/settings/security': 'Segurança',
  '/records/:kind/:recordId': 'Registo',

  // A rota `*` (página inexistente). É a única que serve de rede: qualquer URL que não case
  // com nada tem de sair daqui com um título, e não com um documento sem nome.
  '*': 'Página não encontrada',
};

/**
 * Título usado quando nenhum padrão casa. Na prática inalcançável — `*` casa com tudo — mas
 * existe para que `pageTitleFor` seja **total**: uma função que devolve `undefined` num caso
 * de fronteira transforma um defeito de título num `document.title` literalmente «undefined»,
 * que é pior do que o problema que esta tarefa corrige.
 */
export const FALLBACK_TITLE = SITE_NAME;

type TitledRoute = RouteObject & { title: string };

/**
 * Os `path` **relativos** do onboarding. São as únicas chaves do mapa que não são resolvíveis a
 * partir de um URL absoluto — um URL concreto casa sempre com o `*` do pai (`/onboarding/*`).
 *
 * Estão declaradas numa constante, e não deixadas implícitas num filtro, para que o teste possa
 * afirmar que **são exatamente estas** as exceções: se alguém acrescentar um `path` relativo
 * novo, ele tem de vir parar a esta lista, e é isso que impede um título de ficar
 * silenciosamente inalcançável.
 */
export const RELATIVE_ROUTE_PATHS = ['conta', 'veiculo', 'pronto'] as const;

/**
 * Tabela de resolução: todos os padrões **exceto os relativos**.
 *
 * O `*` fica incluído — é o que faz `pageTitleFor` responder a um URL desconhecido com «Página
 * não encontrada» em vez de cair no fallback. (A primeira versão deste filtro exigia que o
 * padrão começasse por `/`, e excluía o `*` sem dar por isso: um URL inventado devolvia o
 * fallback. O teste apanhou-o.)
 */
const RESOLVABLE_ROUTES: TitledRoute[] = Object.entries(PAGE_TITLES)
  .filter(([pattern]) => !(RELATIVE_ROUTE_PATHS as readonly string[]).includes(pattern))
  .map(([path, title]) => ({ path, title }));

/**
 * Resolve o título de um caminho concreto.
 *
 * Usa o `matchRoutes` do próprio React Router em vez de um casador escrito à mão: assim a
 * escolha do padrão mais específico (`/records/reminders` ganha a `/records/:kind`) é a mesma
 * que o router faz para decidir que ecrã mostrar. Uma segunda implementação da mesma regra
 * seria a origem do desvio — o título diria uma página e o ecrã mostraria outra.
 */
export function pageTitleFor(pathname: string): string {
  const matched = matchRoutes(RESOLVABLE_ROUTES, pathname);
  return matched?.[0]?.route.title ?? FALLBACK_TITLE;
}

/** O título do documento, no formato decidido: `<Título da página> · Zemlo`. */
export function documentTitleFor(pathname: string): string {
  return `${pageTitleFor(pathname)} · ${SITE_NAME}`;
}

/**
 * A invariante da tarefa: **que rotas declaradas não têm título**.
 *
 * É uma função pura e exportada de propósito — o teste não compara listas escritas à mão, chama
 * isto com os `path` lidos do routing. Se devolver algo, há uma rota sem título e o teste falha
 * com o nome dela na mensagem.
 */
export function missingPageTitles(declaredPaths: readonly string[]): string[] {
  return declaredPaths.filter((pattern) => !(pattern in PAGE_TITLES));
}
