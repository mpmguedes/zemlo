/**
 * Lembretes e manutenção preventiva (§16, §21, §22).
 *
 * O estado de cada lembrete é calculado no momento do pedido — nunca guardado (ver a
 * nota em `domain/reminders.ts`). Este serviço trata do ciclo de vida: criar, editar,
 * concluir (com repetição automática) e adiar.
 */

import type {
  Reminder,
  ReminderCompleteRequest,
  ReminderCreateRequest,
  ReminderListQuery,
  ReminderState,
  ReminderUpdateRequest,
} from '@zemlo/shared';
import {
  addDays,
  addMonths,
  daysBetween,
  optionLabel,
  todayIn,
  REMINDER_TRIGGERS,
  type CivilDate,
} from '@zemlo/shared';
import { prisma } from '../core/db.js';
import { conflict, notFound, translatePrismaError, unprocessable } from '../core/errors.js';
import { writeJson } from '../core/json.js';
import { mapReminder, toCivilDate } from '../domain/payload.js';
import { computeNextOccurrence, evaluateReminder, stateRank } from '../domain/reminders.js';
import { getUsageRate } from './vehicles.js';
import { recordEvent, removeEventsFor } from './events.js';
import { civilToDate, civilToDateOrNull, requireRecord } from './shared.js';
import { normalizeSource, requireVehicleAccess } from './vehicles.js';

/* -------------------------------------------------------------------------- */
/* Contexto de avaliação                                                       */
/* -------------------------------------------------------------------------- */

export interface ReminderContext {
  today: CivilDate;
  odometerKm: number | null;
  leadDays: number;
  leadKm: number;
  timeZone: string;
}

/** Reúne o contexto necessário para avaliar lembretes de um utilizador. */
export async function loadReminderContext(
  userId: string,
  vehicle?: { id: string; odometerKm: number | null } | null,
): Promise<ReminderContext> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timeZone: true, preferences: { select: { reminderLeadDays: true, reminderLeadKm: true } } },
  });
  const timeZone = user?.timeZone ?? 'Europe/Lisbon';

  return {
    today: todayIn(timeZone),
    odometerKm: vehicle?.odometerKm ?? null,
    leadDays: user?.preferences?.reminderLeadDays ?? 30,
    leadKm: user?.preferences?.reminderLeadKm ?? 1000,
    timeZone,
  };
}

/* -------------------------------------------------------------------------- */
/* CRUD                                                                        */
/* -------------------------------------------------------------------------- */

export async function createReminder(
  userId: string,
  input: ReminderCreateRequest,
): Promise<Reminder> {
  const vehicle = await requireVehicleAccess(userId, input.vehicleId);
  const context = await loadReminderContext(userId, vehicle);

  /*
   * A condição de um lembrete tem de existir — e a verificação é sobre a **ausência**, não
   * sobre `null`.
   *
   * `dueDate`, `dueOdometerKm`, `intervalMonths` e `intervalKm` são `.nullish()` no contrato
   * (`contracts.ts:592-595`): um campo **omitido** chega aqui como `undefined`, não como `null`.
   * Comparar com `=== null` deixava estas guardas inertes para o cliente real — que omite o
   * campo quando não tem o dado — e criava um lembrete que nunca dispara, mostrado ao
   * utilizador com «Sem dados suficientes para calcular» para sempre. `null` explícito e campo
   * omitido são a mesma intenção do cliente; ambos são recusados (`AUD-014`).
   *
   * Os intervalos são um atalho que se **materializa** num alvo concreto. Por isso a validação
   * vem depois da materialização e olha para o alvo, não para o pedido (`AUD-015`): um intervalo
   * que não chegou a produzir alvo — `intervalKm` num veículo sem quilometragem registada — não
   * é uma condição, e deixá-lo passar criaria exatamente o lembrete morto que `AUD-014` veio
   * eliminar.
   */
  // Os intervalos permitem criar um lembrete sem o utilizador ter de calcular datas.
  const dueDate =
    input.dueDate ??
    (input.intervalMonths !== null && input.intervalMonths !== undefined
      ? addMonths(context.today, input.intervalMonths)
      : null);
  const dueOdometerKm =
    input.dueOdometerKm ??
    (input.intervalKm !== null && input.intervalKm !== undefined && vehicle.odometerKm !== null
      ? vehicle.odometerKm + input.intervalKm
      : null);

  assertCondicao({ trigger: input.trigger, dueDate, dueOdometerKm });

  try {
    const reminder = await prisma.reminder.create({
      data: {
        vehicleId: vehicle.id,
        userId,
        title: input.title,
        trigger: input.trigger,
        dueDate: civilToDateOrNull(dueDate),
        dueOdometerKm,
        intervalMonths: input.intervalMonths ?? null,
        intervalKm: input.intervalKm ?? null,
        repeat: input.repeat ?? false,
        notes: input.notes ?? null,
        topic: topicForTrigger(input.trigger),
        origin: 'manual',
        dedupeKey: input.dedupeKey ?? null,
        source: writeJson(normalizeSource(input.source, 'manual')),
      },
    });

    await recordEvent({
      vehicleId: vehicle.id,
      userId,
      type: 'reminder.created',
      date: context.today,
      title: input.title,
      summary: optionLabel(REMINDER_TRIGGERS, input.trigger),
      amountCents: null,
      odometerKm: null,
      recordType: 'reminder',
      recordId: reminder.id,
      source: normalizeSource(input.source, 'manual'),
    });

    return evaluateOne(reminder, context, vehicle.id);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      throw conflict('Já existe um lembrete igual para este veículo.');
    }
    throw translatePrismaError(error, 'criar lembrete');
  }
}

