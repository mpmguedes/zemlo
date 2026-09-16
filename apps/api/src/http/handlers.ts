/**
 * Camada HTTP: tipos, validadores e envolventes de handlers.
 *
 * O objetivo desta camada é ser **chata e previsível**. Toda a validação de entrada
 * acontece aqui (com os esquemas Zod de `@zemlo/shared`, o que garante que o contrato
 * documentado é exatamente o contrato aplicado), e todos os handlers devolvem dados de
 * domínio — nunca objetos de pedido ou de base de dados.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodSchema, ZodTypeDef } from 'zod';
import type { AuthenticatedUser } from '../services/auth.js';
import { validationFailed } from '../core/errors.js';

/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Extensão do pedido                                                          */
/* -------------------------------------------------------------------------- */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Utilizador autenticado; presente apenas depois de `requireAuth`. */
      user?: AuthenticatedUser;
      /** Identificador do pedido, para correlacionar logs e respostas de erro (§56). */
      requestId: string;
      /** Metadados do pedido, normalizados uma única vez. */
      meta: {
        ipAddress: string | null;
        userAgent: string | null;
        timeZone: string;
      };
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Handlers assíncronos                                                        */
/* -------------------------------------------------------------------------- */

type AsyncHandler = (request: Request, response: Response, next: NextFunction) => Promise<unknown> | unknown;

/**
 * Envolve um handler assíncrono.
 *
 * O Express 4 não apanha rejeições de promessas: sem isto, um `await` que falha
 * deixa o pedido pendurado até ao timeout em vez de chegar ao middleware de erros.
 * Uma linha aqui evita uma classe inteira de defeitos intermitentes difíceis de
 * diagnosticar.
 */
export function asyncHandler(handler: AsyncHandler): RequestHandler {
  return (request, response, next) => {
    void Promise.resolve(handler(request, response, next)).catch(next);
  };
}

/* -------------------------------------------------------------------------- */
/* Validação                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Valida e devolve o corpo do pedido.
 *
 * Devolve o valor tipado em vez de escrever em `request.body`: assim o handler tem o
 * tipo inferido do esquema, sem `as` nem confiança cega no conteúdo do pedido.
 */
export function parseBody<T>(schema: ZodSchema<T, ZodTypeDef, unknown>, request: Request): T {
  const result = schema.safeParse(request.body);
  if (!result.success) {
    throw validationFailed(formatZodIssues(result.error.issues));
  }
  return result.data;
}

/** Valida e devolve a query string do pedido, com coerção de tipos. */
export function parseQuery<T>(schema: ZodSchema<T, ZodTypeDef, unknown>, request: Request): T {
  const result = schema.safeParse(request.query);
  if (!result.success) {
    throw validationFailed(formatZodIssues(result.error.issues));
  }
  return result.data;
}

/** Valida e devolve os parâmetros de rota. */
export function parseParams<T>(schema: ZodSchema<T, ZodTypeDef, unknown>, request: Request): T {
  const result = schema.safeParse(request.params);
  if (!result.success) {
    throw validationFailed(formatZodIssues(result.error.issues));
  }
  return result.data;
}

/**
 * Converte problemas do Zod em mensagens de campo.
 *
 * Os caminhos são achatados (`body.items[0].date`) porque é isso que o cliente precisa
 * para apontar o erro ao campo certo num formulário, mesmo em estruturas aninhadas.
 */
function formatZodIssues(issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>): Array<{ path: string; message: string }> {
  return issues.map((issue) => ({
    path: issue.path.length === 0 ? 'body' : issue.path.join('.'),
    message: translateMessage(issue.message),
  }));
}

/**
 * Tradução de mensagens por omissão do Zod.
 *
 * O utilizador lê estas mensagens (§59). "Required" não é português, e "Invalid input"
 * não diz o que fazer.
 */
function translateMessage(message: string): string {
  const translations: Record<string, string> = {
    Required: 'Este campo é obrigatório.',
    'Invalid input': 'O valor indicado não é válido.',
    'Expected number, received string': 'Indica um número.',
    'Expected string, received number': 'Indica um texto.',
    'Expected boolean, received string': 'Indica sim ou não.',
    'Invalid date': 'A data não é válida.',
    'String must contain at least 1 character(s)': 'Este campo não pode ficar vazio.',
  };
  return translations[message] ?? message;
}

/* -------------------------------------------------------------------------- */
/* Autenticação                                                                */
/* -------------------------------------------------------------------------- */

/** Devolve o utilizador autenticado ou lança 401. */
export function requireUser(request: Request): AuthenticatedUser {
  if (!request.user) {
    // Não deveria acontecer: `requireAuth` corre antes. Falhar de forma explícita é
    // melhor do que propagar um `undefined` até ao serviço.
    throw validationFailed([{ path: 'authorization', message: 'Sessão em falta.' }]);
  }
  return request.user;
}

/* -------------------------------------------------------------------------- */
/* Respostas                                                                   */
/* -------------------------------------------------------------------------- */

/** Resposta criada (201) com cabeçalho `Location`. */
export function created(response: Response, location: string, body: unknown): void {
  response.status(201).location(location).json(body);
}

/** Resposta sem conteúdo (204). */
export function noContent(response: Response): void {
  response.status(204).end();
}
