/**
 * Timeline do veículo (§24).
 *
 * A timeline é construída a partir do **modelo de eventos** (§33), não por consultas
 * a oito tabelas diferentes. Esta é a razão pela qual o modelo de eventos existe: o
 * histórico central do veículo tem de ser barato de ler, independentemente de quantos
 * tipos de registo o produto ganhe no futuro.
 *
 * Caso o utilizador tenha registos anteriores à criação de um evento (importações,
 * dados criados por uma integração), `buildTimelineFromRecords` gera itens a partir
 * dos próprios registos. Misturar as duas fontes sem duplicar é responsabilidade de
 * `mergeTimeline`, que deduplica por `recordType:recordId`.
 */

import type { TimelineItem, TimelineItemKind } from '@zemlo/shared';
import {
  civilDateToUtc,
  formatCents,
  formatKm,
  formatNumber,
  optionIcon,
  EVENT_TYPES,
  type CivilDate,
  type EventType,
} from '@zemlo/shared';
import { mapSource } from './payload.js';

/** Linha de `VehicleEvent`, com os campos que a timeline consome. */
export interface EventRow {
  id: string;
  vehicleId: string;
  type: string;
  /** Data civil do evento, já convertida a partir do `DateTime @db.Date`. */
  date: CivilDate;
  title: string;
  summary: string | null;
  icon: string | null;
  amountCents: number | null;
  odometerKm: number | null;
  recordType: string | null;
  recordId: string | null;
  source: unknown;
  createdAt: Date;
}

/**
 * Contexto de construção.
 *
 * A placa legível é passada explicitamente porque um item de timeline pode vir de
 * vários veículos (vista agregada da conta) e o item tem de dizer a que veículo pertence.
 */
export interface TimelineBuildContext {
  plateDisplay: string;
}

/** Converte uma linha de evento num item de timeline. */
export function mapEventToTimelineItem(event: EventRow, context: TimelineBuildContext): TimelineItem {
  const eventType = event.type as EventType;
  const date = event.date;
  const metrics: Array<{ label: string; value: string }> = [];

  if (event.amountCents !== null) {
    metrics.push({ label: 'Valor', value: formatCents(event.amountCents) });
  }
  if (event.odometerKm !== null) {
    metrics.push({ label: 'Quilometragem', value: `${formatKm(event.odometerKm)} km` });
  }

  return {
    id: `${event.recordType ?? 'event'}:${event.recordId ?? event.id}`,
    kind: kindFromEventType(eventType, event.recordType),
    eventType,
    vehicleId: event.vehicleId,
    vehiclePlateDisplay: context.plateDisplay,
    date,
    createdAt: event.createdAt.toISOString(),
    title: event.title || optionTitle(eventType),
    subtitle: event.summary,
    icon: event.icon ?? optionIcon(EVENT_TYPES, eventType),
    amountCents: event.amountCents,
    odometerKm: event.odometerKm,
    metrics,
    href: recordHref(event.recordType, event.recordId),
    source: mapSource(event.source),
  };
}

/**
 * Gera itens de timeline a partir de um registo, quando não existe evento associado.
 *
 * Cobre o caso de dados importados ou criados antes de o evento passar a ser escrito.
 * Não é o caminho principal: existe para que a timeline nunca tenha buracos.
 */
export interface RecordTimelineInput {
  id: string;
  kind: TimelineItemKind;
  date: CivilDate;
  createdAt: Date;
  title: string;
  subtitle: string | null;
  icon: string;
  amountCents: number | null;
  odometerKm: number | null;
  metrics?: Array<{ label: string; value: string }>;
  source?: unknown;
  vehicleId: string;
}

export function buildTimelineFromRecords(
  records: readonly RecordTimelineInput[],
  context: TimelineBuildContext,
): TimelineItem[] {
  return records.map((record) => ({
    id: `${record.kind}:${record.id}`,
    kind: record.kind,
    eventType: null,
    vehicleId: record.vehicleId,
    vehiclePlateDisplay: context.plateDisplay,
    date: record.date,
    createdAt: record.createdAt.toISOString(),
    title: record.title,
    subtitle: record.subtitle,
    icon: record.icon,
    amountCents: record.amountCents,
    odometerKm: record.odometerKm,
    metrics: record.metrics ?? buildDefaultMetrics(record.amountCents, record.odometerKm),
    href: recordHref(record.kind, record.id),
    source: mapSource(record.source),
  }));
}

