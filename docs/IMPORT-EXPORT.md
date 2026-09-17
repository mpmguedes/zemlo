# Zemlo — Importação e exportação de dados

**Especificação v1 — fechada.**

A portabilidade de dados não é uma funcionalidade administrativa secundária: é uma
funcionalidade central do Zemlo. O objetivo é duplo — reduzir a barreira à mudança de
outras aplicações para o Zemlo, e garantir que o utilizador nunca fica preso aos seus
próprios dados.

Este documento é a especificação de referência. Descreve o que deve ser construído, e as
decisões já tomadas. Não descreve o que está construído: no momento em que foi escrito, o
exportador existente produz um JSON achatado num único ficheiro e não existe qualquer
importação.

---

## 1. Princípios

Quatro convicções explicam escolhas que de outro modo parecem arbitrárias. Vale a pena
enunciá-las antes das regras, porque as regras derivam delas.

**A identidade de um registo é o seu conteúdo, não o seu identificador.** É isto que
permite importar dados numa conta diferente da de origem, e é isto que torna a
deduplicação uma questão sobre dados em vez de uma questão sobre chaves internas.

**Admitir a incerteza vale mais do que adivinhar.** Um duplicado certo e um duplicado
provável são coisas diferentes. Um sistema que as confunde ou apaga dados do utilizador ou
os duplica — nos dois casos, sem lhe dizer nada.

**O utilizador tem de poder sair.** Um formato que só o Zemlo consegue ler não é
portabilidade; é uma janela. Por isso o ficheiro de exportação declara as suas próprias
unidades e semântica, e existe em paralelo uma representação legível por qualquer folha de
cálculo.

**Nada é escrito sem o utilizador ver o que vai acontecer.** Toda a análise acontece antes
de qualquer escrita. É isto que torna impossível o estado que mais dano causa: dados
criados parcialmente sem ninguém saber.

### 1.1. Garantia de portabilidade

> **O utilizador pode exportar os seus dados e sair do Zemlo. A exportação inclui os dados
> e os documentos originais.**

Esta garantia tem consequências concretas e verificáveis:

- A exportação nativa inclui **os dados e os ficheiros originais dos documentos**, nos seus
  formatos de origem, sem conversão nem recompressão. Um PDF exportado é o mesmo PDF.
- O JSON é legível por ferramentas comuns. Cada linha de um `.jsonl` é um objeto JSON
  completo, `jq` lê-o diretamente, e qualquer linguagem o interpreta sem bibliotecas do
  Zemlo.
- O CSV é utilizável por qualquer folha de cálculo, com unidades legíveis (euros,
  quilómetros) e sem exigir conversões.
- Nenhuma parte da exportação depende de um serviço do Zemlo para ser interpretada.
- Nenhum dado do utilizador existe **apenas** dentro do Zemlo.

---

## 2. Vocabulário — três coisas que é preciso não confundir

A maior parte dos erros de desenho nesta área vem de misturar três conceitos distintos. Ficam
separados por definição.

### 2.1. `localId` — identidade de transporte do bundle

Um `localId` é um identificador **local ao bundle**, gerado pelo exportador, estável dentro
desse bundle e **opaco** para quem o lê:

```
veh_1, veh_2, odom_1, exp_1, fuel_1, doc_1 …
```

Serve **exclusivamente** para duas coisas:

1. **Ligar registos dentro do bundle** — as relações usam `localId`, nunca o `cuid` interno
   da base de dados. `{"localId":"exp_1","vehicleLocalId":"veh_1", …}`.
2. **Registar o que já foi importado**, no livro de idempotência (§9.5), para que reimportar
   o mesmo bundle não crie nada de novo.

O `localId` **não** é identidade de domínio e **não** é usado para decidir se dois registos
são o mesmo. Um `localId` diferente não significa um registo diferente: dois bundles
exportados da mesma conta em momentos diferentes terão `localId` novos para os mesmos
registos, e é por isso que a deduplicação não pode depender deles.

O formato do `localId` nunca é interpretado pelo importador. É o que permite alterá-lo numa
versão futura sem quebrar bundles antigos.

### 2.2. Chaves de deduplicação — identidade de conteúdo

Uma chave de deduplicação é uma função **do conteúdo** do registo: matrícula normalizada,
VIN, data mais quilometragem mais valor, hash de um ficheiro. É isto — e só isto — que
responde à pergunta *"este registo já existe?"*.

As chaves de deduplicação estão definidas na §8.

### 2.3. `externalIds` — identidade na origem anterior

Quando um registo vem de outra aplicação, o identificador que tinha **lá** é transportado,
não descartado:

```json
"externalIds": [{ "source": "outra-app", "id": "12345" }]
```

Isto é o que permite que uma segunda importação da mesma aplicação de origem reconheça os
registos que já entraram, mesmo que os dados tenham sido entretanto editados no Zemlo. É o
que distingue "o mesmo registo que já importei" de "um registo parecido".

### 2.4. Resumo

| Conceito | Responde a | Vive onde | Sobrevive à importação? |
| --- | --- | --- | --- |
| `localId` | "Que registo do bundle é este?" | Dentro do bundle | Não — é substituído por um `id` novo |
| Chave de deduplicação | "Este registo já existe?" | Calculada do conteúdo | Sim — é o conteúdo |
| `externalIds` | "De onde veio este registo?" | No registo | Sim, transportado |

---

## 3. Duas camadas distintas

O desenho tem duas entradas que **não se confundem**. Partilham o núcleo de processamento,
mas têm contratos, garantias e níveis de confiança diferentes.

### 3.1. Camada 1 — bundle Zemlo nativo

Um ZIP produzido pelo exportador do Zemlo e destinado a ser importado pelo Zemlo.

- **Contrato:** versionado e explícito (`manifest.json`).
- **Garantia:** fidelidade total. Exportar e reimportar produz dados equivalentes.
- **Confiança:** máxima. O produtor e o consumidor são o mesmo sistema, e o bundle declara a
  sua própria estrutura, versão e integridade.
- **Quando os dados divergem do que existe:** é um conflito entre dois estados do **mesmo**
  modelo de dados, e resolve-se com a política da §9.6.
- **Validação:** estrutural e semântica completa. Um bundle internamente inconsistente é
  recusado antes de qualquer escrita.

### 3.2. Camada 2 — ficheiro externo (CSV, mais tarde XLSX)

Um ficheiro que o utilizador fez, ou que outra aplicação exportou, e que não conhece o
formato do Zemlo.

- **Contrato:** nenhum. O sistema tem de **inferir** a estrutura.
- **Garantia:** aproximação razoável. Não há promessa de fidelidade, porque não há um modelo
  de origem conhecido.
- **Confiança:** variável. Uma coluna pode ter dois significados possíveis, uma data pode ser
  ambígua, um valor pode estar em duas moedas.
- **Quando os dados divergem:** há sempre um passo de **confirmação humana** do mapeamento
  antes de qualquer escrita (§10).
