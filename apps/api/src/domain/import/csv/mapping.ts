/**
 * Deteção e mapeamento de colunas (§10.2, §10.3).
 *
 * Recebe uma `RawCsvTable` (produzida pelo parser) e devolve um **mapa de colunas**
 * proposto: para cada coluna do ficheiro, que campo canónico lhe corresponde, com que
 * confiança, e — quando aplicável — porque é que a decisão **não** pode ser tomada
 * sozinha.
 *
 * Este módulo é puro: não toca em disco, rede, base de dados nem relógio. Não conhece a
 * UI nem o serviço de importação; limita-se a raciocinar sobre a tabela.
 *
 * ## O princípio que governa este ficheiro
 *
 * A §10.4 é explícita: *admitir a incerteza é parte do desenho*. Um mapeador que escolhe
 * sempre produz uma importação silenciosamente errada — a coluna `Km/l` vai para
 * `odometerKm`, os valores passam a quilómetros que nunca existiram, e ninguém sabe. Por
 * isso este módulo tem **quatro** resultados possíveis por coluna, não dois:
 *
 *  - `confirmado` — evidência forte e sem concorrência; o utilizador vê e pode corrigir,
 *    mas não precisa de decidir nada;
 *  - `sugerido`  — há uma melhor correspondência, mas a evidência é média; o utilizador
 *    confirma;
 *  - `ambiguo`   — duas ou mais interpretações plausíveis; **exige** decisão;
 *  - `nao_mapeado` — nenhuma correspondência; a coluna é ignorada, declaradamente.
 *
 * A diferença entre `sugerido` e `ambiguo` é a diferença entre "aceita isto?" e "escolhe
 * entre isto e aquilo". Confundir as duas é o que produz importações erradas.
 */

import {
  COLUMN_SYNONYMS,
  CANONICAL_FIELDS,
  lookupColumnSynonyms,
  normalizeColumnName,
  type SynonymMatch,
} from '@zemlo/shared';
import type { RecordKind } from '../validate.js';
import type { RawCsvTable } from './parse.js';

/* -------------------------------------------------------------------------- */
/* Vocabulário                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Estado de uma coluna no mapa proposto.
 *
 * Os quatro estados são o contrato do resultado: a UI decide o que mostrar a partir
 * deles, e o teste de integração verifica que nunca há um quinto estado implícito.
 */
export const COLUMN_STATES = ['confirmado', 'sugerido', 'ambiguo', 'nao_mapeado'] as const;
export type ColumnState = (typeof COLUMN_STATES)[number];

/** Uma interpretação possível para uma coluna. */
export interface FieldCandidate {
  readonly field: string;
  /** Confiança 0..1 herdada do dicionário. */
  readonly confidence: number;
  /** Força da evidência: exact | strong | weak. */
  readonly match: SynonymMatch['match'];
  /** True quando o campo existe no vocabulário do tipo de registo inferido. */
  readonly compatibleWithKind: boolean;
}

/** Mapa de uma coluna do ficheiro. */
export interface ColumnMapping {
  /** Índice da coluna na tabela (0-based). */
  readonly index: number;
  /** Nome original, como está no ficheiro. */
  readonly header: string;
  /** Nome normalizado usado na comparação. */
  readonly normalized: string;
  /** Estado da decisão. */
  readonly state: ColumnState;
  /** Campo escolhido, quando há um. `null` em `ambiguo` e `nao_mapeado`. */
  readonly field: string | null;
  /** Confiança da escolha (0 quando não há escolha). */
  readonly confidence: number;
  /** Todas as interpretações possíveis, ordenadas por confiança. */
  readonly candidates: readonly FieldCandidate[];
  /** Confiança que falta para poder decidir sozinho, quando `ambiguo`. */
  readonly reason: string | null;
  /** Valores de amostra da coluna, para a UI mostrar contexto. */
  readonly sample: readonly string[];
}

/** Resultado do mapeamento de uma tabela. */
export interface ColumnMappingResult {
  readonly columns: readonly ColumnMapping[];
  /** Colunas que exigem decisão do utilizador. */
  readonly ambiguousColumns: readonly ColumnMapping[];
  /** Colunas ignoradas, declaradamente. */
  readonly unmappedColumns: readonly ColumnMapping[];
  /** Proporção de colunas resolvidas sem intervenção (0..1). */
  readonly coverage: number;
  /** True quando o mapa pode avançar sem perguntar nada. */
  readonly readyWithoutInput: boolean;
}

