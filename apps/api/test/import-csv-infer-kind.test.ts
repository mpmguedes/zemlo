import { describe, expect, it } from 'vitest';
import {
  CSV_SUPPORTED_KINDS,
  INFERENCE_RULES,
  INFERENCE_STATES,
  canonicalFieldsFor,
  inferRecordKind,
  isCsvSupportedKind,
  isInferableKind,
  requiredFieldsFor,
} from '../src/domain/import/csv/infer-kind.js';

describe('regras de inferência — estrutura', () => {
  it('declara exatamente os três estados', () => {
    expect([...INFERENCE_STATES]).toEqual(['inequivoco', 'ambiguo', 'insuficiente']);
  });

  it('implementa as quatro regras da §10.5 mais o carregamento', () => {
    const kinds = INFERENCE_RULES.map((r) => r.kind);
    expect(kinds).toContain('fuel');
    expect(kinds).toContain('expense');
    expect(kinds).toContain('maintenance');
    expect(kinds).toContain('odometer');
    // O carregamento é um tipo do Zemlo com assinatura própria (kWh) e não pode
    // ser confundido com abastecimento — a §4.3 exige que o adaptador o suporte.
    expect(kinds).toContain('charging');
  });

  it('cada regra exige pelo menos uma coluna', () => {
    for (const rule of INFERENCE_RULES) {
      expect(rule.requires.length, `regra ${rule.kind}`).toBeGreaterThan(0);
    }
  });

  it('nunca é mutável', () => {
    expect(Object.isFrozen(INFERENCE_RULES)).toBe(true);
    for (const rule of INFERENCE_RULES) {
      expect(Object.isFrozen(rule)).toBe(true);
      expect(Object.isFrozen(rule.requires)).toBe(true);
    }
  });
});

