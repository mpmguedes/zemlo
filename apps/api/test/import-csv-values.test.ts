import { describe, expect, it } from 'vitest';
import {
  AMBIGUITY_CODES,
  detectAmbiguousRatio,
  interpretColumn,
  isDateField,
  isMoneyField,
  type ValueRow,
} from '../src/domain/import/csv/values.js';

/** Constrói linhas de valor a partir de strings. */
function rows(values: readonly string[]): ValueRow[] {
  return values.map((value, index) => ({ line: index + 2, value }));
}

describe('códigos de ambiguidade', () => {
  it('declara exatamente os quatro casos da §10.4', () => {
    expect([...AMBIGUITY_CODES]).toEqual([
      'data_ambigua',
      'separador_decimal',
      'moedas_multiplas',
      'unidade_ambigua',
    ]);
  });

  it('classifica os campos por tipo', () => {
    expect(isDateField('date')).toBe(true);
    expect(isDateField('expiresAt')).toBe(true);
    expect(isDateField('amountCents')).toBe(false);
    expect(isMoneyField('amountCents')).toBe(true);
    expect(isMoneyField('premiumCents')).toBe(true);
    expect(isMoneyField('litres')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Datas                                                                       */
/* -------------------------------------------------------------------------- */

describe('datas — interpretação inequívoca', () => {
  it('lê datas ISO sem ambiguidade', () => {
    const result = interpretColumn('date', rows(['2026-01-15', '2026-03-04']));
    expect(result.ambiguity).toBeNull();
    expect(result.values.get(2)).toBe('2026-01-15');
    expect(result.values.get(3)).toBe('2026-03-04');
    expect(result.conventions[0]?.choice).toBe('iso');
  });

  it('resolve dia/mês quando um valor prova o dia (31 > 12)', () => {
    const result = interpretColumn('date', rows(['31/01/2026', '05/02/2026']));
    expect(result.ambiguity).toBeNull();
    expect(result.conventions[0]?.choice).toBe('dia-mes');
    expect(result.values.get(2)).toBe('2026-01-31');
    expect(result.values.get(3)).toBe('2026-02-05');
  });

  it('resolve mês/dia quando um valor prova o mês (segundo componente > 12)', () => {
    const result = interpretColumn('date', rows(['01/31/2026', '02/05/2026']));
    expect(result.ambiguity).toBeNull();
    expect(result.conventions[0]?.choice).toBe('mes-dia');
    expect(result.values.get(2)).toBe('2026-01-31');
    expect(result.values.get(3)).toBe('2026-02-05');
  });

  it('aceita uma mistura de ISO e formato português', () => {
    const result = interpretColumn('date', rows(['2026-01-15', '20/03/2026']));
    expect(result.ambiguity).toBeNull();
    expect(result.values.get(2)).toBe('2026-01-15');
    expect(result.values.get(3)).toBe('2026-03-20');
  });

  it('aceita o ano com dois dígitos', () => {
    const result = interpretColumn('date', rows(['31/01/26']));
    expect(result.values.get(2)).toBe('2026-01-31');
  });

  it('aceita data com hora ISO e ignora a hora', () => {
    const result = interpretColumn('recordedAt', rows(['2026-01-15T10:30:00Z']));
    expect(result.values.get(2)).toBe('2026-01-15');
  });

  it('aceita pontos e traços como separador de data', () => {
    const dia = interpretColumn('date', rows(['31.01.2026']));
    expect(dia.values.get(2)).toBe('2026-01-31');
    const traco = interpretColumn('date', rows(['31-01-2026']));
    expect(traco.values.get(2)).toBe('2026-01-31');
  });

  it('aplica a ordem escolhida pelo utilizador', () => {
    const result = interpretColumn('date', rows(['03/04/2026']), { dateOrder: 'mes-dia' });
    expect(result.ambiguity).toBeNull();
    expect(result.values.get(2)).toBe('2026-03-04');
    expect(result.conventions[0]?.confidence).toBe(1);
  });

  it('reporta uma data inválida como problema da linha', () => {
    const result = interpretColumn('date', rows(['31/02/2026']));
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe('valor_ilegivel');
    expect(result.issues[0]?.line).toBe(2);
    expect(result.values.has(2)).toBe(false);
  });

  it('reporta texto que não é data', () => {
    const result = interpretColumn('date', rows(['ontem']));
    expect(result.issues[0]?.code).toBe('valor_ilegivel');
    expect(result.issues[0]?.raw).toBe('ontem');
  });

  it('ignora valores vazios', () => {
    const result = interpretColumn('date', rows(['', '  ', '2026-01-15']));
    expect(result.issues).toEqual([]);
    expect(result.values.size).toBe(1);
  });
});

describe('datas — ambiguidade genuína (§10.4)', () => {
  it('sinaliza ambiguidade quando todos os componentes são ≤ 12', () => {
    const result = interpretColumn('date', rows(['03/04/2026', '05/06/2026']));
    expect(result.ambiguity).not.toBeNull();
    expect(result.ambiguity?.code).toBe('data_ambigua');
    expect(result.ambiguity?.question).toMatch(/dia\/mês ou mês\/dia/);
  });

  it('não grava valores enquanto a ambiguidade não for resolvida', () => {
    const result = interpretColumn('date', rows(['03/04/2026']));
    // Gravar uma das leituras seria adivinhar.
    expect(result.values.size).toBe(0);
  });

  it('apresenta as duas leituras com pré-visualização', () => {
    const result = interpretColumn('date', rows(['03/04/2026', '05/06/2026']));
    const alternatives = result.ambiguity?.alternatives ?? [];
    expect(alternatives).toHaveLength(2);

    const diaMes = alternatives.find((a) => a.value === 'dia-mes');
    const mesDia = alternatives.find((a) => a.value === 'mes-dia');

    expect(diaMes?.preview[0]).toBe('2026-04-03');
    expect(mesDia?.preview[0]).toBe('2026-03-04');
    expect(diaMes?.label).toMatch(/dia\/mês/i);
    expect(mesDia?.label).toMatch(/mês\/dia/i);
  });

  it('não sinaliza ambiguidade quando o utilizador já decidiu', () => {
    const result = interpretColumn('date', rows(['03/04/2026']), { dateOrder: 'dia-mes' });
    expect(result.ambiguity).toBeNull();
    expect(result.values.get(2)).toBe('2026-04-03');
  });

  it('deteta uma coluna que mistura formatos incompatíveis', () => {
    // 31/01 prova dia-primeiro; 01/31 prova mês-primeiro: nenhuma convenção serve tudo.
    const result = interpretColumn('date', rows(['31/01/2026', '01/31/2026']));
    expect(result.ambiguity).toBeNull();
    expect(result.issues.some((i) => i.message.includes('mistura'))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Dinheiro — separador decimal                                                */
/* -------------------------------------------------------------------------- */

describe('dinheiro — separador decimal (§10.4)', () => {
  it('deteta o padrão português quando é dominante', () => {
    const result = interpretColumn('amountCents', rows(['1.234,56', '2.345,67', '10,00']));
    expect(result.conventions[0]?.choice).toBe('virgula');
    expect(result.ambiguity).toBeNull();
    expect(result.values.get(2)).toBe(123456);
    expect(result.values.get(3)).toBe(234567);
    expect(result.values.get(4)).toBe(1000);
  });

  it('deteta o padrão anglo-saxónico quando é dominante', () => {
    const result = interpretColumn('amountCents', rows(['1,234.56', '2,345.67', '10.00']));
    expect(result.conventions[0]?.choice).toBe('ponto');
    expect(result.ambiguity).toBeNull();
    expect(result.values.get(2)).toBe(123456);
    expect(result.values.get(3)).toBe(234567);
    expect(result.values.get(4)).toBe(1000);
  });

  it('sinaliza ambiguidade num empate entre convenções', () => {
    const result = interpretColumn('amountCents', rows(['1.234,56', '1,234.56']));
    expect(result.ambiguity?.code).toBe('separador_decimal');
    expect(result.values.size).toBe(0);
  });

  it('sinaliza ambiguidade quando só há padrões de três dígitos', () => {
    const result = interpretColumn('amountCents', rows(['1,234', '5,678']));
    expect(result.ambiguity?.code).toBe('separador_decimal');
    expect(result.ambiguity?.alternatives).toHaveLength(2);
  });

  it('não sinaliza quando o padrão é inequívoco em toda a coluna', () => {
    const result = interpretColumn('amountCents', rows(['12,50', '99,90', '1.000,00']));
    expect(result.ambiguity).toBeNull();
    expect(result.conventions[0]?.choice).toBe('virgula');
  });

  it('aplica o separador decidido pelo utilizador', () => {
    const result = interpretColumn('amountCents', rows(['1,234']), { decimalStyle: 'ponto' });
    expect(result.ambiguity).toBeNull();
    expect(result.values.get(2)).toBe(123400);
  });

  it('aceita valores sem decimais', () => {
    const result = interpretColumn('amountCents', rows(['100', '250']));
    expect(result.values.get(2)).toBe(10000);
    expect(result.values.get(3)).toBe(25000);
  });

  it('aceita o símbolo do euro', () => {
    const result = interpretColumn('amountCents', rows(['12,50 €', '€ 30,00']));
    expect(result.values.get(2)).toBe(1250);
    expect(result.values.get(3)).toBe(3000);
  });

  it('trata valores negativos', () => {
    const result = interpretColumn('amountCents', rows(['-12,50']));
    expect(result.values.get(2)).toBe(-1250);
  });

  it('reporta montante ilegível', () => {
    const result = interpretColumn('amountCents', rows(['muito caro']));
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.values.size).toBe(0);
  });
});

describe('dinheiro — duas moedas (§10.4)', () => {
  it('deteta duas moedas e põe as linhas minoritárias em quarentena', () => {
    const result = interpretColumn('amountCents', rows(['10,00 €', '20,00 €', '$30.00']));
    expect(result.ambiguity?.code).toBe('moedas_multiplas');
    expect(result.ambiguity?.affectedLines).toEqual([4]);
    expect(result.values.size).toBe(0);
  });

  it('apresenta a opção de importar apenas a moeda dominante', () => {
    const result = interpretColumn('amountCents', rows(['10,00 €', '20,00 €', '30,00 €', '$5.00']));
    const preferred = result.ambiguity?.alternatives[0];
    expect(preferred?.value).toBe('EUR');
    expect(preferred?.label).toMatch(/EUR/);
    expect(preferred?.preview.length).toBeGreaterThan(0);
  });

  it('oferece corrigir o ficheiro como alternativa', () => {
    const result = interpretColumn('amountCents', rows(['10,00 €', '$5.00']));
    const fix = result.ambiguity?.alternatives.find((a) => a.value === 'corrigir');
    expect(fix).toBeDefined();
  });

  it('não sinaliza quando há uma só moeda não-EUR (avisa mas trata)', () => {
    const result = interpretColumn('amountCents', rows(['10.00', '20.00']).map((r) => ({ ...r })));
    expect(result.ambiguity).toBeNull();
  });

  it('lista as moedas encontradas na pergunta', () => {
    const result = interpretColumn('amountCents', rows(['10,00 €', '£5.00']));
    expect(result.ambiguity?.question).toMatch(/EUR/);
    expect(result.ambiguity?.question).toMatch(/GBP/);
  });
});

/* -------------------------------------------------------------------------- */
/* Decimais, inteiros, booleanos                                               */
/* -------------------------------------------------------------------------- */

describe('decimais', () => {
  it('interpreta litros com vírgula decimal', () => {
    const result = interpretColumn('litres', rows(['45,50', '38,20']));
    expect(result.values.get(2)).toBe(45.5);
    expect(result.values.get(3)).toBe(38.2);
  });

  it('interpreta kWh', () => {
    const result = interpretColumn('energyKwh', rows(['32,5', '18,0']));
    expect(result.values.get(2)).toBe(32.5);
  });

  it('interpreta percentagens de bateria', () => {
    const result = interpretColumn('startSocPercent', rows(['80', '45']));
    expect(result.values.get(2)).toBe(80);
  });

  it('rejeita texto em coluna numérica', () => {
    const result = interpretColumn('litres', rows(['cheio']));
    expect(result.issues[0]?.code).toBe('valor_ilegivel');
  });
});

describe('inteiros', () => {
  it('interpreta quilometragem', () => {
    const result = interpretColumn('odometerKm', rows(['125000', '125.500']));
    expect(result.values.get(2)).toBe(125000);
    expect(result.values.get(3)).toBe(125500);
  });

  it('aceita separadores de milhares com espaço', () => {
    const result = interpretColumn('odometerKm', rows(['125 500']));
    expect(result.values.get(2)).toBe(125500);
  });

  it('rejeita quilometragem com decimais em vez de arredondar', () => {
    const result = interpretColumn('odometerKm', rows(['125000,5']));
    expect(result.issues.length).toBeGreaterThan(0);
  });

  /**
   * Regressão de um erro grave encontrado durante a implementação: a primeira versão
   * limitava-se a `replace(/[^\d]/g, '')`, o que transformava `125000,5` em `1250005`
   * — dez vezes o valor real, silenciosamente. Os separadores têm de ser interpretados
   * estruturalmente, nunca removidos à força.
   */
  it('nunca multiplica por dez um valor com decimais', () => {
    const result = interpretColumn('odometerKm', rows(['125000,5']));
    expect(result.values.has(2)).toBe(false);
    expect(result.issues[0]?.code).toBe('fora_de_intervalo');
  });

  it('não confunde separadores de milhares com decimais', () => {
    const result = interpretColumn('odometerKm', rows(['125.500', '125,500', '125 500']));
    expect(result.values.get(2)).toBe(125500);
    expect(result.values.get(3)).toBe(125500);
    expect(result.values.get(4)).toBe(125500);
    expect(result.issues).toEqual([]);
  });

  it('rejeita uma vírgula decimal com duas casas', () => {
    const result = interpretColumn('odometerKm', rows(['125000,50']));
    expect(result.issues[0]?.code).toBe('fora_de_intervalo');
  });

  it('interpreta o ano', () => {
    const result = interpretColumn('year', rows(['2021', '1998']));
    expect(result.values.get(2)).toBe(2021);
    expect(result.values.get(3)).toBe(1998);
  });
});

describe('booleanos', () => {
  it('aceita sim/não em português', () => {
    const result = interpretColumn('paid', rows(['Sim', 'Não', 'sim', 'nao']));
    expect(result.values.get(2)).toBe(true);
    expect(result.values.get(3)).toBe(false);
    expect(result.values.get(4)).toBe(true);
    expect(result.values.get(5)).toBe(false);
  });

  it('aceita verdadeiro/falso e 1/0', () => {
    const result = interpretColumn('fullTank', rows(['true', 'false', '1', '0']));
    expect(result.values.get(2)).toBe(true);
    expect(result.values.get(3)).toBe(false);
    expect(result.values.get(4)).toBe(true);
    expect(result.values.get(5)).toBe(false);
  });

  it('reporta um valor de sim/não irreconhecível', () => {
    const result = interpretColumn('paid', rows(['talvez']));
    expect(result.issues[0]?.code).toBe('valor_ilegivel');
  });
});

describe('texto livre', () => {
  it('preserva o valor como está', () => {
    const result = interpretColumn('notes', rows(['Revisão feita na oficina']));
    expect(result.values.get(2)).toBe('Revisão feita na oficina');
  });

  it('não produz problemas para texto', () => {
    const result = interpretColumn('vendor', rows(['Galp', 'Oficina Silva']));
    expect(result.issues).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Unidades ambíguas (§10.4, quarto caso)                                      */
/* -------------------------------------------------------------------------- */

describe('unidades ambíguas', () => {
  it('deteta a coluna "Km/l" como razão ambígua', () => {
    const ambiguity = detectAmbiguousRatio('Km/l');
    expect(ambiguity).not.toBeNull();
    expect(ambiguity?.code).toBe('unidade_ambigua');
    expect(ambiguity?.question).toMatch(/km por litro/i);
  });

  it('oferece as duas leituras inversas e a opção de ignorar', () => {
    const ambiguity = detectAmbiguousRatio('Km/l');
    const values = ambiguity?.alternatives.map((a) => a.value) ?? [];
    expect(values).toContain('km-por-litro');
    expect(values).toContain('litros-por-100km');
    expect(values).toContain('ignorar');
  });

  it('deteta a forma "l/100km"', () => {
    const ambiguity = detectAmbiguousRatio('l/100km');
    expect(ambiguity?.code).toBe('unidade_ambigua');
  });

  it('deteta variações de escrita', () => {
    for (const header of ['km/l', 'KM/L', 'Km por litro', 'km / l']) {
      expect(detectAmbiguousRatio(header), `cabeçalho "${header}"`).not.toBeNull();
    }
  });

  it('não sinaliza colunas que não são razões', () => {
    expect(detectAmbiguousRatio('Litros')).toBeNull();
    expect(detectAmbiguousRatio('Quilometragem')).toBeNull();
    expect(detectAmbiguousRatio('Valor')).toBeNull();
  });
});
