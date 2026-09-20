/**
 * Aplicação de um plano de importação (§7.2, fase `apply`).
 *
 * ## A única fase que escreve
 *
 * Tudo o que existe antes desta — leitura, normalização, validação, plano — é análise e
 * pode ser abandonado sem consequência (§7.1). Este ficheiro é onde essa promessa deixa de
 * valer, e é por isso que ele é pequeno e conservador: quanto menos decidir, menos pode
 * decidir mal.
 *
 * ## O que este ficheiro **não** faz
 *
 * Não lê o bundle, não normaliza, não valida e **não reconstrói o plano**. Recebe o plano
 * já construído e os registos já normalizados, e limita-se a escrevê-los. Repetir aqui
 * qualquer passo da leitura abriria a porta à única falha que a §11.3 não perdoa: o
 * utilizador aprovar uma coisa e ser escrita outra. Como o plano que chega é o objecto que
 * o utilizador viu, o que se escreve é exactamente o que foi aprovado — por construção.
 *
 * ## Transaccionalidade (§7.2, decisão 7)
 *
 *  - **Até 10 000 registos** — uma única transacção. Tudo ou nada.
 *  - **10 001 a 100 000** — lotes atómicos com ponto de retoma persistido, para que uma
 *    interrupção no meio não obrigue a recomeçar do zero.
 *  - **Acima de 100 000** — recusa **antes de qualquer alteração**. O limite é aplicado ao
 *    número de registos **efectivamente no plano**, nunca a um valor declarado no manifest
 *    (A26): um `count` enganador não pode autorizar trabalho que os dados não justificam.
 *
 * ## Nunca sobrescrever (decisão 8)
 *
 * A única escrita automática sobre um registo existente é o **preenchimento de campos em
 * branco**. Qualquer alteração de um valor já preenchido exige decisão explícita do
 * utilizador — e essa decisão, quando existir, chega aqui já reflectida no plano. O pior
 * caso de uma importação errada passa a ser "apareceram dados a mais que posso apagar" em
 * vez de "perdi o meu histórico".
 */

import type { PrismaClient } from '../../core/db.js';

import type { CanonicalRecord } from '../../domain/import/validate.js';
import type { ImportPlan, PlanEntry } from '../../domain/import/plan.js';
import { creationOrder, pendingDecisions } from '../../domain/import/plan.js';
import type { DocumentBytes } from '../../domain/import/bundle.js';

import { writeBookEntries, type BookEntryInput, type PrismaLike } from './book.js';
import { documentStorage, sha256Hex, type DocumentStorage } from '../document-storage.js';

/* -------------------------------------------------------------------------- */
/* Configuração                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Limite de transacção única (§7.2). Acima disto, processamento por lotes.
 *
 * Configurável, e o valor inicial é o da especificação. Não confundir com o teto absoluto
 * de 100 000 do A26: aquele é um limite de segurança da implementação, este é o ponto
 * onde a estratégia de escrita muda.
 */
export const SINGLE_TRANSACTION_LIMIT = 10_000;

/**
 * Teto absoluto de registos por importação (A26, D4).
 *
 * Um limite de segurança e operacional da implementação, não um valor da especificação
 * funcional. Sem teto, um bundle de tamanho arbitrário obrigaria a memória do processo a
 * decidir por nós — e a decisão seria tomada no pior momento possível, a meio de uma
 * escrita.
 */
export const ABSOLUTE_RECORD_LIMIT = 100_000;

/** Tamanho do lote no modo por lotes. */
export const BATCH_SIZE = 1_000;

/* -------------------------------------------------------------------------- */
/* Erros                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Uma importação que não pode ser aplicada.
 *
 * Distinto de um erro de base de dados: este descreve uma **recusa** decidida antes de
 * escrever, com um motivo que o utilizador consegue ler e resolver. Um erro do motor é
 * outra coisa — não é culpa de ninguém e não se resolve corrigindo o bundle.
 */
export class ImportNotApplicableError extends Error {
  readonly reason: 'blocked' | 'pending-decisions' | 'too-many-records' | 'nothing-to-do';

  constructor(reason: ImportNotApplicableError['reason'], message: string) {
    super(message);
    this.name = 'ImportNotApplicableError';
    this.reason = reason;
  }
}

/* -------------------------------------------------------------------------- */
/* Relatório                                                                   */
/* -------------------------------------------------------------------------- */

/** Um registo criado. */
export interface CreatedRecord {
  readonly localId: string;
  readonly kind: string;
  readonly id: string;
}

