# Proposta de A3 a A9 — `WEB-013` · o cliente web nunca guardava o token de renovação

**Agente:** A3 (Web e Mobile) · **Data:** 2026-09-22 · **Tarefa:** `WEB-013` (`READY` → proposta de `DONE`)
**Estado do pedido:** implementação feita, provada por testes e por mutação. **Sem commit, sem push, sem deploy.**
**`docs/ROADMAP.md` não foi tocado por A3** — os blocos a integrar estão em §10, para A9 aplicar.

---

## 1. Estado antes: o que estava errado, e como foi medido

O cliente web nunca guardava o token de renovação. A cadeia, medida sobre o código:

| Passo | Código (antes) | Consequência |
| ----- | -------------- | ------------ |
| 1. O login lê o token | `setTokens(session.tokens, session.refreshToken ?? null)` — `client.ts:470,476` | `session.refreshToken` **não existe**: a API devolve-o em `tokens.refreshToken` |
| 2. O cliente grava | `setTokens` só escrevia se o 2.º argumento fosse verdadeiro — `:147-151` | Com `null`, o `localStorage` **nunca** recebia nada |
| 3. A leitura | `getRefreshToken()` → `readStorage(localStorage, 'zemlo.refreshToken')` | Devolvia sempre `null` |
| 4. A renovação | `refreshAccessToken()` → `if (!refreshToken) return false` | Saía à primeira linha, **sem fazer pedido nenhum** |
| 5. O 401 | `rawRequest` → `clearTokens()` + `sessionExpiredHandler()` | A sessão terminava à hora do token de acesso, apesar dos **90 dias** configurados |

**Causa-raiz, e porque é que isto é uma regressão de algo já resolvido.** A decisão **A23**
(`docs/DECISIONS.md:553`) fixa que o token de renovação é **devolvido em `tokens.refreshToken`** e
**rodado** em cada renovação. O docblock do próprio contrato avisa, em
`packages/shared/src/types.ts:118`: *«**Sem este valor, `POST /auth/refresh` é inutilizável** — e foi
isso que aconteceu na primeira versão (…) a sessão terminava ao fim de uma hora, independentemente
dos 90 dias configurados.»* O cliente web reproduziu exatamente esse defeito, do seu lado. A A23
regista ainda que o defeito do servidor *«foi encontrado pela aplicação web»* — o cliente que o
descobriu cometeu-o a seguir.

**A crença errada era anterior ao código.** Existia em `client.ts` uma interface local
`AuthResponse extends AuthSessionResponse { refreshToken?: string }` com um docblock a afirmar que o
tipo partilhado *«descreve apenas `{ user, tokens }`»* e que a ausência do token era *«tolerada de
propósito»*. O tipo partilhado descreve `{ user, tokens }` — e é isso que a API devolve; o que não é
verdade é que o token não venha: vem **dentro** de `tokens`, e é obrigatório.

**Medição do defeito (antes de tocar no código).** Escritos os testes e corridos contra o código
intacto: **14 vermelhos, 3 verdes** (`17` no total). Os 3 verdes foram depois endurecidos — ver §4.3.

**Um dado que muda a leitura do problema:** o cliente **Dart** do mobile, escrito em `MOB-001`, já
lia o token no sítio certo (`apps/mobile/lib/api/api_client.dart:199` e `auth_api.dart:101`:
`session.tokens.refreshToken`), com um comentário explícito a dizer *«a leitura é `tokens.refreshToken`,
e não um campo de topo»*. **O web era o outlier, não o mobile** — ver §7.3.

---

## 2. Ficheiros alterados

| Ficheiro | `git diff --numstat` | O que mudou |
| -------- | -------------------- | ----------- |
| `apps/web/src/api/client.ts` | **+65 / −24** | `setTokens` com uma só fonte; interface `AuthResponse` **apagada**; `auth.login`/`auth.signup` devolvem o perfil; `refreshAccessToken` usa o token rodado; docblocks corrigidos |
| `apps/web/src/app/SessionContext.tsx` | **+18 / −7** | adaptado ao novo tipo de retorno; comentário do ramo `getRefreshToken()` |
| `apps/web/test/session-refresh.test.ts` | **novo, 566 linhas** | 17 testes do ciclo de sessão |

