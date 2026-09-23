/**
 * Login federado com Google — OpenID Connect (`AUTH-002`).
 *
 * ## O que este ficheiro é, e o que não é
 *
 * É o **único** caminho por onde uma identidade externa entra no Zemlo. Não é um substituto
 * da autenticação por password: termina no mesmo sítio que o `login` de `services/auth.ts`
 * — `issueSessionResponse` —, para que quem entra com Google fique exatamente no mesmo
 * estado que quem entra com password: mesma sessão, mesma rotação de refresh token (A23),
 * mesmo `audit('session.created')`.
 *
 * ## Porque é que o protocolo é feito por uma biblioteca (decisão D1)
 *
 * A validação de um `id_token` — assinatura sobre as JWKS do emissor, `iss`, `aud`,
 * `exp`/`iat`, `nonce` — é onde os erros são **silenciosos**. Um `aud` não verificado aceita
 * um token emitido para **outra** aplicação; uma assinatura não verificada aceita um token
 * forjado; e nos dois casos o código continua a parecer correto e os testes de caminho feliz
 * continuam verdes. Escrever isto à mão é escrever código criptográfico, e o custo de errar
 * é tomada de conta. O `openid-client` faz exatamente estas verificações.
 *
 * ## O que é nosso, e por isso tem de ser provado
 *
 * O `state` não é um detalhe do protocolo: é a defesa contra a repetição do callback.
 *
 *  - é gerado **por nós**, guardado no servidor e **consumido uma só vez** (`takePendingFlow`
 *    apaga antes de validar: um `state` vale uma utilização, mesmo que a validação seguinte
 *    falhe);
 *  - expira em 10 minutos;
 *  - é ligado ao **browser** por um cookie `HttpOnly`, o que impede que um atacante que
 *    começou um fluxo próprio faça a vítima terminar **o fluxo dele** — sem esta ligação, a
 *    vítima acabaria autenticada na conta do atacante (login CSRF), porque o `state` do
 *    atacante é um valor válido que ele conhece;
 *  - é verificado **outra vez** pelo `openid-client`, em `expectedState`.
 *
 * ## O `redirect_uri` nunca vem do pedido
 *
 * Vem de `config.federatedLogin.google.redirectUri`, que é configuração de operação. O URL
 * de retorno que se entrega ao `openid-client` é **construído a partir dele** — só a query
 * vem do pedido. Se o endereço viesse do cabeçalho `Host`, quem controlasse o pedido
 * controlaria o destino do `code`, que é uma credencial de uso único.
 *
 * ## O que este ficheiro deliberadamente **não** faz
 *
 * Não associa uma identidade Google a uma conta local que já exista com o mesmo email. Se o
 * email do `id_token` já pertencer a uma conta Zemlo, o fluxo **recusa** e encaminha para
 * `AUTH-003`. A associação implícita por coincidência de email é a decisão de maior risco
 * deste domínio — permite que quem controla uma conta Google com o email de outra pessoa
 * entre na conta Zemlo dela — e é por isso que tem tarefa própria, com revisão adversarial
 * (decisão D3, §5.2).
 */

import { timingSafeEqual } from 'node:crypto';
import type { AuthSessionResponse } from '@zemlo/shared';
import * as client from 'openid-client';
import { config } from '../core/config.js';
import { prisma } from '../core/db.js';
import { badRequest, conflict, serviceUnavailable } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { audit } from './audit.js';
import { issueSessionResponse, newAccountPreferences, type RequestMetadata } from './auth.js';

/** Identificador do provedor gravado em `User.authProvider`. */
const GOOGLE_PROVIDER = 'google';

/**
 * Âmbitos pedidos. `email` é obrigatório e não negociável: sem ele não há endereço para
 * criar a conta nem para a procurar. `profile` traz o nome e a imagem, que são o que o
 * utilizador reconhece no ecrã de sessões.
 */
const GOOGLE_SCOPES = 'openid email profile';

/** Validade de um fluxo começado e não concluído. */
const PENDING_FLOW_TTL_MS = 10 * 60 * 1000;

/** Nome do cookie que liga o fluxo ao browser. Exportado para a rota o poder limpar. */
export const OAUTH_STATE_COOKIE = 'zemlo_oauth_state';

interface PendingFlow {
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly expiresAt: number;
}