describe('inferência — os quatro casos da §10.5', () => {
  it('data + valor + litros (+ km) → Abastecimento', () => {
    const result = inferRecordKind(['date', 'amountCents', 'litres', 'odometerKm']);
    expect(result.state).toBe('inequivoco');
    expect(result.kind).toBe('fuel');
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('data + valor + categoria → Despesa', () => {
    const result = inferRecordKind(['date', 'amountCents', 'category']);
    expect(result.state).toBe('inequivoco');
    expect(result.kind).toBe('expense');
  });

  it('data + valor + tipo/oficina (+ próxima data) → Manutenção', () => {
    const comProxima = inferRecordKind(['date', 'amountCents', 'type', 'nextDate']);
    expect(comProxima.kind).toBe('maintenance');
    expect(comProxima.confidence).toBeGreaterThan(0.7);
  });

  it('data + km sem valor → Quilometragem', () => {
    const result = inferRecordKind(['date', 'odometerKm']);
    expect(result.state).toBe('inequivoco');
    expect(result.kind).toBe('odometer');
    expect(result.reason).toMatch(/Quilometragem/);
  });

  it('data + energia (kWh) → Carregamento', () => {
    const result = inferRecordKind(['date', 'energyKwh', 'amountCents', 'location']);
    expect(result.state).toBe('inequivoco');
    expect(result.kind).toBe('charging');
  });
});

describe('inferência — ambiguidade (§10.5)', () => {
  it('assinala ambiguidade quando duas regras têm pontuações próximas', () => {
    // `category` satisfaz despesa; `type` satisfaz manutenção. Ambas têm todas as
    // obrigatórias presentes, com a mesma pontuação base → nenhuma margem de decisão.
    const result = inferRecordKind(['date', 'amountCents', 'category', 'type']);
    const viable = result.assessments.filter((a) => a.missing.length === 0);
    const kinds = viable.map((a) => a.kind);

    expect(kinds).toContain('expense');
    expect(kinds).toContain('maintenance');

    // A pontuação de ambas é `WEIGHT_REQUIRED` sem boosts até 0.3, portanto dentro da
    // margem de ambiguidade: o resultado tem de ser `ambiguo`, não uma escolha silenciosa.
    expect(result.state).toBe('ambiguo');
    expect(result.kind).toBeNull();
  });

  it('expõe as alternativas como uma pergunta de uma linha', () => {
    const result = inferRecordKind(['date', 'amountCents', 'category', 'type']);
    expect(result.state).toBe('ambiguo');
    expect(result.reason).toMatch(/escolhe/i);
    const kinds = result.alternatives.map((a) => a.kind);
    expect(kinds).toContain('expense');
    expect(kinds).toContain('maintenance');
    expect(result.alternatives.every((a) => a.label.length > 0)).toBe(true);
  });

  it('resolve quando uma das regras ganha um reforço distintivo', () => {
    // `nextDate` reforça manutenção; `category` continua a satisfazer despesa mas sem
    // reforço equivalente, e `litres` está ausente. A manutenção passa a destacar-se.
    const result = inferRecordKind(['date', 'amountCents', 'category', 'type', 'nextDate']);
    expect(result.assessments.find((a) => a.kind === 'maintenance')?.score).toBeGreaterThan(
      result.assessments.find((a) => a.kind === 'expense')?.score ?? 1,
    );
  });

  /**
   * Fronteira explícita: a margem de ambiguidade é de **um reforço** (0.1). Uma diferença
   * de exatamente um reforço não chega para decidir — uma evidência circunstancial (uma
   * coluna `type`) não deve ter o mesmo peso de decisão que uma estrutural.
   *
   * Este teste existe porque a primeira versão usava `<` (estrito) e classificava este
   * caso como inequívoco, escolhendo manutenção com uma margem de 0.10 sobre despesa.
   */
  it('não decide quando a margem é de apenas um reforço', () => {
    const result = inferRecordKind(['date', 'amountCents', 'category', 'type']);
    expect(result.assessments.find((a) => a.kind === 'maintenance')?.score).toBeCloseTo(0.7, 5);
    expect(result.assessments.find((a) => a.kind === 'expense')?.score).toBeCloseTo(0.6, 5);
    expect(result.state).toBe('ambiguo');
  });

  it('decide quando a margem é de dois reforços', () => {
    // `nextDate` + `type` dão a manutenção 0.80 contra 0.60 de despesa: margem de 0.20.
    const result = inferRecordKind(['date', 'amountCents', 'category', 'type', 'nextDate']);
    expect(result.state).toBe('inequivoco');
    expect(result.kind).toBe('maintenance');
  });
});

describe('inferência — insuficiência', () => {
  it('devolve insuficiente quando não há colunas nenhumas', () => {
    const result = inferRecordKind([]);
    expect(result.state).toBe('insuficiente');
    expect(result.kind).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it('devolve insuficiente quando não há data', () => {
    const result = inferRecordKind(['amountCents', 'litres']);
    expect(result.state).toBe('insuficiente');
    expect(result.reason).toMatch(/data/i);
  });

  it('devolve insuficiente quando há data mas nem valor nem km', () => {
    const result = inferRecordKind(['date', 'vendor', 'notes']);
    expect(result.state).toBe('insuficiente');
    expect(result.reason).toMatch(/valor|quilometragem/i);
  });

  it('nunca devolve um tipo quando o estado é insuficiente', () => {
    for (const fields of [[], ['date'], ['amountCents'], ['vendor', 'notes']]) {
      const result = inferRecordKind(fields);
      expect(result.kind, `campos ${JSON.stringify(fields)}`).toBeNull();
    }
  });

  it('explica porque não conseguiu classificar', () => {
    const result = inferRecordKind(['date']);
    expect(result.reason.length).toBeGreaterThan(20);
  });
});

describe('inferência — avaliação das regras', () => {
  it('registra as colunas obrigatórias em falta', () => {
    const result = inferRecordKind(['date', 'amountCents']);
    const fuel = result.assessments.find((a) => a.kind === 'fuel');
    expect(fuel?.missing).toContain('litres');
    expect(fuel?.score).toBe(0);
  });

  it('registra as colunas que reforçam', () => {
    const result = inferRecordKind(['date', 'amountCents', 'litres', 'station', 'fullTank']);
    const fuel = result.assessments.find((a) => a.kind === 'fuel');
    expect(fuel?.supportingBoosts).toContain('station');
    expect(fuel?.supportingBoosts).toContain('fullTank');
  });

  it('registra as colunas que enfraquecem', () => {
    const result = inferRecordKind(['date', 'amountCents', 'category', 'litres']);
    const expense = result.assessments.find((a) => a.kind === 'expense');
    expect(expense?.weakening).toContain('litres');
  });

  it('não deixa um valor monetário reforçar a leitura de quilometragem', () => {
    const comValor = inferRecordKind(['date', 'odometerKm', 'amountCents']);
    const odometer = comValor.assessments.find((a) => a.kind === 'odometer');
    expect(odometer?.weakening).toContain('amountCents');
    // §10.5: "data + km, SEM valor". Com valor, deixa de ser inequívoco.
    expect(odometer?.score).toBeLessThan(0.6);
  });

  it('ordena as avaliações por pontuação decrescente', () => {
    const result = inferRecordKind(['date', 'amountCents', 'litres', 'odometerKm']);
    for (let i = 1; i < result.assessments.length; i += 1) {
      const previous = result.assessments[i - 1]?.score ?? 0;
      const current = result.assessments[i]?.score ?? 0;
      expect(current).toBeLessThanOrEqual(previous);
    }
  });

  it('ignora campos que não participam na inferência', () => {
    const comRuido = inferRecordKind(['date', 'amountCents', 'litres', 'campoInventado', 'xyz']);
    const limpo = inferRecordKind(['date', 'amountCents', 'litres']);
    expect(comRuido.kind).toBe(limpo.kind);
    expect(comRuido.confidence).toBe(limpo.confidence);
  });

  it('mantém a confiança dentro de 0 e 1', () => {
    const combos = [
      ['date', 'amountCents', 'litres'],
      ['date', 'amountCents', 'litres', 'odometerKm', 'station', 'pricePerLitreCents', 'fullTank', 'fuelType'],
      ['date', 'energyKwh', 'amountCents', 'pricePerKwhCents', 'location', 'startSocPercent', 'endSocPercent'],
    ];
    for (const fields of combos) {
      const result = inferRecordKind(fields);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe('tipos suportados pelo CSV', () => {
  it('suporta a ficha de veículo, que nunca é inferida', () => {
    expect(isCsvSupportedKind('vehicle')).toBe(true);
    // Um veículo não tem data nem valor: não é inferível, mas é escolhível.
    expect(isInferableKind('vehicle')).toBe(false);
  });

  it('exclui os tipos que só existem dentro de um bundle', () => {
    expect(isCsvSupportedKind('event')).toBe(false);
    expect(isCsvSupportedKind('suggestion')).toBe(false);
    expect(isCsvSupportedKind('notification')).toBe(false);
  });

  it('inclui todos os tipos inferíveis', () => {
    for (const rule of INFERENCE_RULES) {
      expect(isCsvSupportedKind(rule.kind), `tipo ${rule.kind}`).toBe(true);
    }
  });

  it('a lista de tipos suportados nunca é mutável', () => {
    expect(Object.isFrozen(CSV_SUPPORTED_KINDS)).toBe(true);
  });
});

describe('apoio à decisão do utilizador', () => {
  it('devolve as colunas obrigatórias de um tipo', () => {
    expect(requiredFieldsFor('fuel')).toEqual(['date', 'amountCents', 'litres']);
    expect(requiredFieldsFor('odometer')).toEqual(['date', 'odometerKm']);
  });

  it('devolve lista vazia para um tipo sem regra', () => {
    expect(requiredFieldsFor('vehicle')).toEqual([]);
    expect(requiredFieldsFor('event')).toEqual([]);
  });

  it('devolve os campos canónicos de um tipo', () => {
    const fields = canonicalFieldsFor('fuel');
    expect(fields).toContain('litres');
    expect(fields).toContain('amountCents');
    expect(fields).toContain('station');
  });

  it('devolve lista vazia para um tipo desconhecido', () => {
    expect(canonicalFieldsFor('inexistente' as never)).toEqual([]);
  });
});
