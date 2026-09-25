import { describe, expect, it } from 'vitest';
import {
  filterByQuery,
  matchesQuery,
  normalizeForSearch,
  searchScopeNote,
} from '../src/lib/localSearch';

/*
 * `WEB-007` · comportamento da pesquisa local.
 *
 * ## Porque é que se testa a função, e não o campo
 *
 * Sem `jsdom` (a regra escrita em `page-states.test.tsx`) não há eventos: um teste que escrevesse
 * num `<input>` e observasse a lista a mudar **não** poderia correr. O que é observável é a
 * **função** que decide se um registo casa — e é ela que tem a regra. O componente
 * `<LocalSearch>` limita-se a ligar o campo a esta função; a regra fica aqui, e é aqui que a
 * prova de mutação morde.
 *
 * ## O caso «lista completa» vs «lista parcial»
 *
 * O critério da tarefa exige que os dois casos se distingam: uma pesquisa local sobre uma lista
 * carregada por inteiro encontra tudo o que existe; sobre uma lista parcial encontra apenas o que
 * está à vista. `searchScopeNote` codifica essa diferença no aviso visível, e os testes fixam que
 * a frase **muda** entre os dois — é a diferença entre dizer a verdade e prometer o que não faz.
 *
 * ## Prova por mutação (declarada e verificada em `WEB-007`)
 *
 *  - trocar `termos.every` por `termos.some` → o teste «conjunção de termos» fica vermelho;
 *  - remover o `.normalize('NFD')` → os testes de acentos ficam vermelhos;
 *  - devolver `items` sem filtrar quando há pesquisa → o teste de filtragem fica vermelho;
 *  - trocar o ramo `completo` de `searchScopeNote` → o teste de âmbito fica vermelho.
 */

describe('WEB-007 · normalizeForSearch', () => {
  it('remove acentos e baixa a caixa', () => {
    expect(normalizeForSearch('Apólice')).toBe('apolice');
    expect(normalizeForSearch('IUC 2026')).toBe('iuc 2026');
  });

  it('colapsa espaços e apara as pontas', () => {
    expect(normalizeForSearch('  revisão   dos   50 000 km ')).toBe('revisao dos 50 000 km');
  });
});

describe('WEB-007 · matchesQuery', () => {
  const doc = (name: string, notes: string | null) => ({ name, notes });

  it('pesquisa vazia casa com tudo — não é um filtro', () => {
    expect(matchesQuery(doc('Apólice', null), '', (d) => [d.name])).toBe(true);
    expect(matchesQuery(doc('Apólice', null), '   ', (d) => [d.name])).toBe(true);
  });

  it('encontra sem acentos: «apolice» acha «Apólice»', () => {
    expect(matchesQuery(doc('Apólice de seguro', null), 'apolice', (d) => [d.name])).toBe(true);
  });

  it('é uma conjunção: todos os termos têm de aparecer, ainda que em campos diferentes', () => {
    /*
     * Mutação: `termos.every` → `termos.some`. Com `some`, «seguro casa» casaria com o registo
     * «Seguro» mesmo sem «casa» — este `expect(false)` fica vermelho.
     */
    const alvo = doc('Seguro', 'fidelidade em casa');
    expect(matchesQuery(alvo, 'seguro casa', (d) => [d.name, d.notes])).toBe(true);
    expect(matchesQuery(alvo, 'seguro garagem', (d) => [d.name, d.notes])).toBe(false);
  });

  it('ignora campos nulos em vez de os transformar em «null»', () => {
    // Um registo sem notas não deve casar com a pesquisa «null» — só um bug de coerção o faria.
    expect(matchesQuery(doc('Inspeção', null), 'null', (d) => [d.name, d.notes])).toBe(false);
  });
});

describe('WEB-007 · filterByQuery', () => {
  const registos = [
    { id: '1', name: 'Apólice Fidelidade', category: 'Apólices' },
    { id: '2', name: 'Certificado IUC', category: 'Impostos' },
    { id: '3', name: 'Fatura da oficina', category: 'Faturas' },
  ];
  const campos = (r: { name: string; category: string }) => [r.name, r.category];

  it('sem pesquisa, devolve a lista inteira', () => {
    expect(filterByQuery(registos, '', campos)).toHaveLength(3);
  });

  it('filtra apenas os que casam', () => {
    const resultado = filterByQuery(registos, 'iuc', campos);
    expect(resultado.map((r) => r.id)).toEqual(['2']);
  });

  it('cruza campos: «impostos certificado» casa com o registo 2', () => {
    const resultado = filterByQuery(registos, 'impostos certificado', campos);
    expect(resultado.map((r) => r.id)).toEqual(['2']);
  });

  it('devolve a lista original **sem cópia** quando não há pesquisa', () => {
    // Um array novo a cada render obrigaria os consumidores a memoizar para nada.
    expect(filterByQuery(registos, '', campos)).toBe(registos);
  });
});

describe('WEB-007 · searchScopeNote distingue lista completa de parcial', () => {
  it('lista completa: a pesquisa vê todos os resultados carregados', () => {
    /*
     * Mutação: trocar o ramo `completo` de `searchScopeNote` por outra frase qualquer. A
     * asserção é ao **texto literal** — uma comparação com a própria expressão (ou a mera
     * ausência de «por carregar») deixaria passar uma frase que prometesse mais do que a lista
     * tem. É a mesma família do defeito que `WEB-012` apanhou: um teste que se compara consigo
     * próprio não fixa nada.
     */
    expect(searchScopeNote(12, 12)).toBe('A pesquisa atua sobre os 12 resultados carregados desta lista.');
  });

  it('lista parcial: diz quantos ficam de fora', () => {
    /*
     * Mutação: trocar o ramo `completo` de `searchScopeNote`. Com o ramo invertido, este teste
     * fica vermelho porque a frase deixa de nomear os que faltam.
     */
    const nota = searchScopeNote(50, 120);
    expect(nota).toContain('50 resultados carregados');
    expect(nota).toContain('70 por carregar');
  });

  it('singular: «1 resultado carregado» e não «1 resultados»', () => {
    expect(searchScopeNote(1, 1)).toContain('1 resultado carregado');
  });
});
