import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToastView, type Toast } from '../src/ui/Toaster';
import { QuickLogChooser } from '../src/components/QuickLogChooser';
import { recordDetailPath, recordKindLabel, recordListPath } from '../src/lib/recordKinds';
import {
  ESCOLHER_OUTRO_TIPO,
  NOVO_REGISTO,
  VER_REGISTO,
  novoRegistoKinds,
  postSaveActions,
  repeatLabel,
} from '../src/lib/postSave';

/*
 * `AUD` · Registo / pós-gravação — decisões §52, §53, §54.
 *
 * ## Porque é que a decisão vive em `lib/` e não no JSX
 *
 * Sem `jsdom` (a regra escrita em `page-states.test.tsx`) não há eventos: um teste que clicasse
 * em «Novo registo» não poderia correr. O que **é** observável é a **função** que decide — para
 * onde vai «Ver registo», que ações o aviso tem, o que oferece o seletor. É por isso que essas
 * decisões foram extraídas para `lib/recordKinds.ts` e `lib/postSave.ts`: para que a prova seja
 * sobre a regra e não sobre a intenção.
 *
 * Os `onClick` das ações são funções vulgares: o teste **invoca-os** e observa o que fizeram.
 * Isso é comportamento a sério — só não passa pelo DOM.
 *
 * ## O que estes testes NÃO provam
 *
 * Não provam que a folha fecha, nem que o aviso aparece no ecrã a seguir a gravar (isso exigiria
 * disparar o `submit`). Provam a decisão: o que o aviso oferece e para onde cada escolha leva. A
 * ligação ao formulário fica coberta pela guarda estática do fim do ficheiro.
 *
 * ## Prova por mutação (declarada e verificada em `PROPOSAL-A3-...`/relatório)
 *
 *  - `recordDetailPath` deixa de excluir o odómetro → o teste «sem Ver registo no odómetro» cai;
 *  - `postSaveActions` deixa de acrescentar «Novo registo» → o teste das duas ações cai;
 *  - `repeatLabel` deixa de baixar a caixa → «Repetir Despesa» ≠ «Repetir despesa»;
 *  - a ordem das ações inverte-se → o teste da ordem cai;
 *  - o seletor abre na lista mesmo com tipo anterior → o render estático cai;
 *  - a regra `:hover` da ação desaparece → as guardas do hover caem (e o `--z-accent-soft`
 *    volta a mandar, com 1,27:1 medido).
 */

describe('§54 · navegação de um registo', () => {
  it('a lista de um tipo é a rota plural', () => {
    expect(recordListPath('expense')).toBe('/records/expenses');
    expect(recordListPath('fuel')).toBe('/records/fuel');
  });

  it('o detalhe de um registo criado é `/records/<segmento>/<id>`', () => {
    expect(recordDetailPath('expense', 'abc')).toBe('/records/expenses/abc');
    expect(recordDetailPath('maintenance', 'r-9')).toBe('/records/maintenance/r-9');
  });

  it('o identificador é codificado no caminho', () => {
    // Um id com barra ou espaço não pode partir o caminho.
    expect(recordDetailPath('fuel', 'a/b c')).toBe('/records/fuel/a%2Fb%20c');
  });

  it('o odómetro não tem detalhe: devolve `null` em vez de uma rota inexistente', () => {
    // Mutação: remover o `kind === 'odometer'` de `recordDetailPath` faz este teste cair e
    // passa a existir um botão «Ver registo» que levaria a uma página que a API não serve.
    expect(recordDetailPath('odometer', 'x')).toBeNull();
  });

  it('sem identificador não há detalhe a abrir', () => {
    expect(recordDetailPath('expense', null)).toBeNull();
  });

  it('a etiqueta vem do contrato partilhado', () => {
    expect(recordKindLabel('expense')).toBe('Despesa');
    expect(recordKindLabel('odometer')).toBe('Quilometragem');
  });
});

