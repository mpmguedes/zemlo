import 'dart:convert';

import '../contract/generated/contract_models.dart';
import 'api_client.dart';
import 'api_error.dart';

/// Operações de autenticação, sobre o [ApiClient].
///
/// Só existe para não repetir a leitura da sessão em cada ecrã. O caminho `MOB-002` acrescenta
/// aqui o 2FA e o ecrã de início de sessão; o que já está desenhado é o que o §A23 exige:
/// **guardar o token de renovação que a API devolve, e guardar o novo a cada renovação**.
class AuthApi {
  AuthApi(this._client);

  final ApiClient _client;

  /// Inicia sessão e guarda a sessão.
  ///
  /// O `totp` é opcional e só se envia quando o utilizador o tem — a API distingue «não uso
  /// 2FA» de «usei e errei», e mandar um código vazio transformaria o segundo caso no
  /// primeiro.
  Future<AuthSessionResponse> login({
    required String email,
    required String password,
    String? totp,
  }) async {
    final session = await _client.request<Map<String, dynamic>>(
      'POST',
      '/auth/login',
      body: <String, dynamic>{
        'email': email,
        'password': password,
        if (totp != null && totp.isNotEmpty) 'totp': totp,
      },
      skipRefresh: true,
    );
    return _store(AuthSessionResponse.fromJson(_require(session)));
  }

  /// Cria conta e guarda a sessão.
  Future<AuthSessionResponse> signUp({
    required String email,
    required String password,
    String? name,
    required bool acceptedTerms,
    String? inviteCode,
  }) async {
    final session = await _client.request<Map<String, dynamic>>(
      'POST',
      '/auth/signup',
      body: <String, dynamic>{
        'email': email,
        'password': password,
        if (name != null && name.isNotEmpty) 'name': name,
        'acceptedTerms': acceptedTerms,
        if (inviteCode != null && inviteCode.isNotEmpty) 'inviteCode': inviteCode,
      },
      skipRefresh: true,
    );
    return _store(AuthSessionResponse.fromJson(_require(session)));
  }

  /// Termina a sessão.
  ///
  /// Limpa os tokens **sempre**, mesmo que o servidor falhe: o utilizador pediu para sair, e
  /// manter um token válido no dispositivo depois de um «sair» seria mentir-lhe.
  Future<void> logout() async {
    try {
      await _client.request<Object?>('POST', '/auth/logout');
    } on ApiError {
      // Ignorado de propósito — ver acima.
    } finally {
      await _client.tokens.clear();
    }
  }

  /// Perfil da conta com sessão.
  Future<UserProfile> me() async {
    final json = await _client.request<Map<String, dynamic>>('GET', '/me');
    return UserProfile.fromJson(_require(json));
  }

  /// Pede a recuperação de password.
  ///
  /// A resposta é a mesma exista ou não a conta: a API responde 202 com uma mensagem uniforme.
  /// O ecrã **não pode** mostrar «email enviado» de forma condicional — mostrar a mesma
  /// confirmação nos dois casos é o que impede o formulário de ser um oráculo de existência
  /// de contas.
  Future<void> requestPasswordReset(String email) async {
    await _client.request<Object?>(
      'POST',
      '/auth/password-reset',
      body: <String, dynamic>{'email': email},
      skipRefresh: true,
    );
  }

  Future<AuthSessionResponse> _store(AuthSessionResponse session) async {
    await _client.tokens.save(
      accessToken: session.tokens.accessToken,
      refreshToken: session.tokens.refreshToken,
    );
    return session;
  }

  Map<String, dynamic> _require(Map<String, dynamic>? json) {
    if (json == null) {
      throw ApiError(
        code: null,
        status: 0,
        message: 'A resposta do Zemlo veio vazia.',
        isNetworkError: true,
      );
    }
    return json;
  }
}

/// Descodifica um corpo de resposta que o contrato já sabe ler.
///
/// Existe para os casos em que o cliente recebe JSON cru e quer o modelo gerado: mantém a
/// conversão num só sítio em vez de espalhar `as Map<String, dynamic>` pelos ecrãs.
Map<String, dynamic> asJsonMap(String body) => jsonDecode(body) as Map<String, dynamic>;
