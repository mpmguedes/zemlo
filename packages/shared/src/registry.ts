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
/* Dicionário de sinónimos de coluna para importação de ficheiros (§10.3)      */
/* -------------------------------------------------------------------------- */

/**
 * Campo canónico de um `CanonicalRecord` que uma coluna de ficheiro pode
 * alimentar.
 *
 * É um tipo aberto (`string`) pela mesma razão que as categorias são `String`
 * validadas e não `enum`: o vocabulário de campos vive no importador, não na
 * base de dados, e um campo novo não deve obrigar a uma migração.
 */
export type CanonicalFieldName = string;

/**
 * Um sinónimo de coluna.
 *
 * `synonyms` são comparados após normalização (`normalizeColumnName`):
 * minúsculas, sem acentos, sem pontuação, espaços colapsados e removidos.
 * Escrever "Quilometragem" ou "quilometragem " ou "QUILOMETRAGEM" é o mesmo.
 *
 * A ordem da lista **é** a ordem de prioridade: um sinónimo declarado primeiro
 * vence em caso de empate de confiança. `match` distingue a força da evidência:
 *  - `exact`  — o nome normalizado coincide literalmente;
 *  - `strong` — sinónimo inequívoco, mas não o nome canónico;
 *  - `weak`   — sinónimo genérico que pode colidir com outro campo
 *               (ex.: "tipo" pode ser categoria, tipo de manutenção ou tipo de
 *               evento); nunca é aplicado sem confirmação.
 */
export interface ColumnSynonym {
  readonly field: CanonicalFieldName;
  readonly synonyms: readonly string[];
  readonly match: 'exact' | 'strong' | 'weak';
}

/**
 * Dicionário de sinónimos de coluna (§10.3).
 *
 * Vive aqui — ao lado das categorias — pela razão que a especificação indica:
 * acrescentar um sinónimo não deve ser uma alteração espalhada pelo código.
 * Quem importa lê daqui; não há uma segunda lista em lado nenhum.
 *
 * Inclui deliberadamente os **cabeçalhos que o próprio Zemlo exporta** (§5.4:
 * `Matrícula`, `Data`, `Valor (€)`, `Litros`, `Quilometragem`, `Fornecedor`,
 * `Descrição`, `Categoria`, `Pago`, `Notas`), para que o ciclo
 * exportar → importar seja um caso suportado e testado, e não uma coincidência.
 *
 * A `match` reflete honestidade sobre a evidência: "descrição" aparece como
 * sinónimo fraco de `category` (a tabela da §10.3 mostra-o) mas também como
 * sinónimo forte de `description`. A ambiguidade é resolvida pelo mapeador com
 * base no tipo de registo inferido — nunca escolhida em silêncio.
 */
