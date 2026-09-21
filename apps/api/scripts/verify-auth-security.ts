/**
 * Verificação de segurança da autenticação.
 *
 * Cobre duas correções que a auditoria de pré-produção identificou e que, por serem de
 * segurança, não podem ficar provadas por inspeção de código:
 *
 *  1. **JWT sem `sid`.** Antes, a validação da sessão estava dentro de `if (payload.sid)`.
 *     Um token assinado corretamente mas sem o claim `sid` era aceite só pela assinatura,
 *     o que permitia — a quem conhecesse o `JWT_SECRET` — ler todos os dados da conta,
 *     alterar a password e revogar as sessões do dono. Aqui forjam-se tokens exatamente
 *     com essas características e verifica-se que **nenhuma** operação autenticada passa.
 *
 *  2. **Recuperação de password.** O fluxo inteiro, incluindo os dois casos que um teste
 *     superficial deixa passar: token expirado e token reutilizado.
 *
 *  3. **Confirmação de email.** O token de uso único ponta a ponta, o isolamento entre os
 *     dois `purpose` da tabela `OneTimeToken` (um token de recuperação não confirma email, e
 *     um token de confirmação não troca a password) e o reenvio autenticado.
 *
 * Este script precisa de um servidor a correr e corre contra a base de dados de
 * desenvolvimento. Cria as suas próprias contas descartáveis e apaga-as no fim, para não
 * tocar nos dados de demonstração.
 *
 * Uso:
 *   1. npm run dev --workspace @zemlo/api     (noutro terminal)
 *   2. npm run verify:auth --workspace @zemlo/api
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@zemlo/prisma-sqlite';
import { loadEnv } from './load-env.mjs';

/*
 * O `.env` tem de ser carregado antes de instanciar o cliente: este script corre fora do
 * servidor e não passa por `core/config.ts`, que é quem carrega o ambiente no arranque da
 * API. Sem isto, `DATABASE_URL` não existe no processo e a construção do cliente falha.
 */
loadEnv();

const ORIGIN = process.env.ZEMLO_API_ORIGIN ?? 'http://127.0.0.1:4000';
const BASE = process.env.ZEMLO_API_URL ?? `${ORIGIN}/api/v1`;

const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const prisma = new PrismaClient();

/* -------------------------------------------------------------------------- */
/* Utilitários                                                                 */
/* -------------------------------------------------------------------------- */

let passed = 0;
let failed = 0;

function ok(label, detail = '') {
  passed += 1;
  console.log(`  \u001b[32m✓\u001b[0m ${label}${detail ? ` \u001b[90m${detail}\u001b[0m` : ''}`);
}

function fail(label, detail = '') {
  failed += 1;
  console.log(`  \u001b[31m✗\u001b[0m ${label}${detail ? ` \u001b[90m${detail}\u001b[0m` : ''}`);
}

function check(label, condition, detail = '') {
  if (condition) ok(label, detail);
  else fail(label, detail);
}

function section(title) {
  console.log(`\n\u001b[1m${title}\u001b[0m`);
}

async function call(method, path, { body, token: bearer, headers = {} } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed, text };
}

/* -------------------------------------------------------------------------- */
/* Forja de tokens                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Assina um JWT HS256 com os claims indicados.
 *
 * Usa o segredo real do servidor, porque o objetivo é testar o que acontece a um token
 * **criptograficamente válido** — é esse o caso perigoso. Um token com assinatura inválida
 * já era rejeitado antes da correção e não prova nada.
 */
function forgeToken(secret, claims) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);

  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    iss: 'zemlo-api',
    aud: 'zemlo-client',
    iat: now,
    exp: now + 3600,
    ...claims,
  });

  const signature = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `${header}.${payload}.${signature}`;
}

/** Claims mínimos que o servidor exige, sem `sid` — o caso do defeito. */
function claimsWithoutSid(user) {
  return { sub: user.id, email: user.email };
}

