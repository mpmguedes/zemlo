# `PROPOSAL-A1-TEST-002` — Teste de contrato: `packages/shared` ↔ API

> **Documento de entrega, não fonte de verdade.** A fonte de verdade é `docs/ROADMAP.md`, e
> **este ficheiro não o altera**: o `sha256` do `ROADMAP.md` no início e no fim desta sessão é
> `2cd97a34f08b00f5a809026bf306aab0db18108bac7a5f5f9ef04d907dc4c8bf`. Os blocos de §7 são para
> o A9 colar; os IDs novos de §6 são para o A9 atribuir.
>
> **Ramo:** A1 — Qualidade, auditoria e hardening. **Tarefa:** `TEST-002` · P2.
> **Sem commit, sem push, sem deploy.** Alterações deixadas no *working tree*.

---

## 1. A premissa, verificada antes de escrever código

### 1.1 O que a tarefa diz

A tabela de §4 (`docs/ROADMAP.md:316`) diz:

```
| TEST-002 | Testes | Teste de contrato: `packages/shared` ↔ API | A1 | P2 | `BACKLOG` | — |
```

E o corpo (`:2169-2174`):

> - **Descrição:** o contrato é «a única definição de despesa ou lembrete no projeto». Nada
>   verifica automaticamente que a API o cumpre e que o cliente o consome.
> - **Critérios:** um teste falha quando a API deixa de cumprir um esquema de `contracts.ts`, ou
>   quando um tipo de `types.ts` diverge da resposta real.

### 1.2 Discrepância de estado, reportada e não corrigida

A ordem recebida chamou a `TEST-002` **`READY`**. O `ROADMAP.md` diz **`BACKLOG`**, e §4 não lhe
dá dependências. Não corrigi o ROADMAP — é do A9. **Trabalhei sobre o mérito**, que não depende
do rótulo: a tarefa não tem dependências, não exige decisão de produto, e o seu critério é
verificável com o que já existe. O que o A9 tem de decidir é o rótulo, não o trabalho.

### 1.3 A premissa confirmou-se, mas o contrato tem **duas** metades com fontes de verdade diferentes

Lido o código, «o contrato» não é um ficheiro só:

| Metade | Ficheiro | Natureza | Quem o aplica |
| --- | --- | --- | --- |
| **Entrada** | `packages/shared/src/contracts.ts` (763 linhas) | esquemas **Zod**, código em tempo de execução | `parseBody`/`parseQuery`/`parseParams` (`apps/api/src/http/handlers.ts`) |
| **Saída** | `packages/shared/src/types.ts` (743 linhas) | **tipos** TypeScript, sem existência em tempo de execução | `apps/api/src/domain/payload.ts` (mapeadores anotados) |

Isto é decisivo para o desenho, porque as duas metades exigem provas de espécie diferente:

- **A entrada** prova-se **em tempo de execução**: enviar uma violação e ver a API recusá-la.
- **A saída** tem uma parte que a **compilação** já garante e outra que só o tempo de execução
  apanha. A parte que a compilação garante é esta: `mapVehicleSummary(...): VehicleSummary`
  (`payload.ts:147`), `mapVehicleDetail(...): VehicleDetail` (`:181`), `mapExpense(...)`
  (`:238`), `mapReminder(...): ReminderView` (`:565`), `mapSource(value: unknown): SourceInfo`
  (`:75`) e `evaluateReminder(...): ReminderEvaluation` (`domain/reminders.ts:75`) devolvem
  **literais anotados com o tipo do contrato**, e esses ficheiros vivem em `apps/api/src/**` —
  que o `typecheck` do projeto **cobre**. Um campo em falta é `TS2741`; um campo a mais é
  verificação de propriedade excedente. **A ligação `types.ts` ↔ mapeador já estava provada
  pela compilação, e ninguém o tinha dito.**

### 1.4 O que a compilação **não** vê — e é aí que a tarefa tem valor

Duas coisas escapam ao `typecheck`, e são as que este teste existe para apanhar:

