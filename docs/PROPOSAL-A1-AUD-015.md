# `PROPOSAL-A1-AUD-015` — `PATCH /reminders/:id` aceita um estado sem condição (`PC-31`)

> **Documento de entrega, não fonte de verdade.** A fonte de verdade é `docs/ROADMAP.md`, e
> **este ficheiro não o altera**: `sha256` do `ROADMAP.md` no início e no fim desta sessão é
> `2cd97a34f08b00f5a809026bf306aab0db18108bac7a5f5f9ef04d907dc4c8bf`. Os blocos de §7 são para
> o A9 colar; os IDs novos de §6 são para o A9 atribuir.
>
> **Ramo:** A1 — Qualidade, auditoria e hardening. **Tarefa:** `AUD-015` · P2 · `READY` →
> proposta de `DONE` · dependência `AUD-014` (`DONE`).
> **Sem commit, sem push, sem deploy.** Alterações deixadas no *working tree*.

---

## 1. A premissa, verificada antes de escrever código

A tarefa dizia: *«`updateReminder` escreve os campos que recebe sem verificar o **resultado**»*,
*«a invariante é sobre o **estado final**, não sobre o pedido»*, e *«a validação é **uma só**
função, usada por `createReminder` e `updateReminder`»*.

Lido o código, a premissa **confirmou-se** — e, ao verificar a criação para a poder partilhar,
apareceu uma segunda coisa que a tarefa não previa e que obrigou a uma decisão de política.

### 1.1 O que a tarefa descrevia (confirmado)

- `updateReminder` não tinha guarda nenhuma: escrevia os campos recebidos e mais nada.
- `zReminderUpdateRequest` é `zReminderCreateRequest.partial()` (`packages/shared/src/contracts.ts:604`),
  pelo que **todos** os campos são opcionais e `null` é aceite: `PATCH {dueDate: null}` chega ao
  serviço como um pedido válido.
- `evaluateReminder` consome **apenas** `dueDate` e `dueOdometerKm` (`apps/api/src/domain/reminders.ts:87-114`).
  `intervalMonths` e `intervalKm` **nunca** são lidos por ele — só por `computeNextOccurrence`
  (`:228-238`), na conclusão. Logo, «tem condição» é exatamente «tem alvo que o avaliador consegue ler».

### 1.2 O que a tarefa não previa (e que foi medido)

O critério *«a validação é **uma só** função»* obriga a tocar na criação. Ao fazê-lo, a criação
revelou ter **o mesmo defeito**, escondido atrás da materialização do intervalo.

A guarda do `AUD-014` testa o **pedido**, antes de o intervalo ser materializado
(`services/reminders.ts:90`, na versão anterior):

```ts
if (input.trigger !== 'time' && ausente(input.dueOdometerKm) && ausente(input.intervalKm)) { … }
```

Mas a materialização seguinte pode falhar em silêncio, porque precisa de uma quilometragem de
partida (`:107`):

```ts
const dueOdometerKm = input.dueOdometerKm ??
  (input.intervalKm != null && vehicle.odometerKm !== null ? vehicle.odometerKm + input.intervalKm : null);
```

Um veículo recém-criado não tem odómetro. **Medido** (sonda temporária numa cópia do teste do
`AUD-014`, já reposta e confirmada por `sha256` `62dd820b…`):

```
POST /api/v1/reminders  {trigger:'distance', intervalKm:15000}   →  201
{ "dueDate": null, "dueOdometerKm": null, "intervalKm": 15000,
  "evaluation": { "state": "unknown", "summary": "Sem dados suficientes para calcular" } }
```

Isto é **exatamente** o estado que o `AUD-014` se propôs recusar. Pior: o teste positivo que o
`AUD-014` acrescentou (`test/reminders-http.test.ts:239`, na versão anterior) **fixava-o como
esperado** — afirmava o `status` e o `intervalKm`, nunca o `dueOdometerKm`. Era um **falso verde
introduzido pela própria correção**. E não é um estado transitório: nada no produto recalcula
`dueOdometerKm` a partir de `intervalKm` fora da conclusão (`grep` de `intervalKm` em
`apps/api/src` — os únicos leitores são `domain/reminders.ts:237`, dentro de
`computeNextOccurrence`, e `records-compliance.ts`), pelo que o lembrete fica morto para sempre.

