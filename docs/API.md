# Zemlo — contrato da API

Referência dos endpoints consumidos pela aplicação web, pela futura app mobile e pela
integração Home Assistant. Gerada a partir de `packages/shared/src/contracts.ts`, que é
a fonte de verdade: os esquemas Zod descritos aqui são exatamente os que a API aplica.

## Convenções

| Aspeto | Convenção | Porquê |
| --- | --- | --- |
| Dinheiro | inteiro em **cêntimos**, `≥ 0` (`amountCents`) | `0.1 + 0.2 !== 0.3` em vírgula flutuante; somas de custos acumulam erro. Valores negativos são recusados: uma despesa negativa não tem significado e um único sinal menos deflaciona todos os totais (§23) |
| Datas civis | string `YYYY-MM-DD` | uma despesa "de ontem" não tem hora nem fuso horário. A data é validada **no calendário**: `2026-02-30` é recusado, não convertido em `2026-03-02` |
| Instantes | ISO 8601 UTC | criação de registos, auditoria, expiração de sessões |
| Distâncias | km (inteiro) | unidade do mercado português; conversão só na apresentação |
| Energia | kWh (decimal) | — |
| Estado de carga | percentagem `0–100` | uma só unidade: aceitar também a fração `0–1` tornaria `0.5` irrecuperavelmente ambíguo |
| Fuso horário | identificador IANA, validado | determina o que é "hoje" para o utilizador, e "hoje" alimenta datas, lembretes e alertas |
| Listas | `{ items, nextCursor, total? }` | paginação por cursor: o utilizador insere registos com datas retroativas e o `offset` faria saltar itens. `total` respeita todos os filtros |
| Erros | `{ error: { code, message, fields?, requestId } }` | um envelope único, com mensagem legível e identificador de pedido |
| Prefixo | `/api/v1` | `/health` e `/health/live` vivem **fora** do prefixo |

### Códigos de erro

| Código | HTTP | Quando |
| --- | --- | --- |
| `validation_error` | 400 / 422 | campo inválido; `fields` identifica o caminho exato |
| `unauthorized` | 401 | sem token, token expirado, credenciais erradas |
| `forbidden` | 403 | sessão válida sem permissão |
| `not_found` | 404 | recurso inexistente **ou de outra conta** (indistinguíveis por design) |
| `conflict` | 409 | matrícula duplicada, email já registado, integração repetida |
| `validation_error` | 415 | corpo enviado sem `Content-Type: application/json` |
| `rate_limited` | 429 | limitação de abuso |
| `unprocessable` | 422 | valor plausível mas que exige confirmação (ex.: recuo de quilometragem) |
| `internal_error` | 500 | defeito; `requestId` correlaciona com os logs |

Cabeçalhos úteis: `X-Request-Id` (correlação), `X-Zemlo-Api-Version`, `Retry-After`.

---

## Saúde

| Método | Caminho | Autenticação | Descrição |
| --- | --- | --- | --- |
| GET | `/api` | não | identifica o serviço e a versão |
| GET | `/health` | não | estado + latência da base de dados. **503** quando a BD não responde |
| GET | `/health/live` | não | sonda barata para o orquestrador |

---

## Conta e autenticação (§29)

