import { useMemo, useState } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import {
  EXPENSE_CATEGORIES,
  MAINTENANCE_TYPES,
  categoryLabel,
  formatNumber,
  optionLabel,
  type ChargingSession,
  type Expense,
  type FuelSession,
  type MaintenanceRecord,
  type RecordKind,
} from '@zemlo/shared';
import {
  useChargingSessions,
  useExpenses,
  useFuelSessions,
  useMaintenanceRecords,
  useProfile,
} from '../../api/hooks';
import { errorMessage, errorRequestId } from '../../api/errors';
import { useSelectedVehicle } from '../../hooks';
import { useQuickLog } from '../../components/QuickLogContext';
import { Button, Card, Chip, EmptyState, InlineError, LoadingBlock, PageHeader, Section } from '../../ui/primitives';
import { RecordsEmptyState } from '../../components/records';
import { consumption, dateLong, econsumption, km, litres, money, monthBounds, today } from '../../lib/format';

/**
 * Listas de registos com filtros.
 *
 * Um único componente para os quatro tipos de registo financeiro e de manutenção, e não
 * quatro ecrãs quase iguais. Partilham tudo o que importa — filtro por período, filtro por
 * categoria, estados vazios, ligação ao registo rápido e as duas apresentações (lista em
 * telemóvel, tabela em ambiente de trabalho) — e diferem apenas no que mostram por linha.
 * Quatro ecrãs separados garantiriam que três ficariam para trás à primeira alteração ao
 * comportamento da lista.
 *
 * Uma nota sobre as consultas: as quatro são declaradas **sempre**, mas as que não
 * correspondem ao tipo em ecrã recebem o filtro `limit: 1` e uma chave de consulta própria,
 * pelo que não competem com as do tipo ativo. Declarar condicionalmente violaria as regras
 * dos hooks; declarar as quatro com filtros cheios descarregaria dados que ninguém vê.
 *
 * Os filtros vivem em estado local e não no endereço: ao contrário do separador da ficha do
 * veículo, um intervalo de datas numa lista é uma lente temporária de consulta, e encher o
 * endereço com `?from=&to=&category=` produziria links longos que ninguém partilha.
 */