/**
 * Fluxos de autorização a meio, indexados pelo `state`.
 *
 * ## Porque é que isto vive em memória, e o que isso custa
 *
 * O `state` tem de estar associado ao **pedido**, não ao cliente. A alternativa — assinar o
 * `state` e devolvê-lo ao browser — continua a ser verificável, mas deixa de ser de **uso
 * único**: quem o apanhasse no histórico do browser, num `Referer` ou num log podia repetir
 * o callback indefinidamente. Guardá-lo do lado do servidor é o que permite **consumi-lo**.
 *
 * O custo, declarado e não escondido: é um `Map` do processo. Um reinício a meio de um
 * fluxo perde-o e o utilizador recomeça — aceitável, porque o fluxo dura segundos e o
 * recomeço é um clique. Mas numa implantação com **várias instâncias atrás de um
 * balanceador** isto parte (o `/start` pode cair numa instância e o `/callback` noutra, e o
 * `state` não existe na segunda). Nesse cenário tem de passar a haver armazenamento
 * partilhado. Está registado como `PC-29`; não é uma surpresa para quem operar isto.
 */
const pendingFlows = new Map<string, PendingFlow>();

/**
 * Remove os fluxos expirados.
 *
 * Chamado no início de cada fluxo, e não por um temporizador: sem isto, um cliente que
 * começasse fluxos e nunca voltasse ao callback faria o `Map` crescer sem limite — memória
 * controlada por quem não está autenticado. Uma limpeza por pedido é suficiente, porque o
 * número de fluxos vivos é, por definição, o número de autorizações em curso.
 */
function sweepExpiredFlows(now: number): void {
  for (const [state, flow] of pendingFlows) {
    if (flow.expiresAt <= now) pendingFlows.delete(state);
  }
}

/**
 * Retira um fluxo do mapa e devolve-o, ou `null` se não existir ou já ter expirado.
 *
 * **A remoção acontece antes da validação de expiração, e é isso que torna o `state` de uso
 * único.** Se a remoção fosse condicional, um `state` expirado continuaria no mapa e uma
 * segunda tentativa com o mesmo valor ainda o encontraria — o que abriria exatamente a
 * janela de repetição que este mecanismo existe para fechar.
 */
function takePendingFlow(state: string): PendingFlow | null {
  const flow = pendingFlows.get(state);
  if (flow === undefined) return null;

  pendingFlows.delete(state);

  if (flow.expiresAt <= Date.now()) return null;
  return flow;
}

/** Configuração do Google, ou um erro de serviço se o login federado não estiver montado. */
function requireGoogleConfig(): NonNullable<typeof config.federatedLogin.google> {
  const google = config.federatedLogin.google;
  if (google === null) {
    throw serviceUnavailable(
      'A entrada com Google não está configurada neste servidor. Define GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET.',
    );
  }
  return google;
}

/**
 * Documento de descoberta do emissor, obtido uma vez por processo.
 *
 * ## Porque é que a falha **não** fica memorizada
 *
 * O documento é buscado na rede. Se a primeira tentativa apanhasse uma janela de rede má e o
 * erro ficasse guardado na promessa, o login federado ficaria desligado até ao próximo
 * reinício do processo — e a causa (um segundo de rede) seria invisível no log depois de
 * passar. O `catch` repõe `discovered` a `null` para que a tentativa seguinte volte a
 * tentar, e o erro que sai daqui é um `503` do envelope único (A11), não uma exceção.
 */
let discovered: Promise<client.Configuration> | null = null;

