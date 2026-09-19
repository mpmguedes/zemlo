import { useState } from 'react';
import { Banner, Button, Card, Chip, DetailList, DetailRow, Disclosure } from '../../ui/primitives';
import type { ImportPlanView, PlanEntry, SavedMapSummary } from '../../api/queries';
import { actionLabel, conflictLabel, groupIssues, kindLabel, planRows } from '../../lib/csvImport';

/**
 * O plano — o passo 3 da §11.2.
 *
 * ## Porque é que este é o passo que a especificação mais protege
 *
 * A §11.3 é taxativa: «*Nada acontece sem o utilizador ver o que vai acontecer. O passo 3
 * existe sempre. Nunca há um botão que importa logo após escolher o ficheiro.*» Este
 * componente é esse passo. As quatro contagens estão sempre à vista, mesmo quando são todas
 * triviais, porque um ecrã que só mostra números quando eles são maus não permite confirmar
 * que nada ficou de fora.
 *
 * ## A distinção entre "já existem" e "precisam de decisão"
 *
 * São as duas contagens que a §11.2 separa, e a diferença é a única que muda o que o
 * utilizador tem de fazer:
 *
 *  - **Já existem** — idênticos. Não há nada a decidir e nada é criado. É informação.
 *  - **Precisam de decisão** — podem já existir (deduplicação provável) ou falta-lhes um campo
 *    obrigatório. Aqui há registos que **não vão entrar** sem uma resposta, e o ecrã tem de o
 *    dizer com o nome certo.
 *
 * ## Porque é que o botão diz o número
 *
 * «Importar 298 registos» e não «Importar». O número é a última coisa que o utilizador lê
 * antes de escrever, e o que ele vai comparar com o que esperava. Um botão que diz só
 * «Importar» obriga a subir o olho para as contagens e a fazer a soma mental — e é exatamente
 * no momento em que ele não a quer fazer.
 */
