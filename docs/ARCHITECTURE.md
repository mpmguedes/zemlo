# Arquitetura do Zemlo

Como o sistema está construído, onde vivem as responsabilidades, e onde estão os pontos
de extensão. Para o **porquê** das decisões, ver `docs/DECISIONS.md`; para o contrato, ver
`docs/API.md`.

---

## 1. Visão geral

```text
┌─────────────────────────────────────────────────────────────────────────┐
│  Clientes                                                               │
│                                                                         │
│   apps/web (React + Vite)      futura app mobile (Flutter)              │
│   Home Assistant               integrações de terceiros                 │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │  REST /api/v1  ·  Bearer JWT
┌───────────────────────────────▼─────────────────────────────────────────┐
│  apps/api (Node 22 + Express + TypeScript)                              │
│                                                                         │
│   http/          fronteira: middlewares, validação Zod, rotas           │
│   services/      casos de uso: orquestração, base de dados, auditoria   │
│   domain/        lógica pura: cálculos, datas, lembretes, timeline      │
│   core/          infraestrutura: config, erros, logs, cifragem, Prisma  │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │  Prisma
┌───────────────────────────────▼─────────────────────────────────────────┐
│  PostgreSQL (produção)  ·  SQLite (desenvolvimento e testes)            │
└─────────────────────────────────────────────────────────────────────────┘
                                ▲
                                │  tipos, esquemas Zod, registo de domínio
┌───────────────────────────────┴─────────────────────────────────────────┐
│  packages/shared — o contrato, uma única vez                            │
└─────────────────────────────────────────────────────────────────────────┘
```

**O princípio estruturante:** existe **um** contrato, em `packages/shared`. Os esquemas
Zod que a API aplica são literalmente os mesmos objetos de que o frontend infere os seus
tipos. Não há uma segunda definição de "despesa" que possa divergir da primeira.

---

## 2. As quatro camadas da API

A regra de dependências é unidirecional: `http → services → domain`, com `core`
transversal. `domain` **nunca** importa `services` nem `http`; é lógica pura e pode ser
testada sem base de dados.

### `core/` — infraestrutura

| Ficheiro | Responsabilidade |
| --- | --- |
| `config.ts` | Lê e **valida** o ambiente no arranque. Falha no arranque, não em produção |
| `errors.ts` | `AppError` e construtores (`notFound`, `conflict`, `unprocessable`, …) |
| `logger.ts` | Registo estruturado JSON, com redação de dados pessoais e segredos |
| `crypto.ts` | bcrypt, tokens opacos, AES-256-GCM, TOTP (RFC 6238) |
| `db.ts` | Cliente Prisma e verificação de saúde |
| `json.ts` | **Único** ponto de conversão de colunas JSON↔texto entre PostgreSQL e SQLite |

### `domain/` — lógica pura

Sem base de dados, sem HTTP, sem efeitos. É aqui que os números do produto são decididos.

| Ficheiro | Responsabilidade |
| --- | --- |
| `calculations.ts` | Consumo de combustível e energia, preços derivados |
| `odometer.ts` | Validação de progressão, ritmo de utilização, projeção de datas |
| `reminders.ts` | Avaliação de lembretes, próxima ocorrência, resumo em português |
| `analysis.ts` | Agregações: totais por categoria, série mensal, custos unitários, TCO |
| `timeline.ts` | Construção, fusão, filtragem e paginação da timeline |
| `payload.ts` | Mapeadores modelo→API. **É a fronteira de segurança do contrato** |

Convenção de `payload.ts`: um campo novo na base de dados só aparece na API se for
explicitamente mapeado ali. É por isso que `passwordHash`, `twoFactorSecret` e
`credentials` não podem escapar por esquecimento.

### `services/` — casos de uso

Orquestram `domain` e a base de dados, aplicam autorização e escrevem auditoria e eventos.

