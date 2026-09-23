/**
 * Registos financeiros e de energia: despesas (§12), abastecimentos (§13) e
 * carregamentos (§14).
 *
 * Estes três tipos estão juntos porque partilham o mesmo fluxo: criar um registo
 * rápido, derivar métricas, atualizar a quilometragem do veículo, escrever o evento e
 * — quando há valor — criar a despesa correspondente.
 *
 * Princípio de produto aplicado aqui (§43, §44): o utilizador introduz dois ou três
 * campos e o resto é preenchido por omissão. Por isso há valores por omissão para a
 * data, para o tipo de combustível e para a ligação à despesa.
 */

import type {
  ChargingCreateRequest,
  ChargingSession as ChargingView,
  ChargingUpdateRequest,
  Expense as ExpenseView,
  ExpenseCreateRequest,
  ExpenseUpdateRequest,
  FuelCreateRequest,
  FuelSession as FuelView,
  FuelUpdateRequest,
  ListQuery,
  Page,
} from '@zemlo/shared';
import {
  EXPENSE_CATEGORIES,
  optionLabel,
  todayIn,
  type CivilDate,
  type FuelType,
} from '@zemlo/shared';
import { prisma } from '../core/db.js';
import { notFound, translatePrismaError } from '../core/errors.js';
import { writeJson } from '../core/json.js';
import { evaluateOdometerReading } from '../domain/odometer.js';
import {
  deriveChargingConsumption,
  deriveFuelConsumption,
  pricePerKwhCents,
  pricePerLitreCents,
  type FuelEntryInput,
} from '../domain/calculations.js';
import { mapChargingSession, mapExpense, mapFuelSession, toCivilDate } from '../domain/payload.js';
import { normalizeSource, requireVehicleAccess, resolveVehicleId } from './vehicles.js';
import { recordEvent, removeEventsFor } from './events.js';
import {
  assertNotFarFuture,
  buildPage,
  civilToDate,
  createLinkedExpense,
  cursorWhere,
  deleteLinkedExpense,
  requireRecord,
  updateLinkedExpense,
} from './shared.js';

/** Limite de registos carregados para cálculo de consumos. Ver nota em `listFuelSessions`. */
const CONSUMPTION_WINDOW = 2000;

function todayFor(userTimeZone: string): CivilDate {
  return todayIn(userTimeZone);
}

async function userTimeZone(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } });
  return user?.timeZone ?? 'Europe/Lisbon';
}

/**
 * Verifica que um registo referenciado por uma despesa existe e pertence ao utilizador.
 *
 * `linkedRecordId` permite ligar uma despesa ao registo que a originou — um abastecimento,
 * um carregamento, uma manutenção, uma portagem. Sem esta verificação, uma conta podia
 * ligar uma despesa sua a um registo de outra conta e ficar com uma referência a dados que
 * não são seus — um identificador que a API usa depois para navegação reversa.
 *
 * O **tipo é derivado**, não aceite do cliente. A alternativa seria confiar num
 * `linkedRecordType` enviado no pedido, e um tipo errado faria a navegação reversa apontar
 * para o registo errado. Derivando-o do próprio registo, a despesa e o registo ficam
 * sempre coerentes por construção.
 */
const LINKABLE_RECORDS = ['fuelSession', 'chargingSession', 'maintenanceRecord', 'expense'] as const;

const RECORD_TYPE_OF: Record<(typeof LINKABLE_RECORDS)[number], string> = {
  fuelSession: 'fuel',
  chargingSession: 'charging',
  maintenanceRecord: 'maintenance',
  expense: 'expense',
};

async function resolveLinkedRecord(
  userId: string,
  linkedRecordId: string | null | undefined,
): Promise<{ type: string | null; id: string | null }> {
  if (!linkedRecordId) return { type: null, id: null };

  for (const model of LINKABLE_RECORDS) {
    const delegate = prisma[model] as unknown as {
      findFirst(args: { where: Record<string, unknown>; select: { id: true } }): Promise<{ id: string } | null>;
    };
    const found = await delegate.findFirst({ where: { id: linkedRecordId, userId }, select: { id: true } });
    if (found) return { type: RECORD_TYPE_OF[model], id: linkedRecordId };
  }

  // 404 e não 403: um identificador de outra conta é indistinguível de um inexistente (§30).
  throw notFound('Não encontrámos o registo a que queres ligar esta despesa.');
}

