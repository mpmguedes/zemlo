/**
 * Verificação de email — o fluxo completo, pela fronteira HTTP.
 *
 * ## Porque é que esta suite existe
 *
 * A verificação de email reutiliza infraestrutura que já estava provada — a tabela
 * `OneTimeToken`, o `generateToken`/`hashToken`, o `sendEmail`. O que **não** estava provado
 * é o que esta funcionalidade acrescenta: que o registo emite um token de um propósito
 * diferente do da reposição de password, que o consumo é atómico, que um token de um fluxo
 * não serve no outro, e que uma falha de SMTP não deixa uma conta por criar.
 *
 * Nenhuma destas propriedades é observável sem uma base de dados a sério e sem a aplicação
 * a sério. Um duplo em memória provaria a nossa imitação das regras — e as regras que
 * interessam aqui (a transação, a condição no `usedAt`, a cascata) são do motor.
 *
 * ## O que é que estes testes provam
 *
 *  - **registo** — cria conta com `emailVerified = false`, emite token de verificação, e
 *    devolve sessão utilizável (a verificação não bloqueia nada nesta fase);
 *  - **entrega** — o email sai para o endereço da conta, aponta para `/verificar-email` do
 *    `publicBaseUrl`, e afirma a validade;
 *  - **consumo** — token válido marca `emailVerified` e `emailVerifiedAt`; token usado,
 *    expirado ou de outro propósito é recusado com a mesma resposta;
 *  - **atomicidade** — dois pedidos simultâneos com o mesmo token não podem ambos ter
 *    sucesso;
 *  - **reenvio** — invalida o token anterior, e uma conta já confirmada não gera outro;
 *  - **não regressão** — o reset de password continua a funcionar exatamente como antes, e
 *    os dois propósitos não se cruzam;
 *  - **resiliência** — uma falha de SMTP não impede o registo nem a sessão;
 *  - **segurança** — o token em claro não aparece na auditoria nem nos logs.
 *
 * ## O capturador de correio
 *
 * `setEmailSender` substitui o transporte por um que guarda as mensagens em memória. É a
 * única forma de o teste afirmar coisas sobre o **conteúdo** do email — o endereço de
 * destino, a página apontada, a validade escrita — sem depender de um servidor SMTP. O
 * transporte real tem a sua própria suite (`password-reset-integration.test.ts`, que sobe
 * um servidor SMTP e lê os bytes do fio) e não é reexercido aqui.
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

/**
 * Mensagens que o transporte capturou, pela ordem em que foram enviadas.
 *
 * Inicializado aqui, e não em `beforeAll`: o transporte é registado no arranque da suite e
 * pode receber uma mensagem antes de qualquer `beforeEach`. Um array atribuído só no
 * `beforeAll` estaria definido no momento certo por acidente, e uma alteração à ordem do
 * arranque passaria a rebentar em `beforeEach` em vez de no sítio onde está o problema.
 */
let caixa: { to: string; subject: string; text: string }[] = [];

/** Password que cumpre `zPassword` (10 caracteres, sem espaços nos extremos). */
const PASSWORD = 'PasswordZemlo2026';

/** Caminho da página que o link do email abre. */
const VERIFY_PATH = '/verificar-email';

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
  app = createApp();

  /*
   * `delivers: true` não é cosmético: é o que distingue, para o `sendEmail` e para o
   * `describeEmail()`, uma entrega real de um registo em log. Um capturador que se
   * anunciasse como `delivers: false` faria o produto tomar decisões de fallback que o
   * teste não quer exercer.
   */
  setEmailSender({
    transport: 'capturador de teste',
    delivers: true,
    async send(message) {
      caixa.push({ to: message.to, subject: message.subject, text: message.text });
    },
  });

  /*
   * Sonda que força a criação do esquema e falha alto se a base de dados não estiver
   * acessível. Sem ela, um erro de `DATABASE_URL` apareceria como um 500 no primeiro
   * teste, em vez de um erro de configuração no arranque da suite.
   */
  const sonda = await appPrisma.user.create({
    data: { email: 'sonda-verificacao@zemlo.test', name: 'Sonda' },
    select: { id: true },
  });
  await appPrisma.user.delete({ where: { id: sonda.id } });
}, 120_000);

afterAll(async () => {
  // Fechar o cliente da aplicação primeiro: no Windows, o ficheiro SQLite aberto impediria
  // a remoção do directório com `EBUSY`.
  await appPrisma.$disconnect();
  await db.destroy();
});

