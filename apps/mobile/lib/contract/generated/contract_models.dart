// GERADO POR apps/mobile/contract/generate.mjs — NÃO EDITAR À MÃO.
//
// Qualquer alteração feita aqui é apagada na próxima geração e, mais importante,
// `node apps/mobile/contract/verify.mjs` falha no CI. Para mudar o contrato, muda-se
// `packages/shared` e volta a correr o gerador.


// ignore_for_file: prefer_const_constructors

/// Modelo do contrato `ApiErrorBody`.
class ApiErrorBody {
  const ApiErrorBody({
    required this.error,
  });

  final ApiErrorBodyError error;

  factory ApiErrorBody.fromJson(Map<String, dynamic> json) {
    return ApiErrorBody(
      error: ApiErrorBodyError.fromJson(json['error'] as Map<String, dynamic>),
    );
  }

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'error': this.error.toJson(),
    };
  }
}

/// Modelo do contrato `ApiErrorBodyError`.
class ApiErrorBodyError {
  const ApiErrorBodyError({
    required this.code,
    required this.message,
    required this.fields,
    required this.requestId,
  });

  final ApiErrorCode code;
  final String message;
  final List<ApiErrorBodyErrorFieldsItem>? fields;
  final String? requestId;

  factory ApiErrorBodyError.fromJson(Map<String, dynamic> json) {
    return ApiErrorBodyError(
      code: ApiErrorCode.fromWire(json['code'] as String),
      message: json['message'] as String,
      fields: json['fields'] == null ? null : (json['fields'] as List).map((item) => ApiErrorBodyErrorFieldsItem.fromJson(item as Map<String, dynamic>)).toList(),
      requestId: json['requestId'] == null ? null : json['requestId'] as String,
    );
  }

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'code': this.code.wire,
      'message': this.message,
      'fields': this.fields == null ? null : this.fields!.map((item) => item.toJson()).toList(),
      'requestId': this.requestId == null ? null : this.requestId!,
    };
  }
}

/// Modelo do contrato `ApiErrorBodyErrorFieldsItem`.
class ApiErrorBodyErrorFieldsItem {
  const ApiErrorBodyErrorFieldsItem({
    required this.path,
    required this.message,
  });

  final String path;
  final String message;

  factory ApiErrorBodyErrorFieldsItem.fromJson(Map<String, dynamic> json) {
    return ApiErrorBodyErrorFieldsItem(
      path: json['path'] as String,
      message: json['message'] as String,
    );
  }

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'path': this.path,
      'message': this.message,
    };
  }
}

/// Modelo do contrato `AuthSessionResponse`.
class AuthSessionResponse {
  const AuthSessionResponse({
    required this.user,
    required this.tokens,
  });

  final UserProfile user;
  final AuthTokens tokens;

  factory AuthSessionResponse.fromJson(Map<String, dynamic> json) {
    return AuthSessionResponse(
      user: UserProfile.fromJson(json['user'] as Map<String, dynamic>),
      tokens: AuthTokens.fromJson(json['tokens'] as Map<String, dynamic>),
    );
  }

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'user': this.user.toJson(),
      'tokens': this.tokens.toJson(),
    };
  }
}

/// Modelo do contrato `AuthTokens`.
class AuthTokens {
  const AuthTokens({
    required this.accessToken,
    required this.expiresIn,
    required this.tokenType,
    required this.refreshToken,
  });

  final String accessToken;
  final num expiresIn;
  final String tokenType;
  final String refreshToken;

  factory AuthTokens.fromJson(Map<String, dynamic> json) {
    return AuthTokens(
      accessToken: json['accessToken'] as String,
      expiresIn: json['expiresIn'] as num,
      tokenType: json['tokenType'] as String,
      refreshToken: json['refreshToken'] as String,
    );
  }

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'accessToken': this.accessToken,
      'expiresIn': this.expiresIn,
      'tokenType': this.tokenType,
      'refreshToken': this.refreshToken,
    };
  }
}

/// Modelo do contrato `Page`.
class Page<T> {
  const Page({
    required this.items,
    required this.nextCursor,
    required this.total,
  });

  final List<T> items;
  final String? nextCursor;
  final num? total;

