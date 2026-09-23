# Entrega de A3 a A9 — `MOB-001` e dois achados novos

> **Documento de entrega, não fonte de verdade.** A3 **não** editou `docs/ROADMAP.md` nem
> `docs/DECISIONS.md`, como o pedido exige. O texto abaixo está pronto a integrar. Depois de
> A9 integrar, este ficheiro pode ser apagado.
>
> Estado dos IDs no momento da escrita (2026-09-22, ~12:20): `WEB-*` até `WEB-012`,
> `PC-*` até `PC-31` (com `PC-28`/`PC-29` livres), `MOB-*` até `MOB-006`, decisões até `A31`.

---

## 1. `MOB-001` — proposta de fecho

### 1.1 Linha de §4

```markdown
| MOB-001  | Mobile       | Arquitetura Flutter + cliente do contrato partilhado                   | A3     | P1         | `DONE`     | —                       |
```

### 1.2 Cabeçalho de §5.4

```markdown
#### MOB-001 · Arquitetura Flutter + cliente do contrato partilhado — A3 · P1 · `DONE`
```

### 1.3 Bloco de fecho a acrescentar em §5.4

```markdown
**Fecho (2026-09-22).** Arquitetura decidida e escrita em `apps/mobile/ARCHITECTURE.md`, e o
pacote criado com o cliente do contrato. **O contrato partilhado não foi alterado** — zero
linhas em `contracts.ts`, `types.ts`, `registry.ts`, `index.ts` e `version.ts`, confirmado por
`sha256` antes e depois.

**O problema central, e a decisão.** Em TypeScript «não duplicar contratos» resolve-se com um
`import`. **Em Dart não há forma de importar TypeScript.** A decisão foi **gerar** o lado Dart
a partir da fonte única, em vez de o escrever à mão — e verificar a deriva de forma
executável. O gerador (`apps/mobile/contract/generate.mjs`) lê **duas fontes** porque o
contrato tem duas metades de naturezas diferentes: `types.ts` pela **API do compilador
TypeScript** (as respostas são `interface`, apagadas em tempo de execução — nenhum
`Object.keys` as vê) e o `dist/` compilado por **introspeção** (os pedidos e os conjuntos
fechados são esquemas Zod, que são valores reais).

| Gerado | Quantidade |
| ------ | ---------- |
| `contract_enums.dart` — conjuntos fechados com `wire`/`fromWire` | **15** enums |
| `contract_models.dart` — modelos com `fromJson`/`toJson` | **11** modelos |
| `contract_registry.dart` — rótulos em português, ícones e ordem | **20** tabelas |
| `contract_constants.dart` — `kApiVersion`, `kApiBasePath`, `kPlatformVersion` | 3 constantes |

**Porque é que os rótulos também são gerados.** `EXPENSE_CATEGORIES` não é uma lista de
códigos: cada entrada traz `{ code, label, icon, order }` — «Combustível» com ⛽. É
apresentação partilhada, e se o mobile a escrevesse à mão divergiria da web na primeira
alteração de texto.

**O que não é gerado, e a regra que o substitui.** `packages/shared` também contém
comportamento (`averageChargingPowerKw`, `daysBetween`, `categoryLabel`, `cvToKw`, …). Não é
portado para Dart. **Regra: o servidor calcula, o cliente mostra.** Uma segunda implementação
do mesmo cálculo seria uma segunda fonte de verdade, e a primeira divergência seria silenciosa.
O mecanismo para o caso inevitável (vetores de teste gerados a partir da implementação TS)
está descrito e **não** foi necessário nesta tarefa.

**Cliente HTTP.** `lib/api/` espelha a **semântica** de `apps/web/src/api/client.ts`, não o
código: envelope único traduzido uma só vez (§A11) com código e mensagem de recurso para
respostas sem envelope legível e `requestId` a cair para o cabeçalho `X-Request-Id`; renovação
silenciosa (§A23) com **uma só renovação em voo** — guarda-se a promessa e não um booleano,
porque como a API **roda** o token, dez renovações concorrentes invalidar-se-iam umas às outras
e o utilizador seria expulso sem motivo; uma única repetição do pedido em 401; erro de rede
distinto de erro da API.

**Tokens.** Decisão **diferente da web**, e porquê: o token de acesso (1 h) fica **só em
memória**; o de renovação (90 dias) fica no **armazenamento seguro do sistema**
(Keychain/Keystore). A web usa `localStorage` com o compromisso de XSS documentado e aceite —
o mobile **não herda** essa decisão: não há XSS num cliente nativo e há um mecanismo melhor.
`TokenStore.save()` grava o par completo de uma vez, para não existir um estado intermédio em
que a memória tem o token novo e o armazenamento o antigo (que já foi rodado e já não vale).

**Ficheiros.** `apps/mobile/ARCHITECTURE.md` (arquitetura), `apps/mobile/pubspec.yaml`,
`apps/mobile/analysis_options.yaml`, `apps/mobile/lib/zemlo_mobile.dart`,
`apps/mobile/lib/api/{api_client,api_error,auth_api,token_store}.dart`,
`apps/mobile/lib/contract/generated/*.dart` (gerado),
`apps/mobile/contract/{generate.mjs,verify.mjs,contract-manifest.json}`,
`apps/mobile/test/contract_test.dart`.

**Prova executável.** `node apps/mobile/contract/verify.mjs` → **exit 0**, com três
verificações: (1) o Dart gerado corresponde a `@zemlo/shared`; (2) cada modelo, enum e tabela
do manifesto existe no Dart; (3) cada raiz declarada em `CONSUMED` resolve-se. Tem **pisos
mínimos** (8 modelos, 10 enums, 15 tabelas) porque sem eles um manifesto vazio passaria por
vacuidade.

**Prova por mutação — 3 mutações, cada uma contra uma garantia diferente.**

| # | Mutação | Resultado |
| - | ------- | --------- |
| M1 | editar à mão um campo do Dart gerado (`accessToken` → `accessTokenX`) | **exit 1** — «o Dart gerado não corresponde ao contrato atual» |
| M2 | gerador com bug: escreve o manifesto mas salta um enum no Dart | **exit 1** — «enums no manifesto e ausentes do Dart: FuelType» |
| M3 | declarar em `CONSUMED` um tipo que não existe no contrato | **exit 1** — nomeia o tipo e recusa gerar |

**A M3 apanhou um defeito real no próprio gerador.** Na primeira versão, um tipo inexistente
em `CONSUMED` era **ignorado em silêncio**: o gerador produzia os 11 modelos, escrevia o
manifesto e saía com código 0 — exatamente o que o cabeçalho do ficheiro afirma que ele nunca
faz. O docblock estava errado e foi o **código** que mudou: o gerador passou a validar que
todas as raízes produziram algo (modelo, enum ou alias) e a recusar-se a gerar caso contrário.
Sem a mutação, o defeito passava despercebido.

**Fragilidades do contrato, medidas e escritas no manifesto** (`knownWeaknesses`), não
estimadas: **19 de 19** aliases `CodeOf<…>` de `registry.ts` resolvem para `string` e não para
uma união de literais (causa: `freeze<T extends readonly OptionMeta[]>(items: T): T` com
`OptionMeta.code: string`). Consequência concreta no mobile:
`VehicleSummary.vehicleType` e `.fuelType` são `String`, porque **é isso que o contrato diz**.
O gerador não «melhora» o contrato — melhorá-lo esconderia a diferença em vez de a mostrar.
→ proposta de tarefa própria, abaixo.

**Limitações honestas.**

- **Flutter e Dart não estão instalados no ambiente onde isto foi construído.** `flutter
  analyze` e `flutter test` **não** foram corridos. O que se prova é que o Dart **corresponde
  ao contrato**, não que **compila**. Está escrito no `ARCHITECTURE.md`, no cabeçalho do
  `verify.mjs` e no cabeçalho de `test/contract_test.dart`. O `test/contract_test.dart` está
  **escrito, não provado** — e tem de ser corrido antes de `MOB-002` se apoiar neste cliente.
- **Nenhuma chamada real à API foi feita.** Não há testes de contrato contra um servidor a
  sério; isso é `MOB-002`.
- A verificação de deriva compara ficheiros gerados. Apanha qualquer alteração ao contrato que
  mude a superfície gerada; **não** apanha uma alteração que só mude comportamento em tempo de
  execução sem mudar tipos.

**Validação.** `node apps/mobile/contract/verify.mjs` → exit 0. Suíte **web** → **7 ficheiros /
134 testes / exit 0** (não tocada por esta tarefa; corrida para confirmar que nada regrediu).
`typecheck` do workspace **web** → exit 0. Contrato `packages/shared` intocado (5 ficheiros
verificados por `sha256`).

**Dependências desbloqueadas:** **`MOB-002`** (autenticação no mobile) fica com o cliente
pronto — o `AuthApi` e o `TokenStore` existem e o caminho de renovação está desenhado. As
restantes (`MOB-003`–`MOB-006`) continuam dependentes de `MOB-002`.

**Migrações:** nenhuma. **`docs/API.md`:** nada a alterar — nenhum endpoint novo. **Decisão
arquitetural:** proposta `A32` em `docs/DECISIONS.md` (abaixo).

**Sem commit, sem push, sem deploy.**
```

### 1.4 Fila de A3 em §9

```markdown
| —     | `MOB-001` — Arquitetura Flutter           | P1         | **`DONE`** (2026-09-22) — `apps/mobile` criado, contrato gerado, verificação de deriva com 3 mutações |
| 1     | `MOB-002` — Autenticação no mobile        | P1         | `READY` — desbloqueada por `MOB-001`; **não é considerada operacionalmente concluída enquanto `MOB-007` não passar** |
| 2     | `MOB-007` — Validar o ambiente Flutter (`flutter pub get`, `flutter analyze`, `flutter test`) | P1 | `READY` — **gate do ambiente Flutter**; `MOB-002` não fecha operacionalmente sem ele |
```

### 1.5 Entrada de changelog (fim da tabela de §13)

```markdown
| 2026-09-22 | A3 · `MOB-001` **concluída**: arquitetura do `apps/mobile` decidida e escrita (`ARCHITECTURE.md`) e pacote criado com o cliente do contrato. O problema central é que **Dart não pode importar TypeScript**, logo «não duplicar contratos» exige **gerar**: `contract/generate.mjs` lê `types.ts` pela API do compilador TS (respostas são `interface`, apagadas em runtime) e o `dist/` por introspeção (pedidos e conjuntos fechados são Zod, que são valores), e produz **15 enums**, **11 modelos**, **20 tabelas de registo** com rótulos/ícones e as constantes de versão e caminho base. `contract/verify.mjs` prova três coisas em Node — a única toolchain disponível, porque **Flutter/Dart não estão instalados** — com pisos mínimos anti-vacuidade; **3 mutações** mordem, e a **M3 apanhou um defeito real no gerador** (um tipo inexistente em `CONSUMED` era ignorado em silêncio, ao contrário do que o próprio docblock afirmava): corrigido, o gerador passou a recusar-se a gerar. Cliente HTTP em `lib/api/` espelha a **semântica** (não o código) da web: envelope §A11 traduzido uma só vez, renovação §A23 com **uma só renovação em voo** (guarda-se a promessa, não um booleano — a API roda o token e renovações concorrentes expulsariam o utilizador), uma repetição em 401. Tokens: acesso **só em memória**, renovação no **armazenamento seguro** — decisão **diferente da web**, que usa `localStorage` com o compromisso de XSS documentado; o mobile não herda esse compromisso. **Regra de arquitetura escrita:** *o servidor calcula, o cliente mostra* — as funções de domínio de `packages/shared` **não** são portadas para Dart. Medido e escrito no manifesto: **19 de 19** aliases `CodeOf<…>` resolvem para `string` (→ `PC-32` e tarefa proposta). **Contrato partilhado intocado** (5 ficheiros por `sha256`). Desbloqueia **`MOB-002`**. **Sem commit, sem push, sem deploy.** |
```

---

## 2. Achado novo 1 — a web nunca guarda o token de renovação

**Proposta de ID:** `WEB-013` (é A3, é web, e o `WEB-012` é o último usado).
**Gravidade proposta:** **Alta.** **Estado proposto:** `READY`.

### O que está medido

Três testes escritos e corridos, com `fetch` e `localStorage`/`sessionStorage` simulados e a
**forma exata** que a API devolve (`apps/api/src/services/auth.ts:1389-1406`, que coincide com
o contrato `AuthResponse`/`AuthTokens`). **Resultado: 3 vermelhos, 1 verde, exit 1.**

| Teste | Resultado |
| ----- | --------- |
| o token de acesso é guardado | **verde** |
| o token de **renovação** é guardado a partir de `tokens.refreshToken` | **vermelho** — `expected null to be 'refresh-token-value'` |
| o token de renovação fica no armazenamento persistente | **vermelho** — `localStorage['zemlo.refreshToken']` é `null` |
| um 401 devia renovar em silêncio, sem expulsar o utilizador | **vermelho** — `expected false to be true`: **não é feito nenhum pedido a `/auth/refresh`** |

### A causa, com `ficheiro:linha`

- `apps/web/src/api/client.ts:470` e `:476` — `setTokens(session.tokens, session.refreshToken ?? null)`.
  Lê `session.refreshToken`, um campo de **topo** que a API **não devolve**.
- `apps/web/src/api/client.ts:147-151` — `setTokens(tokens, refreshToken)` **ignora**
  `tokens.refreshToken`, apesar de o parâmetro `tokens` ser do tipo `AuthTokens`, que o tem
  como campo **obrigatório**. O `if (refreshToken)` nunca é verdadeiro, logo a linha de escrita
  no `localStorage` nunca corre.
- `apps/web/src/api/client.ts:229` — a renovação tem o mesmo erro **e um segundo**: cai para
  `?? refreshToken`, o token **antigo**, que a API já rodou. Mesmo com o armazenamento
  corrigido, guardaria um token inválido.
- `apps/web/src/api/client.ts:451-453` — `interface AuthResponse extends AuthSessionResponse { refreshToken?: string }`
  declara o campo de topo que não existe. **O docblock em `:442-449` afirma que o tipo
  partilhado «descreve apenas `{ user, tokens }`» — é falso:** `AuthTokens.refreshToken` existe
  e é obrigatório (`packages/shared/src/types.ts:109-128`). Foi essa crença errada que originou
  o defeito.

### Porque é que sobreviveu a `AUTH-001` e à `A23`

A `A23` foi implementada **no servidor** e está correta. Nenhum teste toca no cliente web:
`grep -rln "refreshToken\|setTokens\|getRefreshToken" apps/web/test/` devolve **zero**. A
cobertura existente testa o login e o 401, não o caminho entre os dois — a mesma lacuna que a
própria `A23` descreve («nenhuma das 223 verificações automáticas da altura tocava no fluxo de
renovação»). E o defeito é **invisível em uso normal**: o utilizador é expulso ao fim de uma
hora e assume que «a sessão expirou».

### Consequência

A renovação silenciosa **não funciona** na web, apesar de a `A23` estar implementada e
documentada. Todas as sessões duram 1 hora, e não os 90 dias configurados.

### Correção proposta (não feita — é tarefa própria)

Uma linha por sítio: `setTokens` deve usar `tokens.refreshToken` (o campo do contrato), e
`AuthResponse` deve desaparecer. **Não exige alteração ao contrato partilhado** — o campo já
lá está. Os três testes acima são a regressão, provados por mutação antes de fechar.

### Texto proposto para §5.3

```markdown
#### WEB-013 · O cliente web nunca guarda o token de renovação — A3 · P1 · `READY`

- **Descrição:** a renovação silenciosa de sessão **não funciona** na web. `auth.login` chama
  `setTokens(session.tokens, session.refreshToken ?? null)` (`client.ts:470,476`), mas a API
  devolve o token em `tokens.refreshToken` (`AuthTokens.refreshToken`,
  `packages/shared/src/types.ts:127`), e `setTokens` (`:147-151`) ignora o parâmetro `tokens`.
  O `localStorage` nunca recebe o token, `getRefreshToken()` devolve sempre `null`,
  `refreshAccessToken()` devolve `false` à primeira linha e **não chega a ser feito nenhum
  pedido a `/auth/refresh`**.
- **Medido:** 3 testes com `fetch` e armazenamento simulados, contra a forma exata da resposta
  da API — **3 vermelhos**, incluindo «um 401 devia renovar em silêncio» → nenhum pedido de
  renovação. Zero cobertura existente neste caminho (`grep` sobre `apps/web/test/` → 0).
- **Causa secundária:** o docblock de `client.ts:442-449` afirma que o tipo partilhado
  «descreve apenas `{ user, tokens }`»; é falso — `AuthTokens.refreshToken` é obrigatório. A
  crença errada é anterior ao código.
- **Objetivo:** a sessão dura os 90 dias configurados e sobrevive à expiração do token de
  acesso.
- **Dependências:** —
- **Critérios de aceitação:** `setTokens` grava `tokens.refreshToken`; a interface
  `AuthResponse` (campo de topo) desaparece; o docblock passa a descrever o contrato real; os
  três testes ficam verdes e são provados por mutação.
- **Ficheiros:** `apps/web/src/api/client.ts:147-151,229,442-453,470,476`.
- **Contrato:** **não** exige alteração a `packages/shared`.
- **Origem:** descoberto em `MOB-001` ao comparar o cliente do mobile com o da web. **Não**
  corrigido dentro de `MOB-001` — é defeito de outra frente e o pedido exigia proposta prévia a
  A9 (§1.2).
```

---

## 3. Achado novo 2 — o contrato não fecha 19 conjuntos que julga fechar

**Proposta de ID de problema:** `PC-32` (o maior usado é `PC-31`; `PC-28`/`PC-29` estão livres
e podem ser ocupados entretanto, por isso propõe-se o maior+1).
**Proposta de tarefa:** o ID é escolha de A9. Sugestão: `PROD-009` (o maior blast radius é na
API, que é A4) — mas a alteração é a `registry.ts`, contrato partilhado, e §6 exige decisão
prévia sobre impacto em API/Web/Mobile. **A3 não implementou nada.**

### O que está medido

`registry.ts` declara 19 aliases do tipo `export type VehicleType = CodeOf<typeof VEHICLE_TYPES>`.
**Os 19 resolvem para `string`** — nenhum é uma união de literais (medido pela API do
compilador TypeScript, contagem reproduzível pelo gerador):

```
VehicleType, FuelType, ExpenseCategory, MaintenanceType, DocumentCategory, EventType,
ReminderTrigger, ReminderState, SuggestionType, NotificationChannel, NotificationTopic,
NotificationFrequency, IntegrationCategory, ProviderKind, RecordKind, InsuranceCoverage,
TaxKind, InspectionResult, PaymentMethod     → 19 de 19 = `string`
```

**Causa:** `registry.ts:31` — `function freeze<T extends readonly OptionMeta[]>(items: T): T`,
com `OptionMeta.code: string` (`:16-28`). Os códigos literais alargam, e `CodeOf<T> = T[number]['code']`
(`:912`) resolve para `string`.

### Consequência

O contrato **fecha estes conjuntos apenas em tempo de execução** (pelos esquemas Zod). O lado
TypeScript não os fecha: um cliente pode escrever `vehicleType: 'banana'` e o `tsc` aceita. O
`MOB-001` **mediu** isto e recusou-se a «melhorar» o contrato no gerador — um gerador que
emitisse `VehicleType` onde o contrato diz `string` esconderia a diferença em vez de a mostrar.

### Correção possível (não decidida)

`function freeze<const T extends readonly OptionMeta[]>(items: T): T` (parâmetros de tipo
`const`, TypeScript 5.0+) preservaria os literais. **O impacto tem de ser medido antes de
decidir, e é o ponto todo desta proposta:**

- **API:** validação em tempo de execução **não muda** (é Zod). Mas o Prisma devolve `string`
  para estas colunas, e atribuir `string` a um campo que passa a ser `VehicleType` **falha o
  `typecheck`** — o blast radius é de tamanho desconhecido e tem de ser contado antes.
- **Web:** `VehicleSummary.vehicleType` passa de `string` a `VehicleType`; comparações com
  literais arbitrários passariam a falhar no `typecheck`. Também por medir.
- **Mobile:** estritamente melhor — o gerador emitiria o enum em vez de `String`. Exige
  regeneração e revisão do diff gerado.

**Recomendação:** tratar como tarefa própria, com a medição do blast radius **primeiro**
(alterar numa cópia de trabalho e correr `typecheck` nos três workspaces), e **não** como
trabalho de `MOB-001`. O mobile funciona sem isto.

### Texto proposto para §2

```markdown
| PC-32 | **O contrato não fecha 19 conjuntos que julga fechar.** `registry.ts` declara 19 aliases `CodeOf<typeof X>`; **os 19 resolvem para `string`**, não para uniões de literais (medido pela API do compilador TypeScript, contagem reproduzível por `apps/mobile/contract/generate.mjs`). **Causa:** `freeze<T extends readonly OptionMeta[]>(items: T): T` (`registry.ts:31`) com `OptionMeta.code: string` (`:16-28`) — os códigos literais alargam. **Consequência:** o contrato só fecha estes conjuntos em tempo de execução, pelos esquemas Zod; em TypeScript, `vehicleType: 'banana'` compila. `MOB-001` mediu-o e escreveu-o no manifesto gerado (`knownWeaknesses`), recusando-se a «melhorar» o contrato no gerador. **Correção possível:** `const` type parameter em `freeze`, com impacto por medir em API (Prisma devolve `string`), Web e Mobile. **Deteção: A3, 2026-09-22, durante `MOB-001`.** | `packages/shared/src/registry.ts:16-34,912-930` | Média | Aberto — tarefa proposta |
```

---

## 4. Decisão arquitetural proposta — `A32` em `docs/DECISIONS.md`

```markdown
## A32. O cliente mobile é **gerado** do contrato partilhado, e a deriva é verificada

**Decisão.** `apps/mobile` não escreve modelos à mão. `apps/mobile/contract/generate.mjs` gera
os modelos, os conjuntos fechados, as tabelas de registo e as constantes a partir de
`packages/shared`; `apps/mobile/contract/verify.mjs` compara o gerado com o contrato e falha
com exit 1 se houver deriva.

**Porquê gerar e não escrever à mão.** Em TypeScript, «não duplicar contratos» (§6) resolve-se
com um `import`. **Em Dart não há forma de importar TypeScript.** Sem geração haveria duas
definições de «despesa», que divergiriam na primeira alteração — e a divergência seria
silenciosa. Com geração há uma só definição, e a divergência é um erro de CI.

**Porque é que o gerador lê duas fontes.** O contrato tem duas metades com naturezas
diferentes: as **respostas** (`types.ts`) são `interface` de TypeScript, **apagadas em tempo de
execução** — nenhum `Object.keys` as vê, pelo que se lêem pela API do compilador; os
**pedidos e conjuntos fechados** (`contracts.ts`, `registry.ts`) são esquemas Zod e arrays, que
**são** valores reais, e introspecionam-se pelo `dist/` — o mesmo artefacto que a API e a web
consomem, não uma segunda leitura do `src/`.

**Porque é que os rótulos também são gerados.** `EXPENSE_CATEGORIES` traz
`{ code, label, icon, order }`: é apresentação partilhada. Duas listas escritas à mão divergem
na primeira alteração de texto, e o utilizador veria palavras diferentes na web e no telemóvel.

**Regra de comportamento, que fecha a outra metade do problema.** `packages/shared` também
contém funções (`averageChargingPowerKw`, `daysBetween`, `categoryLabel`, `cvToKw`, …). **Não
são portadas para Dart.** *O servidor calcula, o cliente mostra.* Uma segunda implementação do
mesmo cálculo é uma segunda fonte de verdade, e a primeira divergência seria silenciosa. Se um
dia for inevitável, o mecanismo é o dos vetores de teste gerados a partir da implementação
TypeScript — e não uma reimplementação ad-hoc.

**Consequência, que é uma vantagem e não um efeito lateral.** O erro que a web tem — ler
`session.refreshToken`, um campo que não existe, em vez de `tokens.refreshToken` (`WEB-013`) —
é **impossível de escrever** no mobile: `session.tokens` é do tipo gerado `AuthTokens`, em que
`refreshToken` é obrigatório, e não existe `session.refreshToken` para ler.

**Limitação declarada.** A verificação corre em Node e prova que o Dart **corresponde ao
contrato**; **não** prova que **compila** — isso exige `flutter analyze`/`flutter test`, que
correm onde houver SDK. Está escrito no `ARCHITECTURE.md` e no cabeçalho do `verify.mjs`.
```

---

## 5. O que A3 **não** fez (para constar)

- Não editou nem renumerou `docs/ROADMAP.md` nem `docs/DECISIONS.md`.
- Não alterou `contracts.ts`, `types.ts`, `registry.ts`, `index.ts` nem `version.ts` (5
  ficheiros verificados por `sha256`, antes e depois).
- Não tocou em `apps/web` nem em `apps/api` — o defeito de `WEB-013` está **medido, não
  corrigido**.
- Não mexeu no trabalho em curso de A2 (`AUTH-002`), nem nas edições de A1/A2/A4.
- Não avançou para `MOB-002`.
- Não fez commit, push nem deploy.

---

## 6. Fecho da revisão (2026-09-22, ~12:19) — aceitação e o gate que falta

**`MOB-001` foi aceite como `DONE`.** A arquitetura gerada foi aprovada, incluindo a decisão de
**não portar a lógica de domínio para Dart** («o servidor calcula, o cliente mostra»). As
limitações foram **aceites como limitações**, e o utilizador foi explícito: **não as marcar como
validações feitas.**

### 6.1 Proposta de tarefa nova — `MOB-007`

**Porque é que isto é uma tarefa e não uma nota.** O utilizador fixou o gate: *«Antes de `MOB-002`
depender operacionalmente do cliente, será necessário executar `flutter analyze` e `flutter test`
num ambiente com Flutter.»* Isto é um pré-requisito verificável, não um lembrete. Sem ele, o
`apps/mobile` fica com código que **corresponde** ao contrato (provado em Node) mas que **nunca
foi compilado** — e `MOB-002` passaria a construir sobre ele como se estivesse verificado.

**Verificado antes de propor:** não existe hoje nenhuma tarefa no ROADMAP sobre ambiente Flutter,
SDK ou toolchain (`grep` por `ambiente com flutter|flutter analyze|SDK|toolchain|instalar flutter`
→ **zero**). `MOB-007` está livre (`MOB-001`–`MOB-006` ocupados).

**Definição refinada pelo utilizador (2026-09-22, ~12:2x).** Na aceitação, o âmbito do gate foi
alargado e a formulação endurecida. O que mudou face à minha primeira proposta:

| Ponto | Proposta inicial de A3 | Definição fixada pelo utilizador |
| ----- | ---------------------- | -------------------------------- |
| Comandos a correr | `flutter analyze` + `flutter test` | **`flutter pub get` + `flutter analyze` + `flutter test`** — o `pub get` **antes de tudo** |
| Alvo específico | nomes do plugin `flutter_secure_storage` | nomes do plugin **e** a **resolução do `pubspec.yaml`** |
| Efeito sobre `MOB-002` | «a dependência operacional só está satisfeita quando `MOB-007` fechar» | «**`MOB-002` não deve ser considerado operacionalmente concluído** enquanto `MOB-007` não passar» |
| `MOB-001` | (não dito) | **não é necessário reabrir `MOB-001`** por causa desta limitação |

O alargamento é material: sem `flutter pub get` não há resolução de versões, e a resolução é
exatamente o que o meu `pubspec.yaml` **nunca** sofreu — as versões lá escritas são plausíveis e
não confirmadas. Sem essa etapa, `flutter analyze` podia falhar por um `pubspec.yaml` que nem
resolve, e o diagnóstico seria atribuído ao código em vez do manifesto.

```markdown
#### MOB-007 · Validar o ambiente Flutter (`flutter pub get`, `flutter analyze`, `flutter test`) — A3 · P1 · `READY`

- **Descrição:** `MOB-001` entregou `apps/mobile` com o cliente do contrato, mas **Flutter e Dart
  não estão instalados na máquina onde foi construída** (`command -v flutter` e `command -v dart`
  falham; não existe SDK em nenhum caminho habitual). Nada do lado Dart foi compilado ou
  analisado. O que está provado é que o Dart **corresponde** ao contrato
  (`node apps/mobile/contract/verify.mjs`, exit 0, 3 mutações); **não** que compila.
  Esta tarefa é o **gate de validação do ambiente Flutter**: resolve dependências, compila e
  analisa a sério, e corrige o que aparecer.
- **Objetivo:** provar que o `apps/mobile` **compila e resolve** num ambiente com Flutter — não
  apenas que corresponde ao contrato.
- **Dependências:** —
- **Bloqueia:** `MOB-002` **não deve ser considerado operacionalmente concluído** enquanto
  `MOB-007` não passar. `MOB-002` pode ser **escrita** antes disso; o que não pode é ser dada
  como apoiada num cliente que nunca foi compilado.
- **Critérios de aceitação (por esta ordem — cada um é pré-requisito do seguinte):**
  1. **`flutter pub get`** no `apps/mobile` → **exit 0**. Isto resolve o `pubspec.yaml`, que foi
     escrito **sem nunca ter sido resolvido**. Se a resolução falhar ou alterar versões, registar
     o que mudou e porquê. Sem este passo, os dois seguintes não são interpretáveis.
  2. **`flutter analyze`** no `apps/mobile` → **exit 0** (sem `error`; `warning`/`info`
     registados e atribuídos).
  3. **`flutter test`** → **verde**, incluindo `test/contract_test.dart`, que está **escrito e
     não provado** (7 testes: ida e volta por JSON, `fromWire` a rejeitar valor desconhecido,
     rótulos do registo, envelope §A11 com e sem envelope legível).
  4. **Confirmar especificamente a API de `flutter_secure_storage`** usada em
     `lib/api/token_store.dart` (o único ponto do `apps/mobile` que fala com o plugin) **contra a
     versão efetivamente resolvida** pelo passo 1 — nomes de método, assinaturas e opções
     (`AndroidOptions`/`IOSOptions`). É o ficheiro com maior probabilidade de ter um nome errado,
     por ter sido escrito sem compilador à frente.
  5. **Confirmar a resolução do `pubspec.yaml`**: versões resolvidas vs. declaradas (`http`,
     `flutter_secure_storage`, `flutter_lints`, restrição de SDK `>=3.4.0`), e se o `pubspec.lock`
     resultante foi ou não versionado.
  6. `node apps/mobile/contract/verify.mjs` continua **exit 0** (a validação do contrato não pode
     regredir por causa de correções de compilação).
  7. Resultado registado no ROADMAP, incluindo **o que falhou e foi corrigido** — não apenas o
     estado final.
- **Fora de âmbito:** não reabre `MOB-001` (a arquitetura e o mecanismo de geração não estão em
  causa; o que falta é ambiente, não desenho). Não corrige `WEB-013` nem `PC-32`.
- **Ficheiros:** `apps/mobile/**` (a corrigir), `apps/mobile/pubspec.yaml` (versões/restrição de
  SDK), `apps/mobile/lib/api/token_store.dart` (nomes do plugin), `apps/mobile/pubspec.lock` (novo,
  se a resolução o gerar).
- **Risco:** o `pubspec.yaml` foi escrito sem `flutter pub get` ter corrido. As versões
  (`http ^1.2.0`, `flutter_secure_storage ^9.2.2`, `flutter_lints ^4.0.0`, SDK `>=3.4.0`) são
  plausíveis mas **não resolvidas** — a resolução pode exigir ajuste, e o passo 1 pode falhar
  antes de qualquer linha de Dart ser analisada.
- **Origem:** fixado pelo utilizador ao aceitar `MOB-001` e **refinado na aceitação de `MOB-007`**.
  **Não** foi feito dentro de `MOB-001` porque o ambiente não tem Flutter — não é trabalho
  adiado, é trabalho **impossível ali**.
```

### 6.2 Critério a acrescentar a `MOB-002`

```markdown
- **Nota de dependência:** `MOB-002` pode ser **escrita** sobre o cliente de `MOB-001`, mas
  **não deve ser considerado operacionalmente concluído enquanto `MOB-007` não passar**
  (`flutter pub get` + `flutter analyze` + `flutter test`). Enquanto isso, o cliente está
  **provado contra o contrato** e **não compilado**.
- **Nota:** esta limitação **não** exige reabrir `MOB-001`. A arquitetura e o mecanismo de
  geração não estão em causa; o que falta é o **ambiente** onde validá-los.
```

### 6.3 Entrada de changelog a acrescentar (fim de §13)

```markdown
| 2026-09-22 | A3 · `MOB-001` **aceite como `DONE`** pelo utilizador, que aprovou a arquitetura gerada, a decisão de **não portar a lógica de domínio para Dart** e aceitou as limitações (Flutter/Dart ausentes; `flutter analyze`/`flutter test` não corridos; teste Dart escrito mas não executado) — com a instrução explícita de **não as marcar como validações feitas**. Criado o **gate `MOB-007` — «Validar o ambiente Flutter (`flutter pub get`, `flutter analyze`, `flutter test`)»**, com âmbito **refinado pelo utilizador**: o `pub get` corre **antes de tudo** (resolve o `pubspec.yaml`, que nunca foi resolvido), a validação confirma **especificamente** a API de `flutter_secure_storage` **e a resolução do `pubspec.yaml`**, e **`MOB-002` não deve ser considerado operacionalmente concluído enquanto `MOB-007` não passar**. Ficou assente que esta limitação **não exige reabrir `MOB-001`** (o que falta é ambiente, não desenho). Verificado antes de o propor que **nenhuma** tarefa do ROADMAP cobria ambiente Flutter/SDK/toolchain (`grep` → zero). A3 confirmou por `grep` que **nenhum** dos seus ficheiros afirma que as validações Dart foram executadas: as 5 menções a `flutter analyze`/`flutter test` estão todas em contexto de «o que **não** se prova». `WEB-013` e `PC-32` continuam como achados separados, **não** corrigidos dentro de `MOB-001`. **Sem commit, sem push, sem deploy.** |
```

### 6.4 Verificação das afirmações (feita, não assumida)

Pedido: «não marques essas validações como feitas». Verificado por medição sobre os meus
próprios ficheiros:

| Verificação | Comando | Resultado |
| ----------- | ------- | --------- |
| menções a ferramentas Dart | `grep -rn "flutter analyze\|flutter test\|dart test" apps/mobile/ docs/PROPOSAL-A3-MOB-001.md` | **5** menções, todas em contexto de «não se prova» ou de comando a correr |
| afirmações de sucesso | `grep -rniE "exit 0\|verificado\|provado\|passa\|verde"` sobre os mesmos ficheiros | todas corretas no contexto; a única exceção aparente (`contract_test.dart:6`) é `«verificado: command -v flutter e command -v dart falham»`, que **foi** verificado |

O `exit 0` que existe na entrega é o do `verify.mjs`, que corre em Node e foi realmente
executado. **Não** existe nenhum `exit 0` atribuído a `flutter analyze` ou `flutter test`.

