import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  formatCents,
  formatNumber,
  supportsCharging,
  supportsRefuelling,
  type DashboardResponse,
  type RecordKind,
  type VehicleSummary,
} from '@zemlo/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCreateCharging,
  useCreateExpense,
  useCreateFuel,
  useCreateMaintenance,
  usePreferences,
  useProfile,
  useRecordOdometer,
} from '../api/hooks';
import { useSelectedVehicle } from '../hooks';
import { queryKeys } from '../api/queryKeys';
import { fieldErrors } from '../api/errors';
import { Sheet } from '../ui/Sheet';
import { Button, Banner } from '../ui/primitives';
import {
  CheckboxField,
  DateField,
  FormError,
  MoneyField,
  NumberField,
  TextAreaField,
  TextField,
  useFormState,
} from '../ui/form';
import { useToast } from '../ui/Toaster';
import { postSaveActions } from '../lib/postSave';
import { rememberLastKind } from '../lib/registerMenu';
import { CategoryPicker, MaintenanceTypePicker } from './formParts';
import { VehicleChoice } from './VehiclePicker';
import { resolveVehicle, vehicleOdometerInput } from '../lib/vehicleChoice';
import {
  amountOrUndefined,
  decimalOrUndefined,
  defaultDate,
  integerOrUndefined,
  textOrUndefined,
} from '../lib/formPayload';
import { km } from '../lib/format';

/**
 * Registo rápido (§43, §44).
 *
 * A regra que dá forma a tudo neste ficheiro: **três campos à vista, o resto atrás de
 * "Adicionar detalhes"**. Quem regista um carregamento ao lado do carro tem o telemóvel
 * numa mão; cada campo a mais é uma razão para não registar — e um Zemlo sem registos não
 * serve para nada.
 *
 * Cada formulário segue a mesma estrutura:
 *
 *  1. **campos essenciais** — o mínimo que a API exige, com valores por omissão já
 *     preenchidos a partir do estado real do veículo (data de hoje, quilometragem atual);
 *  2. **"Adicionar detalhes"** — o resto, incluindo tudo o que é enriquecimento;
 *  3. **guardar** — e a folha fecha, com um aviso que diz o que aconteceu e, quando a API
 *     devolve métricas derivadas (consumo, custo por 100 km), mostra-as de imediato. O aviso
 *     traz as duas ações da §52 — **Ver registo** e **Novo registo** — construídas por
 *     `lib/postSave.ts`.
 *
 * A folha **não navega** ao guardar (§54): fecha-se sobre o ecrã onde o utilizador estava, e a
 * lista por baixo já foi invalidada pelo React Query. Só «Ver registo», uma escolha explícita,
 * muda de ecrã. É por isso que não há um `navigate` solto neste ficheiro — a navegação é uma
 * consequência de escolher uma ação, não do facto de gravar.
 *
 * Um veículo obrigatório: não existe registo sem veículo no Zemlo, e criar um "registo sem
 * veículo" seria inventar um conceito que a API não tem. Quando a conta ainda não tem
 * veículos, a folha explica como resolver — em vez de mostrar campos que falhariam ao
 * gravar (§46).
 */

export interface QuickLogSheetProps {
  kind: RecordKind | null;
  onClose: () => void;
  /**
   * Abre o seletor de novo registo (§53) com o tipo acabado de gravar. Vem por prop, e não de
   * `useQuickLog()`, para não criar um ciclo de importação: o provedor importa esta folha, e a
   * folha importar o provedor fecharia o ciclo.
   */
  onNovoRegisto: (kind: RecordKind) => void;
}

const TITLES: Record<RecordKind, string> = {
  expense: 'Nova despesa',
  fuel: 'Novo abastecimento',
  charging: 'Novo carregamento',
  maintenance: 'Nova manutenção',
  odometer: 'Registar quilometragem',
};

/**
 * Título da folha para um tipo de registo.
 *
 * O contrato partilhado define hoje cinco tipos; se um dia acrescentar um sexto, esta função
 * devolve um título genérico em vez de `undefined` — que apareceria como um cabeçalho vazio
 * numa folha modal, sem qualquer indicação do que o utilizador está a registar.
 */
function titleFor(kind: RecordKind): string {
  return TITLES[kind] ?? 'Registar';
}

/**
 * Despachante.
 *
 * Cada formulário é um componente próprio que desenha a sua folha. A alternativa — uma
 * folha única com o formulário lá dentro — obrigaria o rodapé (com o botão de gravar) a
 * viver dentro da área que faz deslocamento, e o botão deixaria de estar fixo no fundo:
 * invisível enquanto o utilizador preenchesse os detalhes opcionais.
 */
