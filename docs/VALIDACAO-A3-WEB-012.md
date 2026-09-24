# Validação no browser — `WEB-012` (título + foco na mudança de página)

> **SOU O A9.**
>
> **Objetivo:** comprovar, num **browser real**, o comportamento que a suite de testes **não**
> consegue observar — `document.activeElement` depois de uma navegação de cliente, `document.title`
> e o efeito do foco no scroll.
> **Resultado:** **os 7 pontos pedidos estão comprovados**, com uma ressalva declarada sobre o
> alcance da prova de scroll (§5).
> **Sem commit, sem push, sem deploy.** `docs/ROADMAP.md` **não tocado** (sha `60965b57…`).
> Nenhuma dependência acrescentada ao projeto (§2).

---

## 1. Método — a aplicação real, só a camada HTTP falsificada

O que corre no browser é o **código entregue**: `App`, `AppShell`, `useRouteAnnouncement`,
`pageTitles`, o `React Router` e o CSS real. **Não há duplo nenhum** do que está a ser validado.

1. Serviu-se a aplicação com o **`vite` dev server** do próprio projeto
   (`node node_modules/vite/bin/vite.js`, `apps/web`) — o mesmo servidor do desenvolvimento.
2. Falsificou-se **apenas a camada HTTP**: `page.route('**/api/v1/**')` responde a `/me`,
   `/vehicles` e `/notifications` com formas plausíveis. A API não está a correr nesta máquina
   (`127.0.0.1:4000` sem nada a escutar), e subir a API exigiria uma base de dados e uma conta.
3. O token de acesso é posto em `sessionStorage['zemlo.accessToken']` **antes de a aplicação
   arrancar**, para que `hasCredentials` seja verdadeiro e as rotas autenticadas rendam.
4. O caso público corre num **contexto de browser novo**, sem token nenhum — a ausência de sessão
   é limpa por construção, não por ordem de execução de scripts.
5. Navega-se **com o teclado** (`focus()` no link, depois `Enter`). Foi deliberado: o `click()` do
   Playwright faz *scroll-into-view* do elemento antes de clicar, e esse scroll — do harness —
   aparecia na medição como se fosse efeito do foco. **Aconteceu na 1.ª tentativa** (§6).

### Viewport

`900 × 320` px. Altura **baixa de propósito**: garante que as páginas são **roláveis**, senão o
teste do scroll seria vácuo (numa página que cabe no ecrã, `scrollY` é 0 antes e depois e não prova
nada).

---

## 2. Nenhuma dependência acrescentada

O Playwright usado vem do plugin **instalado fora do repositório**
(`~/.workbuddy-ai/plugins/cache/codebuddy-plugins-official/playwright-cli/0.1.0/node_modules/playwright`).
`apps/web/package.json` e a raiz **não foram tocados** — não entra `playwright`, `puppeteer` nem
`jsdom` no projeto.

**Uma armadilha de ambiente, resolvida sem descarregar nada:** o cliente do Playwright do plugin
espera o build `chromium_headless_shell-1210`, que **não está instalado** nesta máquina (há `1223` e
`1234`). Apontei `executablePath` para o build que existe — evita um download de ~150 MB e não
altera nada no repositório.

---

## 3. Os 7 pontos pedidos, com o resultado medido

### A · Rota autenticada — `/vehicles` → `/documents`

Passos: abrir `/vehicles` → focar o link «Documentos» da barra lateral → rolar → **Enter**.

| # | Ponto | Medido |
| --- | --- | --- |
| 1 | abrir uma rota autenticada | `/vehicles` rendeu (`h1` = «Veículos»), 0 erros de página |
| 2 | foco num elemento navegável | `activeElement` = `<a>` «📄Documentos» |
| 3 | navegar pela UI | Enter no link focado → `/documents` |
| 4 | **`#conteudo` recebe `document.activeElement`** | **`activeElement` = `MAIN#conteudo`** ✅ |
| 5 | sem scroll indesejado | `scrollY` **27 → 27** (delta **0**); página rolável (doc 683 > viewport 320) |
| 6 | **`document.title` no formato** | `Veículos · Zemlo` → **`Documentos · Zemlo`** ✅ |

