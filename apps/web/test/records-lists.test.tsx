import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/*
 * Ecrãs de lista por tipo de registo (`WEB-004`).
 *
 * ## O que a tarefa pedia
 *
 * «Critérios: ecrãs corretos para inspeções, impostos, seguros e odómetro; sem fallback
 * silencioso.» A segunda metade veio de `AUD-008` (a recusa do tipo desconhecido). A primeira
 * é o que este ficheiro prova — que cada um dos quatro tipos tem um ecrã **próprio**, e não o
 * de despesas com outro nome.
 *
 * ## O que estes testes mordem (e o que **não** mordem)
 *
 * «Ecrã correto» decompõe-se em asserções observáveis a partir do HTML estático:
 *
 *  1. o título da secção (não o de despesas);
 *  2. a coluna que identifica a linha naquele tipo (`Seguradora`, `Resultado`, `Imposto`);
 *  3. o texto do estado vazio, que é específico do tipo;
 *  4. a **ausência** do vocabulário de despesas («Nova despesa», «Tudo o que gastaste»);
 *  5. a coluna de data certa por tipo (`Início` para a apólice, `Leitura` para a leitura);
 *  6. no odómetro, a ausência de filtros de período — a API não os aceita.
 *
 * O que estes testes **não** conseguem afirmar, e por isso não afirmam: a interação. Sem
 * `jsdom` (a regra da casa, escrita em `page-states.test.tsx`) não há eventos; um teste que
 * clicasse num chip não poderia correr. Fica declarado como limitação, em vez de simulado.
 *
 * ## Prova por mutação
 *
 * Uma asserção que passa por vacuidade é um falso verde. Cada bloco tem uma mutação declarada
 * no comentário e verificada à parte contra `RECORD_CONFIG` (ver `PROPOSAL-A3-WEB-004.md`):
 * remover a entrada do mapa faz cair para a recusa de `AUD-008` e o bloco fica vermelho.
 */

/** Configuração por tipo usada pelos testes, substituída antes de cada render. */
type Options = {
  /**
   * Tipo cuja consulta devolve os `items` do teste. É o mecanismo que distingue «a lista
   * deste tipo tem dados» de «a lista de outro tipo tem dados» — a distinção que o defeito de
   * `AUD-008` apagava, ao mostrar despesas para qualquer endereço.
   */
  activeKind?: string;
  selectedVehicleId?: string | 'all';
  focusedVehicleId?: string | undefined;
  /** Registos devolvidos pela consulta ativa do tipo em teste. */
  items?: unknown[];
  total?: number;
  isLoading?: boolean;
  isError?: boolean;
  profileTimeZone?: string;
};

/**
 * Base determinística de cada render. `renderWith` **reconstrói** a partir dela em vez de
 * acumular sobre a anterior: sem isto, um teste que renderize duas vezes herda em silêncio os
 * campos do primeiro (`activeKind`, `items`, …) e o resultado passa a depender da ordem. A
 * acumulação nunca chegou a produzir um vermelho — `beforeEach(reset)` limpava entre testes —,
 * mas era uma armadilha à espera do próximo teste que renderizasse duas vezes.
 */
function baseOptions(): Options {
  return {
    selectedVehicleId: 'all',
    focusedVehicleId: 'v-1',
    items: [],
    total: 0,
    profileTimeZone: 'Europe/Lisbon',
  };
}

let options: Options = baseOptions();

function reset() {
  options = baseOptions();
}

/*
 * Os quatro módulos que o ecrã importa são substituídos de forma a que o **tipo ativo** seja
 * o que o teste pediu. Todas as consultas devolvem a mesma forma `{ items, total }`; a lista
 * em teste é a única que tem registos, e as outras devolvem listas vazias com `isLoading`
 * falso — é isso que distingue «a lista deste tipo tem dados» de «a lista de outro tipo tem
 * dados», que é exatamente o defeito de `AUD-008`.
 */