**Só estes três ficheiros são meus.** O working tree tem mais ficheiros da web modificados
(`ui/form.tsx`, `AppShell.tsx`, `MappingStep.tsx`, `CalendarGrid.tsx`, …) — são trabalho de outros
agentes e de frentes anteriores, com `mtime` entre as 11:07 e as 11:51; os meus têm `mtime` das
22:36–22:38. Nenhum deles foi tocado.

---

## 3. Comportamento corrigido

### 3.1 O que a tarefa pedia

| Critério de aceitação do ROADMAP | Estado |
| -------------------------------- | ------ |
| `setTokens` grava `tokens.refreshToken` | **feito** — e o segundo parâmetro desapareceu, para não haver duas fontes |
| A interface `AuthResponse` (campo de topo) desaparece | **feito** — apagada, não corrigida |
| O docblock passa a descrever o contrato real | **feito** — o bloco falso foi substituído por uma nota que explica o que ele afirmava e porque era falso |
| Os três testes ficam verdes e são provados por mutação | **feito** — 17 testes verdes, 4 mutações mortas (§5) |

### 3.2 Os oito pontos do pedido

| # | Pedido | Como ficou |
| - | ------ | ---------- |
| 1 | Confirmar o estado antes de alterar | §1 — mapa completo em 5 passos, medido por testes vermelhos |
| 2 | Mapear login / armazenamento / leitura / pedidos / 401 / refresh / rotação / logout | §1 (antes) e §3.3 (depois) |
| 3 | **Um só refresh em voo** com vários 401 simultâneos | Mantida a guarda por **promessa** (não por booleano) e movida para **antes** da leitura do armazenamento: quem chega depois junta-se à renovação em curso em vez de decidir sozinho. Provado por teste e pela mutação **M2** |
| 4 | **O token rodado mais recente não se perde** | `setTokens(session.tokens)` lê o token que a API acabou de emitir. O código antigo repunha o token **enviado** (`session.refreshToken ?? refreshToken`), o que com a rotação da A23 deixaria o cliente com um token morto. Provado por teste de **duas** renovações e pela mutação **M3** |
| 5 | **Sem ciclos infinitos** | `rawRequest` faz **uma** renovação e **uma** repetição; o pedido de renovação usa `fetch` direto, pelo que não pode recursivamente disparar-se. Provado por contagem de pedidos |
| 6 | **Se o refresh falhar, terminar a sessão** | `clearTokens()` + `sessionExpiredHandler()` + o erro sobe. Cobre recusa do servidor (401) e falha de rede (exceção), que são caminhos diferentes e ambos testados |
| 7 | **Não expor o refresh token à UI** | `auth.login`/`auth.signup` devolvem **`UserProfile`**, não a sessão. O token fica no cliente HTTP; nenhum componente, prop ou `console.log` o vê |
| 8 | **Preservar o comportamento com o access token válido** | Um pedido com token válido: **zero** pedidos de renovação, uma só chamada, `Bearer` correto. Testado com a precondição afirmada (há token de renovação guardado — e mesmo assim não se renova) |

### 3.3 O ciclo, depois

```
login/signup ──► setTokens(tokens)
                   ├─ accessToken  → memória + sessionStorage   (1 hora)
                   └─ refreshToken → localStorage               (90 dias)

pedido autenticado
   ├─ 2xx/erro ≠ 401 .......................... devolve a resposta (nenhuma renovação)
   └─ 401
        ├─ sem token de renovação ............. termina a sessão
        └─ com token de renovação
             ├─ já há renovação em curso ...... junta-se a ela (uma só, partilhada)
             ├─ POST /auth/refresh ............ 200 → setTokens(tokens NOVOS) → repete 1×
             │                                  401/exceção → termina a sessão
             └─ a repetição volta a dar 401 ... sobe como erro (não repete outra vez)
```

**Duas decisões tomadas, que ficam declaradas:**

1. **Um 401 *depois* de renovar não apaga a sessão.** A renovação provou que a sessão está viva no
   servidor; um 401 a seguir é o **recurso** a recusar, não a sessão a terminar. Apagar os tokens ali
   expulsaria alguém que acabou de provar que tem sessão. O erro sobe e o ecrã trata dele.
2. **Uma resposta de renovação sem `tokens.refreshToken` não apaga o token existente.** O campo é
   obrigatório no tipo, mas o tipo não corre em produção; `setItem(key, undefined)` guardaria a
   cadeia `"undefined"`, que em armazenamento *parece* um token. Nesse caso mantém-se o que estava:
   a renovação trouxe um token de acesso válido e a sessão continua viva.