- **Validação:** por linha, com pré-visualização obrigatória.

**A diferença essencial:** na camada 1 o sistema *sabe* o que os dados são; na camada 2 o
sistema *propõe* o que os dados parecem ser, e o utilizador confirma. Um bundle Zemlo nunca
passa pelo ecrã de mapeamento de colunas, e um CSV nunca é tratado como um bundle.

O utilizador **não** é obrigado a editar o ficheiro para o formato Zemlo. Essa é a razão de
ser da camada 2.

---

## 4. Arquitetura

### 4.1. Cadeia de estágios

```
ImportSource → Parser → Normalizer → Validator → Deduplicator → ImportPlan → Transaction → Report
     │            │          │            │             │             │            │          │
  bytes        bruto     canónico      válido      classificado     plano      aplicado   relatório
              (origem)   (Zemlo)      ou erro     certo/provável   revisto     atómico    ao utilizador
```

A regra que torna a cadeia útil: **nenhum estágio conhece a origem dos dados.** Um bundle do
Zemlo, um CSV do Excel e um export de um fabricante entram pela mesma porta e produzem o
mesmo tipo intermédio.

### 4.2. Contratos entre estágios

| Estágio | Recebe | Produz | Nunca faz |
| --- | --- | --- | --- |
| **ImportSource** | Pedido do utilizador | `{ kind, bytes \| stream, hints }` | Interpretar conteúdo |
| **Parser** | Bytes | `RawRecord[]` + `RawIssue[]` | Validar regras de negócio |
| **Normalizer** | `RawRecord[]` | `CanonicalRecord[]` com `localId` | Escrever na base de dados |
| **Validator** | `CanonicalRecord[]` | `ValidatedRecord[]` + `RecordIssue[]` | Corrigir silenciosamente |
| **Deduplicator** | `ValidatedRecord[]` + estado da conta | `ClassifiedRecord[]` com veredicto | Decidir pelo utilizador |
| **ImportPlan** | `ClassifiedRecord[]` | `Plan` com contagens e ações | Escrever |
| **Transaction** | `Plan` | `AppliedPlan` | Aplicar parcialmente sem o declarar |
| **Report** | `AppliedPlan` | Relatório legível | Esconder o que correu mal |

### 4.3. Adaptadores

Um adaptador é a concretização do **Parser** (e do mapeamento inicial) para uma origem. Do
Normalizer em diante, o núcleo é partilhado por todos.

| Adaptador | `kind` | Estado |
| --- | --- | --- |
| Bundle Zemlo | `zemlo-bundle` | Especificado nesta v1 |
| CSV genérico | `csv` | Especificado nesta v1 |
| Excel genérico | `xlsx` | Fase posterior (decisão 9) |
| Outra app de gestão automóvel | `adapter:<nome>` | Futuro — escreve apenas um Parser |
| Outra app de abastecimentos | `adapter:<nome>` | Futuro |
| Export de fabricante | `adapter:<nome>` | Futuro |
| Ficheiros Excel pessoais | `csv` / `xlsx` | Coberto pela camada 2 |

O critério de sucesso da abstração: **acrescentar um adaptador novo não pode obrigar a tocar
no Normalizer, no Validator, no Deduplicator nem na Transaction.** Se obrigar, a abstração
está errada. O contrato que o garante é o `CanonicalRecord` — um formato interno, distinto do
formato do bundle e distinto do formato de um CSV.

### 4.4. Onde o código vive

Quatro camadas já existentes, sem as misturar:

- `domain/` — regras puras: normalização de matrículas e texto, chaves de deduplicação,
  comparação de registos, política de versões, migrações para a frente. **Sem base de dados,
  sem HTTP.**
- `services/` — orquestração da cadeia, transação, relatório, livro de idempotência.
- `http/` — rotas, limites, tipos de conteúdo.
- `core/` — leitura e escrita do ZIP, hashing, streaming.

---

## 5. Formato do export

### 5.1. ZIP, não JSON único

O exportador atual produz um JSON achatado. A v1 passa a um **ZIP** com um ficheiro por tipo
de registo, porque o ficheiro único não resolve quatro problemas:

1. **Documentos.** Os bytes originais não cabem num JSON sem os corromper. Codificá-los em
   base64 inflaciona 33% e torna o resultado inútil fora da aplicação — o oposto da
   portabilidade prometida na §1.1.
2. **Volumes grandes.** Um JSON de 50 MB obriga a carregar tudo em memória para ler um único
   veículo.
3. **Integridade.** Um hash por ficheiro permite detetar corrupção parcial em vez de recusar
   o bundle inteiro.
4. **Inspeção.** O utilizador pode abrir a pasta e ver ficheiros com nomes que compreende,
   sem ferramentas especiais.

### 5.2. Estrutura

```
zemlo-export-2026-02-14.zip
├── manifest.json               ← versão, âmbito, contagens, hashes, unidades, integridade
├── account.json                ← conta e preferências (ficheiro único)
├── vehicles.jsonl
├── odometer.jsonl
├── expenses.jsonl
├── fuel.jsonl
├── charging.jsonl
├── maintenance.jsonl
├── insurance.jsonl
├── inspections.jsonl
├── taxes.jsonl
├── reminders.jsonl
├── events.jsonl
├── documents.jsonl             ← metadados dos documentos
├── suggestions.jsonl           ← opcional (decisão 5)
├── notifications.jsonl         ← opcional (decisão 5)
├── documents/                  ← FICHEIROS ORIGINAIS dos documentos (decisão 1)
│   └── <localId>/<nome-original.pdf>
├── csv/                        ← camada de leitura humana, um ficheiro por tipo (decisão 11)
│   ├── veiculos.csv
│   ├── despesas.csv
│   ├── abastecimentos.csv
│   └── …
└── README.txt                  ← explica o conteúdo em linguagem simples
```

**`jsonl` e não um array JSON.** Cada linha é um registo independente, pelo que o ficheiro
pode ser lido em streaming — essencial para 100 mil eventos sem esgotar memória — e uma linha
corrompida não invalida o resto. Continua a ser JSON legítimo: `jq -c . expenses.jsonl` lê-o
diretamente e `jq -s .` reconstrói o array.

**`AuditLog` não aparece por omissão** (decisão 5). Quando o utilizador o pede, surge como
`audit.jsonl`.

### 5.3. Regras de representação de valores

| Tipo | Representação | Porquê |
| --- | --- | --- |
| Dinheiro | Inteiro em cêntimos (`amountCents: 4210`) | Evita erros de vírgula flutuante. O `README.txt` e o CSV convertem para euros |
| Data civil | `"2026-02-10"` | Uma despesa "de ontem" não tem hora; guardar um instante produz deslocamentos de um dia |
| Instante | ISO 8601 UTC (`"2026-02-10T18:33:58.892Z"`) | Sem ambiguidade de fuso |
| Verdadeiro/falso | JSON `true` / `false` | Nunca `"Sim"`/`"Não"` no JSON; a conversão pertence ao CSV |
| Decimais | Número JSON (`litres: 42.35`) | Não string |
| Ausente | Chave **omitida** ou `null` — nunca `""` | `""` é um valor; `null` é a ausência dele |
| Unidades | Declaradas no manifest (§5.4) | Não implícitas |

