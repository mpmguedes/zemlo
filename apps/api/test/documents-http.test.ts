/**
 * Contrato HTTP dos documentos — transferência e edição de metadados (§17).
 *
 * ## Porque é que esta suite existe
 *
 * O `document-storage.test.ts` prova que o armazenamento guarda e devolve bytes fiéis, e
 * que recusa chaves de outra conta. Prova-o, porém, ao nível do serviço: chama `save` e
 * `read` directamente. Não responde à pergunta que o utilizador faz — *"como é que eu
 * abro o documento que está ali?"* — nem à que o atacante faz — *"o que é que eu consigo
 * ler se souber a chave?"*.
 *
 * Esta suite sobe a aplicação a sério (`createApp()`), com sessões reais obtidas por
 * `signup`, e verifica o contrato pela fronteira que ambos usam.
 *
 * ## O que é que estes testes provam
 *
 *  - **autenticação** — sem sessão e com token inválido, 401 (não 404: o endereço existe);
 *  - **isolamento entre contas** — o dono de um documento transfere-o; outro utilizador
 *    autenticado recebe 404, mesmo sabendo o id **e** a `storageKey`;
 *  - **fidelidade dos bytes** — o que sai da rota é exactamente o que entrou no
 *    armazenamento, comparado byte a byte e por `sha256`;
 *  - **tipo de conteúdo** — anunciado quando é seguro, rebaixado quando é activo;
 *  - **`Content-Disposition` seguro** — sem injeção de cabeçalho, sem caminhos, sem
 *    controlos bidirecionais;
 *  - **estados de erro do armazenamento** — sem ficheiro, ficheiro ausente do
 *    armazenamento, chave de outra conta: todos indistinguíveis de fora;
 *  - **edição de metadados isolada** — o `PATCH` de uma conta não toca nos documentos de
 *    outra, e um documento alheio responde 404;
 *  - **não regressão** — a lista, o detalhe, a criação e a eliminação continuam a
 *    comportar-se como antes.
 *
 * ## A base de dados e o armazenamento
 *
 * Como em `export-bundle-http.test.ts`: a `DATABASE_URL` e o `DOCUMENT_STORAGE_DIR` são
 * definidos **antes** de a aplicação ser importada, porque o `core/db.ts` instancia o
 * cliente no import e o armazenamento lê o directório na primeira utilização.
 */

import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

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

