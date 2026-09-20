/**
 * Integração real: criar conta → pedir reset → receber por SMTP → trocar → entrar.
 *
 * ## Porque é que este ficheiro existe, e o que é que ele acrescenta
 *
 * `password-reset.test.ts` percorre o fluxo com um capturador em memória. Isso prova a
 * lógica, mas deixa de fora a única peça que fala com o mundo: o transporte. Entre o
 * `sendEmail` e o servidor real há um cliente SMTP — negociação, autenticação, codificação
 * do corpo, dot-stuffing — e nenhum dos testes anteriores o atravessa.
 *
 * Aqui a cadeia é completa e **sem duplos**: sobe a aplicação a sério, sobe um servidor
 * SMTP a sério numa porta efémera, regista o transporte **real** (`SmtpEmailSender`, via
 * `registerEmailSender()`), e depois lê a mensagem dos bytes que o servidor recebeu. O
 * token que o teste usa para trocar a password é o que o cliente SMTP escreveu no fio.
 *
 * O pedido era explícito: *"Não depender exclusivamente de mocks."* É este o teste que
 * responde a isso — o único da suite onde não há uma única substituição entre o `POST
 * /auth/password-reset` e o corpo que sai do processo.
 *
 * ## Como o servidor é ligado à configuração
 *
 * `config.email` lê as variáveis de ambiente **no import** de `core/config.ts`. Por isso
 * `SMTP_HOST`/`SMTP_PORT` têm de estar definidos antes de a aplicação ser importada — a
 * mesma restrição que o `DATABASE_URL` já impõe às outras suites. Definir a variável depois
 * não teria efeito, e o teste passaria a exercer o sender de consola sem o dizer.
 *
 * A porta é efémera (o servidor pede-a ao sistema), pelo que não colide com nada nem
 * precisa de uma porta fixa que alguém possa estar a usar.
 *
 * ## Sem autenticação nem TLS, deliberadamente
 *
 * O servidor de teste aceita tudo em claro. Não é uma simplificação preguiçosa: `AUTH LOGIN`
 * e o caminho TLS já estão exercidos em `smtp.test.ts` ao nível do diálogo. Aqui o que
 * interessa é o **fluxo do produto**, e misturar as duas coisas faria este teste falhar por
 * motivos de TLS em vez de falhar por motivos de recuperação de password.
 */

import { createServer, type Server, type Socket } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@zemlo/prisma-sqlite';

import { createTestDb, type TestDb } from './helpers/db.js';

/* -------------------------------------------------------------------------- */
/* Servidor SMTP que guarda o que recebeu                                      */
/* -------------------------------------------------------------------------- */

interface CorreioRecebido {
  from: string;
  to: string[];
  /** Corpo da mensagem, com os cabeçalhos que o cliente escreveu. */
  dados: string;
}

/**
 * Servidor SMTP mínimo que aceita um envio e guarda-o.
 *
 * Só o suficiente para o diálogo do cliente: cumprimenta, anuncia capacidades **sem
 * STARTTLS** (o TLS é o assunto de `smtp.test.ts`, e anunciá-lo aqui obrigaria a servir
 * certificados), aceita o remetente e o destinatário, recolhe o corpo até ao ponto isolado
 * e fecha.
 */
