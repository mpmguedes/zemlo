import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  useChangePassword,
  useConfirmTwoFactor,
  useDisableTwoFactor,
  useRevokeSession,
  useSessions,
  useTwoFactorSetup,
} from '../../api/hooks';
import { auth, clearTokens, api } from '../../api/client';
import { errorMessage, errorRequestId } from '../../api/errors';
import { ApiError } from '../../api/client';
import { useSession } from '../../app/SessionContext';
import { Button, Card, Chip, InlineError, LoadingBlock, PageHeader, Section } from '../../ui/primitives';
import { TextField } from '../../ui/form';
import { useForm } from '../../hooks/useForm';
import { useCopyToClipboard } from '../../hooks';
import { useToast } from '../../ui/Toaster';
import { encodeQr, qrToSvgPath } from '../../lib/qr';
import { dateLong } from '../../lib/format';

/**
 * Segurança.
 *
 * O ecrã mais delicado da aplicação, e o que tem mais cuidado a escrever.
 *
 * **A verificação em dois passos funciona de verdade.** `POST /me/2fa/setup` devolve um
 * segredo em base32, um URI `otpauth://` e dez códigos de recuperação. O URI é codificado
 * **no cliente** num QR — e o codificador é uma implementação real de ISO/IEC 18004
 * (`src/lib/qr.ts`), com correção de erros Reed–Solomon e escolha de máscara pelas regras de
 * penalização da norma. Não é uma imagem decorativa: é um QR a sério, verificado com os
 * vetores publicados da norma.
 *
 * Escolhemos desenhar o QR em vez de o substituir por texto? Não — as duas coisas. O segredo
 * e o URI estão visíveis e copiáveis ao lado do código. Um QR que o leitor do telemóvel não
 * consiga ler (ecrã rachado, brilho, câmara gasta) não pode ser o único caminho: quem está a
 * configurar o segundo fator tem de poder escrever o segredo à mão, sempre.
 *
 * As três secções seguintes — password, dispositivos e eliminação de conta — estão ordenadas
 * por reversibilidade: mudar a password é reversível, revogar um dispositivo é reversível,
 * eliminar a conta não é. A última leva aviso explícito e o pedido de uma palavra escrita.
 */
