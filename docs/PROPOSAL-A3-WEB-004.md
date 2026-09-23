# Proposta de A3 a A9 — `WEB-004` · os ecrãs de lista que faltavam em `/records/:kind`

> **SOU O A9.**
>
> **Estado:** `WEB-004` **implementada e provada**. Proposta de fecho de `WEB-004` e **quatro
> achados novos** propostos (`PC-52`…`PC-55`) — **não** tratados.
> **Produção alterada:** 1 ficheiro — `RecordsPage.tsx`. **Testes:** `records-kind.test.tsx`
> (ajustado, era de `AUD-008`) e `records-lists.test.tsx` (**novo**, 15 testes).
> **Contratos partilhados:** **não tocados**. `packages/shared` fica exatamente como estava.
> **Sem commit, sem push, sem deploy.** `docs/ROADMAP.md` **não foi tocado** — a integração é de A9.
>
> **Correção de numeração (2.ª ronda, 2026-09-23).** A 1.ª versão desta proposta alocou
> `PC-49`…`PC-52`. Estava **errada**: A9 já tinha atribuído `PC-49`, `PC-50` e `PC-51` a achados
> de **A4** (`PROD-004`/`PROD-007`) ao consolidar o ROADMAP, pelo que o máximo era 51 e o primeiro
> livre era `PC-52`. Os meus quatro achados passam a **`PC-52`…`PC-55`** (§7); o próximo livre é
> **`PC-56`**. É exatamente a colisão que a regra «`máximo+1`, nunca compactar» existe para evitar —
> e a folga de 4 números que ela deixa não chegou, porque três tinham sido ocupados entre a minha
> medição e a integração.

---

## 1. Diagnóstico

### 1.1 O que a tarefa pedia, e o que já estava feito

A definição de `WEB-004` no ROADMAP (`:1463`) diz, textualmente:

> «O fallback silencioso já não existe… O que falta é o que sempre foi desta tarefa — os
> **ecrãs** de inspeções, impostos, seguros e odómetro.»
>
> «**Critérios:** ecrãs corretos para inspeções, impostos, seguros e odómetro; sem fallback
> silencioso.»

O segundo critério foi entregue por `AUD-008` (a recusa `UnknownRecordKind`). O que faltava era o
**primeiro**: quatro ecrãs de lista. O ROADMAP indicava o caminho:

> «Ao acrescentar uma entrada a `RECORD_CONFIG`, a recusa de `AUD-008` deixa de se aplicar a esse
> tipo sem mais nenhuma alteração.»

### 1.2 O que já existia, verificado por leitura (não por suposição)

| Peça | Onde | Estado antes de eu tocar em nada |
| --- | --- | --- |
| Contratos `InsurancePolicy`, `InspectionRecord`, `TaxRecord`, `OdometerReading` | `packages/shared/src/types.ts` | **já existem**, completos |
| Endpoints de lista `GET /records/insurance\|inspections\|taxes` | `apps/api/src/http/routes/compliance.ts:85-94` | **já existem**, com `zListQuery` |
| Endpoint de leitura de odómetro `GET /vehicles/:vehicleId/odometer` | `apps/api/src/http/routes/vehicles.ts:132` | **já existe** |
| Fetchers `fetchInsurance` / `fetchInspections` / `fetchTaxes` | `apps/web/src/api/queries.ts:200-216` | **já existem** |
| Hooks `useInsurance(v?)` / `useInspections(v?)` / `useTaxes(v?)` | `apps/web/src/api/hooks.ts:346-362` | **já existem** |
| `useOdometerReadings(vehicleId)` | `apps/web/src/api/hooks.ts:178` | **já existe**, `enabled: Boolean(vehicleId)` |
| Ecrã de **detalhe** para os quatro tipos | `apps/web/src/pages/records/RecordDetailPage.tsx:208` | **já trata os quatro** |
| Ecrã de **lista** para os quatro tipos | — | **É O QUE FALTAVA** |

Conclusão da leitura: a tarefa **não** exigia contratos novos, migrações, nem endpoints. Exigia os
ecrãs. Isto determina o âmbito inteiro — e é a razão pela qual a regra 5 do pedido («não alterar
`packages/shared` sem declarar o impacto») foi cumprida por **não alterar nada**.

### 1.3 A assimetria que decidiu o desenho

Três dos quatro tipos são iguais em forma; o odómetro **não é**. Medido no código da API:

| | seguros / inspeções / impostos | odómetro |
| --- | --- | --- |
| rota de lista | `GET /records/<tipo>` | **não existe** `/records/odometer` |
| filtro por veículo | `zListQuery.vehicleId` é **`.optional()`** → omitir agrega a conta inteira | `requireVehicleAccess(userId, vehicleId)` → **exige** veículo |
| filtro por datas | **não** existe no contrato | não existe |
| resposta | `{ items, total }` | `{ items, total }` |

O repositório já tinha declarado esta assimetria por escrito, em `useFocusedVehicleId`
(`apps/web/src/hooks/index.ts:186-190`):

> «O dashboard e as estatísticas aceitam a conta inteira; a ficha do veículo, o seguro e os
> lembretes não — não existe "seguro de todos os carros".»

