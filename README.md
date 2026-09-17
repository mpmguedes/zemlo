# Zemlo

> **O teu veículo, sem ruído.**

Plataforma pessoal de informação, histórico, manutenção, custos e integrações para
veículos. **Simplicidade na entrada. Profundidade opcional.**

O Zemlo funciona com muito pouca informação inicial — uma matrícula é suficiente para
começar — mas a arquitetura suporta integrações com fabricantes, Home Assistant, OBD,
telemetria, famílias e frotas sem reconstrução estrutural.

---

## Estado

| Área | Estado |
| --- | --- |
| API REST (Node 22 · Express · TypeScript) | ✅ MVP completo (§39) |
| Modelo de dados (27 tabelas, PostgreSQL + SQLite) | ✅ |
| Autenticação (email/password, JWT, 2FA TOTP, sessões renováveis) | ✅ |
| App web (React · Vite · mobile-first, 30 rotas) | ✅ |
| Testes (63 unitários · 231 ponta a ponta · 70 regressões · 12 guardas · 28 integração) | ✅ a passar |
| Documentação (API, arquitetura, 25 decisões, operações, identidade) | ✅ |
| App mobile (Flutter) | ⏳ pós-MVP (§3.6) |
| Integrações de fabricantes, OBD, wallboxes, MQTT | ⏳ modelo e especificação prontos, sem ligação |

A app web consome a mesma API que a futura app mobile consumirá (§34) — o contrato em
`packages/shared` é a única definição de "despesa" ou "lembrete" no projeto, para que as
duas aplicações não possam divergir.

> **Nota sobre os testes.** O número de verificações não é uma medida de qualidade por si
> só. Três defeitos que inutilizavam contas ou corrompiam totais passaram por 223
> verificações automáticas antes de serem encontrados por uma revisão adversarial manual; e
> um quarto — o `refreshToken` que o servidor nunca devolvia, tornando a renovação de sessão
> impossível — foi encontrado pela aplicação web, não por um teste da API.
> `verify-regressions.ts` existe para fixar exatamente esses casos, e `docs/DECISIONS.md`
> (§A22 a §A24) explica o que tinham em comum: validar a forma de um valor sem validar o seu
> significado, e testar os caminhos que alguém se lembrou de testar.

---

## Começar

### Pré-requisitos

- **Node.js ≥ 22.11** (usa `tsx`, `fetch` nativo e as APIs de `node:crypto` modernas)
- Nada mais. Não é preciso Docker, servidor de base de dados, Flutter nem chaves de API.

### Instalação

```bash
git clone <repositório> && cd CarApp
npm install

# Aprovar os scripts de instalação do Prisma e do esbuild (npm 12+ bloqueia-os por omissão)
npm install-scripts approve prisma @prisma/engines @prisma/client esbuild

# Criar a base de dados local (SQLite) e popular com dados de demonstração
npm run db:push
npm run db:seed
```

O seed cria duas contas:

| Conta | Email | Password | Conteúdo |
| --- | --- | --- | --- |
| Histórico completo | `demo@zemlo.pt` | `ZemloDemo2026` | Kia EV3 + BMW X3, 18 meses de registos |
| Conta vazia | `vazio@zemlo.pt` | `ZemloDemo2026` | Sem veículos — para ver o onboarding |

### Correr

```bash
# Terminal 1 — API em http://127.0.0.1:4000
npm run dev:api

# Terminal 2 — Web em http://127.0.0.1:5173 (com proxy para a API)
npm run dev:web
```

Abre `http://127.0.0.1:5173` e entra com `demo@zemlo.pt` / `ZemloDemo2026`.

### Correr em modo de produção

```bash
npm run build        # compila o pacote partilhado, a API e a aplicação web
npm run start:api    # em produção a API serve também a aplicação web
```

Com `apps/web/dist` presente, a API serve os ficheiros estáticos e devolve o `index.html`
para qualquer rota que não seja da API. O sistema inteiro passa a ser **um** serviço, um
domínio e um certificado atrás do Cloudflare Tunnel — sem CORS e sem uma segunda política
de cabeçalhos para manter. Ver `docs/ARCHITECTURE.md` §7.

### Verificar que tudo funciona

```bash
npm test                                    # 63 testes unitários do domínio
npm run verify:config                       # 12 guardas de configuração de produção
npm run verify                              # 231 verificações ponta a ponta (API a correr)
npm run verify:regressions                  # 70 regressões de defeitos já corrigidos
npm run verify:integration                  # 28 verificações da integração em produção
npm run typecheck                           # tipos em todos os pacotes
npm run build                               # build de produção
```

`npm run verify:all` corre as três suítes que precisam da API a correr.
`npm run verify` e `npm run verify:regressions` criam as suas próprias contas descartáveis
e eliminam-nas no fim, pelo que podem correr contra a base de dados de desenvolvimento sem
tocar nos dados de demonstração. `npm run db:cleanup` remove contas de teste que tenham
ficado de uma corrida interrompida.