### 5.4. O bundle é autoexplicativo

Sem isto, um ficheiro Zemlo só é interpretável por quem já conhece o Zemlo — exatamente o que
a portabilidade deve evitar. O manifest declara a semântica:

```jsonc
"conventions": {
  "money":    { "unit": "cent", "currency": "EUR", "note": "inteiro; divide por 100 para euros" },
  "dates":    { "civil": "YYYY-MM-DD", "instant": "ISO-8601 UTC" },
  "distance": { "unit": "km" },
  "volume":   { "unit": "L" },
  "energy":   { "unit": "kWh" },
  "missing":  "chave omitida ou null"
}
```

### 5.5. Relações e identificadores no bundle

As relações usam `localId` (§2.1). O `cuid` interno **não** aparece por omissão: é informação
interna e sugere uma identidade que não sobrevive à importação. Quando o utilizador ativa
"incluir identificadores internos" — para depuração ou para reimportar na mesma conta — surge
em `manifest.identifiers`, nunca no meio dos dados.

| Registo | Aponta para |
| --- | --- |
| `odometer`, `expenses`, `fuel`, `charging`, `maintenance`, `insurance`, `inspections`, `taxes`, `reminders`, `events` | `vehicleLocalId` (obrigatório) |
| `events` | `recordLocalId` (opcional — um evento pode existir sem registo associado) |
| `documents` | `vehicleLocalId` (opcional — uma carta de condução não tem veículo) |
| `expenses` | `linkedRecordLocalId` (opcional) |
| `maintenance`, `insurance`, `inspections`, `taxes` | `documentLocalId` (opcional) |
| `suggestions`, `notifications` | `vehicleLocalId` (opcional) |

Uma referência para um `localId` inexistente é uma **referência quebrada**, detetada na
validação antes de qualquer escrita (§9.4).

### 5.6. Documentos

Cada documento tem duas partes, e ambas são exportadas (decisão 1):

- **Metadados**, em `documents.jsonl`: nome, categoria, data, validade, nome do ficheiro
  original, tipo MIME, tamanho, notas, `localId` do veículo.
- **Os bytes originais**, em `documents/<localId>/<nome-original>`.

Regras:

- Os bytes são copiados **sem conversão, sem recompressão e sem alteração de formato**. Um PDF
  exportado é byte a byte o mesmo PDF.
- O nome original é preservado, incluindo a extensão. O `localId` na pasta é o que garante
  unicidade quando dois documentos têm o mesmo nome.
- Cada ficheiro tem o seu `sha256` no manifest, o que permite verificar integridade e serve de
  chave de deduplicação na importação (§8.3).
- Um documento cujos bytes não estejam disponíveis no momento da exportação **não impede** a
  exportação: é exportado como metadados, e o manifest declara-o explicitamente em
  `documents.missingContent`, com a contagem. O utilizador sabe exatamente o que ficou de fora
  em vez de descobrir mais tarde.
- Na importação, um documento sem bytes é criado como metadados e listado no relatório
  (§9.3).

### 5.7. Âmbito — exportação parcial (decisão 6)

A exportação parcial é suportada, e o `manifest.json` declara o âmbito **explicitamente**.
Nunca é implícito, porque um bundle filtrado é indistinguível de um bundle corrompido para
quem apenas conta registos.

```jsonc
"scope": {
  "kind": "full-account",        // full-account | vehicles | date-range | combination
  "vehicleLocalIds": null,       // ou ["veh_1","veh_2"]
  "from": null,                  // ou "2024-01-01"
  "to": null,                    // ou "2026-02-14"
  "includesDocuments": true,
  "note": null                   // texto do utilizador, quando existir
}
```

Consequências na importação:

- O âmbito é mostrado ao utilizador no plano: *"Este ficheiro contém 2 de 5 veículos e dados
  desde 2024-01-01."*
- A importação **não tenta completar** o que o âmbito exclui. Os registos ausentes são uma
  lacuna legítima, não um erro.
- Numa importação parcial para uma conta que já tem dados, a deduplicação aplica-se
  normalmente: o que já existe é reconhecido, o que é novo entra.

### 5.8. Exportação imediata ou em segundo plano (decisão 3)

| Situação | Comportamento |
| --- | --- |
| Exportação **pequena** | Imediata. O ZIP é preparado no pedido e descarregado em seguida |
| Exportação **grande** | Trabalho em segundo plano, com notificação quando estiver pronta |

- O limiar entre as duas é **configurável**. A proposta inicial: 5 000 registos ou 25 MB.
- O limiar avalia-se **antes** de começar a recolher dados, pelo que o utilizador nunca fica à
  espera para depois ser reencaminhado.
- Uma exportação em segundo plano tem estado visível (`a preparar`, `pronto`, `falhou`), com o
  resultado a ser um ficheiro descarregável com prazo de validade declarado.
- Uma exportação que falhe a meio em segundo plano **não deixa um ficheiro parcial** acessível.
  Ou está completo, ou não está disponível.
- A exportação é registada em auditoria nos dois casos (`user.exported_data`), com o âmbito e
  as contagens — nunca com o conteúdo.

---

## 6. Formato do manifest

```jsonc
{
  "manifestVersion": 1,              // versão da ESTRUTURA do manifest
  "format": "zemlo-export",
  "formatVersion": 1,                // versão da SEMÂNTICA dos dados
  "createdAt": "2026-02-14T10:12:00.000Z",
  "createdBy": { "product": "Zemlo", "appVersion": "0.2.0", "sourceEnvironment": "production" },
  "bundleId": "bnd_9f3c…",           // identifica ESTE bundle → idempotência (§9.5)
  "scope": { /* ver §5.7 */ },
  "conventions": { /* ver §5.4 */ },
  "counts": { "vehicles": 2, "expenses": 52, "fuel": 18, "documents": 4 },
  "files": [
    { "path": "vehicles.jsonl", "records": 2, "bytes": 4096, "sha256": "e3b0c442…" },
    { "path": "documents/veh_1/fatura.pdf", "bytes": 184320, "sha256": "9f86d081…" }
  ],
  "documents": {
    "included": true,
    "count": 4,
    "totalBytes": 1843200,
    "missingContent": { "count": 0, "localIds": [] }
  },
  "integrity": { "algorithm": "sha256", "covered": "all-files" },
  "dataClasses": [
    { "name": "core",               "included": true,  "requiredForMigration": true },
    { "name": "account",            "included": true,  "requiredForMigration": true },
    { "name": "documents",          "included": true,  "requiredForMigration": false },
    { "name": "audit",              "included": false, "requiredForMigration": false },
    { "name": "notifications",      "included": false, "requiredForMigration": false },
    { "name": "suggestions",        "included": false, "requiredForMigration": false },
    { "name": "integrationSecrets", "included": false, "requiredForMigration": false,
      "reason": "tokens, passwords e credenciais de integrações nunca são exportados" },
    { "name": "shared",             "included": false, "requiredForMigration": false,
      "reason": "dados de agregações partilhadas envolvem outros utilizadores" }
  ],
  "sharedVehicles": { "count": 0, "note": "veículos partilhados são exportados como dados próprios; dados de terceiros nunca são incluídos" },
  "identitySeed": { "strategy": "bundle-unique-local-ids", "opaque": true },
  "identifiers": { "internalIdsIncluded": false },
  "csv": { "included": true, "files": ["veiculos.csv", "despesas.csv", "…"] },
  "extensions": {}                   // espaço reservado; um importador ignora chaves que não conhece
}
```

