# Entrega de A1 a A9 — `AUD-012` (fecho)

> **Documento de entrega, não fonte de verdade.** A1 **não** editou `docs/ROADMAP.md` — a regra
> vigente é que só A9 o faz. O texto abaixo está pronto a integrar; depois de A9 integrar, este
> ficheiro pode ser apagado.
>
> **Estado dos IDs no momento da escrita** (2026-09-22, ~16:50): `PC-*` até `PC-34`, `AUD-*` até
> `AUD-015`, `OPS-*` até `OPS-006`. Nenhum ID novo foi criado nem renumerado por A1 nesta entrega.
>
> **Sem commit, sem push, sem deploy.**

---

## 1. O que foi feito

`apps/api/scripts/verify.ts`, **+84 / −1 linhas** (`git diff --numstat`). Um só ficheiro de
produção; `apps/api/src/domain/calculations.ts` **não** foi alterado — foi usado apenas como alvo de
mutação e reposto (prova em §4).

A série de abastecimentos do BMW no `verify.ts` foi construída de forma **proporcional**: quatro
depósitos atestados de 60 L a 1 000 km de distância, mais um parcial de 30 L a **fechar** a série.
Os três intervalos dão `60/1 000 = 6,00 L/100 km` e o parcial final não é contabilizado por nenhuma
das duas implementações. Resultado: o check dá `6` antes e depois da correção de A8 — é o `PC-1`.

Acrescentou-se um **terceiro veículo** (`77-QR-05`, `fuelType: 'gasoline'`) e, para ele, a série
canónica que a própria especificação de `AUD-012` descreve:

| # | Data | Litros | Odómetro | `fullTank` | Papel |
| --- | --- | --- | --- | --- | --- |
| 1 | −80 d | 40 | 10 000 km | `true` | âncora |
| 2 | −50 d | 10 | 10 500 km | **`false`** | parcial **entre** dois atestados |
| 3 | −20 d | 50 | 11 000 km | `true` | fecha o intervalo |

- **Implementação atual** → `(10 + 50) / 1 000 × 100` = **`6,00`** L/100 km.
- **Implementação anterior a A8** → media pares adjacentes: `50 / 500 × 100` = **`10,00`** L/100 km.

Os números `6` / `10` da especificação de `AUD-012` são exatamente os desta série. Ficaram fixados em
**dois** pontos, um por cada linha que o ROADMAP aponta como insensível:

- `verify.ts:546-551` — `GET /stats?vehicleId=…&months=12` → `consumption.fuelL100Km === 6`;
- `verify.ts:798-802` — `GET /dashboard?vehicleId=…` → `usage.fuelConsumptionL100Km === 6`.

## 2. Porque é que a série do BMW **não podia** ser a que discrimina (aritmética, não opinião)

Esta parte não é preferência de desenho; é uma impossibilidade que se demonstra. Considere-se
acrescentar ao BMW um parcial `P` e, depois dele, um atestado `F` a `x` km do último depósito
atestado (que está em `133 000 km`, com o parcial em `133 500 km`):

- **nova:** `(180 + 30 + F) / (3 000 + x) = 0,06` ⟹ `F = 0,06x − 30`
- **antiga:** `(180 + F) / (3 000 + (x − 500)) = (150 + 0,06x) / (2 500 + x) = 0,06` ⟹ **`6,00`**

Ou seja: **sempre que a média nova der exatamente `6`, a antiga também dá `6`** — a série inteira é
proporcional à taxa de 6 L/100 km, e o desvio introduzido pelo parcial é absorvido exatamente pelo
desvio do denominador. Não há escolha de `P`, `F` e `x` que separe as duas implementações mantendo
`6` como valor esperado. É por isso que o `PC-1` existia e é por isso que a correção exige uma
**série nova**, não um ajuste da existente.

*(Consequência prática para o ROADMAP: as linhas `:477-481` e `:718-721` da especificação original
já não correspondem aos números atuais do ficheiro — ver §7.)*

## 3. Provas

Tudo abaixo foi **executado**, não lido. Base de dados descartável em `%TEMP%`, fora do repositório,
com o esquema aplicado por `prisma db push --skip-generate`; servidor em `127.0.0.1:4012`; sonda de
prontidão em `/health` (não em `/api/v1/health` — `PC-33`).

### 3.1 Com a implementação atual — verde

| Verificação | Resultado medido |
| --- | --- |
| `tsc -p tsconfig.json --noEmit` | **exit 0** |
| `vitest run test/domain.test.ts test/fuel-consumption-http.test.ts` | **exit 0** — 2 ficheiros, **80 testes** |
| `scripts/verify.ts` | **exit 0** — **235 verificações passaram**, 0 falharam |

### 3.2 Com a implementação **antiga** reposta (mutação) — vermelho no sítio certo