export async function listReminders(
  userId: string,
  query: ReminderListQuery,
): Promise<{ items: Reminder[]; counts: Record<ReminderState, number> }> {
  const vehicles = await prisma.vehicle.findMany({
    where: { userId, ...(query.vehicleId ? { id: query.vehicleId } : {}) },
    select: { id: true, odometerKm: true },
  });
  if (query.vehicleId && vehicles.length === 0) throw notFound('Não encontrámos esse veículo.');

  const vehicleIds = vehicles.map((vehicle) => vehicle.id);
  const rows = await prisma.reminder.findMany({
    where: {
      userId,
      vehicleId: { in: vehicleIds },
      ...(query.includeCompleted ? {} : { completedAt: null }),
    },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    take: 500,
  });

  const context = await loadReminderContext(userId, vehicles[0] ?? null);
  const usageCache = new Map<string, Awaited<ReturnType<typeof getUsageRate>>>();

  const items: Reminder[] = [];
  for (const row of rows) {
    if (!usageCache.has(row.vehicleId)) {
      usageCache.set(row.vehicleId, await getUsageRate(row.vehicleId));
    }
    const vehicle = vehicles.find((candidate) => candidate.id === row.vehicleId);
    const evaluation = evaluateReminder(
      {
        id: row.id,
        title: row.title,
        trigger: row.trigger as Reminder['trigger'],
        dueDate: toCivilDate(row.dueDate),
        dueOdometerKm: row.dueOdometerKm,
        completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      },
      {
        today: context.today,
        odometerKm: vehicle?.odometerKm ?? null,
        usage: usageCache.get(row.vehicleId) ?? emptyUsage(),
        leadDays: context.leadDays,
        leadKm: context.leadKm,
      },
    );
    items.push(mapReminder(row, evaluation));
  }

  // Estado pedido no filtro, ou lista por urgência.
  const filtered = query.state ? items.filter((item) => item.evaluation.state === query.state) : [...items];
  filtered.sort(compareUrgency);

  const counts: Record<ReminderState, number> = { ok: 0, soon: 0, due: 0, overdue: 0, unknown: 0 };
  for (const item of items) {
    counts[item.evaluation.state] = (counts[item.evaluation.state] ?? 0) + 1;
  }

  return { items: filtered, counts };
}

