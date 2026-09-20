import { ApiError } from '../../api/client';

/**
 * Tradução dos erros dos dois ecrãs de recuperação.
 *
 * ## Porque é que isto não usa `errorMessage()` como os outros ecrãs
 *
 * `errorMessage()` devolve a mensagem da API tal como vem — e na esmagadora maioria dos
 * ecrãs é a decisão certa, porque a API escreve em português e no tom do produto (§59).
 * Aqui não, por duas razões concretas:
 *
 *  1. **A validação da password é feita por Zod no servidor, e o `path` é o nome do campo
 *     no contrato.** Medido, e não suposto: `newPassword` com 5 caracteres produz
 *     `fields: [{ path: 'newPassword', message: 'String must contain at least 10
 *     character(s)' }]` — a mensagem por omissão do Zod, em inglês, com um plural entre
 *     parênteses que não é português. Mostrá-la a quem está a repor a password seria pior
 *     do que não dizer nada. Este módulo dá-lhe a frase que a pessoa precisa de ler.
 *  2. **O formulário não pode depender do `path` de um campo aninhado.** O `useForm`
 *     indexa erros por nome de campo; o contrato usa `newPassword` enquanto o ecrã tem
 *     `password` e `confirm` (dois campos para um valor). Mapear aqui é mais honesto do
 *     que renomear o ecrã para agradar ao contrato.
 *
 * O `requestId` continua a ser mostrado quando existe: é o que permite ao utilizador citar
 * um pedido exato no apoio. O que **não** é mostrado é qualquer detalhe interno — o
 * `message` cru do Zod, nomes de tabelas, ou a distinção entre "expirou", "já foi usado" e
 * "nunca existiu", que a API não faz de propósito.
 */

/** Normaliza o `path` do erro: `newPassword` e `newPassword.0.x` contam como o mesmo campo. */
function rootPath(path: string): string {
  const [head] = path.split('.');
  return head ?? path;
}

/** Campos que o ecrã de definição de nova password alimenta com um só valor. */
const PASSWORD_FIELD_ALIASES = new Set(['newPassword', 'password']);

export interface TranslatedError {
  /** Mensagem principal, já em português e pronta a mostrar. */
  message: string;
  /**
   * Erros por campo, com as chaves do formulário.
   *
   * O `useForm` usa isto via `setServerError`? Não — este mapa existe porque a tradução
   * tem de acontecer **antes** de chegar ao formulário, e o `useForm` só sabe ler o que a
   * API devolveu. Ver `applyTranslatedErrors`.
   */
  fields: Record<string, string>;
  requestId: string | null;
}

/**
 * Erro de rede: o pedido não chegou a sair, ou a resposta não voltou.
 *
 * Vale a pena distinguir de todos os outros porque a ação do utilizador é diferente —
 * "verifica a ligação" em vez de "corrige o campo". O código `network_error` é atribuído
 * pelo cliente HTTP, não pela API.
 */
function isNetworkError(error: ApiError): boolean {
  return error.code === 'network_error' || error.status === 0;
}

/** Mensagem única para todos os motivos pelos quais um link não serve. */
const TOKEN_REJECTED =
  'Este link de recuperação já não é válido. Pode ter expirado, já ter sido usado, ou ' +
  'ter sido substituído por um pedido mais recente. Pede um link novo para continuar.';

export function translateRequestResetError(error: unknown): TranslatedError {
  if (!(error instanceof ApiError)) {
    return {
      message: 'Não foi possível enviar o pedido. Verifica a ligação e tenta novamente.',
      fields: {},
      requestId: null,
    };
  }

  if (isNetworkError(error)) {
    return {
      message: 'Não foi possível contactar o servidor. Verifica a ligação e tenta novamente.',
      fields: {},
      requestId: null,
    };
  }

  if (error.status === 429) {
    return {
      message:
        'Foram feitos demasiados pedidos de recuperação seguidos. Espera alguns minutos ' +
        'antes de tentar outra vez — os pedidos anteriores continuam válidos.',
      fields: {},
      requestId: error.requestId,
    };
  }

  const fields: Record<string, string> = {};
  for (const field of error.fields) {
    if (rootPath(field.path) === 'email') {
      fields.email = 'Este endereço não parece um email válido. Confirma-o e tenta novamente.';
    }
  }

  return {
    message: Object.keys(fields).length > 0
      ? 'Confirma o endereço de email.'
      : error.message,
    fields,
    requestId: error.requestId,
  };
}

export function translateConfirmResetError(error: unknown): TranslatedError {
  if (!(error instanceof ApiError)) {
    return {
      message: 'Não foi possível alterar a password. Verifica a ligação e tenta novamente.',
      fields: {},
      requestId: null,
    };
  }

  if (isNetworkError(error)) {
    return {
      message: 'Não foi possível contactar o servidor. Verifica a ligação e tenta novamente.',
      fields: {},
      requestId: null,
    };
  }

  /*
   * Todos os motivos de recusa do token chegam como 401 com a mesma mensagem — é
   * deliberado na API, e o ecrã respeita-o: não tenta distinguir expirado de já usado. A
   * ação que resolve os três é a mesma, e é essa que se apresenta.
   */
  if (error.status === 401) {
    return { message: TOKEN_REJECTED, fields: {}, requestId: error.requestId };
  }

  if (error.status === 429) {
    return {
      message:
        'Demasiadas tentativas seguidas. Espera alguns minutos antes de tentar novamente.',
      fields: {},
      requestId: error.requestId,
    };
  }

  const fields: Record<string, string> = {};
  for (const field of error.fields) {
    if (PASSWORD_FIELD_ALIASES.has(rootPath(field.path))) {
      fields.password = 'A password não cumpre os requisitos: pelo menos 10 caracteres, sem espaços no início nem no fim.';
    } else if (rootPath(field.path) === 'token') {
      // Um token que não passa a validação de forma é, para o utilizador, um link truncado
      // ou adulterado. Mesma frase e mesma saída: pedir um novo.
      fields.token = TOKEN_REJECTED;
    }
  }

  return {
    // Quando há erro de campo, a mensagem geral não repete a mesma coisa: o utilizador já
    // a vê junto ao campo. Um aviso no topo a dizer "confirma os campos" empurra o erro
    // para longe do sítio onde ele está.
    message: Object.keys(fields).length > 0 ? '' : error.message,
    fields,
    requestId: error.requestId,
  };
}
