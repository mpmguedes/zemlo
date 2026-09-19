/**
 * Construção de `CanonicalRecord` a partir de uma tabela CSV (§4.3, §10.2).
 *
 * Este é o **adaptador**: o único ponto do importador de CSV que conhece o contrato de
 * domínio. A partir daqui, tudo o que acontece é o núcleo da Camada 1 — o mesmo
 * Normalizer, Validator, Deduplicator, Plan, Apply, Report e Transaction que já servem o
 * bundle nativo do Zemlo.
 *
 * ## O que este ficheiro não faz, e porque é o mais importante
 *
 * Não valida regras de negócio. Não deduplica. Não constrói planos. Não escreve.
 *
 * Todas essas coisas já existem e são **as mesmas** para os dois adaptadores. Se este
 * ficheiro as repetisse — mesmo que parecesse mais simples — teríamos duas implementações
 * da mesma invariante, e a segunda seria a que ninguém revisita quando a primeira muda.
 * Seria também a forma mais fácil de o CSV e o bundle passarem a aceitar dados diferentes,
 * que é exatamente o que a §4.3 proíbe.
 *
 * A sua responsabilidade única é a tradução: **linha de tabela → `CanonicalRecord`**.
 *
 * ## Porque é que os valores já chegam interpretados
 *
 * A interpretação de valores (datas, decimais, moedas) vive em `values.ts` e é feita por
 * **coluna**, antes de chegar aqui. Um valor ambíguo nunca chega a este ficheiro: a coluna
 * ambígua não é mapeada, portanto não há valor a traduzir. É isso que garante que nada
 * aqui adivinha.
 */

import { isValidLocalId, LOCAL_ID_MAX_LENGTH } from '../ids.js';
import { normalizePlateForCompare } from '../normalize.js';
import { dedupeKeysFor } from '../plan.js';
import type { CanonicalRecord, RecordKind } from '../validate.js';
import type { ColumnMapping } from './mapping.js';
import type { RawCsvTable } from './parse.js';
import type { ValueIssue } from './values.js';

/* -------------------------------------------------------------------------- */
/* Vocabulário                                                                 */
/* -------------------------------------------------------------------------- */

/** Uma linha que não pôde ser convertida num registo. */
export interface SkippedRow {
  /** Linha do ficheiro original (1-based). */
  readonly line: number;
  readonly reason: string;
}

/** Problemas encontrados durante a construção, por linha. */
export interface RowIssue {
  readonly line: number;
  readonly field: string;
  readonly code: ValueIssue['code'];
  readonly message: string;
  /** O valor original, para o relatório o poder mostrar. */
  readonly raw: string;
}

/** Resultado da construção de registos. */
export interface BuildRecordsResult {
  readonly records: readonly CanonicalRecord[];
  /** Linhas ignoradas, com o motivo — nunca em silêncio. */
  readonly skipped: readonly SkippedRow[];
  /** Valores ilegíveis, herdados da interpretação. */
  readonly issues: readonly RowIssue[];
}

export interface BuildRecordsOptions {
  /** Tipo de registo a construir. Já decidido (inferido ou escolhido pelo utilizador). */
  readonly kind: RecordKind;
  /** Mapa de colunas já resolvido. Colunas ambíguas não devem estar aqui. */
  readonly columns: readonly ColumnMapping[];
  /** Valores interpretados: `índice de coluna → (linha → valor)`. */
  readonly interpreted: ReadonlyMap<number, ReadonlyMap<number, string | number | boolean>>;
  /**
   * Prefixo do `localId` gerado. Por omissão, deriva do tipo pela tabela partilhada.
   *
   * O `localId` **tem** de ser estável entre importações do mesmo ficheiro: é a chave da
   * idempotência (§9.5). Gerar um identificador aleatório faria a mesma importação
   * repetida criar registos duplicados, que é precisamente o que o livro existe para
   * impedir.
   */
  readonly localIdPrefix?: string;
  /** Identificador da origem, incluído no `localId` para o tornar único. */
  readonly sourceId: string;
  /** Problemas de interpretação a preservar no resultado, já associados à sua coluna. */
  readonly valueIssues?: readonly FieldValueIssue[];
}

/**
 * Um problema de interpretação com o campo a que pertence.
 *
 * A coluna faz parte da mensagem porque, sozinha, uma `ValueIssue` diz "linha 12: valor
 * ilegível" — e o utilizador fica sem saber qual das dez colunas corrigir.
 */
export interface FieldValueIssue {
  readonly line: number;
  readonly field: string;
  readonly code: ValueIssue['code'];
  readonly message: string;
  readonly raw: string;
}

