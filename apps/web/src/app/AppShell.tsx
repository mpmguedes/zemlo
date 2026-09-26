import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { formatNumber } from '@zemlo/shared';
import { useUnreadCount } from '../api/hooks';
import { useSession } from './SessionContext';
import { Logo } from '../components/Logo';
import { EmailVerificationBanner } from '../components/EmailVerificationBanner';
import { VehicleSwitcher } from '../components/VehicleSwitcher';
import { Button } from '../ui/primitives';
import { useQuickLog, QuickLogProvider } from '../components/QuickLogContext';

/**
 * Estrutura da aplicação autenticada.
 *
 * A divisão entre telemóvel e ambiente de trabalho segue a especificação (§35) e não é
 * apenas uma questão de largura:
 *
 *  - **telemóvel** — barra de separadores fixa em baixo, com os quatro destinos que se
 *    usam em movimento (painel, veículos, registos, estatísticas) e um quinto para o
 *    resto. Tudo o que se faz de pé, com uma mão, está a um toque;
 *  - **ambiente de trabalho** — barra lateral com a navegação completa, porque aí há
 *    espaço para tudo estar visível e o utilizador está a gerir, não a consultar.
 *
 * A barra de separadores tem **cinco** destinos e não mais: seis ícones numa barra de
 * telemóvel ficam abaixo do alvo de toque mínimo, e a alternativa — ícones mais pequenos —
 * transforma uma navegação num exercício de pontaria.
 */

interface NavItem {
  to: string;
  label: string;
  icon: string;
  /** Igualdade exata do caminho, para o item "Início" não ficar ativo em todas as rotas. */
  end?: boolean;
  badge?: number;
}

interface NavGroup {
  title?: string;
  items: NavItem[];
}

/**
 * Navegação lateral.
 *
 * A ordem não é alfabética nem por importância técnica: é a ordem em que as perguntas
 * aparecem. Primeiro "como está o meu carro", depois "o que já registei", depois "o que
 * tenho de tratar" e, por fim, "como configuro isto".
 */
function navGroups(unreadCount: number): NavGroup[] {
  return [
    {
      items: [
        { to: '/', label: 'Painel', icon: '🏠', end: true },
        { to: '/vehicles', label: 'Veículos', icon: '🚗' },
      ],
    },
    {
      title: 'Registos',
      items: [
        { to: '/records/expenses', label: 'Despesas', icon: '💶' },
        { to: '/records/fuel', label: 'Abastecimentos', icon: '⛽' },
        { to: '/records/charging', label: 'Carregamentos', icon: '🔌' },
        { to: '/records/maintenance', label: 'Manutenção', icon: '🔧' },
        { to: '/records/reminders', label: 'Lembretes', icon: '🔔' },
        { to: '/documents', label: 'Documentos', icon: '📄' },
      ],
    },
    {
      title: 'Análise',
      items: [
        { to: '/stats', label: 'Estatísticas', icon: '📊' },
        { to: '/timeline', label: 'Histórico', icon: '🕒' },
        { to: '/calendar', label: 'Calendário', icon: '🗓️' },
      ],
    },
    {
      title: 'Conta',
      items: [
        { to: '/notifications', label: 'Notificações', icon: '🔔', badge: unreadCount },
        { to: '/integrations', label: 'Integrações', icon: '🔗' },
        { to: '/export', label: 'Exportar dados', icon: '📤' },
        { to: '/import', label: 'Importar dados', icon: '📥' },
        { to: '/settings', label: 'Definições', icon: '⚙️' },
      ],
    },
  ];
}

export function AppShell() {
  const unreadCount = useUnreadCount();

  return (
    <QuickLogProvider>
      <AppShellLayout unreadCount={unreadCount} />
    </QuickLogProvider>
  );
}

