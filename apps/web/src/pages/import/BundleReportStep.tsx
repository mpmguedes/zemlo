import { Banner, Button, Card, Chip, DetailList, DetailRow, Disclosure } from '../../ui/primitives';
import { saveBlob } from '../../api/client';
import type { BundleApplyResponse } from '../../api/queries';
import { groupIssues, kindLabel } from '../../lib/csvImport';

/**
 * O relatório de uma importação de bundle (§11.3, §11.5).
 *
 * ## Porque é que o relatório é um artefacto e não uma mensagem
 *
 * A §11.3 diz que o relatório é «descarregável, guardado no histórico, com contagens e lista
 * de problemas». A diferença em relação a um aviso de sucesso é o que ele permite **depois**:
 * quem repôs uma cópia de segurança com milhares de registos precisa de poder procurar os que
 * não entraram, e essa procura faz-se numa folha de cálculo. Por isso há um botão que
 * transfere o CSV que o servidor já construiu — não uma reconstrução feita aqui, que
 * divergiria do que ficou registado em auditoria.
 *
 * ## O que o relatório diz quando nada foi escrito
 *
 * Importar duas vezes o mesmo ficheiro não cria nada — é a idempotência a funcionar (§9.5), e
 * não um erro. O relatório di-lo com a mesma estrutura: os números são zero e a frase é
 * diferente. Não há um caso especial "já importado" com um ecrã próprio, porque a pergunta do
 * utilizador é sempre a mesma — "o que é que aconteceu?" — e a resposta tem a mesma forma.
 *
 * ## O que este relatório diz que o do CSV não diz
 *
 * Nada de específico do formato. O relatório de uma importação é sobre **o que foi escrito**
 * — e isso não depende de os dados terem vindo de um CSV ou de um bundle. É por isso que este
 * componente é mais curto do que o da Camada 2: não há mapa de colunas a confirmar, porque um
 * bundle não tem colunas.
 */
