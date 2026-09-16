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
  zLoginRequest,
  zSignUpRequest,
  zTwoFactorConfirmRequest,
  zTwoFactorDisableRequest,
  zUpdatePreferencesRequest,
  zUpdateProfileRequest,
  type SignUpRequest,
} from '@zemlo/shared';
import { asyncHandler, noContent, parseBody, requireUser } from '../../http/handlers.js';
import { authRateLimit, requireAuth } from '../../http/middleware.js';
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
  revokeAllSessions,
  revokeSession,
  signUp,
  startTwoFactorSetup,
  updatePreferences,
  updateProfile,
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
