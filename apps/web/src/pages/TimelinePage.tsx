import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EVENT_TYPES, formatNumber, optionLabel } from '@zemlo/shared';
import type { TimelineItemKind } from '@zemlo/shared';
import { useVehicles } from '../api/hooks';
import { errorMessage, errorRequestId } from '../api/errors';
import { useTimeline } from '../hooks/useTimeline';
import { Card, Chip, InlineError, LoadingBlock, PageHeader, Section } from '../ui/primitives';
import { TimelineRow, groupByMonth } from '../components/records';
import { useSelectedVehicle } from '../hooks';

/**
 * Histórico (§24).
 *
 * A timeline é paginada por **cursor** e não por deslocamento — precisamente porque o
 * utilizador insere registos com datas retroativas. Com `offset`, uma despesa registada para
 * a semana passada enquanto se percorre o histórico faria repetir ou saltar itens na
 * fronteira entre páginas; o cursor aponta para uma posição no tempo e é imune a isso.
 *
 * Optámos por um botão **"Carregar mais"** em vez de deslocamento infinito automático. O
 * motivo é de acessibilidade e de controlo: o deslocamento infinito move o conteúdo debaixo
 * do dedo (ou do cursor) sem aviso, dificulta a navegação por teclado e torna impossível
 * chegar ao fundo do ecrã — onde estão os controlos. Numa lista que se percorre para
 * "encontrar aquela revisão de 2025", o botão é melhor.
 *
 * Os filtros por tipo de evento mostram os `kinds` que a API aceita, com as etiquetas e
 * ícones do registo partilhado — a mesma linguagem que a timeline usa por baixo.
 */
const KINDS: Array<{ code: TimelineItemKind; label: string; icon: string }> = [
  { code: 'expense', label: 'Despesas', icon: '💶' },
  { code: 'fuel', label: 'Abastecimentos', icon: '⛽' },
  { code: 'charging', label: 'Carregamentos', icon: '🔌' },
  { code: 'maintenance', label: 'Manutenção', icon: '🔧' },
  { code: 'insurance', label: 'Seguro', icon: '🛡️' },
  { code: 'inspection', label: 'Inspeções', icon: '📋' },
  { code: 'tax', label: 'Impostos', icon: '🏛️' },
  { code: 'document', label: 'Documentos', icon: '📄' },
  { code: 'odometer', label: 'Quilometragem', icon: '📍' },
  { code: 'reminder', label: 'Lembretes', icon: '🔔' },
  { code: 'event', label: 'Outros eventos', icon: '📝' },
];

