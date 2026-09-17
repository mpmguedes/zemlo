/**
 * Normalizações que as chaves de deduplicação exigem (§8.5).
 *
 * A deduplicação falha **em silêncio** quando compara strings que deviam ser iguais.
 * É o pior tipo de falha nesta área: o relatório diz "nada a importar" e o utilizador
 * fica com dados a menos sem saber. Por isso as regras são explícitas, vivem num só
 * ficheiro e são testadas isoladamente.
 *
 * ## Onde isto se distingue do que já existe
 *
 * `@zemlo/shared` já tem `normalizePlate`, `normalizeVin` e `normalizeVendorName`.
 * Essas funções servem a **gravação** de dados: produzem a forma canónica que fica na
 * base de dados. As daqui servem a **comparação** de dados, e as duas não são a mesma
 * coisa:
 *
 *  - a matrícula é gravada em maiúsculas sem separadores (`4238EL`), mas comparada
 *    também ignorando a pontuação que o utilizador possa ter escrito;
 *  - um nome de fornecedor é gravado apenas com espaços colapsados (`Auto Silva, Lda`),
 *    porque é aquilo que o utilizador verá no ecrã; é comparado sem acentos, em
 *    minúsculas e sem a forma societária (`auto silva`), porque "Auto Silva, Lda" e
 *    "AUTO SILVA" são o mesmo fornecedor para efeitos de duplicação.
 *
 * Manter as duas famílias separadas é o que permite alterar uma regra de deduplicação
 * sem alterar os dados que o utilizador vê — e vice-versa.
 *
 * ## Relação com os testes de propriedade (§13.3)
 *
 * Todas estas funções são **idempotentes**: `f(f(x)) === f(x)`. É o que garante que
 * normalizar um registo já normalizado (por exemplo, na reimportação de um bundle que
 * o Zemlo exportou) não produz um valor diferente — e portanto que a regra 1 da §13.3
 * ("importar duas vezes = importar uma vez") se mantém.
 */

import { isValidVinFormat, normalizeVin as canonicalVin } from '@zemlo/shared';

/* -------------------------------------------------------------------------- */
/* Matrícula (§8.5)                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Normaliza uma matrícula para **comparação**: maiúsculas, sem espaços, hífenes nem
 * pontos.
 *
 * Reutiliza a normalização canónica de `@zemlo/shared` e acrescenta-lhe a remoção da
 * pontuação, que é a forma como a mesma matrícula chega escrita de outras aplicações
 * (`42-38-1EL`, `42.38.1EL`, `4238 EL`).
 *
 * Não valida o formato português e não deve fazê-lo: a §8.4 exige que a comparação
 * funcione para matrículas estrangeiras, e um veículo importado de outro país tem de
 * continuar a ser deduplicável.
 *
 * Devolve uma string vazia para entrada vazia — nunca `null`. Uma matrícula ausente
 * compara-se com outra matrícula ausente, mas quem chama decide se essa comparação faz
 * sentido (uma chave de matrícula vazia nunca deve coincidir com outra).
 */
export function normalizePlateForCompare(input: string | null | undefined): string {
  if (!input) return '';
  return canonicalVin(input).replace(/[^A-Z0-9]/g, '');
}

/** `true` quando existe matrícula suficiente para servir de chave de deduplicação. */
export function hasUsablePlate(input: string | null | undefined): boolean {
  return normalizePlateForCompare(input).length >= 4;
}

/* -------------------------------------------------------------------------- */
/* VIN (§8.5)                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Normaliza um VIN para comparação: maiúsculas, sem espaços nem separadores.
 *
 * A rejeição de `I`, `O` e `Q` (§8.5) **não** acontece aqui. Um VIN que contenha essas
 * letras é um VIN mal transcrito, e a §8.4 diz explicitamente que o VIN é a chave
 * **certa** por ser único por desenho — mas um valor mal transcrito não deve poder
 * coincidir com um valor correto e passar por duplicado exato.
 *
 * Por isso a normalização devolve o valor e a validação de forma é uma função à parte
 * (`hasUsableVin`), que quem calcula a chave consulta. Separar as duas permite que um
 * VIN inválido continue a ser exportado e mostrado ao utilizador, sem contaminar a
 * deduplicação.
 */
