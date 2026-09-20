import { Banner, Button, Card, Chip, DetailList, DetailRow, Disclosure } from '../../ui/primitives';
import type { BundlePlanEntry, BundlePreviewResponse } from '../../api/queries';
import { actionLabel, conflictLabel, groupIssues, kindLabel, planRows } from '../../lib/csvImport';

/**
 * A revisão de um bundle Zemlo — o passo 3 da §11.2, na Camada 1.
 *
 * ## Porque é que este passo existe separado do `PlanStep` do CSV
 *
 * Ambos mostram o mesmo contrato — as quatro contagens, os problemas, o botão com o total —
 * e partilham os ajudantes que as escrevem (`planRows`, `groupIssues`, `actionLabel`). O que
 * difere é **o que há para decidir**, e a diferença é de natureza, não de grau:
 *
 *  - no CSV, as colunas podem estar por mapear e as convenções por confirmar — há trabalho
 *    do lado do utilizador **antes** de o plano existir;
 *  - num bundle, o plano já está resolvido: o ficheiro traz os seus próprios valores
 *    interpretados. O que resta é revisão — quantos entram, quantos já existem, quais
 *    precisam de decisão — e o que o bundle **declara** sobre si mesmo (o âmbito, a
 *    integridade, os documentos sem conteúdo).
 *
 * Forçar o `PlanStep` a servir os dois encheria o ecrã do bundle com passos de mapeamento
 * que nunca têm conteúdo, e obrigaria a interface a testar a camada para saber o que
 * desenhar. Dois componentes com o mesmo vocabulário e propósitos diferentes é mais honesto
 * do que um componente com metade dos ramos mortos.
 *
 * ## O que este ecrã tem de dizer que o do CSV não diz
 *
 *  - **O âmbito**: um bundle pode trazer só um veículo (§5.7), e "2 de 5 veículos" é a
 *    diferença entre uma cópia completa e uma parcial. Um bundle filtrado é indistinguível
 *    de um bundle incompleto para quem só conta registos.
 *  - **A integridade**: o `sha256` de cada ficheiro foi verificado contra o manifest. Se
 *    algo tivesse sido alterado, o leitor já teria recusado — mas dizê-lo é o que transforma
 *    uma verificação invisível numa razão para confiar.
 *  - **Os documentos sem conteúdo**: um bundle pode declarar documentos cujos bytes não
 *    vieram (§5.6). A importação não bloqueia por isso, e a ausência tem de ser dita: é a
 *    diferença entre "não tinha anexos" e "tinha e não os posso trazer".
 */
