import { describe, expect, it } from 'vitest';
import type { RecordKind } from '@zemlo/shared';
import {
  actionLabel,
  ambiguityViews,
  columnStateMeta,
  conflictLabel,
  decisionsFromMapping,
  detectionNeedsConfirmation,
  detectionSummary,
  fieldLabel,
  fieldOptions,
  formatPreviewValue,
  inferenceNeedsChoice,
  issueCount,
  groupIssues,
  kindLabel,
  kindLabelPlural,
  pendingColumns,
  planRows,
  previewFields,
} from '../src/lib/csvImport';
import type {
  ColumnAmbiguity,
  ColumnMapping,
  CsvDetection,
  CsvRecordPreview,
  ImportIssue,
  KindInference,
  PlanCounts,
} from '../src/api/csvImport';

/**
 * Testes da camada de leitura da importação.
 *
 * ## Porque é que se testa esta camada e não os componentes
 *
 * O risco de um ecrã de importação não está em o `<div>` estar no sítio certo: está em a
 * tradução estar errada. Três exemplos do que estes testes apanham e um teste de renderização
 * não apanharia:
 *
 *  - `1234567` cêntimos mostrado como `1234567` em vez de `12 345,67 €` — o utilizador
 *    concluiria que a importação está avariada e desistiria com o ficheiro correto;
 *  - uma coluna `ambiguo` contada como resolvida, o que deixaria o botão de avançar ativo e
 *    faria a importação perder a coluna em silêncio;
 *  - `inspection` mostrado como `inspection` a um utilizador português, por o rótulo vir de
 *    um registry que só conhece os cinco tipos de veículo.
 *
 * ## Porque é que não há testes de componentes
 *
 * Não há `jsdom` nem `@testing-library` no projeto, e a regra da casa é não acrescentar uma
 * dependência para testar o que se pode testar sem ela. A lógica que interessa é pura — é
 * por isso que vive em `lib/` e não dentro dos componentes — e é aqui que é exercida. Os
 * componentes ficam com a responsabilidade de a chamar, que é a parte que o `tsc` verifica.
 */

/* -------------------------------------------------------------------------- */
/* Vocabulário                                                                 */
/* -------------------------------------------------------------------------- */