1. **A serialização.** O mapeador devolve objetos TypeScript; o cliente recebe `JSON`. Um campo
   declarado `string | null` que o mapeador devolva como `undefined` **desaparece** na resposta
   — o `JSON.stringify` omite chaves indefinidas — e o cliente passa a ver uma chave **ausente**
   onde o contrato promete uma chave presente. Em memória, o objeto está correto; no fio, não.
2. **A camada de rota.** `POST /reminders` faz `created(response, ..., reminder)`, mas
   `GET /vehicles` faz `response.json({ items, total: items.length })`
   (`routes/vehicles.ts:88`) e `GET /reminders` faz `response.json({ ...result, total: ... })`
   (`routes/reminders.ts:85`). **Esses literais não têm anotação** — o `typecheck` não tem o que
   verificar. É exatamente onde o `AUD-015` encontrou o defeito que encontrou.

---

## 2. O que foi construído

**Um ficheiro novo, e nada mais:** `apps/api/test/contract-http.test.ts` — 737 linhas,
30 100 bytes, LF puro, `sha256 ba01cc0e34c57d56a5d6b93068bd04086d33eaeda3377eafc698e9710b6084f4`.
**Doze testes.** Nenhum ficheiro de produção foi alterado (§3.4 confirma-o por hash).

### 2.1 O oráculo é o mapeador da API — e é isso que evita reimplementar a produção

A regra da tarefa é *«Não reimplementa a lógica de produção dentro dos testes»*. A tentação
óbvia era escrever aqui a lista de campos de `VehicleSummary`, `Expense` e `Reminder`. **Isso
seria uma segunda definição do contrato**, e nada a obrigaria a acompanhar `types.ts` — a
divergência seria silenciosa, que é precisamente o defeito que a suite existe para apanhar.

Em vez disso, o oráculo é o **mapeador**:

```ts
compararForma('POST /records/expenses ↔ Expense', criada.body, oraculoDespesa());
// `oraculoDespesa()` é `payload.mapExpense({...})` — a função da API, anotada `: ExpenseView`.
```

A comparação é entre as chaves do corpo **depois da serialização** e as chaves do mapeador
**depois da serialização**:

```ts
function chavesNaRede(valor: unknown): string[] {
  return chaves(JSON.parse(JSON.stringify(valor)) as unknown);
}
```

Assim, a completude do oráculo não é uma afirmação do teste: é uma obrigação do `typecheck` do
projeto sobre `src/**`, medida em §3.3 (mutação `M4`).

### 2.2 As violações são derivadas do esquema, não escritas à mão

Na metade de entrada, o teste **pergunta ao contrato** em vez de o repetir:

- **Campos obrigatórios** — `Object.entries(schema.shape).filter(([, c]) => !c.isOptional())`.
  Medido: `zVehicleCreateRequest` 1 (`plate`), `zExpenseCreateRequest` 2 (`amountCents`,
  `category`), `zReminderCreateRequest` 3 (`vehicleId`, `title`, `trigger`).
- **Substituições de tipo** — o tipo declarado do campo (`ZodString`, `ZodNumber`, `ZodBoolean`,
  `ZodEnum`, desembrulhando `.optional()`/`.nullish()`/`.default()`/`.refine()`) dá o valor
  errado a injetar. Medido: **52 substituições** (30 + 12 + 10).
- **Casos de conteúdo** — só quatro valores não são deriváveis do tipo e estão declarados
  (`plate: ''`, `amountCents: 0`, `date: '2026-02-30'`, `intervalKm: 50`). Cada um é
  **confirmado contra o esquema antes de ser enviado**.

**Toda** a violação derivada é primeiro confirmada com `schema.safeParse(...)` — se o esquema
passar a aceitá-la, o teste acusa *«deixou de ser uma violação, a asserção ficou vazia»* em vez
de passar em silêncio. E a asserção de recusa não se contenta com o `422`: exige que o erro
**nomeie o campo** (`error.fields[].path`), porque é isso que distingue a recusa vinda da
validação do esquema (`validationFailed`, `core/errors.ts:49`) de uma regra de serviço que por
acaso também recusa aquele corpo.

