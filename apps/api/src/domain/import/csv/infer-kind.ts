/**
 * Inferência do tipo de registo a partir das colunas presentes (§10.5).
 *
 * Este módulo é puro: não toca em disco, rede, base de dados nem relógio. Recebe o
 * conjunto de campos canónicos que resultaram do mapeamento e devolve o tipo de registo
 * mais provável, com a evidência que o sustenta.
 *
 * ## Porque é que a evidência é devolvida e não apenas o resultado
 *
 * A §10.5 dá uma tabela de quatro regras, mas a realidade dos ficheiros portugueses é mais
 * suja. Um ficheiro com `data + valor + categoria + litros` satisfaz *duas* regras ao mesmo
 * tempo. A resposta útil não é "Abastecimento" — é "Abastecimento, porque há litros; nota
 * que também tem categoria, que é típico de despesa". O resultado tem, por isso, a lista de
 * evidências a favor e contra, para que a pergunta ao utilizador seja informada.
 *
 * ## A diferença entre "não sei" e "não há dados suficientes"
 *
 * Dois casos distintos, e misturá-los seria o erro mais fácil de cometer:
 *
 *  - **Insuficiente** — faltam colunas essenciais (não há data, ou não há valor nem km).
 *    Não há pergunta a fazer: o ficheiro não descreve registos importáveis.
 *  - **Ambíguo** — há dados suficientes, mas mais do que um tipo é plausível. Aqui sim,
 *    pergunta-se (§10.5: "pergunta de uma linha").
 *
 * Um resultado nunca escolhe em silêncio quando o segundo caso se aplica.
 */

import { CANONICAL_FIELDS } from '@zemlo/shared';
import type { RecordKind } from '../validate.js';

/* -------------------------------------------------------------------------- */
/* Regras da §10.5                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Uma regra de inferência.
 *
 * `requires` (todos obrigatórios), `boosts` (aumentam a confiança), `excludes` (a sua
 * presença torna a regra implausível, avaliação negativa).
 */
export interface InferenceRule {
  readonly kind: RecordKind;
  /** Campo que identifica a regra — é o que a torna específica. */
  readonly signature: string;
  /**
   * Assinaturas alternativas: basta **uma** delas estar presente.
   *
   * Existe por causa do "tipo ou oficina" da §10.5. Sem isto, a regra teria de exigir as
   * duas colunas (demasiado restritivo) ou nenhuma (demasiado permissivo, competindo com
   * despesa em qualquer ficheiro com um valor).
   */
  readonly signatureAlternatives?: readonly string[];
  readonly requires: readonly string[];
  readonly boosts: readonly string[];
  /** Campos que, presentes, retiram força à regra. */
  readonly weakens: readonly string[];
  readonly label: string;
}

/** Congela cada regra e cada lista dentro dela. */
function freezeRules(rules: readonly InferenceRule[]): readonly InferenceRule[] {
  for (const rule of rules) {
    Object.freeze(rule.requires);
    Object.freeze(rule.boosts);
    Object.freeze(rule.weakens);
    if (rule.signatureAlternatives) Object.freeze(rule.signatureAlternatives);
    Object.freeze(rule);
  }
  return Object.freeze(rules);
}

/**
 * As quatro regras da §10.5, na ordem em que a especificação as apresenta.
 *
 * A ordem não é a prioridade — a prioridade é calculada. É apenas a ordem de leitura, para
 * que o relatório liste as regras tal como o utilizador as vê na documentação.
 */
export const INFERENCE_RULES: readonly InferenceRule[] = freezeRules([
  {
    kind: 'fuel',
    signature: 'litres',
    requires: ['date', 'amountCents', 'litres'],
    boosts: ['odometerKm', 'station', 'pricePerLitreCents', 'fullTank', 'fuelType'],
    weakens: [],
    label: 'Abastecimento',
  },
  {
    kind: 'expense',
    signature: 'category',
    requires: ['date', 'amountCents', 'category'],
    boosts: ['vendor', 'description', 'paymentMethod', 'paid'],
    weakens: ['litres', 'energyKwh'],
    label: 'Despesa',
  },
  {
    kind: 'maintenance',
    signature: 'type',
    /*
     * A §10.5 diz "data + valor + tipo ou oficina (+ próxima data)". Lida à letra, "ou"
     * significaria que basta data + valor — e isso tornaria a regra tão permissiva que
     * dispararia em qualquer ficheiro com um valor, competindo com despesa e com
     * abastecimento em igualdade.
     *
     * A leitura correta do "ou" é sobre **qual das duas colunas identifica a manutenção**:
     * a coluna que a distingue de uma despesa comum é `type` (tipo de intervenção) ou
     * `vendor` (oficina). Exige-se uma das duas, não as duas.
     */
    requires: ['date', 'amountCents'],
    signatureAlternatives: ['type', 'vendor'],
    boosts: ['nextDate', 'nextOdometerKm'],
    weakens: ['litres', 'energyKwh'],
    label: 'Manutenção',
  },
  {
    kind: 'odometer',
    signature: 'odometerKm',
    requires: ['date', 'odometerKm'],
    boosts: ['origin'],
    // §10.5: "sem valor". Um valor monetário presente retira força a esta regra.
    weakens: ['amountCents'],
    label: 'Quilometragem',
  },
  {
    kind: 'charging',
    signature: 'energyKwh',
    requires: ['date', 'energyKwh'],
    boosts: ['amountCents', 'pricePerKwhCents', 'location', 'startSocPercent', 'endSocPercent'],
    weakens: [],
    label: 'Carregamento',
  },
]);

