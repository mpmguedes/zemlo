/**
 * Middlewares da API.
 *
 * Ordem de aplicação, e porquê (importa — cada um depende do anterior):
 *  1. `requestContext` — identificador do pedido e IP, usados por tudo o resto;
 *  2. `securityHeaders` — cabeçalhos de segurança;
 *  3. `cors` — só depois de sabermos a origem;
 *  4. `rateLimit` — antes de qualquer trabalho dispendioso;
 *  5. `parseJson` — corpo do pedido;
 *  6. rotas;
 *  7. `notFoundHandler`;
 *  8. `errorHandler`.
 */

import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import type { ApiErrorBody } from '@zemlo/shared';
import { todayIn } from '@zemlo/shared';
import { config } from '../core/config.js';
import { AppError, isAppError, translatePrismaError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { authenticateAccessToken } from '../services/auth.js';
import { extractBearerToken } from '../services/tokens.js';

/* -------------------------------------------------------------------------- */
/* Contexto do pedido                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Atribui um identificador a cada pedido e normaliza os metadados.
 *
 * O identificador aparece na resposta de erro e nos logs: quando um utilizador
 * reporta um problema, este valor é o que permite encontrar exatamente o pedido no
 * servidor, sem pedir mais nada (§56).
 */
export function requestContext() {
  return (request: Request, response: Response, next: NextFunction): void => {
    request.requestId = randomUUID();
    response.setHeader('X-Request-Id', request.requestId);
    response.setHeader('X-Zemlo-Api-Version', 'v1');

    // `trust proxy` está ativo atrás do Cloudflare Tunnel (§36): o IP real vem no
    // cabeçalho `CF-Connecting-IP`, e não no socket.
    const forwarded = request.headers['cf-connecting-ip'] ?? request.headers['x-forwarded-for'];
    const ipAddress =
      typeof forwarded === 'string'
        ? (forwarded.split(',')[0]?.trim() ?? null)
        : (request.socket.remoteAddress ?? null);

    request.meta = {
      ipAddress,
      userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
      // Fuso por omissão: Portugal. Um utilizador com fuso próprio é corrigido
      // depois de autenticado, na camada de negócio.
      timeZone: 'Europe/Lisbon',
    };

    const started = process.hrtime.bigint();
    response.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      const level = response.statusCode >= 500 ? 'error' : response.statusCode >= 400 ? 'warn' : 'info';
      logger[level]('pedido', {
        requestId: request.requestId,
        method: request.method,
        // O caminho é registado sem a query string: parâmetros de pesquisa podem
        // conter dados pessoais e não são necessários para diagnosticar.
        path: request.path,
        status: response.statusCode,
        durationMs: Math.round(durationMs),
        userId: request.user?.id ?? null,
      });
    });

    next();
  };
}

/* -------------------------------------------------------------------------- */
/* Cabeçalhos de segurança                                                     */
/* -------------------------------------------------------------------------- */

export function securityHeaders() {
  return helmet({
    // A API não serve HTML; a política de conteúdo que o Helmet aplica por omissão
    // não é relevante e só adiciona ruído a cada resposta.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
    // HSTS só em produção: em desenvolvimento o acesso é por HTTP e o cabeçalho
    // deixaria o browser a tentar HTTPS contra um servidor que não o tem.
    hsts: config.isProduction
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: false }
      : false,
  });
}

/* -------------------------------------------------------------------------- */
/* CORS                                                                        */
/* -------------------------------------------------------------------------- */

export function corsMiddleware() {
  const allowed = new Set(config.cors.origins);

  return cors({
    origin(origin, callback) {
      // Pedidos sem origem (apps nativas, curl, Home Assistant) são permitidos:
      // não há um contexto de browser que possa ser abusado por CSRF.
      if (!origin) return callback(null, true);
      if (config.cors.allowAllInDevelopment || allowed.has(origin)) return callback(null, true);
      // Recusar sem erro: uma origem não autorizada recebe a resposta sem os
      // cabeçalhos CORS, e o browser bloqueia-a. Lançar um erro produziria 500s nos
      // logs por uma situação perfeitamente normal.
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'X-Zemlo-Client'],
    exposedHeaders: ['X-Request-Id', 'X-Zemlo-Api-Version', 'X-RateLimit-Remaining', 'Retry-After'],
    maxAge: 86_400,
  });
}

