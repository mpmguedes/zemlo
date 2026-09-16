import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  FUEL_TYPES,
  MAINTENANCE_TYPES,
  categoryLabel,
  formatNumber,
  optionLabel,
  type ChargingSession,
  type Expense,
  type FuelSession,
  type MaintenanceRecord,
} from '@zemlo/shared';
import { fetchRecordDetail } from '../../api/queries';
import { errorMessage, errorRequestId } from '../../api/errors';
import { useVehicles } from '../../api/hooks';
import { Card, Chip, DetailList, DetailRow, InlineError, LoadingBlock, PageHeader } from '../../ui/primitives';
import { COVERAGE_OPTIONS } from '../../components/formParts';
import { consumption, dateLong, econsumption, km, litres, money, percent } from '../../lib/format';

/**
 * Detalhe de um registo.
 *
 * A API não expõe um ecrã por tipo de registo: existe um `GET /records/:kind/:id` por
 * recurso, e o que este ecrã faz é apresentá-lo com as **métricas derivadas já calculadas**
 * pelo servidor (§13, §14, §49) e com a origem do dado (§50).
 *
 * A origem merece um lugar de destaque: quando o Zemlo passar a receber dados de uma API de
 * fabricante, de um OBD ou de uma wallbox (§51), o mesmo registo pode ter vindo de sítios
 * diferentes — e o utilizador tem o direito de saber se aquele número foi escrito por ele,
 * importado de um ficheiro ou lido por um dispositivo.
 */
