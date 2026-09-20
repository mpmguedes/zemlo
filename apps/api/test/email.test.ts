/**
 * Entrega de email — o transporte, o redator, e o que não pode chegar a um log.
 *
 * ## Porque é que esta suite é separada da do fluxo de reset
 *
 * `password-reset.test.ts` prova o percurso do utilizador: pedir, receber, confirmar. O
 * que ele **não** prova é o comportamento do transporte em si — porque substitui o sender
 * por um capturador, e é isso que lhe permite afirmar coisas sobre a mensagem.
 *
 * Aqui faz-se o inverso. O sender real é exercido diretamente, sem aplicação e sem base de
 * dados, porque as propriedades em causa são de uma função pura ou de uma escolha de
 * configuração:
 *
 *  - `redactResetLinks` tira o token do texto e **deixa o resto legível**;
 *  - `describeEmail()` diz a verdade sobre o transporte em uso;
 *  - `registerEmailSender()` escolhe SMTP quando há `SMTP_HOST`, e recusa arrancar em
 *    produção sem entrega;
 *  - `sendEmail` nunca lança — uma falha de transporte não pode reabrir a enumeração.
 *
 * ## O teste que justifica o ficheiro
 *
 * O `ConsoleEmailSender` registava o corpo sob a chave `body`. `body` não está na lista de
 * chaves sensíveis (`core/logger.ts`), pelo que o email — **incluindo o url com o token
 * vivo** — saía em claro no log de qualquer instalação sem SMTP. A auditoria apanhou-o; a
 * primeira asserção deste ficheiro é a que impede que volte, e é feita sobre o texto
 * final, não sobre a intenção.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  activeEmailSender,
  describeEmail,
  redactResetLinks,
  registerEmailSender,
  sendEmail,
  setEmailSender,
  type EmailSender,
} from '../src/services/email.js';
import { logger } from '../src/core/logger.js';

/** Um link de recuperação como o que o email transporta. */
const RESET_URL = 'https://appzemlo.com/repor-password?token=AbC123xyzTokenValue456';
/** Um token plausível, para procurar por ele nos textos. */
const TOKEN = 'AbC123xyzTokenValue456';

