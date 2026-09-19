/**
 * Parser CSV estrutural (§10.2).
 *
 * Este módulo é **puro**: bytes → estrutura. Não toca em disco, rede, base de
 * dados nem relógio, e não conhece a UI nem o domínio de veículos. Produz uma
 * representação intermédia (`RawCsvTable`) que a fase de mapeamento consome.
 *
 * ## Porque não usamos `split(',')`
 *
 * Um CSV real tem aspas, aspas escapadas (`""`), separadores e quebras de linha
 * *dentro* de campos entre aspas. `split` não distingue nada disso. Este parser
 * percorre os bytes caráter a caráter como uma máquina de estados, o que é a
 * única forma de tratar corretamente:
 *  - `"Rua do Comércio, 12"` como um único campo, mesmo com vírgula lá dentro;
 *  - `"Ele disse ""olá"""` como o valor `Ele disse "olá"`;
 *  - um campo com quebra de linha dentro de aspas;
 *  - CRLF e LF no mesmo ficheiro;
 *  - linhas com contagens de campos irregulares (ficam registadas, não rebentam).
 *
 * ## Sem dependências externas
 *
 * A especificação pede para avaliar se uma dependência é compatível com a
 * filosofia do projeto. Conclusão: não é necessária. O conjunto de
 * comportamentos que precisamos (a seguir) é pequeno, precisa de ser
 * *inspecionável* e precisa de devolver diagnósticos estruturados por linha —
 * coisa que as bibliotecas genéricas não dão sem fricção. Adicionar um pacote
 * aqui aumentaria a superfície de dependências sem ganho real.
 */

import { detectEncoding, decodeWindows1252, type CsvEncoding, type EncodingDetection } from './encoding.js';

/** Separadores reconhecidos (§10.2). */
export const CSV_DELIMITERS = [';', ',', '\t'] as const;
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

/** Nome legível de cada separador (para a UI). */
export const DELIMITER_LABELS: Readonly<Record<CsvDelimiter, string>> = {
  ';': 'Ponto e vírgula (;)',
  ',': 'Vírgula (,)',
  '\t': 'Tabulação',
};

/** Tamanho máximo considerado para a heurística de separador. */
const DELIMITER_SAMPLE_CHARS = 64 * 1024;

/** Máximo de linhas analisadas na heurística de separador. */
const DELIMITER_SAMPLE_ROWS = 40;

/**
 * Uma linha irregular: o número de campos não coincide com o cabeçalho.
 * Guardamos os dois números para que o relatório explique exatamente o que
 * aconteceu, em vez de dizer apenas "linha inválida".
 */
export interface IrregularRow {
  /** Número da linha no ficheiro original (1-based, contando o cabeçalho). */
  readonly line: number;
  /** Campos encontrados. */
  readonly found: number;
  /** Campos esperados (do cabeçalho). */
  readonly expected: number;
}

/** Sintaxe inesperada detetada durante a análise. */
export type CsvSyntaxIssueCode =
  | 'aspas-nao-fechadas'
  | 'aspas-no-meio-de-campo'
  | 'carater-invalido'
  | 'linha-irregular'
  | 'ficheiro-vazio'
  | 'cabecalho-ambiguo'
  | 'cabecalho-duplicado';

export interface CsvSyntaxIssue {
  readonly code: CsvSyntaxIssueCode;
  /** Linha onde ocorreu (1-based), quando aplicável. */
  readonly line?: number;
  /** Coluna (1-based), quando aplicável. */
  readonly column?: number;
  readonly message: string;
}

/** Deteção do separador, com a evidência que a suporta. */
export interface DelimiterDetection {
  readonly delimiter: CsvDelimiter;
  /** Média de campos por linha na amostra (medida de consistência). */
  readonly averageFields: number;
  /** Consistência 0..1: proporção das linhas da amostra com a contagem modal. */
  readonly consistency: number;
  readonly confidence: number;
  readonly uncertain: boolean;
  readonly reason: string;
  /** Contagens por separador candidato, para diagnóstico e UI. */
  readonly counts: Readonly<Record<CsvDelimiter, number>>;
}