export function BundleReportStep({
  report,
  onRestart,
}: {
  report: BundleApplyResponse;
  onRestart: () => void;
}) {
  const issues = groupIssues(report.issues);

  const created = report.created.length;
  const enriched = report.enriched.length;
  const skipped = report.skipped.length;

  /*
   * O título é a frase que o utilizador vai querer repetir a alguém. Quando nada foi escrito,
   * a `headline` do servidor já explica porquê ("Este ficheiro já tinha sido importado"), pelo
   * que é ela que aparece — inventar aqui uma segunda redação produziria duas versões da
   * mesma verdade.
   */
  const title = report.applied
    ? created + enriched === 1
      ? 'Recuperei 1 registo'
      : `Recuperei ${created + enriched} registos`
    : report.headline;

  return (
    <>
      <Card>
        <div className="z-card__header">
          <div>
            <div className="z-card__title">{title}</div>
            <div className="z-card__subtitle">
              {report.applied
                ? 'Estes registos já estão na tua conta. Podes vê-los no histórico.'
                : 'Nada foi alterado na tua conta.'}
            </div>
          </div>
          <Chip tone={report.applied ? 'ok' : 'neutral'}>
            {report.applied ? 'Concluído' : 'Sem alterações'}
          </Chip>
        </div>

        <DetailList>
          {created > 0 ? <DetailRow label="Registos criados" value={String(created)} /> : null}
          {enriched > 0 ? (
            <DetailRow label="Registos completados" value={String(enriched)} />
          ) : null}
          {skipped > 0 ? (
            <DetailRow label="Registos não importados" value={String(skipped)} />
          ) : null}
          {report.batches > 1 ? (
            <DetailRow label="Lotes de escrita" value={String(report.batches)} />
          ) : null}
        </DetailList>

        <div className="z-row z-row--wrap" style={{ gap: 'var(--z-space-2)' }}>
          {report.csv ? (
            <Button
              variant="secondary"
              onClick={() => {
                /*
                 * O CSV vem pronto do servidor. O nome do ficheiro é construído aqui porque a
                 * resposta é JSON (não um download), e por isso não há `Content-Disposition` —
                 * mas inclui a data para o ficheiro se distinguir dos anteriores na pasta de
                 * transferências.
                 */
                const blob = new Blob([report.csv], { type: 'text/csv;charset=utf-8' });
                saveBlob(blob, `zemlo-importacao-${new Date().toISOString().slice(0, 10)}.csv`);
              }}
            >
              Transferir o relatório
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onRestart}>
            Importar outro ficheiro
          </Button>
        </div>
      </Card>

      {/* --- O que foi criado, por tipo --- */}
      {created > 0 ? (
        <Card>
          <div className="z-card__header">
            <div>
              <div className="z-card__title">O que foi criado</div>
              <div className="z-card__subtitle">Agrupado por tipo de registo.</div>
            </div>
          </div>
          <ul className="z-stack z-stack--tight z-small">
            {groupByKind(report.created).map((group) => (
              <li key={group.kind} className="z-row z-row--between">
                <span>{kindLabel(group.kind)}</span>
                <span className="z-numeric">{group.count}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* --- O que foi completado --- */}
      {enriched > 0 ? (
        <Card>
          <div className="z-card__header">
            <div>
              <div className="z-card__title">Registos que completei</div>
              <div className="z-card__subtitle">
                Já os tinhas. Só os campos que estavam vazios foram preenchidos.
              </div>
            </div>
          </div>
          <ul className="z-stack z-stack--tight z-small">
            {report.enriched.slice(0, 30).map((item) => (
              <li key={item.localId} className="z-row z-row--between">
                <span>{kindLabel(item.kind)}</span>
                <span className="z-xs z-muted">{item.fields.join(', ')}</span>
              </li>
            ))}
            {report.enriched.length > 30 ? (
              <li className="z-xs z-muted">… e mais {report.enriched.length - 30}.</li>
            ) : null}
          </ul>
        </Card>
      ) : null}

      {/* --- O que ficou de fora --- */}
      {skipped > 0 ? (
        <Card>
          <div className="z-card__header">
            <div>
              <div className="z-card__title">O que não entrou</div>
              <div className="z-card__subtitle">Cada um com a razão.</div>
            </div>
          </div>
          <ul className="z-stack z-stack--tight z-small">
            {report.skipped.slice(0, 30).map((item) => (
              <li key={item.localId}>
                <span className="z-row" style={{ gap: 'var(--z-space-2)' }}>
                  <span className="z-strong">{kindLabel(item.kind)}</span>
                  <span className="z-xs z-muted">{item.reason}</span>
                </span>
              </li>
            ))}
            {report.skipped.length > 30 ? (
              <li className="z-xs z-muted">… e mais {report.skipped.length - 30}.</li>
            ) : null}
          </ul>
        </Card>
      ) : null}

      {issues.blocking.length > 0 ? (
        <Banner tone="danger">
          <p className="z-small">{issues.blocking[0]!.message}</p>
        </Banner>
      ) : null}

      {issues.recoverable.length + issues.info.length > 0 ? (
        <Disclosure label={`Avisos (${issues.recoverable.length + issues.info.length})`}>
          <ul className="z-stack z-stack--tight z-small z-muted">
            {[...issues.recoverable, ...issues.info].slice(0, 50).map((issue, index) => (
              <li key={`${issue.code}:${index}`}>{issue.message}</li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </>
  );
}

/**
 * Agrupa os registos criados por tipo.
 *
 * A ordenação é por contagem decrescente: numa importação de uma conta inteira, o tipo com
 * mais registos é o que o utilizador vai querer confirmar primeiro, e deixá-lo algures no
 * meio de uma lista de catorze obrigaria a procurá-lo.
 */
function groupByKind(records: readonly { kind: string }[]): Array<{ kind: string; count: number }> {
  const counts = new Map<string, number>();
  for (const record of records) {
    counts.set(record.kind, (counts.get(record.kind) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}
