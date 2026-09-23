// GERADO POR apps/mobile/contract/generate.mjs — NÃO EDITAR À MÃO.
//
// Qualquer alteração feita aqui é apagada na próxima geração e, mais importante,
// `node apps/mobile/contract/verify.mjs` falha no CI. Para mudar o contrato, muda-se
// `packages/shared` e volta a correr o gerador.


/// Entrada de uma tabela de registo do contrato.
class RegistryEntry {
  const RegistryEntry({
    required this.code,
    required this.label,
    required this.icon,
    required this.order,
    this.energy = false,
    this.recurring = false,
  });

  /// Código do fio da API.
  final String code;
  /// Rótulo em português, escrito para ser lido por uma pessoa (§59).
  final String label;
  final String icon;
  final int order;
  final bool energy;
  final bool recurring;
}

/// `DOCUMENT_CATEGORIES` — 11 entradas, na ordem definida pelo contrato.
const List<RegistryEntry> kDOCUMENT_CATEGORIES = <RegistryEntry>[
  RegistryEntry(code: 'registration', label: 'Documento Único Automóvel', icon: '📄', order: 10),
  RegistryEntry(code: 'insurance', label: 'Seguro / apólice', icon: '🛡️', order: 20),
  RegistryEntry(code: 'inspection', label: 'Inspeção', icon: '📋', order: 30),
  RegistryEntry(code: 'invoice', label: 'Fatura', icon: '🧾', order: 40),
  RegistryEntry(code: 'receipt', label: 'Recibo', icon: '🧾', order: 50),
  RegistryEntry(code: 'maintenance', label: 'Manutenção', icon: '🔧', order: 60),
  RegistryEntry(code: 'warranty', label: 'Garantia', icon: '✅', order: 70),
  RegistryEntry(code: 'tax', label: 'Imposto', icon: '🏛️', order: 80),
  RegistryEntry(code: 'certificate', label: 'Certificado', icon: '🎖️', order: 90),
  RegistryEntry(code: 'photo', label: 'Fotografia', icon: '📷', order: 100),
  RegistryEntry(code: 'other', label: 'Outro', icon: '📦', order: 999),
];

/// `EVENT_TYPES` — 16 entradas, na ordem definida pelo contrato.
const List<RegistryEntry> kEVENT_TYPES = <RegistryEntry>[
  RegistryEntry(code: 'vehicle.created', label: 'Veículo criado', icon: '🚗', order: 10),
  RegistryEntry(code: 'vehicle.updated', label: 'Veículo atualizado', icon: '✏️', order: 20),
  RegistryEntry(code: 'odometer.recorded', label: 'Quilometragem', icon: '📍', order: 30),
  RegistryEntry(code: 'expense.created', label: 'Despesa', icon: '💶', order: 40),
  RegistryEntry(code: 'fuel.created', label: 'Abastecimento', icon: '⛽', order: 50),
  RegistryEntry(code: 'charging.created', label: 'Carregamento', icon: '🔌', order: 60),
  RegistryEntry(code: 'maintenance.created', label: 'Manutenção', icon: '🔧', order: 70),
  RegistryEntry(code: 'insurance.created', label: 'Seguro', icon: '🛡️', order: 80),
  RegistryEntry(code: 'inspection.created', label: 'Inspeção', icon: '📋', order: 90),
  RegistryEntry(code: 'tax.created', label: 'Imposto', icon: '🏛️', order: 100),
  RegistryEntry(code: 'document.created', label: 'Documento', icon: '📄', order: 110),
  RegistryEntry(code: 'reminder.created', label: 'Lembrete criado', icon: '🔔', order: 120),
  RegistryEntry(code: 'reminder.completed', label: 'Lembrete concluído', icon: '✅', order: 130),
  RegistryEntry(code: 'document.expiring', label: 'Documento a expirar', icon: '⏳', order: 140),
  RegistryEntry(code: 'odometer.corrected', label: 'Quilometragem corrigida', icon: '↩️', order: 150),
  RegistryEntry(code: 'note', label: 'Nota', icon: '📝', order: 160),
];