beforeAll(async () => {
  db = await createTestDb();
  storageRoot = await mkdtemp(join(tmpdir(), 'zemlo-doc-http-'));

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

  // O `documentStorage()` é uma instância partilhada criada na primeira utilização. Numa
  // suite anterior o `DOCUMENT_STORAGE_DIR` poderia já ter sido lido; reiniciar garante que
  // esta suite escreve no seu próprio directório.
  const { resetDocumentStorage } = await import('../src/services/document-storage.js');
  resetDocumentStorage();

  const sonda = await appPrisma.user.create({
    data: { email: 'sonda-doc@zemlo.test', name: 'Sonda' },
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

  const titular = await signup(app, 'doc-titular@zemlo.test');
  const outro = await signup(app, 'doc-outro@zemlo.test');
  owner = titular.user;
  other = outro.user;
  token = titular.token;
  otherToken = outro.token;
});

async function resetDatabase(): Promise<void> {
  await db.prisma.auditLog.deleteMany();
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

/* -------------------------------------------------------------------------- */
/* Utilitários                                                                 */
/* -------------------------------------------------------------------------- */

const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'latin1');

/**
 * Cria um documento e escreve os seus bytes no armazenamento.
 *
 * A chave é construída à mão no formato que o armazenamento usa (`<userId>/<16 hex>`), em
 * vez de passar por `storage.save()`, porque o que se pretende montar é um **estado** — um
 * registo na base de dados com uma chave que aponta para bytes existentes — e o `save`
 * devolveria uma chave nova que teria de ser escrita de volta no registo.
 */
async function seedDocument(
  overrides: {
    userId?: string;
    name?: string;
    category?: string;
    fileName?: string | null;
    mimeType?: string | null;
    storageKey?: string | null;
    withBytes?: boolean;
    bytes?: Buffer;
    vehicleId?: string | null;
    expiresAt?: Date | null;
    date?: Date | null;
    notes?: string | null;
  } = {},
): Promise<{ id: string; storageKey: string | null }> {
  const userId = overrides.userId ?? owner.id;
  const withBytes = overrides.withBytes ?? true;
  const storageKey =
    overrides.storageKey !== undefined
      ? overrides.storageKey
      : withBytes
        ? `${userId}/${randomHex()}`
        : null;

  if (withBytes && storageKey) {
    const fullPath = join(storageRoot, ...storageKey.split('/'));
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, overrides.bytes ?? PDF_BYTES);
  }

  const document = await appPrisma.document.create({
    data: {
      userId,
      vehicleId: overrides.vehicleId ?? null,
      name: overrides.name ?? 'Apólice de seguro',
      category: overrides.category ?? 'insurance',
      date: overrides.date ?? null,
      expiresAt: overrides.expiresAt ?? null,
      fileName: overrides.fileName !== undefined ? overrides.fileName : 'apolice.pdf',
      mimeType: overrides.mimeType !== undefined ? overrides.mimeType : 'application/pdf',
      sizeBytes: withBytes ? (overrides.bytes ?? PDF_BYTES).byteLength : null,
      storageKey,
      notes: overrides.notes ?? null,
    },
    select: { id: true, storageKey: true },
  });

  return document;
}

function randomHex(): string {
  let out = '';
  for (let index = 0; index < 16; index += 1) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

/** Descarrega os bytes como `Buffer`, e não como texto: um PDF não sobrevive a uma leitura textual. */
async function download(
  documentId: string,
  bearer: string | null = token,
): Promise<{
  status: number;
  bytes: Buffer;
  contentType: string;
  disposition: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}> {
  const pending = request(app).get(`/api/v1/documents/${documentId}/content`);
  if (bearer !== null) pending.set('Authorization', `Bearer ${bearer}`);

  const response = await pending.buffer(true).parse((res, callback) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => callback(null, Buffer.concat(chunks)));
  });

  return {
    status: response.status,
    bytes: (response.body as Buffer) ?? Buffer.alloc(0),
    contentType: response.headers['content-type'] ?? '',
    disposition: response.headers['content-disposition'] ?? '',
    headers: response.headers as Record<string, string | string[] | undefined>,
    body: response.body,
  };
}

/** O envelope de erro da API: `{ error: { code, message, requestId } }`. */
async function errorOf(response: request.Response): Promise<{ code: string; message: string }> {
  return (response.body as { error: { code: string; message: string } }).error;
}

/* ========================================================================== */
/* 1. Autenticação                                                             */
/* ========================================================================== */

describe('transferência — autenticação', () => {
  it('exige sessão', async () => {
    const document = await seedDocument();
    const response = await request(app).get(`/api/v1/documents/${document.id}/content`);
    expect(response.status).toBe(401);
  });

  it('recusa um token inválido', async () => {
    const document = await seedDocument();
    const response = await request(app)
      .get(`/api/v1/documents/${document.id}/content`)
      .set('Authorization', 'Bearer nao-e-um-token');
    expect(response.status).toBe(401);
  });

  /**
   * O endereço é **conhecido** e protegido, pelo que a resposta é 401 e não 404. É esta
   * distinção que a allowlist de autenticação do router garante: um endereço que não
   * existe responde 404 com ou sem token, e um que existe responde 401 sem token.
   */
  it('devolve 401 e não 404, para um id inexistente e sem sessão', async () => {
    const response = await request(app).get('/api/v1/documents/nao-existe/content');
    expect(response.status).toBe(401);
  });
});

/* ========================================================================== */
/* 2. Isolamento entre contas                                                  */
/* ========================================================================== */