export interface MapColumnsOptions {
  /**
   * Tipo de registo inferido (§10.5), quando conhecido.
   *
   * Serve para **desempatar** e para marcar compatibilidade: um campo que existe no
   * `CanonicalRecord` mas não no tipo inferido continua a ser um candidato — só que
   * sinalizado, para que o mapeador não ofereça "Litros" a um registo de despesa sem o
   * dizer.
   */
  readonly kind?: RecordKind;
  /** Número de valores de amostra por coluna. */
  readonly sampleSize?: number;
}

/** Quantos valores de amostra a UI recebe por omissão. */
const DEFAULT_SAMPLE_SIZE = 3;

/**
 * Confiança mínima para uma escolha automática sem sinalizar.
 *
 * Abaixo deste valor a coluna passa a `sugerido` (o utilizador confirma) em vez de
 * `confirmado`. É o único número que governa a fronteira, e está aqui isolado para ser
 * testável em vez de estar espalhado por comparações.
 */
const AUTO_CONFIRM_THRESHOLD = 0.9;

/**
 * Diferença mínima de confiança entre o melhor e o segundo candidato para decidir
 * sozinho. Abaixo dela, a coluna é `ambiguo` mesmo que o melhor candidato seja forte:
 * dois candidatos próximos significam que o dicionário não sabe, e quem sabe é o
 * utilizador.
 */
const AMBIGUITY_MARGIN = 0.15;

/* -------------------------------------------------------------------------- */
/* Mapeamento                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Propõe um mapa de colunas para a tabela.
 *
 * Não decide ambiguidades: identificá-las e devolvê-las é o resultado, não uma falha.
 */
export function mapColumns(table: RawCsvTable, options: MapColumnsOptions = {}): ColumnMappingResult {
  const sampleSize = options.sampleSize ?? DEFAULT_SAMPLE_SIZE;
  const kind = options.kind;

  const columns = table.headers.map((header, index) =>
    mapOneColumn(header, index, table, kind, sampleSize),
  );

  const ambiguousColumns = columns.filter((c) => c.state === 'ambiguo');
  const unmappedColumns = columns.filter((c) => c.state === 'nao_mapeado');
  const resolved = columns.filter((c) => c.state === 'confirmado').length;

  return {
    columns,
    ambiguousColumns,
    unmappedColumns,
    coverage: columns.length === 0 ? 0 : resolved / columns.length,
    readyWithoutInput: ambiguousColumns.length === 0,
  };
}

