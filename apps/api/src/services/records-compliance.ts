/**
 * Manutenção (§15, §16), seguro (§18), inspeção (§19) e impostos (§20).
 *
 * Estes quatro tipos estão juntos porque partilham a mesma função de produto: cada um
 * deles cria ou atualiza um **lembrete** (§16, §21, §22). Registar uma revisão não é
 * só arquivar o passado — é sobretudo definir quando acontece a próxima. É essa a
 * diferença entre uma aplicação de registo e o Zemlo (§63).
 */

import type {
  InsuranceCreateRequest,
  InsurancePolicy as InsuranceView,
  InsuranceUpdateRequest,
  InspectionCreateRequest,
  InspectionRecord as InspectionView,
  InspectionUpdateRequest,
  ListQuery,
  MaintenanceCreateRequest,
  MaintenanceRecord as MaintenanceView,
  MaintenanceUpdateRequest,
  Page,
  TaxCreateRequest,
  TaxRecord as TaxView,
  TaxUpdateRequest,
} from '@zemlo/shared';
import {
  optionLabel,
  MAINTENANCE_TYPES,
  addMonths,
  addYears,
  todayIn,
  type CivilDate,
} from '@zemlo/shared';
import { prisma } from '../core/db.js';
import { notFound } from '../core/errors.js';
import { writeJson } from '../core/json.js';
import {
  mapInsurance,
  mapInspection,
  mapMaintenance,
  mapTax,
  toCivilDate,
} from '../domain/payload.js';
import { evaluateOdometerReading } from '../domain/odometer.js';
import { recordEvent, removeEventsFor } from './events.js';
import {
  assertNotFarFuture,
  buildPage,
  civilToDate,
  civilToDateOrNull,
  cursorWhere,
  requireRecord,
} from './shared.js';
import { normalizeSource, requireVehicleAccess, resolveVehicleId } from './vehicles.js';

async function userTimeZone(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } });
  return user?.timeZone ?? 'Europe/Lisbon';
}

/** Extrai o `vehicleId` opcional de qualquer um dos pedidos de registo. */
function vehicleIdOf(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const value = (input as { vehicleId?: unknown }).vehicleId;
  return typeof value === 'string' ? value : undefined;
}

/**
 * Garante que o documento referenciado pertence ao utilizador.
 *
 * Porque é necessário: as relações `documentId` de seguro, inspeção e imposto são
 * `String?` no schema — deliberadamente, para que apagar um documento não apague um
 * registo de seguro, que é um dado com valor próprio. A contrapartida é que a base de
 * dados **não** impõe a integridade: sem esta verificação, uma conta podia associar o
 * documento de outra conta aos seus próprios registos, obtendo uma referência a dados
 * que não são seus.
 *
 * Devolve `null` quando não há documento indicado. Lança 404 (e não 403) quando o
 * documento existe mas é de outra conta: distinguir os casos revelaria a existência de
 * documentos de outros utilizadores (§30).
 */
async function requireOwnedDocument(
  userId: string,
  documentId: string | null | undefined,
): Promise<string | null> {
  if (documentId === null || documentId === undefined) return null;

  const document = await prisma.document.findFirst({
    where: { id: documentId, userId },
    select: { id: true, vehicleId: true },
  });
  if (!document) {
    throw notFound('Não encontrámos esse documento.');
  }
  return document.id;
}

/* ========================================================================== */
/* MANUTENÇÃO (§15)                                                           */
/* ========================================================================== */

