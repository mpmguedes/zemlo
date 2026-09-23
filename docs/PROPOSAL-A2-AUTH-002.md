# Entrega de A2 a A9 — `AUTH-002` (fecho) e dois achados novos

> **Documento de entrega, não fonte de verdade.** O texto abaixo está pronto a integrar em
> `docs/ROADMAP.md`. Depois de A9 integrar, este ficheiro pode ser apagado.
>
> **Nota de processo (A2, 2026-09-22):** ao contrário do que A3 fez em
> `docs/PROPOSAL-A3-MOB-001.md`, A2 **escreveu diretamente** em `docs/ROADMAP.md` durante esta
> sessão, porque o *brief* de A2 o exigia («registar no ROADMAP» os problemas não corrigidos, e
> registar §6/§7 **antes** de implementar). A regra mais recente do projeto — **A9 é o único
> autorizado a editar o ROADMAP** — prevalece sobre o *brief*: o **fecho que A2 tinha escrito foi
> revertido** do ROADMAP a pedido do utilizador (ver secção 5) e está **só** aqui. **O código, os
> testes e a migration não mudaram por causa disto.** A2 não volta a escrever no ROADMAP.
>
> Estado dos IDs no momento da escrita (2026-09-22, ~12:26): `PC-*` na tabela de §2 até
> **`PC-31`**, com **`PC-28` e `PC-29` ocupados por A2** (ver §0), e `PC-22`/`PC-23` vazios por
> folga deliberada de A3 (ver `PC-18`). Tarefas `AUTH-*` até `AUTH-009`; decisões até `A31`.

---

## 0. Aviso de colisão de IDs — ler primeiro

`docs/PROPOSAL-A3-MOB-001.md` (escrito por A3 às ~12:20) afirma: *«`PC-*` até `PC-31` (com
`PC-28`/`PC-29` livres)»*. **Estava certo, e voltou a estar:** A2 ocupou `PC-28`/`PC-29` às ~12:17
e **devolveu-os às ~12:31**, quando reverteu o fecho do ROADMAP a pedido do utilizador (a regra
mais recente do projeto dá a edição do ficheiro **só a A9**). Verificado agora:
`grep -o "^\| PC-[0-9]* \|" docs/ROADMAP.md | sort | uniq -d` → **vazio**, e a tabela tem
`PC-1`…`PC-21`, `PC-24`…`PC-27`, `PC-30`, `PC-31` — **`PC-28` e `PC-29` estão livres**.

**O que isto significa para A9:** os IDs propostos na secção 2 e na secção 3 deste documento
**não estão reservados**. Se A9 os aceitar, aloca-os; se preferir outra atribuição (por exemplo
para não colidir com o achado de A3, que propõe `PC-32`), tem de **renumerar as referências nos
ficheiros de código e docs na mesma passagem**, senão ficam a apontar para o problema errado:

| Ficheiro:linha | Referência | O que aponta |
| --- | --- | --- |
| `apps/api/src/services/oauth.ts:99` | `PC-29` | estado do fluxo em memória (multi-instância) |
| `apps/api/src/services/oauth.ts:577` | `PC-28` | aceitação de termos no primeiro acesso federado |
| `apps/api/test/oauth-google.test.ts:241` | `PC-28` | idem |
| `docs/OPERATIONS.md:256` | `PC-29` | idem |
| `docs/OPERATIONS.md:486` | `PC-28` | idem |

*(A2 já tinha renumerado estas referências de `PC-26`/`PC-27` para `PC-28`/`PC-29`, porque A1
alocou os dois primeiros no mesmo intervalo. Se A9 mudar outra vez os IDs, esta tabela é a lista
completa do que há para mudar.)*

---

## 1. `AUTH-002` — proposta de fecho

### 1.1 Linha de §4

```markdown
| AUTH-002 | Identidade   | Login Google (OAuth)                                                   | A2     | P1         | `DONE`     | AUTH-001                |
```

### 1.2 Cabeçalho de §5.2

```markdown
#### AUTH-002 · Login Google (OAuth) — A2 · P1 · `DONE`
```

### 1.3 Bloco de fecho a acrescentar em §5.2

