/**
 * Utilitários partilhados pelos serviços de registos.
 *
 * A paginação, o carregamento com verificação de acesso e a gestão de despesas
 * associadas repetem-se em oito tipos de registo. Estão aqui uma vez, para que a
 * regra de segurança (nunca devolver um registo de outro utilizador) e a regra de
 * paginação (cursor estável) tenham uma única implementação.
 */

import type { Page } from '@zemlo/shared';
import type { CivilDate } from '@zemlo/shared';
import { prisma } from '../core/db.js';
import { notFound, unprocessable } from '../core/errors.js';
import { jsonOrNull } from '../core/json.js';

/* -------------------------------------------------------------------------- */
/* Paginação por cursor                                                        */
/* -------------------------------------------------------------------------- */

export interface Cursor {
  /** Data civil do último item devolvido. */
  date: CivilDate;
  /** Identificador do último item, para desempate estável. */
  id: string;
}

export function encodeCursor(date: CivilDate, id: string): string {
  return Buffer.from(JSON.stringify({ d: date, i: id }), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined | null): Cursor | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      d?: unknown;
      i?: unknown;
    };
    if (typeof parsed.d !== 'string' || typeof parsed.i !== 'string') return null;
    return { date: parsed.d, id: parsed.i };
  } catch {
    return null;
  }
}

/**
 * Constrói uma cláusula `where` do Prisma para paginar por (data, id) descendente.
 *
 * Paginar por cursor em vez de `offset` é importante nesta aplicação: o utilizador
 * introduz registos com datas retroativas (uma fatura de ontem, uma revisão do mês
 * passado), e um `offset` faria com que um registo novo inserido no início da lista
 * deslocasse a página seguinte, fazendo-o ver um item repetido ou saltar outro.
 */
export function cursorWhere(cursor: string | undefined | null): Record<string, unknown> {
  const decoded = decodeCursor(cursor);
  if (!decoded) return {};
  const boundary = new Date(`${decoded.date}T00:00:00.000Z`);
  return {
    OR: [
      { date: { lt: boundary } },
      { date: boundary, id: { lt: decoded.id } },
    ],
  };
}

/**
 * Embrulha uma página de resultados.
 *
 * O cursor usa o par `(date, id)` quando o item tem data (registos cronológicos) e
 * apenas o `id` quando não tem — é o caso das apólices de seguro, que se paginam pela
 * data de fim, e dos impostos, que se paginam pelo ano.
 */
export function buildPage<T extends { id: string }>(
  items: T[],
  limit: number,
  total: number | null = null,
): Page<T> {
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor: hasMore && last ? encodeCursor(cursorDateOf(last), last.id) : null,
    total,
  };
}

/** Data civil a usar no cursor: a do item, ou uma data neutra quando não aplicável. */
function cursorDateOf(item: unknown): CivilDate {
  if (typeof item === 'object' && item !== null) {
    const value = (item as { date?: unknown }).date;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const endDate = (item as { endDate?: unknown }).endDate;
    if (typeof endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) return endDate;
    const year = (item as { year?: unknown }).year;
    if (typeof year === 'number') return `${year}-01-01`;
  }
  return '1970-01-01';
}

/* -------------------------------------------------------------------------- */
/* Acesso a registos                                                           */
/* -------------------------------------------------------------------------- */

type RecordModel =
  | 'expense'
  | 'fuelSession'
  | 'chargingSession'
  | 'maintenanceRecord'
  | 'insurancePolicy'
  | 'inspectionRecord'
  | 'taxRecord'
  | 'document'
  | 'reminder';

/** Mensagens de erro por tipo de registo, no tom da marca (§59). */
const NOT_FOUND_MESSAGES: Record<RecordModel, string> = {
  expense: 'Não encontrámos essa despesa.',
  fuelSession: 'Não encontrámos esse abastecimento.',
  chargingSession: 'Não encontrámos esse carregamento.',
  maintenanceRecord: 'Não encontrámos essa intervenção.',
  insurancePolicy: 'Não encontrámos esse seguro.',
  inspectionRecord: 'Não encontrámos essa inspeção.',
  taxRecord: 'Não encontrámos esse imposto.',
  document: 'Não encontrámos esse documento.',
  reminder: 'Não encontrámos esse lembrete.',
};

/**
 * Carrega um registo garantindo que pertence ao utilizador.
 *
 * O filtro por `userId` é feito na consulta, e não depois de a carregar: assim um
 * identificador de outro utilizador é indistinguível de um identificador inexistente,
 * tanto na resposta como no tempo de execução.
 *
 * O tipo concreto do registo depende do modelo, por isso cada serviço faz o cast para
 * o tipo que conhece. O que este módulo garante é a regra de acesso.
 */