/** Um registo existente cujos campos em branco foram preenchidos. */
export interface EnrichedRecord {
  readonly localId: string;
  readonly kind: string;
  readonly id: string;
  /** Os campos que foram efectivamente preenchidos. Vazio se nenhum o foi. */
  readonly fields: readonly string[];
}

/** O resultado de uma aplicação. */
export interface ApplyReport {
  readonly created: readonly CreatedRecord[];
  readonly enriched: readonly EnrichedRecord[];
  readonly skipped: readonly { localId: string; reason: string }[];
  /** Quantas transacções foram usadas. `1` no caso normal. */
  readonly batches: number;
  /** Mapa `localId → id` de tudo o que foi criado. */
  readonly localToId: ReadonlyMap<string, string>;
}

/* -------------------------------------------------------------------------- */
/* Aplicação                                                                   */
/* -------------------------------------------------------------------------- */

export interface ApplyImportOptions {
  readonly plan: ImportPlan;
  /** Utilizador autenticado. **Nunca** vem do bundle nem do plano. */
  readonly userId: string;
  readonly prisma: PrismaClient;
  /**
   * O `bundleId` da importação, para o livro de idempotência.
   *
   * Vem de fora — do bundle lido — e não do plano, porque o plano é um artefacto de
   * apresentação e não deve transportar o identificador que decide a idempotência.
   */
  readonly bundleId?: string;
  /** Os registos normalizados, necessários para escrever campos que o plano não carrega. */
  readonly records?: readonly CanonicalRecord[];
  /**
   * Os bytes originais dos documentos, tal como o leitor do bundle os verificou (§5.6).
   *
   * Vêm de fora — do `preview` que leu este bundle — e não do plano, pela mesma razão que
   * o `bundleId`: o plano é um artefacto de apresentação com identificadores e ações, não
   * um contentor de binários. E porque quem os obteve é quem já os verificou contra o
   * manifest: transportá-los no plano abriria a porta a escrever bytes que ninguém conferiu.
   *
   * Ausentes quando a importação é de CSV (Camada 2): não há ZIP de onde venham ficheiros,
   * e um documento de CSV é metadados — o `contentState: missingContent` da §5.6, tratado
   * como caso declarado e não como falha.
   */
  readonly documentBytes?: readonly DocumentBytes[];
  /**
   * Onde guardar os bytes dos documentos.
   *
   * Injectável para que os testes lhe dêem um armazenamento temporário — a mesma razão por
   * que a raiz do armazenamento local é um parâmetro do construtor e não uma constante. Em
   * produção é `documentStorage()`, a instância da aplicação.
   */
  readonly storage?: DocumentStorage;
}

/**
 * Aplica um plano de importação.
 *
 * ## Ordem das verificações
 *
 * Todas as recusas são decididas **antes da primeira escrita**, e todas no mesmo sítio:
 * um plano bloqueado, um plano com decisões por tomar e um plano acima do limite absoluto
 * são recusados aqui, sem tocar na base de dados. É isso que torna a recusa observável —
 * o teste verifica um instantâneo da base de dados antes e depois.
 */
