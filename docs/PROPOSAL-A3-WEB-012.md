# Proposta de A3 a A9 — `WEB-012` · Anunciar a mudança de página (título + foco)

> **SOU O A9.**
>
> **Estado:** `WEB-012` **implementada e provada**. Proposta de fecho — a decisão é de A9.
> **Produção alterada:** 4 ficheiros (2 novos, 2 modificados). **Testes:** 1 ficheiro novo, **14
> testes**.
> **Contratos partilhados:** **não tocados** — `packages/shared` fica exatamente como estava, e
> não era necessário tocar-lhe (ver §1).
> **Dependências novas:** **nenhuma**. A resolução do título usa o `matchRoutes` do React Router
> que já está no projeto.
> **Sem commit, sem push, sem deploy.** `docs/ROADMAP.md` **não foi tocado** — a integração é de A9.

---

## 1. Diagnóstico — medido por leitura, antes de escrever

Os dois defeitos do ROADMAP confirmaram-se no código:

- **A5 — o título nunca muda.** `grep -rn "document.title" apps/web/src/` devolvia **zero**
  ocorrências, e o único sítio que escreve um título é `apps/web/index.html:20`
  (`<title>Zemlo</title>`), estático. O separador do browser dizia «Zemlo» em **todas** as
  rotas — histórico, favoritos e leitura do título por leitor de ecrã não distinguiam
  `/vehicles` de `/settings/security` (WCAG **2.4.2**).
- **A6 — o foco não é gerido.** Não havia qualquer efeito de mudança de rota. Depois de uma
  navegação de cliente o foco caía no `<body>`: quem navega por teclado perdia a posição e quem
  usa leitor de ecrã não ouvia nada (WCAG **2.4.3** e **4.1.3**).

**O que já existia e foi reaproveitado (não reimplementado):**

| Peça | Onde | Uso |
| --- | --- | --- |
| `<main id="conteudo">` | `AppShell.tsx:145` | passou a ser o alvo de foco — já era o destino do link «Saltar para o conteúdo» |
| `matchRoutes` | `react-router-dom` 6.30.6 | resolução do padrão mais específico (§5.1) |
| `renderToStaticMarkup` + `vi.mock` | `test/*.test.tsx` | padrão de teste da casa (sem `jsdom`) |
| guarda estática com anti-vacuidade | `accessibility.test.tsx` A4 | modelo da guarda de cobertura (§6.1) |

**Rotas contadas, não estimadas:** `App.tsx` declara **32** `path` distintos (33 ocorrências — o
`*` aparece duas vezes, no `App` e no `OnboardingRoutes`) mais uma rota `index` sem `path` e a
rota de layout. É esse o «32» do ROADMAP, e é o número que o mapa cobre.

---

## 2. As decisões de política, aplicadas literalmente

O utilizador fixou as três escolhas que bloqueavam a tarefa. Não houve margem de interpretação:

| # | Decisão | Como está no código |
| --- | --- | --- |
| 1 | **Mapa central** `rota → título`, fonte única de verdade, para as 32 rotas | `apps/web/src/app/pageTitles.ts`, `PAGE_TITLES` (§4) |
| 2 | **Foco** para o `<main>`/heading principal, com `tabIndex={-1}`, **sem salto visual** | `useRouteAnnouncement.ts` + `AppShell.tsx` (§5) |
| 3 | Formato **`<Título da página> · Zemlo`** | `documentTitleFor()` — separador `·` (U+00B7), o mesmo que o projeto já usa |
| 4 | **Não duplicar** a definição dos títulos em cada página | nenhuma página foi tocada; o mapa é o único sítio |
| 5 | Testes para as **32 rotas**, que falhem se uma rota nova não tiver título | §6, guarda de cobertura lida do routing |
| 6 | Inspecionar antes de alterar; **sem dependências desnecessárias** | §1; zero dependências novas |
| 7 | Correr `typecheck` e testes relevantes | §7 |
| 8 | Prova por mutação / código morto quando aplicável | §8 — **9 mutações, 9 mortas** |
| 9 | **Sem commit, sem push** | cumprido |
| 10 | **Não alterar outras tarefas** do ROADMAP | nenhuma outra tarefa tocada; achados em §11 |

---

## 3. Ficheiros alterados

