# Proposta de A3 a A9 — `WEB-011` · contraste abaixo de WCAG AA

> **SOU O A9.**
>
> **Estado:** `WEB-011` **implementada e provada**. Proposta de fecho de `WEB-011` e de `PC-24`,
> mais **dois achados novos** propostos (`PC-46`, `PC-47`) — **não** tratados.
> **Produção alterada:** 4 ficheiros — `theme.css` (+51/−1), `app.css` (+32/−32),
> `brand.ts` (+29/−0), `AppShell.tsx` (**1 linha minha**; o resto do diff é de outra frente).
> **Teste novo:** `apps/web/test/contraste-tokens.test.ts` (407 linhas, **58 testes**).
> **Sem commit, sem push, sem deploy.** `docs/ROADMAP.md` **não foi tocado** — a integração é
> de A9.

---

## 1. Estado antes: o que estava errado, e como foi medido

### 1.0 O gate de coordenação com `WEB-008` — verificado antes de escrever

O pedido foi explícito: `WEB-011` depende de `WEB-008` e **não pode haver trabalho simultâneo**
nas duas. Medido antes de tocar em nada:

| Verificação | Resultado |
| --- | --- |
| Estado de `WEB-008` no ROADMAP | `BACKLOG` (`:312`), **sem** proposta de agente |
| `theme.css` — última modificação | **2026-09-16** (intocado até eu escrever) |
| `app.css` — última modificação | **2026-09-19** (intocado até eu escrever) |
| Atividade web recente (11:07–11:51) | outro agente, em **outros** ficheiros (`WEB-006`/`WEB-012`) |
| `docs/ROADMAP.md` | sha256 `9bec4e5f…`, mtime `2026-09-22 22:22:32` — **intocado** |

`WEB-008` **livre** → avancei. Não houve, em momento nenhum, dois escritores nos mesmos ficheiros.

### 1.1 O método: um auditor independente, validado contra os números publicados

Antes de corrigir, construí um auditor **independente** (não importa nada do repositório: lê o
`theme.css` e aplica a fórmula da WCAG). Um instrumento novo que só concorda consigo próprio não
prova nada, pelo que o **validei contra os números que o `PC-24` já publicava**:

