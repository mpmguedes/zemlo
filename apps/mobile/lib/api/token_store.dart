import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Onde vivem os tokens — e porquê.
///
/// ## O que muda face à web, e porque não é uma cópia
///
/// Na web, o token de acesso vive em `sessionStorage` e o de renovação em `localStorage`, com
/// o compromisso de XSS **documentado e aceite** em `apps/web/src/api/client.ts`. No telemóvel
/// o modelo de ameaça é outro e a decisão tem de ser outra:
///
///  * **Token de acesso (1 hora) — só em memória.** É o token que viaja em cada pedido. Não
///    vai a disco: uma cópia no armazenamento do dispositivo só acrescenta exposição, porque
///    ao fim de uma hora não vale nada e a aplicação pode pedir outro.
///  * **Token de renovação (90 dias) — no armazenamento seguro do sistema** (Keychain no iOS,
///    Keystore no Android). É o segredo mais valioso que o cliente guarda (§A23). Em
///    `SharedPreferences` seria legível por qualquer processo com acesso ao sistema de
///    ficheiros do utilizador — e em dispositivos com *root*/jailbreak, por qualquer
///    aplicação. O armazenamento seguro é a única opção que resiste a isso.
///
/// A regra do §A23 — **o token de renovação é rodado em cada renovação** — torna este
/// armazenamento ainda mais crítico: se a escrita do token novo falhar em silêncio, o cliente
/// fica com um token que já não vale e o utilizador é expulso na renovação seguinte. Por isso
/// [save] é a **única** porta de escrita, e é ela que grava as duas partes em conjunto.
abstract class TokenStore {
  /// Token de acesso em memória, ou `null` se não houver sessão.
  String? get accessToken;

  /// Lê o token de renovação do armazenamento seguro.
  Future<String?> readRefreshToken();

  /// Grava a sessão inteira de uma vez.
  ///
  /// Recebe o par completo (e não só o token de renovação) para que não exista um estado
  /// intermédio em que a memória já tem o token novo e o armazenamento ainda tem o antigo —
  /// que é precisamente o estado que faz uma renovação falhar sem motivo visível.
  Future<void> save({required String accessToken, required String? refreshToken});

  /// Apaga a sessão dos dois lados.
  Future<void> clear();
}

/// Implementação real: memória para o token de acesso, armazenamento seguro para o de renovação.
class SecureTokenStore implements TokenStore {
  SecureTokenStore({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  /// **O único ponto do cliente que fala com o plugin de armazenamento seguro.**
  ///
  /// Está isolado de propósito: trocar de plugin, ou usar uma opção diferente por
  /// plataforma, muda só este ficheiro. O resto do cliente depende de [TokenStore].
  final FlutterSecureStorage _storage;

  static const String _refreshTokenKey = 'zemlo.refreshToken';

  String? _accessToken;

  @override
  String? get accessToken => _accessToken;

  @override
  Future<String?> readRefreshToken() => _storage.read(key: _refreshTokenKey);

  @override
  Future<void> save({required String accessToken, required String? refreshToken}) async {
    _accessToken = accessToken;
    if (refreshToken != null) {
      await _storage.write(key: _refreshTokenKey, value: refreshToken);
    }
  }

  @override
  Future<void> clear() async {
    _accessToken = null;
    await _storage.delete(key: _refreshTokenKey);
  }
}

/// Armazenamento só em memória.
///
/// Existe para os testes e para o modo de demonstração: a aplicação funciona sem persistência
/// e perde a sessão ao fechar, o que é melhor do que não arrancar. É o análogo do
/// `try/catch` em torno do `localStorage` na web — onde o armazenamento pode lançar (modo
/// privado, políticas de cookies) e a aplicação tem de continuar.
class InMemoryTokenStore implements TokenStore {
  String? _accessToken;
  String? _refreshToken;

  @override
  String? get accessToken => _accessToken;

  @override
  Future<String?> readRefreshToken() async => _refreshToken;

  @override
  Future<void> save({required String accessToken, required String? refreshToken}) async {
    _accessToken = accessToken;
    _refreshToken = refreshToken;
  }

  @override
  Future<void> clear() async {
    _accessToken = null;
    _refreshToken = null;
  }
}
