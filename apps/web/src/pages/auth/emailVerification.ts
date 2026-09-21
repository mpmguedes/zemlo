import { EMAIL_VERIFICATION_TTL_MINUTES } from '@zemlo/shared';
import { ApiError } from '../../api/client';

/**
 * Texto e tradução de erros do ecrã de confirmação de email.
 *
 * ## Porque é que isto não vive em `resetErrors.ts`
 *
 * Os dois ecrãs parecem-se — ambos consomem um token de uso único de um link de email — mas
 * não partilham nem as mensagens nem as ações. No reset, a recusa do token obriga a pedir um
 * link novo *por email*, e o ecrã oferece esse caminho. Aqui, quem tem sessão resolve a
 * mesma situação com um clique, e quem não tem pode simplesmente entrar: a conta existe e
 * funciona. Juntar as duas traduções num ficheiro obrigaria a distinguir os casos lá dentro
 * e a arrastar `resetErrors.ts` para um ecrã que não é de reposição de password.
 *
 * O que **é** partilhado é a regra que dá origem a este ficheiro: a API recusa todos os
 * motivos de invalidade com a mesma resposta, e o ecrã respeita isso. Não se tenta adivinhar
 * se o link expirou, já foi usado, ou nunca existiu — as três levam à mesma ação, e
 * distingui-las só ajudaria quem tem um link antigo a saber se ele chegou a valer.
 */

/**
 * A validade escrita como uma pessoa a leria.
 *
 * A constante é em minutos porque é isso que o servidor usa para expirar. O ecrã fala em
 * horas ou dias porque é isso que se lê. Derivar da constante — em vez de escrever
 * "24 horas" à mão — é o que impede a frase de sobreviver a uma mudança do prazo e passar a
 * mentir ao utilizador.
 *
 * A ordem dos testes é do mais longo para o mais curto: um valor divisível por 1440 é
 * também divisível por 60, e testá-lo depois daria "24 horas" a um prazo de um dia — o que
 * por acaso está certo, mas por acidente.
 *
 * O parâmetro existe para o teste poder exercer os quatro ramos. Com o valor fixo lá dentro,
 * um teste só conseguia afirmar o resultado do prazo atual — e continuaria verde se a
 * derivação fosse substituída por `return '24 horas'`, que é precisamente o defeito que esta
 * função existe para impedir. Quem chama não passa nada: o valor por omissão é a constante.
 */
export function humanVerificationValidity(
  minutes: number = EMAIL_VERIFICATION_TTL_MINUTES,
): string {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? '24 horas' : `${days} dias`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hora' : `${hours} horas`;
  }
  return minutes === 1 ? '1 minuto' : `${minutes} minutos`;
}

export interface TranslatedVerificationError {
  message: string;
  requestId: string | null;
}

/** Mensagem única para todos os motivos pelos quais um link de confirmação não serve. */
export const VERIFICATION_LINK_REJECTED =
  'Este link de confirmação já não é válido. Pode ter expirado, já ter sido usado, ou ter ' +
  'sido substituído por um pedido mais recente.';

export function translateVerifyEmailError(error: unknown): TranslatedVerificationError {
  if (!(error instanceof ApiError)) {
    return {
      message: 'Não foi possível confirmar o endereço. Verifica a ligação e tenta novamente.',
      requestId: null,
    };
  }

  // Erro de rede: o pedido não chegou a sair, ou a resposta não voltou. A ação do
  // utilizador é outra — "verifica a ligação" em vez de "pede um link novo".
  if (error.code === 'network_error' || error.status === 0) {
    return {
      message: 'Não foi possível contactar o servidor. Verifica a ligação e tenta novamente.',
      requestId: null,
    };
  }

  /*
   * Todos os motivos de recusa do token chegam como 401 com a mesma mensagem. A tradução
   * repete a ideia por palavras nossas, porque a mensagem da API é escrita para o caso
   * genérico e aqui sabe-se que o contexto é uma confirmação de email.
   */
  if (error.status === 401) {
    return { message: VERIFICATION_LINK_REJECTED, requestId: error.requestId };
  }

  if (error.status === 429) {
    return {
      message:
        'Demasiadas tentativas seguidas. Espera alguns minutos antes de tentar novamente.',
      requestId: error.requestId,
    };
  }

  // Um token que não passa a validação de forma (curto demais, adulterado) é, para quem o
  // abriu, um link truncado pelo cliente de correio. Mesma frase e mesma saída.
  if (error.fields.some((field) => field.path.split('.')[0] === 'token')) {
    return { message: VERIFICATION_LINK_REJECTED, requestId: error.requestId };
  }

  return { message: error.message, requestId: error.requestId };
}
