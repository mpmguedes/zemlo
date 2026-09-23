import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSessionResponse, UserProfile } from '@zemlo/shared';
import {
  ApiError,
  api,
  auth,
  clearTokens,
  getAccessToken,
  getRefreshToken,
  onSessionExpired,
} from '../src/api/client';

/**
 * O ciclo de sessão da web: guardar o token de renovação, usá-lo, rodá-lo, e acabar a
 * sessão quando ele já não serve.
 *
 * ## O que estava errado (medido, não deduzido)
 *
 * `auth.login` chamava `setTokens(session.tokens, session.refreshToken ?? null)`. O
 * `session.refreshToken` **não existe**: a API devolve o token em `tokens.refreshToken`
 * (decisão A23, `packages/shared/src/types.ts:127`). Como o segundo argumento era sempre
 * `null` e `setTokens` só escrevia quando ele era verdadeiro, o `localStorage` **nunca**
 * recebia o token de renovação:
 *
 *   - `getRefreshToken()` devolvia sempre `null`;
 *   - `refreshAccessToken()` devolvia `false` à primeira linha, sem fazer pedido nenhum;
 *   - a sessão durava uma hora (o token de acesso) em vez dos 90 dias configurados.
 *
 * É o **mesmo defeito** que a A23 corrigiu do lado do servidor — e que, segundo a própria
 * A23, foi encontrado *pela aplicação web*. O cliente que descobriu o defeito do servidor
 * reproduziu-o do seu lado, com o mesmo erro de leitura de contrato.
 *
 * ## Porque é que o fixture de sessão tem exatamente a forma da API
 *
 * `session()` **não** tem `refreshToken` no topo, de propósito. Se tivesse, os testes
 * passariam com o código avariado — porque o código avariado lê precisamente esse campo.
 * O primeiro teste deste ficheiro guarda essa forma, para que ninguém "arranje" o fixture
 * acrescentando-lhe o campo que a API não envia.
 *
 * ## Porque é que se intercepta o `fetch` e não o `api`
 *
 * A renovação vive dentro do cliente HTTP. Substituir o `api` testaria uma simulação do
 * cliente, não o cliente: o que interessa aqui é o que **sai para a rede** (que pedidos, em
 * que ordem, com que token no cabeçalho) e o que fica em armazenamento.
 */

/* -------------------------------------------------------------------------- */
/* Dublês                                                                      */
/* -------------------------------------------------------------------------- */

interface Call {
  url: string;
  method: string;
  authorization: string | null;
  body: unknown;
}

let calls: Call[] = [];

function stubFetch(handler: (call: Call) => Response): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const call: Call = {
        url: String(input),
        method: init?.method ?? 'GET',
        authorization: headers.get('Authorization'),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
      };
      calls.push(call);
      return handler(call);
    }),
  );
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const unauthorized = (): Response =>
  json({ error: { code: 'unauthorized', message: 'A tua sessão terminou.' } }, 401);

const refreshCalls = (): Call[] => calls.filter((call) => call.url.includes('/auth/refresh'));
const callsTo = (suffix: string): Call[] => calls.filter((call) => call.url.endsWith(suffix));

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

/* -------------------------------------------------------------------------- */
/* Fixtures — a forma exata do que a API devolve                               */
/* -------------------------------------------------------------------------- */

/**
 * Modelo mínimo do servidor para os testes de renovação.
 *
 * Faz duas coisas que um dublê ingénuo não faz, e sem as quais os testes de rotação passam
 * por acidente:
 *
 *  1. aceita **apenas** o token de acesso que emitiu por último — é o que um token expirado
 *     significa, e é `expira()` que o provoca a pedido do teste;
 *  2. **recusa um token de renovação já usado** (é a rotação da A23). Sem isto, um cliente
 *     que reenviasse o token antigo receberia uma sessão nova e o defeito da rotação perdida
 *     ficaria invisível.
 */