  factory Page.fromJson(Map<String, dynamic> json, T Function(Object? json) tFromJson) {
    return Page<T>(
      items: (json['items'] as List).map((item) => tFromJson(item)).toList(),
      nextCursor: json['nextCursor'] == null ? null : json['nextCursor'] as String,
      total: json['total'] == null ? null : json['total'] as num,
    );
  }

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'items': this.items,
      'nextCursor': this.nextCursor == null ? null : this.nextCursor!,
      'total': this.total == null ? null : this.total!,
    };
  }
}

/// Modelo do contrato `SourceInfo`.
class SourceInfo {
  const SourceInfo({
    required this.kind,
    required this.label,
    required this.integrationId,
    required this.observedAt,
  });

  final String? kind;
  final String? label;
  final String? integrationId;
  final String? observedAt;

  factory SourceInfo.fromJson(Map<String, dynamic> json) {
    return SourceInfo(
      kind: json['kind'] == null ? null : json['kind'] as String,
      label: json['label'] == null ? null : json['label'] as String,
      integrationId: json['integrationId'] == null ? null : json['integrationId'] as String,
      observedAt: json['observedAt'] == null ? null : json['observedAt'] as String,
    );
  }

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'kind': this.kind == null ? null : this.kind!,
      'label': this.label == null ? null : this.label!,
      'integrationId': this.integrationId == null ? null : this.integrationId!,
      'observedAt': this.observedAt == null ? null : this.observedAt!,
    };
  }
}

/// Modelo do contrato `UserProfile`.
class UserProfile {
  const UserProfile({
    required this.id,
    required this.email,
    required this.name,
    required this.locale,
    required this.timeZone,
    required this.distanceUnit,
    required this.volumeUnit,
    required this.currency,
    required this.emailVerified,
    required this.twoFactorEnabled,
    required this.createdAt,
    required this.counts,
    required this.onboarding,
  });

  final String id;
  final String email;
  final String? name;
  final String locale;
  final String timeZone;
  final UserProfileDistanceUnit distanceUnit;
  final UserProfileVolumeUnit volumeUnit;
  final String currency;
  final bool emailVerified;
  final bool twoFactorEnabled;
  final String createdAt;
  final UserProfileCounts counts;
  final UserProfileOnboarding onboarding;

  factory UserProfile.fromJson(Map<String, dynamic> json) {
    return UserProfile(
      id: json['id'] as String,
      email: json['email'] as String,
      name: json['name'] == null ? null : json['name'] as String,
      locale: json['locale'] as String,
      timeZone: json['timeZone'] as String,
      distanceUnit: UserProfileDistanceUnit.fromWire(json['distanceUnit'] as String),
      volumeUnit: UserProfileVolumeUnit.fromWire(json['volumeUnit'] as String),
      currency: json['currency'] as String,
      emailVerified: json['emailVerified'] as bool,
      twoFactorEnabled: json['twoFactorEnabled'] as bool,
      createdAt: json['createdAt'] as String,
      counts: UserProfileCounts.fromJson(json['counts'] as Map<String, dynamic>),
      onboarding: UserProfileOnboarding.fromJson(json['onboarding'] as Map<String, dynamic>),
    );
  }

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'id': this.id,
      'email': this.email,
      'name': this.name == null ? null : this.name!,
      'locale': this.locale,
      'timeZone': this.timeZone,
      'distanceUnit': this.distanceUnit.wire,
      'volumeUnit': this.volumeUnit.wire,
      'currency': this.currency,
      'emailVerified': this.emailVerified,
      'twoFactorEnabled': this.twoFactorEnabled,
      'createdAt': this.createdAt,
      'counts': this.counts.toJson(),
      'onboarding': this.onboarding.toJson(),
    };
  }
}

/// Modelo do contrato `UserProfileCounts`.
class UserProfileCounts {
  const UserProfileCounts({
    required this.vehicles,
    required this.expenses,
    required this.documents,
    required this.integrations,
  });

  final num vehicles;
  final num expenses;
  final num documents;
  final num integrations;

  factory UserProfileCounts.fromJson(Map<String, dynamic> json) {
    return UserProfileCounts(
      vehicles: json['vehicles'] as num,
      expenses: json['expenses'] as num,
      documents: json['documents'] as num,
      integrations: json['integrations'] as num,
    );
  }

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'vehicles': this.vehicles,
      'expenses': this.expenses,
      'documents': this.documents,
      'integrations': this.integrations,
    };
  }
}

