/**
 * Rotas de conta e autenticação (§29).
 *
 * Notas de desenho:
 *  - o `refreshToken` é devolvido no corpo e não num cookie `HttpOnly`, porque o
 *    consumidor principal é uma app mobile (que não tem cookies) e a app web guarda os
 *    tokens em memória com persistência explícita. O modelo de ameaça está documentado
 *    em `docs/ARCHITECTURE.md`;
 *  - as rotas de login e registo têm limitação de abuso própria e mais apertada;
 *  - `logout`, `password` e `2fa` exigem autenticação: uma operação sobre a conta não
 *    pode ser feita por quem não a provou possuir.
 *
 * Nota sobre o login federado (`AUTH-002`): `GET /auth/google/start` e
 * `GET /auth/google/callback` são os **únicos** endpoints deste ficheiro que existem para ser
 * visitados por navegação de topo, e não chamados por código. É por isso que respondem com
 * um `302` e com um `Set-Cookie`, e é por isso que o `state` viaja também num cookie
 * `HttpOnly`: a marca do fluxo tem de estar no browser que o começou.
 */

import { Router } from 'express';
import {
  zChangePasswordRequest,
  zDeleteAccountRequest,
  zEmailVerificationConfirmRequest,
  zLoginRequest,
  zPasswordResetConfirmRequest,
  zPasswordResetRequestRequest,
  zSignUpRequest,
  zTwoFactorConfirmRequest,
  zTwoFactorDisableRequest,
  zUpdatePreferencesRequest,
  zUpdateProfileRequest,
  type SignUpRequest,
} from '@zemlo/shared';
import { asyncHandler, noContent, parseBody, requireUser } from '../../http/handlers.js';
import { authRateLimit, emailVerificationRateLimit, requireAuth } from '../../http/middleware.js';
import { unauthorized } from '../../core/errors.js';
import {
  changePassword,
  confirmTwoFactorSetup,
  deleteAccount,
  disableTwoFactor,
  getPreferences,
  getProfile,
  listSessions,
  login,
  logout,
  refreshSession,
  requestPasswordReset,
  resendEmailVerification,
  resetPassword,
  revokeAllSessions,
  revokeSession,
  signUp,
  startTwoFactorSetup,
  updatePreferences,
  updateProfile,
  verifyEmail,
} from '../../services/auth.js';
import {
  completeGoogleLogin,
  OAUTH_STATE_COOKIE,
  oauthStateCookiePath,
  startGoogleLogin,
} from '../../services/oauth.js';
import { config } from '../../core/config.js';

export const authRouter = Router();

/* -------------------------------------------------------------------------- */
/* Apoio ao cookie do fluxo federado                                           */
/* -------------------------------------------------------------------------- */

/**
 * Lê um cookie do cabeçalho `Cookie`.
 *
 * Escrito à mão de propósito: é o **único** cookie que o servidor lê. Os tokens de sessão
 * vão no corpo da resposta, e não em cookies, por decisão de desenho (ver o cabeçalho deste
 * ficheiro). Trazer o `cookie-parser` para ler um valor seria uma dependência a mais para
 * uma função de cinco linhas.
 *
 * O corte é no **primeiro** `=`, porque um valor em base64url pode conter `=` de
 * preenchimento no fim — cortar no último perderia parte do valor.
 */
function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }

  return null;
}

/** Constrói o `Set-Cookie` da marca do fluxo. `maxAgeSeconds = 0` apaga-a. */
function stateCookie(value: string, path: string, maxAgeSeconds: number): string {
  return [
    `${OAUTH_STATE_COOKIE}=${value}`,
    `Path=${path}`,
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    /*
     * `Lax` e não `Strict`: o regresso da Google é uma navegação de topo vinda de outro
     * sítio, e com `Strict` o browser não enviaria o cookie — o fluxo falharia sempre, e a
     * causa (um atributo a mais) seria invisível. `Lax` continua a não enviar o cookie em
     * pedidos de outro sítio que não sejam navegações, que é o que interessa aqui.
     */
    'SameSite=Lax',
    ...(config.isProduction ? ['Secure'] : []),
  ].join('; ');
}