export async function createMaintenance(
  userId: string,
  input: MaintenanceCreateRequest,
): Promise<MaintenanceView> {
  /*
   * `vehicleId` é opcional no contrato, tal como em todos os outros tipos de registo: sem
   * ele, o registo vai para o veículo mais recentemente atualizado do utilizador — a mesma
   * regra que permite ao utilizador com um só veículo nunca ver o campo "veículo" (§44).
   *
   * A versão anterior lançava um `Error` simples quando o campo faltava, que o middleware
   * de erros traduzia em **500**. Além de estar errado (é entrada do cliente, não um
   * defeito do servidor), contradizia a decisão A10 e tornava o fluxo de registo de
   * manutenção impossível de usar por qualquer cliente que confiasse no contrato —
   * incluindo o formulário da app web, para uma conta com um só veículo.
   */
  const vehicleId = await resolveVehicleFromBody(userId, input);

  const timeZone = await userTimeZone(userId);
  const today = todayIn(timeZone);
  const date = input.date ?? today;
  assertNotFarFuture(date, today);

  // A próxima data pode ser indicada diretamente ou derivada de um intervalo (§16).
  const nextDueDate =
    input.nextDueDate ??
    (input.intervalMonths ? addMonths(date, input.intervalMonths) : null);
  const nextDueOdometerKm =
    input.nextDueOdometerKm ??
    (input.intervalKm && input.odometerKm ? input.odometerKm + input.intervalKm : null);

  const record = await prisma.maintenanceRecord.create({
    data: {
      vehicleId,
      userId,
      date: civilToDate(date),
      type: input.type,
      odometerKm: input.odometerKm ?? null,
      amountCents: input.amountCents ?? null,
      partsCents: input.partsCents ?? null,
      labourCents: input.labourCents ?? null,
      workshop: input.workshop ?? null,
      description: input.description ?? null,
      warrantyMonths: input.warrantyMonths ?? null,
      notes: input.notes ?? null,
      nextDueDate: civilToDateOrNull(nextDueDate),
      nextDueOdometerKm,
      source: writeJson(normalizeSource(input.source, 'manual')),
    },
  });

  const label = optionLabel(MAINTENANCE_TYPES, input.type);

  await recordEvent({
    vehicleId,
    userId,
    type: 'maintenance.created',
    date,
    title: label,
    summary: input.description ?? input.workshop ?? null,
    amountCents: input.amountCents ?? null,
    odometerKm: input.odometerKm ?? null,
    recordType: 'maintenance',
    recordId: record.id,
    source: normalizeSource(input.source, 'manual'),
  });

  // Criar o lembrete da próxima intervenção é a parte que dá valor ao registo (§16).
  if (nextDueDate !== null || nextDueOdometerKm !== null) {
    const reminder = await prisma.reminder.create({
      data: {
        vehicleId,
        userId,
        title: `Próxima ${label.toLowerCase()}`,
        trigger: nextDueDate !== null && nextDueOdometerKm !== null ? 'both' : nextDueDate !== null ? 'time' : 'distance',
        dueDate: civilToDateOrNull(nextDueDate),
        dueOdometerKm: nextDueOdometerKm,
        intervalMonths: input.intervalMonths ?? null,
        intervalKm: input.intervalKm ?? null,
        repeat: input.intervalMonths !== null && input.intervalMonths !== undefined
          || (input.intervalKm !== null && input.intervalKm !== undefined),
        topic: 'maintenance',
        origin: 'maintenance',
        originRecordId: record.id,
        dedupeKey: `maintenance:${record.id}`,
        notes: null,
      },
    });

    await prisma.maintenanceRecord.update({
      where: { id: record.id },
      data: { reminderId: reminder.id },
    });

    await recordEvent({
      vehicleId,
      userId,
      type: 'reminder.created',
      date: today,
      title: 'Próxima manutenção definida',
      summary: reminder.title,
      amountCents: null,
      odometerKm: null,
      recordType: 'reminder',
      recordId: reminder.id,
      source: null,
    });
  }

  return getMaintenance(userId, record.id);
}