### 6.1. Porque `manifestVersion` e `formatVersion` são separados

São coisas diferentes, e confundi-las cria um problema sem solução:

- `manifestVersion` muda quando muda a **estrutura do próprio manifest** — campos, ficheiros,
  convenções. Um importador de manifest v1 consegue ler um manifest v2 se as chaves que
  conhece continuarem lá.
- `formatVersion` muda quando muda a **semântica dos dados** — um campo passa a significar
  outra coisa, uma relação nova, uma regra de arredondamento diferente.

Exemplo prático: acrescentar `documents/` é uma mudança de `formatVersion` (conteúdo novo) sem
tocar em `manifestVersion`. Acrescentar `conventions.energy` é só `manifestVersion`.

### 6.2. Inventário de dados

Comparando o schema (27 tabelas) com o que o exportador atual recolhe.

| Tabela | Estado atual | Decisão v1 |
| --- | --- | --- |
| `Vehicle`, `OdometerReading`, `Expense`, `FuelSession`, `ChargingSession`, `MaintenanceRecord`, `InsurancePolicy`, `InspectionRecord`, `TaxRecord`, `Document`, `Reminder`, `VehicleEvent` | Já exportado | Manter, com `localId`. `Document` passa a incluir bytes |
| `User` | Parcial (só campos de perfil) | **Completar**: locale, fuso, unidades, moeda |
| `UserPreference` | Em falta | **Incluir** — é conta; faz parte de uma migração completa |
| `NotificationPreference` | Em falta | **Incluir** — o utilizador não deve ter de reconfigurar tudo |
| `SuggestionState` | Em falta | **Opcional**, desmarcado por omissão (decisão 5) |
| `Notification` | Em falta | **Opcional**, desmarcado por omissão (decisão 5) |
| `AuditLog` | Em falta | **Excluído por omissão** (decisão 5). Opt-in explícito |
| `Session`, `OneTimeToken` | Fora | **Excluir sempre** — segredos operacionais. Sessões não migram por definição (decisão 4) |
| `Integration` | Fora | **Apenas metadados**: `category`, `provider`, `label`, `config`, `scopes`. `credentials` **nunca** (decisão 4) |
| `HomeAssistantEntity` | Fora | Excluir — é estado de publicação, reconstruído no destino |
| `AppSetting` | Fora | Excluir — configuração da instalação, não do utilizador |
| `Household`, `HouseholdMember` | Fora | **Só dados do utilizador** (decisão 2) |
| `Organization`, `OrganizationMember` | Fora | **Só dados do utilizador** (decisão 2) |

---

## 7. Fluxo de importação

### 7.1. Fases

```
   upload → triage → validate → plan → review → apply → report
   (nada    (nada    (nada      (nada   (utilizador (escrita  (leitura)
   escrito) escrito)  escrito)  escrito)  decide)    atómica)
```

**Nenhuma escrita acontece antes da fase `apply`.** Até aí o pedido é puramente de análise e
pode ser abandonado sem consequência. É isto que torna impossível criar dados parcialmente sem
o utilizador saber.

| Fase | O que faz | Falha → |
| --- | --- | --- |
| **Upload** | Recebe o ZIP, verifica tipo, tamanho e assinatura; guarda em área temporária isolada | Erro imediato, nada guardado |
| **Triage** | Lê `manifest.json`, identifica `format` e versões, decide compatibilidade, verifica a estrutura esperada | Recusa com motivo concreto |
| **Validate** | Verifica o hash de cada ficheiro, analisa todos os registos, valida campos e relações, conta problemas por gravidade | Recusa se houver bloqueantes; caso contrário continua |
| **Plan** | Deduplica, classifica cada registo, produz contagens e ações propostas | Nada a aplicar → informa |
| **Review** | Devolve o plano ao utilizador. Básico: resumo e um botão. Avançado: lista e decisões por registo | — |
| **Apply** | Aplica o plano, de forma atómica ou por lotes, com registo de idempotência | Rollback do que não foi confirmado |
| **Report** | Relatório final, no ecrã e descarregável, com o que foi criado, enriquecido, ignorado e o que ficou por decidir | — |

### 7.2. Transacionalidade (decisão 7)

| Volume | Comportamento |
| --- | --- |
| **Até 10 000 registos** | Transação única. Tudo ou nada |
| **Acima de 10 000** | Processamento por lotes, cada lote atómico, com **ponto de retoma persistido** |

- **O limite é configurável.** 10 000 é o valor inicial.
- Durante o processamento por lotes, o estado `parcialmente aplicada` é **visível no ecrã**,
  com contagem real: *"1 200 de 8 400 registos"*. O utilizador vê o progresso, não adivinha.
- O ponto de retoma permite continuar após uma interrupção, e a idempotência (§9.5) garante
  que retomar **não duplica** o que já entrou.
- **Nunca** existe um estado em que o utilizador não saiba que a importação ficou a meio. O
  ecrã de importação mantém o estado até haver relatório final.
- Se um lote falhar de forma não recuperável, os lotes já aplicados **mantêm-se**, e o relatório
  di-lo explicitamente com a contagem exata. Não se finge que nada aconteceu nem se esconde o
  que aconteceu.

### 7.3. Segurança da entrada

O ZIP é entrada não fidedigna, e o histórico de vulnerabilidades em torno de arquivos é longo.
Precauções mínimas, todas obrigatórias:

- **Zip-slip.** Cada caminho é canonicalizado e confirmado como descendente da raiz de extração.
  Caminhos com `..`, absolutos, ou com letra de unidade são rejeitados.
- **Bomba de descompressão.** Limite de bytes **descomprimidos** (não apenas comprimidos) e
  limite do número de entradas, ambos verificados antes de extrair.
- **Symlinks.** Entradas que sejam links são rejeitadas, nunca seguidas.
- **Nomes de ficheiro.** Nunca usados diretamente no sistema de ficheiros. O conteúdo é
  guardado com uma chave própria.
- **Limites.** Tamanho máximo por entrada e lista de extensões permitidas.
- **Autorização.** A importação escreve na conta do utilizador autenticado. A conta vem sempre
  do token, **nunca** do pedido: não existe forma de importar para outra conta.
