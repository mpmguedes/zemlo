import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { nextTabIndex } from '../src/lib/tabs';
import {
  DateField,
  MoneyField,
  NumberField,
  SelectField,
  TextAreaField,
  TextField,
} from '../src/ui/form';

/*
 * Acessibilidade (`WEB-006`).
 *
 * ## O que estes testes provam — e o que não provam
 *
 * Provam o **resultado visível e anunciável** de cada correção: o atributo que o leitor de
 * ecrã lê, o `tabIndex` que decide a ordem de tabulação, o texto que entra no nome acessível.
 * Não provam interação: sem `jsdom` não há `keydown` a disparar nem foco a verificar.
 *
 * Essa fronteira está tratada de frente, e não escondida:
 *
 *  - a **aritmética** das teclas foi extraída para `src/lib/tabs.ts` exatamente para poder ser
 *    testada aqui, sem DOM. É onde o `←` na ponta e o `Home`/`End` se enganam;
 *  - a **ligação ao DOM** (mover o foco para o separador novo) não tem teste. Está escrita no
 *    `Tabs` e está dita como limitação no relatório da tarefa, em vez de ser dada por coberta.
 *
 * Uma nota sobre o teste A4: é uma verificação **estática**, que lê o código-fonte em vez de
 * renderizar. Não é um teste de comportamento e está rotulado como o que é — uma guarda de
 * convenção, que morde quando alguém acrescenta um `role="group"` sem nome. Faz sentido neste
 * caso porque a convenção atravessa 11 sítios em 8 ficheiros, e renderizar 11 páginas para
 * contar atributos seria caro e frágil.
 */

/* -------------------------------------------------------------------------- */
/* A1 — «obrigatório» chega ao controlo, não só ao asterisco                  */
/* -------------------------------------------------------------------------- */

/**
 * Os seis componentes de campo que aceitam `required`.
 *
 * A lista é explícita e não descoberta por reflexão: se um componente novo for acrescentado a
 * `ui/form.tsx` sem `aria-required`, este teste não o apanha — e é bom que se saiba. A
 * alternativa seria varrer o módulo, o que daria um teste que passa a verde sozinho quando
 * alguém acrescenta uma exportação.
 */
const CAMPOS = [
  { nome: 'TextField', jsx: (r: boolean) => <TextField label="Email" required={r} /> },
  { nome: 'TextAreaField', jsx: (r: boolean) => <TextAreaField label="Notas" required={r} /> },
  {
    nome: 'SelectField',
    jsx: (r: boolean) => (
      <SelectField label="Tipo" required={r} options={[{ value: 'a', label: 'A' }]} />
    ),
  },
  {
    nome: 'MoneyField',
    jsx: (r: boolean) => <MoneyField label="Valor" required={r} value="" onChange={() => {}} />,
  },
  {
    nome: 'NumberField',
    jsx: (r: boolean) => <NumberField label="Quilómetros" required={r} value="" onChange={() => {}} />,
  },
  { nome: 'DateField', jsx: (r: boolean) => <DateField label="Data" required={r} /> },
];

describe('WEB-006 · A1 · o campo obrigatório anuncia-se como obrigatório', () => {
  it.each(CAMPOS)('$nome marca o controlo com aria-required', ({ jsx }) => {
    // O defeito: `required` era destruturado e usado só para o asterisco, que é `aria-hidden`.
    // O controlo não tinha nem `required` nem `aria-required` — o leitor de ecrã não sabia.
    expect(renderToStaticMarkup(jsx(true))).toContain('aria-required="true"');
  });

  it.each(CAMPOS)('$nome não anuncia nada quando o campo é opcional', ({ jsx }) => {
    // O contrário também é um defeito: um campo opcional marcado como obrigatório faz
    // desistir quem não tem de o preencher.
    expect(renderToStaticMarkup(jsx(false))).not.toContain('aria-required');
  });

  it('o asterisco continua escondido, para a informação não ir por dois caminhos', () => {
    const html = renderToStaticMarkup(<TextField label="Email" required />);
    // `z-field__required` é o asterisco. Se perdesse o `aria-hidden`, um leitor de ecrã
    // diria «asterisco» — que não informa ninguém — além de «obrigatório».
    expect(html).toContain('z-field__required');
    expect(html).toMatch(/class="z-field__required" aria-hidden="true"/);
  });
});

/* -------------------------------------------------------------------------- */
/* A2 — navegação de teclado num `role="tablist"`                             */
/* -------------------------------------------------------------------------- */

