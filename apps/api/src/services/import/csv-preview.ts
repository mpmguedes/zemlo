/**
 * Orquestração da importação de CSV (§10, §4.1, §4.3).
 *
 * ## O que este ficheiro é
 *
 * É o equivalente de `read.ts` para o adaptador externo. Liga a cadeia da §4.1 **até** aos
 * `CanonicalRecord` e entrega-os ao **mesmo** núcleo que o bundle nativo usa:
 *
 * ```
 *   bytes → detectEncoding → parseCsv → mapColumns → interpretColumn
 *         → inferRecordKind → buildCanonicalRecords
 *         → [NÚCLEO CAMADA 1] validateRecords → estado da conta → buildPlan
 * ```
 *
 * A seta vertical marca a fronteira da §4.3. Tudo o que está acima é específico do CSV e
 * vive em `domain/import/csv/`. Tudo o que está abaixo é o núcleo fechado nas Fases 1–4, e
 * este ficheiro **não lhe toca**: chama as mesmas funções, com os mesmos argumentos, que o
 * `read.ts` chama.
 *
 * ## Porque é que isto não duplica o `read.ts`
 *
 * O `read.ts` faz três coisas depois do Parser: normalizar, **ler o estado da conta** e
 * construir o plano. As duas últimas são idênticas para os dois adaptadores — e é por isso
 * que este ficheiro **importa** `readAccountState` e `vehicleIdTranslator` de lá em vez de
 * as reescrever.
 *
 * Nem poderia ser de outra forma: `readAccountState` é a única implementação da regra de
 * isolamento por conta na leitura (§7.3, "todas as consultas levam `where: { userId }`").
 * Uma segunda cópia seria uma segunda oportunidade de a esquecer, e o sintoma de a esquecer
 * é invisível — "já existe" num registo que o utilizador nunca viu.
 *
 * O que **muda** entre os dois adaptadores é apenas o miolo: o bundle passa por
 * `normalizeRecords` (os campos crus precisam de tradução, A27) porque o formato é fechado e
 * conhecido; o CSV já constrói campos de domínio diretamente (é isso que o mapeamento faz),
 * pelo que **não** passa por `normalizeRecords`. Essa diferença está declarada e testada.
 *
 * ## Nada é escrito aqui
 *
 * Como o `read.ts`: zero chamadas de escrita. A §7.1 exige que nenhuma escrita aconteça
 * antes da fase `apply`, e a pré-visualização de CSV é a fase `review`.
 */

import { createHash } from 'node:crypto';

import type { PrismaClient } from '../../core/db.js';

import { parseCsv, type CsvSyntaxIssue, type RawCsvTable } from '../../domain/import/csv/parse.js';
import {
  mapColumns,
  resolveMapping,
  type ColumnDecision,
  type ColumnMapping,
  type ColumnMappingResult,
} from '../../domain/import/csv/mapping.js';
import {
  interpretColumn,
  type ColumnAmbiguity,
  type ColumnInterpretation,
  type DateOrder,
  type DecimalStyle,
  type ValueIssue,
} from '../../domain/import/csv/values.js';
import {
  inferRecordKind,
  requiredFieldsFor,
  isCsvSupportedKind,
  type KindInference,
} from '../../domain/import/csv/infer-kind.js';
import {
  buildCanonicalRecords,
  describeEmptyResult,
  emptyFieldsFor,
  type BuildRecordsResult,
  type RowIssue,
} from '../../domain/import/csv/build-records.js';
import { validateRecords, type CanonicalRecord, type RecordKind } from '../../domain/import/validate.js';
import {
  buildPlan,
  type ConflictPolicy,
  type ImportPlan,
} from '../../domain/import/plan.js';
import { readImportedLocalIds } from './book.js';
import { readAccountState, vehicleIdTranslator } from './read.js';

/* -------------------------------------------------------------------------- */
/* Contrato                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A identidade de uma importação de CSV.
 *
 * ## Porque é que isto existe
 *
 * O plano (§9.5) não transporta `bundleId` — o `read.ts` lê-o do `bundle.bundleId` no
 * momento de aplicar, e o `buildPlan` nunca o vê. O CSV não tem bundle, pelo que precisa
 * de **outra** identidade estável para o livro de idempotência.
 *
 * A escolha é `<userId>:<sha256 dos bytes>:<tipo>`:
 *
 *  - **o hash dos bytes**, e não o nome do ficheiro: o mesmo conteúdo com nomes diferentes
 *    (`export.csv`, `export (1).csv`) é a mesma importação, e importá-lo duas vezes não deve
 *    duplicar nada. Um nome é um rótulo; o conteúdo é o facto;
 *  - **o tipo**, porque um ficheiro de abastecimentos e um de despesas podem ter o mesmo
 *    cabeçalho e produzir registos diferentes — a chave tem de os distinguir;
 *  - **o `userId`** está na chave do livro de qualquer forma (§9.5), mas incluí-lo aqui
 *    torna a chave legível e impossível de confundir entre contas.
 *
 * O prefixo `csv_` distingue-a de um `bundleId` nativo. Um `localId` gerado pelo adaptador
 * começa sempre por um prefixo de tipo (`fuel_…`), pelo que não há colisão possível com a
 * forma dos identificadores do bundle.
 */
