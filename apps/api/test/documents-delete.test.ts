/**
 * Eliminação de documentos: os bytes saem com o registo (`PROD-007`, fecha `PC-13`).
 *
 * ## O que é que estes testes provam
 *
 * Até esta tarefa, `documentStorage().remove()` tinha **zero chamadores** em
 * `apps/api/src/`: `deleteDocument` apagava a linha, os eventos e os lembretes, e deixava o
 * ficheiro no armazenamento para sempre. O utilizador apagava um documento de 8 MB e o
 * espaço continuava ocupado — sem erro, sem aviso e sem forma de o recuperar pela API.
 *
 * Uma asserção sobre o `status` não prova nada disto: `204` era exactamente o que a versão
 * com o defeito devolvia. O que prova é a **contagem de ficheiros no disco**, antes e
 * depois. É por isso que este ficheiro usa um armazenamento real, num directório temporário,
 * e lê o directório — em vez de substituir o armazenamento por um duplo que registaria
 * chamadas (um duplo registaria a chamada e não a ausência do ficheiro, que é o que
 * interessa).
 *
 * As propriedades verificadas:
 *
 *  - **os bytes saem com o registo** — o ficheiro existe antes e não existe depois;
 *  - **a invariante assimétrica** — o registo sai **primeiro**: uma falha do armazenamento
 *    deixa bytes sem dono (recuperável por uma limpeza futura), nunca um registo a apontar
 *    para um ficheiro inexistente (não recuperável pelo utilizador). Provado nos dois
 *    sentidos: com o armazenamento a falhar, e com a base de dados a falhar;
 *  - **uma falha do armazenamento não faz falhar a eliminação** — o pedido continua a ser
 *    `204`, e o resíduo fica observável no log, **com o `documentId` e sem a chave**;
 *  - **um ficheiro ainda referenciado não é apagado** — nem o de outro documento, nem o de
 *    outra conta, nem o de um segundo registo que aponte para a mesma chave (`PC-21`);
 *  - **apagar o que já não existe não é um erro** — o `remove` do armazenamento é
 *    idempotente, e um ficheiro que desapareceu do disco entre a listagem e a eliminação não
 *    pode transformar a operação num `500`.
 *
 * ## O que estes testes não fazem
 *
 * Não substituem o serviço nem o repositório: passam por `createApp()` e pelo contrato HTTP,
 * contra a base de dados a sério. A única substituição é o armazenamento — e apenas num
 * teste, o da falha, porque uma falha de disco não se provoca de outra maneira.
 *
 * ## A base de dados e o armazenamento
 *
 * Como em `documents-http.test.ts` e `reminders-http.test.ts`: a `DATABASE_URL` é definida
 * **antes** de a aplicação ser importada, porque o `core/db.ts` instancia o cliente no
 * import. O armazenamento é apontado a um directório temporário por `DOCUMENT_STORAGE_DIR`,
 * pelo mesmo motivo — e porque é o mecanismo que a produção usa para apontar os bytes a um
 * volume dedicado, e não um caminho paralelo só para testes.
 */

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

/*
 * O cliente é tipado a partir da **própria aplicação**, e não de `@zemlo/prisma-sqlite`.
 * Medido: `core/prisma-client.ts` fixa o tipo em `client-postgres.js` (os dois clientes
 * gerados são nominalmente distintos, e é o canónico que dá a forma), pelo que um
 * `PrismaClient` importado do pacote SQLite não é atribuível ao objecto que `core/db.js`
 * exporta — `tsc` recusa a atribuição com `TS2322` seguido de `TS2589`. Um `import type`
 * não carrega o módulo em runtime, portanto não antecipa o `DATABASE_URL`.
 */
import type { PrismaClient } from '../src/core/db.js';

import { createTestDb, createVehicle, type TestDb } from './helpers/db.js';
import {
  LocalDocumentStorage,
  resetDocumentStorage,
  setDocumentStorage,
  type DocumentStorage,
} from '../src/services/document-storage.js';

