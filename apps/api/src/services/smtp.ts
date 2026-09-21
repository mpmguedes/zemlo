/**
 * Cliente SMTP mínimo — sem dependências externas.
 *
 * ## Porquê escrever isto em vez de instalar um pacote
 *
 * A entrega de email está no caminho crítico da recuperação de password, que é o único
 * fluxo que devolve a conta a quem perdeu a password. Uma dependência aqui é uma
 * dependência na base de toda a autenticação, e o projeto já tomou esta decisão uma vez
 * (ver `core/logger.ts`): quando o que é preciso cabe numa página, uma página evita uma
 * dependência com histórico de vulnerabilidades.
 *
 * O que é realmente preciso é pequeno. Um envio de email com autenticação tem quatro
 * verbos — `EHLO`, `AUTH`, `MAIL FROM`/`RCPT TO`, `DATA` — e um diálogo de respostas
 * numeradas. É isso que este ficheiro implementa, e nada mais: não faz filas, não faz
 * retomas, não faz anexos, não interpreta MIME complexo.
 *
 * ## Âmbito deliberadamente estreito
 *
 * Envia **uma** mensagem de texto simples em UTF-8, para **um** destinatário, por ligação
 * nova. Não reutiliza ligações (não há volume para isso), não suporta anexos nem HTML
 * (o `EmailMessage` do Zemlo não os tem), e não tenta negociar extensões além das que
 * precisa de saber responder (`AUTH`, `STARTTLS`).
 *
 * ## O que este cliente NÃO faz, e porquê
 *
 * - **Não engole erros.** Uma falha de SMTP devolve `rejeitado` com o código do servidor.
 *   Quem chama (`sendEmail`) decide o que fazer com isso — e decide não propagar, para não
 *   reabrir a enumeração de contas.
 * - **Não registra o conteúdo.** O `AUTH` contém a password do SMTP e o `DATA` contém o
 *   corpo com o token. Nenhum dos dois entra em log. Os erros citam o **verbo** e o
 *   **código de resposta** do servidor, nunca a linha enviada.
 */

import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { envelopeAddress } from '../core/email-address.js';

/** Resposta do servidor: código numérico e linha de texto associada. */
interface SmtpReply {
  code: number;
  text: string;
}

export type SmtpResult =
  | { ok: true }
  | { ok: false; reason: string; code?: number };

export interface SmtpSendOptions {
  host: string;
  port: number;
  /** `true` para ligação TLS implícita (porta 465). `false` usa `STARTTLS` quando oferecido. */
  secure: boolean;
  user: string | null;
  password: string | null;
  from: string;
  to: string;
  subject: string;
  text: string;
  /** Tempo máximo para o diálogo completo, em milissegundos. */
  timeoutMs: number;
  /**
   * Quando `true`, aceita certificados autoassinados. Só para desenvolvimento local
   * contra servidores de teste; nunca é ligado por omissão nem em produção.
   */
  allowInvalidCertificates?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Diálogo SMTP                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Acumula bytes e extrai respostas SMTP completas.
 *
 * Uma resposta SMTP pode ter várias linhas, e só a **última** traz o código seguido de
 * espaço (`250 OK`, em vez de `250-`). Ler linha a linha e devolver a primeira daria uma
 * resposta intermédia de um servidor que anuncia capacidades em várias linhas — e o
 * diálogo seguinte partiria de um estado errado.
 */
class ReplyReader {
  private buffer = '';
  private pending: Array<(reply: SmtpReply) => void> = [];

  constructor(socket: Socket | TLSSocket) {
    socket.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      this.drain();
    });
  }

  private drain(): void {
    /*
     * Uma resposta termina numa linha `NNN <texto>` (código + espaço), não `NNN-`.
     *
     * O `text` que se devolve é a resposta **completa**, com as linhas de continuação
     * incluídas e sem os códigos. É o que permite ler as capacidades anunciadas no `EHLO`
     * — `AUTH LOGIN`, `SIZE`, `STARTTLS` — sem um segundo mecanismo só para as guardar:
     * se devolvesse apenas a última linha, a lista de extensões perdia-se e o cliente
     * deixaria de saber o que o servidor suporta.
     */
    const match = /(?:^|\r?\n)(\d{3}) (?!-)([^\r\n]*)\r?\n/.exec(this.buffer);
    if (!match) return;

    const consumed = match.index + match[0].length;
    const code = Number(match[1]);

    // O bloco inteiro (linhas `NNN-` seguidas da `NNN `) faz parte desta resposta.
    const bloco = this.buffer.slice(0, consumed);
    const text = bloco
      .split(/\r?\n/)
      .filter((linha) => linha.length > 0)
      .map((linha) => linha.replace(/^\d{3}[-\s]?/, ''))
      .join('\n');

    this.buffer = this.buffer.slice(consumed);

    const resolve = this.pending.shift();
    if (resolve) resolve({ code, text });
  }

  next(): Promise<SmtpReply> {
    return new Promise<SmtpReply>((resolve) => {
      this.pending.push(resolve);
      this.drain();
    });
  }

  /** Descarta o que ficou por ler ao mudar de socket (STARTTLS reconstrói o leitor). */
  destroy(): void {
    this.buffer = '';
    this.pending = [];
  }
}

