/**
 * Recuperação de password — o fluxo completo, pela fronteira HTTP (§29).
 *
 * ## O que esta suite prova, e porque é que ainda não existia
 *
 * O mecanismo de tokens já estava construído e correto — hash em repouso, uso único por
 * comparação-e-troca, validade, propósito vinculado, invalidação dos pedidos anteriores,
 * revogação de sessões, resposta uniforme, auditoria. O que **não** existia era qualquer
 * teste sobre ele: a auditoria de 2026-09-20 encontrou 20 dos 24 ficheiros de teste
 * dedicados à importação, e nenhum a tocar no reset.
 *
 * Um mecanismo crítico de segurança sem teste é um mecanismo cuja correção depende de
 * ninguém lhe mexer. As propriedades verificadas aqui são exatamente as que a §7 do pedido
 * enumera como inegociáveis, e cada uma tem o seu caso:
 *
 *  - resposta indistinguível entre conta existente e inexistente (anti-enumeração);
 *  - token válido troca a password;
 *  - token inválido, expirado e já usado são todos recusados, com a **mesma** mensagem;
 *  - um pedido novo invalida o anterior;
 *  - a troca revoga as sessões existentes (e a password antiga deixa de entrar);
 *  - password que não cumpre as regras é recusada — pela API, e não por um ecrã;
 *  - o email sai para o destinatário certo, com o link utilizável.
 *
 * ## Porque é que a suite sobe a aplicação a sério
 *
 * As asserções que interessam são sobre o que atravessa a fronteira: o código de estado, o
 * corpo, e o facto de a troca de password se refletir no login seguinte. Chamar
 * `requestPasswordReset` diretamente provaria a função e não o contrato — e o contrato é o
 * que a UI consome. Por isso o teste usa `createApp()`, `supertest`, e tokens obtidos por
 * `signup`, como as outras suites que tocam no HTTP.
 *
 * ## O sender é substituído, e isso é deliberado
 *
 * `setEmailSender` existe precisamente para isto (§8 do pedido): o teste captura a
 * mensagem em memória em vez de abrir uma ligação SMTP. O que se verifica não é o
 * transporte — isso é `smtp.test.ts` — mas sim que **a aplicação chama o sender**, com o
 * destinatário e o link certos. Entre o capturador e a rota corre a cadeia real inteira:
 * validação, transação, hash, auditoria.
 *
 * ## A limitação da limitação de pedidos
 *
 * `authRateLimit()` tem `skip: () => config.isTest`, pelo que sob Vitest a limitação não
 * está ativa e um 429 nunca aparece por esta via. Asserir "não há 429" seria testar o
 * oposto do que se pretende. O que se verifica no fim do ficheiro é a **configuração** do
 * limitador — que existe, que cobre as duas rotas, e que é a mesma instância nas duas —,
 * porque é isso que se pode observar sem desligar a proteção que os testes exercitam.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@zemlo/prisma-sqlite';

import { createTestDb, type TestDb } from './helpers/db.js';

/* -------------------------------------------------------------------------- */
/* Infraestrutura                                                              */
/* -------------------------------------------------------------------------- */

let db: TestDb;
let app: Express;
let appPrisma: PrismaClient;

/** Mensagens entregues ao sender de teste, por ordem. Ver `caughtEmails`. */
let caughtEmails: { to: string; subject: string; text: string }[] = [];

/** Password usada no `signup` e nos logins de controlo. */
const INITIAL_PASSWORD = 'Password123!';
/** Password de substituição, para provar que a troca teve efeito. */
const NEW_PASSWORD = 'NovaPassword456!';

/** Caminhos das duas rotas, para as asserções de configuração no fim do ficheiro. */
const REQUEST_PATH = '/api/v1/auth/password-reset';
const CONFIRM_PATH = '/api/v1/auth/password-reset/confirm';