/** Tipos que a inferência pode devolver. */
export const INFERABLE_KINDS: readonly RecordKind[] = Object.freeze(
  INFERENCE_RULES.map((rule) => rule.kind),
);

/* -------------------------------------------------------------------------- */
/* Resultado                                                                   */
/* -------------------------------------------------------------------------- */

/** Estado da inferência. */
export const INFERENCE_STATES = ['inequivoco', 'ambiguo', 'insuficiente'] as const;
export type InferenceState = (typeof INFERENCE_STATES)[number];

/** Uma regra avaliada, com a pontuação que recebeu. */
export interface RuleAssessment {
  readonly kind: RecordKind;
  readonly label: string;
  /** 0..1 — quão bem as colunas presentes servem esta regra. */
  readonly score: number;
  /** Colunas obrigatórias que estão em falta. */
  readonly missing: readonly string[];
  /** Colunas presentes que fortalecem a regra. */
  readonly supportingBoosts: readonly string[];
  /** Colunas presentes que enfraquecem a regra. */
  readonly weakening: readonly string[];
}

/** Resultado da inferência de tipo. */
export interface KindInference {
  readonly state: InferenceState;
  /** Tipo escolhido. `null` quando ambíguo ou insuficiente. */
  readonly kind: RecordKind | null;
  /** Confiança 0..1 na escolha. */
  readonly confidence: number;
  /** Todas as regras avaliadas, ordenadas por pontuação. */
  readonly assessments: readonly RuleAssessment[];
  /** Quando `ambiguo`, os tipos entre os quais o utilizador tem de escolher. */
  readonly alternatives: readonly { kind: RecordKind; label: string; score: number }[];
  /** Explicação legível, pronta a apresentar. */
  readonly reason: string;
}

/** Campos cuja presença é considerada relevante para a inferência. */
const ALL_INFERENCE_FIELDS: readonly string[] = Object.freeze([
  ...new Set(
    INFERENCE_RULES.flatMap((rule) => [
      rule.signature,
      ...(rule.signatureAlternatives ?? []),
      ...rule.requires,
      ...rule.boosts,
      ...rule.weakens,
    ]),
  ),
]);

/**
 * Margem mínima entre a melhor e a segunda melhor pontuação para decidir sozinho.
 *
 * Abaixo **ou igual** a esta margem, duas regras são consideradas indiferenciáveis e o
 * resultado é `ambiguo`. O valor não é arbitrário: cada `boost` vale exatamente 0.1, e
 * portanto uma margem de 0.1 corresponde a **um único reforço** de diferença. Assumir que
 * um reforço chega para escolher seria dar a mesma força a uma evidência circunstancial
 * (uma coluna `nextDate`) e a uma evidência estrutural (a presença de `category`).
 *
 * O teste que fixa esta fronteira é `assinala ambiguidade com uma margem de um só reforço`.
 */
const AMBIGUITY_MARGIN = 0.1;

/**
 * Comparação de margem: ambíguo quando a diferença é **igual ou inferior** a
 * `AMBIGUITY_MARGIN`.
 *
 * Um erro de arredondamento de vírgula flutuante aqui produziria um comportamento
 * instável (0.7000000000000001 vs 0.7), por isso a comparação usa uma tolerância.
 */
function isWithinAmbiguityMargin(best: number, other: number): boolean {
  return best - other <= AMBIGUITY_MARGIN + 1e-9;
}

/** Peso de uma coluna obrigatória presente. */
const WEIGHT_REQUIRED = 0.6;
/** Peso de um `boost` presente. */
const WEIGHT_BOOST = 0.1;
/** Penalização por uma coluna que enfraquece a regra. */
const WEIGHT_WEAKEN = 0.2;