### 1.3 Decisão de política (pedida ao utilizador, não inventada)

Questão colocada: `POST {trigger:'distance', intervalKm:N}` num veículo sem odómetro — 422 ou
201-`unknown`? Havia dois argumentos legítimos: o domínio declara esse estado válido em termos de
produto (`domain/reminders.ts:122-126`: «a interface pede o dado em falta em vez de esconder o
lembrete»), mas um lembrete que nunca dispara é o que o `AUD-014` veio eliminar.

**Decisão do utilizador: recusar com 422, sem persistir.** É esta que está implementada. Consequência
declarada: o comportamento da **criação** muda neste caso, e um teste aceite do `AUD-014` é corrigido
(§2.2). Não foi tomada por inferência.

---

## 2. O que mudou

### 2.1 `apps/api/src/services/reminders.ts`

`sha256 e4f46c21d358af77ca7fbe207c2e255e3d41d2f608688dec5a4d07a287140605` · 583 linhas · **LF**
(0 `CRLF`, 569 `LF` — a convenção do ficheiro foi preservada).

`git diff --numstat` = **95/11**, mas **cumulativo com o `AUD-014`**: o `HEAD` (`edbba01`) é
anterior à correção do `AUD-014`, que ainda não foi commitada. O delta que é **deste** trabalho
são três regiões:

| Região | Linhas | O que é |
| --- | --- | --- |
| `createReminder:79-108` | comentário reescrito + `:108` | A validação passa a vir **depois** da materialização: `assertCondicao({ trigger, dueDate, dueOdometerKm })` |
| `updateReminder:227-277` | bloco de documentação + estado fundido + validação + `try/catch` | `requireRecord` devolve agora o registo tipado; o estado **resultante** é validado antes de qualquer escrita |
| `EstadoCondicao` + `assertCondicao:581-613` | a função partilhada | A invariante, uma só, usada pelos dois caminhos |

O estado que a edição valida é o que **vai ficar gravado** — cada campo vale o que o pedido traz,
ou o que já lá estava quando o pedido o omite:

```ts
assertCondicao({
  trigger: (input.trigger ?? existing.trigger) as Reminder['trigger'],
  dueDate: input.dueDate !== undefined ? input.dueDate : toCivilDate(existing.dueDate),
  dueOdometerKm: input.dueOdometerKm !== undefined ? input.dueOdometerKm : existing.dueOdometerKm,
});
```

A função partilhada decide pelo **alvo**, não pelo pedido:

```ts
function assertCondicao(estado: EstadoCondicao): void {
  if (estado.trigger !== 'time' && ausente(estado.dueOdometerKm)) { throw unprocessable(…); }
  if (estado.trigger !== 'distance' && ausente(estado.dueDate)) { throw unprocessable(…); }
}
```

As mensagens nomeiam as duas rotas (dar o alvo, ou dar um intervalo que o produza) e a de
quilometragem diz explicitamente que o intervalo «exige uma quilometragem já registada no veículo»,
que é a causa real no caso medido em §1.2.

**Alteração acessória no mesmo hunk:** a escrita passou a estar dentro de `try/catch` com
`translatePrismaError(error, 'atualizar lembrete')`, espelhando `createReminder`. Antes, uma falha
da base nesta operação saía como erro não traduzido.

**Nota deliberada (e uma escolha que fica à vista):** a edição **não** materializa intervalos, ao
contrário da criação. `PATCH {dueDate: null}` sobre um lembrete por tempo com `intervalMonths` é
**recusado** — o serviço não inventa uma data que o cliente não pediu. A criação aceita o intervalo
porque a materialização faz parte do que o cliente pediu *ao criar*. A assimetria é conservadora
(mais restrita, nunca mais permissiva) e está escrita no código.

### 2.2 `apps/api/test/reminders-http.test.ts`

`sha256 b5ef50186dd6c889ce5fc03f963a351dbad856130cca23ada3a72376a7bbbd7b` · 509 linhas · **LF** ·
ficheiro **não rastreado** (`??` — nasceu em `TEST-001`/`AUD-014` e nunca foi commitado).