---

## 4. Testes

`apps/web/test/session-refresh.test.ts` — **17 testes**, todos verdes (`17 passed`), na suíte
completa da web: **8 ficheiros / 151 testes / exit 0**.

### 4.1 O que cada teste fixa

| Grupo | Testes | Discrimina |
| ----- | ------ | ---------- |
| A forma da API | 1 | Guarda o **fixture**: a resposta não tem `refreshToken` no topo. É o que impede alguém de "arranjar" o teste acrescentando o campo que causou o defeito |
| Guardar o token | 4 | login grava o token de `tokens.refreshToken`; registo idem; access token em memória+`sessionStorage` e **não** em `localStorage`; o valor devolvido à UI não contém o segredo |
| Com token válido | 1 | Não renova e envia o `Bearer` — com a precondição de que **há** token de renovação guardado |
| Renovar | 3 | O 401 provoca renovação e repetição com o token novo; **o token rodado substitui o anterior** (duas renovações seguidas); dois 401 simultâneos fazem **uma** renovação e ambos concluem |
| Terminar a sessão | 4 | Renovação recusada; falha de rede na renovação; sem token guardado (não tenta renovar); 401 depois de renovar **não entra em ciclo** |
| Fora do contrato | 1 | Resposta de renovação sem `tokens.refreshToken` não grava `"undefined"` nem destrói o token |
| Entrar e sair | 3 | Perfil pedido com o token de acesso; sair limpa e o pedido leva o `Bearer`; sair limpa **mesmo com o servidor a falhar** |

**Instrumentação:** `fetch` é substituído (não o `api`), para que o teste observe o que **sai para a
rede** e o que fica em armazenamento; `localStorage`/`sessionStorage` são dublês em memória. Um
**modelo de servidor com rotação** (`servidorComRotacao`) aceita apenas o token de acesso emitido por
último e **recusa um token de renovação já usado** — sem esse modelo, um cliente que reenviasse o
token antigo receberia uma sessão nova e o defeito da rotação perdida ficaria invisível.

### 4.2 Os testes foram escritos **antes** da correção

Corridos contra o código intacto: **14 vermelhos / 3 verdes**. Os vermelhos incluem
«o início de sessão grava em armazenamento o token que veio em `tokens.refreshToken`» e «dois pedidos
que recebem 401 ao mesmo tempo fazem uma só renovação» — ou seja, o defeito está medido, não deduzido.

### 4.3 Quatro verdes eram falsos, e foram endurecidos

Antes da correção, quatro testes passavam **por vacuidade**: afirmavam que algo era `null` num código
onde nunca era outra coisa.

| Teste | Porque passava em falso | Correção |
| ----- | ----------------------- | -------- |
| não pede renovação e envia o token no cabeçalho | «não renovou» era verdade por não haver o que renovar | passou a afirmar `getRefreshToken() === 'refresh-1'` antes do pedido |
| sem token de renovação guardado, um 401 não tenta renovar | o estado era o defeito, não uma escolha | passou a afirmar a **precondição** (`null`) explicitamente |
| sair limpa os tokens e o pedido de saída é feito antes | «ficou sem tokens» era verdade por nunca ter havido nenhum | passou a afirmar o token guardado antes do logout |
| sair limpa os tokens mesmo quando o servidor falha | idem | idem |

### 4.4 Três defeitos nos meus próprios testes (encontrados ao correr)

Declarados porque foram reais e porque o resultado de os corrigir não é cosmético:

1. **Rotação:** o segundo pedido do teste usava um token de acesso que o dublê aceitava, pelo que
   **não havia segundo 401** e a segunda renovação nunca acontecia — o teste passava sem exercer o que
   afirmava. Corrigido com o modelo de rotação e uma `expira()` explícita entre ciclos.
2. **«Sem repetir»:** afirmei 2 tentativas do pedido original quando a renovação falha. É **1**: sem
   token novo, repetir só somaria um 401. O teste estava errado, não o código.
3. **Falha de rede:** o dublê lançava exceção **em todos** os pedidos, incluindo o original, pelo que
   nunca chegava a haver 401 nem tentativa de renovação. Corrigido para falhar **só** na renovação.

---

## 5. Prova por mutação

Quatro mutações, aplicadas por script que **afirma que a âncora ocorre exatamente uma vez e aborta
antes de escrever** se não ocorrer (uma mutação que não se aplica produz um falso resultado: diria
«os testes não mordem» quando o que falhou foi a substituição).

