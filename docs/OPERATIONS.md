# Zemlo — operação

Como colocar o Zemlo em produção, como o manter, e o que fazer quando algo corre mal.
Complementa `docs/ARCHITECTURE.md` (como o sistema está construído) e
`docs/DECISIONS.md` (porque foi decidido assim).

O alvo descrito na especificação é infraestrutura própria — Proxmox, container dedicado,
Cloudflare e Cloudflare Tunnel (§36). Este documento assume isso, mas qualquer ambiente com
Node 22 e PostgreSQL chega.

---

## 1. O que é preciso

| Componente | Versão | Notas |
| --- | --- | --- |
| Node.js | ≥ 22.11 | Usa `tsx`, `fetch` nativo e as APIs modernas de `node:crypto` |
| PostgreSQL | ≥ 14 | A produção usa o schema canónico. SQLite é só para desenvolvimento |
| Cloudflare Tunnel | — | Expõe a API sem abrir portas no router |
| Gestor de segredos | — | As variáveis de `apps/api/.env` em produção vêm daqui, não de um ficheiro |

Não é preciso Docker, Redis, fila de mensagens nem serviço de email para o MVP.

---

## 2. Ambientes (§37)

Três ambientes, nunca desenvolvimento sobre produção.

| Ambiente | `NODE_ENV` | Base de dados | Domínio |
| --- | --- | --- | --- |
| Desenvolvimento | `development` | SQLite local | `127.0.0.1:5173` + `127.0.0.1:4000` |
| Staging | `staging` | PostgreSQL dedicado | `staging.appzemlo.com` |
| Produção | `production` | PostgreSQL dedicado | `appzemlo.com` |

Staging existe para que a migração seja ensaiada antes de tocar em dados reais. Nunca deve
conter cópias de dados de produção com dados pessoais (§31).

---

## 3. Instalação em produção

### 3.1. Obter o código e as dependências

```bash
git clone <repositório> /opt/zemlo && cd /opt/zemlo
npm ci                                     # instalação reprodutível a partir do lockfile
npm install-scripts approve prisma @prisma/engines @prisma/client esbuild
```

O npm 12 bloqueia scripts de instalação por omissão. O Prisma precisa do seu para gerar os
motores, e o esbuild para o binário nativo — sem esta aprovação, `npm run build` falha de
forma pouco óbvia.

### 3.2. Segredos

Gerar valores novos, nunca reutilizar os de desenvolvimento:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"      # ENCRYPTION_KEY
```

O arranque **recusa** iniciar em produção com um `JWT_SECRET` em falta, demasiado curto, ou
com o prefixo `dev-only-` dos ficheiros de desenvolvimento. Uma validação que não é
executada é indistinguível de uma validação ausente — ver `docs/DECISIONS.md` A19.

### 3.2.1. Cliente Prisma — gerado, com dois motores separados

O cliente Prisma **não é versionado**: é gerado a partir dos schemas por
`npm run db:generate`, que corre automaticamente no `postinstall` do `npm ci`. Não é
preciso nenhum passo manual, e não é preciso conhecer nenhuma ordem.

Os dois motores têm clientes **com saídas distintas**:

| Motor | Schema | Cliente gerado | Pacote |
| --- | --- | --- | --- |
| PostgreSQL (produção) | `prisma/schema.prisma` | `prisma/generated/postgres` | `@zemlo/prisma-postgres` |
| SQLite (desenvolvimento) | `prisma/sqlite/schema.sqlite.prisma` | `prisma/generated/sqlite` | `@zemlo/prisma-sqlite` |

```bash
npm run db:generate            # regenera o schema SQLite e os DOIS clientes
npm run db:generate:pg         # só o cliente PostgreSQL
npm run db:generate:sqlite     # só o schema e o cliente SQLite
```

**Porque é que isto importa.** Na primeira versão os dois schemas geravam para o **mesmo**
caminho (`node_modules/.prisma/client`) e como `db:generate` corria o SQLite por último, o
cliente SQLite substituía o de PostgreSQL — sempre e em silêncio. Uma instalação com
`DATABASE_URL` a apontar para PostgreSQL arrancava, respondia 200, escrevia num ficheiro
`dev.db` local, e o `/health` anunciava `postgresql`. Só se descobria pela ausência de
dados. Com saídas distintas a colisão deixou de ser possível, e o arranque verifica três
coisas, recusando iniciar se alguma falhar:

1. o cliente importado é o do motor correto;
2. o cliente presente em `prisma/generated/<motor>` foi compilado para esse motor
   (lido do `schema.prisma` que acompanha cada cliente gerado — não é uma afirmação);
3. `DATABASE_PROVIDER` coincide com o motor do cliente carregado.

Adicionalmente, um cliente SQLite com `NODE_ENV=production` é recusado de forma
incondicional.

### 3.3. Base de dados

A migração inicial já existe no repositório (`prisma/migrations/0_init`), criada com
`prisma migrate diff` — o que significa que foi revista antes de ser aplicada, em vez de
gerada automaticamente contra uma base de dados em desenvolvimento.

```bash
export DATABASE_URL='postgresql://zemlo:…@127.0.0.1:5432/zemlo?schema=public'
export DATABASE_PROVIDER=postgresql

