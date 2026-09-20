/**
 * Cliente HTTP da aplicação web.
 *
 * Um único ponto de saída para a API, por três razões:
 *
 *  1. **O envelope de erro é traduzido uma só vez.** A API responde sempre
 *     `{ error: { code, message, fields?, requestId } }`; aqui isso transforma-se num
 *     `ApiError` tipado. Se cada ecrã interpretasse o corpo do erro à sua maneira, o
 *     primeiro campo novo do envelope passaria a ser tratado de forma diferente em cada
 *     sítio.
 *  2. **A renovação silenciosa de sessão vive num só lugar.** Um 401 num pedido
 *     concorrente não pode desencadear cinco renovações.
 *  3. **A decisão sobre onde guardar os tokens é tomada aqui** e está documentada na
 *     mesma página do código que a aplicação.
 */

import type { ApiErrorBody, ApiErrorCode, AuthSessionResponse, AuthTokens, UserProfile } from '@zemlo/shared';

/* -------------------------------------------------------------------------- */
/* Configuração                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Base da API. Em desenvolvimento fica `/api/v1` e o proxy do Vite reencaminha para
 * `http://127.0.0.1:4000` — o browser vê sempre a mesma origem, o que elimina CORS do
 * caminho de desenvolvimento. Em produção, `VITE_API_URL` aponta para o servidor real.
 */
export const API_BASE_URL: string = import.meta.env.VITE_API_URL ?? '/api/v1';

const ACCESS_TOKEN_KEY = 'zemlo.accessToken';
const REFRESH_TOKEN_KEY = 'zemlo.refreshToken';

/* -------------------------------------------------------------------------- */
/* Erro tipado                                                                 */
/* -------------------------------------------------------------------------- */

export interface ApiFieldError {
  path: string;
  message: string;
}

/**
 * Erro da API com tudo o que o ecrã precisa para reagir.
 *
 * `fields` permite colocar a mensagem ao lado do campo certo em vez de num aviso genérico
 * no topo do formulário; `requestId` permite ao utilizador citar um identificador exato
 * quando pede ajuda — que é a diferença entre "não consigo gravar" e "não consigo gravar,
 * pedido `fba01d18…`".
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode | 'network_error';
  readonly status: number;
  readonly fields: ApiFieldError[];
  readonly requestId: string | null;

  constructor(init: {
    code: ApiErrorCode | 'network_error';
    message: string;
    status: number;
    fields?: ApiFieldError[];
    requestId?: string | null;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status;
    this.fields = init.fields ?? [];
    this.requestId = init.requestId ?? null;
  }

  /** `true` quando a API pede confirmação explícita antes de aceitar o valor (§11). */
  get isUnprocessable(): boolean {
    return this.status === 422 && this.code === 'unprocessable';
  }

  /** Mensagem de erro associada a um campo, se a API a tiver indicado. */
  fieldError(path: string): string | undefined {
    return this.fields.find((field) => field.path === path)?.message;
  }
}

/** `true` para um erro de validação (400/422) — o formulário mostra-o junto ao campo. */
export function isValidationError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === 'validation_error';
}

/* -------------------------------------------------------------------------- */
/* Tokens                                                                      */
/* -------------------------------------------------------------------------- */

/*
 * Onde vivem os tokens — e porquê.
 *
 * `accessToken` — **memória + `sessionStorage`**. Vale uma hora e é o token que viaja em
 *   cada pedido. Em `sessionStorage` (e não em `localStorage`) porque o `sessionStorage`
 *   é apagado quando o separador fecha: uma sessão abandonada num computador partilhado
 *   não fica disponível para quem abrir o browser a seguir. A cópia em memória existe
 *   para que o caminho normal não toque no armazenamento.
 *
 * `refreshToken` — **`localStorage`**. Vale 90 dias e existe precisamente para sobreviver
 *   ao fecho do separador; guardá-lo em `sessionStorage` anularia a sua função. Em troca,
 *   é legível por qualquer script da origem, pelo que o modelo de ameaça é: um XSS
 *   executa-se com a sessão do utilizador, **e este compromisso é aceite de forma
 *   consciente** porque (a) o consumidor principal do contrato é a app mobile, que não
 *   tem cookies, e a API devolve o token no corpo por isso mesmo; (b) um cookie `HttpOnly`
 *   resolveria o XSS mas reintroduziria CSRF e obrigaria a um segundo mecanismo de
 *   autenticação só para a web; (c) a defesa contra XSS é não injetar HTML — a aplicação
 *   não usa `dangerouslySetInnerHTML` em lado nenhum, e o conteúdo da API é sempre
 *   renderizado como texto pelo React.
 *
 * O modelo de ameaça completo está documentado em `docs/ARCHITECTURE.md`.
 */

