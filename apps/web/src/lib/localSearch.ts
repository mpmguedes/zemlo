/*
 * Pesquisa LOCAL no cliente (`WEB-007`).
 *
 * ## Porque é que isto é local, e não uma consulta ao servidor
 *
 * A decisão ficou **fechada pelo utilizador em 2026-09-24**: a pesquisa atua apenas sobre os
 * resultados já carregados no ecrã. Não existe — e não passa a existir — um parâmetro `q` no
 * contrato partilhado (`packages/shared/src/contracts.ts`), pelo que a API não sabe filtrar por
 * texto e o cliente não pode pedir-lhe que o faça.
 *
 * Isto tem uma consequência que a interface **tem** de dizer em voz alta, e que é o maior risco
 * desta tarefa: um campo de pesquisa num ecrã com lista parcial **parece** procurar em tudo, e
 * não procura. `<LocalSearch>` avisa do âmbito por isso mesmo (`scopeNote`).
 *
 * ## Porque é que a lógica vive num ficheiro só, sem React
 *
 * Sem `jsdom` (a regra escrita em `page-states.test.tsx`), a interação — escrever no campo e ver
 * a lista mudar — **não** é observável nos testes. O que **é** observável é a função de
 * filtragem, desde que ela esteja fora do componente. Daí esta separação: o componente
 * `<LocalSearch>` tem o campo e o aviso; `matchesQuery`/`filterByQuery` têm a regra, e é a regra
 * que os testes fixam com prova de mutação.
 */

/**
 * Normaliza texto para comparação: minúsculas, sem acentos, espaços colapsados.
 *
 * Os acentos importam num produto em português: quem escreve «apolice» tem de encontrar
 * «Apólice», e quem escreve «IUC» tem de encontrar «iuc». `normalize('NFD')` separa o acento da
 * letra e a classe `\p{Diacritic}` remove-o — sem uma tabela de substituições à mão, que
 * inevitavelmente esqueceria um caso.
 */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * `true` quando **todos** os termos da pesquisa aparecem em algum dos campos.
 *
 * A conjunção por termos (e não a comparação da frase inteira) é o que torna a pesquisa útil:
 * «seguro fidelidade» encontra um registo com «Seguro» num campo e «Fidelidade» noutro. Uma
 * consulta vazia ou só com espaços casa com tudo — é o estado «sem pesquisa», não um filtro que
 * esconde a lista.
 *
 * `fields` pode opcionalmente devolver `null`/`undefined` para campos que o registo não tem: são
 * ignorados, e não transformam o registo num falso positivo com a string «null».
 */
export function matchesQuery<T>(item: T, query: string, fields: (item: T) => Array<string | null | undefined>): boolean {
  const termos = normalizeForSearch(query).split(' ').filter(Boolean);
  if (termos.length === 0) return true;

  const texto = normalizeForSearch(fields(item).filter((valor): valor is string => typeof valor === 'string').join(' '));
  return termos.every((termo) => texto.includes(termo));
}

/**
 * Filtra uma lista pelo texto de pesquisa.
 *
 * Devolve a lista original **sem cópia** quando não há pesquisa: uma lista vazia de termos não é
 * um filtro, e criar um array novo a cada render obrigaria os consumidores a memoizar para nada.
 */
export function filterByQuery<T>(items: readonly T[], query: string, fields: (item: T) => Array<string | null | undefined>): T[] {
  if (normalizeForSearch(query) === '') return items as T[];
  return items.filter((item) => matchesQuery(item, query, fields));
}

/**
 * Texto do âmbito da pesquisa, para o aviso visível do ecrã.
 *
 * O âmbito **não** é o mesmo em todas as listas: uma lista carregada por inteiro encontra tudo o
 * que existe; uma lista paginada por cursor encontra apenas o que está à vista. Prometer o
 * primeiro quando o caso é o segundo é a mentira que a tarefa proíbe — daí a distinção viver
 * aqui, junto da lógica, e não escrita à mão em cada ecrã.
 */
export function searchScopeNote(visibleCount: number, totalCount: number): string {
  const completo = totalCount <= visibleCount;
  const visiveis = visibleCount === 1 ? '1 resultado carregado' : `${visibleCount} resultados carregados`;
  if (completo) return `A pesquisa atua sobre os ${visiveis} desta lista.`;
  return `A pesquisa atua apenas sobre os ${visiveis}; há mais ${totalCount - visibleCount} por carregar que não são procurados.`;
}