### A2 · Segunda navegação, numa página alta — `/documents` → `/notifications`

Rolado a ~300 px antes de navegar, para o scroll ter amplitude:

| # | Ponto | Medido |
| --- | --- | --- |
| 4 | foco no conteúdo | **`activeElement` = `MAIN#conteudo`** ✅ |
| 5 | scroll | `scrollY` **300 → 247** (delta **−53**) |
| 6 | título | `Documentos · Zemlo` → **`Notificações · Zemlo`** ✅ |

O delta de **−53 px é um *clamp*, não um salto**: a página de destino (`/notifications`, 567 px) tem
menos amplitude de scroll do que a de origem, e o browser limitou a posição ao máximo permitido.
**Não** houve regresso ao topo (que seria ≈ −247).

### B · Rota pública — `/login` → `/signup`

| # | Ponto | Medido |
| --- | --- | --- |
| 1 | rota pública | `/login` rendeu (`h1` = «Bem-vindo de volta») |
| 2 | foco num elemento navegável | `activeElement` = `<a>` «Criar conta» |
| 3 | navegar pela UI | Enter no link focado → `/signup` |
| 4 | foco no conteúdo principal | **`activeElement` = `H1`** «Criar conta» ✅ |
| 5 | sem scroll indesejado | `scrollY` **300 → 300** (delta **0**) |
| 6 | título | `Entrar · Zemlo` → **`Criar conta · Zemlo`** ✅ |
| — | alvo é **focável** | `tabindex` do `h1` = **`-1`** ✅ (posto em execução pelo efeito) |

Nas rotas públicas **não existe `<main>`** — o alvo é o `<h1>`, que é a rede da cadeia de seletores.
Que ele receba `tabindex="-1"` **em tempo de execução** é o que prova que a garantia do efeito
funciona: sem ela, `.focus()` correria sem erro e **sem efeito**.

**Ponto 7 (repetir numa autenticada e numa pública): cumprido** — casos A/A2 e B.

---

## 4. Evidência visual

Três capturas do browser real, guardadas em `.workbuddy-ai/scratch/`:

- `web012-browser-autenticada.png` — `/documents` depois da navegação;
- `web012-browser-autenticada2.png` — `/notifications` com «Notificações» ativo na barra lateral;
- `web012-browser-publica.png` — `/signup`, com o botão «Criar conta».

As capturas mostram o **shell e as páginas reais** (barra lateral, conteúdo, tipografia), não um
duplo.

---

## 5. A prova causal do `preventScroll` — e o alcance exato dela

Dizer «o scroll não saltou» não prova **porquê**. Para transformar a observação em prova causal,
corri a validação **duas vezes**: com o código entregue e com a mutação **M10**
(`alvo.focus({ preventScroll: true })` → `alvo.focus()`).

| Caso | Com `preventScroll` (entregue) | Sem `preventScroll` (M10) |
| --- | --- | --- |
| A · `/vehicles` → `/documents` (alvo: `main`) | 27 → 27 · **delta 0** | 27 → 27 · delta 0 |
| A2 · `/documents` → `/notifications` (alvo: `main`) | 300 → 247 · delta −53 (clamp) | 300 → 247 · delta −53 (clamp) |
| **B · `/login` → `/signup` (alvo: `h1`)** | **300 → 300 · delta 0** | **300 → 37 · delta −263** |

**Leitura honesta desta tabela — e é uma ressalva, não um detalhe:**

- Na rota **pública** a prova é **causal e inequívoca**: sem `preventScroll` o browser rola **263 px**
  para trazer o `h1` focado à vista; com ele, o scroll **não se move**. É o `preventScroll` que
  preserva a posição de leitura.
- Na rota **autenticada** o alvo é o `<main>`, que é **mais alto do que o viewport** e portanto está
  **sempre (parcialmente) à vista** — focá-lo nunca exige rolar. Logo, aí, o delta 0 **não
  distingue** «o `preventScroll` funcionou» de «não havia nada a rolar». **O ponto 5 está cumprido
  nessa rota** (a navegação não provoca scroll), mas **a causalidade não se demonstra ali** — só na
  pública. Fica dito em vez de ser apresentado como prova mais forte do que é.