npm run db:deploy:pg     # prisma migrate deploy contra o schema canónico
```

`DATABASE_PROVIDER` tem de estar definido **antes** de o processo arrancar: é esta variável
que seleciona qual dos dois clientes gerados é instanciado. Definir apenas `DATABASE_URL`
não chega, e o arranque recusa se os dois não coincidirem.

`migrate deploy` aplica apenas as migrações registadas em `prisma/migrations`. **Nunca**
correr `migrate dev` ou `db push` contra produção: o primeiro pode propor alterações
destrutivas, o segundo altera o schema sem deixar registo do que mudou.

O projeto mantém **duas** séries de migrações, uma por motor:

| Motor | Migrações | Schema |
| --- | --- | --- |
| PostgreSQL (produção) | `prisma/migrations/` | `prisma/schema.prisma` (canónico) |
| SQLite (desenvolvimento) | `prisma/sqlite/migrations/` | `prisma/sqlite/schema.sqlite.prisma` (gerado) |

Em desenvolvimento, `npm run db:push` continua a ser o caminho mais rápido: aplica o schema
diretamente, sem migração. `npm run db:deploy` existe para validar que a série de migrações
produz o mesmo resultado — que foi verificado numa base de dados vazia: 27 tabelas, sem
referências órfãs.

### 3.4. Compilar e arrancar

```bash
npm run build      # pacote partilhado → API → aplicação web
npm run start:api  # a API serve também a aplicação web compilada
```

`npm run build` corre `db:generate` antes de compilar a API (script `prebuild`), pelo que é
impossível compilar contra um cliente Prisma desatualizado.

Com `apps/web/dist` presente, a API serve os ficheiros estáticos e devolve o `index.html`
para rotas que não sejam da API. O sistema inteiro é **um** serviço, um domínio e um
certificado — sem CORS e sem uma segunda política de cabeçalhos.

**Verificação depois do primeiro arranque.** O log de arranque regista o motor em uso:

```
INFO  Motor de base de dados: postgresql
INFO  Base de dados a responder em 12 ms
```

E o `/health` reporta o motor do cliente **realmente carregado** — não o valor de
`DATABASE_PROVIDER`, que é precisamente a parte que pode estar errada:

```bash
curl -s http://127.0.0.1:4000/health | grep -o '"provider":"[a-z]*"'
# tem de dizer: "provider":"postgresql"
```

Se a instalação estiver a escrever em SQLite, o processo não arranca — é preferível a servir
dados de um ficheiro que ninguém vai salvaguardar. Confirmar também que
`apps/api/prisma/sqlite/dev.db` **não** existe na máquina de produção: se existir depois de
criar dados, alguma coisa está errada.

### 3.4.1. Recuperação de password e entrega de email

A recuperação de password está implementada (`POST /auth/password-reset` e
`POST /auth/password-reset/confirm`), com tokens de uso único, expiração de 60 minutos e
hash SHA-256 em repouso. Ao concluir, **todas** as sessões da conta são revogadas.

A entrega do link está implementada: `registerEmailSender()`
(`apps/api/src/services/email.ts`) é chamada no arranque, **antes** de a porta abrir, e escolhe
o transporte a partir da configuração. Ligar um servidor de correio é, por isso, uma questão de
**configuração** — não de código.

#### Variáveis

| Variável                   | Obrigatória                        | Notas                                                                                       |
| -------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `SMTP_HOST`                | para entrega real                  | Sem ela a entrega fica inativa (ver abaixo)                                                 |
| `SMTP_PORT`                | não                                | Por omissão `587`. **`465` implica TLS implícito**; `587` e `25` negociam `STARTTLS`        |
| `SMTP_USER` / `SMTP_PASSWORD` | se o servidor exigir autenticação | Enviadas por `AUTH LOGIN`                                                                    |
| `SMTP_FROM`                | não                                | Por omissão `Zemlo <ola@appzemlo.com>`. Aceita nome de apresentação — o envelope leva só o endereço (A30) |

A configuração é **validada no arranque**: um `SMTP_FROM` de que não saia um endereço
utilizável, um `SMTP_USER` que não seja um endereço, ou um `HOSTNAME` com mudança de linha
fazem a API falhar antes de escutar, em vez de falharem no primeiro email enviado (A30).

#### Sem `SMTP_HOST`: entrega inativa

Sem `SMTP_HOST`, o link é escrito no log e **não** chega a ninguém:

```
INFO  Email não enviado — entrega por configurar; conteúdo registado
      {"to":"…","subject":"Zemlo — reposição da tua password","text":"…/repor-password?token=[redigido]"}
