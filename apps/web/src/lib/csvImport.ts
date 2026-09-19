/**
 * Camada de leitura do *import* de CSV.
 *
 * ## Porque é que isto existe
 *
 * A resposta da API é um contrato técnico: códigos (`nao_mapeado`), identificadores
 * (`odometerKm`), contagens por tipo (`{ fuel: 3 }`) e números de linha. O ecrã não pode
 * mostrar nada disto (§11.3: *zero conceitos técnicos*). Traduzir no `render` de cada
 * componente parecia mais curto, mas na prática produziria a mesma tradução escrita três
 * vezes — no passo do mapeamento, no da pré-visualização e no do relatório — e as três
 * divergiriam à primeira alteração.
 *
 * Este módulo é o único sítio que sabe:
 *
 *  - o **nome legível** de um tipo de registo e de um campo canónico;
 *  - o que significa cada estado de coluna em português corrente;
 *  - o que conta como "precisa de decisão" e o que conta como "informação";
 *  - como se lê uma linha de valores heterogéneos (cêntimos, datas, litros) em texto.
 *
 * Tudo o resto é apresentação.
 */

import type { RecordKind } from '@zemlo/shared';
import type {
  ColumnAmbiguity,
  ColumnMapping,
  ColumnState,
  CsvDetection,
  CsvPreviewResponse,
  CsvRecordPreview,
  DateOrder,
  DecimalStyle,
  ImportIssue,
  KindInference,
  PlanEntry,
} from '../api/csvImport';

/* -------------------------------------------------------------------------- */
/* Nomes legíveis de tipos de registo                                          */
/* -------------------------------------------------------------------------- */

/*
 * Os rótulos são escritos aqui, e não importados do `RECORD_KINDS` do registry, porque o
 * registry descreve os tipos que um **veículo** pode receber (5) e um ficheiro CSV pode
 * conter tipos que não aparecem nessa lista — uma apólice, uma inspeção, um imposto, um
 * documento, um lembrete. Traduzir `inspection` a partir do registry daria `undefined` e o
 * ecrã mostraria a palavra `inspection` a um utilizador português.
 *
 * O registry continua a ser a fonte de verdade para os tipos que lá estão — a diferença é
 * que aqui a lista é a dos tipos que a **importação** consegue construir (§10.5), que é um
 * conjunto maior e com outra razão de existir.
 */
const KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
  vehicle: 'Veículo',
  odometer: 'Leitura de quilometragem',
  expense: 'Despesa',
  fuel: 'Abastecimento',
  charging: 'Carregamento',
  maintenance: 'Manutenção',
  insurance: 'Seguro',
  inspection: 'Inspeção',
  tax: 'Imposto',
  document: 'Documento',
  reminder: 'Lembrete',
});

/** Nome legível de um tipo de registo. Nunca devolve um código técnico. */
export function kindLabel(kind: RecordKind | string | null | undefined): string {
  if (!kind) return 'Registos';
  return KIND_LABELS[kind] ?? 'Registo';
}

/** Plural, para contagens ("3 abastecimentos"). */
export function kindLabelPlural(kind: RecordKind | string | null | undefined, count: number): string {
  const singular = kindLabel(kind);
  if (count === 1) return singular;
  const plural: Readonly<Record<string, string>> = {
    Veículo: 'Veículos',
    Despesa: 'Despesas',
    Abastecimento: 'Abastecimentos',
    Carregamento: 'Carregamentos',
    Manutenção: 'Manutenções',
    Seguro: 'Seguros',
    Inspeção: 'Inspeções',
    Imposto: 'Impostos',
    Documento: 'Documentos',
    Lembrete: 'Lembretes',
    'Leitura de quilometragem': 'Leituras de quilometragem',
  };
  return plural[singular] ?? singular;
}

/* -------------------------------------------------------------------------- */
/* Nomes legíveis de campos canónicos                                          */
/* -------------------------------------------------------------------------- */

