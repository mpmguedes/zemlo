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
 * Por isso a entrega é uma **interface** com uma implementação de registo:
 *
 *  - `ConsoleEmailSender` escreve a mensagem no log. Em desenvolvimento é exatamente o que
 *    se quer: o link aparece no terminal e o fluxo pode ser testado de ponta a ponta.
 *  - Ao ligar um fornecedor real (SMTP, Resend, Postmark), implementa-se `EmailSender` e
 *    troca-se a instância. Nada do domínio de tokens muda.
 *
 * O arranque regista o estado da entrega, para que ninguém descubra em produção que os
 * emails "estavam a ser enviados" para o log.
 */

import { config } from '../core/config.js';
import { logger } from '../core/logger.js';

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
 */
class ConsoleEmailSender implements EmailSender {
  readonly transport = 'log (sem SMTP configurado)';
  readonly delivers = false;

  async send(message: EmailMessage): Promise<void> {
    logger.info('Email não enviado — entrega por configurar; conteúdo registado', {
      to: message.to,
      subject: message.subject,
      body: message.text,
    });
  }
}

let sender: EmailSender = new ConsoleEmailSender();

/** Substitui o transporte. Usado ao ligar um fornecedor real e nos testes. */
export function setEmailSender(next: EmailSender): void {
  sender = next;
}

/** Transporte em uso, para o registo de arranque e para os testes. */
export function activeEmailSender(): EmailSender {
  return sender;
}

/** Descrição do estado da entrega, para o log de arranque. */
export function describeEmail(): string {
  if (!config.email.enabled) {
    return 'entrega por email inativa (sem SMTP) — os links de recuperação são registados no log';
  }
  return `SMTP configurado (${config.email.host}) — falta ligar o transporte real`;
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
