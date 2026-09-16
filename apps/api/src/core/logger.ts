/**
 * Registo estruturado (§56).
 *
 * Sem dependências externas: um logger JSON de uma página é suficiente para o
 * volume do Zemlo e evita uma dependência com histórico de vulnerabilidades na
 * base de todos os pedidos. A saída é JSON em staging/produção (consumível por
 * qualquer coletor) e legível em desenvolvimento.
 *
 * Regra de privacidade (§31): o logger **não** aceita dados pessoais diretamente.
 * `redact` remove emails, matrículas, tokens e coordenadas de qualquer objeto
 * registado, para que um log de diagnóstico nunca se transforme numa fuga de dados.
 */

import { config } from './config.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const MIN_LEVEL: LogLevel = (() => {
  const configured = config.logging.level;
  return configured in LEVEL_WEIGHT ? configured : 'info';
})();

export interface LogContext {
  [key: string]: unknown;
}

/** Chaves cujo valor nunca sai do processo. */
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'token',
  'accessToken',
  'refreshToken',
  'refreshTokenHash',
  'tokenHash',
  'authorization',
  'cookie',
  'secret',
  'totp',
  'twoFactorSecret',
  'recoveryCodes',
  'recoveryCodeHashes',
  'credentials',
  'apiKey',
  'clientSecret',
  'privateKey',
  'encryptionKey',
]);

/** Chaves de dados pessoais: registadas de forma reduzida, nunca em claro. */
const PERSONAL_KEYS = new Set(['email', 'plate', 'plateDisplay', 'vin', 'ipAddress', 'userAgent', 'latitude', 'longitude']);

const REDACTED = '[redigido]';

function maskEmail(value: string): string {
  const [local, domain] = value.split('@');
  if (!domain || !local) return REDACTED;
  const visible = local.slice(0, 1);
  return `${visible}${'*'.repeat(Math.max(1, local.length - 1))}@${domain}`;
}

function maskPlate(value: string): string {
  if (value.length <= 2) return REDACTED;
  return `${'*'.repeat(value.length - 2)}${value.slice(-2)}`;
}

function maskIp(value: string): string {
  if (value.includes(':')) {
    // IPv6: manter apenas o prefixo de rede.
    const groups = value.split(':');
    return `${groups.slice(0, 3).join(':')}::`;
  }
  const parts = value.split('.');
  if (parts.length !== 4) return REDACTED;
  return `${parts[0]}.${parts[1]}.x.x`;
}

function scrub(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 6) return '[demasiado profundo]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message, code: (value as { code?: string }).code };
  }
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    const limit = 50;
    const mapped = value.slice(0, limit).map((item) => scrub(item, depth + 1, seen));
    if (value.length > limit) mapped.push(`… e mais ${value.length - limit}`);
    return mapped;
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) {
      output[key] = REDACTED;
      continue;
    }
    if (PERSONAL_KEYS.has(key) && typeof item === 'string') {
      output[key] =
        key === 'email'
          ? maskEmail(item)
          : key === 'ipAddress'
            ? maskIp(item)
            : key === 'userAgent'
              ? item.slice(0, 60)
              : maskPlate(item);
      continue;
    }
    output[key] = scrub(item, depth + 1, seen);
  }
  return output;
}

function write(level: LogLevel, message: string, context?: LogContext): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[MIN_LEVEL]) return;

  const timestamp = new Date().toISOString();
  const payload = {
    time: timestamp,
    level,
    message,
    ...(context ? (scrub(context) as LogContext) : {}),
  };

  const line = config.logging.pretty
    ? formatPretty(timestamp, level, message, payload)
    : JSON.stringify(payload);

  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

function formatPretty(timestamp: string, level: LogLevel, message: string, payload: LogContext): string {
  const time = timestamp.slice(11, 23);
  const badge = level.toUpperCase().padEnd(5);
  const extras = { ...payload };
  delete extras.time;
  delete extras.level;
  delete extras.message;
  const keys = Object.keys(extras);
  const suffix = keys.length > 0 ? ` ${JSON.stringify(extras)}` : '';
  return `${time} ${badge} ${message}${suffix}`;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** Cria um logger com contexto fixo (ex.: `requestId`, `userId`). */
  child(context: LogContext): Logger;
}

export function createLogger(baseContext: LogContext = {}): Logger {
  const merge = (context?: LogContext): LogContext => ({ ...baseContext, ...context });
  return {
    debug: (message, context) => write('debug', message, merge(context)),
    info: (message, context) => write('info', message, merge(context)),
    warn: (message, context) => write('warn', message, merge(context)),
    error: (message, context) => write('error', message, merge(context)),
    child: (context) => createLogger(merge(context)),
  };
}

export const logger = createLogger({ service: 'zemlo-api', version: config.version });
