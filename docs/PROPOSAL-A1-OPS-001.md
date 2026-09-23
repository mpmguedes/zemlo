# Entrega de A1 a A9 — `OPS-001` (fecho) e proposta de tarefa para `PC-33`

> **Documento de entrega, não fonte de verdade.**
>
> **Nota de processo, e é uma correção.** A1 integrou o fecho de `OPS-001` diretamente em
> `docs/ROADMAP.md` **antes** de a regra ser clarificada pelo utilizador (2026-09-22, 16:19). A
> regra vigente é: **A9 é o único agente autorizado a editar `docs/ROADMAP.md`**; A1–A4 descobrem,
> **propõem** e entregam. Assim que a regra foi clarificada, **A1 parou de escrever no ROADMAP** e
> não voltou a tocar-lhe.
>
> **O que isto significa na prática:** o fecho **já está** no ROADMAP, e não é possível desfazê-lo
> sem decidir o que fazer com ele. Este documento (a) **localiza exatamente** o que A1 escreveu,
> para A9 poder auditar linha a linha; (b) **oferece a reversão**, com o âmbito delimitado; e
> (c) entrega o texto pronto a integrar do que **falta** (`PC-33` → tarefa própria).
>
> **Estado dos IDs no momento da escrita** (2026-09-22, ~16:20): `PC-*` até `PC-34` (A1 criou
> `PC-32`, `PC-33`, `PC-34`), `AUD-*` até `AUD-015`, `OPS-*` até `OPS-006` (A1 criou `OPS-006`),
> `WEB-*` até `WEB-012`, `MOB-*` até `MOB-006`.
> **Nenhum ID existente foi renumerado por A1.**

---

## 1. `OPS-001` — o que A1 já integrou (para auditoria ou reversão)

**Estado:** `OPS-001` → `DONE`; `PC-6` → **fechado**. Aceite tecnicamente pelo utilizador
(2026-09-22, 16:19).

### 1.1 Âncoras exatas do que foi escrito

Ficheiro: `docs/ROADMAP.md` — 239 883 bytes, `sha256` `2cd97a34f08b00f5…` no momento desta entrega
(o ficheiro está sob edição concorrente de outros agentes, pelo que **as linhas podem ter andado**;
as âncoras de texto, não).

| O que | Linha (aprox.) | Âncora de texto (estável) |
| --- | --- | --- |
| §2, linha `PC-6` → fechado | 118 | começa por `\| PC-6 \|` |
| §2, `PC-32` (novo) | 140 | começa por `\| PC-32 \|` |
| §2, `PC-33` (novo) | 141 | começa por `\| PC-33 \|` |
| §2, `PC-34` (novo) | 142 | começa por `\| PC-34 \|` |
| §4, linha `OPS-001` → `DONE` | 309 | começa por `\| OPS-001  \|` |
| §4, linha `OPS-006` (nova) | 314 | começa por `\| OPS-006  \|` |
| §5.7, cabeçalho `OPS-001` → `DONE` | 1882 | `#### OPS-001 · CI: \`typecheck\` + \`test\` + \`verify*\` — A1 · P1 · \`DONE\`` |
| §5.7, bloco **Implementação e provas** | 1962 | `**Implementação e provas (A1, 2026-09-22):**` |
| §5.7, secção `OPS-006` (nova) | 2092 | `#### OPS-006 · CI: trabalho de integração em produção (PostgreSQL)` |
| §13, entrada de histórico | 2550 | contém `OPS-001\` **concluída**` |

### 1.2 Se A9 decidir reverter

A reversão é **delimitada e segura**, porque tudo o que A1 escreveu está em blocos contíguos:

1. `§2` — repor a célula de estado de `PC-6` no valor anterior
   (`Aberto — \`OPS-001\``) e **remover as três linhas** `PC-32`, `PC-33`, `PC-34`.
   **Libertar esses três IDs** (outros agentes podem já contar com eles).
2. `§4` — repor `OPS-001` em `IN_PROGRESS` e remover a linha `OPS-006` (libertar o ID).
3. `§5.7` — repor o cabeçalho em `IN_PROGRESS` e remover o bloco `Implementação e provas (A1, …)`
   **e** a secção `OPS-006` inteira. Manter o bloco `Detalhe prévio`, que é anterior.
4. `§13` — remover a entrada do histórico que termina em `Sem commit, sem push, sem deploy.`
5. **Não** reverter os ficheiros de código: `OPS-001` está aceite tecnicamente, e o valor está
   neles, não no documento.

**Risco a ter em conta:** o ROADMAP está *untracked* — **não há base de comparação por `git`**, logo
uma reversão «total» é uma reconstrução a partir de âncoras de texto, não um `checkout`. A1 oferece-se
para fazer a reversão **por proposta** (script com asserções, uma só escrita) se A9 o pedir.

### 1.3 Os ficheiros de código (independentes do ROADMAP)

| Ficheiro | Estado | `sha256` |
| --- | --- | --- |
| `.github/workflows/ci.yml` | **novo** | `7c86a13f910741908e81457c2b99af371bd0d9dd8a46f532144031057694a49d` |
| `scripts/ci/run-tests.mjs` | **novo** | — |
| `apps/api/test/teardown-retry.test.ts` | **novo**, 4 testes | — |
| `apps/api/test/helpers/db.ts` | alterado (`removeTree`) | `d987ec027b0b4b3bf19e08897213e93fa919bff9937ad69922552bcbb7c374fd` |