### 2.3 O que o teste declara não provar

O cabeçalho do ficheiro tem uma secção «O que estes testes não fazem», com quatro pontos: o
corpo dos mapeadores; os dois envelopes de lista não declarados (§6.2); as rotas fora do âmbito;
e o facto de `ApiErrorBody` ser a única forma afirmada com uma lista escrita à mão (não há
mapeador de erros).

---

## 3. Provas

### 3.1 Suites e verificações

| Prova | Comando | Resultado |
| --- | --- | --- |
| Ficheiro isolado | `vitest run test/contract-http.test.ts` | **12/12**, `exit 0`, 11,07 s |
| Suíte completa da API | `vitest run` | **45 ficheiros, 1725 testes**, `exit 0`, 306,63 s |
| `typecheck` da API | `tsc -p apps/api/tsconfig.json --noEmit` | `exit 0` |
| `typecheck` do partilhado | `tsc -p packages/shared/tsconfig.json --noEmit` | `exit 0` |
| `verify:config` | `tsx scripts/verify-config.ts` | `exit 0` — **12 corretos, 0 incorretos** |
| `tsc` explícito do teste novo | `tsconfig` temporário **fora do repositório** | `exit 0` — **zero erros** |

A suíte completa passou de **1713** para **1725** testes (+12, exatamente o ficheiro novo), e
**não** deu `EBUSY` nesta corrida (`PC-26` não se manifestou).

Sobre a última linha: `PC-15` diz que `tsconfig.json` exclui `**/*.test.ts`, pelo que o
`typecheck` **não** vê este ficheiro. Verifiquei-o com um `tsconfig` temporário de alvo
restrito, fora do repositório, com `typeRoots` explícito (sem ele, `TS2688`). **Este ficheiro é
limpo em tipos — zero erros.** É uma diferença face aos testes anteriores do harness, que
carregam o `TS2322` pré-existente de `appPrisma = prisma` (`documents-http.test.ts:82`): aqui o
tipo do cliente é **inferido** (`(typeof import('../src/core/db.js'))['prisma']`) em vez de
anotado, e por isso não há erro a herdar. Fica registado como material para `PC-15`.

### 3.2 Bateria de mutações — 3 no comportamento, 1 no contrato

Cada mutação parte de uma âncora que tem de ocorrer **exatamente uma vez**; o script aborta
**antes de escrever** se não ocorrer, e repõe a partir de cópia confirmando o `sha256`.

| # | Mutação | Ficheiro | Vermelhos | Que asserção falhou |
| --- | --- | --- | --- | --- |
| `M1` | `parseBody` deixa de recusar (`if (false && !result.success)`) | `http/handlers.ts` | **4** | as 3 de §1 **+** o envelope de erro |
| `M2` | `POST /records/expenses` valida com `zExpenseUpdateRequest` | `routes/financial.ts` | **1** | só «corpo a que falta um campo obrigatório», **nas despesas** |
| `M3` | `POST /reminders` responde `{...reminder, campoNaoDeclarado: true}` | `routes/reminders.ts` | **1** | só a forma de `Reminder` |
| `M4` | `Reminder` ganha `auditNote` em `types.ts` | `shared/src/types.ts` | `typecheck` **exit 2** | `payload.ts(583,3) TS2741: Property 'auditNote' is missing … but required in type 'Reminder'` |

Três detalhes que valem mais do que a contagem:

- **`M1` dá 4, não 3.** A quarta é o teste do envelope de erro, e a razão é a sua **primeira**
  asserção (`expect(resposta.status).toBe(422)`): com a validação desligada, o corpo mau produz
  `500` antes de o envelope ser examinado. Fica dito, para que os 4 não sejam lidos como «o
  envelope de erro está mal».
- **`M2` dá 1, não 3, e é a medição mais informativa da bateria.** `zExpenseUpdateRequest` é
  `.partial()`: **retira a obrigatoriedade mas mantém o tipo e as restrições de valor**. Logo,
  só a asserção sobre *campos obrigatórios* é afetada; as de tipo errado e de conteúdo continuam
  verdes porque o esquema parcial ainda as recusa. O teste localiza a propriedade afetada, não
  uma vizinhança.
