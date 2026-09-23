/**
 * Arranque da entrega de email — o guarda que recusa produção sem SMTP.
 *
 * ## Porque é que este ficheiro existe
 *
 * `registerEmailSender()` (`services/email.ts`) tem três ramos: escolhe `SmtpEmailSender`
 * quando há `SMTP_HOST`, recusa arrancar em produção sem entrega, e degrada para o
 * `ConsoleEmailSender` fora de produção. Dois deles estavam cobertos; o **segundo não
 * estava**.
 *
 * A lacuna foi medida, não presumida. Desativar o guarda
 * (`if (false && config.isProduction && !allowLogTransport)`) e correr a suite **completa**
 * dá **35 ficheiros / 1478 testes verdes, exit 0** — a mutação sobrevive. A causa é
 * estrutural: **nenhum** ficheiro em `apps/api/test/` corre com `NODE_ENV=production`
 * (todos forçam `'test'`), pelo que o ramo era inalcançável. Registado em `PC-14` e
 * `AUTH-008`.
 *
 * ## Porque é que um ficheiro novo, e não um caso em `email.test.ts`
 *
 * `email.test.ts` pertence ao `AUD-004` (A1) — §8.1 do ROADMAP marca
 * `apps/api/src/services/email.ts` como área partilhada e manda coordenar antes de tocar.
 * Além disso há uma incompatibilidade técnica real: `core/config.ts` lê o ambiente **no
 * import** e é um singleton, pelo que um ficheiro que arranca em produção **não pode**
 * também exercer o caminho de desenvolvimento. As duas coisas vivem em processos de módulo
 * distintos.
 *
 * ## O que este ficheiro NÃO prova
 *
 * Não prova que a entrega funciona — isso é `password-reset-integration.test.ts`, que fala
 * com um servidor SMTP a sério. Aqui prova-se apenas a **decisão de arranque**: recusar, ou
 * degradar com aviso quando o operador o autoriza explicitamente.
 *
 * ## A asserção que impede o falso verde
 *
 * Um teste que se julga em produção e afinal corre em `test` passa sem exercer o ramo
 * nenhuma vez — é a forma exata de falhar que `PC-15` descreve. Por isso a **primeira**
 * asserção do ficheiro é sobre a configuração carregada (`config.isProduction`), e não
 * sobre a função em teste: se o Vitest impuser `NODE_ENV=test` depois de o ficheiro o
 * definir, é esta que falha, e não as outras que passariam por vacuidade.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type EmailModule = typeof import('../src/services/email.js');
type ConfigModule = typeof import('../src/core/config.js');

let registerEmailSender: EmailModule['registerEmailSender'];
let describeEmail: EmailModule['describeEmail'];
let config: ConfigModule['config'];

/**
 * Captura o que o logger escreve, em `stdout` **e** `stderr`.
 *
 * Os dois, e não só um: o logger manda `error` para `stderr` e o resto para `stdout`. Um
 * espião só em `stdout` faria uma asserção de "contém" passar por ausência de escrita, que é
 * o falso positivo mais fácil de escrever.
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

beforeAll(async () => {
  /*
   * Tudo o que `core/config.ts` lê tem de estar definido **antes** do import — a mesma
   * restrição que `DATABASE_URL` e `SMTP_HOST` já impõem às outras suites. `dotenv` corre com
   * `override:false`, pelo que estes valores ganham ao `.env` do repositório.
   *
   * `SMTP_HOST` é definido como cadeia vazia, e não removido: `readOptionalString` trata `''`
   * como ausente, e uma chave **presente** impede o `dotenv` de a preencher a partir do
   * ficheiro — que é o que se quer, porque um `.env` de desenvolvimento com SMTP ligado faria
   * este ficheiro exercer o ramo errado em silêncio.
   */
  process.env.NODE_ENV = 'production';
  process.env.SMTP_HOST = '';
  process.env.SMTP_PORT = '';
  process.env.SMTP_USER = '';
  process.env.SMTP_PASSWORD = '';
  process.env.SMTP_FROM = 'Zemlo <ola@appzemlo.com>';
  process.env.DATABASE_URL = 'file:./test-email-startup.db';
  // 48 caracteres: acima de `MIN_PRODUCTION_SECRET_LENGTH` (32) e sem o prefixo `dev-only-`.
  process.env.JWT_SECRET = 'arranque-email-producao-nao-e-segredo-de-verdade';
  delete process.env.EMAIL_ALLOW_LOG_TRANSPORT;

  ({ config } = await import('../src/core/config.js'));
  ({ registerEmailSender, describeEmail } = await import('../src/services/email.js'));
});