/* ========================================================================== */
/* DESPESAS (§12)                                                             */
/* ========================================================================== */

export async function createExpense(userId: string, input: ExpenseCreateRequest): Promise<ExpenseView> {
  const vehicleId = await resolveVehicleId(userId, input.vehicleId);
  const timeZone = await userTimeZone(userId);
  const date = input.date ?? todayFor(timeZone);
  assertNotFarFuture(date, todayFor(timeZone));

  // A ligação só é aceite se o registo referenciado for do próprio utilizador. O tipo
  // não vem no pedido: é derivado do registo, para que a despesa e o registo fiquem
  // sempre coerentes — um `linkedRecordType` errado faria a navegação reversa apontar
  // para o sítio errado.
  const linked = await resolveLinkedRecord(userId, input.linkedRecordId);

  try {
    const expense = await prisma.expense.create({
      data: {
        vehicleId,
        userId,
        amountCents: input.amountCents,
        vatCents: input.vatCents ?? null,
        category: input.category,
        date: civilToDate(date),
        vendor: input.vendor ?? null,
        odometerKm: input.odometerKm ?? null,
        description: input.description ?? null,
        paymentMethod: input.paymentMethod ?? null,
        paid: input.paid ?? true,
        linkedRecordType: linked.type,
        linkedRecordId: linked.id,
        notes: input.notes ?? null,
        source: writeJson(normalizeSource(input.source, 'manual')),
      },
    });

    await maybeAdvanceOdometer(userId, vehicleId, input.odometerKm ?? null, date, 'expense', expense.id);

    await recordEvent({
      vehicleId,
      userId,
      type: 'expense.created',
      date,
      title: optionLabel(EXPENSE_CATEGORIES, input.category),
      summary: input.description ?? input.vendor ?? null,
      amountCents: input.amountCents,
      odometerKm: input.odometerKm ?? null,
      recordType: 'expense',
      recordId: expense.id,
      source: normalizeSource(input.source, 'manual'),
    });

    return mapExpense(expense);
  } catch (error) {
    throw translatePrismaError(error, 'criar despesa');
  }
}

export async function listExpenses(userId: string, query: ListQuery): Promise<Page<ExpenseView>> {
  const where: Record<string, unknown> = { userId, ...cursorWhere(query.cursor) };
  if (query.vehicleId) where.vehicleId = query.vehicleId;
  if (query.category) where.category = query.category;
  if (query.from || query.to) {
    where.date = {
      ...(query.from ? { gte: civilToDate(query.from) } : {}),
      ...(query.to ? { lte: civilToDate(query.to) } : {}),
    };
  }

  const [rows, total] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    }),
    /*
     * A contagem usa **o mesmo `where`** que a consulta dos registos.
     *
     * Antes contava apenas por utilizador e veículo, ignorando a categoria e o intervalo
     * de datas. O resultado era `items: []` com `total: 59`, ou "Combustível · 59" ao lado
     * de uma lista com três itens — o número que o cliente mostra junto ao filtro estava
     * errado e, pior, podia convencê-lo de que ainda havia páginas por carregar.
     */
    prisma.expense.count({ where }),
  ]);

  const items = rows.map(mapExpense);
  return buildPage(items, query.limit, total);
}

export async function getExpense(userId: string, expenseId: string): Promise<ExpenseView> {
  const record = await requireRecord('expense', userId, expenseId);
  return mapExpense(record as Parameters<typeof mapExpense>[0]);
}

