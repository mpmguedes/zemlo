# Zemlo — decisões de arquitetura

Registo das decisões que moldaram o produto, com o raciocínio por trás de cada uma. Não
é documentação de como usar o código (isso está no `README.md`) nem o contrato da API
(isso está em `docs/API.md`). É o **porquê**: o que foi decidido, que alternativas foram
consideradas, e o que se perde com a escolha feita.

O objetivo é que, dentro de um ano, ninguém tenha de reconstituir estas conversas a
partir do código — nem, pior, reverta uma decisão sem saber o que ela estava a proteger.

---

## A1. O schema PostgreSQL é a fonte de verdade; o SQLite é derivado

**Decisão.** `apps/api/prisma/schema.prisma` (PostgreSQL) é o schema canónico. A variante
SQLite, usada em desenvolvimento e testes, é **gerada** a partir dele por
`scripts/sync-sqlite-schema.mjs`. `npm run db:check-schema` falha se ficarem divergentes.

**Alternativas.** (a) Só PostgreSQL — correta para produção, mas obrigaria a ter um
servidor de base de dados para correr um teste. (b) Só SQLite — simples, mas afasta-se do
alvo de produção e esconde diferenças que aparecem no pior momento. (c) Dois schemas
escritos à mão — é a alternativa que *parece* mais simples e é a pior: ficam divergentes
em semanas, e a divergência manifesta-se em produção.

**O que se ganha.** Um clone novo corre tudo — testes, seed, verificação ponta a ponta —
sem infraestrutura. É por isso que a suite de 63 testes unitários e as 197 verificações
end-to-end existem de facto, em vez de serem um diretório `test/` que ninguém corre.

**O que se perde.** O SQLite não tem tipos distintos para datas nem para JSON, pelo que
as colunas `DateTime @db.Date` e `Json` são expostas de forma mais frouxa. Mitigação
explícita: `core/json.ts` é o **único** ficheiro que faz o cast entre as duas
representações, e `domain/payload.ts` é o único que converte datas.

---

## A2. Sem `enum` do Prisma. Conjuntos fechados validados na aplicação

**Decisão.** Todas as categorias, tipos e estados (categoria de despesa, tipo de
manutenção, tipo de evento, tópico de notificação, …) são `String` na base de dados,
validados pelo registo em `packages/shared/src/registry.ts` e por Zod na fronteira HTTP.

**Alternativas.** `enum` do PostgreSQL: dá garantia no motor, mas obriga a uma migração de
tipo para acrescentar uma categoria, e não é portável para SQLite (A1).

**Porque importa para o produto.** O Zemlo tem de crescer "sem crescer proporcionalmente
em complexidade" (§62). Acrescentar "portagens de ferry" como categoria de despesa deve
ser uma linha em `registry.ts` — não uma migração com janela de manutenção. E a
integração de um fabricante que devolva um valor desconhecido tem de o poder guardar
tal como veio, em vez de falhar a escrita (§51).

**O que se perde.** A base de dados pode conter um código inválido se algo escrever
diretamente sem passar pela aplicação. Mitigação: `categoryLabel()` e `optionIcon()`
devolvem o código cru em vez de rebentarem, pelo que um valor desconhecido aparece de
forma legível em vez de fazer desaparecer uma linha de uma lista.

---

## A3. Dinheiro em cêntimos inteiros, sempre

**Decisão.** Toda a API expõe e aceita `amountCents` como inteiro. Nunca `Decimal`, nunca
`Float` para valores monetários.

**Porquê.** `0.1 + 0.2 !== 0.3` em vírgula flutuante binária. Num produto cujo valor
central é somar custos e calcular custo por km (§23), o erro acumula-se até o total anual
não bater com a soma das parcelas — e um utilizador que encontra essa discrepância deixa
de confiar em todos os outros números da aplicação.

**Nota.** `Decimal(10,2)` no PostgreSQL seria correto, mas não é portável para SQLite
(A1) e obriga a converter em todos os pontos de contacto. Inteiros em cêntimos são
corretos em qualquer motor, em qualquer linguagem e em JSON.

---

