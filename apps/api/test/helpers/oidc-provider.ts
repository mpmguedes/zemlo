/**
 * Fornecedor OpenID Connect falso, para os testes do login federado (`AUTH-002`).
 *
 * ## Porque é que isto existe, e porque não é um duplo
 *
 * As propriedades que `AUTH-002` tem de garantir — «um `id_token` assinado com outra chave é
 * recusado», «um `iss` diferente é recusado», «um `aud` diferente é recusado» — **não são
 * observáveis** contra um duplo que devolve `true`. São propriedades da verificação
 * criptográfica, e a única forma honesta de as provar é fazer a verificação a sério: chaves a
 * sério, uma assinatura a sério, e um teste que exige que ela seja recusada.
 *
 * É a mesma disciplina de `password-reset-integration.test.ts`, que levanta um servidor SMTP
 * real numa porta efémera. O objeto do teste é o protocolo; um duplo testaria a nossa imitação
 * do protocolo, não o protocolo.
 *
 * ## O que ele serve
 *
 * Os três documentos que o `openid-client` procura — metadados de descoberta, JWKS e token
 * endpoint — sobre `http` em `127.0.0.1`, numa porta efémera. Assina `id_token` a sério com
 * uma chave RSA gerada no arranque, e guarda uma **segunda** chave que **não** publica no
 * JWKS: é ela que produz o caso adversário «assinado por quem não devia», com o mesmo `kid`,
 * para que a chave seja encontrada e a assinatura seja mesmo comparada.
 *
 * ## O que ele exige, e é isso que prova o fluxo
 *
 * O token endpoint **verifica o PKCE** (`code_verifier` contra o `code_challenge` que o
 * cliente anunciou) e **exige autenticação de cliente**. Um fluxo que passe por aqui provou,
 * por consequência, que o serviço enviou as duas coisas — e não é preciso ir ver ao código.
 *
 * Vive em `test/` para que seja impossível importá-lo em produção.
 */

import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, exportJWK, generateKeyPair, type KeyLike } from 'jose';

/** Modos de falha que o emissor sabe produzir. Cada um corresponde a uma recusa a provar. */
export type IdTokenFault =
  | 'assinado-por-outra-chave'
  | 'emissor-errado'
  | 'audiencia-errada'
  | 'expirado';

/** O que o emissor deve devolver quando receber este `code`. */
export interface AuthorizationSpec {
  readonly code: string;
  /** O `nonce` que o `id_token` deve trazer. `null` produz um `id_token` sem `nonce`. */
  readonly nonce: string | null;
  /** O `code_challenge` (S256) que o emissor vai exigir ao `code_verifier`. */
  readonly codeChallenge: string;
  /** Claims a sobrepor às do caso normal. */
  readonly claims?: Record<string, unknown>;
  readonly fault?: IdTokenFault;
}

/** Uma requisição recebida no token endpoint, já analisada. */
export type TokenRequest = Record<string, string>;

export interface OidcProvider {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** Endereço de retorno que o emissor espera ver no pedido de token. */
  readonly redirectUri: string;
  /** Regista o que o emissor deve devolver para um `code`. */
  expectAuthorization(spec: AuthorizationSpec): void;
  /** Todas as requisições recebidas no token endpoint, por ordem. */
  readonly tokenRequests: TokenRequest[];
  close(): Promise<void>;
}

export interface OidcProviderOptions {
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly redirectUri?: string;
}

/** Claims do caso normal — o que uma conta Google devolve para alguém que autoriza. */
const DEFAULT_CLAIMS = {
  sub: 'google-sub-1',
  email: 'condutor@zemlo.test',
  email_verified: true,
  name: 'Condutor de Teste',
  picture: 'https://exemplo.test/avatar.png',
};

function base64url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    /*
     * Obrigatório pelo RFC 6749 para respostas de token, e o `oauth4webapi` verifica-o:
     * uma resposta com tokens que se declare cacheável é recusada.
     */
    'cache-control': 'no-store',
    pragma: 'no-cache',
  });
  response.end(payload);
}