```markdown
##### Fecho (2026-09-22, A2) — `DONE`

**Dependência adicionada.** `openid-client@6.8.8` em `apps/api` (é ESM, tal como o projeto).
Traz `oauth4webapi@3` e um `jose@6.2.12` **aninhado** — o `jose@5.10.0` de topo continua a ser o
que a API usa. Verificação feita **antes** de adicionar: `npm audit` não acrescenta nenhum aviso
(o `openid-client` contribui **0**; os 10 existentes são pré-existentes em prisma/vitest/vite/
esbuild/react-router). Node/TypeScript do projeto conferidos: Node ≥22.11.0 e TS ^5.6.3 satisfazem
o `engines` do pacote. **Não foi introduzida uma segunda biblioteca OAuth/OIDC** (D1).

**Fluxo implementado.** `GET /auth/google/start` gera `state`, `nonce` e PKCE (S256), guarda o
fluxo pendente e responde **302** para o emissor, deixando o `state` também num cookie
`HttpOnly`/`SameSite=Lax` (`Secure` em produção). `GET /auth/google/callback` valida o cookie do
browser **antes** de consumir o fluxo, consome-o (**uso único**: é apagado antes de ser validado),
troca o código no *token endpoint*, e só depois de a biblioteca aceitar o `id_token` é que lê as
*claims*. Termina em `issueSessionResponse` — **o mesmo ponto** onde termina o login por password,
pelo que o utilizador Google acaba num estado idêntico (mesma sessão, mesma rotação A23, mesma
auditoria `session.created`). O `config.ts` passou a expor `issuer` e a validar a configuração no
arranque (credenciais aos pares, `redirect_uri` absoluto e sem `?`/`#`, `https` obrigatório em
produção, emissor sem caminho/query/fragmento).

**Validações (todas as que D1 exigiu).** `state` associado ao pedido e validado no retorno
(cookie do browser **e** existência/uso único do fluxo); `nonce`; troca do código no *token
endpoint*; `iss`; `aud`/client ID; temporal (`exp`/`iat` com tolerância); **assinatura via JWKS do
emissor**; cache/rotação do JWKS pela biblioteca; `redirect_uri` exatamente como configurado;
`email_verified` exigido. Nenhuma *claim* é lida antes de a biblioteca validar o token.

> **Achado que justifica a decisão D1 (o mais valioso desta tarefa).** O `openid-client` **não
> verifica a assinatura do `id_token` por omissão**. A norma OIDC considera a verificação
> desnecessária quando o token chega diretamente do *token endpoint* sobre TLS — e o TLS, na
> perspetiva da biblioteca, já valida o emissor. O efeito prático, **medido**: sem
> `client.enableNonRepudiationChecks`, o `jwks_uri` **nunca é pedido**
> (`provider.jwksRequests.count === 0`) e um `id_token` **assinado por outra chave** é aceite. Foi
> ativado em `execute`; depois disso, o mesmo token falso é recusado e o JWKS é consultado. É
> exatamente o tipo de erro silencioso que a implementação manual teria produzido — e a razão pela
> qual existe um teste que **conta os pedidos ao JWKS** em vez de afirmar que «a assinatura é
> verificada».

**Testes.** `apps/api/test/oauth-google.test.ts` (**28 testes**) e
`apps/api/test/oauth-unconfigured.test.ts` (**3 testes**), com um **fornecedor OIDC real**
(`test/helpers/oidc-provider.ts`): chaves RSA geradas no teste, `/.well-known/openid-configuration`,
`/jwks` e `/token` em HTTP sobre `127.0.0.1:0`; **verifica o PKCE S256 a sério**, **exige
autenticação do cliente**, confere o `redirect_uri` exato e publica uma **segunda** chave privada
que **não** entra no JWKS (é o adversário «assinado por outra chave»). Resultado: **31/31**, e a
suíte completa da API **43 ficheiros / 1700 testes / 0 falhas**.

**Prova por mutação — 6 mutações, zero sobreviventes** (cada uma reposta e confirmada por hash):

| Mutação | O que desliga | Vermelhos |
| --- | --- | --- |
| M1 | `enableNonRepudiationChecks` (verificação de assinatura) | 3 |
| M2 | remoção de uso único do `state` | 1 |
| M3 | ligação ao cookie do browser | 3 |
| M4 | exigência de `email_verified` | 1 |
| M5 | associação silenciosa em vez de recusa (**o risco de D3**) | 1 |
| M6 | `@@unique` → `@@index` (a garantia de D4) | 1 |

