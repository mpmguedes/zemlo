import { Link } from 'react-router-dom';
import { formatNumber } from '@zemlo/shared';
import { useMetrics, usePreferences, useProfile, useVehicles } from '../../api/hooks';
import { Card, Chip, DetailList, DetailRow, LoadingBlock, PageHeader } from '../../ui/primitives';
import { dateLong } from '../../lib/format';

/**
 * Definições — índice.
 *
 * Um índice e não um ecrã com tudo: as definições têm três domínios com públicos diferentes
 * (o perfil, que se preenche uma vez; as preferências, que se ajustam; a segurança, que se
 * visita raramente e com atenção). Juntá-los obrigaria a percorrer os três para mudar um.
 *
 * O resumo no topo mostra o estado da conta — é o que permite perceber de relance o que
 * ainda falta configurar sem abrir cada secção.
 */
export function SettingsPage() {
  const profile = useProfile();
  const preferences = usePreferences();
  const vehicles = useVehicles();
  const metrics = useMetrics();

  if (profile.isLoading) return <LoadingBlock label="A carregar a tua conta…" />;

  return (
    <div className="z-page">
      <PageHeader title="Definições" subtitle="A tua conta, as tuas preferências e a tua segurança." />

      <Card>
        <div className="z-card__header">
          <div>
            <div className="z-card__title">{profile.data?.name ?? 'A tua conta'}</div>
            <div className="z-card__subtitle z-mono">{profile.data?.email}</div>
          </div>
          <Chip tone={profile.data?.twoFactorEnabled ? 'ok' : 'warn'}>
            {profile.data?.twoFactorEnabled ? '🔐 2FA ativo' : '🔓 2FA inativo'}
          </Chip>
        </div>
        <div className="z-grid z-grid--3">
          {[
            {
              to: '/settings/profile',
              icon: '👤',
              title: 'Perfil',
              body: 'Nome, fuso horário, unidades e idioma.',
            },
            {
              to: '/settings/preferences',
              icon: '⚙️',
              title: 'Preferências',
              body: `${formatNumber(preferences.data?.frequentExpenseCategories.length ?? 0, 0)} categorias frequentes · avisos ${preferences.data?.reminderLeadDays ?? 30} dias antes`,
            },
            {
              to: '/settings/security',
              icon: '🔐',
              title: 'Segurança',
              body: profile.data?.twoFactorEnabled
                ? 'Verificação em dois passos ativa. Podes rever os dispositivos com sessão.'
                : 'Ativa a verificação em dois passos e revê os dispositivos com sessão.',
            },
          ].map((section) => (
            <Link key={section.to} to={section.to} className="z-card" style={{ color: 'inherit', textDecoration: 'none' }}>
              <span className="z-row" style={{ gap: 'var(--z-space-2)' }}>
                <span aria-hidden="true">{section.icon}</span>
                <span className="z-card__title">{section.title}</span>
              </span>
              <p className="z-small z-muted" style={{ marginTop: 'var(--z-space-2)' }}>
                {section.body}
              </p>
            </Link>
          ))}
        </div>
      </Card>

      <Card>
        <div className="z-card__header">
          <div>
            <div className="z-card__title">Resumo da conta</div>
            <div className="z-card__subtitle">O que está guardado no Zemlo</div>
          </div>
        </div>
        <DetailList>
          <DetailRow label="Conta criada em" value={profile.data ? dateLong(profile.data.createdAt.slice(0, 10)) : '—'} />
          <DetailRow label="Veículos" value={formatNumber(profile.data?.counts.vehicles ?? 0, 0)} />
          <DetailRow label="Despesas registadas" value={formatNumber(profile.data?.counts.expenses ?? 0, 0)} />
          <DetailRow label="Documentos" value={formatNumber(profile.data?.counts.documents ?? 0, 0)} />
          <DetailRow label="Integrações" value={formatNumber(profile.data?.counts.integrations ?? 0, 0)} />
          {metrics.data ? (
            <>
              <DetailRow label="Abastecimentos" value={formatNumber(metrics.data.account.fuel, 0)} />
              <DetailRow label="Carregamentos" value={formatNumber(metrics.data.account.charging, 0)} />
              <DetailRow label="Eventos no histórico" value={formatNumber(metrics.data.account.events, 0)} />
            </>
          ) : null}
        </DetailList>
      </Card>

      <Card>
        <div className="z-card__header">
          <div>
            <div className="z-card__title">Passos de configuração</div>
            <div className="z-card__subtitle">
              O Zemlo funciona sem eles — cada um torna os números mais precisos ou a conta mais
              segura.
            </div>
          </div>
        </div>
        <ul className="z-stack z-stack--tight z-small">
          <li>
            {profile.data?.onboarding.hasVehicle ? '✅' : '⬜'} Veículo adicionado
            {vehicles.data ? ` (${formatNumber(vehicles.data.items.length, 0)})` : ''}
          </li>
          <li>{profile.data?.onboarding.hasOdometer ? '✅' : '⬜'} Quilometragem registada</li>
          <li>{profile.data?.onboarding.hasInsurance ? '✅' : '⬜'} Seguro guardado</li>
          <li>{profile.data?.onboarding.hasInspection ? '✅' : '⬜'} Inspeção registada</li>
          <li>{profile.data?.onboarding.hasMaintenancePlan ? '✅' : '⬜'} Plano de manutenção definido</li>
          <li>{profile.data?.twoFactorEnabled ? '✅' : '⬜'} Verificação em dois passos ativa</li>
        </ul>
        {!profile.data?.onboarding.complete ? (
          <p className="z-xs z-muted" style={{ marginTop: 'var(--z-space-3)' }}>
            Nada disto bloqueia o uso do Zemlo. Cada passo acrescenta precisão ou segurança — e
            podes sempre voltar atrás.
          </p>
        ) : (
          <p className="z-xs z-muted" style={{ marginTop: 'var(--z-space-3)' }}>
            Está tudo configurado. {vehicles.data?.items.length === 1 ? 'A tua conta está completa.' : 'As tuas contas estão completas.'}
          </p>
        )}
      </Card>

      <Card soft>
        <div className="z-card__header">
          <div>
            <div className="z-card__title">Os teus dados</div>
          </div>
        </div>
        <p className="z-small z-muted">
          Podes exportar tudo a qualquer momento e eliminar a conta sem pedir autorização a
          ninguém.
        </p>
        <div className="z-row" style={{ gap: 'var(--z-space-2)', marginTop: 'var(--z-space-3)' }}>
          <Link to="/export" className="z-btn z-btn--secondary z-btn--sm">
            Exportar dados
          </Link>
          <Link to="/settings/security" className="z-btn z-btn--ghost z-btn--sm">
            Eliminar conta
          </Link>
        </div>
      </Card>
    </div>
  );
}
