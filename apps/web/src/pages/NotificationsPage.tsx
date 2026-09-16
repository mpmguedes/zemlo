import { useState } from 'react';
import { Link } from 'react-router-dom';
import { NOTIFICATION_TOPICS, formatNumber, optionLabel } from '@zemlo/shared';
import {
  useDeleteNotification,
  useMarkNotificationsRead,
  useNotifications,
} from '../api/hooks';
import { errorMessage, errorRequestId } from '../api/errors';
import { Button, Card, Chip, InlineError, LoadingBlock, PageHeader, Section } from '../ui/primitives';
import { useToast } from '../ui/Toaster';
import { dateLong, relativeDate } from '../lib/format';

/**
 * Notificações (§22).
 *
 * Marcar como lida é uma mutação **otimista** — e aqui não é um pormenor de desempenho: o
 * indicador de não lidas vive no cabeçalho e na barra de separadores, ou seja, fora do ecrã
 * onde o utilizador acabou de tocar. Um atraso de rede faria o contador continuar a mostrar
 * "3" enquanto a lista já mostrava as três como lidas, e o utilizador carregaria outra vez.
 *
 * A API materializa as notificações de forma idempotente durante os pedidos ao dashboard
 * (§22) e **não há canais push nem email implementados** — exigem, respetivamente, uma app
 * móvel publicada e um servidor SMTP. Dizemo-lo no rodapé em vez de deixar o utilizador à
 * espera de um email que nunca chega.
 */
export function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useUnreadToggle();
  const notifications = useNotifications(unreadOnly);
  const markRead = useMarkNotificationsRead();
  const remove = useDeleteNotification();
  const toast = useToast();

  const items = notifications.data?.items ?? [];
  const unreadCount = notifications.data?.unreadCount ?? 0;

  return (
    <div className="z-page">
      <PageHeader
        title="Notificações"
        subtitle={
          unreadCount > 0
            ? `${formatNumber(unreadCount, 0)} por ler`
            : 'Está tudo lido.'
        }
        actions={
          <>
            <Chip tone={unreadOnly ? 'accent' : 'neutral'}>
              <button
                type="button"
                onClick={() => setUnreadOnly(!unreadOnly)}
                aria-pressed={unreadOnly}
                style={{ background: 'transparent', border: 0, color: 'inherit', padding: 0, font: 'inherit', cursor: 'pointer', minHeight: 'var(--z-touch)' }}
              >
                {unreadOnly ? '✓ ' : ''}Só por ler
              </button>
            </Chip>
            {unreadCount > 0 ? (
              <Button
                variant="secondary"
                size="sm"
                loading={markRead.isPending}
                onClick={() => {
                  void markRead.mutateAsync({ all: true }).then(() =>
                    toast.show('Todas as notificações marcadas como lidas.', { variant: 'ok' }),
                  );
                }}
              >
                Marcar todas como lidas
              </Button>
            ) : null}
          </>
        }
      />

      {notifications.isLoading ? <LoadingBlock label="A carregar notificações…" /> : null}

      {notifications.isError ? (
        <InlineError
          message={errorMessage(notifications.error)}
          requestId={errorRequestId(notifications.error)}
          onRetry={() => void notifications.refetch()}
        />
      ) : null}

      {notifications.data && items.length === 0 ? (
        <Card>
          <div className="z-empty">
            <span className="z-empty__icon" aria-hidden="true">🔔</span>
            <p className="z-empty__title">{unreadOnly ? 'Nada por ler' : 'Sem notificações'}</p>
            <p className="z-empty__body">
              {unreadOnly
                ? 'Já leste tudo o que havia. Passa para «todas» para reveres o histórico de avisos.'
                : 'O Zemlo avisa-te quando um prazo se aproxima: revisão, seguro, inspeção, IUC ou um documento a expirar. Estas notificações aparecem aqui à medida que os prazos se aproximam.'}
            </p>
            {unreadOnly ? (
              <Button variant="secondary" onClick={() => setUnreadOnly(false)}>
                Ver todas
              </Button>
            ) : (
              <Link to="/calendar" className="z-btn z-btn--primary">
                Ver o calendário
              </Link>
            )}
          </div>
        </Card>
      ) : null}

      {items.length > 0 ? (
        <Section
          title={`${formatNumber(items.length, 0)} ${items.length === 1 ? 'aviso' : 'avisos'}`}
          hint={unreadCount > 0 ? `${formatNumber(unreadCount, 0)} por ler` : undefined}
        >
          <div className="z-stack">
            {items.map((notification) => {
              /*
               * Uma notificação por ler tem o fundo marcado e um ponto à esquerda. A distinção
               * é visível sem cor (o ponto e a tipografia a negrito) — quem não distingue o tom
               * de fundo continua a perceber o que já leu.
               */
              const unread = notification.readAt === null;
              return (
                <Card key={notification.id} soft={!unread}>
                  <div className="z-row" style={{ alignItems: 'flex-start', gap: 'var(--z-space-3)' }}>
                    <span
                      aria-hidden="true"
                      style={{
                        width: 8,
                        height: 8,
                        marginTop: 8,
                        borderRadius: '50%',
                        flex: 'none',
                        background: unread ? 'var(--z-highlight)' : 'transparent',
                        border: unread ? 'none' : '1px solid var(--z-border-strong)',
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="z-row z-row--between z-row--wrap" style={{ gap: 'var(--z-space-2)' }}>
                        <span className="z-strong">{notification.title}</span>
                        <Chip>{optionLabel(NOTIFICATION_TOPICS, notification.topic)}</Chip>
                      </div>
                      <p className="z-small z-muted">{notification.body}</p>
                      <p className="z-xs z-muted">
                        {dateLong(notification.createdAt.slice(0, 10))} · {relativeDate(notification.createdAt.slice(0, 10))}
                      </p>
                      <div className="z-row z-row--wrap" style={{ gap: 'var(--z-space-2)', marginTop: 'var(--z-space-2)' }}>
                        {notification.href ? (
                          <Link
                            to={notification.href}
                            className="z-btn z-btn--secondary z-btn--sm"
                            onClick={() => {
                              if (unread) void markRead.mutateAsync({ ids: [notification.id] });
                            }}
                          >
                            Abrir
                          </Link>
                        ) : null}
                        {unread ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void markRead.mutateAsync({ ids: [notification.id] })}
                          >
                            Marcar como lida
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void remove.mutateAsync(notification.id)}
                        >
                          Eliminar
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </Section>
      ) : null}

      <p className="z-xs z-muted">
        As notificações são geradas quando abres o painel: é o momento natural para o Zemlo
        verificar o que mudou de estado. Esta versão não envia push nem email — exigem uma app
        móvel publicada e um servidor de correio configurado. Enquanto isso, o Zemlo concentra
        os avisos aqui e no painel, onde os vais ver.{' '}
        <Link to="/settings/preferences">Escolher que avisos quero →</Link>
      </p>
    </div>
  );
}

/** Estado local do filtro "só por ler", com a chave de consulta própria. */
function useUnreadToggle(): [boolean, (value: boolean) => void] {
  const [unreadOnly, setUnreadOnly] = useState(false);
  return [unreadOnly, setUnreadOnly];
}