```

O parâmetro `token` do url é substituído por `[redigido]` antes de a mensagem entrar no logger.
O log continua a mostrar *que* o email foi composto e para que página aponta — o que deixa de
ser possível é usar o link a partir dele.

Em desenvolvimento é este o comportamento pretendido. **Em produção, a API recusa arrancar**
sem entrega: um servidor que aceitasse pedidos deixaria o utilizador sem receber nada e a única
cópia da ligação de recuperação num log. Quem quiser mesmo arrancar sem entrega tem de o dizer
explicitamente:

```ini
EMAIL_ALLOW_LOG_TRANSPORT=true
```

Com esta variável o arranque passa, mas fica registado um aviso de que os links de recuperação
ficam no log e não chegam aos utilizadores. Só o valor exato `true` é aceite — `1` ou `yes`
continuam a recusar. Qualquer alteração a credenciais, servidor ou portas de produção é uma
alteração de **configuração**, com autorização própria; não é preciso tocar em código.

### 3.4.2. Entrada com Google (`AUTH-002`)

Sem configuração, a instalação arranca normalmente e os dois endpoints respondem `503` com uma
mensagem que diz o que falta. Não é preciso configurar nada para não usar esta funcionalidade.

```ini
GOOGLE_CLIENT_ID=…              # da consola da Google
GOOGLE_CLIENT_SECRET=…          # o par: as duas ou nenhuma
GOOGLE_REDIRECT_URI=…           # opcional; por omissão PUBLIC_BASE_URL + /api/v1/auth/google/callback
GOOGLE_ISSUER=https://accounts.google.com   # opcional; só o emissor, sem caminho nem barra final
```

**As duas primeiras são um par.** Com uma só, a API **recusa arrancar** — e é de propósito:
com metade das credenciais o botão passa a ter destino na interface e o fluxo falha sempre, no
fim, depois de o utilizador já ter escolhido a conta Google. Falhar no arranque diz o mesmo
mais cedo e mais barato.

**O `GOOGLE_REDIRECT_URI` tem de coincidir exatamente com o registado na consola da Google.**
A Google compara-o literalmente: um `?`, um `#` ou uma barra a mais produz
`redirect_uri_mismatch`, cuja resposta não diz o que está mal. A API valida o formato no
arranque (absoluto, sem query nem fragmento) para apanhar os casos que consegue apanhar. O
valor efetivo é impresso no arranque, na linha `login Google:` — é esse que se copia para a
consola. Em produção tem de ser `https`.