/**
 * O rótulo de um campo canónico.
 *
 * Só os campos que um ficheiro pode trazer têm rótulo. Um campo desconhecido devolve o
 * identificador — o que é aceitável porque é a única informação disponível, e escondê-lo
 * daria um campo sem nome num ecrã de mapeamento, que é pior do que um nome técnico.
 */
const FIELD_LABELS: Readonly<Record<string, string>> = Object.freeze({
  date: 'Data',
  recordedAt: 'Data do registo',
  amountCents: 'Valor',
  odometerKm: 'Quilometragem',
  litres: 'Litros',
  energyKwh: 'Energia',
  pricePerLitreCents: 'Preço por litro',
  pricePerKwhCents: 'Preço por kWh',
  plate: 'Matrícula',
  vin: 'VIN',
  vendor: 'Fornecedor',
  category: 'Categoria',
  description: 'Descrição',
  notes: 'Notas',
  fuelType: 'Combustível',
  fullTank: 'Depósito cheio',
  consumption: 'Consumo',
  make: 'Marca',
  model: 'Modelo',
  year: 'Ano',
  nextDate: 'Próxima data',
  nextOdometerKm: 'Próxima quilometragem',
  policyNumber: 'Nº de apólice',
  insurer: 'Seguradora',
  premiumCents: 'Prémio',
  provider: 'Prestador',
  result: 'Resultado',
  dueDate: 'Data limite',
  amount: 'Montante',
  fileName: 'Nome do ficheiro',
  mimeType: 'Tipo de ficheiro',
  title: 'Título',
  startsAt: 'Início',
  endsAt: 'Fim',
  intervalMonths: 'Intervalo (meses)',
  intervalKm: 'Intervalo (km)',
  vehiclePlate: 'Matrícula do veículo',
});

export function fieldLabel(field: string | null | undefined): string {
  if (!field) return '—';
  return FIELD_LABELS[field] ?? field;
}

/* -------------------------------------------------------------------------- */
/* Estados de coluna                                                           */
/* -------------------------------------------------------------------------- */

export interface ColumnStateMeta {
  label: string;
  /** A frase que o utilizador lê ao lado da coluna. */
  explanation: string;
  tone: 'ok' | 'accent' | 'warn' | 'neutral';
  /** `true` quando impede avançar sem uma decisão (§10.4). */
  needsDecision: boolean;
}

const COLUMN_STATE_META: Readonly<Record<ColumnState, ColumnStateMeta>> = Object.freeze({
  confirmado: {
    label: 'Reconhecido',
    explanation: 'O nome desta coluna corresponde exatamente a um campo do Zemlo.',
    tone: 'ok',
    needsDecision: false,
  },
  sugerido: {
    label: 'Sugerido',
    explanation: 'Esta coluna parece ser este campo, mas o nome não é exatamente igual.',
    tone: 'accent',
    needsDecision: false,
  },
  ambiguo: {
    label: 'Precisa de decisão',
    explanation: 'Esta coluna pode ser mais do que uma coisa. Escolhe o que é.',
    tone: 'warn',
    needsDecision: true,
  },
  nao_mapeado: {
    label: 'Ignorada',
    explanation: 'Não há campo correspondente. Esta coluna não será importada.',
    tone: 'neutral',
    needsDecision: false,
  },
});

export function columnStateMeta(state: ColumnState): ColumnStateMeta {
  /*
   * O `?? ` não é defensivo por acaso: `COLUMN_STATE_META` é indexado por um tipo que vem do
   * contrato da API, e o TypeScript não consegue garantir que um servidor mais recente não
   * introduza um estado novo. Recair em `nao_mapeado` — "ignorada" — é a escolha segura: um
   * estado desconhecido nunca deve ser apresentado como uma coluna que exige decisão, porque
   * isso bloquearia o fluxo num ecrã sem resposta possível.
   */
  return COLUMN_STATE_META[state] ?? COLUMN_STATE_META.nao_mapeado;
}

