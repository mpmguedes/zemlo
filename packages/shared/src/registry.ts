/**
 * Registo de domínio do Zemlo.
 *
 * Este ficheiro é a **fonte única de verdade** para todos os conjuntos fechados de
 * valores do produto (categorias de despesa, tipos de manutenção, tipos de evento,
 * tipos de veículo, ...).
 *
 * Decisão de arquitetura (ver `docs/DECISIONS.md`):
 * as categorias são guardadas na base de dados como `String` validada por este
 * registo, e **não** como `enum` do Prisma/PostgreSQL. Motivos:
 *  1. o mesmo schema Prisma é portável entre PostgreSQL (produção) e SQLite (local);
 *  2. acrescentar uma categoria nova não obriga a uma migração de tipo na base de dados;
 *  3. o produto é explicitamente concebido para crescer sem crescer em complexidade (§62).
 */

export interface OptionMeta {
  /** Código estável persistido na base de dados. Nunca traduzir nem renomear. */
  readonly code: string;
  /** Etiqueta em português apresentada ao utilizador. */
  readonly label: string;
  /** Emoji/ícone textual usado em listas compactas. */
  readonly icon: string;
  /** Ordem de apresentação (ascendente). */
  readonly order: number;
  /** Indica se a categoria é considerada "energia" (combustível/carregamento). */
  readonly energy?: boolean;
  /** Indica se representa um custo fixo recorrente (seguro, imposto, inspeção). */
  readonly recurring?: boolean;
}

function freeze<T extends readonly OptionMeta[]>(items: T): T {
  for (const item of items) Object.freeze(item);
  return Object.freeze(items) as unknown as T;
}

/* -------------------------------------------------------------------------- */
/* Tipos de veículo                                                            */
/* -------------------------------------------------------------------------- */

export const VEHICLE_TYPES = freeze([
  { code: 'car', label: 'Automóvel', icon: '🚗', order: 10 },
  { code: 'suv', label: 'SUV / TT', icon: '🚙', order: 20 },
  { code: 'van', label: 'Furgão', icon: '🚐', order: 30 },
  { code: 'motorcycle', label: 'Motociclo', icon: '🏍️', order: 40 },
  { code: 'scooter', label: 'Scooter', icon: '🛵', order: 50 },
  { code: 'bicycle', label: 'Bicicleta', icon: '🚲', order: 60 },
  { code: 'quad', label: 'Quadriciclo', icon: '🏎️', order: 70 },
  { code: 'truck', label: 'Comercial', icon: '🚚', order: 80 },
  { code: 'camper', label: 'Autocaravana', icon: '🚌', order: 90 },
  { code: 'other', label: 'Outro', icon: '🚘', order: 999 },
]);

/* -------------------------------------------------------------------------- */
/* Combustíveis / propulsão                                                    */
/* -------------------------------------------------------------------------- */

export const FUEL_TYPES = freeze([
  { code: 'gasoline', label: 'Gasolina', icon: '⛽', order: 10, energy: true },
  { code: 'diesel', label: 'Gasóleo', icon: '⛽', order: 20, energy: true },
  { code: 'lpg', label: 'GPL', icon: '⛽', order: 30, energy: true },
  { code: 'cng', label: 'GNC', icon: '⛽', order: 40, energy: true },
  { code: 'hybrid', label: 'Híbrido', icon: '🔋', order: 50, energy: true },
  { code: 'phev', label: 'Híbrido plug-in', icon: '🔌', order: 60, energy: true },
  { code: 'electric', label: 'Elétrico', icon: '⚡', order: 70, energy: true },
  { code: 'hydrogen', label: 'Hidrogénio', icon: '💧', order: 80, energy: true },
  { code: 'other', label: 'Outro', icon: '❓', order: 999 },
]);

/* -------------------------------------------------------------------------- */
/* Categorias de despesa (§12)                                                 */
/* -------------------------------------------------------------------------- */