/** Mapeia uma coluna individual. */
function mapOneColumn(
  header: string,
  index: number,
  table: RawCsvTable,
  kind: RecordKind | undefined,
  sampleSize: number,
): ColumnMapping {
  const normalized = normalizeHeader(header);
  const matches = normalized === '' ? [] : lookupColumnSynonyms(header);

  const allowed = kind ? new Set(CANONICAL_FIELDS[kind] ?? []) : null;

  const candidates: FieldCandidate[] = matches.map((match: SynonymMatch) => ({
    field: match.field,
    confidence: match.confidence,
    match: match.match,
    compatibleWithKind: allowed === null ? true : allowed.has(match.field),
  }));

  // Ordena com o tipo inferido como desempate: um candidato compatível com o tipo
  // passa à frente de um igualmente confiante que não é. É o que faz "Categoria"
  // resolver para `category` num registo de despesa em vez de competir com `type`.
  candidates.sort((a, b) => {
    if (a.compatibleWithKind !== b.compatibleWithKind) return a.compatibleWithKind ? -1 : 1;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.field.localeCompare(b.field);
  });

  const sample = sampleValues(table, index, sampleSize);

  if (candidates.length === 0) {
    return {
      index,
      header,
      normalized,
      state: 'nao_mapeado',
      field: null,
      confidence: 0,
      candidates: [],
      reason:
        normalized === ''
          ? 'A coluna não tem nome.'
          : 'Nenhum sinónimo conhecido corresponde a esta coluna.',
      sample,
    };
  }

  /*
   * Existem outros campos distintos com confiança próxima do melhor? Se sim, não há
   * decisão automática possível. Compara-se por **campo**, não por entrada: o mesmo
   * campo declarado duas vezes (exact + strong) não é uma ambiguidade — é o mesmo
   * destino por dois caminhos.
   *
   * ## Porque é que um candidato incompatível com o tipo não compete
   *
   * Quando o tipo de registo **já está decidido**, um campo fora do vocabulário desse tipo
   * não é uma alternativa: é um destino impossível. `isAllowedField` recusaria a decisão do
   * utilizador se ele o escolhesse, e o `apply` escreveria num campo que a tabela não tem.
   *
   * Sem este filtro, um ficheiro de quilometragens com uma coluna `Data` ficava preso: o
   * dicionário conhece `Data → date` com confiança 0.95, e `date` **não** existe no
   * vocabulário do odómetro — mas a comparação por confiança fazia-o competir com
   * `recordedAt` (0.4) e a coluna ficava `ambiguo`. O campo `recordedAt` é obrigatório, pelo
   * que o registo ia para quarentena e o utilizador não tinha forma de o desbloquear a
   * partir do ecrã: o mapeador nunca lhe ofereceria a escolha certa, porque a coluna estava
   * marcada como ambígua contra um candidato que era impossível.
   *
   * A comparação passa a ser entre candidatos **alcançáveis**. Sem tipo decidido,
   * `compatibleWithKind` é `true` para todos (não há tipo contra o que comparar), e o
   * comportamento mantém-se o de antes — que é o que se quer: a ambiguidade genuína, quando
   * não há contexto, tem de continuar a ser declarada.
   */
  const reachable = candidates.filter((candidate) => candidate.compatibleWithKind);
  const contender = reachable.length > 0 ? reachable : candidates;
  const strongest = contender[0] as FieldCandidate;

  const competingFields = contender.filter(
    (candidate) =>
      candidate.field !== strongest.field &&
      strongest.confidence - candidate.confidence < AMBIGUITY_MARGIN,
  );

  if (competingFields.length > 0) {
    const others = [...new Set(competingFields.map((c) => c.field))];
    return {
      index,
      header,
      normalized,
      state: 'ambiguo',
      field: null,
      confidence: 0,
      candidates,
      reason: `Pode ser ${[strongest.field, ...others].join(' ou ')} — a diferença de confiança é demasiado pequena para decidir.`,
      sample,
    };
  }

  /*
   * O melhor candidato é fraco? Uma correspondência `weak` nunca é aplicada sozinha,
   * mesmo sem concorrência: o dicionário declara-a como "genérica que pode colidir", e
   * aplicá-la em silêncio seria contrariar essa declaração.
   *
   * ## A exceção: quando o tipo elimina todos os concorrentes
   *
   * A regra existe para não **escolher entre** alternativas com base numa correspondência
   * genérica. Quando o vocabulário do tipo já eliminou todas as alternativas, não há
   * escolha a fazer — há uma única leitura possível, e recusá-la deixa o utilizador preso.
   *
   * É o caso de `Data` num ficheiro de quilometragens: `date` (0.95) está fora do
   * vocabulário do odómetro e `recordedAt` (0.4) é o único campo alcançável. Sem esta
   * exceção a coluna ficava ambígua, `recordedAt` é obrigatório, o registo ia para
   * quarentena e o ecrã de mapeamento não oferecia nenhuma escolha que desbloqueasse — a
   * §11.3 proíbe exatamente esse beco sem saída.
   *
   * A condição é estrita: **um só campo distinto** entre os alcançáveis. Dois campos fracos
   * continuam a ser uma ambiguidade declarada, que é o que a §10.4 exige.
   */
  const distinctReachable = new Set(contender.map((candidate) => candidate.field));

  if (strongest.match === 'weak' && distinctReachable.size > 1) {
    return {
      index,
      header,
      normalized,
      state: 'ambiguo',
      field: null,
      confidence: 0,
      candidates,
      reason: `"${header}" é um nome genérico; confirma que corresponde a ${strongest.field}.`,
      sample,
    };
  }

  /*
   * Um candidato fraco mas único fica `sugerido` e **nunca** `confirmado`, seja qual for a
   * confiança. A distinção não é cosmética: `sugerido` exige que o utilizador veja e aceite
   * antes de importar, e é isso que impede uma correspondência genérica de decidir sozinha.
   */
  const confident = strongest.match !== 'weak' && strongest.confidence >= AUTO_CONFIRM_THRESHOLD;

  return {
    index,
    header,
    normalized,
    state: confident ? 'confirmado' : 'sugerido',
    field: strongest.field,
    confidence: strongest.confidence,
    candidates,
    reason: confident
      ? null
      : `Correspondência provável com ${strongest.field}; confirma antes de importar.`,
    sample,
  };
}

