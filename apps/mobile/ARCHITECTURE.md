# Arquitetura do `apps/mobile` — cliente do contrato partilhado

> `MOB-001` · A3 · 2026-09-22. Esta tarefa decide e escreve a arquitetura **antes** de existir
> um único ecrã. Os ecrãs são `MOB-003` em diante.

## 1. O problema, dito sem rodeios

O contrato do Zemlo vive em `packages/shared` — TypeScript. A regra do projeto (§6) é «não
duplicar contratos» e o `MOB-001` diz «**nenhum contrato paralelo**». Em TypeScript isso
resolve-se com um `import`. **Em Dart não há forma de importar TypeScript.** São linguagens
diferentes, com tempos de execução diferentes.

Há, por isso, duas respostas possíveis e só uma é aceitável:

| Resposta | O que acontece na prática |
| -------- | ------------------------- |
| Escrever os modelos Dart à mão | Duas definições de «despesa». Divergem na primeira alteração, e ninguém sabe qual está certa. **Rejeitada.** |
| **Gerar o lado Dart a partir da fonte única** | Uma só definição. A divergência é **detetada** por uma verificação executável. **Adotada.** |

## 2. As duas metades do contrato, e como cada uma chega ao Dart

O contrato não é homogéneo. Tem duas metades com naturezas diferentes, e o gerador trata-as
de forma diferente porque **têm** de ser tratadas de forma diferente:

| Metade | Onde vive | Como se lê | Porquê |
| ------ | --------- | ---------- | ------ |
| **Respostas** (o que a API devolve) | `types.ts` — `interface`/`type` | API do compilador TypeScript | São tipos **apagados** em tempo de execução: nenhum `Object.keys` os vê. Só o AST os conhece. |
| **Pedidos, conjuntos fechados e rótulos** | `contracts.ts`, `registry.ts` — esquemas **Zod** e arrays | Introspeção do `dist/` compilado | São **valores reais**. O `dist/` é o mesmo artefacto que a API e a web consomem — não é uma segunda leitura do `src/`. |

Consequência prática, e é a decisão central desta arquitetura:

> **Nada no Dart é escrito à mão a partir do contrato.**
> `apps/mobile/lib/contract/generated/` é gerado. Editar à mão é apagado na geração seguinte
> e faz a verificação falhar.

### O que é gerado (números medidos, não estimados)

| Ficheiro | Conteúdo | Quantidade |
| -------- | -------- | ---------- |
| `contract_enums.dart` | conjuntos fechados com `wire` + `fromWire` | **15** enums |
| `contract_models.dart` | modelos com `fromJson`/`toJson` | **11** modelos |
| `contract_registry.dart` | rótulos em português, ícones e ordem | **20** tabelas |
| `contract_constants.dart` | `kApiVersion`, `kApiBasePath`, `kPlatformVersion` | 3 constantes |
| `contract-manifest.json` | a superfície gerada, para verificação e revisão | — |

**Porque é que os rótulos também são gerados.** `EXPENSE_CATEGORIES` não é uma lista de
códigos: cada entrada traz `{ code, label, icon, order }` — «Combustível» com ⛽, por esta
ordem. É apresentação, e vive no contrato de propósito, para a web e o mobile dizerem a mesma
palavra sobre a mesma coisa. Se o mobile escrevesse estes rótulos à mão, os dois produtos
divergiriam na primeira alteração de texto — e ninguém daria por isso até um utilizador ver
palavras diferentes na web e no telemóvel.

### O que **não** é gerado, e a regra que o substitui

`packages/shared` também contém **comportamento**: `averageChargingPowerKw`, `daysBetween`,
`categoryLabel`, `cvToKw`, `civilDateToUtc`, formatação de dinheiro e de datas. Estas funções
**não** são portadas para Dart, e não devem ser portadas à mão.

> **Regra: o servidor calcula, o cliente mostra.**

Onde o cliente precise mesmo de calcular (formatação de um valor já calculado, por exemplo),
a regra é usar o valor que a API já devolve — a API calcula as derivadas (o consumo, os
totais, a depreciação) e o cliente não as reconstrói. Uma segunda implementação do mesmo
cálculo é uma segunda fonte de verdade, e a primeira divergência seria silenciosa.

Se um dia for inevitável calcular no cliente, o mecanismo é o dos **vetores de teste**: um
script gera casos a partir da implementação TypeScript, o Dart tem de os reproduzir, e a
divergência faz o teste falhar. Não é necessário nesta tarefa; fica dito para não ser
inventado de forma ad-hoc mais tarde.

## 3. Camadas