/* -------------------------------------------------------------------------- */
/* Anti-vacuidade: o ficheiro corre mesmo em produção                          */
/* -------------------------------------------------------------------------- */

describe('a configuração carregada é a de produção, sem entrega', () => {
  it('está em produção', () => {
    /*
     * Se esta asserção falhar, todas as seguintes deixam de significar o que dizem: estariam
     * a exercer o ramo de desenvolvimento e a passar por não haver guarda nenhum a testar.
     */
    expect(config.isProduction, 'O ficheiro não está a correr em produção — as asserções seguintes seriam vazias.').toBe(true);
  });

  it('não tem SMTP configurado', () => {
    // Sem isto, o guarda não é alcançado: `config.email.enabled` seria verdadeiro e o
    // transporte escolhido seria o SMTP.
    expect(config.email.enabled).toBe(false);
    expect(config.email.host).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* O guarda: recusar                                                           */
/* -------------------------------------------------------------------------- */

describe('produção sem entrega e sem escapatória', () => {
  beforeEach(() => {
    delete process.env.EMAIL_ALLOW_LOG_TRANSPORT;
  });

  it('recusa arrancar', () => {
    expect(() => registerEmailSender()).toThrow(/SMTP_HOST/);
  });

  it('a mensagem diz qual é a variável em falta e como a contornar', () => {
    /*
     * O valor de uma mensagem de arranque é dizer ao operador o que fazer às três da manhã.
     * Procurar as duas variáveis no texto é o que impede que a mensagem degrade para um
     * "configuração inválida" que obriga a ler o código.
     */
    let mensagem = '';
    try {
      registerEmailSender();
    } catch (error) {
      mensagem = (error as Error).message;
    }

    expect(mensagem).toContain('SMTP_HOST');
    expect(mensagem).toContain('EMAIL_ALLOW_LOG_TRANSPORT=true');
  });
});

/* -------------------------------------------------------------------------- */
/* A escapatória: degradar, mas a dizer que sim                                */
/* -------------------------------------------------------------------------- */

describe('produção sem entrega com EMAIL_ALLOW_LOG_TRANSPORT=true', () => {
  beforeEach(() => {
    process.env.EMAIL_ALLOW_LOG_TRANSPORT = 'true';
  });

  it('arranca com o transporte de log, e o sender não afirma entregar', () => {
    const sender = registerEmailSender();

    // `delivers: false` não é cosmético: é o que distingue "registado" de "entregue" para
    // qualquer consumidor que decida a partir daí — a rota de reenvio, o log de arranque.
    expect(sender.delivers).toBe(false);
    expect(sender.transport).toContain('log');
    expect(describeEmail()).toContain('entrega por email inativa');
  });

  it('avisa explicitamente que os links ficam no log', () => {
    const captura = capturarLogs();

    registerEmailSender();

    const saida = captura.saida();
    captura.parar();

    /*
     * A escapatória é deliberada, mas não pode ser silenciosa: quem a usa tem de ficar a
     * saber, no arranque, que a recuperação de password não chega a ninguém. Sem este aviso,
     * `EMAIL_ALLOW_LOG_TRANSPORT=true` transformaria um erro de configuração numa decisão
     * invisível.
     */
    expect(saida).toContain('SEM entrega de email');
  });

  it('a escapatória não é aceite por engano com outro valor', () => {
    /*
     * A comparação é `=== 'true'`. Um `EMAIL_ALLOW_LOG_TRANSPORT=1` ou `=yes` — que é o que
     * alguém escreve por hábito — tem de continuar a recusar, e não abrir o guarda por
     * interpretação generosa de um valor que o código não definiu.
     */
    process.env.EMAIL_ALLOW_LOG_TRANSPORT = '1';

    expect(() => registerEmailSender()).toThrow(/SMTP_HOST/);
  });
});