/* -------------------------------------------------------------------------- */
/* Qualidade da deteção                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Traduz a confiança da deteção numa recomendação.
 *
 * O limiar de 0,8 não é decorativo: a `confidence` da deteção é o **mínimo** das três
 * confianças, e abaixo de 0,8 há pelo menos uma decisão (codificação, separador ou
 * cabeçalho) que foi tomada por uma margem curta. Nesse caso o ecrã pede confirmação em vez
 * de avançar — e fá-lo pelo mesmo número que o servidor usou, não por um segundo critério
 * inventado na interface.
 */
export function detectionNeedsConfirmation(detection: CsvDetection): boolean {
  return detection.confidence < 0.8 || detection.encodingUncertain || detection.issues.length > 0;
}

/** A frase que resume a deteção, no formato do passo 1 da §10.2. */
export function detectionSummary(detection: CsvDetection): string {
  const rows = detection.rowCount;
  const columns = detection.headers.length;
  return `Encontrei ${rows} ${rows === 1 ? 'linha' : 'linhas'} e ${columns} ${
    columns === 1 ? 'coluna' : 'colunas'
  }.`;
}

/* -------------------------------------------------------------------------- */
/* Ambiguidades de valor (§10.4)                                               */
/* -------------------------------------------------------------------------- */

/**
 * Traduz uma ambiguidade de valor no par «pergunta + respostas possíveis».
 *
 * ## Porque é que a pergunta vem do servidor e a resposta é construída aqui
 *
 * A `question` chega pronta da API e é apresentada tal como veio: é texto escrito para ser
 * lido, e reescrevê-lo aqui produziria duas versões da mesma pergunta a divergir. O que se
 * constrói aqui é o **mapeamento da resposta para a convenção**, que é vocabulário do
 * contrato (`dateOrder`, `decimalStyle`) e não pode ser inventado pelo servidor — o campo
 * da resposta é o mesmo que o seletor de convenções usa, porque responder a uma ambiguidade
 * *é* escolher uma convenção.
 *
 * ## Porque é que `unidade_ambigua` não tem resposta aqui
 *
 * Uma unidade ambígua («Km/l» — consumo médio ou quilometragem) resolve-se por `resolvedUnits`,
 * que é por campo e não por convenção global. Não é oferecida uma resposta a meia,
 * porque uma resposta que não chega ao servidor é pior do que nenhuma: o utilizador
 * acreditava ter resolvido e o ficheiro continuava por interpretar.
 */
export interface AmbiguityChoice {
  /** Rótulo do botão. */
  label: string;
  /** Parâmetro a enviar na reanálise. */
  patch: { dateOrder?: DateOrder } | { decimalStyle?: DecimalStyle };
}

export interface AmbiguityView {
  code: ColumnAmbiguity['code'];
  /** O nome legível da coluna afetada — «Preço», e não `amountCents`. */
  field: string;
  question: string;
  choices: AmbiguityChoice[];
  /** Valores de amostra das duas leituras, para a decisão se tomar a olhar para os dados. */
  samples: Array<{ label: string; values: string[] }>;
}

/**
 * Constrói a vista de cada ambiguidade por resolver.
 *
 * A ordem é a que veio do servidor — a das colunas no ficheiro — e não uma ordenação por
 * gravidade: o utilizador lê as perguntas na mesma ordem em que lê o ficheiro, e reordená-las
 * obrigá-lo-ia a encontrar a coluna antes de responder.
 */
export function ambiguityViews(
  ambiguities: readonly ColumnAmbiguity[],
): AmbiguityView[] {
  return ambiguities.map((ambiguity) => ({
    code: ambiguity.code,
    field: fieldLabel(ambiguity.field),
    question: ambiguity.question,
    choices: choicesFor(ambiguity.code),
    samples: ambiguity.alternatives.map((alternative) => ({
      label: alternative.label,
      values: alternative.preview,
    })),
  }));
}

