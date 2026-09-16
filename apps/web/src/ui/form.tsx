import {
  useCallback,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { formatCents, parseCents, formatKm, toCents } from '@zemlo/shared';
import { ApiError } from '../api/client';
import { Button } from './primitives';

/**
 * Campos de formulário.
 *
 * Todos partilham três decisões:
 *
 *  - o `id` é gerado por `useId`, para que ligar `<label>` a `<input>` nunca dependa de um
 *    nome escrito à mão que se repete quando o mesmo formulário aparece duas vezes no ecrã;
 *  - o erro é anunciado com `aria-describedby` e `aria-invalid`, e não apenas pintado de
 *    vermelho — quem usa leitor de ecrã tem de saber que o campo está errado *e* porquê;
 *  - um campo de erro mostra **um** erro. Dois avisos sobre o mesmo campo fazem o
 *    utilizador corrigir um e descobrir que continua errado.
 */

interface FieldShellProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: (ids: { inputId: string; describedBy: string | undefined }) => ReactNode;
}

export function Field({ label, hint, error, required, children }: FieldShellProps) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className="z-field">
      <label className="z-field__label" htmlFor={inputId}>
        {label}
        {required ? (
          <span className="z-field__required" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
      </label>
      {children({ inputId, describedBy })}
      {hint ? (
        <span className="z-field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="z-field__error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function TextField({
  label,
  hint,
  error,
  required,
  ...input
}: { label: string; hint?: ReactNode; error?: string; required?: boolean } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'className'
>) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {({ inputId, describedBy }) => (
        <input
          {...input}
          id={inputId}
          className="z-input"
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
        />
      )}
    </Field>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  required,
  ...textarea
}: { label: string; hint?: ReactNode; error?: string; required?: boolean } & Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'className'
>) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {({ inputId, describedBy }) => (
        <textarea
          {...textarea}
          id={inputId}
          className="z-textarea"
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
        />
      )}
    </Field>
  );
}

export interface Option {
  value: string;
  label: string;
}

