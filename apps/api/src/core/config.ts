/**
 * Configuração da API.
 *
 * Carregada uma única vez no arranque e validada de forma explícita. A regra é
 * simples: **falhar no arranque, não em produção**. Um valor em falta ou mal
 * formado que só se manifeste quando o primeiro utilizador faz login é um defeito
 * de operação, não um caso de erro de negócio (§30, §56).
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotEnv } from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, '..', '..');

/*
 * Carregar `.env` da pasta da API (desenvolvimento) e da raiz do monorepo, se existirem.
 *
 * `override: false` é essencial e não é o comportamento por omissão do dotenv: sem isto,
 * um ficheiro `.env` presente no servidor sobreporia o ambiente injetado pelo
 * orquestrador. O resultado seria um servidor de produção a correr com `NODE_ENV` e
 * `JWT_SECRET` de desenvolvimento, sem qualquer aviso — precisamente o cenário que as
 * validações abaixo existem para impedir. Variáveis reais ganham sempre ao ficheiro.
 */
for (const candidate of [resolve(apiRoot, '.env'), resolve(apiRoot, '..', '..', '.env')]) {
  if (existsSync(candidate)) loadDotEnv({ path: candidate, override: false });
}

export type NodeEnvironment = 'development' | 'test' | 'staging' | 'production';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function readString(key: string, fallback?: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    if (fallback !== undefined) return fallback;
    throw new ConfigError(`Variável de ambiente obrigatória em falta: ${key}`);
  }
  return value;
}

function readOptionalString(key: string): string | null {
  const value = process.env[key];
  return value === undefined || value === '' ? null : value;
}

function readInt(key: string, fallback: number, min: number, max: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new ConfigError(`${key} deve ser um inteiro entre ${min} e ${max} (recebido: ${raw})`);
  }
  return parsed;
}