export async function updateExpense(
  userId: string,
  expenseId: string,
  input: ExpenseUpdateRequest,
): Promise<ExpenseView> {
  const existing = await requireRecord('expense', userId, expenseId);
  const vehicleId = existing.vehicleId as string;
  await requireVehicleAccess(userId, vehicleId);

  // A mesma guarda de data do POST. Um ano a mais numa data — `2099` em vez de `2026` —
  // que a criação recusa não deve poder entrar por uma edição: o registo ficaria em todas
  // as consultas de janelas futuras para sempre.
  const timeZone = await userTimeZone(userId);
  const today = todayFor(timeZone);
  if (input.date !== undefined) assertNotFarFuture(input.date, today);

  const data: Record<string, unknown> = {};
  if (input.amountCents !== undefined) data.amountCents = input.amountCents;
  if (input.category !== undefined) data.category = input.category;
  if (input.date !== undefined) data.date = civilToDate(input.date);
  if (input.vendor !== undefined) data.vendor = input.vendor;
  if (input.odometerKm !== undefined) data.odometerKm = input.odometerKm;
  if (input.description !== undefined) data.description = input.description;
  if (input.vatCents !== undefined) data.vatCents = input.vatCents;
  if (input.paymentMethod !== undefined) data.paymentMethod = input.paymentMethod;
  if (input.paid !== undefined) data.paid = input.paid;
  if (input.notes !== undefined) data.notes = input.notes;

  const updated = await prisma.expense.update({ where: { id: expenseId }, data });
  return mapExpense(updated);
}

export async function deleteExpense(userId: string, expenseId: string): Promise<void> {
  const existing = (await requireRecord('expense', userId, expenseId)) as {
    linkedRecordType: string | null;
    linkedRecordId: string | null;
  };

  await prisma.expense.delete({ where: { id: expenseId } });
  await removeEventsFor('expense', expenseId);

  /*
   * Limpar a referência inversa.
   *
   * Um abastecimento ou carregamento guarda o `expenseId` da despesa que gerou. Se a
   * despesa for apagada sozinha, essa referência passa a apontar para nada — e o defeito
   * não dá erro nenhum: só aparece quando alguém tenta seguir o identificador.
   *
   * A escolha é limpar a referência e **manter** o registo técnico, em vez de o apagar
   * também. O utilizador pediu para eliminar uma despesa, não o abastecimento; apagar
   * 58 litros de combustível do histórico do veículo porque o custo foi removido seria
   * uma surpresa destrutiva. O consumo e as estatísticas de utilização continuam
   * corretos, porque são calculados a partir dos registos e não das despesas.
   */
  if (existing.linkedRecordType === 'fuel' && existing.linkedRecordId) {
    await prisma.fuelSession.updateMany({
      where: { id: existing.linkedRecordId, userId },
      data: { expenseId: null },
    });
  }
  if (existing.linkedRecordType === 'charging' && existing.linkedRecordId) {
    await prisma.chargingSession.updateMany({
      where: { id: existing.linkedRecordId, userId },
      data: { expenseId: null },
    });
  }
  if (existing.linkedRecordType === 'maintenance' && existing.linkedRecordId) {
    await prisma.maintenanceRecord.updateMany({
      where: { id: existing.linkedRecordId, userId },
      data: { expenseId: null },
    });
  }
}

/* ========================================================================== */
/* ABASTECIMENTOS (§13)                                                       */
/* ========================================================================== */