export function SecuritySettingsPage() {
  const { profile } = useSession();

  return (
    <div className="z-page">
      <PageHeader
        title="Segurança"
        subtitle="Verificação em dois passos, password e dispositivos com sessão."
        back={{ to: '/settings', label: 'Definições' }}
      />

      <TwoFactorSection enabled={profile?.twoFactorEnabled ?? false} />
      <PasswordSection />
      <SessionsSection />
      <DangerSection twoFactorEnabled={profile?.twoFactorEnabled ?? false} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Verificação em dois passos (§29)                                            */
/* -------------------------------------------------------------------------- */

function TwoFactorSection({ enabled }: { enabled: boolean }) {
  const startSetup = useTwoFactorSetup();
  const confirm = useConfirmTwoFactor();
  const disable = useDisableTwoFactor();
  const toast = useToast();
  const [copied, copy] = useCopyToClipboard();

  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string; recoveryCodes: string[] } | null>(null);
  const [totp, setTotp] = useState('');
  const [error, setError] = useState<unknown>(null);

  /*
   * O QR é calculado a partir do URI `otpauth://`. Se o codificador falhar (URI fora dos
   * limites de versão, por exemplo), `qr` fica `null` e o ecrã mostra o segredo e o URI em
   * texto com instruções — que é o comportamento de recurso previsto, e não uma imagem
   * falsa nem um erro bloqueante.
   */
  let qr: ReturnType<typeof encodeQr> | null = null;
  let qrError: string | null = null;
  if (setup) {
    try {
      qr = encodeQr(setup.otpauthUri, { level: 'L' });
    } catch (caught) {
      qrError = (caught as Error).message;
    }
  }

  async function onStart(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const result = await startSetup.mutateAsync(password);
      setSetup(result);
      setPassword('');
    } catch (caught) {
      setError(caught);
    }
  }

  async function onConfirm(event: FormEvent) {
    event.preventDefault();
    if (!setup) return;
    setError(null);
    try {
      await confirm.mutateAsync({ secret: setup.secret, totp, recoveryCodes: setup.recoveryCodes });
      setSetup(null);
      setTotp('');
      toast.show('Verificação em dois passos ativa.', { variant: 'ok' });
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <Section
      title="Verificação em dois passos"
      hint={enabled ? 'ativa' : 'inativa'}
    >
      <Card>
        {enabled ? (
          <>
            <div className="z-row z-row--between z-row--wrap">
              <div>
                <div className="z-card__title">🔐 Está ativa</div>
                <div className="z-card__subtitle">
                  A tua conta exige um código da app autenticadora além da password.
                </div>
              </div>
              <Chip tone="ok">Protegida</Chip>
            </div>
            <p className="z-small z-muted" style={{ marginTop: 'var(--z-space-3)' }}>
              Guardaste os dez códigos de recuperação quando ativaste? Sem eles, perder o
              telemóvel significa perder o acesso à conta. Se já não os tens, desativa e volta a
              ativar para gerar um conjunto novo.
            </p>
            <form
              className="z-stack"
              style={{ marginTop: 'var(--z-space-4)', maxWidth: 420 }}
              onSubmit={(event) => {
                event.preventDefault();
                setError(null);
                void disable
                  .mutateAsync({ password, ...(totp ? { totp } : {}) })
                  .then(() => toast.show('Verificação em dois passos desativada.', { variant: 'info' }))
                  .catch(setError);
              }}
            >
              <TextField
                label="Password atual"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <TextField
                label="Código de 6 dígitos"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={totp}
                onChange={(event) => setTotp(event.target.value)}
                hint="Opcional se o 2FA ainda estiver ativo mas quiseres confirmar por password."
              />
              <Button type="submit" variant="danger" loading={disable.isPending}>
                Desativar verificação em dois passos
              </Button>
            </form>
          </>
        ) : setup ? (
          <>
            <div className="z-card__title">Liga a tua app autenticadora</div>
            <p className="z-small z-muted" style={{ marginTop: 'var(--z-space-2)' }}>
              Abre a app (Google Authenticator, Authy, 1Password, FreeOTP…) e adiciona a conta.
              Podes ler o código abaixo com a câmara ou escrever o segredo à mão — as duas
              opções funcionam.
            </p>

            {qr ? (
              <div className="z-qr" style={{ marginTop: 'var(--z-space-4)' }}>
                {/*
                  O QR é um único `<path>` com um subcaminho por módulo escuro. O fundo é
                  sempre branco, mesmo com o tema escuro: um QR invertido não é lido pela
                  maioria dos leitores, e este elemento tem de funcionar, não de combinar.
                */}
                <svg
                  viewBox={`0 0 ${qr.size} ${qr.size}`}
                  role="img"
                  aria-label={`Código QR para adicionar a conta Zemlo à tua app autenticadora. Se preferires, usa o segredo em texto: ${setup.secret}`}
                  shapeRendering="crispEdges"
                >
                  <rect width={qr.size} height={qr.size} fill="#ffffff" />
                  <path d={qrToSvgPath(qr)} fill="#000000" />
                </svg>
              </div>
            ) : (
              <div className="z-banner z-banner--warn" style={{ marginTop: 'var(--z-space-4)' }}>
                <span className="z-banner__icon" aria-hidden="true">ℹ️</span>
                <div className="z-banner__body">
                  Não foi possível gerar o código QR{qrError ? ` (${qrError})` : ''}. Usa o segredo
                  em texto abaixo — funciona exatamente da mesma forma.
                </div>
              </div>
            )}

            <div className="z-stack" style={{ marginTop: 'var(--z-space-4)' }}>
              <div className="z-field">
                <span className="z-field__label">Segredo (para introduzir à mão)</span>
                <div className="z-copyfield">
                  <span className="z-copyfield__value">{setup.secret}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void copy(setup.secret).then((ok) =>
                        toast.show(ok ? 'Segredo copiado.' : 'Não foi possível copiar — seleciona o texto à mão.', {
                          variant: ok ? 'ok' : 'danger',
                        }),
                      );
                    }}
                  >
                    {copied ? '✓' : 'Copiar'}
                  </Button>
                </div>
                <span className="z-field__hint">
                  Base32, sem espaços. Na app autenticadora escolhe «introduzir chave
                  manualmente».
                </span>
              </div>

              <div className="z-field">
                <span className="z-field__label">Endereço de configuração</span>
                <div className="z-copyfield">
                  <span className="z-copyfield__value">{setup.otpauthUri}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void copy(setup.otpauthUri).then((ok) =>
                        toast.show(ok ? 'Endereço copiado.' : 'Não foi possível copiar.', { variant: ok ? 'ok' : 'danger' }),
                      );
                    }}
                  >
                    Copiar
                  </Button>
                </div>
                <span className="z-field__hint">
                  Um URI <span className="z-mono">otpauth://</span> padrão. Se a tua app aceitar
                  colar um endereço, é isto que ela espera.
                </span>
              </div>

              <div className="z-field">
                <span className="z-field__label">Códigos de recuperação</span>
                <div className="z-codes">
                  {setup.recoveryCodes.map((code) => (
                    <span className="z-code" key={code}>
                      {code}
                    </span>
                  ))}
                </div>
                <span className="z-field__hint">
                  Guarda-os fora do telemóvel — papel, gestor de passwords. Cada um serve uma vez.
                  São a única forma de entrar se perderes o telemóvel.
                </span>
                <div className="z-row" style={{ marginTop: 'var(--z-space-2)' }}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      void copy(setup.recoveryCodes.join('\n')).then((ok) =>
                        toast.show(ok ? 'Códigos copiados.' : 'Não foi possível copiar.', { variant: ok ? 'ok' : 'danger' }),
                      );
                    }}
                  >
                    Copiar todos os códigos
                  </Button>
                </div>
              </div>
            </div>

            <form className="z-stack" style={{ marginTop: 'var(--z-space-4)', maxWidth: 420 }} onSubmit={onConfirm}>
              <TextField
                label="Código de 6 dígitos da app"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                pattern="\d{6}"
                placeholder="123456"
                value={totp}
                onChange={(event) => setTotp(event.target.value)}
                hint="Confirma que a app está sincronizada antes de ativares."
                error={error instanceof ApiError ? error.fieldError('totp') : undefined}
              />
              {error ? <InlineError message={errorMessage(error)} requestId={errorRequestId(error)} /> : null}
              <div className="z-row" style={{ gap: 'var(--z-space-3)' }}>
                <Button type="submit" variant="primary" loading={confirm.isPending} disabled={totp.length !== 6}>
                  Ativar
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setSetup(null);
                    setTotp('');
                    setError(null);
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          </>
        ) : (
          <>
            <div className="z-card__title">🔓 Ainda não está ativa</div>
            <p className="z-small z-muted" style={{ marginTop: 'var(--z-space-2)' }}>
              Com a verificação em dois passos, uma password descoberta deixa de ser suficiente
              para entrar na tua conta. Não custa nada a usar: depois de configurada, passas a
              introduzir seis dígitos da app uma vez por dispositivo.
            </p>
            <form className="z-stack" style={{ marginTop: 'var(--z-space-4)', maxWidth: 420 }} onSubmit={onStart}>
              <TextField
                label="Password atual"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                error={error instanceof ApiError ? error.fieldError('password') : undefined}
              />
              {error ? <InlineError message={errorMessage(error)} requestId={errorRequestId(error)} /> : null}
              <Button type="submit" variant="primary" loading={startSetup.isPending} disabled={password.length === 0}>
                Começar a configuração
              </Button>
            </form>
          </>
        )}
      </Card>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Password                                                                    */
