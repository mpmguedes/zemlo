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

A **entrega** do link, no entanto, depende de um fornecedor de email que o MVP não traz.
Sem `SMTP_HOST` configurado, o link é escrito no log da aplicação:

```
INFO  Email não enviado — entrega por configurar; conteúdo registado
      {"to":"…","subject":"Zemlo — reposição da tua password","body":"…/repor-password?token=…"}
```

Isso serve para desenvolvimento e testes de ponta a ponta, e **não** serve para
utilizadores reais: quem se esquecer da password não recebe nada. Antes de abrir a
plataforma a utilizadores, é obrigatório ligar um transporte real — implementar
`EmailSender` em `apps/api/src/services/email.ts` e registá-lo com `setEmailSender`. Nada
do fluxo de tokens precisa de mudar.

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
- **Publicação MQTT para o Home Assistant.** O registo de integrações, o cofre de
  credenciais e a especificação das entidades estão implementados; a publicação efetiva não.
- **Ligação a APIs de fabricantes, OBD e wallboxes.** O modelo e a normalização de origem
  (§50) estão prontos; nenhuma integração concreta existe.
- **Trabalho agendado.** As notificações são materializadas quando o utilizador abre a
  aplicação, o que para o MVP é equivalente. `syncNotifications` já é idempotente e pode
  correr em lote quando o agendador existir.
- **Upload de ficheiros.** A API **serve** os bytes de um documento que já exista no
  armazenamento (`GET /api/v1/documents/:id/content`, autenticado e restrito ao dono — §A17),
  mas **não aceita** ficheiros novos: não há `multipart`, nem escrita pela API. Os bytes
  entram pelo importador de bundle ou por escrita directa no directório de documentos
  (`DOCUMENT_STORAGE_DIR`; por omissão `data/documents-storage/` ao lado da base de dados).
