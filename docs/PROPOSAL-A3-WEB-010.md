# Proposta de A3 a A9 — `WEB-010` · o cabeçalho do calendário mostrava uma data em vez do mês

> **SOU O A9.**
>
> **Estado:** `WEB-010` **implementada e provada** (re-verificada em 2026-09-23, com o teste
> reforçado para 19 casos). Proposta de fecho de `WEB-010` e de `PC-17`, mais **três achados
> novos** propostos (`PC-44`, `PC-45`, `PC-48`) — **não** tratados.
> **Produção alterada:** 2 ficheiros — `CalendarGrid.tsx` (**2 linhas minhas**) e `format.ts`
> (**só comentários**, 0 linhas executáveis). **Teste:** `calendar-month-label.test.tsx`, 334
> linhas, **19 testes**.
> **Sem commit, sem push, sem deploy.** `docs/ROADMAP.md` **não foi tocado** — a integração é de
> A9.

---

## 1. Diagnóstico

### 1.1 O defeito, e a sua causa medida

O título do mês era construído assim (`CalendarGrid.tsx:97`, antes):

```ts
const monthLabel = dateLong(`${month}-01`).replace(/^1 de /, '').replace(/^1 /, '');
```

Os dois `replace` esperam a forma `1 de setembro de 2026`. Essa é a forma do CLDR de **`pt`**, não
de **`pt-PT`**. Medido neste ambiente:

```
ICU  : 78.2
node : v22.22.2
pt-PT supported: [ 'pt-PT' ]
```

| locale | esqueleto | saída | `month` resolvido |
| --- | --- | --- | --- |
| `pt-PT` | `{day:'2-digit', month:'short', year:'numeric'}` | `"01/09/2026"` | **`"2-digit"`** |
| `pt-PT` | `{month:'short', year:'numeric'}` | `"09/2026"` | **`"2-digit"`** |
| `pt-PT` | `{month:'short'}` | `"set."` | `"short"` |
| `pt-PT` | `{month:'long', year:'numeric'}` | `"setembro de 2026"` | `"long"` |
| `pt` | `{day:'2-digit', month:'short', year:'numeric'}` | `"01 de set. de 2026"` | `"short"` |

### 1.2 O que esta medição acrescenta a `PC-17`

`PC-17` já diz que o `pt-PT` resolve o esqueleto para `dd/MM/y`. A medição acima **precisa a
causa**, e a precisão muda o diagnóstico:

- a degradação é provocada **pelo ano**, não pelo dia. `{month:'short', year:'numeric'}`
  sozinho já dá `"09/2026"` — o nome curto do mês é substituído por dois dígitos;
- sem ano, o nome curto **sobrevive**: `{month:'short'}` → `"set."`;
- logo, os dois `replace` nunca poderiam casar **com nenhum** dos esqueletos que o módulo usa.
  Não era um erro de recorte: era um recorte sobre um texto que nunca chegou a existir.

Ou seja: `monthLong` (`{month:'long', year:'numeric'}`) não é uma alternativa entre várias — é
a **única** forma de obter o nome do mês em `pt-PT`. É isso que fica escrito em `format.ts`.

### 1.3 O gate de coordenação — verificado antes de alterar ficheiros

| Verificação | Resultado |
| --- | --- |
| `CalendarGrid.tsx` — última modificação | **2026-09-22 22:58:56** (a minha; ninguém lhe tocou depois) |
| `format.ts` — última modificação | **2026-09-22 22:58:56** (a minha; ninguém lhe tocou depois) |
| `calendar-month-label.test.tsx` — última modificação | **2026-09-22 22:59:44** |
| Atividade de outros agentes nos mesmos ficheiros | **nenhuma** (só eu os toquei nas últimas 11 h) |
| `WEB-008` (mesmo ecrã, proibido de tocar) | `BACKLOG` — **não** tocado; `theme.css`/`app.css` intactos |

Não houve, em momento nenhum, dois escritores nos mesmos ficheiros. As únicas alterações que fiz
hoje foram no ficheiro de **teste**.

---

## 2. Ficheiros alterados

| Ficheiro | Alteração | sha256 final |
| --- | --- | --- |
| `apps/web/src/components/CalendarGrid.tsx` | **2 linhas**: o `import` e o `monthLabel` | `7c03dcca75a606c6a990d9a85bd59a8378cea93a47a24ea32a460cba48083eff` |
| `apps/web/src/lib/format.ts` | **só comentários** (0 linhas executáveis) | `93e823cf83e92e58f4ecd50b4ae9194794ebc3b69e6242eaf22744640cbfecdb` |
| `apps/web/test/calendar-month-label.test.tsx` | **novo/atualizado** — 334 linhas, **19 testes** | `166e5e0bd64ad94e4dbe20996da8a2d49a4eea3627aab405f3a3f44d128b6e83` |

O diff de produção, na íntegra:

```diff
-import { dateLong, money, relativeDate, today } from '../lib/format';
+import { dateLong, monthLong, money, relativeDate, today } from '../lib/format';
@@
-  const monthLabel = dateLong(`${month}-01`).replace(/^1 de /, '').replace(/^1 /, '');
+  const monthLabel = monthLong(`${month}-01`);
```

### 2.1 Aviso sobre o diff contra `HEAD` — **mistura frentes**

`git diff --stat` mostra **mais** do que isto:

```
 apps/web/src/components/CalendarGrid.tsx | 18 ++++++++++++++-----
 apps/web/src/lib/format.ts               | 33 +++++++++++++++++++++++++++++++--
 2 files changed, 46 insertions(+), 5 deletions(-)
```