Mutação aplicada em `calculations.ts`: o bloco de âncora de `averageFuelConsumption` substituído
pelo modelo de **pares adjacentes** (`previous` + `entry.fullTank`, km entre odómetros adjacentes,
litros = só os do depósito que fecha). É a causa raiz documentada em `.workbuddy-ai/memory/2026-09-21.md`
(§«Correção de 🔴-1»), reconstruída porque **não é recuperável do git** — o repositório tem **um só
commit** (`385f70a`) para este ficheiro, logo a versão pré-A8 não existe em lado nenhum. A
reconstrução foi **validada pelo número**: dá `10,00` na série `[40 @ 10 000, 10 @ 10 500, 50 @ 11 000]`,
que é exatamente o valor medido e registado a 2026-09-21.

| Check | Com a atual | Com a antiga (mutação) |
| --- | --- | --- |
| `verify.ts:491` — «O consumo médio ignora intervalos com abastecimento parcial» (BMW) | ✓ `6` | ✓ **`6`** ← **não discrimina** (`PC-1`) |
| `verify.ts:790` — «O dashboard de um diesel mostra o consumo de combustível» (BMW) | ✓ `6` | ✓ **`6`** ← **não discrimina** (`PC-1`) |
| `verify.ts:547` — «O consumo médio acumula o parcial que fica entre dois depósitos atestados» | ✓ `6` | ✗ **`10`** ← **discrimina** |
| `verify.ts:799` — «O dashboard mostra o consumo médio com o parcial acumulado» | ✓ `6` | ✗ **`10`** ← **discrimina** |

Resumo da corrida mutada: **233 passaram, 2 falharam**, `exit 1`. As duas que falharam são
exatamente as novas. As duas do BMW **continuam verdes sob o defeito que deviam apanhar** — que é a
demonstração, por execução, da afirmação do `PC-1`.

### 3.3 Reposição verificada por `sha256`

| Ficheiro | Antes | Depois de repor |
| --- | --- | --- |
| `apps/api/src/domain/calculations.ts` | `0efe688eafdec5a014f11e490eec7f88c26deab45b84d0a107daba3415b2e460` | **idêntico** — `REPOSTO E CONFIRMADO` |
| `apps/api/prisma/sqlite/dev.db` | `0589b5754d1dae6e4c8c789de84af940e043b84bfff2026dac89b3581809e450` | **idêntico** — `DEV_DB_INTACTO` |
| `apps/api/scripts/check-integrity.mjs` | `543faf6cd847e7ee9571c133fb47bcb81f239c5c1eeec89c0c0da63e3c520066` | **idêntico** — condição de `OPS-005` mantida |

Sem resíduo de mutação: `grep -n "let previous: FuelEntryInput" calculations.ts` → **vazio**.
Depois de repor, o servidor foi reiniciado com o código reposto e o `verify.ts` voltou a dar
**exit 0 / 235 verificações** — o ciclo mutar → vermelho → repor → verde está fechado.

## 4. Alteração colateral obrigatória (`verify.ts:1011`)

`check('A exportação inclui veículos', … .length === 2)` era uma afirmação de **fixture**: contava os
dois veículos que o script cria. Com o terceiro veículo passou a `3`. **Não é o produto que falhou** —
a exportação contém legitimamente três veículos — e a asserção **não foi enfraquecida** (continua a
ser uma igualdade exata, não um `>=`). Fica declarado aqui porque é a única linha alterada que não
tem a ver com consumo, e porque o número mágico é uma fragilidade conhecida: quem acrescentar um
veículo ao §3 do script tem de a atualizar. **Observação para A9, não tarefa criada por A1.**

## 5. O que **não** foi feito / limitações

- **`npm test` não cobre `apps/api/scripts/verify.ts`** (o próprio `AUD-012` o diz: «o próprio
  `verify.ts` (não corre em `npm test`)»). A prova desta tarefa é a **execução real** de `verify.ts`,
  não a suíte. A suíte foi corrida de forma **dirigida** (`domain.test.ts` +
  `fuel-consumption-http.test.ts`, 80 testes) por ser o que toca no domínio alterado; a suíte
  completa **não** foi corrida nesta tarefa, e não é apresentada como corrida.
- **A implementação antiga é reconstruída, não recuperada.** Não existe em git (um só commit). A
  reconstrução reproduz o número documentado (`10,00`), o que a valida — mas é uma reconstrução, e
  fica dito como tal.
- **O `verify.ts` não foi corrido num runner de GitHub Actions** (mantém-se a limitação já
  declarada em `OPS-001`). Foi corrido localmente, contra base descartável, com o resultado acima.
- Não se alargou o âmbito: `OPS-006` (integração PostgreSQL) **não** foi iniciada, conforme instrução.

## 6. Proposta de integração no ROADMAP (pronto a colar)

### 6.1 Linha de §4 (substitui a de `AUD-012` na linha 265)

```markdown
| AUD-012  | Auditoria    | Checks de consumo do `verify.ts` são insensíveis (PC-1)                | A1     | P2         | `DONE`     | —                       |
```

### 6.2 Cabeçalho de §5.7 (substitui a linha 715)

```markdown
#### AUD-012 · Checks de consumo do `verify.ts` são insensíveis — A1 · P2 · `DONE`
```

