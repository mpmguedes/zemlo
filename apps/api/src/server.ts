/**
 * Ponto de entrada do servidor.
 *
 * Responsabilidades, e apenas estas: verificar a base de dados antes de aceitar
 * tráfego, abrir a porta, e encerrar de forma limpa. A lógica da aplicação está em
 * `app.ts`.
 */

import { createServer } from 'node:http';
import { config } from './core/config.js';
import { activeProvider, checkDatabase, describeDatabase, disconnectDatabase } from './core/db.js';
import { logger } from './core/logger.js';
import { createApp, logStartup } from './app.js';
import { notificationSyncJob } from './jobs/notification-sync.js';
import { createJobRunner } from './jobs/runner.js';

async function main(): Promise<void> {
  logStartup();

  /*
   * O motor efetivo é registado explicitamente, e vem do cliente Prisma carregado — não
   * da variável de ambiente. É esta linha que denuncia, nos logs, uma produção que
   * arrancou com o cliente errado. `core/prisma-client.ts` já recusa esse caso antes de
   * aqui chegar; o registo existe para que o operador veja qual o motor em uso sem ter de
   * consultar o `/health`.
   */
  logger.info(`Motor de base de dados: ${activeProvider}`);

  // Verificar a base de dados **antes** de abrir a porta. Um servidor que aceita
  // pedidos e responde 500 a todos é pior do que um servidor que não arranca: o
  // primeiro esconde a causa, o segundo aponta-a imediatamente.
  const database = await checkDatabase();
  if (!database.reachable) {
    logger.error(
      `Não foi possível ligar à base de dados (${describeDatabase()}). Verifica DATABASE_URL e, para SQLite, corre \`npm run db:push\`.`,
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
  /* Trabalho periódico                                                       */
  /* ------------------------------------------------------------------------ */

  /*
   * O agendador arranca **depois** de a porta estar aberta, e é aqui — no ponto de
   * entrada — e não no `createApp()`.
   *
   * A diferença é a razão pela qual isto existe neste ficheiro: `createApp()` é chamado
   * por todos os testes HTTP, e um agendador criado ali levantaria um relógio por teste,
   * a escrever na base de dados por razões que não são as do teste. Aqui, corre uma vez,
   * no processo que serve tráfego, e só nesse.
   *
   * Arranca depois de escutar porque o trabalho não pode atrasar a disponibilidade do
   * serviço: um trabalho lento (ou uma base de dados grande) não deve transformar-se numa
   * API que demora a aceitar pedidos. A primeira passagem é disparada pelo `runOnStart`
   * do runner, sem bloquear nada.
   */
  const jobs = createJobRunner({
    intervalMinutes: config.jobs.notificationSyncIntervalMinutes,
    jobs: [notificationSyncJob],
  });
  jobs.start();

  /* ------------------------------------------------------------------------ */
  /* Encerramento limpo                                                        */
  /* ------------------------------------------------------------------------ */

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`A encerrar (${signal})…`);

    // O relógio para primeiro: a partir daqui não começa trabalho novo. Uma execução já
    // em curso não é interrompida (não se corta um trabalho a meio de escrever) e pode
    // falhar quando a base de dados fechar — é registada como falha, e é por isso que
    // esta ordem importa: parar o relógio antes reduz a janela ao mínimo.
    jobs.stop();

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
