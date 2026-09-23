import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CalendarGrid } from '../src/components/CalendarGrid';
import { dateLong, dateRange, dateShort, monthLong, weekday } from '../src/lib/format';

/*
 * O título do mês no cabeçalho do calendário (`WEB-010`, `PC-17`).
 *
 * ## O defeito
 *
 * O título era construído assim:
 *
 * ```ts
 * const monthLabel = dateLong(`${month}-01`).replace(/^1 de /, '').replace(/^1 /, '');
 * ```
 *
 * Os dois `replace` esperam a forma `1 de setembro de 2026` — a do CLDR de `pt`, e **não** a
 * de `pt-PT`. Medido neste ambiente (ICU 78.2, Node 22): para o esqueleto
 * `{day:'2-digit', month:'short', year:'numeric'}`, o CLDR do `pt-PT` resolve o mês para
 * **`2-digit`** — não para `short`. O `resolvedOptions()` diz-o por extenso:
 *
 *     pt-PT, {day:'2-digit', month:'short', year:'numeric'}
 *       → formato resolvido: month: "2-digit"   → "01/09/2026"
 *     pt,    mesmo esqueleto
 *       → "01 de set. de 2026"
 *
 * Ou seja: **o nome curto do mês nunca chega a ser pedido** ao ICU em `pt-PT`, os dois
 * `replace` são código morto, e o cabeçalho mostrava `01/09/2026` onde o produto sempre quis
 * `setembro de 2026`. Enquanto isso, `monthLong()` — `{month:'long', year:'numeric'}`, que
 * devolve exatamente `setembro de 2026` — estava exportada em `lib/format.ts` **sem um único
 * consumidor**.
 *
 * ## Porque é que aqui se asserta texto formatado por `Intl` (e não se asserta em `page-states`)
 *
 * `page-states.test.tsx` evita de propósito asserções sobre o título do mês, e explica porquê:
 * lá o que se prova é um **estado** (erro, carregamento, vazio), e prender essa prova ao texto
 * do CLDR faria o teste mudar de cor sem ninguém ter mexido no estado.
 *
 * Aqui é o inverso: **o texto formatado é o produto**. A regra do produto é «o cabeçalho diz o
 * mês por extenso», e a única forma de a provar é afirmar a frase. Se o CLDR do `pt-PT` mudar,
 * é este teste que deve falhar — e deve, porque nesse dia o cabeçalho mudou para quem usa a
 * aplicação. Por isso as asserções são sobre **literais** (`'setembro de 2026'`), e nunca sobre
 * `monthLong(...)`: afirmar o resultado da própria função que o componente usa passaria mesmo
 * com a função avariada, e não provaria nada.
 *
 * ## Porque é que as asserções são delimitadas ao título
 *
 * Cada célula de dia leva `dateLong(cell.date)` no `aria-label`, pelo que o HTML da grelha
 * **contém** legitimamente `01/09/2026` — na célula do dia 1. Um `not.toContain('01/09/2026')`
 * sobre o HTML todo falharia com o código correto, e o teste seria abandonado em vez de
 * corrigido. As asserções de ausência são, por isso, sobre o **texto do título** extraído.
 *
 * ## O que o teste distingue, explicitamente
 *
 * Cada requisito da tarefa tem aqui uma asserção que **só** passa com o comportamento novo:
 *
 * | Requisito | Onde |
 * | --- | --- |
 * | o título é `setembro de 2026` | `título do mês…` |
 * | o mês **não** está hardcoded | `acompanha o mês pedido` + `produz o mês certo em todos os 12 meses` |
 * | a **alteração** do mês apresentado muda o título | `a alteração do mês apresentado` |
 * | a passagem de ano não erra o mês | `acerta na passagem de ano` |
 * | os restantes formatadores de data não mudaram | `os restantes formatadores de data não mudaram` + o invariante das células |
 * | o `aria-label` é coerente com o título | `diz exatamente o mesmo mês que o título visível` |
 *
 * Um teste que só verificasse «existe texto no título» passaria com `01/09/2026` lá dentro —
 * é precisamente o defeito. Por isso todas as asserções de título são de **igualdade** com o
 * literal do mês, e há uma asserção negativa explícita contra a data que estava lá antes.
 *
 * ## Ruído esperado
 *
 * O `react-router` avisa que `useLayoutEffect` não faz nada no servidor. Não há hidratação
 * aqui, só o HTML de um render; os avisos não são falhas.
 */

