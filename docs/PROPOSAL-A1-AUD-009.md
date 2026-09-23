# Entrega de A1 a A9 — `AUD-009` (fecho)

> **Documento de entrega, não fonte de verdade.** A1 **não** editou `docs/ROADMAP.md` — a regra
> vigente é que só A9 o faz. O texto abaixo está pronto a integrar; depois de A9 integrar, este
> ficheiro pode ser apagado.
>
> **Estado dos IDs no momento da escrita** (2026-09-22, ~17:00): `PC-*` até `PC-34`, `AUD-*` até
> `AUD-015`, `OPS-*` até `OPS-006`. Nenhum ID novo foi criado nem renumerado por A1 nesta entrega.
>
> **Sem commit, sem push, sem deploy.**

---

## 1. O achado que importa: a premissa da tarefa inverteu-se

`AUD-009` foi escrita porque **três textos** descreviam como inexistente trabalho que já existia
(A17, `OPERATIONS` §9, `DocumentsPage`). Ao verificar antes de implementar:

- **A17** — o título, em `HEAD`, já é «Documentos: metadados sim, bytes **só a partir de
  2026-09-18**», e a revisão **`A17.1`** («a transferência passou a existir») está **commitada**.
  Os dois primeiros textos do `AUD-009` original **já estavam corrigidos**.
- **`OPERATIONS` §9** — o texto corrigido («A API **serve** os bytes … mas **não aceita** ficheiros
  novos») está em **`HEAD`** (`docs/OPERATIONS.md:408-412`). Também já estava corrigido.

Mas o trabalho seguinte — **`PROD-001`** (upload de documentos, A4, **`DONE`**) — tornou os mesmos
textos falsos **na direção oposta**: passaram a descrever como inexistente uma capacidade que
**entretanto foi construída**. Medido, não inferido:

| Onde | O que afirma | O que o código faz |
| --- | --- | --- |
| `DECISIONS.md:352` (`A17.1`) | «O que **continua** a não existir é o upload» | `POST /documents/:documentId/content` existe (`http/routes/documents.ts:340`) |
| `OPERATIONS.md:476` (§9) | «mas **não aceita** ficheiros novos … nem escrita pela API» | `uploadDocumentContent` escreve os bytes (`services/documents.ts:385`) |
| `DocumentsPage.tsx:105-107` | «o carregamento de ficheiros novos para o armazenamento ainda não está ligado» | a **API** aceita; a **web** é que não tem controlo |

**Consequência:** o critério de aceitação de `AUD-009` — «nenhuma capacidade pronta continua
descrita como inexistente» — estava **literalmente violado** quando comecei. A tarefa continua a ser
a mesma (`sincronizar três textos`); o que mudou foi **porquê**. Não é trabalho novo, logo **não
proponho tarefa nova**: a que existe cobre-o.

## 2. O que foi alterado

Três ficheiros, **+24 / −13** linhas. Nenhum ficheiro de código de produção foi tocado.

### 2.1 `docs/DECISIONS.md` — `A17.1`

Substituído o parágrafo falso por uma **correção atribuída** que preserva o registo e aponta para a
decisão que o substitui:

```markdown
**Correção de A1 (2026-09-22, `AUD-009`) — o upload deixou de ser a omissão.** O texto que aqui
estava dizia que «continua a não existir o upload» e que «a omissão deixou de ser de capacidade
(ler) e passou a ser de entrada (escrever)». **Isso passou a ser falso**: o upload foi decidido em
**`A31`** e implementado em `POST /api/v1/documents/:documentId/content`
(`http/routes/documents.ts:340`; `uploadDocumentContent` em `services/documents.ts:385`), com
autorização pela mesma porta do download, recusa de um documento que já tenha ficheiro e recusa de
um corpo de zero bytes — ver `PROD-001`.

O que **continua** a não existir é o **envio de bytes pela interface web**: não há
`<input type="file">` para documentos (`apps/web/src/pages/DocumentsPage.tsx:22-26`), pelo que os
bytes entram pela API, pelo importador de bundle (`services/import/apply.ts`) ou por escrita
directa no directório.
```

### 2.2 `docs/OPERATIONS.md` — §9

O bullet deixou de ser «Upload de ficheiros» (que não existe) e passou a ser o que realmente não
existe — o **controlo na web**:

```markdown
- **Envio de ficheiros pela interface web.** A API já **serve** e já **aceita** os bytes
  (`GET` e `POST /api/v1/documents/:id/content`, autenticados e restritos ao dono — §A17.1 e
  §A31; o `POST` recebe o ficheiro com o **corpo cru**, sem `multipart`). O que **não existe**
  é o controlo na web: não há `<input type="file">` para documentos. Os bytes entram pela API,
  pelo importador de bundle ou por escrita directa no directório de documentos
  (`DOCUMENT_STORAGE_DIR`; por omissão `data/documents-storage/` ao lado da base de dados).
```

