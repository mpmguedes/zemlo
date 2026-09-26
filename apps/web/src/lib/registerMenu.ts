import { QUICK_ACTIONS, RECORD_KINDS, type RecordKind } from '@zemlo/shared';
import type { IconName } from '../ui/Icon';

/**
 * Composição do menu «Registar» (decisões 46, 47, 49, 50).
 *
 * Vive fora do componente pela mesma razão que `lib/tabs.ts` e `lib/recordKinds.ts`: é a
 * parte da decisão que se **prova sem um DOM**. O projeto decidiu, por escrito, não
 * introduzir `jsdom`; sem eventos não se observa um clique, mas observa-se uma função. O que
 * se pode afirmar aqui — que secções existem, que tipos lá estão, que não há tipos
 * inventados — é afirmável em teste; o resto seria uma asserção sobre aparência que ninguém
 * mede.
 *
 * ## Que tipos entram (decisão 49: «não inventar novos tipos»)
 *
 * Os **cinco** do contrato partilhado (`RECORD_KINDS`, «Tipos de registo que qualquer veículo
 * pode receber»). Não é uma escolha de gosto: é a definição do produto. Ficaram de fora, de
 * propósito, os seguros, inspeções, impostos, lembretes e documentos — apesar de a §5.2 do
 * ROADMAP e o próprio ecrã de registos os chamarem «secções de registos». A razão é concreta e
 * medida: **não têm formulário alcançável a partir daqui.** Em `VehicleDetailPage.tsx` o
 * formulário de cada um vive atrás de `showForm`, que só é ligado pelo estado vazio da lista
 * (`:972`, `:1113`, `:1266`, `:1533`); com registos já existentes, não há botão que o abra.
 * Oferecer no menu um tipo que aterra num ecrã onde não se pode criar é a promessa vazia que o
 * projeto já rejeitou noutro sítio («prometer uma página que não existe é pior do que não a
 * oferecer»). Entram quando tiverem porta própria — e nessa altura é uma linha aqui.
 *
 * ## «Mais usados» (decisão 49: 3–4 ações)
 *
 * São **quatro**, e a derivação não é inventada: é a mesma regra que o painel já aplica e
 * documenta. `DashboardPage.tsx:187-197` mostra «os quatro registos do dia a dia (despesa,
 * abastecimento, carregamento, manutenção)» e exclui a quilometragem com um motivo escrito —
 * «tem o seu próprio caminho natural: é registada dentro do abastecimento ou do carregamento,
 * onde é um campo pré-preenchido e não uma ação separada». Reutilizar a regra em vez de
 * escrever uma segunda lista é o que impede as duas de divergirem.
 */

/** Cabeçalho da secção das ações principais. */
export const SECAO_MAIS_USADOS = 'Mais usados';
/** Cabeçalho da secção dos restantes tipos. */
export const SECAO_OUTROS = 'Outros';
/** Rótulo da ação discreta de repetição (decisão 50). */
export const REPETIR_ULTIMO = 'Repetir último';

/**
 * Ícone local de cada tipo de registo.
 *
 * O contrato continua a distribuir emoji (`RECORD_KINDS[].icon`) — mudá-lo tocaria a API e o
 * cliente Dart do mobile, e é uma frente própria. A web deixa de o consumir **aqui** e mapeia
 * `code → IconName` localmente, que é a migração progressiva que as auditorias recomendam.
 *
 * ## Nota de tipo, medida
 *
 * `RecordKind` é, na prática, **`string`**: `freeze()` em `registry.ts` não preserva os
 * literais, pelo que o contrato não oferece a união fechada que permitiria um `Record`
 * exaustivo e verificado pelo compilador. A exaustividade é por isso fixada **por teste**
 * (`register-menu.test.ts`: cada código de `RECORD_KINDS` tem de ter entrada aqui). Sem essa
 * guarda, um tipo novo no contrato apareceria no menu sem ícone e ninguém daria por isso — que
 * é exatamente o género de degradação silenciosa que o projeto recusa.
 */
export const RECORD_ICON: Record<string, IconName> = {
  expense: 'receipt',
  fuel: 'fuel',
  charging: 'bolt',
  maintenance: 'wrench',
  odometer: 'gauge',
};