| Ficheiro | Alteração | Linhas | `sha256` (16 primeiros) |
| --- | --- | --- | --- |
| `apps/web/src/app/pageTitles.ts` | **novo** — mapa central, resolução, invariante | 143 | `b93cad2467bfc368` |
| `apps/web/src/app/useRouteAnnouncement.ts` | **novo** — efeito de anúncio (título + foco) | 88 | `1a257a36c50d39e9` |
| `apps/web/src/App.tsx` | **modificado** — `+9/−0` — importa e chama o efeito | 234 | `cbf805389e7f2682` |
| `apps/web/src/app/AppShell.tsx` | **modificado** — `+8/−1` — `tabIndex={-1}` no `<main>` | 320 | `47b68495cfba949b` |
| `apps/web/test/page-titles.test.tsx` | **novo** — 14 testes | 300 | `7e872894d2454233` |

`git diff --numstat` (só o meu âmbito):

```
9	0	apps/web/src/App.tsx
8	1	apps/web/src/app/AppShell.tsx
```

**O que deliberadamente não mudei:**

- `apps/web/index.html` — o `<title>Zemlo</title>` estático fica como **valor por omissão** até o
  React montar. É o comportamento certo: antes de haver aplicação não há rota, e um título
  inventado seria pior do que «Zemlo». (Nota: o título correto é escrito logo na **primeira**
  renderização — §5.4 —, pelo que um carregamento direto não fica com «Zemlo».)
- **Nenhuma página.** A política proíbe duplicar títulos por página, e o alvo de foco resolve-se
  por seletor sem tocar em cada ecrã.
- `packages/shared`, `apps/api`, `apps/mobile` — impacto **nenhum**.

---

## 4. O mapa final — as 32 rotas e os seus títulos

A chave é o `path` **tal como está escrito em `App.tsx`**. É o que torna a cobertura verificável
(§6.1): o teste lê os `path=` do routing e exige igualdade com estas chaves.

| # | `path` declarado | Título | Ecrã |
| --- | --- | --- | --- |
| 1 | `/login` | Entrar | `LoginPage` |
| 2 | `/signup` | Criar conta | `SignUpPage` |
| 3 | `/recuperar-password` | Recuperar password | `ForgotPasswordPage` |
| 4 | `/repor-password` | Nova password | `ResetPasswordPage` |
| 5 | `/verificar-email` | Verificar email | `VerifyEmailPage` |
| 6 | `/auth/verify-email` | Verificar email | `VerifyEmailPage` (alias) |
| 7 | `/onboarding/*` | Primeiros passos | `OnboardingRoutes` |
| 8 | `conta` *(relativo)* | Primeiros passos | `OnboardingPage step="account"` |
| 9 | `veiculo` *(relativo)* | Primeiros passos | `OnboardingPage step="vehicle"` |
| 10 | `pronto` *(relativo)* | Primeiros passos | `OnboardingPage step="done"` |
| 11 | `/` | Painel | `DashboardPage` |
| 12 | `/vehicles` | Veículos | `VehiclesPage` |
| 13 | `/vehicles/new` | Adicionar veículo | `NewVehiclePage` |
| 14 | `/vehicles/:vehicleId` | Veículo | `VehicleDetailPage` |
| 15 | `/records/:kind` | Registos | `RecordsPage` |
| 16 | `/records/reminders` | Lembretes | `RemindersPage` |
| 17 | `/documents` | Documentos | `DocumentsPage` |
| 18 | `/documents/:documentId` | Documento | `DocumentDetailPage` |
| 19 | `/stats` | Estatísticas | `StatsPage` |
| 20 | `/timeline` | Histórico | `TimelinePage` |
| 21 | `/calendar` | Calendário | `CalendarPage` |
| 22 | `/notifications` | Notificações | `NotificationsPage` |
| 23 | `/integrations` | Integrações | `IntegrationsPage` |
| 24 | `/integrations/home-assistant` | Home Assistant | `HomeAssistantPage` |
| 25 | `/export` | Exportar dados | `ExportPage` |
| 26 | `/import` | Importar de um ficheiro | `CsvImportPage` |
| 27 | `/settings` | Definições | `SettingsPage` |
| 28 | `/settings/profile` | Perfil | `ProfileSettingsPage` |
| 29 | `/settings/preferences` | Preferências | `PreferencesSettingsPage` |
| 30 | `/settings/security` | Segurança | `SecuritySettingsPage` |
| 31 | `/records/:kind/:recordId` | Registo | `RecordDetailPage` |
| 32 | `*` | Página não encontrada | `NotFoundPage` |