| Par publicado no `PC-24` | Valor no `PC-24` | Valor medido por mim | Coincide? |
| --- | --- | --- | --- |
| `--z-text` (#2a3231) sobre cartão | 13,13:1 | **13,13:1** | sim |
| Rótulo do botão primário (#fff sobre #178186) | 4,65:1 | **4,65:1** | sim |
| `.z-chip--warn` (âmbar-900 sobre âmbar-100) | 9,87:1 | **9,87:1** | sim |
| `--z-muted` no escuro (#9aa8a7 sobre #1f2727) | 6,19:1 | **6,19:1** | sim |
| `--z-text-muted` sobre afundado | 3,82:1 | **3,82:1** | sim |

O auditor reproduziu **todos** os valores publicados. Só depois disso é que os seus números
passaram a valer como prova.

> **Um defeito meu, encontrado porque o resultado era absurdo.** A primeira versão do auditor
> ordenava as duas luminâncias de forma **ascendente** e dividia, o que dá o **recíproco** da
> razão: `--z-text` sobre branco saiu `0,08:1`. Um contraste abaixo de 1 é impossível, e foi isso
> que o denunciou. Corrigido para ordenar **descendente** (`(maior + 0,05) / (menor + 0,05)`), com
> a razão da falha escrita no código. Sem esta correção, **todas** as medições estariam invertidas
> e a tabela seguinte seria o oposto da verdade.

### 1.2 A enumeração do `PC-24` estava incompleta — e isso é um achado (`PC-46`)

O `PC-24` listava **6 pares** abaixo do limiar. Medido, havia **muito mais**. O pior par do
produto nem constava:

| Par **não** listado no `PC-24` | Tema | Antes | Limiar |
| --- | --- | --- | --- |
| `.z-banner--info` — `--z-petrol-800` sobre `--z-info-soft` | **escuro** | **1,18:1** | 4,5:1 |
| `＋` da barra inferior — `#fff` sobre `--z-highlight` | **escuro** | **1,88:1** | 4,5:1 |
| `.z-tabbar__badge` — `#fff` sobre `--z-highlight` | **escuro** | **1,88:1** | 4,5:1 |
| `.z-toast--ok` — `#fff` sobre `--z-ok` | **escuro** | **2,35:1** | 4,5:1 |
| `.z-toast--danger` — `#fff` sobre `--z-danger` | **escuro** | **2,47:1** | 4,5:1 |
| `.z-toast--ok` — `#fff` sobre `--z-ok` | claro | **4,33:1** | 4,5:1 |
| `.z-field__required` — âmbar-600 sobre cartão | claro | **3,60:1** | 4,5:1 |
| `.z-btn--highlight:hover` — `#fff` sobre âmbar-600 | claro | **3,60:1** | 4,5:1 |

O `PC-24` dizia «só uma falha» no tema escuro. Havia **seis**. A causa é o método: uma lista
escrita à mão a partir de uma leitura de olho fica sempre incompleta — foi por isso que a correção
não podia ser «remendar os 6 pares», e sim **tornar a medição automática** (§4). O achado vai
proposto como `PC-46` (§9.1).

### 1.3 As tintas novas: escolhidas por medição, não a olho

Para `ok` e `danger` era preciso um tom mais escuro que o da marca. Não o escolhi por gosto:
corri uma **descida** sobre o espaço de cor à procura do tom **mais próximo do original** que
passasse em **todos** os fundos em que é usado.

| | mais próximo que passa | razão mínima | margem | escolhido | razão mínima final |
| --- | --- | --- | --- | --- | --- |
| `ok` | `#1c7d52` | **4,503:1** | 0,003 | **`#1b784f`** | **4,81:1** |
| `danger` | `#bd3f0b` | 4,512:1 | 0,012 | **`#ba3e0c`** | **4,75:1** |

O tom mais próximo possível assenta **exatamente** no limiar (4,503:1). Um teste que afirma
`>= 4,5` sobre esse valor falharia por arredondamento no dia em que a fórmula fosse escrita de
outra maneira igualmente correta. Escolhi por isso o primeiro tom que dá **margem real**
(≥ 4,75:1) — e é isso que está documentado no `docblock` de `STATE_INK`, para que a escolha não
pareça arbitrária a quem a ler depois.

---

## 2. Ficheiros alterados

| Ficheiro | Alteração | sha256 final |
| --- | --- | --- |
| `packages/shared/src/brand.ts` | **+29/−0** — `STATE_INK` e a sua emissão em `brandCssVariables()` | `0357c556df6f50eb62daeda574fc060930ff96f77dd448b1dde37d8c7ca3f5a7` |
| `apps/web/src/styles/theme.css` | **+51/−1** — tokens novos e repontados | `d36c054d27bba0d7f43da56c4069f33e500622f01154116d22a7512c0f5d75b1` |
| `apps/web/src/styles/app.css` | **+32/−32** — 31 repontagens, 26 hunks, 2625 linhas antes e depois | `da8ce0cd8c36106f1d2e90334ee93044f51fd3028f1f8979c8ef330e26659acb` |
| `apps/web/src/app/AppShell.tsx` | **1 linha minha** — o `＋` da barra inferior (`:262`) | `676cef3549b753e4996743a45884d84258e9ef88661ad2db0f03825f3a284823` |
| `apps/web/test/contraste-tokens.test.ts` | **novo** — 407 linhas, **58 testes** | `1bf39ae5d78ac03920f42bed85873a2ebcb76202eec93f40f672d2520b58b743` |

### 2.1 Aviso sobre o diff de `AppShell.tsx` contra `HEAD` — mistura frentes

`git diff HEAD -- apps/web/src/app/AppShell.tsx` mostra **+15/−1**. **Só 1 linha é minha**:

```diff
-              color: '#fff',
+              color: 'var(--z-highlight-contrast)',
```

As outras **14 linhas** são de **outra frente** (o `sr-only` da contagem por ler da barra
inferior, de `WEB-006`), e **já lá estavam** quando li o ficheiro pela primeira vez. Verificação:

```
git diff -U0 -- apps/web/src/app/AppShell.tsx | grep -E "^[+-]" | grep -v "^[+-][+-][+-]"
-              color: '#fff',
+              color: 'var(--z-highlight-contrast)',
+      {/* … comentário de WEB-006 … */}
+      {badge && badge > 0 ? (
+        <span className="z-sr-only">{`${formatNumber(badge, 0)} por ler`}</span>
+      ) : null}
```

Em `theme.css`, `app.css` e `brand.ts` o diff contra `HEAD` é **integralmente meu**.

---

## 3. Comportamento corrigido — antes/depois e rácios medidos

Todos os valores abaixo foram **medidos** pela fórmula da WCAG sobre o `theme.css` real, com as
cadeias `var()` resolvidas e a cascata real do tema escuro (que redefine os **papéis** e herda as
**escalas** do claro).

### 3.1 Tema claro

| Par | Onde | Antes | Depois | Limiar | Veredicto |
| --- | --- | --- | --- | --- | --- |
| `--z-text-muted` sobre cartão | **36 declarações** | `#6f7d7c` = **4,29:1** | `#55605f` = **6,51:1** | 4,5 | Falha → OK |
| `--z-text-muted` sobre o fundo | idem | **4,08:1** | **6,20:1** | 4,5 | Falha → OK |
| `--z-text-muted` sobre afundado | idem | **3,82:1** | **5,81:1** | 4,5 | Falha → OK |
| `.z-chip--accent` | `app.css:1062` | `#178186` = **3,66:1** | `#126a70` = **4,98:1** | 4,5 | Falha → OK |
| `.z-chip--ok` / `.z-banner--ok` | `:1077`, `:956` — 18 usos | `#1f8a5b` = **3,82:1** | `#1b784f` = **4,81:1** | 4,5 | Falha → OK |
| `.z-chip--danger` / `.z-banner--danger` | `:1072`, `:966` — 4 usos | `#c2410c` = **4,43:1** | `#ba3e0c` = **4,75:1** | 4,5 | Falha → OK |
| `＋` da barra inferior | `AppShell.tsx:262` | `#fff` = **2,43:1** | `#4d340a` = **4,77:1** | 4,5 | Falha → OK |
| `.z-tabbar__badge` | `app.css:367` | `#fff` = **2,43:1** | `#4d340a` = **4,77:1** | 4,5 | Falha → OK |
| `.z-btn--highlight` | `:634` (código morto) | `#fff` = **2,43:1** | `#4d340a` = **4,77:1** | 4,5 | Falha → OK |
| `.z-btn--highlight:hover` | `:639` | `#fff` = **3,60:1** | **6,18:1** | 4,5 | Falha → OK |
| `.z-field__required` | `:745` | âmbar-600 = **3,60:1** | `#4d340a` = **11,59:1** | 4,5 | Falha → OK |
| `.z-toast--ok` | `:1435` | `#fff` sobre `--z-ok` = **4,33:1** | `#fff` sobre `#1b784f` = **5,46:1** | 4,5 | Falha → OK |
| `.z-banner--info` | `:951` | `#0b4046` = **10,35:1** | **10,35:1** | 4,5 | OK → OK |
| Anel de foco | — | `#178186` = 4,65:1 | 4,65:1 | 3 | OK → OK |
| Barra do cartão `ok` | `:1001` | `#1f8a5b` sobre cartão = 4,33:1 | 4,33:1 | 3 | OK → OK |

### 3.2 Tema escuro

| Par | Antes | Depois | Limiar | Veredicto |
| --- | --- | --- | --- | --- |
| `.z-banner--info` — `--z-petrol-800` sobre `--z-info-soft` | **1,18:1** | `#9ed6d3` = **8,36:1** | 4,5 | **Falha grave → OK** |
| `＋` da barra inferior | `#fff` = **1,88:1** | `#4d340a` = **6,18:1** | 4,5 | Falha → OK |
| `.z-tabbar__badge` | `#fff` = **1,88:1** | `#4d340a` = **6,18:1** | 4,5 | Falha → OK |
| `.z-toast--ok` | `#fff` sobre `--z-ok` = **2,35:1** | `#06232a` sobre `#4bbd8a` = **6,98:1** | 4,5 | Falha → OK |
| `.z-toast--danger` | `#fff` sobre `--z-danger` = **2,47:1** | `#3c1f14` sobre `#ef8a63` = **6,07:1** | 4,5 | Falha → OK |
| `.z-chip--accent` — `#3a9d9e` sobre `--z-accent-soft` | **3,81:1** | `#66bcba` = **5,55:1** | 4,5 | Falha → OK |
| `.z-chip--ok` / `.z-banner--ok` | 5,71:1 (já passava) | **5,71:1** | 4,5 | OK → OK |
| `.z-chip--danger` / `.z-banner--danger` | 6,07:1 (já passava) | **6,07:1** | 4,5 | OK → OK |
| `.z-field__required` | âmbar-300 = 9,48:1 | âmbar-100 = **12,98:1** | 4,5 | OK → OK |
| `--z-text-muted` sobre cartão | 6,19:1 | **6,19:1** | 4,5 | OK → OK |

**Total de falhas depois da correção: 0 no claro e 0 no escuro** (auditor independente, exit 0).

### 3.3 Porque a correção ficou nos **tokens** e não nos componentes

O critério dizia «corrigir tokens em vez de espalhar cores hardcoded». Concretamente:

- **`app.css` — 31 repontagens, nenhuma cor nova.** Cada `color: var(--z-…-ink)` substitui
  `color: var(--z-accent)` / `var(--z-ok)` / `var(--z-danger)` ou um `#fff` literal. O ficheiro
  **não ganhou um único literal de cor**.
- **A única cor literal que sobrevive é deliberada:** `app.css:2280 background: #ffffff` em
  `.z-qr`. Um código QR invertido (claro sobre escuro) não é lido por muitos leitores; a cor é um
  requisito técnico do formato, não uma escolha de desenho, e está documentada no comentário ao
  lado.
- **A exceção à regra do `BRAND` ficou escrita no topo do `theme.css`.** O cabeçalho do ficheiro
  diz «qualquer cor nova tem de vir do `BRAND`». As superfícies `--z-*-soft` **já eram** valores
  escritos à mão fora do `BRAND`; em vez de deixar essa contradição implícita, o cabeçalho passou
  a declarar explicitamente a **única** exceção: os `--z-*-soft` são **fundos**, não tinta, e são
  afinados à mão porque o `BRAND` não tem escala para eles.
- **A tinta nova nasceu no `BRAND`, como pedido.** `#1b784f` e `#ba3e0c` entraram em
  `packages/shared/src/brand.ts` como `STATE_INK` e são emitidos por `brandCssVariables()`. O
  `theme.css` lê-os da escala, em vez de os inventar localmente. O `STATE` original
  (`ok: '#1f8a5b'`, `danger: '#c2410c'`) ficou **intacto**, como pedido — continua disponível onde
  o contraste não exige 4,5:1 (painéis, marcadores, a barra do cartão de estado).

### 3.4 Os 18 usos de `tone="ok"` — verificados

O pedido mandava verificar os 18 usos. `tone="ok"` alimenta `.z-chip--ok` e `.z-banner--ok`
(mais o `toast`), que passaram a usar `--z-ok-ink`. Contagem medida no código: **18** ocorrências
de `tone="ok"` e **4** de `tone="danger"`, exatamente como o `PC-24` declarava. Como a correção
foi feita no **token**, os 18 usos acompanham sem que nenhum componente tenha sido editado.

---

## 4. Testes

`apps/web/test/contraste-tokens.test.ts` — **58 testes**, 7 grupos, 407 linhas.

| Grupo | O que fixa |
| --- | --- |
| `leitura de theme.css (guardas anti-vacuidade)` | o leitor encontrou ≥70 tokens no claro e ≥30 no escuro; **4 valores sentinela** (`--z-neutral-900`, `--z-petrol-500`, `--z-bg-elevated`, `--z-petrol-300`); as listas de pares têm exatamente 21 elementos |
| `contraste — tema claro` | 21 grupos de pares, texto a 4,5:1 e gráficos a 3:1 |
| `contraste — tema escuro` | idem, com a cascata real |
| `os tokens corrigidos` | 6 asserções sobre os valores **literais** que a correção introduziu |
| `as cores originais da marca continuam disponíveis` | `#1f8a5b` e `#c2410c` continuam nos tokens (não foram substituídos) |
| `a correção está nos tokens…` | `app.css` sem literal em `color:`; o `＋` usa `var(--z-highlight-contrast)`; a faixa informativa não usa `--z-petrol-800` fixo |
| `toda a superfície pintada com texto por cima passa o limiar` | **invariante de família**: percorre **todas** as regras do `app.css`, recolhe as que pintam uma das 14 superfícies e escrevem texto por cima, e mede-as nos dois temas |

### 4.1 As três guardas anti-vacuidade

Um teste que passa porque **não mediu nada** é pior do que não ter teste — é um falso verde que
autoriza uma regressão. Por isso:

1. **Pisos de leitura.** Se o parser do `theme.css` partir, o teste falha em vez de comparar
   listas vazias: `claro.size >= 70`, `escuro.size >= 30`.
2. **Sentinelas.** Quatro tokens com valor conhecido são afirmados por **literal** (`#182020`,
   `#178186`, `#1f2727`, `#66bcba`). Se o parser ler o bloco errado, um destes falha.
3. **Piso da regra de família.** O invariante exige `regras.length >= 30` **antes** de medir. Sem
   isto, uma mudança na forma das regras do `app.css` faria o invariante passar sobre zero pares.

### 4.2 O teste foi corrido **contra o código intacto**: 25 falhados / 33 passados

Reconfirmei agora, com o ficheiro de teste **final**, os dois lados:

| Momento | Código | Testes | Resultado | exit |
| --- | --- | --- | --- | --- |
| linha de base | **pré-correção** | 58 | **25 falhados / 33 passados** | 1 |
| correção aplicada | corrigido | 58 | **58 passados / 0 falhados** | 0 |

A mensagem da primeira falha reproduz **textualmente** os números do `PC-24`:

```
--z-text-muted (#6f7d7c) falhou em: --z-bg-elevated = 4.29:1, --z-bg = 4.08:1,
--z-bg-sunken = 3.82:1, --z-warn-soft = 3.65:1, --z-accent-soft = 3.37:1, --z-ok-soft …
```

e as restantes apanham os `#fff` escritos à mão:

```
cores escritas à mão: app.css:376 color: #fff; | app.css:636 color: #ffffff;
                      | app.css:1437 color: #fff; | app.css:1442 color: #fff;
```

> **Nota de honestidade.** Uma medição anterior, com uma revisão anterior do ficheiro (57 testes),
> deu **24 falhados / 33 passados**. O número passou a **25** porque o teste **cresceu um bloco** —
> o invariante de família (§4.1, guarda 3) — e esse bloco **também** falha contra o código
> pré-correção. Não é uma correção de contagem: é o teste a ficar mais exigente e a apanhar mais um
> defeito. Os números que valem são os da tabela acima.

### 4.3 Suíte completa do projeto (regressão)

```
Test Files  10 passed (10)
     Tests  219 passed (219)
```

`exit 0`. O ficheiro novo é o 10.º; **nenhum teste existente mudou de cor** (eram 161 em 9
ficheiros antes deste trabalho).

---

## 5. Prova por mutação — 15 mutações, 15 mortas

Cada mutação repõe um defeito real num ficheiro-fonte, corre o teste, regista **exatamente que
testes ficam vermelhos**, **restaura** o ficheiro e confirma o `sha256`. O resultado é lido do
reporter **`--reporter=json`**, nunca de `grep` sobre linhas `×` (o reporter `verbose` prefixa as
linhas com ANSI, e um `grep` por `×` não lê nada — foi um erro que já cometi e que está registado
no `PROPOSAL-A3-WEB-010`).

| # | Mutação | Mortos | Restauro |
| --- | --- | --- | --- |
| **M1** | repõe `--z-text-muted` em neutral-500 (o defeito original) | **3/58** | ok |
| **M2** | repõe a tinta de `ok` no tom de marca | **4/58** | ok |
| **M3** | repõe a tinta de acento em petróleo-500 | **3/58** | ok |
| **M4** | repõe a faixa informativa em petróleo-800 fixo (escuro ilegível) | **3/58** | ok |
| **M5** | repõe a tinta de `danger` no tom de marca | **3/58** | ok |
| **M6** | repõe o texto sobre âmbar em branco (claro) | **3/58** | ok |
| **M7** | repõe o texto sobre âmbar em âmbar-100 (escuro) | **3/58** | ok |
| **M8** | **CONTROLO** — clareia a superfície suave de `ok` para branco | **1/58** | ok |
| **M9** | repõe o `#fff` à mão no badge da barra inferior | **2/58** | ok |
| **M10** | repõe a faixa informativa em petróleo-800 fixo (no CSS) | **2/58** | ok |
| **M11** | repõe a superfície do aviso de sucesso em `--z-ok` | **1/58** | ok |
| **M12** | repõe o `#fff` à mão no aviso de erro | **2/58** | ok |
| **M13** | repõe a etiqueta `ok` no tom de marca | **1/58** | ok |
| **M14** | repõe o `#fff` à mão no `＋` da barra inferior | **1/58** | ok |
| **M15** | **ANTI-VACUIDADE** — rebatiza o tema escuro | **0/0, saída 1** | ok |

```
=== RESUMO ===
mutações: 15   mortas: 15   sobreviventes: 0
restaurações verificadas: 15/15
problemas: 0
```

O que as mais informativas provam:

- **M1** mata o teste de `--z-text-muted` **e** o invariante de família — o defeito mais
  disseminado (36 declarações) é apanhado por dois caminhos independentes.
- **M8 é um controlo deliberado.** Ele **não** repõe um defeito: clareia a superfície suave de
  `ok` para branco, para verificar que a minha asserção «as superfícies suaves ficaram como
  estavam» **morde**. Mata exatamente 1 teste — o dessa asserção. Um controlo que não mata nada
  diria que essa asserção é decorativa.
- **M11** mata apenas o invariante de família — e é exatamente o que ele existe para fazer: o par
  (superfície, tinta) deixa de passar **sem que nenhum token tenha mudado**.
- **M15 prova a guarda anti-vacuidade.** Com o tema escuro rebatizado, o leitor do `theme.css`
  **recusa** o ficheiro e o teste nem chega a correr: `0 testes`, saída **1**.

> **Dois defeitos meus no próprio instrumento, encontrados e corrigidos.**
>
> 1. **M15 estava classificada como «sobreviveu».** Com o leitor a lançar, o vitest reporta
>    `numTotalTests: 0` e `numFailedTests: 0`, e o meu predicado (`falhou > 0`) lia isso como
>    verde. Corrigido para exigir que o teste **tenha corrido** (`numTotalTests > 0`) **e** saído
>    0 — só então é que sobreviveu. Um harness que confunde «não correu» com «passou» dá falsos
>    verdes precisamente no caso que mais interessa medir.
> 2. **M6 abortou à primeira tentativa.** A âncora de 2 espaços do bloco claro era **substring**
>    da linha de 4 espaços do bloco escuro, logo ocorria duas vezes. O script **recusou mutar** e
>    abortou antes de escrever — que é o comportamento correto: mutar o sítio errado mediria outra
>    coisa. Corrigido com um `\n` inicial na âncora.

### 5.1 Uma interrupção do ambiente, e o que ela obrigou a acrescentar

A meio de uma execução, o `SIGTERM` do terminal **matou o processo e deixou o `theme.css` mutado**
(sha `6ee9392d…` em vez de `d36c054d…`). Detetei-o comparando o `sha256` com a cópia guardada —
que é a razão pela qual a cópia existe. O harness foi endurecido: `reporTudo()` no arranque e
tratadores de `SIGINT`/`SIGTERM`/`SIGHUP` que repõem os ficheiros. A matriz foi re-corrida de
início e é a dessa corrida que os números acima são.

---

## 6. Typecheck

| Verificação | Comando | Resultado |
| --- | --- | --- |
| Web (projeto) | `tsc -p apps/web/tsconfig.json --noEmit` | **exit 0** |
| `packages/shared` | `tsc -p packages/shared/tsconfig.json --noEmit` | **exit 0** |
| Teste novo (`PC-15`) | `tsc -p <scratch>/tsconfig.web011.json` | **exit 0**, 251 ficheiros no programa, o teste presente |

### 6.1 `PC-15` — o typecheck do projeto **não vê** este teste

`apps/web/tsconfig.json` tem `"include": ["src", "vite.config.ts", "vite-env.d.ts"]`. **`test/`
está fora.** Um `typecheck` verde, portanto, não diz nada sobre o ficheiro novo — e um teste que
não compila é um teste que não corre. Verificado com um `tsconfig` restrito, **fora do
repositório**, com `typeRoots` e `paths` absolutos e o `vite-env.d.ts` em `files`.

### 6.2 O verificador **morde** — provado, não afirmado

Um verificador que sai `0` sempre não verifica nada. Injetei um erro de tipo deliberado
(`corClaro('--z-text-muted')` → `corClaro(123)`) e confirmei que é reportado:

```
apps/web/test/contraste-tokens.test.ts(258,21): error TS2345: Argument of type 'number'
  is not assignable to parameter of type 'string'.

exit do tsc com o erro : 2
sha256 reposto          : 1bf39ae5d78ac03920f42bed85873a2ebcb76202eec93f40f672d2520b58b743
reposição correta       : true
```

A injeção usa uma âncora que o script **exige ocorrer exatamente uma vez** e **aborta antes de
escrever** se não ocorrer — a primeira tentativa abortou precisamente porque a âncora tinha
mudado, e o script recusou escrever no sítio errado.

---

## 7. Contratos e impacto

| Superfície | Impacto | Verificação |
| --- | --- | --- |
| `packages/shared` | **aditivo e sem consumidores** | `STATE_INK` e a linha extra de `brandCssVariables()`. `STATE`, `BRAND`, as escalas e `Logo.tsx` **intactos**. Nenhum teste referia `BRAND`/`STATE`/`brandCssVariables` antes, e `brandCssVariables()` tinha **zero** consumidores em runtime — por isso acrescentar é seguro, e **nada** no repositório passou a depender dele. |
| API | **nenhum** | nada em `apps/api` foi tocado |
| Mobile | **nenhum** | nada em `apps/mobile` foi tocado |
| Contrato partilhado | **nenhuma alteração** | não há tipos de payload envolvidos; o `theme.css` continua a **copiar à mão** os valores das escalas (não passou a consumir o `BRAND` em runtime) — isso é dívida **pré-existente**, registada em §8.4 |

O `BRAND` ficou por isso com uma responsabilidade nova (`STATE_INK`) que **ainda não é usada por
ninguém**: o `theme.css` escreve os dois hex à mão. Isto é **consistente com o resto do ficheiro**
(todas as escalas são copiadas à mão) e evita introduzir uma dependência de build do `theme.css` no
`@zemlo/shared` dentro de uma tarefa de contraste. Fica registado como observação, não como
defeito.

---

## 8. O que **não** fiz, e limitações

### 8.1 A barra do cartão de estado — medida, e **não** um defeito

`.z-state-card--ok` (`app.css:1001`) pinta a barra lateral com `--z-ok` (`#1f8a5b`). Medido:

| Par | Razão | Limiar aplicável |
| --- | --- | --- |
| `--z-ok` sobre o cartão elevado (claro) | **4,33:1** | 3:1 (objeto gráfico) |
| `--z-danger` sobre `--z-danger-soft` (cartão em atraso, claro) | **4,43:1** | 3:1 |
| `--z-highlight-strong` sobre `--z-warn-soft` (cartão próximo, claro) | **3,07:1** | 3:1 |

Passa o limiar em todos os casos. **Não foi alterado**, e por três razões:

1. **A barra é redundante por desenho.** O código di-lo explicitamente (`records.tsx:52-55` e o
   comentário em `app.css:999-1000`): o estado aparece por **três canais** — cor da barra, ícone e
   texto — «porque a cor sozinha exclui quem não a distingue». A cor não é o único sinal.
2. **Passa o limiar que lhe compete** (3:1, não 4,5:1 — é uma barra de 3 px, não texto).
3. **Substituí-la pela tinta escurecida mudaria a identidade visual do cartão** de estado, o que é
   desenho — e o pedido foi explícito: «não substituir `#1f8a5b` em componentes que não têm o mesmo
   requisito». Este é precisamente um componente que **não** tem o requisito.

A margem de **3,07:1** do cartão `--z-due` fica registada como observação: é estreita, mas é
medida e passa.

### 8.2 O `--z-qr` e a cor literal deliberada

`app.css:2280 background: #ffffff` mantém-se. Um QR invertido não é lido por muitos leitores: a
cor é requisito técnico do formato. Documentado no comentário adjacente. É a **única** cor literal
em `app.css` fora do sistema de tokens — as outras três estão em §9.2 e são `PC-47`.

### 8.3 O anel de foco: verificado como **token**, não como **regra**

O `--z-border-focus` foi medido como par (4,65:1 no claro, 6,87:1 no escuro, limiar 3:1) e passa.
**Limitação declarada:** não fiz uma verificação **ao nível da regra** de que cada sítio que usa o
anel o faz com a espessura e o `outline-offset` corretos (WCAG 2.4.11/2.4.13 envolvem área e
posição, não só cor). É uma verificação diferente e **não** a fiz. Não a afirmo como feita.

### 8.4 A dívida pré-existente: o `theme.css` copia as escalas à mão

O `theme.css` não consome o `BRAND` em runtime — copia os valores. Isso significa que
`packages/shared/src/brand.ts` e `apps/web/src/styles/theme.css` podem **divergir em silêncio**. O
teste novo mede o `theme.css` (que é o que o browser usa), mas **não** compara os dois ficheiros.
Não é âmbito de `WEB-011` e não foi tocado; fica registado.

### 8.5 O que não foi feito

- **Não** foi tocado `docs/ROADMAP.md` (nenhuma linha, nenhuma renumeração).
- **Não** foram tocados a API, o mobile, o `WEB-008`, nem qualquer ficheiro de outra frente.
- **Não** foi corrigida a borda decorativa do `.z-datagap` — ver §9.2 (`PC-47`).
- **Não** foi removido o código morto `.z-btn--highlight` — ver §9.2.
- Sem commit, sem push, sem deploy.

### 8.6 Resíduos

Todos os scripts de medição e prova (`auditar.mjs`, `procurar.mjs`, `candidatos.mjs`, `ambar.mjs`,
`sonda-superficies.mjs`, `aplicar-app-css.mjs`, `mutar.mjs`, `medir-final.mjs`,
`reconfirmar.mjs`, `sensibilidade.mjs`, os JSON do reporter, a matriz, as cópias `base/` e
`depois/`, e o `tsconfig` restrito) ficam **fora do repositório**:

```
C:\Users\marti\AppData\Local\Temp\zemlo-web-contraste\
C:\Users\marti\AppData\Local\Temp\zemlo-web-tscheck\
```

O working tree **não** ganhou nenhum ficheiro meu além do teste. Não foi usada a Reciclagem
(bloqueada por política neste ambiente) nem `rm`.

---

## 9. Achados novos — **propostos a A9, não tratados**

### 9.1 `PC-46` · A enumeração do `PC-24` estava incompleta: medição manual não escala

O `PC-24` listava **6** pares abaixo do limiar e afirmava que no tema escuro havia **«só uma
falha»**. Medido, havia **seis** no escuro e mais três no claro — e o **pior par do produto**
(`.z-banner--info` no escuro, **1,18:1**, alcançável em 6 sítios) **não constava** (tabela em
§1.2).

**Porque isto é um achado e não uma nota:** a causa não é distração, é o método. Um inventário
escrito à mão a partir de leitura de código fica incompleto **por construção**, e o `PC-24` é a
prova — foi escrito com cuidado e mesmo assim faltava o pior caso. A correção durável não é
«acrescentar linhas ao `PC-24`»: é o teste automático (§4), que mede o `theme.css` inteiro e
falha sozinho. A recomendação para A9 é que os inventários de contraste deixem de ser mantidos à
mão e passem a ser **gerados** pelo teste.

### 9.2 `PC-47` · Continuam cores fora do `BRAND` em `app.css` — e a asserção de `WEB-011` só cobre o canal `color:`

A regra do topo do `theme.css` («qualquer cor nova tem de vir do `BRAND`») **não está cumprida em
absoluto**. Medido, restam em `app.css`:

| Local | Cor | Uso | Razão sobre o fundo real |
| --- | --- | --- | --- |
| `app.css:2115` | `#1d4a52` | `border-color` de `.z-datagap` (escuro) | **1,38:1** sobre `--z-bg-soft` |
| `app.css:2030` | `#0c2b30` | gradiente decorativo (escuro) | 1,11:1 sobre o fundo |
| `app.css:1940` | `rgba(255,255,255,0.14)` | véu translúcido | — |

O `#1d4a52` é o caso mais interessante: **não é nenhum tom da escala** (petróleo-800 é `#0b4046`,
petróleo-700 é `#0e545a`) — é uma cor **inventada**. E o par **claro** da mesma borda
(`--z-petrol-200` `#9ed6d3` sobre `--z-bg-soft` `#eaf6f5`) mede **1,46:1**: a borda tracejada do
`.z-datagap` falha 3:1 **nos dois temas**.

**Porque não corrigi:** a borda é declaradamente **decorativa** — o comentário em `app.css:2100`
diz «as lacunas de dados são um convite, não um erro: sem vermelho, sem ícone de aviso» — e a
informação é carregada pelo **texto** (`__title`/`__body`), pelo que não é um objeto gráfico
essencial. Escolher de que tom da escala `#1d4a52` é uma cópia (ou substituí-lo) é **decisão de
desenho**, não a alteração mínima e segura que o pedido autorizava. Fica registado para A9.

**Limitação declarada do meu teste:** a asserção `app.css não tem nenhuma cor literal em color:`
está ancorada em `^color:` e **não** apanha `border-color:` nem `background:`. Isto é
**consciente** (o âmbito do `WEB-011` era tinta sobre superfície, não toda a cor do ficheiro), mas
é uma **fronteira real** do que o teste garante: ele prova que a correção de contraste foi feita
nos tokens, **não** que o `app.css` está livre de cores fora do `BRAND`. Não o afirmo como se
estivesse.

### 9.3 O `git diff HEAD` mistura frentes — observação de processo

`AppShell.tsx` traz 14 linhas de outra frente (`WEB-006`) além da minha 1 linha (§2.1). A
consequência prática: **a pegada de um agente não é legível pelo `git diff`** — um revisor que
conte linhas atribuir-me-á trabalho que não é meu. Já está no espírito do `PC-20` (estado do
working tree escrito por fora), mas a expressão concreta — *diffs misturados entre frentes no mesmo
ficheiro* — ainda não estava registada. Fica registada aqui, sem número próprio, para A9 decidir se
merece linha.

---

## 10. Blocos propostos para integração no ROADMAP (a aplicar **por A9**)

### 10.1 Fecho de `WEB-011` — §5.3, substitui o corpo

```markdown
#### WEB-011 · Contraste abaixo de WCAG AA (medido) — A3 · P2 · `DONE`

- **Descrição:** ver `PC-24`. A auditoria de `WEB-006` mediu os pares de cor do produto pela
  fórmula de luminância relativa da WCAG. A correção de `WEB-011` **mediu de novo** e encontrou
  **mais** pares do que os 6 listados em `PC-24` — o pior do produto (`.z-banner--info` no tema
  escuro, `--z-petrol-800` sobre `--z-info-soft`, **1,18:1**) não constava. Ver `PC-46`.
- **Objetivo:** nenhum par de texto abaixo de 4,5:1 e nenhum objeto gráfico abaixo de 3:1, nos
  dois temas.
- **Dependências:** `WEB-008` (coordenação — não executar as duas ao mesmo tempo). **Verificado
  antes de começar:** `WEB-008` estava `BACKLOG`, `theme.css` intocado desde 2026-09-16 e
  `app.css` desde 2026-09-19.
- **Critérios de aceitação:** **todos cumpridos.**
  - texto normal ≥ 4,5:1 — **0 falhas** nos dois temas;
  - objetos gráficos ≥ 3:1 — **0 falhas**;
  - validado em claro **e** escuro — 21 grupos de pares em cada tema;
  - correção feita nos **tokens** — 31 repontagens em `app.css`, **nenhuma** cor nova no ficheiro;
  - o `＋` da barra inferior deixa de usar `#fff` à mão — passa a `var(--z-highlight-contrast)`
    (`AppShell.tsx:262`, **1 linha**);
  - nenhuma cor nova fora do `BRAND` — a tinta de `ok`/`danger` nasceu em
    `packages/shared/src/brand.ts` como `STATE_INK`; a **única** exceção (as superfícies
    `--z-*-soft`, que já eram valores à mão) passou a estar **escrita** no cabeçalho do
    `theme.css`, em vez de implícita.
- **Implementação:**
  - `packages/shared/src/brand.ts` (**+29/−0**): novo `STATE_INK = { ok: '#1b784f',
    danger: '#ba3e0c' }`, emitido por `brandCssVariables()`. `STATE` (`#1f8a5b`, `#c2410c`) fica
    **intacto**, disponível onde o contraste não exige 4,5:1.
  - `apps/web/src/styles/theme.css` (**+51/−1**): `--z-text-muted` sobe de neutral-500 para
    neutral-600; novos `--z-accent-ink`, `--z-info-ink`, `--z-highlight-contrast`,
    `--z-highlight-hover`, `--z-ok-ink`/`--z-ok-contrast`, `--z-danger-ink`/`--z-danger-contrast`,
    em claro e escuro. As superfícies `--z-*-soft` **não** mudaram (a medição mostrou que passam
    com as tintas novas).
  - `apps/web/src/styles/app.css` (**+32/−32**, 26 hunks, 2625 linhas antes e depois): 31
    repontagens para as tintas novas. A única cor literal que sobrevive é `#ffffff` em `.z-qr`
    (requisito técnico do código QR, documentado).
- **Testes:** `apps/web/test/contraste-tokens.test.ts` — **58 testes**, 7 grupos. Lê o
  `theme.css` **real** e resolve as cadeias `var()` com a cascata real (o escuro redefine papéis e
  herda escalas). **Três guardas anti-vacuidade:** pisos de leitura (≥70/≥30 tokens), 4 valores
  sentinela afirmados por literal, e um piso de ≥30 regras no invariante de família. O invariante
  percorre **todas** as regras do `app.css`, recolhe as que pintam uma das 14 superfícies e
  escrevem texto por cima, e mede-as nos dois temas — é o sítio onde viviam os `#fff` à mão.
  Medido **contra o código pré-correção: 25 falhados / 33 passados**; com a correção: **58
  passados**.
- **Prova por mutação:** **15 mutações, 15 mortas, 0 sobreviventes**, 15/15 restaurações
  verificadas por `sha256`, lidas do reporter **JSON**. M8 é um **controlo** (clareia a superfície
  suave de `ok` e mata 1 teste — prova que a asserção «as superfícies ficaram como estavam»
  morde); M15 é a **prova da guarda anti-vacuidade** (com o tema escuro rebatizado, o leitor
  recusa o ficheiro e o teste nem corre: `0 testes`, saída 1). **Dois defeitos meus no harness**
  foram encontrados e corrigidos: M15 estava classificada como «sobreviveu» porque
  `numTotalTests: 0` era lido como verde; e M6 abortou por a âncora de 2 espaços ser substring da
  de 4 (o script recusou mutar o sítio errado). Um `SIGTERM` do terminal matou uma execução a meio
  e deixou o `theme.css` mutado — detetado por `sha256`, reposto, e o harness passou a ter
  tratadores de sinal.
- **Verificação:** `typecheck` web exit 0; `typecheck` de `packages/shared` exit 0; suíte web
  **219 testes / 10 ficheiros**, exit 0 (161/9 antes deste trabalho); o teste novo está **fora**
  do `typecheck` do projeto (`PC-15`), pelo que foi verificado com `tsconfig` restrito fora do
  repositório (exit 0, 251 ficheiros no programa, o teste presente), e esse verificador foi
  provado **sensível** (erro injetado → `TS2345`, exit 2, reposto por `sha256`). Auditor
  independente: **0 falhas** nos dois temas.
- **Contratos:** `packages/shared` alterado de forma **aditiva e sem consumidores** —
  `STATE`/`BRAND`/escalas intactos; nada no repositório passou a depender de `STATE_INK`. Impacto
  nenhum em API e mobile. **Dívida registada:** o `theme.css` continua a copiar as escalas à mão,
  pelo que pode divergir do `BRAND` em silêncio (pré-existente, não tratado aqui).
- **Ficheiros:** `packages/shared/src/brand.ts`, `apps/web/src/styles/theme.css`,
  `apps/web/src/styles/app.css`, `apps/web/src/app/AppShell.tsx` (**1 linha**),
  `apps/web/test/contraste-tokens.test.ts` (novo).
- **Achados que saíram daqui:** `PC-46` (a enumeração do `PC-24` estava incompleta) e `PC-47`
  (continuam cores fora do `BRAND` em `app.css`, e a asserção do teste só cobre `color:`).
- **Commit:** **não feito** — sem autorização explícita de publicação. Nada foi publicado.
```

### 10.2 Fecho de `PC-24` — §2, substitui a coluna de estado

```diff
-| Média | Aberto — `WEB-011` |
+| Média | **Resolvido** — `WEB-011` `DONE` (2026-09-22). A enumeração deste `PC-24` estava **incompleta**: a correção mediu de novo e encontrou **mais** pares abaixo do limiar do que os 6 listados, incluindo o **pior do produto** (`.z-banner--info` no tema escuro, `--z-petrol-800` sobre `--z-info-soft` = **1,18:1**, alcançável em 6 sítios) — ver **`PC-46`**. Corrigidos nos tokens: `--z-text-muted` neutral-500 → neutral-600 (4,29/4,08/3,82 → 6,51/6,20/5,81); `ok` → `#1b784f` (3,82 → 4,81); `danger` → `#ba3e0c` (4,43 → 4,75); `--z-accent-ink` petróleo-600/300 (3,66 → 4,98; escuro 3,81 → 5,55); `--z-info-ink` petróleo-800/200; `--z-highlight-contrast` âmbar-900; `--z-ok-contrast`/`--z-danger-contrast`. O `#1f8a5b` e o `#c2410c` originais **continuam disponíveis** (onde o contraste não exige 4,5:1). O `＋` da barra inferior e o badge passam a `var(--z-highlight-contrast)` (2,43 → 4,77 no claro; 1,88 → 6,18 no escuro). **O `.z-btn--highlight` continua código morto** (`grep` devolve zero em `.tsx`): foi corrigido por precaução, mas deve ser **removido ou usado** — decisão de A9. Zero falhas nos dois temas depois da correção; **58 testes** novos e **15 mutações** mortas. Linhas: `theme.css` 257 → 307; a tinta nova nasceu em `packages/shared/src/brand.ts` (`STATE_INK`). |
```

### 10.3 Novas linhas `PC-46` e `PC-47` — §2, a acrescentar ao fim da tabela

```markdown
| PC-46 | **A enumeração do `PC-24` estava incompleta — e o pior par do produto não constava.** O `PC-24` listava **6** pares abaixo do limiar e afirmava que no tema escuro havia «só uma falha». Medido por A3 na correção de `WEB-011`, havia **seis** no escuro: `.z-banner--info` (`--z-petrol-800` sobre `--z-info-soft`) = **1,18:1** — o pior par do produto, alcançável em **6 sítios**; `＋` e `.z-tabbar__badge` (`#fff` sobre `--z-highlight`) = **1,88:1**; `.z-toast--ok` = **2,35:1**; `.z-toast--danger` = **2,47:1**; `.z-chip--accent` = **3,81:1** (este constava). No claro faltavam ainda `.z-toast--ok` = **4,33:1**, `.z-field__required` = **3,60:1** e `.z-btn--highlight:hover` = **3,60:1**. **Todos corrigidos** em `WEB-011`. A causa **não** é distração, é o método: um inventário escrito à mão a partir de leitura de código fica incompleto **por construção** — e o `PC-24` é a prova, porque foi escrito com cuidado e mesmo assim faltava o pior caso. A recomendação é que os inventários de contraste deixem de ser mantidos à mão e passem a ser **gerados** pelo teste automático de `WEB-011`. **Deteção: A3, 2026-09-22, durante `WEB-011`.** | `apps/web/src/styles/app.css`, `apps/web/src/styles/theme.css`, `apps/web/src/app/AppShell.tsx` | Média | Resolvido no código — falta só a decisão de processo |
| PC-47 | **Continuam cores fora do `BRAND` em `app.css`, e a asserção de `WEB-011` só cobre o canal `color:`.** A regra do topo do `theme.css` («qualquer cor nova tem de vir do `BRAND`») **não** está cumprida em absoluto. Medido: `app.css:2115 border-color: #1d4a52` (borda tracejada de `.z-datagap`, tema escuro) — cor **inventada**, que não é nenhum tom da escala (petróleo-800 = `#0b4046`, petróleo-700 = `#0e545a`), e mede **1,38:1** sobre `--z-bg-soft`; o par **claro** da mesma borda (`--z-petrol-200` sobre `--z-bg-soft`) mede **1,46:1** — ou seja, a borda falha 3:1 **nos dois temas**; `app.css:2030 #0c2b30` (gradiente decorativo, 1,11:1); `app.css:1940 rgba(255,255,255,0.14)` (véu translúcido). **Não corrigido em `WEB-011`:** a borda é declaradamente **decorativa** (`app.css:2100`: «as lacunas de dados são um convite, não um erro»), a informação é carregada pelo texto, e escolher o tom exige **decisão de desenho**, não a alteração mínima e segura que o pedido autorizava. **Limitação declarada do teste de `WEB-011`:** a asserção `app.css não tem nenhuma cor literal em color:` está ancorada em `^color:` e **não** apanha `border-color:` nem `background:` — prova que a correção de contraste foi feita nos tokens, **não** que o `app.css` está livre de cores fora do `BRAND`. **Deteção: A3, 2026-09-22, ao declarar as limitações de `WEB-011`.** | `apps/web/src/styles/app.css:1940,2030,2115`; `apps/web/test/contraste-tokens.test.ts` | Baixa | Aberto — decisão de desenho (de que tom é cópia o `#1d4a52`) |
```

### 10.4 Tabela de tarefas — §4

```diff
-| WEB-011  | Web          | Contraste abaixo de WCAG AA (medido)                                   | A3     | P2         | `READY`    | `WEB-008`               |
+| WEB-011  | Web          | Contraste abaixo de WCAG AA (medido)                                   | A3     | P2         | `DONE`     | `WEB-008`               |
```

### 10.5 Fila de A3 — §9

```diff
-| 1     | `WEB-011` — Contraste WCAG (medido)       | P2         | `READY` — é sistema de desenho; **coordenar com `WEB-008`** (sem trabalho simultâneo) |
+| —     | `WEB-011` — Contraste WCAG (medido)       | P2         | **`DONE`** (2026-09-22) — 0 falhas nos 2 temas, 58 testes, 15 mutações |
```

E o parágrafo de contagem que se segue passa a **sete** `DONE` (`WEB-005`, `WEB-006`, `MOB-001`,
`WEB-001`, `WEB-003`, `WEB-010`, `WEB-011`).

### 10.6 Entrada de changelog — fim de §13

```markdown
| 2026-09-22 | A3 · `WEB-011` **concluída** — o contraste do produto passa a cumprir WCAG AA nos dois temas. **O gate de coordenação com `WEB-008` foi verificado antes de escrever** (`WEB-008` em `BACKLOG`, `theme.css` intocado desde 2026-09-16, `app.css` desde 2026-09-19). A medição foi feita por um **auditor independente**, validado primeiro contra os números que o próprio `PC-24` publicava (13,13 / 4,65 / 9,87 / 6,19 — todos reproduzidos) — e a primeira versão desse auditor tinha um **defeito meu** (ordenava as luminâncias de forma ascendente e devolvia o recíproco: `0,08:1` para texto escuro sobre branco), corrigido por ser impossível. **O `PC-24` estava incompleto:** listava 6 pares, havia muito mais, e o pior do produto — `.z-banner--info` no escuro a **1,18:1** — não constava (abre **`PC-46`**). Tintas novas escolhidas por **medição**, não a olho: uma descida encontrou o tom mais próximo que passa (`#1c7d52`, exatamente 4,503:1) e rejeitou-o por não ter margem, ficando `#1b784f` (**4,81:1**) e `#ba3e0c` (**4,75:1**) — nascidos no `BRAND` como `STATE_INK`, com o `#1f8a5b` e o `#c2410c` originais **intactos** para os usos onde o contraste não exige 4,5:1. Correção **nos tokens**: `theme.css` `+51/−1` (`--z-text-muted` neutral-500 → neutral-600: 4,29/4,08/3,82 → **6,51/6,20/5,81**), `app.css` `+32/−32` (31 repontagens, **nenhuma cor nova**; a única literal que sobrevive é o `#ffffff` do `.z-qr`, requisito do formato), `AppShell.tsx` **1 linha** (o `＋` da barra inferior: 2,43 → **4,77** no claro, 1,88 → **6,18** no escuro). Novo `apps/web/test/contraste-tokens.test.ts` — **58 testes**, lê o `theme.css` real, com **três guardas anti-vacuidade** (pisos de leitura, 4 sentinelas, piso de ≥30 regras) e um **invariante de família** que percorre todas as regras do `app.css` e mede cada superfície pintada com texto por cima nos dois temas. Medido **contra o código pré-correção: 25 falhados / 33 passados** (a mensagem reproduz os números do `PC-24` textualmente); com a correção: **58 passados**. **15 mutações, 15 mortas, 0 sobreviventes**, 15/15 restaurações por `sha256`, lidas do reporter JSON — incluindo **M8** (controlo que prova que a asserção «as superfícies ficaram como estavam» morde) e **M15** (prova da guarda anti-vacuidade: com o tema escuro rebatizado o teste nem corre, `0 testes`, saída 1). **Dois defeitos meus no harness** corrigidos: M15 estava lida como «sobreviveu» porque `numTotalTests: 0` era tratado como verde; e M6 abortou por a âncora de 2 espaços ser substring da de 4 (o script recusou mutar o sítio errado). Um `SIGTERM` do terminal deixou o `theme.css` mutado a meio — detetado por `sha256` e o harness passou a repor no arranque e a tratar sinais. Suíte web **219 testes / 10 ficheiros** exit 0 (161/9 antes); `typecheck` web e de `packages/shared` exit 0; o teste está fora do `typecheck` do projeto (`PC-15`) e foi verificado com `tsconfig` restrito (exit 0, 251 ficheiros), com o verificador provado **sensível** (`TS2345`, exit 2). `packages/shared` alterado de forma **aditiva e sem consumidores**. **Não alterado de propósito, com medição:** a barra do cartão de estado (4,33:1 / 4,43:1 / 3,07:1 — passa 3:1 e é redundante por desenho), o `#ffffff` do `.z-qr` e a opacidade dos botões desativados (WCAG isenta controlos inativos). **Limitações declaradas:** o anel de foco foi verificado como **token**, não ao nível da regra; e a asserção de cores do teste só cobre o canal `color:` — continuam cores fora do `BRAND` em `app.css` (`#1d4a52`, `#0c2b30`, `rgba(255,255,255,0.14)`), registadas em **`PC-47`**. `WEB-011` → `DONE`; `PC-24` → resolvido. Sem commit, sem push, sem deploy. |
```

---

## 11. Verificação das afirmações (feita, não assumida)

| Afirmação | Como foi verificada |
| --- | --- |
| `WEB-008` estava livre | estado no ROADMAP (`BACKLOG`, `:312`) + mtimes de `theme.css` (2026-09-16) e `app.css` (2026-09-19) |
| o auditor é fiável | reproduziu **todos** os valores publicados no `PC-24` (13,13 / 4,65 / 9,87 / 6,19 / 3,82) |
| o auditor tinha um defeito | a primeira versão dava `0,08:1` para texto escuro sobre branco — impossível, logo visível; corrigida |
| 0 falhas de texto e de gráficos | auditor independente, exit 0, nos dois temas |
| as tintas novas foram escolhidas por medição | descida sobre o espaço de cor: mínimo exato 4,503:1 rejeitado, escolhido o tom com margem (4,81/4,75) |
| o teste **falha** no código pré-correção | corrida contra os ficheiros `base/*.antes`: **25 falhados / 33 passados**, exit 1 |
| o teste passa com a correção | **58 passados / 58**, exit 0 |
| a suíte não regrediu | **219 passados / 10 ficheiros**, exit 0 |
| as mutações matam | **15/15 mortas**, 0 sobreviventes, lidas do reporter **JSON** |
| as mutações repõem | 15/15 restaurações verificadas por `sha256` |
| o invariante não é vazio | M8/M11/M13 matam-no sem que nenhum token mude; piso de ≥30 regras |
| o teste não passa por vacuidade | M15: com o tema escuro rebatizado, o leitor recusa o ficheiro e o teste nem corre (`0 testes`, saída 1) |
| `app.css` não ganhou cores | `grep` de hex/rgb: só o `#ffffff` deliberado do `.z-qr`; a asserção do teste cobre `color:` |
| a pegada é a declarada | `git diff --numstat`: `51/1`, `32/32`, `29/0`, `15/1`; do `AppShell` só 1 linha é minha |
| o typecheck cobre o teste | **não** cobre (`PC-15`); verificado com `tsconfig` restrito, 251 ficheiros no programa |
| o verificador restrito morde | erro injetado → `TS2345` na linha 258, exit 2, reposto por `sha256` |
| `STATE`/`BRAND` intactos | `git diff` de `brand.ts` é **só aditivo** (+29/−0); `#1f8a5b` e `#c2410c` afirmados por teste |
| o `theme.css` foi reposto após as mutações | sha256 `d36c054d…` igual ao valor de referência, no fim da matriz |
| o ROADMAP não foi tocado | sha256 `9bec4e5f…`, mtime `2026-09-22 22:22:32` — **inalterado** |
| o working tree não ganhou resíduos meus | scripts e cópias em `%TEMP%`; o único ficheiro novo no repo é o teste |

---

**Resumo de uma linha:** `WEB-011` corrige o contraste do produto **nos tokens**, com **0 falhas**
nos dois temas, **58 testes** que mordem (25 vermelhos no código pré-correção) e **15 mutações
todas mortas**; propõe `PC-46` (o inventário do `PC-24` estava incompleto) e `PC-47` (continuam
cores fora do `BRAND` em `app.css`). **Sem commit, sem push, sem deploy; ROADMAP intocado.**