export interface CsvImportIdentity {
  /** A chave de idempotência (§9.5). Estável para o mesmo ficheiro e o mesmo tipo. */
  readonly key: string;
  /** O `sha256` dos bytes originais. Distingue "mesmo ficheiro" de "mesmo nome". */
  readonly contentHash: string;
}

/**
 * Deteção — o que a interface mostra no passo 3 do fluxo (§10.2).
 *
 * É deliberadamente um objeto **separado** do mapeamento: a deteção é sobre o ficheiro
 * (como está codificado, que separador usa, tem cabeçalho?), e o mapeamento é sobre o
 * significado das colunas. Misturá-los faria a interface ter de desenhar o ecrã de
 * confirmação de mapeamento antes de poder dizer "detetámos `;` como separador".
 */
export interface CsvDetection {
  readonly encoding: string;
  readonly encodingConfidence: number;
  /** `true` quando a codificação é uma hipótese e não uma certeza (ficheiro só-ASCII). */
  readonly encodingUncertain: boolean;
  readonly delimiter: string;
  readonly delimiterLabel: string;
  readonly delimiterConfidence: number;
  readonly hasHeader: boolean;
  readonly headers: readonly string[];
  readonly rowCount: number;
  /** Total de linhas físicas, incluindo cabeçalho e linhas ignoradas. */
  readonly physicalLineCount: number;
  /**
   * Confiança global da deteção — o **mínimo** das três confianças.
   *
   * É este o número que o ecrã usa para decidir se mostra o aviso "confirma que está
   * certo". Uma média diluiria a incerteza, e o utilizador decide com base no elo mais
   * fraco.
   */
  readonly confidence: number;
  /** Problemas sintáticos do ficheiro (aspas por fechar, linhas irregulares). */
  readonly issues: readonly CsvSyntaxIssue[];
  /** Razões legíveis para as decisões, para a interface as poder explicar. */
  readonly reasons: readonly string[];
}

/** O mapeamento, pronto a apresentar e a corrigir (passos 4–5 do fluxo). */
export interface CsvMappingView {
  readonly columns: readonly ColumnMapping[];
  /** Colunas que exigem uma decisão antes de continuar. */
  readonly ambiguousColumns: readonly ColumnMapping[];
  readonly unmappedColumns: readonly ColumnMapping[];
  /** 0..1 — proporção de colunas já resolvidas. */
  readonly coverage: number;
  /** `true` quando o utilizador pode avançar sem decidir nada. */
  readonly readyWithoutInput: boolean;
  /** Amostra de valores por coluna, para o utilizador reconhecer o que está a mapear. */
  readonly requiredFields: readonly string[];
  /**
   * Ambiguidades de **valor** por resolver (§10.4) — data dia/mês, separador decimal,
   * duas moedas, unidade ambígua.
   *
   * ## Porque é que este campo existe, e porque é que a sua ausência era um defeito
   *
   * `ambiguousColumns` cobre ambiguidades de **mapeamento**: a coluna «Km/l» pode ser dois
   * campos diferentes. Este campo cobre o outro eixo, que a §10.4 trata na mesma secção: o
   * **mapeamento está certo** e o valor é que tem mais do que uma leitura possível —
   * `03/04/2026` é 3 de abril ou 4 de março, e `1,589` é um euro e meio ou mil quinhentos e
   * oitenta e nove.
   *
   * Sem ele, o `interpretColumn` calculava a ambiguidade e o serviço **descartava-a**: a
   * coluna ficava sem valores, as linhas eram marcadas como tendo «valores ilegíveis» que
   * ninguém conseguia nomear, e o utilizador recebia um beco sem saída em vez de uma
   * pergunta. A §10.4 diz «pergunta-se, com pré-visualização das duas interpretações»; uma
   * ambiguidade que o servidor conhece e não conta é uma pergunta perdida, e a §11.3 proíbe
   * exatamente isso.
   *
   * ## O que o ecrã faz com isto
   *
   * Cada entrada traz a pergunta pronta e as interpretações possíveis com os valores de
   * amostra já calculados, para que a resposta seja dada a olhar para os dados. A resposta
   * viaja de volta como `dateOrder` / `decimalStyle` — as mesmas convenções que o mapa
   * guardado persiste —, pelo que responder aqui e responder no seletor de convenções são a
   * mesma operação.
   */
  readonly valueAmbiguities: readonly ColumnAmbiguity[];
}