**Os títulos não foram inventados:** são o **vocabulário do produto** — o mesmo que o `<h1>` de
cada ecrã. Onde a página tem um `<h1>` diferente do rótulo de navegação, ganhou o do `<h1>`
(«Adicionar veículo», «Importar de um ficheiro»), porque é o que o utilizador lê no ecrã. Onde o
ecrã não tem título próprio (`/`, o painel), usou-se o rótulo que a navegação e a barra inferior
já usam («Painel»).

**Quatro entradas partilham um título de propósito:** `/onboarding/*` e as três etapas relativas
são um fluxo só, e para o utilizador é uma coisa só. Está declarado em
`RELATIVE_ROUTE_PATHS`, e há um teste que exige que **sejam exatamente essas** as chaves não
resolvíveis (§6.2) — se alguém acrescentar um `path` relativo novo, o teste obriga a decidir.

---

## 5. A estratégia de foco, em concreto

### 5.1 O alvo é o `<main>`, e a escolha do padrão é do router

`useRouteAnnouncement()` corre **uma vez**, no topo do `App` — e não no `AppShell` — porque as
rotas **públicas** (login, recuperação, verificação de email, onboarding) não passam pelo shell e
também são navegações. O efeito depende de `location.pathname`.

O alvo resolve-se por uma cadeia de seletores, do mais específico para o mais genérico:

```
['#conteudo', 'main', '[role="main"]', 'h1']
```

`#conteudo` é o `<main>` do `AppShell`. A cadeia existe porque as páginas públicas não têm
`<main>` — ali o foco cai no `<h1>` do cartão de autenticação, que todas têm. O `<h1>` é a
**rede**, não a primeira escolha: o painel, em estado normal, não tem `<h1>` nenhum (achado §11).

Para resolver o **título**, usa-se o `matchRoutes` do próprio React Router em vez de um casador
escrito à mão. Assim a escolha do padrão mais específico é a mesma que o router faz para decidir
que ecrã mostrar — uma segunda implementação da mesma regra seria a origem do desvio: o título
diria uma página e o ecrã mostraria outra. Há testes a fixar isso (`/records/reminders` ganha a
`/records/:kind`; `/integrations/home-assistant` ganha a `/integrations`).

### 5.2 `tabIndex={-1}`, declarado **e** garantido

No `AppShell` o atributo é **declarado** (`<main … tabIndex={-1}>`), que é o que a decisão de
política pediu. No efeito é também **garantido em tempo de execução** para qualquer alvo que não o
traga — porque um elemento sem `tabindex` aceita `.focus()` **sem erro e sem efeito**: o efeito
correria para nada e o defeito pareceria corrigido. Sendo `-1`, o alvo fica focável por programa e
continua **fora** da ordem de tabulação — não aparece nenhum destino novo a quem navega com `Tab`.

### 5.3 Sem salto visual — e sem apagar o anel de foco

`alvo.focus({ preventScroll: true })` é o que evita o salto: sem `preventScroll`, focar o `<main>`
faz o browser rolar até ele e o utilizador perde a posição de leitura.

**Não** se adicionou `outline: none`. O anel do projeto é `:focus-visible` (`app.css:116`), que um
foco programático normalmente **não** ativa — logo não há anel desnecessário. Removê-lo à força
apagaria também o indicador de quem usou o link «Saltar para o conteúdo», que é precisamente o
utilizador que mais precisa dele. `tabIndex={-1}` melhora esse link de caminho: o destino passa a
receber mesmo o foco, e não só o scroll.

### 5.4 A primeira renderização não rouba o foco — mas escreve o título

Abrir um link direto para `/stats` não é uma navegação: o browser já pôs o foco no topo, e movê-lo
para o `main` só deslocaria quem estava a ler. O **título**, esse, é escrito logo na primeira
renderização — senão um carregamento direto ficaria com o título do `index.html`.

---

## 6. Testes — 14, em três grupos

`apps/web/test/page-titles.test.tsx` — **14 testes, 0 falhados**.

