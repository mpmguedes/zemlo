/**
 * Contratos da API do Zemlo.
 *
 * Este ficheiro define **um único contrato** consumido por:
 *  - a API (validação de entrada com Zod em tempo de execução);
 *  - a app web (tipos inferidos, zero duplicação);
 *  - futuras apps mobile, a integração Home Assistant e integrações de terceiros (§34).
 *
 * Convenções:
 *  - dinheiro em cêntimos inteiros (`amountCents`);
 *  - datas civis em `YYYY-MM-DD`;
 *  - instantes em ISO 8601 UTC;
 *  - listas paginadas por cursor (`{ items, nextCursor }`) porque a timeline de um
 *    veículo cresce indefinidamente e a paginação por offset degrada (§24).
 */

import { z } from 'zod';
import { isCivilDate, isValidTimeZone } from './dates.js';
import { isValidVinFormat } from './pt.js';
import {
  codes,
  DOCUMENT_CATEGORIES,
  EXPENSE_CATEGORIES,
  FUEL_TYPES,
  INSURANCE_COVERAGES,
  INSPECTION_RESULTS,
  MAINTENANCE_TYPES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_FREQUENCIES,
  NOTIFICATION_TOPICS,
  PROVIDER_KINDS,
  REMINDER_STATES,
  REMINDER_TRIGGERS,
  SUGGESTION_TYPES,
  TAX_KINDS,
  VEHICLE_TYPES,
} from './registry.js';

/* -------------------------------------------------------------------------- */
/* Primitivas reutilizáveis                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Data civil `AAAA-MM-DD`, com verificação real do calendário.
 *
 * A verificação de calendário não é um refinamento académico. `new Date('2026-02-30')`
 * não falha em JavaScript: **rola** para 2 de março. Sem esta validação, escrever
 * "30 de fevereiro" e receber `201 Created` grava uma data diferente da que o utilizador
 * escreveu — e no Zemlo estas datas são prazos legais (fim do seguro, IUC, inspeção). O
 * utilizador só descobre o erro se reparar que a data guardada não é a que introduziu.
 *
 * Meses fora do intervalo (`2026-13-01`, `2026-00-10`) produziam um `Invalid Date` que
 * chegava ao Prisma e devolvia 500; aqui são recusados como erro de validação, que é o
 * que são.
 */
export const zCivilDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato AAAA-MM-DD')
  .refine((value) => isCivilDate(value), 'Essa data não existe no calendário. Confirma o dia e o mês.');

export const zInstant = z.string().datetime({ offset: true });

/**
 * Cêntimos inteiros, **não negativos**.
 *
 * Limitar a zero é uma decisão de produto, não de conveniência: uma despesa com valor
 * negativo não tem significado no Zemlo. O produto soma custos (§23), e um único sinal
 * menos — um erro de digitação, uma importação, um cliente que soma reembolsos no mesmo
 * campo — deflaciona em silêncio o total anual, o custo por km e o custo mensal, que são
 * exatamente os números sobre os quais o utilizador decide. Se um dia forem necessários
 * reembolsos, terão uma categoria própria, e o sinal será derivado dela.
 *
 * O limite máximo de 1 000 000 € existe para travar erros de digitação (um ano a mais num
 * valor), não por desconfiança do utilizador.
 */
export const zCents = z.number().int().min(0).max(100_000_000);

/** Cêntimos que podem ser negativos. Usado apenas onde o sinal tem significado real. */
export const zSignedCents = z.number().int().min(-100_000_000).max(100_000_000);

/** Quilometragem: inteiro não negativo, plausível para um veículo rodoviário. */
export const zOdometer = z.number().int().min(0).max(3_000_000);

export const zId = z.string().min(1).max(64);

