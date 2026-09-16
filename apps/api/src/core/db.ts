/**
 * Cliente Prisma.
 *
 * Uma única instância partilhada por todo o processo. O Zemlo corre como um serviço
 * Node normal (não serverless), por isso o problema clássico de esgotar o pool em
 * recargas de módulos não se coloca — mas o singleton continua a ser a forma correta,
 * porque os testes precisam de o poder substituir e encerrar.
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { config } from './config.js';
import { logger } from './logger.js';

/** Nível de registo do Prisma: em testes silenciamos para manter a saída legível. */
const logLevels: Prisma.LogLevel[] = config.isTest
  ? []
  : config.isDevelopment
    ? ['warn', 'error']
    : ['error'];

export const prisma = new PrismaClient({
  log: logLevels,
  errorFormat: config.isProduction ? 'minimal' : 'pretty',
});

/** Mede a latência da base de dados, para o endpoint de saúde (§56). */
export async function checkDatabase(): Promise<{ reachable: boolean; latencyMs: number | null }> {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { reachable: true, latencyMs: Date.now() - started };
  } catch (error) {
    logger.error('A base de dados não respondeu', { error });
    return { reachable: false, latencyMs: null };
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

export { Prisma };
export type { PrismaClient };