function criarServidorSmtp(caixa: CorreioRecebido[]): Promise<Server> {
  const server = createServer((socket: Socket) => {
    socket.setEncoding('utf8');
    socket.write('220 smtp.integracao.test ESMTP\r\n');

    let buffer = '';
    let emDados = false;
    let corpo: string[] = [];
    let from = '';
    let to: string[] = [];

    socket.on('data', (chunk: string) => {
      buffer += chunk;

      let quebra = buffer.indexOf('\r\n');
      while (quebra !== -1) {
        const linha = buffer.slice(0, quebra);
        buffer = buffer.slice(quebra + 2);

        if (emDados) {
          if (linha === '.') {
            emDados = false;
            caixa.push({ from, to: [...to], dados: corpo.join('\r\n') });
            corpo = [];
            to = [];
            socket.write('250 2.0.0 Mensagem aceite\r\n');
          } else {
            // Desfazer o `dot-stuffing` do cliente, para que o corpo guardado seja o que a
            // aplicação escreveu. Sem isto, uma linha começada por ponto apareceria com um
            // ponto a mais — e a comparação com o texto do serviço falharia por uma razão
            // que não tem a ver com o que se quer verificar.
            corpo.push(linha.startsWith('..') ? linha.slice(1) : linha);
          }
          quebra = buffer.indexOf('\r\n');
          continue;
        }

        const verbo = linha.split(' ')[0].toUpperCase();
        const resto = linha.slice(verbo.length).trim();

        if (verbo === 'EHLO') {
          // Sem `STARTTLS` anunciado: o cliente só o pede se o vir, e é isso que se quer.
          socket.write('250-smtp.integracao.test\r\n250-SIZE 10485760\r\n250 8BITMIME\r\n');
        } else if (verbo === 'MAIL') {
          from = resto.replace(/^FROM:\s*<?/i, '').replace(/>?$/, '');
          socket.write('250 2.1.0 Remetente aceite\r\n');
        } else if (verbo === 'RCPT') {
          to.push(resto.replace(/^TO:\s*<?/i, '').replace(/>?$/, ''));
          socket.write('250 2.1.5 Destinatário aceite\r\n');
        } else if (verbo === 'DATA') {
          emDados = true;
          socket.write('354 Envie o corpo; termine com <CRLF>.<CRLF>\r\n');
        } else if (verbo === 'QUIT') {
          socket.write('221 2.0.0 Adeus\r\n');
          socket.end();
        } else {
          socket.write('250 OK\r\n');
        }

        quebra = buffer.indexOf('\r\n');
      }
    });

    socket.on('error', () => {
      /* O fecho é do cliente; um erro de socket aqui não é uma falha do teste. */
    });
  });

  return new Promise<Server>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/* -------------------------------------------------------------------------- */
/* Infraestrutura do teste                                                     */
/* -------------------------------------------------------------------------- */

let db: TestDb;
let app: Express;
let appPrisma: PrismaClient;
let smtp: Server;
let caixa: CorreioRecebido[];

const INITIAL_PASSWORD = 'Password123!';
const NEW_PASSWORD = 'OutraPassword789!';
const EMAIL = 'fluxo-completo@zemlo.test';

beforeAll(async () => {
  db = await createTestDb();
  caixa = [];

  smtp = await criarServidorSmtp(caixa);
  const endereco = smtp.address();
  if (typeof endereco !== 'object' || endereco === null) {
    throw new Error('Não foi possível obter a porta do servidor SMTP de teste.');
  }

  /*
   * Tudo o que `core/config.ts` lê no import tem de estar definido **antes** do import da
   * aplicação. `SMTP_HOST` é o que faz `config.email.enabled` ser verdadeiro e
   * `registerEmailSender()` escolher o `SmtpEmailSender` real.
   */
  process.env.DATABASE_URL = db.url;
  process.env.DATABASE_PROVIDER = 'sqlite';
  process.env.NODE_ENV = 'test';
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(endereco.port);
  process.env.SMTP_FROM = 'Zemlo <ola@appzemlo.com>';

  const [{ createApp }, { prisma }] = await Promise.all([
    import('../src/app.js'),
    import('../src/core/db.js'),
  ]);

  appPrisma = prisma;

  /*
   * A escolha do transporte é feita pelo arranque da aplicação. Chamar `createApp()` não a
   * executa — quem a executa é `logStartup()`, que o `server.ts` chama. Aqui chama-se
   * `registerEmailSender()` diretamente, que é exatamente o que o arranque faz, para que a
   * aplicação fique com o transporte SMTP real em vez do fallback de consola.
   */
  const { registerEmailSender, activeEmailSender } = await import('../src/services/email.js');
  const escolhido = registerEmailSender();

  expect(
    escolhido.delivers,
    'A configuração de SMTP não foi aplicada: o teste estaria a exercer o transporte de log ' +
      'e a afirmar sobre ele. Verifica que SMTP_HOST é definido antes do import de core/config.ts.',
  ).toBe(true);
  expect(activeEmailSender().transport).toContain('SMTP');

  app = createApp();
}, 120_000);

afterAll(async () => {
  await appPrisma.$disconnect();
  await db.destroy();
  await new Promise<void>((resolve) => smtp.close(() => resolve()));
});

beforeEach(async () => {
  caixa.length = 0;
  await appPrisma.auditLog.deleteMany();
  await appPrisma.oneTimeToken.deleteMany();
  await appPrisma.session.deleteMany();
  await appPrisma.user.deleteMany();
});

/* -------------------------------------------------------------------------- */
/* O fluxo                                                                     */
/* -------------------------------------------------------------------------- */

describe('fluxo real de recuperação de password', () => {
  it('percorre criar conta → pedir → receber por SMTP → trocar → entrar', async () => {
    /* 1. Criar a conta e provar que a password inicial entra. */
    const criada = await request(app)
      .post('/api/v1/auth/signup')
      .set('Content-Type', 'application/json')
      .send({ email: EMAIL, password: INITIAL_PASSWORD, name: 'Fluxo', acceptedTerms: true });

    expect(criada.status, JSON.stringify(criada.body)).toBe(201);
    const userId = criada.body.user.id as string;
    const accessTokenAntigo = criada.body.tokens.accessToken as string;

    expect(
      (await request(app).post('/api/v1/auth/login').send({ email: EMAIL, password: INITIAL_PASSWORD })).status,
    ).toBe(200);

    /* 2. Pedir a recuperação. */
    const pedido = await request(app)
      .post('/api/v1/auth/password-reset')
      .set('Content-Type', 'application/json')
      .send({ email: EMAIL });

    expect(pedido.status).toBe(202);

    /*
     * 3. A mensagem chegou ao servidor SMTP, pelo cliente real.
     *
     * `sendEmail` espera a conclusão do envio antes de a rota responder, por isso a caixa
     * já tem a mensagem quando o `await` do pedido resolve — não é preciso esperar por um
     * evento nem sondar. Se isto deixasse de ser verdade, a asserção falharia com um erro
     * explícito em vez de um teste intermitente.
     */
    expect(caixa, 'O servidor SMTP de teste não recebeu nenhuma mensagem.').toHaveLength(1);
    const mensagem = caixa[0];

    expect(mensagem.to).toEqual([EMAIL]);
    expect(mensagem.from).toContain('ola@appzemlo.com');
    expect(mensagem.dados).toContain('Zemlo');

    /* 4. Extrair o link do corpo que atravessou o socket. */
    const encontrado = mensagem.dados.match(/\/repor-password\?token=([^\s&"'>]+)/);
    expect(
      encontrado,
      `O corpo recebido não contém um link de recuperação:\n${mensagem.dados}`,
    ).not.toBeNull();

    const token = decodeURIComponent(encontrado![1]);
    expect(token.length).toBeGreaterThanOrEqual(16);

    /*
     * 5. O corpo não pode conter a password atual. É a garantia que o email promete ao
     * utilizador ("a Zemlo nunca te pede a password por email") e o que impede uma caixa
     * de correio comprometida de se tornar uma fuga de credenciais.
     */
    expect(mensagem.dados).not.toContain(INITIAL_PASSWORD);

    /* 6. Trocar a password com o token que veio no email. */
    const confirmacao = await request(app)
      .post('/api/v1/auth/password-reset/confirm')
      .set('Content-Type', 'application/json')
      .send({ token, newPassword: NEW_PASSWORD });

    expect(confirmacao.status, JSON.stringify(confirmacao.body)).toBe(200);
    expect(confirmacao.body.revokedSessions).toBeGreaterThanOrEqual(1);

    /*
     * 8. Todas as sessões anteriores foram revogadas — verificado **antes** de voltar a
     * entrar, porque o login seguinte cria legitimamente uma sessão nova. A ordem não é
     * um detalhe: afirmar isto depois do passo 7 mediria a sessão que o próprio teste
     * acabou de abrir, e não a revogação.
     */
    expect(
      await appPrisma.session.count({ where: { userId, revokedAt: null } }),
      'A troca de password tem de revogar todas as sessões da conta.',
    ).toBe(0);

    const comTokenAntigo = await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${accessTokenAntigo}`);
    expect(comTokenAntigo.status).toBe(401);

    /* 9. A password nova entra e a antiga não. */
    expect(
      (await request(app).post('/api/v1/auth/login').send({ email: EMAIL, password: NEW_PASSWORD })).status,
      'A password nova devia funcionar.',
    ).toBe(200);

    expect(
      (await request(app).post('/api/v1/auth/login').send({ email: EMAIL, password: INITIAL_PASSWORD })).status,
      'A password antiga não pode continuar a funcionar.',
    ).toBe(401);
  });

  it('o link recebido serve uma só vez, através do transporte real', async () => {
    await request(app)
      .post('/api/v1/auth/signup')
      .set('Content-Type', 'application/json')
      .send({ email: EMAIL, password: INITIAL_PASSWORD, name: 'Fluxo', acceptedTerms: true });

    await request(app)
      .post('/api/v1/auth/password-reset')
      .set('Content-Type', 'application/json')
      .send({ email: EMAIL });

    const token = decodeURIComponent(
      caixa[0].dados.match(/\/repor-password\?token=([^\s&"'>]+)/)![1],
    );

    const primeira = await request(app)
      .post('/api/v1/auth/password-reset/confirm')
      .send({ token, newPassword: NEW_PASSWORD });
    expect(primeira.status).toBe(200);

    const segunda = await request(app)
      .post('/api/v1/auth/password-reset/confirm')
      .send({ token, newPassword: 'TerceiraPassword000!' });

    expect(segunda.status).toBe(401);
    // E a password definida na primeira tentativa continua a ser a que entra.
    expect(
      (await request(app).post('/api/v1/auth/login').send({ email: EMAIL, password: NEW_PASSWORD })).status,
    ).toBe(200);
  });

  it('não envia email nenhum para um endereço sem conta', async () => {
    await request(app)
      .post('/api/v1/auth/password-reset')
      .set('Content-Type', 'application/json')
      .send({ email: 'nao-existe-integracao@zemlo.test' });

    // Nada atravessou o socket: a resposta uniforme não é acompanhada de um envio real.
    expect(caixa).toHaveLength(0);
  });
});