/**
 * Junta itens de várias fontes, remove duplicados e ordena do mais recente para o
 * mais antigo.
 *
 * A ordenação primária é a data civil (o que o utilizador vê), com o instante de
 * criação como desempate — dois registos do mesmo dia aparecem pela ordem em que
 * foram introduzidos, que é a ordem que o utilizador espera.
 */
export function mergeTimeline(...sources: readonly TimelineItem[][]): TimelineItem[] {
  const byId = new Map<string, TimelineItem>();
  for (const source of sources) {
    for (const item of source) {
      // Eventos reais têm precedência sobre itens gerados a partir de registos.
      const existing = byId.get(item.id);
      if (!existing || (existing.eventType === null && item.eventType !== null)) {
        byId.set(item.id, item);
      }
    }
  }
  return [...byId.values()].sort(compareTimelineDesc);
}

/** Comparador descendente: mais recente primeiro. */
export function compareTimelineDesc(a: TimelineItem, b: TimelineItem): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}

/* -------------------------------------------------------------------------- */
/* Paginação por cursor (§34)                                                  */
/* -------------------------------------------------------------------------- */

export interface TimelineCursor {
  date: CivilDate;
  createdAt: string;
  id: string;
}

export function encodeTimelineCursor(item: TimelineItem): string {
  return Buffer.from(
    JSON.stringify({ d: item.date, c: item.createdAt, i: item.id }),
    'utf8',
  ).toString('base64url');
}

export function decodeTimelineCursor(cursor: string): TimelineCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      d?: unknown;
      c?: unknown;
      i?: unknown;
    };
    if (typeof parsed.d !== 'string' || typeof parsed.c !== 'string' || typeof parsed.i !== 'string') {
      return null;
    }
    return { date: parsed.d, createdAt: parsed.c, id: parsed.i };
  } catch {
    return null;
  }
}

/**
 * Aplica o cursor a uma lista já ordenada.
 *
 * A paginação é feita em memória porque a timeline resulta da fusão de fontes
 * heterogéneas. Para o volume de um veículo pessoal — mesmo com 15 anos de registos,
 * alguns milhares de itens — é mais simples e mais correto fazê-lo assim do que
 * manter uma tabela materializada de timeline. Se o Zemlo chegar a frotas com
 * milhares de veículos, esta função é o ponto único a substituir.
 */
export function paginateTimeline(
  items: readonly TimelineItem[],
  limit: number,
  cursor: string | null,
): { items: TimelineItem[]; nextCursor: string | null } {
  let startIndex = 0;
  if (cursor) {
    const decoded = decodeTimelineCursor(cursor);
    if (decoded) {
      const index = items.findIndex(
        (item) =>
          item.date < decoded.date ||
          (item.date === decoded.date &&
            (item.createdAt < decoded.createdAt ||
              (item.createdAt === decoded.createdAt && item.id < decoded.id))),
      );
      startIndex = index === -1 ? items.length : index;
    }
  }

  const page = items.slice(startIndex, startIndex + limit);
  const last = page[page.length - 1];
  const hasMore = startIndex + limit < items.length;
  return {
    items: page,
    nextCursor: hasMore && last ? encodeTimelineCursor(last) : null,
  };
}

/** Filtro por tipos de registo, aplicado antes da paginação. */
export function filterTimelineByKinds(
  items: readonly TimelineItem[],
  kinds: readonly string[] | null,
): TimelineItem[] {
  if (!kinds || kinds.length === 0) return [...items];
  const allowed = new Set(kinds);
  return items.filter((item) => allowed.has(item.kind) || (item.eventType !== null && allowed.has(item.eventType)));
}

/** Filtro por intervalo de datas civis (inclusive). */
export function filterTimelineByRange(
  items: readonly TimelineItem[],
  from: CivilDate | null,
  to: CivilDate | null,
): TimelineItem[] {
  return items.filter((item) => {
    if (from && item.date < from) return false;
    if (to && item.date > to) return false;
    return true;
  });
}

/* -------------------------------------------------------------------------- */
/* Construção a partir de eventos                                              */
/* -------------------------------------------------------------------------- */

export interface BuildTimelineOptions {
  /** Só inclui itens a partir desta data civil. */
  from?: CivilDate | null;
  /** Só inclui itens até esta data civil. */
  to?: CivilDate | null;
}

/**
 * Constrói a timeline a partir de linhas de evento, opcionalmente limitada a um
 * intervalo de datas (usado pela lista de "próximos" do dashboard, §8).
 */