function AppShellLayout({ unreadCount }: { unreadCount: number }) {
  const { profile, signOut } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const quickLog = useQuickLog();

  // Ao mudar de ecrã, fechar a folha de registo rápido. Sem isto, um utilizador que navegue
  // com a folha aberta (pelo botão "voltar" do browser) deixaria o formulário por cima do
  // ecrã novo — e o registo acabaria no veículo errado.
  useEffect(() => {
    quickLog.close();
    // `quickLog` é estável; a dependência real é o caminho.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const logout = useMutation({
    mutationFn: signOut,
    onSuccess: () => navigate('/login', { replace: true }),
  });

  const name = profile?.name?.split(' ')[0] ?? profile?.email ?? '';

  return (
    <div className="z-app">
      <a className="z-skip-link" href="#conteudo">
        Saltar para o conteúdo
      </a>

      <Sidebar unreadCount={unreadCount} name={name} onSignOut={() => logout.mutate()} signingOut={logout.isPending} />

      <header className="z-topbar">
        <NavLink to="/" aria-label="Zemlo — painel">
          <Logo variant="icon" size={26} title={null} />
        </NavLink>
        <span className="z-topbar__spacer" />
        <VehicleSwitcher />
        <NavLink to="/notifications" className="z-icon-btn" aria-label={`Notificações${unreadCount > 0 ? ` (${formatNumber(unreadCount, 0)} por ler)` : ''}`}>
          <span style={{ position: 'relative' }}>
            🔔
            {unreadCount > 0 ? <span className="z-tabbar__badge">{unreadCount > 9 ? '9+' : unreadCount}</span> : null}
          </span>
        </NavLink>
      </header>

      {/*
        `tabIndex={-1}` porque este `main` é o alvo de foco da mudança de rota (`WEB-012`) e o
        destino do link «Saltar para o conteúdo» — um elemento sem `tabindex` aceita `.focus()`
        sem erro e **sem efeito**, pelo que o efeito de navegação correria para nada. Sendo
        `-1`, fica focável por programa e continua **fora** da ordem de tabulação: não aparece
        nenhum destino novo a quem navega com `Tab`.
      */}
      <main className="z-main" id="conteudo" tabIndex={-1}>
        {/*
          O aviso de email por confirmar vive aqui, e não em cada ecrã: é uma condição da
          conta, não de uma página. Dentro do `main` fica acima de tudo o que o ecrã
          mostrar, sem competir com a barra superior — e sem se repetir em nenhum sítio.
        */}
        <EmailVerificationBanner />
        <Outlet />
      </main>

      <TabBar unreadCount={unreadCount} />
    </div>
  );
}

function Sidebar({
  unreadCount,
  name,
  onSignOut,
  signingOut,
}: {
  unreadCount: number;
  name: string;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  const groups = navGroups(unreadCount);
  const quickLog = useQuickLog();

  return (
    <nav className="z-sidebar" aria-label="Navegação principal">
      <div className="z-sidebar__brand">
        <Logo variant="lockup" size={28} />
      </div>
      <span className="z-sidebar__tagline">O teu veículo, sem ruído.</span>

      <Button
        variant="highlight"
        block
        icon="＋"
        onClick={() => quickLog.openMenu()}
        className="z-sidebar__action"
      >
        Registar
      </Button>

      {groups.map((group) => (
        <div className="z-sidebar__group" key={group.title ?? 'principal'}>
          {group.title ? <div className="z-sidebar__group-title">{group.title}</div> : null}
          {group.items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className="z-sidebar__link">
              <span className="z-sidebar__icon" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
              {item.badge && item.badge > 0 ? (
                <span className="z-chip z-chip--warn z-sidebar__badge">{formatNumber(item.badge, 0)}</span>
              ) : null}
            </NavLink>
          ))}
        </div>
      ))}

      <div className="z-sidebar__footer">
        <div className="z-xs z-muted" style={{ padding: '0 var(--z-space-3) var(--z-space-2)' }}>
          Sessão de {name}
        </div>
        <button type="button" className="z-sidebar__link" onClick={onSignOut} disabled={signingOut} style={{ width: '100%', border: 0, background: 'transparent', cursor: 'pointer', font: 'inherit' }}>
          <span className="z-sidebar__icon" aria-hidden="true">
            ⎋
          </span>
          Terminar sessão
        </button>
      </div>
    </nav>
  );
}

