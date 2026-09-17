/**
 * Autenticação e sessões (§29, §30).
 *
 * Modelo adotado, e porquê:
 *
 *  - **Access token JWT** de curta duração (60 min por omissão), assinado com HS256.
 *    Não é guardado em lado nenhum: a API valida-o pela assinatura e não precisa de
 *    consultar a base de dados em cada pedido.
 *
 *  - **Refresh token opaco** de longa duração (90 dias), guardado apenas como hash na
 *    tabela `Session`. É este token que permite revogar um dispositivo perdido. Um JWT
 *    de longa duração seria irrecuperável — e o Zemlo é mobile-first, portanto as
 *    sessões longas são uma necessidade de produto, não um descuido (§3.6).
 *
 *  - **2FA por TOTP** com códigos de recuperação. O segredo é cifrado em repouso: uma
 *    cópia da base de dados não deve permitir gerar códigos válidos (§30).
 *
 *  - **Bloqueio progressivo** depois de tentativas falhadas. O objetivo não é punir o
 *    utilizador que se enganou na password, é tornar o ataque por força bruta inviável
 *    mesmo que a limitação por IP seja contornada (§30).
 */

import type { AuthSessionResponse, CivilDate, TwoFactorSetupResponse, UserProfile } from '@zemlo/shared';
import { DEFAULT_TIME_ZONE, isValidTimeZone, todayIn } from '@zemlo/shared';
import { config } from '../core/config.js';
import {
  consumeRecoveryCode,
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateToken,
  hashPassword,
  hashRecoveryCodes,
  hashToken,
  buildOtpauthUri,
  generateTotpSecret,
  secretsAvailable,
  verifyPassword,
  verifyTotp,
} from '../core/crypto.js';
import { prisma } from '../core/db.js';
import {
  AppError,
  conflict,
  notFound,
  serviceUnavailable,
  translatePrismaError,
  unauthorized,
  unprocessable,
} from '../core/errors.js';
import { jsonOrNull, readJsonArray, writeJson } from '../core/json.js';
import { logger } from '../core/logger.js';
import { audit } from './audit.js';
import { sendEmail } from './email.js';
import { mapUserProfile } from '../domain/payload.js';
import { signAccessToken, verifyAccessToken } from './tokens.js';

/** Tentativas falhadas antes de bloquear temporariamente a conta. */
const MAX_FAILED_ATTEMPTS = 8;
/** Duração do bloqueio temporário, em minutos. */
const LOCKOUT_MINUTES = 15;

export interface RequestMetadata {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  /** Sessão que autenticou o pedido. Nunca nulo: sem sessão válida não há pedido autenticado. */
  sessionId: string;
  timeZone: string;
}

/* -------------------------------------------------------------------------- */
/* Registo                                                                     */
/* -------------------------------------------------------------------------- */

export async function signUp(
  input: {
    email: string;
    password: string;
    name?: string | undefined;
    timeZone?: string | undefined;
  },
  meta: RequestMetadata,
): Promise<AuthSessionResponse> {
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) {
    throw conflict('Já existe uma conta com este email. Experimenta iniciar sessão.');
  }

  const passwordHash = await hashPassword(input.password);
  // Nunca guardar um fuso que o motor de datas não conhece: ver `todayIn` para o que
  // isso provocaria. A validação do esquema apanha o caso normal; isto apanha o resto.
  const timeZone = resolveTimeZone(input.timeZone);

  try {
    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        name: input.name ?? null,
        timeZone,
        acceptedTermsAt: new Date(),
        termsVersion: '0.1',
        lastLoginAt: new Date(),
        // Cada conta nasce com preferências por omissão. Criá-las aqui evita ter de
        // tratar a ausência de preferências em cada leitura.
        preferences: {
          create: {
            reminderLeadDays: 30,
            reminderLeadKm: 1000,
          },
        },
        notificationPreferences: {
          create: [
            { topic: 'maintenance', channel: 'in_app', frequency: 'immediate' },
            { topic: 'inspection', channel: 'in_app', frequency: 'immediate' },
            { topic: 'insurance', channel: 'in_app', frequency: 'immediate' },
            { topic: 'tax', channel: 'in_app', frequency: 'immediate' },
            { topic: 'document', channel: 'in_app', frequency: 'immediate' },
            { topic: 'security', channel: 'in_app', frequency: 'immediate' },
          ],
        },
      },
    });

    await audit('user.signup', {
      userId: user.id,
      entityType: 'user',
      entityId: user.id,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    });

    const session = await createSession(user.id, meta, 'Primeiro dispositivo');
    return buildSessionResponse(user, session);
  } catch (error) {
    throw translatePrismaError(error, 'criar conta');
  }
}