/** A pré-visualização normalizada — o passo 7 do fluxo (§10.2). */
export interface CsvRecordPreview {
  readonly localId: string;
  readonly line: number;
  readonly kind: RecordKind;
  /** Campos tal como serão escritos. Só valores de domínio, nunca texto cru. */
  readonly fields: Readonly<Record<string, unknown>>;
  /** Campos obrigatórios que ficarão vazios. Declarados, não escondidos (§9.2). */
  readonly emptyFields: readonly string[];
}

/** O resultado completo da análise. **Nada disto foi escrito.** */
export interface CsvPreview {
  /** Identidade para o livro de idempotência e para o `apply`. */
  readonly identity: CsvImportIdentity;
  readonly detection: CsvDetection;
  readonly mapping: CsvMappingView;
  readonly inference: KindInference;
  /** Tipo efetivamente usado. `null` quando a inferência não decidiu. */
  readonly kind: RecordKind | null;
  /** Os registos canónicos — o que o `apply` recebe, sem os reconstruir. */
  readonly records: readonly CanonicalRecord[];
  /** Pré-visualização das primeiras linhas, já normalizadas. */
  readonly preview: readonly CsvRecordPreview[];
  /** Linhas ignoradas com motivo. Nunca em silêncio. */
  readonly skipped: readonly { readonly line: number; readonly reason: string }[];
  /** Valores ilegíveis, com a coluna a que pertencem. */
  readonly valueIssues: readonly RowIssue[];
  /** O plano — calculado pelo núcleo da Camada 1, não por este ficheiro. */
  readonly plan: ImportPlan;
  /** Aviso quando não foi possível construir nada, com a causa mais provável. */
  readonly emptyReason: string | null;
}

/** Uma decisão do utilizador sobre uma coluna (mapear a um campo, ou ignorá-la). */
export type CsvMappingDecision = ColumnDecision;

export interface PreviewCsvOptions {
  /** Bytes originais do ficheiro. */
  readonly bytes: Uint8Array;
  /** Utilizador autenticado. **Nunca** vem do ficheiro. */
  readonly userId: string;
  readonly prisma: PrismaClient;
  /**
   * Tipo forçado pelo utilizador. Quando ausente, é inferido a partir das colunas.
   *
   * Existe porque a §10.5 termina com "o utilizador escolhe" — e a escolha tem de chegar
   * ao servidor por um caminho explícito, não por um campo qualquer do ficheiro.
   */
  readonly kind?: RecordKind;
  /** Decisões já tomadas sobre colunas ambíguas. */
  readonly decisions?: readonly CsvMappingDecision[];
  /** Convenções já decididas (de uma confirmação anterior ou de um mapa guardado). */
  readonly dateOrder?: DateOrder;
  readonly decimalStyle?: DecimalStyle;
  /** Resoluções por campo para colunas de unidade ambígua (`Km/l`). */
  readonly resolvedUnits?: Readonly<Record<string, string | null>>;
  /** Política de conflito (decisão 8). Por omissão `fill-empty`. */
  readonly conflictPolicy?: ConflictPolicy;
  /** Quantas linhas a pré-visualização mostra. Por omissão 20 (§10.2). */
  readonly previewLimit?: number;
  /** Limite de linhas a ler do ficheiro. */
  readonly maxRows?: number;
}

/* -------------------------------------------------------------------------- */
/* Constantes                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Quantas linhas a pré-visualização mostra por omissão.
 *
 * A §10.2 fixa "cerca de 20". O valor é uma constante exportada — e não um literal
 * repetido — para que o teste verifique a regra em vez de a reescrever.
 */
export const PREVIEW_ROWS = 20;

/* -------------------------------------------------------------------------- */
/* Deteção                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Descreve o que foi detetado no ficheiro.
 *
 * ## Porque é que isto é quase uma cópia
 *
 * O `RawCsvTable` já traz toda a informação de deteção — codificação, separador, cabeçalho,
 * com confiança e razão para cada um. Esta função **não** é uma segunda deteção: é uma
 * projeção para a forma que a interface consome, e a diferença é real. O `RawCsvTable` é o
 * contrato interno entre o parser e o mapeamento; o `CsvDetection` é o contrato com o ecrã
 * do passo 3 (§10.2), que não deve conhecer `headerUncertain` nem `delimiterUncertain`
 * separadamente — o utilizador quer saber *o que* foi detetado e *quão seguro* é, não três
 * booleanos por aspeto.
 *
 * As três razões são agregadas numa lista única porque o ecrã as mostra juntas, por baixo
 * do resumo. Mantê-las separadas obrigaria o componente a saber qual pertence a quê — que é
 * exatamente o conhecimento que este ficheiro existe para não espalhar.
 */
