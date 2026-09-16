import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSession } from '../../app/SessionContext';
import { Logo } from '../../components/Logo';
import { Banner, Button } from '../../ui/primitives';
import { ApiError } from '../../api/client';
import { useForm } from '../../hooks/useForm';

/**
 * Criação de conta.
 *
 * O formulário é mínimo — email, password, nome — e a **única** restrição imposta é a
 * aceitação dos termos, que a API exige com `acceptedTerms: true` literal.
 *
 * A regra da password (10 caracteres, sem espaços nas pontas) é comunicada como **texto de
 * apoio** e não como validação local: é a API que a aplica, e escrever a mesma regra aqui
 * seria a forma mais rápida de as duas divergirem. O utilizador vê a regra antes de
 * escrever — que é o que evita o erro, não a mensagem depois dele.
 */
export function SignUpPage() {
  const { signUp } = useSession();
  const navigate = useNavigate();
  const form = useForm({ email: '', password: '', name: '' });
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    form.clearErrors();
    form.setSubmitting(true);
    try {
      await signUp({
        email: form.values.email,
        password: form.values.password,
        // A API aceita `name` opcional; enviar uma cadeia vazia faria com que o perfil
        // ficasse com um nome em branco em vez de nenhum.
        ...(form.values.name.trim() ? { name: form.values.name.trim() } : {}),
        acceptedTerms: true,
      });
      navigate('/onboarding/veiculo', { replace: true });
    } catch (caught) {
      setError(caught);
      form.setServerError(caught);
    } finally {
      form.setSubmitting(false);
    }
  }

  return (
    <div className="z-auth">
      <div className="z-auth__card">
        <div className="z-auth__head">
          <Logo variant="lockup" size={38} />
          <h1 className="z-auth__title">Criar conta</h1>
          <p className="z-auth__subtitle">Bastam dois minutos para teres o primeiro veículo registado.</p>
        </div>

        <form className="z-stack" onSubmit={onSubmit} noValidate>
          <div className="z-field">
            <label className="z-field__label" htmlFor="signup-name">
              Nome
            </label>
            <input
              id="signup-name"
              className="z-input"
              type="text"
              name="name"
              autoComplete="name"
              value={form.values.name}
              onChange={(event) => form.setValue('name', event.target.value)}
              aria-invalid={form.fieldError('name') ? true : undefined}
            />
            <span className="z-field__hint">Opcional. Serve para personalizar a aplicação.</span>
            {form.fieldError('name') ? <span className="z-field__error" role="alert">{form.fieldError('name')}</span> : null}
          </div>

          <div className="z-field">
            <label className="z-field__label" htmlFor="signup-email">
              Email
            </label>
            <input
              id="signup-email"
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
            <label className="z-field__label" htmlFor="signup-password">
              Password
            </label>
            <input
              id="signup-password"
              className="z-input"
              type="password"
              name="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={form.values.password}
              onChange={(event) => form.setValue('password', event.target.value)}
              aria-describedby="signup-password-hint"
              aria-invalid={form.fieldError('password') ? true : undefined}
            />
            <span className="z-field__hint" id="signup-password-hint">
              Pelo menos 10 caracteres. Não exigimos símbolos nem números: uma frase longa que
              te lembres é mais segura do que `P@ssw0rd!`.
            </span>
            {form.fieldError('password') ? <span className="z-field__error" role="alert">{form.fieldError('password')}</span> : null}
          </div>

          <label className="z-checkbox">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(event) => setAcceptedTerms(event.target.checked)}
              required
            />
            <span>
              Aceito os termos de utilização e a política de privacidade.
              <span className="z-xs z-muted" style={{ display: 'block' }}>
                Os teus dados são teus: podes exportá-los a qualquer momento e eliminar a conta
                sem pedir autorização a ninguém.
              </span>
            </span>
          </label>
          {form.fieldError('acceptedTerms') ? (
            <span className="z-field__error" role="alert">
              {form.fieldError('acceptedTerms')}
            </span>
          ) : null}

          {error ? (
            <div className="z-inline-error" role="alert">
              <span>{error instanceof ApiError ? error.message : 'Não foi possível criar a conta. Tenta novamente.'}</span>
              {error instanceof ApiError && error.requestId ? (
                <span className="z-request-id">Referência para apoio: {error.requestId}</span>
              ) : null}
            </div>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            block
            loading={form.isSubmitting}
            // O botão fica indisponível enquanto os termos não forem aceites: a API recusaria
            // com um erro que o utilizador não consegue resolver sem perceber o que falta.
            disabled={!acceptedTerms}
          >
            Criar conta
          </Button>
        </form>

        <div className="z-stack z-stack--tight">
          <div className="z-row" style={{ gap: 'var(--z-space-3)' }}>
            <hr className="z-divider" style={{ flex: 1 }} />
            <span className="z-xs z-muted">ou</span>
            <hr className="z-divider" style={{ flex: 1 }} />
          </div>
          <Button variant="secondary" block disabled icon="🔵">
            Criar conta com Google
          </Button>
          <p className="z-xs z-muted">
            Ainda não está disponível: exigiria credenciais OAuth no servidor, que este ambiente
            não tem.
          </p>
        </div>

        <Banner tone="info">
          O Zemlo funciona com dados incompletos. Vais poder registar o que souberes e completar
          mais tarde — nada aqui fica bloqueado à espera de um campo.
        </Banner>

        <p className="z-auth__footer">
          Já tens conta? <Link to="/login">Entrar</Link>
        </p>
      </div>
    </div>
  );
}
