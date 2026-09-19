/**
 * Forma de um ficheiro CSV — a identidade que faz um mapa de colunas ser reutilizável.
 *
 * ## O problema que este módulo resolve
 *
 * A §10.2 (passo 9) e a §11.3 ("Não pedir duas vezes") pedem que o mapa de colunas fique
 * guardado **por utilizador e por forma de ficheiro**. A pergunta que a especificação
 * deixa em aberto é o que é a "forma".
 *
 * Um nome de ficheiro não serve. `export.csv`, `export (1).csv` e `Movimentos 2026.csv`
 * são o mesmo formato de três programas diferentes, e o utilizador renomeia ficheiros
 * constantemente. Ligar o mapa ao nome faria com que ele "se perdesse" por uma razão que
 * não tem nada a ver com o formato.
 *
 * O conteúdo também não serve: o mesmo ficheiro exportado amanhã tem outras linhas, e um
 * mapa ligado ao conteúdo seria um mapa de uma utilização só — exatamente o contrário do
 * que a §11.3 pede.
 *
 * **A forma é o conjunto de colunas.** É o que o mapa interpreta, e é o que muda quando o
 * fornecedor muda o formato. É isso que a assinatura capta.
 *
 * ## O que faz a assinatura mudar — e o que não faz
 *
 * | Alteração | Muda a forma? | Porquê |
 * |---|---|---|
 * | Renomear o ficheiro | Não | O nome não é a forma. |
 * | Acrescentar linhas | Não | O número de linhas não é estrutura. |
 * | Reordenar linhas | Não | A ordem é normalizada. |
 * | Mudar o separador (`;` → `,`) | Não | O separador é detetado de novo; as colunas são as mesmas. |
 * | Mudar maiúsculas/acentos num cabeçalho | **Não** | `Matrícula` e `MATRICULA` são o mesmo campo para o dicionário; tratar como formatos diferentes obrigaria a reconfirmar sem motivo. |
 * | Acrescentar uma coluna | **Sim** | O mapa não sabe o que é a coluna nova — tem de voltar a perguntar (§10.2). |
 * | Remover uma coluna | **Sim** | Um campo obrigatório pode ter desaparecido. |
 * | Reordenar colunas | **Não** | Os índices são reescritos pela ordem atual; o significado mantém-se. |
 * | Mudar o nome de uma coluna | **Sim** | É a única evidência que o sistema tem do significado. |
 *
 * As duas decisões que valem a pena justificar:
 *
 *  - **normalizar os nomes** (maiúsculas, acentos, pontuação) evita o pior resultado
 *    possível: uma reconfirmação pedida por causa de `Quilometragem` vs `QUILOMETRAGEM`.
 *    O utilizador decide que a funcionalidade está avariada e deixa de confiar nela;
 *  - **ordenar** os nomes significa que o fornecedor que reordena as colunas (algo que
 *    acontece com frequência em exportações de Excel) não provoca uma reconfirmação. As
 *    decisões são reaplicadas **por nome**, não por índice — é isso que torna a ordenação
 *    irrelevante, e é verificado em `applySavedMap`.
 *
 * ## Porque é que a assinatura é calculada sobre nomes e não sobre índices
 *
 * Porque os índices são o que muda quando a ordem muda. A assinatura tem de ser estável
 * exatamente nas dimensões em que o significado é estável.
 */

import { normalizeColumnName } from '@zemlo/shared';

/**
 * Assinatura normalizada de um conjunto de cabeçalhos.
 *
 * Devolve uma string determinística: os nomes normalizados, ordenados, ligados por `|`.
 *
 * O separador é `|` e não um espaço nem uma vírgula porque os nomes normalizados podem
 * conter ambos: `normalizeColumnName` preserva `km`, `l`, `kwh` e remove a pontuação
 * restante, mas dois nomes distintos não podem produzir a mesma assinatura por colisão do
 * separador. `|` nunca aparece num nome normalizado (a pontuação é retirada), pelo que a
 * ligação é injetiva sobre a lista de nomes.
 *
 * A ordenação é lexicográfica simples (`Array.prototype.sort` sobre strings). Não é
 * sensível ao `locale` de propósito: a assinatura tem de ser idêntica em qualquer máquina,
 * e uma comparação dependente do locale faria a mesma importação produzir chaves diferentes
 * num servidor com outro locale — um mapa guardado nunca seria encontrado, e nada o diria.
 *
 * **Lista vazia** devolve a string vazia. É um estado legítimo (um ficheiro sem cabeçalho
 * reconhecível) e não deve rebentar; quem chama verifica-o antes de guardar um mapa.
 */
export function shapeSignature(headers: readonly string[]): string {
  return headers
    .map((header) => normalizeColumnName(header))
    .filter((name) => name !== '')
    .sort()
    .join('|');
}

/**
 * Chave de forma completa: a assinatura, com a contagem de colunas à frente.
 *
 * A contagem parece redundante — a assinatura já a contém implicitamente — mas não é.
 * Sem ela, dois ficheiros diferentes podiam colidir: `A;B` e `A|B` normalizam para
 * assinaturas distintas, mas `["A B"]` e `["A", "B"]` normalizam ambas para `a b` (espaço
 * é o que `normalizeColumnName` usa entre palavras). Uma coluna chamada `A B` e duas
 * colunas chamadas `A` e `B` são formatos diferentes, e a contagem distingue-os.
 *
 * Fica no início porque é o discriminante mais rápido de comparar e o mais provável de
 * diferir.
 */
export function shapeKey(headers: readonly string[]): string {
  const signature = shapeSignature(headers);
  const count = signature === '' ? 0 : signature.split('|').length;
  return `${count}:${signature}`;
}

/**
 * `true` quando a assinatura é utilizável como chave de um mapa guardado.
 *
 * Uma assinatura vazia significa que nenhum cabeçalho produziu um nome normalizado — um
 * ficheiro sem cabeçalho, ou cujos cabeçalhos são todos pontuação. Guardar um mapa com
 * essa chave seria guardar um mapa que se aplicaria a **qualquer** ficheiro sem cabeçalho
 * legível, incluindo ficheiros de formatos completamente diferentes.
 *
 * A §10.2 não prevê este caso porque assume um cabeçalho; a verificação existe para que a
 * ausência de cabeçalho não se transforme numa sugestão errada.
 */
export function isUsableShapeKey(key: string): boolean {
  return key !== '' && !key.startsWith('0:');
}