export async function listMaintenance(
  userId: string,
  query: ListQuery,
): Promise<Page<MaintenanceView>> {
  const where: Record<string, unknown> = { userId, ...cursorWhere(query.cursor) };
  if (query.vehicleId) where.vehicleId = query.vehicleId;
  if (query.from || query.to) {
    where.date = {
      ...(query.from ? { gte: civilToDate(query.from) } : {}),
      ...(query.to ? { lte: civilToDate(query.to) } : {}),
    };
  }

  const [rows, total] = await Promise.all([
    prisma.maintenanceRecord.findMany({
      where,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    }),
    // O mesmo `where` da consulta: uma contagem que ignora os filtros mostra
    // "Combustível · 59" ao lado de uma lista com três itens.
    prisma.maintenanceRecord.count({ where }),
  ]);

  return buildPage(rows.map(mapMaintenance), query.limit, total);
}

export async function getMaintenance(userId: string, recordId: string): Promise<MaintenanceView> {
  const record = await requireRecord('maintenanceRecord', userId, recordId);
  return mapMaintenance(record as Parameters<typeof mapMaintenance>[0]);
}

export async function updateMaintenance(
  userId: string,
  recordId: string,
  input: MaintenanceUpdateRequest,
): Promise<MaintenanceView> {
  const existing = (await requireRecord('maintenanceRecord', userId, recordId)) as {
    reminderId: string | null;
    date: Date;
    type: string;
  };
  await requireVehicleAccess(userId, (await requireRecord('maintenanceRecord', userId, recordId)).vehicleId as string);

  const data: Record<string, unknown> = {};
  if (input.date !== undefined) data.date = civilToDate(input.date);
  if (input.type !== undefined) data.type = input.type;
  if (input.odometerKm !== undefined) data.odometerKm = input.odometerKm;
  if (input.amountCents !== undefined) data.amountCents = input.amountCents;
  if (input.partsCents !== undefined) data.partsCents = input.partsCents;
  if (input.labourCents !== undefined) data.labourCents = input.labourCents;
  if (input.workshop !== undefined) data.workshop = input.workshop;
  if (input.description !== undefined) data.description = input.description;
  if (input.warrantyMonths !== undefined) data.warrantyMonths = input.warrantyMonths;
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.nextDueDate !== undefined) data.nextDueDate = civilToDateOrNull(input.nextDueDate);
  if (input.nextDueOdometerKm !== undefined) data.nextDueOdometerKm = input.nextDueOdometerKm;
  if (input.intervalMonths !== undefined && input.intervalMonths !== null && input.date !== undefined) {
    data.nextDueDate = addMonths(input.date, input.intervalMonths);
  }
  if (
    input.intervalKm !== undefined &&
    input.intervalKm !== null &&
    input.odometerKm !== undefined &&
    input.odometerKm !== null
  ) {
    data.nextDueOdometerKm = input.odometerKm + input.intervalKm;
  }

  await prisma.maintenanceRecord.update({ where: { id: recordId }, data });

  // O lembrete associado acompanha a alteração: se o utilizador mudou a data da
  // próxima revisão na ficha da manutenção, o alerta tem de refletir isso.
  if (existing.reminderId) {
    const reminderData: Record<string, unknown> = {};
    const updated = await prisma.maintenanceRecord.findUnique({ where: { id: recordId } });
    if (updated) {
      reminderData.dueDate = updated.nextDueDate;
      reminderData.dueOdometerKm = updated.nextDueOdometerKm;
      reminderData.title = `Próxima ${optionLabel(MAINTENANCE_TYPES, updated.type).toLowerCase()}`;
      if (input.intervalMonths !== undefined) reminderData.intervalMonths = input.intervalMonths;
      if (input.intervalKm !== undefined) reminderData.intervalKm = input.intervalKm;
    }
    if (Object.keys(reminderData).length > 0) {
      await prisma.reminder.update({ where: { id: existing.reminderId }, data: reminderData });
    }
  }

  return getMaintenance(userId, recordId);
}

