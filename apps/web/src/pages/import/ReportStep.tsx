import { Banner, Button, Card, Chip, DetailList, DetailRow, Disclosure } from '../../ui/primitives';
import { saveBlob } from '../../api/client';
import type { CsvApplyResponse } from '../../api/queries';
import { groupIssues, kindLabel } from '../../lib/csvImport';

/**
 * O relatório (§10.2, fase 9; §11.3).
 *
 * ## Porque é que o relatório é um artefacto e não uma mensagem
 *
 * A §11.3 diz que o relatório é «descarregável, guardado no histórico, com contagens e lista
 * de problemas». A diferença em relação a um aviso de sucesso é o que ele permite **depois**:
 * quem importou 8 000 linhas precisa de poder procurar as 40 que não entraram, e essa
 * procura faz-se numa folha de cálculo, não num ecrã de telemóvel. Por isso há um botão que
 * transfere o CSV que o servidor já construiu — não uma reconstrução feita aqui, que
 * divergiria do que ficou registado em auditoria.
 *
 * ## O que o relatório diz quando nada foi escrito
 *
 * Uma segunda importação do mesmo ficheiro não cria nada, e o relatório di-lo com a mesma
 * estrutura: os números são zero e a frase é diferente. Não há um caso especial "já importado"
 * com um ecrã próprio, porque a pergunta do utilizador é sempre a mesma — "o que é que
 * aconteceu?" — e a resposta tem a mesma forma.
 */