export const EXPENSE_CATEGORIES = freeze([
  { code: 'fuel', label: 'Combustível', icon: '⛽', order: 10, energy: true },
  { code: 'charging', label: 'Carregamento', icon: '🔌', order: 20, energy: true },
  { code: 'maintenance', label: 'Manutenção', icon: '🔧', order: 30 },
  { code: 'tyres', label: 'Pneus', icon: '🛞', order: 40 },
  { code: 'insurance', label: 'Seguro', icon: '🛡️', order: 50, recurring: true },
  { code: 'tax', label: 'Imposto (IUC)', icon: '🏛️', order: 60, recurring: true },
  { code: 'inspection', label: 'Inspeção', icon: '📋', order: 70, recurring: true },
  { code: 'wash', label: 'Lavagem', icon: '🚿', order: 80 },
  { code: 'parking', label: 'Estacionamento', icon: '🅿️', order: 90 },
  { code: 'tolls', label: 'Portagens', icon: '🛣️', order: 100 },
  { code: 'repairs', label: 'Reparações', icon: '🛠️', order: 110 },
  { code: 'accessories', label: 'Acessórios', icon: '🧰', order: 120 },
  { code: 'fines', label: 'Multas', icon: '⚠️', order: 130 },
  { code: 'other', label: 'Outros', icon: '📦', order: 999 },
]);

/* -------------------------------------------------------------------------- */
/* Tipos de manutenção (§15)                                                   */
/* -------------------------------------------------------------------------- */

export const MAINTENANCE_TYPES = freeze([
  { code: 'service', label: 'Revisão', icon: '🔧', order: 10 },
  { code: 'oil', label: 'Mudança de óleo', icon: '🛢️', order: 20 },
  { code: 'filters', label: 'Filtros', icon: '🧽', order: 30 },
  { code: 'brakes', label: 'Travões', icon: '🛑', order: 40 },
  { code: 'tyres', label: 'Pneus', icon: '🛞', order: 50 },
  { code: 'battery', label: 'Bateria 12V', icon: '🔋', order: 60 },
  { code: 'timing', label: 'Correia de distribuição', icon: '⚙️', order: 70 },
  { code: 'suspension', label: 'Suspensão', icon: '🔩', order: 80 },
  { code: 'clutch', label: 'Embraiagem', icon: '⚙️', order: 90 },
  { code: 'ac', label: 'Ar condicionado', icon: '❄️', order: 100 },
  { code: 'diagnostics', label: 'Diagnóstico', icon: '🔍', order: 110 },
  { code: 'bodywork', label: 'Chapa e pintura', icon: '🎨', order: 120 },
  { code: 'software', label: 'Atualização de software', icon: '💾', order: 130 },
  { code: 'recall', label: 'Campanha / recall', icon: '📢', order: 140 },
  { code: 'other', label: 'Outro', icon: '📦', order: 999 },
]);

/* -------------------------------------------------------------------------- */
/* Categorias de documento (§17)                                               */
/* -------------------------------------------------------------------------- */

export const DOCUMENT_CATEGORIES = freeze([
  { code: 'registration', label: 'Documento Único Automóvel', icon: '📄', order: 10 },
  { code: 'insurance', label: 'Seguro / apólice', icon: '🛡️', order: 20 },
  { code: 'inspection', label: 'Inspeção', icon: '📋', order: 30 },
  { code: 'invoice', label: 'Fatura', icon: '🧾', order: 40 },
  { code: 'receipt', label: 'Recibo', icon: '🧾', order: 50 },
  { code: 'maintenance', label: 'Manutenção', icon: '🔧', order: 60 },
  { code: 'warranty', label: 'Garantia', icon: '✅', order: 70 },
  { code: 'tax', label: 'Imposto', icon: '🏛️', order: 80 },
  { code: 'certificate', label: 'Certificado', icon: '🎖️', order: 90 },
  { code: 'photo', label: 'Fotografia', icon: '📷', order: 100 },
  { code: 'other', label: 'Outro', icon: '📦', order: 999 },
]);

/* -------------------------------------------------------------------------- */
/* Tipos de evento (§33)                                                       */
/* -------------------------------------------------------------------------- */