## A4. Datas civis como `YYYY-MM-DD`, instantes como ISO UTC

**Decisão.** A data de uma despesa, a validade de um documento, a data de uma inspeção e a
data de fim de uma apólice são **datas civis** (`YYYY-MM-DD`, coluna `@db.Date`). O
momento de criação de um registo, a expiração de uma sessão e as entradas de auditoria
são **instantes** (ISO 8601 UTC).

**Porquê.** Uma despesa "de ontem" não tem hora. Guardá-la como instante obriga a escolher
um fuso horário no momento da escrita e a adivinhar o fuso no momento da leitura. Quando
o utilizador viaja, ou quando o servidor corre em UTC e o utilizador está em Lisboa
(UTC+1 no verão), uma despesa de dia 1 passa a aparecer no dia 30 do mês anterior — e o
relatório mensal fica errado por um dia em cada fronteira de mês. Este é um defeito
silencioso que só se nota no fim do ano.

**Consequência prática.** `today` é resolvido no fuso do **utilizador** (`User.timeZone`),
nunca no do servidor, e `todayIn()` é a única forma de obter a data de hoje no código.

---

## A5. Modelo de eventos como base da timeline (§33)

**Decisão.** Toda a ação importante escreve uma linha em `VehicleEvent`. A timeline (§24)
lê essa tabela.

**Alternativas.** Montar a timeline com oito consultas (despesas, abastecimentos,
carregamentos, manutenções, seguros, inspeções, impostos, documentos), uma por tipo de
registo, fundidas em memória.

**Porquê a escolha.** A timeline é o ecrã que o utilizador abre com mais frequência, e é a
funcionalidade que a especificação designa como "o histórico central do veículo" (§24).
Com N tipos de registo, a alternativa custa N consultas indexadas e uma ordenação em
memória por cada abertura do ecrã — e o custo cresce a cada tipo de registo novo. Com
eventos, é uma consulta.

**O que se perde.** Duplicação: o evento e o registo têm de ser mantidos coerentes. Duas
mitigações deliberadas: (1) `services/events.ts` centraliza a escrita; (2) uma falha ao
escrever o evento **não** reverte o registo do utilizador — perder a despesa que alguém
acabou de escrever é irreparável, perder uma linha de histórico é recuperável. E
`buildRecordTimeline` gera itens a partir dos próprios registos quando não há evento,
cobrindo dados importados e o intervalo entre a introdução de um tipo de registo e o
evento correspondente.

---

## A6. O estado dos lembretes nunca é guardado

**Decisão.** `evaluateReminder()` calcula `state`, `daysRemaining`, `kmRemaining` e
`projectedDate` a cada pedido, a partir de hoje e da quilometragem atual. A coluna não
existe na base de dados.

**Alternativas.** Guardar o estado e atualizá-lo periodicamente.

**Porquê.** Um estado guardado fica desatualizado entre execuções do trabalho periódico —
e o utilizador vê "em dia" num lembrete que já venceu. Pior: se o trabalho periódico
falhar durante uma semana, *todos* os lembretes mentem durante uma semana. O cálculo é
barato (aritmética sobre dados já carregados) e não pode estar errado.

**Consequência.** Quando só existe condição de quilometragem, o Zemlo **projeta** uma data
a partir do ritmo de utilização observado (§11). Sem isso, uma revisão a 50 000 km seria
invisível no calendário (§21) durante anos — e o calendário é uma das razões de ser do
produto.

---

## A7. As sugestões são geradas; as notificações são materializadas

**Decisão.** As sugestões contextuais (§7) são calculadas a pedido e nunca semeadas na
base de dados; a base de dados guarda apenas as decisões do utilizador sobre elas
(`SuggestionState`). As notificações (§22), pelo contrário, são escritas na tabela
`Notification`.

**Porque a diferença.** Uma sugestão é um **convite**: desaparece quando deixa de fazer
sentido, e esse momento é uma função do estado do veículo, não do histórico. Semear
sugestões obrigaria a uma migração sempre que a lógica mudasse e deixaria sugestões
órfãs quando o veículo fosse apagado. Uma notificação é um **registo de que algo
aconteceu**: tem estado próprio (lida/não lida) e um histórico que o utilizador espera
consultar.