export const zVehicleType = z.enum(codes(VEHICLE_TYPES));
export const zFuelType = z.enum(codes(FUEL_TYPES));
export const zExpenseCategory = z.enum(codes(EXPENSE_CATEGORIES));
export const zMaintenanceType = z.enum(codes(MAINTENANCE_TYPES));
export const zDocumentCategory = z.enum(codes(DOCUMENT_CATEGORIES));
export const zReminderTrigger = z.enum(codes(REMINDER_TRIGGERS));
export const zSuggestionType = z.enum(codes(SUGGESTION_TYPES));
export const zNotificationChannel = z.enum(codes(NOTIFICATION_CHANNELS));
export const zNotificationTopic = z.enum(codes(NOTIFICATION_TOPICS));
export const zNotificationFrequency = z.enum(codes(NOTIFICATION_FREQUENCIES));
export const zProviderKind = z.enum(codes(PROVIDER_KINDS));

/** Origem de um dado (§50). Fundamental quando existirem várias integrações (§51). */
export const zSource = z
  .object({
    kind: zProviderKind.optional(),
    /** Identificador legível: `Manual`, `API Kia`, `OBD`, `Wallbox Garo`. */
    label: z.string().max(80).optional(),
    /** Identificador técnico da integração, quando aplicável. */
    integrationId: z.string().max(64).nullish(),
    /** Instante em que a fonte observou o dado (pode ser anterior ao registo). */
    observedAt: z.string().datetime({ offset: true }).nullish(),
  })
  .optional();

export const zMoneyIn = z
  .object({
    amountCents: zCents,
    vatCents: zCents.nullish(),
  })
  .optional();

/* -------------------------------------------------------------------------- */
/* Autenticação (§29)                                                          */
/* -------------------------------------------------------------------------- */

export const zEmail = z.string().trim().toLowerCase().email('Email inválido').max(254);

/**
 * Política de passwords: mínimo 10 caracteres (recomendação NIST SP 800-63B para
 * contas sem segundo fator forte), máximo 200 para evitar abuso de hashing (DoS).
 * Não impomos símbolos obrigatórios: reduzem entropia real e empurram o utilizador
 * para padrões previsíveis.
 */
export const zPassword = z
  .string()
  .min(10, 'A password deve ter pelo menos 10 caracteres')
  .max(200)
  .refine((value) => !/^\s|\s$/.test(value), 'A password não pode começar nem acabar com espaços');

export const zSignUpRequest = z.object({
  email: zEmail,
  password: zPassword,
  name: z.string().trim().min(1).max(120).optional(),
  timeZone: z.string().max(64).optional(),
  /** Aceitação dos termos e da política de privacidade (§31). */
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'É necessário aceitar os termos e a política de privacidade' }),
  }),
  /** Código de convite opcional, para futuras organizações/frotas (§32). */
  inviteCode: z.string().max(64).optional(),
});

/**
 * Segundo fator no início de sessão: código TOTP de 6 dígitos **ou** código de
 * recuperação no formato `XXXXX-XXXXX`.
 *
 * Os dois têm de ser aceites pelo mesmo campo: o utilizador que perdeu o telemóvel
 * está, por definição, a usar a aplicação no pior momento possível. Obrigá-lo a
 * encontrar um ecrã diferente para introduzir o código de recuperação — ou pior,
 * recusar-lhe o formato sem explicação — transformaria uma funcionalidade de segurança
 * num bloqueio de conta.
 */
export const zSecondFactor = z
  .string()
  .trim()
  .regex(/^(\d{6}|[A-Za-z0-9]{5}-[A-Za-z0-9]{5})$/, 'Introduz o código de 6 dígitos ou um código de recuperação');

export const zLoginRequest = z.object({
  email: zEmail,
  password: z.string().min(1).max(200),
  totp: zSecondFactor.optional(),
});

export const zChangePasswordRequest = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: zPassword,
  /** Invalida todas as sessões ativas exceto a atual. */
  revokeOtherSessions: z.boolean().optional().default(true),
});

export const zTwoFactorSetupRequest = z.object({
  password: z.string().min(1).max(200),
});

export const zTwoFactorConfirmRequest = z.object({
  secret: z.string().min(16).max(128),
  totp: z.string().regex(/^\d{6}$/),
  /** Códigos de recuperação gerados no arranque da configuração, devolvidos pelo cliente. */
  recoveryCodes: z.array(z.string().min(8).max(32)).optional(),
});

export const zTwoFactorDisableRequest = z.object({
  password: z.string().min(1).max(200),
  totp: z.string().regex(/^\d{6}$/).optional(),
});

