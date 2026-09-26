import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import type { VehicleSummary } from '@zemlo/shared';
import { VehicleField, VehiclePickerSheet } from '../src/components/VehiclePicker';
import { VehicleCardBody, vehicleTitle } from '../src/components/VehicleCard';
import { resolveVehicle, vehicleOdometerInput } from '../src/lib/vehicleChoice';
import type { VehicleState } from '../src/lib/vehicleState';

/*
 * Seletor de veículo do registo rápido — decisões UX/UI **55** e **56**.
 *
 * ## O que estes testes mordem
 *
 * | Asserção                                              | O defeito que ela apanha                                  |
 * | ----------------------------------------------------- | ---------------------------------------------------------- |
 * | `resolveVehicle` respeita a escolha existente          | a troca de veículo deixa de pegar — grava no carro errado  |
 * | `resolveVehicle` cai no primeiro quando o id não existe| o formulário abre sem veículo, ou com um veículo fantasma  |
 * | o campo é botão com `aria-haspopup` só com 2+ veículos | a folha deixa de abrir, ou abre com uma só opção           |
 * | o cartão do seletor usa as classes da `43`             | aparece um **segundo** cartão, com desenho próprio          |
 * | o glifo é SVG com o traço da família                   | volta o emoji, que não herda cor nem é o mesmo em cada SO  |
 * | `aria-pressed` marca exatamente uma opção              | a seleção deixa de ser percetível (visual e por leitor)     |
 * | `vehicleOdometerInput` reescreve na troca              | um registo leva a quilometragem do **outro** carro          |
 * | a guarda de origem: 5 formulários usam `VehicleChoice`  | um formulário fica sem seletor, em silêncio                 |
 *
 * ## O que **não** se pode afirmar aqui, e porquê
 *
 * O projeto não usa `jsdom` (decisão escrita em `page-states.test.tsx`): não há eventos, logo
 * **não** é possível simular o toque que abre a folha nem o toque que escolhe. O que se afirma é
 * o **resultado renderizado** (o HTML que o utilizador veria) e a **decisão pura** (`resolveVehicle`).
 * A ligação entre o toque e a decisão — `onOpenChange`/`onSelect` — fica dita como limitação no
 * relatório, em vez de ser dada por coberta.
 */

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

function vehicle(overrides: Partial<VehicleSummary> = {}): VehicleSummary {
  return {
    id: 'v-1',
    plate: 'AB-12-CD',
    plateDisplay: 'AB-12-CD',
    make: 'Tesla',
    model: 'Model 3',
    version: null,
    year: 2022,
    vehicleType: 'car',
    fuelType: 'electric',
    nickname: null,
    archived: false,
    odometerKm: 42_500,
    odometerSource: null,
    odometerUpdatedAt: '2026-09-20T10:00:00.000Z',
    // O emoji continua a chegar da API. O que estes testes fixam é que **não** é usado: o
    // cartão da `43` desenha o glifo SVG. Se um dia voltar a ser usado, o teste fica vermelho.
    emoji: '🚗',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
    ...overrides,
  };
}

/**
 * Faixas de emoji/pictogramas — a mesma expressão de `vehicle-cards.test.tsx`.
 *
 * Não inclui as setas nem os travessões: o seletor usa `▾` (U+25BE) de propósito, que é
 * tipografia, não pictograma.
 */
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

/* -------------------------------------------------------------------------- */
/* 55 — a decisão pura: qual veículo fica selecionado                          */
/* -------------------------------------------------------------------------- */

describe('55 · pré-seleção e troca de veículo', () => {
  const a = vehicle({ id: 'a', make: 'Tesla', model: 'Model 3' });
  const b = vehicle({ id: 'b', make: 'Volvo', model: 'XC40', plateDisplay: 'CD-34-EF' });

  it('respeita o veículo em contexto — é a pré-seleção automática que a 55 pede', () => {
    expect(resolveVehicle([a, b], 'b')?.id).toBe('b');
  });

  it('sem contexto, cai no primeiro da lista (o mais ativo, segundo a API)', () => {
    expect(resolveVehicle([a, b], null)?.id).toBe('a');
    expect(resolveVehicle([a, b], undefined)?.id).toBe('a');
  });

  it('uma escolha que já não existe não deixa o formulário sem veículo', () => {
    // O veículo foi arquivado noutro dispositivo, ou a lista ainda está a chegar.
    expect(resolveVehicle([a, b], 'arquivado')?.id).toBe('a');
  });

  it('sem veículos devolve `null` — não inventa um', () => {
    expect(resolveVehicle([], 'a')).toBeNull();
  });

  it('depois de trocar, a decisão devolve o novo veículo', () => {
    // A troca é a mesma chamada com outro `preferredId`: é o que o formulário faz ao escolher.
    expect(resolveVehicle([a, b], 'a')?.id).toBe('a');
    expect(resolveVehicle([a, b], 'b')?.id).toBe('b');
  });
});