| # | Mutação | Testes que **falham** | Veredicto |
| - | ------- | --------------------- | --------- |
| **M1** | `setTokens` deixa de gravar o token de renovação (**é o defeito original**) | **12** — toda a máquina de renovação colapsa | morta |
| **M2** | Sem guarda de renovação em curso (cada 401 renova por si) | **1** — «dois pedidos que recebem 401 ao mesmo tempo fazem uma só renovação» | morta, **cirúrgica** |
| **M3** | A rotação perde-se: volta a gravar o token **antigo** | **2** — «o token rodado substitui o anterior» e «um 401 depois de renovar não entra em ciclo» | morta |
| **M4** | `auth.login` volta a devolver a sessão inteira ao ecrã | **2** — «o valor devolvido ao ecrã não contém o token de renovação» e «depois de entrar, o perfil continua a ser pedido» | morta |

M2 e M4 são as que importam para a qualidade do conjunto: cada uma é morta por **exatamente** os
testes que descrevem a regra, sem arrastar o resto. Se M2 matasse 12 testes, não estaria a medir a
renovação única — estaria a medir a renovação.

**Reposição:** `sha256` de `client.ts` antes de tudo `1f3802cbe56a12517dc57e02c420352217ea26db29c7ec78463ac626ab6702e4`;
depois das quatro mutações e das reposições, **o mesmo valor**. O ficheiro está byte a byte igual ao
que foi entregue.

---

## 6. Typecheck

| Verificação | Comando | Resultado |
| ----------- | ------- | --------- |
| Web (toda a `src`) | `tsc -p apps/web/tsconfig.json --noEmit` | **exit 0** |
| Teste novo, **fora do repo** | `tsc -p %TEMP%/zemlo-web-tscheck/tsconfig.json --noEmit` | **exit 0** (278 ficheiros no programa) |

**Porque é que o teste precisou de um typecheck próprio (`PC-15`).** O `tsconfig.json` da web tem
`"include": ["src", "vite.config.ts", "vite-env.d.ts"]` — **`test/` está de fora**. Provado:
`tsc -p apps/web/tsconfig.json --noEmit --listFiles | grep -c "apps/web/test"` → **0** (de 355
ficheiros). O `typecheck` da web, sozinho, **não vê os testes**. O tsconfig restrito usa `typeRoots`
explícito, `paths` absolutos para `@zemlo/shared` e inclui `vite-env.d.ts` para tipar `import.meta.env`.

---

## 7. Contratos e impacto — declaração exigida antes de qualquer alteração

### 7.1 `packages/shared` — **alteração NÃO é necessária, e não foi feita**

Verificado **antes** de implementar, como pedido: `AuthTokens.refreshToken` **já é obrigatório**
(`types.ts:127`) e a API **já o devolve** (`buildSessionResponse`, `services/auth.ts:1390-1400`). O
defeito era inteiramente do lado do cliente: um campo lido no sítio errado. **Alterar o contrato para
facilitar a implementação web estaria errado** — o contrato estava certo e o cliente é que não o
cumpria.

Prova de que não foi tocado: `git status --porcelain packages/shared` → **vazio**, e os cinco
ficheiros por `sha256`:

| Ficheiro | `sha256` |
| -------- | -------- |
| `contracts.ts` | `de510b7042601c80bd4f4ecb1531b6849e15ce269e68f2a24f4d938e400ce4bc` |
| `types.ts` | `88c052d536105ecbd3a9f0108459b89b049add3bbdbb6eddb0294a3949bfdfde` |
| `registry.ts` | `6dfd79103734d1d2454c21448c7a5ead88b3b35425913f75ecb5178531ca93cd` |
| `index.ts` | `3c5fee85adfa739c5d53a545fa9f071dfb89d518502aabad7f3534b789db262c` |
| `version.ts` | `ab793281ae7739113061a9be7f2c4079502d8e5d45ed91e7c0b748659ee8070b` |

### 7.2 API — **impacto nenhum**

Nenhuma rota, serviço ou schema foi alterado. `POST /auth/refresh` já devolvia `{ user, tokens }` com
o token rodado (A23). O único efeito é que a web passa a **usar** o que a API já dizia.

### 7.3 Mobile — **impacto nenhum, e isto está verificado**

