# Entrega de A1 a A9 — `AUD-010` (fecho)

> **Documento de entrega, não fonte de verdade.** A1 **não** editou `docs/ROADMAP.md` — a regra
> vigente é que só A9 o faz. O texto abaixo está pronto a integrar; depois de A9 integrar, este
> ficheiro pode ser apagado.
>
> **Estado dos IDs no momento da escrita** (2026-09-22, ~17:20): `PC-*` até `PC-34`, `AUD-*` até
> `AUD-015`, `OPS-*` até `OPS-006`. **Nenhum ID novo foi criado nem renumerado por A1 nesta
> entrega** — as tarefas novas de §7 vão descritas, sem ID atribuído.
>
> **`docs/ROADMAP.md` inalterado**: `sha256 2cd97a34f08b00f5a809026bf306aab0db18108bac7a5f5f9ef04d907dc4c8bf`.
>
> **Sem commit, sem push, sem deploy.**

---

## 1. A premissa da tarefa estava certa — e era maior do que a tarefa dizia

A especificação (`docs/ROADMAP.md:695-702`) diz:

> - **Descrição:** "27 tabelas" (são 29), "63 unitários" (são 1448), "30 rotas" (são 32).
> - **Critérios de aceitação:** os três números conferem com o repositório; existe um comando
>   único que os volte a medir, se possível.
> - **Ficheiros:** `README.md:19-22`.

Os três números estavam errados, como dizia. **Mas não eram três, e não estavam só em `:19-22`.**
Medido: **seis quantidades distintas, em doze ocorrências**, espalhadas por `:19`, `:21`, `:22`,
`:23`, `:97`, `:99`, `:131`, `:145`, `:147`, `:175` e `:307` — o cabeçalho, o bloco de comandos, a
árvore de ficheiros e a lista de documentação. Corrigir só as três primeiras linhas deixaria o
documento a contradizer-se a si próprio sete vezes.

E **dois dos números que a própria especificação dá como verdadeiros também estão errados**:

| Onde | Diz | Medido | Porquê |
| --- | --- | --- | --- |
| `ROADMAP.md:697` e `PC-7` (`:119`) | «são **32** rotas» | **31** | `App.tsx` tem 33 `path="…"`; os apanha-tudo são **dois**, não um (`:122` `NotFound` e `:198` reencaminhamento do onboarding). `33 − 1 = 32` conta mal. |
| `ROADMAP.md:697` e `PC-7` (`:119`) | «são **1448** testes» | **1841** | 1448 era o total da API numa altura anterior; hoje a API tem 1707 e a web 134. |

Isto não é uma correção ao trabalho de quem escreveu a tarefa — é a mesma deriva, a acontecer com
o documento que a descreve. `PC-7` é a prova de que o problema é sistémico e não de uma linha.

## 2. As medições, e o comando que as produz

Todas **executadas** nesta máquina em 2026-09-22 (suítes às 16:10, contagens às 17:05):

| Quantidade | README dizia | **Medido** | Onde está a verdade | Como foi medido |
| --- | --- | --- | --- | --- |
| Tabelas | 27 | **29** | `^model ` em `prisma/schema.prisma` **e** na variante SQLite | `scripts/check-readme-numbers.mjs` (estático) |
| Rotas da web | 30 | **31** | `path="…"` em `apps/web/src/App.tsx`, sem os 2 apanha-tudo | `scripts/check-readme-numbers.mjs` (estático) |
| Decisões | 30 | **31** | `^## A<n>` em `docs/DECISIONS.md` (última: `A31`) | `scripts/check-readme-numbers.mjs` (estático) |
| Testes automáticos (`npm test`) | 63 | **1 841** | API **1 707** + web **134** | `vitest run --reporter=json` em cada workspace |
| `verify` | 231 | **235** | `Resumo: 235 verificações passaram` | `npm run verify` |
| `verify:regressions` | 70 | **70** ✓ | `70 regressões confirmadas corrigidas` | `npm run verify:regressions` |
| `verify:config` | 12 | **12** ✓ | 12 guardas | `npm run verify:config` |
| `verify:integration` | 28 | **28** (derivado, não executado) | 23 pontos de `check(` − 2 dentro de ciclos + 4 + 3 = 28 | aritmética sobre `verify-integration.mjs` (§6) |
| `test/domain.test.ts` | 63 | **77** | 77 testes | `vitest run test/domain.test.ts` — **e** 77 ocorrências de `it(` no ficheiro, por via independente |