| Ficheiro | Responsabilidade |
| --- | --- |
| `auth.ts` | Registo, sessões, 2FA, perfil, eliminação de conta |
| `tokens.ts` | Assinatura e validação de JWT |
| `vehicles.ts` | CRUD, quilometragem, ritmo, normalização de origem |
| `records-financial.ts` | Despesas, abastecimentos, carregamentos |
| `records-compliance.ts` | Manutenção, seguro, inspeção, impostos |
| `documents.ts` | Documentos e validades |
| `reminders.ts` | Ciclo de vida dos lembretes |
| `analytics.ts` | Carregamento agregado + dashboard, estatísticas, calendário |
| `timeline.ts` | Leitura da timeline |
| `suggestions.ts` | Geração de sugestões contextuais e decisões do utilizador |
| `notifications.ts` | Preferências e materialização idempotente |
| `events.ts` | Escrita do modelo de eventos |
| `audit.ts` | Registo de ações sensíveis |
| `export.ts` | Exportação JSON e CSV |
| `shared.ts` | Paginação, acesso a registos, despesas associadas |

`records-*` está dividido por domínio de negócio, não por tipo de modelo: os registos
financeiros partilham o fluxo "criar → derivar métricas → atualizar quilometragem →
escrever evento → criar despesa", e os de conformidade partilham o fluxo "criar → gerar
lembrete".

### `http/` — fronteira

| Ficheiro | Responsabilidade |
| --- | --- |
| `middleware.ts` | Contexto, segurança, CORS, limitação de abuso, autenticação, erros |
| `handlers.ts` | `asyncHandler` e validadores tipados sobre Zod |
| `routes/*.ts` | Um ficheiro por área funcional |

Os handlers são finos de propósito: validam, chamam um serviço, respondem. Toda a
validação passa por `parseBody`/`parseQuery`, que devolvem valores **tipados** em vez de
escreverem em `request.body` — assim um handler não pode confiar cegamente no pedido nem
precisa de `as`.

---

## 3. Modelo de dados

27 tabelas, agrupadas por propósito. O schema canónico é
`apps/api/prisma/schema.prisma` (PostgreSQL); a variante SQLite é gerada.

```
User ─┬─ UserPreference            (1:1)
      ├─ NotificationPreference    (1:N, por tópico × canal)
      ├─ Session                   (1:N, refresh tokens como hash)
      ├─ OneTimeToken              (1:N, verificação e reposição)
      ├─ SuggestionState           (1:N, decisões sobre sugestões geradas)
      ├─ AuditLog                  (1:N, ações sensíveis)
      ├─ HouseholdMember           (1:N)  ┐ preparado para família/frota,
      ├─ OrganizationMember        (1:N)  ┘ não exposto na API
      └─ Vehicle ─┬─ OdometerReading      (1:N, histórico de leituras)
                  ├─ Expense              (1:N)
                  ├─ FuelSession          (1:N) ─ expenseId → Expense
                  ├─ ChargingSession      (1:N) ─ expenseId → Expense
                  ├─ MaintenanceRecord    (1:N) ─ reminderId → Reminder
                  ├─ InsurancePolicy      (1:N) ─ reminderId → Reminder
                  ├─ InspectionRecord     (1:N) ─ reminderId → Reminder
                  ├─ TaxRecord            (1:N) ─ reminderId → Reminder
                  ├─ Document             (1:N, opcional — há documentos sem veículo)
                  ├─ Reminder             (1:N)
                  ├─ VehicleEvent         (1:N)  ← base da timeline
                  ├─ Integration          (1:N)
                  └─ HomeAssistantEntity  (via Integration)

Notification                     (1:N com User, chave única userId+dedupeKey)
AppSetting                       (chave/valor operacional)
Household / Organization         (preparação, não expostos)
```

### Índices que existem por uma razão

- `Vehicle @@unique([userId, plate])` — impede matrículas duplicadas **por conta**, não
  globalmente (duas pessoas podem ter o mesmo carro? não; mas duas contas podem registar
  o mesmo veículo alugado).
- `OdometerReading @@index([vehicleId, recordedAt])` e `@@index([vehicleId, odometerKm])` —
  as duas ordenações usadas pelo cálculo de distância e de ritmo.
- `VehicleEvent @@index([vehicleId, date])` — a timeline é uma leitura ordenada por data.
- `Reminder @@unique([vehicleId, dedupeKey])` — idempotência: criar duas vezes o lembrete
  da mesma manutenção não duplica nada.
- `Notification @@unique([userId, dedupeKey])` — idempotência da materialização.

---

## 4. Autenticação e autorização

### Tokens

