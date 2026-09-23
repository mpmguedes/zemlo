# `PROPOSAL-A1-OPS-002` — `Dockerfile`: premissa verificada, veredicto de não-implementação

> **Documento de entrega, não fonte de verdade.** A fonte de verdade é `docs/ROADMAP.md`, e
> **este ficheiro não o altera**: o `sha256` do `ROADMAP.md` no início e no fim desta sessão é
> `2cd97a34f08b00f5a809026bf306aab0db18108bac7a5f5f9ef04d907dc4c8bf`. Os blocos de §5 são para
> o A9 colar; nenhum ID novo foi atribuído por mim.
>
> **Ramo:** A1 — Qualidade, auditoria e hardening. **Tarefa:** `OPS-002` · P2.
> **Sem commit, sem push, sem deploy.** Nenhum ficheiro de produção foi criado ou alterado.

**Resumo numa linha:** o trabalho **não está feito** (premissa confirmada), mas **não é
implementável como está escrita** — o corpo da tarefa está vazio, a §1.2 do próprio ROADMAP exige
os campos que faltam, e a §1.1 diz que uma tarefa não escrita não pode ser implementada. Acresce
que este ambiente **não tem Docker**, pelo que um `Dockerfile` escrito aqui seria uma afirmação
sem prova. **Registei, não inventei.**

---

## 1. A premissa, verificada antes de escrever o `Dockerfile`

### 1.1 O que a tabela diz

`docs/ROADMAP.md:310`:

```
| OPS-002  | Operações    | Dockerfile                                                             | A1     | P2         | `BACKLOG`  | —                       |
```

Sem dependências. O corpo correspondente está em `:2073`.

### 1.2 O que o repositório diz: o trabalho **não** está feito

Procurei por qualquer artefacto de contentorização, rastreado ou não:

| Procura | Resultado |
| --- | --- |
| `Dockerfile*`, `docker-compose*`, `.dockerignore*` na raiz | **nenhum** (`No such file or directory`) |
| `git ls-files \| grep -iE "docker\|container"` | **zero** ficheiros |
| `docker` / `podman` / `nerdctl` no `PATH` | **nenhum** (`command not found`, exit 127) |

Ao contrário de `AUD-004`, `AUD-005` e `AUD-008` — que a verificação de premissa revelou já
`DONE` —, aqui a premissa **confirma-se**: não existe `Dockerfile` no projeto. O trabalho está
genuinamente por fazer.

### 1.3 O que o corpo da tarefa diz: **nada** — e é isso que a bloqueia

`docs/ROADMAP.md:2073-2074`, na íntegra:

```
#### OPS-002 · Dockerfile — A1 · P2 · `BACKLOG`

```

Uma linha de título e uma linha vazia. **Zero linhas de corpo.** Não há **Descrição**,
**Objetivo**, **Dependências**, **Critérios de aceitação** nem **Testes/validação previstos**.

O ROADMAP é explícito quanto ao que isso significa. `:44-46` (§1.2):

> A tarefa **tem** de existir neste documento e ter: `ID`, título, agente, prioridade, estado,
> descrição, objetivo, dependências, critérios de aceitação e testes/validação previstos.

E `:33-38` (§1.1, «a mais importante»):

> O ROADMAP é atualizado duas vezes por cada alteração significativa: antes da implementação,
> para definir exatamente o que será feito, e depois da implementação, para registar exatamente
> o que foi feito e validado.
> […]
> Uma tarefa que não está escrita antes não pode ser implementada.

**Conclusão, tirada do próprio documento e não de mim:** o `OPS-002`, como está, **não pode ser
implementado**. Escrever-lhe os critérios seria inventar um contrato — exatamente o que o
briefing proíbe («Não inventes nem completes o defeito por inferência»).

### 1.4 As decisões que um corpo vazio esconde

Um `Dockerfile` não é um artefacto neutro: cada linha é uma decisão. Nenhuma destas está tomada
no repositório, e nenhuma é minha para tomar:

1. **Imagem base** — `node:22-alpine`, `node:22-slim` ou `distroless`?
2. **Estágios** — um só, ou multi-estágio (build do TypeScript e do Vite fora da imagem final)?
3. **Âmbito** — a imagem serve só a API, ou API **e** a web (Vite compilado servido
   estaticamente)? São dois produtos com ciclos de vida diferentes.
4. **Motor de dados** — **esta é a decisão pesada**, ver §1.5.
5. **Migrações** — aplicadas no arranque do contentor, ou passo separado de `deploy`?
6. **Utilizador** — `root` (por omissão) ou utilizador sem privilégios?
7. **Porta e sonda** — e a sonda tem uma armadilha **já medida** neste projeto: `PC-33` diz que a
   saúde vive **fora** do prefixo versionado. Um `HEALTHCHECK` a apontar a `/api/v1/health`
   devolve **404**; o endereço correto é `/health`. Foi exatamente aqui que o autor do `ci.yml`
   errou, e está registado em `OPS-006` (`:2105-2106`).
8. **Volume de dados** — onde persiste o quê, e o que acontece a esse volume num `docker compose
   down`.

### 1.5 A dependência declarada (`—`) está errada

A tabela declara `OPS-002` sem dependências. **Não é verdade**, e a prova está no código que o
`OPS-006` já citou. `apps/api/src/core/prisma-client.ts:88-94`:

```ts
  if (config.isProduction) {
    throw new Error(
      'Cliente Prisma SQLite carregado em produção. O Zemlo usa PostgreSQL em produção. ' +
        'Corre `npm run db:generate` com DATABASE_PROVIDER=postgresql e define DATABASE_URL ' +
        'com a cadeia de ligação PostgreSQL.',
    );
  }
```

Com o comentário de `:84-86`:

> Em produção, um cliente SQLite é recusado sempre. É um ficheiro local, sem concorrência a
> sério e sem as garantias do PostgreSQL; recusar arrancar é preferível a servir dados de um
> ficheiro que ninguém vai salvaguardar.

Ou seja: **um contentor de produção não pode usar SQLite.** Um `Dockerfile` de produção exige,
estruturalmente, o caminho PostgreSQL — que é o mesmo requisito que faz o `OPS-006` existir. O
`OPS-002` **depende do `OPS-006`**, e a tabela diz `—`.

> Nota de âmbito: isto é uma **observação sobre a tabela**, entregue ao A9. **Não corrigi a
> linha** — o ROADMAP é do A9.

---

## 2. Porque não implementei: o ambiente e o precedente do próprio ROADMAP

### 2.1 O Docker não existe nesta máquina (medido)

| Verificação | Resultado |
| --- | --- |
| `docker --version` | `docker: command not found` (exit **127**) |
| `docker info` | idem |
| `/c/Program Files/Docker`, `/c/ProgramData/DockerDesktop`, `…/AppData/Local/Docker` | **não existem** |
| `podman`, `podman.exe`, `nerdctl` | **nenhum** no `PATH` |
| `wsl --list --quiet` | **bloqueado por política de segurança** (`wsl.exe` em lista negra) |

Sem motor de contentores, um `Dockerfile` escrito aqui **nunca é construído nem corrido**. Seria
um ficheiro com aparência de entrega e **zero verificação** — a definição exata de afirmação sem
prova.

### 2.2 O ROADMAP já resolveu este caso — duas vezes — e resolveu-o **registando**

Este não é um critério meu; é jurisprudência do próprio documento.

`docs/ROADMAP.md:2101-2104` (corpo do `OPS-006`):

> **Porque não foi feito em `OPS-001`:** não era executável nem uma vez neste ambiente (sem
> PostgreSQL, sem Docker), e um trabalho de CI que nunca correu é uma afirmação sem prova.
> Registado em vez de inventado (§1.2).

E o `OPS-002` **já está declarado fora de âmbito por esse motivo**, em dois pontos distintos:

- `:1944` (fecho de `OPS-001`): «**O que fica de fora (declarado):** `Dockerfile` (`OPS-002`),
  alerta de `formatVersion` (`OPS-003`), agendador (`PROD-004`)…»
- `:2064` (fecho de `OPS-001`, §9): «`Dockerfile` (`OPS-002`), alerta de `formatVersion`
  (`OPS-003`), agendador (`PROD-004`).»