`auth.login` é do cliente web (`apps/web/src/api/client.ts`); o mobile tem o seu próprio cliente
Dart. Verificado por leitura: o cliente Dart **já lê `session.tokens.refreshToken`**
(`api_client.dart:199`, `auth_api.dart:101`) e o ficheiro tem o comentário
*«a leitura é `tokens.refreshToken`, e não um campo de topo»*. Ou seja, a lição deste defeito já
estava escrita no mobile desde `MOB-001`; o web é que ficou para trás.

**Consequência para `MOB-002`:** nenhuma dependência nova. `MOB-002` continua **bloqueada
operacionalmente por `MOB-007`** (o gate do ambiente Flutter), como já ficou fixado.

---

## 8. O que **não** fiz, e limitações

- **Não corri `vite build`.** O `typecheck` cobre toda a `src` e os testes cobrem o comportamento;
  um *bundle* não acrescentaria prova sobre a lógica de sessão, e produziria artefactos novos em
  `apps/web/dist`. Fica declarado como lacuna, não como sucesso.
- **Não houve verificação ponta a ponta num browser real contra a API real.** A prova está na
  fronteira certa para este defeito — o que sai para a rede e o que fica em armazenamento — mas não
  substitui abrir a aplicação, deixar o token expirar e ver a sessão continuar. A suíte da web não
  tem `jsdom` nem `@testing-library` (decisão de projeto já registada), pelo que um teste de browser
  seria infraestrutura nova.
- **Não mexi no ROADMAP**, nem em `PC-*`, nem no trabalho de A1/A2/A4.
- **Resíduo temporário que não consegui pôr na Reciclagem.** O harness de mutação e o `tsconfig`
  restrito vivem em `%TEMP%\zemlo-web-tscheck\` (`tsconfig.json`, `mutate.mjs`, `client.ts.orig`).
  As três vias de Reciclagem foram **bloqueadas por política**: `Add-Type` («compiles and loads .NET
  code at runtime»), `Reflection.Assembly` («equivalent to Add-Type») e COM `Shell.Application`
  («COM object instantiation can run arbitrary code»). Como a regra do projeto é Reciclagem e
  **nunca `rm`**, os ficheiros ficaram onde estão — fora do repositório, no diretório de temporários
  do sistema. Estão listados aqui para não serem um resíduo invisível.

---

## 9. Achados novos — **propostos a A9, não tratados**

Nenhum destes foi corrigido: ficam para A9 decidir se viram tarefa ou `PC-*`.

1. **`RequestOptions.skipRefresh` é uma opção morta.** Declarada em `client.ts:187` e lida em
   `:306`, mas **nenhum chamador a define** (`grep` sobre `apps/web/src` e `apps/web/test` → 0 fora
   do próprio ficheiro). Foi provavelmente criada para o pedido de renovação se proteger a si mesmo —
   proteção que hoje é dada pelo `fetch` direto em `refreshAccessToken`. Removê-la é uma linha, mas é
   API pública do cliente: decisão de A9.
2. **Um 401 depois de uma renovação bem-sucedida repete o ciclo a cada pedido.** Não é um ciclo
   infinito (é uma renovação e uma repetição por pedido, como o teste fixa), mas se o servidor
   recusar sempre o recurso com 401 apesar de um token fresco, cada ação do utilizador custa três
   idas à rede. Assinalado como observação de baixa severidade: um token válido recusado por um
   recurso seria, em rigor, um 403.
3. **17 ficheiros `vite.config.ts.timestamp-*.mjs` em `apps/web/`.** São resíduo de execuções do
   Vite; estão cobertos pelo `.gitignore:72` (`*.timestamp-*.mjs`), pelo que não entram em git.
   Registado só para que a limpeza não seja confundida com ficheiros de trabalho.

---

## 10. Blocos propostos para integração no ROADMAP (a aplicar **por A9**)

### 10.1 Fecho da tarefa — §5.3, substitui o corpo de `WEB-013`

```markdown
#### WEB-013 · O cliente web nunca guarda o token de renovação — A3 · P1 · `DONE`

**Fecho (2026-09-22).** O cliente web guardava o token de acesso e **descartava o de renovação**, pelo
que a renovação silenciosa era impossível: `auth.login` lia `session.refreshToken` (campo que a API
não envia), `setTokens` só escrevia com um segundo argumento que era sempre `null`, `getRefreshToken()`
devolvia sempre `null` e `refreshAccessToken()` saía à primeira linha **sem fazer pedido nenhum**. A
sessão terminava à hora do token de acesso, apesar dos **90 dias** configurados.