/// `EXPENSE_CATEGORIES` — 14 entradas, na ordem definida pelo contrato.
const List<RegistryEntry> kEXPENSE_CATEGORIES = <RegistryEntry>[
  RegistryEntry(code: 'fuel', label: 'Combustível', icon: '⛽', order: 10, energy: true),
  RegistryEntry(code: 'charging', label: 'Carregamento', icon: '🔌', order: 20, energy: true),
  RegistryEntry(code: 'maintenance', label: 'Manutenção', icon: '🔧', order: 30),
  RegistryEntry(code: 'tyres', label: 'Pneus', icon: '🛞', order: 40),
  RegistryEntry(code: 'insurance', label: 'Seguro', icon: '🛡️', order: 50, recurring: true),
  RegistryEntry(code: 'tax', label: 'Imposto (IUC)', icon: '🏛️', order: 60, recurring: true),
  RegistryEntry(code: 'inspection', label: 'Inspeção', icon: '📋', order: 70, recurring: true),
  RegistryEntry(code: 'wash', label: 'Lavagem', icon: '🚿', order: 80),
  RegistryEntry(code: 'parking', label: 'Estacionamento', icon: '🅿️', order: 90),
  RegistryEntry(code: 'tolls', label: 'Portagens', icon: '🛣️', order: 100),
  RegistryEntry(code: 'repairs', label: 'Reparações', icon: '🛠️', order: 110),
  RegistryEntry(code: 'accessories', label: 'Acessórios', icon: '🧰', order: 120),
  RegistryEntry(code: 'fines', label: 'Multas', icon: '⚠️', order: 130),
  RegistryEntry(code: 'other', label: 'Outros', icon: '📦', order: 999),
];

/// `FUEL_TYPES` — 9 entradas, na ordem definida pelo contrato.
const List<RegistryEntry> kFUEL_TYPES = <RegistryEntry>[
  RegistryEntry(code: 'gasoline', label: 'Gasolina', icon: '⛽', order: 10, energy: true),
  RegistryEntry(code: 'diesel', label: 'Gasóleo', icon: '⛽', order: 20, energy: true),
  RegistryEntry(code: 'lpg', label: 'GPL', icon: '⛽', order: 30, energy: true),
  RegistryEntry(code: 'cng', label: 'GNC', icon: '⛽', order: 40, energy: true),
  RegistryEntry(code: 'hybrid', label: 'Híbrido', icon: '🔋', order: 50, energy: true),
  RegistryEntry(code: 'phev', label: 'Híbrido plug-in', icon: '🔌', order: 60, energy: true),
  RegistryEntry(code: 'electric', label: 'Elétrico', icon: '⚡', order: 70, energy: true),
  RegistryEntry(code: 'hydrogen', label: 'Hidrogénio', icon: '💧', order: 80, energy: true),
  RegistryEntry(code: 'other', label: 'Outro', icon: '❓', order: 999),
];

/// `INSPECTION_RESULTS` — 4 entradas, na ordem definida pelo contrato.
const List<RegistryEntry> kINSPECTION_RESULTS = <RegistryEntry>[
  RegistryEntry(code: 'passed', label: 'Aprovada', icon: '✅', order: 10),
  RegistryEntry(code: 'passed_with_defects', label: 'Aprovada com deficiências', icon: '⚠️', order: 20),
  RegistryEntry(code: 'failed', label: 'Reprovada', icon: '❌', order: 30),
  RegistryEntry(code: 'pending', label: 'Pendente', icon: '⏳', order: 40),
];

/// `INSURANCE_COVERAGES` — 4 entradas, na ordem definida pelo contrato.
const List<RegistryEntry> kINSURANCE_COVERAGES = <RegistryEntry>[
  RegistryEntry(code: 'third_party', label: 'Responsabilidade civil', icon: '🛡️', order: 10),
  RegistryEntry(code: 'third_party_fire_theft', label: 'Terceiros, furto e incêndio', icon: '🛡️', order: 20),
  RegistryEntry(code: 'comprehensive', label: 'Danos próprios', icon: '🛡️', order: 30),
  RegistryEntry(code: 'other', label: 'Outra cobertura', icon: '📄', order: 999),
];