/* -------------------------------------------------------------------------- */
/* Construção                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Constrói `CanonicalRecord` a partir de uma tabela e do seu mapa de colunas.
 *
 * Uma linha só é ignorada quando **todos** os valores mapeados estão vazios. Uma linha com
 * um valor ilegível é ignorada com motivo declarado, e não parcialmente construída: um
 * registo a que falta a data seria uma lacuna silenciosa, e a §9.2 exige que a lacuna seja
 * declarada. A declaração é feita aqui, em `skipped`, e não mais tarde.
 */
export function buildCanonicalRecords(
  table: RawCsvTable,
  options: BuildRecordsOptions,
): BuildRecordsResult {
  const { kind, columns, interpreted, sourceId } = options;

  const assigned = columns.filter(
    (column): column is ColumnMapping & { field: string } => column.field !== null,
  );

  const prefix = options.localIdPrefix ?? defaultPrefix(kind);
  const records: CanonicalRecord[] = [];
  const skipped: SkippedRow[] = [];
  const issues: RowIssue[] = [];

  /*
   * Matrículas vistas no ficheiro, por forma canónica.
   *
   * Serve dois propósitos e é por isso um mapa e não uma lista: (1) descobrir que veículos
   * são referenciados mas não descritos, para lhes sintetizar a ficha; (2) dar a todas as
   * linhas do mesmo veículo a **mesma** aresta. A alternativa — derivar o `localId` da
   * linha atual — criaria um veículo por linha de abastecimento, que é o pior resultado
   * possível e não daria erro nenhum.
   *
   * A chave é a matrícula **canónica**, porque é a forma que o núcleo compara: `AA-00-BB` e
   * `AA00BB` são o mesmo veículo, e tratá-las como dois seria duplicar a frota.
   */
  const plateRefs = new Map<string, PlateReference>();

  /** `localId` do veículo que **descreve** cada matrícula, quando o ficheiro o traz. */
  const describedVehicles = new Map<string, string>();

  for (const issue of options.valueIssues ?? []) {
    /*
     * O problema é transportado **inteiro** — `code` e `raw` incluídos.
     *
     * A tentação era guardar só `line` e `message`, que é o que uma lista de erros mostra.
     * Mas o `raw` é o que permite ao relatório dizer *"o valor «muito caro» na coluna
     * Valor não foi reconhecido"* em vez de *"valor ilegível"* — e o `code` é o que permite
     * à interface escolher um remédio diferente para "não é um número" e para "está fora do
     * intervalo". Descartá-los aqui obrigaria a reconstruí-los mais tarde, a partir de nada.
     */
    issues.push({
      line: issue.line,
      field: issue.field,
      code: issue.code,
      message: issue.message,
      raw: issue.raw,
    });
  }

  // Índice de `localId` já usado nesta construção — dois registos com o mesmo `localId`
  // colidiriam no livro de idempotência, e a colisão seria silenciosa.
  const usedLocalIds = new Set<string>();

  for (const row of table.rows) {
    const fields: Record<string, unknown> = {};
    let hasValue = false;
    let blocked = false;
    // Texto cru da célula da matrícula, quando existe. É o único sítio onde a forma que o
    // ficheiro escreveu (`AA-00-BB`) sobrevive à interpretação — que já devolve o valor
    // convertido. Sem isto, `plateDisplay` acabaria igual ao `plate` canónico. Ver
    // `canonicalizeFields`.
    let plateSource: string | undefined;

    for (const column of assigned) {
      const value = interpreted.get(column.index)?.get(row.line);

      if (value !== undefined) {
        fields[column.field] = value;
        hasValue = true;
        if (column.field === 'plate' && typeof value === 'string') {
          plateSource = row.values[column.index] ?? value;
        }
        continue;
      }

      // Sem valor interpretado: a coluna pode simplesmente estar vazia nesta linha
      // (legítimo) ou o valor pode ter sido ilegível (já reportado em `issues`).
      const raw = row.values[column.index];
      if (raw !== undefined && raw.trim() !== '') {
        // Havia texto e não há valor interpretado: o valor foi rejeitado.
        blocked = true;
      }
    }

    if (!hasValue && !blocked) {
      // Linha sem qualquer valor mapeado — não é um erro, é uma linha vazia.
      continue;
    }

    if (blocked) {
      skipped.push({
        line: row.line,
        reason: 'Um ou mais valores desta linha não puderam ser interpretados.',
      });
      continue;
    }

    /*
     * Canonicalização de campos que o núcleo compara.
     *
     * ── Porque é que isto existe aqui, e não no núcleo ──
     *
     * O adaptador do bundle passa por `normalizeRecords`, que além de traduzir os nomes
     * dos campos aplica duas transformações: a **coerção de tipo** (feita aqui pelos
     * intérpretes de `values.ts`) e a **canonicalização da matrícula**.
     *
     * O CSV não passa por `normalizeRecords` — não precisa, porque o mapeamento já produz
     * nomes de domínio — mas isso deixava a matrícula por canonizar. E a matrícula é a
     * **identidade do veículo** (A14/A25) e a chave de deduplicação de todos os registos
     * que lhe estão ligados.
     *
     * ── O defeito que isto corrige, e porque era invisível ──
     *
     * O `plan.ts` lê `fields.plate` diretamente como chave (`vehicleKeys`), contando com o
     * normalizador para o ter canonicalizado. Sem esta passagem, um CSV com `AA-00-BB`
     * produzia `plate: "AA-00-BB"` enquanto o bundle — e a base de dados — têm `"AA00BB"`.
     * As duas strings nunca coincidiam, e o efeito era:
     *
     *  - **reimportar o mesmo ficheiro duplicava a frota**. O livro de idempotência
     *    protegia a reimportação *do mesmo conteúdo*, mas bastava o ficheiro ser editado
     *    (uma linha acrescentada) para o hash mudar e a proteção desaparecer — e aí cada
     *    veículo era criado outra vez;
     *  - **exportar e reimportar duplicava tudo**, que é o caso mais comum de todos;
     *  - e nada disto dava erro. O plano dizia "criar", que é o que ele diria para veículos
     *    genuinamente novos.
     *
     * É precisamente o tipo de falha que a §4.3 existe para prevenir, e que só foi
     * detetada porque o teste de equivalência compara os dois caminhos campo a campo em
     * vez de verificar "importou N registos".
     */
    canonicalizeFields(kind, fields, plateSource);

    /*
     * Registo da matrícula, antes de a linha poder ser descartada.
     *
     * A ordem importa: a matrícula é registada mesmo que a linha venha a falhar por outro
     * motivo (um `localId` inválido, por exemplo). Se só fosse registada nas linhas que
     * vingam, um ficheiro cujas primeiras linhas falhassem produziria veículos sintéticos
     * com `localId` derivado da linha errada — e a aresta deixaria de coincidir com a ficha.
     * O `firstLine` tem de ser o da **primeira aparição no ficheiro**, tenha a linha
     * vingado ou não.
     */
    const canonicalPlate = typeof fields.plate === 'string' ? fields.plate : undefined;
    if (canonicalPlate !== undefined && canonicalPlate !== '') {
      const existing = plateRefs.get(canonicalPlate);
      if (existing === undefined) {
        /*
         * A forma legível vem do **texto cru da célula** primeiro, e só depois do
         * `plateDisplay` já construído.
         *
         * A ordem não é arbitrária: fora da ficha de veículo, `canonicalizeFields` não
         * escreve `plateDisplay` (§4.3 — não é campo de um abastecimento), portanto num
         * ficheiro de quilometragens este `fields.plateDisplay` está sempre ausente e o
         * recurso seria `canonicalPlate`. A ficha sintetizada herda o que aqui se
         * registar, e é ela que o utilizador vê no ecrã — daí `plateSource` vir primeiro.
         */
        plateRefs.set(canonicalPlate, {
          display: plateSource ?? (typeof fields.plateDisplay === 'string' && fields.plateDisplay !== ''
            ? fields.plateDisplay
            : canonicalPlate),
          firstLine: row.line,
        });
      }
    }

    const localId = makeLocalId(prefix, sourceId, row.line);
    // O comprimento é lido **antes** do type guard: `isValidLocalId` é um predicado
    // (`value is string`), e no ramo negativo o TypeScript estreita `localId` para
    // `never` — onde `.length` deixaria de existir.
    const localIdLength = localId.length;

    if (!isValidLocalId(localId)) {
      skipped.push({
        line: row.line,
        reason: `Não foi possível gerar um identificador válido para esta linha (${localIdLength} carateres).`,
      });
      continue;
    }

    if (usedLocalIds.has(localId)) {
      // Não deve acontecer com um `sourceId` estável, mas se acontecer é melhor ignorar
      // a linha do que construir dois registos com a mesma chave de idempotência.
      skipped.push({
        line: row.line,
        reason: 'Esta linha produziria um identificador já usado por outra linha.',
      });
      continue;
    }

    usedLocalIds.add(localId);

    /*
     * Se esta linha **descreve** um veículo, é o `localId` dela que todas as arestas para
     * essa matrícula passam a usar. Registar antes de construir o registo não é possível
     * (o `localId` só existe aqui), e registar depois da construção seria tarde para as
     * linhas já processadas — mas um ficheiro de veículos não tem linhas dependentes antes
     * das fichas, e um ficheiro misto tem a ficha antes do primeiro registo que a usa.
     *
     * Se a ordem for a inversa, o resultado não é um erro: é o veículo sintético com o
     * `localId` da primeira linha **de matrícula** e, mais tarde, a ficha com o seu próprio
     * `localId`. Dois `localId` para o mesmo veículo não criam dois veículos — a
     * deduplicação por matrícula apanha-os e o segundo enriquece o primeiro.
     */
    if (kind === 'vehicle' && canonicalPlate !== undefined && canonicalPlate !== '') {
      describedVehicles.set(canonicalPlate, localId);
    }

    records.push({
      kind,
      localId,
      file: 'import.csv',
      line: row.line,
      fields,
      references: referencesFor(kind, fields, localId, plateRefs, describedVehicles, sourceId),
    });
  }

  /*
   * ── Duplicados dentro do próprio ficheiro ──
   *
   * ## Porque é que isto tem de ser feito aqui, e não no núcleo
   *
   * O `buildPlan` compara cada registo contra o **estado da conta** — nunca contra os
   * outros registos do mesmo lote. Para o bundle isso é suficiente e correto: uma
   * exportação do Zemlo não contém duplicados, porque vem de uma base de dados com
   * restrições. E é por isso que a regra **não** pertence ao `plan.ts`: acrescentar-lhe uma
   * comparação intra-lote mudaria o comportamento do bundle, que está fechado e validado,
   * para servir um caso que o bundle não tem.
   *
   * Uma folha de cálculo é outra coisa: linhas duplicadas são a norma. Alguém copia uma
   * linha para repetir um padrão e esquece-se de a editar; alguém concatena dois ficheiros
   * com uma linha de sobreposição; alguém exporta duas vezes o mesmo mês. Nenhum destes
   * casos é um erro do utilizador — são a realidade do formato.
   *
   * ## O que acontece sem isto
   *
   * Com três linhas de `1.000 km` no mesmo dia, o plano diz "criar 3" e o `apply` cria três
   * leituras de odómetro idênticas. O utilizador vê a quilometragem a saltar para o triplo
   * nos gráficos, sem nada no relatório que explique porquê — porque, do ponto de vista do
   * núcleo, as três eram genuinamente novas.
   *
   * ## Porque é que se ignora a linha em vez de a assinalar
   *
   * A linha duplicada não é um erro a corrigir: é ruído a descartar. O que o utilizador
   * precisa é de saber que foi descartado, e é isso que `skipped` dá — com a linha e o
   * motivo. Assinalá-la como `probable` exigiria uma decisão do utilizador por cada
   * duplicado trivial, e a §11.2 avisa que isso ensina a confirmar sem ler.
   *
   * ## A chave é o **conteúdo**, não o `localId`
   *
   * O `localId` inclui o número de linha, pelo que nunca colide. A identidade de conteúdo é
   * a mesma que o núcleo usa para a deduplicação (`dedupeKeysFor`) — usar outra seria criar
   * uma segunda noção de "o mesmo registo" no mesmo projeto, e as duas divergiriam.
   */
  const deduplicated = dropIntraFileDuplicates(records, skipped);

  /*
   * Veículos referenciados mas não descritos no ficheiro.
   *
   * Um CSV de abastecimentos de uma só matrícula traz `AA-00-BB` em todas as linhas e
   * **nenhuma** ficha de veículo — a coluna `Matrícula` é uma referência, não um registo.
   * Sem isto, cada abastecimento ficava com `vehicleLocalId` a apontar para um veículo que
   * nunca é criado, e a §9.4 classifica uma referência quebrada como **bloqueante**: a
   * importação inteira pararia, e o utilizador não teria como a desbloquear a partir do
   * ficheiro (a ficha do veículo não vem nele).
   *
   * A alternativa era recusar o ficheiro com "falta a ficha do veículo". Seria tecnicamente
   * correto e praticamente inútil: quem exporta despesas de um carro não tem um ficheiro de
   * veículos, e exigir-lho faria do importador uma ferramenta que não serve o caso mais
   * comum. A ficha é criada a partir da matrícula, que é a identidade do veículo (A14/A25).
   *
   * ## Porque é que isto não é inventar dados
   *
   * A matrícula é o único campo e vem do ficheiro. Os restantes ficam ausentes — e é isso
   * que a §9.2 prevê: um veículo com dados incompletos é a norma, e o Zemlo pede os campos
   * em falta no ecrã do veículo, com contexto, em vez de os inventar na importação.
   *
   * Só acontece quando o tipo **não** é `vehicle`: se o ficheiro descreve veículos, são
   * esses que mandam, e acrescentar fichas sintéticas criaria duplicados.
   */
  const synthesized: CanonicalRecord[] = [];

  if (kind !== 'vehicle') {
    for (const [plateKey, reference] of plateRefs) {
      // Já existe um registo de veículo que cobre esta matrícula: é ele o referido.
      if (describedVehicles.has(plateKey)) continue;

      const vehicleLocalId = makeLocalId('veh', sourceId, reference.firstLine);

      synthesized.push({
        kind: 'vehicle',
        localId: vehicleLocalId,
        file: 'import.csv',
        // A linha onde a matrícula apareceu pela primeira vez — é onde o utilizador a vê.
        line: reference.firstLine,
        fields: {
          plate: plateKey,
          // A forma legível é o que o ficheiro escreveu, não a forma canónica: mostrar
          // `AA00BB` a quem escreveu `AA-00-BB` seria perder informação que existia.
          plateDisplay: reference.display,
        },
        references: {},
      });
    }
  }

  /*
   * Os veículos sintéticos entram **primeiro**, e a ordem não é arbitrária: o `apply`
   * percorre o plano por ordem e resolve as referências pelo mapa de `localId` já criados.
   * Um abastecimento que aponte para um veículo criado depois dele encontraria o mapa
   * vazio e a referência falharia. O `plan.ts` ordena por dependência, mas depender dessa
   * ordenação para uma referência que **este** ficheiro introduz seria confiar num
   * comportamento que não é o deste módulo.
   */
  return { records: [...synthesized, ...deduplicated], skipped, issues };
}

