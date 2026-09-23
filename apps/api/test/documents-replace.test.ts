/**
 * Substituição dos bytes de um documento (`PROD-008`).
 *
 * ## O que é que estes testes provam
 *
 * Antes desta tarefa havia **um** verbo de escrita de bytes: o `POST`. Um documento com
 * ficheiro era recusado com `409`, e não havia forma de trocar a digitalização de um
 * documento — o utilizador tinha de criar um documento novo e apagar o antigo. Esta tarefa
 * acrescenta `PUT /documents/:documentId/content`, que define o conteúdo exista ele ou não,
 * e a asserção que interessa não é o `200`: é **o que fica no disco** e **para onde o
 * registo aponta** quando uma das etapas falha.
 *
 * A ordem é a propriedade central, e é assimétrica:
 *
 *  1. guardar os bytes **novos**;
 *  2. apontar o registo para a chave **nova**;
 *  3. só então remover a chave **antiga**.
 *
 * Invertida — "liberta espaço antes de ocupar mais" — produz o pior estado possível: um
 * registo a apontar para um ficheiro que já não existe, que a lista mostra e o download
 * recusa, e que o utilizador não consegue compor pela API. Cada uma das três etapas tem um
 * teste que a faz falhar, porque uma ordem só é uma garantia quando se mede o que acontece
 * quando a etapa seguinte não corre.
 *
 * ## O que estes testes não fazem
 *
 * Não substituem o serviço nem o repositório: passam por `createApp()` e pelo contrato HTTP,
 * contra a base de dados a sério. As duas únicas substituições são o armazenamento (uma
 * falha de disco não se provoca de outra maneira) e o delegado do Prisma (uma recusa da base
 * de dados, pela mesma razão) — e ambas são repostas e **verificadas**.
 *
 * ## A base de dados e o armazenamento
 *
 * Como em `documents-delete.test.ts`: a `DATABASE_URL` e o `DOCUMENT_STORAGE_DIR` são
 * definidos **antes** de a aplicação ser importada, porque o `core/db.ts` instancia o
 * cliente no import e o `defaultStorageRoot()` lê o ambiente. O armazenamento é um
 * directório temporário real, e as contagens são feitas **no disco** — uma asserção que
 * passasse por `exists()` provaria que o armazenamento concorda consigo próprio.
 */

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

/*
 * O cliente é tipado a partir da **própria aplicação**, e não de `@zemlo/prisma-sqlite`:
 * `core/prisma-client.ts` fixa o tipo em `client-postgres.js`, pelo que um `PrismaClient`
 * importado do pacote SQLite não é atribuível ao objecto que `core/db.js` exporta — `tsc`
 * recusa com `TS2322` seguido de `TS2589`. Um `import type` não carrega o módulo em runtime.
 */
import type { PrismaClient } from '../src/core/db.js';

import type { TestDb } from './helpers/db.js';
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

let app: Express;
let appPrisma: PrismaClient;
let db: TestDb;

/** Raiz do armazenamento desta suite. Fora do repositório, apagada no fim. */
let storageRoot: string;