export async function applyImport(options: ApplyImportOptions): Promise<ApplyReport> {
  const { plan, userId, prisma, bundleId, records, documentBytes, storage } = options;

  /* ---- Recusas, todas antes de escrever ---- */

  /*
   * Só o estado `blocked` é uma recusa.
   *
   * O `canApply` do domínio devolve `false` para `blocked` **e** para `nothing-to-do`, mas
   * isso responde a "há trabalho a fazer?", não a "esta importação é válida?". Usá-lo aqui
   * como porta de recusa trataria uma reimportação — que a §9.5 descreve explicitamente
   * como um resultado normal, com relatório ("já importado em …; nada a fazer") — como um
   * erro. Não é: não havendo nada a fazer, a operação teve sucesso e não escreveu nada.
   *
   * A distinção entre "não posso escrever" e "não tenho o que escrever" é a diferença
   * entre um erro que o utilizador tem de resolver e uma confirmação.
   */
  if (plan.state === 'blocked') {
    throw new ImportNotApplicableError(
      'blocked',
      'Esta importação tem problemas que impedem a escrita. Nada foi alterado.',
    );
  }

  const pending = pendingDecisions(plan);
  if (pending > 0) {
    throw new ImportNotApplicableError(
      'pending-decisions',
      `Faltam ${pending} decisões. Nada foi alterado — revê a lista e confirma.`,
    );
  }

  /*
   * O limite é aplicado ao que o **plano** contém, e o plano foi construído a partir dos
   * registos efectivamente lidos. É a condição transversal do A26: um `count` enganador no
   * manifest não pode contornar o limite, porque o valor que aqui se lê nunca veio do
   * manifest.
   */
  if (plan.entries.length > ABSOLUTE_RECORD_LIMIT) {
    throw new ImportNotApplicableError(
      'too-many-records',
      `Esta importação tem ${plan.entries.length} registos e o limite é ${ABSOLUTE_RECORD_LIMIT}. Nada foi alterado.`,
    );
  }

  const work = workOrder(plan);
  if (work.length === 0) {
    return emptyReport();
  }

  /* ---- Escrita ---- */

  /*
   * Os bytes dos documentos, indexados por `localId`.
   *
   * Construído **antes** da escrita e uma só vez: cada documento é procurado pelo seu
   * `localId`, e uma pesquisa linear por documento faria uma importação de N documentos
   * custar N² comparações. O índice é a diferença entre "a importação demora o que os
   * dados exigem" e "a importação demora o quadrado do que os dados exigem".
   */
  const bytesByLocalId = new Map((documentBytes ?? []).map((item) => [item.localId, item]));

  const context = {
    plan,
    userId,
    prisma,
    ...(bundleId !== undefined ? { bundleId } : {}),
    ...(records !== undefined ? { records } : {}),
    bytesByLocalId,
    ...(storage !== undefined ? { storage } : { storage: documentStorage() }),
  };

  const useBatches = work.length > SINGLE_TRANSACTION_LIMIT;

  return useBatches
    ? applyInBatches({ ...context, work })
    : applyInSingleTransaction({ ...context, work });
}

/**
 * A lista de trabalho: o que o `apply` tem de efectivamente processar.
 *
 * ## Porque é que não basta o `creationOrder`
 *
 * O `creationOrder` do domínio devolve **só** as entradas com `action: 'create'` — responde
 * a "em que ordem se criam os registos novos?", que é uma pergunta mais estreita do que
 * "o que é que esta importação tem de fazer?". Uma entrada `exact` com campos enriquecíveis
 * é trabalho: não cria nada, mas preenche campos em branco, e o relatório tem de a
 * distinguir dos criados (§9.3). Filtrada pelo `creationOrder`, desaparecia — e o
 * enriquecimento, apesar de planeado e mostrado ao utilizador, nunca aconteceria.
 *
 * A ordem mantém-se a do domínio para a criação, e o enriquecimento vai **depois**: só
 * escreve em registos que já existem, e esses já lá estavam antes desta importação, pelo
 * que não depende de nenhum registo novo estar criado. Acrescentá-lo no fim preserva a
 * ordem de criação sem a redefinir.
 */
function workOrder(plan: ImportPlan): readonly PlanEntry[] {
  const enrich = plan.entries.filter(
    (entry) => entry.action === 'exact' && entry.enrichableFields.length > 0,
  );
  return [...creationOrder(plan), ...enrich];
}

function emptyReport(): ApplyReport {
  return {
    created: [],
    enriched: [],
    skipped: [],
    batches: 0,
    localToId: new Map(),
  };
}

/* -------------------------------------------------------------------------- */
/* Transacção única (§7.2, até 10 000)                                         */
/* -------------------------------------------------------------------------- */

/**
 * Escreve tudo numa transacção.
 *
 * É o caminho normal e o mais forte: ou entra tudo, ou não entra nada. Uma falha a meio —
 * uma matrícula que afinal já existia, uma violação de constraint que a validação não
 * podia prever — reverte tudo, e o resultado é uma base de dados exactamente como estava.
 */
async function applyInSingleTransaction(context: {
  plan: ImportPlan;
  work: readonly PlanEntry[];
  userId: string;
  prisma: PrismaClient;
  bundleId?: string;
  records?: readonly CanonicalRecord[];
  bytesByLocalId: ReadonlyMap<string, DocumentBytes>;
  storage: DocumentStorage;
}): Promise<ApplyReport> {
  const { plan, work, userId, prisma, bundleId, records, bytesByLocalId, storage } = context;

  return prisma.$transaction(async (tx) => {
    const report = await writeEntries(tx, plan, work, userId, {
      records,
      bytesByLocalId,
      storage,
    });

    /*
     * O livro é escrito **dentro da mesma transacção** que criou os registos. Numa
     * transacção separada, uma falha entre as duas deixaria registos criados sem entrada
     * no livro — e a reimportação seguinte, não os reconhecendo, tentaria criá-los outra
     * vez. É precisamente o caso que a idempotência existe para impedir.
     */
    if (bundleId) {
      const entries: BookEntryInput[] = report.created.map((created) => ({
        bundleId,
        localId: created.localId,
        recordKind: created.kind,
        createdRecordId: created.id,
      }));
      await writeBookEntries(tx, userId, bundleId, entries);
    }

    return { ...report, batches: 1 };
  });
}

