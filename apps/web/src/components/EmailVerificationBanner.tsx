import { useSession } from '../app/SessionContext';
import { useResendEmailVerification } from '../api/hooks';
import { Banner, Button, ButtonLink } from '../ui/primitives';

/**
 * Aviso de endereço de email por confirmar.
 *
 * ## Porque é que é persistente, e não descartável
 *
 * O endereço não confirmado tem uma consequência concreta que o utilizador não vê: se
 * perder a password, o link de recuperação vai para um endereço que pode não ser dele — e é
 * aí, no pior momento possível, que ele descobre o problema. Um aviso que se fecha com um
 * clique desaparece no dia em que é lido e não volta; este fica enquanto a condição que o
 * justifica existir, e desaparece sozinho quando `emailVerified` passa a `true` — o que
 * acontece sem recarregar a página, porque a confirmação invalida o perfil.
 *
 * Não bloqueia nada. Nesta fase a verificação não condiciona o acesso: o aviso informa e
 * oferece a ação, e o resto da aplicação funciona por baixo dele.
 *
 * ## Porque é que há duas ações e não só "reenviar"
 *
 * Quem perdeu o email, ou o recebeu numa caixa que não abre, precisa de saber que existe uma
 * página onde o link se abre e onde pode pedir outro. Sem isso, o único caminho seria
 * procurar nas definições. A segunda ação custa uma linha e evita essa caça.
 */
export function EmailVerificationBanner() {
  const { profile } = useSession();
  const resend = useResendEmailVerification();

  // Sem perfil não há o que dizer, e a conta confirmada não tem aviso nenhum a dar.
  if (!profile || profile.emailVerified) return null;

  return (
    <Banner
      tone="warn"
      title="Confirma o teu endereço de email"
      actions={
        <>
          <Button variant="secondary" loading={resend.isPending} onClick={() => resend.mutate()}>
            Reenviar email de verificação
          </Button>
          <ButtonLink to="/verificar-email" variant="ghost">
            Já tenho o link
          </ButtonLink>
        </>
      }
    >
      <div className="z-stack z-stack--tight">
        <span className="z-small">
          Enviámos uma mensagem de confirmação para <strong>{profile.email}</strong>. A conta
          funciona normalmente, mas sem confirmares não conseguimos garantir que és tu que
          recuperas o acesso se perderes a password.
        </span>

        {resend.isSuccess ? (
          <span className="z-small" role="status">
            {resend.data.alreadyVerified
              ? 'O teu endereço já estava confirmado.'
              : resend.data.delivered
                ? 'Enviámos um novo link. O anterior deixou de funcionar.'
                : 'Não conseguimos enviar o email agora. Tenta novamente dentro de momentos.'}
          </span>
        ) : null}

        {resend.isError ? (
          <span className="z-small" role="alert">
            Não foi possível pedir um novo email. Tenta novamente dentro de momentos.
          </span>
        ) : null}
      </div>
    </Banner>
  );
}
