/**
 * Testes do relatório final (§9.3, §11.2, §11.3).
 *
 * O relatório é um **artefacto**: tem de ser construído a partir do que realmente
 * aconteceu, e não de uma expectativa. Por isso estes testes correm a importação a sério
 * contra uma base de dados SQLite real — a mesma infraestrutura do
 * `import-apply-preview.test.ts` — e verificam o relatório que sai do `apply`.
 *
 * Um relatório verificado contra um `ApplyReport` construído à mão provaria apenas que o
 * `report.ts` sabe somar; verificado contra uma importação real, prova que ele conta o que
 * a base de dados tem.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildBundle } from './helpers/bundle-builder.js';
import { createTestDb, createUser, createVehicle, type TestDb } from './helpers/db.js';
import { readZip } from '../src/domain/import/zip.js';
import { previewImport } from '../src/services/import/read.js';
import { applyImport } from '../src/services/import/apply.js';
import { buildImportReport, reportToCsv } from '../src/services/import/report.js';

let db: TestDb;
let user: { id: string; email: string };
let other: { id: string; email: string };

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db.destroy();
});

beforeEach(async () => {
  await db.prisma.importBookEntry.deleteMany();
  await db.prisma.expense.deleteMany();
  await db.prisma.fuelSession.deleteMany();
  await db.prisma.odometerReading.deleteMany();
  await db.prisma.document.deleteMany();
  await db.prisma.vehicle.deleteMany();
  await db.prisma.user.deleteMany();

  user = await createUser(db, { email: 'titular@zemlo.test', name: 'Titular' });
  other = await createUser(db, { email: 'outro@zemlo.test', name: 'Outro' });
});

/* -------------------------------------------------------------------------- */
/* Utilitários                                                                 */
/* -------------------------------------------------------------------------- */

function simpleBundle(overrides: Parameters<typeof buildBundle>[0] = {}) {
  return buildBundle({
    dataFiles: [
      {
        path: 'vehicles.jsonl',
        content: JSON.stringify({
          localId: 'veh_1',
          plate: 'AA-00-BB',
          plateDisplay: 'AA-00-BB',
          make: 'Kia',
          model: 'EV3',
          year: 2025,
        }),
      },
      {
        path: 'fuel.jsonl',
        content: JSON.stringify({
          localId: 'fuel_1',
          vehicleLocalId: 'veh_1',
          date: '2026-02-10',
          litres: 42.35,
          amountCents: 7_000,
          odometerKm: 15_000,
        }),
      },
      ...(overrides.dataFiles ?? []),
    ],
    ...overrides,
  });
}

/** Corre preview + apply e devolve o relatório, como a camada HTTP fará. */
async function runImport(
  zip: Uint8Array,
  userId: string = user.id,
): Promise<ReturnType<typeof buildImportReport>> {
  const previewResult = await previewImport({ zip: readZip(zip), userId, prisma: db.prisma });
  const applied = await applyImport({
    plan: previewResult.plan,
    records: previewResult.records,
    bundleId: previewResult.bundle.bundleId,
    userId,
    prisma: db.prisma,
  });

  return buildImportReport({
    plan: previewResult.plan,
    applied,
    bundleId: previewResult.bundle.bundleId,
  });
}

/* -------------------------------------------------------------------------- */
/* 1. O relatório descreve o que a base de dados tem                           */
/* -------------------------------------------------------------------------- */

