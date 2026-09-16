/**
 * Verificação das guardas de configuração.
 *
 * A validação de configuração só tem valor se de facto impedir o arranque com valores
 * inseguros. Este script prova que o faz, em vez de assumir que sim — um guarda que
 * nunca foi testado é uma intenção, não uma proteção.
 *
 * Uso: npx tsx apps/api/scripts/verify-config.ts
 */

interface Scenario {
  label: string;
  env: Record<string, string | undefined>;
  /** `true` quando o arranque deve ser recusado. */
  shouldFail: boolean;
  /**
   * Ignorar o ficheiro `.env` durante este cenário.
   *
   * É necessário para conseguir testar a ausência de uma variável: o repositório tem um
   * `.env` de desenvolvimento com `JWT_SECRET` definido, e sem esta opção a variável
   * nunca estaria realmente em falta. O nome do ficheiro é trocado temporariamente para
   * que o `dotenv` não o encontre.
   */
  ignoreEnvFile?: boolean;
}

const BASE_ENV: Record<string, string> = {
  DATABASE_URL: 'file:./dev.db',
  DATABASE_PROVIDER: 'sqlite',
  PUBLIC_BASE_URL: 'http://127.0.0.1:4000',
};

/** Segredo de desenvolvimento que vive no código — nunca aceitável em produção. */
const DEV_SECRET = 'zemlo-development-only-insecure-secret-do-not-use-in-production';
/** Segredo de desenvolvimento que vive num `.env` local (o caso do repositório). */
const ENV_FILE_DEV_SECRET = 'dev-only-Rk8vQ2mX4tLp9WzYbN3sJ6hF1dG7cA0eU5iO2qT8xVnMwErTyUiOpAsDfGhJk';

const scenarios: Scenario[] = [
  {
    label: 'production sem JWT_SECRET',
    // O `.env` tem de ser ignorado para que a variável fique mesmo em falta.
    ignoreEnvFile: true,
    env: { NODE_ENV: 'production', JWT_SECRET: undefined },
    shouldFail: true,
  },
  {
    label: 'production com um `.env` de desenvolvimento presente, sem JWT_SECRET no ambiente',
    // Comportamento real: o ficheiro `.env` traz `dev-only-…` e o orquestrador não
    // define nada. O servidor tem de recusar arrancar.
    ignoreEnvFile: false,
    env: { NODE_ENV: 'production', JWT_SECRET: undefined },
    shouldFail: true,
  },
  {
    label: 'production com JWT_SECRET de desenvolvimento do próprio código',
    env: { NODE_ENV: 'production', JWT_SECRET: DEV_SECRET },
    shouldFail: true,
  },
  {
    label: 'production com segredo com prefixo "dev-only-" e comprimento suficiente',
    ignoreEnvFile: true,
    env: { NODE_ENV: 'production', JWT_SECRET: ENV_FILE_DEV_SECRET },
    shouldFail: true,
  },
  {
    label: 'production com JWT_SECRET demasiado curto',
    ignoreEnvFile: true,
    env: { NODE_ENV: 'production', JWT_SECRET: 'curto-demais' },
    shouldFail: true,
  },
  {
    label: 'production com JWT_SECRET adequado',
    ignoreEnvFile: true,
    env: {
      NODE_ENV: 'production',
      JWT_SECRET: 'zK3vQ8mX2tLp9WzYbN6sJ4hF1dG7cA0eU5iO2qT8xVnMwEr',
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    },
    shouldFail: false,
  },
  {
    label: 'development sem JWT_SECRET (usa o valor de desenvolvimento)',
    ignoreEnvFile: true,
    env: { NODE_ENV: 'development', JWT_SECRET: undefined },
    shouldFail: false,
  },
  {
    label: 'ENCRYPTION_KEY com comprimento errado',
    ignoreEnvFile: true,
    env: {
      NODE_ENV: 'development',
      JWT_SECRET: 'b'.repeat(48),
      ENCRYPTION_KEY: Buffer.alloc(16, 1).toString('base64'),
    },
    shouldFail: true,
  },
  {
    label: 'ENCRYPTION_KEY válida ativa os segredos',
    ignoreEnvFile: true,
    env: {
      NODE_ENV: 'development',
      JWT_SECRET: 'c'.repeat(48),
      ENCRYPTION_KEY: Buffer.alloc(32, 2).toString('base64'),
    },
    shouldFail: false,
  },
  {
    label: 'DATABASE_PROVIDER inválido',
    ignoreEnvFile: true,
    env: { NODE_ENV: 'development', JWT_SECRET: 'd'.repeat(48), DATABASE_PROVIDER: 'mysql' },
    shouldFail: true,
  },
  {
    label: 'PORT fora do intervalo',
    ignoreEnvFile: true,
    env: { NODE_ENV: 'development', JWT_SECRET: 'e'.repeat(48), PORT: '99999' },
    shouldFail: true,
  },
  {
    label: 'ACCESS_TOKEN_TTL_MINUTES inválido',
    ignoreEnvFile: true,
    env: { NODE_ENV: 'development', JWT_SECRET: 'f'.repeat(48), ACCESS_TOKEN_TTL_MINUTES: 'zero' },
    shouldFail: true,
  },
];

import { existsSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptDir, '..');
const envFile = resolve(apiRoot, '.env');
const parkedEnvFile = resolve(apiRoot, '.env.verify-config-parked');

let passed = 0;
let failed = 0;

console.log('\nVerificação das guardas de configuração\n');

for (const scenario of scenarios) {
  // A configuração é lida no momento da importação, por isso cada cenário precisa de um
  // módulo novo: o parâmetro de consulta aleatório produz um especificador distinto.
  const saved = { ...process.env };

  for (const key of Object.keys(BASE_ENV)) process.env[key] = BASE_ENV[key] as string;

  let envParked = false;
  if (scenario.ignoreEnvFile && existsSync(envFile)) {
    renameSync(envFile, parkedEnvFile);
    envParked = true;
  }

  for (const [key, value] of Object.entries(scenario.env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  let refused = false;
  let message = '';

  try {
    const module = (await import(`../src/core/config.js?scenario=${Math.random()}`)) as {
      config: { auth: { jwtSecret: string }; crypto: { secretsEnabled: boolean }; isProduction: boolean };
    };
    void module.config;
  } catch (error) {
    refused = true;
    message = error instanceof Error ? error.message : String(error);
  } finally {
    if (envParked) renameSync(parkedEnvFile, envFile);
    process.env = saved;
  }

  const correct = refused === scenario.shouldFail;
  if (correct) {
    passed += 1;
    const detail = refused ? `recusado: ${message.slice(0, 80)}` : 'aceite';
    console.log(`  \u001b[32m✓\u001b[0m ${scenario.label} — ${detail}`);
  } else {
    failed += 1;
    const expectation = scenario.shouldFail ? 'devia ser recusado' : 'devia ser aceite';
    console.log(`  \u001b[31m✗\u001b[0m ${scenario.label} — ${expectation}${message ? `: ${message.slice(0, 80)}` : ''}`);
  }
}

console.log(`\n${passed} corretos, ${failed} incorretos\n`);
process.exitCode = failed > 0 ? 1 : 0;