function describeDetection(table: RawCsvTable): CsvDetection {
  /*
   * A confiança da codificação é a **mais baixa** das três, e não uma média.
   *
   * Uma média diluiria a incerteza: um separador certo (`;`) e um cabeçalho certo não
   * tornam uma codificação duvidosa mais fiável. O utilizador decide se abre o ficheiro a
   * verificar com base no elo mais fraco, não na média dos elos.
   */
  const confidence = Math.min(
    table.encodingConfidence,
    table.delimiterConfidence,
    table.headerConfidence,
  );

  return {
    encoding: table.encoding,
    encodingConfidence: table.encodingConfidence,
    // A incerteza é a de qualquer um dos três aspetos: se algum é uma hipótese, o ecrã
    // deve dizê-lo — e a codificação é a única cuja incerteza é invisível na pré-visualização
    // (um acento mal descodificado aparece como `?`, que o utilizador atribui ao ficheiro).
    encodingUncertain: table.encodingUncertain,
    delimiter: table.delimiter,
    /*
     * O rótulo tem um `??` porque `noUncheckedIndexedAccess` está ligado no projeto e um
     * acesso por chave devolve `string | undefined`. O fallback nunca acontece — o
     * `parse.ts` só produz separadores de `CSV_DELIMITERS`, que é exatamente o conjunto
     * deste mapa —, mas escrever `!` seria afirmar ao compilador algo que ele não pode
     * verificar. O `??` documenta o caso e mantém a asserção desnecessária.
     */
    delimiterLabel: DELIMITER_LABELS[table.delimiter] ?? table.delimiter,
    delimiterConfidence: table.delimiterConfidence,
    hasHeader: table.hasHeader,
    headers: table.headers,
    rowCount: table.rows.length,
    physicalLineCount: table.physicalLineCount,
    issues: table.issues,
    confidence,
    reasons: [table.encodingReason, table.delimiterReason, table.headerReason],
  };
}

/**
 * Rótulos dos separadores, para o ecrã nunca mostrar um `\t` cru.
 *
 * Um separador é um caráter invisível, e "Separador: \t" não diz nada a ninguém. O rótulo
 * é a única forma de o passo 3 ser legível — e tem de existir aqui, na fronteira, porque o
 * `parse.ts` não tem (nem deve ter) vocabulário de apresentação.
 */
const DELIMITER_LABELS: Readonly<Record<string, string>> = Object.freeze({
  ';': 'ponto e vírgula ( ; )',
  ',': 'vírgula ( , )',
  '\t': 'tabulador',
});

/* -------------------------------------------------------------------------- */
/* Mapeamento e interpretação                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Mapeia as colunas e interpreta os valores, devolvendo tudo o que a construção precisa.
 *
 * ## A circularidade no centro disto, e como se resolve
 *
 * Há uma dependência circular real entre o mapeamento e a inferência do tipo:
 *
 * ```
 *   o mapa decide que campos existem  →  a inferência decide o tipo a partir desses campos
 *   o tipo restringe que campos são possíveis  →  o mapa depende do tipo
 * ```
 *
 * Isto não é um defeito do desenho — é a natureza do problema. Um ficheiro com uma coluna
 * `Data` só sabe se ela é `date` ou `recordedAt` depois de se saber se o registo é uma
 * despesa ou uma leitura de quilometragem. A resposta não está no cabeçalho; está no
 * conjunto.
 *
 * Resolve-se em **duas passagens**, e a segunda só existe quando a primeira é ambígua:
 *
 * 1. **Passagem 1 — sem tipo.** Mapeia-se com o dicionário apenas. É o que o utilizador vê
 *    quando nada está decidido, e é conservador: uma coluna que só faça sentido com contexto
 *    fica `ambiguo` em vez de ser adivinhada.
 * 2. **Inferência.** A partir dos campos que a passagem 1 resolveu **sem ambiguidade** —
 *    nunca a partir dos ambíguos, porque inferir a partir de uma decisão por tomar seria
 *    inferir a partir de nada.
 * 3. **Passagem 2 — com o tipo.** Só se um tipo foi determinado (por inferência ou pelo
 *    utilizador). Aqui um candidato fora do vocabulário do tipo deixa de competir, e a
 *    coluna `Data` resolve-se para `recordedAt` sem perguntar nada a ninguém.
 *
 * O custo é mapear duas vezes quando há tipo. O benefício é que a segunda passagem é
 * **determinística e explicável**: não introduz uma heurística nova, apenas aplica a mesma
 * comparação com uma restrição a mais. E quando a passagem 1 já decide tudo — o caso comum
 * de um ficheiro com cabeçalhos explícitos —, a passagem 2 produz exatamente o mesmo
 * resultado e o custo é uma função pura sobre uma lista pequena.
 *
 * ## Porque não se pode simplesmente adiar a interpretação
 *
 * Seria possível mapear uma vez, inferir, e só então interpretar — e é o que se faz para os
 * **valores**. Mas o **tipo do campo** tem de estar decidido antes de se saber que
 * intérprete aplicar: sem ele, não se sabe se `1.234,56` é uma data, um valor ou um texto, e
 * a interpretação não pode começar.
 */
