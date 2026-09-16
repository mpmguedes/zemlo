/**
 * Valores JSON portáveis entre PostgreSQL e SQLite.
 *
 * O schema canónico (PostgreSQL) tem colunas `Json` a sério. O schema derivado para
 * SQLite expõe a mesma coluna como `String`, porque o motor não tem tipo JSON
 * nativo. Para que o código de domínio não tenha de saber em que base de dados está
 * a correr — e para que a variante SQLite continue a ser apenas um detalhe de
 * desenvolvimento — toda a leitura e escrita passa por estas funções.
 *
 * Efeito secundário útil: `readJsonObject` aceita tanto texto como objeto, pelo que
 * uma migração de SQLite para PostgreSQL não obriga a reescrever dados.
 */

/**
 * Valor pronto para escrita numa coluna que é `Json` em PostgreSQL e `String` em SQLite.
 *
 * O tipo é deliberadamente `never`, e o `cast` está confinado a este ficheiro. O Prisma
 * tipa as colunas `Json` como `InputJsonValue`, **mas** tipa as mesmas colunas na
 * variante SQLite como texto (e o cliente gerado é um só). Como guardamos sempre JSON
 * serializado, o valor é válido nos dois motores — e esta é a única linha do projeto
 * que precisa de o afirmar. Sem isto, cada serviço teria o seu próprio `as any`, que é
 * exatamente o que queremos evitar.
 */
export type JsonColumnValue = never;

/** Serializa um objeto para escrita numa coluna JSON/String. */
export function writeJson(value: unknown): JsonColumnValue {
  if (value === undefined || value === null) return null as JsonColumnValue;
  try {
    return JSON.stringify(value) as JsonColumnValue;
  } catch {
    return null as JsonColumnValue;
  }
}

/**
 * Serializa um objeto, ou devolve `null` quando não há valor.
 *
 * Existe porque usar o resultado de `writeJson` dentro de um ternário alarga o tipo
 * para `undefined` e o Prisma rejeita `undefined` em campos que considera opcionais.
 * Esta função tem um tipo de retorno único e evita o problema na origem.
 */
export function jsonOrNull(value: unknown): JsonColumnValue {
  return writeJson(value);
}

/** Lê uma coluna JSON/String como objeto. Devolve `{}` quando não há nada legível. */
export function readJsonObject<T extends Record<string, unknown> = Record<string, unknown>>(
  value: unknown,
): Partial<T> {
  const parsed = readJson<T>(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

/** Lê uma coluna JSON/String como valor arbitrário. */
export function readJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value as T;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === 'null') return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

/** Lê uma coluna JSON/String como lista. Devolve `[]` quando não é uma lista. */
export function readJsonArray<T>(value: unknown): T[] {
  const parsed = readJson<unknown>(value);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

/** Lê uma coluna JSON/String como valor escalar (string, número, booleano). */
export function readJsonScalar<T extends string | number | boolean>(value: unknown): T | null {
  const parsed = readJson<T>(value);
  if (parsed === null || typeof parsed === 'object') return null;
  return parsed;
}
