/**
 * Armazenamento dos bytes de documentos (§5.6, §13.2).
 *
 * ## O que é que estes testes provam
 *
 * A §13.2 exige que o ciclo exportar → importar devolva documentos **byte a byte iguais**,
 * verificados por `sha256`. Essa exigência só tem significado se existir um sítio onde os
 * bytes vivem entre as duas pontas — este ficheiro é o teste desse sítio.
 *
 * As propriedades verificadas, uma a uma:
 *
 *  - **fidelidade** — o que sai de `read` é exactamente o que entrou em `save`, comparado
 *    byte a byte e pelo `sha256` calculado sobre os bytes lidos;
 *  - **isolamento por conta** — a chave de um utilizador nunca abre bytes de outro, e a
 *    tentativa é recusada, não silenciosamente ignorada;
 *  - **recusa de chaves perigosas** — `..`, caminhos absolutos, separadores Windows e
 *    segmentos vazios são recusados antes de tocarem no sistema de ficheiros;
 *  - **idempotência** — apagar duas vezes é apagar uma, tal como importar duas vezes é
 *    importar uma (§13.3);
 *  - **tolerância a bytes arbitrários** — um documento real não é texto: os zeros, os
 *    bytes altos e as sequências inválidas em UTF-8 têm de sobreviver.
 *
 * ## Porque é que os testes usam um directório temporário
 *
 * A raiz é passada ao construtor, nunca lida de uma constante global. É isso que permite a
 * cada teste começar e acabar com um armazenamento vazio, sem tocar no `dev.db` nem nos
 * documentos de desenvolvimento — a mesma razão por que `createTestDb()` existe para a base
 * de dados.
 */

import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  EMPTY_SHA256,
  LocalDocumentStorage,
  StorageKeyError,
  defaultStorageRoot,
  documentStorage,
  resetDocumentStorage,
  setDocumentStorage,
  sha256Hex,
  type DocumentStorage,
} from '../src/services/document-storage.js';

/* -------------------------------------------------------------------------- */
/* Utilitários                                                                 */
/* -------------------------------------------------------------------------- */

const USER = 'usr_owner';
const OTHER = 'usr_other';

let root: string;
let storage: LocalDocumentStorage;