/** Erro de transporte com a informação que interessa a quem diagnostica. */
class SmtpError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'SmtpError';
  }
}

/** `true` quando o servidor anunciou uma capacidade no `EHLO` (insensível a maiúsculas). */
function serverAdvertises(capabilities: SmtpReply, nome: string): boolean {
  // Comparação por palavra no início de cada linha: `STARTTLS` não pode confundir-se com
  // um texto que apenas o mencione. O `EHLO` devolve uma linha por capacidade.
  return capabilities.text
    .split('\n')
    .some((linha) => linha.trim().toUpperCase().startsWith(nome.toUpperCase()));
}

/** Envia um comando e exige um código aceitável, devolvendo a resposta. */
async function command(
  reader: ReplyReader,
  socket: Socket | TLSSocket,
  line: string,
  accept: readonly number[],
  label: string,
): Promise<SmtpReply> {
  socket.write(`${line}\r\n`);
  const reply = await reader.next();
  if (!accept.includes(reply.code)) {
    // A mensagem cita o verbo e o código, nunca a linha enviada: a linha do `AUTH` tem a
    // password e a do `DATA` tem o token.
    throw new SmtpError(
      `O servidor SMTP recusou ${label} (${reply.code}${reply.text ? ` ${reply.text}` : ''})`,
      reply.code,
    );
  }
  return reply;
}