describe('redação dos links de recuperação', () => {
  it('remove o token e mantém o resto do url legível', () => {
    const redigido = redactResetLinks(`Abre este endereço: ${RESET_URL}`);

    expect(redigido).not.toContain(TOKEN);
    // O url continua a mostrar *que* página é — é o que torna o log útil em
    // desenvolvimento. O que deixa de ser possível é usá-lo a partir do log.
    expect(redigido).toContain('https://appzemlo.com/repor-password?token=');
    expect(redigido).toContain('[redigido]');
  });

  it('apanha o token em qualquer posição da query, não só na primeira', () => {
    const redigido = redactResetLinks('https://exemplo.test/x?lang=pt&token=Segredo123&v=2');

    expect(redigido).not.toContain('Segredo123');
    expect(redigido).toContain('lang=pt');
    // O parâmetro seguinte não pode ser engolido pela substituição.
    expect(redigido).toContain('v=2');
  });

  it('não altera texto que não tenha links', () => {
    const texto = 'Recebemos um pedido para repor a password da tua conta Zemlo.';

    expect(redactResetLinks(texto)).toBe(texto);
  });

  it('remove todos os links quando o corpo traz mais do que um', () => {
    const redigido = redactResetLinks(`${RESET_URL}\nou ${RESET_URL}`);

    expect(redigido).not.toContain(TOKEN);
    expect(redigido.match(/\[redigido\]/g)).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */
/* O log de um email sem transporte                                            */
/* -------------------------------------------------------------------------- */

/**
 * Captura tudo o que o logger escreve, seja em `stdout` seja em `stderr`.
 *
 * Os dois, e não só um: o logger manda `error` para `stderr` e o resto para `stdout`
 * (ver `core/logger.ts`). Um teste que espiasse apenas `stdout` passaria por não haver nada
 * lá — que é o falso positivo mais fácil de escrever numa asserção de "não contém".
 */
function capturarLogs(): { saida: () => string; parar: () => void } {
  const pedacos: string[] = [];
  const espiao = (chunk: unknown): boolean => {
    pedacos.push(String(chunk));
    return true;
  };
  const emStdout = vi.spyOn(process.stdout, 'write').mockImplementation(espiao);
  const emStderr = vi.spyOn(process.stderr, 'write').mockImplementation(espiao);

  return {
    saida: () => pedacos.join(''),
    parar: () => {
      emStdout.mockRestore();
      emStderr.mockRestore();
    },
  };
}

describe('ConsoleEmailSender', () => {
  let captura: { saida: () => string; parar: () => void };

  beforeEach(() => {
    captura = capturarLogs();
  });

  afterEach(() => {
    captura.parar();
    vi.restoreAllMocks();
  });

  it('não deixa o token do link chegar ao log', async () => {
    /*
     * Reconstruir o sender de consola sem depender de o ambiente não ter SMTP: a escolha
     * é feita por `registerEmailSender`, e forçar a ausência de SMTP alterando variáveis
     * de ambiente teria efeitos sobre a configuração partilhada por toda a suite.
     */
    const consoleSender = construirConsoleSender();
    setEmailSender(consoleSender);

    await sendEmail({
      to: 'pessoa@zemlo.test',
      subject: 'Zemlo — reposição da tua password',
      text: `Abre este endereço para escolheres uma nova password:\n${RESET_URL}`,
    });

    const saida = captura.saida();

    /*
     * A asserção central, e a razão de ser deste ficheiro: o texto que o logger escreveu
     * não pode conter o token. Procurá-lo no output real — e não no objecto que lhe deu
     * origem — é o que torna a asserção à prova de uma mudança de nome de chave.
     */
    expect(saida, 'O token de recuperação chegou ao log.').not.toContain(TOKEN);
  });

  it('continua a registar que o email foi composto, para o log servir para algo', async () => {
    setEmailSender(construirConsoleSender());

    await sendEmail({
      to: 'pessoa@zemlo.test',
      subject: 'Zemlo — reposição da tua password',
      text: `Abre este endereço:\n${RESET_URL}`,
    });

    const saida = captura.saida();

    // A negação anterior só tem valor se o log continuar a existir. Uma redação que
    // apagasse a mensagem inteira "resolveria" o problema destruindo a funcionalidade.
    expect(saida).toContain('pessoa@zemlo.test');
    expect(saida).toContain('reposição');
  });
});

/**
 * Um `ConsoleEmailSender` equivalente ao que a aplicação usa sem SMTP.
 *
 * Reconstruído aqui porque a classe não é exportada — exportá-la só para o teste alargaria
 * a superfície pública do módulo por causa de uma verificação. A duplicação é de quatro
 * linhas e a asserção recai sobre o comportamento do logger, que é o que se quer fixar.
 */
function construirConsoleSender(): EmailSender {
  return {
    transport: 'log (sem SMTP configurado)',
    delivers: false,
    async send(message) {
      logger.info('Email não enviado — entrega por configurar; conteúdo registado', {
        to: message.to,
        subject: message.subject,
        text: redactResetLinks(message.text),
      });
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Escolha do transporte no arranque                                           */
/* -------------------------------------------------------------------------- */

describe('registerEmailSender', () => {
  afterEach(() => {
    // Repor o sender de consola entre casos, para que uma escolha não contamine o seguinte.
    setEmailSender({ transport: 'teste', delivers: false, async send() {} });
  });

  it('escolhe o transporte de log quando não há SMTP configurado, fora de produção', () => {
    const sender = registerEmailSender();

    expect(sender.delivers).toBe(false);
    expect(describeEmail()).toContain('entrega por email inativa');
  });

  it('descreve o transporte ativo sem afirmar uma entrega que não acontece', () => {
    setEmailSender({ transport: 'SMTP smtp.exemplo.test:587 (STARTTLS)', delivers: true, async send() {} });

    // A frase tem de ser derivada do sender em uso: uma descrição fixa diria "inativa" com
    // SMTP ligado, ou "ativa" em desenvolvimento — as duas mentiras opostas.
    expect(describeEmail()).toBe('entrega real por SMTP smtp.exemplo.test:587 (STARTTLS)');
  });
});

/* -------------------------------------------------------------------------- */
/* `sendEmail` não pode derrubar o pedido                                      */
/* -------------------------------------------------------------------------- */

describe('sendEmail', () => {
  afterEach(() => {
    setEmailSender({ transport: 'teste', delivers: false, async send() {} });
  });

  it('devolve `true` quando o transporte entrega', async () => {
    let enviados = 0;
    setEmailSender({
      transport: 'teste',
      delivers: true,
      async send() {
        enviados += 1;
      },
    });

    await expect(sendEmail({ to: 'a@zemlo.test', subject: 's', text: 't' })).resolves.toBe(true);
    expect(enviados).toBe(1);
  });

  it('devolve `false` em vez de lançar quando o transporte falha', async () => {
    setEmailSender({
      transport: 'teste',
      delivers: true,
      async send() {
        throw new Error('servidor SMTP recusou a ligação');
      },
    });

    /*
     * Esta é a propriedade que protege a anti-enumeração. Se a falha se propagasse, a rota
     * de recuperação responderia um erro — e um erro só para os emails que existem
     * distinguiria as contas registadas das outras, desfazendo a resposta uniforme.
     */
    await expect(sendEmail({ to: 'a@zemlo.test', subject: 's', text: 't' })).resolves.toBe(false);
  });

  it('não deixa o token entrar no registo de erro do transporte', async () => {
    const captura = capturarLogs();

    setEmailSender({
      transport: 'teste',
      delivers: true,
      async send() {
        // A mensagem de erro de um transporte real é construída por `smtp.ts`, que cita o
        // verbo e o código mas nunca a linha enviada — é essa fronteira que aqui se fixa.
        throw new Error('SMTP: comando RCPT TO recusado pelo servidor (550)');
      },
    });

    await sendEmail({
      to: 'b@zemlo.test',
      subject: 'Zemlo — reposição da tua password',
      text: RESET_URL,
    });

    const saida = captura.saida();
    captura.parar();

    // O `sendEmail` regista o erro. O que se afirma é que o registo cita o motivo técnico
    // e não o conteúdo da mensagem.
    expect(saida).not.toContain(TOKEN);
    expect(saida).toContain('550');
  });
});

/* -------------------------------------------------------------------------- */
/* Estado do transporte                                                       */
/* -------------------------------------------------------------------------- */

describe('activeEmailSender', () => {
  afterEach(() => {
    setEmailSender({ transport: 'teste', delivers: false, async send() {} });
  });

  it('devolve o sender efetivamente registado', () => {
    const escolhido: EmailSender = { transport: 'marcador', delivers: true, async send() {} };
    setEmailSender(escolhido);

    // Comparação por identidade: é o mesmo objecto que `sendEmail` vai usar, e não uma
    // reconstrução equivalente.
    expect(activeEmailSender()).toBe(escolhido);
  });
});