/// `INTEGRATION_CATEGORIES` — 6 entradas, na ordem definida pelo contrato.
const List<RegistryEntry> kINTEGRATION_CATEGORIES = <RegistryEntry>[
  RegistryEntry(code: 'manufacturer', label: 'Fabricante', icon: '🏭', order: 10),
  RegistryEntry(code: 'home_assistant', label: 'Home Assistant', icon: '🏠', order: 20),
  RegistryEntry(code: 'wallbox', label: 'Wallbox', icon: '🔌', order: 30),
  RegistryEntry(code: 'obd', label: 'OBD', icon: '🔎', order: 40),
  RegistryEntry(code: 'charging_network', label: 'Rede de carregamento', icon: '⚡', order: 50),
  RegistryEntry(code: 'other', label: 'Outra', icon: '🔗', order: 999),
];

/// `MAINTENANCE_TYPES` — 15 entradas, na ordem definida pelo contrato.
const List<RegistryEntry> kMAINTENANCE_TYPES = <RegistryEntry>[
  RegistryEntry(code: 'service', label: 'Revisão', icon: '🔧', order: 10),
  RegistryEntry(code: 'oil', label: 'Mudança de óleo', icon: '🛢️', order: 20),
  RegistryEntry(code: 'filters', label: 'Filtros', icon: '🧽', order: 30),
  RegistryEntry(code: 'brakes', label: 'Travões', icon: '🛑', order: 40),
  RegistryEntry(code: 'tyres', label: 'Pneus', icon: '🛞', order: 50),
  RegistryEntry(code: 'battery', label: 'Bateria 12V', icon: '🔋', order: 60),
  RegistryEntry(code: 'timing', label: 'Correia de distribuição', icon: '⚙️', order: 70),
  RegistryEntry(code: 'suspension', label: 'Suspensão', icon: '🔩', order: 80),
  RegistryEntry(code: 'clutch', label: 'Embraiagem', icon: '⚙️', order: 90),
  RegistryEntry(code: 'ac', label: 'Ar condicionado', icon: '❄️', order: 100),
  RegistryEntry(code: 'diagnostics', label: 'Diagnóstico', icon: '🔍', order: 110),
  RegistryEntry(code: 'bodywork', label: 'Chapa e pintura', icon: '🎨', order: 120),
  RegistryEntry(code: 'software', label: 'Atualização de software', icon: '💾', order: 130),
  RegistryEntry(code: 'recall', label: 'Campanha / recall', icon: '📢', order: 140),
  RegistryEntry(code: 'other', label: 'Outro', icon: '📦', order: 999),
];

/// `NOTIFICATION_CHANNELS` — 3 entradas, na ordem definida pelo contrato.
const List<RegistryEntry> kNOTIFICATION_CHANNELS = <RegistryEntry>[
  RegistryEntry(code: 'push', label: 'Notificações push', icon: '📱', order: 10),
  RegistryEntry(code: 'email', label: 'Email', icon: '✉️', order: 20),
  RegistryEntry(code: 'in_app', label: 'No Zemlo', icon: '🔔', order: 30),
];

/// `NOTIFICATION_FREQUENCIES` — 4 entradas, na ordem definida pelo contrato.
const List<RegistryEntry> kNOTIFICATION_FREQUENCIES = <RegistryEntry>[
  RegistryEntry(code: 'immediate', label: 'Imediatamente', icon: '⚡', order: 10),
  RegistryEntry(code: 'daily', label: 'Resumo diário', icon: '☀️', order: 20),
  RegistryEntry(code: 'weekly', label: 'Resumo semanal', icon: '🗓️', order: 30),
  RegistryEntry(code: 'off', label: 'Desligado', icon: '🔕', order: 40),
];

