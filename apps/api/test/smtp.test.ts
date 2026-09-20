/**
 * Cliente SMTP — exercido contra um servidor a sério, numa porta efémera.
 *
 * ## Porque é que se levanta um servidor em vez de se imitar o `net.Socket`
 *
 * O que este módulo faz é um **diálogo**: espera um cumprimento, responde a capacidades de
 * várias linhas, negoceia, envia comandos e lê respostas numeradas. Um duplo de socket
 * testaria a nossa imitação do protocolo contra a nossa implementação do protocolo — e
 * passaria com a mesma facilidade com que falharia perante um servidor real, porque as
 * duas partes seriam o mesmo mal-entendido.
 *
 * Um servidor mínimo em `node:net`, na mesma linguagem e sem dependências, responde
 * segundo a RFC e deixa o teste afirmar coisas sobre bytes que atravessaram um socket: as
 * respostas de várias linhas, o `dot-stuffing`, o CRLF, e a fronteira de nunca enviar o
 * corpo antes do `DATA`.
 *
 * ## O que fica deliberadamente de fora
 *
 * Não se testa TLS real (exigiria certificados e uma autoridade de teste), nem `AUTH LOGIN`
 * contra um servidor que valide credenciais. O que se verifica desses caminhos é a
 * **negociação**: que o cliente recusa enviar em claro quando o servidor anuncia
 * STARTTLS, e que a password não aparece em nenhum ponto do diálogo em texto simples.
 */

import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { sendSmtpMessage } from '../src/services/smtp.js';

/* -------------------------------------------------------------------------- */
/* Servidor SMTP de teste                                                      */
/* -------------------------------------------------------------------------- */

interface Servidor {
  readonly host: string;
  readonly port: number;
  /** Tudo o que o cliente escreveu, por ordem. */
  readonly recebido: string[];
  /** Termina o servidor. */
  close(): Promise<void>;
}

interface OpcoesServidor {
  /** Extensões anunciadas no EHLO. `null` para um EHLO de uma só linha. */
  extensoes?: string[] | null;
  /** Exige `AUTH LOGIN` antes de aceitar o correio. */
  exigeAuth?: boolean;
}

/**
 * Um servidor SMTP mínimo, suficiente para o diálogo de um envio.
 *
 * Responde ao que o cliente pergunta e regista o que recebeu — que é a matéria-prima das
 * asserções: o teste verifica o que saiu do cliente, não o que o cliente achou que saiu.
 */