/* -------------------------------------------------------------------------- */
/* Início de sessão                                                            */
/* -------------------------------------------------------------------------- */

export async function login(
  input: { email: string; password: string; totp?: string | undefined },
  meta: RequestMetadata,
): Promise<AuthSessionResponse> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Resposta idêntica para email inexistente e password errada: distinguir os dois
  // casos permitiria descobrir que emails têm conta no Zemlo (§30).
  if (!user || user.deletedAt !== null) {
    await audit('user.login_failed', {
      entityType: 'user',
      metadata: { reason: 'conta inexistente' },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    });
    throw unauthorized('Email ou password incorretos.');
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new AppError(
      429,
      'rate_limited',
      `Por segurança, bloqueámos temporariamente os pedidos para esta conta. Tenta novamente dentro de ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`,
    );
  }

  const passwordOk = await verifyPassword(input.password, user.passwordHash);
  if (!passwordOk) {
    const failedLoginCount = user.failedLoginCount + 1;
    const shouldLock = failedLoginCount >= MAX_FAILED_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: shouldLock ? 0 : failedLoginCount,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
      },
    });
    await audit('user.login_failed', {
      userId: user.id,
      entityType: 'user',
      entityId: user.id,
      metadata: { tentativas: failedLoginCount, bloqueado: shouldLock },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    });
    throw unauthorized('Email ou password incorretos.');
  }

  if (user.twoFactorEnabled) {
    const secondFactor = await verifySecondFactor(user, input.totp ?? null);
    if (!secondFactor.ok) {
      throw unauthorized(
        input.totp
          ? 'O código de verificação não é válido. Confirma a hora do teu dispositivo.'
          : 'Esta conta tem verificação em dois passos ativa. Introduz o código da tua app autenticadora.',
      );
    }
    if (secondFactor.usedRecoveryCode) {
      await audit('user.2fa_recovery_used', {
        userId: user.id,
        entityType: 'user',
        entityId: user.id,
        metadata: { codigosRestantes: secondFactor.remainingCodes.length },
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
      });
    }
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
  });

  await audit('user.login', {
    userId: user.id,
    entityType: 'user',
    entityId: user.id,
    metadata: { comSegundoFator: user.twoFactorEnabled },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  const session = await createSession(user.id, meta, describeDevice(meta.userAgent ?? null));
  return buildSessionResponse(updated, session);
}

interface SecondFactorResult {
  ok: boolean;
  usedRecoveryCode: boolean;
  remainingCodes: string[];
}

async function verifySecondFactor(
  user: { id: string; twoFactorSecret: string | null; recoveryCodeHashes: unknown },
  candidate: string | null,
): Promise<SecondFactorResult> {
  const hashes = readJsonArray<string>(user.recoveryCodeHashes);
  if (!candidate) return { ok: false, usedRecoveryCode: false, remainingCodes: hashes };

  if (/^\d{6}$/.test(candidate) && user.twoFactorSecret) {
    if (!secretsAvailable()) {
      throw serviceUnavailable(
        'A verificação em dois passos está ativa, mas o servidor não tem chave de cifragem configurada para a validar.',
      );
    }
    const secret = decryptSecret(user.twoFactorSecret);
    if (verifyTotp(secret, candidate)) {
      return { ok: true, usedRecoveryCode: false, remainingCodes: hashes };
    }
    return { ok: false, usedRecoveryCode: false, remainingCodes: hashes };
  }

  // Código de recuperação: formato `XXXXX-XXXXX`.
  const result = consumeRecoveryCode(hashes, candidate);
  if (result.ok) {
    await prisma.user.update({
      where: { id: user.id },
      data: { recoveryCodeHashes: writeJson(result.remaining) },
    });
  }
  return { ok: result.ok, usedRecoveryCode: result.ok, remainingCodes: result.remaining };
}

/* -------------------------------------------------------------------------- */
/* Sessões                                                                     */
/* -------------------------------------------------------------------------- */

export interface IssuedSession {
  sessionId: string;
  refreshToken: string;
  expiresAt: Date;
}

export async function createSession(
  userId: string,
  meta: RequestMetadata,
  deviceLabel: string | null,
): Promise<IssuedSession> {
  const refreshToken = generateToken(48);
  // A expiração é um instante, não uma data civil: a sessão tem de terminar 90 dias
  // depois, à mesma hora, e não à meia-noite do dia 90.
  const expiresAt = new Date(Date.now() + config.auth.sessionTtlDays * 86_400_000);

  const session = await prisma.session.create({
    data: {
      userId,
      refreshTokenHash: hashToken(refreshToken),
      userAgent: meta.userAgent?.slice(0, 255) ?? null,
      ipAddress: meta.ipAddress ?? null,
      deviceLabel,
      expiresAt,
      lastUsedAt: new Date(),
    },
  });

  await audit('session.created', {
    userId,
    entityType: 'session',
    entityId: session.id,
    metadata: { dispositivo: deviceLabel },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return { sessionId: session.id, refreshToken, expiresAt: session.expiresAt };
}

/**
 * Renova a sessão: valida o refresh token e emite um novo par de tokens.
 *
 * **O token de renovação é rodado em cada utilização.** O antigo deixa de funcionar no
 * instante em que é usado, e um novo toma o seu lugar na mesma sessão.
 *
 * Porquê, e não reutilizar o mesmo token indefinidamente: um refresh token vale 90 dias e é
 * o segredo mais valioso que um cliente guarda. Se for copiado — de uma cópia de segurança
 * do dispositivo, de um `localStorage` exposto, de um log — passa a dar acesso à conta
 * durante três meses, sem que nada o denuncie. Com rotação, o token roubado funciona no
 * máximo uma vez, e a partir daí o atacante e o utilizador estão em colisão: um dos dois vê
 * a sessão terminar, o que é precisamente o sinal que se quer.
 *
 * A sessão é a mesma (o mesmo `id`, o mesmo dispositivo na lista de sessões): rodar o token
 * não deve fazer aparecer um dispositivo novo em Definições → Segurança a cada hora.
 */
export async function refreshSession(
  refreshToken: string,
  meta: RequestMetadata,
): Promise<AuthSessionResponse> {
  const session = await prisma.session.findUnique({
    where: { refreshTokenHash: hashToken(refreshToken) },
    include: { user: true },
  });

  if (!session || session.revokedAt !== null) {
    throw unauthorized('A tua sessão terminou. Inicia sessão novamente.');
  }
  if (session.expiresAt.getTime() <= Date.now()) {
    throw unauthorized('A tua sessão expirou. Inicia sessão novamente.');
  }
  if (session.user.deletedAt !== null) {
    throw unauthorized('Esta conta já não está ativa.');
  }

  // Token novo, gravado como hash; o anterior deixa de corresponder a esta sessão.
  const rotatedToken = generateToken(48);
  await prisma.session.update({
    where: { id: session.id },
    data: {
      refreshTokenHash: hashToken(rotatedToken),
      lastUsedAt: new Date(),
      ipAddress: meta.ipAddress ?? null,
    },
  });

  return buildSessionResponse(session.user, {
    sessionId: session.id,
    refreshToken: rotatedToken,
    expiresAt: session.expiresAt,
  });
}

/** Termina a sessão atual (§30). */
export async function logout(sessionId: string | null, userId: string): Promise<void> {
  if (!sessionId) return;
  await prisma.session.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await audit('user.logout', { userId, entityType: 'session', entityId: sessionId });
}

/** Termina todas as sessões. Usado ao mudar a password (opção por omissão). */
export async function revokeAllSessions(userId: string, exceptSessionId?: string | null): Promise<number> {
  const result = await prisma.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
  await audit('user.logout_all', {
    userId,
    metadata: { sessoesRevogadas: result.count, excetoAtual: exceptSessionId ?? null },
  });
  return result.count;
}

/** Lista os dispositivos com sessão ativa, para o ecrã de segurança. */
export async function listSessions(userId: string) {
  const sessions = await prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: 'desc' },
    take: 50,
  });
  return sessions.map((session) => ({
    id: session.id,
    deviceLabel: session.deviceLabel,
    userAgent: session.userAgent,
    ipAddress: session.ipAddress,
    createdAt: session.createdAt.toISOString(),
    lastUsedAt: session.lastUsedAt ? session.lastUsedAt.toISOString() : null,
    expiresAt: session.expiresAt.toISOString(),
  }));
}