export async function deleteMaintenance(userId: string, recordId: string): Promise<void> {
  const existing = (await requireRecord('maintenanceRecord', userId, recordId)) as {
    reminderId: string | null;
  };
  await prisma.maintenanceRecord.delete({ where: { id: recordId } });
  await removeEventsFor('maintenance', recordId);
  // O lembrete que nasceu deste registo deixa de fazer sentido sem ele.
  if (existing.reminderId) {
    await prisma.reminder.deleteMany({ where: { id: existing.reminderId, completedAt: null } });
    await removeEventsFor('reminder', existing.reminderId);
  }
}

/* ========================================================================== */
/* SEGURO (§18)                                                               */
/* ========================================================================== */

export async function createInsurance(
  userId: string,
  input: InsuranceCreateRequest,
): Promise<InsuranceView> {
  const vehicleId = await resolveVehicleFromBody(userId, input);

  const policy = await prisma.insurancePolicy.create({
    data: {
      vehicleId,
      userId,
      insurer: input.insurer,
      policyNumber: input.policyNumber ?? null,
      startDate: civilToDate(input.startDate),
      endDate: civilToDate(input.endDate),
      premiumCents: input.premiumCents ?? null,
      coverage: input.coverage ?? null,
      deductibleCents: input.deductibleCents ?? null,
      contactPhone: input.contactPhone ?? null,
      documentId: await requireOwnedDocument(userId, input.documentId),
      notes: input.notes ?? null,
      source: writeJson(normalizeSource(input.source, 'manual')),
    },
  });

  await recordEvent({
    vehicleId,
    userId,
    type: 'insurance.created',
    date: input.startDate,
    title: 'Seguro',
    summary: input.insurer,
    amountCents: input.premiumCents ?? null,
    odometerKm: null,
    recordType: 'insurance',
    recordId: policy.id,
    source: normalizeSource(input.source, 'manual'),
  });

  // Alerta de renovação: o lembrete é criado na data de fim da apólice (§18).
  const timeZone = await userTimeZone(userId);
  const today = todayIn(timeZone);
  const reminder = await prisma.reminder.create({
    data: {
      vehicleId,
      userId,
      title: `Renovação do seguro (${input.insurer})`,
      trigger: 'time',
      dueDate: civilToDate(input.endDate),
      intervalMonths: null,
      intervalKm: null,
      repeat: false,
      topic: 'insurance',
      origin: 'insurance',
      originRecordId: policy.id,
      dedupeKey: `insurance:${policy.id}`,
    },
  });

  await prisma.insurancePolicy.update({
    where: { id: policy.id },
    data: { reminderId: reminder.id },
  });

  await recordEvent({
    vehicleId,
    userId,
    type: 'reminder.created',
    date: today,
    title: 'Alerta de renovação do seguro',
    summary: `Termina a ${input.endDate}`,
    amountCents: null,
    odometerKm: null,
    recordType: 'reminder',
    recordId: reminder.id,
    source: null,
  });

  return getInsurance(userId, policy.id);
}

export async function listInsurance(userId: string, query: ListQuery): Promise<Page<InsuranceView>> {
  const timeZone = await userTimeZone(userId);
  const today = todayIn(timeZone);

  const rows = await prisma.insurancePolicy.findMany({
    where: { userId, ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}) },
    orderBy: [{ endDate: 'desc' }, { id: 'desc' }],
    take: 500,
  });

  const items = rows.map((row) => mapInsurance(row, today)).sort((a, b) => (a.endDate < b.endDate ? 1 : a.endDate > b.endDate ? -1 : a.id < b.id ? 1 : -1));
  const startIndex = query.cursor ? findIndexAfterCursor(items, query.cursor) : 0;
  const slice = items.slice(startIndex, startIndex + query.limit + 1);
  return buildPage(slice, query.limit, items.length);
}

export async function getInsurance(userId: string, policyId: string): Promise<InsuranceView> {
  const record = await requireRecord('insurancePolicy', userId, policyId);
  const timeZone = await userTimeZone(userId);
  return mapInsurance(record as Parameters<typeof mapInsurance>[0], todayIn(timeZone));
}