### 6.1 A cobertura das 32 rotas (o teste que a tarefa pede)

Os `path` são lidos **do código-fonte** de `App.tsx` (`matchAll(/path="([^"]+)"/g)`), não de uma
lista escrita à mão. É isso que dá sentido ao teste: uma lista à mão teria de ser atualizada por
quem acrescenta a rota — exatamente a pessoa que se esquece do título.

| Teste | O que fixa |
| --- | --- |
| a extração encontra as 32 rotas | **anti-vacuidade** — exige 33 ocorrências / **32 distintas**; se a expressão deixasse de casar, o teste seguinte passaria com zero rotas |
| nenhuma rota declarada fica sem título | **a asserção central** — `missingPageTitles()` tem de devolver `[]` |
| o mapa não tem títulos a mais | a recíproca: uma chave sem rota é um título morto |
| a invariante morde numa rota sem título | prova que `missingPageTitles` **deteta** — uma função que devolvesse sempre `[]` passaria nos dois anteriores |
| as únicas chaves não resolvíveis são as três etapas do onboarding | obriga a declarar a exceção em vez de a deixar implícita |

### 6.2 A resolução e o formato

| Teste | O que fixa |
| --- | --- |
| cada URL concreto devolve o título do seu padrão | 29 URLs concretos (um por padrão resolvível, com `v1`/`d1` nos parâmetros) |
| **o sufixo é literalmente «Zemlo»** | ver §8 — nasceu de uma mutação sobrevivente |
| a resolução é discriminante | **anti-vacuidade** — exige ≥25 títulos distintos; um `matchRoutes` que deixasse de casar devolveria o fallback para tudo e passaria no teste anterior |
| o padrão mais específico ganha ao genérico | `/records/reminders` vs `/records/:kind`; `/integrations/home-assistant` vs `/integrations` |
| as etapas do onboarding resolvem pelo título do fluxo | `/onboarding/conta` → «Primeiros passos» |
| um URL desconhecido tem título | o `*` — não um documento sem nome |

### 6.3 O alvo de foco

| Teste | O que fixa |
| --- | --- |
| o `<main>` tem o `id` do alvo e `tabindex="-1"` | renderizado com `renderToStaticMarkup` |
| o alvo preferido é o `#conteudo`, e não um `h1` | a ordem dos seletores |
| o efeito está ligado no `App` | **guarda estática** — ancorada ao início da linha (§8, M5) |

---

## 7. Typecheck e suite

| Comando | Resultado |
| --- | --- |
| `tsc --noEmit -p apps/web/tsconfig.json` | **exit 0** |
| `PC-15` — `tsconfig` restrito fora do repo (`src` **e** `test`) | **exit 0**, **90 ficheiros** de `apps/web` (eram 86: +3 de produção, +1 de teste) |
| suite web **scopeada** (`--no-cache --no-file-parallelism`) | **13 ficheiros, 260/260, exit 0** |

O `PC-15` **provou morder outra vez**: injetei `const __probe: number = pageTitleFor("/")` no teste
novo e o `tsc` reportou `page-titles.test.tsx(52,7): error TS2322`, **exit 2**; reposto da cópia
imutável e conferido por `sha256` (`7e872894…`) e `exit 0` de volta. O `typecheck` da app **não
veria** este erro: `apps/web/test/` está fora do `include`.

---

## 8. Prova por mutação — 9 mutações, 9 mortas, 0 sobreviventes

Harness em `.workbuddy-ai/scratch/web012-mutacao.cjs` (mutador) + `web012-run.sh` (driver), com
cópia **imutável** de cada ficheiro, `sha256` **fixo**, guarda de arranque e reposição no arranque
de cada `apply`. A generalização em relação a `WEB-004` é que aqui há **cinco** ficheiros sob
prova (quatro de produção e um de teste), e cada mutação declara o seu.