export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  const session = await prisma.session.findFirst({ where: { id: sessionId, userId } });
  if (!session) throw notFound('Não encontrámos esse dispositivo.');
  await prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
  await audit('session.revoked', { userId, entityType: 'session', entityId: sessionId });
}

/* -------------------------------------------------------------------------- */
/* Password                                                                    */
/* -------------------------------------------------------------------------- */

export async function changePassword(
  userId: string,
  input: { currentPassword: string; newPassword: string; revokeOtherSessions: boolean },
  currentSessionId: string | null,
): Promise<{ revokedSessions: number }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('Conta não encontrada.');

  const ok = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!ok) throw unauthorized('A password atual não está correta.');

  if (await verifyPassword(input.newPassword, user.passwordHash)) {
    throw unprocessable('A nova password tem de ser diferente da atual.');
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(input.newPassword),
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });

  await audit('user.password_changed', { userId, entityType: 'user', entityId: userId });

  const revokedSessions = input.revokeOtherSessions
    ? await revokeAllSessions(userId, currentSessionId)
    : 0;

  return { revokedSessions };
}

/* -------------------------------------------------------------------------- */
/* Recuperação de password (§29, §30)                                          */
/* -------------------------------------------------------------------------- */

/**
 * Propósito gravado em `OneTimeToken.purpose` para os tokens de recuperação.
 *
 * É um valor fixo, e não texto livre: a tabela é genérica e vai servir também para
 * verificação de email. Sem um propósito fixo, um token emitido para um fim poderia ser
 * aceite noutro.
 */
