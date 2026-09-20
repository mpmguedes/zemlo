import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PASSWORD_RESET_TTL_MINUTES } from '@zemlo/shared';
import { useForm } from '../../hooks/useForm';
import { Logo } from '../../components/Logo';
import { Banner, Button } from '../../ui/primitives';
import { auth } from '../../api/client';
import { translateConfirmResetError } from './resetErrors';

/**
 * Definição de nova password, a partir do link recebido por email.
 *
 * ## O token vem no url, e o url não é estado da aplicação
 *
 * O token é lido de `?token=`, uma vez, e guardado em estado local. Não é copiado para
 * `localStorage` nem para o histórico da navegação (o `<Link>` de sucesso não o volta a
 * escrever), e não é enviado para lado nenhum além do corpo do pedido de confirmação. Um
 * token de uso único que ficasse guardado no browser continuaria a existir depois de
 * consumido, à espera de ser lido por outra coisa.
 *
 * ## As regras da password são da API, e o ecrã di-lo
 *
 * O formulário verifica apenas o que **não** pode delegar: que os dois campos estão
 * preenchidos e que são iguais. Isso é uma comparação entre dois valores locais, que a API
 * não consegue fazer. O comprimento mínimo e o resto das regras vivem em `zPassword`
 * (`@zemlo/shared`) e são aplicados pelo servidor — repeti-los aqui seria a forma mais
 * rápida de os ver divergir, e um formulário que recusa uma password que a API aceita é um
 * defeito de confiança. Por isso a regra aparece como **texto de apoio**, antes do erro,
 * em vez de como validação local.
 *
 * ## Os estados do link são distinguidos pelo utilizador, não pelo código
 *
 * "Inválido", "expirado" e "já usado" chegam todos como 401 com a mesma mensagem — a API
 * não os distingue, de propósito, porque distingui-los diria a quem tem um link antigo se
 * ele chegou a ser válido. O ecrã **não tenta adivinhar** qual dos três foi: mostra a
 * mensagem da API e a ação que resolve todos — pedir um link novo.
 */

/**
 * A validade escrita como uma pessoa a leria.
 *
 * A constante é em minutos porque é isso que o servidor e o email usam; "60 minutos" é
 * tecnicamente correto e soa a aviso de estacionamento. Converter aqui — e não escrever
 * "1 hora" à mão — mantém a frase presa ao valor: se a validade mudar, o ecrã acompanha
 * sem ninguém se lembrar de o ir editar. Minutos que não sejam múltiplos de 60 ficam como
 * minutos em vez de virarem frações de hora, porque essa conversão é uma fonte de erros
 * silenciosos.
 */