Os `+18/−5` do `CalendarGrid.tsx` incluem **13 linhas que não são minhas**: a prop `error`, a
remoção da `onRetry` morta e a guarda do estado vazio — trabalho de **`WEB-005`**, já pendente no
working tree quando comecei. As minhas são **exatamente duas**, isoláveis por âncora:

```
git diff -U0 -- apps/web/src/components/CalendarGrid.tsx | grep -E "^[+-]" | grep -E "monthLong|monthLabel|import \{ dateLong"
-import { dateLong, money, relativeDate, today } from '../lib/format';
+import { dateLong, monthLong, money, relativeDate, today } from '../lib/format';
-  const monthLabel = dateLong(`${month}-01`).replace(/^1 de /, '').replace(/^1 /, '');
+  const monthLabel = monthLong(`${month}-01`);
```

Em `format.ts` o diff é **integralmente meu** e **integralmente comentário** — verificado por
filtro que exclui linhas de comentário: **nenhuma linha executável** mudou (`dateLong`, `dateShort`,
`monthLong`, `weekday`, `dateRange`, `monthBounds` e os formatadores estão intactos).

---

## 3. Comportamento antes/depois

| Critério de aceitação (ROADMAP §5.3) | Antes | Depois |
| --- | --- | --- |
| o título mostra `setembro de 2026` | `01/09/2026` | **`setembro de 2026`** |
| os `replace` mortos desaparecem | 2 `replace` inalcançáveis | **expressão substituída por `monthLong`** |
| o `aria-label` da grelha acompanha | `Calendário de 01/09/2026` | **`Calendário de setembro de 2026`** |
| nenhuma outra data do ecrã muda de formato | `dd/MM/yyyy` nas células | **inalterado** |

O `aria-label` da grelha (`CalendarGrid.tsx:141`) deriva do **mesmo** `monthLabel`, pelo que
acompanhou sem alteração própria — e há agora **dois** testes que fixam essa ligação: um de
igualdade (`Calendário de setembro de 2026`) e um de **coerência** (§4.1).

### 3.1 Destino de `monthLong` — **decidido**

O critério do ROADMAP pedia «decidir o destino de `monthLong`, exportado e sem consumidor». A
decisão é: **passa a ter consumidor** (o cabeçalho). Não foi removida nem duplicada. Isto é o que
fecha a segunda metade de `PC-17`. **Não foi criado nenhum formatter novo** — o requisito
«não criar um segundo formatter se `monthLong()` já cumprir» está cumprido: `monthLong` já existia
e já estava exportada.

---

## 4. Testes executados e resultados reais

`apps/web/test/calendar-month-label.test.tsx` — **334 linhas, 19 testes, 6 grupos**.

| Grupo | Testes | O que fixa |
| --- | --- | --- |
| `título do mês no cabeçalho do calendário` | 4 | o título é o mês por extenso; não é `01/09/2026`; não contém `dd/MM/yyyy`; acompanha o mês pedido (set/jan/dez); convive com as datas dos dias |
| `a alteração do mês apresentado` | 3 | **a transição**: set→out muda o título e os dois são diferentes; **passagem de ano** (2026-12 → 2027-01); **os 12 meses** de 2026, todos certos e todos distintos |
| `nome acessível da grelha` | 3 | `Calendário de setembro de 2026`; não repete a data; **coerência** — o rótulo é comparado com o título do mesmo render |
| `os restantes formatos de data` | 1 | **invariante**: as células continuam a mostrar `dd/MM/yyyy` |
| `os restantes formatadores de data não mudaram` | 5 | `dateLong`, `dateShort`, `weekday`, `dateRange` e o contrato de `monthLong` |
| `monthLong` | 3 | literais (`setembro de 2026`, `janeiro de 2026`); `null`/`undefined` → `—`; e `monthLong(x) !== dateLong(x)` |

### 4.1 O que o teste distingue, explicitamente

O pedido exigia que os testes distingam o comportamento antigo do novo, e que um teste que só
verifique «existe texto» **não** sirva. Cada requisito tem uma asserção que só passa com o
comportamento novo:

| Requisito | Asserção | Passa com o código antigo? |
| --- | --- | --- |
| o título é `setembro de 2026` | igualdade com o literal **+** `not.toBe('01/09/2026')` | **não** |
| o mês não está hardcoded | 3 meses + os 12 meses, com `new Set(titulos).size === 12` | **não** |
| a alteração do mês muda o título | dois renders, títulos **diferentes** | **não** |
| a passagem de ano não erra | `2026-12` → `dezembro de 2026`; `2027-01` → `janeiro de 2027` | **não** |
| o `aria-label` é coerente | `rotuloDaGrelha(html) === \`Calendário de ${tituloDoMes(html)}\`` | **sim** ⚠ |
| os restantes formatadores não mudaram | 5 asserções de igualdade sobre literais | sim (é invariante) |

⚠ **Honestidade sobre a coerência:** o teste de coerência **passa com o código antigo** — porque o
rótulo e o título derivam ambos do mesmo `monthLabel`, e com o defeito os dois dizem a mesma coisa
errada (`Calendário de 01/09/2026`). Ele prova que **não discordam**, não que estejam certos. Por
isso **não** substitui as asserções do título: as duas famílias são necessárias. Isto está escrito
no próprio ficheiro de teste.

### 4.2 As extrações falham alto