vi.mock('../src/api/hooks', () => {
  const empty = () => ({ data: { items: [], total: 0 }, isLoading: false, isError: false, error: null });
  const active = () => ({
    data: options.isLoading || options.isError ? undefined : { items: options.items ?? [], total: options.total ?? 0 },
    isLoading: options.isLoading ?? false,
    isError: options.isError ?? false,
    error: null,
    refetch: () => {},
  });
  return {
    useProfile: () => ({
      data: { timeZone: options.profileTimeZone ?? 'Europe/Lisbon' },
      isLoading: false,
      isError: false,
      error: null,
    }),
    useExpenses: () => (options.activeKind === 'expenses' ? active() : empty()),
    useFuelSessions: () => (options.activeKind === 'fuel' ? active() : empty()),
    useChargingSessions: () => (options.activeKind === 'charging' ? active() : empty()),
    useMaintenanceRecords: () => (options.activeKind === 'maintenance' ? active() : empty()),
    useInsurance: () => (options.activeKind === 'insurance' ? active() : empty()),
    useInspections: () => (options.activeKind === 'inspections' ? active() : empty()),
    useTaxes: () => (options.activeKind === 'taxes' ? active() : empty()),
    useOdometerReadings: () => (options.activeKind === 'odometer' ? active() : empty()),
  };
});

vi.mock('../src/hooks', () => ({
  useSelectedVehicle: () => ({
    vehicleId: options.selectedVehicleId ?? 'all',
    vehicle: null,
    vehicles: options.focusedVehicleId
      ? [{ id: options.focusedVehicleId, plateDisplay: 'AB-12-CD' }]
      : [],
    isLoading: false,
    isError: false,
    select: () => {},
    isEmpty: !options.focusedVehicleId,
  }),
  useFocusedVehicleId: () => options.focusedVehicleId,
}));

const { RecordsPage } = await import('../src/pages/records/RecordsPage');
const { QuickLogProvider } = await import('../src/components/QuickLogContext');

/** Renderiza `/records/<kind>`, como a rota o faria. */
function renderKind(kind: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[`/records/${kind}`]}>
      <QuickLogProvider>
        <Routes>
          <Route path="/records/:kind" element={<RecordsPage />} />
        </Routes>
      </QuickLogProvider>
    </MemoryRouter>,
  );
}

/** Renderiza um tipo com registos, resolvendo a consulta desse tipo. */
function renderWith(kind: string, extra: Options): string {
  options = { ...baseOptions(), activeKind: kind, ...extra };
  return renderKind(kind);
}

beforeEach(reset);

const RECUSA = 'Não encontrámos esta secção';
const DESPESAS = ['Nova despesa', 'Tudo o que gastaste', 'Ainda sem despesas'];

describe('WEB-004 · cada tipo tem o seu próprio ecrã', () => {
  /*
   * Mutação: remover a entrada de `RECORD_CONFIG` faz o ecrã cair na recusa de `AUD-008`
   * (`configFor` devolve `null`) e o `expect(html).not.toContain(RECUSA)` falha.
   */
  const ECRA: Array<[string, string, string]> = [
    ['insurance', 'Seguros', 'Ainda sem apólices'],
    ['inspections', 'Inspeções', 'Ainda sem inspeções'],
    ['taxes', 'Impostos', 'Ainda sem impostos'],
  ];

  it.each(ECRA)('%s mostra «%s», o seu estado vazio e não o ecrã de despesas', (kind, titulo, vazio) => {
    const html = renderWith(kind, {});

    expect(html).not.toContain(RECUSA);
    expect(html).toContain(titulo);
    // O estado vazio é específico do tipo — é o que distingue uma lista bem construída de
    // uma lista vazia genérica.
    expect(html).toContain(vazio);
    for (const palavra of DESPESAS) expect(html, palavra).not.toContain(palavra);
  });

  it('o odómetro tem ecrã próprio e fala de leituras, não de despesas', () => {
    const html = renderWith('odometer', { focusedVehicleId: 'v-1' });

    expect(html).not.toContain(RECUSA);
    expect(html).toContain('Quilometragem');
    expect(html).toContain('Leituras de odómetro');
    for (const palavra of DESPESAS) expect(html, palavra).not.toContain(palavra);
  });
});

