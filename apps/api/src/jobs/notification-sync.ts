/**
 * Trabalho periódico: sincronizar as notificações de **todos** os utilizadores (§22).
 *
 * ## O defeito que isto corrige (`PC-9`)
 *
 * `syncNotifications` só corria como efeito lateral de abrir o dashboard
 * (`routes/insights.ts`). Um lembrete legal — inspeção, seguro, IUC — só avisava o
 * utilizador se ele abrisse a aplicação, e o ecrã que o mostrava era o mesmo que o
 * gerava. Para uma promessa de produto que é *avisar*, isso é uma diferença material: o
 * aviso chegava depois de o prazo, ou nunca.
 *
 * ## O que este ficheiro é, e o que não é
 *
 * É o **núcleo**: percorre utilizadores, corre a sincronização de cada um e devolve um
 * relatório. Não sabe o que é um temporizador, não arranca sozinho e não depende do
 * `server.ts` — quem o liga a um relógio é `jobs/runner.ts`, e quem o arranca é o
 * `server.ts`. Essa separação é o que permite que o mesmo núcleo seja invocado, sem
 * alterações, por um entrypoint externo (cron, contentor de trabalho) no dia em que
 * houver mais do que uma instância da API.
 *
 * ## Best-effort por utilizador, e porquê
 *
 * A falha de um utilizador (uma conta com dados inconsistentes, por exemplo) não pode
 * impedir os outros de receber o aviso. O erro é registado com o `userId` e o motivo, o
 * relatório conta-o, e a passagem continua. Um trabalho periódico que aborta na primeira
 * exceção transforma um problema de uma conta num problema de todas.
 *
 * ## Idempotência
 *
 * Não está aqui: está na `dedupeKey` de cada notificação e no índice único
 * `(userId, dedupeKey)` (`services/notifications.ts`, `prisma/schema.prisma`). É isso que
 * torna seguro correr duas vezes — por um temporizador que dispara enquanto a execução
 * anterior ainda corre, por uma instância reiniciada, ou por dois processos a partilhar a
 * mesma base de dados. O núcleo não guarda estado em memória: o que está por fazer está
 * na base de dados, e é por isso que um reinício não perde trabalho.
 */

import { prisma } from '../core/db.js';
import { errorReason } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { syncNotificationsForUser } from '../services/notifications.js';
import type { ScheduledJob } from './runner.js';

/** O nome da tarefa, e o identificador que aparece em todos os registos dela. */
export const NOTIFICATION_SYNC_JOB_NAME = 'notification-sync';

/** Quantos utilizadores são lidos por página. */
export const NOTIFICATION_SYNC_PAGE_SIZE = 100;

/**
 * Travão de segurança da paginação.
 *
 * O ciclo termina quando uma página vem incompleta. Se um dia a paginação por cursor
 * deixar de avançar — um `cursor` que não é reposto, um `skip` errado —, o ciclo não
 * termina e o processo fica preso a ler a mesma página para sempre. Este limite converte
 * esse defeito num relatório truncado com um aviso, em vez de uma API que deixa de
 * responder. Não é um limite de negócio: é a diferença entre um erro e uma paragem.
 */
const MAX_PAGES = 10_000;

export interface NotificationSyncFailure {
  userId: string;
  reason: string;
}

export interface NotificationSyncReport {
  /** Utilizadores lidos. */
  usersConsidered: number;
  /** Utilizadores cuja sincronização terminou sem erro. */
  usersSynced: number;
  /** Notificações materializadas nesta passagem. */
  notificationsCreated: number;
  failures: NotificationSyncFailure[];
  durationMs: number;
}

export interface NotificationSyncOptions {
  /**
   * Limita a passagem a estes utilizadores.
   *
   * Existe para os testes poderem ser determinísticos numa base de dados partilhada e
   * para um futuro trabalho por lotes (sharding). Sem isto, percorre **todos** os
   * utilizadores — que é o que o agendador precisa.
   */
  userIds?: string[];
  /** Quantos utilizadores por página. */
  pageSize?: number;
}

/**
 * Corre uma passagem de sincronização e devolve o que aconteceu.
 *
 * Não lança por falha de um utilizador — ver a nota de best-effort no cabeçalho. Lança
 * apenas se a **própria paginação** falhar (a base de dados indisponível, por exemplo), e
 * nesse caso quem chama decide: o runner registra e tenta outra vez no intervalo seguinte.
 */
export async function runNotificationSync(
  options: NotificationSyncOptions = {},
): Promise<NotificationSyncReport> {
  const startedAt = process.hrtime.bigint();
  const pageSize = options.pageSize ?? NOTIFICATION_SYNC_PAGE_SIZE;

  const failures: NotificationSyncFailure[] = [];
  let usersConsidered = 0;
  let usersSynced = 0;
  let notificationsCreated = 0;

  let cursor: string | undefined;
  let pages = 0;

  for (;;) {
    if (pages >= MAX_PAGES) {
      logger.warn('sincronização de notificações truncada: limite de páginas atingido', {
        job: NOTIFICATION_SYNC_JOB_NAME,
        pages,
        usersConsidered,
      });
      break;
    }

    const users = await prisma.user.findMany({
      where: options.userIds ? { id: { in: options.userIds } } : undefined,
      // A ordenação tem de ser determinística e pela mesma coluna do cursor: é isso que
      // garante que a página seguinte continua onde a anterior acabou, sem repetir nem
      // saltar ninguém.
      orderBy: { id: 'asc' },
      take: pageSize,
      ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
      select: { id: true, timeZone: true },
    });

    pages += 1;
    if (users.length === 0) break;

    for (const user of users) {
      usersConsidered += 1;
      try {
        notificationsCreated += await syncNotificationsForUser(user.id, user.timeZone);
        usersSynced += 1;
      } catch (error) {
        const reason = errorReason(error);
        failures.push({ userId: user.id, reason });
        logger.warn('não foi possível sincronizar as notificações de um utilizador', {
          job: NOTIFICATION_SYNC_JOB_NAME,
          userId: user.id,
          reason,
        });
      }
    }

    // Uma página incompleta é a última: sem isto, o ciclo faria mais um pedido para
    // receber zero linhas.
    if (users.length < pageSize) break;
    cursor = users[users.length - 1]?.id;
    if (cursor === undefined) break;
  }

  return {
    usersConsidered,
    usersSynced,
    notificationsCreated,
    failures,
    durationMs: Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000),
  };
}

/**
 * O núcleo como tarefa agendável.
 *
 * A ligação entre o trabalho e o relógio fica **aqui**, num objeto de duas linhas, e não
 * dentro do núcleo: é o que permite correr `runNotificationSync()` num teste, num script
 * ou num entrypoint externo sem arrastar um temporizador atrás.
 */
export const notificationSyncJob: ScheduledJob = {
  name: NOTIFICATION_SYNC_JOB_NAME,
  run: () => runNotificationSync(),
};