/// `NOTIFICATION_TOPICS` — 7 entradas, na ordem definida pelo contrato.
const List<RegistryEntry> kNOTIFICATION_TOPICS = <RegistryEntry>[
  RegistryEntry(code: 'maintenance', label: 'Manutenção', icon: '🔧', order: 10),
  RegistryEntry(code: 'inspection', label: 'Inspeção', icon: '📋', order: 20),
  RegistryEntry(code: 'insurance', label: 'Seguro', icon: '🛡️', order: 30),
  RegistryEntry(code: 'tax', label: 'Impostos', icon: '🏛️', order: 40),
  RegistryEntry(code: 'document', label: 'Documentos', icon: '📄', order: 50),
  RegistryEntry(code: 'summary', label: 'Resumo periódico', icon: '📊', order: 60),
  RegistryEntry(code: 'security', label: 'Segurança da conta', icon: '🔐', order: 70),
];

/// `PAYMENT_METHODS` — 7 entradas, na ordem definida pelo contrato.
const List<RegistryEntry> kPAYMENT_METHODS = <RegistryEntry>[
  RegistryEntry(code: 'cash', label: 'Dinheiro', icon: '💵', order: 10),
  RegistryEntry(code: 'card', label: 'Cartão', icon: '💳', order: 20),
  RegistryEntry(code: 'transfer', label: 'Transferência', icon: '🏦', order: 30),
  RegistryEntry(code: 'direct_debit', label: 'Débito direto', icon: '🏦', order: 40),
  RegistryEntry(code: 'mbway', label: 'MB WAY', icon: '📱', order: 50),
  RegistryEntry(code: 'voucher', label: 'Voucher', icon: '🎟️', order: 60),
  RegistryEntry(code: 'other', label: 'Outro', icon: '📦', order: 999),
];

/// `PROVIDER_KINDS` — 6 entradas, na ordem definida pelo contrato.
const List<RegistryEntry> kPROVIDER_KINDS = <RegistryEntry>[
  RegistryEntry(code: 'manual', label: 'Manual', icon: '✍️', order: 10),
  RegistryEntry(code: 'api', label: 'API', icon: '🔗', order: 20),
  RegistryEntry(code: 'obd', label: 'OBD', icon: '🔎', order: 30),
  RegistryEntry(code: 'import', label: 'Importação', icon: '📥', order: 40),
  RegistryEntry(code: 'document', label: 'Documento', icon: '📄', order: 50),
  RegistryEntry(code: 'estimated', label: 'Estimado', icon: '📐', order: 60),
];

/// `QUICK_ACTIONS` — 5 entradas, na ordem definida pelo contrato.
const List<RegistryEntry> kQUICK_ACTIONS = <RegistryEntry>[
  RegistryEntry(code: 'expense', label: 'Despesa', icon: '💶', order: 10),
  RegistryEntry(code: 'fuel', label: 'Abastecimento', icon: '⛽', order: 20),
  RegistryEntry(code: 'charging', label: 'Carregamento', icon: '🔌', order: 30),
  RegistryEntry(code: 'maintenance', label: 'Manutenção', icon: '🔧', order: 40),
  RegistryEntry(code: 'odometer', label: 'Quilometragem', icon: '📍', order: 50),
];

/// `RECORD_KINDS` — 5 entradas, na ordem definida pelo contrato.
const List<RegistryEntry> kRECORD_KINDS = <RegistryEntry>[
  RegistryEntry(code: 'expense', label: 'Despesa', icon: '💶', order: 10),
  RegistryEntry(code: 'fuel', label: 'Abastecimento', icon: '⛽', order: 20),
  RegistryEntry(code: 'charging', label: 'Carregamento', icon: '🔌', order: 30),
  RegistryEntry(code: 'maintenance', label: 'Manutenção', icon: '🔧', order: 40),
  RegistryEntry(code: 'odometer', label: 'Quilometragem', icon: '📍', order: 50),
];

