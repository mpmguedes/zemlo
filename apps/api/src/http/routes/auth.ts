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

export const authRouter = Router();

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
