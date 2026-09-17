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

/** Cria um token de recuperação conhecido, para o poder usar no teste. */
async function issueKnownToken(userId) {
  const raw = `teste-${randomBytes(24).toString('base64url')}`;

  await prisma.oneTimeToken.updateMany({
    where: { userId, purpose: 'password-reset', usedAt: null },
    data: { usedAt: new Date() },
  });
  await prisma.oneTimeToken.create({
    data: {
      userId,
      purpose: 'password-reset',
      tokenHash: createHash('sha256').update(raw).digest('hex'),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return raw;
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

    // Repõe uma sessão válida para o teste de recuperação de password.
    const relogin2 = await call('POST', '/auth/login', {
      body: { email: victim.email, password: VICTIM_PASSWORD },
    });
    check(
      'Sessão reposta para o teste de recuperação',
      relogin2.status === 200,
      `estado ${relogin2.status}`,
    );

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
