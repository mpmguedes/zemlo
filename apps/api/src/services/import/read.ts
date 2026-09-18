/**
 * Leitura e pré-visualização de uma importação (§7.1, fases `triage` → `review`).
 *
 * ## O que este ficheiro é, e o que não é
 *
 * É a camada de **orquestração** da cadeia da §4.1. Não decide regras de domínio — essas
 * vivem no `domain/import/` — e não escreve numa base de dados. O seu trabalho é ligar os
 * elos na ordem certa e reunir o estado da conta que a deduplicação precisa:
 *
 * ```
 *   ZIP → indexBundleEntries → readBundle → normalizeRecords → validateRecords
 *       → (estado da conta) → buildPlan
 * ```
 *
 * Cada um destes passos já existe e está testado. O `read.ts` é o único sítio que os
 * **conhece a todos**, e é isso que impede que cada consumidor invente a sua própria
 * sequência — que foi como o contrato entre o Parser e o Validator passou despercebido
 * até ao A27.
 *
 * ## Nada é escrito aqui
 *
 * A §7.1 é explícita: "Nenhuma escrita acontece antes da fase `apply`". Este ficheiro
 * não tem uma única chamada de escrita ao Prisma, e é assim que a propriedade se mantém
 * verdadeira por construção em vez de por disciplina. Um teste verifica-o comparando um
 * instantâneo completo da base de dados antes e depois (ver
 * `import-apply-preview.test.ts`).
 *
 * ## O `userId` vem sempre de fora
 *
 * Nunca do bundle. O bundle não tem — nem pode ter — um campo de utilizador: um bundle
 * com `"userId"` seria uma tentativa de importar para outra conta, e a chave inclui o
 * `userId` exactamente para que isso não funcione (§9.5, §7.3). Quem chama este serviço
 * passa o identificador autenticado, tal como o `requireUser` da camada HTTP o extrai da
 * sessão (A24).
 */

import type { PrismaClient } from '../../core/db.js';

import {
  readBundle,
  type BundleReadResult,
  type BundleReadOptions,
} from '../../domain/import/bundle.js';
import { normalizeRecords } from '../../domain/import/normalize-records.js';
import { normalizePlateForCompare } from '../../domain/import/normalize.js';
import { validateRecords, type CanonicalRecord } from '../../domain/import/validate.js';
import {
  buildPlan,
  dedupeKeysFor,
  type ConflictPolicy,
  type ExistingAccountState,
  type ExistingRecord,
  type ImportPlan,
} from '../../domain/import/plan.js';
import type { ZipReadResult } from '../../domain/import/zip.js';
import { readImportedLocalIds } from './book.js';

/* -------------------------------------------------------------------------- */
/* Contrato                                                                    */
/* -------------------------------------------------------------------------- */

export interface PreviewImportOptions {
  /** Resultado do leitor ZIP, já validado (§4.1, Parser). */
  readonly zip: ZipReadResult;
  /** Utilizador autenticado. **Nunca** vem do bundle. */
  readonly userId: string;
  readonly prisma: PrismaClient;
  /** Limites do bundle. Só podem ser apertados, nunca alargados (§`resolveBundleLimits`). */
  readonly limits?: BundleReadOptions;
  /** Política de conflito (decisão 8). Por omissão `fill-empty`. */
  readonly conflictPolicy?: ConflictPolicy;
}

/** O que o ecrã de revisão recebe: o plano e o bundle que o originou. */
export interface ImportPreview {
  readonly plan: ImportPlan;
  readonly bundle: BundleReadResult;
  /**
   * Os registos canónicos, guardados para o `apply` não ter de repetir a cadeia.
   *
   * É isto que faz o plano ser **auditável**: o que o utilizador viu é exactamente o que
   * é aplicado, porque o `apply` recebe os mesmos registos e não os reconstrói a partir do
   * ZIP. Reconstruí-los abriria a porta a uma divergência entre o que foi mostrado e o
   * que foi escrito — a única falha que a §11.3 não perdoa.
   */
  readonly records: readonly CanonicalRecord[];
}

