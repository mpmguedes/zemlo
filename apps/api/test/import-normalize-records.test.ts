/**
 * Testes do Normalizer — `normalize-records.ts` (§4.1, A27).
 *
 * ## O que estes testes cobrem, e porque é que faltava
 *
 * Até aqui cada metade da cadeia estava testada contra o seu próprio contrato: os testes
 * da Fase 3 verificavam que o Parser **não interpreta** campos, e os testes da Fase 1
 * verificavam que o Validator e o Planner consomem `CanonicalRecord`. **O contrato entre
 * as duas metades nunca foi exercido** — e foi por isso que as três lacunas do A27
 * (referências em dois locais, `storageKey` inexistente, `tax.kind` não formalizado)
 * passaram por todos os testes existentes sem serem vistas.
 *
 * A classe de defeito que aqui se testa é a mais silenciosa de todas: um campo do bundle
 * que **não chega** ao domínio. Não dá erro — a chave de deduplicação fica só com parte
 * dos componentes, a comparação passa a coincidir por acidente, e o resultado é histórico
 * misturado. Nada falha; os dados é que ficam errados.
 *
 * Por isso o teste central deste ficheiro não é "o mapeamento copia campos". É:
 *
 * > **cada campo que o `dedupeKeysFor` lê tem de existir no `CanonicalRecord` produzido
 * > a partir de um registo cru**, para todos os tipos que participam na deduplicação.
 *
 * Essa propriedade é verificada por um teste de contrato que percorre os catorze tipos —
 * e é ela que falharia no futuro se alguém acrescentasse um campo a uma chave de
 * deduplicação sem o acrescentar ao mapa do Normalizer.
 *
 * ## Sem base de dados
 *
 * O Normalizer é puro, e é isso que este ficheiro prova ao não levantar base de dados
 * nenhuma. A base de dados real só é necessária a partir do `apply.ts` — para o rollback,
 * a atomicidade e as constraints — e é lá que ela entra.
 */

import { describe, expect, it } from 'vitest';

import { normalizeRecords } from '../src/domain/import/normalize-records.js';
import { dedupeKeysFor } from '../src/domain/import/plan.js';
import { validateRecords } from '../src/domain/import/validate.js';
import type { RawBundleRecord } from '../src/domain/import/bundle.js';
import type { CanonicalRecord, RecordKind } from '../src/domain/import/validate.js';

/* -------------------------------------------------------------------------- */
/* Utilitários                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Constrói um registo cru como o Parser o entregaria.
 *
 * Note-se que `localId` vai **dentro de `fields`**, não num campo à parte: o
 * `RawBundleRecord` tem `kind`, `file`, `line` e `fields`, e o Parser não interpreta o
 * conteúdo — o `localId` é uma chave do objeto JSON como outra qualquer. É o Normalizer
 * que o promove a campo do canónico.
 */
function raw(
  kind: string,
  fields: Record<string, unknown>,
  overrides: Partial<RawBundleRecord> = {},
): RawBundleRecord {
  return {
    kind,
    file: overrides.file ?? `${kind}.jsonl`,
    line: overrides.line ?? 1,
    fields,
  };
}

/**
 * Como `raw`, mas garante um `localId` dentro de `fields`.
 *
 * A maioria dos testes não se interessa pelo `localId` e escrever `localId: 'x'` em cada
 * caso seria ruído. Quando existe um `localId` explícito nos campos, é respeitado; caso
 * contrário é derivado do tipo.
 */
function rawWithId(
  kind: string,
  fields: Record<string, unknown>,
  localId = `${kind}_1`,
): RawBundleRecord {
  return raw(kind, { localId, ...fields });
}

/**
 * Normaliza um só registo e devolve o canónico — o caso de uso mais comum aqui.
 *
 * Injeta um `localId` se os campos não trouxerem um, porque um registo sem `localId`
 * é inválido e quase todos estes testes só se interessam pelo mapeamento dos campos.
 */
function one(kind: string, fields: Record<string, unknown>): CanonicalRecord {
  const withId = fields.localId === undefined ? { localId: `${kind}_1`, ...fields } : fields;
  const result = normalizeRecords([raw(kind, withId)]);
  expect(result.records).toHaveLength(1);
  return result.records[0] as CanonicalRecord;
}

/**
 * Um registo **válido e mínimo** por tipo, com todos os campos que as chaves de
 * deduplicação leem preenchidos.
 *
 * É a base do teste de contrato: se um campo desaparecer do mapa, a chave
 * correspondente deixa de ser construída e o teste falha — que é exactamente o que se
 * quer detetar.
 */