Os dois schemas concordam (`29 / 29`) — o SQLite é **gerado** e não estava dessincronizado. O
comando verifica isso explicitamente e falha se divergirem.

### A definição de «rotas», escrita em vez de subentendida

O número só é reproduzível se a definição estiver escrita. Ficou em `README.md` e no cabeçalho do
script: **atributos `path` com valor próprio em `App.tsx`, excluindo o apanha-tudo `path="*"`** —
que não é um ecrã, é o `NotFound`, e há um segundo no onboarding que reencaminha para a primeira
etapa. Excluem-se também o `index` (sem `path`, é um `Navigate`) e os `path=` dentro do `Routes`
aninhado do onboarding **não** se excluem (são ecrãs a sério: `conta`, `veiculo`, `pronto`).

*(Se se preferir contar «ecrãs distintos» em vez de «rotas», o `/auth/verify-email` é um alias do
`/verificar-email` e o número desce a 30 — que é, provavelmente, como o README chegou ao 30. É uma
decisão de definição, não um erro de contagem; está escrita para que a próxima pessoa não tenha de
a adivinhar. Ver §7.4.)*

## 3. O que mudou

| Ficheiro | Diff | Nota |
| --- | --- | --- |
| `README.md` | **+21 / −12** (16 020 B) | 12 ocorrências numéricas corrigidas (6 quantidades), 1 descrição corrigida, 2 blocos e 1 linha inseridos |
| `package.json` | **+1 / −0** (2 257 B) | `"readme:numbers": "node scripts/check-readme-numbers.mjs --check"` |
| `scripts/check-readme-numbers.mjs` | **novo** (12 937 B) | o «comando único» que o critério de aceitação pede |
| `.github/workflows/ci.yml` | **+6 linhas** (6 335 B) | passo novo no job `qualidade` — ver a nota abaixo |

`README.md` `sha256 46b59d75aabb242069636f736b6210d67d1b26d2c8455074d4fb46053d71f684`.
`package.json` `sha256 3e760da903b3f80b3f0636b9a9e76549d73627c71ad74c6ab97a5db3f6dea7d3`.
`scripts/check-readme-numbers.mjs` `sha256 1811a71e2e887a848ee6b6c0491773faaf82cc02e9dc3e3733f910f899984143`.

### 3.1 As doze correções numéricas

| Linha | Antes | Depois |
| --- | --- | --- |
| `:19` | `27 tabelas` | `29 tabelas` |
| `:21`, `:147` | `30 rotas` | `31 rotas` |
| `:22` | `63 unitários` · `231 ponta a ponta` | `1 841 automáticos` · `235 ponta a ponta` |
| `:23`, `:175`, `:307` | `30 decisões` | `31 decisões` |
| `:97` | `63 testes unitários do domínio` | `1 841 testes automáticos (API 1 707 · web 134)` |
| `:99`, `:131` | `231` | `235` |
| `:145` | `63 testes do domínio` | `77 testes do domínio` |

Duas correções que não são de números, mas são da mesma deriva — a frase descrevia uma coisa que
já não é verdade:

- `:239` — `| npm test | Testes unitários do domínio |` → `Testes automáticos: domínio, rotas HTTP
  e interface web`. `npm test` corre 43 ficheiros da API (muitos deles testes de rota HTTP, não
  unitários) mais 7 da web. A etiqueta «unitários do domínio» descrevia 63 dos 1 841.
- `:31-38` — **não tocado, de propósito**: o «223 verificações» é um total **histórico** («três
  defeitos… passaram por 223 verificações antes de serem encontrados»), uma afirmação sobre uma
  corrida passada e não sobre o repositório de hoje. Mudá-lo seria reescrever história. Está
  declarado como não-medível no relatório do comando, para não parecer esquecido.

### 3.2 A nota de proveniência

Acrescentada ao §Estado, para que a próxima pessoa saiba de onde vêm os números e o que o comando
**não** cobre:

> Os números desta tabela são **medidos** no repositório, não escritos de memória: `npm run
> readme:numbers` conta as tabelas dos dois schemas, as decisões e as rotas da web (atributos
> `path` com valor próprio em `apps/web/src/App.tsx`, sem o apanha-tudo do `NotFound`), e falha
> se este documento divergir. Os totais das suítes de verificação não são contados por ele —
> são reportados pelo próprio comando que os corre, e cada um tem o seu em «Verificar que tudo
> funciona», abaixo.