export function buildTimeline(
  events: readonly EventRow[],
  context: TimelineBuildContext,
  options: BuildTimelineOptions = {},
): TimelineItem[] {
  const items = events.map((event) => mapEventToTimelineItem(event, context));
  return filterTimelineByRange(mergeTimeline(items), options.from ?? null, options.to ?? null);
}

/* -------------------------------------------------------------------------- */
/* Utilitários                                                                 */
/* -------------------------------------------------------------------------- */

function buildDefaultMetrics(
  amountCents: number | null,
  odometerKm: number | null,
): Array<{ label: string; value: string }> {
  const metrics: Array<{ label: string; value: string }> = [];
  if (amountCents !== null) metrics.push({ label: 'Valor', value: formatCents(amountCents) });
  if (odometerKm !== null) metrics.push({ label: 'Quilometragem', value: `${formatKm(odometerKm)} km` });
  return metrics;
}

function optionTitle(type: EventType): string {
  const found = EVENT_TYPES.find((option) => option.code === type);
  return found?.label ?? 'Registo';
}

/** Mapeia o tipo de evento para o tipo de item de timeline que o frontend estiliza. */
function kindFromEventType(type: EventType, recordType: string | null): TimelineItemKind {
  if (recordType) {
    const known: TimelineItemKind[] = [
      'expense',
      'fuel',
      'charging',
      'maintenance',
      'insurance',
      'inspection',
      'tax',
      'document',
      'odometer',
      'reminder',
    ];
    if ((known as string[]).includes(recordType)) return recordType as TimelineItemKind;
  }
  switch (type) {
    case 'expense.created':
      return 'expense';
    case 'fuel.created':
      return 'fuel';
    case 'charging.created':
      return 'charging';
    case 'maintenance.created':
      return 'maintenance';
    case 'insurance.created':
      return 'insurance';
    case 'inspection.created':
      return 'inspection';
    case 'tax.created':
      return 'tax';
    case 'document.created':
      return 'document';
    case 'odometer.recorded':
    case 'odometer.corrected':
      return 'odometer';
    case 'reminder.created':
    case 'reminder.completed':
      return 'reminder';
    default:
      return 'event';
  }
}

/**
 * Rota para o detalhe de um registo. Usada pelos links da timeline na app web.
 *
 * **Invariante: esta função só devolve rotas que a cadeia API+web serve de facto.** Quando não
 * existe ecrã para o registo, devolve `null` — e o item deixa de ser uma ligação, em vez de
 * levar o utilizador a um 404 ou a um ecrã errado. `records.tsx` só envolve o item em `<Link>`
 * quando `href` não é nulo, pelo que `null` é uma resposta de primeira classe, não uma omissão.
 *
 * Isto já foi um defeito real (🔴-2, `AUD-002`): os documentos eram enviados para
 * `/records/documents/<id>` — a web serve o detalhe do documento em `/documents/<id>` — e os
 * lembretes para `/records/reminders/<id>` — a API expõe os lembretes em `/reminders/<id>`, e
 * não existe ecrã de detalhe de um lembrete. Os dois davam 404.
 *
 * Antes de acrescentar um tipo aqui, confirme-se que existe ecrã. Os tipos que geram evento com
 * `recordId` estão em `services/`; `vehicle` e `odometer` não têm ecrã de detalhe — o evento de
 * odómetro é escrito com `recordId` nulo (`vehicles.ts`) e a quilometragem vive na ficha do
 * veículo.
 */
export function recordHref(recordType: string | null, recordId: string | null): string | null {
  if (!recordType || !recordId) return null;

  /** Tipos cujo detalhe vive sob `/records/<rota>/<id>`. */
  const recordRoutes: Record<string, string> = {
    expense: 'expenses',
    fuel: 'fuel',
    charging: 'charging',
    maintenance: 'maintenance',
    insurance: 'insurance',
    inspection: 'inspections',
    tax: 'taxes',
  };
  const route = recordRoutes[recordType];
  if (route) return `/records/${route}/${recordId}`;

  /** O documento tem ecrã próprio, fora de `/records/`. */
  if (recordType === 'document') return `/documents/${recordId}`;

  return null;
}

/** Data civil de um evento, normalizada para comparação. */
export function eventDateKey(event: EventRow): number {
  return civilDateToUtc(event.date).getTime();
}

/** Formata uma quantidade de energia, com a unidade correta. */
export function formatEnergy(kwh: number): string {
  return `${formatNumber(kwh, 1)} kWh`;
}

/** Formata um volume de combustível. */
export function formatVolume(litres: number): string {
  return `${formatNumber(litres, 2)} L`;
}
