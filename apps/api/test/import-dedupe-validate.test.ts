/**
 * Testes das chaves de deduplicação e da validação — bloco 4 + 5
 * (`docs/IMPORT-EXPORT.md` §8 e §9).
 *
 * ## Porque é que estes testes são os mais importantes da Fase 1
 *
 * A deduplicação falha em silêncio. Uma chave composta mal formada não produz um erro:
 * produz um bundle que importa com dados a menos (coincidiu o que não devia) ou com
 * dados a mais (não coincidiu o que devia). Nos dois casos, sem sintoma.
 *
 * Por isso os testes abaixo verificam sobretudo as **fronteiras**:
 *
 *  - um provável **nunca** é tratado como certo (apaga dados);
 *  - dois valores ausentes **nunca** coincidem (eleva provável a certo por engano);
 *  - uma tolerância é aplicada só onde a §8.6 a declara;
 *  - uma referência quebrada **bloqueia** em vez de degradar em silêncio;
 *  - um documento sem ficheiro **não** bloqueia, mas é sempre declarado.
 */

import { describe, expect, it } from 'vitest';
import {
  TOLERANCES,
  chargingKeys,
  datedTypeKeys,
  documentKeys,
  eventKeys,
  expenseKeys,
  fuelKeys,
  odometerKeys,
  reminderKeys,
  sameCivilDate,
  taxKeys,
  vehicleKeys,
  withinTolerance,
  type DedupeKey,
} from '../src/domain/import/dedupe-keys.js';
import {
  blocking,
  brokenReferenceIssues,
  documentContentIssues,
  findBrokenReferences,
  findDuplicateLocalIds,
  findMissingVehicleReferences,
  informational,
  invalidLocalIdIssues,
  invalidReferenceFormatIssues,
  localIdPrefixHint,
  missingRequiredFieldIssues,
  missingVehicleReferenceIssues,
  qualityFrom,
  recoverable,
  semanticIssues,
  summarizeIssues,
  validateBundleId,
  validateRecords,
  vehiclePlausibilityIssues,
  type CanonicalRecord,
} from '../src/domain/import/validate.js';

/* -------------------------------------------------------------------------- */
/* Auxiliares                                                                  */
/* -------------------------------------------------------------------------- */

/** Chave com um dado `kind`, ou `undefined` quando não existe. */
function keyOf(keys: readonly DedupeKey[], kind: string): DedupeKey | undefined {
  return keys.find((key) => key.kind === kind);
}

/** Valor comparável de uma chave, para afirmar igualdade entre dois registos. */
function valueOf(keys: readonly DedupeKey[], kind: string): string | null | undefined {
  return keyOf(keys, kind)?.value;
}

/**
 * Registo canónico mínimo, com os campos que o teste quiser sobrepor.
 *
 * `fields` é preenchido com os valores por omissão do tipo, para que um teste que só
 * verifique relações não seja bloqueado por campos obrigatórios em falta.
 */
function record(
  kind: CanonicalRecord['kind'],
  localId: string,
  overrides: {
    fields?: Record<string, unknown>;
    references?: Record<string, string | null | undefined>;
    file?: string;
    line?: number;
    /**
     * Subtitui os campos por omissão em vez de se sobrepor a eles.
     *
     * Sem isto, um teste que queira testar a **ausência** de um campo obrigatório não o
     * consegue exprimir: `{ plate: null }` continuaria a ver `plate: 'AA-00-BB'` do
     * conjunto por omissão, e o teste passaria a afirmar o contrário do que diz.
     */
    replaceFields?: boolean;
  } = {},
): CanonicalRecord {
  const defaults: Record<string, Record<string, unknown>> = {
    vehicle: { plate: 'AA-00-BB' },
    expense: { date: '2026-02-10', amountCents: 4210, category: 'fuel' },
    fuel: { date: '2026-02-10', litres: 42.35, amountCents: 7200 },
    charging: { date: '2026-02-10', energyKwh: 31.2, amountCents: 900 },
    maintenance: { date: '2026-02-10', type: 'oil_change' },
    insurance: { insurer: 'Seguradora X', startDate: '2026-01-01', endDate: '2027-01-01' },
    inspection: { date: '2026-02-10' },
    tax: { year: 2026, amountCents: 3500 },
    document: { name: 'Fatura', category: 'maintenance', contentState: 'missingContent' },
    reminder: { title: 'Mudar óleo' },
    event: { type: 'fuel.added', date: '2026-02-10', title: 'Abastecimento' },
    odometer: { odometerKm: 100000, recordedAt: '2026-02-10' },
    suggestion: { key: 'vehicle.add_insurance:veh_1', type: 'insurance' },
    notification: { topic: 'maintenance', title: 'Óleo', body: 'Está na hora.' },
  };

  const fields = overrides.replaceFields
    ? (overrides.fields ?? {})
    : { ...(defaults[kind] ?? {}), ...(overrides.fields ?? {}) };

  return {
    kind,
    localId,
    fields,
    references: overrides.references ?? {},
    ...(overrides.file ? { file: overrides.file } : {}),
    ...(overrides.line !== undefined ? { line: overrides.line } : {}),
  };
}

/* ========================================================================== */
/* 1. Veículo (§8.4)                                                           */
/* ========================================================================== */

describe('vehicleKeys — VIN (§8.4)', () => {
  it('usa o VIN como chave certa — é único por desenho', () => {
    const keys = vehicleKeys({ vin: 'WVWZZZ1KZ9W123456', plate: 'AA-00-BB' });
    const vin = keyOf(keys, 'vin');
    expect(vin?.level).toBe('exact');
    expect(vin?.value).toBe('WVWZZZ1KZ9W123456');
  });

  it('normaliza o VIN antes de o usar como chave', () => {
    const a = vehicleKeys({ vin: 'wvwzzz1kz9w123456' });
    const b = vehicleKeys({ vin: ' WVW-ZZZ1KZ-9W123456 ' });
    expect(valueOf(a, 'vin')).toBe(valueOf(b, 'vin'));
  });

  it('ignora um VIN com forma inválida em vez de o usar como chave', () => {
    // Com I/O/Q ou com comprimento errado, o VIN está mal transcrito. Usá-lo como chave
    // "certa" produziria um falso duplicado exato — o pior erro possível.
    expect(keyOf(vehicleKeys({ vin: 'WVWIZZ1KZ9W123456' }), 'vin')).toBeUndefined();
    expect(keyOf(vehicleKeys({ vin: 'CURTO' }), 'vin')).toBeUndefined();
  });
});

