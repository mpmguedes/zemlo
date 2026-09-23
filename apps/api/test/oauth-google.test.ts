/**
 * Login federado com Google — `AUTH-002`.
 *
 * ## O que estes testes provam, e porque não podiam ser mais simples
 *
 * Cada validação que o `openid-client` faz por nós tem aqui um teste que exige uma
 * **recusa**: assinatura de outra chave, `iss` errado, `aud` errado, token expirado,
 * `nonce` errado. São testes que só fazem sentido contra um emissor a sério, com chaves a
 * sério — e é por isso que este ficheiro levanta um fornecedor OIDC próprio
 * (`helpers/oidc-provider.ts`), como `password-reset-integration.test.ts` levanta um
 * servidor SMTP real.
 *
 * As validações que são **nossas** — `state` de uso único, ligação ao browser, recusa de
 * associação implícita, recusa de email não verificado — têm teste próprio e não dependem da
 * biblioteca.
 *
 * ## Porque é que o `import` é dinâmico
 *
 * `core/config.ts` lê o ambiente **no import** (`override: false`), e `core/db.ts` constrói o
 * cliente Prisma a partir dessa configuração. Como o emissor falso só sabe o seu endereço
 * depois de estar a escutar, a configuração tem de ser escrita **antes** de o módulo ser
 * carregado. Daí a `beforeAll` que levanta o emissor e a base de dados primeiro e só depois
 * faz `import()`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, createUser, type TestDb } from './helpers/db.js';
import { startOidcProvider, type IdTokenFault, type OidcProvider } from './helpers/oidc-provider.js';

/** Contador de códigos, para que dois fluxos do mesmo teste nunca partilhem um `code`. */
let codeCounter = 0;

let provider: OidcProvider;
let db: TestDb;
let oauth: typeof import('../src/services/oauth.js');

/** Erro do envelope único, como sai dos serviços. */
interface Refusal {
  status?: number;
  code?: string;
  message?: string;
}

/** Inicia um fluxo e devolve as peças que o emissor e o callback precisam. */
async function beginFlow(): Promise<{
  state: string;
  nonce: string;
  codeChallenge: string;
  authorizationUrl: URL;
}> {
  const start = await oauth.startGoogleLogin();
  const authorizationUrl = new URL(start.authorizationUrl);

  return {
    state: authorizationUrl.searchParams.get('state') as string,
    nonce: authorizationUrl.searchParams.get('nonce') as string,
    codeChallenge: authorizationUrl.searchParams.get('code_challenge') as string,
    authorizationUrl,
  };
}

/** Regista no emissor o que ele deve devolver para um `code`. */
function authorize(
  flow: { nonce: string; codeChallenge: string },
  code: string,
  extra: { nonce?: string | null; claims?: Record<string, unknown>; fault?: IdTokenFault } = {},
): void {
  provider.expectAuthorization({
    code,
    nonce: extra.nonce === undefined ? flow.nonce : extra.nonce,
    codeChallenge: flow.codeChallenge,
    ...(extra.claims === undefined ? {} : { claims: extra.claims }),
    ...(extra.fault === undefined ? {} : { fault: extra.fault }),
  });
}