**Hashes de base, repostos e verificados:** `apps/api/src/services/oauth.ts`
`25918d103483fc5707f8b9f42d850926192adcd89eca7785d4f17e7743f32842`
(era `c9fb36caa000e5bf724219396bb747912742f778628c5c5a3b8642e757c95238` durante a bateria de
mutações; a diferença é **só de comentário** — a renumeração `PC-26`→`PC-28` e `PC-27`→`PC-29`
descrita em §2, porque A1 alocou os dois primeiros no mesmo intervalo, e a bateria de mutações
continua válida porque nenhuma dessas linhas é executável);
`apps/api/prisma/schema.prisma`
`baf32de9dc5d71e6f86bdef9df6b7dcafac67bb09bec8ce7278d83d6c0d42ed6`;
`apps/api/prisma/sqlite/schema.sqlite.prisma`
`0ddcccaee074607703367ae539f3b00bf1b3e9641d84fa4b3433e1d2cbeae04c`.

**Typecheck:** `@zemlo/shared`, `@zemlo/api` e `@zemlo/web` — **exit 0**. `db:check-schema`:
sincronizado.

**Limitações, escritas com honestidade:** (a) `PC-20` atingiu esta tarefa — várias das minhas
edições foram revertidas em silêncio, deixando **estados mistos** (corpo novo com assinatura
antiga); a vítima mais visível foi `config.ts`, que A1 apanhou e registou como `PC-27`; a lição é
que declarações, `import`s e assinaturas são a parte frágil; (b) `PC-28` — a conta criada por
login federado fica com `acceptedTermsAt` nulo, e não há ecrã que peça a aceitação; (c) `PC-29` —
o estado do fluxo vive em memória do processo, pelo que **uma segunda instância da API parte o
retorno**; (d) os testes cobrem o **servidor** — o botão desativado da web
(`LoginPage.tsx:166`, `SignUpPage.tsx:174`) continua desativado e **não** foi tocado (não é desta
tarefa, §6.1). `PC-25` fica **fechado** por esta tarefa (§7.1).
```

### 1.4 Fila de A2 em §9

Substituir as três linhas da fila (`AUTH-002`, `AUTH-003`, `AUTH-004`) e acrescentar o parágrafo:

```markdown
| 1     | `AUTH-002` — Login Google                                | P1         | **`DONE`** (2026-09-22) — fecha `PC-25`; `PC-28`/`PC-29` registados |
| 2     | `AUTH-003` — Associação de conta Google                  | P1         | **desbloqueada** (dependência satisfeita); falta o detalhe prévio (§1.2) antes de implementar |
| 3     | `AUTH-004` — Gestão de sessões                           | P2         | —                                     |

