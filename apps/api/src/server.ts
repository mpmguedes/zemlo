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
import { composeMqtt, redactMqttUrl } from './services/mqtt-bootstrap.js';

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

  /* ------------------------------------------------------------------------ */
  /* Publicação MQTT (`INT-001`)                                              */
  /* ------------------------------------------------------------------------ */

  /*
   * O publicador só existe se houver broker configurado — e a ausência é o caso normal em
   * desenvolvimento, não um erro.
   *
   * Duas decisões aqui, e as duas são sobre não piorar o serviço por causa de um extra:
   *
   *  - **sem `HA_MQTT_URL` não há cliente nem tarefa.** Não é uma tarefa que corre e não faz
   *    nada: é uma tarefa que não existe. Um agendador com uma tarefa inerte a intervalos
   *    regulares encheria os registos com a mesma linha, e o operador deixaria de as ler —
   *    precisamente as que interessam no dia em que o broker for configurado.
   *  - **a ligação não é aberta no arranque.** O cliente é preguiçoso (`services/mqtt-client.ts`):
   *    liga-se na primeira publicação. Um broker em baixo não atrasa o arranque nem deixa uma
   *    promessa pendente, e um `HA_MQTT_URL` errado não impede a API de servir.
   *
   * A `discoveryPrefix` é normalizada uma vez, aqui, e é o valor que o log de arranque mostra:
   * é a diferença entre o operador ver o prefixo que o Zemlo está a usar e adivinhá-lo.
   */
  /*
   * A composição vive em `services/mqtt-bootstrap.ts` — é uma função **pura** sobre a
   * configuração, e é o que a torna testável sem broker (o `server.ts` chama `main()` no import,
   * pelo que não pode ser importado por um teste). Aqui fica só a decisão de **o que fazer com
   * ela**: registar, ligar ao agendador, e fechar no encerramento. Ver o cabeçalho daquele
   * ficheiro para o porquê de «sem `HA_MQTT_URL` não haver tarefa».
   */
  const mqtt = composeMqtt(config.homeAssistant);

  if (mqtt.client === null) {
    logger.info('publicação MQTT inativa: sem HA_MQTT_URL configurado');
  } else {
    logger.info('publicação MQTT ativa', {
      discoveryPrefix: mqtt.discoveryPrefix,
      // O URL é registado sem credenciais: o `username`/`password` viajam no mesmo URL em muitos
      // brokers, e um log de arranque não é sítio para um segredo (§31).
      broker: redactMqttUrl(String(config.homeAssistant.mqttUrl)),
    });
  }

  const jobs = createJobRunner({
    intervalMinutes: config.jobs.notificationSyncIntervalMinutes,
    jobs: [notificationSyncJob, ...mqtt.jobs],
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

    /*
     * A ligação ao broker é fechada depois do servidor e antes da base de dados.
     *
     * Depois do servidor porque não há nada de novo a publicar quando já não se aceitam
     * pedidos; antes da base de dados porque uma publicação em curso pode querer ler dados, e
     * fechar a base de dados primeiro só produziria erros de ligação nos registos. O `close()`
     * do cliente nunca lança — ver `services/mqtt-client.ts` —, pelo que uma falha a despedir-se
     * de um broker indisponível não pode impedir o encerramento limpo.
     */
    if (mqtt.client !== null) await mqtt.client.close();

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