**O endereço de retorno tem de ser servido por esta API.** O fluxo deixa um cookie
`HttpOnly` no browser que só volta se o callback for servido pelo mesmo host — é ele que liga
o pedido ao browser que o começou. Um `GOOGLE_REDIRECT_URI` a apontar para outro host faz o
fluxo falhar com «não corresponde ao pedido feito neste browser».

> **Limitação declarada, e importante em produção com mais do que uma instância.** O estado do
> fluxo (o `state`, o `nonce` e o verificador PKCE) vive na **memória do processo**, e não na
> base de dados — não há escrita nenhuma enquanto o utilizador não volta. Consequência: com
> **várias instâncias da API atrás de um balanceador**, o `/start` pode cair numa instância e o
> `/callback` noutra, e o segundo não reconhece o `state`. Nesse cenário tem de haver
> armazenamento partilhado (ou afinidade de sessão no balanceador). Com uma instância — que é o
> que a §3.5 descreve — não há problema. Registado como `PC-29`.

### 3.5. Serviço

```ini
# /etc/systemd/system/zemlo.service
[Unit]
Description=Zemlo API
After=network.target postgresql.service

[Service]
Type=simple
User=zemlo
WorkingDirectory=/opt/zemlo
EnvironmentFile=/etc/zemlo/env
ExecStart=/usr/bin/node apps/api/dist/server.js
Restart=always
RestartSec=5

# Endurecimento. O processo só precisa de ler o código e falar pela rede.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/zemlo/apps/api/prisma
CapabilityBoundingSet=
AmbientCapabilities=

[Install]
WantedBy=multi-user.target
```

O servidor encerra de forma limpa com `SIGTERM`: deixa de aceitar ligações novas, dá dez
segundos às que estão a decorrer, fecha a ligação à base de dados e sai. Um `systemctl
restart` durante um deploy não perde pedidos em curso.

### 3.5.1. Trabalho periódico (agendador)

O Zemlo tem **um** trabalho periódico: sincronizar as notificações internas de todos os
utilizadores. Sem ele, um lembrete legal (inspeção, seguro, IUC) só avisava quem abrisse a
aplicação — e o ecrã que mostrava o aviso era o mesmo que o gerava.

| Variável | Por omissão | Efeito |
| --- | --- | --- |
| `NOTIFICATIONS_SYNC_INTERVAL_MINUTES` | `15` | Intervalo entre passagens. **`0` desliga o agendador.** Máximo `1440` (um dia) |

O agendador é **in-process**: corre dentro do processo da API, arrancado pelo `server.ts`
depois de a porta estar aberta, e parado no encerramento (`SIGTERM`). Não atrasa o arranque
e não impede o serviço de aceitar pedidos.

**Uma passagem corre no arranque**, sem esperar o primeiro intervalo: o trabalho pendente
está na base de dados, e uma instância reiniciada não pode deixar passar 15 minutos por
trabalho que já estava por fazer.

**A idempotência não está no agendador, está na base de dados.** Cada notificação tem uma
`dedupeKey` derivada do lembrete, do estado e da data efetiva, e o índice único
`(userId, dedupeKey)` é a garantia final. Correr a sincronização duas vezes não duplica
nada — é o que torna seguro um reinício, um temporizador que dispara durante uma passagem
anterior, e dois processos a partilhar a mesma base de dados.

**Uma tarefa não corre duas vezes ao mesmo tempo no mesmo processo.** Se uma passagem
ainda estiver em curso quando o intervalo seguinte dispara, a segunda é **ignorada** e
registada como ignorada (`tarefa agendada ignorada: a execução anterior ainda está em
curso`). Uma execução em curso nunca é interrompida — nem pela guarda, nem pelo `stop()`.

O que se observa no log:

```
agendador iniciado {"intervalMinutes":15,"runOnStart":true,"jobs":["notification-sync"]}
tarefa agendada iniciada {"job":"notification-sync"}
tarefa agendada concluída {"job":"notification-sync","durationMs":42,"result":{"usersConsidered":3,"usersSynced":3,"notificationsCreated":1,"failures":[],"durationMs":41}}
```

Uma falha num utilizador **não** impede os outros: é registada com o `userId` e o motivo
(`não foi possível sincronizar as notificações de um utilizador`), conta-se em
`failures`, e a passagem continua. Uma falha da tarefa inteira é registada como
`tarefa agendada falhou` e **não** desarma o relógio — a passagem seguinte é uma nova
oportunidade.

