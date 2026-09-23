import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/*
 * Testes de renderização dos estados de página (`WEB-005`).
 *
 * ## Porque é que isto não usa `@testing-library` nem `jsdom`
 *
 * O projeto decidiu, por escrito (`email-verification-ui.test.ts`), não introduzir um
 * ambiente de DOM só para testar ecrãs. Esta suíte respeita essa decisão e ainda assim
 * **renderiza componentes a sério**: `renderToStaticMarkup` do `react-dom/server` corre em
 * Node, produz o HTML que o utilizador veria, e não precisa de `document`.
 *
 * O que se perde face ao `@testing-library`: não há interação (cliques, escrita). O que não
 * se perde — e é o que estes testes existem para provar — é a asserção sobre o **resultado
 * visível** de cada estado. Um teste que verificasse a condição no código-fonte não morderia
 * nada: continuaria verde depois de a condição ser invertida, porque só lê texto.
 *
 * ## O que estes testes mordem
 *
 * Os defeitos de estado encontrados na auditoria, todos **provados por mutação** antes de
 * serem considerados válidos. Cada linha repõe o defeito, confirma que o teste fica vermelho,
 * e repõe o código:
 *
 * | Mutação aplicada                                              | Teste que ficou vermelho                        |
 * | ------------------------------------------------------------- | ----------------------------------------------- |
 * | `CalendarGrid`: retirar `&& !error` da condição do estado vazio | «não afirma «nada marcado» quando o mês não pôde ser carregado» |
 * | `InsuranceTab`: `policies.isError` → inalcançável              | «o separador do seguro mostra o erro quando o pedido falha» |
 * | `InsuranceTab`: `policies.isLoading` → inalcançável            | «o separador do seguro anuncia o carregamento»   |
 * | `InsuranceTab`: devolver o `InlineError` sem o `div` do painel | «o painel tem sempre um alvo para o `aria-controls`» |
 * | `OverviewTab`: `dashboard.isError` e `dashboard.isLoading` → inalcançáveis | «mostra o erro quando os custos do ano falham» + «anuncia o carregamento dos custos do ano» |
 *
 * Uma nota honesta: o teste do `aria-controls` **não** distingue as guardas de carregamento
 * e de erro — com qualquer delas removida, o painel continua a existir porque o render
 * normal também o desenha. O que ele discrimina é o `div` do painel: foi por isso que a
 * mutação escolhida para o provar foi retirar o `div`, e não a guarda.
 *
 * ## Porque é que os hooks são substituídos
 *
 * O objetivo é o estado, não a rede. `vi.mock` do módulo de hooks dá a cada consulta o
 * estado que o teste quer observar, e é isso que torna cada caso determinístico e rápido.
 *
 * ## Ruído esperado na saída
 *
 * O `react-router` avisa que `useLayoutEffect` não faz nada no servidor. É verdade e é
 * irrelevante aqui: não há hidratação, só o HTML de um render. Os avisos não são falhas.
 */

/* -------------------------------------------------------------------------- */
/* `CalendarGrid` — o estado vazio não pode aparecer durante o erro            */
/* -------------------------------------------------------------------------- */

import { CalendarGrid } from '../src/components/CalendarGrid';
import { QuickLogProvider } from '../src/components/QuickLogContext';

const EMPTY_MONTH_TITLE = 'Nada marcado neste mês';

function renderGrid(overrides: Partial<Parameters<typeof CalendarGrid>[0]> = {}): string {
  return renderToStaticMarkup(
    <CalendarGrid
      month="2026-09"
      onMonthChange={() => {}}
      data={undefined}
      isLoading={false}
      error={null}
      {...overrides}
    />,
  );
}

describe('CalendarGrid · estado vazio e estado de erro são distintos', () => {
  it('não afirma «nada marcado» quando o mês não pôde ser carregado', () => {
    // O defeito: `data === undefined` por erro produzia a mesma condição que um mês vazio.
    const html = renderGrid({ error: new Error('falha de rede'), data: undefined });
    expect(html).not.toContain(EMPTY_MONTH_TITLE);
  });

  it('mantém a grelha desenhada por baixo do erro', () => {
    // O erro é desenhado pelo `CalendarPage`, acima. A grelha continua a ser um calendário —
    // se desaparecesse, o erro ficaria sozinho num ecrã sem contexto.
    //
    // As asserções são **estruturais de propósito**, e não sobre o título do mês. Esse título
    // sai de `Intl`, e um teste preso ao texto formatado ficaria dependente dos dados do CLDR
    // em vez do estado que aqui se quer provar — mudaria de cor sozinho, sem ninguém ter
    // mexido no estado de erro. O que se prova é que a grelha continua montada: o `role`,
    // o rótulo acessível e os dias da semana (texto literal do componente).
    const html = renderGrid({ error: new Error('falha de rede') });
    expect(html).toContain('role="grid"');
    expect(html).toContain('aria-label="Calendário de ');
    expect(html).toContain('seg');
  });

  it('afirma «nada marcado» quando o mês carregou e está mesmo vazio', () => {
    const html = renderGrid({
      error: null,
      data: { entries: [], days: [] } as unknown as Parameters<typeof CalendarGrid>[0]['data'],
    });
    expect(html).toContain(EMPTY_MONTH_TITLE);
  });

  it('não afirma «nada marcado» enquanto está a carregar', () => {
    expect(renderGrid({ isLoading: true })).not.toContain(EMPTY_MONTH_TITLE);
  });

  it('não afirma «nada marcado» quando o mês tem entradas', () => {
    const html = renderGrid({
      data: {
        entries: [
          {
            id: 'e1',
            date: '2026-09-10',
            title: 'Inspeção',
            icon: '📋',
            vehiclePlateDisplay: '42-38-EL',
            subtitle: null,
            projected: false,
            state: 'ok',
            amountCents: null,
            href: null,
          },
        ],
        days: [{ date: '2026-09-10', count: 1, hasOverdue: false }],
      } as unknown as Parameters<typeof CalendarGrid>[0]['data'],
    });
    expect(html).not.toContain(EMPTY_MONTH_TITLE);
  });
});

