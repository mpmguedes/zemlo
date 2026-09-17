/**
 * Construtor de ZIP para os testes adversariais do leitor (§7.3, §13.4).
 *
 * ## Porque é que isto existe
 *
 * Os testes têm de produzir ZIPs **deliberadamente inválidos**: CRC trocado, arquivo
 * truncado, *central directory* mentiroso, offsets impossíveis, nomes com `..`. Nenhuma
 * biblioteca de compressão produz isso — é exatamente o que elas existem para impedir. A
 * única forma honesta de testar as recusas é escrever os bytes à mão.
 *
 * A alternativa — gerar ZIPs válidos e confiar que o leitor recusa o resto — não testaria
 * nada: um leitor permissivo passa nos casos válidos e nunca chega a ver um caso hostil.
 *
 * ## O que este ficheiro é e não é
 *
 * É um **construtor de bytes**, não um leitor. Escreve cabeçalhos locais, um *central
 * directory* e o EOCD, segundo o formato PKZIP, com a liberdade de os corromper de
 * propósito. Não valida o que constrói — validá-lo seria confundir o teste com o testado.
 *
 * Não é usado em produção e não é exportado por nenhum módulo de `src/`. Vive em `test/`
 * para que seja impossível importá-lo por engano no servidor.
 *
 * ## Números mágicos
 *
 * As assinaturas vivem em `src/domain/import/zip.ts` (`ZIP_SIGNATURES`) e são importadas
 * daí, não reescritas aqui: são parte do contrato que a implementação terá de cumprir, e
 * duplicá-las permitiria que os testes e a implementação divergissem sobre o que é um
 * cabeçalho local.
 */

import { deflateRawSync, crc32 as zlibCrc32 } from 'node:zlib';
import { ZIP_SIGNATURES } from '../../src/domain/import/zip.js';

/* ========================================================================== */
/* Utilitários binários                                                       */
/* ========================================================================== */

/** Concatena segmentos num único `Uint8Array`. */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

/** Escreve `value` em `bytes` como inteiro de 16 bits little-endian. */
export function writeU16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

/** Escreve `value` em `bytes` como inteiro de 32 bits little-endian. */
export function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

/** Lê um inteiro de 32 bits little-endian. Usado para reescrever campos cirurgicamente. */
export function readU32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

/** Codifica texto em UTF-8. */
export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * CRC-32 de um bloco de bytes.
 *
 * Usa o do `node:zlib`, para que os testes não tragam uma segunda implementação de CRC que
 * pudesse concordar com o construtor e discordar do leitor. O que se testa é o leitor.
 */
export function crc32(bytes: Uint8Array): number {
  return zlibCrc32(bytes) >>> 0;
}

/* ========================================================================== */
/* Descrição de uma entrada                                                   */
/* ========================================================================== */

export interface BuildEntry {
  /** Caminho como será escrito no arquivo — pode ser hostil de propósito. */
  name: string;
  /** Conteúdo descomprimido. */
  data: Uint8Array;
  /**
   * Método de compressão. `stored` (0) guarda os bytes tal como estão; `deflate` (8)
   * comprime. Por omissão: `deflate`, que é o que o Zemlo produzirá.
   */
  method?: 'stored' | 'deflate';
  /** CRC a declarar. Permite injetar um CRC errado. Por omissão: o correto. */
  crcOverride?: number;
  /** Tamanho descomprimido a declarar. Permite mentir nos metadados. */
  uncompressedSizeOverride?: number;
  /** Tamanho comprimido a declarar. Permite mentir nos metadados. */
  compressedSizeOverride?: number;
  /**
   * Bits de atributos externos a declarar no *central directory*.
   *
   * Os symlinks de Unix vivem aqui: o nibble alto codifica o tipo de ficheiro e
   * `0xa1ff0000` é um link simbólico com permissões `0777`.
   */
  externalAttributes?: number;
  /** Bytes comprimidos a escrever, substituindo os reais. Para dados corrompidos. */
  compressedDataOverride?: Uint8Array;
}

/** Uma entrada já codificada, pronta a entrar nos dois cabeçalhos. */
interface EncodedEntry {
  nameBytes: Uint8Array;
  compressedData: Uint8Array;
  crc: number;
  uncompressedSize: number;
  compressedSize: number;
  method: number;
  externalAttributes: number;
  /** Offset do cabeçalho local, preenchido ao montar. */
  localHeaderOffset: number;
}