/* -------------------------------------------------------------------------- */
/* Inferência                                                                  */
/* -------------------------------------------------------------------------- */

export interface InferKindOptions {
  /**
   * Campos a considerar. Quando omitido, são usados todos os campos canónicos do Zemlo.
   *
   * A lista de campos presentes deve vir do mapeamento **já resolvido** — incluir uma
   * coluna ambígua seria inferir o tipo a partir de uma decisão que ainda não foi tomada.
   */
  readonly fields?: readonly string[];
}

/**
 * Infere o tipo de registo a partir das colunas presentes.
 *
 * Não força uma classificação: devolve `insuficiente` quando os dados não chegam e
 * `ambiguo` quando chegam para mais do que um tipo.
 */
export function inferRecordKind(
  presentFields: readonly string[],
  options: InferKindOptions = {},
): KindInference {
  const fields = options.fields ?? presentFields;
  const present = new Set(fields.filter((field) => isRelevantField(field)));

  const assessments: RuleAssessment[] = INFERENCE_RULES.map((rule) =>
    assessRule(rule, present),
  ).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.kind.localeCompare(b.kind);
  });

  const viable = assessments.filter((a) => a.missing.length === 0);

  /*
   * Nenhuma regra tem todas as colunas obrigatórias. Distinguimos dois casos que a
   * pontuação sozinha confundiria:
   *  - se nem há data, o ficheiro não descreve registos datados e a resposta é
   *    `insuficiente`;
   *  - se há data mas falta o valor/km, também é insuficiente, mas por outro motivo.
   */
  if (viable.length === 0) {
    return insufficientResult(assessments, present);
  }

  const best = viable[0] as RuleAssessment;

  if (best.score <= 0) {
    return insufficientResult(assessments, present);
  }

  // Uma regra com pontuação zero não é uma alternativa real, mesmo que "viável".
  const realAlternatives = viable.filter(
    (assessment) => assessment.score > 0 && isWithinAmbiguityMargin(best.score, assessment.score),
  );

  if (realAlternatives.length > 1) {
    const competing = realAlternatives.filter((a) => a.kind !== best.kind);
    if (competing.length > 0) {
      return {
        state: 'ambiguo',
        kind: null,
        confidence: 0,
        assessments,
        alternatives: realAlternatives.map((a) => ({
          kind: a.kind,
          label: a.label,
          score: a.score,
        })),
        reason: `As colunas presentes são compatíveis com ${realAlternatives.map((a) => a.label).join(' e com ')} — escolhe o tipo correto.`,
      };
    }
  }

  /*
   * Confiança: parte da pontuação da regra vencedora e cresce com a distância à melhor
   * concorrente real. Uma regra que ganha por margem confortável é uma classificação mais
   * segura do que uma que ganha por um fio; a fórmula tem de refletir isso, senão o valor
   * devolvido seria apenas uma reescrita da pontuação.
   */
  const bestCompetitor = viable.find((assessment) => assessment.kind !== best.kind && assessment.score > 0);
  const margin = bestCompetitor === undefined ? best.score : best.score - bestCompetitor.score;
  const confidence = clamp01(0.5 + best.score / 2 + margin / 2);

  return {
    state: 'inequivoco',
    kind: best.kind,
    confidence,
    assessments,
    alternatives: [],
    reason: describeChoice(best),
  };
}

/** Avalia uma regra contra o conjunto de campos presentes. */
function assessRule(rule: InferenceRule, present: ReadonlySet<string>): RuleAssessment {
  const missing: string[] = [];

  for (const field of rule.requires) {
    // `requires` e `boosts` podem partilhar um campo (ex.: `energyKwh` em charging é
    // obrigatório e, quando a regra já é viável, conta também como reforço). A ausência
    // não pode ser reportada duas vezes.
    if (!present.has(field)) missing.push(field);
  }

  /*
   * A assinatura é o que distingue esta regra das outras. Exigi-la é o que impede que
   * uma regra de estrutura fraca (data + valor) dispare em qualquer ficheiro.
   *
   * Sem assinaturas alternativas, a assinatura é uma coluna obrigatória como as outras.
   * Com elas, basta uma estar presente — mas pelo menos uma tem de estar.
   */
  const alternatives = rule.signatureAlternatives;
  if (alternatives && alternatives.length > 0) {
    const hasSignature = alternatives.some((field) => present.has(field));
    if (!hasSignature) missing.push(alternatives.join(' ou '));
  } else if (!present.has(rule.signature) && !missing.includes(rule.signature)) {
    missing.push(rule.signature);
  }

  const presentAlternatives = (alternatives ?? []).filter((field) => present.has(field));
  const supportingBoosts = [
    ...new Set([
      ...rule.boosts.filter((field) => present.has(field)),
      ...presentAlternatives,
    ]),
  ];
  const weakening = rule.weakens.filter((field) => present.has(field));

  if (missing.length > 0) {
    return {
      kind: rule.kind,
      label: rule.label,
      score: 0,
      missing,
      supportingBoosts,
      weakening,
    };
  }

  let score = WEIGHT_REQUIRED;
  score += Math.min(0.3, supportingBoosts.length * WEIGHT_BOOST);
  score -= weakening.length * WEIGHT_WEAKEN;

  return {
    kind: rule.kind,
    label: rule.label,
    score: clamp01(score),
    missing,
    supportingBoosts,
    weakening,
  };
}