/** As respostas possíveis de cada tipo de ambiguidade. */
function choicesFor(code: ColumnAmbiguity['code']): AmbiguityChoice[] {
  switch (code) {
    case 'data_ambigua':
      return [
        { label: 'Dia / Mês', patch: { dateOrder: 'dia-mes' } },
        { label: 'Mês / Dia', patch: { dateOrder: 'mes-dia' } },
      ];
    case 'separador_decimal':
      return [
        { label: 'Vírgula (1.234,56)', patch: { decimalStyle: 'virgula' } },
        { label: 'Ponto (1,234.56)', patch: { decimalStyle: 'ponto' } },
      ];
    /*
     * Duas moedas e unidade ambígua não se resolvem por convenção global. Listar aqui um
     * botão que não altera nada seria a pior forma de "resolver" — o utilizador carregava,
     * o ecrã reanalisava, e a pergunta voltava. A lista vazia faz o passo mostrar a
     * pergunta e o remédio (corrigir o ficheiro / mapear a coluna) sem fingir uma resposta.
     */
    case 'moedas_multiplas':
    case 'unidade_ambigua':
    default:
      return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Tipo de registo                                                             */
/* -------------------------------------------------------------------------- */

/**
 * `true` quando o utilizador tem de escolher o tipo de registo.
 *
 * Cobre os dois casos em que o servidor não decidiu: `ambiguo` (duas regras com pontuação
 * próxima, §10.5) e `insuficiente` (colunas a menos para reconhecer seja o que for). São
 * situações diferentes para o servidor e a mesma para o utilizador: uma pergunta de uma
 * linha.
 */
export function inferenceNeedsChoice(inference: KindInference, kind: RecordKind | null): boolean {
  return kind === null || inference.state === 'ambiguo' || inference.state === 'insuficiente';
}

/* -------------------------------------------------------------------------- */
/* Contagens do plano em frases                                                */
/* -------------------------------------------------------------------------- */

export interface PlanRow {
  label: string;
  count: number;
  /** `true` quando esta linha pede uma ação do utilizador. */
  actionable: boolean;
  tone: 'ok' | 'accent' | 'warn' | 'neutral' | 'danger';
  hint?: string;
}

/**
 * As quatro linhas do passo 3 da §11.2, na ordem em que aparecem no ecrã.
 *
 * A ordem é fixa e não ordenada por contagem: o utilizador aprende-a uma vez e passa a
 * encontrar "Já existem" sempre no mesmo sítio. Linhas a zero continuam a ser mostradas
 * quando fazem parte das quatro — `Não vou importar: 0` confirma que nada ficou de fora, o
 * que é uma informação, não um ruído. As linhas condicionais (conflitos, quarentena) só
 * aparecem quando têm conteúdo, porque aí a ausência já é o valor por omissão.
 */
export function planRows(counts: CsvPreviewResponse['plan']['counts']): PlanRow[] {
  const rows: PlanRow[] = [
    {
      label: 'Criar',
      count: counts.create,
      actionable: false,
      tone: 'ok',
      hint: 'Registos novos que vão ser acrescentados.',
    },
    {
      label: 'Já existem',
      count: counts.exact,
      actionable: false,
      tone: 'neutral',
      hint: 'Registos iguais aos que já tens. Não são criados outra vez.',
    },
    {
      label: 'Precisam de decisão',
      count: counts.probable + counts.quarantined,
      actionable: counts.probable + counts.quarantined > 0,
      tone: 'warn',
      hint: 'Registos que podem já existir, ou a que falta um campo obrigatório.',
    },
    {
      label: 'Não vou importar',
      count: counts.skipped,
      actionable: false,
      tone: 'neutral',
      hint: 'Linhas que não foi possível interpretar.',
    },
  ];

  if (counts.enriching > 0) {
    rows.push({
      label: 'Completar registos teus',
      count: counts.enriching,
      actionable: false,
      tone: 'accent',
      hint: 'Registos que já tens e a que este ficheiro acrescenta campos que estavam vazios.',
    });
  }

  if (counts.conflicting > 0) {
    rows.push({
      label: 'Em conflito',
      count: counts.conflicting,
      actionable: true,
      tone: 'danger',
      hint: 'O ficheiro diz uma coisa e o Zemlo tem outra. Nada é substituído sem tu decidires.',
    });
  }

  return rows;
}

/* -------------------------------------------------------------------------- */
/* Problemas                                                                   */
/* -------------------------------------------------------------------------- */

export interface GroupedIssues {
  /** Impedem a importação de avançar sozinha. */
  blocking: ImportIssue[];
  /** Entram, mas com uma lacuna declarada. */
  recoverable: ImportIssue[];
  /** Informação, sem consequência. */
  info: ImportIssue[];
}

/**
 * Agrupa problemas por gravidade.
 *
 * O agrupamento é o mesmo que o servidor fez em `issueSummary`; aqui repete-se porque o
 * ecrã precisa das **mensagens** e não só das contagens, e porque o plano já as traz
 * agregadas. Uma importação de 8 000 linhas pode trazer centenas de problemas iguais: a
 * interface mostra as contagens do servidor e esta lista serve para o detalhe.
 */
export function groupIssues(issues: readonly ImportIssue[]): GroupedIssues {
  const grouped: GroupedIssues = { blocking: [], recoverable: [], info: [] };
  for (const issue of issues) {
    if (issue.severity === 'blocking') grouped.blocking.push(issue);
    else if (issue.severity === 'recoverable') grouped.recoverable.push(issue);
    else grouped.info.push(issue);
  }
  return grouped;
}

/** Quantos problemas há, para decidir se vale a pena abrir a secção. */
export function issueCount(issues: readonly ImportIssue[]): number {
  return issues.length;
}

/* -------------------------------------------------------------------------- */
/* Ações do plano                                                              */
/* -------------------------------------------------------------------------- */

const ACTION_LABELS: Readonly<Record<PlanEntry['action'], string>> = Object.freeze({
  create: 'Criar',
  exact: 'Já existe',
  probable: 'Talvez já exista',
  quarantined: 'Precisa de decisão',
  skipped: 'Não importar',
});

export function actionLabel(action: PlanEntry['action']): string {
  return ACTION_LABELS[action] ?? action;
}

const CONFLICT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  new: 'Novo',
  duplicate: 'Igual',
  enrich: 'Completa um registo teu',
  conflict: 'Diverge do que tens',
});