describe('55 · quilometragem do veículo escolhido', () => {
  it('usa a última leitura do veículo', () => {
    expect(vehicleOdometerInput(vehicle({ odometerKm: 42_500 }))).toBe('42500');
  });

  it('um veículo sem leituras deixa o campo vazio, em vez de zero', () => {
    // Zero seria um valor inventado: a API leria «0 km» como um recuo gigantesco.
    expect(vehicleOdometerInput(vehicle({ odometerKm: null }))).toBe('');
    expect(vehicleOdometerInput(null)).toBe('');
  });
});

/* -------------------------------------------------------------------------- */
/* 55 — o campo no formulário                                                  */
/* -------------------------------------------------------------------------- */

describe('55 · o campo do veículo', () => {
  it('mostra o cartão do veículo e um `▾` quando há mais de um', () => {
    const html = renderToStaticMarkup(
      <VehicleField vehicle={vehicle()} vehicleCount={2} onOpen={() => {}} />,
    );

    expect(html).toContain('Veículo');
    expect(html).toContain('Tesla Model 3');
    expect(html).toContain('AB-12-CD');
    expect(html).toContain('▾');
  });

  it('é um botão que anuncia que abre uma folha', () => {
    const html = renderToStaticMarkup(
      <VehicleField vehicle={vehicle()} vehicleCount={2} onOpen={() => {}} />,
    );

    expect(html).toContain('<button');
    expect(html).toContain('aria-haspopup="dialog"');
  });

  it('com um só veículo não é botão — não há nada a trocar —, mas o veículo continua à vista', () => {
    const html = renderToStaticMarkup(
      <VehicleField vehicle={vehicle()} vehicleCount={1} onOpen={() => {}} />,
    );

    expect(html).not.toContain('aria-haspopup');
    // A informação fica: a 55 pede que o formulário mostre onde o registo vai ficar.
    expect(html).toContain('Tesla Model 3');
  });

  it('o nome acessível diz o que o botão governa, e inclui o texto visível', () => {
    const html = renderToStaticMarkup(
      <VehicleField vehicle={vehicle()} vehicleCount={2} onOpen={() => {}} />,
    );

    // «Label in Name» (WCAG 2.5.3): o texto visível («Tesla Model 3 · AB-12-CD») tem de estar
    // contido no nome acessível.
    expect(html).toMatch(/aria-label="Veículo: Tesla Model 3 · AB-12-CD"/);
  });
});

/* -------------------------------------------------------------------------- */
/* 56 — a folha de escolha                                                     */
/* -------------------------------------------------------------------------- */