- **`M3` é o que a compilação não podia apanhar.** O campo a mais é acrescentado **na rota**,
  fora do mapeador — onde não há anotação. O `typecheck` ficaria verde. O teste ficou vermelho, a
  nomear a divergência.

E a guarda de âncora foi exercida **duas vezes, para valer**: a primeira tentativa de `M1` foi
**abortada** com «a âncora ocorre 0 vez(es)» (indentação errada minha) e a segunda com «ocorre 3
vez(es)» (`if (!result.success)` existe em `parseBody`, `parseQuery` e `parseParams`, e mutar as
três mediria outra coisa). Em nenhuma das duas houve escrita.

### 3.3 O que a mutação `M4` prova, e porque precisou de reconstruir o partilhado

`M4` não corre a suíte: mede a **outra metade do critério**. Acrescentar `auditNote` a
`interface Reminder` em `types.ts` faz o `typecheck` da API falhar em `payload.ts:583`, isto é,
em `mapReminder`. **É essa a prova de que «o oráculo é o contrato» não é uma afirmação:** a
ligação `types.ts` ↔ mapeador é imposta pelo `typecheck` que já existe, **sem configuração nova**.

`packages/shared` teve de ser reconstruído porque o `typecheck` da API resolve `@zemlo/shared`
pelo `exports.types` do pacote — `dist/index.d.ts`, não `src/`. Antes da mutação, baseline
confirmada: `build` `exit 0` e `typecheck` `exit 0`; depois da reposição, `sha256` confere e o
`typecheck` volta a `exit 0`.

### 3.4 Estado final, confirmado por hash

| Ficheiro | `sha256` antes | depois | |
| --- | --- | --- | --- |
| `docs/ROADMAP.md` | `2cd97a34…` | `2cd97a34…` | **intacto** |
| `apps/api/src/http/handlers.ts` | `8f234904…` | `8f234904…` | reposto |
| `apps/api/src/http/routes/financial.ts` | `41abeeff…` | `41abeeff…` | reposto |
| `apps/api/src/http/routes/reminders.ts` | `f6fbcb4c…` | `f6fbcb4c…` | reposto |
| `packages/shared/src/types.ts` | `88c052d5…` | `88c052d5…` | reposto |
| `apps/api/test/contract-http.test.ts` | `ba01cc0e…` | `ba01cc0e…` | **nunca mutado** |

---

## 4. O que **não** foi medido, e o que isso limita

1. **O corpo dos mapeadores.** Se a anotação de retorno de `mapExpense` for removida, a
   comparação continua verde e a garantia de completude desaparece **sem ruído**. A anotação é a
   única coisa que liga o mapeador ao contrato; a sua remoção não é detetada nem pelo teste nem
   pelo `typecheck` (que deixa de ter o que verificar). **É o limite mais importante deste
   desenho, e está declarado no cabeçalho do ficheiro.**
2. **As rotas fora do âmbito.** O âmbito são despesas, lembretes e veículos — os dois recursos
   que §6 nomeia mais a raiz de que dependem. `documents`, `integrations`, `import`, `insights`,
   `compliance`, `auth` **não** são cobertos. É âmbito fechado, não esquecimento.
3. **`verify` e `verify:regressions` não correram.** Exigem servidor vivo (`PC-32`) e o
   `TEST-002` não altera uma linha de produção — o valor seria confirmar o que a suíte completa
   já confirmou. `verify:config`, que é autónomo, correu e passou.
4. **`PC-26`** não se manifestou nesta corrida; continua aberto e intermitente.
5. **A derivação de tipo cobre primitivos e enums.** Campos de objeto e arrays (o `source`) não
   produzem substituição, por opção: uma violação inventada não seria uma violação garantida.

---

## 5. Os critérios de aceitação, um a um

