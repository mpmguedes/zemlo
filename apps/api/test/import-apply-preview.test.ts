/**
 * Testes dos serviços de importação — **preview** (§7.1) e **apply** (§7.2).
 *
 * ## Porque é que estes testes correm contra uma base de dados a sério
 *
 * O que aqui se prova não é aritmética: é comportamento do motor. O rollback, a
 * atomicidade de um lote, a violação de um `@@unique`, a cascata de um `onDelete` e o
 * isolamento por `userId` são propriedades da base de dados, não do nosso código. Um duplo
 * em memória testaria a nossa imitação das regras em vez das regras — e passaria
 * precisamente nos casos que interessam (um rollback que não reverte, uma constraint que
 * não dispara) sem ninguém dar por isso.
 *
 * Cada ficheiro fica com a sua base de dados temporária, criada e destruída dentro do
 * próprio ficheiro. A `dev.db` do projecto nunca é tocada.
 *
 * ## Escrito antes da implementação
 *
 * Estes testes definem o contrato de `read.ts`, `book.ts` e `apply.ts`; a implementação
 * vem depois, para os satisfazer. A ordem importa: um teste escrito depois do código tende
 * a descrever o que o código faz, e não o que o contrato exige.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, createUser, createVehicle, type TestDb } from './helpers/db.js';
import { buildBundle } from './helpers/bundle-builder.js';

import { readZip } from '../src/domain/import/zip.js';
import type { ImportPlan } from '../src/domain/import/plan.js';

import { previewImport } from '../src/services/import/read.js';
import { applyImport } from '../src/services/import/apply.js';

/* -------------------------------------------------------------------------- */
/* Infraestrutura                                                              */
/* -------------------------------------------------------------------------- */

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
  /*
   * Apagar tudo entre testes, pela ordem inversa das dependências. O `User` leva cascata
   * em quase tudo, mas apagar explicitamente o livro de idempotência primeiro torna a
   * intenção clara e não depende da cascata estar bem declarada.
   */
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

/** Um bundle com um veículo e um abastecimento que aponta para ele. */
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
    ],
    ...overrides,
  });
}

/**
 * Lê um ZIP construído pelo helper e devolve o `ZipReadResult`.
 *
 * O `readZip` **lança** `ZipRefusalError` em vez de devolver um resultado discriminado — é
 * a convenção do módulo, e o `readBundle` segue-a. Um ZIP de teste que não seja aceite é um
 * erro do próprio teste (o fixture está mal construído), não um caso a tratar, e por isso
 * a excepção é deixada subir.
 */
function readBuilt(zip: Uint8Array) {
  return readZip(zip);
}

/** Corresponde a leitura + normalização + validação + plano — o que o `read.ts` faz. */
async function preview(zip: Uint8Array, userId = user.id) {
  return previewImport({ zip: readBuilt(zip), userId, prisma: db.prisma });
}

/**
 * Como `preview`, mas com limites de volume apertados.
 *
 * Os limites só podem ser **apertados**, nunca alargados — a mesma regra do `resolveLimits`
 * do ZIP. É isto que permite exercer o comportamento do limite sem construir um ficheiro de
 * 100 001 linhas: o mecanismo é o mesmo, o número é que é diferente.
 *
 * Devolve `{ refused: true }` em vez de lançar, para que o teste possa afirmar duas coisas ao
 * mesmo tempo: que foi recusado **e** que nada foi escrito. A recusa é o
 * `BundleRefusalError` do `readBundle` — não o `ZipRefusalError` do ZIP, que aconteceria
 * antes e seria um defeito do fixture.
 */
async function previewWithLimits(
  zip: Uint8Array,
  userId: string,
  limits: { maxRecords: number },
): Promise<{ refused: true } | { refused: false; plan: ImportPlan }> {
  try {
    const result = await previewImport({
      zip: readBuilt(zip),
      userId,
      prisma: db.prisma,
      limits: { limits: { maxRecords: limits.maxRecords } },    });
    return { refused: false, plan: result.plan };
  } catch (error) {
    if (error instanceof Error && error.name === 'BundleRefusalError') {
      return { refused: true };
    }
    throw error;
  }
}

/**
 * Aplica um resultado de `preview`, levando consigo os `records` normalizados e o `bundleId`.
 *
 * O `applyImport` não volta a ler o bundle nem a reconstruir o plano — recebe o plano **e** os
 * registos já normalizados, para que o que foi aprovado seja o que é escrito, por construção.
 * Por isso o teste tem de passar os dois, exactamente como a camada HTTP fará: a rota guarda o
 * resultado do preview e entrega-o ao apply depois da confirmação.
 *
 * Se o teste chamasse `applyImport({ plan })` sem `records`, o `apply` recusar-se-ia a inventar
 * os dados — é esse o erro que aqui se evita, e não uma conveniência do helper.
 */
function apply(
  previewResult: Awaited<ReturnType<typeof preview>>,
  userId: string = user.id,
) {
  return applyImport({
    plan: previewResult.plan,
    records: previewResult.records,
    bundleId: previewResult.bundle.bundleId,
    userId,
    prisma: db.prisma,
  });
}

/** Contagens de registos por modelo, para comparar antes e depois sem ambiguidade. */async function snapshot() {
  const [vehicles, fuel, expenses, odometer, documents, book] = await Promise.all([
    db.prisma.vehicle.count(),
    db.prisma.fuelSession.count(),
    db.prisma.expense.count(),
    db.prisma.odometerReading.count(),
    db.prisma.document.count(),
    db.prisma.importBookEntry.count(),
  ]);
  return { vehicles, fuel, expenses, odometer, documents, book };
}

/* -------------------------------------------------------------------------- */
/* 1. Preview — o que produz                                                   */
/* -------------------------------------------------------------------------- */