export function SelectField({
  label,
  hint,
  error,
  required,
  options,
  placeholder,
  ...select
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  options: readonly Option[];
  placeholder?: string;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'children'>) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {({ inputId, describedBy }) => (
        <select
          {...select}
          id={inputId}
          className="z-select"
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
        >
          {placeholder ? <option value="">{placeholder}</option> : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/* -------------------------------------------------------------------------- */
/* Campos com unidade                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Campo monetário.
 *
 * O valor circula como **texto** dentro do formulário e só se converte em cêntimos no
 * momento de gravar. Guardar o estado como número obrigaria a decidir o que fazer com
 * "12," a meio da escrita — e essa decisão ou apagava a vírgula debaixo do dedo do
 * utilizador ou mostrava um número diferente do que ele escreveu.
 *
 * A aceitação é deliberadamente larga: `12`, `12,5`, `12.50`, `1 234,56 €` — as quatro
 * formas que uma pessoa escreve num telemóvel português. A conversão usa `parseCents` do
 * domínio partilhado, para que a web e a API nunca discordem sobre o que é um cêntimo.
 */
export function MoneyField({
  label,
  hint,
  error,
  required,
  value,
  onChange,
  placeholder = '0,00',
  autoFocus,
  name,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  name?: string;
}) {
  const parsed = centsFromInput(value);
  return (
    <Field
      label={label}
      hint={hint ?? (parsed !== null ? formatCents(parsed) : undefined)}
      error={error}
      required={required}
    >
      {({ inputId, describedBy }) => (
        <div className="z-input-group">
          <input
            id={inputId}
            name={name}
            className="z-input"
            // `inputMode="decimal"` abre o teclado numérico no telemóvel com a vírgula
            // disponível — é a diferença entre escrever um valor em três toques e em
            // cinco (§44).
            inputMode="decimal"
            autoComplete="off"
            placeholder={placeholder}
            value={value}
            autoFocus={autoFocus}
            onChange={(event) => onChange(event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
          />
          <span className="z-input-group__suffix">€</span>
        </div>
      )}
    </Field>
  );
}

/**
 * Converte o texto de um campo monetário em cêntimos.
 *
 * `null` quando ainda não é um valor: um campo vazio, ou a meio de uma escrita ("12,").
 * Devolver `0` nesse caso daria a entender que o valor é zero — e a validação do valor
 * zero é da API, não do campo.
 */
export function centsFromInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return parseCents(trimmed);
  } catch {
    return null;
  }
}

/** Campo numérico com unidade no sufixo (km, kWh, L, minutos…). */
export function NumberField({
  label,
  hint,
  error,
  required,
  value,
  onChange,
  suffix,
  step,
  min,
  max,
  placeholder,
  autoFocus,
  name,
  disabled,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  step?: string;
  min?: number;
  max?: number;
  placeholder?: string;
  autoFocus?: boolean;
  name?: string;
  /** Desativado quando o campo não faz sentido para o gatilho escolhido (ex.: km com «por tempo»). */
  disabled?: boolean;
}) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {({ inputId, describedBy }) => (
        <div className="z-input-group">
          <input
            id={inputId}
            name={name}
            className="z-input"
            inputMode="decimal"
            autoComplete="off"
            value={value}
            step={step}
            min={min}
            max={max}
            disabled={disabled}
            placeholder={placeholder}
            autoFocus={autoFocus}
            onChange={(event) => onChange(event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
          />
          {suffix ? <span className="z-input-group__suffix">{suffix}</span> : null}
        </div>
      )}
    </Field>
  );
}

/**
 * Converte o texto de um campo numérico decimal.
 *
 * Aceita vírgula ou ponto, e também o espaço de milhares (`43 560`), porque é assim que a
 * informação aparece na própria interface. `null` para texto que ainda não é um número.
 */
export function numberFromInput(value: string): number | null {
  const cleaned = value.trim().replace(/\s/g, '').replace(',', '.');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Campo de data civil (`YYYY-MM-DD`), com o seletor nativo do sistema. */
export function DateField({
  label,
  hint,
  error,
  required,
  ...input
}: { label: string; hint?: ReactNode; error?: string; required?: boolean } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'className' | 'type'
>) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {({ inputId, describedBy }) => (
        <input
          {...input}
          id={inputId}
          type="date"
          className="z-input"
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
        />
      )}
    </Field>
  );
}

/** Caixa de seleção com etiqueta clicável de altura suficiente para o polegar. */
export function CheckboxField({
  label,
  checked,
  onChange,
  hint,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: ReactNode;
}) {
  return (
    <label className="z-checkbox">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <span className="z-strong">{label}</span>
        {hint ? <span className="z-option__hint z-xs z-muted" style={{ display: 'block' }}>{hint}</span> : null}
      </span>
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Erro de formulário                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Resumo do erro de uma gravação.
 *
 * Mostra a mensagem da API e, quando existe, o `requestId`. Se o erro for apenas de
 * campos (`validation_error` com `fields`), o resumo desaparece: cada mensagem já está
 * junto ao campo respetivo, e repeti-la no topo é ruído.
 */
export function FormError({ error }: { error: unknown }) {
  if (!error) return null;

  if (error instanceof ApiError) {
    if (error.code === 'validation_error' && error.fields.length > 0) return null;
    return (
      <div className="z-inline-error" role="alert">
        <span>{error.message}</span>
        {error.requestId ? (
          <span className="z-request-id">Referência para apoio: {error.requestId}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="z-inline-error" role="alert">
      <span>Não foi possível guardar. Tenta novamente.</span>
    </div>
  );
}

/**
 * Rodapé de uma folha modal com ação primária e secundária.
 *
 * Recebe `onCancel` em vez de desenhar os botões no chamador para que a ordem seja sempre
 * a mesma em toda a aplicação: cancelar à esquerda, avançar à direita. Inverter a ordem
 * num ecrã obriga o utilizador a ler antes de tocar — e é assim que se apaga o que não se
 * queria.
 */
export function SheetActions({
  onCancel,
  submitLabel,
  pending,
  disabled,
  type = 'submit',
}: {
  onCancel: () => void;
  submitLabel: string;
  pending?: boolean;
  disabled?: boolean;
  type?: 'submit' | 'button';
}) {
  return (
    <div className="z-sheet__footer">
      <Button variant="secondary" onClick={onCancel} disabled={pending}>
        Cancelar
      </Button>
      <Button type={type} variant="primary" loading={pending} disabled={disabled}>
        {submitLabel}
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Estado de formulário                                                        */
/* -------------------------------------------------------------------------- */

export type FormValues = Record<string, string>;

/**
 * Estado de um formulário simples, em texto.
 *
 * Todos os valores são `string` porque é isso que os campos manipulam; a conversão para
 * os tipos do contrato acontece numa função `toPayload` escrita no ecrã, onde a regra de
 * negócio é visível. Um formulário genérico com esquema de validação traria uma biblioteca
 * — e a aplicação não a tem, nem deve ter.
 */
export function useFormState<T extends FormValues>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const [touched, setTouched] = useState(false);

  const setValue = useCallback((name: keyof T & string, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
  }, []);

  const reset = useCallback(
    (next: T = initial) => {
      setValues(next);
      setTouched(false);
    },
    [initial],
  );

  return { values, setValue, setValues, reset, touched, setTouched };
}

/* -------------------------------------------------------------------------- */
/* Formatação de apoio aos formulários                                         */
/* -------------------------------------------------------------------------- */

/**
 * Valor inicial de um campo monetário a partir de cêntimos.
 *
 * Escreve o número com vírgula (`184,50`) e não com ponto: o utilizador português vê
 * vírgula nos talões, e um campo que mostrasse `184.50` pareceria estar noutro idioma.
 */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return formatCentsPlainLocal(cents);
}

function formatCentsPlainLocal(cents: number): string {
  const euros = cents / 100;
  const fixed = (Math.round(euros * 100) / 100).toFixed(2);
  return fixed.replace('.', ',');
}

/** Texto de quilometragem para pré-preencher um campo (`43 560`). */
export function kmToInput(km: number | null | undefined): string {
  return km === null || km === undefined ? '' : formatKm(km, 0);
}

/** Converte um número em cêntimos a partir de um valor decimal (`184.5` → `18450`). */
export function decimalToCents(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return toCents(value);
}
