import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../../app/SessionContext';
import { auth } from '../../api/client';
import { useResendEmailVerification } from '../../api/hooks';
import { Logo } from '../../components/Logo';
import { Banner, Button, LoadingBlock } from '../../ui/primitives';
import {
  humanVerificationValidity,
  translateVerifyEmailError,
} from './emailVerification';

/**
 * Confirmação do endereço de email a partir do link recebido.
 *
 * ## O token é lido uma vez e não volta a ser escrito no endereço
 *
 * O valor vem de `?token=`, é capturado no primeiro render e nunca é relido. A seguir ao
 * pedido, o parâmetro é retirado do url com `replace` — sem isto, o token de uso único
 * ficava no histórico do browser, na barra de endereços e em qualquer sincronização de
 * separadores, já depois de consumido. O ecrã não pode, por isso, depender de `params`
 * para saber se havia token: esse valor desaparece de propósito, e derivar dele o estado
 * faria o ecrã cair em "não trouxeste código" depois de ter confirmado.
 *
 * ## A página é pública, e isso não é um detalhe
 *
 * Ao contrário de `/repor-password`, esta rota **não** é envolvida em
 * `RedirectIfAuthenticated`. O caso mais comum é exatamente o contrário do que esse guard
 * assume: a pessoa criou a conta no computador, o email chegou ao telemóvel, e ao abrir o
 * link pode já ter sessão iniciada nesse telemóvel. Reencaminhá-la para o painel sem
 * confirmar nada gastaria a única oportunidade que o link tinha — e o utilizador veria o
 * aviso de "email por confirmar" a continuar, sem perceber porquê.
 *
 * ## Um pedido, mesmo em desenvolvimento
 *
 * O `StrictMode` invoca os efeitos duas vezes. Sem a guarda de `useRef`, o segundo pedido
 * encontraria o token já consumido e responderia 401 — e o ecrã, em desenvolvimento,
 * mostraria uma recusa logo a seguir a ter confirmado o endereço com sucesso. A guarda não
 * é uma otimização: é o que impede que o duplo disparo produza um estado falso.
 */