| Critério do ROADMAP | Estado | Onde está a prova |
| --- | --- | --- |
| «um teste falha quando a API deixa de cumprir um esquema de `contracts.ts`» | **cumprido** | §1 do ficheiro, 62 asserções derivadas do esquema; `M1` (4 vermelhos) e `M2` (1 vermelho) |
| «um teste falha quando um tipo de `types.ts` diverge da resposta real» | **cumprido** | §2 do ficheiro; `M3` (a rota acrescenta um campo → vermelho) e `M4` (`types.ts` ganha um campo → `typecheck` vermelho) |

Nenhum critério ficou por cumprir. O que fica por decidir são os dois achados de §6, que **não
foram absorvidos** — a ordem recebida foi explícita nisso.

---

## 6. Achados — **proposta para o A9, sem ID atribuído e sem absorção**

### 6.1 Oito de doze mensagens de validação chegam ao cliente **em inglês**

**Medido, não inferido.** `translateMessage` (`apps/api/src/http/handlers.ts:114-125`) é um mapa
de **igualdade exata de cadeia** com seis entradas. As mensagens de comprimento e de intervalo do
Zod são **parametrizadas**, pelo que só uma delas coincide:

| Rota e violação | Mensagem que o cliente recebe | |
| --- | --- | --- |
| `POST /vehicles` — `plate: ''` | `String must contain at least 2 character(s)` | inglês |
| `POST /vehicles` — `plate` com 19 caracteres | `String must contain at most 16 character(s)` | inglês |
| `POST /vehicles` — `year: 1800` | `Number must be greater than or equal to 1886` | inglês |
| `POST /vehicles` — `year: 3000` | `Number must be less than or equal to 2100` | inglês |
| `POST /vehicles` — `odometerKm: 9000000` | `Number must be less than or equal to 3000000` | inglês |
| `POST /vehicles` — `year: 'dois mil'` | `Indica um número.` | português |
| `POST /reminders` — `title: ''` | `Este campo não pode ficar vazio.` | português |
| `POST /reminders` — `notes` com 2001 caracteres | `String must contain at most 2000 character(s)` | inglês |
| `POST /reminders` — `intervalKm: 50` | `Number must be greater than or equal to 100` | inglês |
| `POST /records/expenses` — `amountCents: 0` | `O valor não pode ser zero` | português |
| `POST /records/expenses` — valor acima do máximo | `Number must be less than or equal to 100000000` | inglês |
| `POST /records/expenses` — `date: '2026-02-30'` | `Essa data não existe no calendário. Confirma o dia e o mês.` | português |

**8 de 12 em inglês.** O único caso de comprimento que sai em português é `title: ''`, porque
`at least 1 character(s)` é literalmente a cadeia que está no mapa — o acerto é acidental, e é o
que torna o defeito fácil de não ver. As quatro mensagens portuguesas são ou escritas pelo autor
do esquema, ou a de tipo, que está no mapa.

**Consequência:** o utilizador lê inglês dentro do formulário (§59 exige mensagens em português,
prontas a apresentar), e a mensagem não lhe diz o que fazer — «String must contain at least 2
character(s)» não é uma instrução.

**Porque não foi absorvido:** a correção não é um teste, é uma decisão sobre **como** traduzir
mensagens parametrizadas (dicionário por prefixo e código de issue do Zod, ou mensagens próprias
em cada campo dos esquemas). Mexe em `handlers.ts` e possivelmente em `contracts.ts` — que §6
classifica como contrato sensível. **Requer tarefa própria e decisão.**

### 6.2 Dois dos três envelopes de lista divergem de `Page<T>` — e nenhum está no contrato

**Medido:** `Page<T>` (`packages/shared/src/types.ts:55`) declara `items`, `nextCursor`
(**obrigatório**) e `total?`. O docblock de `contracts.ts` diz que as listas são «paginadas por
cursor (`{ items, nextCursor }`)».

| Rota | Resposta real | |
| --- | --- | --- |
| `GET /records/expenses` | `{ items, nextCursor, total }` | cumpre |
| `GET /vehicles` | `{ items, total }` | **sem `nextCursor`** |
| `GET /reminders` | `{ counts, items, total }` | **sem `nextCursor`**, com `counts` |