**Consequência.** A materialização é idempotente por `dedupeKey` derivada do lembrete e do
seu estado. Correr a sincronização várias vezes não duplica nada; uma mudança de estado
(de "em breve" para "em atraso") gera uma notificação nova, porque a situação mudou de
facto. Isto permite gerar notificações a pedido, sem um trabalho agendado no MVP.

---

## A8. O consumo é calculado "depósito a depósito"

**Decisão.** `deriveFuelConsumption` calcula o consumo de um intervalo apenas quando
**ambos** os abastecimentos enchem o depósito e ambos têm odómetro. Caso contrário devolve
`null`.

**Porquê.** Um abastecimento parcial no meio de um intervalo significa que os litros
registados não correspondem ao combustível consumido. O Zemlo prefere dizer "sem dados
suficientes" a mostrar um consumo errado (§49, §60). Um consumo errado leva o utilizador a
pensar que o carro tem um problema — ou, pior, a não detetar que tem.

**Detalhe que importa.** Os litros de um abastecimento parcial são **acumulados** para o
intervalo seguinte, em vez de descartados. Descartá-los perderia informação real: o
combustível entrou no depósito e foi consumido.

**Consequência.** `averageFuelConsumption` pondera por litros e quilómetros, e não faz a
média das médias — o que atribuiria o mesmo peso a um depósito de 20 L e a um de 70 L.

---

## A9. Paginação por cursor, não por offset

**Decisão.** Todas as listas usam `{ items, nextCursor }` com cursor opaco.

**Porquê.** O Zemlo convida explicitamente o utilizador a introduzir registos com datas
retroativas — uma fatura de ontem, uma revisão do mês passado, o seguro que estava na
gaveta. Com paginação por `offset`, inserir um registo no início da lista desloca todas as
páginas seguintes: o utilizador vê um item repetido ou salta um sem se aperceber. É um
defeito que não dá erro e que corrói a confiança na lista.

**Nota sobre a timeline.** A paginação é feita em memória porque a timeline resulta da
fusão de fontes heterogéneas. Para o volume de um veículo pessoal — mesmo com 15 anos de
registos, alguns milhares de itens — é mais simples e mais correto. `paginateTimeline` é o
ponto único a substituir se o Zemlo chegar a frotas com milhares de veículos.

---

## A10. O `vehicleId` tem de ser declarado em **cada** esquema de criação

**Decisão.** Todos os esquemas Zod de criação de registos declaram `vehicleId`
explicitamente, mesmo sendo opcional.

**Porquê — e esta é uma decisão aprendida da pior forma.** O Zod remove por omissão as
chaves que o esquema não declara. Durante o desenvolvimento, quatro esquemas
(manutenção, seguro, inspeção, imposto) não declaravam `vehicleId`. O resultado: quando o
cliente o enviava, era **descartado em silêncio** e o registo acabava no veículo mais
recentemente atualizado do utilizador, com um `201 Created` perfeitamente saudável.

Nenhuma verificação de código HTTP deteta este defeito. Foi encontrado por uma verificação
que compara o `vehicleId` **devolvido** com o **enviado**, para os oito tipos de registo —
e essa verificação faz agora parte de `scripts/verify.ts` (secção 16). Um `200 OK` num
recurso que foi para o sítio errado é o pior tipo de defeito: silencioso e destrutivo.

---

## A11. Erros com envelope único e mensagem escrita para o utilizador

**Decisão.** `{ error: { code, message, fields?, requestId } }`. `code` é estável e
destina-se ao cliente decidir comportamento; `message` é português, escrito para ser lido
por uma pessoa (§59).

**Porquê `requestId` em todas as respostas de erro.** Quando alguém reporta um problema,
este valor identifica o pedido exato nos logs, sem pedir mais nada ao utilizador. É a
diferença entre diagnosticar em minutos e pedir capturas de ecrã (§56).

**Porquê as mensagens não são genéricas.** "A quilometragem recuou 2 381 km face à última
leitura (42 381 km). Confirmas que corrigiste o valor?" diz ao utilizador exatamente o que
está errado, qual é a referência e o que fazer. "Validation failed" obriga-o a adivinhar.

