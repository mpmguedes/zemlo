// GERADO POR apps/mobile/contract/generate.mjs — NÃO EDITAR À MÃO.
//
// Qualquer alteração feita aqui é apagada na próxima geração e, mais importante,
// `node apps/mobile/contract/verify.mjs` falha no CI. Para mudar o contrato, muda-se
// `packages/shared` e volta a correr o gerador.


// ignore_for_file: constant_identifier_names

/// Conjunto fechado do contrato: `ApiErrorCode`.
///
/// O valor do fio da API é o do contrato — não há tradução de nomes.
enum ApiErrorCode {
  validation_error('validation_error'),
  unauthorized('unauthorized'),
  forbidden('forbidden'),
  not_found('not_found'),
  conflict('conflict'),
  rate_limited('rate_limited'),
  unprocessable('unprocessable'),
  internal_error('internal_error'),
  service_unavailable('service_unavailable'),
  payload_too_large('payload_too_large'),
  gone('gone'),
  ;

  const ApiErrorCode(this.wire);

  /// Valor tal como viaja no JSON.
  final String wire;

  /// Converte o valor do fio no membro correspondente.
  ///
  /// Lança se o valor não pertencer ao conjunto: um valor desconhecido é uma
  /// divergência de contrato e tem de ser visível, não silenciosamente ignorada.
  static ApiErrorCode fromWire(String value) =>
      ApiErrorCode.values.firstWhere(
        (candidate) => candidate.wire == value,
        orElse: () => throw ArgumentError(
          'Valor ${value} não pertence ao conjunto fechado ApiErrorCode. '
          'O contrato mudou ou a resposta não é a esperada.',
        ),
      );
}

/// Conjunto fechado do contrato: `DocumentCategory`.
///
/// O valor do fio da API é o do contrato — não há tradução de nomes.
enum DocumentCategory {
  registration('registration'),
  insurance('insurance'),
  inspection('inspection'),
  invoice('invoice'),
  receipt('receipt'),
  maintenance('maintenance'),
  warranty('warranty'),
  tax('tax'),
  certificate('certificate'),
  photo('photo'),
  other('other'),
  ;

  const DocumentCategory(this.wire);

  /// Valor tal como viaja no JSON.
  final String wire;

  /// Converte o valor do fio no membro correspondente.
  ///
  /// Lança se o valor não pertencer ao conjunto: um valor desconhecido é uma
  /// divergência de contrato e tem de ser visível, não silenciosamente ignorada.
  static DocumentCategory fromWire(String value) =>
      DocumentCategory.values.firstWhere(
        (candidate) => candidate.wire == value,
        orElse: () => throw ArgumentError(
          'Valor ${value} não pertence ao conjunto fechado DocumentCategory. '
          'O contrato mudou ou a resposta não é a esperada.',
        ),
      );
}

/// Conjunto fechado do contrato: `DocumentContentState`.
///
/// O valor do fio da API é o do contrato — não há tradução de nomes.
enum DocumentContentState {
  included('included'),
  missingContent('missingContent'),
  externalReference('externalReference'),
  ;

  const DocumentContentState(this.wire);

  /// Valor tal como viaja no JSON.
  final String wire;

  /// Converte o valor do fio no membro correspondente.
  ///
  /// Lança se o valor não pertencer ao conjunto: um valor desconhecido é uma
  /// divergência de contrato e tem de ser visível, não silenciosamente ignorada.
  static DocumentContentState fromWire(String value) =>
      DocumentContentState.values.firstWhere(
        (candidate) => candidate.wire == value,
        orElse: () => throw ArgumentError(
          'Valor ${value} não pertence ao conjunto fechado DocumentContentState. '
          'O contrato mudou ou a resposta não é a esperada.',
        ),
      );
}

/// Conjunto fechado do contrato: `ExpenseCategory`.
///
/// O valor do fio da API é o do contrato — não há tradução de nomes.
enum ExpenseCategory {
  fuel('fuel'),
  charging('charging'),
  maintenance('maintenance'),
  tyres('tyres'),
  insurance('insurance'),
  tax('tax'),
  inspection('inspection'),
  wash('wash'),
  parking('parking'),
  tolls('tolls'),
  repairs('repairs'),
  accessories('accessories'),
  fines('fines'),
  other('other'),
  ;