export async function createFuelSession(
  userId: string,
  input: FuelCreateRequest,
): Promise<FuelView> {
  const vehicleId = await resolveVehicleId(userId, input.vehicleId);
  const vehicle = await requireVehicleAccess(userId, vehicleId);
  const timeZone = await userTimeZone(userId);
  const date = input.date ?? todayFor(timeZone);
  assertNotFarFuture(date, todayFor(timeZone));

  const priceCents = input.pricePerLitreCents ?? pricePerLitreCents(input.litres, input.amountCents);

  const session = await prisma.fuelSession.create({
    data: {
      vehicleId,
      userId,
      date: civilToDate(date),
      litres: input.litres,
      amountCents: input.amountCents,
      pricePerLitreCents: priceCents,
      odometerKm: input.odometerKm ?? null,
      fullTank: input.fullTank ?? true,
      station: input.station ?? null,
      // Preencher o combustível com o do veículo evita um campo obrigatório a mais (§44).
      fuelType: input.fuelType ?? (vehicle.fuelType as FuelType),
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      paymentMethod: input.paymentMethod ?? null,
      notes: input.notes ?? null,
      source: writeJson(normalizeSource(input.source, 'manual')),
    },
  });

  const expenseId = await createLinkedExpense({
    vehicleId,
    userId,
    amountCents: input.amountCents,
    date,
    category: 'fuel',
    vendor: input.station ?? null,
    odometerKm: input.odometerKm ?? null,
    description: `${input.litres.toFixed(2)} L`,
    linkedRecordType: 'fuel',
    linkedRecordId: session.id,
  });

  if (expenseId) {
    await prisma.fuelSession.update({ where: { id: session.id }, data: { expenseId } });
  }

  await maybeAdvanceOdometer(userId, vehicleId, input.odometerKm ?? null, date, 'fuel', session.id);

  await recordEvent({
    vehicleId,
    userId,
    type: 'fuel.created',
    date,
    title: 'Abastecimento',
    summary: `${input.litres.toFixed(2)} L${input.station ? ` · ${input.station}` : ''}`,
    amountCents: input.amountCents,
    odometerKm: input.odometerKm ?? null,
    recordType: 'fuel',
    recordId: session.id,
    source: normalizeSource(input.source, 'manual'),
  });

  // Devolvemos o registo pela mesma função de leitura para que o consumo do intervalo
  // venha já calculado. Um cliente que acabou de registar um abastecimento é
  // precisamente quem quer saber o consumo — devolver `null` aqui obrigaria a um
  // segundo pedido e faria a interface mostrar um vazio injustificado (§43).
  return getFuelSession(userId, session.id);
}

/**
 * Lista abastecimentos com as métricas derivadas.
 *
 * Nota sobre o desempenho: o consumo de um abastecimento depende do abastecimento
 * anterior, por isso o cálculo precisa da série cronológica completa — não é possível
 * calcular a página 3 sem conhecer a página 1. Carregamos a série do veículo (limitada
 * a `CONSUMPTION_WINDOW`) e paginamos em memória. Para um veículo pessoal com 15 anos
 * de registos isto são algumas centenas de linhas; se um dia forem dezenas de milhares,
 * a solução é materializar o consumo no momento da gravação, num campo próprio.
 */
export async function listFuelSessions(userId: string, query: ListQuery): Promise<Page<FuelView>> {
  // Sem veículo indicado, listamos os abastecimentos de todos os veículos do
  // utilizador: a vista "todos os registos" é útil e o filtro é opcional.
  const vehicleId = query.vehicleId
    ? await resolveVehicleId(userId, query.vehicleId)
    : null;

  const sessions = await prisma.fuelSession.findMany({
    where: { userId, ...(vehicleId ? { vehicleId } : {}) },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
    take: CONSUMPTION_WINDOW,
  });

  const entries: FuelEntryInput[] = sessions.map((session) => ({
    id: session.id,
    date: toCivilDate(session.date) as CivilDate,
    litres: session.litres,
    amountCents: session.amountCents,
    odometerKm: session.odometerKm,
    fullTank: session.fullTank,
    pricePerLitreCents: session.pricePerLitreCents,
  }));

  const derived = deriveFuelConsumption(entries);

  const mapped = sessions
    .map((session) => {
      const info = derived.get(session.id);
      return mapFuelSession(session, {
        costPerLitreCents: session.pricePerLitreCents,
        distanceSincePreviousKm: info?.distanceSincePreviousKm ?? null,
        consumptionL100Km: info?.consumptionPer100Km ?? null,
        costPer100KmCents: info?.costPer100KmCents ?? null,
      });
    })
    .filter((item) => inRange(item.date, query.from, query.to))
    .reverse();

  // `mapped` já está filtrado por `from`/`to`: a contagem é o seu tamanho, para que o
  // `total` corresponda sempre ao que a lista representa. Uma contagem vinda da base de
  // dados ignoraria esses filtros e mostraria um número que não corresponde a nada.
  const total = mapped.length;

  // A paginação por cursor da timeline não se aplica aqui porque a lista já está em
  // memória; usamos o mesmo contrato de resposta para manter o cliente uniforme.
  const startIndex = query.cursor ? findIndexAfterCursor(mapped, query.cursor) : 0;
  const slice = mapped.slice(startIndex, startIndex + query.limit + 1);
  return buildPage(slice, query.limit, total);
}