A leitura mostra que a asserção «o seguro não» está **desatualizada**: a API aceita `vehicleId`
opcional em `/records/insurance`, pelo que o seguro **pode** agregar a conta. Foi isso que permitiu
as três listas de conformidade agregarem quando a seleção é `'all'`, e o odómetro — que é o único
que realmente não pode — resolver para um veículo concreto. É a decisão de desenho central desta
tarefa, e está registada em `PC-55` (ver §7).

---

## 2. Ficheiros alterados

| Ficheiro | Alteração | Linhas | sha256 final |
| --- | --- | --- | --- |
| `apps/web/src/pages/records/RecordsPage.tsx` | **implementação** — 4 entradas novas em `RECORD_CONFIG`, 3 consultas novas, `needsVehicle`, apresentadores por tipo | 464 → **753** | `c979f9173147e63d0f4d5335a068dd22bb5e3f90cc47a627d090f3662b689aab` |
| `apps/web/test/records-kind.test.tsx` | **ajustado** — os tipos que passaram a ter ecrã saem da lista de recusa | 112 → **130** | `a7ac94af3f56f408c34689d315f7ea0f5e522a34f4d8f88806ac96fe6923a125` |
| `apps/web/test/records-lists.test.tsx` | **novo** — 15 testes | **401** | `6c520b2dad02e8d78b1d10411e93151b587260fcf8570e7015f5cbd0bbe8fab3` |
| `docs/PROPOSAL-A3-WEB-004.md` | esta proposta | — | — |

`git diff --numstat` (só a frente web, sem resíduos de outros agentes):

```
455	179	apps/web/src/pages/records/RecordsPage.tsx
 24	  5	apps/web/test/records-kind.test.tsx
```

### 2.1 O que mudou no ecrã, em concreto

1. **`ListKind`** (`'expenses' | … | 'odometer'`) — as chaves de lista, coincidentes com os
   segmentos de rota. As chaves de **detalhe** já eram resolvidas por `fetchRecordDetail`, que
   mapeia `insurance → insurance`, `inspection → inspections`, `tax → taxes`.
2. **Quatro entradas novas** em `RECORD_CONFIG`: `insurance`, `inspections`, `taxes`, `odometer`,
   cada uma com título, subtítulo, ícone, coluna principal, coluna de data e texto de estado vazio
   **próprios**.
3. **Três consultas novas** (`useInsurance`/`useInspections`/`useTaxes`) e a de odómetro
   (`useOdometerReadings`), todas declaradas **sempre** — a regra dos hooks que o ficheiro já
   documentava. Entram no mapa `queries` indexado pelo tipo.
4. **Duas bandeiras novas em `RecordConfig`**, com efeito visível:
   - `period` — os chips e as datas só aparecem nos tipos cujo endpoint **aceita** `from`/`to`.
     Nos de conformidade seriam um controlo que não controla nada.
   - `requiresVehicle` — o odómetro, sem veículo, mostra uma **instrução** («Adicionar veículo»)
     em vez de uma lista vazia, que diria «não há leituras» — falso.
   `addable: false` nos impostos e inspeções: não se criam pela folha de registo rápido, cujos
   campos (valor, categoria, data) não incluem o resultado/estação/ano/prazo que aqueles tipos
   exigem. Um botão que promete o que não faz é pior do que a ausência do botão.
5. **Apresentadores por tipo**: `recordIcon`, `recordTitle`, `recordDate`, `recordMeta`,
   `recordMeasure`, `recordAmount` ganharam o ramo dos quatro tipos novos. A tradução usa os
   conjuntos de opções que **já estavam** em `registry.ts` (`INSURANCE_COVERAGES`, `TAX_KINDS`,
   `INSPECTION_RESULTS`) via `optionLabel` — sem tabelas de tradução novas, que é a razão pela
   qual um código novo na API aparece automaticamente correto.

### 2.2 O que **não** mudei, deliberadamente

- `packages/shared` — **zero** linhas. Nenhum contrato novo era necessário (§1.2).
- `apps/api` — **zero** linhas. Nenhum endpoint novo era necessário.
- Schema/migrações — **zero**.
- O ecrã de **detalhe** (`RecordDetailPage.tsx`) — já tratava os quatro tipos.
- A recusa `UnknownRecordKind` — mantida, e **continua a valer** para tipos que não existem (§4.1).
- `fetchTaxes` devolve `Page<Record<string, unknown>>` embora `mapTax` (`domain/payload.ts:494`)
  produza exatamente o `TaxRecord` do contrato. Apertar o tipo é possível **sem** tocar em
  `packages/shared`, mas é trabalho fora do âmbito — registado como `PC-54`, **não** feito.

---

## 3. Comportamento antes/depois