- **Auditoria.** `data.import_started`, `data.import_applied`, `data.import_rejected`, com
  `bundleId` e contagens — nunca com o conteúdo.
- **Sem execução.** Um manifest malformado é um erro de validação, não uma exceção não tratada.

---

## 8. Estratégia de deduplicação

### 8.1. Princípio

> Dois registos semelhantes **não** são necessariamente o mesmo registo.

### 8.2. Três fontes de duplicação

Tratá-las com a mesma regra é o erro comum. São distintas:

1. **Dentro do próprio ficheiro** — o mesmo abastecimento registado duas vezes na folha de
   cálculo.
2. **Entre o ficheiro e o que já existe na conta** — o caso da reimportação.
3. **Entre duas importações do mesmo bundle** — resolvido por idempotência (§9.5), não por
   deduplicação.

### 8.3. Níveis de certeza

| Nível | Significado | Ação por omissão |
| --- | --- | --- |
| **Certo** | Uma chave forte coincide **exatamente** | Ignorar. Contado no relatório |
| **Provável** | Chave composta dentro de tolerância, ou forte semelhança sem coincidência exata | **Perguntar**, com a razão concreta |
| **Nenhum** | Sem coincidência | Criar |

E o que fazer com os prováveis (decisão 10): o plano permite **decisão individual** e
**aplicação em bloco**. Numa importação de 8 000 registos com 400 prováveis, exigir 400
decisões individuais torna a funcionalidade inutilizável; e resolver os 400 em silêncio
apaga dados. É preciso poder fazer as duas coisas.

### 8.4. Chaves por tipo de registo

**Veículo**

| Chave | Nível |
| --- | --- |
| `vin` normalizado (maiúsculas, sem espaços; sem `I`, `O`, `Q`) | **Certo** — o VIN é único por desenho |
| `plate` normalizada (maiúsculas, sem separadores nem espaços) | **Certo**, com ressalva: matrículas são reatribuídas entre países e ao longo do tempo. Se o VIN existir e diferir, é **provável**, não certo |
| `make + model + year` sem qualquer identificador | **Provável** |
| `externalId` de uma origem anterior | **Certo** |

**Despesa.** `data + valor + veículo` é **provável**, não certo: duas portagens no mesmo dia pelo
mesmo valor são um caso real e comum. Sobe a **certo** se coincidirem também a categoria, o
fornecedor e a descrição.

**Abastecimento.** `data + litros + quilometragem` é **certo** — a quilometragem é praticamente
única por veículo. `data + litros` sem quilometragem é **provável**. `data + valor` é
**provável**.

**Carregamento.** `data + energia (kWh) + quilometragem` é **certo**. `data + energia` é
**provável**.

**Manutenção, inspeção, imposto, seguro.** `data + tipo` é **provável**;
`data + tipo + valor + quilometragem` é **certo**. Imposto: `ano + tipo` é **certo**.

**Quilometragem.** `data + valor` é **certo** — uma leitura por dia por veículo é a regra, e
duas iguais são a mesma leitura registada duas vezes.

**Documento.** Por ordem de força:

1. `sha256` do conteúdo — **certo**. O mesmo ficheiro é o mesmo documento. **Depende dos bytes,
   que a v1 passa a exportar (decisão 1)**
2. `storageKey` — **certo**, quando presente.
3. `nome + veículo + validade` — **provável**.

**Lembrete.** `título normalizado + veículo + condição (data ou km)` é **certo**.

**Evento.** `tipo + data + recordLocalId` é **certo**. Sem `recordLocalId`,
`tipo + data + título` é **provável**.

### 8.5. Normalizações que as chaves exigem

A deduplicação falha em silêncio quando compara strings que deviam ser iguais. Regras
explícitas:

| Campo | Normalização |
| --- | --- |
| Matrícula | maiúsculas; remover espaços, hífenes e pontos |
| VIN | maiúsculas; remover espaços; rejeitar `I`, `O`, `Q` |
| Texto livre (fornecedor, posto, oficina, descrição) | minúsculas; remover acentos; colapsar espaços; remover `Lda`, `S.A.`, `Unipessoal` |
| Data civil | formato canónico; datas ambíguas resolvidas pela convenção declarada ou pela ordem indicada no mapeamento |
| Valor | inteiro em cêntimos, arredondado ao cêntimo |
| Quilometragem | inteiro |

### 8.6. Tolerâncias

Só onde existe uma razão física, e sempre declaradas — nunca "aproximado":

| Comparação | Tolerância | Razão |
| --- | --- | --- |
| Quilometragem | ±50 km | O mesmo abastecimento registado em dois sítios difere pelo arredondamento do odómetro |
| Valor monetário | ±2 cêntimos | Arredondamentos de conversão de moeda na origem |
| Litros | ±0,05 L | Arredondamento do mostrador da bomba |
| Data civil | **0 dias** | Uma data errada por um dia é um dado errado, não um duplicado |

Uma tolerância é uma hipótese sobre o mundo físico. Onde não há razão física, a comparação é
exata.

---

## 9. Comportamento perante erros

### 9.1. Gravidades

| Gravidade | Efeito | Exemplo |
| --- | --- | --- |
| **Bloqueante** | A importação **não** avança. Detetado antes de escrever | Formato desconhecido; versão incompatível; hash que não coincide; referência para veículo inexistente; campo obrigatório em falta em registos essenciais |
| **Recuperável** | O registo entra com a lacuna declarada, ou fica em quarentena para decisão | Valor negativo numa despesa; data futura; categoria desconhecida; documento sem ficheiro |
| **Informativo** | Nada muda no resultado | Campo desconhecido ignorado; data convertida; registo ignorado por duplicado |

### 9.2. Regra de ouro

> Um registo com problemas **nunca** é criado parcialmente em silêncio. Ou entra completo, ou
> entra com uma lacuna que o relatório nomeia, ou não entra e o relatório diz porquê.

Cada `CanonicalRecord` transporta `quality: 'complete' | 'partial' | 'quarantined'` e uma lista
de `issues`. O relatório agrupa por gravidade e permite descarregar a lista em CSV — porque numa
importação de 8 000 registos, "3 registos com problemas" sem os nomear é informação inútil.

### 9.3. Situações e tratamento

| Situação | Comportamento |
| --- | --- |
| **Registo novo** | Criado. O `localId` é registado no livro de idempotência |
| **Registo já existente** | Não é criado de novo. Classificado como certo, provável ou enriquecimento |
| **Alteração** (duplicado cujo conteúdo difere) | **Omissão por omissão** (decisão 8). Nunca sobrescrever em silêncio |
| **Duplicado certo** | Ignorado, com contagem no relatório |
| **Duplicado provável** | Apresentado ao utilizador com a razão concreta ("mesma data, mesmo valor, quilometragem a 4 km"). Decisão individual ou em bloco (decisão 10) |
| **Referência quebrada** | **Bloqueante**, detetada antes de qualquer escrita |
| **Documento sem ficheiro** | Não bloqueante. O registo é criado sem os bytes; o relatório lista-o em "documentos sem ficheiro", com ação para os adicionar depois |
| **Versão incompatível** | Recusa antes de escrever, segundo a política da §12 |