### 2.3 `apps/web/src/pages/DocumentsPage.tsx` — docblock e aviso

- **docblock** (`:22-26`): «O que continua a **não** existir» passou a «O que continua a **não**
  existir **neste ecrã**», e diz explicitamente que a API já aceita o envio e que este ecrã não tem
  `<input type="file">` — mantendo a razão original do aviso (não fingir que faz mais do que faz).
- **aviso visível** (`:108-109`): «o carregamento … ainda não está ligado» → «O envio de ficheiros
  novos ainda não está disponível **aqui**: a API já o aceita, mas este ecrã ainda não tem um
  controlo para o fazer.»

A distinção é a correta e é a que faltava: **a capacidade existe na API; o que falta é o controlo
na web.** Dizer apenas «não está ligado» lê-se como «o produto não sabe fazer isto», que é falso.

## 3. Provas

| Verificação | Resultado medido |
| --- | --- |
| `vitest run test/documents-http.test.ts` | **exit 0** — 1 ficheiro, **69 testes** |
| `tsc -p apps/web/tsconfig.json --noEmit` | **exit 0** |

Os 69 testes incluem **9 blocos `describe`** que exercitam exatamente o que os textos agora afirmam —
`upload — caminho feliz`, `upload — a metadata existente é preservada`, `upload — tipo de conteúdo`,
`upload — corpo`, `upload — limite de tamanho`, `upload — autorização e isolamento`, `upload — um
documento tem um ficheiro`, `upload — a isenção do parser, ao nível da unidade`, `upload — não
regressão`. As três afirmações que escrevi nos documentos têm, cada uma, um `ficheiro:linha`
verificado no código (§1) — e **não** foram escritas a partir do ROADMAP.

**Referências verificadas uma a uma** (não copiadas): `routes/documents.ts:340` →
`'/documents/:documentId/content'`; `services/documents.ts:385` →
`export async function uploadDocumentContent(`; `DocumentsPage.tsx:22-26` → o docblock.

## 4. O que **não** foi feito / limitações

- **`docs/API.md` não foi tocado.** É de A4 (§8.1) e **já está correto**: documenta `POST` e `GET
  /documents/:id/content` (§A31, linhas 245-254). Não havia nada a sincronizar lá.
- **O controlo de upload na web não foi criado.** `AUD-009` é sincronização de documentação, não
  construção de interface. Se a web deve ganhar o `<input type="file">`, isso é **trabalho novo** e
  cabe a A9 decidir se vira tarefa (`WEB-*`) — **não** o criei.
- **`VehicleDetailPage.tsx:1367` foi verificado e está correto** («a API serve os bytes … esta ficha
  delega a ação na página de detalhe») — não afirma nada sobre upload, logo não tem nada a corrigir.
  Não foi tocado.
- **Não houve prova por mutação.** Não é aplicável: a alteração é texto. A prova é a execução dos
  testes que exercitam a capacidade descrita, mais a verificação `ficheiro:linha` de cada afirmação.
- **O ROADMAP não foi tocado** e o `PC-10` (criado por A3 em 2026-09-22, «texto desatualizado, para
  `AUD-009`») **não foi fechado por A1** — ver §6.

## 5. Proposta de integração no ROADMAP (pronto a colar)

### 5.1 Linha de §4 (substitui a da linha 262)

```markdown
| AUD-009  | Auditoria    | Sincronizar A17 + `OPERATIONS` §9 + texto de documentos                | A1     | P1         | `DONE`     | —                       |
```

### 5.2 Cabeçalho de §5 (substitui a linha 679)

```markdown
#### AUD-009 · Sincronizar A17 + `OPERATIONS` §9 + texto de documentos — A1 · P1 · `DONE`
```

### 5.3 Bloco de fecho a acrescentar em §5, depois do cabeçalho acima