export function normalizeVinForCompare(input: string | null | undefined): string {
  if (!input) return '';
  return canonicalVin(input);
}

/**
 * `true` quando o VIN tem forma válida (17 caracteres, sem `I`/`O`/`Q`) e pode servir
 * de chave de deduplicação **certa**.
 *
 * Um VIN com forma inválida é ignorado para efeitos de chave — o registo continua a
 * poder ser deduplicado por outra chave — em vez de ser usado como uma coincidência
 * exata enganadora.
 */
export function hasUsableVin(input: string | null | undefined): boolean {
  if (!input) return false;
  return isValidVinFormat(canonicalVin(input));
}

/* -------------------------------------------------------------------------- */
/* Texto livre (§8.5)                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Formas societárias removidas na comparação.
 *
 * `Lda`, `S.A.` e `Unipessoal` constam da §8.5. As restantes são a mesma família em
 * português e aparecem nas descrições reais: omiti-las deixaria "Oficina Silva, Lda" a
 * não coincidir com "Oficina Silva, Unipessoal Lda" — que é precisamente o duplicado
 * que a normalização existe para apanhar.
 *
 * A lista é aplicada **depois** da remoção de acentos e em minúsculas, pelo que basta
 * enumerar a forma normalizada. Ordenar da mais longa para a mais curta importa: sem
 * isso, `sa` seria removido primeiro e `s.a.` deixaria de coincidir.
 */
const COMPANY_SUFFIXES = [
  'sociedade unipessoal lda',
  'sociedade unipessoal limitada',
  'unipessoal lda',
  'unipessoal limitada',
  'unipessoal',
  'limitada',
  'lda',
  's.a.',
  'sa',
] as const;

/**
 * Normaliza texto livre (fornecedor, posto, oficina, descrição) para comparação.
 *
 * Regras da §8.5, por ordem: minúsculas → remover acentos → remover forma societária →
 * remover pontuação → colapsar espaços.
 *
 * A ordem não é arbitrária. Remover a forma societária **antes** da pontuação é o que
 * faz `S.A.` coincidir com `SA`: depois de colapsar os pontos, `s.a.` deixaria de
 * coincidir com a forma normalizada. E colapsar espaços no fim garante que remover um
 * sufixo no meio da string não deixa espaços duplos.
 *
 * Remove pontuação em vez de a manter porque a mesma entidade escreve-se `Auto-Silva`,
 * `Auto Silva` e `AutoSilva` conforme a aplicação de origem.
 */