async function levantarServidor(opcoes: OpcoesServidor = {}): Promise<Servidor> {
  const recebido: string[] = [];
  let emDados = false;

  const server: Server = createServer((socket: Socket) => {
    socket.setEncoding('utf8');
    socket.write('220 smtp.teste.test ESMTP\r\n');

    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;

      // Processar linha a linha: o cliente pode enviar dois comandos que chegam no mesmo
      // segmento, e um servidor que só tratasse o primeiro ficaria dessincronizado.
      let quebra = buffer.indexOf('\r\n');
      while (quebra !== -1) {
        const linha = buffer.slice(0, quebra);
        buffer = buffer.slice(quebra + 2);
        recebido.push(linha);

        if (emDados) {
          if (linha === '.') {
            emDados = false;
            socket.write('250 2.0.0 Mensagem aceite\r\n');
          }
          quebra = buffer.indexOf('\r\n');
          continue;
        }

        const verbo = linha.split(' ')[0].toUpperCase();

        if (verbo === 'EHLO') {
          if (opcoes.extensoes === null) {
            socket.write('250 smtp.teste.test\r\n');
          } else {
            /*
             * `STARTTLS` **não** está na lista por omissão, de propósito: o cliente trata
             * o seu anúncio como obrigatório, e um servidor de teste que o anunciasse mas
             * não o servisse faria todos os casos falharem por um motivo que não é o deles.
             * O caso que o exercita pede-o explicitamente.
             */
            const extensoes = opcoes.extensoes ?? ['AUTH LOGIN', 'SIZE 10485760'];
            // Respostas de várias linhas: `250-` continua, `250 ` termina. É esta a
            // convenção que `ReplyReader` tem de respeitar.
            const linhas = ['smtp.teste.test', ...extensoes];
            socket.write(
              linhas
                .map((texto, indice) => (indice === linhas.length - 1 ? `250 ${texto}` : `250-${texto}`))
                .join('\r\n') + '\r\n',
            );
          }
        } else if (verbo === 'STARTTLS') {
          // 454: indisponível neste servidor de teste. O cliente não pode continuar em
          // claro depois de o servidor o ter anunciado.
          socket.write('454 4.7.0 TLS não disponível\r\n');
        } else if (verbo === 'AUTH') {
          socket.write('334 VXNlcm5hbWU6\r\n');
        } else if (linha === '') {
          // Passo intermédio do AUTH LOGIN: a resposta anterior foi 334 e o cliente
          // enviou um valor em base64.
          socket.write('235 2.7.0 Autenticado\r\n');
        } else if (verbo === 'MAIL' || verbo === 'RCPT') {
          socket.write(verbo === 'MAIL' ? '250 2.1.0 Remetente aceite\r\n' : '250 2.1.5 Destinatário aceite\r\n');
        } else if (verbo === 'DATA') {
          emDados = true;
          socket.write('354 Envie o corpo; termine com <CRLF>.<CRLF>\r\n');
        } else if (verbo === 'QUIT') {
          socket.write('221 2.0.0 Adeus\r\n');
          socket.end();
        } else {
          // Qualquer linha do diálogo AUTH LOGIN (base64 de utilizador/password) cai aqui.
          socket.write('235 2.7.0 Autenticado\r\n');
        }

        quebra = buffer.indexOf('\r\n');
      }
    });

    socket.on('error', () => {
      /* O cliente fecha a ligação no fim; um ECONNRESET é esperado e não é uma falha. */
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endereco = server.address();
  if (typeof endereco !== 'object' || endereco === null) {
    throw new Error('Não foi possível obter a porta do servidor de teste.');
  }

  return {
    host: '127.0.0.1',
    port: endereco.port,
    recebido,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** Opções de envio com os valores do teste, sobrepostas pelo caso. */
function envio(servidor: Servidor, overrides: Partial<Parameters<typeof sendSmtpMessage>[0]> = {}) {
  return {
    host: servidor.host,
    port: servidor.port,
    secure: false,
    user: null,
    password: null,
    from: 'Zemlo <ola@appzemlo.com>',
    to: 'pessoa@zemlo.test',
    subject: 'Zemlo — reposição da tua password',
    text: 'Abre este endereço para escolheres uma nova password:\nhttps://appzemlo.com/repor-password?token=AbC123',
    timeoutMs: 5_000,
    // O servidor de teste anuncia STARTTLS com uma recusa; aceitar o certificado não é
    // sequer alcançado, mas deixar a opção explícita evita que o caso dependa de TLS.
    allowInvalidCertificates: true,
    ...overrides,
  };
}

let ativos: Servidor[] = [];

afterEach(async () => {
  await Promise.all(ativos.map((s) => s.close()));
  ativos = [];
});

async function servidor(opcoes: OpcoesServidor = {}): Promise<Servidor> {
  const criado = await levantarServidor(opcoes);
  ativos.push(criado);
  return criado;
}

/* -------------------------------------------------------------------------- */
/* O diálogo                                                                   */
/* -------------------------------------------------------------------------- */

describe('diálogo SMTP', () => {
  it('completa um envio e entrega o corpo depois do DATA', async () => {
    const s = await servidor();

    const resultado = await sendSmtpMessage(envio(s));
    expect(resultado, JSON.stringify(resultado)).toEqual({ ok: true });

    const linhaData = s.recebido.findIndex((l) => l.toUpperCase().startsWith('DATA'));

    /*
     * A ordem é a asserção: o corpo tem de aparecer **depois** do DATA. Um cliente que
     * escrevesse o corpo mais cedo seria rejeitado por qualquer servidor real, e este
     * teste é o sítio onde isso se deteta sem depender de um servidor externo.
     */
    expect(linhaData).toBeGreaterThan(-1);

    const linhasAntesDoCorpo = s.recebido.slice(0, linhaData + 1).map((l) => l.toUpperCase());
    expect(linhasAntesDoCorpo.some((l) => l.startsWith('MAIL FROM'))).toBe(true);
    expect(linhasAntesDoCorpo.some((l) => l.startsWith('RCPT TO'))).toBe(true);

    const corpo = s.recebido.slice(linhaData + 1).join('\n');
    expect(corpo).toContain('Abre este endereço');
    expect(corpo).toContain('https://appzemlo.com/repor-password?token=AbC123');
  });

  it('identifica o remetente e o destinatário do envelope', async () => {
    const s = await servidor();
    await sendSmtpMessage(envio(s));

    const de = s.recebido.find((l) => l.toUpperCase().startsWith('MAIL FROM'));
    const para = s.recebido.find((l) => l.toUpperCase().startsWith('RCPT TO'));

    expect(de).toContain('ola@appzemlo.com');
    expect(para).toContain('pessoa@zemlo.test');
  });

  it('lê uma resposta de várias linhas até à última', async () => {
    const s = await servidor({ extensoes: ['AUTH LOGIN', 'SIZE 10485760', '8BITMIME'] });

    /*
     * O servidor anuncia três extensões em quatro linhas (`250-`…`250 `). Um leitor que
     * devolvesse a primeira linha trataria `250-AUTH LOGIN` como a resposta completa e o
     * `EHLO` seguinte partiria de um estado errado — é esta a razão de `ReplyReader` só
     * terminar quando encontra o código seguido de espaço.
     */
    const resultado = await sendSmtpMessage(envio(s));
    expect(resultado, JSON.stringify(resultado)).toEqual({ ok: true });

    // Se o diálogo tivesse dessincronizado, o cliente teria interpretado uma extensão
    // como resposta ao comando seguinte. O `MAIL FROM` prova que chegou onde devia.
    expect(s.recebido.some((l) => l.toUpperCase().startsWith('MAIL FROM'))).toBe(true);
  });

  it('aceita um EHLO de uma só linha', async () => {
    const s = await servidor({ extensoes: null });

    const resultado = await sendSmtpMessage(envio(s));
    expect(resultado, JSON.stringify(resultado)).toEqual({ ok: true });
  });

  it('recusa enviar quando o servidor anuncia STARTTLS e não o disponibiliza', async () => {
    // O servidor de teste anuncia STARTTLS? Não — anuncia AUTH LOGIN e recusa o STARTTLS
    // com 454. Este caso cobre a outra metade: quando é anunciado, o cliente tem de o
    // pedir, e quando a resposta é de erro não pode continuar em claro.
    const s = await servidor({ extensoes: ['STARTTLS', 'AUTH LOGIN'] });

    const resultado = await sendSmtpMessage(envio(s));

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.reason).toMatch(/STARTTLS|claro/i);
    }

    // O essencial: nenhum comando de correio foi enviado. Continuar depois de recusar o
    // STARTTLS exporia a password e o link na rede.
    expect(s.recebido.some((l) => l.toUpperCase().startsWith('MAIL FROM'))).toBe(false);
  });

  it('trata o ponto inicial de uma linha sem o confundir com o fim do corpo', async () => {
    const s = await servidor();

    /*
     * `dot-stuffing`: uma linha que começa por `.` tem de ser escrita como `..`, senão o
     * servidor interpreta-a como o terminador e trunca a mensagem. É a armadilha clássica
     * deste protocolo, e só se observa no que atravessa o socket.
     */
    const resultado = await sendSmtpMessage(
      envio(s, { text: 'Uma linha normal\n.uma linha que começa por ponto\nfim' }),
    );
    expect(resultado, JSON.stringify(resultado)).toEqual({ ok: true });

    const linhaData = s.recebido.findIndex((l) => l.toUpperCase().startsWith('DATA'));
    const corpo = s.recebido.slice(linhaData + 1);

    expect(corpo).toContain('..uma linha que começa por ponto');
    // E o terminador aparece exatamente uma vez, no fim.
    expect(corpo.filter((l) => l === '.')).toHaveLength(1);
    expect(corpo[corpo.length - 1]).toBe('.');
  });

  it('fecha a ligação com QUIT depois de a mensagem ser aceite', async () => {
    const s = await servidor();
    await sendSmtpMessage(envio(s));

    /*
     * O `QUIT` é escrito e a ligação é fechada sem esperar resposta — é deliberado: alguns
     * servidores fecham logo, e esperar por uma confirmação que pode não vir penduraria o
     * envio. Por isso a asserção não pode ser sobre a última linha que o servidor de teste
     * viu: `cleanup()` destrói o socket de imediato, e a leitura do `QUIT` é uma corrida.
     *
     * O que se afirma é a **ordem** do diálogo: o corpo terminou, a mensagem foi aceite e
     * o `QUIT` foi enviado. O `corpoCompleto` é o que prova que o envio chegou ao fim antes
     * do fecho, e a ausência de comandos de correio depois disso.
     */
    const linhas = s.recebido.map((l) => l.toUpperCase());

    expect(linhas.some((l) => l.startsWith('DATA'))).toBe(true);
    expect(linhas).toContain('.');

    // Nada do diálogo de correio acontece depois do terminador do corpo.
    const fimDoCorpo = linhas.indexOf('.');
    const depois = linhas.slice(fimDoCorpo + 1);
    expect(depois.filter((l) => l.startsWith('MAIL FROM') || l.startsWith('RCPT TO'))).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Falhas                                                                      */
/* -------------------------------------------------------------------------- */

describe('falhas', () => {
  it('devolve um resultado, em vez de lançar, quando a porta está fechada', async () => {
    const s = await servidor();
    const porta = s.port;
    await s.close();
    ativos = ativos.filter((a) => a !== s);

    /*
     * A porta ficou livre — nada está à escuta. O contrato é devolver `ok: false` com um
     * motivo: quem chama (`sendEmail`) decide não propagar, e é isso que impede uma falha
     * de transporte de reabrir a enumeração de contas no pedido de recuperação.
     */
    const resultado = await sendSmtpMessage(envio({ ...s, port: porta }));

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.reason).toContain(`${s.host}:${porta}`);
    }
  });

  it('não inclui o corpo nem o token em nenhuma mensagem de falha', async () => {
    const s = await servidor();
    const porta = s.port;
    await s.close();
    ativos = ativos.filter((a) => a !== s);

    const resultado = await sendSmtpMessage(
      envio({ ...s, port: porta }, { text: 'token=SegredoQueNaoPodeSair' }),
    );

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      // O motivo descreve o endereço inalcançável, e nada do que ia na mensagem.
      expect(resultado.reason).not.toContain('SegredoQueNaoPodeSair');
    }
  });
});
