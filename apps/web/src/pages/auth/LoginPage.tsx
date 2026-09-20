import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from '../../hooks/useForm';
import { useSession } from '../../app/SessionContext';
import { Logo } from '../../components/Logo';
import { Banner, Button } from '../../ui/primitives';
import { ApiError } from '../../api/client';

/**
 * Início de sessão.
 *
 * Três decisões de produto visíveis neste ecrã:
 *
 *  1. **O segundo fator aparece só quando é preciso.** O campo `totp` é revelado depois de
 *     o servidor responder `unauthorized` com a indicação de que a conta tem 2FA ativo (a
 *     API não distingue "password errada" de "falta o código" por código de erro, pelo que
 *     o pedido é reenviado com o código depois de o utilizador o introduzir). Mostrar sempre
 *     um campo de "código de 6 dígitos" a quem não tem 2FA ativo é ruído e assusta.
 *  2. **A mensagem de erro é a da API.** "Precisas de iniciar sessão" ou "as credenciais não
 *     conferem" são frases que a API já escreve em português e no tom certo (§59). O ecrã
 *     não as reescreve.
 *  3. **O botão da Google está visível e desativado, com a razão à vista.** Esconder uma
 *     funcionalidade que não existe é pior do que mostrá-la e explicar: o utilizador que
 *     procura "entrar com a Google" tem de encontrar a resposta, não a ausência.
 */
export function LoginPage() {
  const { signIn, expiredReason, clearExpiredReason } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const destination = (location.state as { from?: string } | null)?.from ?? '/';

  const form = useForm({ email: '', password: '', totp: '' });
  const [showSecondFactor, setShowSecondFactor] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    form.clearErrors();
    form.setSubmitting(true);
    clearExpiredReason();
    try {
      await signIn(form.values.email, form.values.password, showSecondFactor ? form.values.totp : undefined);
      navigate(destination, { replace: true });
      return;
    } catch (caught) {
      setError(caught);
      form.setServerError(caught);
      // Um 401 com a password já preenchida é, na prática, um pedido de segundo fator. Não
      // é possível distingui-lo de uma password errada sem o perguntar ao servidor, pelo
      // que mostramos o campo e mantemos a mensagem de erro: se a password estava mesmo
      // errada, a mensagem continua a ser verdadeira.
      if (caught instanceof ApiError && caught.code === 'unauthorized' && !showSecondFactor) {
        setShowSecondFactor(true);
      }
    } finally {
      form.setSubmitting(false);
    }
  }

  const pending = form.isSubmitting;

  return (
    <div className="z-auth">
      <div className="z-auth__card">
        <div className="z-auth__head">
          <Logo variant="lockup" size={38} />
          <h1 className="z-auth__title">Bem-vindo de volta</h1>
          <p className="z-auth__subtitle">O teu veículo, sem ruído.</p>
        </div>

        {expiredReason ? <Banner tone="info">{expiredReason}</Banner> : null}

        <form className="z-stack" onSubmit={onSubmit} noValidate>
          <div className="z-field">
            <label className="z-field__label" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              className="z-input"
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              required
              value={form.values.email}
              onChange={(event) => form.setValue('email', event.target.value)}
              aria-invalid={form.fieldError('email') ? true : undefined}
            />
            {form.fieldError('email') ? <span className="z-field__error" role="alert">{form.fieldError('email')}</span> : null}
          </div>

          <div className="z-field">
            <label className="z-field__label" htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              className="z-input"
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={form.values.password}
              onChange={(event) => form.setValue('password', event.target.value)}
              aria-invalid={form.fieldError('password') ? true : undefined}
            />
            {form.fieldError('password') ? <span className="z-field__error" role="alert">{form.fieldError('password')}</span> : null}
          </div>

          {showSecondFactor ? (
            <div className="z-field">
              <label className="z-field__label" htmlFor="login-totp">
                Código de verificação
              </label>
              <input
                id="login-totp"
                className="z-input"
                type="text"
                name="totp"
                autoComplete="one-time-code"
                inputMode="numeric"
                placeholder="123456"
                value={form.values.totp}
                onChange={(event) => form.setValue('totp', event.target.value)}
                aria-invalid={form.fieldError('totp') ? true : undefined}
              />
              <span className="z-field__hint">
                Os 6 dígitos da tua app autenticadora — ou, se perdeste o telemóvel, um dos
                códigos de recuperação no formato XXXXX-XXXXX.
              </span>
              {form.fieldError('totp') ? <span className="z-field__error" role="alert">{form.fieldError('totp')}</span> : null}
            </div>
          ) : null}

          {error ? (
            <div className="z-inline-error" role="alert">
              <span>{error instanceof ApiError ? error.message : 'Não foi possível iniciar sessão. Tenta novamente.'}</span>
              {error instanceof ApiError && error.requestId ? (
                <span className="z-request-id">Referência para apoio: {error.requestId}</span>
              ) : null}
            </div>
          ) : null}

          <Button type="submit" variant="primary" block loading={pending || form.isSubmitting}>
            Entrar
          </Button>
        </form>

        {/*
          O botão de Google: visível, desativado e com a razão escrita. Um botão desativado
          sem explicação é pior do que não existir; com a razão, é informação sobre o estado
          do produto (§59: informar, não prometer).
        */}
        <div className="z-stack z-stack--tight">
          <div className="z-row" style={{ gap: 'var(--z-space-3)' }}>
            <hr className="z-divider" style={{ flex: 1 }} />
            <span className="z-xs z-muted">ou</span>
            <hr className="z-divider" style={{ flex: 1 }} />
          </div>
          <Button variant="secondary" block disabled icon="🔵">
            Continuar com Google
          </Button>
          <p className="z-xs z-muted">
            Ainda não está disponível: a entrada com Google exige credenciais OAuth configuradas
            no servidor, que este ambiente não tem. Fica pronta assim que existirem — não é um
            botão decorativo.
          </p>
        </div>

        <p className="z-auth__footer">
          Ainda não tens conta? <Link to="/signup">Criar conta</Link>
        </p>
        <p className="z-auth__footer">
          <Link to="/recuperar-password">Esqueci-me da password</Link>
        </p>
      </div>
    </div>
  );
}