| Método | Caminho | Descrição |
| --- | --- | --- |
| POST | `/auth/signup` | criar conta. Requer `acceptedTerms: true`. Devolve `{ user, tokens }` |
| POST | `/auth/login` | iniciar sessão. `totp` aceita 6 dígitos **ou** código de recuperação `XXXXX-XXXXX` |
| POST | `/auth/refresh` | renovar sessão com `refreshToken` |
| POST | `/auth/logout` | terminar a sessão atual |
| POST | `/auth/logout-all` | terminar todas as sessões |
| POST | `/auth/password-reset` | pedir link de recuperação. Resposta **idêntica** exista ou não a conta (202) |
| POST | `/auth/password-reset/confirm` | concluir a recuperação com o token do email. Revoga **todas** as sessões |
| GET | `/me` | perfil + contadores + passos de onboarding em falta |
| PATCH | `/me` | nome, fuso horário, locale, unidades |
| DELETE | `/me` | eliminar conta. Requer `confirm: "ELIMINAR"` e password (e TOTP, se ativo) |
| GET | `/me/preferences` | preferências e notificações |
| PATCH | `/me/preferences` | atualizar preferências |
| GET | `/me/sessions` | dispositivos com sessão ativa |
| DELETE | `/me/sessions/:id` | revogar um dispositivo |
| POST | `/me/password` | alterar password (revoga outras sessões por omissão) |
| POST | `/me/2fa/setup` | gerar segredo TOTP + 10 códigos de recuperação |
| POST | `/me/2fa/confirm` | ativar 2FA com um código válido |
| POST | `/me/2fa/disable` | desativar 2FA (exige password e código) |

```jsonc
// POST /auth/login
{ "email": "demo@zemlo.pt", "password": "ZemloDemo2026", "totp": "123456" }

// 200
{
  "user": { "id": "…", "email": "…", "twoFactorEnabled": false, "onboarding": { "hasVehicle": true, … } },
  "tokens": { "accessToken": "…", "expiresIn": 3600, "tokenType": "Bearer" }
}
```

---

## Veículos (§9, §10, §11)

| Método | Caminho | Descrição |
| --- | --- | --- |
| GET | `/vehicles?includeArchived=` | lista. Ordenada por atividade recente |
| POST | `/vehicles` | **só `plate` é obrigatório** |
| GET | `/vehicles/:id` | ficha completa com contadores e custo total |
| PATCH | `/vehicles/:id` | atualização parcial. `archived: true` arquiva sem apagar |
| DELETE | `/vehicles/:id` | elimina (cascata em tudo o que depende) |
| GET | `/vehicles/:id/odometer` | histórico de leituras |
| POST | `/vehicles/:id/odometer` | registar leitura |
| POST | `/odometer` | registar sem indicar veículo (usado no onboarding) |

### Progressão de quilometragem (§11)

A resposta é **422** com `error.message` explicativa quando o valor recua ou o salto é
implausível. O cliente mostra a mensagem, o utilizador confirma, e o pedido é reenviado
com `confirmRegression: true`. O registo fica marcado como correção e é excluído do
cálculo do ritmo de utilização.

```jsonc
// POST /vehicles/:id/odometer
{ "odometerKm": 42381, "recordedAt": "2026-09-16", "confirmRegression": false }

// 201
{ "odometerKm": 42381, "recordedAt": "2026-09-16", "warnings": [],
  "isCorrection": false, "deltaKm": 39, "source": { "kind": "manual", "label": "Manual" } }

// 422 — o cliente reenvia com confirmRegression: true depois de o utilizador confirmar
{ "error": { "code": "unprocessable",
             "message": "A quilometragem recuou 2 381 km face à última leitura (42 381 km). Confirmas que corrigiste o valor?",
             "requestId": "…" } }
```

---

## Registos financeiros (§12, §13, §14)

Todas as coleções existem em dois padrões equivalentes:
`/records/expenses` (com filtro opcional `?vehicleId=`) e
`/vehicles/:vehicleId/expenses` (veículo no caminho, que sobrepõe o do corpo).

| Recurso | Listar | Criar | Ler | Atualizar | Apagar |
| --- | --- | --- | --- | --- | --- |
| Despesas | `GET /records/expenses` | `POST` | `GET /records/expenses/:id` | `PATCH` | `DELETE` |
| Abastecimentos | `GET /records/fuel` | `POST` | `GET /records/fuel/:id` | `PATCH` | `DELETE` |
| Carregamentos | `GET /records/charging` | `POST` | `GET /records/charging/:id` | `PATCH` | `DELETE` |

Filtros de listagem: `limit` (1–200, omissão 50), `cursor`, `from`, `to`, `category`,
`vehicleId`.

Criar uma despesa exige apenas três campos — o resto é preenchido por omissão (§43):