function humanResetValidity(): string {
  const minutes = PASSWORD_RESET_TTL_MINUTES;
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hora' : `${hours} horas`;
  }
  return `${minutes} minutos`;
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const form = useForm({ password: '', confirm: '' });
  const [failure, setFailure] = useState<{ message: string; requestId: string | null } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  /** Erros locais — os dois únicos que o formulário pode detetar sozinho. */
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  /**
   * Token ausente não é o mesmo que token inválido, e a diferença importa.
   *
   * Quem abre `/repor-password` sem `?token=` escreveu o endereço à mão ou o link foi
   * cortado por um cliente de email. Dizer-lhe "link inválido" seria enganador — o link
   * nunca chegou a ser avaliado. Este caso é detetado antes de qualquer pedido.
   */
  const missingToken = token.trim() === '';

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    setFieldErrors({});
    form.clearErrors();

    // As duas únicas regras que o servidor não pode aplicar: presença e igualdade. Tudo o
    // resto é da API, e a mensagem dela é a que fica.
    const errors: Record<string, string> = {};
    if (form.values.password === '') {
      errors.password = 'Escreve a nova password.';
    }
    if (form.values.confirm === '') {
      errors.confirm = 'Repete a nova password.';
    }
    if (!errors.password && !errors.confirm && form.values.password !== form.values.confirm) {
      errors.confirm = 'As duas passwords não são iguais.';
    }
    if (Object.keys(errors).length > 0) {
      setLocalErrors(errors);
      return;
    }
    setLocalErrors({});

    form.setSubmitting(true);
    try {
      await auth.confirmPasswordReset(token, form.values.password);
      setDone(true);
    } catch (caught) {
      const translated = translateConfirmResetError(caught);
      setFieldErrors(translated.fields);
      // Uma mensagem geral vazia é intencional: quando o erro é de um campo, repeti-lo no
      // topo empurra a atenção para longe do sítio onde está.
      if (translated.message !== '') {
        setFailure({ message: translated.message, requestId: translated.requestId });
      }
    } finally {
      form.setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="z-auth">
        <div className="z-auth__card">
          <div className="z-auth__head">
            <Logo variant="lockup" size={38} />
            <h1 className="z-auth__title">Password alterada</h1>
          </div>

          <Banner tone="ok">
            A password foi alterada. Podes iniciar sessão com a nova password.
          </Banner>

          <p className="z-small z-muted">
            Por segurança, terminámos todas as sessões que estavam abertas nesta conta. Se
            estavas com a conta aberta noutro dispositivo, vais precisar de entrar de novo.
          </p>

          <Link to="/login" className="z-stack z-stack--tight">
            <Button variant="primary" block>
              Iniciar sessão
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const passwordError = localErrors.password ?? fieldErrors.password;
  const confirmError = localErrors.confirm;
  const tokenError = fieldErrors.token;
  // O botão de pedir um link novo é a saída de qualquer recusa do token — e o único
  // caminho quando o token nem chegou.
  const showAskForNewLink = missingToken || tokenError !== undefined || failure?.message !== undefined;

  return (
    <div className="z-auth">
      <div className="z-auth__card">
        <div className="z-auth__head">
          <Logo variant="lockup" size={38} />
          <h1 className="z-auth__title">Nova password</h1>
        </div>

        {missingToken ? (
          <Banner tone="warn">
            Este endereço não traz o código de recuperação. Abre o link do email tal como o
            recebeste — alguns clientes de correio cortam os endereços longos em duas linhas.
          </Banner>
        ) : null}

        {tokenError !== undefined && !missingToken ? (
          <Banner tone="warn">{tokenError}</Banner>
        ) : null}

        {!missingToken && tokenError === undefined ? (
          <p className="z-small z-muted">
            A password deve ter pelo menos 10 caracteres e não pode começar nem acabar com
            espaços. O link de recuperação é válido durante {humanResetValidity()} — se
            expirar, pede um novo.
          </p>
        ) : null}

        <form className="z-stack" onSubmit={onSubmit} noValidate>
          <div className="z-field">
            <label className="z-field__label" htmlFor="reset-password">
              Nova password
            </label>
            <input
              id="reset-password"
              className="z-input"
              type="password"
              name="password"
              autoComplete="new-password"
              required
              disabled={missingToken}
              value={form.values.password}
              onChange={(event) => form.setValue('password', event.target.value)}
              aria-invalid={passwordError ? true : undefined}
              aria-describedby={passwordError ? 'reset-password-error' : undefined}
            />
            {passwordError ? (
              <span id="reset-password-error" className="z-field__error" role="alert">
                {passwordError}
              </span>
            ) : null}
          </div>

          <div className="z-field">
            <label className="z-field__label" htmlFor="reset-confirm">
              Repete a nova password
            </label>
            <input
              id="reset-confirm"
              className="z-input"
              type="password"
              name="confirm"
              autoComplete="new-password"
              required
              disabled={missingToken}
              value={form.values.confirm}
              onChange={(event) => form.setValue('confirm', event.target.value)}
              aria-invalid={confirmError ? true : undefined}
              aria-describedby={confirmError ? 'reset-confirm-error' : undefined}
            />
            {confirmError ? (
              <span id="reset-confirm-error" className="z-field__error" role="alert">
                {confirmError}
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

          <Button
            type="submit"
            variant="primary"
            block
            loading={form.isSubmitting}
            disabled={missingToken}
          >
            Definir nova password
          </Button>
        </form>

        {showAskForNewLink ? (
          <p className="z-auth__footer">
            <Link to="/recuperar-password">Pedir um link novo</Link>
          </p>
        ) : null}

        <p className="z-auth__footer">
          <Link to="/login">Voltar ao início de sessão</Link>
        </p>
      </div>
    </div>
  );
}
