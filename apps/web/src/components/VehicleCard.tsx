import { Link } from 'react-router-dom';
import { FUEL_TYPES, VEHICLE_TYPES, optionLabel, type VehicleSummary } from '@zemlo/shared';
import { VehicleGlyph } from '../ui/vehicleGlyphs';
import { dateLong, km } from '../lib/format';
import type { VehicleState } from '../lib/vehicleState';

/**
 * Cartão de veículo — decisão UX/UI **43**, num só sítio.
 *
 * ## Porque é que isto saiu de `pages/vehicles/VehiclesPage.tsx`
 *
 * O cartão nasceu na lista de veículos, como componente **local** daquela página. A decisão
 * `56` precisa do **mesmo** cartão no seletor de veículo do registo, numa densidade menor.
 *
 * A alternativa era escrever um segundo cartão no seletor — e dois cartões de veículo no mesmo
 * produto divergem sempre: à primeira alteração de estilo, o cartão da lista e o do seletor
 * deixam de parecer o mesmo veículo, e o utilizador deixa de reconhecer o carro que escolheu.
 * Foi por isso que o cartão passou a viver aqui, e que a `VehiclesPage` o importa em vez de o
 * ter: **uma só implementação**, dois contextos.
 *
 * ## O que a variante compacta muda, e o que não muda
 *
 * Muda **só a densidade**: a compacta não desenha o rodapé (quilometragem + última leitura),
 * que é o que dá altura ao cartão e o que menos decide uma escolha entre veículos — quem está
 * a escolher já sabe qual é qual pelo nome e pela matrícula.
 *
 * Não muda a identidade, que é o que a `56` exige que se mantenha: o glifo SVG local, a marca
 * e o modelo, a matrícula, o tipo e a energia, e o estado quando existe. Tudo o resto é o
 * mesmo markup e as mesmas classes `.z-vehicle-card*`.
 *
 * ## Sem emoji
 *
 * O glifo é `VehicleGlyph` (SVG local, `currentColor`), não o `emoji` do tipo. A decisão `43`
 * substituiu o emoji por traço próprio porque o emoji não herda cor nem é o mesmo desenho em
 * todos os sistemas — e a `56` herda essa decisão por reutilizar o cartão.
 */

/**
 * Nome do veículo em destaque: marca + modelo, com os recuos que os dados obrigam.
 *
 * O apelido **não** ganha aqui: a decisão `43` fixou marca + modelo como o nome em destaque (o
 * apelido aparece na linha de metadados, onde não compete com o nome técnico). Está provado por
 * mutação em `test/vehicle-cards.test.tsx` — «o nome em destaque é marca + modelo».
 */
export function vehicleTitle(vehicle: VehicleSummary): string {
  const makeModel = [vehicle.make, vehicle.model].filter(Boolean).join(' ');
  if (makeModel) return makeModel;
  // Sem marca nem modelo não há nome técnico: a matrícula é o único identificador que
  // existe, e inventar «Veículo» seria dar um nome que ninguém deu.
  return vehicle.plateDisplay;
}

/**
 * Classes do invólucro do cartão.
 *
 * Existe como função porque o invólucro muda de elemento — `<Link>` na lista, `<button>` no
 * seletor — e ambos têm de receber exatamente as mesmas classes. Escritas à mão em dois sítios,
 * a variante compacta acabaria aplicada a um e esquecida no outro.
 */
export function vehicleCardClass(compact = false): string {
  return compact ? 'z-vehicle-card z-vehicle-card--compact' : 'z-vehicle-card';
}

export interface VehicleCardBodyProps {
  vehicle: VehicleSummary;
  /** Estado geral do veículo, quando existe (`vehicleStates`). */
  state?: VehicleState | undefined;
  /** Densidade reduzida: sem rodapé de quilometragem. */
  compact?: boolean;
}

/**
 * O conteúdo do cartão, sem invólucro.
 *
 * Separado do invólucro para que a lista (que navega) e o seletor (que escolhe) partilhem o
 * **mesmo** conteúdo. Quem chama decide o elemento e as classes (`vehicleCardClass`).
 */
export function VehicleCardBody({ vehicle, state, compact = false }: VehicleCardBodyProps) {
  return (
    <>
      <div className="z-vehicle-card__head">
        <span className="z-vehicle-card__glyph">
          <VehicleGlyph type={vehicle.vehicleType} />
        </span>
        <div className="z-vehicle-card__id">
          <div className="z-vehicle-card__title">{vehicleTitle(vehicle)}</div>
          <div className="z-vehicle-card__meta">
            <span className="z-vehicle-card__plate">{vehicle.plateDisplay}</span>
            <span>{optionLabel(VEHICLE_TYPES, vehicle.vehicleType)}</span>
            <span>{optionLabel(FUEL_TYPES, vehicle.fuelType)}</span>
            {vehicle.nickname ? <span>{vehicle.nickname}</span> : null}
          </div>
        </div>
      </div>

      {/*
        O indicador só existe quando há um estado para mostrar (`vehicleStates` devolve
        uma entrada apenas para veículos com lembretes avaliáveis). Sem lembretes não se
        desenha «Em dia»: seria afirmar que está tudo tratado quando o Zemlo não sabe se
        há alguma coisa a tratar.
      */}
      {state ? (
        <span className="z-vehicle-card__status">
          <span
            className={`z-vehicle-card__dot${state.tone === 'ok' ? '' : ` z-vehicle-card__dot--${state.tone}`}`}
            aria-hidden="true"
          />
          {state.label}
        </span>
      ) : null}

      {compact ? null : (
        <div className="z-vehicle-card__foot">
          <div className="z-vehicle-card__odometer">
            {vehicle.odometerKm === null ? '—' : km(vehicle.odometerKm)}
            <span className="z-vehicle-card__foot-label">Quilometragem</span>
          </div>
          <div className="z-vehicle-card__reading">
            {vehicle.odometerUpdatedAt
              ? `Última leitura · ${dateLong(vehicle.odometerUpdatedAt.slice(0, 10))}`
              : 'Sem leituras registadas'}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * O cartão canónico como ligação — o que a lista de veículos usa.
 *
 * Continua a ser o cartão inteiro clicável: dá um alvo de toque muito maior do que um botão
 * «Abrir» de 32 px, que é a razão registada na decisão `43`.
 */
export function VehicleCard({ vehicle, state }: { vehicle: VehicleSummary; state?: VehicleState | undefined }) {
  return (
    <Link to={`/vehicles/${vehicle.id}`} className={vehicleCardClass()}>
      <VehicleCardBody vehicle={vehicle} state={state} />
    </Link>
  );
}
