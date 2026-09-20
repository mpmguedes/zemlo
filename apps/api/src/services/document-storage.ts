/**
 * Armazenamento dos **bytes originais** dos documentos (§5.6, §17, decisão 1).
 *
 * ## O problema que este ficheiro resolve
 *
 * O `Document` guarda metadados e uma **referência opaca** (`storageKey`). Até agora essa
 * referência existia no modelo, era aceite na criação e devolvida na leitura — mas nada
 * lhe dava significado: não havia forma de **guardar bytes, lê-los de volta, verificar se
 * existem ou apagá-los**. Para a exportação nativa cumprir a §5.6 ("os bytes são copiados
 * sem conversão, sem recompressão"; "um PDF exportado é byte a byte o mesmo PDF") é preciso
 * que os bytes existam em algum sítio de onde possam ser lidos.
 *
 * ## O que este ficheiro é, e o que deliberadamente não é
 *
 * É uma **abstração mínima** com quatro operações — `save`, `read`, `exists`, `remove` — e
 * uma implementação local (sistema de ficheiros, dentro do directório de dados da API).
 *
 * Não é um servidor de ficheiros, não serve HTTP, não emite URLs assinados e não decide
 * autorização: a decisão de quem pode ler o quê continua a viver no serviço de documentos
 * (§30). O que a abstração garante é que **o resto do código não conhece o sistema de
 * ficheiros**: quem chama fala de `storageKey`, nunca de caminhos. Trocar o backend local
 * por armazenamento de objetos é escrever uma segunda implementação de `DocumentStorage`,
 * sem tocar em `documents.ts`, no exportador nem no importador.
 *
 * ## Porque é que o `storageKey` continua opaco
 *
 * O `storageKey` **não** é um caminho. É um identificador lógico que a implementação
 * traduz para onde quiser: hoje, um ficheiro sob uma raiz; amanhã, uma chave de um bucket.
 * O domínio nunca faz `resolve(root, storageKey)` nem `join(storageKey, …)` — se o fizesse,
 * a referência deixaria de ser opaca e o modelo de documentos passaria a depender de o
 * armazenamento ser um sistema de ficheiros, que é exatamente o acoplamento que a decisão
 * de arquitetura proíbe.
 *
 * ## Porque é que a chave carrega o `userId`
 *
 * Os bytes têm de ser **isolados por utilizador** como tudo o resto. A chave tem a forma
 * `<userId>/<id>`, com o `userId` derivado do pedido autenticado — nunca do ficheiro nem de
 * um campo do bundle. Como todas as operações passam o `userId` à parte e a implementação
 * verifica que o prefixo da chave corresponde, um `storageKey` de outra conta não é lido
 * nem apagado, mesmo que fosse adivinhado (§13.4: "os dados dessa conta não são tocados").
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

/* -------------------------------------------------------------------------- */
/* Contrato                                                                    */
/* -------------------------------------------------------------------------- */

/** Bytes de um documento e os metadados que os descrevem. */
export interface StoredBytes {
  readonly bytes: Buffer;
  /** Tamanho real, medido sobre os bytes lidos. */
  readonly sizeBytes: number;
  /** `sha256` dos bytes lidos — a mesma verificação que a §5.6 exige no manifest. */
  readonly sha256: string;
}

/**
 * O que o resto do código precisa de poder fazer com os bytes de um documento.
 *
 * Quatro operações, e nenhuma delas fala de caminhos: uma implementação por armazenamento
 * de objetos satisfaz esta interface sem que os consumidores mudem.
 */
export interface DocumentStorage {
  /**
   * Guarda bytes e devolve a referência opaca que os identifica.
   *
   * O `userId` determina o espaço de nomes: os bytes de um utilizador nunca caem no mesmo
   * prefixo que os de outro.
   */
  save(userId: string, bytes: Uint8Array): Promise<string>;

  /** Lê os bytes referenciados por `storageKey`, ou `null` se não existirem. */
  read(userId: string, storageKey: string): Promise<StoredBytes | null>;

  /** `true` quando existem bytes para `storageKey`, no espaço do `userId`. */
  exists(userId: string, storageKey: string): Promise<boolean>;

  /** Apaga os bytes. Idempotente: apagar o que já não existe não é um erro. */
  remove(userId: string, storageKey: string): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* Implementação local (sistema de ficheiros)                                  */
/* -------------------------------------------------------------------------- */

/**
 * Erro de armazenamento.
 *
 * Distinto de um erro de negócio: um `storageKey` que sai do espaço de nomes do
 * utilizador é uma **tentativa de acesso indevido**, não um ficheiro em falta, e a
 * mensagem diz qual dos dois casos ocorreu.
 */
export class StorageKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageKeyError';
  }
}