/* -------------------------------------------------------------------------- */
/* Duplicados dentro do ficheiro                                               */
/* -------------------------------------------------------------------------- */

/**
 * Remove registos cujo conteúdo já apareceu numa linha anterior do mesmo ficheiro.
 *
 * ## O critério
 *
 * Dois registos são o mesmo quando partilham **todas** as chaves de deduplicação
 * (`dedupeKeysFor`) — a mesma noção de identidade que o núcleo aplica contra a conta. Um
 * registo sem chaves (um dado insuficiente para ser identificado) **nunca** é tratado como
 * duplicado de outro: sem chave não há identidade, e agrupar dois registos sem identidade
 * seria juntar dois registos diferentes por serem ambos incompletos.
 *
 * ## A conservação é deliberada: fica o primeiro
 *
 * Não o "melhor" nem o "mais completo". Comparar campos para escolher qual manter exigiria
 * decidir o que é "melhor" — e essa decisão não está na especificação. A primeira
 * ocorrência é a regra mais simples que o utilizador consegue prever, e é a que corresponde
 * ao que ele vê: a linha que aparece primeiro é a que fica.
 *
 * ## O que não é feito
 *
 * Não se assinala como conflito, e não se pede decisão. Uma linha repetida num ficheiro não
 * é um problema a resolver: é um duplicado a descartar, e o relatório diz quantos e quais.
 * Pedir uma decisão por cada um transformaria uma importação de rotina num formulário.
 */
