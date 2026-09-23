/// Testes do cliente do contrato partilhado (`MOB-001`).
///
/// ## Estado destes testes — ler antes de confiar neles
///
/// **Não foram executados.** Flutter e Dart não estão instalados no ambiente onde `MOB-001` foi
/// construída (verificado: `command -v flutter` e `command -v dart` falham, e não existe
/// `pubspec.yaml` em nenhum outro sítio do repositório). Estes testes foram **escritos**, não
/// **provados**.
///
/// A prova executável de `MOB-001` é `node apps/mobile/contract/verify.mjs`, que corre na
/// toolchain que existe e verifica que o Dart gerado corresponde a `@zemlo/shared`. O que aqui
/// está é a verificação que exige SDK — e que tem de ser corrida antes de `MOB-002` dar por si
/// mesma apoiada neste cliente:
///
/// ```bash
/// cd apps/mobile && flutter test
/// ```
///
/// Enquanto isso não acontecer, tratar estes testes como código por rever, não como garantia.
library;

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:zemlo_mobile/zemlo_mobile.dart';

/// Corpo de sessão com a **forma exata** que a API devolve
/// (`apps/api/src/services/auth.ts`) e que o contrato declara em `AuthTokens`.
///
/// O token de renovação está **dentro** de `tokens`, e é isso que este teste fixa.
const String kSessionJson = '''
{
  "user": {
    "id": "u1",
    "email": "a@b.c",
    "name": "Ana",
    "locale": "pt-PT",
    "timeZone": "Europe/Lisbon",
    "distanceUnit": "km",
    "volumeUnit": "l",
    "currency": "EUR",
    "emailVerified": true,
    "twoFactorEnabled": false,
    "createdAt": "2026-09-22T10:00:00.000Z",
    "counts": { "vehicles": 1, "expenses": 0, "documents": 0, "integrations": 0 },
    "onboarding": {
      "hasVehicle": true,
      "hasOdometer": false,
      "hasInsurance": false,
      "hasInspection": false,
      "hasMaintenancePlan": false,
      "complete": false
    }
  },
  "tokens": {
    "accessToken": "access-token-value",
    "expiresIn": 3600,
    "tokenType": "Bearer",
    "refreshToken": "refresh-token-value"
  }
}
''';

void main() {
  group('contrato · sessão', () {
    test('o token de renovação é lido de `tokens.refreshToken`', () {
      // Este é o teste que a web falharia: ela lê `session.refreshToken`, um campo de topo
      // que não existe. Aqui o campo está onde o contrato diz, e o modelo gerado obriga a
      // que esteja — `AuthTokens.refreshToken` é `required`.
      final session = AuthSessionResponse.fromJson(
        jsonDecode(kSessionJson) as Map<String, dynamic>,
      );

      expect(session.tokens.refreshToken, 'refresh-token-value');
      expect(session.tokens.accessToken, 'access-token-value');
      expect(session.user.email, 'a@b.c');
    });

    test('a ida e volta por JSON preserva a sessão', () {
      final original = AuthSessionResponse.fromJson(
        jsonDecode(kSessionJson) as Map<String, dynamic>,
      );
      final roundTrip = AuthSessionResponse.fromJson(original.toJson());

      expect(roundTrip.tokens.refreshToken, original.tokens.refreshToken);
      expect(roundTrip.user.id, original.user.id);
    });
  });

  group('contrato · conjuntos fechados', () {
    test('um código conhecido converte-se no membro certo', () {
      expect(FuelType.fromWire('gasoline').wire, 'gasoline');
      expect(ExpenseCategory.fromWire('fuel'), ExpenseCategory.fuel);
    });

    test('um código desconhecido lança, em vez de passar em silêncio', () {
      // Um valor fora do conjunto é uma divergência de contrato. Se passasse como string
      // livre, o ecrã mostraria um rótulo vazio e ninguém saberia porquê.
      expect(() => FuelType.fromWire('banana'), throwsArgumentError);
    });
  });

  group('contrato · tabelas de registo', () {
    test('os rótulos vêm do contrato, com ícone e ordem', () {
      final combustivel = kEXPENSE_CATEGORIES.firstWhere((e) => e.code == 'fuel');

      expect(combustivel.label, 'Combustível');
      expect(combustivel.icon, '⛽');
      expect(combustivel.energy, isTrue);
    });
  });

  group('cliente · erro (A11)', () {
    test('o envelope é traduzido com código, mensagem, campos e requestId', () {
      final error = apiErrorFrom(
        status: 400,
        body: {
          'error': {
            'code': 'validation_error',
            'message': 'A quilometragem recuou face à última leitura.',
            'fields': [
              {'path': 'odometerKm', 'message': 'Tem de ser maior que 42 381 km.'},
            ],
            'requestId': 'fba01d18',
          },
        },
      );

      expect(error.code, ApiErrorCode.validation_error);
      expect(error.isValidationError, isTrue);
      expect(error.fieldError('odometerKm'), 'Tem de ser maior que 42 381 km.');
      expect(error.requestId, 'fba01d18');
    });

    test('uma resposta sem envelope legível cai no código de recurso', () {
      final error = apiErrorFrom(
        status: 502,
        body: '<html>Bad Gateway</html>',
        requestIdHeader: 'abc123',
      );

      expect(error.code, ApiErrorCode.internal_error);
      expect(error.message, isNotEmpty);
      // O identificador continua a existir, vindo do cabeçalho: o apoio ao cliente não fica
      // sem nada a que se agarrar só porque a resposta não passou pelo código da aplicação.
      expect(error.requestId, 'abc123');
    });
  });
}