**Com mais do que uma instância da API, decida onde isto corre.** A guarda de reentrância
é por processo: duas instâncias correm o trabalho as duas. Não duplica notificações (a
`dedupeKey` impede-o), mas faz o dobro do trabalho. Nesse cenário, ponha
`NOTIFICATIONS_SYNC_INTERVAL_MINUTES=0` em todas menos uma — ou em todas, e corra o
trabalho por fora. O núcleo (`runNotificationSync`) não conhece temporizadores e pode ser
invocado por um entrypoint externo sem alterações; o que **não** existe ainda é esse
entrypoint.

### 3.5.2. Publicação no Home Assistant por MQTT (`INT-001`)

O Zemlo expõe as entidades de um veículo no Home Assistant por **descoberta MQTT**. Sem
broker configurado, a integração existe e é explicada ao utilizador, mas **não publica** —
o comportamento anterior a `INT-001` mantém-se, e é o caso por omissão.

| Variável | Por omissão | Efeito |
| --- | --- | --- |
| `HA_MQTT_URL` | *(vazio)* | Endereço do broker (`mqtt://…` ou `mqtts://…`). **Sem ele, não há publicação nenhuma** |
| `HA_MQTT_USERNAME` | *(vazio)* | Utilizador, se o broker o exigir |
| `HA_MQTT_PASSWORD` | *(vazio)* | Palavra-passe, se o broker a exigir |
| `HA_DISCOVERY_PREFIX` | `homeassistant` | Prefixo dos tópicos de **descoberta**. Um espaço em branco é ignorado |

#### O que é publicado

Por cada veículo, e por cada entidade **disponível**:

```
<HA_DISCOVERY_PREFIX>/<componente>/zemlo/<entidade>/config     retido — descoberta
zemlo/<vehicleId>/<entidade>/state                             retido — estado
zemlo/<vehicleId>/availability                                 retido — "online"/"offline"
zemlo/<vehicleId>/publisher                                    retido — diagnóstico da passagem
```

O `objectId` é o `entityId` da especificação sem o `<componente>.` — é o **mesmo** nome que a
interface do Zemlo mostra, e é isso que impede o objeto do Home Assistant de aparecer com
outro identificador.

O tópico de diagnóstico (`…/publisher`) existe para responder a «o Zemlo chegou a publicar?»
sem acesso ao processo: o resultado da última passagem fica no broker
(`{"published":n,"skipped":n,"failures":n,"at":"…"}`).

#### A regra que não se pode perder

**Uma entidade indisponível não publica nada** — nem descoberta, nem estado. Não publica
`unknown`, não publica `0`, não publica vazio. Um `sensor.zemlo_car_battery` a `0` lê-se como
«a bateria está descarregada», não como «o Zemlo não sabe»; um consumo a `0` lê-se como «o
carro não gasta combustível». Para um produto cuja promessa é não inventar dados
(`ARCHITECTURE.md` §8, `ROADMAP` §48/§49), publicar um valor quando não há valor é a única
falha intolerável aqui, porque é invisível: ninguém recebe um erro, recebe um número errado.

Um valor real que seja **zero**, esse, publica-se: `0 km` de quilometragem é um carro novo.

#### O que **não** se observa

- **Nenhuma entidade indisponível aparece no Home Assistant.** Não é uma omissão: é a decisão
  acima. As indisponíveis estão listadas em `GET /integrations/home-assistant/spec` com a
  `requires` que explica o que falta a cada uma.
- **Nenhuma publicação sem broker.** Sem `HA_MQTT_URL` não há cliente nem tarefa agendada. O
  log de arranque diz `publicação MQTT inativa: sem HA_MQTT_URL configurado`.

#### Uma falha do broker não derruba a API

A publicação é uma comodidade: nenhuma funcionalidade da API depende dela. Por isso o cliente
**devolve** os erros em vez de os lançar (`services/mqtt-client.ts`), e uma falha de ligação
aparece como um relatório com o motivo — nunca como uma resposta `500` nem como um arranque
falhado. A ligação é **preguiçosa**: abre-se na primeira publicação, não no arranque, para que
um broker em baixo (ou um `HA_MQTT_URL` errado) não atrase a disponibilidade do serviço.