### 9.4. Referências quebradas — porque são bloqueantes

Uma referência quebrada significa que o bundle está internamente inconsistente. Importá-lo
parcialmente produziria exatamente o estado que os princípios proíbem: dados criados sem o
utilizador saber que faltam outros.

Se o utilizador quiser importar na mesma, a decisão é explícita — *"importar sem estes
registos"* — e o plano passa a declarar desde o início o que fica de fora. O que nunca acontece
é a degradação silenciosa.

### 9.5. Idempotência e livro de idempotência

- Cada bundle carrega um `bundleId`.
- Cada registo importado é registado como `(userId, bundleId, localId) → id do registo criado`.
- Reimportar o mesmo bundle **não cria nada**. O relatório diz: *"já importado em 14/02/2026 às
  10:31; nada a fazer."*
- Um bundle **diferente** com registos iguais cai na deduplicação por conteúdo (§8) — que é o
  caminho correto, porque um bundle novo pode legitimamente conter dados novos.
- Reimportar um bundle numa conta **diferente** cria tudo: a chave inclui `userId`. É isto que
  torna possível exportar de uma conta e importar noutra.

**Retenção: 12 meses** (decisão 12). Consequência que é preciso assumir explicitamente: uma
reimportação do mesmo bundle **depois** desse prazo não é reconhecida pelo livro. Nesse caso a
idempotência já não protege, mas a deduplicação por conteúdo continua a proteger — desde que os
registos não tenham sido alterados no Zemlo entre as duas importações. A retenção é
configurável, e o valor deve ser revisto quando houver dados reais de utilização.

---

## 10. Camada 2 — CSV e Excel genérico

### 10.1. O problema

O utilizador tem um ficheiro que ele próprio fez, ou que outra aplicação exportou. Não conhece
o formato do Zemlo e **não deve ter de o conhecer**. O sistema tem de fazer o trabalho de
adivinhar, e de admitir quando não tem a certeza.

### 10.2. As nove fases

| # | Fase | O que acontece | O que o utilizador vê |
| --- | --- | --- | --- |
| 1 | **Upload** | Aceita CSV. Deteta codificação (UTF-8, UTF-8 com BOM, CP1252 — comum no Excel PT), separador (`;`, `,`, tab) e se existe cabeçalho | "Encontrei 247 linhas e 9 colunas" |
| 2 | **Deteção de colunas** | Lê o cabeçalho e uma amostra de valores. Percebe se a linha 1 é cabeçalho ou já é dado | "A primeira linha parece ser o cabeçalho" |
| 3 | **Mapeamento automático** | Compara cada coluna com um dicionário de sinónimos por campo canónico | "Data → Data · Litros → Litros · Total → Valor" |
| 4 | **Confirmação / correção** | Ecrã de mapeamento. Colunas não reconhecidas e campos obrigatórios em falta ficam destacados | "Não sei o que é 'Km/l'. Ignorar esta coluna?" |
| 5 | **Preview** | Mostra as primeiras ~20 linhas **já normalizadas**, não o ficheiro cru | "Assim é como vão ficar os teus dados" |
| 6 | **Validação** | Aplica o Validator a todas as linhas. Erros com número de linha e motivo | "Linha 47: a data '32/13/2026' não existe" |
| 7 | **Deteção de duplicados** | As mesmas chaves que o bundle (§8) | "14 linhas parecem já existir. Ver quais" |
| 8 | **Importação** | Mesma transação e idempotência | — |
| 9 | **Relatório** | Igual ao do bundle, mais o mapa de colunas usado | "Importei 198 registos. Guardei este mapa para a próxima vez" |

O passo 9 merece nota: **guardar o mapa de colunas** por utilizador e por forma de ficheiro faz
com que a segunda importação do mesmo fornecedor seja um clique. É o que distingue uma
funcionalidade usada de uma abandonada.

### 10.3. Dicionário de sinónimos (exemplo, não exaustivo)

| Campo canónico | Sinónimos aceites |
| --- | --- |
| `date` | data, date, dia, fecha, data de compra |
| `amountCents` | valor, total, montante, preço, custo, amount |
| `odometerKm` | km, quilómetros, quilometragem, odómetro, mileage, kms |
| `litres` | litros, litres, l, quantidade, volume |
| `energyKwh` | kwh, energia, energia (kwh), kw |
| `plate` | matrícula, matricula, plate, viatura, veículo |
| `vendor` | fornecedor, posto, local, oficina, estabelecimento, vendor |
| `category` | categoria, tipo, type, descrição |

O dicionário vive no `registry` de domínio, ao lado das categorias — pela mesma razão que as
categorias lá vivem: acrescentar um sinónimo não deve ser uma alteração espalhada pelo código.

### 10.4. Ambiguidades que o sistema não resolve sozinho

Admitir a incerteza é parte do desenho:

- **Datas ambíguas** (`03/04/2026`): se todos os valores de um dos campos forem ≤ 12,
  pergunta-se "dia/mês ou mês/dia?", com pré-visualização das duas interpretações. A resposta
  fica guardada no mapa.
- **Separador decimal** (`1.234,56` vs `1,234.56`): deteta-se pelo padrão dominante da coluna e
  confirma-se no preview.
- **Duas moedas na mesma coluna**: erro recuperável, com quarentena das linhas afetadas.
- **Uma coluna que pode ser duas coisas** (`Km/l`): pergunta-se; se a resposta for "nenhuma",
  ignora-se.

### 10.5. Deteção do tipo de registo

| Colunas presentes | Tipo inferido |
| --- | --- |
| data + valor + litros (+ km) | Abastecimento |
| data + valor + categoria | Despesa |
| data + valor + tipo ou oficina (+ próxima data) | Manutenção |
| data + km, sem valor | Leitura de quilometragem |

Se a inferência for ambígua, o utilizador escolhe — é uma pergunta de uma linha, não um ecrã de
configuração.

### 10.6. XLSX

**Fica para fase posterior. CSV primeiro** (decisão 9).

Razão: ler XLSX exige uma biblioteca nova, e o projeto não tem hoje qualquer leitor de folhas de
cálculo. Entrega-se primeiro a cadeia completa (Parser → Report) com CSV, que não exige
dependência nenhuma, e só depois se acrescenta o leitor XLSX. Assim, a escolha da biblioteca não
bloqueia a arquitetura, e quando ela chegar o único trabalho é um Parser novo — que é
precisamente o que a §4.3 promete.

---

## 11. UX

### 11.1. A regra

> Importar deve ser simples para um utilizador básico e poderoso para um utilizador avançado.