describe('vehicleKeys — matrícula (§8.4)', () => {
  it('é certa quando é a única identidade disponível', () => {
    const keys = vehicleKeys({ plate: 'AA-00-BB' });
    expect(keyOf(keys, 'plate')?.level).toBe('exact');
  });

  it('desce a provável quando existe VIN válido e é outra identidade', () => {
    // A ressalva da §8.4. Matrículas são reatribuídas entre países e ao longo do tempo:
    // sem isto, um carro importado com matrícula que já foi de outro veículo seria
    // considerado o mesmo, e os históricos dos dois seriam fundidos em silêncio.
    const keys = vehicleKeys({ vin: 'WVWZZZ1KZ9W123456', plate: 'AA-00-BB' });
    expect(keyOf(keys, 'plate')?.level).toBe('probable');
  });

  it('ignora uma matrícula demasiado curta para ser chave', () => {
    expect(keyOf(vehicleKeys({ plate: 'AB' }), 'plate')).toBeUndefined();
  });

  it('compara a mesma matrícula escrita de formas diferentes', () => {
    const a = vehicleKeys({ plate: '42-38-1EL' });
    const b = vehicleKeys({ plate: '4238 1EL' });
    expect(valueOf(a, 'plate')).toBe(valueOf(b, 'plate'));
  });
});

describe('vehicleKeys — marca e modelo (§8.4)', () => {
  it('marca + modelo + ano sem identificadores é provável, nunca certo', () => {
    // Dois VW Golf de 2019 existem, e são carros diferentes.
    const keys = vehicleKeys({ make: 'Volkswagen', model: 'Golf', year: 2019 });
    expect(keyOf(keys, 'make+model+year')?.level).toBe('probable');
  });

  it('exige marca e modelo juntos — só a marca não identifica nada', () => {
    expect(keyOf(vehicleKeys({ make: 'Volkswagen' }), 'make+model+year')).toBeUndefined();
  });

  it('normaliza a marca e o modelo, para que a mesma grafia coincida', () => {
    const a = vehicleKeys({ make: 'Citroën', model: 'C4' });
    const b = vehicleKeys({ make: 'CITROEN', model: 'c4' });
    expect(valueOf(a, 'make+model+year')).toBe(valueOf(b, 'make+model+year'));
  });
});

/* ========================================================================== */
/* 2. Despesa (§8.4) — a fronteira mais importante                            */
/* ========================================================================== */

describe('expenseKeys (§8.4)', () => {
  const base = {
    vehicleLocalId: 'veh_1',
    date: '2026-02-10',
    amountCents: 1200,
  };

  it('data + valor + veículo é provável, NÃO certo', () => {
    // O caso de teste que justifica o desenho: duas portagens no mesmo dia pelo mesmo
    // valor são um caso real e comum. Classificá-las como certas apagaria uma delas.
    const keys = expenseKeys(base);
    expect(keyOf(keys, 'date+amount+vehicle')?.level).toBe('probable');
  });

  it('sobe a certo quando categoria, fornecedor e descrição coincidem todos', () => {
    const keys = expenseKeys({
      ...base,
      category: 'tolls',
      vendor: 'Via Verde',
      description: 'Portagem A1',
    });
    expect(keyOf(keys, 'date+amount+category+vendor+description+vehicle')?.level).toBe('exact');
  });

  it('não sobe a certo se o fornecedor ou a descrição estiverem vazios', () => {
    // Sem o guarda de texto utilizável, três campos vazios contariam como coincidência e
    // um provável passaria a certo.
    const keys = expenseKeys({ ...base, category: 'tolls', vendor: '', description: '' });
    expect(keyOf(keys, 'date+amount+category+vendor+description+vehicle')).toBeUndefined();
  });

  it('não produz chave quando falta o veículo, a data ou o valor', () => {
    // Uma chave composta exige todas as partes: omitir uma faria coincidir registos em
    // campos que nenhum preenche.
    expect(keyOf(expenseKeys({ date: '2026-02-10', amountCents: 100 }), 'date+amount+vehicle')).toBeUndefined();
    expect(keyOf(expenseKeys({ vehicleLocalId: 'veh_1', amountCents: 100 }), 'date+amount+vehicle')).toBeUndefined();
    expect(keyOf(expenseKeys({ vehicleLocalId: 'veh_1', date: '2026-02-10' }), 'date+amount+vehicle')).toBeUndefined();
  });

  it('duas despesas iguais produzem a mesma chave', () => {
    expect(valueOf(expenseKeys(base), 'date+amount+vehicle')).toBe(
      valueOf(expenseKeys({ ...base }), 'date+amount+vehicle'),
    );
  });

  it('duas despesas de veículos diferentes produzem chaves diferentes', () => {
    expect(valueOf(expenseKeys(base), 'date+amount+vehicle')).not.toBe(
      valueOf(expenseKeys({ ...base, vehicleLocalId: 'veh_2' }), 'date+amount+vehicle'),
    );
  });
});

/* ========================================================================== */
/* 3. Abastecimento e carregamento (§8.4)                                      */
/* ========================================================================== */

describe('fuelKeys (§8.4)', () => {
  it('data + litros + quilometragem é certo — a km é praticamente única', () => {
    const keys = fuelKeys({ vehicleLocalId: 'veh_1', date: '2026-02-10', litres: 42.35, odometerKm: 100000 });
    expect(keyOf(keys, 'date+litres+odometer')?.level).toBe('exact');
  });

  it('data + litros sem quilometragem é apenas provável', () => {
    const keys = fuelKeys({ vehicleLocalId: 'veh_1', date: '2026-02-10', litres: 42.35 });
    expect(keyOf(keys, 'date+litres')?.level).toBe('probable');
    expect(keyOf(keys, 'date+litres+odometer')).toBeUndefined();
  });

  it('data + valor sem litros é provável', () => {
    const keys = fuelKeys({ vehicleLocalId: 'veh_1', date: '2026-02-10', amountCents: 7200 });
    expect(keyOf(keys, 'date+amount')?.level).toBe('probable');
  });

  it('expõe os valores numéricos normalizados para a comparação por tolerância', () => {
    const keys = fuelKeys({
      vehicleLocalId: 'veh_1',
      date: '2026-02-10',
      litres: 42.350000000000001,
      odometerKm: 100004,
      amountCents: 7200,
    });
    const strong = keyOf(keys, 'date+litres+odometer');
    expect(strong?.numeric?.litres).toBe(42.35);
    expect(strong?.numeric?.odometerKm).toBe(100004);
  });
});