  const ExpenseCategory(this.wire);

  /// Valor tal como viaja no JSON.
  final String wire;

  /// Converte o valor do fio no membro correspondente.
  ///
  /// Lança se o valor não pertencer ao conjunto: um valor desconhecido é uma
  /// divergência de contrato e tem de ser visível, não silenciosamente ignorada.
  static ExpenseCategory fromWire(String value) =>
      ExpenseCategory.values.firstWhere(
        (candidate) => candidate.wire == value,
        orElse: () => throw ArgumentError(
          'Valor ${value} não pertence ao conjunto fechado ExpenseCategory. '
          'O contrato mudou ou a resposta não é a esperada.',
        ),
      );
}

/// Conjunto fechado do contrato: `FuelType`.
///
/// O valor do fio da API é o do contrato — não há tradução de nomes.
enum FuelType {
  gasoline('gasoline'),
  diesel('diesel'),
  lpg('lpg'),
  cng('cng'),
  hybrid('hybrid'),
  phev('phev'),
  electric('electric'),
  hydrogen('hydrogen'),
  other('other'),
  ;

  const FuelType(this.wire);

  /// Valor tal como viaja no JSON.
  final String wire;

  /// Converte o valor do fio no membro correspondente.
  ///
  /// Lança se o valor não pertencer ao conjunto: um valor desconhecido é uma
  /// divergência de contrato e tem de ser visível, não silenciosamente ignorada.
  static FuelType fromWire(String value) =>
      FuelType.values.firstWhere(
        (candidate) => candidate.wire == value,
        orElse: () => throw ArgumentError(
          'Valor ${value} não pertence ao conjunto fechado FuelType. '
          'O contrato mudou ou a resposta não é a esperada.',
        ),
      );
}

/// Conjunto fechado do contrato: `MaintenanceType`.
///
/// O valor do fio da API é o do contrato — não há tradução de nomes.
enum MaintenanceType {
  service('service'),
  oil('oil'),
  filters('filters'),
  brakes('brakes'),
  tyres('tyres'),
  battery('battery'),
  timing('timing'),
  suspension('suspension'),
  clutch('clutch'),
  ac('ac'),
  diagnostics('diagnostics'),
  bodywork('bodywork'),
  software('software'),
  recall('recall'),
  other('other'),
  ;

  const MaintenanceType(this.wire);

  /// Valor tal como viaja no JSON.
  final String wire;

  /// Converte o valor do fio no membro correspondente.
  ///
  /// Lança se o valor não pertencer ao conjunto: um valor desconhecido é uma
  /// divergência de contrato e tem de ser visível, não silenciosamente ignorada.
  static MaintenanceType fromWire(String value) =>
      MaintenanceType.values.firstWhere(
        (candidate) => candidate.wire == value,
        orElse: () => throw ArgumentError(
          'Valor ${value} não pertence ao conjunto fechado MaintenanceType. '
          'O contrato mudou ou a resposta não é a esperada.',
        ),
      );
}

/// Conjunto fechado do contrato: `NotificationChannel`.
///
/// O valor do fio da API é o do contrato — não há tradução de nomes.
enum NotificationChannel {
  push('push'),
  email('email'),
  in_app('in_app'),
  ;

  const NotificationChannel(this.wire);

  /// Valor tal como viaja no JSON.
  final String wire;

  /// Converte o valor do fio no membro correspondente.
  ///
  /// Lança se o valor não pertencer ao conjunto: um valor desconhecido é uma
  /// divergência de contrato e tem de ser visível, não silenciosamente ignorada.
  static NotificationChannel fromWire(String value) =>
      NotificationChannel.values.firstWhere(
        (candidate) => candidate.wire == value,
        orElse: () => throw ArgumentError(
          'Valor ${value} não pertence ao conjunto fechado NotificationChannel. '
          'O contrato mudou ou a resposta não é a esperada.',
        ),
      );
}