/* -------------------------------------------------------------------------- */
/* Infraestrutura                                                              */
/* -------------------------------------------------------------------------- */

const BASE = '/api/v1';

let db: TestDb;
let app: Express;
let appPrisma: PrismaClient;

/** Raiz do armazenamento desta suite. Fora do repositório, apagada no fim. */
let storageRoot: string;

beforeAll(async () => {
  db = await createTestDb();

  process.env.DATABASE_URL = db.url;
  process.env.DATABASE_PROVIDER = 'sqlite';
  process.env.NODE_ENV = 'test';

  /*
   * O armazenamento é apontado antes de a aplicação ser importada: `defaultStorageRoot()`
   * lê `DOCUMENT_STORAGE_DIR` e a instância partilhada é criada na primeira utilização.
   */
  storageRoot = await mkdtemp(join(tmpdir(), 'zemlo-doc-delete-'));
  process.env.DOCUMENT_STORAGE_DIR = storageRoot;
  resetDocumentStorage();

  const [{ createApp }, { prisma }] = await Promise.all([
    import('../src/app.js'),
    import('../src/core/db.js'),
  ]);

  appPrisma = prisma;
  app = createApp();

  const probe = await appPrisma.user.create({
    data: { email: 'sonda-eliminacao@zemlo.test', name: 'Sonda' },
    select: { id: true },
  });
  expect(
    await db.prisma.user.findUnique({ where: { id: probe.id } }),
    'A aplicação não está ligada à base de dados temporária. O DATABASE_URL não foi aplicado antes de a app ser importada.',
  ).not.toBeNull();
  await appPrisma.user.deleteMany();
}, 120_000);

afterAll(async () => {
  // Fechar o cliente da aplicação primeiro: no Windows, o ficheiro SQLite aberto impediria
  // a remoção do directório com `EBUSY`.
  await appPrisma.$disconnect();
  await db.destroy();
  await rm(storageRoot, { recursive: true, force: true });
});

afterEach(() => {
  /*
   * Um teste que substitua o armazenamento não pode contaminar o seguinte. `reset` (e não
   * uma reposição do original) faz a próxima chamada recriar o `LocalDocumentStorage` a
   * partir de `DOCUMENT_STORAGE_DIR` — o mesmo objecto que a produção usaria.
   */
  resetDocumentStorage();
});

/* -------------------------------------------------------------------------- */
/* Utilitários                                                                 */
/* -------------------------------------------------------------------------- */

let emailCounter = 0;

/** Uma conta nova por teste: o isolamento entre testes não depende da ordem de limpeza. */
async function signup(): Promise<{ token: string; userId: string }> {
  emailCounter += 1;
  const email = `eliminacao-${emailCounter}-${Math.random().toString(36).slice(2, 8)}@zemlo.test`;

  const response = await request(app)
    .post(`${BASE}/auth/signup`)
    .send({ email, password: 'Password-de-teste-1', name: 'Dono', acceptedTerms: true });

  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return {
    token: response.body.tokens.accessToken as string,
    userId: response.body.user.id as string,
  };
}