```
apps/mobile/lib/
├── contract/
│   ├── generated/            # GERADO — não editar
│   │   ├── contract_enums.dart
│   │   ├── contract_models.dart
│   │   ├── contract_registry.dart
│   │   └── contract_constants.dart
│   └── (nada escrito à mão)
├── api/
│   ├── api_error.dart        # §A11 — o envelope único, traduzido uma só vez
│   ├── token_store.dart      # onde vivem os tokens (decisão da §5)
│   ├── api_client.dart       # a única porta de saída; §A23 — renovação
│   └── auth_api.dart         # login, registo, saída, perfil
└── (features/ e app/ chegam com MOB-003+)
```

Regra de dependências, para não haver atalhos: **`features/` → `api/` → `contract/`**. Um ecrã
nunca fala com a rede diretamente e nunca lê um token. É a mesma separação que a web já usa
(`apps/web/src/api/client.ts` é o único ponto de saída), pela mesma razão: o envelope de erro
e a política de 401 têm de viver num só sítio.

## 4. O cliente HTTP — semântica, não código

O cliente do mobile **espelha a semântica** de `apps/web/src/api/client.ts`, não o código. O
que tem de ser idêntico é o comportamento observável, porque é isso que o contrato fixa:

1. **Envelope único (§A11).** `{ error: { code, message, fields?, requestId } }` traduzido num
   `ApiError` tipado. Código e mensagem de recurso quando a resposta não tem envelope legível
   (um 502 em HTML, por exemplo). `requestId` cai para o cabeçalho `X-Request-Id`.
2. **Renovação silenciosa (§A23), uma só vez por rajada.** Um 401 dispara **uma** renovação e
   o pedido é repetido **uma** vez. Repetir indefinidamente transformaria um erro de
   configuração do servidor num ciclo de pedidos.
3. **Uma só renovação em voo.** Guarda-se a *promessa*, não um booleano. **Não é uma
   otimização: é uma condição de correção.** Como a API **roda** o token de renovação em cada
   renovação, dez renovações concorrentes invalidar-se-iam umas às outras e o utilizador seria
   expulso sem motivo.
4. **Erro de rede distinto.** Uma falha de rede não é um erro da API: a ação do utilizador é
   diferente, e uma falha de rede **não** deve desencadear uma renovação — não há nada a
   renovar quando não se falou com o servidor.
5. **Sem corpo não é erro.** `204` e corpos vazios devolvem `null`, e não uma exceção de JSON.

### O defeito que a web tem e o mobile não pode repetir

`apps/web/src/api/client.ts` lê o token de renovação de um campo de **topo**
(`session.refreshToken`) que **não existe** nem na resposta da API nem no contrato. O contrato
declara-o **dentro** de `tokens` (`AuthTokens.refreshToken`, `packages/shared/src/types.ts`), e
é aí que a API o devolve. Consequência: a web nunca guarda o token, e a renovação silenciosa
falha sempre. Está medido com três testes que ficam vermelhos (proposta `WEB-013` ao A9).

No mobile o erro é **impossível de escrever sem o compilador se queixar**: `session.tokens`
é do tipo gerado `AuthTokens`, que tem `refreshToken` como campo obrigatório. Não existe
`session.refreshToken` para ler. É a vantagem concreta de gerar em vez de escrever à mão — a
mesma que a web não tem.

## 5. Onde vivem os tokens — a decisão que **não** é a da web

| Token | Onde | Porquê |
| ----- | ---- | ------ |
| Acesso (1 h) | **só em memória** | Não vai a disco: ao fim de uma hora não vale nada e a aplicação pode pedir outro. Guardá-lo só acrescenta exposição. |
| Renovação (90 dias) | **armazenamento seguro do sistema** (Keychain / Keystore) | É o segredo mais valioso que o cliente guarda (§A23). Em `SharedPreferences` seria legível por qualquer processo com acesso ao sistema de ficheiros — e em dispositivos com *root*/jailbreak, por qualquer aplicação. |

A web usa `localStorage` com o compromisso de XSS documentado e aceite. **O mobile não herda
essa decisão:** não há XSS num cliente nativo, e há um mecanismo melhor disponível. Copiar a
decisão da web seria copiar o compromisso sem a razão que o justificava.

`TokenStore.save()` grava o par completo de uma vez, de propósito: se a memória ficasse com o
token novo e o armazenamento com o antigo, a renovação seguinte falharia sem motivo visível —
porque o token antigo já foi rodado e já não vale.

## 6. Como a sincronia do contrato é garantida