/** Deteção do cabeçalho. */
export interface HeaderDetection {
  readonly hasHeader: boolean;
  /** Primeira linha, etc. — apenas quando existe cabeçalho. */
  readonly headers: readonly string[];
  readonly confidence: number;
  readonly uncertain: boolean;
  readonly reason: string;
}

/**
 * Representação intermédia do ficheiro CSV. É o contrato entre o parser e o
 * mapeamento; não é um `CanonicalRecord` (essa conversão é a fase seguinte).
 */
export interface RawCsvTable {
  readonly encoding: CsvEncoding;
  readonly encodingConfidence: number;
  readonly encodingUncertain: boolean;
  readonly encodingReason: string;
  readonly delimiter: CsvDelimiter;
  readonly delimiterConfidence: number;
  readonly delimiterUncertain: boolean;
  readonly delimiterReason: string;
  readonly hasHeader: boolean;
  readonly headerConfidence: number;
  readonly headerUncertain: boolean;
  readonly headerReason: string;
  /** Nomes das colunas (do cabeçalho, ou gerados quando não existe). */
  readonly headers: readonly string[];
  /** Linhas de dados, cada uma alinhada com `headers`. */
  readonly rows: readonly RawCsvRow[];
  /** Número de linhas físicas do ficheiro (inclui cabeçalho e linhas vazias). */
  readonly physicalLineCount: number;
  /** Diagnósticos de robustez, para o relatório e para a UI. */
  readonly issues: readonly CsvSyntaxIssue[];
}

/** Uma linha de dados, com o número de linha original preservado. */
export interface RawCsvRow {
  /** Linha no ficheiro original (1-based). */
  readonly line: number;
  /** Valores, na ordem das colunas. */
  readonly values: readonly string[];
  /** Campos em falta (linha curta) já preenchidos com string vazia. */
  readonly padded: boolean;
}

export interface ParseCsvOptions {
  /** Força a codificação (usado quando o utilizador corrige a deteção). */
  readonly encoding?: CsvEncoding;
  /** Força o separador (usado quando o utilizador corrige a deteção). */
  readonly delimiter?: CsvDelimiter;
  /** Força a presença de cabeçalho. */
  readonly hasHeader?: boolean;
  /** Trata a primeira linha como cabeçalho mesmo que pareça vazia. */
  readonly maxRows?: number;
}

/**
 * Analisa um ficheiro CSV completo: deteta codificação, separador e cabeçalho,
 * e devolve a tabela estruturada com diagnósticos.
 */