Isto, por si, poderia ser uma decisão de produto defensável — uma pessoa tem poucos veículos e
poucos lembretes. O que **não** é defensável é onde estes envelopes estão declarados:

- **Não estão em `packages/shared`.** `types.ts` não tem `VehicleListResponse` nem
  `ReminderListResponse`.
- **Estão no cliente web**, escritos à mão: `VehicleListResponse` (`apps/web/src/api/queryKeys.ts:162`),
  `OdometerListResponse` (`:167`) e `ReminderListResponse` (`:172`), este último com um comentário
  que explica porque não é `Page<VehicleSummary>` — o autor sabia, e documentou.
- **O contrato gerado para o mobile só tem `Page<T>`** (`apps/mobile/lib/contract/generated/contract_models.dart:148`),
  com `nextCursor` **`required`** (`:151`). Um cliente mobile que use o contrato partilhado para
  `GET /vehicles` modela a resposta como `Page<VehicleSummary>` — **um tipo do contrato que
  diverge da resposta real**, que é literalmente o critério de `TEST-002`.

**Consequência:** a afirmação de §6 — «o contrato é *a única definição* de despesa ou lembrete no
projeto» — **não é verdadeira para os envelopes de lista**. A API e o cliente web têm duas cópias
escritas à mão, e **nada verifica que concordam**; o mobile tem uma terceira, derivada do
contrato, que discorda das duas.

**Porque não foi absorvido:** há três desfechos possíveis e nenhum é de um teste — (a) declarar os
envelopes reais em `types.ts`; (b) fazer a API cumprir `Page<T>`; (c) aceitar a divergência e
documentá-la. Todos são alterações ao **contrato partilhado**, que §6 obriga a decidir **antes**
de implementar, com impacto declarado em API, Web e Mobile. **Requer tarefa própria e decisão.**

### 6.3 Corroboração de um achado já registado

`records-compliance.ts:286-298` escreve `reminderData.dueDate` e `dueOdometerKm` **sem condição**,
a partir de `updated.nextDueDate` / `updated.nextDueOdometerKm`. Já registado para o A9 na entrega
de `AUD-015`; **continua por medir** e não foi tocado aqui. Mencionado só para não se perder.

---

## 7. Blocos prontos a colar no `docs/ROADMAP.md` (para o A9)

### 7.1 Linha da tabela de §4 (`:316`)

Substituir:

```
| TEST-002 | Testes       | Teste de contrato: `packages/shared` ↔ API                             | A1     | P2         | `BACKLOG`  | —                       |
```

por:

```
| TEST-002 | Testes       | Teste de contrato: `packages/shared` ↔ API                             | A1     | P2         | `DONE`     | —                       |
```

*(Nota para o A9: a ordem de trabalho chamou a `TEST-002` «`READY`»; o ROADMAP diz `BACKLOG`.
Ver §1.2 — o rótulo é decisão sua, o trabalho está feito.)*

### 7.2 Corpo da tarefa (`:2169-2174`) — acrescentar, a seguir aos critérios