function googleConfiguration(): Promise<client.Configuration> {
  const google = requireGoogleConfig();

  if (discovered === null) {
    const issuerUrl = new URL(google.issuer);

    /*
     * `enableNonRepudiationChecks` **não é opcional aqui**, e é a linha mais fácil de perder
     * deste ficheiro.
     *
     * Por omissão, o `openid-client` **não valida a assinatura do `id_token`** no fluxo de
     * código, e fá-lo por uma razão defensável: o OIDC considera que um `id_token` recebido
     * diretamente do token endpoint, por TLS, não precisa de validação de assinatura, porque
     * quem valida o emissor é o TLS. Medido, não suposto: sem esta linha, o `jwks_uri` do
     * emissor **nunca é consultado** — o teste «consulta o JWKS do emissor» conta as
     * consultas e apanha-o.
     *
     * Porque é que aqui tem de ser ligado, apesar disso:
     *
     *  1. **A identidade passa a ser autenticada pela chave do emissor, e não pelo canal.**
     *     Com a assinatura verificada, um `id_token` só é aceite se tiver sido emitido por
     *     quem tem a chave privada. Sem ela, a única coisa que garante que o `sub` e o
     *     `email` são da Google é o TLS ter corrido bem — o que coloca toda a confiança num
     *     único ponto (terminação TLS, proxy, DNS) e transforma qualquer um deles num
     *     emissor de identidades.
     *  2. **O `sub` e o `email` deste `id_token` são o que `AUTH-003` vai usar para decidir
     *     se uma identidade federada pode ser associada a uma conta existente.** Essa decisão
     *     não pode assentar num claim cuja autenticidade não foi provada por criptografia.
     *  3. **É o que o pedido pede, explicitamente:** validação da assinatura do `id_token`
     *     através das JWKS do emissor, com tratamento de rotação/cache das chaves.
     */
    const execute: Array<(config: client.Configuration) => void> = [
      client.enableNonRepudiationChecks,
    ];

    /*
     * Um emissor `http` só pode existir **fora** de produção: `validateFederatedLoginConfig`
     * recusa arrancar em produção com um. Sem isto, o `oauth4webapi` recusaria qualquer
     * emissor que não fosse `https` («only requests to HTTPS are allowed») e o fluxo não
     * teria como ser exercido contra um fornecedor OIDC próprio — e as validações de
     * assinatura, `iss` e `aud` ficariam por provar, que é precisamente onde os erros são
     * silenciosos. Em produção o arranque já falhou antes de aqui chegar.
     */
    if (issuerUrl.protocol !== 'https:') execute.push(client.allowInsecureRequests);

    discovered = client
      .discovery(
        issuerUrl,
        google.clientId,
        {
          client_secret: google.clientSecret,
          redirect_uri: google.redirectUri,
        },
        undefined,
        { execute },
      )
      .catch((error: unknown) => {
        discovered = null;
        logger.error('Não foi possível obter o documento de descoberta do emissor OIDC', {
          issuer: google.issuer,
          error,
        });
        throw serviceUnavailable(
          'A entrada com Google está temporariamente indisponível. Tenta novamente dentro de momentos.',
        );
      });
  }

  return discovered;
}

/**
 * Caminho a que o cookie do `state` fica limitado — o do callback configurado.
 *
 * Uma só fonte para o valor, porque é usado **duas** vezes: a criar o cookie no `/start` e a
 * apagá-lo no `/callback`. E um browser só remove um cookie cujo `Path` coincida com o que
 * foi usado a criá-lo — calcular o caminho de duas maneiras diferentes deixaria um cookie
 * órfão, invisível, e o sintoma seria um `state` de um fluxo antigo a ser aceite.
 */
export function oauthStateCookiePath(): string {
  return new URL(requireGoogleConfig().redirectUri).pathname;
}

/** O que a rota precisa para redirecionar o browser e para lhe deixar a marca do fluxo. */
export interface GoogleLoginStart {
  readonly authorizationUrl: string;
  readonly state: string;
  readonly cookieMaxAgeSeconds: number;
}

/**
 * Inicia um fluxo de autorização.
 *
 * Não toca na base de dados: nada é escrito enquanto o utilizador não voltar. Um fluxo
 * começado e abandonado não deixa rasto — é por isso que o `Map` em memória é suficiente
 * para o estado do fluxo, e não uma tabela.
 */
export async function startGoogleLogin(): Promise<GoogleLoginStart> {
  const google = requireGoogleConfig();
  const configuration = await googleConfiguration();

  const state = client.randomState();
  const nonce = client.randomNonce();
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

  const now = Date.now();
  sweepExpiredFlows(now);
  pendingFlows.set(state, {
    nonce,
    codeVerifier,
    expiresAt: now + PENDING_FLOW_TTL_MS,
  });

  const authorizationUrl = client.buildAuthorizationUrl(configuration, {
    redirect_uri: google.redirectUri,
    scope: GOOGLE_SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  });

  return {
    authorizationUrl: authorizationUrl.href,
    state,
    cookieMaxAgeSeconds: Math.floor(PENDING_FLOW_TTL_MS / 1000),
  };
}

/**
 * Compara duas cadeias em tempo constante.
 *
 * O `state` e o valor do cookie são ambos públicos (viajam no URL e no cabeçalho), pelo que
 * uma fuga por temporização não é, aqui, um vetor realista. É feito assim na mesma porque o
 * custo é nulo e porque a alternativa — deixar a comparação por omissão num sítio onde ela
 * *parece* importar — ensina o padrão errado a quem ler isto depois. `timingSafeEqual`
 * exige o mesmo comprimento, e é o comprimento que se compara primeiro.
 */
