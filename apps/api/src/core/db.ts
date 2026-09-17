/**
 * Cliente Prisma — fachada estável para o resto da aplicação.
 *
 * Toda a aplicação importa `prisma` daqui e nunca de `@prisma/client`. A escolha do
 * cliente concreto (PostgreSQL ou SQLite) e a validação de coerência com a configuração
 * vivem em `core/prisma-client.ts`; este ficheiro expõe o resultado e as operações
 * transversais.
 *
 * ## Porque é que o cliente deixou de vir de `@prisma/client`
 *
 * `@prisma/client` resolve para `node_modules/.prisma/client`, um caminho **partilhado**
 * pelos dois schemas. Enquanto os dois geravam para lá, o último a correr ganhava — e a
 * produção escrevia em SQLite com `DATABASE_URL` a apontar para PostgreSQL. Importar de
 * um caminho explícito por motor torna a escolha inequívoca; ver `core/prisma-client.ts`.
 */

import { config } from './config.js';
import { logger } from './logger.js';
import { activeProvider, prisma } from './prisma-client.js';

export { prisma, activeProvider };
export { Prisma } from './prisma-client.js';
export type { PrismaClient, ActiveProvider } from './prisma-client.js';

/** Mede a latência da base de dados, para o endpoint de saúde (§56). */
export async function checkDatabase(): Promise<{ reachable: boolean; latencyMs: number | null }> {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { reachable: true, latencyMs: Date.now() - started };
  } catch (error) {
    logger.error('A base de dados não respondeu', { error, provider: activeProvider });
    return { reachable: false, latencyMs: null };
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

/** Descrição do motor ativo para os logs de arranque. */
export function describeDatabase(): string {
  const engine = activeProvider === 'postgresql' ? 'PostgreSQL' : 'SQLite (ficheiro local)';
  const target = activeProvider === 'postgresql' ? maskUrl(config.database.url) : config.database.url;
  return `${engine} — ${target}`;
}

/**
 * Esconde a password de uma cadeia de ligação antes de a escrever num log.
 *
 * Um log de arranque é o sítio mais provável para uma credencial acabar copiada para um
 * ticket de suporte ou para o histórico de uma pipeline.
 */
function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return '(cadeia de ligação ilegível)';
  }
}