describe('WEB-006 · A2 · a aritmética das teclas do tablist', () => {
  it('ArrowRight avança e dá a volta no fim da lista', () => {
    expect(nextTabIndex('ArrowRight', 0, 9)).toBe(1);
    expect(nextTabIndex('ArrowRight', 7, 9)).toBe(8);
    expect(nextTabIndex('ArrowRight', 8, 9)).toBe(0);
  });

  it('ArrowLeft recua e dá a volta no princípio da lista', () => {
    expect(nextTabIndex('ArrowLeft', 8, 9)).toBe(7);
    expect(nextTabIndex('ArrowLeft', 1, 9)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 0, 9)).toBe(8);
  });

  it('Home e End saltam para as pontas', () => {
    expect(nextTabIndex('Home', 5, 9)).toBe(0);
    expect(nextTabIndex('End', 2, 9)).toBe(8);
  });

  it('as teclas que não são do padrão não mudam de separador', () => {
    // É isto que deixa o `Tab` sair da lista e o `Enter`/`Espaço` ativarem o botão que já tem
    // o foco — se estas teclas fossem apanhadas, o teclado ficava preso dentro da lista.
    for (const key of ['Tab', 'Enter', ' ', 'a', 'ArrowUp', 'ArrowDown', 'Escape']) {
      expect(nextTabIndex(key, 4, 9)).toBeNull();
    }
  });

  it('com um só separador, as setas não vão para lado nenhum', () => {
    expect(nextTabIndex('ArrowRight', 0, 1)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 0, 1)).toBe(0);
  });

  it('um índice fora dos limites devolve null em vez de adivinhar', () => {
    // Acontece se a rota pedir um separador que não existe; devolver 0 abria silenciosamente
    // o primeiro separador, que é a classe de defeito que `AUD-008` descreve.
    expect(nextTabIndex('ArrowRight', -1, 9)).toBeNull();
    expect(nextTabIndex('ArrowRight', 9, 9)).toBeNull();
    expect(nextTabIndex('ArrowRight', 0, 0)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Mocks para as páginas                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Estado de consulta mínimo que os componentes leem.
 *
 * O `vi.mock` de baixo serve **duas** páginas — a ficha do veículo e a estrutura da aplicação
 * — porque o `vi.mock` é por ficheiro. Daí a lista completa.
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

vi.mock('../src/api/hooks', () => ({
  // Estrutura da aplicação
  useUnreadCount: () => 3,
  useVehicles: () => query({ data: { items: [], total: 0 } }),
  useResendEmailVerification: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useNotifications: () => query({ data: { items: [], unreadCount: 3 } }),
  // Ficha do veículo
  useVehicle: () => query({ data: VEHICLE }),
  useInsurance: () => query({ data: { items: [], total: 0 } }),
  useInspections: () => query(),
  useTaxes: () => query(),
  useReminders: () => query(),
  useStats: () => query(),
  useDocuments: () => query(),
  useOdometerReadings: () => query(),
  useProfile: () => query(),
  useCreateInsurance: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useCreateInspection: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useCreateReminder: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useCreateTax: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useCompleteReminder: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useDeleteReminder: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useDeleteVehicle: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useSnoozeReminder: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useUpdateVehicle: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../src/app/SessionContext', () => ({
  useSession: () => ({
    profile: { id: 'u1', email: 'a@b.pt', name: 'Ana', emailVerified: true },
    signOut: vi.fn(),
  }),
}));

const { VehicleDetailPage } = await import('../src/pages/vehicles/VehicleDetailPage');
const { AppShell } = await import('../src/app/AppShell');
const { QuickLogProvider } = await import('../src/components/QuickLogContext');

/* -------------------------------------------------------------------------- */
/* A2 (continuação) — só um separador está na ordem de tabulação              */
/* -------------------------------------------------------------------------- */

function renderFicha(tab: string): string {
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

describe('WEB-006 · A2 · o roving tabindex dos separadores da ficha', () => {
  /*
   * As expressões são insensíveis a maiúsculas de propósito: em JSX escreve-se `tabIndex` e o
   * React escreve `tabindex` no HTML. Prender o teste à grafia de uma versão do React seria
   * fazê-lo falhar numa atualização sem nada se ter partido no produto.
   */
  it('só o separador ativo está na ordem de tabulação', () => {
    // O defeito: os nove separadores eram nove paradas de tabulação. O `Tab` percorria-os
    // todos em vez de sair da lista, e as setas — que não existiam — não eram alternativa.
    const html = renderFicha('overview');
    expect((html.match(/tabindex="0"/gi) ?? []).length).toBe(1);
    expect((html.match(/tabindex="-1"/gi) ?? []).length).toBe(8);
  });

  it('o separador com `tabIndex="0"` é o que está selecionado', () => {
    // Contar sem verificar qual seria um teste que passa com a marca no separador errado.
    expect(renderFicha('overview')).toMatch(/id="tab-overview"[^>]*tabindex="0"/i);
    expect(renderFicha('insurance')).toMatch(/id="tab-insurance"[^>]*tabindex="0"/i);
  });

  it('o separador selecionado é também o único com `aria-selected`', () => {
    const html = renderFicha('insurance');
    expect((html.match(/aria-selected="true"/g) ?? []).length).toBe(1);
    expect(html).toMatch(/id="tab-insurance"[^>]*aria-selected="true"/);
  });

  it('o separador ativo continua a apontar para um painel que existe', () => {
    // O `aria-controls` só é útil se o alvo existir. Com o roving tabindex a mudar quem está
    // na ordem de tabulação, esta é a asserção que garante que nada se perdeu pelo caminho.
    const html = renderFicha('insurance');
    expect(html).toContain('aria-controls="panel-insurance"');
    expect(html).toContain('id="panel-insurance"');
  });
});

/* -------------------------------------------------------------------------- */
/* A3 — a contagem por ler chega ao nome acessível                            */
/* -------------------------------------------------------------------------- */

function renderShell(): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/']}>
        <QuickLogProvider>
          <Routes>
            <Route path="/" element={<AppShell />}>
              <Route index element={<p>conteúdo</p>} />
            </Route>
          </Routes>
        </QuickLogProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('WEB-006 · A3 · a barra inferior diz quantos avisos há por ler', () => {
  it('o badge visual continua escondido do leitor de ecrã', () => {
    // A bolha está posicionada em absoluto sobre o canto do ícone; movê-la para fora do
    // `aria-hidden` partiria o desenho. O que muda é haver um caminho alternativo.
    const html = renderShell();
    expect(html).toContain('z-tabbar__badge');
    expect(html).toMatch(/z-tabbar__icon" aria-hidden="true"/);
  });

  it('a contagem entra no link, em texto só para leitores de ecrã', () => {
    // O defeito: o badge vivia dentro do `aria-hidden`, e o nome acessível do link era só
    // «Avisos» — quem não vê o ecrã não sabia que havia avisos por ler.
    const html = renderShell();
    expect(html).toContain('z-sr-only');
    expect(html).toContain('3 por ler');
  });

  it('escreve o número e não o `9+` do badge', () => {
    // O `9+` existe para caber num círculo de 16 px. Essa restrição não existe em texto lido
    // em voz alta, e «9+ por ler» seria pior do que «12 por ler».
    const html = renderShell();
    expect(html).not.toContain('9+ por ler');
  });
});

/* -------------------------------------------------------------------------- */
/* A4 — guarda de convenção: `role="group"` tem sempre nome                   */
/* -------------------------------------------------------------------------- */

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function ficheirosTsx(diretorio: string): string[] {
  return readdirSync(diretorio).flatMap((entrada) => {
    const caminho = join(diretorio, entrada);
    if (statSync(caminho).isDirectory()) return ficheirosTsx(caminho);
    return entrada.endsWith('.tsx') ? [caminho] : [];
  });
}

describe('WEB-006 · A4 · nenhum `role="group"` fica sem nome', () => {
  it('todos os grupos do projeto têm `aria-label` na própria etiqueta', () => {
    // Verificação ESTÁTICA, e rotulada como tal: lê o código-fonte em vez de renderizar.
    // É uma guarda de convenção — morde quando alguém acrescenta um grupo sem nome — e não
    // um teste de comportamento. A expressão apanha a etiqueta inteira, mesmo repartida por
    // várias linhas, para que um `aria-label` na linha seguinte conte como presente.
    const etiqueta = /<[A-Za-z][^>]*\brole="group"[^>]*>/g;
    const semNome: string[] = [];

    for (const ficheiro of ficheirosTsx(SRC)) {
      const conteudo = readFileSync(ficheiro, 'utf8');
      for (const [etiquetaEncontrada] of conteudo.matchAll(etiqueta)) {
        if (!/aria-label/.test(etiquetaEncontrada)) {
          semNome.push(`${ficheiro.slice(SRC.length + 1)}: ${etiquetaEncontrada.split('\n')[0]}`);
        }
      }
    }

    expect(semNome).toEqual([]);
  });

  it('a guarda encontra os grupos que existem (não passa por vacuidade)', () => {
    // Sem esta asserção, uma expressão que deixasse de casar com o código faria a guarda
    // anterior passar para sempre. É a diferença entre um teste e um ornamento.
    //
    // O limiar é o número real contado em 2026-09-22 (11 grupos em 8 ficheiros), e não uma
    // margem folgada. É deliberado: a expressão só casa dentro de **uma** linha, pelo que
    // reformatar uma etiqueta por várias linhas a faria perder cobertura em silêncio — com o
    // limiar no valor exato, essa perda faz este teste ficar vermelho. Consequência aceite:
    // apagar ou substituir um grupo legítimo também fica vermelho, de propósito, para obrigar
    // quem mexer a reavaliar em vez de deixar a guarda encolher sozinha.
    const etiqueta = /<[A-Za-z][^>]*\brole="group"[^>]*>/g;
    let total = 0;
    for (const ficheiro of ficheirosTsx(SRC)) {
      total += [...readFileSync(ficheiro, 'utf8').matchAll(etiqueta)].length;
    }
    expect(total).toBeGreaterThanOrEqual(11);
  });
});
