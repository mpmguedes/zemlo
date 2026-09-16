/**
 * Modelo de eventos (§33).
 *
 * Toda a ação importante escreve um evento. Desta tabela nascem quatro coisas:
 * a timeline (§24), as estatísticas (§23), as notificações (§22) e — no futuro —
 * as automações e as publicações para o Home Assistant (§26, §27).
 *
 * Porquê uma tabela de eventos e não consultas diretas a cada tipo de registo: com
 * oito tipos de registo (e mais a caminho), a timeline exigiria oito consultas, oito
 * ordenações e uma fusão em memória a cada abertura do ecrã. Com eventos, é uma
 * consulta indexada. A contrapartida é a responsabilidade de manter os eventos
 * sincronizados com os registos, que é o que este módulo centraliza.
 */

import type { EventType } from '@zemlo/shared';
import { optionIcon, EVENT_TYPES, type CivilDate } from '@zemlo/shared';
import { prisma } from '../core/db.js';
import { writeJson } from '../core/json.js';
import { logger } from '../core/logger.js';
import { fromCivilDate, toCivilDate } from '../domain/payload.js';
import type { SourceInfo } from '@zemlo/shared';

export interface RecordEventInput {
  vehicleId: string;
  userId: string;
  type: EventType;
  date: CivilDate;
  title: string;
  summary?: string | null;
  icon?: string | null;
  amountCents?: number | null;
  odometerKm?: number | null;
  recordType?: string | null;
  recordId?: string | null;
  source?: SourceInfo | null;
  payload?: Record<string, unknown> | null;
}

/**
 * Escreve um evento.
 *
 * Uma falha ao escrever o evento **não** deve reverter o registo que o originou: o
 * utilizador guardou uma despesa, e essa despesa existe. A timeline fica sem esse item
 * até a reconciliação correr, mas o dado não se perde. Este é o compromisso correto
 * para um produto de registo pessoal — perder o que o utilizador escreveu é
 * irreparável; perder uma linha de histórico é recuperável.
 */
export async function recordEvent(input: RecordEventInput): Promise<void> {
  try {
    await prisma.vehicleEvent.create({
      data: {
        vehicleId: input.vehicleId,
        userId: input.userId,
        type: input.type,
        date: fromCivilDate(input.date) as Date,
        title: input.title,
        summary: input.summary ?? null,
        icon: input.icon ?? optionIcon(EVENT_TYPES, input.type),
        amountCents: input.amountCents ?? null,
        odometerKm: input.odometerKm ?? null,
        recordType: input.recordType ?? null,
        recordId: input.recordId ?? null,
        source: writeJson(input.source ?? null),
        payload: writeJson(input.payload ?? null),
      },
    });
  } catch (error) {
    logger.error('Não foi possível registar o evento', {
      type: input.type,
      vehicleId: input.vehicleId,
      error,
    });
  }
}

/**
 * Remove os eventos associados a um registo eliminado.
 *
 * Sem isto, apagar uma despesa deixaria o seu evento na timeline — o utilizador veria
 * um registo que já não existe e não o conseguiria abrir.
 */
export async function removeEventsFor(recordType: string, recordId: string): Promise<void> {
  try {
    await prisma.vehicleEvent.deleteMany({ where: { recordType, recordId } });
  } catch (error) {
    logger.error('Não foi possível remover os eventos do registo', { recordType, recordId, error });
  }
}

/** Eventos de um veículo, do mais recente para o mais antigo. */
export async function listVehicleEvents(vehicleId: string, limit = 500) {
  const events = await prisma.vehicleEvent.findMany({
    where: { vehicleId },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: Math.min(limit, 2000),
  });
  return events.map((event) => ({ ...event, date: toCivilDate(event.date) as CivilDate }));
}

/** Eventos de um veículo dentro de um intervalo de datas civis. */
export async function listVehicleEventsInRange(vehicleId: string, from: CivilDate, to: CivilDate) {
  const events = await prisma.vehicleEvent.findMany({
    where: {
      vehicleId,
      date: { gte: fromCivilDate(from) as Date, lte: fromCivilDate(to) as Date },
    },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
  return events.map((event) => ({ ...event, date: toCivilDate(event.date) as CivilDate }));
}

/** Eventos de vários veículos, para a vista agregada da conta. */
export async function listEventsForVehicles(vehicleIds: readonly string[], limit = 500) {
  if (vehicleIds.length === 0) return [];
  const events = await prisma.vehicleEvent.findMany({
    where: { vehicleId: { in: [...vehicleIds] } },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: Math.min(limit, 2000),
  });
  return events.map((event) => ({ ...event, date: toCivilDate(event.date) as CivilDate }));
}
