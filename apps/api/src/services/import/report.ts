/**
 * O relatório final de uma importação (§9.3, §11.2, §11.3).
 *
 * ## O que este ficheiro é, e o que não é
 *
 * É a **composição** de duas coisas que já existem: o resumo do plano (construído no
 * domínio por `summarizePlan`) e o relatório de aplicação (construído pelo `apply.ts` a
 * partir do que efectivamente escreveu). Não recalcula contagens, não reclassifica
 * registos e não vai à base de dados.
 *
 * Recalcular aqui seria a terceira expressão da mesma regra: o plano já conta, o `apply` já
 * conta o que criou, e uma terceira contagem só poderia divergir das outras duas. A
 * primeira divergência seria visível ao utilizador — "Criar 298" no ecrã de revisão e 297
 * no relatório —, e não haveria forma de saber qual das duas estava certa.
 *
 * ## Porque é que existe como ficheiro próprio
 *
 * A §11.3 diz que **o relatório é um artefacto**: descarregável, guardado no histórico, com
 * contagens e lista de problemas. Um artefacto tem de ser construído a partir de dados
 * completos e serializável — o que a camada HTTP não deve fazer por si, sob pena de ter de
 * conhecer o formato interno do plano.
 *
 * ## As duas leituras do mesmo resultado
 *
 * O relatório tem uma parte **estruturada** (para o histórico e para a interface) e uma
 * parte **textual** (para o utilizador ler no ecrã). As duas são construídas do mesmo
 * objecto, para que o texto não possa dizer uma coisa e os números outra. É a §11.3 outra
 * vez: zero conceitos técnicos no que o utilizador lê — não aparece "ID", "chave",
 * "transacção", "referência" nem "localId".
 */

import type { ImportIssue } from '@zemlo/shared';

import type { ImportPlan, PlanSummary } from '../../domain/import/plan.js';
import { summarizePlan } from '../../domain/import/plan.js';

import type { ApplyReport } from './apply.js';

/* -------------------------------------------------------------------------- */
/* O relatório                                                                 */
/* -------------------------------------------------------------------------- */

/** Um registo que a importação criou, na forma que o relatório mostra. */
export interface ReportedRecord {
  readonly localId: string;
  readonly kind: string;
  readonly id: string;
}

/** Um registo cujos campos em branco foram preenchidos (decisão 8). */
export interface ReportedEnrichment {
  readonly localId: string;
  readonly kind: string;
  readonly id: string;
  readonly fields: readonly string[];
}

/** Um registo que ficou de fora, e porquê. */
export interface ReportedSkip {
  readonly localId: string;
  readonly kind: string;
  readonly reason: string;
}

/**
 * O relatório de uma importação concluída.
 *
 * `applied` é `false` quando nada foi escrito — uma reimportação do mesmo bundle (§9.5) ou
 * um plano que não tinha nada a fazer. Nesse caso `state` é `nothing-to-do` e as listas
 * estão vazias, mas `summary` continua preenchido: o utilizador tem de conseguir ver *por
 * que* não aconteceu nada, e "nada a fazer" é uma resposta, não uma ausência de resposta.
 */
export interface ImportReport {
  /** O plano que foi aplicado, tal como o utilizador o aprovou. */
  readonly bundleId: string | null;
  /** `true` quando houve escrita. `false` num plano vazio ou já importado. */
  readonly applied: boolean;
  /** O resumo do plano — o que ia acontecer. */
  readonly summary: PlanSummary;
  readonly created: readonly ReportedRecord[];
  readonly enriched: readonly ReportedEnrichment[];
  readonly skipped: readonly ReportedSkip[];
  /** Quantas transacções foram usadas (§7.2). `1` numa importação pequena. */
  readonly batches: number;
  /** Problemas e avisos, agrupados por gravidade. */
  readonly issues: readonly ImportIssue[];
  /** A frase que o utilizador lê primeiro. */
  readonly headline: string;
}

/* -------------------------------------------------------------------------- */
/* Construção                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Constrói o relatório a partir do plano e do resultado da aplicação.
 *
 * Função **pura**: não lê a base de dados, não depende da hora. O que entra é o que saiu da
 * aplicação; tudo o que o relatório afirma vem daí.
 */
export function buildImportReport(options: {
  plan: ImportPlan;
  applied: ApplyReport;
  bundleId?: string | null;
  issues?: readonly ImportIssue[];
}): ImportReport {
  const { plan, applied } = options;

  const created: ReportedRecord[] = applied.created.map((record) => ({
    localId: record.localId,
    kind: record.kind,
    id: record.id,
  }));

  const enriched: ReportedEnrichment[] = applied.enriched.map((record) => ({
    localId: record.localId,
    kind: record.kind,
    id: record.id,
    fields: record.fields,
  }));

  /*
   * Os ignorados juntam as duas origens possíveis, e mantêm-nas distinguíveis pelo texto:
   * o que o `apply` registou ao percorrer o plano (reimportação, decisão de excluir) e o
   * que o plano já sabia que não entraria (quarentena). Sem esta junção, um registo em
   * quarentena não apareceria no relatório — e a §9.2 exige que ele apareça, nomeado.
   */
  const skipped: ReportedSkip[] = [
    ...applied.skipped.map((record) => ({
      localId: record.localId,
      kind: kindOf(plan, record.localId),
      reason: record.reason,
    })),
    ...plan.entries
      .filter((entry) => entry.action === 'quarantined')
      .map((entry) => ({
        localId: entry.localId,
        kind: entry.kind,
        reason: entry.reason ?? 'Não pode ser importado sem correção.',
      })),
  ];

  const summary = summarizePlan(plan);
  const issues = options.issues ?? plan.issues;

  return {
    bundleId: options.bundleId ?? null,
    applied: created.length > 0 || enriched.length > 0,
    summary,
    created,
    enriched,
    skipped,
    batches: applied.batches,
    issues,
    headline: headlineFor(created.length, enriched.length, skipped.length, summary),
  };
}