export function parseCsv(bytes: Uint8Array, options: ParseCsvOptions = {}): RawCsvTable {
  const detection = options.encoding
    ? forcedEncoding(bytes, options.encoding)
    : detectEncoding(bytes);

  const issues: CsvSyntaxIssue[] = [];

  if (detection.text.length === 0) {
    issues.push({ code: 'ficheiro-vazio', message: 'O ficheiro não contém dados.' });
    return {
      encoding: detection.encoding,
      encodingConfidence: detection.confidence,
      encodingUncertain: detection.uncertain,
      encodingReason: detection.reason,
      delimiter: options.delimiter ?? ';',
      delimiterConfidence: 0,
      delimiterUncertain: true,
      delimiterReason: 'Ficheiro vazio: não há estrutura para analisar.',
      hasHeader: false,
      headerConfidence: 0,
      headerUncertain: true,
      headerReason: 'Ficheiro vazio.',
      headers: [],
      rows: [],
      physicalLineCount: 0,
      issues,
    };
  }

  const delimiterDetection = options.delimiter
    ? forcedDelimiter(detection.text, options.delimiter)
    : detectDelimiter(detection.text);

  const delimiter = delimiterDetection.delimiter;

  // Análise estrutural completa com o separador escolhido.
  const tokenized = tokenize(detection.text, delimiter);
  issues.push(...tokenized.issues);

  const allRows = tokenized.rows;
  const physicalLineCount = countPhysicalLines(detection.text);

  const headerDetection = detectHeader(allRows, options.hasHeader);
  issues.push(...headerDetection.issues);

  const hasHeader = headerDetection.hasHeader;
  const headers = hasHeader
    ? headerDetection.headers
    : generateHeaders(allRows[0]?.values.length ?? 0);

  const dataRows = hasHeader ? allRows.slice(1) : allRows;

  const rows: RawCsvRow[] = [];
  const expected = headers.length;

  for (const row of dataRows) {
    // Linhas totalmente vazias (um único campo vazio) são ignoradas: são
    // separadores visuais no ficheiro, não registos.
    if (row.values.length === 1 && (row.values[0] ?? '').trim() === '') {
      continue;
    }

    if (row.values.length !== expected) {
      issues.push({
        code: 'linha-irregular',
        line: row.line,
        message: `A linha ${row.line} tem ${row.values.length} campo(s); o cabeçalho define ${expected}.`,
      });
    }

    const values = alignTo(row.values, expected);
    rows.push({ line: row.line, values, padded: values.length > row.values.length });

    if (options.maxRows !== undefined && rows.length >= options.maxRows) break;
  }

  if (expected > 0 && rows.every((r) => r.values.every((v) => v.trim() === ''))) {
    // Sem registos úteis — não é um erro fatal, mas é informação relevante.
    issues.push({
      code: 'ficheiro-vazio',
      message: 'O ficheiro não contém registos além do cabeçalho.',
    });
  }

  return {
    encoding: detection.encoding,
    encodingConfidence: detection.confidence,
    encodingUncertain: detection.uncertain,
    encodingReason: detection.reason,
    delimiter,
    delimiterConfidence: delimiterDetection.confidence,
    delimiterUncertain: delimiterDetection.uncertain,
    delimiterReason: delimiterDetection.reason,
    hasHeader,
    headerConfidence: headerDetection.confidence,
    headerUncertain: headerDetection.uncertain,
    headerReason: headerDetection.reason,
    headers,
    rows,
    physicalLineCount,
    issues,
  };
}

/** Descodifica forçando uma codificação concreta (correção do utilizador). */
function forcedEncoding(bytes: Uint8Array, encoding: CsvEncoding): EncodingDetection {
  if (encoding === 'utf-8-bom') {
    const start = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
    return {
      encoding,
      text: new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(start)),
      confidence: 1,
      uncertain: false,
      reason: 'Codificação forçada pelo utilizador.',
    };
  }
  if (encoding === 'utf-8') {
    return {
      encoding,
      text: new TextDecoder('utf-8', { fatal: false }).decode(bytes),
      confidence: 1,
      uncertain: false,
      reason: 'Codificação forçada pelo utilizador.',
    };
  }
  return {
    encoding: 'windows-1252',
    text: decodeWindows1252(bytes),
    confidence: 1,
    uncertain: false,
    reason: 'Codificação forçada pelo utilizador.',
  };
}

/**
 * Conta linhas físicas de um texto (CRLF, LF ou CR isolado).
 *
 * Uma quebra de linha *final* não cria uma linha nova: `"A\nB\n"` tem 2 linhas,
 * não 3. Isto é o que um utilizador espera ver na UI quando lhe dizemos
 * "analisámos N linhas".
 */
function countPhysicalLines(text: string): number {
  if (text.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 0x0a) count += 1;
    else if (c === 0x0d) {
      if (text.charCodeAt(i + 1) === 0x0a) i += 1;
      count += 1;
    }
  }
  const last = text.charCodeAt(text.length - 1);
  if (last === 0x0a || last === 0x0d) count -= 1;
  return count;
}

