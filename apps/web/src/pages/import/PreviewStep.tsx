import { Banner, Card, Chip, Disclosure, EmptyState } from '../../ui/primitives';
import type {
  CsvDetection,
  CsvRecordPreview,
  CsvSkippedRow,
  CsvValueIssue,
  RecordKind,
} from '../../api/queries';
import { kindLabel, previewFields } from '../../lib/csvImport';

/**
 * Como os registos vão ficar, o que ficou de fora e o que não foi possível ler
 * (§10.2, fases 5–7).
 *
 * ## Porque é que a pré-visualização mostra os registos **normalizados**
 *
 * A §10.2 é explícita: «Mostra as primeiras ~20 linhas **já normalizadas**, não o ficheiro
 * cru». É a diferença entre confirmar uma conversão e confirmar uma intenção. A primeira
 * mostra `2026-04-03` onde o ficheiro tinha `03/04/2026` — se a convenção estiver errada, o
 * erro é visível **antes** de os dados entrarem, e não três meses depois na estatística.
 *
 * ## A hierarquia das três listas
 *
 *  1. **A pré-visualização** — o que vai ser criado. É o que o utilizador veio ver.
 *  2. **Os valores ilegíveis** — campos que o núcleo não conseguiu converter. Aparecem sempre
 *     que existam, porque significam dados a menos.
 *  3. **As linhas ignoradas** — linhas que não produziram registo nenhum, com o motivo.
 *
 * As duas últimas ficam atrás de uma divulgação quando não têm conteúdo (não há nada a dizer)
 * e à vista quando têm. Nunca se escondem por completo: a §9.2 exige que um registo com
 * problemas "entre com a lacuna declarada", e uma lacuna não declarada não é uma lacuna —
 * é uma perda silenciosa.
 */
