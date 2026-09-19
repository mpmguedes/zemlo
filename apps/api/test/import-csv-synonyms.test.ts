import { describe, expect, it } from 'vitest';
import {
  CANONICAL_FIELDS,
  COLUMN_SYNONYMS,
  isCanonicalField,
  lookupColumnSynonyms,
  normalizeColumnName,
} from '@zemlo/shared';

describe('vocabulário canónico de campos', () => {
  it('declara os catorze tipos de registo que o CanonicalRecord admite', () => {
    expect(Object.keys(CANONICAL_FIELDS).sort()).toEqual(
      [
        'charging',
        'document',
        'event',
        'expense',
        'fuel',
        'inspection',
        'insurance',
        'maintenance',
        'notification',
        'odometer',
        'reminder',
        'suggestion',
        'tax',
        'vehicle',
      ].sort(),
    );
  });

  it('todos os campos declarados são únicos por tipo', () => {
    for (const [kind, fields] of Object.entries(CANONICAL_FIELDS)) {
      expect(new Set(fields).size, `campos repetidos em ${kind}`).toBe(fields.length);
    }
  });

  it('reconhece nomes canónicos e rejeita inventados', () => {
    expect(isCanonicalField('amountCents')).toBe(true);
    expect(isCanonicalField('odometerKm')).toBe(true);
    expect(isCanonicalField('plate')).toBe(true);
    expect(isCanonicalField('maintenanceType')).toBe(false);
    expect(isCanonicalField('inspectionResult')).toBe(false);
    expect(isCanonicalField('taxKind')).toBe(false);
    expect(isCanonicalField('documentName')).toBe(false);
    expect(isCanonicalField('eventTitle')).toBe(false);
  });

  it('nunca é mutável', () => {
    expect(Object.isFrozen(CANONICAL_FIELDS)).toBe(true);
    for (const fields of Object.values(CANONICAL_FIELDS)) {
      expect(Object.isFrozen(fields)).toBe(true);
    }
  });

  /**
   * Este é o teste que impede a classe de erro mais perigosa deste dicionário: um
   * sinónimo que aponta para um campo que **não existe** no `CanonicalRecord`. O
   * mapeamento pareceria correto — a coluna ficava "reconhecida" — e nunca escrevia
   * nada, silenciosamente. Já aconteceu durante a implementação (o dicionário chegou a
   * apontar para `maintenanceType`, `inspectionResult`, `taxKind`, `documentName` e
   * `eventTitle`, que não existem em `FIELD_MAP`).
   */
  it('cada campo do dicionário de sinónimos é um campo canónico real', () => {
    const used = new Set<string>();
    for (const entry of COLUMN_SYNONYMS) {
      used.add(entry.field);
    }

    const invented = [...used].filter((field) => !isCanonicalField(field));
    expect(
      invented,
      `estes campos do dicionário não existem no vocabulário canónico: ${invented.join(', ')}`,
    ).toEqual([]);
  });

  it('cobre todos os tipos de registo que o CSV genérico deve conseguir importar', () => {
    // §10.5 infere fuel, expense, maintenance e odometer; a ficha de veículo (§5.4)
    // também tem de ser importável. Se um destes deixar de ter sinónimos, a
    // importação desse tipo torna-se impossível sem o utilizador mapear tudo à mão.
    const requiredKinds = ['vehicle', 'fuel', 'expense', 'maintenance', 'odometer'];
    const fieldsUsed = new Set(COLUMN_SYNONYMS.map((e) => e.field));

    for (const kind of requiredKinds) {
      const fields = CANONICAL_FIELDS[kind] ?? [];
      const covered = fields.filter((f) => fieldsUsed.has(f));
      expect(
        covered.length,
        `o tipo ${kind} não tem qualquer campo coberto pelo dicionário`,
      ).toBeGreaterThan(0);
    }
  });
});