/**
 * Códigos das ações principais — os mesmos quatro do painel.
 *
 * Derivado de `QUICK_ACTIONS` (a ordem do contrato) e não escrito à mão: assim a secção não
 * pode divergir da ordem canónica nem ganhar um tipo que o contrato não tenha.
 */
const CODIGOS_MAIS_USADOS: readonly string[] = QUICK_ACTIONS.filter(
  (action) => action.code !== 'odometer',
).map((action) => action.code);

export interface RegisterMenuItem {
  kind: RecordKind;
  label: string;
  /**
   * `null` quando o contrato tem um tipo que a web ainda não sabe desenhar.
   *
   * Devolver `null` em vez de um ícone por omissão é deliberado: um «recibo» a fingir de
   * carregamento seria pior do que um cartão sem ícone. O tipo continua a poder registar-se;
   * o que falta é decoração, e o teste que fixa a exaustividade do mapa assinala-o.
   */
  icon: IconName | null;
}

export interface RegisterMenuSection {
  title: string;
  items: RegisterMenuItem[];
}

/** Todos os tipos do menu, na ordem do contrato. Uma só fonte de etiquetas e ícones. */
const ITEMS: readonly RegisterMenuItem[] = RECORD_KINDS.map((item) => ({
  kind: item.code,
  label: item.label,
  icon: RECORD_ICON[item.code] ?? null,
}));

/**
 * Secções do menu, pela ordem em que aparecem.
 *
 * A secção «Outros» só existe se tiver conteúdo: uma secção vazia é um cabeçalho a prometer
 * opções que não há. É a decisão 46 a dizer que a grelha se adapta ao número de opções — e o
 * caso extremo dessa adaptação é não desenhar nada.
 */
export function registerMenuSections(): RegisterMenuSection[] {
  const maisUsados = ITEMS.filter((item) => CODIGOS_MAIS_USADOS.includes(item.kind));
  const outros = ITEMS.filter((item) => !CODIGOS_MAIS_USADOS.includes(item.kind));

  const sections: RegisterMenuSection[] = [{ title: SECAO_MAIS_USADOS, items: maisUsados }];
  if (outros.length > 0) sections.push({ title: SECAO_OUTROS, items: outros });
  return sections;
}

/**
 * Item do menu correspondente a um tipo, ou `null` se o tipo não estiver no menu.
 *
 * É por aqui que a ação «Repetir último» obtém a etiqueta: a mesma lista, a mesma ordem, o
 * mesmo vocabulário do contrato — em vez de uma segunda tabela que divergiria à primeira
 * renomeação de um tipo.
 */
export function registerMenuItem(kind: RecordKind): RegisterMenuItem | null {
  return ITEMS.find((item) => item.kind === kind) ?? null;
}

/**
 * Chave onde se guarda o último tipo **efetivamente gravado**.
 *
 * Local e não no servidor: é uma conveniência de interface («o que costumo registar»), não um
 * dado de negócio. Não vai para a API, não pede migration e não sobrevive à limpeza do
 * browser — o que é aceitável, porque a sua ausência só faz desaparecer um atalho.
 */
const CHAVE_ULTIMO_TIPO = 'zemlo.ultimoTipoDeRegisto';

/**
 * Último tipo gravado, ou `null` quando não há nenhum conhecido.
 *
 * O valor lido é **validado contra o contrato**: uma entrada corrompida, de uma versão antiga
 * ou escrita à mão não pode produzir um botão «Repetir último» que abre um tipo que já não
 * existe. Uma string desconhecida vale o mesmo que a ausência — não é um erro a mostrar, é um
 * atalho que não se oferece.
 */
export function readLastKind(): RecordKind | null {
  try {
    const raw = globalThis.localStorage?.getItem(CHAVE_ULTIMO_TIPO) ?? null;
    return raw !== null && RECORD_KINDS.some((item) => item.code === raw)
      ? (raw as RecordKind)
      : null;
  } catch {
    // `localStorage` pode estar bloqueado (modo privado, política de cookies). Sem
    // persistência o menu funciona: só não oferece a repetição.
    return null;
  }
}

/** Guarda o tipo acabado de gravar. Falha em silêncio — a gravação não depende disto. */
export function rememberLastKind(kind: RecordKind): void {
  try {
    globalThis.localStorage?.setItem(CHAVE_ULTIMO_TIPO, kind);
  } catch {
    /* sem persistência: o atalho vale para esta sessão */
  }
}