/** Uma linha crua com os valores já separados (antes de alinhamento). */
interface TokenizedRow {
  readonly line: number;
  readonly values: string[];
}

interface TokenizeResult {
  readonly rows: TokenizedRow[];
  readonly issues: CsvSyntaxIssue[];
}

/**
 * Máquina de estados de CSV (RFC 4180 com tolerâncias).
 *
 * Estado: dentro ou fora de aspas. Fora de aspas, o separador e a quebra de
 * linha terminam campos/linhas. Dentro de aspas, tudo é literal exceto `""`,
 * que produz uma aspa, e a aspa final de fecho.
 *
 * A regra é deliberadamente tolerante no que respeita a dados, mas registada
 * no que respeita a sintaxe: se um campo tem aspas no meio (ex.: `12"`), isso é
 * válido enquanto aspa literal no início de linha de dados — muito comum em
 * ficheiros portugueses (polegadas) — e não é reportado como erro. Já uma aspa
 * de abertura que nunca fecha é um problema real e é reportado.
 */
function tokenize(text: string, delimiter: string): TokenizeResult {
  const rows: TokenizedRow[] = [];
  const issues: CsvSyntaxIssue[] = [];

  let values: string[] = [];
  let current = '';
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;
  let quotesOpenedAt: number | null = null;

  const pushField = (): void => {
    values.push(current);
    current = '';
  };

  const pushRow = (): void => {
    pushField();
    const row: TokenizedRow = { line: rowStartLine, values };
    rows.push(row);
    values = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
          quotesOpenedAt = null;
        }
      } else {
        if (ch === '\n') line += 1;
        current += ch;
      }
      continue;
    }

    if (ch === '"') {
      if (current.length === 0) {
        inQuotes = true;
        quotesOpenedAt = line;
      } else {
        // Aspa literal dentro de um campo não entre aspas (ex.: 12").
        current += '"';
      }
      continue;
    }

    if (ch === delimiter) {
      pushField();
      continue;
    }

    if (ch === '\r') {
      if (text[i + 1] === '\n') i += 1;
      pushRow();
      line += 1;
      rowStartLine = line;
      continue;
    }

    if (ch === '\n') {
      pushRow();
      line += 1;
      rowStartLine = line;
      continue;
    }

    current += ch;
  }

  if (inQuotes) {
    issues.push({
      code: 'aspas-nao-fechadas',
      line: quotesOpenedAt ?? line,
      message: `Aspas abertas na linha ${quotesOpenedAt ?? line} nunca foram fechadas.`,
    });
  }

  // Última linha sem quebra final.
  if (current.length > 0 || values.length > 0) {
    pushRow();
  }

  // Remove linha final vazia (ficheiros terminam normalmente com \n).
  const last = rows[rows.length - 1];
  if (last && last.values.length === 1 && last.values[0] === '') {
    rows.pop();
  }

  return { rows, issues };
}

/** Número de ocorrências de um separador fora de aspas (amostra). */
function countOutsideQuotes(text: string, delimiter: string, maxRows: number): number {
  let count = 0;
  let inQuotes = false;
  let rowsSeen = 0;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') i += 1;
        else inQuotes = false;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      rowsSeen += 1;
      if (rowsSeen >= maxRows) break;
      continue;
    }
    if (ch === delimiter) count += 1;
  }

  return count;
}

/**
 * Deteção de separador **baseada na estrutura real do ficheiro** (§10.2).
 *
 * O erro clássico é escolher o separador que aparece mais vezes. Isso falha em
 * duas situações muito comuns em Portugal:
 *  1. Um ficheiro com `;` como separador mas decimais com vírgula
 *     (`1.234,56`) tem *mais* vírgulas do que pontos e vírgulas;
 *  2. Um ficheiro com um campo de texto que contém vírgulas mas o separador
 *     real é outro.
 *
 * A medida correta não é a frequência bruta, é a **consistência estrutural**:
 * quantas linhas têm exatamente a mesma contagem de campos que a moda. Um
 * separador correto produz um bloco de linhas com contagem constante (o
 * cabeçalho + os dados); um separador errado produz contagens erráticas, porque
 * só divide dentro de alguns campos.
 *
 * Ponto de decisão: exige-se no mínimo 2 colunas (1 separador por linha) e
 * prefere-se a maior consistência; em empate, o número modal de campos decide.
 */