**E a mutação M10 é precisamente aquilo que a suite não pode apanhar:** corrida contra
`page-titles.test.tsx`, dá **14 testes, 0 falhados** — sobrevive. A validação no browser **mata-a**.
É a demonstração de que esta fase cobre uma lacuna real dos testes, e não que os repete.

---

## 6. Um falso defeito que o harness produziu — e como foi apanhado

Na **primeira** execução, a navegação autenticada deu `activeElement = BODY` — ou seja, «o foco não
se move», que seria um **defeito de produto**. Não era.

A causa: o alvo escolhido era `/stats`, e o stub HTTP devolvia `{ items: [], total: 0 }` para
todos os endpoints desconhecidos. A página de estatísticas **crashou** com essa forma; o React
desmontou a árvore; o `<main id="conteudo">` **deixou de existir**; e o efeito, corretamente, não
teve onde pôr o foco.

Discriminadores que o mostraram, e que ficaram no harness:

1. a **captura de ecrã** estava em branco;
2. `alturaDocumento` caiu para exatamente a altura do viewport e `h1` ficou `null`;
3. passei a registar `pageerror`/`console.error` e a verificar explicitamente se o `<main>`
   **continua a existir** depois de navegar — sem isso, uma página morta é indistinguível de um
   foco que não se move.

Com o alvo trocado para `/documents` (que rende com o stub genérico) e com a verificação de
vitalidade, o resultado passou a ser o de §3. **Reporta-se o medido, não a primeira leitura.**

---

## 7. Limitações desta validação — declaradas

1. **A camada HTTP é falsificada.** A aplicação real corre, mas com respostas fixas. Isto **não**
   afeta o que se está a medir — `document.title` e `document.activeElement` não dependem do
   conteúdo das respostas —, mas significa que **o fluxo de autenticação real não foi exercido**
   (não se fez login; o token foi posto em `sessionStorage`). Subir a API com base de dados e uma
   conta daria uma prova mais completa; não foi feito nesta ronda, e o âmbito do pedido não o exigia.
2. **Navegação por teclado, não por rato.** Navegou-se com `Enter` no link focado (§1.5) — que é
   precisamente o cenário que a WCAG 2.4.3 protege. O `click()` foi usado numa primeira passagem e
   abandonado por contaminar a medição do scroll.
3. **Um só browser.** Chromium (headless shell `1234`). Não se repetiu em Firefox/WebKit; o
   `:focus-visible` e o comportamento de `preventScroll` são específicos de cada motor.
4. **A causalidade do `preventScroll` só está provada na rota pública** (§5), pela razão ali dita.
5. **Sem leitor de ecrã real.** O anúncio a tecnologias assistivas (4.1.3) é inferido do título e do
   foco — que é o que a norma pede —, não ouvido num NVDA/Narrator.
6. **A rota `/stats` continua por validar** neste harness, porque o stub genérico a faz crashar. Não
   é defeito do produto: é uma limitação do stub (§6).

---

## 8. Resíduos

| Ficheiro | Onde | Ação |
| --- | --- | --- |
| `web012-browser.cjs` | `.workbuddy-ai/scratch/` | harness de validação — **fora do repo** |
| `browser-baseline.json`, `browser-m10.json`, `browser-pos-restauro.json` | `.workbuddy-ai/scratch/` | as três medições |
| `web012-browser-*.png` (3) | `.workbuddy-ai/scratch/` | capturas do browser real |
| `web012-mutacao.cjs` | `.workbuddy-ai/scratch/` | mutador (M10 vive aqui) |

O `vite` dev server foi parado no fim. Os cinco ficheiros de produção e teste foram repostos da
cópia imutável e conferidos por `sha256`
(`titles=b93cad24 focus=1a257a36 shell=47b68495 app=cbf80538 test=7e872894`), e o comportamento
pós-restauro foi **re-medido** (caso B volta a delta 0). Nada disto entra no repositório.
