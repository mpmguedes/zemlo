/**
 * Documentos (§17).
 *
 * Nota de arquitetura sobre os ficheiros: no MVP a API **não** serve bytes de
 * documentos. Guarda os metadados e uma referência opaca (`storageKey`) para o
 * armazenamento de objetos. Isto é deliberado:
 *
 *  1. servir ficheiros de uma API Node significa, mais cedo ou mais tarde, reimplementar
 *     um servidor de ficheiros (intervalos de bytes, retoma de transferência, cache) —
 *     trabalho que o armazenamento de objetos já faz melhor;
 *  2. um documento do veículo pode ter dezenas de megabytes (fotos, PDFs) e passá-los
 *     pela API transforma cada pedido de um utilizador numa operação com custo de banda;
 *  3. a autorização passa a ser feita na emissão de um URL assinado e temporário, o que
 *     mantém a verificação de propriedade num único ponto.
 *
 * O que fica implementado e testável agora é o que o produto precisa primeiro: saber
 * que documento existe, de que veículo, e quando expira (§6, §7, §22).
 */

import type {
  DocumentCreateRequest,
  DocumentRecord,
  DocumentUpdateRequest,
  ListQuery,
  Page,
} from '@zemlo/shared';
import { todayIn, type CivilDate } from '@zemlo/shared';
import { prisma } from '../core/db.js';
import { translatePrismaError } from '../core/errors.js';
import { writeJson } from '../core/json.js';
import { mapDocument } from '../domain/payload.js';
import { recordEvent, removeEventsFor } from './events.js';
import { buildPage, civilToDateOrNull, cursorWhere, requireRecord } from './shared.js';
import { normalizeSource, requireVehicleAccess } from './vehicles.js';

async function userTimeZone(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } });
  return user?.timeZone ?? 'Europe/Lisbon';
}

export async function createDocument(
  userId: string,
  input: DocumentCreateRequest,
): Promise<DocumentRecord> {
  if (input.vehicleId) await requireVehicleAccess(userId, input.vehicleId);

  const timeZone = await userTimeZone(userId);
  const today = todayIn(timeZone);

  try {
    const document = await prisma.document.create({
      data: {
        userId,
        vehicleId: input.vehicleId ?? null,
        name: input.name,
        category: input.category,
        date: civilToDateOrNull(input.date),
        expiresAt: civilToDateOrNull(input.expiresAt),
        fileName: input.fileName ?? null,
        mimeType: input.mimeType ?? null,
        sizeBytes: input.sizeBytes ?? null,
        storageKey: input.storageKey ?? null,
        notes: input.notes ?? null,
        source: writeJson(normalizeSource(input.source, 'manual')),
      },
    });

    // Um documento sem veículo (ex.: carta de condução) não gera evento de veículo.
    if (document.vehicleId) {
      await recordEvent({
        vehicleId: document.vehicleId,
        userId,
        type: 'document.created',
        date: input.date ?? today,
        title: input.name,
        summary: input.fileName ?? null,
        amountCents: null,
        odometerKm: null,
        recordType: 'document',
        recordId: document.id,
        source: normalizeSource(input.source, 'manual'),
      });
    }

    // Documento com validade gera lembrete: é a razão pela qual o utilizador o guardou.
    if (input.expiresAt && document.vehicleId) {
      const reminder = await prisma.reminder.create({
        data: {
          vehicleId: document.vehicleId,
          userId,
          title: `Validade: ${input.name}`,
          trigger: 'time',
          dueDate: civilToDateOrNull(input.expiresAt),
          repeat: false,
          topic: 'document',
          origin: 'document',
          originRecordId: document.id,
          dedupeKey: `document:${document.id}`,
        },
      });
      await recordEvent({
        vehicleId: document.vehicleId,
        userId,
        type: 'document.expiring',
        date: today,
        title: 'Alerta de validade de documento',
        summary: `${input.name} · termina a ${input.expiresAt}`,
        amountCents: null,
        odometerKm: null,
        recordType: 'reminder',
        recordId: reminder.id,
        source: null,
      });
    }

    return getDocument(userId, document.id);
  } catch (error) {
    throw translatePrismaError(error, 'criar documento');
  }
}

