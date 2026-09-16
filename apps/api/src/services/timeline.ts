/**
 * Timeline (§24) e os registos que a alimentam.
 *
 * A leitura é feita em duas camadas:
 *
 *  1. `loadTimeline` lê a tabela de eventos (§33) — que é a fonte principal e a razão
 *     pela qual o modelo de eventos existe;
 *  2. `buildRecordTimeline` gera itens a partir dos próprios registos, cobrindo dados
 *     importados ou criados antes de o evento passar a ser escrito.
 *
 * A fusão deduplica por `tipo:id`, pelo que um registo com evento associado aparece
 * uma única vez — com o texto do evento, que é o que o utilizador escreveu.
 */

import type { TimelineItem } from '@zemlo/shared';
import {
  EXPENSE_CATEGORIES,
  MAINTENANCE_TYPES,
  optionIcon,
  optionLabel,
  type CivilDate,
} from '@zemlo/shared';
import { prisma } from '../core/db.js';
import {
  buildTimelineFromRecords,
  mergeTimeline,
  filterTimelineByKinds,
  filterTimelineByRange,
  paginateTimeline,
  type RecordTimelineInput,
} from '../domain/timeline.js';
import { buildTimeline } from '../domain/timeline.js';
import type { EventRow } from '../domain/timeline.js';
import { toCivilDate } from '../domain/payload.js';
import { listVehicleEvents } from './events.js';

/* -------------------------------------------------------------------------- */
/* Construção a partir de eventos                                              */
/* -------------------------------------------------------------------------- */

export { buildTimeline };

/** Converte linhas do Prisma em linhas de evento do domínio. */
export function toEventRows(
  rows: ReadonlyArray<{
    id: string;
    vehicleId: string;
    type: string;
    date: Date | string;
    title: string;
    summary: string | null;
    icon: string | null;
    amountCents: number | null;
    odometerKm: number | null;
    recordType: string | null;
    recordId: string | null;
    source: unknown;
    createdAt: Date;
  }>,
): EventRow[] {
  return rows.map((row) => ({
    id: row.id,
    vehicleId: row.vehicleId,
    type: row.type,
    // A coluna é `DateTime @db.Date`, mas a variante SQLite devolve-a como texto em
    // algumas versões do motor. Normalizar aqui mantém o domínio ignorante do motor.
    date: typeof row.date === 'string' ? row.date.slice(0, 10) : (row.date.toISOString().slice(0, 10) as CivilDate),
    title: row.title,
    summary: row.summary,
    icon: row.icon,
    amountCents: row.amountCents,
    odometerKm: row.odometerKm,
    recordType: row.recordType,
    recordId: row.recordId,
    source: row.source,
    createdAt: row.createdAt,
  }));
}

/* -------------------------------------------------------------------------- */
/* Construção a partir de registos                                             */
/* -------------------------------------------------------------------------- */

/**
 * Gera itens de timeline a partir dos registos existentes.
 *
 * Carrega os oito tipos de registo de um veículo. Não é o caminho rápido — é a rede de
 * segurança que garante que a timeline nunca tem buracos, mesmo para dados que
 * entraram por importação (§25) ou por uma integração que ainda não escreve eventos.
 */