export async function updateInsurance(
  userId: string,
  policyId: string,
  input: InsuranceUpdateRequest,
): Promise<InsuranceView> {
  const existing = (await requireRecord('insurancePolicy', userId, policyId)) as {
    reminderId: string | null;
  };

  const data: Record<string, unknown> = {};
  if (input.insurer !== undefined) data.insurer = input.insurer;
  if (input.policyNumber !== undefined) data.policyNumber = input.policyNumber;
  if (input.startDate !== undefined) data.startDate = civilToDate(input.startDate);
  if (input.endDate !== undefined) data.endDate = civilToDate(input.endDate);
  if (input.premiumCents !== undefined) data.premiumCents = input.premiumCents;
  if (input.coverage !== undefined) data.coverage = input.coverage;
  if (input.deductibleCents !== undefined) data.deductibleCents = input.deductibleCents;
  if (input.contactPhone !== undefined) data.contactPhone = input.contactPhone;
  if (input.documentId !== undefined) {
    data.documentId = await requireOwnedDocument(userId, input.documentId);
  }
  if (input.notes !== undefined) data.notes = input.notes;

  await prisma.insurancePolicy.update({ where: { id: policyId }, data });

  if (existing.reminderId && input.endDate !== undefined) {
    await prisma.reminder.update({
      where: { id: existing.reminderId },
      data: { dueDate: civilToDate(input.endDate) },
    });
  }

  return getInsurance(userId, policyId);
}

export async function deleteInsurance(userId: string, policyId: string): Promise<void> {
  const existing = (await requireRecord('insurancePolicy', userId, policyId)) as {
    reminderId: string | null;
  };
  await prisma.insurancePolicy.delete({ where: { id: policyId } });
  await removeEventsFor('insurance', policyId);
  if (existing.reminderId) {
    await prisma.reminder.deleteMany({ where: { id: existing.reminderId, completedAt: null } });
  }
}

/* ========================================================================== */
/* INSPEÇÃO (§19)                                                             */
/* ========================================================================== */

export async function createInspection(
  userId: string,
  input: InspectionCreateRequest,
): Promise<InspectionView> {
  const vehicleId = await resolveVehicleFromBody(userId, input);

  // Em Portugal a inspeção periódica é anual para veículos ligeiros. Quando o
  // utilizador não indica a próxima data, assumimos um ano — e ele pode corrigir.
  const nextDueDate = input.nextDueDate ?? addYears(input.date, 1);

  const record = await prisma.inspectionRecord.create({
    data: {
      vehicleId,
      userId,
      date: civilToDate(input.date),
      result: input.result ?? 'passed',
      odometerKm: input.odometerKm ?? null,
      amountCents: input.amountCents ?? null,
      nextDueDate: civilToDateOrNull(nextDueDate),
      station: input.station ?? null,
      defects: input.defects ?? null,
      documentId: await requireOwnedDocument(userId, input.documentId),
      notes: input.notes ?? null,
      source: writeJson(normalizeSource(input.source, 'manual')),
    },
  });

  await recordEvent({
    vehicleId,
    userId,
    type: 'inspection.created',
    date: input.date,
    title: 'Inspeção',
    summary: describeInspectionResult(input.result ?? 'passed'),
    amountCents: input.amountCents ?? null,
    odometerKm: input.odometerKm ?? null,
    recordType: 'inspection',
    recordId: record.id,
    source: normalizeSource(input.source, 'manual'),
  });

  if (nextDueDate !== null) {
    const reminder = await prisma.reminder.create({
      data: {
        vehicleId,
        userId,
        title: 'Inspeção periódica',
        trigger: 'time',
        dueDate: civilToDate(nextDueDate),
        intervalMonths: 12,
        intervalKm: null,
        repeat: true,
        topic: 'inspection',
        origin: 'inspection',
        originRecordId: record.id,
        dedupeKey: `inspection:${record.id}`,
      },
    });

    await prisma.inspectionRecord.update({
      where: { id: record.id },
      data: { reminderId: reminder.id },
    });
  }

  // Registar a inspeção avança a quilometragem, como qualquer outro registo (§3.3).
  if (input.odometerKm !== null && input.odometerKm !== undefined) {
    await advanceOdometerIfHigher(userId, vehicleId, input.odometerKm, input.date, 'inspection', record.id);
  }

  return getInspection(userId, record.id);
}