**Exceção deliberada.** `unauthorized` devolve a mesma mensagem para email inexistente e
password errada, e `not_found` é indistinguível entre "não existe" e "não é teu". Ambos
são requisitos de segurança (§30): distinguir os casos revelaria que emails têm conta no
Zemlo e que veículos existem noutras contas.

---

## A12. Os segredos só são persistidos se houver chave de cifragem

**Decisão.** `ENCRYPTION_KEY` (AES-256-GCM) é opcional no arranque. Sem ela, a API
arranca normalmente, `secretsEnabled()` devolve `false`, e as funcionalidades que
precisam de guardar segredos — 2FA e credenciais de integrações — respondem **503 com uma
explicação**, em vez de guardarem algo em claro ou falharem de forma opaca.

**Porquê.** Guardar um segredo TOTP ou uma credencial de integração sem cifragem é pior do
que não ter a funcionalidade: cria a expectativa de segurança sem a oferecer, e uma cópia
da base de dados passa a permitir gerar códigos de dois fatores válidos (§30).

**Consequência.** O ambiente de desenvolvimento funciona sem configuração obrigatória; a
produção recusa arrancar com um `JWT_SECRET` de desenvolvimento (validado em
`core/config.ts`).

---

## A13. O CSV exportado tem BOM e neutraliza fórmulas

**Decisão.** A exportação CSV (§54) começa com BOM UTF-8, usa `;` como separador e vírgula
decimal, e prefixa com apóstrofo qualquer célula que comece por `=`, `+`, `-` ou `@`.

**Porquê o BOM.** Sem ele, o Excel em português mostra "CombustÃ­vel" em vez de
"Combustível". É um detalhe pequeno que decide se o utilizador considera a exportação
utilizável — e uma exportação que o utilizador não consegue abrir não cumpre o objetivo de
evitar o lock-in.

**Porquê a neutralização de fórmulas.** Uma despesa com a descrição `=HYPERLINK(...)`
transformar-se-ia numa fórmula executável na folha de cálculo de quem abrisse o ficheiro.
Uma exportação de dados do Zemlo não pode ser um vetor de ataque contra o próprio
utilizador.

**Porquê `;` e vírgula decimal.** É o que o Excel em português assume por omissão. Com `,`
como separador, cada linha vira uma única célula.

---

## A14. O veículo é identificado pela matrícula, não pelo VIN

**Decisão.** No onboarding só a matrícula é obrigatória (§5). O VIN é opcional e, quando
existe, é validado pelo dígito de controlo da ISO 3779.

**Porquê.** A matrícula é o identificador que o utilizador **conhece de cor** e encontra
num documento que tem à mão. O VIN está numa chapinha no para-brisas ou num documento
guardado numa pasta. Pedir o VIN no primeiro ecrã violaria o princípio de zero fricção
(§3.1) e o onboarding de três passos deixaria de existir.

**Consequência.** `normalizePlate` aceita a matrícula em qualquer forma que o utilizador a
escreva (`42-38-1EL`, `4238el`, `42 38 1E L`) e normaliza para uma forma canónica estável.
Não rejeita formatos desconhecidos: o Zemlo aceita dados atípicos sem os tratar como erro
(§49), e uma matrícula estrangeira não é um erro.

---

## A15. A depreciação é uma estimativa com premissas devolvidas ao utilizador

**Decisão.** `advancedStats` usa uma curva de depreciação decrescente (15% no primeiro
ano, 10% nos seguintes, piso de 15% do valor de compra) e **devolve a lista de premissas**
no campo `assumptions`. Sem preço de compra registado, devolve `null` em vez de estimar.

**Porquê.** O Zemlo não conhece o valor de mercado real do veículo. Apresentar uma
depreciação como se fosse um facto medido seria inventar informação — precisamente o que a
especificação proíbe (§48). Devolver as premissas permite ao utilizador decidir se confia
no número e perceber porque é que ele mudou.

**Porquê está colapsada na interface.** É uma estatística avançada e a especificação
insiste que se mantenha opcional (§23, §3.2). Quem só quer saber quanto gastou não deve
ser confrontado com um TCO.

