import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  REMINDER_TRIGGERS,
  addMonths,
  formatNumber,
  optionLabel,
  todayIn,
  type Reminder,
  type VehicleDetail,
} from '@zemlo/shared';
import {
  useCompleteReminder,
  useCreateInsurance,
  useCreateInspection,
  useCreateReminder,
  useCreateTax,
  useDeleteReminder,
  useDeleteVehicle,
  useDocuments,
  useInspections,
  useInsurance,
  useOdometerReadings,
  useProfile,
  useReminders,
  useSnoozeReminder,
  useStats,
  useTaxes,
  useUpdateVehicle,
  useVehicle,
} from '../../api/hooks';
import { errorMessage, errorRequestId } from '../../api/errors';
import { ApiError } from '../../api/client';
import {
  Button,
  Card,
  Chip,
  DetailList,
  DetailRow,
  EmptyState,
  InlineError,
  LoadingBlock,
  Metric,
  PageHeader,
  Section,
} from '../../ui/primitives';
import {
  CheckboxField,
  DateField,
  MoneyField,
  NumberField,
  SelectField,
  TextAreaField,
  TextField,
  centsToInput,
  useFormState,
} from '../../ui/form';
import { CategoryBreakdown, MonthlyBars } from '../../components/charts';
import { COVERAGE_OPTIONS } from '../../components/formParts';
import { RecordsEmptyState, TimelineRow, groupByMonth } from '../../components/records';
import { useQuickLog } from '../../components/QuickLogContext';
import { useTimeline } from '../../hooks/useTimeline';
import { Icon } from '../../ui/Icon';
import { recordIconName } from '../../lib/registerMenu';
import { recordKindLabel } from '../../lib/recordKinds';
import { dateLong, km, money, relativeDate, today } from '../../lib/format';
import { nextTabIndex } from '../../lib/tabs';
import { amountOrUndefined, integerOrUndefined, textOrUndefined } from '../../lib/formPayload';

/**
 * Ficha do veículo, com separadores.
 *
 * A ordem dos separadores segue a §9 e o hábito de consulta:
 *
 *  1. **Visão geral** — o estado atual, o que exige atenção hoje;
 *  2. **Ficha** — os dados técnicos, editáveis;
 *  3. **Estatísticas** — o que os registos dizem;
 *  4. **Histórico** — tudo o que aconteceu, por ordem;
 *  5. **Seguro**, **Inspeções**, **Impostos**, **Documentos**, **Lembretes** — os cinco
 *     domínios com prazos próprios.
 *
 * O separador ativo é um **parâmetro de consulta** (`?tab=`) e não um segmento de caminho:
 * é o que a API usa nos `href` que devolve (`/vehicles/:id?tab=insurance`) e é o que
 * permite ligar diretamente a um separador a partir de um cartão de estado ou de uma
 * notificação, sem uma tabela de tradução entre os dois formatos.
 */