export function TimelinePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selected = useSelectedVehicle();
  const vehicles = useVehicles();

  const vehicleIdFromUrl = searchParams.get('vehicleId') ?? '';
  const vehicleId = vehicleIdFromUrl || (selected.vehicleId === 'all' ? undefined : selected.vehicleId);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const kindsParam = searchParams.get('kinds') ?? '';
  const kinds = useMemo(
    () => (kindsParam ? (kindsParam.split(',').filter(Boolean) as TimelineItemKind[]) : undefined),
    [kindsParam],
  );

  const timeline = useTimeline({ vehicleId, kinds, from, to, limit: 30 });
  const groups = useMemo(() => groupByMonth(timeline.items), [timeline.items]);

  function toggleKind(kind: TimelineItemKind) {
    const current = new Set(kinds ?? []);
    if (current.has(kind)) current.delete(kind);
    else current.add(kind);
    const next = new URLSearchParams(searchParams);
    if (current.size === 0) next.delete('kinds');
    else next.set('kinds', Array.from(current).join(','));
    setSearchParams(next, { replace: true });
  }

  function setVehicleScope(id: string) {
    const next = new URLSearchParams(searchParams);
    if (id === '') next.delete('vehicleId');
    else next.set('vehicleId', id);
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="z-page">
      <PageHeader
        title="Histórico"
        subtitle="Tudo o que aconteceu, por ordem — registos, manutenções, documentos e lembretes."
      />

      <Card>
        <div className="z-stack">
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

          <div className="z-filters" role="group" aria-label="Tipo de evento">
            {KINDS.map((kind) => (
              <Chip key={kind.code} tone={kinds?.includes(kind.code) ? 'accent' : 'neutral'}>
                <button
                  type="button"
                  aria-pressed={kinds?.includes(kind.code) ?? false}
                  onClick={() => toggleKind(kind.code)}
                  style={{ background: 'transparent', border: 0, color: 'inherit', padding: 0, font: 'inherit', cursor: 'pointer', minHeight: 'var(--z-touch)' }}
                >
                  {kind.icon} {kind.label}
                </button>
              </Chip>
            ))}
            {kinds && kinds.length > 0 ? (
              <Chip tone="warn">
                <button
                  type="button"
                  onClick={() => {
                    const next = new URLSearchParams(searchParams);
                    next.delete('kinds');
                    setSearchParams(next, { replace: true });
                  }}
                  style={{ background: 'transparent', border: 0, color: 'inherit', padding: 0, font: 'inherit', cursor: 'pointer', minHeight: 'var(--z-touch)' }}
                >
                  Limpar filtros
                </button>
              </Chip>
            ) : null}
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
        </div>
      </Card>

      {timeline.isLoading ? <LoadingBlock label="A carregar o histórico…" /> : null}

      {timeline.isError ? (
        <InlineError
          message={errorMessage(timeline.error)}
          requestId={errorRequestId(timeline.error)}
          onRetry={timeline.refetch}
        />
      ) : null}

      {!timeline.isLoading && timeline.items.length === 0 ? (
        <Card>
          <div className="z-empty">
            <span className="z-empty__icon" aria-hidden="true">🕒</span>
            <p className="z-empty__title">
              {kinds || from || to ? 'Nada neste filtro' : 'Ainda sem histórico'}
            </p>
            <p className="z-empty__body">
              {kinds || from || to
                ? 'Nenhum evento corresponde aos filtros escolhidos. Limpa-os para veres o histórico completo.'
                : 'Regista um abastecimento ou uma despesa e o histórico começa a ganhar forma. O Zemlo junta aqui tudo o que acontece a cada veículo.'}
            </p>
            <Link to="/" className="z-btn z-btn--primary">
              Ir para o painel
            </Link>
          </div>
        </Card>
      ) : null}

      {timeline.items.length > 0 ? (
        <>
          <Section
            title={`${formatNumber(timeline.totalLoaded, 0)} eventos`}
            hint={timeline.hasNextPage ? 'há mais' : 'chegaste ao fim'}
          />

          <Card flush>
            {groups.map((group) => (
              <div className="z-timeline__group" key={group.month}>
                <div className="z-timeline__month">{group.label}</div>
                {group.items.map((item) => (
                  <TimelineRow key={item.id} item={item} showVehicle={!vehicleId} />
                ))}
              </div>
            ))}
          </Card>

          {timeline.hasNextPage ? (
            <button
              type="button"
              className="z-btn z-btn--secondary z-btn--block"
              onClick={() => void timeline.fetchNextPage()}
              aria-busy={timeline.isFetchingNextPage || undefined}
            >
              {timeline.isFetchingNextPage ? 'A carregar…' : 'Carregar mais'}
            </button>
          ) : (
            <p className="z-xs z-muted z-center">
              Fim do histórico. Os eventos aparecem agrupados por mês, do mais recente para o
              mais antigo.
            </p>
          )}
        </>
      ) : null}

      <p className="z-xs z-muted">
        Os tipos de evento correspondem ao registo partilhado do Zemlo (
        {EVENT_TYPES.slice(0, 3).map((event) => optionLabel(EVENT_TYPES, event.code)).join(', ')}…), para que
        a app mobile e esta aplicação mostrem a mesma linguagem do servidor.
      </p>
    </div>
  );
}