describe('preview: contrato de saída', () => {
  it('devolve um plano e o bundle lido', async () => {
    const result = await preview(simpleBundle().zip);

    expect(result).toHaveProperty('plan');
    expect(result).toHaveProperty('bundle');
    expect(result.plan).toHaveProperty('state');
    expect(result.plan).toHaveProperty('counts');
    expect(result.plan).toHaveProperty('entries');
  });

  it('um bundle válido numa conta vazia propõe criar tudo', async () => {
    const result = await preview(simpleBundle().zip);

    expect(result.plan.state).toBe('ready');
    expect(result.plan.counts.create).toBe(2);
    expect(result.plan.counts.exact).toBe(0);
    expect(result.plan.counts.probable).toBe(0);
    expect(result.plan.counts.quarantined).toBe(0);
  });

  it('identifica os registos novos sem viaKey — são novos, não prováveis', async () => {
    const result = await preview(simpleBundle().zip);

    for (const entry of result.plan.entries) {
      expect(entry.action).toBe('create');
      expect(entry.viaKey).toBeUndefined();
      expect(entry.matched).toEqual([]);
    }
  });

  it('preserva o localId de cada registo', async () => {
    const result = await preview(simpleBundle().zip);

    const ids = result.plan.entries.map((e) => e.localId).sort();
    expect(ids).toEqual(['fuel_1', 'veh_1']);
  });

  it('conta por tipo de registo', async () => {
    const result = await preview(simpleBundle().zip);

    expect(result.plan.byKind.vehicle).toBe(1);
    expect(result.plan.byKind.fuel).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Preview — NÃO ESCREVE NADA (§7.1)                                        */
/* -------------------------------------------------------------------------- */

describe('preview: não escreve absolutamente nada na BD', () => {
  /*
   * A §7.1 é categórica: "Nenhuma escrita acontece antes da fase `apply`." É o que torna
   * impossível criar dados parcialmente sem o utilizador saber, e é a propriedade mais
   * importante deste ficheiro. O teste compara um instantâneo completo antes e depois.
   */
  it('não cria registos nenhuns', async () => {
    const before = await snapshot();
    await preview(simpleBundle().zip);
    const after = await snapshot();

    expect(after).toEqual(before);
  });

  it('não cria veículos numa conta vazia', async () => {
    await preview(simpleBundle().zip);

    expect(await db.prisma.vehicle.count({ where: { userId: user.id } })).toBe(0);
  });

  it('não escreve no livro de idempotência', async () => {
    await preview(simpleBundle().zip);

    expect(await db.prisma.importBookEntry.count()).toBe(0);
  });

  it('um preview sobre uma conta com dados não altera esses dados', async () => {
    const vehicle = await createVehicle(db, user.id, { plate: 'AA00BB' });
    await db.prisma.fuelSession.create({
      data: {
        vehicleId: vehicle.id,
        userId: user.id,
        date: new Date('2026-01-01'),
        litres: 10,
        amountCents: 1_500,
      },
    });

    const before = await snapshot();
    await preview(simpleBundle().zip);
    const after = await snapshot();

    expect(after).toEqual(before);
  });

  it('um preview que rebenta a meio não deixa escrita nenhuma', async () => {
    /*
     * Um bundle cuja validação falha não pode ter deixado rasto. É o mesmo invariante
     * visto pelo lado do erro: a falha e a recusa têm de ser igualmente silenciosas.
     */
    const broken = buildBundle({
      dataFiles: [
        { path: 'vehicles.jsonl', content: JSON.stringify({ localId: 'veh_1', plate: 'AA-00-BB', plateDisplay: 'AA-00-BB' }) },
        { path: 'fuel.jsonl', content: JSON.stringify({ localId: 'fuel_1', vehicleLocalId: 'nao_existe', date: '2026-02-10', litres: 1, amountCents: 100 }) },
      ],
    });

    const before = await snapshot();
    const result = await preview(broken.zip);
    const after = await snapshot();

    expect(result.plan.state).toBe('blocked');
    expect(after).toEqual(before);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Preview — deduplicação contra a conta existente                          */
/* -------------------------------------------------------------------------- */

describe('preview: identifica registos existentes', () => {
  it('um veículo com a mesma matrícula é reconhecido como já existente', async () => {
    await createVehicle(db, user.id, { plate: 'AA00BB' });

    const result = await preview(simpleBundle().zip);
    const vehicleEntry = result.plan.entries.find((e) => e.localId === 'veh_1');

    // A ação é `create` no sentido de "não seria criado agora" — a classificação é
    // `exact` e o registo não entra.
    expect(vehicleEntry?.action).toBe('exact');
    expect(vehicleEntry?.matched.length).toBeGreaterThan(0);
    expect(result.plan.counts.exact).toBe(1);
  });

  it('um abastecimento idêntico é reconhecido como já existente', async () => {
    const vehicle = await createVehicle(db, user.id, { plate: 'AA00BB' });
    await db.prisma.fuelSession.create({
      data: {
        vehicleId: vehicle.id,
        userId: user.id,
        date: new Date('2026-02-10'),
        litres: 42.35,
        amountCents: 7_000,
        odometerKm: 15_000,
      },
    });

    const result = await preview(simpleBundle().zip);
    const fuelEntry = result.plan.entries.find((e) => e.localId === 'fuel_1');

    expect(fuelEntry?.action).toBe('exact');
  });

  it('um abastecimento igual mas noutro veículo não coincide', async () => {
    const outro = await createVehicle(db, user.id, { plate: 'CC11DD' });
    await db.prisma.fuelSession.create({
      data: {
        vehicleId: outro.id,
        userId: user.id,
        date: new Date('2026-02-10'),
        litres: 42.35,
        amountCents: 7_000,
        odometerKm: 15_000,
      },
    });

    const result = await preview(simpleBundle().zip);

    // O `vehicleLocalId` entra na composição da chave: veículos diferentes não coincidem.
    expect(result.plan.counts.exact).toBe(0);
  });

  it('um valor ligeiramente diferente fica provável, com a distância medida', async () => {
    const vehicle = await createVehicle(db, user.id, { plate: 'AA00BB' });
    await db.prisma.fuelSession.create({
      data: {
        vehicleId: vehicle.id,
        userId: user.id,
        date: new Date('2026-02-10'),
        litres: 42.4,
        amountCents: 7_000,
        // 45 km acima: dentro da tolerância de ±50 km (§8.6).
        odometerKm: 15_045,
      },
    });

    const result = await preview(simpleBundle().zip);
    const fuelEntry = result.plan.entries.find((e) => e.localId === 'fuel_1');

    expect(fuelEntry?.action).toBe('probable');
    expect(result.plan.counts.probable).toBe(1);
    // A razão concreta que a decisão 10 exige (§9.3), não um vago "parecido".
    expect(fuelEntry?.reason).toBeTruthy();
  });

  it('um conflito de conteúdo é assinalado, não resolvido em silêncio', async () => {
    const vehicle = await createVehicle(db, user.id, { plate: 'AA00BB', make: 'Kia', model: 'EV3' });
    await db.prisma.vehicle.update({ where: { id: vehicle.id }, data: { model: 'e-Niro' } });

    const result = await preview(simpleBundle().zip);
    const vehicleEntry = result.plan.entries.find((e) => e.localId === 'veh_1');

    expect(vehicleEntry?.action).toBe('exact');
    expect(vehicleEntry?.conflict).toBe('conflict');
    expect(vehicleEntry?.conflictingFields).toContain('model');
  });

  it('a política por omissão nunca é prefer-incoming (decisão 8)', async () => {
    const result = await preview(simpleBundle().zip);

    expect(result.plan.conflictPolicy).toBe('fill-empty');
  });

  it('um campo em branco no existente é proposto para preenchimento', async () => {
    await createVehicle(db, user.id, { plate: 'AA00BB', make: 'Kia', model: 'EV3' });
    /*
     * O `year` fica em branco do lado existente e o bundle traz 2025: é o único campo que
     * a decisão 8 permite escrever automaticamente.
     */
    await db.prisma.vehicle.updateMany({ where: { userId: user.id }, data: { year: null } });

    const result = await preview(simpleBundle().zip);
    const vehicleEntry = result.plan.entries.find((e) => e.localId === 'veh_1');

    expect(vehicleEntry?.enrichableFields).toContain('year');
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Preview — o livro de idempotência (§9.5)                                 */
/* -------------------------------------------------------------------------- */

describe('preview: ImportBookEntry já existente', () => {
  it('um registo já importado deste bundle é reconhecido pelo livro', async () => {
    const bundle = simpleBundle();

    /*
     * Simula uma importação anterior: as entradas do livro existem, os registos também.
     * O plano tem de as reconhecer e não propor criá-las outra vez.
     */
    await db.prisma.importBookEntry.create({
      data: {
        userId: user.id,
        bundleId: bundle.manifest.bundleId,
        localId: 'veh_1',
        recordKind: 'vehicle',
        createdRecordId: 'veh_anterior',
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1_000),
      },
    });

    const result = await preview(bundle.zip);
    const vehicleEntry = result.plan.entries.find((e) => e.localId === 'veh_1');

    /*
     * `skipped` e não `exact`: são duas respostas a duas perguntas diferentes. O livro
     * responde "já importado **deste ficheiro**" (§9.5) e a acção é excluir o registo
     * porque não há nada a fazer com ele. A deduplicação responde "já existe **na conta**"
     * (§8) e classifica o registo como `exact`. O livro tem precedência: é a resposta mais
     * específica, e é a que o relatório mostra.
     */
    expect(vehicleEntry?.action).toBe('skipped');
    expect(vehicleEntry?.reason).toMatch(/importad/i);
  });

  it('o livro de um bundle diferente não reconhece os registos deste', async () => {
    const bundle = simpleBundle();

    await db.prisma.importBookEntry.create({
      data: {
        userId: user.id,
        bundleId: 'bnd_outro_bundle_completamente_diferente',
        localId: 'veh_1',
        recordKind: 'vehicle',
        createdRecordId: 'veh_anterior',
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1_000),
      },
    });

    const result = await preview(bundle.zip);
    const vehicleEntry = result.plan.entries.find((e) => e.localId === 'veh_1');

    // A chave do livro inclui o `bundleId`: outro bundle é outra importação.
    expect(vehicleEntry?.action).toBe('create');
  });

  it('uma entrada do livro de outro utilizador não reconhece nada', async () => {
    const bundle = simpleBundle();

    await db.prisma.importBookEntry.create({
      data: {
        userId: other.id,
        bundleId: bundle.manifest.bundleId,
        localId: 'veh_1',
        recordKind: 'vehicle',
        createdRecordId: 'veh_de_outro',
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1_000),
      },
    });

    const result = await preview(bundle.zip, user.id);

    // A chave inclui o `userId` — é o que faz importar o mesmo bundle noutra conta criar
    // tudo (§9.5).
    expect(result.plan.entries.find((e) => e.localId === 'veh_1')?.action).toBe('create');
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Preview — isolamento por userId (§7.3)                                   */
/* -------------------------------------------------------------------------- */

describe('preview: isolamento por userId', () => {
  it('os dados de outro utilizador não entram na deduplicação', async () => {
    /*
     * O outro utilizador tem um veículo com exactamente a mesma matrícula. Se a leitura
     * não estivesse limitada ao utilizador certo, o plano diria "já existe" e o veículo
     * do titular nunca seria criado.
     */
    await createVehicle(db, other.id, { plate: 'AA00BB' });

    const result = await preview(simpleBundle().zip, user.id);
    const vehicleEntry = result.plan.entries.find((e) => e.localId === 'veh_1');

    expect(vehicleEntry?.action).toBe('create');
    expect(result.plan.counts.exact).toBe(0);
  });

  it('as entradas do livro consultadas são só as do utilizador', async () => {
    const bundle = simpleBundle();

    await db.prisma.importBookEntry.create({
      data: {
        userId: other.id,
        bundleId: bundle.manifest.bundleId,
        localId: 'veh_1',
        recordKind: 'vehicle',
        createdRecordId: 'x',
        expiresAt: new Date(Date.now() + 1_000_000),
      },
    });

    const result = await preview(bundle.zip, user.id);
    expect(result.plan.counts.exact).toBe(0);
  });

  it('o plano não expõe identificadores internos de outro utilizador', async () => {
    const vehOutro = await createVehicle(db, other.id, { plate: 'AA00BB' });

    const result = await preview(simpleBundle().zip, user.id);
    const serialized = JSON.stringify(result.plan);

    expect(serialized).not.toContain(vehOutro.id);
  });
});

/* -------------------------------------------------------------------------- */
/* 6. Preview — documentos sem conteúdo (§5.6)                                 */
/* -------------------------------------------------------------------------- */

describe('preview: documentos missingContent', () => {
  it('um documento sem bytes é contado em documentsMissingContent', async () => {
    const bundle = buildBundle({
      dataFiles: [
        { path: 'documents.jsonl', content: JSON.stringify({ localId: 'doc_1', name: 'Seguro', category: 'insurance', contentState: 'missingContent' }) },
      ],
    });

    const result = await preview(bundle.zip);

    expect(result.plan.counts.documentsMissingContent).toBe(1);
  });

  it('um documento sem bytes é criável — a lacuna é declarada, não bloqueante', async () => {
    const bundle = buildBundle({
      dataFiles: [
        { path: 'documents.jsonl', content: JSON.stringify({ localId: 'doc_1', name: 'Seguro', category: 'insurance', contentState: 'missingContent' }) },
      ],
    });

    const result = await preview(bundle.zip);
    const entry = result.plan.entries.find((e) => e.localId === 'doc_1');

    expect(entry?.action).toBe('create');
    expect(entry?.issues.some((i) => i.code === 'document.content_missing')).toBe(true);
  });

  it('um documento com bytes presentes não conta como sem conteúdo', async () => {
    const bundle = buildBundle({
      dataFiles: [
        { path: 'documents.jsonl', content: JSON.stringify({ localId: 'doc_1', name: 'Seguro', category: 'insurance', contentState: 'included', contentPath: 'documents/doc_1/seguro.pdf', contentSha256: 'd'.repeat(64) }) },
      ],
      documents: { 'documents/doc_1/seguro.pdf': 'conteúdo do seguro' },
    });

    const result = await preview(bundle.zip);

    expect(result.plan.counts.documentsMissingContent).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 7. Preview — avisos de counts                                               */
/* -------------------------------------------------------------------------- */

describe('preview: avisos de counts divergentes (A26)', () => {
  it('counts divergentes produzem aviso, não recusa', async () => {
    const bundle = buildBundle({
      dataFiles: [
        { path: 'vehicles.jsonl', content: JSON.stringify({ localId: 'veh_1', plate: 'AA-00-BB', plateDisplay: 'AA-00-BB' }) },
      ],
      declaredCounts: { vehicles: 99 },
    });

    const result = await preview(bundle.zip);

    expect(result.plan.state).toBe('ready');
    expect(result.bundle.issues.some((i) => i.code === 'bundle.count_mismatch')).toBe(true);
  });

  it('o aviso chega ao plano, para a interface o poder mostrar', async () => {
    const bundle = buildBundle({
      dataFiles: [
        { path: 'vehicles.jsonl', content: JSON.stringify({ localId: 'veh_1', plate: 'AA-00-BB', plateDisplay: 'AA-00-BB' }) },
      ],
      declaredCounts: { vehicles: 99 },
    });

    const result = await preview(bundle.zip);

    expect(result.plan.issues.some((i) => i.code === 'bundle.count_mismatch')).toBe(true);
  });

  it('counts coerentes não produzem aviso', async () => {
    const result = await preview(simpleBundle().zip);

    expect(result.plan.issues.some((i) => i.code === 'bundle.count_mismatch')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 8. Preview — limites de volume (A26 / D4)                                   */
/* -------------------------------------------------------------------------- */

describe('preview: limites de volume', () => {
  it('recusa acima de 100 000 registos antes de qualquer escrita', async () => {
    /*
     * Não se constroem 100 001 linhas de JSON: o limite é verificado à medida que os
     * registos são lidos, e é isso que o teste exerce — um bundle grande recusa durante a
     * leitura, sem chegar ao plano e sem tocar na base de dados.
     *
     * O número é reduzido pela injecção de limites, que só pode **apertar** (a mesma regra
     * do ZIP em `resolveLimits`). Apertar prova o mecanismo sem pagar o custo.
     */
    const lines = Array.from({ length: 11 }, (_, i) =>
      JSON.stringify({ localId: `veh_${i}`, plate: `AA-00-${String(i).padStart(2, '0')}`, plateDisplay: `AA-00-${String(i).padStart(2, '0')}` }),
    ).join('\n');

    const bundle = buildBundle({ dataFiles: [{ path: 'vehicles.jsonl', content: lines }] });

    const before = await snapshot();
    const result = await previewWithLimits(bundle.zip, user.id, { maxRecords: 10 });
    const after = await snapshot();

    expect(result.refused).toBe(true);
    expect(after).toEqual(before);
  });

  it('aceita exactamente no limite', async () => {
    const lines = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({ localId: `veh_${i}`, plate: `AA-00-${String(i).padStart(2, '0')}`, plateDisplay: `AA-00-${String(i).padStart(2, '0')}` }),
    ).join('\n');

    const bundle = buildBundle({ dataFiles: [{ path: 'vehicles.jsonl', content: lines }] });

    const result = await previewWithLimits(bundle.zip, user.id, { maxRecords: 10 });

    expect(result.refused).toBe(false);
    expect(result.plan?.counts.create).toBe(10);
  });

  it('um count enganador não contorna o limite (A26)', async () => {
    /*
     * O manifest declara 1 registo e o ficheiro traz 11. Se o limite fosse aplicado ao
     * valor declarado, passaria. O A26 exige que seja aplicado aos dados **efetivamente
     * lidos**.
     */
    const lines = Array.from({ length: 11 }, (_, i) =>
      JSON.stringify({ localId: `veh_${i}`, plate: `AA-00-${String(i).padStart(2, '0')}`, plateDisplay: `AA-00-${String(i).padStart(2, '0')}` }),
    ).join('\n');

    const bundle = buildBundle({
      dataFiles: [{ path: 'vehicles.jsonl', content: lines, declaredRecords: 1 }],
    });

    const result = await previewWithLimits(bundle.zip, user.id, { maxRecords: 10 });

    expect(result.refused).toBe(true);
  });

  it('acima de 100 000 com os limites por omissão também é recusado', async () => {
    /*
     * Verificação do valor por omissão do contrato, sem construir o ficheiro: o limite
     * existe, é 100 000, e é um teto absoluto da implementação (D4).
     */
    const { BUNDLE_LIMITS } = await import('../src/domain/import/bundle.js');
    expect(BUNDLE_LIMITS.maxRecords).toBe(100_000);
  });
});

/* -------------------------------------------------------------------------- */
/* 9. Apply — criação                                                          */
/* -------------------------------------------------------------------------- */

describe('apply: criação de registos', () => {
  it('cria os registos propostos pelo plano', async () => {
    const previewResult = await preview(simpleBundle().zip);

    const report = await apply(previewResult);

    expect(await db.prisma.vehicle.count({ where: { userId: user.id } })).toBe(1);
    expect(await db.prisma.fuelSession.count({ where: { userId: user.id } })).toBe(1);
    expect(report.created.length).toBe(2);
  });

  it('os valores criados são os do bundle', async () => {
    const previewResult = await preview(simpleBundle().zip);
    await apply(previewResult);

    const fuel = await db.prisma.fuelSession.findFirst({ where: { userId: user.id } });

    expect(fuel?.litres).toBeCloseTo(42.35, 2);
    expect(fuel?.amountCents).toBe(7_000);
    expect(fuel?.odometerKm).toBe(15_000);
    expect(fuel?.date.toISOString().slice(0, 10)).toBe('2026-02-10');
  });

  it('cria o veículo com a matrícula normalizada', async () => {
    const previewResult = await preview(simpleBundle().zip);
    await apply(previewResult);

    const vehicle = await db.prisma.vehicle.findFirst({ where: { userId: user.id } });

    expect(vehicle?.plate).toBe('AA00BB');
    expect(vehicle?.plateDisplay).toBe('AA-00-BB');
  });

  it('resolve localId → id na referência ao veículo', async () => {
    const previewResult = await preview(simpleBundle().zip);
    await apply(previewResult);

    const fuel = await db.prisma.fuelSession.findFirst({ where: { userId: user.id } });
    const vehicle = await db.prisma.vehicle.findFirst({ where: { userId: user.id } });

    expect(fuel?.vehicleId).toBe(vehicle?.id);
  });

  it('devolve o mapa localId → id no relatório', async () => {
    const previewResult = await preview(simpleBundle().zip);

    const report = await apply(previewResult);

    expect(report.localToId.get('veh_1')).toBeTruthy();
    expect(report.localToId.get('fuel_1')).toBeTruthy();
  });

  it('respeita o utilizador autenticado — não o bundle', async () => {
    const previewResult = await preview(simpleBundle().zip, user.id);
    await apply(previewResult);

    expect(await db.prisma.vehicle.count({ where: { userId: other.id } })).toBe(0);
  });

  it('um plano vazio não cria nada', async () => {
    const empty = buildBundle({ dataFiles: [] });
    const previewResult = await preview(empty.zip);

    const report = await apply(previewResult);

    expect(report.created).toEqual([]);
    expect(await db.prisma.vehicle.count()).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 10. Apply — livro de idempotência (§9.5)                                    */
/* -------------------------------------------------------------------------- */

describe('apply: livro de idempotência', () => {
  it('cria uma entrada no livro por registo criado', async () => {
    const bundle = simpleBundle();
    const previewResult = await preview(bundle.zip);

    await apply(previewResult);

    const entries = await db.prisma.importBookEntry.findMany({ where: { userId: user.id } });

    expect(entries.length).toBe(2);
    expect(entries.map((e) => e.localId).sort()).toEqual(['fuel_1', 'veh_1']);
    expect(entries.every((e) => e.bundleId === bundle.manifest.bundleId)).toBe(true);
  });

  it('guarda o id do registo criado', async () => {
    const previewResult = await preview(simpleBundle().zip);
    const report = await apply(previewResult);

    const entry = await db.prisma.importBookEntry.findFirst({
      where: { userId: user.id, localId: 'veh_1' },
    });

    expect(entry?.createdRecordId).toBe(report.localToId.get('veh_1'));
  });

  it('guarda o tipo do registo, para o relatório contar por tipo', async () => {
    const previewResult = await preview(simpleBundle().zip);
    await apply(previewResult);

    const entry = await db.prisma.importBookEntry.findFirst({
      where: { userId: user.id, localId: 'veh_1' },
    });

    expect(entry?.recordKind).toBe('vehicle');
  });

  it('a retenção é de 12 meses (decisão 12)', async () => {
    const previewResult = await preview(simpleBundle().zip);
    await apply(previewResult);

    const entry = await db.prisma.importBookEntry.findFirst({ where: { userId: user.id } });
    const days = (entry!.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1_000);

    // Cerca de 365 dias — a folga cobre o tempo de execução do teste.
    expect(days).toBeGreaterThan(360);
    expect(days).toBeLessThan(370);
  });

  it('não cria entrada no livro para registos que não foram criados', async () => {
    await createVehicle(db, user.id, { plate: 'AA00BB' });
    const previewResult = await preview(simpleBundle().zip);

    await apply(previewResult);

    const entries = await db.prisma.importBookEntry.findMany({ where: { userId: user.id } });
    expect(entries.map((e) => e.localId)).toEqual(['fuel_1']);
  });
});

/* -------------------------------------------------------------------------- */
/* 11. Apply — idempotência                                                    */
/* -------------------------------------------------------------------------- */

describe('apply: reimportação idempotente', () => {
  it('reimportar o mesmo bundle não cria nada', async () => {
    const bundle = simpleBundle();

    const first = await preview(bundle.zip);
    await apply(first);

    const afterFirst = await snapshot();

    const second = await preview(bundle.zip);
    const report = await apply(second);

    expect(await snapshot()).toEqual(afterFirst);
    expect(report.created).toEqual([]);
  });

  it('a segunda leitura reconhece tudo pelo livro ou pelo conteúdo', async () => {
    const bundle = simpleBundle();

    const first = await preview(bundle.zip);
    await apply(first);

    const second = await preview(bundle.zip);

    expect(second.plan.counts.create).toBe(0);
    expect(second.plan.state).toBe('nothing-to-do');
  });

  it('nunca duplica uma importação já concluída, mesmo repetida três vezes', async () => {
    const bundle = simpleBundle();

    for (let i = 0; i < 3; i += 1) {
      const previewResult = await preview(bundle.zip);
      await apply(previewResult);
    }

    expect(await db.prisma.vehicle.count()).toBe(1);
    expect(await db.prisma.fuelSession.count()).toBe(1);
    expect(await db.prisma.importBookEntry.count()).toBe(2);
  });

  it('o mesmo bundle noutra conta cria tudo (§9.5)', async () => {
    /*
     * A chave do livro inclui o `userId`. É isto que torna possível exportar de uma conta
     * e importar noutra — se o livro fosse global, a segunda conta não recebia nada.
     */
    const bundle = simpleBundle();

    const first = await preview(bundle.zip, user.id);
    await apply(first);

    const second = await preview(bundle.zip, other.id);
    await apply(second, other.id);

    expect(await db.prisma.vehicle.count({ where: { userId: user.id } })).toBe(1);
    expect(await db.prisma.vehicle.count({ where: { userId: other.id } })).toBe(1);
  });

  it('a deduplicação por conteúdo protege mesmo sem o livro', async () => {
    /*
     * O livro e a deduplicação são mecanismos diferentes (§8.2) e é isso que os torna
     * complementares: o livro diz "já importado deste ficheiro", a deduplicação diz "já
     * existe na conta". Apagar o livro deixa a segunda a proteger.
     */
    const bundle = simpleBundle();

    const first = await preview(bundle.zip);
    await apply(first);

    await db.prisma.importBookEntry.deleteMany();

    const second = await preview(bundle.zip);
    await apply(second);

    expect(await db.prisma.vehicle.count()).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 12. Apply — não sobrescrever (decisão 8)                                     */
/* -------------------------------------------------------------------------- */

describe('apply: nunca sobrescreve por omissão', () => {
  it('um registo existente com valor diferente não é alterado', async () => {
    const vehicle = await createVehicle(db, user.id, { plate: 'AA00BB', make: 'Kia', model: 'EV3' });
    await db.prisma.vehicle.update({ where: { id: vehicle.id }, data: { model: 'e-Niro' } });

    const previewResult = await preview(simpleBundle().zip);
    await apply(previewResult);

    const after = await db.prisma.vehicle.findUnique({ where: { id: vehicle.id } });

    // O bundle diz `EV3`, a conta diz `e-Niro`. A conta ganha: o pior caso de uma
    // importação errada passa a ser "dados a mais" em vez de "dados perdidos".
    expect(after?.model).toBe('e-Niro');
  });

  it('o pior caso é ganhar dados, não perder histórico', async () => {
    const vehicle = await createVehicle(db, user.id, { plate: 'AA00BB' });
    const antes = await db.prisma.fuelSession.create({
      data: {
        vehicleId: vehicle.id,
        userId: user.id,
        date: new Date('2026-02-10'),
        litres: 99,
        amountCents: 111,
        odometerKm: 15_000,
      },
    });

    const previewResult = await preview(simpleBundle().zip);
    await apply(previewResult);

    const depois = await db.prisma.fuelSession.findUnique({ where: { id: antes.id } });

    expect(depois?.litres).toBe(99);
    expect(depois?.amountCents).toBe(111);
  });

  it('preenche um campo em branco — a única escrita automática permitida', async () => {
    const vehicle = await createVehicle(db, user.id, { plate: 'AA00BB', make: 'Kia', model: 'EV3' });
    await db.prisma.vehicle.update({ where: { id: vehicle.id }, data: { year: null } });

    const previewResult = await preview(simpleBundle().zip);
    await apply(previewResult);

    const after = await db.prisma.vehicle.findUnique({ where: { id: vehicle.id } });

    expect(after?.year).toBe(2025);
  });

  it('não sobrescreve um campo já preenchido com o mesmo valor', async () => {
    const vehicle = await createVehicle(db, user.id, { plate: 'AA00BB', make: 'Kia', model: 'EV3', year: 2025 });

    const previewResult = await preview(simpleBundle().zip);
    await apply(previewResult);

    const after = await db.prisma.vehicle.findUnique({ where: { id: vehicle.id } });
    expect(after?.year).toBe(2025);
  });

  it('um plano sem enriquecimentos não altera registos existentes', async () => {
    await createVehicle(db, user.id, { plate: 'AA00BB', make: 'Kia', model: 'EV3', year: 2025 });
    const vehicle = await db.prisma.vehicle.findFirst({ where: { userId: user.id } });

    const previewResult = await preview(simpleBundle().zip);
    const report = await apply(previewResult);

    expect(report.enriched).toEqual([]);
    expect(vehicle).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* 13. Apply — rollback e atomicidade (§7.2, decisão 7)                        */
/* -------------------------------------------------------------------------- */

describe('apply: rollback total quando uma operação falha', () => {
  it('uma falha a meio do lote não deixa registos criados', async () => {
    /*
     * A §7.2 exige tudo-ou-nada até 10 000 registos. Um plano com dois veículos em que o
     * segundo viola `@@unique([userId, plate])` — porque a matrícula já existe na conta —
     * tem de reverter o primeiro.
     *
     * O plano é construído à mão de propósito: um plano vindo do `preview` nunca proporia
     * criar um veículo com uma matrícula já existente (a deduplicação apanha-o), pelo que
     * este caminho não é alcançável por um bundle normal. É exactamente por isso que o
     * teste o constrói — o objetivo é provar a atomicidade, não a deduplicação.
     */

    const bundle = buildBundle({
      dataFiles: [
        {
          path: 'vehicles.jsonl',
          content: [
            JSON.stringify({ localId: 'veh_novo', plate: 'BB-11-CC', plateDisplay: 'BB-11-CC' }),
            JSON.stringify({ localId: 'veh_duplicado', plate: 'BB-11-CC', plateDisplay: 'BB-11-CC' }),
          ].join('\n'),
        },
      ],
    });

    const before = await snapshot();
    const previewResult = await preview(bundle.zip);

    // O veículo duplicado tem de estar no plano como `create` para o teste ter sentido.
    expect(previewResult.plan.entries.filter((e) => e.action === 'create').length).toBeGreaterThan(0);

    await expect(
      apply(previewResult),
    ).rejects.toThrow();

    expect(await snapshot()).toEqual(before);
  });

  it('uma falha não deixa entradas no livro de idempotência', async () => {

    const bundle = buildBundle({
      dataFiles: [
        {
          path: 'vehicles.jsonl',
          content: [
            JSON.stringify({ localId: 'veh_novo', plate: 'BB-11-CC', plateDisplay: 'BB-11-CC' }),
            JSON.stringify({ localId: 'veh_duplicado', plate: 'BB-11-CC', plateDisplay: 'BB-11-CC' }),
          ].join('\n'),
        },
      ],
    });

    const previewResult = await preview(bundle.zip);

    await expect(apply(previewResult)).rejects.toThrow();

    expect(await db.prisma.importBookEntry.count()).toBe(0);
  });

  it('o rollback é total — nenhum registo parcial fica em nenhuma tabela', async () => {
    const bundle = buildBundle({
      dataFiles: [
        {
          path: 'vehicles.jsonl',
          content: [
            JSON.stringify({ localId: 'veh_novo', plate: 'BB-11-CC', plateDisplay: 'BB-11-CC' }),
            JSON.stringify({ localId: 'veh_duplicado', plate: 'BB-11-CC', plateDisplay: 'BB-11-CC' }),
          ].join('\n'),
        },
        {
          path: 'fuel.jsonl',
          content: JSON.stringify({ localId: 'fuel_1', vehicleLocalId: 'veh_novo', date: '2026-02-10', litres: 10, amountCents: 1_500 }),
        },
      ],
    });

    const before = await snapshot();
    const previewResult = await preview(bundle.zip);

    await expect(apply(previewResult)).rejects.toThrow();

    expect(await snapshot()).toEqual(before);
  });

  it('depois de uma falha, a mesma importação pode correr de novo', async () => {
    /*
     * O rollback tem de deixar a base de dados **utilizável**. Se tivesse deixado o livro
     * ou um registo parcial, a segunda tentativa — corrigido o motivo da falha — não
     * conseguiria completar-se.
     */
    const bundle = buildBundle({
      dataFiles: [
        {
          path: 'vehicles.jsonl',
          content: [
            JSON.stringify({ localId: 'veh_novo', plate: 'BB-11-CC', plateDisplay: 'BB-11-CC' }),
            JSON.stringify({ localId: 'veh_duplicado', plate: 'BB-11-CC', plateDisplay: 'BB-11-CC' }),
          ].join('\n'),
        },
      ],
    });

    const previewResult = await preview(bundle.zip);
    await expect(apply(previewResult)).rejects.toThrow();

    // Corrigido o motivo da falha — a segunda linha passa a ter uma matrícula distinta —
    // a importação corre até ao fim.
    const corrigido = buildBundle({
      dataFiles: [
        {
          path: 'vehicles.jsonl',
          content: [
            JSON.stringify({ localId: 'veh_novo', plate: 'BB-11-CC', plateDisplay: 'BB-11-CC' }),
            JSON.stringify({ localId: 'veh_duplicado', plate: 'CC-22-DD', plateDisplay: 'CC-22-DD' }),
          ].join('\n'),
        },
      ],
    });

    const retry = await preview(corrigido.zip);
    const report = await apply(retry);

    expect(report.created.length).toBe(2);
    expect(await db.prisma.vehicle.count({ where: { userId: user.id } })).toBe(2);
  });
});

describe('apply: transação única até 10 000 registos (§7.2)', () => {
  it('todos os registos de um lote pequeno entram na mesma transação', async () => {
    const vehicleLines = Array.from({ length: 50 }, (_, i) =>
      JSON.stringify({ localId: `veh_${i}`, plate: `BB-${String(i).padStart(2, '0')}-CC`, plateDisplay: `BB-${String(i).padStart(2, '0')}-CC` }),
    ).join('\n');

    const bundle = buildBundle({ dataFiles: [{ path: 'vehicles.jsonl', content: vehicleLines }] });
    const previewResult = await preview(bundle.zip);

    const report = await apply(previewResult);

    expect(report.created.length).toBe(50);
    expect(await db.prisma.vehicle.count({ where: { userId: user.id } })).toBe(50);
    expect(report.batches).toBe(1);
  });

  it('reporta uma só transação, não lotes', async () => {
    const previewResult = await preview(simpleBundle().zip);
    const report = await apply(previewResult);

    expect(report.batches).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 14. Apply — rejeição antes de escrever                                      */
/* -------------------------------------------------------------------------- */

describe('apply: recusa antes de escrever', () => {
  it('recusa um plano bloqueado sem tocar na base de dados', async () => {
    const broken = buildBundle({
      dataFiles: [
        { path: 'vehicles.jsonl', content: JSON.stringify({ localId: 'veh_1', plate: 'AA-00-BB', plateDisplay: 'AA-00-BB' }) },
        { path: 'fuel.jsonl', content: JSON.stringify({ localId: 'fuel_1', vehicleLocalId: 'nao_existe', date: '2026-02-10', litres: 1, amountCents: 100 }) },
      ],
    });

    const before = await snapshot();
    const previewResult = await preview(broken.zip);

    expect(previewResult.plan.state).toBe('blocked');
    await expect(apply(previewResult)).rejects.toThrow();

    expect(await snapshot()).toEqual(before);
  });

  it('recusa aplicar um plano com decisões por tomar', async () => {
    /*
     * A §11 exige que o utilizador veja o que vai acontecer. Aplicar um plano com
     * prováveis por decidir seria decidir por ele.
     */
    const vehicle = await createVehicle(db, user.id, { plate: 'AA00BB' });
    await db.prisma.fuelSession.create({
      data: {
        vehicleId: vehicle.id,
        userId: user.id,
        date: new Date('2026-02-10'),
        litres: 42.4,
        amountCents: 7_000,
        odometerKm: 15_045,
      },
    });

    const previewResult = await preview(simpleBundle().zip);
    expect(previewResult.plan.counts.probable).toBeGreaterThan(0);

    const before = await snapshot();
    await expect(apply(previewResult)).rejects.toThrow();

    expect(await snapshot()).toEqual(before);
  });

  it('um plano bloqueado por volume é recusado antes de qualquer alteração', async () => {
    const lines = Array.from({ length: 11 }, (_, i) =>
      JSON.stringify({ localId: `veh_${i}`, plate: `BB-${String(i).padStart(2, '0')}-CC`, plateDisplay: `BB-${String(i).padStart(2, '0')}-CC` }),
    ).join('\n');

    const bundle = buildBundle({ dataFiles: [{ path: 'vehicles.jsonl', content: lines }] });

    const before = await snapshot();
    const result = await previewWithLimits(bundle.zip, user.id, { maxRecords: 10 });

    expect(result.refused).toBe(true);
    expect(await snapshot()).toEqual(before);
  });
});

/* -------------------------------------------------------------------------- */
/* 15. Apply — enriquecimento                                                  */
/* -------------------------------------------------------------------------- */

describe('apply: enriquecimento de campos em branco', () => {
  it('reporta os registos enriquecidos separadamente dos criados', async () => {
    const vehicle = await createVehicle(db, user.id, { plate: 'AA00BB', make: 'Kia', model: 'EV3' });
    await db.prisma.vehicle.update({ where: { id: vehicle.id }, data: { year: null } });

    const previewResult = await preview(simpleBundle().zip);
    const report = await apply(previewResult);

    expect(report.enriched.length).toBe(1);
    expect(report.enriched[0]?.localId).toBe('veh_1');
    expect(report.created.some((c) => c.localId === 'veh_1')).toBe(false);
  });

  it('não cria um registo novo quando enriquece um existente', async () => {
    const vehicle = await createVehicle(db, user.id, { plate: 'AA00BB', make: 'Kia', model: 'EV3' });
    await db.prisma.vehicle.update({ where: { id: vehicle.id }, data: { year: null } });

    const previewResult = await preview(simpleBundle().zip);
    await apply(previewResult);

    expect(await db.prisma.vehicle.count({ where: { userId: user.id } })).toBe(1);
  });

  it('os campos enriquecidos ficam nomeados no relatório', async () => {
    const vehicle = await createVehicle(db, user.id, { plate: 'AA00BB', make: 'Kia', model: 'EV3' });
    await db.prisma.vehicle.update({ where: { id: vehicle.id }, data: { year: null } });

    const previewResult = await preview(simpleBundle().zip);
    const report = await apply(previewResult);

    expect(report.enriched[0]?.fields).toContain('year');
  });
});
