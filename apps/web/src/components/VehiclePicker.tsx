import type { VehicleSummary } from '@zemlo/shared';
import { Sheet } from '../ui/Sheet';
import { useReminders } from '../api/hooks';
import { vehicleStates, type VehicleState } from '../lib/vehicleState';
import { VehicleCardBody, vehicleCardClass, vehicleTitle } from './VehicleCard';

/**
 * Seletor de veículo do registo rápido (`55`, `56`).
 *
 * ## O que a decisão `55` pede, e o que faltava
 *
 * «o veículo deve estar visível no formulário de registo quando aplicável; deve ser claramente
 * editável; se existir contexto de veículo, deve vir pré-selecionado; o utilizador pode trocar
 * de veículo; a associação deve ficar claramente visível.»
 *
 * O veículo já **aparecia** — como subtítulo da folha (`Registo em 🚗 BMW 320d · AB-12-CD`) e
 * numa linha de rodapé. O que faltava era ser **editável**: para registar noutro carro era
 * preciso fechar a folha, trocar o veículo em foco na barra lateral e voltar a abrir. O que
 * esta tarefa acrescenta é o campo do topo, que abre a folha de escolha.
 *
 * ## Reutilização do cartão da `43` — o que foi rejeitado, e porquê
 *
 * A primeira versão deste ficheiro desenhava o seu próprio cartão compacto, com o `emoji` do
 * tipo e classes `.z-vehicle-card` próprias. Foi **rejeitada na revisão**: a decisão `56` diz
 * para reutilizar o cartão canónico da `43` e adaptar **apenas tamanho/densidade**, e um segundo
 * cartão divergiria do primeiro à primeira alteração de estilo — além de colidir com o bloco
 * `.z-vehicle-card*` que a `43` já define em `app.css`.
 *
 * Agora este ficheiro **não desenha cartão nenhum**: compõe `VehicleCardBody` (o mesmo conteúdo
 * da lista de veículos) com `vehicleCardClass(true)` (a densidade compacta). O glifo, o nome, a
 * matrícula, o tipo, a energia e o estado vêm todos do cartão da `43` — incluindo o glifo SVG,
 * porque o `emoji` foi substituído por traço próprio nessa decisão.
 *
 * ## Sem emoji, e sem ícone novo
 *
 * O indicador de seleção é `aria-pressed` mais um anel desenhado em CSS — não um `✓`, e muito
 * menos um emoji. O `ui/Icon.tsx` não tem `check` nem `chevron`, e acrescentar-lhe ícones só
 * para este ecrã iria contra o sistema de iconografia (uma família, um sítio). O `▾` do campo é
 * a mesma marca tipográfica que o produto já usa no `›` da divulgação progressiva.
 */

/** Nome acessível de uma opção: o que identifica o veículo sem depender do desenho do cartão. */
function optionName(vehicle: VehicleSummary): string {
  return `${vehicleTitle(vehicle)} · ${vehicle.plateDisplay}`;
}

/* -------------------------------------------------------------------------- */
/* Campo do formulário                                                         */
/* -------------------------------------------------------------------------- */

export interface VehicleFieldProps {
  vehicle: VehicleSummary;
  /** Quantos veículos a conta tem. Com um só não há nada a trocar. */
  vehicleCount: number;
  onOpen: () => void;
}

/**
 * O veículo do registo, à vista e editável.
 *
 * ## Com um só veículo, o campo não é um botão
 *
 * Com uma conta de um veículo não existe escolha, e um botão que abre uma folha com uma opção é
 * ruído — o mesmo raciocínio que faz o `VehicleSwitcher` não se desenhar nesse caso. O campo
 * **continua a aparecer**: a `55` pede que o formulário mostre onde o registo vai ficar, e essa
 * informação é útil mesmo quando só há um destino. O que desaparece é a interatividade.
 *
 * ## Acessibilidade
 *
 * `aria-haspopup="dialog"` diz que abre uma folha; `aria-expanded` é sempre `false` porque a
 * folha é **irmã** deste botão, não filha — este botão nunca está «expandido» no sentido ARIA.
 * O nome acessível é «Veículo:» mais o nome e a matrícula, que **contém** o texto visível do
 * cartão — é o que a regra «Label in Name» (WCAG 2.5.3) exige.
 */