| Endereço | Antes | Depois |
| --- | --- | --- |
| `/records/insurance` | recusado (`AUD-008`) | **lista de seguros** — seguradora, cobertura, fim de apólice, prémio; agrega a conta |
| `/records/inspections` | recusado | **lista de inspeções** — resultado em português, estação, próxima data, custo |
| `/records/taxes` | recusado | **lista de impostos** — tipo em português, ano, pago/por pagar, prazo |
| `/records/odometer` | recusado | **lista de leituras** — data da leitura, origem, km; exige veículo |
| `/records/nao-existe` | recusado | **recusado** (inalterado) |
| `/records/inspection` (singular) | recusado | **recusado** — é alias de detalhe, não de lista |
| `/records/expenses`, `fuel`, `charging`, `maintenance` | lista | **inalterado**, com todos os filtros |

---

## 4. Testes executados e resultados reais

### 4.0 Resultado global

`vitest run --no-file-parallelism` em `apps/web/`, **exit 0**:

```
ficheiros 11 | total 243 | passados 243 | falhados 0
  ok   accessibility.test.tsx               -> 28
  ok   bundle-import-transport.test.ts      ->  7
  ok   calendar-month-label.test.tsx        -> 19   (WEB-010, intacto)
  ok   contraste-tokens.test.ts             -> 58
  ok   csv-import-read-model.test.ts        -> 50
  ok   csv-import-transport.test.ts         -> 17
  ok   email-verification-ui.test.ts        -> 14
  ok   page-states.test.tsx                 -> 11
  ok   records-kind.test.tsx                ->  7   (ajustado, era AUD-008)
  ok   records-lists.test.tsx               -> 15   (novo)
  ok   session-refresh.test.ts              -> 17
```

Repetido **duas vezes**, com o mesmo resultado (11/11, 243/243, exit 0).

Todos os números vêm do `--reporter=json` e não da saída `verbose`, cujas linhas começam por
sequências ANSI e fazem um `grep '^✓'` devolver sempre zero. Uma suite que corre **zero** testes
também devolve «0 falhados» — o driver exige `numTotalTests > 0` antes de aceitar um verde.

**Uma nota sobre `--no-file-parallelism`, porque não é cosmética:** com o paralelismo por omissão,
três corridas seguidas **não** recolheram todos os ficheiros — 10/11, 8/11 e 9/11, sempre com
**0 falhados** nos que correram, e sempre um par **diferente** de ficheiros em falta
(`records-lists`, depois `bundle`+`csv-*`, depois `accessibility`+`calendar-month-label`). É uma
falha de **recolha** transitória sob carga, não um teste vermelho: o `exit 1` do vitest vinha da
recolha, e o relatório não trazia `unhandledErrors`. Como dois dos conjuntos em falta incluem
ficheiros que **não toquei** (`calendar-month-label`, `accessibility`), o defeito não é meu — mas
uma leitura descuidada do relatório daria «os testes passam» quando a suite não chegou a correr
toda. Em série a recolha é estável: **11/11, exit 0, duas vezes**. Fica registado como observação
de infraestrutura de teste, **não** como achado de produto.

**E `--no-cache`, desde que A4 mediu a armadilha.** A cache de transformação do Vite/vitest pode
servir **módulos antigos**: A4 registou (no `MEMORY.md`) que `node_modules/.vite/vitest` devolveu um
`RecordsPage.tsx` **pré-`WEB-004`** e que o *mesmo* ficheiro falhava em **testes diferentes a cada
execução**. É a explicação mais provável para os vermelhos que não reproduzem (§7.0). Todas as
medições desta 2.ª ronda foram corridas com **`--no-cache --no-file-parallelism`**.

**Uma corrida a partir da raiz, para não esconder nada.** Corri também `vitest run` **sem filtro de
caminho**, a partir da raiz: recolheu **65 ficheiros** (api + web + packages) e saiu **1**, com
**53 falhados — todos em `apps/api`**, em ficheiros que **não toquei**. Atribuição medida, não
suposta:

| Ficheiro | Falhas | Causa real (da mensagem, não minha) |
| --- | --- | --- |
| `import-spec13.test.ts` | 39 | `spawnSync C:\WINDOWS\system32\cmd.exe EBUSY` em `test/helpers/db.ts:94` (`createTestDb`) |
| `import-export-cycle.test.ts` | 11 | idem — o hook de criação da BD de teste não chega a correr |
| `document-storage.test.ts` | 3 | `Hook timed out in 10000ms` |

Nenhuma é uma asserção sobre comportamento: são **falhas de ambiente** (o `EBUSY` do `spawnSync`
aninhado, já conhecido nesta bancada, e um `hookTimeout` de 10 s). O meu âmbito é `apps/web/`, e a
suite web isolada é **243/243 exit 0**. Não são minhas, e não as corrigi — mas ficam ditas, porque
uma suite que sai 1 na raiz não deve ser silenciada.

### 4.1 Ajuste ao teste de `AUD-008` — `records-kind.test.tsx`

A negociação desta alteração é o ponto mais delicado da tarefa. O teste de A1 afirmava que
`/records/insurance` era **recusado**. Ao construir o ecrã, essa asserção passa a ser **errada** —
não porque o teste estava mal, mas porque afirmava um estado do produto que a tarefa foi
construída para mudar. O ROADMAP de `AUD-008` previa-o explicitamente.

O que fiz, e porquê:

- a lista de recusa passou a conter **só** tipos que não existem em lado nenhum:
  `['nao-existe', 'inspection', 'tax', 'seguro', 'inspecoes']`. Incluí deliberadamente **formas
  singulares/aliases** para fixar que a tabela é indexada por **segmento de rota de lista**, e que
  o alias de detalhe (`inspection`) não abre um ecrã de lista;
- os quatro tipos novos passaram para o bloco «os tipos legítimos continuam a funcionar»,
  com asserção de que a recusa **não** aparece;
- a asserções de degradação (`not.toContain('Nova despesa')` / `not.toContain('Tudo o que
  gastaste')`) mantiveram-se, agora sobre `nao-existe`.

Resultado: **7/7 verdes**.

### 4.2 O ficheiro novo — `records-lists.test.tsx`

**15 testes, 6 grupos.**

| Grupo | Testes | O que fixa |
| --- | --- | --- |
| cada tipo tem o seu próprio ecrã | 4 | título próprio, estado vazio próprio, **e** ausência do vocabulário de despesas |
| a lista mostra o registo no vocabulário do tipo | 4 | seguradora+cobertura+prémio; resultado traduzido+estação; IUC+ano+por pagar; leitura liga a `/records/odometer/o1` |
| sem filtros que a API ignoraria | 2 | conformidade+odómetro **não** mostram «Últimos 3 meses»; as financeiras **continuam** a mostrar |
| o odómetro exige um veículo concreto | 2 | sem veículo → «Sem veículo para mostrar» + «Adicionar veículo»; conformidade **não** mostra esse estado |
| estados de carregamento e erro | 2 | `LoadingBlock` e `InlineError` continuam a funcionar nos tipos novos |
| cada render parte de uma base limpa | 1 | **regressão do harness** (§7.1): um segundo render no mesmo teste não herda os `items` do primeiro |

### 4.3 Limitação declarada, com honestidade

**A interação não é observável.** Sem `jsdom` — a regra da casa, escrita em `page-states.test.tsx` —
não há eventos. Um teste que clicasse num chip de período, ou que mudasse o veículo selecionado,
não poderia correr. O que os testes provam é o **HTML que o utilizador veria** em cada estado
declarado; o que **não** provam é o que acontece **depois** de um clique. Não simulei um clique de
mentira para dar a impressão de cobertura: está declarado como limitação, no ficheiro e aqui.

### 4.4 Linha de base e prova por mutação

Os resultados exatos, com o `sha256` de cada estado, estão em §4.5. O método:

- **linha de base:** `records-kind.test.tsx` 7/7 verdes; `records-lists.test.tsx` 15/15 verdes;
  ambos com `numTotalTests > 0` (uma suite vazia reporta 0 vermelhos — um falso verde);
- **prova por mutação:** **12 mutações** declaradas contra o código de produção, cada uma com a
  suite que a deve apanhar, **mais 1** contra o próprio harness (M13, §7.1).

### 4.5 Resultado da prova por mutação

Comando: `bash .workbuddy-ai/scratch/run-mutacoes.sh` — **12 mutações contra o código de produção,
12 mortas, 0 sobreviventes**. A mais 1 contra o próprio harness (M13, §7.1).

| # | Mutação | Suite julgada | Vermelhos |
| --- | --- | --- | --- |
| M1 | `configFor` volta a degradar para despesas num tipo ausente (o defeito de `AUD-008`) | `records-kind` | **3/7** |
| M2 | a entrada `insurance` desaparece do mapa | `records-lists` | **5/15** |
| M3 | a entrada `inspections` desaparece do mapa | `records-lists` | **4/15** |
| M4 | a entrada `taxes` desaparece do mapa | `records-lists` | **4/15** |
| M5 | o odómetro deixa de exigir veículo | `records-lists` | **1/15** |
| M6 | a conformidade passa a mostrar o filtro de período que a API não filtra | `records-lists` | **1/15** |
| M7 | a coluna de data da apólice volta a ser «Data» | `records-lists` | **1/15** |
| M8 | o estado vazio dos impostos passa a ser o das despesas | `records-lists` | **1/15** |
| M9 | o título de secção das inspeções passa a «Manutenção» | `records-lists` | **1/15** |
| M10 | o resultado da inspeção deixa de ser traduzido | `records-lists` | **1/15** |
| M11 | o odómetro devolve o título genérico de manutenção | `records-lists` | **1/15** |
| M12 | os títulos das conformidades passam todos a «Despesas» | `records-lists` | **1/15** |
| M13 | `renderWith` volta a **acumular** sobre a configuração anterior (harness) | `records-lists` | **1/15** |

Os valores são os da **segunda medição**, contra o ficheiro de 15 testes (a 1.ª foi contra o de 14:
M2 `4/14`, M3 `3/14`). M2 e M3 sobem com o teste novo, o que é o comportamento certo — a mutação
que apaga a entrada do mapa também derruba o teste de isolamento.

Reposição confirmada por `sha256`: `c979f9173147e63d0f4d5335a068dd22bb5e3f90cc47a627d090f3662b689aab`.

#### Três coisas que a prova obrigou a corrigir, e que ficam ditas

