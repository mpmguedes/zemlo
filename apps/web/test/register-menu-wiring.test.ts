import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Ligação do **menu de registo** (decisões 46 e 50) aos pontos de entrada.
 *
 * ## Porque é que isto não é um teste de render
 *
 * O `RegisterMenu` já tem teste de render (`register-menu-render.test.tsx`): prova que o
 * menu, *quando montado*, mostra as duas secções, os cartões certos e o «Repetir último».
 * O que esse teste **não** pode provar é que alguém o chega a montar. Sem `jsdom` não há
 * eventos, e o `AppShell` monta o `Logo`, os `NavLink`, o router, a query de contagem de
 * avisos — um `renderToStaticMarkup` do `AppShell` inteiro seria um teste de fumo frágil
 * que não isola a decisão.
 *
 * O que fica por provar, então, prova-se por **leitura da fonte**: os dois pontos de
 * entrada chamam `openMenu` e não `open(...)`; o contexto define `openMenu` a abrir o menu
 * e a fechar os outros dois estados; e o menu é desenhado a partir desse estado. São
 * exatamente as três afirmações que a decisão 46 faz, e são todas verificáveis no texto.
 *
 * ## O falso verde que isto existe para travar
 *
 * Antes da decisão 46, os dois pontos de entrada chamavam `quickLog.open('expense')` (o
 * painel) e `quickLog.open(QUICK_ACTIONS[0]?.code as 'expense')` (o FAB). Uma regressão
 * natural é alguém «simplificar» de volta para `open('expense')`: o menu continuaria a
 * existir, o teste de render continuaria verde, e o produto voltaria a assumir a despesa
 * — que é precisamente o defeito que a decisão 46 corrige. Por isso a asserção é sobre a
 * **contagem** de `openMenu` (duas) e sobre a **ausência** de `open(` nos pontos de
 * entrada, e não apenas sobre a presença de `openMenu` algures no ficheiro.
 *
 * ## Como é que isto não passa por vacuidade
 *
 * Um `indexOf` que não encontra nada devolve `-1`, e um `slice(-1, ...)` devolve uma
 * string vazia — sobre a qual quase todas as asserções passariam. Por isso o leitor
 * **lança** quando não encontra a âncora, e há um bloco de guardas que afirma que os dois
 * ficheiros foram lidos e contêm os literais de que as asserções dependem.
 */

const APP_SHELL = fileURLToPath(new URL('../src/app/AppShell.tsx', import.meta.url));
const CONTEXTO = fileURLToPath(new URL('../src/components/QuickLogContext.tsx', import.meta.url));

const ler = (caminho: string): string => readFileSync(caminho, 'utf8');

/**
 * Recorta o elemento que contém `marca`, de `abertura` até ao primeiro `fecho` a seguir.
 *
 * Lança quando não encontra a marca ou os delimitadores: uma âncora que desapareceu tem de
 * fazer o teste vermelho, e não devolver uma string vazia que passa em tudo.
 */
function elementoQueContem(fonte: string, marca: string, abertura: string, fecho: string): string {
  const marcaEm = fonte.indexOf(marca);
  if (marcaEm < 0) throw new Error(`não encontrei a âncora «${marca}»`);
  const inicio = fonte.lastIndexOf(abertura, marcaEm);
  if (inicio < 0) throw new Error(`não encontrei «${abertura}» antes de «${marca}»`);
  const fim = fonte.indexOf(fecho, marcaEm);
  if (fim < 0) throw new Error(`não encontrei «${fecho}» depois de «${marca}»`);
  return fonte.slice(inicio, fim + fecho.length);
}

/**
 * Recorta o corpo de um `const <nome> = useCallback(...)`, de `const <nome>` até ao
 * `}, [deps])` que o fecha.
 */
function corpoDoCallback(fonte: string, nome: string): string {
  const inicio = fonte.indexOf(`const ${nome} = useCallback(`);
  if (inicio < 0) throw new Error(`não encontrei a definição de «${nome}»`);
  const fim = fonte.indexOf('}, [', inicio);
  if (fim < 0) throw new Error(`não encontrei o fim de «${nome}»`);
  return fonte.slice(inicio, fim);
}

const contar = (texto: string, alvo: string): number => texto.split(alvo).length - 1;

