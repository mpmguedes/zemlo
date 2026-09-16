import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { formatNumber, safeRatio, type StatsResponse } from '@zemlo/shared';
import { useStats, useVehicles } from '../api/hooks';
import { errorMessage, errorRequestId } from '../api/errors';
import { Card, Chip, EmptyState, InlineError, LoadingBlock, Metric, PageHeader, Section } from '../ui/primitives';
import { CategoryBreakdown, CompositionDonut, ConsumptionLine, MonthlyBars } from '../components/charts';
import { consumption, dateRange, econsumption, km, money, moneySigned, percent, unitMoney } from '../lib/format';

/**
 * Estatísticas (§23).
 *
 * O ecrã onde o Zemlo tem de ser mais disciplinado. Quatro decisões governam tudo:
 *
 *  1. **Um número sem contexto não é informação.** Cada métrica aparece com o que a explica
 *     (a média mensal ao lado do total do ano, a distância ao lado do custo por km) e com a
 *     indicação de quando não há base para a calcular.
 *  2. **A comparação é descritiva, não alarmista.** «mais 96 805 € do que no período anterior»
 *     em vez de um «▲ 39 %» a vermelho. Em estatísticas onde falta histórico, uma variação
 *     percentual grande diz mais sobre a janela temporal do que sobre o comportamento do
 *     utilizador (§59).
 *  3. **O bloco avançado está fechado por omissão.** O TCO e a depreciação são úteis para
 *     quem os procura e ruído para quem quer saber quanto gastou. Fechado, e com as
 *     **assunções do servidor** à vista quando se abre — porque um número sobre o valor do
 *     carro daqui a três anos só é honesto se disser em que se baseou (§3.2, §49).
 *  4. **O âmbito é explícito.** O cabeçalho diz sempre se os números são de um veículo ou da
 *     conta inteira, e o seletor de veículo permite mudar de âmbito sem sair do ecrã.
 */
export function StatsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  // A lista completa de veículos, e não a seleção global: as estatísticas têm o seu próprio
  // âmbito, em `?vehicleId=`. Assim, quem está a analisar o BMW não muda o veículo em foco do
  // painel — que é o que aconteceria se este seletor escrevesse na preferência partilhada.
  const allVehicles = useVehicles();

  const queryVehicleId = searchParams.get('vehicleId') ?? 'account';
  const [year, setYear] = useState(() => Number(new Date().toISOString().slice(0, 4)));
  const [showAdvanced, setShowAdvanced] = useState(false);

  const stats = useStats({
    ...(queryVehicleId === 'account' ? {} : { vehicleId: queryVehicleId }),
    year,
    months: 12,
  });

  const scopeLabel = useMemo(() => {
    if (queryVehicleId === 'account') return 'Toda a conta';
    const vehicle = allVehicles.data?.items.find((item) => item.id === queryVehicleId);
    return vehicle ? `${vehicle.emoji} ${vehicle.plateDisplay}` : 'Veículo';
  }, [queryVehicleId, allVehicles.data]);

  function setVehicle(id: string) {
    const next = new URLSearchParams(searchParams);
    if (id === 'account') next.delete('vehicleId');
    else next.set('vehicleId', id);
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="z-page">
      <PageHeader
        title="Estatísticas"
        subtitle="Custos, distância, consumos e comparações — calculados a partir dos teus registos."
      />

      <Card>
        <div className="z-stack">
          <div className="z-filters" role="group" aria-label="Âmbito">
            <Chip tone={queryVehicleId === 'account' ? 'accent' : 'neutral'}>
              <button
                type="button"
                onClick={() => setVehicle('account')}
                style={{ background: 'transparent', border: 0, color: 'inherit', padding: 0, font: 'inherit', cursor: 'pointer', minHeight: 'var(--z-touch)' }}
              >
                Toda a conta
              </button>
            </Chip>
            {(allVehicles.data?.items ?? []).map((vehicle) => (
              <Chip key={vehicle.id} tone={queryVehicleId === vehicle.id ? 'accent' : 'neutral'}>
                <button
                  type="button"
                  onClick={() => setVehicle(vehicle.id)}
                  style={{ background: 'transparent', border: 0, color: 'inherit', padding: 0, font: 'inherit', cursor: 'pointer', minHeight: 'var(--z-touch)' }}
                >
                  {vehicle.emoji} {vehicle.plateDisplay}
                </button>
              </Chip>
            ))}
          </div>

          <div className="z-row z-row--between z-row--wrap" style={{ gap: 'var(--z-space-3)' }}>
            <span className="z-small z-muted">
              {stats.data ? dateRange(stats.data.scope.from, stats.data.scope.to) : `Ano ${year}`}
            </span>
            <span className="z-row" style={{ gap: 'var(--z-space-2)' }}>
              <button type="button" className="z-btn z-btn--ghost z-btn--sm" onClick={() => setYear((value) => value - 1)}>
                ‹ {year - 1}
              </button>
              <button
                type="button"
                className="z-btn z-btn--primary z-btn--sm"
                onClick={() => setYear(Number(new Date().toISOString().slice(0, 4)))}
              >
                {year}
              </button>
              <button
                type="button"
                className="z-btn z-btn--ghost z-btn--sm"
                disabled={year >= Number(new Date().toISOString().slice(0, 4))}
                onClick={() => setYear((value) => value + 1)}
              >
                {year + 1} ›
              </button>
            </span>
          </div>
        </div>
      </Card>

      {stats.isLoading ? <LoadingBlock label="A calcular estatísticas…" /> : null}

      {stats.isError ? (
        <InlineError
          message={errorMessage(stats.error)}
          requestId={errorRequestId(stats.error)}
          onRetry={() => void stats.refetch()}
        />
      ) : null}

      {stats.data && stats.data.totals.count === 0 ? (
        <Card>
          <EmptyState
            icon="📊"
            title={`Sem dados em ${year}`}
            body={`Não há registos em ${year} para ${scopeLabel.toLowerCase()}. As estatísticas aparecem à medida que registares despesas, abastecimentos e carregamentos.`}
            action={
              <Link to="/records/expenses" className="z-btn z-btn--primary">
                Registar uma despesa
              </Link>
            }
          />
        </Card>
      ) : null}

      {stats.data && stats.data.totals.count > 0 ? <StatsBody data={stats.data} showAdvanced={showAdvanced} onToggleAdvanced={setShowAdvanced} /> : null}
    </div>
  );
}

