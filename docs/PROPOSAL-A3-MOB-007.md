# Proposta de A3 a A9 — `MOB-007` · o gate do ambiente Flutter **não passou** (não pôde correr)

**Agente:** A3 (Web e Mobile) · **Data:** 2026-09-22 · **Tarefa:** `MOB-007`
**Veredicto: a cadeia `pub get → analyze → test` NÃO PASSOU — não chegou a começar.** `flutter` e
`dart` não existem nesta máquina.
**`docs/ROADMAP.md` não foi tocado por A3.** Os blocos a integrar estão em §8, para A9 aplicar.
**Sem commit, sem push, sem deploy. `packages/shared` não foi alterado.**

---

## 1. Conclusão objetiva

| Passo | Comando | Exit code | Resultado |
| ----- | ------- | --------- | --------- |
| — | `flutter --version` | **127** | `flutter: command not found` |
| — | `dart --version` | **127** | `dart: command not found` |
| 1 | `flutter pub get` | **127** | não executado — o binário não existe |
| 2 | `flutter analyze` | **127** | não executado — pré-requisito (1) não satisfeito |
| 3 | `flutter test` | **127** | não executado — pré-requisito (2) não satisfeito |

- **Versão de Flutter:** **não disponível** — não há Flutter instalado. Não há versão a registar.
- **Versão de Dart:** **não disponível** — idem.
- **Testes realmente executados: 0.** Nenhum. Não há contagem a reportar porque nada correu.

Pela regra fixada — *«se `flutter pub get` falhar, para aí»* — **parei no passo 1**. Os passos 2 e 3
não foram tentados como se pudessem dar resultado: executá-los seria reportar três falhas do mesmo
binário ausente como se fossem três verificações.

---

## 2. Prova da ausência (medida, não assumida)

| Verificação | Comando | Resultado |
| ----------- | ------- | --------- |
| PATH | `command -v flutter`, `command -v dart`, `fvm`, `melos` | **os quatro ausentes** |
| Resolução do shell | `where flutter` / `where dart` | não encontrados |
| Caminhos habituais de instalação | `C:\flutter`, `C:\src\flutter`, `C:\tools\flutter`, `C:\dev\flutter`, `%LOCALAPPDATA%\flutter`, `%USERPROFILE%\flutter`, `%USERPROFILE%\fvm`, `C:\Program Files\flutter`, `C:\Program Files (x86)\flutter`, scoop, chocolatey | **todos ausentes** |
| Cache de pacotes Dart | `%LOCALAPPDATA%\Pub\Cache`, `%APPDATA%\Pub\Cache`, `%USERPROFILE%\.pub-cache` | **todos ausentes** — nenhum `pub` correu alguma vez aqui |
| Binários geridos pela aplicação | `%USERPROFILE%\.workbuddy-ai\binaries` | só `PortableGit`, `node`, `python` |
| Gestores de pacotes | `winget`, `choco`, `scoop` | `winget` **existe**; `choco` e `scoop` ausentes |

**É ambiente, não implementação.** Nada foi lido do código Dart para concluir isto: a falha é a
inexistência do binário, anterior a qualquer linha do projeto. Distinção exigida, e é a primeira.

---

## 3. O que **foi** possível validar sem Flutter

Não me limito a reportar a ausência: dois dos cinco critérios do gate **são verificáveis** sem
compilador, e verificá-los agora reduz o que sobra para o dia em que o Flutter chegar. O que se segue
é verificação contra **documentação publicada**, não compilação — e está rotulado como tal.

### 3.1 Critério 6 — o contrato não regrediu: **PASSou**

```
node apps/mobile/contract/verify.mjs → exit 0
  11 modelos · 15 enums · 20 tabelas de registo
  7 raízes consumidas, todas resolvidas: ApiErrorBody, ApiErrorCode, AuthTokens,
  AuthSessionResponse, UserProfile, Page, VehicleSummary
```

Critério satisfeito e independente do Flutter (corre em Node).

### 3.2 Critério 4 — a API de `flutter_secure_storage`: **verificada contra a versão publicada**

A superfície que `lib/api/token_store.dart` usa é de quatro membros. Comparada com a API publicada de
**`flutter_secure_storage` 9.2.4** (a versão que `^9.2.2` resolve):

