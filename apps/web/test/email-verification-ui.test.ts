import { describe, expect, it } from 'vitest';
import { EMAIL_VERIFICATION_TTL_MINUTES } from '@zemlo/shared';
import { ApiError } from '../src/api/client';
import {
  VERIFICATION_LINK_REJECTED,
  humanVerificationValidity,
  translateVerifyEmailError,
} from '../src/pages/auth/emailVerification';

/*
 * Testes do que o ecrã de confirmação de email decide **antes** de desenhar.
 *
 * Não há aqui testes de componente: o projeto não tem `@testing-library`, e montar um
 * ambiente de DOM só para isto seria infraestrutura nova para pouca cobertura. Testa-se a
 * lógica pura que o ecrã consulta, que é onde vivem as duas regras que importam:
 *
 *  1. a validade escrita ao utilizador **deriva** da constante partilhada, para a frase não
 *     sobreviver a uma mudança do prazo e passar a mentir;
 *  2. os quatro motivos de recusa do link produzem a **mesma** mensagem, para quem abre um
 *     link antigo não ficar a saber se ele chegou a valer.
 *
 * O comportamento de mostrar/esconder do aviso persistente é `EmailVerificationBanner` a
 * devolver `null` quando `profile.emailVerified` é verdadeiro — uma linha, verificada por
 * leitura e pela compilação, não por um teste que precisaria de DOM.
 */

describe('validade legível do link', () => {
  it('deriva o prazo atual da constante partilhada', () => {
    // O prazo real do produto: 1440 minutos = 24 horas. Se a constante mudar, esta linha
    // obriga a olhar para o texto — que é o ponto de a derivar.
    expect(EMAIL_VERIFICATION_TTL_MINUTES).toBe(1440);
    expect(humanVerificationValidity()).toBe('24 horas');
  });

  it('não devolve o valor do servidor em minutos', () => {
    // Sem derivação, a frase diria "1440 minutos": o valor do servidor, não uma frase.
    expect(humanVerificationValidity()).not.toContain(String(EMAIL_VERIFICATION_TTL_MINUTES));
  });

  it('fala em dias quando o prazo é de vários dias', () => {
    expect(humanVerificationValidity(2880)).toBe('2 dias');
  });

  it('fala em horas quando o prazo é de horas', () => {
    expect(humanVerificationValidity(60)).toBe('1 hora');
    expect(humanVerificationValidity(120)).toBe('2 horas');
  });

  it('cai em minutos quando não dá horas certas', () => {
    expect(humanVerificationValidity(90)).toBe('90 minutos');
    expect(humanVerificationValidity(1)).toBe('1 minuto');
  });

  it('diz "24 horas" e não "1 dia" para o prazo de um dia', () => {
    // 1440 é divisível por 1440 **e** por 60. A ordem dos ramos decide o resultado, e um
    // prazo de um dia lê-se melhor em horas. É uma decisão, e fica afirmada.
    expect(humanVerificationValidity(1440)).toBe('24 horas');
  });
});

describe('tradução dos erros do link', () => {
  it('colapsa os quatro motivos de recusa na mesma mensagem', () => {
    /*
     * O servidor responde igual aos quatro casos. Aqui força-se a mensagem da API a
     * **variar** de propósito, para provar que é o ecrã — e não só o servidor — que colapsa
     * os motivos: se alguém um dia fizer a tradução passar a mensagem da API adiante, este
     * teste fica vermelho.
     */
    const motivosDaApi = [
      'Token inválido.',
      'Token expirado.',
      'Token já utilizado.',
      'Este token não serve para confirmar email.',
    ];

    const mensagens = motivosDaApi.map(
      (message) =>
        translateVerifyEmailError(new ApiError({ code: 'unauthorized', message, status: 401 }))
          .message,
    );

    expect(new Set(mensagens).size).toBe(1);
    expect(mensagens[0]).toBe(VERIFICATION_LINK_REJECTED);
  });

  it('não repete a mensagem da API para um 401', () => {
    const traduzido = translateVerifyEmailError(
      new ApiError({ code: 'unauthorized', message: 'Este link de confirmação já não é válido.', status: 401 }),
    );
    // A mensagem tem de ser a nossa, escrita para este contexto — não a genérica da API.
    expect(traduzido.message).toBe(VERIFICATION_LINK_REJECTED);
    expect(traduzido.requestId).toBeNull();
  });

  it('preserva o requestId quando a API o devolve', () => {
    const traduzido = translateVerifyEmailError(
      new ApiError({ code: 'unauthorized', message: 'x', status: 401, requestId: 'req-123' }),
    );
    // O requestId serve para o utilizador reportar o problema; perder o motivo é
    // deliberado, perder o rasto não é.
    expect(traduzido.requestId).toBe('req-123');
  });

  it('trata a falha de rede como problema de ligação, não como link inválido', () => {
    // A ação do utilizador é diferente: "verifica a ligação" em vez de "pede um link novo".
    const semRede = translateVerifyEmailError(
      new ApiError({ code: 'network_error', message: 'Falha de rede.', status: 0 }),
    );
    expect(semRede.message).not.toBe(VERIFICATION_LINK_REJECTED);
    expect(semRede.message).toContain('ligação');
    expect(semRede.requestId).toBeNull();
  });

  it('trata o limite de tentativas como limite, não como link inválido', () => {
    const limitado = translateVerifyEmailError(
      new ApiError({ code: 'rate_limited', message: 'Demasiados pedidos.', status: 429 }),
    );
    expect(limitado.message).not.toBe(VERIFICATION_LINK_REJECTED);
    expect(limitado.message).toContain('Demasiadas tentativas');
  });

  it('trata um token truncado como link inválido', () => {
    // Um token curto demais é, para quem o abriu, um link partido pelo cliente de correio:
    // mesma frase e mesma saída do que um token recusado.
    const truncado = translateVerifyEmailError(
      new ApiError({
        code: 'validation_error',
        message: 'Dados inválidos.',
        status: 400,
        fields: [{ path: 'token', message: 'Demasiado curto.' }],
      }),
    );
    expect(truncado.message).toBe(VERIFICATION_LINK_REJECTED);
  });

  it('deixa passar um erro de validação que não é do token', () => {
    const outro = translateVerifyEmailError(
      new ApiError({
        code: 'validation_error',
        message: 'Dados inválidos.',
        status: 400,
        fields: [{ path: 'email', message: 'Endereço inválido.' }],
      }),
    );
    expect(outro.message).toBe('Dados inválidos.');
  });

  it('não rebenta com um erro que não vem da API', () => {
    const traduzido = translateVerifyEmailError(new TypeError('boom'));
    expect(traduzido.message).toContain('Não foi possível confirmar');
    expect(traduzido.requestId).toBeNull();
  });
});