**`AUTH-002` → `DONE` em 2026-09-22** (implementada, provada e documentada; **sem commit**). O
fecho completo está em §5.2. Fecha `PC-25` e `PC-27`; abre `PC-28` e `PC-29`. `AUTH-003` fica
desbloqueada, mas **não** foi começada: o caso da associação por coincidência de email é a decisão
de maior risco de segurança do conjunto e exige detalhe prévio próprio (§1.2) **e** revisão
adversarial — não se começa por arrastamento de uma tarefa anterior.
```

### 1.5 Entrada de changelog (fim da tabela de §13)

```markdown
| 2026-09-22 | A2 · `AUTH-002` **`DONE`** — login com Google (OAuth 2.0 / OIDC, *authorization code* + PKCE), implementado com **`openid-client@6.8.8`** (D1) e não à mão. **Dependência:** uma só biblioteca OAuth/OIDC, `npm audit` sem avisos novos (0 do `openid-client`), Node ≥22.11.0 e TS ^5.6.3 do projeto conferidos antes de a adicionar. **Fluxo:** `GET /auth/google/start` (gera `state`/`nonce`/PKCE, guarda o fluxo, `302` + cookie `HttpOnly`/`SameSite=Lax`) e `GET /auth/google/callback` (valida o cookie **antes** de consumir, consome o fluxo com **uso único** — é apagado antes de ser validado —, troca o código, e só depois de a biblioteca aceitar o `id_token` lê as *claims*), terminando em `issueSessionResponse`, **o mesmo ponto** do login por password (mesma sessão, mesma rotação A23, mesma auditoria). `config.ts` passou a expor `issuer` e a validar no arranque (credenciais aos pares, `redirect_uri` absoluto e sem `?`/`#`, `https` obrigatório em produção). **Achado mais valioso, medido:** o `openid-client` **não** verifica a assinatura do `id_token` por omissão (a norma OIDC considera o TLS do *token endpoint* suficiente) — sem `client.enableNonRepudiationChecks` o `jwks_uri` **nunca é pedido** (`jwksRequests.count === 0`) e um `id_token` assinado por **outra chave** é aceite. É o erro silencioso que a implementação manual teria produzido, e a razão pela qual existe um teste que **conta os pedidos ao JWKS** em vez de afirmar que verifica. **Decisões D2/D3/D4 no código:** conta criada automaticamente; identidade já associada → login; email coincidente → **recusa `409`** e encaminha para `AUTH-003` (com teste que confirma que a conta local **não** ganhou `authProvider`); `@@unique([authProvider, authProviderId])` + migration `20260922120000_federated_identity_unique`, com a verificação aplicacional como complemento e `P2002` tratado. **Prova:** fornecedor OIDC **real** (`test/helpers/oidc-provider.ts` — RSA geradas no teste, discovery/JWKS/token, **verifica o PKCE S256**, **exige autenticação do cliente**, confere o `redirect_uri`, e publica uma **segunda** chave que não entra no JWKS), **31/31** testes OAuth, suíte completa da API **43 ficheiros / 1700 testes / 0 falhas**, `typecheck` **exit 0** nos três workspaces, `db:check-schema` sincronizado. **6 mutações, zero sobreviventes** (assinatura, uso único do `state`, cookie do browser, `email_verified`, associação silenciosa — o risco de D3 — e `@@unique`→`@@index`), todas repostas e confirmadas por hash. **Fecha `PC-25`; fecha `PC-27`** (era estado misto de `PC-20` em `config.ts`, apanhado por A1); **abre `PC-28`** (conta federada nasce com `acceptedTermsAt` nulo e não há ecrã que peça a aceitação) e **`PC-29`** (estado do fluxo em memória — uma segunda instância da API parte o retorno). Renumeradas as minhas referências `PC-26`/`PC-27` → `PC-28`/`PC-29` (A1 alocou os dois primeiros no mesmo intervalo). `docs/API.md` e `docs/OPERATIONS.md` §3.4.2 atualizados; contrato (§6.1) e schema (§7.1) registados antes de implementar; `packages/shared` **intocado**. Limitação honesta: o botão da web (`LoginPage.tsx:166`, `SignUpPage.tsx:174`) continua **desativado** — interface não é desta tarefa. **Sem commit, sem push, sem deploy.** |
```

---

## 2. Achado novo 1 — `PC-28`: a conta federada nasce sem aceitação de termos

### O que está medido

Ao criar a conta pelo Google, `resolveFederatedAccount` (`apps/api/src/services/oauth.ts`) grava
`acceptedTermsAt: null`. Não é esquecimento — é a decisão correta **dado** o que existe hoje: o
`id_token` prova que a pessoa controla aquele email, **não** que aceitou os termos do Zemlo, e
gravar uma data ali seria registar uma aceitação que nunca aconteceu. O teste
`test/oauth-google.test.ts` **afirma** o `null` (é uma asserção, não uma omissão).

### A consequência

Existe agora um caminho de entrada que **contorna** o ecrã de aceitação que o registo por password
exige. O produto fica com duas classes de conta — umas com a data preenchida, outras sem — e nada
no código as distingue nem as trata de forma diferente. É dívida de **produto**, não falha de
segurança: não há escalonamento de privilégios nem acesso indevido. A alternativa (recusar a
criação até existir ecrã) contradiria a decisão **D2** do utilizador.

### Texto proposto para §2

```markdown
| PC-28 | **Uma conta criada por login federado nasce sem aceitação de termos, e não há ecrã que a peça.** Decisão de desenho de `AUTH-002` (A2, 2026-09-22), escrita aqui porque é dívida e não detalhe. Ao criar a conta pelo Google, o serviço grava `acceptedTermsAt: null` **de propósito**: o `id_token` prova que a pessoa controla aquele email, não que aceitou os termos do Zemlo, e gravar uma data ali seria registar uma aceitação que nunca aconteceu — exatamente o que §5.2 proíbe. Consequência: passa a existir um caminho de entrada que **contorna** o ecrã de aceitação que o registo por password exige, e o produto fica com duas classes de conta — umas com a data preenchida, outras sem. Nada no código atual distingue nem trata as duas. É dívida de **produto**, não falha de segurança: não há aqui escalonamento de privilégios nem acesso indevido, e a alternativa (recusar a criação até haver ecrã) contradiria a decisão D2 do utilizador. Precisa de tarefa própria: ecrã de aceitação no primeiro acesso federado, ou um critério escrito que diga o que a ausência da data significa. **Deteção: A2, 2026-09-22, ao implementar `AUTH-002`.** | `apps/api/src/services/oauth.ts` (`resolveFederatedAccount`), `apps/web/src/pages/SignUpPage.tsx` | Média | Aberto — sem tarefa; requer decisão de produto |
```

---

## 3. Achado novo 2 — `PC-29`: o estado do fluxo OAuth vive em memória do processo

### O que está medido

Os fluxos pendentes ficam num `Map` do próprio processo (`apps/api/src/services/oauth.ts`,
`pendingFlows`), com TTL de 10 minutos e remoção de uso único. Funciona com uma instância — que é
o que hoje existe.

### A consequência, e porque é que o modo de falha é o pior possível

Assim que houver duas instâncias atrás de um balanceador, o pedido de início pode cair na
instância A e o retorno na instância B, e a instância B responde **400** a um `state` que é
legítimo («o pedido de entrada expirou ou já foi usado»). O modo de falha é **intermitente**,
**dependente do balanceador** e **indistinguível de um ataque de repetição** — quem depurar vai
procurar segurança onde o problema é topologia. A correção (estado partilhado, ou afinidade de
sessão no balanceador) não é desta tarefa e não se resolve com uma linha.

### Texto proposto para §2

```markdown
| PC-29 | **O estado do fluxo OAuth vive em memória do processo — com mais de uma instância, o retorno falha.** Decisão de desenho de `AUTH-002` (A2, 2026-09-22), declarada em `docs/OPERATIONS.md` §3.4.2 e não deixada para descoberta em produção. Os fluxos pendentes ficam num `Map` do próprio processo (`services/oauth.ts`, `pendingFlows`), com TTL de 10 minutos e remoção de uso único. Funciona com uma instância — que é o que hoje existe — mas assim que houver duas atrás de um balanceador, o pedido de início pode cair na instância A e o retorno na instância B, e a instância B responde **400** a um `state` que é legítimo («o pedido de entrada expirou ou já foi usado»). O modo de falha é o pior possível: intermitente, dependente do balanceador, e indistinguível de um ataque de repetição — quem depurar vai procurar segurança onde o problema é topologia. A correção (estado partilhado, ou afinidade de sessão no balanceador) não é desta tarefa e não se resolve com uma linha. **Deteção: A2, 2026-09-22, ao implementar `AUTH-002`.** | `apps/api/src/services/oauth.ts` (`pendingFlows`), `docs/OPERATIONS.md` §3.4.2 | Média | Aberto — sem tarefa; bloqueia a segunda instância da API |
```

---

## 4. Fechos de problemas que já estão na tabela de §2

### 4.1 `PC-25` — fechado

A célula de estado passa de *«**Em correção** por `AUTH-002` — registo em §7.1»* para:

```markdown
| **Fechado por `AUTH-002`** (2026-09-22) — migration `20260922120000_federated_identity_unique`, registo em §7.1 |
```

### 4.2 `PC-27` — fechado (linha de A1; A2 só regista o desfecho)

Acrescentar ao fim do texto da linha de `PC-27`, e mudar a célula de estado para
*«**Fechado por `AUTH-002`** (A2, 2026-09-22) — era um **estado misto** de `PC-20`, não um defeito
de desenho»*:

```markdown
**Resolução (A2, 2026-09-22, mesma sessão):** era um **estado misto de `PC-20`** — o corpo de `config.ts` que usa `API_BASE_PATH` sobreviveu, mas o `import { API_BASE_PATH } from '@zemlo/shared';` que o acompanha foi revertido por uma escrita concorrente, e o ficheiro ficou a meio de duas versões. O `import` foi reposto e a suíte completa da API voltou a arrancar (**43 ficheiros / 1700 testes / 0 falhas**, exit 0). A observação de A1 estava **certa e foi útil**: foi ela que tornou visível uma reversão que, de outra forma, só apareceria como falha de tipo mais tarde. Fica como o exemplo mais claro de `PC-20` em que a vítima e o autor são o mesmo agente — a lição é que **declarações, `import`s e assinaturas são a parte frágil** de uma edição, porque o corpo que as usa sobrevive e o erro só aparece na compilação.
```

> **Nota de âmbito:** o aviso de A1 que hoje está no topo de §5.2 («`config.ts:345` usa
> `API_BASE_PATH` sem o importar … **todos** os testes da API falham com 0 corridos») fica
> **desatualizado** assim que isto for integrado. Proposta: substituir por uma linha
> «**Aviso de A1 (2026-09-22, 11:47) — RESOLVIDO**» com o parágrafo acima resumido, ou removê-lo.
> A decisão é de A9.

---

## 5. O que A2 escreveu diretamente no ROADMAP e precisa de reversão ou consolidação

Para A9 poder fechar isto sem ambiguidade, a lista **completa** do que A2 escreveu no ficheiro
durante a sessão (tudo verificado por leitura depois de escrito):

| Onde | O que A2 escreveu | Estado proposto |
| --- | --- | --- |
| §2 | linha **`PC-25`** (achado novo, deteção A2) | **manter** — é um problema real e o fecho está em §7.1 |
| §2 | linhas **`PC-28`** e **`PC-29`** (achados novos) | **manter** — texto na §2/§3 deste documento |
| §2 | célula de estado de **`PC-25`** → «Fechado por `AUTH-002`» | manter (após integração) |
| §2 | célula de estado e parágrafo de resolução de **`PC-27`** (linha de A1) | manter (após integração) — A2 mudou o **estado**, não o achado de A1 |
| §4 | `AUTH-002`: `BACKLOG` → `READY` → `DONE` | manter `DONE` (§1.1) |
| §5.2 | **detalhe prévio** de `AUTH-002` (descrição, objetivo, tabela D1–D4 com o que foi recusado, fronteira com `AUTH-003`, 15 critérios de aceitação, ponteiros de contrato/BD, ficheiros prováveis, estratégia de testes) | **consolidar** — o texto está no ficheiro; A9 decide se mantém como está |
| §5.2 | **bloco de fecho** de `AUTH-002` | manter (§1.3) |
| §5.2 | `AUTH-003`: parágrafo de fronteira com `AUTH-002` | manter — fixa a decisão D3 |
| §5.2 | aviso de A1 no topo de §5.2 | **atualizar/remover** (ver §4.2) |
| §6 | secção nova **§6.1** — registo de alteração declarada de `AUTH-002` | manter — é o cumprimento de §6 |
| §7 | secção nova **§7.1** — registo de alteração de schema de `AUTH-002`, e a frase «Nenhuma tarefa `READY` … altera o schema» riscada | manter — é o cumprimento de §7 |
| §9 | fila de A2 reescrita (3 linhas + parágrafo) | manter (§1.4) |
| §13 | linha de changelog do detalhe prévio e linha do fecho | manter (§1.5) |

**Reversão executada (A2, 2026-09-22 ~12:31), por decisão do utilizador: «reverter só o fecho».**
A2 removeu do `docs/ROADMAP.md` **apenas** o fecho, e **não** o resto. Concretamente:

| O que foi revertido | Estado depois da reversão |
| --- | --- |
| Linhas `PC-28` e `PC-29` da tabela de §2 | **removidas** — `PC-28`/`PC-29` voltaram a estar **livres** |
| Célula de estado de `PC-25` | voltou a *«**Em correção** por `AUTH-002` — registo em §7.1»* |
| Célula de estado de `PC-27` + parágrafo de resolução | voltou a *«Aberto — `AUTH-002` (A2)»* e o parágrafo foi removido |
| Linha de §4 de `AUTH-002` | voltou a **`READY`** |
| Cabeçalho de §5.2 de `AUTH-002` | voltou a **`READY`** |
| Aviso de A1 no topo de §5.2 | restaurado **verbatim** (a versão «RESOLVIDO» era parte do fecho) |
| Bloco «##### Fecho (2026-09-22, A2)» de §5.2 (80 linhas) | **removido** — o texto está na §1.3 deste documento |
| Fila de §9 (3 linhas) e o parágrafo «`AUTH-002` → `DONE`» | restaurados ao estado anterior |
| Linha de changelog de §13 (3 234 caracteres) | **removida** — o texto está na §1.5 deste documento |

**O que NÃO foi revertido** (era informação válida anterior ao fecho, e o utilizador mandou
preservá-la): a linha `PC-25` de §2, o detalhe prévio de §5.2 (incluindo a tabela D1–D4), o
parágrafo de fronteira de `AUTH-003`, a §6.1, a §7.1, e a linha de changelog do *detalhe prévio*.

**Dois avisos honestos sobre esta reversão:**

1. **O aviso de A1 no topo de §5.2 está agora factualmente errado.** Restaurá-lo *verbatim* era o
   que a reversão exigia — mas ele afirma «**todos** os testes da API falham com 0 corridos» por
   causa do `import` em falta, e isso **já não é verdade** (o `import` foi reposto; a suíte corre
   **43 ficheiros / 1700 testes / 0 falhas**). Fica assim até A9 decidir: atualizar, ou remover.
   A2 não o corrigiu porque isso seria voltar a escrever no ROADMAP.
2. **Durante a reversão, A2 colou temporariamente a linha de `PC-27` à de `PC-30`** (o `old_string`
   começava com uma mudança de linha, e removê-lo juntou as duas linhas). Foi **detetado e
   corrigido na mesma passagem** por leitura do ficheiro, antes de qualquer outra edição. Não houve
   perda de conteúdo — a linha de `PC-30` está inteira e na sua posição. É o mesmo modo de falha do
   `PC-20`, agora provocado pelo próprio A2: **a parte frágil de uma edição não é o texto que se
   escreve, é o que fica nas fronteiras**.

---

## 6. O que A2 **não** fez

- **`AUTH-003` não foi começada.** Fronteira mantida: associação **explícita** de uma conta Google
  a uma conta local existente, **sem** auto-link por coincidência de email, com revisão adversarial
  própria. `AUTH-002` recusa esse caso com `409` e encaminha para lá.
- **O contrato partilhado não foi tocado.** `packages/shared` com **zero** linhas alteradas — nada
  a declarar a A3/A4 além do aviso de §6.1.
- **A interface da web não foi tocada.** O botão «Entrar com Google» continua desativado
  (`LoginPage.tsx:166`, `SignUpPage.tsx:174`).
- **A configuração SMTP de produção não foi tocada.**
- **Nada foi publicado.** Sem `commit`, sem `push`, sem `deploy`.

---

## 7. Verificação das afirmações (feita, não assumida)

| Afirmação | Como foi verificada |
| --- | --- |
| Testes OAuth 31/31 | `npx vitest run test/oauth-google.test.ts test/oauth-unconfigured.test.ts` → `Test Files 2 passed (2) / Tests 31 passed (31)`, exit 0 |
| Suíte da API sem regressões | suíte completa → **43 ficheiros / 1700 testes / 0 falhas** |
| `typecheck` exit 0 | `npm run typecheck` → `@zemlo/shared`, `@zemlo/api`, `@zemlo/web`, exit 0 |
| Schema sincronizado | `npm run db:check-schema` → «Schema SQLite sincronizado com o schema canónico.», exit 0 |
| O `id_token` é mesmo verificado | `provider.jwksRequests.count > 0` no caminho feliz; M1 (desligar `enableNonRepudiationChecks`) → **3 vermelhos** |
| `@@unique` é mesmo estrutural | M6 (`@@unique` → `@@index`) → o teste de restrição deixa de rejeitar |
| Não há IDs `PC-*` duplicados | `grep -o "^\| PC-[0-9]* \|" docs/ROADMAP.md \| sort \| uniq -d` → **vazio** (na tabela: `PC-1`…`PC-21`, `PC-24`…`PC-31`) |
| O ROADMAP não tem base de comparação | `git ls-files --error-unmatch docs/ROADMAP.md` → falha (ficheiro *untracked*) |

---

**Fecho:** A2 fica **à espera da consolidação de A9**. Não volta a escrever em
`docs/ROADMAP.md`. O código, os testes e a migration ficam no *working tree*, **sem commit, sem
push, sem deploy** até autorização explícita.