export async function listInspections(
  userId: string,
  query: ListQuery,
): Promise<Page<InspectionView>> {
  const where: Record<string, unknown> = { userId, ...cursorWhere(query.cursor) };
  if (query.vehicleId) where.vehicleId = query.vehicleId;

  const [rows, total] = await Promise.all([
    prisma.inspectionRecord.findMany({
      where,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    }),
    // O mesmo `where` da consulta: uma contagem que ignora os filtros mostra
    // "Combustível · 59" ao lado de uma lista com três itens.
    prisma.inspectionRecord.count({ where }),
  ]);

  return buildPage(rows.map(mapInspection), query.limit, total);
}

export async function getInspection(userId: string, recordId: string): Promise<InspectionView> {
  const record = await requireRecord('inspectionRecord', userId, recordId);
  return mapInspection(record as Parameters<typeof mapInspection>[0]);
}

export async function updateInspection(
  userId: string,
  recordId: string,
  input: InspectionUpdateRequest,
): Promise<InspectionView> {
  const existing = (await requireRecord('inspectionRecord', userId, recordId)) as {
    reminderId: string | null;
  };

  const data: Record<string, unknown> = {};
  if (input.date !== undefined) data.date = civilToDate(input.date);
  if (input.result !== undefined) data.result = input.result;
  if (input.odometerKm !== undefined) data.odometerKm = input.odometerKm;
  if (input.amountCents !== undefined) data.amountCents = input.amountCents;
  if (input.nextDueDate !== undefined) data.nextDueDate = civilToDateOrNull(input.nextDueDate);
  if (input.station !== undefined) data.station = input.station;
  if (input.defects !== undefined) data.defects = input.defects;
  if (input.documentId !== undefined) {
    data.documentId = await requireOwnedDocument(userId, input.documentId);
  }
  if (input.notes !== undefined) data.notes = input.notes;

  await prisma.inspectionRecord.update({ where: { id: recordId }, data });

  if (existing.reminderId && input.nextDueDate !== undefined && input.nextDueDate !== null) {
    await prisma.reminder.update({
      where: { id: existing.reminderId },
      data: { dueDate: civilToDate(input.nextDueDate) },
    });
  }

  return getInspection(userId, recordId);
}

export async function deleteInspection(userId: string, recordId: string): Promise<void> {
  const existing = (await requireRecord('inspectionRecord', userId, recordId)) as {
    reminderId: string | null;
  };
  await prisma.inspectionRecord.delete({ where: { id: recordId } });
  await removeEventsFor('inspection', recordId);
  if (existing.reminderId) {
    await prisma.reminder.deleteMany({ where: { id: existing.reminderId, completedAt: null } });
  }
}

/* ========================================================================== */
/* IMPOSTOS (§20)                                                             */
/* ========================================================================== */

