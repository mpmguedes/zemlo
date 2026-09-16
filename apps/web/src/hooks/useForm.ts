import { useCallback, useMemo, useState } from 'react';
import { fieldErrors } from '../api/errors';

/**
 * Estado de formulário com validação de servidor.
 *
 * Duas responsabilidades, e mais nenhuma:
 *
 *  1. **Manter os valores como texto.** É o que um `<input>` devolve, e converter a meio da
 *     escrita produziria o efeito clássico de a vírgula desaparecer debaixo do dedo. A
 *     conversão para cêntimos, inteiros e decimais acontece na construção do corpo do
 *     pedido, com as funções de `lib/formPayload`.
 *  2. **Reler os erros de campo da API.** Quando um pedido falha com `validation_error`, a
 *     API devolve `fields: [{ path, message }]` e o formulário passa a expor
 *     `fieldError('amountCents')` — de modo a que a mensagem apareça junto ao campo certo
 *     em vez de num aviso genérico no topo.
 *
 * O que **não** faz, deliberadamente: validar antes de submeter. As regras (mínimo de 10
 * caracteres na password, valor diferente de zero, matrícula com 2 a 16 caracteres) vivem
 * nos esquemas Zod do `@zemlo/shared` e são aplicadas pela API. Reimplementá-las aqui seria
 * a forma mais rápida de as ver divergir — e um formulário que recusa um valor que a API
 * aceita é um defeito de confiança.
 */
export interface FormApi<T extends Record<string, string>> {
  values: T;
  setValue: (name: keyof T & string, value: string) => void;
  setValues: (values: T) => void;
  reset: (values?: T) => void;
  /** Erro de um campo, vindo do último pedido falhado. */
  fieldError: (name: string) => string | undefined;
  /** Regista o erro do último pedido, para alimentar os erros por campo. */
  setServerError: (error: unknown) => void;
  /** Limpa os erros por campo (antes de um novo pedido). */
  clearErrors: () => void;
  isSubmitting: boolean;
  setSubmitting: (value: boolean) => void;
}

export function useForm<T extends Record<string, string>>(initial: T): FormApi<T> {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setSubmitting] = useState(false);

  const setValue = useCallback((name: keyof T & string, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
  }, []);

  const reset = useCallback(
    (next?: T) => {
      setValues(next ?? initial);
      setErrors({});
    },
    [initial],
  );

  const setServerError = useCallback((error: unknown) => {
    setErrors(fieldErrors(error));
  }, []);

  const clearErrors = useCallback(() => setErrors({}), []);

  return useMemo<FormApi<T>>(
    () => ({
      values,
      setValue,
      setValues,
      reset,
      fieldError: (name: string) => errors[name],
      setServerError,
      clearErrors,
      isSubmitting,
      setSubmitting,
    }),
    [values, setValue, reset, errors, setServerError, clearErrors, isSubmitting],
  );
}