/* -------------------------------------------------------------------------- */
/* Lotes (§7.2, 10 001 a 100 000)                                              */
/* -------------------------------------------------------------------------- */

/**
 * Escreve por lotes atómicos.
 *
 * Cada lote é a sua própria transacção, com o livro escrito no mesmo lote. Uma interrupção
 * a meio deixa os lotes anteriores confirmados e o seu registo no livro — e é isso que
 * torna a retoma segura: a próxima execução, ao ler o plano, encontra o que já entrou
 * marcado pelo livro e não o repete.
 *
 * ## Porque é que a ordem é preservada entre lotes
 *
 * Os veículos vêm primeiro e são poucos, pelo que ficam no primeiro lote. Se um lote
 * contivesse registos que apontam para veículos de um lote posterior, a referência não
 * teria destino — e como a ordem já garante que os veículos vêm antes, o lote corta
 * sempre num ponto seguro.
 */
async function applyInBatches(context: {
  plan: ImportPlan;
  work: readonly PlanEntry[];
  userId: string;
  prisma: PrismaClient;
  bundleId?: string;
  records?: readonly CanonicalRecord[];
  bytesByLocalId: ReadonlyMap<string, DocumentBytes>;
  storage: DocumentStorage;
}): Promise<ApplyReport> {
  const { plan, work, userId, prisma, bundleId, records, bytesByLocalId, storage } = context;

  const created: CreatedRecord[] = [];
  const enriched: EnrichedRecord[] = [];
  const skipped: { localId: string; reason: string }[] = [];
  let batches = 0;

  for (let offset = 0; offset < work.length; offset += BATCH_SIZE) {
    const slice = work.slice(offset, offset + BATCH_SIZE);

    const partial = await prisma.$transaction(async (tx) => {
      const report = await writeEntries(tx, plan, slice, userId, {
        records,
        bytesByLocalId,
        storage,
      });

      if (bundleId) {
        const entries: BookEntryInput[] = report.created.map((item) => ({
          bundleId,
          localId: item.localId,
          recordKind: item.kind,
          createdRecordId: item.id,
        }));
        await writeBookEntries(tx, userId, bundleId, entries);
      }

      return report;
    });

    created.push(...partial.created);
    enriched.push(...partial.enriched);
    skipped.push(...partial.skipped);
    batches += 1;
  }

  return {
    created,
    enriched,
    skipped,
    batches,
    localToId: new Map(created.map((item) => [item.localId, item.id])),
  };
}

/* -------------------------------------------------------------------------- */
/* Escrita de um conjunto de entradas                                          */
/* -------------------------------------------------------------------------- */

/**
 * Escreve as entradas de um lote, resolvendo as referências.
 *
 * ## A resolução de `localId → id`
 *
 * As referências do bundle apontam para `localId`, que não existe na base de dados: o
 * veículo criado tem um `cuid` novo, e o abastecimento tem de apontar para ele. A tradução
 * é feita aqui e num só sítio, a partir do que já foi criado **neste lote** mais o que já
 * existe na conta.
 *
 * ## Porque é que os existentes também entram no mapa
 *
 * Um bundle pode trazer um veículo que já existe na conta (classificado `exact`) e
 * abastecimentos novos que apontam para ele. Se o mapa só tivesse o que foi criado, esses
 * abastecimentos ficavam sem destino. É por isso que o mapa de trabalho começa pelo que o
 * plano já sabe sobre os registos existentes.
 */