function servidorComRotacao(inicial: AuthSessionResponse) {
  const seguintes = new Map<string, AuthSessionResponse>();
  const usados = new Set<string>();
  let acessoAceite = inicial.tokens.accessToken;

  return {
    /** A sessão que o servidor emite quando recebe o token de renovação `de`. */
    roda(de: string, para: AuthSessionResponse): void {
      seguintes.set(de, para);
    },
    /** Simula a passagem do tempo: o token de acesso deixou de ser aceite. */
    expira(): void {
      acessoAceite = 'expirado';
    },
    responde(call: Call): Response {
      if (call.url.endsWith(LOGIN)) return json(inicial);
      if (call.url.endsWith(REFRESH)) {
        const enviado = (call.body as { refreshToken?: string } | null)?.refreshToken ?? '';
        if (usados.has(enviado)) return unauthorized();
        const proxima = seguintes.get(enviado);
        if (!proxima) return unauthorized();
        usados.add(enviado);
        acessoAceite = proxima.tokens.accessToken;
        return json(proxima);
      }
      return call.authorization === `Bearer ${acessoAceite}` ? json({ ok: true }) : unauthorized();
    },
  };
}

const PROFILE: UserProfile = {
  id: 'usr_1',
  email: 'ana@exemplo.pt',
  name: 'Ana',
  locale: 'pt-PT',
  timeZone: 'Europe/Lisbon',
  distanceUnit: 'km',
  volumeUnit: 'l',
  currency: 'EUR',
  emailVerified: true,
  twoFactorEnabled: false,
  createdAt: '2026-01-04T09:00:00.000Z',
  counts: { vehicles: 1, expenses: 2, documents: 0, integrations: 0 },
  onboarding: {
    hasVehicle: true,
    hasOdometer: true,
    hasInsurance: false,
    hasInspection: false,
    hasMaintenancePlan: false,
    complete: false,
  },
};

/** Resposta de `/auth/login`, `/auth/signup` e `/auth/refresh` — sem token no topo. */
function session(accessToken: string, refreshToken: string): AuthSessionResponse {
  return {
    user: PROFILE,
    tokens: { accessToken, expiresIn: 3600, tokenType: 'Bearer', refreshToken },
  };
}

const LOGIN = '/auth/login';
const REFRESH = '/auth/refresh';
const LOGOUT = '/auth/logout';

beforeEach(() => {
  calls = [];
  vi.stubGlobal('localStorage', fakeStorage());
  vi.stubGlobal('sessionStorage', fakeStorage());
  // Repor o estado do módulo: `accessTokenMemory` e o handler de sessão expirada são
  // singletons e sobreviveriam de um teste para o outro.
  clearTokens();
  onSessionExpired(null);
});