export const zUpdateProfileRequest = z.object({
  name: z.string().trim().min(1).max(120).nullish(),
  /**
   * Fuso horário IANA, validado de facto.
   *
   * Aqui não basta limitar o comprimento. `timeZone` determina o que é "hoje" para este
   * utilizador, e "hoje" alimenta a validação de datas, os lembretes em atraso, os
   * alertas de validade e todos os relatórios por mês. Um valor que o motor de datas não
   * conhece — uma gralha, uma string vazia, um identificador obsoleto — deixaria a conta
   * a responder 500 em quase todos os ecrãs, e sem forma de o utilizador se corrigir.
   */
  timeZone: z
    .string()
    .max(64)
    .refine((value) => isValidTimeZone(value), 'Esse fuso horário não é reconhecido.')
    .optional(),
  locale: z.enum(['pt-PT', 'en-GB']).optional(),
  /** Unidade de distância preferida; internamente tudo é km (§ units.ts). */
  distanceUnit: z.enum(['km', 'mi']).optional(),
  volumeUnit: z.enum(['l', 'gal_us', 'gal_uk']).optional(),
  currency: z.literal('EUR').optional(),
});

export const zUpdatePreferencesRequest = z.object({
  notifications: z
    .array(
      z.object({
        topic: zNotificationTopic,
        channel: zNotificationChannel,
        frequency: zNotificationFrequency,
      }),
    )
    .max(64)
    .optional(),
  /** Antecedência, em dias, dos alertas de validade (seguro, inspeção, documentos). */
  reminderLeadDays: z.number().int().min(1).max(180).optional(),
  /** Número de quilómetros de antecedência dos alertas de manutenção. */
  reminderLeadKm: z.number().int().min(10).max(20_000).optional(),
  /** Quando `false`, o Zemlo não gera sugestões contextuais (§7). */
  suggestionsEnabled: z.boolean().optional(),
  /** Oculta sugestões de segurança (2FA) durante este número de dias. */
  securityNudgeSnoozeDays: z.number().int().min(0).max(3650).optional(),
  /** Categorias que o utilizador usa, para priorização da interface (§45). */
  frequentExpenseCategories: z.array(zExpenseCategory).max(32).optional(),
  /** Oculta campos que o utilizador nunca preenche (§45). */
  hiddenFields: z.array(z.string().max(64)).max(64).optional(),
});

/* -------------------------------------------------------------------------- */
/* Veículos (§9, §10)                                                          */
/* -------------------------------------------------------------------------- */

export const zVehicleCreateRequest = z.object({
  /**
   * Apenas a matrícula é realmente necessária (§5). Todo o resto é enriquecimento
   * progressivo (§6) e pode ser acrescentado mais tarde.
   */
  plate: z.string().trim().min(2).max(16),
  make: z.string().trim().max(60).nullish(),
  model: z.string().trim().max(60).nullish(),
  version: z.string().trim().max(80).nullish(),
  year: z.number().int().min(1886).max(2100).nullish(),
  vehicleType: zVehicleType.optional(),
  fuelType: zFuelType.optional(),
  odometerKm: zOdometer.nullish(),
  color: z.string().trim().max(40).nullish(),
  nickname: z.string().trim().max(60).nullish(),
  // Campos avançados (§10) — todos opcionais.
  /**
   * Número de chassis. A **forma** é validada (17 caracteres, sem I, O nem Q); a letra de
   * controlo não é exigida, porque veículos anteriores à norma e alguns mercados não a
   * cumprem e o Zemlo aceita dados atípicos (§49). Um valor que não tenha a forma de um
   * VIN é, esse sim, quase sempre um erro de introdução, e é melhor detetá-lo na entrada
   * do que deixá-lo tornar-se um identificador permanente.
   */
  vin: z
    .string()
    .trim()
    .max(20)
    .refine(
      (value) => value === '' || isValidVinFormat(value),
      'Um VIN tem 17 caracteres e não usa as letras I, O ou Q.',
    )
    .nullish(),
  engineCode: z.string().trim().max(40).nullish(),
  powerCv: z.number().int().min(1).max(3000).nullish(),
  engineDisplacementCc: z.number().int().min(1).max(20_000).nullish(),
  transmission: z.enum(['manual', 'automatic', 'semi_automatic', 'other']).nullish(),
  drivetrain: z.enum(['fwd', 'rwd', 'awd', 'other']).nullish(),
  batteryCapacityKwh: z.number().min(0).max(1000).nullish(),
  usableBatteryKwh: z.number().min(0).max(1000).nullish(),
  rangeKm: z.number().int().min(0).max(3000).nullish(),
  tankCapacityL: z.number().min(0).max(2000).nullish(),
  tyreSize: z.string().trim().max(40).nullish(),
  wheelSize: z.string().trim().max(40).nullish(),
  weightKg: z.number().int().min(0).max(60_000).nullish(),
  co2GKm: z.number().int().min(0).max(2000).nullish(),
  purchaseDate: zCivilDate.nullish(),
  purchasePriceCents: zCents.nullish(),
  purchaseOdometerKm: zOdometer.nullish(),
  registrationDate: zCivilDate.nullish(),
  firstRegistrationDate: zCivilDate.nullish(),
  notes: z.string().max(4000).nullish(),
  source: zSource,
});