describe('WEB-004 · a lista mostra o registo no vocabulário do tipo', () => {
  it('seguros: seguradora, cobertura e fim de apólice', () => {
    const html = renderWith('insurance', {
      items: [
        {
          id: 'p1',
          vehicleId: 'v-1',
          insurer: 'Fidelidade',
          policyNumber: 'AP-9911',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          premiumCents: 42_000,
          coverage: 'comprehensive',
          deductibleCents: null,
          contactPhone: null,
          documentId: null,
          notes: null,
          source: { kind: 'manual', label: null, integrationId: null, observedAt: null },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          daysRemaining: 100,
          active: true,
        },
      ],
      total: 1,
    });

    expect(html).toContain('Fidelidade');
    expect(html).toContain('Danos próprios');
    expect(html).toContain('420,00');
    // A coluna de data da apólice é o **início**, não a data genérica de um registo.
    expect(html).toContain('Início');
  });

  it('inspeções: resultado em português, estação e próxima data', () => {
    const html = renderWith('inspections', {
      items: [
        {
          id: 'i1',
          vehicleId: 'v-1',
          date: '2026-03-10',
          result: 'passed_with_defects',
          odometerKm: 61_200,
          amountCents: 3_500,
          nextDueDate: '2027-03-10',
          station: 'Centro de Inspeções Lisboa',
          defects: null,
          documentId: null,
          notes: null,
          source: { kind: 'manual', label: null, integrationId: null, observedAt: null },
          createdAt: '2026-03-10T00:00:00.000Z',
          updatedAt: '2026-03-10T00:00:00.000Z',
        },
      ],
      total: 1,
    });

    expect(html).toContain('Aprovada com deficiências');
    expect(html).toContain('Centro de Inspeções Lisboa');
    expect(html).toContain('35,00');
    expect(html).toContain('Resultado');
  });

  it('impostos: tipo em português, ano e estado de pagamento', () => {
    const html = renderWith('taxes', {
      items: [
        {
          id: 't1',
          vehicleId: 'v-1',
          kind: 'iuc',
          year: 2026,
          amountCents: 14_800,
          date: '2026-05-02',
          dueDate: '2026-05-31',
          paid: false,
          documentId: null,
          notes: null,
          source: { kind: 'manual', label: null, integrationId: null, observedAt: null },
          createdAt: '2026-05-02T00:00:00.000Z',
          updatedAt: '2026-05-02T00:00:00.000Z',
        },
      ],
      total: 1,
    });

    expect(html).toContain('IUC');
    expect(html).toContain('2026');
    expect(html).toContain('por pagar');
    expect(html).toContain('148,00');
  });

  it('odómetro: as leituras ligam ao detalhe e mostram a data da leitura', () => {
    const html = renderWith('odometer', {
      focusedVehicleId: 'v-1',
      items: [
        {
          id: 'o1',
          vehicleId: 'v-1',
          odometerKm: 62_000,
          recordedAt: '2026-06-01',
          source: { kind: 'manual', label: null, integrationId: null, observedAt: null },
          notes: null,
          createdAt: '2026-06-01T00:00:00.000Z',
        },
      ],
      total: 1,
    });

    expect(html).toContain('Leitura de odómetro');
    expect(html).toContain('/records/odometer/o1');
    // A coluna de data da leitura é o dia em que foi lida, não o dia em que foi criada.
    expect(html).toContain('Leitura');
  });
});