/** Chama o callback com a query e o cookie dados. */
async function callback(
  code: string,
  state: string | null,
  cookie: string | null,
): Promise<unknown> {
  const query = state === null
    ? `?code=${encodeURIComponent(code)}`
    : `?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;

  return oauth.completeGoogleLogin(query, cookie, {
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
  });
}

/** Exige que a promessa seja recusada, e devolve o erro para se poder inspecionar. */
async function refusalFrom(promise: Promise<unknown>): Promise<Refusal> {
  try {
    await promise;
  } catch (error) {
    return error as Refusal;
  }
  throw new Error('Esperava uma recusa, e o fluxo foi aceite.');
}

/** Corre um fluxo completo de ponta a ponta, com os parâmetros pedidos. */
async function happyFlow(
  extra: { claims?: Record<string, unknown>; fault?: IdTokenFault } = {},
): Promise<Awaited<ReturnType<typeof oauth.completeGoogleLogin>>> {
  const flow = await beginFlow();
  const code = `code-${++codeCounter}`;
  authorize(flow, code, extra);
  return oauth.completeGoogleLogin(
    `?code=${code}&state=${encodeURIComponent(flow.state)}`,
    flow.state,
    { ipAddress: '127.0.0.1', userAgent: 'vitest' },
  ) as Promise<Awaited<ReturnType<typeof oauth.completeGoogleLogin>>>;
}

/** Captura tudo o que for escrito no `stdout` e no `stderr` durante `run`. */
async function captureLogs(run: () => Promise<unknown>): Promise<string> {
  const written: string[] = [];
  const stdout = process.stdout.write.bind(process.stdout);
  const stderr = process.stderr.write.bind(process.stderr);

  process.stdout.write = ((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;

  try {
    await run();
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
  }

  return written.join('');
}

beforeAll(async () => {
  provider = await startOidcProvider();

  /*
   * A base de dados é criada e a configuração é escrita **antes** dos imports: os dois
   * módulos leem o ambiente no carregamento, e uma ordem trocada faria o serviço apontar
   * para a base de dados de desenvolvimento e para um emissor que não existe.
   */
  db = await createTestDb();
  process.env.DATABASE_URL = db.url;
  process.env.GOOGLE_CLIENT_ID = provider.clientId;
  process.env.GOOGLE_CLIENT_SECRET = provider.clientSecret;
  process.env.GOOGLE_ISSUER = provider.issuer;
  process.env.GOOGLE_REDIRECT_URI = provider.redirectUri;

  oauth = await import('../src/services/oauth.js');
}, 60_000);

afterAll(async () => {
  /*
   * O cliente **singleton** de `core/db.ts` também tem o ficheiro aberto — é ele que o
   * serviço usa. Sem o desligar primeiro, a remoção do diretório temporário falha com
   * `EBUSY` no Windows: o teste passa, mas deixa lixo em disco e o erro aparece como falha
   * de suíte, que é a pior das duas coisas.
   */
  const { prisma } = await import('../src/core/db.js');
  await prisma.$disconnect();

  await db.destroy();
  await provider.close();
});

beforeEach(async () => {
  await db.prisma.user.deleteMany();
  provider.tokenRequests.length = 0;
});

describe('início do fluxo', () => {
  it('leva o browser ao emissor com os parâmetros que o protocolo exige', async () => {
    const flow = await beginFlow();

    expect(flow.authorizationUrl.origin).toBe(provider.issuer);
    expect(flow.authorizationUrl.pathname).toBe('/authorize');

    const parameters = flow.authorizationUrl.searchParams;
    expect(parameters.get('client_id')).toBe(provider.clientId);
    expect(parameters.get('response_type')).toBe('code');
    expect(parameters.get('code_challenge_method')).toBe('S256');
    expect(parameters.get('scope')).toContain('openid');
    expect(parameters.get('scope')).toContain('email');
    expect(parameters.get('state')).toBeTruthy();
    expect(parameters.get('nonce')).toBeTruthy();
    expect(parameters.get('code_challenge')).toBeTruthy();
  });

  it('usa exatamente o endereço de retorno configurado, e não um derivado do pedido', async () => {
    const flow = await beginFlow();
    expect(flow.authorizationUrl.searchParams.get('redirect_uri')).toBe(provider.redirectUri);
  });

  it('nunca repete o `state` nem o `nonce`', async () => {
    const first = await beginFlow();
    const second = await beginFlow();

    expect(second.state).not.toBe(first.state);
    expect(second.nonce).not.toBe(first.nonce);
  });
});

describe('caminho feliz', () => {
  it('cria a conta e devolve uma sessão completa', async () => {
    const session = await happyFlow();

    expect(session.user.email).toBe('condutor@zemlo.test');
    expect(session.tokens.accessToken).toBeTruthy();
    expect(session.tokens.refreshToken).toBeTruthy();
    expect(session.tokens.expiresIn).toBeGreaterThan(0);

    const account = await db.prisma.user.findUnique({
      where: { email: 'condutor@zemlo.test' },
      select: {
        authProvider: true,
        authProviderId: true,
        emailVerified: true,
        passwordHash: true,
        name: true,
        acceptedTermsAt: true,
      },
    });

    expect(account?.authProvider).toBe('google');
    expect(account?.authProviderId).toBe('google-sub-1');
    /* A verificação herda da Google — não se pede ao utilizador que confirme o que já foi confirmado. */
    expect(account?.emailVerified).toBe(true);
    /* Uma conta federada não tem password. Guardar um hash vazio ou um valor qualquer seria pior. */
    expect(account?.passwordHash).toBeNull();
    expect(account?.name).toBe('Condutor de Teste');
    /*
     * `acceptedTermsAt` fica nulo de propósito: não houve ecrã nenhum a pedir a aceitação, e
     * gravar a data seria registar uma aceitação que nunca aconteceu. Ver `PC-28`.
     */
    expect(account?.acceptedTermsAt).toBeNull();
  });

  it('cria a sessão a sério, e não só uma resposta com tokens', async () => {
    const session = await happyFlow();

    const sessions = await db.prisma.session.findMany({
      where: { user: { email: 'condutor@zemlo.test' } },
      select: { id: true, deviceLabel: true, revokedAt: true, expiresAt: true },
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.deviceLabel).toBe('Entrada com Google');
    expect(sessions[0]?.revokedAt).toBeNull();
    expect(sessions[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    /* A sessão devolvida é a que ficou gravada — não duas sessões, uma delas órfã. */
    expect(session.user.id).toBeTruthy();
  });

  it('dá à conta as mesmas preferências por omissão que o registo por password', async () => {
    await happyFlow();

    const user = await db.prisma.user.findUniqueOrThrow({
      where: { email: 'condutor@zemlo.test' },
      select: { id: true },
    });

    const preferences = await db.prisma.userPreference.findUnique({ where: { userId: user.id } });
    expect(preferences?.reminderLeadDays).toBe(30);
    expect(preferences?.reminderLeadKm).toBe(1000);

    const notifications = await db.prisma.notificationPreference.findMany({
      where: { userId: user.id },
    });
    expect(notifications).toHaveLength(6);
  });

  it('entra na mesma conta quando a identidade Google já está associada', async () => {
    const first = await happyFlow();
    const second = await happyFlow();

    expect(second.user.id).toBe(first.user.id);
    expect(await db.prisma.user.count()).toBe(1);
  });

  it('consulta o JWKS do emissor — a assinatura é mesmo verificada', async () => {
    await happyFlow();

    /*
     * Sem esta consulta, o `openid-client` não tem chave nenhuma para comparar. As recusas
     * de `iss`, `aud`, `exp` e `nonce` continuariam a acontecer — são comparações de
     * valores — mas a assinatura não estaria a ser verificada, e nenhum desses testes o
     * notaria. É este teste que impede esse falso verde.
     */
    expect(provider.jwksRequests.count).toBeGreaterThan(0);
  });

  it('envia o `code_verifier` e o `redirect_uri` configurado ao token endpoint', async () => {
    await happyFlow();

    const request = provider.tokenRequests[0];
    expect(request?.grant_type).toBe('authorization_code');
    expect(request?.code_verifier).toBeTruthy();
    expect(request?.redirect_uri).toBe(provider.redirectUri);
    /*
     * O segredo de cliente vai no corpo (back-channel), e nunca no URL de autorização. Se
     * aparecesse no `authorizationUrl`, já estaria comprometido.
     */
    expect(request?.client_secret).toBe(provider.clientSecret);
  });
});

describe('recusas que são nossas', () => {
  it('recusa um callback sem `state`', async () => {
    const flow = await beginFlow();
    const code = `code-${++codeCounter}`;
    authorize(flow, code);

    const refusal = await refusalFrom(callback(code, null, flow.state));
    expect(refusal.status).toBe(400);
  });

  it('recusa um `state` desconhecido', async () => {
    const refusal = await refusalFrom(callback('code-qualquer', 'estado-que-nunca-existiu', 'estado-que-nunca-existiu'));
    expect(refusal.status).toBe(400);
  });

  it('recusa repetir um `state` já usado — é de uso único', async () => {
    const flow = await beginFlow();
    const code = `code-${++codeCounter}`;
    authorize(flow, code);

    const first = await callback(code, flow.state, flow.state);
    expect(first).toBeTruthy();

    /*
     * Segunda utilização do mesmo `state`. O `code` já foi trocado, mas o que se está a
     * testar aqui é o `state`: se ele continuasse no mapa, a repetição do callback passaria
     * a verificação e o fluxo seria reexecutável.
     */
    const second = await refusalFrom(callback(code, flow.state, flow.state));
    expect(second.status).toBe(400);
    expect(second.message).toContain('expirou ou já foi usado');
  });

  it('recusa quando o browser não traz a marca do fluxo', async () => {
    const flow = await beginFlow();
    const code = `code-${++codeCounter}`;
    authorize(flow, code);

    const refusal = await refusalFrom(callback(code, flow.state, null));
    expect(refusal.status).toBe(400);
    expect(refusal.message).toContain('não corresponde ao pedido feito neste browser');
  });

  it('recusa quando a marca do browser é de outro fluxo', async () => {
    const flow = await beginFlow();
    const other = await beginFlow();
    const code = `code-${++codeCounter}`;
    authorize(flow, code);

    const refusal = await refusalFrom(callback(code, flow.state, other.state));
    expect(refusal.status).toBe(400);
  });

  it('não cria conta nenhuma quando recusa — o `code` não chega a ser trocado', async () => {
    const flow = await beginFlow();
    const code = `code-${++codeCounter}`;
    authorize(flow, code);

    await refusalFrom(callback(code, flow.state, null));

    expect(await db.prisma.user.count()).toBe(0);
    /* Nem sequer se falou com o emissor: a recusa acontece antes da troca do código. */
    expect(provider.tokenRequests).toHaveLength(0);
  });
});

describe('recusas que vêm do emissor', () => {
  it('recusa um `id_token` assinado com outra chave', async () => {
    const flow = await beginFlow();
    const code = `code-${++codeCounter}`;
    authorize(flow, code, { fault: 'assinado-por-outra-chave' });

    const refusal = await refusalFrom(callback(code, flow.state, flow.state));
    expect(refusal.status).toBe(400);
    expect(await db.prisma.user.count()).toBe(0);
  });

  it('recusa um emissor diferente do configurado', async () => {
    const flow = await beginFlow();
    const code = `code-${++codeCounter}`;
    authorize(flow, code, { fault: 'emissor-errado' });

    const refusal = await refusalFrom(callback(code, flow.state, flow.state));
    expect(refusal.status).toBe(400);
  });

  it('recusa uma audiência que não é o nosso cliente', async () => {
    const flow = await beginFlow();
    const code = `code-${++codeCounter}`;
    authorize(flow, code, { fault: 'audiencia-errada' });

    const refusal = await refusalFrom(callback(code, flow.state, flow.state));
    expect(refusal.status).toBe(400);
  });

  it('recusa um `id_token` expirado', async () => {
    const flow = await beginFlow();
    const code = `code-${++codeCounter}`;
    authorize(flow, code, { fault: 'expirado' });

    const refusal = await refusalFrom(callback(code, flow.state, flow.state));
    expect(refusal.status).toBe(400);
  });

  it('recusa um `nonce` que não é o do fluxo', async () => {
    const flow = await beginFlow();
    const code = `code-${++codeCounter}`;
    authorize(flow, code, { nonce: 'nonce-de-outro-fluxo' });

    const refusal = await refusalFrom(callback(code, flow.state, flow.state));
    expect(refusal.status).toBe(400);
  });

  it('recusa um `id_token` sem `nonce` nenhum', async () => {
    const flow = await beginFlow();
    const code = `code-${++codeCounter}`;
    authorize(flow, code, { nonce: null });

    const refusal = await refusalFrom(callback(code, flow.state, flow.state));
    expect(refusal.status).toBe(400);
  });
});

describe('as três decisões de produto, no código', () => {
  it('recusa associar a uma conta local com o mesmo email (D3)', async () => {
    await createUser(db, { email: 'condutor@zemlo.test', name: 'Conta local' });

    const flow = await beginFlow();
    const code = `code-${++codeCounter}`;
    authorize(flow, code);

    const refusal = await refusalFrom(callback(code, flow.state, flow.state));

    expect(refusal.status).toBe(409);
    expect(refusal.message).toContain('associação');

    /* Nenhuma conta nova, e a conta local ficou sem identidade federada associada. */
    expect(await db.prisma.user.count()).toBe(1);
    const local = await db.prisma.user.findUniqueOrThrow({
      where: { email: 'condutor@zemlo.test' },
      select: { authProvider: true, authProviderId: true },
    });
    expect(local.authProvider).toBeNull();
    expect(local.authProviderId).toBeNull();
  });

  it('recusa um endereço que o emissor não confirmou (D2)', async () => {
    const flow = await beginFlow();
    const code = `code-${++codeCounter}`;
    authorize(flow, code, { claims: { email_verified: false } });

    const refusal = await refusalFrom(callback(code, flow.state, flow.state));

    expect(refusal.status).toBe(400);
    expect(await db.prisma.user.count()).toBe(0);
  });

  it('recusa um `id_token` sem endereço de email', async () => {
    const flow = await beginFlow();
    const code = `code-${++codeCounter}`;
    authorize(flow, code, { claims: { email: undefined } });

    const refusal = await refusalFrom(callback(code, flow.state, flow.state));
    expect(refusal.status).toBe(400);
  });

  it('recusa entrar numa conta eliminada', async () => {
    await happyFlow();

    const account = await db.prisma.user.findUniqueOrThrow({
      where: { email: 'condutor@zemlo.test' },
      select: { id: true },
    });
    await db.prisma.user.update({
      where: { id: account.id },
      data: { deletedAt: new Date() },
    });

    const refusal = await refusalFrom(happyFlow());
    expect(refusal.status).toBe(409);
  });
});

describe('a garantia estrutural (D4)', () => {
  it('a base de dados recusa duas contas com o mesmo identificador federado', async () => {
    await db.prisma.user.create({
      data: {
        email: 'primeira@zemlo.test',
        authProvider: 'google',
        authProviderId: 'identidade-partilhada',
      },
    });

    /*
     * É esta a propriedade que a `@@unique` acrescentou e que a verificação aplicacional, só
     * por si, não dava: duas contas não podem partilhar a mesma identidade federada, mesmo
     * que dois pedidos cheguem ao mesmo tempo e ambos passem a consulta.
     */
    await expect(
      db.prisma.user.create({
        data: {
          email: 'segunda@zemlo.test',
          authProvider: 'google',
          authProviderId: 'identidade-partilhada',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('mas `NULL` não colide — as contas de password coexistem sem limite', async () => {
    await db.prisma.user.create({ data: { email: 'um@zemlo.test' } });
    await db.prisma.user.create({ data: { email: 'dois@zemlo.test' } });

    expect(await db.prisma.user.count()).toBe(2);
  });
});

describe('segredos', () => {
  it('não deixa o segredo de cliente, o código nem os tokens no log', async () => {
    const flow = await beginFlow();
    const code = `code-${++codeCounter}`;
    authorize(flow, code, { fault: 'assinado-por-outra-chave' });

    const logs = await captureLogs(() => refusalFrom(callback(code, flow.state, flow.state)));

    expect(logs).not.toContain(provider.clientSecret);
    expect(logs).not.toContain(code);
    expect(logs).not.toContain('access-token-de-teste');
    /* E o log tem de dizer que houve uma recusa — silêncio não é registo. */
    expect(logs).toContain('A troca do código de autorização falhou');
  });
});
