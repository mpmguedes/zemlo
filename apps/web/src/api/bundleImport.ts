/**
 * Contrato do *import* do bundle nativo (Camada 1, §3.1, §5.2).
 *
 * ## Porque é que este ficheiro existe separado de `csvImport.ts`
 *
 * As duas camadas partilham a mesma separação analisar/aplicar, mas **não partilham as
 * formas**. O CSV tem deteção de codificação, mapeamento de colunas com candidatos,
 * convenções por confirmar — tudo o que é preciso para interpretar um ficheiro que não
 * conhecemos. Um bundle já conhece a sua própria estrutura: tem um `manifest`, declara os
 * ficheiros que traz, e o que o leitor pode recusar é a **integridade**, não a
 * interpretação.
 *
 * Misturar as duas formas num tipo só obrigaria cada camada a carregar campos que nunca
 * usa (`detection` para o bundle, `scopeNote` para o CSV) e faria a interface testar a
 * presença de campos para saber que ecrã desenhar. Dois contratos explícitos são mais
 * honestos do que um contrato largo com metade dos campos sempre vazios.
 *
 * ## O que **não** está aqui
 *
 * - Os `records` canónicos. A API constrói-os para escrever, mas não os devolve: o que a
 *   resposta traz é o **plano** — a proposta em termos de ações e contagens. A interface
 *   nunca envia dados para o servidor escrever; envia o ficheiro e o plano que aprovou.
 * - Os bytes dos documentos. Não atravessam a fronteira HTTP na resposta (§5.6): são
 *   verificados dentro do ZIP e guardados pelo `apply`.
 */

import type { ImportIssue, RecordKind } from '@zemlo/shared';

/* -------------------------------------------------------------------------- */
/* O plano (§11.2)                                                             */
/* -------------------------------------------------------------------------- */

/**
 * O estado do plano.
 *
 * `blocked` não é um plano aplicável: existe para que o ecrã consiga apresentar os
 * problemas em vez de ficar vazio (§11.3).
 */
export type BundlePlanState = 'ready' | 'blocked' | 'nothing-to-do';

/**
 * A ação proposta para um registo.
 *
 * Os identificadores são os do domínio (`plan.ts`) e não uma tradução: a §11.3 proíbe
 * conceitos técnicos **na apresentação**, não no contrato. Quem os traduz para linguagem
 * de utilizador é o ecrã.
 */
export type BundlePlanAction = 'create' | 'exact' | 'probable' | 'quarantined' | 'skipped';

/** Como o registo interage com um que já exista. Não é o mesmo que a ação. */
export type BundleConflictKind = 'new' | 'duplicate' | 'enrich' | 'conflict';

/** Um registo existente que coincidiu com um do bundle. */
export interface BundleMatchedRecord {
  id: string;
  kind: string;
  action: BundlePlanAction;
  conflict: BundleConflictKind;
  /** Explica **em que** coincidem: a chave que casou, com os campos que cobriu. */
  viaKey: unknown;
  /** Distância nos campos com tolerância — "quilometragem a 4 km" (§9.3). */
  distance?: Record<string, number>;
}

/** A proposta do plano para um registo do bundle. */
export interface BundlePlanEntry {
  localId: string;
  kind: RecordKind;
  file?: string;
  line?: number;
  action: BundlePlanAction;
  conflict: BundleConflictKind;
  /**
   * A chave que fundamenta a classificação.
   *
   * Ausente quando a ação é `create` — não houve coincidência. E é por isso que uma
   * entrada `create` nunca deve ser lida como "provavelmente novo": é nova.
   */
  viaKey?: unknown;
  matched: BundleMatchedRecord[];
  /** Razão legível, já escrita para ser mostrada. Nunca um código técnico (§11.3). */
  reason?: string;
  /** Campos que o bundle preencheria num registo existente. */
  enrichableFields: string[];
  /** Campos em que o bundle e o existente divergem. */
  conflictingFields: string[];
  /** Problemas deste registo. Nunca descartados. */
  issues: ImportIssue[];
}

/** As contagens que o ecrã de revisão apresenta (§11.2). */
export interface BundlePlanCounts {
  create: number;
  exact: number;
  probable: number;
  quarantined: number;
  skipped: number;
  total: number;
  enriching: number;
  conflicting: number;
  /** Documentos cujo conteúdo não veio no bundle (§5.6). Sempre declarado. */
  documentsMissingContent: number;
}