export const EVENT_TYPES = freeze([
  { code: 'vehicle.created', label: 'Veículo criado', icon: '🚗', order: 10 },
  { code: 'vehicle.updated', label: 'Veículo atualizado', icon: '✏️', order: 20 },
  { code: 'odometer.recorded', label: 'Quilometragem', icon: '📍', order: 30 },
  { code: 'expense.created', label: 'Despesa', icon: '💶', order: 40 },
  { code: 'fuel.created', label: 'Abastecimento', icon: '⛽', order: 50 },
  { code: 'charging.created', label: 'Carregamento', icon: '🔌', order: 60 },
  { code: 'maintenance.created', label: 'Manutenção', icon: '🔧', order: 70 },
  { code: 'insurance.created', label: 'Seguro', icon: '🛡️', order: 80 },
  { code: 'inspection.created', label: 'Inspeção', icon: '📋', order: 90 },
  { code: 'tax.created', label: 'Imposto', icon: '🏛️', order: 100 },
  { code: 'document.created', label: 'Documento', icon: '📄', order: 110 },
  { code: 'reminder.created', label: 'Lembrete criado', icon: '🔔', order: 120 },
  { code: 'reminder.completed', label: 'Lembrete concluído', icon: '✅', order: 130 },
  { code: 'document.expiring', label: 'Documento a expirar', icon: '⏳', order: 140 },
  { code: 'odometer.corrected', label: 'Quilometragem corrigida', icon: '↩️', order: 150 },
  { code: 'note', label: 'Nota', icon: '📝', order: 160 },
]);

/* -------------------------------------------------------------------------- */
/* Estado de lembretes                                                         */
/* -------------------------------------------------------------------------- */

/** Um lembrete dispara por km, por tempo, ou pelo que ocorrer primeiro (§16). */
export const REMINDER_TRIGGERS = freeze([
  { code: 'distance', label: 'Por quilometragem', icon: '📍', order: 10 },
  { code: 'time', label: 'Por tempo', icon: '🗓️', order: 20 },
  { code: 'both', label: 'Km ou tempo (o que ocorrer primeiro)', icon: '⏱️', order: 30 },
]);

export const REMINDER_STATES = freeze([
  { code: 'ok', label: 'Em dia', icon: '✅', order: 10 },
  { code: 'soon', label: 'Em breve', icon: '⏳', order: 20 },
  { code: 'due', label: 'Vence agora', icon: '🔔', order: 30 },
  { code: 'overdue', label: 'Em atraso', icon: '⚠️', order: 40 },
  { code: 'unknown', label: 'Sem dados suficientes', icon: '❔', order: 50 },
]);

/* -------------------------------------------------------------------------- */
/* Tipos de sugestão (§7)                                                      */
/* -------------------------------------------------------------------------- */

export const SUGGESTION_TYPES = freeze([
  { code: 'vehicle.add_odometer', label: 'Adicionar quilometragem', icon: '📍', order: 10 },
  { code: 'vehicle.add_insurance', label: 'Guardar seguro', icon: '🛡️', order: 20 },
  { code: 'vehicle.add_inspection', label: 'Registar inspeção', icon: '📋', order: 30 },
  { code: 'vehicle.add_maintenance_plan', label: 'Definir próxima manutenção', icon: '🔧', order: 40 },
  { code: 'vehicle.add_details', label: 'Completar ficha do veículo', icon: '📄', order: 50 },
  { code: 'expense.add_odometer', label: 'Km para calcular custo/km', icon: '📐', order: 60 },
  { code: 'account.enable_2fa', label: 'Proteger conta com 2FA', icon: '🔐', order: 70 },
  { code: 'documents.add_first', label: 'Guardar documentos', icon: '📁', order: 80 },
]);

/* -------------------------------------------------------------------------- */
/* Acessos rápidos do dashboard (§8) e tipos de registo                        */
/* -------------------------------------------------------------------------- */

export const QUICK_ACTIONS = freeze([
  { code: 'expense', label: 'Despesa', icon: '💶', order: 10 },
  { code: 'fuel', label: 'Abastecimento', icon: '⛽', order: 20 },
  { code: 'charging', label: 'Carregamento', icon: '🔌', order: 30 },
  { code: 'maintenance', label: 'Manutenção', icon: '🔧', order: 40 },
  { code: 'odometer', label: 'Quilometragem', icon: '📍', order: 50 },
]);