export async function requireRecord(
  model: RecordModel,
  userId: string,
  recordId: string,
): Promise<Record<string, unknown>> {
  const record = await loadRecord(model, userId, recordId);
  if (!record) throw notFound(NOT_FOUND_MESSAGES[model]);
  return record;
}

async function loadRecord(
  model: RecordModel,
  userId: string,
  recordId: string,
): Promise<Record<string, unknown> | null> {
  const delegate = prisma[model] as unknown as {
    findFirst(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
  };
  return delegate.findFirst({ where: { id: recordId, userId } });
}

/* -------------------------------------------------------------------------- */
/* Despesas associadas a um registo (§12)                                      */
/* -------------------------------------------------------------------------- */

export interface LinkedExpenseInput {
  vehicleId: string;
  userId: string;
  amountCents: number | null | undefined;
  date: CivilDate;
  category: string;
  vendor?: string | null;
  odometerKm?: number | null;
  description?: string | null;
  linkedRecordType: string;
  linkedRecordId: string;
  source?: unknown;
}

/**
 * Cria a despesa correspondente a um registo, quando o utilizador indicou um valor.
 *
 * Manter o custo em dois sítios (o registo e a despesa) é uma duplicação deliberada:
 * o registo de abastecimento descreve **o que aconteceu ao veículo** (litros, posto,
 * odómetro) e a despesa descreve **o que saiu da carteira** (valor, IVA, método de
 * pagamento). As estatísticas financeiras somam as despesas; as estatísticas técnicas
 * usam os registos. `linkedRecordType` e `linkedRecordId` impedem a contagem dupla.
 *
 * Devolve `null` quando não há valor a registar.
 */
export async function createLinkedExpense(input: LinkedExpenseInput): Promise<string | null> {
  if (input.amountCents === null || input.amountCents === undefined || input.amountCents === 0) {
    return null;
  }

  const expense = await prisma.expense.create({
    data: {
      vehicleId: input.vehicleId,
      userId: input.userId,
      amountCents: input.amountCents,
      category: input.category,
      date: new Date(`${input.date}T00:00:00.000Z`),
      vendor: input.vendor ?? null,
      odometerKm: input.odometerKm ?? null,
      description: input.description ?? null,
      paid: true,
      linkedRecordType: input.linkedRecordType,
      linkedRecordId: input.linkedRecordId,
      source: jsonOrNull(input.source),
    },
  });

  return expense.id;
}

/** Atualiza a despesa associada, se existir. */
export async function updateLinkedExpense(
  expenseId: string | null | undefined,
  input: { amountCents?: number | null; date?: CivilDate; odometerKm?: number | null; vendor?: string | null },
): Promise<void> {
  if (!expenseId) return;
  const data: Record<string, unknown> = {};
  if (input.amountCents !== undefined) data.amountCents = input.amountCents ?? 0;
  if (input.date !== undefined) data.date = new Date(`${input.date}T00:00:00.000Z`);
  if (input.odometerKm !== undefined) data.odometerKm = input.odometerKm;
  if (input.vendor !== undefined) data.vendor = input.vendor;
  if (Object.keys(data).length === 0) return;
  await prisma.expense.updateMany({ where: { id: expenseId }, data });
}

/** Elimina a despesa associada, se existir. */
export async function deleteLinkedExpense(expenseId: string | null | undefined): Promise<void> {
  if (!expenseId) return;
  await prisma.expense.deleteMany({ where: { id: expenseId } });
}

/* -------------------------------------------------------------------------- */
/* Datas                                                                       */
/* -------------------------------------------------------------------------- */

/** Converte uma data civil no `Date` UTC usado pelas colunas `@db.Date`. */
export function civilToDate(date: CivilDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** Converte uma data civil opcional. */
export function civilToDateOrNull(date: CivilDate | null | undefined): Date | null {
  return date ? civilToDate(date) : null;
}

/** Verifica que a data não está no futuro distante (erro de digitação comum). */
export function assertNotFarFuture(date: CivilDate, today: CivilDate, toleranceDays = 1): void {
  const [y1, m1, d1] = today.split('-').map(Number) as [number, number, number];
  const limit = new Date(Date.UTC(y1, m1 - 1, d1 + toleranceDays)).toISOString().slice(0, 10);
  if (date > limit) {
    throw unprocessable('A data indicada está no futuro. Confirma o ano antes de guardar.', {
      field: 'date',
      value: date,
    });
  }
}