export function RecordDetailPage() {
  const { kind = 'expenses', recordId = '' } = useParams<{ kind: string; recordId: string }>();
  const vehicles = useVehicles(true);

  const query = useQuery({
    queryKey: ['records', 'detail', kind, recordId],
    queryFn: () => fetchRecordDetail(kind, recordId),
    enabled: Boolean(recordId),
  });

  if (query.isLoading) return <LoadingBlock label="A carregar o registo…" />;

  if (query.isError) {
    return (
      <div className="z-page">
        <InlineError
          message={errorMessage(query.error)}
          requestId={errorRequestId(query.error)}
          onRetry={() => void query.refetch()}
        />
        <p className="z-small z-muted">
          <Link to={`/records/${kind}`}>← Voltar à lista</Link>
        </p>
      </div>
    );
  }

  if (!query.data) return null;

  const record = query.data as { vehicleId?: string; source?: { kind: string | null; label: string | null; observedAt: string | null } };
  const vehicle = vehicles.data?.items.find((item) => item.id === record.vehicleId);
  const title = recordTitle(kind, query.data);

  return (
    <div className="z-page">
      <PageHeader
        title={title}
        subtitle={
          <span className="z-row z-row--wrap" style={{ gap: 'var(--z-space-2)' }}>
            {recordDate(query.data) ? <span>{dateLong(recordDate(query.data) as string)}</span> : null}
            {vehicle ? (
              <Link to={`/vehicles/${vehicle.id}`} className="z-chip z-chip--accent">
                {vehicle.emoji} {vehicle.plateDisplay}
              </Link>
            ) : null}
          </span>
        }
        back={{ to: `/records/${kind}`, label: 'Registos' }}
      />

      <Card>
        <DetailList>{detailRows(kind, query.data).map((row) => (
          <DetailRow key={row.label} label={row.label} value={row.value} />
        ))}</DetailList>
      </Card>

      {derivedRows(kind, query.data).length > 0 ? (
        <Card soft>
          <div className="z-card__header">
            <div>
              <div className="z-card__title">Calculado a partir deste registo</div>
              <div className="z-card__subtitle">
                Valores que o Zemlo deriva dos teus registos. Quando faltam dados, não aparece
                um número — aparece porquê.
              </div>
            </div>
          </div>
          <DetailList>
            {derivedRows(kind, query.data).map((row) => (
              <DetailRow key={row.label} label={row.label} value={row.value} />
            ))}
          </DetailList>
        </Card>
      ) : null}

      {record.source ? (
        <Card soft>
          <DetailList>
            <DetailRow
              label="Origem do dado"
              value={
                <span className="z-row" style={{ gap: 'var(--z-space-2)' }}>
                  <Chip>{record.source.label ?? record.source.kind ?? 'Manual'}</Chip>
                </span>
              }
            />
            {record.source.observedAt ? (
              <DetailRow label="Observado em" value={dateLong(record.source.observedAt.slice(0, 10))} />
            ) : null}
          </DetailList>
        </Card>
      ) : null}

      <p className="z-xs z-muted">
        Esta versão da aplicação mostra o registo e não permite editá-lo. A API expõe
        `PATCH` e `DELETE` para este recurso, mas um formulário de edição por tipo de registo
        seria quatro formulários a repetir o do registo rápido — e a forma mais honesta de
        corrigir é registar de novo, para que o histórico mostre a correção.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Campos por tipo                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Rótulos dos campos dos tipos de conformidade.
 *
 * Vive fora da função porque é uma tabela: recriá-la a cada registo aberto seria trabalho
 * desnecessário, e mantê-la no topo torna evidente que acrescentar um campo à API sem
 * acrescentar o rótulo aqui faz aparecer o nome técnico — que é um resultado aceitável
 * (legível) e não um espaço em branco.
 */
const CONFORMITY_LABELS: Record<string, string> = {
  insurer: 'Seguradora',
  policyNumber: 'Número de apólice',
  startDate: 'Início',
  endDate: 'Fim',
  premiumCents: 'Prémio',
  coverage: 'Cobertura',
  deductibleCents: 'Franquia',
  contactPhone: 'Contacto',
  result: 'Resultado',
  station: 'Centro',
  defects: 'Deficiências',
  nextDueDate: 'Próxima data',
  odometerKm: 'Quilometragem',
  amountCents: 'Valor',
  kind: 'Tipo',
  year: 'Ano',
  dueDate: 'Prazo',
  paid: 'Pago',
  title: 'Título',
  trigger: 'Dispara por',
  dueOdometerKm: 'Quilometragem limite',
  intervalKm: 'Intervalo em km',
  intervalMonths: 'Intervalo em meses',
  repeat: 'Repetição automática',
  completedAt: 'Concluído em',
  notes: 'Notas',
  date: 'Data',
  expiresAt: 'Validade',
  daysRemaining: 'Dias restantes',
  daysToExpiry: 'Dias até expirar',
  active: 'Em vigor',
};

function recordDate(record: unknown): string | null {
  const value = (record as { date?: string | null }).date;
  return value ?? null;
}

function recordTitle(kind: string, record: unknown): string {
  if (kind === 'fuel') return (record as FuelSession).station ?? 'Abastecimento';
  if (kind === 'charging') return (record as ChargingSession).location ?? 'Carregamento';
  if (kind === 'maintenance') return optionLabel(MAINTENANCE_TYPES, (record as MaintenanceRecord).type);
  if (kind === 'insurance') return (record as { insurer?: string }).insurer ?? 'Seguro';
  if (kind === 'inspections') return 'Inspeção';
  if (kind === 'taxes') return `Imposto ${(record as { year?: number }).year ?? ''}`.trim();
  if (kind === 'reminders') return (record as { title?: string }).title ?? 'Lembrete';
  return categoryLabel((record as Expense).category);
}

function money$1(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? '—' : money(cents);
}

function detailRows(kind: string, record: unknown): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  const push = (label: string, value: string | number | null | undefined) => {
    rows.push({ label, value: value === null || value === undefined || value === '' ? '—' : String(value) });
  };

  const date = recordDate(record);
  if (date) push('Data', dateLong(date));

  if (kind === 'expenses') {
    const expense = record as Expense;
    push('Categoria', categoryLabel(expense.category));
    rows.push({ label: 'Valor', value: money(expense.amountCents) });
    if (expense.vatCents !== null) rows.push({ label: 'IVA', value: money(expense.vatCents) });
    push('Onde', expense.vendor);
    push('Descrição', expense.description);
    push('Quilometragem', expense.odometerKm === null ? null : km(expense.odometerKm));
    push('Pago', expense.paid ? 'Sim' : 'Não');
    push('Método de pagamento', expense.paymentMethod);
    push('Notas', expense.notes);
  } else if (kind === 'fuel') {
    const session = record as FuelSession;
    push('Litros', litres(session.litres));
    rows.push({ label: 'Valor', value: money(session.amountCents) });
    rows.push({ label: 'Preço por litro', value: money$1(session.pricePerLitreCents) });
    push('Posto', session.station);
    push('Combustível', session.fuelType ? optionLabel(FUEL_TYPES, session.fuelType) : null);
    push('Depósito cheio', session.fullTank ? 'Sim' : 'Não');
    push('Quilometragem', session.odometerKm === null ? null : km(session.odometerKm));
    push('Notas', session.notes);
  } else if (kind === 'charging') {
    const session = record as ChargingSession;
    push('Energia', `${formatNumber(session.energyKwh, 2)} kWh`);
    rows.push({ label: 'Valor', value: money(session.amountCents) });
    rows.push({ label: 'Preço por kWh', value: money$1(session.pricePerKwhCents) });
    push('Local', session.location);
    push('Carregador', session.charger);
    push('Duração', session.durationMinutes === null ? null : `${session.durationMinutes} min`);
    push('Bateria à chegada', session.startSocPercent === null ? null : percent(session.startSocPercent));
    push('Bateria à saída', session.endSocPercent === null ? null : percent(session.endSocPercent));
    push('Potência', session.powerKw === null ? null : `${formatNumber(session.powerKw, 1)} kW`);
    push('Operador', session.provider);
    push('Público', session.isPublic === null ? null : session.isPublic ? 'Sim' : 'Não');
    push('Quilometragem', session.odometerKm === null ? null : km(session.odometerKm));
    push('Notas', session.notes);
  } else if (kind === 'maintenance') {
    const maintenance = record as MaintenanceRecord;
    push('Tipo', optionLabel(MAINTENANCE_TYPES, maintenance.type));
    rows.push({ label: 'Valor', value: money$1(maintenance.amountCents) });
    if (maintenance.partsCents !== null) rows.push({ label: 'Peças', value: money(maintenance.partsCents) });
    if (maintenance.labourCents !== null) rows.push({ label: 'Mão de obra', value: money(maintenance.labourCents) });
    push('Oficina', maintenance.workshop);
    push('Descrição', maintenance.description);
    push('Quilometragem', maintenance.odometerKm === null ? null : km(maintenance.odometerKm));
    push('Garantia', maintenance.warrantyMonths === null ? null : `${maintenance.warrantyMonths} meses`);
    push('Próxima data', maintenance.nextDueDate ? dateLong(maintenance.nextDueDate) : null);
    push('Próxima quilometragem', maintenance.nextDueOdometerKm === null ? null : km(maintenance.nextDueOdometerKm));
    push('Notas', maintenance.notes);
  } else {
    /*
     * Tipos de conformidade (seguro, inspeção, impostos, lembretes).
     *
     * Cada um tem uma forma própria na API e não vale a pena um ramo por tipo: itera-se o
     * objeto e traduzem-se as chaves conhecidas. Duas exceções tratadas explicitamente — as
     * datas, que têm de ser formatadas em português, e a cobertura do seguro, que é um
     * código (`comprehensive`) que o utilizador não deve ver em bruto.
     */
    const DATE_KEYS = new Set(['startDate', 'endDate', 'nextDueDate', 'dueDate', 'completedAt', 'expiresAt']);
    const dictionary = CONFORMITY_LABELS;

    for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
      if (['id', 'vehicleId', 'source', 'createdAt', 'updatedAt', 'derived', 'userId', 'reminderId', 'documentId', 'dedupeKey', 'origin', 'originRecordId'].includes(key)) continue;
      if (value === null || value === undefined || value === '') continue;
      if (typeof value === 'object') continue;

      if (key === 'coverage') {
        rows.push({ label: dictionary[key] ?? key, value: optionLabel(COVERAGE_OPTIONS, String(value)) });
        continue;
      }
      if (DATE_KEYS.has(key) && typeof value === 'string') {
        rows.push({ label: dictionary[key] ?? key, value: dateLong(value.slice(0, 10)) });
        continue;
      }
      if (key === 'result') {
        const RESULTS: Record<string, string> = {
          passed: 'Aprovada',
          passed_with_defects: 'Aprovada com deficiências',
          failed: 'Reprovada',
          pending: 'Pendente',
        };
        rows.push({ label: dictionary[key] ?? key, value: RESULTS[String(value)] ?? String(value) });
        continue;
      }
      if (key === 'trigger') {
        const TRIGGERS: Record<string, string> = {
          distance: 'Por quilometragem',
          time: 'Por tempo',
          both: 'Km ou tempo (o que ocorrer primeiro)',
        };
        rows.push({ label: dictionary[key] ?? key, value: TRIGGERS[String(value)] ?? String(value) });
        continue;
      }
      rows.push({
        label: dictionary[key] ?? key,
        value: typeof value === 'boolean' ? (value ? 'Sim' : 'Não') : String(value),
      });
    }
  }

  return rows;
}