function dropIntraFileDuplicates(
  records: readonly CanonicalRecord[],
  skipped: SkippedRow[],
): CanonicalRecord[] {
  const kept: CanonicalRecord[] = [];
  /** Assinatura de conteúdo já vista → linha onde apareceu. */
  const seen = new Map<string, number>();

  for (const record of records) {
    const signature = contentSignature(record);

    /*
     * Sem chaves não há assinatura, e sem assinatura não há duplicado possível. O registo
     * passa — o Validator dirá o que lhe falta, que é o sítio certo para o dizer.
     */
    if (signature === null) {
      kept.push(record);
      continue;
    }

    const firstLine = seen.get(signature);

    if (firstLine === undefined) {
      seen.set(signature, record.line ?? 0);
      kept.push(record);
      continue;
    }

    skipped.push({
      line: record.line ?? 0,
      reason:
        `Linha repetida: o mesmo registo já aparece na linha ${firstLine}. ` +
        'Fica a primeira ocorrência.',
    });
  }

  return kept;
}

/**
 * Assinatura de conteúdo de um registo, ou `null` quando não é identificável.
 *
 * ## Porque é que não se usa o `dedupeKeysFor` diretamente
 *
 * Usa-se, mas o resultado é **normalizado numa string ordenada**. As chaves vêm como uma
 * lista de objetos com `kind`, `level`, `value` e `fields`, e comparar os objetos exigiria
 * uma comparação profunda. A assinatura é a forma canónica de os comparar: a mesma lista
 * produz sempre a mesma string, e listas diferentes produzem strings diferentes.
 *
 * ## Porque é que a `stable` e não a `value`
 *
 * A chave de uma despesa com tolerância de valor tem uma `value` que inclui a distância
 * medida, e duas despesas a 2 cêntimos de distância teriam `value` diferentes. A `stable` é
 * a forma declarada **estável** da mesma chave — é ela que representa "o mesmo registo
 * segundo esta chave", que é exatamente a pergunta.
 */
