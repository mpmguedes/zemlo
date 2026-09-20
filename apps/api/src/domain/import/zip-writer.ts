/**
 * Escritor de ZIP nativo do Zemlo (§5.1, §5.2).
 *
 * ## Porque é que o Zemlo escreve o seu próprio ZIP
 *
 * A §5.1 escolheu o ZIP como formato do bundle nativo por quatro razões — documentos
 * (base64 inflaciona 33 %), volume, integridade (um `sha256` por ficheiro) e inspecção pelo
 * utilizador. As três primeiras exigem controlo sobre o que é escrito; a quarta exige que o
 * resultado seja um ZIP comum, aberto por qualquer ferramenta.
 *
 * Uma biblioteca de compressão daria isso — e traria, com ela, a tentação de gerar o
 * arquivo **e** as regras do formato no mesmo sítio. Aqui, o formato é o contrato que o
 * leitor já implementa (`zip.ts`), e escrever o arquivo é o problema inverso simétrico:
 * o mesmo conhecimento, lido ao contrário. Este ficheiro é a metade que faltava.
 *
 * ## O que este ficheiro garante, e porquê
 *
 * O arquivo produzido tem de ser aceite por `readZip` **sem uma única alteração no leitor**.
 * Isso significa cumprir, um a um, todos os invariantes que o leitor verifica:
 *
 *  - assinatura de cabeçalho local no início (senão `zip.invalid_signature`);
 *  - *central directory* completo, com o EOCD imediatamente a seguir
 *    (`centralOffset + centralSize === eocd` — a invariante estrutural mais forte);
 *  - CRC, tamanho comprimido e tamanho descomprimido **iguais** no cabeçalho local e no
 *    índice: o leitor compara-os e recusa se discordarem;
 *  - o mesmo método de compressão nos dois cabeçalhos;
 *  - o mesmo nome nos dois cabeçalhos — é o ataque clássico que o leitor existe para travar,
 *    e o escritor tem de o não reproduzir;
 *  - flag 0x0800 (nomes em UTF-8) e **nunca** a flag 0x0008 (tamanhos em *data descriptor*),
 *    que o leitor recusa explicitamente;
 *  - caminhos normalizados, sem `..`, sem barras invertidas, sem caminhos absolutos: o mesmo
 *    `validateEntryPath` do leitor, aplicado do lado de quem escreve;
 *  - nada marcado como ligação simbólica nos atributos externos (nibble alto `0xa000`);
 *  - um só disco, sem ZIP64.
 *
 * ## Porque é que a validação do caminho é a do leitor e não uma cópia
 *
 * `validateEntryPath` é importada de `zip.ts`. Duplicá-la criaria duas definições de "caminho
 * seguro", e a primeira vez que as duas divergissem, o escritor produziria bundles que o
 * leitor recusa — ou, pior, bundles que passam os dois e que um deles considera perigosos.
 *
 * ## O que este ficheiro não é
 *
 * Não decide **o que** exportar. Que tipo de registo entra, que campos, que documentos, que
 * ficheiros CSV — isso é o formato do bundle (§5.2) e vive no construtor do bundle. Aqui
 * resolve-se apenas o transporte: entradas nomeadas com bytes, e um arquivo PKZIP válido.
 */

import { crc32 as zlibCrc32, deflateRawSync } from 'node:zlib';

import { ZIP_SIGNATURES, validateEntryPath } from './zip.js';

/* -------------------------------------------------------------------------- */
/* Contrato                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Uma entrada a escrever no arquivo.
 *
 * O nome é validado ao ser escrito; os bytes são copiados sem conversão. Não há campo para
 * "compressão" no contrato público: o método é uma decisão de transporte e não uma
 * propriedade do conteúdo, e deixá-la configurável convidaria o chamador a escolhê-la por
 * razões que não são de transporte.
 */
export interface ZipWriteEntry {
  /** Caminho dentro do arquivo, com `/` como separador. */
  readonly name: string;
  /** Conteúdo descomprimido. */
  readonly data: Uint8Array;
}

/** Opções de escrita. Por omissão, tudo o que a aplicação faz. */
export interface ZipWriteOptions {
  /**
   * Método de compressão.
   *
   * `deflate` é o que a §5.1 espera de um bundle: os `.jsonl` comprimem a uma fracção, e o
   * valor por omissão é o que serve o caso real. `stored` existe para que um teste possa
   * provar que o leitor aceita os dois métodos — e porque um documento já comprimido (um
   * JPEG, um PDF) não beneficia de o ser outra vez.
   */
  readonly method?: 'stored' | 'deflate';
}

/* -------------------------------------------------------------------------- */
/* Utilitários binários                                                        */
/* -------------------------------------------------------------------------- */