export async function startOidcProvider(options: OidcProviderOptions = {}): Promise<OidcProvider> {
  const clientId = options.clientId ?? 'zemlo-teste';
  const clientSecret = options.clientSecret ?? 'segredo-de-teste';
  const redirectUri = options.redirectUri ?? 'http://127.0.0.1:4000/api/v1/auth/google/callback';

  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  /** A chave que **não** é publicada. Assina os `id_token` do caso «assinatura de outro». */
  const { privateKey: unpublishedKey } = await generateKeyPair('RS256', { extractable: true });

  const kid = 'chave-de-teste-1';
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };

  const pending = new Map<string, AuthorizationSpec>();
  const tokenRequests: TokenRequest[] = [];
  const jwksRequests = { count: 0 };

  let issuer = '';
  let tokenEndpoint = '';

  const server: Server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', issuer || 'http://127.0.0.1');

      if (url.pathname === '/.well-known/openid-configuration') {
        sendJson(response, 200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: tokenEndpoint,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['client_secret_post'],
          scopes_supported: ['openid', 'email', 'profile'],
        });
        return;
      }

      if (url.pathname === '/jwks') {
        jwksRequests.count += 1;
        sendJson(response, 200, { keys: [publicJwk] });
        return;
      }

      if (url.pathname === '/token' && request.method === 'POST') {
        const form = new URLSearchParams(await readBody(request));
        const received: TokenRequest = {};
        for (const [key, value] of form) received[key] = value;
        tokenRequests.push(received);

        if (form.get('client_id') !== clientId || form.get('client_secret') !== clientSecret) {
          sendJson(response, 401, { error: 'invalid_client' });
          return;
        }

        if (form.get('redirect_uri') !== redirectUri) {
          sendJson(response, 400, { error: 'invalid_grant', error_description: 'redirect_uri' });
          return;
        }

        const spec = pending.get(form.get('code') ?? '');
        if (spec === undefined) {
          sendJson(response, 400, { error: 'invalid_grant', error_description: 'code' });
          return;
        }

        /*
         * Verificação de PKCE a sério. Se o serviço não enviasse o `code_verifier`, ou o
         * enviasse errado, nenhum teste de caminho feliz passaria — o que faz de cada teste
         * verde uma prova de que o PKCE viajou.
         */
        const verifier = form.get('code_verifier') ?? '';
        const challenge = base64url(createHash('sha256').update(verifier).digest());
        if (challenge !== spec.codeChallenge) {
          sendJson(response, 400, { error: 'invalid_grant', error_description: 'pkce' });
          return;
        }

        const now = Math.floor(Date.now() / 1000);
        const claims: Record<string, unknown> = {
          ...DEFAULT_CLAIMS,
          iss: issuer,
          aud: clientId,
          iat: now,
          exp: now + 600,
          ...(spec.nonce === null ? {} : { nonce: spec.nonce }),
          ...(spec.claims ?? {}),
        };

        let signingKey: KeyLike = privateKey;

        switch (spec.fault) {
          case 'assinado-por-outra-chave':
            // Mesmo `kid`: a chave é encontrada no JWKS e a assinatura é mesmo comparada.
            signingKey = unpublishedKey;
            break;
          case 'emissor-errado':
            claims.iss = 'https://emissor-que-nao-e-o-nosso.test';
            break;
          case 'audiencia-errada':
            claims.aud = 'outra-aplicacao';
            break;
          case 'expirado':
            claims.exp = now - 120;
            break;
          case undefined:
            break;
        }

        const idToken = await new SignJWT(claims)
          .setProtectedHeader({ alg: 'RS256', kid })
          .sign(signingKey);

        sendJson(response, 200, {
          access_token: 'access-token-de-teste',
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: idToken,
        });
        return;
      }

      sendJson(response, 404, { error: 'not_found' });
    })().catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: 'server_error' });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  issuer = `http://127.0.0.1:${port}`;
  tokenEndpoint = `${issuer}/token`;

  return {
    issuer,
    clientId,
    clientSecret,
    redirectUri,
    tokenRequests,
    jwksRequests,
    expectAuthorization(spec: AuthorizationSpec): void {
      pending.set(spec.code, spec);
    },
    async close(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

/** Calcula o `code_challenge` S256 de um `code_verifier`, como o RFC 7636 o define. */
export function pkceChallenge(codeVerifier: string): string {
  return base64url(createHash('sha256').update(codeVerifier).digest());
}