function StatsBody({
  data,
  showAdvanced,
  onToggleAdvanced,
}: {
  data: StatsResponse;
  showAdvanced: boolean;
  onToggleAdvanced: (value: boolean) => void;
}) {
  const { totals, distance, unitCosts, consumption: consumptions, comparison, advanced, monthly, byCategory } = data;

  const energyShare = safeRatio(totals.energyCents, totals.totalCents);
  const fixedShare = safeRatio(totals.fixedCents, totals.totalCents);

  return (
    <>
      <Section title="Totais do período" hint={`${formatNumber(totals.count, 0)} registos`}>
        <div className="z-grid z-grid--4">
          <Metric label="Custo total" value={money(totals.totalCents)} small />
          <Metric label="Energia" value={money(totals.energyCents)} hint={energyShare === null ? undefined : `${percent(energyShare * 100, 0)} do total`} small />
          <Metric label="Manutenção" value={money(totals.maintenanceCents)} small />
          <Metric label="Custos fixos" value={money(totals.fixedCents)} hint={fixedShare === null ? undefined : `${percent(fixedShare * 100, 0)} do total`} small />
          <Metric label="Outros" value={money(totals.otherCents)} small />
        </div>
      </Section>

      <div className="z-grid z-grid--2">
        <Card>
          <div className="z-card__header">
            <div>
              <div className="z-card__title">Custo por unidade</div>
              <div className="z-card__subtitle">Quanto custa cada quilómetro, mês e dia</div>
            </div>
          </div>
          <div className="z-grid z-grid--2">
            <Metric
              label="Por km"
              value={unitCosts.costPerKmCents === null ? '—' : unitMoney(unitCosts.costPerKmCents, 'km')}
              hint={unitCosts.costPerKmCents === null ? 'faltam leituras de quilometragem' : undefined}
              small
            />
            <Metric label="Por mês" value={unitCosts.costPerMonthCents === null ? '—' : money(unitCosts.costPerMonthCents)} small />
            <Metric label="Por dia" value={unitCosts.costPerDayCents === null ? '—' : money(unitCosts.costPerDayCents)} small />
            <Metric
              label="Energia por km"
              value={unitCosts.energyCostPerKmCents === null ? '—' : unitMoney(unitCosts.energyCostPerKmCents, 'km')}
              small
            />
          </div>
        </Card>

        <Card>
          <div className="z-card__header">
            <div>
              <div className="z-card__title">Utilização</div>
              <div className="z-card__subtitle">O que os registos dizem sobre a distância percorrida</div>
            </div>
          </div>
          <div className="z-grid z-grid--2">
            <Metric label="Km no período" value={distance.kmInWindow === null ? '—' : km(distance.kmInWindow)} small />
            <Metric label="Km no ano" value={distance.kmThisYear === null ? '—' : km(distance.kmThisYear)} small />
            <Metric label="Km por mês" value={distance.kmPerMonth === null ? '—' : km(distance.kmPerMonth)} small />
            <Metric
              label="Km por ano (estimado)"
              value={distance.kmPerYear === null ? '—' : km(distance.kmPerYear)}
              hint="extrapolado do ritmo observado"
              small
            />
          </div>
          {distance.firstReadingDate && distance.lastReadingDate ? (
            <p className="z-xs z-muted" style={{ marginTop: 'var(--z-space-3)' }}>
              Leituras entre {dateRange(distance.firstReadingDate, distance.lastReadingDate)}.
            </p>
          ) : (
            <p className="z-xs z-muted" style={{ marginTop: 'var(--z-space-3)' }}>
              Sem leituras de quilometragem no período: o custo por km e o custo por 100 km ficam
              por calcular em vez de saírem errados.
            </p>
          )}
        </Card>
      </div>

      {monthly.length > 0 ? (
        <Card>
          <div className="z-card__header">
            <div>
              <div className="z-card__title">Série mensal</div>
              <div className="z-card__subtitle">O mês a laranja é a parcela de energia</div>
            </div>
          </div>
          <MonthlyBars
            data={monthly}
            ariaLabel={`Custos mensais: ${monthly.map((month) => `${month.label} ${money(month.amountCents)}`).join(', ')}`}
          />
        </Card>
      ) : null}

      <div className="z-grid z-grid--2">
        <Card>
          <div className="z-card__header">
            <div className="z-card__title">Por categoria</div>
          </div>
          <CategoryBreakdown categories={byCategory} />
        </Card>

        <Card>
          <div className="z-card__header">
            <div>
              <div className="z-card__title">Composição</div>
            </div>
          </div>
          <CompositionDonut
            ariaLabel={`Composição de ${money(totals.totalCents)}`}
            total={totals.totalCents}
            slices={[
              { label: 'Energia', value: totals.energyCents, color: 'var(--z-chart-accent)' },
              { label: 'Manutenção', value: totals.maintenanceCents, color: 'var(--z-chart-1)' },
              { label: 'Custos fixos', value: totals.fixedCents, color: 'var(--z-chart-2)' },
              { label: 'Outros', value: totals.otherCents, color: 'var(--z-chart-3)' },
            ].filter((slice) => slice.value > 0)}
          />
        </Card>
      </div>

      <Card>
        <div className="z-card__header">
          <div>
            <div className="z-card__title">Evolução dos consumos</div>
            <div className="z-card__subtitle">
              Método «depósito a depósito»: só entre dois abastecimentos completos o valor é fiável.
            </div>
          </div>
        </div>
        <div className="z-grid z-grid--2">
          <div>
            <h3 className="z-card__title" style={{ fontSize: 'var(--z-text-sm)', marginBottom: 'var(--z-space-2)' }}>
              Combustível
            </h3>
            <ConsumptionLine
              series={consumptions.fuelMonthly}
              unit="L/100 km"
              ariaLabel="Evolução do consumo de combustível"
            />
            {consumptions.fuelL100Km !== null ? (
              <div className="z-grid z-grid--2" style={{ marginTop: 'var(--z-space-3)' }}>
                <Metric label="Média" value={consumption(consumptions.fuelL100Km)} small />
                <Metric
                  label="Preço médio por litro"
                  value={consumptions.fuelCostPerLitreCents === null ? '—' : money(consumptions.fuelCostPerLitreCents)}
                  small
                />
              </div>
            ) : null}
          </div>
          <div>
            <h3 className="z-card__title" style={{ fontSize: 'var(--z-text-sm)', marginBottom: 'var(--z-space-2)' }}>
              Energia elétrica
            </h3>
            <ConsumptionLine
              series={consumptions.energyMonthly}
              unit="kWh/100 km"
              ariaLabel="Evolução do consumo elétrico"
            />
            {consumptions.energyKwh100Km !== null ? (
              <div className="z-grid z-grid--2" style={{ marginTop: 'var(--z-space-3)' }}>
                <Metric label="Média" value={econsumption(consumptions.energyKwh100Km)} small />
                <Metric
                  label="Preço médio por kWh"
                  value={consumptions.energyCostPerKwhCents === null ? '—' : money(consumptions.energyCostPerKwhCents)}
                  small
                />
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      <Card>
        <div className="z-card__header">
          <div>
            <div className="z-card__title">Comparação com o período anterior</div>
            <div className="z-card__subtitle">Mesma duração, imediatamente antes deste período</div>
          </div>
        </div>
        <div className="z-grid z-grid--3">
          <Metric
            label="Período anterior"
            value={money(comparison.previousPeriodTotalCents)}
            hint={
              comparison.deltaCents === 0
                ? 'exatamente igual'
                : comparison.deltaCents > 0
                  ? `${moneySigned(comparison.deltaCents)} do que agora`
                  : `${money(Math.abs(comparison.deltaCents))} a menos agora`
            }
            small
          />
          <Metric
            label="Variação"
            value={comparison.deltaPercent === null ? '—' : `${comparison.deltaPercent > 0 ? '+' : ''}${formatNumber(comparison.deltaPercent, 1)} %`}
            hint={comparison.deltaPercent === null ? 'sem base de comparação' : 'variação do custo'}
            small
          />
          <Metric
            label="Distância"
            value={comparison.deltaKm === null ? '—' : km(comparison.deltaKm)}
            hint={
              comparison.previousPeriodKm === null
                ? 'sem leituras no período anterior'
                : `antes: ${km(comparison.previousPeriodKm)}`
            }
            small
          />
        </div>
        <p className="z-xs z-muted" style={{ marginTop: 'var(--z-space-3)' }}>
          Uma variação percentual só faz sentido com uma base comparável. Quando o período
          anterior não tem registos suficientes, o Zemlo mostra o valor absoluto e diz porquê —
          em vez de apresentar uma percentagem que não significa nada.
        </p>
      </Card>

      <AdvancedBlock advanced={advanced} open={showAdvanced} onToggle={onToggleAdvanced} />
    </>
  );
}

/**
 * Bloco avançado: TCO e depreciação.
 *
 * **Fechado por omissão** e por uma razão de produto: o custo total de propriedade só faz
 * sentido quando o utilizador tem o preço de compra e pretende pensar na venda ou na troca.
 * Para quem quer saber quanto gastou este mês, é ruído — e um painel que mostra tudo o que
 * sabe é um painel que esconde o que importa (§3.2).
 *
 * Ao abrir, mostra as **assunções do servidor** tal como vêm. Esta é a parte que não pode
 * ser negociada: um número sobre o valor do carro daqui a três anos que não diga em que se
 * baseou é um número que não se pode usar para decidir nada. A API já as escreve em
 * português e no tom certo; a interface limita-se a mostrá-las.
 */
function AdvancedBlock({
  advanced,
  open,
  onToggle,
}: {
  advanced: StatsResponse['advanced'];
  open: boolean;
  onToggle: (value: boolean) => void;
}) {
  const hasAnyValue =
    advanced.totalCostOfOwnershipCents !== null ||
    advanced.ownershipMonths !== null ||
    advanced.depreciationCents !== null;

  return (
    <Card>
      <details
        open={open}
        onToggle={(event) => onToggle((event.target as HTMLDetailsElement).open)}
      >
        <summary className="z-disclosure__toggle" style={{ listStyle: 'none', display: 'flex' }}>
          <span>
            Estatísticas avançadas
            <span className="z-section__hint" style={{ display: 'block', fontWeight: 400 }}>
              Custo total de propriedade e depreciação estimada — com as assunções à vista
            </span>
          </span>
          <span aria-hidden="true">›</span>
        </summary>

        <div className="z-stack" style={{ paddingTop: 'var(--z-space-4)' }}>
          {hasAnyValue ? (
            <div className="z-grid z-grid--3">
              <Metric
                label="Custo total de propriedade"
                value={advanced.totalCostOfOwnershipCents === null ? '—' : money(advanced.totalCostOfOwnershipCents)}
                hint={advanced.ownershipMonths !== null ? `em ${formatNumber(advanced.ownershipMonths, 0)} meses de posse` : undefined}
                small
              />
              <Metric
                label="Depreciação estimada"
                value={advanced.depreciationCents === null ? '—' : money(advanced.depreciationCents)}
                small
              />
              <Metric
                label="Valor residual"
                value={advanced.residualValueCents === null ? '—' : money(advanced.residualValueCents)}
                small
              />
              <Metric
                label="Custo por km (incluindo compra)"
                value={advanced.valuePerKmCents === null ? '—' : unitMoney(advanced.valuePerKmCents, 'km')}
                small
              />
            </div>
          ) : (
            <p className="z-small z-muted">
              Ainda não há base para calcular este bloco. Falta o preço de compra na ficha do
              veículo — ou quilometragem suficiente para distribuir o custo pela distância.
            </p>
          )}

          {advanced.assumptions.length > 0 ? (
            <div>
              <h3 className="z-card__title" style={{ fontSize: 'var(--z-text-sm)', marginBottom: 'var(--z-space-2)' }}>
                Como estes números são calculados
              </h3>
              <ul className="z-assumptions">
                {advanced.assumptions.map((assumption) => (
                  <li key={assumption}>
                    <span>{assumption}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </details>
    </Card>
  );
}