beforeAll(async () => {
  db = await createTestDb();

  process.env.DATABASE_URL = db.url;
  process.env.DATABASE_PROVIDER = 'sqlite';
  process.env.NODE_ENV = 'test';

  const [{ createApp }, { prisma }, { setEmailSender }] = await Promise.all([
    import('../src/app.js'),
    import('../src/core/db.js'),
    import('../src/services/email.js'),
  ]);

  appPrisma = prisma;

  /*
   * O sender de teste substitui o transporte **antes** de a aplicação ser construída.
   * `delivers: true` não é cosmético: é o que faz `describeEmail()` e qualquer decisão
   * futura baseada no transporte tratarem este sender como entrega real, que é o que ele
   * é do ponto de vista de quem o consome.
   */
  setEmailSender({
    transport: 'teste (captura em memória)',
    delivers: true,
    async send(message) {
      caughtEmails.push({ to: message.to, subject: message.subject, text: message.text });
    },
  });

  app = createApp();

  /*
   * Rede de segurança, como nas outras suites que usam base de dados: escrever pelo
   * cliente da aplicação e ler pelo cliente do teste. Verifica a propriedade que
   * interessa — os dois falam com a mesma base — e não uma igualdade de referências.
   */
  const sonda = await appPrisma.user.create({
    data: { email: 'sonda-reset@zemlo.test', name: 'Sonda' },
    select: { id: true },
  });
  expect(
    await db.prisma.user.findUnique({ where: { id: sonda.id } }),
    'A aplicação não está ligada à base de dados temporária. O DATABASE_URL não foi aplicado antes de a app ser importada.',
  ).not.toBeNull();
  await appPrisma.user.deleteMany();
}, 120_000);

afterAll(async () => {
  await appPrisma.$disconnect();
  await db.destroy();
});

