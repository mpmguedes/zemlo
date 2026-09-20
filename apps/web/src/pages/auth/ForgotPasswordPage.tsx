import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PASSWORD_RESET_TTL_MINUTES } from '@zemlo/shared';
import { useForm } from '../../hooks/useForm';
import { Logo } from '../../components/Logo';
import { Banner, Button } from '../../ui/primitives';
import { auth } from '../../api/client';
import { translateRequestResetError } from './resetErrors';

/**
 * Pedido de recuperação de password.
 *
 * ## A decisão central: a confirmação não depende da resposta
 *
 * A API responde 202 com a mesma mensagem exista ou não a conta, e faz isso de propósito —
 * é o que impede este formulário de se tornar um oráculo que diz a um estranho se um email
 * tem conta no Zemlo. Se o ecrã mostrasse "enviámos" apenas quando a conta existe, e um
 * erro quando não existe, teria desfeito essa proteção **na interface**, que é o único
 * sítio onde ela é visível ao utilizador.
 *
 * Por isso o passo seguinte é sempre o mesmo ecrã de confirmação, com o mesmo texto, e é
 * ele que explica o que fazer em qualquer dos casos — incluindo o caso de o email não
 * corresponder a conta nenhuma, em que não há nada a fazer. A frase "se existir uma conta"
 * não é uma hesitação: é a informação correta.
 *
 * ## Porque é que o sucesso não é um toast
 *
 * Um aviso que desaparece deixa o utilizador sem nada para reler no momento em que decide
 * ir ver o email. O ecrã de confirmação fica, diz para onde ir, e oferece o caminho de
 * volta ao login — porque quem se enganou no email tem de poder corrigir sem recarregar.
 */

/**
 * A validade escrita como uma pessoa a leria — ver a nota equivalente em
 * `ResetPasswordPage`, onde a mesma conversão é feita. Não está num módulo partilhado
 * porque a duplicação é de três linhas e o módulo acrescentaria uma indireção a um ficheiro
 * que só existe para servir dois ecrãs vizinhos.
 */
function humanResetValidity(): string {
  const minutes = PASSWORD_RESET_TTL_MINUTES;
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hora' : `${hours} horas`;
  }
  return `${minutes} minutos`;
}

export function ForgotPasswordPage() {
  const form = useForm({ email: '' });
  const [sent, setSent] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const [failure, setFailure] = useState<{ message: string; requestId: string | null } | null>(null);
  const [emailError, setEmailError] = useState<string | undefined>(undefined);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    setEmailError(undefined);
    form.clearErrors();
    form.setSubmitting(true);
    try {
      const email = form.values.email;
      await auth.requestPasswordReset(email);
      // Guardar o endereço no momento do envio, e não ler `form.values` no ecrã de
      // confirmação: o campo continua editável por baixo, e o texto que confirma o envio
      // tem de dizer para onde foi, não para onde o utilizador está a escrever agora.
      setSentTo(email);
      setSent(true);
    } catch (caught) {
      const translated = translateRequestResetError(caught);
      setEmailError(translated.fields.email);
      if (translated.message !== '') {
        setFailure({ message: translated.message, requestId: translated.requestId });
      }
    } finally {
      form.setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="z-auth">
        <div className="z-auth__card">
          <div className="z-auth__head">
            <Logo variant="lockup" size={38} />
            <h1 className="z-auth__title">Verifica o teu email</h1>
          </div>

          <Banner tone="ok">
            Se existir uma conta com o endereço <strong>{sentTo}</strong>, enviámos um link
            para repores a password.
          </Banner>

          <ul className="z-stack z-stack--tight z-small z-muted">
            <li>O link é válido durante {humanResetValidity()}.</li>
            <li>Só o pedido mais recente funciona — se pediste mais do que uma vez, usa o último email.</li>
            <li>Não encontraste? Vê a pasta de spam ou confirma que o endereço está certo.</li>
          </ul>

          <div className="z-stack z-stack--tight">
            <Button variant="secondary" block onClick={() => setSent(false)}>
              Tentar outro endereço
            </Button>
          </div>

          <p className="z-auth__footer">
            <Link to="/login">Voltar ao início de sessão</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="z-auth">
      <div className="z-auth__card">
        <div className="z-auth__head">
          <Logo variant="lockup" size={38} />
          <h1 className="z-auth__title">Repor a password</h1>
          <p className="z-auth__subtitle">
            Diz-nos o email da tua conta e enviamos-te um link para escolheres uma nova password.
          </p>
        </div>

        <form className="z-stack" onSubmit={onSubmit} noValidate>
          <div className="z-field">
            <label className="z-field__label" htmlFor="forgot-email">
              Email
            </label>
            <input
              id="forgot-email"
              className="z-input"
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              required
              value={form.values.email}
              onChange={(event) => form.setValue('email', event.target.value)}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? 'forgot-email-error' : undefined}
            />
            {emailError ? (
              <span id="forgot-email-error" className="z-field__error" role="alert">
                {emailError}
              </span>
            ) : null}
          </div>

          {failure ? (
            <div className="z-inline-error" role="alert">
              <span>{failure.message}</span>
              {failure.requestId ? (
                <span className="z-request-id">Referência para apoio: {failure.requestId}</span>
              ) : null}
            </div>
          ) : null}

          <Button type="submit" variant="primary" block loading={form.isSubmitting}>
            Enviar link de recuperação
          </Button>
        </form>

        <p className="z-auth__footer">
          Lembraste-te da password? <Link to="/login">Iniciar sessão</Link>
        </p>
      </div>
    </div>
  );
}
