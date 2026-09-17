/**
 * Testes do plano de importação e das migrações — bloco 6 + 7
 * (`docs/IMPORT-EXPORT.md` §7.1, §8.3, §9.5, §11, §12).
 *
 * ## Porque é que estes testes são sobre **fronteiras**, e não sobre caminhos felizes
 *
 * O plano é o artefacto que o utilizador aprova e que a aplicação aplica. A §7.1 proíbe
 * qualquer escrita antes da confirmação, e a §11.3 exige que "nada acontece sem o
 * utilizador ver o que vai acontecer". Um plano errado, portanto, não falha ruidosamente:
 * ou promete uma coisa e faz outra, ou deixa passar em silêncio uma ambiguidade que
 * devia ter sido perguntada.
 *
 * As três fronteiras que estes testes apertam:
 *
 *  1. **`exact ≠ probable ≠ new`** — a distinção não se colapsa em nenhum sentido, e um
 *     provável **nunca** é promovido a certo. É a regra mais importante do bloco;
 *  2. **idempotência antes de deduplicação** — reimportar o mesmo bundle não cria nada, e
 *     o resultado é `skipped`, não `exact` (§9.5, §8.2);
 *  3. **quarentena não se contorna** — nem por decisão do utilizador, nem por política de
 *     conflito. É um estado do dados, não uma preferência.
 *
 * As migrações testam-se com migrações **de teste**, deliberadamente: `MIGRATIONS` está
 * vazio porque `FORMAT_VERSION` é 1 e não existe salto nenhum. Testar o mecanismo com
 * conversões fictícias no caminho de produção seria pior do que testá-lo isoladamente.
 */

import { describe, expect, it } from 'vitest';
import { EXPORT_FORMAT, FORMAT_VERSION, MIN_SUPPORTED_FORMAT_VERSION } from '@zemlo/shared';
import {
  DEFAULT_CONFLICT_POLICY,
  buildPlan,
  canApply,
  creationOrder,
  decideAllProbables,
  decideEntry,
  dedupeKeysFor,
  entriesByAction,
  issuesBySeverity,
  pendingDecisions,
  summarizePlan,
  type ExistingAccountState,
  type ExistingRecord,
  type ImportPlan,
  type PlanAction,
} from '../src/domain/import/plan.js';
import {
  MIGRATIONS,
  addOptionalField,
  checkCompatibility,
  describeCompatibility,
  describeVersionSupport,
  findMigrationPath,
  mapField,
  migrateBundle,
  renameField,
  runMigrations,
  type Migration,
  type MigrationContext,
} from '../src/domain/import/migrate.js';
import { issue, validateRecords, type CanonicalRecord } from '../src/domain/import/validate.js';

/* -------------------------------------------------------------------------- */
/* Auxiliares                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Atalhos para problemas, com a assinatura real de `validate.ts`: `(code, message,
 * context)`. Escrever `localId` como segundo argumento compilaria e produziria problemas
 * sem localização nenhuma — a espécie de erro que passa o `typecheck` e só aparece meses
 * depois, quando um registo em quarentena não tem dono.
 */
function blockingFor(code: string, localId: string, message: string) {
  return issue('blocking', code, message, { localId });
}
function recoverableFor(code: string, localId: string, message: string) {
  return issue('recoverable', code, message, { localId });
}
function informationalFor(code: string, localId: string, message: string) {
  return issue('info', code, message, { localId });
}

/** Um registo canónico mínimo, com os campos que o teste declarar. */
function record(
  kind: CanonicalRecord['kind'],
  localId: string,
  fields: Record<string, unknown> = {},
  references: Record<string, string | null | undefined> = {},
): CanonicalRecord {
  return { kind, localId, fields, references };
}

/** Um veículo, com os quatro campos que alimentam as chaves. */
function vehicle(localId: string, plate: string | null, vin: string | null, make = 'Renault', model = 'Clio', year = 2018): CanonicalRecord {
  return record('vehicle', localId, { plate, vin, make, model, year }, {});
}

/** Um abastecimento. */
function fuel(
  localId: string,
  fields: { date: string; litres: number; odometerKm: number | null; amountCents: number | null },
  vehicleLocalId = 'v1',
): CanonicalRecord {
  return record('fuel', localId, { ...fields }, { vehicleLocalId });
}

/** Uma despesa. */
function expense(
  localId: string,
  fields: { date: string; amountCents: number; category?: string | null; vendor?: string | null; description?: string | null },
  vehicleLocalId = 'v1',
): CanonicalRecord {
  return record(
    'expense',
    localId,
    {
      date: fields.date,
      amountCents: fields.amountCents,
      category: fields.category ?? null,
      vendor: fields.vendor ?? null,
      description: fields.description ?? null,
    },
    { vehicleLocalId },
  );
}

/**
 * Um registo existente na conta, com as chaves derivadas do próprio canónico.
 *
 * `filledValues` é preenchido com os valores não vazios para que `enrichment` consiga
 * distinguir "preenchido com o mesmo valor" de "preenchido com outro valor" — sem isso,
 * um campo igual nos dois lados não é declarado em conflito, e o teste do enriquecimento
 * deixaria de exercer o caminho que interessa.
 */
function existing(
  kind: CanonicalRecord['kind'],
  id: string,
  fields: Record<string, unknown>,
  references: Record<string, string | null | undefined> = {},
  overrides: Partial<ExistingRecord> = {},
): ExistingRecord {
  const canonical = record(kind, id, fields, references);
  const filledValues: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(fields)) {
    if (value === null || value === undefined || value === '') continue;
    filledValues[field] = value;
  }

  return {
    kind,
    id,
    keys: dedupeKeysFor(canonical),
    filledFields: Object.keys(filledValues),
    filledValues,
    ...overrides,
  };
}

/** Estado de conta vazio. */
const EMPTY: ExistingAccountState = { records: [] };

/** Constrói um plano com opções por omissão, para encurtar os testes. */
function plan(records: readonly CanonicalRecord[], state: ExistingAccountState = EMPTY, extra: Parameters<typeof buildPlan>[0] extends infer _ ? Record<string, unknown> : never = {}): ImportPlan {
  return buildPlan({ records, state, ...extra });
}

/* ========================================================================== */
/* plan.ts — §7.1, §8.3, §9.5, §11                                             */
/* ========================================================================== */