function mapAndInterpret(
  table: RawCsvTable,
  options: PreviewCsvOptions,
): {
  mapping: ColumnMappingResult;
  resolved: readonly ColumnMapping[];
  interpretations: ReadonlyMap<number, ColumnInterpretation>;
  inference: KindInference;
  kind: RecordKind | null;
  valueIssues: readonly RowIssue[];
  valueAmbiguities: readonly ColumnAmbiguity[];
} {
  /* ---- Passagem 1: sem tipo ---- */

  const firstPass = mapColumns(table, { sampleSize: 5 });
  const firstResolution = resolveMapping(firstPass, options.decisions ?? []);

  /*
   * A inferência usa os campos da primeira passagem e **também** o tipo já escolhido pelo
   * utilizador, quando existe.
   *
   * Um tipo forçado vence a inferência — mas a inferência **corre à mesma**, para que a
   * resposta traga as alternativas. Sem elas, o ecrã não teria como mostrar "o que
   * escolheste não é o que os dados sugerem" quando os dois divergem, e o utilizador não
   * teria como reconsiderar sem recarregar o ficheiro.
   */
  const firstFields = fieldsOf(firstResolution.columns);
  const inference = inferRecordKind(firstFields);
  const kind = options.kind ?? inference.kind;

  /* ---- Passagem 2: com o tipo ---- */

  /*
   * `mapColumns` é chamada outra vez com o tipo, e não se reutiliza a primeira passagem.
   *
   * Reutilizá-la pareceria mais barato e estaria errado: `compatibleWithKind` é calculado
   * **durante** o mapeamento, a partir do tipo, e uma coluna já decidida como `ambiguo` na
   * primeira passagem não voltaria a ser avaliada. A coluna `Data` de um ficheiro de
   * quilometragens ficaria ambígua para sempre, e o campo obrigatório `recordedAt` nunca
   * seria preenchido.
   */
  const mapping =
    kind !== null && isCsvSupportedKind(kind) ? mapColumns(table, { sampleSize: 5, kind }) : firstPass;

  const resolution = resolveMapping(mapping, options.decisions ?? [], kind ?? undefined);
  const resolved = resolution.columns;

  const interpretations = new Map<number, ColumnInterpretation>();
  const valueIssues: RowIssue[] = [];
  /*
   * As ambiguidades de valor por resolver, na ordem das colunas.
   *
   * A ordem é a do ficheiro e não a da gravidade: o utilizador lê as perguntas na mesma
   * ordem em que lê as colunas, e uma lista reordenada por "importância" obrigá-lo-ia a
   * encontrar a coluna antes de responder.
   */
  const valueAmbiguities: ColumnAmbiguity[] = [];

  if (kind !== null && isCsvSupportedKind(kind)) {
    for (const column of resolved) {
      if (column.field === null) continue;

      /*
       * Uma coluna ambígua **não é interpretada**. A §10.4 é explícita: o sistema não
       * resolve ambiguidades em silêncio, e interpretar seria resolvê-las — produzir
       * valores que ninguém aprovou. A coluna fica de fora e a interface pede a decisão.
       *
       * Note-se que `resolved` só contém colunas com `field` não nulo, e uma coluna marcada
       * como `ambiguo` só tem `field` depois de uma decisão. A verificação é redundante
       * hoje e documenta a intenção: se o mapeamento futuro passar a atribuir `field` a
       * colunas ambíguas, este `if` continua a proteger a invariante.
       */
      if (column.state === 'ambiguo') continue;

      const rows = table.rows.map((row) => ({
        line: row.line,
        value: row.values[column.index] ?? '',
      }));

      const unitResolution =
        options.resolvedUnits && column.field in options.resolvedUnits
          ? options.resolvedUnits[column.field]
          : undefined;

      const interpretation = interpretColumn(column.field, rows, {
        ...(options.dateOrder ? { dateOrder: options.dateOrder } : {}),
        ...(options.decimalStyle ? { decimalStyle: options.decimalStyle } : {}),
        // `null` e `undefined` significam coisas diferentes para o intérprete: `null` é
        // "o utilizador decidiu ignorar esta coluna", `undefined` é "ninguém decidiu". A
        // distinção é preservada em vez de colapsada.
        ...(unitResolution !== undefined ? { resolvedUnit: unitResolution } : {}),
      });

      interpretations.set(column.index, interpretation);

      /*
       * A ambiguidade é **transportada**, não descartada.
       *
       * `interpretColumn` devolve `ambiguity` quando não consegue decidir sozinho — e a
       * §10.4 manda perguntar. Consumir só `values` e `issues` deixava a ambiguidade pelo
       * caminho: `values` vem vazio (para não gravar uma leitura adivinhada), a linha era
       * marcada como tendo valores ilegíveis, e não havia nada para mostrar nem nada para
       * perguntar. Ver a nota em `CsvMappingView.valueAmbiguities`.
       */
      if (interpretation.ambiguity !== null) {
        valueAmbiguities.push(interpretation.ambiguity);
      }

      for (const issue of interpretation.issues) {
        valueIssues.push({ ...issue, field: column.field });
      }
    }
  }

  return { mapping, resolved, interpretations, inference, kind, valueIssues, valueAmbiguities };
}