export const COLUMN_SYNONYMS = freezeColumnSynonyms([
  // --- Identificação e referências -----------------------------------------
  // "matrícula" e "matricula" normalizam para o mesmo valor; declarar as duas
  // é uma duplicação sem efeito, por isso fica apenas a forma sem acento.
  { field: 'plate', match: 'exact', synonyms: ['matricula'] },
  {
    field: 'plate',
    match: 'strong',
    synonyms: ['plate', 'viatura', 'veículo', 'registo', 'nº de matrícula'],
  },

  // --- Datas ----------------------------------------------------------------
  { field: 'date', match: 'exact', synonyms: ['data'] },
  {
    field: 'date',
    match: 'strong',
    synonyms: ['date', 'dia', 'fecha', 'data de compra', 'data do registo', 'data do movimento'],
  },
  {
    field: 'date',
    match: 'weak',
    synonyms: ['quando', 'referência temporal'],
  },

  /*
   * `recordedAt` — a data de uma leitura de quilometragem.
   *
   * ## Porque é que este campo precisava da sua própria entrada
   *
   * O vocabulário do odómetro usa `recordedAt` e não `date` (é a data em que a leitura foi
   * **registada**, não a data de um evento). Sem estas entradas, um ficheiro de
   * quilometragens com uma coluna `Data` não tinha **nenhum** candidato para essa coluna:
   * o mapeador recusa atribuir um campo que não seja da `CANONICAL_FIELDS` do tipo, e o
   * resultado era um campo obrigatório (`recordedAt`) que o utilizador não conseguia
   * preencher a partir do ecrã de mapeamento — a importação ficava bloqueada sem remédio
   * oferecido, que é exatamente o "beco sem saída" que a §11.3 proíbe.
   *
   * ## Porque é que são `strong` e não `exact`
   *
   * `Data` é `exact` para `date` — e é essa a ambiguidade real: a mesma coluna serve dois
   * campos conforme o tipo. O mapeador resolve-a pelo contexto do tipo (`compatibleWithKind`
   * em `mapping.ts`), que é a resposta certa: com o tipo `odometer` decidido, `Data` só
   * pode ser `recordedAt`, porque `date` não está no vocabulário desse tipo.
   *
   * Uma entrada `exact` aqui competiria com a de `date` em pé de igualdade em qualquer
   * contexto e tornaria o mapa ambíguo em ficheiros de **despesas** — onde `Data` é
   * inequivocamente `date`. O peso `strong` deixa o contexto decidir sem nunca empatar.
   */
  {
    field: 'recordedAt',
    match: 'strong',
    synonyms: ['data da leitura', 'data do registo', 'data da medição', 'registado em'],
  },
  {
    field: 'recordedAt',
    match: 'weak',
    synonyms: ['data', 'date', 'dia', 'quando'],
  },

  // --- Valores monetários ---------------------------------------------------
  { field: 'amountCents', match: 'exact', synonyms: ['valor', 'total'] },
  {
    field: 'amountCents',
    match: 'strong',
    synonyms: [
      'montante',
      'preço',
      'custo',
      'amount',
      'valor total',
      'valor pago',
      'valor (€)',
      'total (€)',
      'importância',
      'despesa',
    ],
  },
  {
    field: 'amountCents',
    match: 'weak',
    // "pago" fica de fora: é uma bandeira booleana, não um valor, e declará-lo
    // aqui colidiria com `paid`. A ambiguidade de "pagamento" (valor vs método
    // vs estado) é tratada pelo mapeador, que vê as três candidaturas.
    synonyms: ['pagamento', 'a pagar', 'quanto'],
  },

  // --- Quilometragem --------------------------------------------------------
  { field: 'odometerKm', match: 'exact', synonyms: ['km'] },
  {
    field: 'odometerKm',
    match: 'strong',
    synonyms: [
      'quilómetros',
      'quilometragem',
      'odómetro',
      'mileage',
      'kms',
      'km atual',
      'quilometragem (km)',
      'km do veículo',
    ],
  },
  {
    field: 'odometerKm',
    match: 'weak',
    synonyms: ['distância', 'percorridos'],
  },

  // --- Combustível ----------------------------------------------------------
  { field: 'litres', match: 'exact', synonyms: ['litros'] },
  {
    field: 'litres',
    match: 'strong',
    synonyms: ['litres', 'l', 'quantidade', 'volume', 'litros (l)', 'qtd', 'quantidade (l)'],
  },

  // --- Eletricidade ---------------------------------------------------------
  { field: 'energyKwh', match: 'exact', synonyms: ['kwh'] },
  {
    field: 'energyKwh',
    match: 'strong',
    synonyms: ['energia', 'energia (kwh)', 'kw', 'quilo-watt-hora', 'energia carregada'],
  },
  {
    field: 'energyKwh',
    match: 'weak',
    synonyms: ['consumo'],
  },

  // --- Preços unitários -----------------------------------------------------
  {
    field: 'pricePerLitreCents',
    match: 'strong',
    synonyms: ['preço/litro', 'preço por litro', 'preço/litro (€)', '€/l', 'preço unitário'],
  },
  {
    field: 'pricePerKwhCents',
    match: 'strong',
    synonyms: ['preço/kwh', 'preço por kwh', 'preço/kwh (€)', '€/kwh'],
  },

  // --- Iva ------------------------------------------------------------------
  {
    field: 'vatCents',
    match: 'strong',
    synonyms: ['iva', 'iva (€)', 'imposto', 'taxa de iva', 'vat'],
  },

  // --- Entidades ------------------------------------------------------------
  { field: 'vendor', match: 'exact', synonyms: ['fornecedor'] },
  {
    field: 'vendor',
    match: 'strong',
    synonyms: ['posto', 'local', 'oficina', 'estabelecimento', 'vendor', 'fornecedor/prestador'],
  },
  {
    field: 'vendor',
    match: 'weak',
    synonyms: ['loja', 'comerciante', 'entidade'],
  },

  // --- Classificação --------------------------------------------------------
  { field: 'category', match: 'exact', synonyms: ['categoria'] },
  {
    field: 'category',
    match: 'strong',
    synonyms: ['type', 'tipo de despesa', 'classificação', 'rubrica'],
  },
  {
    field: 'category',
    match: 'weak',
    synonyms: ['tipo', 'descrição', 'natureza'],
  },

  { field: 'description', match: 'exact', synonyms: ['descrição'] },
  {
    field: 'description',
    match: 'strong',
    synonyms: ['description', 'detalhe', 'detalhes', 'observação', 'observacoes', 'observação adicional'],
  },

  { field: 'notes', match: 'exact', synonyms: ['notas'] },
  {
    field: 'notes',
    match: 'strong',
    synonyms: ['notes', 'nota', 'comentário', 'comentarios', 'comentário livre', 'memo'],
  },
  {
    field: 'type',
    match: 'strong',
    synonyms: ['tipo de manutenção', 'tipo de serviço', 'serviço', 'intervenção', 'trabalho efetuado'],
  },
  {
    field: 'type',
    match: 'weak',
    synonyms: ['tipo'],
  },

  // --- Pagamento ------------------------------------------------------------
  {
    field: 'paymentMethod',
    match: 'strong',
    synonyms: ['pagamento', 'método de pagamento', 'meio de pagamento', 'forma de pagamento'],
  },
  {
    field: 'paid',
    match: 'strong',
    synonyms: ['pago', 'liquidado', 'estado de pagamento'],
  },

  // --- Veículo: ficha técnica -----------------------------------------------
  { field: 'make', match: 'exact', synonyms: ['marca'] },
  { field: 'make', match: 'strong', synonyms: ['make', 'fabricante'] },

  { field: 'model', match: 'exact', synonyms: ['modelo'] },
  { field: 'model', match: 'strong', synonyms: ['model', 'versão comercial'] },

  { field: 'version', match: 'exact', synonyms: ['versão'] },
  { field: 'version', match: 'strong', synonyms: ['version', 'variante', 'acabamento'] },

  { field: 'year', match: 'exact', synonyms: ['ano'] },
  { field: 'year', match: 'strong', synonyms: ['year', 'ano de fabrico', 'ano de matrícula', 'ano do modelo'] },

  { field: 'vin', match: 'exact', synonyms: ['vin'] },
  { field: 'vin', match: 'strong', synonyms: ['chassis', 'número de chassis', 'nº de quadro', 'bastidor'] },

  { field: 'fuelType', match: 'exact', synonyms: ['combustível'] },
  {
    field: 'fuelType',
    match: 'strong',
    synonyms: ['fuel', 'fuel type', 'tipo de combustível', 'propulsão', 'energia do veículo'],
  },

  { field: 'vehicleType', match: 'exact', synonyms: ['tipo de veículo'] },
  { field: 'vehicleType', match: 'strong', synonyms: ['segmento', 'categoria do veículo'] },

  { field: 'color', match: 'exact', synonyms: ['cor'] },
  { field: 'color', match: 'strong', synonyms: ['color', 'pintura'] },

  { field: 'nickname', match: 'strong', synonyms: ['alcunha', 'apelido', 'nome do veículo', 'nome'] },

  // --- Seguro ---------------------------------------------------------------
  { field: 'insurer', match: 'exact', synonyms: ['seguradora'] },
  { field: 'insurer', match: 'strong', synonyms: ['seguro', 'companhia de seguros', 'insurer'] },
  { field: 'policyNumber', match: 'strong', synonyms: ['apólice', 'nº de apólice', 'nº apólice', 'policy'] },
  { field: 'startDate', match: 'strong', synonyms: ['início', 'data de início', 'vigência inicial'] },
  { field: 'endDate', match: 'strong', synonyms: ['fim', 'data de fim', 'vencimento da apólice', 'validade'] },
  { field: 'premiumCents', match: 'strong', synonyms: ['prémio', 'prémio (€)', 'valor do prémio'] },
  { field: 'coverage', match: 'strong', synonyms: ['cobertura', 'tipo de cobertura', 'nível de cobertura'] },

  // --- Inspeção -------------------------------------------------------------
  { field: 'result', match: 'strong', synonyms: ['resultado', 'resultado da inspeção', 'resultado da inspeccao', 'result'] },
  { field: 'expiresAt', match: 'strong', synonyms: ['expira em', 'válido até', 'validade até', 'próxima inspeção', 'proxima inspeccao'] },
  { field: 'station', match: 'strong', synonyms: ['centro de inspeção', 'estação', 'ipo'] },

  // --- Impostos -------------------------------------------------------------
  { field: 'kind', match: 'strong', synonyms: ['tipo de imposto', 'imposto', 'tributo'] },
  { field: 'dueDate', match: 'strong', synonyms: ['data limite', 'prazo', 'vence em', 'data de vencimento', 'vencimento'] },

  // --- Documentos -----------------------------------------------------------
  { field: 'name', match: 'exact', synonyms: ['nome'] },
  { field: 'name', match: 'strong', synonyms: ['nome do documento', 'título', 'documento'] },
  { field: 'fileName', match: 'strong', synonyms: ['ficheiro', 'arquivo', 'file'] },
  { field: 'mimeType', match: 'strong', synonyms: ['tipo de ficheiro', 'formato'] },

  // --- Lembretes / eventos --------------------------------------------------
  { field: 'title', match: 'strong', synonyms: ['título do lembrete', 'assunto'] },
  { field: 'title', match: 'strong', synonyms: ['título do evento', 'descrição do evento'] },

  // --- Localização / carregamento -------------------------------------------
  // "local" é explicitamente ambíguo na §10.4: tanto pode ser o fornecedor
  // (oficina, posto) como o local de um carregamento. Declaramos ambos como
  // fracos para que o mapeador veja a colisão e pergunte, em vez de escolher.
  { field: 'location', match: 'strong', synonyms: ['localização', 'posto de carregamento'] },
  { field: 'location', match: 'weak', synonyms: ['local', 'sítio'] },
  { field: 'latitude', match: 'strong', synonyms: ['latitude', 'lat'] },
  { field: 'longitude', match: 'strong', synonyms: ['longitude', 'lng', 'lon'] },

  // --- Bandeiras ------------------------------------------------------------
  { field: 'fullTank', match: 'strong', synonyms: ['depósito cheio', 'ateste', 'cheio'] },
  { field: 'isCorrection', match: 'strong', synonyms: ['correção', 'é correção'] },
  { field: 'isPublic', match: 'strong', synonyms: ['público', 'posto público'] },
  { field: 'origin', match: 'strong', synonyms: ['origem', 'source'] },
] as readonly ColumnSynonym[]);

