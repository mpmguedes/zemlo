/**
 * Construção do bundle nativo da Camada 1 (§5.2, §6).
 *
 * ## O que este ficheiro faz
 *
 * Lê a conta do utilizador e produz o **conjunto de ficheiros** de um bundle Zemlo — o
 * `manifest.json`, os `.jsonl` por tipo, o `account.json`, o `README.txt`, os CSV da camada
 * legível e os bytes dos documentos. Não escreve o ZIP: isso é o `zip-writer.ts`, e a
 * separação é deliberada — o formato do bundle e o formato do arquivo são duas coisas que
 * evoluem por razões diferentes.
 *
 * ## Porque é que isto não é `buildExportBundle`
 *
 * O `buildExportBundle` produz o JSON legado: um objecto plano, sem `localId`, sem
 * referências normalizadas, pensado para uma importação que ainda não existia. Usá-lo como
 * base do bundle nativo obrigaria a inventar `localId` a partir dos `cuid`, o que contradiz
 * a §5.5 ("os `cuid` internos não aparecem por omissão") e tornaria a reimportação noutra
 * conta dependente de identificadores que não lhe pertencem.
 *
 * Este ficheiro produz o formato que o **leitor** já implementa: `localId` gerados na
 * exportação, referências escritas como `localId`, datas civis `YYYY-MM-DD`, instantes em
 * ISO-8601 UTC, ausentes omitidos ou `null` — nunca `""`.
 *
 * ## A simetria com o leitor
 *
 * O leitor percorre: `ZIP → indexBundleEntries → readBundle → normalizeRecords →
 * validateRecords → buildPlan`. O construtor percorre o inverso: `conta → ficheiros`.
 * A garantia que interessa é que o resultado de um atravessa o outro sem perdas — e é
 * isso que a §13.2 verifica.
 */

import type { CivilDate } from '@zemlo/shared';
import {
  BUNDLE_CSV_DIR,
  BUNDLE_DATA_FILES,
  BUNDLE_DOCUMENTS_DIR,
  BUNDLE_MANIFEST_FILE,
  BUNDLE_README_FILE,
  FORMAT_VERSION,
  MANIFEST_VERSION,
  EXPORT_FORMAT,
  dataClassesForExport,
  defaultConventions,
  type Manifest,
} from '@zemlo/shared';

import type { PrismaClient } from '../core/db.js';
import { readJsonObject } from '../core/json.js';
import type { DocumentStorage } from './document-storage.js';
import { sha256Hex } from './document-storage.js';
import { toCivilDate } from '../domain/payload.js';
import type { ZipWriteEntry } from '../domain/import/zip-writer.js';

/*
 * Os prefixos de `localId` e o gerador de `bundleId` vivem no domínio, que é quem define o
 * formato. Importá-los daqui — em vez de os reescrever — é o que impede que o escritor e o
 * leitor divirjam sobre o que é um identificador válido.
 */
import { LOCAL_ID_PREFIXES, generateBundleId } from '../domain/import/ids.js';

/* -------------------------------------------------------------------------- */
/* Contrato                                                                    */
/* -------------------------------------------------------------------------- */

/** Um documento cujos bytes não puderam ser lidos do armazenamento. */
export interface MissingDocumentContent {
  readonly localId: string;
  readonly name: string;
  /** Porque é que os bytes não foram incluídos. Para o relatório, não para o bundle. */
  readonly reason: 'semConteudo' | 'ilegivel';
}

/** O conjunto de ficheiros de um bundle, pronto a ser escrito num ZIP. */
export interface BuiltBundle {
  /** As entradas, na ordem em que devem ser escritas. */
  readonly entries: readonly ZipWriteEntry[];
  /** O manifest que foi escrito — devolvido para o relatório e para os testes. */
  readonly manifest: Manifest;
  /** Documentos exportados sem os bytes, por `localId`. Declarados, nunca escondidos. */
  readonly missingContent: readonly MissingDocumentContent[];
  /** `localId` de cada registo exportado, por tipo — o mapa que a deduplicação usa. */
  readonly localIdsByKind: Readonly<Record<string, readonly string[]>>;
}

