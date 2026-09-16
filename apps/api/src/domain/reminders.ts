/**
 * Manutenção preventiva e lembretes (§16, §21, §22).
 *
 * Regras suportadas pela especificação: por quilometragem, por tempo, ou por ambos —
 * e, nesse caso, o evento ocorre quando **qualquer** condição for atingida.
 *
 * Duas decisões que valem a pena explicar:
 *
 * 1. O estado de um lembrete **nunca é guardado**. É calculado a cada pedido a partir
 *    da data de hoje e da quilometragem atual. Guardá-lo obrigaria a um trabalho
 *    periódico de atualização e garantiria que, a dado momento, existiriam lembretes
 *    com estados desatualizados na base de dados.
 *
 * 2. Quando só existe condição de quilometragem, o Zemlo projeta a data usando o ritmo
 *    de utilização observado (§11). Sem essa projeção, um lembrete de revisão a 50 000
 *    km seria invisível no calendário (§21) durante anos — e o calendário é uma das
 *    razões de ser do produto.
 */

import {
  addMonths,
  daysBetween,
  describeDays,
  describeKm,
  formatKm,
  type CivilDate,
  type ReminderState,
  type ReminderTrigger,
} from '@zemlo/shared';
import type { ReminderEvaluation } from '@zemlo/shared';
import { projectDateForOdometer, type UsageRate } from './odometer.js';

export interface ReminderInput {
  id: string;
  title: string;
  trigger: ReminderTrigger;
  dueDate: CivilDate | null;
  dueOdometerKm: number | null;
  completedAt: string | null;
  dismissedAt?: string | null;
  snoozedUntil?: string | null;
}

export interface ReminderContext {
  today: CivilDate;
  odometerKm: number | null;
  usage: UsageRate;
  /** Antecedência, em dias, a partir da qual o lembrete é "em breve". */
  leadDays: number;
  /** Antecedência, em quilómetros, a partir da qual o lembrete é "em breve". */
  leadKm: number;
}

/**
 * Ordem de urgência, do mais para o menos urgente.
 *
 * Os estados vivem numa lista ordenada (e não num objeto indexado) porque o
 * `Map` devolve `number` e não `number | undefined`: com `noUncheckedIndexedAccess`
 * ativo, um objeto obrigaria a tratar um caso impossível em cada comparação.
 */
const STATE_PRIORITY: readonly ReminderState[] = ['overdue', 'due', 'soon', 'unknown', 'ok'];

/** Índice de urgência: menor é mais urgente. Usado para ordenar cartões e listas. */
export function stateRank(state: ReminderState): number {
  return STATE_PRIORITY.indexOf(state);
}

/**
 * Avalia um lembrete.
 *
 * Devolve sempre um objeto — nunca lança. Um lembrete sem data nem quilometragem é
 * válido em termos de produto (o utilizador ainda não sabe quando) e recebe o estado
 * `unknown`, que a interface traduz para "Sem dados suficientes" em vez de o esconder.
 */
export function evaluateReminder(reminder: ReminderInput, context: ReminderContext): ReminderEvaluation {
  if (reminder.completedAt) {
    return {
      state: 'ok',
      daysRemaining: null,
      kmRemaining: null,
      drivingCondition: null,
      projectedDate: null,
      summary: 'Concluído',
    };
  }

  const daysRemaining = reminder.dueDate !== null ? daysBetween(context.today, reminder.dueDate) : null;
  const kmRemaining =
    reminder.dueOdometerKm !== null && context.odometerKm !== null
      ? reminder.dueOdometerKm - context.odometerKm
      : null;

  const usesTime = reminder.trigger === 'time' || reminder.trigger === 'both';
  const usesDistance = reminder.trigger === 'distance' || reminder.trigger === 'both';

  const timeState: ReminderState | null = usesTime && daysRemaining !== null
    ? daysRemaining < 0
      ? 'overdue'
      : daysRemaining === 0
        ? 'due'
        : daysRemaining <= context.leadDays
          ? 'soon'
          : 'ok'
    : null;

  const distanceState: ReminderState | null = usesDistance && kmRemaining !== null
    ? kmRemaining < 0
      ? 'overdue'
      : kmRemaining === 0
        ? 'due'
        : kmRemaining <= context.leadKm
          ? 'soon'
          : 'ok'
    : null;

  // A condição que dispara primeiro determina o estado (§16).
  const candidates = [timeState, distanceState].filter((state): state is ReminderState => state !== null);

  let state: ReminderState;
  let drivingCondition: ReminderEvaluation['drivingCondition'] = null;

  if (candidates.length === 0) {
    // Nenhuma condição utilizável: por exemplo, um lembrete por distância cujo
    // veículo ainda não tem quilometragem registada. O estado `unknown` faz a
    // interface pedir o dado em falta em vez de esconder o lembrete (§6).
    state = 'unknown';
  } else {
    state = candidates.reduce((worst, current) =>
      stateRank(current) < stateRank(worst) ? current : worst,
    );
    if (usesTime && usesDistance && timeState !== null && distanceState !== null) {
      drivingCondition = stateRank(distanceState) < stateRank(timeState)
        ? 'distance'
        : stateRank(timeState) < stateRank(distanceState)
          ? 'time'
          : 'both';
    } else if (usesDistance && distanceState !== null) {
      drivingCondition = 'distance';
    } else if (usesTime && timeState !== null) {
      drivingCondition = 'time';
    }
  }

  // Projeção de data quando só há condição de distância (ou quando falta a data).
  let projectedDate: CivilDate | null = null;
  if (reminder.dueDate === null && reminder.dueOdometerKm !== null) {
    projectedDate = projectDateForOdometer(
      reminder.dueOdometerKm,
      context.odometerKm,
      context.usage,
      context.today,
    );
  }

  return {
    state,
    daysRemaining,
    kmRemaining,
    drivingCondition,
    projectedDate,
    summary: buildSummary(state, daysRemaining, kmRemaining, usesTime, usesDistance),
  };
}