/// `REMINDER_STATES` — 5 entradas, na ordem definida pelo contrato.
const List<RegistryEntry> kREMINDER_STATES = <RegistryEntry>[
  RegistryEntry(code: 'ok', label: 'Em dia', icon: '✅', order: 10),
  RegistryEntry(code: 'soon', label: 'Em breve', icon: '⏳', order: 20),
  RegistryEntry(code: 'due', label: 'Vence agora', icon: '🔔', order: 30),
  RegistryEntry(code: 'overdue', label: 'Em atraso', icon: '⚠️', order: 40),
  RegistryEntry(code: 'unknown', label: 'Sem dados suficientes', icon: '❔', order: 50),
];

/// `REMINDER_TRIGGERS` — 3 entradas, na ordem definida pelo contrato.
const List<RegistryEntry> kREMINDER_TRIGGERS = <RegistryEntry>[
  RegistryEntry(code: 'distance', label: 'Por quilometragem', icon: '📍', order: 10),
  RegistryEntry(code: 'time', label: 'Por tempo', icon: '🗓️', order: 20),
  RegistryEntry(code: 'both', label: 'Km ou tempo (o que ocorrer primeiro)', icon: '⏱️', order: 30),
];

/// `SUGGESTION_TYPES` — 8 entradas, na ordem definida pelo contrato.
const List<RegistryEntry> kSUGGESTION_TYPES = <RegistryEntry>[
  RegistryEntry(code: 'vehicle.add_odometer', label: 'Adicionar quilometragem', icon: '📍', order: 10),
  RegistryEntry(code: 'vehicle.add_insurance', label: 'Guardar seguro', icon: '🛡️', order: 20),
  RegistryEntry(code: 'vehicle.add_inspection', label: 'Registar inspeção', icon: '📋', order: 30),
  RegistryEntry(code: 'vehicle.add_maintenance_plan', label: 'Definir próxima manutenção', icon: '🔧', order: 40),
  RegistryEntry(code: 'vehicle.add_details', label: 'Completar ficha do veículo', icon: '📄', order: 50),
  RegistryEntry(code: 'expense.add_odometer', label: 'Km para calcular custo/km', icon: '📐', order: 60),
  RegistryEntry(code: 'account.enable_2fa', label: 'Proteger conta com 2FA', icon: '🔐', order: 70),
  RegistryEntry(code: 'documents.add_first', label: 'Guardar documentos', icon: '📁', order: 80),
];

/// `TAX_KINDS` — 4 entradas, na ordem definida pelo contrato.
const List<RegistryEntry> kTAX_KINDS = <RegistryEntry>[
  RegistryEntry(code: 'iuc', label: 'IUC', icon: '🏛️', order: 10, recurring: true),
  RegistryEntry(code: 'isv', label: 'ISV', icon: '🏛️', order: 20),
  RegistryEntry(code: 'toll_device', label: 'Identificador de portagens', icon: '🛣️', order: 30),
  RegistryEntry(code: 'other', label: 'Outro imposto', icon: '📄', order: 999),
];

/// `VEHICLE_TYPES` — 10 entradas, na ordem definida pelo contrato.
const List<RegistryEntry> kVEHICLE_TYPES = <RegistryEntry>[
  RegistryEntry(code: 'car', label: 'Automóvel', icon: '🚗', order: 10),
  RegistryEntry(code: 'suv', label: 'SUV / TT', icon: '🚙', order: 20),
  RegistryEntry(code: 'van', label: 'Furgão', icon: '🚐', order: 30),
  RegistryEntry(code: 'motorcycle', label: 'Motociclo', icon: '🏍️', order: 40),
  RegistryEntry(code: 'scooter', label: 'Scooter', icon: '🛵', order: 50),
  RegistryEntry(code: 'bicycle', label: 'Bicicleta', icon: '🚲', order: 60),
  RegistryEntry(code: 'quad', label: 'Quadriciclo', icon: '🏎️', order: 70),
  RegistryEntry(code: 'truck', label: 'Comercial', icon: '🚚', order: 80),
  RegistryEntry(code: 'camper', label: 'Autocaravana', icon: '🚌', order: 90),
  RegistryEntry(code: 'other', label: 'Outro', icon: '🚘', order: 999),
];