```bash
node apps/mobile/contract/generate.mjs   # gera (escreve)
node apps/mobile/contract/verify.mjs     # verifica (não escreve) — exit 1 em deriva
```

`verify.mjs` prova três coisas:

1. **O contrato não mudou por baixo do Dart** — regenera e compara. Alguém muda
   `packages/shared`, o CI fica vermelho, e a mensagem diz que ficheiros regenerar.
2. **O manifesto e o Dart não se separaram** — cada modelo, enum e tabela do manifesto tem de
   existir no Dart. Apanha um bug do próprio gerador.
3. **Nenhum tipo consumido desapareceu** — cada raiz declarada em `CONSUMED` resolve-se.

Tem ainda **pisos mínimos** (8 modelos, 10 enums, 15 tabelas): sem eles, um manifesto vazio
passaria todas as verificações por vacuidade — o falso verde clássico.

### O que a verificação **não** prova

**Não compila o Dart.** Flutter e Dart não estão instalados no ambiente onde isto foi
construído. O que se prova é que o Dart **corresponde ao contrato**; não que ele compila. Isso
exige `flutter analyze` e `flutter test`, que correm onde houver SDK. É por isso que a
verificação existe em Node: para haver **alguma** verificação executável onde o SDK não está.
Esta limitação está escrita aqui e no cabeçalho do `verify.mjs`, e não deve ser lida como
«verificado» por quem vier depois.

## 7. Fragilidades do contrato, medidas

O gerador mede-as e escreve-as no manifesto, em `knownWeaknesses`. Um manifesto que só lista o
que corre bem esconde o que interessa:

- **19 de 19** aliases `CodeOf<…>` de `registry.ts` resolvem para **`string`**, não para uma
  união de literais. Causa: `freeze<T extends readonly OptionMeta[]>(items: T): T` com
  `OptionMeta.code: string`, o que alarga os códigos literais.
  **Consequência:** o lado TypeScript do contrato **não** fecha estes conjuntos — só o esquema
  Zod os fecha, em tempo de execução. Um cliente TypeScript pode escrever
  `vehicleType: 'banana'` e o `tsc` aceita.
  **No mobile:** `VehicleSummary.vehicleType` e `.fuelType` são `String` no Dart, porque é
  isso que o contrato diz. O enum existe (`VehicleType.fromWire`) para quem quiser validar na
  fronteira, mas o modelo é fiel ao contrato — e **tem** de ser: um gerador que «melhorasse» o
  contrato esconderia a diferença em vez de a mostrar.
- Está proposto ao A9, como tarefa própria, reforçar o contrato. **Não foi feito nesta
  tarefa**: é alteração a `packages/shared` e exige decisão sobre o impacto em API, Web e
  Mobile.

## 8. Como se acrescenta um tipo ou um endpoint

1. Muda-se `packages/shared` (é a fonte única).
2. Se for um tipo novo que o mobile consome, acrescenta-se o nome a `CONSUMED` no
   `generate.mjs`. **Não** se escreve um modelo Dart.
3. `node apps/mobile/contract/generate.mjs` e revê-se o `git diff` do gerado.
4. `node apps/mobile/contract/verify.mjs` tem de passar.

Se o passo 2 for esquecido, o tipo não existe em Dart e o código não compila — erro
barulhento, que é o que se quer. Um `Map<String, dynamic>` a circular em silêncio é o que se
evita.

## 9. O que fica para as tarefas seguintes

| Tarefa | O que acrescenta |
| ------ | ---------------- |
| `MOB-007` | **Gate do ambiente Flutter — aceite pelo utilizador, aguarda consolidação no ROADMAP por A9.** Correr, por esta ordem, `flutter pub get` (resolve o `pubspec.yaml`, que nunca foi resolvido), `flutter analyze` e `flutter test`; confirmar **especificamente** a API de `flutter_secure_storage` usada em `lib/api/token_store.dart` e a resolução do `pubspec.yaml`. Sem ele o código deste pacote **corresponde** ao contrato mas **nunca foi compilado** — e **`MOB-002` não deve ser considerado operacionalmente concluído enquanto `MOB-007` não passar**. Esta limitação **não** exige reabrir `MOB-001`. |
| `MOB-002` | ecrã de início de sessão, 2FA, TOTP revelado no 401, integração com `AuthApi` |
| `MOB-003` | onboarding e criação de veículo |
| `MOB-004`–`MOB-006` | registos, painel, notificações |
| CI | ligar `verify.mjs` ao `npm run verify` / ao CI (`OPS-001`, de A1) — **proposto, não feito**, para não mexer num ficheiro partilhado |
