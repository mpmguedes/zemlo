import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/*
 * `/records/:kind` com um tipo que não existe (`AUD-008`).
 *
 * ## O defeito
 *
 * `configFor` devolvia a configuração de **despesas** para qualquer `kind` fora do mapa, e o
 * `kind` também indexa as consultas. `/records/insurance` mostrava a lista de despesas —
 * título «Despesas», botão «Nova despesa» — sem erro nenhum. Uma degradação silenciosa é pior
 * do que uma recusa: um 404 sabe-se que é um 404, e o utilizador não age sobre o ecrã errado.
 *
 * ## O que estes testes mordem
 *
 * Cada caso falha se o fallback voltar. A mutação que os prova é repor
 * `RECORD_CONFIG[kind] ?? RECORD_CONFIG.expenses` em `configFor`: o primeiro teste volta a
 * encontrar «Nova despesa» no HTML e fica vermelho.
 *
 * ## Porque é que isto não usa `jsdom`
 *
 * Pela mesma razão que `page-states.test.tsx`: o projeto decidiu, por escrito, não introduzir
 * um ambiente de DOM só para testar ecrãs. `renderToStaticMarkup` corre em Node e produz o
 * HTML que o utilizador veria — que é exatamente o que aqui se quer afirmar.
 *
 * ## Porque é que os hooks são substituídos
 *
 * O objetivo é a decisão do ecrã, não a rede. `vi.mock` dos dois módulos de hooks torna cada
 * caso determinístico e sem I/O. O `useSelectedVehicle` é substituído em vez de se substituir
 * `useVehicles`: assim o teste não depende de `localStorage` nem da resolução da seleção.
 */

vi.mock('../src/api/hooks', () => ({
  useProfile: () => ({ data: undefined, isLoading: false, isError: false, error: null }),
  useExpenses: () => ({ data: { items: [], total: 0 }, isLoading: false, isError: false, error: null }),
  useFuelSessions: () => ({ data: { items: [], total: 0 }, isLoading: false, isError: false, error: null }),
  useChargingSessions: () => ({ data: { items: [], total: 0 }, isLoading: false, isError: false, error: null }),
  useMaintenanceRecords: () => ({ data: { items: [], total: 0 }, isLoading: false, isError: false, error: null }),
}));

vi.mock('../src/hooks', () => ({
  useSelectedVehicle: () => ({
    vehicleId: 'all',
    vehicle: null,
    vehicles: [],
    isLoading: false,
    isError: false,
    select: () => {},
    isEmpty: true,
  }),
}));

const { RecordsPage } = await import('../src/pages/records/RecordsPage');
const { QuickLogProvider } = await import('../src/components/QuickLogContext');

/** Renderiza o ecrã de registos no `kind` pedido, tal como a rota o faria. */
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

const RECUSA = 'Não encontrámos esta secção';

describe('/records/:kind · um tipo desconhecido é recusado, não degradado', () => {
  it('não mostra o ecrã de despesas para um tipo que existe na API mas não tem lista', () => {
    const html = renderKind('insurance');

    expect(html).toContain(RECUSA);
    // O que o fallback mostrava, e que não pode voltar a aparecer:
    expect(html).not.toContain('Nova despesa');
    expect(html).not.toContain('Tudo o que gastaste');
  });

  it('recusa qualquer tipo que não esteja no mapa', () => {
    for (const kind of ['odometer', 'inspections', 'taxes', 'nao-existe']) {
      expect(renderKind(kind), kind).toContain(RECUSA);
    }
  });

  it('dá sempre um caminho de volta', () => {
    const html = renderKind('insurance');

    expect(html).toContain('Voltar ao painel');
    expect(html).toContain('href="/"');
  });
});

describe('/records/:kind · os tipos legítimos continuam a funcionar', () => {
  const TIPOS: Array<[string, string, string]> = [
    ['expenses', 'Despesas', 'Nova despesa'],
    ['fuel', 'Abastecimentos', 'Novo abastecimento'],
    ['charging', 'Carregamentos', 'Novo carregamento'],
    ['maintenance', 'Manutenção', 'Nova manutenção'],
  ];

  it.each(TIPOS)('%s mostra «%s» e o botão «%s»', (kind, titulo, botao) => {
    const html = renderKind(kind);

    expect(html).not.toContain(RECUSA);
    expect(html).toContain(titulo);
    expect(html).toContain(botao);
  });
});