const PASSWORD_RESET_PURPOSE = 'password-reset';

/**
 * Duração do link de recuperação, em minutos.
 *
 * Uma hora é o compromisso habitual: dá tempo a quem vai buscar o email noutro
 * dispositivo, sem deixar um link válido a circular durante dias no histórico de uma
 * caixa de correio.
 */
const PASSWORD_RESET_TTL_MINUTES = 60;

/**
 * Pede a recuperação de password.
 *
 * Responde sempre a mesma coisa, exista ou não a conta. É a única forma de não transformar
 * este endpoint num oráculo de existência de contas — o mesmo cuidado que o `login` tem.
 * Por isso a função não devolve se a conta existe: quem chama não pode, por descuido,
 * deixar escapar essa informação na resposta.
 *
 * Quando a conta existe, invalida os pedidos anteriores antes de emitir um novo. Sem isto,
 * cada pedido deixaria mais um link válido a circular; com vários pedidos, o utilizador
 * (ou quem os tivesse intercetado) teria várias portas abertas em simultâneo.
 */
export async function requestPasswordReset(
  email: string,
  meta: RequestMetadata,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, deletedAt: true },
  });

  // Conta inexistente ou eliminada: nada a fazer. A resposta HTTP é idêntica à do caso
  // em que a conta existe, e é por isso que nada é comunicado a quem chama.
  if (!user || user.deletedAt !== null) {
    logger.info('Pedido de recuperação para conta inexistente ou eliminada', { email });
    return;
  }

  const token = generateToken(32);

  await prisma.$transaction([
    // Um pedido novo invalida os anteriores: só o link mais recente funciona.
    prisma.oneTimeToken.updateMany({
      where: { userId: user.id, purpose: PASSWORD_RESET_PURPOSE, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.oneTimeToken.create({
      data: {
        userId: user.id,
        purpose: PASSWORD_RESET_PURPOSE,
        // Só o hash fica na base de dados. Uma cópia da tabela não permite usar os links.
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60_000),
      },
    }),
  ]);

  const resetUrl = `${config.publicBaseUrl}/repor-password?token=${encodeURIComponent(token)}`;

  await sendEmail({
    to: user.email,
    subject: 'Zemlo — reposição da tua password',
    text: [
      'Recebemos um pedido para repor a password da tua conta Zemlo.',
      '',
      `Abre este endereço para escolher uma nova password (válido ${PASSWORD_RESET_TTL_MINUTES} minutos):`,
      resetUrl,
      '',
      'Se não foste tu, ignora este email: a tua password atual continua a funcionar.',
    ].join('\n'),
  });

  await audit('user.password_reset_requested', {
    userId: user.id,
    entityType: 'user',
    entityId: user.id,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });
}

/**
 * Conclui a recuperação, definindo uma nova password.
 *
 * Recusa token inexistente, já usado, expirado, ou emitido para outro propósito. A
 * validação usa o hash, e não o token em claro: o valor em claro só existe no link.
 *
 * Ao suceder, revoga **todas** as sessões da conta. É o ponto essencial do fluxo: quem
 * repõe a password pode tê-lo feito justamente porque perdeu o controlo da conta, e
 * deixar as sessões antigas ativas manteria o intruso dentro. É também o que torna a
 * reposição uma medida de segurança, e não apenas uma comodidade.
 */
export async function resetPassword(
  input: { token: string; newPassword: string },
  meta: RequestMetadata,
): Promise<{ revokedSessions: number }> {
  const tokenHash = hashToken(input.token);

  const record = await prisma.oneTimeToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, purpose: true, expiresAt: true, usedAt: true },
  });

  /*
   * Mensagem única para todos os motivos de recusa. Distinguir "não existe" de "expirou"
   * de "já foi usado" diria a quem tem um link antigo se ele chegou a ser válido — e a
   * quem está a sondar, se um token existe.
   */
  const invalid = () =>
    unauthorized('Este link de recuperação já não é válido. Pede um novo.');

  if (!record || record.purpose !== PASSWORD_RESET_PURPOSE) throw invalid();
  if (record.usedAt !== null) throw invalid();
  if (record.expiresAt.getTime() <= Date.now()) throw invalid();

  const user = await prisma.user.findUnique({
    where: { id: record.userId },
    select: { id: true, passwordHash: true, deletedAt: true },
  });
  if (!user || user.deletedAt !== null) throw invalid();

  /*
   * Marcar como usado e trocar a password na mesma transação, com uma condição no
   * `usedAt`: duas tentativas simultâneas com o mesmo link não podem ambas ter sucesso.
   * A verificação acima já leu `usedAt`, mas entre a leitura e a escrita cabe outra
   * tentativa — e é exatamente essa corrida que torna um token de uso único reutilizável.
   */
  const { count, revoked } = await prisma.$transaction(async (tx) => {
    const claimed = await tx.oneTimeToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) return { count: 0, revoked: 0 };

    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(input.newPassword),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });

    const sessions = await tx.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { count: claimed.count, revoked: sessions.count };
  });

  if (count === 0) throw invalid();

  await audit('user.password_reset_completed', {
    userId: user.id,
    entityType: 'user',
    entityId: user.id,
    metadata: { sessoesRevogadas: revoked },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  logger.info('Password reposta por recuperação; sessões revogadas', {
    userId: user.id,
    sessions: revoked,
  });

  return { revokedSessions: revoked };
}

/* -------------------------------------------------------------------------- */
/* Verificação em dois passos (§29)                                            */
/* -------------------------------------------------------------------------- */

/** Passo 1: gerar o segredo e os códigos de recuperação, sem ativar ainda. */
export async function startTwoFactorSetup(userId: string): Promise<TwoFactorSetupResponse> {
  if (!secretsAvailable()) {
    throw serviceUnavailable(
      'A verificação em dois passos precisa de uma chave de cifragem configurada no servidor.',
      { missingEnv: 'ENCRYPTION_KEY' },
    );
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('Conta não encontrada.');
  if (user.twoFactorEnabled) {
    throw conflict('A verificação em dois passos já está ativa nesta conta.');
  }

  const secret = generateTotpSecret();
  const recoveryCodes = generateRecoveryCodes(10);

  // O segredo é guardado cifrado mas ainda não confirmado: `twoFactorEnabled`
  // continua falso até o utilizador provar que consegue gerar um código válido.
  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFactorSecret: encryptSecret(secret),
      recoveryCodeHashes: writeJson(hashRecoveryCodes(recoveryCodes)),
      twoFactorConfirmedAt: null,
    },
  });

  await audit('user.2fa_setup_started', { userId, entityType: 'user', entityId: userId });

  return {
    secret,
    otpauthUri: buildOtpauthUri(secret, user.email),
    recoveryCodes,
  };
}