/// Conjunto fechado do contrato: `NotificationFrequency`.
///
/// O valor do fio da API é o do contrato — não há tradução de nomes.
enum NotificationFrequency {
  immediate('immediate'),
  daily('daily'),
  weekly('weekly'),
  off('off'),
  ;

  const NotificationFrequency(this.wire);

  /// Valor tal como viaja no JSON.
  final String wire;

  /// Converte o valor do fio no membro correspondente.
  ///
  /// Lança se o valor não pertencer ao conjunto: um valor desconhecido é uma
  /// divergência de contrato e tem de ser visível, não silenciosamente ignorada.
  static NotificationFrequency fromWire(String value) =>
      NotificationFrequency.values.firstWhere(
        (candidate) => candidate.wire == value,
        orElse: () => throw ArgumentError(
          'Valor ${value} não pertence ao conjunto fechado NotificationFrequency. '
          'O contrato mudou ou a resposta não é a esperada.',
        ),
      );
}

/// Conjunto fechado do contrato: `NotificationTopic`.
///
/// O valor do fio da API é o do contrato — não há tradução de nomes.
enum NotificationTopic {
  maintenance('maintenance'),
  inspection('inspection'),
  insurance('insurance'),
  tax('tax'),
  document('document'),
  summary('summary'),
  security('security'),
  ;

  const NotificationTopic(this.wire);

  /// Valor tal como viaja no JSON.
  final String wire;

  /// Converte o valor do fio no membro correspondente.
  ///
  /// Lança se o valor não pertencer ao conjunto: um valor desconhecido é uma
  /// divergência de contrato e tem de ser visível, não silenciosamente ignorada.
  static NotificationTopic fromWire(String value) =>
      NotificationTopic.values.firstWhere(
        (candidate) => candidate.wire == value,
        orElse: () => throw ArgumentError(
          'Valor ${value} não pertence ao conjunto fechado NotificationTopic. '
          'O contrato mudou ou a resposta não é a esperada.',
        ),
      );
}

/// Conjunto fechado do contrato: `ProviderKind`.
///
/// O valor do fio da API é o do contrato — não há tradução de nomes.
enum ProviderKind {
  manual('manual'),
  api('api'),
  obd('obd'),
  import('import'),
  document('document'),
  estimated('estimated'),
  ;

  const ProviderKind(this.wire);

  /// Valor tal como viaja no JSON.
  final String wire;

  /// Converte o valor do fio no membro correspondente.
  ///
  /// Lança se o valor não pertencer ao conjunto: um valor desconhecido é uma
  /// divergência de contrato e tem de ser visível, não silenciosamente ignorada.
  static ProviderKind fromWire(String value) =>
      ProviderKind.values.firstWhere(
        (candidate) => candidate.wire == value,
        orElse: () => throw ArgumentError(
          'Valor ${value} não pertence ao conjunto fechado ProviderKind. '
          'O contrato mudou ou a resposta não é a esperada.',
        ),
      );
}

/// Conjunto fechado do contrato: `ReminderTrigger`.
///
/// O valor do fio da API é o do contrato — não há tradução de nomes.
enum ReminderTrigger {
  distance('distance'),
  time('time'),
  both('both'),
  ;

  const ReminderTrigger(this.wire);

  /// Valor tal como viaja no JSON.
  final String wire;

  /// Converte o valor do fio no membro correspondente.
  ///
  /// Lança se o valor não pertencer ao conjunto: um valor desconhecido é uma
  /// divergência de contrato e tem de ser visível, não silenciosamente ignorada.
  static ReminderTrigger fromWire(String value) =>
      ReminderTrigger.values.firstWhere(
        (candidate) => candidate.wire == value,
        orElse: () => throw ArgumentError(
          'Valor ${value} não pertence ao conjunto fechado ReminderTrigger. '
          'O contrato mudou ou a resposta não é a esperada.',
        ),
      );
}