- **Access token** — JWT HS256, 60 minutos, **não** guardado no servidor. Contém `sub`
  (utilizador), `email` e `sid` (sessão).
- **Refresh token** — 256 bits opacos, 90 dias, guardado apenas como SHA-256 em `Session`.

Porquê dois mecanismos: o JWT evita uma consulta à base de dados em cada pedido; o token
opaco permite **revogação**. O Zemlo é mobile-first e precisa de sessões longas (§3.6), e
uma sessão longa que não pode ser revogada é um risco inaceitável no dispositivo perdido
(§30).

O `authenticateAccessToken` valida a **sessão**, não apenas a assinatura: um token
assinado cuja sessão foi revogada é recusado. É isso que torna a revogação eficaz.

### Autorização

Uma única regra, aplicada em todos os serviços: **o filtro por `userId` é feito na
consulta**, nunca depois de carregar o registo. Um identificador de outra conta é
indistinguível de um identificador inexistente — tanto na resposta como no tempo de
execução. Não existe um papel de administrador no MVP.

### 2FA

TOTP (RFC 6238, SHA-1, 30 s, 6 dígitos) mais 10 códigos de recuperação de uso único. O
segredo é cifrado com AES-256-GCM em repouso; os códigos de recuperação são guardados
apenas como hash. Aceita-se uma janela de ±1 passo, porque relógios de telemóveis desviam-se
alguns segundos.

---

## 5. Modelo de eventos e timeline

Toda a ação importante escreve em `VehicleEvent` (§33). A timeline lê essa tabela e, em
paralelo, `buildRecordTimeline` gera itens a partir dos próprios registos para os casos em
que não existe evento (dados importados, migrações). `mergeTimeline` deduplica por
`tipo:id`, com precedência para o evento real.

Detalhe de robustez: uma falha ao escrever o evento **não** reverte o registo. Perder a
despesa que o utilizador acabou de escrever é irreparável; perder uma linha de histórico é
recuperável, e `buildRecordTimeline` cobre a lacuna.

---

## 6. Dashboard, estatísticas e agregações

`loadVehicleAnalytics` carrega **uma vez** os dados de um veículo (despesas,
abastecimentos, carregamentos, leituras de odómetro) e alimenta o dashboard, as
estatísticas, o calendário e a lista de sugestões.

Porquê um carregamento partilhado: se cada endpoint fizesse as suas próprias consultas,
o dashboard e o ecrã de estatísticas mostrariam números ligeiramente diferentes para o
mesmo veículo — a forma mais rápida de perder a confiança do utilizador num produto de
números.

Os consumos **não** podem ser calculados por SQL: o consumo de um depósito depende do
depósito anterior, pelo que é necessária a série cronológica completa. Esta é a razão da
janela de 5 000 registos por veículo. Se um dia for insuficiente, a solução é materializar
o consumo no momento da gravação, num campo próprio.

---

## 7. Frontend

`apps/web` consome a mesma API que a futura app mobile (§34). Não há lógica de negócio
duplicada: formatação de dinheiro, datas, unidades, categorias e ícones vêm todos de
`@zemlo/shared`.

Separação de responsabilidades:
- **Estado do servidor** — React Query, com chaves de consulta por recurso.
- **Estado de sessão** — contexto próprio; token de acesso em memória + `sessionStorage`,
  refresh token em `localStorage` (compromisso documentado no cliente).
- **Estado de interface** — local aos componentes. Não há estado global de apresentação.

### Duas topologias de execução

| Modo | Frontend | API | Como |
| --- | --- | --- | --- |
| Desenvolvimento | Servidor do Vite em `:5173`, com proxy `/api` → `:4000` | `:4000` | `npm run dev:api` + `npm run dev:web` |
| Produção | Servida **pela própria API** a partir de `apps/web/dist` | `:4000` | `npm run build && npm run start:api` |

Em produção a API serve os ficheiros estáticos e devolve o `index.html` para qualquer rota
que não seja da API, o que faz um URL profundo como `/vehicles/abc` funcionar num
recarregamento direto do browser. As rotas sob `/api/` ficam de fora desse fallback: um
endpoint inexistente tem de devolver o 404 em JSON da API, e não uma página HTML.