`npm run verify:integration` é diferente das outras: exige o build de produção e uma
instância a servir a aplicação web, e verifica a fronteira entre as duas metades do sistema
— que a API serve o frontend, que um URL profundo funciona, e que as rotas da API continuam
a devolver JSON em vez de `index.html`.

---

## Estrutura do projeto

```text
zemlo/
├── apps/
│   ├── api/                        API REST — a fonte de verdade do produto
│   │   ├── prisma/
│   │   │   ├── schema.prisma       Schema canónico (PostgreSQL)
│   │   │   ├── sqlite/             Variante SQLite GERADA — não editar à mão
│   │   │   └── seed.ts             Dados de demonstração realistas
│   │   ├── scripts/
│   │   │   ├── sync-sqlite-schema.mjs   Deriva o schema SQLite do canónico
│   │   │   ├── verify.ts                231 verificações ponta a ponta
│   │   │   ├── verify-regressions.ts    70 regressões de defeitos corrigidos
│   │   │   ├── verify-config.ts         12 guardas de configuração
│   │   │   ├── verify-integration.mjs   28 verificações da integração em produção
│   │   │   ├── check-integrity.mjs      Referências órfãs
│   │   │   ├── cleanup-test-accounts.mjs Limpeza de contas de teste
│   │   │   └── smoke-db.mjs             Diagnóstico de ligação à base de dados
│   │   ├── src/
│   │   │   ├── core/               Config, erros, logs, cifragem, Prisma
│   │   │   ├── domain/             Lógica pura: cálculos, lembretes, análise
│   │   │   ├── services/           Casos de uso e acesso a dados
│   │   │   ├── http/               Middlewares, validação e rotas
│   │   │   ├── app.ts              Composição da aplicação Express
│   │   │   └── server.ts           Arranque e encerramento limpo
│   │   └── test/domain.test.ts     63 testes do domínio
│   │
│   └── web/                        App web React (mobile-first, 30 rotas)
│       ├── public/favicon.svg      Símbolo Z-estrada
│       ├── scripts/
│       │   ├── verify-qr.ts        Verificação do codificador de QR (ISO/IEC 18004)
│       │   ├── smoke-render.mjs    Renderiza todos os ecrãs com dados reais da API
│       │   └── check-encoding.mjs  Codificação dos ficheiros
│       └── src/
│           ├── api/                Cliente HTTP, React Query, erros tipados
│           ├── components/          QuickLogSheet, Logo, gráficos, calendário
│           ├── pages/               Dashboard, veículos, registos, estatísticas, …
│           ├── lib/qr.ts            Codificador de QR escrito de raiz (sem dependências)
│           └── styles/             Design system derivado das cores da marca
│
├── packages/
│   └── shared/                     O contrato, definido uma única vez
│       └── src/
│           ├── contracts.ts        Esquemas Zod (aplicados pela API, tipados no cliente)
│           ├── types.ts            Formas de resposta da API
│           ├── registry.ts         Categorias, tipos, estados — fonte única de verdade
│           ├── brand.ts            Cores da marca
│           ├── money.ts            Dinheiro em cêntimos inteiros
│           ├── dates.ts            Datas civis, meses, formatação pt-PT
│           ├── units.ts            Conversões km/mi, L/kWh
│           └── pt.ts               Matrículas portuguesas, VIN
│
└── docs/
    ├── API.md                      Contrato completo da API
    ├── ARCHITECTURE.md             Como o sistema está construído
    ├── DECISIONS.md                Porque cada decisão foi tomada (25 decisões)
    ├── OPERATIONS.md               Deploy, backups, monitorização, recuperação
    └── BRAND.md                    Símbolo Z-estrada: conceito e regras
```

---

## Princípios que moldaram o código

Estes não são slogans — cada um explica uma escolha concreta que se vê no código.

### Simplicidade na entrada, profundidade opcional (§3.2, §62)

Só a **matrícula** é obrigatória para criar um veículo. Todos os campos avançados — VIN,
bateria, potência, pneus — existem, são validados e são opcionais. O onboarding tem três
passos e não há um formulário longo em nenhum ponto.

### Registar uma vez, reutilizar sempre (§3.3)

Registar a quilometragem num abastecimento atualiza o veículo, alimenta o custo/km, o
ritmo de utilização, a projeção da próxima revisão, os cartões do dashboard, o calendário,
a timeline e as estatísticas. O utilizador não introduz o mesmo dado duas vezes.

### Aceitar dados incompletos (§49)

`Kia EV3 · 42 381 km` é um veículo perfeitamente válido. Todas as estatísticas devolvem
`null` em vez de inventar um número quando faltam dados, e a interface explica o que falta
em linguagem de produto: "Com a quilometragem atual, passamos a calcular o custo por km."
Nunca `ERROR: incomplete data`.

**Incompleto não é o mesmo que sem identidade.** O que pode faltar são os dados
**complementares** — VIN, combustível, bateria, potência, pneus, aquisição. A **matrícula é
a identidade mínima** de um veículo, e é a única coisa que não pode faltar: sem ela não há
forma de saber que dois registos são o mesmo veículo. O exemplo acima é válido porque o
veículo está identificado pela matrícula, não porque ela seja dispensável. A importação
segue a mesma regra da criação manual (A25).

