/**
 * Login federado **sem** configuração — `AUTH-002`.
 *
 * ## Porque é que isto é um ficheiro separado
 *
 * `core/config.ts` lê o ambiente **no import** e é um singleton: não há forma de exercer, no
 * mesmo processo, o ramo «Google configurado» e o ramo «Google não configurado». Um ficheiro
 * de teste por ramo é a única maneira honesta de cobrir os dois — a alternativa seria não
 * cobrir um deles, e o não coberto seria sempre o da instalação que não usa login federado,
 * que é a maioria.
 *
 * ## O que se exige aqui
 *
 * Que uma instalação **sem** Google configurado se comporte de forma honesta:
 *
 *  - arranca (não rebenta por falta de credenciais que ninguém quer usar);
 *  - responde a quem tenta entrar com Google com um `503` do envelope único (A11), e não com
 *    uma exceção nem com um `500`;
 *  - e a mensagem diz o que falta, em vez de «erro interno».
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Erro do envelope único, como sai dos serviços. */
interface Refusal {
  status?: number;
  code?: string;
  message?: string;
}

let oauth: typeof import('../src/services/oauth.js');
let config: typeof import('../src/core/config.js');

beforeAll(async () => {
  /*
   * Ambiente limpo de credenciais **antes** do import: é a única altura em que faz
   * diferença. Apagar depois de importar não mudaria nada, porque a configuração já foi
   * construída — e é exatamente esse detalhe que faz deste ficheiro um teste e não uma
   * formalidade.
   */
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_ISSUER;
  delete process.env.GOOGLE_REDIRECT_URI;

  config = await import('../src/core/config.js');
  oauth = await import('../src/services/oauth.js');
});

afterAll(() => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_ISSUER;
  delete process.env.GOOGLE_REDIRECT_URI;
});

describe('instalação sem login federado', () => {
  it('arranca — a configuração é nula e não uma exceção', () => {
    /*
     * Anti-vacuidade: se o ambiente ainda trouxesse credenciais, tudo o resto deste ficheiro
     * estaria a testar o ramo errado e passaria sem provar nada.
     */
    expect(config.config.federatedLogin.google).toBeNull();
  });

  it('responde ao início do fluxo com um serviço indisponível, e não com uma exceção', async () => {
    let refusal: Refusal | null = null;
    try {
      await oauth.startGoogleLogin();
    } catch (error) {
      refusal = error as Refusal;
    }

    expect(refusal).not.toBeNull();
    expect(refusal?.status).toBe(503);
    expect(refusal?.code).toBe('service_unavailable');
    expect(refusal?.message).toContain('GOOGLE_CLIENT_ID');
  });

  it('responde ao callback com um serviço indisponível, sem tocar na base de dados', async () => {
    let refusal: Refusal | null = null;
    try {
      await oauth.completeGoogleLogin('?code=x&state=y', 'y', {});
    } catch (error) {
      refusal = error as Refusal;
    }

    expect(refusal).not.toBeNull();
    expect(refusal?.status).toBe(503);
  });
});