### 3.3 Nota sobre `.github/workflows/ci.yml` — alteração a um artefacto já entregue

**Isto merece decisão de A9, e reverte-se numa linha.** O ficheiro é o `ci.yml` que entreguei em
`OPS-001` (que V. aceitou como `DONE`). Acrescentei-lhe um passo:

```yaml
      - name: Números do README conferem com o repositório
        run: npm run readme:numbers
```

**Porque o fiz:** sem um guarda, este defeito volta. O comando existe, mas um comando que ninguém
corre não impede nada — e a classe de defeito de `AUD-010` é exatamente «ninguém deu por isso».
O passo é do género do vizinho (`verify:config`): não precisa de servidor nem de base de dados,
custa menos de um segundo, e falha o CI quando o README mentir.

**Se A9 preferir não tocar num artefacto aceite**, apagar as 6 linhas do passo e o `readme:numbers`
fica a correr só à mão — o resto da entrega não depende dele.

**Verificação feita:** o ficheiro continua em **CRLF** (150 `\r\n`, 0 `\n` — era 144 antes, e as
linhas novas usam o mesmo terminador; um ficheiro com linhas mistas seria pior do que qualquer das
convenções), e foi **analisado por um parser de YAML a sério** (PyYAML, instalado num ambiente
isolado fora do repositório): `PARSE: ok`, 2 jobs, `qualidade` com 8 passos, o oitavo com
`run: npm run readme:numbers`. `sha256 18d1eb48f3c1b817ea72ff18857bf9a7682db31ff313cd305af599bf451b4caa`.

## 4. Provas — o comando morde, e morde pelo sítio certo

O critério de aceitação pede um comando que **volte a medir**. Um comando que devolve `0` sempre
não mede nada. Provei-o por mutação, com quatro mutações em dois alvos diferentes: **três no
documento** e **uma no repositório** — esta última é a que importa, porque prova que o script
**mede** em vez de comparar com uma constante escrita nele.

| # | Alvo | Mutação | Saída observada | Exit |
| --- | --- | --- | --- | --- |
| — | repouso | — | tudo `✓` | **0** |
| **M1** | `README.md` (grupo medido) | `29 tabelas` → `28 tabelas` | `✗ tabelas: medido 29, declarado 28 (:19)` | **1** |
| **M2** | `README.md` (grupo de coerência) | um dos três `235 ponta a ponta` → `231` | `✗ ponta a ponta: 235 / 231 (3 declarações — :22, :107, :139)` | **1** |
| **M3** | `README.md` (cegueira) | `77 testes do domínio` → `77 testes de domínio` | `? testes do domínio: não encontrado no README` | **1** |
| **M4** | **`docs/DECISIONS.md`** | acrescentar `## A32` | `✗ decisões: medido 32, declarado 31 (:23, :183, :316)` | **1** |

Em todas, **só o grupo mutado ficou vermelho** — os outros mantiveram-se `✓`. É a diferença entre um
comando que vigia e um comando que grita.

Todas as mutações foram repostas e confirmadas por `sha256` idêntico ao baseline
(`README.md 46b59d75…`, `docs/DECISIONS.md 3145a498…`), e o `--check` final sai **0**.

### 4.1 O que a M3 encontrou — um defeito no meu próprio comando

A M3 não foi escrita para provar o script; foi escrita para o **tentar partir**, e partiu-o:

> Com a frase reescrita, o comando imprimia `? testes do domínio: não encontrado no README` e saía
> **com `0`**.

Ou seja: a primeira versão contava as divergências e **ignorava** o caso em que deixa de conseguir
vigiar. Um verificador que fica cego e sai verde é exatamente o falso verde que este trabalho
existe para eliminar — e estava no verificador que o ia eliminar. A lógica de saída foi corrigida,
com dois casos distintos de propósito:

- **divergência** (facto sobre o README) → `exit 1` só em `--check`, que é o que o CI corre; sem
  `--check` é um relatório que se lê;
- **valor não encontrado** (defeito **do comando**) → `exit 1` **sempre**, com ou sem `--check`:
  um estado em que o verificador é cego nunca é normal.

Repetida depois da correção, a M3 sai `1` nos dois modos. Está escrito no cabeçalho do script.

### 4.2 Como o comando foi validado antes de o usar

