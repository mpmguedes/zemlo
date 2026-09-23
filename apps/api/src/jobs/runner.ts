/**
 * Agendador in-process: liga um núcleo de trabalho a um relógio.
 *
 * ## Porque é que isto é um ficheiro separado do trabalho
 *
 * O núcleo (`jobs/notification-sync.ts`) não sabe o que é um temporizador, e é isso que o
 * torna testável, invocável por um script e reutilizável por um entrypoint externo. Este
 * ficheiro é a única peça que conhece o `setInterval` — e é a peça que **não** corre nos
 * testes da aplicação, porque quem a arranca é o `server.ts` e não o `createApp()`. Se o
 * agendador nascesse dentro da aplicação, cada teste HTTP levantaria um relógio, e os
 * testes passariam a escrever na base de dados por razões que não são as do teste.
 *
 * ## O que este ficheiro garante, e o que não garante
 *
 * **Garante** que a mesma tarefa não corre duas vezes ao mesmo tempo dentro deste processo.
 * Sem a guarda, um trabalho mais lento do que o intervalo empilha execuções: cada uma lê a
 * mesma base de dados, e o resultado é carga a multiplicar-se sozinha até algo ceder. Um
 * ciclo que demora mais do que o intervalo é normal (uma base de dados grande, uma conta
 * lenta) e não pode ser um problema — o que tem de acontecer é a passagem seguinte ser
 * **ignorada** e registada como ignorada.
 *
 * **Não garante** exclusão entre processos. Duas instâncias da API a correr o mesmo
 * agendador correm-no as duas. Não é uma falha silenciosa: é a razão pela qual a
 * idempotência vive na base de dados (a `dedupeKey` única de cada notificação) e não na
 * memória deste processo. Com mais do que uma instância, a decisão certa passa a ser
 * **uma** delas a agendar (ou um entrypoint externo), e é uma decisão de operação, não
 * deste código.
 *
 * ## A guarda não aborta nada
 *
 * Uma execução em curso nunca é interrompida — nem pela guarda, nem pelo `stop()`. Um
 * trabalho a meio de escrever não pode ser cortado a meio; o que se faz é não começar
 * outro. É por isso que o `stop()` para o relógio e não espera pelo trabalho.
 */

import { errorReason } from '../core/errors.js';
import { logger } from '../core/logger.js';

/** Uma unidade de trabalho agendável. O nome identifica-a nos registos e na guarda. */
export interface ScheduledJob {
  readonly name: string;
  run(): Promise<unknown>;
}

/** O que aconteceu numa execução — o suficiente para um relatório e para um teste. */
export interface JobRunOutcome {
  job: string;
  status: 'completed' | 'failed' | 'skipped';
  durationMs: number;
  /** O que a tarefa devolveu. Só em `completed`. */
  result?: unknown;
  /** Porque falhou, ou porque foi ignorada. */
  reason?: string;
}

export interface JobRunnerHandle {
  /** O intervalo configurado, em minutos. `0` significa desligado. */
  readonly intervalMinutes: number;
  /** `true` enquanto o relógio estiver armado. */
  readonly started: boolean;
  /** Corre agora, respeitando a guarda. Sem nome, corre todas as tarefas. */
  runNow(jobName?: string): Promise<JobRunOutcome[]>;
  /** Arma o relógio. Idempotente: chamar duas vezes não cria dois relógios. */
  start(): void;
  /** Desarma o relógio. Uma execução em curso termina por si. */
  stop(): void;
}

export interface JobRunnerOptions {
  /** Intervalo em minutos. `0` (ou negativo) desliga o agendador. */
  intervalMinutes: number;
  jobs: readonly ScheduledJob[];
  /**
   * Correr uma passagem logo no arranque, sem esperar o primeiro intervalo.
   *
   * Ligado por omissão, e por uma razão concreta: uma instância reiniciada não pode
   * deixar passar até um intervalo inteiro de trabalho que já estava por fazer. O trabalho
   * pendente está na base de dados, portanto a passagem de arranque apanha-o.
   */
  runOnStart?: boolean;
}

function elapsedMs(startedAt: bigint): number {
  return Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
}

export function createJobRunner(options: JobRunnerOptions): JobRunnerHandle {
  const { intervalMinutes, jobs } = options;
  const runOnStart = options.runOnStart ?? true;

  /** As tarefas com uma execução em curso **neste** processo. */
  const inFlight = new Set<string>();

  let timer: NodeJS.Timeout | null = null;

  async function runOne(job: ScheduledJob): Promise<JobRunOutcome> {
    /*
     * A guarda. A verificação e a inscrição acontecem antes do primeiro `await`, para que
     * duas chamadas no mesmo ciclo do event loop não possam passar as duas: a segunda
     * encontra a tarefa já inscrita.
     */
    if (inFlight.has(job.name)) {
      logger.warn('tarefa agendada ignorada: a execução anterior ainda está em curso', {
        job: job.name,
      });
      return { job: job.name, status: 'skipped', durationMs: 0, reason: 'execução em curso' };
    }
    inFlight.add(job.name);

    const startedAt = process.hrtime.bigint();
    logger.info('tarefa agendada iniciada', { job: job.name });

    try {
      const result = await job.run();
      const durationMs = elapsedMs(startedAt);
      // O resultado é registado tal como veio: é o relatório do trabalho, e é o que torna
      // uma passagem observável sem ter de a instrumentar por dentro.
      logger.info('tarefa agendada concluída', { job: job.name, durationMs, result });
      return { job: job.name, status: 'completed', durationMs, result };
    } catch (error) {
      /*
       * A falha é registada e **contida**: uma exceção que saísse daqui chegaria a um
       * `setInterval` sem tratamento, e a partir daí ou o processo cai, ou o erro
       * desaparece sem ninguém o ver. O relógio continua armado — a passagem seguinte é
       * uma nova oportunidade, e é o que se quer de um trabalho periódico.
       */
      const durationMs = elapsedMs(startedAt);
      const reason = errorReason(error);
      logger.error('tarefa agendada falhou', { job: job.name, durationMs, reason, error });
      return { job: job.name, status: 'failed', durationMs, reason };
    } finally {
      inFlight.delete(job.name);
    }
  }

  async function runNow(jobName?: string): Promise<JobRunOutcome[]> {
    const selected =
      jobName === undefined ? [...jobs] : jobs.filter((job) => job.name === jobName);
    // Tarefas **diferentes** correm em paralelo; a mesma tarefa, nunca (ver a guarda).
    return Promise.all(selected.map((job) => runOne(job)));
  }

  function start(): void {
    if (intervalMinutes <= 0) {
      logger.warn('agendador desligado por configuração', {
        intervalMinutes,
        jobs: jobs.map((job) => job.name),
      });
      return;
    }
    if (timer !== null) return;

    timer = setInterval(() => {
      // `void` de propósito: `runNow` já contém todas as falhas e devolve-as no relatório.
      void runNow();
    }, intervalMinutes * 60_000);

    logger.info('agendador iniciado', {
      intervalMinutes,
      runOnStart,
      jobs: jobs.map((job) => job.name),
    });

    if (runOnStart) void runNow();
  }

  function stop(): void {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
    logger.info('agendador parado', { jobs: jobs.map((job) => job.name) });
  }

  return {
    intervalMinutes,
    get started() {
      return timer !== null;
    },
    runNow,
    start,
    stop,
  };
}
