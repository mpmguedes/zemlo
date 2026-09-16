import { useId } from 'react';
import { useSelectedVehicle } from '../hooks';
import { Chip } from '../ui/primitives';


/**
 * Seletor do veículo em foco.
 *
 * A decisão que aqui se toma é de interface, não de dados: quando a conta tem **um único**
 * veículo, o seletor não aparece. Mostrar um `<select>` com uma opção é ruído que faz o
 * utilizador pensar que há algo por configurar (§44, §59).
 *
 * Quando há vários, é um `<select>` nativo e não um menu próprio: o seletor nativo abre a
 * roda do sistema no telemóvel, é acessível por teclado sem trabalho adicional e é o
 * controlo que o utilizador reconhece.
 */
export function VehicleSwitcher({ allowAll = false }: { allowAll?: boolean }) {
  const { vehicles, vehicleId, select, isLoading } = useSelectedVehicle();
  const id = useId();

  if (isLoading) return <div className="z-skeleton z-skeleton--line" style={{ width: 140 }} aria-hidden="true" />;
  if (vehicles.length < 2 && !allowAll) return null;
  if (vehicles.length === 0) return null;

  return (
    <div className="z-row z-row--wrap" style={{ gap: 'var(--z-space-2)' }}>
      <label className="z-sr-only" htmlFor={id}>
        Veículo em foco
      </label>
      <select
        id={id}
        className="z-select"
        style={{ width: 'auto', minWidth: 160, minHeight: 40, paddingBlock: 0 }}
        value={vehicleId}
        onChange={(event) => select(event.target.value)}
      >
        {allowAll ? <option value="all">Toda a conta</option> : null}
        {vehicles.map((vehicle) => (
          <option key={vehicle.id} value={vehicle.id}>
            {/* O apelido ganha ao construtor/modelo: é o nome que o utilizador escolheu. */}
            {vehicle.nickname ?? ([vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.plateDisplay)}
            {' · '}
            {vehicle.plateDisplay}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Identificação curta do veículo em foco, para cabeçalhos de ecrã.
 *
 * Usada onde não cabe um seletor: mostra o emoji do tipo de veículo, o nome e a matrícula,
 * que é o conjunto de sinais com que o utilizador identifica o carro.
 */
export function VehicleBadge() {
  const { vehicle } = useSelectedVehicle();
  if (!vehicle) return null;
  const name = vehicle.nickname ?? [vehicle.make, vehicle.model].filter(Boolean).join(' ');

  return (
    <span className="z-row" style={{ gap: 'var(--z-space-2)' }}>
      <span aria-hidden="true">{vehicle.emoji}</span>
      <span className="z-small z-strong">{name || vehicle.plateDisplay}</span>
      <Chip>{vehicle.plateDisplay}</Chip>
    </span>
  );
}