describe('chargingKeys (§8.4)', () => {
  it('data + energia + quilometragem é certo', () => {
    const keys = chargingKeys({ vehicleLocalId: 'veh_1', date: '2026-02-10', energyKwh: 31.2, odometerKm: 50000 });
    expect(keyOf(keys, 'date+energy+odometer')?.level).toBe('exact');
  });

  it('data + energia sem quilometragem é provável', () => {
    const keys = chargingKeys({ vehicleLocalId: 'veh_1', date: '2026-02-10', energyKwh: 31.2 });
    expect(keyOf(keys, 'date+energy')?.level).toBe('probable');
  });
});

/* ========================================================================== */
/* 4. Manutenção, inspeção, seguro, imposto (§8.4)                             */
/* ========================================================================== */

describe('datedTypeKeys (§8.4)', () => {
  it('data + tipo é provável', () => {
    const keys = datedTypeKeys({ vehicleLocalId: 'veh_1', date: '2026-02-10', type: 'oil_change' });
    expect(keyOf(keys, 'date+type')?.level).toBe('probable');
  });

  it('data + tipo + valor + quilometragem é certo', () => {
    const keys = datedTypeKeys({
      vehicleLocalId: 'veh_1',
      date: '2026-02-10',
      type: 'oil_change',
      amountCents: 8500,
      odometerKm: 100000,
    });
    expect(keyOf(keys, 'date+type+amount+odometer')?.level).toBe('exact');
  });

  it('normaliza o tipo, para que a mesma intervenção coincida entre aplicações', () => {
    const a = datedTypeKeys({ vehicleLocalId: 'veh_1', date: '2026-02-10', type: 'Óleo e Filtros' });
    const b = datedTypeKeys({ vehicleLocalId: 'veh_1', date: '2026-02-10', type: 'oleo e filtros' });
    expect(valueOf(a, 'date+type')).toBe(valueOf(b, 'date+type'));
  });

  it('serve manutenção, inspeção e seguro sem duplicar o motor (§4.3)', () => {
    // A inspeção usa `result` no lugar de `type`; a chave não precisa de saber a
    // diferença. É isto que permite acrescentar um tipo de registo sem tocar aqui.
    const inspection = datedTypeKeys({ vehicleLocalId: 'veh_1', date: '2026-02-10', type: 'passed' });
    expect(keyOf(inspection, 'date+type')?.value).toBeTruthy();
  });
});

describe('taxKeys (§8.4)', () => {
  it('ano + tipo é certo — um veículo tem um IUC por ano', () => {
    const keys = taxKeys({ vehicleLocalId: 'veh_1', kind: 'iuc', year: 2026 });
    expect(keyOf(keys, 'year+kind')?.level).toBe('exact');
  });

  it('normaliza o tipo de imposto', () => {
    const a = taxKeys({ vehicleLocalId: 'veh_1', kind: 'IUC', year: 2026 });
    const b = taxKeys({ vehicleLocalId: 'veh_1', kind: 'iuc', year: 2026 });
    expect(valueOf(a, 'year+kind')).toBe(valueOf(b, 'year+kind'));
  });

  it('não distingue anos diferentes', () => {
    const a = taxKeys({ vehicleLocalId: 'veh_1', kind: 'iuc', year: 2026 });
    const b = taxKeys({ vehicleLocalId: 'veh_1', kind: 'iuc', year: 2027 });
    expect(valueOf(a, 'year+kind')).not.toBe(valueOf(b, 'year+kind'));
  });
});

/* ========================================================================== */
/* 5. Quilometragem, documento, lembrete, evento (§8.4)                        */
/* ========================================================================== */

describe('odometerKeys (§8.4)', () => {
  it('data + valor é certo — duas leituras iguais no mesmo dia são a mesma', () => {
    const keys = odometerKeys({ vehicleLocalId: 'veh_1', recordedAt: '2026-02-10', odometerKm: 100000 });
    expect(keys[0]?.level).toBe('exact');
  });

  it('não distingue a origem nem a marca de correção', () => {
    // Uma leitura corrigida e uma manual com os mesmos valores são a mesma observação do
    // mundo, mesmo tendo chegado por caminhos diferentes.
    const manual = odometerKeys({ vehicleLocalId: 'veh_1', recordedAt: '2026-02-10', odometerKm: 100000 });
    const corrected = odometerKeys({ vehicleLocalId: 'veh_1', recordedAt: '2026-02-10', odometerKm: 100000 });
    expect(valueOf(manual, 'date+odometer')).toBe(valueOf(corrected, 'date+odometer'));
  });

  it('não produz chave quando falta a data ou o valor', () => {
    expect(odometerKeys({ vehicleLocalId: 'veh_1', odometerKm: 100000 })).toHaveLength(0);
    expect(odometerKeys({ vehicleLocalId: 'veh_1', recordedAt: '2026-02-10' })).toHaveLength(0);
  });
});

describe('documentKeys (§8.4, §5.6)', () => {
  it('usa o sha256 do conteúdo como chave certa — o mesmo ficheiro é o mesmo documento', () => {
    const keys = documentKeys({ contentSha256: 'a'.repeat(64) });
    expect(keyOf(keys, 'contentSha256')?.level).toBe('exact');
  });

  it('usa o storageKey como chave certa quando presente', () => {
    const keys = documentKeys({ storageKey: 's3://bucket/obj.pdf' });
    expect(keyOf(keys, 'storageKey')?.level).toBe('exact');
  });

  it('cai na chave provável quando não há bytes — a lacuna não impede a dedup', () => {
    // O caso do `missingContent`: o registo entra, é deduplicado por uma chave mais
    // fraca, e a lacuna é nomeada no relatório. Nada é inventado para preencher o lugar
    // da chave que falta.
    const keys = documentKeys({ name: 'Fatura da revisão', vehicleLocalId: 'veh_1', expiresAt: '2027-01-01' });
    expect(keyOf(keys, 'name+vehicle+expiresAt')?.level).toBe('probable');
    expect(keyOf(keys, 'contentSha256')).toBeUndefined();
  });

  it('ignora um sha256 com forma inválida em vez de o aceitar como certo', () => {
    expect(keyOf(documentKeys({ contentSha256: 'nao-e-um-hash' }), 'contentSha256')).toBeUndefined();
  });
});