afterEach(() => {
  onSessionExpired(null);
  clearTokens();
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* A forma do contrato                                                         */
/* -------------------------------------------------------------------------- */

describe('a forma da resposta da API', () => {
  it('tem o token de renovação dentro de `tokens`, e nada no topo', () => {
    /*
     * Esta asserção não testa o cliente: guarda o fixture. O defeito existiu porque o
     * cliente leu `session.refreshToken` — um campo que a API nunca envia. Se alguém
     * acrescentar esse campo aqui para "fazer os testes passar", este teste fica vermelho
     * e obriga a olhar para a causa.
     */
    expect(Object.keys(session('a', 'r')).sort()).toEqual(['tokens', 'user']);
    expect(Object.keys(session('a', 'r').tokens).sort()).toEqual([
      'accessToken',
      'expiresIn',
      'refreshToken',
      'tokenType',
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* Guardar o token                                                             */
/* -------------------------------------------------------------------------- */

describe('guardar o token de renovação', () => {
  it('o início de sessão grava em armazenamento o token que veio em `tokens.refreshToken`', async () => {
    stubFetch(() => json(session('access-1', 'refresh-1')));

    await auth.login('ana@exemplo.pt', 'segredo');

    // Sem esta linha, a renovação silenciosa é impossível: é o defeito de `WEB-013`.
    expect(localStorage.getItem('zemlo.refreshToken')).toBe('refresh-1');
    expect(getRefreshToken()).toBe('refresh-1');
  });

  it('o registo grava o token da mesma forma que o início de sessão', async () => {
    stubFetch(() => json(session('access-9', 'refresh-9')));

    await auth.signup({
      email: 'ana@exemplo.pt',
      password: 'segredo-forte',
      acceptedTerms: true,
    });

    expect(getRefreshToken()).toBe('refresh-9');
  });

  it('o token de acesso fica em memória e em `sessionStorage`, não em `localStorage`', async () => {
    stubFetch(() => json(session('access-1', 'refresh-1')));

    await auth.login('ana@exemplo.pt', 'segredo');

    expect(getAccessToken()).toBe('access-1');
    expect(sessionStorage.getItem('zemlo.accessToken')).toBe('access-1');
    // O token de acesso vale uma hora: guardá-lo onde sobrevive ao separador seria dar-lhe
    // a vida do token de renovação, que é outra coisa.
    expect(localStorage.getItem('zemlo.accessToken')).toBeNull();
  });

  it('o valor devolvido ao ecrã não contém o token de renovação', async () => {
    stubFetch(() => json(session('access-1', 'refresh-1')));

    const devolvido = await auth.login('ana@exemplo.pt', 'segredo');

    // O ecrã só precisa do perfil; o segredo de 90 dias fica dentro do cliente. Devolver a
    // sessão inteira punha-o ao alcance de qualquer componente e de qualquer `console.log`.
    expect(Object.keys(devolvido)).not.toContain('tokens');
    expect(Object.keys(devolvido)).not.toContain('refreshToken');
    expect(JSON.stringify(devolvido)).not.toContain('refresh-1');
  });
});

/* -------------------------------------------------------------------------- */
/* Usar o token — o caminho normal                                             */
/* -------------------------------------------------------------------------- */

describe('com o token de acesso ainda válido', () => {
  it('não pede renovação e envia o token no cabeçalho', async () => {
    stubFetch((call) => (call.url.endsWith(LOGIN) ? json(session('access-1', 'refresh-1')) : json({ ok: true })));

    await auth.login('ana@exemplo.pt', 'segredo');
    // Precondição afirmada, e não assumida: sem token de renovação guardado, "não renovou"
    // seria verdade por não haver o que renovar — e o teste passaria com o código avariado.
    expect(getRefreshToken()).toBe('refresh-1');

    const resposta = await api.get<{ ok: boolean }>('/vehicles');

    expect(resposta.ok).toBe(true);
    expect(refreshCalls()).toHaveLength(0);
    const pedido = callsTo('/vehicles');
    expect(pedido).toHaveLength(1);
    expect(pedido[0]?.authorization).toBe('Bearer access-1');
  });
});

/* -------------------------------------------------------------------------- */
/* Renovar                                                                     */
/* -------------------------------------------------------------------------- */

describe('quando o token de acesso expira', () => {
  it('um 401 provoca uma renovação e repete o pedido com o token novo', async () => {
    stubFetch((call) => {
      if (call.url.endsWith(LOGIN)) return json(session('access-1', 'refresh-1'));
      if (call.url.endsWith(REFRESH)) return json(session('access-2', 'refresh-2'));
      if (call.url.endsWith('/vehicles')) {
        return call.authorization === 'Bearer access-2' ? json({ ok: true }) : unauthorized();
      }
      throw new Error(`Pedido não previsto: ${call.method} ${call.url}`);
    });

    await auth.login('ana@exemplo.pt', 'segredo');
    const resposta = await api.get<{ ok: boolean }>('/vehicles');

    expect(resposta.ok).toBe(true);
    expect(refreshCalls()).toHaveLength(1);
    // O pedido de renovação leva o token que estava guardado — não um campo inexistente.
    expect(refreshCalls()[0]?.body).toEqual({ refreshToken: 'refresh-1' });
    const tentativas = callsTo('/vehicles');
    expect(tentativas).toHaveLength(2);
    expect(tentativas[0]?.authorization).toBe('Bearer access-1');
    expect(tentativas[1]?.authorization).toBe('Bearer access-2');
  });

  it('o token rodado substitui o anterior, e a renovação seguinte usa o mais recente', async () => {
    /*
     * A rotação é a defesa da A23: um token copiado serve no máximo uma vez. Se o cliente
     * guardar o token **antigo** depois de renovar, a segunda renovação falha — e a sessão
     * cai uma hora depois de ter sido renovada com sucesso. É por isso que este teste faz
     * **duas** renovações: uma só não distinguiria "guardou o novo" de "não guardou nada".
     *
     * O servidor recusa um token já rodado, pelo que reenviar o antigo não devolve uma
     * sessão nova: termina a sessão e o teste falha. É a diferença entre provar a rotação e
     * provar que houve duas chamadas.
     */
    const servidor = servidorComRotacao(session('access-1', 'refresh-1'));
    servidor.roda('refresh-1', session('access-2', 'refresh-2'));
    servidor.roda('refresh-2', session('access-3', 'refresh-3'));
    stubFetch((call) => servidor.responde(call));

    await auth.login('ana@exemplo.pt', 'segredo');

    servidor.expira();
    await api.get<{ ok: boolean }>('/vehicles');
    expect(getRefreshToken()).toBe('refresh-2');

    servidor.expira();
    await api.get<{ ok: boolean }>('/vehicles');
    expect(getRefreshToken()).toBe('refresh-3');

    expect(refreshCalls().map((call) => (call.body as { refreshToken: string }).refreshToken)).toEqual([
      'refresh-1',
      'refresh-2',
    ]);
  });

  it('dois pedidos que recebem 401 ao mesmo tempo fazem uma só renovação', async () => {
    /*
     * Sem renovação única, os dois pedidos renovariam em paralelo; como a API roda o token,
     * a segunda renovação invalidaria a primeira e o utilizador era expulso sem motivo.
     * O que se afirma não é só "houve uma renovação" — é que **os dois pedidos acabaram bem**,
     * porque uma renovação partilhada que deixasse um deles pendurado não valia nada.
     */
    stubFetch((call) => {
      if (call.url.endsWith(LOGIN)) return json(session('access-1', 'refresh-1'));
      if (call.url.endsWith(REFRESH)) return json(session('access-2', 'refresh-2'));
      return call.authorization === 'Bearer access-2' ? json({ ok: true }) : unauthorized();
    });

    await auth.login('ana@exemplo.pt', 'segredo');

    const [primeiro, segundo] = await Promise.all([
      api.get<{ ok: boolean }>('/vehicles'),
      api.get<{ ok: boolean }>('/expenses'),
    ]);

    expect(primeiro.ok).toBe(true);
    expect(segundo.ok).toBe(true);
    expect(refreshCalls()).toHaveLength(1);
    expect(refreshCalls()[0]?.body).toEqual({ refreshToken: 'refresh-1' });
    expect(callsTo('/vehicles')).toHaveLength(2);
    expect(callsTo('/expenses')).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Terminar a sessão                                                           */
/* -------------------------------------------------------------------------- */

describe('quando a renovação falha', () => {
  it('um refresh recusado termina a sessão, limpa os tokens e avisa a aplicação', async () => {
    stubFetch((call) => {
      if (call.url.endsWith(LOGIN)) return json(session('access-1', 'refresh-1'));
      if (call.url.endsWith(REFRESH)) return unauthorized();
      return unauthorized();
    });

    const expirou = vi.fn();
    onSessionExpired(expirou);

    await auth.login('ana@exemplo.pt', 'segredo');
    await expect(api.get('/vehicles')).rejects.toBeInstanceOf(ApiError);

    expect(expirou).toHaveBeenCalledTimes(1);
    expect(getRefreshToken()).toBeNull();
    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem('zemlo.refreshToken')).toBeNull();
    // Uma tentativa de renovação e **uma** tentativa do pedido: quando a renovação falha não
    // há token novo, pelo que repetir o pedido só somaria um 401. Repetir é para o caso em
    // que a renovação correu bem.
    expect(refreshCalls()).toHaveLength(1);
    expect(callsTo('/vehicles')).toHaveLength(1);
  });

  it('uma falha de rede na renovação também termina a sessão, sem repetir', async () => {
    stubFetch((call) => {
      if (call.url.endsWith(LOGIN)) return json(session('access-1', 'refresh-1'));
      // A rede falha **na renovação**; o pedido original recebeu um 401 normal.
      if (call.url.endsWith(REFRESH)) throw new TypeError('Failed to fetch');
      return unauthorized();
    });

    const expirou = vi.fn();
    onSessionExpired(expirou);

    await auth.login('ana@exemplo.pt', 'segredo');
    await expect(api.get('/vehicles')).rejects.toBeInstanceOf(ApiError);

    expect(expirou).toHaveBeenCalledTimes(1);
    expect(getRefreshToken()).toBeNull();
    expect(refreshCalls()).toHaveLength(1);
    expect(callsTo('/vehicles')).toHaveLength(1);
  });

  it('sem token de renovação guardado, um 401 não tenta renovar', async () => {
    stubFetch(() => unauthorized());

    const expirou = vi.fn();
    onSessionExpired(expirou);

    /*
     * Precondição afirmada: este teste descreve o caso "não há o que renovar" (sessão
     * antiga, armazenamento limpo pelo browser, sessão só em memória). Sem a linha
     * seguinte, o teste passaria também com o código avariado — onde o token nunca chega a
     * ser guardado — e estaria a medir o defeito em vez da regra.
     */
    expect(getRefreshToken()).toBeNull();

    await expect(api.get('/vehicles')).rejects.toBeInstanceOf(ApiError);

    // Não há o que renovar: pedir ao servidor um token que não temos seria ruído.
    expect(refreshCalls()).toHaveLength(0);
    expect(expirou).toHaveBeenCalledTimes(1);
  });

  it('um 401 depois de renovar não entra em ciclo', async () => {
    /*
     * Depois de renovar com sucesso, o pedido é repetido **uma** vez. Se o servidor voltar a
     * responder 401, isso é o recurso a recusar — não a sessão a terminar — e a resposta
     * sobe como erro. O que este teste fixa é o limite: uma renovação, duas tentativas, e
     * nada mais. Sem ele, uma repetição recursiva passaria despercebida até bloquear o browser.
     */
    stubFetch((call) => {
      if (call.url.endsWith(LOGIN)) return json(session('access-1', 'refresh-1'));
      if (call.url.endsWith(REFRESH)) return json(session('access-2', 'refresh-2'));
      return unauthorized();
    });

    await auth.login('ana@exemplo.pt', 'segredo');
    await expect(api.get('/vehicles')).rejects.toBeInstanceOf(ApiError);

    expect(refreshCalls()).toHaveLength(1);
    expect(callsTo('/vehicles')).toHaveLength(2);
    // A renovação provou que a sessão está viva: um 401 a seguir é do recurso, não da
    // sessão. Apagar os tokens aqui expulsaria alguém que acabou de provar que tem sessão.
    expect(getRefreshToken()).toBe('refresh-2');
  });
});

/* -------------------------------------------------------------------------- */
/* Resposta de renovação fora do contrato                                      */
/* -------------------------------------------------------------------------- */

describe('quando a renovação devolve uma resposta fora do contrato', () => {
  it('não grava a string "undefined" nem apaga o token que já existia', async () => {
    /*
     * `tokens.refreshToken` é obrigatório no tipo, mas o tipo não corre em produção. Se o
     * campo faltar, escrever o valor à letra guardaria `"undefined"` — uma cadeia que o
     * servidor recusaria e que, em `localStorage`, parece um token a sério. O token antigo
     * mantém-se: a renovação trouxe um token de acesso válido, e apagar o de renovação
     * seria destruir uma sessão que ainda está viva.
     */
    stubFetch((call) => {
      if (call.url.endsWith(LOGIN)) return json(session('access-1', 'refresh-1'));
      if (call.url.endsWith(REFRESH)) {
        return json({ user: PROFILE, tokens: { accessToken: 'access-2', expiresIn: 3600, tokenType: 'Bearer' } });
      }
      // O pedido original só passa depois de renovar — senão a renovação nem chegava a
      // acontecer e este teste estaria a afirmar coisas sobre um caminho que não correu.
      return call.authorization === 'Bearer access-2' ? json({ ok: true }) : unauthorized();
    });

    await auth.login('ana@exemplo.pt', 'segredo');
    expect(getRefreshToken()).toBe('refresh-1');

    const resposta = await api.get<{ ok: boolean }>('/vehicles');

    expect(resposta.ok).toBe(true);
    expect(refreshCalls()).toHaveLength(1);
    // A renovação correu e não trouxe token novo: o que já estava não é tocado.
    expect(getRefreshToken()).toBe('refresh-1');
    expect(localStorage.getItem('zemlo.refreshToken')).not.toBe('undefined');
    // O token de acesso, esse, foi atualizado: é o que permite repetir o pedido.
    expect(getAccessToken()).toBe('access-2');
  });
});

/* -------------------------------------------------------------------------- */
/* Entrar e sair                                                               */
/* -------------------------------------------------------------------------- */

describe('entrar e sair', () => {
  it('depois de entrar, o perfil continua a ser pedido com o token de acesso', async () => {
    stubFetch((call) => {
      if (call.url.endsWith(LOGIN)) return json(session('access-1', 'refresh-1'));
      return json(PROFILE);
    });

    const perfil = await auth.login('ana@exemplo.pt', 'segredo');
    expect(perfil.id).toBe('usr_1');

    const eu = await auth.me();
    expect(eu.email).toBe('ana@exemplo.pt');
    expect(callsTo('/me')[0]?.authorization).toBe('Bearer access-1');
  });

  it('sair limpa os tokens e o pedido de saída é feito antes', async () => {
    stubFetch((call) => (call.url.endsWith(LOGIN) ? json(session('access-1', 'refresh-1')) : new Response(null, { status: 204 })));

    await auth.login('ana@exemplo.pt', 'segredo');
    // Sem esta precondição, "ficou sem tokens" seria verdade por nunca ter havido nenhum.
    expect(getRefreshToken()).toBe('refresh-1');

    await auth.logout();

    const saiu = callsTo(LOGOUT);
    expect(saiu).toHaveLength(1);
    // O pedido de saída ainda leva o token: sem ele o servidor não sabe que sessão revogar.
    expect(saiu[0]?.authorization).toBe('Bearer access-1');
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it('sair limpa os tokens mesmo quando o servidor falha', async () => {
    stubFetch((call) => {
      if (call.url.endsWith(LOGIN)) return json(session('access-1', 'refresh-1'));
      return json({ error: { code: 'internal_error', message: 'Falhou.' } }, 500);
    });

    await auth.login('ana@exemplo.pt', 'segredo');
    expect(getRefreshToken()).toBe('refresh-1');

    await expect(auth.logout()).rejects.toBeInstanceOf(ApiError);

    // Manter um token válido depois de o utilizador pedir para sair seria mentir-lhe.
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });
});