/** Tipos de registo que qualquer veículo pode receber. */
export const RECORD_KINDS = freeze([
  { code: 'expense', label: 'Despesa', icon: '💶', order: 10 },
  { code: 'fuel', label: 'Abastecimento', icon: '⛽', order: 20 },
  { code: 'charging', label: 'Carregamento', icon: '🔌', order: 30 },
  { code: 'maintenance', label: 'Manutenção', icon: '🔧', order: 40 },
  { code: 'odometer', label: 'Quilometragem', icon: '📍', order: 50 },
]);

/* -------------------------------------------------------------------------- */
/* Preferências de notificação (§22)                                           */
/* -------------------------------------------------------------------------- */

export const NOTIFICATION_CHANNELS = freeze([
  { code: 'push', label: 'Notificações push', icon: '📱', order: 10 },
  { code: 'email', label: 'Email', icon: '✉️', order: 20 },
  { code: 'in_app', label: 'No Zemlo', icon: '🔔', order: 30 },
]);

export const NOTIFICATION_TOPICS = freeze([
  { code: 'maintenance', label: 'Manutenção', icon: '🔧', order: 10 },
  { code: 'inspection', label: 'Inspeção', icon: '📋', order: 20 },
  { code: 'insurance', label: 'Seguro', icon: '🛡️', order: 30 },
  { code: 'tax', label: 'Impostos', icon: '🏛️', order: 40 },
  { code: 'document', label: 'Documentos', icon: '📄', order: 50 },
  { code: 'summary', label: 'Resumo periódico', icon: '📊', order: 60 },
  { code: 'security', label: 'Segurança da conta', icon: '🔐', order: 70 },
]);

export const NOTIFICATION_FREQUENCIES = freeze([
  { code: 'immediate', label: 'Imediatamente', icon: '⚡', order: 10 },
  { code: 'daily', label: 'Resumo diário', icon: '☀️', order: 20 },
  { code: 'weekly', label: 'Resumo semanal', icon: '🗓️', order: 30 },
  { code: 'off', label: 'Desligado', icon: '🔕', order: 40 },
]);

/* -------------------------------------------------------------------------- */
/* Integrações (§26)                                                           */
/* -------------------------------------------------------------------------- */

export const INTEGRATION_CATEGORIES = freeze([
  { code: 'manufacturer', label: 'Fabricante', icon: '🏭', order: 10 },
  { code: 'home_assistant', label: 'Home Assistant', icon: '🏠', order: 20 },
  { code: 'wallbox', label: 'Wallbox', icon: '🔌', order: 30 },
  { code: 'obd', label: 'OBD', icon: '🔎', order: 40 },
  { code: 'charging_network', label: 'Rede de carregamento', icon: '⚡', order: 50 },
  { code: 'other', label: 'Outra', icon: '🔗', order: 999 },
]);

export const PROVIDER_KINDS = freeze([
  { code: 'manual', label: 'Manual', icon: '✍️', order: 10 },
  { code: 'api', label: 'API', icon: '🔗', order: 20 },
  { code: 'obd', label: 'OBD', icon: '🔎', order: 30 },
  { code: 'import', label: 'Importação', icon: '📥', order: 40 },
  { code: 'document', label: 'Documento', icon: '📄', order: 50 },
  { code: 'estimated', label: 'Estimado', icon: '📐', order: 60 },
]);

/* -------------------------------------------------------------------------- */
/* Coberturas de seguro (§18)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Níveis de cobertura de uma apólice.
 *
 * Estavam declarados em linha no esquema de validação, sem etiquetas nem ícones — o único
 * conjunto fechado do produto nessa situação. Consequência prática: a aplicação web tinha
 * de manter a sua própria cópia dos códigos e das etiquetas, que é exatamente a duplicação
 * que o registo existe para evitar. Um código novo na API passaria a aparecer sem nome na
 * interface, ou com um nome diferente do que o utilizador vê no resto da aplicação.
 */
