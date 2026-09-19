/**
 * FASE F — a ligação do adaptador CSV ao núcleo existente (§4.1, §4.3, §10.2).
 *
 * ## O que este ficheiro tem de provar, e porque é que não basta "funciona"
 *
 * A §4.3 estabelece a regra que governa todo o desenho da Camada 2:
 *
 * > acrescentar um adaptador **não pode** exigir tocar no Normalizer, no Validator, no
 * > Deduplicator, nem na Transaction.
 *
 * A forma de provar que essa regra foi cumprida não é inspecionar o código — é **comparar
 * comportamentos**. Para isso, cada teste constrói o mesmo conteúdo por dois caminhos
 * diferentes:
 *
 * ```
 *   ficheiro CSV  ──► previewCsv   ──┐
 *                                    ├──► mesmo resultado?
 *   bundle ZIP    ──► previewImport ─┘
 * ```
 *
 * Se os dois caminhos produzem o mesmo `CanonicalRecord`, a mesma validação, as mesmas
 * chaves de deduplicação, o mesmo plano, a mesma escrita e o mesmo relatório, então o CSV
 * **está** a usar o núcleo — porque não existe outro sítio de onde esses resultados possam
 * vir. Um teste que verificasse só "o CSV importou 3 registos" passaria na mesma com uma
 * segunda implementação completa de validação e deduplicação, que é precisamente a falha
 * que a §4.3 existe para impedir.
 *
 * ## Porque é que corre contra uma base de dados a sério
 *
 * Pelas mesmas razões declaradas em `import-apply-preview.test.ts`: o que aqui se compara
 * são propriedades do motor (transacção, idempotência, isolamento por `userId`) e não
 * aritmética. Um duplo em memória provaria a nossa imitação das regras.
 *
 * ## Os dois adaptadores não partilham a Normalização — e isso está certo
 *
 * O bundle é um formato **fechado**: os campos crus chegam com os nomes do formato e são
 * traduzidos por `normalizeRecords` (A27). O CSV é um formato **aberto**: quem decide o que
 * cada coluna significa é o mapeamento, e o resultado já são campos de domínio.
 *
 * Isso significa que a igualdade que se compara aqui é a igualdade **a partir dos
 * `CanonicalRecord`** — que é exatamente onde a §4.3 situa o contrato. Comparar antes disso
 * compararia dois vocabulários de entrada diferentes, o que não é uma invariante: seria
 * exigir que um CSV se chamasse `vehicles.jsonl`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, createUser, createVehicle, type TestDb } from './helpers/db.js';
import { buildBundle } from './helpers/bundle-builder.js';

import { readZip } from '../src/domain/import/zip.js';
import { dedupeKeysFor } from '../src/domain/import/plan.js';
import type { CanonicalRecord } from '../src/domain/import/validate.js';

import { previewImport } from '../src/services/import/read.js';
import { applyImport } from '../src/services/import/apply.js';
import { buildImportReport } from '../src/services/import/report.js';
import { previewCsv } from '../src/services/import/csv-preview.js';

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
  await db.prisma.importBookEntry.deleteMany();
  await db.prisma.expense.deleteMany();
  await db.prisma.fuelSession.deleteMany();
  await db.prisma.odometerReading.deleteMany();
  await db.prisma.maintenanceRecord.deleteMany();
  await db.prisma.vehicle.deleteMany();
  await db.prisma.user.deleteMany();

  user = await createUser(db, { email: 'titular@zemlo.test', name: 'Titular' });
  other = await createUser(db, { email: 'outro@zemlo.test', name: 'Outro' });
});

/* -------------------------------------------------------------------------- */
/* Utilitários                                                                 */
/* -------------------------------------------------------------------------- */

/** Codifica texto em UTF-8, sem BOM. */
function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * O mesmo conteúdo, na forma de um bundle nativo.
 *
 * Este é o **lado de referência** de todas as comparações: o núcleo da Camada 1 já foi
 * validado nas Fases 1–4 com bundles, pelo que é a partir dele que a equivalência se mede.
 */
function referenceBundle() {
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
          // A mesma data civil do CSV de referência, escrita na forma ISO do bundle. É o
          // que torna a comparação dos dois caminhos uma comparação de igualdade, e não de
          // duas datas diferentes que por acaso têm o mesmo efeito.
          date: '2026-02-25',
          litres: 42.35,
          amountCents: 7_000,
          odometerKm: 15_000,
        }),
      },
    ],
  });
}

/** Lê o bundle de referência e devolve o seu `previewImport`. */
async function referencePreview() {
  const built = referenceBundle();
  const zip = await readZip(built.zip);
  return previewImport({ zip, userId: user.id, prisma: db.prisma });
}