**(a) Uma mutação foi substituída porque era inerte.** A primeira versão de M1 era
`?? RECORD_CONFIG.expenses`, e o driver mostrou-a **viva** contra `records-lists`. Não era um falso
verde do teste: era uma **mutação sem efeito**. Para `insurance`/`inspections`/`taxes`/`odometer` o
lado esquerdo do `??` existe, pelo que o ramo nunca dispara — a mutação só é observável para tipos
**ausentes** do mapa. Corrigi-a de duas formas: passou a ser julgada contra a suite que a pode
apanhar (`records-kind`), e o `expect` documenta a razão. Uma mutação inerte julgada contra o
ficheiro errado produz um «sobrevivente» que não significa nada — e teria sido reportado como uma
falha dos testes, que não existia.

**(b) O harness mutava o ficheiro errado, com o `sha256` a confirmar.** A primeira versão lia o
**ficheiro de trabalho** e guardava-o em memória como «original». Como cada invocação é um processo
novo, o `restore` de um run posterior leu o ficheiro já **mutado** e tomou-o por original — chegando
a escrever a mutação de volta no repositório com o `sha256` a confirmá-la. Detetei-o porque o
`restore` reportou um `sha256` diferente do esperado. Corrigi-o com uma cópia **imutável**
(`RecordsPage.pristine.tsx`), verificação contra um valor **fixo** (não contra o que encontro), e uma
**guarda de arranque** que aborta se o ficheiro não estiver no estado original — a guarda disparou
de facto, uma vez, e evitou um run inválido. Fica registado porque o mesmo erro, noutro harness,
produziria uma prova que parece boa e não é.

**(c) O resumo do driver contava mal — e a correção apanhou-a.** Na 2.ª medição (ficheiro de 15
testes) o driver imprimiu **«12/16 mutações mortas»**, quando as mutações são 12. Não era um
sobrevivente escondido: era um **defeito de contagem meu**. O `read_result` publicava uma variável
chamada `TOTAL` com o número de **testes** (`r.numTotalTests`), que **colidia** com o contador de
mutações `TOTAL` do mesmo script — a cada iteração, `TOTAL=$((TOTAL+1))` partia do número de testes
do último ficheiro, e o resumo final era `testes+1` (`14+1=15` na 1.ª medição, `15+1=16` na 2.ª).
O `rename_total()` existia precisamente para contornar isto, mas copiava na direção errada.

Corrigido: o `read_result` publica `TOTAL_TESTS` directamente e o shim desapareceu. Os rótulos
(`MORTA | x/y vermelhos`) nunca estiveram errados — só a linha final. Fica registado porque um
denominador errado num resumo de prova é o sítio exato onde alguém lê «sobreviveu» onde não
sobreviveu nada; a classificação de cada mutação é feita por `FALHAS`/`TOTAL_TESTS`, não pelo
contador, e não foi afetada.

---

## 5. Typecheck

| Comando | Resultado |
| --- | --- |
| `tsc --noEmit -p apps/web/tsconfig.json` | **exit 0** |
| `PC-15` — `tsconfig` restrito fora do repo, a cobrir `apps/web/src` **e** `apps/web/test` | **exit 0**, **86 ficheiros** de `apps/web` |

Ambos **re-corridos depois da alteração ao harness** (§7.1): o ficheiro de teste passou de 14 para
15 testes, e as duas verificações mantêm-se verdes.

O `typecheck` da app **exclui** `apps/web/test/` (`tsconfig.json` → `include: ["src", …]`), pelo
que um verde ali não diz nada sobre os testes. É a armadilha de `PC-15`, e é por isso que a segunda
linha existe. Configuração usada: `%TEMP%\zemlo-web-tscheck\tsconfig.web004.json`, com `"types": []`,
`typeRoots` absoluto para `<raiz>/node_modules/@types`, `paths` absoluto para
`packages/shared/dist/index.d.ts` e `vite-env.d.ts` em `files`.

### 5.1 Esta verificação encontrou um erro **real** — e foi provado que morde

O `PC-15` apanhou 8 erros `TS2339` no teste novo: o mock usava `options.activeKind` mas o tipo
`Options` não declarava o campo, e o `as Options & { activeKind: string }` escondia-o. **O
`typecheck` da app nunca o veria** — `test/` está fora do `include`. Corrigido: `activeKind` passou a
ser um campo declarado de `Options`, com docstring, e o cast desapareceu.

E provei que o verificador **morde**, em vez de assumir que sim: injetei um erro de tipo
deliberado (`const __probe: number = renderWith("taxes", {})`), confirmei que o `tsc` o reporta
(`records-lists.test.tsx(152,7): error TS2322: Type 'string' is not assignable to type 'number'`,
**exit 2**) e repus — conferindo o `sha256` de volta a `6c520b2d…` e o `exit 0` depois de reposto.
Um verificador que sai `0` sempre não verifica nada. (A injeção foi repetida nesta 2.ª ronda, sobre
o ficheiro já com os 15 testes, precisamente porque o ficheiro mudou.)

---

## 6. Critérios de `WEB-004` comprovados