/** Concatena segmentos num único `Uint8Array`. */
function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/** Escreve um inteiro de 16 bits little-endian. */
function writeU16(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

/** Escreve um inteiro de 32 bits little-endian. */
function writeU32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

/** O CRC-32 do `zlib`, tratado como inteiro sem sinal (o `>>> 0` evita negativos). */
function crc32Of(data: Uint8Array): number {
  return zlibCrc32(data) >>> 0;
}

/* -------------------------------------------------------------------------- */
/* Limites do ZIP que escrevemos                                               */
/* -------------------------------------------------------------------------- */

/**
 * O valor máximo de um campo de 32 bits no formato ZIP.
 *
 * Acima disto, o formato exige ZIP64 — que o leitor do Zemlo recusa explicitamente. Escrever
 * um arquivo que o próprio leitor não aceita seria produzir uma exportação irrecuperável, e
 * é por isso que a recusa acontece **antes** de escrever, com um motivo legível.
 */
const MAX_U32 = 0xffff_ffff;

/** O valor máximo de um campo de 16 bits — o número de entradas e o tamanho de um nome. */
const MAX_U16 = 0xffff;

/**
 * Uma exportação que o formato ZIP não consegue representar.
 *
 * Distinto de um erro de programação: descreve uma exportação que é demasiado grande para o
 * formato, e a mensagem diz que o bundle tem de ser dividido. Não é um caso que a §5.7
 * contemple para esta versão, mas é a fronteira do formato e tem de ser dita em vez de
 * silenciosamente truncada.
 */
export class ZipWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipWriteError';
  }
}

/* -------------------------------------------------------------------------- */
/* Preparação de uma entrada                                                   */
/* -------------------------------------------------------------------------- */

interface PreparedEntry {
  readonly nameBytes: Uint8Array;
  readonly compressedData: Uint8Array;
  readonly crc: number;
  readonly uncompressedSize: number;
  readonly compressedSize: number;
  readonly method: number;
  /** Offset do cabeçalho local, preenchido ao montar o arquivo. */
  localHeaderOffset: number;
}

/**
 * Valida e codifica uma entrada.
 *
 * ## Porque é que a compressão acontece aqui e não ao montar
 *
 * O tamanho comprimido determina o offset do cabeçalho local seguinte, e os offsets do
 * índice. Comprimir tudo antes de escrever o primeiro byte torna os offsets uma soma
 * determinística em vez de uma conta que se vai corrigindo — e uma conta corrigida a meio é
 * como nascem os arquivos que só alguns leitores abrem.
 *
 * ## Porque é que uma entrada é recusada antes de ser comprimida
 *
 * Um nome que o leitor recusaria (com `..`, absoluto, com barras invertidas) produziria um
 * bundle que a própria aplicação não consegue importar. Recusar aqui — no lado de quem
 * escreve, com um diagnóstico claro — é preferível a escrever um ficheiro que só falha
 * quando o utilizador tenta reimportá-lo, meses depois.
 */