### 6.3 Bloco de fecho a acrescentar em §5.7

```markdown
**Implementação e provas (A1, 2026-09-22):**

- **Alterado:** `apps/api/scripts/verify.ts` (+84 / −1). **Nada mais.** `calculations.ts` foi alvo de
  mutação e reposto, confirmado por `sha256`.
- **Série acrescentada** (terceiro veículo, `77-QR-05`, gasolina): atestado 40 L @ 10 000 km →
  **parcial 10 L @ 10 500 km** → atestado 50 L @ 11 000 km. A implementação atual dá **`6,00`**; a
  anterior a A8 dá **`10,00`**. Fixado em dois sítios: `verify.ts:546-551` (`/stats`) e
  `verify.ts:798-802` (`/dashboard`).
- **A série do BMW não podia discriminar, e isso é demonstrável:** `(180 + 30 + F) / (3 000 + x) = 0,06`
  obriga a `F = 0,06x − 30`, e substituindo na média antiga obtém-se `(150 + 0,06x) / (2 500 + x) = 0,06`.
  **Sempre que a nova dá `6`, a antiga dá `6`** — a série é proporcional. Não há `P`, `F`, `x` que as
  separe. Daí a série nova em vez de um ajuste da existente.

| Prova | Resultado medido |
| --- | --- |
| `tsc -p tsconfig.json --noEmit` | **exit 0** |
| `vitest run test/domain.test.ts test/fuel-consumption-http.test.ts` | **exit 0** — 2 ficheiros, **80 testes** |
| `verify.ts` com a implementação **atual** | **exit 0** — **235 verificações passaram**, 0 falharam |
| `verify.ts` com a implementação **antiga** (mutação) | **exit 1** — 233 passaram, **2 falharam** (as duas novas, com `10`) |

- **A mutação prova as duas coisas de uma vez:** as duas linhas do BMW — `:491` e `:790` — continuam
  **verdes** sob o defeito que deviam apanhar (é o `PC-1`, agora medido e não afirmado), enquanto as
  duas linhas novas ficam **vermelhas** com `10`.
- **Reposição:** `calculations.ts` com `sha256` **idêntico** (`0efe688e…`); `dev.db` **intacta**
  (`0589b575…`); `check-integrity.mjs` **intacto** (`543faf6c…`). Sem resíduo de mutação.
- **Alteração colateral declarada:** `verify.ts:1011` contava `2` veículos (afirmação de *fixture*);
  passou a `3`. Continua uma igualdade exata — **não** foi enfraquecida para `>=`.
- **Limitação:** `npm test` não cobre o `verify.ts`; a prova é a execução real. A implementação antiga
  é **reconstruída** da memória de 2026-09-21 (o git tem um só commit) e validada por reproduzir o
  `10,00` documentado.
- **Ficheiros de referência na especificação original** (`:477-481`, `:718-721`) ficaram
  desatualizados pela alteração: os sítios corretos são `:483-494` (BMW, insensível), `:519-555`
  (série discriminante + `/stats`), `:790` (BMW, dashboard) e `:796-802` (dashboard discriminante).
```

### 6.4 Linha de `PC-1` em §2 (substitui a linha 113)

```markdown
| PC-1 | Os checks de consumo do `verify.ts` são **insensíveis** à correção de A8: medido, a série que constroem dá `6` na implementação antiga **e** na nova. Passavam antes e passam depois — zero proteção contra regressão | `apps/api/scripts/verify.ts:477-481`, `:718-721` | Média               | **Fechado** por `AUD-012` (2026-09-22) — série com um parcial **entre** dois atestados: `6` na atual, `10` na antiga, provado por mutação |
```

### 6.5 Linha de `AUD-012` na matriz de conflitos de ficheiros (§12, linha 2302)

```markdown
| `apps/api/scripts/verify.ts`                 | `AUD-012`                                     | A1 só                                | Sem conflito                                                                |
```

*(sem alteração — incluída só para confirmar que o ficheiro continua a ser de A1)*

---

## 7. Observações que A1 **não** transforma em tarefas

Ficam registadas para A9 decidir, porque criar tarefas é prerrogativa de A9 nesta fase:

1. **`verify.ts:1011` é uma afirmação de fixture com número mágico.** Qualquer veículo novo no §3
   obriga a mexer nela. Poderia derivar da lista de veículos criados, mas derivá-la com um `filter`
   introduziria um caminho **vacuoso** (um `id` indefinido encurtaria a lista e a asserção passaria
   por omissão) — pior do que o número mágico. Se A9 quiser, o desenho certo é comparar com
   `[kiaId, bmwId, hatchId].length` **sem** `filter`, ou somar um `check` explícito por veículo.
2. **`PC-1` referia-se a linhas que já não existem.** O `PC-1` e o `AUD-012` apontam para `:477-481`
   e `:718-721`; o ficheiro cresceu. Sugere-se que a integração use as âncoras por **rótulo do check**
   e não por número de linha, que é o que envelhece mal.