O título e o rótulo são extraídos por expressão regular, e o helper **lança** quando o padrão não
casa — em vez de devolver `''`. Sem isso, uma mudança de classe (`z-card__title`) faria as
asserções passarem sobre uma cadeia vazia: um falso verde silencioso, que é o pior resultado
possível num teste que existe para fixar texto.

### 4.3 Linha de base: o teste **contra o código pré-correção**

Reverti **exatamente as duas linhas** que a correção mudou (com um script que exige que cada âncora
ocorra 1 vez e **aborta antes de escrever** se não ocorrer), e corri o teste final:

```
estado pré-correção reposto — sha256 ce93ac850f25ca049fea87108e0d3d518add679195611e6516da84fd6f2043d5

exit=1  testes=19  passados=10  falhados=9
```

Os 9 vermelhos são **os 9 que dependem da correção**:

```
1. título do mês… mostra o mês por extenso, e não a data do primeiro dia
2. título do mês… não deixa nenhuma data no título
3. título do mês… acompanha o mês pedido, em meses diferentes
4. título do mês… convive com as datas dos dias, que continuam a ser datas
5. a alteração do mês apresentado muda o título quando o mês apresentado muda
6. a alteração do mês apresentado acerta na passagem de ano
7. a alteração do mês apresentado produz o mês certo em todos os 12 meses, e nenhum repetido
8. nome acessível da grelha diz o mês por extenso, como o título visível
9. nome acessível da grelha não repete a data que o título deixou de mostrar
```

O `sha256` do ficheiro revertido é **`ce93ac85…`**, o mesmo valor registado na sessão anterior —
ou seja, a reversão reproduziu o estado pré-correção **byte a byte**. Depois da medição, o ficheiro
foi reposto e o `sha256` confirmado (`7c03dcca…`).

| Momento | Código | Teste | Resultado |
| --- | --- | --- | --- |
| linha de base | pré-correção (`ce93ac85…`) | 19 testes | **9 falhados / 10 passados**, exit 1 |
| correção aplicada | corrigido (`7c03dcca…`) | 19 testes | **19 passados / 0 falhados**, exit 0 |

### 4.4 Suíte web (regressão)

```
Test Files  10 passed (10)
     Tests  228 passed (228)
```

`exit 0`. **Nenhum teste existente mudou de cor** — eram 219 em 10 ficheiros antes deste trabalho,
e os +9 são os novos casos deste ficheiro (10 → 19).

### 4.5 Typecheck

| Verificação | Comando | Resultado |
| --- | --- | --- |
| Web (projeto) | `tsc -p apps/web/tsconfig.json --noEmit` | **exit 0** |
| Teste novo (`PC-15`) | `tsc -p <scratch>/tsconfig.web010.json --listFiles` | **exit 0**, 292 ficheiros no programa, o teste presente |

**`PC-15`:** `apps/web/tsconfig.json` tem `"include": ["src", "vite.config.ts", "vite-env.d.ts"]` —
**`test/` está fora**. Um `typecheck` verde não diz nada sobre o ficheiro de teste novo, e um teste
que não compila é um teste que não corre. Verificado com um `tsconfig` restrito, **fora do
repositório**, com `typeRoots` e `paths` absolutos.

**O verificador morde — provado, não afirmado.** Injetei um erro de tipo deliberado
(`renderMes('2026-09')` → `renderMes(2026)`) e confirmei que é reportado:

```
apps/web/test/calendar-month-label.test.tsx(190,44): error TS2345: Argument of type 'number'
  is not assignable to parameter of type 'string'.

exit do tsc com o erro : 2
sha256 reposto          : 166e5e0bd64ad94e4dbe20996da8a2d49a4eea3627aab405f3a3f44d128b6e83
reposição correta       : true
```

A injeção usa uma âncora que o script exige ocorrer **exatamente uma vez** e **aborta antes de
escrever** se não ocorrer.

---

## 5. Prova por mutação — 6 mutações, 6 mortas

Cada mutação repõe um defeito real num ficheiro-fonte, corre o teste, registra **exatamente que
testes ficam vermelhos**, **restaura** o ficheiro e confirma o `sha256`. Lido do reporter **JSON**.

| # | Mutação | Mortos | Restauro |
| --- | --- | --- | --- |
| **M1** | repõe o **defeito original** (`dateLong` + os dois `replace` mortos) | **9/19** | ok |
| **M2** | degradação do formatador (`MONTH_FORMATTER month: 'long'` → `'short'`) | **9/19** | ok |
| **M3** | o título deixa de derivar do mês (passa a constante) | **5/19** | ok |
| **M4** | o `aria-label` deixa de derivar do título (passa a usar `dateLong`) | **3/19** | ok |
| **M5** | **INVARIANTE** — `DATE_FORMATTER month: 'short'` → `'long'` (o `dateLong` passa a dizer o mês) | **4/19** | ok |
| **M6** | `monthLong` ignora o argumento (devolve sempre setembro) | **5/19** | ok |

```
=== RESUMO ===
mutações: 6   mortas: 6   sobreviventes: 0
problemas (âncora/reposição): 0
```

O que cada uma prova:

- **M1** — o teste apanha a regressão exata que `WEB-010` corrige, e apanha-a **nove vezes**.
- **M2** — o teste não está preso à implementação: apanha a degradação do `long` → `short`, que é
  o **mecanismo** do defeito, mesmo com o cabeçalho a chamar `monthLong`.
- **M3** — **cirúrgica sobre o título**: mata os 3 testes da alteração do mês, o dos 12 meses e a
  **coerência** (com o título constante, o rótulo deixa de lhe corresponder). Prova que a coerência
  não é redundante com M4.