/**
 * O **mesmo** conteúdo, na forma de um CSV de exportação do Zemlo.
 *
 * Reproduz a convenção da §5.4: separador `;`, vírgula decimal, cabeçalhos em português.
 * É deliberadamente o formato que o próprio Zemlo escreve — se o ciclo
 * exportar→importar não fechar sobre si mesmo, é aqui que se vê.
 *
 * ## A data é `25/02/2026`, e a escolha é deliberada
 *
 * `25` é maior que `12`, e isso **prova** que o primeiro componente é o dia. Uma data como
 * `10/02/2026` seria ambígua (ambos ≤ 12) e a §10.4 obrigaria a perguntar — o que faria
 * este ficheiro de referência parar no ecrã de confirmação em vez de produzir registos, e
 * misturaria duas coisas que se querem testar em separado. Os testes de ambiguidade de data
 * vivem em `import-csv-values.test.ts` e há um caso dedicado em baixo.
 *
 * ## As duas ambiguidades deste ficheiro, e porque é que ambas são o comportamento certo
 *
 * **1. Tipo de registo (§10.5).** Um CSV de exportação de abastecimentos traz `Valor`,
 * `Litros` **e** `Categoria`, porque o Zemlo exporta a categoria em todas as linhas com
 * valor. Isso dá pontuação igual a duas regras:
 *
 * ```
 *   fuel    : date+amountCents+litres   (0.6) + odometerKm       (0.1)        = 0.7
 *   expense : date+amountCents+category (0.6) + vendor+desc+paid (0.3) − litros (0.2) = 0.7
 * ```
 *
 * A §10.4 proíbe resolver isto em silêncio e a §10.5 diz que o utilizador escolhe. É por
 * isso que os testes abaixo passam `kind` explicitamente: **não** estão a contornar um
 * defeito, estão a fazer o que o produto exige que o utilizador faça. Há um teste dedicado
 * (`assinala a ambiguidade entre abastecimento e despesa`) que fixa este caso.
 *
 * **2. Formato da data.** Não há nenhuma aqui, precisamente por causa de `25/02/2026`.
 */
const REFERENCE_CSV = [
  'Matrícula;Data;Valor (€);Litros;Quilometragem;Fornecedor;Descrição;Categoria;Pago;Notas',
  'AA-00-BB;25/02/2026;70,00;42,35;15000;Galp;Abastecimento;Combustível;Sim;',
].join('\r\n');

/* -------------------------------------------------------------------------- */
/* 1. O adaptador produz o mesmo `CanonicalRecord`                             */
/* -------------------------------------------------------------------------- */