Sem a dependência `mqtt` instalada, a razão é explícita:

```
a dependência `mqtt` não está instalada. Instala-a com `npm install mqtt --workspace @zemlo/api` para ativar a publicação.
```

A dependência é **opcional** e carregada dinamicamente — um `import` estático faria a API não
arrancar sem ela, o que seria trocar «o Home Assistant não publica» por «o Zemlo não serve».

#### Com mais do que uma instância

A publicação corre no **mesmo** agendador da §3.5.1, e vale a mesma ressalva: a guarda de
reentrância é por processo. Duas instâncias publicam as duas — o estado é retido no tópico, pelo
que o resultado é o mesmo, mas é trabalho a dobrar. Nesse cenário, ponha
`NOTIFICATIONS_SYNC_INTERVAL_MINUTES=0` onde não quer o trabalho a correr.

#### Estado da verificação

A construção dos tópicos, a serialização dos payloads, a decisão de disponibilidade e o
tratamento de erro **estão fixados por testes** (`apps/api/test/integrations-mqtt-publication.test.ts`).
O percurso `publicar → broker → subscritor` **não está validado**: não existe um broker MQTT
neste ambiente (`ARCHITECTURE.md` §8). Ver §9.

### 3.6. Cloudflare Tunnel

```yaml
# /etc/cloudflared/config.yml
tunnel: zemlo
credentials-file: /etc/cloudflared/zemlo.json
ingress:
  - hostname: appzemlo.com
    service: http://127.0.0.1:4000
  - service: http_status:404
```

A API corre com `HOST=127.0.0.1` e `trust proxy` ativo: o IP real do cliente chega no
cabeçalho `CF-Connecting-IP`, e é esse que a limitação de abuso usa. Sem isto, todos os
utilizadores partilhariam o mesmo balde de limitação.

---

## 4. Verificação pós-deploy

```bash
curl -fsS https://appzemlo.com/health | jq .
```

Deve devolver `200` com `"status": "ok"` e `"database": { "reachable": true }`. Um `503`
significa que a base de dados não responde — e nesse caso o serviço **não** deve receber
tráfego, razão pela qual `/health` devolve 503 em vez de um 200 «degradado».

Sinais de que algo está errado, por ordem de probabilidade:

| Sintoma | Causa provável |
| --- | --- |
| **O serviço não arranca** e o log diz `JWT_SECRET começa por "dev-only-"` | Um `.env` de desenvolvimento está presente no servidor e o orquestrador não injetou um segredo próprio. É a guarda a funcionar: gerar um segredo novo e injetá-lo pelo ambiente |
| O serviço não arranca e o log diz `JWT_SECRET é obrigatório` | Segredo em falta |
| Arranca mas tudo devolve 500 | `DATABASE_URL` errado, ou migrações não aplicadas |
| 2FA e integrações devolvem 503 | `ENCRYPTION_KEY` em falta (por design — não guarda segredos sem cifragem) |
| As notificações por email não chegam | SMTP não configurado. O log de arranque diz `email: inativo` |
| O Home Assistant não recebe nada | Broker MQTT não configurado. `GET /integrations/home-assistant/spec` explica-o ao utilizador |
| Um utilizador vê datas deslocadas de um dia | O `timeZone` da conta está errado. `PATCH /me` valida-o; um valor inválido degrada para `Europe/Lisbon` em vez de rebentar |

O log de arranque resume, em nove linhas, o que está ativo e o que não está. É o primeiro
sítio a olhar:

```
INFO  Zemlo API a arrancar {"versao":"0.1.0"}
INFO    ambiente: production
INFO    base de dados: postgresql
INFO    escuta: http://127.0.0.1:4000
INFO    origens CORS: …
INFO    segredos cifrados: ativos (2FA disponível)
INFO    login Google: inativo (sem credenciais)
INFO    email: inativo (sem SMTP)
INFO    Home Assistant: inativo (sem broker MQTT)
```

---

## 5. Backups (§55)

