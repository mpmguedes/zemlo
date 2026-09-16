import { Link } from 'react-router-dom';
import {
  REMINDER_STATES,
  findOption,
  formatNumber,
  type DashboardResponse,
  type ReminderState,
  type StatusCard as StatusCardModel,
  type TimelineItem,
} from '@zemlo/shared';
import { Card, Chip, EmptyState, Metric, Section } from '../ui/primitives';
import { dateLong, money, moneyCompact } from '../lib/format';
import { MonthlyBars } from './charts';

/**
 * Componentes de domínio reutilizados por vários ecrãs.
 *
 * Todos recebem dados já carregados e não fazem pedidos: quem decide o que carregar é o
 * ecrã. Um componente que fosse buscar os seus próprios dados tornaria impossível desenhar
 * o dashboard com uma única consulta — e o dashboard do Zemlo agrega um ano de registos,
 * pelo que uma consulta por cartão seria oito vezes mais lenta.
 */

/* -------------------------------------------------------------------------- */
/* Cartões de estado (§8)                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Cor de um estado.
 *
 * A escala é a da §57: `ok` e `unknown` em tons calmos, `soon` em âmbar (o aviso que pede
 * atenção sem alarme), `due`/`overdue` em âmbar forte e laranja queimado. Não há vermelho
 * vivo: uma revisão fora de prazo é uma tarefa, não uma emergência, e um painel pintado de
 * vermelho deixa de ser lido (§59).
 */
const STATE_TONE: Record<ReminderState, 'ok' | 'soon' | 'due' | 'overdue' | 'unknown'> = {
  ok: 'ok',
  soon: 'soon',
  due: 'due',
  overdue: 'overdue',
  unknown: 'unknown',
};

/** Etiqueta legível de um estado, a partir do registo partilhado. */
export function stateLabel(state: ReminderState): string {
  return findOption(REMINDER_STATES, state)?.label ?? state;
}

/**
 * Cartão de estado.
 *
 * O estado aparece por três canais redundantes — cor da barra, ícone e texto — porque a cor
 * sozinha exclui quem não a distingue. Quando o cartão traz um `href`, é uma ligação: o
 * utilizador que vê "Revisão — em atraso" quer ir tratar disso, e obrigá-lo a procurar o
 * ecrã certo é o tipo de atrito que faz abandonar o registo.
 */
export function StatusCard({ card }: { card: StatusCardModel }) {
  const tone = STATE_TONE[card.state];
  const content = (
    <>
      <span className="z-state-card__icon" aria-hidden="true">
        {card.icon}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="z-state-card__label" style={{ display: 'block' }}>
          {card.label}
        </span>
        <span className="z-state-card__value z-numeric" style={{ display: 'block' }}>
          {card.value}
        </span>
        {card.hint ? (
          <span className="z-state-card__hint" style={{ display: 'block' }}>
            {card.hint}
          </span>
        ) : null}
      </span>
      <span className="z-sr-only">{stateLabel(card.state)}</span>
    </>
  );

  if (card.href) {
    return (
      <Link to={card.href} className={`z-state-card z-state-card--${tone}`}>
        {content}
      </Link>
    );
  }

  return <div className={`z-state-card z-state-card--${tone}`}>{content}</div>;
}