export function PreviewStep({
  preview,
  skipped,
  valueIssues,
  emptyReason,
  kind,
  detection,
}: {
  preview: CsvRecordPreview[];
  skipped: CsvSkippedRow[];
  valueIssues: CsvValueIssue[];
  emptyReason: string | null;
  kind: RecordKind | null;
  detection: CsvDetection;
}) {
  /*
   * Quando nada pôde ser construído, não há pré-visualização para mostrar. O ecrã diz porquê —
   * `emptyReason` vem do servidor já em português e nomeia a causa mais provável — e explica o
   * que fazer. A §11.3 exige que "mesmo com erros bloqueantes, o ecrã diga o que fazer a
   * seguir": um beco sem saída aqui seria o utilizador a olhar para um ficheiro que não sabe
   * corrigir.
   */
  if (preview.length === 0) {
    return (
      <Card>
        <EmptyState
          icon="🤔"
          title="Não consegui construir registos a partir deste ficheiro"
          body={
            emptyReason ??
            'Nenhuma linha tinha os campos necessários para ser convertida num registo. Verifica se escolheste o tipo de registo certo.'
          }
        />
        {detection.rowCount > 0 ? (
          <p className="z-xs z-muted" style={{ textAlign: 'center' }}>
            O ficheiro tem {detection.rowCount} linhas de dados e {detection.headers.length}{' '}
            colunas. Se o tipo escolhido não for o certo, volta atrás e muda-o.
          </p>
        ) : null}
      </Card>
    );
  }

  return (
    <>
      <Card>
        <div className="z-card__header">
          <div>
            <div className="z-card__title">Assim é como os teus registos vão ficar</div>
            <div className="z-card__subtitle">
              As primeiras {preview.length} {preview.length === 1 ? 'linha' : 'linhas'}, já
              convertidas — não o texto original do ficheiro.
            </div>
          </div>
          <Chip tone="ok">{kindLabel(kind)}</Chip>
        </div>

        <div className="z-stack z-stack--tight">
          {preview.map((record) => (
            <PreviewRow key={record.localId} record={record} />
          ))}
        </div>

        {detection.rowCount > preview.length ? (
          <p className="z-xs z-muted" style={{ marginTop: 'var(--z-space-3)' }}>
            Há mais {detection.rowCount - preview.length} linhas que não estão nesta amostra. A
            validação foi feita a todas.
          </p>
        ) : null}
      </Card>

      {/* --- Valores ilegíveis (§9.2) --- */}
      {valueIssues.length > 0 ? (
        <Card>
          <div className="z-card__header">
            <div>
              <div className="z-card__title">Valores que não consegui ler</div>
              <div className="z-card__subtitle">
                Estes campos ficam vazios no registo. Os registos entram à mesma.
              </div>
            </div>
            <Chip tone="warn">{valueIssues.length}</Chip>
          </div>

          <div className="z-table-wrap">
            <table className="z-table">
              <thead>
                <tr>
                  <th>Linha</th>
                  <th>Campo</th>
                  <th>O que estava lá</th>
                  <th>Porquê</th>
                </tr>
              </thead>
              <tbody>
                {valueIssues.slice(0, 20).map((issue, index) => (
                  <tr key={`${issue.line}-${issue.field}-${index}`}>
                    <td className="z-table__num">{issue.line}</td>
                    <td>{issue.field}</td>
                    <td>
                      <span className="z-mono z-truncate">{issue.raw === '' ? '(vazio)' : issue.raw}</span>
                    </td>
                    <td className="z-small z-muted">{issue.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {valueIssues.length > 20 ? (
            <p className="z-xs z-muted">
              Mostro as primeiras 20. As restantes {valueIssues.length - 20} estão no relatório
              no fim.
            </p>
          ) : null}
        </Card>
      ) : null}

      {/* --- Linhas ignoradas --- */}
      {skipped.length > 0 ? (
        <Card>
          <div className="z-card__header">
            <div>
              <div className="z-card__title">Linhas que não vão ser importadas</div>
              <div className="z-card__subtitle">
                Cada uma tem um motivo. Nenhuma é ignorada sem tu saberes.
              </div>
            </div>
            <Chip tone="neutral">{skipped.length}</Chip>
          </div>

          <ul className="z-stack z-stack--tight z-small">
            {skipped.slice(0, 20).map((row) => (
              <li key={row.line} className="z-row z-row--between">
                <span className="z-muted" style={{ flex: 'none' }}>
                  Linha {row.line}
                </span>
                <span style={{ textAlign: 'right' }}>{row.reason}</span>
              </li>
            ))}
          </ul>

          {skipped.length > 20 ? (
            <Disclosure label={`Ver as ${skipped.length - 20} linhas restantes`}>
              <ul className="z-stack z-stack--tight z-small">
                {skipped.slice(20).map((row) => (
                  <li key={row.line} className="z-row z-row--between">
                    <span className="z-muted" style={{ flex: 'none' }}>
                      Linha {row.line}
                    </span>
                    <span style={{ textAlign: 'right' }}>{row.reason}</span>
                  </li>
                ))}
              </ul>
            </Disclosure>
          ) : null}

          <Banner tone="info">
            <p className="z-small">
              Podes corrigir o ficheiro e voltar a importá-lo. As linhas que já entraram não são
              criadas outra vez.
            </p>
          </Banner>
        </Card>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Uma linha da pré-visualização                                               */
/* -------------------------------------------------------------------------- */

/**
 * Um registo normalizado.
 *
 * Mostra o número da linha de origem e os campos com nome legível. Os campos vazios
 * obrigatórios aparecem como um aviso na própria linha, e não numa lista à parte: um registo
 * que vai entrar incompleto tem de o dizer **onde** o utilizador está a olhar.
 */
function PreviewRow({ record }: { record: CsvRecordPreview }) {
  const fields = previewFields(record);
  const incomplete = record.emptyFields.length > 0;

  return (
    <div className="z-import__preview-row">
      <div className="z-row z-row--between">
        <span className="z-xs z-muted">Linha {record.line}</span>
        {incomplete ? (
          <Chip tone="warn">
            Falta {record.emptyFields.length === 1 ? 'um campo' : `${record.emptyFields.length} campos`}
          </Chip>
        ) : (
          <Chip tone="ok">Completo</Chip>
        )}
      </div>

      <dl className="z-import__preview-fields">
        {fields.map((field) => (
          <div key={field.field} className="z-import__preview-field">
            <dt className="z-xs z-muted">{field.label}</dt>
            <dd className="z-numeric">{field.value}</dd>
          </div>
        ))}
      </dl>

      {incomplete ? (
        <p className="z-xs" style={{ color: 'var(--z-warn)' }}>
          Sem {record.emptyFields.join(', ')}. O registo entra, mas com esta lacuna declarada.
        </p>
      ) : null}
    </div>
  );
}