export const zVehicleUpdateRequest = zVehicleCreateRequest
  .omit({ plate: true, source: true })
  .partial()
  .extend({
    plate: z.string().trim().min(2).max(16).optional(),
    /** Arquiva sem eliminar: mantém o histórico de um veículo vendido (§24). */
    archived: z.boolean().optional(),
    /** Marca explícita para a quilometragem, que alimenta a validação de progressão (§11). */
    odometerSource: zProviderKind.optional(),
  });

export const zVehicleListQuery = z.object({
  includeArchived: z.coerce.boolean().optional().default(false),
});

export const zOdometerCreateRequest = z.object({
  odometerKm: zOdometer,
  recordedAt: zCivilDate.optional(),
  source: zSource,
  notes: z.string().max(1000).nullish(),
  /**
   * A validação de progressão (§11) pede confirmação quando a quilometragem
   * recua. O cliente reenvia com `confirmRegression: true` depois de o utilizador
   * confirmar que corrigiu o valor.
   */
  confirmRegression: z.boolean().optional().default(false),
});

export const zOdometerCorrectionRequest = z.object({
  odometerKm: zOdometer,
  reason: z.string().trim().min(3).max(500),
  recordedAt: zCivilDate.optional(),
});

/* -------------------------------------------------------------------------- */
/* Despesas (§12)                                                              */
/* -------------------------------------------------------------------------- */

export const zExpenseCreateRequest = z.object({
  /** Campos mínimos: valor, categoria, data. Tudo o resto é opcional. */
  amountCents: zCents.refine((value) => value !== 0, 'O valor não pode ser zero'),
  category: zExpenseCategory,
  date: zCivilDate.optional(),
  vehicleId: zId.optional(),
  vendor: z.string().trim().max(120).nullish(),
  odometerKm: zOdometer.nullish(),
  description: z.string().trim().max(500).nullish(),
  vatCents: zCents.nullish(),
  paymentMethod: z
    .enum(['cash', 'card', 'transfer', 'direct_debit', 'mbway', 'voucher', 'other'])
    .nullish(),
  paid: z.boolean().optional().default(true),
  /** Liga a despesa ao registo que a originou (abastecimento, manutenção, ...). */
  linkedRecordId: zId.nullish(),
  notes: z.string().max(4000).nullish(),
  source: zSource,
});

export const zExpenseUpdateRequest = zExpenseCreateRequest.partial().omit({ source: true });

export const zListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  cursor: z.string().max(200).optional(),
  from: zCivilDate.optional(),
  to: zCivilDate.optional(),
  category: zExpenseCategory.optional(),
  vehicleId: zId.optional(),
});

/* -------------------------------------------------------------------------- */
/* Abastecimentos (§13)                                                        */
/* -------------------------------------------------------------------------- */