describe('nomes legíveis', () => {
  it('traduz cada tipo de registo suportado', () => {
    const expected: Record<RecordKind, string> = {
      vehicle: 'Veículo',
      odometer: 'Leitura de quilometragem',
      expense: 'Despesa',
      fuel: 'Abastecimento',
      charging: 'Carregamento',
      maintenance: 'Manutenção',
      insurance: 'Seguro',
      inspection: 'Inspeção',
      tax: 'Imposto',
      document: 'Documento',
      reminder: 'Lembrete',
      // Estes três tipos existem no domínio mas não são construíveis a partir de um CSV
      // (§10.5). Têm de devolver algo legível em vez de `undefined`, porque um relatório
      // pode mencioná-los ao falar de um registo existente.
      event: 'Registo',
      suggestion: 'Registo',
      notification: 'Registo',
    };

    for (const [kind, label] of Object.entries(expected)) {
      expect(kindLabel(kind)).toBe(label);
    }
  });

  it('nunca devolve um código técnico para um tipo desconhecido', () => {
    // Um servidor mais recente pode introduzir um tipo novo. Mostrar `warranty` a um
    // utilizador é pior do que mostrar «Registo»: a primeira é uma palavra inglesa que ele
    // não pediu, a segunda é uma frase que ele entende.
    expect(kindLabel('warranty')).toBe('Registo');
    expect(kindLabel(null)).toBe('Registos');
  });

  it('pluraliza só os tipos que têm plural', () => {
    expect(kindLabelPlural('fuel', 1)).toBe('Abastecimento');
    expect(kindLabelPlural('fuel', 3)).toBe('Abastecimentos');
    expect(kindLabelPlural('odometer', 2)).toBe('Leituras de quilometragem');
    expect(kindLabelPlural('vehicle', 0)).toBe('Veículos');
  });

  it('traduz os campos canónicos que um ficheiro pode trazer', () => {
    expect(fieldLabel('date')).toBe('Data');
    expect(fieldLabel('amountCents')).toBe('Valor');
    expect(fieldLabel('odometerKm')).toBe('Quilometragem');
    expect(fieldLabel('litres')).toBe('Litros');
    expect(fieldLabel('plate')).toBe('Matrícula');
  });

  it('devolve o identificador quando o campo é desconhecido, e não uma palavra inventada', () => {
    // Devolver o identificador é a única opção honesta: um campo sem nome num seletor de
    // mapeamento é pior do que um nome técnico, porque o utilizador não o consegue escolher.
    expect(fieldLabel('someNewField')).toBe('someNewField');
    expect(fieldLabel(null)).toBe('—');
  });

  it('traduz os estados das colunas', () => {
    expect(columnStateMeta('confirmado').label).toBe('Reconhecido');
    expect(columnStateMeta('sugerido').label).toBe('Sugerido');
    expect(columnStateMeta('ambiguo').label).toBe('Precisa de decisão');
    expect(columnStateMeta('nao_mapeado').label).toBe('Ignorada');
  });

  it('só marca como pendente o estado ambíguo', () => {
    expect(columnStateMeta('ambiguo').needsDecision).toBe(true);
    expect(columnStateMeta('confirmado').needsDecision).toBe(false);
    expect(columnStateMeta('sugerido').needsDecision).toBe(false);
    // Uma coluna ignorada é uma decisão declarada, não uma pergunta em aberto.
    expect(columnStateMeta('nao_mapeado').needsDecision).toBe(false);
  });

  it('recai em «ignorada» para um estado desconhecido', () => {
    // A escolha importa: recair em `ambiguo` bloquearia o fluxo com uma pergunta que o
    // utilizador não saberia responder, porque a interface não conhece o estado.
    const meta = columnStateMeta('novo_estado' as never);
    expect(meta.needsDecision).toBe(false);
    expect(meta.label).toBe('Ignorada');
  });

  it('traduz as ações do plano e os tipos de conflito', () => {
    expect(actionLabel('create')).toBe('Criar');
    expect(actionLabel('exact')).toBe('Já existe');
    expect(actionLabel('probable')).toBe('Talvez já exista');
    expect(actionLabel('quarantined')).toBe('Precisa de decisão');

    expect(conflictLabel('enrich')).toBe('Completa um registo teu');
    expect(conflictLabel('conflict')).toBe('Diverge do que tens');
  });
});

/* -------------------------------------------------------------------------- */
/* Deteção                                                                     */
/* -------------------------------------------------------------------------- */

function detection(overrides: Partial<CsvDetection> = {}): CsvDetection {
  return {
    encoding: 'utf-8',
    encodingConfidence: 1,
    encodingUncertain: false,
    delimiter: ';',
    delimiterLabel: 'ponto e vírgula',
    delimiterConfidence: 1,
    hasHeader: true,
    headers: ['Data', 'Litros'],
    rowCount: 10,
    physicalLineCount: 11,
    confidence: 1,
    issues: [],
    reasons: [],
    ...overrides,
  };
}