/* -------------------------------------------------------------------------- */
/* Estado da conta — o que a deduplicação precisa de saber                     */
/* -------------------------------------------------------------------------- */

/*
 * Sete consultas, todas limitadas ao utilizador. A forma de cada uma é ditada pelo que o
 * `ExistingRecord` exige: `keys` (as chaves de deduplicação do registo existente),
 * `filledFields` (o que já está preenchido) e `filledValues` (o valor, para distinguir
 * "preenchido com o mesmo" de "preenchido com outro").
 *
 * Sem `filledValues`, um campo preenchido dos dois lados com o mesmo valor seria reportado
 * como conflito — e um falso conflito em cada importação de rotina ensinaria o utilizador
 * a ignorar os avisos, que é o pior resultado possível para um mecanismo que existe para
 * chamar a atenção.
 *
 * ## Porque é que os valores vêm normalizados
 *
 * As chaves e os valores são comparados com os do bundle, e o bundle já vem normalizado
 * pelo Normalizer. Comparar uma matrícula normalizada com uma não normalizada seria
 * comparar coisas diferentes e não coincidiria — ou coincidiria por acidente.
 */

/**
 * Campos que, estando preenchidos, podem ser enriquecidos a partir do bundle (decisão 8).
 *
 * Não é uma lista de todos os campos: só os que fazem sentido receber de um bundle. Um
 * campo operacional — `odometerUpdatedAt`, `updatedAt`, `archivedAt` — não é um dado do
 * utilizador e não deve ser tocado por uma importação.
 */
function filledFrom(row: Record<string, unknown>, fields: readonly string[]): {
  filledFields: string[];
  filledValues: Record<string, unknown>;
} {
  const filledFields: string[] = [];
  const filledValues: Record<string, unknown> = {};

  for (const field of fields) {
    const value = row[field];
    if (value === null || value === undefined || value === '') continue;
    filledFields.push(field);
    filledValues[field] = value;
  }

  return { filledFields, filledValues };
}

/** Converte uma data do Prisma em data civil, na forma que o domínio compara. */
function civilDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  return null;
}

/* -------------------------------------------------------------------------- */
/* Tradução de veículos — a chave tem de ser da mesma natureza dos dois lados  */
/* -------------------------------------------------------------------------- */

/**
 * Traduz o id de um veículo da base de dados para o `localId` do bundle que lhe corresponde.
 *
 * ## Porque é que isto é necessário, e porque é que não é um detalhe
 *
 * As chaves de deduplicação incluem o `vehicleLocalId` (abastecimentos, despesas,
 * quilometragens, …): é ele que impede que dois abastecimentos iguais em veículos
 * diferentes coincidam. A comparação é feita entre **strings**, pelo que as duas partes
 * têm de as escrever no mesmo espaço de nomes.
 *
 * O registo que chega do bundle diz `vehicleLocalId: 'veh_1'` — um identificador local do
 * ficheiro (§2.1). O registo que já está na base de dados tem `vehicleId: '<cuid>'` — a
 * chave primária da tabela. Sem tradução, `'veh_1'` e `'clx…'` nunca seriam iguais: **todos**
 * os registos ligados a um veículo seriam classificados como novos, e uma reimportação do
 * mesmo bundle duplicaria o histórico inteiro — exactamente o que a §8 existe para impedir.
 * O sintoma seria silencioso: o plano diria "criar" e nada pareceria errado.
 *
 * A tradução é derivada da correspondência que a importação já tem de fazer: um veículo do
 * bundle corresponde a um veículo existente quando a **matrícula** coincide (A14/A25 — a
 * matrícula é a identidade do veículo). Não é uma regra nova: é a mesma que o `plan.ts`
 * aplica em `vehicleKeys`, lida aqui para poder escrever a chave na mesma linguagem.
 *
 * Um veículo do bundle que ainda não exista na conta não aparece no mapa — e é isso que
 * está certo: os registos que dependem dele também não existem, logo não há nada com que
 * coincidir.
 */