export async function getReminder(userId: string, reminderId: string): Promise<Reminder> {
  const record = (await requireRecord('reminder', userId, reminderId)) as Parameters<typeof mapReminder>[0] & {
    vehicleId: string;
  };
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: record.vehicleId },
    select: { id: true, odometerKm: true },
  });
  const context = await loadReminderContext(userId, vehicle);
  return evaluateOne(record, context, record.vehicleId);
}

/**
 * Edita um lembrete.
 *
 * A invariante de `AUD-015` é sobre o **estado final**, não sobre o pedido. `zReminderUpdateRequest`
 * é `zReminderCreateRequest.partial()` (`contracts.ts:604`), pelo que todos os campos são
 * opcionais e `null` é aceite: um pedido de uma só linha pode apagar a última condição que
 * restava. Validar os campos recebidos — ou não validar nada, como antes — deixava passar um
 * lembrete que nunca mais dispara.
 *
 * O estado que interessa é o que vai ficar gravado: cada campo vale o que o pedido traz, ou o
 * que já lá estava quando o pedido o omite. A validação é a **mesma função** da criação
 * (`assertCondicao`), aplicada a esse estado em vez do pedido.
 *
 * Nota deliberada: a edição **não** materializa intervalos, ao contrário da criação. Um
 * `PATCH {dueDate: null}` sobre um lembrete por tempo com `intervalMonths` é recusado — o
 * cliente pediu para tirar a data e o serviço não inventa outra; a criação, essa, aceita o
 * intervalo porque a materialização faz parte do que o cliente pediu ao criar.
 */
export async function updateReminder(
  userId: string,
  reminderId: string,
  input: ReminderUpdateRequest,
): Promise<Reminder> {
  const existing = (await requireRecord('reminder', userId, reminderId)) as {
    trigger: string;
    dueDate: Date | null;
    dueOdometerKm: number | null;
  };

  assertCondicao({
    trigger: (input.trigger ?? existing.trigger) as Reminder['trigger'],
    dueDate: input.dueDate !== undefined ? input.dueDate : toCivilDate(existing.dueDate),
    dueOdometerKm: input.dueOdometerKm !== undefined ? input.dueOdometerKm : existing.dueOdometerKm,
  });

  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.trigger !== undefined) data.trigger = input.trigger;
  if (input.dueDate !== undefined) data.dueDate = civilToDateOrNull(input.dueDate);
  if (input.dueOdometerKm !== undefined) data.dueOdometerKm = input.dueOdometerKm;
  if (input.intervalMonths !== undefined) data.intervalMonths = input.intervalMonths;
  if (input.intervalKm !== undefined) data.intervalKm = input.intervalKm;
  if (input.repeat !== undefined) data.repeat = input.repeat;
  if (input.notes !== undefined) data.notes = input.notes;

  try {
    await prisma.reminder.update({ where: { id: reminderId }, data });
  } catch (error) {
    throw translatePrismaError(error, 'atualizar lembrete');
  }
  return getReminder(userId, reminderId);
}

export async function deleteReminder(userId: string, reminderId: string): Promise<void> {
  await requireRecord('reminder', userId, reminderId);
  await prisma.reminder.delete({ where: { id: reminderId } });
  await removeEventsFor('reminder', reminderId);
}

/* -------------------------------------------------------------------------- */
/* Conclusão (§16)                                                             */
/* -------------------------------------------------------------------------- */

export interface CompleteReminderResult {
  completed: Reminder;
  /** Lembrete seguinte, quando a repetição automática está ativa. */
  next: Reminder | null;
}

/**
 * Conclui um lembrete.
 *
 * Quando `repeat` está ativo, cria a ocorrência seguinte. A nova data parte da data de
 * conclusão (e não da data que estava agendada) — se uma revisão anual foi feita oito
 * meses atrasada, a próxima conta a partir do dia em que foi feita (§16).
 */