| Uso em `token_store.dart` | API publicada de 9.2.4 | Veredicto |
| ------------------------- | ---------------------- | --------- |
| `const FlutterSecureStorage()` | `const FlutterSecureStorage({IOSOptions iOptions = …, AndroidOptions aOptions = …, …})` — const, todos os parâmetros opcionais | **correto** |
| `_storage.read(key: …)` | `read({required String key, …}) → Future<String?>` | **correto** — o tipo de retorno coincide |
| `_storage.write(key: …, value: …)` | `write({required String key, required String? value, …}) → Future<void>` | **correto** — `value` é `String?` |
| `_storage.delete(key: …)` | `delete({required String key, …}) → Future<void>` | **correto** |

**Nenhum nome errado.** Era o risco que o critério 4 apontava como o mais provável («é o ficheiro com
maior probabilidade de ter um nome errado, por ter sido escrito sem compilador à frente») — e é o
risco que **não** se materializou. Isto **não** substitui `flutter analyze`: confirma os nomes e as
assinaturas contra a documentação, não que o ficheiro compila.

**`http` — a superfície usada existe.** `lib/api/api_client.dart` usa `http.Client()`,
`http.Request(method, uri)`, `_http.send(request)`, `http.Response.fromStream(streamed)`,
`http.ClientException`, `http.Response` e `_http.close()`. Confirmado na API publicada do
**`http` 1.6.0** (a versão que `^1.2.0` resolve): `Request(String method, Uri url)`,
`Request.body`, `Request.headers` (Map mutável) e `BaseRequest.send() → Future<StreamedResponse>`
existem com essas formas. `Response.fromStream` e `Client.close` **não** foram confirmados linha a
linha — as classes existem, os membros não foram abertos um a um.

### 3.3 Critério 5 — a resolução do `pubspec.yaml`: **coerente, mas não resolvida**

`pubspec.lock` **não existe** — nenhum `pub get` correu nesta pasta. As versões declaradas, confrontadas
com o que o pub.dev publica:

| Declarado | Resolveria para | `environment` do pacote | Coerente com `sdk: '>=3.4.0 <4.0.0'`? |
| --------- | --------------- | ----------------------- | ------------------------------------- |
| `http: ^1.2.0` | **1.6.0** (2025-11-10) | `^3.4.0` | **sim** — exatamente o mesmo piso |
| `flutter_secure_storage: ^9.2.2` | **9.2.4** (2025-01-09) | `>=2.12.0 <4.0.0` | **sim** |
| `flutter_lints: ^4.0.0` | **4.0.0** (2024-05-09) | `^3.1.0` | **sim** |

**Nenhuma versão declarada precisa de ser mudada** — as três existem, satisfazem as restrições e são
compatíveis com o piso de SDK. A linha `flutter: '>=3.22.0'` do `environment` corresponde ao Dart 3.4.0,
que é o piso declarado. **O que continua por provar:** uma resolução real também resolve dependências
**transitivas**, e um conflito transitivo só o `pub get` o encontra. Este quadro diz que as diretas
existem e são coerentes; **não** diz que a resolução passa.

### 3.4 `analysis_options.yaml` — as duas regras estritas e o código gerado

O `analysis_options.yaml` liga `strict-casts: true` e `strict-raw-types: true`, que são as duas regras
com maior probabilidade de produzir `info`/`warning` em código gerado. Medido sobre os ficheiros
gerados:

| Medida | Valor |
| ------ | ----- |
| Conversões explícitas (` as `) | **60** em `contract_models.dart` |
| `dynamic` | **40**, todas dentro de `Map<String, dynamic>` |
| Tipos genéricos crus (`Map`/`List` sem parâmetros) | **0** |

O gerador emite **conversões explícitas** e **nenhum tipo cru** — que é precisamente o que as duas
regras exigem. É uma redução de um risco concreto, **não** um resultado de `flutter analyze`.

### 3.5 O que continua por provar (não inventado, não arredondado)

1. Que o `apps/mobile` **compila**. Nem um ficheiro Dart foi compilado.
2. Que o `flutter test` passa — incluindo `test/contract_test.dart`, que declara **7** `test(` (contados
   por `grep -c`, não afirmados) e **nunca correu**.