function contentSignature(record: CanonicalRecord): string | null {
  const keys = dedupeKeysFor(record);
  if (keys.length === 0) return null;

  return keys
    .map((key) => `${key.kind}:${key.level}:${key.stable}`)
    .sort()
    .join('|');
}

/* -------------------------------------------------------------------------- */
/* Referências                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Campos de referência reconhecidos, por tipo de registo.
 *
 * ## O que é uma referência, e porque não é um campo
 *
 * Uma referência liga dois registos **dentro do mesmo ficheiro** por `localId` (§5.5), e é
 * o `apply` que a traduz para a chave primária. Um campo como `plate` é um *valor*; um
 * `vehicleLocalId` é uma *aresta*.
 *
 * ## Porque é que a lista está aqui e não no `registry`
 *
 * A `REFERENCE_FIELDS` do `normalize-records.ts` é a autoridade para o **bundle**, e não é
 * importada aqui de propósito: o bundle recebe estas referências já escritas pelo
 * exportador (é ele que as gera), enquanto o CSV tem de as **derivar** de uma coluna de
 * matrícula. São duas origens diferentes da mesma aresta, e a segunda tem regras próprias
 * (uma matrícula pode ser partilhada por várias linhas; um `localId` de bundle não).
 *
 * A única que o CSV deriva hoje é a do veículo — todas as outras referências do bundle
 * (`recordLocalId`, `linkedRecordLocalId`, `documentLocalId`) ligam registos que um
 * utilizador não tem num ficheiro plano, e derivá-las exigiria colunas que não existem em
 * nenhuma exportação.
 */
