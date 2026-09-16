import { Link } from 'react-router-dom';
import { QUICK_ACTIONS, formatNumber, type RecordKind } from '@zemlo/shared';
import { useDashboard, useSuggestionAction } from '../api/hooks';
import { errorMessage, errorRequestId } from '../api/errors';
import { useSelectedVehicle } from '../hooks';
import { useQuickLog } from '../components/QuickLogContext';
import {
  DataGaps,
  FinanceSummary,
  StatusGrid,
  SuggestionCard,
  TimelineRow,
  VehicleHero,
} from '../components/records';
import { CategoryBreakdown, CompositionDonut } from '../components/charts';
import { Card, InlineError, LoadingBlock, Metric, Section } from '../ui/primitives';
import { km, money } from '../lib/format';

/**
 * Painel (§8).
 *
 * A ordem dos blocos é a ordem das perguntas que o utilizador faz ao abrir a aplicação:
 *
 *  1. **Como está o carro agora?** — cabeçalho com a quilometragem e os cartões de estado
 *     (revisão, seguro, inspeção, impostos, documentos);
 *  2. **Quanto estou a gastar?** — resumo do ano e repartição por categoria;
 *  3. **O que quero registar?** — as quatro ações rápidas, sempre a um toque;
 *  4. **O que devia fazer a seguir?** — sugestões contextuais, próximos prazos e lacunas de
 *     dados, por esta ordem: as sugestões são acionáveis, os prazos são informativos e as
 *     lacunas são um convite.
 *
 * Todo o ecrã é servido por **uma única consulta** (`GET /dashboard`). É a decisão mais
 * importante deste ficheiro: o dashboard agrega um ano de registos, e decompô-lo em seis
 * pedidos faria o painel abrir em cascata — cada cartão a aparecer quando o seu pedido
 * chegasse. A API já devolve tudo o que o ecrã precisa, e é isso que permite que o painel
 * apareça de uma vez.
 */
