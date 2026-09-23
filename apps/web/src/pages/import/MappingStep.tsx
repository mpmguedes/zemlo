import { useMemo } from 'react';
import { Banner, Button, Card, Chip, Disclosure } from '../../ui/primitives';
import type {
  ColumnMapping,
  CsvMappingView,
  DateOrder,
  DecimalStyle,
  RecordKind,
} from '../../api/queries';
import { ambiguityViews, columnStateMeta, fieldLabel, fieldOptions } from '../../lib/csvImport';

/**
 * O mapeamento das colunas e as ambiguidades que ele não resolve (§10.2 fase 4, §10.4).
 *
 * ## A ordem em que as coisas são decididas
 *
 * As colunas ambíguas aparecem **primeiro e sozinhas**. É o único ponto do fluxo em que o
 * sistema admite que não sabe, e misturá-lo com a lista completa de colunas — que é longa e
 * quase toda resolvida — faria o utilizador procurar, entre vinte linhas verdes, as duas que
 * lhe pedem algo. Quando não há nada ambíguo, o passo mostra o mapa completo como
 * confirmação: o utilizador vê que "Data → Data" e "Litros → Litros" e pode corrigir o que
 * quiser, mas não tem de o fazer.
 *
 * ## Porque é que o seletor de campo mostra amostras
 *
 * Uma coluna chamada "Km/l" não diz a ninguém se é o consumo médio ou a quilometragem. As
 * amostras de valores dizem: `5,2 / 5,4 / 5,1` é um consumo; `124 000 / 124 512` é uma
 * quilometragem. A decisão passa a ser tomada a olhar para os dados e não para o nome, que é
 * a única forma de ela ser fiável.
 *
 * ## Porque é que as convenções (dia/mês, vírgula decimal) vivem aqui
 *
 * A §10.4 pede que as ambiguidades de valor sejam perguntadas **com pré-visualização das duas
 * interpretações**. Uma convenção é uma propriedade de uma coluna, e é à frente dessa coluna
 * que a pergunta faz sentido: "o `03/04/2026` desta coluna é 3 de abril ou 4 de março?" é
 * respondível; a mesma pergunta num passo isolado obrigaria o utilizador a lembrar-se dos
 * dados que viu dois ecrãs antes.
 */