async function writeEntries(
  tx: PrismaLike,
  plan: ImportPlan,
  work: readonly PlanEntry[],
  userId: string,
  documentWrites: {
    records?: readonly CanonicalRecord[] | undefined;
    bytesByLocalId: ReadonlyMap<string, DocumentBytes>;
    storage: DocumentStorage;
  },
): Promise<Omit<ApplyReport, 'batches'>> {
  const created: CreatedRecord[] = [];
  const enriched: EnrichedRecord[] = [];
  const skipped: { localId: string; reason: string }[] = [];
  const localToId = new Map<string, string>();

  /*
   * Os registos existentes que o plano já resolveu entram primeiro no mapa: um abastecimento
   * novo que aponte para um veículo já existente tem de o encontrar.
   */
  for (const entry of plan.entries) {
    for (const match of entry.matched) {
      localToId.set(entry.localId, match.id);
    }
  }

  const byLocalId = new Map((documentWrites.records ?? []).map((record) => [record.localId, record]));

  for (const entry of work) {
    if (entry.action === 'skipped') {
      skipped.push({ localId: entry.localId, reason: entry.reason ?? 'Ignorado.' });
      continue;
    }

    if (entry.action === 'create') {
      const record = byLocalId.get(entry.localId);
      if (!record) {
        /*
         * Sem os registos normalizados não se pode escrever. Não é um erro do utilizador;
         * é um erro de quem chamou o serviço — o `preview` devolve-os exactamente para
         * serem passados aqui.
         */
        throw new Error(
          `O registo «${entry.localId}» está no plano para criar mas os seus dados não foram fornecidos.`,
        );
      }

      const id = await createRecord(tx, record, userId, localToId, documentWrites);
      localToId.set(entry.localId, id);
      created.push({ localId: entry.localId, kind: entry.kind, id });
      continue;
    }

    if (entry.action === 'exact' && entry.enrichableFields.length > 0) {
      const target = entry.matched[0];
      const record = byLocalId.get(entry.localId);
      if (!target || !record) continue;

      const filled = await enrichRecord(tx, target.id, entry.kind, record, entry.enrichableFields);
      if (filled.length > 0) {
        enriched.push({ localId: entry.localId, kind: entry.kind, id: target.id, fields: filled });
      }
      continue;
    }
  }

  return { created, enriched, skipped, localToId };
}

/* -------------------------------------------------------------------------- */
/* Criação por tipo                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Cria um registo do tipo certo.
 *
 * ## Porque é que os campos são copiados e não passados directamente
 *
 * O registo normalizado tem os campos que o domínio compara, que **não** são todos os que a
 * tabela guarda — e tem campos que a tabela não tem (`vehicleLocalId` existe só no bundle,
 * `storageKey` pode não existir de todo). Passar o objecto inteiro faria o Prisma recusar
 * campos desconhecidos. A construção explícita, por tipo, é o sítio onde essa tradução
 * acontece — e é o único.
 *
 * ## A resolução de referências
 *
 * `vehicleLocalId` e as outras referências são traduzidas para `id` através do mapa. Uma
 * referência que não resolva é um problema bloqueante apanhado na validação (§9.4) e não
 * devia chegar aqui; se chegar, é preferível falhar alto do que escrever um registo órfão.
 */