**É uma regressão da A23 do lado do cliente.** A A23 fixou que o token é devolvido em
`tokens.refreshToken` e rodado em cada renovação — e regista que o defeito do servidor *«foi encontrado
pela aplicação web»*. O cliente que o descobriu reproduziu-o a seguir, com o mesmo erro de leitura de
contrato; o docblock do contrato (`types.ts:118`) avisa exatamente deste modo de falha.

| Implementação | Ficheiro | `git diff --numstat` |
| ------------- | -------- | -------------------- |
| `setTokens` passa a ter **uma só fonte** (`tokens.refreshToken`); o 2.º parâmetro desaparece | `apps/web/src/api/client.ts` | **+65 / −24** |
| Interface local `AuthResponse` (com o campo de topo inventado) **apagada** | `apps/web/src/api/client.ts` | (incluído acima) |
| `auth.login`/`auth.signup` devolvem **`UserProfile`** — o token deixa de ser exposto à UI | `apps/web/src/api/client.ts` | (incluído acima) |
| `refreshAccessToken` grava o token **rodado**; guarda de renovação única movida para antes da leitura do armazenamento | `apps/web/src/api/client.ts` | (incluído acima) |
| Adaptação ao novo tipo de retorno + comentário do ramo `getRefreshToken()` | `apps/web/src/app/SessionContext.tsx` | **+18 / −7** |
| 17 testes do ciclo de sessão | `apps/web/test/session-refresh.test.ts` | **novo, 566 linhas** |

**Testes.** Escritos **antes** da correção e corridos contra o código intacto: **14 vermelhos / 3
verdes** — o defeito está medido, não deduzido. Quatro verdes eram **falsos** (afirmavam `null` num
código onde nunca era outra coisa) e foram endurecidos com a precondição afirmada. Depois da
correção: **17/17 verdes**; suíte completa da web **8 ficheiros / 151 testes / exit 0**.

**Prova por mutação — 4 mutações, 4 mortas:**

| # | Mutação | Testes que falham |
| - | ------- | ----------------- |
| M1 | `setTokens` deixa de gravar o token de renovação (**o defeito original**) | **12** |
| M2 | Sem guarda de renovação em curso | **1** — a do single-flight, cirúrgica |
| M3 | A rotação perde-se (regrava o token antigo) | **2** |
| M4 | `auth.login` volta a devolver a sessão à UI | **2** |

Reposição verificada por `sha256`: `1f3802cb…` antes e depois das quatro mutações.

**Validação.** `tsc -p apps/web/tsconfig.json --noEmit` → **exit 0**. O `tsconfig` da web **exclui
`test/`** (`--listFiles | grep -c apps/web/test` → **0** de 355 ficheiros), pelo que o teste novo foi
verificado por `tsconfig` restrito **fora do repo**, com `typeRoots` explícito (`PC-15`) → **exit 0**.

**Contrato.** **Não** exigiu alteração a `packages/shared` — e alterá-lo estaria errado: o campo
`AuthTokens.refreshToken` já era obrigatório e a API já o devolvia. Verificado antes de implementar e
provado por `git status` vazio e por `sha256` dos cinco ficheiros.

**Impacto:** API **nenhum**; Mobile **nenhum** (o cliente Dart já lia `tokens.refreshToken` desde
`MOB-001`).

**Dependências desbloqueadas:** nenhuma. Não bloqueia nem desbloqueia outra tarefa.

**Limitações (declaradas, não escondidas):** `vite build` não foi corrido; não houve verificação
ponta a ponta num browser real contra a API real — a prova está na fronteira do transporte e do
armazenamento, que é onde o defeito vivia.

**Diff revisto.** Sim — os três ficheiros foram revistos linha a linha, e só eles são desta tarefa.