export function StatusGrid({ cards }: { cards: StatusCardModel[] }) {
  if (cards.length === 0) {
    return (
      <p className="z-small z-muted">
        Ainda não há nada com prazo marcado neste veículo. Registar o seguro e a inspeção é o
        que passa a alimentar estes cartões.
      </p>
    );
  }

  return (
    <div className="z-grid z-grid--3">
      {cards.map((card) => (
        <StatusCard key={card.key} card={card} />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Cabeçalho do veículo                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Cabeçalho do veículo em foco.
 *
 * A quilometragem é o número maior do ecrã: é o dado que o utilizador tem sempre em mente e
 * que envelhece mais depressa. A origem da leitura aparece ao lado (`Manual`, `OBD`, `API
 * Kia`) porque a §50 exige que se saiba de onde vem um dado antes de confiar nele —
 * sobretudo quando passar a haver várias fontes a escrever o mesmo número.
 */
export function VehicleHero({ vehicle }: { vehicle: DashboardResponse['vehicle'] }) {
  if (!vehicle) {
    return (
      <Card soft>
        <EmptyState
          icon="🚗"
          title="Ainda não tens veículos"
          body="Adiciona o primeiro veículo para começares a acompanhar custos, manutenção e prazos. Só precisamos da matrícula."
          action={
            <Link to="/onboarding/veiculo" className="z-btn z-btn--primary">
              Adicionar veículo
            </Link>
          }
        />
      </Card>
    );
  }

  return (
    <section className="z-vehicle-hero" aria-label="Veículo em foco">
      <span className="z-vehicle-hero__emoji" aria-hidden="true">
        {vehicle.emoji}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="z-vehicle-hero__title">{vehicle.title}</div>
        <div className="z-vehicle-hero__plate">{vehicle.plateDisplay}</div>
        {vehicle.subtitle && vehicle.subtitle !== vehicle.title ? (
          <div className="z-vehicle-hero__plate">{vehicle.subtitle}</div>
        ) : null}
      </div>
      <div className="z-vehicle-hero__odometer">
        <div className="z-vehicle-hero__odometer-label">Quilometragem</div>
        <div className="z-vehicle-hero__odometer-value">
          {vehicle.odometerKm === null ? '—' : `${formatNumber(vehicle.odometerKm, 0)} km`}
        </div>
        {vehicle.odometerSourceLabel ? (
          <div className="z-vehicle-hero__odometer-label">{vehicle.odometerSourceLabel}</div>
        ) : null}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Resumo financeiro (§8)                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Resumo financeiro do ano.
 *
 * A comparação com o ano anterior é apresentada quando existe e **nunca como variação
 * percentual alarmista**: a §59 pede informação, e um "▲ 39 %" em vermelho a meio do painel
 * não informa ninguém — ainda por cima quando o ano anterior tinha menos meses de histórico.
 * Por isso a frase é descritiva: "mais 34 528 € do que em igual período de 2025".
 */
export function FinanceSummary({ finance }: { finance: DashboardResponse['finance'] }) {
  const delta = finance.yearTotalCents - finance.previousYearSamePeriodCents;
  const hasPrevious = finance.previousYearSamePeriodCents > 0;

  return (
    <Card>
      <div className="z-card__header">
        <div>
          <div className="z-card__title">Custos de {finance.year}</div>
          <div className="z-card__subtitle">
            Total do ano e comparação com o mesmo período de {finance.year - 1}
          </div>
        </div>
      </div>

      <div className="z-grid z-grid--3">
        <Metric label={`Total em ${finance.year}`} value={money(finance.yearTotalCents)} />
        <Metric
          label="Este mês"
          value={money(finance.monthTotalCents)}
          hint={finance.monthAverageCents !== null ? `média mensal ${money(finance.monthAverageCents)}` : undefined}
        />
        <Metric
          label={`Igual período de ${finance.year - 1}`}
          value={money(finance.previousYearSamePeriodCents)}
          hint={
            hasPrevious
              ? delta >= 0
                ? `${money(delta)} a mais`
                : `${money(Math.abs(delta))} a menos`
              : 'sem histórico comparável'
          }
          small
        />
      </div>

      {finance.monthly.length > 0 ? (
        <div style={{ marginTop: 'var(--z-space-5)' }}>
          <MonthlyBars
            data={finance.monthly}
            ariaLabel={`Custos mensais de ${finance.year}: ${finance.monthly
              .map((month) => `${month.label} ${moneyCompact(month.amountCents)}`)
              .join(', ')}`}
          />
        </div>
      ) : null}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Lacunas de dados (§49)                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Lacunas de dados.
 *
 * A §49 e a §59 são explícitas: isto não é um erro. Não há vermelho, não há ícone de aviso,
 * não há a palavra "falta" numa tipografia que acusa. Há um convite — e cada convite leva ao
 * sítio exato onde se resolve. O Zemlo funciona com dados incompletos; completá-los só
 * melhora a qualidade dos números.
 */
export function DataGaps({ gaps }: { gaps: DashboardResponse['dataGaps'] }) {
  if (gaps.length === 0) return null;

  return (
    <Section
      title="Para números mais precisos"
      hint={gaps.length === 1 ? 'uma sugestão' : `${gaps.length} sugestões`}
    >
      <div className="z-datagaps">
        {gaps.map((gap) => {
          const body = (
            <>
              <span className="z-datagap__icon" aria-hidden="true">
                ✨
              </span>
              <span>
                <span className="z-datagap__title" style={{ display: 'block' }}>
                  {gap.title}
                </span>
                <span className="z-datagap__message" style={{ display: 'block' }}>
                  {gap.message}
                </span>
              </span>
            </>
          );
          return gap.href ? (
            <Link key={gap.key} to={gap.href} className="z-datagap" style={{ color: 'inherit' }}>
              {body}
            </Link>
          ) : (
            <div key={gap.key} className="z-datagap">
              {body}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Timeline (§24)                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Item de histórico.
 *
 * O item mostra, por esta ordem: o que aconteceu (ícone e título), quando, os valores em
 * contexto (quilometragem, litros, consumo — já formatados em português pela API) e o valor
 * monetário à direita. As `metrics` vêm prontas da API e são renderizadas como texto: a API
 * é quem sabe qual métrica faz sentido para cada tipo de registo, e reimplementar essa
 * decisão na web criaria duas verdades sobre o mesmo evento.
 */
export function TimelineRow({ item, showVehicle = false }: { item: TimelineItem; showVehicle?: boolean }) {
  const body = (
    <>
      <span className="z-timeline__rail">
        <span className="z-timeline__dot" aria-hidden="true">
          {item.icon}
        </span>
      </span>
      <span className="z-timeline__body">
        <span className="z-row" style={{ gap: 'var(--z-space-2)', flexWrap: 'wrap' }}>
          <span className="z-strong">{item.title}</span>
          {showVehicle ? <Chip>{item.vehiclePlateDisplay}</Chip> : null}
        </span>
        {item.subtitle ? (
          <span className="z-list__meta" style={{ display: 'block' }}>
            {item.subtitle}
          </span>
        ) : null}
        {item.metrics.length > 0 ? (
          <span className="z-timeline__metrics">
            {item.metrics.map((metric) => (
              <span className="z-timeline__metric" key={metric.label}>
                {metric.label}: <span className="z-timeline__metric-value">{metric.value}</span>
              </span>
            ))}
          </span>
        ) : null}
      </span>
      <span className="z-timeline__amount">
        {item.amountCents !== null ? money(item.amountCents) : ''}
        <span className="z-timeline__date" style={{ display: 'block' }}>
          {dateLong(item.date)}
        </span>
      </span>
    </>
  );

  if (item.href) {
    return (
      <Link to={item.href} className="z-timeline__item">
        {body}
      </Link>
    );
  }

  return <div className="z-timeline__item">{body}</div>;
}

/** Agrupa itens por mês, para o cabeçalho fixo de `z-timeline__month`. */
export function groupByMonth(items: TimelineItem[]): Array<{ month: string; label: string; items: TimelineItem[] }> {
  const groups: Array<{ month: string; label: string; items: TimelineItem[] }> = [];
  for (const item of items) {
    const month = item.date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.items.push(item);
    else groups.push({ month, label: monthName(month), items: [item] });
  }
  return groups;
}

/**
 * Nome do mês a partir de `YYYY-MM`.
 *
 * O dia é fixado a 1 de propósito: `dateLong` formata a partir de uma data civil completa, e
 * aproveitar o dia do primeiro item do grupo produziria um cabeçalho a dizer o mês do dia
 * em que houve o primeiro registo — que é o mesmo mês, mas deixa o texto à mercê da
 * ordenação.
 */
function monthName(month: string): string {
  const label = dateLong(`${month}-01`);
  // «1 de setembro de 2026» → «setembro de 2026»; o dia não interessa num cabeçalho de mês.
  return label.replace(/^1 de /, '').replace(/^1 /, '');
}

/* -------------------------------------------------------------------------- */
/* Sugestões (§7)                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Cartão de sugestão.
 *
 * As sugestões são geradas a pedido a partir do estado real do veículo e **desaparecem no
 * instante em que deixam de fazer sentido** (§7) — pelo que não há aqui estado de "concluída":
 * depois de uma decisão, o dashboard é recarregado e a sugestão já não vem.
 *
 * As ações usam as etiquetas da API (`actionLabel`) e as da aplicação. Os rótulos de
 * dispensa são escritos aqui porque a API só devolve a ação principal; "Não mostrar
 * novamente" só aparece quando a sugestão é `dismissibleForever`, para que uma sugestão
 * útil (a de segurança da conta) não possa ser silenciada para sempre.
 */
export function SuggestionCard({
  suggestion,
  onAction,
  pending,
}: {
  suggestion: DashboardResponse['suggestions'][number];
  onAction: (action: 'done' | 'dismiss' | 'snooze' | 'never') => void;
  pending: boolean;
}) {
  return (
    <article className="z-suggestion">
      <div className="z-row" style={{ gap: 'var(--z-space-2)' }}>
        <span aria-hidden="true">💡</span>
        <span className="z-suggestion__title">{suggestion.title}</span>
      </div>
      <p className="z-suggestion__body">{suggestion.body}</p>
      <div className="z-suggestion__actions">
        {suggestion.actionHref ? (
          <Link to={suggestion.actionHref} className="z-btn z-btn--primary z-btn--sm">
            {suggestion.actionLabel}
          </Link>
        ) : (
          <button type="button" className="z-btn z-btn--primary z-btn--sm" disabled={pending} onClick={() => onAction('done')}>
            {suggestion.actionLabel}
          </button>
        )}
        <button type="button" className="z-btn z-btn--ghost z-btn--sm" disabled={pending} onClick={() => onAction('snooze')}>
          Mais tarde
        </button>
        {/* Só se pode silenciar para sempre o que a API marcou como dispensável. */}
        {suggestion.dismissibleForever ? (
          <button type="button" className="z-btn z-btn--ghost z-btn--sm" disabled={pending} onClick={() => onAction('never')}>
            Não mostrar novamente
          </button>
        ) : null}
      </div>
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/* Estado vazio de registos (§46)                                              */
/* -------------------------------------------------------------------------- */

/**
 * Estado vazio de uma lista de registos.
 *
 * A diferença entre um estado vazio e um erro é o tom e a ação (§46): aqui há sempre uma
 * frase que explica para que serve a lista e **um botão que faz a primeira coisa**. Nunca
 * "sem resultados" a cinzento no meio do ecrã.
 */
export function RecordsEmptyState({
  icon,
  title,
  body,
  onAdd,
  addLabel,
}: {
  icon: string;
  title: string;
  body: string;
  onAdd?: () => void;
  addLabel?: string;
}) {
  return (
    <Card>
      <EmptyState
        icon={icon}
        title={title}
        body={body}
        action={onAdd && addLabel ? <button type="button" className="z-btn z-btn--primary" onClick={onAdd}>{addLabel}</button> : undefined}
      />
    </Card>
  );
}

export { dateLong };