function vehicleIdTranslator(
  existingVehicles: readonly { id: string; plate: string }[],
  bundleVehicles: readonly CanonicalRecord[],
): ReadonlyMap<string, string> {
  const localIdByPlate = new Map<string, string>();

  for (const record of bundleVehicles) {
    const plate = readText(record.fields.plate);
    if (plate === undefined) continue;
    // Primeira ocorrência ganha: dois veículos com a mesma matrícula no mesmo bundle são
    // um problema de validação (A25), não algo a resolver aqui silenciosamente.
    if (!localIdByPlate.has(plate)) localIdByPlate.set(plate, record.localId);
  }

  const translation = new Map<string, string>();
  for (const vehicle of existingVehicles) {
    const normalized = normalizePlateForCompare(vehicle.plate);
    const localId = localIdByPlate.get(normalized) ?? localIdByPlate.get(vehicle.plate);
    if (localId !== undefined) translation.set(vehicle.id, localId);
  }

  return translation;
}

/** Lê um campo textual, tratando vazio como ausente. */
function readText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/* -------------------------------------------------------------------------- */
/* Leitura do estado da conta                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Lê o estado da conta do utilizador, na forma que a deduplicação espera.
 *
 * ## Isolamento (§7.3)
 *
 * **Todas** as consultas levam `where: { userId }`. É a única implementação desta regra: se
 * cada serviço a escrevesse por si, bastaria um esquecimento num deles para uma importação
 * passar a comparar contra dados de outra conta — e o sintoma seria um "já existe" num
 * registo que o utilizador nunca viu, sem nada que apontasse para a causa.
 */