export function conflictLabel(conflict: string): string {
  return CONFLICT_LABELS[conflict] ?? conflict;
}

/* -------------------------------------------------------------------------- */
/* Valores, em texto                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Escreve um valor canónico para ser lido.
 *
 * A pré-visualização mostra os valores **já normalizados** (§10.2, passo 5) — o que significa
 * que chegam aqui como o núcleo os guarda: cêntimos inteiros, datas civis `YYYY-MM-DD`,
 * quilómetros como número. Mostrá-los em bruto seria mostrar ao utilizador
 * `1234567` onde ele escreveu `12 345,67 €`, e a reação natural seria concluir que a
 * importação está errada.
 *
 * A conversão é feita a partir do **nome do campo**, porque é ele que determina a unidade:
 * `amountCents` são cêntimos, `odometerKm` são quilómetros. Sem isso, 1234567 seria
 * indistinguível de 1234567 kg.
 */
export function formatPreviewValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';

  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';

  if (typeof value === 'number') {
    if (/cents$/i.test(field)) return money(value);
    if (/kwh$/i.test(field)) return `${number(value, 2)} kWh`;
    if (/(km|mileage)/i.test(field)) return `${number(value, 0)} km`;
    if (/litres$/i.test(field)) return `${number(value, 2)} l`;
    return number(value, 2);
  }

  if (typeof value === 'string') {
    // Datas civis (`YYYY-MM-DD`) e datas-hora ISO são ambas reconhecíveis pelo padrão; a
    // segunda é truncada porque a hora não faz parte do contrato do domínio.
    const civil = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (civil) return `${civil[3]}/${civil[2]}/${civil[1]}`;
    return value;
  }

  return String(value);
}

