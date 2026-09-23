import { useMemo, useState } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import {
  EXPENSE_CATEGORIES,
  INSURANCE_COVERAGES,
  INSPECTION_RESULTS,
  MAINTENANCE_TYPES,
  TAX_KINDS,
  categoryLabel,
  formatNumber,
  optionLabel,
  type ChargingSession,
  type Expense,
  type FuelSession,
  type InsurancePolicy,
  type InspectionRecord,
  type MaintenanceRecord,
  type RecordKind,
  type TaxRecord,
} from '@zemlo/shared';
import {
  useChargingSessions,
  useExpenses,
  useFuelSessions,
  useInspections,
  useInsurance,
  useMaintenanceRecords,
  useOdometerReadings,
  useProfile,
  useTaxes,
} from '../../api/hooks';
import { errorMessage, errorRequestId } from '../../api/errors';
import { useFocusedVehicleId, useSelectedVehicle } from '../../hooks';
import { useQuickLog } from '../../components/QuickLogContext';
import { Button, Card, Chip, EmptyState, InlineError, LoadingBlock, PageHeader, Section } from '../../ui/primitives';
import { RecordsEmptyState } from '../../components/records';
import { consumption, dateLong, econsumption, km, litres, money, monthBounds, today } from '../../lib/format';

/**
 * Listas de registos com filtros.
 *
 * Um único componente para todos os tipos de registo, e não um ecrã por tipo. Partilham tudo
 * o que importa — filtro por período, estado vazio, ligação ao registo rápido e as duas
 * apresentações (lista em telemóvel, tabela em ambiente de trabalho) — e diferem apenas no que
 * mostram por linha. Ecrãs separados garantiriam que uns ficariam para trás à primeira
 * alteração ao comportamento da lista.
 *
 * ## Duas famílias de listas, com uma diferença que não é cosmética
 *
 * Os registos com valor e período (despesas, abastecimentos, carregamentos, manutenção) têm
 * endpoints que aceitam filtros (`from`/`to`/`category`) e respondem com paginação por cursor.
 * Os registos de conformidade (seguros, inspeções, impostos) têm endpoints próprios que
 * aceitam apenas `vehicleId` — não há filtro de datas no contrato — e respondem com a lista
 * completa. O odómetro é um terceiro caso, mais restrito: **não existe `/records/odometer`**;
 * as leituras vivem em `GET /vehicles/:vehicleId/odometer` e exigem um veículo concreto.
 *
 * Essa diferença está declarada em `RecordConfig.period` e `RecordConfig.requiresVehicle` e é
 * o que impede o ecrã de oferecer filtros que a API ignoraria em silêncio — um filtro que não
 * filtra é a mesma classe de defeito que `AUD-008`.
 *
 * ## Filtro de período: só onde a API o aceita
 *
 * Os chips de período e as duas datas só aparecem quando `config.period === true`. Nos ecrãs
 * de conformidade seriam decorativos — e um controlo decorativo ensina o utilizador a não
 * confiar nos controlos.
 *
 * ## Veículo: porquê a exceção do odómetro
 *
 * O dashboard e as estatísticas aceitam a conta inteira; a ficha do veículo, o seguro e os
 * lembretes não — não existe "seguro de todos os carros". As três listas de conformidade são
 * a exceção útil: a API filtra por `vehicleId` **opcional**, pelo que omiti-lo agrega a conta
 * inteira. O odómetro não tem essa liberdade (as leituras são sempre de um veículo), pelo que
 * resolve a seleção global para um veículo concreto e, quando a conta não tem nenhum, mostra
 * uma instrução em vez de uma lista vazia.
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

  /*
   * Veículo concreto para as listas que não agregam.
   *
   * `useFocusedVehicleId` existe precisamente para isto: resolve a seleção global (`'all'`)
   * para o veículo mais recente. Chamá-lo sempre — e não condicionalmente — mantém a ordem
   * dos hooks estável entre espécies de registo, como as quatro consultas abaixo.
   */
  const focusedVehicleId = useFocusedVehicleId();

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
   * As listas de conformidade agregam a conta inteira quando a seleção é `'all'`
   * (`selectedVehicleId` já é `undefined` nesse caso — o contrato da API trata a ausência de
   * `vehicleId` como "todos os veículos"). Declarar as três sempre, com o mesmo veículo da
   * seleção, evita o filtro inativo em forma de valor inválido que as consultas acima têm de
   * contornar.
   */
  const insurance = useInsurance(selectedVehicleId);
  const inspections = useInspections(selectedVehicleId);
  const taxes = useTaxes(selectedVehicleId);

  /*
   * O odómetro exige um veículo concreto. Quando a seleção é a conta inteira, resolve para o
   * veículo mais recente — e quando não há nenhum, `undefined` desativa a consulta
   * (`useOdometerReadings` tem `enabled: Boolean(vehicleId)`); o ecrã trata esse caso com uma
   * instrução, e não com uma lista vazia que pareceria "sem leituras".
   */
  const odometer = useOdometerReadings(focusedVehicleId);

  /*
   * Reunir as consultas num mapa indexado pelo tipo evita uma escada de `if` no corpo do
   * componente e mantém um único ponto onde o tipo do registo escolhe a fonte de dados.
   */
  const queries = useMemo(
    () => ({ expenses, fuel, charging, maintenance, insurance, inspections, taxes, odometer }),
    [expenses, fuel, charging, maintenance, insurance, inspections, taxes, odometer],
  );

  const vehicleById = useMemo(() => new Map(vehicles.map((vehicle) => [vehicle.id, vehicle])), [vehicles]);

  /*
   * Tipo de registo desconhecido: recusar, não degradar.
   *
   * O ramo tem de vir **depois** de todos os hooks (as consultas são declaradas sempre, com
   * filtro inativo quando não correspondem ao tipo) e antes de se tocar em `active` — que só
   * existe para um tipo que existe.
   */
  if (!config) return <UnknownRecordKind />;

  const active = queries[config.key];

  /*
   * Duas formas de resposta na mesma lista.
   *
   * As listas de conformidade e o odómetro respondem `{ items, total }` sem `nextCursor`; as
   * financeiras respondem `Page` (que é `{ items, total, nextCursor? }`). Ler apenas
   * `items`/`total` funciona para ambas e é o que o ecrã precisa — daí o tipo mínimo local em
   * vez de uma união de tipos que só serviria para o compilador não se queixar.
   */
  const payload = active.data as { items?: unknown[]; total?: number } | undefined;
  const records: unknown[] = payload?.items ?? [];
  const total = payload?.total ?? null;

  /*
   * Estado de "sem veículo" do odómetro.
   *
   * Não é o mesmo que "sem leituras": a consulta nem chegou a sair. Mostrar o estado vazio
   * genérico diria ao utilizador que não há leituras quando o que falta é um veículo — e ele
   * procuraria leituras que existem noutro sítio.
   */
  const needsVehicle = config.requiresVehicle === true && !focusedVehicleId;

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
          config.addable === false ? undefined : (
            <Button variant="highlight" onClick={() => quickLog.open(config.key as RecordKind)}>
              ＋ {config.addLabel}
            </Button>
          )
        }
      />

      {needsVehicle ? (
        <Card>
          <EmptyState
            icon={config.icon}
            title={config.emptyTitle}
            body={config.emptyBody}
            action={
              <Link to="/vehicles/new" className="z-btn z-btn--primary">
                Adicionar veículo
              </Link>
            }
          />
        </Card>
      ) : null}

      {needsVehicle ? null : (
        <>
          {config.period === true ? (
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
          ) : null}

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
              {...(config.addable === false || config.period !== true
                ? {}
                : {
                    onAdd: () => quickLog.open(config.key as RecordKind),
                    addLabel: config.addLabel,
                  })}
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
                    const date = recordDate(config.key, record);
                    const meta = recordMeta(config.key, record);
                    return (
                      <Link key={id} to={`/records/${config.key}/${id}`} className="z-list__item">
                        <span className="z-list__icon" aria-hidden="true">
                          {recordIcon(config.key, record)}
                        </span>
                        <span className="z-list__body">
                          <span className="z-list__title">{recordTitle(config.key, record)}</span>
                          <span className="z-list__meta">
                            {date ? dateLong(date) : ''}
                            {vehicle && vehicleId === 'all' && date ? ' · ' : ''}
                            {vehicle && vehicleId === 'all' ? vehicle.plateDisplay : ''}
                            {meta ? `${date || vehicle ? ' · ' : ''}${meta}` : ''}
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
                      <th>{config.dateColumn}</th>
                      <th>{config.primaryColumn}</th>
                      <th>Detalhe</th>
                      <th>Veículo</th>
                      <th className="z-table__num">{config.measureColumn}</th>
                      <th className="z-table__num">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((record) => {
                      const id = (record as { id: string }).id;
                      const vehicle = vehicleById.get((record as { vehicleId: string }).vehicleId);
                      const date = recordDate(config.key, record);
                      const measure = recordMeasure(config.key, record);
                      return (
                        <tr key={id}>
                          <td>{date ? dateLong(date) : '—'}</td>
                          <td>
                            <Link to={`/records/${config.key}/${id}`}>{recordTitle(config.key, record)}</Link>
                          </td>
                          <td className="z-muted">{recordMeta(config.key, record) || '—'}</td>
                          <td>{vehicle?.plateDisplay ?? '—'}</td>
                          <td className="z-table__num">{measure === null ? '—' : km(measure)}</td>
                          <td className="z-table__num">{recordAmount(config.key, record)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Configuração por tipo de registo                                            */
/* -------------------------------------------------------------------------- */

/**
 * Chaves de lista.
 *
 * Coincidem com os segmentos das rotas `/records/:kind` e com as chaves de `queries`. As
 * chaves de **detalhe** podem ser diferentes (`inspections` na lista, `inspections` no
 * detalhe; `inspection` é aceite como alias na API), o que `fetchRecordDetail` já resolve.
 */
type ListKind = 'expenses' | 'fuel' | 'charging' | 'maintenance' | 'insurance' | 'inspections' | 'taxes' | 'odometer';

interface RecordConfig {
  key: ListKind;
  title: string;
  subtitle: string;
  icon: string;
  addLabel: string;
  primaryColumn: string;
  /** Cabeçalho da coluna de data — «Data» nos financeiros, «Emitido»/«Data» na conformidade. */
  dateColumn: string;
  /** Cabeçalho da coluna numérica secundária — quilometragem, ano ou dias restantes. */
  measureColumn: string;
  emptyTitle: string;
  emptyBody: string;
  /**
   * `false` quando a lista não se cria a partir daqui.
   *
   * Impostos e inspeções criam-se com contexto de veículo e campos que a folha de registo
   * rápido não pede (resultado, estação, ano, prazo); abrir a folha de despesas para os criar
   * seria um botão que não faz o que promete. O ecrã mostra a lista sem ação de criação.
   */
  addable?: boolean;
  /**
   * `false` nas listas cujo endpoint não aceita `from`/`to`.
   *
   * Sem isto, o ecrã mostraria um filtro de datas que a API ignora — e o utilizador
   * concluiria que não tem registos no período quando tem.
   */
  period?: boolean;
  /**
   * `true` quando a lista exige um veículo concreto (odómetro).
   *
   * A consulta fica desativada sem veículo; o ecrã mostra uma instrução em vez de uma lista
   * vazia.
   */
  requiresVehicle?: boolean;
}

const RECORD_CONFIG: Record<string, RecordConfig> = {
  expenses: {
    key: 'expenses',
    title: 'Despesas',
    subtitle: 'Tudo o que gastaste com os teus veículos.',
    icon: '💶',
    addLabel: 'Nova despesa',
    primaryColumn: 'Categoria',
    dateColumn: 'Data',
    measureColumn: 'Quilometragem',
    emptyTitle: 'Ainda sem despesas',
    emptyBody:
      'Uma despesa são três campos: valor, categoria e data. Seguro, IUC, lavagens, portagens — tudo entra aqui, e é isso que faz o custo por km ser verdadeiro.',
    period: true,
  },
  fuel: {
    key: 'fuel',
    title: 'Abastecimentos',
    subtitle: 'Litros, preço e consumo real, depósito a depósito.',
    icon: '⛽',
    addLabel: 'Novo abastecimento',
    primaryColumn: 'Posto',
    dateColumn: 'Data',
    measureColumn: 'Quilometragem',
    emptyTitle: 'Ainda sem abastecimentos',
    emptyBody:
      'Basta registar litros, valor e quilometragem. Entre dois depósitos cheios, o Zemlo calcula o consumo real — não a estimativa do construtor.',
    period: true,
  },
  charging: {
    key: 'charging',
    title: 'Carregamentos',
    subtitle: 'Energia, custo por kWh e consumo elétrico.',
    icon: '🔌',
    addLabel: 'Novo carregamento',
    primaryColumn: 'Local',
    dateColumn: 'Data',
    measureColumn: 'Quilometragem',
    emptyTitle: 'Ainda sem carregamentos',
    emptyBody:
      'Registar um carregamento são dois campos: energia e valor. Com a quilometragem, passas a ver o custo por 100 km em casa e na rede.',
    period: true,
  },
  maintenance: {
    key: 'maintenance',
    title: 'Manutenção',
    subtitle: 'Intervenções, oficinas e o prazo seguinte de cada uma.',
    icon: '🔧',
    addLabel: 'Nova manutenção',
    primaryColumn: 'Intervenção',
    dateColumn: 'Data',
    measureColumn: 'Quilometragem',
    emptyTitle: 'Ainda sem manutenções',
    emptyBody:
      'Revisões, óleo, travões, pneus. Se indicares o intervalo, o Zemlo cria automaticamente o lembrete da próxima intervenção.',
    period: true,
  },
  insurance: {
    key: 'insurance',
    title: 'Seguros',
    subtitle: 'Apólices, coberturas e o que falta até cada renovação.',
    icon: '🛡️',
    addLabel: 'Nova apólice',
    primaryColumn: 'Seguradora',
    dateColumn: 'Início',
    measureColumn: 'Dias',
    emptyTitle: 'Ainda sem apólices',
    emptyBody:
      'Regista a seguradora, a cobertura e o fim da apólice. O Zemlo avisa-te antes de a apólice expirar — e mostra qual está em vigor hoje.',
  },
  inspections: {
    key: 'inspections',
    title: 'Inspeções',
    subtitle: 'Resultados, estações e a data da próxima inspeção.',
    icon: '🔍',
    addLabel: 'Nova inspeção',
    primaryColumn: 'Resultado',
    dateColumn: 'Data',
    measureColumn: 'Quilometragem',
    emptyTitle: 'Ainda sem inspeções',
    emptyBody:
      'Regista a data, o resultado e — se a inspeção tiver prazo — a data da próxima. Com esse prazo, o Zemlo cria o lembrete automaticamente.',
    addable: false,
  },
  taxes: {
    key: 'taxes',
    title: 'Impostos',
    subtitle: 'IUC, ISV e identificadores de portagens, ano a ano.',
    icon: '🏛️',
    addLabel: 'Registar imposto',
    primaryColumn: 'Imposto',
    dateColumn: 'Data',
    measureColumn: 'Ano',
    emptyTitle: 'Ainda sem impostos',
    emptyBody:
      'O IUC é anual e o valor depende do veículo e do ano. Registar cada pagamento é o que torna o custo por km real — e o que evita a surpresa do aviso à porta.',
    addable: false,
  },
  odometer: {
    key: 'odometer',
    title: 'Quilometragem',
    subtitle: 'Leituras de odómetro, uma a uma, com a origem de cada uma.',
    icon: '📍',
    addLabel: 'Registar quilometragem',
    primaryColumn: 'Origem',
    dateColumn: 'Leitura',
    measureColumn: 'Quilometragem',
    emptyTitle: 'Sem veículo para mostrar',
    emptyBody:
      'As leituras de quilometragem pertencem a um veículo — não existe "odómetro de todos os carros". Adiciona um veículo (ou escolhe um na barra lateral) para veres o histórico de leituras.',
    addable: false,
    requiresVehicle: true,
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
 * Os oito tipos com lista própria resolvem aqui; o que não estiver no mapa continua a ser
 * recusado de forma visível. Foi `WEB-004` que acrescentou seguros, inspeções, impostos e
 * odómetro — antes disso, eram recusados por não terem ecrã nenhum (`AUD-008`), o que era a
 * resposta correta enquanto assim era. Agora têm.
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
        body="As secções de registos são despesas, abastecimentos, carregamentos, manutenção, seguros, inspeções, impostos e quilometragem. O endereço pode ter vindo de uma versão antiga da aplicação — a partir do painel chegas a todas."
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
  if (kind === 'insurance') return INSURANCE_COVERAGES.find((item) => item.code === (record as InsurancePolicy).coverage)?.icon ?? '🛡️';
  if (kind === 'inspections') return INSPECTION_RESULTS.find((item) => item.code === (record as InspectionRecord).result)?.icon ?? '🔍';
  if (kind === 'taxes') return TAX_KINDS.find((item) => item.code === (record as TaxRecord).kind)?.icon ?? '🏛️';
  if (kind === 'odometer') return '📍';
  return kind === 'fuel' ? '⛽' : '🔌';
}

function recordTitle(kind: string, record: unknown): string {
  if (kind === 'expenses') return categoryLabel((record as Expense).category);
  if (kind === 'fuel') return (record as FuelSession).station ?? 'Abastecimento';
  if (kind === 'charging') return (record as ChargingSession).location ?? 'Carregamento';
  if (kind === 'insurance') return (record as InsurancePolicy).insurer || 'Seguro';
  if (kind === 'inspections') return optionLabel(INSPECTION_RESULTS, (record as InspectionRecord).result);
  if (kind === 'taxes') return optionLabel(TAX_KINDS, (record as TaxRecord).kind);
  if (kind === 'odometer') return 'Leitura de odómetro';
  return optionLabel(MAINTENANCE_TYPES, (record as MaintenanceRecord).type);
}

/**
 * Data principal da linha, por tipo.
 *
 * A conformidade não tem sempre um `date` único: uma apólice tem início **e** fim, um imposto
 * pode não ter data de pagamento (só prazo). Devolver `null` é intencional — a lista mostra a
 * data que o tipo tem, e a coluna «Detalhe» mostra o que fica por explicar, em vez de inventar
 * uma data que o registo não tem.
 */
function recordDate(kind: string, record: unknown): string | null {
  if (kind === 'insurance') return (record as InsurancePolicy).startDate ?? null;
  if (kind === 'inspections') return (record as InspectionRecord).date ?? null;
  if (kind === 'taxes') {
    const tax = record as TaxRecord;
    return tax.date ?? tax.dueDate ?? null;
  }
  if (kind === 'odometer') return (record as { recordedAt?: string }).recordedAt ?? null;
  return (record as { date?: string }).date ?? null;
}

/**
 * Linha secundária com as métricas derivadas ou o contexto que a lista não mostra sozinha.
 *
 * Aqui entram os valores que a API já calculou (§13, §14): consumo por 100 km, preço por
 * litro, distância desde o registo anterior. Mostrá-los na lista é o que transforma um livro
 * de despesas num instrumento de decisão — e o trabalho de os calcular já foi feito pelo
 * servidor, pelo que reimplementá-lo aqui seria duplicar a regra do método «depósito a
 * depósito». Essa regra é subtil e não é a mesma coisa para os dois casos: um abastecimento
 * parcial **com** odómetro é acumulado no intervalo seguinte; um abastecimento **sem**
 * odómetro torna o intervalo não determinável e a API devolve `null`, em vez de atribuir
 * arbitrariamente os litros a uma distância que não consegue verificar.
 *
 * Na conformidade, o meta é o que sobra por explicar: a cobertura de uma apólice, a estação de
 * uma inspeção, o prazo de um imposto. São os campos que decidem a próxima ação do utilizador.
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
  if (kind === 'insurance') {
    const policy = record as InsurancePolicy;
    return [
      optionLabel(INSURANCE_COVERAGES, policy.coverage),
      policy.policyNumber,
      policy.endDate ? `termina a ${dateLong(policy.endDate)}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }
  if (kind === 'inspections') {
    const inspection = record as InspectionRecord;
    return [
      inspection.station,
      inspection.nextDueDate ? `próxima a ${dateLong(inspection.nextDueDate)}` : '',
      inspection.defects,
    ]
      .filter(Boolean)
      .join(' · ');
  }
  if (kind === 'taxes') {
    const tax = record as TaxRecord;
    return [
      String(tax.year),
      tax.paid ? 'pago' : 'por pagar',
      !tax.paid && tax.dueDate ? `vence a ${dateLong(tax.dueDate)}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }
  if (kind === 'odometer') {
    const reading = record as { source?: { label?: string | null; kind?: string | null } | null; notes?: string | null };
    return [reading.source?.label, reading.source?.kind, reading.notes].filter(Boolean).join(' · ');
  }
  const maintenance = record as MaintenanceRecord;
  return [maintenance.workshop, maintenance.description].filter(Boolean).join(' · ');
}

/** Coluna numérica secundária. `null` quando o tipo não tem uma — a célula mostra «—». */
function recordMeasure(kind: string, record: unknown): number | null {
  if (kind === 'taxes') return (record as TaxRecord).year;
  if (kind === 'odometer') return (record as { odometerKm?: number | null }).odometerKm ?? null;
  return (record as { odometerKm?: number | null }).odometerKm ?? null;
}

function recordAmount(kind: string, record: unknown): string {
  if (kind === 'odometer') return '';
  if (kind === 'insurance') {
    const policy = record as InsurancePolicy;
    return policy.premiumCents === null ? '—' : money(policy.premiumCents);
  }
  if (kind === 'inspections') {
    const inspection = record as InspectionRecord;
    return inspection.amountCents === null ? '—' : money(inspection.amountCents);
  }
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