export function QuickLogSheet({ kind, onClose, onNovoRegisto }: QuickLogSheetProps) {
  if (!kind) return null;
  if (kind === 'expense') return <ExpenseForm onClose={onClose} onNovoRegisto={onNovoRegisto} />;
  if (kind === 'fuel') return <FuelForm onClose={onClose} onNovoRegisto={onNovoRegisto} />;
  if (kind === 'charging') return <ChargingForm onClose={onClose} onNovoRegisto={onNovoRegisto} />;
  if (kind === 'maintenance') return <MaintenanceForm onClose={onClose} onNovoRegisto={onNovoRegisto} />;
  return <OdometerForm onClose={onClose} onNovoRegisto={onNovoRegisto} />;
}

/* -------------------------------------------------------------------------- */
/* Contexto partilhado pelos formulários                                       */
/* -------------------------------------------------------------------------- */

interface SmartDefaults {
  /**
   * Identificador do veículo a que o registo pertence.
   *
   * `null` — e não `undefined` — quando a conta ainda não tem veículos, de propósito: os
   * ecrãs testam `if (!defaults.vehicleId)` e um `undefined` escondido numa interface é o
   * género de valor que passa por um `??` sem ninguém reparar. `null` é explícito: "não há".
   */
  vehicleId: string | null;
  /**
   * O veículo resolvido — o mesmo objeto que o cartão da `43` desenha.
   *
   * Passou a existir com a `55`: o formulário precisa do veículo inteiro (glifo, marca, modelo,
   * matrícula, tipo, energia) para desenhar o campo, e não só do identificador e de uma etiqueta
   * de texto. `null` quando a conta não tem veículos — o mesmo caso de `vehicleId`.
   */
  vehicle: VehicleSummary | null;
  /** Todos os veículos da conta, para a folha de escolha (`56`). */
  vehicles: VehicleSummary[];
  odometerKm: number | null;
  odometerInput: string;
  today: string;
  fuelType: string | null;
  canCharge: boolean;
  canRefuel: boolean;
  frequentCategories: string[];
  kmPerMonth: number | null;
  /** Último preço unitário usado, para pré-preencher o valor. `null` quando não há. */
  lastPriceByUnit: { fuel: number | null; charging: number | null };
  rememberPrice: (kind: 'fuel' | 'charging', centsPerUnit: number) => void;
}

/**
 * Sugestões para pré-preencher os campos.
 *
 * Vêm do dashboard **em cache** e não de um pedido novo: se o painel já está carregado, os
 * valores estão disponíveis sem rede; se não estiver, o formulário abre na mesma com o
 * mínimo (data de hoje, quilometragem do veículo). Um registo rápido que espera por uma
 * consulta ao servidor deixa de ser rápido — e é por isso que este hook lê a cache em vez
 * de usar `useQuery`.
 */
function useSmartDefaults(overrideVehicleId: string | null = null): SmartDefaults {
  const queryClient = useQueryClient();
  const { vehicle, vehicles } = useSelectedVehicle();
  const { data: preferences } = usePreferences();
  const { data: profile } = useProfile();

  /*
   * O veículo escolhido no próprio formulário (`55`) tem prioridade sobre o contexto; sem
   * escolha, vale o veículo em foco e, quando a seleção é a conta inteira, o primeiro da lista —
   * que a API ordena por atividade recente.
   *
   * A ordem desta resolução é o que faz a pré-seleção automática: o formulário abre já no
   * veículo em foco (o comportamento que a `55` pede para preservar) e só muda se o utilizador
   * escolher outro. A regra vive em `lib/vehicleChoice.ts` para poder ser provada sem DOM — o
   * projeto não usa `jsdom` —, e aqui fica apenas a ligação ao estado da aplicação.
   */
  const resolved = resolveVehicle(vehicles, overrideVehicleId ?? vehicle?.id ?? null);
  const resolvedId = resolved?.id;
  const dashboard = resolvedId
    ? queryClient.getQueryData<DashboardResponse>(queryKeys.dashboard(resolvedId))
    : undefined;

  /**
   * Último preço unitário praticado pelo utilizador.
   *
   * Guardar isto em `localStorage` é o que permite pré-preencher o campo do valor com um
   * número plausível: quem abastece sempre na mesma bomba poupa três toques. Não é um dado
   * de negócio — é uma conveniência local, pelo que não vai para o servidor nem substitui
   * nada do que a API calcula.
   */
  const rememberPrice = useMemo(
    () => (kind: 'fuel' | 'charging', centsPerUnit: number) => {
      try {
        const raw = globalThis.localStorage?.getItem('zemlo.quickLogDefaults');
        const current = raw ? (JSON.parse(raw) as Record<string, number>) : {};
        current[kind] = centsPerUnit;
        globalThis.localStorage?.setItem('zemlo.quickLogDefaults', JSON.stringify(current));
      } catch {
        /* sem persistência: a sugestão vale para esta sessão */
      }
    },
    [],
  );

  const lastPriceByUnit = useMemo(() => {
    try {
      const raw = globalThis.localStorage?.getItem('zemlo.quickLogDefaults');
      const stored = raw ? (JSON.parse(raw) as { fuel?: number; charging?: number }) : {};
      return { fuel: stored.fuel ?? null, charging: stored.charging ?? null };
    } catch {
      return { fuel: null, charging: null };
    }
  }, []);

  /*
   * A etiqueta de texto do veículo (`vehicleLabel`) foi removida com a `55`: o veículo passou a
   * ser desenhado pelo cartão da `43` no campo do topo, e uma segunda versão do mesmo nome em
   * texto — no subtítulo da folha — diria duas vezes a mesma coisa, com o risco de divergirem.
   */
  return {
    vehicleId: resolvedId ?? null,
    vehicle: resolved,
    vehicles,
    odometerKm: resolved?.odometerKm ?? null,
    odometerInput: resolved?.odometerKm !== null && resolved?.odometerKm !== undefined ? String(resolved.odometerKm) : '',
    today: defaultDate(profile?.timeZone ?? 'Europe/Lisbon'),
    fuelType: resolved?.fuelType ?? null,
    canCharge: supportsCharging(resolved?.fuelType),
    canRefuel: supportsRefuelling(resolved?.fuelType),
    frequentCategories: preferences?.frequentExpenseCategories ?? [],
    kmPerMonth: dashboard?.usage.kmPerMonth ?? null,
    lastPriceByUnit,
    rememberPrice,
  };
}

