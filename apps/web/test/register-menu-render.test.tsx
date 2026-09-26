import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { RECORD_KINDS } from '@zemlo/shared';
import { RegisterMenu } from '../src/components/RegisterMenu';

/*
 * Decisões 46, 47 e 50 — o menu «Registar» **renderizado**.
 *
 * ## Porque é que isto corre sem `jsdom`
 *
 * Pela razão que `records-kind.test.tsx` e `page-states.test.tsx` já documentam: o projeto
 * decidiu não introduzir um ambiente de DOM só para testar ecrãs. `renderToStaticMarkup` corre
 * em Node e produz o HTML que o utilizador veria — e o `Sheet` não depende de router nem de
 * rede, pelo que este menu se renderiza sem um único `vi.mock`.
 *
 * ## O que se pode e não se pode afirmar
 *
 * Afirma-se o **HTML**: que secções existem, que cartões existem, com que texto acessível, e
 * que não há um único emoji do contrato. Não se afirma que um clique abre o formulário — sem
 * eventos isso não é observável, e um teste que o fingisse seria um falso verde. Essa parte
 * está coberta pela decisão pura (`register-menu.test.ts`) e pelo despachante do contexto.
 *
 * ## O que morde
 *
 *  - o cartão deixar de ser SVG e voltar ao emoji do contrato (decisão 47) — o teste dos
 *    emoji fica vermelho;
 *  - a grelha perder a adaptabilidade e passar a uma contagem fixa (decisão 46) — a guarda
 *    de CSS fica vermelha;
 *  - «Repetir último» aparecer sem tipo anterior (decisão 50).
 */

function renderMenu(): string {
  return renderToStaticMarkup(<RegisterMenu onSelect={() => {}} onClose={() => {}} />);
}

/** Texto acessível de cada cartão, pela ordem em que aparece no HTML. */
function etiquetasDosCartoes(html: string): string[] {
  return [...html.matchAll(/<button[^>]*class="z-register-card"[^>]*>([\s\S]*?)<\/button>/g)].map(
    (ocorrencia) => (ocorrencia[1] ?? '').replace(/<[^>]*>/g, '').trim(),
  );
}

function contar(html: string, seletor: string): number {
  return [...html.matchAll(new RegExp(`class="${seletor}"`, 'g'))].length;
}

/** Bloco de uma regra de topo em `app.css` — do seletor até ao `}` que o fecha. */
function blocoCss(css: string, seletor: string): string {
  const inicio = css.indexOf(`\n${seletor} {`);
  if (inicio === -1) return '';
  return css.slice(inicio, css.indexOf('}', inicio) + 1);
}

function instalarArmazenamentoCom(tipo: string): void {
  const store = new Map<string, string>([['zemlo.ultimoTipoDeRegisto', tipo]]);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (chave: string) => store.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        store.set(chave, valor);
      },
    },
  });
}

describe('menu de registo · estrutura do HTML', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'localStorage');
  });

  it('abre uma folha com título acessível', () => {
    const html = renderMenu();

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="z-sheet-title"');
    expect(html).toContain('>Registar</h2>');
  });

  it('mostra as duas secções da decisão 49, por esta ordem', () => {
    const html = renderMenu();

    expect(html).toContain('Mais usados');
    expect(html).toContain('Outros');
    expect(html.indexOf('Mais usados')).toBeLessThan(html.indexOf('Outros'));
  });

  it('mostra os cinco tipos do contrato, pela ordem do contrato', () => {
    expect(etiquetasDosCartoes(renderMenu())).toEqual([
      'Despesa',
      'Abastecimento',
      'Carregamento',
      'Manutenção',
      'Quilometragem',
    ]);
  });

  it('cada tipo é um botão — não uma ligação nem um item de lista', () => {
    const html = renderMenu();

    expect(contar(html, 'z-register-card')).toBe(RECORD_KINDS.length);
    // Os dois atributos na mesma etiqueta, em qualquer ordem (lookaheads): um `<button>` sem
    // `type` dentro de um formulário submeteria-o, e um cartão que não fosse botão deixaria de
    // ser acionável por teclado.
    expect(
      [...html.matchAll(/<button(?=[^>]*type="button")(?=[^>]*class="z-register-card")[^>]*>/g)],
    ).toHaveLength(RECORD_KINDS.length);
  });

  it('a grelha é uma só por secção, e há uma por cada secção', () => {
    const html = renderMenu();

    expect(contar(html, 'z-register-menu__grid')).toBe(2);
    expect(contar(html, 'z-register-menu__section')).toBe(2);
    expect(contar(html, 'z-register-menu__title')).toBe(2);
  });
});