describe('reminderKeys (§8.4)', () => {
  it('título + veículo + data é certo', () => {
    const keys = reminderKeys({ vehicleLocalId: 'veh_1', title: 'Mudar óleo', dueDate: '2026-06-01' });
    expect(keyOf(keys, 'title+vehicle+dueDate')?.level).toBe('exact');
  });

  it('título + veículo + km é uma chave distinta da anterior', () => {
    // Um lembrete por tempo e um por distância com o mesmo título são coisas diferentes.
    // Uni-los numa só chave faria um deles desaparecer na importação.
    const byDate = reminderKeys({ vehicleLocalId: 'veh_1', title: 'Mudar óleo', dueDate: '2026-06-01' });
    const byKm = reminderKeys({ vehicleLocalId: 'veh_1', title: 'Mudar óleo', dueOdometerKm: 120000 });
    expect(keyOf(byDate, 'title+vehicle+dueDate')?.value).not.toBe(
      keyOf(byKm, 'title+vehicle+dueOdometer')?.value,
    );
  });

  it('produz as duas chaves quando ambas as condições existem', () => {
    const keys = reminderKeys({
      vehicleLocalId: 'veh_1',
      title: 'Inspeção',
      dueDate: '2026-06-01',
      dueOdometerKm: 120000,
    });
    expect(keys).toHaveLength(2);
  });

  it('não produz chave sem título utilizável', () => {
    expect(reminderKeys({ vehicleLocalId: 'veh_1', dueDate: '2026-06-01' })).toHaveLength(0);
    expect(reminderKeys({ vehicleLocalId: 'veh_1', title: '   ', dueDate: '2026-06-01' })).toHaveLength(0);
  });
});

describe('eventKeys (§8.4)', () => {
  it('tipo + data + registo ligado é certo', () => {
    const keys = eventKeys({
      vehicleLocalId: 'veh_1',
      type: 'fuel.added',
      date: '2026-02-10',
      recordLocalId: 'fuel_1',
    });
    expect(keyOf(keys, 'type+date+record')?.level).toBe('exact');
  });

  it('sem registo ligado, cai em tipo + data + título, apenas provável', () => {
    const keys = eventKeys({ vehicleLocalId: 'veh_1', type: 'fuel.added', date: '2026-02-10', title: 'Abastecimento' });
    expect(keyOf(keys, 'type+date+title')?.level).toBe('probable');
    expect(keyOf(keys, 'type+date+record')).toBeUndefined();
  });
});

/* ========================================================================== */
/* 6. Tolerâncias (§8.6)                                                       */
/* ========================================================================== */

describe('Tolerâncias (§8.6)', () => {
  it('declara exatamente os valores especificados', () => {
    // Uma tolerância é uma hipótese sobre o mundo físico, e por isso não pode ser
    // ajustada sem uma razão: mudá-la muda o que conta como "o mesmo abastecimento".
    expect(TOLERANCES.odometerKm).toBe(50);
    expect(TOLERANCES.amountCents).toBe(2);
    expect(TOLERANCES.litres).toBe(0.05);
  });

  it('a tolerância de data civil é ZERO', () => {
    // Uma data errada por um dia é um dado errado, não um duplicado. Tolerar um dia faria
    // coincidir o abastecimento de ontem com o de hoje.
    expect(TOLERANCES.civilDateDays).toBe(0);
  });

  it('aplica a tolerância de quilometragem de ±50 km', () => {
    // O mesmo abastecimento registado em dois sítios difere pelo arredondamento do
    // odómetro — o caso concreto que justifica esta tolerância.
    expect(withinTolerance(100_000, 100_004, TOLERANCES.odometerKm)).toBe(true);
    expect(withinTolerance(100_000, 100_050, TOLERANCES.odometerKm)).toBe(true);
    expect(withinTolerance(100_000, 100_051, TOLERANCES.odometerKm)).toBe(false);
  });

  it('aplica a tolerância de valor de ±2 cêntimos', () => {
    expect(withinTolerance(4210, 4212, TOLERANCES.amountCents)).toBe(true);
    expect(withinTolerance(4210, 4213, TOLERANCES.amountCents)).toBe(false);
  });

  it('não trata um valor ausente como estando dentro da tolerância', () => {
    // Ausente não está "próximo" de nada — está ausente. Sem este guarda, um registo sem
    // quilometragem coincidiria com um registo com qualquer quilometragem.
    expect(withinTolerance(null, 100_000, 50)).toBe(false);
    expect(withinTolerance(100_000, null, 50)).toBe(false);
    expect(withinTolerance(undefined, undefined, 50)).toBe(false);
  });

  it('recusa comparar valores não finitos', () => {
    expect(withinTolerance(Number.NaN, 100_000, 50)).toBe(false);
    expect(withinTolerance(Number.POSITIVE_INFINITY, 100_000, 50)).toBe(false);
  });

  it('compara datas civis com tolerância zero', () => {
    expect(sameCivilDate('2026-02-10', '2026-02-10')).toBe(true);
    expect(sameCivilDate('2026-02-10', '2026-02-11')).toBe(false);
  });

  it('normaliza as datas antes de as comparar', () => {
    expect(sameCivilDate('10/02/2026', '2026-02-10')).toBe(true);
  });
});

/* ========================================================================== */
/* 7. Consistência interna do bundle (§9.4, §13.4)                             */
/* ========================================================================== */

describe('validateBundleId (§9.5)', () => {
  it('aceita um bundleId válido', () => {
    expect(validateBundleId('bnd_9f3c1a2b3c4d5e6f')).toBeNull();
  });

  it('recusa um bundleId inválido como bloqueante, com mensagem legível', () => {
    const issue = validateBundleId('sem-prefixo');
    expect(issue?.severity).toBe('blocking');
    // "bundle_id_invalid" não diz nada a um utilizador; a mensagem tem de dizer.
    expect(issue?.message).toMatch(/identificador de bundle/i);
  });
});