```markdown
- **Resultado (2026-09-22, A1) — `DONE`.** Novo `apps/api/test/contract-http.test.ts` (737 linhas,
  12 testes, `sha256 ba01cc0e…`). Nenhum ficheiro de produção foi alterado.

  **As duas metades do critério, e onde cada uma é provada:**

  1. **A API aplica os esquemas de `contracts.ts`** — as violações são **derivadas do próprio
     esquema**, não escritas à mão: 6 campos obrigatórios, **52 substituições de tipo** e 4 casos
     de conteúdo, todos confirmados contra o esquema antes de serem enviados. A recusa não se
     contenta com o `422`: exige que `error.fields[].path` **nomeie o campo**, o que distingue a
     validação do esquema (`validationFailed`) de uma regra de serviço que por acaso também recusa.
  2. **A resposta real tem a forma de `types.ts`** — o oráculo é o **mapeador da API**
     (`domain/payload.ts`), cuja anotação de retorno (`: VehicleSummary`, `: Expense`, …) é
     verificada pelo `typecheck` que cobre `src/**`. Não há uma segunda lista de campos no teste,
     logo não há nada que possa divergir em silêncio. A comparação é feita **depois da
     serialização**, e é isso que apanha o campo que o `JSON.stringify` faz desaparecer — o único
     buraco que a compilação não vê.

  **Provas:** ficheiro isolado 12/12 (`exit 0`); suíte completa **45 ficheiros / 1725 testes**
  (`exit 0`; eram 1713, +12); `typecheck` da API e do partilhado `exit 0`; `verify:config` `exit 0`
  (12 corretos, 0 incorretos); e — porque `tsconfig.json` exclui `**/*.test.ts` (`PC-15`) — um
  `tsc --noEmit` explícito sobre o ficheiro novo, **zero erros** (o tipo do cliente é inferido em
  vez de anotado, pelo que este ficheiro **não** herda o `TS2322` do harness; material para `PC-15`).

  **Prova por mutação — 4 mutações, cada uma a medir uma asserção diferente:**

  | # | Mutação | Vermelhos | O que mede |
  | --- | --- | --- | --- |
  | `M1` | `parseBody` deixa de recusar (`http/handlers.ts`) | 4 | as 3 de entrada + o envelope de erro |
  | `M2` | `POST /records/expenses` valida com `zExpenseUpdateRequest` (`routes/financial.ts`) | 1 | localiza a propriedade afetada (`.partial()` retira a obrigatoriedade, mantém o tipo) |
  | `M3` | `POST /reminders` responde com um campo a mais (`routes/reminders.ts`) | 1 | a camada de rota, onde **não há anotação** e o `typecheck` ficaria verde |
  | `M4` | `Reminder` ganha `auditNote` (`shared/src/types.ts`) | `typecheck` exit 2 | `payload.ts:583 TS2741` — a ligação `types.ts` ↔ mapeador é imposta pela compilação que já existe |

  Todas repostas e confirmadas por `sha256`. A guarda de âncora abortou duas tentativas de `M1`
  **antes de escrever** (0 ocorrências, depois 3 — `if (!result.success)` existe em `parseBody`,
  `parseQuery` e `parseParams`).

  **Limitação declarada:** se a anotação de retorno de um mapeador for removida, a comparação
  continua verde e a garantia de completude desaparece sem ruído. É o limite do desenho e está no
  cabeçalho do ficheiro.

  **Fora do âmbito (declarado):** as restantes rotas (`documents`, `integrations`, `import`,
  `insights`, `compliance`, `auth`); os dois envelopes de lista não declarados (achado em §6.2);
  `verify` e `verify:regressions`, que exigem servidor vivo e não têm o que verificar num trabalho
  sem alterações de produção.

  **Problemas encontrados:** dois, medidos e **não absorvidos** — mensagens de validação em inglês
  (§6.1) e envelopes de lista fora do contrato (§6.2). Ambos pedem tarefa própria e decisão.

  **Commit:** **nenhum** — aguarda autorização.
```

### 7.3 Linha nova na tabela de §2 (`PC-*`), se o A9 quiser abrir os dois achados

*(Sugestões de conteúdo. **Os IDs são do A9** — §1.7 não tem regra de alocação, `PC-18`.)*