| Critério | Como está comprovado |
| --- | --- |
| «ecrãs corretos para inspeções, impostos, seguros e odómetro» | um teste por tipo que afirma título, estado vazio e coluna **próprios**, *e* a ausência do vocabulário de despesas; a mutação que remove a entrada do mapa põe esse teste vermelho |
| «sem fallback silencioso» | herdado de `AUD-008`, e **reprovado** por: a recusa continua verde para `nao-existe`/`inspection`; o odómetro sem veículo explica em vez de mostrar vazio; a conformidade não mostra filtros que a API ignora |

---

## 7. Achados fora de âmbito — **propostos, não tratados**

Nenhum destes foi corrigido. Ficam para decisão de A9.

### 7.0 Uma observação de A9 sobre `:530` — verificada e **refutada** contra o estado entregue

Durante a revisão de `INT-001`, A9 registou em
`.workbuddy-ai/memory/2026-09-23.md:1131` um achado sobre este ficheiro:

> «`apps/web/src/pages/records/RecordsPage.tsx:530` — `taxes.emptyTitle = 'Ainda sem despesas'` em
> vez de `'Ainda sem impostos'` (copia de `:447`). […] **Estado real de `WEB-004`: 13/14** […]
> a corrigir pelo A3.»

**Verifiquei-o e não se confirma no estado entregue.** Medido agora:

```
$ grep -n "emptyTitle" apps/web/src/pages/records/RecordsPage.tsx
447:    emptyTitle: 'Ainda sem despesas',
461:    emptyTitle: 'Ainda sem abastecimentos',
475:    emptyTitle: 'Ainda sem carregamentos',
489:    emptyTitle: 'Ainda sem manutenções',
503:    emptyTitle: 'Ainda sem apólices',
516:    emptyTitle: 'Ainda sem inspeções',
530:    emptyTitle: 'Ainda sem impostos',     <-- correto
544:    emptyTitle: 'Sem veículo para mostrar',
```

E por sonda direta ao HTML, com o ecrã de impostos renderizado:

```
tem "Ainda sem impostos": true
tem "Ainda sem despesas": false
```

**Oito dos oito textos estão corretos.** O achado de A9 apanhou um **estado intermédio** do
ficheiro — a nota de A9 diz explicitamente que o viu com `mtime 17:00:06` e que «a frente de A3
[estava] ainda em curso — nao tocar». Ao escrever a tabela de configs não o fiz numa só passagem;
durante essa janela o `taxes.emptyTitle` esteve, de facto, com o texto das despesas.

Duas consequências, e a segunda é a que importa:

1. **Nada a corrigir no estado entregue** — o ficheiro atual tem os oito títulos certos, e o
   `sha256` que o prova é `c979f917…`.
2. **O achado era legítimo e útil.** A mutação `M8` da minha prova (§4.5) é *exatamente* esse
   defeito — trocar o estado vazio dos impostos pelo das despesas — e o teste apanhou-o (1/15
   vermelho). Ou seja: a asserção que A9 usou para detetar o problema **é a mesma família** que a
   minha suite já fixa, e teria impedido que ele chegasse ao `main`. Não há aqui conflito de
   leituras: houve um estado transitório, e agora há uma prova permanente de que não volta.

Registo isto porque A9 pediu «prova, não afirmação», e a resposta certa a um achado sobre o nosso
próprio trabalho é medi-lo — mesmo quando a conclusão é «já não se aplica».

#### Cronologia medida — A9 mediu um ficheiro que já não é este

A consolidação de A9 voltou a registar este achado e a **bloquear `WEB-004`** por causa dele
(`2026-09-23.md:1143`: «WEB-004 **nao** pode ir a DONE/REVIEW sem isso»). Por isso a medição foi
refeita, com as horas de cada artefacto:

| Artefacto | `mtime` | `sha256` |
| --- | --- | --- |
| `RecordsPage.tsx` **entregue** | **17:05:48** | `c979f917…` |
| `mutacoes.log` (prova M8 contra o entregue) | **17:05:50** | — |
| `RecordsPage.tsx` **visto por A9** | **17:00:06** | (não registado) |

A9 mediu às **17:00:06**; o ficheiro congelado é de **17:05:48** — **5 min 42 s depois**. E o M8,
que é *literalmente* este defeito (`replace("    emptyTitle: 'Ainda sem impostos',",
"    emptyTitle: 'Ainda sem despesas',")`), correu às 17:05:50 **contra o entregue** e está
**MORTO** (1/15 vermelho). Ou seja: o ficheiro entregue **não tem** o defeito, e a suite **morde**
nele.

**Uma inconsistência que fica dita, porque não a consigo reproduzir — e uma causa medida que a
explica melhor.** A9 reportou «`4 failed | 10 passed`, falham **só os 4 testes de `taxes`**». Medi
os dois estados que podiam produzi-lo, em controlado:

| Estado do `RecordsPage.tsx` | Vermelhos em `records-lists.test.tsx` |
| --- | --- |
| **entregue** (`c979f917…`) | **0 / 15** |
| **pré-`WEB-004`** (o de `HEAD`, `fee4ae43…`) | **13 / 15** |
| entregue com **só** o `:530` trocado (M8) | **1 / 15** |