export const zFuelCreateRequest = z.object({
  date: zCivilDate.optional(),
  vehicleId: zId.optional(),
  litres: z.number().positive().max(2000),
  amountCents: zCents.refine((value) => value !== 0, 'O valor não pode ser zero'),
  pricePerLitreCents: z.number().int().min(0).max(100_000).nullish(),
  odometerKm: zOdometer.nullish(),
  /** Enchimento completo: pré-requisito para o cálculo exato de consumo. */
  fullTank: z.boolean().optional().default(true),
  station: z.string().trim().max(120).nullish(),
  fuelType: zFuelType.nullish(),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  paymentMethod: z.enum(['cash', 'card', 'transfer', 'direct_debit', 'mbway', 'voucher', 'other']).nullish(),
  notes: z.string().max(4000).nullish(),
  source: zSource,
});

export const zFuelUpdateRequest = zFuelCreateRequest.partial().omit({ source: true });

/* -------------------------------------------------------------------------- */
/* Carregamentos (§14)                                                         */
/* -------------------------------------------------------------------------- */

export const zChargingCreateRequest = z.object({
  date: zCivilDate.optional(),
  vehicleId: zId.optional(),
  energyKwh: z.number().positive().max(2000),
  amountCents: zCents.min(0, 'O custo do carregamento não pode ser negativo'),
  odometerKm: zOdometer.nullish(),
  location: z.string().trim().max(120).nullish(),
  charger: z.string().trim().max(120).nullish(),
  durationMinutes: z.number().int().min(0).max(20_160).nullish(),
  /**
   * Estado de carga, em **percentagem** (0–100).
   *
   * Admitir também a fração 0–1 tornava `0.5` irrecuperavelmente ambíguo: podia significar
   * meio por cento ou cinquenta por cento, e depois de gravado já não havia forma de saber
   * qual. Um estado de carga errado distorce o consumo energético e a autonomia estimada,
   * que são números que o utilizador usa para planear viagens. Uma unidade, e só uma.
   */
  startSocPercent: z.number().min(0).max(100).nullish(),
  endSocPercent: z.number().min(0).max(100).nullish(),
  powerKw: z.number().min(0).max(1000).nullish(),
  provider: z.string().trim().max(120).nullish(),
  tariff: z.string().trim().max(120).nullish(),
  isPublic: z.boolean().nullish(),
  isHome: z.boolean().nullish(),
  notes: z.string().max(4000).nullish(),
  source: zSource,
});

export const zChargingUpdateRequest = zChargingCreateRequest.partial().omit({ source: true });

/* -------------------------------------------------------------------------- */
/* Manutenção (§15, §16)                                                       */
/* -------------------------------------------------------------------------- */

export const zMaintenanceCreateRequest = z.object({
  date: zCivilDate.optional(),
  /** Ver a nota em `zInspectionCreateRequest`: o `vehicleId` tem de ser declarado. */
  vehicleId: zId.optional(),
  type: zMaintenanceType,
  odometerKm: zOdometer.nullish(),
  amountCents: zCents.nullish(),
  workshop: z.string().trim().max(120).nullish(),
  description: z.string().trim().max(1000).nullish(),
  partsCents: zCents.nullish(),
  labourCents: zCents.nullish(),
  /** Cria automaticamente o lembrete da próxima intervenção (§16). */
  nextDueDate: zCivilDate.nullish(),
  nextDueOdometerKm: zOdometer.nullish(),
  /** Atalho: cria o próximo lembrete a `intervalMonths` e/ou `intervalKm` da data/odómetro. */
  intervalMonths: z.number().int().min(1).max(240).nullish(),
  intervalKm: z.number().int().min(100).max(500_000).nullish(),
  warrantyMonths: z.number().int().min(0).max(600).nullish(),
  notes: z.string().max(4000).nullish(),
  source: zSource,
});

export const zMaintenanceUpdateRequest = zMaintenanceCreateRequest.partial().omit({ source: true });

/* -------------------------------------------------------------------------- */
/* Seguro (§18)                                                                */
/* -------------------------------------------------------------------------- */