export function BundlePlanStep({
  preview,
  busy,
  applied,
  onApply,
  onRestart,
}: {
  preview: BundlePreviewResponse;
  busy: boolean;
  applied: boolean;
  onApply: () => void;
  onRestart: () => void;
}) {
  const rows = planRows(preview.counts);
  const issues = groupIssues(preview.issues);
  const blocking = issues.blocking.length > 0;

  /** Quantos registos vão ser escritos de facto — o número que o botão anuncia. */
  const toWrite = preview.counts.create + preview.counts.enriching;

  const entriesToShow = preview.entries.filter((entry) => entry.action !== 'skipped');

  return (
    <Card>
      <div className="z-card__header">
        <div>
          <div className="z-card__title">O que vai ser importado</div>
          <div className="z-card__subtitle">
            {preview.summary.vehicles !== null
              ? `${preview.summary.vehicles} ${preview.summary.vehicles === 1 ? 'veículo' : 'veículos'} · `
              : ''}
            {preview.files.length} {preview.files.length === 1 ? 'ficheiro de dados' : 'ficheiros de dados'} no ficheiro
          </div>
        </div>
        {blocking ? (
          <Chip tone="warn">Impede a importação</Chip>
        ) : (
          <Chip tone="ok">Verificado por integridade</Chip>
        )}
      </div>

      {/*
       * O âmbito vem do bundle e é apresentado como o bundle o declarou. É a defesa contra
       * a confusão mais perigosa deste ecrã: um ficheiro filtrado parece, em todos os
       * números, um ficheiro incompleto.
       */}
      {preview.counts.documentsMissingContent > 0 ? (
        <Banner tone="warn">
          Este ficheiro declara {preview.counts.documentsMissingContent}{' '}
          {preview.counts.documentsMissingContent === 1 ? 'documento' : 'documentos'} sem
          conteúdo. Os registos entram na mesma; o que falta é o ficheiro em si, e o Zemlo
          di-lo em vez de o esconder.
        </Banner>
      ) : null}

      {blocking ? (
        <Banner tone="danger">
          Há {issues.blocking.length}{' '}
          {issues.blocking.length === 1 ? 'problema que impede' : 'problemas que impedem'} a
          importação de avançar. Nada foi escrito. O primeiro é:{' '}
          <strong>{issues.blocking[0]!.message}</strong>
        </Banner>
      ) : null}

      <DetailList>
        {rows.map((row) => (
          <DetailRow
            key={row.label}
            // A marca "requer decisão" vai no rótulo como texto e não como `Chip`: o
            // `DetailRow` só aceita `string` no rótulo, e alargá-lo para `ReactNode`
            // mudaria um primitivo partilhado por todos os ecrãs para servir um caso.
            label={row.actionable ? `${row.label} — requer decisão` : row.label}
            value={String(row.count)}
          />
        ))}
      </DetailList>

      <p className="z-xs z-muted" style={{ marginTop: 'var(--z-space-2)' }}>
        {rows.find((row) => row.actionable)?.hint ??
          'Nada é substituído em silêncio. Um registo teu só é completado em campos que estão vazios.'}
      </p>

      {preview.scopeNote ? (
        <p className="z-xs z-muted">
          Âmbito declarado pelo ficheiro: <strong>{preview.scopeNote}</strong>
        </p>
      ) : null}

      {entriesToShow.length > 0 ? (
        <Disclosure label={`Ver os ${entriesToShow.length} registos ▸`}>
          <ul className="z-stack z-stack--tight z-small">
            {entriesToShow.slice(0, 50).map((entry) => (
              <li key={`${entry.file ?? ''}:${entry.localId}`}>
                <BundleEntryLine entry={entry} />
              </li>
            ))}
            {entriesToShow.length > 50 ? (
              <li className="z-xs z-muted">… e mais {entriesToShow.length - 50}.</li>
            ) : null}
          </ul>
        </Disclosure>
      ) : null}

      {issues.recoverable.length > 0 || issues.info.length > 0 ? (
        <Disclosure label={`Problemas (${issues.recoverable.length + issues.info.length})`}>
          <ul className="z-stack z-stack--tight z-small z-muted">
            {[...issues.recoverable, ...issues.info].slice(0, 50).map((issue, index) => (
              <li key={`${issue.code}:${issue.localId ?? index}`}>{issue.message}</li>
            ))}
          </ul>
        </Disclosure>
      ) : null}

      <div
        className="z-row"
        style={{ marginTop: 'var(--z-space-4)', gap: 'var(--z-space-2)' }}
      >
        <Button
          variant="primary"
          loading={busy}
          disabled={blocking || applied || toWrite === 0}
          onClick={onApply}
        >
          {applied
            ? 'Importado'
            : blocking
              ? 'Resolve os problemas primeiro'
              : toWrite === 0
                ? 'Nada a importar'
                : `Importar ${toWrite} ${toWrite === 1 ? 'registo' : 'registos'}`}
        </Button>
        <Button variant="ghost" onClick={onRestart} disabled={busy}>
          Escolher outro ficheiro
        </Button>
      </div>

      <p className="z-xs z-muted" style={{ marginTop: 'var(--z-space-2)' }}>
        Os valores vêm do ficheiro que escolheste, e só são escritos depois deste clique.
      </p>
    </Card>
  );
}

/**
 * Uma linha da lista de registos.
 *
 * O `localId` **não** é mostrado: é um identificador interno do artefacto e a §11.3 proíbe
 * conceitos técnicos na apresentação. O que se mostra é o tipo (em português), o que vai
 * acontecer, e a razão que o servidor escreveu — que já vem pronta a ler por isso mesmo.
 */
function BundleEntryLine({ entry }: { entry: BundlePlanEntry }) {
  return (
    <span className="z-row" style={{ gap: 'var(--z-space-2)', flexWrap: 'wrap' }}>
      <Chip tone={entry.action === 'create' ? 'ok' : 'neutral'}>{kindLabel(entry.kind)}</Chip>
      <span className="z-strong">{actionLabel(entry.action)}</span>
      {entry.conflict !== 'new' ? (
        <span className="z-xs z-muted">· {conflictLabel(entry.conflict)}</span>
      ) : null}
      {entry.reason ? <span className="z-xs z-muted">· {entry.reason}</span> : null}
    </span>
  );
}