export function detectDelimiter(text: string, options: { maxRows?: number } = {}): DelimiterDetection {
  const sample = text.slice(0, DELIMITER_SAMPLE_CHARS);
  const maxRows = options.maxRows ?? DELIMITER_SAMPLE_ROWS;

  const counts: Record<CsvDelimiter, number> = { ';': 0, ',': 0, '\t': 0 };
  for (const d of CSV_DELIMITERS) {
    counts[d] = countOutsideQuotes(sample, d, maxRows);
  }

  interface Candidate {
    readonly delimiter: CsvDelimiter;
    readonly consistency: number;
    readonly averageFields: number;
    readonly modalFields: number;
  }

  const candidates: Candidate[] = [];

  for (const d of CSV_DELIMITERS) {
    const rows = tokenize(sample, d).rows.filter(
      (r) => !(r.values.length === 1 && (r.values[0] ?? '').trim() === ''),
    );
    if (rows.length === 0) continue;

    const fieldCounts = rows.map((r) => r.values.length);
    const tally = new Map<number, number>();
    for (const n of fieldCounts) tally.set(n, (tally.get(n) ?? 0) + 1);

    let modalFields = 1;
    let modalHits = 0;
    for (const [fields, hits] of tally) {
      if (hits > modalHits || (hits === modalHits && fields > modalFields)) {
        modalFields = fields;
        modalHits = hits;
      }
    }

    const consistency = modalHits / rows.length;
    const averageFields = fieldCounts.reduce((a, b) => a + b, 0) / rows.length;

    candidates.push({ delimiter: d, consistency, averageFields, modalFields });
  }

  if (candidates.length === 0) {
    return {
      delimiter: ';',
      averageFields: 1,
      consistency: 0,
      confidence: 0,
      uncertain: true,
      reason: 'Não foi possível analisar a estrutura do ficheiro.',
      counts,
    };
  }

  // Só separadores que produzam pelo menos 2 colunas são candidatos válidos.
  const viable = candidates.filter((c) => c.modalFields >= 2);
  const pool = viable.length > 0 ? viable : candidates;

  pool.sort((a, b) => {
    if (b.consistency !== a.consistency) return b.consistency - a.consistency;
    if (b.modalFields !== a.modalFields) return b.modalFields - a.modalFields;
    // Desempate determinístico: ordem de CSV_DELIMITERS.
    return CSV_DELIMITERS.indexOf(a.delimiter) - CSV_DELIMITERS.indexOf(b.delimiter);
  });

  const best = pool[0] as Candidate;
  const runnerUp = pool[1];
  const ambiguousRunnerUp =
    runnerUp !== undefined &&
    runnerUp.consistency === best.consistency &&
    runnerUp.modalFields === best.modalFields;

  const noDelimiterFound = best.modalFields < 2;
  const uncertain = noDelimiterFound || ambiguousRunnerUp || best.consistency < 0.9;

  const confidence = noDelimiterFound
    ? 0.2
    : Math.min(1, 0.5 + best.consistency / 2 - (ambiguousRunnerUp ? 0.2 : 0));

  const reason = noDelimiterFound
    ? 'Nenhum separador encontrado: o ficheiro parece ter uma única coluna.'
    : ambiguousRunnerUp
      ? `Estrutura consistente com mais de um separador (${DELIMITER_LABELS[best.delimiter]} e ${DELIMITER_LABELS[runnerUp.delimiter]}); confirmação necessária.`
      : `Separador ${DELIMITER_LABELS[best.delimiter]}: ${Math.round(best.consistency * 100)}% das linhas têm ${best.modalFields} campos.`;

  return {
    delimiter: best.delimiter,
    averageFields: best.averageFields,
    consistency: best.consistency,
    confidence,
    uncertain,
    reason,
    counts,
  };
}