**Nenhum dá 4.** O mecanismo que A9 nomeia (`:530`) produz **1** vermelho, e o estado pré-`WEB-004`
produz **13** — pelo que o que A9 viu não é nenhum dos dois: é um estado **intermédio** da
implementação (a config a ser escrita em várias passagens), ou um **grafo de módulos misturado**.

**A segunda hipótese tem medição independente, e é a mais provável.** A4, ao fechar `INT-001`,
registou no `MEMORY.md` do projeto que a **cache de transformação do Vite/vitest serve módulos
ANTIGOS** — `node_modules/.vite/vitest` devolveu um `RecordsPage.tsx` **pré-`WEB-004`** e o *mesmo*
ficheiro «falhava em testes diferentes a cada execução (4 testes distintos em 6 execuções, sempre 1
falha)». É **exatamente** a assinatura do que A9 viu: vermelhos que **não reproduzem** e que não
fecham com o defeito nomeado. Uma cache velha serve uma versão velha de *parte* do grafo, e o
resultado é um híbrido que não corresponde a nenhum estado real do repositório.

**Consequência prática, e é a única que peço:** re-medir com **`--no-cache`** contra
`RecordsPage.tsx` `c979f917…` e `records-lists.test.tsx` `6c520b2d…`. Com `--no-cache` e
`--no-file-parallelism`, a suite é **15/15 verde** e o defeito nomeado **não existe**. Não afirmo o
que era o snapshot de A9 — não o tenho; digo o que medi, e ofereço a causa medida que o explica.
Antes de manter o bloqueio, vale a pena distinguir **produto** de **cache**.

A ação certa a tirar daqui não é discutir o snapshot: é que **o defeito passa a ter prova
permanente** — era isso que faltava, e agora existe (§4.5, M8).

### 7.1 A hipótese de não-determinismo do harness — testada, **refutada**, e o risco latente fechado

No mesmo registo, A9 levantou uma segunda hipótese, esta sobre o **harness** do teste novo:

> «`renderWith` **muta a variavel de modulo `options`** (`options = { ...options, activeKind: kind,
> ...extra }`) e as fabricas de `vi.mock` fecham sobre essa variavel → estado partilhado entre
> testes, dependente de ordem. É um falso-verde/falso-vermelho.»

**A observação sobre o mecanismo está certa; a consequência que dela tirou não.** O que medi:

1. **Não há fuga entre testes.** Existe `beforeEach(reset)`, que substitui `options` por um objeto
   novo antes de cada teste. O estado acumulado **nunca** atravessa a fronteira de um teste.
2. **Não há dependência de ordem observável.** O ficheiro correu **três vezes seguidas** e o teste
   isolado de `taxes` correu **à parte**: 15/15, 15/15, 15/15 e 1/1 — sempre exit 0. A assinatura de
   dependência de ordem é *falhar em conjunto e passar isolado*; mediu-se **o contrário**.
3. **A acumulação não pode explicar as 4 falhas de A9.** Mutar `renderWith` de volta para a forma
   acumuladora (`{ ...options, … }`) produz **exatamente 1** vermelho no ficheiro de 15 — e esse
   vermelho é o teste **novo** que escrevi para fixar isto (§4.5, M13). Os **14 testes que já
   existiam continuam todos verdes** sob a acumulação. Ou seja: a acumulação era **latente**, nunca
   produziu um vermelho, e portanto não é a causa de nada que A9 tenha visto.

**O risco latente era real, e ficou fechado.** A acumulação nunca mordeu porque nenhum teste
renderizava duas vezes com campos diferentes — mas o próximo que o fizesse herdaria em silêncio o
`items` do render anterior, e passaria a depender da ordem. Corrigido em duas partes:

- `renderWith` **reconstrói** a partir de uma base (`baseOptions()`), em vez de acumular sobre a
  configuração anterior;
- um **teste de regressão** (o 15.º) fixa-o: renderiza `insurance` com uma apólice e a seguir
  `inspections` sem `items`, e afirma que a segunda lista **volta ao estado vazio** em vez de herdar
  a apólice.

E o teste foi provado **discriminante** antes de o dar por bom: com o `renderWith` antigo reposto
por mutação, ele falha com a mensagem esperada (`expected '…' to contain 'Ainda sem inspeções'`) e
**só ele** falha (1/15). Não é um verde por vacuidade — é um teste que morde a coisa que existe para
morder. Ficheiro reposto da cópia imutável e `sha256` conferido: `6c520b2d…`.

A lição que fica registada, porque é a terceira vez nesta tarefa que ela aparece: **uma hipótese de
mecanismo não é uma medição.** A9 identificou corretamente *como* o harness funcionava; o que
faltava era correr o harness para ver *o que ele fazia*. É o mesmo erro que A9 cometeu — e
corrigiu — no `-t "taxes mostra"`.

### `PC-52` — a barra lateral não liga a nenhum dos quatro ecrãs novos