```jsonc
{ "amountCents": 18450, "category": "maintenance", "date": "2026-09-16" }
```

Abastecimentos e carregamentos **devolvem as métricas derivadas já calculadas** —
incluindo no momento da criação, porque quem acabou de registar um abastecimento é
precisamente quem quer ver o consumo:

```jsonc
// POST /records/fuel
{ "vehicleId": "…", "litres": 60, "amountCents": 10200, "odometerKm": 131000 }

// 201
{ "id": "…", "litres": 60, "amountCents": 10200, "pricePerLitreCents": 170,
  "derived": { "costPerLitreCents": 170, "distanceSincePreviousKm": 1000,
               "consumptionL100Km": 6, "costPer100KmCents": 1020 } }
```

O consumo usa o método **depósito a depósito**: só é calculado entre dois abastecimentos
atestados. Um abastecimento parcial no meio torna o intervalo não fiável e o Zemlo
devolve `null` em vez de um valor errado. O mesmo princípio no carregamento elétrico.

---

## Manutenção, seguro, inspeção, impostos (§15 – §20)

| Recurso | Caminho base | Notas |
| --- | --- | --- |
| Manutenção | `/records/maintenance` | `intervalKm`/`intervalMonths` criam automaticamente o lembrete seguinte (§16) |
| Seguro | `/records/insurance` | `endDate` cria automaticamente o alerta de renovação (§18) |
| Inspeção | `/records/inspections` | sem `nextDueDate`, assume um ano (§19) |
| Impostos | `/records/taxes` | `paid: false` com `dueDate` gera lembrete (§20) |

Todos exigem `vehicleId` **explícito** quando a conta tem mais de um veículo. Sem ele, o
registo é associado ao veículo mais recentemente atualizado.

---

## Documentos (§17)

| Método | Caminho | Descrição |
| --- | --- | --- |
| GET | `/documents?vehicleId=&limit=&cursor=` | lista (inclui documentos sem veículo) |
| GET | `/documents/expiring?withinDays=60` | a expirar, para o cartão de estado |
| POST | `/documents` | metadados + `storageKey`. **Os bytes não passam pela API** |
| GET/PATCH/DELETE | `/documents/:id` | — |

A API guarda metadados e uma referência opaca ao ficheiro; servir bytes exigiria
reimplementar um servidor de ficheiros (intervalos, retoma, cache) que o armazenamento
de objetos já faz melhor.

---

## Lembretes (§16, §21, §22)

| Método | Caminho | Descrição |
| --- | --- | --- |
| GET | `/reminders?vehicleId=&state=&includeCompleted=` | lista avaliada + contagens por estado |
| POST | `/reminders` | criar. Aceita `intervalKm`/`intervalMonths` em alternativa a datas |
| GET/PATCH/DELETE | `/reminders/:id` | — |
| POST | `/reminders/:id/complete` | concluir. Devolve `{ completed, next }` quando `repeat` |
| POST | `/reminders/:id/snooze` | `{ days }` — adiar a partir de hoje |

O **estado nunca é guardado**: é calculado a cada pedido a partir de hoje e da
quilometragem atual. `trigger` é `distance`, `time` ou `both`; com `both`, o evento
ocorre quando qualquer condição for atingida.

```jsonc
// 201
{ "id": "…", "title": "Revisão dos 50 000 km", "trigger": "both",
  "dueOdometerKm": 50000, "dueDate": "2027-06-01", "repeat": true,
  "evaluation": { "state": "soon", "daysRemaining": 258, "kmRemaining": 7619,
                  "drivingCondition": "distance", "projectedDate": null,
                  "summary": "em 7 619 km · em 258 dias" } }
```

Concluir com `repeat: true` cria a ocorrência seguinte contada **a partir da data de
conclusão** — uma revisão anual feita oito meses atrasada não deve nascer já em atraso.

---

## Dashboard, estatísticas, timeline, calendário (§8, §21, §23, §24)

