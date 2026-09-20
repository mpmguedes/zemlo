/**
 * Entrega de email — fronteira explícita, com uma implementação que não mente.
 *
 * ## Porquê esta separação
 *
 * A recuperação de password precisa de duas coisas muito diferentes: **gerar e validar**
 * um token de uso único (domínio puro, testável, sem dependências) e **entregar** o link
 * ao utilizador (infraestrutura, com credenciais de terceiros).
 *
 * No MVP só a primeira existe. Não há servidor SMTP configurado, e a especificação (§39)
 * exclui integrações externas do âmbito. Inventar um fornecedor ou meter credenciais no
 * repositório estaria fora do âmbito — e um `send()` que devolvesse sucesso sem enviar
 * nada seria pior, porque produziria uma recuperação de password que parece funcionar e
 * não funciona.
 *
 * Por isso a entrega é uma **interface** com duas implementações:
 *
 *  - `SmtpEmailSender` entrega a sério, através do cliente SMTP de `services/smtp.ts`.
 *    É o transporte usado sempre que `SMTP_HOST` está configurado.
 *  - `ConsoleEmailSender` escreve no log, e é o **fallback** quando não há SMTP. Em
 *    desenvolvimento é exatamente o que se quer: o link aparece no terminal e o fluxo pode
 *    ser testado de ponta a ponta. Em produção é recusado no arranque (ver abaixo).
 *
 * A escolha é feita por `registerEmailSender()`, chamada uma vez a partir de `app.ts`. Nada
 * do domínio de tokens muda com a troca de transporte.
 *
 * O arranque regista o estado da entrega, para que ninguém descubra em produção que os
 * emails "estavam a ser enviados" para o log.
 */

import { config } from '../core/config.js';
import { logger } from '../core/logger.js';
import { sendSmtpMessage } from './smtp.js';

export interface EmailMessage {
  to: string;
  subject: string;
  /** Corpo em texto simples. O MVP não depende de HTML para nada crítico. */
  text: string;
}

export interface EmailSender {
  /** Identificador legível do transporte, para diagnóstico e logs de arranque. */
  readonly transport: string;
  /** `true` quando a mensagem chega realmente a um destinatário externo. */
  readonly delivers: boolean;
  send(message: EmailMessage): Promise<void>;
}

/**
 * Implementação de desenvolvimento: escreve no log em vez de enviar.
 *
 * Marca `delivers: false` de forma deliberada. Um consumidor — a rota de recuperação, o
 * registo de arranque — pode assim distinguir "entregue" de "registado" sem inspecionar o
 * ambiente.
 *
 * ## O corpo é registado como `text`, e isso é uma decisão de segurança
 *
 * Este sender existe para que o link de recuperação apareça no terminal de quem
 * desenvolve. Registá-lo é, por isso, a função dele.
 *
 * A chave chama-se `text` — e não `body` — porque `core/logger.ts` redige chaves
 * sensíveis pelo **nome**. `body` não está na lista de `SENSITIVE_KEYS`, pelo que um corpo
 * registado sob esse nome passaria em claro, *incluindo o token do link*. `text` está na
 * lista, e o url do corpo é substituído antes de sair do processo: o que aparece no
 * terminal é a mensagem sem o link.
 *
 * Para um corpo cujo conteúdo é sensível por natureza, a única forma de não depender de
 * quem escreve a chave é o sender tratar do assunto — que é o que `redactResetLinks` faz.
 */
class ConsoleEmailSender implements EmailSender {
  readonly transport = 'log (sem SMTP configurado)';
  readonly delivers = false;

  async send(message: EmailMessage): Promise<void> {
    logger.info('Email não enviado — entrega por configurar; conteúdo registado', {
      to: message.to,
      subject: message.subject,
      text: redactResetLinks(message.text),
    });
  }
}

/**
 * Remove os links de recuperação do texto antes de ele chegar a um log.
 *
 * ## Porque é que não basta confiar no redator de chaves
 *
 * O redator de `core/logger.ts` substitui o **valor** de uma chave sensível, mas não
 * inspeciona o interior de uma cadeia que não o seja. Um corpo de email é texto: o token
 * vive dentro dele, e nenhuma lista de nomes de chave o apanha se a chave não for
 * reconhecida.
 *
 * Como o corpo é, por definição, o sítio onde o link viaja, o filtro tem de olhar para o
 * conteúdo. O que se procura é o parâmetro `token` de um url — o resto da mensagem é
 * inofensivo e continua legível, que é o que torna o log útil em desenvolvimento.
 *
 * Um url com o token substituído continua a mostrar *que* o email foi composto e para
 * *que* página aponta; o que deixa de ser possível é usá-lo a partir do log.
 */
export function redactResetLinks(text: string): string {
  return text.replace(/([?&]token=)[^&\s]+/gi, '$1[redigido]');
}

let sender: EmailSender = new ConsoleEmailSender();

/** Substitui o transporte. Usado ao ligar um fornecedor real e nos testes. */
export function setEmailSender(next: EmailSender): void {
  sender = next;
}

