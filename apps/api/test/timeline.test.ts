/**
 * Testes dos links da timeline (`recordHref` e a sua propagação até ao item).
 *
 * Existem por causa do 🔴-2 / `AUD-002`: a timeline emitia links para rotas que a cadeia
 * API+web não serve, e um clique dava 404. Um teste que só verificasse "devolve uma string
 * começada por `/`" passaria com o defeito lá dentro — o que este ficheiro fixa é a
 * correspondência entre o `recordType` e uma rota que **existe**, e a ausência de ligação
 * quando não existe ecrã.
 *
 * As rotas esperadas não são inventadas aqui: vêm de `apps/web/src/App.tsx` (declaração das
 * rotas da web) e de `apps/api/src/http/routes/` (o que a API expõe). Estão escritas em
 * extenso de propósito: se a web mudar um caminho, é este ficheiro que tem de ser revisto, e
 * não uma tabela partilhada que se atualiza sozinha nos dois lados sem ninguém olhar.
 *
 * Não toca na base de dados nem em HTTP: `recordHref` é uma função pura.
 */

import { describe, expect, it } from 'vitest';
import { formatKm } from '@zemlo/shared';
import {
  buildTimelineFromRecords,
  mapEventToTimelineItem,
  recordHref,
  type EventRow,
  type RecordTimelineInput,
} from '../src/domain/timeline.js';

/* -------------------------------------------------------------------------- */
/* Auxiliares                                                                  */
/* -------------------------------------------------------------------------- */

/** Linha de `VehicleEvent` com os valores que os testes não especificam. */
function event(overrides: Partial<EventRow> & { id: string; type: string }): EventRow {
  return {
    vehicleId: 'veh-1',
    date: '2026-01-15',
    title: 'Registo',
    summary: null,
    icon: null,
    amountCents: null,
    odometerKm: null,
    recordType: null,
    recordId: null,
    source: null,
    createdAt: new Date('2026-01-15T10:00:00.000Z'),
    ...overrides,
  };
}

function record(overrides: Partial<RecordTimelineInput> & { id: string; kind: RecordTimelineInput['kind'] }): RecordTimelineInput {
  return {
    date: '2026-01-15',
    createdAt: new Date('2026-01-15T10:00:00.000Z'),
    title: 'Registo',
    subtitle: null,
    icon: '•',
    amountCents: null,
    odometerKm: null,
    vehicleId: 'veh-1',
    ...overrides,
  };
}

const CONTEXT = { plateDisplay: 'AA-00-AA' };

/**
 * Os sete tipos cujo detalhe vive sob `/records/<rota>/<id>`.
 *
 * Cada valor é o par (`recordType` escrito nos eventos, rota declarada na web). O
 * `recordType` está verificado em `services/`; a rota está verificada em `App.tsx` e nas
 * rotas da API (`financial.ts`, `compliance.ts`).
 */
const RECORD_ROUTES: Array<[string, string]> = [
  ['expense', 'expenses'],
  ['fuel', 'fuel'],
  ['charging', 'charging'],
  ['maintenance', 'maintenance'],
  ['insurance', 'insurance'],
  ['inspection', 'inspections'],
  ['tax', 'taxes'],
];

/**
 * Todos os `recordType` que o Zemlo escreve num evento, com o href esperado.
 *
 * A lista foi levantada de `apps/api/src/services/` (todas as chamadas a `recordEvent` com
 * `recordType`). `null` significa "não existe ecrã para este registo, e portanto não há
 * ligação" — não é uma lacuna, é a resposta certa.
 */
const ALL_RECORD_TYPES: Array<[string, string | null]> = [
  ['expense', '/records/expenses/abc'],
  ['fuel', '/records/fuel/abc'],
  ['charging', '/records/charging/abc'],
  ['maintenance', '/records/maintenance/abc'],
  ['insurance', '/records/insurance/abc'],
  ['inspection', '/records/inspections/abc'],
  ['tax', '/records/taxes/abc'],
  ['document', '/documents/abc'],
  ['reminder', null],
  ['vehicle', null],
  ['odometer', null],
];

/* -------------------------------------------------------------------------- */
/* recordHref                                                                  */
/* -------------------------------------------------------------------------- */