export async function getFuelSession(userId: string, sessionId: string): Promise<FuelView> {
  const record = await requireRecord('fuelSession', userId, sessionId);
  const session = record as Parameters<typeof mapFuelSession>[0];
  const vehicleId = session.vehicleId;

  const series = await prisma.fuelSession.findMany({
    where: { vehicleId },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
    take: CONSUMPTION_WINDOW,
  });

  const derived = deriveFuelConsumption(
    series.map((item) => ({
      id: item.id,
      date: toCivilDate(item.date) as CivilDate,
      litres: item.litres,
      amountCents: item.amountCents,
      odometerKm: item.odometerKm,
      fullTank: item.fullTank,
      pricePerLitreCents: item.pricePerLitreCents,
    })),
  );

  const info = derived.get(sessionId);
  return mapFuelSession(session, {
    costPerLitreCents: session.pricePerLitreCents,
    distanceSincePreviousKm: info?.distanceSincePreviousKm ?? null,
    consumptionL100Km: info?.consumptionPer100Km ?? null,
    costPer100KmCents: info?.costPer100KmCents ?? null,
  });
}

export async function updateFuelSession(
  userId: string,
  sessionId: string,
  input: FuelUpdateRequest,
): Promise<FuelView> {
  const existing = await requireRecord('fuelSession', userId, sessionId);
  const current = existing as { expenseId: string | null; litres: number; amountCents: number };

  const data: Record<string, unknown> = {};
  if (input.date !== undefined) data.date = civilToDate(input.date);
  if (input.litres !== undefined) data.litres = input.litres;
  if (input.amountCents !== undefined) data.amountCents = input.amountCents;
  if (input.odometerKm !== undefined) data.odometerKm = input.odometerKm;
  if (input.fullTank !== undefined) data.fullTank = input.fullTank;
  if (input.station !== undefined) data.station = input.station;
  if (input.fuelType !== undefined) data.fuelType = input.fuelType;
  if (input.notes !== undefined) data.notes = input.notes;

  const litres = input.litres ?? current.litres;
  const amountCents = input.amountCents ?? current.amountCents;
  if (input.pricePerLitreCents !== undefined) {
    data.pricePerLitreCents = input.pricePerLitreCents;
  } else if (input.litres !== undefined || input.amountCents !== undefined) {
    data.pricePerLitreCents = pricePerLitreCents(litres, amountCents);
  }

  await prisma.fuelSession.update({ where: { id: sessionId }, data });

  await updateLinkedExpense(current.expenseId, {
    amountCents: input.amountCents,
    date: input.date,
    odometerKm: input.odometerKm,
    vendor: input.station,
  });

  // Devolvemos o registo através de `getFuelSession` para que as métricas derivadas
  // (consumo do intervalo, custo/100 km) venham já calculadas — o cliente não deve ter
  // de voltar a pedir o registo depois de o editar.
  return getFuelSession(userId, sessionId);
}

export async function deleteFuelSession(userId: string, sessionId: string): Promise<void> {
  const existing = await requireRecord('fuelSession', userId, sessionId);
  const current = existing as { expenseId: string | null };
  await deleteLinkedExpense(current.expenseId);
  await prisma.fuelSession.delete({ where: { id: sessionId } });
  await removeEventsFor('fuel', sessionId);
}

/* ========================================================================== */
/* CARREGAMENTOS (§14)                                                        */
/* ========================================================================== */