export async function completeReminder(
  userId: string,
  reminderId: string,
  input: ReminderCompleteRequest,
): Promise<CompleteReminderResult> {
  const existing = (await requireRecord('reminder', userId, reminderId)) as {
    id: string;
    vehicleId: string;
    title: string;
    trigger: string;
    dueDate: Date | null;
    dueOdometerKm: number | null;
    intervalMonths: number | null;
    intervalKm: number | null;
    repeat: boolean;
    notes: string | null;
    completedAt: Date | null;
    previousReminderId: string | null;
  };

  /*
   * Concluir duas vezes o mesmo lembrete é idempotente, não acumulativo.
   *
   * A versão anterior criava uma nova ocorrência em cada conclusão. Um duplo toque, um
   * pedido repetido por uma rede instável, ou um cliente que reenvia a fila offline
   * produziam **duas** revisões futuras iguais com datas diferentes — e a data de conclusão
   * da primeira era sobrescrita pela segunda, perdendo o registo de quando o trabalho foi
   * realmente feito. O utilizador via dois lembretes idênticos e tinha de descobrir qual
   * apagar, num registo cujo valor depende de ser fiável.
   *
   * Devolver a ocorrência que já existe, em vez de recusar com um erro, é a escolha certa
   * para um caso que é sempre um acidente: a resposta é o que o cliente esperava, sem
   * duplicar nada e sem o obrigar a tratar um erro que não tem significado para o utilizador.
   */
  if (existing.completedAt !== null) {
    const alreadyCompleted = await getReminder(userId, reminderId);
    const next = await findNextOccurrence(userId, reminderId);
    return { completed: alreadyCompleted, next };
  }

  const vehicle = await requireVehicleAccess(userId, existing.vehicleId);
  const context = await loadReminderContext(userId, vehicle);
  const completedOn = input.completedAt ?? context.today;

  await prisma.reminder.update({
    where: { id: reminderId },
    data: { completedAt: civilToDate(completedOn) },
  });

  await recordEvent({
    vehicleId: existing.vehicleId,
    userId,
    type: 'reminder.completed',
    date: completedOn,
    title: `Concluído: ${existing.title}`,
    summary: input.notes ?? null,
    amountCents: input.amountCents ?? null,
    odometerKm: input.odometerKm ?? null,
    recordType: 'reminder',
    recordId: reminderId,
    source: null,
  });

  const completed = await getReminder(userId, reminderId);

  if (!existing.repeat || input.createNext === false) {
    return { completed, next: null };
  }

  const next = computeNextOccurrence(
    {
      trigger: existing.trigger as Reminder['trigger'],
      dueDate: existing.dueDate ? (toCivilDate(existing.dueDate) as CivilDate) : null,
      dueOdometerKm: existing.dueOdometerKm,
      intervalMonths: existing.intervalMonths,
      intervalKm: existing.intervalKm,
    },
    { completedOn, odometerKm: input.odometerKm ?? vehicle.odometerKm },
  );

  if (next.dueDate === null && next.dueOdometerKm === null) {
    return { completed, next: null };
  }

  const created = await prisma.reminder.create({
    data: {
      vehicleId: existing.vehicleId,
      userId,
      title: existing.title,
      trigger: existing.trigger,
      dueDate: civilToDateOrNull(next.dueDate),
      dueOdometerKm: next.dueOdometerKm,
      intervalMonths: existing.intervalMonths,
      intervalKm: existing.intervalKm,
      repeat: true,
      notes: existing.notes,
      origin: 'manual',
      previousReminderId: reminderId,
    },
  });

  await recordEvent({
    vehicleId: existing.vehicleId,
    userId,
    type: 'reminder.created',
    date: completedOn,
    title: `Próxima: ${existing.title}`,
    summary: next.dueDate ? `Para ${next.dueDate}` : next.dueOdometerKm ? `Aos ${next.dueOdometerKm} km` : null,
    amountCents: null,
    odometerKm: next.dueOdometerKm,
    recordType: 'reminder',
    recordId: created.id,
    source: null,
  });

  return {
    completed,
    next: await getReminder(userId, created.id),
  };
}