export async function buildRecordTimeline(
  vehicleId: string,
  context: { plateDisplay: string },
): Promise<TimelineItem[]> {
  const [expenses, fuel, charging, maintenance, insurance, inspections, taxes, documents, odometer, reminders] =
    await Promise.all([
      prisma.expense.findMany({ where: { vehicleId }, take: 3000 }),
      prisma.fuelSession.findMany({ where: { vehicleId }, take: 3000 }),
      prisma.chargingSession.findMany({ where: { vehicleId }, take: 3000 }),
      prisma.maintenanceRecord.findMany({ where: { vehicleId }, take: 1000 }),
      prisma.insurancePolicy.findMany({ where: { vehicleId }, take: 200 }),
      prisma.inspectionRecord.findMany({ where: { vehicleId }, take: 200 }),
      prisma.taxRecord.findMany({ where: { vehicleId }, take: 200 }),
      prisma.document.findMany({ where: { vehicleId }, take: 500 }),
      prisma.odometerReading.findMany({ where: { vehicleId }, take: 2000 }),
      prisma.reminder.findMany({ where: { vehicleId, completedAt: { not: null } }, take: 500 }),
    ]);

  const records: RecordTimelineInput[] = [];

  for (const expense of expenses) {
    records.push({
      id: expense.id,
      kind: 'expense',
      date: toCivilDate(expense.date) as CivilDate,
      createdAt: expense.createdAt,
      title: expenseCategoryLabel(expense.category),
      subtitle: expense.description ?? expense.vendor ?? null,
      icon: expenseCategoryIcon(expense.category),
      amountCents: expense.amountCents,
      odometerKm: expense.odometerKm,
      source: expense.source,
      vehicleId,
    });
  }

  for (const session of fuel) {
    records.push({
      id: session.id,
      kind: 'fuel',
      date: toCivilDate(session.date) as CivilDate,
      createdAt: session.createdAt,
      title: 'Abastecimento',
      subtitle: `${session.litres.toFixed(2)} L${session.station ? ` · ${session.station}` : ''}`,
      icon: '⛽',
      amountCents: session.amountCents,
      odometerKm: session.odometerKm,
      metrics: [
        { label: 'Combustível', value: `${session.litres.toFixed(2)} L` },
        { label: 'Valor', value: session.amountCents > 0 ? `${(session.amountCents / 100).toFixed(2)} €` : '—' },
      ],
      source: session.source,
      vehicleId,
    });
  }

  for (const session of charging) {
    records.push({
      id: session.id,
      kind: 'charging',
      date: toCivilDate(session.date) as CivilDate,
      createdAt: session.createdAt,
      title: 'Carregamento',
      subtitle: `${session.energyKwh.toFixed(2)} kWh${session.location ? ` · ${session.location}` : ''}`,
      icon: '🔌',
      amountCents: session.amountCents,
      odometerKm: session.odometerKm,
      metrics: [
        { label: 'Energia', value: `${session.energyKwh.toFixed(1)} kWh` },
        { label: 'Valor', value: session.amountCents > 0 ? `${(session.amountCents / 100).toFixed(2)} €` : '—' },
      ],
      source: session.source,
      vehicleId,
    });
  }

  for (const record of maintenance) {
    records.push({
      id: record.id,
      kind: 'maintenance',
      date: toCivilDate(record.date) as CivilDate,
      createdAt: record.createdAt,
      title: maintenanceTypeLabel(record.type),
      subtitle: record.description ?? record.workshop ?? null,
      icon: '🔧',
      amountCents: record.amountCents,
      odometerKm: record.odometerKm,
      source: record.source,
      vehicleId,
    });
  }

  for (const policy of insurance) {
    records.push({
      id: policy.id,
      kind: 'insurance',
      date: toCivilDate(policy.startDate) as CivilDate,
      createdAt: policy.createdAt,
      title: `Seguro · ${policy.insurer}`,
      subtitle: `Até ${toCivilDate(policy.endDate)}`,
      icon: '🛡️',
      amountCents: policy.premiumCents,
      odometerKm: null,
      source: policy.source,
      vehicleId,
    });
  }

  for (const inspection of inspections) {
    records.push({
      id: inspection.id,
      kind: 'inspection',
      date: toCivilDate(inspection.date) as CivilDate,
      createdAt: inspection.createdAt,
      title: 'Inspeção',
      subtitle: inspection.station,
      icon: '📋',
      amountCents: inspection.amountCents,
      odometerKm: inspection.odometerKm,
      source: inspection.source,
      vehicleId,
    });
  }

  for (const tax of taxes) {
    records.push({
      id: tax.id,
      kind: 'tax',
      date: toCivilDate(tax.date ?? tax.dueDate) ?? `${tax.year}-01-01`,
      createdAt: tax.createdAt,
      title: tax.kind === 'iuc' ? `IUC ${tax.year}` : `Imposto ${tax.year}`,
      subtitle: tax.paid ? 'Pago' : 'Por pagar',
      icon: '🏛️',
      amountCents: tax.amountCents,
      odometerKm: null,
      source: tax.source,
      vehicleId,
    });
  }

  for (const document of documents) {
    if (!document.date) continue;
    records.push({
      id: document.id,
      kind: 'document',
      date: toCivilDate(document.date) as CivilDate,
      createdAt: document.createdAt,
      title: document.name,
      subtitle: document.fileName,
      icon: '📄',
      amountCents: null,
      odometerKm: null,
      source: document.source,
      vehicleId,
    });
  }

  for (const reading of odometer) {
    records.push({
      id: reading.id,
      kind: 'odometer',
      date: toCivilDate(reading.recordedAt) as CivilDate,
      createdAt: reading.createdAt,
      title: reading.isCorrection ? 'Quilometragem corrigida' : 'Quilometragem',
      subtitle: reading.notes,
      icon: '📍',
      amountCents: null,
      odometerKm: reading.odometerKm,
      source: reading.source,
      vehicleId,
    });
  }

  for (const reminder of reminders) {
    if (!reminder.completedAt) continue;
    records.push({
      id: reminder.id,
      kind: 'reminder',
      date: toCivilDate(reminder.completedAt) as CivilDate,
      createdAt: reminder.completedAt,
      title: `Concluído · ${reminder.title}`,
      subtitle: null,
      icon: '✅',
      amountCents: null,
      odometerKm: null,
      source: reminder.source,
      vehicleId,
    });
  }

  return buildTimelineFromRecords(records, context);
}