O documento diz, portanto, duas coisas ao mesmo tempo: que o `OPS-002` está `BACKLOG` na tabela
de §4, e que foi **deliberadamente deixado de fora** por o ambiente não o permitir provar.
A minha decisão limita-se a **ser coerente com a segunda**.

---

## 3. Provas medidas (comandos e resultados)

| # | O que medi | Comando | Resultado |
| --- | --- | --- | --- |
| P1 | ROADMAP intacto | `sha256sum docs/ROADMAP.md` | `2cd97a34…dc4c8bf` — **igual** antes e depois |
| P2 | `Dockerfile` existe? | `ls Dockerfile* docker-compose* .dockerignore*` | `No such file or directory` |
| P3 | Contentorização rastreada | `git ls-files \| grep -iE "docker\|container"` | vazio |
| P4 | Motor de contentores | `docker --version` | `command not found`, exit **127** |
| P5 | Corpo do `OPS-002` | `awk 'NR>=2073 && NR<=2074'` | 1 título + 1 linha vazia |
| P6 | Corpo do `OPS-003` | `awk 'NR>=2075 && NR<=2076'` | 1 título + 1 linha vazia |
| P7 | Corpos vazios na §5 | script `awk` sobre `## 5.`→`## 6.` | **14 de 65** |
| P8 | Recusa de SQLite em produção | leitura de `core/prisma-client.ts:88-94` | `throw` incondicional |

O ROADMAP foi lido, **nunca escrito**. Nenhum ficheiro do repositório foi criado ou alterado por
esta tarefa além **deste documento**.

---

## 4. Achado transversal para o A9: 14 de 65 tarefas da §5 têm corpo vazio

O `OPS-002` não está sozinho. A auditoria da §5 inteira deu:

| Agente | Tarefas com corpo vazio | Prioridade/estado |
| --- | --- | --- |
| **A1** | **`OPS-002`, `OPS-003`** | P2/P3 · `BACKLOG` |
| A2 | `AUTH-004`, `AUTH-005`, `AUTH-006` | P2 · `BACKLOG` |
| A3 | `WEB-007`, `WEB-008`, `MOB-003`, `MOB-004`, `MOB-005` | P2/P3 · `BACKLOG`/`BLOCKED` |
| A4 | `PROD-005`, `INT-002`, `INT-003`, `INT-004` | P4 · `DEFERRED` |

Total: **14 tarefas sem corpo, em 65** (21,5%).

Duas leituras, ambas para o A9 decidir:

1. **Correlação com o estado.** 12 das 14 são `BACKLOG`, `BLOCKED` ou `DEFERRED` — tarefas nunca
   começadas. Isso é compatível com a prática «escrever o corpo quando se pega na tarefa». As duas
   exceções **de A1** (`OPS-002` P2, `OPS-003` P3) são de prioridade ativa, e é sobre elas que
   incide o risco: são as que um agente pode tentar pegar e descobrir que não há contrato.
2. **A §1.2 não distingue.** Diz que *a tarefa* tem de ter os campos, sem exceção para
   `BACKLOG`. Se a prática é «corpo só quando se começa», a §1.2 deve dizê-lo — ou as 14 devem
   ser preenchidas. É uma decisão de **política do documento**, e é do A9.

**Não escrevi os corpos das tarefas de A2/A3/A4** — não são da minha frente. E não escrevi os de
`OPS-002`/`OPS-003` porque fazê-lo seria inventar contrato, não cumpri-lo.

---

## 5. Blocos prontos a colar para o A9

### 5.1 Correção mínima da linha da tabela (`:310`)

O estado `BACKLOG` está correto — o trabalho não está feito. O que está errado é a coluna das
dependências, pela razão de §1.5. Proposta:

```diff
-| OPS-002  | Operações    | Dockerfile                                                             | A1     | P2         | `BACKLOG`  | —                       |
+| OPS-002  | Operações    | Dockerfile                                                             | A1     | P2         | `BLOCKED`  | `OPS-006`, corpo da tarefa |
```

