import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { addDays, endOfMonth, startOfMonth, todayIn } from '@zemlo/shared';
import { fetchCalendar } from '../api/queries';
import { useQuery } from '@tanstack/react-query';
import { errorMessage, errorRequestId } from '../api/errors';
import { queryKeys } from '../api/queryKeys';
import { useProfile, useVehicles } from '../api/hooks';
import { useSelectedVehicle } from '../hooks';
import { CalendarGrid, UpcomingList } from '../components/CalendarGrid';
import { Card, Chip, InlineError, PageHeader, Section } from '../ui/primitives';

/**
 * Calendário (§21).
 *
 * O mês em foco é guardado no endereço (`?mes=2026-09`) para que um mês específico seja um
 * link que se pode guardar — e para que o botão "voltar" do browser devolva o mês anterior,
 * que é o comportamento que qualquer pessoa espera de uma grelha de calendário.
 *
 * A consulta pede sempre o **mês completo mais uma margem de sete dias** em cada ponta: um
 * evento marcado para o dia 1 de outubro tem de aparecer na grelha de setembro quando esse
 * dia faz parte da última semana apresentada. Sem a margem, o calendário mentiria por
 * omissão — mostrava uma semana sem nada quando havia algo lá.
 */
export function CalendarPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const profile = useProfile();
  const selected = useSelectedVehicle();
  const vehicles = useVehicles();

  const timeZone = profile.data?.timeZone ?? 'Europe/Lisbon';
  const today = todayIn(timeZone);

  const month = searchParams.get('mes') ?? today.slice(0, 7);
  const vehicleIdFromUrl = searchParams.get('vehicleId') ?? '';
  const vehicleId = vehicleIdFromUrl || (selected.vehicleId === 'all' ? undefined : selected.vehicleId);

  const bounds = useMemo(() => {
    const first = startOfMonth(`${month}-01`);
    const last = endOfMonth(`${month}-01`);
    return { from: addDays(first, -7), to: addDays(last, 7) };
  }, [month]);

  const calendar = useQuery({
    queryKey: queryKeys.calendar(bounds.from, bounds.to, vehicleId),
    queryFn: () => fetchCalendar({ from: bounds.from, to: bounds.to, vehicleId }),
  });

  const [showUpcoming, setShowUpcoming] = useState(true);

  function setMonth(next: string) {
    const params = new URLSearchParams(searchParams);
    if (next === today.slice(0, 7)) params.delete('mes');
    else params.set('mes', next);
    setSearchParams(params, { replace: true });
  }

  function setVehicleScope(id: string) {
    const params = new URLSearchParams(searchParams);
    if (id === '') params.delete('vehicleId');
    else params.set('vehicleId', id);
    setSearchParams(params, { replace: true });
  }

  return (
    <div className="z-page">
      <PageHeader
        title="Calendário"
        subtitle="Prazos confirmados e datas previstas, num só mês."
        actions={
          <Chip tone={showUpcoming ? 'accent' : 'neutral'}>
            <button
              type="button"
              onClick={() => setShowUpcoming((value) => !value)}
              aria-pressed={showUpcoming}
              style={{ background: 'transparent', border: 0, color: 'inherit', padding: 0, font: 'inherit', cursor: 'pointer', minHeight: 'var(--z-touch)' }}
            >
              {showUpcoming ? '✓ ' : ''}A seguir
            </button>
          </Chip>
        }
      />

      <Card soft>
        <div className="z-filters" role="group" aria-label="Veículo">
          <Chip tone={vehicleIdFromUrl === '' ? 'accent' : 'neutral'}>
            <button
              type="button"
              onClick={() => setVehicleScope('')}
              style={{ background: 'transparent', border: 0, color: 'inherit', padding: 0, font: 'inherit', cursor: 'pointer', minHeight: 'var(--z-touch)' }}
            >
              Todos os veículos
            </button>
          </Chip>
          {(vehicles.data?.items ?? []).map((vehicle) => (
            <Chip key={vehicle.id} tone={vehicleIdFromUrl === vehicle.id ? 'accent' : 'neutral'}>
              <button
                type="button"
                onClick={() => setVehicleScope(vehicle.id)}
                style={{ background: 'transparent', border: 0, color: 'inherit', padding: 0, font: 'inherit', cursor: 'pointer', minHeight: 'var(--z-touch)' }}
              >
                {vehicle.emoji} {vehicle.plateDisplay}
              </button>
            </Chip>
          ))}
        </div>
      </Card>

      {calendar.isError ? (
        <InlineError
          message={errorMessage(calendar.error)}
          requestId={errorRequestId(calendar.error)}
          onRetry={() => void calendar.refetch()}
        />
      ) : null}

      <CalendarGrid
        month={month}
        onMonthChange={setMonth}
        data={calendar.data}
        isLoading={calendar.isLoading}
        error={calendar.error}
      />

      {showUpcoming ? (
        <Section title="A seguir" hint="os próximos prazos, por ordem de proximidade">
          {/*
           * Sem esta distinção, um erro do mês faria a lista cair em `entries: []` e dizer
           * «Sem prazos à frente» — a mesma afirmação falsa que a grelha produzia. A repetição
           * é a de cima: uma segunda mensagem de erro a poucos centímetros seria ruído.
           */}
          {calendar.isError ? (
            <p className="z-small z-muted">
              Não foi possível carregar os próximos prazos. Usa «Tentar novamente» acima.
            </p>
          ) : (
            <UpcomingList entries={calendar.data?.entries ?? []} limit={8} />
          )}
        </Section>
      ) : null}

      <p className="z-xs z-muted">
        Uma data <strong>prevista</strong> é uma estimativa: o Zemlo calculou quando a
        quilometragem limite será atingida, com base no teu ritmo de utilização. As datas com
        ponto cheio são compromissos — prazos legais, renovações ou lembretes que marcaste.
      </p>
    </div>
  );
}