/**
 * O separador entre o `userId` e o resto da chave.
 *
 * `/` porque a chave é também o caminho relativo da implementação local — mas o resto do
 * código nunca o reconstrói a partir de pedaços: recebe a chave inteira de `save` e
 * devolve-a inteira a `read`.
 */
const KEY_SEPARATOR = '/';

/** `sha256` em hexadecimal minúsculo — o mesmo formato que o manifest exige (§5.6). */
export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * O `sha256` de um conteúdo vazio.
 *
 * Útil aos testes e ao diagnóstico: distingue "não há bytes" de "há bytes, e são vazios".
 */
export const EMPTY_SHA256 = sha256Hex(new Uint8Array(0));

/**
 * Valida uma chave antes de a usar como caminho.
 *
 * A chave é opaca para o domínio, mas **não** é opaca para esta implementação: aqui ela
 * tem de ser transformada num caminho, e é esta função que impede que um `storageKey`
 * manipulado (`../../etc/passwd`, um caminho absoluto, uma chave de outra conta) alcance
 * um ficheiro fora da raiz. As mesmas recusas que o leitor de ZIP aplica a um nome de
 * entrada (§7.3), pela mesma razão: a chave entra por um caminho que pode ter passado pela
 * rede.
 */
function assertSafeKey(userId: string, storageKey: string): void {
  if (userId.length === 0) {
    throw new StorageKeyError('Um documento não pode ser guardado sem dono.');
  }
  if (storageKey.length === 0) {
    throw new StorageKeyError('A referência do documento está vazia.');
  }
  // Caminhos absolutos e UNC. Verificados antes da regra geral sobre separadores, para o
  // diagnóstico ser específico.
  if (storageKey.startsWith('/') || storageKey.startsWith('\\') || /^[a-zA-Z]:/.test(storageKey)) {
    throw new StorageKeyError(
      `A referência do documento (${storageKey}) é um caminho absoluto.`,
    );
  }
  // Separadores Windows num caminho relativo: o formato não os usa e traduzi-los
  // inventaria um caminho que a chave não declarava.
  if (storageKey.includes('\\')) {
    throw new StorageKeyError(
      `A referência do documento (${storageKey}) tem separadores Windows.`,
    );
  }
  // Segmentos vazios, `.` e `..`. Um `..` deixaria a chave sair da raiz.
  for (const segment of storageKey.split(KEY_SEPARATOR)) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new StorageKeyError(
        `A referência do documento (${storageKey}) não designa um ficheiro dentro do espaço do utilizador.`,
      );
    }
  }
  // Isolamento por utilizador: a chave **tem** de começar pelo dono. Sem isto, uma chave
  // de outra conta seria aceite e o isolamento dependeria de quem chama.
  const prefix = `${userId}${KEY_SEPARATOR}`;
  if (!storageKey.startsWith(prefix)) {
    throw new StorageKeyError(
      'O documento não pertence a esta conta. Nada foi lido nem alterado.',
    );
  }
}

/**
 * Armazenamento local: um ficheiro por documento, sob `root`.
 *
 * A raiz é passada no construtor — nunca lida de uma constante global — para que os testes
 * lhe dêem um directório temporário e a aplicação use o directório de dados. Duas
 * instâncias apontam para sítios diferentes sem partilhar estado nenhum.
 *
 * ## Escrita atómica
 *
 * `save` escreve num ficheiro temporário irmão e só depois o renomeia para o nome final.
 * `rename` sobre o mesmo sistema de ficheiros é atómico, pelo que um leitor nunca observa
 * um documento a meio da escrita — importante porque a exportação pode ler bytes enquanto
 * uma gravação decorre. Se algo falhar antes do `rename`, o temporário é removido e o
 * documento anterior (ou nenhum) fica intacto: não há ficheiros truncados.
 */
export class LocalDocumentStorage implements DocumentStorage {
  constructor(private readonly root: string) {}

