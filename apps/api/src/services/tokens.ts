/**
 * Emissão e validação de tokens de acesso (§29).
 *
 * HS256 com um segredo simétrico é a escolha certa aqui: a API é simultaneamente
 * emissor e validador, não há terceiros a validar tokens, e uma chave assimétrica
 * traria complexidade de rotação de chaves sem benefício. Se um dia a validação for
 * delegada a outro serviço, este é o único ficheiro a mudar.
 */

import { SignJWT, jwtVerify } from 'jose';
import { config } from '../core/config.js';

const ISSUER = 'zemlo-api';
const AUDIENCE = 'zemlo-client';

export interface AccessTokenPayload {
  /** Identificador do utilizador. */
  sub: string;
  email: string;
  /** Identificador da sessão, que permite revogar o token antes de expirar. */
  sid: string | null;
}

const secretKey = new TextEncoder().encode(config.auth.jwtSecret);

export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: payload.email, sid: payload.sid })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(payload.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + config.auth.accessTokenTtlMinutes * 60)
    .sign(secretKey);
}

/**
 * Verifica um token e devolve o payload, ou `null`.
 *
 * Devolver `null` em vez de lançar mantém a decisão de "responder 401" na camada HTTP,
 * onde pertence. Nenhum detalhe da razão da falha sai daqui: dizer "assinatura
 * inválida" ou "token expirado" a um cliente não autenticado só ajuda quem está a
 * tentar entrar.
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null;
    return {
      sub: payload.sub,
      email: payload.email,
      sid: typeof payload.sid === 'string' ? payload.sid : null,
    };
  } catch {
    return null;
  }
}

/**
 * Extrai o token do cabeçalho `Authorization`.
 * Aceita apenas `Bearer`, para não haver ambiguidade entre esquemas.
 */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? null;
}