async function readAccountState(
  prisma: PrismaClient,
  userId: string,
  vehicleLocalId: ReadonlyMap<string, string>,
): Promise<ExistingAccountState> {
  const [
    vehicles,
    odometer,
    expenses,
    fuel,
    charging,
    maintenance,
    insurance,
    inspections,
    taxes,
    documents,
    reminders,
    events,
  ] = await Promise.all([
    prisma.vehicle.findMany({
      where: { userId },
      select: { id: true, plate: true, plateDisplay: true, vin: true, make: true, model: true, year: true },
    }),
    prisma.odometerReading.findMany({
      where: { vehicleId: { in: await vehicleIds(prisma, userId) } },
      select: { id: true, odometerKm: true, recordedAt: true },
    }),
    prisma.expense.findMany({
      where: { userId },
      select: { id: true, vehicleId: true, date: true, amountCents: true, category: true, vendor: true, description: true },
    }),
    prisma.fuelSession.findMany({
      where: { userId },
      select: { id: true, vehicleId: true, date: true, litres: true, amountCents: true, odometerKm: true },
    }),
    prisma.chargingSession.findMany({
      where: { userId },
      select: { id: true, vehicleId: true, date: true, energyKwh: true, amountCents: true, odometerKm: true },
    }),
    prisma.maintenanceRecord.findMany({
      where: { userId },
      select: { id: true, vehicleId: true, date: true, type: true, amountCents: true, odometerKm: true, workshop: true, description: true, notes: true, nextDueDate: true, nextDueOdometerKm: true },
    }),
    prisma.insurancePolicy.findMany({
      where: { userId },
      select: { id: true, vehicleId: true, startDate: true, insurer: true, premiumCents: true, policyNumber: true, coverage: true, notes: true },
    }),
    prisma.inspectionRecord.findMany({
      where: { userId },
      select: { id: true, vehicleId: true, date: true, result: true, amountCents: true, odometerKm: true, station: true, nextDueDate: true, notes: true },
    }),
    prisma.taxRecord.findMany({
      where: { userId },
      select: { id: true, vehicleId: true, kind: true, year: true, amountCents: true, date: true, dueDate: true, notes: true },
    }),
    prisma.document.findMany({
      where: { userId },
      select: { id: true, vehicleId: true, name: true, date: true, expiresAt: true, fileName: true, mimeType: true, sizeBytes: true, storageKey: true, notes: true },
    }),
    prisma.reminder.findMany({
      where: { userId },
      select: { id: true, vehicleId: true, title: true, dueDate: true, dueOdometerKm: true, notes: true },
    }),
    prisma.vehicleEvent.findMany({
      where: { userId },
      select: { id: true, vehicleId: true, type: true, date: true, title: true, summary: true },
    }),
  ]);

  const records: ExistingRecord[] = [
    ...recordSet(vehicles, 'vehicle', (row) => ({
      plate: row.plate as string | null,
      vin: row.vin as string | null,
      make: row.make as string | null,
      model: row.model as string | null,
      year: row.year as number | null,
    })),
    ...recordSet(odometer, 'odometer', (row) => ({
      vehicleLocalId: row.vehicleId,
      recordedAt: civilDate(row.recordedAt),
      odometerKm: row.odometerKm,
    }), vehicleLocalId),
    ...recordSet(expenses, 'expense', (row) => ({
      vehicleLocalId: row.vehicleId,
      date: civilDate(row.date),
      amountCents: row.amountCents,
      category: row.category,
      vendor: row.vendor,
      description: row.description,
    }), vehicleLocalId),
    ...recordSet(fuel, 'fuel', (row) => ({
      vehicleLocalId: row.vehicleId,
      date: civilDate(row.date),
      litres: row.litres,
      amountCents: row.amountCents,
      odometerKm: row.odometerKm,
    }), vehicleLocalId),
    ...recordSet(charging, 'charging', (row) => ({
      vehicleLocalId: row.vehicleId,
      date: civilDate(row.date),
      energyKwh: row.energyKwh,
      odometerKm: row.odometerKm,
    }), vehicleLocalId),
    ...recordSet(maintenance, 'maintenance', (row) => ({
      vehicleLocalId: row.vehicleId,
      date: civilDate(row.date),
      type: row.type,
      amountCents: row.amountCents,
      odometerKm: row.odometerKm,
      workshop: row.workshop,
      description: row.description,
      notes: row.notes,
      nextDueDate: civilDate(row.nextDueDate),
      nextDueOdometerKm: row.nextDueOdometerKm,
    }), vehicleLocalId),
    ...recordSet(insurance, 'insurance', (row) => ({
      vehicleLocalId: row.vehicleId,
      startDate: civilDate(row.startDate),
      insurer: row.insurer,
      premiumCents: row.premiumCents,
      policyNumber: row.policyNumber,
      coverage: row.coverage,
      notes: row.notes,
    }), vehicleLocalId),
    ...recordSet(inspections, 'inspection', (row) => ({
      vehicleLocalId: row.vehicleId,
      date: civilDate(row.date),
      result: row.result,
      amountCents: row.amountCents,
      odometerKm: row.odometerKm,
      station: row.station,
      nextDueDate: civilDate(row.nextDueDate),
      notes: row.notes,
    }), vehicleLocalId),
    ...recordSet(taxes, 'tax', (row) => ({
      vehicleLocalId: row.vehicleId,
      kind: row.kind,
      year: row.year,
      amountCents: row.amountCents,
      date: civilDate(row.date),
      dueDate: civilDate(row.dueDate),
      notes: row.notes,
    }), vehicleLocalId),
    ...recordSet(documents, 'document', (row) => ({
      vehicleLocalId: row.vehicleId,
      name: row.name,
      expiresAt: civilDate(row.expiresAt),
      date: civilDate(row.date),
      fileName: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      storageKey: row.storageKey,
      notes: row.notes,
    }), vehicleLocalId),
    ...recordSet(reminders, 'reminder', (row) => ({
      vehicleLocalId: row.vehicleId,
      title: row.title,
      dueDate: civilDate(row.dueDate),
      dueOdometerKm: row.dueOdometerKm,
      notes: row.notes,
    }), vehicleLocalId),
    ...recordSet(events, 'event', (row) => ({
      vehicleLocalId: row.vehicleId,
      type: row.type,
      date: civilDate(row.date),
      title: row.title,
      description: row.summary,
    }), vehicleLocalId),
  ];

  return { records };
}

/** Ids dos veículos do utilizador, para os registos que só têm `vehicleId`. */
async function vehicleIds(prisma: PrismaClient, userId: string): Promise<string[]> {
  const rows = await prisma.vehicle.findMany({ where: { userId }, select: { id: true } });
  return rows.map((row) => row.id);
}