describe('56 · a folha de escolha', () => {
  const vehicles = [
    vehicle({ id: 'a', make: 'Tesla', model: 'Model 3' }),
    vehicle({ id: 'b', make: 'Volvo', model: 'XC40', plateDisplay: 'CD-34-EF', fuelType: 'diesel' }),
  ];

  function renderPicker(selectedId: string, states = new Map<string, VehicleState>()): string {
    return renderToStaticMarkup(
      <VehiclePickerSheet
        vehicles={vehicles}
        selectedId={selectedId}
        states={states}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
  }

  it('tem um cartão por veículo, agrupados com nome', () => {
    const html = renderPicker('a');

    expect(html).toContain('Escolher veículo');
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Veículos da conta"');
    // Um botão por veículo.
    expect((html.match(/aria-pressed=/g) ?? []).length).toBe(2);
  });

  it('mostra os dois veículos com o seu nome e matrícula', () => {
    const html = renderPicker('a');

    expect(html).toContain('Tesla Model 3');
    expect(html).toContain('AB-12-CD');
    expect(html).toContain('Volvo XC40');
    expect(html).toContain('CD-34-EF');
  });

  it('marca exatamente o veículo selecionado', () => {
    const html = renderPicker('b');

    // O `b` fica pressionado; o `a` não. É a asserção que prova que a seleção é dita, e não
    // apenas desenhada.
    expect(html).toMatch(/aria-label="Volvo XC40 · CD-34-EF"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="Volvo XC40 · CD-34-EF"/);
    expect(html).toMatch(/aria-pressed="false"/);
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
  });

  it('mostra o estado do veículo quando existe', () => {
    const states = new Map<string, VehicleState>([
      ['a', { state: 'due_soon', label: 'Inspeção a aproximar-se', tone: 'warn' }],
    ]);
    const html = renderPicker('a', states);

    expect(html).toContain('Inspeção a aproximar-se');
    expect(html).toContain('z-vehicle-card__dot--warn');
  });

  it('não inventa estado para um veículo sem lembretes avaliáveis', () => {
    const html = renderPicker('a');

    expect(html).not.toContain('z-vehicle-card__status');
  });

  it('o nome acessível de cada opção identifica o veículo por inteiro', () => {
    const html = renderPicker('a');

    expect(html).toContain('aria-label="Tesla Model 3 · AB-12-CD"');
    expect(html).toContain('aria-label="Volvo XC40 · CD-34-EF"');
  });
});

/* -------------------------------------------------------------------------- */
/* Reutilização do cartão da 43                                                */
/* -------------------------------------------------------------------------- */

describe('56 · o cartão é o da 43, não um segundo cartão', () => {
  const vehicles = [vehicle({ id: 'a' })];

  it('o seletor usa as classes e o glifo do cartão canónico', () => {
    const html = renderToStaticMarkup(
      <VehiclePickerSheet
        vehicles={vehicles}
        selectedId="a"
        states={new Map<string, VehicleState>()}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );

    // As mesmas classes da família da 43 — não uma família nova.
    expect(html).toContain('z-vehicle-card');
    expect(html).toContain('z-vehicle-card--compact');
    expect(html).toContain('z-vehicle-card__glyph');
    expect(html).toContain('z-vehicle-card__title');
    expect(html).toContain('z-vehicle-card__meta');
    expect(html).toContain('z-vehicle-card__plate');
  });

  it('o glifo é o SVG local da família, com o traço do sistema', () => {
    const html = renderToStaticMarkup(
      <VehiclePickerSheet
        vehicles={vehicles}
        selectedId="a"
        states={new Map<string, VehicleState>()}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );

    expect(html).toContain('<svg');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('stroke="currentColor"');
  });

  it('não há um único emoji no cartão do seletor, mesmo com o veículo a trazer um', () => {
    /*
     * O cartão é afirmado **isolado da folha**, de propósito: a folha desenha o `✕` do botão de
     * fechar, que é U+2715 — uma marca tipográfica que o produto usa em todo o lado (o `Sheet`
     * já o fazia antes desta tarefa), e que uma expressão de pictogramas apanha por engano. A
     * asserção que interessa é sobre o **cartão**, que é onde a decisão `43` trocou o emoji pelo
     * glifo. Um teste que acusasse o `✕` estaria a reportar um defeito que não existe.
     */
    const html = renderToStaticMarkup(<VehicleCardBody vehicle={vehicle()} compact />);

    expect(EMOJI.test(html)).toBe(false);
  });

  it('a folha não deixa passar o emoji que o veículo traz da API', () => {
    const html = renderToStaticMarkup(
      <VehiclePickerSheet
        vehicles={vehicles}
        selectedId="a"
        states={new Map<string, VehicleState>()}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );

    expect(html).not.toContain('🚗');
    expect(html).toContain('<svg');
  });

  it('a densidade compacta não desenha o rodapé de quilometragem', () => {
    const html = renderToStaticMarkup(
      <VehiclePickerSheet
        vehicles={vehicles}
        selectedId="a"
        states={new Map<string, VehicleState>()}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );

    // É o que a 56 pede: adaptar a densidade, não a identidade.
    expect(html).not.toContain('z-vehicle-card__foot');
    expect(html).not.toContain('Quilometragem');
  });
});

/* -------------------------------------------------------------------------- */
/* A mesma regra de nome em todo o lado (não há duas)                          */
/* -------------------------------------------------------------------------- */

describe('56 · o nome do veículo vem de um só sítio', () => {
  it('o seletor usa o `vehicleTitle` do cartão canónico', () => {
    // O apelido **não** ganha: a decisão 43 fixou marca + modelo em destaque. Se o seletor
    // tivesse a sua própria regra, chamaria ao veículo um nome que a lista não usa.
    const named = vehicle({ nickname: 'O da praia', make: 'Tesla', model: 'Model 3' });
    expect(vehicleTitle(named)).toBe('Tesla Model 3');

    const html = renderToStaticMarkup(
      <VehicleField vehicle={named} vehicleCount={2} onOpen={() => {}} />,
    );
    expect(html).toContain('Tesla Model 3');
  });
});

/* -------------------------------------------------------------------------- */
/* Guardas de origem — o que não é observável sem DOM                          */
/* -------------------------------------------------------------------------- */

const FONTE_FOLHA = fileURLToPath(new URL('../src/components/QuickLogSheet.tsx', import.meta.url));
const FONTE_SELETOR = fileURLToPath(new URL('../src/components/VehiclePicker.tsx', import.meta.url));

function fonte(caminho: string): string {
  return readFileSync(caminho, 'utf8');
}

describe('55 · cada formulário tem o seletor (guarda de origem)', () => {
  it('os cinco formulários usam `VehicleChoice`', () => {
    const texto = fonte(FONTE_FOLHA);
    // Quíntuplo: despesa, abastecimento, carregamento, manutenção e odómetro. Um formulário
    // novo sem seletor faria esta contagem falhar — que é o que se quer.
    expect((texto.match(/<VehicleChoice/g) ?? []).length).toBe(5);
  });

  it('os cinco passam `suspendGlobalKeys`, para o Escape não fechar as duas folhas', () => {
    const texto = fonte(FONTE_FOLHA);
    expect((texto.match(/suspendGlobalKeys=\{pickerOpen\}/g) ?? []).length).toBe(5);
  });

  it('os cinco resolvem o veículo pelo `useSmartDefaults`, e não por memória nova', () => {
    const texto = fonte(FONTE_FOLHA);
    // A 55 diz «usar o comportamento existente de useSmartDefaults(); não inventar memória de
    // veículos». O contexto entra pelo argumento, e não por um segundo mecanismo.
    expect((texto.match(/useSmartDefaults\(chosenVehicleId\)/g) ?? []).length).toBe(5);
  });

  it('a etiqueta de texto duplicada (`vehicleLabel`) desapareceu', () => {
    /*
     * A asserção é sobre o **uso**, não sobre a palavra: o comentário que explica a remoção
     * escreve-a, e uma asserção sobre o texto do comentário falharia por uma razão falsa — foi
     * exatamente o que aconteceu na primeira versão deste teste.
     */
    const texto = fonte(FONTE_FOLHA);
    expect(texto).not.toMatch(/vehicleLabel:/);
    expect(texto).not.toMatch(/defaults\.vehicleLabel/);
  });
});

describe('56 · o seletor não tem cartão próprio (guarda de origem)', () => {
  it('importa o conteúdo do cartão canónico em vez de o redesenhar', () => {
    const texto = fonte(FONTE_SELETOR);
    expect(texto).toContain("from './VehicleCard'");
    expect(texto).toContain('VehicleCardBody');
    expect(texto).toContain('vehicleCardClass');
  });

  it('não escreve markup próprio de cartão nem usa o emoji do veículo', () => {
    const texto = fonte(FONTE_SELETOR);
    /*
     * Asserções sobre o **uso**, não sobre a palavra: os comentários deste ficheiro explicam
     * precisamente que o emoji foi rejeitado e que o cartão é reutilizado, pelo que uma
     * asserção sobre o texto cru acusaria a própria explicação.
     */
    // Sem `__head`/`__glyph`/`__title` escritos à mão: isso seria uma segunda implementação.
    expect(texto).not.toContain('z-vehicle-card__glyph');
    expect(texto).not.toContain('z-vehicle-card__title');
    // Sem acesso à propriedade `emoji` do veículo.
    expect(texto).not.toMatch(/\.emoji/);
  });

  it('o teste anti-vacuidade: a leitura do ficheiro funciona', () => {
    // Sem isto, um caminho errado faria as três asserções acima passarem por vacuidade.
    expect(fonte(FONTE_SELETOR).length).toBeGreaterThan(1000);
  });
});

describe('§52–§54 continuam intactos (regressão)', () => {
  it('o pós-gravação e o registo do último tipo continuam no ficheiro', () => {
    const texto = fonte(FONTE_FOLHA);
    expect(texto).toContain('postSaveActions');
    expect(texto).toContain('rememberLastKind');
    expect(texto).toContain('onNovoRegisto');
  });
});