`AppShell.tsx:60-68` lista `Despesas`, `Abastecimentos`, `Carregamentos`, `Manutenção`,
`Lembretes`, `Documentos`. Os quatro ecrãs construídos existem e resolvem por endereço direto, e
`recordHref` (na timeline) já emite as rotas de lista `insurance`/`inspections`/`taxes` — mas não
há **nenhum** caminho na navegação principal até eles. O efeito prático é que a tarefa entrega
ecrãs alcançáveis sobretudo por link; quem usa o menu não os vê.

**Porque não o fiz:** a navegação é o ecrã de outro trabalho, e alterá-la muda o produto (ordem,
agrupamento, possivelmente um sub-menu de «Registos»). É decisão de produto, que o utilizador
reserva para si.

### `PC-53` — `AUD-013`: os `dataGaps` da panorâmica emitem `?sheet=` que cai em `overview` em silêncio

`RecordsPage`/`Dashboard` — os atalhos `?sheet=odometer|expense|fuel|charging` do painel não
correspondem a nenhum separador da ficha do veículo, e `VehicleDetailPage.tsx:138-139` resolve-os
para `'overview'` com um `?? 'overview'` silencioso. É a mesma **família** de defeito que `AUD-008`
(a degradação silenciosa), noutro ecrã.

Já está registado no ROADMAP como `AUD-013`, em `BACKLOG`, e marcado como **decisão de produto**.
**Não toquei nele** — nomeadamente, **não** inventei separadores novos na ficha do veículo, que o
próprio `AUD-013` proíbe como «Primeiro passo».

### `PC-54` — `fetchTaxes` devolve `Page<Record<string, unknown>>` quando o contrato já tem `TaxRecord`

`apps/web/src/api/queries.ts:212`. O mapeador da API (`domain/payload.ts:494`) produz exatamente o
`TaxRecord` de `packages/shared`. Apertar o tipo é uma alteração **só da web** — não exige tocar no
pacote partilhado, porque o tipo já lá está. O docblock de `queryKeys.ts:134-139` até apoia declarar
formas web-side quando faltam no contrato; aqui **não** faltam.

Não o fiz porque é uma alteração de tipagem sem relação com os critérios, e a regra 7 do pedido
manda não aproveitar.

### `PC-55` — o docblock de `useFocusedVehicleId` afirma uma restrição que a API não tem

`apps/web/src/hooks/index.ts:186-190` diz:

> «…a ficha do veículo, o **seguro** e os lembretes não [aceitam a conta inteira] — não existe
> "seguro de todos os carros"».

Medido: `GET /records/insurance` aceita `vehicleId` **opcional** (`zListQuery.vehicleId`), pelo que
omitir o parâmetro agrega a conta — e a lista que construí usa exatamente isso. O comentário está
desatualizado em relação à API, e um comentário que afirma uma restrição inexistente é o que
impede a próxima pessoa de usar a capacidade que existe.

Não o corrigi porque alterar um docblock partilhado de resolução de veículo mexe em código de
outra frente, e a afirmação está no caminho do **seguro** — que agora agrega por decisão minha.
O que fiz foi **documentar a decisão no sítio onde ela vive** (`RecordsPage.tsx`), sem reescrever
o hook. A A9 cabe decidir se o docblock se corrige.

---

## 8. Resíduos

| Ficheiro | Onde | Ação |
| --- | --- | --- |
| `web004-mutacao.cjs` | `.workbuddy-ai/scratch/` | harness de mutação — **fora do repo** |
| `run-mutacoes.sh`, `RecordsPage.pristine.tsx`, `web004-state.json` | `.workbuddy-ai/scratch/` | idem |
| `records-lists.hardened.tsx` | `.workbuddy-ai/scratch/` | cópia **imutável** do teste endurecido, usada para repor e para provar a injeção de tipo |
| relatórios JSON do vitest (`full-web`, `web-scoped`, `web-final`, `preweb004`, `pos-restauro`, …) | `.workbuddy-ai/scratch/` | temporários de medição |
| `mutacoes.log` | `.workbuddy-ai/scratch/` | a prova final, **limpa** (0 ruído de shell) |

Nada disto entra no repositório: `.workbuddy-ai/` está fora da árvore versionada. O ficheiro de
produção foi reposto do `pristine` e o `sha256` **confirmado** (§4.5) — não há stubs de mutação
deixados para trás.

**Uma nota de honestidade sobre o método:** a primeira versão do harness lia o **ficheiro de
trabalho** e guardava-o em memória como «original». Como cada invocação é um processo novo, o
`restore` de um run posterior leu o ficheiro já **mutado** e tomou-o por original — chegando a
escrever a mutação de volta no repositório com o `sha256` a confirmá-la como correta. Detetei-o
porque o `sha256` do `restore` não batia com o esperado, repus a partir de cópia **imutável**
(`RecordsPage.pristine.tsx`) e passei a verificar contra um valor **fixo**, não contra o que
encontro. É a razão pela qual o driver tem agora uma **guarda de arranque** que aborta se o
ficheiro não estiver no estado original. Fica registado porque o mesmo erro, noutro harness,
produziria uma prova que parece boa e não é.