- **M4** — **cirúrgica sobre o `aria-label`**: mata exatamente os **3** testes do nome acessível.
- **M5** — mata o **invariante** (as células e os formatadores), e é isso que se queria: ele morre
  precisamente quando «os restantes formatadores de data» mudam, que é a única coisa que promete
  vigiar. E **não** morre em M1/M2/M3/M4/M6, o que mostra que é independente do cabeçalho.
- **M6** — prova que os testes de «não está hardcoded» mordem: com a função a devolver sempre o
  mesmo, o teste dos 12 meses e o da passagem de ano falham.

Reposição verificada no fim das seis:

```
sha256 final == sha256 inicial: true
  CalendarGrid.tsx: 7c03dcca75a606c6a990d9a85bd59a8378cea93a47a24ea32a460cba48083eff
  format.ts      : 93e823cf83e92e58f4ecd50b4ae9194794ebc3b69e6242eaf22744640cbfecdb
```

> **Nota de honestidade sobre o harness.** A primeira versão do script de mutação, na sessão
> anterior, fazia *parsing* das linhas `×` do reporter `verbose`. Não leu nada — e imprimiu
> `invariante=vivo` para **todas** as mutações com base numa lista vazia: um falso verde produzido
> pelo próprio instrumento da prova. Foi reescrito para ler o `status` de cada teste em JSON, e a
> versão de hoje exige também que a mutação **tenha corrido** (`numTotalTests > 0`) antes de a
> declarar sobrevivente — um leitor que lança reporta `0 testes`, e isso não é «passou». Os números
> acima são dessa versão.

---

## 6. Limitações

### 6.1 A aritmética do `shiftMonth` **não** está provada

O mês apresentado é o `month` do componente, e o `CalendarPage` alimenta-o a partir do URL
(`?mes=YYYY-MM`, `onMonthChange={setMonth}`). É por isso que a «alteração do mês» é observável **no
prop**, e é isso que os testes provam: para o mês que essa aritmética produz, o título é o certo —
incluindo na passagem de ano, que é o caso em que a aritmética erra por reflexo.

**O que não está provado:** a aritmética do `shiftMonth` (o `‹`/`›` a somar/subtrair 1 ao mês) vive
dentro do componente e **não é observável sem DOM** — o `renderToStaticMarkup` devolve HTML, sem
manipuladores, e o projeto proibiu `jsdom`. Não a afirmo como provada. Prová-la exigiria extrair a
aritmética para uma função pura (o padrão de `src/lib/tabs.ts`), o que é alteração de produção fora
do âmbito de uma correção de **formato** — fica registado como opção, não como feito.

### 6.2 O comportamento depende do ICU

Os valores de `Intl` são do ambiente (`ICU 78.2`), não do repositório. O teste afirma **literais**
de propósito: se o CLDR do `pt-PT` mudar, é este teste que deve falhar — e deve, porque nesse dia o
cabeçalho mudou para quem usa a aplicação. Está escrito no docblock do teste, ao lado da razão pela
qual `page-states.test.tsx` faz o oposto (lá prova-se um estado, não um texto).

### 6.3 O que não foi feito

- Não foi tocado `docs/ROADMAP.md` (nenhuma linha, nenhuma renumeração).
- Não foi tocado `packages/shared`, a API, o mobile, nem `WEB-008` (`theme.css`/`app.css` intactos).
- Não foi corrigido o **segundo sítio** do mesmo defeito — ver §7.1 (`PC-44`). É âmbito de outra
  superfície (linha temporal, não calendário), e §1.2 diz para não esconder trabalho extra dentro
  de uma tarefa.
- Não foi corrigido o `minWidth` do título — ver §7.2 (`PC-45`).
- Não foi corrigido o docblock do `dateRange` — ver §7.3 (`PC-48`).
- Sem commit, sem push, sem deploy.

### 6.4 Resíduos

Os scripts de medição e prova (`mutar.mjs`, `baseline.mjs`, `sensibilidade.mjs`, a sonda do segundo
sítio, os JSON do reporter, a matriz e as cópias de segurança) ficam **fora do repositório**:

```
C:\Users\marti\AppData\Local\Temp\zemlo-web010\
C:\Users\marti\AppData\Local\Temp\zemlo-web-tscheck\
```

A sonda temporária do `PC-44` foi **criada em `apps/web/test/`, corrida e imediatamente movida para
fora** — o `git status` de `apps/web/test/` não ganhou nenhuma entrada por causa dela. O único
ficheiro novo no repositório é o teste do `WEB-010`. Não foi usada a Reciclagem (bloqueada por
política neste ambiente) nem `rm`.

---

## 7. Achados novos — **propostos a A9, não tratados**

### 7.1 `PC-44` · O **mesmo** defeito num segundo sítio: o cabeçalho da linha temporal

`records.tsx:361` tem a expressão gémea, com a mesma premissa errada escrita no comentário:

```ts
function monthName(month: string): string {
  const label = dateLong(`${month}-01`);
  // «1 de setembro de 2026» → «setembro de 2026»; o dia não interessa num cabeçalho de mês.
  return label.replace(/^1 de /, '').replace(/^1 /, '');
}
```

`monthName` é privada, mas alimenta `groupByMonth` (`records.tsx:342`, `:348`), que é
**exportada** e consumida em **duas** páginas:

- `apps/web/src/pages/TimelinePage.tsx:61`
- `apps/web/src/pages/vehicles/VehicleDetailPage.tsx:846`

**Medido** (sonda temporária, corrida hoje e depois removida), e não inferido:

```
SONDA groupByMonth:
  2026-09 -> "01/09/2026"
  2026-10 -> "01/10/2026"

SONDA dateLong("2026-09-01")  = "01/09/2026"
SONDA monthLong("2026-09-01") = "setembro de 2026"
SONDA o rótulo de setembro é uma data? true
```

Ou seja: os cabeçalhos de mês da linha temporal mostram `01/09/2026` onde deviam ler-se
`setembro de 2026`. É **o mesmo defeito de `PC-17`**, noutra superfície — e a correção é a mesma
(`monthLong`), mas o âmbito é outro ecrã.

**Porque não corrigi:** `WEB-010` é o **calendário**; isto é a linha temporal, com dois
consumidores noutras páginas. Corrigir aqui seria trabalho extra escondido dentro da tarefa
(§1.2), e mudaria duas páginas fora do âmbito declarado. **O `PC-44` está reservado a esta
proposta** pela consolidação de A9 de 2026-09-23.

### 7.2 `PC-45` · O `minWidth: '9ch'` do título do calendário ficou curto

O `span` do título tem `style={{ minWidth: '9ch', textAlign: 'center' }}`
(`CalendarGrid.tsx:115`). Medido hoje, para os 12 meses de 2026:

| | comprimentos | constante? | excede `9ch`? |
| --- | --- | --- | --- |
| **antes** (`dateLong`) | `[10]` | **sim** | **12 de 12** |
| **depois** (`monthLong`) | `[12, 13, 14, 15, 16, 17]` | **não** | **12 de 12** |

`maio de 2026` = 12, `janeiro de 2026` = 15, `fevereiro de 2026` = 17. Consequência: a largura do
título deixou de ser constante, e os botões `‹`/`›` deslocam-se horizontalmente até 5 caracteres ao
navegar entre meses. Nota: o `minWidth` de `9ch` **já era inerte antes** (a data tem 10
caracteres), pelo que o defeito não foi *criado* por `WEB-010` — mas ficou mais visível.

**Porque não corrigi:** isto é consistência visual no mesmo ecrã de `WEB-008`, e o ROADMAP diz
explicitamente para não tocar em `WEB-008` sem coordenar. Não é um formato de data, e não é código
morto resultante desta alteração. Vai proposto, para A9 decidir — e A9 pode preferir **dobrá-lo
dentro de `WEB-008`** em vez de abrir tarefa nova. **O `PC-45` está reservado a esta proposta.**

### 7.3 `PC-48` · O docblock do `dateRange` documenta uma saída que o `pt-PT` **não** produz

`format.ts:237` diz:

```ts
/** Intervalo `1 set 2026 — 30 set 2026`, encurtado quando partilham o mês ou o ano. */
export function dateRange(from: CivilDate | null, to: CivilDate | null): string {
```

A saída real é `01/09 — 30/09/2026` — **medida** pelos testes novos (§4). É a **mesma família** do
docblock do `dateLong` que `WEB-010` corrigiu (`16 set 2026`): um comentário que descreve uma saída
que o CLDR do `pt-PT` não produz, e que é uma armadilha para quem o reutilizar.

**Porque não corrigi:** não é premissa deste defeito — o do `dateLong` era, porque foi o comentário
errado que levou ao `replace` errado. Este é um comentário falso **independente**, e o pedido foi
explícito: um defeito novo fora do âmbito não se corrige em silêncio, documenta-se. `PC-48` porque
`PC-44`/`PC-45` estão reservados a esta proposta e `PC-46`/`PC-47` foram alocados à de `WEB-011`.

> **Nota sobre a numeração.** O maior `PC-*` no ROADMAP é `PC-47`. Esta proposta propõe `PC-44` e
> `PC-45` (reservados por A9) e `PC-48` — com folga deliberada de `PC-46`/`PC-47`, que já existem,
> pela regra do `PC-18`: quem alocar o «máximo + 1» a partir do máximo não colide com esta linha.

---

## 8. Confirmação: o ROADMAP **não** foi alterado

| Verificação | Valor |
| --- | --- |
| `sha256` de `docs/ROADMAP.md` **antes** do meu trabalho (10:04) | `4ec8f0b73c59db1697420405696cab7255224a6cdfe531d47e860cb5b5b3d5f3` |
| `sha256` de `docs/ROADMAP.md` **depois** do meu trabalho | `4ec8f0b73c59db1697420405696cab7255224a6cdfe531d47e860cb5b5b3d5f3` |
| mtime | `2026-09-23 09:58:36` — **anterior** ao início da minha sessão (10:04) |

**Nenhuma linha foi alterada, nenhum ID foi renumerado, nenhuma tarefa foi reescrita.** A
consolidação é de A9. Os blocos da §9 são **propostas**, não aplicações.

---

## 9. Blocos propostos para integração no ROADMAP (a aplicar **por A9**)

### 9.1 Fecho de `WEB-010` — §5.3, substitui o corpo