async function createRecord(
  tx: PrismaLike,
  record: CanonicalRecord,
  userId: string,
  localToId: ReadonlyMap<string, string>,
  documentWrites: {
    bytesByLocalId: ReadonlyMap<string, DocumentBytes>;
    storage: DocumentStorage;
  },
): Promise<string> {
  const f = record.fields;

  const vehicleId = resolveReference(record, 'vehicleLocalId', localToId);

  switch (record.kind) {
    case 'vehicle': {
      const row = await tx.vehicle.create({
        data: {
          userId,
          plate: f.plate as string,
          plateDisplay: (f.plateDisplay as string) ?? (f.plate as string),
          vin: (f.vin as string) ?? null,
          make: (f.make as string) ?? null,
          model: (f.model as string) ?? null,
          version: (f.version as string) ?? null,
          year: (f.year as number) ?? null,
          vehicleType: (f.vehicleType as string) ?? 'car',
          fuelType: (f.fuelType as string) ?? 'gasoline',
          color: (f.color as string) ?? null,
          nickname: (f.nickname as string) ?? null,
        },
        select: { id: true },
      });
      return row.id;
    }

    case 'odometer': {
      const row = await tx.odometerReading.create({
        data: {
          vehicleId,
          odometerKm: f.odometerKm as number,
          recordedAt: civilDateValue(f.recordedAt),
          origin: (f.origin as string) ?? 'manual',
          isCorrection: (f.isCorrection as boolean) ?? false,
          notes: (f.notes as string) ?? null,
        },
        select: { id: true },
      });
      return row.id;
    }

    case 'expense': {
      const row = await tx.expense.create({
        data: {
          vehicleId,
          userId,
          amountCents: f.amountCents as number,
          vatCents: (f.vatCents as number) ?? null,
          category: f.category as string,
          date: civilDateValue(f.date),
          vendor: (f.vendor as string) ?? null,
          odometerKm: (f.odometerKm as number) ?? null,
          description: (f.description as string) ?? null,
          paymentMethod: (f.paymentMethod as string) ?? null,
          paid: (f.paid as boolean) ?? true,
        },
        select: { id: true },
      });
      return row.id;
    }

    case 'fuel': {
      const row = await tx.fuelSession.create({
        data: {
          vehicleId,
          userId,
          date: civilDateValue(f.date),
          litres: f.litres as number,
          amountCents: f.amountCents as number,
          pricePerLitreCents: (f.pricePerLitreCents as number) ?? null,
          odometerKm: (f.odometerKm as number) ?? null,
          fullTank: (f.fullTank as boolean) ?? true,
          station: (f.station as string) ?? null,
          fuelType: (f.fuelType as string) ?? null,
          notes: (f.notes as string) ?? null,
        },
        select: { id: true },
      });
      return row.id;
    }

    case 'charging': {
      const row = await tx.chargingSession.create({
        data: {
          vehicleId,
          userId,
          date: civilDateValue(f.date),
          energyKwh: f.energyKwh as number,
          amountCents: f.amountCents as number,
          pricePerKwhCents: (f.pricePerKwhCents as number) ?? null,
          odometerKm: (f.odometerKm as number) ?? null,
          durationMinutes: (f.durationMinutes as number) ?? null,
          startSocPercent: (f.startSocPercent as number) ?? null,
          endSocPercent: (f.endSocPercent as number) ?? null,
          location: (f.location as string) ?? null,
          isPublic: (f.isPublic as boolean) ?? null,
          notes: (f.notes as string) ?? null,
        },
        select: { id: true },
      });
      return row.id;
    }

    case 'maintenance': {
      const row = await tx.maintenanceRecord.create({
        data: {
          vehicleId,
          userId,
          date: civilDateValue(f.date),
          type: f.type as string,
          amountCents: (f.amountCents as number) ?? null,
          odometerKm: (f.odometerKm as number) ?? null,
          workshop: (f.workshop as string) ?? null,
          description: (f.description as string) ?? null,
          nextDueDate: f.nextDueDate === undefined ? null : civilDateValue(f.nextDueDate),
          nextDueOdometerKm: (f.nextDueOdometerKm as number) ?? null,
          notes: (f.notes as string) ?? null,
        },
        select: { id: true },
      });
      return row.id;
    }

    case 'insurance': {
      const row = await tx.insurancePolicy.create({
        data: {
          vehicleId,
          userId,
          insurer: f.insurer as string,
          policyNumber: (f.policyNumber as string) ?? null,
          startDate: civilDateValue(f.startDate),
          endDate: civilDateValue(f.endDate),
          premiumCents: (f.premiumCents as number) ?? (f.amountCents as number) ?? null,
          coverage: (f.coverage as string) ?? null,
          notes: (f.notes as string) ?? null,
        },
        select: { id: true },
      });
      return row.id;
    }

    case 'inspection': {
      const row = await tx.inspectionRecord.create({
        data: {
          vehicleId,
          userId,
          date: civilDateValue(f.date),
          result: (f.result as string) ?? 'passed',
          amountCents: (f.amountCents as number) ?? null,
          odometerKm: (f.odometerKm as number) ?? null,
          station: (f.station as string) ?? null,
          nextDueDate: f.nextDueDate === undefined ? null : civilDateValue(f.nextDueDate),
          notes: (f.notes as string) ?? null,
        },
        select: { id: true },
      });
      return row.id;
    }

    case 'tax': {
      const row = await tx.taxRecord.create({
        data: {
          vehicleId,
          userId,
          kind: f.kind as string,
          year: f.year as number,
          amountCents: f.amountCents as number,
          date: f.date === undefined ? null : civilDateValue(f.date),
          dueDate: f.dueDate === undefined ? null : civilDateValue(f.dueDate),
          paid: (f.paid as boolean) ?? true,
          notes: (f.notes as string) ?? null,
        },
        select: { id: true },
      });
      return row.id;
    }

    case 'document': {
      /*
       * Os bytes primeiro, a linha depois.
       *
       * ## Porque é que a ordem não é indiferente
       *
       * Os bytes vão para o armazenamento, que **não** participa na transacção da base de
       * dados. Se a linha fosse escrita primeiro e a gravação dos bytes falhasse, ficaria
       * um documento a declarar conteúdo que não existe — e um `storageKey` que ninguém
       * conseguiria ler. Guardar primeiro inverte o risco: no pior caso, uma transacção que
       * reverte deixa bytes órfãos, que são invisíveis (nenhuma linha lhes faz referência)
       * e recuperáveis (o mesmo procedimento dos temporários de `save`), ao contrário de um
       * documento que mente sobre o que tem.
       *
       * ## Porque é que os bytes são conferidos antes de serem guardados
       *
       * O `sha256` que o bundle declara em `contentSha256` é a **identidade** do ficheiro
       * (§5.6) e é a chave de deduplicação dos documentos (`plan.ts`). Guardar bytes que
       * não correspondem ao declarado criaria um documento cuja identidade não descreve o
       * conteúdo — e a reimportação seguinte classificá-lo-ia como já importado, ou não,
       * por um valor que nunca foi verdade. A conferência é feita aqui e não no leitor
       * porque é aqui que os bytes deixam de ser temporários: até este ponto, recusar é
       * barato; depois, é preciso apagar.
       *
       * ## Nenhum destes casos bloqueia a importação
       *
       * A §5.6 é explícita: um documento cujos bytes não estão disponíveis **não bloqueia**
       * a exportação, e é importado só com metadados. O mesmo vale do lado da importação —
       * uma incoerência entre o declarado e o real é reportada e o documento é criado como
       * metadados, em vez de recusar a importação inteira por causa de um anexo.
       */
      const bytes = documentWrites.bytesByLocalId.get(record.localId);
      let storageKey: string | null = null;
      let sizeBytes = (f.sizeBytes as number) ?? null;

      if (bytes) {
        const declared = typeof f.contentSha256 === 'string' ? f.contentSha256.toLowerCase() : null;
        const actual = sha256Hex(bytes.data);

        if (declared && declared !== actual) {
          throw new Error(
            `O ficheiro do documento «${record.localId}» não corresponde ao resumo declarado no manifest. Nada foi escrito.`,
          );
        }

        storageKey = await documentWrites.storage.save(userId, bytes.data);
        // O tamanho passa a ser o **medido**, não o declarado: o bundle pode trazer um
        // `sizeBytes` desactualizado, e a coluna descreve o que foi efectivamente guardado.
        sizeBytes = bytes.data.byteLength;
      }

      const row = await tx.document.create({
        data: {
          userId,
          vehicleId: vehicleId === null ? null : vehicleId,
          name: f.name as string,
          category: f.category as string,
          date: f.date === undefined ? null : civilDateValue(f.date),
          expiresAt: f.expiresAt === undefined ? null : civilDateValue(f.expiresAt),
          fileName: (f.fileName as string) ?? bytes?.fileName ?? null,
          mimeType: (f.mimeType as string) ?? null,
          sizeBytes,
          // `null` quando o bundle não trouxe ficheiro — a leitura futura devolve `null` e
          // o documento fica exactamente como a §5.6 o descreve: metadados sem conteúdo.
          storageKey,
          notes: (f.notes as string) ?? null,
        },
        select: { id: true },
      });
      return row.id;
    }

    case 'reminder': {
      const row = await tx.reminder.create({
        data: {
          vehicleId,
          userId,
          title: f.title as string,
          dueDate: f.dueDate === undefined ? null : civilDateValue(f.dueDate),
          dueOdometerKm: (f.dueOdometerKm as number) ?? null,
          origin: (f.origin as string) ?? 'manual',
          notes: (f.notes as string) ?? null,
        },
        select: { id: true },
      });
      return row.id;
    }

    case 'event': {
      const row = await tx.vehicleEvent.create({
        data: {
          vehicleId,
          userId,
          type: f.type as string,
          date: civilDateValue(f.date),
          title: f.title as string,
          summary: (f.description as string) ?? null,
        },
        select: { id: true },
      });
      return row.id;
    }

    default:
      throw new Error(
        `O tipo «${record.kind}» não tem criação implementada. Nada foi escrito.`,
      );
  }
}