/** Euros a partir de cêntimos, com o formato português. */
function money(cents: number): string {
  return `${number(cents / 100, 2)} €`;
}

/** Número com o separador decimal português. */
function number(value: number, decimals: number): string {
  return value.toLocaleString('pt-PT', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Os campos de um registo normalizado, ordenados para a leitura ser estável entre linhas. */
export function previewFields(record: CsvRecordPreview): Array<{ field: string; label: string; value: string }> {
  return Object.entries(record.fields)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([field, value]) => ({
      field,
      label: fieldLabel(field),
      value: formatPreviewValue(field, value),
    }));
}

/* -------------------------------------------------------------------------- */
/* Colunas: sugestões para o seletor                                           */
/* -------------------------------------------------------------------------- */

/**
 * As opções de um seletor de campo para uma coluna.
 *
 * A ordem conta: primeiro as leituras possíveis que o servidor encontrou (compatíveis com o
 * tipo inferido à frente), depois — e só se ele não encontrou nenhuma — os campos do tipo
 * inferido em bruto. Assim, numa coluna claramente reconhecida o utilizador vê duas ou três
 * opções relevantes em vez da lista completa do vocabulário.
 */
export function fieldOptions(
  column: ColumnMapping,
  canonicalFields: readonly string[],
): Array<{ field: string; label: string }> {
  const ordered = [...column.candidates].sort((a, b) => {
    if (a.compatibleWithKind !== b.compatibleWithKind) return a.compatibleWithKind ? -1 : 1;
    return b.confidence - a.confidence;
  });

  const seen = new Set<string>();
  const options: Array<{ field: string; label: string }> = [];

  for (const candidate of ordered) {
    if (seen.has(candidate.field)) continue;
    seen.add(candidate.field);
    options.push({ field: candidate.field, label: fieldLabel(candidate.field) });
  }

  for (const field of canonicalFields) {
    if (seen.has(field)) continue;
    seen.add(field);
    options.push({ field, label: fieldLabel(field) });
  }

  return options;
}

/* -------------------------------------------------------------------------- */
/* Estado inicial das decisões                                                 */
/* -------------------------------------------------------------------------- */

/**
 * As decisões que o utilizador já tomou, derivadas do que o servidor propôs.
 *
 * Uma coluna `ambiguo` fica **sem** decisão (ausente do mapa) — é isso que a mantém a contar
 * como pendente. Omitir uma `sugerido` seria aceitar em silêncio uma sugestão que o
 * utilizador não viu; por isso as sugestões são enviadas como decisões explícitas na
 * primeira revisão, e é a interface que as mostra antes de as aplicar.
 */
export function decisionsFromMapping(
  columns: readonly ColumnMapping[],
  accepted: ReadonlyMap<number, string | null>,
): Array<{ index: number; field: string | null }> {
  const decisions: Array<{ index: number; field: string | null }> = [];
  for (const column of columns) {
    if (accepted.has(column.index)) {
      decisions.push({ index: column.index, field: accepted.get(column.index) ?? null });
    }
  }
  return decisions;
}

/** As colunas que ainda exigem uma decisão, dado o que já foi decidido. */
export function pendingColumns(
  columns: readonly ColumnMapping[],
  decided: ReadonlyMap<number, string | null>,
): ColumnMapping[] {
  return columns.filter((column) => column.state === 'ambiguo' && !decided.has(column.index));
}
