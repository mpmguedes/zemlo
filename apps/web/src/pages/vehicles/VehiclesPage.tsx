import { Link } from 'react-router-dom';
import { formatNumber, optionLabel, VEHICLE_TYPES } from '@zemlo/shared';
import { useVehicles } from '../../api/hooks';
import { errorMessage, errorRequestId } from '../../api/errors';
import { Card, Chip, EmptyState, InlineError, LoadingBlock, PageHeader } from '../../ui/primitives';
import { dateLong, km } from '../../lib/format';

/**
 * Lista de veículos.
 *
 * Um veículo arquivado aparece distinguido e não escondido: quem vendeu um carro quer
 * continuar a poder consultar o histórico dele (é o que a §24 pede) sem o ver misturado com
 * os que ainda tem. O interruptor de arquivados está visível e explica-se — não é um filtro
 * escondido num menu.
 */
export function VehiclesPage() {
  const { data, isLoading, isError, error, refetch } = useVehicles(false);
  const archived = useVehicles(true);

  const all = archived.data?.items ?? [];
  const archivedVehicles = all.filter((vehicle) => vehicle.archived);

  return (
    <div className="z-page">
      <PageHeader
        title="Veículos"
        subtitle="Todos os veículos da tua conta, por atividade recente."
        actions={
          <Link to="/vehicles/new" className="z-btn z-btn--primary">
            Adicionar veículo
          </Link>
        }
      />

      {isLoading ? <LoadingBlock label="A carregar os veículos…" /> : null}

      {isError ? (
        <InlineError
          message={errorMessage(error)}
          requestId={errorRequestId(error)}
          onRetry={() => void refetch()}
        />
      ) : null}

      {data && data.items.length === 0 ? (
        <Card>
          <EmptyState
            icon="🚗"
            title="Ainda não tens veículos"
            body="Basta a matrícula. O ano, a versão, o VIN e a cor completam-se depois, na ficha do veículo, se quiseres."
            action={
              <Link to="/vehicles/new" className="z-btn z-btn--primary">
                Adicionar o primeiro veículo
              </Link>
            }
          />
        </Card>
      ) : null}

      {data && data.items.length > 0 ? (
        <>
          {/* Lista em telemóvel. */}
          <div className="z-stack">
            {data.items.map((vehicle) => (
              <Link key={vehicle.id} to={`/vehicles/${vehicle.id}`} className="z-card" style={{ color: 'inherit', textDecoration: 'none' }}>
                <div className="z-row">
                  <span className="z-list__icon" aria-hidden="true" style={{ width: 44, height: 44, fontSize: '1.3rem' }}>
                    {vehicle.emoji}
                  </span>
                  <div className="z-list__body">
                    <div className="z-list__title">
                      {vehicle.nickname ?? ([vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.plateDisplay)}
                    </div>
                    <div className="z-list__meta">
                      {vehicle.plateDisplay} · {optionLabel(VEHICLE_TYPES, vehicle.vehicleType)}
                      {vehicle.year ? ` · ${vehicle.year}` : ''}
                    </div>
                  </div>
                  <div className="z-list__trailing">
                    {vehicle.odometerKm === null ? '—' : km(vehicle.odometerKm)}
                    <span className="z-xs z-muted" style={{ display: 'block', fontWeight: 400 }}>
                      {vehicle.odometerUpdatedAt ? dateLong(vehicle.odometerUpdatedAt.slice(0, 10)) : 'sem leituras'}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {/*
            Tabela em ambiente de trabalho (§35). A mesma informação, mas com as colunas
            alinhadas: aqui o objetivo é comparar veículos, e comparar exige colunas.
          */}
          <div className="z-table-wrap">
            <table className="z-table">
              <caption className="z-sr-only">Veículos da conta</caption>
              <thead>
                <tr>
                  <th>Veículo</th>
                  <th>Matrícula</th>
                  <th>Tipo</th>
                  <th>Ano</th>
                  <th className="z-table__num">Quilometragem</th>
                  <th>Última leitura</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((vehicle) => (
                  <tr key={vehicle.id}>
                    <td>
                      <span aria-hidden="true">{vehicle.emoji}</span>{' '}
                      <Link to={`/vehicles/${vehicle.id}`}>
                        {vehicle.nickname ?? ([vehicle.make, vehicle.model].filter(Boolean).join(' ') || '—')}
                      </Link>
                    </td>
                    <td className="z-numeric">{vehicle.plateDisplay}</td>
                    <td>{optionLabel(VEHICLE_TYPES, vehicle.vehicleType)}</td>
                    <td className="z-numeric">{vehicle.year ?? '—'}</td>
                    <td className="z-table__num">{vehicle.odometerKm === null ? '—' : km(vehicle.odometerKm)}</td>
                    <td>{vehicle.odometerUpdatedAt ? dateLong(vehicle.odometerUpdatedAt.slice(0, 10)) : '—'}</td>
                    <td>
                      <Link to={`/vehicles/${vehicle.id}`} className="z-btn z-btn--ghost z-btn--sm">
                        Abrir
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {archivedVehicles.length > 0 ? (
        <Card soft>
          <div className="z-card__header">
            <div>
              <div className="z-card__title">Arquivados</div>
              <div className="z-card__subtitle">
                Veículos que já não tens, mas cujo histórico se mantém. Arquivar não apaga nada.
              </div>
            </div>
            <Chip>{formatNumber(archivedVehicles.length, 0)}</Chip>
          </div>
          <div className="z-list">
            {archivedVehicles.map((vehicle) => (
              <Link key={vehicle.id} to={`/vehicles/${vehicle.id}`} className="z-list__item" style={{ paddingInline: 0 }}>
                <span className="z-list__icon" aria-hidden="true">
                  {vehicle.emoji}
                </span>
                <span className="z-list__body">
                  <span className="z-list__title">
                    {vehicle.nickname ?? ([vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.plateDisplay)}
                  </span>
                  <span className="z-list__meta">{vehicle.plateDisplay} · arquivado</span>
                </span>
              </Link>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
