import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../contract/generated/contract_constants.dart';
import '../contract/generated/contract_models.dart';
import 'api_error.dart';
import 'token_store.dart';

/// Cliente HTTP da aplicação mobile — a única porta de saída para a API.
///
/// ## Porque existe um único ponto de saída
///
///  1. **O envelope de erro é traduzido uma só vez** (§A11). A API responde sempre
///     `{ error: { code, message, fields?, requestId } }`; aqui transforma-se num [ApiError].
///  2. **A renovação silenciosa de sessão vive num só lugar** (§A23). Um 401 em vários
///     pedidos concorrentes **não pode** desencadear várias renovações — ver [refreshInFlight].
///  3. **A decisão sobre onde guardar os tokens é tomada em [TokenStore]**, não aqui.
///
/// ## O que este cliente **não** faz
///
/// Não conhece regras de negócio e não calcula nada do domínio: o servidor calcula, o cliente
/// mostra. Não há aqui nenhuma reimplementação de `averageChargingPowerKw`, de datas ou de
/// dinheiro — essas funções vivem em `@zemlo/shared` e são do lado do servidor. Duplicá-las em
/// Dart seria criar uma segunda fonte de verdade que ninguém compararia com a primeira.
class ApiClient {
  ApiClient({
    required this.tokens,
    required String host,
    http.Client? httpClient,
    this.onSessionExpired,
  })  : _http = httpClient ?? http.Client(),
        _baseUrl = Uri.parse('$host$kApiBasePath');

  /// Sessão (token de acesso em memória, token de renovação no armazenamento seguro).
  final TokenStore tokens;

  /// Chamado quando a sessão termina sem possibilidade de renovação.
  ///
  /// O cliente não conhece a navegação da aplicação — quem a monta decide o que fazer. É a
  /// mesma separação da web, onde o cliente avisa e a aplicação reage.
  final void Function()? onSessionExpired;

  final http.Client _http;
  final Uri _baseUrl;

  /// Renovação em curso, ou `null`.
  ///
  /// Guarda-se a **promessa**, e não um booleano. É o que garante que dez pedidos que recebem
  /// 401 ao mesmo tempo desencadeiam **uma** renovação e ficam todos à espera dela. Com um
  /// booleano, os restantes ou desistiam ou disparavam renovações concorrentes — e como a API
  /// **roda o token de renovação** (§A23), as concorrentes invalidar-se-iam umas às outras e o
  /// utilizador era expulso sem motivo. Não é uma otimização: é uma condição de correção.
  Future<bool>? refreshInFlight;

  /* ---------------------------------------------------------------------- */
  /* Pedido base                                                            */
  /* ---------------------------------------------------------------------- */

  /// Executa um pedido e devolve o corpo descodificado, ou `null` sem corpo.
  Future<T?> request<T>(
    String method,
    String path, {
    Object? body,
    Map<String, String?>? query,
    bool skipRefresh = false,
  }) async {
    final response = await _send(method, path, body: body, query: query);

    if (response.statusCode == 401 && !skipRefresh) {
      final renewed = await refresh();
      if (!renewed) {
        await tokens.clear();
        onSessionExpired?.call();
        throw _toError(response);
      }
      // Uma tentativa, e uma só: repetir indefinidamente transformaria um erro de
      // configuração do servidor num ciclo de pedidos.
      final retry = await _send(method, path, body: body, query: query);
      return _decode<T>(retry);
    }

    return _decode<T>(response);
  }

  Future<http.Response> _send(
    String method,
    String path, {
    Object? body,
    Map<String, String?>? query,
  }) async {
    final uri = _baseUrl.replace(
      path: '${_baseUrl.path}$path',
      queryParameters: _cleanQuery(query),
    );
    final request = http.Request(method, uri);

    request.headers['Accept'] = 'application/json';
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    final accessToken = tokens.accessToken;
    if (accessToken != null) {
      request.headers['Authorization'] = 'Bearer $accessToken';
    }

    try {
      final streamed = await _http.send(request);
      return await http.Response.fromStream(streamed);
    } on TimeoutException {
      throw networkError();
    } on http.ClientException {
      throw networkError();
    }
  }

  Map<String, String>? _cleanQuery(Map<String, String?>? query) {
    if (query == null) return null;
    final cleaned = <String, String>{};
    for (final entry in query.entries) {
      final value = entry.value;
      if (value == null || value.isEmpty) continue;
      cleaned[entry.key] = value;
    }
    return cleaned.isEmpty ? null : cleaned;
  }

  T? _decode<T>(http.Response response) {
    if (response.statusCode >= 400) throw _toError(response);
    // 204 e respostas sem corpo (o `DELETE` da API) não têm JSON para analisar.
    final text = response.body;
    if (response.statusCode == 204 || text.isEmpty) return null;
    final decoded = jsonDecode(text);
    if (T == Object || T == dynamic) return decoded as T?;
    return decoded as T?;
  }

  ApiError _toError(http.Response response) {
    Object? body;
    try {
      body = jsonDecode(response.body);
    } catch (_) {
      // Resposta sem JSON legível (um 502 em HTML, por exemplo). O envelope não existe e o
      // código de recurso assume o controlo — é por isso que ele existe.
      body = null;
    }
    return apiErrorFrom(
      status: response.statusCode,
      body: body,
      requestIdHeader: response.headers['x-request-id'],
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Renovação de sessão (§A23)                                             */
  /* ---------------------------------------------------------------------- */

  /// Renova a sessão, uma só vez, mesmo com vários pedidos em 401 ao mesmo tempo.
  ///
  /// Devolve `true` se houver agora um token de acesso válido.
  Future<bool> refresh() {
    final existing = refreshInFlight;
    if (existing != null) return existing;

    final attempt = _performRefresh();
    refreshInFlight = attempt;
    return attempt.whenComplete(() => refreshInFlight = null);
  }

  Future<bool> _performRefresh() async {
    final refreshToken = await tokens.readRefreshToken();
    if (refreshToken == null) return false;

    try {
      final response = await _send(
        'POST',
        '/auth/refresh',
        body: <String, dynamic>{'refreshToken': refreshToken},
      );
      if (response.statusCode >= 400) return false;

      final session = AuthSessionResponse.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>,
      );

      // **A leitura é `tokens.refreshToken`, e não um campo de topo.**
      //
      // O contrato declara o token de renovação **dentro** de `tokens`
      // (`AuthTokens.refreshToken`, `packages/shared/src/types.ts`), e é aí que a API o
      // devolve (`apps/api/src/services/auth.ts`). A aplicação web lê-o do sítio errado e
      // por isso nunca o guarda — o que faz a renovação silenciosa falhar sempre, apesar de
      // a §A23 estar implementada no servidor. Aqui usa-se o modelo gerado do contrato, em
      // que o campo está onde o contrato diz: o erro é impossível de escrever sem que o
      // compilador se queixe.
      await tokens.save(
        accessToken: session.tokens.accessToken,
        refreshToken: session.tokens.refreshToken,
      );
      return true;
    } on ApiError {
      return false;
    }
  }

  /// Fecha o cliente HTTP subjacente.
  void close() => _http.close();
}

/// Verifica se um erro é um [ApiError] de validação — açúcar para os ecrãs de formulário.
bool isValidationError(Object error) => error is ApiError && error.isValidationError;