/* -------------------------------------------------------------------------- */
/* Registo e sessão                                                            */
/* -------------------------------------------------------------------------- */

authRouter.post(
  '/auth/signup',
  authRateLimit(),
  asyncHandler(async (request, response) => {
    const body = parseBody(zSignUpRequest, request) as SignUpRequest;
    const session = await signUp(body, {
      ipAddress: request.meta.ipAddress,
      userAgent: request.meta.userAgent,
    });
    response.status(201).json(session);
  }),
);

authRouter.post(
  '/auth/login',
  authRateLimit(),
  asyncHandler(async (request, response) => {
    const body = parseBody(zLoginRequest, request);
    const session = await login(body, {
      ipAddress: request.meta.ipAddress,
      userAgent: request.meta.userAgent,
    });
    response.json(session);
  }),
);

authRouter.post(
  '/auth/refresh',
  authRateLimit(),
  asyncHandler(async (request, response) => {
    const refreshToken = typeof request.body?.refreshToken === 'string' ? request.body.refreshToken : null;
    if (!refreshToken) {
      throw unauthorized('Sessão em falta. Inicia sessão novamente.');
    }
    const session = await refreshSession(refreshToken, {
      ipAddress: request.meta.ipAddress,
      userAgent: request.meta.userAgent,
    });
    response.json(session);
  }),
);

/* -------------------------------------------------------------------------- */
/* Login federado com Google (`AUTH-002`)                                      */
/* -------------------------------------------------------------------------- */

authRouter.get(
  '/auth/google/start',
  authRateLimit(),
  asyncHandler(async (_request, response) => {
    const start = await startGoogleLogin();

    /*
     * A marca do fluxo vai para o browser **e** para o servidor: o `state` está no mapa do
     * serviço, e este cookie é o que prova que quem volta ao callback é o mesmo browser que
     * começou o fluxo. Sem ele, um atacante que começasse um fluxo próprio podia fazer a
     * vítima terminá-lo — a vítima acabaria autenticada na conta do atacante, porque o
     * `state` dele é um valor perfeitamente válido.
     */
    response.setHeader(
      'Set-Cookie',
      stateCookie(start.state, oauthStateCookiePath(), start.cookieMaxAgeSeconds),
    );

    /*
     * `302` e não `200` com um JSON: quem carrega no botão é um browser a navegar, e o
     * endereço de autorização tem de ser visitado. O `client_secret` nunca sai daqui — o
     * que viaja no URL é o `client_id`, o `state`, o `nonce` e o desafio PKCE.
     */
    response.redirect(302, start.authorizationUrl);
  }),
);

authRouter.get(
  '/auth/google/callback',
  authRateLimit(),
  asyncHandler(async (request, response) => {
    /*
     * A query vai **crua**, e não por `request.query`.
     *
     * O Express analisa a query e descodifica-a, e nesse caminho um `+` passa a espaço — e o
     * `code` é opaco, pode conter `+`. Entregar a cadeia original ao `openid-client` é
     * entregar-lhe exatamente os bytes que a Google enviou.
     *
     * A **base** do URL, essa, não vem do pedido: vem da configuração (`services/oauth.ts`).
     * O cabeçalho `Host` é controlado por quem faz o pedido, e o URL de retorno é o destino
     * de uma credencial de uso único.
     */
    const questionMark = request.originalUrl.indexOf('?');
    const rawQuery = questionMark === -1 ? '' : request.originalUrl.slice(questionMark);

    const session = await completeGoogleLogin(
      rawQuery,
      readCookie(request.headers.cookie, OAUTH_STATE_COOKIE),
      {
        ipAddress: request.meta.ipAddress,
        userAgent: request.meta.userAgent,
      },
    );

    /*
     * O fluxo terminou, e a marca do browser deixa de ter razão para existir. A limpeza é
     * feita aqui e não num `catch`: o manipulador de erros da aplicação responde depois de o
     * pedido sair daqui, e não teria como lhe acrescentar cabeçalhos.
     */
    response.setHeader('Set-Cookie', stateCookie('', oauthStateCookiePath(), 0));

    /*
     * Esta resposta carrega tokens e chega por navegação de topo, o que a torna mais
     * suscetível de acabar em cache ou no histórico do que uma resposta a um `fetch`. Nada
     * aqui pode ser guardado.
     */
    response.setHeader('Cache-Control', 'no-store');

    response.json(session);
  }),
);