| # | Mutação | Ficheiro | Vermelhos | O que prova |
| --- | --- | --- | --- | --- |
| M1 | a entrada `/stats` desaparece do mapa | `pageTitles` | **3/14** | a cobertura apanha uma rota sem título |
| M2 | o separador passa de `·` para `—` | `pageTitles` | **4/14** | o formato está fixado |
| M3 | o alvo de foco passa a ser o `h1` | `useRouteAnnouncement` | **1/14** | a ordem dos seletores importa |
| M4 | o `<main>` perde o `tabIndex={-1}` | `AppShell` | **1/14** | um alvo não focável é apanhado |
| M5 | a chamada ao efeito fica **comentada** | `App` | **1/14** | a guarda estática está ancorada à linha |
| M6 | o filtro de resolução volta a excluir o `*` | `pageTitles` | **4/14** | o defeito real da 1.ª versão é apanhado |
| M7 | `SITE_NAME` passa a `'ZemloApp'` | `pageTitles` | **1/14** | o sufixo está fixado por valor |
| M8 | **é acrescentada uma rota ao routing sem título** | `App` | **2/14** | **o defeito que a tarefa quer apanhar** |
| M9 | a extração de `path=` deixa de casar | `page-titles.test` | **2/14** | a guarda anti-vacuidade morde |

**M8 é o critério da tarefa, provado:** acrescentar `<Route path="/rota-nova-sem-titulo" …/>` ao
`App.tsx` **sem** entrada no mapa põe a suite vermelha. Ninguém tem de se lembrar de o pedir.

### Três defeitos meus que a prova apanhou, e que ficam ditos

**(a) M7 sobreviveu na 1.ª ronda — e era um falso verde a sério.** A asserção de resolução
comparava com o `SITE_NAME` **importado**: mudar a constante mudava os dois lados da igualdade e o
teste continuava verde. Passava sem verificar nada sobre o valor. Corrigido com uma asserção
**literal** (`documentTitleFor('/')` tem de ser exatamente `'Painel · Zemlo'`), e a 2.ª ronda mata
a M7. Um teste que se compara consigo próprio não fixa coisa nenhuma.

**(b) O filtro da tabela de resolução excluía o `*` sem dar por isso.** A 1.ª versão filtrava por
`pattern.startsWith('/')`, o que deixava o `*` de fora — e um URL inventado devolvia o fallback em
vez de «Página não encontrada». O teste apanhou-o **antes** da prova de mutação, e a M6 fixa o
defeito para sempre. A correção passou a ser uma **exceção declarada** (`RELATIVE_ROUTE_PATHS`) em
vez de um filtro implícito.

**(c) A guarda estática do `App` era fraca.** A 1.ª versão usava `toContain('useRouteAnnouncement()')`
— que passa com a chamada **comentada** (`// useRouteAnnouncement();`), precisamente a forma como
uma ligação é desligada sem apagar código. Endurecida para `/^\s*useRouteAnnouncement\(\);/m`.
A M5 é essa mutação, e mata.

---

## 9. Critérios comprovados

| Critério (WCAG / tarefa) | Como está comprovado |
| --- | --- |
| **2.4.2** — «Página com título» | 32 rotas com título próprio, resolvido por um mapa central; o sufixo é fixado **por valor** (§6.2); a cobertura é verificada contra o routing, não contra uma lista (§6.1) |
| **2.4.3** — «Ordem de foco» | o foco passa para o conteúdo principal em cada navegação, para um alvo `tabIndex={-1}`; o alvo e a sua focabilidade são afirmados no HTML (§6.3) |
| **4.1.3** — «Mensagens de estado» | a mudança de página passa a ter um anúncio: o título do documento muda e o foco entra no conteúdo, que é o que um leitor de ecrã lê a seguir |
| «sem salto visual» | `focus({ preventScroll: true })`; o anel de `:focus-visible` não é disparado por foco programático, e **não** se apagou (§5.3) |
| «não duplicar os títulos por página» | nenhuma página foi tocada; `PAGE_TITLES` é o único sítio |
| «teste que falha se uma rota nova não tiver título» | §6.1 e **M8** |

---

## 10. Limitações de validação — declaradas, não disfarçadas

1. **A movimentação do foco não é observável na suite de testes.** Não há `jsdom` nem
   `@testing-library` (regra da casa, escrita em `page-states.test.tsx`), pelo que **na suite** não
   há como afirmar `document.activeElement` depois de uma navegação: o que ali está provado é que o
   alvo **existe**, tem `tabindex="-1"` e o efeito **está ligado**.
   **`docs/VALIDACAO-A3-WEB-012.md` fecha esta lacuna por fora**: num browser real (Chromium, com a
   aplicação servida pelo `vite` do próprio projeto e só a camada HTTP falsificada), o
   `document.activeElement` passa a ser `MAIN#conteudo` numa rota autenticada e o `h1` (com
   `tabindex="-1"` posto em execução) numa rota pública, com o título a mudar e o scroll preservado.
   O que continua por verificar está declarado lá — nomeadamente que a causalidade do
   `preventScroll` só se demonstra na rota pública.
