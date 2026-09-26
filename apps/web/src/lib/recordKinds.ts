import { RECORD_KINDS, type RecordKind } from '@zemlo/shared';

/**
 * Navegação e etiquetas dos tipos de registo (§43, §52–54).
 *
 * Vive fora dos componentes pela mesma razão que `lib/tabs.ts`: é a parte da decisão que pode
 * ser **provada sem um DOM**. A navegação pós-gravação (decisão 54) é uma decisão de produto —
 * «para onde vai o utilizador depois de guardar» — e não pode ficar enterrada num `onClick`
 * que nenhum teste consegue observar sem `jsdom` (que o projeto decidiu não ter).
 *
 * ## Porque é que o segmento é o mesmo para a rota web e para o caminho da API
 *
 * `/records/expenses` é, ao mesmo tempo, a rota do ecrã de lista e o caminho do endpoint. Não é
 * coincidência: o ecrã espelha o recurso. O mapa fica aqui **uma vez** e o `fetchRecordDetail`
 * (`api/queries.ts`) consome-o para os tipos que partilha, em vez de repetir a regra
 * `expense → expenses` em dois ficheiros.
 */

/**
 * Segmento de URL de cada tipo de registo.
 *
 * A chave é o **tipo de registo** (`expense`, singular — como o `RECORD_KINDS` do contrato e
 * como a folha de registo rápido o abre); o valor é o segmento **plural** usado na rota e no
 * caminho da API. A irregularidade (`expense` → `expenses`, mas `fuel` → `fuel`) é a razão de
 * ser uma tabela explícita e não uma transformação de texto.
 */
export const RECORD_LIST_SEGMENT: Record<RecordKind, string> = {
  expense: 'expenses',
  fuel: 'fuel',
  charging: 'charging',
  maintenance: 'maintenance',
  odometer: 'odometer',
};

/** Rota da lista de um tipo — para onde a decisão 54 manda o utilizador quando ele já lá estava. */
export function recordListPath(kind: RecordKind): string {
  return `/records/${RECORD_LIST_SEGMENT[kind]}`;
}

/**
 * Rota do detalhe de um registo criado, ou `null` quando esse detalhe **não existe**.
 *
 * O odómetro é o caso `null`: uma leitura vive em `GET /vehicles/:id/odometer` e não tem ecrã
 * de detalhe (`RecordDetailPage` pediria `GET /records/odometer/:id`, que a API não serve). É
 * por isso que a ação «Ver registo» (decisão 52) é omitida nesse tipo em vez de apontar para
 * uma rota que daria 404 — prometer uma página que não existe é pior do que não a oferecer.
 */
export function recordDetailPath(kind: RecordKind, recordId: string | null): string | null {
  if (kind === 'odometer' || !recordId) return null;
  return `/records/${RECORD_LIST_SEGMENT[kind]}/${encodeURIComponent(recordId)}`;
}

/**
 * Etiqueta singular de um tipo («Despesa», «Abastecimento», …).
 *
 * Vem do `RECORD_KINDS` do contrato partilhado — a mesma fonte que a folha usa para o título —
 * para que o toast e o seletor não tenham um segundo vocabulário que divergiria do primeiro.
 */
export function recordKindLabel(kind: RecordKind): string {
  return RECORD_KINDS.find((item) => item.code === kind)?.label ?? 'Registo';
}
