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
import { API_BASE_PATH } from '@zemlo/shared';
import { assertBareAddress, assertSingleLine, envelopeAddress } from './email-address.js';

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

/**
 * Valida, no arranque, os valores que o cliente SMTP interpola em linhas do protocolo.
 *
 * A regra de endereçamento vem de `core/email-address.js` — o **mesmo** módulo que o cliente
 * usa ao enviar, não uma cópia — e é aplicada aqui para que uma gralha falhe antes de a API
 * escutar. Sem esta verificação, um `SMTP_FROM` mal formado só se manifestava na primeira
 * entrega: o servidor respondia `555 5.5.2 Syntax error` e o pedido HTTP devolvia `200` na
 * mesma, porque a falha de entrega não propaga para a resposta (§30).
 */
function validateMailConfig(smtpFrom: string, smtpUser: string | null): void {
  try {
    // O valor configurado fica intacto: o nome de apresentação é legítimo no cabeçalho
    // `From:`, e é isso que o destinatário vê. O que se exige é que dele saia um endereço.
    envelopeAddress(smtpFrom, 'SMTP_FROM');

    // Vai cru para o `EHLO`. Uma mudança de linha partiria a linha do comando a meio, e a
    // segunda metade seria lida como um comando novo.
    assertSingleLine(readString('HOSTNAME', 'localhost'), 'HOSTNAME');

    // Sem cabeçalho onde um nome de apresentação caiba: ou é um endereço, ou está errado.
    if (smtpUser !== null) assertBareAddress(smtpUser, 'SMTP_USER');
  } catch (error) {
    // A mensagem da regra já diz qual é a variável e o que está mal; só muda o tipo, para que
    // uma falha de configuração continue a ser um `ConfigError` como todas as outras.
    throw new ConfigError(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Valida, no arranque, a configuração do login federado (`AUTH-002`).
 *
 * A primeira regra é a que mais importa:
 *
 *  1. **Meias credenciais são pior do que nenhumas.** Com `GOOGLE_CLIENT_ID` sem
 *     `GOOGLE_CLIENT_SECRET`, a configuração "existe" para quem a lê e o botão passa a
 *     ter destino — mas o fluxo falha sempre, e falha no fim, depois de o utilizador já
 *     ter escolhido a conta Google e autorizado o acesso. Falhar no arranque é mais
 *     honesto e mais barato de diagnosticar.
 *  2. **O `redirect_uri` tem de ser absoluto e não pode ter query nem fragmento.** A
 *     Google compara-o **literalmente**: um `?` ou um `#` a mais produz
 *     `redirect_uri_mismatch`, que é o erro mais comum deste fluxo e o mais difícil de
 *     diagnosticar, porque a resposta não diz o que está mal. A verificação é feita
 *     sobre a **cadeia crua**, e não sobre o `URL` já analisado: `new URL('https://x/y?')`
 *     devolve `search === ''`, pelo que um `?` solto passaria pela verificação do objeto
 *     e continuaria a ser um erro para a Google.
 *  3. **Em produção, `https`.** O `code` viaja no URL e é uma credencial de uso único.
 *  4. **O emissor é só o emissor.** O `openid-client` compara-o exatamente com o `iss` do
 *     `id_token`; uma barra final a mais produz uma recusa cuja mensagem fala de `iss` e
 *     não da variável que se escreveu.
 *
 * Uma instalação **sem** login federado não é validada: não há fluxo, e o `redirectUri`
 * não chega a ser lido por ninguém.
 */
function validateFederatedLoginConfig(
  clientId: string | null,
  clientSecret: string | null,
  redirectUri: string,
  issuer: string,
  isProduction: boolean,
): void {
  if ((clientId === null) !== (clientSecret === null)) {
    const missing = clientId === null ? 'GOOGLE_CLIENT_ID' : 'GOOGLE_CLIENT_SECRET';
    throw new ConfigError(
      `Login Google mal configurado: falta ${missing}. Define as duas variáveis ou nenhuma — com metade delas o botão aparece na interface e o fluxo falha sempre.`,
    );
  }

  if (clientId === null) return;

  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new ConfigError(`GOOGLE_REDIRECT_URI não é um endereço absoluto: ${redirectUri}`);
  }

  if (redirectUri.includes('?') || redirectUri.includes('#')) {
    throw new ConfigError(
      'GOOGLE_REDIRECT_URI não pode ter query nem fragmento: a Google compara-o literalmente e responde `redirect_uri_mismatch` sem dizer o que está mal.',
    );
  }

  if (isProduction && parsed.protocol !== 'https:') {
    throw new ConfigError(
      `GOOGLE_REDIRECT_URI tem de ser https em produção (tem ${parsed.protocol}). O código de autorização viaja no URL e é uma credencial de uso único.`,
    );
  }

  /*
   * O emissor é comparado **exatamente** com o campo `iss` do `id_token`, pelo
   * `openid-client`. Um valor com barra final a mais — `https://accounts.google.com/`
   * contra `https://accounts.google.com` — produz uma recusa em que a mensagem fala de
   * `iss` e não do que se escreveu na configuração. Apanhá-lo aqui poupa essa caça.
   */
  let issuerUrl: URL;
  try {
    issuerUrl = new URL(issuer);
  } catch {
    throw new ConfigError(`GOOGLE_ISSUER não é um endereço absoluto: ${issuer}`);
  }

  if (issuerUrl.pathname !== '/' || issuer.includes('?') || issuer.includes('#')) {
    throw new ConfigError(
      `GOOGLE_ISSUER tem de ser só o emissor, sem caminho, query nem fragmento: ${issuer}`,
    );
  }

  if (isProduction && issuerUrl.protocol !== 'https:') {
    throw new ConfigError(
      `GOOGLE_ISSUER tem de ser https em produção (tem ${issuerUrl.protocol}). O documento de descoberta e as chaves públicas vêm de lá.`,
    );
  }
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
    /**
     * Pedidos de reenvio de verificação de email, por utilizador, na mesma janela.
     *
     * O valor por omissão é baixo de propósito. O pedido inicial de verificação não passa
     * por aqui — nasce do registo —, portanto este limite só governa o reenvio, que é uma
     * ação manual de quem já está dentro da aplicação. Cinco tentativas em quinze minutos
     * cobrem o uso legítimo com folga (o email demora, a pessoa distrai-se e volta a
     * pedir) e tornam irrelevante o cenário de um cliente em ciclo.
     */
    readonly emailVerificationMaxRequests: number;
  };
  /**
   * Login federado (§29, `AUTH-002`).
   *
   * Só o Google está previsto. O Sign in with Apple exige um identificador de app
   * registado, que só existe quando houver uma app iOS publicada — e não há código que
   * leia as suas credenciais, por isso não existem variáveis para elas. Documentar
   * variáveis que nada consome sugeriria uma funcionalidade inexistente.
   *
   * O `redirectUri` é **configuração**, não derivação. Nunca é construído a partir do
   * cabeçalho `Host` nem de qualquer outro valor do pedido: quem controla o pedido
   * controlaria, nesse caso, o endereço para onde a Google devolve o `code`, e o `code`
   * é uma credencial de uso único. Vem de `GOOGLE_REDIRECT_URI` ou, se essa variável não
   * existir, de `PUBLIC_BASE_URL` — que também é configuração de operação.
   */
  readonly federatedLogin: {
    readonly google: {
      readonly clientId: string;
      readonly clientSecret: string;
      readonly redirectUri: string;
      /**
       * Emissor OIDC. Por omissão `https://accounts.google.com`.
       *
       * Configurável por duas razões concretas, e não por gosto: permite apontar a
       * **staging** a um emissor de ensaio, e é o que torna o fluxo testável — o teste
       * levanta um fornecedor OIDC local com JWKS própria e aponta o serviço para lá. Sem
       * isto, o único emissor testável seria o real, e as validações de assinatura,
       * `iss` e `aud` não seriam provadas a morder.
       */
      readonly issuer: string;
    } | null;
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
  /**
   * Trabalho periódico (`PROD-004`).
   *
   * O Zemlo não tinha nenhum até aqui: o único trabalho que corria sozinho era o que um
   * pedido arrastava consigo. Estes valores existem para que o operador possa **desligar**
   * o agendador numa instalação onde outra coisa o faça (um cron, um contentor de
   * trabalho), em vez de ter de escolher entre duas instâncias a correr o mesmo.
   */
  readonly jobs: {
    /**
     * Intervalo da sincronização de notificações, em minutos.
     *
     * `0` desliga o agendador — e é o valor a usar quando o mesmo trabalho é corrido por
     * fora da API. O máximo de um dia existe para travar um `1440` mal escrito como
     * `1440000`, que deixaria o agendador efetivamente desligado sem ninguém dar por isso.
     */
    readonly notificationSyncIntervalMinutes: number;
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
  const smtpUser = readOptionalString('SMTP_USER');
  const smtpFrom = readString('SMTP_FROM', 'Zemlo <ola@appzemlo.com>');
  const mqttUrl = readOptionalString('HA_MQTT_URL');

  /*
   * Elevado a variável porque o `redirect_uri` do Google deriva dele: a montagem do
   * endereço de retorno tem de acontecer antes de `validateFederatedLoginConfig()` o poder
   * validar, e a validação tem de acontecer antes de a API escutar.
   */
  const publicBaseUrl = readString('PUBLIC_BASE_URL', 'http://127.0.0.1:4000').replace(/\/+$/, '');
  const googleRedirectUri =
    readOptionalString('GOOGLE_REDIRECT_URI') ?? `${publicBaseUrl}${API_BASE_PATH}/auth/google/callback`;
  const googleIssuer = readString('GOOGLE_ISSUER', 'https://accounts.google.com');

  validateMailConfig(smtpFrom, smtpUser);
  validateFederatedLoginConfig(
    googleClientId,
    googleClientSecret,
    googleRedirectUri,
    googleIssuer,
    isProduction,
  );

  return {
    nodeEnv,
    isProduction,
    isTest,
    isDevelopment: nodeEnv === 'development',
    version: readString('npm_package_version', '0.1.0'),
    port: readInt('PORT', 4000, 1, 65_535),
    host: readString('HOST', '127.0.0.1'),
    publicBaseUrl,
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
      emailVerificationMaxRequests: readInt('RATE_LIMIT_EMAIL_VERIFICATION_MAX_REQUESTS', 5, 1, 10_000),
    },
    federatedLogin: {
      google:
        googleClientId && googleClientSecret
          ? {
              clientId: googleClientId,
              clientSecret: googleClientSecret,
              redirectUri: googleRedirectUri,
              issuer: googleIssuer,
            }
          : null,
    },
    email: {
      enabled: smtpHost !== null,
      host: smtpHost,
      port: readInt('SMTP_PORT', 587, 1, 65_535),
      user: smtpUser,
      password: readOptionalString('SMTP_PASSWORD'),
      from: smtpFrom,
    },
    homeAssistant: {
      enabled: mqttUrl !== null,
      mqttUrl,
      username: readOptionalString('HA_MQTT_USERNAME'),
      password: readOptionalString('HA_MQTT_PASSWORD'),
      discoveryPrefix: readString('HA_DISCOVERY_PREFIX', 'homeassistant'),
    },
    jobs: {
      notificationSyncIntervalMinutes: readInt('NOTIFICATIONS_SYNC_INTERVAL_MINUTES', 15, 0, 1440),
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
    /*
     * O endereço de retorno é mostrado de propósito: é o valor que tem de estar registado
     * na consola da Google, e o desencontro entre os dois é a causa mais comum de o fluxo
     * falhar — sem nada no log que o explique. Não é segredo: viaja em cada pedido de
     * autorização, no URL do browser.
     */
    `login Google: ${
      config.federatedLogin.google
        ? `ativo (retorno para ${config.federatedLogin.google.redirectUri})`
        : 'inativo (sem credenciais)'
    }`,
    /*
     * Distingue "sem SMTP" de "SMTP configurado". A recuperação de password existe nos
     * dois casos, mas sem SMTP o link é registado no log em vez de entregue — e quem
     * opera a instalação tem de o saber sem ter de ler o código.
     *
     * O transporte efetivo é registado logo a seguir, por `registerEmailSender()`, que é
     * quem sabe se a entrega está mesmo ligada; esta linha descreve a configuração.
     */
    `email: ${
      config.email.enabled
        ? `SMTP configurado (${config.email.host}:${config.email.port})`
        : 'entrega inativa (sem SMTP) — links de recuperação registados no log'
    }`,
    `Home Assistant: ${config.homeAssistant.enabled ? 'ativo' : 'inativo (sem broker MQTT)'}`,
    /*
     * O agendador é anunciado no arranque porque é a diferença entre "os lembretes
     * avisam" e "os lembretes só avisam se alguém abrir o ecrã" — a única forma de saber
     * qual dos dois está a acontecer sem ler o código. Desligado, diz porquê.
     */
    `agendador: ${
      config.jobs.notificationSyncIntervalMinutes > 0
        ? `notificações a cada ${config.jobs.notificationSyncIntervalMinutes} min`
        : 'desligado (NOTIFICATIONS_SYNC_INTERVAL_MINUTES=0)'
    }`,
  ];
}