Concretização: **um caminho por omissão de três toques**, e a profundidade atrás de um "Ver
detalhes" que o utilizador básico nunca precisa de abrir. Nunca o contrário — não existe um
ecrã de configuração a esconder o botão de importar.

### 11.2. Fluxo mobile-first

```
Definições → Os teus dados
  ├── Exportar os meus dados   →  escolher âmbito → [pré-visualizar] → ZIP
  └── Importar dados           →  escolher ficheiro → para onde → [analisar]
```

Importação, no telemóvel:

```
1. Escolher ficheiro           (câmara, ficheiros, iCloud, Drive)
2. Onde colocar                (conta vazia → sem pergunta; conta com dados → "adicionar aos existentes")
3. [Analisar]                  ← nada foi escrito ainda
   "Encontrei 2 veículos e 312 registos. 14 parecem já existir."
   ┌──────────────────────────────────────┐
   │  Criar              298              │
   │  Já existem          14   Ver ▸      │
   │  Precisam de decisão  3   Ver ▸      │
   │  Não vou importar      0             │
   └──────────────────────────────────────┘
   [ Importar 298 registos ]
4. Relatório                   →  partilhável em CSV, guardado no histórico
```

### 11.3. Princípios ergonómicos

| Princípio | Concretização |
| --- | --- |
| **Nada acontece sem o utilizador ver o que vai acontecer** | O passo 3 existe sempre. Nunca há um botão que importa logo após escolher o ficheiro |
| **A primeira importação é a mais simples** | Conta vazia → não há duplicados nem decisões. Só "importar" |
| **Toda a decisão tem pré-visualização** | "Ver ▸" mostra os registos concretos, lado a lado quando é um conflito |
| **Zero conceitos técnicos** | Não aparece "ID", "chave", "transação", "referência", "schema", "localId" |
| **Nunca um beco sem saída** | Mesmo com erros bloqueantes, o ecrã diz o que fazer a seguir. O ficheiro não se perde: pode corrigir-se e reenviar |
| **O relatório é um artefacto** | Descarregável, guardado no histórico, com contagens e lista de problemas |
| **Não pedir duas vezes** | O mapa de colunas fica guardado (camada 2) |

### 11.4. Modo avançado

Atrás de "Ver detalhes", nunca obrigatório:

- mapa de colunas editável (camada 2);
- lista completa de prováveis duplicados, com **decisão individual ou aplicação em bloco**
  (decisão 10);
- política de conflito: manter o que tenho / usar o ficheiro / preencher apenas o que está
  vazio (por omissão: a terceira, decisão 8);
- lista de avisos e de registos em quarentena, em CSV;
- escolha explícita do que fazer com referências quebradas ("importar sem estes");
- seletor de âmbito na exportação, incluindo se os documentos e o CSV vão no bundle.

### 11.5. Estados vazios e de erro

- **Conta vazia, sem importação:** "Ainda não tens dados. Podes importar de outra aplicação." A
  importação aparece na primeira utilização, não escondida em Definições.
- **Importação por lotes a decorrer:** barra de progresso com contagem real, e a frase explícita
  "podes sair desta página, continua a correr" **quando for verdade**.
- **Importação interrompida:** "A importação ficou a meio. Não duplico nada ao continuar."
- **Exportação em segundo plano:** estado visível, notificação quando estiver pronta, e o
  ficheiro com prazo de validade declarado.

---

## 12. Versionamento

### 12.1. Política de compatibilidade

| Situação | Comportamento |
| --- | --- |
| `formatVersion` **igual** | Importação normal |
| `formatVersion` **menor** (bundle antigo, aplicação nova) | Importação com **migração para a frente**, registada no relatório ("convertido do formato 1 para o 2: …") |
| `formatVersion` **maior** (bundle novo, aplicação antiga) | **Recusa explícita**: "Este ficheiro foi criado por uma versão mais recente do Zemlo. Atualiza a aplicação." Nunca tentar adivinhar |
| `format` diferente de `zemlo-export` | Recusa, com encaminhamento: se for CSV, é a camada 2 |
| `manifestVersion` desconhecido, mas com as chaves necessárias | Importa; chaves desconhecidas são ignoradas (compatibilidade para a frente) |
| ZIP sem `manifest.json` | Recusa. É o único ficheiro obrigatório |
| Vários bundles no mesmo ZIP | Recusa — ambíguo por desenho |

### 12.2. Regras de evolução

1. **Só se acrescenta.** Campos novos são opcionais e têm valor por omissão. Nunca se reutiliza
   um nome de campo com outro significado.
2. **Nunca se remove um campo** sem subir `formatVersion` e manter um caminho de leitura durante
   pelo menos uma versão.
3. **As migrações para a frente são funções puras do domínio**, uma por salto de versão,
   testáveis isoladamente, e cada uma regista o que fez.
4. **O exportador só produz a versão atual.** Bundles antigos são lidos, não reescritos.
5. **Um bundle nunca é migrado em disco.** A conversão acontece em memória, durante a
   importação.

### 12.3. O que faz subir `formatVersion`

Sobe quando um consumidor externo puder interpretar mal os dados:

- mudar a unidade de um campo (cêntimos → euros);
- mudar a semântica de um campo existente;
- tornar obrigatória uma relação que era opcional;
- acrescentar ou remover um ficheiro de dados no ZIP.

**Não** sobe: acrescentar um campo opcional; corrigir o texto de `notes`; acrescentar uma
categoria ao registry.

---

## 13. Testes

### 13.1. Testes obrigatórios

| Teste | O que prova |
| --- | --- |
| **Export → import (mesma conta)** | Ciclo completo. Nada é criado de novo, nada é perdido |
| **Export → import (conta vazia)** | Migração real. Todas as contagens coincidem no destino |
| **Repetir a mesma importação** | Idempotência. A segunda execução não cria nada e di-lo |
| **Duplicados** | Certos ignorados; prováveis apresentados com razão; tolerâncias aplicadas exatamente |
| **Dados incompletos** | Registos parcialmente preenchidos entram com a lacuna declarada, ou vão a quarentena — nunca criados parcialmente em silêncio |
| **Referências inválidas** | Bundle internamente inconsistente é recusado **antes** de escrever |
| **Documentos** | Bytes recuperáveis e **idênticos byte a byte**; documento sem ficheiro não bloqueia e é listado |
| **Versões diferentes do manifest** | Versão menor migra e registra o que fez; versão maior recusa com mensagem clara; `format` desconhecido recusa |
| **Importação interrompida** | Matar o processo a meio não deixa estado ambíguo; retomar não duplica (crítico acima de 10 000 registos) |
| **Grandes volumes** | 100 mil eventos: tempo, memória e comportamento do caminho por lotes |

### 13.2. Teste de equivalência antes/depois

É o teste central, e responde à pergunta do produto — *recuperar dados equivalentes*. Não se
resume a contar linhas.

Procedimento:

1. Conta de origem com dados ricos e variados, incluindo deliberadamente os casos difíceis:
   veículo arquivado, leitura de quilometragem corrigida (`isCorrection`), despesa ligada a um
   documento, lembrete sem data mas com km, documento sem veículo, evento sem registo associado,
   documento com ficheiro e documento sem ficheiro.
2. Export.
3. Import numa conta **vazia**.
4. Export da conta de destino.
5. **Comparação canónica dos dois bundles**: normalizar (remover `localId`, `createdAt`,
   `updatedAt`, instantes operacionais), ordenar e comparar estrutura e valores.

O que se compara, e o que **não** se compara:

| Compara-se | Não se compara, e porquê |
| --- | --- |
| Todos os campos de domínio, valor a valor | `localId` — é local ao bundle, por definição (§2.1) |
| Conjunto de relações (cada registo aponta para o veículo certo) | `createdAt` / `updatedAt` — a importação cria registos novos, com tempo novo |
| Contagens por tipo | `id` interno — não sobrevive por desenho |
| Campos derivados calculados: consumo médio, custo por km, totais anuais | `lastUsedAt` e contadores operacionais |
| **Documentos: bytes idênticos por `sha256`** | — |

O quarto ponto da coluna da esquerda é o que dá valor real: se o consumo médio e o total anual
coincidem no destino, a migração preservou o **significado** dos dados, não apenas as linhas. O
domínio já tem funções puras que calculam estes valores, pelo que o teste as reutiliza em vez de
duplicar a lógica.

### 13.3. Testes de propriedade

Regras que devem valer para **toda** a entrada válida, não apenas para os exemplos que alguém se
lembrou de escrever:

1. Importar duas vezes = importar uma vez.
2. Um bundle exportado a partir do resultado de uma importação é equivalente ao original
   (invariância do ciclo).
3. Nenhuma importação cria dados fora do conjunto declarado no plano.
4. Nenhuma importação falhada deixa registos criados sem o declarar.
5. A ordem dos registos no ficheiro não altera o resultado.
6. Cada registo de origem tem exatamente um destino, ou uma razão declarada para não o ter.

### 13.4. Testes de segurança da entrada

Independentes dos funcionais, porque uma importação é uma superfície de ataque:

- ZIP com caminho `../../etc/passwd` → recusado, nada escrito fora da área temporária.
- ZIP com 10 000 entradas → recusado pelo limite.
- ZIP de 1 MB que descomprime para 10 GB → recusado pelo limite de bytes descomprimidos.
- Entrada que é symlink → recusada.
- `manifest.json` com JSON malformado → erro de validação, sem exceção não tratada.
- Importar para outra conta → impossível por desenho: a conta vem do token, nunca do pedido.
- Bundle de outra conta → os dados dessa conta não são tocados.

---

## 14. Decisões fechadas

As doze decisões que fecham a v1, com as suas consequências.

| # | Decisão | Consequência no desenho |
| --- | --- | --- |
| **1** | **Documentos:** o export nativo inclui dados **e** os ficheiros originais | O ZIP passa a ter `documents/<localId>/<nome>`; cada ficheiro tem `sha256` no manifest; a deduplicação por conteúdo de documento fica disponível (§8.4); um documento sem bytes não bloqueia e é declarado |
| **2** | **Dados partilhados:** exportar apenas dados do utilizador | Veículos partilhados entram no destino como dados próprios. Dados de terceiros **nunca** são exportados. `Household`/`Organization` não são recriados no destino. `dataClasses.shared` declara-o |
| **3** | **Export grande:** pequeno imediato, grande em segundo plano | Limiar configurável (inicial: 5 000 registos ou 25 MB), avaliado antes de recolher; estado visível; nunca um ficheiro parcial acessível; notificação quando estiver pronto |
| **4** | **Credenciais:** nunca exportar tokens, passwords ou credenciais | `Session` e `OneTimeToken` excluídos sempre. De `Integration` saem apenas `category`, `provider`, `label`, `config`, `scopes`. `dataClasses.integrationSecrets` declara a exclusão com o motivo. As integrações têm de ser reconfiguradas no destino |
| **5** | **AuditLog excluído por omissão; Notifications e SuggestionState opcionais** | `dataClasses` traz os três com `included: false`. `AuditLog` é opt-in explícito e surge como `audit.jsonl` quando pedido. Os outros dois são opcionais desmarcados |
| **6** | **Export parcial suportado, com scope explícito** | `manifest.scope` com `kind`, `vehicleLocalIds`, `from`, `to`. O âmbito é mostrado no plano de importação; a importação não tenta completar o que ficou de fora |
| **7** | **Transações: 10 000 registos, configurável; acima disso lotes com retoma** | Uma transação até 10 000. Acima, lotes atómicos com ponto de retoma persistido e estado `parcialmente aplicada` visível com contagem real. Retomar não duplica, por idempotência |
| **8** | **Reimportação nunca sobrescreve por omissão; só preenche campos vazios quando seguro** | A única escrita automática sobre um registo existente é o enriquecimento de campos vazios. Qualquer alteração exige decisão explícita do utilizador. O pior caso de uma importação errada passa a ser "apareceram dados a mais que posso apagar" em vez de "perdi o meu histórico" |
| **9** | **XLSX em fase posterior; CSV primeiro** | A v1 da camada 2 entrega CSV, que não exige dependência nova. O leitor XLSX entra depois como Parser novo, sem tocar no núcleo (§4.3) |
| **10** | **Prováveis duplicados: decisão individual ou em bloco** | O plano permite as duas. Individual para precisão, em bloco para volumes grandes — sem as duas, ou se torna inutilizável em 400 prováveis, ou apaga dados em silêncio |
| **11** | **CSV do export: vários ficheiros por tipo, consistentes com o JSONL** | O ZIP passa a ter `csv/<tipo>.csv`, um por entidade, espelhando exatamente os `.jsonl`. Mantém-se BOM UTF-8, separador `;`, vírgula decimal e neutralização de fórmulas |
| **12** | **Livro de idempotência com retenção de 12 meses** | A chave é `(userId, bundleId, localId)`. Passados 12 meses deixa de reconhecer um bundle repetido; a deduplicação por conteúdo continua a ser a rede de segurança. Retenção configurável, a rever com dados reais |

---

## 15. Fora do âmbito desta versão

Explicitamente excluído, para não haver dúvida sobre o que a v1 promete:

- **Leitura de XLSX** — fase posterior (decisão 9).
- **Adaptadores para aplicações específicas** — a arquitetura está preparada (§4.3), mas nenhum
  adaptador concreto é especificado. Cada um exige o estudo do formato de origem.
- **Exportação de dados de agregações partilhadas** — excluída por decisão 2, por envolver
  dados de terceiros.
- **Migração de credenciais de integrações** — excluída por decisão 4. Reconfiguram-se no
  destino.
- **Sincronização contínua entre contas** — a importação é um ato deliberado, não um canal
  permanente.
- **Importação para outra conta que não a autenticada** — excluída por desenho de segurança.