/** Passo 2: confirmar com um código válido e ativar. */
export async function confirmTwoFactorSetup(
  userId: string,
  input: { secret: string; totp: string },
): Promise<{ enabled: true }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('Conta não encontrada.');
  if (!user.twoFactorSecret) {
    throw unprocessable('Começa por gerar um novo segredo de verificação.');
  }

  const storedSecret = decryptSecret(user.twoFactorSecret);
  if (storedSecret !== input.secret) {
    throw unprocessable('O segredo não corresponde ao que foi gerado. Recomeça a configuração.');
  }
  if (!verifyTotp(storedSecret, input.totp)) {
    throw unprocessable('O código não é válido. Confirma a hora do teu dispositivo e tenta novamente.');
  }

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: true, twoFactorConfirmedAt: new Date() },
  });

  await audit('user.2fa_enabled', { userId, entityType: 'user', entityId: userId });
  return { enabled: true };
}

export async function disableTwoFactor(
  userId: string,
  input: { password: string; totp?: string | undefined },
): Promise<{ enabled: false }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('Conta não encontrada.');

  if (!(await verifyPassword(input.password, user.passwordHash))) {
    throw unauthorized('A password não está correta.');
  }

  // Desativar 2FA é uma operação de redução de segurança: exigimos o segundo fator
  // quando existe, para que uma sessão roubada não consiga desligá-lo sozinha.
  if (user.twoFactorEnabled && user.twoFactorSecret) {
    const secret = decryptSecret(user.twoFactorSecret);
    const codeOk = input.totp ? verifyTotp(secret, input.totp) : false;
    const recovery = input.totp ? consumeRecoveryCode(readJsonArray<string>(user.recoveryCodeHashes), input.totp) : { ok: false };
    if (!codeOk && !recovery.ok) {
      throw unauthorized('Introduz um código válido da tua app autenticadora para desativar a verificação em dois passos.');
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorConfirmedAt: null,
      recoveryCodeHashes: jsonOrNull(null),
    },
  });

  await audit('user.2fa_disabled', { userId, entityType: 'user', entityId: userId });
  return { enabled: false };
}