`47 → 53` testes. Seis novos:

- **`:120-129`** — `createVehicle` passa a aceitar campos extra (`odometerKm`), porque o caso
  positivo do intervalo em km **precisa** de uma quilometragem de partida para ser verdadeiro.
- **`:239-256`** — o teste positivo do `AUD-014` **corrigido**: o veículo passa a ter odómetro e a
  asserção passa a ser sobre o **alvo** (`dueOdometerKm === 57 000`) e sobre o estado
  (`not.toBe('unknown')`). A **alegação do teste mantém-se** (a guarda não é demasiado larga); o que
  muda é a montagem, que antes fixava um lembrete morto como esperado.
- **`:258-276`** — o caso novo: recusa (422) do intervalo em km sem quilometragem para o ancorar, com
  asserção sobre a mensagem e sobre o que ficou gravado (`total === 0`).
- **`§1b` — `:282-372`** — cinco testes de edição: apagar a data (422 + não grava), apagar o alvo
  (422 + não grava), trocar o `trigger` para um que o estado não satisfaz (422 + não grava), um
  `PATCH` que mantém a condição (200), e uma edição que não toca na condição (200).

O `describe` de edição é novo porque não existia secção de edição própria: o único teste de `PATCH`
vivia em §1 e só mudava o título.

---

## 3. Provas

### 3.1 Suítes e verificações

| Verificação | Comando | Resultado |
| --- | --- | --- |
| Testes do ficheiro | `vitest run test/reminders-http.test.ts` | **53 passed (53)**, exit **0** |
| Suíte completa da API | `vitest run` | **44 ficheiros, 1713 passed (1713)**, exit **0**, 275 s |
| `typecheck` | `tsc -p tsconfig.json --noEmit` | exit **0** |
| Tipos do ficheiro de teste | `tsconfig` temporário, alvo restrito (`PC-15`) | **0 erros novos** — só o `TS2322` pré-existente de `appPrisma = prisma;` (`:76`) e o `TS2589` que o acompanha |
| `verify:config` | `tsx scripts/verify-config.ts` | **12 corretos, 0 incorretos**, exit **0** |
| `verify` (integração) | `tsx scripts/verify.ts`, com a API a correr | **235 verificações passaram**, exit **0** |
| `verify:regressions` | `tsx scripts/verify-regressions.ts`, com a API a correr | **70 regressões confirmadas corrigidas**, exit **0** |

A suíte passou de **1707** para **1713** testes — exatamente os seis novos. Nesta execução **não**
se observou o `EBUSY` de `PC-26`.

Nota de ambiente: `verify.ts` e `verify-regressions.ts` são sondas contra um servidor vivo
(`ZEMLO_API_ORIGIN`, por omissão `http://127.0.0.1:4000`); sem servidor dão `ECONNREFUSED`, que é
**falha de ambiente e não de teste** — a distinção que o `OPS-001` introduziu. Foram corridos com a
API levantada e deram exit 0.

### 3.2 Prova por mutação

Quatro execuções. Em cada uma: mutar o **serviço** (nunca o teste), correr o ficheiro mais estreito,
repor, e confirmar por `sha256`. O original foi copiado **uma só vez**, antes da primeira mutação.

| Mutação | O que faz | Resultado | O que prova |
| --- | --- | --- | --- |
| **M1** | a edição volta a não validar (`if (false) assertCondicao(…)`) | **3 vermelhos** — as três recusas da edição | Os testes de edição **mordem**: sem a guarda ficam verdes (200) e gravam |
| **M2** | a criação volta a validar o **pedido** (as duas guardas do `AUD-014`, pré-materialização) | **1 vermelho** — a recusa do intervalo sem odómetro | A correção da criação é **load-bearing**: é a validação sobre o **alvo materializado** que a faz passar, não a guarda antiga |
| **M3** | a edição valida **depois** de gravar | **3 vermelhos** — as mesmas três | A **ordem** importa. Detalhe medido: o `422` mantém-se e a asserção que falha é `expected null to be '2026-12-01'` — isto é, **«não grava»**, não o estado da resposta |