/** Constrói o resultado `insuficiente`, com a razão mais informativa possível. */
function insufficientResult(
  assessments: readonly RuleAssessment[],
  present: ReadonlySet<string>,
): KindInference {
  const hasDate = present.has('date') || present.has('recordedAt');
  const hasValue = present.has('amountCents');
  const hasKm = present.has('odometerKm');

  let reason: string;
  if (!hasDate && !hasValue && !hasKm) {
    reason =
      'Não foram identificadas colunas de data, valor ou quilometragem: não há dados suficientes para reconhecer registos.';
  } else if (!hasDate) {
    reason = 'Falta uma coluna de data: sem data não é possível reconhecer o tipo de registo.';
  } else if (!hasValue && !hasKm) {
    reason =
      'Há data, mas falta um valor ou uma quilometragem: não é possível saber que tipo de registo é.';
  } else {
    reason = 'As colunas presentes não correspondem a nenhum tipo de registo conhecido.';
  }

  return {
    state: 'insuficiente',
    kind: null,
    confidence: 0,
    assessments: [...assessments],
    alternatives: [],
    reason,
  };
}

/** Descrição legível da escolha, com a evidência que a sustenta. */
function describeChoice(assessment: RuleAssessment): string {
  const boosts = assessment.supportingBoosts;
  if (boosts.length === 0) {
    return `Identificado como ${assessment.label} pelas colunas obrigatórias presentes.`;
  }
  return `Identificado como ${assessment.label}: as colunas ${boosts.join(', ')} reforçam a identificação.`;
}

/** True quando o campo participa na inferência. */
function isRelevantField(field: string): boolean {
  return ALL_INFERENCE_FIELDS.includes(field);
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/* -------------------------------------------------------------------------- */
/* Apoio à decisão do utilizador                                               */
/* -------------------------------------------------------------------------- */

/**
 * Campos canónicos exigidos por um tipo, para validar uma escolha manual.
 *
 * Usado quando o utilizador resolve uma ambiguidade: a UI mostra os tipos possíveis e,
 * com a escolha feita, é possível avisar se faltam colunas obrigatórias — em vez de deixar
 * a importação avançar para uma validação que falharia de forma menos clara.
 */
export function requiredFieldsFor(kind: RecordKind): readonly string[] {
  const rule = INFERENCE_RULES.find((r) => r.kind === kind);
  if (rule) return rule.requires;
  return [];
}

/** True quando o tipo é sequer inferível a partir de colunas (§10.5). */
export function isInferableKind(kind: string): boolean {
  return INFERABLE_KINDS.includes(kind as RecordKind);
}

/**
 * Tipos que o CSV genérico consegue construir, independentemente da inferência.
 *
 * Inclui a ficha de veículo (que não tem data nem valor e por isso nunca é *inferida*,
 * mas que o utilizador pode escolher explicitamente) e exclui os tipos que só fazem
 * sentido dentro de um bundle do Zemlo (`event`, `suggestion`, `notification`), porque
 * não são dados que um utilizador tenha num ficheiro (§15).
 */
export const CSV_SUPPORTED_KINDS: readonly RecordKind[] = Object.freeze([
  'vehicle',
  'odometer',
  'expense',
  'fuel',
  'charging',
  'maintenance',
  'insurance',
  'inspection',
  'tax',
  'document',
  'reminder',
] as readonly RecordKind[]);

/** True quando o CSV genérico consegue construir registos deste tipo. */
export function isCsvSupportedKind(kind: string): boolean {
  return CSV_SUPPORTED_KINDS.includes(kind as RecordKind);
}

/** Campos canónicos do tipo, para a UI e para o mapeador. */
export function canonicalFieldsFor(kind: RecordKind): readonly string[] {
  return CANONICAL_FIELDS[kind] ?? [];
}