describe('normalizeColumnName', () => {
  it('passa a minúsculas', () => {
    expect(normalizeColumnName('MATRÍCULA')).toBe('matricula');
    expect(normalizeColumnName('Valor')).toBe('valor');
  });

  it('remove acentos portugueses', () => {
    expect(normalizeColumnName('Descrição')).toBe('descricao');
    expect(normalizeColumnName('Quilometragem')).toBe('quilometragem');
    expect(normalizeColumnName('Combustível')).toBe('combustivel');
    expect(normalizeColumnName('Versão')).toBe('versao');
    expect(normalizeColumnName('Observações')).toBe('observacoes');
  });

  it('colapsa espaços e remove pontuação de separação', () => {
    expect(normalizeColumnName('  Quilometragem  ')).toBe('quilometragem');
    expect(normalizeColumnName('Valor Total')).toBe('valor total');
    expect(normalizeColumnName('valor___total')).toBe('valor total');
    expect(normalizeColumnName('Valor - Total')).toBe('valor total');
  });

  it('remove parênteses que não sejam unidades significativas', () => {
    expect(normalizeColumnName('Valor (€)')).toBe('valor €');
    expect(normalizeColumnName('Data (registo)')).toBe('data');
  });

  it('preserva unidades que desambiguam', () => {
    expect(normalizeColumnName('Energia (kWh)')).toBe('energia kwh');
    expect(normalizeColumnName('Litros (L)')).toBe('litros l');
    expect(normalizeColumnName('Quilometragem (km)')).toBe('quilometragem km');
  });

  it('preserva a barra e o euro porque fazem parte do significado', () => {
    expect(normalizeColumnName('Preço/litro (€)')).toBe('preco/litro €');
    expect(normalizeColumnName('€/kWh')).toBe('€/kwh');
  });

  it('é idempotente', () => {
    const inputs = ['Descrição', 'Valor (€)', 'Preço/litro (€)', '  kWh  ', 'MATRÍCULA'];
    for (const input of inputs) {
      const once = normalizeColumnName(input);
      expect(normalizeColumnName(once)).toBe(once);
    }
  });

  it('devolve string vazia para entrada vazia ou só pontuação', () => {
    expect(normalizeColumnName('')).toBe('');
    expect(normalizeColumnName('   ')).toBe('');
    expect(normalizeColumnName('()')).toBe('');
  });
});

describe('dicionário de sinónimos — cobertura da §10.3', () => {
  /**
   * A §10.3 dá uma tabela explícita. Estes testes verificam que **cada** sinónimo
   * documentado é reconhecido: se alguém editar o dicionário e remover um,
   * falha aqui em vez de falhar silenciosamente numa importação real.
   */
  const SPEC_TABLE: readonly { field: string; synonyms: readonly string[] }[] = [
    { field: 'date', synonyms: ['data', 'date', 'dia', 'fecha', 'data de compra'] },
    { field: 'amountCents', synonyms: ['valor', 'total', 'montante', 'preço', 'custo', 'amount'] },
    { field: 'odometerKm', synonyms: ['km', 'quilómetros', 'quilometragem', 'odómetro', 'mileage', 'kms'] },
    { field: 'litres', synonyms: ['litros', 'litres', 'l', 'quantidade', 'volume'] },
    { field: 'energyKwh', synonyms: ['kwh', 'energia', 'energia (kwh)', 'kw'] },
    { field: 'plate', synonyms: ['matrícula', 'matricula', 'plate', 'viatura', 'veículo'] },
    { field: 'vendor', synonyms: ['fornecedor', 'posto', 'local', 'oficina', 'estabelecimento', 'vendor'] },
  ];

  it.each(SPEC_TABLE)('reconhece todos os sinónimos de $field da especificação', ({ field, synonyms }) => {
    for (const synonym of synonyms) {
      const matches = lookupColumnSynonyms(synonym);
      const fields = matches.map((m) => m.field);
      expect(fields, `sinónimo "${synonym}" devia mapear para ${field}`).toContain(field);
    }
  });

  it('reconhece "descrição" para category (mapeamento fraco da especificação)', () => {
    const matches = lookupColumnSynonyms('descrição');
    const forCategory = matches.find((m) => m.field === 'category');
    expect(forCategory).toBeDefined();
    expect(forCategory?.match).toBe('weak');
  });
});

describe('dicionário de sinónimos — ciclo exportar → importar', () => {
  /**
   * O caso que a especificação exige (§13): o Zemlo tem de conseguir importar o
   * CSV que ele próprio exporta. Estes são os cabeçalhos reais de `bundleToCsv`
   * (§5.4). Se algum deixar de ser reconhecido, o ciclo fecha-se mal.
   */
  const ZEMLO_EXPORT_HEADERS: readonly { header: string; expected: readonly string[] }[] = [
    { header: 'Matrícula', expected: ['plate'] },
    { header: 'Marca', expected: ['make'] },
    { header: 'Modelo', expected: ['model'] },
    { header: 'Versão', expected: ['version'] },
    { header: 'Ano', expected: ['year'] },
    { header: 'Combustível', expected: ['fuelType'] },
    { header: 'Quilometragem', expected: ['odometerKm'] },
    { header: 'VIN', expected: ['vin'] },
    { header: 'Data', expected: ['date'] },
    { header: 'Categoria', expected: ['category'] },
    { header: 'Valor (€)', expected: ['amountCents'] },
    { header: 'IVA (€)', expected: ['vatCents'] },
    { header: 'Fornecedor', expected: ['vendor'] },
    { header: 'Descrição', expected: ['description'] },
    { header: 'Litros', expected: ['litres'] },
    { header: 'Notas', expected: ['notes'] },
  ];

  it.each(ZEMLO_EXPORT_HEADERS)(
    'o cabeçalho exportado "$header" é reconhecido',
    ({ header, expected }) => {
      const matches = lookupColumnSynonyms(header);
      const fields = matches.map((m) => m.field);
      for (const field of expected) {
        expect(fields, `"${header}" devia mapear para ${field}`).toContain(field);
      }
    },
  );

  it('"Pago" é reconhecido como bandeira de pagamento', () => {
    const matches = lookupColumnSynonyms('Pago');
    expect(matches.map((m) => m.field)).toContain('paid');
  });

  it('"Pagamento" é reconhecido como método de pagamento', () => {
    const matches = lookupColumnSynonyms('Pagamento');
    expect(matches.map((m) => m.field)).toContain('paymentMethod');
  });
});