export function ReportStep({
  report,
  onRestart,
}: {
  report: CsvApplyResponse;
  onRestart: () => void;
}) {
  const issues = groupIssues(report.issues);

  const created = report.created.length;
  const enriched = report.enriched.length;
  const skipped = report.skipped.length;

  /*
   * O título é a frase que o utilizador vai querer repetir a alguém. Quando nada foi escrito,
   * a headline do servidor já explica porquê ("Este ficheiro já tinha sido importado"), pelo
   * que é ela que aparece — inventar aqui uma segunda redação produziria duas versões da
   * mesma verdade.
   */
  const title = report.applied
    ? created + enriched === 1
      ? 'Importei 1 registo'
      : `Importei ${created + enriched} registos`
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
          {created > 0 ? <DetailRow label="Registos criados" value={created} /> : null}
          {enriched > 0 ? <DetailRow label="Registos completados" value={enriched} /> : null}
          {skipped > 0 ? <DetailRow label="Linhas não importadas" value={skipped} /> : null}
          {report.batches > 1 ? <DetailRow label="Lotes de escrita" value={report.batches} /> : null}
        </DetailList>

        {/* --- A confirmação do mapa (o passo 9 da §10.2) --- */}
        {report.savedMap ? (
          <Banner tone="ok">
            <p className="z-small">
              {report.savedMap.reused ? (
                <>
                  Guardei de novo o mapa de colunas deste formato. Já o usaste{' '}
                  <strong>{report.savedMap.timesUsed}</strong>{' '}
                  {report.savedMap.timesUsed === 1 ? 'vez' : 'vezes'} — da próxima vez é um clique.
                </>
              ) : (
                <>
                  Guardei este mapa de colunas para a próxima vez que importares deste
                  fornecedor. O mesmo formato passa a ser um clique.
                </>
              )}
            </p>
          </Banner>
        ) : null}

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

      {/* --- O que foi criado --- */}
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
              <div className="z-card__title">Registos teus que ficaram mais completos</div>
              <div className="z-card__subtitle">
                Já existiam e o ficheiro trouxe campos que estavam vazios. Nada foi substituído.
              </div>
            </div>
            <Chip tone="accent">{enriched}</Chip>
          </div>
          <ul className="z-stack z-stack--tight z-small">
            {groupByKind(report.enriched).map((group) => (
              <li key={group.kind} className="z-row z-row--between">
                <span>{kindLabel(group.kind)}</span>
                <span className="z-numeric">{group.count}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* --- O que não entrou --- */}
      {skipped > 0 ? (
        <Card>
          <div className="z-card__header">
            <div>
              <div className="z-card__title">Linhas que não entraram</div>
              <div className="z-card__subtitle">Com o motivo de cada uma.</div>
            </div>
            <Chip tone="warn">{skipped}</Chip>
          </div>
          <ul className="z-stack z-stack--tight z-small">
            {report.skipped.slice(0, 30).map((row, index) => (
              <li key={`${row.localId}-${index}`} className="z-row z-row--between">
                <span className="z-truncate" style={{ minWidth: 0 }}>
                  {kindLabel(row.kind)} <span className="z-mono z-xs z-muted">{row.localId}</span>
                </span>
                <span className="z-muted" style={{ textAlign: 'right' }}>
                  {row.reason ?? 'Não foi possível interpretar'}
                </span>
              </li>
            ))}
          </ul>
          {skipped > 30 ? (
            <p className="z-xs z-muted">
              Mostro as primeiras 30. O ficheiro transferido tem a lista completa.
            </p>
          ) : null}
        </Card>
      ) : null}

      {/* --- Os problemas, agregados --- */}
      {issues.blocking.length > 0 || issues.recoverable.length > 0 ? (
        <Card>
          <div className="z-card__header">
            <div>
              <div className="z-card__title">Problemas</div>
              <div className="z-card__subtitle">
                {issues.blocking.length > 0
                  ? 'Alguns registos não entraram por causa destes problemas.'
                  : 'Estes registos entraram, mas com lacunas.'}
              </div>
            </div>
          </div>

          <Disclosure label={`Ver os ${issues.blocking.length + issues.recoverable.length} problemas`}>
            <ul className="z-stack z-stack--tight z-small">
              {aggregate([...issues.blocking, ...issues.recoverable]).map((entry, index) => (
                <li key={index} className="z-row z-row--between">
                  <span>{entry.message}</span>
                  {entry.count > 1 ? <Chip tone="neutral">{entry.count}</Chip> : null}
                </li>
              ))}
            </ul>
          </Disclosure>
        </Card>
      ) : null}

      {/* --- O histórico --- */}
      <Card soft>
        <div className="z-card__header">
          <div>
            <div className="z-card__title">Sobre esta importação</div>
          </div>
        </div>
        <p className="z-small z-muted">
          {report.applied
            ? 'Esta importação ficou registada no histórico da tua conta, com a data e a origem do pedido. Podes identificar todas as importações que fizeste.'
            : 'Uma importação sem alterações também fica registada, para que saibas que o ficheiro já tinha sido processado e não houve perda de dados.'}
        </p>
        <p className="z-xs z-muted z-mono z-truncate" style={{ marginTop: 'var(--z-space-2)' }}>
          Ficheiro: {report.bundleId}
        </p>
      </Card>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Agregações                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Conta por tipo de registo.
 *
 * O agrupamento é feito aqui e não pedido ao servidor porque a resposta já traz a lista
 * completa dos criados: somar no cliente não custa um pedido nem obriga o servidor a manter um
 * segundo agrupamento que teria de concordar com o primeiro.
 */
function groupByKind(items: readonly { kind: string }[]): Array<{ kind: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Junta mensagens iguais e conta-as.
 *
 * Numa importação de milhares de linhas as mensagens repetem-se; agrupá-las por texto (e não
 * por código) é o que permite a contagem conviver com a mensagem sem introduzir um dicionário
 * de códigos na interface. A §11.3 proíbe esses códigos precisamente para não ter de existir.
 */
function aggregate(items: readonly { message: string }[]): Array<{ message: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.message, (counts.get(item.message) ?? 0) + 1);
  return [...counts.entries()]
    .map(([message, count]) => ({ message, count }))
    .sort((a, b) => b.count - a.count);
}