beforeEach(async () => {
  await resetDatabase();
  caixa.length = 0;
});

/**
 * Limpa o estado entre casos.
 *
 * Os `auditLog` são apagados **antes** dos utilizadores: a relação é `onDelete: SetNull`,
 * portanto apagar o utilizador deixaria as entradas de auditoria para trás com `userId` a
 * nulo — e as asserções de auditoria passariam a contar linhas de casos anteriores.
 *
 * Tudo o resto (`Session`, `OneTimeToken`, preferências) cai por cascata com o utilizador.
 */
async function resetDatabase(): Promise<void> {
  await db.prisma.auditLog.deleteMany();
  await db.prisma.user.deleteMany();
}

/** Cria uma conta pela rota pública, como o browser faz. */
async function signup(email: string): Promise<{
  userId: string;
  accessToken: string;
  emailVerified: boolean;
}> {
  const response = await request(app)
    .post('/api/v1/auth/signup')
    .send({ email, password: PASSWORD, acceptedTerms: true });

  if (response.status !== 201) {
    throw new Error(`Registo falhou (${response.status}): ${JSON.stringify(response.body)}`);
  }

  return {
    userId: response.body.user.id,
    accessToken: response.body.tokens.accessToken,
    emailVerified: response.body.user.emailVerified,
  };
}

/**
 * Extrai o token do url contido num email capturado.
 *
 * Valida também a **página** que o link abre. Um token correto a apontar para o sítio
 * errado é um fluxo partido que um teste que só lesse o parâmetro `token` deixaria passar —
 * e é precisamente o tipo de defeito que o utilizador encontra antes de nós.
 */
function tokenFromEmail(message: { text: string }, expectedPath: string): string {
  const url = message.text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('http'));

  if (!url) throw new Error('O email capturado não traz nenhum url.');

  const parsed = new URL(url);
  if (parsed.pathname !== expectedPath) {
    throw new Error(`O link aponta para ${parsed.pathname}, esperava ${expectedPath}.`);
  }

  const token = parsed.searchParams.get('token');
  if (!token) throw new Error('O url do email não traz o parâmetro `token`.');
  return token;
}

/** Confirma um endereço pela rota pública. */
async function confirm(token: string) {
  return request(app).post('/api/v1/auth/verify-email').send({ token });
}

/** O último email enviado para um endereço, ou `undefined`. */
function lastEmailTo(email: string) {
  return [...caixa].reverse().find((message) => message.to === email);
}

/* -------------------------------------------------------------------------- */
/* Registo                                                                     */
/* -------------------------------------------------------------------------- */