/* -------------------------------------------------------------------------- */
/* Extração do que se afirma                                                   */
/* -------------------------------------------------------------------------- */

/*
 * As duas extrações **falham alto** quando não encontram o alvo, em vez de devolverem `''`.
 * Sem isto, uma mudança de classe (`z-card__title`) faria as asserções passarem sobre uma
 * cadeia vazia — um falso verde silencioso, que é o pior resultado possível num teste que
 * existe para fixar texto.
 */

const TITLE_PATTERN = /<span class="z-card__title"[^>]*>([^<]*)<\/span>/;
const GRID_LABEL_PATTERN = /<div class="z-calendar__grid"[^>]*aria-label="([^"]*)"/;

function extrair(html: string, pattern: RegExp, oQue: string): string {
  const match = pattern.exec(html);
  if (!match) throw new Error(`O HTML renderizado não tem ${oQue}.`);
  return match[1] ?? '';
}

/** O texto visível do título do mês. */
const tituloDoMes = (html: string): string => extrair(html, TITLE_PATTERN, 'o título do mês (`span.z-card__title`)');

/** O nome acessível da grelha. */
const rotuloDaGrelha = (html: string): string =>
  extrair(html, GRID_LABEL_PATTERN, 'a grelha (`div.z-calendar__grid` com `aria-label`)');

function renderMes(month: string): string {
  return renderToStaticMarkup(
    <CalendarGrid
      month={month}
      onMonthChange={() => {}}
      data={{ entries: [], days: [] } as unknown as Parameters<typeof CalendarGrid>[0]['data']}
      isLoading={false}
      error={null}
    />,
  );
}

/** `'2026-09'` → `'setembro de 2026'`, medido neste ambiente (ICU 78.2). */
const MESES_DE_2026 = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/* -------------------------------------------------------------------------- */
/* O título                                                                    */
/* -------------------------------------------------------------------------- */

