/**
 * Notificações (§22).
 *
 * Arquitetura: as notificações internas são **materializadas** na tabela `Notification`
 * (ao contrário das sugestões, que são geradas a pedido). A diferença justifica-se
 * porque uma notificação tem estado próprio — lida/não lida — e um histórico que o
 * utilizador espera poder consultar. Uma sugestão é um convite; uma notificação é um
 * registo de que algo aconteceu.
 *
 * A materialização é idempotente: cada notificação tem uma `dedupeKey` derivada do
 * lembrete e do seu estado, pelo que correr a sincronização várias vezes não duplica
 * nada. Isto permite gerar notificações a pedido (quando o cliente abre a aplicação)
 * sem precisar de um trabalho agendado para o MVP — e, quando o agendador existir, o
 * mesmo código corre em lote sem alterações.
 *
 * Canais (§22): push e email estão previstos no modelo e nas preferências. No MVP só
 * o canal interno está implementado; push e email exigem, respetivamente, uma app
 * mobile publicada e um servidor SMTP configurado. O código não finge que os envia.
 */

import type {
  AppNotification,
  NotificationChannel,
  NotificationFrequency,
  NotificationTopic,
  Page,
} from '@zemlo/shared';
import { addDays, optionLabel, todayIn, NOTIFICATION_TOPICS, type CivilDate } from '@zemlo/shared';
import { prisma } from '../core/db.js';
import { logger } from '../core/logger.js';
import { mapNotification } from '../domain/payload.js';
import { documentsExpiringSoon } from './documents.js';
import { listReminders } from './reminders.js';
import { encodeCursor, decodeCursor } from './shared.js';

/* -------------------------------------------------------------------------- */
/* Preferências                                                                */
/* -------------------------------------------------------------------------- */

export interface NotificationSettings {
  preferences: Map<string, NotificationFrequency>;
  /** `true` quando o canal interno está desligado para o tópico. */
  isEnabled(topic: NotificationTopic): boolean;
  frequencyFor(topic: NotificationTopic, channel: NotificationChannel): NotificationFrequency;
}

/**
 * Lê as preferências de notificação.
 *
 * A regra por omissão é "ligado no canal interno" para todos os tópicos relevantes:
 * uma notificação interna dentro da aplicação não interrompe ninguém, ao contrário de
 * um push ou de um email. É para esses que o consentimento tem de ser explícito.
 */