export const zInsuranceCreateRequest = z.object({
  /** Ver a nota em `zInspectionCreateRequest`: o `vehicleId` tem de ser declarado. */
  vehicleId: zId.optional(),
  insurer: z.string().trim().min(1).max(120),
  policyNumber: z.string().trim().max(80).nullish(),
  startDate: zCivilDate,
  endDate: zCivilDate,
  premiumCents: zCents.nullish(),
  coverage: z.enum(codes(INSURANCE_COVERAGES)).nullish(),
  deductibleCents: zCents.nullish(),
  contactPhone: z.string().trim().max(40).nullish(),
  documentId: zId.nullish(),
  notes: z.string().max(4000).nullish(),
  source: zSource,
});

export const zInsuranceUpdateRequest = zInsuranceCreateRequest.partial().omit({ source: true });

/* -------------------------------------------------------------------------- */
/* Inspeção (§19)                                                              */
/* -------------------------------------------------------------------------- */

export const zInspectionCreateRequest = z.object({
  date: zCivilDate,
  /**
   * Veículo a que o registo pertence.
   *
   * Presente **explicitamente** em todos os esquemas de criação: o Zod remove por
   * omissão as chaves que não conhece, pelo que um `vehicleId` não declarado seria
   * descartado em silêncio e o registo acabaria no veículo mais recente do utilizador —
   * sem qualquer erro de HTTP a assinalá-lo.
   */
  vehicleId: zId.optional(),
  result: z.enum(codes(INSPECTION_RESULTS)).optional().default('passed'),
  odometerKm: zOdometer.nullish(),
  amountCents: zCents.nullish(),
  nextDueDate: zCivilDate.nullish(),
  station: z.string().trim().max(120).nullish(),
  defects: z.string().trim().max(2000).nullish(),
  documentId: zId.nullish(),
  notes: z.string().max(4000).nullish(),
  source: zSource,
});

export const zInspectionUpdateRequest = zInspectionCreateRequest.partial().omit({ source: true });

/* -------------------------------------------------------------------------- */
/* Impostos (§20)                                                              */
/* -------------------------------------------------------------------------- */

export const zTaxCreateRequest = z.object({
  /** Ver a nota em `zInspectionCreateRequest`: o `vehicleId` tem de ser declarado. */
  vehicleId: zId.optional(),
  kind: z.enum(codes(TAX_KINDS)).optional().default('iuc'),
  year: z.number().int().min(1900).max(2100),
  amountCents: zCents,
  date: zCivilDate.optional(),
  paid: z.boolean().optional().default(true),
  dueDate: zCivilDate.nullish(),
  documentId: zId.nullish(),
  notes: z.string().max(4000).nullish(),
  source: zSource,
});

export const zTaxUpdateRequest = zTaxCreateRequest.partial().omit({ source: true });

/* -------------------------------------------------------------------------- */
/* Documentos (§17)                                                            */
/* -------------------------------------------------------------------------- */

export const zDocumentCreateRequest = z.object({
  name: z.string().trim().min(1).max(160),
  category: zDocumentCategory,
  date: zCivilDate.nullish(),
  expiresAt: zCivilDate.nullish(),
  vehicleId: zId.nullish(),
  /** Nome do ficheiro já carregado. O conteúdo vive em armazenamento de objetos (§17). */
  fileName: z.string().max(255).nullish(),
  mimeType: z.string().max(120).nullish(),
  sizeBytes: z.number().int().min(0).max(200_000_000).nullish(),
  /** Referência opaca ao ficheiro no armazenamento; a API não serve bytes diretamente no MVP. */
  storageKey: z.string().max(512).nullish(),
  notes: z.string().max(4000).nullish(),
  source: zSource,
});

export const zDocumentUpdateRequest = zDocumentCreateRequest.partial().omit({ source: true });

/* -------------------------------------------------------------------------- */
/* Lembretes e manutenção preventiva (§16, §21, §22)                           */
/* -------------------------------------------------------------------------- */

export const zReminderCreateRequest = z.object({
  vehicleId: zId,
  title: z.string().trim().min(1).max(160),
  trigger: zReminderTrigger,
  dueDate: zCivilDate.nullish(),
  dueOdometerKm: zOdometer.nullish(),
  intervalMonths: z.number().int().min(1).max(240).nullish(),
  intervalKm: z.number().int().min(100).max(500_000).nullish(),
  /** Repete automaticamente após conclusão, usando os intervalos definidos. */
  repeat: z.boolean().optional().default(false),
  notes: z.string().max(2000).nullish(),
  /** Idempotência: evita lembretes duplicados criados pelo mesmo fluxo. */
  dedupeKey: z.string().max(120).nullish(),
  source: zSource,
});