authRouter.post(
  '/auth/logout',
  requireAuth(),
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    await logout(user.sessionId, user.id);
    noContent(response);
  }),
);

/* -------------------------------------------------------------------------- */
/* Verificação de email                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Confirma um endereço de email a partir do token recebido por email.
 *
 * É **pública**, e tem de ser: quem abre o link pode não ter sessão nenhuma — criou a
 * conta noutro dispositivo, ou o link foi aberto no telemóvel depois do registo no
 * computador. Exigir sessão aqui recusaria precisamente o caso mais comum.
 *
 * O token viaja no **corpo** e não na query string. O url da página já o traz (é assim que
 * o link funciona), mas repeti-lo aqui deixaria o token nos logs de acesso do servidor
 * web, que é o sítio de onde ele é mais fácil de colher. O corpo não é registado.
 *
 * 200 com o email confirmado, e não 204: o cliente mostra o endereço que ficou
 * confirmado, e é essa a única informação que esta resposta transporta — não o `userId`,
 * não o token, nada que sirva para outra coisa.
 */
authRouter.post(
  '/auth/verify-email',
  authRateLimit(),
  asyncHandler(async (request, response) => {
    const body = parseBody(zEmailVerificationConfirmRequest, request);
    const result = await verifyEmail(body, {
      ipAddress: request.meta.ipAddress,
      userAgent: request.meta.userAgent,
    });
    response.json({
      message: 'Endereço de email confirmado.',
      email: result.email,
    });
  }),
);

/**
 * Reenvia o pedido de verificação para a conta com sessão.
 *
 * Devolve 200 nos dois casos — email enviado, ou conta já confirmada. A conta já
 * confirmada não é um erro: é um estado final, e responder 409 obrigaria o cliente a
 * tratar um caso que não é uma falha. O campo `alreadyVerified` diz qual dos dois
 * aconteceu, e é o cliente que escolhe o texto.
 *
 * O campo `delivered` existe porque a rota **não** pode fingir que enviou: o `sendEmail`
 * absorve falhas de SMTP de propósito (para não reabrir a enumeração de contas no reset),
 * e sem este campo o ecrã diria "enviámos" a quem não recebeu nada. Dizer a verdade sobre
 * uma entrega falhada é o que permite à pessoa tentar outra vez em vez de esperar por um
 * email que não vem.
 */
authRouter.post(
  '/me/email-verification',
  requireAuth(),
  emailVerificationRateLimit(),
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const result = await resendEmailVerification(user.id, {
      ipAddress: request.meta.ipAddress,
      userAgent: request.meta.userAgent,
    });

    response.json({
      message: result.alreadyVerified
        ? 'O teu endereço de email já está confirmado.'
        : result.delivered
          ? 'Enviámos um novo link de confirmação para o teu email.'
          : 'Não conseguimos enviar o email de confirmação agora. Tenta novamente dentro de momentos.',
      alreadyVerified: result.alreadyVerified,
      delivered: result.delivered,
    });
  }),
);

/* -------------------------------------------------------------------------- */
/* Recuperação de password (§29)                                               */
/* -------------------------------------------------------------------------- */

/**
 * Pede o link de recuperação.
 *
 * Responde **202 com um corpo fixo**, tenha a conta existido ou não. É a razão de ser
 * deste endpoint: qualquer resposta que variasse com a existência do email transformaria
 * a recuperação de password no melhor oráculo de enumeração de contas da API — melhor do
 * que o login, porque aqui não é preciso saber a password.
 *
 * Não é 200 porque nada foi criado do ponto de vista do cliente; e não é 204 porque uma
 * resposta com corpo é mais fácil de consumir num cliente que mostre a mensagem.
 */
