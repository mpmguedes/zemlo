/**
 * Exportação de dados (§54).
 *
 * Princípio: o utilizador não fica preso ao Zemlo. Consequência prática: a exportação
 * é uma funcionalidade da primeira versão, não um item de roadmap — quem não consegue
 * sair não confia o suficiente para entrar (§31).
 *
 * Dois formatos, com propósitos diferentes:
 *  - **JSON**: a cópia fiel e completa, pensada para reimportação e para o utilizador
 *    técnico. Inclui todos os campos, incluindo identificadores e origem dos dados.
 *  - **CSV**: uma tabela por tipo de registo, para abrir em qualquer folha de cálculo.
 *    Valores já convertidos para unidades legíveis (euros, quilómetros), com o
 *    separador `;` e a vírgula decimal, que é o que o Excel em português espera.
 */

import type { CivilDate, ExportQuery } from '@zemlo/shared';
import { fromCents, formatNumber, optionLabel, EXPENSE_CATEGORIES, MAINTENANCE_TYPES, FUEL_TYPES, DOCUMENT_CATEGORIES } from '@zemlo/shared';
import { prisma } from '../core/db.js';
import { readJsonObject } from '../core/json.js';
import { toCivilDate } from '../domain/payload.js';
import { audit } from './audit.js';

/* -------------------------------------------------------------------------- */
/* Estrutura da exportação                                                     */
/* -------------------------------------------------------------------------- */

export interface ExportBundle {
  meta: {
    product: 'Zemlo';
    version: string;
    exportedAt: string;
    /** Versão do formato, para que um importador futuro saiba o que esperar. */
    formatVersion: 1;
    scope: {
      vehicleId: string | null;
      from: CivilDate | null;
      to: CivilDate | null;
    };
    /** Nota metodológica apresentada ao utilizador, no tom da marca (§59). */
    notes: string[];
  };
  account: Record<string, unknown>;
  vehicles: Array<Record<string, unknown>>;
  expenses: Array<Record<string, unknown>>;
  fuelSessions: Array<Record<string, unknown>>;
  chargingSessions: Array<Record<string, unknown>>;
  maintenance: Array<Record<string, unknown>>;
  insurancePolicies: Array<Record<string, unknown>>;
  inspections: Array<Record<string, unknown>>;
  taxes: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
  reminders: Array<Record<string, unknown>>;
  odometerReadings: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
}

/* -------------------------------------------------------------------------- */
/* Recolha                                                                     */
/* -------------------------------------------------------------------------- */