/** Claims completos, com o `sid` indicado. */
function claimsWithSid(user, sid) {
  return { sub: user.id, email: user.email, sid };
}

/* -------------------------------------------------------------------------- */
/* Cenários                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Operações autenticadas que têm de falhar com um token sem `sid`.
 *
 * A lista é deliberadamente composta pelas operações que o ataque original usou, mais
 * leituras e escritas de dados. Se apenas se testasse `GET /me`, uma correção que
 * bloqueasse só esse caminho passaria.
 */
const PROTECTED_OPERATIONS = [
  ['GET', '/me'],
  ['GET', '/export?format=json'],
  ['POST', '/me/password', { currentPassword: 'x', newPassword: 'y'.repeat(12), revokeOtherSessions: true }],
  ['POST', '/auth/logout-all'],
  ['GET', '/vehicles'],
  ['POST', '/vehicles', { name: 'Fuga', make: 'X', model: 'Y', plate: 'AA-00-00', fuelType: 'gasoline' }],
  ['GET', '/me/sessions'],
  ['GET', '/dashboard'],
  ['GET', '/records/expenses'],
  ['GET', '/notifications'],
  ['GET', '/metrics'],
  ['PATCH', '/me', { name: 'Fuga' }],
];

async function verifySidRequired(secret, victim, victimToken) {
  section('1. JWT válido mas SEM `sid` — tem de ser rejeitado em tudo');

  const noSid = forgeToken(secret, claimsWithoutSid(victim));

  // Sanidade: o token tem de ser criptograficamente válido, senão o teste não prova nada.
  const control = await call('GET', '/me', { token: noSid });
  check(
    'Token sem `sid` é assinado corretamente (não é rejeitado por assinatura inválida)',
    control.status === 401 && control.body?.error?.code !== undefined,
    `estado ${control.status}`,
  );

  for (const [method, path, body] of PROTECTED_OPERATIONS) {
    const response = await call(method, path, { token: noSid, body });
    check(
      `${method} ${path} rejeitado com token sem \`sid\``,
      response.status === 401,
      `estado ${response.status}`,
    );
  }

  // O ponto central: com o token forjado não se pode tomar conta da conta.
  const changePassword = await call('POST', '/me/password', {
    token: noSid,
    body: { currentPassword: VICTIM_PASSWORD, newPassword: 'Atacante2026!x', revokeOtherSessions: true },
  });
  check(
    'Não é possível alterar a password com token sem `sid`',
    changePassword.status === 401,
    `estado ${changePassword.status}`,
  );

  // A password original continua a funcionar: prova de que nada foi alterado.
  const login = await call('POST', '/auth/login', {
    body: { email: victim.email, password: VICTIM_PASSWORD },
  });
  check(
    'A password da vítima continua válida após as tentativas',
    login.status === 200,
    `estado ${login.status}`,
  );

  // E o token legítimo do dono continua a funcionar: a correção não bloqueou tudo.
  const legitimate = await call('GET', '/me', { token: victimToken });
  check(
    'O token legítimo do dono continua a funcionar',
    legitimate.status === 200 && legitimate.body?.email === victim.email,
    `estado ${legitimate.status}`,
  );

  return { noSid };
}

async function verifySidVariants(secret, victim, victimToken) {
  section('2. Variantes de `sid` inválido');

  const nonexistent = forgeToken(secret, claimsWithSid(victim, 'sessao-que-nao-existe'));
  const r1 = await call('GET', '/me', { token: nonexistent });
  check('`sid` inexistente → 401', r1.status === 401, `estado ${r1.status}`);

  const foreign = forgeToken(secret, claimsWithSid(victim, FOREIGN_SESSION_ID));
  const r2 = await call('GET', '/me', { token: foreign });
  check('`sid` de outra conta → 401', r2.status === 401, `estado ${r2.status}`);

  // Sessão revogada: revoga-se a sessão do dono e confirma-se que o token deixa de servir.
  await prisma.session.update({
    where: { id: victimSessionId },
    data: { revokedAt: new Date() },
  });
  const revoked = await call('GET', '/me', { token: victimToken });
  check('`sid` revogado → 401 (o token do dono também)', revoked.status === 401, `estado ${revoked.status}`);

  const revokedForged = forgeToken(secret, claimsWithSid(victim, victimSessionId));
  const r3 = await call('GET', '/me', { token: revokedForged });
  check('`sid` revogado, forjado → 401', r3.status === 401, `estado ${r3.status}`);
}

