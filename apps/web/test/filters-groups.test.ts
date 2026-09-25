import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * `WEB-007` · guarda de convenção: **todos** os `z-filters` do `src` são um grupo nomeado.
 *
 * ## O defeito que isto morde
 *
 * As listas do produto tinham **8** contentores `z-filters`, e **2** deles
 * (`DocumentsPage.tsx:192`, `RemindersPage.tsx:141`, no estado pré-correção) não tinham
 * `role="group"`/`aria-label`. Uma fila de chips é um grupo de controlo que filtra a lista; sem
 * `role="group"` com nome, um leitor de ecrã anuncia cada botão solto e nunca diz de que escolha
 * fazem parte. A guarda de `WEB-006` (`accessibility.test.tsx:323`) **não** via estes dois: lê
 * `role="group"` e, como eles não tinham, não os encontrava — a uniformização é o que os põe no
 * campo de visão dela.
 *
 * ## Porque é uma verificação ESTÁTICA, e rotulada como tal
 *
 * Segue o padrão de `documents-form.test.ts`: lê o **código-fonte** em vez de renderizar. A razão
 * é a mesma — sem `jsdom` (a regra escrita em `page-states.test.tsx`), não se observa a árvore de
 * acessibilidade depois de uma interação. O que se pode afirmar é que **no código** nenhum
 * contentor `z-filters` fica sem o par `role="group"` + `aria-label`.
 *
 * ## O que isto NÃO prova
 *
 * Não prova que o leitor de ecrã anuncia o grupo como esperado — prova que a marcação o declara.
 * Um `role` calculado por expressão escaparia; a expressão é deliberadamente ancorada à etiqueta
 * literal, e o teste anti-vacuidade existe para que uma expressão que deixasse de casar não faça
 * a guarda passar para sempre (é a mesma família do defeito que `PC-15` descreve).
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function ficheirosTsx(diretorio: string): string[] {
  return readdirSync(diretorio).flatMap((entrada) => {
    const caminho = join(diretorio, entrada);
    if (statSync(caminho).isDirectory()) return ficheirosTsx(caminho);
    return entrada.endsWith('.tsx') ? [caminho] : [];
  });
}

/** Caminho relativo ao `src`, com separadores POSIX (o `slice` cru daria `\` no Windows). */
function relativo(ficheiro: string): string {
  return ficheiro.slice(SRC.length + 1).split('\\').join('/');
}

/** Etiquetas de abertura que **contêm** a classe `z-filters`, repartidas por linhas ou não. */
function etiquetasZFilters(): Array<{ ficheiro: string; etiqueta: string }> {
  // `[^>]*` impede a etiqueta de atravessar o fim do elemento; `s` não é preciso no `[^>]`.
  const etiqueta = /<[A-Za-z][^>]*\bclassName="[^"]*\bz-filters\b[^"]*"[^>]*>/g;
  const encontradas: Array<{ ficheiro: string; etiqueta: string }> = [];
  for (const ficheiro of ficheirosTsx(SRC)) {
    const conteudo = readFileSync(ficheiro, 'utf8');
    for (const [etiquetaEncontrada] of conteudo.matchAll(etiqueta)) {
      encontradas.push({ ficheiro: relativo(ficheiro), etiqueta: etiquetaEncontrada });
    }
  }
  return encontradas;
}

describe('WEB-007 · nenhum `z-filters` fica sem `role="group"` + `aria-label`', () => {
  it('todos os contentores de filtros do `src` são um grupo com nome', () => {
    const semGrupo: string[] = [];
    for (const { ficheiro, etiqueta } of etiquetasZFilters()) {
      if (!/\brole="group"/.test(etiqueta) || !/\baria-label=/.test(etiqueta)) {
        semGrupo.push(`${ficheiro}: ${etiqueta.split('\n')[0]}`);
      }
    }

    expect(semGrupo).toEqual([]);
  });

  it('a guarda encontra os 8 grupos que existem (não passa por vacuidade)', () => {
    /*
     * O limiar é o número **real** de `z-filters` no `src` (8, medido em 2026-09-24 e reconfirmado
     * antes desta correção). É deliberado, e não uma margem folgada: a expressão só casa dentro de
     * uma etiqueta, pelo que reformatar o `className` para uma expressão faria a guarda perder
     * cobertura em silêncio — com o limiar no valor exato, essa perda faz este teste ficar
     * vermelho. Consequência aceite: remover um filtro legítimo também fica vermelho, de propósito,
     * para obrigar quem mexer a reavaliar em vez de deixar a guarda encolher sozinha.
     */
    expect(etiquetasZFilters()).toHaveLength(8);
  });

  it('os dois grupos que estavam sem nome passam a estar nomeados (prova do defeito)', () => {
    // Ancorado aos ficheiros concretos que a tarefa nomeia. Sem `role="group"`, este teste seria
    // impossível de escrever: é a própria regressão que se fixa.
    const porFicheiro = new Map(etiquetasZFilters().map((item) => [item.ficheiro, item.etiqueta]));
    for (const ficheiro of ['pages/DocumentsPage.tsx', 'pages/records/RemindersPage.tsx']) {
      const etiqueta = porFicheiro.get(ficheiro);
      expect(etiqueta, ficheiro).toBeDefined();
      expect(etiqueta, ficheiro).toMatch(/\brole="group"/);
      expect(etiqueta, ficheiro).toMatch(/\baria-label="[^"]+"/);
    }
  });
});