authRouter.post(
  '/auth/password-reset',
  authRateLimit(),
  asyncHandler(async (request, response) => {
    const body = parseBody(zPasswordResetRequestRequest, request);
    await requestPasswordReset(body.email, {
      ipAddress: request.meta.ipAddress,
      userAgent: request.meta.userAgent,
    });
    response.status(202).json({
      message: 'Se existir uma conta com este email, enviámos um link para repor a password.',
    });
  }),
);

/** Conclui a recuperação com o token recebido por email. */
authRouter.post(
  '/auth/password-reset/confirm',
  authRateLimit(),
  asyncHandler(async (request, response) => {
    const body = parseBody(zPasswordResetConfirmRequest, request);
    const result = await resetPassword(body, {
      ipAddress: request.meta.ipAddress,
      userAgent: request.meta.userAgent,
    });
    response.json({
      message: 'Password alterada. Inicia sessão com a nova password.',
      revokedSessions: result.revokedSessions,
    });
  }),
);

authRouter.post(
  '/auth/logout-all',
  requireAuth(),
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const revoked = await revokeAllSessions(user.id);
    response.json({ revokedSessions: revoked });
  }),
);

/* -------------------------------------------------------------------------- */
/* Perfil e preferências                                                       */
/* -------------------------------------------------------------------------- */

authRouter.get(
  '/me',
  requireAuth(),
  asyncHandler(async (request, response) => {
    response.json(await getProfile(requireUser(request).id));
  }),
);

authRouter.patch(
  '/me',
  requireAuth(),
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zUpdateProfileRequest, request);
    response.json(await updateProfile(user.id, body));
  }),
);

authRouter.get(
  '/me/preferences',
  requireAuth(),
  asyncHandler(async (request, response) => {
    response.json(await getPreferences(requireUser(request).id));
  }),
);

authRouter.patch(
  '/me/preferences',
  requireAuth(),
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zUpdatePreferencesRequest, request);
    response.json(await updatePreferences(user.id, body));
  }),
);

authRouter.get(
  '/me/sessions',
  requireAuth(),
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    response.json({
      items: await listSessions(user.id),
      currentSessionId: user.sessionId,
    });
  }),
);

authRouter.delete(
  '/me/sessions/:sessionId',
  requireAuth(),
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    await revokeSession(user.id, request.params.sessionId ?? '');
    noContent(response);
  }),
);

/* -------------------------------------------------------------------------- */
/* Password                                                                    */
/* -------------------------------------------------------------------------- */

authRouter.post(
  '/me/password',
  requireAuth(),
  authRateLimit(),
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zChangePasswordRequest, request);
    const result = await changePassword(
      user.id,
      {
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
        revokeOtherSessions: body.revokeOtherSessions ?? true,
      },
      user.sessionId,
    );
    response.json(result);
  }),
);

/* -------------------------------------------------------------------------- */
/* Verificação em dois passos (§29)                                            */
/* -------------------------------------------------------------------------- */

authRouter.post(
  '/me/2fa/setup',
  requireAuth(),
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    response.json(await startTwoFactorSetup(user.id));
  }),
);

authRouter.post(
  '/me/2fa/confirm',
  requireAuth(),
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zTwoFactorConfirmRequest, request);
    response.json(await confirmTwoFactorSetup(user.id, { secret: body.secret, totp: body.totp }));
  }),
);

authRouter.post(
  '/me/2fa/disable',
  requireAuth(),
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zTwoFactorDisableRequest, request);
    response.json(await disableTwoFactor(user.id, { password: body.password, totp: body.totp }));
  }),
);

/* -------------------------------------------------------------------------- */
/* Eliminação de conta (§30)                                                   */
/* -------------------------------------------------------------------------- */

authRouter.delete(
  '/me',
  requireAuth(),
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zDeleteAccountRequest, request);
    await deleteAccount(user.id, { password: body.password, totp: body.totp });
    noContent(response);
  }),
);