/** Separação forçada pelo utilizador — mantém a medição para o relatório. */
function forcedDelimiter(text: string, delimiter: CsvDelimiter): DelimiterDetection {
  const sample = text.slice(0, DELIMITER_SAMPLE_CHARS);
  const rows = tokenize(sample, delimiter).rows.filter(
    (r) => !(r.values.length === 1 && (r.values[0] ?? '').trim() === ''),
  );
  const fieldCounts = rows.map((r) => r.values.length);
  const averageFields = fieldCounts.length === 0 ? 1 : fieldCounts.reduce((a, b) => a + b, 0) / fieldCounts.length;

  return {
    delimiter,
    averageFields,
    consistency: 1,
    confidence: 1,
    uncertain: false,
    reason: 'Separador forçado pelo utilizador.',
    counts: { ';': 0, ',': 0, '\t': 0 },
  };
}

/** Gera nomes de coluna quando o ficheiro não tem cabeçalho. */
function generateHeaders(count: number): string[] {
  const headers: string[] = [];
  for (let i = 0; i < count; i += 1) {
    headers.push(`Coluna ${i + 1}`);
  }
  return headers;
}

interface HeaderDetectionResult extends HeaderDetection {
  readonly issues: readonly CsvSyntaxIssue[];
}

/**
 * Decisão sobre a existência de cabeçalho.
 *
 * Critérios (todos heurísticos, mas explicáveis):
 *  - Um cabeçalho tem células de texto em quase todas as colunas;
 *  - As linhas de dados têm, tipicamente, números/datas em pelo menos uma coluna;
 *  - Um cabeçalho não tem valores vazios nem duplicados.
 *
 * Quando não é possível decidir com segurança, assumimos *que existe*
 * cabeçalho (é o caso largamente dominante) e marcamos `uncertain` — a UI
 * pergunta ao utilizador em vez de escolher silenciosamente.
 */