const MINIMUM_RECORDS: Readonly<Record<string, Record<string, unknown>>> = {
  vehicle: { plate: 'AA-00-BB', plateDisplay: 'AA-00-BB', vin: 'WVWZZZ1JZXW000001', make: 'Kia', model: 'EV3', year: 2025 },
  odometer: { vehicleLocalId: 'veh_1', recordedAt: '2026-02-10', odometerKm: 15_000 },
  expense: {
    vehicleLocalId: 'veh_1',
    date: '2026-02-10',
    amountCents: 4_210,
    category: 'toll',
    vendor: 'Via Verde',
    description: 'Portagem A1',
  },
  fuel: { vehicleLocalId: 'veh_1', date: '2026-02-10', litres: 42.35, amountCents: 7_000, odometerKm: 15_000 },
  charging: { vehicleLocalId: 'veh_1', date: '2026-02-10', energyKwh: 30.5, amountCents: 1_200, odometerKm: 15_000 },
  maintenance: { vehicleLocalId: 'veh_1', date: '2026-02-10', type: 'oil', amountCents: 8_000, odometerKm: 15_000 },
  insurance: { vehicleLocalId: 'veh_1', insurer: 'Fidelidade', startDate: '2026-01-01', endDate: '2026-12-31', premiumCents: 30_000 },
  inspection: { vehicleLocalId: 'veh_1', date: '2026-02-10', result: 'pass', amountCents: 3_000, odometerKm: 15_000 },
  tax: { vehicleLocalId: 'veh_1', kind: 'iuc', year: 2026, amountCents: 15_000 },
  document: { vehicleLocalId: 'veh_1', name: 'Seguro', category: 'insurance', expiresAt: '2026-12-31', contentState: 'included', contentSha256: 'a'.repeat(64) },
  reminder: { vehicleLocalId: 'veh_1', title: 'Mudar óleo', dueDate: '2026-03-01', dueOdometerKm: 20_000 },
  event: { vehicleLocalId: 'veh_1', type: 'note', date: '2026-02-10', title: 'Revisão feita' },
};

/**
 * Campos que `dedupeKeysFor` lê de `record.fields` ou de `record.references`, por tipo.
 *
 * Escrito à mão a partir da leitura do `plan.ts` — e é isso que lhe dá valor: é uma
 * segunda expressão independente do mesmo contrato, e é a divergência entre as duas que
 * se quer apanhar. Um teste que lesse esta lista do próprio `plan.ts` não verificaria
 * nada.
 */
const FIELDS_REQUIRED_BY_DEDUPE: Readonly<Record<string, readonly string[]>> = {
  vehicle: ['plate', 'vin', 'make', 'model', 'year'],
  odometer: ['recordedAt', 'odometerKm'],
  expense: ['date', 'amountCents', 'category', 'vendor', 'description'],
  fuel: ['date', 'litres', 'odometerKm', 'amountCents'],
  charging: ['date', 'energyKwh', 'odometerKm'],
  maintenance: ['date', 'type', 'amountCents', 'odometerKm'],
  insurance: ['startDate', 'insurer', 'premiumCents'],
  inspection: ['date', 'result', 'amountCents', 'odometerKm'],
  tax: ['kind', 'year', 'amountCents'],
  document: ['name', 'expiresAt', 'contentSha256', 'storageKey'],
  reminder: ['title', 'dueDate', 'dueOdometerKm'],
  event: ['type', 'date', 'title'],
};

/** Tipos que participam na deduplicação por conteúdo (§8.4). */
const DEDUPE_KINDS = Object.keys(FIELDS_REQUIRED_BY_DEDUPE);

/* -------------------------------------------------------------------------- */
/* 1. Contrato — forma do resultado                                            */
/* -------------------------------------------------------------------------- */