/**
 * Codifica o assunto segundo RFC 2047 quando tem caracteres não-ASCII.
 *
 * Sem isto, um assunto como "Zemlo — reposição da tua password" viaja com o travessão em
 * UTF-8 cru, e clientes de email conservadores mostram-no corrompido. O `—` é exatamente o
 * tipo de carácter que aparece num assunto português.
 */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (!/[^\x20-\x7E]/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/**
 * Normaliza o corpo para CRLF e aplica *dot-stuffing*.
 *
 * Um corpo que contenha uma linha começada por `.` terminaria a mensagem mais cedo: o
 * ponto sozinho é o sinal de fim do `DATA` (RFC 5321 §4.5.2). Duplicar o ponto inicial
 * dessas linhas é obrigatório, não cosmético.
 */
function encodeBody(text: string): string {
  return text
    .replace(/\r?\n/g, '\r\n')
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

/** Espera que o socket ligue, ou falha com um motivo legível. */
function waitForConnect(socket: Socket | TLSSocket, timeoutMs: number, label: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Tempo esgotado ao ligar a ${label}`));
    }, timeoutMs);

    socket.once('error', (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Envia uma mensagem de texto simples.
 *
 * Devolve sempre um resultado, nunca lança: o ponto de entrada é a recuperação de password,
 * e uma exceção a sair daqui teria de ser apanhada de qualquer forma para não distinguir
 * "conta existe" de "conta não existe" na resposta HTTP.
 */
export async function sendSmtpMessage(options: SmtpSendOptions): Promise<SmtpResult> {
  const label = `${options.host}:${options.port}`;
  let socket: Socket | TLSSocket;

  try {
    socket = options.secure
      ? tlsConnect({
          host: options.host,
          port: options.port,
          servername: options.host,
          ...(options.allowInvalidCertificates ? { rejectUnauthorized: false } : {}),
        })
      : netConnect({ host: options.host, port: options.port });

    await waitForConnect(socket, options.timeoutMs, label);
  } catch (error) {
    return { ok: false, reason: `Não foi possível ligar a ${label}: ${(error as Error).message}` };
  }

  let reader = new ReplyReader(socket);

  const cleanup = (): void => {
    reader.destroy();
    socket.destroy();
  };

  try {
    const greeting = await reader.next();
    if (greeting.code !== 220) {
      throw new SmtpError(`O servidor SMTP não saudou a ligação (${greeting.code})`, greeting.code);
    }

    const capabilities = await command(reader, socket, `EHLO ${hostname()}`, [250], 'EHLO');

    /*
     * STARTTLS só se o servidor o anunciar, e é obrigatório quando o anuncia.
     *
     * A condição é esta — e não um `STARTTLS` incondicional. A diferença foi encontrada por
     * um teste que falava com um servidor que **não** anuncia STARTTLS: um cliente que o
     * pede na mesma recebe `500 comando desconhecido` (ou, pior, `454`), e o envio falha
     * por um motivo que não existe. Muitos servidores locais e de desenvolvimento não o
     * anunciam, e o cliente não pode inventar uma exigência que o servidor não fez.
     *
     * Quando é anunciado, tem de ser usado: continuar em claro enviaria a password do SMTP
     * e o link de recuperação legíveis na rede. E se o servidor anunciar mas recusar, o
     * envio é abortado — anunciar e recusar é um servidor mal configurado, e degradar para
     * claro nesse caso é precisamente a decisão silenciosa que não se toma.
     */
    if (!options.secure && serverAdvertises(capabilities, 'STARTTLS')) {
      socket.write(`STARTTLS\r\n`);
      const startTls = await reader.next();
      if (startTls.code === 220) {
        reader.destroy();
        const secured = tlsConnect({
          socket: socket as Socket,
          servername: options.host,
          ...(options.allowInvalidCertificates ? { rejectUnauthorized: false } : {}),
        });
        await new Promise<void>((resolve, reject) => {
          secured.once('secureConnect', () => resolve());
          secured.once('error', reject);
        });
        socket = secured;
        reader = new ReplyReader(socket);
        await command(reader, socket, `EHLO ${hostname()}`, [250], 'EHLO (após STARTTLS)');
      } else if (startTls.code >= 400) {
        throw new SmtpError(
          `O servidor SMTP anunciou STARTTLS mas recusou-o (${startTls.code}); ` +
            'enviar em claro exporia a password.',
          startTls.code,
        );
      }
    }

    if (options.user && options.password) {
      // `AUTH LOGIN` com credenciais em base64: é o método que praticamente todos os
      // servidores oferecem. `AUTH PLAIN` seria uma linha em vez de três, mas nem todos
      // o aceitam, e a diferença não compensa a incompatibilidade.
      await command(reader, socket, 'AUTH LOGIN', [334], 'AUTH LOGIN');
      await command(
        reader,
        socket,
        Buffer.from(options.user, 'utf8').toString('base64'),
        [334],
        'AUTH (utilizador)',
      );
      await command(
        reader,
        socket,
        Buffer.from(options.password, 'utf8').toString('base64'),
        [235],
        'AUTH (password)',
      );
    }

    /*
     * O envelope leva **só o endereço**: `MAIL FROM` aceita um caminho, não um endereço de
     * correio completo. `from` pode trazer nome de apresentação, e interpolar o valor inteiro
     * dentro de `< >` dá `<Zemlo <ola@appzemlo.com>>` — parênteses angulares aninhados, que o
     * Gmail recusa com `555 5.5.2 Syntax error`. O nome de apresentação vai no cabeçalho
     * `From:`, abaixo, onde é legítimo.
     *
     * A regra vem de `core/email-address.js`, que é também quem a aplica no arranque: a
     * configuração é validada antes de a API escutar, com o mesmo código que a usa aqui.
     */
    await command(
      reader,
      socket,
      `MAIL FROM:<${envelopeAddress(options.from, 'SMTP_FROM')}>`,
      [250],
      'MAIL FROM',
    );
    await command(reader, socket, `RCPT TO:<${options.to}>`, [250, 251], 'RCPT TO');

    await command(reader, socket, 'DATA', [354], 'DATA');

    const body = [
      `From: ${options.from}`,
      `To: ${options.to}`,
      `Subject: ${encodeHeader(options.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${messageId()}>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      encodeBody(options.text),
    ].join('\r\n');

    socket.write(`${body}\r\n.\r\n`);
    const accepted = await reader.next();
    if (accepted.code !== 250) {
      throw new SmtpError(`O servidor SMTP recusou a mensagem (${accepted.code})`, accepted.code);
    }

    // `QUIT` é cortesia: não se espera resposta, porque alguns servidores fecham logo.
    socket.write('QUIT\r\n');
    cleanup();
    return { ok: true };
  } catch (error) {
    cleanup();
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof SmtpError ? error.code : undefined;
    return { ok: false, reason: message, ...(code !== undefined ? { code } : {}) };
  }
}

/** Nome de anfitrião para o `EHLO`. Não é identidade, só um identificador de protocolo. */
function hostname(): string {
  try {
    return process.env.HOSTNAME ?? 'localhost';
  } catch {
    return 'localhost';
  }
}

/** Identificador único da mensagem. O domínio não precisa de existir para ser válido. */
function messageId(): string {
  const random = Math.random().toString(36).slice(2, 12);
  return `${Date.now().toString(36)}.${random}@zemlo`;
}