/**
 * Constrói os `ExistingRecord` de um conjunto de linhas.
 *
 * As chaves são calculadas pelo domínio (`dedupeKeysFor` é a autoridade sobre que campos
 * alimentam cada chave), pelo que este serviço não sabe quais são — passa os valores e
 * recebe as chaves. É isso que mantém a regra de deduplicação num só sítio.
 *
 * ## A tradução do veículo acontece aqui, num só lugar
 *
 * As funções `extract` escrevem `vehicleLocalId: row.vehicleId` — o id verdadeiro da base
 * de dados, porque é o que a consulta tem. A tradução para o `localId` do bundle é feita
 * aqui, sobre o valor já extraído, em vez de se repetir em cada `extract`: dez sítios onde
 * a mesma conversão pode ser esquecida é dez sítios onde ela vai ser esquecida, e o erro
 * resultante é invisível (tudo passa a "novo").
 *
 * A tradução só é aplicada a registos que têm veículo. Um registo de outro tipo não tem
 * `vehicleLocalId` e não é afectado.
 */
function recordSet(
  rows: readonly Record<string, unknown>[],
  kind: ExistingRecord['kind'],
  extract: (row: Record<string, unknown>) => Record<string, unknown>,
  vehicleLocalId?: ReadonlyMap<string, string>,
): ExistingRecord[] {
  return rows.map((row) => {
    const values = extract(row);

    /*
     * `undefined` significa "este veículo do bundle não existe na conta" — não há
     * registos dependentes dele, logo não há nada para comparar. Escrever `undefined`
     * faz a componente da chave desaparecer, e a comparação deixa de depender do veículo.
     * Isso seria pior do que não coincidir: poderia fazer coincidir registos de veículos
     * diferentes. Por isso o registo fica com a chave que tem — se o veículo não é
     * conhecido, a comparação simplesmente não é feita com ele.
     */
    if (typeof values.vehicleLocalId === 'string' && vehicleLocalId) {
      const translated = vehicleLocalId.get(values.vehicleLocalId);
      if (translated !== undefined) values.vehicleLocalId = translated;
    }

    const { filledFields, filledValues } = filledFrom(values, Object.keys(values));

    // As chaves são construídas a partir dos mesmos valores que o bundle produz, para que
    // a comparação seja entre coisas comparáveis.
    const keyRecord = {
      kind,
      localId: String(row.id),
      fields: values,
      references: { vehicleLocalId: values.vehicleLocalId as string | undefined },
    };

    return {
      kind,
      id: String(row.id),
      keys: keysFor(keyRecord),
      filledFields,
      filledValues,
    };
  });
}

/**
 * Delega o cálculo das chaves no domínio.
 *
 * Importação dinâmica evitada de propósito: o `plan.ts` já é importado por este ficheiro
 * (para o `buildPlan`), e uma dependência circular só se evita não a criando. O
 * `dedupeKeysFor` é uma função pura que não conhece o serviço que a chama.
 */
function keysFor(record: {
  kind: ExistingRecord['kind'];
  localId: string;
  fields: Record<string, unknown>;
  references: Record<string, string | undefined>;
}): ExistingRecord['keys'] {
  return dedupeKeysFor(record as unknown as CanonicalRecord);
}

/* -------------------------------------------------------------------------- */
/* A função principal                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Lê um bundle, valida-o e produz o plano — **sem escrever nada**.
 *
 * ## A ordem das fases, e porque não é arbitrária
 *
 *  1. **triage** — `readBundle` verifica manifest, ficheiros declarados, integridade e
 *     limites. Uma recusa aqui lança `BundleRefusalError` e nada mais acontece;
 *  2. **normalize** — traduz os campos crus em campos de domínio (A27);
 *  3. **validate** — problemas por registo e de conjunto, com gravidade. Um bloqueante
 *     passa a `bundleBlocked` no plano, que fica `blocked` em vez de `ready`;
 *  4. **plan** — deduplica contra o estado da conta e classifica cada registo.
 *
 * A validação é passada ao `buildPlan` em vez de recalculada: o plano preserva os
 * problemas em vez de os reproduzir, pelo que o que o utilizador vê no ecrã de revisão é
 * exactamente o que a validação encontrou.
 */