/**
 * Métricas derivadas.
 *
 * Só os tipos que o servidor calcula as têm. A §49 é explícita: quando falta um dado, o
 * Zemlo diz **porquê** em vez de mostrar um número — e é isso que a linha de contexto faz.
 */
function derivedRows(kind: string, record: unknown): Array<{ label: string; value: string }> {
  if (kind === 'fuel') {
    const derived = (record as FuelSession).derived;
    return [
      { label: 'Distância desde o abastecimento anterior', value: derived.distanceSincePreviousKm === null ? 'sem leitura anterior com quilometragem' : km(derived.distanceSincePreviousKm) },
      { label: 'Consumo neste depósito', value: consumption(derived.consumptionL100Km) },
      { label: 'Custo por 100 km', value: money$1(derived.costPer100KmCents) },
    ];
  }
  if (kind === 'charging') {
    const derived = (record as ChargingSession).derived;
    return [
      { label: 'Distância desde o carregamento anterior', value: derived.distanceSincePreviousKm === null ? 'sem leitura anterior com quilometragem' : km(derived.distanceSincePreviousKm) },
      { label: 'Consumo elétrico', value: econsumption(derived.consumptionKwh100Km) },
      { label: 'Custo por 100 km', value: money$1(derived.costPer100KmCents) },
      { label: 'Potência média', value: derived.averagePowerKw === null ? 'sem duração registada' : `${formatNumber(derived.averagePowerKw, 2)} kW` },
      { label: 'Energia adicionada à bateria', value: derived.addedSocPercent === null ? 'sem percentagens de bateria' : `${formatNumber(derived.addedSocPercent, 0)} %` },
    ];
  }
  return [];
}