/* -------------------------------------------------------------------------- */

function PasswordSection() {
  const change = useChangePassword();
  const toast = useToast();
  const form = useForm({ current: '', next: '', confirm: '' });
  const [error, setError] = useState<unknown>(null);
  const mismatch = form.values.confirm.length > 0 && form.values.next !== form.values.confirm;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (mismatch) return;
    try {
      const result = await change.mutateAsync({
        currentPassword: form.values.current,
        newPassword: form.values.next,
        // Revogar as outras sessões é a omissão correta: quem está a mudar a password porque
        // suspeita de acesso indevido quer exatamente isso, e quem não o quer pode desmarcar.
        revokeOtherSessions: true,
      });
      form.reset();
      toast.show(
        result.revokedSessions > 0
          ? `Password alterada. ${result.revokedSessions} ${result.revokedSessions === 1 ? 'sessão terminada' : 'sessões terminadas'} noutros dispositivos.`
          : 'Password alterada.',
        { variant: 'ok' },
      );
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <Section title="Password">
      <Card>
        <form className="z-stack" style={{ maxWidth: 420 }} onSubmit={onSubmit}>
          <TextField
            label="Password atual"
            type="password"
            autoComplete="current-password"
            required
            value={form.values.current}
            onChange={(event) => form.setValue('current', event.target.value)}
            error={error instanceof ApiError ? error.fieldError('currentPassword') : undefined}
          />
          <TextField
            label="Nova password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={form.values.next}
            onChange={(event) => form.setValue('next', event.target.value)}
            hint="Pelo menos 10 caracteres. Uma frase que te lembres é melhor do que símbolos que vais anotar."
            error={error instanceof ApiError ? error.fieldError('newPassword') : undefined}
          />
          <TextField
            label="Repetir a nova password"
            type="password"
            autoComplete="new-password"
            required
            value={form.values.confirm}
            onChange={(event) => form.setValue('confirm', event.target.value)}
            error={mismatch ? 'As passwords não coincidem.' : undefined}
          />
          {error ? <InlineError message={errorMessage(error)} requestId={errorRequestId(error)} /> : null}
          <Button
            type="submit"
            variant="primary"
            loading={change.isPending}
            disabled={mismatch || !form.values.current || form.values.next.length < 10}
          >
            Alterar password
          </Button>
          <p className="z-xs z-muted">
            Ao alterar, as sessões nos outros dispositivos são terminadas. Esta mantém-se aberta.
          </p>
        </form>
      </Card>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Dispositivos com sessão                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Dispositivos com sessão.
 *
 * A lista mostra o rótulo do dispositivo, o endereço IP e a última utilização. Revogar uma
 * sessão é o botão de emergência mais útil que existe: quando alguém percebe que deixou a
 * sessão aberta num computador alheio, é isto que quer fazer — e tem de ser imediato.
 *
 * A API invalida o token de acesso no pedido seguinte (a sessão é verificada em cada pedido),
 * pelo que a revogação não depende de o dispositivo voltar a falar com o servidor.
 */
function SessionsSection() {
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const toast = useToast();
  const { signOut } = useSession();

  return (
    <Section title="Dispositivos com sessão" hint={sessions.data ? `${sessions.data.items.length}` : undefined}>
      {sessions.isLoading ? <LoadingBlock label="A carregar dispositivos…" /> : null}
      {sessions.isError ? (
        <InlineError
          message={errorMessage(sessions.error)}
          requestId={errorRequestId(sessions.error)}
          onRetry={() => void sessions.refetch()}
        />
      ) : null}
      {sessions.data ? (
        <Card flush>
          <div className="z-list">
            {sessions.data.items.map((session) => (
              <div className="z-list__item" key={session.id}>
                <span className="z-list__icon" aria-hidden="true">
                  {(session.deviceLabel ?? '').toLowerCase().includes('ios') ||
                  (session.deviceLabel ?? '').toLowerCase().includes('android')
                    ? '📱'
                    : '💻'}
                </span>
                <span className="z-list__body">
                  <span className="z-list__title">
                    {session.deviceLabel ?? 'Dispositivo desconhecido'}
                    {session.current ? ' · esta sessão' : ''}
                  </span>
                  <span className="z-list__meta">
                    Última utilização: {dateLong(session.lastUsedAt.slice(0, 10))}
                    {session.ipAddress ? ` · ${session.ipAddress}` : ''}
                  </span>
                  <span className="z-list__meta">Expira em {dateLong(session.expiresAt.slice(0, 10))}</span>
                </span>
                <span className="z-list__trailing">
                  {session.current ? (
                    <Chip tone="ok">atual</Chip>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={revoke.isPending}
                      onClick={() => {
                        if (window.confirm('Terminar esta sessão? O dispositivo terá de iniciar sessão novamente.')) {
                          void revoke.mutateAsync(session.id).then(() => toast.show('Sessão terminada.', { variant: 'ok' }));
                        }
                      }}
                    >
                      Terminar
                    </Button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
      <div className="z-row" style={{ marginTop: 'var(--z-space-3)', gap: 'var(--z-space-2)' }}>
        <Button
          variant="secondary"
          onClick={() =>
            void api
              .post<{ revokedSessions: number }>('/auth/logout-all')
              .then((result) =>
                toast.show(
                  `${result.revokedSessions} ${result.revokedSessions === 1 ? 'sessão terminada' : 'sessões terminadas'}.`,
                  { variant: 'ok' },
                ),
              )
              .then(() => signOut())
              .catch(() => toast.show('Não foi possível terminar as sessões.', { variant: 'danger' }))
          }
        >
          Terminar todas as sessões
        </Button>
        <Button variant="ghost" onClick={() => void auth.logout().then(clearTokens)}>
          Sair agora
        </Button>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Eliminação de conta (§30)                                                   */
/* -------------------------------------------------------------------------- */

function DangerSection({ twoFactorEnabled }: { twoFactorEnabled: boolean }) {
  const { signOut } = useSession();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  async function onDelete(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      // `DELETE` com corpo: o contrato exige `confirm: "ELIMINAR"` e a password, e um
      // pedido sem eles é recusado — o que impede que um clique acidental apague uma conta.
      await api.delete('/me', {
        confirm: 'ELIMINAR',
        ...(password ? { password } : {}),
        ...(totp ? { totp } : {}),
      });
      toast.show('Conta eliminada. Obrigado por teres usado o Zemlo.', { variant: 'info' });
      await signOut();
    } catch (caught) {
      setError(caught);
    } finally {
      setPending(false);
    }
  }

  return (
    <Section title="Eliminar a conta">
      <Card soft>
        <div className="z-stack">
          <p className="z-small">
            Eliminar a conta apaga **tudo**: veículos, registos, documentos, histórico e
            integrações. É imediato e não há forma de recuperar. Se quiseres apenas uma pausa,
            podes simplesmente sair e voltar quando quiseres — a conta fica à tua espera.
          </p>
          <p className="z-small">
            Antes de eliminar, considera <Link to="/export">exportar os teus dados</Link>. Levam
            um minuto e ficam teus para sempre.
          </p>

          {open ? (
            <form className="z-stack" style={{ maxWidth: 460 }} onSubmit={onDelete}>
              <TextField
                label="Escreve ELIMINAR para confirmar"
                required
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                hint="Em maiúsculas, exatamente como está escrito."
              />
              <TextField
                label="Password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              {twoFactorEnabled ? (
                <TextField
                  label="Código de 6 dígitos"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={totp}
                  onChange={(event) => setTotp(event.target.value)}
                  hint="Exigido porque tens a verificação em dois passos ativa."
                />
              ) : null}
              {error ? <InlineError message={errorMessage(error)} requestId={errorRequestId(error)} /> : null}
              <div className="z-row" style={{ gap: 'var(--z-space-3)' }}>
                <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  variant="danger"
                  loading={pending}
                  disabled={confirmation !== 'ELIMINAR' || password.length === 0 || (twoFactorEnabled && totp.length !== 6)}
                >
                  Eliminar a minha conta definitivamente
                </Button>
              </div>
            </form>
          ) : (
            <div>
              <Button variant="danger" onClick={() => setOpen(true)}>
                Quero eliminar a minha conta
              </Button>
            </div>
          )}
        </div>
      </Card>
    </Section>
  );
}