/* -------------------------------------------------------------------------- */
/* Perfil e preferências                                                       */
/* -------------------------------------------------------------------------- */

export async function getProfile(userId: string): Promise<UserProfile> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      _count: { select: { vehicles: true, expenses: true, documents: true, integrations: true } },
    },
  });
  if (!user) throw notFound('Conta não encontrada.');

  const onboarding = await computeOnboarding(userId);

  return mapUserProfile(
    user,
    {
      vehicles: user._count.vehicles,
      expenses: user._count.expenses,
      documents: user._count.documents,
      integrations: user._count.integrations,
    },
    onboarding,
  );
}

/**
 * Passos de configuração em falta (§6).
 *
 * Calculado, nunca guardado: se o utilizador apagar o seguro, o passo volta a estar
 * em falta, como deve ser. Um indicador de progresso guardado em base de dados
 * acabaria por divergir da realidade.
 */
async function computeOnboarding(userId: string): Promise<UserProfile['onboarding']> {
  const vehicles = await prisma.vehicle.findMany({
    where: { userId, archived: false },
    select: { id: true, odometerKm: true },
    take: 100,
  });

  if (vehicles.length === 0) {
    return {
      hasVehicle: false,
      hasOdometer: false,
      hasInsurance: false,
      hasInspection: false,
      hasMaintenancePlan: false,
      complete: false,
    };
  }

  const vehicleIds = vehicles.map((vehicle) => vehicle.id);

  const [insurance, inspection, reminders] = await Promise.all([
    prisma.insurancePolicy.count({ where: { vehicleId: { in: vehicleIds } } }),
    prisma.inspectionRecord.count({ where: { vehicleId: { in: vehicleIds } } }),
    prisma.reminder.count({ where: { vehicleId: { in: vehicleIds }, completedAt: null } }),
  ]);

  const hasOdometer = vehicles.some((vehicle) => vehicle.odometerKm !== null);
  const result = {
    hasVehicle: true,
    hasOdometer,
    hasInsurance: insurance > 0,
    hasInspection: inspection > 0,
    hasMaintenancePlan: reminders > 0,
    complete: false,
  };

  // A configuração considera-se completa quando os dados que tornam o produto útil
  // estão presentes: quilometragem e um plano de manutenção. Seguro e inspeção variam
  // por país e por veículo, por isso não bloqueiam a conclusão.
  return { ...result, complete: hasOdometer && reminders > 0 };
}

export async function updateProfile(
  userId: string,
  input: {
    name?: string | null | undefined;
    timeZone?: string | undefined;
    locale?: string | undefined;
    distanceUnit?: string | undefined;
    volumeUnit?: string | undefined;
  },
): Promise<UserProfile> {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.timeZone !== undefined ? { timeZone: resolveTimeZone(input.timeZone) } : {}),
        ...(input.locale !== undefined ? { locale: input.locale } : {}),
        ...(input.distanceUnit !== undefined ? { distanceUnit: input.distanceUnit } : {}),
        ...(input.volumeUnit !== undefined ? { volumeUnit: input.volumeUnit } : {}),
      },
    });
  } catch (error) {
    throw translatePrismaError(error, 'atualizar perfil');
  }

  await audit('user.profile_updated', { userId, entityType: 'user', entityId: userId });
  return getProfile(userId);
}

export async function getPreferences(userId: string) {
  const [preferences, notifications] = await Promise.all([
    prisma.userPreference.findUnique({ where: { userId } }),
    prisma.notificationPreference.findMany({ where: { userId } }),
  ]);

  return {
    reminderLeadDays: preferences?.reminderLeadDays ?? 30,
    reminderLeadKm: preferences?.reminderLeadKm ?? 1000,
    suggestionsEnabled: preferences?.suggestionsEnabled ?? true,
    securityNudgeSnoozeDays: preferences?.securityNudgeSnoozeDays ?? 90,
    frequentExpenseCategories: readJsonArray<string>(preferences?.frequentExpenseCategories),
    hiddenFields: readJsonArray<string>(preferences?.hiddenFields),
    notifications: notifications.map((item) => ({
      topic: item.topic,
      channel: item.channel,
      frequency: item.frequency,
    })),
  };
}