export async function buildExportBundle(
  userId: string,
  query: ExportQuery,
): Promise<ExportBundle> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('Conta não encontrada.');

  const vehicles = await prisma.vehicle.findMany({
    where: { userId, ...(query.vehicleId ? { id: query.vehicleId } : {}) },
    include: { odometerReadings: true },
  });
  const vehicleIds = vehicles.map((vehicle) => vehicle.id);

  const dateFilter =
    query.from || query.to
      ? {
          date: {
            ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
            ...(query.to ? { lte: new Date(`${query.to}T00:00:00.000Z`) } : {}),
          },
        }
      : {};

  const vehicleFilter = { vehicleId: { in: vehicleIds } };

  const [
    expenses,
    fuelSessions,
    chargingSessions,
    maintenance,
    insurancePolicies,
    inspections,
    taxes,
    reminders,
    events,
  ] = await Promise.all([
    prisma.expense.findMany({ where: { ...vehicleFilter, ...dateFilter }, orderBy: { date: 'asc' } }),
    prisma.fuelSession.findMany({ where: { ...vehicleFilter, ...dateFilter }, orderBy: { date: 'asc' } }),
    prisma.chargingSession.findMany({ where: { ...vehicleFilter, ...dateFilter }, orderBy: { date: 'asc' } }),
    prisma.maintenanceRecord.findMany({ where: { ...vehicleFilter, ...dateFilter }, orderBy: { date: 'asc' } }),
    prisma.insurancePolicy.findMany({ where: vehicleFilter, orderBy: { startDate: 'asc' } }),
    prisma.inspectionRecord.findMany({ where: { ...vehicleFilter, ...dateFilter }, orderBy: { date: 'asc' } }),
    prisma.taxRecord.findMany({ where: vehicleFilter, orderBy: { year: 'asc' } }),
    prisma.reminder.findMany({ where: vehicleFilter, orderBy: { createdAt: 'asc' } }),
    prisma.vehicleEvent.findMany({ where: vehicleFilter, orderBy: { date: 'asc' }, take: 50_000 }),
  ]);

  const documents = await prisma.document.findMany({
    where: { userId, ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}) },
    orderBy: { createdAt: 'asc' },
  });

  await audit('user.exported_data', {
    userId,
    entityType: 'user',
    entityId: userId,
    metadata: { formato: query.format, veiculos: vehicles.length, registos: expenses.length + fuelSessions.length },
  });

  return {
    meta: {
      product: 'Zemlo',
      version: '0.1.0',
      exportedAt: new Date().toISOString(),
      formatVersion: 1,
      scope: {
        vehicleId: query.vehicleId ?? null,
        from: query.from ?? null,
        to: query.to ?? null,
      },
      notes: [
        'Os valores monetários estão em cêntimos inteiros, para evitar erros de arredondamento. Para obter euros, divide por 100.',
        'As datas civis (data de uma despesa, validade de um documento) estão no formato AAAA-MM-DD. Os instantes de criação estão em ISO 8601 UTC.',
        'O campo `source` indica a origem de cada dado: manual, API, OBD, importação ou documento.',
      ],
    },
    account: {
      id: user.id,
      email: user.email,
      name: user.name,
      locale: user.locale,
      timeZone: user.timeZone,
      distanceUnit: user.distanceUnit,
      volumeUnit: user.volumeUnit,
      currency: user.currency,
      emailVerified: user.emailVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt: user.createdAt.toISOString(),
    },
    vehicles: vehicles.map((vehicle) => ({
      ...vehicle,
      odometerReadings: undefined,
      odometerSource: readJsonObject(vehicle.odometerSource),
      odometerUpdatedAt: vehicle.odometerUpdatedAt?.toISOString() ?? null,
      createdAt: vehicle.createdAt.toISOString(),
      updatedAt: vehicle.updatedAt.toISOString(),
      archivedAt: vehicle.archivedAt?.toISOString() ?? null,
    })),
    expenses: expenses.map((row) => ({
      ...row,
      date: toCivilDate(row.date),
      source: readJsonObject(row.source),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    fuelSessions: fuelSessions.map((row) => ({
      ...row,
      date: toCivilDate(row.date),
      source: readJsonObject(row.source),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    chargingSessions: chargingSessions.map((row) => ({
      ...row,
      date: toCivilDate(row.date),
      source: readJsonObject(row.source),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    maintenance: maintenance.map((row) => ({
      ...row,
      date: toCivilDate(row.date),
      nextDueDate: toCivilDate(row.nextDueDate),
      source: readJsonObject(row.source),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    insurancePolicies: insurancePolicies.map((row) => ({
      ...row,
      startDate: toCivilDate(row.startDate),
      endDate: toCivilDate(row.endDate),
      source: readJsonObject(row.source),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    inspections: inspections.map((row) => ({
      ...row,
      date: toCivilDate(row.date),
      nextDueDate: toCivilDate(row.nextDueDate),
      source: readJsonObject(row.source),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    taxes: taxes.map((row) => ({
      ...row,
      date: toCivilDate(row.date),
      dueDate: toCivilDate(row.dueDate),
      source: readJsonObject(row.source),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    documents: documents.map((row) => ({
      ...row,
      date: toCivilDate(row.date),
      expiresAt: toCivilDate(row.expiresAt),
      source: readJsonObject(row.source),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    reminders: reminders.map((row) => ({
      ...row,
      dueDate: toCivilDate(row.dueDate),
      completedAt: row.completedAt?.toISOString() ?? null,
      source: readJsonObject(row.source),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    odometerReadings: vehicles.flatMap((vehicle) =>
      vehicle.odometerReadings.map((row) => ({
        id: row.id,
        vehicleId: row.vehicleId,
        odometerKm: row.odometerKm,
        recordedAt: toCivilDate(row.recordedAt),
        origin: row.origin,
        isCorrection: row.isCorrection,
        source: readJsonObject(row.source),
        notes: row.notes,
        createdAt: row.createdAt.toISOString(),
      })),
    ),
    events: events.map((row) => ({
      id: row.id,
      vehicleId: row.vehicleId,
      type: row.type,
      date: toCivilDate(row.date),
      title: row.title,
      summary: row.summary,
      amountCents: row.amountCents,
      odometerKm: row.odometerKm,
      recordType: row.recordType,
      recordId: row.recordId,
      source: readJsonObject(row.source),
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Gera um CSV com uma secção por tipo de registo.
 *
 * Escolhas que valem a pena explicar:
 *  - separador `;` e vírgula decimal: é o que o Excel em português assume por omissão.
 *    Com `,` como separador, o Excel PT trata cada linha como uma única célula.
 *  - BOM UTF-8 no início: sem ele, o Excel mostra acentos corrompidos, e "Combustível"
 *    aparece como "CombustÃ­vel". É um detalhe pequeno que decide se o utilizador
 *    considera a exportação utilizável.
 *  - valores já em euros e quilómetros: uma exportação que exige dividir tudo por 100
 *    é uma exportação que ninguém usa.
 */
export function bundleToCsv(bundle: ExportBundle): string {
  const sections: string[] = [];

  sections.push(
    section('veiculos', bundle.vehicles, [
      ['id', 'ID'],
      ['plateDisplay', 'Matrícula'],
      ['make', 'Marca'],
      ['model', 'Modelo'],
      ['version', 'Versão'],
      ['year', 'Ano'],
      ['fuelType', 'Combustível'],
      ['odometerKm', 'Quilometragem'],
      ['vin', 'VIN'],
      ['purchaseDate', 'Data de compra'],
      ['purchasePriceCents', 'Preço de compra (€)', (value) => centsToEuro(value)],
      ['notes', 'Notas'],
      ['createdAt', 'Criado em'],
    ]),
  );

  sections.push(
    section(
      'despesas',
      bundle.expenses,
      [
        ['vehicleId', 'Veículo'],
        ['date', 'Data'],
        ['category', 'Categoria', (value) => (typeof value === 'string' ? optionLabel(EXPENSE_CATEGORIES, value) : '')],
        ['amountCents', 'Valor (€)', (value) => centsToEuro(value)],
        ['vatCents', 'IVA (€)', (value) => centsToEuro(value)],
        ['odometerKm', 'Quilometragem'],
        ['vendor', 'Fornecedor'],
        ['description', 'Descrição'],
        ['paymentMethod', 'Pagamento'],
        ['paid', 'Pago'],
        ['notes', 'Notas'],
      ],
    ),
  );

  sections.push(
    section(
      'abastecimentos',
      bundle.fuelSessions,
      [
        ['vehicleId', 'Veículo'],
        ['date', 'Data'],
        ['litres', 'Litros', (value) => number(value, 3)],
        ['amountCents', 'Valor (€)', (value) => centsToEuro(value)],
        ['pricePerLitreCents', 'Preço/litro (€)', (value) => centsToEuro(value, 3)],
        ['odometerKm', 'Quilometragem'],
        ['fullTank', 'Depósito cheio'],
        ['station', 'Posto'],
        ['fuelType', 'Combustível', (value) => (typeof value === 'string' ? optionLabel(FUEL_TYPES, value) : '')],
        ['notes', 'Notas'],
      ],
    ),
  );

  sections.push(
    section(
      'carregamentos',
      bundle.chargingSessions,
      [
        ['vehicleId', 'Veículo'],
        ['date', 'Data'],
        ['energyKwh', 'Energia (kWh)', (value) => number(value, 3)],
        ['amountCents', 'Valor (€)', (value) => centsToEuro(value)],
        ['pricePerKwhCents', 'Preço/kWh (€)', (value) => centsToEuro(value, 3)],
        ['odometerKm', 'Quilometragem'],
        ['location', 'Local'],
        ['durationMinutes', 'Duração (min)'],
        ['startSocPercent', 'SOC inicial (%)'],
        ['endSocPercent', 'SOC final (%)'],
        ['notes', 'Notas'],
      ],
    ),
  );

  sections.push(
    section(
      'manutencao',
      bundle.maintenance,
      [
        ['vehicleId', 'Veículo'],
        ['date', 'Data'],
        ['type', 'Tipo', (value) => (typeof value === 'string' ? optionLabel(MAINTENANCE_TYPES, value) : '')],
        ['odometerKm', 'Quilometragem'],
        ['amountCents', 'Valor (€)', (value) => centsToEuro(value)],
        ['workshop', 'Oficina'],
        ['description', 'Descrição'],
        ['nextDueDate', 'Próxima data'],
        ['nextDueOdometerKm', 'Próxima quilometragem'],
      ],
    ),
  );

  sections.push(
    section('seguros', bundle.insurancePolicies, [
      ['vehicleId', 'Veículo'],
      ['insurer', 'Seguradora'],
      ['policyNumber', 'Apólice'],
      ['startDate', 'Início'],
      ['endDate', 'Fim'],
      ['premiumCents', 'Prémio (€)', (value) => centsToEuro(value)],
      ['coverage', 'Cobertura'],
    ]),
  );

  sections.push(
    section('inspecoes', bundle.inspections, [
      ['vehicleId', 'Veículo'],
      ['date', 'Data'],
      ['result', 'Resultado'],
      ['odometerKm', 'Quilometragem'],
      ['amountCents', 'Valor (€)', (value) => centsToEuro(value)],
      ['nextDueDate', 'Próxima inspeção'],
      ['station', 'Centro'],
      ['defects', 'Deficiências'],
    ]),
  );

  sections.push(
    section('impostos', bundle.taxes, [
      ['vehicleId', 'Veículo'],
      ['kind', 'Tipo'],
      ['year', 'Ano'],
      ['amountCents', 'Valor (€)', (value) => centsToEuro(value)],
      ['date', 'Data de pagamento'],
      ['dueDate', 'Data limite'],
      ['paid', 'Pago'],
    ]),
  );

  sections.push(
    section(
      'documentos',
      bundle.documents,
      [
        ['vehicleId', 'Veículo'],
        ['name', 'Nome'],
        ['category', 'Categoria', (value) => (typeof value === 'string' ? optionLabel(DOCUMENT_CATEGORIES, value) : '')],
        ['date', 'Data'],
        ['expiresAt', 'Validade'],
        ['fileName', 'Ficheiro'],
        ['notes', 'Notas'],
      ],
    ),
  );

  sections.push(
    section('lembretes', bundle.reminders, [
      ['vehicleId', 'Veículo'],
      ['title', 'Título'],
      ['trigger', 'Condição'],
      ['dueDate', 'Data'],
      ['dueOdometerKm', 'Quilometragem'],
      ['repeat', 'Repetir'],
      ['completedAt', 'Concluído em'],
    ]),
  );

  sections.push(
    section('quilometragem', bundle.odometerReadings, [
      ['vehicleId', 'Veículo'],
      ['recordedAt', 'Data'],
      ['odometerKm', 'Quilometragem'],
      ['origin', 'Origem'],
      ['isCorrection', 'Correção'],
      ['notes', 'Notas'],
    ]),
  );

  return `\uFEFF${sections.join('\r\n\r\n')}`;
}

type ColumnSpec = [key: string, header: string, transform?: (value: unknown) => string];

function section(title: string, rows: ReadonlyArray<Record<string, unknown>>, columns: ColumnSpec[]): string {
  const header = `# ${title}`;
  const columnHeaders = columns.map(([, label]) => escapeCsv(label)).join(';');
  const lines = rows.map((row) =>
    columns
      .map(([key, , transform]) => {
        const value = row[key];
        return escapeCsv(transform ? transform(value) : stringify(value));
      })
      .join(';'),
  );
  return [header, columnHeaders, ...lines].join('\r\n');
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Célula CSV: aspas duplicadas e proteção contra injeção de fórmulas. */
function escapeCsv(value: string): string {
  // Uma célula que começa por =, +, - ou @ é interpretada como fórmula pelo Excel.
  // Prefixar com um apóstrofo é a mitigação padrão e evita que uma exportação do
  // Zemlo se torne vetor de execução numa folha de cálculo de terceiros.
  const dangerous = /^[=+\-@\t\r]/.test(value);
  const safe = dangerous ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function centsToEuro(value: unknown, decimals = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return formatNumber(fromCents(value), decimals);
}

function number(value: unknown, decimals: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return formatNumber(value, decimals);
}

/** Nome do ficheiro de exportação, com data, para a transferência ser identificável. */
export function exportFileName(format: 'json' | 'csv', today: CivilDate): string {
  return `zemlo-export-${today}.${format}`;
}