| Método | Caminho | Descrição |
| --- | --- | --- |
| GET | `/dashboard?vehicleId=` | veículo em foco, cartões de estado, resumo financeiro, sugestões, próximos, lacunas de dados |
| GET | `/stats?vehicleId=&year=&months=` | totais, distância, custos unitários, consumos, série mensal, comparação, avançadas |
| GET | `/timeline?vehicleId=&limit=&cursor=&kinds=&from=&to=` | timeline paginada por cursor |
| GET | `/calendar?from=&to=&vehicleId=` | entradas + resumo por dia |
| GET | `/metrics` | contadores da conta, para o ecrã de estado dos dados |

Sem `vehicleId`, o dashboard foca o veículo mais recentemente atualizado e as
estatísticas agregam a conta inteira.

```jsonc
// GET /dashboard
{
  "vehicle": { "id": "…", "title": "Kia EV3", "plateDisplay": "42-38-EL",
               "odometerKm": 43560, "emoji": "🚙" },
  "vehicles": [ … ],
  "status": [
    { "key": "next_service", "label": "Revisão dos 50 000 km", "value": "1 440 km",
      "hint": "em 1 440 km · em 258 dias", "state": "soon", "icon": "🔧", "href": "…" },
    { "key": "insurance", "label": "Seguro", "value": "63 dias", "hint": "Fidelidade",
      "state": "ok", "icon": "🛡️", "href": "…" },
    { "key": "inspection", "label": "Inspeção", "value": "142 dias", "hint": "2027-02-05",
      "state": "ok", "icon": "📋", "href": "…" }
  ],
  "finance": { "year": 2026, "yearTotalCents": 229190, "monthTotalCents": 32040,
               "monthAverageCents": 25465, "previousYearSamePeriodCents": 198450,
               "byCategory": [ { "category": "fuel", "label": "Combustível",
                                 "icon": "⛽", "amountCents": 132_600, "share": 0.58, "count": 13 } ],
               "monthly": [ { "month": "2026-01", "label": "jan 26",
                              "amountCents": 18450, "energyCents": 10200 } ] },
  "usage": { "odometerKm": 43560, "kmThisYear": 1890, "costPerKmCents": 33,
             "kmPerMonth": 210, "fuelConsumptionL100Km": null,
             "energyConsumptionKwh100Km": 15.56 },
  "suggestions": [ { "id": "account.enable_2fa", "type": "account.enable_2fa",
                     "title": "Protege a tua conta",
                     "body": "…", "actionLabel": "Ativar verificação em dois passos",
                     "actionHref": "/settings/security",
                     "dismissibleForever": false, "priority": 80 } ],
  "upcoming": [ /* TimelineItem[] */ ],
  "counts": { "vehicles": 2, "recordsThisYear": 14, "documents": 6 },
  "dataGaps": [ { "key": "insurance", "title": "Seguro",
                  "message": "Falta apenas o seguro deste veículo…", "href": "/vehicles/…?sheet=insurance" } ]
}
```

`state` de um cartão ou lembrete: `ok` | `soon` | `due` | `overdue` | `unknown`.

---

## Sugestões (§7)

| Método | Caminho | Descrição |
| --- | --- | --- |
| POST | `/suggestions/:key` | `{ action: "done" \| "dismiss" \| "snooze" \| "never", snoozeDays? }` |

A `key` é estável (`tipo` ou `tipo:vehicleId`) e vem no campo `id` da sugestão. As
sugestões **não** são semeadas na base de dados: são geradas a pedido a partir do estado
real do veículo, pelo que desaparecem no instante em que deixam de fazer sentido.

---

## Notificações (§22)

| Método | Caminho | Descrição |
| --- | --- | --- |
| GET | `/notifications?unreadOnly=&limit=&cursor=` | lista + `unreadCount` |
| POST | `/notifications/read` | `{ ids: [] }` ou `{ all: true }` |
| DELETE | `/notifications/:id` | — |

As notificações são materializadas de forma idempotente (chave `dedupeKey`) durante os
pedidos ao dashboard. Não há canais push nem email implementados: exigem,
respetivamente, uma app mobile publicada e um servidor SMTP configurado.