export async function updatePreferences(
  userId: string,
  input: {
    reminderLeadDays?: number | undefined;
    reminderLeadKm?: number | undefined;
    suggestionsEnabled?: boolean | undefined;
    securityNudgeSnoozeDays?: number | undefined;
    frequentExpenseCategories?: string[] | undefined;
    hiddenFields?: string[] | undefined;
    notifications?: Array<{ topic: string; channel: string; frequency: string }> | undefined;
  },
): Promise<Awaited<ReturnType<typeof getPreferences>>> {
  await prisma.userPreference.upsert({
    where: { userId },
    create: {
      userId,
      reminderLeadDays: input.reminderLeadDays ?? 30,
      reminderLeadKm: input.reminderLeadKm ?? 1000,
      suggestionsEnabled: input.suggestionsEnabled ?? true,
      securityNudgeSnoozeDays: input.securityNudgeSnoozeDays ?? 90,
      frequentExpenseCategories: writeJson(input.frequentExpenseCategories ?? null),
      hiddenFields: writeJson(input.hiddenFields ?? null),
    },
    update: {
      ...(input.reminderLeadDays !== undefined ? { reminderLeadDays: input.reminderLeadDays } : {}),
      ...(input.reminderLeadKm !== undefined ? { reminderLeadKm: input.reminderLeadKm } : {}),
      ...(input.suggestionsEnabled !== undefined ? { suggestionsEnabled: input.suggestionsEnabled } : {}),
      ...(input.securityNudgeSnoozeDays !== undefined
        ? { securityNudgeSnoozeDays: input.securityNudgeSnoozeDays }
        : {}),
      ...(input.frequentExpenseCategories !== undefined
        ? { frequentExpenseCategories: writeJson(input.frequentExpenseCategories) }
        : {}),
      ...(input.hiddenFields !== undefined ? { hiddenFields: writeJson(input.hiddenFields) } : {}),
    },
  });

  if (input.notifications && input.notifications.length > 0) {
    for (const preference of input.notifications) {
      await prisma.notificationPreference.upsert({
        where: {
          userId_topic_channel: {
            userId,
            topic: preference.topic,
            channel: preference.channel,
          },
        },
        create: {
          userId,
          topic: preference.topic,
          channel: preference.channel,
          frequency: preference.frequency,
        },
        update: { frequency: preference.frequency },
      });
    }
  }

  await audit('user.preferences_updated', { userId, entityType: 'user', entityId: userId });
  return getPreferences(userId);
}

/* -------------------------------------------------------------------------- */
/* Eliminação de conta (§30)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Elimina a conta e todos os dados associados.
 *
 * Apagamos de facto, em cascata, e não marcamos como "eliminado": o utilizador tem
 * direito a que os seus dados desapareçam, e o Zemlo guarda localização, custos e
 * documentos (§31). A única coisa que sobrevive é a entrada de auditoria da própria
 * eliminação, sem dados pessoais.
 */
export async function deleteAccount(
  userId: string,
  input: { password?: string | undefined; totp?: string | undefined },
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('Conta não encontrada.');

  if (user.passwordHash) {
    if (!input.password) throw unprocessable('Confirma a tua password para eliminar a conta.');
    if (!(await verifyPassword(input.password, user.passwordHash))) {
      throw unauthorized('A password não está correta.');
    }
  }

  if (user.twoFactorEnabled && user.twoFactorSecret) {
    const secret = decryptSecret(user.twoFactorSecret);
    if (!input.totp || !verifyTotp(secret, input.totp)) {
      throw unauthorized('Introduz um código válido da tua app autenticadora.');
    }
  }

  const counts = await prisma.vehicle.count({ where: { userId } });

  await audit('user.deleted_account', {
    userId: null,
    entityType: 'user',
    entityId: userId,
    metadata: { veiculosEliminados: counts },
  });

  // As relações em cascata no schema tratam dos veículos e de tudo o que deles depende.
  await prisma.user.delete({ where: { id: userId } });
  logger.info('Conta eliminada a pedido do utilizador', { veiculos: counts });
}

/* -------------------------------------------------------------------------- */
/* Utilitários                                                                 */
/* -------------------------------------------------------------------------- */

/** `true` quando um utilizador existe e não está eliminado. */
export async function requireUser(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { deletedAt: true } });
  if (!user || user.deletedAt !== null) throw notFound('Conta não encontrada.');
}