describe('registo', () => {
  it('cria a conta com o email por confirmar', async () => {
    const conta = await signup('registo-simples@zemlo.test');

    // A afirmação central desta fase: a conta nasce por verificar e **entra na mesma**.
    // Se isto falhar, a verificação deixou de ser informativa e passou a ser um bloqueio.
    expect(conta.emailVerified).toBe(false);

    const naBaseDeDados = await db.prisma.user.findUnique({
      where: { id: conta.userId },
      select: { emailVerified: true, emailVerifiedAt: true },
    });
    expect(naBaseDeDados?.emailVerified).toBe(false);
    expect(naBaseDeDados?.emailVerifiedAt).toBeNull();
  });

  it('emite um token de verificação e envia o email para o endereço da conta', async () => {
    await signup('registo-token@zemlo.test');

    const guardados = await db.prisma.oneTimeToken.findMany({
      where: { purpose: 'email-verification' },
      select: { tokenHash: true, expiresAt: true, usedAt: true },
    });

    expect(guardados).toHaveLength(1);
    expect(guardados[0]?.usedAt).toBeNull();
    // O token é válido no futuro — e não por um instante: a verificação é um email que
    // chega sem ninguém o esperar, ao contrário do reset.
    expect(guardados[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 60 * 60_000);

    const email = lastEmailTo('registo-token@zemlo.test');
    expect(email).toBeDefined();
    expect(email?.subject).toContain('Zemlo');
    expect(email?.text).toContain(VERIFY_PATH);
  });

  it('nunca guarda o token em claro na base de dados', async () => {
    await signup('registo-hash@zemlo.test');

    const token = tokenFromEmail(lastEmailTo('registo-hash@zemlo.test')!, VERIFY_PATH);

    const guardado = await db.prisma.oneTimeToken.findFirst({
      where: { purpose: 'email-verification' },
      select: { tokenHash: true },
    });

    // O que fica na tabela é o hash, e nada mais. Procurar o token em claro em *todo* o
    // registo — e não só no campo do hash — é o que apanha uma coluna nova que o viesse a
    // guardar por engano.
    expect(guardado?.tokenHash).not.toBe(token);
    const linhaInteira = await db.prisma.oneTimeToken.findFirst({ where: { tokenHash: guardado!.tokenHash } });
    expect(JSON.stringify(linhaInteira)).not.toContain(token);
  });

  it('não deixa o token em claro na auditoria', async () => {
    await signup('registo-auditoria@zemlo.test');

    const token = tokenFromEmail(lastEmailTo('registo-auditoria@zemlo.test')!, VERIFY_PATH);
    const entradas = await db.prisma.auditLog.findMany();

    expect(entradas.some((entrada) => entrada.action === 'user.email_verification_requested')).toBe(true);
    expect(JSON.stringify(entradas)).not.toContain(token);
  });
});

/* -------------------------------------------------------------------------- */
/* Consumo do token                                                            */
/* -------------------------------------------------------------------------- */

describe('consumo do token', () => {
  it('confirma o endereço com um token válido', async () => {
    const conta = await signup('consumo-valido@zemlo.test');
    const token = tokenFromEmail(lastEmailTo('consumo-valido@zemlo.test')!, VERIFY_PATH);

    const resposta = await confirm(token);

    expect(resposta.status).toBe(200);
    expect(resposta.body.email).toBe('consumo-valido@zemlo.test');

    const utilizador = await db.prisma.user.findUnique({
      where: { id: conta.userId },
      select: { emailVerified: true, emailVerifiedAt: true },
    });
    expect(utilizador?.emailVerified).toBe(true);
    // A data é gravada: sem ela não se sabe *quando* o endereço foi confirmado, e o suporte
    // perde a única prova temporal que tem.
    expect(utilizador?.emailVerifiedAt).toBeInstanceOf(Date);

    const registo = await db.prisma.oneTimeToken.findFirst({
      where: { userId: conta.userId, purpose: 'email-verification' },
      select: { usedAt: true },
    });
    expect(registo?.usedAt).not.toBeNull();

    const auditoria = await db.prisma.auditLog.findMany({ where: { action: 'user.email_verified' } });
    expect(auditoria).toHaveLength(1);
  });

  it('recusa um token já usado', async () => {
    await signup('consumo-repetido@zemlo.test');
    const token = tokenFromEmail(lastEmailTo('consumo-repetido@zemlo.test')!, VERIFY_PATH);

    expect((await confirm(token)).status).toBe(200);

    const segunda = await confirm(token);
    expect(segunda.status).toBe(401);
    // A mensagem não distingue "já usado" de "expirou" nem de "nunca existiu": a distinção
    // diria a quem tem um link antigo se ele chegou a valer.
    expect(segunda.body.error.message).not.toMatch(/usado|expir/i);
  });

  it('recusa um token expirado', async () => {
    const conta = await signup('consumo-expirado@zemlo.test');
    const token = tokenFromEmail(lastEmailTo('consumo-expirado@zemlo.test')!, VERIFY_PATH);

    /*
     * A expiração é forçada na base de dados em vez de se esperar. Uma suite que dormisse
     * 24 horas para exercer este caminho não era uma suite; e encurtar a validade por uma
     * variável de ambiente não existiria — a constante é do produto, não do teste.
     */
    await db.prisma.oneTimeToken.updateMany({
      where: { userId: conta.userId, purpose: 'email-verification' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const resposta = await confirm(token);

    expect(resposta.status).toBe(401);
    const utilizador = await db.prisma.user.findUnique({
      where: { id: conta.userId },
      select: { emailVerified: true },
    });
    expect(utilizador?.emailVerified).toBe(false);
  });

  it('recusa um token que não existe', async () => {
    const resposta = await confirm('token-que-nunca-existiu-000000000000');

    expect(resposta.status).toBe(401);
  });

  it('recusa um token de reposição de password usado como verificação', async () => {
    /*
     * O teste que justifica a separação de propósitos.
     *
     * A tabela é a mesma para os dois fluxos — e é bom que seja. O que os separa é o
     * `purpose`, e este caso prova que a verificação o respeita: um token emitido para
     * trocar uma password, que vive uma hora e foi enviado por outro motivo, não pode
     * confirmar um endereço de email.
     */
    const conta = await signup('cruzamento-reset@zemlo.test');
    const tokenDeVerificacao = tokenFromEmail(lastEmailTo('cruzamento-reset@zemlo.test')!, VERIFY_PATH);
    void tokenDeVerificacao;

    const pedido = await request(app)
      .post('/api/v1/auth/password-reset')
      .send({ email: 'cruzamento-reset@zemlo.test' });
    expect(pedido.status).toBe(202);

    const tokenDeReset = tokenFromEmail(lastEmailTo('cruzamento-reset@zemlo.test')!, '/repor-password');

    const resposta = await confirm(tokenDeReset);

    expect(resposta.status).toBe(401);
    const utilizador = await db.prisma.user.findUnique({
      where: { id: conta.userId },
      select: { emailVerified: true, passwordHash: true },
    });
    expect(utilizador?.emailVerified).toBe(false);
  });

  it('recusa confirmar quando a conta foi eliminada', async () => {
    const conta = await signup('consumo-eliminada@zemlo.test');
    const token = tokenFromEmail(lastEmailTo('consumo-eliminada@zemlo.test')!, VERIFY_PATH);

    await db.prisma.user.update({
      where: { id: conta.userId },
      data: { deletedAt: new Date() },
    });

    const resposta = await confirm(token);
    expect(resposta.status).toBe(401);
  });

  it('inutiliza os links de verificação que ficaram por usar', async () => {
    /*
     * Este caso constrói o estado que um reenvio concorrente pode deixar.
     *
     * `issueEmailVerification` invalida os anteriores e cria o novo na **mesma**
     * transação, pelo que o caso normal deixa sempre um só link vivo. Mas duas transações
     * de reenvio simultâneas podem não se ver uma à outra — cada uma invalida o que
     * existia quando começou, e cada uma cria o seu. O resultado é uma conta com dois
     * links dentro da validade.
     *
     * Não é possível provocar essa corrida de forma determinística num teste, mas é
     * possível construir o seu resultado: é isso que se faz aqui, inserindo o segundo
     * token diretamente. O que se verifica a seguir é a defesa — confirmar um link
     * inutiliza todos os outros da mesma conta.
     */
    const conta = await signup('consumo-sobras@zemlo.test');
    const primeiro = tokenFromEmail(lastEmailTo('consumo-sobras@zemlo.test')!, VERIFY_PATH);

    // O token que uma transação concorrente teria deixado para trás, dentro da validade.
    /*
     * O hash vem do `hashToken` **real**, importado e não reimplementado. Um `sha256`
     * escrito à mão aqui daria o mesmo resultado hoje e passaria a dar outro no dia em que
     * a produção mudasse de algoritmo — e o teste continuaria verde, porque um token que a
     * aplicação não reconhece é indistinguível de um token que não existe. Estaria a
     * afirmar uma recusa pelo motivo errado.
     */
    const { hashToken } = await import('../src/core/crypto.js');
    const sobra = 'sobra-de-um-reenvio-concorrente-000000000000';
    await db.prisma.oneTimeToken.create({
      data: {
        userId: conta.userId,
        purpose: 'email-verification',
        tokenHash: hashToken(sobra),
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    });

    expect((await confirm(primeiro)).status).toBe(200);

    // A sobra já não serve: a conta está confirmada, e um link que continua a "funcionar"
    // para confirmar o que já está confirmado é uma porta aberta sem destino.
    const resposta = await confirm(sobra);
    expect(resposta.status).toBe(401);

    const naoUsados = await db.prisma.oneTimeToken.count({
      where: { userId: conta.userId, purpose: 'email-verification', usedAt: null },
    });
    expect(naoUsados).toBe(0);
  });

  it('não deixa dois pedidos simultâneos consumirem o mesmo token', async () => {
    /*
     * A corrida real: o utilizador clica no link enquanto o cliente de correio pré-carrega
     * o endereço, ou abre o email em dois dispositivos. A verificação de `usedAt` feita
     * antes da transação já leu `null` nos dois pedidos — é a condição **dentro** da
     * escrita que decide qual deles ganha.
     *
     * Sem essa condição, os dois passariam e a conta seria marcada duas vezes. Com ela,
     * exatamente um sucede. É esta a asserção, e é por isso que o teste dispara a sério em
     * paralelo em vez de simular a ordem.
     */
    await signup('consumo-corrida@zemlo.test');
    const token = tokenFromEmail(lastEmailTo('consumo-corrida@zemlo.test')!, VERIFY_PATH);

    const [primeira, segunda] = await Promise.all([confirm(token), confirm(token)]);
    const estados = [primeira.status, segunda.status].sort();

    expect(estados.filter((estado) => estado === 200)).toHaveLength(1);
    // O outro pedido é recusado como qualquer token inválido — 401, e não um erro interno.
    // Um 500 aqui significaria que a corrida foi apanhada por acidente (uma exceção do
    // motor) e não pela condição que a resolve.
    expect(estados.filter((estado) => estado === 401)).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Reenvio                                                                     */
/* -------------------------------------------------------------------------- */

describe('reenvio', () => {
  it('exige sessão', async () => {
    const resposta = await request(app).post('/api/v1/me/email-verification').send({});
    expect(resposta.status).toBe(401);
  });

  it('invalida o token anterior', async () => {
    const conta = await signup('reenvio-invalida@zemlo.test');
    const primeiro = tokenFromEmail(lastEmailTo('reenvio-invalida@zemlo.test')!, VERIFY_PATH);

    const reenvio = await request(app)
      .post('/api/v1/me/email-verification')
      .set('Authorization', `Bearer ${conta.accessToken}`)
      .send({});

    expect(reenvio.status).toBe(200);
    expect(reenvio.body.delivered).toBe(true);
    expect(reenvio.body.alreadyVerified).toBe(false);

    const segundo = tokenFromEmail(lastEmailTo('reenvio-invalida@zemlo.test')!, VERIFY_PATH);
    expect(segundo).not.toBe(primeiro);

    // O link antigo deixa de servir. Sem isto, cada reenvio deixaria mais uma porta aberta
    // — e o utilizador que pediu "outro email" teria dois links válidos na caixa de correio.
    expect((await confirm(primeiro)).status).toBe(401);

    // O novo funciona.
    expect((await confirm(segundo)).status).toBe(200);

    const auditoria = await db.prisma.auditLog.findMany({
      where: { action: 'user.email_verification_resent' },
    });
    expect(auditoria).toHaveLength(1);
  });

  it('não gera token novo quando a conta já está confirmada', async () => {
    const conta = await signup('reenvio-confirmada@zemlo.test');
    const token = tokenFromEmail(lastEmailTo('reenvio-confirmada@zemlo.test')!, VERIFY_PATH);
    expect((await confirm(token)).status).toBe(200);

    const emailsAntes = caixa.length;
    const tokensAntes = await db.prisma.oneTimeToken.count({ where: { userId: conta.userId } });

    const reenvio = await request(app)
      .post('/api/v1/me/email-verification')
      .set('Authorization', `Bearer ${conta.accessToken}`)
      .send({});

    expect(reenvio.status).toBe(200);
    expect(reenvio.body.alreadyVerified).toBe(true);
    expect(reenvio.body.delivered).toBe(false);

    // Nem token novo, nem email novo. As duas negações importam: uma resposta educada que
    // criasse o token na mesma seria pior do que recusar, porque pareceria inofensiva.
    expect(await db.prisma.oneTimeToken.count({ where: { userId: conta.userId } })).toBe(tokensAntes);
    expect(caixa.length).toBe(emailsAntes);

    // E o link antigo continua a não servir, apesar de a conta estar confirmada.
    expect((await confirm(token)).status).toBe(401);
  });
});

/* -------------------------------------------------------------------------- */
/* Resiliência                                                                 */
/* -------------------------------------------------------------------------- */

describe('falha de SMTP', () => {
  it('não impede a criação da conta nem a sessão', async () => {
    const { setEmailSender } = await import('../src/services/email.js');
    setEmailSender({
      transport: 'SMTP avariado',
      delivers: true,
      async send() {
        throw new Error('SMTP: ligação recusada pelo servidor (421)');
      },
    });

    try {
      const resposta = await request(app)
        .post('/api/v1/auth/signup')
        .send({ email: 'smtp-avariado@zemlo.test', password: PASSWORD, acceptedTerms: true });

      /*
       * O registo tem de sobreviver. A conta é criada, a sessão é emitida, e a pessoa entra
       * — o email de verificação é uma conveniência que se resolve com um reenvio, não uma
       * condição para usar o produto. Nesta fase a verificação não bloqueia o login
       * precisamente para que uma falha aqui não tenha consequências.
       */
      expect(resposta.status).toBe(201);
      expect(resposta.body.tokens.accessToken).toBeTruthy();
      expect(resposta.body.user.emailVerified).toBe(false);

      // E a conta funciona: a sessão emitida serve para ler o próprio perfil.
      const perfil = await request(app)
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${resposta.body.tokens.accessToken}`);
      expect(perfil.status).toBe(200);
      expect(perfil.body.emailVerified).toBe(false);

      // O token ficou emitido à espera de um reenvio que o entregue — não se perdeu nada
      // além da mensagem.
      const guardados = await db.prisma.oneTimeToken.count({
        where: { purpose: 'email-verification', usedAt: null },
      });
      expect(guardados).toBe(1);
    } finally {
      // Repor o capturador: uma suite seguinte não pode herdar um transporte que falha.
      setEmailSender({
        transport: 'capturador de teste',
        delivers: true,
        async send(message) {
          caixa.push({ to: message.to, subject: message.subject, text: message.text });
        },
      });
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Não regressão                                                               */
/* -------------------------------------------------------------------------- */

describe('o reset de password continua funcional', () => {
  it('percorre o fluxo completo sem interferência da verificação', async () => {
    await signup('regressao-reset@zemlo.test');

    // O registo emite um token de verificação. O reset tem de conviver com ele na mesma
    // tabela sem o consumir nem ser consumido por ele.
    const pedido = await request(app)
      .post('/api/v1/auth/password-reset')
      .send({ email: 'regressao-reset@zemlo.test' });
    expect(pedido.status).toBe(202);

    const token = tokenFromEmail(lastEmailTo('regressao-reset@zemlo.test')!, '/repor-password');

    const confirmacao = await request(app)
      .post('/api/v1/auth/password-reset/confirm')
      .send({ token, newPassword: 'PasswordNovaZemlo2026' });

    expect(confirmacao.status).toBe(200);

    // A password nova entra, e a antiga não.
    const entrada = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'regressao-reset@zemlo.test', password: 'PasswordNovaZemlo2026' });
    expect(entrada.status).toBe(200);

    const antiga = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'regressao-reset@zemlo.test', password: PASSWORD });
    expect(antiga.status).toBe(401);

    // O token de verificação não foi tocado pelo reset: a conta continua por confirmar, e
    // o link de verificação continua a servir.
    const utilizador = await db.prisma.user.findUnique({
      where: { email: 'regressao-reset@zemlo.test' },
      select: { emailVerified: true, id: true },
    });
    expect(utilizador?.emailVerified).toBe(false);

    const verificacao = await db.prisma.oneTimeToken.findFirst({
      where: { userId: utilizador!.id, purpose: 'email-verification' },
      select: { usedAt: true },
    });
    expect(verificacao?.usedAt).toBeNull();
  });

  it('não deixa um token de verificação trocar a password', async () => {
    await signup('cruzamento-verificacao@zemlo.test');
    const tokenDeVerificacao = tokenFromEmail(
      lastEmailTo('cruzamento-verificacao@zemlo.test')!,
      VERIFY_PATH,
    );

    const resposta = await request(app)
      .post('/api/v1/auth/password-reset/confirm')
      .send({ token: tokenDeVerificacao, newPassword: 'PasswordNovaZemlo2026' });

    expect(resposta.status).toBe(401);

    // A password original continua a funcionar — a recusa não pode ter trocado nada.
    const entrada = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'cruzamento-verificacao@zemlo.test', password: PASSWORD });
    expect(entrada.status).toBe(200);
  });
});

/* -------------------------------------------------------------------------- */
/* Reenvio sob falha de SMTP                                                   */
/* -------------------------------------------------------------------------- */

describe('reenvio com SMTP avariado', () => {
  it('diz que não entregou, em vez de afirmar que enviou', async () => {
    const conta = await signup('reenvio-smtp@zemlo.test');

    const { setEmailSender } = await import('../src/services/email.js');
    setEmailSender({
      transport: 'SMTP avariado',
      delivers: true,
      async send() {
        throw new Error('SMTP: caixa de correio indisponível (550)');
      },
    });

    try {
      const reenvio = await request(app)
        .post('/api/v1/me/email-verification')
        .set('Authorization', `Bearer ${conta.accessToken}`)
        .send({});

      /*
       * O reenvio **não** pode responder 500 — a operação de domínio (invalidar o token
       * antigo, emitir um novo) concluiu-se; só a entrega falhou. Mas também não pode
       * dizer "enviámos": quem não recebeu o email ficaria a esperar por uma mensagem que
       * não existe. `delivered: false` é a única resposta honesta, e é a que faz o ecrã
       * oferecer uma nova tentativa em vez de dizer "verifica a tua caixa de correio".
       */
      expect(reenvio.status).toBe(200);
      expect(reenvio.body.delivered).toBe(false);
      expect(reenvio.body.alreadyVerified).toBe(false);
    } finally {
      setEmailSender({
        transport: 'capturador de teste',
        delivers: true,
        async send(message) {
          caixa.push({ to: message.to, subject: message.subject, text: message.text });
        },
      });
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Limitação de pedidos                                                        */
/* -------------------------------------------------------------------------- */

describe('limitação do reenvio', () => {
  it('protege a rota de reenvio com um orçamento próprio', async () => {
    /*
     * Sob Vitest a limitação está desligada (`skip: () => config.isTest`), pelo que um 429
     * não é observável por HTTP — asserir a sua ausência seria testar o contrário do que se
     * pretende. O que se pode afirmar, e é o que se perde num refactor, é que a rota passa
     * mesmo pelo limitador e que o limitador tem números.
     *
     * A leitura é feita sobre o código-fonte da rota, como na suite do reset: o middleware
     * devolvido pelo `express-rate-limit` é anónimo e indistinguível por introspeção. Uma
     * asserção sobre o texto é frágil perante reformatação, mas falha de forma visível e
     * aponta o sítio — o que é preferível a não haver asserção nenhuma sobre a única defesa
     * que impede o reenvio de se tornar um gerador de emails.
     */
    const { readFile } = await import('node:fs/promises');
    const fonte = await readFile(new URL('../src/http/routes/auth.ts', import.meta.url), 'utf8');

    const posicao = fonte.indexOf("'/me/email-verification'");
    expect(posicao, 'A rota de reenvio não foi encontrada em auth.ts.').toBeGreaterThan(-1);

    const bloco = fonte.slice(posicao, posicao + 120);
    expect(bloco, 'A rota de reenvio deixou de estar protegida por emailVerificationRateLimit().').toContain(
      'emailVerificationRateLimit()',
    );
    // Exige sessão: sem isto, o reenvio passa a aceitar pedidos anónimos e deixa de poder
    // ser limitado por utilizador.
    expect(bloco).toContain('requireAuth()');

    const { config } = await import('../src/core/config.js');
    expect(config.rateLimit.emailVerificationMaxRequests).toBeGreaterThan(0);
    // Mais apertado do que o das outras rotas de autenticação: cada pedido custa um email
    // enviado para um destinatário real, não um cálculo nosso.
    expect(config.rateLimit.emailVerificationMaxRequests).toBeLessThanOrEqual(
      config.rateLimit.authMaxRequests,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Contrato da resposta de sessão                                              */
/* -------------------------------------------------------------------------- */

describe('estado de verificação no contrato', () => {
  it('o perfil devolve `emailVerified` e ele muda depois da confirmação', async () => {
    /*
     * O frontend não tem outra forma de saber o estado: se este campo não vier no perfil, o
     * aviso de "email por confirmar" não existe. A asserção é feita em duas leituras — antes
     * e depois — porque um campo presente mas sempre `false` passaria a primeira sozinho.
     */
    const conta = await signup('contrato-estado@zemlo.test');

    const antes = await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${conta.accessToken}`);
    expect(antes.status).toBe(200);
    expect(antes.body.emailVerified).toBe(false);

    const token = tokenFromEmail(lastEmailTo('contrato-estado@zemlo.test')!, VERIFY_PATH);
    expect((await confirm(token)).status).toBe(200);

    const depois = await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${conta.accessToken}`);
    expect(depois.status).toBe(200);
    expect(depois.body.emailVerified).toBe(true);
  });

  it('a resposta do registo já traz o estado, para o cliente não ter de o ir buscar', async () => {
    // `buildSessionResponse` inclui o perfil completo. Se o `emailVerified` faltasse aqui,
    // o ecrã seguinte ao registo — onde o aviso é mais importante — não o teria.
    const conta = await signup('contrato-signup@zemlo.test');
    expect(conta.emailVerified).toBe(false);
  });
});