describe('dicionário de sinónimos — estrutura e prioridade', () => {
  it('nunca é mutável', () => {
    expect(Object.isFrozen(COLUMN_SYNONYMS)).toBe(true);
    for (const entry of COLUMN_SYNONYMS) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.synonyms)).toBe(true);
    }
  });

  it('não tem sinónimos duplicados com a mesma confiança', () => {
    const seen = new Map<string, Set<string>>();
    for (const entry of COLUMN_SYNONYMS) {
      for (const synonym of entry.synonyms) {
        const key = normalizeColumnName(synonym);
        if (key === '') continue;
        const key2 = `${key}`;
        const entryKey = entry.field;
        const set = seen.get(key2) ?? new Set<string>();
        const bucket = `${entryKey}:${entry.match}`;
        expect(
          set.has(bucket),
          `sinónimo "${synonym}" declarado duas vezes para ${entry.field} (${entry.match})`,
        ).toBe(false);
        set.add(bucket);
        seen.set(key2, set);
      }
    }
  });

  it('ordena as correspondências por confiança decrescente', () => {
    for (const entry of COLUMN_SYNONYMS) {
      for (const synonym of entry.synonyms) {
        const matches = lookupColumnSynonyms(synonym);
        for (let i = 1; i < matches.length; i += 1) {
          const previous = matches[i - 1]?.confidence ?? 0;
          const current = matches[i]?.confidence ?? 0;
          expect(current).toBeLessThanOrEqual(previous);
        }
      }
    }
  });

  it('atribui confiança mais alta a "exact" do que a "weak"', () => {
    // "Matrícula" é exact para plate; "tipo" é weak para category.
    const exact = lookupColumnSynonyms('Matrícula')[0];
    const weak = lookupColumnSynonyms('tipo').find((m) => m.match === 'weak');
    expect(exact?.confidence).toBeGreaterThan(weak?.confidence ?? 1);
  });

  it('devolve lista vazia para coluna desconhecida', () => {
    expect(lookupColumnSynonyms('Coluna Inventada')).toEqual([]);
    expect(lookupColumnSynonyms('xyzzy')).toEqual([]);
    expect(lookupColumnSynonyms('')).toEqual([]);
  });

  it('é insensível a maiúsculas, acentos e espaços', () => {
    const variants = ['MATRÍCULA', 'matricula', 'Matrícula', '  matrícula  ', 'MATRICULA'];
    const reference = JSON.stringify(lookupColumnSynonyms('Matrícula'));
    for (const variant of variants) {
      expect(JSON.stringify(lookupColumnSynonyms(variant)), `variante "${variant}"`).toBe(reference);
    }
  });

  it('devolve resultados congelados e não partilhados mutáveis', () => {
    const a = lookupColumnSynonyms('Data');
    expect(Object.isFrozen(a)).toBe(true);
  });
});

describe('dicionário de sinónimos — ambiguidade explícita', () => {
  it('"tipo" é ambíguo e nunca resolve sozinho', () => {
    const matches = lookupColumnSynonyms('tipo');
    // Aparece em mais do que um campo, e todas as correspondências são fracas.
    const fields = new Set(matches.map((m) => m.field));
    expect(fields.size).toBeGreaterThan(1);
    expect(matches.every((m) => m.match === 'weak')).toBe(true);
  });

  it('"descrição" tem mais do que um campo possível', () => {
    const fields = new Set(lookupColumnSynonyms('descrição').map((m) => m.field));
    expect(fields.size).toBeGreaterThan(1);
  });

  it('"local" é reconhecido mas pode ser fornecedor ou local de carregamento', () => {
    const fields = new Set(lookupColumnSynonyms('local').map((m) => m.field));
    expect(fields).toContain('vendor');
    expect(fields.size).toBeGreaterThan(1);
  });

  it('"pago" resolve para a bandeira de pagamento, sem colisão com o valor', () => {
    const matches = lookupColumnSynonyms('pago');
    const fields = matches.map((m) => m.field);
    expect(fields).toContain('paid');
    // "pago" é uma bandeira booleana, não um valor: não deve ser oferecido como
    // candidato a `amountCents`, para não criar uma escolha falsa no mapeador.
    expect(fields).not.toContain('amountCents');
  });

  it('"pagamento" é genuinamente ambíguo (valor, método ou estado)', () => {
    const fields = new Set(lookupColumnSynonyms('pagamento').map((m) => m.field));
    expect(fields).toContain('amountCents');
    expect(fields).toContain('paymentMethod');
    // A ambiguidade é real e visível: o mapeador tem de perguntar.
    expect(fields.size).toBeGreaterThan(1);
  });
});