---

## A16. Sem canal de push nem email no MVP

**Decisão.** O modelo `Notification` tem `channel`, as preferências têm frequência por
canal, e o MVP implementa apenas o canal `in_app`. As instruções geradas para o Home
Assistant dizem explicitamente que o broker MQTT não está configurado.

**Porquê.** Push exige uma aplicação mobile publicada; email exige um servidor SMTP. Nenhum
dos dois existe num ambiente de desenvolvimento, e o código **não finge** que os envia. Um
registo que diz "enviado por email" quando não houve email é pior do que não ter a
funcionalidade: o utilizador deixa de contar com o aviso e perde a inspeção.

---

## A17. Documentos: metadados sim, bytes não

**Decisão.** A API guarda nome, categoria, datas, validade e uma referência opaca
(`storageKey`) ao ficheiro. No MVP não serve os bytes.

**Porquê.** Servir ficheiros de uma API Node significa reimplementar, mais cedo ou mais
tarde, um servidor de ficheiros — intervalos de bytes, retoma de transferência, cache,
limites de largura de banda. O armazenamento de objetos já faz isso melhor. Além disso, um
documento do veículo pode ter dezenas de megabytes e passá-los pela API transforma cada
pedido numa operação com custo de banda.

**O que fica implementado e é testável agora.** O que o produto precisa primeiro: saber
que documento existe, de que veículo, e quando expira — que é o que alimenta o cartão de
estado, o calendário e o alerta de validade (§6, §7, §22).

---

## A18. Migração para agregados e frotas já preparada, mas não exposta

**Decisão.** Os modelos `Household`, `Organization`, `OrganizationMember` e
`HouseholdMember` existem no schema, e `Vehicle.householdId` existe. Nada disto é exposto
na API.

**Porquê.** A especificação pede explicitamente que a arquitetura suporte famílias e
frotas (§32) e igualmente explícito que estas funcionalidades **não** entram no MVP (§40).
Ter as tabelas preparadas evita a reconstrução estrutural que a especificação quer evitar
(§65) — a migração passa a ser uma alteração de autorização e interface, não de modelo de
dados.

**Porquê não expor.** Um modelo que existe mas não é usado não tem custo de manutenção;
um endpoint que existe mas não é usado tem custo de superfície de ataque.

---

## A19. O `.env` nunca sobrepõe o ambiente, e segredos de desenvolvimento são recusados em produção

**Decisão.** Três guardas que se reforçam:

1. `dotenv` é carregado com `override: false` — as variáveis reais do ambiente ganham
   sempre ao ficheiro `.env`.
2. O arranque é **recusado** se `NODE_ENV=production` e `JWT_SECRET` estiver em falta, for
   demasiado curto, ou corresponder ao segredo de desenvolvimento que vive no código.
3. O arranque é **recusado** se `NODE_ENV=production` e o `JWT_SECRET` começar por
   `dev-only-`, o prefixo dos segredos que vivem nos `.env` locais do repositório.

**Porquê — as duas primeiras versões desta configuração tinham um buraco.**

A primeira tinha `loadDotEnv({ path })`, que sobrepõe por omissão. Consequência: um
ficheiro `.env` de desenvolvimento presente no servidor sobrepunha `NODE_ENV=production`
injetado pelo orquestrador, o servidor arrancava em modo de desenvolvimento, e a validação
de produção — que existia e estava correta — nunca corria. Uma validação que não é
executada é indistinguível de uma validação ausente.

A segunda versão, com `override: false`, ainda aceitava um `JWT_SECRET` vindo do `.env` do
desenvolvimento: um valor de 70 caracteres, aparentemente forte, mas **publicado num
repositório Git**. Qualquer pessoa com acesso ao código poderia forjar tokens válidos
contra a instalação de produção. Daí o prefixo `dev-only-` obrigatório: torna o erro
detetável em vez de depender de o operador se lembrar de gerar um segredo novo.