describe('findDuplicateLocalIds — bloqueante (§9.4)', () => {
  it('deteta dois registos com o mesmo localId', () => {
    // Bloqueante porque torna as referências ambíguas: se `veh_1` designa dois veículos,
    // não é possível saber para qual aponta `vehicleLocalId: "veh_1"`.
    const issues = findDuplicateLocalIds([
      record('vehicle', 'veh_1'),
      record('vehicle', 'veh_1'),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('blocking');
    expect(issues[0]?.code).toBe('bundle.duplicate_local_id');
  });

  it('deteta colisões entre tipos diferentes', () => {
    // O `localId` é um espaço de nomes único dentro do bundle. `exp_1` e `veh_1` são
    // distintos, mas `veh_1` usado duas vezes — mesmo com tipos diferentes — não é.
    const issues = findDuplicateLocalIds([
      record('vehicle', 'x_1'),
      record('expense', 'x_1'),
    ]);
    expect(issues).toHaveLength(1);
  });

  it('não reporta nada quando os identificadores são únicos', () => {
    expect(findDuplicateLocalIds([record('vehicle', 'veh_1'), record('vehicle', 'veh_2')])).toHaveLength(0);
  });
});

describe('findBrokenReferences — distingue ausência de quebra (§9.4)', () => {
  it('trata uma referência preenchida para um alvo inexistente como quebrada', () => {
    const broken = findBrokenReferences([
      record('expense', 'exp_1', { references: { vehicleLocalId: 'veh_999' } }),
    ]);
    expect(broken).toHaveLength(1);
    expect(broken[0]?.missingLocalId).toBe('veh_999');
  });

  it('NÃO trata uma referência ausente como quebrada', () => {
    // Uma carta de condução não tem veículo; uma despesa manual não tem registo ligado.
    // Confundir as duas faria com que todos os registos sem relação opcional fossem
    // reportados, e o relatório deixaria de ser consultável.
    expect(findBrokenReferences([record('document', 'doc_1', { references: { vehicleLocalId: null } })])).toHaveLength(0);
    expect(findBrokenReferences([record('document', 'doc_1')])).toHaveLength(0);
    expect(findBrokenReferences([record('document', 'doc_1', { references: { vehicleLocalId: undefined } })])).toHaveLength(0);
  });

  it('aceita uma referência que existe no bundle', () => {
    const broken = findBrokenReferences([
      record('vehicle', 'veh_1'),
      record('expense', 'exp_1', { references: { vehicleLocalId: 'veh_1' } }),
    ]);
    expect(broken).toHaveLength(0);
  });

  it('converte as quebras em problemas bloqueantes com mensagem legível', () => {
    const broken = findBrokenReferences([
      record('expense', 'exp_1', { references: { vehicleLocalId: 'veh_999' } }),
    ]);
    const issues = brokenReferenceIssues(broken);
    expect(issues[0]?.severity).toBe('blocking');
    expect(issues[0]?.message).toContain('veh_999');
    expect(issues[0]?.localId).toBe('exp_1');
  });

  it('recusa uma referência com forma inválida, mesmo que o alvo venha a existir', () => {
    // `../x` nunca pode ser um alvo legítimo. Deixá-lo passar só adiaria a falha.
    const issues = invalidReferenceFormatIssues([
      record('expense', 'exp_1', { references: { vehicleLocalId: '../etc/passwd' } }),
    ]);
    expect(issues[0]?.severity).toBe('blocking');
    expect(issues[0]?.code).toBe('bundle.invalid_reference_format');
  });
});

describe('findMissingVehicleReferences — referência obrigatória em falta (§9.4)', () => {
  /*
   * Esta regra preenche um buraco que o `findBrokenReferences` não vê, por desenho.
   *
   * O `findBrokenReferences` responde a «esta referência aponta para algo que não
   * existe?». Ele **não** responde a «este registo tem a referência de que precisa?» —
   * e a ausência é um valor legítimo em `documents` e `events`, pelo que tratá-la lá
   * como quebra estaria errado.
   *
   * Sem esta regra, um registo de `fuel` sem `vehicleLocalId` passava a validação
   * inteira, o plano dizia `ready`, e a escrita falhava a meio com um erro do Prisma
   * (`Argument \`vehicle\` is missing`) — um 500, não um problema explicado. A §9.4
   * exige «bloqueante, detetada antes de qualquer escrita».
   */

  it('deteta um abastecimento sem veículo', () => {
    const missing = findMissingVehicleReferences([record('fuel', 'fuel_1')]);
    expect(missing).toHaveLength(1);
    expect(missing[0]?.record.localId).toBe('fuel_1');
  });

  it('trata a ausência como `undefined`, `null` e cadeia vazia', () => {
    // A §5.3 diz que a ausência é omissão ou `null`; uma cadeia vazia é o mesmo escrito
    // de outra maneira. Não contar a cadeia vazia deixaria passar exactamente o caso que
    // a camada CSV produz quando a coluna da matrícula existe mas está vazia.
    expect(findMissingVehicleReferences([record('fuel', 'f1', { references: {} })])).toHaveLength(1);
    expect(findMissingVehicleReferences([record('fuel', 'f2', { references: { vehicleLocalId: null } })])).toHaveLength(1);
    expect(findMissingVehicleReferences([record('fuel', 'f3', { references: { vehicleLocalId: undefined } })])).toHaveLength(1);
    expect(findMissingVehicleReferences([record('fuel', 'f4', { references: { vehicleLocalId: '' } })])).toHaveLength(1);
  });

  it('NÃO exige veículo a um documento', () => {
    // `Document.vehicleId` é `String?` no esquema: uma carta de condução não tem veículo.
    expect(findMissingVehicleReferences([record('document', 'doc_1')])).toHaveLength(0);
  });

  it('NÃO exige veículo a um veículo', () => {
    expect(findMissingVehicleReferences([record('vehicle', 'veh_1')])).toHaveLength(0);
  });

  it('aceita um registo que traz o veículo', () => {
    const missing = findMissingVehicleReferences([
      record('vehicle', 'veh_1'),
      record('fuel', 'fuel_1', { references: { vehicleLocalId: 'veh_1' } }),
    ]);
    expect(missing).toHaveLength(0);
  });

  it('exige-o a todos os tipos que têm vehicleId obrigatório no esquema', () => {
    // A lista é derivada do `schema.prisma`, não de preferências: todos estes declaram
    // `vehicleId String` sem `?`. Um tipo novo que entre no esquema sem veículo tem de
    // ser uma decisão consciente, e este teste é o que a obriga a ser.
    const required: CanonicalRecord['kind'][] = [
      'odometer',
      'expense',
      'fuel',
      'charging',
      'maintenance',
      'insurance',
      'inspection',
      'tax',
      'reminder',
    ];
    for (const kind of required) {
      expect(findMissingVehicleReferences([record(kind, `${kind}_1`)]), kind).toHaveLength(1);
    }
  });

  it('converte-os em problemas bloqueantes com mensagem legível', () => {
    const issues = missingVehicleReferenceIssues(
      findMissingVehicleReferences([record('fuel', 'fuel_1')]),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('blocking');
    expect(issues[0]?.code).toBe('bundle.missing_vehicle_reference');
    expect(issues[0]?.localId).toBe('fuel_1');
    expect(issues[0]?.field).toBe('vehicleLocalId');
    // A mensagem nomeia o tipo em português, para uma pessoa decidir — não a coluna interna.
    expect(issues[0]?.message).toContain('abastecimento');
    expect(issues[0]?.message).not.toContain('vehicleLocalId');
  });

  it('bloqueia o conjunto inteiro, não apenas o registo afetado (§9.4)', () => {
    // A §9.4 trata um bloqueante como bloqueio do bundle: o utilizador não deve importar
    // «os outros» e descobrir depois que faltou metade.
    const validation = validateRecords([
      record('vehicle', 'veh_1'),
      record('odometer', 'odo_1', { references: { vehicleLocalId: 'veh_1' } }),
      record('fuel', 'fuel_1'),
    ]);
    expect(validation.blocked).toBe(true);
    expect(validation.issues.some((i) => i.code === 'bundle.missing_vehicle_reference')).toBe(true);
  });

  it('não bloqueia um conjunto em que todos trazem o veículo', () => {
    const validation = validateRecords([
      record('vehicle', 'veh_1'),
      record('odometer', 'odo_1', { references: { vehicleLocalId: 'veh_1' } }),
      record('fuel', 'fuel_1', { references: { vehicleLocalId: 'veh_1' } }),
    ]);
    expect(validation.blocked).toBe(false);
  });
});

describe('invalidLocalIdIssues (§13.4)', () => {
  it('recusa um localId com travessia de caminho', () => {
    const issues = invalidLocalIdIssues([record('vehicle', '../../etc/passwd')]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('blocking');
  });

  it('aceita os identificadores que o exportador produz', () => {
    expect(invalidLocalIdIssues([record('vehicle', 'veh_1'), record('expense', 'exp_42')])).toHaveLength(0);
  });
});

/* ========================================================================== */
/* 8. Regras por tipo de registo (§9.1, §9.3)                                  */
/* ========================================================================== */

describe('Campos obrigatórios (§9.1)', () => {
  it('aceita um registo completo', () => {
    expect(missingRequiredFieldIssues(record('expense', 'exp_1'))).toHaveLength(0);
  });

  it('deteta um campo obrigatório em falta como bloqueante', () => {
    const issues = missingRequiredFieldIssues(record('expense', 'exp_1', { fields: { amountCents: null } }));
    expect(issues[0]?.severity).toBe('blocking');
    expect(issues[0]?.field).toBe('amountCents');
  });

  it('trata um campo presente mas nulo como ausente (§5.3)', () => {
    // A §5.3 representa a ausência por omissão ou `null`. Tratar `null` como preenchido
    // faria o registo passar a validação e falhar na escrita, longe da causa.
    expect(missingRequiredFieldIssues(record('fuel', 'fuel_1', { fields: { litres: null } }))).toHaveLength(1);
    expect(missingRequiredFieldIssues(record('fuel', 'fuel_1', { fields: { litres: undefined } }))).toHaveLength(1);
  });

  it('não exige campos que o Zemlo aceita ver vazios num onboarding por completar (§49)', () => {
    // Um veículo sem VIN, sem modelo e sem ano é a norma, não um erro.
    const minimal = record('vehicle', 'veh_1', { fields: { plate: 'AA-00-BB' } });
    expect(missingRequiredFieldIssues(minimal)).toHaveLength(0);
  });
});

/**
 * A identidade mínima de um veículo é a matrícula (A25).
 *
 * A importação segue a **mesma regra da criação manual**: o README diz *"uma matrícula é
 * suficiente para começar"* e *"só a matrícula é obrigatória para criar um veículo"*. A
 * §49 aceita dados **complementares** incompletos, não a ausência de identidade.
 *
 * Estes testes existem porque a regra já estava implementada mas não estava **escrita** no
 * sítio onde vivia, e por isso divergiu do README durante todo o bloco 4+5 sem que nada
 * falhasse. Uma regra bloqueante que ninguém consegue citar é uma regra que se perde.
 */
describe('identidade mínima do veículo — matrícula obrigatória (A25)', () => {
  it('aceita um veículo identificado apenas pela matrícula', () => {
    // É o caso do onboarding de três passos. Nada mais é exigido.
    const issues = missingRequiredFieldIssues(record('vehicle', 'veh_1', { fields: { plate: 'AA-00-BB' }, replaceFields: true }));
    expect(issues).toHaveLength(0);
  });

  it('aceita o exemplo de dados incompletos da §49 quando existe matrícula', () => {
    // `Kia EV3 · 42 381 km`: matrícula, marca, model e quilometragem — sem VIN, sem
    // combustível declarado, sem bateria, sem potência, sem pneus. Válido porque está
    // identificado, não porque a matrícula seja dispensável.
    const record49 = record('vehicle', 'veh_1', {
      fields: { plate: '42-38-1EL', make: 'Kia', model: 'EV3', odometerKm: 42381 },
      replaceFields: true,
    });

    expect(missingRequiredFieldIssues(record49)).toHaveLength(0);
    expect(validateRecords([record49]).records[0]?.quality).toBe('complete');
  });

  it('recusa um veículo sem matrícula', () => {
    const issues = missingRequiredFieldIssues(
      record('vehicle', 'veh_1', { fields: { vin: null }, replaceFields: true }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('blocking');
    expect(issues[0]?.code).toBe('record.missing_required_field');
    expect(issues[0]?.field).toBe('plate');
  });

  it('um VIN completo não substitui a matrícula', () => {
    // O VIN é a chave de deduplicação mais forte quando existe (§8.4), mas continua a ser
    // um campo **complementar** na regra de entrada. Substituí-lo aqui tornaria a regra
    // dependente de um dado que o utilizador não tem à mão (A14).
    const withVin = record('vehicle', 'veh_1', {
      fields: { plate: null, vin: 'VF1RFB00912345678' },
      replaceFields: true,
    });
    expect(missingRequiredFieldIssues(withVin)).toHaveLength(1);
    expect(validateRecords([withVin]).records[0]?.quality).toBe('quarantined');
  });

  it('uma matrícula vazia não contorna o campo obrigatório (§5.3)', () => {
    // `""` é um valor, não a ausência dele — mas para efeitos de obrigatoriedade conta
    // como ausente. Sem isto, uma matrícula vazia passaria a validação e só falharia na
    // escrita, longe da causa.
    const cases: Array<Record<string, unknown>> = [{ plate: '' }, { plate: null }, { plate: undefined }, {}];

    for (const fields of cases) {
      const issues = missingRequiredFieldIssues(record('vehicle', 'veh_1', { fields, replaceFields: true }));
      expect(issues, `campos: ${JSON.stringify(fields)}`).toHaveLength(1);
      expect(issues[0]?.field).toBe('plate');
    }
  });

  it('uma matrícula curta é aceite: a regra é de presença, não de forma', () => {
    // A forma da matrícula pertence a `vehiclePlausibilityIssues`, que é **informativa** e
    // não bloqueia. Se a obrigatoriedade julgasse também a forma, uma matrícula curta
    // legítima ficaria em quarentena — e o relatório perderia utilidade no caso mais comum.
    const short = record('vehicle', 'veh_1', { fields: { plate: 'AB1' }, replaceFields: true });
    expect(missingRequiredFieldIssues(short)).toHaveLength(0);
    expect(vehiclePlausibilityIssues(short)[0]?.severity).toBe('info');
  });

  it('a matrícula ausente mantém a semântica bloqueante em validateRecords', () => {
    const result = validateRecords([
      record('vehicle', 'veh_1', { fields: { plate: null }, replaceFields: true }),
    ]);
    const veh = result.records[0];

    expect(veh?.quality).toBe('quarantined');
    expect(veh?.issues.some((item) => item.code === 'record.missing_required_field')).toBe(true);
    expect(result.blocked).toBe(true);
  });

  it('o aviso informativo de plausibilidade continua a acompanhar a matrícula ausente', () => {
    // As duas verificações coexistem: a obrigatoriedade põe o registo em quarentena e a
    // plausibilidade continua a descrever a forma do valor. O aviso informativo nunca é
    // a última palavra, mas também não é suprimido.
    const missing = record('vehicle', 'veh_1', { fields: { plate: null }, replaceFields: true });
    expect(vehiclePlausibilityIssues(missing)[0]?.code).toBe('vehicle.plate_missing_or_short');
    expect(vehiclePlausibilityIssues(missing)[0]?.severity).toBe('info');
  });
});

describe('Problemas semânticos — recuperáveis, nunca bloqueantes (§9.1)', () => {
  it('assinala um valor negativo sem o recusar', () => {
    const issues = semanticIssues(record('expense', 'exp_1', { fields: { amountCents: -1200 } }));
    expect(issues[0]?.severity).toBe('recoverable');
    expect(issues[0]?.code).toBe('record.negative_amount');
  });

  it('assinala litros não positivos', () => {
    const issues = semanticIssues(record('fuel', 'fuel_1', { fields: { litres: 0 } }));
    expect(issues.some((item) => item.code === 'record.non_positive_litres')).toBe(true);
  });

  it('assinala energia não positiva num carregamento', () => {
    const issues = semanticIssues(record('charging', 'chg_1', { fields: { energyKwh: -1 } }));
    expect(issues.some((item) => item.code === 'record.non_positive_energy')).toBe(true);
  });

  it('assinala uma data que não é interpretável', () => {
    const issues = semanticIssues(record('expense', 'exp_1', { fields: { date: 'ontem' } }));
    expect(issues.some((item) => item.code === 'record.unparseable_date')).toBe(true);
  });

  it('assinala uma data que não existe no calendário', () => {
    const issues = semanticIssues(record('expense', 'exp_1', { fields: { date: '2026-02-30' } }));
    expect(issues.some((item) => item.code === 'record.unparseable_date')).toBe(true);
  });

  it('não assinala nada num registo saudável', () => {
    expect(semanticIssues(record('expense', 'exp_1'))).toHaveLength(0);
  });

  it('aceita uma data futura sem a marcar como erro', () => {
    // Um seguro que começa para o mês que vem é legítimo.
    expect(semanticIssues(record('insurance', 'ins_1', { fields: { startDate: '2030-01-01' } }))).toHaveLength(0);
  });
});

describe('Documento sem ficheiro (§5.6, decisão 2)', () => {
  it('NÃO bloqueia um documento sem conteúdo, mas declara-o', () => {
    // A decisão explícita: a lacuna não pode ficar escondida. O registo entra, e o
    // relatório nomeia-o para o utilizador saber o que recuperar mais tarde.
    const issues = documentContentIssues(record('document', 'doc_1', { fields: { contentState: 'missingContent' } }));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('recoverable');
    expect(issues[0]?.code).toBe('document.content_missing');
    expect(issues[0]?.localId).toBe('doc_1');
  });

  it('aceita um documento com conteúdo incluído e caminho declarado', () => {
    const issues = documentContentIssues(
      record('document', 'doc_1', {
        fields: {
          contentState: 'included',
          contentPath: 'documents/doc_1/fatura.pdf',
          contentSha256: 'a'.repeat(64),
        },
      }),
    );
    expect(issues).toHaveLength(0);
  });

  it('bloqueia um documento que afirma trazer o ficheiro mas não o identifica', () => {
    // Contradição interna: o bundle afirma ter os bytes e não diz onde estão nem como os
    // verificar.
    const issues = documentContentIssues(
      record('document', 'doc_1', { fields: { contentState: 'included' } }),
    );
    expect(issues[0]?.severity).toBe('blocking');
    expect(issues[0]?.code).toBe('document.content_path_missing');
  });

  it('produz a mensagem em linguagem de utilizador, não um código técnico', () => {
    const issues = documentContentIssues(record('document', 'doc_1', { fields: { contentState: 'missingContent' } }));
    expect(issues[0]?.message).toMatch(/adicioná-lo mais tarde/i);
  });

  it('não se aplica a registos que não são documentos', () => {
    expect(documentContentIssues(record('expense', 'exp_1'))).toHaveLength(0);
  });
});

/* ========================================================================== */
/* 9. Validação de conjunto e qualidade (§9.2, §9.4)                           */
/* ========================================================================== */

describe('validateRecords — bloqueio do bundle (§9.4)', () => {
  it('não bloqueia um bundle consistente', () => {
    const result = validateRecords([
      record('vehicle', 'veh_1'),
      record('expense', 'exp_1', { references: { vehicleLocalId: 'veh_1' } }),
    ]);
    expect(result.blocked).toBe(false);
  });

  it('bloqueia o bundle inteiro quando existe uma referência quebrada', () => {
    // §9.4: importar parcialmente produziria dados criados sem o utilizador saber que
    // faltam outros. A degradação silenciosa é o que nunca pode acontecer.
    const result = validateRecords([
      record('vehicle', 'veh_1'),
      record('expense', 'exp_1', { references: { vehicleLocalId: 'veh_999' } }),
    ]);
    expect(result.blocked).toBe(true);
    expect(result.issues.some((item) => item.code === 'bundle.broken_reference')).toBe(true);
  });

  it('bloqueia quando há localId duplicados, mesmo sem outros problemas', () => {
    const result = validateRecords([record('vehicle', 'veh_1'), record('vehicle', 'veh_1')]);
    expect(result.blocked).toBe(true);
  });

  it('reporta em conjunto todos os problemas, não só o primeiro', () => {
    // O utilizador tem de saber as duas coisas antes de decidir — não descobrir a
    // segunda depois de resolver a primeira.
    const result = validateRecords([
      record('vehicle', 'veh_1'),
      record('expense', 'exp_1', {
        fields: { amountCents: null },
        references: { vehicleLocalId: 'veh_999' },
      }),
    ]);
    const codes = result.issues.map((item) => item.code);
    expect(codes).toContain('record.missing_required_field');
    expect(codes).toContain('bundle.broken_reference');
  });

  it('reporta em conjunto a falta de matrícula e a referência quebrada', () => {
    // O mesmo cenário com as duas regras bloqueantes que a A25 separa: o veículo sem
    // matrícula não é importável, **e** a despesa aponta para um veículo que não existe.
    // O relatório tem de trazer as duas — resolvida a primeira, o utilizador não pode
    // descobrir a segunda só então.
    const result = validateRecords([
      record('vehicle', 'veh_1', { fields: { plate: null } }),
      record('expense', 'exp_1', {
        fields: { amountCents: 1000, date: '2026-01-15', category: 'Portagens' },
        references: { vehicleLocalId: 'veh_999' },
      }),
    ]);

    const codes = result.issues.map((item) => item.code);
    expect(codes).toContain('record.missing_required_field');
    expect(codes).toContain('bundle.broken_reference');

    const veh = result.records.find((entry) => entry.record.localId === 'veh_1');
    expect(veh?.quality).toBe('quarantined');
  });

  it('atribui qualidade a cada registo', () => {
    const result = validateRecords([
      record('vehicle', 'veh_1'),
      record('expense', 'exp_2', { fields: { amountCents: -100 } }),
    ]);
    const healthy = result.records.find((entry) => entry.record.localId === 'veh_1');
    const partial = result.records.find((entry) => entry.record.localId === 'exp_2');
    expect(healthy?.quality).toBe('complete');
    expect(partial?.quality).toBe('partial');
  });
});

describe('qualityFrom (§9.2)', () => {
  it('é complete sem problemas', () => {
    expect(qualityFrom([])).toBe('complete');
  });

  it('é partial com um problema recuperável — entra com a lacuna declarada', () => {
    expect(qualityFrom([recoverable('x', 'y')])).toBe('partial');
  });

  it('é quarantined com um problema bloqueante', () => {
    expect(qualityFrom([blocking('x', 'y')])).toBe('quarantined');
  });

  it('um bloqueante domina um recuperável', () => {
    expect(qualityFrom([recoverable('a', 'b'), blocking('c', 'd')])).toBe('quarantined');
  });

  it('um informativo não degrada a qualidade', () => {
    // Um campo desconhecido ignorado, ou uma data convertida, não alteram o resultado.
    expect(qualityFrom([informational('x', 'y')])).toBe('complete');
  });
});

describe('summarizeIssues (§9.2)', () => {
  it('conta por gravidade e por código', () => {
    const summary = summarizeIssues([
      blocking('a', 'x'),
      blocking('a', 'y'),
      recoverable('b', 'z'),
      informational('c', 'w'),
    ]);
    expect(summary.blocking).toBe(2);
    expect(summary.recoverable).toBe(1);
    expect(summary.info).toBe(1);
    // Agrupar por código é o que permite dizer "412 registos com data ilegível" em vez de
    // listar 412 mensagens iguais.
    expect(summary.byCode.a).toBe(2);
    expect(summary.byCode.b).toBe(1);
  });

  it('devolve zeros para uma lista vazia', () => {
    const summary = summarizeIssues([]);
    expect(summary.blocking).toBe(0);
    expect(summary.recoverable).toBe(0);
    expect(summary.info).toBe(0);
    expect(summary.byCode).toEqual({});
  });
});

/* ========================================================================== */
/* 10. Verificações informativas                                               */
/* ========================================================================== */

describe('localIdPrefixHint — informativo, nunca bloqueante (§2.1)', () => {
  it('não assinala um prefixo convencional', () => {
    expect(localIdPrefixHint(record('vehicle', 'veh_1'))).toBeNull();
  });

  it('assinala um prefixo inesperado como informativo', () => {
    // Instrução crítica: o formato do localId é opaco e o importador não o interpreta.
    // Um adaptador externo pode usar identificadores seus; isto serve para diagnosticar
    // um exportador nosso, não para julgar bundles alheios.
    const issue = localIdPrefixHint(record('vehicle', 'carro-1'));
    expect(issue?.severity).toBe('info');
  });

  it('nunca classifica um prefixo inválido como bloqueante', () => {
    const issue = localIdPrefixHint(record('expense', 'anything_at_all'));
    expect(issue?.severity).not.toBe('blocking');
  });
});

describe('vehiclePlausibilityIssues (§49)', () => {
  it('assinala uma matrícula ausente como informativo, não como problema', () => {
    // Uma matrícula curta ou ausente é a norma num onboarding por completar. Tratá-la
    // como problema tornaria o relatório inútil no caso mais comum.
    const issues = vehiclePlausibilityIssues(record('vehicle', 'veh_1', { fields: { plate: '' } }));
    expect(issues[0]?.severity).toBe('info');
  });

  it('não assinala um veículo com matrícula utilizável', () => {
    expect(vehiclePlausibilityIssues(record('vehicle', 'veh_1'))).toHaveLength(0);
  });

  it('não se aplica a registos que não são veículos', () => {
    expect(vehiclePlausibilityIssues(record('expense', 'exp_1'))).toHaveLength(0);
  });
});