/** Comprime (ou não) os dados de uma entrada e resolve os metadados declarados. */
function encodeEntry(entry: BuildEntry): EncodedEntry {
  const method = entry.method === 'stored' ? 0 : 8;
  const data = entry.data;
  const compressedData =
    entry.compressedDataOverride ??
    (method === 0 ? data : new Uint8Array(deflateRawSync(Buffer.from(data))));

  return {
    nameBytes: utf8(entry.name),
    compressedData,
    crc: entry.crcOverride ?? crc32(data),
    uncompressedSize: entry.uncompressedSizeOverride ?? data.byteLength,
    compressedSize: entry.compressedSizeOverride ?? compressedData.byteLength,
    method,
    externalAttributes: entry.externalAttributes ?? 0,
    localHeaderOffset: 0,
  };
}

/** Cabeçalho local de 30 bytes + nome. Devolve os bytes e o comprimento do nome. */
function buildLocalHeader(e: EncodedEntry): Uint8Array {
  const header = new Uint8Array(30 + e.nameBytes.byteLength);
  writeU32(header, 0, ZIP_SIGNATURES.localFileHeader);
  writeU16(header, 4, 20); // versão necessária
  writeU16(header, 6, 0x0800); // flag: nomes em UTF-8
  writeU16(header, 8, e.method);
  // Hora/data: valores fixos para os testes serem determinísticos.
  writeU16(header, 10, 0);
  writeU16(header, 12, 0x21); // 1980-01-01
  writeU32(header, 14, e.crc);
  writeU32(header, 18, e.compressedSize);
  writeU32(header, 22, e.uncompressedSize);
  writeU16(header, 26, e.nameBytes.byteLength);
  writeU16(header, 28, 0); // sem campo extra
  header.set(e.nameBytes, 30);
  return header;
}

/** Entrada do *central directory*: 46 bytes + nome. */
function buildCentralHeader(e: EncodedEntry): Uint8Array {
  const header = new Uint8Array(46 + e.nameBytes.byteLength);
  writeU32(header, 0, ZIP_SIGNATURES.centralFileHeader);
  writeU16(header, 4, 20); // versão do autor
  writeU16(header, 6, 20); // versão necessária
  writeU16(header, 8, 0x0800);
  writeU16(header, 10, e.method);
  writeU16(header, 12, 0);
  writeU16(header, 14, 0x21);
  writeU32(header, 16, e.crc);
  writeU32(header, 20, e.compressedSize);
  writeU32(header, 24, e.uncompressedSize);
  writeU16(header, 28, e.nameBytes.byteLength);
  writeU16(header, 30, 0); // extra
  writeU16(header, 32, 0); // comentário
  writeU16(header, 34, 0); // disco
  writeU16(header, 36, 0); // atributos internos
  writeU32(header, 38, e.externalAttributes);
  writeU32(header, 42, e.localHeaderOffset);
  header.set(e.nameBytes, 46);
  return header;
}

/* ========================================================================== */
/* Construção do arquivo                                                      */
/* ========================================================================== */

/**
 * Constrói um ZIP completo e bem formado, com as entradas dadas.
 *
 * Serve tanto para casos positivos como de ponto de partida para corrupções cirúrgicas —
 * quem quer um ZIP truncado constrói um válido e corta-o, o que produz exatamente o que um
 * download interrompido produz.
 */
export function buildZip(entries: readonly BuildEntry[]): Uint8Array {
  const encoded = entries.map(encodeEntry);

  const localParts: Uint8Array[] = [];
  let offset = 0;
  for (const e of encoded) {
    e.localHeaderOffset = offset;
    const header = buildLocalHeader(e);
    localParts.push(header, e.compressedData);
    offset += header.byteLength + e.compressedData.byteLength;
  }

  const localSection = concatBytes(...localParts);
  const centralParts = encoded.map(buildCentralHeader);
  const central = concatBytes(...centralParts);

  // EOCD: 22 bytes, sem comentário.
  const eocd = new Uint8Array(22);
  writeU32(eocd, 0, ZIP_SIGNATURES.endOfCentralDirectory);
  writeU16(eocd, 4, 0); // disco
  writeU16(eocd, 6, 0); // disco do central directory
  writeU16(eocd, 8, encoded.length);
  writeU16(eocd, 10, encoded.length);
  writeU32(eocd, 12, central.byteLength);
  writeU32(eocd, 16, localSection.byteLength); // offset do central directory
  writeU16(eocd, 20, 0); // sem comentário

  return concatBytes(localSection, central, eocd);
}

/**
 * Constrói um ZIP e devolve também as posições dos campos que os testes corrompem.
 *
 * Sem isto, um teste que quer trocar o CRC de uma entrada teria de recalcular offsets à
 * mão — exatamente o tipo de aritmética que introduz erros no teste em vez de encontrar
 * erros no código. O construtor sabe onde escreveu cada campo; mais vale dizê-lo.
 */