/* -------------------------------------------------------------------------- */
/* Limitação de abuso (§30)                                                    */
/* -------------------------------------------------------------------------- */

export function generalRateLimit() {
  return rateLimit({
    windowMs: config.rateLimit.windowMinutes * 60_000,
    limit: config.rateLimit.maxRequests,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Em testes, a limitação tornaria os testes não determinísticos.
    skip: () => config.isTest,
    handler: (_request, response) => {
      response.status(429).json({
        error: {
          code: 'rate_limited',
          message: 'Demasiados pedidos. Tenta novamente dentro de momentos.',
        },
      } satisfies ApiErrorBody);
    },
  });
}

/**
 * Limitação mais apertada nas rotas de autenticação.
 *
 * Uma tentativa de login é a operação mais atrativa para um ataque automatizado, e a
 * mais barata de limitar. O limite é por IP **e** por email, para que um atacante não
 * consiga contornar o limite mudando de IP contra a mesma conta.
 */
export function authRateLimit() {
  return rateLimit({
    windowMs: config.rateLimit.windowMinutes * 60_000,
    limit: config.rateLimit.authMaxRequests,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => config.isTest,
    keyGenerator: (request) => {
      const email = typeof request.body?.email === 'string' ? request.body.email.toLowerCase() : '';
      const ip = request.meta?.ipAddress ?? request.socket.remoteAddress ?? 'desconhecido';
      return `${ip}:${email}`;
    },
    handler: (_request, response) => {
      response
        .status(429)
        .setHeader('Retry-After', String(config.rateLimit.windowMinutes * 60))
        .json({
          error: {
            code: 'rate_limited',
            message:
              'Demasiadas tentativas. Por segurança, espera alguns minutos antes de tentar novamente.',
          },
        } satisfies ApiErrorBody);
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Corpo do pedido                                                             */
/* -------------------------------------------------------------------------- */

export function jsonBodyParser() {
  // 1 MB é suficiente para qualquer pedido da API. Documentos são referenciados por
  // `storageKey`, não enviados no corpo (§17).
  return express.json({ limit: '1mb', type: ['application/json', 'application/*+json'] });
}

/**
 * Recusa corpos que não são JSON, em vez de os tratar como vazios.
 *
 * Porque é necessário: o `express.json` só processa os tipos de conteúdo da sua lista.
 * Com qualquer outro — ou sem `Content-Type` — deixa `request.body` por definir, e a
 * validação responde "este campo é obrigatório" para todos os campos. O cliente enviou os
 * campos; o que não enviou foi o cabeçalho correto. Essa mensagem engana quem está a
 * integrar a API e custa uma hora de diagnóstico por nada.
 *
 * Aplica-se apenas aos métodos que transportam corpo: um `GET` com `Content-Type` textual
 * é perfeitamente válido e não deve ser recusado.
 */
export function requireJsonBody() {
  return (request: Request, _response: Response, next: NextFunction): void => {
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'DELETE') {
      next();
      return;
    }

    const hasBody =
      request.headers['content-length'] !== undefined && request.headers['content-length'] !== '0';
    if (!hasBody && request.headers['transfer-encoding'] === undefined) {
      next();
      return;
    }

    const contentType = request.headers['content-type'];
    const isJson =
      typeof contentType === 'string' &&
      (contentType.includes('application/json') || contentType.includes('application/*+json'));

    if (!isJson) {
      next(
        new AppError(
          415,
          'validation_error',
          'O corpo do pedido tem de ser enviado como JSON, com o cabeçalho Content-Type: application/json.',
        ),
      );
      return;
    }

    next();
  };
}

export function urlEncodedParser() {
  return express.urlencoded({ extended: false, limit: '256kb' });
}

/* -------------------------------------------------------------------------- */
/* Autenticação                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Autenticação **opcional**: identifica o utilizador quando há um token válido e
 * segue em frente quando não há.
 *
 * Estar separado de `requireAuth` permite que rotas públicas (registo, login, saúde)
 * vivam no mesmo router e que uma rota futura possa comportar-se de forma diferente
 * para utilizadores autenticados, sem duplicar a lógica de validação do token.
 */
export function optionalAuth() {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      next();
      return;
    }

    void authenticateAccessToken(token)
      .then((user) => {
        request.user = user;
        request.meta.timeZone = user.timeZone;
        next();
      })
      .catch(() => {
        // Token inválido ou expirado: seguir como anónimo. `requireAuth` decide.
        next();
      });
  };
}

/** Exige um utilizador autenticado. */
export function requireAuth() {
  return (request: Request, _response: Response, next: NextFunction): void => {
    if (!request.user) {
      next(new AppError(401, 'unauthorized', 'Precisas de iniciar sessão para continuar.'));
      return;
    }
    next();
  };
}

/* -------------------------------------------------------------------------- */
/* Erros                                                                       */
/* -------------------------------------------------------------------------- */

export function notFoundHandler() {
  return (request: Request, response: Response): void => {
    response.status(404).json({
      error: {
        code: 'not_found',
        message: 'Este endereço não existe na API do Zemlo.',
        requestId: request.requestId,
      },
    } satisfies ApiErrorBody);
  };
}

/**
 * Middleware de erros.
 *
 * Contrato: **todo** o erro sai no envelope `{ error: { code, message, fields? } }`.
 * Erros conhecidos (`AppError`) preservam a mensagem, escrita para o utilizador. Erros
 * desconhecidos são registados com detalhe e respondidos com uma mensagem genérica —
 * a stack trace e a mensagem do Prisma ficam no servidor (§30).
 */
export function errorHandler() {
  return (error: unknown, request: Request, response: Response, _next: NextFunction): void => {
    const requestId = request.requestId;

    // Corpo JSON malformado: o `express.json` lança um erro com `type`.
    if (typeof error === 'object' && error !== null && (error as { type?: string }).type === 'entity.parse.failed') {
      response.status(400).json({
        error: { code: 'validation_error', message: 'O corpo do pedido não é JSON válido.', requestId },
      } satisfies ApiErrorBody);
      return;
    }

    if (typeof error === 'object' && error !== null && (error as { type?: string }).type === 'entity.too.large') {
      response.status(413).json({
        error: { code: 'payload_too_large', message: 'O pedido é demasiado grande.', requestId },
      } satisfies ApiErrorBody);
      return;
    }

    const appError = isAppError(error)
      ? error
      : isPrismaLike(error)
        ? translatePrismaError(error, `${request.method} ${request.path}`)
        : null;

    if (appError) {
      const body: ApiErrorBody = {
        error: {
          code: appError.code,
          message: appError.message,
          ...(appError.fields ? { fields: appError.fields } : {}),
          requestId,
        },
      };

      // Erros de negócio são registados a `warn`: são normais e não exigem ação. Erros
      // internos a `error`, com o detalhe que não vai para o cliente.
      if (appError.status >= 500) {
        logger.error('erro interno', { requestId, code: appError.code, error, details: appError.details });
      } else {
        logger.warn('erro de negócio', {
          requestId,
          code: appError.code,
          status: appError.status,
          path: request.path,
        });
      }

      response.status(appError.status).json(body);
      return;
    }

    logger.error('erro não tratado', { requestId, method: request.method, path: request.path, error });
    response.status(500).json({
      error: {
        code: 'internal_error',
        message: 'Algo não correu como esperado do nosso lado. Já registámos o problema.',
        requestId,
      },
    } satisfies ApiErrorBody);
  };
}

function isPrismaLike(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    (error as { code: string }).code.startsWith('P')
  );
}

/* -------------------------------------------------------------------------- */
/* Cache                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Desativa cache nas respostas autenticadas.
 *
 * Sem isto, um proxy intermédio poderia servir os dados de um utilizador a outro. É um
 * cabeçalho, não uma otimização, e por isso não é negociável.
 */
export function noStore() {
  return (_request: Request, response: Response, next: NextFunction): void => {
    response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    response.setHeader('Pragma', 'no-cache');
    next();
  };
}

/** Data de hoje no fuso do pedido, para uso nos handlers. */
export function today(request: Request): string {
  return todayIn(request.meta.timeZone);
}