function prepareEntry(entry: ZipWriteEntry, method: 'stored' | 'deflate'): PreparedEntry {
  // A mesma validação que o leitor aplica. Lança com o motivo específico.
  const name = validateEntryPath(entry.name);

  const nameBytes = new TextEncoder().encode(name);
  if (nameBytes.byteLength > MAX_U16) {
    throw new ZipWriteError(`O caminho «${name}» é longo demais para o formato ZIP.`);
  }

  const data = entry.data;
  if (data.byteLength > MAX_U32) {
    throw new ZipWriteError(`O ficheiro «${name}» excede o tamanho representável no formato ZIP.`);
  }

  const compressedData =
    method === 'stored' ? data : new Uint8Array(deflateRawSync(Buffer.from(data)));

  if (compressedData.byteLength > MAX_U32) {
    throw new ZipWriteError(`O ficheiro «${name}» comprime para um tamanho não representável.`);
  }

  return {
    nameBytes,
    compressedData,
    crc: crc32Of(data),
    uncompressedSize: data.byteLength,
    compressedSize: compressedData.byteLength,
    method: method === 'stored' ? 0 : 8,
    localHeaderOffset: 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Cabeçalhos                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Cabeçalho local: 30 bytes fixos + nome, sem campo extra.
 *
 * A hora e a data são fixas (`0x0000` e `0x21`, ou seja 1980-01-01). Não é preguiça: uma
 * data escolhida tornaria o arquivo diferente em cada execução, e a §13.3 compara bundles.
 * O leitor aceita ambos os extremos, e um valor fixo é o único que torna dois bundles do
 * mesmo conteúdo iguais.
 */
function buildLocalHeader(entry: PreparedEntry): Uint8Array {
  const header = new Uint8Array(30 + entry.nameBytes.byteLength);
  writeU32(header, 0, ZIP_SIGNATURES.localFileHeader);
  writeU16(header, 4, 20); // versão necessária: 2.0 (deflate)
  writeU16(header, 6, 0x0800); // flag: nomes em UTF-8. Nunca 0x0008 (data descriptor).
  writeU16(header, 8, entry.method);
  writeU16(header, 10, 0); // hora
  writeU16(header, 12, 0x21); // data: 1980-01-01
  writeU32(header, 14, entry.crc);
  writeU32(header, 18, entry.compressedSize);
  writeU32(header, 22, entry.uncompressedSize);
  writeU16(header, 26, entry.nameBytes.byteLength);
  writeU16(header, 28, 0); // sem campo extra
  header.set(entry.nameBytes, 30);
  return header;
}

/**
 * Entrada do *central directory*: 46 bytes fixos + nome, sem campo extra nem comentário.
 *
 * Os atributos externos ficam a zero. O nibble alto é o tipo de ficheiro em ZIP de Unix: um
 * valor com `0xa000` marcaria a entrada como ligação simbólica, e o leitor recusa ligações
 * simbólicas. Zero é "ficheiro normal" e é o que queremos declarar.
 */
function buildCentralHeader(entry: PreparedEntry): Uint8Array {
  const header = new Uint8Array(46 + entry.nameBytes.byteLength);
  writeU32(header, 0, ZIP_SIGNATURES.centralFileHeader);
  writeU16(header, 4, 20); // versão do autor
  writeU16(header, 6, 20); // versão necessária
  writeU16(header, 8, 0x0800); // flag: nomes em UTF-8
  writeU16(header, 10, entry.method);
  writeU16(header, 12, 0); // hora
  writeU16(header, 14, 0x21); // data
  writeU32(header, 16, entry.crc);
  writeU32(header, 20, entry.compressedSize);
  writeU32(header, 24, entry.uncompressedSize);
  writeU16(header, 28, entry.nameBytes.byteLength);
  writeU16(header, 30, 0); // campo extra
  writeU16(header, 32, 0); // comentário
  writeU16(header, 34, 0); // disco inicial
  writeU16(header, 36, 0); // atributos internos
  writeU32(header, 38, 0); // atributos externos: ficheiro normal
  writeU32(header, 42, entry.localHeaderOffset);
  header.set(entry.nameBytes, 46);
  return header;
}

/* -------------------------------------------------------------------------- */
/* Escrita                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Escreve um ZIP válido e legível pelo leitor do Zemlo.
 *
 * ## A ordem das partes
 *
 * Os cabeçalhos locais e os dados vêm primeiro, seguidos do índice e do EOCD. É a ordem que
 * o formato exige — o índice aponta para trás — e é também a que mantém o offset de cada
 * cabeçalho local uma soma simples: `offset += 30 + nome + dados`.
 *
 * ## Porque é que um arquivo sem entradas é recusado
 *
 * O leitor recusa um ZIP vazio (`zip.empty_archive`). Escrevê-lo seria produzir um ficheiro
 * que a aplicação não aceita. Uma exportação sem dados tem um bundle válido com os ficheiros
 * de cabeçalho (`manifest.json`, `README.txt`), pelo que "zero entradas" não é um caso real
 * de exportação — é um erro de quem chamou, e é melhor dizê-lo.
 */
export function writeZip(
  entries: readonly ZipWriteEntry[],
  options?: ZipWriteOptions,
): Uint8Array {
  const method = options?.method ?? 'deflate';

  if (entries.length === 0) {
    throw new ZipWriteError('Um arquivo sem entradas não é um bundle válido.');
  }
  if (entries.length > MAX_U16) {
    throw new ZipWriteError(
      `Esta exportação tem ${entries.length} ficheiros e o formato ZIP não representa tantos sem ZIP64.`,
    );
  }

  /*
   * Nomes repetidos são recusados **antes** de escrever. Dois ficheiros com o mesmo nome
   * produziriam um arquivo em que o segundo substitui o primeiro na extracção — e o
   * utilizador perderia um documento sem que nada o dissesse. O leitor recusa duplicados
   * (`zip.duplicate_entry`); o escritor não os deve gerar.
   */
  const seen = new Set<string>();
  for (const entry of entries) {
    const name = validateEntryPath(entry.name);
    if (seen.has(name)) {
      throw new ZipWriteError(`O bundle teria dois ficheiros com o mesmo nome: ${name}.`);
    }
    seen.add(name);
  }

  const prepared = entries.map((entry) => prepareEntry(entry, method));

  /* ---- Cabeçalhos locais + dados ---- */

  const parts: Uint8Array[] = [];
  let offset = 0;
  for (const entry of prepared) {
    entry.localHeaderOffset = offset;
    const header = buildLocalHeader(entry);
    parts.push(header, entry.compressedData);
    offset += header.byteLength + entry.compressedData.byteLength;
  }

  const centralOffset = offset;

  /* ---- Índice ---- */

  for (const entry of prepared) {
    const header = buildCentralHeader(entry);
    parts.push(header);
    offset += header.byteLength;
  }

  const centralSize = offset - centralOffset;

  /* ---- EOCD ---- */

  const eocd = new Uint8Array(22);
  writeU32(eocd, 0, ZIP_SIGNATURES.endOfCentralDirectory);
  writeU16(eocd, 4, 0); // número do disco
  writeU16(eocd, 6, 0); // disco do início do índice
  writeU16(eocd, 8, prepared.length); // entradas neste disco
  writeU16(eocd, 10, prepared.length); // entradas no total
  writeU32(eocd, 12, centralSize);
  writeU32(eocd, 16, centralOffset);
  writeU16(eocd, 20, 0); // sem comentário
  parts.push(eocd);

  return concat(parts);
}
