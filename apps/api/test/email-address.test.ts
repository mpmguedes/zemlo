/**
 * Testes das regras de endereçamento partilhadas.
 *
 * Estas funções decidem **o que sai na rede**. Um erro aqui não produz um ecrã partido:
 * produz uma linha de protocolo malformada, que o servidor recusa com um código genérico
 * (`555 5.5.2 Syntax error`) e sem apontar a causa. Foi exatamente esse o defeito que este
 * módulo existe para tornar impossível — e a razão pela qual os casos de recusa são testados
 * tão a fundo como os de sucesso.
 *
 * Não tocam na rede nem na base de dados: são funções puras de texto para texto.
 */

import { describe, expect, it } from 'vitest';
import {
  assertBareAddress,
  assertSingleLine,
  EmailAddressError,
  envelopeAddress,
} from '../src/core/email-address.js';

describe('envelopeAddress', () => {
  it('extrai o endereço de um remetente com nome de apresentação', () => {
    expect(envelopeAddress('Zemlo <ola@appzemlo.com>', 'SMTP_FROM')).toBe('ola@appzemlo.com');
  });

  it('devolve o próprio valor quando não há nome de apresentação', () => {
    expect(envelopeAddress('ola@appzemlo.com', 'SMTP_FROM')).toBe('ola@appzemlo.com');
  });

  it('usa o último parêntese, não o primeiro', () => {
    // O nome de apresentação pode conter `<…>`; o endereço é o que fecha a cadeia.
    expect(envelopeAddress('"Zemlo <Suporte>" <ola@appzemlo.com>', 'SMTP_FROM')).toBe(
      'ola@appzemlo.com',
    );
  });

  it('ignora espaço à volta', () => {
    expect(envelopeAddress('  Zemlo <ola@appzemlo.com>  ', 'SMTP_FROM')).toBe('ola@appzemlo.com');
  });

  it.each([
    ['sem endereço nenhum dentro dos parênteses', 'Zemlo <>'],
    ['parênteses vazios', '<>'],
    ['texto a seguir ao endereço', 'Zemlo <ola@appzemlo.com> sobra'],
    ['espaço dentro do endereço', 'Zemlo <ola appzemlo.com>'],
    ['string vazia', ''],
    ['só espaço', '   '],
  ])('recusa um remetente %s', (_caso, valor) => {
    /*
     * Recusar, e não devolver o valor inteiro. Devolvê-lo reproduziria em silêncio o mesmo
     * envelope malformado (`MAIL FROM:<Zemlo <ola@appzemlo.com>>`) que o defeito original
     * enviava — e o modo de falha era precisamente não haver sinal nenhum de que algo corria mal.
     */
    expect(() => envelopeAddress(valor, 'SMTP_FROM')).toThrow(EmailAddressError);
  });

  it('recusa uma mudança de linha', () => {
    // Sem esta guarda, o valor injetaria um cabeçalho novo no `From:` e partiria a linha de
    // comando `MAIL FROM` a meio.
    expect(() => envelopeAddress('ola@appzemlo.com\r\nBcc: outra@zemlo.test', 'SMTP_FROM')).toThrow(
      /CR\/LF/,
    );
  });

  it('nomeia a variável na mensagem, para o erro apontar a quem configura', () => {
    expect(() => envelopeAddress('Zemlo <>', 'SMTP_FROM')).toThrow(/SMTP_FROM/);
    expect(() => envelopeAddress('Zemlo <>', 'REMETENTE_X')).toThrow(/REMETENTE_X/);
  });
});

describe('assertBareAddress', () => {
  it('aceita um endereço simples', () => {
    expect(() => assertBareAddress('ola@appzemlo.com', 'SMTP_USER')).not.toThrow();
  });

  it.each([
    ['com nome de apresentação', 'Zemlo <ola@appzemlo.com>'],
    ['com espaço', 'ola @appzemlo.com'],
    ['sem arroba', 'semarroba'],
    ['com duas arrobas', 'a@b@c'],
    ['com espaço à volta', ' ola@appzemlo.com'],
    ['com mudança de linha', 'ola@appzemlo.com\nX'],
  ])('recusa um utilizador %s', (_caso, valor) => {
    expect(() => assertBareAddress(valor, 'SMTP_USER')).toThrow(EmailAddressError);
  });

  it('nomeia a variável na mensagem', () => {
    expect(() => assertBareAddress('semarroba', 'SMTP_USER')).toThrow(/SMTP_USER/);
  });
});

describe('assertSingleLine', () => {
  it('aceita um valor sem mudanças de linha', () => {
    expect(() => assertSingleLine('nemo-rog', 'HOSTNAME')).not.toThrow();
  });

  it.each([
    ['CR', 'host\rX'],
    ['LF', 'host\nX'],
    ['CRLF', 'host\r\nX'],
  ])('recusa um valor com %s', (_caso, valor) => {
    expect(() => assertSingleLine(valor, 'HOSTNAME')).toThrow(EmailAddressError);
  });

  it('nomeia a variável na mensagem', () => {
    expect(() => assertSingleLine('host\nX', 'HOSTNAME')).toThrow(/HOSTNAME/);
  });
});
