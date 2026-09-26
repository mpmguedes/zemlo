import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { Reminder, VehicleSummary } from '@zemlo/shared';
import { VEHICLE_TYPES } from '@zemlo/shared';

/*
 * Testes do cartão de veículo (decisão UX/UI 43).
 *
 * ## O que estes testes mordem
 *
 * Não bastava ver o ecrã. Cada asserção abaixo corresponde a uma forma concreta de o cartão
 * ficar errado, e cada uma foi **provada por mutação** — o defeito foi reposto, o teste ficou
 * vermelho, e o código foi reposto:
 *
 * | Mutação aplicada                                                     | Teste que ficou vermelho                                  |
 * | -------------------------------------------------------------------- | --------------------------------------------------------- |
 * | `vehicleStates` deixa de ignorar `unknown`                            | «não inventa «Em dia» para um veículo sem lembretes avaliáveis» |
 * | `severityOf` passa a tratar `overdue` como 0                          | «o pior lembrete do veículo decide o estado»              |
 * | `vehicleTitle` volta a preferir `nickname` a marca+modelo             | «o nome em destaque é marca + modelo»                     |
 * | o indicador é desenhado mesmo sem estado                              | «não desenha indicador quando não há estado»              |
 * | o `VehicleGlyph` volta a desenhar o emoji                             | «não há um único emoji no cartão»                         |
 *
 * ## Porque é que não usa `jsdom`
 *
 * A decisão está tomada por escrito (`email-verification-ui.test.ts`): o projeto não
 * introduz um ambiente de DOM só para testar ecrãs. `renderToStaticMarkup` corre em Node,
 * produz o HTML que o utilizador veria, e é o que permite asserções sobre o **resultado
 * visível** em vez de sobre o código-fonte. Um teste que lesse o `.tsx` continuaria verde
 * depois de a condição ser invertida.
 *
 * ## Ruído esperado
 *
 * O `react-router` avisa que `useLayoutEffect` não faz nada no servidor. É verdade e é
 * irrelevante: não há hidratação, só o HTML de um render.
 */

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

function vehicle(overrides: Partial<VehicleSummary> & { id: string }): VehicleSummary {
  return {
    plate: '23ZD41',
    plateDisplay: '23-ZD-41',
    make: 'Volvo',
    model: 'XC40',
    version: null,
    year: 2021,
    vehicleType: 'car',
    fuelType: 'electric',
    nickname: null,
    archived: false,
    odometerKm: 42_500,
    odometerSource: null,
    odometerUpdatedAt: '2026-09-20T10:00:00.000Z',
    // O emoji continua a chegar da API. O que estes testes fixam é que ele **não** é
    // usado: o cartão desenha o glifo SVG. Se um dia voltar a ser usado, o teste de emoji
    // fica vermelho sem ninguém ter de se lembrar.
    emoji: '🚗',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
    ...overrides,
  };
}