**Sem commit, sem push, sem deploy** — tudo no working tree, como o pedido exige.

---

## 2. `PC-33` — proposta de tarefa própria

O utilizador determinou que `PC-33` deve ter tarefa própria e que **A1 a propõe a A9** em vez de a
criar no ROADMAP. **Proposta: `AUD-016`** (próximo `AUD-*` livre; é um defeito de auditoria de texto,
não uma operação de CI, pelo que **não** deve ser `OPS-007`). **A confirmar por A9** — se outro agente
já tiver tomado `AUD-016`, qualquer ID livre serve, sem renumeração de nada.

### 2.1 Linha de §4

```markdown
| AUD-016  | Auditoria    | `GET /api` anuncia um endereço de saúde que devolve 404 (PC-33)         | A1     | P3         | `READY`    | —                       |
```

### 2.2 Secção de §5.1

```markdown
#### AUD-016 · `GET /api` anuncia um endereço de saúde que devolve 404 (PC-33) — A1 · P3 · `READY`

- **Descrição:** `app.ts:343` responde a `GET /api` com `documentation: '/api/v1/health'`, mas a
  saúde vive **fora** do prefixo versionado: `app.use(healthRouter)` (`app.ts:349`) monta `/health`
  e `/health/live` **sem** `/api/v1`, e o comentário de `app.ts:347-348` di-lo por palavras — «um
  orquestrador não deve ter de saber que versão da API está a correr para verificar se o processo
  responde». Medido por A1 em 2026-09-22: `GET /api/v1/health/live` → **404**; `GET /health` → **200**.
  O campo é apenas informativo (não tem consumidor no código), pelo que o defeito é de **texto** —
  mas enganou o próprio autor do `ci.yml`, que escreveu a sonda de prontidão com o endereço errado e
  só o descobriu ao correr o passo.
- **Objetivo:** que a resposta de descoberta diga a verdade.
- **Critérios de aceitação:**
  - `GET /api` devolve um caminho de saúde que responde **200**, verificado por teste de rota;
  - o caminho sai de **uma única fonte** (não uma segunda string escrita à mão) — ou, se ficar
    literal, existe um teste que falha se divergir da montagem real de `app.use(healthRouter)`;
  - `docs/API.md` deixa de repetir o endereço errado, se o repetir.
- **Dependências:** —
- **Nota de âmbito:** é uma linha em `apps/api/src/app.ts` **mais** um teste. **Não** toca na
  montagem da saúde — que está correta e é deliberada. **Não** é o mesmo que `OPS-006`, que apenas
  *sofre* do mesmo engano na sonda (e já está corrigido lá).
```

### 2.3 Nota para `PC-33` na tabela de §2

A célula de estado de `PC-33` deve passar a apontar para a tarefa:

```markdown
Aberto — `AUD-016`
```

---

## 3. O que fica aberto, e o que A9 deve saber

| Item | Estado | Nota para A9 |
| --- | --- | --- |
| `PC-6` | **fechado** por `OPS-001` | confirmado pelo utilizador |
| `PC-15` | **aberto** | o `typecheck` que o CI corre **exclui** `**/*.test.ts`. O CI **não** fecha este buraco. Fechá-lo exige um `tsconfig` de testes e uma decisão sobre os erros pré-tipo do harness |
| `PC-32` | **aberto** (informativo) | harness local: shims `.bin`/`npx` e `curl` penduram, ~23 s por arranque de `node`. Não é defeito do projeto |
| `PC-33` | **aberto** | ver §2 acima — proposta `AUD-016` |
| `PC-34` | **aberto** (informativo) | `oauth-google.test.ts` estoura o `hookTimeout` de 60 s sob carga; 28 testes `skipped`, **zero asserções falhadas**. **Não** é o `EBUSY` de `PC-26` e **não** foi mascarado pelo classificador |
| `OPS-006` | `BACKLOG` | integração em produção (PostgreSQL). **Sem prova possível nesta máquina** — o utilizador determinou que só avança num ambiente com prova real |

### 3.1 Duas coisas que A1 **não** fez, de propósito

1. **Não alargou o classificador** para engolir `Hook timed out`. Isso mascararia timeouts de hook
   verdadeiros, que são uma classe de defeito real. `PC-34` fica vermelho e explicado.
2. **Não aumentou timeouts de teste** para obter verde. O critério do pedido é explícito:
   «não alteres testes ou verificações apenas para obter um CI verde».

---

## 4. Uma divergência de identificação que precisa de decisão

A memória do projeto (`MEMORY.md`) e a memória de utilizador dizem **A9**; o contrato de trabalho
que A1 recebeu é o ramo de **A1**. A1 agiu como A1 nos ficheiros de código (âmbito, disciplina de
prova) e, por lapso de sequência, escreveu no ROADMAP como se fosse o agente autorizado — porque a
memória dizia que era. **A regra clarificada resolve a dúvida: quem escreve no ROADMAP é A9.**
Fica registado para que a consolidação não herde a ambiguidade.

**A1 não faz mais alterações ao ROADMAP.** Próximo trabalho determinado pelo utilizador:
`OPS-004`, depois `OPS-005`, depois `AUD-012`. `OPS-006` fica parado até haver ambiente com prova real.
