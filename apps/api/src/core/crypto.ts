/**
 * Primitivas criptográficas.
 *
 * Tudo o que envolve segredos vive aqui, num único sítio auditável (§30):
 *  - hashing de passwords com bcrypt;
 *  - tokens opacos de sessão (guardados apenas como hash);
 *  - cifragem simétrica autenticada (AES-256-GCM) para segredos que têm de ser
 *    recuperáveis, como o segredo TOTP ou as credenciais de uma integração;
 *  - TOTP (RFC 6238) implementado sobre `node:crypto`, para não acrescentar uma
 *    dependência a um caminho de autenticação.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { serviceUnavailable } from './errors.js';

/* -------------------------------------------------------------------------- */
/* Passwords                                                                   */
/* -------------------------------------------------------------------------- */

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, config.auth.bcryptRounds);
}

export async function verifyPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * Comparação em tempo constante para segredos de comprimento arbitrário.
 * Comparar com `===` permite, em teoria, descobrir um token byte a byte pelo tempo
 * de resposta.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) {
    // Comparar na mesma para não revelar o comprimento por diferença de tempo.
    timingSafeEqual(bufferA, bufferA);
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

/* -------------------------------------------------------------------------- */
/* Tokens                                                                      */
/* -------------------------------------------------------------------------- */

/** Token opaco com 256 bits de entropia, seguro para URLs. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Hash SHA-256 de um token. É isto que fica na base de dados, nunca o token. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Códigos numéricos curtos (verificação de email), sem viés de módulo. */
export function generateNumericCode(digits = 6): string {
  const max = 10 ** digits;
  return String(randomInt(0, max)).padStart(digits, '0');
}

/* -------------------------------------------------------------------------- */
/* Cifragem autenticada                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Formato do texto cifrado: `v1.<iv-base64url>.<tag-base64url>.<ciphertext-base64url>`.
 * A versão no prefixo permite rodar o algoritmo sem migração destrutiva.
 */
const CIPHER_VERSION = 'v1';

export function secretsAvailable(): boolean {
  return config.crypto.secretsEnabled;
}

function requireKey(): Buffer {
  if (!config.crypto.encryptionKey) {
    throw serviceUnavailable(
      'Esta funcionalidade precisa de uma chave de cifragem configurada. Define ENCRYPTION_KEY no servidor.',
      { missingEnv: 'ENCRYPTION_KEY' },
    );
  }
  return config.crypto.encryptionKey;
}

export function encryptSecret(plaintext: string): string {
  const key = requireKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    CIPHER_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(payload: string): string {
  const key = requireKey();
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== CIPHER_VERSION) {
    throw new Error('Formato de texto cifrado desconhecido.');
  }
  const [, ivPart, tagPart, dataPart] = parts as [string, string, string, string];
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/** Cifra um objeto de credenciais para armazenamento. */
export function encryptJson(value: Record<string, unknown>): string {
  return encryptSecret(JSON.stringify(value));
}

/** Decifra credenciais; devolve `{}` quando não há nada guardado. */
export function decryptJson(payload: string | null | undefined): Record<string, unknown> {
  if (!payload) return {};
  try {
    const parsed = JSON.parse(decryptSecret(payload));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/* -------------------------------------------------------------------------- */
/* TOTP — RFC 6238 (§29)                                                       */
/* -------------------------------------------------------------------------- */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;

/** Gera um segredo TOTP em base32 (160 bits, como recomendado pela RFC 4226). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function base32Encode(buffer: Buffer): string {
  let output = '';
  let bits = 0;
  let value = 0;
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Código TOTP para um instante concreto. Exposto para permitir testes determinísticos. */
export function totpCode(secret: string, at: Date = new Date(), offsetSteps = 0): string {
  const counter = Math.floor(at.getTime() / 1000 / TOTP_PERIOD_SECONDS) + offsetSteps;
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBuffer.writeUInt32BE(counter % 2 ** 32, 4);
  const hmac = createHmac('sha1', base32Decode(secret)).update(counterBuffer).digest();
  const offset = (hmac[hmac.length - 1] as number) & 0x0f;
  const binary =
    (((hmac[offset] as number) & 0x7f) << 24) |
    (((hmac[offset + 1] as number) & 0xff) << 16) |
    (((hmac[offset + 2] as number) & 0xff) << 8) |
    ((hmac[offset + 3] as number) & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/**
 * Verifica um código TOTP aceitando uma janela de ±1 passo (30 s).
 *
 * A janela existe porque relógios de telemóveis desviam-se alguns segundos. Mais do
 * que um passo para cada lado aumentaria a superfície de reutilização de códigos
 * sem ganho prático. Um código não é consumido, por isso a proteção contra repetição
 * vem de o token de acesso ser de curta duração e da sessão registada.
 */
export function verifyTotp(secret: string, code: string, at: Date = new Date()): boolean {
  const normalized = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  for (const offset of [0, -1, 1]) {
    if (safeEqual(totpCode(secret, at, offset), normalized)) return true;
  }
  return false;
}

/** URI `otpauth://` para o cliente gerar o QR code. */
export function buildOtpauthUri(secret: string, accountLabel: string, issuer = 'Zemlo'): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Códigos de recuperação de uso único, apresentados uma só vez ao utilizador. */
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const raw = randomBytes(5).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  return codes;
}

/** Normaliza um código de recuperação introduzido pelo utilizador. */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Hash de códigos de recuperação, para comparação sem guardar os códigos. */
export function hashRecoveryCodes(codes: string[]): string[] {
  return codes.map((code) => createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex'));
}

/** Verifica e consome um código de recuperação, devolvendo a lista restante. */
export function consumeRecoveryCode(
  hashes: string[],
  candidate: string,
): { ok: boolean; remaining: string[] } {
  const candidateHash = createHash('sha256').update(normalizeRecoveryCode(candidate)).digest('hex');
  const index = hashes.findIndex((hash) => safeEqual(hash, candidateHash));
  if (index === -1) return { ok: false, remaining: hashes };
  const remaining = [...hashes.slice(0, index), ...hashes.slice(index + 1)];
  return { ok: true, remaining };
}

/** Impressão digital estável de um segredo, para diagnóstico sem o revelar. */
export function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}
