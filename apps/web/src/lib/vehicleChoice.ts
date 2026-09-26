import type { VehicleSummary } from '@zemlo/shared';

/**
 * Escolha do veículo num registo (`55`, `56`).
 *
 * ## Âmbito depois da revisão à luz da `43`
 *
 * Este ficheiro tinha uma primeira versão que **também** sabia o nome do veículo
 * (`vehicleDisplayName`) e a linha secundária (`vehicleMeta`). Isso duplicava a decisão `43`,
 * que fixou essas duas coisas no cartão — e fixou-as com regras diferentes das minhas (o nome
 * em destaque é marca + modelo, **não** o apelido). Duas regras para o mesmo nome divergem, e o
 * sintoma seria o seletor a chamar ao veículo um nome que a lista não usa.
 *
 * O nome e o cartão vivem agora em `components/VehicleCard.tsx` (`vehicleTitle` +
 * `VehicleCardBody`). O que fica **aqui** é o que é genuinamente desta tarefa e não pertence ao
 * cartão: **qual é o veículo que fica selecionado** e **que quilometragem pré-preencher**.
 *
 * ## Porque é que isto é um módulo, e não três linhas dentro do formulário
 *
 * O projeto não usa `jsdom` (decisão escrita em `page-states.test.tsx`), pelo que um teste não
 * consegue simular o toque que abre a folha nem o toque que escolhe. Extrair a decisão para
 * funções puras é o que a torna verificável — é o mesmo corte que `lib/tabs.ts` faz para a
 * aritmética das setas do `tablist`.
 */

/**
 * Veículo que fica selecionado.
 *
 *  - uma preferência **que existe na lista** é respeitada — é o que faz a pré-seleção
 *    automática que a `55` pede («se existir contexto de veículo, deve vir pré-selecionado»);
 *  - uma preferência que **já não existe** (o veículo foi arquivado noutro dispositivo, ou a
 *    lista ainda está a chegar) cai para o primeiro da lista, que a API ordena por atividade
 *    recente. É a mesma aposta que `useSmartDefaults` faz, e pela mesma razão;
 *  - sem veículos, devolve `null`. É o caso que o formulário trata com o aviso «Precisamos de
 *    um veículo primeiro» (§46), e não inventando um veículo.
 *
 * **Não guarda memória nenhuma.** A escolha vive no estado do formulário e morre com ele; a
 * única memória de veículo no produto é a seleção global (`useSelectedVehicle`), e a `55` diz
 * explicitamente para não inventar outra.
 */
export function resolveVehicle(
  vehicles: readonly VehicleSummary[],
  preferredId: string | null | undefined,
): VehicleSummary | null {
  if (preferredId !== null && preferredId !== undefined) {
    const preferred = vehicles.find((vehicle) => vehicle.id === preferredId);
    if (preferred) return preferred;
  }
  return vehicles[0] ?? null;
}

/**
 * Valor do campo «Quilometragem» para um veículo.
 *
 * Existe por uma razão de dados: o campo é pré-preenchido com a última leitura **do veículo
 * escolhido**. Ao trocar de veículo, se o campo não fosse reescrito, um registo para o segundo
 * carro ficava com a quilometragem do primeiro — que a API leria como um recuo de dezenas de
 * milhares de km e pediria confirmação para gravar. É um valor errado a pedir permissão para
 * entrar.
 */
export function vehicleOdometerInput(vehicle: VehicleSummary | null): string {
  return vehicle?.odometerKm !== null && vehicle?.odometerKm !== undefined
    ? String(vehicle.odometerKm)
    : '';
}