---

## Integrações e Home Assistant (§26 – §28)

| Método | Caminho | Descrição |
| --- | --- | --- |
| GET | `/integrations` | lista. Credenciais **nunca** são devolvidas |
| POST | `/integrations` | criar. `credentials` cifrados em repouso (exige `ENCRYPTION_KEY`) |
| PATCH/DELETE | `/integrations/:id` | — |
| GET | `/integrations/home-assistant/spec?vehicleId=` | entidades, requisitos e disponibilidade |

```jsonc
// GET /integrations/home-assistant/spec
{
  "discoveryVersion": 1,
  "discoveryPrefix": "homeassistant",
  "stateTopic": "zemlo/car/state",
  "entities": [
    { "entityId": "sensor.zemlo_car_odometer", "name": "Quilometragem",
      "component": "sensor", "deviceClass": "distance", "unitOfMeasurement": "km",
      "stateClass": "total_increasing",
      "requires": "Quilometragem registada no Zemlo.", "available": true },
    { "entityId": "binary_sensor.zemlo_car_charging", "name": "A carregar",
      "component": "binary_sensor", "deviceClass": "battery_charging",
      "unitOfMeasurement": null, "stateClass": null,
      "requires": "Exige telemetria em tempo real do veículo ou da wallbox. Com registos manuais o Zemlo não sabe se o carro está a carregar neste momento — e não o vai adivinhar.",
      "available": false }
  ],
  "instructions": [
    "No Zemlo: Definições → Integrações → Home Assistant, e copia o token de acesso.",
    "No Home Assistant: Definições → Dispositivos e serviços → Adicionar integração → Zemlo.",
    "Cola o token, escolhe o veículo e termina. Não precisas de configurar MQTT, OAuth nem webhooks à mão."
  ]
}
```

### Entidades e o que as torna disponíveis

| Entidade | Disponível quando |
| --- | --- |
| `sensor.zemlo_car_odometer` | Existe quilometragem registada |
| `sensor.zemlo_car_consumption` | Dois abastecimentos com depósito cheio e odómetro |
| `sensor.zemlo_car_energy_consumption` | Dois carregamentos com odómetro |
| `sensor.zemlo_car_cost_per_km` | Despesas registadas e distância calculável |
| `sensor.zemlo_car_next_service` | Existe um lembrete de manutenção ativo |
| `sensor.zemlo_car_inspection` | Inspeção registada com próxima data |
| `sensor.zemlo_car_insurance` | Apólice registada |
| `sensor.zemlo_car_battery` | Estado de carga final registado num carregamento |
| `sensor.zemlo_car_range` | Estado de carga **e** autonomia homologada na ficha |
| `binary_sensor.zemlo_car_charging` | **Nunca**, sem telemetria em tempo real |
| `device_tracker.zemlo_car` | **Nunca**, sem recolha de localização |

As entidades indisponíveis são devolvidas **na mesma**, cada uma com o requisito que lhe
falta, em vez de omitidas: o utilizador percebe o que o Zemlo faria com esses dados e o
que falta para os ter, em vez de concluir que a integração está incompleta (§6, §27). O
Zemlo **nunca** publica uma entidade com um valor estimado apresentado como medido (§48).

---

## Exportação (§54)

| Método | Caminho | Descrição |
| --- | --- | --- |
| GET | `/export?format=json\|csv&vehicleId=&from=&to=` | `Content-Disposition: attachment` |

- **JSON**: cópia fiel e completa, com `meta.formatVersion` para reimportação futura.
  Dinheiro em cêntimos, datas civis em `YYYY-MM-DD`.
- **CSV**: uma secção por tipo de registo, separador `;`, vírgula decimal, BOM UTF-8
  (sem ele o Excel em português corrompe acentos) e proteção contra injeção de fórmulas.

A exportação é registada em auditoria e nunca inclui `passwordHash`, `twoFactorSecret`
nem credenciais de integrações.
