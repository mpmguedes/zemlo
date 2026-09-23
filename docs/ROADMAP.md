# Zemlo — Roadmap e coordenação de desenvolvimento

> **Fonte de verdade do desenvolvimento.** Este documento diz *o que* vamos construir, *por  
> quem*, *em que ordem* e *como se sabe que está feito*. As decisões arquiteturais continuam  
> em `docs/DECISIONS.md`; a descrição do sistema em `docs/ARCHITECTURE.md`; o contrato em  
> `docs/API.md`; as operações em `docs/OPERATIONS.md`; a marca em `docs/BRAND.md`.

**Preparado por:** A9 · **Data:** 2026-09-22 · **Estado do repositório no momento da escrita:**  
`HEAD` `1ca92d4`, `origin/main` `096582d` (0 à frente / 3 atrás), working tree com trabalho  
não publicado do 🔴-1.

---

## 0. Como ler este documento

| Quero saber…                   | Vou a…                                            |
| ------------------------------ | ------------------------------------------------- |
| O que está feito e o que falta | §3 Inventário do estado real                      |
| Todas as tarefas numa vista    | §4 Tabela geral                                   |
| O detalhe de uma tarefa        | §5 Tarefas por área                               |
| Por onde começar               | §9 Tarefas READY por agente                       |
| O que bloqueia o quê           | §8 Conflitos e dependências                       |
| As regras de quem trabalha     | §1 Regra de alteração · §10 Regra para os agentes |

**Não duplicar aqui:** decisões (A1–A30), esquema da base de dados, contrato de endpoints e  
procedimentos de deploy. Este documento referencia-os e acrescenta apenas o que é de  
planeamento: estado, prioridade, responsável, dependências, critérios e testes.

---

## 1. Regra de alteração do roadmap

### 1.1 A regra dos dois momentos (a mais importante)

> **O ROADMAP é atualizado duas vezes por cada alteração significativa: antes da  
> implementação, para definir exatamente o que será feito, e depois da implementação, para  
> registar exatamente o que foi feito e validado.**

O objetivo é evitar o problema clássico: o roadmap a dizer *"Login Google — por fazer"*  
enquanto existem 2 000 linhas de código experimental espalhadas pelo projeto. Uma tarefa que  
não está escrita antes não pode ser implementada; uma tarefa implementada sem registo de  
fecho fica com estado mentiroso.

### 1.2 Antes de começar uma tarefa

A tarefa **tem** de existir neste documento e ter: `ID`, título, agente, prioridade, estado,  
descrição, objetivo, dependências, critérios de aceitação e testes/validação previstos.

Se durante o desenvolvimento aparecer trabalho adicional:

1. **não** o esconder dentro da tarefa original;
2. criar uma subtarefa ou nova tarefa no ROADMAP;
3. definir a relação/dependência;
4. só depois implementar.

**Quando é que os campos acima são obrigatórios (política decidida por A9, 2026-09-22).** O `ID`,
título, agente, prioridade, estado e dependências são obrigatórios **desde o momento em que a tarefa
é criada**. A descrição, o objetivo, os critérios de aceitação e os testes/validação previstos são
obrigatórios **antes de a tarefa ser pegada** — isto é, para que a tarefa possa estar em `READY` ou
`IN_PROGRESS`. Uma tarefa em `BACKLOG`, `BLOCKED` ou `DEFERRED` pode legitimamente existir só com
título, desde que o estado seja honesto quanto ao que falta:

- `BLOCKED` — há uma condição externa por satisfazer (decisão de produto, dependência, ambiente);
- `DEFERRED` — foi deliberadamente adiada;
- `BACKLOG` — ainda não começada e **sem** condição externa conhecida; se lhe falta o corpo, o
  primeiro passo ao pegá-la é **escrever o corpo**, e não implementar.

**A ausência de corpo nunca é uma implementação implícita.** Uma tarefa sem descrição não está
meio-feita: está por especificar. `PC-37` regista a medição (14 de 65 tarefas da §5 sem corpo) e a
razão por que 12 delas são legítimas como estão e 2 (`OPS-002`, `OPS-003`) passaram a `BLOCKED`.

### 1.3 Durante o desenvolvimento

O agente mantém o ROADMAP coerente com o que está efetivamente a fazer. Se descobrir que a  
arquitetura prevista está errada, que falta uma dependência, que a tarefa é maior do que o  
previsto, que é necessária outra tarefa, que a funcionalidade já existe parcialmente, ou que  
há conflito com outro agente — **regista no ROADMAP**.

### 1.4 Para fechar uma tarefa (`DONE`)

Uma tarefa só passa a `DONE` depois de:

- implementação concluída;
- testes concluídos;
- typecheck concluído;
- validações específicas concluídas;
- documentação atualizada quando necessário;
- migrations documentadas quando existirem;
- contrato `packages/shared` atualizado quando aplicável;
- impacto nos outros agentes identificado;
- diff revisto.

E de registar no ROADMAP: o que foi implementado, ficheiros/áreas alterados, testes,  
validação, dependências desbloqueadas, limitações e o commit associado, quando existir.

### 1.5 Estados

`BACKLOG` · `READY` · `IN_PROGRESS` · `BLOCKED` · `REVIEW` · `DONE` · `DEFERRED` · `CANCELLED`

**Não marcar `DONE` só porque o código foi escrito.**

### 1.6 Prioridades

|      | Significado                                                           |
| ---- | --------------------------------------------------------------------- |
| `P0` | Bloqueador / segurança / corrupção de dados / funcionamento essencial |
| `P1` | Funcionalidade essencial do roadmap                                   |
| `P2` | Importante mas não bloqueante                                         |
| `P3` | Melhoria / conveniência                                               |
| `P4` | Futuro                                                                |

Sem pontuações nem rankings subjetivos.

### 1.7 Identificação

IDs estáveis por área: `AUD-` `AUTH-` `WEB-` `MOB-` `PROD-` `INT-` `OPS-` `DOC-` `TEST-`  
`DB-`. **Não renumerar tarefas existentes só porque a ordem mudou.**

---


## 2. Problemas conhecidos

> Regra do projeto: qualquer problema detetado e **não** corrigido no momento fica registado  
> aqui. É a memória operacional — por onde qualquer agente futuro entra sem se perder.

| #    | Problema                                                                                                                                                                                                              | Onde                                             | Gravidade           | Estado                 |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------- | ---------------------- |
| PC-1 | Os checks de consumo do `verify.ts` são **insensíveis** à correção de A8: medido, a série que constroem dá `6` na implementação antiga **e** na nova. Passavam antes e passam depois — zero proteção contra regressão | `apps/api/scripts/verify.ts:477-481`, `:718-721` | Média               | **Fechado** por `AUD-012` (2026-09-22) — série com um parcial **entre** dois depósitos atestados: `6` na implementação atual, `10` na antiga, provado por mutação. Ver `AUD-012` |
| PC-2 | Divergência **aceite e deliberada** entre `averageFuelConsumption` (`null`) e `deriveFuelConsumption` (valor) quando há um abastecimento sem odómetro entre dois atestados. Fixada por teste nos dois lados           | `domain/calculations.ts`                         | Baixa (documentada) | Aceite                 |
| PC-3 | `apps/api/dist/` local contém uma build **obsoleta** (pré-correção). Não é versionada (`.gitignore:5`), mas engana quem correr o output compilado em vez do `tsx`                                                     | `apps/api/dist/`                                 | Baixa               | **Fechado** por `OPS-004` (2026-09-22) — `dist/` regenerado pelo comando do projeto (`npm run build --workspace @zemlo/api`, exit 0); **0** ficheiros perdidos e **86** de 150 diferentes, provado por comparação `sha256` ficheiro a ficheiro. `dist/` é ignorado, logo **sem** alteração versionada     |
| PC-4 | Ficheiro extraviado `dev/null` (7729 B): um `2>/dev/null` escreveu num caminho literal — mas o conteúdo é **stdout** de um transpilador, pelo que o redireccionamento terá sido `> dev/null`, sem o `2` (nota de A1 em `OPS-005`). Não rastreado e **não** ignorado — um `git add -A` futuro apanha-o                                                            | `dev/null`                                       | Baixa               | **Fechado** por `OPS-005` (2026-09-22) — removido para a **Reciclagem** (7 729 B, `sha256` conferido) e acrescentada ao `.gitignore:45` uma regra **estreita** `dev/null`, verificada por `git check-ignore`     |
| PC-5 | Cobertura de testes concentrada em import/export: 20 dos 34 ficheiros. `vehicles`, `financial`, `compliance`, `reminders` continuam **sem** ficheiro de teste em `npm test` | `apps/api/test/` | Alta | **Fechado** por `TEST-001` (2026-09-22) — **161 testes novos** nas quatro áreas, provados por mutação |
| PC-6 | Sem CI: `verify*` (que cobre auth/veículos/registos) não corre automaticamente. Um commit que parta o `auth` passa `npm test` a 100%                                                                                  | —                                                | Alta                | **Fechado** por `OPS-001` (2026-09-22) — dois trabalhos: `qualidade` (tipos, testes, config) e `verificacao` (base semeada + servidor; `verify` 231, `verify:auth` 51, `verify:regressions` 70, todos exit 0). Ver §5.7 |
| PC-7 | Os números do README estão desatualizados (27→29 tabelas, 63→1448 testes, 30→32 rotas — os dois últimos eram eles próprios medições desatualizadas; medido em 2026-09-22: **1 841** testes e **31** rotas)                                                                                                                                | `README.md:19-22`                                | Baixa               | **Fechado** por `AUD-010` (2026-09-22) — 12 ocorrências corrigidas (6 quantidades); `npm run readme:numbers` mede as estáticas e falha se divergirem, e o CI corre-o. `DOC-001` fica `CANCELLED` (dona: `AUD-010`)     |
| PC-8 | `domain/import/migrate.ts` (440 linhas) tem `MIGRATIONS` vazio e é inalcançável com `FORMAT_VERSION === MIN_SUPPORTED === 1`. Andaime declarado, nunca executado a sério                                              | `domain/import/migrate.ts`                       | Média               | Aberto — `AUD-011`     |
| PC-9 | Sem agendador: `syncNotifications` só corre como efeito lateral de abrir o dashboard. **Um lembrete legal não avisa ninguém enquanto ninguém olhar**                                                                  | `services/`                                      | Média               | **Resolvido** — `PROD-004` `DONE` (2026-09-23). O agendador existe e corre sem pedido: `createJobRunner` (`jobs/runner.ts`) arranca em **`server.ts:79`** (depois do `listen`, e **não** em `createApp()`) e `jobs.stop()` é o 1.º passo do `shutdown` (`server.ts:96`). A descoberta que o dashboard já usava foi extraída de 3 linhas inline em `insights.ts` para `syncNotificationsForUser` (`services/notifications.ts`) — era exatamente esta a razão do `PC-9`. A idempotência é garantida pelo **índice único** de `dedupeKey`, não por uma verificação prévia (o `findFirst` é atalho, e a mutação que o removeu **sobreviveu por equivalência** — contra-prova em `PROD-004`). Intervalo configurável por `NOTIFICATIONS_SYNC_INTERVAL_MINUTES` (default **15**, **`0` desliga**, máximo **1440**), documentado em `OPERATIONS.md` §3.5.1; o mecanismo ficou registado em `DECISIONS.md` **A32**. |
| PC-10 | Texto desatualizado: a ficha do veículo afirma que «esta versão da API não serve bytes», quando `GET /documents/:documentId/content` existe e a página de detalhe já transfere ficheiros | `apps/web/src/pages/vehicles/VehicleDetailPage.tsx:1257-1261` | Baixa | **Fechado** por `AUD-009` (2026-09-22) — o texto a que se referia tinha **duas gerações**: a primeira já estava corrigida em `HEAD`; o que faltava corrigir era a geração seguinte, tornada falsa por `PROD-001`. Ver `AUD-009` |
| PC-11 | O ROADMAP descrevia `WEB-001` e `WEB-003` como inexistentes na web. **Ambas estão implementadas** (evidência em §5.3): o `grep` que a §3.2 cita devolve 10 ocorrências, não zero. `WEB-001` continua `BLOCKED` por `AUTH-001`, mas pelo motivo certo — a entrega de email, não a ausência de ecrã | `docs/ROADMAP.md` §3.2, §5.3 | Média | Descrições corrigidas (A3, 2026-09-22) |
| PC-12 | **O inventário de §3 e o estado de várias tarefas estavam desatualizados face ao código** — confirma e alarga `PC-11`. Verificado por A4 em `PROD-003`, por leitura **e por testes a correr** (80 verdes em `documents-http`/`document-storage`, typecheck API exit 0): (a) o download de documentos (`GET /documents/:id/content`) está implementado, testado e documentado desde `94b72c5` (2026-09-20) — §3.2 e `PROD-002` diziam "não existe endpoint"; (b) `updateDocument` e `downloadDocument` existem em `apps/web/src/api/queries.ts:254,270`; (c) `AUTH-001` está satisfeita na substância — `registerEmailSender()` (`email.ts:181`) é chamada no arranque (`app.ts:438`), escolhe `SmtpEmailSender` com `SMTP_HOST` e recusa arrancar em produção sem entrega —, ao contrário do "sem um único chamador em produção" de §3.2; (d) `PROD-001` afirmava que "a interface pede uma `storageKey` escrita à mão (`DocumentsPage.tsx:168`)" — esse campo **já não existe** no formulário (o `:163` é o «Validade» duplicado de `WEB-009`), pelo que o que resta aceitar `storageKey` é a **API** (`contracts.ts:577`). A causa é comum: o documento foi escrito a partir da documentação e de amostragem, não do código | `docs/ROADMAP.md` §§3, 4, 5.5 | Alta | §3 corrigido em §3.7; `PROD-002` fechada |
| PC-13 | **Nada apaga os bytes de um documento.** `documentStorage().remove()` tem **zero chamadores** em `apps/api/src/`. `deleteDocument` apaga a linha, os eventos e os lembretes, mas deixa o ficheiro no armazenamento para sempre. Não é fuga por API (a linha desaparece e a chave torna-se irresolúvel), mas é retenção indefinida de dados que o utilizador julgou ter apagado, e crescimento sem limite | `services/documents.ts:194-206` | Média | **Resolvido** — `PROD-007` `DONE` (2026-09-23). `discardDocumentBytes` deixou de ter zero chamadores: `deleteDocument` lê a chave **antes** do `delete`, apaga o registo e só depois remove os bytes, com **contagem de referências** — que existe por causa de `PC-21`, onde dois registos podem partilhar a mesma chave. `PROD-008` reutiliza a mesma função na substituição. **O que isto NÃO fecha:** `deleteAccount` apaga por cascata do esquema e contorna este caminho por completo — ver **`PC-51`**. |
| PC-21 | **O `storageKey` continua a ser aceite do cliente** em `POST /documents` e `PATCH /documents/:id` (`contracts.ts:577`). O campo já não é pedido pelo formulário e o upload gera a chave no servidor, mas o contrato continua a permitir que um cliente a escreva. **Não é falha de isolamento** — o armazenamento recusa qualquer chave cujo prefixo não seja o do utilizador autenticado, e `assertSafeKey` recusa caminhos absolutos e `..` — mas é um campo que já não devia existir no pedido. Retirá-lo é uma alteração de contrato partilhado (§6) e exige coordenação com A2/A3, pelo que **não** foi feito em `PROD-001` | `packages/shared/src/contracts.ts:577` | Baixa | Aberto — precisa de tarefa própria (§6) |
| PC-14 | **O guarda que recusa arrancar em produção sem entrega de email tem ZERO cobertura de testes.** O `if (false && …)` observado era **uma mutação deliberada de A2** (prova por mutação de `AUTH-001`), **já reposta** — hash `66eefbd1…`, `git status` limpo para o ficheiro: `if (false && config.isProduction && !allowLogTransport)` (`services/email.ts:194`). Medido: com o guarda desativado, `test/email.test.ts` passa **12/12** e a suíte completa passa **1478/1478** — ou seja, **nenhum teste cobre a recusa de arranque em produção**. O comportamento do guarda está **correto** — confirmado por sonda direta em `NODE_ENV=production`: sem `EMAIL_ALLOW_LOG_TRANSPORT` lança; com `=true` degrada para `ConsoleEmailSender` com aviso. É **cobertura em falta, não defeito**. **Deteção: A1, 2026-09-22, durante `AUD-002`; identificado como mutação de A2 e reposto por A2, 2026-09-22.** | `apps/api/src/services/email.ts:194` | Média | **Fechado** por `AUTH-008` (2026-09-22) — 7 testes novos, provados por mutação |
| PC-15 | **Os ficheiros de teste não são verificados por tipos.** O `typecheck` corre `tsc -p tsconfig.json --noEmit`, e esse `tsconfig` tem `"exclude": ["**/*.test.ts"]`. O Vitest transpila sem verificar tipos, pelo que um erro de tipo num teste não falha nada — nem a suíte, nem o typecheck. Verificado: o novo `test/timeline.test.ts` só ficou verificado por um `tsc` explícito. Não é defeito de produto; é um buraco na rede de segurança (liga-se a `TEST-002` e `OPS-001`). **Deteção: A1, 2026-09-22.** | `apps/api/tsconfig.json:21` | Média | Aberto — ver `OPS-001`  **Medido por A1 (2026-09-22) em `TEST-001`, e é a demonstração de que o buraco é real:** um `tsc` explícito sobre os quatro ficheiros novos devolveu **um erro de tipo verdadeiro** (a tabela de operações de `reminders-http.test.ts` declarava `'get' | 'patch' | 'delete'` mas continha linhas `'post'`) — que o `typecheck` do projeto **nunca** teria visto, porque exclui os testes. Corrigido. O que resta nos ficheiros novos é o mesmo `TS2322` de `appPrisma = prisma;` que `test/documents-http.test.ts:82` já tinha antes de eles existirem: é do **padrão do harness**, não dos testes novos. **Material novo medido em `TEST-002` (A1, 2026-09-22):** o ficheiro `apps/api/test/contract-http.test.ts` é **limpo em tipos** sob um `tsc --noEmit` explícito (`exit 0`, zero erros), porque **infere** o tipo do cliente Prisma (`(typeof import('../src/core/db.js'))['prisma']`) em vez de o anotar com `PrismaClient` — é a diferença exata que produz o `TS2322` pré-existente do harness (`documents-http.test.ts:82`). Se `PC-15` for fechado por um `tsconfig` de testes, este ficheiro não acrescenta ruído e o padrão de inferência é o que os outros podem adotar. |
| PC-19 | **Três textos descrevem mal a entrega de email** (nenhum afeta o comportamento; todos enganam quem lê). **Renumerado de `PC-16`** — colisão de três agentes no mesmo ID, ver `PC-18`. (a) `services/email.ts` afirma, em dois docblocks, que a chave `text` está em `SENSITIVE_KEYS` e que é isso que protege o corpo — **falso**: `'text'` nunca esteve nessa lista (`git log -S` sem resultado) e, se estivesse, o valor inteiro seria substituído por `[redigido]`, contradizendo o teste que exige a mensagem legível; a única proteção real é `redactResetLinks()`, aplicada pelo próprio sender. (b) `OPERATIONS.md` §3.4.1 diz que é «obrigatório ligar um transporte real — implementar `EmailSender` … e registá-lo com `setEmailSender`» (feito em `1eac3a7`) e mostra o log com a chave `body`, que era **o defeito corrigido**. (c) `EMAIL_ALLOW_LOG_TRANSPORT` — a escapatória que permite arrancar em produção sem entrega — **não aparece em `OPERATIONS.md`**. **Deteção: A2, 2026-09-22, durante `AUTH-001`.** | `apps/api/src/services/email.ts`, `docs/OPERATIONS.md` §3.4.1 | Baixa | **Fechado** por `AUTH-009` (2026-09-22) |
| PC-16 | **`apps/api/src/services/email.ts` está a ser mutado por outro agente durante a sessão de A1.** Entre duas observações minhas, com minutos de intervalo, o `false &&` mudou de sítio: primeiro em `if (false && config.isProduction && !allowLogTransport)` (`:196`), depois em `if (false && enabled && host)` (`:184`); o `mtime` do ficheiro ficou **13 segundos** antes da verificação. No estado atual, com `SMTP_HOST` definido, o ramo SMTP está desativado e o remetente escolhido é o `ConsoleEmailSender` — **os emails iriam para o log sem erro nenhum**. É uma mutação de teste em curso ou um resíduo; em qualquer dos casos **não pode ser commitada**. Consequência de coordenação: `AUD-004` fica `BLOCKED` enquanto o ficheiro não estabilizar (§8.1 já previa este conflito). **Deteção: A1, 2026-09-22.** | `apps/api/src/services/email.ts:184,196` | **Alta** | **Fechado** — era a mutação M2 da verificação de `AUTH-001` (A2), já reposta; hash `66eefbd1…` (A2) e `58345a66…` (A1) confirmados. Ver `AUD-004` |
| PC-17 | **O cabeçalho do calendário mostra uma data em vez do nome do mês.** `monthLabel = dateLong(\`${month}-01\`).replace(/^1 de /, '').replace(/^1 /, '')` (`CalendarGrid.tsx:97`): os dois `replace` esperam a forma `1 de setembro de 2026`, que é a do CLDR de `pt`/`pt-BR`; mas `dateLong` pede `{day:'2-digit', month:'short'}` a `pt-PT`, e o CLDR do `pt-PT` resolve esse esqueleto para `dd/MM/y`. Medido (ICU 78, `pt-PT` em `supportedLocalesOf`): `dateLong('2026-09-01')` → `01/09/2026`; com `pt` → `01 de set. de 2026`. Consequência: os `replace` são **código morto** e o título do mês mostra `01/09/2026`. `monthLong()` (`lib/format.ts:165`) devolve `setembro de 2026` — exatamente o rótulo que aqui se quer — e está exportado **sem um único consumidor**. O comentário de `dateLong` (`16 set 2026`) descreve uma saída que o `pt-PT` **não** produz, o que é uma armadilha para quem o reutilizar. **Deteção: A3, 2026-09-22, durante `WEB-005`** — um teste de estado meu falhou por asserção sobre esta data, e foi a investigação da falha que expôs o defeito. *(Esta linha nasceu como `PC-16` e foi renumerada para `PC-17` por A3 às 11:19 — ver `PC-18`. As referências a `PC-16` em `WEB-010` e no changelog foram atualizadas; as de A1 e A2 não foram tocadas.)* | `apps/web/src/components/CalendarGrid.tsx:97`, `apps/web/src/lib/format.ts:153-168` | Baixa | **Resolvido** — `WEB-010` `DONE` (2026-09-23). Medição de A3 acrescentou a causa exata: a degradação de `month:'short'` para `2-digit` é provocada **pelo ano** no esqueleto (`{month:'short', year:'numeric'}` → `09/2026`), e sem ano o nome curto sobrevive (`{month:'short'}` → `set.`) — logo os `replace` nunca poderiam casar com nenhum esqueleto do módulo. `monthLong` é a **única** forma de obter o nome do mês em `pt-PT`, e passou a ter consumidor. Linhas: as funções de data (`dateLong`/`dateShort`/`monthLong`) passaram de `153-168` para `179-199` — medido por A9 contra `HEAD`, que ainda tem o estado pré-correção. *(A proposta indicava `142-199`; `142` é o `DATE_FORMATTER`, não as funções.)* |
| PC-18 | **O ROADMAP não tem mecanismo de atribuição de IDs, e três agentes atribuíram `PC-16` no mesmo intervalo de minutos.** Às 11:19 havia **três linhas `PC-16`** na tabela de §2: de A2 («três textos descrevem mal a entrega de email»), de A1 («`email.ts` está a ser mutado por outro agente») e de A3 (cabeçalho do calendário). Consequência: uma referência textual a `PC-16` (existem em §4 `AUTH-009`, §5.1 `AUD-004` e §5.3 `WEB-010`) passa a ser **ambígua**, e o leitor tanto pode seguir a linha certa como a errada — sem erro nenhum visível. O mesmo risco existe para os IDs de tarefa (`WEB-`/`AUD-`/`PROD-`), onde o dano é maior: dois agentes a criar a mesma tarefa com conteúdos diferentes. A causa não é distração: é a ausência de uma regra de alocação escrita em §1.7, que descreve o formato dos IDs mas não diz **como** obter o próximo. **Deteção: A3, 2026-09-22.** Mitigação mínima proposta (não aplicada — mexe em §1.7, que é de todos): exigir que quem cria um ID leia a tabela **imediatamente antes** de escrever e reconfirme depois, e tratar a colisão renumerando **a linha mais recente**, não a mais antiga, porque as referências mais antigas já estão espalhadas pelo documento. **Confirmado em duas rondas, no mesmo dia:** às 11:19 havia **três** linhas `PC-16`; às 11:30 havia **duas** linhas `PC-14`; às 11:34 outro agente renumerou o `PC-14` dele para `PC-21` **no mesmo minuto** em que A3 fez o mesmo com outra linha — duas rondas da mesma corrida, em quinze minutos, com o mesmo desfecho. A3 nunca renumerou linha alheia (renumerou sempre a sua e registou o resto aqui), porque renumerar a linha de outro agente a meio da sessão dele é a forma mais rápida de provocar a perda descrita em `PC-20`. **Mitigação aplicada por A3:** a sua linha de contraste foi para `PC-24`, com folga deliberada de `PC-22`/`PC-23`, porque alocar o «máximo + 1» é precisamente o que colide — quem calcular o próximo a partir do máximo já não a apanha. O que falta é a regra escrita em §1.7 | `docs/ROADMAP.md` §1.7, §2 | Média | Aberto — sem tarefa; requer decisão de coordenação |
| PC-20 | **O ROADMAP perde alterações quando dois agentes o editam ao mesmo tempo.** Verificado por A1 em 2026-09-22: três edições minhas foram revertidas em silêncio no espaço de minutos — as linhas de `AUD-004` e `AUD-005` na tabela de §4 (voltaram a `READY`), o cabeçalho de `AUD-005` (`DONE` → `READY`) e o registo da procura do relatório em `AUD-003`. O corpo das **outras** secções que eu escrevi sobreviveu, o que mostra que não foi uma reescrita total: foi a escrita de uma versão **estale** de uma região. O `mtime` do ficheiro esteve 2 segundos antes da verificação. Consequência: o documento-fonte-de-verdade pode afirmar o **oposto** do trabalho feito, sem erro nenhum visível — e é nele que os quatro agentes se coordenam. É a mesma raiz do `PC-18` (falta de regra de escrita), mas o dano é maior: `PC-18` é ambiguidade de referência, isto é **perda de conteúdo**. Mitigação mínima proposta: edições cirúrgicas numa só passagem (nunca ler-modificar-escrever o ficheiro inteiro) e reconfirmar a própria edição **imediatamente** depois de a escrever. **Deteção: A1, 2026-09-22.** **Segunda ocorrência, mais grave (medida por A9 em 2026-09-22):** o `docs/ROADMAP.md` foi **reescrito por um processo desconhecido** depois da consolidação. Medido: `sha256` passou de `eca5bb1de…` (285 040 B, CRLF, 2 945 linhas) para `91f5186a…` (501 946 B, **LF**, 3 700 linhas); **58** `**` convertidos em `\*\*` (o negrito deixa de renderizar), **~759 linhas vazias** inseridas entre linhas do mesmo parágrafo e o cabeçalho **`## 2. Problemas conhecidos` apagado**. A comparação ao nível das palavras mostra que o **conteúdo** é o mesmo (−253 / +450 palavras, quase todas espaços em volta de *backticks*): foi **reformatação**, não reescrita de conteúdo. A versão limpa foi recuperada **byte a byte** (`eca5bb1de…`) aplicando o diff da consolidação à cópia anterior, e é essa que serve de base à segunda consolidação. **Nenhuma edição por A9 deve ser dada como durável enquanto a origem das escritas não for conhecida.** | `docs/ROADMAP.md` (ficheiro inteiro) | **Alta** | Aberto — requer decisão de coordenação |
| PC-24 | **Contraste abaixo de WCAG AA, medido — não estimado.** Pares reais do produto, calculados pela fórmula de luminância relativa da WCAG sobre os valores de `theme.css`. **Tema claro:** `--z-text-muted` (#6f7d7c) sobre cartão = **4,29:1**, sobre o fundo = **4,08:1**, sobre superfície afundada = **3,82:1** — e este token é usado como `color:` em **36 declarações** de `app.css`, o que faz dele a falha mais disseminada do produto; `.z-chip--accent` = **3,66:1** (usado em `RecordDetailPage.tsx:95`); `.z-chip--ok`/`.z-banner--ok` = **3,82:1** (18 usos de `tone="ok"`); `.z-chip--danger`/`.z-banner--danger` = **4,43:1** (4 usos). **Tema escuro:** `.z-chip--accent` = **3,81:1**. Todo o texto do produto é 12–15 px, pelo que nada se qualifica como «texto grande» e o limiar aplicável é 4,5:1. Achado colateral da mesma família: `.z-btn--highlight` e o `＋` da barra inferior escrevem `#ffffff` **à mão** sobre âmbar-500 = **2,43:1**, quando o token `--z-highlight-ink` existe e dá **4,77:1** sobre o mesmo fundo — mas o `.z-btn--highlight` está morto (`grep` devolve zero), pelo que só o `＋` é falha visível. **O que está correto e não precisa de mexer:** texto normal (13,13:1), `--z-text-subtle` (6,51:1), botão primário nos dois temas (4,65:1 e 5,07:1), `.z-chip--warn` (9,87:1) e o anel de foco (4,65:1). **Deteção: A3, 2026-09-22, durante `WEB-006`.** *(Nasceu como `PC-21` e foi renumerado para `PC-24` por A3 às 11:34, depois de outro agente ter atribuído `PC-21` no mesmo minuto — ver `PC-18`. A folga `PC-22`/`PC-23` é deliberada: quem alocar o «próximo» número a partir do máximo não colide com esta linha.)* | `apps/web/src/styles/theme.css`, `app.css:957-968,1064-1079` | Média | **Resolvido** — `WEB-011` `DONE` (2026-09-22). A enumeração deste `PC-24` estava **incompleta**: a correção mediu de novo e encontrou **mais** pares abaixo do limiar do que os 6 listados, incluindo o **pior do produto** (`.z-banner--info` no tema escuro, `--z-petrol-800` sobre `--z-info-soft` = **1,18:1**, alcançável em 6 sítios) — ver **`PC-46`**. Corrigidos nos tokens: `--z-text-muted` neutral-500 → neutral-600 (4,29/4,08/3,82 → 6,51/6,20/5,81); `ok` → `#1b784f` (3,82 → 4,81); `danger` → `#ba3e0c` (4,43 → 4,75); `--z-accent-ink` petróleo-600/300 (3,66 → 4,98; escuro 3,81 → 5,55); `--z-info-ink` petróleo-800/200; `--z-highlight-contrast` âmbar-900; `--z-ok-contrast`/`--z-danger-contrast`. O `#1f8a5b` e o `#c2410c` originais **continuam disponíveis** (onde o contraste não exige 4,5:1). O `＋` da barra inferior e o badge passam a `var(--z-highlight-contrast)` (2,43 → 4,77 no claro; 1,88 → 6,18 no escuro). **O `.z-btn--highlight` continua código morto** (`grep` devolve zero em `.tsx`): foi corrigido por precaução, mas deve ser **removido ou usado** — decisão de A9. Zero falhas nos dois temas depois da correção; **58 testes** novos e **15 mutações** mortas. Linhas: `theme.css` 257 → 307; a tinta nova nasceu em `packages/shared/src/brand.ts` (`STATE_INK`). |
| PC-25 | **O identificador federado não tinha garantia estrutural.** O modelo `User` tem `authProvider` e `authProviderId` desde o início, mas o que os indexa é `@@index([authProvider, authProviderId])` — **não** `@@unique`. Consequência: ao nível da base de dados nada impedia duas contas de partilharem o mesmo par, e «duas contas nunca partilham o mesmo identificador federado» é literalmente um critério de aceitação de `AUTH-003`. O risco é concreto e não teórico: se a associação fosse feita por consulta-antes-de-gravar, dois pedidos simultâneos do mesmo utilizador podiam passar ambos a verificação e criar duas contas ligadas à mesma identidade Google. **Nenhum escritor existia ainda** (verificado: `grep` de `authProvider` em `apps/api/src`, `apps/api/test`, `apps/api/scripts`, `packages/shared/src`, `apps/web/src` e `seed.ts` devolve **zero**), pelo que a correção não tinha dados a migrar nem backfill — só podia ser feita agora, antes do primeiro escritor. **Deteção: A2, 2026-09-22, no levantamento de `AUTH-002` antes de escrever código.** | `apps/api/prisma/schema.prisma` (`model User`), `apps/api/prisma/migrations/` | Média | **Fechado** por `AUTH-002` (2026-09-22) — migration `20260922120000_federated_identity_unique`, registo em §7.1 |
| PC-26 | **O teardown da suíte deixa um `EBUSY` que faz falhar o ficheiro, não os testes.** Medido por A1 em 2026-09-22: a suíte completa da API terminou com **1511 testes passados e 0 falhados**, mas com **1 ficheiro marcado como falhado** — `test/import-apply-preview.test.ts` — por `Error: EBUSY: resource busy or locked, unlink '…\Temp\zemlo-test-*/test.db'` no teardown. A stack mostra que a remoção passa pelo *shim* `node-safe-delete-shim.cjs` do ambiente do agente, pelo que o bloqueio do ficheiro é do harness, não do produto. É a mesma família do `EBUSY` que o projeto já documenta (o `$disconnect()` antes do `destroy()`), mas com uma consequência nova: **o exit code é 1 mesmo com todos os testes verdes**. Para `OPS-001` isto é material — um CI que trate o exit code como verdade fica vermelho por ruído de ambiente e, ao segundo dia, alguém desliga o CI. **Deteção: A1, 2026-09-22.** | `apps/api/test/import-apply-preview.test.ts` (teardown) | Média | Aberto — a considerar em `OPS-001`. **Confirmado intermitente por A1, 2026-09-22:** duas execuções completas seguidas deram resultados diferentes — numa falhou (`oauth-google.test.ts`, não o ficheiro originalmente observado), na seguinte passou limpa (**43/43**), com os mesmos ficheiros e mais 3 testes. Um CI que trate o exit code como verdade fica vermelho **ao acaso** |
| PC-27 | **`apps/api/src/core/config.ts` referencia `API_BASE_PATH` sem o importar — a suíte inteira da API não arranca.** Medido por A1 em 2026-09-22, 11:46: `ReferenceError: API_BASE_PATH is not defined` em `config.ts:345` (`readOptionalString('GOOGLE_REDIRECT_URI') ?? `${publicBaseUrl}${API_BASE_PATH}/auth/google/callback``), no `import` de `core/db.ts` — pelo que **todos** os ficheiros de teste que importam a aplicação falham no arranque, com 0 testes corridos. Confirmado que **não** é do teste que o detetou: `test/fuel-consumption-http.test.ts`, que estava verde, falha com o mesmo erro. `API_BASE_PATH` é exportado por `@zemlo/shared` (`packages/shared/src/version.ts:16`) e é usado assim em `app.ts:13`; falta o `import` em `config.ts`. Contexto: é trabalho em curso de `AUTH-002` (login federado, `validateFederatedLoginConfig`), e o `mtime` do ficheiro mostra edição ativa. **A1 não corrigiu** — é ficheiro de outro agente e estava a ser editado (regra de coordenação de §8.1). Consequência prática: enquanto isto durar, **nenhum agente consegue verificar nada pela suíte**, e `TEST-001` fica bloqueada na validação. **Deteção: A1, 2026-09-22.** **Resolução (A2, 2026-09-22, mesma sessão):** era um **estado misto de `PC-20`** — o corpo de `config.ts` que usa `API_BASE_PATH` sobreviveu, mas o `import { API_BASE_PATH } from '@zemlo/shared';` que o acompanha foi revertido por uma escrita concorrente, e o ficheiro ficou a meio de duas versões. O `import` foi reposto e a suíte completa da API voltou a arrancar (**43 ficheiros / 1700 testes / 0 falhas**, exit 0). A observação de A1 estava **certa e foi útil**: foi ela que tornou visível uma reversão que, de outra forma, só apareceria como falha de tipo mais tarde. | `apps/api/src/core/config.ts:345` | **Alta** | **Fechado** por `AUTH-002` (A2, 2026-09-22) — era um **estado misto** de `PC-20`, não um defeito de desenho |
| PC-28 | **Uma conta criada por login federado nasce sem aceitação de termos, e não há ecrã que a peça.** Decisão de desenho de `AUTH-002` (A2, 2026-09-22), escrita aqui porque é dívida e não detalhe. Ao criar a conta pelo Google, o serviço grava `acceptedTermsAt: null` **de propósito**: o `id_token` prova que a pessoa controla aquele email, não que aceitou os termos do Zemlo, e gravar uma data ali seria registar uma aceitação que nunca aconteceu — exatamente o que §5.2 proíbe. Consequência: passa a existir um caminho de entrada que **contorna** o ecrã de aceitação que o registo por password exige, e o produto fica com duas classes de conta — umas com a data preenchida, outras sem. Nada no código atual distingue nem trata as duas. É dívida de **produto**, não falha de segurança: não há aqui escalonamento de privilégios nem acesso indevido, e a alternativa (recusar a criação até haver ecrã) contradiria a decisão D2 do utilizador. Precisa de tarefa própria: ecrã de aceitação no primeiro acesso federado, ou um critério escrito que diga o que a ausência da data significa. **Deteção: A2, 2026-09-22, ao implementar `AUTH-002`.** | `apps/api/src/services/oauth.ts` (`resolveFederatedAccount`), `apps/web/src/pages/SignUpPage.tsx` | Média | Aberto — sem tarefa; requer decisão de produto |
| PC-29 | **O estado do fluxo OAuth vive em memória do processo — com mais de uma instância, o retorno falha.** Decisão de desenho de `AUTH-002` (A2, 2026-09-22), declarada em `docs/OPERATIONS.md` §3.4.2 e não deixada para descoberta em produção. Os fluxos pendentes ficam num `Map` do próprio processo (`services/oauth.ts`, `pendingFlows`), com TTL de 10 minutos e remoção de uso único. Funciona com uma instância — que é o que hoje existe — mas assim que houver duas atrás de um balanceador, o pedido de início pode cair na instância A e o retorno na instância B, e a instância B responde **400** a um `state` que é legítimo («o pedido de entrada expirou ou já foi usado»). O modo de falha é o pior possível: intermitente, dependente do balanceador, e indistinguível de um ataque de repetição — quem depurar vai procurar segurança onde o problema é topologia. A correção (estado partilhado, ou afinidade de sessão no balanceador) não é desta tarefa e não se resolve com uma linha. **Deteção: A2, 2026-09-22, ao implementar `AUTH-002`.** | `apps/api/src/services/oauth.ts` (`pendingFlows`), `docs/OPERATIONS.md` §3.4.2 | Média | Aberto — sem tarefa; bloqueia a segunda instância da API |
| PC-30 | **A validação de condição de um lembrete nunca dispara para o cliente real.** Medido por A1 em 2026-09-22, durante `TEST-001`: `createReminder` (`services/reminders.ts:79,84`) tem duas guardas que deviam recusar um lembrete sem condição, mas comparam com `=== null` campos que são `.nullish()` no contrato (`contracts.ts:592-595`). Um campo **ausente** chega ao serviço como `undefined`, e `undefined === null` é **falso** — pelo que a guarda só dispara com `null` **explícito**. Medido pela fronteira HTTP: `POST /reminders` com `{vehicleId, title, trigger:'time'}` devolve **201** (criado com `dueDate: null`, `intervalMonths: null`) quando o esperado é 422; o mesmo corpo com `dueDate: null` devolve 422. O lembrete criado fica em `evaluation.state === 'unknown'` **para sempre** — não tem data nem quilometragem, logo nunca dispara — e o utilizador vê um lembrete que promete avisar e não avisa. A guarda de `shared.ts:189` mostra a forma correta (verifica `null` **e** `undefined`). **Deteção: A1, 2026-09-22.** | `apps/api/src/services/reminders.ts:79,84` | Média | **Fechado** por `AUD-014` (2026-09-22) — passou a usar `ausente()`, provado por mutação |
| PC-31 | **`updateReminder` não tem guarda de condição nenhuma — um lembrete válido pode ser editado para um estado do qual nunca dispara.** Achado da mesma sessão de `AUD-014`, **não** corrigido aqui (§1.2: é trabalho novo, com tarefa própria). `createReminder` tem (mesmo avariada) a guarda de condição; `updateReminder` (`services/reminders.ts:217`) escreve os campos que receber sem verificar o resultado: `PATCH /reminders/:id` com `{dueDate: null}` sobre um lembrete por tempo sem intervalo deixa-o exatamente no estado que `AUD-014` passou a recusar na criação. O contrato permite-o — `zReminderUpdateRequest` é `zReminderCreateRequest.partial()` (`contracts.ts:604`), pelo que todos os campos são opcionais e `null` é aceite. Consequência: a correção de `AUD-014` fecha a porta da frente e deixa a de trás aberta, e por isso **as duas têm de ser lidas juntas**. **Deteção: A1, 2026-09-22.** | `apps/api/src/services/reminders.ts:217-236` | Média | **Fechado** por `AUD-015` (2026-09-22) — a edição passa a validar o **estado final** com a mesma `assertCondicao` da criação, **antes** de gravar; provado por mutação (M1: 3 vermelhos; M3: o 422 mantém-se e a asserção «não grava» é a que falha) |
| PC-32 | **Neste ambiente (Git Bash + sandbox) a verificacao local e ordens de grandeza mais lenta, e alguns lancadores penduram.** Medido por A1 em 2026-09-22, durante `OPS-001`: (a) os shims `node_modules/.bin/<bin>` **sem extensao** e o `npx` **penduram sem uma unica linha de saida** — `npx prisma --version`, `./node_modules/.bin/prisma --version` e `npm run db:push` (na 1.ª tentativa, 90 s) devolveram 0 bytes; o mesmo binario invocado por `node node_modules/prisma/build/index.js` funciona (**44 s**); (b) o `curl` pende mesmo com `--max-time 3`, pelo que a sonda de saude teve de passar a usar `fetch` do node; (c) cada arranque de `node` custa **~23 s**; (d) o shim *safe-delete* do sandbox falha com `ETIMEDOUT` (`genie-trash win32-x64.exe`) em cada remocao, o que torna o `prisma generate` do `db:push` a parte mais lenta do passo (**6 m 44 s** contra **43 s** com `--skip-generate`). **Nao e defeito do projeto** — e o harness — mas obriga a que qualquer verificacao local invoque `prisma`/`tsx` por `node` directo e use caminhos em forma Windows (`/c/...` chega ao node como `C:\c\...` → `MODULE_NOT_FOUND`). **Deteccao: A1, 2026-09-22.** | harness local | Baixa | Aberto — informativo |
| PC-33 | **`GET /api` anuncia um endereco de saude que devolve 404.** `app.ts:343` tem `documentation: '/api/v1/health'`, mas a saude vive **fora** do prefixo versionado — `app.use(healthRouter)` (`app.ts:349`), e o comentario de `app.ts:347-348` di-lo por palavras: «um orquestrador nao deve ter de saber que versao da API esta a correr para verificar se o processo responde». Medido por A1 em 2026-09-22: `GET /api/v1/health/live` → **404**; `GET /health` → **200**. O defeito e so de texto (ninguem consome o campo), mas enganou o proprio autor do `ci.yml`, que escreveu a sonda com o endereco errado. **Deteccao: A1, 2026-09-22, ao correr o passo de prontidao.** | `apps/api/src/app.ts:343` | Baixa | Aberto — precisa de tarefa propria |
| PC-34 | **`test/oauth-google.test.ts` falha por `Hook timed out in 60000ms` numa maquina carregada, com os 28 testes `skipped` e zero assercoes falhadas.** Medido por A1 em 2026-09-22: a suite completa pelo classificador deu `exit 1` com `1 ficheiro(s) falharam por algo que nao e ambiente: test/oauth-google.test.ts`; corrido isolado, o ficheiro devolveu `Hook timed out in 60000ms` e `28 skipped (28)` — o hook de preparacao da base excede os 60 s porque neste ambiente cada arranque de processo custa ~23 s (`PC-32`). **Nao e o `EBUSY` de `PC-26`** e **nao** foi tratado como ambiente: o classificador recusou-se a chama-lo verde, que e o comportamento correto. Num runner de CI rapido nao ocorre, mas o limite de 60 s de um hook que cria uma base e uma fragilidade real do harness sob carga. **Deteccao: A1, 2026-09-22.** | `apps/api/test/oauth-google.test.ts` | Baixa | Aberto — informativo. **Não se reproduziu na corrida completa de 2026-09-22 16:10** (medida por A1 em `AUD-010`): `oauth-google.test.ts` → 28 passados, `numPendingTests: 0`, `numFailedTests: 0`. **Não** é fechado — «não se reproduziu uma vez» não é «está resolvido» |
| PC-35 | **Oito de doze mensagens de validação chegam ao cliente em inglês.** `translateMessage` (`apps/api/src/http/handlers.ts:114-125`) é um mapa de **igualdade exata de cadeia** com seis entradas; as mensagens de comprimento e de intervalo do Zod são **parametrizadas**, pelo que só coincidem por acaso (`at least 1 character(s)` está no mapa — é o que faz `title: ''` sair em português; `at least 2` não). Medido por A1 em 2026-09-22, em `TEST-002`: **8 de 12** casos devolvem inglês — `String must contain at least 2 character(s)`, `Number must be greater than or equal to 1886`, `Number must be less than or equal to 3000000`, entre outros. A §59 exige mensagens em português prontas a apresentar, e «String must contain at least 2 character(s)» não é uma instrução. **Deteção: A1, 2026-09-22, durante `TEST-002`.** | `apps/api/src/http/handlers.ts:114-125`, `packages/shared/src/contracts.ts` | Média | Aberto — precisa de tarefa própria e de **decisão** (dicionário por código de issue do Zod vs. mensagens próprias em cada campo dos esquemas; toca `handlers.ts` e possivelmente o contrato — §6) |
| PC-36 | **Dois dos três envelopes de lista divergem de `Page<T>` — e nenhum está no contrato.** `Page<T>` (`packages/shared/src/types.ts:55`) declara `nextCursor` **obrigatório** e o docblock de `contracts.ts` diz que as listas são «paginadas por cursor». Medido por A1 em 2026-09-22: `GET /records/expenses` → `{items, nextCursor, total}` (cumpre); `GET /vehicles` → `{items, total}` (`routes/vehicles.ts:88`); `GET /reminders` → `{counts, items, total}` (`routes/reminders.ts:85`). O que **não** é defensável é **onde** estão declarados: **não estão em `packages/shared`** — estão escritos à mão **no cliente web** (`apps/web/src/api/queryKeys.ts:162,167,172`, com um comentário que explica a decisão) — e o contrato gerado para o mobile só tem `Page<T>`, com `nextCursor` `required` (`apps/mobile/lib/contract/generated/contract_models.dart:148,151`). Consequência: a afirmação da §6 de que o contrato é «a única definição» **não vale para os envelopes de lista**; a API e a web têm duas cópias que nada verifica, e o mobile tem uma terceira que discorda. **Deteção: A1, 2026-09-22, durante `TEST-002`.** | `apps/api/src/http/routes/vehicles.ts:88`, `apps/api/src/http/routes/reminders.ts:85`, `apps/web/src/api/queryKeys.ts:162-184`, `packages/shared/src/types.ts:55` | Média | Aberto — é alteração ao **contrato partilhado** (§6): exige tarefa e decisão **antes** de implementar, com impacto API/Web/Mobile declarado. Três desfechos possíveis, nenhum de teste: (a) declarar os envelopes reais em `types.ts`; (b) fazer a API cumprir `Page<T>`; (c) aceitar a divergência e documentá-la |
| PC-37 | **14 de 65 tarefas da §5 não têm corpo.** Medido por A1 em 2026-09-22 (`awk` sobre `## 5.`→`## 6.`), na sequência do diagnóstico de `OPS-002`: A1 — `OPS-002`, `OPS-003` (P2/P3, `BACKLOG`); A2 — `AUTH-004`, `AUTH-005`, `AUTH-006` (P2, `BACKLOG`); A3 — `WEB-007`, `WEB-008`, `MOB-003`, `MOB-004`, `MOB-005` (P2/P3, `BACKLOG`/`BLOCKED`); A4 — `PROD-005`, `INT-002`, `INT-003`, `INT-004` (P4, `DEFERRED`). A §1.2 exige descrição/objetivo/dependências/critérios/testes mas **não distinguia** por estado — o que deixava 21,5% da §5 num limbo: não era claro se são tarefas ou marcadores. **Política adotada (A9, 2026-09-22):** esses campos são obrigatórios **antes de a tarefa ser pegada** (`READY`/`IN_PROGRESS`), não desde a criação — ver a nota acrescentada à §1.2. Consequência: **12 das 14** (todas em `BACKLOG`/`BLOCKED`/`DEFERRED`) são legítimas como estão e **não foram alteradas**; as **2** de prioridade ativa (`OPS-002`, `OPS-003`) passaram a `BLOCKED` com o que lhes falta escrito. **Nenhum corpo foi inventado.** **Deteção: A1, 2026-09-22, durante `OPS-002`.** | `docs/ROADMAP.md` §5, §1.2 | Média | **Política decidida** (A9, 2026-09-22) — §1.2 clarificada; as 12 tarefas ficam como estão; ver `OPS-002`/`OPS-003` |
| PC-38 | **Este ambiente não tem motor de contentores.** Medido por A1 em 2026-09-22, durante `OPS-002`: `docker --version` → `command not found` (exit **127**); `docker info` idem; `/c/Program Files/Docker`, `/c/ProgramData/DockerDesktop` e `…/AppData/Local/Docker` **não existem**; `podman`/`nerdctl` ausentes do `PATH`; `wsl --list --quiet` **bloqueado por política de segurança**. **Formulação factual:** o ambiente atual não dispõe de motor de contentores; **qualquer tarefa cuja validação dependa de construir ou correr um contentor não pode ser provada localmente aqui**. É uma **limitação de validação/dependência**, não uma impossibilidade permanente do projeto — o projeto pode vir a usar contentores; o que não pode é **afirmar que os validou** neste ambiente. É a mesma limitação que o `OPS-006` já tinha encontrado por outra via (falta de PostgreSQL), agora medida explicitamente para contentores. **Deteção: A1, 2026-09-22, durante `OPS-002`.** | harness local | Média | Aberto — informativo. Bloqueia a **prova** de `OPS-002`; ver `OPS-002` e `OPS-006` |
| PC-39 | **A edição de um registo de manutenção grava `null` sobre a condição do lembrete ligado.** `apps/api/src/services/records-compliance.ts:286-298`, em `updateMaintenance`: `reminderData.dueDate = updated.nextDueDate` e `reminderData.dueOdometerKm = updated.nextDueOdometerKm` são **incondicionais** — escrevem `null` sobre o alvo do lembrete sempre que o registo de manutenção não tenha esse alvo. Um `PATCH /maintenance/:id` que deixe o registo sem `nextDueDate` (ou um registo que só tenha data e cujo lembrete só tenha quilometragem) deixa o lembrete ligado no **mesmo estado** que o `PC-31`, por um caminho que **não** passa por `updateReminder` e que, por isso, a correção de `AUD-015` não cobre. **Estado: por leitura, não medido** — a confirmação (um teste de rota que morda) pertence à tarefa própria. **Deteção: A1, 2026-09-22, durante `AUD-015`** (corroborado por A1 em `TEST-002`). | `apps/api/src/services/records-compliance.ts:286-298` | Média | Aberto — precisa de tarefa própria (não medida; a medição é o primeiro passo) |
| PC-40 | **O formulário de lembretes da web produz pedidos que a API passou a recusar.** `apps/web/src/pages/records/RemindersPage.tsx`: o `trigger` por omissão é `'both'` (`:67`), a data vem pré-preenchida com `today()` (`:68`) e o `intervalKm` é enviado **sempre que preenchido**, sem exigir uma quilometragem alvo (`:94-95`); o campo «Quilometragem limite» mostra `Sem leitura registada.` sem impedir o envio (`:207-215`). Medido contra o código atual (por A1, 2026-09-22): o pedido que o formulário produz por omissão devolve **422** — «Um lembrete por quilometragem precisa de uma quilometragem alvo…». Parte do caso é **anterior** ao `AUD-015` (a guarda antiga tinha a mesma condição); o que é novo é o caminho estreito em que o utilizador preenche `intervalKm` num veículo **sem** quilometragem registada — antes devolvia 201 com um lembrete morto, agora devolve 422. O cliente devia **prevenir** em vez de deixar falhar. **Deteção: A1, 2026-09-22, durante `AUD-015`** (por leitura do formulário + medição do lado do servidor; **o formulário não foi corrido num browser**). | `apps/web/src/pages/records/RemindersPage.tsx:67-97,207-215` | Baixa | Aberto — frente da web (A3); precisa de tarefa própria |
| PC-41 | **O comentário de `App.tsx:38` diz «trinta rotas» e são trinta e uma.** `apps/web/src/App.tsx:38` — «com **trinta rotas**, uma tabela de configuração esconde mais do que mostra». É o mesmo defeito de `AUD-010` num sítio que `AUD-010` não cobre (um comentário de código, não o `README`), e num ficheiro que não é da frente de A1. Medido por A1 em 2026-09-22, ao fechar `AUD-010` — a contagem correta é **31**: 33 atributos `path="…"` menos os **dois** apanha-tudo. **Não tocado.** **Deteção: A1, 2026-09-22, durante `AUD-010`.** | `apps/web/src/App.tsx:38` | Baixa | Aberto — frente da web (A3), ou tarefa própria de âmbito documental |
| PC-42 | **O contrato não fecha 19 conjuntos que julga fechar.** `registry.ts` declara 19 aliases `CodeOf<typeof X>`; **os 19 resolvem para `string`**, não para uniões de literais (medido pela API do compilador TypeScript, contagem reproduzível por `apps/mobile/contract/generate.mjs`). **Causa:** `freeze<T extends readonly OptionMeta[]>(items: T): T` (`registry.ts:31`) com `OptionMeta.code: string` (`:16-28`) — os códigos literais alargam. **Consequência:** o contrato só fecha estes conjuntos em tempo de execução, pelos esquemas Zod; em TypeScript, `vehicleType: 'banana'` compila. `MOB-001` mediu-o e escreveu-o no manifesto gerado (`knownWeaknesses`), recusando-se a «melhorar» o contrato no gerador. **Correção possível:** `const` type parameter em `freeze`, com impacto por medir em API (Prisma devolve `string`), Web e Mobile. **Deteção: A3, 2026-09-22, durante `MOB-001`.** | `packages/shared/src/registry.ts:16-34,912-930` | Média | Aberto — tarefa proposta (A3 propôs `PC-32`, já ocupado por `OPS-001`; A9 atribui **`PC-42`**). |
| PC-43 | **O inventário da §3 está desatualizado face ao código depois de `AUTH-002` e `MOB-001`.** §3.3 continua a listar «Login Google» como «especificado mas não implementado» — «**Não há rota nem serviço**» — quando `apps/api/src/services/oauth.ts`, as rotas `GET /auth/google/start` e `GET /auth/google/callback` e a migration `20260922120000_federated_identity_unique` existem no *working tree* desde 2026-09-22 (`AUTH-002`, A2). §3.1 continua a dizer «36 ficheiros / 1504 testes (API)» e «4 / 88 (web)» — os valores **medidos** mais recentes pelos agentes são **45 ficheiros / 1725 testes** (A1, `TEST-002`) e **7 / 134** (A3, `WEB-006`/`MOB-001`) — e «30 decisões», quando `DECISIONS.md` já vai em **`A31`** (com `A32` proposta). **Não corrigido nesta consolidação de propósito:** a §3 é o inventário *medido* e atualizá-la exige uma medição nova, não uma inferência. **Deteção: A9, 2026-09-22, na segunda consolidação.** | §3.1, §3.3, `docs/DECISIONS.md` | Média | Aberto — inventário desatualizado; requer medição nova (A4/A9) |
| PC-46 | **A enumeração do `PC-24` estava incompleta — e o pior par do produto não constava.** O `PC-24` listava **6** pares abaixo do limiar e afirmava que no tema escuro havia «só uma falha». Medido por A3 na correção de `WEB-011`, havia **seis** no escuro: `.z-banner--info` (`--z-petrol-800` sobre `--z-info-soft`) = **1,18:1** — o pior par do produto, alcançável em **6 sítios**; `＋` e `.z-tabbar__badge` (`#fff` sobre `--z-highlight`) = **1,88:1**; `.z-toast--ok` = **2,35:1**; `.z-toast--danger` = **2,47:1**; `.z-chip--accent` = **3,81:1** (este constava). No claro faltavam ainda `.z-toast--ok` = **4,33:1**, `.z-field__required` = **3,60:1** e `.z-btn--highlight:hover` = **3,60:1**. **Todos corrigidos** em `WEB-011`. A causa **não** é distração, é o método: um inventário escrito à mão a partir de leitura de código fica incompleto **por construção** — e o `PC-24` é a prova, porque foi escrito com cuidado e mesmo assim faltava o pior caso. A recomendação é que os inventários de contraste deixem de ser mantidos à mão e passem a ser **gerados** pelo teste automático de `WEB-011`. **Deteção: A3, 2026-09-22, durante `WEB-011`.** | `apps/web/src/styles/app.css`, `apps/web/src/styles/theme.css`, `apps/web/src/app/AppShell.tsx` | Média | Resolvido no código — falta só a decisão de processo |
| PC-47 | **Continuam cores fora do `BRAND` em `app.css`, e a asserção de `WEB-011` só cobre o canal `color:`.** A regra do topo do `theme.css` («qualquer cor nova tem de vir do `BRAND`») **não** está cumprida em absoluto. Medido: `app.css:2115 border-color: #1d4a52` (borda tracejada de `.z-datagap`, tema escuro) — cor **inventada**, que não é nenhum tom da escala (petróleo-800 = `#0b4046`, petróleo-700 = `#0e545a`), e mede **1,38:1** sobre `--z-bg-soft`; o par **claro** da mesma borda (`--z-petrol-200` sobre `--z-bg-soft`) mede **1,46:1** — ou seja, a borda falha 3:1 **nos dois temas**; `app.css:2030 #0c2b30` (gradiente decorativo, 1,11:1); `app.css:1940 rgba(255,255,255,0.14)` (véu translúcido). **Não corrigido em `WEB-011`:** a borda é declaradamente **decorativa** (`app.css:2100`: «as lacunas de dados são um convite, não um erro»), a informação é carregada pelo texto, e escolher o tom exige **decisão de desenho**, não a alteração mínima e segura que o pedido autorizava. **Limitação declarada do teste de `WEB-011`:** a asserção `app.css não tem nenhuma cor literal em color:` está ancorada em `^color:` e **não** apanha `border-color:` nem `background:` — prova que a correção de contraste foi feita nos tokens, **não** que o `app.css` está livre de cores fora do `BRAND`. **Deteção: A3, 2026-09-22, ao declarar as limitações de `WEB-011`.** | `apps/web/src/styles/app.css:1940,2030,2115`; `apps/web/test/contraste-tokens.test.ts` | Baixa | Aberto — decisão de desenho (de que tom é cópia o `#1d4a52`) |
| PC-44 | **O mesmo defeito de `PC-17` num segundo sítio: o cabeçalho de mês da linha temporal.** `monthName()` (`apps/web/src/components/records.tsx:361`) faz `dateLong(\`${month}-01\`).replace(/^1 de /, '').replace(/^1 /, '')` — a expressão gémea de `CalendarGrid.tsx:97`, com a mesma premissa errada no comentário («1 de setembro de 2026»). Alimenta `groupByMonth` (`:342`, `:348`), que é **exportada** e consumida em `TimelinePage.tsx:61` e `VehicleDetailPage.tsx:846`. **Medido** (sonda temporária, removida depois): `groupByMonth` produz `2026-09 -> "01/09/2026"` e `2026-10 -> "01/10/2026"`, onde se quer `setembro de 2026` / `outubro de 2026`; `monthLong('2026-09-01')` → `setembro de 2026`. A correção é a mesma, mas o âmbito é **outro ecrã** (linha temporal, com dois consumidores) — não foi feita dentro de `WEB-010` (§1.2). **Deteção: A3, 2026-09-22, durante `WEB-010`; re-medido em 2026-09-23.** | `apps/web/src/components/records.tsx:342,348,361`; `apps/web/src/pages/TimelinePage.tsx:61`; `apps/web/src/pages/vehicles/VehicleDetailPage.tsx:846` | Baixa | Aberto — sem tarefa; candidata a `WEB-*` nova |
| PC-45 | **O `minWidth: '9ch'` do título do calendário é mais pequeno do que o rótulo que `WEB-010` introduziu.** `CalendarGrid.tsx:115` fixa `minWidth: '9ch'` no `span` do título. Medido para os 12 meses de 2026: **antes** (`dateLong`) o comprimento era **constante**, `[10]`; **depois** (`monthLong`) varia em `[12, 13, 14, 15, 16, 17]` (`maio de 2026` = 12, `fevereiro de 2026` = 17). Os 12 meses excedem `9ch` — e já o excediam antes, porque `01/09/2026` tem 10 caracteres, ou seja o `minWidth` **já era inerte**. Consequência: a largura do título deixou de ser constante e os botões `‹`/`›` deslocam-se até 5 caracteres ao navegar entre meses. É **consistência visual no ecrã de `WEB-008`**, que o ROADMAP manda não tocar sem coordenar; **A9 pode preferir dobrar isto dentro de `WEB-008`** em vez de abrir tarefa nova. **Deteção: A3, 2026-09-22; re-medido em 2026-09-23.** | `apps/web/src/components/CalendarGrid.tsx:115` | Baixa | Aberto — coordenar com `WEB-008` |
| PC-48 | **O docblock do `dateRange` documenta uma saída que o `pt-PT` não produz.** `apps/web/src/lib/format.ts:237` diz `/** Intervalo \`1 set 2026 — 30 set 2026\`, encurtado quando partilham o mês ou o ano. */`, mas a saída real é `01/09 — 30/09/2026` (medida pelos testes de `WEB-010`: `dateRange('2026-09-01','2026-09-30')` → `01/09 — 30/09/2026`, `dateRange('2026-09-01','2026-10-31')` → `01/09 — 31/10/2026`, `dateRange('2026-09-01','2027-03-31')` → `01/09/2026 — 31/03/2027`). É a **mesma família** do docblock do `dateLong` que `WEB-010` corrigiu (`16 set 2026`): um comentário que descreve uma saída que o CLDR do `pt-PT` não produz, e que é uma armadilha para quem o reutilizar. **Não corrigido:** não é premissa deste defeito (o do `dateLong` era — foi o comentário errado que levou ao `replace` errado), e um defeito novo fora do âmbito documenta-se em vez de se corrigir em silêncio. **Deteção: A3, 2026-09-23, ao escrever os testes dos restantes formatadores.** | `apps/web/src/lib/format.ts:237` | Baixa | Aberto — comentário falso, sem impacto de comportamento |
| PC-49 | **Um erro de BD ao criar uma notificação é engolido como «duplicado».** O `catch` de `syncNotificationsForUser` (`apps/api/src/services/notifications.ts:203-207`) **não usa o `error`**: registra sempre `logger.debug('Notificação duplicada ignorada', …)`, qualquer que seja a exceção. A intenção é legítima e está escrita no comentário — a corrida entre dois pedidos é recusada pela chave única e não é erro para o utilizador —, mas a implementação **não estreita para `P2002`**, pelo que uma avaria real de BD (ligação perdida, restrição violada, coluna em falta) fica **indistinguível de «não havia nada a fazer»**. Com o agendador isto ficou **pior do que antes**: passou a correr sozinho, sem ninguém a olhar para o dashboard. O teste que fixa o defeito **já existe** (`apps/api/test/jobs-notification-sync.test.ts`, com o nome do defeito). **Deteção: A4, 2026-09-23, durante `PROD-004`.** | `apps/api/src/services/notifications.ts:203-207` | Média | Aberto — sem tarefa; exige estreitar o `catch` para `P2002` e um teste que distinga avaria de duplicado |
| PC-50 | **`windowDays`/`windowKm` são inertes em `listReminders`.** O contrato declara uma janela (`packages/shared/src/contracts.ts:619-620`: `windowDays` default **180**, `windowKm` default **5000**) e o serviço **nunca a aplica**: `listReminders` (`apps/api/src/services/reminders.ts:153-172`) só limita por `take: 500`. O contrato promete uma janela que o serviço não cumpre — a **mesma forma** de `AUD-014`, um campo aceite que não produz o efeito prometido. **Estado: por leitura do serviço, não medido** — a confirmação (um teste que morda) pertence à tarefa própria. **Deteção: A4, 2026-09-23, durante `PROD-004`.** | `apps/api/src/services/reminders.ts:153-172`; `packages/shared/src/contracts.ts:619-620` | Baixa | Aberto — sem tarefa; a medição é o primeiro passo |
| PC-51 | **Eliminar a conta deixa os bytes dos documentos órfãos.** `deleteAccount` (**`apps/api/src/services/auth.ts:1332-1365`**) apaga o utilizador por **cascata do esquema** (`prisma.user.delete`, `:1363`, com o comentário a dizê-lo: «As relações em cascata no schema tratam dos veículos e de tudo o que deles depende») e **não passa por `discardDocumentBytes`** — pelo que todos os ficheiros dos documentos dessa conta ficam no armazenamento para sempre. É o **mesmo defeito de `PC-13`**, por um caminho que `PROD-007` não fecha: é o único caminho de eliminação em massa conhecido que contorna a contagem de referências. **Medido por leitura** (o `grep` de `discardDocumentBytes` em `apps/api/src/` devolve os chamadores de `PROD-007` e `PROD-008`, nenhum em `auth.ts`); a confirmação por teste pertence à tarefa própria. **Deteção: A4, 2026-09-22, durante `PROD-007`; re-verificado por A9 em 2026-09-23.** | `apps/api/src/services/auth.ts:1332-1365` (`:1363`) | Média | Aberto — sem tarefa; é o caminho de eliminação em massa por fechar |



---

## 3. Inventário do estado real

Levantado por leitura de `README.md`, `docs/`, e verificação direta no código. As seis  
categorias são deliberadamente distintas — **não transformar código preparado em  
funcionalidade obrigatória**.

### 3.1 Já implementado e sólido

| Área                  | Evidência                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| API REST              | 11 ficheiros de rotas; Node 22 · Express · TypeScript                                                                       |
| Modelo de dados       | 29 modelos em `schema.prisma`, PostgreSQL canónico + SQLite derivado                                                        |
| Autenticação          | Email/password, JWT + refresh com rotação, 2FA TOTP com 10 códigos de recuperação, sessões revogáveis, confirmação de email |
| App web               | React · Vite · mobile-first; 32 `<Route>`                                                                                   |
| Domínio               | `domain/` puro e testado: consumos, totais, comparação de períodos, lembretes, timeline, TCO                                |
| Importação/Exportação | Duas camadas, ciclo ZIP nativo fechado, idempotência provada                                                                |
| Segurança             | Helmet, rate limiting por rota, `no-store`, `trust proxy`, segredos recusados em produção                                   |
| Observabilidade       | Logs JSON com `requestId`, redação de segredos, `/health` 503, `AuditLog`                                                   |
| Testes                | 36 ficheiros / 1504 testes (API), medido em 2026-09-22; 4 / 88 (web)                                                        |
| Documentação          | API, arquitetura, 30 decisões, operações, marca, import/export                                                              |


### 3.2 Parcialmente implementado

| Área                    | O que existe                                                                                          | O que falta                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Recuperação de password | Endpoints, tokens de uso único, expiração 60 min, revogação de sessões **e os ecrãs**: `ForgotPasswordPage.tsx` e `ResetPasswordPage.tsx` encaminhados em `/recuperar-password` e `/repor-password` (`App.tsx:57-64`, desde `1eac3a7`) | Nada — entrega real **provada** contra um servidor SMTP local (`password-reset-integration.test.ts`); ver `AUTH-001` |
| Documentos              | Metadados completos (criar/listar/ver/editar/eliminar), `LocalDocumentStorage` implementado e testado, **download dos bytes implementado** (`GET /documents/:id/content`, `services/documents.ts:299`) e **documentado** (`docs/API.md:189`) | **Upload** de ficheiro — o único lado em falta. `POST /documents` "não aceita ficheiros" (`docs/API.md:187`) e a `storageKey` ainda se escreve à mão (`contracts.ts:577`) |
| Notificações            | Materializadas, visíveis na aplicação                                                                 | **Agendador** — nada dispara sozinho                                                 |
| Timeline                | Construída a partir do modelo de eventos, com fallback para registos sem evento                       | Links para `inspections`/`taxes`/`insurance`/`odometer` caem no ecrã de **despesas** |
| Home Assistant          | Especificação de entidades calculada em tempo real, com `requires` e `available`                      | **Publicação MQTT**                                                                  |
| Email                   | `EmailSender`, `ConsoleEmailSender`, `smtp.ts` **e a ligação**: `registerEmailSender()` (`email.ts:181`) é chamada no arranque (`app.ts:438`) e escolhe `SmtpEmailSender` quando há `SMTP_HOST`; em produção recusa arrancar sem entrega | Nada — ligação, escolha do transporte e recusa em produção **provadas** (ver `AUTH-001`) |

### 3.3 Especificado mas não implementado

| Área                                       | Onde está especificado                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Login Google                               | `GOOGLE_CLIENT_ID`/`_SECRET` documentados; `config.federatedLogin.google` existe e reporta estado. **Não há rota nem serviço** |
| App mobile Flutter                         | README §Estado; §3.6; §34 (mesma API)                                                                                          |
| Publicação MQTT / HA                       | `HA_MQTT_URL`; especificação das entidades pronta                                                                              |
| Integrações de fabricantes, OBD, wallboxes | README §Estado ("modelo e especificação prontos, sem ligação")                                                                 |

### 3.4 Preparado arquiteturalmente (sem funcionalidade)

| Área                  | O que existe                                  | Nota honesta                                                                      |
| --------------------- | --------------------------------------------- | --------------------------------------------------------------------------------- |
| Famílias (§32)        | Modelos `Household`, `HouseholdMember`        | **Zero** referências em `apps/api/src/`. A18 di-lo: "Nada disto é exposto na API" |
| Frotas (§32)          | Modelos `Organization`, `OrganizationMember`  | Idem                                                                              |
| Migração de bundles   | `migrate.ts` (440 linhas), `MIGRATIONS` vazio | Inalcançável com a versão atual de formato                                        |
| `AppSetting`          | Modelo                                        | Sem qualquer leitura/escrita                                                      |
| `HomeAssistantEntity` | Modelo                                        | A especificação é calculada em tempo real, nunca persistida                       |

> O README agrupa isto como *"modelo **e especificação** prontos, sem ligação"*. O **modelo**  
> está pronto; para famílias/frotas a **especificação não existe como documento**. É uma  
> generosidade de linguagem, não um defeito — mas não deve ser lida como "meio caminho andado".

### 3.5 Futuro explicitamente adiado

Famílias, frotas, integrações de fabricante, OBD, wallboxes, telemetria, app mobile.  
`DECISIONS.md` A18 declara famílias/frotas não expostas, e está correto.

### 3.6 Não especificado

Telemetria em tempo real (só referida como ponto de extensão em `ARCHITECTURE.md` §8), 2FA  
por hardware, faturação/pagamentos, multi-idioma, partilha de veículo entre contas. Nada  
disto tem desenho — se algum for pedido, **criar tarefa e decidir antes de implementar**.

### 3.7 Verificação por domínio (A4 · `PROD-003`)

Levantado **por leitura direta do código** e confirmado por execução, não por documentação.
Substitui, para os domínios abaixo, o "provavelmente completo" de §3.1–§3.2 por estado
verificado. Contagens de handlers são do número de `Router.<verbo>(` por ficheiro.

| Domínio                | Estado           | Evidência (ficheiro:linha)                                                                                                     | Tarefa associada                                                        |
| ---------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| vehicles               | Implementado     | `http/routes/vehicles.ts:82-163` — 8 handlers (CRUD + odómetro ×3); `services/vehicles.ts`                                      | Cobertura: `test/vehicles-http.test.ts` (22) |
| fuel (abastecimentos)  | Implementado     | `http/routes/financial.ts:155-192` — 5; `services/records-financial.ts`; `domain/calculations.ts` (`averageFuelConsumption`)     | Cobertura nova: `test/fuel-consumption-http.test.ts`; `AUD-012` (PC-1)  |
| charging (carregamentos)| Implementado, com defeito conhecido | `http/routes/financial.ts:204-241` — 5                                                       | `AUD-005` **DONE**; coberto por `test/financial-http.test.ts` |
| expenses (despesas)    | Implementado     | `http/routes/financial.ts:106-143` — 5                                                                                          | Cobertura: `test/financial-http.test.ts` (despesas) |
| maintenance            | Implementado     | `http/routes/compliance.ts:109-146` — 5                                                                                         | Cobertura: `test/compliance-http.test.ts` (manutenção) |
| insurance              | Implementado     | `http/routes/compliance.ts:158-195` — 5                                                                                         | Cobertura: `test/compliance-http.test.ts` (seguro) |
| inspections            | Implementado     | `http/routes/compliance.ts:207-244` — 5                                                                                         | Cobertura: `test/compliance-http.test.ts` (inspeção) |
| taxes                  | Implementado     | `http/routes/compliance.ts:256-293` — 5                                                                                         | Cobertura: `test/compliance-http.test.ts` (imposto) |
| documents              | **Implementado** | CRUD + upload (`POST /documents/:id/content`, `routes/documents.ts`) + download (`GET` do mesmo caminho); `services/documents.ts` (`uploadDocumentContent`, `downloadDocument`); `docs/API.md`; **102 testes verdes** na suíte de documentos (69 HTTP + 33 storage) | Higiene de armazenamento → `PROD-007`; substituição → `PROD-008`; `storageKey` no contrato → `PC-21` |
| reminders              | Implementado     | `http/routes/reminders.ts:79-142` — 7; `services/reminders.ts`; `domain/reminders.ts`                                           | Cobertura: `test/reminders-http.test.ts` (47); disparo automático → `PROD-004` |
| statistics             | Implementado     | `http/routes/insights.ts:188` (`GET /stats`); `services/analytics.ts`                                                           | —                                                                       |
| timeline               | **Parcial**      | `http/routes/insights.ts:234` (`GET /timeline`); `domain/timeline.ts`; `services/timeline.ts`                                    | `AUD-002` **DONE**; coberto por `test/timeline.test.ts` (30) |
| import/export          | Implementado     | `http/routes/import.ts` — 4; `exportRouter` em `integrations.ts:548,619`; `services/export-bundle.ts`; `domain/import/*`         | Cobertura já é a mais densa (20 de 34 ficheiros de teste)               |
| costs/TCO              | Implementado     | `domain/analysis.ts:402-469` (`totalCostOfOwnershipCents`); exposto em `services/analytics.ts:423`                              | —                                                                       |
| integrations           | **Parcial**      | `http/routes/integrations.ts:85-245` — CRUD + `GET /integrations/home-assistant/spec`; especificação calculada em tempo real     | **Publicação MQTT ausente** → `INT-001`                                 |

**Leitura honesta (atualizada após `PROD-001`):** **13 dos 15 domínios** estão implementados e
funcionais — o upload de documentos fechou a terceira lacuna. As lacunas reais que restam são a
**publicação MQTT** (`INT-001`), a **higiene de armazenamento** (`PROD-007` + substituição,
`PROD-008`). O que falta nos restantes não é código de produto — é **cobertura de testes de rota**
(`TEST-001`) e o **agendador** (`PROD-004`).

---


## 4. Tabela geral

Vista única. O detalhe está em §5. `—` em Dependências significa "nenhuma".

| ID       | Área         | Tarefa                                                                 | Agente | Prioridade | Estado     | Dependências            |
| -------- | ------------ | ---------------------------------------------------------------------- | ------ | ---------- | ---------- | ----------------------- |
| AUD-001  | Auditoria    | `averageFuelConsumption` ignorava parciais (🔴-1)                      | A1     | P0         | `DONE`     | —                       |
| AUD-002  | Auditoria    | Timeline: links para rotas que a web não serve (🔴-2)                  | A1     | P0         | `DONE`     | —                       |
| AUD-003  | Auditoria    | Export: odómetros (🔴-3)                                               | A1     | P0         | `BACKLOG`  | diagnóstico a recuperar |
| AUD-004  | Auditoria    | Teste do `ConsoleEmailSender` é falso verde (🔴-4)                     | A1     | P0         | `DONE` | —                       |
| AUD-005  | Auditoria    | `PATCH /records/charging` não recalcula derivadas (🔴-5)               | A1     | P0         | `DONE` | —                       |
| AUD-006  | Auditoria    | Timeline: omissão de itens (🔴-6)                                      | A1     | P0         | `BACKLOG`  | diagnóstico a recuperar |
| AUD-007  | Auditoria    | Achados 🟠 da auditoria funcional                                      | A1     | P1         | `BACKLOG`  | importar do relatório   |
| AUD-008  | Auditoria    | `/records/:kind` degrada em silêncio para despesas                     | A1     | P1         | `DONE` | —                       |
| AUD-009  | Auditoria    | Sincronizar A17 + `OPERATIONS` §9 + texto de documentos                | A1     | P1         | `DONE`     | —                       |
| AUD-010  | Auditoria    | Números do README desatualizados                                       | A1     | P2         | `DONE`     | —                       |
| AUD-011  | Auditoria    | Decidir o destino do motor de migração                                 | A1     | P2         | `BACKLOG`  | decisão de produto      |
| AUD-012  | Auditoria    | Checks de consumo do `verify.ts` são insensíveis (PC-1)                | A1     | P2         | `DONE`     | —                       |
| AUD-013  | Auditoria    | Dicas de dados em falta: 4 de 7 links abrem o separador errado    | A1     | P1         | `BACKLOG`  | decisão de produto      |
| AUD-014  | Auditoria    | Lembrete sem condição é aceite e nunca dispara (PC-30)  | A1     | P1         | `DONE`    | —                       |
| AUD-015  | Auditoria    | `PATCH /reminders/:id` aceita um estado sem condição (PC-31) | A1     | P2         | `DONE`    | AUD-014                 |
| AUTH-001 | Identidade   | Transporte de email real + `setEmailSender`                            | A2     | P0         | `DONE`     | —                       |
| AUTH-002 | Identidade   | Login Google (OAuth)                                                   | A2     | P1         | `DONE`     | AUTH-001                |
| AUTH-003 | Identidade   | Associação de conta Google a conta existente                           | A2     | P1         | `BACKLOG`  | `AUTH-002` (satisfeita) |
| AUTH-004 | Identidade   | Gestão de sessões na conta                                             | A2     | P2         | `BACKLOG`  | —                       |
| AUTH-005 | Identidade   | Revisão do 2FA e dos códigos de recuperação                            | A2     | P2         | `BACKLOG`  | —                       |
| AUTH-006 | Identidade   | Perfil e preferências de conta                                         | A2     | P2         | `BACKLOG`  | —                       |
| AUTH-007 | Identidade   | Alteração de email com reverificação                                   | A2     | P3         | `BACKLOG`  | AUTH-001                |
| AUTH-008 | Identidade   | Cobrir a recusa de arranque em produção sem entrega (PC-14)            | A2     | P2         | `DONE`     | —                       |
| AUTH-009 | Identidade   | Documentação da entrega de email (PC-19)                               | A2     | P3         | `DONE`     | —                       |
| WEB-001  | Web          | Ecrã "Esqueci-me da password"                                          | A3     | P0         | `DONE`     | AUTH-001                |
| WEB-002  | Web          | Ecrã de reposição de password                                          | A3     | P0         | `DONE`     | WEB-001                 |
| WEB-003  | Web          | Documentos: editar metadados + descarregar                             | A3     | P0         | `DONE`     | PROD-001, PROD-002      |
| WEB-004  | Web          | Corrigir `/records/:kind` na interface                                 | A3     | P1         | `DONE`  | — |
| WEB-005  | Web          | Auditoria de estados (vazio/loading/erro)                              | A3     | P2         | `DONE`     | —                       |
| WEB-006  | Web          | Acessibilidade                                                         | A3     | P2         | `DONE`        | —                    |
| WEB-007  | Web          | Pesquisa e filtros                                                     | A3     | P2         | `BACKLOG`  | —                       |
| WEB-008  | Web          | Consistência visual e design system                                    | A3     | P3         | `BACKLOG`  | —                       |
| WEB-009  | Web          | `DocumentsPage`: campo «Validade» duplicado                            | A3     | P2         | `DONE`     | —                       |
| WEB-010  | Web          | Cabeçalho do calendário mostra data em vez do mês                      | A3     | P3         | `DONE`     | —                       |
| WEB-011  | Web          | Contraste abaixo de WCAG AA (medido)                                   | A3     | P2         | `DONE`     | `WEB-008`               |
| WEB-012  | Web          | Anunciar a mudança de página (título + foco)                           | A3     | P2         | `READY`    | decisão de política |
| WEB-013  | Web          | O cliente web nunca guarda o token de renovação                        | A3     | P1         | `DONE`     | —                       |
| MOB-001  | Mobile       | Arquitetura Flutter + cliente do contrato partilhado                   | A3     | P1         | `DONE`     | —                       |
| MOB-002  | Mobile       | Autenticação no mobile                                                 | A3     | P1         | `BLOCKED`  | MOB-001, AUTH-001       |
| MOB-003  | Mobile       | Onboarding e criação de veículo                                        | A3     | P2         | `BLOCKED`  | MOB-002                 |
| MOB-004  | Mobile       | Registos (abastecimento, carregamento, despesa)                        | A3     | P2         | `BLOCKED`  | MOB-002                 |
| MOB-005  | Mobile       | Dashboard                                                              | A3     | P2         | `BLOCKED`  | MOB-002                 |
| MOB-006  | Mobile       | Notificações no mobile                                                 | A3     | P3         | `BLOCKED`  | MOB-002                 |
| MOB-007  | Mobile       | Validar o ambiente Flutter (`pub get`/`analyze`/`test`)                | A3     | P1         | `READY`    | —                       |
| PROD-001 | Produto      | Documentos: upload de ficheiro                                         | A4     | P0         | `DONE`     | —                       |
| PROD-002 | Produto      | Documentos: download dos bytes                                         | A4     | P0         | `DONE`     | —                       |
| PROD-003 | Produto      | Revisão de completude por domínio                                      | A4     | P1         | `REVIEW`   | —                       |
| PROD-004 | Produto      | Agendador de notificações                                              | A4     | P2         | `DONE`     | —                       |
| PROD-005 | Produto      | Famílias (Household)                                                   | A4     | P4         | `DEFERRED` | decisão de produto      |
| PROD-006 | Produto      | Frotas (Organization)                                                  | A4     | P4         | `DEFERRED` | decisão de produto      |
| PROD-007 | Produto      | Documentos: remover os bytes ao eliminar (PC-13)                       | A4     | P2         | `DONE`     | —                       |
| PROD-008 | Produto      | Documentos: substituir o ficheiro                                      | A4     | P2         | `DONE`     | `PROD-007`              |
| INT-001  | Integrações  | Publicação MQTT das entidades HA                                       | A4     | P2         | `DONE`     | —                       |
| INT-002  | Integrações  | Integrações de fabricantes                                             | A4     | P4         | `DEFERRED` | decisão de produto      |
| INT-003  | Integrações  | OBD                                                                    | A4     | P4         | `DEFERRED` | decisão de produto      |
| INT-004  | Integrações  | Wallboxes                                                              | A4     | P4         | `DEFERRED` | decisão de produto      |
| INT-005  | Integrações  | Telemetria                                                             | A4     | P4         | `DEFERRED` | não especificado        |
| OPS-001  | Operações    | CI: `typecheck` + `test` + `verify*`                                   | A1     | P1         | `DONE`    | —                       |
| OPS-002  | Operações    | Dockerfile                                                             | A1     | P2         | `BLOCKED`  | `OPS-006`, corpo da tarefa |
| OPS-003  | Operações    | Alerta de `formatVersion` (PC-8)                                       | A1     | P3         | `BLOCKED`  | `AUD-011`, corpo da tarefa |
| OPS-004  | Operações    | Limpar `dist/` obsoleto (PC-3)                                         | A1     | P3         | `DONE`     | —                       |
| OPS-005  | Operações    | Decidir o destino de `dev/null` (PC-4)                                 | A1     | P3         | `DONE`     | —                       |
| OPS-006  | Operações    | CI: trabalho de integração em produção (PostgreSQL)                      | A1     | P3         | `BACKLOG`  | `OPS-001`               |
| TEST-001 | Testes       | Testes de rota para `vehicles`, `financial`, `compliance`, `reminders` | A1     | P1         | `DONE`    | —                       |
| TEST-002 | Testes       | Teste de contrato: `packages/shared` ↔ API                             | A1     | P2         | `DONE`     | —                       |
| DOC-001  | Documentação | Corrigir os números do README                                          | A1     | P2         | `CANCELLED` | — (fundida em `AUD-010`) |
| DOC-002  | Documentação | Documentar o fluxo de coordenação para agentes                         | A1     | P3         | `BACKLOG`  | —                       |

---

## 5. Tarefas por área

Formato: **ID · Título** — agente, prioridade, estado. Depois descrição, objetivo,  
dependências, critérios de aceitação, testes e — quando aplicável — estado de implementação e  
de validação.


### 5.1 Auditoria e hardening (A1)

#### AUD-001 · `averageFuelConsumption` ignorava abastecimentos parciais — A1 · P0 · `DONE`

- **Descrição:** a função media pares adjacentes em vez de fechar intervalos contra a última  
  âncora atestada, violando A8. Para a série do exemplo dava 10,00 L/100 km em vez de 6,00.
- **Objetivo:** cumprir A8 — intervalo fechado entre dois depósitos atestados com odómetro,  
  acumulando os litros dos parciais pelo meio.
- **Dependências:** —
- **Critérios de aceitação:** ✅ cumpridos.
- **Implementação:** `averageFuelConsumption` reescrita (ancorada); constante partilhada  
  `MIN_CONSUMPTION_INTERVAL_KM` extraída; `deriveFuelConsumption` **sem alteração funcional**;  
  docblock corrigido; `docs/API.md` e `docs/DECISIONS.md` (frase do "Porquê") alinhados.
- **Testes:** 20 novos — 13 de acumulação (`domain.test.ts:186`) + 1 de propagação (`consumptionSummary`, `domain.test.ts:867`) + 3 HTTP  
  (`fuel-consumption-http.test.ts`) + 3 da especificação HA  
  (`integrations-home-assistant.test.ts`).
- **Validação:** suíte API 34/1448 verde; typecheck API e web exit 0; web 88/88; duas mutações  
  deliberadas apanhadas e repostas.
- **Limitações:** PC-2 (divergência aceite, fixada por teste). PC-1 (o `verify.ts` não protege  
  esta regra — ver `AUD-012`).
- **Commit:** `ef0ebf6` — incluída na release publicada (consolidação de produto web, OAuth, agendador e documentos).

#### AUD-002 · Timeline: links para rotas que a web não serve (🔴-2) — A1 · P0 · `DONE`

> **Correção do diagnóstico inicial (2026-09-22, A1).** A descrição original dizia que os itens
> de inspeção, imposto e seguro aterravam no ecrã de despesas por causa do fallback de
> `RECORD_CONFIG`. **Verificado no código: é falso.** `recordHref` produz links de **detalhe**
> (`/records/inspections/<id>`), servidos por `RecordDetailPage` (`App.tsx:121`), que trata
> `inspections`, `taxes` e `insurance`; as rotas da API existem (`compliance.ts:88-93`) e
> `fetchRecordDetail` mapeia-as. Esses três **funcionam**. O defeito real é mais estreito.

- **Descrição (verificada):** `recordHref` (`domain/timeline.ts:344`) mapeia 10 tipos de registo
  para 10 rotas, mas **2** dessas rotas não existem em lado nenhum da cadeia:
  | `recordType` | href emitido | Resolve? |
  | --- | --- | --- |
  | `document` | `/records/documents/<id>` | ❌ a web serve `/documents/<documentId>` (`App.tsx:104`); a API não tem `/records/documents/:id` |
  | `reminder` | `/records/reminders/<id>` | ❌ a API expõe `/reminders/:reminderId` (`reminders.ts:65`); não existe ecrã de detalhe de um lembrete |
  Ambos produzem **404** ao clicar. Os outros 8 resolvem.
- **Verificado e correto — não mexer:** `odometer` e `vehicle` devolvem `null`. O evento de
  odómetro é escrito com `recordId: null` (`vehicles.ts:286`, `:542`) e `vehicle` não está no
  mapa. `null` é o comportamento certo: `records.tsx:330` só envolve o item em `<Link>` quando
  `href` não é nulo.
- **Objetivo:** um link da timeline abre o registo certo, **ou não existe**.
- **Dependências:** — (o conserto da interface é `WEB-004`, que depende desta tarefa)
- **Critérios de aceitação:**
  - nenhum `recordType` produzido por `recordHref` devolve uma rota que a cadeia API+web não serve;
  - `document` abre o ecrã do documento; `reminder` deixa de ser ligação (não há ecrã);
  - `odometer` e `vehicle` continuam `null`, fixado por teste;
  - teste cobre os 10 valores de `recordType` mapeados em `recordHref`.
- **Testes:** unitário de domínio sobre `recordHref` (`apps/api/test/timeline.test.ts`, novo) e
  sobre a propagação do `href` em `mapEventToTimelineItem` e `buildTimelineFromRecords`.
- **Ficheiros:** `apps/api/src/domain/timeline.ts:344-360`.
- **Fora de âmbito:** o fallback silencioso do ecrã de **lista** (`/records/:kind` → despesas) é
  `AUD-008`; os ecrãs completos por tipo são `WEB-004` (A3).
- **Observação registada:** `/records/reminders/<id>` **funcionaria** se a API expusesse essa
  rota — a web já está preparada (`RecordDetailPage` trata `reminders`; `fetchRecordDetail`
  mapeia-o). Não foi feito: acrescentar superfície de API é decisão de produto, não conserto de
  link. Fica registado para não se perder.
- **Implementação (2026-09-22, A1):** `recordHref` reescrita em
  `apps/api/src/domain/timeline.ts`. O mapa passou a ter **só** os sete tipos que vivem sob
  `/records/`; `document` devolve `/documents/<id>`; qualquer outro tipo devolve `null`. O
  docblock declara o invariante e a razão histórica. **Nenhuma rota, ecrã ou contrato foi
  alterado** — a correção é apenas no emissor do link.
- **Testes:** `apps/api/test/timeline.test.ts` (**novo, 30 testes**) — os sete tipos sob
  `/records/`; o documento em `/documents/`; `reminder`, `odometer` e `vehicle` a `null`; tipo
  desconhecido; tipo ou identificador em falta; a propagação do `href` em
  `mapEventToTimelineItem` e em `buildTimelineFromRecords`; e um teste que falha se as três
  rotas que davam 404 voltarem ao mapa.
- **Prova por mutação:** reposto o mapa antigo (`document: 'documents'`, `reminder: 'reminders'`,
  `odometer: 'odometer'`) → **9 de 30 testes falham, exit 1**. Ficheiro reposto e confirmado por
  `sha256` (`732e690c63bfc6f21b2533b1ebf1dc449ef33b79b33da7266d65282226aaaba6`), sem resíduo.
- **Validação:** suíte API **35 ficheiros / 1478 testes, exit 0**; `typecheck` API e web exit 0;
  `tsc` explícito sobre o ficheiro de teste exit 0 (o `typecheck` do projeto **exclui**
  `**/*.test.ts` — ver `PC-15`).
- **Limitações:** o fallback silencioso do ecrã de **lista** mantém-se — é `AUD-008`. `reminder` e
  `odometer` deixam de ser ligação na timeline; se o produto quiser um ecrã de detalhe para cada
  um, é tarefa nova (ver «Observação registada»).
- **Commit:** `ef0ebf6` — incluída na release publicada (consolidação de produto web, OAuth, agendador e documentos).

#### AUD-003 · Export: odómetros (🔴-3) — A1 · P0 · `BACKLOG`

- **Descrição:** achado 🔴-3 da auditoria funcional de 2026-09-21, registado com o título  
  *"export odometers"*. O diagnóstico detalhado (que campo, que ficheiro do bundle, que  
  caminho) **tem de ser recuperado do relatório da auditoria funcional** antes de implementar —  
  não foi reconstituído nesta fase.
- **Objetivo:** por determinar.
- **Dependências:** recuperar diagnóstico.
- **Primeiro passo:** reler o relatório da auditoria funcional, confirmar o defeito contra o  
  código atual de `services/export-bundle.ts` e só então preencher critérios de aceitação.
- **Nota:** `export-bundle.ts` **já** escreve `odometerRecords` (`:299-306`) e inclui  
  `odometerReadings` (`:222`). O defeito será numa omissão específica — confirmar antes de mexer.
- **Testes:** a definir com o diagnóstico.
- **Procura do relatório (2026-09-22, A1) — não localizado.** Procurou-se, sem êxito:
  - `docs/` (os 9 documentos presentes);
  - os diários de projeto `.workbuddy-ai/memory/2026-09-17.md` a `2026-09-22.md` — **zero**
    ocorrências de 🔴 em todos;
  - `grep` sobre todos os `*.md`, `*.txt`, `*.json` e `*.log` do repositório por
    *"export odometers"*, *"timeline omission"* e *"auditoria funcional"* — as únicas
    ocorrências são **auto-referências** deste ROADMAP, de `AGENT-PROMPTS.md` e do diário;
  - fora do repositório (`~/Downloads`) só existem auditorias sem relação com o Zemlo.

  O único documento de auditoria no repositório é **`docs/AUDIT-2026-09-20.md`**, que é
  **outra auditoria** — completude global, datada de 2026-09-20 — e **não contém** qualquer
  achado de exportação de odómetros nem de omissão na timeline. É a origem de `AUD-008`,
  `AUD-009`, `AUD-010`, `TEST-001` e `OPS-001`, não de 🔴-3/🔴-6/🟠.

  **Conclusão: o diagnóstico de 🔴-3 não é recuperável a partir do repositório.** A tarefa
  fica `BACKLOG` e o defeito **não** é reconstruído por inferência — instrução explícita do
  briefing. Para desbloquear é preciso o relatório original (ou autorização para reinvestigar
  a exportação de odómetros de raiz, o que seria tarefa nova, não esta).

#### AUD-004 · Teste do `ConsoleEmailSender` é falso verde (🔴-4) — A1 · P0 · `DONE`

> **Desbloqueada em 2026-09-22.** O bloqueio era o `PC-16`: o `email.ts` estava a ser mutado por
> outro agente em tempo real. A2 fechou `AUTH-001` e identificou a mutação que eu observei — era
> a **mutação M2 da verificação de `AUTH-001`**, já reposta. Confirmado por A1: nenhum `if (false`
> no ficheiro, guarda de produção **intacto** (`email.ts:205`), hash
> `58345a66509a14b3a88d49ec7ea65d4d6376daab4fcd7fa3660c6cd0bd56cfee`.
>
> **Coordenação feita por A2 no mesmo dia, sem duplicação.** O ramo de **recusa de arranque em
> produção** fica em ficheiro **novo** (`test/email-startup.test.ts`, tarefa **`AUTH-008`**, de A2)
> e `test/email.test.ts` fica para **A1** — que é esta tarefa. São defeitos distintos: `AUD-004` é
> o **falso verde da redação**; `AUTH-008` é o **ramo de arranque sem cobertura nenhuma**.
> Ficheiros distintos, donos distintos. `PC-16` pode considerar-se **resolvido** (era mutação de
> verificação, não resíduo) — ver nota em `PC-14`/`PC-16`.

- **Descrição:** o teste reimplementa localmente a classe que devia vigiar, em vez de exercitar  
  a de produção. Consequência: passa mesmo depois de a produção perder a redação de segredos  
  no log — a garantia desaparece sem nenhum teste ficar vermelho.
- **Prova já recolhida (por A1, sem tocar no ficheiro):** com o guarda de produção desativado, a
  suíte completa passa **1478/1478** e `test/email.test.ts` passa **12/12**. Ou seja, o falso
  verde não é uma suspeita: está medido. **A2 reproduziu-o independentemente** em `AUTH-001`
  (mutação M2: 35 ficheiros / 1478 testes, exit 0, com o guarda desativado) — duas medições
  separadas, o mesmo resultado.
- **Diagnóstico (verificado em 2026-09-22, A1):** `test/email.test.ts:172` define
  `construirConsoleSender()` — uma **cópia local** do `ConsoleEmailSender`, justificada no docblock
  (`:166`) por a classe não ser exportada. A cópia chama `redactResetLinks(message.text)` **ela
  própria** (`:180`). Consequência: a asserção central (`:144`, «o token não pode estar no log»)
  passa por causa do **texto do teste**, não do código de produção. Se o `ConsoleEmailSender` de
  produção perder a chamada a `redactResetLinks` (`email.ts:88`), o token sai em claro no log e
  **este ficheiro continua verde**. É exatamente o falso verde descrito.
- **Premissa confirmada (necessária para a prova por mutação):** `text` **não** está em
  `SENSITIVE_KEYS` (`core/logger.ts:30-52` — a lista tem `token` como *nome de chave*, não como
  conteúdo) e o objeto registado é `{to, subject, text}`, sem chave sensível de topo. Logo o logger
  **não redige nada** aqui: a única proteção é mesmo o `redactResetLinks()` dentro do sender. O
  docblock de `email.ts:75-78` (corrigido por A2 ao tratar `PC-19`) já o afirma e termina com «é
  isso que `test/email.test.ts` vigia» — **frase que hoje ainda é falsa**, e que esta tarefa torna
  verdadeira.
- **Objetivo:** o teste tem de exercitar o `ConsoleEmailSender` **real**.
- **Dependências:** — (desbloqueada; era a estabilização de `email.ts`).
- **Critérios de aceitação:**
  - o teste exercita a implementação **real** — nenhuma cópia local da classe no ficheiro;
  - **prova por mutação:** retirar `redactResetLinks()` do `ConsoleEmailSender` de produção faz o
    teste falhar (hoje **não** faz);
  - repor e confirmar verde, com o ficheiro de produção confirmado por `sha256`.
- **Abordagem escolhida — exercer a classe real sem tocar em produção:** `registerEmailSender()`
  sem SMTP e fora de produção constrói e regista o `ConsoleEmailSender` **verdadeiro**
  (`email.ts:214`); a partir daí `sendEmail()` usa-o. O teste passa a chamar `registerEmailSender()`
  e depois `sendEmail()`, observando o **log real**. Assim (a) a implementação exercida é a de
  produção, sem cópia; (b) a **superfície pública do módulo não muda** — não se exporta a classe só
  para o teste, que é a objeção legítima do docblock atual; (c) passa a cobrir-se também a
  **ligação** `registerEmailSender` → `ConsoleEmailSender` → `sendEmail` → logger, que a cópia
  local também não cobria. `construirConsoleSender()` é **removida**.
- **Testes:** `apps/api/test/email.test.ts` (existente, a corrigir).
- **Ficheiros:** `apps/api/test/email.test.ts`. **Produção: nenhuma alteração prevista** — a
  mutação é temporária e revertida.

- **Implementação (2026-09-22, A1):** `apps/api/test/email.test.ts` deixou de reconstruir o
  sender. `construirConsoleSender()` — e o `import { logger }` que só ele usava — foram
  **removidos**; o teste passa a obter o sender por `registerEmailSender()`, o **caminho de
  produção**, e a exercê-lo através de `sendEmail()`, observando o log real. **Nenhuma linha de
  produção foi alterada** e a superfície pública do módulo **não mudou** — não se exporta a
  classe só para o teste, que era a objeção legítima do docblock antigo. O `afterEach` repõe o
  sender para uma escolha não contaminar o caso seguinte.
- **Prova por mutação (a que faltava):** retirado `redactResetLinks()` de
  `ConsoleEmailSender.send` (`email.ts:88`) → `test/email.test.ts` **1 de 12 falha, exit 1**,
  com `AssertionError: O token de recuperação chegou ao log.` e o token
  `AbC123xyzTokenValue456` **visível em claro** no log capturado. Ficheiro reposto e confirmado
  por `sha256` (`58345a66509a14b3a88d49ec7ea65d4d6376daab4fcd7fa3660c6cd0bd56cfee`), linha `:88`
  de volta, sem resíduo. **O que antes dava verde passa a dar vermelho** — é essa a diferença
  que define a tarefa. *(Nota: um `grep` de resíduo por `text: message.text,` acusa a linha 159,
  que é do `SmtpEmailSender` — passa o texto real ao cliente SMTP, não o registra. Falso
  positivo do meu próprio padrão de pesquisa, verificado por leitura.)*
- **Validação:** `test/email.test.ts` **12/12 verde** depois da reposição; `typecheck` exit 0.
  Um só ficheiro alterado, e só de teste.
- **Limitações:** o ramo de **recusa de arranque em produção** continua sem cobertura *neste*
  ficheiro — é `AUTH-008` (A2), deliberadamente noutro ficheiro. O teste exercita a classe real
  **pelo caminho de produção**; se `registerEmailSender()` deixar de usar o `ConsoleEmailSender`,
  a segunda asserção (o log continua a conter a mensagem) falha — a **ligação** fica assim
  também fixada, o que a cópia local não fazia.
- **Nota de processo:** a primeira tentativa de edição **perdeu duas de quatro alterações** — o
  ficheiro ficou com o `import` removido e a função removida, mas com os dois testes ainda a
  chamar `construirConsoleSender()`, o que deu `ReferenceError`. Reaplicado numa **só** escrita e
  verificado. É o mesmo problema do **`PC-20`**, agora dentro de um lote de edições.
- **Commit:** `ef0ebf6` — incluída na release publicada (consolidação de produto web, OAuth, agendador e documentos).

#### AUD-005 · `PATCH /records/charging` não recalcula derivadas (🔴-5) — A1 · P0 · `DONE`

- **Descrição:** a atualização de um carregamento não devolve/recalcula as métricas derivadas,  
  ao contrário do que acontece na criação — onde a resposta traz as derivadas já calculadas  
  (§43, "a regra dos 10 segundos").
- **Objetivo:** coerência entre criar e editar: as derivadas refletem o estado após a alteração.
- **Dependências:** —
- **Critérios de aceitação:**
  - após `PATCH`, as métricas derivadas correspondem aos novos valores;
  - nenhuma derivada fica com o valor anterior;
  - teste de rota cobre alteração de energia, custo e quilometragem.
- **Testes:** teste de rota (HTTP) sobre `PATCH /records/charging`.
- **Ficheiros prováveis:** rotas de carregamento (`http/routes/financial.ts`), `services/records-financial.ts`.
- **Nota:** confirmar a superfície exata do defeito antes de alterar — ver §1.2.
- **Diagnóstico (verificado em 2026-09-22, A1):** `updateChargingSession`
  (`services/records-financial.ts:661`) terminava com
  `mapChargingSession(updated, zeroChargingDerived())` — devolvia o registo com **as cinco
  derivadas a `null`** (`averagePowerKw`, `addedSocPercent`, `distanceSincePreviousKm`,
  `consumptionKwh100Km`, `costPer100KmCents`), enquanto a leitura imediatamente a seguir as
  trazia preenchidas. O irmão `updateFuelSession` já fazia o correto
  (`return getFuelSession(...)`). O defeito era, por isso, uma **assimetria entre irmãos** —
  não um erro de cálculo. A aritmética (`deriveChargingConsumption`, `averagePower`) nunca
  esteve errada.
- **Implementação (2026-09-22, A1):** o fim de `updateChargingSession` passou a
  `return getChargingSession(userId, sessionId);` (`:706`), com docblock a explicar a razão e
  a apontar o irmão que já servia de modelo. `zeroChargingDerived()` foi **removida** — ficou
  sem chamadores. **Nenhuma outra operação de `charging` foi tocada** (criar, ler, apagar e a
  despesa ligada ficaram iguais), conforme a restrição da tarefa.
- **Testes:** `apps/api/test/charging-update-http.test.ts` (**novo, 4 testes**), no padrão de
  `fuel-consumption-http.test.ts`: `createTestDb()`, `DATABASE_URL` antes dos imports,
  Supertest contra `createApp()`, SQLite temporário fora do repositório, conta por teste.
  Cobre: (a) antes/depois da edição com números exatos — antes
  `{averagePowerKw: 50, addedSocPercent: 50, distanceSincePreviousKm: 500, consumptionKwh100Km: 10, costPer100KmCents: 300}`,
  depois de editar para `{energyKwh: 60, amountCents: 1800, odometerKm: 11 000, durationMinutes: 30, endSocPercent: 90}`
  passa a `{averagePowerKw: 120, addedSocPercent: 60, distanceSincePreviousKm: 1000, consumptionKwh100Km: 6, costPer100KmCents: 180}`;
  (b) o corpo do `PATCH` é **igual** ao do `GET` seguinte; (c) edição parcial só de energia
  também recalcula; (d) o primeiro carregamento continua com as três derivadas de intervalo a
  `null` e `averagePowerKw` calculada — fixa §49 (nunca inventar `0`).
- **Prova por mutação:** reposto o comportamento antigo (devolver o `update` em vez de o
  reler) → **4 de 4 testes falham, exit 1**. Ficheiro reposto e confirmado por `sha256`
  (`58f4ed143dc458e4f56e69f8c7d6449450669def6efa4744cadf350c990f581b`), sem resíduo.
- **Validação:** suíte API verde; `typecheck` API exit 0 (`TSC_API=0`); execução isolada do
  ficheiro novo: 4/4 verdes.
- **Limitações:** um `tsc` explícito sobre o ficheiro de teste devolve **exit 2** com
  `TS2322` na linha `appPrisma = prisma` do harness — incompatibilidade entre o
  `PrismaClient` gerado para Postgres e o tipo SQLite. É **pré-existente e herdada** de
  `fuel-consumption-http.test.ts` (o mesmo erro, na mesma construção), **não** introduzida
  por esta tarefa, e não afeta a execução. O `typecheck` do projeto não a vê porque exclui
  `**/*.test.ts` — é exatamente o buraco registado em **`PC-15`**.
- **Commit:** `ef0ebf6` — incluída na release publicada (consolidação de produto web, OAuth, agendador e documentos).

#### AUD-006 · Timeline: omissão de itens (🔴-6) — A1 · P0 · `BACKLOG`

- **Descrição:** achado 🔴-6, registado com o título *"timeline omission"*. Que itens são  
  omitidos **tem de ser recuperado do relatório da auditoria funcional** — não foi  
  reconstituído nesta fase.
- **Objetivo:** por determinar.
- **Dependências:** recuperar diagnóstico.
- **Primeiro passo:** reler o relatório, comparar os tipos de registo que geram evento  
  (`services/events.ts`) com os que `buildTimelineFromRecords` cobre, e identificar o buraco.
- **Testes:** a definir com o diagnóstico.
- **Procura do relatório (2026-09-22, A1) — não localizado.** A mesma busca descrita em
  `AUD-003` (docs, diários, `grep` por *"timeline omission"* e *"auditoria funcional"*) não
  encontrou o relatório. **Conclusão: o diagnóstico de 🔴-6 não é recuperável a partir do
  repositório**; a tarefa fica `BACKLOG` e o defeito **não** é reconstruído por inferência.
- **Evidência indireta (não conclusiva, registada para não se perder):** durante `AUD-002`
  varreu-se `recordHref` e `buildTimelineFromRecords` sem encontrar omissão de itens — os
  tipos que geram evento com `recordId` ou resolvem ou devolvem `null` deliberadamente. Isso
  **não** descarta 🔴-6: o achado pode estar na **origem** do evento (`services/events.ts`) e
  não na montagem da timeline. **Não substitui o diagnóstico.**

#### AUD-007 · Achados 🟠 da auditoria funcional — A1 · P1 · `BACKLOG`

- **Descrição:** a auditoria funcional de 2026-09-21 classificou também achados 🟠 (melhorias).  
  **A lista completa não está neste documento** porque o relatório não foi localizado nos  
  diários do projeto nem em `docs/`.
- **Objetivo:** importar todos os 🟠 para o ROADMAP, um por tarefa, com ID próprio.
- **Primeiro passo:** recuperar o relatório da auditoria funcional e transcrever os 🟠.
- **Procura do relatório (2026-09-22, A1) — não localizado.** A mesma busca descrita em
  `AUD-003` (os 9 documentos de `docs/`, os seis diários `.workbuddy-ai/memory/`, `grep`
  exaustivo por *"auditoria funcional"* em `*.md`/`*.txt`/`*.json`/`*.log`, e `~/Downloads`)
  não encontrou o relatório. **Não é recuperável a partir do repositório.**
- **Nota de honestidade:** esta entrada existe para não deixar cair os achados, não porque  
  estejam catalogados. **Não inventar achados** para preencher a lista. O briefing de A1
  reforça-o: *"não inventes nem completes o defeito por inferência"*.
- **Observação sobre fontes:** existe **um** documento de auditoria no repositório,
  `docs/AUDIT-2026-09-20.md` — completude global, 2026-09-20 —, que **não** é o relatório
  funcional de 2026-09-21 e **não** contém 🟠 por transcrever. É, isso sim, a origem de
  `AUD-008`, `AUD-009`, `AUD-010`, `TEST-001` e `OPS-001`. Está **untracked** e não era
  citado em lado nenhum deste documento até 2026-09-22.

#### AUD-008 · `/records/:kind` degrada em silêncio para despesas — A1 · P1 · `DONE`

- **Diagnóstico verificado (2026-09-22, A1):** `configFor` (`RecordsPage.tsx:336`) devolvia
  `RECORD_CONFIG.expenses` para **qualquer** `kind` fora do mapa (`:337`), e o mapa
  (`RECORD_CONFIG`, `:288`) só tem `expenses`, `fuel`, `charging` e `maintenance`. Como o `kind`
  também indexa as consultas (`queries[config.key]`, `:90`), `/records/insurance` renderizava a
  lista de **despesas** — título «Despesas», botão «Nova despesa», categoria por defeito — sem
  erro, sem aviso, e a olhar para dados que o utilizador não pediu. Confirmado que **não** existe
  rota `/records` sem `kind` (o `*` de `App.tsx:122` apanha-a), pelo que `kind` está sempre
  definido neste ecrã.
- **Fora de âmbito (confirmado no código):** `/records/reminders` **não** passa por aqui — tem
  rota própria (`App.tsx:102` → `RemindersPage`), que o `react-router` prefere por o segmento
  estático vencer o dinâmico. Nada nesta correção a afeta; um «tipo desconhecido → 404» cego
  teria partido este ecrã, e foi por isso que o âmbito foi delimitado antes de mexer.
- **Implementação prevista:** `configFor` passa a devolver `RecordConfig | null` — `null` como
  resposta de primeira classe, para quem chama ter de **decidir** — e `RecordsPage` ganha um ramo
  explícito «Não encontrámos esta secção», reutilizando `EmptyState` + `NavLink`: o mesmo padrão
  e o mesmo vocabulário da `NotFoundPage` (`App.tsx:210`), para não inventar um segundo estilo de
  recusa no mesmo produto. **Nenhum ecrã novo** de inspeções, impostos, seguros ou odómetro —
  isso é `WEB-004` (A3), que esta tarefa desbloqueia.
- **Testes:** ficheiro próprio `apps/web/test/records-kind.test.tsx` (para não colidir com
  `page-states.test.tsx`, de A3): render de `/records/insurance` (recusa, com caminho de volta) e
  de `/records/fuel` (continua a funcionar), mais um caso de `kind` vazio.

- **Descrição:** `RecordsPage.tsx:337` faz fallback para a configuração de despesas quando o  
  `kind` não existe em `RECORD_CONFIG`. Seguros, inspeções e impostos **existem** na API e na  
  UI (como separadores em `VehicleDetailPage`). `/records/insurance` não dá erro — mostra o  
  ecrã errado. Uma degradação silenciosa é pior do que um 404.
- **Objetivo:** um endereço desconhecido tem de ser recusado de forma visível.
- **Dependências:** — (relacionada com `AUD-002`)
- **Critérios de aceitação:**
  - `/records/<kind desconhecido>` não renderiza o ecrã de despesas;
  - mostra um estado "não encontrámos esta secção" com caminho de volta;
  - os `kind` legítimos continuam a funcionar.
- **Testes:** teste de renderização da rota com `kind` inválido e com `kind` válido.
- **Ficheiros:** `apps/web/src/pages/records/RecordsPage.tsx:288,337`.

- **Implementação (2026-09-22, A1):** `configFor` (`RecordsPage.tsx:357`) devolve
  `RecordConfig | null` — o fallback para despesas foi **removido**. `RecordsPage` ganhou o ramo
  `if (!config) return <UnknownRecordKind />;`, colocado **depois de todos os hooks** (as quatro
  consultas continuam a ser declaradas sempre, com filtro inativo) e **antes** de se tocar em
  `active`; as guardas das consultas passaram de `config.key` para `config?.key`. O componente
  `UnknownRecordKind` reutiliza `EmptyState` + `NavLink` — mesmo padrão e mesmo vocabulário da
  `NotFoundPage` (`App.tsx:210`). **Nenhum ecrã novo** de inspeções, impostos, seguros ou
  odómetro: isso é `WEB-004`, que esta tarefa desbloqueia.
- **Testes:** `apps/web/test/records-kind.test.tsx` (**novo, 7 testes**) — `/records/insurance`
  recusa e **não** contém «Nova despesa» nem «Tudo o que gastaste»; `odometer`, `inspections`,
  `taxes` e um tipo inventado recusam; o caminho de volta existe (`href="/"`); e os quatro tipos
  legítimos continuam a mostrar o título e o botão certos. Ficheiro **próprio** para não colidir
  com `page-states.test.tsx` (A3).
- **Prova por mutação:** reposto `RECORD_CONFIG[kind] ?? (RECORD_CONFIG.expenses as RecordConfig)`
  → **3 de 7 testes falham, exit 1**, e o HTML recebido mostra o defeito em estado puro:
  `/records/insurance` a renderizar `<h1>Despesas</h1>`, «Tudo o que gastaste com os teus
  veículos.», «＋ Nova despesa» e o filtro de categoria. Ficheiro reposto e confirmado por
  `sha256` (`fee4ae43762260b97598b1ecb53aebb9f25192cd64f806c3881c04ae149c34bd`), sem resíduo.
- **Validação:** suíte web **6 ficheiros / 106 testes, exit 0** (eram 99 — os 7 novos); `typecheck`
  exit 0 nos três workspaces.
- **Limitações:** `insurance`, `inspections`, `taxes` e `odometer` continuam **sem ecrã de lista**
  — passam a ser recusados em vez de mostrar o ecrã errado, que é o que esta tarefa pedia.
  Construí-los é `WEB-004` (A3), agora desbloqueada. `AUD-013` (dicas de dados em falta com
  `?sheet=`) é a mesma família de defeito e continua `BACKLOG`, à espera de decisão de produto.
- **Commit:** `ef0ebf6` — incluída na release publicada (consolidação de produto web, OAuth, agendador e documentos).

#### AUD-009 · Sincronizar A17 + `OPERATIONS` §9 + texto de documentos — A1 · P1 · `DONE`

- **Descrição:** três textos contradizem o código, todos por trabalho recente que avançou uma  
  capacidade sem atualizar a documentação:
  - `DECISIONS.md` A17 diz "no MVP não serve os bytes" — verdade sobre HTTP, **falso** sobre  
    armazenamento (os bytes são gravados e viajam no bundle);
  - `OPERATIONS.md` §9 diz que "os bytes vivem num armazenamento de objetos, que ainda não está  
    configurado" — **falso**: `LocalDocumentStorage` está implementado e testado;
  - `DocumentsPage.tsx:110` promete um botão que depende de trabalho por fazer.
- **Objetivo:** documentação que descreve o estado real.
- **Critérios de aceitação:** os três textos refletem o que o código faz; nenhuma capacidade  
  pronta continua descrita como inexistente.
- **Testes:** não aplicável (documentação). Verificar por leitura contra o código.
- **Nota:** a prática do projeto (secções "o que fica para depois") é boa — o que falha é a  
  **sincronização**.

**Implementação e provas (A1, 2026-09-22) — `DONE`:**

- **A premissa inverteu-se.** Os três textos do enunciado **já estavam corrigidos**: o título de
  `A17` e a revisão `A17.1` estão em `HEAD`, e o texto de `OPERATIONS` §9 corrigido também
  (`:408-412`). Mas **`PROD-001`** (upload de documentos, A4, `DONE`) tornou os mesmos textos falsos
  **na direção oposta** — passaram a descrever como inexistente uma capacidade construída. O critério
  «nenhuma capacidade pronta continua descrita como inexistente» estava **literalmente violado**. A
  tarefa é a mesma; mudou o motivo. **Não é trabalho novo.**
- **Alterados (3 ficheiros, +24 / −13):** `docs/DECISIONS.md` (`A17.1`, correção **atribuída** que
  preserva o registo e aponta para `A31`), `docs/OPERATIONS.md` §9 (o bullet passa de «Upload de
  ficheiros» — que existe — para «Envio de ficheiros pela interface web» — que é o que falta) e
  `apps/web/src/pages/DocumentsPage.tsx` (docblock `:22-26` e aviso `:108-109`).
- **Provas:** `vitest run test/documents-http.test.ts` → **exit 0, 69 testes** (9 blocos `describe`
  de upload); `tsc -p apps/web/tsconfig.json --noEmit` → **exit 0**. Cada afirmação escrita foi
  verificada em `ficheiro:linha` no código, **não** copiada do ROADMAP: `routes/documents.ts:340`,
  `services/documents.ts:385`, `DocumentsPage.tsx:22-26`.
- **Não tocados, por serem de outra frente ou por não terem nada a corrigir:** `docs/API.md` (A4,
  §8.1 — já correto, documenta `POST`/`GET /documents/:id/content` em §A31) e
  `VehicleDetailPage.tsx:1367` (verificado, correto).
- **Limitações:** (a) **sem prova por mutação** — a alteração é texto, e a prova é a execução dos
  testes da capacidade descrita; (b) o **controlo de upload na web não foi criado** (não há
  `<input type="file">` para documentos) — criá-lo é trabalho novo, para decisão de A9; (c) o
  terceiro bullet do enunciado **não correspondia ao código**: `DocumentsPage.tsx:110` não «promete
  um botão», tem uma **nota** que diz o que não existe — mesma classe de erro de `PC-11`/`PC-12`.
- **Commit:** `ef0ebf6` — incluída na release publicada (consolidação de produto web, OAuth, agendador e documentos).

#### AUD-010 · Números do README desatualizados — A1 · P2 · `DONE`

- **Descrição:** "27 tabelas" (são 29), "63 unitários" (são 1448), "30 rotas" (são 32).
- **Objetivo:** o README é o primeiro documento que alguém lê; números errados subestimam o  
  próprio trabalho e desinformam.
- **Critérios de aceitação:** os três números conferem com o repositório; existe um comando  
  único que os volte a medir, se possível.
- **Ficheiros:** `README.md:19-22`.

**Implementação e provas (A1, 2026-09-22) — `DONE`:**

- **A premissa estava certa e era maior.** Não eram três números em `:19-22`: eram **seis
  quantidades em doze ocorrências** (`:19`, `:21`, `:22`, `:23`, `:97`, `:99`, `:131`, `:145`,
  `:147`, `:175`, `:307`) — cabeçalho, bloco de comandos, árvore de ficheiros e lista de
  documentação. Corrigir só as três primeiras deixaria o documento a contradizer-se sete vezes.
- **Dois números da própria especificação estavam errados:** são **31** rotas da web (não 32: 33
  atributos `path="…"` menos **dois** apanha-tudo) e **1 841** testes automáticos (não 1448: API
  1 707 + web 134).
- **Medido:** 29 tabelas (os dois schemas concordam), 31 rotas, 31 decisões, 1 841 testes, 235 em
  `verify`, 77 em `test/domain.test.ts`; 70 regressões e 12 guardas já estavam certos. A definição
  de «rota» ficou **escrita** (atributos `path` com valor próprio em `App.tsx`, sem o apanha-tudo).
- **Criado o «comando único»** que o critério pede: `scripts/check-readme-numbers.mjs` (novo),
  exposto como `npm run readme:numbers` (`--check` → `exit 1`). **Prova por mutação — 4 mutações**,
  três no documento e **uma no repositório** (`## A32` em `DECISIONS.md`), todas `exit 1` e só o
  grupo mutado vermelho; ficheiros repostos e confirmados por `sha256`.
- **A mutação M3 encontrou um defeito no próprio comando:** com a frase reescrita, ele imprimia
  `? …: não encontrado no README` e saía **`0`** — um verificador cego que sai verde. Corrigido:
  divergência → `exit 1` só em `--check`; **valor não encontrado → `exit 1` sempre**.
- **Alterados:** `README.md` (+21 / −12), `package.json` (+1, o script) e **um passo novo no
  `.github/workflows/ci.yml`** de `OPS-001` (+6 linhas) — alteração a um artefacto já aceite,
  reversível em 6 linhas, declarada para decisão de A9.
- **Não medido (declarado):** `verify:integration` = 28 é **derivado** do script, não executado
  (`OPS-006`); os totais das suítes foram medidos **à mão, uma vez** — o comando verifica só a
  coerência interna deles.
- **Limitações e observações registadas:** (a) `apps/web/src/App.tsx:38` diz «trinta rotas» e são
  trinta e uma — registado em `PC-41`, ficheiro **não** tocado (frente da web); (b) `PC-34` **não se
  reproduziu** nesta corrida (28 passados) — registado na linha do `PC-34`, **não** fechado; (c) os
  totais das suítes no README vão envelhecer: (a) mantê-los com o guarda de CI (feito) ou (b)
  trocá-los pelos nomes dos comandos — **decisão de produto, não tomada por A1**; (d) resíduos de
  outras frentes (`apps/api/vitest-out.log`, `vitest.config.ts.timestamp-*.mjs`) vistos e não
  tocados (ignorados pelo `.gitignore`).
- **`PC-7` fecha, com os dois números do próprio texto corrigidos** (acima). **`DOC-001` permanece
  `CANCELLED`** — a dona é `AUD-010`.
- **Commit:** `ef0ebf6` — incluída na release publicada (consolidação de produto web, OAuth, agendador e documentos).

#### AUD-011 · Decidir o destino do motor de migração — A1 · P2 · `BACKLOG`

- **Descrição:** `domain/import/migrate.ts` (440 linhas) tem `migrateBundle`, `runMigrations`,  
  `findMigrationPath` e `MIGRATIONS` — só `checkCompatibility` é usado em produção.  
  `MIGRATIONS` é um array vazio e o ramo é inalcançável com `FORMAT_VERSION === 1`.
- **Objetivo:** ou fica **declarado** como andaime para `formatVersion` 2, ou sai até haver  
  versão 2. Não pode ficar ambíguo.
- **Dependências:** decisão de produto do utilizador.
- **Critérios de aceitação:** a decisão está escrita em `DECISIONS.md`; o código reflete-a.
- **Nota:** é andaime deliberado, **não** código morto por acidente.

#### AUD-012 · Checks de consumo do `verify.ts` são insensíveis — A1 · P2 · `DONE`

- **Descrição (medido, não inferido):** para a série que o `verify.ts` constrói, a  
  implementação **antiga** devolve `6` e a **nova** também. O check  
  `"O consumo médio ignora intervalos com abastecimento parcial"` passava antes da correção e  
  passa depois — não distingue a implementação corrigida da avariada. O mesmo vale para o  
  check do dashboard (`:718-721`).
- **Objetivo:** o check tem de **discriminar**. Basta acrescentar um parcial **entre** dois  
  atestados: aí a série dá `6` na nova e `10` na antiga.
- **Dependências:** — (`AUD-001` já criou a cobertura equivalente na suíte de testes)
- **Critérios de aceitação:**
  - o `verify.ts` inclui uma série com um parcial **entre** dois depósitos atestados;
  - essa série falha contra a implementação antiga (comprovado) e passa contra a atual.
- **Testes:** o próprio `verify.ts` (não corre em `npm test` — ver `OPS-001`).
- **Ficheiros:** `apps/api/scripts/verify.ts:477-481`, `:718-721`.

**Implementação e provas (A1, 2026-09-22) — `DONE`:**

- **Alterado:** `apps/api/scripts/verify.ts` (+84 / −1). **Nada mais.** `calculations.ts` foi alvo
  de mutação e reposto, confirmado por `sha256`.
- **Série nova, num terceiro veículo** (`77-QR-05`, gasolina): atestado 40 L @ 10 000 km → **parcial
  10 L @ 10 500 km** → atestado 50 L @ 11 000 km. A implementação atual dá **`6,00`**; a anterior a
  A8 dá **`10,00`**. Fixado em dois sítios: `verify.ts:546-551` (`/stats`) e `verify.ts:798-802`
  (`/dashboard`).
- **A série do BMW não podia discriminar, e isso é demonstrável (aritmética, não opinião):**
  `(180 + 30 + F) / (3 000 + x) = 0,06` obriga a `F = 0,06x − 30`; substituindo na média antiga
  obtém-se `(150 + 0,06x) / (2 500 + x) = 0,06`. **Sempre que a nova dá `6`, a antiga dá `6`** — a
  série é proporcional, e o desvio do parcial é absorvido exatamente pelo desvio do denominador. Não
  há `P`, `F`, `x` que separem as duas implementações. Daí a série **nova** em vez de um ajuste da
  existente.
- **Prova por mutação — a mutação prova as duas coisas de uma vez:**

  | Prova | Resultado medido |
  | --- | --- |
  | `tsc -p tsconfig.json --noEmit` | **exit 0** |
  | `vitest run test/domain.test.ts test/fuel-consumption-http.test.ts` | **exit 0** — 2 ficheiros, **80 testes** |
  | `verify.ts` com a implementação **atual** | **exit 0** — **235 verificações passaram**, 0 falharam |
  | `verify.ts` com a implementação **antiga** (mutação) | **exit 1** — 233 passaram, **2 falharam** (as duas novas, com `10`) |

  As duas linhas do BMW continuam **verdes sob o defeito que deviam apanhar** — é o `PC-1`, agora
  medido e não afirmado —, enquanto as duas linhas novas ficam **vermelhas** com `10`.
- **Reposição:** `calculations.ts` `sha256` idêntico (`0efe688e…`); `dev.db` **intacta**
  (`0589b575…`); `check-integrity.mjs` **intacto** (`543faf6c…`). Sem resíduo de mutação.
- **Alteração colateral declarada:** `verify.ts:1011` contava `2` veículos (afirmação de *fixture*);
  passou a `3`. Continua uma **igualdade exata** — **não** foi enfraquecida para `>=`. É um número
  mágico: quem acrescentar um veículo ao §3 do script tem de a atualizar. **Observação para A9, sem
  tarefa criada por A1.**
- **Limitação:** `npm test` **não** cobre o `verify.ts` — a prova é a execução real. A implementação
  antiga é **reconstruída** da memória de 2026-09-21 (o git tem um só commit para o ficheiro) e
  validada por reproduzir o `10,00` documentado. O `verify.ts` **não** correu num runner de GitHub
  Actions (limitação já declarada em `OPS-001`).
- **Nota de âncora:** as referências de `PC-1`/`AUD-012` a `:477-481` e `:718-721` ficaram
  **desatualizadas** pelo crescimento do ficheiro. Os sítios corretos são `:483-494` (BMW,
  insensível), `:519-555` (série discriminante + `/stats`), `:790` (BMW, dashboard) e `:796-802`
  (dashboard discriminante) — mas o que envelhece mal é o **número de linha**: a âncora estável é o
  **rótulo do check**.
- **Commit:** `ef0ebf6` — incluída na release publicada (consolidação de produto web, OAuth, agendador e documentos).

#### AUD-013 · Dicas de dados em falta: 4 de 7 links abrem o separador errado — A1 · P1 · `BACKLOG`

- **Descrição (verificada; descoberta durante `AUD-002`, mesma família de defeito):** `dataGaps`
  (`domain/analysis.ts:489`) constrói links para a ficha do veículo com `?sheet=<nome>`. Dos
  sete, **quatro** usam um nome que a web não conhece:
  | `href` gerado | linha | separador que a web abre |
  | --- | --- | --- |
  | `?sheet=odometer` | `analysis.ts:518` | ❌ `overview` — em silêncio |
  | `?sheet=insurance` | `:526` | ✅ Seguro |
  | `?sheet=inspection` | `:534` | ✅ Inspeções |
  | `?sheet=reminder` | `:542` | ✅ Lembretes |
  | `?sheet=expense` | `:551` | ❌ `overview` — em silêncio |
  | `?sheet=fuel` | `:559` | ❌ `overview` — em silêncio |
  | `?sheet=charging` | `:567` | ❌ `overview` — em silêncio |
  A web resolve o parâmetro por `TAB_ALIASES` (`VehicleDetailPage.tsx:104-127`), que não tem
  entradas para `odometer`, `expense`, `fuel` nem `charging`; o fallback é
  `TAB_ALIASES[requested] ?? 'overview'` (`:136`). O utilizador clica numa dica do painel e
  aterra na visão geral, sem nada que explique porquê.
- **Objetivo:** uma dica de dados em falta leva ao sítio onde o dado se preenche, ou não é ligação.
- **Dependências:** —
- **Primeiro passo — decisão de produto, não código:** **não existe** separador de despesas,
  abastecimentos, carregamentos nem odómetro na ficha do veículo. Decidir o destino de cada uma
  das quatro (abrir o registo rápido, ir para `/records/<tipo>`, ou deixar de ser ligação)
  **antes** de mexer. **Não inventar separadores** para fazer o link passar a apontar a algum lado.
- **Critérios de aceitação:** cada um dos sete `href` abre um destino que existe; nenhum cai em
  `overview` em silêncio; um teste fixa a correspondência entre o nome no `href` e um destino.
- **Testes:** unitário sobre `dataGaps` (o `href` de cada dica) e verificação da tabela de
  aliases da web.
- **Estado:** `BACKLOG` — depende da decisão de produto acima, tal como `AUD-011`.

#### AUD-014 · Um lembrete sem condição é aceite e nunca dispara — A1 · P1 · `DONE`

- **Descrição (medida pela fronteira HTTP, não inferida — descoberta durante `TEST-001`):**
  `createReminder` tem duas guardas que deviam recusar um lembrete sem condição:

  ```ts
  if (input.trigger !== 'time' && input.dueOdometerKm === null && input.intervalKm === null) { … }
  if (input.trigger !== 'distance' && input.dueDate === null && input.intervalMonths === null) { … }
  ```

  `dueDate`, `dueOdometerKm`, `intervalMonths` e `intervalKm` são `.nullish()` no contrato
  (`contracts.ts:592-595`), pelo que um campo **ausente** chega ao serviço como `undefined` — e
  `undefined === null` é **falso**. As guardas só disparam quando o cliente envia `null`
  **explícito**, que não é o que um cliente real envia: omitir o campo é a forma normal de dizer
  «não tenho isto». Medido em `test/reminders-http.test.ts`:

  | `POST /api/v1/reminders` | esperado | observado |
  | --- | --- | --- |
  | `{vehicleId, title, trigger:'time'}` | 422 | **201** — `dueDate: null`, `intervalMonths: null` |
  | `{vehicleId, title, trigger:'time', dueDate: null}` | 422 | 422 ✅ |
  | `{vehicleId, title, trigger:'distance'}` | 422 | **201** — sem alvo nem intervalo |

  O lembrete criado fica com `evaluation.state === 'unknown'` e o resumo «Sem dados suficientes
  para calcular» — **para sempre**. Não tem data nem quilometragem, logo nunca sai de `unknown` e
  nunca dispara; o utilizador vê um lembrete que promete avisar e não avisa, e nada no ecrã
  explica porquê. A mesma família de `AUD-002`/`AUD-008`: uma omissão que degrada em silêncio.
- **Objetivo:** a guarda recusa as **duas codificações do mesmo pedido inválido** — campo ausente
  **e** `null` explícito —, porque são a mesma intenção do cliente.
- **Dependências:** — (`TEST-001` escreveu o teste que o expôs)
- **Critérios de aceitação:**
  - um lembrete por tempo sem data e sem intervalo é recusado com **422**, quer o campo venha
    ausente, quer venha `null`;
  - o mesmo para um lembrete por quilometragem sem alvo e sem intervalo;
  - um lembrete **válido** continua a ser criado (sem regressão em `TEST-001`);
  - o teste que fixa isto falha contra a implementação anterior (provado por mutação).
- **Testes:** `apps/api/test/reminders-http.test.ts` (§4, as duas linhas do `it.each`).
- **Ficheiros:** `apps/api/src/services/reminders.ts:79-86`.
- **Nota:** a correção é **local** a `createReminder`. `updateReminder` não tem guarda nenhuma e
  **não** é tocado aqui — é o `PC-31`, com tarefa própria (`AUD-015`). Fechar só a porta da frente
  e deixar a de trás aberta seria pior do que documentar as duas.

**Implementação e provas (A1, 2026-09-22):**

- **Correção:** as duas guardas passaram a usar um auxiliar `ausente()` que verifica
  `=== null || === undefined` — a forma que `services/shared.ts:189` já usava. As mensagens de erro
  não mudaram. **Nenhuma outra operação foi tocada** (o `PATCH` é o `AUD-015`).
- **Testes:** `test/reminders-http.test.ts` — duas entradas novas no `it.each` de validação (as
  variantes com `null` **explícito**, para fixar as duas codificações do mesmo pedido inválido) e
  dois testes positivos que provam que a guarda **não** é demasiado larga: um lembrete por tempo
  cuja condição é só `intervalMonths` (e a data é materializada a partir de hoje) e um por
  quilometragem cuja condição é só `intervalKm`.
- **Prova por mutação:** com `ausente()` reduzido a `value === null`, o ficheiro passa a
  **3 vermelhos / 44 verdes** — e são precisamente os dois casos de campo **omitido** (mais o teste
  que conta o que ficou gravado). As variantes com `null` explícito continuam **verdes**, o que
  mostra que o teste distingue as duas codificações em vez de as confundir. Ficheiro reposto e
  confirmado por `sha256` (`5793e08b…`).
- **Commit:** `ef0ebf6` — incluída na release publicada (árvore limpa; deixou de estar só no working tree).

> **Correção de um falso verde, em `AUD-015` (2026-09-22):** o teste positivo do intervalo em km
> (`:239`) afirmava o `status` e o `intervalKm`, nunca o `dueOdometerKm` — e o lembrete criado tinha
> `dueOdometerKm: null` e `state: 'unknown'`, porque o veículo não tinha quilometragem de partida.
> Passava a fixar como esperado exatamente o estado que `AUD-015` veio eliminar. Corrigido em
> `AUD-015`, com o veículo a ter odómetro e a asserção sobre o **alvo**. **A alegação do teste não
> mudou** — a guarda não é demasiado larga; o que estava errado era a montagem.

#### AUD-015 · `PATCH /reminders/:id` aceita um estado sem condição — A1 · P2 · `DONE`

- **Descrição (verificada por leitura do contrato e do serviço; descoberta em `AUD-014`):**
  `createReminder` tem (mesmo avariada) uma guarda de condição; `updateReminder`
  (`services/reminders.ts:217-236`) escreve os campos que recebe sem verificar o **resultado**.
  `zReminderUpdateRequest` é `zReminderCreateRequest.partial()` (`contracts.ts:604`), pelo que
  todos os campos são opcionais e `null` é aceite: `PATCH /reminders/:id` com `{dueDate: null}`
  sobre um lembrete por tempo sem `intervalMonths` deixa-o no estado exato que `AUD-014` passou a
  recusar na criação.
- **Objetivo:** o resultado de uma edição passa a ser validado como o de uma criação — a
  invariante é sobre o **estado final**, não sobre o pedido.
- **Dependências:** `AUD-014` (a guarda tem de existir antes de ser partilhada; as duas correções
  devem usar a **mesma** função de validação, não duas cópias).
- **Critérios de aceitação:**
  - `PATCH` que deixaria o lembrete sem condição devolve **422** e **não** grava;
  - um `PATCH` que mantém uma condição válida continua a passar;
  - a validação é **uma só** função, usada por `createReminder` e `updateReminder`.
- **Testes:** `apps/api/test/reminders-http.test.ts` (secção de edição).
- **Ficheiros:** `apps/api/src/services/reminders.ts:217-236`, `packages/shared/src/contracts.ts:604`.
- **Nota:** `P2` e não `P1` porque exige um pedido deliberadamente construído para chegar ao
  estado inválido, enquanto `AUD-014` acontece com um cliente normal que omite um campo.

**Implementação e provas (A1, 2026-09-22) — `DONE`:**

- **Correção:** `createReminder` e `updateReminder` passam a partilhar **uma só** função,
  `assertCondicao` (`services/reminders.ts:602`), que decide pelo **alvo** que fica gravado
  (`dueDate` / `dueOdometerKm`) e não pelo campo do pedido. Na edição, o estado validado é o
  **resultado** — cada campo vale o que o pedido traz ou o que já lá estava quando o pedido o omite.
  A escrita passou a estar dentro de `try/catch` com `translatePrismaError`, como na criação.
  `packages/shared/src/contracts.ts` **não** foi tocado: `zReminderUpdateRequest.partial()` **não é
  o defeito** — alterá-lo tornaria o `null` inválido para todos os campos, incluindo os que nada têm
  a ver com a condição.
- **A premissa era maior do que a tarefa.** Ao verificar a criação para a poder partilhar, mediu-se
  que a guarda de `AUD-014` testava o **pedido** *antes* de o intervalo ser materializado:
  `POST {trigger:'distance', intervalKm:N}` num veículo **sem odómetro** devolvia **201** com
  `dueOdometerKm: null` e `state: 'unknown'` — o estado exato que `AUD-014` veio eliminar. Pior: o
  teste positivo que `AUD-014` acrescentou fixava-o como esperado (afirmava o `intervalKm`, nunca o
  alvo) — um **falso verde introduzido pela própria correção**. Ver a nota de correção em `AUD-014`.
- **Decisão de política (do utilizador, não inferida):** esse pedido passa a devolver **422** e a
  não persistir. Consequência declarada: o comportamento da **criação** muda neste caso e o teste
  positivo de `AUD-014` foi corrigido (o veículo passa a ter odómetro e a asserção passa a ser sobre
  o **alvo**). **A alegação do teste mantém-se** (a guarda não é demasiado larga); muda a montagem.
- **Testes:** `test/reminders-http.test.ts` — **47 → 53**. Um caso novo de recusa na criação e uma
  secção `§1b` de edição com **cinco** testes (apagar a data, apagar o alvo e trocar o `trigger`:
  422 **e** não grava; manter a condição e não tocar nela: 200).
- **Prova por mutação — 3 mutações, todas sobre o serviço, repostas e confirmadas por `sha256`:**

  | Mutação | O que faz | Resultado | O que prova |
  | --- | --- | --- | --- |
  | M1 | a edição volta a não validar | **3 vermelhos** | os testes de edição **mordem** |
  | M2 | a criação volta a validar o **pedido** | **1 vermelho** | é a validação sobre o **alvo materializado** que a faz passar |
  | M3 | a edição valida **depois** de gravar | **3 vermelhos** | a **ordem** importa: o `422` mantém-se e falha a asserção «não grava» (`expected null to be '2026-12-01'`) |

  O ficheiro ficou **byte a byte** igual ao original (`sha256 e4f46c21…`).
- **Verificações:** suíte da API **44 ficheiros / 1 713 testes**, exit 0 (1 707 + os 6 novos);
  `typecheck` exit 0; `verify:config` **12/12**; `verify` **235**; `verify:regressions` **70**. Nesta
  execução **não** se observou o `EBUSY` de `PC-26`.
- **Limitações (declaradas):** (a) **`PC-15` continua aberto** — o `typecheck` do projeto exclui
  `**/*.test.ts`; o ficheiro de teste foi verificado com um `tsconfig` restrito, **fora do
  repositório**, e só aparece o `TS2322` pré-existente de `appPrisma = prisma;` (`:76`); (b) a
  **assimetria criação/edição** — a edição **não** materializa intervalos, ao contrário da criação,
  pelo que `PATCH {dueDate: null}` sobre um lembrete com `intervalMonths` é recusado — é uma escolha
  de política de A1, conservadora, **não** confirmada pelo utilizador; (c) `records-compliance.ts`
  **não** foi tocado nem medido — ver `PC-39`; (d) o `trigger: 'both'` exige os dois alvos na
  criação, embora `evaluateReminder` aceite um só — restrição **anterior** a este trabalho,
  **preservada de propósito**, para não misturar uma decisão de produto com uma correção de
  invariante; fica registada para decisão.
- **Achados novos registados:** `PC-39` (a edição de um registo de manutenção grava `null` sobre a
  condição do lembrete ligado, por um caminho que **não** passa por `updateReminder` — **por leitura,
  não medido**) e `PC-40` (o formulário de lembretes da web produz, por omissão, um pedido que a API
  passou a recusar — frente de A3).
- **Commit:** `ef0ebf6` — incluída na release publicada (consolidação de produto web, OAuth, agendador e documentos).

### 5.2 Identidade, autenticação e conta (A2)

#### AUTH-001 · Transporte de email real + `setEmailSender` — A2 · P0 · `DONE`

- **Descrição:** `setEmailSender` (`services/email.ts:68`) **não tem um único chamador em  
  produção**; só `sendEmail` é usado. O remetente é sempre o no-op, pelo que o link de  
  reposição de password fica no log. Quem se esquece da password fica **permanentemente  
  excluído** — o único defeito da auditoria que inutiliza a conta.
- **Objetivo:** entrega real de email, ligada por `setEmailSender`.
- **Restrição — SMTP de produção intocável:** esta tarefa é de **ligação**, não de configuração. A configuração SMTP de produção existente **não** é alterada, removida nem substituída; o desenvolvimento e os testes correm **sem** tocar no servidor real (transporte simulado ou servidor local). Nenhum email é enviado a endereços reais a partir de ambiente de desenvolvimento. Qualquer alteração a credenciais, servidor ou portas de produção é uma tarefa separada, com autorização própria.
- **Dependências:** —
- **Critérios de aceitação:**
  - existe um `EmailSender` real registado com `setEmailSender` no arranque;
  - a configuração SMTP ausente degrada para o comportamento atual (log), sem quebrar;
  - nenhum segredo é persistido ou registado em claro;
  - **a configuração SMTP de produção fica exatamente como está** — o `diff` não a toca;
  - a reposição de password entrega o link a um endereço real;
  - teste cobre: envio com sucesso, falha do servidor SMTP, configuração ausente.
- **Testes:** `email.test.ts`, `smtp.test.ts` (existentes) + teste de arranque — todos com transporte simulado, **nunca** contra o servidor de produção.
- **Ficheiros:** `services/email.ts:68`, `core/config.ts` (bloco SMTP), `server.ts`.
- **Nota:** `OPERATIONS.md` §3.4.1 já dá a receita exata — a lacuna é de **ligação**, não de  
  desenho.
- **Verificação A4 (`PROD-003`, 2026-09-22) — não é uma alteração de estado, é uma observação  
  para A2 confirmar:** a ligação **parece já existir**. `registerEmailSender()`  
  (`services/email.ts:181`) é chamada no arranque (`app.ts:438`, dentro de `logStartup()`),  
  escolhe `SmtpEmailSender` quando `config.email.enabled && host`, e **recusa arrancar em  
  produção** sem entrega (salvo `EMAIL_ALLOW_LOG_TRANSPORT=true`), degradando para  
  `ConsoleEmailSender` fora de produção. Os critérios 1, 2 e 3 desta tarefa parecem cumpridos.  
  O que continua **sem prova** é o critério "a reposição de password entrega o link a um  
  endereço real" — exige um servidor SMTP, e essa prova é de A2, não de A4. Registado em  
  `PC-12`. **A4 não altera o estado desta tarefa**: é de A2.
- **Fecho A2 (2026-09-22) — `DONE`.** A tarefa estava satisfeita **antes** de o ROADMAP ser  
  escrito: a ligação foi implementada em `1eac3a7` (2026-09-20, *"P0: recuperação de password  
  com email real e interface completa"*), já publicado em `origin/main`. A descrição original  
  desta entrada («`setEmailSender` não tem um único chamador em produção») descrevia o estado  
  **anterior a `1eac3a7`** — ver `PC-12` e `PC-14`.
- **Implementação (pré-existente; A2 não alterou código nesta tarefa):** `registerEmailSender()`  
  (`services/email.ts`) escolhe `SmtpEmailSender` quando há `SMTP_HOST`, recusa arrancar em  
  produção sem entrega (salvo `EMAIL_ALLOW_LOG_TRANSPORT=true`) e degrada para  
  `ConsoleEmailSender` fora de produção; é chamado por `logStartup()` (`app.ts`), invocado por  
  `server.ts` **antes** de a porta abrir. `services/smtp.ts` (cliente próprio, sem dependências  
  novas), `core/email-address.ts` (regra de endereçamento partilhada pelo envio **e** pela  
  validação), `core/config.ts` (`validateMailConfig`). **O `diff` de A2 em código é zero.**
- **A prova que A4 registou como em falta** (critério «a reposição de password entrega o link a  
  um endereço real») **existe e foi corrida:** `test/password-reset-integration.test.ts` sobe um  
  servidor SMTP **local** numa porta efémera (`127.0.0.1`, porta pedida ao sistema), define  
  `SMTP_HOST`/`SMTP_PORT` antes do import de `core/config.ts`, registra o transporte **real** por  
  `registerEmailSender()` e afirma sobre os **bytes recebidos** — não sobre um duplo. Sem servidor  
  de produção e sem endereços reais. Assere: `activeEmailSender().transport` contém `SMTP`; o  
  envelope `to` é o endereço da conta; o corpo contém o link; o link serve **uma só vez**.
- **Testes (medidos, exit 0):** 93 verdes em 6 ficheiros — `email.test.ts` 12, `smtp.test.ts` 12,  
  `email-address.test.ts` 25, `password-reset.test.ts` 19, `password-reset-integration.test.ts` 3,  
  `email-verification.test.ts` 22. `typecheck` API, web e shared: exit 0.
- **Prova por mutação — 3 mutações, todas repostas e confirmadas por hash (`66eefbd1…`):**
  - **M1** — `redactResetLinks` → identidade: **4 testes falham** em `email.test.ts`, incluindo a  
    asserção central «O token de recuperação chegou ao log». A redação **morde**.
  - **M3** — `registerEmailSender` nunca escolhe SMTP (`if (false && enabled && host)`): o teste  
    de integração **falha** com «A configuração de SMTP não foi aplicada…». A escolha **morde**.
  - **M2** — recusa de produção desativada (`if (false && config.isProduction && …)`): a suíte  
    **completa** passa (35 ficheiros / 1478 testes, exit 0). **Não morde** — é a lacuna que  
    justifica `AUTH-008` e o `PC-14`. Confirmado por `grep` que **nenhum** teste corre com  
    `NODE_ENV=production` (todos forçam `'test'`), logo o ramo é inalcançável na suíte.
  - O ramo em si está **correto**: sonda direta em `NODE_ENV=production` sem SMTP lança com a  
    mensagem esperada; com `EMAIL_ALLOW_LOG_TRANSPORT=true` degrada para `ConsoleEmailSender`  
    (`delivers: false`) com aviso. É **cobertura em falta, não defeito**.
- **Critérios de aceitação:** os seis cumpridos. O quarto — «a configuração SMTP de produção fica  
  exatamente como está» — verifica-se por `git status`: nenhum ficheiro de configuração  
  (`apps/api/.env`, `.env.example`) foi tocado, e não houve alteração a credenciais, servidor ou  
  portas.
- **Trabalho derivado (novas tarefas):** `AUTH-008` (testar a recusa de produção), `AUTH-009`  
  (documentação da entrega). A restrição de SMTP de produção **mantém-se**: qualquer alteração a  
  credenciais é tarefa separada, com autorização própria.
- **Commit:** `ef0ebf6` — incluída na release publicada (consolidação de produto web, OAuth, agendador e documentos).

#### AUTH-002 · Login Google (OAuth) — A2 · P1 · `DONE`

> **Aviso de A1 (2026-09-22, 11:47) — RESOLVIDO.** O `ReferenceError` de `config.ts:345` era um **estado misto de `PC-20`**: o corpo que usa `API_BASE_PATH` sobreviveu e o `import` que o acompanha foi revertido por uma escrita concorrente. O `import` foi reposto por A2 na mesma sessão, a suíte da API voltou a arrancar (**43 ficheiros / 1700 testes / 0 falhas**, exit 0) e `PC-27` está **fechado**. A observação de A1 foi o que tornou visível uma reversão que, de outra forma, só apareceria mais tarde como falha de tipo.


- **Descrição:** `config.federatedLogin.google` existe e reporta estado no arranque, mas **não  
  há rota nem serviço**. Nada do fluxo está implementado. Verificado por A2 em 2026-09-22 antes  
  de começar: `grep` de `oauth|OAuth|googleId|id_token|idToken` em `apps/api/src`,  
  `packages/shared/src` e `apps/web/src` devolve **apenas textos de interface** — o botão  
  «Entrar com Google» em `LoginPage.tsx:166` e `SignUpPage.tsx:174` está desativado e diz,  
  honestamente, que exige credenciais OAuth no servidor. O único código é  
  `core/config.ts:238,264,306,344`. **`.env` configurado não é funcionalidade existente.**
- **Objetivo:** um utilizador pode criar conta e entrar com Google, com a identidade validada  
  pelo servidor antes de qualquer confiança nos claims.
- **Dependências:** `AUTH-001` (**`DONE`** — a fila de email está fechada).

##### Decisões de produto fechadas (2026-09-22, pelo utilizador)

Estas quatro decisões foram levantadas por A2 **antes** de escrever código, porque mudam os  
critérios de aceitação e o desenho. Ficam registadas com o que foi **recusado**, para que a  
alternativa não seja reaberta por engano.

| # | Decisão | Escolhido | Recusado, e porquê |
| - | ------- | --------- | ------------------ |
| D1 | Implementação do protocolo | **`openid-client`** (biblioteca) | Implementar à mão (0 dependências). Recusado: a validação de assinatura/JWKS é onde os erros são **silenciosos**, e o custo de os cometer é tomada de conta. Nota: `jose@5` já era dependência (`services/tokens.ts`), mas o `openid-client@6` traz o seu próprio `jose@6` — ver §7 e §6 |
| D2 | Conta inexistente | **Criar automaticamente** | Exigir registo prévio. Recusado: contraria a expectativa normal de quem carrega em «Entrar com Google», e a Google já verificou o endereço |
| D3 | Fronteira de âmbito | **`AUTH-002` só trata conta nova e login** | Incluir já o caso do email existente. Recusado: juntaria a decisão de **maior risco de segurança** (associar automaticamente) numa tarefa que hoje não exige revisão adversarial de A1 — e sem essa revisão `AUTH-003` não fecha |
| D4 | Identificador federado | **`@@unique([authProvider, authProviderId])` + migration** | Só verificação aplicacional. Recusado como garantia única: fica sujeito a corrida entre dois pedidos simultâneos e não há garantia estrutural — a proteção passaria a depender de o código estar sempre certo |

**Fronteira explícita `AUTH-002` ↔ `AUTH-003`** (D3):

- **`AUTH-002` faz:** OAuth/OIDC com Google; identidade Google já associada → início de sessão;  
  identidade Google sem conta → **criação automática** da conta com a identidade associada.
- **`AUTH-002` NÃO faz:** associação automática a uma conta local existente **por coincidência de  
  email**. Se o email do `id_token` já pertencer a uma conta local, `AUTH-002` **recusa** e  
  encaminha para `AUTH-003`, em vez de ligar em silêncio.
- **`AUTH-003` faz:** ligação explícita de uma identidade Google a uma conta Zemlo já existente,  
  incluindo o caso do email coincidente, com fluxo seguro e informado.

##### Critérios de aceitação

- o utilizador inicia a autenticação Google pelo servidor; o `client_secret` **nunca** chega ao  
  cliente;
- `state` é associado ao pedido/sessão e **validado** no callback; um `state` ausente,  
  desconhecido, reutilizado ou expirado é recusado;
- `nonce` é enviado e verificado contra o `id_token`;
- a troca do `code` acontece **no servidor**, no token endpoint, e o `redirect_uri` é  
  **exatamente** o configurado — sem derivação a partir de cabeçalhos do pedido;
- o `id_token` é validado quanto a: assinatura (via JWKS do emissor, com cache e rotação),  
  `issuer`, `aud`/client ID, `exp`/`iat` com tolerância, e `nonce`;
- **nenhum claim é lido antes da validação** — nem o email, nem o `sub`;
- conta inexistente: criada automaticamente, com `emailVerified` herdado da verificação da  
  Google, e a identidade federada associada na **mesma** operação;
- email do `id_token` já pertencente a uma conta local: **recusa explícita** que encaminha para  
  `AUTH-003`; nunca associação implícita;
- duas contas nunca partilham o mesmo par `(authProvider, authProviderId)` — garantido por  
  **constraint** (D4), não só por consulta;
- os tokens/sessão obedecem a A23 (refresh devolvido **e** rodado) e A24 (autenticação por  
  rota exata);
- falhas de OAuth devolvem o envelope de erro único (A11), **nunca** uma exceção nem um  
  redirecionamento com detalhe interno;
- nenhum segredo fica persistido em claro (A12) e nenhum aparece em log;
- sem Google configurado, os endpoints respondem de forma honesta e o arranque **não** rebenta;
- a configuração de produção está documentada (`OPERATIONS.md`);
- testes cobrem sucesso e falhas (estado inválido, estado reutilizado, `nonce` errado, token  
  expirado, emissor errado, `aud` errado, assinatura inválida, email já existente);
- `docs/API.md` atualizado com os novos endpoints.

##### Contrato e base de dados

- **Contrato partilhado (§6):** novos esquemas em `packages/shared/src/contracts.ts`. Impacto  
  declarado em §6 **antes** da alteração — ver aí o registo de `AUTH-002`.
- **Base de dados (§7):** alteração de schema registada em §7 —  
  `@@unique([authProvider, authProviderId])`, migration própria, impacto PostgreSQL e SQLite,  
  `db:sync-schema` e compatibilidade.

##### Ficheiros prováveis

`apps/api/src/services/oauth.ts` (novo), `apps/api/src/http/routes/auth.ts`,  
`apps/api/src/core/config.ts`, `apps/api/src/services/auth.ts` (reutilizar `createSession`),  
`packages/shared/src/contracts.ts`, `apps/api/prisma/schema.prisma` + migration,  
`docs/API.md`, `docs/OPERATIONS.md`.

##### Testes / validação prevista

Um **fornecedor OIDC falso** local (JWKS e token endpoint próprios, com chaves geradas no  
teste), pela mesma razão que `password-reset-integration.test.ts` levanta um servidor SMTP real  
num porto efémero: a propriedade que interessa — «uma assinatura inválida é recusada» — **não é  
observável** contra um duplo que devolve `true`. Cada validação (assinatura, `iss`, `aud`, `exp`,  
`nonce`, `state`) tem de ser provada por **mutação**: desativá-la tem de fazer falhar pelo menos  
um teste. Testes que passem por vacuidade não contam.

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

#### AUTH-003 · Associação de conta Google a conta existente — A2 · P1 · `BACKLOG`

- **Descrição:** o caso difícil do login federado: já existe uma conta com o mesmo email.
- **Fronteira com `AUTH-002` (fechada em 2026-09-22, decisão D3):** `AUTH-002` **recusa**  
  explicitamente associar a uma conta local por coincidência de email — encaminha para aqui. A  
  ligação explícita, incluindo o caso do email coincidente, é **só** desta tarefa. O que  
  `AUTH-002` faz na sua fronteira está enumerado em §5.2.
- **Objetivo:** associar sem duplicar e sem permitir tomada de conta.
- **Dependências:** `AUTH-002` — **satisfeita** (AUTH-002 → `DONE` em 2026-09-22). A tarefa
  continua em `BACKLOG` por **não** ter ainda o detalhe prévio da §1.2 completo nem a revisão
  adversarial exigida abaixo: `BACKLOG` é o estado honesto enquanto falta corpo, e não uma
  dependência externa (§1.2, `PC-37`).
- **Critérios de aceitação:**
  - conta existente com email **verificado** pode ser associada;
  - conta existente com email **não verificado** não é tomada silenciosamente;
  - duas contas nunca partilham o mesmo identificador federado;
  - o utilizador é informado do que aconteceu;
  - teste cobre os três casos.
- **Risco de segurança:** esta é a tarefa com maior potencial de tomada de conta. Exige  
  revisão de A1 (`TEST-` / revisão adversarial) antes de fechar.

#### AUTH-004 · Gestão de sessões na conta — A2 · P2 · `BACKLOG`

#### AUTH-005 · Revisão do 2FA e dos códigos de recuperação — A2 · P2 · `BACKLOG`

#### AUTH-006 · Perfil e preferências de conta — A2 · P2 · `BACKLOG`

#### AUTH-007 · Alteração de email com reverificação — A2 · P3 · `BACKLOG`

*(Descrição, critérios e testes a detalhar antes de começar — §1.2. Nenhuma destas está  
`READY`; existem para que o trabalho não apareça por surpresa dentro de outra tarefa.)*

#### AUTH-008 · Cobrir a recusa de arranque em produção sem entrega — A2 · P2 · `DONE`

- **Descrição:** `registerEmailSender()` (`services/email.ts:194`) recusa arrancar em produção sem  
  SMTP configurado, salvo `EMAIL_ALLOW_LOG_TRANSPORT=true`. **Nenhum teste cobre esse ramo:**  
  `grep` de `NODE_ENV` em `apps/api/test/` mostra que todos forçam `'test'`, e nenhum ficheiro  
  menciona `EMAIL_ALLOW_LOG_TRANSPORT`. Provado por mutação em `AUTH-001` (mutação M2): desativar  
  o guarda (`if (false && …)`) deixa a suíte **completa** verde — 35 ficheiros / 1478 testes,  
  exit 0. Registado em `PC-14`.
- **Objetivo:** o guarda que impede uma produção de arrancar a escrever links de recuperação no  
  log tem de ser vigiado por um teste que **morda**.
- **Dependências:** — (deriva de `AUTH-001`)
- **Critérios de aceitação:**
  - existe teste que corre com `NODE_ENV=production` e sem `SMTP_HOST`;
  - sem `EMAIL_ALLOW_LOG_TRANSPORT`, `registerEmailSender()` **lança**;
  - com `EMAIL_ALLOW_LOG_TRANSPORT=true`, **não** lança, devolve `delivers: false` e avisa;
  - **prova por mutação:** desativar o guarda faz o teste falhar (hoje **não** faz).
- **Nota de execução:** `core/config.ts` lê o ambiente **no import**, pelo que a variável tem de  
  estar definida antes do import — a mesma restrição que `DATABASE_URL`/`SMTP_HOST` já impõem às  
  outras suites. Em `NODE_ENV=production` a configuração exige também um `JWT_SECRET` válido. Não  
  editar `test/email.test.ts` sem coordenar com A1 (`AUD-004`; §8.1): o sítio natural é um  
  ficheiro **novo**.
- **Ficheiros:** novo `apps/api/test/email-startup.test.ts` (ou equivalente).
- **Fecho A2 (2026-09-22) — `DONE`.** Criado **`apps/api/test/email-startup.test.ts`** (ficheiro  
  novo, 7 testes). O ficheiro corre em `NODE_ENV=production` com `SMTP_HOST=''`, definido **antes**  
  do import de `core/config.ts` — a mesma restrição que as outras suites já impõem. A **primeira**  
  asserção é anti-vacuidade: `config.isProduction === true` e `config.email.enabled === false`.  
  Sem ela, um Vitest que impusesse `NODE_ENV=test` faria o resto passar sem exercer o ramo —  
  exatamente a forma de falhar que `PC-15` descreve.
- **Cobertura:** recusa arrancar; a mensagem nomeia `SMTP_HOST` **e** `EMAIL_ALLOW_LOG_TRANSPORT=true`;  
  com a escapatória, arranca com `delivers: false`, `transport` de log e `describeEmail()` a dizer  
  «entrega por email inativa»; o aviso de arranque é emitido; e um valor **diferente** de `true`  
  (`1`) continua a recusar.
- **Prova por mutação:** aplicada a mutação M2 outra vez (`if (false && config.isProduction && …)`)  
  e corrida **apenas** esta suite — **3 testes falham, exit 1**. Reposta de imediato e confirmada  
  por hash. O teste **morde**.
- **Validação:** 7/7 verdes (exit 0); com `email.test.ts` e `smtp.test.ts`, 31/31; `typecheck` da  
  API exit 0; e — porque `tsconfig.json` exclui `**/*.test.ts` (`PC-15`) — um `tsc --noEmit`  
  **explícito** sobre o ficheiro novo, com as opções de `tsconfig.base.json`, exit 0.
- **Commit:** `ef0ebf6` — incluída na release publicada (consolidação de produto web, OAuth, agendador e documentos).

#### AUTH-009 · Documentação da entrega de email — A2 · P3 · `DONE`

- **Descrição — três textos que descrevem mal o que existe (ver `PC-19`):**
  1. `services/email.ts` afirma, em dois docblocks, que a chave `text` está em `SENSITIVE_KEYS` e  
     que é isso que protege o corpo. **É falso:** `'text'` nunca esteve nessa lista (`git log -S`  
     não encontra introdução nenhuma), e se estivesse o valor inteiro seria substituído por  
     `[redigido]` — contradizendo o teste que exige a mensagem legível. A única proteção real é  
     `redactResetLinks()`, aplicada pelo próprio sender.
  2. `OPERATIONS.md` §3.4.1 diz que é «obrigatório ligar um transporte real — implementar  
     `EmailSender` … e registá-lo com `setEmailSender`» — trabalho **já feito** — e mostra o log  
     com a chave `body`, que era **o defeito corrigido** em `1eac3a7`.
  3. `EMAIL_ALLOW_LOG_TRANSPORT` não aparece em `OPERATIONS.md`: a escapatória que permite  
     arrancar em produção sem entrega é invisível para quem opera.
- **Objetivo:** a documentação da entrega de email descreve o que o código faz.
- **Dependências:** —
- **Critérios de aceitação:** os três pontos corrigidos; nenhuma capacidade pronta descrita como  
  inexistente; a escapatória documentada **com o aviso** do que se perde ao usá-la.
- **Testes:** não aplicável (documentação). Verificar por leitura contra o código.
- **Nota:** a §3.4.1 de `OPERATIONS.md` é de A2; **não** tocar na §9 (é de `AUD-009`, A1).
- **Fecho A2 (2026-09-22) — `DONE`.** Os três textos corrigidos:
  1. **`services/email.ts`** — o docblock do `ConsoleEmailSender` deixa de afirmar que `text` está  
     em `SENSITIVE_KEYS`. Passa a dizer o que é verdade: o nome descreve o valor e **não** é a  
     proteção; o redator substitui o **valor inteiro** de uma chave que reconheça, pelo que pôr  
     `text` na lista apagaria a mensagem e contradiria o teste que exige a mensagem legível; a  
     proteção real é o `redactResetLinks()`. Fica escrito que **não há** defesa em profundidade por  
     nome de chave — para não ser reinventada por quem lá mexer a seguir.
  2. **`OPERATIONS.md` §3.4.1 reescrita** — a entrega **está** implementada (`registerEmailSender()`  
     no arranque, antes de a porta abrir), com tabela de variáveis (`SMTP_HOST`; `SMTP_PORT` —  
     `465` é TLS implícito, `587`/`25` negociam `STARTTLS`; `SMTP_USER`/`SMTP_PASSWORD`;  
     `SMTP_FROM`), a validação no arranque (A30), e o log do fallback com a chave **correta**  
     (`text`) e `token=[redigido]` em vez do `body` que era o defeito.
  3. **`EMAIL_ALLOW_LOG_TRANSPORT` documentada** — com o aviso do que se perde ao usá-la e a nota de  
     que só o valor exato `true` é aceite.
- **Validação:** comentários não alteram comportamento — confirmado por `typecheck` da API exit 0 e  
  pelas suites de email/SMTP (31/31, exit 0). O hash de `services/email.ts` passa a `58345a66…`; o  
  `66eefbd1…` citado em `PC-14` e no fecho de `AUTH-001` refere-se ao conteúdo **anterior** a esta  
  tarefa, e continua a ser o valor correto para a reposição da mutação M2.
- **Commit:** `ef0ebf6` — incluída na release publicada (consolidação de produto web, OAuth, agendador e documentos).

### 5.3 Web (A3)

#### WEB-001 · Ecrã "Esqueci-me da password" — A3 · P0 · `DONE`

- **Bloqueada por:** `AUTH-001` — confirmado em 2026-09-22: `setEmailSender`
  (`services/email.ts:115`) continua **sem um único chamador em produção** (`grep` em
  `apps/api/src/` devolve só a definição). O ecrã existe e está correto; o que falta é a
  entrega. Enquanto isso, o ecrã promete um email que fica no log.
- **Descrição (corrigida em 2026-09-22 — a anterior estava errada):** ao contrário do que aqui
  estava escrito, **o ecrã existe e está implementado**. `ForgotPasswordPage.tsx` (170 linhas),
  rota `/recuperar-password` em `App.tsx:57-60`, cliente em `api/client.ts:503`, ligação no
  rodapé do login. O `grep` de `password-reset|Esqueci|forgot` em `apps/web/src/` devolve
  **10** ocorrências, não zero. A auditoria que originou esta tarefa verificou a API e não
  verificou a web.
- **Critérios:** pedido por email; resposta **não** revela se o email existe (evitar  
  enumeração de contas); estado de sucesso claro; erro tratado. — **todos cumpridos no ecrã**;
  falta a validação ponta a ponta, que depende de `AUTH-001`.
- **Fecho (2026-09-22, A9 — segunda consolidação):** o bloqueio era `AUTH-001`, que está **`DONE`**
  (entrega de email implementada, escolha de transporte e recusa em produção provadas; `PC-14`
  fechado). O ecrã existe, está encaminhado em `/recuperar-password` e os critérios estão cumpridos
  no ecrã; a validação ponta a ponta do lado da API é `password-reset-integration.test.ts`, que
  levanta um servidor SMTP real. **Limitação registada:** não existe teste automático sobre este
  ecrã — a prova é documental (código e rotas verificados) mais a prova da API. **Não reimplementar.**
  que falta é **muito menor** do que a descrição anterior sugeria. Não reimplementar o ecrã.

#### WEB-002 · Ecrã de reposição de password — A3 · P0 · `DONE`

- **Bloqueada por:** `WEB-001`.
- **Descrição (corrigida em 2026-09-22):** também **já existe** — `ResetPasswordPage.tsx`
  (262 linhas), rota `/repor-password` (`App.tsx:61-64`), cliente em `api/client.ts:508`.
- **Critérios:** aceita o token do link; valida a nova password pelas mesmas regras do registo;  
  trata token expirado/usado com mensagem útil; após sucesso, encaminha para o login. —
  **cumpridos**: distingue token ausente de token recusado, mostra a validade derivada de

- **Fecho (2026-09-22, A9 — segunda consolidação):** o bloqueio (`WEB-001` → `AUTH-001`) está
  resolvido e o ecrã existe em `/repor-password` (`ResetPasswordPage.tsx`, 262 linhas). Mesma
  **limitação registada** de `WEB-001`: sem teste automático sobre o ecrã. **Não reimplementar.**
  `PASSWORD_RESET_TTL_MINUTES`, e encaminha para `/login` com aviso de sessões terminadas.

#### WEB-003 · Documentos: editar metadados + descarregar — A3 · P0 · `DONE`

- **Bloqueada por:** `PROD-001`, `PROD-002` — **parcialmente**: ver a correção abaixo.
- **Descrição (corrigida em 2026-09-22 — a anterior estava errada):** ao contrário do que aqui
  estava escrito, **o `updateDocument` existe** (`api/queries.ts:254`), **o download existe**
  (`api/queries.ts:270`, `useDownloadDocument` em `api/hooks.ts:502`) e a página
  `DocumentDetailPage.tsx` (375 linhas) edita metadados e transfere o ficheiro. A API serve os
  bytes em `GET /documents/:documentId/content` (`http/routes/documents.ts:68,149`) e a lista
  liga ao detalhe.
- **O que continua genuinamente em falta:** o **carregamento** de ficheiros novos
  (`PROD-001`) — o formulário de criação ainda pede um `fileName` escrito à mão e a página diz
  que «o carregamento de ficheiros novos para o armazenamento ainda não está ligado»
  (`DocumentsPage.tsx:104-110`). O download dos bytes (`PROD-002`) está feito do lado da API e
  do cliente.
- **Critérios:** editar metadados pela interface — **cumprido**; descarregar o ficheiro —
  **cumprido**; o texto que promete o botão deixa de estar desatualizado — pendente (`AUD-009`
  e o texto de `VehicleDetailPage`, ver `PC-10`).
- **Fecho (2026-09-22, A9 — segunda consolidação):** os três critérios estão cumpridos — editar
  metadados, descarregar o ficheiro e o texto deixar de estar desatualizado (`AUD-009` fechada,
  `PC-10` fechado). As dependências `PROD-001` e `PROD-002` estão **`DONE`**.
- **O que continua fora desta tarefa, e é decisão de produto:** o **controlo de envio de ficheiros
  na web** não existe — `DocumentsPage.tsx` não tem `<input type="file">` e o seu docblock di-lo
  explicitamente. `PROD-001` fechou o **lado da API** (`POST /documents/:id/content`, §A31); o lado
  da interface nunca foi tarefa de ninguém e continua registado em `AUD-009` como «trabalho novo,
  para decisão de A9». **Não reimplementar o que existe.**
  texto — **não** a interface de edição nem a transferência. Não reimplementar.

#### WEB-004 · Corrigir `/records/:kind` na interface — A3 · P1 · `DONE`

- **Desbloqueada em 2026-09-22 por `AUD-008` (A1).** O fallback silencioso já não existe:
  `/records/<tipo desconhecido>` é recusado de forma visível, com caminho de volta. O que falta é
  o que sempre foi desta tarefa — os **ecrãs** de inspeções, impostos, seguros e odómetro. O
  padrão a seguir já existe no repositório: `RECORD_CONFIG` + `RecordsPage` para a lista, e
  `RecordDetailPage` para o detalhe (que **já** trata os quatro tipos — ver a nota de `AUD-002`).
  Ao acrescentar uma entrada a `RECORD_CONFIG`, a recusa de `AUD-008` deixa de se aplicar a esse
  tipo sem mais nenhuma alteração.
- **Critérios:** ecrãs corretos para inspeções, impostos, seguros e odómetro; sem fallback  
  silencioso. **Os dois cumpridos.**

- **Critérios — cumpridos.** Os quatro ecrãs existem como entradas próprias de `RECORD_CONFIG` em
  `RecordsPage.tsx`: seguros (`:503`), inspeções (`:516`), impostos (`:521`) e odómetro (`:535`),
  cada um com título, coluna de identidade, coluna de data, unidade e estado vazio **do tipo** — e
  nenhum herda o vocabulário de despesas. `configFor` continua a devolver `null` para um tipo
  ausente (`:552-553`), pelo que a recusa de `AUD-008` se mantém: mudou o mapa, não o ramo de
  recusa. `taxes.emptyTitle` é `'Ainda sem impostos'` (`:530`).
- **Testes:** `apps/web/test/records-lists.test.tsx` (**novo**, **15 testes**, 6 grupos) e
  `records-kind.test.tsx` (**7 testes**, ajustado — os quatro tipos deixaram de ser recusados).
  Suíte web **scopeada** (`apps/web/test`): **11 ficheiros / 243 testes / exit 0**, medido por A9
  em 2026-09-23 com `--no-cache --no-file-parallelism`. `typecheck` da web exit 0; `PC-15`
  coberto por `tsconfig` restrito fora do repositório, exit 0.
- **Prova por mutação:** **12/12 mortas** (harness de A3, `.workbuddy-ai/scratch/mutacoes.log`),
  cada uma com o teste que a mata nomeado: repor o fallback de `configFor` mata **3**; remover cada
  entrada do mapa mata **4–5**; desligar `requiresVehicle`, mostrar o filtro de período na
  conformidade, trocar a coluna de data da apólice, o estado vazio dos impostos, o título das
  inspeções, a tradução do resultado e os títulos das conformidades matam **1** cada. Ficheiro
  reposto e confirmado por `sha256` **`c979f917…`**, que é o `sha256` do ficheiro entregue (medido
  por A9): a prova correu sobre o que está no working tree.
- **Limitação de ambiente — não é defeito do produto.** Sem `--no-cache` a suíte web é
  **não-determinista**: a cache de transformação do Vite/vitest serve versões antigas de
  `RecordsPage.tsx` (chegou a servir a versão **pré-`WEB-004`**, com o fallback para despesas) e o
  teste que falha varia entre execuções. Com `--no-cache` os resultados são estáveis e verdes
  (`records-lists` 15/15 e `records-kind` 7/7, repetido). Registado como ambiente.
- **Regressão global:** as falhas do run completo estão **fora** desta frente — ficheiros da API
  que falham por defeito de ambiente (`spawnSync … EBUSY` no `createTestDb`, cliente Prisma não
  gerado, `__vite_ssr_import_meta__.resolve`) e resíduos de harness. **Zero** atribuíveis a
  `WEB-004`.
- **Commit:** **nenhum** — no working tree; aguarda autorização de publicação.

#### WEB-005 · Auditoria de estados (vazio/loading/erro) — A3 · P2 · `DONE`

- **Descrição original:** `EmptyState`/`LoadingBlock`/`InlineError` existem e são usados nas páginas  
  verificadas — mas a auditoria classificou a **completude** no `HomeAssistantPage` como de  
  "média confiança", ou seja, não foi verificada a todas as páginas.
- **Objetivo:** nenhuma página fica em branco, a rodar para sempre, ou sem caminho de saída.
- **Critérios de aceitação:** todas as rotas têm estado vazio, de carregamento e de erro;  
  inventário escrito do que falta; correções aplicadas.
- **Testes:** teste de renderização por rota nos três estados.

**Inventário (2026-09-22).** Leitura de `apps/web/src/App.tsx` e de **cada** página e
componente de estado. 32 `<Route>`, das quais 28 renderizam um ecrã com dados assíncronos.
Legenda: `✓` coberto · `n/a` não se aplica (ecrã sem consulta própria) · `✗` **em falta**.

| Rota | Ecrã | Carreg. | Vazio | Erro | Nota |
| ---- | ---- | ------- | ----- | ---- | ---- |
| `/login` | `LoginPage` | n/a | n/a | ✓ | |
| `/signup` | `SignUpPage` | n/a | n/a | ✓ | |
| `/recuperar-password` | `ForgotPasswordPage` | n/a | n/a | ✓ | confirmação não revela existência da conta |
| `/repor-password` | `ResetPasswordPage` | n/a | ✓ | ✓ | token ausente, expirado/usado, sucesso |
| `/verificar-email`, `/auth/verify-email` | `VerifyEmailPage` | ✓ | n/a | ✓ | |
| `/onboarding/*` | `OnboardingPage` | n/a | n/a | ✓ | |
| `/` | `DashboardPage` | ✓ | ✓ | ✓ | conta sem veículos tem ecrã próprio |
| `/vehicles` | `VehiclesPage` | ✓ | ✓ | ✓ | |
| `/vehicles/new` | `NewVehiclePage` | n/a | n/a | ✓ | |
| `/vehicles/:vehicleId` | `VehicleDetailPage` | ✗ | ✓ | ✗ | **4 separadores sem carregamento nem erro** (D1); `overview` sem erro (D4); `stats` com buraco branco (D3) |
| `/records/:kind` | `RecordsPage` | ✓ | ✓ | ✓ | |
| `/records/reminders` | `RemindersPage` | ✓ | ✓ | ✓ | inclui "sem veículo" |
| `/documents` | `DocumentsPage` | ✓ | ✓ | ✓ | ver `WEB-009` |
| `/documents/:documentId` | `DocumentDetailPage` | ✓ | n/a | ✓ | buraco branco (D3) |
| `/stats` | `StatsPage` | ✓ | ✓ | ✓ | |
| `/timeline` | `TimelinePage` | ✓ | ✓ | ✓ | |
| `/calendar` | `CalendarPage` | ✓ | ✗ | ✓ | **vazio falso durante o erro** (D2) |
| `/notifications` | `NotificationsPage` | ✓ | ✓ | ✓ | |
| `/integrations` | `IntegrationsPage` | ✓ | ✓ | ✓ | |
| `/integrations/home-assistant` | `HomeAssistantPage` | ✓ | ✓ | ✓ | a "média confiança" da auditoria anterior fica **fechada**: está coberto |
| `/export` | `ExportPage` | ✓ | n/a | ✗ | `metrics.isError` sem tratamento (D5) |
| `/import` | `CsvImportPage` | ✓ | n/a | ✓ | fluxo multi-passo; passos recebem dados do pai |
| `/settings` | `SettingsPage` | ✓ | n/a | ✓ | erro do perfil é tratado pelo `RequireSession` — verificado, **sem alteração** |
| `/settings/profile` | `ProfileSettingsPage` | n/a | n/a | ✓ | dados vêm da sessão |
| `/settings/preferences` | `PreferencesSettingsPage` | ✓ | n/a | ✓ | buraco branco (D3) |
| `/settings/security` | `SecuritySettingsPage` | ✓ | ✓ | ✓ | lista de dispositivos: vazio inalcançável (a sessão atual está sempre presente) — verificado, **sem alteração** |
| `*` | `NotFoundPage` | n/a | n/a | n/a | tem caminho de volta |

**Correções necessárias (âmbito desta tarefa).**

- **D1 — falha silenciosa em 4 separadores da ficha do veículo.** `InsuranceTab`,
  `InspectionsTab`, `TaxesTab` e `RemindersTab` (`VehicleDetailPage.tsx:801,~940,~1060,1271`)
  não leem `isLoading` nem `isError`. Se o pedido falhar, o separador fica **vazio** — sem
  mensagem, sem repetição, sem caminho de saída. É o defeito central desta tarefa: é o único
  caso em que um erro do servidor é invisível.
- **D2 — `CalendarGrid` mostra o estado vazio durante o erro.** A condição
  `!isLoading && (data?.entries.length ?? 0) === 0` é verdadeira com `data === undefined`, pelo
  que o erro do `CalendarPage` aparece **acompanhado** de «Nada marcado neste mês» — uma
  afirmação falsa sobre os dados. Além disso, `error` e `onRetry` estão declarados em
  `CalendarProps` e **nunca usados** (props mortas). Corrigir o estado e remover as props.
- **D3 — buracos de ecrã em branco.** `if (!data) return null` em `RecordDetailPage:60`,
  `DocumentDetailPage:112`, `PreferencesSettingsPage:55`, `VehicleDetailPage:153` e `:677`.
  Inalcançável no caminho normal, mas é exatamente o "ecrã em branco" que a tarefa proíbe
  quando o `enabled` está a `false` ou a consulta fica sem dados. Passa a estado explícito.
- **D4 — `OverviewTab` sem estado de erro.** A consulta de estatísticas
  (`VehicleDetailPage.tsx:258`) é renderizada com `dashboard.data ? … : null`: um erro
  desaparece sem deixar rasto.
- **D5 — `ExportPage` sem erro na contagem.** `metrics.isError` não é lido
  (`ExportPage.tsx:280-297`): a secção «O que está a ser exportado» fica só com o título.
- **D6 — verificado e sem alteração.** `SettingsPage` (erro do perfil) e a lista de
  dispositivos de `SecuritySettingsPage` foram analisados e **não** precisam de correção —
  o primeiro é tratado pelo `RequireSession`, o segundo tem um vazio inalcançável. Registado
  para que a próxima auditoria não repita o trabalho.

**Fora de âmbito — registado, não corrigido aqui.** `PC-10` (texto desatualizado em
`VehicleDetailPage`, pertence a `AUD-009`/A1), `WEB-009` (campo duplicado em `DocumentsPage`) e
`PC-17`/`WEB-010` (cabeçalho do calendário — descoberto por causa desta tarefa, mas é defeito de
formatação, não de estado).

**Fecho (2026-09-22) — A3.**

- **Implementado:** as seis correções do âmbito (`D1`–`D5`). `D6` verificado e **sem alteração**.
  O padrão dos quatro separadores e do resumo do ano é sempre o mesmo: o estado alternativo é
  desenhado **dentro** do `role="tabpanel"` com o `id` que o `aria-controls` do separador aponta,
  para que o atributo nunca aponte para um elemento inexistente.
- **Ficheiros alterados** — `git diff --numstat`, 7 ficheiros, **+258 / −11**:

  | Ficheiro                                                  | +/−    |
  | --------------------------------------------------------- | ------ |
  | `apps/web/src/pages/vehicles/VehicleDetailPage.tsx`        | +150/−2 |
  | `apps/web/src/pages/settings/PreferencesSettingsPage.tsx`  | +23/−1  |
  | `apps/web/src/pages/records/RecordDetailPage.tsx`          | +23/−2  |
  | `apps/web/src/pages/DocumentDetailPage.tsx`                | +22/−1  |
  | `apps/web/src/components/CalendarGrid.tsx`                 | +16/−3  |
  | `apps/web/src/pages/CalendarPage.tsx`                      | +12/−2  |
  | `apps/web/src/pages/ExportPage.tsx`                        | +12/−0  |

  Novo (não rastreado): `apps/web/test/page-states.test.tsx` — 279 linhas.
- **Testes:** `apps/web/test/page-states.test.tsx`, **11 testes, todos provados por mutação**
  (tabela de mutações no cabeçalho do ficheiro: repõe-se o defeito, confirma-se vermelho,
  repõe-se o código). Cinco mutações, cinco vermelhos atribuídos ao teste certo; os dois
  ficheiros-fonte repostos e **verificados por `sha256sum`** contra o valor anterior.
  Sem infraestrutura nova: `renderToStaticMarkup` + `MemoryRouter` + `vi.mock`, o que respeita
  a decisão escrita em `email-verification-ui.test.ts` de não introduzir ambiente de DOM.
- **Validação:** `npm run typecheck --workspace @zemlo/web` → **exit 0**.
  `npm run test --workspace @zemlo/web` → **5 ficheiros, 99 testes, exit 0** (88 pré-existentes
  + 11 novos). Sem migrations. Sem alteração de contrato.
- **Contrato `packages/shared`:** **não alterado** — nenhuma linha de `contracts.ts`, `types.ts`
  ou `registry.ts`. Logo, sem impacto em A4 e sem trabalho extra em `MOB-001`: o mobile herda
  estes estados sem os redefinir.
- **Impacto nos outros agentes:** nenhum ficheiro de A1, A2 ou A4 foi tocado. Verificado que
  `apps/web/src/pages/records/RecordsPage.tsx` está alterado no working tree **por A1** (comentário
  de `recordMeta` sobre a regra de depósito; `git diff` inspecionado) — não é alteração minha e
  não foi mexida.
- **Limitações honestas** (para não serem lidas como cobertura que não existe):
  1. `D1` (no separador do seguro, representativo dos quatro), `D2` e `D4` têm **prova por
     mutação**. `D3` (os cinco `return null`) e `D5` (`ExportPage`) estão corrigidos e cobertos
     por typecheck, mas **sem teste dedicado** — exigiriam `QueryClientProvider` e `ToastProvider`
     na árvore de render, e o custo foi considerado desproporcionado nesta tarefa.
  2. O teste do `aria-controls` **não** discrimina as guardas de carregamento e de erro: com
     qualquer delas removida o painel continua a existir, porque o render normal também o desenha.
     O que ele discrimina é o `div` do painel — e foi assim que foi provado. Está escrito no
     ficheiro para não ser tomado por mais forte do que é.
  3. A prova é **markup renderizado em Node**, não interação em browser. Botões de repetição não
     foram clicados; o que se prova é que existem, com o rótulo certo, no estado certo.
- **Desbloqueia:** nada directamente. `WEB-004` continua `BLOCKED` por `AUD-008`; `WEB-006` não  
  dependia desta e segue `READY`. **Correção de A2 (2026-09-22):** o texto anterior afirmava que  
  `WEB-001`/`WEB-002` continuavam bloqueadas porque «o guarda de arranque em produção está  
  desativado no working tree» (`PC-14`). Essa observação era de **uma mutação transitória de A2**  
  durante a prova por mutação de `AUTH-001` — já reposta e confirmada por hash. `AUTH-001` está  
  `DONE` e a substância fechada (ver §5.2), pelo que **`WEB-001`/`WEB-002` deixam de estar  
  bloqueadas pela entrega de email**. O estado delas é decisão de A3.
- **Commit:** `ef0ebf6` — publicada na release (já não aguarda autorização de publicação).

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
- **Commit:** `ef0ebf6` — publicada na release (já não aguarda autorização de publicação).

#### WEB-006 · Acessibilidade — A3 · P2 · `DONE`

- **Descrição:** auditoria de acessibilidade da web. A tarefa não tinha âmbito escrito; este
  parágrafo passa a ser o âmbito.
- **Objetivo:** a interface é utilizável só com teclado, tudo o que é interativo tem nome
  acessível, e os estados (erro, carregamento, desativado) são anunciados a quem usa leitor de
  ecrã — não apenas pintados de outra cor.
- **Dependências:** —
- **Critérios de aceitação:** auditoria escrita com evidência `ficheiro:linha`; correções
  aplicadas para os defeitos que **não** constituam alteração de sistema de desenho; achados
  fora desse âmbito registados como tarefa própria; testes que mordem.
- **Testes:** asserção sobre o markup renderizado — o mesmo padrão de `page-states.test.tsx`
  (`renderToStaticMarkup` + `MemoryRouter` + `vi.mock`), sem `jsdom`.
- **Fora de âmbito, por decisão do pedido:** qualquer alteração visual ou de sistema de
  desenho. O contraste medido vai para `WEB-011`; o anúncio de mudança de página (título e
  foco) precisa de decisão de política de produto e vai para `WEB-012`.

**Auditoria (2026-09-22) — o que foi verificado e está correto.** Registado para que uma
auditoria futura não repita o trabalho:

- `lang="pt-PT"` e `viewport` sem `user-scalable=no` (`index.html`); `prefers-reduced-motion`
  tratado (`app.css:47`); `:focus-visible` global com contorno de 2 px (`app.css:116`).
- Ligação «saltar para o conteúdo» para `<main id="conteudo">` (`AppShell.tsx:125,145`).
- Duas `nav` com `aria-label`, mutuamente exclusivas por breakpoint (900 px) — a que não se
  aplica fica `display: none`, logo fora da árvore de acessibilidade.
- `Sheet`: `role="dialog"`, `aria-modal`, `aria-labelledby`, foco preso, `Escape` fecha e o foco
  é devolvido ao elemento anterior (`Sheet.tsx:44-102,136-140`).
- `Toaster`: `role="status"` + `aria-live="polite"` (`Toaster.tsx:95`).
- Formulários: `useId` + `htmlFor` + `aria-describedby` + `aria-invalid`, **um** erro por campo
  com `role="alert"` (`ui/form.tsx:35-65`).
- **Nenhum** `onClick` em elemento não interativo (verificado por expressão regular sobre todo
  o `src/`). **Nenhum** `aria-hidden` a envolver elemento focável (verificado por regex
  multilinha). Não existe um único `<img>`, logo não há texto alternativo em falta.
- Gráficos com `role="img"` e `aria-label` descritivo (`charts.tsx:51,111,197,244`).
- `Button` anuncia o estado ocupado com `aria-busy` (`primitives.tsx:54`); `ButtonLink` é um
  `<a>` e não um botão disfarçado (`primitives.tsx:95`).
- Alvos de toque: `--z-touch: 44px` aplicado em 10 sítios (`app.css:284,709,835,898,1086,1130,1377,1901,2383`).
- `DetailList` é um `<dl>` (`primitives.tsx:338`); `Disclosure` usa `<details>/<summary>`
  nativos (`primitives.tsx:372`), que já trazem `aria-expanded`; `NavLink` do router acrescenta
  `aria-current="page"` sozinho.
- Um `<h1>` por ecrã através de `PageHeader` (`primitives.tsx:175`). Os `<h1>` múltiplos nas
  páginas de autenticação estão em **ramos mutuamente exclusivos** — só um renderiza.
- Os filtros de data escritos à mão estão embrulhados em `<label>` (associação implícita):
  `RecordsPage.tsx:154-161`, `ExportPage.tsx:105-113`, `TimelinePage.tsx:143-150`.

**Defeitos encontrados — âmbito desta tarefa (corrigir aqui).**

- **A1 — `required` nunca chega ao controlo.** Em `ui/form.tsx` o `required` é **destruturado** e
  usado só para desenhar o asterisco, que é `aria-hidden` (`:45-50`). Nenhum dos componentes
  partilhados (`TextField`, `TextAreaField`, `SelectField`, `MoneyField`, `NumberField`,
  `DateField`) passa `required` nem `aria-required` ao `<input>`/`<select>`. Medido: `grep -rn
  "aria-required" apps/web/src/` devolve **zero**. Quem usa leitor de ecrã não sabe que um campo
  é obrigatório. Prova de que é omissão e não decisão: as páginas de autenticação, que escrevem
  o `<input>` à mão, **passam** `required` nativamente (`LoginPage.tsx:86,104`).
- **A2 — os separadores da ficha do veículo não seguem o padrão ARIA de teclado.** Em
  `VehicleDetailPage.tsx:254-273` há `role="tablist"` com 9 `role="tab"`, mas **todos** os
  separadores são paradas de tabulação e as setas não fazem nada. O padrão que o próprio
  `role="tab"` invoca exige *roving tabindex* (só o selecionado em `tabIndex=0`) e navegação com
  `←`/`→`/`Home`/`End`. Consequência: um utilizador de teclado percorre 9 botões para chegar ao
  conteúdo.
- **A3 — a contagem por ler é invisível na barra inferior.** O badge é desenhado **dentro** do
  `<span aria-hidden="true">` do ícone (`AppShell.tsx:292-295`), pelo que o nome acessível do
  link é só «Avisos». Na barra lateral o badge está **fora** do `aria-hidden`
  (`AppShell.tsx:199-201`) — as duas navegações do mesmo produto discordam.
- **A4 — dois `role="group"` sem nome acessível.** `MappingStep.tsx:397` e `:428` usam
  `role="group"` sem `aria-label`, enquanto os outros 9 do projeto o têm. Um grupo sem nome é
  anunciado como «grupo» e nada mais.

**Defeitos encontrados — fora do âmbito, com tarefa própria.**

- **A5 — o título do documento nunca muda.** Nenhum ficheiro de `apps/web/src/` escreve
  `document.title`; o separador do browser fica «Zemlo» em todas as rotas (WCAG 2.4.2). → `WEB-012`.
- **A6 — o foco não é gerido na navegação.** Não há efeito de mudança de rota; depois de uma
  navegação de cliente o foco cai no `<body>` e nada é anunciado (WCAG 2.4.3 / 4.1.3). → `WEB-012`.
- **A7 — contraste abaixo de WCAG AA, medido.** Ver a tabela em `WEB-011`. Corrigir exige mexer
  em tokens, logo é alteração de sistema de desenho. → `WEB-011`.

**Fecho (2026-09-22) — o que foi implementado.** Os quatro defeitos de âmbito foram corrigidos.
`A5`, `A6` e `A7` **não** foram tocados — ficaram em `WEB-012` e `WEB-011`, como o pedido exigia.

| # | Ficheiro | Correção |
| - | -------- | -------- |
| A1 | `ui/form.tsx` | `aria-required={required \| undefined}` nos **seis** controlos partilhados (`TextField`, `TextAreaField`, `SelectField`, `MoneyField`, `NumberField`, `DateField`). O asterisco continua `aria-hidden` — é decorativo; quem anuncia é o `aria-required`. **Justificação corrigida por medição, depois de a primeira versão estar errada:** escrevi primeiro que se evitava o `required` nativo «porque traz bolhas de validação do browser» — mas `grep -rn noValidate apps/web/src/` dá **17** ocorrências e **todos** os formulários do projeto são `noValidate`, pelo que hoje o nativo **não** produziria bolha nenhuma. A razão verdadeira, agora escrita no docblock, é a **independência do contexto**: um controlo partilhado pode cair num formulário que se esqueça do `noValidate`, e nesse dia o nativo reintroduziria a validação do browser em silêncio; `aria-required` garante o anúncio no próprio controlo. Ficou registado o que se perde (o `:invalid`/`:valid` para CSS) e que trocar é uma linha por controlo se o projeto formalizar a regra. |
| A2 | `pages/vehicles/VehicleDetailPage.tsx` + `lib/tabs.ts` (novo) | `Tabs` passa a seguir o padrão ARIA: **roving tabindex** (só o selecionado em `tabIndex=0`, os outros `-1`) e navegação por `←`/`→`/`Home`/`End`, com o foco a acompanhar a seleção. A aritmética das teclas foi extraída para `lib/tabs.ts` (`nextTabIndex(key, current, count)`), pura e sem DOM, seguindo o hábito de `lib/csvImport.ts` — é o que a torna testável neste projeto, que não tem `jsdom`. Teclas fora do padrão (`Tab`, `Enter`, `Space`, `Esc`, letras) devolvem `null` e mantêm o comportamento normal. |
| A3 | `app/AppShell.tsx` | O `TabLink` da barra inferior passa a emitir `<span className="z-sr-only">{n} por ler</span>` a seguir ao rótulo. O badge visual continua **dentro** do `<span aria-hidden>` do ícone (é lá que o posicionamento funciona); o que se acrescentou é o texto que o leitor de ecrã anuncia. Escreve o **número real** (`formatNumber(badge, 0)`), não o `9+` — o `9+` existe só para caber num círculo de 16 px. |
| A4 | `pages/import/MappingStep.tsx` | `aria-label="Ordem das datas"` (`:406`) e `aria-label="Separador decimal"` (`:437`) nos dois `role="group"` que não tinham nome. (As linhas **subiram** de `:397`/`:428` para `:406`/`:437` por causa do comentário de 9 linhas que documenta a decisão — os números acima do quadro «Defeitos encontrados» referem o estado **antes** da correção, e estão certos para esse estado.) Optou-se por **nomear** em vez de remover o `role`: é alteração aditiva e verificável; remover o papel seria subtrativa e sem forma de provar que não piora. |

**Ficheiros e dimensão (`git diff --numstat`).**

| Ficheiro | +/− | Nota |
| -------- | --- | ---- |
| `apps/web/src/ui/form.tsx` | +32/−0 | A1 — **6** linhas são código (`aria-required={required \| undefined}`, confirmado por `grep -c`); as outras 26 são o docblock que documenta a escolha |
| `apps/web/src/app/AppShell.tsx` | +14/−0 | A3 |
| `apps/web/src/pages/import/MappingStep.tsx` | +11/−2 | A4 |
| `apps/web/src/pages/vehicles/VehicleDetailPage.tsx` | +193/−4 | **cumulativo**: inclui o `WEB-005`, que continua **por commitar**. A parte que pertence a `WEB-006` é o bloco `Tabs` — **linhas 255-315 (61 linhas)** — mais uma linha de `import` (`:64`). |
| `apps/web/src/lib/tabs.ts` | **novo** — 31 linhas | A2, aritmética pura |
| `apps/web/test/accessibility.test.tsx` | **novo** — 361 linhas | 28 testes |

**Testes.** `apps/web/test/accessibility.test.tsx` — **28 testes**, no padrão de
`page-states.test.tsx` (`renderToStaticMarkup` + `MemoryRouter` + `vi.mock`, sem `jsdom`, que o
projeto não tem). Cobre: `aria-required` presente quando o campo é obrigatório e **ausente**
quando não é (os seis controlos, por `it.each`), o asterisco a manter-se `aria-hidden`; a
aritmética das teclas do `tablist` (ciclo nos dois extremos, `Home`/`End`, teclas ignoradas, um
só separador, índice fora do intervalo); no markup renderizado, **exatamente um** `tabindex="0"`
e oito `-1`, o `0` no separador selecionado, um só `aria-selected="true"` e o alvo de
`aria-controls` a existir; o `sr-only` «3 por ler» na barra inferior com o badge a manter-se
dentro do `aria-hidden`; e um guarda estático de convenção (todo o `role="group"` de `src/` tem
`aria-label`) **acompanhado de um teste que exige ≥11 grupos encontrados** — sem esse segundo
teste o guarda passaria por vacuidade se a expressão regular deixasse de casar.

**Prova por mutação — 3 rondas, todas repostas e confirmadas por `sha256`, zero resíduo.**

| Ronda | Mutação | Resultado |
| ----- | ------- | --------- |
| 1 | `form.tsx`: `aria-required` desativado + asterisco com `aria-hidden="false"` | **7 vermelhos** — os seis `«$nome marca o controlo com aria-required»` e o do asterisco |
| 2 | `lib/tabs.ts`: aritmética trocada + `tabIndex` sempre `0` | **5 vermelhos** — `ArrowRight`, `ArrowLeft`, teclas fora do padrão, um só separador, `tabindex` único |
| 3 | `AppShell`: `sr-only` desativado + um `aria-label` removido | **2 vermelhos** — o do `sr-only` e o guarda dos `role="group"` |

Hashes dos ficheiros no fecho (para quem quiser confirmar que não ficou nenhum stub de mutação):
`AppShell.tsx` `824da5f9…`, `MappingStep.tsx` `952aab76…`, `VehicleDetailPage.tsx` `ccfe7ed7…`,
`ui/form.tsx` `870989a6…`, `lib/tabs.ts` `675bcb53…`, `test/accessibility.test.tsx` `282d1077…`.
**Quatro** dos seis hashes (`AppShell`, `MappingStep`, `VehicleDetailPage`, `lib/tabs`) são
exatamente os mesmos de antes das mutações — é a prova de que os ficheiros-fonte voltaram ao
original. Os outros dois mudaram **de propósito e depois** das rondas, e só em **comentário**:
`accessibility.test.tsx` (explicar o limiar anti-vacuidade) e `ui/form.tsx` (corrigir a
justificação de A1, que a medição desmentiu — ver a linha de A1 acima). Ambos revalidados depois:
suíte **7/134 exit 0**, `typecheck` web **exit 0**.

**Validação.** `typecheck` do workspace **web**: **exit 0**. Suíte **web**: **7 ficheiros / 134
testes / exit 0**. `typecheck` da raiz: **exit 2**, com **um único** erro,
`apps/api/src/core/config.ts(345,69): Cannot find name 'API_BASE_PATH'` — **não é desta tarefa e
não foi tocado**: é a edição em curso de A2 para `AUTH-002` (o ficheiro foi escrito às
11:46:39 e a verificação correu às 11:47:34; a constante do *redirect* do Google ainda não
existia). Registado como interferência, não como defeito — mesma família do que se anotou em
`WEB-005` e em `AUD-005`.

**Contrato.** `packages/shared` **não foi alterado** — zero linhas. Nenhum endpoint, nenhuma
rota, nenhum tipo partilhado, nenhuma alteração de payload. `WEB-006` foi integralmente do lado
da apresentação: atributos ARIA, `tabindex` e um módulo de aritmética de teclas. **Impacto
declarado para os outros agentes: nenhum.** (Declarado antes de implementar, §6.)

**Dependências desbloqueadas:** **nenhuma**. `WEB-006` não bloqueava nem desbloqueava tarefas de
outros agentes; não tinha dependências de entrada e não é pré-requisito de nada. O que produziu
foram **duas tarefas novas** (`WEB-011`, `WEB-012`) e um problema registado (`PC-24`). Migrations:
**nenhuma** (não há alteração de schema). Documentação atualizada: só este ROADMAP — não há
`docs/API.md` nem `DECISIONS.md` a mexer, porque não há contrato nem decisão de arquitetura.

**Diff revisto:** `git diff` dos quatro ficheiros alterados lido linha a linha antes do fecho;
nenhuma alteração fora do âmbito, nenhuma linha de outro agente arrastada.

**Coordenação durante a tarefa.** A1 escreveu `test/records-kind.test.tsx` **a meio** de uma das
minhas execuções (mtime `11:37:39`): a suíte deu 3 vermelhos nesse ficheiro, que passou 7/7
isolado e voltou a verde na execução seguinte — leitura de versão a meio de escrita, não
defeito. A4 criou `PROD-001`/`PROD-007` em paralelo; nenhuma das duas toca em ficheiros desta
tarefa. Três rondas de colisão de IDs na §2 durante a escrita do âmbito (ver `PC-18`): renumerei
sempre **a minha** linha (`PC-21` → `PC-24`, com folga deliberada) e nunca as alheias.

**Limitações honestas — o que este fecho não prova.**

- Os testes provam **markup**, não comportamento. Não há `jsdom` nem `@testing-library` no
  projeto (decisão registada no cabeçalho de `email-verification-ui.test.ts`). Logo: a
  **movimentação do foco** depois de uma seta **não** é coberta por teste — só a aritmética que a
  decide é. `document.activeElement` não é observável nesta montagem.
- Também **não** ficam cobertos por teste: a armadilha de foco e o `Escape` do `Sheet`, e o
  `aria-busy` do `Button`. Foram verificados por leitura, não por prova — está registado como
  verificado-por-leitura e não como testado.
- O anúncio real de um leitor de ecrã **não** é verificável por nenhum teste deste projeto. O que
  se prova é que o texto existe na árvore com as marcas certas.
- O guarda de `role="group"` (A4) é **estático**: prova a convenção no código-fonte, não o
  comportamento em execução. Um `role="group"` gerado dinamicamente escaparia-lhe. Medido no
  fecho: encontra **11** etiquetas em 8 ficheiros e **0** sem nome (reproduzido à mão, fora da
  suíte). A expressão só casa dentro de **uma linha**, pelo que reformatar uma etiqueta por várias
  linhas a faria perder cobertura **em silêncio** — e é por isso que o teste anti-vacuidade exige
  `>= 11`, o número **exato** de hoje, e não uma margem folgada: uma perda de cobertura passa a dar
  vermelho. Consequência aceite e agora escrita no próprio teste: apagar ou substituir um grupo
  legítimo também fica vermelho, de propósito, para obrigar quem mexer a reavaliar. A alternativa —
  varrer o `src/` com `grep` de linha — **não** serve para julgar isto: dá 2 falsos positivos nos
  comentários do próprio `MappingStep.tsx` (linhas `:395` e `:397`), que mencionam `role="group"`
  em texto.
- O `sr-only` da contagem escreve o **número real**; o badge visual mostra `9+` acima de nove.
  Acima desse limiar, o que é anunciado e o que é visto **divergem por decisão** — é o
  comportamento desejado (o `9+` é uma restrição de espaço, não de informação), mas fica escrito
  para não ser lido como defeito por quem vier depois.

**Estado:** `WEB-006` → `DONE`. **Sem commit, sem push e sem deploy** — a árvore fica como está,
com `WEB-005` e `WEB-006` por commitar, à espera de autorização.

#### WEB-007 · Pesquisa e filtros — A3 · P2 · `BACKLOG`

#### WEB-008 · Consistência visual e design system — A3 · P3 · `BACKLOG`

#### WEB-009 · `DocumentsPage`: campo «Validade» duplicado no formulário — A3 · P2 · `DONE`

- **Descrição:** o formulário «Novo documento» renderiza **dois** `DateField` com o rótulo
  «Validade», ambos ligados a `form.values.expiresAt` e ambos com o mesmo `error={errors.expiresAt}`
  (`DocumentsPage.tsx:144-153` e `:154-170`). O segundo ficou de um par que devia ser
  «Nome do ficheiro» + «Validade», depois de a validade ter sido acrescentada ao primeiro par.
  O utilizador vê o mesmo campo duas vezes e não sabe se são dois dados diferentes.
- **Objetivo:** um só campo de validade, no par a que pertence.
- **Dependências:** —
- **Critérios de aceitação:** o formulário mostra um único campo «Validade»; os restantes
  campos mantêm-se; nenhuma alteração ao payload enviado.
- **Testes:** inspeção do formulário renderizado (contagem de campos com o rótulo «Validade»).
- **Ficheiros:** `apps/web/src/pages/DocumentsPage.tsx:144-170`.
- **Risco de conflito:** `PROD-001` (A4) vai mexer neste formulário para substituir o
  `fileName` escrito à mão por um `<input type="file">` — §8.1. Coordenar antes de tocar, ou
  corrigir primeiro e avisar A4.
- **Origem:** descoberto na auditoria de estados de `WEB-005`. **Não** é um defeito de estado —
  por isso é tarefa própria e não foi corrigido dentro de `WEB-005` (§1.2).

- **Fecho (A9, 2026-09-23) — `DONE`.** O formulário «Novo documento» passa a ter **um só** campo
  «Validade»: removido o `DateField` duplicado, que ficou para trás quando a validade passou
  para o par com a data. **`onSubmit` e o payload não foram tocados** — a alteração é só de JSX.
- **Decisão de implementação, declarada:** a grelha `z-grid--2` que envolvia o par saiu com o
  duplicado. Sozinho, «Nome do ficheiro» ficaria numa grelha de duas colunas **com uma célula
  vazia** — um campo a meia largura ao lado de nada. Passa a ocupar a linha inteira, como «Nome»
  e «Notas».
- **Testes:** `apps/web/test/documents-form.test.ts` (**novo**, **3 testes**) — conta as
  ocorrências do rótulo «Validade», verifica que os restantes campos se mantêm e inclui um teste
  **anti-vacuidade**, no padrão da guarda de `role="group"` de `accessibility.test.tsx`.
- **Prova por mutação:** **2/2 mortas** — repor o duplicado dá `expected [...] to have a length
  of 1 but got 2`; renomear o único «Validade» dá **2** vermelhos, incluindo a anti-vacuidade.
  Ficheiro reposto e confirmado por `sha256` (`9872189c…`, idêntico antes e depois).
- **Verificação:** `typecheck` da web exit 0; `PC-15` coberto por `tsconfig` restrito fora do
  repositório, exit 0; suíte web **12 ficheiros / 246 testes / exit 0** com `--no-cache` e
  `--no-file-parallelism` (medido por A9 em 2026-09-23). `git diff --numstat` do ficheiro:
  **16/17**.
- **Limitação explícita — a validação é ESTÁTICA, e está rotulada como tal.** O critério desta
  tarefa diz «inspeção do formulário **renderizado**» e isso **não** foi feito: o formulário abre
  por interação (`useState`) e o projeto decidiu não usar `jsdom`, pelo que um teste de
  renderização veria a lista e não o formulário. O que está provado é que o rótulo é **declarado
  uma só vez** no código-fonte — **não** que o ecrã o mostra uma só vez. **A interação continua
  por validar.**
- **Commit:** **nenhum** — no working tree; aguarda autorização de publicação.

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
- **Commit:** `ef0ebf6` — publicada na release (já não aguarda autorização de publicação).

#### WEB-012 · Anunciar a mudança de página (título + foco) — A3 · P2 · `READY`

- **Descrição:** dois defeitos da mesma família — o produto é uma aplicação de página única e
  não diz a ninguém que a página mudou.
  - **A5 — o título nunca muda.** `grep -rn "document.title" apps/web/src/` devolve **zero**. O
    separador do browser diz «Zemlo» em todas as rotas (`index.html:22`), logo o histórico, os
    favoritos e a leitura do título por leitor de ecrã não distinguem `/vehicles` de
    `/settings/security` (WCAG 2.4.2).
  - **A6 — o foco não é gerido.** Não há efeito de mudança de rota em `AppShell`. Depois de uma
    navegação de cliente o foco cai no `<body>`: quem navega por teclado perde a posição e quem
    usa leitor de ecrã não ouve nada (WCAG 2.4.3 e 4.1.3).
- **Objetivo:** cada rota tem título próprio e a mudança é percetível sem ver o ecrã.
- **Dependências:** —
- **Bloqueio:** **requer decisão de política do utilizador** antes de implementar, porque há
  escolhas de produto legítimas e irreversíveis na prática:
  1. **Fonte dos títulos** — um mapa `rota → título` num só sítio (previsível, mas acrescentar
     uma rota e esquecer o mapa deixa um título genérico), ou cada página declara o seu (mais
     próximo do ecrã, mais fácil de esquecer em dois sítios).
  2. **Comportamento do foco** — mover o foco para o `<h1>`/`<main>` em cada navegação (é o que
     a WCAG recomenda, mas faz a página «saltar» visualmente), ou manter o foco e anunciar só o
     título numa região `aria-live` (menos intrusivo, menos correto).
  3. **Formato do título** — `Zemlo — Veículos` ou `Veículos · Zemlo`.
- **Critérios de aceitação:** dependem da decisão acima; em qualquer caso, o título muda com a
  rota e a mudança é anunciada.
- **Testes:** asserção sobre o título produzido pelo mapa/declaração, para as 32 rotas — o
  teste que interessa é o que falha quando uma rota nova não tem título.
- **Origem:** `WEB-006`. **Não** implementado dentro dela por ser decisão de política e não
  defeito técnico (o utilizador decide política por escolha múltipla, antes da implementação).

#### WEB-013 · O cliente web nunca guarda o token de renovação — A3 · P1 · `DONE`

**Fecho (2026-09-22, consolidado por A9 em 2026-09-23).** O cliente web guardava o token de acesso
e **descartava o de renovação**, pelo que a renovação silenciosa era impossível: `auth.login` lia
`session.refreshToken` (campo que a API não envia), `setTokens` só escrevia com um segundo
argumento que era sempre `null`, `getRefreshToken()` devolvia sempre `null` e
`refreshAccessToken()` saía à primeira linha **sem fazer pedido nenhum**. A sessão terminava à hora
do token de acesso, apesar dos **90 dias** configurados.

**É uma regressão da A23 do lado do cliente.** A A23 fixou que o token é devolvido em
`tokens.refreshToken` e rodado em cada renovação — e regista que o defeito do servidor *«foi
encontrado pela aplicação web»*. O cliente que o descobriu reproduziu-o a seguir, com o mesmo erro
de leitura de contrato; o docblock do contrato (`types.ts:118`) avisa exatamente deste modo de
falha.

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

**Critérios de aceitação — verificados por A9 no código, um a um:** `setTokens` lê e grava
`tokens.refreshToken` (`client.ts:167`); a interface `AuthResponse` **desapareceu** (só resta o
comentário histórico em `:472`); `auth.login`/`auth.signup` devolvem `UserProfile` (`:504`, `:515`);
os 17 testes verdes e provados por mutação.

**Prova corrida por A9 antes de fechar (2026-09-23).** `client.ts` `sha256`
`1f3802cb…` idêntico ao declarado na proposta; `session-refresh` **17/17 exit 0**; suíte web
**228/228 em 10 ficheiros exit 0**; `typecheck` web **exit 0**; `tsconfig` a excluir `test/`
confirmado (**0** ficheiros); o template de verificação restrito provado **sensível** por mutação
(`TS2724`, exit 2) e o ficheiro reposto com o `sha256` `ac4b19f8…` idêntico.

**Contrato.** **Não** exigiu alteração a `packages/shared` — e alterá-lo estaria errado: o campo
`AuthTokens.refreshToken` já era obrigatório e a API já o devolvia. Confirmado por `sha256` de
`contracts.ts` (`de510b70…`) e `types.ts` (`88c052d5…`), idênticos aos declarados na proposta.

**Impacto:** API **nenhum**; Mobile **nenhum** (o cliente Dart já lia `tokens.refreshToken` desde
`MOB-001` — o web era o outlier).

**Dependências desbloqueadas:** nenhuma.

**Limitações (declaradas, não escondidas):** `vite build` não foi corrido; não houve verificação
ponta a ponta num browser real contra a API real — a prova está na fronteira do transporte e do
armazenamento, que é onde o defeito vivia.

**Achados propostos, não tratados nesta tarefa** (declarados sem número de `PC-*`, por não haver
correção nem teste associado nesta ronda): `RequestOptions.skipRefresh` é opção morta; um 401
depois de renovar repete o ciclo a cada pedido.

**Origem:** descoberto em `MOB-001` ao comparar o cliente do mobile com o da web. **Não** corrigido
dentro de `MOB-001` — é defeito de outra frente e o pedido exigia proposta prévia a A9 (§1.2).

### 5.4 Mobile (A3)

#### MOB-001 · Arquitetura Flutter + cliente do contrato partilhado — A3 · P1 · `DONE`

- **Descrição:** não existe `apps/mobile`. A app mobile consumirá **a mesma API** (§34); o  
  contrato em `packages/shared` é a única definição de "despesa" ou "lembrete" no projeto.
- **Objetivo:** decidir e registar a arquitetura antes de escrever ecrãs.
- **Dependências:** —
- **Critérios de aceitação:**
  - `apps/mobile` criado com a arquitetura decidida e **escrita** (em `DECISIONS.md` ou neste  
    documento, se for decisão de estrutura);
  - **nenhum contrato paralelo**: os modelos vêm do contrato partilhado, não de tipos escritos  
    à mão no Dart;
  - estratégia explícita para manter o contrato sincronizado (geração, ou verificação);
  - cliente HTTP com tratamento do envelope de erro único (A11);
  - autenticação por token com renovação (A23) desenhada, mesmo que implementada em `MOB-002`.
- **Risco:** é a tarefa com maior probabilidade de criar divergência de contrato. Qualquer  
  alteração a `packages/shared` que a mobile precise **tem de virar tarefa própria** — §6.

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

#### MOB-002 · Autenticação no mobile — A3 · P1 · `BLOCKED`

- **Bloqueada por:** `MOB-001`, `AUTH-001`.
- **Critérios:** login, renovação de sessão, logout, e o campo TOTP revelado em 401.
- **Nota de dependência:** `MOB-002` pode ser **escrita** sobre o cliente de `MOB-001`, mas
  **não deve ser considerado operacionalmente concluído enquanto `MOB-007` não passar**
  (`flutter pub get` + `flutter analyze` + `flutter test`). Enquanto isso, o cliente está
  **provado contra o contrato** e **não compilado**.
- **Nota:** esta limitação **não** exige reabrir `MOB-001`. A arquitetura e o mecanismo de
  geração não estão em causa; o que falta é o **ambiente** onde validá-los.

#### MOB-003 · Onboarding e criação de veículo — A3 · P2 · `BLOCKED` (`MOB-002`)

#### MOB-004 · Registos (abastecimento, carregamento, despesa) — A3 · P2 · `BLOCKED` (`MOB-002`)

#### MOB-005 · Dashboard — A3 · P2 · `BLOCKED` (`MOB-002`)

#### MOB-006 · Notificações no mobile — A3 · P3 · `BLOCKED` (`MOB-002`)

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

### 5.5 Produto e backend funcional (A4)

#### PROD-001 · Documentos: upload de ficheiro — A4 · P0 · `DONE`

- **Descrição:** não existia endpoint de upload. **Correção de A4 (`PROD-003`):** a afirmação  
  original — "a interface pede uma `storageKey` escrita à mão (`DocumentsPage.tsx:168`)" — estava  
  **desatualizada**. `DocumentsPage.tsx` já **não** tem campo de `storageKey` (o `:163` é o  
  segundo «Validade» duplicado, que é `WEB-009` de A3). O que aceitava `storageKey` era o  
  **contrato da API** (`contracts.ts:577`). Ou seja: a lacuna era de **API**, não de formulário.
- **Objetivo:** o utilizador escolhe um ficheiro; o servidor guarda-o e devolve a referência.
- **Dependências:** —
- **Decisão tomada — `A` (dois passos), fixada pelo utilizador em 2026-09-22.** `POST  
  /documents/:documentId/content` com **corpo cru**, separado da criação/atualização da  
  metadata. A alternativa `B` (um passo, `POST /documents` a aceitar corpo cru **e** metadados)  
  foi recusada por obrigar a alterar `zDocumentCreateRequest` — um contrato partilhado — para  
  acrescentar capacidade que se acrescenta sem o tocar. **Registada em `docs/DECISIONS.md`  
  como `A31`**, porque a regra que dela sai ultrapassa esta tarefa (ver abaixo).
- **A regra que ultrapassa a tarefa (§A31.3).** Este é o primeiro caminho que serve **duas  
  representações** — metadados em JSON e bytes crus — e por isso a isenção do `requireJsonBody`  
  em `app.ts` deixou de poder ser agnóstica ao método (como é a do importador):  
  `isDocumentUpload` compara **método + caminho**. Vale para o próximo anexo binário  
  (`INT-002`–`INT-004`).
- **Critérios de aceitação — estado:**
  - ✅ `POST` de upload aceita um ficheiro e devolve a referência gerada pelo servidor  
    (`<userId>/<32 hex>`, de `documentStorage().save`);
  - ⚠️ **`storageKey` deixar de ser aceite do cliente na API — NÃO cumprido, deliberadamente.**  
    O utilizador fixou "não alterar `zDocumentCreateRequest`", e retirar o campo é uma alteração  
    de contrato partilhado (§6). Registado em `PC-21`. Não é falha de isolamento: o  
    armazenamento recusa chaves cujo prefixo não seja o do utilizador, e `assertSafeKey` recusa  
    caminhos absolutos e `..`;
  - ✅ limite de tamanho (25 MiB, durante a leitura) e tipo (lista fechada) validados, com o  
    envelope de erro único (A11);
  - ✅ a autorização é verificada por consulta ao dono **antes** de o armazenamento ser tocado, e  
    o armazenamento valida outra vez o prefixo da chave;
  - ✅ isolamento por conta testado — uma conta não escreve nem lê no espaço de outra;
  - ✅ `docs/API.md` atualizado (secção «Upload dos bytes (§A31)»).
- **Testes:** 22 testes novos em `apps/api/test/documents-http.test.ts` (secção 10): caminho  
  feliz, ida-e-volta por `sha256`, preservação da metadata, tipo base sem parâmetros, 4 tipos  
  recusados, `application/pdfx`, corpo vazio, **limite exacto aceite** e **um byte acima → 413**,  
  sessão/token/outra conta/inexistente, `409` de ficheiro já existente (com contagem de ficheiros  
  antes e depois), a fronteira da isenção ao nível da unidade, e não regressão.
- **Prova por mutação (3 mutações, nenhuma sobrevivente, todas restauradas e verificadas por  
  `sha256`):** remover o filtro de dono → cai o isolamento; trocar a lista fechada por  
  `startsWith` → cai o teste do `application/pdfx`; mover a verificação do `409` para **depois**  
  do `save` → o código de estado continua `409` mas o teste cai na contagem de ficheiros (o  
  ficheiro órfão é criado). A terceira é a que justifica a asserção sobre o disco.
- **Validação:** `npx vitest run` (suíte completa) → **36 ficheiros, 1504 testes, 0 falhas**;  
  `npx tsc -p tsconfig.json --noEmit` → exit 0; `npm run db:check-schema` → **schema sincronizado**  
  (não houve alteração de schema — `storageKey`, `sizeBytes` e `mimeType` já existiam desde A17).
- **Ficheiros:** `http/routes/documents.ts` (constantes, predicado, leitura do corpo, rota),  
  `services/documents.ts` (`uploadDocumentContent`), `app.ts` (parser cru + isenção),  
  `docs/API.md`, `docs/DECISIONS.md` (A31). **`packages/shared/src/contracts.ts` não foi tocado**  
  (§6 cumprido por não haver alteração de contrato).
- **Limitações declaradas:** o `fileName` **não** é gravado (o corpo cru não transporta nomes; a  
  transferência deriva o nome do documento + extensão do tipo). Substituir um ficheiro → `409`,  
  fica para `PROD-008`. Remover bytes ao eliminar → `PROD-007`.
- **Fora de âmbito, e não absorvido:** `PROD-007` continua tarefa **independente** e `READY`,  
  como registado. Esta tarefa não a toca.
- **Web:** sem alteração. A interface de documentos é `WEB-003` (A3).

#### PROD-008 · Documentos: substituir o ficheiro — A4 · P2 · `DONE`

- **Descrição:** descoberta em `PROD-001`. Um documento que já tem ficheiro respondia `409` ao
  upload, porque substituir deixaria os bytes antigos **órfãos** — o mesmo defeito de `PC-13`. A
  recusa era a resposta correta enquanto não houvesse substituição, mas obrigava o utilizador a
  eliminar e recriar o documento para trocar uma digitalização.
- **Objetivo:** trocar o ficheiro de um documento sem perder a ficha nem deixar lixo.
- **Dependências:** `PROD-007` (satisfeita — a substituição reutiliza a mesma remoção com
  contagem de referências).
- **Critérios de aceitação:** cumpridos, **com uma alteração de premissa registada abaixo**.
- **⚠ A premissa mudou, por decisão do utilizador.** O critério dizia «`POST
  /documents/:id/content` sobre um documento com ficheiro substitui os bytes». A decisão tomada
  por escolha múltipla foi outra: o `POST` continua a ser **só** o upload inicial e recusa com
  `409` um documento que já tem ficheiro; a substituição passa a ser **`PUT
  /documents/:documentId/content`**. A separação é o conteúdo da decisão: um envio repetido por
  uma rede instável não pode destruir o ficheiro anterior como efeito lateral de um `POST`.
  Foram descartadas `POST ?replace=true` e um `POST` que substitui sempre. **Mantém-se a
  tarefa** — não se cria tarefa nova por a premissa ter mudado.
- **Implementação:** `services/documents.ts` — `replaceDocumentContent` (novo) e
  `storeContentAndPointRecord` (novo, partilhado com o upload); `uploadDocumentContent`
  reduzido a guarda de propriedade + `409` + chamada ao auxiliar. Ordem: **guardar os novos →
  apontar o registo → remover os antigos**, com remoção compensatória da chave nova se o
  `update` falhar, e a remoção da chave antiga feita pela **mesma** função da eliminação
  (`discardDocumentBytes` de `PROD-007`). `http/routes/documents.ts` — rota `PUT`, com a mesma
  `readUploadedDocument` do `POST`; `isDocumentUpload` alargado a `POST || PUT` (regra `A31`:
  método **e** caminho). `app.ts` — só docblocks: a isenção do corpo cru serve agora os dois
  verbos.
- **Testes:** `apps/api/test/documents-replace.test.ts` (**novo**, **17 testes**) com o harness
  de `documents-delete.test.ts` (base SQLite temporária, `DOCUMENT_STORAGE_DIR` num `mkdtemp`,
  contagens lidas **no disco**). `import type { PrismaClient }` (`PC-15`). **Desvio
  registado:** o ROADMAP previa estender a §10 de `test/documents-http.test.ts`; esse ficheiro
  não foi lido (recusa do utilizador, duas vezes) e os testes foram para um ficheiro novo.
  Ficheiro a mais, não a menos — mas é uma decisão a ratificar.
- **Prova por mutação:** **8 mutações, todas mortas**, repostas e verificadas por `sha256`
  (`services/documents.ts` `23601be8…`, `routes/documents.ts` `5cf6756c…`): M1 ordem invertida
  com o auxiliar partilhado (4); M2 sem remover a chave antiga (4); M3 remoção própria, sem
  contagem (2); M4 sem remoção compensatória (1); M5 isenção pelo caminho, sem olhar ao método
  (1); M6 o `POST` substitui sempre (2); M7 gravar só a chave (6); M8 ordem invertida ingénua
  (4). **O achado que valeu a M8:** M1 e M2 produzem o **mesmo** conjunto de 4 falhas — a
  inversão com o auxiliar partilhado não produz referência pendente, porque a contagem vê o
  próprio registo ainda a apontar para a chave antiga e recusa removê-la; degrada-se num
  vazamento. A propriedade «os bytes antigos não saem antes de os novos estarem guardados»
  ficava **sem asserção que a distinguisse**, e é M8 — a versão que se escreve por reflexo —
  que a afirma. **Regra que ficou: comparar os conjuntos de falhas, não as contagens.**
- **Verificação:** suíte de documentos **130 testes em 4 ficheiros, exit 0** (medido por A9
  nesta consolidação: `document-storage` 33, `documents-delete` 11, `documents-replace` **17**,
  `documents-http` 69). `typecheck` da API **exit 0** (medido por A9).
- **Documentação:** `docs/API.md` — linha `PUT` na tabela e secção «Substituição dos bytes
  (§PROD-008)» com a matriz de estados; duas frases desatualizadas corrigidas (o `409` já não
  manda «elimina e cria outro»; o parágrafo final já não diz que a substituição nem a remoção
  de bytes «não existem»).
- **Contratos:** `packages/shared` **intocado**. Impacto nenhum em Web e Mobile.
- **Limitação declarada:** o cliente web (`apps/web`) ainda não usa o `PUT` — a substituição
  não está exposta na interface.
- **Commit:** `ef0ebf6` — publicada na release (já não aguarda autorização de publicação).

#### PROD-002 · Documentos: download dos bytes — A4 · P0 · `DONE`

- **Descrição original:** "não existe endpoint. `DocumentStorage.read()` tem **um único  
  chamador** — `export-bundle.ts:496`." **Verificado como falso por A4 em `PROD-003`:** o  
  endpoint existe desde `94b72c5` (2026-09-20), está documentado e tem cobertura própria. Ver
  `PC-12`.
- **Implementação (já existente, agora verificada):** `GET /documents/:documentId/content`  
  (`http/routes/documents.ts:148-182`). `downloadDocument` (`services/documents.ts:299`) resolve  
  o dono **por consulta** (`requireRecord`, filtrado pelo `userId`) antes de tocar no  
  armazenamento; só depois entrega a `storageKey` vinda da base de dados a  
  `documentStorage().read(userId, storageKey)`, que revalida o prefixo `<userId>/`. Devolve  
  bytes, `contentType` de lista de permissão (`safeContentType`, tipos ativos rebaixados a  
  `application/octet-stream`) e nome sanitizado (`sanitizeDownloadName` — sem injeção de  
  cabeçalho, sem caminhos, sem controlos bidirecionais). O `403` do storage é convertido em  
  **404** na rota, para não revelar existência.
- **Objetivo:** servir o documento ao dono. ✅
- **Dependências:** —
- **Critérios de aceitação:** ✅ cumpridos, comprovados por execução:
  - `GET` devolve os bytes com `Content-Disposition` e o tipo correto — ✅
    (`documents-http.test.ts`, "transferência — bytes", "— tipo de conteúdo", "— nome do ficheiro");
  - `read(userId, key)` revalida o dono — ✅ (o teste da chave de outra conta nunca serve bytes);
  - documento de outra conta → **404**, indistinguível de inexistente — ✅ (teste dedicado que
    compara as duas respostas);
  - `docs/API.md` atualizado — ✅ (`docs/API.md:189`, já na `main`).
- **Testes:** `apps/api/test/documents-http.test.ts` (47) + `apps/api/test/document-storage.test.ts`
  (33) = **80 testes verdes**.
- **Validação (medida por A4, 2026-09-22):** `npx vitest run` dos dois ficheiros → 2 ficheiros,
  80 testes, 0 falhas; `npx tsc -p tsconfig.json --noEmit` → exit 0.
- **Documentação:** já estava feita — a rota constava de `docs/API.md:189`.
- **Contrato (`packages/shared`):** sem alteração. Impacto API/Web/Mobile: nenhum.
- **Dependências desbloqueadas:** `WEB-003` (o lado "descarregar" está servido).
- **Limitações:** sem intervalos de bytes nem retoma de transferência — decisão declarada e
  justificada em `services/documents.ts:10-15`.
- **Commit:** já em `main` (`94b72c5`). **Nada a publicar por A4 nesta tarefa.**

#### PROD-003 · Revisão de completude por domínio — A4 · P1 · `REVIEW`

- **Descrição:** o inventário de §3 foi levantado por leitura de documentação e amostragem de  
  código. Antes de planear trabalho novo por domínio, cada domínio precisa de um estado  
  verificado: veículos, abastecimentos, carregamentos, despesas, manutenção, seguros,  
  inspeções, impostos, documentos, lembretes, estatísticas, timeline, importações, exportações,  
  custos, TCO, integrações.
- **Objetivo:** substituir "provavelmente completo" por "verificado", domínio a domínio.
- **Dependências:** —
- **Critérios de aceitação:** ✅ cumpridos — os 15 domínios têm linha própria com estado,  
  evidência `ficheiro:linha` e tarefa associada em **§3.7**.
- **Testes:** não aplicável — é levantamento. O produto é a atualização de §3 deste documento  
  (§3.2 corrigida + §3.7 nova).
- **Resultado:** **12 dos 15 domínios implementados e funcionais.** As três lacunas reais são o  
  upload de documentos (`PROD-001`), a publicação MQTT (`INT-001`) e a higiene de armazenamento  
  (`PROD-007`, criada por esta revisão). O que falta nos restantes não é código de produto: é  
  cobertura de testes de rota (`TEST-001`) e o agendador (`PROD-004`).
- **Problemas registados:** `PC-12` (o inventário de §3 e o estado de `PROD-002`/`AUTH-001`/  
  `WEB-001`–`WEB-003` estavam desatualizados face ao código) e `PC-13` (os bytes nunca são  
  apagados).
- **Validação executada:** 80 testes verdes (`documents-http`, `document-storage`); typecheck  
  API exit 0.
- **Estado:** `REVIEW` — levantamento feito e registado; aguarda validação do utilizador antes  
  de `DONE` (§1.4).
- **Nota:** esta tarefa existe para impedir que A4 comece a construir o que já existe — e foi  
  exatamente o que quase aconteceu com `PROD-002`, cujo endpoint já estava em `main` desde  
  2026-09-20.

#### PROD-004 · Agendador de notificações — A4 · P2 · `DONE`

- **Descrição:** ver `PC-9`. `grep` de `setInterval|node-cron|cron(` em `apps/api/src/` era
  **vazio** e `syncNotifications` só corria como efeito lateral de abrir o dashboard
  (`insights.ts:148`): **um lembrete legal não avisava ninguém enquanto ninguém olhar**.
- **Objetivo:** os lembretes disparam sozinhos.
- **Dependências:** `AUTH-001` (satisfeita).
- **Critérios de aceitação:** existe um agendador que corre a sincronização sem depender de um
  pedido; execução idempotente; o intervalo é configurável e documentado em `OPERATIONS.md`;
  uma instância reiniciada não perde nem duplica trabalho; teste cobre a idempotência. **Os
  cinco cumpridos.**
- **Mecanismo — decidido *antes* de implementar, como o `Risco` exigia:** **núcleo partilhado +
  runner in-process** (`DECISIONS.md` **A32**). Três peças com fronteiras explícitas:
  `syncNotificationsForUser(userId, timeZone)` (`services/notifications.ts`) — a descoberta que
  o dashboard já usava, extraída de **3 linhas inline** em `insights.ts`, que era a razão de
  `PC-9`; `runNotificationSync(options)` (`jobs/notification-sync.ts`) — pagina utilizadores
  por cursor `id asc`, best-effort por utilizador, devolve relatório; `createJobRunner`
  (`jobs/runner.ts`) — a **única** peça com `setInterval`, guarda de reentrância por tarefa
  (verificação + `inFlight.add` **antes do primeiro `await`**), ignora em vez de enfileirar,
  contém falhas, `intervalMinutes <= 0` não arma. O runner arranca em **`server.ts:79`** (depois
  do `listen`) e `jobs.stop()` é o 1.º passo do `shutdown` (`server.ts:96`) — **não** em
  `createApp()`, para que a aplicação continue a ser construível sem trabalho periódico.
  `NOTIFICATIONS_SYNC_INTERVAL_MINUTES`: default **15**, **`0` desliga**, máximo **1440**
  (`core/config.ts:475`), com linha em `describeConfig()`.
- **Testes:** `apps/api/test/jobs-notification-sync.test.ts` (**novo**, **15 testes**) com o
  runner real: materialização **sem nenhuma rota chamada**, reentrância, best-effort, paginação,
  preferências de notificação, data efetiva, intervalo `0` e inferência de tópico.
- **Prova por mutação:** **9 mutações, todas repostas e confirmadas por `sha256`** — sem guarda
  de reentrância (1), sem best-effort (1), paginação não avança (1), ignorar preferências (1),
  data efetiva = hoje (1), intervalo `0` arma relógio (1), não inferir tópico (4). **Uma
  sobrevivente, demonstrada equivalente e não escondida:** remover a verificação de existência
  (`findFirst`) mata **0** testes, porque a garantia efetiva é o **índice único** de
  `dedupeKey` e não a verificação prévia; a **contra-prova** (remover a verificação **e** o
  `catch`) mata **3**, mostrando que o segundo `create` é tentado e recusado pelo índice. O
  `findFirst` é um atalho que evita a exceção e o log no caminho comum.
- **Duas correções forçadas pelas mutações — nos testes, não no código:** o teste da guarda
  falhava por **expiração (5 s)** e não por asserção (sem guarda, o segundo `runNow()` fica
  preso no portão e o `await` nunca resolve → passou a `Promise.race` com marcador, falhando em
  ~1 s e nomeando o que se passou); e o teste do intervalo `0` deixava o runner armado quando a
  guarda avaria, o que **pendurava a suíte** → passou a `runner.stop()` num `finally`.
- **Verificação:** suíte completa **48 ficheiros / 1768 testes / exit 0**; `tsc` dos **3
  workspaces** exit 0; `PC-15` coberto por `tsconfig` restrito fora do repositório (`typeRoots`
  absoluto), exit 0.
- **Documentação:** `OPERATIONS.md` §3.5.1 (nova — operação e configuração do runner) e §9
  reescrita; `DECISIONS.md` **A32**.
- **Contratos:** `packages/shared` **intocado**. Impacto nenhum em Web e Mobile.
- **Achados que saíram daqui:** **`PC-49`** (o `catch` não estreita para `P2002` — uma avaria
  de BD fica indistinguível de um duplicado) e **`PC-50`** (`windowDays`/`windowKm` inertes em
  `listReminders`). **Não reabrem `PROD-004`.**
- **Commit:** `ef0ebf6` — publicada na release (já não aguarda autorização de publicação).

#### PROD-005 · Famílias (Household) — A4 · P4 · `DEFERRED`

#### PROD-006 · Frotas (Organization) — A4 · P4 · `DEFERRED`

- **Descrição:** os quatro modelos (`Household`, `HouseholdMember`, `Organization`,  
  `OrganizationMember`) têm **zero** referências em `apps/api/src/`. A18 declara-os não  
  expostos, e está correto.
- **Nota:** **não** é "meio caminho andado". Requer decisão de produto e especificação antes de  
  qualquer código. A §3.4 registou que a *especificação* para famílias/frotas não existe.

#### PROD-007 · Documentos: remover os bytes ao eliminar — A4 · P2 · `DONE`

- **Descrição:** ver `PC-13`. `documentStorage().remove()` tinha **zero chamadores** em
  `apps/api/src/` — a interface declarava a operação (`services/document-storage.ts:83`) e a
  implementação existia e estava testada, mas ninguém a usava. `deleteDocument`
  (`services/documents.ts:194-206`) apagava a linha, os eventos e os lembretes e **deixava o
  ficheiro no armazenamento para sempre**.
- **Objetivo:** um documento eliminado deixa de ocupar armazenamento, como o utilizador espera.
- **Dependências:** — (feita antes de `PROD-008`, que a tinha como dependência).
- **Critérios de aceitação:** eliminar remove os bytes; a remoção é **best-effort e não
  bloqueia** a eliminação do registo; a falha é registada de forma observável (com o
  `documentId`, **sem** a chave nem bytes); um documento sem `storageKey` continua a
  eliminar-se sem erro; teste cobre eliminação com bytes, sem ficheiro e falha do storage.
  **Todos cumpridos.**
- **Implementação:** `deleteDocument` lê a chave **antes** do `delete`, apaga o registo (com
  eventos e lembretes) e só depois chama `discardDocumentBytes`, com **contagem de
  referências** — que existe por causa de `PC-21`, onde dois registos podem partilhar a mesma
  chave. A ordem é a garantia, e as invariantes **não** são simétricas: o registo nunca pode
  apontar para um ficheiro inexistente (logo o registo sai primeiro); um ficheiro ainda
  referenciado nunca pode ser apagado (logo os bytes saem depois). O log leva `documentId` +
  código do erro, **nunca** a chave — a mensagem do `node:fs` traz o caminho.
- **Testes:** `apps/api/test/documents-delete.test.ts` (**novo**, **11 testes**): eliminação
  com ficheiro (contagem **no disco**, não no armazenamento), sem ficheiro, ficheiro já
  inexistente, falha do armazenamento, falha da **base de dados**, isolamento entre contas,
  chave partilhada (`PC-21`), interação com o upload de `PROD-001` e regressão do lembrete de
  validade.
- **Prova por mutação:** **4 mutações, nenhuma sobreviveu**, todas repostas e verificadas por
  `sha256` (base `d4150d7d…`): M1 remoção ausente → **7 vermelhos**; M2 ordem invertida → **1
  vermelho**, precisamente o da falha da base de dados, que é o que prova a ordem; M3 sem
  contagem de referências → **1 vermelho**; M4 log com a mensagem do erro → **1 vermelho**.
- **Verificação:** suíte de documentos **130 testes em 4 ficheiros, exit 0** (medido por A9
  nesta consolidação: `document-storage` 33, `documents-delete` **11**, `documents-replace` 17,
  `documents-http` 69). `typecheck` da API **exit 0** (medido por A9).
- **Contratos:** `packages/shared` **intocado**. Impacto nenhum em Web e Mobile.
- **Achados que saíram daqui:** **`PC-51`** — `deleteAccount`
  (`apps/api/src/services/auth.ts:1332-1365`) apaga por cascata do esquema e **não passa por
  aqui**, pelo que os bytes dos documentos de uma conta eliminada ficam órfãos. Aberto; não é
  desta tarefa.
- **Nota de âmbito, mantida:** isto **não** é uma limpeza de órfãos já existentes — fecha a
  torneira, não limpa o chão.
- **Commit:** `ef0ebf6` — publicada na release (já não aguarda autorização de publicação).

### 5.6 Integrações (A4)

#### INT-001 · Publicação MQTT das entidades HA — A4 · P2 · `DONE`

- **Descrição:** a especificação das entidades é **calculada em tempo real**  
  (`integrations.ts:246`) e nunca persistida; `HomeAssistantEntity` não é usado. Sem broker  
  (`HA_MQTT_URL`), as entidades ficam listadas mas não publicam.
- **Objetivo:** publicar o estado das entidades disponíveis.
- **Dependências:** —
- **Critérios de aceitação:**
  - as entidades marcadas `available` publicam estado; as indisponíveis **não** publicam  
    valores inventados (§49);
  - sem broker configurado, o comportamento atual mantém-se e é explicado ao utilizador;
  - a descoberta respeita o `discoveryPrefix` configurado;
  - falha de ligação ao broker não derruba a API;
  - teste cobre a serialização e o caso "sem broker". **Os cinco cumpridos.**
- **Risco:** exige infraestrutura (broker) que não existe em desenvolvimento. Ver `ARCHITECTURE.md` §8.

- **Critérios — cumpridos.** Os cinco: as indisponíveis **não** publicam valores inventados
  (`publicationDecision`, `mqtt-publisher.ts:464`); sem broker o comportamento mantém-se e é
  explicado na especificação (`integrations.ts:364-368`, renderizada por
  `HomeAssistantPage.tsx:101`); a descoberta respeita o `discoveryPrefix`; uma falha de ligação
  não derruba a API (`safePublish`; `publish`/`connect` devolvem em vez de lançar); e os testes
  cobrem a serialização e o caso «sem broker».
- **Composição testável — extração equivalente, sem alteração funcional.** `composeMqtt()` e
  `redactMqttUrl()` vivem em `services/mqtt-bootstrap.ts` porque o `server.ts` **não é importável**
  (chama `main()` no import). A equivalência prova-se pelo **produtor da configuração**:
  `core/config.ts:468` define **`enabled: mqttUrl !== null`**, pelo que
  `enabled && mqttUrl !== null` ≡ `mqttUrl !== null` em qualquer configuração que o `build()`
  produza. Os quatro módulos funcionais (`mqtt-topics`, `mqtt-client`, `mqtt-publisher`,
  `jobs/mqtt-sync`) **não foram alterados** (confirmado por `mtime`). A ordem das tarefas é
  irrelevante: `runner.runNow` usa `Promise.all` e contém falhas por tarefa.
- **Testes:** três suites, **69 testes** — `integrations-mqtt-publication.test.ts` (36),
  `jobs-mqtt-sync.test.ts` (18) e `mqtt-bootstrap.test.ts` (15) — **exit 0**, confirmado também
  com `--no-cache`. `typecheck` dos **3 workspaces** exit 0; `PC-15` coberto por `tsconfig`
  restrito fora do repositório, exit 0. Cobertura explícita da composição **sem e com**
  `HA_MQTT_URL`, de `redactMqttUrl()` (sem fuga de credenciais, incluindo URL malformado) e de
  `mqtt-sync`.
- **Prova por mutação — medida por A9, 16 execuções:** **M1–M9 e M11–M15 mortas**; **M9b
  sobrevive** e é legítimo (código inalcançável sem a dependência `mqtt`); **M10 sobrevive e é um
  mutante equivalente** — `EntityPublication.state` é `string | null` e `publicationDecision()`
  garante `state !== null` antes da linha mutada, pelo que `String(state)` é a identidade em todo
  o caminho alcançável. **M10 não deve ser morto artificialmente:** exigiria uma asserção sobre um
  caminho que não existe. Todas as mutações repostas e conferidas por `sha256`.
- **Regressão global — sem atribuição a esta tarefa.** Suíte completa
  (`--no-cache --no-file-parallelism`): **51 falhadas / 1359 passadas / 670 ignoradas**, 31
  ficheiros falhados. Classificação: **28 ficheiros da API** por defeito de **ambiente**
  (`spawnSync … EBUSY` no `createTestDb`, cliente Prisma não gerado,
  `__vite_ssr_import_meta__.resolve`); **3** são cópias de segurança do harness
  (`.mut-int001-backup/*.test.ts`) recolhidas como testes — **não podem entrar no commit**; **1** é
  interferência entre ficheiros de teste web. **Zero** atribuíveis a `INT-001`.
- **Limitação explícita — E2E MQTT real NÃO VALIDADO.** O percurso
  `publicar → broker → subscritor` **não** está provado: não há `mqtt` instalado nem declarado em
  nenhum `package.json`, e nada escuta em `:1883` (medido por A9 em 2026-09-23). O que está
  provado é a decisão, a serialização e o tratamento de erro — **não** a entrega.
  `OPERATIONS.md` §3.5.2 («Estado da verificação») e §9 dizem-no. Esta limitação **não** deve ser
  convertida em prova de E2E: fechá-la exige um broker real e um subscritor.
- **Commit:** **nenhum** — no working tree; aguarda autorização de publicação.

#### INT-002 · Integrações de fabricantes — A4 · P4 · `DEFERRED`

#### INT-003 · OBD — A4 · P4 · `DEFERRED`

#### INT-004 · Wallboxes — A4 · P4 · `DEFERRED`

#### INT-005 · Telemetria — A4 · P4 · `DEFERRED`

- **Descrição:** o README declara "modelo e especificação prontos, sem ligação". A ligação  
  exigiria credenciais e infraestrutura que não existem em desenvolvimento.
- **Nota:** a especificação é explícita em **não** fazer engenharia reversa nem inventar dados.  
  Qualquer uma destas exige decisão de produto **e** verificação de que os termos de uso do  
  fabricante o permitem.

### 5.7 Operações (A1)

#### OPS-001 · CI: `typecheck` + `test` + `verify*` — A1 · P1 · `DONE`

- **Descrição:** não existe `.github/`. É isto que **liga** PC-5 a PC-6: sem CI, a suíte barata  
  (importação) corre e a verificação dispendiosa depende de disciplina manual. Um CI que corra  
  `typecheck` + `test` + `verify*` contra uma base semeada fecha os dois problemas ao mesmo tempo.
- **Objetivo:** nenhuma regressão entra sem ser vista.
- **Dependências:** —
- **Critérios de aceitação:**
  - CI corre em cada push: `typecheck`, `npm test`, `verify:config`, e `verify*` contra uma base  
    semeada;
  - uma falha de typecheck falha o CI;
  - uma falha em `auth` falha o CI (**hoje não falharia** — não há testes de rota para `auth`);
  - o tempo total é aceitável e está documentado;
  - o CI **distingue falha de teste de falha de ambiente**: um `EBUSY` de teardown não pode
    marcar o CI como vermelho (**`PC-26`** — medido por A1: 1511 testes verdes, exit code 1).
- **Nota de sequência:** sem `TEST-001`, o CI verde continua a não provar nada sobre  
  `auth`/`vehicles`/`financial`/`compliance`/`reminders`. As duas tarefas devem andar juntas.

**Detalhe prévio (A1, 2026-09-22 — escrito antes de implementar, §1.2):**

- **Objetivo:** nenhuma regressão entra sem ser vista — e o CI verde passa a **provar** as quatro
  áreas que `TEST-001` cobriu.
- **Dependências:** `TEST-001` — **satisfeita** (161 testes novos; `PC-5` fechado). Sem ela, o CI
  verde continuaria a não provar nada sobre `vehicles`/`financial`/`compliance`/`reminders`.
- **Âmbito: dois trabalhos implementados, um registado** — um por pré-requisito real (e não um só,
  porque os pré-requisitos são genuinamente diferentes):

  1. `qualidade` — **sem servidor**: `db:check-schema`, `typecheck`, `npm test`, `verify:config`.
  2. `verificacao` — **base semeada + servidor**: `db:push`, `db:seed`, `verify`, `verify:auth`,
     `verify:regressions`. Nota: `verify:auth` **não** está no `verify:all` do `package.json`
     (`verify:all` = `verify:config && verify && verify:regressions`), pelo que o CI o corre
     **explicitamente** — senão o critério «uma falha em `auth` falha o CI» não ficaria cumprido.
  3. `integracao` — exige o **build de produção** (o cabeçalho de `verify-integration.mjs` di-lo):
     `npm run build`, servidor em `NODE_ENV=production`, `verify:integration`. **Não implementado
     nesta tarefa** — ver `OPS-006` e o fecho: não era executável nem uma vez aqui, e um trabalho de
     CI que nunca correu é uma afirmação sem prova.

- **`PC-26` — tratado em duas frentes, e por esta ordem:**

  1. **Causa raiz corrigida** em `test/helpers/db.ts`. O `destroy()` faz `$disconnect()` e logo a
     seguir `rmSync(dir)`. No Windows o handle não é libertado no instante em que `$disconnect()`
     resolve, e o `rmSync` rebenta com `EBUSY` — o resultado medido foi **exit code 1 com todos os
     testes verdes**. Passa a haver **repetição com espera** sobre `EBUSY`/`EPERM`/`ENOTEMPTY`, com
     limite de tentativas, e o erro original é relançado se esgotar (não se engole nada). É
     infraestrutura de teste, **não** produto.
  2. **Classificador de ambiente** em `scripts/ci/run-tests.mjs`. Corre `npm test` — o **mesmo**
     comando que o programador corre — mostra o log e decide a partir **desse mesmo log**: uma só
     fonte de verdade, sem um segundo canal que possa discordar do que o CI mostra. Um ficheiro
     falhado com **zero** asserções falhadas e cuja mensagem tenha **as duas** coisas (um código
     `EBUSY`/`EPERM`/`ENOTEMPTY` **e** uma operação de ficheiro — `unlink`, `rmdir`, `directory not
     empty`, `resource busy or locked`) é **ambiente**: avisa alto e **não** pinta o CI de vermelho.
     Qualquer outra falha — uma asserção, uma suite que não carrega, uma saída que o script não
     consiga explicar — é **real** e falha o CI. **Falha para o lado seguro:** o que não sabe
     explicar, reprova.
     *(Planeado com o relatório JSON do Vitest; implementado sobre o texto. Ver o fecho: a mudança
     foi deliberada — o log que o CI mostra e a evidência que fica são os mesmos bytes que
     alimentam a decisão — e a robustez que se perde no parsing é coberta pela regra de falhar para
     o lado seguro.)*
  **A ordem importa:** primeiro a causa raiz. Um classificador sem a correção seria uma forma de
  esconder o problema; com a correção, é a rede que apanha um artefacto **novo** de ambiente sem
  transformar o CI num semáforo vermelho ao acaso.

- **O que fica de fora (declarado):** `Dockerfile` (`OPS-002`), alerta de `formatVersion`
  (`OPS-003`), agendador (`PROD-004`), e a entrada dos testes no `typecheck` (**`PC-15`** — exige um
  `tsconfig` de testes e uma decisão sobre os erros pré-existentes do harness; registado, não
  resolvido aqui).
- **Ficheiros:** `.github/workflows/ci.yml` (novo), `scripts/ci/run-tests.mjs` (novo),
  `apps/api/test/helpers/db.ts`, `docs/ROADMAP.md`.
- **Conflitos:** `apps/api/test/helpers/db.ts` é partilhado — verificado **limpo** antes de o tocar
  (`git status` vazio, `sha256` `b5a05a7b…`). Não existe `.github/`, logo nenhum outro agente tem
  ficheiro de CI aberto.
- **Verificação — o que foi provado, e onde:** o `.yml` foi validado por **sintaxe real**
  (PyYAML 6.0.3 `safe_load`) mais invariantes estruturais e o **cruzamento de cada `npm run <script>`
  com os 8 scripts reais** que invoca; o validador foi ele próprio provado por **4 mutações**, todas
  apanhadas. O trabalho `verificacao` foi **corrido localmente** contra uma base descartável, com
  `verify`/`verify:auth`/`verify:regressions` a passarem. **O que não foi provado:** o `.yml` **não
  correu num runner de GitHub Actions** (não existe aqui) e o trabalho `integracao` **não correu nem
  uma vez** (exige PostgreSQL; ver `OPS-006`). Os tempos são **medidos** onde corridos e **estimados**
  onde não foram, e a distinção está escrita na tabela do fecho.

**Implementação e provas (A1, 2026-09-22):**

- **Criados:** `.github/workflows/ci.yml`, `scripts/ci/run-tests.mjs`,
  `apps/api/test/teardown-retry.test.ts` (**4 testes**).
  **Alterados:** `apps/api/test/helpers/db.ts` (repetição no teardown — `PC-26`), `docs/ROADMAP.md`.

**1. Trabalho `qualidade`** — sem servidor nem base de dados:

| Passo | Resultado medido |
| --- | --- |
| `npm run db:check-schema` | **exit 0** — «Schema SQLite sincronizado com o schema canónico» |
| `npm run typecheck` | **exit 0** nos três workspaces |
| `node scripts/ci/run-tests.mjs` | **exit 1** — ver o ponto 4 abaixo (artefacto local, declarado) |
| `npm run verify:config` | **exit 0** — **12 corretos, 0 incorretos** |

**2. Trabalho `verificacao`** — base descartável fora do repositório + servidor a correr:

| Passo | Resultado medido |
| --- | --- |
| criar o esquema numa base descartável | **exit 0** — base criada, 479 232 B |
| `npm run db:seed` | **exit 0** — semeada (68 eventos na timeline) |
| arranque + sonda `/health` | **200 em 17 s** |
| `npm run verify` | **exit 0** — **231 verificações passaram** |
| `npm run verify:auth` | **exit 0** — **51 verificações passaram, 0 falharam** |
| `npm run verify:regressions` | **exit 0** — **70 regressões confirmadas corrigidas** |

- **A base do utilizador não foi tocada:** `apps/api/prisma/sqlite/dev.db` com `sha256` **idêntico**
  antes e depois (`0589b575…`). A verificação correu sobre uma base descartável em `%TEMP%`.

**3. O defeito que só apareceu por correr: a sonda apontava para o endereço errado.** A primeira
execução do passo de prontidão **falhou**: `GET /api/v1/health/live` devolvia **404**. A saúde vive
**fora** do prefixo versionado (`app.ts:347-349`). Corrigido para `/health` — e escolhido `/health` e
não `/health/live` porque é `/health` que **também verifica a base de dados** (503 se não responder),
que é o que os passos seguintes precisam. **Não era visível por leitura; era visível por execução.**
Registado como `PC-33`.

**4. A suíte completa pelo classificador deu `exit 1`, e isso está aqui por inteiro.** O ficheiro
`test/oauth-google.test.ts` falhou com **`Hook timed out in 60000ms`** e **28 testes `skipped`**, com
**zero asserções falhadas**. **Não é o `EBUSY` de `PC-26`** e **não** foi classificado como ambiente:
o classificador recusou-se a chamá-lo verde, que é exatamente o que se lhe pede. A causa é o ambiente
(`PC-32`: ~23 s por arranque de processo), não o produto. **Não se alargou o classificador para
engolir timeouts de hook** — isso mascararia timeouts de hook verdadeiros, que são uma classe de
defeito real. Registado como `PC-34`. *(A suíte completa, na mesma sessão e antes de a máquina ficar
carregada, tinha dado **43 ficheiros / 1703 testes / 0 falhas**.)*

**5. Classificador — provado nos dois sentidos, com quatro fixtures:**

| Entrada | Exit | Veredicto |
| --- | --- | --- |
| log de teardown com bloqueio de ficheiro, zero asserções falhadas | **0** | ambiente — aviso alto, CI não fica vermelho |
| asserção falhada real | **1** | real |
| suite que não carrega (0 testes) | **1** | real |
| saída não reconhecida | **1** | real (falha para o lado seguro) |

- **Limitação declarada deste ponto:** as fixtures foram **reconstruídas por mim** a partir da
  assinatura documentada em `PC-26`, e **não** são o log original byte a byte. Foi o que se viu ao
  correr de verdade: a falha real que apareceu (`Hook timed out`) tem **outra forma** e foi
  corretamente recusada. A lição ficou registada em `PC-34`.

**6. `PC-26` — causa raiz corrigida e provada por mutação.** `removeTree()` repete com espera sobre
`EBUSY`/`EPERM`/`ENOTEMPTY`, com limite de tentativas, e **relança o erro original** se esgotar (não
engole nada). Desativar a repetição faz **2 de 4** testes de `teardown-retry.test.ts` falharem;
reposto e confirmado por `sha256` (`d987ec02…`). É infraestrutura de teste, **não** produto.

**7. YAML — validado, e o validador provado por mutação.** Sem runner de GitHub Actions aqui, o `.yml`
foi validado por **sintaxe real** (PyYAML 6.0.3 `safe_load`), mais invariantes estruturais (`runs-on`,
`steps`, exatamente um de `run`/`uses` por passo, `needs`) e o **cruzamento de cada `npm run <script>`
com os 23 scripts do `package.json`** — os 8 invocados existem todos. **Quatro mutações** no `.yml`
foram apanhadas (script inexistente, `typecheck` removido, indentação com tab, dependência quebrada),
todas restauradas e confirmadas por `sha256` (`b4ad4a4b…`). O validador é um **instrumento de sessão**
(PyYAML), **não** um ficheiro do repositório — não se acrescentou um `script` novo ao projeto só para
provar o próprio CI.

**8. Tempos — medidos onde corridos, e o que não foi:**

| Trabalho | Medido localmente | Nota |
| --- | --- | --- |
| `db:push` (por `node`, sem generate) | **43 s** | |
| `db:push` (por `npm`, com generate) | **6 m 44 s** | o `generate` paga o `ETIMEDOUT` do shim (`PC-32`) |
| `db:seed` | **2 m 41 s** | |
| arranque + sonda `/health` | **28 s** (200 em 17 s) | |
| `verify` | **2 m 54 s** | 231 verificações |
| `verify:auth` | **2 m 28 s** | 51 verificações |
| `verify:regressions` | **2 m 29 s** | 70 regressões |
| `db:check-schema` | **3 m 13 s** | |
| `verify:config` | **2 m 57 s** | 12 corretos |
| `npm test` pelo classificador | **44 m 20 s** | dominado por `PC-32`/`PC-34` |
| **total do trabalho `verificacao`** | **~13 m** (push+seed+servidor+3 scripts) | |
| **tempo em CI** | **não medido — estimativa, não medição** | os artefactos que dominam aqui (`PC-32`) não existem num runner |

- **Honestidade sobre o tempo:** o critério pede «o tempo total é aceitável e está documentado».
  Está documentado o que foi **medido**. O tempo em CI **não foi medido** e a estimativa não substitui
  uma medição; fica escrito como estimativa, e não como facto.

**9. O que ficou de fora, e porquê (declarado):**
- **Trabalho `integracao` → `OPS-006`.** Exige o build de produção e `NODE_ENV=production`, e
  `core/prisma-client.ts` **recusa SQLite em produção** — logo exige PostgreSQL. Este ambiente **não
  tem PostgreSQL nem Docker**, pelo que o trabalho **não podia ser corrido nem uma vez**. Um trabalho
  de CI que nunca correu é uma afirmação sem prova: ficou **registado**, não inventado.
- **`PC-15` continua aberto.** O `typecheck` que o CI corre é o do projeto, que **exclui**
  `**/*.test.ts` — o CI **não** fecha este buraco. Fechá-lo exigiria um `tsconfig` de testes e uma
  decisão sobre os erros pré-existentes do harness.
- `Dockerfile` (`OPS-002`), alerta de `formatVersion` (`OPS-003`), agendador (`PROD-004`).

**10. Problemas descobertos durante a execução:** `PC-32` (harness local lento; shims e `curl`
penduram), `PC-33` (`GET /api` anuncia `/api/v1/health`, que devolve 404) e `PC-34`
(`oauth-google.test.ts` estoura o timeout de hook sob carga). Registados; **nenhum** corrigido fora do
âmbito desta tarefa.

**11. Sem commit** — alterações deixadas no working tree.

#### OPS-002 · Dockerfile — A1 · P2 · `BLOCKED`

> **Corpo escrito por decisão de consolidação do A9 (2026-09-22), não retroativa.** O corpo estava
> vazio. O que se segue **não** é uma especificação original que tivesse existido: é o registo formal
> do que falta decidir e da razão do bloqueio, escrito ao abrigo da §1.4 e do diagnóstico de A1
> (`PROPOSAL-A1-OPS-002`). **Nenhum critério de aceitação foi inventado.**

- **Descrição:** não existe contentorização no projeto — verificado: `Dockerfile*`,
  `docker-compose*` e `.dockerignore*` na raiz **não existem**; `git ls-files | grep -iE
  "docker|container"` devolve **zero**; `docker`/`podman`/`nerdctl` **ausentes** do `PATH`
  (`exit 127`); `wsl.exe` bloqueado por política. **O trabalho não está feito.**
- **Estado: `BLOCKED`, por três razões independentes, todas verificadas:**
  1. **Não está especificado.** O corpo estava vazio e a §1.2 exige descrição, objetivo,
     dependências, critérios de aceitação e testes/validação previstos; a §1.1 diz que uma tarefa
     não escrita não pode ser implementada. Escrever-lhe os critérios seria **inventar** um contrato.
  2. **Depende do `OPS-006`.** Um contentor de produção **não pode usar SQLite**:
     `core/prisma-client.ts:88-94` **recusa** arrancar em produção com o cliente SQLite, e o
     comentário `:84-86` explica porquê. O caminho PostgreSQL é o mesmo requisito que faz o `OPS-006`
     existir. A tabela declarava `—`; **estava incorreta** — passa a `OPS-006`.
  3. **Não é provável neste ambiente.** Sem motor de contentores (`PC-38`), um `Dockerfile` escrito
     aqui **nunca seria construído nem corrido** — um ficheiro com aparência de entrega e **zero
     verificação**. É a definição exata de afirmação sem prova, e o `OPS-006` já tinha sido tratado
     assim (`:2101-2104`: «Registado em vez de inventado (§1.2)»).
- **Decisões por tomar (nenhuma está tomada no repositório — nenhuma é de A9 sozinho):**
  1. **Imagem base e estágios** — `node:22-alpine`, `node:22-slim` ou `distroless`; um estágio ou
     multi-estágio (build do TypeScript e do Vite fora da imagem final).
  2. **Âmbito** — só a API, ou API **e** web compilada servida estaticamente? São dois produtos com
     ciclos de vida diferentes.
  3. **Motor de dados** — assumir PostgreSQL como pré-requisito **externo** (é o que a recusa de
     SQLite em produção implica).
  4. **Migrações** — aplicadas no arranque do contentor ou passo separado de `deploy`.
  5. **Utilizador** — `root` (por omissão) ou utilizador sem privilégios.
  6. **Porta e sonda** — e a sonda tem uma armadilha **já medida**: a saúde vive **fora** do prefixo
     versionado (`PC-33`), pelo que um `HEALTHCHECK` a apontar a `/api/v1/health` devolve **404**; o
     endereço correto é **`/health`**. Foi exatamente aqui que o autor do `ci.yml` errou (`OPS-006`).
  7. **Volume de dados** — onde persiste o quê, e o que acontece a esse volume num
     `docker compose down`.
- **Dependências:** `OPS-006` (caminho PostgreSQL) e o **corpo desta tarefa** (as decisões 1–7 têm
  de estar tomadas antes de a tarefa poder estar `READY`).
- **Critérios de aceitação:** **por redigir**, depois de as decisões 1–7 estarem tomadas. **Não
  inventados aqui.**
- **Testes/validação previstos:** exige um motor de contentores — **indisponível neste ambiente**
  (`PC-38`). Um `Dockerfile` que nunca foi construído não é prova de nada: a tarefa **não** deve ser
  fechada sem `docker build` + arranque + sonda verde. Enquanto isso não for possível, a validação é
  uma **limitação de ambiente declarada**, não uma impossibilidade permanente do projeto.
- **Nota:** a tarefa **já estava declarada fora de âmbito** no fecho de `OPS-001` (`:1944` e
  `:2064`). O que faltava era o registo formal do **porquê** — que é isto.

#### OPS-003 · Alerta de `formatVersion` (PC-8) — A1 · P3 · `BLOCKED`

> **Corpo escrito por decisão de consolidação do A9 (2026-09-22), não retroativa.** O corpo estava
> vazio, tal como o de `OPS-002`. **Nenhuma implementação nem critério foi inventado.**

- **Descrição:** o `PC-8` regista que `domain/import/migrate.ts` (440 linhas) tem `MIGRATIONS` vazio
  e é inalcançável com `FORMAT_VERSION === MIN_SUPPORTED === 1` — andaime declarado, nunca executado
  a sério. A tarefa consiste em **alertar** quando a versão de formato de um bundle não for a
  suportada, em vez de falhar em silêncio.
- **Estado: `BLOCKED`, por duas razões independentes:**
  1. **Não está especificado.** O corpo estava vazio; a §1.2 exige os campos e a §1.1 diz que uma
     tarefa não escrita não pode ser implementada. Escrever-lhe critérios seria **inventar** o
     contrato — e o comportamento desejado (recusar, avisar, ou degradar com aviso) é uma **decisão
     de produto**, não uma consequência técnica.
  2. **Depende do `AUD-011`**, que é **decisão de produto**: ou o motor de migração fica **declarado**
     como andaime para `formatVersion` 2, ou sai até haver versão 2. Enquanto essa decisão não
     estiver escrita em `DECISIONS.md`, não se sabe **o que** o alerta deve anunciar nem **a quem**.
- **Dependências:** `AUD-011` (decisão de produto) e o **corpo desta tarefa**.
- **Critérios de aceitação:** **por redigir**, depois de `AUD-011` estar decidida. **Não inventados
  aqui.**
- **Testes/validação previstos:** por definir com a decisão. O que já se sabe: o ramo é inalcançável
  com a versão de formato atual, pelo que qualquer teste terá de **construir** um bundle com versão
  diferente para exercitar o caminho — e isso depende de o motor ficar ou sair (`AUD-011`).
- **Nota:** `OPS-003` foi um dos **14 de 65** corpos vazios medidos por A1 (`PC-37`). Passa a
  `BLOCKED` ao abrigo da política registada na §1.2: uma tarefa em `BACKLOG` **sem corpo** e **sem
  condição externa conhecida** é uma tarefa que ainda não foi especificada; esta tem condição externa
  conhecida (`AUD-011`) **e** falta de corpo, pelo que `BLOCKED` é o estado honesto.

#### OPS-004 · Limpar `dist/` obsoleto (PC-3) — A1 · P3 · `DONE`

- **Descrição:** `apps/api/dist/` local tem a implementação antiga. Não é versionado  
  (`.gitignore:5`), mas engana quem correr o output compilado.
- **Critérios:** `dist/` regenerado ou removido; documentado que o `prebuild` (`prisma generate`)  
  está bloqueado neste ambiente.
- **Nota:** **não** é um problema de repositório. É higiene local.

**Implementação e provas (A1, 2026-09-22) — `DONE`:**

- **`dist/` regenerado** pelo comando do próprio projeto: `npm run build --workspace @zemlo/api` →
  **exit 0**, em **1 m 42 s**. Ficou com **152** ficheiros (76 `.js` + 76 `.map`), contra **150**
  antes.
- **A estagnação foi provada por construção, não por data.** Compilou-se a API para um diretório
  temporário e compararam-se as duas árvores por `sha256` ficheiro a ficheiro: **64** iguais,
  **86 diferentes**, **0** só em `dist/` (perder-se-iam) e 2 só no build novo (`services/oauth.js` e
  `.map` — o `dist` antigo **nem sequer continha** um módulo que hoje existe, de `AUTH-002`). Zero
  ficheiros perdidos → a regeneração era segura.
- **Verificação cruzada:** o `dist` novo é **byte a byte idêntico** ao build independente em todo o
  JavaScript (0 de 76 `.js` diferem); as 76 diferenças são **todas** source maps, por um dos builds
  ter usado `--outDir` absoluto. O build é reprodutível e a diferença residual está explicada.
- **Correção de uma premissa do ROADMAP:** o critério dizia «documentado que o `prebuild`
  (`prisma generate`) está bloqueado neste ambiente». **Não está bloqueado** — medido: o `prebuild`
  correu e o `prisma generate` completou os **dois** clientes (19,48 s postgres, 19,34 s sqlite),
  exit 0. O que é verdade é que o `db:push` **com** `generate` é ordens de grandeza mais lento
  (**6 m 44 s** contra **43 s** com `--skip-generate`) — é o shim *safe-delete* do sandbox a pagar
  `ETIMEDOUT` (`PC-32`), um caso do harness e não uma impossibilidade.
- **Sem resíduos:** o diretório temporário de comparação foi removido para a Reciclagem.
- **`PC-3` fecha — com a ressalva que importa:** o defeito não era «`dist` existe», era «`dist`
  afirma o contrário do código». Um `dist` regenerado volta a ficar obsoleto ao primeiro `src`
  alterado — **a higiene é regerar, não existir**. Se se quiser uma garantia e não só uma limpeza,
  liga-se ao `OPS-006`, que já constrói para produção: um `npm run build` no CI falharia se a build
  partisse. **Observação para A9, sem tarefa criada por A1.**
- **Sem commit** — `dist/` é ignorado (`.gitignore:5`), logo esta tarefa **não** produz alteração
  versionada nenhuma.

#### OPS-005 · Decidir o destino de `dev/null` (PC-4) — A1 · P3 · `DONE`

- **Descrição:** ficheiro extraviado (7729 B) criado por um `2>/dev/null` que escreveu num  
  caminho literal. Não rastreado e **não** ignorado — um `git add -A` futuro apanha-o.
- **Critérios:** removido (Reciclagem do sistema, **nunca** `rm`) ou ignorado explicitamente.
- **Nota:** decisão do utilizador. Nenhuma revisão read-only o deve remover sozinha.

**Implementação e provas (A1, 2026-09-22) — `DONE`:**

- **Decisão do utilizador (2026-09-22, 16:30):** *remover e acrescentar uma regra de ignore
  específica*, com três verificações exigidas.
- **O que o ficheiro era, afinal.** O `PC-4` chamava-lhe «artefacto extraviado»; a investigação
  mostrou mais: é uma **cópia transpilada de `apps/api/scripts/check-integrity.mjs`** — mesma lógica
  e mesmas etiquetas, comentários removidos, aspas normalizadas para `"`, não-ASCII escapado
  (`inv\xE1lido`, `\xF3rf\xE3os`) e `100_000_000` reduzido a `1e8`. É a assinatura de uma passagem
  por um transpilador com a saída para *stdout*, redirecionada para o caminho literal `dev/null` em
  vez do dispositivo nulo. **Não continha segredos** (`grep` de
  `secret|password|api_key|bearer|token` → **0**) e **nada o referenciava**.
- **Decisão aplicada: removido e ignorado.** `dev/null` (7 729 B) e o diretório `dev/` foram para a
  **Reciclagem do sistema**, nunca `rm` (`SHFileOperationW` com `FOF_ALLOWUNDO`). Acrescentada ao
  `.gitignore` (**linha 45**) uma regra **estreita** — `dev/null`, com o porquê escrito por cima —,
  estreita de propósito: `dev/` é um nome de diretório legítimo em muitos projetos, e ignorá-lo
  inteiro esconderia trabalho futuro.
- **As três verificações exigidas, medidas:**

  | Verificação | Resultado |
  | --- | --- |
  | `dev/null` já não existe | `ls dev/null` → *No such file or directory*; `dev/` também removido |
  | o ignore funciona | **teste funcional**: recriou-se `dev/null` e `git check-ignore -v` devolveu `.gitignore:45:dev/null`; `git status --porcelain` e `git ls-files --others --exclude-standard` **não** o listaram |
  | `check-integrity.mjs` intacto | `sha256 543faf6cd847e7ee…` **idêntico** antes e depois |

- **Prova de que o ficheiro é recuperável.** A remoção devolveu `1223` (`ERROR_CANCELLED`) — um
  estado parcial do shell, não uma falha. Verificado na Reciclagem: a entrada `$RJDZSFN` tem
  **7 729 bytes** e `sha256 99fed23b8a9ef2fb…`, **exatamente igual** ao do `dev/null` original.
  **Causa do 1223, para não se repetir:** passou-se o ficheiro **e o seu diretório-pai na mesma
  chamada**; em chamadas separadas, ambas devolveram `2` (sucesso). Regra: **um alvo por chamada,
  ou pelo menos nunca um ficheiro junto do seu pai.**
- **Sem commit** — `dev/null` não era rastreado e o `.gitignore` **é** rastreado: esta tarefa produz
  **uma** alteração versionada (a regra), e é a única.

#### OPS-006 · CI: trabalho de integração em produção (PostgreSQL) — A1 · P3 · `BACKLOG`

- **Descrição:** o terceiro trabalho previsto em `OPS-001` e **não implementado** — o único dos
  `verify*` que ficou fora do CI. `apps/api/scripts/verify-integration.mjs` exige o **build de
  produção** montado: `npm run build`, servidor em `NODE_ENV=production`, e `verify:integration`
  contra ele. `core/prisma-client.ts` **recusa SQLite em produção**, pelo que o trabalho exige
  **PostgreSQL** — que num runner de GitHub Actions se obtém com um `services:` de `postgres`.
- **Porque não foi feito em `OPS-001`:** não era executável nem uma vez neste ambiente (sem
  PostgreSQL, sem Docker), e um trabalho de CI que nunca correu é uma afirmação sem prova. Registado
  em vez de inventado (§1.2).
- **Critérios de aceitação:** o trabalho arranca um `services: postgres`; aplica o schema canónico
  (`prisma/schema.prisma`); constrói (`npm run build`) e arranca em `NODE_ENV=production`; corre
  `verify:integration`; e **uma falha de integração falha o CI**.
- **Dependências:** `OPS-001` (o esqueleto do CI e o classificador).
- **Nota:** confirmar no primeiro run real o endereço da sonda — a saúde vive fora do prefixo
  versionado (`PC-33`) e foi exatamente aqui que o autor do `ci.yml` errou.
- **Estratégia de PostgreSQL ainda por decidir, e é pré-requisito da tarefa.** A tarefa não pode ser
  dada como demonstrada enquanto não estiver escolhido **onde** o trabalho corre (um `services:
  postgres` num runner de GitHub Actions, ou outro ambiente com PostgreSQL real) e **quem** o mantém.
  Não há PostgreSQL nem motor de contentores neste ambiente (`PC-38`), pelo que qualquer afirmação
  de sucesso obtida aqui seria afirmação sem prova. `BACKLOG` é o estado honesto até essa decisão.

### 5.8 Testes (A1)

#### TEST-001 · Testes de rota para `vehicles`, `financial`, `compliance`, `reminders` — A1 · P1 · `DONE`

- **Descrição:** PC-5. A cobertura está concentrada em import/export. Estas quatro áreas têm  
  **zero** ficheiros de teste em `npm test`; são verificadas só pelos `verify*`, que exigem  
  servidor a correr e não correm automaticamente.
- **Objetivo:** mover a verificação de "disciplina manual" para "garantia automática".
- **Critérios de aceitação:**
  - cada uma das quatro áreas tem testes de rota no padrão já existente  
    (`createTestDb()`, `createApp()`, supertest);
  - cobrem sucesso, validação, autorização e isolamento entre contas;
  - nenhum teste reimplementa a lógica que devia vigiar (ver `AUD-004`);
  - a suíte continua a correr em `npm test` sem servidor.
- **Padrão a seguir:** `apps/api/test/documents-http.test.ts` (arranque) e  
  `apps/api/test/fuel-consumption-http.test.ts` (fronteira HTTP).

**Implementação e provas (A1, 2026-09-22):**

- **Ficheiros criados:** `test/vehicles-http.test.ts` (**22** testes), `test/financial-http.test.ts`
  (**30**), `test/compliance-http.test.ts` (**62**), `test/reminders-http.test.ts` (**47**) —
  **161 testes novos**, no padrão já existente (`createTestDb()` + `createApp()` + Supertest, base
  temporária fora do repositório, sem servidor externo, conta própria por teste).
- **Cobertura por área:** percurso completo (criar/ler/editar/apagar + lista), validação (422),
  autenticação (401 sem sessão e com token inválido) e isolamento entre contas (**404**, nunca
  403, com o registo do dono intacto) — os quatro pontos pedidos, nas quatro áreas.
- **Decisão de desenho em `compliance`:** uma **tabela** (`describe.each`) para os quatro recursos,
  que têm exatamente a mesma forma de rota, em vez de quatro ficheiros quase iguais. Os payloads e
  as entradas inválidas de cada recurso continuam **explícitos e distintos** — uma abstração que os
  tornasse intercambiáveis não provaria nada sobre nenhum.
- **Provas por mutação** (4 mutações, uma por área; ficheiros repostos e confirmados por `sha256`):

  | Mutação | Resultado |
  | --- | --- |
  | `ausente()` deixa de ver o campo omitido (`reminders.ts`) | **3 vermelhos** / 44 verdes |
  | cascata `deleteLinkedExpense` removida de `deleteFuelSession` | **1 vermelho** / 27 verdes |
  | `requireRecord` perde o filtro de dono (`shared.ts:156`) | **11 vermelhos** / 51 verdes |
  | `Location` removido da criação de veículo (`vehicles.ts:98`) | **1 vermelho** / 21 verdes |

- **Duas mutações sobreviventes, investigadas e não ignoradas:**
  1. trocar `linkedRecordType: 'fuel'` por `'charging'` **sobreviveu** — é uma mutação
     **equivalente** para o contrato testado: a cascata usa `fuelSession.expenseId`
     (`records-financial.ts:494`), não o tipo gravado na despesa. Substituída por uma mutação que
     ataca a cascata a sério (linha 2 da tabela).
  2. remover o `Location` **sobreviveu na primeira tentativa** — o teste **não** o verificava,
     apesar de o cabeçalho do ficheiro o afirmar. **Era um defeito do próprio teste**, encontrado
     pela mutação e corrigido: acrescentado o teste que o fixa (é ele que dá o vermelho da linha 4).
- **`typecheck`:** `npm run typecheck` → **exit 0** nos três workspaces. Os testes **não** são
  verificados por esse comando (`PC-15`); um `tsc` explícito sobre os quatro ficheiros encontrou
  **um erro de tipo real, meu** — corrigido. Ver `PC-15` para a evidência completa.
- **Suíte completa:** **43 ficheiros, 1703 testes, 0 falhas**. Duas execuções completas seguidas
  **não deram o mesmo resultado**: a primeira terminou com **1 ficheiro** marcado como falhado por
  `EBUSY` no teardown (`PC-26`, `oauth-google.test.ts`) e **exit code 1 com todos os testes
  verdes**; a segunda terminou limpa (**43/43**). `PC-26` é, portanto, **intermitente** — pior do
  que determinístico, porque um CI que trate o exit code como verdade fica vermelho **ao acaso**.
  É exatamente o ruído que o critério novo de `OPS-001` tem de distinguir.
- **Encontrado durante a execução:** `AUD-014` (um lembrete sem condição era aceite), `PC-30`,
  `PC-31` e `AUD-015` — registados **antes** de corrigidos (§1.2).
- **Sem commit** — alterações deixadas no working tree.

#### TEST-002 · Teste de contrato: `packages/shared` ↔ API — A1 · P2 · `DONE`

- **Descrição:** o contrato é "a única definição de despesa ou lembrete no projeto". Nada  
  verifica automaticamente que a API o cumpre e que o cliente o consome.
- **Critérios:** um teste falha quando a API deixa de cumprir um esquema de `contracts.ts`, ou  
  quando um tipo de `types.ts` diverge da resposta real.

**Implementação e provas (A1, 2026-09-22) — `DONE`:**

- **Novo `apps/api/test/contract-http.test.ts`** (737 linhas, **12 testes**, `sha256 ba01cc0e…`).
  **Nenhum ficheiro de produção foi alterado** — confirmado por `sha256` em `http/handlers.ts`,
  `http/routes/financial.ts`, `http/routes/reminders.ts` e `packages/shared/src/types.ts` (todos
  repostos) e no próprio `ROADMAP.md` (**intacto** durante a execução).
- **O contrato tem duas metades, com fontes de verdade diferentes** — e foi isso que ditou o desenho:
  **entrada** = esquemas **Zod** de `contracts.ts` (código em tempo de execução, aplicado por
  `parseBody`); **saída** = **tipos** de `types.ts` (sem existência em tempo de execução, impostos
  pelos mapeadores anotados de `domain/payload.ts`).
- **As duas metades do critério, e onde cada uma é provada:**
  1. **A API aplica os esquemas de `contracts.ts`** — as violações são **derivadas do próprio
     esquema**, não escritas à mão: 6 campos obrigatórios, **52 substituições de tipo** e 4 casos de
     conteúdo, todos confirmados com `schema.safeParse(...)` **antes** de serem enviados (se um
     deixar de ser violação, o teste acusa *«a asserção ficou vazia»* em vez de passar em silêncio).
     A recusa não se contenta com o `422`: exige que `error.fields[].path` **nomeie o campo** — o que
     distingue a validação do esquema (`validationFailed`) de uma regra de serviço que por acaso
     também recuse aquele corpo.
  2. **A resposta real tem a forma de `types.ts`** — o oráculo é o **mapeador da API**, não uma lista
     de campos escrita no teste. Assim **não há uma segunda definição do contrato** que possa
     divergir em silêncio; a completude do oráculo é uma obrigação do `typecheck` que já existe sobre
     `src/**`. A comparação é feita **depois da serialização** (`JSON.parse(JSON.stringify(...))`), e
     é isso que apanha o campo que o `JSON.stringify` faz desaparecer — o único buraco que a
     compilação não vê.
- **Provas:**

  | Prova | Resultado |
  | --- | --- |
  | `vitest run test/contract-http.test.ts` | **12/12**, `exit 0`, 11,07 s |
  | `vitest run` (suíte completa) | **45 ficheiros / 1 725 testes**, `exit 0`, 306,63 s (eram 1 713, +12) |
  | `typecheck` da API | `exit 0` |
  | `typecheck` do partilhado | `exit 0` |
  | `verify:config` | `exit 0` — **12 corretos, 0 incorretos** |
  | `tsc` explícito do teste novo (fora do repositório) | `exit 0` — **zero erros** |

- **Prova por mutação — 4 mutações, cada uma a medir uma asserção diferente:**

  | # | Mutação | Vermelhos | O que mede |
  | --- | --- | --- | --- |
  | `M1` | `parseBody` deixa de recusar (`handlers.ts`) | **4** | as 3 de entrada + o envelope de erro (a 4.ª por a **primeira** asserção do envelope ser `status === 422`; fica dito para não ser lida como «o envelope está mal») |
  | `M2` | `POST /records/expenses` valida com `zExpenseUpdateRequest` (`financial.ts`) | **1** | localiza a **propriedade** afetada: `.partial()` retira a obrigatoriedade mas mantém o tipo, logo só a asserção de campos obrigatórios cai |
  | `M3` | `POST /reminders` responde com um campo a mais (`reminders.ts`) | **1** | a **camada de rota**, onde **não há anotação** e o `typecheck` ficaria verde |
  | `M4` | `Reminder` ganha `auditNote` (`shared/src/types.ts`) | `typecheck` **exit 2** | `payload.ts:583 TS2741` — a ligação `types.ts` ↔ mapeador é imposta pela compilação que **já existe**, sem configuração nova |

  Todas repostas e confirmadas por `sha256`. A guarda de âncora **abortou duas tentativas de `M1`
  antes de escrever** (0 ocorrências por indentação errada; depois 3, porque `if (!result.success)`
  existe em `parseBody`, `parseQuery` e `parseParams` — mutar as três mediria outra coisa).
  *(Nota de execução: `M4` exigiu reconstruir `packages/shared`, porque o `typecheck` da API resolve
  `@zemlo/shared` pelo `dist` do pacote e não pelo `src` — ver a skill
  `zemlo-teste-contrato-partilhado-api`.)*
- **Limitação declarada (a mais importante deste desenho):** se a **anotação de retorno** de um
  mapeador for removida, a comparação continua verde e a garantia de completude desaparece **sem
  ruído**. A anotação é a única coisa que liga o mapeador ao contrato, e a sua remoção não é detetada
  nem pelo teste nem pelo `typecheck`. Está escrito no cabeçalho do ficheiro.
- **Fora do âmbito (declarado, não esquecido):** as restantes rotas (`documents`, `integrations`,
  `import`, `insights`, `compliance`, `auth`); `verify` e `verify:regressions`, que exigem servidor
  vivo e não têm o que verificar num trabalho sem alterações de produção.
- **Material para `PC-15`:** este ficheiro é **limpo em tipos** sob um `tsc` explícito (`exit 0`,
  zero erros), porque **infere** o tipo do cliente Prisma
  (`(typeof import('../src/core/db.js'))['prisma']`) em vez de o anotar com `PrismaClient` — é a
  diferença exata que produz o `TS2322` pré-existente do harness. Registado na linha do `PC-15`.
- **Problemas encontrados — dois, medidos e `NÃO` absorvidos** (a ordem recebida foi explícita
  nisso): mensagens de validação em inglês (**`PC-35`**) e envelopes de lista fora do contrato
  (**`PC-36`**). Ambos exigem **tarefa própria e decisão de produto/contrato** — nenhum foi resolvido
  dentro de `TEST-002`.
- **Commit:** `ef0ebf6` — incluída na release publicada (consolidação de produto web, OAuth, agendador e documentos).

### 5.9 Documentação (A1)

#### DOC-001 · Corrigir os números do README — A1 · P2 · `CANCELLED`

> **Resolvida em 2026-09-22 (A9):** `AUD-010` é a dona, fechou, e `DOC-001` fica **`CANCELLED`**. O trabalho que descrevia está feito — ver `AUD-010` e `PC-7`.

*(Sobreposição deliberada com `AUD-010` — uma única tarefa deve ser escolhida. Manter `AUD-010`  
como dona e marcar `DOC-001` como `CANCELLED` ao fechar.)*

#### DOC-002 · Documentar o fluxo de coordenação para agentes — A1 · P3 · `BACKLOG`

- **Descrição:** §10 deste documento existe para ser copiada. Falta garantir que um agente novo  
  a encontra sem ler 900 linhas — provavelmente uma ligação no `README.md` e em  
  `docs/ARCHITECTURE.md`.
- **Critérios:** o README aponta para o ROADMAP; a regra dos dois momentos é encontrável em  
  menos de um minuto.

---

## 6. Contrato partilhado (`packages/shared`)

Área especialmente sensível. Qualquer agente que precise de alterar `contracts.ts`, `types.ts`,  
`registry.ts` ou outro contrato partilhado deve, **antes** de alterar:

1. criar/atualizar a tarefa no ROADMAP;
2. indicar o **impacto API**;
3. indicar o **impacto Web**;
4. indicar o **impacto Mobile**;
5. indicar **quais agentes** precisam de adaptar código.

**Não são permitidas alterações silenciosas ao contrato.** Um campo novo em `types.ts` é uma  
alteração que a mobile pode ter de acompanhar; um esquema Zod alterado é uma alteração que a  
web pode ter de refletir.

Tarefas que tocam o contrato: `AUTH-002` (esquemas de OAuth) e `MOB-001` (estratégia de  
sincronização) estão **`DONE`** — ver §6.1 e §5.4. O que **resta** de contrato está em `PC-21`  
(retirar o `storageKey` do pedido), `PC-36` (os envelopes de `/vehicles` e `/reminders` divergem de  
`Page<T>`) e `PC-42` (os 19 `CodeOf<…>` que resolvem para `string`): **os três exigem decisão  
antes de implementar**, e nenhum tem tarefa atribuída.
(estratégia de sincronização).

> **`PROD-001` já não consta desta lista (2026-09-22).** Estava aqui porque se previa um  
> "payload de upload" em `zDocumentCreateRequest`. A decisão `A` (`docs/DECISIONS.md` A31)  
> acrescentou o upload **sem tocar no contrato** — `POST /documents/:documentId/content` com  
> corpo cru, separado da criação. `packages/shared/src/contracts.ts` não foi alterado, e por  
> isso não houve nada a coordenar com A2/A3. O que **resta** de contrato é `PC-21` (retirar o  
> `storageKey` do pedido), que é uma alteração própria e ainda não autorizada.

### 6.1 Registo de alteração declarada — `AUTH-002` (2026-09-22, A2)

Declaração obrigatória **antes** de tocar o contrato, conforme os cinco pontos acima.

| Ponto | Declaração |
| ----- | ---------- |
| **1. Tarefa** | `AUTH-002` — Login Google (OAuth). Detalhada em §5.2 com as quatro decisões de produto fechadas |
| **2. Impacto API** | **Aditivo, não quebra nada.** Novos esquemas de **resposta** e de **query** para o início do fluxo e o callback. Nenhum esquema existente é alterado, removido ou tornado mais estrito — `zSignUpRequest`, `zLoginRequest`, `zSecondFactor` e os restantes ficam intactos. Os endpoints são novos; nenhuma rota existente muda de forma |
| **3. Impacto Web** | **Nenhum obrigatório nesta tarefa.** A web consome o contrato partilhado, mas `AUTH-002` entrega o fluxo servidor-a-servidor; o botão desativado em `LoginPage.tsx:166`/`SignUpPage.tsx:174` só passa a ter destino quando existir trabalho de interface, que **não** é desta tarefa. A3 tem de ser **avisado** de que os esquemas passam a existir, para não os duplicar |
| **4. Impacto Mobile** | **Nenhum nesta tarefa.** O fluxo OIDC em mobile exige um tratamento de redirecionamento próprio (browser externo / `ASWebAuthenticationSession`), que é `MOB-002`. A3 fica avisado de que o contrato ganhou esquemas novos |
| **5. Agentes que adaptam código** | **Nenhum é obrigado a adaptar.** A2 é o único autor da alteração. A3 (web e mobile) é **avisado** — é o consumidor do contrato partilhado (§8.1) e a regra é não duplicar contratos |

**Estado:** declarado. `packages/shared/src/contracts.ts` é ficheiro de conflito partilhado com  
`PROD-001` e `MOB-001` (§8.1) — a alteração é feita por A2 em bloco próprio e **aditiva**.

---

## 7. Base de dados / Prisma

Qualquer alteração a `schema.prisma`, migrations, índices, relações, campos ou enums **tem de  
aparecer explicitamente na tarefa**, registando:

- migration necessária;
- impacto PostgreSQL;
- impacto SQLite;
- necessidade de regenerar o schema SQLite;
- seed afetado;
- compatibilidade.

**Nunca editar manualmente `apps/api/prisma/sqlite/`** — é uma variante **gerada** a partir do  
canónico (A1). Usar `npm run db:sync-schema`.

Estado atual: 3 migrations (`0_init`, `import_book_entry`, `column_map`); dual-provider com  
clientes gerados separados. ~~Nenhuma tarefa `READY` nesta fase altera o schema.~~ **Deixou de  
ser verdade em 2026-09-22:** `AUTH-002` está `READY` e altera o schema — ver o registo abaixo.

### 7.1 Registo de alteração de schema — `AUTH-002` (2026-09-22, A2)

Alteração declarada **antes** de implementar, conforme os seis pontos acima.

**O que muda:** o modelo `User` ganha uma garantia de unicidade no par do identificador  
federado.

```prisma
/// Provedor de identidade federada: `google`, `apple` ou `null` para email/password.
authProvider    String?
authProviderId  String?
...
@@index([authProvider, authProviderId])      // REMOVIDO
@@unique([authProvider, authProviderId])     // ACRESCENTADO
```

| Ponto | Declaração |
| ----- | ---------- |
| **1. Migration necessária** | **Sim.** Nova pasta em `apps/api/prisma/migrations/<timestamp>_federated_identity_unique/` com o `migration.sql` do índice único. É a **4.ª** migration. A variante SQLite **não** leva migration própria: é derivada e aplicada por `db push` (ver ponto 3) |
| **2. Impacto PostgreSQL** | Cria um índice único em `users(auth_provider, auth_provider_id)`, substituindo o índice não-único. **Não pode falhar a construção:** verificado em 2026-09-22 que **nenhum** ficheiro em `apps/api/src`, `apps/api/test`, `apps/api/scripts`, `packages/shared/src` ou `apps/web/src` escreve `authProvider`/`authProviderId` (`grep` sem resultados) e o `seed.ts` também não — logo todas as linhas existentes têm `NULL` nos dois campos. O PostgreSQL trata `NULL` como distinto em índices únicos, pelo que várias contas com `NULL` continuam a coexistir. **Sem perda de dados e sem backfill** |
| **3. Impacto SQLite** | Nenhum trabalho manual. `prisma/sqlite/schema.sqlite.prisma` é regenerado a partir do canónico e o `@@unique` passa **inalterado** pelo `sync-sqlite-schema.mjs` (o script só transforma `datasource`, `generator` e atributos de tipo — verificado). Os testes aplicam-no com `prisma db push` (`test/helpers/db.ts:94`), o mesmo caminho da aplicação. O SQLite também trata `NULL` como distinto |
| **4. `db:sync-schema`** | **Obrigatório.** Sem correr `npm run db:sync-schema`, o ficheiro derivado fica desatualizado e `npm run db:check-schema` (o check de CI) **falha**. É o passo que mantém os dois provedores coerentes |
| **5. Seed afetado** | **Não.** `prisma/seed.ts` não escreve nem lê `authProvider`/`authProviderId` |
| **6. Compatibilidade** | **Aditiva e retrocompatível.** O índice é mais estrito do que o anterior, mas só no par `(authProvider, authProviderId)`, que nada escreve hoje — não há caminho de código existente que passe a violar a constraint. Nenhum campo é removido ou renomeado; nenhum cliente da API é afetado. A regra de negócio que isto passa a garantir é a de `AUTH-003`: *duas contas nunca partilham o mesmo identificador federado* |

**Risco declarado:** a unicidade é **estrutural**, mas a aplicação tem de **tratar** a violação  
`P2002` na criação/associação em vez de a deixar propagar como erro interno — é o critério  
«tratar corretamente uma eventual violação de unique constraint». A verificação aplicacional  
mantém-se, como **complemento** e não como única garantia (D4).

**Relacionado:** `PC-25` (§2) registou a lacuna antes desta correção.

---

## 8. Conflitos e dependências entre agentes

A divisão é por **responsabilidade funcional**, não por ficheiros. Onde duas tarefas precisam  
do mesmo ficheiro, isso está assinalado como conflito.

### 8.1 Conflitos potenciais (mesmo ficheiro, agentes diferentes)

| Ficheiro                                     | Tarefas                                       | Risco                                | Mitigação                                                                   |
| -------------------------------------------- | --------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------- |
| `apps/api/src/http/routes/auth.ts`           | `AUTH-001`, `AUTH-002`                        | A2 com A2 — sequencial, não paralelo | Ordem por dependência                                                       |
| `packages/shared/src/contracts.ts`           | `AUTH-002`, `PROD-001`, `MOB-001`             | **A2 · A4 · A3 no mesmo ficheiro**   | Serializar: cada um cria tarefa própria e avisa (§6)                        |
| `apps/web/src/pages/records/RecordsPage.tsx` | `AUD-002`, `AUD-008`, `WEB-004`               | **A1 e A3 no mesmo ficheiro**        | A1 faz `AUD-002`/`AUD-008` primeiro; `WEB-004` só depois                    |
| `apps/api/src/services/email.ts`             | `AUTH-001`, `AUD-004`                         | **A2 e A1**                          | `AUD-004` é teste + redação; `AUTH-001` é ligação. Coordenar antes de tocar |
| `docs/API.md`                                | `AUTH-002`, `PROD-001`, `PROD-002`, `AUD-009` | Vários                               | Uma secção por tarefa; editar em blocos distintos                           |
| `apps/api/scripts/verify.ts`                 | `AUD-012`                                     | A1 só                                | Sem conflito                                                                |
| `README.md`                                  | `AUD-010`, `DOC-002`                          | A1 só                                | Sequencial                                                                  |

### 8.2 Dependências entre tarefas

```text
AUD-001 ──(concluída)──► AUD-012            (o check passa a discriminar)
AUD-002 ──► WEB-004                          (o mapeamento antes do ecrã)
AUD-008 ──► WEB-004
AUTH-001 ──► WEB-001 ──► WEB-002             (email real antes do ecrã)
AUTH-001 ──► AUTH-002 ──► AUTH-003
AUTH-001 ──► AUTH-007
AUTH-001 ──► MOB-002
AUTH-001 ──► PROD-004                        (canal de aviso)
PROD-001 ──► WEB-003
PROD-002 ──► WEB-003
MOB-001 ──► MOB-002 ──► MOB-003, MOB-004, MOB-005, MOB-006
TEST-001 ──► OPS-001                         (o CI só prova algo com testes que mordem)
AUD-011 ──► OPS-003
```

### 8.3 Matriz de dependências principais

Usar apenas as dependências reais encontradas no projeto:

```text
AUTH        → WEB            (o ecrã de reposição depende do email real)
AUTH        → MOBILE         (o login federado define o fluxo de sessão do cliente)
SHARED CONTRACT → API        (a API aplica os esquemas Zod)
SHARED CONTRACT → WEB        (a web tipa-se pelo contrato)
SHARED CONTRACT → MOBILE     (a mobile consome o mesmo contrato — §34, proibido duplicar)
API         → WEB            (a web não tem lógica de domínio)
API         → MOBILE
DOCUMENT STORAGE → DOCUMENTS BYTES   (a capacidade existe; falta servi-la)
DOCUMENTS BYTES → WEB DOCUMENTS UI
EVENT MODEL (§33) → TIMELINE (§24)   (A5)
TIMELINE    → WEB TIMELINE UI
VEHICLE DOMAIN → OBD
VEHICLE DOMAIN → MANUFACTURER INTEGRATIONS
VEHICLE DOMAIN → TELEMETRY
MQTT        → HOME ASSISTANT
NOTIFICATIONS → SCHEDULER
CI          → (todas)        (nenhuma garantia é automática sem ele)
```

**Dependências que NÃO existem** (verificadas, para não serem inventadas):  
`FAMÍLIAS → FROTAS` (os modelos são independentes e ambos não expostos);  
`TCO → FROTAS` (TCO é por veículo); `MOBILE → WEB` (partilham a API, não código).

---

## 9. Tarefas READY por agente

Para que os quatro possam começar **sem nova sessão de planeamento**.

### A1 — Qualidade, auditoria e hardening

| Ordem | Tarefa                                                        | Prioridade |
| ----- | ------------------------------------------------------------- | ---------- |
| 1     | `AUD-002` — Timeline: links para rotas que a web não serve    | P0         |
| 2     | `AUD-004` — Teste do `ConsoleEmailSender` é falso verde       | P0         |
| 3     | `AUD-005` — `PATCH /records/charging` não recalcula derivadas | P0         |
| 4     | `AUD-008` — `/records/:kind` degrada em silêncio              | P1         |
| 5     | `TEST-001` — Testes de rota para as quatro áreas descobertas  | P1         |
| 6     | `OPS-001` — CI                                                | P1         |

> **Estado a 2026-09-22 (A9):** as **seis** tarefas desta fila estão **`DONE`** — a fila de A1 está
> vazia e aguarda atribuição. O que resta de A1 é o que continua **aberto** na §4: `AUD-003`,
> `AUD-006`, `AUD-007`, `AUD-011`, `AUD-013` (`BACKLOG`), `OPS-002` e `OPS-003` (`BLOCKED`) e
> `DOC-002` (`BACKLOG`). `DOC-001` está `CANCELLED`.

**Antes de A1 começar:** `AUD-003` e `AUD-006` estão em `BACKLOG` porque o diagnóstico detalhado  
tem de ser recuperado do relatório da auditoria funcional. `AUD-007` (🟠) idem. A1 deve começar  
pelo que está diagnosticado e recuperar o resto em paralelo.

### A2 — Identidade, autenticação e conta

| Ordem | Tarefa                                                   | Prioridade | Nota                                  |
| ----- | -------------------------------------------------------- | ---------- | ------------------------------------- |
| —     | `AUTH-001` — Transporte de email real + `setEmailSender` | P0         | **`DONE`** (2026-09-22) — implementada em `1eac3a7`, verificada e provada por A2 |
| —     | `AUTH-008` — Cobrir a recusa de arranque em produção     | P2         | **`DONE`** (2026-09-22) — fecha `PC-14` |
| —     | `AUTH-009` — Documentação da entrega de email            | P3         | **`DONE`** (2026-09-22) — fecha `PC-19` |
| —     | `AUTH-002` — Login Google                                | P1         | **`DONE`** (2026-09-22) — fecha `PC-25` e `PC-27`; abre `PC-28`/`PC-29` |
| 1     | `AUTH-003` — Associação de conta Google                  | P1         | dependência `AUTH-002` **satisfeita**; falta o detalhe prévio (§1.2) e a revisão adversarial de A1 |
| 3     | `AUTH-004` — Gestão de sessões                           | P2         | —                                     |

**A fila de email de A2 está fechada:** `AUTH-001`, `AUTH-008` e `AUTH-009` estão `DONE`, e com
elas os problemas `PC-14` e `PC-19`. `WEB-001`/`WEB-002` (A3) e `MOB-002` ficam desbloqueadas
quanto à entrega de email.

**`AUTH-002` passou de `BACKLOG` a `READY` em 2026-09-22.** O detalhe prévio que §1.2 exigia foi
feito **antes** de escrever código, e o levantamento desmentiu duas coisas que o documento
afirmava: (a) a funcionalidade **não** existe (`.env` configurado ≠ código); (b) o schema **já**
tinha `authProvider`/`authProviderId`, mas o índice **não** era único — `PC-25`. As quatro
decisões de produto estão registadas em §5.2 com o que foi recusado, o impacto no contrato em
§6.1 e a alteração de schema em §7.1.

**`AUTH-002` → `DONE` em 2026-09-22** (implementada, provada e documentada; **sem commit**). O fecho
completo está em §5.2. Fecha `PC-25` e `PC-27`; abre `PC-28` e `PC-29`. `AUTH-003` fica com a
dependência satisfeita, mas **não** foi começada: o caso da associação por coincidência de email é
a decisão de maior risco de segurança do conjunto e exige detalhe prévio próprio (§1.2) **e**
revisão adversarial de A1 — não se começa por arrastamento de uma tarefa anterior.

### A3 — Web e Mobile

| Ordem | Tarefa                                    | Prioridade | Nota                                  |
| ----- | ----------------------------------------- | ---------- | ------------------------------------- |
| —     | `WEB-005` — Auditoria de estados          | P2         | **`DONE`** (2026-09-22) — 6 correções, 11 testes provados por mutação |
| —     | `WEB-006` — Acessibilidade                | P2         | **`DONE`** (2026-09-22) — 4 correções, 28 testes, 3 rondas de mutação |
| —     | `MOB-001` — Arquitetura Flutter           | P1         | **`DONE`** (2026-09-22) — `apps/mobile` criado, contrato gerado, 3 mutações |
| —     | `WEB-011` — Contraste WCAG (medido)       | P2         | **`DONE`** (2026-09-22) — 0 falhas nos 2 temas, 58 testes, 15 mutações |
| —     | `WEB-004` — Ecrãs de registos por tipo    | P1         | **`DONE`** (2026-09-23) — 4 ecrãs (inspeções, impostos, seguros, odómetro), 22 testes, 12 mutações |
| 3     | `WEB-012` — Anunciar mudança de página    | P2         | `READY` — **bloqueada por decisão de política** (3 escolhas em aberto) |
| —     | `WEB-009` — «Validade» duplicado          | P2         | **`DONE`** (2026-09-23) — 1 campo duplicado removido, 3 testes, 2 mutações |
| —     | `WEB-013` — Ciclo de sessão da web         | P1        | **`DONE`** (2026-09-22, consolidado por A9 em 2026-09-23) — `setTokens` com uma só fonte, rotação preservada, renovação única, 17 testes, 4 mutações |
| —     | `WEB-010` — Mês no cabeçalho do calendário | P3        | **`DONE`** (2026-09-23) — 2 linhas, 19 testes, 6 mutações |
| —     | `WEB-001` — Ecrã "Esqueci-me da password" | P0         | **`DONE`** (2026-09-22) — desbloqueada por `AUTH-001`; sem teste automático do ecrã |
| —     | `WEB-003` — Documentos na interface       | P0         | **`DONE`** (2026-09-22) — `PROD-001`/`PROD-002` fechadas; falta o envio na web (decisão de produto) |

A3 tem **onze tarefas `DONE`** (`WEB-001`, `WEB-002`, `WEB-003`, `WEB-004`, `WEB-005`, `WEB-006`,
`WEB-009`, `WEB-010`, `WEB-011`, `WEB-013`, `MOB-001`), duas `READY` sem dependências (uma delas à espera de decisão de
política) e as restantes bloqueadas por `MOB-002`. **`WEB-013` fechou a 2026-09-22** (consolidado
por A9 a 2026-09-23, ver §5.3): o cliente web descartava o token de renovação e a sessão durava 1
hora em vez dos 90 dias configurados — corrigido com **17 testes** e **4 mutações** mortas.
**`MOB-007` mantém-se `READY`** como o **gate do ambiente Flutter** — `MOB-002` não deve ser
considerada operacionalmente concluída enquanto não passar. **`WEB-010` fechou a 2026-09-23** (ver §5.3): o
título do mês passou a `monthLong`, com **19 testes** que mordem (**9 vermelhos** no código
pré-correção) e **6 mutações** mortas. *(Correção de A9, 2026-09-23: a contagem anterior dizia
«cinco» e omitia `WEB-002`, que §4 já declarava `DONE`; esta tabela continua a **não** listar
`WEB-002` — lacuna registada, não corrigida aqui.)*

### A4 — Produto e backend funcional

| Ordem | Tarefa                                         | Prioridade | Nota                                  |
| ----- | ---------------------------------------------- | ---------- | ------------------------------------- |
| —     | `PROD-003` — Revisão de completude por domínio | P1         | **feita** — produto em §3.7; `REVIEW` |
| —     | `PROD-002` — Documentos: download              | P0         | **já estava feito** (`94b72c5`) — `DONE` |
| —     | `PROD-001` — Documentos: upload                | P0         | **feita** (decisão `A`, §A31) — `DONE` |
| —     | `PROD-007` — Documentos: remover bytes ao eliminar | P2     | **`DONE`** (2026-09-23) — 11 testes, 4 mutações |
| —     | `PROD-008` — Documentos: substituir o ficheiro | P2         | **`DONE`** (2026-09-23) — `PUT`, 17 testes, 8 mutações |
| —     | `PROD-004` — Agendador de notificações         | P2         | **`DONE`** (2026-09-23) — núcleo partilhado + runner in-process, 15 testes, 9 mutações |
| —     | `INT-001` — Publicação MQTT                    | P2         | **`DONE`** (2026-09-23) — 69 testes, 16 mutações (14 mortas) |

**`PROD-003` vem primeiro de propósito:** antes de construir, verificar. O inventário de §3 foi  
levantado por documentação e amostragem; A4 deve substituí-lo por estado verificado domínio a  
domínio, para não construir o que já existe.

**Resultado de `PROD-003` (2026-09-22):** a fila acima foi **encurtada por verificação**.  
`PROD-002` já estava implementada, testada e documentada em `main` desde 2026-09-20; 12 dos 15  
domínios estão completos. A fila real de A4 é o **upload** (`PROD-001`), a **higiene de  
armazenamento** (`PROD-007`), o **agendador** (`PROD-004`) e o **MQTT** (`INT-001`).

---

## 10. Regra para os agentes

*(Secção para copiar para qualquer agente, sem alterações.)*

> Antes de implementar, consultar `docs/ROADMAP.md`.  
> A tarefa deve existir e estar atribuída ao agente.  
> Se surgir trabalho novo, atualizar primeiro o ROADMAP.  
> Depois da implementação, atualizar o estado da tarefa.  
> Uma tarefa só passa a `DONE` depois de testes e validações.  
> Não fazer push/deploy sem autorização.  
> Não alterar tarefas de outro agente sem coordenação.  
> Não alterar contratos partilhados silenciosamente.  
> Não marcar uma tarefa como concluída apenas porque compila.

---

## 11. Protocolo de trabalho dos agentes

### No início de cada tarefa, apresentar

- ID da tarefa;
- objetivo;
- dependências;
- ficheiros/áreas esperados;
- riscos de conflito (§8.1).

### No final de cada tarefa, apresentar

- implementação;
- ficheiros alterados;
- testes;
- typecheck;
- migrations;
- documentação;
- problemas descobertos (→ §2 «Problemas conhecidos»);
- novas tarefas criadas;
- estado da tarefa;
- commit, se autorizado.

### Regras que não se negociam

1. **Nada de trabalho escondido.** Trabalho adicional vira tarefa nova, não uma nota dentro da  
   original.
2. **Nada de contratos silenciosos.** §6.
3. **Nada de `DONE` por compilação.** §1.4.
4. **Nada de testes que passam por vacuidade.** Um teste que reimplementa a lógica que devia  
   vigiar é um falso verde — foi assim que `AUD-004` apareceu.
5. **Nada de números inventados.** Onde falta dados, `null` e uma explicação (§49).
6. **Nada de push/deploy sem autorização explícita**, em nenhuma circunstância.

---

## 12. Milestones

Não são finais — derivam do estado real e mudam com ele.

### M0 — Hardening pós-MVP

Fechar a auditoria e tornar a verificação automática.  
`AUD-001`–`AUD-012`, `TEST-001`, `TEST-002`, `OPS-001`, `OPS-004`, `OPS-005`, `DOC-001`.  
M0 cobre **todos** os 🔴 — incluindo `AUD-003` (🔴-3) e `AUD-006` (🔴-6), que estão em `BACKLOG` porque o diagnóstico tem de ser recuperado do relatório da auditoria funcional, e `AUD-007` (🟠). Não saem de M0 por falta de diagnóstico: recuperá-lo é o **primeiro passo** delas, não uma razão para as adiar. Enquanto não estiverem diagnosticadas, M0 não fecha.
**Critério de saída:** nenhum 🔴 aberto — os seis de origem (🔴-1 a 🔴-6), sem exceções — e os 🟠 importados; CI verde a correr `typecheck` + `test` + `verify*`;  
testes de rota para as quatro áreas descobertas.

### M1 — Identidade completa

`AUTH-001`–`AUTH-007`, `WEB-001`, `WEB-002`.  
**Critério de saída:** um utilizador pode recuperar a password sozinho, entrar com Google, e  
gerir as suas sessões. Nenhum utilizador fica sem saída.

### M2 — Produto Web

`PROD-001`, `PROD-002`, `PROD-003`, `PROD-004`, `WEB-003`–`WEB-008`, `AUD-009`.  
**Critério de saída:** nenhum ciclo meio aberto na interface (documento que não abre, lembrete  
que não avisa, ecrã errado).

### M3 — Mobile

`MOB-001`–`MOB-006`.  
**Critério de saída:** app Flutter funcional a consumir a **mesma** API, sem contrato paralelo.

### M4 — Integrações

`INT-001` (publicação MQTT das entidades Home Assistant).
`INT-002`–`INT-004` **não** fazem parte deste milestone: estão `DEFERRED` e dependem de decisão de produto e de infraestrutura que não existe em desenvolvimento. Não entram num milestone enquanto essa decisão não estiver escrita.  
**Critério de saída:** pelo menos uma integração real a publicar dados, com degradação explícita  
quando falta infraestrutura.

### M5 — Plataforma avançada

`PROD-005`, `PROD-006`, `INT-005`.  
**Critério de saída:** por definir — exige decisão de produto e especificação (§3.6).

---

## 13. Histórico de alterações deste documento

| Data       | Alteração                                                                           |
| ---------- | ----------------------------------------------------------------------------------- |
| 2026-09-22 | Criação. Inventário inicial, divisão A1–A4, milestones M0–M5, protocolo de agentes. |
| 2026-09-22 | Revisão de consistência: M4 deixa de incluir `INT-002`–`INT-004` (estão `DEFERRED`); M0 explicitamente abrangente sobre todos os 🔴, incluindo os que aguardam diagnóstico; contagem de testes de `AUD-001` corrigida (17 → 20); `AUTH-001` com restrição explícita de preservação do SMTP de produção. §§6–11 inalteradas. |
| 2026-09-22 | Criado `docs/AGENT-PROMPTS.md` — quatro prompts de arranque (A1–A4), com contexto comum, primeira tarefa e fila de cada agente. |
| 2026-09-22 | A3 · `WEB-005`: inventário de estados das 32 rotas (leitura de `App.tsx` e de cada página) registado na tarefa; `WEB-005` → `IN_PROGRESS`; 6 achados (D1–D6) com âmbito fechado; descrições de `WEB-001`, `WEB-002` e `WEB-003` **corrigidas** — descreviam como inexistente trabalho já implementado (`PC-11`); criados `PC-10` (texto desatualizado, para `AUD-009`) e `WEB-009` (campo duplicado). |
| 2026-09-22 | A4 · `PROD-003`: revisão de completude por domínio concluída — **§3.7** nova (15 domínios, estado + evidência `ficheiro:linha` + tarefa associada); §3.2 corrigida nas linhas desatualizadas (recuperação de password, documentos, email). **`PROD-002` verificada como já implementada** em `main` desde `94b72c5` → `DONE` (80 testes verdes, typecheck exit 0). Criados `PC-12` (inventário desatualizado face ao código — alarga `PC-11`) e `PC-13` (bytes de documentos nunca apagados) e a tarefa **`PROD-007`**. Fila de A4 reordenada em §9. `PROD-003` → `REVIEW`. |
| 2026-09-22 | A4 · `PROD-001`: upload de documentos implementado pela **decisão `A`** — `POST /documents/:documentId/content` com corpo cru, dois passos, `zDocumentCreateRequest` **intocado** (§6 cumprido por não haver alteração de contrato). Decisão registada em **`docs/DECISIONS.md` A31**, porque a regra dela sai para lá da tarefa: a isenção do `requireJsonBody` passa a depender de **método + caminho** quando o caminho serve duas representações (vale para `INT-002`–`INT-004`). `PROD-001` → `DONE`; `docs/API.md` com a secção «Upload dos bytes (§A31)»; §3.7 atualizada (13/15 domínios). Criados `PC-21` (`storageKey` ainda aceite do cliente no contrato — requer §6) e a tarefa **`PROD-008`** (substituir o ficheiro). **`PROD-007` não foi tocada nem absorvida** — continua independente. Provas: suíte completa **36 ficheiros / 1504 testes / 0 falhas**, typecheck exit 0, `db:check-schema` sincronizado, 3 mutações sem sobreviventes. |
| 2026-09-22 | A1 · `AUD-002`: **diagnóstico corrigido** — o defeito não era o fallback do ecrã de despesas (inspeções, impostos e seguros **funcionam**); eram 2 rotas inexistentes (`document`, `reminder`). `recordHref` corrigida (`document` → `/documents/<id>`; `reminder`/`odometer` → `null`). Novo `test/timeline.test.ts` (30 testes), provado por mutação (9 falhas, ficheiro reposto por hash). Criados **`AUD-013`** (dicas de dados em falta: 4 de 7 `?sheet=` abrem `overview` em silêncio), **`PC-14`** (guarda de produção do `email.ts` desativado, com zero cobertura) e **`PC-15`** (`typecheck` exclui os testes). `AUD-002` → `DONE`. |
| 2026-09-22 | A2 · `AUTH-001`: **fechada como `DONE`** — estava já implementada desde `1eac3a7` (2026-09-20, publicado em `origin/main`); a descrição da tarefa descrevia o estado **anterior** a esse commit. Verificada com prova executável: 93 testes verdes em 6 ficheiros de email/SMTP/reset (incluindo `password-reset-integration.test.ts`, que registra o transporte **real** contra um servidor SMTP local numa porta efémera — a prova que `A4` registou como em falta), `typecheck` API/web/shared exit 0, e **3 mutações**: M1 (redação) e M3 (escolha do transporte) **mordem**; M2 (recusa de produção) **sobrevive à suíte completa** (35 ficheiros / 1478 testes, exit 0) — o que originou **`AUTH-008`** e corrigiu o **`PC-14`** (o `if (false && …)` que A1 detetou era a mutação M2 de A2, já reposta e confirmada por hash `66eefbd1…`). §3.2 corrigida nas duas linhas de email. Criados **`AUTH-008`**, **`AUTH-009`** e **`PC-19`** (docblock do `email.ts` afirma uma proteção que nunca existiu; `OPERATIONS.md` §3.4.1 desatualizada; `EMAIL_ALLOW_LOG_TRANSPORT` sem documentação). Fila de A2 reordenada em §9. **Sem commit.** |
| 2026-09-22 | A2 · `AUTH-008` + `AUTH-009`: **ambas `DONE`**. `AUTH-008` — criado `apps/api/test/email-startup.test.ts` (ficheiro novo, **7 testes**, `NODE_ENV=production` com `SMTP_HOST=''`, primeira asserção anti-vacuidade sobre `config.isProduction`); cobre recusa, mensagem de arranque, escapatória com aviso e rejeição de valores diferentes de `true`; **prova por mutação**: desativar o guarda faz **3 testes falharem** (exit 1), reposto por hash. `AUTH-009` — corrigido o docblock falso do `ConsoleEmailSender` (afirmava que `text` está em `SENSITIVE_KEYS`; nunca esteve, e a proteção real é `redactResetLinks()`), reescrita a §3.4.1 de `OPERATIONS.md` (a entrega **está** implementada, tabela de variáveis SMTP, validação no arranque, log com a chave `text` e `token=[redigido]`) e documentada `EMAIL_ALLOW_LOG_TRANSPORT`. Validação: 31/31 testes de email/SMTP, `typecheck` API exit 0, `tsc` explícito sobre o teste novo (`PC-15`) exit 0. `PC-14` e `PC-19` **fechados**. Fila de A2 em §9 reduzida a `AUTH-002`. **Sem commit.** |
| 2026-09-22 | A3 · `WEB-005` **concluída**: as 6 correções de estado aplicadas (7 ficheiros, +258/−11) — 4 separadores da ficha do veículo deixam de falhar em silêncio, `CalendarGrid` deixa de afirmar «nada marcado» durante o erro (e as props mortas `onRetry`/`error` são resolvidas), 5 buracos de ecrã em branco passam a estado explícito, o resumo do ano e a contagem de exportação ganham erro com repetição. Novo `apps/web/test/page-states.test.tsx` — **11 testes, 5 mutações, 5 vermelhos atribuídos**, ficheiros-fonte repostos e verificados por `sha256sum`; `typecheck` exit 0, **99 testes verdes**. Contrato `packages/shared` **intocado**. Criados **`PC-17`** e **`WEB-010`** (cabeçalho do calendário mostra `01/09/2026` em vez de `setembro de 2026` — descoberto ao investigar uma asserção de teste que falhava, e registado em vez de corrigido por não ser defeito de estado, §1.2). **Colisão de IDs durante a escrita:** a linha nasceu como `PC-16`, mas no mesmo intervalo de minutos A2 e A1 também atribuíram `PC-16` (três linhas `PC-16` às 11:19); A3 renumerou **a sua própria** linha para `PC-17` e as referências dela em `WEB-010`/§9, sem tocar nas linhas nem nas referências de A1 e A2 — e registou o defeito de processo em **`PC-18`**. `WEB-005` → `DONE`. Sem commit. |
| 2026-09-22 | A3 · `WEB-006` (1/2 — **antes de implementar**): âmbito escrito pela primeira vez (a tarefa só tinha título), com o método, os critérios e o que fica **de fora** por decisão do pedido. Auditoria feita por leitura de todas as páginas/componentes/folhas de estilo, por **medição** de contraste e por verificação de padrões que falham em silêncio — não por inspeção visual. Registado o que está **correto** (11 pontos, para não se repetir o trabalho) e **6 defeitos**: 4 dentro do âmbito (`required` nunca chega ao controlo; separadores da ficha do veículo fora do padrão ARIA de teclado; contagem por ler invisível na barra inferior; dois `role="group"` sem nome). Criadas **`WEB-011`** (contraste medido, com as duas tabelas de razões — é sistema de desenho, logo não se corrige dentro de uma auditoria) e **`WEB-012`** (título e foco na navegação, **bloqueada por decisão de política**: 3 escolhas em aberto). Criado **`PC-24`** (contraste — com folga deliberada de numeração, ver `PC-18`) e **estendido `PC-18`** com as duas rondas de colisão de IDs (`PC-16` triplicado às 11:19, `PC-14` duplicado às 11:30, `PC-21` atribuído por dois agentes no mesmo minuto às 11:34) — A3 renumerou sempre **a sua própria** linha e nunca as alheias. `WEB-006` → `IN_PROGRESS`. Sem commit. |
| 2026-09-22 | A1 · `AUD-005` **concluída** e `AUD-004` **desbloqueada**. **`AUD-005`:** `updateChargingSession` (`services/records-financial.ts:661`) terminava com `mapChargingSession(updated, zeroChargingDerived())` e devolvia **as cinco derivadas a `null`**, enquanto a leitura seguinte as trazia preenchidas; o irmão `updateFuelSession` já fazia o certo. Passou a `return getChargingSession(userId, sessionId)` (`:706`) e `zeroChargingDerived()` foi removida. Novo `test/charging-update-http.test.ts` (**4 testes**, números exatos antes/depois, `PATCH` ≡ `GET`, §49), provado por mutação (**4/4 vermelhos**, ficheiro reposto e confirmado por `sha256`). **`AUD-004`:** o `false &&` que eu observei era a **mutação M2 da verificação de `AUTH-001`** (A2), já reposta — `PC-16` fica explicado. A2 coordenou sem duplicação: a recusa de arranque fica em ficheiro novo (`AUTH-008`, de A2) e `test/email.test.ts` fica para A1. Diagnóstico do falso verde confirmado no código: `test/email.test.ts:172` **reimplementa** o `ConsoleEmailSender` e chama `redactResetLinks` ele próprio, pelo que a asserção passa pelo texto do teste e não pela produção; premissa confirmada (`text` não está em `SENSITIVE_KEYS`). **`AUD-003`/`AUD-006`/`AUD-007`:** procura do relatório **registada e falhada** (9 documentos de `docs/`, os 6 diários, `grep` exaustivo, `~/Downloads`) — continuam `BACKLOG` e o defeito **não** foi reconstruído por inferência; registado que `docs/AUDIT-2026-09-20.md` é **outra** auditoria (origem de `AUD-008`/`AUD-009`/`AUD-010`/`TEST-001`/`OPS-001`), não a funcional de 2026-09-21. Criado **`PC-20`** (o ROADMAP perde alterações com edição concorrente — três edições minhas revertidas). Suíte completa: **1 vermelho** em `documents-http.test.ts` (`PROD-001`, A4) que **desapareceu** ao repetir o ficheiro isolado (**69/69**) — era leitura de uma versão a meio de edição, não defeito. Sem commit. |
| 2026-09-22 | A1 · `AUD-004` **concluída** — o teste deixa de ser falso verde. `test/email.test.ts` deixou de reconstruir o sender: `construirConsoleSender()` (e o `import { logger }` que só ele usava) foram **removidos** e o teste passa a obter o sender por `registerEmailSender()` — o caminho de **produção** — exercendo-o por `sendEmail()` e observando o log real. **Zero alterações em produção** e a superfície pública do módulo **intocada** (não se exporta a classe só para o teste). **Prova por mutação, a que faltava:** retirado `redactResetLinks()` de `ConsoleEmailSender.send` (`email.ts:88`) → **1 de 12 falha, exit 1**, com o token `AbC123xyzTokenValue456` **em claro** no log capturado; ficheiro reposto e confirmado por `sha256` (`58345a66…`), sem resíduo. `test/email.test.ts` **12/12 verde**; `typecheck` exit 0 nos três workspaces. `PC-16` **fechado** (era a mutação M2 de `AUTH-001`). `AUD-004` → `DONE`. Sem commit. |
| 2026-09-22 | A2 · `AUTH-002` — **detalhe prévio feito antes de escrever código** (§1.2), e `BACKLOG` → `READY`. O levantamento desmentiu duas afirmações do próprio documento: (a) a funcionalidade **não** existe — `grep` de `oauth|OAuth|googleId|id_token|idToken` em `apps/api/src`, `packages/shared/src` e `apps/web/src` devolve **só textos de interface** (o botão «Entrar com Google» de `LoginPage.tsx:166` e `SignUpPage.tsx:174` está desativado e diz que exige credenciais OAuth no servidor); (b) o schema **já** tinha `authProvider`/`authProviderId`, mas o que os indexa é `@@index` e **não** `@@unique` — nada impedia duas contas de partilhar o mesmo identificador federado, que é critério de aceitação de `AUTH-003` → criado **`PC-25`**. **Quatro decisões de produto fechadas pelo utilizador e registadas em §5.2 com o que foi recusado:** D1 `openid-client` em vez de OAuth escrito à mão (a validação de assinatura/JWKS é onde os erros são silenciosos); D2 criação **automática** de conta em vez de exigir registo prévio; D3 `AUTH-002` fica em **conta nova e login**, com **fronteira explícita** para `AUTH-003` — nada de associação automática por coincidência de email, que é a decisão de maior risco e exige revisão adversarial de A1; D4 `@@unique([authProvider, authProviderId])` **+ migration**, com a verificação aplicacional como complemento e não como garantia única. **Impacto no contrato declarado em §6.1** (API: aditivo; Web: nenhum obrigatório; Mobile: nenhum nesta tarefa; agentes a adaptar: nenhum — A3 apenas avisado) e **alteração de schema registada em §7.1** (migration própria, impacto PostgreSQL e SQLite, `db:sync-schema` obrigatório, seed não afetado, compatibilidade aditiva; verificado que **nenhum** ficheiro escreve `authProvider`, pelo que não há dados a migrar). `AUTH-003` com a fronteira escrita. §9 e §4 atualizados. **Sem código escrito, sem commit.** |
| 2026-09-22 | A1 · `AUD-008` **concluída** — o fallback silencioso de `/records/:kind` acabou. `configFor` (`RecordsPage.tsx`) passou a devolver `RecordConfig | null` e o ecrã ganhou o ramo `UnknownRecordKind` (reutiliza `EmptyState` + `NavLink`, o mesmo padrão da `NotFoundPage`), colocado depois de todos os hooks. **Nenhum ecrã novo** de inspeções, impostos, seguros ou odómetro — isso é `WEB-004`. Novo `apps/web/test/records-kind.test.tsx` (**7 testes**), provado por mutação (**3 de 7 vermelhos**, com o HTML a mostrar `<h1>Despesas</h1>` para `/records/insurance`); ficheiro reposto por `sha256`. Suíte web **6 ficheiros / 106 testes exit 0**; `typecheck` exit 0. `AUD-008` → `DONE`; **`WEB-004` (A3) desbloqueada** → `READY`. Sem commit. |
| 2026-09-22 | A3 · `WEB-006` (2/2 — **fecho**): as 4 correções de âmbito aplicadas — `aria-required` nos **seis** controlos partilhados de `ui/form.tsx` (`+18/−0`, com o asterisco a continuar `aria-hidden` e a escolha contra o `required` nativo escrita no docblock); **roving tabindex** + `←`/`→`/`Home`/`End` nos 9 separadores da ficha do veículo, com a aritmética das teclas extraída para o **novo** `src/lib/tabs.ts` (31 linhas, pura, sem DOM — é o que a torna testável num projeto sem `jsdom`); a contagem por ler da barra inferior passa a existir em `sr-only` com o **número real** (`AppShell.tsx +14/−0`, o badge visual fica onde está, dentro do `aria-hidden`); nomeados os dois `role="group"` sem nome de `MappingStep.tsx` (`+11/−2`). **`A5`/`A6`/`A7` não foram tocados** — ficam em `WEB-012` e `WEB-011`, como o pedido exigia (§1.2). Novo `apps/web/test/accessibility.test.tsx` — **28 testes**, no padrão `renderToStaticMarkup` de `page-states.test.tsx`, incluindo um guarda estático de convenção **com teste anti-vacuidade** (exige ≥11 `role="group"` encontrados). **3 rondas de mutação, 7 + 5 + 2 vermelhos atribuídos**, ficheiros repostos e confirmados por `sha256` (hashes no §5.3), zero resíduo. Validação: `typecheck` **web** exit 0, suíte **web 7 ficheiros / 134 testes exit 0**; `typecheck` da raiz exit 2 por **um** erro alheio e em curso — `apps/api/src/core/config.ts(345,69) Cannot find name 'API_BASE_PATH'`, escrito às 11:46:39, verificado às 11:47:34 (edição de A2 para `AUTH-002`), registado como interferência e **não** corrigido. Contrato `packages/shared` **intocado** (zero linhas) e impacto declarado aos outros agentes: **nenhum**. Limitações escritas com honestidade: os testes provam markup e **não** comportamento — a movimentação do foco, a armadilha de foco do `Sheet` e o anúncio de um leitor de ecrã **não** são cobertos. `WEB-006` → `DONE`. Sem commit, sem push, sem deploy. |
| 2026-09-22 | A1 · `TEST-001` **concluída** — as quatro áreas que só eram verificadas à mão passam a ter garantia automática. **161 testes novos** em quatro ficheiros (`vehicles-http` 22, `financial-http` 30, `compliance-http` 62, `reminders-http` 47), no padrão existente (`createTestDb()` + `createApp()` + Supertest, sem servidor). Cobrem percurso completo, validação, autenticação e isolamento entre contas. **Provas por mutação: 4/4 mordem** (3, 1, 11 e 1 vermelhos), com os ficheiros repostos e confirmados por `sha256`. **Duas mutações sobreviveram e foram investigadas:** uma era *equivalente* (a cascata usa `fuelSession.expenseId`, não o tipo na despesa) e a outra revelou um **defeito no próprio teste** — o cabeçalho afirmava verificar o `Location` da criação de veículo e **não o verificava**; corrigido, e é agora o teste que dá o vermelho. **Descoberto durante a execução:** `AUD-014` (`createReminder` comparava com `=== null` campos `.nullish()`, pelo que a guarda nunca disparava para um cliente que **omite** o campo — medido: 201 em vez de 422, e um lembrete que nunca dispara), registado **antes** de corrigido com `PC-30`; corrigido com um auxiliar `ausente()` e provado por mutação (3 vermelhos). Registados também **`PC-31`** e **`AUD-015`** (`updateReminder` não tem guarda de condição nenhuma — o `PATCH` pode criar o estado que a criação passou a recusar; **não** corrigido aqui, é trabalho novo). `PC-5` fechado; `PC-15` recebeu a evidência concreta (o `tsc` explícito sobre os testes encontrou um erro de tipo **real**, que o `typecheck` do projeto não veria). Suíte completa: **43 ficheiros / 1703 testes / 0 falhas** — e, em duas execuções seguidas, **uma falhou por `EBUSY` no teardown e a outra passou limpa**, o que mostra que `PC-26` é **intermitente** (exit 1 com tudo verde: o ruído que `OPS-001` tem de distinguir). `typecheck` exit 0. Sem commit. |
| 2026-09-22 | A1 · `OPS-001` **concluída** — há CI, e `PC-6` fecha. **Dois trabalhos** em `.github/workflows/ci.yml`: `qualidade` (sem servidor: `db:check-schema`, `typecheck`, `npm test` pelo classificador, `verify:config`) e `verificacao` (base semeada + servidor: `db:push`, `db:seed`, `verify`, `verify:auth`, `verify:regressions`). `verify:auth` é corrido **explicitamente** porque **não** está no `verify:all` do `package.json` — sem isso o critério «uma falha em `auth` falha o CI» não ficava cumprido. **`PC-26` tratado em duas frentes e por esta ordem:** causa raiz primeiro (`removeTree()` em `test/helpers/db.ts` repete com espera sobre `EBUSY`/`EPERM`/`ENOTEMPTY` e **relança** se esgotar — provado por mutação, 2 de 4 vermelhos, `sha256` `d987ec02…`), classificador depois (`scripts/ci/run-tests.mjs`, novo, decide a partir do **próprio log** que o CI mostra: falha de ambiente = ficheiro falhado com zero asserções falhadas **e** a assinatura de bloqueio de ficheiro; tudo o resto falha, e o que não souber explicar **reprova**). **Provas:** trabalho `verificacao` **corrido localmente** contra uma base descartável — `verify` **231**, `verify:auth` **51/51**, `verify:regressions` **70**, todos exit 0, com `dev.db` do utilizador **intacto** por `sha256` (`0589b575…`); `typecheck` exit 0; `verify:config` 12/12; `db:check-schema` exit 0; classificador provado nos dois sentidos com 4 fixtures; `.yml` validado por sintaxe real (PyYAML) + invariantes + cruzamento com os 23 scripts do `package.json`, e o validador provado por 4 mutações no `.yml`. **Um defeito meu, apanhado só por correr:** a sonda de prontidão apontava a `/api/v1/health/live`, que devolve **404** — a saúde vive fora do prefixo versionado (`app.ts:347-349`); corrigida para `/health` (que também verifica a base). Registado como `PC-33`. **Honestidade:** a suíte completa pelo classificador deu **exit 1** — `oauth-google.test.ts` falhou por **`Hook timed out in 60000ms`** com 28 testes `skipped` e zero asserções falhadas; **não** é o `EBUSY` de `PC-26`, **não** foi perdoado, e **não** se alargou o classificador para o engolir (registado como `PC-34`). **Não implementado:** o trabalho `integracao` → **`OPS-006`** (exige PostgreSQL; não correu nem uma vez aqui). `PC-15` **continua aberto** (o `typecheck` do CI exclui os testes). Criados **`PC-32`** (harness local: shims e `curl` penduram, ~23 s por arranque de node), **`PC-33`** e **`PC-34`**; criada a tarefa **`OPS-006`**. `OPS-001` → `DONE`; `PC-6` → **fechado**. Sem commit, sem push, sem deploy. |
| 2026-09-22 | **A9 · consolidação formal (1/3) — as 8 propostas de A1 integradas.** Fechadas `OPS-004` (`PC-3`) e `OPS-005` (`PC-4`); `AUD-009` (`PC-10`), `AUD-010` (`PC-7`, com os dois números do próprio texto corrigidos: **1 841** testes e **31** rotas), `AUD-012` (`PC-1`) e `AUD-015` (`PC-31`); e `TEST-002`. Cada fecho regista a **prova efetivamente apresentada** por A1 — ficheiros, testes, `typecheck`, mutações com reposição por `sha256`, limitações declaradas — e **nenhuma** tarefa passou a `DONE` só por existir código. `DOC-001` → `CANCELLED` (dona: `AUD-010`). `OPS-001` **já estava integrada** por A1 antes de a regra de coordenação ser clarificada; auditada e mantida (incluindo `PC-6`, `PC-32`–`PC-34` e `OPS-006`), com a proposta de tarefa para o `PC-33` (`AUD-016`) **deixada pendente de decisão**. A integração foi feita por **um script atómico** que aborta **antes de escrever** se cada âncora não ocorrer exatamente uma vez, e escreve **uma só vez** (`PC-20`). |
| 2026-09-22 | **A9 · consolidação formal (2/3) — `OPS-002` e `OPS-003` passam a `BLOCKED`.** Os dois corpos estavam **vazios**: a §1.2 exige os campos e a §1.1 diz que uma tarefa não escrita não pode ser implementada, pelo que escrever-lhes critérios seria **inventar** o contrato. O `OPS-002` **depende do `OPS-006`** (um contentor de produção não pode usar SQLite — `core/prisma-client.ts:88-94`) e a tabela declarava `—`; corrigido. Os corpos foram escritos **como decisão de consolidação do A9**, explicitamente **não retroativos** a uma especificação que nunca existiu. Registado **`PC-38`** (não há motor de contentores neste ambiente — limitação de **validação**, não impossibilidade do projeto). |
| 2026-09-22 | **A9 · consolidação formal (3/3) — política das tarefas sem corpo, e os achados de `TEST-002`.** Medido por A1: **14 de 65** tarefas da §5 sem corpo. **Política decidida:** os campos da §1.2 são obrigatórios **antes de a tarefa ser pegada** (`READY`/`IN_PROGRESS`), não desde a criação — pelo que as **12** em `BACKLOG`/`BLOCKED`/`DEFERRED` são legítimas e **não foram alteradas**, e as **2** de prioridade ativa (`OPS-002`, `OPS-003`) passaram a `BLOCKED` com o que lhes falta escrito (`PC-37`). **Nenhum corpo foi inventado.** Os dois achados de `TEST-002` ficam registados **sem absorção**: `PC-35` (8 de 12 mensagens de validação chegam em inglês) e `PC-36` (dois dos três envelopes de lista divergem de `Page<T>` e estão escritos à mão no cliente web). Registados também `PC-39` (a edição de manutenção grava `null` sobre a condição do lembrete ligado), `PC-40` (o formulário de lembretes produz um pedido que passou a ser recusado) e `PC-41` (o comentário de `App.tsx:38` diz «trinta rotas»). **Nenhum `PC-*` existente foi renumerado** — os novos começam em `PC-35`; `PC-28`/`PC-29` continuam livres e **não** foram reutilizados, pela razão de `PC-18`. **Sem commit, sem push, sem deploy.** |
| 2026-09-22 | **A9 · segunda consolidação/triagem — as propostas de A2 (`AUTH-002`) e A3 (`MOB-001`) integradas, e o estado revisto contra o código.** `AUTH-002` → **`DONE`** e `MOB-001` → **`DONE`**, ambos com a prova que os próprios agentes apresentaram (A2: 31 testes OAuth, suíte **43/1700/0**, `typecheck` exit 0, **6 mutações sem sobreviventes**, `db:check-schema` sincronizado; A3: `node apps/mobile/contract/verify.mjs` exit 0 com pisos anti-vacuidade e **3 mutações**, contrato partilhado intocado por `sha256`) — **nenhuma** tarefa passou a `DONE` por existir código: passaram porque a prova está no histórico e o código está no *working tree*. Fechados `PC-25` (garantia de unicidade) e `PC-27` (era **estado misto de `PC-20`**). Alocados **`PC-28`** (conta federada nasce sem aceitação de termos) e **`PC-29`** (estado do fluxo OAuth em memória do processo) **com os IDs que A2 propôs**: os 5 comentários em `services/oauth.ts`, `test/oauth-google.test.ts` e `docs/OPERATIONS.md` referenciam-nos, e renumerá-los exigiria alterar código — fora do âmbito desta consolidação. Criados **`PC-42`** (o contrato não fecha 19 conjuntos `CodeOf<…>`; A3 propôs `PC-32`, já ocupado por `OPS-001`) e **`PC-43`** (§3 desatualizada depois de `AUTH-002`/`MOB-001`). Tarefas novas: **`WEB-013`** (o cliente web nunca guarda o token de renovação — **3 testes vermelhos** medidos por A3; a sessão dura 1 hora em vez dos 90 dias) e **`MOB-007`** (gate do ambiente Flutter: `flutter pub get` + `analyze` + `test`). `WEB-001`/`WEB-002`/`WEB-003` → **`DONE`**: os ecrãs existem e as dependências que os bloqueavam (`AUTH-001`, `PROD-001`, `PROD-002`) fecharam — **limitação registada**: não há teste automático sobre estes ecrãs, e o **envio de ficheiros na web** continua por decidir (decisão de produto). `AUTH-003` mantém-se `BACKLOG` com a dependência **satisfeita** (falta o detalhe prévio da §1.2 e a revisão adversarial de A1). `WEB-011` passa a declarar `WEB-008` nas dependências. `OPS-002`/`OPS-003` continuam `BLOCKED`; `OPS-006` ganha a exigência explícita de **estratégia de PostgreSQL**. `PROD-007 → PROD-008` mantida. **`PC-20` estendido:** o ROADMAP foi reescrito por um processo desconhecido (`sha256` `eca5bb1de…` → `91f5186a…`, LF, 58 `**` escapados, ~759 linhas vazias, `## 2.` apagado); a base limpa foi recuperada **byte a byte** e é a que serve de base a esta consolidação. **Nenhum `PC-*` foi renumerado.** **Sem commit, sem push, sem deploy.** |
| 2026-09-22 | A3 · `WEB-011` **concluída** — o contraste do produto passa a cumprir WCAG AA nos dois temas. **O gate de coordenação com `WEB-008` foi verificado antes de escrever** (`WEB-008` em `BACKLOG`, `theme.css` intocado desde 2026-09-16, `app.css` desde 2026-09-19). A medição foi feita por um **auditor independente**, validado primeiro contra os números que o próprio `PC-24` publicava (13,13 / 4,65 / 9,87 / 6,19 — todos reproduzidos) — e a primeira versão desse auditor tinha um **defeito meu** (ordenava as luminâncias de forma ascendente e devolvia o recíproco: `0,08:1` para texto escuro sobre branco), corrigido por ser impossível. **O `PC-24` estava incompleto:** listava 6 pares, havia muito mais, e o pior do produto — `.z-banner--info` no escuro a **1,18:1** — não constava (abre **`PC-46`**). Tintas novas escolhidas por **medição**, não a olho: uma descida encontrou o tom mais próximo que passa (`#1c7d52`, exatamente 4,503:1) e rejeitou-o por não ter margem, ficando `#1b784f` (**4,81:1**) e `#ba3e0c` (**4,75:1**) — nascidos no `BRAND` como `STATE_INK`, com o `#1f8a5b` e o `#c2410c` originais **intactos** para os usos onde o contraste não exige 4,5:1. Correção **nos tokens**: `theme.css` `+51/−1` (`--z-text-muted` neutral-500 → neutral-600: 4,29/4,08/3,82 → **6,51/6,20/5,81**), `app.css` `+32/−32` (31 repontagens, **nenhuma cor nova**; a única literal que sobrevive é o `#ffffff` do `.z-qr`, requisito do formato), `AppShell.tsx` **1 linha** (o `＋` da barra inferior: 2,43 → **4,77** no claro, 1,88 → **6,18** no escuro). Novo `apps/web/test/contraste-tokens.test.ts` — **58 testes**, lê o `theme.css` real, com **três guardas anti-vacuidade** (pisos de leitura, 4 sentinelas, piso de ≥30 regras) e um **invariante de família** que percorre todas as regras do `app.css` e mede cada superfície pintada com texto por cima nos dois temas. Medido **contra o código pré-correção: 25 falhados / 33 passados** (a mensagem reproduz os números do `PC-24` textualmente); com a correção: **58 passados**. **15 mutações, 15 mortas, 0 sobreviventes**, 15/15 restaurações por `sha256`, lidas do reporter JSON — incluindo **M8** (controlo que prova que a asserção «as superfícies ficaram como estavam» morde) e **M15** (prova da guarda anti-vacuidade: com o tema escuro rebatizado o teste nem corre, `0 testes`, saída 1). **Dois defeitos meus no harness** corrigidos: M15 estava lida como «sobreviveu» porque `numTotalTests: 0` era tratado como verde; e M6 abortou por a âncora de 2 espaços ser substring da de 4 (o script recusou mutar o sítio errado). Um `SIGTERM` do terminal deixou o `theme.css` mutado a meio — detetado por `sha256` e o harness passou a repor no arranque e a tratar sinais. Suíte web **219 testes / 10 ficheiros** exit 0 (161/9 antes); `typecheck` web e de `packages/shared` exit 0; o teste está fora do `typecheck` do projeto (`PC-15`) e foi verificado com `tsconfig` restrito (exit 0, 251 ficheiros), com o verificador provado **sensível** (`TS2345`, exit 2). `packages/shared` alterado de forma **aditiva e sem consumidores**. **Não alterado de propósito, com medição:** a barra do cartão de estado (4,33:1 / 4,43:1 / 3,07:1 — passa 3:1 e é redundante por desenho), o `#ffffff` do `.z-qr` e a opacidade dos botões desativados (WCAG isenta controlos inativos). **Limitações declaradas:** o anel de foco foi verificado como **token**, não ao nível da regra; e a asserção de cores do teste só cobre o canal `color:` — continuam cores fora do `BRAND` em `app.css` (`#1d4a52`, `#0c2b30`, `rgba(255,255,255,0.14)`), registadas em **`PC-47`**. `WEB-011` → `DONE`; `PC-24` → resolvido. Sem commit, sem push, sem deploy. |
| 2026-09-23 | **A9 · consolidação do fecho de `WEB-011`.** `WEB-011` → **`DONE`** com a prova que A3 apresentou: **58/58** testes de contraste (25 vermelhos medidos contra o código pré-correção), suíte web **219/219 em 10 ficheiros**, `typecheck` web e de `packages/shared` exit 0, **15/15 mutações mortas** com 15/15 restaurações verificadas por `sha256`, `PC-15` coberto por `tsconfig` restrito com o verificador provado **sensível** (`TS2345`, exit 2). Fechado **`PC-24`** (o inventário estava **incompleto**: faltava o pior par do produto, `.z-banner--info` no escuro a **1,18:1** — ver `PC-46`). Criados **`PC-46`** (o método de inventário manual não escala; o teste deve **gerar** a enumeração) e **`PC-47`** (`app.css:2115` com `border-color: #1d4a52` fora do `BRAND`; exige **decisão de desenho**, não foi alterado). **Duas correções de A9 à proposta:** (1) o §10.5 pedia contar **sete** `DONE` incluindo `WEB-010`, mas `WEB-010` continua `READY` (a sua proposta não foi integrada) — o número correto é sete por **outra** razão: `WEB-002` já era `DONE` e estava **omitido** na contagem anterior, que dizia «cinco»; (2) removido um **fragmento pendente** («à espera de decisão de política) e três bloqueadas…») que ficara órfão no fim desse parágrafo. **Lacuna registada, não corrigida:** a tabela da §9 (A3) continua a **não** listar `WEB-002`, apesar de §4 o declarar `DONE`. **Nenhum `PC-*` foi renumerado**; `PC-44`/`PC-45` ficam **reservados** à proposta de `WEB-010`. **Sem commit, sem push, sem deploy.** |
| 2026-09-23 | A3 · `WEB-010` **concluída e re-verificada**: o título do mês no cabeçalho do calendário passa a usar `monthLong` (`CalendarGrid.tsx:97`) — **2 linhas** alteradas, os dois `replace` mortos desaparecem, o `aria-label` da grelha acompanha (`Calendário de setembro de 2026`) e nenhuma outra data do ecrã muda de formato. Em `format.ts` **só comentários**: o `docblock` de `dateLong` documentava `16 set 2026`, saída que o `pt-PT` **não** produz, e ficou registada a causa exata medida (ICU 78.2) — `month: 'short'` degrada para `2-digit` **por causa do ano** no esqueleto (`{month:'short', year}` → `09/2026`), e sem ano o nome curto sobrevive (`{month:'short'}` → `set.`), pelo que os `replace` nunca poderiam casar com nenhum esqueleto do módulo. `monthLong` passa a ter consumidor — **nenhum formatter novo foi criado**. `apps/web/test/calendar-month-label.test.tsx` — **19 testes**, 6 grupos, incluindo **a alteração do mês apresentado** (transição, passagem de ano e os 12 meses, com `Set` de 12 títulos distintos para provar que não está hardcoded), a **coerência** rótulo↔título e **os restantes formatadores** (`dateLong`, `dateShort`, `weekday`, `dateRange`). Medido contra o código pré-correção (as 2 linhas revertidas, `sha256` `ce93ac85…`): **9 falhados / 10 passados**, exit 1; com a correção: **19 passados**. **6 mutações, 6 mortas, 0 sobreviventes** (M1 mata 9/19; M2 9/19; M3 5/19 incluindo a coerência; M4 **exatamente 3/19** — cirúrgica; M5 mata o **invariante**; M6 mata os testes de «não hardcoded»), ficheiros-fonte repostos e verificados por `sha256`. `typecheck` web exit 0; suíte web **228 testes / 10 ficheiros** exit 0; o teste novo está fora do `typecheck` do projeto (`PC-15`) e foi verificado com `tsconfig` restrito (exit 0, 292 ficheiros), com o verificador provado **sensível** (`TS2345`, exit 2). **Limitações declaradas:** a aritmética do `shiftMonth` não é observável sem DOM e **não** está provada; e o teste de coerência passa **também** com o código antigo (rótulo e título dizem a mesma coisa errada), pelo que não substitui as asserções do título. Contrato `packages/shared` **intocado**; impacto nenhum em API e mobile. **`PC-17` resolvido**; abertos **`PC-44`** (o mesmo defeito na linha temporal — `groupByMonth` produz `01/09/2026`, medido), **`PC-45`** (o `minWidth: '9ch'` do título — coordenar com `WEB-008`) e **`PC-48`** (o docblock do `dateRange` documenta `1 set 2026`, saída que o `pt-PT` não produz). `WEB-010` → `DONE`. Sem commit. |
| 2026-09-23 | **A9 · consolidação do fecho de `WEB-010`.** `WEB-010` → **`DONE`** com a prova que A3 apresentou, **re-verificada por A9 contra o disco** antes de escrever: os três `sha256` declarados conferem (`CalendarGrid.tsx` `7c03dcca…`, `format.ts` `93e823cf…`, `calendar-month-label.test.tsx` `166e5e0b…`), a alteração está no código (`CalendarGrid.tsx:5` o `import`, `:97` o `monthLabel`) e A9 correu ele mesmo o teste (**19/19**, exit 0), a suíte web (**228/228 em 10 ficheiros**, exit 0) e o `typecheck` web (exit 0). Fechado **`PC-17`** com a causa que A3 mediu: a degradação de `month:'short'` para `2-digit` é provocada **pelo ano** no esqueleto, pelo que os `replace` nunca poderiam casar com nenhum esqueleto do módulo, e `monthLong` é a **única** forma de obter o nome do mês em `pt-PT` — passou a ter consumidor. Abertos **`PC-44`** (o mesmo defeito em `records.tsx:361`/`groupByMonth`, com dois consumidores), **`PC-45`** (o `minWidth: '9ch'` do título; a coordenar com `WEB-008`) e **`PC-48`** (o docblock do `dateRange` documenta uma saída que o `pt-PT` não produz). **Uma correção de A9 à proposta:** o §9.2 dizia que a zona das datas passou de `153-168` para `142-199`; medido contra `HEAD` (que ainda tem o estado pré-correção), as funções (`dateLong`/`dateShort`/`monthLong`) estão agora em **`179-199`** — `142` é o `DATE_FORMATTER`. O número foi corrigido **antes** de ser escrito. **Nenhum `PC-*` foi renumerado**; `PC-44` e `PC-45` deixam de estar reservados e passam a ter linha. **Sem commit, sem push, sem deploy.** |
| 2026-09-23 | A4 · `PROD-004` **concluída** — o agendador de notificações existe e fecha `PC-9`. Mecanismo decidido **antes** de implementar, como o `Risco` da tarefa exigia: **núcleo partilhado + runner in-process** (`DECISIONS.md` **A32**). Três peças com fronteiras explícitas: `syncNotificationsForUser` (`services/notifications.ts`) — a descoberta que o dashboard já usava, extraída de 3 linhas inline em `insights.ts`, que era a razão de `PC-9`; `runNotificationSync` (`jobs/notification-sync.ts`) — pagina por cursor `id asc`, best-effort por utilizador, devolve relatório; `createJobRunner` (`jobs/runner.ts`) — a **única** peça com `setInterval`, guarda de reentrância com `inFlight.add` **antes do primeiro `await`**, ignora em vez de enfileirar, contém falhas. O runner arranca em `server.ts:79` e para no `shutdown` (`:96`) — **não** em `createApp()`. `NOTIFICATIONS_SYNC_INTERVAL_MINUTES` default **15**, **`0` desliga**, máximo **1440**, com linha em `describeConfig()`. `apps/api/test/jobs-notification-sync.test.ts` — **15 testes** com o runner real. **9 mutações, todas repostas e confirmadas por `sha256`**, incluindo uma **sobrevivente demonstrada equivalente**: remover o `findFirst` mata 0 testes porque a garantia efetiva é o **índice único** de `dedupeKey`, e a contra-prova (sem `findFirst` **e** sem `catch`) mata 3. Suíte **48 ficheiros / 1768 testes / exit 0**; `tsc` dos 3 workspaces exit 0; `PC-15` restrito exit 0. Duas correções forçadas pelas mutações ficaram **nos testes**, não no código. `OPERATIONS.md` §3.5.1 (nova) e §9 reescrita; `DECISIONS.md` A32. Achados: `PC-49` e `PC-50`. Sem commit, sem push, sem deploy. |
| 2026-09-23 | **A9 · consolidação do fecho de `PROD-004`.** `PROD-004` → **`DONE`** e `PC-9` → **Resolvido**, com a prova de A4 **re-verificada por A9 contra o disco** antes de escrever: os quatro `sha256` declarados conferem (`services/notifications.ts` `e3080bb8…`, `jobs/notification-sync.ts` `5619ce74…`, `jobs/runner.ts` `42ecb21d…`, `test/jobs-notification-sync.test.ts` `894d08a6…`); a estrutura está onde a entrega diz (o runner arranca em `server.ts:79` e para em `:96`, `createApp()` não arranca trabalho periódico, e `NOTIFICATIONS_SYNC_INTERVAL_MINUTES` está em `config.ts:475` com 15/`0`/1440); a documentação existe (`DECISIONS.md` **A32**, `OPERATIONS.md` **§3.5.1**); e A9 correu ele mesmo o teste novo (**15/15**, exit 0). Abertos **`PC-49`** (o `catch` de `notifications.ts:203-207` não estreita para `P2002` — uma avaria de BD fica indistinguível de um duplicado, e com o agendador a correr sozinho isso é pior do que antes) e **`PC-50`** (`windowDays`/`windowKm` declarados no contrato e **inertes** em `listReminders`), ambos **sem reabrir** `PROD-004`. **Nenhum `PC-*` foi renumerado**; `PC-49`/`PC-50` são os primeiros livres a seguir a `PC-48`. **Nota de âmbito:** esta entrega **não** trouxe `docs/PROPOSAL-A4-PROD-004.md` — a consolidação apoiou-se no registo do diário de 2026-09-23 e na verificação direta do código, e é a única consolidação do projeto feita sem proposta escrita. **Sem commit, sem push, sem deploy.** |
| 2026-09-23 | A4 · `PROD-007` e `PROD-008` **concluídas** — a eliminação devolve os bytes e a substituição deixou de obrigar a recriar o documento. `PROD-007`: `deleteDocument` passa a ler a chave **antes** do `delete` e a remover os bytes **depois**, com contagem de referências (necessária por `PC-21`) — 11 testes, 4 mutações todas mortas (M2, a ordem invertida, mata apenas o teste da falha de base de dados, que é o que a prova). `PROD-008`: decisão do utilizador por escolha múltipla — **`PUT /documents/:documentId/content`** substitui e o `POST` continua a ser só o upload inicial, recusando `409`; ordem guardar → apontar → remover, com remoção compensatória — 17 testes, 8 mutações todas mortas, onde M8 nasceu de M1 e M2 produzirem o **mesmo** conjunto de falhas (regra que ficou: comparar conjuntos, não contagens). Registados o **desvio** do ficheiro de teste (novo em vez da §10 de `documents-http.test.ts`, por recusa de leitura) e a **limitação**: a web ainda não usa o `PUT`. Fecha **`PC-13`**. Abre **`PC-51`**: `deleteAccount` apaga por cascata do esquema e deixa os bytes órfãos. Sem commit, sem push, sem deploy. |
| 2026-09-23 | **A9 · consolidação do fecho de `WEB-013`.** `WEB-013` → **`DONE`**, com a proposta de A3 (`docs/PROPOSAL-A3-WEB-013.md`) **verificada contra o disco antes de escrever**: `client.ts` `sha256` `1f3802cb…` igual ao declarado; `session-refresh` **17/17 exit 0**; suíte web **228/228 em 10 ficheiros exit 0**; `typecheck` web exit 0; `tsconfig` da web a excluir `test/` confirmado (**0** ficheiros, `PC-15`), com o template de verificação restrito provado **sensível** por mutação (`TS2724`, exit 2 → reposto, `sha256` `ac4b19f8…` idêntico); contrato partilhado `contracts.ts`/`types.ts` com os `sha256` declarados. **Critérios de aceitação verificados um a um no código:** `setTokens` com uma só fonte (`:167`), `AuthResponse` ausente, `login`/`signup` a devolver `UserProfile` (`:504`,`:515`). **Nenhum `PC-*` criado** (os dois achados — `skipRefresh` morto e o ciclo de 401 — ficam declarados como limitações da tarefa, sem número). `WEB-013` sai dos `READY`; §4, §5.3, §9 (fila e contagem) atualizados. **Sem commit, sem push, sem deploy.** |
| 2026-09-23 | **A9 · consolidação do fecho de `PROD-007` e `PROD-008`.** `PROD-007` → **`DONE`**, `PROD-008` → **`DONE`** e **`PC-13`** → **Resolvido**, com prova corrida por A9 **antes** de escrever: suíte de documentos **130 testes em 4 ficheiros, exit 0** (`document-storage` 33, `documents-delete` 11, `documents-replace` 17, `documents-http` 69) e `typecheck` da API **exit 0**; `discardDocumentBytes` confirmado com chamadores em `documents.ts:247,581`; a rota `PUT` confirmada em `routes/documents.ts:268,352` com `isDocumentUpload` a aceitar `POST || PUT` (`:181-182`). **Inversão de premissa registada no próprio fecho:** o critério de `PROD-008` dizia `POST` e a decisão do utilizador foi `PUT` — a tarefa **mantém-se**, não se cria tarefa nova. Aberto **`PC-51`** (`deleteAccount`, `auth.ts:1332-1365`, apaga por cascata em `:1363` e não passa pela remoção — achado de A4 que estava por alocar desde 2026-09-22, verificado por A9 no disco). **Nenhum `PC-*` foi renumerado**; `PC-51` é o primeiro livre a seguir a `PC-50`. **Não tocado de propósito:** o parágrafo «Resultado de `PROD-003` (2026-09-22)», registo datado e atribuído, que afirma no presente uma fila de A4 já ultrapassada — decisão separada, que o utilizador não autorizou nesta ronda. **Sem commit, sem push, sem deploy.** |