3. Que a resolução transitiva de dependências fecha.
4. Que `flutter analyze` sai limpo, incluindo `strict-casts`/`strict-raw-types` no código escrito à mão
   (o gerado foi medido em §3.4; o escrito à mão não).
5. Que o `pubspec.lock` resultante é versionado ou ignorado — não existe, logo não há decisão tomada.

---

## 4. Achados para A9 — propostos, **não** tratados

### 4.1 `AndroidOptions.encryptedSharedPreferences` fica a `false` por omissão

**O que se mediu.** `FlutterSecureStorage()` usa `aOptions = AndroidOptions.defaultOptions`, e em 9.2.4
o construtor é:

```dart
const AndroidOptions({
  bool encryptedSharedPreferences = false,
  bool resetOnError = false,
  KeyCipherAlgorithm keyCipherAlgorithm = KeyCipherAlgorithm.RSA_ECB_PKCS1Padding,
  StorageCipherAlgorithm storageCipherAlgorithm = StorageCipherAlgorithm.AES_CBC_PKCS7Padding,
  String? sharedPreferencesName,
  String? preferencesKeyPrefix,
})
```

Ou seja: em Android, o cliente está a usar a implementação **legada** do plugin (chave no KeyStore a
envolver um AES), e **não** o `EncryptedSharedPreferences` do Jetpack Security, que é o caminho
recomendado na linha 9.x.

**Proporção — o que isto é e o que não é.** **Não** é uma vulnerabilidade nem um valor em claro: a
implementação legada também cifra, com chave no KeyStore. É um **default antigo a precisar de decisão
explícita** para o segredo mais valioso do cliente (o token de renovação, 90 dias, §A23) — e é
exatamente o que o critério 4 pede para confirmar («opções (`AndroidOptions`/`IOSOptions`)»).

**Porque não o corrigi.** É uma decisão de segurança, não um nome errado; e uma alteração que eu não
consigo compilar, num ficheiro cuja característica é ter sido escrito sem compilador, somaria risco sem
prova. Fica proposta, com a alteração exata:

```dart
// lib/api/token_store.dart, no construtor de SecureTokenStore
SecureTokenStore({FlutterSecureStorage? storage})
    : _storage = storage ??
          const FlutterSecureStorage(
            aOptions: AndroidOptions(encryptedSharedPreferences: true),
          );
```

Os tipos conferem contra a API publicada (`aOptions` é `AndroidOptions`, o construtor é `const` e
`encryptedSharedPreferences` é um `bool` nomeado). **Consequência a declarar:** mudar o backend de
armazenamento torna ilegíveis os valores gravados pelo anterior. Como nenhuma versão da app foi
publicada e nenhum token real foi gravado, não há migração a fazer — mas a decisão tem de ser tomada
**antes** de o primeiro token real ser guardado, ou seja, antes de `MOB-002` ser dada como pronta.

**iOS — os defaults são adequados, e por isso não há nada a propor.** `IOSOptions` em 9.2.4 tem
`accessibility = KeychainAccessibility.unlocked` e `synchronizable = false`. `unlocked` significa que o
item só é legível com o dispositivo desbloqueado — correto para uma sessão; e `synchronizable: false`
mantém o token **fora** do iCloud Keychain, que é o que se quer, porque a sessão é por dispositivo e
sincronizá-la entre dispositivos seria errado.

**Ação pedida a A9:** alocar um `PC-*` (ou uma tarefa, se preferires tratá-lo como trabalho) — o ID é
teu para atribuir, não o invento.

### 4.2 `flutter_lints` fixado numa major de 2024 — coerente, mas a envelhecer

`^4.0.0` resolve para 4.0.0 (2024-05-09). Existem 5.0.0 (exige Dart `^3.5.0`) e 6.0.0 (exige `^3.8.0`).
O pin é **coerente** com o piso declarado `sdk: '>=3.4.0'` — subir para 5.0.0 obrigaria a subir o piso
para 3.5.0. Não é defeito; é uma escolha que fica registada, e que faz parte da decisão de ambiente
(§6): a versão de Flutter instalada determina que Dart existe, e o piso de SDK do projeto deveria
acompanhá-la.