/**
 * A frase de abertura do relatório.
 *
 * É construída a partir dos números, e não escrita como texto fixo, para que nunca possa
 * contradizer as contagens que aparecem logo abaixo. Uma frase fixa ("Importei 198
 * registos") num relatório cujas listas foram filtradas seria o tipo de incoerência que
 * faz o utilizador desconfiar do resto — com razão.
 *
 * ## Porque é que não usa "registos" como unidade única
 *
 * Criar e preencher são coisas diferentes para quem lê: uma acrescenta dados, a outra
 * completa-os. Somá-las num número só ("198 registos") esconde a diferença — e é
 * precisamente essa diferença que o utilizador precisa de ver para confiar no que ficou
 * na conta (decisão 8: nada foi sobrescrito).
 */
function headlineFor(
  created: number,
  enriched: number,
  skipped: number,
  summary: PlanSummary,
): string {
  if (created === 0 && enriched === 0) {
    if (summary.skipped > 0) {
      return 'Este ficheiro já tinha sido importado. Não foi criado nada.';
    }
    if (skipped > 0) {
      return 'Não foi criado nada: os registos deste ficheiro precisam de correção.';
    }
    return 'Não havia nada para importar.';
  }

  const parts: string[] = [];
  parts.push(
    created === 1 ? 'Importei 1 registo' : `Importei ${created} registos`,
  );
  if (enriched > 0) {
    parts.push(
      enriched === 1
        ? 'e preenchi campos em branco em 1 registo que já existia'
        : `e preenchi campos em branco em ${enriched} registos que já existiam`,
    );
  }

  let sentence = `${parts.join(' ')}.`;

  if (skipped > 0) {
    sentence +=
      skipped === 1
        ? ' 1 registo ficou de fora — está explicado abaixo.'
        : ` ${skipped} registos ficaram de fora — estão explicados abaixo.`;
  }

  return sentence;
}

/** O tipo de um registo, procurado no plano. `'desconhecido'` não deveria acontecer. */
function kindOf(plan: ImportPlan, localId: string): string {
  return plan.entries.find((entry) => entry.localId === localId)?.kind ?? 'desconhecido';
}

/* -------------------------------------------------------------------------- */
/* Exportação para CSV (§11.3)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * O relatório em CSV, para descarregar e partilhar.
 *
 * ## Porque é que o CSV é feito aqui e não na camada HTTP
 *
 * O §11.3 exige que o relatório seja "descarregável". O formato de descarga é uma
 * propriedade do relatório, não do protocolo — se a camada HTTP o escrevesse, o mesmo
 * relatório descarregado por dois clientes poderia sair com colunas diferentes. Aqui há uma
 * implementação, e o formato é o mesmo em qualquer lado.
 *
 * ## As três secções num só ficheiro
 *
 * Uma folha de cálculo vazia com três tabelas separadas é mais difícil de ler do que um
 * ficheiro com uma secção declarada por linha. A coluna `secção` diz a que parte pertence
 * cada linha, e a ordenação mantém as secções agrupadas.
 *
 * As vírgulas e as aspas são escapadas segundo o RFC 4180 — sem isso, uma morada com uma
 * vírgula parte a linha em duas, e o ficheiro passa a ter mais colunas do que cabeçalhos.
 */
export function reportToCsv(report: ImportReport): string {
  const rows: string[][] = [];

  rows.push(['secção', 'localId', 'tipo', 'id', 'campos', 'motivo']);
  for (const record of report.created) {
    rows.push(['criado', record.localId, record.kind, record.id, '', '']);
  }
  for (const record of report.enriched) {
    rows.push(['preenchido', record.localId, record.kind, record.id, record.fields.join(' '), '']);
  }
  for (const record of report.skipped) {
    rows.push(['ignorado', record.localId, record.kind, '', '', record.reason]);
  }
  for (const issue of report.issues) {
    rows.push([
      'problema',
      issue.localId ?? '',
      '',
      '',
      issue.field ?? '',
      `${issue.severity}: ${issue.message}`,
    ]);
  }

  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/**
 * Escapa uma célula.
 *
 * Entre aspas sempre que contenha vírgula, aspas, quebra de linha ou espaço nas pontas;
 * as aspas internas duplicam-se — é o que o RFC 4180 prescreve e o que o Excel e o
 * LibreOffice esperam.
 */
function csvCell(value: string): string {
  const text = String(value);
  if (!/[",\r\n]/.test(text) && text === text.trim()) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/* -------------------------------------------------------------------------- */
/* Reexportações                                                               */
/* -------------------------------------------------------------------------- */

export type { PlanSummary } from '../../domain/import/plan.js';