### Automatizar antes de pedir (§3.4)

Se o valor não foi indicado, o Zemlo calcula-o (preço por litro, preço por kWh, próxima
data de manutenção, data projetada a partir do ritmo de quilometragem, distância desde o
último registo). A data de hoje, o veículo e a quilometragem vêm preenchidos.

### A regra dos 10 segundos (§43)

Registar um carregamento são três campos — energia, custo, quilometragem — com os detalhes
atrás de "Adicionar detalhes". A API devolve as métricas derivadas já calculadas na
resposta de criação, porque um segundo pedido para as obter é fricção sem valor.

### Complexidade disponível, não visível (§3.5)

TCO, depreciação, comparação entre períodos e consumo por mês existem. Estão numa secção
que começa colapsada. Quem só quer saber quanto gastou não é confrontado com eles.

---

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev:api` | API em modo de observação |
| `npm run dev:web` | App web com proxy para a API |
| `npm run build` | Build de produção de tudo |
| `npm run typecheck` | Verificação de tipos em todos os pacotes |
| `npm test` | Testes unitários do domínio |
| `npm run verify` | Verificação ponta a ponta contra uma API a correr |
| `npm run verify:config` | Guardas de configuração (12 cenários, incluindo produção) |
| `npm run verify:regressions` | Regressões: cada defeito corrigido, fixado por uma verificação |
| `npm run verify:integration` | Fronteira API + aplicação web em modo de produção |
| `npm run verify:all` | As três suítes que precisam da API a correr |
| `npm run db:cleanup` | Remove contas deixadas por verificações interrompidas |
| `npm run db:integrity` | Verifica que não há referências órfãs na base de dados |
| `npm run db:accounts` | Lista as contas existentes, para identificar restos de testes |
| `npm run db:push` | Aplicar o schema à base de dados local (SQLite) |
| `npm run db:seed` | Popular com dados de demonstração |
| `npm run db:reset` | Apagar a base de dados local e recriá-la |
| `npm run db:sync-schema` | Regenerar o schema SQLite a partir do canónico |
| `npm run db:check-schema` | Falhar se o schema SQLite estiver desatualizado |
| `npm run db:migrate` | Criar/aplicar migração (SQLite) |
| `npm run db:migrate:pg` | Aplicar migrações em PostgreSQL |

---

## Usar PostgreSQL em vez de SQLite

O código é o mesmo; muda o schema aplicado e a ligação.

```bash
# apps/api/.env
DATABASE_URL=postgresql://zemlo:zemlo@127.0.0.1:5432/zemlo?schema=public
DATABASE_PROVIDER=postgresql
```

```bash
npm run db:generate
npx prisma migrate dev --schema apps/api/prisma/schema.prisma
```

O schema canónico é escrito para PostgreSQL (tipos `@db.Date`, `@db.Text`, `Decimal`
substituído por cêntimos inteiros por decisão de produto). Ver `docs/DECISIONS.md` A1.

---

## Configuração

Todas as variáveis estão documentadas em `.env.example`. As que importam para começar:

| Variável | Obrigatória | Nota |
| --- | --- | --- |
| `DATABASE_URL` | sim | `file:./dev.db` para SQLite |
| `JWT_SECRET` | em produção | Mínimo 32 caracteres aleatórios. O valor de desenvolvimento é **recusado** em produção |
| `ENCRYPTION_KEY` | para 2FA e integrações | 32 bytes em base64. Sem ela, essas funcionalidades respondem 503 explicando o que falta — em vez de guardarem segredos em claro |
| `CORS_ORIGINS` | não | Origens permitidas, separadas por vírgula |
| `GOOGLE_CLIENT_ID` / `_SECRET` | não | Login Google só fica ativo com ambos |
| `SMTP_*` | não | Sem SMTP, as notificações ficam apenas na aplicação |
| `HA_MQTT_URL` | não | Home Assistant: sem broker, as entidades ficam listadas mas não publicam |

Gerar segredos:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"      # ENCRYPTION_KEY
```

---

## Documentação

- **[docs/API.md](docs/API.md)** — contrato completo: endpoints, convenções, códigos de
  erro, fluxos de confirmação.
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — as quatro camadas da API, modelo de
  dados, autenticação, pontos de extensão, superfície de segurança.
- **[docs/DECISIONS.md](docs/DECISIONS.md)** — 25 decisões de arquitetura com alternativas
  consideradas e o que se perde com cada escolha.
- **[docs/OPERATIONS.md](docs/OPERATIONS.md)** — deploy, segredos, migrações, backups,
  monitorização e recuperação.
- **[docs/BRAND.md](docs/BRAND.md)** — o símbolo Z-estrada: conceito, grelha de construção,
  regras de utilização.

---

## Licença

Projeto privado. Todos os direitos reservados.