export function PlanStep({
  plan,
  savedMap,
  busy,
  applied,
  onApply,
  onBack,
}: {
  plan: ImportPlanView;
  savedMap: SavedMapSummary | null;
  busy: boolean;
  applied: boolean;
  onApply: () => void;
  onBack: () => void;
}) {
  const rows = planRows(plan.counts);
  const issues = groupIssues(plan.issues);

  /*
   * As decisões pendentes contam-se a partir das **entradas** do plano e não das contagens:
   * uma entrada `probable` ou `quarantined` é um registo concreto que não entra, e é isso que
   * o utilizador precisa de ver nomeado. As contagens dizem quantos; a lista diz quais.
   */
  const needDecision = plan.entries.filter(
    (entry) => entry.action === 'probable' || entry.action === 'quarantined',
  );

  const canApply = plan.state === 'ready' && plan.counts.create + plan.counts.enriching > 0;

  return (
    <Card>
      <div className="z-card__header">
        <div>
          <div className="z-card__title">O que vai acontecer</div>
          <div className="z-card__subtitle">
            Ainda não foi escrito nada. Confirma para importar.
          </div>
        </div>
        <Chip tone={canApply ? 'ok' : plan.state === 'blocked' ? 'danger' : 'neutral'}>
          {plan.state === 'ready'
            ? 'Tudo em ordem'
            : plan.state === 'blocked'
              ? 'Há problemas'
              : 'Nada a fazer'}
        </Chip>
      </div>

      {/* --- As quatro contagens --- */}
      <div className="z-import__counts">
        {rows.map((row) => (
          <div key={row.label} className={`z-import__count z-import__count--${row.tone}`}>
            <span className="z-import__count-value z-numeric">{row.count}</span>
            <span className="z-import__count-label">{row.label}</span>
            {row.hint ? <span className="z-import__count-hint z-xs z-muted">{row.hint}</span> : null}
          </div>
        ))}
      </div>

      {/* --- O mapa guardado (passo 9 da §10.2) --- */}
      {savedMap ? (
        <Banner tone={savedMap.reused ? 'ok' : 'info'}>
          <p className="z-small">
            {savedMap.reused ? (
              <>
                Usei o mapa de colunas que guardaste da última vez{' '}
                {savedMap.timesUsed > 1 ? `(já o usaste ${savedMap.timesUsed} vezes)` : ''}. Se o
                fornecedor mudou o formato, as colunas novas aparecem abaixo.
              </>
            ) : (
              <>Vou guardar este mapa depois de importar. Da próxima vez é um clique.</>
            )}
          </p>
          {savedMap.uncoveredColumns.length > 0 ? (
            <p className="z-small" style={{ marginTop: 'var(--z-space-2)' }}>
              <strong>Colunas novas neste ficheiro:</strong> {savedMap.uncoveredColumns.join(', ')}.
              Não estão mapeadas — volta às colunas para as incluir.
            </p>
          ) : null}
          {savedMap.unmatchedHeaders.length > 0 ? (
            <p className="z-small" style={{ marginTop: 'var(--z-space-2)' }}>
              <strong>Colunas que desapareceram:</strong> {savedMap.unmatchedHeaders.join(', ')}. O
              mapa guardado tinha-as, o ficheiro já não.
            </p>
          ) : null}
        </Banner>
      ) : null}

      {/* --- Os registos que precisam de decisão --- */}
      {needDecision.length > 0 ? (
        <Disclosure label={`Ver os ${needDecision.length} registos que precisam de decisão`} defaultOpen>
          <div className="z-stack z-stack--tight">
            {needDecision.slice(0, 50).map((entry, index) => (
              <EntryRow key={`${entry.localId}-${index}`} entry={entry} />
            ))}
          </div>
          {needDecision.length > 50 ? (
            <p className="z-xs z-muted">
              Mostro os primeiros 50. O relatório no fim traz a lista completa.
            </p>
          ) : null}
        </Disclosure>
      ) : null}

      {/* --- Os duplicados, agrupados (§11.4) --- */}
      {plan.counts.exact > 0 ? (
        <Disclosure label={`Ver os ${plan.counts.exact} registos que já tens`}>
          <p className="z-small z-muted">
            Estes registos já existem na tua conta com o mesmo conteúdo. Não são criados outra
            vez nem alterados.
          </p>
          <div className="z-stack z-stack--tight">
            {plan.entries
              .filter((entry) => entry.action === 'exact')
              .slice(0, 30)
              .map((entry, index) => (
                <EntryRow key={`${entry.localId}-exact-${index}`} entry={entry} compact />
              ))}
          </div>
        </Disclosure>
      ) : null}

      {/* --- Os problemas agregados (§9.2) --- */}
      {issues.blocking.length > 0 || issues.recoverable.length > 0 ? (
        <Disclosure label="Problemas encontrados" defaultOpen={issues.blocking.length > 0}>
          {issues.blocking.length > 0 ? (
            <Banner tone="danger" title={`${issues.blocking.length} impedem a importação`}>
              <ul className="z-stack z-stack--tight z-small">
                {topIssues(issues.blocking).map((issue, index) => (
                  <li key={index}>{issue.message}</li>
                ))}
              </ul>
              <p className="z-xs">
                Corrige o ficheiro e volta a importá-lo. Nada foi escrito, e o que já tinha sido
                importado anteriormente não se perde.
              </p>
            </Banner>
          ) : null}

          {issues.recoverable.length > 0 ? (
            <div style={{ marginTop: issues.blocking.length > 0 ? 'var(--z-space-3)' : 0 }}>
              <p className="z-small">
                <strong>{issues.recoverable.length} problemas recuperáveis.</strong> Estes
                registos entram, com a lacuna declarada.
              </p>
              <ul className="z-stack z-stack--tight z-small z-muted">
                {topIssues(issues.recoverable).map((issue, index) => (
                  <li key={index}>{issue.message}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </Disclosure>
      ) : null}

      {/* --- O resumo técnico, para quem o quiser --- */}
      <Disclosure label="Ver o resumo da análise">
        <DetailList>
          <DetailRow label="Total de registos considerados" value={plan.counts.total} />
          <DetailRow label="A criar" value={plan.counts.create} />
          <DetailRow label="Já existentes" value={plan.counts.exact} />
          <DetailRow label="A completar registos teus" value={plan.counts.enriching} />
          <DetailRow label="Por decidir" value={plan.counts.probable} />
          <DetailRow label="Em quarentena" value={plan.counts.quarantined} />
          <DetailRow label="Ignorados" value={plan.counts.skipped} />
        </DetailList>
        <p className="z-xs z-muted" style={{ marginTop: 'var(--z-space-2)' }}>
          Este resumo é o que fica no relatório depois de importares.
        </p>
      </Disclosure>

      {/* --- A ação --- */}
      <div className="z-row z-row--between z-row--wrap" style={{ gap: 'var(--z-space-2)' }}>
        <Button variant="ghost" onClick={onBack} disabled={busy || applied}>
          Voltar às colunas
        </Button>

        <Button
          variant="highlight"
          onClick={onApply}
          loading={busy}
          disabled={!canApply || applied}
        >
          {buttonLabel(plan, applied)}
        </Button>
      </div>

      {!canApply && !applied ? (
        <p className="z-xs z-muted" style={{ textAlign: 'right' }}>
          {plan.state === 'blocked'
            ? 'Resolve os problemas acima para continuar.'
            : plan.counts.exact > 0
              ? 'Estes registos já estão todos na tua conta. Não há nada a importar.'
              : 'Não há registos novos para importar.'}
        </p>
      ) : null}
    </Card>
  );
}

/** O rótulo do botão, com o número que vai ser escrito. */
function buttonLabel(plan: ImportPlanView, applied: boolean): string {
  if (applied) return 'Importado';
  const total = plan.counts.create + plan.counts.enriching;
  if (total === 0) return 'Nada a importar';
  const noun = total === 1 ? 'registo' : 'registos';
  if (plan.counts.enriching > 0 && plan.counts.create === 0) {
    return `Completar ${total} ${noun}`;
  }
  return `Importar ${total} ${noun}`;
}

/**
 * Os problemas mais repetidos, sem repetições.
 *
 * Uma importação grande traz centenas de problemas iguais. Listar todos transformaria o aviso
 * numa parede de texto igual e faria o utilizador desistir de ler — a mesma razão pela qual o
 * servidor agrega por código (`summarizeIssues`). Aqui junta-se a contagem à mensagem, para
 * que «412 registos com data ilegível» seja uma frase e não 412 linhas.
 */
function topIssues(issues: readonly { message: string; code: string }[]): Array<{ message: string }> {
  const byCode = new Map<string, { message: string; count: number }>();
  for (const issue of issues) {
    const existing = byCode.get(issue.code);
    if (existing) existing.count += 1;
    else byCode.set(issue.code, { message: issue.message, count: 1 });
  }
  return [...byCode.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((entry) => ({
      message: entry.count === 1 ? entry.message : `${entry.message} (${entry.count} registos)`,
    }));
}

/** Um registo do plano, com a razão e o que diverge. */
function EntryRow({ entry, compact = false }: { entry: PlanEntry; compact?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="z-import__entry">
      <div className="z-row z-row--between">
        <span className="z-row" style={{ gap: 'var(--z-space-2)', minWidth: 0 }}>
          {entry.line !== undefined ? (
            <span className="z-xs z-muted" style={{ flex: 'none' }}>
              Linha {entry.line}
            </span>
          ) : null}
          <span className="z-small z-truncate">{kindLabel(entry.kind)}</span>
        </span>
        <span className="z-row" style={{ gap: 'var(--z-space-1)', flex: 'none' }}>
          <Chip tone={toneForAction(entry.action)}>{actionLabel(entry.action)}</Chip>
          {entry.conflict !== 'new' && entry.conflict !== 'duplicate' ? (
            <Chip tone={entry.conflict === 'conflict' ? 'danger' : 'accent'}>
              {conflictLabel(entry.conflict)}
            </Chip>
          ) : null}
        </span>
      </div>

      {entry.reason ? <p className="z-xs z-muted">{entry.reason}</p> : null}

      {!compact && (entry.conflictingFields.length > 0 || entry.enrichableFields.length > 0) ? (
        <button type="button" className="z-import__entry-toggle z-xs" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Esconder detalhes' : 'Ver o que difere'}
        </button>
      ) : null}

      {open ? (
        <ul className="z-stack z-stack--tight z-xs z-muted">
          {entry.conflictingFields.length > 0 ? (
            <li>
              <strong>Diferente do que tens:</strong> {entry.conflictingFields.join(', ')}.
            </li>
          ) : null}
          {entry.enrichableFields.length > 0 ? (
            <li>
              <strong>Vou preencher:</strong> {entry.enrichableFields.join(', ')}.
            </li>
          ) : null}
          {entry.issues.length > 0 ? (
            <li>
              {entry.issues.length} {entry.issues.length === 1 ? 'aviso' : 'avisos'} neste registo.
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function toneForAction(action: PlanEntry['action']): 'ok' | 'warn' | 'danger' | 'neutral' | 'accent' {
  switch (action) {
    case 'create':
      return 'ok';
    case 'probable':
      return 'warn';
    case 'quarantined':
      return 'danger';
    case 'exact':
      return 'neutral';
    default:
      return 'neutral';
  }
}