/** Valores não vazios de amostra de uma coluna. */
function sampleValues(table: RawCsvTable, index: number, size: number): readonly string[] {
  const values: string[] = [];
  for (const row of table.rows) {
    const value = row.values[index];
    if (value === undefined) continue;
    const trimmed = value.trim();
    if (trimmed === '') continue;
    values.push(trimmed);
    if (values.length >= size) break;
  }
  return values;
}

/**
 * Normaliza o cabeçalho para apresentação e diagnóstico.
 *
 * Deliberadamente **não** reimplementa a normalização: delega em
 * `normalizeColumnName`, que é a mesma função que o dicionário usa para construir o
 * índice. Duas normalizações diferentes seriam a forma mais fácil de o mapeamento
 * encontrar sinónimos que a consulta não encontra.
 */
function normalizeHeader(header: string): string {
  return header === '' ? '' : normalizeColumnName(header);
}

/* -------------------------------------------------------------------------- */
/* Resolução de ambiguidades                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Uma decisão do utilizador sobre uma coluna ambígua.
 *
 * `field: null` significa "ignorar esta coluna" — que é uma resposta legítima e não um
 * cancelamento (§10.4: "se a resposta for 'nenhuma', ignora-se").
 */
export interface ColumnDecision {
  readonly index: number;
  readonly field: string | null;
}

/** Uma decisão inválida, com a razão, para o relatório. */
export interface InvalidDecision {
  readonly index: number;
  readonly reason: string;
}

export interface ResolveResult {
  /** Mapa final, com as decisões aplicadas. */
  readonly columns: readonly ColumnMapping[];
  /** Decisões rejeitadas por serem incoerentes com o mapa proposto. */
  readonly invalid: readonly InvalidDecision[];
  /** True quando ainda faltam decisões para as colunas ambíguas. */
  readonly pending: readonly ColumnMapping[];
}

/**
 * Aplica decisões do utilizador ao mapa proposto.
 *
 * Valida cada decisão em vez de a aceitar cegamente: um `index` que não existe, ou um
 * `field` que não era candidato daquela coluna, é registado como inválido. Isto importa
 * porque o mapa vem da UI e da base de dados, e um mapa corrompido não pode produzir uma
 * importação errada em silêncio.
 *
 * **Não** aceita decisões para colunas já confirmadas ou sugeridas sem as validar: uma
 * correção legítima é aceite (o utilizador tem sempre a última palavra), mas continua a
 * ter de apontar para um campo canónico.
 */
export function resolveMapping(
  result: ColumnMappingResult,
  decisions: readonly ColumnDecision[],
  kind?: RecordKind,
): ResolveResult {
  const byIndex = new Map<number, ColumnMapping>(result.columns.map((c) => [c.index, c]));
  const invalid: InvalidDecision[] = [];
  const applied = new Map<number, ColumnMapping>();

  for (const decision of decisions) {
    const column = byIndex.get(decision.index);

    if (!column) {
      invalid.push({ index: decision.index, reason: 'A coluna não existe na tabela.' });
      continue;
    }

    if (decision.field === null) {
      applied.set(decision.index, {
        ...column,
        state: 'nao_mapeado',
        field: null,
        confidence: 0,
        reason: 'Coluna ignorada por decisão do utilizador.',
      });
      continue;
    }

    if (!isAllowedField(decision.field, column, kind)) {
      invalid.push({
        index: decision.index,
        reason: `"${decision.field}" não é uma interpretação possível para a coluna "${column.header}".`,
      });
      continue;
    }

    applied.set(decision.index, {
      ...column,
      state: 'confirmado',
      field: decision.field,
      confidence: 1,
      reason: 'Campo escolhido pelo utilizador.',
    });
  }

  const columns = result.columns.map((column) => applied.get(column.index) ?? column);
  const pending = columns.filter((c) => c.state === 'ambiguo');

  return { columns, invalid, pending };
}