export async function createTax(userId: string, input: TaxCreateRequest): Promise<TaxView> {
  const vehicleId = await resolveVehicleFromBody(userId, input);

  const record = await prisma.taxRecord.create({
    data: {
      vehicleId,
      userId,
      kind: input.kind ?? 'iuc',
      year: input.year,
      amountCents: input.amountCents,
      date: civilToDateOrNull(input.date),
      dueDate: civilToDateOrNull(input.dueDate),
      paid: input.paid ?? true,
      documentId: await requireOwnedDocument(userId, input.documentId),
      notes: input.notes ?? null,
      source: writeJson(normalizeSource(input.source, 'manual')),
    },
  });

  await recordEvent({
    vehicleId,
    userId,
    type: 'tax.created',
    date: input.date ?? `${input.year}-01-01`,
    title: input.kind === 'iuc' ? 'IUC' : 'Imposto',
    summary: `${input.year}`,
    amountCents: input.amountCents,
    odometerKm: null,
    recordType: 'tax',
    recordId: record.id,
    source: normalizeSource(input.source, 'manual'),
  });

  // Um imposto por pagar com data limite conhecida gera lembrete; um imposto já pago
  // é um registo histórico e não precisa de alerta.
  const dueDate = input.dueDate ?? null;
  if (!input.paid && dueDate !== null) {
    const reminder = await prisma.reminder.create({
      data: {
        vehicleId,
        userId,
        title: `Pagar ${input.kind === 'iuc' ? 'IUC' : 'imposto'} de ${input.year}`,
        trigger: 'time',
        dueDate: civilToDate(dueDate),
        repeat: false,
        topic: 'tax',
        origin: 'tax',
        originRecordId: record.id,
        dedupeKey: `tax:${record.id}`,
      },
    });
    await prisma.taxRecord.update({ where: { id: record.id }, data: { reminderId: reminder.id } });
  }

  return getTax(userId, record.id);
}

export async function listTaxes(userId: string, query: ListQuery): Promise<Page<TaxView>> {
  const rows = await prisma.taxRecord.findMany({
    where: { userId, ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}) },
    orderBy: [{ year: 'desc' }, { id: 'desc' }],
    take: 500,
  });

  const items = [...rows]
    .map(mapTax)
    .sort((a, b) => (a.year === b.year ? (a.id < b.id ? 1 : -1) : b.year - a.year));
  const startIndex = query.cursor ? findIndexAfterYear(items, query.cursor) : 0;
  const slice = items.slice(startIndex, startIndex + query.limit + 1);
  return buildPage(slice, query.limit, items.length);
}

export async function getTax(userId: string, recordId: string): Promise<TaxView> {
  const record = await requireRecord('taxRecord', userId, recordId);
  return mapTax(record as Parameters<typeof mapTax>[0]);
}

export async function updateTax(
  userId: string,
  recordId: string,
  input: TaxUpdateRequest,
): Promise<TaxView> {
  const existing = (await requireRecord('taxRecord', userId, recordId)) as { reminderId: string | null };

  const data: Record<string, unknown> = {};
  if (input.kind !== undefined) data.kind = input.kind;
  if (input.year !== undefined) data.year = input.year;
  if (input.amountCents !== undefined) data.amountCents = input.amountCents;
  if (input.date !== undefined) data.date = civilToDateOrNull(input.date);
  if (input.dueDate !== undefined) data.dueDate = civilToDateOrNull(input.dueDate);
  if (input.paid !== undefined) data.paid = input.paid;
  if (input.documentId !== undefined) {
    data.documentId = await requireOwnedDocument(userId, input.documentId);
  }
  if (input.notes !== undefined) data.notes = input.notes;

  await prisma.taxRecord.update({ where: { id: recordId }, data });

  // Marcar como pago conclui o lembrete; desmarcar reabre-o.
  if (existing.reminderId && input.paid !== undefined) {
    await prisma.reminder.update({
      where: { id: existing.reminderId },
      data: { completedAt: input.paid ? new Date() : null },
    });
  }

  return getTax(userId, recordId);
}

export async function deleteTax(userId: string, recordId: string): Promise<void> {
  const existing = (await requireRecord('taxRecord', userId, recordId)) as { reminderId: string | null };
  await prisma.taxRecord.delete({ where: { id: recordId } });
  await removeEventsFor('tax', recordId);
  if (existing.reminderId) {
    await prisma.reminder.deleteMany({ where: { id: existing.reminderId } });
  }
}