```markdown
#### WEB-010 · Cabeçalho do calendário mostra data em vez do nome do mês — A3 · P3 · `DONE`

- **Descrição:** ver `PC-17`. O título do mês em `CalendarGrid` era construído com `dateLong()`
  mais dois `replace` que nunca casavam, porque o CLDR do `pt-PT` resolve
  `{day:'2-digit', month:'short', year:'numeric'}` para `dd/MM/y`. Resultado: `01/09/2026` onde
  devia ler-se `setembro de 2026`.
- **Objetivo:** o cabeçalho do calendário mostra o mês por extenso, como o produto sempre quis.
- **Dependências:** —
- **Critérios de aceitação:** o título mostra `setembro de 2026`; os `replace` mortos
  desaparecem; o `aria-label` da grelha acompanha; nenhuma outra data do ecrã muda de formato.
  **Os quatro cumpridos.**
- **Implementação:** `CalendarGrid.tsx:97` passa a `monthLong(\`${month}-01\`)` (**2 linhas**
  alteradas, com o `import`). `monthLong` deixa de estar sem consumidor — **o destino que
  `PC-17` pedia para decidir é este**: passa a ter consumidor, não é removida, e **nenhum
  formatter novo foi criado**. Em `format.ts` o `docblock` de `dateLong` (que documentava
  `16 set 2026`, saída que o `pt-PT` **não** produz) foi corrigido para `01/09/2026`, e ficou
  registada a razão pela qual `month: 'short'` degrada para `2-digit` quando o esqueleto inclui
  o ano. **Zero linhas executáveis mudaram em `format.ts`.**
- **Testes:** `apps/web/test/calendar-month-label.test.tsx` — **19 testes**, 6 grupos: título
  (4), **alteração do mês apresentado** (3, incluindo a passagem de ano e os 12 meses), nome
  acessível (3, incluindo a **coerência** rótulo↔título), **invariante** dos formatos de data
  (1), **os restantes formatadores** (5), `monthLong` (3). As asserções são sobre **literais**,
  nunca sobre `monthLong(...)`; as extrações **lançam** quando o padrão não casa
  (anti-falso-verde). Medido contra o código pré-correção (as 2 linhas revertidas, `sha256`
  `ce93ac85…`, igual ao estado pré-correção): **9 falhados / 10 passados**, exit 1; com a
  correção: **19 passados**. **Nota:** esta asserção é sobre texto formatado por `Intl`, ao
  contrário das de `page-states.test.tsx`, que são estruturais de propósito — se o `CLDR` do
  `pt-PT` mudar, é este teste que deve falhar, e é por isso que ele aqui faz sentido.
- **Prova por mutação:** **6 mutações, 6 mortas, 0 sobreviventes**, `sha256` reposto e
  verificado, lidas do reporter **JSON**. M1 (o defeito original) mata **9/19**; M2 (o
  formatador degradado para `short`) mata **9/19**; M3 (título constante) mata 5/19, incluindo a
  coerência; M4 (`aria-label` deixa de derivar do título) mata **exatamente 3/19**, cirúrgica;
  M5 (`DATE_FORMATTER` passa a dizer o mês) mata o **invariante**, provando que não é vazio; M6
  (`monthLong` ignora o argumento) mata os testes de «não está hardcoded». O invariante **não**
  morre em M1–M4 nem em M6.
- **Verificação:** `typecheck` web exit 0; suíte web **228 testes / 10 ficheiros**, exit 0. O
  teste novo está **fora** do `typecheck` do projeto (`PC-15`), pelo que foi verificado com um
  `tsconfig` restrito fora do repositório (exit 0, 292 ficheiros no programa, o teste presente),
  e esse verificador foi provado **sensível** (erro de tipo injetado → `TS2345`, exit 2, reposto
  por `sha256`).
- **Limitação declarada:** a aritmética do `shiftMonth` (o `‹`/`›`) **não** é observável sem DOM
  e **não** está provada; o que se prova é que, para o mês que ela produz, o título é o certo. O
  teste de **coerência** rótulo↔título passa **também** com o código antigo (os dois dizem a
  mesma coisa errada), pelo que não substitui as asserções do título.
- **Contratos:** `packages/shared` **intocado**. Impacto nenhum em API e mobile.
- **Ficheiros:** `apps/web/src/components/CalendarGrid.tsx` (**2 linhas**),
  `apps/web/src/lib/format.ts` (só comentários),
  `apps/web/test/calendar-month-label.test.tsx` (novo).
- **Achados que saíram daqui:** `PC-44` (o mesmo defeito na linha temporal), `PC-45` (o
  `minWidth` do título) e `PC-48` (o docblock falso do `dateRange`).
- **Commit:** **não feito** — sem autorização explícita de publicação. Nada foi publicado.
```

### 9.2 Fecho de `PC-17` — §2, substitui a coluna de estado

```diff
-| Baixa | Aberto — `WEB-010` |
+| Baixa | **Resolvido** — `WEB-010` `DONE` (2026-09-23). Medição de A3 acrescentou a causa exata: a degradação de `month:'short'` para `2-digit` é provocada **pelo ano** no esqueleto (`{month:'short', year:'numeric'}` → `09/2026`), e sem ano o nome curto sobrevive (`{month:'short'}` → `set.`) — logo os `replace` nunca poderiam casar com nenhum esqueleto do módulo. `monthLong` é a **única** forma de obter o nome do mês em `pt-PT`, e passou a ter consumidor. Linhas: a zona das datas em `format.ts` passou de `153-168` para `142-199`. |
```

### 9.3 Novas linhas `PC-44`, `PC-45` e `PC-48` — §2, a acrescentar ao fim da tabela

```markdown
| PC-44 | **O mesmo defeito de `PC-17` num segundo sítio: o cabeçalho de mês da linha temporal.** `monthName()` (`apps/web/src/components/records.tsx:361`) faz `dateLong(\`${month}-01\`).replace(/^1 de /, '').replace(/^1 /, '')` — a expressão gémea de `CalendarGrid.tsx:97`, com a mesma premissa errada no comentário («1 de setembro de 2026»). Alimenta `groupByMonth` (`:342`, `:348`), que é **exportada** e consumida em `TimelinePage.tsx:61` e `VehicleDetailPage.tsx:846`. **Medido** (sonda temporária, removida depois): `groupByMonth` produz `2026-09 -> "01/09/2026"` e `2026-10 -> "01/10/2026"`, onde se quer `setembro de 2026` / `outubro de 2026`; `monthLong('2026-09-01')` → `setembro de 2026`. A correção é a mesma, mas o âmbito é **outro ecrã** (linha temporal, com dois consumidores) — não foi feita dentro de `WEB-010` (§1.2). **Deteção: A3, 2026-09-22, durante `WEB-010`; re-medido em 2026-09-23.** | `apps/web/src/components/records.tsx:342,348,361`; `apps/web/src/pages/TimelinePage.tsx:61`; `apps/web/src/pages/vehicles/VehicleDetailPage.tsx:846` | Baixa | Aberto — sem tarefa; candidata a `WEB-*` nova |
| PC-45 | **O `minWidth: '9ch'` do título do calendário é mais pequeno do que o rótulo que `WEB-010` introduziu.** `CalendarGrid.tsx:115` fixa `minWidth: '9ch'` no `span` do título. Medido para os 12 meses de 2026: **antes** (`dateLong`) o comprimento era **constante**, `[10]`; **depois** (`monthLong`) varia em `[12, 13, 14, 15, 16, 17]` (`maio de 2026` = 12, `fevereiro de 2026` = 17). Os 12 meses excedem `9ch` — e já o excediam antes, porque `01/09/2026` tem 10 caracteres, ou seja o `minWidth` **já era inerte**. Consequência: a largura do título deixou de ser constante e os botões `‹`/`›` deslocam-se até 5 caracteres ao navegar entre meses. É **consistência visual no ecrã de `WEB-008`**, que o ROADMAP manda não tocar sem coordenar; **A9 pode preferir dobrar isto dentro de `WEB-008`** em vez de abrir tarefa nova. **Deteção: A3, 2026-09-22; re-medido em 2026-09-23.** | `apps/web/src/components/CalendarGrid.tsx:115` | Baixa | Aberto — coordenar com `WEB-008` |
| PC-48 | **O docblock do `dateRange` documenta uma saída que o `pt-PT` não produz.** `apps/web/src/lib/format.ts:237` diz `/** Intervalo \`1 set 2026 — 30 set 2026\`, encurtado quando partilham o mês ou o ano. */`, mas a saída real é `01/09 — 30/09/2026` (medida pelos testes de `WEB-010`: `dateRange('2026-09-01','2026-09-30')` → `01/09 — 30/09/2026`, `dateRange('2026-09-01','2026-10-31')` → `01/09 — 31/10/2026`, `dateRange('2026-09-01','2027-03-31')` → `01/09/2026 — 31/03/2027`). É a **mesma família** do docblock do `dateLong` que `WEB-010` corrigiu (`16 set 2026`): um comentário que descreve uma saída que o CLDR do `pt-PT` não produz, e que é uma armadilha para quem o reutilizar. **Não corrigido:** não é premissa deste defeito (o do `dateLong` era — foi o comentário errado que levou ao `replace` errado), e um defeito novo fora do âmbito documenta-se em vez de se corrigir em silêncio. **Deteção: A3, 2026-09-23, ao escrever os testes dos restantes formatadores.** | `apps/web/src/lib/format.ts:237` | Baixa | Aberto — comentário falso, sem impacto de comportamento |
```

### 9.4 Tabela de tarefas — §4

```diff
-| WEB-010  | Web          | Cabeçalho do calendário mostra data em vez do mês                      | A3     | P3         | `READY`    | —                       |
+| WEB-010  | Web          | Cabeçalho do calendário mostra data em vez do mês                      | A3     | P3         | `DONE`     | —                       |
```

### 9.5 Fila de A3 — §9

```diff
-| 5     | `WEB-010` — Mês no cabeçalho do calendário | P3        | `READY` — aberto por `PC-17`          |
+| —     | `WEB-010` — Mês no cabeçalho do calendário | P3        | **`DONE`** (2026-09-23) — 2 linhas, 19 testes, 6 mutações |
```

**Nota para A9:** o parágrafo de contagem que se segue à tabela diz hoje **sete** `DONE`. Com este
fecho passa a **oito** (`WEB-005`, `WEB-006`, `MOB-001`, `WEB-001`, `WEB-002`, `WEB-003`, `WEB-011`,
`WEB-010`). A §9 continua a **não** listar `WEB-002`, lacuna que a consolidação de 2026-09-23 já
registou e que **não** corrijo (é tabela de A9).

### 9.6 Entrada de changelog — fim de §13

```markdown
| 2026-09-23 | A3 · `WEB-010` **concluída e re-verificada**: o título do mês no cabeçalho do calendário passa a usar `monthLong` (`CalendarGrid.tsx:97`) — **2 linhas** alteradas, os dois `replace` mortos desaparecem, o `aria-label` da grelha acompanha (`Calendário de setembro de 2026`) e nenhuma outra data do ecrã muda de formato. Em `format.ts` **só comentários**: o `docblock` de `dateLong` documentava `16 set 2026`, saída que o `pt-PT` **não** produz, e ficou registada a causa exata medida (ICU 78.2) — `month: 'short'` degrada para `2-digit` **por causa do ano** no esqueleto (`{month:'short', year}` → `09/2026`), e sem ano o nome curto sobrevive (`{month:'short'}` → `set.`), pelo que os `replace` nunca poderiam casar com nenhum esqueleto do módulo. `monthLong` passa a ter consumidor — **nenhum formatter novo foi criado**. `apps/web/test/calendar-month-label.test.tsx` — **19 testes**, 6 grupos, incluindo **a alteração do mês apresentado** (transição, passagem de ano e os 12 meses, com `Set` de 12 títulos distintos para provar que não está hardcoded), a **coerência** rótulo↔título e **os restantes formatadores** (`dateLong`, `dateShort`, `weekday`, `dateRange`). Medido contra o código pré-correção (as 2 linhas revertidas, `sha256` `ce93ac85…`): **9 falhados / 10 passados**, exit 1; com a correção: **19 passados**. **6 mutações, 6 mortas, 0 sobreviventes** (M1 mata 9/19; M2 9/19; M3 5/19 incluindo a coerência; M4 **exatamente 3/19** — cirúrgica; M5 mata o **invariante**; M6 mata os testes de «não hardcoded»), ficheiros-fonte repostos e verificados por `sha256`. `typecheck` web exit 0; suíte web **228 testes / 10 ficheiros** exit 0; o teste novo está fora do `typecheck` do projeto (`PC-15`) e foi verificado com `tsconfig` restrito (exit 0, 292 ficheiros), com o verificador provado **sensível** (`TS2345`, exit 2). **Limitações declaradas:** a aritmética do `shiftMonth` não é observável sem DOM e **não** está provada; e o teste de coerência passa **também** com o código antigo (rótulo e título dizem a mesma coisa errada), pelo que não substitui as asserções do título. Contrato `packages/shared` **intocado**; impacto nenhum em API e mobile. **`PC-17` resolvido**; abertos **`PC-44`** (o mesmo defeito na linha temporal — `groupByMonth` produz `01/09/2026`, medido), **`PC-45`** (o `minWidth: '9ch'` do título — coordenar com `WEB-008`) e **`PC-48`** (o docblock do `dateRange` documenta `1 set 2026`, saída que o `pt-PT` não produz). `WEB-010` → `DONE`. Sem commit. |
```

---

## 10. Verificação das afirmações (feita, não assumida)

| Afirmação | Como foi verificada |
| --- | --- |
| o `pt-PT` degrada `month:'short'` para `2-digit` | `Intl` + `resolvedOptions()`, ICU 78.2, Node v22.22.2, tabela em §1.1 |
| a degradação é causada **pelo ano** | `{month:'short'}` → `set.` vs `{month:'short', year}` → `09/2026` |
| nenhum outro agente tocou nos ficheiros | mtimes `2026-09-22 22:58:56` para `CalendarGrid.tsx` e `format.ts` — inalterados desde a minha escrita |
| o teste **falha** no código original | 2 linhas revertidas → **9 falhados / 10 passados**, exit 1 |
| o código revertido era mesmo o original | `sha256` = `ce93ac85…`, igual ao valor registado pré-correção |
| o teste passa com a correção | **19 passados / 19**, exit 0 |
| a suíte não regrediu | **228 passados / 10 ficheiros**, exit 0 |
| as mutações matam | **6/6 mortas**, 0 sobreviventes, lidas do reporter **JSON** |
| as mutações repõem | `sha256` dos dois ficheiros igual ao inicial, no fim das seis |
| o invariante não é vazio | M5 mata-o; M1–M4 e M6 **não** |
| o título não está hardcoded | M3 e M6 matam-no; e o teste dos 12 meses exige 12 títulos distintos |
| o mês **muda** com o apresentado | teste da transição: dois renders, títulos diferentes |
| o `aria-label` é coerente | teste de coerência: `rótulo === \`Calendário de ${título}\`` no mesmo render |
| os restantes formatadores não mudaram | 5 asserções de igualdade sobre literais + o invariante das células |
| `format.ts` não mudou comportamento | diff contra `HEAD` **integralmente comentário**; filtro de linhas não-comentário devolve **vazio** |
| `CalendarGrid.tsx` mudou **2 linhas** | `git diff -U0 \| grep -E "monthLong\|monthLabel\|import \{ dateLong"` — só o `import` e o `monthLabel` |
| o typecheck cobre o teste | **não** cobre (`PC-15`); verificado com `tsconfig` restrito, 292 ficheiros no programa |
| o verificador restrito morde | erro de tipo injetado → `TS2345` (linha 190), exit 2, reposto por `sha256` |
| o segundo sítio existe e produz uma data | sonda temporária: `groupByMonth` → `"01/09/2026"`, depois removida do repo |
| o `minWidth` já era inerte antes | 12 de 12 meses excediam `9ch` também com `dateLong` (comprimento 10) |
| `packages/shared` intocado | não foi tocado; `git status` sem entradas minhas lá |
| o ROADMAP não foi alterado | `sha256` `4ec8f0b7…` igual antes e depois; mtime `09:58:36`, **anterior** ao início da sessão |
| o working tree não ganhou resíduos meus | scripts e cópias em `%TEMP%`; `git status -- apps/web/test/` sem a sonda; o único ficheiro novo é o teste |

---

**Resumo de uma linha:** `WEB-010` troca 2 linhas em `CalendarGrid.tsx` e o título passa de
`01/09/2026` a `setembro de 2026`, com o `aria-label` coerente e nenhum outro formato de data
tocado; **19 testes** que mordem (**9 vermelhos** no código pré-correção), **6 mutações todas
mortas**, suíte web **228/228** e `typecheck` exit 0; propõe `PC-44`, `PC-45` e `PC-48`.
**Sem commit, sem push, sem deploy; ROADMAP intocado.**