describe('título do mês no cabeçalho do calendário', () => {
  it('mostra o mês por extenso, e não a data do primeiro dia', () => {
    const titulo = tituloDoMes(renderMes('2026-09'));

    expect(titulo).toBe('setembro de 2026');
    // A asserção explícita que o `PC-17` pede: o defeito era este literal.
    expect(titulo).not.toBe('01/09/2026');
  });

  it('não deixa nenhuma data no título', () => {
    // `dd/MM/yyyy` é o formato que o `dateLong` produz em `pt-PT`. Se voltar ao título, o
    // teste falha com uma mensagem que diz o que apareceu em vez do mês.
    expect(tituloDoMes(renderMes('2026-09'))).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(tituloDoMes(renderMes('2026-01'))).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it('acompanha o mês pedido, em meses diferentes', () => {
    // Dois meses, para o teste não passar por um acerto de um único caso: se o título fosse
    // uma constante escrita à mão, o segundo caso falhava.
    expect(tituloDoMes(renderMes('2026-09'))).toBe('setembro de 2026');
    expect(tituloDoMes(renderMes('2026-01'))).toBe('janeiro de 2026');
    expect(tituloDoMes(renderMes('2026-12'))).toBe('dezembro de 2026');
  });

  it('convive com as datas dos dias, que continuam a ser datas', () => {
    /*
     * A prova de que a correção foi cirúrgica, no **mesmo** HTML: o título diz o mês e as
     * células continuam a dizer o dia. Se alguém "corrigisse" o cabeçalho mudando o
     * `dateLong` para o mês por extenso, o título ficaria certo e **todo o resto da
     * aplicação** passaria a mostrar meses onde mostra datas — e a segunda asserção falhava.
     */
    const html = renderMes('2026-09');
    expect(tituloDoMes(html)).toBe('setembro de 2026');
    expect(html).toContain('aria-label="01/09/2026, sem entradas"');
  });
});

/* -------------------------------------------------------------------------- */
/* A alteração do mês apresentado                                              */
/* -------------------------------------------------------------------------- */

/*
 * O mês apresentado é o `month` do componente, e o `CalendarPage` alimenta-o a partir do URL
 * (`?mes=YYYY-MM`, `onMonthChange={setMonth}`). É por isso que a «alteração do mês» é
 * observável **no prop**: o componente é controlado, e o que aqui se prova é que o título é
 * uma função do mês apresentado — muda com ele, e não fica preso ao primeiro.
 *
 * **Limitação declarada:** a aritmética do `shiftMonth` (o `‹`/`›` a somar/subtrair 1 ao mês)
 * vive dentro do componente e **não** é observável sem DOM — o `renderToStaticMarkup` devolve
 * HTML, sem manipuladores. O que os testes abaixo provam é que, para o mês que essa aritmética
 * produz, o título é o certo — incluindo na passagem de ano, que é o caso em que a aritmética
 * erra por reflexo. A aritmética em si fica por provar, e não se afirma como provada.
 */
describe('a alteração do mês apresentado', () => {
  it('muda o título quando o mês apresentado muda', () => {
    const setembro = tituloDoMes(renderMes('2026-09'));
    const outubro = tituloDoMes(renderMes('2026-10'));

    expect(setembro).toBe('setembro de 2026');
    expect(outubro).toBe('outubro de 2026');
    // Não basta cada um estar certo: a **transição** tem de produzir um título diferente.
    // Se o título estivesse preso (memoizado sem dependência, ou constante), os dois seriam
    // iguais e o mês mostrado deixaria de corresponder ao mês navegado.
    expect(outubro).not.toBe(setembro);
  });

  it('acerta na passagem de ano', () => {
    // O caso em que a aritmética de mês erra por reflexo (dezembro + 1 = «mês 13»). O mês
    // seguinte a `2026-12` é `2027-01`, e o título tem de o dizer.
    expect(tituloDoMes(renderMes('2026-12'))).toBe('dezembro de 2026');
    expect(tituloDoMes(renderMes('2027-01'))).toBe('janeiro de 2027');
    expect(tituloDoMes(renderMes('2027-01'))).not.toBe(tituloDoMes(renderMes('2026-12')));
  });

  it('produz o mês certo em todos os 12 meses, e nenhum repetido', () => {
    const titulos = MESES_DE_2026.map((_, i) =>
      tituloDoMes(renderMes(`2026-${String(i + 1).padStart(2, '0')}`)),
    );

    // Igualdade com os 12 literais: nenhum mês pode sair trocado.
    expect(titulos).toEqual(MESES_DE_2026.map((nome) => `${nome} de 2026`));
    // E 12 títulos **distintos**: se o título fosse uma constante, isto falhava; e se o mês
    // não fosse lido do prop, dois meses quaisquer dariam o mesmo título.
    expect(new Set(titulos).size).toBe(12);
  });
});

/* -------------------------------------------------------------------------- */
/* O nome acessível                                                            */
/* -------------------------------------------------------------------------- */

describe('nome acessível da grelha', () => {
  it('diz o mês por extenso, como o título visível', () => {
    expect(rotuloDaGrelha(renderMes('2026-09'))).toBe('Calendário de setembro de 2026');
  });

  it('não repete a data que o título deixou de mostrar', () => {
    // O rótulo deriva do mesmo `monthLabel`; este teste fixa essa ligação. Se alguém um dia
    // lhes der fontes diferentes, o leitor de ecrã passa a ouvir uma coisa e a ver outra.
    expect(rotuloDaGrelha(renderMes('2026-09'))).not.toContain('01/09/2026');
  });

  it('diz exatamente o mesmo mês que o título visível', () => {
    /*
     * A coerência é uma propriedade própria, e não a soma de duas asserções independentes:
     * cada um podia estar certo sozinho e os dois discordarem entre si. Aqui o rótulo é
     * comparado **com o título do mesmo render**, pelo que qualquer divergência de fonte
     * falha — e falha nos três meses, incluindo um de outro ano.
     */
    for (const mes of ['2026-09', '2026-01', '2027-01']) {
      const html = renderMes(mes);
      expect(rotuloDaGrelha(html)).toBe(`Calendário de ${tituloDoMes(html)}`);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* O que não pode ter mudado                                                   */
/* -------------------------------------------------------------------------- */

describe('os restantes formatos de data', () => {
  /*
   * Este describe é um **invariante**, e a diferença importa: tem de estar verde *antes* e
   * *depois* da correção. Se estivesse vermelho antes, não estaria a medir «o que não mudou»
   * — estaria a medir o defeito outra vez, e a afirmação de que a alteração foi cirúrgica
   * ficaria sem prova nenhuma.
   *
   * Foi o que aconteceu na primeira versão deste teste, e só se viu por se ter corrido o
   * teste **contra o código intacto**: aqui havia uma segunda asserção sobre o título, e por
   * isso o invariante nascia vermelho. A asserção foi movida para o describe do título (onde
   * é legítimo estar vermelho antes), e este describe ficou só com o que não pode mudar.
   */
  it('as células dos dias continuam a mostrar a data em `dd/MM/yyyy`', () => {
    // A asserção é sobre o `aria-label` da célula, e não sobre o HTML todo: o HTML da grelha
    // contém as duas formas de data em sítios diferentes, e é isso que se quer fixar.
    expect(renderMes('2026-09')).toContain('aria-label="01/09/2026, sem entradas"');
    // Um segundo mês, para o formato não passar por uma coincidência de setembro.
    expect(renderMes('2026-01')).toContain('aria-label="01/01/2026, sem entradas"');
  });
});

/*
 * Os formatadores do módulo, um a um. O `WEB-010` mudou o **consumidor** de `monthLong`, não
 * o comportamento de nenhum formatador — e é isso que estes testes fixam. Se alguém
 * «corrigisse» o cabeçalho mexendo no `DATE_FORMATTER` (por exemplo trocando o mês para
 * `'long'`), o título ficava certo e **todo o resto da aplicação** passava a mostrar meses
 * onde mostra datas; aqui falharia.
 */
describe('os restantes formatadores de data não mudaram', () => {
  it('`dateLong` continua a produzir a data numérica', () => {
    expect(dateLong('2026-09-01')).toBe('01/09/2026');
    expect(dateLong('2027-01-05')).toBe('05/01/2027');
  });

  it('`dateShort` continua a produzir `dd/MM`', () => {
    expect(dateShort('2026-09-01')).toBe('01/09');
  });

  it('`weekday` continua a produzir o dia da semana', () => {
    expect(weekday('2026-09-01')).toBe('terça-feira');
    expect(weekday('2026-09-06')).toBe('domingo');
  });

  it('`dateRange` continua a encurtar quando o mês ou o ano coincidem', () => {
    expect(dateRange('2026-09-01', '2026-09-30')).toBe('01/09 — 30/09/2026');
    expect(dateRange('2026-09-01', '2026-10-31')).toBe('01/09 — 31/10/2026');
    expect(dateRange('2026-09-01', '2027-03-31')).toBe('01/09/2026 — 31/03/2027');
  });

  it('o título do calendário é o único consumidor que `monthLong` ganhou', () => {
    // O destino que o `PC-17` mandava decidir: `monthLong` passa a ter consumidor (o
    // cabeçalho), e não é removida nem duplicada. A função não mudou.
    expect(monthLong('2026-09-01')).toBe('setembro de 2026');
  });
});

/* -------------------------------------------------------------------------- */
/* O formatador                                                                */
/* -------------------------------------------------------------------------- */

describe('monthLong', () => {
  it('devolve o mês por extenso com o ano', () => {
    // Literais, e não o resultado de outra chamada: é este o contrato que o cabeçalho
    // consome. Uma mudança de `month: 'long'` para `month: 'short'` em `MONTH_FORMATTER`
    // (que em `pt-PT` resolve para `09/2026`) falha aqui, e é isso que se quer.
    expect(monthLong('2026-09-01')).toBe('setembro de 2026');
    expect(monthLong('2026-01-01')).toBe('janeiro de 2026');
  });

  it('trata a ausência de data como o resto do módulo', () => {
    expect(monthLong(null)).toBe('—');
    expect(monthLong(undefined)).toBe('—');
  });

  it('não é a mesma coisa que `dateLong`', () => {
    // A confusão que originou o defeito: são funções diferentes, com saídas diferentes. Se
    // um dia voltarem a coincidir, é porque uma delas mudou de significado.
    expect(monthLong('2026-09-01')).not.toBe('01/09/2026');
  });
});
