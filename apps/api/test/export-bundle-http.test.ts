/**
 * Contrato HTTP da exportação do bundle nativo — `GET /api/v1/export/bundle`.
 *
 * ## O que é que esta suite prova, e porque é que o ciclo (§13) não bastava
 *
 * O `import-export-cycle.test.ts` prova a **fidelidade** do ciclo: conta → `buildBundle` →
 * `writeZip` → `readZip` → registos, com os documentos comparados byte a byte. Prova-o,
 * porém, ao nível dos serviços: chama `buildBundle` e `writeZip` diretamente, e por isso
 * não responde à pergunta que o utilizador faz — *"como é que eu obtenho este ficheiro?"*.
 *
 * Durante a fase em que o escritor existiu sem rota, a resposta era "não obtém": o
 * `writeZip` e o `buildBundle` não tinham **nenhum** consumidor de produção. Um ciclo
 * testado ao nível dos serviços e inalcançável pela API é um ciclo que não existe para
 * quem usa o produto.
 *
 * Esta suite verifica o contrato da rota que o torna alcançável, e fá-lo **através do
 * HTTP**: sobe a aplicação a sério (`createApp()`), usa tokens obtidos por `signup`, e lê
 * os bytes da resposta como o browser os receberia. Nenhum duplo substitui a cadeia real.
 *
 * ## Porque é que o ciclo real está aqui, e não numa suite separada
 *
 * O pedido do utilizador é explícito: pelo menos um teste tem de percorrer exportar →
 * preview → apply → verificar. Escrevê-lo ao lado do contrato da rota seria dividir uma
 * propriedade única — "o que a rota devolve é o que a rota de importação aceita" — em dois
 * ficheiros que poderiam divergir. Aqui, o mesmo `zip` que sai do `GET` entra no `POST`, e
 * é isso que fecha o ciclo pela fronteira que o utilizador usa.
 *
 * ## A base de dados e o armazenamento
 *
 * Como em `import-http.test.ts`: a `DATABASE_URL` é definida **antes** de a aplicação ser
 * importada, porque o `core/db.ts` instancia o cliente no import. O armazenamento de
 * documentos aponta para um directório temporário próprio, para que os bytes de um
 * documento atravessem a exportação sem tocar nos do ambiente.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@zemlo/prisma-sqlite';

import { createTestDb, type TestDb } from './helpers/db.js';

/* -------------------------------------------------------------------------- */
/* Infraestrutura                                                              */
/* -------------------------------------------------------------------------- */

let db: TestDb;
let app: Express;
let appPrisma: PrismaClient;
let storageRoot: string;

let owner: { id: string; email: string };
let other: { id: string; email: string };
let token: string;
let otherToken: string;
let vehicleId: string;