export async function loadNotificationSettings(userId: string): Promise<NotificationSettings> {
  const rows = await prisma.notificationPreference.findMany({ where: { userId } });
  const preferences = new Map<string, NotificationFrequency>();
  for (const row of rows) {
    preferences.set(`${row.topic}:${row.channel}`, row.frequency as NotificationFrequency);
  }

  return {
    preferences,
    isEnabled(topic) {
      const frequency = preferences.get(`${topic}:in_app`);
      return frequency === undefined ? true : frequency !== 'off';
    },
    frequencyFor(topic, channel) {
      return preferences.get(`${topic}:${channel}`) ?? (channel === 'in_app' ? 'immediate' : 'off');
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Sincronização                                                               */
/* -------------------------------------------------------------------------- */

export interface SyncNotificationsInput {
  userId: string;
  timeZone: string;
  vehicles: Array<{ id: string; plateDisplay: string; odometerKm: number | null }>;
  /** Lembretes já avaliados, com o estado calculado. */
  reminders: Array<{
    id: string;
    vehicleId: string;
    title: string;
    topic: string;
    state: string;
    summary: string;
    daysRemaining: number | null;
    kmRemaining: number | null;
    dueDate: CivilDate | null;
    projectedDate: CivilDate | null;
  }>;
  /** Documentos a expirar, quando não têm lembrete associado. */
  expiringDocuments: Array<{
    id: string;
    name: string;
    expiresAt: CivilDate | null;
    daysToExpiry: number | null;
    vehicleId: string | null;
  }>;
}

/**
 * Cria as notificações internas em falta.
 *
 * Devolve o número de notificações criadas, para que o chamador possa decidir se vale
 * a pena atualizar o contador no cliente.
 */
export async function syncNotifications(input: SyncNotificationsInput): Promise<number> {
  const settings = await loadNotificationSettings(input.userId);
  const today = todayIn(input.timeZone);

  const candidates: Array<{
    topic: NotificationTopic;
    title: string;
    body: string;
    href: string | null;
    vehicleId: string | null;
    reminderId: string | null;
    dedupeKey: string;
    scheduledFor: Date | null;
  }> = [];

  for (const reminder of input.reminders) {
    const topic = (reminder.topic as NotificationTopic) ?? 'maintenance';
    if (!settings.isEnabled(topic)) continue;

    // Sem interesse quando o lembrete está em dia e longe de vencer: o Zemlo não
    // envia notificações para dizer que está tudo bem (§3.5, §47).
    if (reminder.state === 'ok' || reminder.state === 'unknown') continue;

    const vehicle = input.vehicles.find((candidate) => candidate.id === reminder.vehicleId);
    const plate = vehicle?.plateDisplay ?? 'veículo';

    // A chave inclui a data efetiva e o estado: a mesma notificação não se repete no
    // mesmo dia, mas uma mudança de estado (de "em breve" para "em atraso") gera uma
    // notificação nova, porque a situação mudou de facto.
    const effectiveDate = reminder.projectedDate ?? reminder.dueDate ?? today;
    const dedupeKey = `${reminder.id}:${reminder.state}:${effectiveDate}`;

    candidates.push({
      topic,
      title: notificationTitle(reminder.state, reminder.title),
      body: notificationBody(reminder.summary, plate, reminder.daysRemaining, reminder.kmRemaining),
      href: `/vehicles/${reminder.vehicleId}?tab=reminders`,
      vehicleId: reminder.vehicleId,
      reminderId: reminder.id,
      dedupeKey,
      scheduledFor: null,
    });
  }

  for (const document of input.expiringDocuments) {
    if (!settings.isEnabled('document')) continue;
    if (document.daysToExpiry === null || document.daysToExpiry > 30) continue;

    candidates.push({
      topic: 'document',
      title: document.daysToExpiry < 0 ? 'Documento expirado' : 'Documento a expirar',
      body:
        document.daysToExpiry < 0
          ? `${document.name} expirou há ${Math.abs(document.daysToExpiry)} dias.`
          : `${document.name} expira em ${document.daysToExpiry} dias.`,
      href: document.vehicleId ? `/vehicles/${document.vehicleId}?tab=documents` : '/settings',
      vehicleId: document.vehicleId,
      reminderId: null,
      dedupeKey: `document:${document.id}:${document.daysToExpiry}`,
      scheduledFor: null,
    });
  }

  if (candidates.length === 0) return 0;

  let created = 0;
  for (const candidate of candidates) {
    try {
      // `createMany` com `skipDuplicates` não é suportado em SQLite pelo Prisma, por
      // isso verificamos a existência — o índice único em (userId, dedupeKey) é a
      // garantia final contra duplicados.
      const existing = await prisma.notification.findFirst({
        where: { userId: input.userId, dedupeKey: candidate.dedupeKey },
        select: { id: true },
      });
      if (existing) continue;

      await prisma.notification.create({
        data: {
          userId: input.userId,
          topic: candidate.topic,
          channel: 'in_app',
          title: candidate.title,
          body: candidate.body,
          href: candidate.href,
          vehicleId: candidate.vehicleId,
          reminderId: candidate.reminderId,
          dedupeKey: candidate.dedupeKey,
          scheduledFor: candidate.scheduledFor,
          sentAt: new Date(),
        },
      });
      created += 1;
    } catch (error) {
      // Corrida entre dois pedidos simultâneos: a chave única rejeita o segundo.
      // Não é um erro para o utilizador, é a garantia a funcionar.
      logger.debug('Notificação duplicada ignorada', { dedupeKey: candidate.dedupeKey });
    }
  }

  return created;
}

/* -------------------------------------------------------------------------- */
/* Descoberta partilhada                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Janela de documentos a expirar considerada numa sincronização.
 *
 * Esta janela é **real**: `documentsExpiringSoon` usa-a como limite superior da consulta
 * (`expiresAt <= hoje + withinDays`). Era um literal dentro do handler do dashboard;
 * passa a constante com nome porque o agendador tem de usar exatamente o mesmo valor — duas
 * cópias de uma janela divergem ao primeiro ajuste.
 */
export const NOTIFICATION_DOCUMENT_WINDOW_DAYS = 30;

/*
 * As janelas de lembretes (`windowDays: 180`, `windowKm: 5000`) **não** são uma janela.
 *
 * Medido: `services/reminders.ts` não tem uma única referência a `windowDays` nem a
 * `windowKm` — o contrato aceita-os e o serviço ignora-os, e o único limite é o
 * `take: 500` da consulta. Passá-los com nomes que sugerem uma garantia seria escrever no
 * código uma promessa que ninguém cumpre (o mesmo defeito de `AUD-014`: uma guarda que não
 * guarda). Os valores continuam a ser passados, porque era o que o dashboard já fazia e
 * esta refatoração não muda comportamento — mas ficam como literais com esta nota, e a
 * janela inerte fica registada como achado em vez de ser absorvida em silêncio.
 */
const REMINDER_LIST_WINDOW_DAYS = 180;
const REMINDER_LIST_WINDOW_KM = 5000;

/**
 * Tópico de notificação inferido do título do lembrete.
 *
 * O modelo `Reminder` já tem uma coluna `topic`, mas os lembretes criados antes de essa
 * coluna existir têm o valor por omissão (`maintenance`). Inferir pelo título mantém as
 * notificações corretas para dados antigos e é o tipo de compatibilidade que se paga
 * uma vez e se esquece.
 *
 * Vive aqui, e não na rota onde nasceu, porque quem decide o tópico é a política de
 * notificações: o dashboard e o agendador têm de decidir o mesmo, e duas cópias
 * divergiriam no primeiro título novo.
 */
export function topicForReminder(title: string): NotificationTopic {
  const normalized = title.toLowerCase();
  if (normalized.includes('seguro') || normalized.includes('apólice') || normalized.includes('apolice')) {
    return 'insurance';
  }
  if (normalized.includes('inspeção') || normalized.includes('inspecao')) return 'inspection';
  if (normalized.includes('iuc') || normalized.includes('imposto')) return 'tax';
  if (normalized.includes('validade') || normalized.includes('documento')) return 'document';
  return 'maintenance';
}

/**
 * Sincroniza as notificações de **um** utilizador: descobre o que está a vencer e
 * materializa o que ainda não existe. Devolve quantas notificações foram criadas.
 *
 * ## Porque é que isto é uma função, e não três linhas dentro do handler
 *
 * Era três linhas dentro do handler do dashboard (`routes/insights.ts`), e é essa a razão
 * pela qual **um lembrete legal não avisava ninguém enquanto ninguém olhasse o ecrã**
 * (`PC-9`): a única forma de sincronizar era pedir o dashboard. O agendador
 * (`jobs/notification-sync.ts`) tem de fazer exatamente o mesmo trabalho sem um pedido
 * HTTP, e a alternativa — copiar a montagem do input para o trabalho periódico — deixaria
 * duas implementações da mesma regra a divergir em silêncio. O ecrã e o agendador passam a
 * partilhar esta função, e é por isso que o teste que compara os dois é uma asserção sobre
 * uma só implementação, e não sobre duas que se parecem.
 *
 * ## O `timeZone` é parâmetro, e não um `request`
 *
 * A data "de hoje" decide o que está a vencer, e um dia mal calculado cria a notificação
 * errada. O dashboard passa `request.meta.timeZone`, que o `optionalAuth` preenche com o
 * fuso do utilizador autenticado; o agendador passa `user.timeZone`, porque não tem
 * pedido. São o mesmo valor — e é essa igualdade que faz com que os dois caminhos
 * produzam as mesmas notificações.
 *
 * ## Best-effort é do chamador, não daqui
 *
 * Esta função propaga os erros. Quem corre em lote decide o que fazer com um utilizador
 * que falhou; quem responde a um pedido decide o mesmo, e as duas decisões são diferentes
 * (o dashboard engole a falha para o ecrã aparecer; o agendador registra-a e continua para
 * os restantes).
 */
export async function syncNotificationsForUser(userId: string, timeZone: string): Promise<number> {
  const today = todayIn(timeZone);

  const vehicles = await prisma.vehicle.findMany({
    where: { userId, archived: false },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, plateDisplay: true, odometerKm: true },
  });

  const reminderList = await listReminders(userId, {
    includeCompleted: false,
    windowDays: REMINDER_LIST_WINDOW_DAYS,
    windowKm: REMINDER_LIST_WINDOW_KM,
  });

  const expiring = await documentsExpiringSoon(userId, today, NOTIFICATION_DOCUMENT_WINDOW_DAYS);

  return syncNotifications({
    userId,
    timeZone,
    vehicles,
    reminders: reminderList.items.map((reminder) => ({
      id: reminder.id,
      vehicleId: reminder.vehicleId,
      title: reminder.title,
      topic: topicForReminder(reminder.title),
      state: reminder.evaluation.state,
      summary: reminder.evaluation.summary,
      daysRemaining: reminder.evaluation.daysRemaining,
      kmRemaining: reminder.evaluation.kmRemaining,
      dueDate: reminder.dueDate,
      projectedDate: reminder.evaluation.projectedDate,
    })),
    expiringDocuments: expiring.map((document) => ({
      id: document.id,
      name: document.name,
      expiresAt: document.expiresAt,
      daysToExpiry: document.daysToExpiry,
      vehicleId: document.vehicleId,
    })),
  });
}

/**
 * Quando a sugestão de segurança deve reaparecer.
 *
 * Devolve `true` quando não há silêncio ativo. Usado pelas sugestões (§7) e mantido
 * aqui porque a política de insistência é uma decisão sobre notificações.
 */
export function needsSecurityNudge(snoozedUntil: CivilDate | null, today: CivilDate): boolean {
  if (snoozedUntil === null) return true;
  return snoozedUntil <= today;
}

/** Data até à qual a sugestão de segurança fica silenciada. */
export function securityNudgeSnoozeUntil(today: CivilDate, days: number): CivilDate {
  return addDays(today, days);
}

/* -------------------------------------------------------------------------- */
/* Leitura e marcação                                                          */
/* -------------------------------------------------------------------------- */

export async function listNotifications(
  userId: string,
  options: { unreadOnly: boolean; limit: number; cursor?: string | undefined },
): Promise<Page<AppNotification> & { unreadCount: number }> {
  const decoded = decodeCursor(options.cursor ?? null);
  const where: Record<string, unknown> = {
    userId,
    ...(options.unreadOnly ? { readAt: null } : {}),
    ...(decoded
      ? {
          OR: [
            { createdAt: { lt: new Date(decoded.date) } },
            { createdAt: new Date(decoded.date), id: { lt: decoded.id } },
          ],
        }
      : {}),
  };

  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: options.limit + 1,
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);

  const hasMore = rows.length > options.limit;
  const page = hasMore ? rows.slice(0, options.limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map(mapNotification),
    nextCursor:
      hasMore && last ? encodeCursor(last.createdAt.toISOString().slice(0, 10), last.id) : null,
    unreadCount,
  };
}

export async function markNotificationsRead(
  userId: string,
  options: { ids?: string[] | undefined; all?: boolean | undefined },
): Promise<number> {
  if (options.all) {
    const result = await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  if (!options.ids || options.ids.length === 0) return 0;

  const result = await prisma.notification.updateMany({
    where: { userId, id: { in: options.ids }, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

export async function deleteNotification(userId: string, notificationId: string): Promise<void> {
  await prisma.notification.deleteMany({ where: { id: notificationId, userId } });
}

/* -------------------------------------------------------------------------- */
/* Texto das notificações (§59)                                                */
/* -------------------------------------------------------------------------- */

/**
 * Título de uma notificação.
 *
 * O tom segue a marca: informativo e sem alarme. "Revisão em atraso" e não "ALERTA:
 * manutenção vencida!". O utilizador precisa de saber o que se passa e o que fazer,
 * não de se sentir culpado por não ter aberto a aplicação.
 */
function notificationTitle(state: string, title: string): string {
  switch (state) {
    case 'overdue':
      return `${title} em atraso`;
    case 'due':
      return `${title} agora`;
    case 'soon':
      return `${title} a aproximar-se`;
    default:
      return title;
  }
}

function notificationBody(
  summary: string,
  plate: string,
  daysRemaining: number | null,
  kmRemaining: number | null,
): string {
  const parts: string[] = [plate];
  if (summary) parts.push(summary);
  else if (daysRemaining !== null) {
    const days = Math.abs(daysRemaining);
    parts.push(daysRemaining < 0 ? `passou há ${days} dias` : `faltam ${days} dias`);
  } else if (kmRemaining !== null) {
    parts.push(kmRemaining < 0 ? `passou há ${Math.abs(Math.round(kmRemaining))} km` : `faltam ${Math.round(kmRemaining)} km`);
  }
  return parts.join(' · ');
}

/** Etiqueta legível de um tópico de notificação. */
export function topicLabel(topic: string): string {
  return optionLabel(NOTIFICATION_TOPICS, topic);
}