describe('transferência — isolamento', () => {
  it('o dono transfere o seu documento', async () => {
    const document = await seedDocument();
    const response = await download(document.id);
    expect(response.status).toBe(200);
    expect(Buffer.compare(response.bytes, PDF_BYTES)).toBe(0);
  });

  it('outra conta não transfere o documento, mesmo conhecendo o id', async () => {
    const document = await seedDocument();
    const response = await download(document.id, otherToken);
    expect(response.status).toBe(404);
  });

  /**
   * O caso que a tarefa nomeia explicitamente: uma conta autenticada que **sabe a
   * `storageKey`** não pode usá-la para ler bytes alheios. Aqui a chave nem chega a ser um
   * parâmetro — o endereço só aceita um id —, pelo que a única forma de a exercer é
   * conhecendo-a e apontando a **sua própria** rota para ela, o que faz o armazenamento
   * recusar. O teste verifica as duas metades: que a chave alheia não abre pela rota do
   * dono, e que apontá-la a um documento próprio não devolve os bytes alheios.
   */
  it('uma chave de outra conta nunca serve bytes, mesmo referida por um documento próprio', async () => {
    const alheio = await seedDocument({ userId: other.id, bytes: Buffer.from('segredo do outro') });

    // O atacante cria um documento seu cuja chave aponta para os bytes da outra conta.
    const forjado = await seedDocument({
      userId: owner.id,
      storageKey: alheio.storageKey ?? '',
      withBytes: false,
    });

    const response = await download(forjado.id);
    // 404 e não 403: de fora, "a chave não é tua" e "o documento não tem ficheiro" são o
    // mesmo caso. Um 403 confirmaria a existência do documento e da chave.
    expect(response.status).toBe(404);

    const error = await errorOf(
      await request(app)
        .get(`/api/v1/documents/${forjado.id}/content`)
        .set('Authorization', `Bearer ${token}`),
    );
    expect(error.message).not.toContain('segredo');
    expect(error.message).not.toContain(String(alheio.storageKey));
  });

  it('a lista e o detalhe continuam isolados por conta', async () => {
    await seedDocument({ name: 'Meu documento' });

    const lista = await request(app)
      .get('/api/v1/documents')
      .set('Authorization', `Bearer ${otherToken}`);
    expect(lista.status).toBe(200);
    expect(lista.body.items).toHaveLength(0);
  });
});

/* ========================================================================== */
/* 3. Bytes e integridade                                                      */
/* ========================================================================== */

describe('transferência — bytes', () => {
  it('devolve os bytes exactos, incluindo zeros e bytes altos', async () => {
    // Um documento real não é texto: zeros, bytes altos e sequências inválidas em UTF-8
    // têm de sobreviver à viagem.
    const cru = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x0a, 0x0d, 0x25, 0x50, 0x44, 0x46]);
    const document = await seedDocument({ bytes: cru });

    const response = await download(document.id);
    expect(response.status).toBe(200);
    expect(Buffer.compare(response.bytes, cru)).toBe(0);
  });

  it('o `sha256` dos bytes servidos coincide com o dos bytes guardados', async () => {
    const document = await seedDocument();
    const response = await download(document.id);

    const { sha256Hex } = await import('../src/services/document-storage.js');
    expect(sha256Hex(response.bytes)).toBe(sha256Hex(PDF_BYTES));
  });

  it('anuncia o comprimento do corpo', async () => {
    const document = await seedDocument();
    const response = await request(app)
      .get(`/api/v1/documents/${document.id}/content`)
      .set('Authorization', `Bearer ${token}`);
    expect(Number(response.headers['content-length'])).toBe(PDF_BYTES.byteLength);
  });
});

/* ========================================================================== */
/* 4. Tipo de conteúdo                                                         */
/* ========================================================================== */

describe('transferência — tipo de conteúdo', () => {
  it('anuncia um tipo seguro da lista de permissão', async () => {
    const document = await seedDocument({ mimeType: 'application/pdf' });
    const response = await download(document.id);
    expect(response.contentType).toContain('application/pdf');
  });

  it('ignora os parâmetros do tipo gravado', async () => {
    const document = await seedDocument({ mimeType: 'application/pdf; charset=utf-8' });
    const response = await download(document.id);
    expect(response.contentType).toContain('application/pdf');
  });

  /**
   * O caso que a lista de permissão existe para travar. Um `mimeType` vem do cliente que
   * criou o documento; servido como `text/html`, o ficheiro correria na origem da API e
   * leria os tokens do utilizador.
   */
  it('rebaixa tipos activos a `application/octet-stream`', async () => {
    for (const perigoso of ['text/html', 'image/svg+xml', 'application/xhtml+xml', 'text/javascript']) {
      const document = await seedDocument({ mimeType: perigoso });
      const response = await download(document.id);
      expect(response.contentType, `${perigoso} não devia ser servido inline`).toContain(
        'application/octet-stream',
      );
    }
  });

  it('cai no tipo genérico quando não há tipo gravado', async () => {
    const document = await seedDocument({ mimeType: null });
    const response = await download(document.id);
    expect(response.contentType).toContain('application/octet-stream');
  });
});

/* ========================================================================== */
/* 5. `Content-Disposition`                                                    */
/* ========================================================================== */