### 4.3 O harness de verificação não é apagado pelo `pub get`

`lib/contract/generated/**` está excluído do `analyzer` (correto: é gerado), mas **não** está excluído
de `pub` nem de `flutter test`. Não é problema; fica registado para não ser tomado por engano quando os
números do `analyze` aparecerem.

---

## 5. O que **não** fiz

- **Não reabri `MOB-001`.** A arquitetura e o mecanismo de geração não estão em causa: o que falta é o
  ambiente onde os validar, como já ficou fixado ao aceitar `MOB-007`. Nada do que medi aponta para um
  defeito de desenho.
- **Não alterei `packages/shared`.** Não era preciso nem foi tentado.
- **Não inventei resultados.** Não há versão de Flutter a registar porque não há Flutter; não há
  contagem de testes porque nenhum correu; não há `pubspec.lock` porque nenhuma resolução aconteceu.
- **Não editei o ROADMAP**, nem `PC-*`, nem trabalho de A1/A2/A4.
- **Não instalei o Flutter.** É uma alteração de ambiente fora do repositório (descarga de ~1 GB, mais
  a descarga do SDK de Dart no primeiro arranque, e alteração do `PATH`), e a escolha de versão e canal
  é uma decisão tua. Ver §6.

---

## 6. Decisão que o utilizador tem de tomar (o desbloqueio do gate)

Sem Flutter, `MOB-007` **nunca** passa, e `MOB-002` fica permanentemente impedida de ser considerada
operacionalmente concluída. O gate é útil assim: está a dizer a verdade.

`winget` existe nesta máquina. Opções, com o que cada uma implica:

| Opção | O que implica |
| ----- | ------------- |
| **A — instalar o Flutter nesta máquina** (`winget install Flutter.Flutter`, ou o SDK oficial) | ~1 GB + SDK de Dart no primeiro arranque; altera o `PATH`; escolher canal/versão. Depois disso `MOB-007` volta a ser executável **por mim**, na ordem fixada |
| **B — validar noutra máquina ou em CI** | Não toca neste ambiente; exige que o `apps/mobile` seja levado para lá. É o caminho que o projeto já usa para outras frentes |
| **C — adiar** | `MOB-002` pode ser **escrita** (é o que já está decidido), mas não pode ser dada como pronta. O gate fica `BLOCKED` e o registo fica honesto |

A minha recomendação é **A ou B**, e não C: sem o gate, tudo o que for construído em `MOB-002` herda a
mesma incerteza — código Dart que corresponde ao contrato e nunca foi compilado. **Não decido isto por
ti**, e não avanço para `MOB-002` sem autorização.

---

## 7. Verificação das afirmações

| Afirmação | Como foi verificada |
| --------- | ------------------- |
| «exit 127 nos cinco comandos» | cada comando corrido individualmente, `echo "… → exit=$?"` imediatamente a seguir |
| «os quatro caminhos de PATH estão ausentes» | `command -v` por comando, e `where` |
| «nenhum SDK nos caminhos habituais» | 14 caminhos testados um a um, todos `ausente` |
| «nenhum `pub` correu aqui» | os três caches de pacotes Dart ausentes; `pubspec.lock` inexistente |
| «a API do plugin está correta» | quatro membros confrontados com a API publicada de 9.2.4 |
| «os defaults do Android» | construtor de `AndroidOptions` de 9.2.4, com `encryptedSharedPreferences = false` |
| «os defaults do iOS são adequados» | construtor de `IOSOptions` de 9.2.4: `unlocked` e `synchronizable = false` |
| «as versões declaradas existem e são coerentes» | três pacotes consultados no pub.dev, com o `environment` de cada versão resolvida |
| «0 tipos genéricos crus no gerado» | `grep` sobre `contract_models.dart` a excluir `Map<` e `List<` → vazio |
| «7 testes declarados no Dart» | `grep -c "test(" apps/mobile/test/contract_test.dart` → **7** |
| «`verify.mjs` continua exit 0» | corrida, exit 0, com os pisos anti-vacuidade do próprio script |
| «o contrato não foi tocado» | `git status --porcelain packages/shared` → vazio |