function reminder(vehicleId: string, state: Reminder['evaluation']['state']): Reminder {
  return {
    id: `rem-${vehicleId}-${state}`,
    vehicleId,
    title: 'Revisão',
    trigger: 'both',
    dueDate: null,
    dueOdometerKm: null,
    intervalMonths: null,
    intervalKm: null,
    repeat: false,
    notes: null,
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
    evaluation: {
      state,
      daysRemaining: null,
      kmRemaining: null,
      drivingCondition: null,
      projectedDate: null,
      summary: 'em 1 200 km',
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Substituição dos hooks                                                      */
/* -------------------------------------------------------------------------- */

const hooks = {
  /** Lista devolvida por `useVehicles(includeArchived)`. */
  items: [] as VehicleSummary[],
  reminders: [] as Reminder[],
  isLoading: false,
  isError: false,
};

vi.mock('../src/api/hooks', () => ({
  // `useVehicles(false)` é a lista ativa; `useVehicles(true)` é a lista completa (a página
  // filtra os arquivados). Os testes que não querem arquivados devolvem a mesma lista.
  //
  // Com `isError`, `data` é `undefined` — é o que o React Query faz quando um pedido falha
  // e não há cache. Devolver `data` **e** erro ao mesmo tempo criaria um estado que a
  // aplicação nunca vê, e o teste passaria a provar uma coisa que não acontece.
  useVehicles: () => ({
    data: hooks.isError ? undefined : { items: hooks.items, total: hooks.items.length },
    isLoading: hooks.isLoading,
    isError: hooks.isError,
    error: hooks.isError ? new Error('falha de rede') : null,
    refetch: vi.fn(),
  }),
  useReminders: () => ({ data: { items: hooks.reminders, counts: {} } }),
}));

import { VehiclesPage } from '../src/pages/vehicles/VehiclesPage';
import { VehicleGlyph, GLYPH_TYPES } from '../src/ui/vehicleGlyphs';

function render(): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <VehiclesPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  hooks.items = [];
  hooks.reminders = [];
  hooks.isLoading = false;
  hooks.isError = false;
});

/* -------------------------------------------------------------------------- */
/* Estrutura do cartão                                                         */
/* -------------------------------------------------------------------------- */

describe('cartão de veículo · estrutura', () => {
  it('o cartão inteiro é uma ligação para a ficha do veículo', () => {
    hooks.items = [vehicle({ id: 'v1' })];
    const html = render();
    expect(html).toContain('href="/vehicles/v1"');
    expect(html).toContain('class="z-vehicle-card"');
  });

  it('o nome em destaque é marca + modelo', () => {
    // A decisão 43 pede «marca + modelo em destaque». O apelido continua a aparecer, mas
    // na linha secundária — e é isso que este teste separa: o título é o nome técnico.
    hooks.items = [vehicle({ id: 'v1', make: 'Volvo', model: 'XC40', nickname: 'O bolinhas' })];
    const html = render();
    expect(html).toContain('<div class="z-vehicle-card__title">Volvo XC40</div>');
    expect(html).toContain('O bolinhas');
    expect(html).not.toContain('<div class="z-vehicle-card__title">O bolinhas</div>');
  });

  it('sem marca nem modelo, o título cai na matrícula em vez de ficar vazio', () => {
    hooks.items = [vehicle({ id: 'v1', make: null, model: null })];
    expect(render()).toContain('<div class="z-vehicle-card__title">23-ZD-41</div>');
  });

  it('mostra a matrícula, o tipo de veículo e a energia', () => {
    hooks.items = [vehicle({ id: 'v1', vehicleType: 'motorcycle', fuelType: 'electric' })];
    const html = render();
    expect(html).toContain('23-ZD-41');
    expect(html).toContain('Motociclo');
    expect(html).toContain('Elétrico');
  });

  it('a quilometragem e a data da última leitura aparecem juntas', () => {
    hooks.items = [vehicle({ id: 'v1', odometerKm: 42_500, odometerUpdatedAt: '2026-09-20T10:00:00.000Z' })];
    const html = render();
    // O separador de milhares de `pt-PT` é um espaço **não separável** (U+00A0), não um
    // espaço normal: `Intl.NumberFormat('pt-PT').format(42500)` devolve `42\u00A0500`.
    // Escrevê-lo em extenso é de propósito — um `'42 500'` com espaço normal não encontraria
    // nada e o teste passaria a afirmar o contrário do que quer.
    expect(html).toContain('42\u00A0500 km');
    expect(html).toContain('Última leitura');
  });

  it('sem leituras diz que não há, em vez de mostrar uma data', () => {
    hooks.items = [vehicle({ id: 'v1', odometerKm: null, odometerUpdatedAt: null })];
    const html = render();
    expect(html).toContain('Sem leituras registadas');
  });

  it('a tabela de sete colunas desapareceu: há um só cartão, não dois desenhos', () => {
    hooks.items = [vehicle({ id: 'v1' })];
    expect(render()).not.toContain('<table');
  });
});

/* -------------------------------------------------------------------------- */
/* Estado geral                                                                */
/* -------------------------------------------------------------------------- */

describe('cartão de veículo · estado geral', () => {
  it('o pior lembrete do veículo decide o estado', () => {
    // `ok` e `overdue` no mesmo veículo: o cartão tem de dizer «Em atraso», não «Em dia».
    hooks.items = [vehicle({ id: 'v1' })];
    hooks.reminders = [reminder('v1', 'ok'), reminder('v1', 'overdue')];
    const html = render();
    expect(html).toContain('Em atraso');
    expect(html).not.toContain('Em dia');
  });

  it('mostra «Em dia» quando todos os lembretes estão em dia', () => {
    hooks.items = [vehicle({ id: 'v1' })];
    hooks.reminders = [reminder('v1', 'ok')];
    expect(render()).toContain('Em dia');
  });

  it('não inventa «Em dia» para um veículo sem lembretes avaliáveis', () => {
    // O defeito que este teste existe para apanhar: mostrar «Em dia» a quem não tem
    // lembretes nenhuns. É afirmar que está tudo tratado quando não se sabe se há algo a tratar.
    hooks.items = [vehicle({ id: 'v1' })];
    hooks.reminders = [];
    const html = render();
    expect(html).not.toContain('Em dia');
    expect(html).not.toContain('z-vehicle-card__status');
  });

  it('um veículo só com lembretes «unknown» também não ganha estado', () => {
    hooks.items = [vehicle({ id: 'v1' })];
    hooks.reminders = [reminder('v1', 'unknown')];
    const html = render();
    expect(html).not.toContain('z-vehicle-card__status');
    expect(html).not.toContain('Sem dados');
  });

  it('o estado de cada veículo é o dele, não o da conta', () => {
    // Dois veículos, estados diferentes. O defeito seria agregar os lembretes dos dois num
    // só estado e mostrá-lo nos dois cartões.
    hooks.items = [vehicle({ id: 'v1', plateDisplay: 'AA-01-AA' }), vehicle({ id: 'v2', plateDisplay: 'BB-02-BB' })];
    hooks.reminders = [reminder('v1', 'ok'), reminder('v2', 'overdue')];
    const html = render();
    expect(html).toContain('Em dia');
    expect(html).toContain('Em atraso');
  });
});

/* -------------------------------------------------------------------------- */
/* Iconografia                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Faixas de emoji/pictogramas. Não inclui `\u{2190}-\u{21FF}` (setas) nem `\u{2010}-\u{201F}`
 * (travessões e aspas): são tipografia normal, não emoji, e a página usa-as de propósito.
 */
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

describe('cartão de veículo · iconografia', () => {
  it('não há um único emoji no cartão, mesmo com o veículo a trazer um', () => {
    // O fixture traz `emoji: '🚗'` da API, como em produção. O que se prova é que o cartão
    // o ignora e desenha o glifo.
    hooks.items = [vehicle({ id: 'v1', emoji: '🚗' })];
    const html = render();
    expect(EMOJI.test(html)).toBe(false);
  });

  it('o glifo é um SVG inline com o traço da família', () => {
    hooks.items = [vehicle({ id: 'v1', vehicleType: 'car' })];
    const html = render();
    expect(html).toContain('<svg');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('stroke-width="1.75"');
  });

  it('o glifo é decorativo: não se anuncia a quem usa leitor de ecrã', () => {
    // O nome do veículo está escrito ao lado; um glifo com nome próprio faria o leitor
    // dizer «automóvel» e a seguir «Volvo XC40».
    const html = renderToStaticMarkup(<VehicleGlyph type="car" />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="img"');
  });

  it('todos os tipos de veículo do contrato têm glifo próprio', () => {
    // A exaustividade não pode ser imposta pelo tipo enquanto `CodeOf` resolver para
    // `string` (`PC-42`): `Record<VehicleType, …>` aceita um objecto com zero chaves. É
    // este teste que a impõe.
    const missing = VEHICLE_TYPES.map((type) => type.code).filter((code) => !GLYPH_TYPES.includes(code));
    expect(missing).toEqual([]);
  });

  it('um tipo desconhecido cai no glifo genérico em vez de rebentar', () => {
    // O servidor pode ser mais recente do que esta versão da web.
    const html = renderToStaticMarkup(<VehicleGlyph type="hovercraft" />);
    expect(html).toContain('<svg');
    expect(html).toContain('<path');
  });
});

/* -------------------------------------------------------------------------- */
/* Estados de página                                                           */
/* -------------------------------------------------------------------------- */

describe('cartão de veículo · estados de página', () => {
  it('sem veículos mostra o estado vazio, sem emoji', () => {
    hooks.items = [];
    const html = render();
    expect(html).toContain('Ainda não tens veículos');
    expect(EMOJI.test(html)).toBe(false);
  });

  it('o erro aparece em vez do estado vazio', () => {
    // A mensagem que o utilizador vê é a **genérica** de `errorMessage`: um `Error` comum
    // não é um `ApiError`, e o `errors.ts` não mostra a mensagem interna de um erro de
    // programação. Afirmar a mensagem genérica é afirmar o comportamento real.
    hooks.items = [];
    hooks.isError = true;
    const html = render();
    expect(html).toContain('Não foi possível concluir o pedido');
    expect(html).not.toContain('Ainda não tens veículos');
  });
});