describe('transferência — nome do ficheiro', () => {
  it('usa o nome do ficheiro, como transferência', async () => {
    const document = await seedDocument({ fileName: 'apolice-2026.pdf' });
    const response = await download(document.id);
    expect(response.disposition).toContain('attachment');
    expect(response.disposition).toContain('apolice-2026.pdf');
  });

  /**
   * O `\r\n` no nome é *response splitting*: sem tratamento, o Node ou lança
   * `ERR_INVALID_CHAR` (500 num pedido legítimo) ou escreve cabeçalhos novos na resposta.
   *
   * Os controlos são **retirados** e não substituídos por `_`, pelo que `mau\r\nX-Injected`
   * fica `mauX-Injected`: as partes colam-se em vez de deixarem um separador a sugerir que
   * ali houve algo. É por isso que a asserção é sobre a ausência de `\r`/`\n` e sobre o
   * cabeçalho não ter sido criado, e não sobre a forma exacta do nome.
   */
  it('remove caracteres de controlo, impedindo injeção de cabeçalho', async () => {
    const document = await seedDocument({
      fileName: 'mau\r\nX-Injected: sim\r\n\r\n.pdf',
    });
    const response = await download(document.id);

    expect(response.status).toBe(200);
    expect(Object.hasOwn(response.headers, 'x-injected')).toBe(false);
    expect(response.disposition).not.toContain('\r');
    expect(response.disposition).not.toContain('\n');
    expect(response.disposition).toContain('mauX-Injected');
    expect(response.disposition).toMatch(/^attachment; filename="[^"]*"$/);
  });

  it('descarta o caminho e fica só com o último segmento', async () => {
    const document = await seedDocument({ fileName: '../../etc/passwd' });
    const response = await download(document.id);
    expect(response.disposition).toContain('passwd');
    expect(response.disposition).not.toContain('..');
    expect(response.disposition).not.toContain('/etc');
  });

  /**
   * O disfarce de extensão: um controlo bidirecional inverte a ordem visual, fazendo
   * `gnp.exe` passar por `exe.png` para quem lê o nome.
   */
  it('remove controlos bidirecionais', async () => {
    const document = await seedDocument({ fileName: 'gnp\u202Egnp.exe' });
    const response = await download(document.id);
    expect(response.disposition).not.toContain('\u202E');
  });

  it('remove aspas e pontos e vírgulas, que quebrariam a sintaxe', async () => {
    const document = await seedDocument({ fileName: 'a";b=c.pdf' });
    const response = await download(document.id);
    expect(response.disposition).toMatch(/^attachment; filename="[^"]*"$/);
  });

  it('não deixa o nome começar por ponto', async () => {
    const document = await seedDocument({ fileName: '...apolice.pdf' });
    const response = await download(document.id);
    expect(response.disposition).not.toMatch(/filename="\./);
  });

  it('acrescenta a extensão do tipo quando o nome não tem nenhuma', async () => {
    const document = await seedDocument({ fileName: 'apolice', mimeType: 'application/pdf' });
    const response = await download(document.id);
    expect(response.disposition).toContain('apolice.pdf');
  });

  it('cai no nome do documento quando não há nome de ficheiro', async () => {
    const document = await seedDocument({ fileName: null, name: 'Certificado de matrícula' });
    const response = await download(document.id);
    expect(response.disposition).toContain('Certificado');
  });

  it('trunca nomes absurdos', async () => {
    const document = await seedDocument({ fileName: `${'a'.repeat(400)}.pdf` });
    const response = await download(document.id);
    const match = /filename="([^"]+)"/.exec(response.disposition);
    expect(match?.[1].length ?? 0).toBeLessThanOrEqual(120);
  });

  it('nunca produz um nome vazio', async () => {
    const document = await seedDocument({ fileName: '...', name: '.' });
    const response = await download(document.id);
    expect(response.disposition).toMatch(/filename="[^"]+"/);
  });
});

/* ========================================================================== */
/* 6. Estados de erro do armazenamento                                         */
/* ========================================================================== */

