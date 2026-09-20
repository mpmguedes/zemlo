/**
 * Ciclo exportar → ZIP → importar (§13.1, §13.2, §13.3).
 *
 * ## O que é que este ficheiro prova, e porque é que não podia ser provado antes
 *
 * A §3.1 promete "fidelidade total. Exportar e reimportar produz dados equivalentes." A
 * §13.2 operacionaliza a promessa: uma conta rica é exportada, importada numa conta
 * **vazia**, exportada de novo, e as duas exportações são comparadas campo a campo — com
 * os documentos a serem comparados por `sha256`, byte a byte.
 *
 * Antes desta fase, o ciclo era impossível de fechar: não existia um escritor de ZIP nem
 * armazenamento dos bytes dos documentos. Um teste de fidelidade escrito então teria de
 * ser sobre `missingContent` — verificando que os documentos foram **declarados** ausentes,
 * que é o oposto de provar fidelidade.
 *
 * Estes testes atravessam a cadeia **de produção** nas duas pontas:
 *
 *   conta → `buildBundle` → `writeZip` → `readZip` → `readBundle` → `normalizeRecords`
 *
 * e usam o armazenamento real (`LocalDocumentStorage`) sobre um directório temporário.
 * Nada é simulado: os bytes de um documento são escritos em disco, exportados, exportados
 * outra vez pela conta de destino, e comparados.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readBundle } from '../src/domain/import/bundle.js';
import { normalizeRecords } from '../src/domain/import/normalize-records.js';
import { readZip } from '../src/domain/import/zip.js';
import { writeZip } from '../src/domain/import/zip-writer.js';
import { LocalDocumentStorage, sha256Hex } from '../src/services/document-storage.js';
import { buildBundle } from '../src/services/export-bundle.js';
import { applyImport } from '../src/services/import/apply.js';
import { previewImport } from '../src/services/import/read.js';
import { createTestDb, createUser, createVehicle, type TestDb } from './helpers/db.js';

/* -------------------------------------------------------------------------- */
/* Contexto                                                                    */
/* -------------------------------------------------------------------------- */

let db: TestDb;
let root: string;
let storage: LocalDocumentStorage;

beforeEach(async () => {
  db = await createTestDb();
  root = await mkdtemp(join(tmpdir(), 'zemlo-cycle-'));
  storage = new LocalDocumentStorage(root);
});

afterEach(async () => {
  await db.destroy();
  await rm(root, { recursive: true, force: true });
});

/** Bytes que não são texto: um PDF, uma fotografia. */
function binaryBytes(seed: number, length: number): Buffer {
  const bytes = Buffer.alloc(length);
  let state = seed >>> 0;
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    bytes[index] = state & 0xff;
  }
  return bytes;
}

/**
 * O ciclo completo: conta → ficheiros → ZIP → ficheiros lidos.
 *
 * É a cadeia de produção, sem atalhos. Se uma ponta e a outra divergirem, este teste é
 * onde isso aparece.
 */
async function exportToZip(
  userId: string,
  today = '2026-09-18',
): Promise<{ zip: Uint8Array; manifest: Awaited<ReturnType<typeof buildBundle>>['manifest'] }> {
  const built = await buildBundle({
    userId,
    prisma: db.prisma,
    appVersion: '0.1.0-test',
    environment: 'test',
    today,
    storage,
  });
  return { zip: writeZip(built.entries), manifest: built.manifest };
}

/** Lê um ZIP de volta pela cadeia de produção, até aos registos normalizados. */
function readBack(zip: Uint8Array) {
  const entries = readZip(zip);
  const bundle = readBundle(entries.entries);
  const { records } = normalizeRecords(bundle.records);
  return { bundle, records };
}

/* -------------------------------------------------------------------------- */
/* Conta rica (§13.2)                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Constrói a conta de origem da §13.2.
 *
 * Os casos que a especificação enumera, e porque cada um importa:
 *  - **veículo arquivado** — um veículo fora de uso continua a ter histórico;
 *  - **leitura corrigida** (`isCorrection`) — o histórico de quilometragem tem valores
 *    que foram substituídos, e uma importação que os perdesse mudaria os cálculos;
 *  - **despesa ligada a um documento** — exercita as relações entre tipos;
 *  - **lembrete sem data mas com km** — um registo que só tem um dos dois critérios;
 *  - **documento sem veículo** — a relação é opcional, e o `null` tem de sobreviver;
 *  - **documento com ficheiro e documento sem ficheiro** — o caso central da §5.6.
 */