/**
 * Aplica `Object.freeze` a cada entrada e ao array do dicionário.
 *
 * Não reutiliza `freeze()` porque a forma é diferente: aqui o array é de
 * objetos com um campo `synonyms` que também precisa de ser congelado.
 */
function freezeColumnSynonyms(items: readonly ColumnSynonym[]): readonly ColumnSynonym[] {
  for (const item of items) {
    Object.freeze(item.synonyms);
    Object.freeze(item);
  }
  return Object.freeze(items);
}

/**
 * Normaliza o nome de uma coluna para comparação com o dicionário.
 *
 * Regras: minúsculas, sem acentos, sem pontuação de separação, espaços e
 * sublinhados colapsados num único espaço e aparados. Unidades entre parênteses
 * são removidas porque variam sem significado ("Valor (€)" ≡ "Valor"), exceto
 * quando o conteúdo do parêntese é uma unidade que *desambigua* (kWh / L / km) —
 * nesse caso o parêntese é mantido normalizado, para distinguir "Energia (kWh)"
 * de "Energia (€)".
 *
 * `€` e `%` são preservados: fazem parte do significado.
 */
export function normalizeColumnName(name: string): string {
  let value = name
    .normalize('NFD')
    // Remove diacríticos (acentos, til, cedilha) mantendo a letra base.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  // Mantém as unidades significativas antes de retirar a pontuação.
  value = value.replace(/\(([^)]*)\)/g, (_match, inner: string) => {
    const unit = inner.trim();
    if (/^(kwh|l|km|€|\$|%|eur|euros?)$/.test(unit)) return ` ${unit} `;
    return ' ';
  });

  value = value
    // Mantém letras, dígitos, espaços, barra, euro e percentagem.
    .replace(/[^a-z0-9\s/€%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return value;
}

/**
 * Sinónimos já normalizados, indexados por nome, para consulta O(1).
 *
 * Construído uma única vez no carregamento do módulo. A ordem de inserção
 * preserva a prioridade declarada em `COLUMN_SYNONYMS` (a primeira entrada com
 * a confiança mais alta vence), porque o mapeador percorre esta lista.
 */
export interface SynonymMatch {
  readonly field: CanonicalFieldName;
  readonly confidence: number;
  readonly match: 'exact' | 'strong' | 'weak';
}

const SYNONYM_INDEX: ReadonlyMap<string, readonly SynonymMatch[]> = buildSynonymIndex();

function buildSynonymIndex(): ReadonlyMap<string, readonly SynonymMatch[]> {
  // Pesos por tipo de correspondência. Um sinónimo "exact" é o nome canónico
  // declarado pelo próprio produto; declaramos explicitamente como exact.
  const weight: Record<ColumnSynonym['match'], number> = {
    exact: 0.95,
    strong: 0.8,
    weak: 0.4,
  };

  const index = new Map<string, SynonymMatch[]>();

  for (const entry of COLUMN_SYNONYMS) {
    for (const synonym of entry.synonyms) {
      const key = normalizeColumnName(synonym);
      if (key === '') continue;
      const list = index.get(key) ?? [];
      list.push({ field: entry.field, confidence: weight[entry.match], match: entry.match });
      index.set(key, list);
    }
  }

  for (const list of index.values()) {
    // Ordem determinística: confiança descendente, depois ordem de declaração.
    list.sort((a, b) => b.confidence - a.confidence);
    Object.freeze(list);
  }

  return index;
}

/**
 * Procura correspondências para o nome de uma coluna.
 *
 * Devolve **todas** as correspondências possíveis, ordenadas por confiança
 * decrescente, em vez de escolher uma. A escolha é responsabilidade do mapeador,
 * que conhece o contexto (tipo de registo inferido, outras colunas presentes) e
 * que tem de saber quando *não* pode escolher sozinho (§10.4).
 */
export function lookupColumnSynonyms(columnName: string): readonly SynonymMatch[] {
  return SYNONYM_INDEX.get(normalizeColumnName(columnName)) ?? [];
}



/**
 * Vocabulário de campos canónicos por tipo de registo.
 *
 * **Tem de coincidir com `FIELD_MAP` em `apps/api/src/domain/import/normalize-records.ts`.**
 * Existe aqui, e não só lá, porque o dicionário de sinónimos acima tem de apontar para
 * nomes que existem: um sinónimo que aponte para `maintenanceType` quando o campo real é
 * `type` produz um mapeamento que parece correto e nunca escreve nada. É um erro silencioso
 * exatamente do tipo que a §10.4 pede para evitar.
 *
 * A verificação é feita por teste (`import-csv-synonyms.test.ts`): cada `field` declarado
 * em `COLUMN_SYNONYMS` tem de pertencer a algum destes conjuntos.
 *
 * `REFERENCE_FIELDS` (referências entre registos) ficam de fora de propósito: não são
 * colunas de valores, são ligações entre linhas do bundle, e o CSV genérico não as
 * transporta (§15).
 */
export const CANONICAL_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  vehicle: Object.freeze([
    'plate',
    'plateDisplay',
    'vin',
    'make',
    'model',
    'version',
    'year',
    'vehicleType',
    'fuelType',
    'color',
    'nickname',
  ]),
  odometer: Object.freeze(['odometerKm', 'recordedAt', 'origin', 'isCorrection', 'notes']),
  expense: Object.freeze([
    'amountCents',
    'vatCents',
    'category',
    'date',
    'vendor',
    'odometerKm',
    'description',
    'paymentMethod',
    'paid',
  ]),
  fuel: Object.freeze([
    'date',
    'litres',
    'amountCents',
    'pricePerLitreCents',
    'odometerKm',
    'fullTank',
    'station',
    'fuelType',
    'latitude',
    'longitude',
    'paymentMethod',
    'notes',
  ]),
  charging: Object.freeze([
    'date',
    'energyKwh',
    'amountCents',
    'pricePerKwhCents',
    'odometerKm',
    'startSocPercent',
    'endSocPercent',
    'durationMinutes',
    'location',
    'isPublic',
    'paymentMethod',
    'notes',
  ]),
  maintenance: Object.freeze([
    'date',
    'type',
    'amountCents',
    'odometerKm',
    'vendor',
    'description',
    'nextDate',
    'nextOdometerKm',
    'notes',
  ]),
  insurance: Object.freeze([
    'insurer',
    'policyNumber',
    'startDate',
    'endDate',
    'premiumCents',
    'amountCents',
    'coverage',
    'notes',
  ]),
  inspection: Object.freeze(['date', 'result', 'amountCents', 'odometerKm', 'expiresAt', 'station', 'notes']),
  tax: Object.freeze(['kind', 'year', 'amountCents', 'date', 'dueDate', 'paid', 'notes']),
  document: Object.freeze([
    'name',
    'category',
    'date',
    'expiresAt',
    'fileName',
    'mimeType',
    'sizeBytes',
    'contentPath',
    'contentState',
    'contentSha256',
    'notes',
  ]),
  reminder: Object.freeze(['title', 'dueDate', 'dueOdometerKm', 'origin', 'notes']),
  event: Object.freeze(['type', 'date', 'title', 'description']),
  suggestion: Object.freeze(['key', 'type', 'status', 'reason']),
  notification: Object.freeze(['topic', 'title', 'body', 'severity']),
});

/**
 * Todos os nomes de campo canónicos, sem repetições, independentemente do tipo.
 *
 * É o conjunto contra o qual o dicionário de sinónimos é validado: um `field` que não
 * pertença aqui é um erro de declaração, não uma funcionalidade futura.
 */
export const ALL_CANONICAL_FIELDS: ReadonlySet<string> = new Set(
  Object.values(CANONICAL_FIELDS).flat(),
);

/** True quando o nome é um campo canónico conhecido de pelo menos um tipo de registo. */
export function isCanonicalField(name: string): boolean {
  return ALL_CANONICAL_FIELDS.has(name);
}

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