describe('transferência — erros', () => {
  /**
   * Um documento registado à mão, só para vigiar a validade. Não é um erro do utilizador:
   * é um estado legítimo, e a resposta descreve-o em vez de o tratar como falha.
   */
  it('404 quando o documento não tem ficheiro associado', async () => {
    const document = await seedDocument({ withBytes: false });
    const response = await download(document.id);
    expect(response.status).toBe(404);
    const error = await errorOf(
      await request(app)
        .get(`/api/v1/documents/${document.id}/content`)
        .set('Authorization', `Bearer ${token}`),
    );
    expect(error.message).toContain('ficheiro');
  });

  it('404 quando a chave existe mas os bytes desapareceram do armazenamento', async () => {
    const document = await seedDocument();
    await rm(join(storageRoot, ...(document.storageKey ?? '').split('/')), { force: true });

    const response = await download(document.id);
    expect(response.status).toBe(404);
  });

  it('404 para um documento inexistente', async () => {
    const response = await download('doc_que_nao_existe');
    expect(response.status).toBe(404);
  });

  /**
   * O paralelo com o dono e o intruso: um documento de outra conta e um documento que não
   * existe têm de ser **indistinguíveis**. É o que impede a rota de servir de oráculo.
   *
   * O `requestId` difere entre respostas — é um identificador de correlação, não conteúdo —
   * pelo que a comparação é feita sobre o `code` e a `message`, que são o que um atacante lê.
   */
  it('a resposta para o documento de outra conta é igual à de um documento inexistente', async () => {
    const document = await seedDocument();
    const alheio = await download(document.id, otherToken);
    const inexistente = await download('doc_que_nao_existe', otherToken);

    expect(alheio.status).toBe(404);
    expect(inexistente.status).toBe(404);

    const corpoAlheio = JSON.parse(alheio.bytes.toString()) as { error: { code: string; message: string } };
    const corpoInexistente = JSON.parse(inexistente.bytes.toString()) as {
      error: { code: string; message: string };
    };
    expect(corpoAlheio.error.code).toBe(corpoInexistente.error.code);
    expect(corpoAlheio.error.message).toBe(corpoInexistente.error.message);
  });

  /**
   * Uma chave sintaticamente perigosa é um defeito de dados. Não pode chegar ao sistema de
   * ficheiros, e não pode sair na resposta — um caminho no corpo revelaria a estrutura do
   * servidor.
   */
  it('recusa uma chave com caminho, sem revelar o caminho', async () => {
    const document = await seedDocument({
      storageKey: `${owner.id}/../../../etc/passwd`,
      withBytes: false,
    });
    const response = await download(document.id);

    expect(response.status).toBe(404);
    expect(response.bytes.toString()).not.toContain('etc/passwd');
    expect(response.bytes.toString()).not.toContain(storageRoot);
  });

  it('não devolve bytes nem chave no corpo de um erro', async () => {
    const document = await seedDocument();
    await rm(join(storageRoot, ...(document.storageKey ?? '').split('/')), { force: true });

    const response = await download(document.id);
    expect(response.bytes.toString()).not.toContain('PDF');
    expect(response.bytes.toString()).not.toContain(document.storageKey ?? '###');
  });
});

/* ========================================================================== */
/* 7. Edição de metadados                                                      */
/* ========================================================================== */