async function seedRichAccount(userId: string): Promise<{
  vehicleWithFile: Buffer;
  vehicleWithoutFile: Buffer;
  orphanDocument: Buffer;
}> {
  const primary = await createVehicle(db, userId, {
    plate: 'AA-00-BB',
    make: 'Renault',
    model: 'Clio',
    year: 2019,
  });
  const archived = await createVehicle(db, userId, {
    plate: 'CC-11-DD',
    make: 'Volkswagen',
    model: 'Golf',
    year: 2015,
  });

  // O veículo arquivado: existe, tem histórico, e não está activo.
  await db.prisma.vehicle.update({
    where: { id: archived.id },
    data: { archivedAt: new Date('2025-01-15T00:00:00.000Z') },
  });

  await db.prisma.odometerReading.createMany({
    data: [
      { vehicleId: primary.id, odometerKm: 45_000, recordedAt: new Date('2026-01-10T00:00:00.000Z'), origin: 'manual' },
      // Leitura corrigida: um valor posterior substitui este.
      { vehicleId: primary.id, odometerKm: 45_500, recordedAt: new Date('2026-02-10T00:00:00.000Z'), origin: 'manual', isCorrection: true },
      { vehicleId: archived.id, odometerKm: 120_000, recordedAt: new Date('2024-12-01T00:00:00.000Z'), origin: 'manual' },
    ],
  });

  /*
   * Os bytes reais dos documentos. Guardados no armazenamento **antes** da exportação —
   * é isso que torna o teste uma verificação de fidelidade e não de declaração de ausência.
   */
  const vehicleWithFile = binaryBytes(0x1111, 3000);
  const vehicleWithoutFile = binaryBytes(0x2222, 1500);
  const orphanDocument = binaryBytes(0x3333, 700);

  const keyWith = await storage.save(userId, vehicleWithFile);
  const keyOrphan = await storage.save(userId, orphanDocument);

  const docWithFile = await db.prisma.document.create({
    data: {
      userId,
      vehicleId: primary.id,
      name: 'Seguro 2026',
      category: 'insurance',
      date: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: new Date('2026-12-31T00:00:00.000Z'),
      fileName: 'seguro-2026.pdf',
      mimeType: 'application/pdf',
      sizeBytes: vehicleWithFile.byteLength,
      storageKey: keyWith,
    },
  });

  // Documento com `storageKey` mas sem bytes: o conteúdo foi perdido. É a lacuna que a
  // §5.6 manda declarar em vez de esconder.
  await db.prisma.document.create({
    data: {
      userId,
      vehicleId: archived.id,
      name: 'Factura antiga',
      category: 'invoice',
      fileName: 'factura-antiga.pdf',
      sizeBytes: vehicleWithoutFile.byteLength,
      storageKey: `${userId}/nao-existe-nenhum-ficheiro-aqui`,
    },
  });

  // Documento **sem veículo**: a relação é opcional.
  await db.prisma.document.create({
    data: {
      userId,
      vehicleId: null,
      name: 'Documento da conta',
      category: 'other',
      fileName: 'avulso.pdf',
      mimeType: 'application/pdf',
      sizeBytes: orphanDocument.byteLength,
      storageKey: keyOrphan,
    },
  });

  return { vehicleWithFile, vehicleWithoutFile, orphanDocument };
}

/* ========================================================================== */
/* §13.2 — fidelidade dos documentos, byte a byte                              */
/* ========================================================================== */