export async function createChargingSession(
  userId: string,
  input: ChargingCreateRequest,
): Promise<ChargingView> {
  const vehicleId = await resolveVehicleId(userId, input.vehicleId);
  const timeZone = await userTimeZone(userId);
  const date = input.date ?? todayFor(timeZone);
  assertNotFarFuture(date, todayFor(timeZone));

  const startSoc = normalizeSoc(input.startSocPercent);
  const endSoc = normalizeSoc(input.endSocPercent);
  const priceCents = pricePerKwhCents(input.energyKwh, input.amountCents);

  const session = await prisma.chargingSession.create({
    data: {
      vehicleId,
      userId,
      date: civilToDate(date),
      energyKwh: input.energyKwh,
      amountCents: input.amountCents,
      pricePerKwhCents: priceCents,
      odometerKm: input.odometerKm ?? null,
      location: input.location ?? null,
      charger: input.charger ?? null,
      durationMinutes: input.durationMinutes ?? null,
      startSocPercent: startSoc,
      endSocPercent: endSoc,
      powerKw: input.powerKw ?? null,
      provider: input.provider ?? null,
      tariff: input.tariff ?? null,
      isPublic: input.isPublic ?? null,
      isHome: input.isHome ?? null,
      notes: input.notes ?? null,
      source: writeJson(normalizeSource(input.source, 'manual')),
    },
  });

  const expenseId = await createLinkedExpense({
    vehicleId,
    userId,
    amountCents: input.amountCents,
    date,
    category: 'charging',
    vendor: input.provider ?? input.location ?? null,
    odometerKm: input.odometerKm ?? null,
    description: `${input.energyKwh.toFixed(2)} kWh`,
    linkedRecordType: 'charging',
    linkedRecordId: session.id,
  });

  if (expenseId) {
    await prisma.chargingSession.update({ where: { id: session.id }, data: { expenseId } });
  }

  await maybeAdvanceOdometer(userId, vehicleId, input.odometerKm ?? null, date, 'charging', session.id);

  await recordEvent({
    vehicleId,
    userId,
    type: 'charging.created',
    date,
    title: 'Carregamento',
    summary: `${input.energyKwh.toFixed(2)} kWh${input.location ? ` · ${input.location}` : ''}`,
    amountCents: input.amountCents,
    odometerKm: input.odometerKm ?? null,
    recordType: 'charging',
    recordId: session.id,
    source: normalizeSource(input.source, 'manual'),
  });

  // Igual ao abastecimento: o consumo do intervalo é devolvido já calculado.
  return getChargingSession(userId, session.id);
}

export async function listChargingSessions(
  userId: string,
  query: ListQuery,
): Promise<Page<ChargingView>> {
  const vehicleId = query.vehicleId
    ? await resolveVehicleId(userId, query.vehicleId)
    : null;

  const sessions = await prisma.chargingSession.findMany({
    where: { userId, ...(vehicleId ? { vehicleId } : {}) },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
    take: CONSUMPTION_WINDOW,
  });

  const derived = deriveChargingConsumption(
    sessions.map((session) => ({
      id: session.id,
      date: toCivilDate(session.date) as CivilDate,
      energyKwh: session.energyKwh,
      amountCents: session.amountCents,
      odometerKm: session.odometerKm,
      pricePerKwhCents: session.pricePerKwhCents,
    })),
  );

  const mapped = sessions
    .map((session) => {
      const info = derived.get(session.id);
      return mapChargingSession(session, {
        averagePowerKw: averagePower(session.energyKwh, session.durationMinutes),
        addedSocPercent:
          session.startSocPercent !== null && session.endSocPercent !== null
            ? Math.round((session.endSocPercent - session.startSocPercent) * 10) / 10
            : null,
        distanceSincePreviousKm: info?.distanceSincePreviousKm ?? null,
        consumptionKwh100Km: info?.consumptionPer100Km ?? null,
        costPer100KmCents: info?.costPer100KmCents ?? null,
      });
    })
    .filter((item) => inRange(item.date, query.from, query.to))
    .reverse();

  // `mapped` já está filtrado por `from`/`to`: ver a nota equivalente em `listFuelSessions`.
  const total = mapped.length;

  const startIndex = query.cursor ? findIndexAfterCursor(mapped, query.cursor) : 0;
  const slice = mapped.slice(startIndex, startIndex + query.limit + 1);
  return buildPage(slice, query.limit, total);
}

