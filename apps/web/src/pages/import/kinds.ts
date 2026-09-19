import type { RecordKind } from '../../api/queries';

/**
 * Os tipos de registo que um CSV pode conter, com o rótulo que o utilizador lê.
 *
 * ## Porque é que esta lista não vem do `REGISTRY`
 *
 * O `RECORD_KINDS` do registry descreve os cinco tipos que um utilizador pode registar à mão
 * a partir do ecrã de um veículo (despesa, abastecimento, carregamento, manutenção,
 * quilometragem). Um ficheiro CSV pode trazer mais: uma apólice de seguro, uma inspeção, um
 * imposto, um documento, um lembrete. Se a escolha do tipo fosse gerada a partir do registry,
 * esses tipos seriam impossíveis de escolher num ficheiro que só tenha, por exemplo, uma
 * coluna de «Prémio» e outra de «Seguradora» — e a importação ficaria sem saída.
 *
 * ## Porque é que a ordem é esta
 *
 * A lista segue os tipos **mais frequentes** num ficheiro exportado de outra aplicação: os
 * abastecimentos e as despesas são a esmagadora maioria do que as pessoas têm para migrar. Um
 * tipo que aparece em segundo lugar é um clique mais rápido do que um que aparece em décimo,
 * e não custa nada a quem procura um tipo raro.
 *
 * O separador entre os dois grupos é explícito (`group`), porque a diferença é real: os
 * primeiros são os que o Zemlo trata como registos do dia-a-dia, os últimos são os que
 * tendem a ser documentos com validade.
 */
export interface KindOption {
  kind: RecordKind;
  label: string;
  hint: string;
  group: 'uso' | 'documento';
}

const OPTIONS: readonly KindOption[] = Object.freeze([
  {
    kind: 'fuel',
    label: 'Abastecimentos',
    hint: 'Data, valor e litros — com ou sem quilometragem.',
    group: 'uso',
  },
  {
    kind: 'expense',
    label: 'Despesas',
    hint: 'Data, valor e categoria (portagens, lavagens, pneus…).',
    group: 'uso',
  },
  {
    kind: 'maintenance',
    label: 'Manutenções',
    hint: 'Data, valor e oficina ou tipo de intervenção.',
    group: 'uso',
  },
  {
    kind: 'charging',
    label: 'Carregamentos',
    hint: 'Data, valor e energia em kWh.',
    group: 'uso',
  },
  {
    kind: 'odometer',
    label: 'Leituras de quilometragem',
    hint: 'Data e quilómetros, sem valor.',
    group: 'uso',
  },
  {
    kind: 'vehicle',
    label: 'Veículos',
    hint: 'Matrícula, marca, modelo e ano.',
    group: 'uso',
  },
  {
    kind: 'insurance',
    label: 'Seguros',
    hint: 'Apólice, seguradora, prémio e validade.',
    group: 'documento',
  },
  {
    kind: 'inspection',
    label: 'Inspeções',
    hint: 'Data, resultado e próxima inspeção.',
    group: 'documento',
  },
  {
    kind: 'tax',
    label: 'Impostos',
    hint: 'Data limite e montante (IUC).',
    group: 'documento',
  },
  {
    kind: 'document',
    label: 'Documentos',
    hint: 'Título, nome do ficheiro e validade.',
    group: 'documento',
  },
  {
    kind: 'reminder',
    label: 'Lembretes',
    hint: 'Título, data de início e intervalo.',
    group: 'documento',
  },
] as readonly KindOption[]);

/*
 * A lista é validada contra o que o servidor consegue construir.
 *
 * O `CSV_SUPPORTED_KINDS` que o servidor exporta não está disponível no pacote partilhado, e
 * duplicá-lo aqui seria uma segunda fonte de verdade a divergir. Em vez disso, o teste que
 * acompanha este ficheiro fixa a lista, e o ecrã nunca envia um tipo que o servidor não
 * conhece — a API recusa-o com uma mensagem sobre o tipo, que o utilizador veria como um
 * erro incompreensível. A lista é curta e muda raramente; um teste é suficiente.
 */
export function recordKindOptions(): KindOption[] {
  return [...OPTIONS];
}

/** O rótulo de um tipo, para o passo do tipo e para o relatório. */
export function kindOptionLabel(kind: RecordKind | null): string {
  if (kind === null) return 'Registos';
  return OPTIONS.find((option) => option.kind === kind)?.label ?? kind;
}