/* -------------------------------------------------------------------------- */
/* Ficha do veículo — os separadores não podem falhar em silêncio             */
/* -------------------------------------------------------------------------- */

/**
 * Estado de consulta para os testes.
 *
 * O objeto tem a forma que os componentes leem (`data`, `isLoading`, `isError`, `error`,
 * `refetch`). Não é um duplo da biblioteca de consultas: é o mínimo que satisfaz o contrato
 * usado — e mantê-lo mínimo faz o teste falhar se o componente passar a depender de mais.
 */
function query(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    isPending: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

const VEHICLE = {
  id: 'v1',
  plateDisplay: '42-38-EL',
  nickname: null,
  make: 'Kia',
  model: 'EV6',
  year: 2023,
  archived: false,
  odometerKm: 43560,
  odometerUpdatedAt: null,
  totalCostCents: 0,
  counts: { expenses: 0, fuel: 0, charging: 0, maintenance: 0, documents: 0, reminders: 0 },
};

const hooks = vi.hoisted(() => {
  const state: { insurance: Record<string, unknown>; stats: Record<string, unknown> } = {
    insurance: {},
    stats: {},
  };
  return { state };
});

vi.mock('../src/api/hooks', () => ({
  useVehicle: () => query({ data: VEHICLE }),
  useInsurance: () => hooks.state.insurance,
  useCreateInsurance: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useCreateInspection: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useCreateReminder: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useCreateTax: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useCompleteReminder: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useDeleteReminder: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useDeleteVehicle: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useDocuments: () => query(),
  useInspections: () => query(),
  useOdometerReadings: () => query(),
  useProfile: () => query(),
  useReminders: () => query(),
  useSnoozeReminder: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useStats: () => hooks.state.stats,
  useTaxes: () => query(),
  useUpdateVehicle: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
}));

const { VehicleDetailPage } = await import('../src/pages/vehicles/VehicleDetailPage');

/**
 * Renderiza a ficha no separador pedido.
 *
 * O `QuickLogProvider` é obrigatório porque o separador de resumo usa `useQuickLog`, que
 * falha alto fora do provedor. Não é preciso um cliente de consultas: a folha de registo
 * rápido devolve `null` enquanto `kind` for `null`, e é aí que vive o único `useQueryClient`
 * do caminho. Montar um cliente de consultas só para isto daria ao teste uma dependência
 * que ele não usa.
 */
function renderTab(tab: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[`/vehicles/v1?tab=${tab}`]}>
      <QuickLogProvider>
        <Routes>
          <Route path="/vehicles/:vehicleId" element={<VehicleDetailPage />} />
        </Routes>
      </QuickLogProvider>
    </MemoryRouter>,
  );
}

describe('ficha do veículo · separadores com pedido próprio', () => {
  beforeEach(() => {
    hooks.state.insurance = query({ data: { items: [], total: 0 } });
  });

  it('o separador do seguro mostra o erro quando o pedido falha', () => {
    // O defeito: sem leitura de `isError`, o separador ficava vazio — este teste falhava
    // porque a mensagem da API não aparecia em lado nenhum.
    hooks.state.insurance = query({
      isError: true,
      error: new Error('Falha ao carregar'),
    });
    const html = renderTab('insurance');
    expect(html).toContain('Tentar novamente');
    expect(html).toContain('id="panel-insurance"');
  });

  it('o separador do seguro anuncia o carregamento', () => {
    hooks.state.insurance = query({ isLoading: true });
    expect(renderTab('insurance')).toContain('A carregar o seguro');
  });

  it('o separador do seguro mostra o estado vazio quando não há apólices', () => {
    const html = renderTab('insurance');
    expect(html).toContain('Sem apólice registada');
    expect(html).not.toContain('Tentar novamente');
  });

  it('o painel tem sempre um alvo para o `aria-controls` do separador', () => {
    // `aria-controls` aponta para `panel-insurance`. Se o estado devolvesse um bloco solto,
    // o atributo apontaria para um elemento inexistente.
    hooks.state.insurance = query({ isLoading: true });
    expect(renderTab('insurance')).toContain('id="panel-insurance"');
    hooks.state.insurance = query({ isError: true, error: new Error('x') });
    expect(renderTab('insurance')).toContain('id="panel-insurance"');
  });
});

/* -------------------------------------------------------------------------- */
/* Ficha do veículo — o resumo do ano não pode desaparecer em silêncio         */
/* -------------------------------------------------------------------------- */

describe('ficha do veículo · resumo do ano', () => {
  beforeEach(() => {
    hooks.state.stats = query();
  });

  it('mostra o erro quando os custos do ano falham', () => {
    // O defeito: `dashboard.data ? (…) : null`. Com o pedido falhado, `data` era `undefined`
    // e a secção **não existia** — sem mensagem, sem repetição. O ecrã parecia completo.
    hooks.state.stats = query({ isError: true, error: new Error('Falha ao carregar') });
    const html = renderTab('overview');
    expect(html).toContain('Tentar novamente');
    expect(html).toContain('id="panel-overview"');
  });

  it('anuncia o carregamento dos custos do ano', () => {
    hooks.state.stats = query({ isLoading: true });
    expect(renderTab('overview')).toContain('A carregar os custos do ano');
  });
});