O Zemlo guarda dados que ninguém consegue reconstruir: custos, quilometragens, histórico de
manutenções. Não há forma de os recuperar de outra fonte.

```bash
# Backup diário, fora da máquina do Zemlo.
pg_dump --format=custom --file="/backups/zemlo-$(date -u +%Y%m%dT%H%M%SZ).dump" zemlo
```

Requisitos, todos da especificação (§55):

1. **Automático** — diário, por cron ou temporizador de systemd.
2. **Com retenção** — pelo menos 30 dias, mais um backup mensal por um ano.
3. **Em armazenamento separado** — um backup na mesma máquina não é um backup. Se o disco
   falhar, perdem-se os dois.
4. **Com testes de restauração** — um backup que nunca foi restaurado é uma suposição.
   Restaurar trimestralmente num ambiente limpo e verificar que `/stats` devolve os mesmos
   números.

O `ENCRYPTION_KEY` **não** está no backup da base de dados, e é isso que torna os segredos
cifrados inúteis para quem roube o ficheiro. Mas também significa que **perder a chave
perde os segredos de 2FA e as credenciais de integrações** — é preciso guardá-la num
gestor de segredos com backup próprio. Os dados de negócio continuam legíveis; o que se
perde é a capacidade de validar códigos de dois fatores, o que obriga cada utilizador a
reconfigurar o 2FA.

---

## 6. Monitorização (§56)

| O quê | Como |
| --- | --- |
| Está de pé? | `GET /health` a cada minuto. Alertar em `503` ou em ausência de resposta |
| A base de dados responde? | Incluído no `/health`, com latência |
| O processo está vivo? | `GET /health/live` — sonda barata que não toca na base de dados |
| Erros | Logs JSON em `stdout`/`stderr`; filtrar por `"level":"error"` |
| Correlação de pedidos | `X-Request-Id` em cada resposta; o mesmo valor no log |
| Ações sensíveis | Tabela `AuditLog` — alterações de password e 2FA, sessões, exportações, eliminação de conta |
| Volume da conta | `GET /metrics` (autenticado) |

O `logger` **mascara** emails, matrículas, IPs e remove segredos de tudo o que é registado.
Um log de diagnóstico não pode transformar-se numa fuga de dados (§31) — por isso não há
telemetria de terceiros nem envio de dados para fora da infraestrutura do projeto.

---

## 7. Migrações de schema

```bash
# 1. Alterar o schema canónico (PostgreSQL)
vim apps/api/prisma/schema.prisma

# 2. Regenerar a variante SQLite e confirmar que ficam sincronizadas
npm run db:sync-schema && npm run db:check-schema

# 3. Gerar e aplicar a migração em desenvolvimento
npm run db:migrate

# 4. Ensaiar em staging
npm run db:deploy:pg

# 5. Em produção, só depois de o staging validar
npm run db:deploy:pg
```

Para acrescentar uma migração PostgreSQL sem uma base de dados à mão — o caso de quem
prepara uma alteração e quer revê-la antes de a aplicar:

```bash
npx prisma migrate diff \
  --from-migrations apps/api/prisma/migrations \
  --to-schema-datamodel apps/api/prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL" \
  --script > apps/api/prisma/migrations/$(date -u +%Y%m%d%H%M%S)_descricao/migration.sql
```

`npm run verify` inclui `db:check-schema`: se a variante SQLite ficar desatualizada, a
verificação falha. É o que impede a divergência entre o schema de desenvolvimento e o de
produção de passar despercebida até ao deploy.

Depois de alterar o schema, regenerar **os dois** clientes Prisma — o schema é a fonte de
verdade, e o cliente gerado é derivado:

```bash
npm run db:generate      # sincroniza o SQLite, gera os dois clientes, liga os pacotes
```

O `prebuild` da API corre este passo de qualquer forma, pelo que `npm run build` nunca
compila contra um cliente desatualizado. Correr `db:generate` explicitamente serve para
inspecionar os tipos novos antes de escrever código contra eles.

Antes de qualquer migração destrutiva: backup verificado, migração ensaiada em staging, e
uma janela em que dê para reverter.

---

## 8. Recuperação

