import { ApiError } from './client';

/**
 * Tradução de erros para o que o ecrã precisa de mostrar.
 *
 * A regra de tom (§59) é aplicada aqui: informativo, nunca alarmista, nunca infantil. Um
 * erro de validação devolve a mensagem da API — que já vem em português e no tom certo —
 * e só quando não há envelope é que se usa uma frase de recurso.
 */

/** Mensagem principal a apresentar ao utilizador. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) {
    // Erros de programação (TypeError, etc.) não devem chegar ao utilizador com a stack;
    // a mensagem genérica é preferível a expor detalhes internos.
    return 'Não foi possível concluir o pedido. Tenta novamente.';
  }
  return 'Ocorreu um erro inesperado.';
}

/** Identificador de pedido, para o utilizador citar no apoio ao cliente (§56). */
export function errorRequestId(error: unknown): string | null {
  return error instanceof ApiError ? error.requestId : null;
}

/**
 * Mapa de erros por campo, pronto a passar aos formulários.
 *
 * As chaves do mapa são caminhos da API (`amountCents`, `litres`, `vehicle.year`). Os
 * formulários usam os mesmos nomes dos campos do contrato, de propósito: um formulário
 * que renomeasse `amountCents` para `valor` obrigaria a uma tabela de tradução — e essa
 * tabela seria o primeiro sítio a ficar desatualizado quando o contrato mudasse.
 */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  const map: Record<string, string> = {};
  for (const field of error.fields) {
    // O primeiro erro de um campo é o que se mostra: dois avisos sobre o mesmo campo
    // confundem mais do que ajudam.
    if (!(field.path in map)) map[field.path] = field.message;
  }
  return map;
}

/**
 * Erros de campo de um ramo específico, sem o prefixo.
 *
 * A API devolve caminhos aninhados (`derived.0.value`) quando o corpo tem objetos. Os
 * formulários da aplicação são planos, mas normalizar o prefixo evita que um erro deixe
 * de aparecer por causa de um nível a mais.
 */
export function fieldErrorsFor(error: unknown, prefix: string): Record<string, string> {
  const all = fieldErrors(error);
  const scoped: Record<string, string> = {};
  for (const [path, message] of Object.entries(all)) {
    if (path === prefix) scoped[prefix] = message;
    else if (path.startsWith(`${prefix}.`)) scoped[path.slice(prefix.length + 1)] = message;
  }
  return scoped;
}

/** `true` quando o erro já foi apresentado campo a campo e não precisa de aviso geral. */
export function hasOnlyFieldErrors(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'validation_error' && error.fields.length > 0;
}