/* -------------------------------------------------------------------------- */
/* Interpretação → valores                                                     */
/* -------------------------------------------------------------------------- */

/** Os campos atribuídos num mapa já resolvido. Colunas sem decisão ficam de fora. */
function fieldsOf(columns: readonly ColumnMapping[]): readonly string[] {
  return columns
    .map((column) => column.field)
    .filter((field): field is string => field !== null);
}

/**
 * Extrai os valores interpretados de uma coluna.
 *
 * Uma coluna com ambiguidade por resolver tem `values` vazio — e é isso que faz os valores
 * ambíguos **desaparecerem** em vez de serem escritos como "a hipótese preferida". A
 * construção desses registos falha a obrigatoriedade e a linha é declarada em falta, o que
 * é o comportamento correto: melhor dizer "falta a data" do que escrever 3 de abril quando
 * o ficheiro dizia 4 de março.
 */
function valuesByColumn(
  interpretations: ReadonlyMap<number, ColumnInterpretation>,
): ReadonlyMap<number, ReadonlyMap<number, string | number | boolean>> {
  const byColumn = new Map<number, ReadonlyMap<number, string | number | boolean>>();
  for (const [index, interpretation] of interpretations) {
    byColumn.set(index, interpretation.values);
  }
  return byColumn;
}

/* -------------------------------------------------------------------------- */
/* Pré-visualização                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Constrói a amostra normalizada, com os campos em falta já calculados.
 *
 * ## O que uma pré-visualização é, e o que não é
 *
 * É uma **amostra dos registos reais**, não uma amostra das linhas do ficheiro. A
 * diferença importa: mostrar a linha crua diria ao utilizador o que ele já sabe (o
 * ficheiro que escolheu) e esconderia o que ele precisa de ver (o que vai ser escrito).
 * Os campos vazios aparecem nomeados porque a §9.2 exige que a lacuna seja declarada
 * antes, e não descoberta depois no relatório.
 */
function buildPreview(
  records: readonly CanonicalRecord[],
  kind: RecordKind | null,
  limit: number,
): readonly CsvRecordPreview[] {
  if (kind === null) return [];
  const required = requiredFieldsFor(kind);

  return records.slice(0, limit).map((record) => ({
    localId: record.localId,
    line: record.line ?? 0,
    kind: record.kind,
    fields: record.fields,
    emptyFields: emptyFieldsFor(record, required),
  }));
}

/* -------------------------------------------------------------------------- */
/* A função principal                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Analisa um CSV e devolve tudo o que o ecrã de confirmação precisa. **Não escreve nada.**
 *
 * ## Os doze passos, na forma de código
 *
 * ```
 *   1. bytes → codificação          detectEncoding
 *   2. texto → tabela               parseCsv          (separador, cabeçalho)
 *   3. tabela → mapeamento          mapColumns
 *   4. decisões → mapa resolvido    resolveMapping
 *   5. campos → tipo                inferRecordKind
 *   6. colunas → valores            interpretColumn
 *   7. mapa+valores → registos      buildCanonicalRecords
 *   8. registos → problemas         validateRecords   ← núcleo Camada 1
 *   9. (conta) → estado             readAccountState  ← núcleo Camada 1
 *  10. registos+estado → plano      buildPlan         ← núcleo Camada 1
 * ```
 *
 * Os passos 8–10 são o núcleo. Este ficheiro **não** os implementa: chama-os. É essa
 * chamada — e não uma reimplementação — que faz o CSV e o bundle nativo aceitarem
 * exatamente os mesmos dados e produzirem exatamente o mesmo plano para os mesmos dados,
 * que é o que a §4.3 exige.
 */
