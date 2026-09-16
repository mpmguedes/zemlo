/// <reference types="vite/client" />

/**
 * Variáveis de ambiente da aplicação web.
 *
 * Declaradas explicitamente para que um nome mal escrito (`VITE_API_BASE`, por exemplo)
 * seja um erro de compilação em vez de um `undefined` silencioso que só aparece quando
 * a aplicação tenta falar com o servidor errado.
 */
interface ImportMetaEnv {
  /** Base da API. Omissão: `/api/v1` (mesma origem, via proxy em desenvolvimento). */
  readonly VITE_API_URL?: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