/// Modelo do contrato `UserProfileOnboarding`.
class UserProfileOnboarding {
  const UserProfileOnboarding({
    required this.hasVehicle,
    required this.hasOdometer,
    required this.hasInsurance,
    required this.hasInspection,
    required this.hasMaintenancePlan,
    required this.complete,
  });

  final bool hasVehicle;
  final bool hasOdometer;
  final bool hasInsurance;
  final bool hasInspection;
  final bool hasMaintenancePlan;
  final bool complete;

  factory UserProfileOnboarding.fromJson(Map<String, dynamic> json) {
    return UserProfileOnboarding(
      hasVehicle: json['hasVehicle'] as bool,
      hasOdometer: json['hasOdometer'] as bool,
      hasInsurance: json['hasInsurance'] as bool,
      hasInspection: json['hasInspection'] as bool,
      hasMaintenancePlan: json['hasMaintenancePlan'] as bool,
      complete: json['complete'] as bool,
    );
  }

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'hasVehicle': this.hasVehicle,
      'hasOdometer': this.hasOdometer,
      'hasInsurance': this.hasInsurance,
      'hasInspection': this.hasInspection,
      'hasMaintenancePlan': this.hasMaintenancePlan,
      'complete': this.complete,
    };
  }
}

/// Modelo do contrato `VehicleSummary`.
class VehicleSummary {
  const VehicleSummary({
    required this.id,
    required this.plate,
    required this.plateDisplay,
    required this.make,
    required this.model,
    required this.version,
    required this.year,
    required this.vehicleType,
    required this.fuelType,
    required this.nickname,
    required this.archived,
    required this.odometerKm,
    required this.odometerSource,
    required this.odometerUpdatedAt,
    required this.emoji,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String plate;
  final String plateDisplay;
  final String? make;
  final String? model;
  final String? version;
  final num? year;
  final String vehicleType;
  final String fuelType;
  final String? nickname;
  final bool archived;
  final num? odometerKm;
  final SourceInfo? odometerSource;
  final String? odometerUpdatedAt;
  final String emoji;
  final String createdAt;
  final String updatedAt;

  factory VehicleSummary.fromJson(Map<String, dynamic> json) {
    return VehicleSummary(
      id: json['id'] as String,
      plate: json['plate'] as String,
      plateDisplay: json['plateDisplay'] as String,
      make: json['make'] == null ? null : json['make'] as String,
      model: json['model'] == null ? null : json['model'] as String,
      version: json['version'] == null ? null : json['version'] as String,
      year: json['year'] == null ? null : json['year'] as num,
      vehicleType: json['vehicleType'] as String,
      fuelType: json['fuelType'] as String,
      nickname: json['nickname'] == null ? null : json['nickname'] as String,
      archived: json['archived'] as bool,
      odometerKm: json['odometerKm'] == null ? null : json['odometerKm'] as num,
      odometerSource: json['odometerSource'] == null ? null : SourceInfo.fromJson(json['odometerSource'] as Map<String, dynamic>),
      odometerUpdatedAt: json['odometerUpdatedAt'] == null ? null : json['odometerUpdatedAt'] as String,
      emoji: json['emoji'] as String,
      createdAt: json['createdAt'] as String,
      updatedAt: json['updatedAt'] as String,
    );
  }

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'id': this.id,
      'plate': this.plate,
      'plateDisplay': this.plateDisplay,
      'make': this.make == null ? null : this.make!,
      'model': this.model == null ? null : this.model!,
      'version': this.version == null ? null : this.version!,
      'year': this.year == null ? null : this.year!,
      'vehicleType': this.vehicleType,
      'fuelType': this.fuelType,
      'nickname': this.nickname == null ? null : this.nickname!,
      'archived': this.archived,
      'odometerKm': this.odometerKm == null ? null : this.odometerKm!,
      'odometerSource': this.odometerSource == null ? null : this.odometerSource!.toJson(),
      'odometerUpdatedAt': this.odometerUpdatedAt == null ? null : this.odometerUpdatedAt!,
      'emoji': this.emoji,
      'createdAt': this.createdAt,
      'updatedAt': this.updatedAt,
    };
  }
}