/** Emite o par de tokens e o perfil para uma sessão. */
async function buildSessionResponse(
  user: { id: string; email: string; timeZone: string },
  session: IssuedSession,
): Promise<AuthSessionResponse> {
  const accessToken = await signAccessToken({
    sub: user.id,
    email: user.email,
    sid: session.sessionId,
  });

  return {
    user: await getProfile(user.id),
    tokens: {
      accessToken,
      expiresIn: config.auth.accessTokenTtlMinutes * 60,
      tokenType: 'Bearer',
      /*
       * O refresh token é devolvido aqui — e é a única altura em que existe em claro.
       *
       * O cliente guarda-o e usa-o em `POST /auth/refresh` quando o token de acesso
       * expira. Na primeira versão este campo não era devolvido, o que tornava a renovação
       * impossível: o endpoint pedia um valor que o servidor nunca comunicava, e todas as
       * sessões terminavam ao fim de uma hora, apesar dos 90 dias configurados.
       */
      refreshToken: session.refreshToken,
    },
  };
}

/** Autentica um access token e devolve o utilizador associado. */
export async function authenticateAccessToken(token: string): Promise<AuthenticatedUser> {
  const payload = await verifyAccessToken(token);
  if (!payload) throw unauthorized('A tua sessão terminou. Inicia sessão novamente.');

  /*
   * A sessão é obrigatória e é validada **sempre**.
   *
   * Antes, esta verificação estava dentro de `if (payload.sid)`: um token assinado
   * corretamente mas sem o `sid` era aceite apenas com base na assinatura. Como os
   * restantes campos (`sub`, `email`) vinham do próprio token, quem conhecesse o
   * `JWT_SECRET` podia forjar um token sem sessão e usá-lo para ler todos os dados da
   * conta, alterar a password e revogar as sessões do dono — tomada de conta completa. O
   * `docs/ARCHITECTURE.md` afirmava que a sessão era validada em cada pedido; não era.
   *
   * Um token sem `sid`, com um `sid` inexistente, com um `sid` revogado, expirado, ou
   * pertencente a outra conta é agora rejeitado. Validar também a pertença (e não só a
   * existência) da sessão é o que impede que um `sid` alheio, ou um `sid` reaproveitado
   * noutro token, dê acesso à conta errada.
   */
  if (!payload.sid) {
    throw unauthorized('A tua sessão terminou. Inicia sessão novamente.');
  }

  const session = await prisma.session.findUnique({
    where: { id: payload.sid },
    select: { id: true, revokedAt: true, expiresAt: true, userId: true },
  });

  if (
    !session ||
    session.revokedAt !== null ||
    session.expiresAt.getTime() <= Date.now() ||
    session.userId !== payload.sub
  ) {
    throw unauthorized('A tua sessão terminou. Inicia sessão novamente.');
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, timeZone: true, deletedAt: true },
  });
  if (!user || user.deletedAt !== null) throw unauthorized('Esta conta já não está ativa.');

  return { id: user.id, email: user.email, sessionId: session.id, timeZone: user.timeZone };
}

/** Descreve o dispositivo a partir do `User-Agent`, para o ecrã de sessões. */
function describeDevice(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  const platform = ua.includes('iphone') || ua.includes('ipad')
    ? 'iOS'
    : ua.includes('android')
      ? 'Android'
      : ua.includes('windows')
        ? 'Windows'
        : ua.includes('mac os')
          ? 'macOS'
          : ua.includes('linux')
            ? 'Linux'
            : null;
  const browser = ua.includes('edg/')
    ? 'Edge'
    : ua.includes('chrome/')
      ? 'Chrome'
      : ua.includes('safari/')
        ? 'Safari'
        : ua.includes('firefox/')
          ? 'Firefox'
          : ua.includes('zemlo')
            ? 'App Zemlo'
            : null;
  const parts = [browser, platform].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Utilizado em testes e no seed para obter a data civil de hoje no fuso do utilizador. */
export function todayFor(timeZone: string): CivilDate {
  return todayIn(timeZone);
}

/**
 * Normaliza um fuso horário para um valor sempre utilizável.
 *
 * Existe como guarda de segunda linha: o esquema de validação já recusa fusos inválidos,
 * mas um valor inválido pode chegar por outro caminho (uma base de dados antiga, uma
 * migração, um cliente que ignore o contrato). Como "hoje" é o alicerce de praticamente
 * todas as funcionalidades, guardar um fuso inválido inutilizaria a conta inteira.
 */
export function resolveTimeZone(candidate: string | null | undefined): string {
  return isValidTimeZone(candidate) ? (candidate as string) : DEFAULT_TIME_ZONE;
}