describe('edição — metadados', () => {
  it('o dono edita os seus metadados', async () => {
    const document = await seedDocument({ name: 'Antigo', notes: null });
    const response = await request(app)
      .patch(`/api/v1/documents/${document.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ name: 'Novo nome', notes: 'Corrigido' });

    expect(response.status).toBe(200);
    expect(response.body.name).toBe('Novo nome');
    expect(response.body.notes).toBe('Corrigido');
  });

  it('outra conta não edita o documento', async () => {
    const document = await seedDocument({ name: 'Intocável' });
    const response = await request(app)
      .patch(`/api/v1/documents/${document.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .set('Content-Type', 'application/json')
      .send({ name: 'Alterado' });

    expect(response.status).toBe(404);
    const guardado = await appPrisma.document.findUnique({ where: { id: document.id } });
    expect(guardado?.name, 'O nome não devia ter mudado').toBe('Intocável');
  });

  /**
   * A edição de um documento de uma conta não pode tocar nos documentos de outra. É a
   * propriedade que um `updateMany` sem filtro de dono quebraria silenciosamente.
   */
  it('editar não afecta os documentos de outra conta', async () => {
    const meu = await seedDocument({ name: 'Meu' });
    const alheio = await seedDocument({ userId: other.id, name: 'Do outro' });

    await request(app)
      .patch(`/api/v1/documents/${meu.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ name: 'Mudado' });

    const outro = await appPrisma.document.findUnique({ where: { id: alheio.id } });
    expect(outro?.name).toBe('Do outro');
  });

  it('rejeita metadados inválidos com 422', async () => {
    const document = await seedDocument();
    const response = await request(app)
      .patch(`/api/v1/documents/${document.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ name: '' });

    expect(response.status).toBe(422);
  });

  it('exige sessão para editar', async () => {
    const document = await seedDocument();
    const response = await request(app)
      .patch(`/api/v1/documents/${document.id}`)
      .set('Content-Type', 'application/json')
      .send({ name: 'Sem sessão' });
    expect(response.status).toBe(401);
  });

  it('lê o detalhe de um documento', async () => {
    const document = await seedDocument({ name: 'Detalhe' });
    const response = await request(app)
      .get(`/api/v1/documents/${document.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.name).toBe('Detalhe');
  });

  it('o detalhe de um documento de outra conta responde 404', async () => {
    const document = await seedDocument();
    const response = await request(app)
      .get(`/api/v1/documents/${document.id}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(response.status).toBe(404);
  });

  it('a edição de metadados não altera os bytes nem a chave', async () => {
    const document = await seedDocument();
    const antes = await download(document.id);

    await request(app)
      .patch(`/api/v1/documents/${document.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ name: 'Renomeado' });

    const depois = await download(document.id);
    expect(Buffer.compare(antes.bytes, depois.bytes)).toBe(0);

    const guardado = await appPrisma.document.findUnique({ where: { id: document.id } });
    expect(guardado?.storageKey).toBe(document.storageKey);
  });
});

/* ========================================================================== */
/* 8. Não regressão                                                            */
/* ========================================================================== */

describe('não regressão', () => {
  it('a lista continua a responder', async () => {
    await seedDocument();
    const response = await request(app)
      .get('/api/v1/documents')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
  });

  it('a criação continua a responder 201', async () => {
    const response = await request(app)
      .post('/api/v1/documents')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ name: 'Novo', category: 'registration' });

    expect(response.status).toBe(201);
    expect(response.headers.location).toContain('/api/v1/documents/');
  });

  it('a eliminação continua a responder 204', async () => {
    const document = await seedDocument();
    const response = await request(app)
      .delete(`/api/v1/documents/${document.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(204);
  });

  it('os documentos a expirar continuam a responder', async () => {
    const response = await request(app)
      .get('/api/v1/documents/expiring')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.items)).toBe(true);
  });

  /** Um endereço inexistente não é confundido com um que existe sem autenticação. */
  it('um endereço inexistente responde 404 sem sessão', async () => {
    const response = await request(app).get('/api/v1/documents/abc/nao-existe');
    expect(response.status).toBe(404);
  });

  it('a rota de conteúdo não aceita POST', async () => {
    const document = await seedDocument();
    const response = await request(app)
      .post(`/api/v1/documents/${document.id}/content`)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(404);
  });
});

/* ========================================================================== */
/* 9. O nome do ficheiro, ao nível da unidade                                  */
/* ========================================================================== */

describe('sanitização do nome do ficheiro', () => {
  it('é determinística e idempotente', async () => {
    const { sanitizeDownloadName } = await import('../src/services/documents.js');
    const uma = sanitizeDownloadName('apolice 2026.pdf', 'Apólice', 'application/pdf');
    const duas = sanitizeDownloadName(uma, 'Apólice', 'application/pdf');
    expect(uma).toBe(duas);
  });

  it('acrescenta a extensão só quando o nome não tem uma', async () => {
    const { sanitizeDownloadName } = await import('../src/services/documents.js');
    expect(sanitizeDownloadName('apolice', 'X', 'application/pdf')).toBe('apolice.pdf');
    expect(sanitizeDownloadName('apolice.PDF', 'X', 'application/pdf')).toBe('apolice.PDF');
  });

  it('preserva acentos como caracteres seguros', async () => {
    const { sanitizeDownloadName } = await import('../src/services/documents.js');
    // Os acentos caem em `_` — a nota da função explica porquê (RFC 5987 deliberadamente
    // não usado). O que se verifica é que o resultado continua a ser um nome utilizável.
    const nome = sanitizeDownloadName('Apólice.pdf', 'X', 'application/pdf');
    expect(nome).toMatch(/^[\w.\- ]+$/);
    expect(nome.endsWith('.pdf')).toBe(true);
  });
});