function detectHeader(
  rows: readonly TokenizedRow[],
  forced: boolean | undefined,
): HeaderDetectionResult {
  const issues: CsvSyntaxIssue[] = [];

  if (rows.length === 0) {
    return {
      hasHeader: forced ?? false,
      headers: [],
      confidence: 0,
      uncertain: true,
      reason: 'Ficheiro sem linhas.',
      issues,
    };
  }

  const first = rows[0] as TokenizedRow;
  const firstValues = first.values.map((v) => v.trim());

  const dupes = new Set<string>();
  const seen = new Set<string>();
  for (const v of firstValues) {
    if (v === '') continue;
    if (seen.has(v.toLowerCase())) dupes.add(v);
    seen.add(v.toLowerCase());
  }

  if (forced !== undefined) {
    const headers = forced ? dedupeHeaders(firstValues) : generateHeaders(firstValues.length);
    if (forced && headerCountsAsHeader(firstValues) === false) {
      issues.push({
        code: 'cabecalho-ambiguo',
        message: 'A primeira linha foi tratada como cabeçalho por decisão do utilizador.',
      });
    }
    return {
      hasHeader: forced,
      headers,
      confidence: 1,
      uncertain: false,
      reason: 'Decisão do utilizador.',
      issues,
    };
  }

  const hasEmpty = firstValues.some((v) => v === '');
  const looksLikeHeader = !hasEmpty && firstValues.length > 0;
  const firstLooksNumeric = firstValues.some((v) => v !== '' && looksNumeric(v));
  const dataRows = rows.slice(1, 6);
  const dataHasNumbers = dataRows.some((r) => r.values.some((v) => v.trim() !== '' && looksNumeric(v.trim())));

  let hasHeader: boolean;
  let confidence: number;
  let reason: string;

  if (looksLikeHeader && !firstLooksNumeric && dataHasNumbers) {
    hasHeader = true;
    confidence = 0.95;
    reason = 'A primeira linha contém apenas nomes e as seguintes contêm valores numéricos.';
  } else if (looksLikeHeader && !firstLooksNumeric) {
    hasHeader = true;
    confidence = 0.7;
    reason = 'A primeira linha parece um conjunto de nomes de coluna.';
  } else if (firstLooksNumeric) {
    hasHeader = false;
    confidence = 0.8;
    reason = 'A primeira linha contém valores numéricos: parece já ser um registo.';
  } else {
    hasHeader = true;
    confidence = 0.5;
    reason = 'Deteção de cabeçalho inconclusiva; assumida a convenção mais comum.';
  }

  const uncertain = confidence < 0.9;

  if (uncertain) {
    issues.push({
      code: 'cabecalho-ambiguo',
      message: 'Não foi possível determinar com segurança se a primeira linha é um cabeçalho.',
    });
  }

  if (dupes.size > 0) {
    issues.push({
      code: 'cabecalho-duplicado',
      message: `Colunas duplicadas no cabeçalho: ${[...dupes].join(', ')}.`,
    });
  }

  return {
    hasHeader,
    headers: hasHeader ? dedupeHeaders(firstValues) : generateHeaders(firstValues.length),
    confidence,
    uncertain,
    reason,
    issues,
  };
}

/** True quando a linha parece efetivamente um cabeçalho (para validação do forçado). */
function headerCountsAsHeader(values: readonly string[]): boolean {
  return values.length > 0 && values.some((v) => v.trim() !== '') && !values.some((v) => v.trim() !== '' && looksNumeric(v.trim()));
}

/**
 * Desambigua nomes de colunas repetidos acrescentando um sufixo numérico.
 * Mantém o primeiro nome intacto para que o mapeamento por sinónimo continue a
 * funcionar na coluna "principal".
 *
 * Cabeçalhos **vazios** ficam vazios. Não os substituímos por "Coluna N": essa
 * informação pertence ao cabeçalho original — é o que permite ao mapeador distinguir
 * "esta coluna não tem nome" (e dizê-lo com precisão) de "esta coluna chama-se
 * literalmente Coluna 2". Preencher aqui seria inventar um nome que o ficheiro não tem
 * e, pior, esconder do utilizador que a coluna está efetivamente sem título.
 */
function dedupeHeaders(values: readonly string[]): string[] {
  const used = new Map<string, number>();
  return values.map((raw) => {
    const name = raw.trim();
    if (name === '') return '';
    const key = name.toLowerCase();
    const count = used.get(key) ?? 0;
    used.set(key, count + 1);
    return count === 0 ? name : `${name} (${count + 1})`;
  });
}

/**
 * Heurística numérica para decidir cabeçalho. Aceita números com vírgula ou
 * ponto decimal, separadores de milhares, sinais, percentagens e moeda, e
 * datas em formatos portugueses comuns.
 */
export function looksNumeric(value: string): boolean {
  const v = value.trim();
  if (v === '') return false;
  if (/^[+-]?(\d{1,3}([.,\s]\d{3})*|\d+)([.,]\d+)?\s*(€|\$|£|%)?$/.test(v)) return true;
  if (/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(v)) return true;
  if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(v)) return true;
  return false;
}

/** Alinha uma linha ao número de colunas do cabeçalho (trunca ou preenche). */
function alignTo(values: readonly string[], expected: number): string[] {
  if (values.length === expected) return [...values];
  if (values.length > expected) return values.slice(0, expected);
  const out = [...values];
  while (out.length < expected) out.push('');
  return out;
}