/** Aviso quando a conta ainda não tem veículos (§5, §46). */
function NoVehicleNotice({ onClose }: { onClose: () => void }) {
  return (
    <Sheet open onClose={onClose} title="Precisamos de um veículo primeiro">
      <Banner tone="info" title="Adiciona o primeiro veículo">
        Toda a informação no Zemlo pertence a um veículo. Só a matrícula é obrigatória — o
        resto completas quando quiseres.
      </Banner>
      <div className="z-row z-row--end">
        <Link to="/onboarding/veiculo" className="z-btn z-btn--primary" onClick={onClose}>
          Adicionar veículo
        </Link>
      </div>
    </Sheet>
  );
}

/**
 * Rodapé da folha de registo rápido.
 *
 * Diferente do rodapé genérico: a ação secundária chama-se **Fechar** e não "Cancelar" —
 * nada foi submetido, e "cancelar" sugere que havia algo a desfazer. O botão de fechar do
 * cabeçalho e a tecla Escape continuam a existir, porque fechar tem de ser sempre trivial
 * (§44: o custo de sair tem de ser zero, ou o utilizador não experimenta).
 */
function QuickFooter({
  onClose,
  submitLabel,
  pending,
}: {
  onClose: () => void;
  submitLabel: string;
  pending: boolean;
}) {
  return (
    <div className="z-sheet__footer">
      <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
        Fechar
      </Button>
      <Button type="submit" variant="primary" loading={pending}>
        {submitLabel}
      </Button>
    </div>
  );
}

/**
 * Nota de rodapé, quando há uma.
 *
 * Já **não** diz onde o registo vai ficar: isso passou a ser o campo do topo (`55`), que o diz
 * com o cartão do veículo e ainda o deixa trocar. Sobrou para as notas que não são sobre o
 * destino — «este veículo não usa combustível líquido» e a explicação do recuo do odómetro.
 * Devolve `null` sem conteúdo, para que os formulários sem nota não deixem um parágrafo vazio
 * a ocupar espaço no fundo da folha.
 */