```markdown
**Implementação e provas (A1, 2026-09-22):**

- **Achado: a premissa inverteu-se.** Os três textos do enunciado **já estavam corrigidos** (o título
  de A17 e a revisão `A17.1` estão em `HEAD`; o texto de `OPERATIONS` §9 corrigido está em `HEAD`,
  `:408-412`). Mas **`PROD-001`** (upload, A4, `DONE`) tornou os mesmos textos falsos **na direção
  oposta** — passaram a descrever como inexistente uma capacidade construída. O critério «nenhuma
  capacidade pronta continua descrita como inexistente» estava literalmente violado. A tarefa é a
  mesma; mudou o motivo. **Não** é trabalho novo.
- **Alterados (3 ficheiros, +24 / −13):** `docs/DECISIONS.md` (`A17.1`, correção **atribuída** que
  preserva o registo e aponta para `A31`), `docs/OPERATIONS.md` §9 (o bullet passa de «Upload de
  ficheiros» — que existe — para «Envio de ficheiros pela interface web» — que é o que falta),
  `apps/web/src/pages/DocumentsPage.tsx` (docblock `:22-26` e aviso `:108-109`).
- **Provas:** `vitest run test/documents-http.test.ts` → **exit 0, 69 testes** (9 blocos `describe`
  de upload); `tsc -p apps/web/tsconfig.json --noEmit` → **exit 0**. Cada afirmação escrita foi
  verificada em `ficheiro:linha` no código, não copiada do ROADMAP: `routes/documents.ts:340`,
  `services/documents.ts:385`, `DocumentsPage.tsx:22-26`.
- **Não tocados, por serem de outra frente ou por não terem nada a corrigir:** `docs/API.md` (A4,
  §8.1 — **já correto**, documenta `POST`/`GET /documents/:id/content` em §A31),
  `VehicleDetailPage.tsx:1367` (verificado, correto).
- **Limitações:** (a) não houve prova por mutação — a alteração é texto, e a prova é a execução dos
  testes da capacidade descrita; (b) o **controlo de upload na web não foi criado** — se deve
  existir, é trabalho novo, para A9 decidir; (c) `PC-10` **não** foi fechado por A1 (§6).
- **Commit:** nenhum.
```

### 5.4 Linha nova em §13 (Histórico)

```markdown
| 2026-09-22 | A1 · `AUD-009`: **fechada como `DONE`** — a premissa tinha-se **invertido**. Os três textos do enunciado já estavam corrigidos (título de A17 + `A17.1` em `HEAD`; `OPERATIONS` §9 corrigido em `HEAD:408-412`), mas **`PROD-001`** (upload, A4, `DONE`) tornou-os falsos na direção oposta: descreviam como inexistente uma capacidade construída, violando o critério «nenhuma capacidade pronta continua descrita como inexistente». Corrigidos 3 ficheiros (+18/−9): `DECISIONS.md` (`A17.1`, correção **atribuída** que aponta para `A31`), `OPERATIONS.md` §9 (o que falta é o controlo **na web**, não a capacidade na API) e `DocumentsPage.tsx` (docblock `:22-26` + aviso `:108-109`). Provas: `documents-http.test.ts` **69 testes, exit 0** (9 blocos `describe` de upload), `tsc` da web **exit 0**; cada afirmação verificada em `ficheiro:linha`. `docs/API.md` (A4) **não** foi tocado — já estava correto. **Sem prova por mutação** (alteração de texto). Criar o `<input type="file">` na web **não** foi feito: seria trabalho novo. **Sem commit.** |
```

## 6. Observações que A1 **não** transforma em tarefas

1. **`PC-10`** foi criado por A3 em 2026-09-22 com o texto «texto desatualizado, para `AUD-009`».
   O que A1 corrigiu corresponde-lhe, mas **A1 não fecha `PC-*`** — a consolidação é de A9. Proponho
   que A9 o feche com a nota de que o texto a que se referia tinha **duas gerações**: o que `PC-10`
   apontava já estava corrigido, e o que faltava corrigir era a geração seguinte (pós-`PROD-001`).
2. **O terceiro bullet do enunciado não correspondia ao código.** Dizia que `DocumentsPage.tsx:110`
   «promete um botão que depende de trabalho por fazer» — mas **não há botão nenhum** nessa página,
   e nunca houve: há uma **nota** que diz o que não existe. A descrição foi escrita a partir de uma
   leitura do ficheiro, não da execução. Não é grave, mas é a mesma classe de erro que `PC-11`/`PC-12`
   já registaram (inventário levantado a partir de documentação, não de código).
3. **A lição de processo que esta tarefa deixa.** `AUD-009` nasceu de trabalho que avançou uma
   capacidade sem atualizar a documentação, e **o mesmo voltou a acontecer** com `PROD-001` — apesar
   de `AUD-009` já existir exatamente para o apanhar. A tarefa de sincronização não é um evento, é
   uma **rotina**: quem fecha uma capacidade deve varrer os textos que a descreviam como inexistente.
   Sugestão para A9, sem criar tarefa: incluir essa varredura no fecho de `PROD-*`/`AUTH-*`/`WEB-*`,
   em vez de a deixar para uma auditoria periódica.