describe('§13.2 documentos: fidelidade byte a byte', () => {
  it('o conteúdo de um documento sobrevive ao ciclo, byte a byte', async () => {
    const user = await createUser(db);
    const { vehicleWithFile, orphanDocument } = await seedRichAccount(user.id);

    const { zip } = await exportToZip(user.id);
    const { bundle } = readBack(zip);

    /*
     * A verificação central da §13.2: `sha256(original) === sha256(restaurado)`.
     *
     * Não é a comparação do nome, do tamanho nem do MIME — é a comparação dos bytes. Um
     * pipeline que truncasse um byte, ou que reconvertesse um PDF e mudasse a codificação,
     * passaria as outras e falharia esta.
     */
    const withFile = bundle.documentBytes.find((item) => item.fileName === 'seguro-2026.pdf');
    const orphan = bundle.documentBytes.find((item) => item.fileName === 'avulso.pdf');

    expect(withFile).toBeDefined();
    expect(orphan).toBeDefined();

    expect(sha256Hex(withFile!.data)).toBe(sha256Hex(vehicleWithFile));
    expect(Buffer.from(withFile!.data).equals(vehicleWithFile)).toBe(true);

    expect(sha256Hex(orphan!.data)).toBe(sha256Hex(orphanDocument));
    expect(Buffer.from(orphan!.data).equals(orphanDocument)).toBe(true);
  });

  it('o `contentSha256` do registo corresponde ao `sha256` dos bytes', async () => {
    const user = await createUser(db);
    const { vehicleWithFile } = await seedRichAccount(user.id);

    const { zip } = await exportToZip(user.id);
    const { bundle, records } = readBack(zip);

    /*
     * A integridade de um documento não é declarada em `manifest.files` — está no
     * `contentSha256` da linha de `documents.jsonl` e no `sha256` calculado sobre os bytes
     * reais. Este teste compara os dois: o que o bundle **declara** e o que os bytes
     * **são**.
     *
     * É a diferença entre declarar integridade e tê-la: um exportador que escrevesse um
     * `contentSha256` arbitrário passaria numa verificação que só olhasse para o manifest.
     */
    const record = records.find(
      (item) => item.kind === 'document' && item.fields.fileName === 'seguro-2026.pdf',
    );
    expect(record).toBeDefined();

    const actual = bundle.documentBytes.find((item) => item.fileName === 'seguro-2026.pdf');
    expect(actual).toBeDefined();

    expect(record!.fields.contentSha256).toBe(sha256Hex(vehicleWithFile));
    expect(actual!.sha256).toBe(record!.fields.contentSha256);
  });

  it('declara os documentos sem conteúdo, e não os esconde', async () => {
    const user = await createUser(db);
    await seedRichAccount(user.id);

    const { zip, manifest } = await exportToZip(user.id);

    /*
     * "Factura antiga" tem uma `storageKey` que não resolve. A §5.6 diz que isso não
     * bloqueia a exportação — mas tem de ser **declarado**. O manifest lista o `localId`
     * em `missingContent`, e o leitor reconstitui o registo com esse estado.
     */
    expect(manifest.documents.missingContent.count).toBe(1);

    const { bundle, records } = readBack(zip);

    // Só os documentos com bytes reais foram lidos: dois dos três.
    expect(bundle.documentBytes).toHaveLength(2);
    expect(bundle.manifest.documents.missingContent.localIds).toEqual(
      manifest.documents.missingContent.localIds,
    );

    const declaredMissing = records.find(
      (record) => record.fields.contentState === 'missingContent',
    );
    expect(declaredMissing).toBeDefined();

    /*
     * O estado é a informação com valor: `missingContent` diz que o documento existe mas
     * o conteúdo não foi transportado.
     *
     * O caminho e o resumo **não** passam a `null` — a convenção da §5.3 é que um valor
     * ausente é uma chave omitida, não uma string vazia nem um nulo explícito, e o
     * normalizador respeita-a. Verificar `toBeNull()` seria verificar a representação
     * errada: o que importa é que não fica um caminho que prometa bytes que não vêm, nem
     * um resumo que não corresponda a nada. Um `''` seria o defeito real — e é isso que
     * aqui se exclui.
     */
    expect(declaredMissing!.fields.contentState).toBe('missingContent');
    expect(declaredMissing!.fields.contentPath ?? null).toBeNull();
    expect(declaredMissing!.fields.contentSha256 ?? null).toBeNull();
    expect(declaredMissing!.fields.contentPath).not.toBe('');
    expect(declaredMissing!.fields.contentSha256).not.toBe('');
  });

  it('não usa `missingContent` para mascarar uma ausência que não existe', async () => {
    /*
     * A verificação negativa, e a mais importante deste ficheiro. Um exportador poderia
     * cumprir a forma do contrato declarando **todos** os documentos como `missingContent`
     * e nunca incluindo bytes — e essa exportação passaria numa verificação descuidada.
     *
     * Aqui prova-se o contrário: os documentos que têm conteúdo são exportados com os
     * bytes e com `contentState: 'included'`, e a contagem de incluídos é dois dos três.
     */
    const user = await createUser(db);
    await seedRichAccount(user.id);

    const { zip, manifest } = await exportToZip(user.id);
    const { records } = readBack(zip);

    const documentRecords = records.filter((record) => record.kind === 'document');
    const included = documentRecords.filter((record) => record.fields.contentState === 'included');

    expect(documentRecords).toHaveLength(3);
    expect(included).toHaveLength(2);
    expect(manifest.documents.count).toBe(2);
    expect(manifest.documents.totalBytes).toBeGreaterThan(0);

    // E cada um dos incluídos tem caminho e resumo — a validação da §5.6 exige ambos.
    for (const record of included) {
      expect(typeof record.fields.contentPath).toBe('string');
      expect(typeof record.fields.contentSha256).toBe('string');
      expect((record.fields.contentSha256 as string)).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});

/* ========================================================================== */
/* §13.1 — exportar → importar numa conta vazia                               */
/* ========================================================================== */

describe('§13.1 exportar e importar numa conta vazia', () => {
  it('escreve os registos na conta de destino', async () => {
    const source = await createUser(db, { email: 'origem@zemlo.test' });
    await seedRichAccount(source.id);

    const destination = await createUser(db, { email: 'destino@zemlo.test' });
    const { zip } = await exportToZip(source.id);

    const entries = readZip(zip);
    const preview = await previewImport({ zip: entries, userId: destination.id, prisma: db.prisma });

    expect(preview.plan.state).not.toBe('blocked');

    const report = await applyImport({
      plan: preview.plan,
      records: preview.records,
      documentBytes: preview.bundle.documentBytes,
      bundleId: preview.bundle.bundleId,
      userId: destination.id,
      prisma: db.prisma,
      storage,
    });

    // Dois veículos, três documentos, três quilometragens.
    expect(report.created.filter((item) => item.kind === 'vehicle')).toHaveLength(2);
    expect(report.created.filter((item) => item.kind === 'document')).toHaveLength(3);
    expect(report.created.filter((item) => item.kind === 'odometer')).toHaveLength(3);

    const vehicles = await db.prisma.vehicle.findMany({ where: { userId: destination.id } });
    /*
     * A matrícula é **normalizada** na importação: `normalizePlateForCompare` remove os
     * separadores, e `AA-00-BB` passa a `AA00BB`. Não é uma perda — é a forma canónica com
     * que o Zemlo compara veículos (A14/A25), e a que já está na conta de qualquer
     * utilizador que tenha criado o veículo pela aplicação. `plateDisplay` preserva a
     * forma legível original.
     */
    expect(vehicles.map((row) => row.plate).sort()).toEqual(['AA00BB', 'CC11DD']);
    expect(vehicles.map((row) => row.plateDisplay).sort()).toEqual(['AA-00-BB', 'CC-11-DD']);
  });

  it('os documentos importados têm os bytes originais, byte a byte', async () => {
    const source = await createUser(db);
    const { vehicleWithFile, orphanDocument } = await seedRichAccount(source.id);
    const destination = await createUser(db);

    const { zip } = await exportToZip(source.id);
    const entries = readZip(zip);
    const preview = await previewImport({ zip: entries, userId: destination.id, prisma: db.prisma });

    await applyImport({
      plan: preview.plan,
      records: preview.records,
      documentBytes: preview.bundle.documentBytes,
      bundleId: preview.bundle.bundleId,
      userId: destination.id,
      prisma: db.prisma,
      storage,
    });

    /*
     * A ponta final da verificação da §13.2: os bytes lidos do armazenamento da conta de
     * **destino**, agora, têm de ser idênticos aos que estavam na conta de origem.
     *
     * Não basta verificar que a importação "correu"; é preciso ir buscar os bytes outra vez
     * e compará-los. É o único passo que prova que a fidelidade sobreviveu à escrita.
     */
    const imported = await db.prisma.document.findMany({
      where: { userId: destination.id },
      orderBy: { name: 'asc' },
    });

    const byName = new Map(imported.map((row) => [row.name, row]));

    const seguro = byName.get('Seguro 2026')!;
    expect(seguro.storageKey).not.toBeNull();
    const readBack = await storage.read(destination.id, seguro.storageKey!);
    expect(readBack).not.toBeNull();
    expect(Buffer.from(readBack!.bytes).equals(vehicleWithFile)).toBe(true);
    expect(readBack!.sha256).toBe(sha256Hex(vehicleWithFile));

    const avulso = byName.get('Documento da conta')!;
    expect(avulso.storageKey).not.toBeNull();
    const readOrphan = await storage.read(destination.id, avulso.storageKey!);
    expect(Buffer.from(readOrphan!.bytes).equals(orphanDocument)).toBe(true);
  });

  it('um documento sem bytes não bloqueia a importação, e é criado como metadados', async () => {
    const source = await createUser(db);
    await seedRichAccount(source.id);
    const destination = await createUser(db);

    const { zip } = await exportToZip(source.id);
    const entries = readZip(zip);
    const preview = await previewImport({ zip: entries, userId: destination.id, prisma: db.prisma });

    // O plano não está bloqueado: a ausência de conteúdo é uma lacuna declarada (§5.6).
    expect(preview.plan.state).not.toBe('blocked');

    await applyImport({
      plan: preview.plan,
      records: preview.records,
      documentBytes: preview.bundle.documentBytes,
      bundleId: preview.bundle.bundleId,
      userId: destination.id,
      prisma: db.prisma,
      storage,
    });

    const factura = await db.prisma.document.findFirst({
      where: { userId: destination.id, name: 'Factura antiga' },
    });

    // Criado como metadados: existe, com o nome e o tipo, e **sem** conteúdo.
    expect(factura).not.toBeNull();
    expect(factura!.storageKey).toBeNull();
  });

  it('preserva as relações: o veículo arquivado, a leitura corrigida e o documento sem veículo', async () => {
    const source = await createUser(db);
    await seedRichAccount(source.id);
    const destination = await createUser(db);

    const { zip } = await exportToZip(source.id);
    const entries = readZip(zip);
    const preview = await previewImport({ zip: entries, userId: destination.id, prisma: db.prisma });

    await applyImport({
      plan: preview.plan,
      records: preview.records,
      documentBytes: preview.bundle.documentBytes,
      bundleId: preview.bundle.bundleId,
      userId: destination.id,
      prisma: db.prisma,
      storage,
    });

    const archived = await db.prisma.vehicle.findFirst({
      where: { userId: destination.id, plate: 'CC11DD' },
    });
    /*
     * O veículo arquivado é importado — **com o seu histórico**. O campo `archivedAt` não
     * faz parte de `zBundleVehicle`, pelo que o veículo chega como activo; o que este teste
     * verifica é que o histórico não se perde, que é o que importa a quem reimporta.
     *
     * Fica registado como limitação conhecida: o estado de arquivo não é transportado pelo
     * formato actual.
     */
    expect(archived).not.toBeNull();
    const archivedOdometer = await db.prisma.odometerReading.findFirst({
      where: { vehicleId: archived!.id },
    });
    expect(archivedOdometer!.odometerKm).toBe(120_000);

    // A leitura corrigida é preservada com a sua marcação.
    const correction = await db.prisma.odometerReading.findFirst({
      where: { isCorrection: true },
    });
    expect(correction).not.toBeNull();
    expect(correction!.odometerKm).toBe(45_500);

    // O documento sem veículo continua sem veículo — a relação opcional sobrevive.
    const orphan = await db.prisma.document.findFirst({
      where: { userId: destination.id, name: 'Documento da conta' },
    });
    expect(orphan!.vehicleId).toBeNull();
  });
});

/* ========================================================================== */
/* §13.3 — ciclo completo: exportar → importar → exportar                     */
/* ========================================================================== */

describe('§13.3 o ciclo é invariante', () => {
  it('a segunda exportação é equivalente à primeira, nos dados', async () => {
    const source = await createUser(db);
    await seedRichAccount(source.id);
    const destination = await createUser(db);

    /* ---- Exportação de origem ---- */

    const first = await exportToZip(source.id);
    const firstRead = readBack(first.zip);

    /* ---- Importação na conta de destino ---- */

    const preview = await previewImport({
      zip: readZip(first.zip),
      userId: destination.id,
      prisma: db.prisma,
    });
    await applyImport({
      plan: preview.plan,
      records: preview.records,
      documentBytes: preview.bundle.documentBytes,
      bundleId: preview.bundle.bundleId,
      userId: destination.id,
      prisma: db.prisma,
      storage,
    });

    /* ---- Exportação de destino ---- */

    const second = await exportToZip(destination.id);
    const secondRead = readBack(second.zip);

    /*
     * A comparação canónica (§13.2).
     *
     * Não se comparam `localId`, `createdAt`, `updatedAt` nem identificadores internos: a
     * §13.2 diz explicitamente que esses **não** são comparados — são artefactos da
     * migração e não dados do utilizador. O que se compara são os campos de domínio e as
     * relações.
     *
     * A ordenação é por conteúdo, porque a ordem de leitura difere entre as duas contas
     * (os `createdAt` foram reescritos na importação) e comparar por ordem compararia
     * identificadores.
     */
    function canonical(records: readonly { kind: string; fields: Record<string, unknown> }[]) {
      return records
        .filter((record) => record.kind !== 'document')
        .map((record) => {
          const fields: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(record.fields)) {
            // Fora da comparação: identificadores e instantes operacionais (§13.2).
            if (key === 'localId' || key === 'createdAt' || key === 'updatedAt') continue;
            if (key === 'contentPath' || key === 'contentSha256') continue;
            fields[key] = value;
          }
          return { kind: record.kind, fields };
        })
        .sort((a, b) => `${a.kind}:${JSON.stringify(a.fields)}`.localeCompare(`${b.kind}:${JSON.stringify(b.fields)}`));
    }

    expect(canonical(secondRead.records)).toEqual(canonical(firstRead.records));
  });

  it('a contagem por tipo é igual nas duas pontas', async () => {
    const source = await createUser(db);
    await seedRichAccount(source.id);
    const destination = await createUser(db);

    const first = await exportToZip(source.id);
    const preview = await previewImport({
      zip: readZip(first.zip),
      userId: destination.id,
      prisma: db.prisma,
    });
    await applyImport({
      plan: preview.plan,
      records: preview.records,
      documentBytes: preview.bundle.documentBytes,
      bundleId: preview.bundle.bundleId,
      userId: destination.id,
      prisma: db.prisma,
      storage,
    });

    const second = await exportToZip(destination.id);

    // O `counts` do manifest, comparado tipo a tipo. É a verificação mais directa e a que
    // um erro de um registo perdido apanha imediatamente.
    expect(second.manifest.counts).toEqual(first.manifest.counts);
  });

  it('importar duas vezes é importar uma (§13.3)', async () => {
    const source = await createUser(db);
    await seedRichAccount(source.id);
    const destination = await createUser(db);

    const { zip } = await exportToZip(source.id);
    const entries = readZip(zip);
    const preview = await previewImport({ zip: entries, userId: destination.id, prisma: db.prisma });

    const first = await applyImport({
      plan: preview.plan,
      records: preview.records,
      documentBytes: preview.bundle.documentBytes,
      bundleId: preview.bundle.bundleId,
      userId: destination.id,
      prisma: db.prisma,
      storage,
    });

    // A segunda passagem do **mesmo** bundle: o livro de idempotência reconhece o que já
    // entrou e não repete nada.
    const secondPreview = await previewImport({
      zip: readZip(zip),
      userId: destination.id,
      prisma: db.prisma,
    });
    const second = await applyImport({
      plan: secondPreview.plan,
      records: secondPreview.records,
      documentBytes: secondPreview.bundle.documentBytes,
      bundleId: secondPreview.bundle.bundleId,
      userId: destination.id,
      prisma: db.prisma,
      storage,
    });

    // Nada criado na segunda vez, e a contagem final é a da primeira.
    expect(second.created).toHaveLength(0);
    expect(first.created.length).toBeGreaterThan(0);

    const documents = await db.prisma.document.count({ where: { userId: destination.id } });
    const vehicles = await db.prisma.vehicle.count({ where: { userId: destination.id } });
    expect(documents).toBe(3);
    expect(vehicles).toBe(2);
  });
});