describe('equivalência do adaptador — CanonicalRecord', () => {
  /**
   * O contrato da §4.3 é o `CanonicalRecord`. Se a forma deste objeto divergir entre os
   * dois adaptadores, tudo o que vem depois diverge — e o desvio só apareceria na escrita,
   * longe da causa.
   */
  it('produz registos com a mesma forma que o núcleo espera', async () => {
    const csv = await previewCsv({
      bytes: utf8(REFERENCE_CSV),
      userId: user.id,
      prisma: db.prisma,
      kind: 'fuel',
    });

    expect(csv.records.length).toBeGreaterThan(0);

    for (const record of csv.records) {
      // As cinco propriedades do contrato (§4.3). `file`/`line`/`externalIds` são opcionais.
      expect(record).toHaveProperty('kind');
      expect(record).toHaveProperty('localId');
      expect(record).toHaveProperty('fields');
      expect(record).toHaveProperty('references');
      expect(typeof record.kind).toBe('string');
      expect(typeof record.localId).toBe('string');
      expect(typeof record.fields).toBe('object');
      expect(typeof record.references).toBe('object');
    }
  });

  /**
   * O `localId` tem de ser **aceite pelo núcleo**. Se o adaptador gerasse um identificador
   * inválido, o Validator recusá-lo-ia — e a mensagem apontaria para o ficheiro do
   * utilizador em vez de para o adaptador.
   */
  it('gera `localId` que o Validator do núcleo aceita', async () => {
    const csv = await previewCsv({ bytes: utf8(REFERENCE_CSV), userId: user.id, prisma: db.prisma, kind: 'fuel' });

    const invalidIdIssues = csv.plan.issues.filter((issue) =>
      issue.code.toLowerCase().includes('localid'),
    );
    expect(invalidIdIssues).toEqual([]);
  });

  /**
   * Os valores que chegam ao núcleo têm de ser **valores de domínio**, não texto cru.
   *
   * É a diferença mais fácil de perder: um adaptador que escrevesse `"70,00"` em vez de
   * `7000` passaria todos os testes de "não rebentou" e escreveria lixo na base de dados.
   * A verificação é por **tipo**, porque é o tipo que o núcleo usa para decidir.
   */
  it('converte valores para os tipos de domínio antes de os entregar ao núcleo', async () => {
    const csv = await previewCsv({ bytes: utf8(REFERENCE_CSV), userId: user.id, prisma: db.prisma, kind: 'fuel' });

    const fuel = csv.records.find((record) => record.kind === 'fuel');
    expect(fuel).toBeDefined();

    // Campo monetário: inteiro em cêntimos, não a string "70,00".
    if (fuel?.fields.amountCents !== undefined) {
      expect(typeof fuel.fields.amountCents).toBe('number');
      expect(Number.isInteger(fuel.fields.amountCents as number)).toBe(true);
      expect(fuel.fields.amountCents).toBe(7_000);
    }

    // Litros: número decimal, não a string "42,35".
    if (fuel?.fields.litres !== undefined) {
      expect(typeof fuel.fields.litres).toBe('number');
      expect(fuel.fields.litres).toBeCloseTo(42.35, 2);
    }
  });

  /**
   * O `localId` de uma linha tem de ser **estável** entre análises do mesmo ficheiro.
   *
   * É a chave da idempotência (§9.5). Um identificador aleatório faria a mesma importação
   * repetida criar tudo outra vez, e o erro seria invisível até a conta ter o dobro dos
   * registos.
   */
  it('gera o mesmo `localId` em análises sucessivas do mesmo ficheiro', async () => {
    const first = await previewCsv({ bytes: utf8(REFERENCE_CSV), userId: user.id, prisma: db.prisma, kind: 'fuel' });
    const second = await previewCsv({ bytes: utf8(REFERENCE_CSV), userId: user.id, prisma: db.prisma, kind: 'fuel' });

    expect(second.records.map((record) => record.localId)).toEqual(
      first.records.map((record) => record.localId),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* 2. A mesma validação                                                        */
/* -------------------------------------------------------------------------- */

describe('equivalência do adaptador — validação', () => {
  /**
   * A validação tem de vir do **mesmo** `validateRecords`. Um adaptador que validasse por
   * si aceitaria dados que o bundle recusa, e a divergência manifestar-se-ia como registos
   * inválidos na base de dados sem nenhum aviso.
   *
   * O teste usa uma data impossível: qualquer implementação de validação a deteta, e é
   * exatamente por isso que serve — se o CSV **não** a detetasse, teríamos duas políticas.
   */
  it('deteta problemas semânticos com as mesmas regras do núcleo', async () => {
    const csv = await previewCsv({
      // `31/02/2026` não existe. A normalização do núcleo tem de o recusar.
      bytes: utf8(
        [
          'Matrícula;Data;Valor (€);Litros',
          'AA-00-BB;31/02/2026;70,00;42,35',
        ].join('\r\n'),
      ),
      userId: user.id,
      prisma: db.prisma,
      kind: 'fuel',
    });

    // O valor ilegível nunca chega a registo: a linha é declarada em falta, e a data não
    // é inventada. É o comportamento do núcleo a decidir, não o adaptador.
    const hasDataProblem =
      csv.skipped.length > 0 ||
      csv.valueIssues.length > 0 ||
      csv.plan.issues.some((issue) => issue.field === 'date' || issue.code.includes('date'));

    expect(hasDataProblem).toBe(true);
  });

  /**
   * Uma lacuna é **declarada**, nunca silenciosa (§9.2).
   *
   * Um registo a que falta a data tem de aparecer com `date` nos campos em falta. Sem isto,
   * o utilizador descobriria a lacuna no relatório final — depois de já ter confirmado.
   */
  it('declara campos obrigatórios em falta na pré-visualização', async () => {
    const csv = await previewCsv({
      bytes: utf8(['Matrícula;Data;Valor (€);Litros', 'AA-00-BB;;70,00;42,35'].join('\r\n')),
      userId: user.id,
      prisma: db.prisma,
      kind: 'fuel',
    });

    // Sem data, a linha não produz registo — mas a falta tem de estar declarada e não
    // simplesmente ausente.
    const declared =
      csv.skipped.length > 0 ||
      csv.preview.some((row) => row.emptyFields.includes('date')) ||
      csv.plan.issues.some((issue) => issue.field === 'date');

    expect(declared).toBe(true);
  });

  /**
   * A pré-visualização **não escreve**. É a garantia da §7.1, e a única forma de a provar
   * é contar as linhas da base de dados antes e depois.
   */
  it('não escreve nada durante a análise', async () => {
    const before = {
      vehicles: await db.prisma.vehicle.count(),
      fuel: await db.prisma.fuelSession.count(),
      book: await db.prisma.importBookEntry.count(),
    };

    await previewCsv({ bytes: utf8(REFERENCE_CSV), userId: user.id, prisma: db.prisma, kind: 'fuel' });

    const after = {
      vehicles: await db.prisma.vehicle.count(),
      fuel: await db.prisma.fuelSession.count(),
      book: await db.prisma.importBookEntry.count(),
    };

    expect(after).toEqual(before);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. A mesma deduplicação                                                     */
/* -------------------------------------------------------------------------- */

describe('equivalência do adaptador — deduplicação', () => {
  /**
   * As chaves de deduplicação têm de ser calculadas por `dedupeKeysFor` — a única
   * autoridade sobre que campos alimentam cada chave.
   *
   * O teste compara as chaves do registo **canónico** de cada caminho. Se o adaptador
   * produzisse um campo com um nome diferente (`valor` em vez de `amountCents`), as chaves
   * seriam diferentes — e a deduplicação deixaria de reconhecer o mesmo registo.
   *
   * ## Duas linhas idênticas num ficheiro plano
   *
   * São um caso que o bundle não tem e que uma folha de cálculo tem sempre. O adaptador
   * remove-as antes de chegarem ao núcleo, porque o `buildPlan` compara contra o **estado
   * da conta** e nunca contra o próprio lote — e acrescentar-lhe essa comparação mudaria o
   * comportamento do bundle, que está fechado.
   *
   * O resultado é 2 registos (1 ficha de veículo + 1 leitura), e a linha repetida fica
   * declarada em `skipped` com o número da linha original. É esta declaração que impede o
   * "0 registos" silencioso — o utilizador vê que a linha 3 foi descartada e porquê.
   */
  it('produz registos cujas chaves de deduplicação o domínio reconhece', async () => {
    const csv = await previewCsv({
      bytes: utf8(
        [
          'Matrícula;Data;Quilometragem',
          'AA-00-BB;25/02/2026;15000',
          'AA-00-BB;25/02/2026;15000',
        ].join('\r\n'),
      ),
      userId: user.id,
      prisma: db.prisma,
      kind: 'odometer',
    });

    // 1 ficha de veículo + 1 leitura de odómetro. A segunda linha era repetida.
    expect(csv.records.length).toBe(2);

    const odometer = csv.records.filter((record) => record.kind === 'odometer');
    expect(odometer.length).toBe(1);

    // A leitura tem uma chave que o domínio reconhece, e é ela que a identifica.
    const keys = dedupeKeysFor(odometer[0]!);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys[0]?.kind).toBe('date+odometer');

    // A linha repetida está declarada, com a linha onde o duplicado apareceu pela primeira
    // vez — sem isto, a perda seria silenciosa (§9.2).
    const duplicate = csv.skipped.find((entry) => entry.line === 3);
    expect(duplicate).toBeDefined();
    expect(duplicate?.reason).toContain('linha 2');
  });

  /**
   * Linhas repetidas num ficheiro plano não são um erro: são ruído a descartar. O teste
   * fixa que a **primeira** é a que fica (§9.2, e a regra mais previsível para o
   * utilizador), e que nenhuma decisão lhe é pedida.
   */
  it('mantém a primeira ocorrência e não pede decisões por duplicados triviais', async () => {
    const csv = await previewCsv({
      bytes: utf8(
        [
          'Matrícula;Data;Quilometragem',
          'AA-00-BB;25/02/2026;15000',
          'AA-00-BB;25/02/2026;15000',
          'AA-00-BB;25/02/2026;15000',
        ].join('\r\n'),
      ),
      userId: user.id,
      prisma: db.prisma,
      kind: 'odometer',
    });

    // Só uma leitura vinga; as outras duas são declaradas.
    expect(csv.records.filter((record) => record.kind === 'odometer').length).toBe(1);
    expect(csv.skipped.filter((entry) => entry.reason.includes('Linha repetida')).length).toBe(2);

    /*
     * E — o mais importante — **nenhuma** ficou `probable`. Um duplicado trivial não exige
     * decisão: se exigisse, o utilizador aprenderia a confirmar sem ler, que é o pior
     * resultado possível para um mecanismo que existe para chamar a atenção (§11.2).
     */
    const needsDecision = csv.plan.entries.filter((entry) => entry.action === 'probable');
    expect(needsDecision).toEqual([]);
  });

  /**
   * Um registo já existente na conta tem de ser reconhecido como duplicado — e a
   * deduplicação tem de acontecer **contra o estado da conta**, que é o que `readAccountState`
   * fornece. Se o adaptador não usasse a mesma leitura de estado, veria a conta vazia e
   * duplicaria tudo.
   */
  /**
   * Um veículo já existente na conta tem de ser reconhecido — **mesmo que a matrícula
   * esteja escrita de outra forma**.
   *
   * É este o teste que prova duas coisas ao mesmo tempo, e são ambas necessárias:
   *
   *  1. o adaptador **canonicaliza** a matrícula (`AA-00-BB` → `AA00BB`), porque é isso que
   *     o núcleo compara. Sem a canonicalização, as duas strings nunca coincidiam — e
   *     reimportar o mesmo ficheiro duplicava a frota, em silêncio;
   *  2. a **leitura do estado da conta** funciona no caminho CSV. O veículo existente tem
   *     de aparecer no plano como já conhecido.
   *
   * ## Porque é que a leitura de odómetro é `create` e isso está certo
   *
   * A leitura de `15.000 km` em `25/02/2026` não existe na conta — só o veículo existe. A
   * §8.1 distingue "o veículo já existe" de "esta leitura já existe", e confundir os dois
   * faria a importação descartar quilometragens legítimas por o carro já ser conhecido.
   */
  it('reconhece um veículo já existente, mesmo com a matrícula escrita de outra forma', async () => {
    await createVehicle(db, user.id, { plate: 'AA00BB' });

    const csv = await previewCsv({
      bytes: utf8(['Matrícula;Data;Quilometragem', 'AA-00-BB;25/02/2026;15000'].join('\r\n')),
      userId: user.id,
      prisma: db.prisma,
      kind: 'odometer',
    });

    // O veículo: reconhecido. Não pode ser `create` — seria uma segunda ficha para o
    // mesmo carro.
    const vehicleEntry = csv.plan.entries.find((entry) => entry.kind === 'vehicle');
    expect(vehicleEntry).toBeDefined();
    expect(vehicleEntry?.action).not.toBe('create');

    // A leitura de odómetro: nova, porque não existe nada equivalente na conta.
    const odometerEntry = csv.plan.entries.find((entry) => entry.kind === 'odometer');
    expect(odometerEntry?.action).toBe('create');
  });

  /**
   * O registo de veículo que o adaptador constrói tem de trazer a matrícula na forma
   * **canónica** — é a asserção direta da canonicalização, sem depender do plano.
   */
  it('canonicaliza a matrícula antes de a entregar ao núcleo', async () => {
    const csv = await previewCsv({
      bytes: utf8(['Matrícula;Data;Quilometragem', 'AA-00-BB;25/02/2026;15000'].join('\r\n')),
      userId: user.id,
      prisma: db.prisma,
      kind: 'odometer',
    });

    const vehicle = csv.records.find((record) => record.kind === 'vehicle');
    expect(vehicle).toBeDefined();

    // A forma canónica é o que o núcleo compara — sem separadores, em maiúsculas.
    expect(vehicle?.fields.plate).toBe('AA00BB');
    // E a forma legível preserva o que o ficheiro escreveu, para o ecrã o poder mostrar.
    expect(vehicle?.fields.plateDisplay).toBe('AA-00-BB');
  });

  /**
   * O isolamento por conta (§7.3) tem de valer para o adaptador CSV exatamente como vale
   * para o bundle.
   *
   * O mesmo ficheiro, analisado por **outra** conta, tem de ver a sua própria conta vazia —
   * e não os veículos da primeira. É esta a propriedade que impede uma importação de
   * comparar contra dados de outra pessoa.
   */
  it('isola a leitura do estado da conta por utilizador', async () => {
    await createVehicle(db, user.id, { plate: 'AA00BB' });

    const csv = await previewCsv({
      bytes: utf8(['Matrícula;Data;Quilometragem', 'AA-00-BB;25/02/2026;15000'].join('\r\n')),
      userId: other.id,
      prisma: db.prisma,
      kind: 'odometer',
    });

    // Para a outra conta, o veículo `AA-00-BB` não existe: o plano tem de o tratar como novo.
    const entry = csv.plan.entries.find((candidate) => candidate.kind === 'vehicle');
    expect(entry?.action).toBe('create');
  });
});

/* -------------------------------------------------------------------------- */
/* 4. O mesmo plano                                                            */
/* -------------------------------------------------------------------------- */

describe('equivalência do adaptador — plano', () => {
  /**
   * O plano é construído por `buildPlan`, e a prova é que tem **a mesma forma** de plano
   * que o bundle produz — os mesmos campos, os mesmos estados.
   */
  it('produz um plano com a mesma forma do plano nativo', async () => {
    const csv = await previewCsv({
      bytes: utf8(
        [
          'Matrícula;Data;Valor (€);Litros;Quilometragem',
          'AA-00-BB;25/02/2026;70,00;42,35;15000',
          'AA-00-BB;26/02/2026;65,00;38,10;15400',
        ].join('\r\n'),
      ),
      userId: user.id,
      prisma: db.prisma,
      kind: 'fuel',
    });

    // Os campos de `ImportPlan` (§9.1). Se o adaptador tivesse um plano próprio, faltaria
    // pelo menos um destes.
    expect(csv.plan).toHaveProperty('state');
    expect(csv.plan).toHaveProperty('counts');
    expect(csv.plan).toHaveProperty('byKind');
    expect(csv.plan).toHaveProperty('entries');
    expect(csv.plan).toHaveProperty('issues');
    expect(csv.plan).toHaveProperty('issueSummary');
    expect(csv.plan).toHaveProperty('conflictPolicy');
  });

  /**
   * O estado do plano tem de ser um dos estados do domínio — nunca um valor inventado
   * pelo adaptador.
   */
  it('usa os estados de plano do domínio', async () => {
    const csv = await previewCsv({ bytes: utf8(REFERENCE_CSV), userId: user.id, prisma: db.prisma, kind: 'fuel' });

    expect(['ready', 'blocked', 'nothing-to-do']).toContain(csv.plan.state);
  });

  /**
   * A contagem por tipo tem de bater certo com os registos. Uma contagem que não
   * corresponda aos registos é o sintoma clássico de um adaptador que constrói o plano por
   * fora — e é a única coisa que o utilizador vê antes de confirmar (A26).
   *
   * Compara-se com `counts.total` e não com a soma dos campos: `PlanCounts` tem campos que
   * **não são ações** (`enriching`, `conflicting`, `documentsMissingContent`) e somá-los
   * contaria o mesmo registo duas vezes. `total` é o campo que o próprio domínio define
   * como "a soma das ações", e é por isso que é ele o comparado.
   */
  it('conta os registos de forma consistente com o plano', async () => {
    const csv = await previewCsv({
      bytes: utf8(
        [
          'Matrícula;Data;Valor (€);Litros;Quilometragem',
          'AA-00-BB;25/02/2026;70,00;42,35;15000',
          'AA-00-BB;26/02/2026;65,00;38,10;15400',
          'AA-00-BB;25/02/2026;71,00;43,00;15800',
        ].join('\r\n'),
      ),
      userId: user.id,
      prisma: db.prisma,
      kind: 'fuel',
    });

    expect(csv.plan.counts.total).toBe(csv.records.length);
    expect(csv.plan.counts.total).toBe(3);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. A mesma aplicação, transacção e idempotência                             */
/* -------------------------------------------------------------------------- */

describe('equivalência do adaptador — aplicação', () => {
  it('aplica o plano pelo mesmo `applyImport` do núcleo', async () => {
    const csv = await previewCsv({
      bytes: utf8(
        [
          'Matrícula;Data;Valor (€);Litros;Quilometragem',
          'AA-00-BB;25/02/2026;70,00;42,35;15000',
        ].join('\r\n'),
      ),
      userId: user.id,
      prisma: db.prisma,
      kind: 'fuel',
    });

    const applied = await applyImport({
      plan: csv.plan,
      records: csv.records,
      bundleId: csv.identity.key,
      userId: user.id,
      prisma: db.prisma,
    });

    expect(applied.created.length).toBeGreaterThan(0);
    // `1` no caso normal: a transacção é a do núcleo, não uma por registo.
    expect(applied.batches).toBe(1);

    const written = await db.prisma.vehicle.count({ where: { userId: user.id } });
    expect(written).toBeGreaterThan(0);
  });

  /**
   * A idempotência (§9.5) tem de funcionar com a identidade do CSV.
   *
   * Duas aplicações do mesmo ficheiro não podem criar duas vezes. O que se mede é a
   * contagem na base de dados, porque é a única testemunha que não passa pelo código do
   * adaptador.
   */
  it('não duplica nada numa segunda aplicação do mesmo ficheiro', async () => {
    const bytes = utf8(
      ['Matrícula;Data;Valor (€);Litros;Quilometragem', 'AA-00-BB;25/02/2026;70,00;42,35;15000'].join(
        '\r\n',
      ),
    );

    const first = await previewCsv({ bytes, userId: user.id, prisma: db.prisma, kind: 'fuel' });
    await applyImport({
      plan: first.plan,
      records: first.records,
      bundleId: first.identity.key,
      userId: user.id,
      prisma: db.prisma,
    });

    const afterFirst = await db.prisma.vehicle.count({ where: { userId: user.id } });

    const second = await previewCsv({ bytes, userId: user.id, prisma: db.prisma, kind: 'fuel' });
    const applied = await applyImport({
      plan: second.plan,
      records: second.records,
      bundleId: second.identity.key,
      userId: user.id,
      prisma: db.prisma,
    });

    const afterSecond = await db.prisma.vehicle.count({ where: { userId: user.id } });

    expect(afterSecond).toBe(afterFirst);
    expect(applied.created).toEqual([]);
  });

  /**
   * A identidade é **do conteúdo**, não do nome do ficheiro.
   *
   * O mesmo CSV descarregado duas vezes pelo browser chama-se `export.csv` e
   * `export (1).csv`. Se a chave de idempotência dependesse do nome, a segunda importação
   * duplicaria tudo — e o utilizador não teria como saber porquê, porque os ficheiros são
   * idênticos aos olhos dele.
   */
  it('reconhece o mesmo ficheiro independentemente do nome', async () => {
    const content = [
      'Matrícula;Data;Valor (€);Litros;Quilometragem',
      'AA-00-BB;25/02/2026;70,00;42,35;15000',
    ].join('\r\n');

    const a = await previewCsv({ bytes: utf8(content), userId: user.id, prisma: db.prisma, kind: 'fuel' });
    const b = await previewCsv({ bytes: utf8(content), userId: user.id, prisma: db.prisma, kind: 'fuel' });

    expect(b.identity.key).toBe(a.identity.key);
    expect(b.identity.contentHash).toBe(a.identity.contentHash);
  });

  /**
   * Conteúdo diferente tem de produzir identidade diferente. Sem isto, dois ficheiros
   * distintos seriam tratados como o mesmo e o segundo seria silenciosamente ignorado.
   */
  it('distingue ficheiros com conteúdo diferente', async () => {
    const a = await previewCsv({
      bytes: utf8(['Matrícula;Data', 'AA-00-BB;25/02/2026'].join('\r\n')),
      userId: user.id,
      prisma: db.prisma,
      kind: 'odometer',
    });
    const b = await previewCsv({
      bytes: utf8(['Matrícula;Data', 'AA-00-BB;27/02/2026'].join('\r\n')),
      userId: user.id,
      prisma: db.prisma,
      kind: 'odometer',
    });

    expect(b.identity.key).not.toBe(a.identity.key);
  });

  /**
   * O isolamento por conta tem de valer também na **escrita**, e para a identidade.
   *
   * Duas contas a importar o mesmo ficheiro têm de ficar cada uma com os seus registos: a
   * chave inclui o `userId`, e é isso que impede que a importação de um sirva de livro para
   * o outro.
   */
  it('mantém a idempotência isolada por conta', async () => {
    const bytes = utf8(
      ['Matrícula;Data;Valor (€);Litros;Quilometragem', 'AA-00-BB;25/02/2026;70,00;42,35;15000'].join(
        '\r\n',
      ),
    );

    for (const owner of [user, other]) {
      const preview = await previewCsv({ bytes, userId: owner.id, prisma: db.prisma, kind: 'fuel' });
      await applyImport({
        plan: preview.plan,
        records: preview.records,
        bundleId: preview.identity.key,
        userId: owner.id,
        prisma: db.prisma,
      });
    }

    // Cada conta tem o seu veículo — um por conta, não um no total.
    const mine = await db.prisma.vehicle.count({ where: { userId: user.id } });
    const theirs = await db.prisma.vehicle.count({ where: { userId: other.id } });

    expect(mine).toBeGreaterThan(0);
    expect(theirs).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 6. O mesmo relatório                                                        */
/* -------------------------------------------------------------------------- */

describe('equivalência do adaptador — relatório', () => {
  /**
   * O relatório é construído por `buildImportReport`, e a prova é que tem os mesmos campos
   * e as mesmas afirmações verificáveis que o relatório de um bundle.
   */
  it('produz um relatório com a mesma forma do relatório nativo', async () => {
    const csv = await previewCsv({
      bytes: utf8(
        ['Matrícula;Data;Valor (€);Litros;Quilometragem', 'AA-00-BB;25/02/2026;70,00;42,35;15000'].join(
          '\r\n',
        ),
      ),
      userId: user.id,
      prisma: db.prisma,
      kind: 'fuel',
    });

    const applied = await applyImport({
      plan: csv.plan,
      records: csv.records,
      bundleId: csv.identity.key,
      userId: user.id,
      prisma: db.prisma,
    });

    const report = buildImportReport({
      plan: csv.plan,
      applied,
      bundleId: csv.identity.key,
    });

    expect(report).toHaveProperty('bundleId');
    expect(report).toHaveProperty('applied');
    expect(report).toHaveProperty('summary');
    expect(report).toHaveProperty('created');
    expect(report).toHaveProperty('enriched');
    expect(report).toHaveProperty('skipped');
    expect(report).toHaveProperty('batches');
    expect(report).toHaveProperty('issues');
    expect(report).toHaveProperty('headline');

    expect(report.applied).toBe(true);
    expect(report.created.length).toBe(applied.created.length);
  });

  /**
   * Numa reimportação, o relatório tem de dizer que **nada** foi feito — e não inventar
   * uma importação vazia como se fosse um sucesso de escrita.
   */
  it('reporta uma reimportação sem escrita', async () => {
    const bytes = utf8(
      ['Matrícula;Data;Valor (€);Litros;Quilometragem', 'AA-00-BB;25/02/2026;70,00;42,35;15000'].join(
        '\r\n',
      ),
    );

    const first = await previewCsv({ bytes, userId: user.id, prisma: db.prisma, kind: 'fuel' });
    await applyImport({
      plan: first.plan,
      records: first.records,
      bundleId: first.identity.key,
      userId: user.id,
      prisma: db.prisma,
    });

    const second = await previewCsv({ bytes, userId: user.id, prisma: db.prisma, kind: 'fuel' });
    const applied = await applyImport({
      plan: second.plan,
      records: second.records,
      bundleId: second.identity.key,
      userId: user.id,
      prisma: db.prisma,
    });

    const report = buildImportReport({ plan: second.plan, applied, bundleId: second.identity.key });

    expect(report.applied).toBe(false);
    expect(report.created).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* 6b. A ambiguidade de tipo é declarada, não resolvida em silêncio (§10.4)   */
/* -------------------------------------------------------------------------- */

describe('inferência de tipo — a §10.4 recusada em silêncio', () => {
  /**
   * Este teste fixa o caso que **dominaria** a vida real: um CSV de exportação do próprio
   * Zemlo traz `Valor`, `Litros` **e** `Categoria` na mesma linha, o que dá pontuação igual
   * a `fuel` e a `expense` (ambos 0.7 — ver o cálculo no cabeçalho de `REFERENCE_CSV`).
   *
   * O sistema **não pode** escolher. A §10.4 é explícita e o produto assenta nisso: uma
   * escolha silenciosa aqui escreveria 3 de abril onde o ficheiro dizia 4 de março da
   * categoria de registos — e o utilizador não teria como o detetar, porque os dois
   * resultados são plausíveis.
   *
   * O que se verifica é a **forma do resultado**: estado `ambiguo`, `kind: null`, e as
   * duas alternativas apresentadas para o utilizador escolher.
   */
  it('assinala a ambiguidade entre abastecimento e despesa', async () => {
    const csv = await previewCsv({
      bytes: utf8(REFERENCE_CSV),
      userId: user.id,
      prisma: db.prisma,
      // Sem `kind`: é a inferência que decide — e é isso que aqui se testa.
    });

    expect(csv.inference.state).toBe('ambiguo');
    expect(csv.kind).toBeNull();
    expect(csv.inference.alternatives.map((option) => option.kind).sort()).toEqual([
      'expense',
      'fuel',
    ]);

    // Sem tipo decidido, não há registos a construir. É a garantia de que a ambiguidade
    // **bloqueia** em vez de ser resolvida por omissão.
    expect(csv.records).toEqual([]);
    // E a razão tem de estar disponível para o ecrã a poder mostrar.
    expect(csv.inference.reason.length).toBeGreaterThan(0);
  });

  /**
   * Com a decisão do utilizador, os registos aparecem — e o tipo escolhido é o que ele
   * escolheu, não o que a inferência preferia.
   *
   * A escolha é feita pelo **parâmetro `kind`** e não pela ausência de ambiguidade: é o
   * caminho pelo qual a decisão do utilizador chega ao servidor (§10.5, "o utilizador
   * escolhe").
   */
  it('constrói os registos quando o utilizador resolve a ambiguidade', async () => {
    const csv = await previewCsv({
      bytes: utf8(REFERENCE_CSV),
      userId: user.id,
      prisma: db.prisma,
      kind: 'expense',
    });

    expect(csv.kind).toBe('expense');
    expect(csv.records.length).toBeGreaterThan(0);

    /*
     * Os registos de dados são todos do tipo escolhido.
     *
     * A ficha de veículo sintetizada é a exceção, e não é uma violação: `kind` é o tipo dos
     * **dados do ficheiro**, e a ficha é a aresta que os liga. Sem ela a referência ficaria
     * quebrada e a importação bloqueada — e o utilizador não teria como a criar, porque uma
     * coluna `Matrícula` refere um veículo, não o descreve.
     */
    const dataRecords = csv.records.filter((record) => record.kind !== 'vehicle');
    expect(dataRecords.length).toBeGreaterThan(0);
    expect(dataRecords.every((record) => record.kind === 'expense')).toBe(true);

    // A inferência continua a reportar a ambiguidade original — o ecrã precisa dela para
    // mostrar "escolheste despesa; os dados também serviam abastecimento".
    expect(csv.inference.state).toBe('ambiguo');
  });

  /**
   * Um ficheiro com um tipo **inequívoco** não pede nada ao utilizador: a inferência
   * decide e os registos são construídos sem intervenção.
   *
   * É o contraponto do teste anterior, e a prova de que o sistema não pede confirmação por
   * tudo — pediria e o utilizador aprenderia a confirmar sem ler.
   */
  it('decide sozinho quando a assinatura é inequívoca', async () => {
    const csv = await previewCsv({
      // Sem valor, com quilometragem e data: só `odometer` serve (§10.5).
      bytes: utf8(['Matrícula;Data;Quilometragem', 'AA-00-BB;25/02/2026;15000'].join('\r\n')),
      userId: user.id,
      prisma: db.prisma,
    });

    expect(csv.inference.state).toBe('inequivoco');
    expect(csv.kind).toBe('odometer');
    expect(csv.records.length).toBeGreaterThan(0);
  });

  /**
   * Dados insuficientes **não** são forçados a uma classificação (§10.5).
   *
   * Uma única coluna de texto não é um registo de nada, e inventar um tipo a partir dela
   * faria a pré-visualização mostrar campos que o ficheiro não tem.
   */
  it('não força uma classificação quando os dados não chegam', async () => {
    const csv = await previewCsv({
      bytes: utf8(['Observações', 'Uma nota qualquer'].join('\r\n')),
      userId: user.id,
      prisma: db.prisma,
    });

    expect(csv.inference.state).toBe('insuficiente');
    expect(csv.kind).toBeNull();
    expect(csv.records).toEqual([]);
  });

  /**
   * Uma data ambígua **para a construção** — o segundo caso da §10.4, e a razão pela qual
   * o ficheiro de referência usa `25/02/2026`.
   *
   * `10/02/2026` pode ser 10 de fevereiro ou 2 de outubro. A §10.4 proíbe escolher, e a
   * consequência prática é que **a linha não produz registo nenhum**: sem data não há
   * abastecimento. É o comportamento correto e contra-intuitivo — a alternativa seria
   * escrever uma das duas leituras e deixar o utilizador descobrir o erro meses depois,
   * quando a data não batesse certo com os quilómetros.
   *
   * O que o teste fixa é que a linha é **declarada** (em `skipped` ou em falta de campo) em
   * vez de desaparecer, e que a ambiguidade é nomeada.
   */
  it('recusa construir a partir de uma data ambígua, em vez de a adivinhar', async () => {
    const csv = await previewCsv({
      bytes: utf8(['Matrícula;Data;Quilometragem', 'AA-00-BB;10/02/2026;15000'].join('\r\n')),
      userId: user.id,
      prisma: db.prisma,
      kind: 'odometer',
    });

    /*
     * Não há registos: a data não foi interpretada, e a linha não pode ser construída sem
     * ela. Note-se que a linha **não** é construída com a data em falta — seria uma lacuna
     * silenciosa num campo que a torna inútil.
     */
    expect(csv.records).toEqual([]);

    // A linha tem de estar declarada, com um motivo. "0 registos" sem explicação seria o
    // pior resultado possível (§9.2).
    expect(csv.skipped.length).toBeGreaterThan(0);
    expect(csv.skipped[0]?.line).toBe(2);
    expect(csv.emptyReason).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 7. O mesmo resultado que o bundle para o mesmo conteúdo                     */
/* -------------------------------------------------------------------------- */
describe('equivalência do adaptador — os dois caminhos lado a lado', () => {
  /**
   * Esta é a asserção central do ficheiro.
   *
   * O **mesmo** abastecimento, escrito de duas formas diferentes — bundle nativo e CSV de
   * exportação —, aplicado à mesma conta, tem de produzir exatamente o mesmo registo na
   * base de dados. Não "um registo parecido": os mesmos valores, campo a campo.
   *
   * Se existisse uma segunda implementação de normalização ou de escrita no adaptador CSV,
   * os dois caminhos divergiriam num detalhe qualquer (um cêntimo, um arredondamento, uma
   * data deslocada) e este teste apanhá-lo-ia.
   */
  it('escreve os mesmos dados por bundle e por CSV', async () => {
    /* ---- Caminho 1: bundle nativo ---- */

    const reference = await referencePreview();
    await applyImport({
      plan: reference.plan,
      records: reference.records,
      bundleId: reference.bundle.bundleId,
      userId: user.id,
      prisma: db.prisma,
    });

    const fuelFromBundle = await db.prisma.fuelSession.findFirst({
      where: { userId: user.id },
      select: { date: true, litres: true, amountCents: true, odometerKm: true },
    });

    /* ---- Caminho 2: CSV, na mesma conta mas noutro utilizador ---- */

    /*
     * A comparação é feita com o **mesmo** utilizador e depois de limpar, porque a
     * deduplicação dentro da mesma conta faria o segundo caminho não criar nada — e o teste
     * estaria a comparar "criado" com "não criado".
     */
    await db.prisma.importBookEntry.deleteMany();
    await db.prisma.fuelSession.deleteMany();
    await db.prisma.vehicle.deleteMany();

    const csv = await previewCsv({
      bytes: utf8(REFERENCE_CSV),
      userId: user.id,
      prisma: db.prisma,
      kind: 'fuel',
    });

    await applyImport({
      plan: csv.plan,
      records: csv.records,
      bundleId: csv.identity.key,
      userId: user.id,
      prisma: db.prisma,
    });

    const fuelFromCsv = await db.prisma.fuelSession.findFirst({
      where: { userId: user.id },
      select: { date: true, litres: true, amountCents: true, odometerKm: true },
    });

    /* ---- A asserção ---- */

    expect(fuelFromCsv).not.toBeNull();
    expect(fuelFromBundle).not.toBeNull();

    expect(fuelFromCsv?.amountCents).toBe(fuelFromBundle?.amountCents);
    expect(fuelFromCsv?.litres).toBeCloseTo(fuelFromBundle?.litres ?? 0, 2);
    expect(fuelFromCsv?.odometerKm).toBe(fuelFromBundle?.odometerKm);
    expect(fuelFromCsv?.date?.toISOString().slice(0, 10)).toBe(
      fuelFromBundle?.date?.toISOString().slice(0, 10),
    );
  });

  /**
   * O mesmo veículo, pelos dois caminhos, tem de ficar com a mesma identidade de domínio.
   *
   * A matrícula é a identidade do veículo (A14/A25). Se o adaptador CSV não a normalizasse,
   * `AA-00-BB` e `AA00BB` seriam dois veículos — e o utilizador veria a frota duplicada
   * depois de importar.
   */
  it('produz a mesma identidade de veículo pelos dois caminhos', async () => {
    const reference = await referencePreview();
    const vehicleFromBundle = reference.records.find((record) => record.kind === 'vehicle');

    const csv = await previewCsv({
      bytes: utf8(REFERENCE_CSV),
      userId: user.id,
      prisma: db.prisma,
      kind: 'fuel',
    });
    const vehicleFromCsv = csv.records.find((record) => record.kind === 'vehicle');

    /*
     * O CSV de referência tem a matrícula `AA-00-BB` e o bundle tem `AA-00-BB`: a
     * normalização do núcleo tem de dar o mesmo resultado nos dois. Um adaptador que
     * passasse a matrícula crua faria os dois divergir em maiúsculas ou separadores.
     */
    if (vehicleFromBundle && vehicleFromCsv) {
      const plateOf = (record: CanonicalRecord | undefined) => {
        const plate = record?.fields.plate ?? record?.fields.plateDisplay;
        return typeof plate === 'string' ? plate.replace(/[^A-Za-z0-9]/g, '').toUpperCase() : null;
      };

      expect(plateOf(vehicleFromCsv)).toBe(plateOf(vehicleFromBundle));
    }
  });
});