A montagem é condicional: se `apps/web/dist` não existir, a API arranca normalmente sem
servir frontend. É o que permite correr a API sozinha — nos testes, na verificação
ponta a ponta e num serviço sem interface.

---

## 8. Pontos de extensão

Previstos para não obrigarem a reconstrução estrutural (§65):

| Extensão | Onde se liga |
| --- | --- |
| Fabricante de veículos (API oficial) | `Integration` + `normalizeSource` + `Vehicle.odometerSource` |
| OBD | idem, com `source.kind = 'obd'` |
| Wallbox | cria `ChargingSession` e `OdometerReading` com origem própria |
| Home Assistant | `HomeAssistantEntity` + `GET /integrations/home-assistant/spec` |
| Importação CSV/Excel (§25) | cria registos através dos mesmos serviços, com `source.kind = 'import'` |
| Automações | consomem `VehicleEvent` |
| IA (§48) | lê `loadVehicleAnalytics` e os eventos; nunca inventa dados |
| Família e frotas (§32) | `Household`, `HouseholdMember`, `Organization`, `OrganizationMember` já existem |
| Trabalho agendado | `syncNotifications` já é idempotente e pode correr em lote |
| App mobile (§3.6) | a mesma API, os mesmos contratos de `@zemlo/shared` |

---

## 9. Ambientes (§37)

| Ambiente | Base de dados | Segredos | Notas |
| --- | --- | --- | --- |
| `development` | SQLite (ficheiro) | valores de desenvolvimento | Tudo corre sem infraestrutura |
| `test` | SQLite em memória ou ficheiro | derivados | `bcrypt` com custo reduzido para ser rápido |
| `staging` | PostgreSQL | gestor de segredos | Espelho de produção; nunca dados reais |
| `production` | PostgreSQL | gestor de segredos | `JWT_SECRET` de desenvolvimento **recusado** |

A configuração é validada no arranque (`core/config.ts`). Um valor em falta ou mal formado
que só se manifestasse quando o primeiro utilizador faz login seria um defeito de operação,
não um caso de erro de negócio.

---

## 10. Observabilidade (§56)

- **Logs** — JSON estruturado, com `requestId` em cada pedido e o resultado
  (método, caminho, estado, duração, utilizador). Em desenvolvimento, formato legível.
- **Redação** — `logger.ts` remove segredos e mascara dados pessoais (email, matrícula,
  IP) de qualquer objeto registado. Um log de diagnóstico não pode transformar-se numa
  fuga de dados (§31).
- **Saúde** — `GET /health` devolve 503 quando a base de dados não responde, para que o
  balanceador retire a instância de rotação.
- **Auditoria** — `AuditLog` para ações sensíveis: alterações de password e 2FA, sessões,
  exportações, eliminação de conta, integrações.
- **Métricas** — `GET /metrics` devolve os contadores da conta autenticada.

O que **não** existe: recolha de telemetria de terceiros, rastreio de utilizadores, nem
envio de dados para fora da infraestrutura do projeto. A privacidade é uma característica
do produto (§31), não uma configuração.

---

## 11. Segurança — superfície resumida

| Vetor | Mitigação |
| --- | --- |
| Força bruta em passwords | bcrypt custo 12; bloqueio progressivo após 8 tentativas; limitação por IP+email |
| Reutilização de tokens roubados | Access token curto; revogação por sessão; validação da sessão em cada pedido |
| Acesso a dados de outra conta | Filtro por `userId` na consulta; 404 indistinguível de inexistente |
| Descrição de contas | Mensagem idêntica para email inexistente e password errada |
| Segredos em cópias de base de dados | Segredos cifrados (AES-256-GCM); códigos de recuperação como hash |
| Injeção de fórmulas na exportação | Prefixo de apóstrofo em células que comecem por `= + - @` |
| Abuso da API | Limitação global e específica de autenticação |
| Upload de corpo excessivo | Limite de 1 MB; documentos referenciados, não transportados |
| Cache intermédia a servir dados de outro | `Cache-Control: no-store` em todas as respostas autenticadas |
| Fuga de detalhes internos | Erros internos devolvem mensagem genérica; stack traces ficam no servidor |
| Rotação de `ENCRYPTION_KEY` | Prefixo `v1.` no texto cifrado permite rotação sem migração destrutiva |
