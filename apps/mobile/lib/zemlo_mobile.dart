/// Zemlo — app mobile.
///
/// Ponto de entrada da biblioteca. A arquitetura está em `ARCHITECTURE.md`, na raiz deste
/// pacote; o contrato é gerado por `contract/generate.mjs` e verificado por
/// `contract/verify.mjs`.
///
/// A regra de dependências é `features/ → api/ → contract/`. Este ficheiro existe para que os
/// ecrãs importem `package:zemlo_mobile/zemlo_mobile.dart` em vez de caminhos relativos que
/// atravessam camadas — um `import` que atravessa camadas é o primeiro sinal de que a
/// separação se está a perder.
library;

export 'api/api_client.dart';
export 'api/api_error.dart';
export 'api/auth_api.dart';
export 'api/token_store.dart';

export 'contract/generated/contract_constants.dart';
export 'contract/generated/contract_enums.dart';
export 'contract/generated/contract_models.dart';
export 'contract/generated/contract_registry.dart';