export const INSURANCE_COVERAGES = freeze([
  { code: 'third_party', label: 'Responsabilidade civil', icon: '🛡️', order: 10 },
  { code: 'third_party_fire_theft', label: 'Terceiros, furto e incêndio', icon: '🛡️', order: 20 },
  { code: 'comprehensive', label: 'Danos próprios', icon: '🛡️', order: 30 },
  { code: 'other', label: 'Outra cobertura', icon: '📄', order: 999 },
]);

/* -------------------------------------------------------------------------- */
/* Tipos de imposto (§20)                                                      */
/* -------------------------------------------------------------------------- */

export const TAX_KINDS = freeze([
  { code: 'iuc', label: 'IUC', icon: '🏛️', order: 10, recurring: true },
  { code: 'isv', label: 'ISV', icon: '🏛️', order: 20 },
  { code: 'toll_device', label: 'Identificador de portagens', icon: '🛣️', order: 30 },
  { code: 'other', label: 'Outro imposto', icon: '📄', order: 999 },
]);

/* -------------------------------------------------------------------------- */
/* Resultados de inspeção (§19)                                                */
/* -------------------------------------------------------------------------- */

export const INSPECTION_RESULTS = freeze([
  { code: 'passed', label: 'Aprovada', icon: '✅', order: 10 },
  { code: 'passed_with_defects', label: 'Aprovada com deficiências', icon: '⚠️', order: 20 },
  { code: 'failed', label: 'Reprovada', icon: '❌', order: 30 },
  { code: 'pending', label: 'Pendente', icon: '⏳', order: 40 },
]);

/* -------------------------------------------------------------------------- */
/* Métodos de pagamento                                                        */
/* -------------------------------------------------------------------------- */

export const PAYMENT_METHODS = freeze([
  { code: 'cash', label: 'Dinheiro', icon: '💵', order: 10 },
  { code: 'card', label: 'Cartão', icon: '💳', order: 20 },
  { code: 'transfer', label: 'Transferência', icon: '🏦', order: 30 },
  { code: 'direct_debit', label: 'Débito direto', icon: '🏦', order: 40 },
  { code: 'mbway', label: 'MB WAY', icon: '📱', order: 50 },
  { code: 'voucher', label: 'Voucher', icon: '🎟️', order: 60 },
  { code: 'other', label: 'Outro', icon: '📦', order: 999 },
]);

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

export type OptionSet =
  | typeof VEHICLE_TYPES
  | typeof FUEL_TYPES
  | typeof EXPENSE_CATEGORIES
  | typeof MAINTENANCE_TYPES
  | typeof DOCUMENT_CATEGORIES
  | typeof EVENT_TYPES
  | typeof REMINDER_TRIGGERS
  | typeof REMINDER_STATES
  | typeof SUGGESTION_TYPES
  | typeof QUICK_ACTIONS
  | typeof RECORD_KINDS
  | typeof NOTIFICATION_CHANNELS
  | typeof NOTIFICATION_TOPICS
  | typeof NOTIFICATION_FREQUENCIES
  | typeof INTEGRATION_CATEGORIES
  | typeof PROVIDER_KINDS
  | typeof INSURANCE_COVERAGES
  | typeof TAX_KINDS
  | typeof INSPECTION_RESULTS
  | typeof PAYMENT_METHODS;

/** Extrai a união de códigos de um conjunto de opções. */
export type CodeOf<T extends OptionSet> = T[number]['code'];