/**
 * Valida se um campo é aceitável para uma coluna.
 *
 * Duas vias, ambas deliberadas:
 *
 *  1. O campo é um **candidato declarado** daquela coluna — a via normal, e a única
 *     disponível quando não há tipo de registo inferido. É o que impede que a UI envie
 *     "litres" para uma coluna chamada "Matrícula": o dicionário nunca os relacionou.
 *
 *  2. O campo é **canónico do tipo de registo inferido** — uma via de escapatória
 *     explícita. Existe porque o utilizador pode reconhecer legitimamente um campo que o
 *     dicionário não conhece naquela forma ("Lugares" → `notes` num ficheiro de veículos),
 *     e recusá-lo obrigaria a acrescentar um sinónimo global por causa de um ficheiro só.
 *
 * Sem tipo inferido, a via 2 **não se aplica**: aceitar qualquer campo canónico nesse caso
 * seria aceitar tudo, o que tornaria a validação decorativa.
 */
function isAllowedField(field: string, column: ColumnMapping, kind?: RecordKind): boolean {
  if (column.candidates.some((candidate) => candidate.field === field)) return true;

  if (!kind) return false;

  return (CANONICAL_FIELDS[kind] ?? []).includes(field);
}

/**
 * Converte um mapa resolvido num mapa simples `índice → campo`, pronto para a fase de
 * construção de registos.
 *
 * Só inclui colunas com decisão firme (`confirmado` ou `sugerido` com campo atribuído);
 * colunas ambíguas ou ignoradas ficam de fora. Que uma coluna ambígua fique de fora é
 * intencional: as fases seguintes não podem ser tentadas a usá-la.
 */
/**
 * Reaplica um mapa guardado (§10.2 passo 9) a uma tabela, **por nome de coluna**.
 *
 * ## Porque é que isto não pode ser feito por índice
 *
 * O mapa guardado traz índices — os do ficheiro que o confirmou. Reaplicá-los diretamente
 * a um ficheiro novo assume que as colunas estão na mesma ordem, e essa suposição é falsa
 * com frequência suficiente para ser perigosa: um fornecedor que reordena as colunas na
 * exportação de um mês para o outro faria os índices apontarem para colunas diferentes, e
 * o resultado não seria um erro — seria uma importação **errada em silêncio**. O valor da
 * coluna `Data` entraria em `Valor`, o `Validator` aceitaria o que conseguisse, e o
 * utilizador veria os seus dados trocados depois de tudo passar sem aviso.
 *
 * A travessia é feita pelo **nome normalizado do cabeçalho**, que é a única evidência
 * estável do significado. Um índice do mapa é traduzido para o índice atual da coluna com
 * o mesmo nome.
 *
 * ## A assinatura já garantiu que o conjunto é o mesmo
 *
 * Se a chave de forma coincide, o conjunto de cabeçalhos normalizados é igual — mas
 * **multiplicidades** não são verificadas por uma assinatura construída sobre nomes
 * ordenados sem repetição explícita. Dois cabeçalhos que normalizem para o mesmo nome
 * (`Preço` e `PRECO`) produzem ambos a entrada `preco`, e o mapa guardado só tem uma. A
 * tradução abaixo consome cada nome **uma única vez**, pela ordem de leitura, e a colisão
 * é sinalizada em vez de resolvida — é a mesma regra do resto do módulo (§10.4): não
 * escolher em silêncio.
 *
 * ## O que acontece a uma coluna do ficheiro que o mapa não cobre
 *
 * Nada. Não é mapeada, e a coluna fica com o estado que o mapeamento automático lhe der.
 * Uma coluna nova acrescentada pelo fornecedor não está no mapa guardado, e o utilizador
 * tem de a ver — a §10.2 diz que colunas não reconhecidas ficam destacadas. Herdar a
 * decisão de outra coluna seria inventar um significado.
 */
export interface SavedMapApplication {
  /** Decisões traduzidas para os índices da tabela atual. */
  readonly decisions: readonly ColumnDecision[];
  /** Colunas do ficheiro atual que o mapa não cobre (nomes originais). */
  readonly uncoveredColumns: readonly string[];
  /** Entradas do mapa que não encontraram coluna correspondente (nomes do mapa). */
  readonly unmatchedHeaders: readonly string[];
  /** Cabeçalhos que normalizam para o mesmo nome, tornando a tradução ambígua. */
  readonly ambiguousHeaders: readonly string[];
}