const CSV_REFERENCE_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  odometer: ['vehicleLocalId'],
  expense: ['vehicleLocalId'],
  fuel: ['vehicleLocalId'],
  charging: ['vehicleLocalId'],
  maintenance: ['vehicleLocalId'],
  insurance: ['vehicleLocalId'],
  inspection: ['vehicleLocalId'],
  tax: ['vehicleLocalId'],
  document: ['vehicleLocalId'],
  reminder: ['vehicleLocalId'],
});

/**
 * Constrói o objeto `references` de um registo.
 *
 * ## Porque é que o valor entra também em `fields` (A27)
 *
 * O `dedupeKeysFor` procura `vehicleLocalId` nos **campos** para compor a chave de uma
 * despesa: é ele que impede que duas despesas iguais em veículos diferentes coincidam. O
 * `normalizeRecords` escreve-o nos dois sítios pela mesma razão, e a omissão de um dos dois
 * produziria a mesma falha em sítios diferentes — ou uma referência por resolver na
 * escrita, ou uma chave de deduplicação que ignora o veículo.
 *
 * ## A matrícula como referência
 *
 * Uma coluna `Matrícula` num CSV de abastecimentos é, para o domínio, a **aresta** para o
 * veículo — e o `localId` dessa aresta tem de ser o do registo de veículo. Como o veículo
 * pode ser descrito no próprio ficheiro (uma ficha) ou apenas referido (uma matrícula
 * repetida), o `localId` é calculado de forma determinística a partir da matrícula
 * canónica e da **primeira linha onde ela aparece** — a mesma fórmula que a ficha
 * sintética usa, para que os dois casos coincidam.
 */
function referencesFor(
  kind: RecordKind,
  fields: Record<string, unknown>,
  localId: string,
  plateRefs: ReadonlyMap<string, PlateReference>,
  describedVehicles: ReadonlyMap<string, string>,
  sourceId: string,
): Record<string, string> {
  const names = CSV_REFERENCE_FIELDS[kind];
  if (!names || names.length === 0) return {};

  const plate = typeof fields.plate === 'string' ? fields.plate : undefined;
  if (plate === undefined || plate === '') return {};

  /*
   * A ficha do ficheiro manda; sem ela, a ficha sintética.
   *
   * As duas fórmulas coincidem quando a matrícula é referida antes de descrita, porque a
   * sintética usa o `firstLine` da referência — que é exatamente o valor que a ficha
   * usaria se fosse ela a primeira. É essa coincidência que garante **uma** aresta por
   * veículo, e não duas.
   */
  const described = describedVehicles.get(plate);
  const reference = plateRefs.get(plate);

  const vehicleLocalId =
    described ?? (reference ? makeLocalId('veh', sourceId, reference.firstLine) : undefined);

  if (vehicleLocalId === undefined) return {};

  const references: Record<string, string> = {};
  for (const name of names) {
    references[name] = vehicleLocalId;
    // A27: o mesmo valor entra em `fields`, porque é de lá que o `dedupeKeysFor` o lê.
    fields[name] = vehicleLocalId;
  }

  void localId;
  return references;
}

/** Uma matrícula vista no ficheiro, com o contexto necessário para lhe dar identidade. */
interface PlateReference {
  /** Forma legível, tal como o ficheiro a escreveu. */
  readonly display: string;
  /** Primeira linha onde apareceu. Determina o `localId` de forma determinística. */
  readonly firstLine: number;
}