**Como foi encontrado.** Não por inspeção de código: por `scripts/verify-config.ts`, que
testa doze cenários de configuração, incluindo arrancar em produção com o `.env` de
desenvolvimento presente. Uma guarda que nunca foi testada é uma intenção, não uma
proteção — e este é o segundo defeito real neste projeto encontrado exatamente por testar
o que parecia óbvio (ver A10).

---

## A20. Apagar uma despesa mantém o registo técnico; apagar o registo apaga a despesa

**Decisão.** A assimetria é deliberada:

- **Apagar um abastecimento, carregamento ou manutenção** apaga também a despesa que dele
  nasceu. Sem o registo, a despesa fica sem contexto: o utilizador veria "Combustível —
  85,00 €" sem nada que explique de onde veio.
- **Apagar a despesa** mantém o registo técnico e **limpa a referência inversa**
  (`expenseId = null`). O utilizador pediu para eliminar um custo, não 50 litros de
  combustível do histórico do veículo.

**Porquê a assimetria.** As duas entidades descrevem coisas diferentes: o registo descreve
*o que aconteceu ao veículo* (litros, odómetro, posto); a despesa descreve *o que saiu da
carteira* (valor, IVA, método de pagamento). Apagar a carteira não deve reescrever a
história do veículo. E as estatísticas de consumo e de utilização continuam corretas,
porque são calculadas a partir dos registos, não das despesas — só o total financeiro é
que muda, que é precisamente o que o utilizador pediu.

**O defeito que isto corrige.** A primeira versão apagava a despesa sem limpar a
referência: o abastecimento ficava com um `expenseId` a apontar para uma linha que já não
existia. Esse defeito **não produz erro nenhum no momento** — a resposta é `204 No
Content` e o utilizador vê o custo desaparecer como esperava. Só se manifesta quando algo
tenta seguir o identificador, possivelmente meses depois.

Foi encontrado por `scripts/check-integrity.mjs`, uma verificação que percorre todas as
relações à procura de referências penduradas, e que passou a fazer parte de
`npm run verify` — secção 0, antes de qualquer pedido HTTP. Existe também
`scripts/repair-dangling-expense-links.mjs` para reparar bases de dados criadas antes da
correção, porque um defeito corrigido no código não corrige os dados que já gravou.

---

## A21. As chaves estrangeiras opcionais são verificadas na aplicação

**Decisão.** Toda a referência que o cliente pode enviar — `documentId` num seguro, numa
inspeção ou num imposto; `linkedRecordId` numa despesa — é validada contra o `userId` do
pedido antes de ser gravada. Um identificador de outra conta devolve **404**, indistinguível
de inexistente.

**Porquê não é automático.** Estas relações são `String?` no schema, e não relações Prisma
com `@relation`. É deliberado: apagar um documento **não** deve apagar o seguro que o
referencia — o seguro é um dado com valor próprio, com data de início, fim e prémio que
sobrevivem ao desaparecimento do PDF. A contrapartida é que a base de dados não impõe a
integridade, e a verificação tem de ser explícita.

**O defeito que isto corrige.** Sem a verificação, a conta B podia criar um seguro seu com
o `documentId` de um documento da conta A, e um imposto ou uma inspeção da mesma forma.
O resultado é uma conta com uma referência a dados que não são seus — e como o
`documentId` é usado para navegação reversa, B obteria também um identificador para
construir pedidos posteriores.

Encontrado por auditoria manual direta, depois de as 217 verificações automáticas
existirem e passarem — o que é, por si, a lição: **cobertura não é o mesmo que correção**.
As verificações testavam exaustivamente os caminhos que alguém se lembrou de testar; a
injeção de chaves estrangeiras não era um deles.

**Detalhe de implementação que importa.** O `linkedRecordType` de uma despesa é **derivado**
do registo encontrado, e não aceite do pedido. Confiar num tipo enviado pelo cliente
permitiria que um tipo errado fizesse a navegação reversa apontar para o registo errado —
um defeito silencioso numa funcionalidade de conveniência.

A secção 16b de `npm run verify` cobre as quatro tentativas de injeção, para que o defeito
não possa voltar por um caminho novo.

---

## A22. As três guardas que impedem um único valor inválido de inutilizar uma conta

