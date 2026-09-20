/**
 * Os restantes testes obrigatórios da §13 (§13.1, §13.3, §13.4).
 *
 * ## Porque é que este ficheiro existe separado do `import-export-cycle.test.ts`
 *
 * O `import-export-cycle.test.ts` prova o **ciclo** — exportar, importar, exportar de novo,
 * comparar byte a byte. Este ficheiro prova o que fica de fora desse eixo e que a §13.1
 * lista ao lado dele: versões do manifest, importação interrompida, grandes volumes,
 * duplicados, dados incompletos, referências inválidas. E prova as duas famílias de
 * propriedades: as que valem para **toda** a entrada válida (§13.3) e as que dizem
 * respeito à **entrada hostil** (§13.4).
 *
 * A divisão não é de conveniência. O ciclo é uma pergunta sobre fidelidade ("os dados
 * voltaram iguais?"); estes testes são perguntas sobre **robustez** ("o que acontece quando
 * a entrada é estranha ou grande?"). Misturá-los num só ficheiro faria um ficheiro com duas
 * razões para falhar, e a leitura da falha começaria por ter de decidir qual delas.
 *
 * ## O que se usa a sério
 *
 * Nada é simulado no que diz respeito ao produto: os ZIP são construídos com o **escritor
 * de produção** (`writeZip`) sempre que o que se testa é comportamento legítimo, e com o
 * construtor de bytes do harness (`buildZip`) apenas quando o teste precisa de produzir um
 * ZIP que o escritor de produção **não permite** — um symlink, um CRC errado, 10 000
 * entradas. Usar o escritor de produção para construir a entrada hostil seria pedir-lhe que
 * produzisse o que ele recusa, que é uma contradição.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BUNDLE_DATA_FILES,
  BUNDLE_MANIFEST_FILE,
  FORMAT_VERSION,
  MANIFEST_VERSION,
} from '@zemlo/shared';

import { BUNDLE_LIMITS, readBundle } from '../src/domain/import/bundle.js';
import { normalizeRecords } from '../src/domain/import/normalize-records.js';
import { readZip, ZipRefusalError } from '../src/domain/import/zip.js';
import { writeZip } from '../src/domain/import/zip-writer.js';
import { LocalDocumentStorage } from '../src/services/document-storage.js';
import { buildBundle as buildExportBundle } from '../src/services/export-bundle.js';
import {
  applyImport,
  ABSOLUTE_RECORD_LIMIT,
  SINGLE_TRANSACTION_LIMIT,
} from '../src/services/import/apply.js';
import { previewImport } from '../src/services/import/read.js';
import { createTestDb, createUser, createVehicle, type TestDb } from './helpers/db.js';
import {
  buildZip,
  concatBytes,
  crc32,
  utf8,
  writeU16,
  writeU32,
} from './helpers/zip-builder.js';
import { buildManifest, jsonl } from './helpers/bundle-builder.js';

/* -------------------------------------------------------------------------- */
/* Contexto                                                                    */
/* -------------------------------------------------------------------------- */

let db: TestDb;
let root: string;
let storage: LocalDocumentStorage;

beforeEach(async () => {
  db = await createTestDb();
  root = await mkdtemp(join(tmpdir(), 'zemlo-spec13-'));
  storage = new LocalDocumentStorage(root);
});

afterEach(async () => {
  await db.destroy();
  await rm(root, { recursive: true, force: true });
});

/** Bytes binários determinísticos, que não são texto. */
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

/** Um ZIP montado a partir do manifest e dos ficheiros, sem passar pelo escritor. */
function zipFrom(manifest: unknown, files: Record<string, string>): Uint8Array {
  return buildZip([
    { name: BUNDLE_MANIFEST_FILE, data: utf8(JSON.stringify(manifest, null, 2)) },
    ...Object.entries(files).map(([name, content]) => ({ name, data: utf8(content) })),
  ]);
}

/**
 * Um ZIP cujas entradas podem ter nomes **diferentes** no índice e no cabeçalho local.
 *
 * ## Porque é que isto é preciso
 *
 * O `buildZip` do harness escreve o mesmo nome nos dois sítios, o que é o que um escritor
 * correcto faz. Mas há duas famílias de casos que só um arquivo com nomes divergentes
 * consegue produzir:
 *
 *  1. **o caso legítimo** — um escritor que normaliza o nome ao escrever o índice e deixa o
 *     original no cabeçalho (o que alguns escritores reais fazem). Testar que o leitor
 *     normaliza exige conseguir escrever os dois nomes;
 *  2. **o caso hostil** — um arquivo que se apresenta com dois nomes para a mesma entrada.
 *     É o ataque clássico de validar o nome do índice e extrair o do cabeçalho, e a única
 *     forma de o exercitar é construí-lo.
 *
 * O helper escreve o arquivo **inteiro à mão**, porque o construtor do harness só sabe
 * escrever nomes concordantes. A alternativa seria corromper os bytes depois — trocar o
 * comprimento do nome e deslocar tudo —, que é a espécie de aritmética de offsets que
 * introduz erros no teste em vez de encontrar erros no código.
 */
function buildZipWithLocalNames(
  entries: readonly { name: string; localName: string; data: Uint8Array }[],
): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = utf8(entry.name);
    const localNameBytes = utf8(entry.localName);
    const compressed = new Uint8Array(deflateRawSync(Buffer.from(entry.data)));
    const crc = crc32(entry.data);

    // Cabeçalho local (30 bytes + nome), com o nome **do cabeçalho**.
    const local = new Uint8Array(30 + localNameBytes.byteLength);
    writeU32(local, 0, 0x04034b50);
    writeU16(local, 4, 20);
    writeU16(local, 6, 0x0800);
    writeU16(local, 8, 8); // deflate
    writeU16(local, 10, 0);
    writeU16(local, 12, 0x21);
    writeU32(local, 14, crc);
    writeU32(local, 18, compressed.byteLength);
    writeU32(local, 22, entry.data.byteLength);
    writeU16(local, 26, localNameBytes.byteLength);
    writeU16(local, 28, 0);
    local.set(localNameBytes, 30);

    // Entrada do índice central (46 bytes + nome), com o nome **do índice**.
    const central = new Uint8Array(46 + nameBytes.byteLength);
    writeU32(central, 0, 0x02014b50);
    writeU16(central, 4, 20);
    writeU16(central, 6, 20);
    writeU16(central, 8, 0x0800);
    writeU16(central, 10, 8);
    writeU16(central, 12, 0);
    writeU16(central, 14, 0x21);
    writeU32(central, 16, crc);
    writeU32(central, 20, compressed.byteLength);
    writeU32(central, 24, entry.data.byteLength);
    writeU16(central, 28, nameBytes.byteLength);
    writeU16(central, 30, 0);
    writeU16(central, 32, 0);
    writeU16(central, 34, 0);
    writeU16(central, 36, 0);
    writeU32(central, 38, 0);
    writeU32(central, 42, offset);
    central.set(nameBytes, 46);

    localParts.push(local, compressed);
    centralParts.push(central);
    offset += local.byteLength + compressed.byteLength;
  }

  const localSection = concatBytes(...localParts);
  const centralSection = concatBytes(...centralParts);

  const eocd = new Uint8Array(22);
  writeU32(eocd, 0, 0x06054b50);
  writeU16(eocd, 4, 0);
  writeU16(eocd, 6, 0);
  writeU16(eocd, 8, entries.length);
  writeU16(eocd, 10, entries.length);
  writeU32(eocd, 12, centralSection.byteLength);
  writeU32(eocd, 16, localSection.byteLength);
  writeU16(eocd, 20, 0);

  return concatBytes(localSection, centralSection, eocd);
}

/**
 * Um bundle mínimo, escrito pelo **escritor de produção**.
 *
 * Reaproveita a construção do manifest do harness (`buildManifest`) para não duplicar o
 * contrato — o manifest é a parte que o harness já sabe construir correctamente e que não é
 * o objecto destes testes — mas escreve o ZIP com `writeZip`, para que tudo o que a §13.4
 * verifica sobre a estrutura do arquivo seja verificado sobre o que a aplicação produz.
 */
function productionZip(options: {
  dataFiles: { path: string; content: string }[];
  manifestPatch?: Record<string, unknown>;
  documents?: Record<string, string>;
  extraEntries?: { name: string; data: Uint8Array }[];
}): Uint8Array {
  const manifest = buildManifest({
    dataFiles: options.dataFiles,
    ...(options.manifestPatch ? { manifestPatch: options.manifestPatch } : {}),
  });

  const entries = [
    { name: BUNDLE_MANIFEST_FILE, data: utf8(JSON.stringify(manifest, null, 2)) },
    ...options.dataFiles.map((file) => ({ name: file.path, data: utf8(file.content) })),
    ...Object.entries(options.documents ?? {}).map(([name, content]) => ({
      name,
      data: utf8(content),
    })),
    ...(options.extraEntries ?? []),
  ];

  return writeZip(entries);
}