export async function previewImport(options: PreviewImportOptions): Promise<ImportPreview> {
  const { zip, userId, prisma, limits, conflictPolicy } = options;

  /* ---- Fase `triage` + Parser ---- */

  const bundle = readBundle(zip.entries, limits);

  /* ---- Normalizer ---- */

  const { records } = normalizeRecords(bundle.records);

  /* ---- Validator ---- */

  const validation = validateRecords(records);

  /* ---- Estado da conta ---- */

  /*
   * O estado é lido **depois** de o bundle estar normalizado, e não antes, por causa da
   * tradução de veículos: para escrever as chaves de deduplicação na mesma linguagem dos
   * dois lados, é preciso saber a que `localId` do bundle corresponde cada veículo já
   * existente — e essa correspondência só existe depois de os veículos do bundle estarem
   * normalizados (é a matrícula normalizada que os liga).
   *
   * Ler primeiro e traduzir depois obrigaria a uma segunda passagem sobre os registos, ou
   * a guardar os veículos existentes à parte só para esta conversão. Ler por esta ordem
   * custa uma consulta a mais (os veículos são lidos duas vezes: uma para a tradução, outra
   * dentro do estado) e evita uma transformação sobre dados já construídos — que é onde
   * uma conversão esquecida passa despercebida.
   */
  const vehicleLocalId = vehicleIdTranslator(
    await prisma.vehicle.findMany({ where: { userId }, select: { id: true, plate: true } }),
    records.filter((record) => record.kind === 'vehicle'),
  );

  const state = await readAccountState(prisma, userId, vehicleLocalId);

  /*
   * O livro é lido **por bundle** e não globalmente: a chave é `(userId, bundleId,
   * localId)`, e um mapa global — chaveado só por `localId` — faria um `localId` de
   * qualquer outro bundle (`veh_1` existe em todos) parecer já importado.
   *
   * A leitura vive no `book.ts`, que é o ficheiro responsável pelo livro. Repeti-la aqui
   * criaria duas implementações da mesma invariante de segurança, e a segunda seria a que
   * ninguém revisita quando a primeira muda.
   */
  const importedLocalIds = await readImportedLocalIds(prisma, userId, bundle.bundleId);

  const plan = buildPlan({
    records,
    state: { ...state, ...(importedLocalIds ? { importedLocalIds } : {}) },
    validationIssues: validation.issues,
    bundleIssues: bundle.issues,
    bundleBlocked: validation.blocked,
    ...(conflictPolicy ? { conflictPolicy } : {}),
    ...(bundle.manifest.scope ? { scopeNote: describeScope(bundle) } : {}),
  });

  return { plan, bundle, records };
}

/**
 * Descreve o âmbito do bundle para o ecrã de revisão (§5.7).
 */
function describeScope(bundle: BundleReadResult): string {
  const scope = bundle.manifest.scope;
  if (!scope) return '';

  if (scope.kind === 'full-account') return 'Conta completa';
  if (scope.vehicleLocalIds && scope.vehicleLocalIds.length > 0) {
    return `Parcial — ${scope.vehicleLocalIds.length} veículo(s)`;
  }
  return 'Parcial';
}

/* -------------------------------------------------------------------------- */
/* Reexportações                                                               */
/* -------------------------------------------------------------------------- */

/*
 * Quem chama o serviço não deve ter de saber que o plano vem do domínio nem o nome do
 * ficheiro onde ele vive. Reexportar aqui dá à camada HTTP um único ponto de importação —
 * e deixa o domínio livre para ser reorganizado sem tocar nos consumidores.
 */
export { dedupeKeysFor } from '../../domain/import/plan.js';
export type { ImportPlan, PlanEntry, PlanCounts } from '../../domain/import/plan.js';
export type { BundleReadResult } from '../../domain/import/bundle.js';