describe('menu de registo · cartão híbrido (decisão 47)', () => {
  it('cada cartão tem uma área de ícone — uma por cartão, nem mais nem menos', () => {
    const html = renderMenu();

    expect(contar(html, 'z-register-card__icon')).toBe(RECORD_KINDS.length);
    expect(contar(html, 'z-register-card__label')).toBe(RECORD_KINDS.length);
  });

  it('os ícones são SVG em `currentColor`, não emoji', () => {
    const html = renderMenu();

    expect([...html.matchAll(/<svg/g)]).toHaveLength(RECORD_KINDS.length);
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('stroke-width="1.75"');
    // Decorativo: o nome do controlo é o texto do cartão, não o desenho.
    expect(html).toContain('aria-hidden="true"');
  });

  it('não há um único emoji do contrato no menu', () => {
    const html = renderMenu();

    for (const item of RECORD_KINDS) {
      expect(html, `emoji de ${item.code}`).not.toContain(item.icon);
    }
  });

  it('cada SVG traz geometria a sério — não é uma caixa vazia', () => {
    /*
     * Complemento indispensável ao teste dos emoji, e a razão está medida: passar um emoji
     * como **nome** de ícone (`<Icon name="💶">`) não põe o emoji no HTML — põe um `<svg>` sem
     * filhos, porque o mapa não conhece a chave. O teste dos emoji passava; este não. É a
     * diferença entre «não há emoji» e «há um ícone».
     */
    const svgs = [...renderMenu().matchAll(/<svg[\s\S]*?<\/svg>/g)].map((m) => m[0] ?? '');

    expect(svgs).toHaveLength(RECORD_KINDS.length);
    for (const svg of svgs) {
      expect(svg).toContain('<path');
      expect(svg).toMatch(/d="[Mm]/);
    }
  });

  it('a guarda dos emoji não passa por vacuidade: o contrato ainda os declara', () => {
    // Se `RECORD_KINDS` deixasse de ter emoji, a asserção acima passaria sempre. Fixa-se que
    // a lista vigiada não está vazia nem sem emoji.
    expect(RECORD_KINDS.length).toBeGreaterThan(0);
    for (const item of RECORD_KINDS) {
      expect(item.icon.length, item.code).toBeGreaterThan(0);
    }
  });
});

describe('menu de registo · «Repetir último» (decisão 50)', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'localStorage');
  });

  it('não aparece quando não há um tipo usado anteriormente', () => {
    expect(renderMenu()).not.toContain('Repetir último');
  });

  it('aparece no topo, com o tipo a que se refere', () => {
    instalarArmazenamentoCom('fuel');
    const html = renderMenu();

    expect(html).toContain('Repetir último');
    expect(html).toMatch(/class="z-register-menu__repeat-kind">Abastecimento</);
    // Discreta e acima da lista: é um atalho, não a ação principal do menu.
    expect(html.indexOf('Repetir último')).toBeLessThan(html.indexOf('Mais usados'));
  });

  it('um tipo desconhecido no armazenamento não produz repetição', () => {
    instalarArmazenamentoCom('insurance');

    expect(renderMenu()).not.toContain('Repetir último');
  });
});

describe('menu de registo · as classes emitidas existem em app.css', () => {
  const CSS = readFileSync(
    fileURLToPath(new URL('../src/styles/app.css', import.meta.url)),
    'utf8',
  );

  it('todas as classes do menu estão declaradas', () => {
    for (const classe of [
      'z-register-menu__repeat',
      'z-register-menu__repeat-kind',
      'z-register-menu__section',
      'z-register-menu__title',
      'z-register-menu__grid',
      'z-register-card',
      'z-register-card__icon',
      'z-register-card__label',
    ]) {
      expect(CSS, classe).toContain(`.${classe}`);
    }
  });

  it('a grelha é adaptativa (decisão 46) e não uma contagem fixa', () => {
    const grelha = blocoCss(CSS, '.z-register-menu__grid');

    expect(grelha).toContain('auto-fit');
    expect(grelha).toContain('minmax');
    // Duas colunas por omissão, uma só quando não cabem dois cartões confortáveis.
    expect(grelha).toContain('min(100%, 150px)');
  });

  it('o cartão tem retorno de toque (decisão 47) sem ignorar `prefers-reduced-motion`', () => {
    expect(CSS).toContain('.z-register-card:active');

    /*
     * A asserção tem de provar que o `scale` está **dentro** do bloco de movimento reduzido, e
     * não apenas que aparece depois de uma media query qualquer no ficheiro — que era o que um
     * `[\s\S]*?` entre os dois deixaria passar.
     */
    const escala = CSS.indexOf('transform: scale(0.985)');
    expect(escala, 'a regra de pressão').toBeGreaterThan(-1);

    const media = CSS.lastIndexOf('@media (prefers-reduced-motion: no-preference)', escala);
    expect(media, 'o bloco de movimento reduzido').toBeGreaterThan(-1);

    const fimDoBloco = CSS.indexOf('\n}', media);
    expect(fimDoBloco, 'o `scale` tem de estar dentro do bloco').toBeGreaterThan(escala);
  });

  it('o cartão é claro e a área em petróleo é só do ícone (decisão 47)', () => {
    const cartao = blocoCss(CSS, '.z-register-card');
    const icone = blocoCss(CSS, '.z-register-card__icon');

    expect(cartao).toContain('background: var(--z-bg-elevated)');
    expect(cartao).toContain('border: 1px solid var(--z-border)');
    expect(icone).toContain('background: var(--z-accent-soft)');
    expect(icone).toContain('color: var(--z-accent-ink)');
  });
});