let accessTokenMemory: string | null = null;

function readStorage(storage: Storage | undefined, key: string): string | null {
  // O acesso ao `localStorage` pode lançar (modo privado em alguns browsers, políticas de
  // cookies de terceiros). A aplicação tem de continuar a funcionar sem persistência — só
  // perde a sessão ao recarregar a página, o que é melhor do que um ecrã branco.
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(storage: Storage | undefined, key: string, value: string | null): void {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    /* ver `readStorage` */
  }
}

export function getAccessToken(): string | null {
  if (accessTokenMemory) return accessTokenMemory;
  accessTokenMemory = readStorage(globalThis.sessionStorage, ACCESS_TOKEN_KEY);
  return accessTokenMemory;
}

export function getRefreshToken(): string | null {
  return readStorage(globalThis.localStorage, REFRESH_TOKEN_KEY);
}

export function setTokens(tokens: AuthTokens, refreshToken: string | null): void {
  accessTokenMemory = tokens.accessToken;
  writeStorage(globalThis.sessionStorage, ACCESS_TOKEN_KEY, tokens.accessToken);
  if (refreshToken) writeStorage(globalThis.localStorage, REFRESH_TOKEN_KEY, refreshToken);
}

export function clearTokens(): void {
  accessTokenMemory = null;
  writeStorage(globalThis.sessionStorage, ACCESS_TOKEN_KEY, null);
  writeStorage(globalThis.localStorage, REFRESH_TOKEN_KEY, null);
}

/* -------------------------------------------------------------------------- */
/* Sessão expirada                                                             */
/* -------------------------------------------------------------------------- */

/*
 * O cliente não conhece o router (não é um componente React) e não deve conhecer: um
 * `window.location.assign('/login')` recarregaria a aplicação inteira e perderia o
 * estado. Em vez disso, quem monta a aplicação registra o que fazer quando a sessão
 * termina, e o cliente limita-se a avisar.
 */
let sessionExpiredHandler: (() => void) | null = null;

export function onSessionExpired(handler: (() => void) | null): void {
  sessionExpiredHandler = handler;
}

/* -------------------------------------------------------------------------- */
/* Pedido base                                                                 */
/* -------------------------------------------------------------------------- */

export interface RequestOptions {
  /** Corpo JSON. `undefined` para pedidos sem corpo. */
  body?: unknown;
  query?: QueryParams;
  signal?: AbortSignal;
  /** Cabeçalhos extra (raramente necessário). */
  headers?: Record<string, string>;
  /** Não tentar renovar a sessão — usado no próprio pedido de renovação. */
  skipRefresh?: boolean;
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

/** Constrói a cadeia de consulta ignorando valores vazios (evita `?category=`). */
export function buildQueryString(query: QueryParams | undefined): string {
  if (!query) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : '';
}

/**
 * Renovação em curso.
 *
 * Guardar a *promessa* (e não um booleano) é o que garante que dez pedidos que recebem
 * 401 ao mesmo tempo disparam **uma** renovação e ficam todos à espera dela. Com um
 * booleano, os restantes ou desistiam ou disparavam renovações concorrentes — e como a
 * API roda o `refreshToken` em cada renovação, as concorrentes invalidar-se-iam umas às
 * outras e o utilizador era expulso sem motivo.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) return false;
      const session = (await response.json()) as AuthSessionResponse & { refreshToken?: string };
      setTokens(session.tokens, session.refreshToken ?? refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

interface RawRequestInit {
  method: string;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /**
   * Corpo binário, enviado tal como está.
   *
   * É mutuamente exclusivo com `body`: um pedido ou leva JSON (que é serializado aqui) ou
   * leva bytes (que não podem ser tocados). Ter os dois campos separados, em vez de um
   * `BodyInit`, evita a ambiguidade silenciosa de um `Blob` que também é um objeto
   * serializável — `JSON.stringify(new Blob())` produz `{}` e o servidor receberia um CSV
   * vazio sem que nada falhasse.
   */
  rawBody?: { blob: Blob; contentType: string };
}

/**
 * Executa um pedido e devolve a resposta, sem interpretar o corpo.
 *
 * É aqui que vive a política de 401: um pedido não autenticado tenta **uma** renovação
 * silenciosa; se falhar, limpa os tokens e avisa quem monta a aplicação. Uma única
 * tentativa — repetir indefinidamente transformaria um erro de configuração do servidor
 * num ciclo de pedidos.
 */