describe('normalize-records: forma do resultado', () => {
  it('devolve os registos e o relatório de campos por mapear', () => {
    const result = normalizeRecords([raw('vehicle', { plate: 'AA-00-BB' })]);

    expect(result).toHaveProperty('records');
    expect(result).toHaveProperty('unmappedFields');
    expect(Array.isArray(result.records)).toBe(true);
  });

  it('preserva a ordem de entrada', () => {
    const result = normalizeRecords([
      raw('vehicle', { plate: 'AA-00-BB' }, { line: 1 }),
      raw('vehicle', { plate: 'CC-11-DD' }, { line: 2 }),
      raw('vehicle', { plate: 'EE-22-FF' }, { line: 3 }),
    ]);

    expect(result.records.map((r) => r.fields.plate)).toEqual(['AA00BB', 'CC11DD', 'EE22FF']);
  });

  it('preserva file e line, para um problema apontar à linha certa', () => {
    const record = one('expense', { date: '2026-02-10', amountCents: 100, category: 'toll' });

    expect(record.file).toBe('expense.jsonl');
    expect(record.line).toBe(1);
  });

  it('não interpreta o localId — copia-o tal como veio (§2.1)', () => {
    const record = one('vehicle', { localId: 'veh_1', plate: 'AA-00-BB' });
    expect(record.localId).toBe('veh_1');
  });

  it('um lote vazio produz um resultado vazio, não um erro', () => {
    const result = normalizeRecords([]);
    expect(result.records).toEqual([]);
    expect(result.unmappedFields).toEqual({});
  });

  it('é puro — a mesma entrada produz a mesma saída', () => {
    const input = [raw('fuel', { vehicleLocalId: 'veh_1', date: '2026-02-10', litres: 42.35, amountCents: 7_000 })];

    const first = normalizeRecords(input);
    const second = normalizeRecords(input);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('não modifica o registo cru de entrada', () => {
    const fields = { plate: 'AA-00-BB', plateDisplay: 'AA-00-BB' };
    const input = raw('vehicle', fields);
    const before = JSON.stringify(input);

    normalizeRecords([input]);

    expect(JSON.stringify(input)).toBe(before);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. O teste central — os campos que a deduplicação lê                       */
/* -------------------------------------------------------------------------- */

describe('normalize-records: contrato com a deduplicação (A27)', () => {
  /*
   * Este é o teste que teria apanhado as três lacunas do A27. Ele pergunta, para cada
   * tipo que participa na deduplicação: **os campos que o `dedupeKeysFor` procura existem
   * no canónico produzido a partir de um registo cru?**
   *
   * `undefined` é o valor que se procura, e não a ausência da chave: o `plan.ts` lê
   * `f.date as string | null` e recebe `undefined` se a chave não existir. Ambos os casos
   * produzem a mesma chave degenerada, pelo que o teste verifica o **valor**, não a
   * presença da chave.
   */
  for (const kind of DEDUPE_KINDS) {
    it(`«${kind}»: os campos lidos pela deduplicação chegam ao canónico`, () => {
      const source = MINIMUM_RECORDS[kind];
      expect(source, `falta o registo mínimo para «${kind}»`).toBeDefined();

      const record = one(kind, source as Record<string, unknown>);
      const required = FIELDS_REQUIRED_BY_DEDUPE[kind] as readonly string[];

      for (const field of required) {
        /*
         * `storageKey` é a excepção declarada em A27: o bundle v1 não o transporta e não
         * se inventa. A sua ausência é o comportamento correto, e é verificada em
         * separado mais abaixo.
         */
        if (field === 'storageKey') continue;

        expect(
          record.fields[field],
          `o campo «${field}» de «${kind}» não chegou ao CanonicalRecord`,
        ).toBeDefined();
      }
    });

    it(`«${kind}»: a deduplicação produz pelo menos uma chave utilizável`, () => {
      const record = one(kind, MINIMUM_RECORDS[kind] as Record<string, unknown>);
      const keys = dedupeKeysFor(record);

      expect(keys.length, `«${kind}» não produziu chave nenhuma`).toBeGreaterThan(0);
      for (const key of keys) {
        expect(key.value).not.toBeNull();
        expect(typeof key.value).toBe('string');
        expect((key.value as string).length).toBeGreaterThan(0);
      }
    });

    it(`«${kind}»: a referência ao veículo chega a references e a fields`, () => {
      const source = MINIMUM_RECORDS[kind] as Record<string, unknown>;
      if (source.vehicleLocalId === undefined) return;

      const record = one(kind, source);

      expect(record.references.vehicleLocalId).toBe('veh_1');
      /*
       * E também em `fields` — é a regra central de A27. O `dedupe-keys.ts` procura
       * `vehicleLocalId` nos `fields` para o incluir no valor da chave. Sem isto, duas
       * despesas de veículos diferentes com o mesmo dia e valor coincidiriam.
       */
      expect(record.fields.vehicleLocalId).toBe('veh_1');
    });
  }

  it('sem vehicleLocalId em fields, a chave de despesa perderia o veículo', () => {
    /*
     * Demonstração negativa do defeito que A27 evita. Duas despesas com o mesmo dia e o
     * mesmo valor mas **veículos diferentes** têm de produzir chaves com valores
     * diferentes — se o veículo não entrasse na composição, coincidiriam.
     */
    const a = one('expense', {
      vehicleLocalId: 'veh_1', date: '2026-02-10', amountCents: 4_210, category: 'toll',
    });
    const b = one('expense', {
      vehicleLocalId: 'veh_2', date: '2026-02-10', amountCents: 4_210, category: 'toll',
    });

    const keysA = dedupeKeysFor(a).map((k) => k.value);
    const keysB = dedupeKeysFor(b).map((k) => k.value);

    expect(keysA).not.toEqual(keysB);
    for (const value of keysA) {
      expect(keysB).not.toContain(value);
    }
  });

  it('as referências conhecidas vão para references, não só para fields', () => {
    const record = one('event', {
      vehicleLocalId: 'veh_1', recordLocalId: 'mnt_9', type: 'note', date: '2026-02-10', title: 'Serviço',
    });

    expect(record.references.vehicleLocalId).toBe('veh_1');
    expect(record.references.recordLocalId).toBe('mnt_9');
  });

  it('uma referência ausente não aparece em references', () => {
    const record = one('document', { name: 'Carta', category: 'license', contentState: 'included' });

    expect(record.references.vehicleLocalId).toBeUndefined();
    expect(Object.keys(record.references)).not.toContain('vehicleLocalId');
  });

  it('storageKey não é inventado nem derivado de outro campo (A27)', () => {
    /*
     * A regra explícita: `contentPath`, `fileName` e `contentSha256` **não** são
     * substitutos de `storageKey`. Usá-los como se fossem criaria uma coincidência falsa
     * entre documentos distintos que partilham nome de ficheiro.
     */
    const record = one('document', {
      name: 'Seguro',
      category: 'insurance',
      fileName: 'seguro.pdf',
      contentPath: 'documents/doc_1/seguro.pdf',
      contentSha256: 'a'.repeat(64),
      contentState: 'included',
    });

    expect(record.fields.storageKey).toBeUndefined();
    expect(record.fields.contentPath).toBe('documents/doc_1/seguro.pdf');
    expect(record.fields.contentSha256).toBe('a'.repeat(64));
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Mapeamento por tipo — campos concretos                                   */
/* -------------------------------------------------------------------------- */

describe('normalize-records: mapeamento de veículo', () => {
  it('normaliza a matrícula para a forma comparável', () => {
    const record = one('vehicle', { plate: 'aa-00-bb', plateDisplay: 'AA-00-BB' });
    expect(record.fields.plate).toBe('AA00BB');
  });

  it('preenche plateDisplay a partir de plate quando o bundle o omite', () => {
    const record = one('vehicle', { plate: 'AA-00-BB' });
    expect(record.fields.plate).toBe('AA00BB');
    expect(record.fields.plateDisplay).toBe('AA-00-BB');
  });

  it('preenche plate a partir de plateDisplay quando o bundle o omite', () => {
    const record = one('vehicle', { plateDisplay: 'CC-11-DD' });
    expect(record.fields.plate).toBe('CC11DD');
    expect(record.fields.plateDisplay).toBe('CC-11-DD');
  });

  it('transporta os campos opcionais avançados quando presentes', () => {
    const record = one('vehicle', {
      plate: 'AA-00-BB', plateDisplay: 'AA-00-BB', vin: 'WVWZZZ1JZXW000001',
      make: 'Kia', model: 'EV3', year: 2025, vehicleType: 'car', fuelType: 'electric', color: 'branco',
    });

    expect(record.fields.vin).toBe('WVWZZZ1JZXW000001');
    expect(record.fields.make).toBe('Kia');
    expect(record.fields.year).toBe(2025);
    expect(record.fields.fuelType).toBe('electric');
  });

  it('um veículo sem matrícula mapeia na mesma — a validação é do Validator', () => {
    const record = one('vehicle', { make: 'Kia', model: 'EV3' });

    expect(record.fields.make).toBe('Kia');
    expect(record.fields.plate).toBeUndefined();

    // E o Validator é quem o põe em quarentena, com o motivo certo (A25).
    const validation = validateRecords([record]);
    expect(validation.records[0]?.quality).toBe('quarantined');
    expect(validation.issues.some((i) => i.code === 'record.missing_required_field')).toBe(true);
  });
});

describe('normalize-records: mapeamento de despesa', () => {
  it('transporta os campos da chave forte — categoria, fornecedor e descrição', () => {
    const record = one('expense', {
      vehicleLocalId: 'veh_1', date: '2026-02-10', amountCents: 4_210,
      category: 'toll', vendor: 'Via Verde', description: 'Portagem A1',
    });

    expect(record.fields.date).toBe('2026-02-10');
    expect(record.fields.amountCents).toBe(4_210);
    expect(record.fields.category).toBe('toll');
    expect(record.fields.vendor).toBe('Via Verde');
    expect(record.fields.description).toBe('Portagem A1');
  });

  it('transporta a ligação a outro registo em ambos os locais', () => {
    const record = one('expense', {
      vehicleLocalId: 'veh_1', date: '2026-02-10', amountCents: 8_000,
      category: 'maintenance', linkedRecordLocalId: 'mnt_4',
    });

    expect(record.references.linkedRecordLocalId).toBe('mnt_4');
    expect(record.fields.linkedRecordLocalId).toBe('mnt_4');
  });

  it('preserva paid e paymentMethod', () => {
    const record = one('expense', {
      date: '2026-02-10', amountCents: 100, category: 'toll', paid: false, paymentMethod: 'cash',
    });

    expect(record.fields.paid).toBe(false);
    expect(record.fields.paymentMethod).toBe('cash');
  });
});

describe('normalize-records: mapeamento de odómetro', () => {
  it('transporta recordedAt e odometerKm — a chave exata', () => {
    const record = one('odometer', { vehicleLocalId: 'veh_1', recordedAt: '2026-02-10', odometerKm: 15_000 });

    expect(record.fields.recordedAt).toBe('2026-02-10');
    expect(record.fields.odometerKm).toBe(15_000);
  });

  it('transporta isCorrection, que o modelo guarda', () => {
    const record = one('odometer', {
      vehicleLocalId: 'veh_1', recordedAt: '2026-02-10', odometerKm: 14_900, isCorrection: true,
    });

    expect(record.fields.isCorrection).toBe(true);
  });
});

describe('normalize-records: mapeamento de impostos (A27)', () => {
  it('transporta kind, que a chave year+kind exige', () => {
    const record = one('tax', { vehicleLocalId: 'veh_1', kind: 'iuc', year: 2026, amountCents: 15_000 });

    expect(record.fields.kind).toBe('iuc');
    expect(record.fields.year).toBe(2026);
  });

  it('a chave year+kind é exata e distingue tipos diferentes', () => {
    const iuc = one('tax', { vehicleLocalId: 'veh_1', kind: 'iuc', year: 2026, amountCents: 15_000 });
    const imi = one('tax', { vehicleLocalId: 'veh_1', kind: 'imi', year: 2026, amountCents: 15_000 });

    const keysIuc = dedupeKeysFor(iuc);
    const keysImi = dedupeKeysFor(imi);

    const strong = keysIuc.find((k) => k.kind === 'year+kind');
    expect(strong?.level).toBe('exact');
    expect(keysIuc.map((k) => k.value)).not.toEqual(keysImi.map((k) => k.value));
  });

  it('um imposto sem kind produz uma chave degenerada — risco registado, não corrigido nesta fase', () => {
    /*
     * ## O que se descobriu, e porque é que este teste documenta o problema em vez de o resolver
     *
     * O `normalizeTextForCompare` devolve `''` (string vazia) para uma entrada ausente,
     * **não** `null`. O `compose` recusa construir uma chave quando uma parte é `null` ou
     * `undefined` — é essa a guarda que impede um falso "certo" — mas a string vazia passa
     * a guarda.
     *
     * Resultado: um imposto sem `kind` produz `year+kind` com o valor
     * `"veh_1|2026|"` — não é nulo, e portanto é uma chave **utilizável**. Dois impostos
     * do mesmo veículo e do mesmo ano, ambos com o `kind` em falta, **coincidem** nessa
     * chave; e como ela é declarada `exact`, a classificação é "duplicado certo" e um
     * deles é ignorado em silêncio.
     *
     * ## Porque é que não se corrige aqui
     *
     * A correção certa é no `dedupe-keys.ts` (tratar texto vazio como parte ausente) ou no
     * `normalizeTextForCompare` (devolver `null` em vez de `''`). Ambos são domínio já
     * testado, e a instrução desta fase é explícita: **não alterar `plan.ts` nem
     * `dedupe-keys.ts`**. Alterá-los agora para acomodar o Normalizer inverteria a ordem
     * das alterações e mexeria em código cujo comportamento está fixado por 529 testes.
     *
     * ## O que o Normalizer faz, e porque é que é a resposta certa
     *
     * O `zBundleTax` (acrescentado em A27) exige `kind` **não vazio**. Um bundle conforme
     * ao contrato nunca produz este caso: `kind` está lá. O caminho degenerado só é
     * alcançável por um bundle que viole o contrato — e para esse, a proteção é a
     * validação do manifest, não uma heurística no mapeamento.
     *
     * Este teste existe para que a próxima pessoa que mexer em `taxKeys` encontre o caso
     * escrito, com o exemplo que o demonstra, em vez de o descobrir por acidente.
     */
    const record = one('tax', { vehicleLocalId: 'veh_1', year: 2026, amountCents: 15_000 });

    expect(record.fields.kind).toBeUndefined();

    const keys = dedupeKeysFor(record);
    const strong = keys.find((k) => k.kind === 'year+kind');

    // A chave existe e é utilizável — o defeito descrito acima.
    expect(strong).toBeDefined();
    expect(strong?.level).toBe('exact');
    expect(strong?.value).toBe('veh_1|2026|');

    /*
     * A demonstração do risco: dois impostos sem `kind`, de tipos diferentes na realidade,
     * coincidem. Se o `kind` fosse derivado de `year` — como A27 proíbe — o resultado seria
     * o mesmo. É precisamente por isso que a formalização de `kind` no contrato é a
     * proteção, e não a derivação.
     */
    const outro = one('tax', { localId: 'tax_2', vehicleLocalId: 'veh_1', year: 2026, amountCents: 99 });
    const outraStrong = dedupeKeysFor(outro).find((k) => k.kind === 'year+kind');

    expect(outraStrong?.value).toBe(strong?.value);
  });
});

describe('normalize-records: mapeamento de documentos', () => {
  it('transporta o estado do conteúdo, para o missingContent ser representável', () => {
    const record = one('document', {
      name: 'Seguro', category: 'insurance', contentState: 'missingContent',
    });

    expect(record.fields.contentState).toBe('missingContent');
    expect(record.fields.contentSha256).toBeUndefined();
  });

  it('transporta contentSha256 quando os bytes vieram — a chave mais forte', () => {
    const hash = 'b'.repeat(64);
    const record = one('document', {
      name: 'Seguro', category: 'insurance', contentState: 'included', contentSha256: hash,
    });

    expect(record.fields.contentSha256).toBe(hash);
    expect(dedupeKeysFor(record).some((k) => k.kind === 'contentSha256' && k.level === 'exact')).toBe(true);
  });

  it('um documento sem veículo é válido — não inventa a referência', () => {
    /*
     * `contentState: 'included'` exige `contentPath` **e** `contentSha256` — o
     * `documentContentIssues` trata a sua ausência como contradição bloqueante, porque o
     * bundle afirma ter os bytes e não diz onde estão nem como verificá-los. O fixture
     * traz os dois, e o que este teste verifica é que **o veículo ausente não é
     * inventado**: uma carta de condução não pertence a veículo nenhum.
     */
    const record = one('document', {
      name: 'Carta de condução',
      category: 'license',
      contentState: 'included',
      contentPath: 'documents/doc_1/carta.pdf',
      contentSha256: 'c'.repeat(64),
    });

    expect(record.references.vehicleLocalId).toBeUndefined();
    expect(record.fields.vehicleLocalId).toBeUndefined();

    const validation = validateRecords([record]);
    expect(validation.blocked).toBe(false);
    expect(validation.records[0]?.quality).toBe('complete');
  });

  it('um documento sem bytes é representável como missingContent', () => {
    const record = one('document', {
      name: 'Carta de condução',
      category: 'license',
      contentState: 'missingContent',
    });

    const validation = validateRecords([record]);

    // Recuperável, não bloqueante: o documento entra e a lacuna é declarada (§5.6).
    expect(validation.blocked).toBe(false);
    expect(validation.records[0]?.quality).toBe('partial');
    expect(validation.issues.some((i) => i.code === 'document.content_missing')).toBe(true);
  });

  it('um documento «included» sem caminho nem hash é uma contradição detetada', () => {
    /*
     * Verificação do outro lado da regra, e a razão pela qual o fixture acima tem de
     * trazer os dois campos: o Validator recusa afirmar que tem bytes que não consegue
     * localizar nem verificar.
     */
    const record = one('document', { name: 'Seguro', category: 'insurance', contentState: 'included' });

    const validation = validateRecords([record]);
    expect(validation.blocked).toBe(true);
    expect(validation.issues.some((i) => i.code === 'document.content_path_missing')).toBe(true);
  });
});

describe('normalize-records: mapeamento de eventos e lembretes', () => {
  it('um evento sem registo associado mapeia na mesma', () => {
    const record = one('event', { vehicleLocalId: 'veh_1', type: 'note', date: '2026-02-10', title: 'Nota' });

    expect(record.references.recordLocalId).toBeUndefined();
    expect(record.fields.type).toBe('note');
  });

  it('um lembrete com data mapeia a condição de data', () => {
    const record = one('reminder', { vehicleLocalId: 'veh_1', title: 'Mudar óleo', dueDate: '2026-03-01' });

    expect(record.fields.dueDate).toBe('2026-03-01');
    expect(dedupeKeysFor(record).length).toBeGreaterThan(0);
  });

  it('um lembrete só com quilometragem mapeia a condição de km', () => {
    const record = one('reminder', { vehicleLocalId: 'veh_1', title: 'Pneus', dueOdometerKm: 40_000 });

    expect(record.fields.dueOdometerKm).toBe(40_000);
    expect(dedupeKeysFor(record).length).toBeGreaterThan(0);
  });
});

describe('normalize-records: tipos sem chave de deduplicação', () => {
  it('sugestões e notificações mapeiam mas não participam na deduplicação (decisão 5)', () => {
    const suggestion = one('suggestion', { key: 'sug_1', type: 'maintenance' });
    const notification = one('notification', { topic: 'reminder', title: 'Revisão', body: 'Em breve' });

    expect(suggestion.fields.key).toBe('sug_1');
    expect(notification.fields.title).toBe('Revisão');
    expect(dedupeKeysFor(suggestion)).toEqual([]);
    expect(dedupeKeysFor(notification)).toEqual([]);
  });

  it('um tipo desconhecido não rebenta — passa com os campos vazios', () => {
    const result = normalizeRecords([raw('inventado', { foo: 'bar' })]);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.fields).toEqual({});
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Campos por mapear — a lacuna é declarada, não silenciosa                */
/* -------------------------------------------------------------------------- */

describe('normalize-records: campos por reconhecer', () => {
  it('reporta um campo desconhecido em vez de o descartar em silêncio', () => {
    const result = normalizeRecords([
      raw('fuel', { vehicleLocalId: 'veh_1', date: '2026-02-10', litres: 42.35, amountCents: 7_000, campoNovo: 'x' }),
    ]);

    expect(result.unmappedFields.fuel).toContain('campoNovo');
  });

  it('agrega por tipo, sem repetir o mesmo campo', () => {
    const result = normalizeRecords([
      raw('fuel', { date: '2026-02-10', litres: 1, amountCents: 1, campoNovo: 'a' }, { line: 1 }),
      raw('fuel', { date: '2026-02-11', litres: 1, amountCents: 1, campoNovo: 'b' }, { line: 2 }),
    ]);

    expect(result.unmappedFields.fuel).toEqual(['campoNovo']);
  });

  it('não reporta os metadados comuns como campos por mapear', () => {
    const result = normalizeRecords([
      raw('vehicle', {
        localId: 'veh_1', plate: 'AA-00-BB', plateDisplay: 'AA-00-BB',
        source: { origem: 'manual' }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
      }),
    ]);

    expect(result.unmappedFields.vehicle).toBeUndefined();
  });

  it('não reporta as referências conhecidas como campos por mapear', () => {
    const result = normalizeRecords([
      raw('expense', {
        vehicleLocalId: 'veh_1', date: '2026-02-10', amountCents: 100, category: 'toll',
        linkedRecordLocalId: 'mnt_1',
      }),
    ]);

    expect(result.unmappedFields.expense).toBeUndefined();
  });

  it('um bundle inteiramente conhecido não produz aviso nenhum', () => {
    const result = normalizeRecords(
      Object.entries(MINIMUM_RECORDS).map(([kind, fields]) =>
        raw(kind, { localId: `${kind}_1`, ...fields }),
      ),
    );

    expect(result.unmappedFields).toEqual({});
  });
});

/* -------------------------------------------------------------------------- */
/* 5. externalIds — não se perdem, não se interpretam (§2.3)                   */
/* -------------------------------------------------------------------------- */

describe('normalize-records: externalIds', () => {
  it('transporta os externalIds para o canónico', () => {
    const record = one('vehicle', {
      plate: 'AA-00-BB',
      externalIds: [{ source: 'old-zemlo', id: 'abc-123' }],
    });

    expect(record.externalIds).toEqual([{ source: 'old-zemlo', id: 'abc-123' }]);
  });

  it('não interpreta nem resolve a identidade externa', () => {
    const record = one('vehicle', {
      plate: 'AA-00-BB',
      externalIds: [{ source: 'sistema-legado', id: 'XYZ' }],
    });

    // O valor passa tal como veio: a resolução é da Fase 4.
    expect(record.externalIds?.[0]).toEqual({ source: 'sistema-legado', id: 'XYZ' });
  });

  it('descarta um externalId malformado sem descartar o registo', () => {
    const record = one('vehicle', {
      plate: 'AA-00-BB',
      externalIds: [{ source: 'ok', id: '1' }, { source: 'sem-id' }, { id: 'sem-source' }, 'lixo', null],
    });

    expect(record.externalIds).toEqual([{ source: 'ok', id: '1' }]);
    expect(record.fields.plate).toBe('AA00BB');
  });

  it('a ausência de externalIds não produz a chave', () => {
    const record = one('vehicle', { plate: 'AA-00-BB' });
    expect(record.externalIds).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* 6. Robustez — o bundle é JSON não fidedigno                                 */
/* -------------------------------------------------------------------------- */

describe('normalize-records: valores com tipo errado', () => {
  it('um número que chega como string não é aceite como número', () => {
    const record = one('fuel', {
      vehicleLocalId: 'veh_1', date: '2026-02-10', litres: '42.35', amountCents: '7000',
    });

    expect(record.fields.litres).toBeUndefined();
    expect(record.fields.amountCents).toBeUndefined();
    // A data, essa, é uma string e passa.
    expect(record.fields.date).toBe('2026-02-10');
  });

  it('um booleano que chega como string não é aceite como booleano', () => {
    const record = one('fuel', {
      date: '2026-02-10', litres: 1, amountCents: 1, fullTank: 'true',
    });

    expect(record.fields.fullTank).toBeUndefined();
  });

  it('NaN e Infinity não passam como números', () => {
    const record = one('odometer', { vehicleLocalId: 'veh_1', recordedAt: '2026-02-10', odometerKm: Number.NaN });
    expect(record.fields.odometerKm).toBeUndefined();
  });

  it('uma string vazia conta como ausente (§5.3)', () => {
    const record = one('vehicle', { plate: 'AA-00-BB', plateDisplay: '', vin: '', color: '' });

    expect(record.fields.vin).toBeUndefined();
    expect(record.fields.color).toBeUndefined();
  });

  it('null conta como ausente (§5.3)', () => {
    const record = one('vehicle', { plate: 'AA-00-BB', plateDisplay: 'AA-00-BB', vin: null, make: null });

    expect(record.fields.vin).toBeUndefined();
    expect(record.fields.make).toBeUndefined();
  });

  it('um registo sem campos nenhuns não rebenta', () => {
    const record = one('vehicle', {});
    expect(record.fields).toEqual({});
  });

  it('uma referência com tipo errado não entra em references', () => {
    const record = one('expense', {
      vehicleLocalId: 123, date: '2026-02-10', amountCents: 100, category: 'toll',
    });

    expect(record.references.vehicleLocalId).toBeUndefined();
    expect(record.fields.vehicleLocalId).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* 7. Integração com o Validator — a cadeia liga                              */
/* -------------------------------------------------------------------------- */

describe('normalize-records: ligação ao Validator', () => {
  /**
   * Monta um lote coerente: um veículo e registos que apontam para ele.
   *
   * É a primeira vez que o Parser e o Validator são exercidos **em conjunto** — o
   * `normalizeRecords` seguido do `validateRecords`. Até aqui cada metade era testada
   * contra o seu próprio contrato.
   */
  function coherentBatch(): RawBundleRecord[] {
    return [
      raw('vehicle', { localId: 'veh_1', plate: 'AA-00-BB', plateDisplay: 'AA-00-BB', make: 'Kia', model: 'EV3', year: 2025 }, { line: 1 }),
      raw('odometer', { localId: 'odo_1', vehicleLocalId: 'veh_1', recordedAt: '2026-02-10', odometerKm: 15_000 }, { line: 1 }),
      raw('fuel', { localId: 'fuel_1', vehicleLocalId: 'veh_1', date: '2026-02-10', litres: 42.35, amountCents: 7_000, odometerKm: 15_000 }, { line: 1 }),
      raw('expense', { localId: 'exp_1', vehicleLocalId: 'veh_1', date: '2026-02-10', amountCents: 7_000, category: 'fuel', linkedRecordLocalId: 'fuel_1' }, { line: 1 }),
    ];
  }

  it('um lote coerente passa a validação sem bloqueantes', () => {
    const { records } = normalizeRecords(coherentBatch());
    const validation = validateRecords(records);

    expect(validation.blocked).toBe(false);
    expect(validation.records.every((r) => r.quality !== 'quarantined')).toBe(true);
  });

  it('as referências ao veículo são reconhecidas como existentes', () => {
    const { records } = normalizeRecords(coherentBatch());
    const validation = validateRecords(records);

    const broken = validation.issues.filter((i) => i.code === 'bundle.broken_reference');
    expect(broken).toEqual([]);
  });

  it('uma referência para um localId inexistente é detetada', () => {
    const { records } = normalizeRecords([
      raw('vehicle', { localId: 'veh_1', plate: 'AA-00-BB', plateDisplay: 'AA-00-BB' }),
      raw('odometer', { localId: 'odo_1', vehicleLocalId: 'veh_inexistente', recordedAt: '2026-02-10', odometerKm: 100 }),
    ]);

    const validation = validateRecords(records);

    expect(validation.blocked).toBe(true);
    expect(validation.issues.some((i) => i.code === 'bundle.broken_reference')).toBe(true);
  });

  it('o vehicleLocalId sai de references — sem ele a referência quebrada não era vista', () => {
    /*
     * Verificação do valor de separar referências de campos: é a presença em `references`
     * que permite ao Validator verificar existência. Se o veículo só fosse um valor em
     * `fields`, uma referência para um veículo inexistente passaria despercebida e a
     * importação criaria um registo órfão.
     */
    const { records } = normalizeRecords([
      raw('odometer', { localId: 'odo_1', vehicleLocalId: 'veh_inexistente', recordedAt: '2026-02-10', odometerKm: 100 }),
    ]);

    expect(records[0]?.references.vehicleLocalId).toBe('veh_inexistente');

    const validation = validateRecords(records);
    expect(validation.blocked).toBe(true);
  });

  it('a validação não perde o localId nem a linha', () => {
    const { records } = normalizeRecords([
      raw('vehicle', { localId: 'veh_1', plate: 'AA-00-BB', plateDisplay: 'AA-00-BB' }, { line: 1 }),
      raw('odometer', { localId: 'odo_1', vehicleLocalId: 'veh_1', recordedAt: '2026-02-10' }, { line: 7 }),
    ]);

    const validation = validateRecords(records);
    const missing = validation.issues.find((i) => i.code === 'record.missing_required_field');

    expect(missing?.localId).toBe('odo_1');
    expect(missing?.line).toBe(7);
  });
});

/* -------------------------------------------------------------------------- */
/* 8. Tabela de campos — cobertura                                             */
/* -------------------------------------------------------------------------- */

describe('normalize-records: cobertura da tabela de campos', () => {
  /*
   * Catorze tipos têm de estar mapeados. Um tipo novo que apareça no bundle sem entrada
   * aqui cairia no ramo defensivo (campos vazios) e passaria sem aviso — este teste é o
   * que transforma esse esquecimento numa falha visível.
   */
  const ALL_KINDS: readonly RecordKind[] = [
    'vehicle', 'odometer', 'expense', 'fuel', 'charging', 'maintenance',
    'insurance', 'inspection', 'tax', 'document', 'reminder', 'event',
    'suggestion', 'notification',
  ];

  for (const kind of ALL_KINDS) {
    it(`«${kind}» tem mapeamento próprio`, () => {
      const probe: Record<string, unknown> = {};
      for (const field of FIELDS_REQUIRED_BY_DEDUPE[kind] ?? []) probe[field] = 'sonda';

      const record = one(kind, probe);

      // Se o tipo não tivesse entrada na tabela, `fields` vinha vazio.
      if ((FIELDS_REQUIRED_BY_DEDUPE[kind] ?? []).length > 0) {
        expect(
          Object.keys(record.fields).length,
          `«${kind}» não tem mapeamento — caiu no ramo defensivo`,
        ).toBeGreaterThan(0);
      }
    });
  }

  it('um `vehicleLocalId` de sonda é tratado como referência, não como campo desconhecido', () => {
    const result = normalizeRecords([
      raw('reminder', { localId: 'rem_1', vehicleLocalId: 'veh_1', title: 'X' }),
    ]);

    expect(result.unmappedFields.reminder).toBeUndefined();
  });
});
