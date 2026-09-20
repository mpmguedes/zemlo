/**
 * Escritor de ZIP nativo (§5.1, §13.2).
 *
 * ## O que é que estes testes provam
 *
 * A §13.2 exige uma volta completa: exportar → importar → exportar, e comparar as duas
 * pontas. O escritor é a primeira metade dessa volta, e a propriedade que interessa não é
 * "escreve um ZIP" — é **"escreve um ZIP que o leitor existente aceita, e cujo conteúdo
 * volta a sair byte a byte"**.
 *
 * Por isso os testes não inspeccionam os bytes do arquivo à procura de assinaturas. Fazem
 * o que o produto faz: `writeZip` seguido de `readZip`, e comparam o que entrou com o que
 * saiu. Um arquivo estruturalmente "correto" mas incompatível com o leitor reprova aqui, que
 * é exatamente o que se quer.
 *
 * As verificações estruturais existem, mas como **complemento**: quando um teste de volta
 * completa falha, é útil saber que a causa foi o EOCD e não os dados. Servem para
 * diagnóstico, não como prova — a prova é a volta completa.
 */

import { crc32 as zlibCrc32, deflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { ZIP_SIGNATURES, readZip } from '../src/domain/import/zip.js';
import { ZipWriteError, writeZip, type ZipWriteEntry } from '../src/domain/import/zip-writer.js';

/* -------------------------------------------------------------------------- */
/* Utilitários                                                                 */
/* -------------------------------------------------------------------------- */

const encoder = new TextEncoder();

function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

/** Bytes que não são texto e não comprimem — um documento real (PDF, JPEG). */
function binaryBytes(seed: number, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
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

/** Lê um inteiro de 16 bits little-endian. Usado na análise estrutural. */
function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

/** Lê um inteiro de 32 bits little-endian. */
function readU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

/**
 * Lê as entradas de um arquivo e devolve-as como um mapa nome → bytes.
 *
 * Faz a leitura com o leitor de produção em vez de reimplementar a extracção: um utilitário
 * de teste que soubesse ler ZIPs seria uma segunda implementação do formato, e poderia
 * concordar com o escritor e discordar do produto.
 */
function roundTrip(entries: readonly ZipWriteEntry[]): Map<string, Uint8Array> {
  const zip = writeZip(entries);
  const result = readZip(zip);
  return new Map(result.entries.map((entry) => [entry.name, entry.data]));
}

/* ========================================================================== */
/* Volta completa pelo leitor de produção                                     */
/* ========================================================================== */

describe('o arquivo escrito é lido pelo leitor de produção', () => {
  it('preserva cada entrada byte a byte', () => {
    const entries: ZipWriteEntry[] = [
      { name: 'manifest.json', data: utf8('{"format":"zemlo-export","formatVersion":1}') },
      { name: 'vehicles.jsonl', data: utf8('{"localId":"veh_1","plate":"AA-00-BB"}\n') },
      { name: 'README.txt', data: utf8('Bundle Zemlo.\n'.repeat(20)) },
    ];

    const read = roundTrip(entries);

    expect([...read.keys()]).toEqual(['manifest.json', 'vehicles.jsonl', 'README.txt']);
    for (const entry of entries) {
      expect(read.get(entry.name)).toEqual(entry.data);
    }
  });

  it('preserva um documento binário grande, sem conversão', () => {
    /*
     * O caso que a §5.6 descreve: bytes copiados "sem conversão, sem recompressão". Um
     * documento de 200 kB de bytes pseudo-aleatórios é o pior caso para um pipeline de
     * texto e o melhor para provar que a cópia é fiel.
     */
    const pdf = binaryBytes(0xbeef, 200_000);
    const read = roundTrip([{ name: 'documents/doc_1/factura.pdf', data: pdf }]);

    expect(read.get('documents/doc_1/factura.pdf')!.byteLength).toBe(pdf.byteLength);
    expect(Buffer.from(read.get('documents/doc_1/factura.pdf')!)).toEqual(Buffer.from(pdf));
  });

  it('preserva um ficheiro vazio', () => {
    // Um ficheiro de zero bytes é um ficheiro válido. O formato permite-o, e o leitor
    // (que compara tamanho descomprimido com comprimido em `stored`) tem de concordar.
    const read = roundTrip([{ name: 'csv/vazio.csv', data: new Uint8Array(0) }]);

    expect(read.get('csv/vazio.csv')!.byteLength).toBe(0);
  });

  it('preserva nomes com acentos e espaços, em UTF-8', () => {
    // O bundle inclui ficheiros com nomes vindos do utilizador: "Faturação 2026.pdf". A
    // flag 0x0800 tem de estar posta, ou o leitor decodifica o nome como CP437 e não o
    // reconhece como caminho válido.
    const entries: ZipWriteEntry[] = [
      { name: 'documents/doc_1/Faturação 2026.pdf', data: utf8('conteúdo') },
      { name: 'documents/doc_2/Ação de inspeção.txt', data: utf8('outro') },
    ];

    const read = roundTrip(entries);

    expect([...read.keys()]).toEqual([
      'documents/doc_1/Faturação 2026.pdf',
      'documents/doc_2/Ação de inspeção.txt',
    ]);
  });

  it('preserva muitas entradas e mantém a ordem', () => {
    // A ordem importa: o leitor percorre os ficheiros pela ordem do manifest, e um
    // escritor que os reordenasse produziria bundles cuja leitura não corresponde ao que
    // foi escrito — mesmo que o conjunto seja o mesmo.
    const entries: ZipWriteEntry[] = Array.from({ length: 200 }, (_, index) => ({
      name: `documents/doc_${index}/ficheiro.bin`,
      data: binaryBytes(index + 1, 64 + index),
    }));

    const read = roundTrip(entries);

    expect([...read.keys()]).toEqual(entries.map((entry) => entry.name));
    for (const entry of entries) {
      expect(read.get(entry.name)).toEqual(entry.data);
    }
  });

  it('aceita `stored` e `deflate`, e ambos devolvem os mesmos bytes', () => {
    const data = utf8('conteúdo que comprime bem. '.repeat(200));

    for (const method of ['stored', 'deflate'] as const) {
      const zip = writeZip([{ name: 'a.jsonl', data }], { method });
      const result = readZip(zip);
      expect(result.entries[0]!.data).toEqual(data);
      // O método declarado tem de ser o pedido — é o que distingue os dois caminhos.
      expect(result.entries[0]!.compressed).toBe(method === 'deflate');
    }
  });

  it('comprime de facto: o arquivo é mais pequeno do que o conteúdo', () => {
    // A §5.1 escolheu o ZIP por causa do volume. Sem compressão real, a escolha não se
    // cumpriria — e um teste que só verificasse a volta completa não o notaria.
    const data = utf8('{"localId":"evt_1","type":"fuel","amountCents":4500}\n'.repeat(500));

    const zip = writeZip([{ name: 'events.jsonl', data }]);
    const stored = writeZip([{ name: 'events.jsonl', data }], { method: 'stored' });

    expect(zip.byteLength).toBeLessThan(data.byteLength);
    expect(zip.byteLength).toBeLessThan(stored.byteLength);
  });
});

/* ========================================================================== */
/* Estrutura do arquivo                                                       */
/* ========================================================================== */

describe('estrutura do arquivo', () => {
  it('começa com a assinatura de cabeçalho local', () => {
    const zip = writeZip([{ name: 'a.txt', data: utf8('a') }]);

    // A primeira verificação do leitor. Uma assinatura errada aqui produziria
    // `zip.invalid_signature` e a mensagem "não é um ZIP".
    expect(readU32(zip, 0)).toBe(ZIP_SIGNATURES.localFileHeader);
  });

  it('termina com o EOCD, e o índice fecha exactamente no EOCD', () => {
    const zip = writeZip([
      { name: 'a.txt', data: utf8('aaa') },
      { name: 'b.txt', data: utf8('bbb') },
    ]);

    const eocd = zip.byteLength - 22;
    expect(readU32(zip, eocd)).toBe(ZIP_SIGNATURES.endOfCentralDirectory);

    const centralSize = readU32(zip, eocd + 12);
    const centralOffset = readU32(zip, eocd + 16);

    // A invariante estrutural mais forte do formato, e a que o leitor verifica primeiro:
    // "o índice tem de terminar exatamente onde começa o EOCD".
    expect(centralOffset + centralSize).toBe(eocd);
  });

  it('declara o mesmo número de entradas nos dois campos do EOCD', () => {
    const zip = writeZip([
      { name: 'a.txt', data: utf8('a') },
      { name: 'b.txt', data: utf8('b') },
      { name: 'c.txt', data: utf8('c') },
    ]);
    const eocd = zip.byteLength - 22;

    // O leitor recusa quando os dois discordam (`zip.invalid_central_directory`).
    expect(readU16(zip, eocd + 8)).toBe(3);
    expect(readU16(zip, eocd + 10)).toBe(3);
  });

  it('não declara discos múltiplos nem ZIP64', () => {
    const zip = writeZip([{ name: 'a.txt', data: utf8('a') }]);
    const eocd = zip.byteLength - 22;

    expect(readU16(zip, eocd + 4)).toBe(0); // número do disco
    expect(readU16(zip, eocd + 6)).toBe(0); // disco do índice
    // ZIP64 num ZIP de tamanho normal seria lido como offsets truncados — o leitor recusa.
    expect(readU16(zip, eocd + 10)).not.toBe(0xffff);
  });

  it('escreve o mesmo nome no cabeçalho local e no índice', () => {
    /*
     * O ataque clássico: uma biblioteca valida o nome no índice (que lê primeiro) e extrai
     * o do cabeçalho local (que é outro). O leitor compara os dois e recusa se discordarem.
     * Um escritor que escrevesse nomes diferentes estaria a reproduzir o ataque.
     */
    const zip = writeZip([{ name: 'documents/doc_1/a.pdf', data: utf8('x') }]);

    // Cabeçalho local: nome a partir do offset 30.
    const localNameLength = readU16(zip, 26);
    const localName = new TextDecoder().decode(zip.subarray(30, 30 + localNameLength));

    // Índice: começa após o cabeçalho local (30 + nome) + dados.
    const centralOffset = readU32(zip, zip.byteLength - 22 + 16);
    const centralNameLength = readU16(zip, centralOffset + 28);
    const centralName = new TextDecoder().decode(
      zip.subarray(centralOffset + 46, centralOffset + 46 + centralNameLength),
    );

    expect(localName).toBe('documents/doc_1/a.pdf');
    expect(centralName).toBe(localName);
  });

  it('põe a flag UTF-8 e nunca a flag de data descriptor', () => {
    const zip = writeZip([{ name: 'a.txt', data: utf8('a') }]);

    const localFlags = readU16(zip, 6);
    expect(localFlags & 0x0800).toBe(0x0800);
    // A flag 0x0008 faz o leitor recusar (`zip.invalid_local_header`): os tamanhos viveriam
    // num *data descriptor* e os campos do cabeçalho estariam a zero.
    expect(localFlags & 0x0008).toBe(0);
  });

  it('não marca nenhuma entrada como ligação simbólica', () => {
    const zip = writeZip([{ name: 'a.txt', data: utf8('a') }]);
    const centralOffset = readU32(zip, zip.byteLength - 22 + 16);
    const externalAttributes = readU32(zip, centralOffset + 38);

    // O nibble alto codifica o tipo de ficheiro em ZIP de Unix; `0xa000` é um symlink e o
    // leitor recusa-o explicitamente (§7.3).
    expect((externalAttributes >>> 16) & 0xf000).not.toBe(0xa000);
  });

  it('escreve o CRC correto, verificável independentemente', () => {
    const data = utf8('conteúdo com CRC conhecido');
    const zip = writeZip([{ name: 'a.txt', data }]);

    // O CRC no cabeçalho local, comparado com o do zlib calculado aqui. O leitor verifica-o
    // na extracção; calculá-lo de novo prova que o valor escrito é o certo.
    expect(readU32(zip, 14)).toBe(zlibCrc32(data) >>> 0);
  });

  it('declara tamanhos coerentes entre o cabeçalho local e os dados reais', () => {
    const data = utf8('x'.repeat(1000));
    const zip = writeZip([{ name: 'a.txt', data }], { method: 'stored' });
    const expectedCompressed = deflateRawSync(Buffer.from(data)).byteLength;

    expect(readU32(zip, 18)).toBe(data.byteLength); // comprimido (stored = igual)
    expect(readU32(zip, 22)).toBe(data.byteLength); // descomprimido
    // E o método declarado é `stored`.
    expect(readU16(zip, 8)).toBe(0);
    expect(expectedCompressed).toBeLessThan(data.byteLength); // a compressão seria eficaz
  });
});

/* ========================================================================== */
/* Recusas do escritor                                                        */
/* ========================================================================== */

describe('o escritor recusa o que o leitor recusaria', () => {
  /*
   * A regra: o escritor não deve produzir um arquivo que a própria aplicação não consegue
   * importar. Cada caso aqui corresponde a uma recusa do leitor — e a um arquivo que, se
   * fosse escrito, seria irrecuperável pela aplicação que o gerou.
   *
   * A recusa vem do `validateEntryPath` do leitor, pelo que o **tipo** do erro é
   * `ZipRefusalError` e deixa passar o motivo específico. Isso é deliberado: um escritor
   * que traduzisse a recusa numa mensagem própria perderia o diagnóstico que o leitor já
   * produziu — e o utilizador veria "não foi possível exportar" em vez de "este documento
   * tem um caminho que sairia da pasta de destino".
   */
  const caminhosPerigosos = [
    ['travessia de directórios', 'documents/../../etc/passwd'],
    ['travessia na raiz', '../../etc/passwd'],
    ['travessia depois de um segmento neutro', 'a/../../b'],
    ['caminho absoluto', '/etc/passwd'],
    ['caminho absoluto com letra de unidade', 'C:\\Windows\\win.ini'],
    ['caminho UNC', '\\\\servidor\\partilha'],
    ['separador Windows', 'documents\\doc_1\\a.pdf'],
    ['caminho que não designa ficheiro', 'documents/..'],
  ] as const;

  for (const [nome, caminho] of caminhosPerigosos) {
    it(`recusa ${nome}`, () => {
      expect(() => writeZip([{ name: caminho, data: utf8('x') }])).toThrow();
    });
  }

  it('aceita caminhos que apenas normalizam, sem sair da raiz', () => {
    /*
     * A distinção é a fronteira que decide o que é perigoso, e é fácil de confundir:
     *
     *  - `documents/../../etc/passwd` **sai** da raiz (dois `..` depois de um só segmento) —
     *    recusado;
     *  - `documents/doc_1/../../evil.txt` **não sai**: o primeiro `..` desfaz `doc_1` e o
     *    segundo desfaz `documents`, e o resultado é `evil.txt`, que está dentro da raiz.
     *    É um caminho estranho, mas não é uma travessia — não há nada a proteger aqui, e
     *    recusá-lo tornaria o escritor mais restritivo do que o leitor sem motivo;
     *  - `documents/./a.pdf` e `documents//a.pdf` normalizam para `documents/a.pdf`.
     *
     * O escritor não acrescenta regras próprias: usa o mesmo `validateEntryPath` do leitor,
     * pelo que os dois concordam sempre sobre onde está a fronteira.
     */
    const zip = writeZip([
      { name: 'documents/./doc_1/a.pdf', data: utf8('x') },
      { name: 'evil.txt', data: utf8('y') },
    ]);
    const result = readZip(zip);

    expect(result.entries.map((entry) => entry.name)).toEqual([
      'documents/doc_1/a.pdf',
      'evil.txt',
    ]);
  });

  it('o caminho `documents/doc_1/../../evil.txt` é equivalente a `evil.txt`', () => {
    // A prova da afirmação acima, sobre o próprio validador: as duas grafias produzem o
    // mesmo nome, pelo que o escritor as considera duplicadas em vez de as recusar como
    // travessia.
    expect(() =>
      writeZip([
        { name: 'documents/doc_1/../../evil.txt', data: utf8('a') },
        { name: 'evil.txt', data: utf8('b') },
      ]),
    ).toThrow(ZipWriteError);
  });

  it('recusa nomes duplicados, em vez de perder um ficheiro silenciosamente', () => {
    // Dois ficheiros com o mesmo nome: na extracção o segundo substitui o primeiro, e o
    // utilizador perderia um documento sem nada o dizer. O leitor recusa duplicados.
    expect(() =>
      writeZip([
        { name: 'documents/doc_1/a.pdf', data: utf8('primeiro') },
        { name: 'documents/doc_1/a.pdf', data: utf8('segundo') },
      ]),
    ).toThrow(ZipWriteError);
  });

  it('recusa um arquivo sem entradas', () => {
    // O leitor recusa um ZIP vazio (`zip.empty_archive`). Um bundle válido tem sempre
    // `manifest.json`, pelo que zero entradas é um erro de quem chamou.
    expect(() => writeZip([])).toThrow(ZipWriteError);
  });

  it('a mensagem de recusa diz o que está mal, não apenas que falhou', () => {
    // Uma recusa sem diagnóstico obriga quem integra a adivinhar. O `validateEntryPath`
    // produz mensagens específicas, e o escritor não as deve substituir por uma genérica.
    expect(() => writeZip([{ name: '../x', data: utf8('x') }])).toThrow(/pasta de destino/i);
    expect(() => writeZip([{ name: '/etc/passwd', data: utf8('x') }])).toThrow(/absoluto/i);
  });

  it('duplicados são detectados depois da normalização, não antes', () => {
    // `documents//doc_1/a.pdf` normaliza para `documents/doc_1/a.pdf`. Se a detecção fosse
    // feita sobre os nomes crus, os dois passariam e colidiriam no destino.
    expect(() =>
      writeZip([
        { name: 'documents/doc_1/a.pdf', data: utf8('primeiro') },
        { name: 'documents//doc_1/a.pdf', data: utf8('segundo') },
      ]),
    ).toThrow(ZipWriteError);
  });
});

/* ========================================================================== */
/* Um bundle real                                                             */
/* ========================================================================== */

describe('bundle completo', () => {
  /*
   * A forma da §5.2, com as partes que importam ao transporte: o manifest, os `.jsonl`, o
   * README e os bytes dos documentos. Não é o construtor do bundle — é a prova de que a
   * estrutura que ele produz sobrevive ao arquivo.
   */
  it('preserva a estrutura de pastas e o conteúdo de um bundle', () => {
    const pdfA = binaryBytes(1, 4096);
    const jpgB = binaryBytes(2, 2048);

    const entries: ZipWriteEntry[] = [
      { name: 'manifest.json', data: utf8(JSON.stringify({ format: 'zemlo-export' })) },
      { name: 'account.json', data: utf8('{"currency":"EUR"}') },
      { name: 'vehicles.jsonl', data: utf8('{"localId":"veh_1","plate":"AA-00-BB"}\n') },
      { name: 'documents.jsonl', data: utf8('{"localId":"doc_1","name":"Seguro"}\n') },
      { name: 'README.txt', data: utf8('Este bundle contém os teus dados.\n') },
      { name: 'csv/vehicles.csv', data: utf8('matricula;marca\nAA-00-BB;Renault\n') },
      { name: 'documents/doc_1/seguro.pdf', data: pdfA },
      { name: 'documents/doc_2/livro.jpg', data: jpgB },
    ];

    const read = roundTrip(entries);

    expect([...read.keys()]).toEqual(entries.map((entry) => entry.name));
    // E o conteúdo de cada um — com atenção aos binários, que é onde uma conversão se
    // notaria.
    expect(read.get('documents/doc_1/seguro.pdf')).toEqual(pdfA);
    expect(read.get('documents/doc_2/livro.jpg')).toEqual(jpgB);
    expect(read.get('manifest.json')).toEqual(entries[0]!.data);
  });

  it('o mesmo conteúdo produz o mesmo arquivo, byte a byte', () => {
    /*
     * Determinismo: sem ele, a §13.3 ("um bundle exportado de um resultado de importação é
     * equivalente ao original") seria verdadeira apenas ao nível dos dados, e qualquer
     * comparação de ficheiros — ou de `sha256` de bundle — falharia sem haver diferença
     * real. A data fixa nos cabeçalhos é o que torna isto possível.
     */
    const entries: ZipWriteEntry[] = [
      { name: 'manifest.json', data: utf8('{"a":1}') },
      { name: 'vehicles.jsonl', data: utf8('{"localId":"veh_1"}\n') },
      { name: 'documents/doc_1/a.pdf', data: binaryBytes(7, 300) },
    ];

    const first = writeZip(entries);
    const second = writeZip(entries);

    expect(first.byteLength).toBe(second.byteLength);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });
});