beforeAll(async () => {
  db = await createTestDb();

  /*
   * O directório de armazenamento tem de existir antes de a aplicação ser importada: a
   * instância partilhada (`documentStorage()`) lê `DOCUMENT_STORAGE_DIR` na primeira
   * utilização, e a variável tem de lá estar.
   */
  storageRoot = await mkdtemp(join(tmpdir(), 'zemlo-export-http-'));

  process.env.DATABASE_URL = db.url;
  process.env.DATABASE_PROVIDER = 'sqlite';
  process.env.NODE_ENV = 'test';
  process.env.DOCUMENT_STORAGE_DIR = storageRoot;

  const [{ createApp }, { prisma }] = await Promise.all([
    import('../src/app.js'),
    import('../src/core/db.js'),
  ]);

  appPrisma = prisma;
  app = createApp();

  /*
   * Rede de segurança: a aplicação tem de estar ligada à base temporária. Verifica-se
   * escrevendo pelo cliente da app e lendo pelo cliente do teste — a propriedade que
   * interessa, e não uma igualdade de referências entre dois objectos que são diferentes
   * por construção.
   */
  const sonda = await appPrisma.user.create({
    data: { email: 'sonda-export@zemlo.test', name: 'Sonda' },
    select: { id: true },
  });
  expect(
    await db.prisma.user.findUnique({ where: { id: sonda.id } }),
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

beforeEach(async () => {
  await resetDatabase();

  const titular = await signup(app, 'export-titular@zemlo.test');
  const outro = await signup(app, 'export-outro@zemlo.test');
  owner = titular.user;
  other = outro.user;
  token = titular.token;
  otherToken = outro.token;

  const vehicle = await appPrisma.vehicle.create({
    data: {
      userId: owner.id,
      plate: 'AA-11-BB',
      plateDisplay: 'AA-11-BB',
      make: 'Renault',
      model: 'Clio',
      year: 2022,
    },
    select: { id: true },
  });
  vehicleId = vehicle.id;
});

async function resetDatabase(): Promise<void> {
  await db.prisma.auditLog.deleteMany();
  await db.prisma.importBookEntry.deleteMany();
  await db.prisma.expense.deleteMany();
  await db.prisma.fuelSession.deleteMany();
  await db.prisma.odometerReading.deleteMany();
  await db.prisma.document.deleteMany();
  await db.prisma.vehicle.deleteMany();
  await db.prisma.user.deleteMany();
}

async function signup(
  application: Express,
  email: string,
): Promise<{ user: { id: string; email: string }; token: string }> {
  const response = await request(application)
    .post('/api/v1/auth/signup')
    .set('Content-Type', 'application/json')
    .send({ email, password: 'Password123!', name: 'Teste', acceptedTerms: true });

  if (response.status !== 201) {
    throw new Error(
      `Não foi possível criar a sessão de teste (${response.status}): ${JSON.stringify(response.body)}`,
    );
  }

  return { user: response.body.user, token: response.body.tokens.accessToken };
}

/** O envelope de erro da API: `{ error: { code, message, requestId } }`. */
function errorOf(body: unknown): { code: string; message: string } {
  return (body as { error: { code: string; message: string } }).error;
}

/**
 * Descarrega o bundle nativo e devolve os bytes.
 *
 * Lido como `Buffer` e não como texto: um ZIP é binário, e uma leitura textual corromperia
 * os bytes antes de qualquer verificação. É a mesma razão pela qual o `verify` lê o CSV
 * como bytes — o que se verifica é o ficheiro, e não a sua interpretação.
 */
async function downloadBundle(
  query = '',
  bearer: string = token,
): Promise<{ status: number; bytes: Buffer; contentType: string; disposition: string }> {
  const response = await request(app)
    .get(`/api/v1/export/bundle${query}`)
    .set('Authorization', `Bearer ${bearer}`)
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });

  return {
    status: response.status,
    bytes: (response.body as Buffer) ?? Buffer.alloc(0),
    contentType: response.headers['content-type'] ?? '',
    disposition: response.headers['content-disposition'] ?? '',
  };
}

/** Uma despesa mínima, para que a conta exportada tenha algo além do veículo. */
async function createExpense(amountCents = 6120): Promise<void> {
  await appPrisma.expense.create({
    data: {
      userId: owner.id,
      vehicleId,
      // `date` é `DateTime` no esquema, não uma data civil: o domínio converte-a ao
      // construir a resposta, e a base de dados guarda o instante.
      date: new Date('2026-03-02T00:00:00.000Z'),
      amountCents,
      category: 'fuel',
      description: 'Abastecimento',
    },
  });
}

/* ========================================================================== */
/* 1. Autenticação e isolamento                                                */
/* ========================================================================== */

describe('autenticação', () => {
  it('recusa a exportação sem sessão', async () => {
    const response = await request(app).get('/api/v1/export/bundle');
    expect(response.status).toBe(401);
  });

  it('recusa um token inválido', async () => {
    const response = await request(app)
      .get('/api/v1/export/bundle')
      .set('Authorization', 'Bearer nao-e-um-token');
    expect(response.status).toBe(401);
  });

  /**
   * A propriedade que separa esta rota de um download estático: quem recebe o ficheiro é
   * quem o pediu. Um bundle construído com o `userId` errado passaria nos restantes testes
   * — o ZIP seria válido e legível — e vazaria dados entre contas.
   */
  it('exporta a conta do token, e não outra', async () => {
    await createExpense();

    const doTitular = await downloadBundle();
    expect(doTitular.status).toBe(200);
    // O titular tem uma despesa; a outra conta não tem nada.
    expect(doTitular.bytes.includes(Buffer.from('expenses.jsonl'))).toBe(true);

    const doOutro = await downloadBundle('', otherToken);
    expect(doOutro.status).toBe(200);
    // A conta do outro não tem veículo nem despesas: o ficheiro existe (o bundle é
    // sempre válido) mas não traz a despesa do titular.
    expect(doOutro.bytes.includes(Buffer.from('Abastecimento'))).toBe(false);
    expect(doOutro.bytes.includes(Buffer.from(vehicleId))).toBe(false);
  });
});

/* ========================================================================== */
/* 2. Contrato do ficheiro devolvido                                           */
/* ========================================================================== */

describe('contrato do ficheiro', () => {
  it('responde 200 com os cabeçalhos de uma transferência', async () => {
    const resultado = await downloadBundle();

    expect(resultado.status).toBe(200);
    expect(resultado.contentType).toContain('application/zip');
    expect(resultado.disposition).toContain('attachment');
    expect(resultado.disposition).toContain('.zip');
  });

  /**
   * O nome do ficheiro tem de distinguir este artefacto do legado.
   *
   * Um utilizador que descarregue os dois no mesmo dia fica com dois ficheiros na pasta de
   * transferências; se partilhassem o nome, teria de os abrir para saber qual é qual.
   */
  it('dá um nome que distingue o bundle do export legado', async () => {
    const resultado = await downloadBundle();
    expect(resultado.disposition).toContain('bundle');

    const legado = await request(app)
      .get('/api/v1/export?format=json')
      .set('Authorization', `Bearer ${token}`);
    expect(legado.headers['content-disposition']).not.toContain('bundle');
  });

  it('começa pela assinatura de ZIP', async () => {
    const resultado = await downloadBundle();
    // `PK\x03\x04`: o cabeçalho local de um arquivo PKZIP.
    expect(resultado.bytes.subarray(0, 4).toString('hex')).toBe('504b0304');
  });

  it('o conteúdo é um ZIP que o leitor aceita sem alterações', async () => {
    await createExpense();
    const resultado = await downloadBundle();

    const { readZip } = await import('../src/domain/import/zip.js');
    const zip = readZip(new Uint8Array(resultado.bytes));

    const nomes = zip.entries.map((entry) => entry.name);
    expect(nomes).toContain('manifest.json');
    expect(nomes).toContain('README.txt');
  });

  it('declara o âmbito quando o pedido é de um veículo', async () => {
    const resultado = await downloadBundle(`?vehicleId=${vehicleId}`);
    expect(resultado.status).toBe(200);

    const { readZip } = await import('../src/domain/import/zip.js');
    const { readBundle } = await import('../src/domain/import/bundle.js');
    const zip = readZip(new Uint8Array(resultado.bytes));
    const bundle = readBundle(zip.entries);

    /*
     * O âmbito por veículo tem de ser **declarado**, e a declaração é o que distingue um
     * bundle filtrado de um bundle incompleto. Nota: `vehicleLocalIds` traz os `localId`
     * (`veh_1`), e **não** o `cuid` interno — a §5.5 proíbe que o identificador da base de
     * dados se propague para o artefacto, e é isso que torna o bundle reimportável noutra
     * conta.
     */
    expect(bundle.manifest.scope.kind).toBe('vehicles');
    expect(bundle.manifest.scope.vehicleLocalIds).toEqual(['veh_1']);
    // O `cuid` não pode aparecer no artefacto.
    expect(bundle.manifest.scope.vehicleLocalIds).not.toContain(vehicleId);
  });

  it('exporta a conta inteira quando não há âmbito', async () => {
    const resultado = await downloadBundle();

    const { readZip } = await import('../src/domain/import/zip.js');
    const { readBundle } = await import('../src/domain/import/bundle.js');
    const zip = readZip(new Uint8Array(resultado.bytes));
    const bundle = readBundle(zip.entries);

    expect(bundle.manifest.scope.kind).toBe('full-account');
    expect(bundle.manifest.scope.vehicleLocalIds).toBeNull();
  });

  it('não deixa os objectos do armazenamento à vista', async () => {
    await createExpense();
    const resultado = await downloadBundle();

    /*
     * Um `storageKey` é uma referência interna (`<userId>/<id>`) que só faz sentido dentro
     * deste servidor. O bundle descreve o conteúdo por `contentPath` — um caminho
     * **relativo ao próprio bundle** — e nunca pelo `storageKey`: expô-lo daria ao
     * utilizador uma pista sobre a organização do armazenamento, e um identificador que
     * noutra conta não significaria nada.
     *
     * O que se verifica não é "a palavra não aparece" mas a **propriedade**: nenhum
     * caminho absoluto do servidor, nem a raiz do armazenamento, atravessa o artefacto.
     */
    expect(resultado.bytes.includes(Buffer.from(storageRoot))).toBe(false);
    expect(resultado.bytes.includes(Buffer.from('storageKey'))).toBe(false);

    const { readZip } = await import('../src/domain/import/zip.js');
    const { readBundle } = await import('../src/domain/import/bundle.js');
    const zip = readZip(new Uint8Array(resultado.bytes));
    const bundle = readBundle(zip.entries);

    // Os caminhos que o bundle declara são internos a ele.
    for (const ficheiro of bundle.files) {
      expect(ficheiro.path.startsWith(storageRoot)).toBe(false);
      expect(ficheiro.path.includes(':\\')).toBe(false);
    }
  });
});

/* ========================================================================== */
/* 3. Fidelidade: documentos byte a byte                                       */
/* ========================================================================== */

describe('documentos', () => {
  /**
   * Um documento com bytes que **não** são texto.
   *
   * Se o pipeline tratasse o conteúdo como uma cadeia, um byte `0x00` corromperia o
   * ficheiro sem que nenhum teste com texto o detetasse. É por isso que os bytes são
   * pseudo-aleatórios e incluem valores altos.
   */
  function binaryBytes(seed: number, length: number): Buffer {
    const bytes = Buffer.alloc(length);
    let state = seed >>> 0;
    for (let index = 0; index < length; index += 1) {
      state ^= state << 13;
      state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      bytes[index] = state & 0xff;
    }
    return bytes;
  }

  /**
   * Guarda bytes no armazenamento real e cria o registo que os referencia.
   *
   * ## Porque é que a chave não é arbitrária
   *
   * `LocalDocumentStorage` guarda cada documento em `<raiz>/<userId>/<id>` e a chave é
   * `<userId>/<id>` — o `userId` é o espaço de nomes e é revalidado no `read()`. Escrever o
   * ficheiro num caminho inventado produziria um documento que a exportação **não
   * encontraria**, e o teste passaria a verificar `missingContent` em vez da fidelidade
   * que pretende provar. A chave é, por isso, construída com a mesma forma que a produção
   * usa, e o ficheiro é escrito onde o `read()` o vai procurar.
   *
   * ## Porque é que o hash não é escrito na base de dados
   *
   * Não existe coluna para ele: `Document` tem `sizeBytes` e `storageKey`, e o
   * `contentSha256` que aparece no bundle é **calculado** por `buildBundle` a partir dos
   * bytes lidos. Guardá-lo no registo faria o teste verificar uma cópia em vez do cálculo —
   * que é precisamente o que se quer exercer.
   */
  async function createDocumentWithBytes(
    bytes: Buffer,
  ): Promise<{ id: string; storageKey: string }> {
    const { mkdir } = await import('node:fs/promises');
    const { randomBytes } = await import('node:crypto');

    const id = randomBytes(16).toString('hex');
    const storageKey = `${owner.id}/${id}`;
    await mkdir(join(storageRoot, owner.id), { recursive: true });
    await writeFile(join(storageRoot, owner.id, id), bytes);

    const document = await appPrisma.document.create({
      data: {
        userId: owner.id,
        vehicleId,
        name: 'Fatura da revisão',
        category: 'other',
        storageKey,
        sizeBytes: bytes.byteLength,
      },
      select: { id: true },
    });

    return { id: document.id, storageKey };
  }

  it('o documento é exportado com os bytes originais, byte a byte', async () => {
    const original = binaryBytes(0x2f6b, 4096);
    await createDocumentWithBytes(original);

    const resultado = await downloadBundle();

    const { readZip } = await import('../src/domain/import/zip.js');
    const zip = readZip(new Uint8Array(resultado.bytes));

    /*
     * O caminho de um documento no bundle é `documents/<localId>/<nome>` — o `localId`
     * liga-o ao registo de metadados, e o nome preserva o original. Procurar só por
     * `documents/` deixaria passar um caminho achatado, que o leitor recusaria ou que
     * perderia a associação.
     */
    const entradas = zip.entries.filter((entry) => entry.name.startsWith('documents/'));
    expect(entradas.length, 'O documento não foi incluído no bundle.').toBe(1);
    expect(entradas[0]!.name).toMatch(/^documents\/doc_\d+\//);

    expect(Buffer.from(entradas[0]!.data).equals(original)).toBe(true);
  });

  it('o sha256 declarado corresponde aos bytes exportados', async () => {
    const original = binaryBytes(0x77aa, 2048);
    await createDocumentWithBytes(original);

    const resultado = await downloadBundle();

    const { readZip } = await import('../src/domain/import/zip.js');
    const { readBundle } = await import('../src/domain/import/bundle.js');
    const { createHash } = await import('node:crypto');

    const zip = readZip(new Uint8Array(resultado.bytes));
    /*
     * `readBundle` calcula o `sha256` sobre os bytes **reais** e compara-o com o declarado
     * no manifest, recusando o bundle quando divergem. Chegar aqui é já a prova de que os
     * hashes declarados são válidos; a comparação abaixo torna a propriedade explícita, em
     * vez de a deixar depender de um efeito secundário.
     */
    const bundle = readBundle(zip.entries);

    expect(bundle.documentBytes.length).toBe(1);
    const documento = bundle.documentBytes[0]!;

    const entrada = zip.entries.find((entry) => entry.name === documento.path);
    expect(entrada).toBeDefined();

    const hashReal = createHash('sha256').update(Buffer.from(entrada!.data)).digest('hex');
    expect(documento.sha256).toBe(hashReal);
    expect(documento.sha256).toBe(createHash('sha256').update(original).digest('hex'));
  });
});

/* ========================================================================== */
/* 4. O ciclo completo pela fronteira HTTP (§13, pedido do utilizador)         */
/* ========================================================================== */

describe('ciclo exportar → preview → apply, pela API', () => {
  /**
   * O teste que o pedido exige: **sem mocks, com a cadeia real**.
   *
   *  1. prepara dados na conta de origem;
   *  2. exporta o bundle nativo pelo `GET`;
   *  3. obtém os bytes;
   *  4. envia-os ao `/import/preview`;
   *  5. verifica o plano;
   *  6. aplica (`/import/apply`);
   *  7. verifica o resultado na conta de destino;
   *  8. confirma que os documentos ficaram byte a byte iguais;
   *  9. confirma que os hashes declarados continuam válidos.
   *
   * A conta de destino é a do **outro** utilizador: importar para a conta de origem
   * exerceria a deduplicação, que é outra propriedade (e já está provada em
   * `import-export-cycle.test.ts`). Aqui interessa a fidelidade entre contas.
   */
  it('exporta, analisa, aplica e o resultado é fiel, com os documentos intactos', async () => {
    await createExpense(4990);

    /* 1–3. Exportar e obter os bytes. */
    const exportado = await downloadBundle();
    expect(exportado.status).toBe(200);
    expect(exportado.bytes.byteLength).toBeGreaterThan(0);

    /*
     * O ZIP é escrito num ficheiro? Não — viaja em memória de um pedido para o outro. É a
     * forma mais próxima do que o browser faz: recebe os bytes e reenvia-os sem os tocar.
     */
    const zipBytes = exportado.bytes;

    /* 4. Preview, com o Content-Type que o pipeline nativo exige. */
    const preview = await request(app)
      .post('/api/v1/import/preview')
      .set('Content-Type', 'application/zip')
      .set('Authorization', `Bearer ${otherToken}`)
      .send(zipBytes);

    expect(preview.status, JSON.stringify(preview.body)).toBe(200);

    /*
     * 5. O plano não está bloqueado e vê os registos.
     *
     * O corpo do preview é **plano** — `state`, `counts`, `entries` vivem na raiz, e não
     * dentro de um `plan`. Ler `preview.body.plan` daria `undefined`, e o `apply` receberia
     * `plan=undefined`: um 400 "falta o plano" que pareceria um problema do servidor.
     */
    expect(preview.body.state).not.toBe('blocked');
    expect(preview.body.state).not.toBe('nothing-to-do');
    expect(preview.body.entries.length).toBeGreaterThan(0);

    /* 6. Aplicar o plano aprovado — o corpo do preview é o plano que o `apply` aceita. */
    const aplicado = await request(app)
      .post('/api/v1/import/apply')
      .query({ plan: JSON.stringify(preview.body) })
      .set('Content-Type', 'application/zip')
      .set('Authorization', `Bearer ${otherToken}`)
      .send(zipBytes);

    expect(aplicado.status, JSON.stringify(aplicado.body)).toBe(200);
    expect(aplicado.body.applied).toBe(true);

    /* 7. O resultado existe na conta de destino. */
    const destino = await appPrisma.vehicle.findMany({
      where: { userId: other.id },
      select: { id: true, plate: true, make: true },
    });
    expect(destino.length).toBe(1);
    /*
     * `plate` é guardada **normalizada** (maiúsculas, sem separadores) e o valor legível
     * fica em `plateDisplay`. A importação usa o normalizador do domínio, pelo que o que
     * se verifica aqui é a forma canónica — comparar com o valor de origem seria verificar
     * um formato que o domínio não promete.
     */
    expect(destino[0]!.plate).toBe('AA11BB');
    expect(destino[0]!.make).toBe('Renault');

    const despesas = await appPrisma.expense.findMany({
      where: { userId: other.id },
      select: { amountCents: true, description: true },
    });
    expect(despesas.length).toBe(1);
    expect(despesas[0]!.amountCents).toBe(4990);
    expect(despesas[0]!.description).toBe('Abastecimento');
  });

  it('os documentos importados têm os bytes originais, byte a byte', async () => {
    const original = Buffer.from('conteúdo binário do documento \u0000\u0001\u00ff', 'binary');
    const { createHash, randomBytes } = await import('node:crypto');
    const { mkdir } = await import('node:fs/promises');

    const sha256 = createHash('sha256').update(original).digest('hex');
    const id = randomBytes(16).toString('hex');
    const storageKey = `${owner.id}/${id}`;
    await mkdir(join(storageRoot, owner.id), { recursive: true });
    await writeFile(join(storageRoot, owner.id, id), original);

    await appPrisma.document.create({
      data: {
        userId: owner.id,
        vehicleId,
        name: 'Documento do ciclo',
        category: 'other',
        storageKey,
        sizeBytes: original.byteLength,
      },
    });

    const exportado = await downloadBundle();

    const preview = await request(app)
      .post('/api/v1/import/preview')
      .set('Content-Type', 'application/zip')
      .set('Authorization', `Bearer ${otherToken}`)
      .send(exportado.bytes);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);

    const aplicado = await request(app)
      .post('/api/v1/import/apply')
      .query({ plan: JSON.stringify(preview.body) })
      .set('Content-Type', 'application/zip')
      .set('Authorization', `Bearer ${otherToken}`)
      .send(exportado.bytes);
    expect(aplicado.status, JSON.stringify(aplicado.body)).toBe(200);

    /* 8. Os bytes no destino são os mesmos. */
    const documento = await appPrisma.document.findFirst({
      where: { userId: other.id },
      select: { storageKey: true, sizeBytes: true },
    });
    expect(documento).not.toBeNull();
    expect(documento!.storageKey).not.toBeNull();

    const noDestino = await readFile(join(storageRoot, documento!.storageKey!));
    expect(noDestino.equals(original)).toBe(true);
    expect(documento!.sizeBytes).toBe(original.byteLength);

    /*
     * 9. O hash declarado continua a corresponder.
     *
     * O `contentSha256` não vive na base de dados — é calculado a partir dos bytes. Por
     * isso, reexportar a conta de destino é a forma de o observar: se os bytes tivessem
     * sido alterados na importação, a segunda exportação declararia um hash diferente, e o
     * leitor recusaria o seu próprio bundle.
     */
    const reexportado = await downloadBundle('', otherToken);
    const { readZip } = await import('../src/domain/import/zip.js');
    const { readBundle } = await import('../src/domain/import/bundle.js');
    const zip = readZip(new Uint8Array(reexportado.bytes));
    const bundle = readBundle(zip.entries);

    expect(bundle.documentBytes.length).toBe(1);
    expect(bundle.documentBytes[0]!.sha256).toBe(sha256);
  });
});

/* ========================================================================== */
/* 5. Compatibilidade: o legado não mudou                                      */
/* ========================================================================== */

describe('compatibilidade com a exportação legada (§54)', () => {
  it('o JSON legado continua a ter a forma que os consumidores verificam', async () => {
    await createExpense();

    const response = await request(app)
      .get('/api/v1/export?format=json')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.meta.formatVersion).toBe(1);
    expect(Array.isArray(response.body.meta.notes)).toBe(true);
    expect(response.body.vehicles.length).toBe(1);
    expect(response.body.expenses.length).toBe(1);
  });

  it('o CSV legado continua a começar com BOM UTF-8', async () => {
    const response = await request(app)
      .get('/api/v1/export?format=csv')
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    const bytes = response.body as Buffer;
    expect(response.status).toBe(200);
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
  });

  /**
   * Os dois artefactos são **diferentes**, e o teste fixa essa diferença.
   *
   * Se `/export` passasse a devolver o ZIP, o `ExportPage` deixaria de oferecer um JSON
   * para abrir numa ferramenta; se `/export/bundle` devolvesse JSON, o importador nativo
   * recusá-lo-ia. A asserção cruzada é o que impede que uma futura unificação passe
   * despercebida.
   */
  it('os dois endereços devolvem artefactos diferentes', async () => {
    const legado = await request(app)
      .get('/api/v1/export?format=json')
      .set('Authorization', `Bearer ${token}`);
    const nativo = await downloadBundle();

    expect(legado.headers['content-type']).toContain('application/json');
    expect(nativo.contentType).toContain('application/zip');
    expect(nativo.bytes.subarray(0, 1).toString('utf8')).not.toBe('{');
  });

  it('uma rota de exportação que não existe responde 404, não 401', async () => {
    // A correspondência exacta de autenticação não pode transformar um endereço
    // inexistente num problema de credenciais.
    const response = await request(app).get('/api/v1/export/bundle-x');
    expect(response.status).toBe(404);
  });
});