2. **`preventScroll` e o anel de foco também não são observáveis** aqui — são atributos da chamada,
   não estado verificável sem DOM.
3. **Os títulos de rota dinâmica são genéricos.** `/records/:kind` diz «Registos» mesmo quando o
   ecrã diz «Despesas» ou «Seguros»; `/vehicles/:vehicleId` diz «Veículo». Especializá-los exigiria
   uma segunda fonte de verdade (o mapa por um lado, a config do ecrã por outro), que é exatamente
   o que a política proíbe. É uma consequência **aceite** da decisão 1, não um defeito.
4. **Mudanças de *query string* não mudam o título.** `/vehicles/v1?tab=stats` continua «Veículo».
   É deliberado (um separador não é uma página nova), mas fica dito.
5. **As páginas públicas não têm `<main>`.** O foco cai no `<h1>` e o `tabindex` é-lhe posto em
   tempo de execução. Funciona, mas a estrutura correta seria um `<main>` também ali — é trabalho
   estrutural, fora do âmbito desta tarefa (§11).
6. **As três etapas relativas do onboarding** são chaves do mapa que não são resolvíveis a partir
   de um URL; a cobertura delas é feita por `/onboarding/*`. Está declarado em código e guardado
   por teste.

---

## 11. Achados novos — **registados, não implementados**

Nenhum destes foi corrigido: são de outras frentes ou de decisão de produto. Ficam para A9.

1. **O painel não tem `<h1>` no estado normal.** `DashboardPage` monta `<Section title=…>`
   (`h2`) e o único `<h1>` existe no **estado vazio** («Vamos começar pelo teu veículo»). Uma
   página sem cabeçalho de topo é uma observação de **1.3.1/2.4.6** — e é a razão pela qual o
   fallback do foco é o `h1`: nessa página não há nenhum. Não corrigido (é o ecrã de outra
   frente e mexe em hierarquia visual).
2. **Duas importações na mesma linha em `App.tsx:7`**
   (`…from './ui/primitives';import { LoginPage } from './pages/auth/LoginPage';`). Defeito de
   formatação — provavelmente uma escrita perdida. Não corrigido: está fora do âmbito de
   `WEB-012` e não tem efeito de comportamento.
3. **O `*` está declarado duas vezes** (`App.tsx` e `OnboardingRoutes`), o que faz a contagem de
   *ocorrências* de `path=` ser 33 e a de *distintos* 32. É inofensivo e está fixado em teste; fica
   dito para quem contar rotas por `grep -c`.
4. **As páginas de autenticação repetem a estrutura `.z-auth > .z-auth__card > .z-auth__head`**
   em cinco ficheiros. Um `AuthLayout` partilhado reduziria a duplicação e daria um `<main>` às
   rotas públicas (limitação §10.5). Trabalho estrutural novo, não defeito.
5. **`index.html` não tem `lang` em falta nem título errado** — verificado: `lang="pt-PT"` e
   `<title>Zemlo</title>`. Não é achado; fica registado por ter sido verificado.

---

## 12. Resíduos

| Ficheiro | Onde | Ação |
| --- | --- | --- |
| `web012-mutacao.cjs`, `web012-run.sh`, `web012-state.json` | `.workbuddy-ai/scratch/` | harness — **fora do repo** |
| `web012-pristine/` (5 cópias imutáveis) | `.workbuddy-ai/scratch/` | reposição |
| `web012-mutacoes.log` | `.workbuddy-ai/scratch/` | a prova, **limpa** (0 ruído de shell) |
| relatórios JSON do vitest | `.workbuddy-ai/scratch/` | temporários de medição |

Os cinco ficheiros sob prova foram repostos da cópia imutável e conferidos por `sha256`
(`reposição confirmada: titles=b93cad24 focus=1a257a36 shell=47b68495 app=cbf80538 test=7e872894`).
Nada disto entra no repositório: `.workbuddy-ai/` está fora da árvore versionada.