describe('menu de registo · pontos de entrada (decisão 46)', () => {
  const fonte = ler(APP_SHELL);

  it('os dois ficheiros são lidos e trazem os literais de que as asserções dependem', () => {
    // Guarda anti-vacuidade: sem isto, um caminho errado daria duas strings vazias e o
    // resto do ficheiro passaria sem medir nada.
    expect(fonte.length).toBeGreaterThan(2000);
    expect(fonte).toContain('useQuickLog');
    expect(fonte).toContain('z-sidebar__action');
    expect(fonte).toContain('z-tabbar__link');
    expect(fonte).toContain('Registar');
    expect(ler(CONTEXTO)).toContain('export function QuickLogProvider');
  });

  it('o botão lateral «Registar» abre o menu de tipos', () => {
    const botao = elementoQueContem(fonte, 'z-sidebar__action', '<Button', '</Button>');
    expect(botao).toContain('Registar');
    expect(botao).toContain('quickLog.openMenu()');
    // `open(` abre um formulário concreto e salta o menu — é o defeito que a decisão 46
    // corrige. A expressão regular tem o parêntese para não casar com `openMenu(`.
    expect(botao).not.toMatch(/quickLog\.open\(/);
  });

  it('o botão flutuante da barra de separadores abre o menu de tipos', () => {
    const botao = elementoQueContem(fonte, 'z-tabbar__link', '<button', '</button>');
    expect(botao).toContain('quickLog.openMenu()');
    expect(botao).not.toMatch(/quickLog\.open\(/);
  });

  it('não sobra nenhum ponto de entrada que abra logo um tipo concreto', () => {
    // A contagem é a asserção que morde: voltar a «abrir a despesa» num dos dois sítios
    // baixa a contagem para um, mesmo que o outro continue correto.
    expect(contar(fonte, 'quickLog.openMenu()')).toBe(2);
    expect(fonte).not.toMatch(/quickLog\.open\(/);
  });

  it('o `AppShell` já não decide qual é o tipo por omissão', () => {
    // O FAB usava `QUICK_ACTIONS[0]?.code` — a lista do contrato a servir de resposta à
    // pergunta «que registo?». Com o menu, essa pergunta passou a ser do utilizador.
    expect(fonte).not.toContain('QUICK_ACTIONS');
    expect(fonte).not.toContain("open('expense')");
  });
});

describe('menu de registo · estado do contexto (decisão 46)', () => {
  const fonte = ler(CONTEXTO);

  it('`openMenu` abre o menu e fecha os outros dois estados', () => {
    const corpo = corpoDoCallback(fonte, 'openMenu');
    expect(corpo).toContain('setMenu(true)');
    expect(corpo).toContain('setKind(null)');
    expect(corpo).toContain('setChooser(null)');
  });

  it('abrir um tipo concreto fecha o menu', () => {
    const corpo = corpoDoCallback(fonte, 'open');
    expect(corpo).toContain('setMenu(false)');
    expect(corpo).toContain('setChooser(null)');
    expect(corpo).toContain('setKind(next)');
  });

  it('abrir o seletor de novo registo fecha o menu', () => {
    const corpo = corpoDoCallback(fonte, 'openNovoRegisto');
    expect(corpo).toContain('setMenu(false)');
    expect(corpo).toContain('setChooser({ previousKind })');
  });

  it('fechar limpa os três estados', () => {
    // A `Sheet` usa um `id` de título fixo (`ui/Sheet.tsx`). Duas folhas vivas ao mesmo
    // tempo dariam dois `aria-labelledby` para o mesmo `id`; por isso os três estados são
    // mutuamente exclusivos e o fecho tem de os limpar todos.
    const corpo = corpoDoCallback(fonte, 'close');
    expect(corpo).toContain('setKind(null)');
    expect(corpo).toContain('setChooser(null)');
    expect(corpo).toContain('setMenu(false)');
  });

  it('o estado do menu é exposto e desenha o menu', () => {
    expect(fonte).toContain('menuOpen: menu');
    expect(fonte).toContain('{menu ? <RegisterMenu');
    expect(fonte).toMatch(/import \{ RegisterMenu \} from '\.\/RegisterMenu'/);
  });

  it('o menu recebe `open` a selecionar e fecha-se sozinho', () => {
    const montagem = elementoQueContem(fonte, '<RegisterMenu', '<RegisterMenu', '/>');
    expect(montagem).toContain('onSelect={open}');
    expect(montagem).toContain('setMenu(false)');
  });
});