async function createDocument(token: string, body: Record<string, unknown> = {}): Promise<string> {
  const response = await request(app)
    .post(`${BASE}/documents`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Documento Único', category: 'registration', ...body });

  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.id as string;
}

async function upload(
  token: string,
  documentId: string,
  bytes: Buffer,
  contentType = 'application/pdf',
): Promise<request.Response> {
  return request(app)
    .post(`${BASE}/documents/${documentId}/content`)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', contentType)
    .send(bytes);
}

function deleteDocument(token: string, documentId: string): Promise<request.Response> {
  return request(app)
    .delete(`${BASE}/documents/${documentId}`)
    .set('Authorization', `Bearer ${token}`);
}

/**
 * Os ficheiros que existem no espaço de um utilizador.
 *
 * A leitura é feita no **disco**, e não através do armazenamento: uma asserção que passasse
 * por `exists()` provaria que o armazenamento concorda consigo próprio, não que o ficheiro
 * desapareceu.
 */
async function storedFiles(userId: string): Promise<string[]> {
  try {
    return await readdir(join(storageRoot, userId));
  } catch {
    // O directório só existe depois do primeiro `save`. Ausente = vazio.
    return [];
  }
}

/** Bytes reconhecíveis, para o download poder ser comparado byte a byte. */
function bytesFor(seed: number, length = 64): Buffer {
  const bytes = Buffer.alloc(length);
  for (let index = 0; index < length; index += 1) bytes[index] = (seed + index) & 0xff;
  return bytes;
}

/**
 * Corre `run` com a escrita em `stdout` capturada, sem a silenciar.
 *
 * O logger escreve `info`/`warn` em `stdout` (só `error` vai para `stderr`), pelo que é
 * aqui que o aviso da remoção falhada aparece. Os pedaços capturados são **reencaminhados**
 * para o destino original: o relatório do Vitest continua a sair, e o teste não tem de
 * desligar a saída para a poder observar.
 */
async function captureStdout<T>(run: () => Promise<T>): Promise<{ result: T; output: string }> {
  const original = process.stdout.write.bind(process.stdout);
  const chunks: string[] = [];

  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((
    chunk: unknown,
    ...rest: unknown[]
  ) => {
    chunks.push(
      typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : '',
    );
    return (original as unknown as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write);

  try {
    const result = await run();
    return { result, output: chunks.join('') };
  } finally {
    spy.mockRestore();
  }
}

/**
 * Um armazenamento que funciona, excepto em `remove`.
 *
 * O `remove` lança o erro **como o `node:fs` o lançaria**: com o caminho na mensagem. É essa
 * a forma real, e é por isso que a asserção do log verifica que a chave **não** aparece —
 * um `remove` que lançasse `new Error('falhou')` não exercia a defesa.
 */
function storageFailingOnRemove(real: DocumentStorage, storageKey: string): DocumentStorage {
  return {
    save: (userId, bytes) => real.save(userId, bytes),
    read: (userId, key) => real.read(userId, key),
    exists: (userId, key) => real.exists(userId, key),
    remove: () => {
      const error = new Error(
        `EACCES: permission denied, unlink '${join(storageRoot, storageKey)}'`,
      ) as NodeJS.ErrnoException;
      error.code = 'EACCES';
      return Promise.reject(error);
    },
  };
}

/* ========================================================================== */
/* 1. O caminho feliz: o ficheiro sai com o registo                            */
/* ========================================================================== */

describe('eliminação com ficheiro', () => {
  it('remove os bytes do disco, o registo e a sua existência na lista', async () => {
    const { token, userId } = await signup();
    const documentId = await createDocument(token);

    const bytes = bytesFor(7);
    expect((await upload(token, documentId, bytes)).status).toBe(200);

    // O ficheiro existe mesmo — sem esta asserção, a contagem final em 0 poderia passar
    // porque o upload nunca escreveu nada.
    expect(await storedFiles(userId)).toHaveLength(1);

    const response = await deleteDocument(token, documentId);
    expect(response.status, JSON.stringify(response.body)).toBe(204);

    // A asserção que a versão com o defeito falhava: o espaço é devolvido.
    expect(await storedFiles(userId)).toHaveLength(0);

    // E o registo desapareceu mesmo — da resposta e da base de dados.
    expect((await request(app).get(`${BASE}/documents/${documentId}`).set('Authorization', `Bearer ${token}`)).status).toBe(404);
    expect(await appPrisma.document.count({ where: { id: documentId } })).toBe(0);
  });

  it('não apaga o ficheiro de outro documento da mesma conta', async () => {
    const { token, userId } = await signup();
    const first = await createDocument(token, { name: 'Primeiro' });
    const second = await createDocument(token, { name: 'Segundo' });

    const firstBytes = bytesFor(11);
    const secondBytes = bytesFor(200);
    expect((await upload(token, first, firstBytes)).status).toBe(200);
    expect((await upload(token, second, secondBytes)).status).toBe(200);
    expect(await storedFiles(userId)).toHaveLength(2);

    expect((await deleteDocument(token, first)).status).toBe(204);

    // Fica exactamente um ficheiro — o do outro documento.
    const remaining = await storedFiles(userId);
    expect(remaining).toHaveLength(1);

    // E não é "um ficheiro qualquer": o download do segundo continua a devolver os bytes
    // originais. Uma contagem sozinha não distinguiria "ficou o certo" de "ficou o errado".
    const download = await request(app)
      .get(`${BASE}/documents/${second}/content`)
      .set('Authorization', `Bearer ${token}`);
    expect(download.status).toBe(200);
    expect(Buffer.from(download.body as Buffer).equals(secondBytes)).toBe(true);
  });
});

/* ========================================================================== */
/* 2. Sem ficheiro                                                             */
/* ========================================================================== */

describe('eliminação sem ficheiro', () => {
  it('elimina um documento que nunca teve bytes, sem erro e sem criar nada', async () => {
    const { token, userId } = await signup();
    const documentId = await createDocument(token, { fileName: null, mimeType: null });

    expect((await deleteDocument(token, documentId)).status).toBe(204);

    expect(await appPrisma.document.count({ where: { id: documentId } })).toBe(0);
    expect(await storedFiles(userId)).toHaveLength(0);
  });
});

/* ========================================================================== */
/* 3. Falha do armazenamento                                                   */
/* ========================================================================== */

describe('falha do armazenamento', () => {
  it('elimina o registo na mesma e deixa o resíduo observável, sem a chave no log', async () => {
    const { token, userId } = await signup();
    const documentId = await createDocument(token);
    expect((await upload(token, documentId, bytesFor(3))).status).toBe(200);

    const [storedName] = await storedFiles(userId);
    expect(storedName).toBeDefined();
    const storageKey = `${userId}/${storedName}`;

    const real = new LocalDocumentStorage(storageRoot);
    setDocumentStorage(storageFailingOnRemove(real, storageKey));

    const { result, output } = await captureStdout(() => deleteDocument(token, documentId));

    /*
     * O pedido **não** falha. O utilizador pediu para apagar o registo; o registo foi
     * apagado. Devolver 500 obrigá-lo-ia a repetir um pedido que já teve efeito, e a
     * repetição responderia 404.
     */
    expect(result.status, JSON.stringify(result.body)).toBe(204);
    expect(await appPrisma.document.count({ where: { id: documentId } })).toBe(0);

    // A falha foi real: o ficheiro continua lá. Sem esta asserção, o teste passaria com um
    // `remove` que não falhasse e removesse — e não estaria a testar falha nenhuma.
    expect(await storedFiles(userId)).toHaveLength(1);

    // O resíduo é observável, com o identificador que permite encontrá-lo.
    expect(output).toContain('não foi possível remover os bytes do documento');
    expect(output).toContain(documentId);
    expect(output).toContain('EACCES');

    /*
     * E a chave **não** aparece. O caminho do ficheiro contém a chave, pelo que registar a
     * mensagem do erro — o reflexo mais natural — faria passar o resto deste teste e falhar
     * só aqui. É esta a asserção que fixa a higiene do log.
     *
     * A asserção é feita sobre o **segmento aleatório** da chave, e não sobre a chave
     * inteira, por uma razão medida. O log é escrito em JSON, e o `JSON.stringify` duplica
     * as barras invertidas do caminho: `…\<userId>\<hex>` sai como `…\\<userId>\\<hex>`.
     * Comparar a chave inteira (que usa `/`) ou a raiz (que usa `\` simples) **nunca**
     * encontra nada — nem quando a chave lá está. A primeira versão destas duas asserções
     * passou com a mutação que regista o caminho inteiro: era um falso verde, e só a
     * mutação o revelou. O `<hex>` não tem separadores, pelo que sobrevive à codificação.
     */
    const keySegment = storedName as string;
    expect(output).not.toContain(keySegment);

    // A mesma verificação sobre o caminho, com as barras repostas à forma original.
    expect(output.replace(/\\\\/g, '\\')).not.toContain(storageRoot);
  });

  it('recusa apagar a chave de outra conta e não toca no ficheiro alheio', async () => {
    const owner = await signup();
    const other = await signup();

    const ownerDocument = await createDocument(owner.token);
    expect((await upload(owner.token, ownerDocument, bytesFor(5))).status).toBe(200);

    const otherDocument = await createDocument(other.token);
    expect((await upload(other.token, otherDocument, bytesFor(250))).status).toBe(200);

    // A chave de **outra** conta, obtida do registo que lhe pertence. Montá-la à mão a
    // partir do `userId` do dono não serviria: o armazenamento aceitá-la-ia, e o teste
    // provaria o contrário do que diz provar.
    const foreign = await request(app)
      .get(`${BASE}/documents/${otherDocument}`)
      .set('Authorization', `Bearer ${other.token}`);
    const foreignKey = foreign.body.storageKey as string;
    expect(foreignKey.startsWith(`${other.userId}/`)).toBe(true);

    /*
     * A linha da outra conta sai, e os bytes ficam. É artificial de propósito: sem este
     * passo, a contagem de referências (que protege o ficheiro alheio por estar
     * referenciado) apanharia o caso **antes** de o armazenamento ser consultado, e a
     * defesa que este teste existe para exercer — `assertSafeKey` — nunca correria. O
     * estado que resta é o que interessa: um ficheiro de outra conta, sem dono.
     */
    await appPrisma.document.delete({ where: { id: otherDocument } });
    expect(await storedFiles(other.userId)).toHaveLength(1);

    /*
     * Um defeito de dados: o registo do dono passa a apontar para a chave da outra conta. O
     * armazenamento recusa-a (`assertSafeKey`), e a eliminação não pode propagar essa recusa
     * — mas também não pode apagar o ficheiro do outro.
     */
    await appPrisma.document.update({
      where: { id: ownerDocument },
      data: { storageKey: foreignKey },
    });

    const { result, output } = await captureStdout(() => deleteDocument(owner.token, ownerDocument));

    expect(result.status, JSON.stringify(result.body)).toBe(204);
    expect(await appPrisma.document.count({ where: { id: ownerDocument } })).toBe(0);

    // O ficheiro do **outro** continua onde estava: a recusa do armazenamento é o que o
    // protege, e é essa a asserção que interessa.
    expect(await storedFiles(other.userId)).toHaveLength(1);

    /*
     * E o ficheiro do dono fica órfão — não por causa da remoção, que foi recusada, mas
     * porque o registo deixou de apontar para ele antes do pedido. É o resíduo que `PC-21`
     * permite criar, e vale a pena fixá-lo aqui: se um dia `PC-21` fechar, este teste passa
     * a ter de mudar, e é isso que se quer notar.
     */
    expect(await storedFiles(owner.userId)).toHaveLength(1);

    expect(output).toContain('chave recusada pelo armazenamento');
    expect(output).not.toContain(foreignKey);
  });
});

/* ========================================================================== */
/* 3b. Falha da base de dados                                                  */
/* ========================================================================== */

describe('falha da base de dados', () => {
  it('não apaga os bytes quando o registo não chegou a ser eliminado', async () => {
    const { token, userId } = await signup();
    const documentId = await createDocument(token);
    expect((await upload(token, documentId, bytesFor(29))).status).toBe(200);
    expect(await storedFiles(userId)).toHaveLength(1);

    /*
     * A base de dados recusa a eliminação. É o caso que **distingue a ordem correcta da
     * invertida** — e a razão pela qual a ordem é uma asserção e não uma preferência: se os
     * bytes saíssem primeiro, o registo sobreviveria a apontar para um ficheiro que já não
     * existe. Ficaria um documento que a lista mostra e que o download recusa, e nenhum
     * utilizador o poderia compor pela API.
     *
     * A troca é manual, e não um `vi.spyOn`. Medido: o `spyOn` sobre o delegado do Prisma
     * **não se repõe** com `mockRestore()` — os quatro testes seguintes passaram a falhar
     * com `500` na sua própria eliminação, por um duplo que ficou instalado. Uma troca
     * directa repõe-se de forma verificável, e a reposição é verificada no fim deste teste.
     */
    const delegate = appPrisma.document as unknown as {
      delete: (args: unknown) => Promise<unknown>;
    };
    const realDelete = delegate.delete;
    delegate.delete = () => Promise.reject(new Error('a base de dados recusou a eliminação'));

    try {
      const response = await deleteDocument(token, documentId);
      expect(response.status).toBe(500);
    } finally {
      delegate.delete = realDelete;
    }

    // O registo continua lá — e, por isso, o ficheiro também tem de continuar.
    expect(await appPrisma.document.count({ where: { id: documentId } })).toBe(1);
    expect(await storedFiles(userId)).toHaveLength(1);

    // E o download continua a servir os bytes exactos: não ficou nenhum estado intermédio.
    const download = await request(app)
      .get(`${BASE}/documents/${documentId}/content`)
      .set('Authorization', `Bearer ${token}`);
    expect(download.status).toBe(200);
    expect(Buffer.from(download.body as Buffer).equals(bytesFor(29))).toBe(true);

    /*
     * A reposição do duplo é **verificada**, não assumida: a mesma eliminação volta a
     * correr, agora contra a base de dados verdadeira, e tem de devolver `204` e levar os
     * bytes. Se a troca não fosse desfeita, seria aqui que se veria — e não nos testes
     * seguintes, por um motivo que nada tem a ver com eles.
     */
    expect((await deleteDocument(token, documentId)).status).toBe(204);
    expect(await storedFiles(userId)).toHaveLength(0);
  });
});

/* ========================================================================== */
/* 4. O ficheiro já não existe                                                 */
/* ========================================================================== */

describe('ficheiro já inexistente', () => {
  it('elimina sem erro quando os bytes desapareceram do disco antes do pedido', async () => {
    const { token, userId } = await signup();
    const documentId = await createDocument(token);
    expect((await upload(token, documentId, bytesFor(9))).status).toBe(200);

    const [storedName] = await storedFiles(userId);
    // O ficheiro desaparece por fora — um volume montado a menos, uma limpeza manual. O
    // `remove` é idempotente (`force: true`), e um `ENOENT` aqui não pode virar um 500.
    await rm(join(storageRoot, userId, storedName as string), { force: true });
    expect(await storedFiles(userId)).toHaveLength(0);

    const response = await deleteDocument(token, documentId);

    expect(response.status, JSON.stringify(response.body)).toBe(204);
    expect(await appPrisma.document.count({ where: { id: documentId } })).toBe(0);
  });
});

/* ========================================================================== */
/* 5. Isolamento entre contas                                                  */
/* ========================================================================== */

describe('isolamento entre contas', () => {
  it('outra conta recebe 404 e não apaga nada — nem o registo, nem os bytes', async () => {
    const owner = await signup();
    const intruder = await signup();

    const documentId = await createDocument(owner.token);
    expect((await upload(owner.token, documentId, bytesFor(13))).status).toBe(200);
    expect(await storedFiles(owner.userId)).toHaveLength(1);

    const response = await deleteDocument(intruder.token, documentId);

    // 404 e não 403: um 403 confirmaria que o documento existe.
    expect(response.status, JSON.stringify(response.body)).toBe(404);

    expect(await appPrisma.document.count({ where: { id: documentId } })).toBe(1);
    expect(await storedFiles(owner.userId)).toHaveLength(1);

    // E o dono continua a conseguir ler os bytes.
    const download = await request(app)
      .get(`${BASE}/documents/${documentId}/content`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(download.status).toBe(200);
  });
});

/* ========================================================================== */
/* 6. Chave partilhada por dois registos (`PC-21`)                             */
/* ========================================================================== */

describe('chave partilhada por dois registos', () => {
  it('não apaga o ficheiro enquanto outro registo o referenciar', async () => {
    const { token, userId } = await signup();
    const first = await createDocument(token, { name: 'Original' });
    const second = await createDocument(token, { name: 'Duplicado' });

    expect((await upload(token, first, bytesFor(17))).status).toBe(200);
    const [storedName] = await storedFiles(userId);

    /*
     * `PC-21` (aberto): `updateDocument` aceita uma `storageKey` do cliente, pelo que dois
     * registos da mesma conta podem apontar para o mesmo ficheiro. É a única via que
     * produz este estado — o upload e o importador geram sempre chaves novas.
     */
    const sharedKey = `${userId}/${storedName}`;
    const patch = await request(app)
      .patch(`${BASE}/documents/${second}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ storageKey: sharedKey });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    expect(patch.body.storageKey).toBe(sharedKey);

    expect((await deleteDocument(token, first)).status).toBe(204);

    /*
     * O ficheiro **fica**. Sem a contagem de referências, esta eliminação apagaria os bytes
     * que o segundo registo ainda anuncia — e o utilizador ficaria com um documento que
     * diz ter ficheiro e responde 404 ao download.
     */
    expect(await storedFiles(userId)).toHaveLength(1);

    const download = await request(app)
      .get(`${BASE}/documents/${second}/content`)
      .set('Authorization', `Bearer ${token}`);
    expect(download.status).toBe(200);
    expect(Buffer.from(download.body as Buffer).equals(bytesFor(17))).toBe(true);

    // E quando o último registo desaparece, os bytes saem mesmo.
    expect((await deleteDocument(token, second)).status).toBe(204);
    expect(await storedFiles(userId)).toHaveLength(0);
  });
});

/* ========================================================================== */
/* 7. Interação com o upload de `PROD-001`                                     */
/* ========================================================================== */

describe('interação com o upload', () => {
  it('o ficheiro carregado pela via de upload é o que a eliminação remove', async () => {
    const { token, userId } = await signup();
    const documentId = await createDocument(token, { name: 'Digitalização' });

    expect((await upload(token, documentId, bytesFor(23))).status).toBe(200);
    expect(await storedFiles(userId)).toHaveLength(1);

    // A recusa de substituição (`PROD-008`) não pode ter apagado o ficheiro existente: a
    // remoção compensatória do upload é para o que ele próprio acabou de escrever.
    const conflict = await upload(token, documentId, bytesFor(99));
    expect(conflict.status, JSON.stringify(conflict.body)).toBe(409);
    expect(await storedFiles(userId)).toHaveLength(1);

    expect((await deleteDocument(token, documentId)).status).toBe(204);
    expect(await storedFiles(userId)).toHaveLength(0);
  });
});

/* ========================================================================== */
/* 8. Regressão: o que a eliminação já fazia                                   */
/* ========================================================================== */

describe('regressão da eliminação', () => {
  it('continua a apagar o lembrete de validade e o documento associado', async () => {
    const { token, userId } = await signup();
    const vehicle = await createVehicle(db, userId);

    const documentId = await createDocument(token, {
      name: 'Inspeção',
      category: 'inspection',
      vehicleId: vehicle.id,
      expiresAt: '2027-01-31',
    });

    // O documento com validade gera lembrete — é o comportamento que a eliminação tem de
    // arrastar consigo, e que a remoção dos bytes não pode ter posto em causa.
    const reminders = await appPrisma.reminder.count({ where: { originRecordId: documentId } });
    expect(reminders).toBe(1);

    expect((await deleteDocument(token, documentId)).status).toBe(204);

    expect(await appPrisma.document.count({ where: { id: documentId } })).toBe(0);
    expect(await appPrisma.reminder.count({ where: { originRecordId: documentId } })).toBe(0);
  });
});