Em nenhuma mutação se observou um vermelho fora do grupo mutado, e o ficheiro ficou **byte a byte**
igual ao original em todas (`sha256 e4f46c21…` confirmado no fim de cada uma e no fim da bateria).

---

## 4. O que **não** foi medido

- **`PC-15` continua aberto.** O `typecheck` do projeto exclui `**/*.test.ts`; a verificação do
  ficheiro de teste foi feita com um `tsconfig` temporário fora do repositório, com alvo restrito.
  Sem esse alvo restrito, o ruído pré-existente esconde o que é novo — foi o que aconteceu: com o
  alvo restrito aparece **só** o erro documentado de `:76`.
- **A prova por mutação foi feita sobre o ficheiro de teste mais estreito, não sobre a suíte
  completa.** É a prática do projeto e o que dá o sinal mais limpo; não foi repetida à escala da
  suíte.
- **Não foi tocado o `records-compliance.ts`.** O achado de §6.1 é **por leitura**, com as linhas
  citadas; **não foi medido** e não foi corrigido (âmbito fechado).
- **A assimetria criação/edição** (§2.1, última nota) é uma escolha de política **não** confirmada
  pelo utilizador: foi ele que decidiu o 422, mas a assimetria em si — a edição recusar
  `{dueDate: null}` sobre um lembrete com `intervalMonths` — é minha. Fica declarada para revisão.

---

## 5. Estado da tarefa

Todos os critérios de aceitação estão satisfeitos e provados:

| Critério | Estado | Prova |
| --- | --- | --- |
| `PATCH` que deixaria o lembrete sem condição devolve **422** e **não** grava | ✅ | §1b, `:286-307`; mutações M1 e M3 |
| Um `PATCH` que mantém uma condição válida continua a passar | ✅ | §1b, `:337-362`; verdes em todas as mutações |
| A validação é **uma só** função, usada por `createReminder` e `updateReminder` | ✅ | `assertCondicao`, `:602`, chamada em `:108` e `:256`; M2 prova que a da criação é a mesma regra |

---

## 6. Achados novos (IDs a atribuir pelo A9)

### 6.1 A edição de um registo de manutenção grava `null` sobre a condição do lembrete ligado

`apps/api/src/services/records-compliance.ts:286-298`, na `updateMaintenance`:

```ts
if (existing.reminderId) {
  const reminderData: Record<string, unknown> = {};
  const updated = await prisma.maintenanceRecord.findUnique({ where: { id: recordId } });
  if (updated) {
    reminderData.dueDate = updated.nextDueDate;            // ← incondicional
    reminderData.dueOdometerKm = updated.nextDueOdometerKm; // ← incondicional
    …
  }
  if (Object.keys(reminderData).length > 0) {
    await prisma.reminder.update({ where: { id: existing.reminderId }, data: reminderData });
  }
}
```

As duas atribuições são **incondicionais**: escrevem `null` sobre o alvo do lembrete sempre que o
registo de manutenção não tenha esse alvo. Um `PATCH /maintenance/:id` que deixe o registo sem
`nextDueDate` — ou um registo que só tenha data e cujo lembrete só tenha quilometragem — deixa o
lembrete ligado no **mesmo estado** que o `PC-31`, por um caminho que **não** passa por
`updateReminder` e que, por isso, esta correção não cobre.

**Estado: por leitura, não medido.** A confirmação (um teste de rota que morda) pertence à tarefa
nova; não foi feita aqui por âmbito.

### 6.2 O `trigger: 'both'` exige os dois alvos na criação — declarado, não alterado

`assertCondicao` preserva o comportamento anterior: com `trigger: 'both'`, exige **data e**
quilometragem. Mas `evaluateReminder` aceita `both` com um só alvo (`domain/reminders.ts:117-142`):
bastaria um para o lembrete disparar. É uma restrição **anterior** a este trabalho, mantida de
propósito para não misturar uma decisão de produto com uma correção de invariante. Fica registada
para decisão.

### 6.3 Corroboração (não é achado): a mesma invariante já existia no projeto

`records-compliance.ts:169` cria o lembrete da próxima intervenção sob
`if (nextDueDate !== null || nextDueOdometerKm !== null)`, e deriva o `trigger` dos alvos que
existem (`:175`). É a **mesma regra** — sobre o estado, não sobre o pedido — que o `AUD-015` passou
a aplicar em `createReminder` e `updateReminder`. A escolha não é nova no projeto; estava só
ausente no caminho dos lembretes.