function sameValue(a: string | null, b: string): boolean {
  if (a === null) return false;
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Conclui um fluxo de autorização e devolve a sessão.
 *
 * A ordem das verificações não é arbitrária: **nada do pedido é usado antes de o `state`
 * ser aceite**. Um `state` desconhecido, expirado ou já usado termina aqui, sem que o
 * `code` chegue a ser tocado — o que impede que o callback sirva de oráculo para testar
 * códigos de autorização.
 *
 * @param rawQuery A query do pedido, **crua**. A base do URL vem da configuração, não do
 *   pedido: ver a nota no cabeçalho do ficheiro.
 * @param browserState Valor do cookie `HttpOnly` deixado pelo `/start`, ou `null`.
 */
export async function completeGoogleLogin(
  rawQuery: string,
  browserState: string | null,
  meta: RequestMetadata,
): Promise<AuthSessionResponse> {
  const google = requireGoogleConfig();
  const configuration = await googleConfiguration();

  const currentUrl = new URL(google.redirectUri);
  if (rawQuery !== '') {
    currentUrl.search = rawQuery.startsWith('?') ? rawQuery : `?${rawQuery}`;
  }

  /*
   * O utilizador pode ter recusado o acesso no ecrã da Google. É um caminho **normal**, não
   * um ataque: dizer-lhe «autorização inválida» seria tratá-lo como suspeito por ter
   * clicado em «Cancelar». Também pode vir `access_denied` quando o próprio emissor recusa.
   */
  const denied = currentUrl.searchParams.get('error');
  if (denied !== null) {
    logger.info('Autorização federada recusada no emissor', { error: denied });
    throw badRequest(
      denied === 'access_denied'
        ? 'Cancelaste a entrada com Google. Podes tentar novamente quando quiseres.'
        : 'A Google recusou o pedido de entrada. Tenta novamente.',
    );
  }

  const state = currentUrl.searchParams.get('state');
  if (state === null) {
    throw badRequest('Este pedido de entrada não tem a marca do fluxo. Começa de novo a partir da página de entrada.');
  }

  /*
   * A ligação ao browser é verificada **antes** de o fluxo ser consumido. Se falhar aqui, o
   * fluxo fica no mapa até expirar — e é o que se quer: um cookie ausente pode ser um
   * browser que bloqueia cookies, e o utilizador deve poder tentar outra vez sem esperar
   * 10 minutos. Um `state` desconhecido, esse, não tem segunda oportunidade.
   */
  if (!sameValue(browserState, state)) {
    logger.warn('Callback federado sem a marca do fluxo no browser', {
      motivo: browserState === null ? 'cookie ausente' : 'cookie diferente do state',
    });
    throw badRequest(
      'Esta entrada não corresponde ao pedido feito neste browser. Começa de novo a partir da página de entrada.',
    );
  }

  const flow = takePendingFlow(state);
  if (flow === null) {
    throw badRequest(
      'Este pedido de entrada expirou ou já foi usado. Começa de novo a partir da página de entrada.',
    );
  }

  /*
   * `authorizationCodeGrant` faz, de uma vez, o que não se pode dividir: troca o `code` no
   * token endpoint (back-channel, com o `client_secret`, que nunca sai do servidor),
   * verifica a assinatura do `id_token` contra as JWKS do emissor, e valida `iss`, `aud`,
   * `exp`/`iat` com tolerância. `expectedState` e `expectedNonce` acrescentam as duas
   * verificações que dependem de nós.
   *
   * O `redirect_uri` é passado **explicitamente** e vem da configuração: a Google exige que
   * coincida com o que foi usado no pedido de autorização, e derivá-lo do pedido abriria a
   * porta a que um atacante o escolhesse.
   */
  let tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers;
  try {
    tokens = await client.authorizationCodeGrant(
      configuration,
      currentUrl,
      {
        pkceCodeVerifier: flow.codeVerifier,
        expectedState: state,
        expectedNonce: flow.nonce,
        idTokenExpected: true,
      },
      { redirect_uri: google.redirectUri },
    );
  } catch (error) {
    /*
     * Uma recusa aqui é uma das duas coisas: um token forjado/repetido, ou um desencontro de
     * configuração. As duas merecem o mesmo tratamento para o utilizador (não há nada que
     * ele possa fazer) e tratamento diferente no log — sem o `code`, sem os tokens e sem o
     * `state`, que não podem aparecer em log nenhum (A12).
     */
    logger.error('A troca do código de autorização falhou', { error });
    throw badRequest(
      'Não foi possível confirmar a tua identidade com a Google. Tenta novamente a partir da página de entrada.',
    );
  }

  const claims = tokens.claims();
  if (claims === undefined) {
    logger.error('O emissor não devolveu `id_token` numa resposta que o exigia');
    throw badRequest(
      'A Google não devolveu os dados de identidade necessários. Tenta novamente a partir da página de entrada.',
    );
  }

  /*
   * A partir daqui os claims já foram validados pelo `openid-client` — assinatura, `iss`,
   * `aud` e validade temporal. Nada foi lido antes disso, e é essa ordem que faz a
   * diferença: ler o email antes de validar a assinatura seria ler um valor que qualquer
   * pessoa pode escrever.
   */
  const subject = claims.sub;
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : null;

  if (email === null || email === '') {
    logger.error('O `id_token` não trouxe endereço de email');
    throw badRequest(
      'A tua conta Google não deu um endereço de email. Sem ele não é possível criar a conta Zemlo.',
    );
  }

  /*
   * `email_verified` a falso significa que o próprio emissor não garante que este endereço
   * pertence a quem o apresenta. Criar a conta a partir daí seria criar uma conta Zemlo
   * cujo email ninguém provou — e é precisamente esse email que, em `AUTH-003`, vai decidir
   * se uma identidade federada pode ser associada a uma conta existente. Aceitar aqui um
   * endereço não verificado seria criar o material para essa tomada de conta mais tarde.
   */
  if (claims.email_verified !== true) {
    logger.warn('Entrada federada recusada por endereço não verificado pelo emissor');
    throw badRequest(
      'A Google não confirmou este endereço de email. Confirma-o na tua conta Google e tenta novamente.',
    );
  }

  const account = await resolveFederatedAccount({
    subject,
    email,
    name: typeof claims.name === 'string' ? claims.name : null,
    picture: typeof claims.picture === 'string' ? claims.picture : null,
    meta,
  });

  return issueSessionResponse(account, meta, 'Entrada com Google');
}

interface FederatedIdentity {
  readonly subject: string;
  readonly email: string;
  readonly name: string | null;
  readonly picture: string | null;
  readonly meta: RequestMetadata;
}

/**
 * Resolve a identidade federada para uma conta Zemlo — encontrando-a ou criando-a.
 *
 * ## Os três casos, e o que acontece a cada um
 *
 * 1. **Identidade Google já associada** → é essa a conta que entra. Nenhuma conta nova.
 * 2. **Identidade desconhecida, email livre** → a conta é criada agora, com a identidade
 *    associada na **mesma** operação (decisão D2).
 * 3. **Identidade desconhecida, email já pertencente a uma conta Zemlo** → **recusa**
 *    (decisão D3). Não há associação implícita. Ver a nota no cabeçalho do ficheiro.
 *
 * ## Porque é que a criação apanha `P2002`
 *
 * A unicidade do par `(authProvider, authProviderId)` é uma **constraint** desde `AUTH-002`
 * (§7.1). Isso significa que dois pedidos simultâneos do mesmo utilizador — duplo clique, ou
 * o callback disparado duas vezes — não podem criar duas contas: a segunda viola o índice. A
 * verificação por consulta continua a existir, mas é o que dá a mensagem boa no caso normal;
 * a constraint é o que garante o caso adverso. Sem o `catch`, a corrida apareceria ao
 * utilizador como «algo não correu como esperado».
 */
async function resolveFederatedAccount(
  identity: FederatedIdentity,
): Promise<{ id: string; email: string; timeZone: string }> {
  const existingIdentity = await prisma.user.findUnique({
    where: {
      authProvider_authProviderId: {
        authProvider: GOOGLE_PROVIDER,
        authProviderId: identity.subject,
      },
    },
    select: { id: true, email: true, timeZone: true, deletedAt: true },
  });

  if (existingIdentity !== null) {
    if (existingIdentity.deletedAt !== null) {
      throw conflict('Esta conta já não está ativa.');
    }

    await prisma.user.update({
      where: { id: existingIdentity.id },
      data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });

    await audit('user.login', {
      userId: existingIdentity.id,
      entityType: 'user',
      entityId: existingIdentity.id,
      metadata: { metodo: 'google', contaCriada: false },
      ipAddress: identity.meta.ipAddress ?? null,
      userAgent: identity.meta.userAgent ?? null,
    });

    return existingIdentity;
  }

  /*
   * O email já existe numa conta local. **Não é associado.**
   *
   * A mensagem diz o que fazer, porque este é um caminho que um utilizador legítimo vai
   * encontrar (registou-se com password, agora tenta com Google e o mesmo email): dizer-lhe
   * só «conflito» deixá-lo-ia sem saída. Não revela nada que ele não saiba — foi ele que
   * escreveu o endereço — e `AUTH-003` é quem vai oferecer a associação explícita.
   */
  const existingEmail = await prisma.user.findUnique({
    where: { email: identity.email },
    select: { id: true, deletedAt: true },
  });

  if (existingEmail !== null && existingEmail.deletedAt === null) {
    logger.info('Entrada federada recusada: o email já pertence a uma conta local', {
      motivo: 'associação é AUTH-003',
    });
    await audit('user.login_failed', {
      userId: existingEmail.id,
      entityType: 'user',
      entityId: existingEmail.id,
      metadata: { metodo: 'google', motivo: 'email_ja_registado' },
      ipAddress: identity.meta.ipAddress ?? null,
      userAgent: identity.meta.userAgent ?? null,
    });
    throw conflict(
      'Já existe uma conta Zemlo com este email. Inicia sessão com a tua password — a associação da conta Google a uma conta existente chega numa próxima versão.',
    );
  }

  try {
    const created = await prisma.user.create({
      data: {
        email: identity.email,
        passwordHash: null,
        name: identity.name,
        avatarUrl: identity.picture,
        authProvider: GOOGLE_PROVIDER,
        authProviderId: identity.subject,
        /*
         * `emailVerified` herda a verificação da Google, que é o que `email_verified: true`
         * acabou de afirmar. Marcá-lo a falso faria o produto pedir ao utilizador que
         * confirmasse por email um endereço que a Google já confirmou — e o pedido de
         * verificação sairia para um endereço que ninguém provou pertencer-lhe.
         */
        emailVerified: true,
        emailVerifiedAt: new Date(),
        lastLoginAt: new Date(),
        /*
         * `acceptedTermsAt` fica **nulo**, deliberadamente.
         *
         * O registo por password exige `acceptedTerms: true` e grava a data. Aqui não houve
         * ecrã nenhum: gravar a data seria registar uma aceitação que nunca aconteceu, num
         * campo que existe precisamente para a poder provar. Nada no código lê este campo
         * hoje, pelo que a conta funciona — mas a lacuna é real e está registada em
         * `PC-28`: falta o ecrã que peça a aceitação no primeiro acesso federado.
         */
        ...newAccountPreferences(),
      },
      select: { id: true, email: true, timeZone: true },
    });

    await audit('user.signup', {
      userId: created.id,
      entityType: 'user',
      entityId: created.id,
      metadata: { metodo: 'google' },
      ipAddress: identity.meta.ipAddress ?? null,
      userAgent: identity.meta.userAgent ?? null,
    });

    return created;
  } catch (error) {
    if (isUniqueViolation(error)) {
      /*
       * Corrida perdida: outra execução deste mesmo callback criou a conta entre a consulta
       * e o `create`. A conta existe e é a correta — a identidade federada é a mesma — pelo
       * que a resposta certa é entrar nela, e não falhar. Voltar a consultar é o que
       * transforma uma corrida num login, em vez de num erro.
       */
      const winner = await prisma.user.findUnique({
        where: {
          authProvider_authProviderId: {
            authProvider: GOOGLE_PROVIDER,
            authProviderId: identity.subject,
          },
        },
        select: { id: true, email: true, timeZone: true, deletedAt: true },
      });

      if (winner !== null && winner.deletedAt === null) {
        logger.info('Criação federada concorrente resolvida pela constraint de unicidade', {
          userId: winner.id,
        });
        return winner;
      }

      throw conflict('Esta conta já existe. Tenta iniciar sessão.');
    }

    throw error;
  }
}

/**
 * Reconhece uma violação de restrição única do Prisma.
 *
 * Escrito à mão em vez de reutilizar `translatePrismaError` (`core/errors.ts`) porque o
 * significado aqui é o oposto: lá, um `P2002` é um conflito para comunicar ao utilizador;
 * aqui, é a constraint a fazer o seu trabalho e o caminho a seguir é continuar.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}