export async function previewCsv(options: PreviewCsvOptions): Promise<CsvPreview> {
  const { bytes, userId, prisma } = options;

  /* ---- Passos 1 e 2: codificação e tabela ---- */

  /*
   * `parseCsv` recebe **bytes** e faz a deteção de codificação por dentro — é ele o dono
   * dessa decisão, e o `RawCsvTable` que devolve já traz a codificação escolhida, a sua
   * confiança e a razão (`encoding`, `encodingConfidence`, `encodingUncertain`,
   * `encodingReason`).
   *
   * Chamar `detectEncoding` aqui e passá-lo como `options.encoding` forçaria a codificação
   * detetada — o que é diferente de a **pedir**: o `options.encoding` do parser existe para
   * o utilizador dizer "este ficheiro é CP1252" contra a evidência, e usá-lo com o resultado
   * da própria deteção seria um no-op que confundiria os dois caminhos. Além disso, obrigaria
   * a descodificar duas vezes: uma para o `detectEncoding`, outra dentro do `parseCsv`.
   */
  const table = parseCsv(bytes, {
    ...(options.maxRows !== undefined ? { maxRows: options.maxRows } : {}),
  });

  /* ---- Passos 3–6: mapeamento, tipo e valores ---- */

  const { mapping, resolved, interpretations, inference, kind, valueIssues, valueAmbiguities } =
    mapAndInterpret(table, options);

  /* ---- Passo 7: registos canónicos ---- */

  /*
   * O `sourceId` é o hash do conteúdo, e não o `userId`: o `localId` tem de ser estável
   * para o mesmo ficheiro importado pela mesma pessoa, e incluir o utilizador tornaria os
   * identificadores diferentes entre contas — o que não faz mal — mas também faria uma
   * exportação e uma reimportação noutra conta produzirem `localId` diferentes para o mesmo
   * registo. Como o livro é chaveado por `userId`, o utilizador já está na chave; aqui
   * basta o conteúdo.
   *
   * Usar o **hash** e não o nome do ficheiro é o que faz `export.csv` e `export (1).csv`
   * serem reconhecidos como o mesmo ficheiro: o conteúdo é o mesmo, e a idempotência deve
   * proteger contra a duplicação independentemente de como o sistema operativo renomeou o
   * ficheiro ao descarregá-lo.
   */
  const contentHash = sha256Hex(bytes);
  const identity: CsvImportIdentity = {
    key: `csv_${userId}_${contentHash}${kind ? `_${kind}` : ''}`,
    contentHash,
  };

  const built: BuildRecordsResult =
    kind !== null && isCsvSupportedKind(kind)
      ? buildCanonicalRecords(table, {
          kind,
          columns: resolved,
          interpreted: valuesByColumn(interpretations),
          sourceId: contentHash.slice(0, 12),
          valueIssues,
        })
      : { records: [], skipped: [], issues: [] };

  /* ---- Passo 8: validação — núcleo da Camada 1 ---- */

  /*
   * `validateRecords` é chamada com os mesmos argumentos com que o `read.ts` a chama. Não
   * há um ramo para CSV: o Validator não sabe — nem deve saber — de onde os registos
   * vieram (§4.3). Se soubesse, teríamos duas políticas de validação, e a do CSV seria a
   * permissiva.
   */
  const validation = validateRecords(built.records as CanonicalRecord[]);

  /* ---- Passo 9: estado da conta — núcleo da Camada 1 ---- */

  /*
   * Mesma ordem do `read.ts`, e pela mesma razão documentada lá: a tradução de veículos
   * precisa dos veículos do ficheiro já normalizados. Um CSV pode trazer veículos (uma
   * tabela de frota) e, nesse caso, os registos dependentes têm de escrever o
   * `vehicleLocalId` na linguagem do ficheiro — não no `cuid` da base de dados.
   */
  const vehicleLocalId = vehicleIdTranslator(
    await prisma.vehicle.findMany({ where: { userId }, select: { id: true, plate: true } }),
    built.records.filter((record) => record.kind === 'vehicle'),
  );

  const state = await readAccountState(prisma, userId, vehicleLocalId);
  const importedLocalIds = await readImportedLocalIds(prisma, userId, identity.key);

  /* ---- Passo 10: plano — núcleo da Camada 1 ---- */

  const plan = buildPlan({
    records: built.records as CanonicalRecord[],
    state: {
      ...state,
      ...(importedLocalIds ? { importedLocalIds } : {}),
    },
    validationIssues: validation.issues,
    /*
     * Os problemas do ficheiro entram como `info`, e a escolha é deliberada: uma aspa por
     * fechar ou uma linha curta **não impedem** a importação — o parser recupera, e a lista
     * de registos já mostra o resultado dessa recuperação. Classificá-los como `recoverable`
     * sugeriria uma reparação a fazer pelo utilizador, e não há nenhuma: o ficheiro está
     * como está. O que ele precisa é de saber que a recuperação aconteceu, para poder
     * decidir se confia na pré-visualização.
     *
     * `blocking` seria francamente errado: bloquearia a importação de um ficheiro que o
     * utilizador não tem forma de corrigir a partir daqui, num mecanismo que existe
     * precisamente para aceitar ficheiros arbitrários.
     */
    bundleIssues: table.issues.map((issue) => ({
      severity: 'info' as const,
      code: issue.code,
      message: issue.message,
      ...(issue.line !== undefined ? { line: issue.line } : {}),
    })),
    bundleBlocked: validation.blocked,
    ...(options.conflictPolicy ? { conflictPolicy: options.conflictPolicy } : {}),
    ...(kind ? { scopeNote: `Ficheiro CSV — ${kind}` } : {}),
  });

  /* ---- Resultado ---- */

  const required = kind !== null ? requiredFieldsFor(kind) : [];

  return {
    identity,
    detection: describeDetection(table),
    mapping: {
      columns: resolved,
      ambiguousColumns: resolved.filter((column) => column.state === 'ambiguo'),
      unmappedColumns: resolved.filter((column) => column.state === 'nao_mapeado'),
      coverage: mapping.coverage,
      /*
       * Uma ambiguidade de valor também impede o avanço sem resposta: as linhas afetadas não
       * produzem registos, porque o intérprete devolve `values` vazio em vez de gravar uma
       * leitura adivinhada. Deixar `readyWithoutInput` a `true` faria o ecrã avançar para
       * uma revisão vazia e dizer ao utilizador que estava tudo resolvido — quando não
       * estava. É a mesma regra que já se aplica à inferência do tipo.
       */
      readyWithoutInput:
        mapping.readyWithoutInput &&
        inference.state !== 'ambiguo' &&
        valueAmbiguities.length === 0,
      requiredFields: required,
      valueAmbiguities,
    },
    inference,
    kind,
    records: built.records as CanonicalRecord[],
    preview: buildPreview(built.records as CanonicalRecord[], kind, options.previewLimit ?? PREVIEW_ROWS),
    skipped: built.skipped,
    valueIssues: built.issues,
    plan,
    /*
     * A razão de nada ter sido construído é reescrita quando a causa é uma ambiguidade.
     *
     * `describeEmptyResult` olha para as linhas ignoradas e conclui «valores ilegíveis» —
     * verdade para `31/02/2026`, falso para `1,589`. Os valores ambíguos são **legíveis**:
     * só têm mais do que uma leitura. Dizer ao utilizador para corrigir o ficheiro quando
     * o que ele tem de fazer é responder a uma pergunta é mandá-lo para o sítio errado, e a
     * §11.3 proíbe um ecrã que não diga o que fazer a seguir.
     */
    emptyReason: describeEmptyResult(built, valueAmbiguities),
  };
}