### 6.4 Consequência no cliente: o formulário da web permite pedidos que passam a ser recusados

Não é um defeito novo, mas é uma consequência da decisão de §1.3 e vive numa frente que não é a
minha (`apps/web`, A3), por isso fica registada e **não** tocada.

`apps/web/src/pages/records/RemindersPage.tsx`:

- `:67` — o `trigger` **por omissão é `'both'`**;
- `:68` — a data vem pré-preenchida com `today()`;
- `:94-95` — o `intervalKm` é enviado **sempre que preenchido**, sem exigir uma quilometragem alvo;
- `:207-215` — o campo «Quilometragem limite» mostra `Sem leitura registada.` quando não há leitura,
  mas **não** impede o envio.

Medido contra o código atual, com o pedido que o formulário produz por omissão
(`{trigger:'both', dueDate: hoje, repeat:true}`, sem quilometragem e sem intervalos):

```
422 · "Um lembrete por quilometragem precisa de uma quilometragem alvo. Indica-a, ou um intervalo
a partir da quilometragem atual — que exige uma quilometragem já registada no veículo."
```

**Este caso é anterior ao `AUD-015`:** a guarda que existia tinha a mesma condição para este pedido
(`trigger !== 'time' && ausente(input.dueOdometerKm) && ausente(input.intervalKm)`). O que **é** novo
é o caminho estreito em que o utilizador preenche `intervalKm` num veículo **sem** quilometragem
registada: antes devolvia 201 com um lembrete morto, agora devolve 422. É o comportamento decidido e
a mensagem diz o que falta — mas o cliente devia **prevenir** em vez de deixar falhar, e isso é
trabalho de A3.

**Achado por leitura do formulário + medição do lado do servidor; o formulário não foi corrido num
browser.**

---

## 7. Blocos prontos a integrar no `ROADMAP.md`

### 7.1 Tabela de §4 — `:268`

Só o estado muda (`READY` → `DONE`):

```
| AUD-015  | Auditoria    | `PATCH /reminders/:id` aceita um estado sem condição (PC-31) | A1     | P2         | `DONE`    | AUD-014                 |
```

### 7.2 Tabela de §2 — `PC-31` (`:139`), coluna de estado

Substituir `Aberto — \`AUD-015\`` por:

```
**Fechado** por `AUD-015` (2026-09-22) — a edição passa a validar o **estado final** com a mesma `assertCondicao` da criação, antes de gravar; provado por mutação (M1: 3 vermelhos; M3: o 422 mantém-se mas a asserção «não grava» é a que falha)
```

### 7.3 `AUD-015` — registo de implementação, a inserir depois da nota de `:838-839`