Registado como decisão porque é um padrão, não três correções isoladas. Três defeitos
distintos — encontrados por uma revisão adversarial depois de as 223 verificações
automáticas passarem — partilhavam a mesma forma: **um valor inválido a entrar, e a
aplicação inteira a deixar de funcionar por causa dele.**

### 1. Um fuso horário inválido inutilizava a conta para sempre (P1)

`PATCH /me {"timeZone": "Not/AZone"}` devolvia 200. A partir daí, `/dashboard`, `/stats`,
`/calendar`, `/reminders`, `/documents/expiring`, `/records/insurance` e a criação de
registos respondiam todos **500** — porque todos calculam "hoje", e `Intl.DateTimeFormat`
lança `RangeError` com um fuso que não conhece. Sair e voltar a entrar não resolvia: o
valor estava na base de dados, e até o pedido que o corrigiria precisava de "hoje".

Duas correções, porque uma só não bastava: o esquema valida o fuso **de facto** (pedindo ao
motor que o use, não com uma lista de fusos que ficaria desatualizada), e `todayIn` cai
para `Europe/Lisbon` em vez de lançar. A segunda é a que trata das bases de dados que já
têm um valor inválido — a validação de entrada nunca corrige dados que já lá estão.

### 2. Valores monetários negativos deflacionavam todos os totais (P2)

`amountCents: -100000000` era aceite em despesas, abastecimentos e impostos. Medido: o
custo por km passava a `-100066` cêntimos e a categoria "Combustível" a `-80000`. Um sinal
menos a mais — erro de digitação, importação, cliente que soma reembolsos no mesmo campo —
e o utilizador decide compras e orçamentos sobre números errados, sem nada no ecrã que o
denuncie.

### 3. Datas impossíveis moviam prazos legais em silêncio (P3)

`2026-02-30` era aceite com `201 Created` e gravado como `2026-03-02`. Sem erro, sem aviso:
o utilizador só descobria se reparasse que a data guardada não era a que escreveu. E datas
como `2026-13-01` produziam um `Invalid Date` que chegava ao Prisma e devolvia 500.

**O padrão, e o que se aprendeu.** Nos três casos, a validação existia na forma mas não na
substância: o fuso era validado por comprimento, o dinheiro por intervalo, a data por
expressão regular. Validar a *forma* de um valor é fácil e dá a sensação de segurança;
validar o seu *significado* exige perguntar "o que é que este valor faz ao sistema?".

Os três passaram por 223 verificações automáticas, 63 testes unitários e 12 verificações de
configuração. A cobertura testava exaustivamente os caminhos que alguém se lembrou de
testar; estes eram os que ninguém tinha tentado. `verify-regressions.ts` fixa agora cada um
deles, incluindo o caso que mais importa: **um fuso inválido já gravado não pode rebentar**.

Da mesma revisão resultaram ainda oito correções menores, todas com regressão fixada: o
guarda de plausibilidade da quilometragem deixou de ser contornável ao registar uma despesa
ou uma inspeção; um lembrete repetível deixou de se poder duplicar por dupla conclusão; o
calendário de um veículo deixou de mostrar documentos de outro; a contagem de uma lista
filtrada deixou de ignorar os filtros; o VIN passou a ser validado na forma; "hoje" deixou
de ser o dia do servidor em `vehicles.ts`; um corpo não-JSON deixou de ser reportado como
"campos obrigatórios"; e a comparação entre períodos deixou de opor janelas de durações
diferentes.

---

## A23. O token de renovação é devolvido **e** rodado

**Decisão.** `POST /auth/login`, `/auth/signup` e `/auth/refresh` devolvem
`tokens.refreshToken`. Em cada renovação, o token usado é substituído por um novo e o
anterior deixa de funcionar.

**Os dois defeitos que isto corrige, e porque é que o segundo só apareceu ao escrever o
teste do primeiro.**

O primeiro era direto: `buildSessionResponse` não devolvia o `refreshToken`, mas
`POST /auth/refresh` exigia-o no corpo. O endpoint era **inutilizável** — o servidor pedia
um valor que nunca comunicava. Consequência para o utilizador: todas as sessões terminavam
ao fim de uma hora (a validade do token de acesso), apesar dos 90 dias configurados. Numa
aplicação mobile-first isso é a diferença entre "entro e fico dentro" e "autentico-me
várias vezes por dia".

