import type { Reminder, ReminderState } from '@zemlo/shared';

/**
 * Estado geral de um veículo, derivado dos lembretes que ele tem.
 *
 * ## Porque é que isto não é um campo do veículo
 *
 * A API não publica um «estado geral» por veículo — e não deve: o estado não é um dado
 * guardado, é uma **avaliação** que depende do dia de hoje, do odómetro atual e das
 * preferências de antecedência da conta. Guardá-lo seria guardar uma resposta que fica
 * errada sozinha. Ele já é calculado a pedido (`evaluateReminder`), e é esse cálculo que
 * aqui se lê.
 *
 * ## Porque é que a fonte é `GET /reminders` sem `vehicleId`
 *
 * Um pedido por veículo seria N+1 pedidos numa lista que pode ter cinco veículos. Um só
 * pedido devolve os lembretes de **todos** os veículos da conta, cada um com o seu
 * `vehicleId` e a sua `evaluation.state` — e o estado é calculado com o odómetro **do
 * veículo certo**: `services/reminders.ts:182-198` resolve `vehicle.odometerKm` e a taxa
 * de consumo por `row.vehicleId`, não pelo veículo do contexto. Ou seja, agrupar por
 * `vehicleId` aqui não perde exatidão nenhuma.
 *
 * ## O que é «pior»
 *
 * O estado geral responde a «há alguma coisa a exigir atenção?», pelo que o pior estado
 * entre os lembretes do veículo é o que se mostra. `unknown` conta como o menos grave:
 * um lembrete que não se consegue avaliar não é uma urgência — é uma ausência de dados, e
 * tratá-lo como urgência encheria o ecrã de alarmes que ninguém pode resolver.
 *
 * ## Porque é que a gravidade é um `switch` e não um `Record`
 *
 * `ReminderState` resolve hoje para `string` (`CodeOf` em `registry.ts:912` — é o `PC-42`),
 * pelo que um `Record<ReminderState, …>` é um índice de assinatura e cada leitura devolve
 * `… | undefined`. O `switch` diz o mesmo sem depender disso e, mais importante, obriga a
 * decidir o que acontece a um estado que esta versão ainda não conhece: conta como zero
 * gravidade e cai no rótulo neutro. Um estado desconhecido não é uma urgência.
 */

/** Gravidade relativa. Só serve para escolher o pior; os valores não têm significado. */
function severityOf(state: string): number {
  switch (state) {
    case 'overdue':
      return 4;
    case 'due':
      return 3;
    case 'soon':
      return 2;
    case 'ok':
      return 1;
    default:
      return 0;
  }
}

/** Rótulo do estado. `ok` é o único que afirma que está tudo tratado. */
function labelOf(state: string): string {
  switch (state) {
    case 'overdue':
      return 'Em atraso';
    case 'due':
      return 'Vence agora';
    case 'soon':
      return 'Em breve';
    case 'ok':
      return 'Em dia';
    default:
      return 'Sem dados';
  }
}

export type StateTone = 'ok' | 'warn' | 'danger';

/** Tom do indicador. `unknown` não chega a ser mostrado, logo não tem tom próprio. */
function toneOf(state: string): StateTone {
  switch (state) {
    case 'overdue':
      return 'danger';
    case 'due':
    case 'soon':
      return 'warn';
    default:
      return 'ok';
  }
}

export interface VehicleState {
  state: string;
  label: string;
  tone: StateTone;
}

/**
 * Estado geral por veículo.
 *
 * Devolve uma entrada **apenas** para os veículos que têm pelo menos um lembrete avaliável.
 * Um veículo sem lembretes não tem estado geral — e mostrar-lhe «Em dia» seria afirmar que
 * está tudo tratado quando o Zemlo não sabe sequer se há alguma coisa a tratar. A ausência
 * é a resposta honesta, e quem chama não desenha o indicador.
 *
 * Um veículo cujos lembretes sejam **todos** `unknown` também não entra: há lembretes, mas
 * nenhum deles produz um estado. Mostrar «Sem dados» num cartão é ruído sem utilidade.
 */
export function vehicleStates(reminders: readonly Reminder[]): Map<string, VehicleState> {
  const worst = new Map<string, string>();

  for (const reminder of reminders) {
    const state = reminder.evaluation.state;
    // `unknown` não é um estado: é a ausência dele. Não entra na comparação nem cria
    // entrada própria — se um veículo só tiver lembretes `unknown`, fica sem indicador.
    if (severityOf(state) === 0) continue;
    const current = worst.get(reminder.vehicleId);
    if (current === undefined || severityOf(state) > severityOf(current)) {
      worst.set(reminder.vehicleId, state);
    }
  }

  const result = new Map<string, VehicleState>();
  for (const [vehicleId, state] of worst) {
    result.set(vehicleId, { state, label: labelOf(state), tone: toneOf(state) });
  }
  return result;
}

/** Só para os testes conseguirem nomear o tipo sem o reexportar de `@zemlo/shared`. */
export type { ReminderState };
