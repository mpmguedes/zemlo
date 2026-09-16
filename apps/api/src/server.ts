/**
 * Ponto de entrada do servidor.
 *
 * Responsabilidades, e apenas estas: verificar a base de dados antes de aceitar
 * tráfego, abrir a porta, e encerrar de forma limpa. A lógica da aplicação está em
 * `app.ts`.
 */

import { createServer } from 'node:http';
import { config } from './core/config.js';
import { checkDatabase, disconnectDatabase } from './core/db.js';
import { logger } from './core/logger.js';
import { createApp, logStartup } from './app.js';

async function main(): Promise<void> {
  logStartup();

  // Verificar a base de dados **antes** de abrir a porta. Um servidor que aceita
  // pedidos e responde 500 a todos é pior do que um servidor que não arranca: o
  // primeiro esconde a causa, o segundo aponta-a imediatamente.
  const database = await checkDatabase();
  if (!database.reachable) {
    logger.error(
      `Não foi possível ligar à base de dados (${config.database.provider}). Verifica DATABASE_URL e, para SQLite, corre \`npm run db:push\`.`,
    );
    process.exit(1);
  }
  logger.info(`Base de dados a responder em ${database.latencyMs} ms`);

  const app = createApp();
  const server = createServer(app);

  // Timeouts explícitos: por omissão, o Node mantém ligações abertas indefinidamente,
  // o que num serviço atrás de um proxy se transforma em ligações acumuladas.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 60_000;

  await new Promise<void>((resolve) => {
    server.listen(config.port, config.host, () => {
      logger.info(`${'Zemlo'} API disponível em http://${config.host}:${config.port}/api/v1`);
      resolve();
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Encerramento limpo                                                        */
  /* ------------------------------------------------------------------------ */

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`A encerrar (${signal})…`);

    // Parar de aceitar ligações novas e dar 10 segundos às que estão a decorrer.
    const forceExit = setTimeout(() => {
      logger.warn('Encerramento forçado: pedidos ainda em curso após 10 segundos.');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await disconnectDatabase();
    logger.info('Encerrado.');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Uma rejeição não tratada é um defeito, não um evento esperado: registar e encerrar
  // é melhor do que continuar num estado desconhecido (§56).
  process.on('unhandledRejection', (reason) => {
    logger.error('Promessa rejeitada sem tratamento', { reason });
  });
  process.on('uncaughtException', (error) => {
    logger.error('Exceção não capturada — a encerrar', { error });
    void shutdown('uncaughtException');
  });
}

main().catch((error) => {
  logger.error('Falha fatal no arranque', { error });
  process.exit(1);
});