/* -------------------------------------------------------------------------- */
/* Identidade do conteúdo                                                      */
/* -------------------------------------------------------------------------- */

/**
 * `sha256` dos bytes, em hexadecimal.
 *
 * ## Porque é que o hash é calculado aqui e não no `domain`
 *
 * O `domain/import/csv/` é puro: não usa `node:crypto`, não depende do ambiente, e é
 * testável sem infraestrutura. O hash é uma preocupação de **identidade de operação** —
 * serve a chave do livro e o `localId` —, e o livro vive nos serviços. Manter o `crypto`
 * aqui preserva a pureza do domínio, que é o que permite testar o parser com uma string e
 * não com um ficheiro.
 */
function sha256Hex(bytes: Uint8Array): string {
  // `node:crypto` é do runtime, não do domínio: o `domain/import/csv/` continua puro e
  // testável com strings. O hash pertence a quem gere a identidade da operação.
  return createHash('sha256').update(bytes).digest('hex');
}

/* -------------------------------------------------------------------------- */
/* Reexportações                                                               */
/* -------------------------------------------------------------------------- */

export type {
  ColumnMapping,
  ColumnMappingResult,
  KindInference,
  DateOrder,
  DecimalStyle,
  CanonicalRecord,
  RowIssue,
  RawCsvTable,
  ValueIssue,
};