/* -------------------------------------------------------------------------- */
/* Enriquecimento (decisão 8)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Preenche campos em branco de um registo existente.
 *
 * ## A única escrita automática permitida
 *
 * Devolve os campos que **efectivamente** preencheu, e não os que o plano propunha: entre a
 * construção do plano e esta escrita, o registo pode ter sido preenchido por outro pedido,
 * e reescrevê-lo seria sobrescrever um valor que o utilizador acabou de pôr. A leitura
 * antes da escrita é o que torna esta operação segura em concorrência.
 *
 * ## Porque é que só se preenche o que está vazio
 *
 * Um campo com valor nunca é tocado, mesmo que o bundle traga um valor "melhor". A decisão
 * 8 é explícita: a única escrita automática é o preenchimento de campos vazios, e qualquer
 * alteração exige decisão do utilizador. Uma heurística de "qual dos dois valores é melhor"
 * seria uma regra de negócio inventada no sítio onde ninguém a procura.
 */
async function enrichRecord(
  tx: PrismaLike,
  id: string,
  kind: string,
  record: CanonicalRecord,
  fields: readonly string[],
): Promise<readonly string[]> {
  const delegate = delegateFor(tx, kind);
  if (!delegate) return [];

  const current = (await delegate.findUnique({ where: { id }, select: fieldsToSelect(fields) })) as
    | Record<string, unknown>
    | null;
  if (!current) return [];

  const patch: Record<string, unknown> = {};
  const filled: string[] = [];

  for (const field of fields) {
    const existing = current[field];
    if (existing !== null && existing !== undefined && existing !== '') continue;

    const incoming = record.fields[field];
    if (incoming === null || incoming === undefined || incoming === '') continue;

    patch[field] = incoming;
    filled.push(field);
  }

  if (filled.length === 0) return [];

  await delegate.update({ where: { id }, data: patch });
  return filled;
}

