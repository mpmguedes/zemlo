import { useEffect } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './app/AppShell';
import { useSession } from './app/SessionContext';
import { Logo } from './components/Logo';
import { EmptyState, LoadingBlock } from './ui/primitives';import { LoginPage } from './pages/auth/LoginPage';
import { SignUpPage } from './pages/auth/SignUpPage';
import { OnboardingPage } from './pages/auth/OnboardingPage';
import { DashboardPage } from './pages/DashboardPage';
import { VehiclesPage } from './pages/vehicles/VehiclesPage';
import { VehicleDetailPage } from './pages/vehicles/VehicleDetailPage';
import { NewVehiclePage } from './pages/vehicles/NewVehiclePage';
import { RecordsPage } from './pages/records/RecordsPage';
import { RecordDetailPage } from './pages/records/RecordDetailPage';
import { RemindersPage } from './pages/records/RemindersPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { StatsPage } from './pages/StatsPage';
import { TimelinePage } from './pages/TimelinePage';
import { CalendarPage } from './pages/CalendarPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { IntegrationsPage } from './pages/integrations/IntegrationsPage';
import { HomeAssistantPage } from './pages/integrations/HomeAssistantPage';
import { ExportPage } from './pages/ExportPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { ProfileSettingsPage } from './pages/settings/ProfileSettingsPage';
import { PreferencesSettingsPage } from './pages/settings/PreferencesSettingsPage';
import { SecuritySettingsPage } from './pages/settings/SecuritySettingsPage';

/**
 * Mapa de rotas.
 *
 * As rotas são declaradas de forma plana e legível, e não geradas a partir de uma
 * configuração: com trinta rotas, uma tabela de configuração esconde mais do que mostra —
 * quem procura onde está `/integrations/home-assistant` quer encontrá-lo escrito.
 *
 * Os caminhos das rotas **coincidem com os `href` que a API devolve** (`/vehicles/:id?tab=…`,
 * `/records/fuel/:id`, `/settings/security`). É deliberado: os links que vêm no dashboard,
 * na timeline e nas notificações têm de funcionar sem uma tabela de tradução, porque essa
 * tabela seria o primeiro sítio a ficar desatualizado quando a API acrescentasse um ecrã.
 */
export function App() {
  return (
    <Routes>
      {/* Rotas públicas. */}
      <Route path="/login" element={<RedirectIfAuthenticated><LoginPage /></RedirectIfAuthenticated>} />
      <Route path="/signup" element={<RedirectIfAuthenticated><SignUpPage /></RedirectIfAuthenticated>} />

      {/* Onboarding: exige sessão, mas não a estrutura completa (ainda não há veículos). */}
      <Route
        path="/onboarding/*"
        element={
          <RequireSession>
            <OnboardingRoutes />
          </RequireSession>
        }
      />

      {/* Aplicação autenticada. */}
      <Route
        element={
          <RequireSession>
            <AppShell />
          </RequireSession>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/vehicles" element={<VehiclesPage />} />
        <Route path="/vehicles/new" element={<NewVehiclePage />} />
        <Route path="/vehicles/:vehicleId" element={<VehicleDetailPage />} />
        <Route path="/records/:kind" element={<RecordsPage />} />
        <Route path="/records/reminders" element={<RemindersPage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/timeline" element={<TimelinePage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/integrations" element={<IntegrationsPage />} />
        <Route path="/integrations/home-assistant" element={<HomeAssistantPage />} />
        <Route path="/export" element={<ExportPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/profile" element={<ProfileSettingsPage />} />
        <Route path="/settings/preferences" element={<PreferencesSettingsPage />} />
        <Route path="/settings/security" element={<SecuritySettingsPage />} />
        {/* Detalhe de um registo: fica depois das rotas fixas para `/records/reminders`
            não ser interpretado como um identificador. */}
        <Route path="/records/:kind/:recordId" element={<RecordDetailPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

/**
 * Guarda de sessão.
 *
 * O estado de carregamento é tratado aqui e não em cada ecrã: enquanto o perfil não chega,
 * não se sabe se o utilizador está autenticado, e mostrar o login durante esse instante
 * produziria o efeito mais irritante possível — um ecrã de login a piscar para quem já tinha
 * sessão.
 */
function RequireSession({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useSession();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="z-auth">
        <div className="z-auth__card">
          <Logo variant="lockup" size={34} />
          <LoadingBlock label="A preparar a tua conta…" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Guardar o destino para onde o utilizador ia: quem abre um link de notificação sem
    // sessão deve chegar lá depois de entrar, e não à página inicial.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return <>{children}</>;
}

/**
 * Um utilizador com sessão que abre `/login` é reencaminhado para o painel — mas só depois
 * de a sessão estar resolvida, pela mesma razão da guarda anterior.
 */
function RedirectIfAuthenticated({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useSession();
  const location = useLocation();
  const state = location.state as { from?: string } | null;

  useEffect(() => {
    // Limpar o estado de navegação depois de o consumir evita que um recarregamento da
    // página reencaminhe outra vez para um destino antigo.
    if (isAuthenticated) window.history.replaceState({}, '');
  }, [isAuthenticated]);

  if (isLoading) {
    return (
      <div className="z-auth">
        <div className="z-auth__card">
          <Logo variant="lockup" size={34} />
          <LoadingBlock label="A verificar a sessão…" />
        </div>
      </div>
    );
  }

  if (isAuthenticated) return <Navigate to={state?.from ?? '/'} replace />;
  return <>{children}</>;
}

/** Sub-rotas do onboarding, dentro de um `Routes` próprio por causa do caminho com `*`. */
function OnboardingRoutes() {
  return (
    <Routes>
      <Route index element={<Navigate to="conta" replace />} />
      <Route path="conta" element={<OnboardingPage step="account" />} />
      <Route path="veiculo" element={<OnboardingPage step="vehicle" />} />
      <Route path="pronto" element={<OnboardingPage step="done" />} />
      <Route path="*" element={<Navigate to="conta" replace />} />
    </Routes>
  );
}

/**
 * Página inexistente.
 *
 * Oferece sempre um caminho de volta. Um ecrã "404" sem saída é o pior sítio para deixar
 * alguém — sobretudo num produto onde o utilizador pode ter chegado aqui por um link de uma
 * versão antiga da própria aplicação.
 */
function NotFoundPage() {
  return (
    <div className="z-page">
      <EmptyState
        icon="🧭"
        title="Não encontrámos esta página"
        body="O endereço pode estar errado ou o registo pode ter sido eliminado. A partir do painel chegas a tudo."
        action={
          <NavLink to="/" className="z-btn z-btn--primary">
            Voltar ao painel
          </NavLink>
        }
      />
    </div>
  );
}