As 16 substituições ao README, ao `package.json` e ao `ci.yml` foram feitas por um script atómico
(fora do repositório) que **aborta antes de escrever** se cada âncora não ocorrer exatamente uma
vez. Na primeira execução, em modo de ensaio, ele **abortou** e não escreveu nada: a âncora do
`ci.yml` não casava porque o ficheiro está em **CRLF** e a âncora estava em LF. Foi apanhado antes de
tocar no ficheiro, e não depois.

## 5. O que **não** foi medido — declarado, não escondido

1. **`verify:integration` = 28 não foi executado.** Exige o build de produção com PostgreSQL e uma
   instância a servir a web (`OPS-006`), que está fora do âmbito. O que fiz foi **derivar** o número
   do próprio script: 23 pontos de `check(` menos 2 que estão dentro de ciclos, mais 4 iterações do
   ciclo dos URL profundos, mais 3 rotas da API = **28**. É consistente com o que o README diz, mas
   é uma derivação, não uma corrida. Fica como estava.
2. **Os totais das suítes foram medidos uma vez, à mão.** `npm test` leva **6 m 28 s**; medi-lo
   dentro do comando de um segundo transformaria o comando numa coisa que ninguém corre. O comando
   verifica apenas a **coerência interna** desses totais (o mesmo número em todos os sítios) e diz
   qual é o comando que reporta o valor verdadeiro. É por isso que `1 841` não é «medido» pelo
   script, e o relatório di-lo.
3. **Os totais descrevem a árvore de trabalho de 2026-09-22 16:10**, com alterações não publicadas
   de várias frentes presentes. Se outro agente acrescentar um teste, o número fica outra vez
   desatualizado — e é precisamente para isso que existe o passo de CI de §3.3. Ver §7.4.
4. **`docs/DECISIONS.md` foi mutado sem cópia de segurança prévia** (falha de processo minha, na
   primeira corrida da M4): o `cp` de reposição falhou em silêncio porque o backup não existia. Foi
   reposto procurando, entre seis terminadores possíveis, o **único** que reproduz o `sha256` do
   baseline — só `"\n"` o faz. Ficou idêntico, mas a lição é que a bateria de mutação tem de copiar
   **todos** os ficheiros que vai tocar, antes de tocar no primeiro.

## 6. Achados novos → propostas para A9 decidir

**Não criei tarefas no ROADMAP** (regra vigente) e **não atribuí IDs** (A9 atribui). Descrevo-as:

### 6.1 O mesmo número desatualizado vive num comentário de código

`apps/web/src/App.tsx:38` diz «com **trinta rotas**, uma tabela de configuração esconde mais do que
mostra». São **trinta e uma**. É o mesmo defeito de `AUD-010` num sítio que `AUD-010` não cobre — e
`App.tsx` não é ficheiro de A1. Fica para quem tem a frente da web, ou para uma tarefa própria de
âmbito documental. **Não toquei no ficheiro.**

### 6.2 `PC-34` não se reproduziu nesta corrida

`PC-34` registava «`oauth-google.test.ts`, timeout de hook a 60 s, 28 testes saltados, zero
asserções falhadas». Na corrida completa de 2026-09-22 16:10: `oauth-google.test.ts` → **28
passados**, `numPendingTests: 0`, `numFailedTests: 0`. O sintoma **não se reproduziu**.

Não fecho `PC-34` — não é meu, e «não se reproduziu uma vez» não é «está resolvido». Mas quem o
fechar (ou mantiver aberto) deve saber que a última medição não o mostra.

### 6.3 `PC-7` fecha, mas com dois números corrigidos no próprio texto

`PC-7` diz «27→29 tabelas, 63→**1448** testes, 30→**32** rotas». Ao fechá-lo, os dois segundos
números devem ser os medidos: **1841** testes e **31** rotas (§1). `PC-7` está anotado como «Aberto
— `DOC-001`»; **`DOC-001` deve permanecer `CANCELLED`**, pelo que o fecho é por `AUD-010`.

### 6.4 Decisão que não é minha: os totais das suítes devem continuar no README?

O README declara `1 841`, `235`, `70`, `12`, `28`. Quatro desses números vão envelhecer a cada teste
novo. Há duas saídas, e é uma decisão de produto, não técnica:

- **(a) manter os números** e confiar no passo de CI de §3.3 para os manter verdadeiros — é o que
  está feito;
- **(b) trocar os números por só os nomes dos comandos** («`npm test` — testes automáticos», sem
  total), e o README deixa de poder mentir sobre isto.