/* -------------------------------------------------------------------------- */
/* Canonicalização                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Traduz os campos já interpretados para a forma **canónica** que o núcleo compara.
 *
 * ## O que aqui está, e o que deliberadamente não está
 *
 * Está a canonicalização da matrícula, porque é a única transformação que o
 * `normalizeRecords` faz e que o CSV não recebia por outra via:
 *
 * | Transformação | Onde acontece no CSV |
 * |---|---|
 * | coerção de tipo | `values.ts` — intérpretes por tipo de campo |
 * | whitelist de campos por tipo | `mapping.ts` — só produz campos da `CANONICAL_FIELDS` |
 * | **canonicalização da matrícula** | **aqui** |
 * | renomeação de campos | não é necessária: o mapeamento produz nomes de domínio |
 *
 * A tabela não é documentação decorativa: é a razão pela qual esta função tem **uma** linha
 * de trabalho. Se um dia o `normalizeRecords` ganhar uma segunda transformação, esta tabela
 * é o sítio onde se vê que o CSV não a recebe — e é por isso que ela existe em vez de um
 * comentário a dizer "canonicaliza a matrícula".
 *
 * ## `plateDisplay`
 *
 * O modelo exige as duas formas da matrícula: `plate` (canónica, comparável) e
 * `plateDisplay` (legível, para mostrar). O bundle traz as duas e o `normalizeRecords`
 * preenche a que falta a partir da outra. Aqui faz-se o mesmo, e pela mesma razão: sem
 * `plateDisplay` a escrita falharia num campo obrigatório por causa de uma omissão sem
 * significado.
 *
 * O `plateDisplay` recebe o valor **original** — o que o utilizador vê no ficheiro —, e não
 * a forma canónica. Mostrar `AA00BB` a quem escreveu `AA-00-BB` seria perder informação que
 * o ficheiro tinha.
 *
 * ── Porque é que a forma original vem de `source`, e não de `fields.plateDisplay` ──
 *
 * Porque não há `plateDisplay` **nenhum** nos `fields` do CSV: o dicionário da §10.3 tem uma
 * entrada por campo canónico, e `plateDisplay` não é uma coluna mapeável — é a metade legível
 * da mesma identidade, e quem a deriva é este adaptador. Um CSV traz *uma* coluna de
 * matrícula, e essa coluna é o `plate`.
 *
 * Na primeira versão desta função o valor de recurso era `display ?? plate` — e como
 * `display` vinha sempre `undefined`, o resultado era `plateDisplay = plate`, isto é, a forma
 * **já canonicalizada** nos dois campos (observado: `AA00BB` / `AA00BB` a partir de um
 * ficheiro com `AA-00-BB`). O efeito não era uma falha de escrita — a escrita passa — mas uma
 * perda silenciosa: um ecrã a mostrar `AA00BB` a quem escreveu `AA-00-BB` num ficheiro que
 * ainda existe, sem nada a assinalar a diferença.
 *
 * `source` é o valor cru lido da célula, antes de qualquer interpretação, e é o único sítio
 * onde a forma original ainda existe. Quando não é passado (chamadas internas que não têm a
 * linha à mão), a forma canónica serve de recurso — a escrita continua a funcionar, e o pior
 * caso é a forma legível coincidir com a canónica.
 */
function canonicalizeFields(
  kind: RecordKind,
  fields: Record<string, unknown>,
  source?: string,
): void {
  /*
   * A condição é sobre a presença do **campo**, não sobre o tipo do registo.
   *
   * Um `plate` é uma matrícula onde quer que apareça — na ficha de um veículo *e* numa
   * coluna `Matrícula` de um ficheiro de quilometragens, onde funciona como referência. A
   * versão anterior desta função só agia quando `kind === 'vehicle'`, e o efeito era subtil
   * e grave: num ficheiro de abastecimentos, o `plate` ficava `AA-00-BB` enquanto o núcleo
   * compara `AA00BB`. A ficha sintetizada era criada com a forma errada, e a deduplicação
   * por matrícula contra a conta **nunca coincidia** — o veículo era criado outra vez em
   * cada importação.
   *
   * O `kind` continua a ser o parâmetro porque o `plateDisplay` só é preenchido na ficha:
   * numa linha de abastecimentos, o `plateDisplay` não é um campo do registo (§4.3 —
   * `CANONICAL_FIELDS.fuel` não o inclui), e escrevê-lo criaria um campo que a tabela não
   * tem.
   */
  const plate = typeof fields.plate === 'string' ? fields.plate : undefined;
  const display = typeof fields.plateDisplay === 'string' ? fields.plateDisplay : undefined;

  if (plate === undefined && display === undefined) return;

  // A forma canónica entra sempre que há uma matrícula, seja qual for o tipo.
  fields.plate = normalizePlateForCompare(plate ?? display);

  if (kind !== 'vehicle') return;

  // Na ficha, a forma legível também é preenchida — o modelo exige as duas, e sem
  // `plateDisplay` a escrita falharia num campo obrigatório por causa de uma omissão sem
  // significado. A precedência dá prioridade ao que o ficheiro escreveu: o valor cru da
  // célula, se ainda estiver disponível, e só depois o que já estava em `fields`.
  const legible = display ?? source ?? fields.plate;
  fields.plateDisplay = typeof legible === 'string' ? legible : fields.plate;
}