function DestineRow({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p className="z-xs z-muted">{children}</p>;
}

/* -------------------------------------------------------------------------- */
/* Despesa                                                                     */
/* -------------------------------------------------------------------------- */

function ExpenseForm({ onClose, onNovoRegisto }: { onClose: () => void; onNovoRegisto: (kind: RecordKind) => void }) {
  // Veículo escolhido dentro do formulário (`55`). `null` = ainda não escolheu, vale o contexto.
  const [chosenVehicleId, setChosenVehicleId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const defaults = useSmartDefaults(chosenVehicleId);
  const create = useCreateExpense();
  const toast = useToast();
  const navigate = useNavigate();
  const form = useFormState({
    amount: '',
    category: 'maintenance',
    date: defaults.today,
    vendor: '',
    odometerKm: '',
    description: '',
    notes: '',
  });
  const vehicle = defaults.vehicle;

  if (!vehicle) return <NoVehicleNotice onClose={onClose} />;

  /** Troca o veículo do registo (`55`) e reescreve a quilometragem com a do novo veículo. */
  const onSelectVehicle = (vehicleId: string) => {
    setChosenVehicleId(vehicleId);
    setPickerOpen(false);
    form.setValue('odometerKm', vehicleOdometerInput(resolveVehicle(defaults.vehicles, vehicleId)));
  };

  const errors = fieldErrors(create.error);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const amountCents = amountOrUndefined(form.values.amount);
    const payload: Record<string, unknown> = {
      amountCents,
      category: form.values.category,
      date: form.values.date,
    };
    const vendor = textOrUndefined(form.values.vendor);
    if (vendor) payload.vendor = vendor;
    const odometer = integerOrUndefined(form.values.odometerKm);
    if (odometer !== undefined) payload.odometerKm = odometer;
    const description = textOrUndefined(form.values.description);
    if (description) payload.description = description;
    const notes = textOrUndefined(form.values.notes);
    if (notes) payload.notes = notes;

    try {
        const created = await create.mutateAsync({ payload, vehicleId: defaults.vehicleId ?? undefined });
        rememberLastKind('expense');
      toast.show(`Despesa de ${formatCents(amountCents ?? 0)} registada.`, {
        variant: 'ok',
        actions: postSaveActions('expense', created.id, { navigate, novoRegisto: onNovoRegisto }),
      });
      onClose();
    } catch {
      /* apresentado pelo `<FormError>` */
    }
  }

  return (
    <Sheet open onClose={onClose} title={titleFor('expense')} onSubmit={onSubmit} suspendGlobalKeys={pickerOpen} footer={<QuickFooter onClose={onClose} submitLabel="Guardar" pending={create.isPending} />}>
      <VehicleChoice
        vehicles={defaults.vehicles}
        vehicle={vehicle}
        pickerOpen={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={onSelectVehicle}
      />
      <MoneyField
        label="Valor"
        required
        autoFocus
        value={form.values.amount}
        onChange={(value) => form.setValue('amount', value)}
        error={errors.amountCents}
      />
      <CategoryPicker
        value={form.values.category}
        onChange={(value) => form.setValue('category', value)}
        frequent={defaults.frequentCategories}
        error={errors.category}
      />
      <DateField
        label="Data"
        value={form.values.date}
        onChange={(event) => form.setValue('date', event.target.value)}
        error={errors.date}
      />

      <details className="z-disclosure">
        <summary className="z-disclosure__toggle" style={{ listStyle: 'none', display: 'flex' }}>
          Adicionar detalhes
          <span aria-hidden="true">›</span>
        </summary>
        <div className="z-stack" style={{ paddingTop: 'var(--z-space-3)' }}>
          <TextField
            label="Onde"
            placeholder="Oficina, loja, estação…"
            value={form.values.vendor}
            onChange={(event) => form.setValue('vendor', event.target.value)}
            error={errors.vendor}
          />
          <NumberField
            label="Quilometragem"
            suffix="km"
            hint={defaults.odometerKm !== null ? `Última leitura: ${km(defaults.odometerKm)}` : undefined}
            value={form.values.odometerKm}
            onChange={(value) => form.setValue('odometerKm', value)}
            error={errors.odometerKm}
          />
          <TextField
            label="Descrição"
            value={form.values.description}
            onChange={(event) => form.setValue('description', event.target.value)}
            error={errors.description}
          />
          <TextAreaField
            label="Notas"
            value={form.values.notes}
            onChange={(event) => form.setValue('notes', event.target.value)}
          />
        </div>
      </details>

      <FormError error={create.error} />
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Abastecimento                                                               */
/* -------------------------------------------------------------------------- */

function FuelForm({ onClose, onNovoRegisto }: { onClose: () => void; onNovoRegisto: (kind: RecordKind) => void }) {
  const [chosenVehicleId, setChosenVehicleId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const defaults = useSmartDefaults(chosenVehicleId);
  const create = useCreateFuel();
  const toast = useToast();
  const navigate = useNavigate();
  const form = useFormState({
    litres: '',
    amount: '',
    odometerKm: defaults.odometerInput,
    date: defaults.today,
    station: '',
    fullTank: 'true',
    notes: '',
  });
  const vehicle = defaults.vehicle;

  if (!vehicle) return <NoVehicleNotice onClose={onClose} />;

  /** Troca o veículo do registo (`55`) e reescreve a quilometragem com a do novo veículo. */
  const onSelectVehicle = (vehicleId: string) => {
    setChosenVehicleId(vehicleId);
    setPickerOpen(false);
    form.setValue('odometerKm', vehicleOdometerInput(resolveVehicle(defaults.vehicles, vehicleId)));
  };

  const errors = fieldErrors(create.error);
  // O preço por litro é calculado aqui **só para dar retorno imediato** enquanto se
  // escreve; o valor que fica guardado é sempre o que a API calcular.
  const litres = decimalOrUndefined(form.values.litres);
  const amountCents = amountOrUndefined(form.values.amount);
  const priceHint =
    litres && amountCents !== undefined
      ? `≈ ${formatCents(Math.round(amountCents / litres))}/L`
      : undefined;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const payload: Record<string, unknown> = {
      litres,
      amountCents,
      date: form.values.date,
      fullTank: form.values.fullTank === 'true',
    };
    const odometer = integerOrUndefined(form.values.odometerKm);
    if (odometer !== undefined) payload.odometerKm = odometer;
    const station = textOrUndefined(form.values.station);
    if (station) payload.station = station;
    const notes = textOrUndefined(form.values.notes);
    if (notes) payload.notes = notes;

    try {
      const session = await create.mutateAsync({ payload, vehicleId: defaults.vehicleId ?? undefined });
      rememberLastKind('fuel');
      if (litres && amountCents !== undefined) {
        defaults.rememberPrice('fuel', Math.round(amountCents / litres));
      }
      // As métricas derivadas vêm na resposta da criação (§13): quem acabou de registar um
      // abastecimento é precisamente quem quer ver o consumo. Mostrá-lo aqui poupa a
      // viagem ao ecrã de estatísticas.
      const consumption = session.derived.consumptionL100Km;
      toast.show(
        consumption !== null
          ? `Abastecimento registado · ${formatNumber(consumption, 2)} L/100 km neste depósito.`
          : 'Abastecimento registado.',
        {
          variant: 'ok',
          actions: postSaveActions('fuel', session.id, { navigate, novoRegisto: onNovoRegisto }),
        },
      );
      onClose();
    } catch {
      /* ver `FormError` */
    }
  }

  return (
    <Sheet open onClose={onClose} title={titleFor('fuel')} onSubmit={onSubmit} suspendGlobalKeys={pickerOpen} footer={<QuickFooter onClose={onClose} submitLabel="Guardar" pending={create.isPending} />}>
      <VehicleChoice
        vehicles={defaults.vehicles}
        vehicle={vehicle}
        pickerOpen={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={onSelectVehicle}
      />
      <div className="z-grid z-grid--2">
        <NumberField
          label="Litros"
          required
          autoFocus
          suffix="L"
          value={form.values.litres}
          onChange={(value) => form.setValue('litres', value)}
          error={errors.litres}
        />
        <MoneyField
          label="Valor"
          required
          hint={priceHint}
          value={form.values.amount}
          onChange={(value) => form.setValue('amount', value)}
          error={errors.amountCents}
        />
      </div>
      <NumberField
        label="Quilometragem"
        suffix="km"
        hint={
          defaults.odometerKm !== null
            ? `Já preenchemos com ${km(defaults.odometerKm)} — corrige só se estiver diferente.`
            : 'Sem este valor não conseguimos calcular o consumo.'
        }
        value={form.values.odometerKm}
        onChange={(value) => form.setValue('odometerKm', value)}
        error={errors.odometerKm}
      />

      <details className="z-disclosure">
        <summary className="z-disclosure__toggle" style={{ listStyle: 'none', display: 'flex' }}>
          Adicionar detalhes
          <span aria-hidden="true">›</span>
        </summary>
        <div className="z-stack" style={{ paddingTop: 'var(--z-space-3)' }}>
          <TextField
            label="Posto"
            placeholder="Galp, BP, Repsol…"
            value={form.values.station}
            onChange={(event) => form.setValue('station', event.target.value)}
            error={errors.station}
          />
          <DateField
            label="Data"
            value={form.values.date}
            onChange={(event) => form.setValue('date', event.target.value)}
            error={errors.date}
          />
          <CheckboxField
            label="Depósito cheio"
            checked={form.values.fullTank === 'true'}
            onChange={(checked) => form.setValue('fullTank', checked ? 'true' : 'false')}
            hint="O consumo só é calculado entre dois depósitos cheios. Se ficou a meio, desmarca: é melhor não ter número do que ter um número errado."
          />
          <TextAreaField
            label="Notas"
            value={form.values.notes}
            onChange={(event) => form.setValue('notes', event.target.value)}
          />
        </div>
      </details>

      <FormError error={create.error} />
      <DestineRow>
        {defaults.canRefuel
          ? null
          : 'Este veículo não usa combustível líquido — guardamos na mesma, se precisares.'}
      </DestineRow>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Carregamento                                                                */
/* -------------------------------------------------------------------------- */

function ChargingForm({ onClose, onNovoRegisto }: { onClose: () => void; onNovoRegisto: (kind: RecordKind) => void }) {
  const [chosenVehicleId, setChosenVehicleId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const defaults = useSmartDefaults(chosenVehicleId);
  const create = useCreateCharging();
  const toast = useToast();
  const navigate = useNavigate();
  const form = useFormState({
    energyKwh: '',
    amount: '',
    odometerKm: defaults.odometerInput,
    date: defaults.today,
    location: '',
    durationMinutes: '',
    startSoc: '',
    endSoc: '',
    isPublic: 'false',
    notes: '',
  });
  const vehicle = defaults.vehicle;

  if (!vehicle) return <NoVehicleNotice onClose={onClose} />;

  /** Troca o veículo do registo (`55`) e reescreve a quilometragem com a do novo veículo. */
  const onSelectVehicle = (vehicleId: string) => {
    setChosenVehicleId(vehicleId);
    setPickerOpen(false);
    form.setValue('odometerKm', vehicleOdometerInput(resolveVehicle(defaults.vehicles, vehicleId)));
  };

  const errors = fieldErrors(create.error);
  const energy = decimalOrUndefined(form.values.energyKwh);
  const amountCents = amountOrUndefined(form.values.amount);
  const priceHint =
    energy && amountCents !== undefined ? `≈ ${formatCents(Math.round(amountCents / energy))}/kWh` : undefined;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const payload: Record<string, unknown> = {
      energyKwh: energy,
      amountCents,
      date: form.values.date,
    };
    const odometer = integerOrUndefined(form.values.odometerKm);
    if (odometer !== undefined) payload.odometerKm = odometer;
    const location = textOrUndefined(form.values.location);
    if (location) payload.location = location;
    const duration = integerOrUndefined(form.values.durationMinutes);
    if (duration !== undefined) payload.durationMinutes = duration;
    const startSoc = decimalOrUndefined(form.values.startSoc);
    if (startSoc !== undefined) payload.startSocPercent = startSoc;
    const endSoc = decimalOrUndefined(form.values.endSoc);
    if (endSoc !== undefined) payload.endSocPercent = endSoc;
    payload.isHome = form.values.isPublic !== 'true';
    const notes = textOrUndefined(form.values.notes);
    if (notes) payload.notes = notes;

    try {
      const session = await create.mutateAsync({ payload, vehicleId: defaults.vehicleId ?? undefined });
      rememberLastKind('charging');
      if (energy && amountCents !== undefined) {
        defaults.rememberPrice('charging', Math.round(amountCents / energy));
      }
      const consumption = session.derived.consumptionKwh100Km;
      toast.show(
        consumption !== null
          ? `Carregamento registado · ${formatNumber(consumption, 2)} kWh/100 km`
          : 'Carregamento registado.',
        {
          variant: 'ok',
          actions: postSaveActions('charging', session.id, { navigate, novoRegisto: onNovoRegisto }),
        },
      );
      onClose();
    } catch {
      /* ver `FormError` */
    }
  }

  return (
    <Sheet open onClose={onClose} title={titleFor('charging')} onSubmit={onSubmit} suspendGlobalKeys={pickerOpen} footer={<QuickFooter onClose={onClose} submitLabel="Guardar" pending={create.isPending} />}>
      <VehicleChoice
        vehicles={defaults.vehicles}
        vehicle={vehicle}
        pickerOpen={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={onSelectVehicle}
      />
      <div className="z-grid z-grid--2">
        <NumberField
          label="Energia"
          required
          autoFocus
          suffix="kWh"
          value={form.values.energyKwh}
          onChange={(value) => form.setValue('energyKwh', value)}
          error={errors.energyKwh}
        />
        <MoneyField
          label="Valor"
          required
          hint={priceHint}
          value={form.values.amount}
          onChange={(value) => form.setValue('amount', value)}
          error={errors.amountCents}
        />
      </div>
      <NumberField
        label="Quilometragem"
        suffix="km"
        hint={
          defaults.odometerKm !== null
            ? `Já preenchemos com ${km(defaults.odometerKm)}.`
            : 'Permite calcular o consumo elétrico.'
        }
        value={form.values.odometerKm}
        onChange={(value) => form.setValue('odometerKm', value)}
        error={errors.odometerKm}
      />

      <details className="z-disclosure">
        <summary className="z-disclosure__toggle" style={{ listStyle: 'none', display: 'flex' }}>
          Adicionar detalhes
          <span aria-hidden="true">›</span>
        </summary>
        <div className="z-stack" style={{ paddingTop: 'var(--z-space-3)' }}>
          <TextField
            label="Local"
            placeholder="Casa, Ionity, Continente…"
            value={form.values.location}
            onChange={(event) => form.setValue('location', event.target.value)}
            error={errors.location}
          />
          <DateField
            label="Data"
            value={form.values.date}
            onChange={(event) => form.setValue('date', event.target.value)}
            error={errors.date}
          />
          <div className="z-grid z-grid--2">
            <NumberField
              label="Bateria à chegada"
              suffix="%"
              value={form.values.startSoc}
              onChange={(value) => form.setValue('startSoc', value)}
              error={errors.startSocPercent}
            />
            <NumberField
              label="Bateria à saída"
              suffix="%"
              value={form.values.endSoc}
              onChange={(value) => form.setValue('endSoc', value)}
              error={errors.endSocPercent}
            />
          </div>
          <NumberField
            label="Duração"
            suffix="min"
            value={form.values.durationMinutes}
            onChange={(value) => form.setValue('durationMinutes', value)}
            error={errors.durationMinutes}
          />
          <CheckboxField
            label="Carregamento público"
            checked={form.values.isPublic === 'true'}
            onChange={(checked) => form.setValue('isPublic', checked ? 'true' : 'false')}
            hint="Separa a energia de casa da da rede — é a diferença que mais pesa no custo por km."
          />
          <TextAreaField
            label="Notas"
            value={form.values.notes}
            onChange={(event) => form.setValue('notes', event.target.value)}
          />
        </div>
      </details>

      <FormError error={create.error} />
      <DestineRow>
        {defaults.canCharge
          ? null
          : 'Este veículo não carrega da rede — guardamos na mesma, se precisares.'}
      </DestineRow>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Manutenção                                                                  */
/* -------------------------------------------------------------------------- */

function MaintenanceForm({ onClose, onNovoRegisto }: { onClose: () => void; onNovoRegisto: (kind: RecordKind) => void }) {
  const [chosenVehicleId, setChosenVehicleId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const defaults = useSmartDefaults(chosenVehicleId);
  const create = useCreateMaintenance();
  const toast = useToast();
  const navigate = useNavigate();
  const form = useFormState({
    type: 'service',
    date: defaults.today,
    odometerKm: defaults.odometerInput,
    amount: '',
    workshop: '',
    description: '',
    intervalKm: '',
    intervalMonths: '',
    notes: '',
  });
  const vehicle = defaults.vehicle;

  if (!vehicle) return <NoVehicleNotice onClose={onClose} />;

  /** Troca o veículo do registo (`55`) e reescreve a quilometragem com a do novo veículo. */
  const onSelectVehicle = (vehicleId: string) => {
    setChosenVehicleId(vehicleId);
    setPickerOpen(false);
    form.setValue('odometerKm', vehicleOdometerInput(resolveVehicle(defaults.vehicles, vehicleId)));
  };

  const errors = fieldErrors(create.error);
  const intervalKm = integerOrUndefined(form.values.intervalKm);
  const intervalMonths = integerOrUndefined(form.values.intervalMonths);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const payload: Record<string, unknown> = { type: form.values.type, date: form.values.date };
    const amountCents = amountOrUndefined(form.values.amount);
    if (amountCents !== undefined) payload.amountCents = amountCents;
    const odometer = integerOrUndefined(form.values.odometerKm);
    if (odometer !== undefined) payload.odometerKm = odometer;
    const workshop = textOrUndefined(form.values.workshop);
    if (workshop) payload.workshop = workshop;
    const description = textOrUndefined(form.values.description);
    if (description) payload.description = description;
    if (intervalKm !== undefined) payload.intervalKm = intervalKm;
    if (intervalMonths !== undefined) payload.intervalMonths = intervalMonths;
    const notes = textOrUndefined(form.values.notes);
    if (notes) payload.notes = notes;

    try {
      const created = await create.mutateAsync({ payload, vehicleId: defaults.vehicleId ?? undefined });
      rememberLastKind('maintenance');
      toast.show(
        intervalKm !== undefined || intervalMonths !== undefined
          ? 'Manutenção registada e próximo lembrete criado.'
          : 'Manutenção registada.',
        {
          variant: 'ok',
          actions: postSaveActions('maintenance', created.id, { navigate, novoRegisto: onNovoRegisto }),
        },
      );
      onClose();
    } catch {
      /* ver `FormError` */
    }
  }

  return (
    <Sheet open onClose={onClose} title={titleFor('maintenance')} onSubmit={onSubmit} suspendGlobalKeys={pickerOpen} footer={<QuickFooter onClose={onClose} submitLabel="Guardar" pending={create.isPending} />}>
      <VehicleChoice
        vehicles={defaults.vehicles}
        vehicle={vehicle}
        pickerOpen={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={onSelectVehicle}
      />
      <MoneyField
        label="Valor"
        autoFocus
        value={form.values.amount}
        onChange={(value) => form.setValue('amount', value)}
        error={errors.amountCents}
      />
      <MaintenanceTypePicker
        value={form.values.type}
        onChange={(value) => form.setValue('type', value)}
        error={errors.type}
      />
      <div className="z-grid z-grid--2">
        <DateField
          label="Data"
          value={form.values.date}
          onChange={(event) => form.setValue('date', event.target.value)}
          error={errors.date}
        />
        <NumberField
          label="Quilometragem"
          suffix="km"
          value={form.values.odometerKm}
          onChange={(value) => form.setValue('odometerKm', value)}
          error={errors.odometerKm}
        />
      </div>

      <details className="z-disclosure">
        <summary className="z-disclosure__toggle" style={{ listStyle: 'none', display: 'flex' }}>
          Adicionar detalhes
          <span aria-hidden="true">›</span>
        </summary>
        <div className="z-stack" style={{ paddingTop: 'var(--z-space-3)' }}>
          <TextField
            label="Oficina"
            value={form.values.workshop}
            onChange={(event) => form.setValue('workshop', event.target.value)}
            error={errors.workshop}
          />
          <TextField
            label="Descrição"
            placeholder="Revisão dos 50 000 km, mudança de óleo…"
            value={form.values.description}
            onChange={(event) => form.setValue('description', event.target.value)}
            error={errors.description}
          />
          {/*
            O atalho de plano de manutenção da §16. Explicar o efeito aqui evita que estes
            dois campos pareçam decorativos: preenchê-los cria o lembrete seguinte, o que é
            a diferença entre uma ficha e uma plataforma.
          */}
          <div className="z-grid z-grid--2">
            <NumberField
              label="Repetir a cada"
              suffix="km"
              hint="Cria o próximo lembrete."
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
          <TextAreaField
            label="Notas"
            value={form.values.notes}
            onChange={(event) => form.setValue('notes', event.target.value)}
          />
        </div>
      </details>

      <FormError error={create.error} />
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Quilometragem (§11)                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Registo de quilometragem, com o fluxo de confirmação de recuo.
 *
 * Porque é que a folha não fecha logo após o primeiro pedido: se a API responder 422
 * `unprocessable`, a mensagem que devolve — «A quilometragem recuou 2 381 km face à última
 * leitura (43 560 km). Confirmas que corrigiste o valor?» — é mostrada tal e qual, com duas
 * opções. Só depois de o utilizador confirmar é que o pedido é reenviado com
 * `confirmRegression: true`.
 *
 * Reescrever a mensagem duplicaria a regra de apresentação da API; ignorar a confirmação
 * aceitaria em silêncio um valor que recuou — e um odómetro que recua sem explicação
 * destrói a confiança em todos os cálculos que dependem dele.
 */
function OdometerForm({ onClose, onNovoRegisto }: { onClose: () => void; onNovoRegisto: (kind: RecordKind) => void }) {
  const [chosenVehicleId, setChosenVehicleId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const defaults = useSmartDefaults(chosenVehicleId);
  const odometer = useRecordOdometer(defaults.vehicleId ?? undefined);
  const toast = useToast();
  const navigate = useNavigate();
  const form = useFormState({
    odometerKm: defaults.odometerInput,
    recordedAt: defaults.today,
  });
  const vehicle = defaults.vehicle;

  if (!vehicle) return <NoVehicleNotice onClose={onClose} />;

  /** Troca o veículo do registo (`55`) e reescreve a quilometragem com a do novo veículo. */
  const onSelectVehicle = (vehicleId: string) => {
    setChosenVehicleId(vehicleId);
    setPickerOpen(false);
    form.setValue('odometerKm', vehicleOdometerInput(resolveVehicle(defaults.vehicles, vehicleId)));
  };

  const errors = fieldErrors(odometer.error);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const value = integerOrUndefined(form.values.odometerKm);
    if (value === undefined) return;
    const outcome = await odometer
      .submit({ odometerKm: value, recordedAt: form.values.recordedAt })
      .catch(() => null);
    if (outcome?.kind === 'recorded') {
      const { result } = outcome;
      rememberLastKind('odometer');
      // Os avisos não bloqueantes da API (um salto grande mas plausível) são informação
      // útil, não um erro: aparecem com o registo já feito.
      //
      // Sem «Ver registo»: uma leitura não tem ecrã de detalhe (ver `lib/recordKinds.ts`). O
      // `null` no lugar do identificador é o que faz `postSaveActions` omitir a ação — em vez
      // de oferecer um botão que levaria a uma rota inexistente.
      toast.show(
        result.warnings.length > 0
          ? `Quilometragem registada (${km(result.odometerKm)}). ${result.warnings.join(' ')}`
          : `Quilometragem registada: ${km(result.odometerKm)}.`,
        {
          variant: 'ok',
          actions: postSaveActions('odometer', null, { navigate, novoRegisto: onNovoRegisto }),
        },
      );
      onClose();
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={titleFor('odometer')}
      onSubmit={onSubmit}
      suspendGlobalKeys={pickerOpen}
      footer={
        odometer.confirmation ? (
          <div className="z-sheet__footer">
            <Button type="button" variant="secondary" onClick={odometer.dismissConfirmation} disabled={odometer.isPending}>
              Não, deixar
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={odometer.isPending}
              onClick={() => {
                void odometer.confirm()?.then((outcome) => {
                  if (outcome?.kind === 'recorded') {
                    rememberLastKind('odometer');
                    toast.show(`Quilometragem corrigida: ${km(outcome.result.odometerKm)}.`, {
                      variant: 'ok',
                      actions: postSaveActions('odometer', null, { navigate, novoRegisto: onNovoRegisto }),
                    });
                    onClose();
                  }
                });
              }}
            >
              Sim, corrigi
            </Button>
          </div>
        ) : (
          <QuickFooter onClose={onClose} submitLabel="Guardar" pending={odometer.isPending} />
        )
      }
    >
      {odometer.confirmation ? (
        <Banner tone="warn" title="Confirma antes de guardar">
          {odometer.confirmation.message}
        </Banner>
      ) : null}

      <VehicleChoice
        vehicles={defaults.vehicles}
        vehicle={vehicle}
        pickerOpen={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={onSelectVehicle}
      />

      <NumberField
        label="Quilometragem"
        required
        autoFocus
        suffix="km"
        hint={
          defaults.odometerKm !== null
            ? `Última leitura conhecida: ${km(defaults.odometerKm)}.`
            : 'É o primeiro registo deste veículo.'
        }
        value={form.values.odometerKm}
        onChange={(value) => form.setValue('odometerKm', value)}
        error={errors.odometerKm}
      />
      <DateField
        label="Data da leitura"
        value={form.values.recordedAt}
        onChange={(event) => form.setValue('recordedAt', event.target.value)}
        error={errors.recordedAt}
      />
      <DestineRow>
        Uma leitura mais baixa do que a anterior é aceite — acontece quando se corrige um erro de
        escrita. Nesse caso pedimos confirmação, para que um recuo real não passe despercebido.
      </DestineRow>
      <FormError error={odometer.error} />
    </Sheet>
  );
}