export async function getChargingSession(userId: string, sessionId: string): Promise<ChargingView> {
  const record = await requireRecord('chargingSession', userId, sessionId);
  const session = record as Parameters<typeof mapChargingSession>[0];

  const series = await prisma.chargingSession.findMany({
    where: { vehicleId: session.vehicleId },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
    take: CONSUMPTION_WINDOW,
  });

  const derived = deriveChargingConsumption(
    series.map((item) => ({
      id: item.id,
      date: toCivilDate(item.date) as CivilDate,
      energyKwh: item.energyKwh,
      amountCents: item.amountCents,
      odometerKm: item.odometerKm,
      pricePerKwhCents: item.pricePerKwhCents,
    })),
  );

  const info = derived.get(sessionId);
  return mapChargingSession(session, {
    averagePowerKw: averagePower(session.energyKwh, session.durationMinutes),
    addedSocPercent:
      session.startSocPercent !== null && session.endSocPercent !== null
        ? Math.round((session.endSocPercent - session.startSocPercent) * 10) / 10
        : null,
    distanceSincePreviousKm: info?.distanceSincePreviousKm ?? null,
    consumptionKwh100Km: info?.consumptionPer100Km ?? null,
    costPer100KmCents: info?.costPer100KmCents ?? null,
  });
}

export async function updateChargingSession(
  userId: string,
  sessionId: string,
  input: ChargingUpdateRequest,
): Promise<ChargingView> {
  const existing = await requireRecord('chargingSession', userId, sessionId);
  const current = existing as { expenseId: string | null; energyKwh: number; amountCents: number };

  const data: Record<string, unknown> = {};
  if (input.date !== undefined) data.date = civilToDate(input.date);
  if (input.energyKwh !== undefined) data.energyKwh = input.energyKwh;
  if (input.amountCents !== undefined) data.amountCents = input.amountCents;
  if (input.odometerKm !== undefined) data.odometerKm = input.odometerKm;
  if (input.location !== undefined) data.location = input.location;
  if (input.charger !== undefined) data.charger = input.charger;
  if (input.durationMinutes !== undefined) data.durationMinutes = input.durationMinutes;
  if (input.startSocPercent !== undefined) data.startSocPercent = normalizeSoc(input.startSocPercent);
  if (input.endSocPercent !== undefined) data.endSocPercent = normalizeSoc(input.endSocPercent);
  if (input.powerKw !== undefined) data.powerKw = input.powerKw;
  if (input.notes !== undefined) data.notes = input.notes;

  const energyKwh = input.energyKwh ?? current.energyKwh;
  const amountCents = input.amountCents ?? current.amountCents;
  if (input.energyKwh !== undefined || input.amountCents !== undefined) {
    data.pricePerKwhCents = pricePerKwhCents(energyKwh, amountCents);
  }

  await prisma.chargingSession.update({ where: { id: sessionId }, data });

  await updateLinkedExpense(current.expenseId, {
    amountCents: input.amountCents,
    date: input.date,
    odometerKm: input.odometerKm,
    vendor: input.location,
  });

  /*
   * Devolver o registo através de `getChargingSession` para que as métricas derivadas —
   * consumo do intervalo, custo por 100 km, potência média e energia adicionada à bateria —
   * venham já calculadas. O cliente não deve ter de voltar a pedir o registo depois de o
   * editar, e muito menos receber zeros: era o que acontecia antes, com
   * `mapChargingSession(updated, zeroChargingDerived())`, que devolvia as cinco derivadas a
   * `null` enquanto a leitura seguinte as trazia preenchidas. Mesmo padrão de
   * `updateFuelSession`, que já delega em `getFuelSession`.
   */
  return getChargingSession(userId, sessionId);
}