/** Problemas agregados por gravidade e por código. */
export interface BundleIssueSummary {
  blocking: number;
  recoverable: number;
  info: number;
  byCode: Record<string, number>;
}

/** A forma do plano que acompanha o bundle. */
export interface BundlePlan {
  state: BundlePlanState;
  counts: BundlePlanCounts;
  byKind: Record<string, number>;
  entries: BundlePlanEntry[];
  issues: ImportIssue[];
  issueSummary: BundleIssueSummary;
  /** "2 de 5 veículos" — o âmbito declarado pelo bundle (§5.7). */
  scopeNote?: string;
  /** A política de conflito em vigor (decisão 8). */
  conflictPolicy: string;
  /** Avisos que não se prendem com um registo concreto. */
  notices: string[];
}

/* -------------------------------------------------------------------------- */
/* As respostas                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A resposta do `preview` do bundle (§7.1).
 *
 * ## A forma é plana, e é deliberado
 *
 * `state`, `counts` e `entries` vivem na **raiz** da resposta, e não dentro de um `plan`.
 * É o plano que a interface reenvia no `apply` — e reenviá-lo inteiro é o que garante que
 * o que foi aprovado é o que é escrito (§11.3). Aninhá-lo obrigaria a desembrulhá-lo para o
 * reenviar, e um desembrulho a mais é uma oportunidade a mais de o alterar pelo caminho.
 */
export interface BundlePreviewResponse {
  bundleId: string;
  state: BundlePlanState;
  counts: BundlePlanCounts;
  issueSummary: BundleIssueSummary;
  issues: ImportIssue[];
  entries: BundlePlanEntry[];
  /**
   * O âmbito declarado pelo bundle, já em texto — "Exportação de um só veículo e dos
   * registos ligados a ele."
   *
   * Um bundle filtrado é indistinguível de um bundle incompleto para quem só conta
   * registos, e é por isso que o âmbito é declarado: mostrar "2 de 5 veículos" é a
   * diferença entre uma cópia parcial e uma cópia que falhou a meio.
   */
  scopeNote?: string;
  /**
   * Os ficheiros do bundle, com o número de registos e de bytes.
   *
   * As contagens são medidas sobre os bytes **reais**, e não sobre o que o manifest
   * declara: um `counts` enganador não as consegue inflacionar.
   */
  files: Array<{ path: string; records: number; bytes: number }>;
  summary: {
    vehicles: number | null;
    declaredCounts: Record<string, number> | null;
  };
}

/** Um registo que foi criado. O `id` é o interno, e só serve para ligar ao histórico. */
export interface BundleReportedRecord {
  localId: string;
  kind: string;
  id: string;
}

/** Um registo a que o ficheiro preencheu campos que estavam vazios (decisão 8). */
export interface BundleReportedEnrichment extends BundleReportedRecord {
  /** Os campos preenchidos, por nome canónico. */
  fields: string[];
}

/** Um registo que ficou de fora, e porquê. */
export interface BundleReportedSkip {
  localId: string;
  kind: string;
  reason: string;
}

/**
 * A resposta do `apply`: o relatório (§11.5).
 *
 * Inclui o `csv` já serializado para que o ecrã possa oferecer o download sem um segundo
 * pedido — o relatório é pequeno e a serialização é pura.
 *
 * ## Porque é que `applied` pode ser `false` sem ser um erro
 *
 * Uma reimportação do mesmo bundle não escreve nada (§9.5) e não é uma falha: é a
 * idempotência a funcionar. `summary` continua preenchido nesse caso — o utilizador tem de
 * conseguir ver **por que** não aconteceu nada, e "nada a fazer" é uma resposta.
 */
export interface BundleApplyResponse {
  bundleId: string;
  applied: boolean;
  /** A frase principal, já pronta a apresentar. */
  headline: string;
  summary: Record<string, unknown>;
  created: BundleReportedRecord[];
  enriched: BundleReportedEnrichment[];
  skipped: BundleReportedSkip[];
  /** Quantas transacções foram usadas (§7.2). `1` numa importação pequena. */
  batches: number;
  issues: ImportIssue[];
  csv: string;
}