**Origem:** descoberto em `MOB-001` ao comparar o cliente do mobile com o da web. **Não** corrigido
dentro de `MOB-001` — é defeito de outra frente e o pedido exigia proposta prévia a A9 (§1.2).
```

### 10.2 Tabela de tarefas — §4

Substituir a linha de `WEB-013` (`READY` → `DONE`):

```markdown
| WEB-013  | Web          | O cliente web nunca guarda o token de renovação                        | A3     | P1         | `DONE`     | —                       |
```

### 10.3 Fila de A3 — §9

```markdown
| —     | `WEB-013` — Ciclo de sessão da web        | P1         | **`DONE`** (2026-09-22) — `setTokens` com uma só fonte, rotação preservada, renovação única, 17 testes e 4 mutações |
| 1     | `MOB-002` — Autenticação no mobile        | P1         | `READY` — desbloqueada por `MOB-001`; **não é considerada operacionalmente concluída enquanto `MOB-007` não passar** |
| 2     | `MOB-007` — Validar o ambiente Flutter (`flutter pub get`, `flutter analyze`, `flutter test`) | P1 | `READY` — **gate do ambiente Flutter**; `MOB-002` não fecha operacionalmente sem ele |
```

### 10.4 Entrada de changelog (fim de §13)

```markdown
| 2026-09-22 | A3 · `WEB-013` → **`DONE`** (proposto). O cliente web **descartava o token de renovação**: `auth.login` lia `session.refreshToken` (campo que a API não envia), `setTokens` só escrevia com um segundo argumento sempre `null`, e `refreshAccessToken()` saía à primeira linha sem fazer pedido — a sessão durava 1 hora em vez dos **90 dias** configurados. **Regressão da A23 do lado do cliente**: a própria A23 regista que o defeito do servidor foi *«encontrado pela aplicação web»*, e o cliente que o descobriu reproduziu-o a seguir. `setTokens` passou a ter **uma só fonte** (`tokens.refreshToken`); a interface local `AuthResponse` — com o campo de topo inventado — foi **apagada**; `auth.login`/`auth.signup` passaram a devolver **`UserProfile`**, deixando de expor o segredo à UI; a guarda de renovação única foi movida para **antes** da leitura do armazenamento, para quem chega depois se juntar à renovação em curso. **Testes escritos antes da correção: 14 vermelhos / 3 verdes** (quatro dos verdes eram **falsos** e foram endurecidos com a precondição afirmada); depois **17/17**, suíte da web **151 testes / exit 0**. **4 mutações, 4 mortas** — incluindo a do defeito original (12 testes) e a do single-flight (1 teste, cirúrgica); reposição por `sha256` `1f3802cb…` antes e depois. `typecheck` da web **exit 0**; o `tsconfig` da web **exclui `test/`** (0 de 355 ficheiros), pelo que o teste novo foi verificado por `tsconfig` restrito fora do repo (`PC-15`) → **exit 0**. **Contrato partilhado intocado** — e alterá-lo estaria errado: `AuthTokens.refreshToken` já era obrigatório e a API já o devolvia (verificado antes de implementar; `git status` vazio e `sha256` dos 5 ficheiros). Impacto: **API nenhum; Mobile nenhum** (o cliente Dart já lia `tokens.refreshToken` desde `MOB-001` — o web era o outlier). Achados novos propostos, **não** tratados: `RequestOptions.skipRefresh` é opção morta; um 401 depois de renovar repete o ciclo a cada pedido. **Sem commit, sem push, sem deploy.** |
```

---

## 11. Verificação das afirmações (feita, não assumida)

| Afirmação | Como foi verificada |
| --------- | ------------------- |
| «14 vermelhos antes de corrigir» | corrida do ficheiro de teste contra o `client.ts` intacto, `Tests 14 failed \| 3 passed (17)` |
| «17/17 verdes» | corrida depois da correção, `Tests 17 passed (17)` |
| «151 testes na web, exit 0» | suíte completa, `Test Files 8 passed (8) / Tests 151 passed (151)` |
| «4 mutações, 4 mortas» | cada mutação aplicada por script com âncora verificada, testes corridos, ficheiro reposto |
| «o ficheiro ficou byte a byte» | `sha256` `1f3802cbe56a12517dc57e02c420352217ea26db29c7ec78463ac626ab6702e4` antes e depois |
| «o typecheck da web exclui os testes» | `--listFiles \| grep -c "apps/web/test"` → **0** |
| «contrato intocado» | `git status --porcelain packages/shared` → vazio, mais `sha256` dos 5 ficheiros |
| «não há commit meu» | `git log origin/main..HEAD` → 3 commits, todos de **2026-09-21**, de `mpmguedes` (SMTP) |
| «não toquei nos ficheiros de outros agentes» | `mtime` dos meus 22:36–22:38 vs. 11:07–11:51 dos restantes |
| «não houve mudança de fim de linha» | contagem de `\r` igual em `HEAD` e no working copy (**0** em ambos) |