export interface BuildBundleOptions {
  readonly userId: string;
  readonly prisma: PrismaClient;
  /** Versão da aplicação, para o `createdBy` do manifest. */
  readonly appVersion: string;
  /** Ambiente de origem (`production`, `test`, …). */
  readonly environment: string;
  /** Data civil da exportação, para o nome do ficheiro e para o manifest. */
  readonly today: CivilDate;
  /**
   * Restringe a exportação a um veículo (§5.7).
   *
   * O âmbito é sempre declarado no manifest: um bundle filtrado é indistinguível de um
   * bundle corrompido para quem só conta registos, e declará-lo é o que impede essa
   * ambiguidade.
   */
  readonly vehicleId?: string;
  /** De onde ler os bytes dos documentos. Sem isto, todo o conteúdo é `missingContent`. */
  readonly storage?: DocumentStorage;
  /**
   * Impede o acesso ao sistema de ficheiros quando é `true`.
   *
   * É a única situação em que um documento com `storageKey` é exportado como metadados:
   * quando o armazenamento não está disponível. Existe porque a exportação **nunca** pode
   * bloquear por causa de um anexo (§5.6), mas uma ausência de conteúdo tem sempre de ser
   * declarada.
   */
  readonly skipDocumentBytes?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Identificadores locais (§5.5)                                               */
/* -------------------------------------------------------------------------- */

/**
 * Gera `localId` sequenciais por tipo, com o prefixo da convenção (`ids.ts`).
 *
 * ## Porque é que os identificadores são regenerados e não derivados do `cuid`
 *
 * A §5.5 é explícita: os `cuid` internos não aparecem por omissão, e quando aparecem é em
 * `manifest.identifiers`, nunca no meio dos dados. Um `localId` derivado do `cuid`
 * (`veh_<cuid>`) pareceria cumprir a forma mas reteria o identificador interno — e a
 * importação noutra conta ficaria com identificadores que revelam a estrutura da conta de
 * origem, sem qualquer benefício.
 *
 * ## Porque é que a contagem começa em 1 e é determinística
 *
 * `veh_1`, `veh_2`, … A ordem é a ordem de leitura (por `createdAt`), pelo que dois
 * bundles da mesma conta em estados iguais produzem os mesmos identificadores — e a §13.3
 * ("um bundle exportado de um resultado de importação é equivalente ao original") pode ser
 * comparada sem normalizar identificadores.
 *
 * O contador é **por prefixo**, e não por tipo lógico: `odometer` conta `odo_1`, `odo_2`,
 * o que mantém a numeração dentro de cada namespace e evita colisões entre tipos que
 * partilhassem um prefixo por engano.
 */
class LocalIdFactory {
  private readonly counters = new Map<string, number>();

  next(prefix: string): string {
    const current = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, current);
    return `${prefix}_${current}`;
  }
}

/**
 * O prefixo de `localId` de cada tipo de registo é o de `domain/import/ids.ts`, importado
 * no topo deste ficheiro. Não há aqui uma segunda lista.
 */

/* -------------------------------------------------------------------------- */
/* Utilitários                                                                 */
/* -------------------------------------------------------------------------- */

/** Serializa registos como `.jsonl`: um objecto JSON por linha, com `\n` final. */
function jsonl(records: readonly Record<string, unknown>[]): Uint8Array {
  if (records.length === 0) return new Uint8Array(0);
  // `\n` **final** em cada linha, incluindo a última: é o que o leitor espera ao dividir
  // por `\n` e descartar a última parte vazia. Sem ele, a última linha perder-se-ia.
  return new TextEncoder().encode(records.map((record) => JSON.stringify(record)).join('\n') + '\n');
}

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/**
 * Remove chaves cujo valor é `undefined`.
 *
 * A §5.3 diz que um valor ausente é "chave omitida ou `null`" — nunca `""`. O
 * `JSON.stringify` já omite `undefined`, mas construímos objectos com chaves condicionais,
 * e uma chave explicitamente posta a `undefined` é indistinguível de não a ter posto. Esta
 * função torna a intenção explícita e impede que um `null` se transforme em `"null"`.
 */