Não escolhi por V. A (a) é o que está implementado e é reversível.

### 6.5 Resíduos de outras frentes, vistos e não tocados

`apps/api/vitest-out.log` (de 18/09) e 29 ficheiros `vitest.config.ts.timestamp-*.mjs` na raiz de
`apps/api` continuam onde estavam. Não são meus e não os removi. `git status` não os mostra, o que
sugere que estão ignorados — mas ficam registados.

## 7. Blocos prontos a colar no `docs/ROADMAP.md`

**Tabela de tarefas (`:263`)** — trocar o estado:

```
| AUD-010  | Auditoria    | Números do README desatualizados                                       | A1     | P2         | `DONE`     | —                       |
```

**Cabeçalho de §5.7 (`:695`)** e bloco de fecho:

```
#### AUD-010 · Números do README desatualizados — A1 · P2 · `DONE`

- **Descrição:** "27 tabelas" (são 29), "63 unitários" (são 1448), "30 rotas" (são 32).
- **Objetivo:** o README é o primeiro documento que alguém lê; números errados subestimam o  
  próprio trabalho e desinformam.
- **Critérios de aceitação:** os três números conferem com o repositório; existe um comando  
  único que os volte a medir, se possível.
- **Ficheiros:** `README.md:19-22`.

**Fecho (A1, 2026-09-22).** Os três números conferem, e o problema era **seis quantidades em doze
ocorrências**, não três — `:19`, `:21`, `:22`, `:23`, `:97`, `:99`, `:131`, `:145`, `:147`, `:175`,
`:307`. Corrigidas, mais a descrição de `npm test` em `:239`. Medido: **29** tabelas (os dois
schemas concordam), **31** rotas da web (33 `path="…"` menos **dois** apanha-tudo), **31** decisões,
**1 841** testes automáticos (API 1 707 + web 134), **235** em `verify`, **77** em
`test/domain.test.ts`; **70** regressões e **12** guardas já estavam certos e ficaram. Criado
`scripts/check-readme-numbers.mjs` (**novo**), que mede o que é estático e verifica a coerência
interna do resto, com `--check` para `exit 1`; exposto como `npm run readme:numbers`. Provado por
**quatro** mutações (três no documento, **uma no repositório** — `## A32` acrescentado a
`DECISIONS.md`), todas com `exit 1` e só o grupo mutado vermelho; ficheiros repostos e confirmados
por `sha256`. A mutação **M3** revelou um defeito no próprio comando — saía `0` quando deixava de
encontrar um valor —, corrigido com `exit 1` sempre nesse caso. **Nota:** dois números da própria
especificação estavam errados — são **31** rotas (não 32) e **1841** testes (não 1448). Passo
acrescentado ao `ci.yml` de `OPS-001` (§3.3) — alteração a artefacto já entregue, reversível em 6
linhas. `verify:integration` = 28 **derivado, não executado** (`OPS-006`). `README.md` +21/−12,
`package.json` +1/−0. Sem commit.
```

**`PC-7` (`:119`)** — fechar, corrigindo os dois números do próprio texto:

```
| PC-7 | Os números do README estão desatualizados (27→29 tabelas, 63→1841 testes, 30→31 rotas)                                                                                                                                | `README.md:19-22`                                | Baixa               | **Fechado — `AUD-010`** |
```

*(Nota para A9: o «1448» e o «32» originais eram eles próprios medições desatualizadas. Se preferir
preservar o texto original como registo histórico, mantenha-o e acrescente «— medido em 2026-09-22:
1841 e 31».)*

**Tarefas novas a criar por A9** (IDs por atribuir, §6): o comentário de `App.tsx:38` (§6.1); a
revisão de `PC-34` à luz da última medição (§6.2); a decisão (a)/(b) sobre os totais no README
(§6.4).

---

## 8. Âmbito, e o que fica de fora

**Dentro:** os números do `README.md` que descrevem o repositório; o comando que os mede; o passo de
CI que impede o regresso.

**Fora, deliberadamente:** o comentário de `apps/web/src/App.tsx:38` (§6.1 — outra frente);
`OPS-006` (não autorizado nesta ordem de trabalho); `DOC-001` (permanece `CANCELLED`); o «223» de
`:32` (histórico); os resíduos de outras frentes (§6.5).

**Nunca:** `docs/ROADMAP.md` (só A9 escreve), renumeração de `PC-*`, `commit`, `push`, `deploy`.