function readBoolean(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function readList(key: string, fallback: string[]): string[] {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const nodeEnv = readString('NODE_ENV', 'development') as NodeEnvironment;
const isProduction = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

/**
 * Segredo usado quando não há nenhum configurado fora de produção.
 *
 * O valor é reconhecível de propósito: se alguma vez aparecer numa instalação de
 * produção, é imediatamente identificável como um erro de configuração e não como um
 * segredo legítimo que alguém esqueceu de rodar.
 */
const DEV_JWT_FALLBACK = 'zemlo-development-only-insecure-secret-do-not-use-in-production';

/**
 * Prefixo dos segredos de desenvolvimento que vivem em `.env` locais.
 *
 * Um ficheiro `.env` de desenvolvimento que chegue a um servidor de produção é um
 * cenário realista — basta copiar o diretório, ou montar um volume com a pasta do
 * projeto. Sem esta verificação, o servidor arrancaria alegremente com um segredo que
 * está num repositório Git, e todos os tokens emitidos seriam forjáveis por qualquer
 * pessoa que lesse o código.
 */
const DEV_SECRET_PREFIX = 'dev-only-';

const MIN_PRODUCTION_SECRET_LENGTH = 32;

function readJwtSecret(): string {
  const value = readOptionalString('JWT_SECRET');

  if (value === null) {
    if (isProduction) {
      throw new ConfigError(
        'JWT_SECRET é obrigatório em produção. Gera um com: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
      );
    }
    return DEV_JWT_FALLBACK;
  }

  if (isProduction) {
    if (value.startsWith(DEV_SECRET_PREFIX)) {
      throw new ConfigError(
        'JWT_SECRET começa por "dev-only-": é um segredo de desenvolvimento e não pode ser usado em produção. Gera um novo com: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
      );
    }
    if (value === DEV_JWT_FALLBACK || value.length < MIN_PRODUCTION_SECRET_LENGTH) {
      throw new ConfigError(
        `JWT_SECRET em produção deve ser um valor aleatório com pelo menos ${MIN_PRODUCTION_SECRET_LENGTH} caracteres.`,
      );
    }
  }

  return value;
}

function readEncryptionKey(): Buffer | null {
  const raw = readOptionalString('ENCRYPTION_KEY');
  if (raw === null) return null;
  let buffer: Buffer;
  try {
    buffer = Buffer.from(raw, 'base64');
  } catch {
    throw new ConfigError('ENCRYPTION_KEY deve estar codificada em base64.');
  }
  if (buffer.length !== 32) {
    throw new ConfigError(
      `ENCRYPTION_KEY deve ter exatamente 32 bytes (tem ${buffer.length}). Gera uma com: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  return buffer;
}

const databaseProvider: 'sqlite' | 'postgresql' = readString('DATABASE_PROVIDER', 'sqlite') as
  | 'sqlite'
  | 'postgresql';
if (databaseProvider !== 'sqlite' && databaseProvider !== 'postgresql') {
  throw new ConfigError(`DATABASE_PROVIDER deve ser "sqlite" ou "postgresql" (recebido: ${databaseProvider})`);
}

export interface AppConfig {
  readonly nodeEnv: NodeEnvironment;
  readonly isProduction: boolean;
  readonly isTest: boolean;
  readonly isDevelopment: boolean;
  readonly version: string;
  readonly port: number;
  readonly host: string;
  readonly publicBaseUrl: string;
  readonly database: {
    readonly url: string;
    readonly provider: 'sqlite' | 'postgresql';
  };
  readonly auth: {
    readonly jwtSecret: string;
    readonly accessTokenTtlMinutes: number;
    readonly sessionTtlDays: number;
    /** Custo do bcrypt. 12 é o valor recomendado em 2026 para servidores modestos. */
    readonly bcryptRounds: number;
  };
  readonly crypto: {
    readonly encryptionKey: Buffer | null;
    /** `true` quando é possível guardar segredos cifrados (2FA, integrações). */
    readonly secretsEnabled: boolean;
  };
  readonly cors: {
    readonly origins: string[];
    readonly allowAllInDevelopment: boolean;
  };
  readonly rateLimit: {
    readonly windowMinutes: number;
    readonly maxRequests: number;
    readonly authMaxRequests: number;
  };
  /**
   * Login federado (§29).
   *
   * Só o Google está implementado. O Sign in with Apple exige um identificador de app
   * registado, que só existe quando houver uma app iOS publicada — e não há código que
   * leia as suas credenciais, por isso não existem variáveis para elas. Documentar
   * variáveis que nada consome sugeriria uma funcionalidade inexistente.
   */
  readonly federatedLogin: {
    readonly google: { clientId: string; clientSecret: string } | null;
  };
  readonly email: {
    readonly enabled: boolean;
    readonly host: string | null;
    readonly port: number;
    readonly user: string | null;
    readonly password: string | null;
    readonly from: string;
  };
  readonly homeAssistant: {
    readonly enabled: boolean;
    readonly mqttUrl: string | null;
    readonly username: string | null;
    readonly password: string | null;
    readonly discoveryPrefix: string;
  };
  readonly logging: {
    readonly level: 'debug' | 'info' | 'warn' | 'error';
    readonly pretty: boolean;
  };
}

function build(): AppConfig {
  const encryptionKey = readEncryptionKey();
  const googleClientId = readOptionalString('GOOGLE_CLIENT_ID');
  const googleClientSecret = readOptionalString('GOOGLE_CLIENT_SECRET');
  const smtpHost = readOptionalString('SMTP_HOST');
  const mqttUrl = readOptionalString('HA_MQTT_URL');

  return {
    nodeEnv,
    isProduction,
    isTest,
    isDevelopment: nodeEnv === 'development',
    version: readString('npm_package_version', '0.1.0'),
    port: readInt('PORT', 4000, 1, 65_535),
    host: readString('HOST', '127.0.0.1'),
    publicBaseUrl: readString('PUBLIC_BASE_URL', 'http://127.0.0.1:4000').replace(/\/+$/, ''),
    database: {
      url: readString('DATABASE_URL', 'file:./dev.db'),
      provider: databaseProvider,
    },
    auth: {
      jwtSecret: readJwtSecret(),
      accessTokenTtlMinutes: readInt('ACCESS_TOKEN_TTL_MINUTES', 60, 1, 10_080),
      sessionTtlDays: readInt('SESSION_TTL_DAYS', 90, 1, 3650),
      bcryptRounds: readInt('BCRYPT_ROUNDS', isTest ? 4 : 12, 4, 15),
    },
    crypto: {
      encryptionKey,
      secretsEnabled: encryptionKey !== null,
    },
    cors: {
      origins: readList('CORS_ORIGINS', ['http://localhost:5173', 'http://127.0.0.1:5173']),
      allowAllInDevelopment: readBoolean('CORS_ALLOW_ALL', nodeEnv === 'development'),
    },
    rateLimit: {
      windowMinutes: readInt('RATE_LIMIT_WINDOW_MINUTES', 15, 1, 1440),
      maxRequests: readInt('RATE_LIMIT_MAX_REQUESTS', 600, 10, 1_000_000),
      authMaxRequests: readInt('RATE_LIMIT_AUTH_MAX_REQUESTS', 20, 1, 10_000),
    },
    federatedLogin: {
      google:
        googleClientId && googleClientSecret
          ? { clientId: googleClientId, clientSecret: googleClientSecret }
          : null,
    },
    email: {
      enabled: smtpHost !== null,
      host: smtpHost,
      port: readInt('SMTP_PORT', 587, 1, 65_535),
      user: readOptionalString('SMTP_USER'),
      password: readOptionalString('SMTP_PASSWORD'),
      from: readString('SMTP_FROM', 'Zemlo <ola@appzemlo.com>'),
    },
    homeAssistant: {
      enabled: mqttUrl !== null,
      mqttUrl,
      username: readOptionalString('HA_MQTT_USERNAME'),
      password: readOptionalString('HA_MQTT_PASSWORD'),
      discoveryPrefix: readString('HA_DISCOVERY_PREFIX', 'homeassistant'),
    },
    logging: {
      level: readString('LOG_LEVEL', isTest ? 'error' : 'info') as AppConfig['logging']['level'],
      pretty: readBoolean('LOG_PRETTY', !isProduction),
    },
  };
}

export const config: AppConfig = build();

/** Resumo seguro da configuração para os logs de arranque. Nunca inclui segredos. */
export function describeConfig(): string[] {
  return [
    `ambiente: ${config.nodeEnv}`,
    `base de dados: ${config.database.provider}`,
    `escuta: http://${config.host}:${config.port}`,
    `origens CORS: ${config.cors.allowAllInDevelopment ? 'todas (desenvolvimento)' : config.cors.origins.join(', ')}`,
    `segredos cifrados: ${config.crypto.secretsEnabled ? 'ativos (2FA disponível)' : 'desativados (define ENCRYPTION_KEY)'}`,
    `login Google: ${config.federatedLogin.google ? 'ativo' : 'inativo (sem credenciais)'}`,
    `email: ${config.email.enabled ? 'ativo' : 'inativo (sem SMTP)'}`,
    `Home Assistant: ${config.homeAssistant.enabled ? 'ativo' : 'inativo (sem broker MQTT)'}`,
  ];
}