/** Adia um lembrete: mantém-no fora do caminho sem o concluir nem o esconder para sempre. */
export async function snoozeReminder(
  userId: string,
  reminderId: string,
  days: number,
): Promise<Reminder> {
  const existing = (await requireRecord('reminder', userId, reminderId)) as { dueDate: Date | null };
  const context = await loadReminderContext(userId);

  const base = existing.dueDate ? (toCivilDate(existing.dueDate) as CivilDate) : context.today;
  const baseDate = daysBetween(base, context.today) > 0 ? context.today : base;

  await prisma.reminder.update({
    where: { id: reminderId },
    data: {
      dueDate: civilToDate(addDays(baseDate, days)),
      snoozedUntil: civilToDate(addDays(context.today, days)),
    },
  });

  return getReminder(userId, reminderId);
}

/**
 * A ocorrência seguinte de um lembrete, se já tiver sido criada por uma conclusão anterior.
 *
 * Procurado pelo `previousReminderId`, que é a ligação gravada no momento em que a
 * ocorrência seguinte nasce. É o que permite concluir duas vezes sem duplicar.
 */
async function findNextOccurrence(userId: string, reminderId: string): Promise<Reminder | null> {
  const next = await prisma.reminder.findFirst({
    where: { userId, previousReminderId: reminderId },
    orderBy: { createdAt: 'desc' },
  });
  return next ? getReminder(userId, next.id) : null;
}

/* -------------------------------------------------------------------------- */
/* Consumo pelo dashboard e calendário                                         */
/* -------------------------------------------------------------------------- */

/**
 * Lembretes acionáveis de um conjunto de veículos, ordenados por urgência e limitados.
 *
 * Usado pelo dashboard (§8) e pelo calendário (§21). Quando um lembrete só tem
 * condição de quilometragem, a data é **projetada** a partir do ritmo de utilização
 * (§11) — caso contrário, uma revisão a 50 000 km nunca apareceria no calendário.
 */
export async function actionableReminders(
  userId: string,
  vehicles: Array<{ id: string; odometerKm: number | null; plateDisplay: string }>,
  options: { limit?: number; from?: CivilDate; to?: CivilDate; timeZone: string },
): Promise<Array<{ reminder: Reminder; vehicleId: string; plateDisplay: string }>> {
  if (vehicles.length === 0) return [];

  const today = todayIn(options.timeZone);
  const context = await loadReminderContext(userId, null);

  const rows = await prisma.reminder.findMany({
    where: {
      userId,
      vehicleId: { in: vehicles.map((vehicle) => vehicle.id) },
      completedAt: null,
      dismissedAt: null,
    },
    orderBy: [{ dueDate: 'asc' }],
    take: 300,
  });

  const usageCache = new Map<string, Awaited<ReturnType<typeof getUsageRate>>>();
  const output: Array<{ reminder: Reminder; vehicleId: string; plateDisplay: string }> = [];

  for (const row of rows) {
    const vehicle = vehicles.find((candidate) => candidate.id === row.vehicleId);
    if (!vehicle) continue;
    if (!usageCache.has(row.vehicleId)) usageCache.set(row.vehicleId, await getUsageRate(row.vehicleId));

    const evaluation = evaluateReminder(
      {
        id: row.id,
        title: row.title,
        trigger: row.trigger as Reminder['trigger'],
        dueDate: toCivilDate(row.dueDate),
        dueOdometerKm: row.dueOdometerKm,
        completedAt: null,
      },
      {
        today,
        odometerKm: vehicle.odometerKm,
        usage: usageCache.get(row.vehicleId) ?? emptyUsage(),
        leadDays: context.leadDays,
        leadKm: context.leadKm,
      },
    );

    // Filtro por intervalo de datas, aplicado sobre a data real ou projetada.
    const effectiveDate = evaluation.projectedDate ?? toCivilDate(row.dueDate);
    if (options.from && effectiveDate && effectiveDate < options.from) continue;
    if (options.to && effectiveDate && effectiveDate > options.to) continue;
    if ((options.from || options.to) && effectiveDate === null) continue;

    output.push({
      reminder: mapReminder(row, evaluation),
      vehicleId: row.vehicleId,
      plateDisplay: vehicle.plateDisplay,
    });
  }

  output.sort((a, b) => compareUrgency(a.reminder, b.reminder));
  return options.limit ? output.slice(0, options.limit) : output;
}