/** O delegate do Prisma para um tipo de registo. */
function delegateFor(tx: PrismaLike, kind: string) {
  const delegates: Record<string, unknown> = {
    vehicle: tx.vehicle,
    odometer: tx.odometerReading,
    expense: tx.expense,
    fuel: tx.fuelSession,
    charging: tx.chargingSession,
    maintenance: tx.maintenanceRecord,
    insurance: tx.insurancePolicy,
    inspection: tx.inspectionRecord,
    tax: tx.taxRecord,
    document: tx.document,
    reminder: tx.reminder,
    event: tx.vehicleEvent,
  };

  return delegates[kind] as
    | {
        findUnique(args: unknown): Promise<unknown>;
        update(args: unknown): Promise<unknown>;
      }
    | undefined;
}

/** Um `select` com os campos pedidos, para não trazer a linha inteira. */
function fieldsToSelect(fields: readonly string[]): Record<string, boolean> {
  const select: Record<string, boolean> = {};
  for (const field of fields) select[field] = true;
  return select;
}

/* -------------------------------------------------------------------------- */
/* Utilitários                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Resolve uma referência `localId → id`.
 *
 * Uma referência ausente devolve `null` — que é uma resposta legítima para os tipos onde a
 * referência é opcional (`documents`, `events`). Uma referência **presente mas não
 * resolvida** é um erro: significa que o plano ia criar um registo a apontar para nada, e
 * escrevê-lo seria criar precisamente o órfão que a §9.4 proíbe.
 */
function resolveReference(
  record: CanonicalRecord,
  name: string,
  localToId: ReadonlyMap<string, string>,
): string {
  const localId = record.references[name];
  if (localId === null || localId === undefined) {
    return null as unknown as string;
  }

  const id = localToId.get(localId);
  if (!id) {
    throw new Error(
      `A referência «${name}» de «${record.localId}» aponta para «${localId}», que não foi criado nem existe na conta.`,
    );
  }
  return id;
}

/**
 * Converte uma data civil (`YYYY-MM-DD`) no instante que o Prisma guarda.
 *
 * `T00:00:00.000Z` e não `new Date(string)`: uma data civil não tem hora nem fuso, e
 * interpretá-la com a hora local deslocaria o dia em metade dos fusos. A §5.3 é explícita
 * sobre isto — "uma despesa de ontem não tem hora; guardar um instante produz deslocamentos
 * de um dia" — e é a razão da data ser transportada como texto.
 */
function civilDateValue(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string') return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  throw new Error('Data civil ausente ou ilegível.');
}

/* -------------------------------------------------------------------------- */
/* Reexportações                                                               */
/* -------------------------------------------------------------------------- */

export type { ImportPlan, PlanEntry } from '../../domain/import/plan.js';