async function rawRequest(path: string, init: RawRequestInit, options: RequestOptions): Promise<Response> {
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}${buildQueryString(options.query)}`;
  const token = getAccessToken();

  const body: BodyInit | undefined =
    init.rawBody !== undefined
      ? init.rawBody.blob
      : init.body !== undefined
        ? JSON.stringify(init.body)
        : undefined;

  const contentType = init.rawBody?.contentType ?? (init.body !== undefined ? 'application/json' : undefined);

  const send = async (bearer: string | null): Promise<Response> =>
    fetch(url, {
      method: init.method,
      headers: {
        Accept: 'application/json',
        ...(contentType !== undefined ? { 'Content-Type': contentType } : {}),
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        ...init.headers,
      },
      body,
      signal: init.signal,
    });

  let response: Response;
  try {
    response = await send(token);
  } catch (error) {
    // Falha de rede ou pedido abortado: distinguir os dois importa, porque um `AbortError`
    // é intencional (o utilizador mudou de ecrã) e não deve aparecer como erro.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError({
      code: 'network_error',
      status: 0,
      message: 'Não conseguimos contactar o Zemlo. Verifica a ligação à internet.',
    });
  }

  if (response.status !== 401 || options.skipRefresh) return response;

  // 401: uma tentativa de renovação, e uma só.
  const renewed = await refreshAccessToken();
  if (!renewed) {
    clearTokens();
    sessionExpiredHandler?.();
    return response;
  }

  return send(getAccessToken());
}

/** Traduz o envelope de erro da API, com um corpo de recurso para respostas sem JSON. */
async function toApiError(response: Response): Promise<ApiError> {
  let payload: ApiErrorBody | null = null;
  try {
    payload = (await response.json()) as ApiErrorBody;
  } catch {
    payload = null;
  }

  const envelope = payload?.error;
  return new ApiError({
    code: envelope?.code ?? fallbackCode(response.status),
    status: response.status,
    message: envelope?.message ?? fallbackMessage(response.status),
    fields: envelope?.fields ?? [],
    // O `X-Request-Id` do cabeçalho é o mesmo identificador do corpo; usá-lo como reserva
    // garante que o identificador de suporte existe mesmo numa resposta sem envelope.
    requestId: envelope?.requestId ?? response.headers.get('X-Request-Id'),
  });
}

function fallbackCode(status: number): ApiErrorCode {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'service_unavailable';
  if (status >= 500) return 'internal_error';
  return 'validation_error';
}

function fallbackMessage(status: number): string {
  if (status === 429) return 'Demasiados pedidos seguidos. Aguarda um momento e tenta de novo.';
  if (status === 503) return 'O Zemlo está em manutenção. Tenta daqui a pouco.';
  if (status >= 500) return 'Algo falhou do nosso lado. Já estamos a tratar disso.';
  return 'Não foi possível concluir o pedido.';
}

/* -------------------------------------------------------------------------- */
/* Superfície pública                                                          */
/* -------------------------------------------------------------------------- */

export interface Client {
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  delete<T = void>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  /** Descarrega um ficheiro (exportação §54), devolvendo bytes e nome sugerido. */
  download(path: string, options?: RequestOptions): Promise<{ blob: Blob; fileName: string | null }>;
  /**
   * Envia os **bytes originais** de um ficheiro, com o `Content-Type` declarado.
   *
   * Existe porque o corpo destes pedidos é o próprio ficheiro e não JSON: o `post` serializa
   * o corpo, e serializar um CSV em JSON destruiria exatamente aquilo que o servidor tem de
   * receber — os bytes, cujo `sha256` é a identidade do ficheiro usada na idempotência.
   *
   * O `Content-Type` é passado explicitamente (e não deixado ao browser) porque a API decide
   * se lê o corpo a partir dele: um `multipart/form-data` é recusado com 415, e o browser
   * usaria esse tipo se enviássemos um `FormData`.
   */
  upload<T>(path: string, body: Blob, contentType: string, options?: RequestOptions): Promise<T>;
}

async function parse<T>(response: Response): Promise<T> {
  if (!response.ok) throw await toApiError(response);
  // 204 e respostas sem corpo (o `DELETE` da API) não têm JSON para analisar.
  if (response.status === 204 || response.headers.get('Content-Length') === '0') {
    return undefined as T;
  }
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const api: Client = {
  async get<T>(path: string, options: RequestOptions = {}) {
    const response = await rawRequest(path, { method: 'GET' }, options);
    return parse<T>(response);
  },

  async post<T>(path: string, body?: unknown, options: RequestOptions = {}) {
    const response = await rawRequest(path, { method: 'POST', body: body ?? {} }, options);
    return parse<T>(response);
  },

  async patch<T>(path: string, body?: unknown, options: RequestOptions = {}) {
    const response = await rawRequest(path, { method: 'PATCH', body: body ?? {} }, options);
    return parse<T>(response);
  },

  async delete<T = void>(path: string, body?: unknown, options: RequestOptions = {}) {
    const response = await rawRequest(path, { method: 'DELETE', body }, options);
    return parse<T>(response);
  },

  async download(path: string, options: RequestOptions = {}) {
    const response = await rawRequest(path, { method: 'GET' }, options);
    if (!response.ok) throw await toApiError(response);

    // O nome do ficheiro vem do `Content-Disposition`; a API constrói-o com a data da
    // exportação, e reescrevê-lo aqui a partir da data do browser produziria um nome
    // diferente do que ficou registado em auditoria.
    const disposition = response.headers.get('Content-Disposition') ?? '';
    const match = /filename="?([^";]+)"?/i.exec(disposition);
    return { blob: await response.blob(), fileName: match?.[1] ?? null };
  },

  async upload<T>(path: string, body: Blob, contentType: string, options: RequestOptions = {}) {
    const response = await rawRequest(
      path,
      { method: 'POST', rawBody: { blob: body, contentType } },
      options,
    );
    return parse<T>(response);
  },
};

/* -------------------------------------------------------------------------- */
/* Autenticação                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Resposta de sessão com o `refreshToken` incluído.
 *
 * A API devolve o token de renovação no corpo (`apps/api/src/http/routes/auth.ts`), mas o
 * tipo partilhado `AuthSessionResponse` descreve apenas `{ user, tokens }` — o token
 * opcional é tratado aqui. A ausência de `refreshToken` é tolerada de propósito: a
 * renovação silenciosa passa a não ser possível, a sessão dura o tempo do token de acesso
 * (uma hora) e a aplicação continua a funcionar. Falhar o início de sessão por causa de um
 * campo que o servidor decidiu não devolver seria desproporcionado.
 */
export interface AuthResponse extends AuthSessionResponse {
  refreshToken?: string;
}

export interface SignUpPayload {
  email: string;
  password: string;
  name?: string;
  acceptedTerms: true;
  inviteCode?: string;
}

export const auth = {
  async login(email: string, password: string, totp?: string): Promise<AuthResponse> {
    const session = await api.post<AuthResponse>('/auth/login', {
      email,
      password,
      ...(totp ? { totp } : {}),
    });
    setTokens(session.tokens, session.refreshToken ?? null);
    return session;
  },

  async signup(payload: SignUpPayload): Promise<AuthResponse> {
    const session = await api.post<AuthResponse>('/auth/signup', payload);
    setTokens(session.tokens, session.refreshToken ?? null);
    return session;
  },

  async logout(): Promise<void> {
    try {
      await api.post('/auth/logout');
    } finally {
      // Limpar sempre, mesmo que o servidor falhe: o utilizador pediu para sair, e manter
      // um token válido em armazenamento depois de um "sair" seria mentir-lhe.
      clearTokens();
    }
  },

  async me(): Promise<UserProfile> {
    return api.get<UserProfile>('/me');
  },

  /**
   * Pede a recuperação de password.
   *
   * A resposta é a mesma exista ou não a conta — a API responde 202 com uma mensagem
   * uniforme e este método não devolve nada que a distinga. O ecrã não pode, por isso,
   * mostrar "email enviado" de forma condicional: mostra a mesma confirmação nos dois
   * casos, que é o que impede o formulário de ser um oráculo de existência de contas.
   */
  async requestPasswordReset(email: string): Promise<void> {
    await api.post('/auth/password-reset', { email });
  },

  /** Conclui a recuperação com o token recebido por email. */
  async confirmPasswordReset(token: string, newPassword: string): Promise<{ revokedSessions: number }> {
    return api.post('/auth/password-reset/confirm', { token, newPassword });
  },
};

/* -------------------------------------------------------------------------- */
/* Ficheiros                                                                   */
/* -------------------------------------------------------------------------- */

/** Dispara o download de um `Blob` no browser, respeitando o nome sugerido pela API. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revogar no ciclo seguinte: o Safari inicia o download de forma assíncrona, e revogar
  // imediatamente produziria um ficheiro vazio.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