export function VerifyEmailPage() {
  const { isAuthenticated, profile, refreshProfile } = useSession();
  const resend = useResendEmailVerification();

  /*
   * O token é capturado no primeiro render e vive em estado imutável a partir daí. Um
   * `useSearchParams` a cada render obrigaria a distinguir "o url ainda não foi limpo" de
   * "o link não trazia token", que são coisas diferentes.
   */
  const [token] = useState(() => {
    const raw = new URLSearchParams(window.location.search).get('token') ?? '';
    return raw.trim();
  });

  const started = useRef(false);
  const [state, setState] = useState<
    | { kind: 'processing' }
    | { kind: 'done'; email: string }
    | { kind: 'failed'; message: string; requestId: string | null }
  >(() => ({ kind: 'processing' }));

  const missingToken = token === '';

  useEffect(() => {
    if (missingToken || started.current) return;
    started.current = true;

    let cancelled = false;

    void (async () => {
      try {
        const result = await auth.verifyEmail(token);
        if (cancelled) return;
        setState({ kind: 'done', email: result.email });
        // O aviso de "email por confirmar" lê `profile.emailVerified`. Sem esta
        // atualização, quem estivesse com sessão via a confirmação e o aviso ao mesmo
        // tempo, até recarregar a página.
        void refreshProfile();
      } catch (error) {
        if (cancelled) return;
        const translated = translateVerifyEmailError(error);
        setState({ kind: 'failed', message: translated.message, requestId: translated.requestId });
      } finally {
        /*
         * O token sai do endereço, tenha corrido bem ou mal. No caso de falha é igualmente
         * obrigatório: um token recusado continua a ser um segredo, e deixá-lo na barra de
         * endereços é o que faz com que uma captura de ecrã ou um histórico partilhado o
         * levem consigo.
         *
         * `replaceState` e não o router: não se quer uma entrada nova no histórico — o
         * botão "voltar" não deve devolver a pessoa a um endereço com o token.
         */
        if (!cancelled && window.location.search !== '') {
          window.history.replaceState({}, '', window.location.pathname);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // `token` e `missingToken` são estáveis: o token é capturado uma vez. O efeito corre
    // no máximo uma vez por montagem, garantido pela guarda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Reenvio: só quando há sessão e a conta ainda não está confirmada.
   *
   * Sem sessão, o endpoint responde 401 — mostrar o botão seria oferecer uma ação que não
   * pode funcionar. Com a conta já confirmada, não há nada a reenviar, e a API recusa
   * gerar um token novo de propósito.
   */
  const canResend = isAuthenticated && profile?.emailVerified === false;

  return (
    <div className="z-auth">
      <div className="z-auth__card">
        <div className="z-auth__head">
          <Logo variant="lockup" size={38} />
          <h1 className="z-auth__title">
            {missingToken ? 'Falta o código' : 'Confirmar email'}
          </h1>
        </div>

        {missingToken ? (
          <>
            <Banner tone="warn">
              Este endereço não traz o código de confirmação. Abre o link do email tal como o
              recebeste — alguns clientes de correio cortam os endereços longos em duas linhas.
            </Banner>
            <ResendAction
              enabled={canResend}
              isAuthenticated={isAuthenticated}
              mutation={resend}
            />
          </>
        ) : null}

        {!missingToken && state.kind === 'processing' ? (
          <LoadingBlock label="A confirmar o teu endereço…" />
        ) : null}

        {state.kind === 'done' ? (
          <>
            <Banner tone="ok" title="Endereço confirmado">
              <span className="z-small">
                <strong>{state.email}</strong> está confirmado. A partir de agora, é para este
                endereço que enviamos avisos e links de recuperação.
              </span>
            </Banner>
            <p className="z-small z-muted">
              Podes fechar esta página. A conta fica com o estado atualizado na próxima vez
              que a abrires.
            </p>
          </>
        ) : null}

        {state.kind === 'failed' ? (
          <>
            {/*
              * Se a sessão diz que o endereço já está confirmado, a recusa do token não é
              * um problema — é a segunda abertura do mesmo link, ou um pré-carregamento
              * automático do cliente de correio. Dizer "link inválido" a quem já confirmou
              * seria tecnicamente verdade e praticamente enganador.
              *
              * O que este banner **não** faz é nomear o motivo da recusa. Dizer "este link
              * já tinha sido usado" seria afirmar uma coisa que o servidor recusa
              * deliberadamente revelar — e seria falso sempre que o token tivesse expirado
              * ou sido substituído por um reenvio. A conclusão certa depende do estado da
              * conta, que é informação do próprio utilizador, e não do estado do token.
              */}
            {isAuthenticated && profile?.emailVerified ? (
              <Banner tone="ok" title="O teu email já está confirmado">
                Não é preciso fazer mais nada — o endereço já estava confirmado antes de
                abrires o link, por isso não havia nada a confirmar.
              </Banner>
            ) : (
              <>
                <Banner tone="warn">{state.message}</Banner>
                {state.requestId ? (
                  <p className="z-xs z-muted">Referência para apoio: {state.requestId}</p>
                ) : null}
                <ResendAction
                  enabled={canResend}
                  isAuthenticated={isAuthenticated}
                  mutation={resend}
                />
              </>
            )}
          </>
        ) : null}

        {/*
          * A saída depende de onde a pessoa está. Com sessão, o destino natural é a
          * aplicação — não o formulário de entrada, que ela já passou. Sem sessão, o login
          * é o único caminho que leva a algum lado.
        */}
        <p className="z-auth__footer">
          {isAuthenticated ? (
            <Link to="/">Ir para o painel</Link>
          ) : (
            <Link to="/login">Iniciar sessão</Link>
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * A ação de reenvio, com o seu próprio retorno.
 *
 * ## Porque é que isto é um componente e não duas cópias
 *
 * O reenvio aparece em dois estados do ecrã — link sem código, e link recusado — e o
 * comportamento é idêntico nos dois. Duplicá-lo produziria duas frases de retorno que
 * divergiriam à primeira alteração, e a frase de retorno é precisamente a parte que tem de
 * dizer a verdade sobre a entrega.
 *
 * ## Os três retornos possíveis, e porque não podem ser um só
 *
 * "Já estava confirmado", "foi enviado" e "tentámos e falhou" são três estados distintos, e
 * colapsá-los obrigaria a escolher entre mentir a quem não recebeu nada — dizendo "enviámos"
 * — ou alarmar quem já tinha a conta confirmada. A API devolve os três de propósito.
 */
function ResendAction({
  enabled,
  isAuthenticated,
  mutation,
}: {
  enabled: boolean;
  isAuthenticated: boolean;
  mutation: ReturnType<typeof useResendEmailVerification>;
}) {
  if (!enabled) {
    return (
      <p className="z-small z-muted">
        {isAuthenticated
          ? 'Não há nada a reenviar nesta conta.'
          : 'Podes pedir um link novo a partir das definições da conta, depois de iniciares sessão. ' +
            `O link é válido durante ${humanVerificationValidity()}.`}
      </p>
    );
  }

  return (
    <>
      <Button
        variant="secondary"
        block
        loading={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        Reenviar email de confirmação
      </Button>

      {mutation.isSuccess ? (
        <p className="z-small z-muted" role="status">
          {mutation.data.alreadyVerified
            ? 'O teu endereço já estava confirmado — nada a fazer.'
            : mutation.data.delivered
              ? 'Enviámos um novo link. O link anterior deixou de funcionar.'
              : 'Não conseguimos enviar o email agora. Tenta novamente dentro de momentos.'}
        </p>
      ) : null}

      {mutation.isError ? (
        <p className="z-small" role="alert">
          Não foi possível pedir um novo link. Tenta novamente dentro de momentos.
        </p>
      ) : null}
    </>
  );
}