export async function deleteChargingSession(userId: string, sessionId: string): Promise<void> {
  const existing = await requireRecord('chargingSession', userId, sessionId);
  await deleteLinkedExpense((existing as { expenseId: string | null }).expenseId);
  await prisma.chargingSession.delete({ where: { id: sessionId } });
  await removeEventsFor('charging', sessionId);
}

/* ========================================================================== */
/* Auxiliares                                                                 */
/* ========================================================================== */

/**
 * Avança a quilometragem do veículo quando um registo traz um valor superior.
 *
 * Um abastecimento com quilometragem é informação nova sobre o veículo; pedir ao
 * utilizador para a introduzir outra vez noutro ecrã é exatamente o tipo de trabalho
 * duplicado que o Zemlo existe para eliminar (§3.3).
 *
 * **O valor passa pelo mesmo guarda de plausibilidade que uma leitura explícita (§11).**
 * Sem isto havia uma porta lateral: introduzir `900000` no campo de quilometragem de uma
 * despesa era aceite sem aviso e passava a ser a quilometragem do veículo. Como tudo o que
 * é calculado a partir daí — distância, custo por km, km/mês, a data projetada de cada
 * lembrete por distância, a depreciação — ficaria assente nesse número, um dígito a mais
 * tornava o custo por km 12× mais baixo e empurrava a próxima revisão para anos depois.
 * A aplicação diria que estava tudo bem enquanto o carro estava em atraso.
 *
 * A diferença em relação ao endpoint dedicado é o que acontece quando o valor não é
 * plausível: aqui **não se rejeita o registo**. O utilizador está a registar uma despesa,
 * e recusá-la por causa de um campo auxiliar seria hostil. Em vez disso, a despesa é
 * gravada e a quilometragem do veículo **não avança** — o número duvidoso não contamina
 * os cálculos, e o utilizador corrige-o quando quiser, no ecrã próprio, onde receberá o
 * aviso.
 */
async function maybeAdvanceOdometer(
  userId: string,
  vehicleId: string,
  odometerKm: number | null,
  date: CivilDate,
  origin: string,
  originRecordId: string,
): Promise<void> {
  if (odometerKm === null) return;

  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: { odometerKm: true, odometerUpdatedAt: true },
  });
  if (!vehicle) return;
  if (vehicle.odometerKm !== null && odometerKm <= vehicle.odometerKm) return;

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
      recordedAt: toCivilDate(vehicle.odometerUpdatedAt) ?? todayFor(timeZone),
    },
    historicalMaxKm: highest._max.odometerKm ?? null,
    userConfirmed: false,
  });

  if (guard.requiresConfirmation) {
    // Registo da leitura com a nota de que não foi tida em conta, para que o histórico
    // mostre o que aconteceu em vez de esconder o valor.
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

/**
 * Normaliza o estado de carga.
 *
 * O contrato fixa uma única unidade — percentagem 0–100 (`contracts.ts`) — precisamente
 * porque aceitar também a fração 0–1 tornava `0.5` irrecuperavelmente ambíguo. Aqui
 * arredonda-se a uma casa e recusa-se o que está fora do intervalo, em vez de adivinhar.
 */
function normalizeSoc(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return Math.round(value * 10) / 10;
}

function averagePower(energyKwh: number, durationMinutes: number | null): number | null {
  if (durationMinutes === null || durationMinutes <= 0) return null;
  return Math.round((energyKwh / (durationMinutes / 60)) * 100) / 100;
}

function inRange(date: CivilDate, from: CivilDate | undefined, to: CivilDate | undefined): boolean {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function findIndexAfterCursor(items: Array<{ date: CivilDate; id: string }>, cursor: string): number {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { d?: string; i?: string };
    if (typeof parsed.d !== 'string' || typeof parsed.i !== 'string') return 0;
    const index = items.findIndex((item) => item.date === parsed.d && item.id === parsed.i);
    return index === -1 ? 0 : index + 1;
  } catch {
    return 0;
  }
}