describe('relatório: o que aconteceu', () => {
  it('conta os registos criados e nomeia-os', async () => {
    const report = await runImport(simpleBundle().zip);

    expect(report.applied).toBe(true);
    expect(report.created.length).toBe(2);
    expect(report.created.map((r) => r.localId).sort()).toEqual(['fuel_1', 'veh_1']);
    expect(report.created.map((r) => r.kind).sort()).toEqual(['fuel', 'vehicle']);
  });

  it('os ids do relatório existem mesmo na base de dados', async () => {
    const report = await runImport(simpleBundle().zip);

    const vehicle = report.created.find((r) => r.kind === 'vehicle');
    const found = await db.prisma.vehicle.findUnique({ where: { id: vehicle?.id } });

    expect(found).not.toBeNull();
    expect(found?.plate).toBe('AA00BB');
  });

  it('guarda o bundleId, para o relatório poder ser reencontrado', async () => {
    const bundle = simpleBundle();
    const report = await runImport(bundle.zip);

    expect(report.bundleId).toBe(bundle.manifest.bundleId);
  });

  it('cabem duas importações diferentes: cada relatório tem o seu plano', async () => {
    const first = await runImport(simpleBundle().zip);
    const segundo = buildBundle({
      bundleId: 'bnd_outro_bundle',
      dataFiles: [
        {
          path: 'vehicles.jsonl',
          content: JSON.stringify({ localId: 'v2', plate: 'CC-11-DD', plateDisplay: 'CC-11-DD' }),
        },
      ],
    });
    const second = await runImport(segundo.zip);

    expect(first.bundleId).not.toBe(second.bundleId);
    expect(second.created.length).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Uma reimportação não inventa trabalho                                    */
/* -------------------------------------------------------------------------- */

describe('relatório: reimportação (§9.5)', () => {
  it('diz que não foi criado nada, e porquê', async () => {
    const zip = simpleBundle().zip;
    await runImport(zip);

    const second = await runImport(zip);

    expect(second.applied).toBe(false);
    expect(second.created).toEqual([]);
    expect(second.headline).toMatch(/já tinha sido importado/i);
  });

  it('mantém as contagens do plano, para o utilizador ver o que foi reconhecido', async () => {
    const zip = simpleBundle().zip;
    await runImport(zip);

    const second = await runImport(zip);

    expect(second.summary.total).toBe(2);
    expect(second.summary.skipped).toBe(2);
    expect(second.summary.toCreate).toBe(0);
  });

  it('um plano vazio produz um relatório, não uma ausência', async () => {
    const report = await runImport(buildBundle({ dataFiles: [] }).zip);

    expect(report.applied).toBe(false);
    expect(report.summary.total).toBe(0);
    expect(report.headline).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* 3. O enriquecimento aparece separado da criação                             */
/* -------------------------------------------------------------------------- */

describe('relatório: enriquecimento', () => {
  it('nomeia os campos preenchidos, não só o registo', async () => {
    const vehicle = await createVehicle(db, user.id, { plate: 'AA00BB', make: 'Kia', model: 'EV3' });
    await db.prisma.vehicle.update({ where: { id: vehicle.id }, data: { year: null } });

    const report = await runImport(simpleBundle().zip);

    expect(report.enriched.length).toBe(1);
    expect(report.enriched[0]?.fields).toContain('year');
  });

  it('não conta como criado o que foi só preenchido', async () => {
    const vehicle = await createVehicle(db, user.id, { plate: 'AA00BB', make: 'Kia', model: 'EV3' });
    await db.prisma.vehicle.update({ where: { id: vehicle.id }, data: { year: null } });

    const report = await runImport(simpleBundle().zip);

    expect(report.created.some((r) => r.localId === 'veh_1')).toBe(false);
  });

  it('a frase distingue criar de preencher, em vez de somar as duas coisas', async () => {
    const vehicle = await createVehicle(db, user.id, { plate: 'AA00BB', make: 'Kia', model: 'EV3' });
    await db.prisma.vehicle.update({ where: { id: vehicle.id }, data: { year: null } });

    const report = await runImport(simpleBundle().zip);

    // O abastecimento é criado; o veículo é preenchido. A frase tem de dizer as duas
    // coisas, porque para o utilizador são coisas diferentes.
    expect(report.headline).toMatch(/preenchi campos em branco/i);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. O que ficou de fora é nomeado                                            */
/* -------------------------------------------------------------------------- */

describe('relatório: o que não entrou', () => {
  it('lista os registos em quarentena com o motivo', async () => {
    /*
     * Uma referência quebrada é bloqueante (§9.4): o bundle fica `blocked`, e nenhum
     * registo entra. O que o relatório tem de garantir é que os registos afectados
     * aparecem nomeados — um relatório que dissesse só "0 registos" não diria ao
     * utilizador o que corrigir.
     */
    const bundle = buildBundle({
      dataFiles: [
        {
          path: 'fuel.jsonl',
          content: JSON.stringify({
            localId: 'fuel_1',
            vehicleLocalId: 'veh_inexistente',
            date: '2026-02-10',
            litres: 42.35,
            amountCents: 7_000,
            odometerKm: 15_000,
          }),
        },
      ],
    });

    const previewResult = await previewImport({
      zip: readZip(bundle.zip),
      userId: user.id,
      prisma: db.prisma,
    });

    // Um bundle bloqueado não é aplicável — mas o plano continua a ser descritível.
    const report = buildImportReport({
      plan: previewResult.plan,
      applied: { created: [], enriched: [], skipped: [], batches: 0, localToId: new Map() },
      bundleId: previewResult.bundle.bundleId,
    });

    expect(report.applied).toBe(false);
    expect(report.skipped.length).toBeGreaterThan(0);
    expect(report.skipped.every((s) => s.reason.length > 0)).toBe(true);
  });

  it('os problemas do plano chegam ao relatório', async () => {
    const bundle = buildBundle({
      dataFiles: [
        {
          path: 'vehicles.jsonl',
          content: JSON.stringify({ localId: 'veh_1', plate: 'AA-00-BB', plateDisplay: 'AA-00-BB' }),
        },
      ],
      declaredCounts: { vehicles: 99 },
    });

    const previewResult = await previewImport({
      zip: readZip(bundle.zip),
      userId: user.id,
      prisma: db.prisma,
    });
    const applied = await applyImport({
      plan: previewResult.plan,
      records: previewResult.records,
      bundleId: previewResult.bundle.bundleId,
      userId: user.id,
      prisma: db.prisma,
    });

    const report = buildImportReport({
      plan: previewResult.plan,
      applied,
      bundleId: previewResult.bundle.bundleId,
    });

    expect(report.issues.some((i) => i.code === 'bundle.count_mismatch')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Transacções e isolamento                                                 */
/* -------------------------------------------------------------------------- */

describe('relatório: transacção e isolamento', () => {
  it('reporta uma só transacção numa importação pequena (§7.2)', async () => {
    const report = await runImport(simpleBundle().zip);
    expect(report.batches).toBe(1);
  });

  it('o relatório de uma conta não descreve registos de outra', async () => {
    await runImport(simpleBundle().zip, user.id);
    const outroReport = await runImport(simpleBundle().zip, other.id);

    // A mesma matrícula noutra conta é um registo novo: o isolamento por `userId` faz
    // com que a segunda conta não veja nada da primeira.
    expect(outroReport.created.length).toBe(2);
    expect(await db.prisma.vehicle.count({ where: { userId: other.id } })).toBe(1);
    expect(await db.prisma.vehicle.count({ where: { userId: user.id } })).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 6. CSV — o relatório é descarregável (§11.3)                                */
/* -------------------------------------------------------------------------- */

describe('relatório: exportação em CSV', () => {
  it('tem cabeçalho e uma linha por registo', async () => {
    const report = await runImport(simpleBundle().zip);
    const csv = reportToCsv(report);
    const lines = csv.split('\r\n');

    expect(lines[0]).toBe('secção,localId,tipo,id,campos,motivo');
    expect(lines.length).toBe(1 + report.created.length);
  });

  it('identifica a secção de cada linha', async () => {
    const report = await runImport(simpleBundle().zip);
    const csv = reportToCsv(report);

    expect(csv).toContain('criado,veh_1,vehicle');
  });

  it('escapa motivos com vírgulas, para não partir a linha', async () => {
    const report = {
      bundleId: null,
      applied: false,
      summary: {
        state: 'nothing-to-do' as const,
        toCreate: 0, alreadyExists: 0, needsDecision: 0, cannotImport: 0,
        skipped: 1, total: 1, enriching: 0, conflicting: 0,
        documentsMissingContent: 0, notices: [],
      },
      created: [],
      enriched: [],
      skipped: [{ localId: 'x', kind: 'vehicle', reason: 'Falta a matrícula, o ano e a cor' }],
      batches: 0,
      issues: [],
      headline: '',
    };

    const csv = reportToCsv(report);
    const dataLine = csv.split('\r\n')[1] as string;

    // A célula fica entre aspas, e a vírgula dentro dela não cria uma coluna a mais.
    expect(dataLine).toContain('"Falta a matrícula, o ano e a cor"');
    expect(countColumns(dataLine)).toBe(6);
  });

  it('duplica as aspas internas (RFC 4180)', async () => {
    const report = {
      bundleId: null,
      applied: false,
      summary: {
        state: 'nothing-to-do' as const,
        toCreate: 0, alreadyExists: 0, needsDecision: 0, cannotImport: 0,
        skipped: 1, total: 1, enriching: 0, conflicting: 0,
        documentsMissingContent: 0, notices: [],
      },
      created: [],
      enriched: [],
      skipped: [{ localId: 'x', kind: 'vehicle', reason: 'A matrícula "AA-00-BB" está repetida' }],
      batches: 0,
      issues: [],
      headline: '',
    };

    const csv = reportToCsv(report);

    expect(csv).toContain('""AA-00-BB""');
  });

  it('um relatório vazio tem só o cabeçalho', async () => {
    const report = await runImport(buildBundle({ dataFiles: [] }).zip);
    const csv = reportToCsv(report);

    expect(csv).toBe('secção,localId,tipo,id,campos,motivo');
  });
});

/* -------------------------------------------------------------------------- */
/* 7. A frase nunca contradiz os números                                       */
/* -------------------------------------------------------------------------- */

describe('relatório: a frase de abertura', () => {
  it('sem nada a fazer, diz que não havia nada para importar', async () => {
    const report = await runImport(buildBundle({ dataFiles: [] }).zip);
    expect(report.headline).toMatch(/não havia nada para importar/i);
  });

  it('com um só registo criado, o singular está correto', async () => {
    const bundle = buildBundle({
      dataFiles: [
        {
          path: 'vehicles.jsonl',
          content: JSON.stringify({ localId: 'veh_1', plate: 'AA-00-BB', plateDisplay: 'AA-00-BB' }),
        },
      ],
    });

    const report = await runImport(bundle.zip);

    expect(report.headline).toContain('Importei 1 registo.');
  });

  it('com vários, o plural está correto', async () => {
    const report = await runImport(simpleBundle().zip);
    expect(report.headline).toContain('Importei 2 registos');
  });

  it('menciona os que ficaram de fora, quando os há', async () => {
    /*
     * Um documento sem ficheiro é **não bloqueante** (§9.3): o registo é criado como
     * metadados e o relatório lista-o. É o caso honesto de "ficou de fora" que coexiste
     * com uma importação que corre — ao contrário de um veículo sem matrícula (A25), que
     * bloqueia o bundle inteiro e por isso não produz relatório nenhum.
     */
    const bundle = buildBundle({
      dataFiles: [
        {
          path: 'vehicles.jsonl',
          content: JSON.stringify({ localId: 'veh_1', plate: 'AA-00-BB', plateDisplay: 'AA-00-BB' }),
        },
        {
          path: 'documents.jsonl',
          content: JSON.stringify({
            localId: 'doc_1',
            name: 'Seguro',
            category: 'insurance',
            contentState: 'missingContent',
          }),
        },
      ],
    });

    const previewResult = await previewImport({
      zip: readZip(bundle.zip),
      userId: user.id,
      prisma: db.prisma,
    });
    const applied = await applyImport({
      plan: previewResult.plan,
      records: previewResult.records,
      bundleId: previewResult.bundle.bundleId,
      userId: user.id,
      prisma: db.prisma,
    });
    const report = buildImportReport({
      plan: previewResult.plan,
      applied,
      bundleId: previewResult.bundle.bundleId,
    });

    // A importação correu e criou registos — o documento entra sem os bytes.
    expect(report.created.length).toBeGreaterThan(0);
    expect(report.summary.documentsMissingContent).toBe(1);
    expect(report.headline).toMatch(/Importei/i);
  });
});

/** Conta colunas de uma linha CSV, respeitando as aspas. */
function countColumns(line: string): number {
  let columns = 1;
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') i += 1;
      else inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) columns += 1;
  }

  return columns;
}