export type VehicleType = CodeOf<typeof VEHICLE_TYPES>;
export type FuelType = CodeOf<typeof FUEL_TYPES>;
export type ExpenseCategory = CodeOf<typeof EXPENSE_CATEGORIES>;
export type MaintenanceType = CodeOf<typeof MAINTENANCE_TYPES>;
export type DocumentCategory = CodeOf<typeof DOCUMENT_CATEGORIES>;
export type EventType = CodeOf<typeof EVENT_TYPES>;
export type ReminderTrigger = CodeOf<typeof REMINDER_TRIGGERS>;
export type ReminderState = CodeOf<typeof REMINDER_STATES>;
export type SuggestionType = CodeOf<typeof SUGGESTION_TYPES>;
export type NotificationChannel = CodeOf<typeof NOTIFICATION_CHANNELS>;
export type NotificationTopic = CodeOf<typeof NOTIFICATION_TOPICS>;
export type NotificationFrequency = CodeOf<typeof NOTIFICATION_FREQUENCIES>;
export type IntegrationCategory = CodeOf<typeof INTEGRATION_CATEGORIES>;
export type ProviderKind = CodeOf<typeof PROVIDER_KINDS>;
export type RecordKind = CodeOf<typeof RECORD_KINDS>;
export type InsuranceCoverage = CodeOf<typeof INSURANCE_COVERAGES>;
export type TaxKind = CodeOf<typeof TAX_KINDS>;
export type InspectionResult = CodeOf<typeof INSPECTION_RESULTS>;
export type PaymentMethod = CodeOf<typeof PAYMENT_METHODS>;

/** Lista de códigos, útil para validadores Zod. */
export function codes<T extends OptionSet>(set: T): [CodeOf<T>, ...CodeOf<T>[]] {
  return set.map((item) => item.code) as unknown as [CodeOf<T>, ...CodeOf<T>[]];
}

/** Procura a metadata de um código, com `fallback` opcional. */
export function findOption<T extends OptionSet>(
  set: T,
  code: string | null | undefined,
): T[number] | undefined {
  if (!code) return undefined;
  return set.find((item) => item.code === code);
}

/** Etiqueta legível para um código; devolve o próprio código se for desconhecido. */
export function optionLabel<T extends OptionSet>(set: T, code: string | null | undefined): string {
  return findOption(set, code)?.label ?? (code ?? '—');
}

/**
 * Etiqueta legível de uma categoria de despesa.
 *
 * Existe como função própria porque as categorias de despesa são o conjunto mais
 * usado em toda a interface (listas, gráficos, filtros, exportações) e porque uma
 * categoria desconhecida — vinda de uma versão futura da API ou de uma importação
 * antiga — deve aparecer de forma legível em vez de desaparecer.
 */
export function categoryLabel(code: string | null | undefined): string {
  if (!code) return 'Sem categoria';
  return findOption(EXPENSE_CATEGORIES, code)?.label ?? code;
}

/** Ícone para um código; devolve um marcador neutro se for desconhecido. */
export function optionIcon<T extends OptionSet>(set: T, code: string | null | undefined): string {
  return findOption(set, code)?.icon ?? '•';
}

/** Ordena uma lista pela ordem declarada no registo. */
export function sortByOptionOrder<T extends OptionSet, I extends { code: string }>(
  set: T,
  items: readonly I[],
): I[] {
  const rank = new Map<string, number>();
  for (const item of set) rank.set(item.code, item.order);
  return [...items].sort(
    (a, b) => (rank.get(a.code) ?? 10_000) - (rank.get(b.code) ?? 10_000),
  );
}

/** Categorias de despesa que contam como energia. */
export const ENERGY_EXPENSE_CATEGORIES: ExpenseCategory[] = EXPENSE_CATEGORIES.filter(
  (item) => item.energy,
).map((item) => item.code) as ExpenseCategory[];

/** Categorias de despesa de custo fixo recorrente. */
export const RECURRING_EXPENSE_CATEGORIES: ExpenseCategory[] = EXPENSE_CATEGORIES.filter(
  (item) => item.recurring,
).map((item) => item.code) as ExpenseCategory[];

/** Um veículo elétrico ou híbrido plug-in carrega energia da rede. */
export function supportsCharging(fuelType: string | null | undefined): boolean {
  return fuelType === 'electric' || fuelType === 'phev';
}

/** Um veículo com motor de combustão abastece combustível líquido. */
export function supportsRefuelling(fuelType: string | null | undefined): boolean {
  return (
    fuelType === 'gasoline' ||
    fuelType === 'diesel' ||
    fuelType === 'lpg' ||
    fuelType === 'cng' ||
    fuelType === 'hybrid' ||
    fuelType === 'phev'
  );
}