export async function listDocuments(userId: string, query: ListQuery): Promise<Page<DocumentRecord>> {
  const where: Record<string, unknown> = { userId, ...cursorWhere(query.cursor) };
  if (query.vehicleId) where.vehicleId = query.vehicleId;

  const timeZone = await userTimeZone(userId);
  const today = todayIn(timeZone);

  const [rows, total] = await Promise.all([
    prisma.document.findMany({
      where,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    }),
    // O mesmo `where` da consulta: uma contagem que ignora os filtros mostra
    // "Combustível · 59" ao lado de uma lista com três itens.
    prisma.document.count({ where }),
  ]);

  return buildPage(
    rows.map((row) => mapDocument(row, today)),
    query.limit,
    total,
  );
}

export async function getDocument(userId: string, documentId: string): Promise<DocumentRecord> {
  const record = await requireRecord('document', userId, documentId);
  const timeZone = await userTimeZone(userId);
  return mapDocument(record as Parameters<typeof mapDocument>[0], todayIn(timeZone));
}

export async function updateDocument(
  userId: string,
  documentId: string,
  input: DocumentUpdateRequest,
): Promise<DocumentRecord> {
  await requireRecord('document', userId, documentId);
  if (input.vehicleId) await requireVehicleAccess(userId, input.vehicleId);

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.category !== undefined) data.category = input.category;
  if (input.date !== undefined) data.date = civilToDateOrNull(input.date);
  if (input.expiresAt !== undefined) data.expiresAt = civilToDateOrNull(input.expiresAt);
  if (input.vehicleId !== undefined) data.vehicleId = input.vehicleId;
  if (input.fileName !== undefined) data.fileName = input.fileName;
  if (input.mimeType !== undefined) data.mimeType = input.mimeType;
  if (input.sizeBytes !== undefined) data.sizeBytes = input.sizeBytes;
  if (input.storageKey !== undefined) data.storageKey = input.storageKey;
  if (input.notes !== undefined) data.notes = input.notes;

  await prisma.document.update({ where: { id: documentId }, data });

  // A validade do lembrete segue a do documento.
  if (input.expiresAt !== undefined) {
    await prisma.reminder.updateMany({
      where: { originRecordId: documentId, origin: 'document', completedAt: null },
      data: { dueDate: civilToDateOrNull(input.expiresAt) },
    });
  }

  return getDocument(userId, documentId);
}

export async function deleteDocument(userId: string, documentId: string): Promise<void> {
  await requireRecord('document', userId, documentId);
  await prisma.document.delete({ where: { id: documentId } });
  await removeEventsFor('document', documentId);
  const reminders = await prisma.reminder.findMany({
    where: { originRecordId: documentId, origin: 'document' },
    select: { id: true },
  });
  if (reminders.length > 0) {
    await prisma.reminder.deleteMany({ where: { id: { in: reminders.map((reminder) => reminder.id) } } });
    for (const reminder of reminders) await removeEventsFor('reminder', reminder.id);
  }
}

/**
 * Documentos a expirar dentro de um horizonte de dias.
 * Alimenta os cartões de estado do dashboard (§8) e o calendário (§21).
 */
export async function documentsExpiringSoon(
  userId: string,
  today: CivilDate,
  withinDays: number,
): Promise<DocumentRecord[]> {
  const [year, month, day] = today.split('-').map(Number) as [number, number, number];
  const limit = new Date(Date.UTC(year, month - 1, day + withinDays)).toISOString().slice(0, 10);

  const rows = await prisma.document.findMany({
    where: {
      userId,
      expiresAt: {
        not: null,
        lte: new Date(`${limit}T00:00:00.000Z`),
      },
    },
    orderBy: { expiresAt: 'asc' },
    take: 50,
  });

  return rows.map((row) => mapDocument(row, today));
}