export function RecordsPage() {
  const { kind } = useParams<{ kind: string }>();
  const { vehicleId, vehicles } = useSelectedVehicle();
  const quickLog = useQuickLog();
  const profile = useProfile();

  const config = configFor(kind ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [category, setCategory] = useState('');

  const selectedVehicleId = vehicleId === 'all' ? undefined : vehicleId;
  const timeZone = profile.data?.timeZone ?? 'Europe/Lisbon';

  const expenses = useExpenses(
    config?.key === 'expenses'
      ? { vehicleId: selectedVehicleId, from, to, category, limit: 100 }
      : // Consulta inativa para os outros tipos: o filtro tem de continuar a ser um valor
        // válido do contrato (a API recusa uma categoria desconhecida com 422), pelo que se
        // usa a categoria mais restritiva e `limit: 1` — o resultado nunca é mostrado.
        { vehicleId: selectedVehicleId, limit: 1, category: 'fines' },
  );
  const fuel = useFuelSessions(
    config?.key === 'fuel' ? { vehicleId: selectedVehicleId, from, to, limit: 100 } : { vehicleId: selectedVehicleId, limit: 1 },
  );
  const charging = useChargingSessions(
    config?.key === 'charging' ? { vehicleId: selectedVehicleId, from, to, limit: 100 } : { vehicleId: selectedVehicleId, limit: 1 },
  );
  const maintenance = useMaintenanceRecords(
    config?.key === 'maintenance' ? { vehicleId: selectedVehicleId, from, to, limit: 100 } : { vehicleId: selectedVehicleId, limit: 1 },
  );

  /*
   * Reunir as quatro consultas num mapa indexado pelo tipo evita quatro ramos de `if` no
   * corpo do componente e — mais importante — faz com que o ecrã funcione para um tipo de
   * registo que ainda não exista (a API devolveria a lista vazia, não um ecrã em branco).
   */
  const queries = useMemo(
    () => ({ expenses, fuel, charging, maintenance }),
    [expenses, fuel, charging, maintenance],
  );

  const vehicleById = useMemo(() => new Map(vehicles.map((vehicle) => [vehicle.id, vehicle])), [vehicles]);

  /*
   * Tipo de registo desconhecido: recusar, não degradar.
   *
   * O ramo tem de vir **depois** de todos os hooks (as quatro consultas são declaradas
   * sempre, com filtro inativo quando não correspondem ao tipo) e antes de se tocar em
   * `active` — que só existe para um tipo que existe.
   */
  if (!config) return <UnknownRecordKind />;

  const active = queries[config.key];
  const records: unknown[] = active.data?.items ?? [];
  const total = active.data?.total ?? null;

  const presets = [
    { label: 'Este ano', from: `${today(timeZone).slice(0, 4)}-01-01`, to: `${today(timeZone).slice(0, 4)}-12-31` },
    { label: 'Últimos 3 meses', from: monthBounds(shiftMonth(today(timeZone), -2)).from, to: today(timeZone) },
    { label: 'Últimos 12 meses', from: monthBounds(shiftMonth(today(timeZone), -11)).from, to: today(timeZone) },
  ];

  return (
    <div className="z-page">
      <PageHeader
        title={config.title}
        subtitle={config.subtitle}
        actions={
          <Button variant="highlight" onClick={() => quickLog.open(config.key as RecordKind)}>
            ＋ {config.addLabel}
          </Button>
        }
      />

      <Card>
        <div className="z-stack">
          <div className="z-filters" role="group" aria-label="Período">
            <Chip tone={!from && !to ? 'accent' : 'neutral'}>
              <button
                type="button"
                className="z-chip--button"
                aria-pressed={!from && !to}
                onClick={() => {
                  setFrom('');
                  setTo('');
                }}
                style={{ background: 'transparent', border: 0, color: 'inherit', padding: 0, font: 'inherit', cursor: 'pointer', minHeight: 'var(--z-touch)' }}
              >
                Todo o histórico
              </button>
            </Chip>
            {presets.map((preset) => {
              const selected = from === preset.from && to === preset.to;
              return (
                <Chip key={preset.label} tone={selected ? 'accent' : 'neutral'}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setFrom(preset.from);
                      setTo(preset.to);
                    }}
                    style={{ background: 'transparent', border: 0, color: 'inherit', padding: 0, font: 'inherit', cursor: 'pointer', minHeight: 'var(--z-touch)' }}
                  >
                    {preset.label}
                  </button>
                </Chip>
              );
            })}
          </div>

          <div className="z-grid z-grid--2">
            <label className="z-field">
              <span className="z-field__label">De</span>
              <input type="date" className="z-input" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label className="z-field">
              <span className="z-field__label">Até</span>
              <input type="date" className="z-input" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} />
            </label>
          </div>

          {config.key === 'expenses' ? (
            <label className="z-field">
              <span className="z-field__label">Categoria</span>
              <select className="z-select" value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">Todas as categorias</option>
                {EXPENSE_CATEGORIES.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.icon} {item.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </Card>

      {active.isLoading ? <LoadingBlock label="A carregar registos…" /> : null}

      {active.isError ? (
        <InlineError
          message={errorMessage(active.error)}
          requestId={errorRequestId(active.error)}
          onRetry={() => void active.refetch()}
        />
      ) : null}

      {active.data && records.length === 0 ? (
        <RecordsEmptyState
          icon={config.icon}
          title={config.emptyTitle}
          body={config.emptyBody}
          onAdd={() => quickLog.open(config.key as RecordKind)}
          addLabel={config.addLabel}
        />
      ) : null}

      {active.data && records.length > 0 ? (
        <>
          <Section
            title={`${formatNumber(records.length, 0)} ${records.length === 1 ? 'registo' : 'registos'}`}
            hint={total !== null ? `de um total de ${formatNumber(total, 0)}` : undefined}
          />

          {/* Lista — a apresentação principal em telemóvel. */}
          <Card flush>
            <div className="z-list">
              {records.map((record) => {
                const id = (record as { id: string }).id;
                const vehicle = vehicleById.get((record as { vehicleId: string }).vehicleId);
                return (
                  <Link key={id} to={`/records/${config.key}/${id}`} className="z-list__item">
                    <span className="z-list__icon" aria-hidden="true">
                      {recordIcon(config.key, record)}
                    </span>
                    <span className="z-list__body">
                      <span className="z-list__title">{recordTitle(config.key, record)}</span>
                      <span className="z-list__meta">
                        {dateLong((record as { date: string }).date)}
                        {vehicle && vehicleId === 'all' ? ` · ${vehicle.plateDisplay}` : ''}
                        {recordMeta(config.key, record) ? ` · ${recordMeta(config.key, record)}` : ''}
                      </span>
                    </span>
                    <span className="z-list__trailing z-numeric">{recordAmount(config.key, record)}</span>
                  </Link>
                );
              })}
            </div>
          </Card>

          {/* Tabela — a prerrogativa do ambiente de trabalho (§35). */}
          <div className="z-table-wrap">
            <table className="z-table">
              <caption className="z-sr-only">{config.title} — registos</caption>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>{config.primaryColumn}</th>
                  <th>Detalhe</th>
                  <th>Veículo</th>
                  <th className="z-table__num">Quilometragem</th>
                  <th className="z-table__num">Valor</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => {
                  const id = (record as { id: string }).id;
                  const vehicle = vehicleById.get((record as { vehicleId: string }).vehicleId);
                  const odometer = (record as { odometerKm: number | null }).odometerKm;
                  return (
                    <tr key={id}>
                      <td>{dateLong((record as { date: string }).date)}</td>
                      <td>
                        <Link to={`/records/${config.key}/${id}`}>{recordTitle(config.key, record)}</Link>
                      </td>
                      <td className="z-muted">{recordMeta(config.key, record) || '—'}</td>
                      <td>{vehicle?.plateDisplay ?? '—'}</td>
                      <td className="z-table__num">{odometer === null ? '—' : km(odometer)}</td>
                      <td className="z-table__num">{recordAmount(config.key, record)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Configuração por tipo de registo                                            */
/* -------------------------------------------------------------------------- */

interface RecordConfig {
  key: 'expenses' | 'fuel' | 'charging' | 'maintenance';
  title: string;
  subtitle: string;
  icon: string;
  addLabel: string;
  primaryColumn: string;
  emptyTitle: string;
  emptyBody: string;
}

const RECORD_CONFIG: Record<string, RecordConfig> = {
  expenses: {
    key: 'expenses',
    title: 'Despesas',
    subtitle: 'Tudo o que gastaste com os teus veículos.',
    icon: '💶',
    addLabel: 'Nova despesa',
    primaryColumn: 'Categoria',
    emptyTitle: 'Ainda sem despesas',
    emptyBody:
      'Uma despesa são três campos: valor, categoria e data. Seguro, IUC, lavagens, portagens — tudo entra aqui, e é isso que faz o custo por km ser verdadeiro.',
  },
  fuel: {
    key: 'fuel',
    title: 'Abastecimentos',
    subtitle: 'Litros, preço e consumo real, depósito a depósito.',
    icon: '⛽',
    addLabel: 'Novo abastecimento',
    primaryColumn: 'Posto',
    emptyTitle: 'Ainda sem abastecimentos',
    emptyBody:
      'Basta registar litros, valor e quilometragem. Entre dois depósitos cheios, o Zemlo calcula o consumo real — não a estimativa do construtor.',
  },
  charging: {
    key: 'charging',
    title: 'Carregamentos',
    subtitle: 'Energia, custo por kWh e consumo elétrico.',
    icon: '🔌',
    addLabel: 'Novo carregamento',
    primaryColumn: 'Local',
    emptyTitle: 'Ainda sem carregamentos',
    emptyBody:
      'Registar um carregamento são dois campos: energia e valor. Com a quilometragem, passas a ver o custo por 100 km em casa e na rede.',
  },
  maintenance: {
    key: 'maintenance',
    title: 'Manutenção',
    subtitle: 'Intervenções, oficinas e o prazo seguinte de cada uma.',
    icon: '🔧',
    addLabel: 'Nova manutenção',
    primaryColumn: 'Intervenção',
    emptyTitle: 'Ainda sem manutenções',
    emptyBody:
      'Revisões, óleo, travões, pneus. Se indicares o intervalo, o Zemlo cria automaticamente o lembrete da próxima intervenção.',
  },
};

/**
 * Configuração de um tipo de registo, ou `null` quando esse tipo não existe.
 *
 * `null` é uma resposta de primeira classe: quem chama tem de **decidir** o que mostrar, em
 * vez de receber a configuração de despesas sem saber que o tipo não existe. Era essa a
 * origem de `AUD-008` — `/records/insurance` mostrava o ecrã de despesas, sem erro nenhum,
 * e o utilizador agia sobre dados que não tinha pedido. Uma degradação silenciosa é pior do
 * que uma recusa: um 404 sabe-se que é um 404.
 *
 * Os tipos com ecrã próprio continuam a resolver; os que ainda não têm (inspeções, impostos,
 * seguros, odómetro) passam a ser recusados de forma visível. Construí-los é `WEB-004`.
 */
function configFor(kind: string): RecordConfig | null {
  return RECORD_CONFIG[kind] ?? null;
}

/**
 * Secção de registos que não existe.
 *
 * Reutiliza `EmptyState` e o mesmo vocabulário da `NotFoundPage` (`App.tsx`) — um segundo
 * estilo de recusa no mesmo produto seria pior do que a duplicação que evita. Diz o que
 * **existe** em vez de só o que falta, e dá sempre um caminho de volta.
 */
function UnknownRecordKind() {
  return (
    <div className="z-page">
      <EmptyState
        icon="🧭"
        title="Não encontrámos esta secção"
        body="As secções de registos são despesas, abastecimentos, carregamentos e manutenção. O endereço pode ter vindo de uma versão antiga da aplicação — a partir do painel chegas a todas."
        action={
          <NavLink to="/" className="z-btn z-btn--primary">
            Voltar ao painel
          </NavLink>
        }
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Apresentação de cada tipo                                                   */
/* -------------------------------------------------------------------------- */

function recordIcon(kind: string, record: unknown): string {
  if (kind === 'maintenance') return maintenanceIcon((record as MaintenanceRecord).type);
  if (kind === 'expenses') return categoryIcon((record as Expense).category);
  return kind === 'fuel' ? '⛽' : '🔌';
}

function recordTitle(kind: string, record: unknown): string {
  if (kind === 'expenses') return categoryLabel((record as Expense).category);
  if (kind === 'fuel') return (record as FuelSession).station ?? 'Abastecimento';
  if (kind === 'charging') return (record as ChargingSession).location ?? 'Carregamento';
  return optionLabel(MAINTENANCE_TYPES, (record as MaintenanceRecord).type);
}

/**
 * Linha secundária com as métricas derivadas.
 *
 * Aqui entram os valores que a API já calculou (§13, §14): consumo por 100 km, preço por
 * litro, distância desde o registo anterior. Mostrá-los na lista é o que transforma um livro
 * de despesas num instrumento de decisão — e o trabalho de os calcular já foi feito pelo
 * servidor, pelo que reimplementá-lo aqui seria duplicar a regra do método «depósito a
 * depósito». Essa regra é subtil e não é a mesma coisa para os dois casos: um abastecimento
 * parcial **com** odómetro é acumulado no intervalo seguinte; um abastecimento **sem**
 * odómetro torna o intervalo não determinável e a API devolve `null`, em vez de atribuir
 * arbitrariamente os litros a uma distância que não consegue verificar.
 */
function recordMeta(kind: string, record: unknown): string {
  if (kind === 'fuel') {
    const session = record as FuelSession;
    return [
      litres(session.litres),
      consumption(session.derived.consumptionL100Km),
      session.fullTank ? 'depósito cheio' : 'depósito parcial',
    ].join(' · ');
  }
  if (kind === 'charging') {
    const session = record as ChargingSession;
    return [
      `${formatNumber(session.energyKwh, 2)} kWh`,
      econsumption(session.derived.consumptionKwh100Km),
      session.isPublic === true ? 'público' : session.isHome === true ? 'casa' : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }
  if (kind === 'expenses') {
    const expense = record as Expense;
    return [expense.vendor, expense.description].filter(Boolean).join(' · ');
  }
  const maintenance = record as MaintenanceRecord;
  return [maintenance.workshop, maintenance.description].filter(Boolean).join(' · ');
}

function recordAmount(kind: string, record: unknown): string {
  if (kind === 'maintenance') {
    const maintenance = record as MaintenanceRecord;
    return maintenance.amountCents === null ? '—' : money(maintenance.amountCents);
  }
  return money((record as { amountCents: number }).amountCents);
}

function categoryIcon(code: string): string {
  return EXPENSE_CATEGORIES.find((category) => category.code === code)?.icon ?? '💶';
}

function maintenanceIcon(code: string): string {
  return MAINTENANCE_TYPES.find((type) => type.code === code)?.icon ?? '🔧';
}

/** Desloca uma data civil em `delta` meses, mantendo o primeiro dia do mês. */
function shiftMonth(date: string, delta: number): string {
  const [year, month] = date.split('-').map(Number) as [number, number];
  const total = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
}