/**
 * Barra de separadores do telemóvel.
 *
 * O quinto destino ("Mais") não é uma rota: abre o menu lateral em telemóvel? Não — a
 * aplicação não tem menu lateral em telemóvel, de propósito. O quinto item leva às
 * Definições, que é o destino com mais subpáginas, e a partir daí chega-se a tudo. Os
 * ecrãs secundários (calendário, histórico, exportar) são alcançáveis a partir do painel e
 * das definições, o que evita um menu "hambúrguer" que esconde metade do produto.
 */
function TabBar({ unreadCount }: { unreadCount: number }) {
  const quickLog = useQuickLog();

  return (
    <>
      {/*
        O botão de registo rápido é destacado a âmbar — é a ação que o produto quer
        promover, e o âmbar existe precisamente para isto (§57). Não é um separador: é um
        botão, e por isso não fica ativo em nenhuma rota.

        Abre o **menu de tipos** (decisão 46) e não um formulário concreto. Antes abria
        sempre a despesa: quem queria um abastecimento tinha de abrir uma despesa, fechar e
        procurar o ecrã certo — três passos para chegar a um formulário que já existia.
      */}
      <div className="z-tabbar" role="navigation" aria-label="Navegação principal">
        <TabLink to="/" label="Painel" icon="🏠" end />
        <TabLink to="/vehicles" label="Veículos" icon="🚗" />
        <button
          type="button"
          className="z-tabbar__link"
          onClick={() => quickLog.openMenu()}
          style={{ border: 0, background: 'transparent', cursor: 'pointer' }}
        >
          <span
            className="z-tabbar__icon"
            aria-hidden="true"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 34,
              height: 34,
              borderRadius: '50%',
              background: 'var(--z-highlight)',
              color: 'var(--z-highlight-contrast)',
              fontSize: '1.2rem',
            }}
          >
            ＋
          </span>
          <span>Registar</span>
        </button>
        <TabLink to="/records/expenses" label="Registos" icon="📋" />
        <TabLink to="/notifications" label="Avisos" icon="🔔" badge={unreadCount} />
      </div>
    </>
  );
}

function TabLink({
  to,
  label,
  icon,
  end,
  badge,
}: {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
  badge?: number;
}) {
  return (
    <NavLink to={to} end={end} className="z-tabbar__link">
      <span className="z-tabbar__icon" aria-hidden="true">
        {icon}
        {badge && badge > 0 ? <span className="z-tabbar__badge">{badge > 9 ? '9+' : badge}</span> : null}
      </span>
      <span>{label}</span>
      {/*
       * O badge vive dentro do ícone, que é `aria-hidden` — o número nunca chegava ao leitor
       * de ecrã, e o nome acessível do link era só «Avisos». Movê-lo para fora do ícone
       * partiria o posicionamento absoluto que o encosta ao canto dele (`app.css`,
       * `.z-tabbar__badge`). A contagem vai então num texto só para leitores de ecrã, a
       * seguir ao rótulo: o nome passa a ser «Avisos 3 por ler» (`WEB-006`, achado A3).
       *
       * Escreve-se o número por extenso (`12 por ler`) e não o `9+` do badge: o `9+` existe
       * para caber num círculo de 16 px, e essa restrição não existe em texto lido em voz
       * alta. A barra lateral já fazia isto bem — era a barra inferior que discordava.
       */}
      {badge && badge > 0 ? (
        <span className="z-sr-only">{`${formatNumber(badge, 0)} por ler`}</span>
      ) : null}
    </NavLink>
  );
}