/* ========================================================================== */
/* Auxiliares                                                                 */
/* ========================================================================== */

async function resolveVehicleFromBody(userId: string, input: unknown): Promise<string> {
  // Reutiliza a mesma regra do resto da API: veículo indicado, ou o mais recente.
  return resolveVehicleId(userId, vehicleIdOf(input));
}

/**
 * Avança a quilometragem atual do veículo quando o valor é superior ao conhecido.
 *
 * Passa pelo mesmo guarda de plausibilidade que uma leitura explícita (§11), pela mesma
 * razão documentada em `records-financial.ts`: sem ele, introduzir `1200000` no campo de
 * quilometragem de uma inspeção era aceite sem aviso e passava a ser a quilometragem do
 * veículo, contaminando a distância, o custo por km e a projeção de todos os lembretes
 * por distância.
 *
 * Quando o valor não é plausível, o registo é gravado mas a quilometragem do veículo
 * **não avança**: recusar a inspeção por causa de um campo auxiliar seria hostil, e deixar
 * o número duvidoso contaminar os cálculos seria pior.
 */
async function advanceOdometerIfHigher(
  userId: string,
  vehicleId: string,
  odometerKm: number,
  date: CivilDate,
  origin: string,
  originRecordId: string,
): Promise<void> {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: { odometerKm: true, odometerUpdatedAt: true },
  });
  if (!vehicle || (vehicle.odometerKm !== null && odometerKm <= vehicle.odometerKm)) return;

  const [highest, timeZone] = await Promise.all([
    prisma.odometerReading.aggregate({
      where: { vehicleId, isCorrection: false },
      _max: { odometerKm: true },
    }),
    userTimeZone(userId),
  ]);

  const guard = evaluateOdometerReading({
    next: odometerKm,
    recordedAt: date,
    current: {
      odometerKm: vehicle.odometerKm,
      recordedAt: toCivilDate(vehicle.odometerUpdatedAt) ?? todayIn(timeZone, new Date()),
    },
    historicalMaxKm: highest._max.odometerKm ?? null,
    userConfirmed: false,
  });

  if (guard.requiresConfirmation) {
    await prisma.odometerReading.create({
      data: {
        vehicleId,
        odometerKm,
        recordedAt: civilToDate(date),
        source: writeJson({ kind: 'estimated', label: 'A partir de um registo' }),
        notes: `Não usada como quilometragem do veículo: ${guard.warnings.join(' ')}`,
        origin,
        originRecordId,
      },
    });
    return;
  }

  await prisma.odometerReading.create({
    data: {
      vehicleId,
      odometerKm,
      recordedAt: civilToDate(date),
      source: writeJson({ kind: 'estimated', label: 'A partir de um registo' }),
      origin,
      originRecordId,
    },
  });

  await prisma.vehicle.update({
    where: { id: vehicleId },
    data: {
      odometerKm,
      odometerSource: writeJson({ kind: 'estimated', label: 'A partir de um registo' }),
      odometerUpdatedAt: new Date(),
    },
  });
}

function describeInspectionResult(result: string): string {
  const labels: Record<string, string> = {
    passed: 'Aprovada',
    passed_with_defects: 'Aprovada com deficiências',
    failed: 'Reprovada',
    pending: 'Pendente',
  };
  return labels[result] ?? result;
}

function findIndexAfterCursor(items: Array<{ id: string }>, cursor: string): number {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { i?: string };
    if (typeof parsed.i !== 'string') return 0;
    const index = items.findIndex((item) => item.id === parsed.i);
    return index === -1 ? 0 : index + 1;
  } catch {
    return 0;
  }
}

function findIndexAfterYear(items: Array<{ id: string }>, cursor: string): number {
  return findIndexAfterCursor(items, cursor);
}