/* -------------------------------------------------------------------------- */
/* Identificadores                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Prefixo de `localId` por tipo de registo.
 *
 * Duplica intencionalmente `LOCAL_ID_PREFIXES` de `ids.ts`? **Não.** O módulo `ids.ts`
 * exporta a tabela como tipo fechado sobre os tipos do bundle, e o CSV acrescenta um tipo
 * que o bundle não usa da mesma forma (`vehicle` a partir de uma tabela). A derivação aqui
 * é uma função pura sobre a mesma convenção de três letras, e é o teste que garante que
 * coincide com `ids.ts` — evitando que a duplicação se transforme em divergência.
 */
function defaultPrefix(kind: RecordKind): string {
  switch (kind) {
    case 'vehicle':
      return 'veh';
    case 'odometer':
      return 'odo';
    case 'expense':
      return 'exp';
    case 'fuel':
      return 'fuel';
    case 'charging':
      return 'chg';
    case 'maintenance':
      return 'mnt';
    case 'insurance':
      return 'ins';
    case 'inspection':
      return 'insp';
    case 'tax':
      return 'tax';
    case 'document':
      return 'doc';
    case 'reminder':
      return 'rem';
    case 'event':
      return 'evt';
    case 'suggestion':
      return 'sug';
    case 'notification':
      return 'ntf';
    default:
      return 'rec';
  }
}

/**
 * Gera um `localId` estável.
 *
 * A forma é `<prefixo>_<sourceId>_<linha>`. Todas as partes são determinísticas a partir
 * da origem e da posição, o que torna a reimportação do mesmo ficheiro idempotente: a
 * mesma linha produz sempre o mesmo identificador.
 *
 * `sourceId` é sanitizado porque entra num identificador com um padrão restrito. Se a
 * sanitização deixar o identificador longo demais para o limite, o resultado é truncado de
 * forma determinística (não aleatória), para que a estabilidade se mantenha.
 */
function makeLocalId(prefix: string, sourceId: string, line: number): string {
  const safeSource = sanitize(sourceId);
  const candidate = `${prefix}_${safeSource}_${line}`;
  if (candidate.length <= LOCAL_ID_MAX_LENGTH) return candidate;

  // Trunca o `sourceId` mantendo o sufixo da linha, que é a parte que distingue registos.
  const suffix = `_${line}`;
  const room = LOCAL_ID_MAX_LENGTH - prefix.length - 1 - suffix.length;
  return `${prefix}_${safeSource.slice(0, Math.max(1, room))}${suffix}`;
}

/** Reduz uma string ao conjunto de carateres aceite num `localId`. */
function sanitize(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, '');
  return cleaned === '' ? 'csv' : cleaned;
}

/* -------------------------------------------------------------------------- */
/* Verificação                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Campos obrigatórios em falta, por registo.
 *
 * **Não** substitui o Validator: o Validator é quem decide se a falta é bloqueante ou se
 * produz uma qualidade `partial` (§49: dados incompletos são a norma). Esta função existe
 * apenas para a **pré-visualização** poder dizer, linha a linha, o que vai faltar — antes
 * de o utilizador confirmar. Se fosse usada para decidir, seria uma segunda autoridade
 * sobre a mesma regra.
 */
export function emptyFieldsFor(
  record: CanonicalRecord,
  requiredFields: readonly string[],
): readonly string[] {
  return requiredFields.filter((field) => {
    const value = record.fields[field];
    return value === undefined || value === null || value === '';
  });
}

/**
 * Aviso quando a construção não produziu um único registo.
 *
 * Devolver uma lista vazia em silêncio seria o pior resultado possível: o utilizador veria
 * "0 registos" sem saber porquê. A mensagem tem de apontar para a causa mais provável.
 */
export function describeEmptyResult(result: BuildRecordsResult): string | null {
  if (result.records.length > 0) return null;

  if (result.skipped.length > 0) {
    return `Nenhum registo pôde ser construído: ${result.skipped.length} linha(s) foram ignoradas por terem valores ilegíveis.`;
  }

  if (result.issues.length > 0) {
    return `Nenhum registo pôde ser construído: foram encontrados ${result.issues.length} valores ilegíveis.`;
  }

  return 'Nenhum registo pôde ser construído a partir deste ficheiro.';
}