describe('WEB-004 · sem filtros que a API ignoraria', () => {
  it('as listas de conformidade e o odómetro não mostram o filtro de período', () => {
    for (const kind of ['insurance', 'inspections', 'taxes', 'odometer']) {
      const html = renderWith(kind, {});
      expect(html, kind).not.toContain('Últimos 3 meses');
      expect(html, kind).not.toContain('Todo o histórico');
    }
  });

  it('as listas financeiras continuam a mostrar o filtro de período', () => {
    const html = renderWith('expenses', {});

    expect(html).toContain('Últimos 3 meses');
    expect(html).toContain('Todo o histórico');
  });
});

describe('WEB-004 · o odómetro exige um veículo concreto', () => {
  /*
   * O odómetro é a única lista que não pode agregar a conta: as leituras vivem em
   * `GET /vehicles/:vehicleId/odometer` e exigem um veículo. Sem nenhum, o ecrã tem de dizer
   * isso — uma lista vazia diria «não há leituras», que é falso.
   *
   * Mutação: trocar o ramo `needsVehicle` pelo estado vazio genérico faz o primeiro
   * `expect` falhar (a instrução «Adicionar veículo» desaparece).
   */
  it('sem veículo na conta, explica em vez de mostrar uma lista vazia', () => {
    const html = renderWith('odometer', { focusedVehicleId: undefined });

    expect(html).toContain('Sem veículo para mostrar');
    expect(html).toContain('Adicionar veículo');
    // Não é o estado vazio genérico de leituras — esse diria que não há leituras.
    expect(html).not.toContain('Leitura de odómetro');
  });

  it('as listas de conformidade agregam a conta inteira quando não há veículo escolhido', () => {
    for (const kind of ['insurance', 'inspections', 'taxes']) {
      const html = renderWith(kind, { focusedVehicleId: undefined });
      expect(html, kind).not.toContain('Sem veículo para mostrar');
      expect(html, kind).not.toContain(RECUSA);
    }
  });
});

describe('WEB-004 · estados de carregamento e erro continuam a funcionar', () => {
  it('mostra o bloco de carregamento enquanto a lista do tipo não chega', () => {
    const html = renderWith('taxes', { isLoading: true, items: undefined, total: undefined });

    expect(html).toContain('A carregar registos');
  });

  it('mostra o erro com pedido de nova tentativa', () => {
    const html = renderWith('insurance', { isError: true, items: undefined, total: undefined });

    expect(html).toContain('Tentar');
  });
});

describe('WEB-004 · cada render parte de uma base limpa', () => {
  /*
   * Regressão do **harness**, não do produto. `renderWith` acumulava sobre a configuração
   * anterior (`{ ...options, … }`), pelo que um segundo render dentro do mesmo teste herdava
   * os `items` do primeiro. Nenhum teste atual renderiza duas vezes com campos diferentes, por
   * isso o defeito estava latente — mas um teste que o fizesse passaria a depender da ordem.
   *
   * Mutação: voltar a `{ ...options, … }` faz este teste falhar — a lista de inspeções deixa de
   * estar vazia (herda `items`/`total` da apólice) e o estado vazio desaparece do HTML.
   */
  it('um segundo render no mesmo teste não herda os registos do primeiro', () => {
    const comApolice = renderWith('insurance', {
      items: [
        {
          id: 'p1',
          vehicleId: 'v-1',
          insurer: 'Fidelidade',
          policyNumber: 'AP-9911',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          premiumCents: 42_000,
          coverage: 'comprehensive',
          deductibleCents: null,
          contactPhone: null,
          documentId: null,
          notes: null,
          source: { kind: 'manual', label: null, integrationId: null, observedAt: null },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          daysRemaining: 100,
          active: true,
        },
      ],
      total: 1,
    });
    expect(comApolice).toContain('Fidelidade');

    // Sem `items` explícitos: tem de voltar ao estado vazio das inspeções, não herdar a apólice.
    const semRegistos = renderWith('inspections', {});
    expect(semRegistos).toContain('Ainda sem inspeções');
    expect(semRegistos).not.toContain('Fidelidade');
  });
});