describe('§52 · ações do aviso de confirmação', () => {
  it('um registo com detalhe oferece «Ver registo» e «Novo registo», por esta ordem', () => {
    const actions = postSaveActions('expense', 'e-1', { navigate: () => {}, novoRegisto: () => {} });

    // A ordem é fixa: ver primeiro, repetir depois. Uma ordem que mudasse com o tipo obrigaria
    // a reler o aviso sempre que se mudasse de tipo de registo.
    expect(actions.map((action) => action.label)).toEqual([VER_REGISTO, NOVO_REGISTO]);
  });

  it('«Ver registo» navega para o detalhe do registo criado', () => {
    const navigate = vi.fn();
    const actions = postSaveActions('fuel', 'f-7', { navigate, novoRegisto: () => {} });

    actions.find((action) => action.label === VER_REGISTO)?.onClick();

    expect(navigate).toHaveBeenCalledWith('/records/fuel/f-7');
  });

  it('«Novo registo» abre o seletor com o tipo acabado de gravar', () => {
    const novoRegisto = vi.fn();
    const actions = postSaveActions('charging', 'c-3', { navigate: () => {}, novoRegisto });

    actions.find((action) => action.label === NOVO_REGISTO)?.onClick();

    expect(novoRegisto).toHaveBeenCalledWith('charging');
  });

  it('no odómetro há «Novo registo» mas não «Ver registo»', () => {
    /*
     * Mutação: fazer `recordDetailPath` devolver um caminho para o odómetro acrescenta aqui uma
     * ação «Ver registo» e este `toEqual` cai — é a prova de que a omissão é deliberada.
     */
    const actions = postSaveActions('odometer', null, { navigate: () => {}, novoRegisto: () => {} });

    expect(actions.map((action) => action.label)).toEqual([NOVO_REGISTO]);
  });
});

describe('§53 · seletor de novo registo', () => {
  it('a repetição nomeia o tipo em minúsculas', () => {
    // Mutação: tirar o `.toLowerCase()` faz este teste cair («Repetir Despesa»).
    expect(repeatLabel('expense')).toBe('Repetir despesa');
    expect(repeatLabel('maintenance')).toBe('Repetir manutenção');
  });

  it('«Escolher outro tipo» oferece os cinco tipos do contrato, com ícone', () => {
    const kinds = novoRegistoKinds();

    expect(kinds.map((item) => item.kind)).toEqual([
      'expense',
      'fuel',
      'charging',
      'maintenance',
      'odometer',
    ]);
    for (const item of kinds) {
      expect(item.label.length, item.kind).toBeGreaterThan(0);
      expect(item.icon.length, item.kind).toBeGreaterThan(0);
    }
  });

  it('com um tipo anterior, o primeiro ecrã é a escolha entre repetir e mudar', () => {
    const html = renderToStaticMarkup(
      <QuickLogChooser previousKind="expense" onSelect={() => {}} onClose={() => {}} />,
    );

    expect(html).toContain(repeatLabel('expense'));
    expect(html).toContain(ESCOLHER_OUTRO_TIPO);
    // A lista de tipos está atrás do segundo passo: não aparece ainda.
    expect(html).not.toContain('>Abastecimento<');
  });

  it('sem tipo anterior, abre logo na lista (não há repetição a oferecer)', () => {
    const html = renderToStaticMarkup(
      <QuickLogChooser previousKind={null} onSelect={() => {}} onClose={() => {}} />,
    );

    expect(html).not.toContain(ESCOLHER_OUTRO_TIPO);
    for (const item of novoRegistoKinds()) {
      expect(html, item.label).toContain(`>${item.label}</button>`);
    }
  });
});

describe('§52 · o aviso desenha todas as ações', () => {
  it('um aviso com duas ações mostra os dois rótulos e o fechar', () => {
    const toast: Toast = {
      id: 1,
      message: 'Despesa de 12,00 € registada.',
      variant: 'ok',
      actions: [
        { label: VER_REGISTO, onClick: () => {} },
        { label: NOVO_REGISTO, onClick: () => {} },
      ],
    };

    const html = renderToStaticMarkup(<ToastView toast={toast} onDismiss={() => {}} />);

    expect(html).toContain('Despesa de 12,00 € registada.');
    expect(html).toContain(VER_REGISTO);
    expect(html).toContain(NOVO_REGISTO);
    expect(html).toContain('aria-label="Fechar aviso"');
  });

  it('um aviso sem ações não desenha botão nenhum além de fechar', () => {
    const toast: Toast = { id: 2, message: 'Sessão terminada.', variant: 'info' };

    const html = renderToStaticMarkup(<ToastView toast={toast} onDismiss={() => {}} />);

    expect(html).not.toContain(VER_REGISTO);
    expect(html).not.toContain(NOVO_REGISTO);
    expect(html).toContain('aria-label="Fechar aviso"');
  });
});