export function VehicleField({ vehicle, vehicleCount, onOpen }: VehicleFieldProps) {
  const canChoose = vehicleCount > 1;
  const label = `Veículo: ${optionName(vehicle)}`;

  return (
    <div className="z-vehicle-field">
      <span className="z-field__label">Veículo</span>
      {canChoose ? (
        <button
          type="button"
          className={`${vehicleCardClass(true)} z-vehicle-field__button`}
          onClick={onOpen}
          aria-haspopup="dialog"
          aria-expanded={false}
          aria-label={label}
        >
          <VehicleCardBody vehicle={vehicle} compact />
          <span className="z-vehicle-field__chevron" aria-hidden="true">
            ▾
          </span>
        </button>
      ) : (
        <div className={vehicleCardClass(true)}>
          <VehicleCardBody vehicle={vehicle} compact />
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Folha de escolha                                                            */
/* -------------------------------------------------------------------------- */

export interface VehiclePickerSheetProps {
  vehicles: readonly VehicleSummary[];
  selectedId: string | null;
  /** Estado por veículo (`vehicleStates`). Ausente para quem não tem lembretes avaliáveis. */
  states: Map<string, VehicleState>;
  onSelect: (vehicleId: string) => void;
  onClose: () => void;
}

/**
 * Folha com os veículos da conta, um cartão compacto por veículo (decisão `56`).
 *
 * Um toque escolhe e fecha — não há botão de confirmar. É deliberado: uma folha de escolha
 * única com «Confirmar» obriga a dois toques para o que um resolve, e o contexto do registo
 * rápido é o de quem tem o telemóvel numa mão.
 *
 * ## `role="group"` + `aria-pressed`, e não `role="radiogroup"`
 *
 * Segue a convenção já estabelecida no produto para escolha única entre opções visíveis
 * (`CategoryPicker` e `MaintenanceTypePicker`, `components/formParts.tsx`). O padrão
 * `radiogroup` seria igualmente correto; adotá-lo **só aqui** criaria dois padrões para a mesma
 * interação. A guarda de `WEB-006`/A4 exige que o grupo tenha nome — daí o `aria-label`.
 */
export function VehiclePickerSheet({
  vehicles,
  selectedId,
  states,
  onSelect,
  onClose,
}: VehiclePickerSheetProps) {
  return (
    <Sheet
      open
      onClose={onClose}
      title="Escolher veículo"
      subtitle="O registo fica associado ao veículo que escolheres."
    >
      <div className="z-vehicle-choice" role="group" aria-label="Veículos da conta">
        {vehicles.map((vehicle) => {
          const selected = vehicle.id === selectedId;
          return (
            <button
              key={vehicle.id}
              type="button"
              className={`${vehicleCardClass(true)} z-vehicle-choice__option${
                selected ? ' z-vehicle-choice__option--selected' : ''
              }`}
              aria-pressed={selected}
              aria-label={optionName(vehicle)}
              onClick={() => onSelect(vehicle.id)}
            >
              <VehicleCardBody vehicle={vehicle} state={states.get(vehicle.id)} compact />
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Campo + folha, ligados                                                      */
/* -------------------------------------------------------------------------- */

export interface VehicleChoiceProps {
  vehicles: readonly VehicleSummary[];
  vehicle: VehicleSummary;
  pickerOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (vehicleId: string) => void;
}

/**
 * O campo e a folha, ligados — o que cada formulário de registo declara.
 *
 * ## Porque é que isto existe como componente
 *
 * Cinco formulários precisam do mesmo par campo+folha. Escrito em cada um, seriam cinco cópias
 * do mesmo bloco, e a primeira correção a um deles deixaria os outros quatro divergentes.
 *
 * ## Porque é que o estado de abertura fica no formulário
 *
 * `pickerOpen` é controlado de fora porque o formulário precisa dele para outra coisa: passar
 * `suspendGlobalKeys` à folha principal, para que o Escape e o ciclo de Tab não colidam entre as
 * duas folhas abertas. Ver a nota dessa propriedade em `ui/Sheet.tsx`.
 *
 * ## Porque é que os lembretes são lidos aqui
 *
 * A `56` pede «estado quando aplicável» no cartão, e o estado vem dos lembretes
 * (`vehicleStates`). O pedido é o mesmo que a lista de veículos já faz e o React Query
 * deduplica-o — não é um pedido novo por abrir o seletor.
 */
export function VehicleChoice({
  vehicles,
  vehicle,
  pickerOpen,
  onOpenChange,
  onSelect,
}: VehicleChoiceProps) {
  const reminders = useReminders({});
  const states = vehicleStates(reminders.data?.items ?? []);

  return (
    <>
      <VehicleField
        vehicle={vehicle}
        vehicleCount={vehicles.length}
        onOpen={() => onOpenChange(true)}
      />
      {pickerOpen ? (
        <VehiclePickerSheet
          vehicles={vehicles}
          selectedId={vehicle.id}
          states={states}
          onSelect={onSelect}
          onClose={() => onOpenChange(false)}
        />
      ) : null}
    </>
  );
}
