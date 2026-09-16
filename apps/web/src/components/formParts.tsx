import { useMemo } from 'react';
import {
  EXPENSE_CATEGORIES,
  FUEL_TYPES,
  MAINTENANCE_TYPES,
  optionLabel,
  type ExpenseCategory,
  type MaintenanceType,
  type OptionSet,
} from '@zemlo/shared';
import { DateField, MoneyField, NumberField, SelectField, TextAreaField, TextField, useFormState } from '../ui/form';
import { CheckboxField } from '../ui/form';

/**
 * Peças de formulário partilhadas pelas folhas de registo rápido.
 *
 * Estão juntas porque descrevem a mesma decisão repetida quatro vezes: **como escolher uma
 * categoria de despesa com o polegar**. A grelha de opções é mais lenta de ler do que uma
 * lista, mas muito mais rápida de tocar — e num registo que se faz ao lado do carro, o
 * toque é a operação crítica (§44).
 */

/**
 * Seletor de categoria de despesa.
 *
 * Quando o utilizador tem categorias frequentes guardadas nas preferências (§45), essas
 * aparecem primeiro, marcadas com um ponto. A ordenação do registo partilhado mantém-se
 * para o resto — a ordem de importância do produto não é substituída pela do utilizador,
 * é apenas antecipada onde ele já mostrou o que usa.
 */
export function CategoryPicker({
  value,
  onChange,
  frequent = [],
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  frequent?: string[];
  error?: string;
}) {
  const ordered = useMemo(() => {
    if (frequent.length === 0) return EXPENSE_CATEGORIES;
    const rank = new Map(frequent.map((code, index) => [code, index]));
    return [...EXPENSE_CATEGORIES].sort((a, b) => {
      const aRank = rank.get(a.code) ?? Number.POSITIVE_INFINITY;
      const bRank = rank.get(b.code) ?? Number.POSITIVE_INFINITY;
      if (aRank !== bRank) return aRank - bRank;
      return a.order - b.order;
    });
  }, [frequent]);

  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
      <legend className="z-field__label" style={{ padding: 0, marginBottom: 'var(--z-space-2)' }}>
        Categoria
      </legend>
      {/*
        `aria-pressed` em botões, e não um `<select>`: são poucos itens, todos visíveis, e a
        escolha é única. Um `<select>` abriria um diálogo do sistema para escolher entre
        catorze opções — três vezes mais lento.
      */}
      <div className="z-option-grid" role="group" aria-label="Categoria da despesa">
        {ordered.map((category) => (
          <button
            key={category.code}
            type="button"
            className="z-option"
            aria-pressed={value === category.code}
            onClick={() => onChange(category.code)}
          >
            <span className="z-option__icon" aria-hidden="true">
              {category.icon}
            </span>
            {category.label}
          </button>
        ))}
      </div>
      {error ? (
        <span className="z-field__error" role="alert" style={{ display: 'block', marginTop: 'var(--z-space-1)' }}>
          {error}
        </span>
      ) : null}
    </fieldset>
  );
}

/** Seletor de tipo de manutenção, com o mesmo padrão da categoria de despesa. */
export function MaintenanceTypePicker({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: MaintenanceType) => void;
  error?: string;
}) {
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
      <legend className="z-field__label" style={{ padding: 0, marginBottom: 'var(--z-space-2)' }}>
        Tipo de intervenção
      </legend>
      <div className="z-option-grid" role="group" aria-label="Tipo de intervenção">
        {MAINTENANCE_TYPES.map((type) => (
          <button
            key={type.code}
            type="button"
            className="z-option"
            aria-pressed={value === type.code}
            onClick={() => onChange(type.code as MaintenanceType)}
          >
            <span className="z-option__icon" aria-hidden="true">
              {type.icon}
            </span>
            {type.label}
          </button>
        ))}
      </div>
      {error ? <span className="z-field__error" role="alert" style={{ display: 'block', marginTop: 'var(--z-space-1)' }}>{error}</span> : null}
    </fieldset>
  );
}

/**
 * Coberturas de seguro aceites pela API (`zInsuranceCreateRequest`).
 *
 * Está declarada aqui, e não no `@zemlo/shared`, porque o registo partilhado **não** a
 * exporta: ao contrário das categorias de despesa e dos tipos de manutenção, a cobertura é
 * um `z.enum` inline no contrato, sem `label` nem `icon` associados. Criar uma tabela nova
 * no pacote partilhado seria a decisão acertada — e fica anotada no relatório desta tarefa
 * como lacuna encontrada —, mas duplicar o registo inteiro para quatro valores era pior do
 * que os declarar junto do único ecrã que os usa.
 *
 * Os **códigos têm de coincidir** com o enum da API; se um mudar, o servidor recusa com
 * `validation_error` e o formulário mostra a mensagem junto ao campo, o que torna a
 * divergência visível em vez de silenciosa.
 */
export const COVERAGE_OPTIONS = [
  { code: 'third_party', label: 'Responsabilidade civil', icon: '🛡️', order: 10 },
  { code: 'third_party_fire_theft', label: 'Contra terceiros, incêndio e roubo', icon: '🛡️', order: 20 },
  { code: 'comprehensive', label: 'Danos próprios', icon: '🛡️', order: 30 },
  { code: 'other', label: 'Outra', icon: '🛡️', order: 999 },
] as const satisfies OptionSet;

/** Códigos aceites, para pré-visualização e validação local. */
export type CoverageCode = (typeof COVERAGE_OPTIONS)[number]['code'];

/**
 * Etiqueta de um tipo de combustível.
 *
 * Usa `optionLabel` do registo partilhado, que devolve o próprio código quando o valor é
 * desconhecido — comportamento correto quando a API acrescentar um tipo novo e a web ainda
 * não tiver sido publicada: o utilizador vê `hydrogen` em vez de um espaço em branco.
 */
export function fuelTypeLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return optionLabel(FUEL_TYPES, code);
}

export {
  CheckboxField,
  DateField,
  MoneyField,
  NumberField,
  SelectField,
  TextAreaField,
  TextField,
  useFormState,
};
export type { ExpenseCategory };