/// Conjunto fechado do contrato: `SuggestionType`.
///
/// O valor do fio da API é o do contrato — não há tradução de nomes.
enum SuggestionType {
  vehicle_add_odometer('vehicle.add_odometer'),
  vehicle_add_insurance('vehicle.add_insurance'),
  vehicle_add_inspection('vehicle.add_inspection'),
  vehicle_add_maintenance_plan('vehicle.add_maintenance_plan'),
  vehicle_add_details('vehicle.add_details'),
  expense_add_odometer('expense.add_odometer'),
  account_enable_2fa('account.enable_2fa'),
  documents_add_first('documents.add_first'),
  ;

  const SuggestionType(this.wire);

  /// Valor tal como viaja no JSON.
  final String wire;

  /// Converte o valor do fio no membro correspondente.
  ///
  /// Lança se o valor não pertencer ao conjunto: um valor desconhecido é uma
  /// divergência de contrato e tem de ser visível, não silenciosamente ignorada.
  static SuggestionType fromWire(String value) =>
      SuggestionType.values.firstWhere(
        (candidate) => candidate.wire == value,
        orElse: () => throw ArgumentError(
          'Valor ${value} não pertence ao conjunto fechado SuggestionType. '
          'O contrato mudou ou a resposta não é a esperada.',
        ),
      );
}

/// Conjunto fechado do contrato: `UserProfileDistanceUnit`.
///
/// O valor do fio da API é o do contrato — não há tradução de nomes.
enum UserProfileDistanceUnit {
  km('km'),
  mi('mi'),
  ;

  const UserProfileDistanceUnit(this.wire);

  /// Valor tal como viaja no JSON.
  final String wire;

  /// Converte o valor do fio no membro correspondente.
  ///
  /// Lança se o valor não pertencer ao conjunto: um valor desconhecido é uma
  /// divergência de contrato e tem de ser visível, não silenciosamente ignorada.
  static UserProfileDistanceUnit fromWire(String value) =>
      UserProfileDistanceUnit.values.firstWhere(
        (candidate) => candidate.wire == value,
        orElse: () => throw ArgumentError(
          'Valor ${value} não pertence ao conjunto fechado UserProfileDistanceUnit. '
          'O contrato mudou ou a resposta não é a esperada.',
        ),
      );
}

/// Conjunto fechado do contrato: `UserProfileVolumeUnit`.
///
/// O valor do fio da API é o do contrato — não há tradução de nomes.
enum UserProfileVolumeUnit {
  l('l'),
  gal_us('gal_us'),
  gal_uk('gal_uk'),
  ;

  const UserProfileVolumeUnit(this.wire);

  /// Valor tal como viaja no JSON.
  final String wire;

  /// Converte o valor do fio no membro correspondente.
  ///
  /// Lança se o valor não pertencer ao conjunto: um valor desconhecido é uma
  /// divergência de contrato e tem de ser visível, não silenciosamente ignorada.
  static UserProfileVolumeUnit fromWire(String value) =>
      UserProfileVolumeUnit.values.firstWhere(
        (candidate) => candidate.wire == value,
        orElse: () => throw ArgumentError(
          'Valor ${value} não pertence ao conjunto fechado UserProfileVolumeUnit. '
          'O contrato mudou ou a resposta não é a esperada.',
        ),
      );
}

/// Conjunto fechado do contrato: `VehicleType`.
///
/// O valor do fio da API é o do contrato — não há tradução de nomes.
enum VehicleType {
  car('car'),
  suv('suv'),
  van('van'),
  motorcycle('motorcycle'),
  scooter('scooter'),
  bicycle('bicycle'),
  quad('quad'),
  truck('truck'),
  camper('camper'),
  other('other'),
  ;

  const VehicleType(this.wire);

  /// Valor tal como viaja no JSON.
  final String wire;

  /// Converte o valor do fio no membro correspondente.
  ///
  /// Lança se o valor não pertencer ao conjunto: um valor desconhecido é uma
  /// divergência de contrato e tem de ser visível, não silenciosamente ignorada.
  static VehicleType fromWire(String value) =>
      VehicleType.values.firstWhere(
        (candidate) => candidate.wire == value,
        orElse: () => throw ArgumentError(
          'Valor ${value} não pertence ao conjunto fechado VehicleType. '
          'O contrato mudou ou a resposta não é a esperada.',
        ),
      );
}