export function applySavedMapToTable(
  table: Pick<RawCsvTable, 'headers'>,
  saved: { readonly headers: readonly string[]; readonly decisions: readonly { readonly index: number; readonly field: string | null }[] },
): SavedMapApplication {
  /*
   * Índice da coluna atual, por nome normalizado, com a contagem de ocorrências.
   *
   * A contagem existe para detetar a colisão de nomes: sem ela, duas colunas com o mesmo
   * nome normalizado fariam a tradução escolher a primeira e a segunda nunca seria
   * mapeada — em silêncio.
   */
  const byName = new Map<string, number[]>();
  table.headers.forEach((header, index) => {
    const name = normalizeColumnName(header);
    const list = byName.get(name) ?? [];
    list.push(index);
    byName.set(name, list);
  });

  const ambiguousHeaders: string[] = [];
  for (const [name, indexes] of byName) {
    if (indexes.length > 1) ambiguousHeaders.push(name);
  }

  /*
   * Os índices do mapa são posicionais dentro de `saved.headers`, e o mapa guarda os
   * cabeçalhos na ordem em que os leu. A correspondência faz-se por isso: para cada
   * decisão, o nome é `saved.headers[decision.index]`.
   */
  const decisions: ColumnDecision[] = [];
  const unmatchedHeaders: string[] = [];
  const used = new Set<number>();
  const coveredIndexes = new Set<number>();

  for (const decision of saved.decisions) {
    const header = saved.headers[decision.index];

    // Uma decisão que aponta para fora dos cabeçalhos guardados é um mapa corrompido.
    // Não se inventa um alvo: a entrada é ignorada, e o utilizador volta a decidir essa
    // coluna por não estar coberta.
    if (header === undefined) continue;

    const name = normalizeColumnName(header);
    const candidates = byName.get(name) ?? [];

    /*
     * Escolhe a primeira ocorrência ainda não usada. É o que preserva a correspondência
     * quando há nomes repetidos: o mapa guardado tem uma decisão por cada entrada, e a
     * ordem de leitura é a única informação disponível para as emparelhar.
     */
    const target = candidates.find((index) => !used.has(index));

    if (target === undefined) {
      unmatchedHeaders.push(header);
      continue;
    }

    used.add(target);
    coveredIndexes.add(target);
    decisions.push({ index: target, field: decision.field });
  }

  const uncoveredColumns = table.headers
    .map((header, index) => ({ header, index }))
    .filter(({ index }) => !coveredIndexes.has(index))
    .map(({ header }) => header);

  return { decisions, uncoveredColumns, unmatchedHeaders, ambiguousHeaders };
}

export function toFieldAssignments(
  columns: readonly ColumnMapping[],
): ReadonlyMap<number, string> {
  const assignments = new Map<number, string>();
  for (const column of columns) {
    if (column.field !== null) assignments.set(column.index, column.field);
  }
  return assignments;
}

/** Nomes de campo já atribuídos, para detetar colunas a competir pelo mesmo campo. */
export function duplicateFieldAssignments(
  columns: readonly ColumnMapping[],
): ReadonlyMap<string, readonly number[]> {
  const byField = new Map<string, number[]>();
  for (const column of columns) {
    if (column.field === null) continue;
    const list = byField.get(column.field) ?? [];
    list.push(column.index);
    byField.set(column.field, list);
  }
  return new Map([...byField].filter(([, indexes]) => indexes.length > 1));
}

/**
 * Sinónimos declarados que apontam para fora do vocabulário canónico.
 *
 * Função de diagnóstico usada pelos testes: devolve a lista de erros de declaração em vez
 * de os deixar passar. Não é chamada em produção — existe para que a verificação tenha um
 * único sítio onde olhar.
 */
export function findDeclaredFieldErrors(): readonly string[] {
  const canonical = new Set(Object.values(CANONICAL_FIELDS).flat());
  const errors: string[] = [];
  for (const entry of COLUMN_SYNONYMS) {
    if (!canonical.has(entry.field)) errors.push(entry.field);
  }
  return [...new Set(errors)].sort();
}