/* -------------------------------------------------------------------------- */
/* Auxiliares                                                                  */
/* -------------------------------------------------------------------------- */

async function evaluateOne(
  row: Parameters<typeof mapReminder>[0] & { vehicleId: string },
  context: ReminderContext,
  vehicleId: string,
): Promise<Reminder> {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: { odometerKm: true },
  });
  const usage = await getUsageRate(vehicleId);
  const evaluation = evaluateReminder(
    {
      id: row.id,
      title: row.title,
      trigger: row.trigger as Reminder['trigger'],
      dueDate: toCivilDate(row.dueDate),
      dueOdometerKm: row.dueOdometerKm,
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    },
    {
      today: context.today,
      odometerKm: vehicle?.odometerKm ?? context.odometerKm,
      usage,
      leadDays: context.leadDays,
      leadKm: context.leadKm,
    },
  );
  return mapReminder(row, evaluation);
}

/** Ordenação por urgência; empate resolvido pela data efetiva (real ou projetada). */
function compareUrgency(a: Reminder, b: Reminder): number {
  const rankDiff = stateRank(a.evaluation.state) - stateRank(b.evaluation.state);
  if (rankDiff !== 0) return rankDiff;
  const aDate = a.evaluation.projectedDate ?? a.dueDate ?? '9999-12-31';
  const bDate = b.evaluation.projectedDate ?? b.dueDate ?? '9999-12-31';
  if (aDate !== bDate) return aDate < bDate ? -1 : 1;
  const aKm = a.evaluation.kmRemaining ?? Number.MAX_SAFE_INTEGER;
  const bKm = b.evaluation.kmRemaining ?? Number.MAX_SAFE_INTEGER;
  return aKm - bKm;
}

/** O que decide se um lembrete tem condição: o alvo que fica gravado, não o campo do pedido. */
interface EstadoCondicao {
  trigger: Reminder['trigger'];
  dueDate: CivilDate | null;
  dueOdometerKm: number | null;
}

/**
 * A invariante da condição de um lembrete — **uma só** função, usada pela criação e pela edição
 * (`AUD-014`, `AUD-015`).
 *
 * Vale sobre o **estado final**: o que o lembrete vai ter gravado, depois de materializados os
 * intervalos. O que faz um lembrete disparar é `dueDate`/`dueOdometerKm` — é só isso que
 * `evaluateReminder` consome (`domain/reminders.ts:87-114`) — e é por isso que é o alvo, e não o
 * campo do pedido, que decide se a condição existe.
 *
 * As duas causas de falha têm a mesma forma mas não a mesma instrução: não ter dado nada é
 * diferente de ter dado um intervalo que não chegou a produzir alvo. A mensagem nomeia as duas
 * rotas para o utilizador não ter de adivinhar qual delas lhe falta.
 */
function assertCondicao(estado: EstadoCondicao): void {
  if (estado.trigger !== 'time' && ausente(estado.dueOdometerKm)) {
    throw unprocessable(
      'Um lembrete por quilometragem precisa de uma quilometragem alvo. Indica-a, ou um intervalo a partir da quilometragem atual — que exige uma quilometragem já registada no veículo.',
    );
  }
  if (estado.trigger !== 'distance' && ausente(estado.dueDate)) {
    throw unprocessable('Um lembrete por tempo precisa de uma data. Indica-a, ou um intervalo em meses.');
  }
}

/**
 * Ausente: `null` explícito **ou** campo omitido.
 *
 * As duas formas de dizer «não tenho este dado» chegam ao serviço de maneira diferente — `null`
 * quando o cliente o escreve, `undefined` quando omite o campo — e tratá-las de forma diferente
 * foi exatamente o defeito de `AUD-014`.
 */
function ausente(value: number | string | null | undefined): boolean {
  return value === null || value === undefined;
}

function topicForTrigger(trigger: string): string {
  if (trigger === 'distance') return 'maintenance';
  return 'maintenance';
}

function emptyUsage(): Awaited<ReturnType<typeof getUsageRate>> {
  return { kmPerDay: null, kmPerMonth: null, kmPerYear: null, samplesUsed: 0, confident: false };
}
