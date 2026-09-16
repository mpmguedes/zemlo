/**
 * Erros da aplicação.
 *
 * Um único tipo de erro conhecido (`AppError`) atravessa a API e é traduzido para o
 * envelope documentado em `@zemlo/shared/types`. Tudo o resto é um defeito e vira
 * `internal_error` com um identificador de pedido — nunca com uma stack trace (§30).
 *
 * Nota de tom (§59): as mensagens são escritas para serem lidas pelo utilizador.
 * "Falta apenas o seguro deste veículo." em vez de "ERRO: validação falhou".
 */

import type { ApiErrorCode } from '@zemlo/shared';

export interface FieldIssue {
  path: string;
  message: string;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly fields?: FieldIssue[];
  /** Detalhes internos, registados nos logs mas nunca enviados ao cliente. */
  readonly details?: unknown;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    options: { fields?: FieldIssue[]; details?: unknown; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (options.fields) this.fields = options.fields;
    if (options.details !== undefined) this.details = options.details;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/* -------------------------------------------------------------------------- */
/* Construtores                                                                */
/* -------------------------------------------------------------------------- */

export const badRequest = (message: string, fields?: FieldIssue[]): AppError =>
  new AppError(400, 'validation_error', message, fields ? { fields } : {});

export const validationFailed = (fields: FieldIssue[], message = 'Há campos a corrigir.'): AppError =>
  new AppError(422, 'validation_error', message, { fields });

export const unauthorized = (message = 'Precisas de iniciar sessão para continuar.'): AppError =>
  new AppError(401, 'unauthorized', message);

export const forbidden = (message = 'Não tens acesso a este recurso.'): AppError =>
  new AppError(403, 'forbidden', message);

export const notFound = (message = 'Não encontrámos o que procuras.'): AppError =>
  new AppError(404, 'not_found', message);

export const conflict = (message: string, details?: unknown): AppError =>
  new AppError(409, 'conflict', message, details === undefined ? {} : { details });

export const unprocessable = (message: string, details?: unknown): AppError =>
  new AppError(422, 'unprocessable', message, details === undefined ? {} : { details });

export const tooManyRequests = (message = 'Demasiados pedidos. Tenta novamente dentro de momentos.'): AppError =>
  new AppError(429, 'rate_limited', message);

export const serviceUnavailable = (message: string, details?: unknown): AppError =>
  new AppError(503, 'service_unavailable', message, details === undefined ? {} : { details });

export const internal = (message = 'Algo não correu como esperado do nosso lado.', details?: unknown): AppError =>
  new AppError(500, 'internal_error', message, details === undefined ? {} : { details });

/* -------------------------------------------------------------------------- */
/* Utilitários                                                                 */
/* -------------------------------------------------------------------------- */

/** Erros do Prisma que correspondem a um estado de negócio, não a um defeito. */
export function isPrismaKnownError(error: unknown): error is { code: string; meta?: Record<string, unknown> } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    (error as { code: string }).code.startsWith('P')
  );
}

/**
 * Traduz erros conhecidos do Prisma para erros de produto.
 * `P2002` é violação de unicidade — no Zemlo significa quase sempre
 * "já tens um veículo com esta matrícula".
 */
export function translatePrismaError(error: unknown, context: string): AppError {
  if (isPrismaKnownError(error)) {
    switch (error.code) {
      case 'P2002': {
        const target = Array.isArray(error.meta?.target)
          ? (error.meta?.target as string[]).join(', ')
          : String(error.meta?.target ?? '');
        if (target.includes('plate')) {
          return conflict('Já tens um veículo registado com esta matrícula.');
        }
        if (target.includes('email')) {
          return conflict('Já existe uma conta com este email.');
        }
        return conflict('Este registo já existe.');
      }
      case 'P2025':
        return notFound();
      case 'P2003':
        return badRequest('A referência indicada não existe.');
      case 'P2000':
        return badRequest('Um dos valores é demasiado longo.');
      default:
        return internal(`Não foi possível concluir a operação (${context}).`, { prismaCode: error.code });
    }
  }
  return internal(`Não foi possível concluir a operação (${context}).`, { cause: String(error) });
}

/** `true` quando o erro é um `AppError` — ou seja, um erro de negócio esperado. */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