describe('deteção', () => {
  it('resume as linhas e as colunas como a §10.2 pede', () => {
    expect(detectionSummary(detection())).toBe('Encontrei 10 linhas e 2 colunas.');
  });

  it('concorda o singular', () => {
    expect(detectionSummary(detection({ rowCount: 1, headers: ['Data'] }))).toBe(
      'Encontrei 1 linha e 1 coluna.',
    );
  });

  it('não pede confirmação quando a deteção é firme', () => {
    expect(detectionNeedsConfirmation(detection())).toBe(false);
  });

  it('pede confirmação quando a codificação é uma hipótese', () => {
    // Um ficheiro só-ASCII pode ser UTF-8 ou CP1252: a escolha não é fundamentada, e a
    // consequência de estar errada (acentos corrompidos) só aparece depois de escrever.
    expect(detectionNeedsConfirmation(detection({ encodingUncertain: true }))).toBe(true);
  });

  it('pede confirmação quando há problemas sintáticos', () => {
    expect(
      detectionNeedsConfirmation(
        detection({ issues: [{ code: 'ragged_row', line: 5, message: 'campos a mais' }] }),
      ),
    ).toBe(true);
  });

  it('pede confirmação abaixo do limiar de confiança', () => {
    expect(detectionNeedsConfirmation(detection({ confidence: 0.79 }))).toBe(true);
    // O limiar é 0,8 — o mesmo valor estável para o servidor e para o ecrã.
    expect(detectionNeedsConfirmation(detection({ confidence: 0.8 }))).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Inferência do tipo de registo                                               */
/* -------------------------------------------------------------------------- */

function inference(overrides: Partial<KindInference> = {}): KindInference {
  return {
    state: 'inferido',
    kind: 'fuel',
    confidence: 0.9,
    alternatives: [],
    reason: 'Tem data, valor e litros.',
    ...overrides,
  };
}

describe('inferência do tipo', () => {
  it('não pede escolha quando o tipo foi inferido', () => {
    expect(inferenceNeedsChoice(inference(), 'fuel')).toBe(false);
  });

  it('pede escolha quando o tipo é nulo', () => {
    expect(
      inferenceNeedsChoice(inference({ state: 'insuficiente', kind: null }), null),
    ).toBe(true);
  });

  it('pede escolha quando a inferência é ambígua, mesmo com um tipo sugerido', () => {
    // `ambiguo` significa que duas regras ficaram a menos de um reforço de distância: o
    // servidor sugere um, mas não o suficiente para escrever sem perguntar (§10.5).
    expect(inferenceNeedsChoice(inference({ state: 'ambiguo' }), 'fuel')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Contagens do plano                                                          */
/* -------------------------------------------------------------------------- */

function counts(overrides: Partial<PlanCounts> = {}): PlanCounts {
  return {
    create: 0,
    exact: 0,
    probable: 0,
    quarantined: 0,
    skipped: 0,
    total: 0,
    enriching: 0,
    conflicting: 0,
    documentsMissingContent: 0,
    ...overrides,
  };
}

describe('contagens do plano', () => {
  it('produz sempre as quatro linhas do passo 3 da §11.2, pela mesma ordem', () => {
    const rows = planRows(counts());
    expect(rows.map((row) => row.label)).toEqual([
      'Criar',
      'Já existem',
      'Precisam de decisão',
      'Não vou importar',
    ]);
  });

  it('soma prováveis e em quarentena em «precisam de decisão»', () => {
    // São situações diferentes para o servidor e a mesma pergunta para o utilizador. Separar
    // as duas daria cinco linhas onde a §11.2 pede quatro.
    const rows = planRows(counts({ probable: 3, quarantined: 2 }));
    const decision = rows.find((row) => row.label === 'Precisam de decisão');
    expect(decision?.count).toBe(5);
    expect(decision?.actionable).toBe(true);
  });

  it('só marca «precisam de decisão» como acionável quando tem conteúdo', () => {
    const rows = planRows(counts({ create: 10 }));
    const decision = rows.find((row) => row.label === 'Precisam de decisão');
    expect(decision?.count).toBe(0);
    expect(decision?.actionable).toBe(false);
  });

  it('não mostra as linhas condicionais quando estão a zero', () => {
    const labels = planRows(counts({ create: 5 })).map((row) => row.label);
    expect(labels).not.toContain('Completar registos teus');
    expect(labels).not.toContain('Em conflito');
  });

  it('acrescenta as linhas de enriquecimento e de conflito quando existem', () => {
    const rows = planRows(counts({ create: 5, enriching: 2, conflicting: 1 }));
    const labels = rows.map((row) => row.label);
    expect(labels).toContain('Completar registos teus');
    expect(labels).toContain('Em conflito');
    // O conflito exige uma decisão; o enriquecimento não — preencher o que está vazio é a
    // política por omissão (decisão 8) e não destrói nada.
    expect(rows.find((row) => row.label === 'Em conflito')?.actionable).toBe(true);
    expect(rows.find((row) => row.label === 'Completar registos teus')?.actionable).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Problemas                                                                   */
/* -------------------------------------------------------------------------- */

function issue(severity: ImportIssue['severity'], code: string): ImportIssue {
  return { severity, code, message: `mensagem ${code}` };
}

describe('problemas', () => {
  it('agrupa por gravidade', () => {
    const grouped = groupIssues([
      issue('blocking', 'a'),
      issue('recoverable', 'b'),
      issue('info', 'c'),
      issue('recoverable', 'd'),
    ]);
    expect(grouped.blocking).toHaveLength(1);
    expect(grouped.recoverable).toHaveLength(2);
    expect(grouped.info).toHaveLength(1);
  });

  it('não perde nenhum problema no agrupamento', () => {
    // Um problema descartado é uma lacuna não declarada, que é o que a §9.2 proíbe.
    const issues = [
      issue('blocking', 'a'),
      issue('recoverable', 'b'),
      issue('info', 'c'),
      issue('blocking', 'd'),
    ];
    const grouped = groupIssues(issues);
    expect(
      grouped.blocking.length + grouped.recoverable.length + grouped.info.length,
    ).toBe(issues.length);
    expect(issueCount(issues)).toBe(4);
  });

  it('trata listas vazias sem rebentar', () => {
    const grouped = groupIssues([]);
    expect(grouped).toEqual({ blocking: [], recoverable: [], info: [] });
  });
});

/* -------------------------------------------------------------------------- */
/* Formatação de valores                                                       */
/* -------------------------------------------------------------------------- */

describe('formatação de valores normalizados', () => {
  /*
   * Duas espécies de espaço, com papéis diferentes e ambos deliberados:
   *
   *  - **U+00A0 (não separável) entre os grupos de milhares** — impede que `12 345,67` se
   *    parta entre duas linhas a meio do número;
   *  - **U+0020 (normal) antes do símbolo `€`** — é o espaço que a convenção do produto usa
   *    (`packages/shared`), porque aí uma quebra até é desejável em ecrãs estreitos.
   *
   * O teste fixa as duas coisas em vez de as tolerar: escrever `\s` em vez de cada uma delas
   * deixaria passar uma alteração que tornasse os números quebráveis.
   */
  const NBSP = '\u00A0';
  const SP = '\u0020';

  it('converte cêntimos em euros pelo nome do campo', () => {
    // O valor chega em cêntimos inteiros, como o contrato manda. Mostrá-lo em bruto seria
    // mostrar `1234567` onde o utilizador escreveu `12 345,67 €`.
    expect(formatPreviewValue('amountCents', 1234567)).toBe(`12${NBSP}345,67${SP}€`);
    expect(formatPreviewValue('premiumCents', 25000)).toBe(`250,00${SP}€`);
  });

  it('acrescenta a unidade aos campos que a têm', () => {
    expect(formatPreviewValue('odometerKm', 124512)).toBe(`124${NBSP}512 km`);
    expect(formatPreviewValue('litres', 45.6)).toBe('45,60 l');
    expect(formatPreviewValue('energyKwh', 32.5)).toBe('32,50 kWh');
  });

  it('converte datas civis para o formato português', () => {
    // `2026-04-03` é o formato do contrato; `03/04/2026` é o que o utilizador reconhece.
    // É esta conversão que torna visível uma convenção dia/mês mal escolhida.
    expect(formatPreviewValue('date', '2026-04-03')).toBe('03/04/2026');
  });

  it('trunca uma data-hora ISO à parte da data', () => {
    expect(formatPreviewValue('recordedAt', '2026-04-03T14:22:00.000Z')).toBe('03/04/2026');
  });

  it('escreve booleanos em português', () => {
    expect(formatPreviewValue('fullTank', true)).toBe('Sim');
    expect(formatPreviewValue('fullTank', false)).toBe('Não');
  });

  it('marca os valores ausentes com um traço e não com «null»', () => {
    expect(formatPreviewValue('notes', null)).toBe('—');
    expect(formatPreviewValue('notes', undefined)).toBe('—');
    expect(formatPreviewValue('notes', '')).toBe('—');
  });

  it('devolve texto livre tal como está', () => {
    expect(formatPreviewValue('vendor', 'Galp Sacavém')).toBe('Galp Sacavém');
  });
});

/* -------------------------------------------------------------------------- */
/* Campos da pré-visualização                                                   */
/* -------------------------------------------------------------------------- */

describe('campos da pré-visualização', () => {
  it('omite os campos vazios e mantém os preenchidos', () => {
    const record: CsvRecordPreview = {
      localId: 'a',
      line: 2,
      kind: 'fuel',
      fields: { date: '2026-04-03', litres: 45.6, notes: '', vendor: null },
      emptyFields: [],
    };
    const fields = previewFields(record);
    expect(fields.map((field) => field.field)).toEqual(['date', 'litres']);
    expect(fields[0]?.label).toBe('Data');
  });
});

/* -------------------------------------------------------------------------- */
/* Opções do seletor de campo                                                   */
/* -------------------------------------------------------------------------- */

function column(overrides: Partial<ColumnMapping> = {}): ColumnMapping {
  return {
    index: 0,
    header: 'Km/l',
    normalized: 'kml',
    state: 'ambiguo',
    field: null,
    confidence: 0,
    candidates: [],
    reason: null,
    sample: [],
    ...overrides,
  };
}

describe('opções do seletor de campo', () => {
  it('põe as candidatas compatíveis com o tipo à frente', () => {
    const options = fieldOptions(
      column({
        candidates: [
          { field: 'consumption', confidence: 0.6, match: 'weak', compatibleWithKind: false },
          { field: 'odometerKm', confidence: 0.6, match: 'weak', compatibleWithKind: true },
        ],
      }),
      ['odometerKm', 'litres'],
    );
    expect(options[0]?.field).toBe('odometerKm');
  });

  it('não repete um campo que já é candidato', () => {
    const options = fieldOptions(
      column({ candidates: [{ field: 'odometerKm', confidence: 0.9, match: 'exact', compatibleWithKind: true }] }),
      ['odometerKm', 'litres'],
    );
    expect(options.filter((option) => option.field === 'odometerKm')).toHaveLength(1);
  });

  it('acrescenta os campos do tipo que ainda não apareceram', () => {
    const options = fieldOptions(column(), ['date', 'litres']);
    expect(options.map((option) => option.field)).toEqual(['date', 'litres']);
    expect(options[0]?.label).toBe('Data');
  });
});

/* -------------------------------------------------------------------------- */
/* Decisões pendentes                                                          */
/* -------------------------------------------------------------------------- */

describe('decisões pendentes', () => {
  const columns = [
    column({ index: 0, state: 'confirmado', field: 'date' }),
    column({ index: 1, state: 'ambiguo' }),
    column({ index: 2, state: 'ambiguo' }),
    column({ index: 3, state: 'nao_mapeado', field: null }),
  ];

  it('conta como pendente uma coluna ambígua sem decisão', () => {
    expect(pendingColumns(columns, new Map()).map((item) => item.index)).toEqual([1, 2]);
  });

  it('deixa de contar assim que há uma decisão, mesmo que seja ignorar', () => {
    // Ignorar é uma resposta (§10.4: «se a resposta for nenhuma, ignora-se»). Contá-la como
    // pendente deixaria o fluxo preso numa pergunta já respondida.
    const decided = new Map<number, string | null>([[1, null]]);
    expect(pendingColumns(columns, decided).map((item) => item.index)).toEqual([2]);
  });

  it('não considera pendente uma coluna já resolvida pelo servidor', () => {
    const decided = new Map<number, string | null>([
      [1, 'odometerKm'],
      [2, 'consumption'],
    ]);
    expect(pendingColumns(columns, decided)).toEqual([]);
  });

  it('constrói as decisões só a partir do que foi efetivamente decidido', () => {
    const decided = new Map<number, string | null>([
      [1, 'odometerKm'],
      [3, null],
    ]);
    expect(decisionsFromMapping(columns, decided)).toEqual([
      { index: 1, field: 'odometerKm' },
      { index: 3, field: null },
    ]);
  });

  it('não inventa uma decisão para uma coluna não decidida', () => {
    expect(decisionsFromMapping(columns, new Map())).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Ambiguidades de valor (§10.4)                                               */
/* -------------------------------------------------------------------------- */

/**
 * ## O que estes testes defendem
 *
 * A §10.4 obriga a perguntar as ambiguidades que o sistema não resolve sozinho, «com
 * pré-visualização das duas interpretações». O servidor passou a devolvê-las em
 * `mapping.valueAmbiguities`; esta camada é quem as transforma numa pergunta respondível.
 *
 * O risco aqui é específico e silencioso: cada ambiguidade **tem de** produzir o parâmetro
 * que o servidor entende (`dateOrder` / `decimalStyle`). Se `ambiguityViews` devolvesse uma
 * resposta com o nome errado, o ecrã mostrava um botão, o utilizador carregava, a reanálise
 * corria **sem** a resposta — e a mesma pergunta voltava. Um ciclo que parece avaria e não
 * tem mensagem de erro nenhuma: o ecrã não distingue "não respondi" de "a resposta não
 * chegou".
 */
describe('ambiguidades de valor (§10.4)', () => {
  const dateAmbiguity: ColumnAmbiguity = {
    code: 'data_ambigua',
    field: 'date',
    question: 'As datas desta coluna podem ser dia/mês ou mês/dia. Qual é a ordem correta?',
    alternatives: [
      { label: 'Dia/Mês', value: 'dia-mes', preview: ['3 de abril', '12 de maio'] },
      { label: 'Mês/Dia', value: 'mes-dia', preview: ['4 de março', '5 de dezembro'] },
    ],
    affectedLines: [],
  };

  const decimalAmbiguity: ColumnAmbiguity = {
    code: 'separador_decimal',
    field: 'amountCents',
    question: 'Não é possível saber se o ponto é separador de milhares ou decimal. Qual é a leitura correta?',
    alternatives: [
      { label: 'Vírgula decimal', value: 'virgula', preview: ['1,589 €'] },
      { label: 'Ponto decimal', value: 'ponto', preview: ['1.589 €'] },
    ],
    affectedLines: [],
  };

  it('traduz o campo técnico no nome legível da coluna', () => {
    // `amountCents` não é vocabulário que a §11.3 permita mostrar.
    const [view] = ambiguityViews([decimalAmbiguity]);
    expect(view?.field).toBe(fieldLabel('amountCents'));
    expect(view?.field).not.toBe('amountCents');
  });

  it('apresenta a pergunta do servidor tal como veio', () => {
    const [view] = ambiguityViews([decimalAmbiguity]);
    expect(view?.question).toBe(decimalAmbiguity.question);
  });

  it('constrói a resposta das datas no parâmetro que o servidor entende', () => {
    const [view] = ambiguityViews([dateAmbiguity]);
    expect(view?.choices).toEqual([
      { label: 'Dia / Mês', patch: { dateOrder: 'dia-mes' } },
      { label: 'Mês / Dia', patch: { dateOrder: 'mes-dia' } },
    ]);
  });

  it('constrói a resposta dos decimais no parâmetro que o servidor entende', () => {
    const [view] = ambiguityViews([decimalAmbiguity]);
    expect(view?.choices).toEqual([
      { label: 'Vírgula (1.234,56)', patch: { decimalStyle: 'virgula' } },
      { label: 'Ponto (1,234.56)', patch: { decimalStyle: 'ponto' } },
    ]);
  });

  it('leva as duas leituras para o ecrã, com os valores de amostra', () => {
    /*
     * A pré-visualização é a parte que torna a pergunta respondível: `['3 de abril', '12 de
     * maio']` ao lado de `['4 de março', '5 de dezembro']` permite decidir sem saber o que é
     * uma convenção de data. Sem ela, a pergunta pedia ao utilizador que soubesse a resposta
     * de antemão.
     */
    const [view] = ambiguityViews([dateAmbiguity]);
    expect(view?.samples).toEqual([
      { label: 'Dia/Mês', values: ['3 de abril', '12 de maio'] },
      { label: 'Mês/Dia', values: ['4 de março', '5 de dezembro'] },
    ]);
  });

  it('não oferece uma resposta para duas moedas nem para unidade ambígua', () => {
    /*
     * Nenhuma das duas se resolve por convenção global: as moedas exigem corrigir as linhas
     * da moeda minoritária, e a unidade resolve-se por `resolvedUnits`, que é por campo. Um
     * botão que não altera nada é pior do que nenhum — o utilizador carregava, a pergunta
     * voltava, e ele concluía que o ecrã estava avariado.
     */
    const views = ambiguityViews([
      { ...dateAmbiguity, code: 'moedas_multiplas', field: 'amountCents' },
      { ...dateAmbiguity, code: 'unidade_ambigua', field: 'consumption' },
    ]);

    expect(views.every((view) => view.choices.length === 0)).toBe(true);
    // A pergunta continua a ser apresentada — é ela que diz ao utilizador o que fazer.
    expect(views.every((view) => view.question.length > 0)).toBe(true);
  });

  it('preserva a ordem das colunas no ficheiro', () => {
    // A ordem do servidor é a das colunas. Reordenar obrigaria o utilizador a encontrar a
    // coluna antes de responder, e a lista deixa de ser legível como o ficheiro.
    const views = ambiguityViews([dateAmbiguity, decimalAmbiguity]);
    expect(views.map((view) => view.code)).toEqual(['data_ambigua', 'separador_decimal']);
  });

  it('uma lista vazia não produz perguntas', () => {
    expect(ambiguityViews([])).toEqual([]);
  });
});