export interface BuiltZip {
  bytes: Uint8Array;
  /** Offset do primeiro byte do cabeçalho local de cada entrada, na ordem dada. */
  localOffsets: number[];
  /** Offset do início do *central directory*. */
  centralOffset: number;
  /** Offset do EOCD. */
  eocdOffset: number;
  /** Offset do campo de CRC de cada entrada no *central directory*. */
  centralCrcOffsets: number[];
  /** Offset do campo de tamanho comprimido de cada entrada no *central directory*. */
  centralCompressedSizeOffsets: number[];
  /** Offset do campo de offset-do-cabeçalho-local em cada entrada do central directory. */
  centralLocalOffsetOffsets: number[];
  /** Offset do campo de número de entradas no EOCD. */
  eocdEntryCountOffset: number;
  /** Offset do campo de offset-do-central-directory no EOCD. */
  eocdCentralOffsetFieldOffset: number;
}

/** Como `buildZip`, mas devolve um mapa dos campos para corrupção cirúrgica. */
export function buildZipWithOffsets(entries: readonly BuildEntry[]): BuiltZip {
  const encoded = entries.map(encodeEntry);

  const localParts: Uint8Array[] = [];
  const localOffsets: number[] = [];
  let offset = 0;
  for (const e of encoded) {
    localOffsets.push(offset);
    e.localHeaderOffset = offset;
    const header = buildLocalHeader(e);
    localParts.push(header, e.compressedData);
    offset += header.byteLength + e.compressedData.byteLength;
  }

  const localSection = concatBytes(...localParts);
  const centralOffset = localSection.byteLength;

  const centralCrcOffsets: number[] = [];
  const centralCompressedSizeOffsets: number[] = [];
  const centralLocalOffsetOffsets: number[] = [];
  const centralParts: Uint8Array[] = [];
  let centralCursor = centralOffset;
  for (const e of encoded) {
    centralCrcOffsets.push(centralCursor + 16);
    centralCompressedSizeOffsets.push(centralCursor + 20);
    centralLocalOffsetOffsets.push(centralCursor + 42);
    const header = buildCentralHeader(e);
    centralParts.push(header);
    centralCursor += header.byteLength;
  }
  const central = concatBytes(...centralParts);

  const eocdOffset = centralOffset + central.byteLength;
  const eocd = new Uint8Array(22);
  writeU32(eocd, 0, ZIP_SIGNATURES.endOfCentralDirectory);
  writeU16(eocd, 4, 0);
  writeU16(eocd, 6, 0);
  writeU16(eocd, 8, encoded.length);
  writeU16(eocd, 10, encoded.length);
  writeU32(eocd, 12, central.byteLength);
  writeU32(eocd, 16, centralOffset);
  writeU16(eocd, 20, 0);

  return {
    bytes: concatBytes(localSection, central, eocd),
    localOffsets,
    centralOffset,
    eocdOffset,
    centralCrcOffsets,
    centralCompressedSizeOffsets,
    centralLocalOffsetOffsets,
    eocdEntryCountOffset: eocdOffset + 10,
    eocdCentralOffsetFieldOffset: eocdOffset + 16,
  };
}

/* ========================================================================== */
/* Atalhos para os casos mais usados                                          */
/* ========================================================================== */

/** ZIP vazio válido: só o EOCD, sem entradas. */
export function buildEmptyZip(): Uint8Array {
  const eocd = new Uint8Array(22);
  writeU32(eocd, 0, ZIP_SIGNATURES.endOfCentralDirectory);
  writeU32(eocd, 12, 0);
  writeU32(eocd, 16, 0);
  return eocd;
}

/** ZIP com um único `manifest.json` válido. */
export function buildManifestZip(manifest: unknown = { format: 'zemlo-export' }): Uint8Array {
  return buildZip([{ name: 'manifest.json', data: utf8(JSON.stringify(manifest)) }]);
}

/** Conteúdo de texto repetido, para provocar rácios de compressão altos. */
export function highlyCompressible(bytes: number): Uint8Array {
  return new Uint8Array(bytes); // zeros comprimem a uma fracção minúscula
}

/**
 * Conteúdo que **não** comprime, para isolar os limites de tamanho do limite de rácio.
 *
 * Bytes pseudo-aleatórios com uma semente fixa: comprimem a ~1:1, o que faz do limite de
 * bytes descomprimidos a única defesa capaz de travar o caso. Sem isto, um teste que diz
 * verificar o limite de tamanho total estaria a ser travado pelo rácio de compressão — e
 * deixaria de testar o que afirma testar. Determinístico para o teste ser repetível.
 */
export function incompressible(bytes: number): Uint8Array {
  const out = new Uint8Array(bytes);
  let state = 0x2545f491;
  for (let i = 0; i < bytes; i += 1) {
    // Xorshift32: barato, determinístico e sem estrutura repetitiva que o deflate explore.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    out[i] = state & 0xff;
  }
  return out;
}