export function normalizeTextForCompare(input: string | null | undefined): string {
  if (!input) return '';

  let value = input
    .toLowerCase()
    .normalize('NFD')
    // Remove diacríticos. `\u0300-\u036f` cobre o bloco Combining Diacritical Marks,
    // que é o que a decomposição NFD produz para acentos portugueses (á, ã, ç, é…).
    .replace(/[\u0300-\u036f]/g, '');

  for (const suffix of COMPANY_SUFFIXES) {
    // Fronteira à esquerda e fim ou separador à direita: impede que `sa` seja removido
    // de dentro de `casa` ou `oficina`, que são palavras legítimas.
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(suffix)}(?=$|[^a-z0-9])`, 'g');
    value = value.replace(pattern, ' ');
  }

  return value
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * `true` quando há texto suficiente para comparar.
 *
 * Uma descrição vazia não deve coincidir com outra descrição vazia e elevar um duplicado
 * provável a certo. Sem este guarda, duas despesas do mesmo dia e do mesmo valor sem
 * descrição nenhuma passariam a "certas" por coincidirem em três campos vazios.
 */
export function hasUsableText(input: string | null | undefined): boolean {
  return normalizeTextForCompare(input).length > 0;
}

/* -------------------------------------------------------------------------- */
/* Valores numéricos (§8.5, §8.6)                                              */
/* -------------------------------------------------------------------------- */

/**
 * Normaliza um valor monetário para comparação: inteiro em cêntimos (§8.5).
 *
 * Aceita cêntimos já inteiros e valores decimais que tenham escapado à conversão.
 * O arredondamento é ao cêntimo, que é a unidade de conta do Zemlo.
 */
export function normalizeCentsForCompare(input: number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (!Number.isFinite(input)) return null;
  return Math.round(input);
}

/**
 * Normaliza uma leitura de odómetro para comparação: inteiro (§8.5).
 *
 * Não aplica tolerância: a tolerância de ±50 km da §8.6 pertence à **comparação**, não
 * à normalização. Misturar as duas tornaria impossível dizer se dois valores são iguais
 * ou apenas próximos — e é essa distinção que separa "certo" de "provável".
 */
export function normalizeOdometerForCompare(input: number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (!Number.isFinite(input)) return null;
  return Math.round(input);
}

/**
 * Normaliza litros para comparação.
 *
 * Arredonda a 3 casas decimais. A tolerância de ±0,05 L da §8.6 é muito maior do que
 * este arredondamento, pelo que arredondar aqui não esconde nenhuma diferença
 * significativa — apenas remove o ruído de representação de vírgula flutuante que
 * faria `42.35` não coincidir com `42.350000000000001`.
 */
export function normalizeLitresForCompare(input: number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (!Number.isFinite(input)) return null;
  return Math.round(input * 1000) / 1000;
}

/** Normaliza energia (kWh) para comparação, com a mesma lógica de `normalizeLitresForCompare`. */
export function normalizeKwhForCompare(input: number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (!Number.isFinite(input)) return null;
  return Math.round(input * 1000) / 1000;
}

/* -------------------------------------------------------------------------- */
/* Datas civis (§8.5, §8.6)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Normaliza uma data civil para a forma canónica `AAAA-MM-DD`.
 *
 * Aceita o que as aplicações de origem costumam produzir:
 *
 *  - `2026-02-10` (canónico) e `2026-2-10` (sem zero à esquerda);
 *  - `2026-02-10T18:33:58.892Z` — um instante completo é reduzido à data **em UTC**;
 *  - `10/02/2026` e `10-02-2026` — forma portuguesa, dia primeiro.
 *
 * A forma portuguesa assume dia primeiro porque o Zemlo é um produto português e a
 * alternativa americanizada interpretaria `10/02/2026` como 2 de outubro, deslocando
 * cada despesa em oito meses. A §8.5 admite que datas ambíguas sejam resolvidas pela
 * convenção declarada; esta é a convenção por omissão, e quem tem informação melhor
 * (uma data já canónica vinda do bundle) nunca chega a este caminho.
 *
 * Devolve `null` para o que não consegue interpretar — nunca uma data adivinhada. Uma
 * data errada por um dia é um dado errado, não um duplicado (§8.6).
 */
export function normalizeCivilDateForCompare(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = input.trim();

  // `AAAA-MM-DD` e `AAAA-M-D`
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (iso) {
    return buildCivilDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  // Instante completo — reduz à data em UTC, que é como o bundle representa instantes.
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
  }

  // Forma portuguesa: `DD/MM/AAAA`, `DD-MM-AAAA` ou `DD.MM.AAAA`
  const pt = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(value);
  if (pt) {
    return buildCivilDate(Number(pt[3]), Number(pt[2]), Number(pt[1]));
  }

  return null;
}

/**
 * Constrói uma data civil validando que existe no calendário.
 *
 * `2026-02-30` passa uma expressão regular e não existe. Sem esta verificação, a data
 * inválida seguiria para a chave de deduplicação e criaria um registo que o próprio
 * Zemlo recusaria gravar — o erro apareceria longe da causa.
 */
function buildCivilDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year) return null;
  if (candidate.getUTCMonth() !== month - 1) return null;
  if (candidate.getUTCDate() !== day) return null;
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
}

/* -------------------------------------------------------------------------- */
/* Auxiliares                                                                  */
/* -------------------------------------------------------------------------- */

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function pad4(value: number): string {
  return String(value).padStart(4, '0');
}

/** Escapa uma string para uso literal numa expressão regular. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Comparação de igualdade entre dois valores opcionais normalizados.
 *
 * A regra que evita o erro mais comum das chaves compostas: **dois `null` não são
 * iguais**. Tratar `null === null` como coincidência faria com que dois registos sem
 * data, ou sem valor, coincidissem num campo que nenhum dos dois preenche — e
 * elevasse um duplicado improvável a certo.
 */
export function equalOptional<T>(a: T | null | undefined, b: T | null | undefined): boolean {
  if (a === null || a === undefined) return false;
  if (b === null || b === undefined) return false;
  return a === b;
}
