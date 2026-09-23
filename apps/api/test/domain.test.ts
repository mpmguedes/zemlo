/**
 * Testes do domínio puro.
 *
 * Estes testes existem porque o Zemlo é, em última análise, um produto de números:
 * consumos, custos por km, datas de validade, projeções de manutenção. Um erro aqui
 * não produz um ecrã partido — produz uma decisão errada do utilizador sobre o seu
 * veículo, que é muito pior e muito mais difícil de detetar.
 *
 * Não tocam na base de dados nem em HTTP: testam as funções que decidem os números.
 */

import { describe, expect, it } from 'vitest';
import {
  averageEnergyConsumption,
  averageFuelConsumption,
  deriveChargingConsumption,
  deriveFuelConsumption,
  pricePerKwhCents,
  pricePerLitreCents,
  type FuelEntryInput,
} from '../src/domain/calculations.js';
import {
  evaluateOdometerReading,
  estimateUsageRate,
  projectDateForOdometer,
} from '../src/domain/odometer.js';
import { computeNextOccurrence, evaluateReminder } from '../src/domain/reminders.js';
import {
  advancedStats,
  comparePeriods,
  consumptionSummary,
  dataGaps,
  periodDistance,
  totalsByCategory,
  totalsByMonth,
  unitCosts,
} from '../src/domain/analysis.js';

/* -------------------------------------------------------------------------- */
/* Auxiliares                                                                  */
/* -------------------------------------------------------------------------- */

function fuel(id: string, date: string, litres: number, odometerKm: number, fullTank = true): FuelEntryInput {
  return {
    id,
    date,
    litres,
    amountCents: Math.round(litres * 170),
    odometerKm,
    fullTank,
    pricePerLitreCents: 170,
  };
}

/** Data civil a `offset` dias de uma data-base fixa. Testes determinísticos. */
function dayOffset(offset: number): string {
  const base = Date.UTC(2026, 0, 1);
  return new Date(base + offset * 86_400_000).toISOString().slice(0, 10);
}