/* -------------------------------------------------------------------------- */
/* Guardas estáticas: o que só se vê no código                                */
/* -------------------------------------------------------------------------- */

const QUICKLOG = fileURLToPath(new URL('../src/components/QuickLogSheet.tsx', import.meta.url));
const TOASTER = fileURLToPath(new URL('../src/ui/Toaster.tsx', import.meta.url));
const APP_CSS = fileURLToPath(new URL('../src/styles/app.css', import.meta.url));

function fonteQuickLog(): string {
  return readFileSync(QUICKLOG, 'utf8');
}

describe('área de toque das ações do aviso (`--z-touch` = 44 px)', () => {
  /*
   * O defeito que isto fixa (achado das auditorias A1_3 §7.7 e A1_4 UX-UI-006, corrigido depois
   * de §52–§54): as ações do aviso tinham 28 px de altura — um `style` inline forçava esse valor —
   * e o fechar não tinha caixa nenhuma. Com duas ações, eram dois alvos abaixo da política.
   *
   * Sem `jsdom` não se mede uma caixa num teste; o que se pode fixar é a **marcação** e a
   * **regra de estilo**. A medição real (getBoundingClientRect em Chromium) está no relatório.
   * É uma guarda de convenção: morde quando alguém volta a pôr a variante pequena ou um
   * `minHeight` inline.
   */
  it('as ações não usam a variante pequena nem altura em `style`', () => {
    const conteudo = readFileSync(TOASTER, 'utf8');
    /*
     * Ancorado ao **uso real** (`className="…"` e `minHeight:`), e não à mera ocorrência da
     * palavra: o ficheiro explica em comentário porque é que a variante pequena saiu, e uma
     * guarda que casasse com o comentário ficaria vermelha por causa da própria explicação.
     */
    expect(conteudo).not.toMatch(/className="[^"]*\bz-btn--sm\b[^"]*"/);
    // `z-btn--sm` fixa 36 px e um `minHeight` inline já fixou 28 px: nenhum chega aos 44 px.
    expect(conteudo).not.toMatch(/minHeight:/);
  });

  it('o CSS do aviso dá `--z-touch` às ações e ao fechar', () => {
    const css = readFileSync(APP_CSS, 'utf8');
    // As ações e o fechar partilham a regra de altura; o fechar acrescenta a largura mínima.
    expect(css).toMatch(/\.z-toast__action,[\s\S]{0,240}?min-height: var\(--z-touch\)/);
    expect(css).toMatch(/\.z-toast__close \{[\s\S]{0,320}?min-width: var\(--z-touch\)/);
  });

  it('a guarda encontra o aviso — não passa por vacuidade', () => {
    // Sem isto, uma expressão que deixasse de casar faria as guardas acima passarem para sempre.
    const conteudo = readFileSync(TOASTER, 'utf8');
    expect(conteudo).toContain('className="z-toast__close"');
    expect(conteudo).toContain('z-toast__action');
    expect(readFileSync(APP_CSS, 'utf8')).toContain('.z-toast__action');
  });
});

describe('hover das ações do aviso (o achado medido de 1,27:1)', () => {
  /*
   * O `.z-btn--ghost` da casa sinaliza o hover com `--z-accent-soft` (verde-claro) e a tinta de
   * acento. Sobre a superfície do aviso — sólida, de estado — isso **apaga** o texto: medido em
   * 1,27:1 (branco sobre `#cdeae8`) no `ok` do tema claro. O que fica é um véu neutro da cor do
   * próprio aviso.
   *
   * Sem `jsdom` não há `:hover` a disparar; o que se fixa é a regra. A medição real (razão de
   * contraste do fundo composto com a tinta) está em `PROPOSAL-A3-UX-TOAST-TOUCH.md`.
   */
  it('o hover da ação é um véu neutro, não a superfície de acento da casa', () => {
    const css = readFileSync(APP_CSS, 'utf8');
    const regra = css.match(/\.z-toast__action:hover:not\(:disabled\) \{[\s\S]{0,200}?\}/)?.[0] ?? '';

    // A regra existe e não passa por vacuidade: sem ela, o `:hover` do `.z-btn--ghost` volta a mandar.
    expect(regra).toContain('background:');
    /*
     * 8 % e não 16 %: no tema claro as superfícies do aviso são mais escuras (#1b784f, #c2410c)
     * e 16 % de branco sobe o fundo até o branco perder os 4,5:1 — medido em 3,97:1. Com 8 %
     * fica em 4,65:1 (ok) e 4,57:1 (danger). É o valor que a medição fixou, não uma estimativa.
     */
    expect(regra).toContain('rgba(255, 255, 255, 0.08)');
    expect(regra).not.toContain('--z-accent-soft');
  });

  it('o seletor do hover empata a especificidade com o `.z-btn--ghost`', () => {
    /*
     * O `:hover` da casa é `.z-btn--ghost:hover:not(:disabled)` — (0,3,0). Um
     * `.z-toast__action:hover` simples é (0,2,0) e PERDE a cascata, mesmo vindo depois: o fundo
     * voltava a ser o `--z-accent-soft` e o contraste media 2,57:1. O `:not(:disabled)` é o que
     * traz a regra do aviso para o mesmo peso.
     *
     * Mutação: tirar o `:not(:disabled)` faz este teste cair — e o `hover` do `.z-btn--ghost`
     * volta a ganhar.
     */
    const css = readFileSync(APP_CSS, 'utf8');
    expect(css).toContain('.z-toast__action:hover:not(:disabled)');
  });

  it('o tema escuro usa o véu escuro (o `ok` fica claro e a tinta é escura)', () => {
    const css = readFileSync(APP_CSS, 'utf8');
    // O véu escuro vive dentro do bloco do tema escuro, ancorado ao seletor da ação.
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\) \{[\s\S]{0,400}?\.z-toast__action:hover:not\(:disabled\) \{[\s\S]{0,200}?rgba\(0, 0, 0, 0\.1\)/,
    );
  });
});

describe('§54 · a folha não navega ao guardar', () => {
  it('não há `navigate(...)` no formulário: navegar é uma escolha, não um efeito de gravar', () => {
    /*
     * A decisão 54 exige «evitar navegação inesperada». Ao guardar, a folha só fecha e mostra o
     * aviso; a navegação vive **dentro** das ações (`lib/postSave.ts`), que só correm se o
     * utilizador as escolher. Se este ficheiro voltasse a chamar `navigate(...)` diretamente,
     * o contexto passaria a ser alterado sem o utilizador pedir — e é isso que a guarda impede.
     *
     * Mutação: acrescentar `navigate('/records/expenses')` a um `onSubmit` faz este teste cair.
     */
    expect(fonteQuickLog()).not.toMatch(/\bnavigate\(/);
  });

  it('cada um dos cinco formulários constrói as ações com o seu tipo', () => {
    const conteudo = fonteQuickLog();
    for (const kind of ['expense', 'fuel', 'charging', 'maintenance', 'odometer']) {
      expect(conteudo, kind).toContain(`postSaveActions('${kind}'`);
    }
  });
});

describe('§52 · um erro continua a ser um erro, não um aviso de sucesso', () => {
  it('os blocos `catch` delegam no `<FormError>` e não mostram aviso', () => {
    /*
     * O tratamento de erro existente não pode ser mascarado: se um `catch` passasse a mostrar um
     * toast, uma gravação falhada pareceria bem-sucedida. O corpo do bloco — só um comentário que
     * remete para o `<FormError>` — é o que fixa que o erro é apresentado por esse caminho e por
     * mais nenhum. São os quatro formulários que criam por mutação (o odómetro usa `.catch(() =>
     * null)` no seu próprio hook, fora desta contagem).
     *
     * Mutação: trocar o corpo de um `catch` por um `toast.show(...)` faz uma destas contagens cair.
     */
    const conteudo = fonteQuickLog();
    const apresentado = [...conteudo.matchAll(/\/\* apresentado pelo `<FormError>` \*\//g)].length;
    const verFormError = [...conteudo.matchAll(/\/\* ver `FormError` \*\//g)].length;

    expect(apresentado + verFormError).toBe(4);
  });

  it('os formulários continuam a apresentar o erro da mutação', () => {
    const conteudo = fonteQuickLog();
    // Quatro formulários usam a mutação de criação; o odómetro usa o seu próprio estado.
    expect([...conteudo.matchAll(/<FormError error=\{create\.error\} \/>/g)]).toHaveLength(4);
    expect(conteudo).toContain('<FormError error={odometer.error} />');
  });
});