```markdown
| PC-35 | **Oito de doze mensagens de validação chegam ao cliente em inglês.** `translateMessage` (`apps/api/src/http/handlers.ts:114-125`) é um mapa de **igualdade exata de cadeia** com seis entradas; as mensagens de comprimento e de intervalo do Zod são **parametrizadas**, pelo que só coincidem por acaso (`at least 1 character(s)` está no mapa; `at least 2` não). Medido por A1 em 2026-09-22, em `TEST-002`: **8 de 12** casos devolvem inglês — `String must contain at least 2 character(s)`, `Number must be greater than or equal to 1886`, `Number must be less than or equal to 3000000`, entre outros. §59 exige mensagens em português prontas a apresentar, e «String must contain at least 2 character(s)» não é uma instrução. **Deteção: A1, 2026-09-22, durante `TEST-002`.** | `apps/api/src/http/handlers.ts:114-125`, `packages/shared/src/contracts.ts` | Média | Aberto — precisa de tarefa própria e de decisão (dicionário por código de issue vs. mensagens próprias nos esquemas) |
| PC-36 | **Dois dos três envelopes de lista divergem de `Page<T>` — e nenhum está no contrato.** `Page<T>` (`packages/shared/src/types.ts:55`) declara `nextCursor` **obrigatório** e o docblock de `contracts.ts` diz que as listas são «paginadas por cursor». Medido por A1 em 2026-09-22: `GET /records/expenses` → `{items, nextCursor, total}` (cumpre); `GET /vehicles` → `{items, total}` (`routes/vehicles.ts:88`); `GET /reminders` → `{counts, items, total}` (`routes/reminders.ts:85`). O que não é defensável é **onde** estão declarados: **não estão em `packages/shared`** — estão escritos à mão **no cliente web** (`apps/web/src/api/queryKeys.ts:162,167,172`, com um comentário que explica a decisão) — e o contrato gerado para o mobile só tem `Page<T>`, com `nextCursor` `required` (`apps/mobile/lib/contract/generated/contract_models.dart:148,151`). Consequência: a afirmação de §6 de que o contrato é «a única definição» **não vale para os envelopes de lista**; API e Web têm duas cópias que nada verifica, e o Mobile tem uma terceira que discorda. **Deteção: A1, 2026-09-22, durante `TEST-002`.** | `apps/api/src/http/routes/vehicles.ts:88`, `apps/api/src/http/routes/reminders.ts:85`, `apps/web/src/api/queryKeys.ts:162-184`, `packages/shared/src/types.ts:55` | Média | Aberto — alteração ao **contrato partilhado** (§6): exige tarefa e decisão **antes** de implementar, com impacto API/Web/Mobile declarado |
```

### 7.4 Nota para `PC-15`

```markdown
**Material novo para `PC-15`, medido em `TEST-002` (A1, 2026-09-22):** o ficheiro
`apps/api/test/contract-http.test.ts` é **limpo em tipos** sob um `tsc --noEmit` explícito
(`exit 0`, zero erros), porque infere o tipo do cliente Prisma
(`(typeof import('../src/core/db.js'))['prisma']`) em vez de o anotar com `PrismaClient` de
`@zemlo/prisma-sqlite`. É a **diferença exata** que produz o `TS2322` pré-existente do harness
(`documents-http.test.ts:82`). Se `PC-15` for fechado por um `tsconfig` de testes, este ficheiro
não acrescenta ruído — e o padrão de inferência é o que os outros podem adotar.
```

---

## 8. Âmbito, e o que fica de fora

**Dentro:** o teste de contrato (`contracts.ts` ↔ API e `types.ts` ↔ resposta real) para
despesas, lembretes e veículos; as provas (suíte, `typecheck`, `verify:config`, `tsc` explícito,
4 mutações); os dois achados medidos.

**Fora, declarado:** as restantes rotas; os dois envelopes de lista (§6.2, não absorvidos); a
correção das mensagens (§6.1, não absorvida); `records-compliance.ts` (§6.3, continua por medir);
`verify`/`verify:regressions` com servidor vivo; e `PC-15`/`PC-26`/`PC-32`/`PC-33`/`PC-34`, que
continuam abertos e intocados.

**Resíduos:** as duas sondas descartáveis (`apps/api/scripts/_probe-contrato.ts`,
`_probe-achados.ts`) e o contador (`_conta-contrato.ts`) são cobertos pela regra
`**/scripts/_*` do `.gitignore` (não aparecem em `git status`) e foram **enviados para a
Reciclagem**, com os temporários de `%TEMP%\zemlo-test002\`. Fica registado, sem tocar, o resíduo
de outros agentes/harness em `apps/api/vitest.config.ts.timestamp-*.mjs` — **ignorado** pelo
`.gitignore` (`*.timestamp-*.mjs`), logo sem risco de repositório.