export function DashboardPage() {
  const { vehicleId, vehicles, isLoading: vehiclesLoading, isEmpty } = useSelectedVehicle();
  const queryVehicleId = vehicleId === 'all' ? vehicles[0]?.id : vehicleId;
  const dashboard = useDashboard(queryVehicleId);
  const suggestions = useSuggestionAction(queryVehicleId);
  const quickLog = useQuickLog();

  if (vehiclesLoading) return <LoadingBlock label="A carregar o painel…" />;

  // Conta sem veículos: o painel dá lugar ao caminho de entrada, não a um ecrã de zeros
  // (§5, §46).
  if (isEmpty) return <WelcomeEmpty />;

  if (dashboard.isError) {
    return (
      <div className="z-page">
        <InlineError
          message={errorMessage(dashboard.error)}
          requestId={errorRequestId(dashboard.error)}
          onRetry={() => void dashboard.refetch()}
        />
      </div>
    );
  }

  if (!dashboard.data || dashboard.isLoading) return <LoadingBlock label="A carregar o painel…" />;

  const data = dashboard.data;
  // O total do mês corrente pode ser zero num mês que acabou de começar; a média mensal
  // compara-se com o mês anterior completo, e é isso que dá contexto ao número.
  const monthlySeries = data.finance.monthly.slice(-6);

  return (
    <div className="z-page">
      <VehicleHero vehicle={data.vehicle} />

      <QuickActions onOpen={quickLog.open} />

      <Section title="Estado do veículo" hint={`${formatNumber(data.counts.vehicles, 0)} ${data.counts.vehicles === 1 ? 'veículo' : 'veículos'} na conta`}>
        <StatusGrid cards={data.status} />
      </Section>

      <FinanceSummary finance={data.finance} />

      <div className="z-grid z-grid--2">
        <Card>
          <div className="z-card__header">
            <div>
              <div className="z-card__title">Utilização</div>
              <div className="z-card__subtitle">O que os teus registos dizem sobre o uso</div>
            </div>
          </div>
          <div className="z-grid z-grid--2">
            <Metric label="Km este ano" value={data.usage.kmThisYear === null ? '—' : km(data.usage.kmThisYear)} hint={data.usage.kmPerMonth === null ? undefined : `${km(data.usage.kmPerMonth)} por mês`} small />
            <Metric label="Custo por km" value={data.usage.costPerKmCents === null ? '—' : money(data.usage.costPerKmCents)} hint={data.usage.costPerKmCents === null ? 'falta quilometragem' : undefined} small />
            <Metric label="Consumo" value={data.usage.fuelConsumptionL100Km === null ? (data.usage.energyConsumptionKwh100Km === null ? '—' : `${formatNumber(data.usage.energyConsumptionKwh100Km, 2)} kWh/100 km`) : `${formatNumber(data.usage.fuelConsumptionL100Km, 2)} L/100 km`} small />
            <Metric label="Quilometragem" value={data.usage.odometerKm === null ? '—' : km(data.usage.odometerKm)} small />
          </div>
          <p className="z-xs z-muted" style={{ marginTop: 'var(--z-space-3)' }}>
            <Link to={`/stats${queryVehicleId ? `?vehicleId=${queryVehicleId}` : ''}`}>Ver estatísticas detalhadas →</Link>
          </p>
        </Card>

        <Card>
          <div className="z-card__header">
            <div>
              <div className="z-card__title">Onde vai o dinheiro</div>
              <div className="z-card__subtitle">Todos os custos de {data.finance.year}</div>
            </div>
          </div>
          <CompositionDonut
            ariaLabel={`Composição dos custos de ${data.finance.year}: ${money(data.finance.yearTotalCents)} no total`}
            total={data.finance.yearTotalCents}
            slices={[
              { label: 'Energia', value: data.finance.byCategory.filter((c) => c.category === 'fuel' || c.category === 'charging').reduce((sum, c) => sum + c.amountCents, 0), color: 'var(--z-chart-accent)' },
              { label: 'Manutenção', value: data.finance.byCategory.filter((c) => c.category === 'maintenance' || c.category === 'repairs' || c.category === 'tyres').reduce((sum, c) => sum + c.amountCents, 0), color: 'var(--z-chart-1)' },
              { label: 'Custos fixos', value: data.finance.byCategory.filter((c) => c.category === 'insurance' || c.category === 'tax' || c.category === 'inspection').reduce((sum, c) => sum + c.amountCents, 0), color: 'var(--z-chart-2)' },
              { label: 'Outros', value: data.finance.byCategory.filter((c) => !['fuel', 'charging', 'maintenance', 'repairs', 'tyres', 'insurance', 'tax', 'inspection'].includes(c.category)).reduce((sum, c) => sum + c.amountCents, 0), color: 'var(--z-chart-3)' },
            ].filter((slice) => slice.value > 0)}
          />
        </Card>
      </div>

      {monthlySeries.length >= 3 ? (
        <Card>
          <div className="z-card__header">
            <div>
              <div className="z-card__title">Detalhe por categoria</div>
              <div className="z-card__subtitle">Ordenado por peso no total do ano</div>
            </div>
          </div>
          <CategoryBreakdown categories={data.finance.byCategory} />
        </Card>
      ) : null}

      {data.suggestions.length > 0 ? (
        <Section title="Sugestões" hint="baseadas no estado real do veículo">
          <div className="z-stack">
            {data.suggestions.map((suggestion) => (
              <SuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                pending={suggestions.isPending}
                onAction={(action) =>
                  suggestions.mutate({ suggestionKey: suggestion.id, action, snoozeDays: action === 'snooze' ? 14 : undefined })
                }
              />
            ))}
          </div>
        </Section>
      ) : null}

      {data.upcoming.length > 0 ? (
        <Section
          title="A seguir"
          hint="por ordem de proximidade"
          action={
            <Link to="/calendar" className="z-btn z-btn--ghost z-btn--sm">
              Ver calendário
            </Link>
          }
        >
          <Card flush>
            {data.upcoming.slice(0, 5).map((item) => (
              <TimelineRow key={item.id} item={item} />
            ))}
          </Card>
        </Section>
      ) : null}

      <DataGaps gaps={data.dataGaps} />

      <div className="z-row z-row--wrap z-xs z-muted" style={{ gap: 'var(--z-space-3)' }}>
        <span>
          {formatNumber(data.counts.recordsThisYear, 0)} registos em {data.finance.year}
        </span>
        <span aria-hidden="true">·</span>
        <span>
          {formatNumber(data.counts.documents, 0)} {data.counts.documents === 1 ? 'documento' : 'documentos'}
        </span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Ações rápidas (§43)                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Ações rápidas.
 *
 * Quatro botões e não cinco: o painel mostra os quatro registos do dia a dia (despesa,
 * abastecimento, carregamento, manutenção). A quilometragem — o quinto do registo
 * partilhado — fica de fora do painel porque tem o seu próprio caminho natural: é registada
 * dentro do abastecimento ou do carregamento, onde é um campo pré-preenchido e não uma
 * ação separada. Forçar cinco botões tornaria a grelha mais estreita em telemóvel, e uma
 * grelha de cinco colunas num ecrã de 360 px dá botões de 65 px — abaixo do que se acerta
 * com o polegar.
 */
function QuickActions({ onOpen }: { onOpen: (kind: RecordKind) => void }) {
  const actions = QUICK_ACTIONS.filter((action) => action.code !== 'odometer');
  return (
    <section aria-label="Registo rápido">
      <div className="z-quick-actions">
        {actions.map((action) => (
          <button
            key={action.code}
            type="button"
            className="z-quick-action"
            onClick={() => onOpen(action.code as RecordKind)}
          >
            <span className="z-quick-action__icon" aria-hidden="true">
              {action.icon}
            </span>
            {action.label}
          </button>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Conta sem veículos (§5, §46)                                                */
/* -------------------------------------------------------------------------- */

/**
 * Estado inicial de uma conta sem veículos.
 *
 * Não é um estado vazio: é o **primeiro ecrã de quem acabou de se registar**, e por isso tem
 * de dizer o que o produto faz e levar diretamente ao passo seguinte. Um painel com zeros e
 * gráficos vazios ensinaria ao utilizador que o Zemlo não serve para nada.
 */
function WelcomeEmpty() {
  return (
    <div className="z-page">
      <Card>
        <div className="z-stack z-stack--loose">
          <div>
            <h1>Vamos começar pelo teu veículo</h1>
            <p className="z-page__subtitle" style={{ marginTop: 'var(--z-space-2)' }}>
              O Zemlo junta num só lugar o histórico, os custos, a manutenção e os prazos do
              teu veículo — e avisa-te antes de cada um deles chegar.
            </p>
          </div>

          <div className="z-grid z-grid--3">
            <Metric label="1. Adicionar veículo" value="Só a matrícula" small hint="Não pedimos VIN, versão nem cor." />
            <Metric label="2. Registar" value="2 toques" small hint="Abastecimento, carregamento, despesa." />
            <Metric label="3. Receber avisos" value="Antes do prazo" small hint="Revisão, seguro, inspeção, IUC." />
          </div>

          <div className="z-row z-row--wrap" style={{ gap: 'var(--z-space-3)' }}>
            <Link to="/onboarding/veiculo" className="z-btn z-btn--primary">
              Adicionar o primeiro veículo
            </Link>
            <Link to="/settings" className="z-btn z-btn--secondary">
              Configurar a conta
            </Link>
          </div>

          <p className="z-xs z-muted">
            Podes experimentar com dados incompletos: o Zemlo diz-te sempre que um número é uma
            estimativa, e nunca inventa um valor que não tenha.
          </p>
        </div>
      </Card>
    </div>
  );
}
