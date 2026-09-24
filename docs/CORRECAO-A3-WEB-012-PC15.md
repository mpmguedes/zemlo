# Correção — `WEB-012`, `PC-15` com a configuração real da app

> **SOU O A9.**
>
> **Defeito reportado na revisão:** `apps/web/test/page-titles.test.tsx:71` — `TS2345` na chamada
> a `missingPageTitles(UNIQUE_DECLARED_PATHS)` com `noUncheckedIndexedAccess: true`, que é a
> configuração real de `apps/web/tsconfig.json`.
> **Estado:** **corrigido e re-verificado**. Produção **intocada**. Sem commit, sem push, sem
> deploy. `docs/ROADMAP.md` **não tocado** (`60965b57…`).

---

## 1. O defeito — reproduzido, não aceite por descrição

Primeiro reproduzi-o com uma configuração que **herda as opções reais da app**
(`extends: apps/web/tsconfig.json`), em vez de as recopiar:

```
apps/web/test/page-titles.test.tsx(71,30): error TS2345: Argument of type '(string | undefined)[]'
is not assignable to parameter of type 'readonly string[]'.
  Type 'string | undefined' is not assignable to type 'string'.
    Type 'undefined' is not assignable to type 'string'.
```

**A causa é uma linha acima da citada.** Em `:47`:

```ts
const DECLARED_PATHS = [...APP_SRC.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
```

Com `noUncheckedIndexedAccess` ligado, um acesso por índice devolve `T | undefined`, pelo que
`m[1]` é `string | undefined`, `DECLARED_PATHS` é `(string | undefined)[]` e
`UNIQUE_DECLARED_PATHS` também — e `missingPageTitles` recebe `readonly string[]`. O erro aparece
**na chamada** (`:71`), mas a correção pertence à extração.

---

## 2. A correção — mínima, e só no teste

**Um caractere**, mais o comentário que explica porquê:

```diff
-const DECLARED_PATHS = [...APP_SRC.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
+/*
+ * O `!` do grupo de captura e obrigatorio por causa de `noUncheckedIndexedAccess` (que a app
+ * liga em `apps/web/tsconfig.json`): sem ele, `m[1]` e `string | undefined` e a lista deixa de
+ * ser aceite por `missingPageTitles(readonly string[])` — `TS2345` na chamada.
+ *
+ * Nao e um cast cego: o grupo `([^"]+)` **nao** e opcional no padrao, logo `m[1]` existe sempre
+ * que ha casamento; e a assercao de contagem logo abaixo (33 ocorrencias, 32 distintas) faz
+ * falhar o teste se alguma captura se perder. E a mesma forma que `bundle-import-transport.test.ts`
+ * ja usa para `captured[0]!`.
+ */
+const DECLARED_PATHS = [...APP_SRC.matchAll(/path="([^"]+)"/g)].map((m) => m[1]!);
```

`+11 / −1`, **um só ficheiro**, e é o de teste. `missingPageTitles`, `pageTitles.ts`,
`useRouteAnnouncement.ts`, `App.tsx` e `AppShell.tsx` **não foram tocados** — os seus `sha256`
continuam exatamente os da entrega anterior (§6).

**Porque é que o `!` é justificado e não um cast cego:**

1. o grupo `([^"]+)` **não** é opcional no padrão, logo `m[1]` existe sempre que há casamento;
2. a asserção de contagem imediatamente a seguir (`33` ocorrências / `32` distintas) **falha** se
   alguma captura se perder — a suposição está guardada por um teste, não confiada;
3. é a forma que o próprio repositório já usa em testes para o mesmo motivo
   (`bundle-import-transport.test.ts`: `captured[0]!.url`, `captured[0]!.body`).

A alteração é **de tipo, não de execução**: em tempo de execução o `!` desaparece na compilação, e
a prova disso é que as contagens da mutação ficaram **idênticas** (§5).

---

## 3. O meu erro de método — e é o achado que interessa

**O `PC-15` da ronda anterior verificava o teste com uma configuração mais fraca do que aquela em
que ele vive.** O `tsconfig` do harness declarava `strict: true` mas **não** declarava
`noUncheckedIndexedAccess` — que em `apps/web/tsconfig.json` é `true`. Recopiar as opções à mão
deixou cair exatamente a que o defeito precisava.

Medido, no ficheiro **pré-correção**, com as duas configurações:

| Configuração do harness | Resultado |
| --- | --- |
| **Antiga** (a que usei; opções recopiadas, sem `noUncheckedIndexedAccess`) | **exit 0** — **cega ao defeito** |
| **Nova** (`extends: apps/web/tsconfig.json`) | **exit 2**, `TS2345` em `(71,30)` |

A configuração antiga **dava verde a um ficheiro que não compila na configuração real**. É a mesma
família de falso verde que o projeto proíbe, agora dentro do próprio verificador.

**Correção estrutural:** o harness passa a fazer **`extends` da configuração real**, em vez de
recopiar opções. Assim herda **todas** as opções da app — `noUncheckedIndexedAccess`,
`noUnusedLocals`, `verbatimModuleSyntax`, `noImplicitOverride` — e não só as que alguém se lembrou
de copiar. Ficheiro: `%TEMP%\zemlo-web-tscheck\tsconfig.web012-real.json`.

**A única sobreposição que o harness se permite**, e está dita no ficheiro: `types: []` +
`typeRoots` absoluto. Razão medida: a base declara `types: ["vite/client"]`, e essa resolução parte
da pasta do ficheiro de configuração; vivendo o harness fora do repositório, o `tsc` responde
`TS2688: Cannot find type definition file for 'vite/client'` e **não chega a verificar nada**. Com
`types: []`, o `vite/client` continua a entrar pela referência tripla do `apps/web/vite-env.d.ts`
(que está no `include`), logo `import.meta.env` continua tipado. **`noUncheckedIndexedAccess` não
é sobreposta** — vem herdada.

---

## 4. Re-validação — os cinco pontos pedidos

| # | Verificação | Resultado |
| --- | --- | --- |
| 1 | **`PC-15` com a configuração real** (sem desligar `noUncheckedIndexedAccess`) | **exit 0**, **90 ficheiros** de `apps/web` |
| 2 | **testes `page-titles`** | **14/14**, exit 0 |
| 3 | **suite Web** (`--no-cache --no-file-parallelism`) | **13 ficheiros, 260/260**, exit 0 |
| 4 | **typecheck da app** (`tsc -p apps/web/tsconfig.json`) | **exit 0** |
| 5 | **prova de mutação** | **9/10 mortas**; ver §5 |

O `PC-15` **provou morder** nesta matéria: foi ele que reproduziu o `TS2345` antes da correção
(§1) e que dá exit 0 depois. Um verificador que só se tivesse visto a si próprio nunca teria
mostrado a diferença — o que a mostrou foi a **comparação entre as duas configurações** (§3).

---

## 5. Prova de mutação — a cobertura **não** enfraqueceu

Dez mutações, corridas contra o código de produção e contra o teste. **9 mortas, 1 sobrevivente**,
e o sobrevivente é o esperado.

| Mutação | Pré-correção | Pós-correção | |
| --- | --- | --- | --- |
| M1 · entrada `/stats` fora do mapa | 3/14 | **3/14** | igual |
| M2 · separador `·` → `—` | 4/14 | **4/14** | igual |
| M3 · alvo de foco passa ao `h1` | 1/14 | **1/14** | igual |
| M4 · `<main>` perde `tabIndex={-1}` | 1/14 | **1/14** | igual |
| M5 · chamada ao efeito comentada | 1/14 | **1/14** | igual |
| M6 · filtro volta a excluir o `*` | 4/14 | **4/14** | igual |
| M7 · `SITE_NAME` muda | 1/14 | **1/14** | igual |
| M8 · **rota nova sem título** (o critério da tarefa) | 2/14 | **2/14** | igual |
| M9 · extração de `path=` deixa de casar | 2/14 | **2/14** | igual |
| M10 · foco perde o `preventScroll` | *(não existia)* | **VIVA** | esperado |

**Todas as nove contagens são idênticas.** Se o `!` tivesse enfraquecido alguma asserção, alguma
delas teria descido. O critério da tarefa (**M8**) continua a matar com 2/14: acrescentar uma rota
ao `App.tsx` sem título põe a suite vermelha.

**M10 continua a sobreviver, e é o resultado certo:** `preventScroll` não é observável sem DOM, a
suite não o pode apanhar, e é a validação no browser que o mata (`docs/VALIDACAO-A3-WEB-012.md` §5,
delta `0` → `−263`). O driver sai `1` por causa deste sobrevivente — é a resposta honesta, não uma
falha da correção.

---

## 6. Âmbito — produção intocada

| Ficheiro | `sha256` (16 primeiros) | Antes da correção | Alterado? |
| --- | --- | --- | --- |
| `apps/web/src/app/pageTitles.ts` | `b93cad2467bfc368` | igual | **não** |
| `apps/web/src/app/useRouteAnnouncement.ts` | `1a257a36c50d39e9` | igual | **não** |
| `apps/web/src/App.tsx` | `cbf805389e7f2682` | igual | **não** |
| `apps/web/src/app/AppShell.tsx` | `47b68495cfba949b` | igual | **não** |
| `apps/web/test/page-titles.test.tsx` | `93e87211c8cfa445` | era `7e872894…` | **sim** (`+11/−1`) |

`git diff --numstat apps/web` continua a dar apenas `9/0` (`App.tsx`) e `8/1` (`AppShell.tsx`) —
os mesmos da entrega anterior. **Nenhuma linha de produção foi alterada nesta correção.**

---

## 7. Nota de honestidade — o harness apanhou-se a si próprio

Ao re-correr a prova, o driver **abortou** com `ÂNCORA INVÁLIDA em test: 0 ocorrências` na mutação
M9. Causa: a âncora de M9 era a linha que eu acabei de mudar (`…map((m) => m[1]);`), e o `!`
tornou-a obsoleta.

O comportamento foi o correto e é o que o harness existe para garantir: **abortou antes de
escrever** (`NÃO ESCREVI`) e o ficheiro ficou intacto (`CHECK OK`). Âncora atualizada para o texto
novo e a prova re-corrida. Fica dito porque uma mutação que não encontra a sua âncora **não** é um
sobrevivente nem um erro do produto — é o harness a recusar-se a mutar o sítio errado.

---

## 8. Limitações declaradas

1. **O harness vive fora do repositório** e por isso precisa de `typeRoots` absoluto e de
   `types: []` (§3). É a única sobreposição; a opção que interessa vem herdada.
2. **A correção é de tipo, não de comportamento** — e por isso não há um teste novo a prová-la. O
   que a prova é: o `PC-15` real reproduz o erro antes e dá exit 0 depois (§1, §4), e as contagens
   de mutação não mudaram (§5).
3. **A configuração antiga continua no disco** (`tsconfig.web004.json`), para o registo da
   comparação de §3. Não deve ser usada para verificar nada — é a que era cega.

---

## 9. Resíduos

| Ficheiro | Onde | Ação |
| --- | --- | --- |
| `tsconfig.web012-real.json` | `%TEMP%\zemlo-web-tscheck\` | o harness **correto** (herda a config real) |
| `page-titles.antes.tsx` | `.workbuddy-ai/scratch/` | reconstrução do ficheiro pré-correção, **conferida por `sha256`** (`7e872894…`) |
| `web012-mutacoes-posfix.log` | `.workbuddy-ai/scratch/` | a prova pós-correção |
| `fix-titles.json`, `fix-web.json` | `.workbuddy-ai/scratch/` | relatórios do vitest |

O ficheiro de teste foi reposto da cópia imutável e conferido (`93e87211…`); os cinco ficheiros do
harness dão `CHECK OK`. Nada disto entra no repositório.