/* -------------------------------------------------------------------------- */
/* Leitura completa                                                            */
/* -------------------------------------------------------------------------- */

export interface LoadTimelineOptions {
  vehicleId?: string | undefined;
  limit: number;
  cursor?: string | undefined;
  kinds?: string[] | undefined;
  from?: CivilDate | undefined;
  to?: CivilDate | undefined;
}

/**
 * Timeline de um ou mais veículos, paginada por cursor.
 *
 * Quando há eventos, usa-os. Os itens gerados a partir de registos são acrescentados
 * sempre — a fusão deduplica, por isso o custo é uma consulta a mais por veículo, e a
 * garantia é que nenhum registo fica invisível por falta de evento.
 */
export async function loadTimeline(
  vehicles: ReadonlyArray<{ id: string; plateDisplay: string }>,
  options: LoadTimelineOptions,
): Promise<{ items: TimelineItem[]; nextCursor: string | null }> {
  if (vehicles.length === 0) return { items: [], nextCursor: null };

  const perVehicle: TimelineItem[][] = [];

  for (const vehicle of vehicles) {
    const events = await listVehicleEvents(vehicle.id, 2000);
    const fromEvents = buildTimeline(toEventRows(events), { plateDisplay: vehicle.plateDisplay });
    // Sem eventos para este veículo, os registos são a única fonte.
    const fromRecords = events.length === 0
      ? await buildRecordTimeline(vehicle.id, { plateDisplay: vehicle.plateDisplay })
      : [];
    perVehicle.push(fromEvents, fromRecords);
  }

  let items = mergeTimeline(...perVehicle);
  items = filterTimelineByRange(items, options.from ?? null, options.to ?? null);
  items = filterTimelineByKinds(items, options.kinds ?? null);

  return paginateTimeline(items, options.limit, options.cursor ?? null);
}

/* -------------------------------------------------------------------------- */
/* Etiquetas                                                                   */
/* -------------------------------------------------------------------------- */

function expenseCategoryLabel(code: string): string {
  return optionLabel(EXPENSE_CATEGORIES, code);
}

function expenseCategoryIcon(code: string): string {
  return optionIcon(EXPENSE_CATEGORIES, code);
}

function maintenanceTypeLabel(code: string): string {
  return optionLabel(MAINTENANCE_TYPES, code);
}