/**
 * Resumo em português, no tom da marca (§59): informativo, nunca alarmista.
 * A interface mostra este texto diretamente nos cartões de estado do dashboard.
 */
function buildSummary(
  state: ReminderState,
  daysRemaining: number | null,
  kmRemaining: number | null,
  usesTime: boolean,
  usesDistance: boolean,
): string {
  const parts: string[] = [];

  if (usesDistance && kmRemaining !== null) {
    parts.push(describeKm(kmRemaining));
  }
  if (usesTime && daysRemaining !== null) {
    parts.push(describeDays(daysRemaining));
  }

  if (parts.length === 0) {
    return 'Sem dados suficientes para calcular';
  }

  const detail = parts.join(' · ');

  // O estado prefixa o resumo apenas quando há algo a fazer. Um lembrete em dia fala
  // só do futuro ("em 1 200 km"), sem acrescentar ruído (§3.5).
  if (state === 'overdue') return `Em atraso — ${detail}`;
  if (state === 'due') return `É agora — ${detail}`;
  return detail;
}

/* -------------------------------------------------------------------------- */
/* Conclusão e repetição                                                       */
/* -------------------------------------------------------------------------- */

export interface NextOccurrence {
  dueDate: CivilDate | null;
  dueOdometerKm: number | null;
}

/**
 * Calcula a próxima ocorrência de um lembrete repetível.
 *
 * Por que não avançar a partir da data de hoje quando está muito atrasado: se uma
 * revisão anual foi feita 8 meses depois do previsto, a próxima deve contar a partir
 * da data em que **foi feita**, não da data em que devia ter sido. Caso contrário o
 * Zemlo marcaria a revisão seguinte como atrasada no dia em que nasce.
 *
 * O cálculo por quilometragem parte da quilometragem efetiva no momento da conclusão,
 * porque é esse o valor que o plano de manutenção do fabricante pressupõe.
 */
export function computeNextOccurrence(
  reminder: Pick<ReminderInput, 'trigger' | 'dueDate' | 'dueOdometerKm'> & {
    intervalMonths: number | null;
    intervalKm: number | null;
  },
  completion: { completedOn: CivilDate; odometerKm: number | null },
): NextOccurrence {
  const usesTime = reminder.trigger === 'time' || reminder.trigger === 'both';

  let dueDate: CivilDate | null = null;
  if (reminder.intervalMonths !== null) {
    dueDate = addMonths(completion.completedOn, reminder.intervalMonths);
  } else if (usesTime && reminder.dueDate !== null) {
    // Sem intervalo definido, mantém o mesmo dia do ano seguinte.
    dueDate = addMonths(reminder.dueDate, 12);
  }

  let dueOdometerKm: number | null = null;
  const baseKm = completion.odometerKm ?? null;
  if (reminder.intervalKm !== null && baseKm !== null) {
    dueOdometerKm = baseKm + reminder.intervalKm;
  }

  return { dueDate, dueOdometerKm };
}

/* -------------------------------------------------------------------------- */
/* Apresentação                                                                */
/* -------------------------------------------------------------------------- */

/** Título legível para um cartão do dashboard, truncado ao essencial. */
export function reminderHeadlineValue(evaluation: ReminderEvaluation): string {
  if (evaluation.kmRemaining !== null && (evaluation.drivingCondition === 'distance' || evaluation.daysRemaining === null)) {
    return `${formatKm(Math.abs(evaluation.kmRemaining))} km`;
  }
  if (evaluation.daysRemaining !== null) {
    const days = Math.abs(evaluation.daysRemaining);
    return `${days} ${days === 1 ? 'dia' : 'dias'}`;
  }
  return '—';
}

/** `true` quando o lembrete deve aparecer na lista de "próximas tarefas". */
export function isActionable(evaluation: ReminderEvaluation): boolean {
  return evaluation.state === 'overdue' || evaluation.state === 'due' || evaluation.state === 'soon';
}
