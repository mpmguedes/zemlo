import { todayIn, type CivilDate } from '@zemlo/shared';
import { centsFromInput, numberFromInput } from '../ui/form';
import { DEFAULT_TIME_ZONE } from '../lib/format';

/**
 * Conversão de valores de formulário para o corpo que a API espera.
 *
 * O formulário guarda tudo como texto (é o que um `<input>` devolve); a API quer cêntimos
 * inteiros, decimais e datas civis. A conversão acontece aqui, em funções pequenas e
 * testáveis, em vez de espalhada por cinco ecrãs — e com uma regra importante: **um campo
 * vazio desaparece do corpo** em vez de virar `null` ou `0`.
 *
 * Essa regra não é um detalhe. Enviar `odometerKm: null` num PATCH apaga a quilometragem
 * existente; enviar `amountCents: 0` é recusado pela API com um erro de validação num campo
 * que o utilizador nem tocou. A omissão da chave é o único comportamento correto para
 * "não preenchi isto".
 */

export interface PayloadFieldMap {
  [formField: string]: string;
}

/** Remove chaves com valor `undefined`, mantendo o objeto serializável. */
function compact<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) output[key] = value;
  }
  return output;
}

/** Data civil de hoje no fuso do utilizador; usada como omissão de todos os formulários. */
export function defaultDate(timeZone = DEFAULT_TIME_ZONE): CivilDate {
  return todayIn(timeZone);
}

/** Montante em cêntimos, ou `undefined` quando o campo está vazio ou ainda inválido. */
export function amountOrUndefined(value: string): number | undefined {
  const cents = centsFromInput(value);
  return cents === null ? undefined : cents;
}

/**
 * Montante obrigatório.
 *
 * Devolve `null` — e não `undefined` — quando o campo está vazio ou não é um número, para
 * que quem valida consiga distinguir "não preencheu" de "preencheu e está mal". A API
 * recusaria com a mesma mensagem, mas um pedido recusado é mais lento do que uma resposta
 * imediata no formulário.
 */
export function requiredAmount(value: string): number | null {
  return centsFromInput(value);
}

/** Decimal (litros, kWh), ou `undefined` quando vazio. */
export function decimalOrUndefined(value: string): number | undefined {
  const parsed = numberFromInput(value);
  return parsed === null ? undefined : parsed;
}

/** Inteiro (quilometragem, minutos, meses), arredondado. */
export function integerOrUndefined(value: string): number | undefined {
  const parsed = numberFromInput(value);
  return parsed === null ? undefined : Math.round(parsed);
}

/** Texto limpo, ou `undefined` quando vazio (nunca uma cadeia vazia). */
export function textOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Data civil, ou `undefined` quando vazia. */
export function dateOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Booleano a partir de uma caixa de seleção. */
export function booleanOrUndefined(value: boolean | undefined): boolean | undefined {
  return value;
}

export { compact };