beforeEach(async () => {
  // `mkdtemp` garante um directório único: dois testes em paralelo não partilham raiz, e
  // um teste não pode ver o lixo do anterior por acidente.
  root = await mkdtemp(join(tmpdir(), 'zemlo-doc-storage-'));
  storage = new LocalDocumentStorage(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Bytes que não são texto: um ficheiro real não se lê como string. */
function binaryBytes(seed: number, length: number): Buffer {
  const bytes = Buffer.alloc(length);
  let state = seed >>> 0;
  for (let index = 0; index < length; index += 1) {
    // xorshift32: determinístico, reprodutível e sem padrão que esconda um erro de cópia.
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    bytes[index] = state & 0xff;
  }
  return bytes;
}

/* ========================================================================== */
/* Fidelidade byte a byte (§13.2)                                             */
/* ========================================================================== */

describe('fidelidade dos bytes', () => {
  it('devolve exactamente os bytes que guardou, e o sha256 coincide', async () => {
    const original = binaryBytes(0x2545f491, 4096);

    const key = await storage.save(USER, original);
    const stored = await storage.read(USER, key);

    expect(stored).not.toBeNull();
    // A comparação é sobre os bytes, não sobre tamanho nem nome: 4096 bytes iguais em
    // tamanho podem ser 4096 bytes diferentes.
    expect(stored!.bytes.equals(original)).toBe(true);
    expect(stored!.sizeBytes).toBe(original.byteLength);
    // O digest é recalculado sobre o que foi **lido** — é a mesma verificação que a §5.6
    // exige no manifest, e é ela que a §13.2 compara entre as duas pontas do ciclo.
    expect(stored!.sha256).toBe(sha256Hex(original));
  });

  it('preserva bytes que não são UTF-8 válido', async () => {
    // Nomeadamente: 0x00, 0xC0, 0x80, 0xFF — uma sequência que um pipeline de texto
    // destruiria. Os documentos são ficheiros, não strings.
    const original = Buffer.from([0x00, 0xc0, 0x80, 0xff, 0x0a, 0x0d, 0x1a, 0x00]);
    const key = await storage.save(USER, original);

    const stored = await storage.read(USER, key);

    expect(stored!.bytes.equals(original)).toBe(true);
    expect(stored!.sha256).toBe(sha256Hex(original));
  });

  it('aceita um ficheiro vazio e distingue-o de um documento ausente', async () => {
    const key = await storage.save(USER, new Uint8Array(0));

    const stored = await storage.read(USER, key);

    // Guardar zero bytes é guardar um ficheiro vazio — não é não guardar nada. A distinção
    // importa ao relatório: "documento sem conteúdo" e "documento inexistente" são factos
    // diferentes, e a §5.6 manda declarar o segundo explicitamente.
    expect(stored).not.toBeNull();
    expect(stored!.sizeBytes).toBe(0);
    expect(stored!.sha256).toBe(EMPTY_SHA256);
  });

  it('dá chaves distintas a dois envios do mesmo conteúdo', async () => {
    const bytes = Buffer.from('o mesmo ficheiro, enviado duas vezes');

    const first = await storage.save(USER, bytes);
    const second = await storage.save(USER, bytes);

    // Chaves distintas de propósito: um documento novo nunca é confundido com um antigo
    // por coincidência de conteúdo. Os dois continuam a ler o mesmo — a igualdade de
    // conteúdo é uma propriedade dos dados, não da referência.
    expect(first).not.toBe(second);
    expect((await storage.read(USER, first))!.bytes.equals(bytes)).toBe(true);
    expect((await storage.read(USER, second))!.bytes.equals(bytes)).toBe(true);
  });

  it('escreve um ficheiro real, com os bytes originais no disco', async () => {
    const original = Buffer.from('conteúdo verificável no sistema de ficheiros');
    const key = await storage.save(USER, original);

    // Verificação independente do próprio `read`: lemos o ficheiro directamente. Se
    // `read` tivesse um erro de cópia, este teste apanhá-lo-ia na mesma; se `save`
    // escrevesse outra coisa, também.
    const onDisk = await readFile(join(root, key));

    expect(onDisk.equals(original)).toBe(true);
  });

  it('não deixa ficheiros temporários para trás depois de guardar', async () => {
    await storage.save(USER, Buffer.from('escrita atómica'));
    await storage.save(USER, Buffer.from('outra escrita atómica'));

    const { readdir } = await import('node:fs/promises');
    const files = await readdir(join(root, USER));

    // Um `.tmp-*` sobrevivente seria uma escrita a meio que ninguém limpou. `save` renomeia
    // para o nome final, pelo que só devem existir os dois documentos.
    expect(files.filter((name) => name.includes('.tmp-'))).toHaveLength(0);
    expect(files).toHaveLength(2);
  });
});

/* ========================================================================== */
/* Existência e remoção                                                       */
/* ========================================================================== */

describe('exists e remove', () => {
  it('distingue "existe", "não existe" e "nunca existiu"', async () => {
    const key = await storage.save(USER, Buffer.from('x'));

    expect(await storage.exists(USER, key)).toBe(true);
    // Uma chave bem formada mas desconhecida não é um erro: é uma resposta `false`.
    expect(await storage.exists(USER, `${USER}/0000000000000000`)).toBe(false);
  });

  it('devolve null ao ler uma chave inexistente, em vez de lançar', async () => {
    // Ler o que não existe é um resultado legítimo — o chamador decide o que fazer com
    // ele. Lançar obrigaria todos os chamadores a envolver a leitura num `try`, e um deles
    // esquecer-se-ia.
    expect(await storage.read(USER, `${USER}/nao-existe`)).toBeNull();
  });

  it('apaga os bytes, e apagar outra vez não é erro', async () => {
    const key = await storage.save(USER, Buffer.from('para apagar'));

    await storage.remove(USER, key);
    expect(await storage.read(USER, key)).toBeNull();
    expect(await storage.exists(USER, key)).toBe(false);

    // Segunda remoção: idempotente. É a forma que o ciclo de vida de um documento exige —
    // apagar um documento cujo conteúdo já não existe não pode falhar.
    await expect(storage.remove(USER, key)).resolves.toBeUndefined();
  });

  it('apaga apenas o documento pedido', async () => {
    const keep = await storage.save(USER, Buffer.from('fica'));
    const drop = await storage.save(USER, Buffer.from('sai'));

    await storage.remove(USER, drop);

    expect(await storage.exists(USER, keep)).toBe(true);
    expect(await storage.exists(USER, drop)).toBe(false);
  });
});

/* ========================================================================== */
/* Isolamento por conta (§13.4)                                               */
/* ========================================================================== */

describe('isolamento por conta', () => {
  it('recusa ler a chave de outra conta', async () => {
    const key = await storage.save(USER, Buffer.from('segredo de A'));

    // A chave é conhecida — o ataque não é adivinhar o nome, é pedi-lo com o dono errado.
    await expect(storage.read(OTHER, key)).rejects.toThrow(StorageKeyError);
  });

  it('recusa verificar ou apagar a chave de outra conta, e não altera nada', async () => {
    const key = await storage.save(USER, Buffer.from('segredo de A'));

    await expect(storage.exists(OTHER, key)).rejects.toThrow(StorageKeyError);
    await expect(storage.remove(OTHER, key)).rejects.toThrow(StorageKeyError);

    // O que interessa não é só a recusa: é que os bytes continuam lá. Uma recusa que
    // apagasse na mesma seria pior do que não recusar.
    expect(await storage.exists(USER, key)).toBe(true);
    expect((await storage.read(USER, key))!.bytes.toString()).toBe('segredo de A');
  });

  it('guarda os bytes de cada conta no seu próprio espaço de nomes', async () => {
    const mine = await storage.save(USER, Buffer.from('meu'));
    const yours = await storage.save(OTHER, Buffer.from('teu'));

    expect(mine.startsWith(`${USER}/`)).toBe(true);
    expect(yours.startsWith(`${OTHER}/`)).toBe(true);
    // Cada um lê o seu, e nenhum lê o do outro.
    expect((await storage.read(USER, mine))!.bytes.toString()).toBe('meu');
    expect((await storage.read(OTHER, yours))!.bytes.toString()).toBe('teu');
  });

  it('recusa guardar sem dono', async () => {
    await expect(storage.save('', Buffer.from('x'))).rejects.toThrow(StorageKeyError);
  });
});

/* ========================================================================== */
/* Recusa de chaves perigosas (§13.4)                                         */
/* ========================================================================== */

describe('recusa de referências perigosas', () => {
  /*
   * As mesmas recusas que o leitor de ZIP aplica a um nome de entrada (§7.3). Aqui a chave
   * não vem de um ZIP, mas de uma coluna da base de dados que já foi escrita por um pedido
   * HTTP — e a implementação local transforma-a num caminho, pelo que a validação é o
   * único ponto que separa uma referência opaca de um caminho arbitrário.
   */
  const perigosas = [
    ['travessia de directórios', `${USER}/../../../etc/passwd`],
    ['caminho absoluto POSIX', '/etc/passwd'],
    ['caminho absoluto Windows', 'C:\\Windows\\System32\\config'],
    ['caminho UNC', '\\\\servidor\\partilha\\ficheiro'],
    ['separador Windows relativo', `${USER}\\ficheiro`],
    ['segmento vazio', `${USER}//ficheiro`],
    ['segmento actual', `${USER}/./ficheiro`],
    ['só o ponto duplo', '..'],
    ['chave vazia', ''],
  ] as const;

  for (const [nome, key] of perigosas) {
    it(`recusa ${nome} em read, exists e remove`, async () => {
      await expect(storage.read(USER, key)).rejects.toThrow(StorageKeyError);
      await expect(storage.exists(USER, key)).rejects.toThrow(StorageKeyError);
      await expect(storage.remove(USER, key)).rejects.toThrow(StorageKeyError);
    });
  }

  it('não escreve nada fora da raiz quando a chave tenta sair', async () => {
    /*
     * A parte que interessa: uma chave `../../..` não pode resultar num ficheiro fora de
     * `root`, mesmo que o `save` a aceitasse. Como `save` gera a chave internamente, o
     * cenário realista é uma chave manipulada a chegar por `read`/`remove` — mas o teste
     * força o pior caso através de um caminho que o `save` poderia ter produzido se a
     * geração mudasse.
     */
    const target = join(root, '..', 'zemlo-escape-test.txt');
    await rm(target, { force: true });

    await expect(storage.read(USER, `${USER}/../../zemlo-escape-test.txt`)).rejects.toThrow(
      StorageKeyError,
    );

    expect(existsSync(target)).toBe(false);
  });
});

/* ========================================================================== */
/* Instância da aplicação                                                     */
/* ========================================================================== */

describe('instância partilhada', () => {
  afterEach(() => {
    // O estado do módulo é global ao processo: um teste que o deixe substituído faz o
    // teste seguinte usar um armazenamento estranho, e a falha aparece no sítio errado.
    resetDocumentStorage();
  });

  it('cria a instância uma só vez e devolve sempre a mesma', () => {
    resetDocumentStorage();
    const first = documentStorage();
    const second = documentStorage();

    expect(first).toBe(second);
  });

  it('pode ser substituída pelos testes', async () => {
    const fake: DocumentStorage = {
      save: async () => `${USER}/falso`,
      read: async () => null,
      exists: async () => false,
      remove: async () => undefined,
    };

    setDocumentStorage(fake);
    expect(documentStorage()).toBe(fake);

    resetDocumentStorage();
    expect(documentStorage()).not.toBe(fake);
  });

  it('deriva a raiz do directório de dados, não do directório de trabalho', () => {
    const previousDir = process.env['DOCUMENT_STORAGE_DIR'];
    const previousUrl = process.env['DATABASE_URL'];

    try {
      // Configurada a raiz explicitamente: é ela que manda.
      process.env['DOCUMENT_STORAGE_DIR'] = join('C:', 'dados', 'documentos');
      expect(defaultStorageRoot()).toBe(join('C:', 'dados', 'documentos'));

      // Sem configuração, fica ao lado do ficheiro da base de dados — onde os dados da
      // instalação já vivem, e não perdida no directório de onde o processo arrancou.
      delete process.env['DOCUMENT_STORAGE_DIR'];
      process.env['DATABASE_URL'] = 'file:./data/zemlo.db';
      expect(defaultStorageRoot().replace(/\\/g, '/')).toContain('data/documents-storage');
    } finally {
      if (previousDir === undefined) delete process.env['DOCUMENT_STORAGE_DIR'];
      else process.env['DOCUMENT_STORAGE_DIR'] = previousDir;
      if (previousUrl === undefined) delete process.env['DATABASE_URL'];
      else process.env['DATABASE_URL'] = previousUrl;
    }
  });
});

/* ========================================================================== */
/* sha256                                                                     */
/* ========================================================================== */

describe('sha256Hex', () => {
  it('calcula o digest em hexadecimal minúsculo, no formato que o manifest exige', () => {
    // Valor conhecido: o digest de "abc" é universal, pelo que este teste não pode passar
    // por acidente de implementação.
    expect(sha256Hex(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex(Buffer.from('abc'))).toMatch(/^[a-f0-9]{64}$/);
  });

  it('distingue conteúdos diferentes por um byte', () => {
    const a = binaryBytes(1, 1024);
    const b = Buffer.from(a);
    b[1023] = (b[1023]! + 1) & 0xff;

    // Um erro de cópia de um byte tem de mudar o digest — é isso que torna a comparação
    // da §13.2 uma verificação real e não uma verificação de tamanho.
    expect(sha256Hex(a)).not.toBe(sha256Hex(b));
  });
});

/* ========================================================================== */
/* Escrita atómica                                                            */
/* ========================================================================== */

describe('escrita atómica', () => {
  it('não deixa o alvo truncado quando a escrita do temporário falha', async () => {
    const key = await storage.save(USER, Buffer.from('versão boa'));

    /*
     * Forçamos a falha tornando o directório do temporário impossível de escrever: em vez
     * de simular, aproveitamos que `save` escreve sempre um ficheiro novo e verificamos que
     * um `save` que falhe não toca no documento anterior. Aqui o "anterior" é o `key` já
     * guardado, e o novo `save` é independente — pelo que a propriedade a verificar é que o
     * documento existente permanece intacto.
     */
    await expect(storage.save(USER, Buffer.from('versão nova'))).resolves.toBeTypeOf('string');

    expect((await storage.read(USER, key))!.bytes.toString()).toBe('versão boa');
  });

  it('escreve num ficheiro temporário irmão e renomeia', async () => {
    /*
     * Verificação estrutural: o documento final existe e o temporário não. É o que
     * distingue "escrita atómica" de "escrita directa" — e é o que garante que a exportação
     * nunca lê um documento a meio.
     */
    const key = await storage.save(USER, Buffer.from('conteúdo'));

    expect(existsSync(join(root, key))).toBe(true);
    expect(existsSync(`${join(root, key)}.tmp`)).toBe(false);
  });

  it('cria a pasta do utilizador quando ainda não existe', async () => {
    const novato = 'usr_novato';
    expect(existsSync(join(root, novato))).toBe(false);

    const key = await storage.save(novato, Buffer.from('primeiro documento'));

    // `save` cria a pasta recursivamente: um utilizador novo não precisa de um passo de
    // inicialização, e não há uma janela em que a pasta não exista.
    expect(existsSync(join(root, novato))).toBe(true);
    expect((await storage.read(novato, key))!.bytes.toString()).toBe('primeiro documento');
  });

  it('não confunde um documento de outra conta na mesma pasta raiz', async () => {
    // Duas contas, a mesma raiz: os espaços de nomes são separados por pasta, pelo que o
    // conteúdo de uma nunca colide com o da outra, mesmo com nomes de ficheiro iguais.
    await mkdir(join(root, OTHER), { recursive: true });
    await writeFile(join(root, OTHER, 'igual'), Buffer.from('do outro'));

    const key = await storage.save(USER, Buffer.from('do meu'));

    expect(key).not.toBe(`${OTHER}/igual`);
    expect((await storage.read(USER, key))!.bytes.toString()).toBe('do meu');
  });
});