function compact(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Construção                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Constrói o bundle de uma conta.
 *
 * ## A ordem das partes
 *
 * O manifest é escrito **primeiro** no array de entradas, embora o seu conteúdo dependa de
 * tudo o resto. Não é uma contradição: o manifest é construído no fim e colocado no
 * início, porque o leitor recusa um bundle sem manifest declarado antes de olhar para os
 * dados — e a lista de ficheiros tem de vir de algum lado.
 *
 * ## Um documento sem bytes não bloqueia
 *
 * A §5.6: "um documento cujos bytes não estão disponíveis não bloqueia a exportação —
 * exportado como metadados com `missingContent` declarado". Aqui, isso significa que uma
 * `storageKey` em falta ou ilegível produz um documento com `contentState: missingContent`
 * e uma entrada em `missingContent` — nunca um erro, e nunca um conteúdo inventado.
 */
export async function buildBundle(options: BuildBundleOptions): Promise<BuiltBundle> {
  const { userId, prisma, appVersion, environment, today } = options;
  const ids = new LocalIdFactory();

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('Conta não encontrada.');

  /* ---- Leitura da conta ---- */

  const vehicleWhere = { userId, ...(options.vehicleId ? { id: options.vehicleId } : {}) };
  const vehicles = await prisma.vehicle.findMany({
    where: vehicleWhere,
    include: { odometerReadings: { orderBy: { recordedAt: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  });
  const vehicleIds = vehicles.map((vehicle) => vehicle.id);

  const related = { vehicleId: { in: vehicleIds } };

  /*
   * As consultas são paralelas porque são independentes: nenhuma depende do resultado de
   * outra, e serializá-las multiplicaria a latência pelo número de tipos. A ordem dos
   * registos é fixada por `orderBy` em cada uma — para a exportação ser determinística.
   */
  const [expenses, fuel, charging, maintenance, insurance, inspections, taxes, reminders, events, documents] =
    await Promise.all([
      prisma.expense.findMany({ where: related, orderBy: { date: 'asc' } }),
      prisma.fuelSession.findMany({ where: related, orderBy: { date: 'asc' } }),
      prisma.chargingSession.findMany({ where: related, orderBy: { date: 'asc' } }),
      prisma.maintenanceRecord.findMany({ where: related, orderBy: { date: 'asc' } }),
      prisma.insurancePolicy.findMany({ where: related, orderBy: { startDate: 'asc' } }),
      prisma.inspectionRecord.findMany({ where: related, orderBy: { date: 'asc' } }),
      prisma.taxRecord.findMany({ where: related, orderBy: { year: 'asc' } }),
      prisma.reminder.findMany({ where: related, orderBy: { createdAt: 'asc' } }),
      prisma.vehicleEvent.findMany({ where: related, orderBy: { date: 'asc' } }),
      prisma.document.findMany({
        where: { userId, ...(options.vehicleId ? { vehicleId: options.vehicleId } : {}) },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

  /* ---- Tradução de ids internos para localId ---- */

  /*
   * O mapa `id → localId` é construído **antes** de escrever qualquer registo, porque
   * todos os registos apontam para veículos: uma despesa cujo `vehicleId` não esteja no
   * mapa não pode ser escrita com `vehicleLocalId`, e ficaria órfã.
   */
  const vehicleLocalId = new Map<string, string>();
  for (const vehicle of vehicles) {
    vehicleLocalId.set(vehicle.id, ids.next(LOCAL_ID_PREFIXES.vehicle));
  }

  /** Traduz um `vehicleId` no `localId` correspondente, ou lança se estiver fora do âmbito. */
  function vehicleRef(id: string | null): string | null {
    if (id === null) return null;
    const local = vehicleLocalId.get(id);
    if (local === undefined) {
      throw new Error(
        'Um registo aponta para um veículo que não faz parte desta exportação. Nada foi escrito.',
      );
    }
    return local;
  }

  /* ---- Veículos ---- */

  const vehicleRecords = vehicles.map((vehicle) =>
    compact({
      localId: vehicleLocalId.get(vehicle.id)!,
      plate: vehicle.plate,
      plateDisplay: vehicle.plateDisplay,
      vin: vehicle.vin,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      /*
       * O `Vehicle` não tem `source` — a procedência de um veículo não é registada no
       * modelo. O campo mais próximo é `odometerSource`, que descreve de onde veio a
       * **leitura** de quilometragem e não o veículo. Inventar um `source` a partir dele
       * atribuiria ao veículo uma origem que ninguém lhe deu.
       */
      createdAt: vehicle.createdAt.toISOString(),
      updatedAt: vehicle.updatedAt.toISOString(),
    }),
  );

  /* ---- Quilometragens ---- */

  const odometerRecords: Record<string, unknown>[] = [];
  for (const vehicle of vehicles) {
    for (const reading of vehicle.odometerReadings) {
      odometerRecords.push(
        compact({
          localId: ids.next(LOCAL_ID_PREFIXES.odometer),
          vehicleLocalId: vehicleLocalId.get(vehicle.id)!,
          odometerKm: reading.odometerKm,
          recordedAt: toCivilDate(reading.recordedAt),
          origin: reading.origin,
          isCorrection: reading.isCorrection,
          notes: reading.notes,
          source: readJsonObject(reading.source) ?? undefined,
          createdAt: reading.createdAt.toISOString(),
        }),
      );
    }
  }

  /* ---- Restantes registos ligados a veículos ---- */

  const expenseRecords = expenses.map((row) =>
    compact({
      localId: ids.next(LOCAL_ID_PREFIXES.expense),
      vehicleLocalId: vehicleRef(row.vehicleId)!,
      amountCents: row.amountCents,
      vatCents: row.vatCents,
      category: row.category,
      date: toCivilDate(row.date),
      vendor: row.vendor,
      odometerKm: row.odometerKm,
      description: row.description,
      paymentMethod: row.paymentMethod,
      paid: row.paid,
      notes: row.notes,
      source: readJsonObject(row.source) ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
  );

  const fuelRecords = fuel.map((row) =>
    compact({
      localId: ids.next(LOCAL_ID_PREFIXES.fuel),
      vehicleLocalId: vehicleRef(row.vehicleId)!,
      date: toCivilDate(row.date),
      litres: row.litres,
      amountCents: row.amountCents,
      odometerKm: row.odometerKm,
      station: row.station,
      fuelType: row.fuelType,
      fullTank: row.fullTank,
      notes: row.notes,
      source: readJsonObject(row.source) ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
  );

  const chargingRecords = charging.map((row) =>
    compact({
      localId: ids.next(LOCAL_ID_PREFIXES.charging),
      vehicleLocalId: vehicleRef(row.vehicleId)!,
      date: toCivilDate(row.date),
      energyKwh: row.energyKwh,
      amountCents: row.amountCents,
      odometerKm: row.odometerKm,
      // `location`, e não `station`: um carregamento acontece num sítio (casa, um
      // parque, um posto), enquanto um abastecimento acontece numa estação. São campos
      // com nomes diferentes porque descrevem coisas diferentes.
      location: row.location,
      provider: row.provider,
      notes: row.notes,
      source: readJsonObject(row.source) ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
  );

  const maintenanceRecords = maintenance.map((row) =>
    compact({
      localId: ids.next(LOCAL_ID_PREFIXES.maintenance),
      vehicleLocalId: vehicleRef(row.vehicleId)!,
      date: toCivilDate(row.date),
      type: row.type,
      amountCents: row.amountCents,
      odometerKm: row.odometerKm,
      workshop: row.workshop,
      description: row.description,
      notes: row.notes,
      nextDueDate: toCivilDate(row.nextDueDate),
      nextDueOdometerKm: row.nextDueOdometerKm,
      source: readJsonObject(row.source) ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
  );

  const insuranceRecords = insurance.map((row) =>
    compact({
      localId: ids.next(LOCAL_ID_PREFIXES.insurance),
      vehicleLocalId: vehicleRef(row.vehicleId)!,
      startDate: toCivilDate(row.startDate),
      endDate: toCivilDate(row.endDate),
      insurer: row.insurer,
      premiumCents: row.premiumCents,
      policyNumber: row.policyNumber,
      coverage: row.coverage,
      notes: row.notes,
      source: readJsonObject(row.source) ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
  );

  const inspectionRecords = inspections.map((row) =>
    compact({
      localId: ids.next(LOCAL_ID_PREFIXES.inspection),
      vehicleLocalId: vehicleRef(row.vehicleId)!,
      date: toCivilDate(row.date),
      result: row.result,
      amountCents: row.amountCents,
      odometerKm: row.odometerKm,
      station: row.station,
      nextDueDate: toCivilDate(row.nextDueDate),
      notes: row.notes,
      source: readJsonObject(row.source) ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
  );

  const taxRecords = taxes.map((row) =>
    compact({
      localId: ids.next(LOCAL_ID_PREFIXES.tax),
      vehicleLocalId: vehicleRef(row.vehicleId)!,
      kind: row.kind,
      year: row.year,
      amountCents: row.amountCents,
      date: toCivilDate(row.date),
      dueDate: toCivilDate(row.dueDate),
      paid: row.paid,
      notes: row.notes,
      source: readJsonObject(row.source) ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
  );

  const reminderRecords = reminders.map((row) =>
    compact({
      localId: ids.next(LOCAL_ID_PREFIXES.reminder),
      vehicleLocalId: vehicleRef(row.vehicleId)!,
      title: row.title,
      dueDate: toCivilDate(row.dueDate),
      dueOdometerKm: row.dueOdometerKm,
      origin: row.origin,
      notes: row.notes,
      source: readJsonObject(row.source) ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
  );

  const eventRecords = events.map((row) =>
    compact({
      localId: ids.next(LOCAL_ID_PREFIXES.event),
      vehicleLocalId: vehicleRef(row.vehicleId)!,
      type: row.type,
      date: toCivilDate(row.date),
      title: row.title,
      description: row.summary,
      source: readJsonObject(row.source) ?? undefined,
      createdAt: row.createdAt.toISOString(),
    }),
  );

  /* ---- Documentos e conteúdo (§5.6) ---- */

  const documentRecords: Record<string, unknown>[] = [];
  const documentEntries: ZipWriteEntry[] = [];
  const missingContent: MissingDocumentContent[] = [];
  let documentBytes = 0;

  for (const row of documents) {
    const localId = ids.next(LOCAL_ID_PREFIXES.document);

    /*
     * Os bytes são procurados pelo `storageKey`. Sem armazenamento, ou sem chave, ou com
     * uma chave que já não resolve, o documento sai como metadados e a lacuna é declarada.
     * A exportação não falha por causa de um anexo.
     */
    let content: { bytes: Uint8Array; sha256: string } | null = null;
    let reason: MissingDocumentContent['reason'] = 'semConteudo';

    if (!options.skipDocumentBytes && options.storage && row.storageKey) {
      try {
        const stored = await options.storage.read(userId, row.storageKey);
        if (stored) content = { bytes: stored.bytes, sha256: stored.sha256 };
      } catch {
        /*
         * Uma chave que não pertence a esta conta, ou um ficheiro ilegível. Não se propaga:
         * o documento é exportado como metadados e o motivo fica registado. Rebentar aqui
         * tornaria a exportação da conta refém de um único anexo.
         */
        reason = 'ilegivel';
      }
    }

    /*
     * O nome de ficheiro dentro da pasta do documento. Recorre ao nome do documento quando
     * não há `fileName` — sem um nome, o caminho não teria segundo segmento e o leitor
     * recusaria (`bundle.document_path_invalid`).
     */
    const fileName = row.fileName ?? `${row.name}.bin`;
    const contentPath =
      content === null ? null : `${BUNDLE_DOCUMENTS_DIR}/${localId}/${fileName}`;

    if (content !== null) {
      documentEntries.push({ name: contentPath!, data: content.bytes });
      documentBytes += content.bytes.byteLength;
    } else {
      missingContent.push({ localId, name: row.name, reason });
    }

    documentRecords.push(
      compact({
        localId,
        vehicleLocalId: row.vehicleId === null ? null : vehicleRef(row.vehicleId),
        name: row.name,
        category: row.category,
        date: toCivilDate(row.date),
        expiresAt: toCivilDate(row.expiresAt),
        fileName: row.fileName,
        mimeType: row.mimeType,
        sizeBytes: content !== null ? content.bytes.byteLength : row.sizeBytes,
        contentPath,
        contentState: content !== null ? 'included' : 'missingContent',
        contentSha256: content !== null ? content.sha256 : null,
        notes: row.notes,
        source: readJsonObject(row.source) ?? undefined,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }),
    );
  }

  /* ---- Ficheiros de dados ---- */

  const dataFiles: Record<string, readonly Record<string, unknown>[]> = {
    [BUNDLE_DATA_FILES.vehicles]: vehicleRecords,
    [BUNDLE_DATA_FILES.odometer]: odometerRecords,
    [BUNDLE_DATA_FILES.expenses]: expenseRecords,
    [BUNDLE_DATA_FILES.fuel]: fuelRecords,
    [BUNDLE_DATA_FILES.charging]: chargingRecords,
    [BUNDLE_DATA_FILES.maintenance]: maintenanceRecords,
    [BUNDLE_DATA_FILES.insurance]: insuranceRecords,
    [BUNDLE_DATA_FILES.inspections]: inspectionRecords,
    [BUNDLE_DATA_FILES.taxes]: taxRecords,
    [BUNDLE_DATA_FILES.reminders]: reminderRecords,
    [BUNDLE_DATA_FILES.events]: eventRecords,
    [BUNDLE_DATA_FILES.documents]: documentRecords,
  };

  /*
   * Só os ficheiros **com registos** são escritos, com uma excepção: os que o manifest
   * declara como tendo contagem zero não precisam de existir. Um bundle com um
   * `expenses.jsonl` vazio é válido, mas um bundle que o omite também — e omitir é mais
   * honesto do que escrever um ficheiro que não diz nada. O manifest declara `0` para os
   * tipos ausentes, e o leitor não exige um ficheiro declarado com zero registos.
   */
  const files: Manifest['files'] = [];
  const fileEntries: ZipWriteEntry[] = [];

  for (const [path, records] of Object.entries(dataFiles)) {
    if (records.length === 0) continue;
    const bytes = jsonl(records);
    files.push({ path, records: records.length, bytes: bytes.byteLength, sha256: sha256Hex(bytes) });
    fileEntries.push({ name: path, data: bytes });
  }

  /*
   * ## Os bytes dos documentos **não** entram em `manifest.files`
   *
   * É contraintuitivo, e vale a pena fixá-lo: a §5.5 diz que a integridade cobre "todos os
   * ficheiros", mas o `manifest.files` do contrato é a lista dos **ficheiros de dados** —
   * os que o leitor confronta com o que está na raiz do ZIP. Os documentos vivem noutra
   * pasta, o leitor indexa-os à parte (`indexBundleEntries` separa `documents/` do resto) e
   * verifica-os por outro caminho.
   *
   * Declarar `documents/doc_1/seguro.pdf` em `manifest.files` faria o leitor procurá-lo
   * entre os ficheiros de dados, não o encontrar, e recusar o bundle inteiro com
   * `bundle.missing_file` — "volta a exportar e tenta de novo", que é um diagnóstico que
   * não aponta para a causa.
   *
   * A integridade dos documentos é declarada onde o contrato a pede: em
   * `manifest.documents` (`count`, `totalBytes`, `missingContent.localIds`) para o
   * conjunto, e no `contentSha256` de cada linha de `documents.jsonl` para o ficheiro
   * individual. É esse valor que a §13.2 compara entre a origem e o destino.
   */

  /* ---- `account.json`, `README.txt` e CSV ---- */

  const account = compact({
    locale: user.locale,
    timeZone: user.timeZone,
    distanceUnit: user.distanceUnit,
    volumeUnit: user.volumeUnit,
    currency: user.currency,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
  });
  const accountBytes = text(JSON.stringify(account, null, 2));
  files.push({
    path: BUNDLE_DATA_FILES.account,
    bytes: accountBytes.byteLength,
    sha256: sha256Hex(accountBytes),
  });

  const readmeBytes = text(readmeText(today));
  /*
   * O README **não** é declarado. O leitor percorre `manifest.files` e interpreta cada
   * ficheiro declarado como JSONL — um `README.txt` declarado seria lido linha a linha e
   * recusado com `bundle.line_malformed` na primeira. O `checkDeclaredFiles` ignora-o
   * explicitamente (`isNonDataArtifact`), o que confirma que ele está fora do conjunto
   * declarado por desenho e não por esquecimento.
   *
   * Fica no ZIP na mesma: a §5.1 pôs a inspecção pelo utilizador entre as razões para o
   * arquivo, e um README que ninguém declara continua a ser a primeira coisa que uma
   * pessoa abre.
   */

  /*
   * Os CSV são uma camada de **leitura humana** (decisão 11): espelham os `.jsonl` mas com
   * valores em euros e quilómetros. Não são declarados em `manifest.files`, pela razão
   * acima — seriam interpretados como JSONL e recusados. O `checkDeclaredFiles` ignora a
   * pasta `csv/` explicitamente.
   *
   * A declaração deles vive em `manifest.csv`, que é uma lista de **caminhos** e existe
   * para o utilizador saber o que esperar. Não é um contrato de leitura: a §6.2 trata os
   * CSV como uma camada de apresentação e não como dados a importar.
   */
  const csvPaths: string[] = [];
  const csvEntries: ZipWriteEntry[] = [];
  for (const [path, records] of Object.entries(dataFiles)) {
    if (records.length === 0) continue;
    const csvPath = `${BUNDLE_CSV_DIR}/${path.replace(/\.jsonl$/, '.csv')}`;
    csvPaths.push(csvPath);
    csvEntries.push({ name: csvPath, data: jsonlToCsv(records) });
  }

  /* ---- Manifest (§6) ---- */

  const manifest: Manifest = {
    manifestVersion: MANIFEST_VERSION,
    format: EXPORT_FORMAT,
    formatVersion: FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    createdBy: { product: 'Zemlo', appVersion, sourceEnvironment: environment },
    bundleId: generateBundleId(),
    scope: {
      kind: options.vehicleId ? 'vehicles' : 'full-account',
      vehicleLocalIds: options.vehicleId ? [...vehicleLocalId.values()] : null,
      from: null,
      to: null,
      includesDocuments: true,
      note: options.vehicleId ? 'Exportação de um só veículo e dos registos ligados a ele.' : null,
    },
    conventions: defaultConventions(user.currency),
    counts: {
      vehicles: vehicleRecords.length,
      odometer: odometerRecords.length,
      expenses: expenseRecords.length,
      fuel: fuelRecords.length,
      charging: chargingRecords.length,
      maintenance: maintenanceRecords.length,
      insurance: insuranceRecords.length,
      inspections: inspectionRecords.length,
      taxes: taxRecords.length,
      documents: documentRecords.length,
      reminders: reminderRecords.length,
      events: eventRecords.length,
    },
    files,
    documents: {
      included: documentEntries.length > 0,
      count: documentEntries.length,
      totalBytes: documentBytes,
      missingContent: {
        count: missingContent.length,
        localIds: missingContent.map((item) => item.localId),
      },
    },
    integrity: { algorithm: 'sha256', covered: 'all-files' },
    dataClasses: [...dataClassesForExport()],
    sharedVehicles: {
      count: 0,
      note: 'A partilha de veículos entre contas não existe nesta versão.',
    },
    identitySeed: {
      strategy: 'bundle-unique-local-ids',
      /*
       * `true` porque os `localId` são gerados na exportação e não derivam de nada do
       * sistema de origem: um `veh_1` neste bundle não corresponde a nenhum identificador
       * interno, e não é possível reconstruir a conta de origem a partir dele. É essa
       * propriedade — e não o valor de um campo — que a flag declara.
       */
      opaque: true,
    },
    identifiers: { internalIdsIncluded: false },
    csv: { included: csvPaths.length > 0, files: csvPaths },
    extensions: {},
  };

  const manifestBytes = text(JSON.stringify(manifest, null, 2));
  /*
   * O manifest não entra em `manifest.files`: declarar-se a si próprio exigiria o hash de
   * um conteúdo que depende do próprio hash. A §5.5 exige que a integridade cubra "todos
   * os ficheiros" de dados — e o manifest é o índice que os descreve, não um deles.
   */
  const manifestEntry: ZipWriteEntry = { name: BUNDLE_MANIFEST_FILE, data: manifestBytes };

  /* ---- Ordem das entradas ---- */

  /*
   * A ordem segue a leitura humana do bundle: primeiro o índice, depois os dados, a camada
   * legível, o README e, por fim, os binários. O `account.json` vai junto dos ficheiros de
   * dados porque é um deles — a §5.2 trata-o como um ficheiro de dados lido à parte, não
   * como um anexo.
   *
   * A regra que esta lista tem de cumprir, e que um teste verifica, é: **tudo o que o
   * manifest declara tem de estar aqui**. Um ficheiro declarado e ausente faz o leitor
   * recusar o bundle inteiro (`bundle.missing_file`), e o diagnóstico que o utilizador vê
   * ("volta a exportar") não aponta para a causa real.
   */
  const entries: ZipWriteEntry[] = [
    manifestEntry,
    { name: BUNDLE_DATA_FILES.account, data: accountBytes },
    ...fileEntries,
    ...csvEntries,
    { name: BUNDLE_README_FILE, data: readmeBytes },
    ...documentEntries,
  ];

  return {
    entries,
    manifest,
    missingContent,
    localIdsByKind: {
      vehicle: vehicleRecords.map((record) => record['localId'] as string),
      odometer: odometerRecords.map((record) => record['localId'] as string),
      expense: expenseRecords.map((record) => record['localId'] as string),
      fuel: fuelRecords.map((record) => record['localId'] as string),
      charging: chargingRecords.map((record) => record['localId'] as string),
      maintenance: maintenanceRecords.map((record) => record['localId'] as string),
      insurance: insuranceRecords.map((record) => record['localId'] as string),
      inspection: inspectionRecords.map((record) => record['localId'] as string),
      tax: taxRecords.map((record) => record['localId'] as string),
      document: documentRecords.map((record) => record['localId'] as string),
      reminder: reminderRecords.map((record) => record['localId'] as string),
      event: eventRecords.map((record) => record['localId'] as string),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* CSV legível (decisão 11)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Converte registos numa tabela CSV legível.
 *
 * As mesmas convenções da exportação CSV que já existe (§14, decisão 11): BOM UTF-8, `;`
 * como separador, vírgula decimal e neutralização de fórmulas. Reutilizar as convenções
 * (e não a função) é deliberado: o `bundleToCsv` trabalha sobre o formato legado, que tem
 * outras chaves, e forçá-lo aqui obrigaria a traduzir os registos — criando uma segunda
 * fonte de verdade sobre o que o bundle contém.
 *
 * ## A neutralização de fórmulas
 *
 * Um valor que começa por `=`, `+`, `-` ou `@` é interpretado como fórmula pelo Excel, que
 * o executa ao abrir o ficheiro. Uma célula `=cmd|'/c calc'!A0` é uma execução de código.
 * O prefixo `'` desactiva a interpretação, e é a defesa que a exportação existente já
 * aplica.
 */
function jsonlToCsv(records: readonly Record<string, unknown>[]): Uint8Array {
  if (records.length === 0) return new Uint8Array(0);

  // As colunas são a união das chaves, na ordem da primeira aparição. Um registo que não
  // tenha uma chave fica com a célula vazia — o `JSON.stringify` já omite os ausentes.
  const columns: string[] = [];
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }

  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const raw =
      typeof value === 'object'
        ? JSON.stringify(value)
        : typeof value === 'boolean'
          ? value
            ? 'sim'
            : 'não'
          : String(value);
    return quoteCsv(raw);
  };

  const lines = [columns.map(quoteCsv).join(';')];
  for (const record of records) {
    lines.push(columns.map((column) => escape(record[column])).join(';'));
  }

  // BOM + conteúdo, com `\r\n` — o que o Excel espera em ficheiros gerados no Windows.
  return text(`\uFEFF${lines.join('\r\n')}\r\n`);
}

/** Aspas um valor e neutraliza fórmulas. */
function quoteCsv(value: string): string {
  const dangerous = /^[=+\-@\t\r]/.test(value);
  const safe = dangerous ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/* -------------------------------------------------------------------------- */
/* README                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * O texto de `README.txt`.
 *
 * Existe para que um bundle aberto por uma pessoa — não por um programa — se explique. A
 * §5.1 pôs a inspecção pelo utilizador entre as razões para o ZIP, e uma pasta de
 * ficheiros `.jsonl` sem uma palavra de contexto não cumpre essa razão.
 */
function readmeText(today: CivilDate): string {
  return [
    'Zemlo — exportação de dados',
    '===========================',
    '',
    `Exportado em ${today}.`,
    '',
    'Este arquivo contém os teus dados num formato aberto. Podes abri-lo com qualquer',
    'programa que leia ZIP e inspecionar cada ficheiro.',
    '',
    'Ficheiros:',
    '  manifest.json   Descrição do conteúdo, versões e resumos de integridade.',
    '  account.json    Dados da tua conta (idioma, fuso horário, unidades, moeda).',
    '  *.jsonl         Um ficheiro por tipo de registo, um registo por linha.',
    '  csv/*.csv       As mesmas tabelas, prontas para abrir numa folha de cálculo.',
    '  documents/      Os ficheiros originais que anexaste, sem qualquer alteração.',
    '',
    'Convenções:',
    '  - Valores monetários em cêntimos inteiros (divide por 100 para obter euros).',
    '  - Datas civis no formato AAAA-MM-DD; instantes em ISO 8601 UTC.',
    '  - Um valor ausente é uma chave omitida ou null — nunca uma string vazia.',
    '',
    'Este arquivo pode ser reimportado no Zemlo sem perda de informação.',
    '',
  ].join('\n');
}

/* -------------------------------------------------------------------------- */
/* README                                                                      */
/* -------------------------------------------------------------------------- */
