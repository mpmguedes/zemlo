import '../contract/generated/contract_enums.dart';
import '../contract/generated/contract_models.dart';

/// Erro da API, traduzido do envelope único (§A11).
///
/// A API responde **sempre** `{ error: { code, message, fields?, requestId } }`. Este tipo é
/// o único sítio do cliente que lê esse envelope: se cada ecrã interpretasse o corpo do erro
/// à sua maneira, o primeiro campo novo do envelope passaria a ser tratado de forma diferente
/// em cada sítio.
///
/// Espelha `apps/web/src/api/client.ts` **na semântica, não no código** — o contrato é o
/// mesmo, a linguagem é outra.
class ApiError implements Exception {
  ApiError({
    required this.code,
    required this.status,
    required this.message,
    this.fields = const [],
    this.requestId,
    this.isNetworkError = false,
  });

  /// Código estável do contrato. `null` quando a falha foi de rede: nesse caso não houve
  /// resposta nenhuma, logo não há código de envelope para ler.
  final ApiErrorCode? code;

  /// Código HTTP, ou `0` quando o pedido não chegou a sair.
  final int status;

  /// Mensagem em português, escrita para ser lida por uma pessoa (§59). Vem da API; só se
  /// usa uma frase de recurso quando não há envelope.
  final String message;

  /// Erros por campo, para colocar a mensagem ao lado do campo certo.
  final List<ApiErrorBodyErrorFieldsItem> fields;

  /// Identificador do pedido, para o utilizador citar no apoio (§56).
  final String? requestId;

  /// `true` quando o pedido não chegou a ter resposta.
  final bool isNetworkError;

  /// `true` quando a API pede confirmação explícita antes de aceitar o valor (§11).
  bool get isUnprocessable => status == 422 && code == ApiErrorCode.unprocessable;

  /// `true` para um erro de validação — o formulário mostra-o junto ao campo.
  bool get isValidationError => code == ApiErrorCode.validation_error;

  /// Mensagem associada a um campo, se a API a tiver indicado.
  String? fieldError(String path) {
    for (final field in fields) {
      if (field.path == path) return field.message;
    }
    return null;
  }

  @override
  String toString() => 'ApiError(${code?.wire ?? 'network_error'}, $status): $message';
}

/// Erro de rede: o pedido não chegou a ter resposta.
///
/// Distinto de um erro da API porque a ação do utilizador é diferente — «verifica a ligação»
/// contra «tenta outra vez» — e porque uma falha de rede **não** deve desencadear uma
/// renovação de sessão: não há nada a renovar quando não se falou com o servidor.
ApiError networkError() => ApiError(
      code: null,
      status: 0,
      message: 'Não conseguimos contactar o Zemlo. Verifica a ligação à internet.',
      isNetworkError: true,
    );

/// Código de recurso, para uma resposta de erro sem envelope legível.
///
/// Um intermediário (proxy, gateway) pode devolver um 502 em HTML. Sem isto, o cliente
/// ficaria sem código nenhum e cada ecrã teria de inventar o seu.
ApiErrorCode? fallbackCodeForStatus(int status) {
  if (status == 401) return ApiErrorCode.unauthorized;
  if (status == 403) return ApiErrorCode.forbidden;
  if (status == 404) return ApiErrorCode.not_found;
  if (status == 409) return ApiErrorCode.conflict;
  if (status == 413) return ApiErrorCode.payload_too_large;
  if (status == 410) return ApiErrorCode.gone;
  if (status == 429) return ApiErrorCode.rate_limited;
  if (status == 503) return ApiErrorCode.service_unavailable;
  if (status >= 500) return ApiErrorCode.internal_error;
  return ApiErrorCode.validation_error;
}

/// Frase de recurso, usada só quando o envelope não trouxe mensagem.
String fallbackMessageForStatus(int status) {
  if (status == 429) {
    return 'Demasiados pedidos seguidos. Aguarda um momento e tenta de novo.';
  }
  if (status == 503) return 'O Zemlo está em manutenção. Tenta daqui a pouco.';
  if (status >= 500) return 'Algo falhou do nosso lado. Já estamos a tratar disso.';
  return 'Não foi possível concluir o pedido.';
}

/// Traduz um corpo de resposta de erro (já descodificado) num [ApiError].
///
/// O `requestId` cai para o cabeçalho `X-Request-Id` quando o envelope não o traz — é o mesmo
/// identificador, e assim o apoio ao cliente continua a ter um valor a que se agarrar mesmo
/// numa resposta que não passou pelo código da aplicação.
ApiError apiErrorFrom({
  required int status,
  required Object? body,
  String? requestIdHeader,
}) {
  Map<String, dynamic>? envelope;
  if (body is Map<String, dynamic>) {
    final error = body['error'];
    if (error is Map<String, dynamic>) envelope = error;
  }

  final codeWire = envelope?['code'];
  return ApiError(
    code: codeWire is String ? ApiErrorCode.fromWire(codeWire) : fallbackCodeForStatus(status),
    status: status,
    message: (envelope?['message'] as String?) ?? fallbackMessageForStatus(status),
    fields: _parseFields(envelope?['fields']),
    requestId: (envelope?['requestId'] as String?) ?? requestIdHeader,
  );
}

List<ApiErrorBodyErrorFieldsItem> _parseFields(Object? raw) {
  if (raw is! List) return const [];
  final parsed = <ApiErrorBodyErrorFieldsItem>[];
  for (final entry in raw) {
    if (entry is! Map<String, dynamic>) continue;
    final path = entry['path'];
    final message = entry['message'];
    if (path is! String || message is! String) continue;
    parsed.add(ApiErrorBodyErrorFieldsItem(path: path, message: message));
  }
  return parsed;
}