/* -------------------------------------------------------------------------- */
/* Transporte SMTP real                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Entrega por SMTP, com as credenciais vindas da configuração.
 *
 * Não guarda estado entre envios: abre uma ligação por mensagem. Para o volume de uma
 * recuperação de password — alguns emails por hora — reutilizar ligações seria complexidade
 * sem retorno, e uma ligação persistente mal fechada é uma fonte de erros silenciosos.
 */
class SmtpEmailSender implements EmailSender {
  readonly delivers = true;
  readonly transport: string;

  constructor(private readonly options: {
    host: string;
    port: number;
    secure: boolean;
    user: string | null;
    password: string | null;
    from: string;
  }) {
    this.transport = `SMTP ${options.host}:${options.port}${options.secure ? ' (TLS)' : ' (STARTTLS)'}`;
  }

  async send(message: EmailMessage): Promise<void> {
    const result = await sendSmtpMessage({
      ...this.options,
      to: message.to,
      subject: message.subject,
      text: message.text,
      timeoutMs: 15_000,
    });

    /*
     * Uma recusa propaga-se como exceção, e `sendEmail` apanha-a e regista-a. O motivo
     * inclui o código do servidor mas **nunca** a linha enviada — é essa a fronteira que
     * `smtp.ts` garante, para que a password do SMTP e o token do link não entrem num log
     * por via do diagnóstico.
     */
    if (!result.ok) throw new Error(result.reason);
  }
}

/**
 * Escolhe e regista o transporte a usar, uma vez, no arranque.
 *
 * ## Porque é que produção sem SMTP falha em vez de degradar
 *
 * Sem SMTP, o fallback registaria o link no log — que é útil em desenvolvimento e um
 * **desastre** em produção: o utilizador não recebe nada, e a única cópia da ligação de
 * recuperação fica num log que pode ser lido por outra pessoa.
 *
 * Recusar o arranque troca "a recuperação de password não funciona e ninguém sabe" por
 * "a instalação não arranca com esta configuração". O `server.ts` já aplica este princípio
 * à base de dados: um servidor que aceita pedidos e falha em tudo esconde a causa.
 *
 * A decisão é **explícita** e não depende de o operador ler a documentação: quem quiser
 * mesmo arrancar sem entrega tem de o dizer (`EMAIL_ALLOW_LOG_TRANSPORT`), e fica
 * registado o que perdeu.
 */
export function registerEmailSender(): EmailSender {
  const { enabled, host, port, user, password, from } = config.email;

  if (enabled && host) {
    /*
     * Porta 465 usa TLS implícito; 587 e 25 negociam STARTTLS. Derivar do número da porta
     * em vez de exigir outra variável evita uma configuração em que o operador diz
     * `secure: true` numa porta que não o é e a ligação fica pendurada.
     */
    const secure = port === 465;
    sender = new SmtpEmailSender({ host, port, secure, user, password, from });
    return sender;
  }

  const allowLogTransport = process.env.EMAIL_ALLOW_LOG_TRANSPORT === 'true';
  if (config.isProduction && !allowLogTransport) {
    throw new Error(
      'Entrega de email por configurar: define SMTP_HOST (e SMTP_USER/SMTP_PASSWORD, se o ' +
        'servidor exigir autenticação) antes de arrancar em produção. Sem isto, a recuperação ' +
        'de password não chega a ninguém. Para arrancar mesmo assim — sabendo que os links ' +
        'ficam no log — define EMAIL_ALLOW_LOG_TRANSPORT=true.',
    );
  }

  sender = new ConsoleEmailSender();
  if (config.isProduction) {
    logger.warn(
      'A arrancar em produção SEM entrega de email (EMAIL_ALLOW_LOG_TRANSPORT=true): ' +
        'os links de recuperação de password ficam no log e não chegam aos utilizadores.',
    );
  }
  return sender;
}

/** Transporte em uso, para o registo de arranque e para os testes. */
export function activeEmailSender(): EmailSender {
  return sender;
}

/** Descrição do estado da entrega, para o log de arranque. */
export function describeEmail(): string {
  const active = activeEmailSender();
  if (active.delivers) {
    return `entrega real por ${active.transport}`;
  }
  return 'entrega por email inativa (sem SMTP) — os links de recuperação são registados no log';
}

/**
 * Envia uma mensagem, sem deixar uma falha de transporte derrubar o pedido.
 *
 * A recuperação de password responde sempre a mesma coisa, exista ou não a conta: se uma
 * falha de SMTP se propagasse como erro, o código de resposta passaria a distinguir os
 * dois casos e reabriria a enumeração de contas que a resposta uniforme existe para
 * evitar.
 */
export async function sendEmail(message: EmailMessage): Promise<boolean> {
  try {
    await sender.send(message);
    return true;
  } catch (error) {
    logger.error('Falha ao entregar email', { error, to: message.to, subject: message.subject });
    return false;
  }
}