`BLOCKED` em vez de `BACKLOG` é a minha leitura, mas é **sua** a decisão: o trabalho não está só
por começar — está à espera de uma condição (contrato escrito + ambiente com Docker + caminho
PostgreSQL). Se preferir manter `BACKLOG` e registar o bloqueio apenas no corpo, é igualmente
defensável.

### 5.2 Corpo proposto para `OPS-002` — **lista de decisões, não critérios inventados**

Não escrevi critérios de aceitação: não são meus para escrever. O que se segue é o **esqueleto
com as perguntas que o corpo tem de responder**, para o A9 redigir. Onde não sei a resposta,
pergunto em vez de decidir.

```markdown
#### OPS-002 · Dockerfile — A1 · P2 · `BACKLOG`

- **Descrição:** não existe contentorização no projeto. _(A definir pelo A9: que problema
  resolve — distribuição self-hosted? CI? paridade de ambiente?)_
- **Decisões por tomar (nenhuma está tomada no repositório):**
  1. Imagem base e número de estágios.
  2. Âmbito: só API, ou API + web compilada?
  3. Motor de dados: **produção recusa SQLite** (`core/prisma-client.ts:88-94`), logo exige
     PostgreSQL. Confirmar se o contentor assume PostgreSQL como pré-requisito externo.
  4. Migrações no arranque ou passo separado.
  5. Utilizador sem privilégios.
  6. Sonda de saúde: **`/health`**, não `/api/v1/health` (`PC-33`).
- **Critérios de aceitação:** _(a redigir pelo A9, depois de 1–6 estarem decididos.)_
- **Testes/validação previstos:** exige um motor de contentores — **indisponível neste ambiente**
  (ver `PC-*` abaixo). Um `Dockerfile` que nunca foi construído não é prova de nada; a tarefa não
  deve ser fechada sem `docker build` + arranque + sonda verde.
- **Dependências:** `OPS-006` (caminho PostgreSQL). A tabela diz `—`; está incorreto.
```

### 5.3 `OPS-003` tem o mesmo defeito

`docs/ROADMAP.md:2075` está igualmente vazio. Não é da minha tarefa atual, mas fica registado:
o `OPS-003` (alerta de `formatVersion`, `PC-8`) está `BLOCKED` por dependência de `AUD-011` — que
é decisão de produto — e **também** não tem corpo. Duas razões independentes para não ser pegável.

### 5.4 Nota de ambiente (sugestão de linha `PC-*`; numeração sua)

> **`PC-*` (a numerar pelo A9) — não há motor de contentores neste ambiente.** `docker`,
> `podman` e `nerdctl` ausentes; `wsl.exe` bloqueado por política de segurança. Consequência:
> qualquer tarefa que exija construir ou correr um contentor (`OPS-002`) é **inexecutável e
> improvável** aqui. O `OPS-006` já tinha chegado a esta conclusão por outra via (falta de
> PostgreSQL); esta é a mesma limitação, agora medida explicitamente para contentores.

---

## 6. Âmbito, resíduos e o que fica por decidir

**Feito:** verificação de premissa do `OPS-002`; auditoria dos corpos da §5; leitura do
`prisma-client.ts`; esta proposta. **Um** ficheiro criado (este).

**Não feito, deliberadamente:**

- **Nenhum `Dockerfile` escrito** — seria um contrato inventado e uma afirmação sem prova (§1.3,
  §2).
- **Nenhuma edição ao `ROADMAP.md`** — hash `2cd97a34…` inalterado (P1).
- **Nenhuma alteração a `README.md`, `package.json` ou `.github/`** — o âmbito de `OPS-002` é
  contentorização, e as decisões de §1.4 não estão tomadas.
- **Sem commit, sem push, sem deploy.**

**Resíduos:** nenhum. Nenhum ficheiro temporário criado; nada a reciclar.

**Para o A9 decidir (não decido eu):**

1. Corrigir a dependência do `OPS-002` (`—` → `OPS-006`) e o estado (`BACKLOG` → `BLOCKED`?) —
   §5.1.
2. Redigir o corpo do `OPS-002` a partir das decisões de §1.4 — §5.2.
3. Decidir a política da §1.2 face às 14 tarefas sem corpo — §4.
4. Registar a limitação de ambiente para contentores — §5.4.