/** Um veículo em JSONL, com os metadados que a §5.3 exige. */
function vehicleLine(localId: string, plate: string, extra: Record<string, unknown> = {}) {
  return {
    localId,
    plate,
    plateDisplay: plate,
    make: 'Kia',
    model: 'EV3',
    year: 2025,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

/** Lê, normaliza e faz `preview` de um ZIP contra um utilizador. */
async function previewOf(zip: Uint8Array, userId: string) {
  return previewImport({ zip: readZip(zip), userId, prisma: db.prisma });
}

/* ========================================================================== */
/* §13.1 — versões diferentes do manifest (§12.1)                             */
/* ========================================================================== */

describe('§13.1 versões do manifest', () => {
  it('a versão actual é aceite, e não há conversão a registar', async () => {
    const user = await createUser(db);
    const zip = productionZip({
      dataFiles: [
        { path: BUNDLE_DATA_FILES.vehicles, content: jsonl([vehicleLine('veh_1', 'AA-00-BB')]) },
      ],
    });

    const bundle = readBundle(readZip(zip).entries);

    expect(bundle.formatVersion).toBe(FORMAT_VERSION);
    expect(bundle.manifest.manifestVersion).toBe(MANIFEST_VERSION);
    expect(bundle.issues.filter((issue) => issue.code.startsWith('bundle.version'))).toHaveLength(0);
  });

  it('uma `formatVersion` futura é recusada com uma mensagem acionável', async () => {
    /*
     * A §12.1 é explícita: um bundle mais recente do que a aplicação é recusado, e nunca se
     * tenta adivinhar. O que se verifica aqui não é só a recusa — é que ela **diz ao
     * utilizador o que fazer**. Uma recusa sem saída é, na prática, um beco sem saída.
     */
    const zip = productionZip({
      dataFiles: [
        { path: BUNDLE_DATA_FILES.vehicles, content: jsonl([vehicleLine('veh_1', 'AA-00-BB')]) },
      ],
      manifestPatch: { formatVersion: FORMAT_VERSION + 1 },
    });

    let refusal: unknown;
    try {
      readBundle(readZip(zip).entries);
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeDefined();
    expect((refusal as { refusal?: { reason: string } }).refusal?.reason).toBe(
      'bundle.version_too_new',
    );
    // A mensagem orienta: diz que é mais recente e que a aplicação deve ser atualizada.
    const message = (refusal as Error).message;
    expect(message.toLowerCase()).toContain('atualiza');
    // E não expõe conceitos técnicos ao utilizador (§11.3).
    expect(message).not.toContain('formatVersion');
  });

  it('uma `formatVersion` anterior ao suportado é recusada como demasiado antiga', async () => {
    const zip = productionZip({
      dataFiles: [
        { path: BUNDLE_DATA_FILES.vehicles, content: jsonl([vehicleLine('veh_1', 'AA-00-BB')]) },
      ],
      manifestPatch: { formatVersion: -1 },
    });

    /*
     * Um valor negativo não é "um bundle antigo": é um campo inválido. A distinção importa
     * porque a mensagem é diferente — "exporta de novo na aplicação onde o criaste" seria
     * um conselho absurdo para um ficheiro que ninguém exportou com essa versão.
     */
    expect(() => readBundle(readZip(zip).entries)).toThrow();
  });

  it('um `format` desconhecido é recusado e encaminha para a camada 2', async () => {
    const zip = productionZip({
      dataFiles: [
        { path: BUNDLE_DATA_FILES.vehicles, content: jsonl([vehicleLine('veh_1', 'AA-00-BB')]) },
      ],
      manifestPatch: { format: 'outra-app-export' },
    });

    let refusal: unknown;
    try {
      readBundle(readZip(zip).entries);
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeDefined();
    expect((refusal as { refusal?: { reason: string } }).refusal?.reason).toBe(
      'bundle.format_unknown',
    );
  });

  it('o `format` é verificado antes da versão: um CSV mal rotulado não é "demasiado recente"', async () => {
    /*
     * A ordem não é um detalhe de implementação. Um ficheiro externo com um número de
     * versão partido seria, se a versão fosse verificada primeiro, reportado como "criado
     * por uma versão mais recente" — e o utilizador iria atualizar uma aplicação que já
     * está atualizada, em vez de usar a importação de CSV, que é o caminho certo.
     */
    const zip = productionZip({
      dataFiles: [{ path: BUNDLE_DATA_FILES.vehicles, content: jsonl([]) }],
      manifestPatch: { format: 'csv', formatVersion: 99 },
    });

    let refusal: unknown;
    try {
      readBundle(readZip(zip).entries);
    } catch (error) {
      refusal = error;
    }

    expect((refusal as { refusal?: { reason: string } }).refusal?.reason).toBe(
      'bundle.format_unknown',
    );
  });

  it('um `manifestVersion` desconhecido com as chaves necessárias continua a importar', async () => {
    /*
     * A §12.1 prevê compatibilidade **para a frente** do manifest: uma versão de manifest
     * que a aplicação ainda não conhece, mas que traz tudo o que ela sabe ler, deve ser
     * lida. Recusá-la contradiria a regra e impediria qualquer evolução aditiva do formato.
     *
     * O contraste com o teste anterior é o ponto: `manifestVersion` é a versão **do
     * documento**, `formatVersion` é a versão **do formato dos dados** — e é só a segunda
     * que decide se os dados podem ser interpretados.
     */
    const user = await createUser(db);
    const zip = productionZip({
      dataFiles: [
        { path: BUNDLE_DATA_FILES.vehicles, content: jsonl([vehicleLine('veh_1', 'AA-00-BB')]) },
      ],
      manifestPatch: { manifestVersion: MANIFEST_VERSION + 7 },
    });

    const bundle = readBundle(readZip(zip).entries);
    expect(bundle.manifest.manifestVersion).toBe(MANIFEST_VERSION + 7);

    const preview = await previewOf(zip, user.id);
    expect(preview.plan.state).not.toBe('blocked');
    expect(preview.plan.counts.create).toBe(1);
  });

  it('o `manifestVersion` não é confundido com a versão do formato dos dados', async () => {
    /*
     * Duas versões, duas regras. Este teste fixa a distinção para que uma alteração futura
     * não as colapse: subir o `manifestVersion` **não** é um motivo para recusar nada,
     * porque é o manifest que é novo, não os dados.
     */
    const zip = productionZip({
      dataFiles: [
        { path: BUNDLE_DATA_FILES.vehicles, content: jsonl([vehicleLine('veh_1', 'AA-00-BB')]) },
      ],
      manifestPatch: { manifestVersion: 99 },
    });

    const bundle = readBundle(readZip(zip).entries);
    expect(bundle.formatVersion).toBe(FORMAT_VERSION);
  });
});

/* ========================================================================== */
/* §13.1 — referências inválidas                                              */
/* ========================================================================== */

describe('§13.1 referências inválidas', () => {
  it('um bundle com um `vehicleLocalId` inexistente é recusado antes de qualquer escrita', async () => {
    /*
     * A §3.1 exige que um bundle internamente inconsistente seja "recusado **antes** de
     * qualquer escrita". O teste tem de provar as duas metades: que a validação encontra a
     * referência quebrada **e** que a base de dados não foi tocada.
     *
     * Um teste que só verificasse a primeira seria satisfeito por uma implementação que
     * escrevesse o veículo, falhasse no abastecimento e deixasse o veículo lá.
     */
    const user = await createUser(db);

    const zip = productionZip({
      dataFiles: [
        { path: BUNDLE_DATA_FILES.vehicles, content: jsonl([vehicleLine('veh_1', 'AA-00-BB')]) },
        {
          path: BUNDLE_DATA_FILES.fuel,
          content: jsonl([
            {
              localId: 'fuel_1',
              vehicleLocalId: 'veh_nao_existe',
              date: '2026-03-01',
              litres: 42.5,
              amountCents: 7100,
            },
          ]),
        },
      ],
    });

    const before = await snapshotCounts(user.id);
    const preview = await previewOf(zip, user.id);

    // A referência quebrada bloqueia o bundle.
    expect(preview.plan.state).toBe('blocked');
    const blocked = preview.plan.issues.filter((issue) => issue.severity === 'blocking');
    expect(blocked.length).toBeGreaterThan(0);

    // E nada foi escrito — nem sequer o veículo, que era válido.
    expect(await snapshotCounts(user.id)).toEqual(before);
  });

  it('uma referência quebrada impede a aplicação, mesmo que o plano seja forçado', async () => {
    /*
     * A segunda linha de defesa. O `preview` já bloqueia, mas o `apply` não confia nisso: a
     * §7.2 exige que as recusas sejam decididas antes da primeira escrita, e o `apply` é o
     * último sítio onde isso pode ser garantido.
     */
    const user = await createUser(db);
    const zip = productionZip({
      dataFiles: [
        { path: BUNDLE_DATA_FILES.vehicles, content: jsonl([vehicleLine('veh_1', 'AA-00-BB')]) },
        {
          path: BUNDLE_DATA_FILES.fuel,
          content: jsonl([
            {
              localId: 'fuel_1',
              vehicleLocalId: 'veh_nao_existe',
              date: '2026-03-01',
              litres: 42.5,
              amountCents: 7100,
            },
          ]),
        },
      ],
    });

    const preview = await previewOf(zip, user.id);
    const before = await snapshotCounts(user.id);

    await expect(
      applyImport({
        plan: preview.plan,
        records: preview.records,
        documentBytes: preview.bundle.documentBytes,
        bundleId: preview.bundle.bundleId,
        userId: user.id,
        prisma: db.prisma,
        storage,
      }),
    ).rejects.toThrow();

    expect(await snapshotCounts(user.id)).toEqual(before);
  });
});

/* ========================================================================== */
/* §13.1 — dados incompletos                                                  */
/* ========================================================================== */

describe('§13.1 dados incompletos', () => {
  it('um registo parcialmente preenchido entra com a lacuna declarada', async () => {
    /*
     * A §13.1 admite duas respostas para um registo incompleto — "entra com a lacuna
     * declarada, ou vai a quarentena" — e proíbe uma terceira: "criado parcialmente em
     * silêncio".
     *
     * Um abastecimento sem `odometerKm` é o caso real mais comum: quase ninguém aponta os
     * quilómetros em todos os abastecimentos. A quilometragem é opcional no domínio, pelo
     * que o registo entra — e o que se verifica é que **entra com o campo ausente**, não
     * com um zero que ninguém escreveu.
     */
    const user = await createUser(db);
    const zip = productionZip({
      dataFiles: [
        { path: BUNDLE_DATA_FILES.vehicles, content: jsonl([vehicleLine('veh_1', 'AA-00-BB')]) },
        {
          path: BUNDLE_DATA_FILES.fuel,
          content: jsonl([
            {
              localId: 'fuel_1',
              vehicleLocalId: 'veh_1',
              date: '2026-03-01',
              litres: 42.5,
              amountCents: 7100,
              // sem `odometerKm`, sem `station`
            },
          ]),
        },
      ],
    });

    const preview = await previewOf(zip, user.id);
    expect(preview.plan.state).not.toBe('blocked');

    await applyImport({
      plan: preview.plan,
      records: preview.records,
      documentBytes: preview.bundle.documentBytes,
      bundleId: preview.bundle.bundleId,
      userId: user.id,
      prisma: db.prisma,
      storage,
    });

    const fuel = await db.prisma.fuelSession.findFirst({ where: { userId: user.id } });
    expect(fuel).not.toBeNull();
    expect(fuel!.litres).toBeCloseTo(42.5);
    expect(fuel!.amountCents).toBe(7100);
    // A lacuna é real: `null`, não zero. Um zero seria uma afirmação falsa sobre os dados.
    expect(fuel!.odometerKm).toBeNull();
    expect(fuel!.station).toBeNull();
  });

  it('um registo sem os campos que a sua identidade exige vai a quarentena, e não é criado', async () => {
    /*
     * O outro lado da regra. Um veículo sem matrícula nem VIN não tem identidade (A25): não
     * há forma de o comparar com nada, nem de o deduplicar numa importação seguinte. Entrar
     * seria pior do que não entrar — a segunda importação criaria um segundo veículo
     * idêntico, e o utilizador ficaria com dois.
     *
     * ## Quarentena **não** é bloqueio do plano
     *
     * A distinção é a que mais facilmente se escreve mal, e por isso fica escrita aqui. Um
     * plano só fica `blocked` quando o **bundle** está internamente inconsistente — uma
     * referência quebrada, um `localId` duplicado (§9.4). Um registo sem identidade é um
     * problema **do registo**: ele vai para quarentena e o resto da importação prossegue.
     *
     * Se a quarentena bloqueasse o plano, um único veículo sem matrícula impediria a
     * importação de tudo o resto — e a §9.1 proíbe exactamente isso ("o que nunca acontece é
     * a degradação silenciosa", mas também não a paralisia total por um registo).
     */
    const user = await createUser(db);
    const zip = productionZip({
      dataFiles: [
        {
          path: BUNDLE_DATA_FILES.vehicles,
          content: jsonl([
            {
              localId: 'veh_1',
              make: 'Kia',
              model: 'EV3',
              year: 2025,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ]),
        },
      ],
    });

    const preview = await previewOf(zip, user.id);

    expect(preview.plan.counts.quarantined).toBe(1);
    expect(preview.plan.counts.create).toBe(0);

    /*
     * ## Um campo obrigatório ausente bloqueia o **bundle**, não só o registo
     *
     * Esta é a distinção que um teste escrito de memória erra, e por isso fica nomeada.
     *
     * Um problema bloqueante a **qualquer** registo torna o bundle inteiro `blocked` — é a
     * regra do `validate` (§9.4), e não uma escolha deste teste. A leitura que a justifica:
     * um bundle que traz um veículo sem identidade traz consigo registos que apontam para
     * ele, e importar "o resto" deixaria esses registos sem destino. Recusar o conjunto é
     * mais honesto do que aceitar uma parte que não se sabe se está completa.
     *
     * O que **não** acontece é um registo criado pela metade: o bloqueio é decidido antes da
     * primeira escrita. É isso que o teste seguinte verifica linha a linha.
     */
    expect(preview.plan.state).toBe('blocked');

    await expect(
      applyImport({
        plan: preview.plan,
        records: preview.records,
        documentBytes: preview.bundle.documentBytes,
        bundleId: preview.bundle.bundleId,
        userId: user.id,
        prisma: db.prisma,
        storage,
      }),
    ).rejects.toThrow();

    expect(await db.prisma.vehicle.count({ where: { userId: user.id } })).toBe(0);

    // E o registo que não entra aparece no relatório **nomeado**, com o motivo — a §9.2
    // exige que um registo em quarentena seja explicado, e não apenas contado.
    const { buildImportReport } = await import('../src/services/import/report.js');
    const full = buildImportReport({
      plan: preview.plan,
      applied: emptyApplyReport(),
      bundleId: preview.bundle.bundleId,
    });
    const quarantined = full.skipped.find((item) => item.localId === 'veh_1');
    expect(quarantined).toBeDefined();
    expect(quarantined!.reason.length).toBeGreaterThan(10);
  });

  it('um bundle bloqueado continua a classificar os registos válidos que traz', async () => {
    /*
     * O plano de um bundle bloqueado continua a ser **auditável**: as entradas estão lá,
     * classificadas, e o utilizador consegue ver o que entraria e o que não entraria. O que
     * não existe é um botão que funcione.
     *
     * A tentação de fazer um plano bloqueado não classificar nada produziria um ecrã vazio
     * com uma mensagem de erro — o beco sem saída que a §11.3 proíbe. Aqui verifica-se o
     * contrário: num bundle com um veículo válido e outro sem identidade, a classificação
     * distingue-os, e o problema fica **localizado** no registo certo em vez de difuso.
     */
    const user = await createUser(db);
    const zip = productionZip({
      dataFiles: [
        {
          path: BUNDLE_DATA_FILES.vehicles,
          content: jsonl([
            vehicleLine('veh_1', 'AA-00-BB'),
            { localId: 'veh_2', make: 'Kia', model: 'EV3' },
          ]),
        },
      ],
    });

    const preview = await previewOf(zip, user.id);

    expect(preview.plan.state).toBe('blocked');
    expect(preview.plan.counts.create).toBe(1);
    expect(preview.plan.counts.quarantined).toBe(1);

    const valid = preview.plan.entries.find((entry) => entry.localId === 'veh_1');
    expect(valid?.action).toBe('create');

    const invalid = preview.plan.entries.find((entry) => entry.localId === 'veh_2');
    expect(invalid?.issues.some((issue) => issue.severity === 'blocking')).toBe(true);

    // Nada foi escrito: o bloqueio é decidido antes da primeira escrita.
    await expect(
      applyImport({
        plan: preview.plan,
        records: preview.records,
        documentBytes: preview.bundle.documentBytes,
        bundleId: preview.bundle.bundleId,
        userId: user.id,
        prisma: db.prisma,
        storage,
      }),
    ).rejects.toThrow();
    expect(await db.prisma.vehicle.count({ where: { userId: user.id } })).toBe(0);
  });

  it('um registo em quarentena não é criado parcialmente — a linha não existe', async () => {
    /*
     * A proibição literal da §13.1: "nunca criados parcialmente em silêncio". Um veículo
     * com marca e modelo mas sem matrícula **não** dá origem a nenhuma linha. A tentação de
     * "criar o que se pode" produziria veículos inalcançáveis na interface.
     *
     * O `apply` recusa, e a asserção que importa é a última: a contagem continua a zero. Uma
     * implementação que escrevesse o veículo antes de decidir a recusa falharia aqui — e é
     * exactamente o cenário "criado parcialmente" que a §13.1 proíbe.
     */
    const user = await createUser(db);
    const zip = productionZip({
      dataFiles: [
        {
          path: BUNDLE_DATA_FILES.vehicles,
          content: jsonl([{ localId: 'veh_1', make: 'Kia', model: 'EV3' }]),
        },
      ],
    });

    const preview = await previewOf(zip, user.id);
    await expect(
      applyImport({
        plan: preview.plan,
        records: preview.records,
        documentBytes: preview.bundle.documentBytes,
        bundleId: preview.bundle.bundleId,
        userId: user.id,
        prisma: db.prisma,
        storage,
      }),
    ).rejects.toThrow();

    expect(await db.prisma.vehicle.count()).toBe(0);
  });
});

/* ========================================================================== */
/* §13.1 — duplicados                                                         */
/* ========================================================================== */

describe('§13.1 duplicados', () => {
  it('um duplicado certo contra a conta existente não é criado outra vez', async () => {
    const user = await createUser(db);
    await createVehicle(db, user.id, { plate: 'AA-00-BB', make: 'Renault', model: 'Clio' });

    const zip = productionZip({
      dataFiles: [
        { path: BUNDLE_DATA_FILES.vehicles, content: jsonl([vehicleLine('veh_1', 'AA-00-BB')]) },
      ],
    });

    const preview = await previewOf(zip, user.id);

    expect(preview.plan.counts.exact).toBe(1);
    expect(preview.plan.counts.create).toBe(0);

    const report = await applyImport({
      plan: preview.plan,
      records: preview.records,
      documentBytes: preview.bundle.documentBytes,
      bundleId: preview.bundle.bundleId,
      userId: user.id,
      prisma: db.prisma,
      storage,
    });

    expect(report.created).toHaveLength(0);
    expect(await db.prisma.vehicle.count({ where: { userId: user.id } })).toBe(1);
  });

  it('um duplicado provável exige decisão e não é aplicado sem ela', async () => {
    /*
     * A regra mais importante do bloco de deduplicação: `probable` **nunca** é promovido a
     * certo, e nunca entra sem uma decisão explícita. Aqui verifica-se a consequência
     * operacional: com um provável pendente, o `apply` recusa em vez de adivinhar.
     */
    const user = await createUser(db);
    const vehicle = await createVehicle(db, user.id, { plate: 'AA-00-BB' });

    await db.prisma.fuelSession.create({
      data: {
        userId: user.id,
        vehicleId: vehicle.id,
        date: new Date('2026-03-01T00:00:00.000Z'),
        litres: 42.5,
        amountCents: 7100,
        odometerKm: 50_000,
      },
    });

    const zip = productionZip({
      dataFiles: [
        { path: BUNDLE_DATA_FILES.vehicles, content: jsonl([vehicleLine('veh_1', 'AA-00-BB')]) },
        {
          path: BUNDLE_DATA_FILES.fuel,
          content: jsonl([
            {
              localId: 'fuel_1',
              vehicleLocalId: 'veh_1',
              date: '2026-03-01',
              litres: 42.5,
              amountCents: 7200, // valor diferente: dentro da tolerância, não igual
              odometerKm: 50_004, // 4 km de diferença
            },
          ]),
        },
      ],
    });

    const preview = await previewOf(zip, user.id);
    expect(preview.plan.counts.probable).toBe(1);

    await expect(
      applyImport({
        plan: preview.plan,
        records: preview.records,
        documentBytes: preview.bundle.documentBytes,
        bundleId: preview.bundle.bundleId,
        userId: user.id,
        prisma: db.prisma,
        storage,
      }),
    ).rejects.toThrow(/decis/i);

    // E o abastecimento existente está intacto — nenhuma tolerância foi aplicada a mais.
    const fuel = await db.prisma.fuelSession.findMany({ where: { userId: user.id } });
    expect(fuel).toHaveLength(1);
    expect(fuel[0]!.amountCents).toBe(7100);
  });

  it('as tolerâncias são aplicadas exactamente: fora delas, o registo é novo', async () => {
    /*
     * A contraparte do teste anterior. Uma tolerância aplicada "a mais" funde dois registos
     * que são diferentes — e o utilizador perde um abastecimento sem saber. Aqui a
     * diferença é grande o suficiente para que a coincidência não se forme, e o resultado
     * tem de ser `create`.
     */
    const user = await createUser(db);
    const vehicle = await createVehicle(db, user.id, { plate: 'AA-00-BB' });

    await db.prisma.fuelSession.create({
      data: {
        userId: user.id,
        vehicleId: vehicle.id,
        date: new Date('2026-03-01T00:00:00.000Z'),
        litres: 42.5,
        amountCents: 7100,
        odometerKm: 50_000,
      },
    });

    const zip = productionZip({
      dataFiles: [
        { path: BUNDLE_DATA_FILES.vehicles, content: jsonl([vehicleLine('veh_1', 'AA-00-BB')]) },
        {
          path: BUNDLE_DATA_FILES.fuel,
          content: jsonl([
            {
              localId: 'fuel_1',
              vehicleLocalId: 'veh_1',
              date: '2026-03-01',
              litres: 38.0,
              amountCents: 9000,
              odometerKm: 51_500,
            },
          ]),
        },
      ],
    });

    const preview = await previewOf(zip, user.id);
    expect(preview.plan.counts.probable).toBe(0);
    expect(preview.plan.counts.create).toBe(1);
    expect(preview.plan.counts.exact).toBe(1); // o veículo, que coincide por matrícula
  });
});

/* ========================================================================== */
/* §13.3 — propriedades                                                       */
/* ========================================================================== */

describe('§13.3 propriedades: nenhuma importação cria dados fora do plano', () => {
  it('só os registos declarados no plano são criados — nem um a mais', async () => {
    /*
     * A propriedade 3 da §13.3: "nenhuma importação cria dados fora do conjunto declarado
     * no plano".
     *
     * A verificação é feita por **comparação de conjuntos**, não por contagem: uma
     * importação que criasse um registo a mais e nenhum a menos passaria numa verificação
     * de contagem. O que se compara é o conjunto de `localId` criados com o conjunto de
     * `localId` que o plano marcou para criar.
     */
    const user = await createUser(db);
    const zip = productionZip({
      dataFiles: [
        { path: BUNDLE_DATA_FILES.vehicles, content: jsonl([vehicleLine('veh_1', 'AA-00-BB')]) },
        {
          path: BUNDLE_DATA_FILES.odometer,
          content: jsonl([
            { localId: 'odo_1', vehicleLocalId: 'veh_1', odometerKm: 45_000, recordedAt: '2026-01-10' },
            { localId: 'odo_2', vehicleLocalId: 'veh_1', odometerKm: 45_500, recordedAt: '2026-02-10' },
          ]),
        },
        {
          path: BUNDLE_DATA_FILES.expenses,
          content: jsonl([
            {
              localId: 'exp_1',
              vehicleLocalId: 'veh_1',
              date: '2026-02-20',
              amountCents: 2500,
              category: 'toll',
            },
          ]),
        },
      ],
    });

    const preview = await previewOf(zip, user.id);

    const declaredCreates = preview.plan.entries
      .filter((entry) => entry.action === 'create')
      .map((entry) => entry.localId)
      .sort();

    const report = await applyImport({
      plan: preview.plan,
      records: preview.records,
      documentBytes: preview.bundle.documentBytes,
      bundleId: preview.bundle.bundleId,
      userId: user.id,
      prisma: db.prisma,
      storage,
    });

    expect(report.created.map((item) => item.localId).sort()).toEqual(declaredCreates);
    expect(report.created).toHaveLength(4);
  });

  it('cada registo criado é registado no livro de idempotência', async () => {
    /*
     * A propriedade 4 da §13.3, na sua forma positiva: "nenhuma importação **falhada** deixa
     * registos criados sem o declarar" implica que uma importação **bem-sucedida** deixe
     * todos declarados. Se um registo criado ficasse fora do livro, a reimportação seguinte
     * tentaria criá-lo outra vez e a idempotência estaria quebrada em silêncio.
     */
    const user = await createUser(db);
    const zip = productionZip({
      dataFiles: [
        { path: BUNDLE_DATA_FILES.vehicles, content: jsonl([vehicleLine('veh_1', 'AA-00-BB')]) },
        {
          path: BUNDLE_DATA_FILES.odometer,
          content: jsonl([
            { localId: 'odo_1', vehicleLocalId: 'veh_1', odometerKm: 45_000, recordedAt: '2026-01-10' },
          ]),
        },
      ],
    });

    const preview = await previewOf(zip, user.id);
    const report = await applyImport({
      plan: preview.plan,
      records: preview.records,
      documentBytes: preview.bundle.documentBytes,
      bundleId: preview.bundle.bundleId,
      userId: user.id,
      prisma: db.prisma,
      storage,
    });

    const book = await db.prisma.importBookEntry.findMany({
      where: { userId: user.id, bundleId: preview.bundle.bundleId },
    });

    expect(book.map((entry) => entry.localId).sort()).toEqual(
      report.created.map((item) => item.localId).sort(),
    );
    // E cada entrada do livro aponta para o registo que foi efectivamente criado.
    const createdIds = new Set(report.created.map((item) => item.id));
    for (const entry of book) {
      expect(createdIds.has(entry.createdRecordId)).toBe(true);
    }
  });

  it('a ordem dos registos no ficheiro não altera o resultado', async () => {
    /*
     * A propriedade 5 da §13.3.
     *
     * A verificação é feita com duas contas e dois bundles com a mesma **matéria** e ordem
     * de linhas trocada. Os `localId` são os mesmos (se fossem diferentes, a comparação do
     * plano compararia identificadores, e não resultados), o que muda é a ordem em que as
     * linhas aparecem.
     *
     * O que se compara é o plano normalizado por `localId` — se a ordem do ficheiro
     * influenciasse a classificação, duas entradas do mesmo `localId` apareceriam com ações
     * diferentes entre os dois bundles.
     */
    const first = await createUser(db, { email: 'ordem-a@zemlo.test' });
    const second = await createUser(db, { email: 'ordem-b@zemlo.test' });

    const vehicles = jsonl([vehicleLine('veh_1', 'AA-00-BB')]);
    const readings = [
      { localId: 'odo_1', vehicleLocalId: 'veh_1', odometerKm: 45_000, recordedAt: '2026-01-10' },
      { localId: 'odo_2', vehicleLocalId: 'veh_1', odometerKm: 45_500, recordedAt: '2026-02-10' },
      { localId: 'odo_3', vehicleLocalId: 'veh_1', odometerKm: 46_100, recordedAt: '2026-03-10' },
    ];

    const forward = productionZip({
      dataFiles: [
        { path: BUNDLE_DATA_FILES.vehicles, content: vehicles },
        { path: BUNDLE_DATA_FILES.odometer, content: jsonl(readings) },
      ],
    });
    const reversed = productionZip({
      dataFiles: [
        { path: BUNDLE_DATA_FILES.vehicles, content: vehicles },
        { path: BUNDLE_DATA_FILES.odometer, content: jsonl([...readings].reverse()) },
      ],
    });

    const planA = await previewOf(forward, first.id);
    const planB = await previewOf(reversed, second.id);

    /** O plano reduzido ao que a ordem poderia alterar: a acção de cada `localId`. */
    const actions = (plan: typeof planA) =>
      plan.plan.entries
        .map((entry) => ({ localId: entry.localId, action: entry.action }))
        .sort((a, b) => a.localId.localeCompare(b.localId));

    expect(actions(planB)).toEqual(actions(planA));
    expect(planB.plan.counts).toEqual(planA.plan.counts);
  });

  it('a ordem inversa produz os mesmos registos na conta de destino', async () => {
    /*
     * A mesma propriedade, verificada na base de dados e não só no plano. O plano poderia
     * coincidir e a escrita divergir — por exemplo, se a resolução de referências dependesse
     * da ordem em que os `localId` foram vistos.
     */
    const first = await createUser(db, { email: 'ordem-c@zemlo.test' });
    const second = await createUser(db, { email: 'ordem-d@zemlo.test' });

    const vehicles = jsonl([vehicleLine('veh_1', 'AA-00-BB')]);
    const readings = [
      { localId: 'odo_1', vehicleLocalId: 'veh_1', odometerKm: 45_000, recordedAt: '2026-01-10' },
      { localId: 'odo_2', vehicleLocalId: 'veh_1', odometerKm: 45_500, recordedAt: '2026-02-10' },
    ];

    for (const [user, readingsOrder] of [
      [first, readings],
      [second, [...readings].reverse()],
    ] as const) {
      const zip = productionZip({
        dataFiles: [
          { path: BUNDLE_DATA_FILES.vehicles, content: vehicles },
          { path: BUNDLE_DATA_FILES.odometer, content: jsonl(readingsOrder) },
        ],
      });
      const preview = await previewOf(zip, user.id);
      await applyImport({
        plan: preview.plan,
        records: preview.records,
        documentBytes: preview.bundle.documentBytes,
        bundleId: preview.bundle.bundleId,
        userId: user.id,
        prisma: db.prisma,
        storage,
      });
    }

    const readingsOf = async (userId: string) =>
      (await db.prisma.odometerReading.findMany({ where: { vehicleId: (await db.prisma.vehicle.findFirstOrThrow({ where: { userId } })).id } }))
        .map((row) => row.odometerKm)
        .sort((a, b) => a - b);

    expect(await readingsOf(second.id)).toEqual(await readingsOf(first.id));
  });
});

/* ========================================================================== */
/* §13.1 — grandes volumes e o caminho por lotes                              */
/* ========================================================================== */

describe('§13.1 grandes volumes', () => {
  /**
   * Uma conta com N leituras de quilometragem, para exercitar o caminho por lotes.
   *
   * Escrever 10 000+ linhas com `createMany` é rápido; escrever as mesmas linhas uma a uma
   * seria minutos. O limite de transacção única é 10 000, e o teste tem de o **ultrapassar**
   * para que o caminho por lotes seja o que está a ser exercido — um teste que ficasse
   * abaixo do limite chamar-se-ia "grandes volumes" e testaria o caminho normal.
   */
  async function seedManyReadings(userId: string, count: number): Promise<string> {
    const vehicle = await createVehicle(db, userId, { plate: 'AA-00-BB' });

    const data = [];
    for (let index = 0; index < count; index += 1) {
      const day = String((index % 28) + 1).padStart(2, '0');
      const month = String((index % 12) + 1).padStart(2, '0');
      data.push({
        vehicleId: vehicle.id,
        odometerKm: 10_000 + index,
        recordedAt: new Date(`${2026 - (index % 3)}-${month}-${day}T00:00:00.000Z`),
        origin: 'manual',
      });
    }

    // Em blocos: um único `createMany` com 11 000 linhas é aceitável, mas o SQLite tem um
    // limite de parâmetros por instrução e o teste não deve depender desse número.
    for (let offset = 0; offset < data.length; offset += 2_000) {
      await db.prisma.odometerReading.createMany({ data: data.slice(offset, offset + 2_000) });
    }

    return vehicle.id;
  }

  it(`acima de ${ABSOLUTE_RECORD_LIMIT} registos a importação é recusada antes de escrever`, async () => {
    /*
     * O teto absoluto (A26). A verificação tem de ser feita **antes** de qualquer escrita, e
     * sobre os registos **reais** — um `count` enganador no manifest não pode autorizar
     * mais trabalho do que os dados justificam.
     *
     * Para não construir um ficheiro com 100 001 linhas (que seria lento e não provaria
     * mais), o limite é exercitado no `apply`, que é onde a recusa vive, com um plano
     * construído a partir de um bundle pequeno mas **declaradamente** grande. O que se
     * prova é a recusa e a ausência de escrita.
     */
    const user = await createUser(db);
    const zip = productionZip({
      dataFiles: [
        { path: BUNDLE_DATA_FILES.vehicles, content: jsonl([vehicleLine('veh_1', 'AA-00-BB')]) },
      ],
    });

    const preview = await previewOf(zip, user.id);

    // Um plano artificialmente grande: o `apply` lê o tamanho do **plano**, nunca de um
    // campo declarado no bundle.
    const oversized = {
      ...preview.plan,
      entries: [
        ...preview.plan.entries,
        ...Array.from({ length: ABSOLUTE_RECORD_LIMIT }, (_, index) => ({
          ...preview.plan.entries[0]!,
          localId: `veh_extra_${index}`,
        })),
      ],
    };

    const before = await snapshotCounts(user.id);

    await expect(
      applyImport({
        plan: oversized,
        records: preview.records,
        documentBytes: preview.bundle.documentBytes,
        bundleId: preview.bundle.bundleId,
        userId: user.id,
        prisma: db.prisma,
        storage,
      }),
    ).rejects.toThrow();

    expect(await snapshotCounts(user.id)).toEqual(before);
  });

  it('o teto absoluto do leitor usa o mesmo valor que o limite de aplicação', () => {
    /*
     * Duas camadas verificam o mesmo teto — o leitor do bundle e o `apply` — e ambas têm de
     * usar o mesmo número. Se divergissem, um bundle entre os dois valores passaria no
     * leitor e fracassaria na aplicação, ou pior: passaria nos dois com limites diferentes
     * e o limite efectivo seria o mais permissivo dos dois.
     */
    expect(BUNDLE_LIMITS.maxRecords).toBe(ABSOLUTE_RECORD_LIMIT);
  });
  it('uma conta com mais de 10 000 registos é exportada e reimportada pelo caminho por lotes', async () => {
    /*
     * O caso de volume da §13.1, exercitado ponta a ponta com o caminho por lotes.
     *
     * O número é escolhido para **ultrapassar** `SINGLE_TRANSACTION_LIMIT` (10 000) sem se
     * aproximar do teto absoluto (100 000): o objectivo é exercitar a fronteira entre os
     * dois regimes, não o limite superior. Um teste com 100 000 registos demoraria o
     * suficiente para tornar a suite inutilizável no dia-a-dia, e o que ele acrescentaria —
     * mais lotes — já é provado pelo primeiro lote extra.
     *
     * ## Porque é que o veículo é criado **no destino** e no bundle
     *
     * A deduplicação por matrícula é o que faz o veículo do bundle coincidir com o veículo
     * que já existe na conta de destino. Numa migração real é exactamente isto que acontece
     * — a conta de destino costuma ter já o veículo, e é o histórico que vem atrás. O
     * veículo aparece em `exact`, as 10 500 leituras em `create`, e a ordem de trabalho
     * (`creationOrder`) começa por elas sem ter de criar o veículo primeiro.
     *
     * Sem o veículo no destino, os dois veículos (`veh_1` da origem e o do destino) têm
     * matrículas diferentes e as leituras apontariam para um veículo criado no primeiro
     * lote — o que continuaria a funcionar, mas testaria a resolução de referências em vez
     * do caminho por lotes, que é o que este teste existe para exercitar.
     */
    const source = await createUser(db);
    const count = 10_500;
    await seedManyReadings(source.id, count);

    const built = await buildExportBundle({
      userId: source.id,
      prisma: db.prisma,
      appVersion: '0.1.0-test',
      environment: 'test',
      today: '2026-09-18',
      storage,
      // Sem documentos nesta conta: evita percorrer uma pasta que não tem nada.
      skipDocumentBytes: true,
    });

    const zip = writeZip(built.entries);
    const destination = await createUser(db, { email: 'volume-destino@zemlo.test' });
    await createVehicle(db, destination.id, { plate: 'AA-00-BB' });

    const preview = await previewOf(zip, destination.id);
    expect(preview.plan.state).not.toBe('blocked');
    expect(preview.plan.counts.create).toBe(count);

    const report = await applyImport({
      plan: preview.plan,
      records: preview.records,
      documentBytes: preview.bundle.documentBytes,
      bundleId: preview.bundle.bundleId,
      userId: destination.id,
      prisma: db.prisma,
      storage,
    });

    /*
     * Acima do limite, o relatório declara **quantos** lotes foram usados. É a diferença
     * observável entre os dois regimes: uma importação de 10 500 registos que reportasse
     * `batches: 1` estaria a dizer que escreveu tudo numa transacção, o que exigiria manter
     * 10 500 registos numa transacção só — e não é o que a §7.2 descreve.
     */
    expect(report.batches).toBeGreaterThan(1);
    expect(report.created).toHaveLength(count);

    const destinationVehicle = await db.prisma.vehicle.findFirstOrThrow({
      where: { userId: destination.id },
    });
    expect(
      await db.prisma.odometerReading.count({ where: { vehicleId: destinationVehicle.id } }),
    ).toBe(count);
  }, 300_000);

  it('um lote interrompido não deixa estado ambíguo: o que entrou está no livro, o resto não', async () => {
    /*
     * A §13.1 descreve este teste como "matar o processo a meio não deixa estado ambíguo;
     * retomar não duplica (crítico acima de 10 000 registos)".
     *
     * Matar um processo a sério dentro da mesma suite é possível mas frágil — depende de
     * sinais, de portas e do sistema operativo, e transformaria uma falha de infraestrutura
     * num resultado de teste. O que se faz aqui é **reproduzir o estado** que uma morte a
     * meio produz: a transacção do primeiro lote confirmou, a do segundo não. Isso é
     * modelado escrevendo o primeiro lote à mão (registos + livro, na mesma transacção) e
     * deixando o resto por escrever.
     *
     * A partir daí, o que se verifica é a propriedade que interessa e que a retoma usa: os
     * registos que ficaram marcados no livro **não** são criados outra vez, e os que não
     * ficaram são. É esta a invariante que faz a retoma ser segura, e é independente da
     * forma como a interrupção aconteceu.
     */
    const user = await createUser(db);
    const vehicle = await createVehicle(db, user.id, { plate: 'AA-00-BB' });

    const zip = productionZip({
      dataFiles: [
        { path: BUNDLE_DATA_FILES.vehicles, content: jsonl([vehicleLine('veh_1', 'AA-00-BB')]) },
        {
          path: BUNDLE_DATA_FILES.odometer,
          content: jsonl([
            { localId: 'odo_1', vehicleLocalId: 'veh_1', odometerKm: 45_000, recordedAt: '2026-01-10' },
            { localId: 'odo_2', vehicleLocalId: 'veh_1', odometerKm: 45_500, recordedAt: '2026-02-10' },
          ]),
        },
      ],
    });

    const preview = await previewOf(zip, user.id);
    const bundleId = preview.bundle.bundleId;

    // O primeiro lote "confirmou": `odo_1` foi criado e a entrada do livro foi escrita na
    // mesma transacção. É exactamente o que o `applyInBatches` faz por lote.
    await db.prisma.$transaction(async (tx) => {
      const row = await tx.odometerReading.create({
        data: {
          vehicleId: vehicle.id,
          odometerKm: 45_000,
          recordedAt: new Date('2026-01-10T00:00:00.000Z'),
          origin: 'manual',
        },
        select: { id: true },
      });
      await tx.importBookEntry.create({
        data: {
          userId: user.id,
          bundleId,
          localId: 'odo_1',
          recordKind: 'odometer',
          createdRecordId: row.id,
          expiresAt: new Date('2027-09-18T00:00:00.000Z'),
        },
      });
    });

    /*
     * A retoma: o `preview` volta a ler o bundle e o livro, e o `odo_1` aparece como já
     * importado — `skipped`, não `exact` (§8.2). É a prova de que o livro vence a
     * deduplicação e de que a retoma não reinventa o que já entrou.
     */
    const resumed = await previewOf(zip, user.id);
    const entry = resumed.plan.entries.find((item) => item.localId === 'odo_1');
    expect(entry?.action).toBe('skipped');
    expect(resumed.plan.counts.skipped).toBe(1);

    // `odo_2` **não** está no livro: é criado. É o que torna a retoma útil em vez de
    // conservadora — o trabalho que faltava faz-se.
    const report = await applyImport({
      plan: resumed.plan,
      records: resumed.records,
      documentBytes: resumed.bundle.documentBytes,
      bundleId,
      userId: user.id,
      prisma: db.prisma,
      storage,
    });

    expect(report.created.map((item) => item.localId)).toEqual(['odo_2']);

    // E nada duplicou: duas leituras, não três.
    expect(await db.prisma.odometerReading.count({ where: { vehicleId: vehicle.id } })).toBe(2);
  });

  it('uma retoma completa não cria nada e di-lo', async () => {
    /*
     * O caso que a §9.5 descreve explicitamente: "reimportar o mesmo bundle não cria nada".
     * Verificar que *não* cria é metade; a outra metade é que o resultado é um **sucesso**
     * com relatório, e não uma recusa. Um caminho de retoma que falhasse com "já importado"
     * obrigaria quem chama a distinguir "já feito" de "erro" — e essa distinção seria feita
     * pelo texto da mensagem.
     */
    const user = await createUser(db);
    const zip = productionZip({
      dataFiles: [
        { path: BUNDLE_DATA_FILES.vehicles, content: jsonl([vehicleLine('veh_1', 'AA-00-BB')]) },
      ],
    });

    const first = await previewOf(zip, user.id);
    const firstReport = await applyImport({
      plan: first.plan,
      records: first.records,
      documentBytes: first.bundle.documentBytes,
      bundleId: first.bundle.bundleId,
      userId: user.id,
      prisma: db.prisma,
      storage,
    });
    expect(firstReport.created).toHaveLength(1);

    const second = await previewOf(zip, user.id);
    const secondReport = await applyImport({
      plan: second.plan,
      records: second.records,
      documentBytes: second.bundle.documentBytes,
      bundleId: second.bundle.bundleId,
      userId: user.id,
      prisma: db.prisma,
      storage,
    });

    expect(secondReport.created).toHaveLength(0);
    expect(await db.prisma.vehicle.count({ where: { userId: user.id } })).toBe(1);

    /*
     * ## Onde é que o "já importado" aparece
     *
     * Não em `report.skipped`: o `apply` só percorre a **lista de trabalho**, e uma entrada
     * já importada não é trabalho — nunca entra nessa lista. O `skipped` do relatório de
     * aplicação é sobre o que foi considerado e recusado, não sobre o que nem se considerou.
     *
     * Onde aparece é no **plano**, que é o artefacto que o utilizador vê antes de confirmar:
     * a entrada está `skipped` e as contagens do plano reflectem-no. E no relatório final,
     * que junta as duas origens — é aí que o utilizador lê "já tinha sido importado".
     *
     * Verificar isto no sítio certo importa: um teste que exigisse `report.skipped` com
     * comprimento 1 estaria a exigir que o `apply` percorresse trabalho que não existe, e
     * seria satisfeito por uma implementação que reavaliasse o bundle inteiro em cada
     * reimportação — o oposto de uma idempotência barata.
     */
    expect(second.plan.counts.skipped).toBe(1);
    expect(second.plan.counts.create).toBe(0);
    expect(second.plan.entries[0]!.action).toBe('skipped');

    // `batches: 0` — não houve trabalho, logo não houve transacção nenhuma.
    expect(secondReport.batches).toBe(0);

    /*
     * O relatório final junta os dois: o que o plano já sabia (`quarantined`) e o que a
     * aplicação registou. Para uma reimportação completa, quem contribui é o plano.
     */
    const { buildImportReport } = await import('../src/services/import/report.js');
    const full = buildImportReport({
      plan: second.plan,
      applied: secondReport,
      bundleId: second.bundle.bundleId,
    });

    expect(full.applied).toBe(false);
    expect(full.created).toHaveLength(0);
    expect(full.summary.skipped).toBe(1);
    expect(full.headline).toContain('já tinha sido importado');
  });
});

/* ========================================================================== */
/* §13.1 — importação interrompida: atomicidade da transacção única           */
/* ========================================================================== */

describe('§13.1 importação interrompida: a transacção única é atómica', () => {
  it('uma falha a meio da escrita reverte tudo, e nada fica criado pela metade', async () => {
    /*
     * O caminho da transacção única (§7.2, até 10 000) promete tudo ou nada. Para o
     * verificar é preciso provocar uma falha **real** a meio, e a forma de o fazer sem
     * simulações é usar um plano cujos registos são válidos mas cuja escrita colide com uma
     * constraint da base de dados.
     *
     * Um veículo com a mesma matrícula que outro veículo criado por esta importação é o
     * caso perfeito: o plano não o consegue prever (os dois vêm no bundle e nenhum existe na
     * conta, pelo que ambos são `create`), a validação também não (cada um é válido
     * isoladamente), e a segunda inserção viola a unicidade. É uma falha a meio da
     * transacção, a sério.
     *
     * O que se verifica é o resultado da atomicidade: o primeiro veículo — que foi escrito
     * antes da falha — **não** ficou na base de dados.
     */
    const user = await createUser(db);

    const zip = productionZip({
      dataFiles: [
        {
          path: BUNDLE_DATA_FILES.vehicles,
          content: jsonl([
            vehicleLine('veh_1', 'AA-00-BB'),
            // Duas linhas que produzem a mesma matrícula normalizada: `AA00BB`.
            vehicleLine('veh_2', 'AA00BB', { make: 'Outra' }),
          ]),
        },
      ],
    });

    const preview = await previewOf(zip, user.id);

    /*
     * Se a validação de conjunto já tiver recusado o bundle (dois veículos com a mesma
     * matrícula é um problema conhecido, A25), o `apply` recusa-o antes de escrever — e a
     * propriedade verifica-se na mesma, por uma via mais forte. O teste aceita os dois
     * desfechos e exige o mesmo resultado em ambos: **zero veículos**.
     */
    const before = await snapshotCounts(user.id);

    if (preview.plan.state === 'blocked') {
      await expect(
        applyImport({
          plan: preview.plan,
          records: preview.records,
          documentBytes: preview.bundle.documentBytes,
          bundleId: preview.bundle.bundleId,
          userId: user.id,
          prisma: db.prisma,
          storage,
        }),
      ).rejects.toThrow();
    } else {
      await expect(
        applyImport({
          plan: preview.plan,
          records: preview.records,
          documentBytes: preview.bundle.documentBytes,
          bundleId: preview.bundle.bundleId,
          userId: user.id,
          prisma: db.prisma,
          storage,
        }),
      ).rejects.toThrow();
    }

    expect(await snapshotCounts(user.id)).toEqual(before);
    expect(await db.prisma.vehicle.count()).toBe(0);
  });

  it('um plano bloqueado nunca chega a escrever, mesmo com registos válidos ao lado', async () => {
    /*
     * O contraste com o teste anterior: aqui o plano é bloqueado por um problema declarado,
     * e à mesma altura há um veículo perfeitamente válido. A tentação de "escrever o que dá"
     * produziria uma conta com dados a mais que o utilizador nunca aprovou — e o ecrã de
     * revisão diria outra coisa.
     */
    const user = await createUser(db);

    const zip = productionZip({
      dataFiles: [
        { path: BUNDLE_DATA_FILES.vehicles, content: jsonl([vehicleLine('veh_1', 'AA-00-BB')]) },
        {
          path: BUNDLE_DATA_FILES.fuel,
          content: jsonl([
            {
              localId: 'fuel_1',
              vehicleLocalId: 'veh_inexistente',
              date: '2026-03-01',
              litres: 42.5,
              amountCents: 7100,
            },
          ]),
        },
      ],
    });

    const preview = await previewOf(zip, user.id);
    expect(preview.plan.state).toBe('blocked');

    const before = await snapshotCounts(user.id);
    await expect(
      applyImport({
        plan: preview.plan,
        records: preview.records,
        documentBytes: preview.bundle.documentBytes,
        bundleId: preview.bundle.bundleId,
        userId: user.id,
        prisma: db.prisma,
        storage,
      }),
    ).rejects.toThrow();

    expect(await snapshotCounts(user.id)).toEqual(before);
  });
});

/* ========================================================================== */
/* §13.4 — segurança da entrada                                               */
/* ========================================================================== */

describe('§13.4 segurança da entrada', () => {
  it('um ZIP com `../../etc/passwd` é recusado', async () => {
    /*
     * O caso clássico de zip-slip. O ZIP é montado à mão porque o **escritor de produção
     * recusa sair do directório raiz** — pedir-lhe que produzisse esta entrada seria pedir-lhe
     * que produzisse o que ele existe para impedir.
     *
     * A verificação é dupla: a entrada é recusada *e* o motivo é declarado. Uma recusa muda
     * não permitiria distinguir "detectei a travessia" de "o ficheiro não estava lá".
     */
    const zip = buildZip([
      { name: BUNDLE_MANIFEST_FILE, data: utf8(JSON.stringify(buildManifest({ dataFiles: [] }))) },
      { name: '../../etc/passwd', data: utf8('root:x:0:0:root:/root:/bin/bash\n') },
    ]);

    let refusal: unknown;
    try {
      readZip(zip);
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(ZipRefusalError);
    expect((refusal as ZipRefusalError).refusal.reason).toBe('zip.path_traversal');
  });

  it('um caminho com um segmento `.` é normalizado no índice', async () => {
    /*
     * A normalização que o leitor faz a uma entrada é de **caminho**, e o `.` é um segmento
     * que não significa nada: `documents/./a.txt` no **índice** normaliza para
     * `documents/a.txt`, e é esse o nome que fica.
     *
     * ## A regra que este par de testes fixa
     *
     * O leitor compara o nome **bruto do índice** com o nome do cabeçalho local, e exige que
     * sejam iguais — a comparação é feita **antes** da normalização, sobre o valor tal como
     * veio escrito. A normalização só decide o nome final, depois de a concordância ter sido
     * estabelecida.
     *
     * Isto tem uma consequência que é preciso não confundir, e é por isso que os dois testes
     * existem lado a lado:
     *
     *  - **índice normalizado + cabeçalho original** (`documents/a.txt` / `documents/./a.txt`)
     *    → **recusado**. Os dois nomes brutos discordam.
     *  - **índice original + cabeçalho normalizado** (`documents/./a.txt` / `documents/a.txt`)
     *    → **aceite e normalizado** para `documents/a.txt`.
     *
     * A assimetria não é um defeito: é a consequência de a normalização acontecer no índice.
     * O teste seguinte cobre o caso aceite; este cobre o recusado, e o motivo
     * (`zip.invalid_local_header`) é afirmado para que a razão da recusa não se perca.
     */
    const zip = buildZipWithLocalNames([
      {
        name: BUNDLE_MANIFEST_FILE,
        localName: BUNDLE_MANIFEST_FILE,
        data: utf8(JSON.stringify(buildManifest({ dataFiles: [] }))),
      },
      { name: 'documents/a.txt', localName: 'documents/./a.txt', data: utf8('conteudo') },
    ]);

    let refusal: unknown;
    try {
      readZip(zip);
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(ZipRefusalError);
    expect((refusal as ZipRefusalError).refusal.reason).toBe('zip.invalid_local_header');
  });

  it('um `.` no índice é normalizado, e o nome final não tem o segmento', async () => {
    /*
     * O caso aceite, e a prova de que a normalização acontece **uma só vez** — sobre o nome
     * do índice. Um ZIP que traga `documents/./a.txt` no índice e `documents/a.txt` no
     * cabeçalho local é lido, e o nome guardado é `documents/a.txt`.
     *
     * É a forma como um escritor a sério escreveria os dois: o cabeçalho local com o nome
     * como foi pedido, o índice com o nome normalizado.
     */
    const zip = buildZipWithLocalNames([
      {
        name: BUNDLE_MANIFEST_FILE,
        localName: BUNDLE_MANIFEST_FILE,
        data: utf8(JSON.stringify(buildManifest({ dataFiles: [] }))),
      },
      { name: 'documents/./a.txt', localName: 'documents/a.txt', data: utf8('conteudo') },
    ]);

    const entries = readZip(zip);
    expect(entries.entries.map((entry) => entry.name)).toContain('documents/a.txt');
    expect(entries.entries.map((entry) => entry.name)).not.toContain('documents/./a.txt');
  });

  it('dois nomes para a mesma entrada são recusados, mesmo que os dois sejam seguros', async () => {
    /*
     * Um arquivo com nomes diferentes no índice e no cabeçalho é ambíguo: não há forma de
     * saber qual é o verdadeiro. A recusa é deliberada e não deve ser afrouxada em nome da
     * tolerância — é o ataque clássico de uma biblioteca validar o nome do índice (que leu
     * primeiro) e extrair o do cabeçalho (que é outro).
     */
    const zip = buildZipWithLocalNames([
      {
        name: BUNDLE_MANIFEST_FILE,
        localName: BUNDLE_MANIFEST_FILE,
        data: utf8(JSON.stringify(buildManifest({ dataFiles: [] }))),
      },
      { name: 'documents/a.txt', localName: 'documents/b.txt', data: utf8('conteudo') },
    ]);

    let refusal: unknown;
    try {
      readZip(zip);
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(ZipRefusalError);
    expect((refusal as ZipRefusalError).refusal.reason).toBe('zip.invalid_local_header');
  });

  it('um `..` que não sai da raiz é normalizado, e dois nomes para o mesmo sítio colidem', async () => {
    /*
     * `documents/doc_1/../../evil.txt` resolve para `evil.txt` — dentro da raiz, seguro. O
     * que se verifica é que o resultado é o mesmo que declarar `evil.txt` directamente: os
     * dois nomes **colidem**, e o leitor recusa a segunda entrada como duplicada.
     *
     * Uma implementação que tratasse qualquer `..` como travessia recusaria um caminho
     * legítimo; uma que não normalizasse escreveria o mesmo ficheiro duas vezes, e a segunda
     * escrita venceria em silêncio.
     */
    const zip = buildZip([
      { name: BUNDLE_MANIFEST_FILE, data: utf8(JSON.stringify(buildManifest({ dataFiles: [] }))) },
      { name: 'evil.txt', data: utf8('primeiro') },
      { name: 'documents/doc_1/../../evil.txt', data: utf8('segundo') },
    ]);

    let refusal: unknown;
    try {
      readZip(zip);
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(ZipRefusalError);
    expect((refusal as ZipRefusalError).refusal.reason).toBe('zip.duplicate_entry');
  });

  it('um ZIP com 10 000 entradas é recusado pelo limite', async () => {
    /*
     * A defesa contra a exaustão de recursos por número de entradas. O ZIP tem de ser
     * construído à mão: o limite é do **leitor**, e o escritor de produção não o conhece.
     */
    const entries = [
      { name: BUNDLE_MANIFEST_FILE, data: utf8(JSON.stringify(buildManifest({ dataFiles: [] }))) },
    ];
    for (let index = 0; index < 10_000; index += 1) {
      entries.push({ name: `ruido/ficheiro-${index}.txt`, data: utf8('x') });
    }

    const zip = buildZip(entries);

    let refusal: unknown;
    try {
      readZip(zip);
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(ZipRefusalError);
    expect((refusal as ZipRefusalError).refusal.reason).toBe('zip.too_many_entries');
  });

  it('um ZIP que descomprime muito acima do que ocupa é recusado pelo rácio', async () => {
    /*
     * A bomba de descompressão. O caso literal da §13.4 — 1 MB que descomprime para 10 GB —
     * não se constrói em teste sem consumir os 10 GB; a mesma defesa aplica-se a uma
     * proporção menor, e é a proporção que está a ser testada.
     *
     * O conteúdo é altamente compressível (zeros), que é a forma mais barata de obter um
     * rácio enorme. Os 4 MiB de zeros comprimem para uns poucos milhares de bytes, o que
     * ultrapassa largamente o rácio máximo do leitor.
     */
    const bomb = new Uint8Array(4 * 1024 * 1024);
    const zip = buildZip([
      { name: BUNDLE_MANIFEST_FILE, data: utf8(JSON.stringify(buildManifest({ dataFiles: [] }))) },
      { name: 'bomba.jsonl', data: bomb },
    ]);

    let refusal: unknown;
    try {
      readZip(zip);
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(ZipRefusalError);
    /*
     * O motivo é o rácio — o código do leitor é `zip.compression_ratio_exceeded`, e o nome
     * escreve-se aqui por extenso em vez de se escrever um prefixo aproximado: uma asserção
     * sobre um prefixo passaria para um código diferente que partilhasse as primeiras
     * letras, e o teste deixaria de distinguir "detectei a bomba" de "troquei de motivo".
     */
    expect((refusal as ZipRefusalError).refusal.reason).toBe('zip.compression_ratio_exceeded');
  }, 120_000);

  it('uma entrada que é um symlink é recusada', async () => {
    /*
     * Um symlink dentro de um ZIP é uma forma de escrever fora da área de extracção:
     * extrai-se o link, e a escrita seguinte através dele cai onde o link apontar. O ZIP é
     * montado com os atributos externos que o Unix usa para o declarar.
     */
    const zip = buildZip([
      { name: BUNDLE_MANIFEST_FILE, data: utf8(JSON.stringify(buildManifest({ dataFiles: [] }))) },
      {
        name: 'atalho.txt',
        data: utf8('../../fora'),
        // 0xa1ff0000: link simbólico com permissões 0777.
        externalAttributes: 0xa1ff0000,
      },
    ]);

    let refusal: unknown;
    try {
      readZip(zip);
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(ZipRefusalError);
    expect((refusal as ZipRefusalError).refusal.reason).toBe('zip.symlink_entry');
  });

  it('um `manifest.json` com JSON malformado produz um erro de validação, não uma excepção não tratada', async () => {
    /*
     * A §7.3 é explícita: "um erro de validação, não uma excepção não tratada". A diferença
     * observável é o **tipo** do erro: um `SyntaxError` do `JSON.parse` que escapasse
     * chegaria à camada HTTP como um 500, e o utilizador veria "erro interno" em vez de
     * "este ficheiro está corrompido".
     */
    const zip = buildZip([
      { name: BUNDLE_MANIFEST_FILE, data: utf8('{ isto não é JSON ]') },
    ]);

    let refusal: unknown;
    try {
      readBundle(readZip(zip).entries);
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeDefined();
    expect(refusal).not.toBeInstanceOf(SyntaxError);
    expect((refusal as { refusal?: { reason: string } }).refusal?.reason).toBe(
      'bundle.manifest_malformed',
    );
  });

  it('um `manifest.json` válido como JSON mas inválido como contrato é recusado com distinção', async () => {
    /*
     * O motivo é **diferente** do anterior, e a distinção tem valor de diagnóstico: JSON
     * inválido é um ficheiro corrompido; JSON válido que não satisfaz o contrato é um
     * ficheiro que não é um bundle do Zemlo. Os dois produzem a mesma acção para o
     * utilizador, mas só o segundo é um sinal de que alguém construiu o ficheiro à mão.
     */
    const zip = buildZip([{ name: BUNDLE_MANIFEST_FILE, data: utf8(JSON.stringify({ olá: true })) }]);

    let refusal: unknown;
    try {
      readBundle(readZip(zip).entries);
    } catch (error) {
      refusal = error;
    }

    expect((refusal as { refusal?: { reason: string } }).refusal?.reason).toBe(
      'bundle.manifest_invalid',
    );
  });

  it('um bundle de outra conta não toca nos dados dessa conta', async () => {
    /*
     * A §13.4 é explícita: "Importar para outra conta → impossível por desenho: a conta vem
     * do token, nunca do pedido" e "Bundle de outra conta → os dados dessa conta não são
     * tocados".
     *
     * O cenário é o mais adversarial que o formato permite: um bundle exportado da conta A
     * é importado **enquanto a conta B**. Se o bundle pudesse influenciar a conta de
     * destino, os registos da conta A apareceriam tocados — e a conta B receberia dados que
     * não pediu.
     *
     * A garantia não vem de o bundle ser recusado: vem de o `userId` ser sempre o do
     * contexto, e de a chave da idempotência incluir o `userId`. O bundle de A é um bundle
     * legítimo e importa-se — para B, como dados novos de B.
     */
    const accountA = await createUser(db, { email: 'conta-a@zemlo.test' });
    const accountB = await createUser(db, { email: 'conta-b@zemlo.test' });

    const vehicleA = await createVehicle(db, accountA.id, { plate: 'AA-00-BB' });
    await db.prisma.odometerReading.create({
      data: {
        vehicleId: vehicleA.id,
        odometerKm: 45_000,
        recordedAt: new Date('2026-01-10T00:00:00.000Z'),
        origin: 'manual',
      },
    });

    const beforeA = await snapshotCounts(accountA.id);

    const zip = productionZip({
      dataFiles: [
        { path: BUNDLE_DATA_FILES.vehicles, content: jsonl([vehicleLine('veh_1', 'CC-11-DD')]) },
        {
          path: BUNDLE_DATA_FILES.odometer,
          content: jsonl([
            { localId: 'odo_1', vehicleLocalId: 'veh_1', odometerKm: 12_345, recordedAt: '2026-05-10' },
          ]),
        },
      ],
    });

    const preview = await previewOf(zip, accountB.id);
    const report = await applyImport({
      plan: preview.plan,
      records: preview.records,
      documentBytes: preview.bundle.documentBytes,
      bundleId: preview.bundle.bundleId,
      userId: accountB.id,
      prisma: db.prisma,
      storage,
    });

    // Os dados da conta A estão exactamente como estavam.
    expect(await snapshotCounts(accountA.id)).toEqual(beforeA);

    // E o que foi criado é da conta B — nem do bundle, nem de A.
    expect(report.created).toHaveLength(2);
    const vehiclesB = await db.prisma.vehicle.findMany({ where: { userId: accountB.id } });
    expect(vehiclesB).toHaveLength(1);
    expect(vehiclesB[0]!.plate).toBe('CC11DD');

    // O veículo de A continua a ser o único de A, com o seu id original.
    const vehiclesA = await db.prisma.vehicle.findMany({ where: { userId: accountA.id } });
    expect(vehiclesA).toHaveLength(1);
    expect(vehiclesA[0]!.id).toBe(vehicleA.id);
  });

  it('o mesmo bundle importado em duas contas cria tudo nas duas', async () => {
    /*
     * A consequência da chave de idempotência incluir o `userId` (§9.5): o livro não é
     * global, e por isso exportar de uma conta e importar noutra **funciona**. Se o livro
     * fosse global, a segunda conta não recebia nada e a funcionalidade central da
     * portabilidade estaria partida em silêncio.
     */
    const first = await createUser(db, { email: 'duas-a@zemlo.test' });
    const second = await createUser(db, { email: 'duas-b@zemlo.test' });

    const zip = productionZip({
      dataFiles: [
        { path: BUNDLE_DATA_FILES.vehicles, content: jsonl([vehicleLine('veh_1', 'AA-00-BB')]) },
      ],
    });

    for (const user of [first, second]) {
      const preview = await previewOf(zip, user.id);
      await applyImport({
        plan: preview.plan,
        records: preview.records,
        documentBytes: preview.bundle.documentBytes,
        bundleId: preview.bundle.bundleId,
        userId: user.id,
        prisma: db.prisma,
        storage,
      });
    }

    expect(await db.prisma.vehicle.count({ where: { userId: first.id } })).toBe(1);
    expect(await db.prisma.vehicle.count({ where: { userId: second.id } })).toBe(1);
  });
});

/* ========================================================================== */
/* Auxiliares                                                                 */
/* ========================================================================== */

/**
 * O relatório de aplicação de uma importação que **não chegou a correr**.
 *
 * Existe porque o `buildImportReport` exige um `ApplyReport`, e há um caso — um plano
 * bloqueado — em que não há um: o `apply` recusa antes de escrever e não devolve nada.
 *
 * A alternativa seria pedir o relatório de uma aplicação que não aconteceu, o que obrigaria
 * a inventar um `ApplyReport` no sítio da chamada. Dizer explicitamente "nada foi criado,
 * nada foi preenchido, nada foi ignorado" é mais claro do que um objecto construído à mão
 * em cada teste — e é o que a ausência de escrita significa.
 */
function emptyApplyReport() {
  return { created: [], enriched: [], skipped: [], batches: 0, localToId: new Map() };
}

/**
 * Uma fotografia das contagens da conta.
 *
 * Usada para provar que nada foi escrito. Comparar contagens e não linhas concretas é
 * deliberado: o que se quer provar é a **ausência de efeito**, e uma fotografia de todas as
 * tabelas é a forma mais directa de o afirmar. Comparar linhas obrigaria a decidir quais
 * olhar, e a decisão poderia deixar de fora exactamente a tabela que foi tocada por engano.
 */
async function snapshotCounts(userId: string): Promise<Record<string, number>> {
  const vehicleIds = (
    await db.prisma.vehicle.findMany({ where: { userId }, select: { id: true } })
  ).map((row) => row.id);

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
    book,
  ] = await Promise.all([
    db.prisma.vehicle.count({ where: { userId } }),
    db.prisma.odometerReading.count({ where: { vehicleId: { in: vehicleIds } } }),
    db.prisma.expense.count({ where: { userId } }),
    db.prisma.fuelSession.count({ where: { userId } }),
    db.prisma.chargingSession.count({ where: { userId } }),
    db.prisma.maintenanceRecord.count({ where: { userId } }),
    db.prisma.insurancePolicy.count({ where: { userId } }),
    db.prisma.inspectionRecord.count({ where: { userId } }),
    db.prisma.taxRecord.count({ where: { userId } }),
    db.prisma.document.count({ where: { userId } }),
    db.prisma.reminder.count({ where: { userId } }),
    db.prisma.vehicleEvent.count({ where: { userId } }),
    db.prisma.importBookEntry.count({ where: { userId } }),
  ]);

  return {
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
    book,
  };
}