Foi encontrado pela aplicação web, não por um teste da API: o cliente implementou a
renovação silenciosa por contrato, verificou contra o servidor, e não recebeu o token.
Nenhuma das 223 verificações automáticas da altura tocava no fluxo de renovação — testavam
o login e o `401`, não o caminho entre os dois.

O segundo apareceu ao escrever a verificação do primeiro. A primeira versão do teste
comparava os tokens de **acesso** antes e depois de renovar, e falhou: o JWT é idêntico,
porque o payload e o segundo de emissão são os mesmos. Isso levou a olhar para o que a
renovação devolvia e a perceber que reutilizava o mesmo `refreshToken` indefinidamente.

**Porquê a rotação importa.** Um refresh token vale 90 dias e é o segredo mais valioso que
um cliente guarda. Sem rotação, um token copiado — de uma cópia de segurança do
dispositivo, de um `localStorage` exposto, de um log — dá acesso à conta durante três meses
sem que nada o denuncie. Com rotação, um token roubado funciona no máximo uma vez, e a
partir daí o atacante e o utilizador estão em colisão: um dos dois vê a sessão terminar, o
que é exatamente o sinal que se quer.

A sessão é a mesma em cada renovação — o mesmo `id`, o mesmo dispositivo na lista de
Definições → Segurança. Rodar o token não deve fazer aparecer um dispositivo novo a cada
hora.

**Lição de método.** O teste que encontrou o segundo defeito foi escrito para verificar o
primeiro, e falhou por uma razão que não era a esperada. Vale a pena resistir à tentação de
"corrigir o teste": o falhanço apontava para uma decisão de desenho que ainda não tinha
sido tomada.

---

## A24. A autenticação é aplicada por rota exata, não por router

**Decisão.** Cada router declara a lista de rotas que serve e aplica `requireAuth()` apenas
quando o caminho do pedido corresponde exatamente a uma delas. Um endereço inexistente
responde **404**, com ou sem token; um endereço existente sem autenticação responde 401.

**Porque não `router.use(requireAuth())`.** Corre para **qualquer** pedido que chegue ao
router, mesmo sem correspondência. Um pedido a `/api/v1/nao-existe` recebia 401, e quem
integra a API ficava a procurar o problema na autenticação quando o problema era o
endereço.

**Duas tentativas falhadas, ambas registadas porque as armadilhas são reais.**

1. **`use(['/vehicles'], requireAuth())`** — parecia a solução idiomática. Não é: o Express
   monta o middleware com esses caminhos como prefixos de montagem e **retira o prefixo** de
   `request.url` antes de o chamar. Como `requireAuth` responde sempre, o pedido nunca
   chegava à rota: `/api/v1/vehicles` passou a devolver 404.

2. **Perguntar ao router quais as rotas que tem**, chamando `router.handle(...)` e
   inspecionando `request.route`. Provoca **recursão infinita**: a guarda está montada no
   próprio router que se está a invocar. O servidor respondia 500 com
   `Maximum call stack size exceeded` — um defeito muito pior do que aquele que se estava a
   corrigir.

A solução correta era a mais simples das três. Foi preciso ler
`node_modules/express/lib/router/index.js` para perceber porque é que as duas primeiras não
funcionavam; a documentação não o explica.

**Um gerador de código também tem de ser depurado.** As guardas foram escritas por um
script, e o script construía o código dentro de um template literal que continha **outro**
template literal — as crases internas terminaram o exterior e deixaram os ficheiros com
sintaxe inválida, incluindo uma expressão regular que engolia o resto do ficheiro como
comentário. A versão final não usa crases nessa construção. Gerar código é escrever código:
a mesma atenção, os mesmos testes.

**Consequência para os testes.** `verify-integration.mjs` verifica as três situações —
endereço inexistente com e sem token, e endereço existente sem token — porque foi
exatamente aqui que a regra se partiu duas vezes.