describe('recordHref — só devolve rotas que a cadeia API+web serve', () => {
  it.each(RECORD_ROUTES)('encaminha %s para a rota de detalhe /records/%s/<id>', (recordType, route) => {
    expect(recordHref(recordType, 'abc')).toBe(`/records/${route}/abc`);
  });

  it('encaminha o documento para /documents/, não para /records/documents/ (🔴-2)', () => {
    // A web serve o detalhe do documento em `/documents/:documentId` (`App.tsx`); a API não
    // expõe `/records/documents/:id`. O href antigo dava 404.
    expect(recordHref('document', 'doc-1')).toBe('/documents/doc-1');
  });

  it('não gera ligação para um lembrete — não existe ecrã de detalhe (🔴-2)', () => {
    // A API expõe os lembretes em `/reminders/:reminderId`, e não em `/records/reminders/:id`;
    // a web não tem ecrã de detalhe de um lembrete. A lista está em `/records/reminders`, mas
    // apontar um lembrete concreto para uma lista não é "abrir o registo certo".
    expect(recordHref('reminder', 'rem-1')).toBeNull();
  });

  it('não gera ligação para o odómetro, mesmo com identificador', () => {
    // Nos eventos reais o `recordId` do odómetro é nulo (`vehicles.ts`), pelo que o guarda de
    // entrada já devolveria `null`. Este teste fixa o caso com identificador preenchido: a
    // razão para não haver ligação não é o dado em falta, é não existir ecrã.
    expect(recordHref('odometer', 'odo-1')).toBeNull();
  });

  it('não gera ligação para o veículo', () => {
    // O evento `vehicle.created` escreve `recordType: 'vehicle'` (`vehicles.ts`), que nunca
    // esteve no mapa. Fica fixado para que a ausência seja uma decisão e não um esquecimento.
    expect(recordHref('vehicle', 'veh-1')).toBeNull();
  });

  it('devolve null para um tipo desconhecido', () => {
    expect(recordHref('telemetria', 'x')).toBeNull();
    expect(recordHref('', 'x')).toBeNull();
  });

  it('devolve null quando falta o tipo ou o identificador', () => {
    expect(recordHref(null, 'abc')).toBeNull();
    expect(recordHref('fuel', null)).toBeNull();
    expect(recordHref(null, null)).toBeNull();
  });

  it.each(ALL_RECORD_TYPES)(
    'o href de %s é o esperado, ou null quando não há ecrã',
    (recordType, expected) => {
      expect(recordHref(recordType, 'abc')).toBe(expected);
    },
  );

  it('nenhum href aponta para as três rotas que davam 404', () => {
    // O teste que morde: se alguém voltar a acrescentar `documents`, `reminders` ou `odometer`
    // ao mapa de rotas, este teste falha — e falha pelo motivo certo, sem depender de alguém
    // se lembrar do histórico.
    const proibidos = ['/records/documents/', '/records/reminders/', '/records/odometer/'];
    for (const [recordType] of ALL_RECORD_TYPES) {
      const href = recordHref(recordType, 'abc');
      if (href === null) continue;
      for (const proibido of proibidos) {
        expect(href.startsWith(proibido), `${recordType} → ${href}`).toBe(false);
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Propagação até ao item de timeline                                          */
/* -------------------------------------------------------------------------- */

describe('propagação do href para o item de timeline', () => {
  it('um evento de inspeção chega ao item com a rota de detalhe', () => {
    const item = mapEventToTimelineItem(
      event({ id: 'ev-1', type: 'inspection.created', recordType: 'inspection', recordId: 'ins-1' }),
      CONTEXT,
    );
    expect(item.href).toBe('/records/inspections/ins-1');
  });

  it('um evento de documento chega ao item com a rota do documento', () => {
    const item = mapEventToTimelineItem(
      event({ id: 'ev-2', type: 'document.created', recordType: 'document', recordId: 'doc-9' }),
      CONTEXT,
    );
    expect(item.href).toBe('/documents/doc-9');
  });

  it('um evento de odómetro chega ao item sem ligação, e o item continua completo', () => {
    // `href: null` é um valor de primeira classe: a UI mostra o item sem o envolver em
    // `<Link>`. O que não pode acontecer é o item perder os dados por não ter ligação.
    const item = mapEventToTimelineItem(
      event({
        id: 'ev-3',
        type: 'odometer.recorded',
        recordType: 'odometer',
        recordId: null,
        odometerKm: 123_456,
      }),
      CONTEXT,
    );
    expect(item.href).toBeNull();
    expect(item.kind).toBe('odometer');
    expect(item.odometerKm).toBe(123_456);
    // O valor é comparado pelo formatador partilhado, e não por uma cadeia escrita à mão: o
    // separador de milhares do `pt-PT` é um espaço especial, e fixá-lo aqui tornaria o teste
    // dependente do ICU em vez de dependente do produto.
    expect(item.metrics).toContainEqual({ label: 'Quilometragem', value: `${formatKm(123_456)} km` });
  });

  it('um evento sem tipo de registo não gera ligação', () => {
    const item = mapEventToTimelineItem(event({ id: 'ev-4', type: 'vehicle.created' }), CONTEXT);
    expect(item.href).toBeNull();
  });

  it('os itens gerados a partir de registos levam o href do próprio tipo', () => {
    const items = buildTimelineFromRecords(
      [
        record({ id: 'f1', kind: 'fuel' }),
        record({ id: 'i1', kind: 'inspection' }),
        record({ id: 'd1', kind: 'document' }),
        record({ id: 'r1', kind: 'reminder' }),
      ],
      CONTEXT,
    );
    expect(items.map((item) => item.href)).toEqual([
      '/records/fuel/f1',
      '/records/inspections/i1',
      '/documents/d1',
      null,
    ]);
  });
});