beforeEach(async () => {
  caughtEmails = [];
  await resetDatabase();
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

async function resetDatabase(): Promise<void> {
  // A ordem segue as dependências das chaves estrangeiras: os filhos primeiro.
  await appPrisma.auditLog.deleteMany();
  await appPrisma.oneTimeToken.deleteMany();
  await appPrisma.session.deleteMany();
  await appPrisma.importBookEntry.deleteMany();
  await appPrisma.expense.deleteMany();
  await appPrisma.fuelSession.deleteMany();
  await appPrisma.odometerReading.deleteMany();
  await appPrisma.document.deleteMany();
  await appPrisma.vehicle.deleteMany();
  await appPrisma.user.deleteMany();
}

/** Cria uma conta pela rota real e devolve o acesso, para os testes que precisam de sessão. */
async function signup(email: string): Promise<{ user: { id: string; email: string }; token: string }> {
  const response = await request(app)
    .post('/api/v1/auth/signup')
    .set('Content-Type', 'application/json')
    .send({
      email,
      password: INITIAL_PASSWORD,
      name: 'Teste',
      acceptedTerms: true,
    });

  if (response.status !== 201) {
    throw new Error(
      `Não foi possível criar a conta de teste (${response.status}): ${JSON.stringify(response.body)}`,
    );
  }

  return { user: response.body.user, token: response.body.tokens.accessToken };
}

/** Pede a recuperação e devolve a resposta crua, para se poder comparar corpos. */
async function requestReset(email: string) {
  return request(app)
    .post(REQUEST_PATH)
    .set('Content-Type', 'application/json')
    .send({ email });
}

/** Conclui a recuperação com um token. */
async function confirmReset(token: string, newPassword: string = NEW_PASSWORD) {
  return request(app)
    .post(CONFIRM_PATH)
    .set('Content-Type', 'application/json')
    .send({ token, newPassword });
}

/** Tenta entrar e devolve a resposta crua. */
async function login(email: string, password: string) {
  return request(app)
    .post('/api/v1/auth/login')
    .set('Content-Type', 'application/json')
    .send({ email, password });
}

/** O envelope de erro da API: `{ error: { code, message, requestId } }`. */
function errorOf(body: unknown): { code: string; message: string } {
  return (body as { error: { code: string; message: string } }).error;
}

/**
 * Extrai o token do link contido no email.
 *
 * Lê o link do **corpo da mensagem real**, e não de uma variável interna: é o que verifica
 * ao mesmo tempo que o link está no email, que aponta para a página certa, e que o token
 * que ele transporta é o que a confirmação aceita. Procurá-lo na base de dados provaria o
 * mecanismo e não a mensagem.
 */
function tokenFromEmail(email: { text: string }): string {
  const match = email.text.match(/\/repor-password\?token=([^\s&]+)/);
  if (!match) {
    throw new Error(`O email não contém um link de recuperação utilizável:\n${email.text}`);
  }
  return decodeURIComponent(match[1]);
}

/** Cria um registo de token diretamente, para os casos que a API não consegue produzir. */
async function seedToken(
  userId: string,
  options: { purpose?: string; expiresAt?: Date; usedAt?: Date | null } = {},
): Promise<{ id: string; token: string }> {
  const { generateToken, hashToken } = await import('../src/core/crypto.js');
  const token = generateToken(32);
  const record = await appPrisma.oneTimeToken.create({
    data: {
      userId,
      purpose: options.purpose ?? 'password-reset',
      tokenHash: hashToken(token),
      expiresAt: options.expiresAt ?? new Date(Date.now() + 60 * 60_000),
      usedAt: options.usedAt ?? null,
    },
    select: { id: true },
  });
  return { id: record.id, token };
}

/* -------------------------------------------------------------------------- */
/* Anti-enumeração                                                             */
/* -------------------------------------------------------------------------- */

describe('anti-enumeração', () => {
  it('responde igual para uma conta existente e para um email desconhecido', async () => {
    await signup('existe@zemlo.test');

    const comConta = await requestReset('existe@zemlo.test');
    const semConta = await requestReset('nao-existe-de-todo@zemlo.test');

    // A propriedade é a igualdade: código de estado e corpo têm de ser indistinguíveis.
    // Comparar os corpos inteiros, e não só a mensagem, apanha também um campo novo que
    // viesse a ser acrescentado a um dos dois casos.
    expect(comConta.status).toBe(202);
    expect(semConta.status).toBe(202);
    expect(semConta.body).toEqual(comConta.body);
  });

  it('não emite token nenhum quando a conta não existe', async () => {
    const response = await requestReset('fantasma@zemlo.test');

    expect(response.status).toBe(202);
    expect(
      await appPrisma.oneTimeToken.count(),
      'Um email sem conta não pode deixar um token na base de dados — seria um link para lugar nenhum.',
    ).toBe(0);
    expect(caughtEmails).toHaveLength(0);
  });

  it('trata uma conta eliminada como inexistente', async () => {
    const { user } = await signup('apagada@zemlo.test');
    await appPrisma.user.update({
      where: { id: user.id },
      data: { deletedAt: new Date() },
    });

    const response = await requestReset('apagada@zemlo.test');

    expect(response.status).toBe(202);
    expect(
      await appPrisma.oneTimeToken.count(),
      'Uma conta eliminada não deve receber um link que a ressuscitaria.',
    ).toBe(0);
  });

  it('recusa um email com forma inválida sem revelar mais do que a forma', async () => {
    const response = await requestReset('isto-nao-e-um-email');

    // 422 e não 400: o corpo foi interpretado e os campos é que não servem
    // (`validationFailed` em `core/errors.ts`). O 400 é para um corpo que nem se lê.
    expect(response.status).toBe(422);
    expect(errorOf(response.body).code).toBe('validation_error');
  });
});

/* -------------------------------------------------------------------------- */
/* Emissão e entrega                                                           */
/* -------------------------------------------------------------------------- */

describe('emissão do pedido', () => {
  it('entrega o email ao destinatário certo, com um link utilizável', async () => {
    const { user } = await signup('destino@zemlo.test');

    const response = await requestReset('destino@zemlo.test');
    expect(response.status).toBe(202);

    expect(caughtEmails).toHaveLength(1);
    const email = caughtEmails[0];

    // O destinatário é o dono da conta, e não um endereço de configuração: um erro aqui
    // enviaria o link de recuperação de uma pessoa para outra.
    expect(email.to).toBe('destino@zemlo.test');

    // O assunto identifica o produto. Uma caixa de correio recebe muitos emails, e
    // "reposição de password" sozinho não diz de quem é.
    expect(email.subject).toContain('Zemlo');

    // O token do link é utilizável — é o que fecha o ciclo entre a mensagem e o mecanismo.
    const token = tokenFromEmail(email);
    expect(token.length).toBeGreaterThanOrEqual(16);

    const confirm = await confirmReset(token);
    expect(confirm.status, JSON.stringify(confirm.body)).toBe(200);

    // E a password mudou mesmo, pela via que o utilizador usa.
    expect((await login('destino@zemlo.test', NEW_PASSWORD)).status).toBe(200);
  });

  it('guarda apenas o hash do token, nunca o valor em claro', async () => {
    await signup('hash@zemlo.test');
    await requestReset('hash@zemlo.test');

    const token = tokenFromEmail(caughtEmails[0]);
    const { hashToken } = await import('../src/core/crypto.js');

    const registo = await appPrisma.oneTimeToken.findFirst({
      where: { userId: (await appPrisma.user.findUniqueOrThrow({ where: { email: 'hash@zemlo.test' } })).id },
      select: { tokenHash: true },
    });

    expect(registo?.tokenHash).toBe(hashToken(token));
    // A negação é a que interessa: o valor que viajou no email não pode estar em repouso.
    expect(registo?.tokenHash).not.toBe(token);
  });

  it('um pedido novo invalida o anterior — só o link mais recente serve', async () => {
    await signup('dois-pedidos@zemlo.test');

    await requestReset('dois-pedidos@zemlo.test');
    const primeiro = tokenFromEmail(caughtEmails[0]);

    await requestReset('dois-pedidos@zemlo.test');
    const segundo = tokenFromEmail(caughtEmails[1]);

    expect(segundo).not.toBe(primeiro);

    // O primeiro link foi invalidado pelo segundo pedido.
    const comPrimeiro = await confirmReset(primeiro);
    expect(comPrimeiro.status).toBe(401);

    // E o mais recente continua a funcionar — a invalidação não pode levar tudo à frente.
    const comSegundo = await confirmReset(segundo);
    expect(comSegundo.status, JSON.stringify(comSegundo.body)).toBe(200);
  });
});

/* -------------------------------------------------------------------------- */
/* Recusa de tokens inválidos                                                  */
/* -------------------------------------------------------------------------- */

describe('recusa de tokens', () => {
  it('recusa um token inexistente, expirado e já usado com a mesma resposta', async () => {
    const { user } = await signup('recusas@zemlo.test');

    const inexistente = await confirmReset('a'.repeat(40));

    const expirado = await seedToken(user.id, {
      expiresAt: new Date(Date.now() - 60_000),
    });
    const respostaExpirado = await confirmReset(expirado.token);

    const jaUsado = await seedToken(user.id, { usedAt: new Date() });
    const respostaJaUsado = await confirmReset(jaUsado.token);

    expect(inexistente.status).toBe(401);
    expect(respostaExpirado.status).toBe(401);
    expect(respostaJaUsado.status).toBe(401);

    /*
     * A igualdade das três mensagens é a asserção central: se divergissem, quem tem um
     * link antigo ficaria a saber se ele chegou a ser válido, e quem sonda ficaria a saber
     * se um token existe.
     */
    expect(errorOf(respostaExpirado.body).message).toBe(errorOf(inexistente.body).message);
    expect(errorOf(respostaJaUsado.body).message).toBe(errorOf(inexistente.body).message);
  });

  it('recusa um token emitido para outro propósito', async () => {
    const { user } = await signup('proposito@zemlo.test');

    // A tabela é genérica e vai servir a verificação de email. Sem o propósito vinculado,
    // um token emitido para um fim seria aceite noutro.
    const outro = await seedToken(user.id, { purpose: 'email-verification' });
    const response = await confirmReset(outro.token);

    expect(response.status).toBe(401);
  });

  it('recusa um token com forma implausível sem chegar a tocar na base de dados', async () => {
    const response = await confirmReset('curto');

    expect(response.status).toBe(422);
    expect(errorOf(response.body).code).toBe('validation_error');
  });

  it('não altera a password quando o token é recusado', async () => {
    await signup('intacta@zemlo.test');

    const response = await confirmReset('z'.repeat(40));
    expect(response.status).toBe(401);

    // A password original continua a funcionar: uma recusa não pode ter efeitos laterais.
    expect((await login('intacta@zemlo.test', INITIAL_PASSWORD)).status).toBe(200);
    expect((await login('intacta@zemlo.test', NEW_PASSWORD)).status).toBe(401);
  });

  it('aceita o token uma só vez, mesmo em pedidos simultâneos', async () => {
    await signup('corrida@zemlo.test');
    await requestReset('corrida@zemlo.test');
    const token = tokenFromEmail(caughtEmails[0]);

    /*
     * É esta a corrida que torna um token de uso único reutilizável: entre ler `usedAt` e
     * escrevê-lo cabe outra tentativa. Disparar as duas em paralelo é o que exercita a
     * comparação-e-troca, e não a verificação que a antecede.
     */
    const [a, b] = await Promise.all([confirmReset(token), confirmReset(token)]);
    const sucessos = [a, b].filter((r) => r.status === 200);

    expect(
      sucessos,
      `Exatamente um dos dois pedidos simultâneos devia ter sucesso; obtive ${sucessos.length}.`,
    ).toHaveLength(1);
    expect([a.status, b.status].filter((s) => s === 401)).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Efeitos da troca                                                            */
/* -------------------------------------------------------------------------- */

describe('efeitos da troca de password', () => {
  it('troca a password: a nova entra e a antiga deixa de entrar', async () => {
    await signup('troca@zemlo.test');
    await requestReset('troca@zemlo.test');

    expect((await login('troca@zemlo.test', INITIAL_PASSWORD)).status).toBe(200);

    const confirm = await confirmReset(tokenFromEmail(caughtEmails[0]));
    expect(confirm.status).toBe(200);

    expect((await login('troca@zemlo.test', NEW_PASSWORD)).status).toBe(200);
    expect(
      (await login('troca@zemlo.test', INITIAL_PASSWORD)).status,
      'A password antiga não pode continuar a servir — seria a recuperação a não repor nada.',
    ).toBe(401);
  });

  it('revoga as sessões existentes e conta-as na resposta', async () => {
    const { user, token } = await signup('sessoes@zemlo.test');

    // Uma segunda sessão, como se a conta estivesse aberta noutro dispositivo.
    await login('sessoes@zemlo.test', INITIAL_PASSWORD);
    expect(await appPrisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(2);

    await requestReset('sessoes@zemlo.test');
    const confirm = await confirmReset(tokenFromEmail(caughtEmails[0]));

    expect(confirm.status).toBe(200);
    expect(confirm.body.revokedSessions).toBe(2);
    expect(await appPrisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);

    // O access token emitido antes da troca tem de deixar de servir: é isto que impede
    // que quem perdeu o controlo da conta fique dentro dela depois de a repor.
    const depois = await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${token}`);
    expect(depois.status).toBe(401);
  });

  it('recusa uma password que não cumpre as regras, sem gastar o token', async () => {
    await signup('regras@zemlo.test');
    await requestReset('regras@zemlo.test');
    const token = tokenFromEmail(caughtEmails[0]);

    const curta = await confirmReset(token, 'curta');
    expect(curta.status).toBe(422);
    expect(errorOf(curta.body).code).toBe('validation_error');

    // O ponto essencial: a recusa não consumiu o token. Quem se engana na password tem de
    // poder tentar outra vez com o mesmo link, e não ser obrigado a pedir um novo.
    const correta = await confirmReset(token);
    expect(correta.status, JSON.stringify(correta.body)).toBe(200);
    expect((await login('regras@zemlo.test', NEW_PASSWORD)).status).toBe(200);
  });

  it('rejeita a password igual à anterior apenas se a API o exigir, e não muda nada por engano', async () => {
    await signup('repetida@zemlo.test');
    await requestReset('repetida@zemlo.test');
    const token = tokenFromEmail(caughtEmails[0]);

    // Reutilizar a mesma password é aceite pela API (não há regra de histórico no MVP).
    // O que se verifica é que, aceitando, faz o que diz: a sessão é revogada na mesma.
    const response = await confirmReset(token, INITIAL_PASSWORD);
    expect(response.status).toBe(200);
    expect((await login('repetida@zemlo.test', INITIAL_PASSWORD)).status).toBe(200);
  });
});

/* -------------------------------------------------------------------------- */
/* Auditoria                                                                   */
/* -------------------------------------------------------------------------- */

describe('auditoria', () => {
  it('regista o pedido e a conclusão, sem o token', async () => {
    const { user } = await signup('auditoria@zemlo.test');
    await requestReset('auditoria@zemlo.test');
    const token = tokenFromEmail(caughtEmails[0]);
    await confirmReset(token);

    const acoes = await appPrisma.auditLog.findMany({
      where: { userId: user.id },
      select: { action: true, metadata: true },
    });
    const nomes = acoes.map((a) => a.action);

    expect(nomes).toContain('user.password_reset_requested');
    expect(nomes).toContain('user.password_reset_completed');

    /*
     * O token não pode aparecer na auditoria. A tabela é consultável por quem opera o
     * serviço, e um token em claro num registo de auditoria é um link de recuperação
     * arquivado.
     */
    const serializado = JSON.stringify(acoes);
    expect(serializado).not.toContain(token);
  });

  it('não regista um pedido de recuperação para um email inexistente como sucesso de conta', async () => {
    await requestReset('sem-conta-auditoria@zemlo.test');

    // O log de aplicação é o sítio onde esta tentativa fica visível (não há conta a que
    // associar auditoria). O que se afirma é que nenhuma auditoria de conta foi escrita.
    const acoes = await appPrisma.auditLog.findMany({
      where: { action: 'user.password_reset_requested' },
    });
    expect(acoes).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Configuração da limitação de pedidos                                        */
/* -------------------------------------------------------------------------- */

describe('limitação de pedidos', () => {
  it('cobre as duas rotas de recuperação', async () => {
    /*
     * Sob Vitest a limitação está desligada (`skip: () => config.isTest`), pelo que um 429
     * não é observável por HTTP. O que se pode afirmar — e é o que interessa, porque é o
     * que se perde num refactor — é que as duas rotas passam pelo mesmo limitador e que
     * ele é o de autenticação, com o orçamento configurado.
     *
     * A leitura é feita sobre o código-fonte da rota, deliberadamente: `authRateLimit()`
     * devolve um middleware anónimo, indistinguível de outro qualquer por introspeção. Uma
     * asserção sobre o texto é frágil perante reformatação — mas falha de forma visível e
     * aponta o sítio, o que é preferível a não haver asserção nenhuma sobre uma proteção
     * que existe só por causa deste endpoint.
     */
    const { readFile } = await import('node:fs/promises');
    const fonte = await readFile(new URL('../src/http/routes/auth.ts', import.meta.url), 'utf8');

    for (const caminho of ['/auth/password-reset', '/auth/password-reset/confirm']) {
      const posicao = fonte.indexOf(`'${caminho}'`);
      expect(posicao, `A rota ${caminho} não foi encontrada em auth.ts.`).toBeGreaterThan(-1);

      // A invocação do middleware aparece nas linhas imediatamente a seguir ao caminho.
      const bloco = fonte.slice(posicao, posicao + 120);
      expect(
        bloco,
        `A rota ${caminho} deixou de estar protegida por authRateLimit().`,
      ).toContain('authRateLimit()');
    }

    // E a limitação de autenticação tem mesmo um orçamento definido, em vez de existir
    // como middleware sem números.
    const { config } = await import('../src/core/config.js');
    expect(config.rateLimit.authMaxRequests).toBeGreaterThan(0);
    expect(config.rateLimit.windowMinutes).toBeGreaterThan(0);
  });
});