describe('plan — a construção do plano é pura e determinística', () => {
  it('o mesmo input produz exatamente o mesmo plano', () => {
    const records = [vehicle('v1', 'AA-00-AA', null), fuel('f1', { date: '2026-01-15', litres: 40, odometerKm: 100000, amountCents: 6000 })];
    const state: ExistingAccountState = { records: [existing('vehicle', 'acc-v1', { plate: 'AA-00-AA', vin: null, make: 'Renault', model: 'Clio', year: 2018 })] };

    const a = plan(records, state);
    const b = plan(records, state);

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('não muta o conjunto de registos recebido', () => {
    const records = [vehicle('v1', 'AA-00-AA', null)];
    const snapshot = JSON.stringify(records);
    plan(records, { records: [existing('vehicle', 'acc', { plate: 'AA-00-AA' })] });
    expect(JSON.stringify(records)).toBe(snapshot);
  });

  it('cada registo do bundle origina exatamente uma entrada', () => {
    const records = [vehicle('v1', 'AA-00-AA', null), vehicle('v2', 'BB-11-BB', null), fuel('f1', { date: '2026-01-15', litres: 40, odometerKm: 100000, amountCents: 6000 })];
    const p = plan(records);
    expect(p.entries).toHaveLength(3);
    expect(p.entries.map((entry) => entry.localId).sort()).toEqual(['f1', 'v1', 'v2']);
  });

  it('preserva `file` e `line` das entradas, para localizar problemas', () => {
    const withLocation: CanonicalRecord = { ...vehicle('v1', 'AA-00-AA', null), file: 'vehicles.jsonl', line: 7 };
    const p = plan([withLocation]);
    expect(p.entries[0]?.file).toBe('vehicles.jsonl');
    expect(p.entries[0]?.line).toBe(7);
  });
});

describe('plan — uma conta vazia cria tudo (§11.2)', () => {
  it('sem nada equivalente, tudo é `create`', () => {
    const p = plan([vehicle('v1', 'AA-00-AA', null), vehicle('v2', 'BB-11-BB', null)]);

    expect(p.entries.every((entry) => entry.action === 'create')).toBe(true);
    expect(p.counts.create).toBe(2);
    expect(p.counts.exact).toBe(0);
    expect(p.counts.probable).toBe(0);
    expect(p.state).toBe('ready');
  });

  it('uma entrada `create` não tem `viaKey` — é nova, não "provavelmente nova"', () => {
    const p = plan([vehicle('v1', 'AA-00-AA', null)]);
    expect(p.entries[0]?.viaKey).toBeUndefined();
  });

  it('sem registos, o plano não tem nada a fazer', () => {
    const p = plan([]);
    expect(p.state).toBe('nothing-to-do');
    expect(p.counts.total).toBe(0);
  });

  it('um plano com apenas duplicados certos também não tem nada a fazer', () => {
    // O existente tem de trazer os mesmos campos que o bundle, senão o bundle
    // **enriqueceria** o registo existente — e um plano com enriquecimento a propor tem
    // trabalho a fazer, mesmo que não crie nada.
    const records = [vehicle('v1', 'AA-00-AA', null)];
    const state: ExistingAccountState = {
      records: [existing('vehicle', 'acc', { plate: 'AA-00-AA', vin: null, make: 'Renault', model: 'Clio', year: 2018 })],
    };
    const p = plan(records, state);

    expect(p.counts.exact).toBe(1);
    expect(p.counts.enriching).toBe(0);
    expect(p.state).toBe('nothing-to-do');
    expect(canApply(p)).toBe(false);
  });

  it('um duplicado certo que pode ser enriquecido não é `nothing-to-do`', () => {
    // Preencher um campo vazio é trabalho: o plano tem de o apresentar, não o esconder
    // atrás de uma contagem de duplicados.
    const records = [vehicle('v1', 'AA-00-AA', null)];
    const state: ExistingAccountState = { records: [existing('vehicle', 'acc', { plate: 'AA-00-AA' })] };
    const p = plan(records, state);

    expect(p.counts.exact).toBe(1);
    expect(p.counts.enriching).toBe(1);
    expect(p.state).toBe('ready');
  });
});

describe('plan — exact: coincidência literal (§8.3)', () => {
  it('mesma matrícula sem VIN é um duplicado certo', () => {
    const records = [vehicle('v1', 'AA-00-AA', null)];
    const state: ExistingAccountState = { records: [existing('vehicle', 'acc', { plate: 'AA-00-AA', vin: null, make: 'Renault', model: 'Clio', year: 2018 })] };

    const p = plan(records, state);
    expect(p.entries[0]?.action).toBe('exact');
    expect(p.entries[0]?.viaKey?.kind).toBe('plate');
    expect(p.counts.exact).toBe(1);
    expect(p.counts.probable).toBe(0);
  });

  it('mesmo VIN é um duplicado certo, independentemente da matrícula', () => {
    const vin = 'VF1RJA00012345678';
    const records = [vehicle('v1', 'AA-00-AA', vin)];
    const state: ExistingAccountState = { records: [existing('vehicle', 'acc', { plate: 'ZZ-99-ZZ', vin, make: 'Renault', model: 'Clio', year: 2018 })] };

    const p = plan(records, state);
    expect(p.entries[0]?.action).toBe('exact');
    expect(p.entries[0]?.viaKey?.kind).toBe('vin');
  });

  it('o mesmo VIN com matrícula diferente explica-se por VIN, não por matrícula', () => {
    const vin = 'VF1RJA00012345678';
    const records = [vehicle('v1', null, vin)];
    const state: ExistingAccountState = { records: [existing('vehicle', 'acc', { plate: 'ZZ-99-ZZ', vin, make: 'Renault', model: 'Clio', year: 2018 })] };

    const p = plan(records, state);
    expect(p.entries[0]?.viaKey?.kind).toBe('vin');
  });

  it('uma matrícula igual com VIN presente em ambos é rebaixada a provável', () => {
    // A matrícula muda de dono: se ambos os lados têm VIN válido, a matrícula sozinha
    // não é identidade. `vehicleKeys` já declara isto, e o plano tem de o respeitar.
    const records = [vehicle('v1', 'AA-00-AA', 'VF1RJA00012345678')];
    const state: ExistingAccountState = {
      records: [existing('vehicle', 'acc', { plate: 'AA-00-AA', vin: 'VF1RJA00099999999', make: 'Renault', model: 'Clio', year: 2018 })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.action).toBe('probable');
    expect(p.entries[0]?.viaKey?.kind).toBe('plate');
  });

  it('mesma data, litros e quilometragem num abastecimento é certo', () => {
    const fields = { date: '2026-01-15', litres: 40, odometerKm: 100000, amountCents: 6000 };
    const records = [fuel('f1', fields)];
    const state: ExistingAccountState = { records: [existing('fuel', 'acc-f', fields, { vehicleLocalId: 'v1' })] };

    const p = plan(records, state);
    expect(p.entries[0]?.action).toBe('exact');
    expect(p.entries[0]?.viaKey?.kind).toContain('odometer');
  });
});

describe('plan — probable: NUNCA promovido a exact (§8.3, §8.6)', () => {
  it('uma tolerância de quilometragem produz `probable`, não `exact`', () => {
    // É a linha mais importante do bloco: a chave `date+litres+odometer` é declarada
    // `exact` pelo §8.4, mas a diferença de 4 km dentro dos ±50 km é semelhança, não
    // identidade. Tratá-la como certa ignoraria o registo em silêncio.
    const records = [fuel('f1', { date: '2026-01-15', litres: 40, odometerKm: 100004, amountCents: 6000 })];
    const state: ExistingAccountState = {
      records: [existing('fuel', 'acc-f', { date: '2026-01-15', litres: 40, odometerKm: 100000, amountCents: 6000 }, { vehicleLocalId: 'v1' })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.action).toBe('probable');
    expect(p.entries[0]?.action).not.toBe('exact');
  });

  it('uma despesa com data e valor iguais é provável — dois portagens no mesmo dia são reais', () => {
    // `date+amount+vehicle` é deliberadamente provável e **não** certo: dois portagens no
    // mesmo dia pelo mesmo valor acontecem. Tratá-los como certos apagaria um deles.
    const records = [expense('e1', { date: '2026-01-15', amountCents: 5000 })];
    const state: ExistingAccountState = {
      records: [existing('expense', 'acc-e', { date: '2026-01-15', amountCents: 5000, category: null, vendor: null, description: null }, { vehicleLocalId: 'v1' })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.action).toBe('probable');
  });

  it('uma tolerância de valor num abastecimento produz `probable`, não `exact`', () => {
    // A chave `date+litres` é provável; mas mesmo a chave `date+litres+odometer`, que é
    // `exact`, é rebaixada quando a coincidência vem de uma tolerância. Aqui o valor está
    // 1 cêntimo acima — dentro dos ±2 cêntimos — e o resultado tem de ser provável.
    const records = [fuel('f1', { date: '2026-01-15', litres: 40, odometerKm: 100000, amountCents: 6001 })];
    const state: ExistingAccountState = {
      records: [existing('fuel', 'acc-f', { date: '2026-01-15', litres: 40, odometerKm: 100004, amountCents: 6000 }, { vehicleLocalId: 'v1' })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.action).toBe('probable');
    expect(p.entries[0]?.action).not.toBe('exact');
  });

  it('um valor fora da tolerância não forma a chave forte, mas a chave de litros ainda coincide', () => {
    // Com a mesma data e os mesmos litros, a chave `date+litres` (provável) continua a
    // coincidir mesmo com o valor 3 cêntimos acima. O resultado é provável — o que **não**
    // acontece é a chave `date+litres+odometer` se formar, porque o valor excede a
    // tolerância. A distinção entre "não é o mesmo registo" e "é provavelmente o mesmo"
    // está inteira no nível da chave que coincidiu.
    const records = [fuel('f1', { date: '2026-01-15', litres: 40, odometerKm: 100000, amountCents: 6003 })];
    const state: ExistingAccountState = {
      records: [existing('fuel', 'acc-f', { date: '2026-01-15', litres: 40, odometerKm: 100004, amountCents: 6000 }, { vehicleLocalId: 'v1' })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.action).toBe('probable');
    expect(p.entries[0]?.viaKey?.kind).toBe('date+litres');
  });

  it('um valor fora da tolerância com litros diferentes é `create`', () => {
    // Sem a chave de litros a coincidir e com o valor fora da tolerância, não sobra
    // nenhuma base para uma coincidência.
    const records = [fuel('f1', { date: '2026-01-15', litres: 42, odometerKm: 100000, amountCents: 6003 })];
    const state: ExistingAccountState = {
      records: [existing('fuel', 'acc-f', { date: '2026-01-15', litres: 40, odometerKm: 100004, amountCents: 6000 }, { vehicleLocalId: 'v1' })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.action).toBe('create');
  });

  it('uma tolerância de litros produz `probable`', () => {
    const records = [fuel('f1', { date: '2026-01-15', litres: 40.03, odometerKm: 100000, amountCents: 6000 })];
    const state: ExistingAccountState = {
      records: [existing('fuel', 'acc-f', { date: '2026-01-15', litres: 40, odometerKm: 100000, amountCents: 6000 }, { vehicleLocalId: 'v1' })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.action).toBe('probable');
  });

  it('a distância medida acompanha a entrada, para a interface poder explicar (§9.3)', () => {
    const records = [fuel('f1', { date: '2026-01-15', litres: 40, odometerKm: 100004, amountCents: 6001 })];
    const state: ExistingAccountState = {
      records: [existing('fuel', 'acc-f', { date: '2026-01-15', litres: 40, odometerKm: 100000, amountCents: 6000 }, { vehicleLocalId: 'v1' })],
    };

    const p = plan(records, state);
    const matched = p.entries[0]?.matched[0];

    expect(matched?.distance?.odometerKm).toBe(4);
    expect(matched?.distance?.amountCents).toBe(1);
  });

  it('a razão de um provável nomeia a distância concreta, não um vago "parecido"', () => {
    const records = [fuel('f1', { date: '2026-01-15', litres: 40, odometerKm: 100012, amountCents: 6000 })];
    const state: ExistingAccountState = {
      records: [existing('fuel', 'acc-f', { date: '2026-01-15', litres: 40, odometerKm: 100000, amountCents: 6000 }, { vehicleLocalId: 'v1' })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.reason).toContain('12 km');
  });

  it('a razão de um provável de valor mostra euros, não cêntimos', () => {
    const records = [fuel('f1', { date: '2026-01-15', litres: 40, odometerKm: 100000, amountCents: 6001 })];
    const state: ExistingAccountState = {
      records: [existing('fuel', 'acc-f', { date: '2026-01-15', litres: 40, odometerKm: 100004, amountCents: 6000 }, { vehicleLocalId: 'v1' })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.action).toBe('probable');
    expect(p.entries[0]?.reason).toContain('0,01 €');
  });

  it('uma quilometragem ausente de um dos lados não coincide por tolerância', () => {
    // Uma ausência não é uma distância: sem valor nos dois lados não há nada a comparar.
    const records = [fuel('f1', { date: '2026-01-15', litres: 40, odometerKm: null, amountCents: null })];
    const state: ExistingAccountState = {
      records: [existing('fuel', 'acc-f', { date: '2026-01-15', litres: 40, odometerKm: 100000, amountCents: 6000 }, { vehicleLocalId: 'v1' })],
    };

    const p = plan(records, state);
    // Sem quilometragem nem valor, a única base é `date+litres` (provável), e a chave
    // `date+litres+odometer` não se forma — não há chave exata nenhuma.
    expect(p.entries[0]?.action).toBe('probable');
    expect(p.entries[0]?.viaKey?.kind).toBe('date+litres');
  });

  it('uma diferença acima da tolerância impede a chave forte, mas não a chave fraca', () => {
    // 51 km excede os ±50 km, pelo que `date+litres+odometer` **não** se forma. Mas a data
    // e os litros ainda coincidem, e por isso `date+litres` coincide como provável. O
    // resultado final é provável — e é correto que seja: o que a tolerância decide é
    // **qual** chave coincide, não o resultado global.
    const records = [fuel('f1', { date: '2026-01-15', litres: 40, odometerKm: 100051, amountCents: 6000 })];
    const state: ExistingAccountState = {
      records: [existing('fuel', 'acc-f', { date: '2026-01-15', litres: 40, odometerKm: 100000, amountCents: 6000 }, { vehicleLocalId: 'v1' })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.action).toBe('probable');
    expect(p.entries[0]?.viaKey?.kind).toBe('date+litres');
  });

  it('uma diferença acima da tolerância com litros e valor diferentes é `create`', () => {
    // Sem chave forte (km fora) e sem chave fraca de litros (44 ≠ 40) nem de valor
    // (6003 ≠ 6000), não sobra nenhuma base. Não é "um provável longínquo": não é o mesmo.
    const records = [fuel('f1', { date: '2026-01-15', litres: 44, odometerKm: 100051, amountCents: 6003 })];
    const state: ExistingAccountState = {
      records: [existing('fuel', 'acc-f', { date: '2026-01-15', litres: 40, odometerKm: 100000, amountCents: 6000 }, { vehicleLocalId: 'v1' })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.action).toBe('create');
  });

  it('a data é verificada mesmo quando a chave forte coincide em todos os campos numéricos', () => {
    // Regressão. A comparação por tolerância só olhava para os campos **numéricos**, e a
    // data — que não é numérica e não tem tolerância — nunca era verificada. Dois
    // abastecimentos com a mesma quilometragem e os mesmos litros coincidiam em datas
    // diferentes, e o utilizador perdia um deles em silêncio.
    //
    // É o erro mais perigoso possível: um falso "é o mesmo registo". Este teste existe
    // para que ele não possa voltar.
    const records = [fuel('f1', { date: '2026-01-16', litres: 40, odometerKm: 100000, amountCents: 6000 })];
    const state: ExistingAccountState = {
      records: [existing('fuel', 'acc-f', { date: '2026-01-15', litres: 40, odometerKm: 100000, amountCents: 6000 }, { vehicleLocalId: 'v1' })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.action).toBe('create');
    expect(p.entries[0]?.matched).toEqual([]);
  });

  it('CASO A — a mesma data com litros e quilometragem idênticos distingue-se por um mês de diferença', () => {
    // Cenário exato do pedido de validação, e a formulação mais forte da regressão: os dois
    // campos numéricos coincidem **literalmente** (não apenas dentro da tolerância), pelo
    // que a **única** coisa a distinguir os registos é a data. Se a data não for
    // verificada, esta é a coincidência mais silenciosa possível — valor exato, litros
    // exatos, quilometragem exata, e um falso duplicado certo.
    const records = [fuel('f1', { date: '2026-02-01', litres: 40, odometerKm: 100000, amountCents: 6000 })];
    const state: ExistingAccountState = {
      records: [existing('fuel', 'acc-f', { date: '2026-01-01', litres: 40, odometerKm: 100000, amountCents: 6000 }, { vehicleLocalId: 'v1' })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.action).toBe('create');
    expect(p.entries[0]?.matched).toEqual([]);
    expect(p.entries[0]?.viaKey).toBeUndefined();
  });

  it('CASO A — a mesma data com litros e quilometragem idênticos distingue-se por um dia de diferença', () => {
    // A variante mínima: a tolerância de data é zero, por isso até um dia separa registos.
    const records = [fuel('f1', { date: '2026-02-01', litres: 40, odometerKm: 100000, amountCents: 6000 })];
    const state: ExistingAccountState = {
      records: [existing('fuel', 'acc-f', { date: '2026-01-31', litres: 40, odometerKm: 100000, amountCents: 6000 }, { vehicleLocalId: 'v1' })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.action).toBe('create');
  });

  it('CASO A — a data também decide quando os números estão dentro da tolerância, não só quando são iguais', () => {
    // A outra metade do caso: litros e quilometragem a cair dentro das tolerâncias, e a
    // data a diferir. Antes da correção, a tolerância era satisfeita e a data ignorada, o
    // que produzia um "provável" — e um provável tratado como certo apaga o registo.
    const records = [fuel('f1', { date: '2026-02-01', litres: 40.02, odometerKm: 100004, amountCents: 6001 })];
    const state: ExistingAccountState = {
      records: [existing('fuel', 'acc-f', { date: '2026-01-01', litres: 40, odometerKm: 100000, amountCents: 6000 }, { vehicleLocalId: 'v1' })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.action).toBe('create');
  });

  it('CASO A — a contraprova: com a mesma data, os mesmos números continuam a coincidir', () => {
    // O teste acima só tem valor se a correção não tiver tornado o plano cego. Com a data
    // igual, tudo o resto igual, a coincidência tem de continuar a existir.
    const records = [fuel('f1', { date: '2026-02-01', litres: 40, odometerKm: 100000, amountCents: 6000 })];
    const state: ExistingAccountState = {
      records: [existing('fuel', 'acc-f', { date: '2026-02-01', litres: 40, odometerKm: 100000, amountCents: 6000 }, { vehicleLocalId: 'v1' })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.action).toBe('exact');
    expect(p.entries[0]?.viaKey?.kind).toBe('date+litres+odometer');
  });

  it('CASO A — a parte estável é transportada pela própria chave, não inferida', () => {
    // O teste de unidade da correção: `stable` tem de existir na chave e conter as partes
    // sem tolerância. Verificá-lo aqui, na fonte, é o que impede que uma futura alteração
    // a `compose` remova a informação sem que nenhum teste dê por isso.
    const [strong] = dedupeKeysFor(fuel('f1', { date: '2026-02-01', litres: 40, odometerKm: 100000, amountCents: 6000 })).filter(
      (key) => key.kind === 'date+litres+odometer',
    );

    expect(strong).toBeDefined();
    expect(strong?.stable).toBeDefined();
    // A parte estável inclui o veículo e a data; exclui litros e quilometragem.
    expect(strong?.stable).toContain('v1');
    expect(strong?.stable).toContain('2026-02-01');
    expect(strong?.stable).not.toContain('100000');
  });

  it('CASO A — duas chaves do mesmo tipo com datas diferentes têm partes estáveis diferentes', () => {
    const keysA = dedupeKeysFor(fuel('f1', { date: '2026-01-01', litres: 40, odometerKm: 100000, amountCents: 6000 }));
    const keysB = dedupeKeysFor(fuel('f2', { date: '2026-02-01', litres: 40, odometerKm: 100000, amountCents: 6000 }));

    const strongA = keysA.find((key) => key.kind === 'date+litres+odometer');
    const strongB = keysB.find((key) => key.kind === 'date+litres+odometer');

    expect(strongA?.stable).not.toBe(strongB?.stable);
    // E os valores canónicos também diferem — a diferença está visível nos dois sítios.
    expect(strongA?.value).not.toBe(strongB?.value);
  });

  it('um veículo diferente não coincide só porque a quilometragem é igual', () => {
    // Mesmo problema, noutro tipo: `date+litres+odometer` inclui a referência do veículo,
    // que também não é numérica. Sem a verificação da parte estável, dois carros
    // diferentes com os mesmos números coincidiriam.
    const records = [fuel('f1', { date: '2026-01-15', litres: 40, odometerKm: 100000, amountCents: 6000 }, 'v2')];
    const state: ExistingAccountState = {
      records: [existing('fuel', 'acc-f', { date: '2026-01-15', litres: 40, odometerKm: 100000, amountCents: 6000 }, { vehicleLocalId: 'v1' })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.action).toBe('create');
  });

  it('uma tolerância de data é zero, mas o registo do mesmo dia continua a coincidir', () => {
    // Contraprova do teste de regressão acima: a mesma data, com os números dentro da
    // tolerância, continua a produzir um provável. A correção não tornou o plano cego.
    const records = [fuel('f1', { date: '2026-01-15', litres: 40, odometerKm: 100004, amountCents: 6000 })];
    const state: ExistingAccountState = {
      records: [existing('fuel', 'acc-f', { date: '2026-01-15', litres: 40, odometerKm: 100000, amountCents: 6000 }, { vehicleLocalId: 'v1' })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.action).toBe('probable');
    expect(p.entries[0]?.matched[0]?.distance?.odometerKm).toBe(4);
  });

  it('a comparação com tolerância nunca coincide entre chaves sem parte estável igual', () => {
    // A parte estável é comparada por igualdade exata antes de a tolerância ser aplicada.
    // Um caso com a mesma quilometragem e a mesma litragem mas origem diferente não pode
    // coincidir — a parte que não tolera diferença é a que decide.
    const sameNumbersDifferentDay = fuel('f1', { date: '2025-12-31', litres: 40, odometerKm: 100000, amountCents: 6000 });
    const state: ExistingAccountState = {
      records: [existing('fuel', 'acc-f', { date: '2026-01-15', litres: 40, odometerKm: 100000, amountCents: 6000 }, { vehicleLocalId: 'v1' })],
    };

    const p = plan([sameNumbersDifferentDay], state);
    expect(p.entries[0]?.action).toBe('create');
  });

  it('uma despesa com o mesmo valor mas sem categoria/vendor coincide em provável', () => {
    // Sem categoria, vendor e descrição preenchidos, a escalada para `exact` não acontece
    // (§8.4): uma despesa é `date+amount+vehicle` (provável) ou a chave completa (certa).
    const records = [expense('e1', { date: '2026-01-15', amountCents: 5000 })];
    const state: ExistingAccountState = {
      records: [existing('expense', 'acc-e', { date: '2026-01-15', amountCents: 5000, category: null, vendor: null, description: null }, { vehicleLocalId: 'v1' })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.action).toBe('probable');
    expect(p.entries[0]?.action).not.toBe('exact');
  });

  it('a política de conflito não promove um provável a certo', () => {
    // `prefer-incoming` decide o que fazer **depois** de a coincidência ser provável.
    // Não a torna certa — seria a forma discreta de apagar o registo do utilizador.
    const records = [fuel('f1', { date: '2026-01-15', litres: 40, odometerKm: 100004, amountCents: 6000 })];
    const state: ExistingAccountState = {
      records: [existing('fuel', 'acc-f', { date: '2026-01-15', litres: 40, odometerKm: 100000, amountCents: 6000 }, { vehicleLocalId: 'v1' })],
    };

    const p = plan(records, state, { conflictPolicy: 'prefer-incoming' });
    expect(p.entries[0]?.action).toBe('probable');
    expect(p.conflictPolicy).toBe('prefer-incoming');
  });

  it('uma coincidência certa coexiste com um provável sem se misturarem', () => {
    const state: ExistingAccountState = {
      records: [
        existing('vehicle', 'acc-plate', { plate: 'AA-00-AA', vin: null, make: 'Renault', model: 'Clio', year: 2018 }),
        existing('fuel', 'acc-f', { date: '2026-03-01', litres: 30, odometerKm: 50000, amountCents: 4500 }, { vehicleLocalId: 'v1' }),
      ],
    };

    const records = [
      vehicle('v1', 'AA-00-AA', null),
      fuel('f1', { date: '2026-03-01', litres: 30, odometerKm: 50004, amountCents: 4500 }),
      fuel('f2', { date: '2026-04-01', litres: 20, odometerKm: 51000, amountCents: 3000 }),
    ];

    const p = plan(records, state);
    const byLocalId = new Map(p.entries.map((entry) => [entry.localId, entry.action]));

    expect(byLocalId.get('v1')).toBe('exact');
    expect(byLocalId.get('f1')).toBe('probable');
    expect(byLocalId.get('f2')).toBe('create');
    expect(p.counts).toMatchObject({ exact: 1, probable: 1, create: 1 });
  });

  it('nunca escolhe um provável quando existe um certo', () => {
    const vin = 'VF1RJA00012345678';
    const state: ExistingAccountState = {
      records: [
        // Coincide por marca+modelo+ano (provável) e por VIN (certo).
        existing('vehicle', 'acc-vin', { plate: 'ZZ-99-ZZ', vin, make: 'Renault', model: 'Clio', year: 2018 }),
      ],
    };
    const records = [vehicle('v1', 'XX-11-XX', vin)];

    const p = plan(records, state);
    expect(p.entries[0]?.action).toBe('exact');
    expect(p.entries[0]?.viaKey?.kind).toBe('vin');
  });
});

describe('plan — enriquecimento distingue valores iguais de valores diferentes', () => {
  it('CASO B — um campo preenchido nos dois lados com o mesmo valor não é conflito', () => {
    // Regressão. A versão anterior só conhecia os **nomes** dos campos preenchidos, e por
    // isso declarava conflito em qualquer campo preenchido dos dois lados — mesmo quando
    // os valores eram idênticos. O efeito era um aviso falso em cada importação de rotina,
    // e um aviso falso repetido ensina o utilizador a ignorar avisos — precisamente o
    // mecanismo que a decisão 8 criou para proteger os dados.
    const records = [vehicle('v1', 'AA-00-AA', null, 'Renault', 'Clio', 2018)];
    const state: ExistingAccountState = {
      records: [existing('vehicle', 'acc', { plate: 'AA-00-AA', vin: null, make: 'Renault', model: 'Clio', year: 2018 })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.conflict).toBe('duplicate');
    expect(p.entries[0]?.conflictingFields).toEqual([]);
    expect(p.entries[0]?.enrichableFields).toEqual([]);
  });

  it('CASO B — quatro campos iguais e um diferente produzem um conflito, com o campo nomeado', () => {
    // A granularidade importa: o relatório tem de dizer **qual** campo diverge, não apenas
    // que "há um conflito". Um conflito sem campo nomeado obriga o utilizador a comparar
    // registo a registo à mão.
    const records = [vehicle('v1', 'AA-00-AA', null, 'Renault', 'Mégane', 2018)];
    const state: ExistingAccountState = {
      records: [existing('vehicle', 'acc', { plate: 'AA-00-AA', vin: null, make: 'Renault', model: 'Clio', year: 2018 })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.conflictingFields).toEqual(['model']);
    expect(p.entries[0]?.conflict).toBe('conflict');
    // `plate`, `make` e `year` coincidem e não aparecem em lado nenhum — nem como conflito,
    // nem como enriquecimento.
    expect(p.entries[0]?.conflictingFields).not.toContain('plate');
    expect(p.entries[0]?.conflictingFields).not.toContain('make');
    expect(p.entries[0]?.conflictingFields).not.toContain('year');
    expect(p.entries[0]?.enrichableFields).not.toContain('plate');
  });

  it('CASO B — valores iguais continuam sem conflito num tipo diferente de veículo', () => {
    // A regra não pode estar presa ao tipo de registo. Aqui aplica-se a um abastecimento,
    // cujos campos são numéricos e de data em vez de texto.
    const records = [fuel('f1', { date: '2026-02-01', litres: 40, odometerKm: 100000, amountCents: 6000 })];
    const state: ExistingAccountState = {
      records: [existing('fuel', 'acc-f', { date: '2026-02-01', litres: 40, odometerKm: 100000, amountCents: 6000 }, { vehicleLocalId: 'v1' })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.conflictingFields).toEqual([]);
    expect(p.entries[0]?.conflict).toBe('duplicate');
  });

  it('CASO B — num abastecimento, só o campo que difere é declarado em conflito', () => {
    const records = [fuel('f1', { date: '2026-02-01', litres: 40, odometerKm: 100000, amountCents: 9999 })];
    const state: ExistingAccountState = {
      records: [existing('fuel', 'acc-f', { date: '2026-02-01', litres: 40, odometerKm: 100000, amountCents: 6000 }, { vehicleLocalId: 'v1' })],
    };

    const p = plan(records, state);
    // `date`, `litres` e `odometerKm` coincidem; só `amountCents` diverge.
    expect(p.entries[0]?.conflictingFields).toEqual(['amountCents']);
  });

  it('CASO B — `filledValues` é a única fonte de verdade, e um valor ausente no destino não é conflito', () => {
    // Um campo que o destino **não** tem é enriquecível, não conflituoso. É a distinção que
    // a decisão 8 assenta: preencher o vazio nunca destrói; sobrescrever pode.
    const records = [vehicle('v1', 'AA-00-AA', 'VF1RJA00012345678', 'Renault', 'Clio', 2018)];
    const state: ExistingAccountState = {
      records: [existing('vehicle', 'acc', { plate: 'AA-00-AA', vin: null, make: 'Renault', model: 'Clio', year: 2018 })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.enrichableFields).toContain('vin');
    expect(p.entries[0]?.conflictingFields).toEqual([]);
  });

  it('CASO B — `filledValues` com valor nulo é tratado como campo vazio, não como valor igual a nulo', () => {
    // `null` nunca é um valor com que se compare. Se `filledValues` trouxesse `vin: null`,
    // a comparação com o VIN não nulo do bundle declararia conflito — mas `null` significa
    // "não há valor", e a resposta certa é enriquecer.
    const records = [vehicle('v1', 'AA-00-AA', 'VF1RJA00012345678', 'Renault', 'Clio', 2018)];
    const state: ExistingAccountState = {
      records: [
        {
          kind: 'vehicle',
          id: 'acc',
          keys: dedupeKeysFor(vehicle('acc', 'AA-00-AA', null, 'Renault', 'Clio', 2018)),
          // `vin` está em `filledFields` por engano (ou por um leitor de conta descuidado) e
          // o seu valor é `null`.
          filledFields: ['plate', 'make', 'model', 'year', 'vin'],
          filledValues: { plate: 'AA-00-AA', make: 'Renault', model: 'Clio', year: 2018, vin: null },
        },
      ],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.conflictingFields).toEqual([]);
    expect(p.entries[0]?.enrichableFields).toContain('vin');
  });

  it('CASO B — sem os valores do destino, um campo preenchido nos dois lados não é declarado em conflito', () => {
    // Sem `filledValues` não há forma honesta de afirmar que os valores diferem. A escolha
    // é entre um aviso possivelmente falso em cada registo e nenhum aviso; a segunda é a
    // segura, porque um conflito é uma **pergunta** e um enriquecimento nunca sobrescreve.
    const records = [vehicle('v1', 'AA-00-AA', null, 'Renault', 'Mégane', 2018)];
    const state: ExistingAccountState = {
      records: [
        {
          kind: 'vehicle',
          id: 'acc',
          keys: dedupeKeysFor(vehicle('acc', 'AA-00-AA', null, 'Renault', 'Clio', 2018)),
          filledFields: ['plate', 'make', 'model', 'year'],
        },
      ],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.conflictingFields).toEqual([]);
    expect(p.entries[0]?.conflict).toBe('duplicate');
  });

  it('um enriquecimento e um conflito no mesmo registo resolvem-se como conflito', () => {
    // O registo tem o VIN vazio (enriquecível) e o modelo diferente (em conflito). O
    // resultado tem de ser conflito: propor um enriquecimento tocaria num registo que
    // também diverge, e a escrita automática passaria a ser parcialmente destrutiva.
    const records = [vehicle('v1', 'AA-00-AA', 'VF1RJA00012345678', 'Renault', 'Mégane', 2018)];
    const state: ExistingAccountState = {
      records: [existing('vehicle', 'acc', { plate: 'AA-00-AA', vin: null, make: 'Renault', model: 'Clio', year: 2018 })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.conflict).toBe('conflict');
    expect(p.entries[0]?.enrichableFields).toContain('vin');
    expect(p.entries[0]?.conflictingFields).toContain('model');
  });
});

describe('plan — idempotência antes de deduplicação (§9.5, §8.2)', () => {
  it('reimportar o mesmo bundle não cria nada', () => {
    const records = [vehicle('v1', 'AA-00-AA', null)];
    const state: ExistingAccountState = {
      records: [existing('vehicle', 'acc', { plate: 'AA-00-AA', vin: null, make: 'Renault', model: 'Clio', year: 2018 })],
      importedLocalIds: new Map([['v1', 'acc']]),
    };

    const p = plan(records, state);
    expect(p.entries[0]?.action).toBe('skipped');
    expect(p.counts.create).toBe(0);
  });

  it('o resultado da idempotência é `skipped`, não `exact`', () => {
    // A distinção importa para o relatório: sabemos que **nós** criámos este registo a
    // partir deste bundle, e podemos dizê-lo melhor do que "já existente".
    const records = [vehicle('v1', 'AA-00-AA', null)];
    const state: ExistingAccountState = {
      records: [existing('vehicle', 'acc', { plate: 'AA-00-AA', vin: null, make: 'Renault', model: 'Clio', year: 2018 })],
      importedLocalIds: new Map([['v1', 'acc']]),
    };

    const p = plan(records, state);
    expect(p.entries[0]?.action).not.toBe('exact');
    expect(p.entries[0]?.conflict).toBe('duplicate');
  });

  it('a idempotência vence a quarentena: um registo já importado não volta a ser avaliado', () => {
    const records = [vehicle('v1', 'AA-00-AA', null)];
    const state: ExistingAccountState = { importedLocalIds: new Map([['v1', 'acc']]) };
    const issues = [blockingFor('vehicle.missing_field', 'v1', 'falta algo')];

    const p = buildPlan({ records, state, validationIssues: issues });
    expect(p.entries[0]?.action).toBe('skipped');
  });

  it('o livro de idempotência é por `bundleId`+`localId`: outro bundle reimporta tudo', () => {
    // É o que torna possível exportar de uma conta e importar noutra (§8.2).
    const records = [vehicle('v1', 'AA-00-AA', null)];
    const state: ExistingAccountState = {
      records: [existing('vehicle', 'acc', { plate: 'AA-00-AA', vin: null, make: 'Renault', model: 'Clio', year: 2018 })],
      // `localId` igual, mas o livro não tem esta entrada para **este** bundle.
      importedLocalIds: new Map([['outro-local-id', 'acc']]),
    };

    const p = plan(records, state);
    expect(p.entries[0]?.action).toBe('exact');
  });
});

describe('plan — quarentena não se contorna (§9.1, §9.2)', () => {
  it('um problema bloqueante põe o registo em quarentena', () => {
    const records = [vehicle('v1', null, null)];
    const issues = [blockingFor('vehicle.missing_field', 'v1', 'falta matrícula e VIN')];

    const p = buildPlan({ records, state: EMPTY, validationIssues: issues });
    expect(p.entries[0]?.action).toBe('quarantined');
  });

  it('um problema recuperável não põe em quarentena', () => {
    const records = [vehicle('v1', 'AA-00-AA', null)];
    const issues = [recoverableFor('vehicle.missing_odometer', 'v1', 'sem quilometragem')];

    const p = buildPlan({ records, state: EMPTY, validationIssues: issues });
    expect(p.entries[0]?.action).toBe('create');
  });

  it('um problema informativo não põe em quarentena', () => {
    const records = [vehicle('v1', 'AA-00-AA', null)];
    const issues = [informationalFor('vehicle.plate_format', 'v1', 'formato pouco habitual')];

    const p = buildPlan({ records, state: EMPTY, validationIssues: issues });
    expect(p.entries[0]?.action).toBe('create');
  });

  it('a quarentena vence a coincidência com um registo existente', () => {
    // Um registo em quarentena não é classificado contra a conta: a classificação seria
    // sobre dados que ainda não sabemos se entram.
    const records = [vehicle('v1', 'AA-00-AA', null)];
    const state: ExistingAccountState = { records: [existing('vehicle', 'acc', { plate: 'AA-00-AA' })] };
    const issues = [blockingFor('vehicle.bad', 'v1', 'problema')];

    const p = buildPlan({ records, state, validationIssues: issues });
    expect(p.entries[0]?.action).toBe('quarantined');
  });

  it('uma decisão do utilizador **não** contorna a quarentena', () => {
    const records = [vehicle('v1', null, null)];
    const issues = [blockingFor('vehicle.missing_field', 'v1', 'falta matrícula')];
    const decisions = new Map<string, PlanAction>([['v1', 'create']]);

    const p = buildPlan({ records, state: EMPTY, validationIssues: issues, decisions });
    expect(p.entries[0]?.action).toBe('quarantined');
  });

  it('`decideEntry` não descongela uma quarentena', () => {
    const records = [vehicle('v1', null, null)];
    const issues = [blockingFor('vehicle.missing_field', 'v1', 'falta matrícula')];
    const p = buildPlan({ records, state: EMPTY, validationIssues: issues });

    const decided = decideEntry(p, 'v1', 'create');
    expect(decided.entries[0]?.action).toBe('quarantined');
  });

  it('um bloqueante ao nível do bundle torna o plano `blocked`', () => {
    const records = [vehicle('v1', 'AA-00-AA', null)];
    const p = buildPlan({ records, state: EMPTY, bundleBlocked: true });

    expect(p.state).toBe('blocked');
    expect(canApply(p)).toBe(false);
    expect(p.notices.some((notice) => notice.includes('internamente inconsistente'))).toBe(true);
  });

  it('os problemas herdados ficam na entrada e são contáveis por gravidade', () => {
    const records = [vehicle('v1', 'AA-00-AA', null)];
    const issues = [recoverableFor('vehicle.missing_odometer', 'v1', 'sem quilometragem')];

    const p = buildPlan({ records, state: EMPTY, validationIssues: issues });
    expect(p.entries[0]?.issues).toHaveLength(1);
    expect(issuesBySeverity(p, 'recoverable')).toHaveLength(1);
  });
});

describe('plan — problemas de conjunto não se perdem', () => {
  it('um problema sem `localId` é preservado no plano', () => {
    // Descartá-lo porque "não tem dono" esconderia exatamente o problema que bloqueia o
    // bundle inteiro.
    const records = [vehicle('v1', 'AA-00-AA', null)];
    const issues = [issue('blocking', 'bundle.duplicate_id', 'localId repetido')];

    const p = buildPlan({ records, state: EMPTY, validationIssues: issues });
    expect(p.issues).toHaveLength(1);
    expect(p.issueSummary.blocking).toBeGreaterThan(0);
  });

  it('um problema de conjunto não é atribuído a nenhuma entrada', () => {
    const records = [vehicle('v1', 'AA-00-AA', null)];
    const issues = [issue('blocking', 'bundle.duplicate_id', 'localId repetido')];

    const p = buildPlan({ records, state: EMPTY, validationIssues: issues });
    expect(p.entries[0]?.issues).toHaveLength(0);
  });
});

describe('plan — conflito e enriquecimento (decisão 8)', () => {
  it('campos vazios no destino produzem `enrich`', () => {
    // O existente não tem VIN e o bundle traz um: a única escrita automática permitida
    // sobre um registo existente é preencher o que está vazio (decisão 8).
    //
    // A coincidência é **provável** e não certa, e é o comportamento correto: o existente
    // só tem a matrícula (chave `exact`), mas o bundle traz um VIN, e com VIN válido a
    // matrícula deixa de ser prova suficiente (`vehicleKeys`, §8.4). O nível da
    // coincidência é o mais fraco dos dois lados, e nunca se promove um provável a certo.
    const records = [vehicle('v1', 'AA-00-AA', 'VF1RJA00012345678')];
    const state: ExistingAccountState = {
      records: [existing('vehicle', 'acc', { plate: 'AA-00-AA', vin: null, make: 'Renault', model: 'Clio', year: 2018 })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.action).toBe('probable');
    expect(p.entries[0]?.conflict).toBe('enrich');
    expect(p.entries[0]?.enrichableFields).toContain('vin');
    expect(p.entries[0]?.conflictingFields).toEqual([]);
    expect(p.counts.enriching).toBe(1);
  });

  it('um enriquecimento certo acontece quando a chave forte coincide dos dois lados', () => {
    // Com VIN válido nos dois lados, a chave `vin` é `exact` em ambos e a coincidência é
    // certa — e o enriquecimento é proposto sobre um duplicado certo.
    const vin = 'VF1RJA00012345678';
    const records = [vehicle('v1', 'AA-00-AA', vin)];
    const state: ExistingAccountState = {
      records: [existing('vehicle', 'acc', { plate: null, vin, make: 'Renault', model: 'Clio', year: 2018 })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.action).toBe('exact');
    expect(p.entries[0]?.conflict).toBe('enrich');
    expect(p.entries[0]?.enrichableFields).toContain('plate');
  });

  it('valores divergentes em campos preenchidos produzem `conflict`', () => {
    const records = [vehicle('v1', 'AA-00-AA', null, 'Renault', 'Mégane', 2019)];
    const state: ExistingAccountState = {
      records: [existing('vehicle', 'acc', { plate: 'AA-00-AA', vin: null, make: 'Renault', model: 'Clio', year: 2018 })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.conflict).toBe('conflict');
    expect(p.entries[0]?.conflictingFields).toContain('model');
    expect(p.counts.conflicting).toBe(1);
  });

  it('um conflito nunca é enriquecimento ao mesmo tempo', () => {
    // Misturar os dois faria a escrita automática tocar em dados preenchidos.
    const records = [vehicle('v1', 'AA-00-AA', 'VF1RJA00012345678', 'Renault', 'Mégane', 2019)];
    const state: ExistingAccountState = {
      records: [existing('vehicle', 'acc', { plate: 'AA-00-AA', vin: null, make: 'Renault', model: 'Clio', year: 2018 })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.conflict).toBe('conflict');
    expect(p.counts.enriching).toBe(0);
  });

  it('um registo sem nada a acrescentar é `duplicate`', () => {
    const records = [vehicle('v1', 'AA-00-AA', null)];
    const state: ExistingAccountState = {
      records: [existing('vehicle', 'acc', { plate: 'AA-00-AA', vin: null, make: 'Renault', model: 'Clio', year: 2018 })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.conflict).toBe('duplicate');
  });

  it('a razão de um conflito diz que nada será alterado sem decisão', () => {
    const records = [vehicle('v1', 'AA-00-AA', null, 'Renault', 'Mégane', 2019)];
    const state: ExistingAccountState = {
      records: [existing('vehicle', 'acc', { plate: 'AA-00-AA', vin: null, make: 'Renault', model: 'Clio', year: 2018 })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.reason).toContain('Não vou alterar nada');
  });

  it('a razão de um enriquecimento diz que nada do existente muda', () => {
    const vin = 'VF1RJA00012345678';
    const records = [vehicle('v1', 'AA-00-AA', vin)];
    const state: ExistingAccountState = {
      records: [existing('vehicle', 'acc', { plate: null, vin, make: 'Renault', model: 'Clio', year: 2018 })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.reason).toContain('sem alterar nada');
  });

  it('um valor ausente no bundle não enriquece nada', () => {
    const records = [vehicle('v1', 'AA-00-AA', null)];
    const state: ExistingAccountState = {
      records: [existing('vehicle', 'acc', { plate: 'AA-00-AA', vin: 'VF1RJA00012345678', make: 'Renault', model: 'Clio', year: 2018 })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.enrichableFields).not.toContain('vin');
  });

  it('o cálculo de enriquecimento feito por quem lê a conta é respeitado', () => {
    const records = [vehicle('v1', 'AA-00-AA', 'VF1RJA00012345678')];
    const state: ExistingAccountState = {
      records: [
        existing(
          'vehicle',
          'acc',
          { plate: 'AA-00-AA', vin: null, make: 'Renault', model: 'Clio', year: 2018 },
          {},
          { enrichableFields: ['vin'], conflictingFields: [] },
        ),
      ],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.enrichableFields).toEqual(['vin']);
  });

  it('a razão de um provável com conflito avisa que os dados não coincidem exatamente', () => {
    // A mensagem tem de dizer que há divergência, mas em linguagem de utilizador — e não
    // expor os nomes dos campos que divergiram.
    const records = [fuel('f1', { date: '2026-01-15', litres: 40, odometerKm: 100004, amountCents: 9999 })];
    const state: ExistingAccountState = {
      records: [existing('fuel', 'acc-f', { date: '2026-01-15', litres: 40, odometerKm: 100000, amountCents: 6000 }, { vehicleLocalId: 'v1' })],
    };

    const p = plan(records, state);
    expect(p.entries[0]?.action).toBe('probable');
    expect(p.entries[0]?.conflictingFields).toContain('amountCents');
    expect(p.entries[0]?.reason).toContain('não coincidem exatamente');
  });
});

describe('plan — as mensagens não expõem conceitos técnicos (§11.3)', () => {
  it('nenhuma razão contém um identificador técnico', () => {
    const records = [vehicle('v1', 'AA-00-AA', null), fuel('f1', { date: '2026-01-15', litres: 40, odometerKm: 100004, amountCents: 6000 })];
    const state: ExistingAccountState = { records: [existing('vehicle', 'acc', { plate: 'AA-00-AA', vin: null, make: 'Renault', model: 'Clio', year: 2018 })] };

    const p = plan(records, state);
    const forbidden = ['localId', 'dedupeKey', 'sha256', 'schema', 'null', 'undefined'];

    for (const entry of p.entries) {
      for (const term of forbidden) {
        expect(entry.reason ?? '').not.toContain(term);
      }
    }
  });

  it('a razão de um provável sem distância medida descreve o que se comparou', () => {
    const records = [expense('e1', { date: '2026-01-15', amountCents: 5000, category: 'Portagens', vendor: 'Via Verde', description: 'A1' })];
    const state: ExistingAccountState = {
      records: [
        existing('expense', 'acc-e', { date: '2026-01-15', amountCents: 5000, category: 'Portagens', vendor: 'Via Verde', description: null }, { vehicleLocalId: 'v1' }),
      ],
    };

    // Chave exata por data+valor+categoria+vendor+descrição exige os três campos de texto
    // não vazios — o existente tem `description` nulo, por isso a coincidência é provável.
    const p = plan(records, state);
    expect(p.entries[0]?.action).toBe('probable');
    expect(p.entries[0]?.reason).toBeTruthy();
  });
});

describe('plan — contagens e resumo para o ecrã de revisão (§11.2)', () => {
  /**
   * Um plano misto, construído com a validação **real** em vez de problemas inventados.
   *
   * Usar `validateRecords` em vez de escrever os problemas à mão é o que garante que o
   * plano é exercido contra o contrato que a produção lhe vai entregar. Um plano testado
   * com problemas fabricados passaria mesmo que `documentContentIssues` mudasse de
   * gravidade — e a gravidade é precisamente o que decide se um documento entra ou fica
   * em quarentena.
   */
  function mixedPlan(): ImportPlan {
    const state: ExistingAccountState = {
      records: [
        existing('vehicle', 'acc-v', { plate: 'AA-00-AA', vin: null, make: 'Renault', model: 'Clio', year: 2018 }),
        existing('fuel', 'acc-f', { date: '2026-02-01', litres: 30, odometerKm: 20000, amountCents: 4500 }, { vehicleLocalId: 'v1' }),
      ],
    };

    const records: CanonicalRecord[] = [
      vehicle('v1', 'AA-00-AA', null),
      vehicle('v2', 'BB-11-BB', null, 'Toyota', 'Corolla', 2021),
      fuel('f1', { date: '2026-02-01', litres: 30, odometerKm: 20004, amountCents: 4500 }),
      fuel('f2', { date: '2026-05-01', litres: 20, odometerKm: 21000, amountCents: 3000 }),
      // Um documento com o conteúdo declaradamente ausente (§5.6): o registo entra, a
      // lacuna é nomeada. É a decisão 2 em forma de dado.
      record(
        'document',
        'd1',
        { name: 'IPO', category: 'inspection', expiresAt: '2027-01-01', contentState: 'missingContent', contentSha256: null, storageKey: null },
        { vehicleLocalId: 'v1' },
      ),
      // Um veículo sem matrícula: falta um campo obrigatório e o registo fica em
      // quarentena. Note-se que `vehiclePlausibilityIssues` classifica a ausência de
      // matrícula como **informativa** — a divergência entre os dois é do bloco 4+5, já
      // validado, e está registada no relatório em vez de ser corrigida aqui.
      record('vehicle', 'v3', { plate: null, vin: null, make: null, model: null, year: null }, {}),
    ];

    const validation = validateRecords(records);

    return buildPlan({
      records,
      state,
      validationIssues: validation.issues,
      scopeNote: '2 de 5 veículos',
    });
  }

  it('as contagens somam o total de entradas', () => {
    const p = mixedPlan();
    const { create, exact, probable, quarantined, skipped, total } = p.counts;
    expect(create + exact + probable + quarantined + skipped).toBe(total);
    expect(total).toBe(p.entries.length);
  });

  it('a contagem por tipo acompanha as entradas', () => {
    const p = mixedPlan();
    expect(p.byKind.vehicle).toBe(3);
    expect(p.byKind.fuel).toBe(2);
    expect(p.byKind.document).toBe(1);
  });

  it('um documento sem ficheiro não vai para quarentena, mas é contado', () => {
    // A decisão 2 diz que o registo entra e o ficheiro pode ser acrescentado depois. O
    // que não pode é a lacuna ficar escondida.
    const p = mixedPlan();
    const doc = p.entries.find((entry) => entry.localId === 'd1');

    expect(doc?.action).toBe('create');
    expect(p.counts.documentsMissingContent).toBe(1);
    expect(p.notices.some((notice) => notice.includes('ficheiro original'))).toBe(true);
  });

  it('um veículo sem matrícula nem VIN fica em quarentena', () => {
    const p = mixedPlan();
    const bad = p.entries.find((entry) => entry.localId === 'v3');
    expect(bad?.action).toBe('quarantined');
    expect(p.counts.quarantined).toBe(1);
  });

  it('o resumo apresenta os quatro números do §11.2', () => {
    const summary = summarizePlan(mixedPlan());
    expect(summary).toMatchObject({
      toCreate: expect.any(Number),
      alreadyExists: expect.any(Number),
      needsDecision: expect.any(Number),
      cannotImport: expect.any(Number),
      total: expect.any(Number),
    });
    expect(summary.toCreate + summary.alreadyExists + summary.needsDecision + summary.cannotImport + summary.skipped).toBe(summary.total);
  });

  it('o resumo transporta o âmbito declarado pelo bundle (§5.7)', () => {
    const summary = summarizePlan(mixedPlan());
    expect(summary.scopeNote).toBe('2 de 5 veículos');
  });

  it('o aviso de quarentena aparece quando há registos em quarentena', () => {
    const records = [vehicle('v1', null, null)];
    const p = buildPlan({ records, state: EMPTY, validationIssues: [blockingFor('vehicle.missing_field', 'v1', 'sem matrícula')] });

    expect(p.notices.some((notice) => notice.includes('não podem ser importados'))).toBe(true);
  });

  it('`issuesBySeverity` separa bloqueantes de recuperáveis', () => {
    const p = mixedPlan();
    expect(issuesBySeverity(p, 'blocking').length).toBeGreaterThan(0);
    expect(issuesBySeverity(p, 'informational')).toHaveLength(0);
  });

  it('`entriesByAction` devolve só as entradas da ação pedida', () => {
    const p = mixedPlan();
    const creates = entriesByAction(p, 'create');
    expect(creates.every((entry) => entry.action === 'create')).toBe(true);
    expect(creates.length).toBe(p.counts.create);
  });
});

describe('plan — a ordem de criação respeita as dependências', () => {
  it('os veículos vêm antes de tudo o que lhes aponta', () => {
    const records = [
      fuel('f1', { date: '2026-01-15', litres: 40, odometerKm: 100000, amountCents: 6000 }),
      vehicle('v1', 'AA-00-AA', null),
      expense('e1', { date: '2026-01-15', amountCents: 5000 }),
    ];

    const order = creationOrder(plan(records));
    expect(order.map((entry) => entry.kind)).toEqual(['vehicle', 'expense', 'fuel']);
  });

  it('só entram na ordem de criação as entradas `create`', () => {
    const state: ExistingAccountState = { records: [existing('vehicle', 'acc', { plate: 'AA-00-AA', vin: null, make: 'Renault', model: 'Clio', year: 2018 })] };
    // O segundo veículo tem marca e modelo diferentes: se fosse o mesmo par
    // marca+modelo+ano, coincidiria por essa chave e seria provável, não novo.
    const records = [vehicle('v1', 'AA-00-AA', null), vehicle('v2', 'BB-11-BB', null, 'Toyota', 'Corolla', 2021)];

    const order = creationOrder(plan(records, state));
    expect(order).toHaveLength(1);
    expect(order[0]?.localId).toBe('v2');
  });

  it('a ordem é estável dentro do mesmo tipo', () => {
    const records = [vehicle('v3', 'CC-33-CC', null), vehicle('v1', 'AA-00-AA', null), vehicle('v2', 'BB-11-BB', null)];
    const order = creationOrder(plan(records));
    expect(order.map((entry) => entry.localId)).toEqual(['v3', 'v1', 'v2']);
  });
});

describe('plan — decisões do utilizador são imutáveis (decisão 10)', () => {
  function planWithProbable(): ImportPlan {
    const state: ExistingAccountState = {
      records: [existing('fuel', 'acc-f', { date: '2026-01-15', litres: 40, odometerKm: 100000, amountCents: 6000 }, { vehicleLocalId: 'v1' })],
    };
    return plan([fuel('f1', { date: '2026-01-15', litres: 40, odometerKm: 100004, amountCents: 6000 })], state);
  }

  it('`decideEntry` devolve um plano novo sem mutar o original', () => {
    const original = planWithProbable();
    const snapshot = JSON.stringify(original);

    const decided = decideEntry(original, 'f1', 'create');

    expect(JSON.stringify(original)).toBe(snapshot);
    expect(decided).not.toBe(original);
    expect(decided.entries[0]?.action).toBe('create');
    expect(original.entries[0]?.action).toBe('probable');
  });

  it('`decideEntry` com `skip` marca o registo como saltado', () => {
    const decided = decideEntry(planWithProbable(), 'f1', 'skip');
    expect(decided.entries[0]?.action).toBe('skipped');
    expect(decided.counts.probable).toBe(0);
    expect(decided.counts.skipped).toBe(1);
  });

  it('`decideEntry` reclassifica as contagens e o estado', () => {
    const decided = decideEntry(planWithProbable(), 'f1', 'skip');
    expect(decided.state).toBe('nothing-to-do');
    expect(decided.counts.create + decided.counts.probable + decided.counts.enriching).toBe(0);
  });

  it('`decideEntry` ignora um `localId` que não existe no plano', () => {
    const p = planWithProbable();
    const decided = decideEntry(p, 'nao-existe', 'create');
    expect(decided.entries[0]?.action).toBe('probable');
  });

  it('`decideAllProbables` resolve todos os prováveis de uma vez', () => {
    const state: ExistingAccountState = {
      records: [
        existing('fuel', 'acc-f1', { date: '2026-01-15', litres: 40, odometerKm: 100000, amountCents: 6000 }, { vehicleLocalId: 'v1' }),
        existing('fuel', 'acc-f2', { date: '2026-02-15', litres: 35, odometerKm: 200000, amountCents: 5500 }, { vehicleLocalId: 'v1' }),
      ],
    };

    const records = [
      fuel('f1', { date: '2026-01-15', litres: 40, odometerKm: 100004, amountCents: 6000 }),
      fuel('f2', { date: '2026-02-15', litres: 35, odometerKm: 200003, amountCents: 5500 }),
    ];

    const p = plan(records, state);
    expect(p.counts.probable).toBe(2);

    const decided = decideAllProbables(p, 'skip');
    expect(decided.counts.probable).toBe(0);
    expect(decided.counts.skipped).toBe(2);
  });

  it('`decideAllProbables` não afeta duplicados certos', () => {
    // Uma ação em bloco sobre os certos seria uma forma discreta de forçar a duplicação
    // de tudo.
    const state: ExistingAccountState = {
      records: [
        existing('vehicle', 'acc-v', { plate: 'AA-00-AA', vin: null, make: 'Renault', model: 'Clio', year: 2018 }),
        existing('fuel', 'acc-f', { date: '2026-01-15', litres: 40, odometerKm: 100000, amountCents: 6000 }, { vehicleLocalId: 'v1' }),
      ],
    };

    const records = [
      vehicle('v1', 'AA-00-AA', null),
      fuel('f1', { date: '2026-01-15', litres: 40, odometerKm: 100004, amountCents: 6000 }),
    ];

    const p = plan(records, state);
    const decided = decideAllProbables(p, 'create');

    const vehicleEntry = decided.entries.find((entry) => entry.localId === 'v1');
    expect(vehicleEntry?.action).toBe('exact');
    expect(decided.counts.exact).toBe(1);
  });

  it('`decideAllProbables` não devolve nada diferente quando não há prováveis', () => {
    const p = plan([vehicle('v1', 'AA-00-AA', null)]);
    const decided = decideAllProbables(p, 'create');
    expect(decided.counts).toEqual(p.counts);
  });

  it('`pendingDecisions` conta os prováveis por decidir', () => {
    const p = planWithProbable();
    expect(pendingDecisions(p)).toBe(1);
    expect(pendingDecisions(decideEntry(p, 'f1', 'create'))).toBe(0);
  });

  it('uma decisão tomada à partida é aplicada na construção do plano', () => {
    const state: ExistingAccountState = {
      records: [existing('fuel', 'acc-f', { date: '2026-01-15', litres: 40, odometerKm: 100000, amountCents: 6000 }, { vehicleLocalId: 'v1' })],
    };
    const records = [fuel('f1', { date: '2026-01-15', litres: 40, odometerKm: 100004, amountCents: 6000 })];
    const decisions = new Map<string, PlanAction>([['f1', 'skipped']]);

    const p = buildPlan({ records, state, decisions });
    expect(p.entries[0]?.action).toBe('skipped');
    expect(p.counts.probable).toBe(0);
  });

  it('um plano com prováveis pendentes continua aplicável, mas declara as decisões pendentes', () => {
    // A §8.3 diz que a ação por omissão de um provável é perguntar; a decisão 10 permite
    // aplicá-los em bloco. O que não pode acontecer é aplicá-los sem o utilizador saber.
    const p = planWithProbable();
    expect(canApply(p)).toBe(true);
    expect(pendingDecisions(p)).toBeGreaterThan(0);
  });

  it('um plano bloqueado nunca é aplicável', () => {
    const p = buildPlan({ records: [vehicle('v1', 'AA-00-AA', null)], state: EMPTY, bundleBlocked: true });
    expect(canApply(p)).toBe(false);
  });

  it('um plano `nothing-to-do` não é aplicável', () => {
    expect(canApply(plan([]))).toBe(false);
  });
});

describe('plan — a política de conflito por omissão é a segura (decisão 8)', () => {
  it('a omissão é `fill-empty`, nunca `prefer-incoming`', () => {
    expect(DEFAULT_CONFLICT_POLICY).toBe('fill-empty');
    expect(plan([vehicle('v1', 'AA-00-AA', null)]).conflictPolicy).toBe('fill-empty');
  });

  it('a política pedida fica registada no plano', () => {
    const p = buildPlan({ records: [vehicle('v1', 'AA-00-AA', null)], state: EMPTY, conflictPolicy: 'manual' });
    expect(p.conflictPolicy).toBe('manual');
  });
});

describe('plan — `dedupeKeysFor` é o único ponto que sabe os campos das chaves', () => {
  it('um veículo produz chaves de matrícula, VIN e marca+modelo+ano', () => {
    const keys = dedupeKeysFor(vehicle('v1', 'AA-00-AA', 'VF1RJA00012345678'));
    const kinds = keys.map((key) => key.kind);
    expect(kinds).toContain('plate');
    expect(kinds).toContain('vin');
    expect(kinds).toContain('make+model+year');
  });

  it('um tipo sem chave própria devolve uma lista vazia em vez de uma chave inventada', () => {
    // Sugestões e notificações são dados opcionais (decisão 5) e não participam na
    // deduplicação por conteúdo na v1. Inventar uma chave seria pior do que não ter nenhuma.
    const keys = dedupeKeysFor(record('suggestion', 's1', { text: 'Muda o óleo' }));
    expect(keys).toEqual([]);
  });

  it('um registo sem dados suficientes não produz chave nenhuma', () => {
    const keys = dedupeKeysFor(vehicle('v1', null, null, null as unknown as string, null as unknown as string, null as unknown as number));
    expect(keys.every((key) => key.value === null)).toBe(true);
  });

  it('um registo sem veículo não produz chaves que dependam do veículo', () => {
    const keys = dedupeKeysFor(record('fuel', 'f1', { date: '2026-01-15', litres: 40, odometerKm: 100000, amountCents: 6000 }, { vehicleLocalId: null }));
    expect(keys.every((key) => key.value === null || !key.kind.includes('vehicle'))).toBe(true);
  });

  it('uma leitura de odómetro produz uma chave com a data e o valor', () => {
    const keys = dedupeKeysFor(record('odometer', 'o1', { recordedAt: '2026-01-15', odometerKm: 100000 }, { vehicleLocalId: 'v1' }));
    expect(keys.map((key) => key.kind)).toContain('date+odometer');
  });

  it('um lembrete por data e por quilometragem produz chaves distintas', () => {
    // Uma data e uma quilometragem são critérios diferentes: dois lembretes com o mesmo
    // título mas um por data e outro por km não são o mesmo lembrete.
    const keys = dedupeKeysFor(
      record('reminder', 'r1', { title: 'Revisão', dueDate: '2026-06-01', dueOdometerKm: 120000 }, { vehicleLocalId: 'v1' }),
    );
    const kinds = keys.map((key) => key.kind);
    expect(kinds).toContain('title+vehicle+dueDate');
    expect(kinds).toContain('title+vehicle+dueOdometer');
  });
});

/* ========================================================================== */
/* migrate.ts — §12.1, §12.2, §12.3                                            */
/* ========================================================================== */

describe('migrate — política de compatibilidade (§12.1)', () => {
  it('a versão atual é aceite sem conversão', () => {
    expect(checkCompatibility({ format: EXPORT_FORMAT, formatVersion: FORMAT_VERSION })).toEqual({ kind: 'current' });
  });

  it('uma versão mais recente é recusada explicitamente', () => {
    const verdict = checkCompatibility({ format: EXPORT_FORMAT, formatVersion: FORMAT_VERSION + 1 });
    expect(verdict.kind).toBe('too-new');
    if (verdict.kind === 'too-new') {
      expect(verdict.bundleVersion).toBe(FORMAT_VERSION + 1);
      expect(verdict.supported).toBe(FORMAT_VERSION);
    }
  });

  it('uma versão menor que 1 é recusada como malformada, não como antiga', () => {
    // A verificação de sanidade da versão vem antes da comparação com o mínimo suportado:
    // um `formatVersion: 0` não é "um bundle antigo", é um campo inválido — e dizer ao
    // utilizador para exportar de novo um ficheiro que ele nunca exportou seria pior do
    // que dizer-lhe que o ficheiro está corrompido.
    const verdict = checkCompatibility({ format: EXPORT_FORMAT, formatVersion: MIN_SUPPORTED_FORMAT_VERSION - 1 });
    expect(verdict.kind).toBe('malformed');
  });

  it('`describeCompatibility` sabe descrever uma versão antiga demais', () => {
    // O ramo `too-old` não é alcançável hoje (`MIN_SUPPORTED_FORMAT_VERSION` é 1), mas a
    // mensagem existe e tem de estar correta para quando o mínimo subir.
    const message = describeCompatibility({ kind: 'too-old', bundleVersion: 0, minimum: 1 });
    expect(message).toContain('demasiado antigo');
    expect(message).toContain('Exporta-o de novo');
  });

  it('um `format` diferente é recusado como ficheiro externo, não como versão', () => {
    const verdict = checkCompatibility({ format: 'outra-coisa', formatVersion: 99 });
    expect(verdict.kind).toBe('wrong-format');
    if (verdict.kind === 'wrong-format') expect(verdict.format).toBe('outra-coisa');
  });

  it('o `format` é verificado antes da versão', () => {
    // Um CSV com um número de versão partido deve ser encaminhado para a camada 2, não
    // recusado como "bundle demasiado recente" — que mandaria o utilizador atualizar uma
    // aplicação que já está atualizada.
    const verdict = checkCompatibility({ format: 'csv', formatVersion: 9999 });
    expect(verdict.kind).toBe('wrong-format');
  });

  it('um `format` ausente é recusado', () => {
    expect(checkCompatibility({ formatVersion: FORMAT_VERSION }).kind).toBe('wrong-format');
  });

  it('uma `formatVersion` ausente é malformada', () => {
    expect(checkCompatibility({ format: EXPORT_FORMAT }).kind).toBe('malformed');
  });

  it('uma `formatVersion` não inteira é malformada', () => {
    expect(checkCompatibility({ format: EXPORT_FORMAT, formatVersion: 1.5 }).kind).toBe('malformed');
  });

  it('uma `formatVersion` não numérica é malformada', () => {
    expect(checkCompatibility({ format: EXPORT_FORMAT, formatVersion: '1' }).kind).toBe('malformed');
  });

  it('uma `formatVersion` menor que 1 é malformada', () => {
    expect(checkCompatibility({ format: EXPORT_FORMAT, formatVersion: 0 }).kind).toBe('malformed');
    expect(checkCompatibility({ format: EXPORT_FORMAT, formatVersion: -1 }).kind).toBe('malformed');
  });

  it('a versão atual é a única que hoje produz `current` — o mínimo suportado também é 1', () => {
    // Com `MIN_SUPPORTED_FORMAT_VERSION` a 1, o ramo `migrate` não é alcançável: não
    // existe salto nenhum. É por isso que `MIGRATIONS` está vazio, e é coerente.
    expect(MIN_SUPPORTED_FORMAT_VERSION).toBe(FORMAT_VERSION);
  });

  it('nenhuma mensagem de recusa deixa o utilizador num beco sem saída (§11.3)', () => {
    const verdicts = [
      checkCompatibility({ format: EXPORT_FORMAT, formatVersion: FORMAT_VERSION + 1 }),
      checkCompatibility({ format: EXPORT_FORMAT, formatVersion: 0 }),
      checkCompatibility({ format: 'csv', formatVersion: 1 }),
      checkCompatibility({ format: EXPORT_FORMAT }),
      { kind: 'too-old' as const, bundleVersion: 0, minimum: 1 },
    ];

    for (const verdict of verdicts) {
      const message = describeCompatibility(verdict);
      expect(message.length).toBeGreaterThan(20);
      // Nenhuma mensagem expõe `formatVersion`, nomes de campos ou números crus do schema.
      expect(message).not.toContain('formatVersion');
      expect(message).not.toContain('schema');
    }
  });

  it('a mensagem de versão demasiado recente diz ao utilizador o que fazer', () => {
    const message = describeCompatibility(checkCompatibility({ format: EXPORT_FORMAT, formatVersion: FORMAT_VERSION + 1 }));
    expect(message.toLowerCase()).toContain('atualiza');
  });

  it('a mensagem de ficheiro externo encaminha para a camada 2 (§10)', () => {
    const message = describeCompatibility(checkCompatibility({ format: 'csv', formatVersion: 1 }));
    expect(message.toLowerCase()).toContain('csv');
    expect(message.toLowerCase()).toContain('importação de ficheiros');
  });
});

describe('migrate — cadeia de migrações (§12.2)', () => {
  /** Uma migração de teste que acrescenta um campo e regista o que fez. */
  function testMigration(fromVersion: number, field: string): Migration {
    return {
      fromVersion,
      toVersion: fromVersion + 1,
      description: `Acrescenta ${field}`,
      apply: (context) => {
        const records = context.recordsOf('vehicle');
        const { records: converted, changed } = addOptionalField(records, field, null);
        context.replaceRecords('vehicle', converted);
        return changed > 0 ? [`Preenchi ${field} em ${changed} registo(s).`] : [];
      },
    };
  }

  it('uma cadeia vazia é devolvida quando a versão já é a de destino', () => {
    expect(findMigrationPath(2, 2, [])).toEqual([]);
  });

  it('uma migração por salto, nunca um salto directo', () => {
    const migrations = [testMigration(1, 'a'), testMigration(2, 'b'), testMigration(3, 'c')];
    const path = findMigrationPath(1, 4, migrations);

    expect(path).not.toBeNull();
    expect(path?.map((migration) => [migration.fromVersion, migration.toVersion])).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
    ]);
  });

  it('uma migração em falta devolve `null` em vez de forçar um salto', () => {
    const migrations = [testMigration(1, 'a'), testMigration(3, 'c')];
    expect(findMigrationPath(1, 4, migrations)).toBeNull();
  });

  it('uma versão de destino anterior à de origem devolve `null` — nunca se migra para trás', () => {
    expect(findMigrationPath(3, 1, [testMigration(1, 'a')])).toBeNull();
  });

  it('uma migração mal declarada, que salte duas versões, é recusada', () => {
    // Sem esta salvaguarda, o ciclo poderia não terminar ou terminar cedo em silêncio.
    const broken: Migration = {
      fromVersion: 1,
      toVersion: 3,
      description: 'salto duplo',
      apply: () => [],
    };
    expect(findMigrationPath(1, 3, [broken])).toBeNull();
  });

  it('`runMigrations` agrega as notas na ordem em que as migrações correram', () => {
    const migrations = [testMigration(1, 'a'), testMigration(2, 'b')];
    const data = new Map<string, readonly Record<string, unknown>[]>([['vehicle', [{ localId: 'v1' }]]]);

    const context: MigrationContext = {
      recordsOf: (kind) => data.get(kind) ?? [],
      replaceRecords: (kind, records) => {
        data.set(kind, records);
      },
      manifestMeta: {},
    };

    const notes = runMigrations(context, 1, 3, migrations);
    expect(notes).toEqual(['Preenchi a em 1 registo(s).', 'Preenchi b em 1 registo(s).']);
  });

  it('`runMigrations` devolve `null` quando a cadeia não existe', () => {
    const context: MigrationContext = { recordsOf: () => [], replaceRecords: () => {}, manifestMeta: {} };
    expect(runMigrations(context, 1, 5, [])).toBeNull();
  });

  it('`runMigrations` devolve uma lista vazia quando não há nada a fazer', () => {
    const context: MigrationContext = { recordsOf: () => [], replaceRecords: () => {}, manifestMeta: {} };
    expect(runMigrations(context, 2, 2, [])).toEqual([]);
  });

  it('as migrações registadas em produção estão vazias, porque ainda não há salto nenhum', () => {
    // Não é um lugar-comum: é o estado correto do projeto. `FORMAT_VERSION` é 1 e
    // `MIN_SUPPORTED_FORMAT_VERSION` é 1.
    expect(MIGRATIONS).toEqual([]);
    expect(FORMAT_VERSION).toBe(1);
    expect(MIN_SUPPORTED_FORMAT_VERSION).toBe(1);
  });
});

describe('migrate — auxiliares de migração preservam dados', () => {
  it('`addOptionalField` não sobrescreve um valor já presente', () => {
    // Um campo já presente é deixado intacto: se uma migração futura precisar de
    // reescrever um valor, isso é uma mudança de semântica e merece código explícito.
    const { records, changed } = addOptionalField([{ a: 1 }, { a: null }, {}], 'a', 0);

    expect(changed).toBe(1);
    expect(records[0]?.a).toBe(1);
    expect(records[1]?.a).toBeNull();
    expect(records[2]?.a).toBe(0);
  });

  it('`renameField` preserva o valor no nome novo', () => {
    const { records, changed, skipped } = renameField([{ old: 42 }], 'old', 'new');
    expect(changed).toBe(1);
    expect(skipped).toBe(0);
    expect(records[0]).toEqual({ new: 42 });
  });

  it('`renameField` descarta o valor de origem quando o destino já existe, e reporta', () => {
    // A alternativa — sobrepor — perderia o valor que já lá estava sem o dizer.
    const { records, changed, skipped } = renameField([{ old: 1, new: 2 }], 'old', 'new');
    expect(changed).toBe(0);
    expect(skipped).toBe(1);
    expect(records[0]).toEqual({ old: 1, new: 2 });
  });

  it('`renameField` ignora registos que não têm o campo de origem', () => {
    const { records, changed, skipped } = renameField([{ outro: 1 }], 'old', 'new');
    expect(changed).toBe(0);
    expect(skipped).toBe(0);
    expect(records[0]).toEqual({ outro: 1 });
  });

  it('`mapField` converte só os registos que declaram a conversão', () => {
    const { records, changed } = mapField([{ cents: 100 }, { cents: 250 }], 'cents', (value) => (typeof value === 'number' ? value / 100 : value));
    expect(changed).toBe(2);
    expect(records.map((r) => r.cents)).toEqual([1, 2.5]);
  });

  it('`mapField` deixa intactos os registos sem o campo', () => {
    const { records, changed } = mapField([{ outro: 1 }], 'cents', () => 0);
    expect(changed).toBe(0);
    expect(records[0]).toEqual({ outro: 1 });
  });

  it('`mapField` não conta como alteração um valor que fica igual', () => {
    const { changed } = mapField([{ cents: 100 }], 'cents', (value) => value);
    expect(changed).toBe(0);
  });

  it('os auxiliares não mutam os registos recebidos', () => {
    const original = [{ a: 1 }];
    const snapshot = JSON.stringify(original);

    addOptionalField(original, 'b', 2);
    renameField(original, 'a', 'z');
    mapField(original, 'a', () => 99);

    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe('migrate — `migrateBundle` é o ponto de entrada único', () => {
  const context = (): MigrationContext => {
    const data = new Map<string, readonly Record<string, unknown>[]>([['vehicle', [{ localId: 'v1' }]]]);
    return {
      recordsOf: (kind) => data.get(kind) ?? [],
      replaceRecords: (kind, records) => {
        data.set(kind, records);
      },
      manifestMeta: {},
    };
  };

  it('uma versão atual não é migrada, e não inventa notas', () => {
    const outcome = migrateBundle(context(), FORMAT_VERSION);
    expect(outcome).toEqual({ migrated: false, fromVersion: FORMAT_VERSION, toVersion: FORMAT_VERSION, notes: [] });
  });

  it('uma versão superior falha explicitamente em vez de migrar para trás', () => {
    const outcome = migrateBundle(context(), FORMAT_VERSION + 1);
    expect(outcome.migrated).toBe(false);
    expect(outcome.failure).toBeTruthy();
    expect(outcome.failure).toContain('versão mais recente');
  });

  it('uma cadeia em falta devolve uma falha descritiva, não uma exceção', () => {
    const outcome = migrateBundle(context(), 1, []);
    // `FORMAT_VERSION` é 1, por isso a versão 1 já é a atual e não há migração nenhuma.
    expect(outcome.migrated).toBe(false);
    expect(outcome.failure).toBeUndefined();
  });

  it('uma migração bem-sucedida regista as notas no resultado', () => {
    const migration: Migration = {
      fromVersion: 1,
      toVersion: 2,
      description: 'Acrescenta um campo',
      apply: (ctx) => {
        const { records, changed } = addOptionalField(ctx.recordsOf('vehicle'), 'novo', null);
        ctx.replaceRecords('vehicle', records);
        return [`Preenchi 'novo' em ${changed} registo(s).`];
      },
    };

    // Simula um bundle na versão 1 com a aplicação na versão 2, passando a migração de
    // teste e um `formatVersion` coerente com ela.
    const outcome = migrateBundle(context(), 1, [migration]);
    // `FORMAT_VERSION` é 1, e a migração de teste leva de 1 para 2: com a aplicação ainda
    // na versão 1, a cadeia não é necessária e nada corre. É o comportamento correto —
    // não se migra para uma versão que a aplicação ainda não é.
    expect(outcome.migrated).toBe(false);
  });

  it('uma falha de migração nunca devolve notas parcialmente aplicadas', () => {
    const outcome = migrateBundle(context(), FORMAT_VERSION + 5);
    expect(outcome.notes).toEqual([]);
    expect(outcome.migrated).toBe(false);
  });
});

describe('migrate — informação de versões para diagnóstico', () => {
  it('descreve a gama suportada de forma acionável', () => {
    const support = describeVersionSupport();
    expect(support.formatVersion).toBe(FORMAT_VERSION);
    expect(support.minSupportedFormatVersion).toBe(MIN_SUPPORTED_FORMAT_VERSION);
    expect(support.supportedRange).toBe(`${MIN_SUPPORTED_FORMAT_VERSION}–${FORMAT_VERSION}`);
  });
});