export const zReminderUpdateRequest = zReminderCreateRequest.partial().omit({ vehicleId: true, source: true });

export const zReminderCompleteRequest = z.object({
  completedAt: zCivilDate.optional(),
  odometerKm: zOdometer.nullish(),
  amountCents: zCents.nullish(),
  /** Cria automaticamente a próxima ocorrência quando `repeat` está ativo. */
  createNext: z.boolean().optional().default(true),
  notes: z.string().max(2000).nullish(),
});

export const zReminderListQuery = z.object({
  vehicleId: zId.optional(),
  state: z.enum(codes(REMINDER_STATES)).optional(),
  includeCompleted: z.coerce.boolean().optional().default(false),
  windowDays: z.coerce.number().int().min(1).max(730).optional().default(180),
  windowKm: z.coerce.number().int().min(1).max(100_000).optional().default(5000),
});

/* -------------------------------------------------------------------------- */
/* Dashboard, timeline e estatísticas (§8, §23, §24)                           */
/* -------------------------------------------------------------------------- */

export const zDashboardQuery = z.object({
  vehicleId: zId.optional(),
});

export const zTimelineQuery = z.object({
  vehicleId: zId.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(40),
  cursor: z.string().max(200).optional(),
  kinds: z.string().max(400).optional(),
  from: zCivilDate.optional(),
  to: zCivilDate.optional(),
});

export const zStatsQuery = z.object({
  vehicleId: zId.optional(),
  /** Ano civil; por omissão o ano corrente do fuso do utilizador. */
  year: z.coerce.number().int().min(1900).max(2100).optional(),
  /** Número de meses do histórico apresentado nos gráficos. */
  months: z.coerce.number().int().min(1).max(120).optional().default(12),
});

export const zCalendarQuery = z.object({
  from: zCivilDate,
  to: zCivilDate,
  vehicleId: zId.optional(),
});

/* -------------------------------------------------------------------------- */
/* Sugestões (§7) e notificações (§22)                                         */
/* -------------------------------------------------------------------------- */

export const zSuggestionActionRequest = z.object({
  action: z.enum(['done', 'dismiss', 'snooze', 'never']),
  /** Dias de adiamento quando `action` é `snooze`. */
  snoozeDays: z.number().int().min(1).max(365).optional().default(14),
});

export const zNotificationsQuery = z.object({
  unreadOnly: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  cursor: z.string().max(200).optional(),
});

export const zNotificationsReadRequest = z.object({
  ids: z.array(zId).max(200).optional(),
  all: z.boolean().optional(),
});

/* -------------------------------------------------------------------------- */
/* Integrações (§26, §27)                                                      */
/* -------------------------------------------------------------------------- */

export const zIntegrationCreateRequest = z.object({
  category: z.enum(['manufacturer', 'home_assistant', 'wallbox', 'obd', 'charging_network', 'other']),
  provider: z.string().trim().min(1).max(80),
  label: z.string().trim().max(120).nullish(),
  vehicleId: zId.nullish(),
  /** Configuração não sensível. Segredos vivem em `credentials`, cifrados em repouso (§30). */
  config: z.record(z.unknown()).optional(),
  credentials: z.record(z.string().max(4096)).optional(),
  enabled: z.boolean().optional().default(true),
});

export const zIntegrationUpdateRequest = zIntegrationCreateRequest.partial().omit({ category: true, provider: true });

/* -------------------------------------------------------------------------- */
/* Exportação (§54) e conta                                                    */
/* -------------------------------------------------------------------------- */

export const zExportQuery = z.object({
  format: z.enum(['json', 'csv']).optional().default('json'),
  vehicleId: zId.optional(),
  from: zCivilDate.optional(),
  to: zCivilDate.optional(),
});