beforeAll(async () => {
  /*
   * A base de dados de teste é criada pelo auxiliar partilhado, que já sabe montar o
   * ficheiro SQLite temporário. Não é preciso `createVehicle` aqui: nenhum destes testes
   * toca em veículos.
   */
  const { createTestDb } = await import('./helpers/db.js');
  db = await createTestDb();

  process.env.DATABASE_URL = db.url;
  process.env.DATABASE_PROVIDER = 'sqlite';
  process.env.NODE_ENV = 'test';

  storageRoot = await mkdtemp(join(tmpdir(), 'zemlo-doc-replace-'));
  process.env.DOCUMENT_STORAGE_DIR = storageRoot;
  resetDocumentStorage();

  const [{ createApp }, { prisma }] = await Promise.all([
    import('../src/app.js'),
    import('../src/core/db.js'),
  ]);

  appPrisma = prisma;
  app = createApp();

  /*
   * A sonda: confirma que a aplicação está ligada à base de dados temporária e não a outra
   * qualquer. Sem isto, uma `DATABASE_URL` mal aplicada faria os testes correrem contra o
   * ficheiro de desenvolvimento, e a limpeza no fim apagaria dados que não são de teste.
   */
  const probe = await appPrisma.user.create({
    data: { email: 'sonda-substituicao@zemlo.test', name: 'Sonda' },
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
  const email = `substituicao-${emailCounter}-${Math.random().toString(36).slice(2, 8)}@zemlo.test`;

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

/** O upload inicial — o `POST` de `PROD-001`. Devolve `200`, não `201`. */
function upload(
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

/** A substituição — o `PUT` desta tarefa. */
function replace(
  token: string,
  documentId: string,
  bytes: Buffer,
  contentType = 'image/png',
): Promise<request.Response> {
  return request(app)
    .put(`${BASE}/documents/${documentId}/content`)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', contentType)
    .send(bytes);
}

function getDocument(token: string, documentId: string): Promise<request.Response> {
  return request(app).get(`${BASE}/documents/${documentId}`).set('Authorization', `Bearer ${token}`);
}

function download(token: string, documentId: string): Promise<request.Response> {
  return request(app)
    .get(`${BASE}/documents/${documentId}/content`)
    .set('Authorization', `Bearer ${token}`);
}

function deleteDocument(token: string, documentId: string): Promise<request.Response> {
  return request(app)
    .delete(`${BASE}/documents/${documentId}`)
    .set('Authorization', `Bearer ${token}`);
}

/**
 * Os ficheiros que existem no espaço de um utilizador, lidos **no disco**.
 *
 * Uma asserção que passasse por `exists()` provaria que o armazenamento concorda consigo
 * próprio, não que o ficheiro desapareceu.
 */
async function storedFiles(userId: string): Promise<string[]> {
  try {
    return (await readdir(join(storageRoot, userId))).sort();
  } catch {
    // O directório só existe depois do primeiro `save`. Ausente = vazio.
    return [];
  }
}

/** Bytes reconhecíveis e distintos por semente, para o download ser comparável byte a byte. */
function bytesFor(seed: number, length = 64): Buffer {
  const bytes = Buffer.alloc(length);
  for (let index = 0; index < length; index += 1) bytes[index] = (seed + index) & 0xff;
  return bytes;
}

/**
 * Corre `run` com a escrita em `stdout` capturada, sem a silenciar.
 *
 * O logger escreve `info`/`warn` em `stdout` (só `error` vai para `stderr`), pelo que é aqui
 * que o aviso da remoção falhada aparece. Os pedaços capturados são **reencaminhados** para
 * o destino original: o relatório do Vitest continua a sair.
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
 * Um armazenamento que funciona, excepto numa operação.
 *
 * O erro é lançado **como o `node:fs` o lançaria**: com o caminho na mensagem. É essa a forma
 * real, e é por isso que a asserção do log verifica que a chave **não** aparece — um `save`
 * que lançasse `new Error('falhou')` não exercia a defesa.
 */
function storageFailingOn(
  operation: 'save' | 'remove',
  failingKey?: string,
): DocumentStorage {
  const real = new LocalDocumentStorage(storageRoot);

  const failure = (key: string): Error => {
    const error = new Error(
      `EACCES: permission denied, open '${join(storageRoot, key)}'`,
    ) as NodeJS.ErrnoException;
    error.code = 'EACCES';
    return error;
  };

  return {
    save: (userId, bytes) => {
      if (operation !== 'save') return real.save(userId, bytes);
      // A chave ainda não existe quando o `save` é chamado; o que interessa é que a
      // operação falha e que **nada** é escrito.
      return Promise.reject(failure(`${userId}/<nova>`));
    },
    read: (userId, key) => real.read(userId, key),
    exists: (userId, key) => real.exists(userId, key),
    remove: (userId, key) => {
      if (operation !== 'remove' || (failingKey !== undefined && key !== failingKey)) {
        return real.remove(userId, key);
      }
      return Promise.reject(failure(key));
    },
  };
}

/* ========================================================================== */
/* 1. Substituição com sucesso: ficheiro → ficheiro                            */
/* ========================================================================== */

describe('substituição com sucesso', () => {
  it('troca os bytes, mantém um só ficheiro e deixa o antigo fora do disco', async () => {
    const { token, userId } = await signup();
    const documentId = await createDocument(token, { fileName: 'digitalizacao.pdf' });

    const oldBytes = bytesFor(3, 128);
    expect((await upload(token, documentId, oldBytes)).status).toBe(200);

    const before = await getDocument(token, documentId);
    const oldKey = before.body.storageKey as string;
    expect(before.body.sizeBytes).toBe(128);
    expect(before.body.mimeType).toBe('application/pdf');

    const [oldName] = await storedFiles(userId);
    expect(oldName).toBeDefined();

    const newBytes = bytesFor(140, 200);
    const response = await replace(token, documentId, newBytes);

    expect(response.status, JSON.stringify(response.body)).toBe(200);

    /*
     * A chave é **outra**. Sem esta asserção, o resto do teste passaria com uma
     * implementação que reescrevesse por cima do mesmo ficheiro — que é um resultado
     * aceitável para o utilizador mas não é o que o `save` do armazenamento faz, e o teste
     * estaria a afirmar o contrário do que acontece.
     */
    const newKey = response.body.storageKey as string;
    expect(newKey).not.toBe(oldKey);
    expect(newKey.startsWith(`${userId}/`)).toBe(true);

    // Os três campos do ficheiro, e só esses.
    expect(response.body.sizeBytes).toBe(200);
    expect(response.body.mimeType).toBe('image/png');

    /*
     * Um ficheiro, e é o novo. A contagem sozinha não distingue "ficou o certo" de "ficou o
     * errado", pelo que o nome antigo é verificado explicitamente: se a remoção da chave
     * antiga não tivesse corrido, ficariam dois ficheiros.
     */
    const after = await storedFiles(userId);
    expect(after).toHaveLength(1);
    expect(after).not.toContain(oldName);
    expect(after[0]).toBe(newKey.slice(userId.length + 1));

    // E a ficha do documento não foi reescrita: enviar bytes não é editar o documento.
    expect(response.body.name).toBe('Documento Único');
    expect(response.body.category).toBe('registration');
    expect(response.body.fileName).toBe('digitalizacao.pdf');
  });

  it('o download serve os bytes novos e já não os antigos', async () => {
    const { token } = await signup();
    const documentId = await createDocument(token);

    const oldBytes = bytesFor(9, 96);
    expect((await upload(token, documentId, oldBytes)).status).toBe(200);

    const newBytes = bytesFor(60, 96);
    expect((await replace(token, documentId, newBytes)).status).toBe(200);

    const served = await download(token, documentId);
    expect(served.status).toBe(200);
    expect(Buffer.from(served.body as Buffer).equals(newBytes)).toBe(true);
    // O sentido negativo: os bytes antigos já não são servidos. É esta a asserção que
    // falharia se o `update` tivesse gravado o tamanho novo mas mantido a chave antiga.
    expect(Buffer.from(served.body as Buffer).equals(oldBytes)).toBe(false);
    expect(served.headers['content-type']).toContain('image/png');
  });
});

/* ========================================================================== */
/* 2. Documento sem ficheiro: o PUT cria                                       */
/* ========================================================================== */

describe('documento sem ficheiro', () => {
  it('o PUT cria o ficheiro quando o documento nunca teve nenhum', async () => {
    const { token, userId } = await signup();
    const documentId = await createDocument(token, { fileName: null, mimeType: null });

    expect(await storedFiles(userId)).toHaveLength(0);

    const bytes = bytesFor(31, 80);
    const response = await replace(token, documentId, bytes);

    /*
     * Sem `404`. A semântica do `PUT` é "define o conteúdo deste endereço": não há um
     * "não havia nada para substituir", e o resultado é o mesmo dos dois lados. É a decisão
     * que o utilizador fixou, e é esta a asserção que a fixa.
     */
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(typeof response.body.storageKey).toBe('string');
    expect(response.body.sizeBytes).toBe(80);

    expect(await storedFiles(userId)).toHaveLength(1);

    const served = await download(token, documentId);
    expect(served.status).toBe(200);
    expect(Buffer.from(served.body as Buffer).equals(bytes)).toBe(true);
  });

  it('depois do PUT, o POST volta a recusar — a separação dos verbos mantém-se', async () => {
    const { token, userId } = await signup();
    const documentId = await createDocument(token);

    expect((await replace(token, documentId, bytesFor(41, 64))).status).toBe(200);
    const [storedName] = await storedFiles(userId);

    /*
     * A recusa do `POST` olha para o estado, não para a via que o produziu. Um documento
     * cujo ficheiro nasceu de um `PUT` está exactamente na mesma situação de um que nasceu
     * de um `POST` — e é isso que este teste mede.
     */
    const conflict = await upload(token, documentId, bytesFor(99, 64));
    expect(conflict.status, JSON.stringify(conflict.body)).toBe(409);

    const after = await storedFiles(userId);
    expect(after).toHaveLength(1);
    expect(after[0]).toBe(storedName);
  });
});

/* ========================================================================== */
/* 3. O POST não substitui                                                     */
/* ========================================================================== */

describe('o POST não substitui', () => {
  it('recusa com 409 e deixa os bytes existentes intactos', async () => {
    const { token, userId } = await signup();
    const documentId = await createDocument(token);

    const original = bytesFor(17, 64);
    expect((await upload(token, documentId, original)).status).toBe(200);

    const before = await getDocument(token, documentId);
    const [storedName] = await storedFiles(userId);

    const conflict = await upload(token, documentId, bytesFor(200, 64));
    expect(conflict.status, JSON.stringify(conflict.body)).toBe(409);

    /*
     * Nada mudou — nem o registo, nem o disco. É esta a metade da decisão que evita o
     * efeito lateral: um envio repetido por uma rede instável não pode destruir o ficheiro
     * anterior sem que ninguém o tenha pedido.
     */
    const after = await getDocument(token, documentId);
    expect(after.body.storageKey).toBe(before.body.storageKey);
    expect(after.body.sizeBytes).toBe(64);

    const files = await storedFiles(userId);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(storedName);

    const served = await download(token, documentId);
    expect(Buffer.from(served.body as Buffer).equals(original)).toBe(true);
  });
});

/* ========================================================================== */
/* 4. Falha do armazenamento ao guardar os bytes novos                         */
/* ========================================================================== */

describe('falha do armazenamento ao guardar', () => {
  it('deixa o documento a apontar para o ficheiro antigo, que continua a servir', async () => {
    const { token, userId } = await signup();
    const documentId = await createDocument(token);

    const oldBytes = bytesFor(5, 64);
    expect((await upload(token, documentId, oldBytes)).status).toBe(200);

    const before = await getDocument(token, documentId);
    const [oldName] = await storedFiles(userId);

    setDocumentStorage(storageFailingOn('save'));

    const response = await replace(token, documentId, bytesFor(70, 64));
    expect(response.status, JSON.stringify(response.body)).toBe(500);

    /*
     * A primeira etapa falhou, e nada mudou. Em particular o ficheiro **antigo** continua
     * no disco: não foi apagado para "abrir espaço" a um ficheiro que nunca chegou a
     * existir. Sem esta asserção, uma implementação que removesse o antigo primeiro
     * passaria aqui com o registo a apontar para o vazio.
     */
    const after = await getDocument(token, documentId);
    expect(after.body.storageKey).toBe(before.body.storageKey);
    expect(after.body.sizeBytes).toBe(64);
    expect(after.body.mimeType).toBe('application/pdf');

    const files = await storedFiles(userId);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(oldName);

    const served = await download(token, documentId);
    expect(served.status).toBe(200);
    expect(Buffer.from(served.body as Buffer).equals(oldBytes)).toBe(true);
  });
});

/* ========================================================================== */
/* 5. Falha da base de dados ao apontar o registo                              */
/* ========================================================================== */

describe('falha da base de dados ao apontar', () => {
  it('remove a chave nova e mantém a antiga: o documento não fica a apontar para o vazio', async () => {
    const { token, userId } = await signup();
    const documentId = await createDocument(token);

    const oldBytes = bytesFor(21, 64);
    expect((await upload(token, documentId, oldBytes)).status).toBe(200);

    const before = await getDocument(token, documentId);
    const [oldName] = await storedFiles(userId);
    expect(await storedFiles(userId)).toHaveLength(1);

    /*
     * A base de dados recusa o `update`. É o caso que **distingue as três etapas**: os bytes
     * novos já foram escritos pelo armazenamento (etapa 1 correu), a chave nova ainda não
     * está referenciada por ninguém (etapa 2 falhou) e a chave antiga continua a ser a do
     * registo (etapa 3 nunca corre).
     *
     * A troca é manual, e não um `vi.spyOn`. Medido em `documents-delete.test.ts`: o
     * `spyOn` sobre o delegado do Prisma **não se repõe** com `mockRestore()`, e os testes
     * seguintes passaram a falhar com `500` por um duplo que ficou instalado. Uma troca
     * directa repõe-se de forma verificável, e a reposição é verificada no fim deste teste.
     */
    const delegate = appPrisma.document as unknown as {
      update: (args: unknown) => Promise<unknown>;
    };
    const realUpdate = delegate.update;
    delegate.update = () => Promise.reject(new Error('a base de dados recusou a actualização'));

    try {
      const response = await replace(token, documentId, bytesFor(90, 64));
      expect(response.status, JSON.stringify(response.body)).toBe(500);
    } finally {
      delegate.update = realUpdate;
    }

    /*
     * O registo continua a apontar para a chave antiga — e, por isso, a chave antiga tem de
     * continuar no disco. E a chave **nova**, que o `save` escreveu e ninguém referencia,
     * tem de ter sido removida: deixá-la seria um órfão criado pelo servidor, por um erro
     * que não é do utilizador. As duas asserções juntas são o que fixa a remoção
     * compensatória; só a contagem (1) não distinguiria "ficou a antiga" de "ficou a nova".
     */
    const after = await getDocument(token, documentId);
    expect(after.body.storageKey).toBe(before.body.storageKey);

    const files = await storedFiles(userId);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(oldName);

    const served = await download(token, documentId);
    expect(served.status).toBe(200);
    expect(Buffer.from(served.body as Buffer).equals(oldBytes)).toBe(true);

    /*
     * A reposição do duplo é **verificada**, não assumida: a mesma substituição volta a
     * correr, agora contra a base de dados verdadeira, e tem de devolver `200` e deixar um
     * só ficheiro — o novo.
     */
    const retry = await replace(token, documentId, bytesFor(150, 64));
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    expect(retry.body.storageKey).not.toBe(before.body.storageKey);
    expect(await storedFiles(userId)).toHaveLength(1);
  });
});

/* ========================================================================== */
/* 6. Falha da remoção do ficheiro antigo                                      */
/* ========================================================================== */

describe('falha da remoção do ficheiro antigo', () => {
  it('substitui na mesma, deixa o resíduo observável e não regista a chave', async () => {
    const { token, userId } = await signup();
    const documentId = await createDocument(token);

    expect((await upload(token, documentId, bytesFor(13, 64))).status).toBe(200);
    const [oldName] = await storedFiles(userId);
    const oldKey = `${userId}/${oldName}`;

    // Falha **só** na remoção da chave antiga. A remoção compensatória da chave nova (que
    // não chega a correr aqui) e as leituras ficam reais.
    setDocumentStorage(storageFailingOn('remove', oldKey));

    const newBytes = bytesFor(120, 64);
    const { result, output } = await captureStdout(() => replace(token, documentId, newBytes));

    /*
     * O pedido **não** falha. A terceira etapa é limpeza de bytes que o utilizador decidiu
     * deixar de usar; a substituição já teve efeito, e devolver `500` obrigá-lo-ia a repetir
     * um pedido que já correu — e a repetição substituiria outra vez, gastando mais espaço.
     */
    expect(result.status, JSON.stringify(result.body)).toBe(200);

    // O documento serve os bytes novos, e aponta para um ficheiro que existe: a falha da
    // limpeza não deixou nenhum estado intermédio.
    const served = await download(token, documentId);
    expect(served.status).toBe(200);
    expect(Buffer.from(served.body as Buffer).equals(newBytes)).toBe(true);

    // A falha foi real: o ficheiro antigo continua lá. Sem esta asserção, o teste passaria
    // com um `remove` que não falhasse — e não estaria a testar falha nenhuma.
    const files = await storedFiles(userId);
    expect(files).toHaveLength(2);
    expect(files).toContain(oldName);

    // O resíduo é observável, com o identificador que permite encontrá-lo.
    expect(output).toContain('não foi possível remover os bytes do documento');
    expect(output).toContain(documentId);
    expect(output).toContain('EACCES');

    /*
     * E a chave **não** aparece. A asserção é feita sobre o **segmento aleatório** da chave,
     * e não sobre a chave inteira, por uma razão medida em `PROD-007`: o log é escrito em
     * JSON e o `JSON.stringify` duplica as barras invertidas do caminho, pelo que comparar
     * a chave inteira (que usa `/`) ou a raiz (que usa `\` simples) **nunca** encontra nada
     * — nem quando a chave lá está. O `<hex>` não tem separadores e sobrevive à codificação.
     */
    expect(output).not.toContain(oldName as string);
    expect(output.replace(/\\\\/g, '\\')).not.toContain(storageRoot);

    /*
     * E a interacção com `PROD-007`, que é a razão de a remoção ser a **mesma** função nos
     * dois caminhos: a eliminação do documento remove a chave nova e deixa o resíduo da
     * antiga — que já não tem dono. É um órfão, e é honesto fixá-lo aqui em vez de o
     * esconder: nenhuma limpeza o pode recolher sem uma varredura, e uma varredura está
     * fora do âmbito desta tarefa (a nota de âmbito de `PROD-007` em `docs/API.md` diz o
     * mesmo).
     */
    resetDocumentStorage();
    expect((await deleteDocument(token, documentId)).status).toBe(204);
    expect(await storedFiles(userId)).toHaveLength(1);
    expect((await storedFiles(userId))[0]).toBe(oldName);
  });
});

/* ========================================================================== */
/* 7. Chave antiga partilhada por outro registo (`PC-21`)                      */
/* ========================================================================== */

describe('chave antiga partilhada por outro registo', () => {
  it('não apaga o ficheiro antigo enquanto outro registo o referenciar', async () => {
    const { token, userId } = await signup();
    const first = await createDocument(token, { name: 'Original' });
    const second = await createDocument(token, { name: 'Duplicado' });

    expect((await upload(token, first, bytesFor(23, 64))).status).toBe(200);
    const [oldName] = await storedFiles(userId);
    const sharedKey = `${userId}/${oldName}`;

    /*
     * `PC-21` (aberto): `updateDocument` aceita uma `storageKey` do cliente, pelo que dois
     * registos da mesma conta podem apontar para o mesmo ficheiro. É a única via que
     * produz este estado — o upload e o importador geram sempre chaves novas.
     */
    const patch = await request(app)
      .patch(`${BASE}/documents/${second}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ storageKey: sharedKey });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);

    const newBytes = bytesFor(130, 64);
    expect((await replace(token, first, newBytes)).status).toBe(200);

    /*
     * Dois ficheiros: o novo, do registo substituído, e o antigo — que continua a ser o
     * ficheiro do **segundo** registo. Sem a contagem de referências, esta substituição
     * apagaria os bytes que o segundo documento ainda anuncia, e o utilizador ficaria com um
     * documento que diz ter ficheiro e responde `404` ao download.
     *
     * É esta a asserção que prova que o `PUT` **não duplica** a lógica de limpeza: uma
     * remoção própria, sem contagem, passaria em todos os outros testes deste ficheiro.
     */
    const files = await storedFiles(userId);
    expect(files).toHaveLength(2);
    expect(files).toContain(oldName);

    const secondDownload = await download(token, second);
    expect(secondDownload.status).toBe(200);
    expect(Buffer.from(secondDownload.body as Buffer).equals(bytesFor(23, 64))).toBe(true);

    const firstDownload = await download(token, first);
    expect(Buffer.from(firstDownload.body as Buffer).equals(newBytes)).toBe(true);

    // E quando o último registo que aponta para a chave antiga desaparece, os bytes saem.
    expect((await deleteDocument(token, second)).status).toBe(204);
    const remaining = await storedFiles(userId);
    expect(remaining).toHaveLength(1);
    expect(remaining).not.toContain(oldName);
  });
});

/* ========================================================================== */
/* 8. Isolamento e recusas                                                     */
/* ========================================================================== */

describe('isolamento e recusas', () => {
  it('outra conta recebe 404 e nada é escrito', async () => {
    const owner = await signup();
    const intruder = await signup();

    const documentId = await createDocument(owner.token);
    const ownerBytes = bytesFor(29, 64);
    expect((await upload(owner.token, documentId, ownerBytes)).status).toBe(200);

    const ownerFilesBefore = await storedFiles(owner.userId);
    const before = await getDocument(owner.token, documentId);

    const response = await replace(intruder.token, documentId, bytesFor(180, 64));

    // 404 e não 403: um 403 confirmaria que o documento existe.
    expect(response.status, JSON.stringify(response.body)).toBe(404);

    /*
     * Nada foi escrito — nem no espaço do dono (o ficheiro antigo continua lá, intacto),
     * nem no do intruso (não ficou um ficheiro órfão de uma tentativa recusada). A segunda
     * metade é a que falharia numa implementação que escrevesse primeiro e verificasse a
     * propriedade depois.
     */
    expect(await storedFiles(owner.userId)).toStrictEqual(ownerFilesBefore);
    expect(await storedFiles(intruder.userId)).toHaveLength(0);

    const after = await getDocument(owner.token, documentId);
    expect(after.body.storageKey).toBe(before.body.storageKey);

    const served = await download(owner.token, documentId);
    expect(Buffer.from(served.body as Buffer).equals(ownerBytes)).toBe(true);
  });

  it('um documento inexistente responde 404 sem escrever nada', async () => {
    const { token, userId } = await signup();

    const response = await replace(token, 'nao-existe-mesmo', bytesFor(7, 64));

    expect(response.status, JSON.stringify(response.body)).toBe(404);
    expect(await storedFiles(userId)).toHaveLength(0);
  });

  it('um tipo não aceite responde 415 e deixa o ficheiro antigo intacto', async () => {
    const { token, userId } = await signup();
    const documentId = await createDocument(token);

    const oldBytes = bytesFor(37, 64);
    expect((await upload(token, documentId, oldBytes)).status).toBe(200);
    const before = await getDocument(token, documentId);

    /*
     * O `PUT` usa a **mesma** `readUploadedDocument` do `POST`, e é isso que impede que o
     * limite de tamanho e a lista de tipos divirjam entre os dois verbos. A lista fechada é
     * a de `ACCEPTED_DOCUMENT_UPLOAD_TYPES`; `application/zip` não está nela.
     */
    const response = await replace(token, documentId, bytesFor(200, 64), 'application/zip');

    expect(response.status, JSON.stringify(response.body)).toBe(415);

    const after = await getDocument(token, documentId);
    expect(after.body.storageKey).toBe(before.body.storageKey);
    expect(await storedFiles(userId)).toHaveLength(1);

    const served = await download(token, documentId);
    expect(Buffer.from(served.body as Buffer).equals(oldBytes)).toBe(true);
  });

  it('um corpo vazio responde 400 e deixa o ficheiro antigo intacto', async () => {
    const { token, userId } = await signup();
    const documentId = await createDocument(token);

    const oldBytes = bytesFor(43, 64);
    expect((await upload(token, documentId, oldBytes)).status).toBe(200);
    const before = await getDocument(token, documentId);

    /*
     * Um ficheiro de zero bytes não é um ficheiro: é um envio que falhou a meio. A recusa
     * existe em dois sítios — na rota (`readUploadedDocument`) e no serviço
     * (`storeContentAndPointRecord`), e vale para os dois verbos. O que se mede aqui é o
     * efeito: `400` e o ficheiro antigo por tocar.
     */
    const response = await request(app)
      .put(`${BASE}/documents/${documentId}/content`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/pdf')
      .send(Buffer.alloc(0));

    expect(response.status, JSON.stringify(response.body)).toBe(400);

    const after = await getDocument(token, documentId);
    expect(after.body.storageKey).toBe(before.body.storageKey);
    expect(await storedFiles(userId)).toHaveLength(1);

    const served = await download(token, documentId);
    expect(Buffer.from(served.body as Buffer).equals(oldBytes)).toBe(true);
  });
});

/* ========================================================================== */
/* 9. Interação com `PROD-007`                                                 */
/* ========================================================================== */

describe('interação com a eliminação', () => {
  it('a eliminação remove o ficheiro que a substituição deixou, e não sobra nada', async () => {
    const { token, userId } = await signup();
    const documentId = await createDocument(token);

    expect((await upload(token, documentId, bytesFor(11, 64))).status).toBe(200);
    expect((await replace(token, documentId, bytesFor(140, 64))).status).toBe(200);
    expect(await storedFiles(userId)).toHaveLength(1);

    /*
     * As duas tarefas partilham a remoção: o `PUT` limpa a chave antiga pela função da
     * eliminação (`discardDocumentBytes`), e a eliminação remove o que o `PUT` deixou. Se o
     * `PUT` tivesse a sua própria remoção, seria aqui que se veria — um ficheiro que a
     * eliminação não sabe que existe.
     */
    expect((await deleteDocument(token, documentId)).status).toBe(204);
    expect(await storedFiles(userId)).toHaveLength(0);
    expect(await appPrisma.document.count({ where: { id: documentId } })).toBe(0);
  });

  it('a substituição não apaga nada quando o documento não tinha ficheiro', async () => {
    const { token, userId } = await signup();
    const documentId = await createDocument(token);

    // Um `PUT` sobre um documento sem ficheiro não tem chave antiga: a terceira etapa não
    // corre, e não pode correr contra uma chave vazia ou indefinida.
    expect((await replace(token, documentId, bytesFor(51, 64))).status).toBe(200);
    expect(await storedFiles(userId)).toHaveLength(1);

    expect((await deleteDocument(token, documentId)).status).toBe(204);
    expect(await storedFiles(userId)).toHaveLength(0);
  });
});

/* ========================================================================== */
/* 10. A isenção do corpo cru (`A31`)                                          */
/* ========================================================================== */

describe('a isenção do corpo cru', () => {
  /*
   * O `requireJsonBody()` corre na aplicação, antes de qualquer router ser resolvido, pelo
   * que o `PUT` com `Content-Type: image/png` nunca chegaria ao router se a isenção não
   * cobrisse o método. O predicado é exercitado directamente — como o do importador — em vez
   * de ser inferido de uma resposta HTTP: uma resposta `415` provaria que a rota correu, mas
   * não que foi a isenção a deixá-la correr.
   */
  it('isDocumentUpload aceita POST e PUT no caminho do conteúdo, e recusa o resto', async () => {
    const { isDocumentUpload } = await import('../src/http/routes/documents.js');
    const path = `${BASE}/documents/abc123/content`;

    expect(isDocumentUpload('POST', path)).toBe(true);
    expect(isDocumentUpload('PUT', path)).toBe(true);

    // O `GET` é a terceira representação do mesmo caminho: não transporta corpo, e isentá-lo
    // tornaria a transferência dependente de uma decisão sobre uploads.
    expect(isDocumentUpload('GET', path)).toBe(false);
    expect(isDocumentUpload('DELETE', path)).toBe(false);

    // Ancorado nas duas pontas: `/…/content/extra` é outro endereço.
    expect(isDocumentUpload('POST', `${path}/extra`)).toBe(false);
    expect(isDocumentUpload('PUT', `${path}/extra`)).toBe(false);

    // E só sob o prefixo da API, e só no caminho do conteúdo.
    expect(isDocumentUpload('PUT', '/documents/abc123/content')).toBe(false);
    expect(isDocumentUpload('PUT', `${BASE}/documents/abc123`)).toBe(false);
  });

  it('o PUT com um tipo de ficheiro aceite chega ao router (não é travado pelo requireJsonBody)', async () => {
    const { token } = await signup();
    const documentId = await createDocument(token);

    /*
     * `text/plain` não é JSON. Se o `requireJsonBody()` apanhava o pedido, a resposta seria
     * `415` com a mensagem do middleware; o que se espera é `200`, o que prova que a isenção
     * entregou o pedido ao router — e não apenas que o router existe.
     */
    const response = await replace(token, documentId, Buffer.from('texto simples', 'utf8'), 'text/plain');

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.mimeType).toBe('text/plain');
    expect(response.body.sizeBytes).toBe(Buffer.byteLength('texto simples'));
  });
});