| Situação | O que fazer |
| --- | --- |
| Base de dados corrompida | Restaurar o último backup (`pg_restore`). Verificar `/stats` e `/health` |
| Segredos comprometidos | Rodar `JWT_SECRET` (invalida todas as sessões) e `ENCRYPTION_KEY` (obriga a reconfigurar 2FA e integrações) |
| Conta comprometida | O utilizador altera a password, o que revoga as outras sessões; ou revoga dispositivos em Definições → Segurança |
| Credenciais de integração suspeitas | Eliminar a integração; as credenciais são cifradas e desaparecem com ela |
| Dados corrompidos por um defeito | `npm run db:integrity` identifica referências órfãs; `npm run db:repair` corrige as conhecidas |

Ao rodar o `JWT_SECRET`, todos os utilizadores voltam a ter de iniciar sessão. É o
comportamento correto: um segredo potencialmente conhecido por terceiros invalida todas as
sessões que emitiu.

---

## 9. O que não existe (e por isso não está documentado)

Para que ninguém procure em vão:

- **Canal push e email.** O modelo tem os campos e as preferências existem, mas só o canal
  interno está implementado. Push exige uma app mobile publicada; email exige um servidor
  SMTP. O código não finge que os envia (§A16).
- **Publicação MQTT para o Home Assistant — integração implementada, percurso E2E não provado.**
  O registo de integrações, o cofre de credenciais e a especificação das entidades estão
  implementados, e a publicação passou a existir com `INT-001` (§3.5.2): tópicos, payloads de
  descoberta, decisão de disponibilidade e tratamento de erro estão fixados por testes. O que
  **não** está provado é o percurso `publicar → broker → subscritor` num broker **real**: não
  existe nenhum neste ambiente (`ARCHITECTURE.md` §8 — «exige infraestrutura (broker) que não
  existe em desenvolvimento»). Um resultado E2E não foi declarado. Quem montar um broker (ex.:
  `mosquitto`) fecha esta lacuna correndo um subscritor nos tópicos de §3.5.2 e conferindo a
  descoberta no próprio Home Assistant.
- **Ligação a APIs de fabricantes, OBD e wallboxes.** O modelo e a normalização de origem
  (§50) estão prontos; nenhuma integração concreta existe.
- **Trabalho agendado.** Existem **dois** — a sincronização de notificações (§3.5.1) e a
  publicação MQTT quando há broker (§3.5.2) — e ambos estão documentados. O que **não** existe
  é um entrypoint externo (`dist/jobs/…`) para
  o correr fora da API: o núcleo não conhece temporizadores e está preparado para isso, mas
  o ficheiro que o invocaria não foi escrito, porque não há nenhuma instalação com mais do
  que uma instância da API que o justifique. Ver §3.5.1 para o que fazer nesse caso
  (desligar o agendador in-process numa das instâncias).
- **Envio de ficheiros pela interface web.** A API já **serve** e já **aceita** os bytes
  (`GET`, `POST` e `PUT /api/v1/documents/:id/content`, autenticados e restritos ao dono —
  §A17.1, §A31 e §PROD-008; o `POST` e o `PUT` recebem o ficheiro com o **corpo cru**, sem
  `multipart`; o `POST` cria o ficheiro e recusa com `409` um documento que já tenha um, e o
  `PUT` substitui-o). O que **não existe** é o controlo na web: não há `<input type="file">` para
  documentos, e por isso a **substituição** também não está exposta. Os bytes entram pela
  API, pelo importador de bundle ou por escrita directa no directório de documentos
  (`DOCUMENT_STORAGE_DIR`; por omissão `data/documents-storage/` ao lado da base de dados).
- **Associação de uma conta Google a uma conta Zemlo existente.** A entrada com Google está
  implementada (`AUTH-002`, §3.4.2), incluindo a criação automática de conta. O que **não**
  existe é ligar uma identidade Google a uma conta que já tenha o mesmo email: esse caso é
  recusado com `409` e encaminhado para `AUTH-003`, que ainda não está implementada. Também
  não existe ecrã para pedir a aceitação dos termos no primeiro acesso federado — a conta é
  criada com `acceptedTermsAt` nulo (`PC-28`).