/** Diferença em dias entre duas datas civis. */
function daysBetweenDates(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = to.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/* ========================================================================== */
/* Consumo de combustível (§13)                                               */
/* ========================================================================== */

describe('deriveFuelConsumption', () => {
  it('calcula o consumo entre dois depósitos atestados', () => {
    const derived = deriveFuelConsumption([
      fuel('a', '2026-01-01', 60, 10_000),
      fuel('b', '2026-02-01', 60, 11_000),
    ]);

    // 60 L em 1 000 km = 6,00 L/100 km.
    expect(derived.get('b')?.consumptionPer100Km).toBe(6);
    expect(derived.get('b')?.distanceSincePreviousKm).toBe(1000);
    expect(derived.get('b')?.reliable).toBe(true);
  });

  it('não calcula consumo no primeiro abastecimento (não há intervalo)', () => {
    const derived = deriveFuelConsumption([fuel('a', '2026-01-01', 60, 10_000)]);
    expect(derived.get('a')?.consumptionPer100Km).toBeNull();
    expect(derived.get('a')?.distanceSincePreviousKm).toBeNull();
  });

  it('acumula os litros de um abastecimento parcial no intervalo seguinte', () => {
    const derived = deriveFuelConsumption([
      fuel('a', '2026-01-01', 60, 10_000),
      fuel('meio', '2026-01-15', 30, 10_500, false),
      fuel('b', '2026-02-01', 30, 11_000),
    ]);

    // No intervalo a→b entraram 30 L (parcial) + 30 L = 60 L em 1 000 km.
    expect(derived.get('b')?.consumptionPer100Km).toBe(6);
    expect(derived.get('b')?.reliable).toBe(true);
  });

  it('marca como não fiável um intervalo que termina num abastecimento parcial', () => {
    const derived = deriveFuelConsumption([
      fuel('a', '2026-01-01', 60, 10_000),
      fuel('b', '2026-02-01', 30, 11_000, false),
    ]);
    expect(derived.get('b')?.reliable).toBe(false);
  });

  it('ignora intervalos demasiado curtos (provável erro de introdução)', () => {
    const derived = deriveFuelConsumption([
      fuel('a', '2026-01-01', 60, 10_000),
      fuel('b', '2026-01-01', 60, 10_005),
    ]);
    expect(derived.get('b')?.consumptionPer100Km).toBeNull();
  });

  it('ordena por data independentemente da ordem de entrada', () => {
    const derived = deriveFuelConsumption([
      fuel('b', '2026-02-01', 60, 11_000),
      fuel('a', '2026-01-01', 60, 10_000),
    ]);
    expect(derived.get('b')?.consumptionPer100Km).toBe(6);
  });

  it('aceita séries com um abastecimento sem quilometragem, sem inventar distâncias', () => {
    const derived = deriveFuelConsumption([
      fuel('a', '2026-01-01', 60, 10_000),
      { ...fuel('sem-km', '2026-01-15', 20, 0), odometerKm: null },
      fuel('b', '2026-02-01', 40, 11_000),
    ]);
    // O intervalo a→b continua a poder ser calculado pelos dois que têm odómetro.
    expect(derived.get('b')?.distanceSincePreviousKm).toBe(1000);
  });
});

describe('averageFuelConsumption', () => {
  it('pondera pelos quilómetros e não faz a média das médias', () => {
    // Um depósito pequeno e um grande: a média ponderada é próxima do depósito grande.
    const average = averageFuelConsumption([
      fuel('a', '2026-01-01', 40, 0),
      fuel('b', '2026-01-15', 5, 500),
      fuel('c', '2026-02-01', 60, 1500),
    ]);
    // Total: 65 L em 1 500 km = 4,33 L/100 km.
    expect(average).toBeCloseTo(4.33, 2);
  });

  it('devolve null quando não há dois depósitos atestados', () => {
    expect(averageFuelConsumption([fuel('a', '2026-01-01', 60, 10_000)])).toBeNull();
    expect(averageFuelConsumption([])).toBeNull();
  });

  it('ignora intervalos sem odómetro em vez de os contar como zero', () => {
    // Um abastecimento sem quilometragem torna o intervalo seguinte impossível de
    // fechar: não se sabe quantos quilómetros foram feitos. O Zemlo devolve "sem dados"
    // em vez de assumir zero — assumir zero produziria um consumo de infinito.
    const average = averageFuelConsumption([
      fuel('a', '2026-01-01', 60, 10_000),
      { ...fuel('sem-km', '2026-01-15', 20, 0), odometerKm: null },
      fuel('b', '2026-02-01', 40, 11_000),
    ]);
    expect(average).toBeNull();
  });

  it('não conta o primeiro abastecimento, que não tem intervalo anterior', () => {
    // Só o segundo abastecimento fecha um intervalo: 60 L em 1 000 km.
    const average = averageFuelConsumption([
      fuel('a', '2026-01-01', 999, 10_000),
      fuel('b', '2026-02-01', 60, 11_000),
    ]);
    expect(average).toBeCloseTo(6, 2);
  });
});

/**
 * A8: o consumo é calculado "depósito a depósito". Só existe um intervalo quando há
 * **dois** abastecimentos completos com odómetro, e os litros dos abastecimentos
 * parciais pelo meio **acumulam** para esse intervalo em vez de serem descartados.
 *
 * O médio tem de concordar com o consumo por sessão que `deriveFuelConsumption` mostra
 * na lista de abastecimentos. Quando os dois divergem, o painel e a lista apresentam
 * números diferentes para o mesmo veículo — que é o defeito que estes testes fixam.
 */
describe('averageFuelConsumption — acumulação de parciais (A8)', () => {
  it('inclui os litros do parcial no intervalo entre dois depósitos atestados', () => {
    // (10 + 50) L / (11 000 - 10 000) km = 6,00 L/100 km.
    // Medir o intervalo adjacente daria 50 L / 500 km = 10,00 L/100 km.
    const average = averageFuelConsumption([
      fuel('a', '2026-01-01', 40, 10_000),
      fuel('parcial', '2026-01-15', 10, 10_500, false),
      fuel('b', '2026-02-01', 50, 11_000),
    ]);

    expect(average).toBeCloseTo(6, 2);
  });

  it('o médio coincide com o consumo por sessão do intervalo fechado', () => {
    const series = [
      fuel('a', '2026-01-01', 40, 10_000),
      fuel('parcial', '2026-01-15', 10, 10_500, false),
      fuel('b', '2026-02-01', 50, 11_000),
    ];

    const perSession = deriveFuelConsumption(series).get('b')?.consumptionPer100Km ?? null;

    // O painel e a lista de abastecimentos não podem discordar sobre o mesmo veículo.
    expect(averageFuelConsumption(series)).toBe(perSession);
  });

  it('dois depósitos atestados consecutivos: usa os litros do segundo', () => {
    const average = averageFuelConsumption([
      fuel('a', '2026-01-01', 40, 10_000),
      fuel('b', '2026-02-01', 60, 11_000),
    ]);

    expect(average).toBeCloseTo(6, 2);
  });

  it('um parcial entre dois atestados, com litros diferentes dos atestados', () => {
    // (20 + 30) L / 1 000 km = 5,00 L/100 km.
    const average = averageFuelConsumption([
      fuel('a', '2026-01-01', 50, 10_000),
      fuel('parcial', '2026-01-15', 20, 10_500, false),
      fuel('b', '2026-02-01', 30, 11_000),
    ]);

    expect(average).toBeCloseTo(5, 2);
  });

  it('acumula vários parciais entre dois atestados', () => {
    // (5 + 15 + 40) L / 1 000 km = 6,00 L/100 km.
    // Medir o intervalo adjacente daria 40 L / 400 km = 10,00 L/100 km.
    const average = averageFuelConsumption([
      fuel('a', '2026-01-01', 40, 10_000),
      fuel('p1', '2026-01-10', 5, 10_200, false),
      fuel('p2', '2026-01-20', 15, 10_600, false),
      fuel('b', '2026-02-01', 40, 11_000),
    ]);

    expect(average).toBeCloseTo(6, 2);
  });

  it('acumula um parcial maior do que os depósitos atestados', () => {
    // (60 + 20) L / 1 000 km = 8,00 L/100 km.
    const average = averageFuelConsumption([
      fuel('a', '2026-01-01', 20, 10_000),
      fuel('parcial', '2026-01-15', 60, 10_500, false),
      fuel('b', '2026-02-01', 20, 11_000),
    ]);

    expect(average).toBeCloseTo(8, 2);
  });

  it('um abastecimento sem odómetro entre os dois atestados não produz consumo', () => {
    // A distância entre os dois atestados é conhecida, mas não se sabe em que ponto do
    // intervalo entrou o abastecimento sem odómetro: o Zemlo diz "sem dados" em vez de
    // atribuir os litros a uma distância que não consegue verificar (§49).
    const average = averageFuelConsumption([
      fuel('a', '2026-01-01', 60, 10_000),
      { ...fuel('sem-km', '2026-01-15', 20, 0), odometerKm: null },
      fuel('b', '2026-02-01', 40, 11_000),
    ]);

    expect(average).toBeNull();
  });

  it('um parcial sem odómetro entre os dois atestados não produz consumo', () => {
    const average = averageFuelConsumption([
      fuel('a', '2026-01-01', 40, 10_000),
      { ...fuel('sem-km', '2026-01-15', 10, 0, false), odometerKm: null },
      fuel('b', '2026-02-01', 50, 11_000),
    ]);

    expect(average).toBeNull();
  });

  it('não trata a quilometragem desconhecida como zero', () => {
    // Um abastecimento atestado sem odómetro não fecha intervalo nenhum: se a ausência
    // fosse lida como 0 km, a divisão por uma distância nula daria infinito.
    const average = averageFuelConsumption([
      fuel('a', '2026-01-01', 40, 10_000),
      { ...fuel('b', '2026-02-01', 60, 0), odometerKm: null },
    ]);

    expect(average).toBeNull();
  });

  it('devolve null quando não há dois depósitos atestados', () => {
    expect(averageFuelConsumption([])).toBeNull();
    expect(averageFuelConsumption([fuel('a', '2026-01-01', 60, 10_000)])).toBeNull();

    // Terminar num parcial não fecha intervalo: o depósito não ficou cheio.
    expect(
      averageFuelConsumption([
        fuel('a', '2026-01-01', 40, 10_000),
        fuel('parcial', '2026-02-01', 20, 11_000, false),
      ]),
    ).toBeNull();
  });

  it('ignora intervalos demasiado curtos em vez de os contar', () => {
    const average = averageFuelConsumption([
      fuel('a', '2026-01-01', 40, 10_000),
      fuel('b', '2026-01-01', 40, 10_005),
    ]);

    expect(average).toBeNull();
  });

  it('não conta os litros anteriores ao primeiro depósito atestado', () => {
    // O parcial inicial entra num depósito cujo nível se desconhece: não pertence a
    // nenhum intervalo medido.
    const average = averageFuelConsumption([
      fuel('inicial', '2026-01-01', 30, 9_000, false),
      fuel('a', '2026-01-10', 40, 10_000),
      fuel('b', '2026-02-01', 50, 11_000),
    ]);

    expect(average).toBeCloseTo(5, 2);
  });

  it('um abastecimento sem odómetro antes da âncora não contamina o intervalo seguinte', () => {
    // A regra é sobre um abastecimento sem odómetro **entre** dois atestados. Antes do
    // primeiro atestado não há intervalo a contaminar: o que vai dos 10 000 aos 11 000 km
    // é determinável.
    const average = averageFuelConsumption([
      { ...fuel('inicial', '2026-01-01', 30, 0), odometerKm: null },
      fuel('a', '2026-01-10', 40, 10_000),
      fuel('b', '2026-02-01', 50, 11_000),
    ]);

    expect(average).toBeCloseTo(5, 2);
  });
});

describe('preços derivados', () => {
  it('calcula o preço por litro em cêntimos', () => {
    expect(pricePerLitreCents(60, 10_200)).toBe(170);
  });

  it('calcula o preço por kWh em cêntimos', () => {
    expect(pricePerKwhCents(50, 600)).toBe(12);
  });

  it('devolve null sem divisão por zero', () => {
    expect(pricePerLitreCents(0, 1000)).toBeNull();
    expect(pricePerKwhCents(0, 1000)).toBeNull();
  });
});

/* ========================================================================== */
/* Consumo elétrico (§14)                                                     */
/* ========================================================================== */

describe('deriveChargingConsumption', () => {
  it('calcula o consumo entre dois carregamentos com quilometragem', () => {
    const derived = deriveChargingConsumption([
      { id: 'a', date: '2026-01-01', energyKwh: 50, amountCents: 600, odometerKm: 20_000, pricePerKwhCents: 12 },
      { id: 'b', date: '2026-02-01', energyKwh: 50, amountCents: 600, odometerKm: 20_400, pricePerKwhCents: 12 },
    ]);
    // 50 kWh em 400 km = 12,50 kWh/100 km.
    expect(derived.get('b')?.consumptionPer100Km).toBe(12.5);
    expect(derived.get('b')?.costPer100KmCents).toBe(150);
  });

  it('devolve null no primeiro carregamento', () => {
    const derived = deriveChargingConsumption([
      { id: 'a', date: '2026-01-01', energyKwh: 50, amountCents: 600, odometerKm: 20_000, pricePerKwhCents: 12 },
    ]);
    expect(derived.get('a')?.consumptionPer100Km).toBeNull();
  });

  it('média ponderada do consumo elétrico', () => {
    const average = averageEnergyConsumption([
      { id: 'a', date: '2026-01-01', energyKwh: 50, amountCents: 600, odometerKm: 20_000, pricePerKwhCents: 12 },
      { id: 'b', date: '2026-02-01', energyKwh: 50, amountCents: 600, odometerKm: 20_400, pricePerKwhCents: 12 },
      { id: 'c', date: '2026-03-01', energyKwh: 60, amountCents: 720, odometerKm: 20_800, pricePerKwhCents: 12 },
    ]);
    // 110 kWh em 800 km = 13,75 kWh/100 km.
    expect(average).toBeCloseTo(13.75, 2);
  });
});

/* ========================================================================== */
/* Quilometragem (§11)                                                        */
/* ========================================================================== */

describe('evaluateOdometerReading', () => {
  it('aceita a primeira leitura sem avisos', () => {
    const result = evaluateOdometerReading({
      next: 42_381,
      recordedAt: '2026-09-16',
      current: { odometerKm: null, recordedAt: null },
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.deltaKm).toBeNull();
  });

  it('aceita uma progressão normal', () => {
    const result = evaluateOdometerReading({
      next: 42_500,
      recordedAt: '2026-09-16',
      current: { odometerKm: 42_381, recordedAt: '2026-09-01' },
    });
    expect(result.ok).toBe(true);
    expect(result.deltaKm).toBe(119);
    expect(result.warnings).toHaveLength(0);
  });

  it('exige confirmação num recuo de quilometragem', () => {
    const result = evaluateOdometerReading({
      next: 40_000,
      recordedAt: '2026-09-16',
      current: { odometerKm: 42_381, recordedAt: '2026-09-01' },
    });
    expect(result.ok).toBe(false);
    expect(result.requiresConfirmation).toBe(true);
    expect(result.warnings[0]).toContain('recuou');
  });

  it('aceita o recuo depois de o utilizador confirmar', () => {
    const result = evaluateOdometerReading({
      next: 40_000,
      recordedAt: '2026-09-16',
      current: { odometerKm: 42_381, recordedAt: '2026-09-01' },
      userConfirmed: true,
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });

  it('deteta um salto implausível para o tempo decorrido', () => {
    const result = evaluateOdometerReading({
      next: 50_000,
      recordedAt: '2026-09-16',
      current: { odometerKm: 42_381, recordedAt: '2026-09-15' },
    });
    expect(result.requiresConfirmation).toBe(true);
    expect(result.warnings[0]).toContain('parece demasiado');
  });

  it('aceita um salto grande quando o tempo decorrido o justifica', () => {
    const result = evaluateOdometerReading({
      next: 60_000,
      recordedAt: '2026-09-16',
      current: { odometerKm: 42_381, recordedAt: '2026-01-01' },
    });
    // ~100 km/dia durante 8 meses: plausível, sem aviso.
    expect(result.requiresConfirmation).toBe(false);
  });

  it('recusa valores negativos ou não inteiros', () => {
    const negative = evaluateOdometerReading({
      next: -5,
      recordedAt: '2026-09-16',
      current: { odometerKm: null, recordedAt: null },
    });
    expect(negative.ok).toBe(false);
  });

  it('avisa quando a data é anterior à última leitura', () => {
    const result = evaluateOdometerReading({
      next: 42_400,
      recordedAt: '2026-08-01',
      current: { odometerKm: 42_381, recordedAt: '2026-09-01' },
    });
    expect(result.warnings.some((warning) => warning.includes('anterior'))).toBe(true);
  });
});

describe('estimateUsageRate', () => {
  it('estima o ritmo a partir de leituras regulares', () => {
    const rate = estimateUsageRate([
      { date: '2026-01-01', odometerKm: 0 },
      { date: '2026-01-31', odometerKm: 1000 },
      { date: '2026-03-02', odometerKm: 2000 },
      { date: '2026-04-01', odometerKm: 3000 },
    ]);
    expect(rate.kmPerDay).toBeCloseTo(33.3, 1);
    expect(rate.confident).toBe(true);
    expect(rate.kmPerYear).toBeCloseTo(12_175, -1);
  });

  it('não se deixa arrastar por uma única leitura aberrante', () => {
    /*
     * Uma estimativa tem de ser robusta a um erro de introdução. Não se espera que uma
     * regressão linear seja imune a um valor absurdo — espera-se que 20 leituras
     * coerentes continuem a dominar e que a ordem de grandeza se mantenha utilizável,
     * em vez de o ritmo saltar para valores que nenhum veículo faz.
     */
    const consistent = Array.from({ length: 20 }, (_, index) => ({
      date: dayOffset(index * 10),
      odometerKm: index * 300,
    }));

    const clean = estimateUsageRate(consistent);
    // 300 km a cada 10 dias = 30 km/dia.
    expect(clean.kmPerDay).toBeCloseTo(30, 0);
    expect(clean.confident).toBe(true);

    // Uma leitura de 500 000 km a meio do histórico (erro de digitação).
    const withOutlier = [...consistent];
    withOutlier[10] = { date: dayOffset(100), odometerKm: 500_000 };
    const contaminated = estimateUsageRate(withOutlier);

    expect(contaminated.kmPerDay).not.toBeNull();
    // Continua a ser um número que faz sentido para um veículo (não explode para
    // dezenas de milhares de km/dia).
    expect(contaminated.kmPerDay as number).toBeLessThan(1000);
  });

  it('exclui correções confirmadas do cálculo', () => {
    const rate = estimateUsageRate([
      { date: '2026-01-01', odometerKm: 100_000 },
      { date: '2026-02-01', odometerKm: 40_000, isCorrection: true },
      { date: '2026-03-01', odometerKm: 101_000 },
    ]);
    expect(rate.kmPerDay).toBeGreaterThan(0);
  });

  it('devolve null com menos de duas leituras', () => {
    expect(estimateUsageRate([{ date: '2026-01-01', odometerKm: 100 }]).kmPerDay).toBeNull();
    expect(estimateUsageRate([]).kmPerDay).toBeNull();
  });

  it('devolve null quando todas as leituras são no mesmo dia', () => {
    const rate = estimateUsageRate([
      { date: '2026-01-01', odometerKm: 100 },
      { date: '2026-01-01', odometerKm: 200 },
    ]);
    expect(rate.kmPerDay).toBeNull();
  });

  it('projeta a data para atingir uma quilometragem', () => {
    const rate = estimateUsageRate([
      { date: '2026-01-01', odometerKm: 0 },
      { date: '2026-01-31', odometerKm: 1000 },
      { date: '2026-03-02', odometerKm: 2000 },
      { date: '2026-04-01', odometerKm: 3000 },
    ]);
    const projected = projectDateForOdometer(4000, 3000, rate, '2026-04-01');
    expect(projected).not.toBeNull();
    // A ~33 km/dia, faltam 1 000 km: cerca de 30 dias.
    const days = daysBetweenDates('2026-04-01', projected as string);
    expect(days).toBeGreaterThanOrEqual(29);
    expect(days).toBeLessThanOrEqual(31);
  });

  it('não projeta datas a mais de cinco anos', () => {
    const rate = estimateUsageRate([
      { date: '2026-01-01', odometerKm: 0 },
      { date: '2026-01-31', odometerKm: 10 },
      { date: '2026-03-02', odometerKm: 20 },
    ]);
    expect(projectDateForOdometer(1_000_000, 20, rate, '2026-04-01')).toBeNull();
  });
});

/* ========================================================================== */
/* Lembretes (§16)                                                            */
/* ========================================================================== */

describe('evaluateReminder', () => {
  const baseContext = {
    today: '2026-09-16',
    odometerKm: 42_381,
    usage: { kmPerDay: 30, kmPerMonth: 912, kmPerYear: 10_957, samplesUsed: 5, confident: true },
    leadDays: 30,
    leadKm: 1000,
  };

  it('marca como em atraso um lembrete cuja data passou', () => {
    const evaluation = evaluateReminder(
      {
        id: '1',
        title: 'Revisão',
        trigger: 'time',
        dueDate: '2026-08-01',
        dueOdometerKm: null,
        completedAt: null,
      },
      baseContext,
    );
    expect(evaluation.state).toBe('overdue');
    expect(evaluation.summary).toContain('Em atraso');
  });

  it('marca como em breve o que está dentro da antecedência', () => {
    const evaluation = evaluateReminder(
      {
        id: '1',
        title: 'Revisão',
        trigger: 'time',
        dueDate: '2026-10-01',
        dueOdometerKm: null,
        completedAt: null,
      },
      baseContext,
    );
    expect(evaluation.state).toBe('soon');
    expect(evaluation.daysRemaining).toBe(15);
  });

  it('marca como em dia o que está longe', () => {
    const evaluation = evaluateReminder(
      {
        id: '1',
        title: 'Revisão',
        trigger: 'time',
        dueDate: '2027-06-01',
        dueOdometerKm: null,
        completedAt: null,
      },
      baseContext,
    );
    expect(evaluation.state).toBe('ok');
  });

  it('com condição dupla, dispara a condição mais próxima (§16)', () => {
    const evaluation = evaluateReminder(
      {
        id: '1',
        title: 'Revisão',
        trigger: 'both',
        dueDate: '2027-06-01',
        dueOdometerKm: 43_000,
        completedAt: null,
      },
      baseContext,
    );
    // Faltam 619 km (em breve) e 258 dias (em dia): ganha a quilometragem.
    expect(evaluation.state).toBe('soon');
    expect(evaluation.drivingCondition).toBe('distance');
  });

  it('projeta a data quando só há condição de quilometragem', () => {
    const evaluation = evaluateReminder(
      {
        id: '1',
        title: 'Revisão',
        trigger: 'distance',
        dueDate: null,
        dueOdometerKm: 43_381,
        completedAt: null,
      },
      baseContext,
    );
    // 1 000 km a 30 km/dia ≈ 34 dias.
    expect(evaluation.projectedDate).toBe('2026-10-20');
    expect(evaluation.daysRemaining).toBeNull();
  });

  it('devolve "sem dados" quando falta a quilometragem', () => {
    const evaluation = evaluateReminder(
      {
        id: '1',
        title: 'Revisão',
        trigger: 'distance',
        dueDate: null,
        dueOdometerKm: 50_000,
        completedAt: null,
      },
      { ...baseContext, odometerKm: null },
    );
    expect(evaluation.state).toBe('unknown');
  });

  it('um lembrete concluído fica em dia', () => {
    const evaluation = evaluateReminder(
      {
        id: '1',
        title: 'Revisão',
        trigger: 'both',
        dueDate: '2020-01-01',
        dueOdometerKm: 1,
        completedAt: '2026-09-01T10:00:00.000Z',
      },
      baseContext,
    );
    expect(evaluation.state).toBe('ok');
    expect(evaluation.summary).toBe('Concluído');
  });
});

describe('computeNextOccurrence', () => {
  it('conta a partir da data de conclusão e não da data agendada', () => {
    const next = computeNextOccurrence(
      { trigger: 'time', dueDate: '2026-01-01', dueOdometerKm: null, intervalMonths: 12, intervalKm: null },
      { completedOn: '2026-09-16', odometerKm: null },
    );
    // Uma revisão anual feita 8 meses atrasada não nasce já em atraso.
    expect(next.dueDate).toBe('2027-09-16');
  });

  it('conta a quilometragem a partir da quilometragem da conclusão', () => {
    const next = computeNextOccurrence(
      { trigger: 'distance', dueDate: null, dueOdometerKm: 50_000, intervalMonths: null, intervalKm: 10_000 },
      { completedOn: '2026-09-16', odometerKm: 52_500 },
    );
    expect(next.dueOdometerKm).toBe(62_500);
  });

  it('calcula as duas condições em simultâneo', () => {
    const next = computeNextOccurrence(
      { trigger: 'both', dueDate: '2026-01-01', dueOdometerKm: 50_000, intervalMonths: 12, intervalKm: 15_000 },
      { completedOn: '2026-09-16', odometerKm: 52_500 },
    );
    expect(next.dueDate).toBe('2027-09-16');
    expect(next.dueOdometerKm).toBe(67_500);
  });
});

/* ========================================================================== */
/* Agregações (§23)                                                           */
/* ========================================================================== */

describe('totais por categoria', () => {
  it('inclui as categorias sem atividade, a zero', () => {
    const totals = totalsByCategory([
      { date: '2026-01-01', amountCents: 10_000, category: 'fuel' },
      { date: '2026-02-01', amountCents: 5_000, category: 'maintenance' },
    ]);
    expect(totals.find((item) => item.category === 'fuel')?.amountCents).toBe(10_000);
    expect(totals.find((item) => item.category === 'tyres')?.amountCents).toBe(0);
    expect(totals.find((item) => item.category === 'fuel')?.share).toBeCloseTo(0.667, 2);
  });

  it('ordena por valor decrescente', () => {
    const totals = totalsByCategory([
      { date: '2026-01-01', amountCents: 1_000, category: 'fuel' },
      { date: '2026-02-01', amountCents: 9_000, category: 'insurance' },
    ]);
    expect(totals[0]?.category).toBe('insurance');
  });

  it('devolve share null quando o total é zero', () => {
    const totals = totalsByCategory([]);
    expect(totals[0]?.share).toBeNull();
  });
});

describe('totais mensais', () => {
  it('preenche os meses sem atividade com zero', () => {
    const monthly = totalsByMonth(
      [{ date: '2026-03-15', amountCents: 5_000, category: 'fuel' }],
      '2026-01-01',
      '2026-03-31',
    );
    expect(monthly).toHaveLength(3);
    expect(monthly[0]?.amountCents).toBe(0);
    expect(monthly[1]?.amountCents).toBe(0);
    expect(monthly[2]?.amountCents).toBe(5_000);
  });

  it('separa a energia do resto', () => {
    const monthly = totalsByMonth(
      [
        { date: '2026-01-10', amountCents: 5_000, category: 'fuel' },
        { date: '2026-01-20', amountCents: 3_000, category: 'insurance' },
      ],
      '2026-01-01',
      '2026-01-31',
    );
    expect(monthly[0]?.amountCents).toBe(8_000);
    expect(monthly[0]?.energyCents).toBe(5_000);
  });
});

describe('periodDistance', () => {
  it('prefere as leituras de odómetro', () => {
    const result = periodDistance({
      from: '2026-01-01',
      to: '2026-12-31',
      odometer: [
        { date: '2026-01-01', odometerKm: 10_000 },
        { date: '2026-12-31', odometerKm: 25_000 },
      ],
      fuel: [],
      charging: [],
    });
    expect(result.km).toBe(15_000);
    expect(result.basedOn).toBe('odometer');
  });

  it('recorre aos registos quando não há duas leituras', () => {
    const result = periodDistance({
      from: '2026-01-01',
      to: '2026-12-31',
      odometer: [],
      fuel: [fuel('a', '2026-01-02', 60, 10_000), fuel('b', '2026-12-30', 60, 13_000)],
      charging: [],
    });
    expect(result.km).toBe(3_000);
    expect(result.basedOn).toBe('records');
  });

  it('devolve null em vez de inventar uma distância', () => {
    const result = periodDistance({
      from: '2026-01-01',
      to: '2026-12-31',
      odometer: [{ date: '2026-06-01', odometerKm: 10_000 }],
      fuel: [],
      charging: [],
    });
    expect(result.km).toBeNull();
    expect(result.basedOn).toBeNull();
  });

  it('ignora as correções no cálculo da distância', () => {
    const result = periodDistance({
      from: '2026-01-01',
      to: '2026-12-31',
      odometer: [
        { date: '2026-01-01', odometerKm: 10_000 },
        { date: '2026-06-01', odometerKm: 3_000, isCorrection: true },
        { date: '2026-12-31', odometerKm: 15_000 },
      ],
      fuel: [],
      charging: [],
    });
    expect(result.km).toBe(5_000);
  });
});

describe('custos unitários', () => {
  it('calcula o custo por km', () => {
    const costs = unitCosts({
      from: '2026-01-01',
      to: '2026-12-31',
      expenses: [{ date: '2026-06-01', amountCents: 100_000, category: 'fuel' }],
      distance: { km: 10_000, basedOn: 'odometer', firstReadingDate: null, lastReadingDate: null },
    });
    // 1 000 € em 10 000 km = 10 cêntimos/km.
    expect(costs.costPerKmCents).toBe(10);
    expect(costs.energyCostPerKmCents).toBe(10);
  });

  it('devolve null em vez de dividir por zero', () => {
    const costs = unitCosts({
      from: '2026-01-01',
      to: '2026-12-31',
      expenses: [{ date: '2026-06-01', amountCents: 100_000, category: 'fuel' }],
      distance: { km: null, basedOn: null, firstReadingDate: null, lastReadingDate: null },
    });
    expect(costs.costPerKmCents).toBeNull();
    expect(costs.costPerMonthCents).not.toBeNull();
  });

  it('separa o custo de manutenção do custo de energia', () => {
    const costs = unitCosts({
      from: '2026-01-01',
      to: '2026-12-31',
      expenses: [
        { date: '2026-06-01', amountCents: 50_000, category: 'fuel' },
        { date: '2026-07-01', amountCents: 50_000, category: 'maintenance' },
      ],
      distance: { km: 10_000, basedOn: 'odometer', firstReadingDate: null, lastReadingDate: null },
    });
    expect(costs.energyCostPerKmCents).toBe(5);
    expect(costs.maintenanceCostPerKmCents).toBe(5);
  });
});

describe('consumptionSummary', () => {
  it('calcula o consumo por mês e o global', () => {
    const summary = consumptionSummary({
      from: '2026-01-01',
      to: '2026-02-28',
      fuel: [
        fuel('a', '2026-01-01', 60, 10_000),
        fuel('b', '2026-01-20', 60, 11_000),
        fuel('c', '2026-02-01', 60, 12_000),
        fuel('d', '2026-02-20', 66, 13_100),
      ],
      charging: [],
    });
    expect(summary.fuelMonthly).toHaveLength(2);
    expect(summary.fuelMonthly[0]?.value).toBe(6);
    expect(summary.fuelL100Km).toBeCloseTo(6, 1);
    expect(summary.fuelCostPerLitreCents).toBe(170);
  });

  it('não calcula consumo mensal com um único abastecimento no mês', () => {
    const summary = consumptionSummary({
      from: '2026-01-01',
      to: '2026-01-31',
      fuel: [fuel('a', '2026-01-01', 60, 10_000)],
      charging: [],
    });
    expect(summary.fuelMonthly[0]?.value).toBeNull();
  });

  it('o global e a série mensal acumulam os parciais (A8)', () => {
    // O painel lê `fuelL100Km` e a série mensal lê `fuelMonthly`: os dois têm de refletir
    // o parcial acumulado, senão o defeito do médio reaparece num ecrã diferente do que
    // foi corrigido.
    const summary = consumptionSummary({
      from: '2026-01-01',
      to: '2026-01-31',
      fuel: [
        fuel('a', '2026-01-01', 40, 10_000),
        fuel('parcial', '2026-01-15', 10, 10_500, false),
        fuel('b', '2026-01-25', 50, 11_000),
      ],
      charging: [],
    });

    // (10 + 50) L / 1 000 km = 6,00 L/100 km, e não 50 L / 500 km = 10,00.
    expect(summary.fuelMonthly[0]?.value).toBeCloseTo(6, 2);
    expect(summary.fuelL100Km).toBeCloseTo(6, 2);
  });
});

describe('comparePeriods', () => {
  it('compara com o período anterior', () => {
    const comparison = comparePeriods({
      current: [{ date: '2026-02-01', amountCents: 20_000, category: 'fuel' }],
      previous: [{ date: '2026-01-01', amountCents: 10_000, category: 'fuel' }],
      previousKm: 1_000,
      currentKm: 1_200,
    });
    expect(comparison.deltaCents).toBe(10_000);
    expect(comparison.deltaPercent).toBe(100);
    expect(comparison.deltaKm).toBe(200);
  });

  it('devolve percentagem null quando o período anterior era zero', () => {
    const comparison = comparePeriods({
      current: [{ date: '2026-02-01', amountCents: 20_000, category: 'fuel' }],
      previous: [],
      previousKm: null,
      currentKm: null,
    });
    // Uma variação de infinito por cento não é informação.
    expect(comparison.deltaPercent).toBeNull();
  });
});

describe('advancedStats', () => {
  it('não inventa depreciação sem preço de compra, e explica porquê', () => {
    const stats = advancedStats({
      purchaseDate: null,
      purchasePriceCents: null,
      purchaseOdometerKm: null,
      currentOdometerKm: 50_000,
      lifetimeCostCents: 200_000,
      firstRecordDate: '2025-01-01',
      today: '2026-09-16',
    });
    expect(stats.depreciationCents).toBeNull();
    expect(stats.assumptions.some((note) => note.includes('preço de compra'))).toBe(true);
  });

  it('estima a depreciação com uma curva decrescente e um piso', () => {
    const stats = advancedStats({
      purchaseDate: '2020-01-01',
      purchasePriceCents: 3_000_000,
      purchaseOdometerKm: 0,
      currentOdometerKm: 100_000,
      lifetimeCostCents: 500_000,
      firstRecordDate: '2020-01-01',
      today: '2026-09-16',
    });
    expect(stats.depreciationCents).not.toBeNull();
    expect(stats.residualValueCents).not.toBeNull();
    // O piso de 15% impede um valor residual irrealista.
    expect(stats.residualValueCents as number).toBeGreaterThanOrEqual(450_000);
    expect(stats.totalCostOfOwnershipCents).toBe(3_500_000);
    expect(stats.valuePerKmCents).toBe(5);
  });
});

describe('dataGaps', () => {
  it('fala em linguagem de produto e nunca em erro', () => {
    const gaps = dataGaps({
      odometerKm: null,
      hasInsurance: false,
      hasInspection: false,
      hasMaintenancePlan: false,
      hasExpenses: false,
      hasFuelOrCharging: false,
      vehicleId: 'v1',
      supportsRefuelling: true,
      supportsCharging: false,
    });
    expect(gaps.length).toBeGreaterThan(0);
    for (const gap of gaps) {
      expect(gap.title.length).toBeGreaterThan(0);
      expect(gap.message.length).toBeGreaterThan(10);
      expect(gap.message.toLowerCase()).not.toContain('erro');
      expect(gap.message.toLowerCase()).not.toContain('inválid');
    }
  });

  it('não sugere carregamento a um veículo a combustão', () => {
    const gaps = dataGaps({
      odometerKm: 10_000,
      hasInsurance: true,
      hasInspection: true,
      hasMaintenancePlan: true,
      hasExpenses: true,
      hasFuelOrCharging: false,
      vehicleId: 'v1',
      supportsRefuelling: true,
      supportsCharging: false,
    });
    expect(gaps.some((gap) => gap.key === 'charging')).toBe(false);
    expect(gaps.some((gap) => gap.key === 'fuel')).toBe(true);
  });

  it('não pede a quilometragem quando já existe', () => {
    const gaps = dataGaps({
      odometerKm: 42_381,
      hasInsurance: true,
      hasInspection: true,
      hasMaintenancePlan: true,
      hasExpenses: true,
      hasFuelOrCharging: true,
      vehicleId: 'v1',
      supportsRefuelling: true,
      supportsCharging: false,
    });
    expect(gaps).toHaveLength(0);
  });
});