  async save(userId: string, bytes: Uint8Array): Promise<string> {
    if (userId.length === 0) {
      throw new StorageKeyError('Um documento não pode ser guardado sem dono.');
    }

    // O identificador é aleatório: dois envios do mesmo ficheiro ficam com chaves
    // distintas, pelo que um documento novo nunca é confundido com um antigo por
    // coincidência de nome. O `userId` vai à frente — é o espaço de nomes.
    const id = randomBytes(16).toString('hex');
    const key = `${userId}${KEY_SEPARATOR}${id}`;
    const target = this.pathFor(userId, key);
    const temporary = `${target}.tmp-${randomBytes(6).toString('hex')}`;

    await mkdir(dirname(target), { recursive: true });

    try {
      await writeFile(temporary, bytes);
      await rename(temporary, target);
    } catch (error) {
      // Limpeza best-effort do temporário. Não escondemos o erro original: se a limpeza
      // falhar, o erro que interessa é o da escrita.
      await rm(temporary, { force: true });
      throw error;
    }

    return key;
  }

  async read(userId: string, storageKey: string): Promise<StoredBytes | null> {
    assertSafeKey(userId, storageKey);
    const path = this.pathFor(userId, storageKey);

    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }

    return { bytes, sizeBytes: bytes.byteLength, sha256: sha256Hex(bytes) };
  }

  async exists(userId: string, storageKey: string): Promise<boolean> {
    assertSafeKey(userId, storageKey);
    return existsSync(this.pathFor(userId, storageKey));
  }

  async remove(userId: string, storageKey: string): Promise<void> {
    assertSafeKey(userId, storageKey);
    // `force` torna a operação idempotente: apagar o que já não existe não é um erro.
    await rm(this.pathFor(userId, storageKey), { force: true });
  }

  /**
   * Traduz uma chave no caminho absoluto do ficheiro.
   *
   * A verificação de que o caminho continua **dentro da raiz** é redundante depois de
   * `assertSafeKey`, mas é feita na mesma: é a única linha que transforma uma string numa
   * localização concreta, e uma defesa redundante no ponto exato onde o acoplamento
   * acontece vale mais do que confiar que a validação a montante nunca será afrouxada.
   */
  private pathFor(userId: string, storageKey: string): string {
    const root = resolve(this.root);
    const candidate = resolve(root, storageKey);

    if (candidate !== root && !candidate.startsWith(root + sep)) {
      throw new StorageKeyError(
        'A referência do documento apontaria para fora do armazenamento. A operação foi recusada.',
      );
    }

    // O `userId` é verificado outra vez, agora contra o caminho resolvido: se um dia a
    // forma da chave mudar, o isolamento por conta continua a ser imposto aqui.
    const userRoot = resolve(root, userId);
    if (candidate !== userRoot && !candidate.startsWith(userRoot + sep)) {
      throw new StorageKeyError(
        'O documento não pertence a esta conta. Nada foi lido nem alterado.',
      );
    }

    return candidate;
  }
}

/** `true` quando um erro é um `ENOENT` do sistema de ficheiros. */
function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

/* -------------------------------------------------------------------------- */
/* Instância da aplicação                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Raiz do armazenamento local, derivada do directório de dados da API.
 *
 * Fica em `file:` da mesma base de dados local? Não: um ficheiro SQLite é uma coisa e os
 * bytes dos documentos são outra. O directório é `documents-storage/` ao lado da base de
 * dados, e é configurável por `DOCUMENT_STORAGE_DIR` para que uma instalação possa apontá-lo
 * para um volume dedicado sem tocar no código.
 */
export function defaultStorageRoot(): string {
  const configured = process.env['DOCUMENT_STORAGE_DIR'];
  if (configured && configured.length > 0) return configured;

  // Ao lado do ficheiro da base de dados, quando este é um caminho local; caso contrário,
  // um directório de dados convencional na raiz do projecto.
  const databaseUrl = process.env['DATABASE_URL'] ?? '';
  if (databaseUrl.startsWith('file:')) {
    const filePath = databaseUrl.slice('file:'.length);
    return join(dirname(resolve(filePath)), 'documents-storage');
  }

  return resolve(process.cwd(), 'data', 'documents-storage');
}

let shared: DocumentStorage | null = null;

/**
 * A instância usada pela aplicação.
 *
 * Preguiçosa para que os testes possam definir `DOCUMENT_STORAGE_DIR` antes da primeira
 * utilização, e reiniciável por `resetDocumentStorage()` — que existe precisamente para o
 * teste seguinte poder começar com um armazenamento limpo.
 */
export function documentStorage(): DocumentStorage {
  shared ??= new LocalDocumentStorage(defaultStorageRoot());
  return shared;
}

/** Substitui a instância partilhada. Usado pelos testes; nunca pelo código de produção. */
export function setDocumentStorage(storage: DocumentStorage): void {
  shared = storage;
}

/** Descarta a instância partilhada, para que a próxima chamada a recrie. */
export function resetDocumentStorage(): void {
  shared = null;
}
