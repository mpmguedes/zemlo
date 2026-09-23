# Entrega de A1 a A9 — `OPS-004` e `OPS-005` (fechos)

> **Documento de entrega, não fonte de verdade.** A1 **não** editou `docs/ROADMAP.md` — a regra
> vigente é que só A9 o faz. O texto abaixo está pronto a integrar; depois de A9 integrar, este
> ficheiro pode ser apagado.
>
> **Estado dos IDs no momento da escrita** (2026-09-22, ~16:35): `PC-*` até `PC-34`, `AUD-*` até
> `AUD-015`, `OPS-*` até `OPS-006`. Nenhum ID novo foi criado nem renumerado por A1 nesta entrega.
>
> **Sem commit, sem push, sem deploy.**

---

## 1. `OPS-004` — `dist/` obsoleto (PC-3) · proposta de fecho

### 1.1 Linha de §4

```markdown
| OPS-004  | Operações    | Limpar `dist/` obsoleto (PC-3)                                         | A1     | P3         | `DONE`     | —                       |
```

### 1.2 Cabeçalho de §5.7

```markdown
#### OPS-004 · Limpar `dist/` obsoleto (PC-3) — A1 · P3 · `DONE`
```

### 1.3 Bloco de fecho a acrescentar em §5.7

```markdown
**Implementação e provas (A1, 2026-09-22):**

- **`dist/` regenerado**, pelo comando do próprio projeto: `npm run build --workspace @zemlo/api` →
  **exit 0**, em **1 m 42 s**. Ficou com **152** ficheiros (76 `.js` + 76 `.map`), contra **150**
  antes.
- **A estagnação foi provada por construção, não por data.** Antes de mexer, compilou-se a API para
  um diretório temporário (`tsc -p tsconfig.build.json --outDir …`) e compararam-se as duas árvores
  por `sha256` ficheiro a ficheiro:

  | Comparação (dist antigo vs. build de agora) | Resultado |
  | --- | --- |
  | ficheiros iguais | 64 |
  | **ficheiros diferentes** | **86** |
  | só em `dist` (perder-se-iam) | **0** |
  | só no build novo | 2 — `services/oauth.js` e `.map` |

  O `dist` antigo **nem sequer continha** `services/oauth.js`, um módulo que hoje existe
  (`AUTH-002`). Zero ficheiros se perderam ao regenerar — o que torna a regeneração segura.
- **Verificação cruzada independente.** Depois de regenerar, comparou-se o `dist` novo com aquele
  build independente: **todo o JavaScript é byte-a-byte idêntico** (0 de 76 `.js` diferem). As 76
  diferenças são **todas** source maps, porque um dos builds usou `--outDir` com um caminho
  absoluto e o outro não. Ou seja: o build é reprodutível, e a diferença residual está explicada.
- **CORREÇÃO de uma premissa do ROADMAP.** O critério desta tarefa dizia «documentado que o
  `prebuild` (`prisma generate`) está bloqueado neste ambiente». **Não está bloqueado.** Medido:
  `npm run build` correu o `prebuild` e o `prisma generate` completou os **dois** clientes —
  **19,48 s** (postgres) e **19,34 s** (sqlite) — com exit 0. A observação anterior de `ETIMEDOUT`
  foi um caso isolado do shim *safe-delete* do sandbox durante o `npm run db:push`, não uma
  impossibilidade. O que é verdade é que o `db:push` **com** `generate` é ordens de grandeza mais
  lento (**6 m 44 s** contra **43 s** com `--skip-generate`) — ver `PC-32`.
- **Sem resíduos:** o diretório temporário de comparação foi removido para a Reciclagem.
- **Sem commit** — `dist/` é ignorado (`.gitignore:5`), logo esta tarefa **não** produz alteração
  versionada nenhuma.
```

### 1.4 Nota sobre `PC-3`

O `PC-3` pode passar a **fechado**, mas vale a pena reter o essencial: o defeito não era «`dist`
existe», era «`dist` afirma o contrário do código». Um `dist` regenerado volta a ficar obsoleto ao
primeiro `src` alterado — a higiene é regerar, não existir. **Sugestão para A9:** se quiser uma
garantia e não só uma limpeza, isto liga-se naturalmente ao `OPS-006` (que já constrói para
produção) — um `npm run build` no CI falharia se a build partisse.

---

## 2. `OPS-005` — destino de `dev/null` (PC-4) · proposta de fecho

**Decisão do utilizador (2026-09-22, 16:30):** *remover e acrescentar uma regra de ignore
específica*, com três verificações exigidas — «`dev/null` já não existe; o ignore está efetivamente
a funcionar; `apps/api/scripts/check-integrity.mjs` permanece intacto».

### 2.1 Linha de §4