```markdown
**Implementação e provas (A1, 2026-09-22):**

- **Correção:** `createReminder` e `updateReminder` passam a partilhar **uma só** função,
  `assertCondicao` (`services/reminders.ts:602`), que decide pelo **alvo** que fica gravado
  (`dueDate` / `dueOdometerKm`) e não pelo campo do pedido. Na edição, o estado validado é o
  **resultado** — cada campo vale o que o pedido traz ou o que já lá estava quando o pedido o omite.
  A escrita passou a estar dentro de `try/catch` com `translatePrismaError`, como na criação.
- **A premissa era maior do que a tarefa.** Ao verificar a criação para a poder partilhar,
  mediu-se que a guarda do `AUD-014` testava o **pedido** antes de o intervalo ser materializado:
  `POST {trigger:'distance', intervalKm:N}` num veículo **sem odómetro** devolvia 201 com
  `dueOdometerKm: null` e `state: 'unknown'` — o estado exato que o `AUD-014` veio eliminar. O teste
  positivo que o `AUD-014` acrescentou fixava-o como esperado (afirmava o `intervalKm`, nunca o
  alvo): um **falso verde introduzido pela própria correção**.
- **Decisão de política (do utilizador, não inferida):** esse pedido passa a devolver **422** e a
  não persistir. Consequência declarada: o comportamento da **criação** muda neste caso e o teste
  positivo de `AUD-014` foi corrigido — o veículo passa a ter odómetro e a asserção passa a ser
  sobre o alvo. **A alegação do teste mantém-se** (a guarda não é demasiado larga); muda a montagem.
- **Testes:** `test/reminders-http.test.ts` — `47 → 53`. O teste positivo do intervalo em km
  corrigido, um caso novo de recusa na criação, e uma secção `§1b` de edição com cinco testes
  (apagar a data, apagar o alvo e trocar o `trigger`: 422 **e** não grava; manter a condição e não
  tocar nela: 200).
- **Prova por mutação (3 mutações, todas sobre o serviço, repostas e confirmadas por `sha256`):**
  M1 — a edição deixa de validar → **3 vermelhos**, os três testes de recusa; M2 — a criação volta a
  validar o pedido → **1 vermelho**, a recusa do intervalo sem odómetro, o que mostra que a regra
  partilhada é a que decide; M3 — a edição valida **depois** de gravar → **3 vermelhos**, e o
  detalhe medido é `expected null to be '2026-12-01'`, ou seja falha a asserção **«não grava»** e
  não o estado da resposta. Ficheiro reposto byte a byte (`e4f46c21…`).
- **Verificações:** suíte da API **1713/1713**, exit 0 (1707 + os 6 novos); `typecheck` exit 0;
  `verify:config` 12/12; `verify` **235 verificações**; `verify:regressions` **70**.
- **Achados novos (proposta, sem IDs):** (a) `records-compliance.ts:290-291` grava `dueDate` e
  `dueOdometerKm` do lembrete ligado **incondicionalmente** a partir do registo de manutenção — a
  mesma forma do `PC-31`, por um caminho que não passa por `updateReminder` (por leitura, não
  medido); (b) o formulário da web (`RemindersPage.tsx:67-97`) produz por omissão um pedido que é
  recusado e envia `intervalKm` sem exigir quilometragem alvo — o cliente devia prevenir em vez de
  deixar falhar (frente de A3; ver §6.4).
- **Sem commit.**
```

### 7.4 `AUD-014` — nota de correção, a acrescentar ao fim do registo de `:802-817`

```markdown
- **Correção de um falso verde, em `AUD-015` (2026-09-22):** o teste positivo do intervalo em km
  (`:239`) afirmava o `status` e o `intervalKm`, nunca o `dueOdometerKm` — e o lembrete criado tinha
  `dueOdometerKm: null` e `state: 'unknown'`, porque o veículo não tinha quilometragem de partida.
  Passava a fixar como esperado exatamente o estado que esta tarefa veio eliminar. Corrigido em
  `AUD-015`, com o veículo a ter odómetro e a asserção sobre o alvo. **A alegação do teste não
  mudou** — a guarda não é demasiado larga; o que estava errado era a montagem.
```

---

## 8. Âmbito

**Dentro:** `apps/api/src/services/reminders.ts` (`createReminder`, `updateReminder`, a função
partilhada) e `apps/api/test/reminders-http.test.ts`.

**Fora, declarado e respeitado:**

- `docs/ROADMAP.md` — **não tocado** (`sha256` idêntico ao início da sessão). Toda a integração é
  proposta em §7.
- `packages/shared/src/contracts.ts:604` — a tarefa listava-o nos *Ficheiros*, mas não é preciso
  tocar-lhe: `zReminderUpdateRequest.partial()` **não é o defeito**; o defeito era o serviço não
  validar o resultado. Alterar o contrato teria sido a correção errada — tornaria o `null` inválido
  para todos os campos, incluindo os que não têm nada a ver com a condição.
- `records-compliance.ts` — achado de §6.1, proposto e não corrigido.
- O `trigger: 'both'` (§6.2) — preservado.
- `PC-15`, `PC-26`, `PC-32`, `PC-33`, `PC-34` — não tocados.
- **Sem commit, sem push, sem deploy.**

**Sem resíduos:** os temporários desta sessão (cópia do teste, `tsconfig` restrito, scripts da
bateria de mutação) vivem fora do repositório, em `%TEMP%\zemlo-aud015\`, e são removidos para a
Reciclagem no fim.