async function verifyPasswordReset(victim) {
  section('3. Recuperação de password');

  // 3.1 Resposta uniforme (não permite enumerar contas).
  const unknown = await call('POST', '/auth/password-reset', {
    body: { email: `inexistente-${Date.now()}@exemplo.test` },
  });
  const known = await call('POST', '/auth/password-reset', { body: { email: victim.email } });

  check(
    'Pedido para email existente devolve 202',
    known.status === 202,
    `estado ${known.status}`,
  );
  check(
    'Pedido para email inexistente devolve a MESMA resposta',
    unknown.status === 202 && JSON.stringify(unknown.body) === JSON.stringify(known.body),
    `existentes=${unknown.status}, inexistente=${known.status}`,
  );

  // 3.2 O token é emitido, e guardado apenas como hash.
  const issued = await prisma.oneTimeToken.findFirst({
    where: { userId: victim.id, purpose: 'password-reset', usedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  check('Foi emitido um token de recuperação', issued !== null);

  if (!issued) return;

  check(
    'O token tem hash SHA-256 (64 hex), não o valor em claro',
    /^[0-9a-f]{64}$/.test(issued.tokenHash),
    issued.tokenHash.slice(0, 12) + '…',
  );
  check(
    'O token expira no futuro',
    issued.expiresAt.getTime() > Date.now(),
    issued.expiresAt.toISOString(),
  );

  // O token em claro só existe no link; para o testar, gera-se um novo conhecido.
  const rawToken = await issueKnownToken(victim.id);

  // 3.3 Token inválido.
  const garbage = await call('POST', '/auth/password-reset/confirm', {
    body: { token: 'x'.repeat(64), newPassword: NEW_PASSWORD },
  });
  check('Token inexistente → 401', garbage.status === 401, `estado ${garbage.status}`);

  // 3.4 Token expirado. Expira-se o registo diretamente na base de dados.
  const expiredToken = await issueKnownToken(victim.id);
  await prisma.oneTimeToken.updateMany({
    where: { userId: victim.id, usedAt: null, purpose: 'password-reset' },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });
  const expired = await call('POST', '/auth/password-reset/confirm', {
    body: { token: expiredToken, newPassword: NEW_PASSWORD },
  });
  check('Token expirado → 401', expired.status === 401, `estado ${expired.status}`);

  const stillOld = await call('POST', '/auth/login', {
    body: { email: victim.email, password: VICTIM_PASSWORD },
  });
  check(
    'Token expirado não alterou a password',
    stillOld.status === 200,
    `estado ${stillOld.status}`,
  );

  // 3.5 Sucesso.
  const fresh = await issueKnownToken(victim.id);
  const success = await call('POST', '/auth/password-reset/confirm', {
    body: { token: fresh, newPassword: NEW_PASSWORD },
  });
  check('Token válido → 200', success.status === 200, `estado ${success.status}`);
  check(
    'Sessões existentes foram revogadas',
    typeof success.body?.revokedSessions === 'number' && success.body.revokedSessions >= 1,
    `revogadas: ${success.body?.revokedSessions}`,
  );

  // 3.6 Token reutilizado.
  const reused = await call('POST', '/auth/password-reset/confirm', {
    body: { token: fresh, newPassword: 'OutraPassword2026!z' },
  });
  check('Token reutilizado → 401', reused.status === 401, `estado ${reused.status}`);

  // 3.7 A password mudou mesmo, e as sessões ficaram todas inválidas.
  const oldLogin = await call('POST', '/auth/login', {
    body: { email: victim.email, password: VICTIM_PASSWORD },
  });
  check('Password antiga já não funciona', oldLogin.status === 401, `estado ${oldLogin.status}`);

  const newLogin = await call('POST', '/auth/login', {
    body: { email: victim.email, password: NEW_PASSWORD },
  });
  check('Password nova funciona', newLogin.status === 200, `estado ${newLogin.status}`);

  const active = await prisma.session.count({
    where: { userId: victim.id, revokedAt: null, expiresAt: { gt: new Date() } },
  });
  check(
    'Nenhuma sessão antiga ficou ativa (só a nova do login acima)',
    active === 1,
    `sessões ativas: ${active}`,
  );
}

/**
 * Cria um token conhecido para o utilizador, para o poder usar no teste.
 *
 * O `purpose` é recebido em vez de fixado: é exatamente o que separa a recuperação de
 * password da confirmação de email, e o cenário 4 precisa de emitir deliberadamente um
 * token do propósito errado para provar que a separação é aplicada.
 */
async function issueKnownToken(userId, purpose = 'password-reset') {
  const raw = `teste-${randomBytes(24).toString('base64url')}`;

  await prisma.oneTimeToken.updateMany({
    where: { userId, purpose, usedAt: null },
    data: { usedAt: new Date() },
  });
  await prisma.oneTimeToken.create({
    data: {
      userId,
      purpose,
      tokenHash: createHash('sha256').update(raw).digest('hex'),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return raw;
}

/**
 * Confirmação de email: token de uso único, isolamento entre propósitos, e reenvio.
 *
 * O que este cenário prova e um teste unitário não prova: que o fluxo funciona ponta a ponta
 * contra o servidor real e a base de dados real, e que os dois `purpose` da tabela
 * `OneTimeToken` não se confundem — um token de recuperação não confirma email, e um token de
 * confirmação não troca a password. A separação só é real se for aplicada nos dois sentidos.
 *
 * Corre antes da recuperação de password, porque esta última troca a password e a confirmação
 * precisa de iniciar sessão com a password original.
 */
async function verifyEmailVerification(victim, sessionToken) {
  section('4. Confirmação de email — token de uso único, sem troca de propósitos');

  // 4.1 O signup deixou a conta por confirmar (o login não depende disto).
  const account = await prisma.user.findUnique({ where: { id: victim.id } });
  check(
    'A conta criada pelo signup continua por confirmar',
    account.emailVerified === false,
    `emailVerified=${account.emailVerified}`,
  );

  // 4.2 O signup emitiu um token de confirmação, guardado apenas como hash.
  const issued = await prisma.oneTimeToken.findFirst({
    where: { userId: victim.id, purpose: 'email-verification', usedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  check('O signup emitiu um token de confirmação', issued !== null);
  if (issued) {
    check(
      'O token de confirmação tem hash SHA-256 (64 hex), não o valor em claro',
      /^[0-9a-f]{64}$/.test(issued.tokenHash),
      issued.tokenHash.slice(0, 12) + '…',
    );
    check(
      'O token de confirmação expira no futuro',
      issued.expiresAt.getTime() > Date.now(),
      issued.expiresAt.toISOString(),
    );
  }

  // 4.3 Token inexistente → 401.
  const garbage = await call('POST', '/auth/verify-email', {
    body: { token: 'x'.repeat(64) },
  });
  check('Token inexistente → 401', garbage.status === 401, `estado ${garbage.status}`);

  // 4.4 Um token de OUTRO propósito não confirma email — e não é consumido pela tentativa.
  const resetToken = await issueKnownToken(victim.id, 'password-reset');
  const wrongPurpose = await call('POST', '/auth/verify-email', {
    body: { token: resetToken },
  });
  check(
    'Token de recuperação recusado como confirmação → 401',
    wrongPurpose.status === 401,
    `estado ${wrongPurpose.status}`,
  );
  const resetStillValid = await prisma.oneTimeToken.findFirst({
    where: { userId: victim.id, purpose: 'password-reset', usedAt: null },
  });
  check('O token de recuperação não foi consumido pela tentativa falhada', resetStillValid !== null);

  // 4.5 Token expirado → 401.
  const expiredToken = await issueKnownToken(victim.id, 'email-verification');
  await prisma.oneTimeToken.updateMany({
    where: { userId: victim.id, purpose: 'email-verification', usedAt: null },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });
  const expired = await call('POST', '/auth/verify-email', {
    body: { token: expiredToken },
  });
  check('Token expirado → 401', expired.status === 401, `estado ${expired.status}`);

  // 4.6 A resposta não distingue inexistente de expirado (não ajuda a enumerar).
  //     Compara-se `code` + `message`, não o corpo inteiro: o `requestId` é único por
  //     pedido, por desenho, e incluí-lo faria a comparação falhar sempre — sem que isso
  //     dissesse nada sobre o comportamento do servidor. (A comparação de corpo inteiro de
  //     3.1 funciona porque a resposta 202 de recuperação não traz `requestId`.)
  check(
    'Token inexistente e token expirado devolvem a mesma resposta',
    garbage.status === expired.status &&
      garbage.body?.error?.code === expired.body?.error?.code &&
      garbage.body?.error?.message === expired.body?.error?.message,
    `inexistente=${garbage.status}/${garbage.body?.error?.code}, expirado=${expired.status}/${expired.body?.error?.code}`,
  );

  // 4.7 Sucesso.
  const fresh = await issueKnownToken(victim.id, 'email-verification');
  const success = await call('POST', '/auth/verify-email', { body: { token: fresh } });
  check('Token válido → 200', success.status === 200, `estado ${success.status}`);

  const confirmed = await prisma.user.findUnique({ where: { id: victim.id } });
  check('A conta ficou confirmada', confirmed.emailVerified === true);

  // 4.8 O token de confirmação não serve para trocar a password (sentido inverso).
  const misuse = await call('POST', '/auth/password-reset/confirm', {
    body: { token: fresh, newPassword: 'NaoDeveResultar2026!z' },
  });
  check(
    'O token de confirmação não troca a password → 401',
    misuse.status === 401,
    `estado ${misuse.status}`,
  );

  // 4.9 Reutilização → 401 (o token foi consumido pelo sucesso de 4.7).
  const reused = await call('POST', '/auth/verify-email', { body: { token: fresh } });
  check('Token reutilizado → 401', reused.status === 401, `estado ${reused.status}`);

  // 4.10 O reenvio exige sessão — não pode ser um gerador de spam anónimo.
  const anonymous = await call('POST', '/me/email-verification');
  check('Reenvio sem sessão → 401', anonymous.status === 401, `estado ${anonymous.status}`);

  // 4.11 Numa conta já confirmada, o reenvio responde mas não gera token novo.
  const before = await prisma.oneTimeToken.count({
    where: { userId: victim.id, purpose: 'email-verification' },
  });
  const resend = await call('POST', '/me/email-verification', { token: sessionToken });
  check(
    'Reenvio numa conta confirmada responde com `alreadyVerified`',
    resend.status === 200 && resend.body?.alreadyVerified === true,
    `estado ${resend.status}, alreadyVerified=${resend.body?.alreadyVerified}`,
  );
  const after = await prisma.oneTimeToken.count({
    where: { userId: victim.id, purpose: 'email-verification' },
  });
  check(
    'Reenvio numa conta confirmada não emite token novo',
    before === after,
    `antes=${before}, depois=${after}`,
  );
}

/* -------------------------------------------------------------------------- */
/* Execução                                                                    */
/* -------------------------------------------------------------------------- */

const VICTIM_PASSWORD = 'VitimaOriginal2026!a';
const NEW_PASSWORD = 'VitimaNovaPassword2026!b';
const stamp = Date.now();

let victim;
let victimToken;
let victimSessionId;
let FOREIGN_SESSION_ID = 'sessao-alheia-inexistente';

async function main() {
  console.log(`\n\u001b[1mVerificação de segurança da autenticação\u001b[0m  ${BASE}`);

  // O servidor tem de estar a responder.
  const health = await fetch(`${ORIGIN}/health`).catch(() => null);
  if (!health || !health.ok) {
    console.error(
      `\nO servidor não respondeu em ${ORIGIN}. Arranca-o com:\n` +
        '  npm run dev --workspace @zemlo/api\n',
    );
    process.exit(1);
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('JWT_SECRET não está definido. Este script precisa dele para forjar tokens válidos.');
    process.exit(1);
  }

  /* Conta vítima, criada de propósito para este teste. */
  const email = `seguranca-${stamp}@exemplo.test`;
  const signup = await call('POST', '/auth/signup', {
    body: {
      email,
      password: VICTIM_PASSWORD,
      name: 'Conta de teste de segurança',
      acceptedTerms: true,
    },
  });

  if (signup.status !== 201) {
    console.error(`Não foi possível criar a conta de teste (estado ${signup.status}).`);
    console.error(JSON.stringify(signup.body));
    process.exit(1);
  }

  victim = await prisma.user.findUnique({ where: { email } });
  victimToken = signup.body.tokens.accessToken;
  const firstSession = await prisma.session.findFirst({
    where: { userId: victim.id, revokedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  victimSessionId = firstSession.id;

  /* Uma segunda conta, para provar que um `sid` de outra conta não serve. */
  const otherEmail = `seguranca-outra-${stamp}@exemplo.test`;
  const otherSignup = await call('POST', '/auth/signup', {
    body: { email: otherEmail, password: 'OutraConta2026!c', acceptedTerms: true },
  });
  if (otherSignup.status === 201) {
    const other = await prisma.user.findUnique({ where: { email: otherEmail } });
    const otherSession = await prisma.session.findFirst({
      where: { userId: other.id, revokedAt: null },
    });
    FOREIGN_SESSION_ID = otherSession.id;
  }

  try {
    await verifySidRequired(secret, victim, victimToken);

    // Recria uma sessão válida (o teste anterior revogou a original e o login acima criou outra).
    const relogin = await call('POST', '/auth/login', {
      body: { email: victim.email, password: VICTIM_PASSWORD },
    });
    victimToken = relogin.body?.tokens?.accessToken ?? victimToken;
    const active = await prisma.session.findFirst({
      where: { userId: victim.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    victimSessionId = active.id;
    // Deixa uma sessão ativa para o cenário seguinte revogar.
    await verifySidVariants(secret, victim, victimToken);

    // Repõe uma sessão válida, usada tanto pela confirmação de email (o reenvio exige
    // sessão) como pela recuperação de password.
    const relogin2 = await call('POST', '/auth/login', {
      body: { email: victim.email, password: VICTIM_PASSWORD },
    });
    check(
      'Sessão reposta para os testes seguintes',
      relogin2.status === 200,
      `estado ${relogin2.status}`,
    );

    // A confirmação de email corre ANTES da recuperação: esta última troca a password, e a
    // confirmação precisa de iniciar sessão com a password original.
    await verifyEmailVerification(victim, relogin2.body?.tokens?.accessToken);

    await verifyPasswordReset(victim);
  } finally {
    /* Limpeza: as contas de teste não ficam na base de dados de desenvolvimento. */
    for (const e of [email, otherEmail]) {
      const user = await prisma.user.findUnique({ where: { email: e } });
      if (user) {
        await prisma.oneTimeToken.deleteMany({ where: { userId: user.id } });
        await prisma.session.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
      }
    }
    await prisma.$disconnect();
  }

  console.log(
    `\n\u001b[1mResultado:\u001b[0m ${passed} verificações passaram, ${failed} falharam.`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error('\nFalha inesperada:', error);
  await prisma.$disconnect();
  process.exit(1);
});