```markdown
| OPS-005  | Operações    | Decidir o destino de `dev/null` (PC-4)                                 | A1     | P3         | `DONE`     | —                       |
```

### 2.2 Cabeçalho de §5.7

```markdown
#### OPS-005 · Decidir o destino de `dev/null` (PC-4) — A1 · P3 · `DONE`
```

### 2.3 Bloco de fecho a acrescentar em §5.7

```markdown
**Implementação e provas (A1, 2026-09-22):**

- **O que o ficheiro era, afinal.** O `PC-4` descrevia-o como «artefacto extraviado». A
  investigação mostrou mais: **é uma cópia transpilada de `apps/api/scripts/check-integrity.mjs`** —
  a mesma lógica e as mesmas etiquetas, com os comentários removidos, as aspas normalizadas para
  `"`, e o não-ASCII escapado (`inv\xE1lido`, `\xF3rf\xE3os`), e `100_000_000` reduzido a `1e8`. É a
  assinatura de uma passagem por um transpilador com a saída para *stdout*, redireccionada para o
  caminho literal `dev/null` em vez do dispositivo nulo. **Não continha segredos** (`grep` de
  `secret|password|api_key|bearer|token` → **0** ocorrências) e **nada o referenciava**.
- **Decisão aplicada: removido e ignorado.**
  - `dev/null` (7 729 B) e o diretório `dev/` (que só o continha) foram para a **Reciclagem do
    sistema**, nunca `rm`. `SHFileOperationW` com `FOF_ALLOWUNDO`.
  - Acrescentada ao `.gitignore` (linha 45) uma regra **estreita**: `dev/null`, com o porquê
    escrito por cima. Estreita de propósito — `dev/` é um nome de diretório legítimo em muitos
    projetos, e ignorá-lo inteiro esconderia trabalho futuro.
- **As três verificações exigidas, medidas:**

  | Verificação | Resultado |
  | --- | --- |
  | `dev/null` já não existe | `ls dev/null` → *No such file or directory*; `dev/` também removido |
  | o ignore funciona | **teste funcional**: recriou-se `dev/null`, e `git check-ignore -v` devolveu `.gitignore:45:dev/null`; `git status --porcelain` e `git ls-files --others --exclude-standard` **não** o listaram |
  | `check-integrity.mjs` intacto | `sha256` `543faf6cd847e7ee…` **idêntico** antes e depois |

- **Prova de que o ficheiro é recuperável.** A remoção devolveu `1223` (`ERROR_CANCELLED`) — um
  estado parcial do shell, não uma falha. Verificado na Reciclagem: a entrada `$RJDZSFN` tem
  **7 729 bytes** e `sha256` `99fed23b8a9ef2fb…`, **exatamente igual** ao do `dev/null` original. O
  ficheiro está na Reciclagem, íntegro.
  **Causa do 1223, para não se repetir:** passou-se o **ficheiro e o seu diretório-pai na mesma
  chamada** `SHFileOperationW`. Em chamadas separadas, ambas devolveram `2` (sucesso). Fica a regra:
  **um alvo por chamada, ou pelo menos nunca um ficheiro junto do seu pai.**
- **Nota de exatidão sobre o `PC-4`:** a descrição diz «um `2>/dev/null` escreveu num caminho
  literal». O conteúdo do ficheiro é claramente **stdout** de um transpilador, pelo que o
  redireccionamento terá sido `> dev/null` (sem o `2`). Não é um defeito de comportamento, mas o
  texto induz em erro quem for investigar — vale a pena corrigir a linha do `PC-4`.
- **Sem commit** — `dev/null` não era rastreado, e o `.gitignore` **é** rastreado: esta tarefa
  produz uma alteração versionada (a regra), e é a única.
```

---

## 3. Resumo do estado

| Item | Estado proposto | Alteração versionada? |
| --- | --- | --- |
| `OPS-004` | `DONE` | **Não** (`dist/` é ignorado) |
| `OPS-005` | `DONE` | **Sim** — 7 linhas em `.gitignore` |
| `PC-3` | fechado | — |
| `PC-4` | fechado | — |

**Ficheiros tocados nesta entrega:** `apps/api/dist/` (regerado, ignorado), `.gitignore` (+7 linhas),
`docs/PROPOSAL-A1-OPS-004-OPS-005.md` (este ficheiro).

**Próximo trabalho determinado pelo utilizador:** `AUD-012` — fortalecer `scripts/verify.ts` para que
a implementação antiga **falhe** e a atual passe. Reconhecimento já feito: os dois pontos insensíveis
são `verify.ts:477-481` (consumo médio) e `verify.ts:718-721` (cartão do dashboard), e **ambos
afirmam `=== 6`** — precisamente o valor que a série atual dá na implementação antiga **e** na nova,
que é o que o `PC-1` descreve.