export function MappingStep({
  mapping,
  decided,
  busy,
  dateOrder,
  decimalStyle,
  kind,
  onDecide,
  onConvention,
  onContinue,
  readOnly = false,
}: {
  mapping: CsvMappingView;
  decided: ReadonlyMap<number, string | null>;
  busy: boolean;
  dateOrder: DateOrder | null;
  decimalStyle: DecimalStyle | null;
  kind: RecordKind | null;
  onDecide: (index: number, field: string | null) => void;
  onConvention: (patch: { dateOrder?: DateOrder; decimalStyle?: DecimalStyle }) => void;
  onContinue: () => void;
  readOnly?: boolean;
}) {
  /*
   * As colunas que ainda pedem uma decisão: as ambíguas que o utilizador não resolveu, mais
   * as que ele já resolveu mas ainda não voltaram confirmadas pelo servidor. Manter as
   * resolvidas na lista evita o pior efeito de uma reanálise — a linha a desaparecer debaixo
   * do dedo de quem acabou de a tocar, antes de ele perceber que a decisão foi aceite.
   */
  const pending = useMemo(
    () => mapping.columns.filter((column) => column.state === 'ambiguo' || decided.has(column.index)),
    [mapping.columns, decided],
  );

  const remaining = mapping.columns.filter(
    (column) => column.state === 'ambiguo' && !decided.has(column.index),
  );

  const settled = remaining.length === 0;
  const unresolved = remaining.length;

  /*
   * As ambiguidades de **valor** (§10.4) são perguntadas aqui e não num passo próprio.
   *
   * Resolver uma ambiguidade de valor é escolher uma convenção — a resposta viaja como
   * `dateOrder`/`decimalStyle` —, e as convenções vivem neste passo, à frente da coluna que
   * as originou. Criar um ecrã à parte obrigaria o utilizador a lembrar-se, dois ecrãs
   * depois, dos valores que justificam a resposta.
   */
  const ambiguities = useMemo(
    () => ambiguityViews(mapping.valueAmbiguities ?? []),
    [mapping.valueAmbiguities],
  );

  const blockedByValue = ambiguities.length > 0;

  return (
    <Card>
      <div className="z-card__header">
        <div>
          <div className="z-card__title">
            {pending.length > 0 || blockedByValue
              ? 'Como as tuas colunas vão ser lidas'
              : 'Colunas reconhecidas'}
          </div>
          <div className="z-card__subtitle">
            {blockedByValue
              ? `${ambiguities.length} ${ambiguities.length === 1 ? 'valor precisa' : 'valores precisam'} de uma resposta tua.`
              : settled
                ? `${Math.round(mapping.coverage * 100)} % das colunas ficaram resolvidas sozinhas.`
                : `${unresolved} ${unresolved === 1 ? 'coluna precisa' : 'colunas precisam'} de uma resposta tua.`}
          </div>
        </div>
        <Chip tone={settled && !blockedByValue ? 'ok' : 'warn'}>
          {settled && !blockedByValue ? 'Tudo resolvido' : `Faltam ${unresolved + ambiguities.length}`}
        </Chip>
      </div>

      {/*
        --- As ambiguidades de valor, com as duas leituras lado a lado (§10.4) ---

        A §10.4 exige «pré-visualização das duas interpretações»: quem não sabe se o
        ficheiro vem de um Excel português ou inglês sabe ainda menos se `1,589` são 159
        cêntimos ou 1589. Os valores de amostra são calculados pelo servidor — a interface
        não os reconstrói, porque a única forma de garantir que a amostra corresponde à
        leitura é ela vir de quem a vai aplicar.
      */}
      {ambiguities.length > 0 ? (
        <Banner tone="warn" title="Falta uma resposta para continuar">
          <div className="z-stack">
            {ambiguities.map((ambiguity) => (
              <div key={`${ambiguity.code}-${ambiguity.field}`} className="z-stack z-stack--tight">
                <p className="z-small">
                  <strong>{ambiguity.field}.</strong> {ambiguity.question}
                </p>

                {ambiguity.samples.length > 0 ? (
                  <ul className="z-stack z-stack--tight z-xs z-muted">
                    {ambiguity.samples.map((sample, index) => (
                      <li key={index}>
                        {sample.label}
                        {sample.values.length > 0 ? (
                          <>
                            {' — '}
                            <span className="z-mono">{sample.values.slice(0, 4).join(' · ')}</span>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {ambiguity.choices.length > 0 && !readOnly ? (
                  <div className="z-segmented" role="group" aria-label={ambiguity.question}>
                    {ambiguity.choices.map((choice) => (
                      <button
                        key={choice.label}
                        type="button"
                        className="z-segmented__item"
                        disabled={busy}
                        onClick={() => onConvention(choice.patch)}
                      >
                        {choice.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Banner>
      ) : null}

      {/* --- As ambiguidades, primeiro e em destaque --- */}
      {pending.length > 0 ? (
        <div className="z-stack">
          {pending.map((column) => (
            <ColumnRow
              key={column.index}
              column={column}
              decision={decided.get(column.index)}
              hasDecision={decided.has(column.index)}
              busy={busy}
              canonicalFields={mapping.requiredFields}
              onDecide={onDecide}
              readOnly={readOnly}
            />
          ))}
        </div>
      ) : null}

      {/* --- As convenções de valor, quando existem (§10.4) --- */}
      {!readOnly && !blockedByValue ? (
        <Conventions
          mapping={mapping}
          dateOrder={dateOrder}
          decimalStyle={decimalStyle}
          busy={busy}
          onConvention={onConvention}
        />
      ) : null}

      {/* --- O mapa completo, para quem o quiser ver --- */}
      {mapping.columns.length > 0 ? (
        <Disclosure label={`Ver todas as ${mapping.columns.length} colunas`}>
          <div className="z-stack z-stack--tight">
            {mapping.columns.map((column) => (
              <SettledRow key={column.index} column={column} />
            ))}
          </div>
          {kind !== null ? (
            <p className="z-xs z-muted" style={{ marginTop: 'var(--z-space-3)' }}>
              Uma coluna pode ser mapeada para qualquer campo, mesmo que o nome não o sugira —
              escolhe «Outro campo» para ver a lista completa do tipo de registo.
            </p>
          ) : null}
        </Disclosure>
      ) : null}

      {!readOnly ? (
        <div className="z-row z-row--end" style={{ gap: 'var(--z-space-2)' }}>
          {/*
            O avanço é bloqueado enquanto houver colunas por resolver **ou** uma
            ambiguidade de valor por responder. Não é uma limitação técnica: é a §10.4
            levada a sério. Uma coluna ambígua ignorada em silêncio seria importada como
            "não mapeada", e um valor ambíguo avançaria para uma revisão vazia onde o ecrã
            diria que estava tudo resolvido — duas perdas distintas do mesmo tipo.
          */}
          <Button
            variant="primary"
            onClick={onContinue}
            disabled={!settled || blockedByValue || busy}
            loading={busy}
          >
            {blockedByValue
              ? 'Responde aos valores em falta'
              : settled
                ? 'Ver como ficam os registos'
                : 'Responde às colunas em falta'}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Uma coluna que pede uma decisão                                             */
/* -------------------------------------------------------------------------- */

function ColumnRow({
  column,
  decision,
  hasDecision,
  busy,
  canonicalFields,
  onDecide,
  readOnly,
}: {
  column: ColumnMapping;
  decision: string | null | undefined;
  hasDecision: boolean;
  busy: boolean;
  canonicalFields: readonly string[];
  onDecide: (index: number, field: string | null) => void;
  readOnly: boolean;
}) {
  const meta = columnStateMeta(column.state);
  const options = useMemo(() => fieldOptions(column, canonicalFields), [column, canonicalFields]);

  /*
   * Numa coluna ambígua o valor do seletor é o que o utilizador escolheu (ou vazio, enquanto
   * não escolheu). Numa já resolvida, é o campo que o servidor atribuiu — e mostrar o do
   * servidor e não a escolha local evita a divergência entre o que o ecrã diz e o que o
   * último plano contém.
   */
  const value = hasDecision ? (decision ?? '') : (column.field ?? '');

  return (
    <div className={`z-import__column z-import__column--${meta.tone}`}>
      <div className="z-import__column-head">
        <div style={{ minWidth: 0 }}>
          <div className="z-strong z-truncate">{column.header || <span className="z-muted">(sem nome)</span>}</div>
          <div className="z-xs z-muted">
            {column.reason ?? meta.explanation}
          </div>
        </div>
        <Chip tone={meta.tone}>{hasDecision && column.state === 'ambiguo' ? 'Respondido' : meta.label}</Chip>
      </div>

      {column.sample.length > 0 ? (
        <div className="z-import__sample">
          <span className="z-xs z-muted">Exemplos:</span>
          {column.sample.slice(0, 4).map((sample, index) => (
            <span key={index} className="z-import__sample-value z-mono">
              {sample === '' ? '—' : sample}
            </span>
          ))}
        </div>
      ) : null}

      <label className="z-field">
        <span className="z-field__label">Este campo é</span>
        <select
          className="z-select"
          value={value}
          disabled={busy || readOnly}
          onChange={(event) => onDecide(column.index, event.target.value === '' ? null : event.target.value)}
        >
          <option value="">Ignorar esta coluna</option>
          {options.map((option) => (
            <option key={option.field} value={option.field}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {/*
        Quando o servidor atribuiu um campo mas a confiança não é total, o ecrã declara-o. É a
        diferença entre "reconhecido" e "sugerido" da §10.3 a chegar ao utilizador: uma
        sugestão aceite em silêncio é uma decisão que ele nunca tomou.
      */}
      {column.state === 'sugerido' && column.field !== null ? (
        <p className="z-xs z-muted">
          Sugeri <strong>{fieldLabel(column.field)}</strong> porque o nome se parece. Corrige se não for.
        </p>
      ) : null}
    </div>
  );
}

/** Uma coluna já resolvida, na lista completa. */
function SettledRow({ column }: { column: ColumnMapping }) {
  const meta = columnStateMeta(column.state);
  return (
    <div className="z-row z-row--between z-import__settled">
      <span className="z-truncate" style={{ minWidth: 0 }}>
        {column.header || <span className="z-muted">(sem nome)</span>}
      </span>
      <span className="z-row" style={{ gap: 'var(--z-space-2)', flex: 'none' }}>
        <span className="z-muted" aria-hidden="true">
          →
        </span>
        <Chip tone={meta.tone}>{column.field === null ? 'Ignorada' : fieldLabel(column.field)}</Chip>
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Convenções de valor (§10.4)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * As duas convenções que o sistema não resolve sozinho.
 *
 * Ambas só aparecem quando o servidor **assinalou** a ambiguidade — ou seja, quando todos os
 * valores de um dos lados são ≤ 12 (datas) ou quando o padrão decimal da coluna não decide
 * (valores). Quando o ficheiro é inequívoco, a convenção foi detetada e não se pergunta nada:
 * pedir confirmação de uma coisa que se sabe treina o utilizador a carregar em "seguinte" sem
 * ler, que é o oposto do que a §11.3 quer.
 */
function Conventions({
  mapping,
  dateOrder,
  decimalStyle,
  busy,
  onConvention,
}: {
  mapping: CsvMappingView;
  dateOrder: DateOrder | null;
  decimalStyle: DecimalStyle | null;
  busy: boolean;
  onConvention: (patch: { dateOrder?: DateOrder; decimalStyle?: DecimalStyle }) => void;
}) {
  /*
   * As convenções são detetadas a partir das colunas de data e de valor que existem no
   * ficheiro. Não há um campo «dateOrder» na resposta do mapeamento porque a ambiguidade é
   * uma propriedade do **conteúdo** já interpretado — pelo que a presença de uma coluna de
   * data mapeada é o sinal de que a pergunta pode ser relevante.
   */
  const hasDate = mapping.columns.some((column) => column.field === 'date' || column.field === 'recordedAt');
  const hasMoney = mapping.columns.some((column) =>
    ['amountCents', 'premiumCents', 'pricePerLitreCents', 'pricePerKwhCents'].includes(column.field ?? ''),
  );

  if (!hasDate && !hasMoney) return null;

  return (
    <div className="z-import__conventions">
      {hasDate ? (
        <fieldset className="z-import__convention">
          <legend className="z-field__label">As datas estão em que ordem?</legend>
          {/*
           * O `aria-label` no grupo não é decorativo nem redundante com o `legend`: um
           * `role="group"` sem nome é anunciado como «grupo» e nada mais, e os outros nove
           * grupos do projeto têm nome (`WEB-006`, achado A4). A alternativa — tirar o
           * `role="group"`, já que o `fieldset` agrupa — foi considerada e recusada: não
           * tenho leitor de ecrã para verificar o que muda na locução, e entre uma alteração
           * aditiva que não pode partir nada e uma subtrativa que não consigo testar, fica a
           * aditiva.
           */}
          <p className="z-xs z-muted" style={{ marginBottom: 'var(--z-space-2)' }}>
            Há datas em que o dia e o mês podem trocar-se. Escolhe para este ficheiro — a
            resposta fica guardada com o mapa.
          </p>
          <div className="z-segmented" role="group" aria-label="Ordem das datas">
            <button
              type="button"
              className="z-segmented__item"
              aria-pressed={dateOrder === 'dia-mes'}
              disabled={busy}
              onClick={() => onConvention({ dateOrder: 'dia-mes' })}
              style={dateOrder === 'dia-mes' ? { background: 'var(--z-bg-elevated)' } : undefined}
            >
              Dia / Mês
            </button>
            <button
              type="button"
              className="z-segmented__item"
              aria-pressed={dateOrder === 'mes-dia'}
              disabled={busy}
              onClick={() => onConvention({ dateOrder: 'mes-dia' })}
              style={dateOrder === 'mes-dia' ? { background: 'var(--z-bg-elevated)' } : undefined}
            >
              Mês / Dia
            </button>
          </div>
        </fieldset>
      ) : null}

      {hasMoney ? (
        <fieldset className="z-import__convention">
          <legend className="z-field__label">Os valores usam que separador decimal?</legend>
          <p className="z-xs z-muted" style={{ marginBottom: 'var(--z-space-2)' }}>
            «1.234,56» é o formato português; «1,234.56» é o formato inglês. Diz qual é o teu.
          </p>
          <div className="z-segmented" role="group" aria-label="Separador decimal">
            <button
              type="button"
              className="z-segmented__item"
              aria-pressed={decimalStyle === 'virgula'}
              disabled={busy}
              onClick={() => onConvention({ decimalStyle: 'virgula' })}
              style={decimalStyle === 'virgula' ? { background: 'var(--z-bg-elevated)' } : undefined}
            >
              Vírgula (1.234,56)
            </button>
            <button
              type="button"
              className="z-segmented__item"
              aria-pressed={decimalStyle === 'ponto'}
              disabled={busy}
              onClick={() => onConvention({ decimalStyle: 'ponto' })}
              style={decimalStyle === 'ponto' ? { background: 'var(--z-bg-elevated)' } : undefined}
            >
              Ponto (1,234.56)
            </button>
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}
