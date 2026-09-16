/**
 * Versões e identificação do produto.
 *
 * Uma única fonte para a versão exposta em `/health`, nos logs de arranque e no
 * cabeçalho `X-Zemlo-Version`. Manter isto centralizado evita o clássico desvio
 * entre a versão do `package.json` e a versão que a monitorização observa (§56).
 */

/** Versão da plataforma. Alterar aqui ao cortar uma release. */
export const PLATFORM_VERSION = '0.1.0';

/** Versão do contrato da API. Um cliente pode recusar-se a falar com uma versão incompatível. */
export const API_VERSION = 'v1';

/** Caminho base de todos os endpoints. */
export const API_BASE_PATH = `/api/${API_VERSION}`;

export const PRODUCT = {
  name: 'Zemlo',
  tagline: 'O teu veículo, sem ruído.',
  domain: 'appzemlo.com',
  version: PLATFORM_VERSION,
  apiVersion: API_VERSION,
  basePath: API_BASE_PATH,
} as const;
