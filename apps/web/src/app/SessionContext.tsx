import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UserProfile } from '@zemlo/shared';
import { auth, clearTokens, getAccessToken, getRefreshToken, onSessionExpired } from '../api/client';
import { queryKeys } from '../api/queryKeys';
import { Button, EmptyState } from '../ui/primitives';

/**
 * Sessão da aplicação.
 *
 * O estado de sessão não vive no React Query — o perfil sim, a *sessão* não: a diferença é
 * que o perfil é um recurso do servidor (pode ser recarregado, pode ficar obsoleto) e a
 * sessão é uma decisão do cliente sobre se há, ou não, um utilizador autenticado. Misturar
 * as duas coisas é o que produz ecrãs que mostram dados de um utilizador já terminado.
 *
 * O contexto expõe três coisas: o perfil (quando há sessão), o estado de carregamento e as
 * ações de entrar/sair. Tudo o resto da aplicação consulta o perfil pelo React Query
 * diretamente (`useProfile`), para que o mesmo dado tenha uma única cache.
 */

interface SessionContextValue {
  profile: UserProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** Motivo da última expiração de sessão, para explicar o regresso ao login. */
  expiredReason: string | null;
  signIn: (email: string, password: string, totp?: string) => Promise<UserProfile>;
  signUp: (payload: { email: string; password: string; name?: string; acceptedTerms: true }) => Promise<UserProfile>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  clearExpiredReason: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  /*
   * `hasCredentials` é o estado síncrono que decide se vale a pena pedir o perfil. Vem do
   * armazenamento, não de uma chamada à rede: uma aplicação que só sabe se há sessão
   * depois de uma ida ao servidor mostra um ecrã de carregamento a quem não tem sessão.
   *
   * O ramo do token de renovação é o que faz a sessão sobreviver ao fecho do separador: o
   * token de acesso vive em `sessionStorage` e desaparece, o de renovação vive em
   * `localStorage` e fica. Quem volta no dia seguinte entra com credenciais, o primeiro
   * pedido recebe 401 e é renovado em silêncio — é assim que os 90 dias configurados se
   * tornam 90 dias reais. Este ramo esteve morto até `WEB-013`: `getRefreshToken()`
   * devolvia sempre `null`, pelo que a única credencial que contava era a de uma hora.
   */
  const [hasCredentials, setHasCredentials] = useState<boolean>(
    () => Boolean(getAccessToken() ?? getRefreshToken()),
  );
  const [expiredReason, setExpiredReason] = useState<string | null>(null);

  const profileQuery = useQuery({
    queryKey: queryKeys.me,
    queryFn: auth.me,
    enabled: hasCredentials,
    // Quatro segundos e sem repetições: o perfil decide se o ecrã é o login ou a
    // aplicação, e um utilizador à espera de decidir isso é tempo perdido.
    retry: false,
    staleTime: 5 * 60_000,
  });

  // Sessão terminada do lado do servidor (token revogado, expirado, conta eliminada).
  useEffect(() => {
    onSessionExpired(() => {
      clearTokens();
      setHasCredentials(false);
      setExpiredReason('A tua sessão terminou. Inicia sessão novamente para continuar.');
      client.clear();
    });
    return () => onSessionExpired(null);
  }, [client]);

  useEffect(() => {
    if (!profileQuery.isError || !hasCredentials) return;
    // Credenciais guardadas que já não servem: limpar e voltar ao login é mais honesto do
    // que manter a aplicação a tentar carregar dados que nunca vão chegar.
    clearTokens();
    setHasCredentials(false);
    setExpiredReason('Precisamos que inicies sessão novamente.');
    client.clear();
  }, [profileQuery.isError, hasCredentials, client]);

  const afterAuth = useCallback(
    async (returned: UserProfile) => {
      setExpiredReason(null);
      setHasCredentials(true);
      client.setQueryData(queryKeys.me, returned);
      return returned;
    },
    [client],
  );

  const signIn = useCallback<SessionContextValue['signIn']>(
    async (email, password, totp) => {
      // `auth.login` devolve o perfil, não a sessão: o token de renovação fica no cliente
      // HTTP e não passa por estado do React nem por props.
      const profile = await auth.login(email, password, totp);
      return afterAuth(profile);
    },
    [afterAuth],
  );

  const signUp = useCallback<SessionContextValue['signUp']>(
    async (payload) => {
      const profile = await auth.signup(payload);
      return afterAuth(profile);
    },
    [afterAuth],
  );

  const signOut = useCallback(async () => {
    await auth.logout();
    setHasCredentials(false);
    setExpiredReason(null);
    // Limpar a cache é obrigatório: sem isto, o próximo início de sessão (possivelmente
    // com outra conta) veria durante um instante os veículos e os custos do anterior.
    client.clear();
  }, [client]);

  const refreshProfile = useCallback(async () => {
    await client.invalidateQueries({ queryKey: queryKeys.me });
  }, [client]);

  const value = useMemo<SessionContextValue>(
    () => ({
      profile: profileQuery.data ?? null,
      // `isLoading` é verdadeiro enquanto houver credenciais e a resposta ainda não tiver
      // chegado — é o que impede o router de decidir "não autenticado" cedo demais.
      isLoading: hasCredentials && (profileQuery.isLoading || profileQuery.isFetching) && !profileQuery.data,
      isAuthenticated: Boolean(profileQuery.data),
      expiredReason,
      signIn,
      signUp,
      signOut,
      refreshProfile,
      clearExpiredReason: () => setExpiredReason(null),
    }),
    [profileQuery.data, profileQuery.isLoading, profileQuery.isFetching, hasCredentials, expiredReason, signIn, signUp, signOut, refreshProfile],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession tem de ser usado dentro de <SessionProvider>.');
  return context;
}

/**
 * Ecrã de indisponibilidade da API.
 *
 * Existe porque o pior comportamento possível de uma aplicação offline é um ecrã em branco
 * ou um ciclo de recarregamentos: o utilizador tem de saber que o problema é de rede, que
 * não é da conta dele, e o que pode fazer.
 */
export function SessionUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="z-auth">
      <div className="z-auth__card">
        <EmptyState
          icon="📡"
          title="Não conseguimos contactar o Zemlo"
          body="Os teus dados estão seguros. Verifica a ligação à internet e tenta novamente — se persistir, é do nosso lado e já estamos a ver."
          action={<Button variant="primary" onClick={onRetry}>Tentar novamente</Button>}
        />
      </div>
    </div>
  );
}