export const zDeleteAccountRequest = z.object({
  password: z.string().min(1).max(200).optional(),
  totp: z.string().regex(/^\d{6}$/).optional(),
  confirm: z.literal('ELIMINAR', {
    errorMap: () => ({ message: 'Escreve ELIMINAR para confirmar a eliminação da conta' }),
  }),
});

/* -------------------------------------------------------------------------- */
/* Tipos inferidos — a superfície pública do contrato                          */
/* -------------------------------------------------------------------------- */

export type SignUpRequest = z.infer<typeof zSignUpRequest>;
export type LoginRequest = z.infer<typeof zLoginRequest>;
export type ChangePasswordRequest = z.infer<typeof zChangePasswordRequest>;
export type TwoFactorSetupRequest = z.infer<typeof zTwoFactorSetupRequest>;
export type TwoFactorConfirmRequest = z.infer<typeof zTwoFactorConfirmRequest>;
export type TwoFactorDisableRequest = z.infer<typeof zTwoFactorDisableRequest>;
export type UpdateProfileRequest = z.infer<typeof zUpdateProfileRequest>;
export type UpdatePreferencesRequest = z.infer<typeof zUpdatePreferencesRequest>;

export type VehicleCreateRequest = z.infer<typeof zVehicleCreateRequest>;
export type VehicleUpdateRequest = z.infer<typeof zVehicleUpdateRequest>;
export type OdometerCreateRequest = z.infer<typeof zOdometerCreateRequest>;
export type OdometerCorrectionRequest = z.infer<typeof zOdometerCorrectionRequest>;

export type ExpenseCreateRequest = z.infer<typeof zExpenseCreateRequest>;
export type ExpenseUpdateRequest = z.infer<typeof zExpenseUpdateRequest>;
export type FuelCreateRequest = z.infer<typeof zFuelCreateRequest>;
export type FuelUpdateRequest = z.infer<typeof zFuelUpdateRequest>;
export type ChargingCreateRequest = z.infer<typeof zChargingCreateRequest>;
export type ChargingUpdateRequest = z.infer<typeof zChargingUpdateRequest>;
export type MaintenanceCreateRequest = z.infer<typeof zMaintenanceCreateRequest>;
export type MaintenanceUpdateRequest = z.infer<typeof zMaintenanceUpdateRequest>;
export type InsuranceCreateRequest = z.infer<typeof zInsuranceCreateRequest>;
export type InsuranceUpdateRequest = z.infer<typeof zInsuranceUpdateRequest>;
export type InspectionCreateRequest = z.infer<typeof zInspectionCreateRequest>;
export type InspectionUpdateRequest = z.infer<typeof zInspectionUpdateRequest>;
export type TaxCreateRequest = z.infer<typeof zTaxCreateRequest>;
export type TaxUpdateRequest = z.infer<typeof zTaxUpdateRequest>;
export type DocumentCreateRequest = z.infer<typeof zDocumentCreateRequest>;
export type DocumentUpdateRequest = z.infer<typeof zDocumentUpdateRequest>;
export type ReminderCreateRequest = z.infer<typeof zReminderCreateRequest>;
export type ReminderUpdateRequest = z.infer<typeof zReminderUpdateRequest>;
export type ReminderCompleteRequest = z.infer<typeof zReminderCompleteRequest>;
export type ReminderListQuery = z.infer<typeof zReminderListQuery>;
export type ListQuery = z.infer<typeof zListQuery>;
export type TimelineQuery = z.infer<typeof zTimelineQuery>;
export type StatsQuery = z.infer<typeof zStatsQuery>;
export type CalendarQuery = z.infer<typeof zCalendarQuery>;
export type DashboardQuery = z.infer<typeof zDashboardQuery>;
export type SuggestionActionRequest = z.infer<typeof zSuggestionActionRequest>;
export type NotificationsQuery = z.infer<typeof zNotificationsQuery>;
export type NotificationsReadRequest = z.infer<typeof zNotificationsReadRequest>;
export type IntegrationCreateRequest = z.infer<typeof zIntegrationCreateRequest>;
export type IntegrationUpdateRequest = z.infer<typeof zIntegrationUpdateRequest>;
export type ExportQuery = z.infer<typeof zExportQuery>;
export type DeleteAccountRequest = z.infer<typeof zDeleteAccountRequest>;