/** Separares, na ordem de apresentação. A chave é o valor de `?tab=`. */
const TABS = [
  { key: 'overview', label: 'Visão geral', icon: '📌' },
  { key: 'sheet', label: 'Ficha', icon: '📋' },
  { key: 'stats', label: 'Estatísticas', icon: '📊' },
  { key: 'timeline', label: 'Histórico', icon: '🕒' },
  { key: 'insurance', label: 'Seguro', icon: '🛡️' },
  { key: 'inspections', label: 'Inspeções', icon: '✅' },
  { key: 'taxes', label: 'Impostos', icon: '🏛️' },
  { key: 'documents', label: 'Documentos', icon: '📄' },
  { key: 'reminders', label: 'Lembretes', icon: '🔔' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/**
 * Aliases aceites em `?tab=`.
 *
 * A API devolve `?tab=reminders` e `?tab=inspections`, mas o documento da especificação
 * refere `?sheet=insurance` num exemplo. Aceitar as duas formas custa um mapa e evita que um
 * link antigo — ou um link escrito à mão por quem conhece a especificação — caia no
 * separador errado em silêncio.
 */
const TAB_ALIASES: Record<string, TabKey> = {
  overview: 'overview',
  visao: 'overview',
  sheet: 'sheet',
  ficha: 'sheet',
  stats: 'stats',
  estatisticas: 'stats',
  timeline: 'timeline',
  historico: 'timeline',
  insurance: 'insurance',
  seguro: 'insurance',
  inspections: 'inspections',
  inspection: 'inspections',
  inspecoes: 'inspections',
  taxes: 'taxes',
  tax: 'taxes',
  impostos: 'taxes',
  documents: 'documents',
  document: 'documents',
  documentos: 'documents',
  reminders: 'reminders',
  reminder: 'reminders',
  lembretes: 'reminders',
};

export function VehicleDetailPage() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const vehicle = useVehicle(vehicleId);

  const requested = searchParams.get('tab') ?? searchParams.get('sheet') ?? 'overview';
  const activeTab: TabKey = TAB_ALIASES[requested] ?? 'overview';

  if (vehicle.isLoading) return <LoadingBlock label="A carregar o veículo…" />;

  if (vehicle.isError) {
    return (
      <div className="z-page">
        <InlineError
          message={errorMessage(vehicle.error)}
          requestId={errorRequestId(vehicle.error)}
          onRetry={() => void vehicle.refetch()}
        />
      </div>
    );
  }

  /*
   * Sem dados, sem carregamento e sem erro: a consulta está desativada (`enabled`) porque o
   * endereço não traz identificador — um link truncado ou escrito à mão. Devolver `null`
   * deixava um **ecrã em branco**, sem mensagem e sem caminho de saída, que é precisamente o
   * que `WEB-005` proíbe.
   */
  if (!vehicle.data) {
    return (
      <div className="z-page">
        <PageHeader title="Veículo" back={{ to: '/vehicles', label: 'Veículos' }} />
        <EmptyState
          icon="🚗"
          title="Não encontrámos este veículo"
          body="O endereço pode estar incompleto ou o veículo pode ter sido eliminado. A partir da lista chegas a todos."
          action={
            <Link to="/vehicles" className="z-btn z-btn--primary">
              Ver os meus veículos
            </Link>
          }
        />
      </div>
    );
  }

  const data = vehicle.data;
  const name = data.nickname ?? ([data.make, data.model].filter(Boolean).join(' ') || data.plateDisplay);

  return (
    <div className="z-page">
      <PageHeader
        title={name}
        subtitle={
          <span className="z-row z-row--wrap" style={{ gap: 'var(--z-space-2)' }}>
            <span className="z-numeric">{data.plateDisplay}</span>
            {data.year ? <span>· {data.year}</span> : null}
            {data.archived ? <Chip tone="warn">Arquivado</Chip> : null}
          </span>
        }
        back={{ to: '/vehicles', label: 'Veículos' }}
        actions={
          <>
            <Link to={`/stats?vehicleId=${data.id}`} className="z-btn z-btn--secondary z-btn--sm">
              Estatísticas
            </Link>
            <Link to={`/timeline?vehicleId=${data.id}`} className="z-btn z-btn--secondary z-btn--sm">
              Histórico
            </Link>
          </>
        }
      />

      <VehicleSummaryBar vehicle={data} />

      <Tabs
        active={activeTab}
        onChange={(key) => {
          const next = new URLSearchParams(searchParams);
          // `overview` é a omissão: manter o endereço limpo evita que um link copiado do
          // separador principal traga um parâmetro que não diz nada.
          if (key === 'overview') next.delete('tab');
          else next.set('tab', key);
          setSearchParams(next, { replace: true });
        }}
      />

      {activeTab === 'overview' && <OverviewTab vehicle={data} />}
      {activeTab === 'sheet' && <SheetTab vehicle={data} />}
      {activeTab === 'stats' && <StatsTab vehicleId={data.id} />}
      {activeTab === 'timeline' && <TimelineTab vehicleId={data.id} />}
      {activeTab === 'insurance' && <InsuranceTab vehicleId={data.id} />}
      {activeTab === 'inspections' && <InspectionsTab vehicleId={data.id} />}
      {activeTab === 'taxes' && <TaxesTab vehicleId={data.id} />}
      {activeTab === 'documents' && <DocumentsTab vehicleId={data.id} />}
      {activeTab === 'reminders' && <RemindersTab vehicleId={data.id} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Barra de resumo                                                             */
/* -------------------------------------------------------------------------- */

function VehicleSummaryBar({ vehicle }: { vehicle: VehicleDetail }) {
  const total = vehicle.counts;
  return (
    <Card>
      <div className="z-grid z-grid--4">
        <Metric label="Quilometragem" value={vehicle.odometerKm === null ? '—' : km(vehicle.odometerKm)} hint={vehicle.odometerUpdatedAt ? `lida em ${dateLong(vehicle.odometerUpdatedAt.slice(0, 10))}` : 'sem leituras'} small />
        <Metric label="Custo total" value={money(vehicle.totalCostCents)} hint="desde o início" small />
        <Metric label="Registos" value={formatNumber(total.expenses + total.fuel + total.charging + total.maintenance, 0)} hint={`${formatNumber(total.documents, 0)} documentos`} small />
        <Metric label="Documentos" value={formatNumber(total.documents, 0)} hint={`${formatNumber(total.reminders, 0)} lembretes ativos`} small />
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Separadores                                                                 */
/* -------------------------------------------------------------------------- */

function Tabs({ active, onChange }: { active: TabKey; onChange: (key: TabKey) => void }) {
  const list = useRef<HTMLDivElement>(null);

  /*
   * Teclado no padrão de separadores (`WEB-006`, achado A2).
   *
   * `role="tab"` não é decoração: quem o declara fica obrigado ao padrão que esse papel
   * nomeia. Antes disto, os nove separadores eram nove paradas de tabulação e as setas não
   * faziam nada — quem usa teclado atravessava nove botões para chegar ao conteúdo, e o
   * comportamento não correspondia ao que o papel promete a um leitor de ecrã.
   *
   * São duas metades que só servem juntas: **roving tabindex** (só o separador ativo está na
   * ordem de tabulação, e por isso `Tab` sai da lista em vez de a percorrer) e as **setas**
   * para andar dentro dela. Sem a primeira, as setas seriam um atalho a mais; sem a segunda,
   * os separadores inativos ficariam inalcançáveis por teclado.
   *
   * A aritmética das teclas vive em `lib/tabs.ts`, onde é testada; aqui fica só a ligação ao
   * DOM — mudar o separador ativo e levar o foco atrás. O foco move-se **depois** de
   * `onChange`: o elemento já existe (muda-lhe o `tabIndex`, não a identidade), por isso
   * focá-lo antes da re-renderização funciona e o foco fica onde o utilizador o deixou.
   */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = nextTabIndex(event.key, TABS.findIndex((tab) => tab.key === active), TABS.length);
    if (next === null) return;

    // Sem isto, `Home`/`End` e as setas mudavam de separador **e** deslocavam a página.
    event.preventDefault();

    const target = TABS[next];
    if (!target) return;
    onChange(target.key);
    list.current?.querySelector<HTMLButtonElement>(`#tab-${target.key}`)?.focus();
  }

  return (
    <div
      className="z-tabs"
      role="tablist"
      aria-label="Secções do veículo"
      ref={list}
      onKeyDown={onKeyDown}
    >
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          id={`tab-${tab.key}`}
          className="z-tabs__tab"
          aria-selected={active === tab.key}
          aria-controls={`panel-${tab.key}`}
          tabIndex={active === tab.key ? 0 : -1}
          onClick={() => onChange(tab.key)}
        >
          <span aria-hidden="true">{tab.icon}</span>
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Visão geral                                                                 */
/* -------------------------------------------------------------------------- */

function OverviewTab({ vehicle }: { vehicle: VehicleDetail }) {
  const dashboard = useStats({ vehicleId: vehicle.id, months: 12 });
  const reminders = useReminders({ vehicleId: vehicle.id });
  const quickLog = useQuickLog();

  const upcoming = (reminders.data?.items ?? [])
    .filter((reminder) => reminder.evaluation.state !== 'ok')
    .sort((a, b) => stateRank(a) - stateRank(b));

  return (
    <div className="z-stack z-stack--loose" role="tabpanel" id="panel-overview" aria-labelledby="tab-overview">
      {upcoming.length > 0 ? (
        <Section title="Precisa de atenção" hint={`${upcoming.length} ${upcoming.length === 1 ? 'item' : 'itens'}`}>
          <div className="z-grid z-grid--3">
            {upcoming.slice(0, 6).map((reminder) => (
              <Card key={reminder.id} soft>
                <div className="z-row" style={{ gap: 'var(--z-space-3)', alignItems: 'flex-start' }}>
                  <span aria-hidden="true">{reminderIcon(reminder)}</span>
                  <div>
                    <div className="z-strong">{reminder.title}</div>
                    <div className="z-small z-muted">{reminder.evaluation.summary}</div>
                    <Chip tone={reminder.evaluation.state === 'overdue' ? 'danger' : 'warn'}>
                      {reminder.evaluation.state === 'overdue' ? 'Em atraso' : 'Em breve'}
                    </Chip>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </Section>
      ) : (
        <Card soft>
          <div className="z-row z-row--between z-row--wrap">
            <span>
              <strong>Está tudo em dia.</strong> Nenhum prazo exige atenção nos próximos tempos.
            </span>
            <Chip tone="ok">✅ Em dia</Chip>
          </div>
        </Card>
      )}

      <section aria-label="Registo rápido">
        <div className="z-quick-actions">
          {/*
            Os quatro tipos do dia a dia, com a **mesma** fonte de ícone e de rótulo que o menu
            «Registar» (§46) e o seletor «Escolher outro tipo» (§53): `recordIconName` para o
            desenho, `recordKindLabel` para o substantivo. Antes, esta lista era um quarto
            vocabulário próprio — um ternário de emojis (`💶⛽🔌🔧`) e outro de rótulos escritos
            à mão — pelo que o mesmo tipo aparecia desenhado de duas maneiras dentro do produto,
            e renomear um tipo no contrato deixava esta cópia a divergir em silêncio.

            O `as const` fica: a ordem e o conjunto são uma decisão desta secção (os quatro do
            painel, sem a quilometragem, que tem o seu próprio caminho), e o tipo restrito é o
            que garante que `quickLog.open` recebe um tipo de registo válido.
          */}
          {(['expense', 'fuel', 'charging', 'maintenance'] as const).map((kind) => (
            <button key={kind} type="button" className="z-quick-action" onClick={() => quickLog.open(kind)}>
              <span className="z-quick-action__icon" aria-hidden="true">
                <Icon name={recordIconName(kind)} />
              </span>
              {recordKindLabel(kind)}
            </button>
          ))}
        </div>
      </section>

      {/*
       * A consulta dos custos do ano falhava em silêncio: o cartão era renderizado com
       * `dashboard.data ? … : null`, pelo que um erro do servidor desaparecia sem deixar
       * rasto — o utilizador via o separador sem a secção e sem saber porquê.
       */}
      {dashboard.isLoading ? <LoadingBlock label="A carregar os custos do ano…" /> : null}

      {dashboard.isError ? (
        <InlineError
          message={errorMessage(dashboard.error)}
          requestId={errorRequestId(dashboard.error)}
          onRetry={() => void dashboard.refetch()}
        />
      ) : null}

      {dashboard.data ? (
        <Card>
          <div className="z-card__header">
            <div>
              <div className="z-card__title">Custos de {dashboard.data.scope.year}</div>
              <div className="z-card__subtitle">Este veículo, isolado da restante conta</div>
            </div>
          </div>
          <div className="z-grid z-grid--3">
            <Metric label="Total do ano" value={money(dashboard.data.totals.totalCents)} small />
            <Metric label="Custo por km" value={dashboard.data.unitCosts.costPerKmCents === null ? '—' : money(dashboard.data.unitCosts.costPerKmCents)} small />
            <Metric label="Km no período" value={dashboard.data.distance.kmInWindow === null ? '—' : km(dashboard.data.distance.kmInWindow)} small />
          </div>
          {dashboard.data.monthly.length > 0 ? (
            <div style={{ marginTop: 'var(--z-space-4)' }}>
              <MonthlyBars
                data={dashboard.data.monthly}
                ariaLabel={`Custos mensais deste veículo em ${dashboard.data.scope.year}`}
              />
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

/**
 * Ordem de urgência de um estado de lembrete.
 *
 * Escrita como mapa explícito, e não como uma cadeia de comparações, para que a ordem fique
 * visível e auditável: um lembrete em atraso tem de vir sempre à frente de um que está bem.
 */
const STATE_URGENCY: Record<Reminder['evaluation']['state'], number> = {
  overdue: 0,
  due: 1,
  soon: 2,
  unknown: 3,
  ok: 4,
};

function stateRank(reminder: Reminder): number {
  return STATE_URGENCY[reminder.evaluation.state] ?? 9;
}

function reminderIcon(reminder: Reminder): string {
  const title = reminder.title.toLowerCase();
  if (title.includes('seguro')) return '🛡️';
  if (title.includes('inspeç') || title.includes('inspec')) return '📋';
  if (title.includes('iuc') || title.includes('imposto')) return '🏛️';
  if (title.includes('pneu')) return '🛞';
  return '🔧';
}

/* -------------------------------------------------------------------------- */
/* Ficha                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Ficha técnica, editável.
 *
 * Um único "Guardar" no fim, e não gravação automática por campo: a ficha tem vinte campos
 * e uma gravação por campo produziria vinte pedidos e vinte entradas de auditoria para o
 * que o utilizador vê como uma ação. O botão fica desativado enquanto nada mudou — o que
 * também diz ao utilizador que o ecrã está sincronizado.
 */
function SheetTab({ vehicle }: { vehicle: VehicleDetail }) {
  const update = useUpdateVehicle(vehicle.id);
  const quickLog = useQuickLog();
  const navigate = useNavigate();

  const form = useFormState({
    nickname: vehicle.nickname ?? '',
    make: vehicle.make ?? '',
    model: vehicle.model ?? '',
    version: vehicle.version ?? '',
    year: vehicle.year === null ? '' : String(vehicle.year),
    color: vehicle.color ?? '',
    vin: vehicle.vin ?? '',
    engineCode: vehicle.engineCode ?? '',
    powerCv: vehicle.powerCv === null ? '' : String(vehicle.powerCv),
    engineDisplacementCc: vehicle.engineDisplacementCc === null ? '' : String(vehicle.engineDisplacementCc),
    transmission: vehicle.transmission ?? '',
    drivetrain: vehicle.drivetrain ?? '',
    batteryCapacityKwh: vehicle.batteryCapacityKwh === null ? '' : String(vehicle.batteryCapacityKwh),
    usableBatteryKwh: vehicle.usableBatteryKwh === null ? '' : String(vehicle.usableBatteryKwh),
    rangeKm: vehicle.rangeKm === null ? '' : String(vehicle.rangeKm),
    tankCapacityL: vehicle.tankCapacityL === null ? '' : String(vehicle.tankCapacityL),
    tyreSize: vehicle.tyreSize ?? '',
    wheelSize: vehicle.wheelSize ?? '',
    weightKg: vehicle.weightKg === null ? '' : String(vehicle.weightKg),
    co2GKm: vehicle.co2GKm === null ? '' : String(vehicle.co2GKm),
    purchasePrice: centsToInput(vehicle.purchasePriceCents),
    purchaseOdometerKm: vehicle.purchaseOdometerKm === null ? '' : String(vehicle.purchaseOdometerKm),
    purchaseDate: vehicle.purchaseDate ?? '',
    registrationDate: vehicle.registrationDate ?? '',
    firstRegistrationDate: vehicle.firstRegistrationDate ?? '',
    notes: vehicle.notes ?? '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setSaved(false);

    // Só os campos que o utilizador preencheu entram no corpo: um PATCH parcial não deve
    // apagar um valor existente só porque o utilizador não lhe tocou. O `null` explícito
    // fica reservado para "apagar este campo", que é uma ação que a interface ainda não
    // oferece — e é melhor não a oferecer do que oferecê-la por acidente.
    const payload: Record<string, unknown> = {};
    for (const key of ['nickname', 'make', 'model', 'version', 'color', 'vin', 'engineCode', 'transmission', 'drivetrain', 'tyreSize', 'wheelSize', 'notes', 'purchaseDate', 'registrationDate', 'firstRegistrationDate'] as const) {
      const value = textOrUndefined(form.values[key]);
      if (value !== undefined) payload[key] = value;
    }
    for (const key of ['year', 'powerCv', 'engineDisplacementCc', 'rangeKm', 'co2GKm', 'weightKg', 'purchaseOdometerKm'] as const) {
      const value = integerOrUndefined(form.values[key]);
      if (value !== undefined) payload[key] = value;
    }
    // Os decimais (bateria, depósito) aceitam casas decimais na API.
    for (const key of ['batteryCapacityKwh', 'usableBatteryKwh'] as const) {
      const raw = form.values[key].replace(/\s/g, '').replace(',', '.');
      if (raw) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) payload[key] = parsed;
      }
    }
    const tank = integerOrUndefined(form.values.tankCapacityL);
    if (tank !== undefined) payload.tankCapacityL = tank;
    const price = amountOrUndefined(form.values.purchasePrice);
    if (price !== undefined) payload.purchasePriceCents = price;

    try {
      await update.mutateAsync(payload as never);
      setSaved(true);
    } catch (error) {
      if (error instanceof ApiError) {
        const map: Record<string, string> = {};
        for (const field of error.fields) map[field.path] = field.message;
        setErrors(map);
      }
    }
  }

  return (
    <div className="z-stack z-stack--loose" role="tabpanel" id="panel-sheet" aria-labelledby="tab-sheet">
      <form className="z-stack z-stack--loose" onSubmit={onSubmit} noValidate>
        <Card>
          <div className="z-card__header">
            <div className="z-card__title">Identificação</div>
          </div>
          <div className="z-stack">
            <div className="z-grid z-grid--3">
              <TextField label="Apelido" value={form.values.nickname} onChange={(event) => form.setValue('nickname', event.target.value)} error={errors.nickname} />
              <TextField label="Marca" value={form.values.make} onChange={(event) => form.setValue('make', event.target.value)} error={errors.make} />
              <TextField label="Modelo" value={form.values.model} onChange={(event) => form.setValue('model', event.target.value)} error={errors.model} />
            </div>
            <div className="z-grid z-grid--3">
              <TextField label="Versão" value={form.values.version} onChange={(event) => form.setValue('version', event.target.value)} error={errors.version} />
              <NumberField label="Ano" value={form.values.year} onChange={(value) => form.setValue('year', value)} error={errors.year} />
              <TextField label="Cor" value={form.values.color} onChange={(event) => form.setValue('color', event.target.value)} error={errors.color} />
            </div>
            <TextField
              label="Matrícula"
              value={vehicle.plateDisplay}
              readOnly
              disabled
              hint="Para corrigir a matrícula, contacta o apoio: é o identificador associado a todo o histórico."
            />
          </div>
        </Card>

        <Card>
          <div className="z-card__header">
            <div className="z-card__title">Técnica</div>
            <div className="z-card__subtitle">Todos os campos são opcionais</div>
          </div>
          <div className="z-stack">
            <div className="z-grid z-grid--2">
              <TextField label="Número de chassis (VIN)" value={form.values.vin} onChange={(event) => form.setValue('vin', event.target.value)} error={errors.vin} />
              <TextField label="Código do motor" value={form.values.engineCode} onChange={(event) => form.setValue('engineCode', event.target.value)} error={errors.engineCode} />
            </div>
            <div className="z-grid z-grid--3">
              <NumberField label="Potência" suffix="cv" value={form.values.powerCv} onChange={(value) => form.setValue('powerCv', value)} error={errors.powerCv} />
              <NumberField label="Cilindrada" suffix="cm³" value={form.values.engineDisplacementCc} onChange={(value) => form.setValue('engineDisplacementCc', value)} error={errors.engineDisplacementCc} />
              <NumberField label="Peso" suffix="kg" value={form.values.weightKg} onChange={(value) => form.setValue('weightKg', value)} error={errors.weightKg} />
            </div>
            <div className="z-grid z-grid--3">
              <SelectField
                label="Caixa"
                placeholder="Não indicado"
                value={form.values.transmission}
                onChange={(event) => form.setValue('transmission', event.target.value)}
                options={[
                  { value: 'manual', label: 'Manual' },
                  { value: 'automatic', label: 'Automática' },
                  { value: 'semi_automatic', label: 'Semiautomática' },
                  { value: 'other', label: 'Outra' },
                ]}
                error={errors.transmission}
              />
              <SelectField
                label="Tração"
                placeholder="Não indicado"
                value={form.values.drivetrain}
                onChange={(event) => form.setValue('drivetrain', event.target.value)}
                options={[
                  { value: 'fwd', label: 'Dianteira' },
                  { value: 'rwd', label: 'Traseira' },
                  { value: 'awd', label: 'Integral' },
                  { value: 'other', label: 'Outra' },
                ]}
                error={errors.drivetrain}
              />
              <NumberField label="CO₂" suffix="g/km" value={form.values.co2GKm} onChange={(value) => form.setValue('co2GKm', value)} error={errors.co2GKm} />
            </div>
            <div className="z-grid z-grid--3">
              <NumberField label="Bateria" suffix="kWh" value={form.values.batteryCapacityKwh} onChange={(value) => form.setValue('batteryCapacityKwh', value)} error={errors.batteryCapacityKwh} />
              <NumberField label="Bateria útil" suffix="kWh" value={form.values.usableBatteryKwh} onChange={(value) => form.setValue('usableBatteryKwh', value)} error={errors.usableBatteryKwh} />
              <NumberField label="Autonomia" suffix="km" value={form.values.rangeKm} onChange={(value) => form.setValue('rangeKm', value)} error={errors.rangeKm} />
            </div>
            <div className="z-grid z-grid--3">
              <NumberField label="Depósito" suffix="L" value={form.values.tankCapacityL} onChange={(value) => form.setValue('tankCapacityL', value)} error={errors.tankCapacityL} />
              <TextField label="Pneus" placeholder="215/60 R17" value={form.values.tyreSize} onChange={(event) => form.setValue('tyreSize', event.target.value)} error={errors.tyreSize} />
              <TextField label="Jantes" value={form.values.wheelSize} onChange={(event) => form.setValue('wheelSize', event.target.value)} error={errors.wheelSize} />
            </div>
          </div>
        </Card>

        <Card>
          <div className="z-card__header">
            <div className="z-card__title">Aquisição</div>
            <div className="z-card__subtitle">Usado nas estatísticas avançadas (TCO e depreciação)</div>
          </div>
          <div className="z-grid z-grid--2">
            <MoneyField label="Preço de compra" value={form.values.purchasePrice} onChange={(value) => form.setValue('purchasePrice', value)} error={errors.purchasePriceCents} />
            <NumberField label="Km na compra" suffix="km" value={form.values.purchaseOdometerKm} onChange={(value) => form.setValue('purchaseOdometerKm', value)} error={errors.purchaseOdometerKm} />
            <DateField label="Data da compra" value={form.values.purchaseDate} onChange={(event) => form.setValue('purchaseDate', event.target.value)} error={errors.purchaseDate} />
            <DateField label="Matrícula (1.º registo)" value={form.values.firstRegistrationDate} onChange={(event) => form.setValue('firstRegistrationDate', event.target.value)} error={errors.firstRegistrationDate} />
          </div>
          <p className="z-xs z-muted" style={{ marginTop: 'var(--z-space-3)' }}>
            Sem o preço de compra, o Zemlo não estima a depreciação — mostra os custos reais e diz
            que falta este dado, em vez de inventar um valor residual.
          </p>
        </Card>

        <Card>
          <TextAreaField label="Notas" value={form.values.notes} onChange={(event) => form.setValue('notes', event.target.value)} hint="O que quiseres guardar sobre este veículo." />
        </Card>

        {update.error ? (
          <InlineError
            message={errorMessage(update.error)}
            requestId={errorRequestId(update.error)}
          />
        ) : null}

        <div className="z-row z-row--between z-row--wrap" style={{ gap: 'var(--z-space-3)' }}>
          <div className="z-row" style={{ gap: 'var(--z-space-2)' }}>
            <button type="button" className="z-btn z-btn--secondary z-btn--sm" onClick={() => quickLog.open('odometer')}>
              📍 Registar quilometragem
            </button>
            <button
              type="button"
              className="z-btn z-btn--ghost z-btn--sm"
              onClick={() => void update.mutateAsync({ archived: !vehicle.archived } as never)}
            >
              {vehicle.archived ? 'Desarquivar' : 'Arquivar veículo'}
            </button>
          </div>
          <div className="z-row" style={{ gap: 'var(--z-space-3)' }}>
            <Button type="submit" variant="primary" loading={update.isPending}>
              Guardar alterações
            </Button>
          </div>
        </div>

        {saved ? (
          <p className="z-small" role="status" style={{ color: 'var(--z-ok)' }}>
            Ficha guardada.
          </p>
        ) : null}
      </form>

      <DangerZone vehicle={vehicle} onDeleted={() => navigate('/vehicles', { replace: true })} />
    </div>
  );
}

/** Zona de risco: arquivar (reversível) ou eliminar (definitivo), com as consequências escritas. */
function DangerZone({ vehicle, onDeleted }: { vehicle: VehicleDetail; onDeleted: () => void }) {
  const remove = useDeleteVehicle();
  const archive = useUpdateVehicle(vehicle.id);
  const [confirming, setConfirming] = useState(false);

  return (
    <Card soft>
      <div className="z-card__header">
        <div>
          <div className="z-card__title">Eliminar ou arquivar</div>
          <div className="z-card__subtitle">
            Arquivar mantém tudo e tira o veículo da vista. Eliminar apaga {formatNumber(vehicle.counts.expenses, 0)} despesas,
            {' '}
            {formatNumber(vehicle.counts.documents, 0)} documentos e todo o histórico — sem forma de recuperar.
          </div>
        </div>
      </div>
      {confirming ? (
        <div className="z-stack">
          <p className="z-small">
            Tens a certeza? Se o objetivo é apenas deixar de ver este veículo no dia a dia,
            arquiva — é reversível e o histórico mantém-se consultável.
          </p>
          <div className="z-row" style={{ gap: 'var(--z-space-2)' }}>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                void remove.mutateAsync(vehicle.id).then(onDeleted);
              }}
            >
              Sim, eliminar definitivamente
            </Button>
          </div>
        </div>
      ) : (
        <div className="z-row z-row--wrap" style={{ gap: 'var(--z-space-2)' }}>
          <Button
            variant="secondary"
            loading={archive.isPending}
            onClick={() => void archive.mutateAsync({ archived: !vehicle.archived } as never)}
          >
            {vehicle.archived ? 'Desarquivar' : 'Arquivar'}
          </Button>
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Eliminar veículo
          </Button>
        </div>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Estatísticas deste veículo                                                  */
/* -------------------------------------------------------------------------- */

function StatsTab({ vehicleId }: { vehicleId: string }) {
  const [year, setYear] = useState(() => Number(today().slice(0, 4)));
  const stats = useStats({ vehicleId, year, months: 12 });

  if (stats.isLoading) return <LoadingBlock label="A calcular estatísticas…" />;
  if (stats.isError) {
    return (
      <InlineError
        message={errorMessage(stats.error)}
        requestId={errorRequestId(stats.error)}
        onRetry={() => void stats.refetch()}
      />
    );
  }
  /*
   * Estado final do separador: sem carregamento e sem erro, mas sem dados. Não é alcançável
   * pelo caminho normal, e é exatamente por isso que não pode devolver `null` — um buraco
   * branco é indistinguível de um defeito para quem está a olhar para o ecrã.
   */
  if (!stats.data) {
    return (
      <div role="tabpanel" id="panel-stats" aria-labelledby="tab-stats">
        <Card>
          <p className="z-small z-muted">
            Não há estatísticas para mostrar neste momento. Podes tentar novamente — os teus
            registos não foram afetados.
          </p>
          <div style={{ marginTop: 'var(--z-space-3)' }}>
            <Button variant="secondary" size="sm" onClick={() => void stats.refetch()}>
              Tentar novamente
            </Button>
          </div>
        </Card>
      </div>
    );
  }
  const data = stats.data;

  return (
    <div className="z-stack z-stack--loose" role="tabpanel" id="panel-stats" aria-labelledby="tab-stats">
      <Card>
        <div className="z-card__header">
          <div>
            <div className="z-card__title">Totais de {data.scope.year}</div>
            <div className="z-card__subtitle">{data.scope.vehicleLabel}</div>
          </div>
          <div className="z-row" style={{ gap: 'var(--z-space-2)' }}>
            <button type="button" className="z-btn z-btn--ghost z-btn--sm" onClick={() => setYear((value) => value - 1)}>
              ‹ {year - 1}
            </button>
            <button type="button" className="z-btn z-btn--secondary z-btn--sm" onClick={() => setYear(Number(today().slice(0, 4)))}>
              {year}
            </button>
            <button type="button" className="z-btn z-btn--ghost z-btn--sm" onClick={() => setYear((value) => value + 1)}>
              {year + 1} ›
            </button>
          </div>
        </div>
        <div className="z-grid z-grid--4">
          <Metric label="Total" value={money(data.totals.totalCents)} hint={`${formatNumber(data.totals.count, 0)} registos`} small />
          <Metric label="Energia" value={money(data.totals.energyCents)} small />
          <Metric label="Manutenção" value={money(data.totals.maintenanceCents)} small />
          <Metric label="Custos fixos" value={money(data.totals.fixedCents)} small />
        </div>
      </Card>

      <Card>
        <div className="z-card__header">
          <div className="z-card__title">Custos por unidade</div>
        </div>
        <div className="z-grid z-grid--4">
          <Metric label="Por km" value={data.unitCosts.costPerKmCents === null ? '—' : money(data.unitCosts.costPerKmCents)} small />
          <Metric label="Por mês" value={data.unitCosts.costPerMonthCents === null ? '—' : money(data.unitCosts.costPerMonthCents)} small />
          <Metric label="Por dia" value={data.unitCosts.costPerDayCents === null ? '—' : money(data.unitCosts.costPerDayCents)} small />
          <Metric label="Km/ano estimados" value={data.distance.kmPerYear === null ? '—' : km(data.distance.kmPerYear)} small />
        </div>
      </Card>

      {data.monthly.length > 0 ? (
        <Card>
          <div className="z-card__header">
            <div className="z-card__title">Evolução mensal</div>
            <div className="z-card__subtitle">Barra cheia: todos os custos · âmbar: energia</div>
          </div>
          <MonthlyBars data={data.monthly} ariaLabel={`Custos mensais em ${data.scope.year}`} />
        </Card>
      ) : null}

      <Card>
        <div className="z-card__header">
          <div className="z-card__title">Por categoria</div>
        </div>
        <CategoryBreakdown categories={data.byCategory} />
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Histórico deste veículo                                                     */
/* -------------------------------------------------------------------------- */

function TimelineTab({ vehicleId }: { vehicleId: string }) {
  const timeline = useTimeline({ vehicleId, limit: 30 });
  const groups = useMemo(() => groupByMonth(timeline.items), [timeline.items]);

  if (timeline.isLoading) return <LoadingBlock label="A carregar o histórico…" />;
  if (timeline.isError) {
    return (
      <InlineError
        message={errorMessage(timeline.error)}
        requestId={errorRequestId(timeline.error)}
        onRetry={() => void timeline.refetch()}
      />
    );
  }
  if (timeline.items.length === 0) {
    return (
      <RecordsEmptyState
        icon="🕒"
        title="Ainda sem histórico"
        body="O histórico junta tudo o que acontece a este veículo: registos, manutenções, documentos e lembretes, por ordem."
      />
    );
  }

  return (
    <div className="z-stack" role="tabpanel" id="panel-timeline" aria-labelledby="tab-timeline">
      <Card flush>
        {groups.map((group) => (
          <div className="z-timeline__group" key={group.month}>
            <div className="z-timeline__month">{group.label}</div>
            {group.items.map((item) => (
              <TimelineRow key={item.id} item={item} />
            ))}
          </div>
        ))}
      </Card>
      {timeline.hasNextPage ? (
        <Button
          variant="secondary"
          block
          loading={timeline.isFetchingNextPage}
          onClick={() => void timeline.fetchNextPage()}
        >
          Carregar mais
        </Button>
      ) : null}
      <p className="z-xs z-muted">
        <Link to={`/timeline?vehicleId=${vehicleId}`}>Ver histórico completo →</Link>
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Seguro (§18)                                                                */
/* -------------------------------------------------------------------------- */

function InsuranceTab({ vehicleId }: { vehicleId: string }) {
  const policies = useInsurance(vehicleId);
  const create = useCreateInsurance();
  const form = useFormState({ insurer: '', policyNumber: '', startDate: today(), endDate: addMonths(today(), 12), premium: '', coverage: 'comprehensive', deductible: '', phone: '', notes: '' });
  const [showForm, setShowForm] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    const payload: Record<string, unknown> = {
      vehicleId,
      insurer: form.values.insurer,
      startDate: form.values.startDate,
      endDate: form.values.endDate,
    };
    const premium = amountOrUndefined(form.values.premium);
    if (premium !== undefined) payload.premiumCents = premium;
    const deductible = amountOrUndefined(form.values.deductible);
    if (deductible !== undefined) payload.deductibleCents = deductible;
    const policyNumber = textOrUndefined(form.values.policyNumber);
    if (policyNumber) payload.policyNumber = policyNumber;
    const phone = textOrUndefined(form.values.phone);
    if (phone) payload.contactPhone = phone;
    const notes = textOrUndefined(form.values.notes);
    if (notes) payload.notes = notes;
    if (form.values.coverage) payload.coverage = form.values.coverage;

    try {
      await create.mutateAsync(payload);
      setShowForm(false);
    } catch (error) {
      if (error instanceof ApiError) {
        const map: Record<string, string> = {};
        for (const field of error.fields) map[field.path] = field.message;
        setErrors(map);
      }
    }
  }

  /*
   * Os três estados do separador, **dentro** do painel.
   *
   * A envolvente com `role="tabpanel"` não é decorativa: o `aria-controls` do separador
   * aponta para este `id`, e devolver um `LoadingBlock` solto deixaria o atributo a apontar
   * para um elemento que não existe enquanto o pedido está em curso. Sem estado de erro, o
   * separador ficava **vazio** quando o pedido falhava — sem mensagem e sem forma de repetir,
   * que é o pior resultado possível numa interface assíncrona.
   */
  if (policies.isLoading) {
    return (
      <div role="tabpanel" id="panel-insurance" aria-labelledby="tab-insurance">
        <LoadingBlock label="A carregar o seguro…" />
      </div>
    );
  }

  if (policies.isError) {
    return (
      <div role="tabpanel" id="panel-insurance" aria-labelledby="tab-insurance">
        <InlineError
          message={errorMessage(policies.error)}
          requestId={errorRequestId(policies.error)}
          onRetry={() => void policies.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="z-stack" role="tabpanel" id="panel-insurance" aria-labelledby="tab-insurance">
      {policies.data && policies.data.items.length === 0 && !showForm ? (
        <RecordsEmptyState
          icon="🛡️"
          title="Sem apólice registada"
          body="Com a apólice guardada, o Zemlo avisa-te antes de a renovação chegar — e passa a saber que aquele custo é fixo e não variável."
          onAdd={() => setShowForm(true)}
          addLabel="Registar seguro"
        />
      ) : null}

      {policies.data?.items.map((policy) => (
        <Card key={policy.id} soft={!policy.active}>
          <div className="z-card__header">
            <div>
              <div className="z-card__title">{policy.insurer}</div>
              <div className="z-card__subtitle">
                {dateLong(policy.startDate)} — {dateLong(policy.endDate)}
              </div>
            </div>
            <Chip tone={policy.daysRemaining < 0 ? 'danger' : policy.daysRemaining <= 30 ? 'warn' : 'ok'}>
              {policy.daysRemaining < 0 ? `expirou ${relativeDate(policy.endDate)}` : `${relativeDate(policy.endDate)}`}
            </Chip>
          </div>
          <DetailList>
            <DetailRow label="Apólice" value={policy.policyNumber ?? '—'} />
            <DetailRow label="Prémio" value={policy.premiumCents === null ? '—' : money(policy.premiumCents)} />
            <DetailRow label="Franquia" value={policy.deductibleCents === null ? '—' : money(policy.deductibleCents)} />
            <DetailRow label="Cobertura" value={optionLabel(COVERAGE_OPTIONS, policy.coverage ?? '')} />
            <DetailRow label="Contacto" value={policy.contactPhone ?? '—'} />
          </DetailList>
          {policy.notes ? <p className="z-small z-muted" style={{ marginTop: 'var(--z-space-2)' }}>{policy.notes}</p> : null}
        </Card>
      ))}

      {showForm ? (
        <Card>
          <div className="z-card__header">
            <div className="z-card__title">Registar apólice</div>
            <div className="z-card__subtitle">A API cria automaticamente o alerta de renovação.</div>
          </div>
          <form className="z-stack" onSubmit={onSubmit} noValidate>
            <TextField label="Seguradora" required value={form.values.insurer} onChange={(event) => form.setValue('insurer', event.target.value)} error={errors.insurer} />
            <div className="z-grid z-grid--2">
              <DateField label="Início" required value={form.values.startDate} onChange={(event) => form.setValue('startDate', event.target.value)} error={errors.startDate} />
              <DateField label="Fim" required value={form.values.endDate} onChange={(event) => form.setValue('endDate', event.target.value)} error={errors.endDate} />
            </div>
            <div className="z-grid z-grid--2">
              <MoneyField label="Prémio" value={form.values.premium} onChange={(value) => form.setValue('premium', value)} error={errors.premiumCents} />
              <MoneyField label="Franquia" value={form.values.deductible} onChange={(value) => form.setValue('deductible', value)} error={errors.deductibleCents} />
            </div>
            <div className="z-grid z-grid--2">
              <SelectField
                label="Cobertura"
                placeholder="Não indicada"
                value={form.values.coverage}
                onChange={(event) => form.setValue('coverage', event.target.value)}
                options={COVERAGE_OPTIONS.map((coverage) => ({ value: coverage.code, label: coverage.label }))}
                error={errors.coverage}
              />
              <TextField label="N.º de apólice" value={form.values.policyNumber} onChange={(event) => form.setValue('policyNumber', event.target.value)} error={errors.policyNumber} />
            </div>
            <TextField label="Telefone de assistência" value={form.values.phone} onChange={(event) => form.setValue('phone', event.target.value)} error={errors.contactPhone} />
            <TextAreaField label="Notas" value={form.values.notes} onChange={(event) => form.setValue('notes', event.target.value)} />
            {create.error ? <InlineError message={errorMessage(create.error)} requestId={errorRequestId(create.error)} /> : null}
            <div className="z-row z-row--end" style={{ gap: 'var(--z-space-3)' }}>
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button type="submit" variant="primary" loading={create.isPending}>Guardar apólice</Button>
            </div>
          </form>
        </Card>
      ) : policies.data && policies.data.items.length > 0 ? (
        <div>
          <Button variant="secondary" onClick={() => setShowForm(true)}>＋ Nova apólice</Button>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Inspeções (§19)                                                             */
/* -------------------------------------------------------------------------- */

function InspectionsTab({ vehicleId }: { vehicleId: string }) {
  const inspections = useInspections(vehicleId);
  const create = useCreateInspection();
  const form = useFormState({ date: today(), result: 'passed', odometerKm: '', amount: '', nextDueDate: addMonths(today(), 12), station: '', defects: '', notes: '' });
  const [showForm, setShowForm] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    const payload: Record<string, unknown> = { vehicleId, date: form.values.date, result: form.values.result };
    const odometer = integerOrUndefined(form.values.odometerKm);
    if (odometer !== undefined) payload.odometerKm = odometer;
    const amount = amountOrUndefined(form.values.amount);
    if (amount !== undefined) payload.amountCents = amount;
    const next = textOrUndefined(form.values.nextDueDate);
    if (next) payload.nextDueDate = next;
    const station = textOrUndefined(form.values.station);
    if (station) payload.station = station;
    const defects = textOrUndefined(form.values.defects);
    if (defects) payload.defects = defects;
    const notes = textOrUndefined(form.values.notes);
    if (notes) payload.notes = notes;

    try {
      await create.mutateAsync(payload);
      setShowForm(false);
    } catch (error) {
      if (error instanceof ApiError) {
        const map: Record<string, string> = {};
        for (const field of error.fields) map[field.path] = field.message;
        setErrors(map);
      }
    }
  }

  if (inspections.isLoading) {
    return (
      <div role="tabpanel" id="panel-inspections" aria-labelledby="tab-inspections">
        <LoadingBlock label="A carregar as inspeções…" />
      </div>
    );
  }

  if (inspections.isError) {
    return (
      <div role="tabpanel" id="panel-inspections" aria-labelledby="tab-inspections">
        <InlineError
          message={errorMessage(inspections.error)}
          requestId={errorRequestId(inspections.error)}
          onRetry={() => void inspections.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="z-stack" role="tabpanel" id="panel-inspections" aria-labelledby="tab-inspections">
      {inspections.data && inspections.data.items.length === 0 && !showForm ? (
        <RecordsEmptyState
          icon="✅"
          title="Sem inspeções registadas"
          body="A inspeção periódica tem data marcada. Registando-a, o Zemlo avisa-te antes do prazo e mantém o certificado junto ao histórico."
          onAdd={() => setShowForm(true)}
          addLabel="Registar inspeção"
        />
      ) : null}

      {inspections.data?.items.map((inspection) => (
        <Card key={inspection.id}>
          <div className="z-card__header">
            <div>
              <div className="z-card__title">{dateLong(inspection.date)}</div>
              <div className="z-card__subtitle">{inspection.station ?? 'Centro de inspeção não indicado'}</div>
            </div>
            <Chip tone={inspection.result === 'passed' ? 'ok' : inspection.result === 'failed' ? 'danger' : 'warn'}>
              {inspection.result === 'passed'
                ? 'Aprovada'
                : inspection.result === 'passed_with_defects'
                  ? 'Aprovada com deficiências'
                  : inspection.result === 'failed'
                    ? 'Reprovada'
                    : 'Pendente'}
            </Chip>
          </div>
          <DetailList>
            <DetailRow label="Quilometragem" value={inspection.odometerKm === null ? '—' : km(inspection.odometerKm)} />
            <DetailRow label="Custo" value={inspection.amountCents === null ? '—' : money(inspection.amountCents)} />
            <DetailRow label="Próxima" value={inspection.nextDueDate ? `${dateLong(inspection.nextDueDate)} · ${relativeDate(inspection.nextDueDate)}` : '—'} />
          </DetailList>
          {inspection.defects ? (
            <p className="z-small" style={{ marginTop: 'var(--z-space-2)' }}>
              <strong>Deficiências:</strong> {inspection.defects}
            </p>
          ) : null}
        </Card>
      ))}

      {showForm ? (
        <Card>
          <div className="z-card__header">
            <div className="z-card__title">Registar inspeção</div>
            <div className="z-card__subtitle">Sem data da próxima, o Zemlo assume um ano — é o prazo legal para veículos particulares.</div>
          </div>
          <form className="z-stack" onSubmit={onSubmit} noValidate>
            <div className="z-grid z-grid--2">
              <DateField label="Data" required value={form.values.date} onChange={(event) => form.setValue('date', event.target.value)} error={errors.date} />
              <SelectField
                label="Resultado"
                value={form.values.result}
                onChange={(event) => form.setValue('result', event.target.value)}
                options={[
                  { value: 'passed', label: 'Aprovada' },
                  { value: 'passed_with_defects', label: 'Aprovada com deficiências' },
                  { value: 'failed', label: 'Reprovada' },
                  { value: 'pending', label: 'Pendente' },
                ]}
                error={errors.result}
              />
            </div>
            <div className="z-grid z-grid--2">
              <NumberField label="Quilometragem" suffix="km" value={form.values.odometerKm} onChange={(value) => form.setValue('odometerKm', value)} error={errors.odometerKm} />
              <MoneyField label="Custo" value={form.values.amount} onChange={(value) => form.setValue('amount', value)} error={errors.amountCents} />
            </div>
            <div className="z-grid z-grid--2">
              <DateField label="Próxima inspeção" value={form.values.nextDueDate} onChange={(event) => form.setValue('nextDueDate', event.target.value)} error={errors.nextDueDate} />
              <TextField label="Centro" value={form.values.station} onChange={(event) => form.setValue('station', event.target.value)} error={errors.station} />
            </div>
            <TextAreaField label="Deficiências" value={form.values.defects} onChange={(event) => form.setValue('defects', event.target.value)} />
            <TextAreaField label="Notas" value={form.values.notes} onChange={(event) => form.setValue('notes', event.target.value)} />
            {create.error ? <InlineError message={errorMessage(create.error)} requestId={errorRequestId(create.error)} /> : null}
            <div className="z-row z-row--end" style={{ gap: 'var(--z-space-3)' }}>
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button type="submit" variant="primary" loading={create.isPending}>Guardar inspeção</Button>
            </div>
          </form>
        </Card>
      ) : inspections.data && inspections.data.items.length > 0 ? (
        <div>
          <Button variant="secondary" onClick={() => setShowForm(true)}>＋ Nova inspeção</Button>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Impostos (§20)                                                              */
/* -------------------------------------------------------------------------- */

function TaxesTab({ vehicleId }: { vehicleId: string }) {
  const taxes = useTaxes(vehicleId);
  const create = useCreateTax();
  const profile = useProfile();
  const year = Number(today().slice(0, 4));
  const form = useFormState({ kind: 'iuc', year: String(year), amount: '', date: today(), paid: 'true', dueDate: '', notes: '' });
  const [showForm, setShowForm] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    const payload: Record<string, unknown> = {
      vehicleId,
      kind: form.values.kind,
      year: integerOrUndefined(form.values.year),
      amountCents: amountOrUndefined(form.values.amount),
      paid: form.values.paid === 'true',
      date: form.values.date,
    };
    const due = textOrUndefined(form.values.dueDate);
    if (due) payload.dueDate = due;
    const notes = textOrUndefined(form.values.notes);
    if (notes) payload.notes = notes;

    try {
      await create.mutateAsync(payload);
      setShowForm(false);
    } catch (error) {
      if (error instanceof ApiError) {
        const map: Record<string, string> = {};
        for (const field of error.fields) map[field.path] = field.message;
        setErrors(map);
      }
    }
  }

  void profile;

  if (taxes.isLoading) {
    return (
      <div role="tabpanel" id="panel-taxes" aria-labelledby="tab-taxes">
        <LoadingBlock label="A carregar os impostos…" />
      </div>
    );
  }

  if (taxes.isError) {
    return (
      <div role="tabpanel" id="panel-taxes" aria-labelledby="tab-taxes">
        <InlineError
          message={errorMessage(taxes.error)}
          requestId={errorRequestId(taxes.error)}
          onRetry={() => void taxes.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="z-stack" role="tabpanel" id="panel-taxes" aria-labelledby="tab-taxes">
      {taxes.data && taxes.data.items.length === 0 && !showForm ? (
        <RecordsEmptyState
          icon="🏛️"
          title="Sem impostos registados"
          body="O IUC é anual e tem prazo. Registando-o, o Zemlo cria o lembrete e inclui-o no custo real do veículo — que é onde ele conta."
          onAdd={() => setShowForm(true)}
          addLabel="Registar imposto"
        />
      ) : null}

      {taxes.data?.items.map((raw) => {
        const tax = raw as {
          id: string;
          kind: string;
          year: number;
          amountCents: number;
          date: string | null;
          dueDate: string | null;
          paid: boolean;
          notes: string | null;
        };
        return (
          <Card key={tax.id}>
            <div className="z-card__header">
              <div>
                <div className="z-card__title">
                  {tax.kind === 'iuc' ? `IUC ${tax.year}` : tax.kind === 'isv' ? `ISV ${tax.year}` : `Imposto ${tax.year}`}
                </div>
                <div className="z-card__subtitle">{tax.date ? dateLong(tax.date) : 'sem data de pagamento'}</div>
              </div>
              <Chip tone={tax.paid ? 'ok' : 'warn'}>{tax.paid ? 'Pago' : 'Por pagar'}</Chip>
            </div>
            <DetailList>
              <DetailRow label="Valor" value={money(tax.amountCents)} />
              <DetailRow label="Prazo" value={tax.dueDate ? `${dateLong(tax.dueDate)} · ${relativeDate(tax.dueDate)}` : '—'} />
            </DetailList>
            {tax.notes ? <p className="z-small z-muted" style={{ marginTop: 'var(--z-space-2)' }}>{tax.notes}</p> : null}
          </Card>
        );
      })}

      {showForm ? (
        <Card>
          <div className="z-card__header">
            <div className="z-card__title">Registar imposto</div>
          </div>
          <form className="z-stack" onSubmit={onSubmit} noValidate>
            <div className="z-grid z-grid--2">
              <SelectField
                label="Tipo"
                value={form.values.kind}
                onChange={(event) => form.setValue('kind', event.target.value)}
                options={[
                  { value: 'iuc', label: 'IUC — Imposto Único de Circulação' },
                  { value: 'isv', label: 'ISV — Imposto sobre Veículos' },
                  { value: 'toll_device', label: 'Identificador de portagens' },
                  { value: 'other', label: 'Outro' },
                ]}
              />
              <NumberField label="Ano" required value={form.values.year} onChange={(value) => form.setValue('year', value)} error={errors.year} />
            </div>
            <div className="z-grid z-grid--2">
              <MoneyField label="Valor" required value={form.values.amount} onChange={(value) => form.setValue('amount', value)} error={errors.amountCents} />
              <DateField label="Data de pagamento" value={form.values.date} onChange={(event) => form.setValue('date', event.target.value)} error={errors.date} />
            </div>
            <div className="z-grid z-grid--2">
              <DateField label="Prazo" value={form.values.dueDate} onChange={(event) => form.setValue('dueDate', event.target.value)} error={errors.dueDate} />
              <SelectField
                label="Estado"
                value={form.values.paid}
                onChange={(event) => form.setValue('paid', event.target.value)}
                options={[
                  { value: 'true', label: 'Pago' },
                  { value: 'false', label: 'Por pagar' },
                ]}
              />
            </div>
            <TextAreaField label="Notas" value={form.values.notes} onChange={(event) => form.setValue('notes', event.target.value)} />
            {create.error ? <InlineError message={errorMessage(create.error)} requestId={errorRequestId(create.error)} /> : null}
            <div className="z-row z-row--end" style={{ gap: 'var(--z-space-3)' }}>
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button type="submit" variant="primary" loading={create.isPending}>Guardar imposto</Button>
            </div>
          </form>
        </Card>
      ) : taxes.data && taxes.data.items.length > 0 ? (
        <div>
          <Button variant="secondary" onClick={() => setShowForm(true)}>＋ Novo imposto</Button>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Documentos (§17)                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Documentos deste veículo.
 *
 * A API serve os bytes de um documento (`GET /documents/:id/content`, §A17.1), mas esta
 * ficha mostra a lista e delega a ação na página de detalhe: é lá que se transfere, se
 * edita e se elimina. Aqui interessa o que se lê de relance — o nome do ficheiro e a
 * validade.
 */
function DocumentsTab({ vehicleId }: { vehicleId: string }) {
  const documents = useDocuments(vehicleId);

  if (documents.isLoading) return <LoadingBlock label="A carregar documentos…" />;
  if (documents.isError) {
    return (
      <InlineError
        message={errorMessage(documents.error)}
        requestId={errorRequestId(documents.error)}
        onRetry={() => void documents.refetch()}
      />
    );
  }

  if (!documents.data || documents.data.items.length === 0) {
    return (
      <RecordsEmptyState
        icon="📄"
        title="Sem documentos guardados"
        body="Guarda aqui o Documento Único Automóvel, a apólice e o certificado de inspeção. O Zemlo avisa-te quando algum estiver a expirar."
      />
    );
  }

  return (
    <div className="z-stack" role="tabpanel" id="panel-documents" aria-labelledby="tab-documents">
      <Card flush>
        <div className="z-list">
          {documents.data.items.map((document) => (
            <div className="z-list__item" key={document.id}>
              <span className="z-list__icon" aria-hidden="true">
                📄
              </span>
              <span className="z-list__body">
                <span className="z-list__title">{document.name}</span>
                <span className="z-list__meta">
                  {document.fileName ?? 'sem ficheiro associado'}
                  {document.date ? ` · ${dateLong(document.date)}` : ''}
                </span>
              </span>
              <span className="z-list__trailing">
                {document.expiresAt ? (
                  <Chip tone={(document.daysToExpiry ?? 0) < 0 ? 'danger' : (document.daysToExpiry ?? 0) <= 60 ? 'warn' : 'ok'}>
                    {relativeDate(document.expiresAt)}
                  </Chip>
                ) : (
                  '—'
                )}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <p className="xs z-muted z-xs">
        O Zemlo guarda os metadados e a validade de cada documento. O ficheiro em si vive no
        armazenamento de objetos — esta versão da API não serve bytes, pelo que a aplicação
        mostra a referência e não um botão de descarregamento.{' '}
        <Link to="/documents">Ver todos os documentos →</Link>
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Lembretes (§16)                                                             */
/* -------------------------------------------------------------------------- */

function RemindersTab({ vehicleId }: { vehicleId: string }) {
  const reminders = useReminders({ vehicleId, includeCompleted: false });
  const complete = useCompleteReminder();
  const snooze = useSnoozeReminder();
  const remove = useDeleteReminder();
  const odometer = useOdometerReadings(vehicleId);
  const profile = useProfile();
  const form = useFormState({
    title: '',
    trigger: 'both',
    dueDate: addMonths(today(), 6),
    dueOdometerKm: '',
    intervalKm: '',
    intervalMonths: '',
    repeat: 'true',
    notes: '',
  });
  const [showForm, setShowForm] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const create = useCreateReminder();
  const latestOdometer = odometer.data?.items[0]?.odometerKm ?? null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    const payload: Record<string, unknown> = {
      vehicleId,
      title: form.values.title,
      trigger: form.values.trigger,
      repeat: form.values.repeat === 'true',
    };
    const dueDate = textOrUndefined(form.values.dueDate);
    if (dueDate && (form.values.trigger === 'time' || form.values.trigger === 'both')) payload.dueDate = dueDate;
    const dueOdometerKm = integerOrUndefined(form.values.dueOdometerKm);
    if (dueOdometerKm !== undefined && (form.values.trigger === 'distance' || form.values.trigger === 'both')) {
      payload.dueOdometerKm = dueOdometerKm;
    }
    const intervalKm = integerOrUndefined(form.values.intervalKm);
    if (intervalKm !== undefined) payload.intervalKm = intervalKm;
    const intervalMonths = integerOrUndefined(form.values.intervalMonths);
    if (intervalMonths !== undefined) payload.intervalMonths = intervalMonths;
    const notes = textOrUndefined(form.values.notes);
    if (notes) payload.notes = notes;

    try {
      await create.mutateAsync(payload);
      setShowForm(false);
    } catch (error) {
      if (error instanceof ApiError) {
        const map: Record<string, string> = {};
        for (const field of error.fields) map[field.path] = field.message;
        setErrors(map);
      }
    }
  }

  if (reminders.isLoading) {
    return (
      <div role="tabpanel" id="panel-reminders" aria-labelledby="tab-reminders">
        <LoadingBlock label="A avaliar lembretes…" />
      </div>
    );
  }

  if (reminders.isError) {
    return (
      <div role="tabpanel" id="panel-reminders" aria-labelledby="tab-reminders">
        <InlineError
          message={errorMessage(reminders.error)}
          requestId={errorRequestId(reminders.error)}
          onRetry={() => void reminders.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="z-stack" role="tabpanel" id="panel-reminders" aria-labelledby="tab-reminders">
      {reminders.data ? (
        <div className="z-row z-row--wrap" style={{ gap: 'var(--z-space-2)' }}>
          {/* A API devolve apenas os estados com pelo menos um lembrete, pelo que a ausência de
              uma contagem significa zero — mas o tipo obriga a dizê-lo explicitamente. */}
          <Chip tone="danger">{formatNumber(reminders.data.counts.overdue ?? 0, 0)} em atraso</Chip>
          <Chip tone="warn">{formatNumber(reminders.data.counts.due ?? 0, 0)} a vencer</Chip>
          <Chip tone="warn">{formatNumber(reminders.data.counts.soon ?? 0, 0)} em breve</Chip>
          <Chip tone="ok">{formatNumber(reminders.data.counts.ok ?? 0, 0)} em dia</Chip>
          {(reminders.data.counts.unknown ?? 0) > 0 ? (
            <Chip>{formatNumber(reminders.data.counts.unknown ?? 0, 0)} sem dados</Chip>
          ) : null}
        </div>
      ) : null}

      {reminders.data && reminders.data.items.length === 0 && !showForm ? (
        <RecordsEmptyState
          icon="🔔"
          title="Sem lembretes ativos"
          body="Os lembretes são o que faz o Zemlo avisar-te em vez de esperar que te lembres. Uma revisão a cada 10 000 km ou um ano é o exemplo mais comum."
          onAdd={() => setShowForm(true)}
          addLabel="Criar lembrete"
        />
      ) : null}

      {reminders.data?.items.map((reminder) => (
        <Card key={reminder.id} className="z-state-card" soft>
          <div className="z-card__header">
            <div>
              <div className="z-card__title">{reminder.title}</div>
              <div className="z-card__subtitle">
                {optionLabel(REMINDER_TRIGGERS, reminder.trigger)}
                {reminder.repeat ? ' · repete' : ''}
              </div>
            </div>
            <Chip
              tone={
                reminder.evaluation.state === 'overdue'
                  ? 'danger'
                  : reminder.evaluation.state === 'ok'
                    ? 'ok'
                    : 'warn'
              }
            >
              {reminder.evaluation.summary}
            </Chip>
          </div>

          <DetailList>
            {reminder.dueDate ? <DetailRow label="Data limite" value={`${dateLong(reminder.dueDate)} · ${relativeDate(reminder.dueDate)}`} /> : null}
            {reminder.dueOdometerKm !== null ? <DetailRow label="Quilometragem" value={km(reminder.dueOdometerKm)} /> : null}
            {reminder.evaluation.projectedDate ? (
              <DetailRow label="Previsão" value={`${dateLong(reminder.evaluation.projectedDate)} (estimativa pelo teu ritmo)`} />
            ) : null}
            {reminder.intervalKm !== null ? <DetailRow label="Repete a cada" value={km(reminder.intervalKm)} /> : null}
            {reminder.intervalMonths !== null ? <DetailRow label="Repete a cada" value={`${reminder.intervalMonths} meses`} /> : null}
          </DetailList>

          {reminder.notes ? <p className="z-small z-muted" style={{ marginTop: 'var(--z-space-2)' }}>{reminder.notes}</p> : null}

          <div className="z-row z-row--wrap" style={{ gap: 'var(--z-space-2)', marginTop: 'var(--z-space-3)' }}>
            <Button
              variant="primary"
              size="sm"
              loading={complete.isPending}
              onClick={() =>
                void complete.mutateAsync({
                  reminderId: reminder.id,
                  payload: {
                    createNext: true,
                    ...(latestOdometer !== null ? { odometerKm: latestOdometer } : {}),
                    ...(profile.data ? { completedAt: todayIn(profile.data.timeZone) } : {}),
                  },
                })
              }
            >
              Concluir
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={snooze.isPending}
              onClick={() => void snooze.mutateAsync({ reminderId: reminder.id, days: 14 })}
            >
              Adiar 14 dias
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (window.confirm('Eliminar este lembrete? Não afeta os registos já feitos.')) {
                  void remove.mutateAsync(reminder.id);
                }
              }}
            >
              Eliminar
            </Button>
          </div>
        </Card>
      ))}

      {showForm ? (
        <Card>
          <div className="z-card__header">
            <div className="z-card__title">Novo lembrete</div>
            <div className="z-card__subtitle">
              Com «km ou tempo», o aviso chega quando qualquer das condições for atingida — que
              é o comportamento correto para uma revisão.
            </div>
          </div>
          <form className="z-stack" onSubmit={onSubmit} noValidate>
            <TextField
              label="Título"
              required
              placeholder="Revisão dos 50 000 km"
              value={form.values.title}
              onChange={(event) => form.setValue('title', event.target.value)}
              error={errors.title}
            />
            <SelectField
              label="Dispara por"
              value={form.values.trigger}
              onChange={(event) => form.setValue('trigger', event.target.value)}
              options={REMINDER_TRIGGERS.map((trigger) => ({ value: trigger.code, label: trigger.label }))}
              error={errors.trigger}
            />
            <div className="z-grid z-grid--2">
              <DateField
                label="Data limite"
                disabled={form.values.trigger === 'distance'}
                value={form.values.dueDate}
                onChange={(event) => form.setValue('dueDate', event.target.value)}
                error={errors.dueDate}
              />
              <NumberField
                label="Quilometragem limite"
                suffix="km"
                disabled={form.values.trigger === 'time'}
                hint={latestOdometer !== null ? `Última leitura: ${km(latestOdometer)}` : undefined}
                value={form.values.dueOdometerKm}
                onChange={(value) => form.setValue('dueOdometerKm', value)}
                error={errors.dueOdometerKm}
              />
            </div>
            <div className="z-grid z-grid--2">
              <NumberField
                label="Repetir a cada"
                suffix="km"
                value={form.values.intervalKm}
                onChange={(value) => form.setValue('intervalKm', value)}
                error={errors.intervalKm}
              />
              <NumberField
                label="Repetir a cada"
                suffix="meses"
                value={form.values.intervalMonths}
                onChange={(value) => form.setValue('intervalMonths', value)}
                error={errors.intervalMonths}
              />
            </div>
            <CheckboxField
              label="Repetir automaticamente"
              checked={form.values.repeat === 'true'}
              onChange={(checked) => form.setValue('repeat', checked ? 'true' : 'false')}
              hint="Ao concluir, cria a ocorrência seguinte contada a partir da data de conclusão — uma revisão feita oito meses atrasada não nasce já em atraso."
            />
            <TextAreaField label="Notas" value={form.values.notes} onChange={(event) => form.setValue('notes', event.target.value)} />
            {create.error ? <InlineError message={errorMessage(create.error)} requestId={errorRequestId(create.error)} /> : null}
            <div className="z-row z-row--end" style={{ gap: 'var(--z-space-3)' }}>
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button type="submit" variant="primary" loading={create.isPending}>Criar lembrete</Button>
            </div>
          </form>
        </Card>
      ) : reminders.data && reminders.data.items.length > 0 ? (
        <div>
          <Button variant="secondary" onClick={() => setShowForm(true)}>＋ Novo lembrete</Button>
        </div>
      ) : null}
    </div>
  );
}
