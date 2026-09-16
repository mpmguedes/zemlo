/**
 * Codificador de QR versão 1–10, em modo byte, com correção de erros Reed–Solomon.
 *
 * Porque é que isto existe: a configuração da verificação em dois passos (POST
 * `/me/2fa/setup`) devolve um `otpauthUri` que o utilizador tem de introduzir numa app
 * autenticadora. Introduzir um segredo base32 de 32 caracteres à mão é possível, mas é
 * exatamente o tipo de erro invisível — um `0` trocado por um `O` — que produz códigos que
 * nunca funcionam e uma conclusão errada: "o Zemlo está avariado".
 *
 * A aplicação não pode acrescentar dependências, portanto o codificador é escrito aqui.
 * Não é uma aproximação: implementa a especificação **ISO/IEC 18004**:
 *
 *   - modo byte (8 bits por carácter), que cobre qualquer `otpauth://` em UTF-8;
 *   - escolha automática da versão (1 a 10), pela primeira que comporta os dados;
 *   - correção de erros por blocos, com intercalação, nos níveis L, M, Q e H;
 *   - padrões de localização, temporização, alinhamento e as informações de formato e de
 *     versão;
 *   - máscara escolhida pelas quatro regras de penalização da norma, em vez de uma máscara
 *     fixa — uma máscara mal escolhida produz um código que os leitores têm dificuldade em
 *     encontrar, sobretudo impresso em papel térmico.
 *
 * O que **não** implementa: versões 11–40 (não são necessárias — um URI `otpauth://` tem
 * menos de 200 caracteres e cabe na versão 10 com nível L, que comporta 271 bytes), modo
 * numérico/alfanumérico/kanji e a estrutura ECI. As tabelas de capacidade e de blocos
 * estão limitadas a 10 versões de propósito: uma tabela copiada a metade sem se notar seria
 * um defeito silencioso, e aqui o limite é explícito.
 */

/* -------------------------------------------------------------------------- */
/* Aritmética de Galois (GF(256))                                              */
/* -------------------------------------------------------------------------- */

/**
 * A exponenciação em GF(256) com o polinómio primitivo 0x11D é feita por tabelas, e não por
 * multiplicação a cada passo: o codificador calcula 17 polinómios geradores e divide
 * centenas de polinómios por eles, pelo que a multiplicação é o ciclo mais quente.
 */
const EXP_TABLE = new Uint8Array(512);
const LOG_TABLE = new Uint8Array(256);

(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP_TABLE[i] = x;
    LOG_TABLE[x] = i;
    // Multiplicar por 2 em GF(256) é deslocar um bit e reduzir pelo polinómio primitivo
    // quando o bit de peso 8 transborda.
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP_TABLE[i] = EXP_TABLE[i - 255] as number;
})();

function gfMultiply(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP_TABLE[(LOG_TABLE[a] as number) + (LOG_TABLE[b] as number)] as number;
}

/** Polinómio gerador de grau `degree`, em coeficientes de maior para menor grau. */
function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] = (next[j] as number) ^ (poly[j] as number);
      next[j + 1] = (next[j + 1] as number) ^ gfMultiply(poly[j] as number, EXP_TABLE[i] as number);
    }
    poly = next;
  }
  return poly;
}

/**
 * Códigos de correção de erros de um bloco de dados.
 *
 * Divisão polinomial: o resto da divisão do bloco (com `degree` zeros acrescentados) pelo
 * polinómio gerador é exatamente a palavra de paridade que o leitor usa para reconstruir
 * módulos danificados.
 */
export function rsRemainder(data: readonly number[], degree: number): number[] {
  const generator = rsGenerator(degree);
  const remainder = new Array<number>(degree).fill(0);

  for (const byte of data) {
    const factor = byte ^ (remainder[0] as number);
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < degree; i += 1) {
      remainder[i] = (remainder[i] as number) ^ gfMultiply(generator[i + 1] as number, factor);
    }
  }

  return remainder;
}

/* -------------------------------------------------------------------------- */
/* Tabelas da norma (versões 1–10)                                             */
/* -------------------------------------------------------------------------- */

/**
 * Blocos de correção por versão e nível.
 *
 * Cada entrada é `[número de blocos do grupo 1, dados do grupo 1, número de blocos do
 * grupo 2, dados do grupo 2]`. O nível é `index = errorLevelIndex * 10 + (versão - 1)`,
 * com a ordem L, M, Q, H — a ordem usada pela norma nas suas tabelas.
 */
const BLOCK_TABLE: Record<number, readonly number[]> = {
  // L
  1: [1, 19, 0, 0], 2: [1, 34, 0, 0], 3: [1, 55, 0, 0], 4: [1, 80, 0, 0], 5: [1, 108, 0, 0],
  6: [2, 68, 0, 0], 7: [2, 78, 0, 0], 8: [2, 97, 0, 0], 9: [2, 116, 0, 0], 10: [2, 68, 2, 69],
  // M
  11: [1, 16, 0, 0], 12: [1, 28, 0, 0], 13: [1, 44, 0, 0], 14: [2, 32, 0, 0], 15: [2, 43, 0, 0],
  16: [4, 27, 0, 0], 17: [4, 31, 0, 0], 18: [2, 38, 2, 39], 19: [3, 36, 2, 37], 20: [4, 43, 1, 44],
  // Q
  21: [1, 13, 0, 0], 22: [1, 22, 0, 0], 23: [2, 17, 0, 0], 24: [2, 24, 0, 0], 25: [2, 15, 2, 16],
  26: [4, 19, 0, 0], 27: [2, 14, 4, 15], 28: [4, 18, 2, 19], 29: [4, 16, 4, 17], 30: [6, 19, 2, 20],
  // H
  31: [1, 9, 0, 0], 32: [1, 16, 0, 0], 33: [2, 13, 0, 0], 34: [4, 9, 0, 0], 35: [2, 11, 2, 12],
  36: [4, 15, 0, 0], 37: [4, 13, 1, 14], 38: [4, 14, 2, 15], 39: [4, 12, 4, 13], 40: [6, 15, 2, 16],
};

/**
 * Total de palavras-código (dados + correção) por versão.
 *
 * Não é usada no cálculo — a soma das palavras de dados e de correção por bloco dá o mesmo
 * valor —, mas fica declarada como referência: é a coluna que se consulta quando um bloco
 * parece não caber, e mantê-la aqui evita ir procurá-la à norma.
 */
const TOTAL_CODEWORDS_BY_VERSION: readonly number[] = [
  0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346,
];

/** Verificação de coerência entre a tabela acima e as tabelas de blocos. */
function assertCodewordTotals(): void {
  for (let version = 1; version <= 10; version += 1) {
    for (const level of ['L', 'M', 'Q', 'H'] as const) {
      const layout = layoutFor(version, level);
      const total = layout.totalBlocks * layout.eccPerBlock
        + layout.group1Blocks * layout.group1Data
        + layout.group2Blocks * layout.group2Data;
      const expected = TOTAL_CODEWORDS_BY_VERSION[version] as number;
      if (total !== expected) {
        throw new Error(
          `Tabelas de QR incoerentes: versão ${version} nível ${level} soma ${total} palavras, a norma diz ${expected}.`,
        );
      }
    }
  }
}

/** Correção de erros por bloco, por versão e nível (mesma ordem da tabela de blocos). */
const ECC_PER_BLOCK: Record<number, number> = {
  // L
  1: 7, 2: 10, 3: 15, 4: 20, 5: 26, 6: 18, 7: 20, 8: 24, 9: 30, 10: 18,
  // M
  11: 10, 12: 16, 13: 26, 14: 18, 15: 24, 16: 16, 17: 18, 18: 22, 19: 22, 20: 26,
  // Q
  21: 13, 22: 22, 23: 18, 24: 26, 25: 18, 26: 24, 27: 18, 28: 22, 29: 20, 30: 24,
  // H
  31: 17, 32: 28, 33: 22, 34: 16, 35: 22, 36: 28, 37: 26, 38: 26, 39: 24, 40: 28,
};

export type ErrorLevel = 'L' | 'M' | 'Q' | 'H';

/**
 * Índice do nível na ordem das tabelas da norma.
 *
 * A norma ordena os níveis por resistência crescente, mas os bits das informações de
 * formato usam outra codificação (L=01, M=00, Q=11, H=10). As duas convenções convivem e
 * são a origem de metade dos erros de implementação de QR: por isso ficam separadas, com
 * nomes explícitos, em vez de um único número reutilizado para os dois fins.
 */
const LEVEL_TABLE_INDEX: Record<ErrorLevel, number> = { L: 0, M: 1, Q: 2, H: 3 };
const LEVEL_FORMAT_BITS: Record<ErrorLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

interface BlockLayout {
  totalBlocks: number;
  eccPerBlock: number;
  group1Blocks: number;
  group1Data: number;
  group2Blocks: number;
  group2Data: number;
}

function layoutFor(version: number, level: ErrorLevel): BlockLayout {
  const key = LEVEL_TABLE_INDEX[level] * 10 + (version - 1) + 1;
  const row = BLOCK_TABLE[key];
  const ecc = ECC_PER_BLOCK[key];
  if (!row || ecc === undefined) {
    throw new RangeError(`Versão de QR não suportada: ${version} (máximo 10).`);
  }
  const [group1Blocks = 0, group1Data = 0, group2Blocks = 0, group2Data = 0] = row;
  return {
    totalBlocks: group1Blocks + group2Blocks,
    eccPerBlock: ecc,
    group1Blocks,
    group1Data,
    group2Blocks,
    group2Data,
  };
}

/** Capacidade em bytes de dados de uma versão e nível. */
function dataCapacityBytes(version: number, level: ErrorLevel): number {
  const layout = layoutFor(version, level);
  return layout.group1Blocks * layout.group1Data + layout.group2Blocks * layout.group2Data;
}

/**
 * Bits disponíveis para dados de uma versão e nível.
 *
 * A distinção entre esta função e `dataCapacityBytes` não é cosmética. A contagem de
 * caracteres de um fluxo byte não encaixa certa na capacidade: a versão 2-L comporta
 * **34 palavras-código**, mas um fluxo byte gasta 4 bits de modo e 8 de contagem antes do
 * primeiro carácter, pelo que só cabem **32 bytes**. Escolher a versão pela capacidade em
 * bytes aceitaria 33 bytes na versão 2 e falharia depois, ao construir o fluxo — um erro
 * que apareceria como "os dados não cabem" num tamanho que as tabelas dizem caber. A
 * escolha da versão tem de ser feita em bits.
 */
function dataCapacityBits(version: number, level: ErrorLevel): number {
  return dataCapacityBytes(version, level) * 8;
}

/** Bits gastos pelo cabeçalho do modo byte (indicador de modo + contagem de caracteres). */
function byteModeHeaderBits(version: number): number {
  return 4 + (version <= 9 ? 8 : 16);
}

/* -------------------------------------------------------------------------- */
/* Codificação de dados                                                        */
/* -------------------------------------------------------------------------- */

function utf8Bytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

/** Escritor de bits, que respeita a ordem de transmissão da norma (bit mais significativo
 *  primeiro dentro de cada palavra-código). */
class BitBuffer {
  private readonly bits: number[] = [];

  put(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) this.bits.push((value >>> i) & 1);
  }

  get length(): number {
    return this.bits.length;
  }

  toBytes(): number[] {
    const bytes: number[] = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (this.bits[i + j] ?? 0);
      bytes.push(byte);
    }
    return bytes;
  }
}

/**
 * Sequência completa de palavras-código de dados: modo, contagem, conteúdo e
 * preenchimento.
 *
 * As palavras de preenchimento não são arbitrárias — a norma fixa `0xEC` e `0x11`
 * alternados. Escolhidas por acaso, o código funcionaria na mesma, mas uma sequência de
 * zeros produziria grandes áreas de módulos iguais que os leitores interpretariam mal.
 */
export function buildDataCodewords(payload: number[], version: number, level: ErrorLevel): number[] {
  const capacity = dataCapacityBytes(version, level);
  const buffer = new BitBuffer();

  // Indicador de modo: `0100` para byte.
  buffer.put(4, 4);

  // Contagem de caracteres: 8 bits até à versão 9, 16 bits a partir da 10.
  const countBits = version <= 9 ? 8 : 16;
  if (payload.length >= 1 << countBits) {
    throw new RangeError('Demasiados bytes para o modo byte nesta versão.');
  }
  buffer.put(payload.length, countBits);
  for (const byte of payload) buffer.put(byte, 8);

  const capacityBits = capacity * 8;
  if (buffer.length > capacityBits) {
    throw new RangeError('Os dados não cabem na versão escolhida.');
  }

  // Terminador: até quatro bits a zero, e nunca mais do que o espaço disponível.
  const terminator = Math.min(4, capacityBits - buffer.length);
  buffer.put(0, terminator);

  // Alinhar à palavra-código seguinte.
  if (buffer.length % 8 !== 0) buffer.put(0, 8 - (buffer.length % 8));

  const codewords = buffer.toBytes();
  const padBytes = [0xec, 0x11];
  let padIndex = 0;
  while (codewords.length < capacity) {
    codewords.push(padBytes[padIndex % 2] as number);
    padIndex += 1;
  }

  return codewords;
}

interface InterleavedCodewords {
  data: number[];
  ecc: number[];
}

/**
 * Divisão em blocos, cálculo da paridade e intercalação.
 *
 * A intercalação é o que torna o código resistente a uma mancha localizada: se os blocos
 * fossem escritos seguidos, uma dedada apagaria um bloco inteiro e a correção falharia. Ao
 * entrelaçar, cada bloco perde alguns módulos e todos são recuperáveis.
 */
function interleave(dataCodewords: number[], version: number, level: ErrorLevel): InterleavedCodewords {
  const layout = layoutFor(version, level);
  const dataBlocks: number[][] = [];
  const eccBlocks: number[][] = [];

  let offset = 0;
  for (let i = 0; i < layout.totalBlocks; i += 1) {
    const size = i < layout.group1Blocks ? layout.group1Data : layout.group2Data;
    const block = dataCodewords.slice(offset, offset + size);
    offset += size;
    dataBlocks.push(block);
    eccBlocks.push(rsRemainder(block, layout.eccPerBlock));
  }

  const data: number[] = [];
  const maxDataLength = Math.max(...dataBlocks.map((block) => block.length));
  for (let i = 0; i < maxDataLength; i += 1) {
    for (const block of dataBlocks) {
      // Os blocos do grupo 2 são um byte mais longos do que os do grupo 1; o byte extra
      // existe apenas no grupo 2 e é por isso que a condição de existência é verificada
      // aqui em vez de se assumir um comprimento único.
      if (i < block.length) data.push(block[i] as number);
    }
  }

  const ecc: number[] = [];
  for (let i = 0; i < layout.eccPerBlock; i += 1) {
    for (const block of eccBlocks) ecc.push(block[i] as number);
  }

  return { data, ecc };
}

/* -------------------------------------------------------------------------- */
/* Matriz                                                                      */
/* -------------------------------------------------------------------------- */

/** Módulo ainda por decidir, marcado para distinguir de "decidido a branco". */
const UNKNOWN = -1;

class Matrix {
  readonly size: number;
  readonly modules: Int8Array;
  /** `true` quando o módulo pertence a um padrão de função e não transporta dados. */
  readonly reserved: Uint8Array;

  constructor(size: number) {
    this.size = size;
    this.modules = new Int8Array(size * size).fill(UNKNOWN);
    this.reserved = new Uint8Array(size * size);
  }

  get(x: number, y: number): number {
    return this.modules[y * this.size + x] as number;
  }

  set(x: number, y: number, value: number, isFunction = true): void {
    this.modules[y * this.size + x] = value;
    if (isFunction) this.reserved[y * this.size + x] = 1;
  }

  isReserved(x: number, y: number): boolean {
    return this.reserved[y * this.size + x] === 1;
  }

  isUnknown(x: number, y: number): boolean {
    return this.modules[y * this.size + x] === UNKNOWN;
  }
}

/** Posições centrais dos padrões de alinhamento, segundo a norma. */
function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  // A norma define o espaçamento entre centros como um múltiplo par, para que os padrões
  // caiam em coordenadas ímpares. `step` é arredondado ao par mais próximo.
  const step = Math.ceil((size - 13) / (count * 2 - 2)) * 2;
  const positions = [6];
  for (let i = count - 1; i >= 1; i -= 1) positions.splice(1, 0, size - 7 - (count - 1 - i) * step);
  return positions.sort((a, b) => a - b);
}

function placeFinderPattern(matrix: Matrix, centerX: number, centerY: number): void {
  // Padrão 7×7: anel escuro, anel claro, núcleo escuro 3×3. A alternância é o que dá ao
  // leitor a referência de escala e de orientação que ele procura primeiro.
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const x = centerX + dx;
      const y = centerY + dy;
      if (x < 0 || y < 0 || x >= matrix.size || y >= matrix.size) continue;
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      const dark = distance !== 2 && distance <= 3;
      matrix.set(x, y, dark ? 1 : 0);
    }
  }
}

function placeFunctionPatterns(matrix: Matrix, version: number): void {
  const size = matrix.size;

  // Localizadores nos três cantos (o quarto canto fica livre para dados).
  placeFinderPattern(matrix, 3, 3);
  placeFinderPattern(matrix, size - 4, 3);
  placeFinderPattern(matrix, 3, size - 4);

  // Padrões de temporização: alternância que permite ao leitor medir o tamanho do módulo
  // ao longo de toda a linha e coluna.
  for (let i = 8; i < size - 8; i += 1) {
    const dark = i % 2 === 0;
    matrix.set(i, 6, dark ? 1 : 0);
    matrix.set(6, i, dark ? 1 : 0);
  }

  // Padrões de alinhamento: quadrado 5×5 com centro escuro. Aplicam-se a todos os centros
  // exceto os que coincidiriam com um localizador.
  for (const y of alignmentPositions(version)) {
    for (const x of alignmentPositions(version)) {
      const overlapsFinder =
        (x === 6 && y === 6) || (x === 6 && y === size - 7) || (x === size - 7 && y === 6);
      if (overlapsFinder) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const distance = Math.max(Math.abs(dx), Math.abs(dy));
          matrix.set(x + dx, y + dy, distance === 2 || distance === 0 ? 1 : 0);
        }
      }
    }
  }

  // Reservar as zonas de formato (à volta dos localizadores) e de versão (versão ≥ 7),
  // para que a colocação de dados não as ocupe antes de serem escritas.
  for (let i = 0; i < 9; i += 1) {
    if (i !== 6) {
      matrix.set(i, 8, 0);
      matrix.set(8, i, 0);
    }
  }
  for (let i = 0; i < 8; i += 1) {
    matrix.set(size - 1 - i, 8, 0);
    matrix.set(8, size - 1 - i, 0);
  }
  // O módulo escuro fixo: a norma exige-o e o leitor usa-o para normalizar o contraste.
  matrix.set(8, size - 8, 1);

  if (version >= 7) {
    for (let i = 0; i < 6; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        matrix.set(size - 11 + j, i, 0);
        matrix.set(i, size - 11 + j, 0);
      }
    }
  }
}

/**
 * Colocação dos dados em ziguezague.
 *
 * A ordem não é negociável nem intuitiva: começa no canto inferior direito, sobe em pares
 * de colunas e desce pela coluna seguinte, saltando a coluna de temporização (a 6) e todos
 * os módulos de função. Qualquer desvio produz um código que *parece* correto e nenhum
 * leitor consegue descodificar.
 */
function placeData(matrix: Matrix, codewords: number[]): void {
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  let upward = true;

  for (let right = matrix.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // saltar a coluna de temporização
    for (let step = 0; step < matrix.size; step += 1) {
      const y = upward ? matrix.size - 1 - step : step;
      for (let columnOffset = 0; columnOffset < 2; columnOffset += 1) {
        const x = right - columnOffset;
        if (matrix.isReserved(x, y) || !matrix.isUnknown(x, y)) continue;
        // Depois de os dados acabarem, os módulos restantes ficam a zero (claros) — é o
        // "resto" previsto pela norma.
        const bit = bitIndex < totalBits ? (codewords[bitIndex >> 3] as number) >> (7 - (bitIndex & 7)) & 1 : 0;
        matrix.modules[y * matrix.size + x] = bit;
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
}

const MASK_FUNCTIONS: ReadonlyArray<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(matrix: Matrix, maskIndex: number, apply: boolean): void {
  const fn = MASK_FUNCTIONS[maskIndex] as (x: number, y: number) => boolean;
  for (let y = 0; y < matrix.size; y += 1) {
    for (let x = 0; x < matrix.size; x += 1) {
      if (matrix.isReserved(x, y)) continue;
      if (fn(x, y) === apply) {
        matrix.modules[y * matrix.size + x] = (matrix.modules[y * matrix.size + x] as number) ^ 1;
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Informação de formato e de versão                                           */
/* -------------------------------------------------------------------------- */

/**
 * Código BCH de 15 bits com as informações de formato.
 *
 * Os 5 bits de dados (2 de nível + 3 de máscara) são protegidos por 10 bits de BCH(15,5),
 * e o resultado é somado a `0x5412` — a máscara fixa exigida pela norma, cuja ausência é
 * uma das causas mais comuns de códigos que não são lidos.
 */
function formatBits(level: ErrorLevel, maskIndex: number): number {
  const data = (LEVEL_FORMAT_BITS[level] << 3) | maskIndex;
  let remainder = data << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((remainder >> i) & 1) remainder ^= 0b10100110111 << (i - 10);
  }
  return ((data << 10) | remainder) ^ 0b101010000010010;
}

/** Código BCH(18,6) com a versão, para versões 7 e superiores. */
function versionBits(version: number): number {
  let remainder = version << 12;
  for (let i = 17; i >= 12; i -= 1) {
    if ((remainder >> i) & 1) remainder ^= 0b1111100100101 << (i - 12);
  }
  return (version << 12) | remainder;
}

function placeFormatAndVersion(matrix: Matrix, version: number, level: ErrorLevel, maskIndex: number): void {
  const size = matrix.size;
  const bits = formatBits(level, maskIndex);

  // O formato é escrito duas vezes, em duas cópias, para que continue legível com um canto
  // danificado. A segunda cópia é sempre o mesmo código, mas distribuído em dois sentidos.
  for (let i = 0; i < 15; i += 1) {
    const dark = ((bits >> i) & 1) === 1 ? 1 : 0;
    // Cópia junto ao localizador superior esquerdo.
    if (i < 6) matrix.set(8, i, dark);
    else if (i < 8) matrix.set(8, i + 1, dark);
    else if (i === 8) matrix.set(7, 8, dark);
    else matrix.set(14 - i, 8, dark);

    // Cópia junto ao localizador inferior esquerdo e ao superior direito.
    if (i < 8) matrix.set(size - 1 - i, 8, dark);
    else matrix.set(8, size - 15 + i, dark);
  }
  // O módulo escuro fixo é reafirmado depois do formato, porque a segunda cópia escreve
  // na sua vizinhança.
  matrix.set(8, size - 8, 1);

  if (version >= 7) {
    const versionCode = versionBits(version);
    for (let i = 0; i < 18; i += 1) {
      const dark = ((versionCode >> i) & 1) === 1 ? 1 : 0;
      const x = size - 11 + (i % 3);
      const y = Math.floor(i / 3);
      matrix.set(x, y, dark);
      matrix.set(y, x, dark);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Máscara — regras de penalização da norma                                    */
/* -------------------------------------------------------------------------- */

/** Regra 1: séries de cinco ou mais módulos iguais na mesma linha ou coluna. */
function penaltyRuns(matrix: Matrix): number {
  let penalty = 0;
  const size = matrix.size;

  const scoreRuns = (getter: (i: number, j: number) => number): void => {
    for (let i = 0; i < size; i += 1) {
      let run = 1;
      let previous = getter(i, 0);
      for (let j = 1; j < size; j += 1) {
        const current = getter(i, j);
        if (current === previous) {
          run += 1;
        } else {
          if (run >= 5) penalty += 3 + (run - 5);
          run = 1;
          previous = current;
        }
      }
      if (run >= 5) penalty += 3 + (run - 5);
    }
  };

  scoreRuns((i, j) => matrix.get(j, i));
  scoreRuns((i, j) => matrix.get(i, j));
  return penalty;
}

/** Regra 2: cada bloco 2×2 de módulos iguais. */
function penaltyBlocks(matrix: Matrix): number {
  let penalty = 0;
  for (let y = 0; y < matrix.size - 1; y += 1) {
    for (let x = 0; x < matrix.size - 1; x += 1) {
      const value = matrix.get(x, y);
      if (
        value === matrix.get(x + 1, y) &&
        value === matrix.get(x, y + 1) &&
        value === matrix.get(x + 1, y + 1)
      ) {
        penalty += 3;
      }
    }
  }
  return penalty;
}

/**
 * Regra 3: o padrão 1:1:3:1:1 (as proporções de um localizador) encontrado fora de um
 * localizador confunde o leitor — por isso é fortemente penalizado.
 */
function penaltyFinderLike(matrix: Matrix): number {
  const pattern = [1, 0, 1, 1, 1, 0, 1];
  const size = matrix.size;
  let penalty = 0;

  const matches = (getter: (i: number, j: number) => number, i: number, j: number): boolean => {
    for (let k = 0; k < 7; k += 1) {
      if (getter(i, j + k) !== pattern[k]) return false;
    }
    // Só conta como falso localizador se estiver rodeado dos quatro módulos claros.
    const before = j - 1 >= 0 ? getter(i, j - 1) : 0;
    const after = j + 7 < size ? getter(i, j + 7) : 0;
    return before === 0 && after === 0;
  };

  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j + 7 <= size; j += 1) {
      if (matches((a, b) => matrix.get(b, a), i, j)) penalty += 40;
      if (matches((a, b) => matrix.get(a, b), i, j)) penalty += 40;
    }
  }
  return penalty;
}

/** Regra 4: desequilíbrio entre módulos escuros e claros. */
function penaltyBalance(matrix: Matrix): number {
  let dark = 0;
  for (const module of matrix.modules) if (module === 1) dark += 1;
  const total = matrix.size * matrix.size;
  const ratio = (dark * 100) / total;
  // `Math.abs` com o passo de 5 % e multiplicado por 10, como a norma especifica.
  return Math.floor(Math.abs(ratio - 50) / 5) * 10;
}

function penalty(matrix: Matrix): number {
  return penaltyRuns(matrix) + penaltyBlocks(matrix) + penaltyFinderLike(matrix) + penaltyBalance(matrix);
}

/* -------------------------------------------------------------------------- */
/* API pública                                                                 */
/* -------------------------------------------------------------------------- */

export interface QrMatrix {
  /** Lado do módulo quadrado: `version * 4 + 17`. */
  size: number;
  /** `true` para módulo escuro. Indexado por `[y][x]`. */
  modules: boolean[][];
  version: number;
  level: ErrorLevel;
  mask: number;
}

export interface EncodeOptions {
  level?: ErrorLevel;
  /** Força uma versão; por omissão, escolhe a menor que comporta os dados. */
  version?: number;
}

/**
 * Codifica um texto num QR de versão 1 a 10.
 *
 * Lança apenas quando os dados não cabem na versão 10 (mais de 271 bytes no nível L) —
 * um `otpauth://` chega a 200 caracteres e fica bem dentro do limite. Nesse caso, o ecrã
 * mostra o segredo em texto, que é o comportamento de recurso previsto.
 */
export function encodeQr(text: string, options: EncodeOptions = {}): QrMatrix {
  const level = options.level ?? 'L';
  const payload = utf8Bytes(text);

  let version = options.version ?? 0;
  if (version === 0) {
    for (let candidate = 1; candidate <= 10; candidate += 1) {
      // A contagem de caracteres ocupa 8 bits até à versão 9, pelo que uma mensagem com
      // 256 bytes ou mais nem sequer consegue exprimir o seu próprio tamanho nestas
      // versões — ficam excluídas antes de qualquer conta de capacidade.
      if (payload.length > 255 && candidate <= 9) continue;
      const neededBits = byteModeHeaderBits(candidate) + payload.length * 8;
      if (neededBits <= dataCapacityBits(candidate, level)) {
        version = candidate;
        break;
      }
    }
  }
  if (version === 0 || version > 10) {
    throw new RangeError(
      'Os dados não cabem num QR de versão 1 a 10 (limite de 271 bytes no nível L).',
    );
  }

  const dataCodewords = buildDataCodewords(payload, version, level);
  const { data, ecc } = interleave(dataCodewords, version, level);

  const size = version * 4 + 17;
  const base = new Matrix(size);
  placeFunctionPatterns(base, version);
  placeData(base, [...data, ...ecc]);

  // Escolher a máscara com menor penalização. Cada tentativa parte de uma cópia da matriz
  // sem formato, porque o formato é escrito depois da máscara (a norma avalia o padrão
  // final, incluindo a informação de formato).
  let bestMask = 0;
  let bestPenalty = Number.POSITIVE_INFINITY;
  let bestModules: Int8Array | null = null;

  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = cloneMatrix(base);
    applyMask(candidate, mask, true);
    placeFormatAndVersion(candidate, version, level, mask);
    const score = penalty(candidate);
    if (score < bestPenalty) {
      bestPenalty = score;
      bestMask = mask;
      bestModules = candidate.modules;
    }
  }

  const chosen = bestModules as Int8Array;
  const modules: boolean[][] = [];
  for (let y = 0; y < size; y += 1) {
    const row: boolean[] = [];
    for (let x = 0; x < size; x += 1) row.push(chosen[y * size + x] === 1);
    modules.push(row);
  }

  return { size, modules, version, level, mask: bestMask };
}

function cloneMatrix(matrix: Matrix): Matrix {
  const copy = new Matrix(matrix.size);
  copy.modules.set(matrix.modules);
  copy.reserved.set(matrix.reserved);
  return copy;
}

/**
 * Descodifica de volta os dados de uma matriz gerada por `encodeQr`.
 *
 * Existe para teste: é a única forma de verificar, numa bateria automatizada, que a
 * colocação dos módulos, a máscara e o formato estão coerentes — sem ela, um erro de
 * deslocamento de um módulo produziria um SVG bonito e ilegível, e o defeito só apareceria
 * quando alguém tentasse ler o código com o telemóvel. Não faz correção de erros: a
 * mensagem chega sem ruído, porque vem da mesma matriz.
 */
export function decodeQr(matrix: QrMatrix): string {
  const size = matrix.size;
  const grid: Matrix = new Matrix(size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      grid.modules[y * size + x] = matrix.modules[y]?.[x] ? 1 : 0;
    }
  }
  // Reconstruir as zonas de função para poder remover a máscara só dos módulos de dados.
  placeFunctionPatterns(grid, matrix.version);
  applyMask(grid, matrix.mask, true);

  const bits: number[] = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) {
      const y = upward ? size - 1 - step : step;
      for (let columnOffset = 0; columnOffset < 2; columnOffset += 1) {
        const x = right - columnOffset;
        if (grid.isReserved(x, y)) continue;
        bits.push(grid.get(x, y) === 1 ? 1 : 0);
      }
    }
    upward = !upward;
  }

  const codewords: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (bits[i + j] as number);
    codewords.push(byte);
  }

  const layout = layoutFor(matrix.version, matrix.level);
  // Desintercalar: os dados vêm em rodadas de um byte por bloco.
  const blockSizes: number[] = [];
  for (let i = 0; i < layout.totalBlocks; i += 1) {
    blockSizes.push(i < layout.group1Blocks ? layout.group1Data : layout.group2Data);
  }
  const blocks: number[][] = blockSizes.map(() => []);
  const totalDataBytes = blockSizes.reduce((sum, value) => sum + value, 0);
  let cursor = 0;
  const maxLength = Math.max(...blockSizes);
  for (let i = 0; i < maxLength; i += 1) {
    for (let b = 0; b < blockSizes.length; b += 1) {
      if (i < (blockSizes[b] as number) && cursor < totalDataBytes) {
        (blocks[b] as number[]).push(codewords[cursor] as number);
        cursor += 1;
      }
    }
  }

  const dataCodewords = blocks.flat();

  // Ler o cabeçalho: modo (4 bits), contagem (8 ou 16 bits) e conteúdo.
  let bitIndex = 0;
  const readBits = (count: number): number => {
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      const byte = dataCodewords[bitIndex >> 3] ?? 0;
      value = (value << 1) | ((byte >> (7 - (bitIndex & 7))) & 1);
      bitIndex += 1;
    }
    return value;
  };

  const mode = readBits(4);
  if (mode !== 4) throw new Error(`Modo inesperado no QR descodificado: ${mode}`);
  const count = readBits(matrix.version <= 9 ? 8 : 16);
  const bytes: number[] = [];
  for (let i = 0; i < count; i += 1) bytes.push(readBits(8));

  return new TextDecoder().decode(new Uint8Array(bytes));
}

/**
 * Desenha a matriz como SVG.
 *
 * Um único `<path>` com um subcaminho por módulo escuro, em vez de um `<rect>` por módulo:
 * um QR de versão 10 tem 57 × 57 módulos e um `<rect>` por cada um produziria mais de mil
 * nós no DOM — e o mesmo número de decisões de estilo no browser. O caminho é gerado no
 * cliente e não contém qualquer texto, o que também evita o único caso em que a aplicação
 * produziria HTML a partir de dados.
 */
export function qrToSvgPath(matrix: QrMatrix, moduleSize = 1): string {
  const parts: string[] = [];
  for (let y = 0; y < matrix.size; y += 1) {
    for (let x = 0; x < matrix.size; x += 1) {
      if (matrix.modules[y]?.[x]) {
        parts.push(`M${x * moduleSize} ${y * moduleSize}h${moduleSize}v${moduleSize}h-${moduleSize}z`);
      }
    }
  }
  return parts.join('');
}

/**
 * Elemento SVG completo e autónomo, para descarregar ou imprimir.
 *
 * A zona de silêncio de quatro módulos não é decoração: é uma exigência da norma. Sem ela, o
 * leitor não distingue a borda do código do fundo em que está inserido — e o erro é invisível
 * a olho nu, porque o código parece perfeitamente normal a quem o desenha.
 */
export function qrToSvgMarkup(matrix: QrMatrix, options: { moduleSize?: number; quietZone?: number } = {}): string {
  const moduleSize = options.moduleSize ?? 8;
  const quietZone = options.quietZone ?? 4;
  const side = (matrix.size + quietZone * 2) * moduleSize;
  const path = qrToSvgPath(matrix, moduleSize);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges">`,
    `<rect width="${side}" height="${side}" fill="#ffffff"/>`,
    `<g transform="translate(${quietZone * moduleSize} ${quietZone * moduleSize})" fill="#000000">`,
    `<path d="${path}"/>`,
    '</g></svg>',
  ].join('');
}

/*
 * Verificação das tabelas, corrida uma vez no carregamento do módulo.
 *
 * Custa quarenta iterações e elimina a única classe de defeito que estas tabelas podem ter:
 * uma linha mal copiada da norma, que produz códigos QR com bom aspeto e ilegíveis — e que
 * nenhum teste de tipos apanha. Tem de ficar **no fim do ficheiro**: as constantes que usa são
 * avaliadas por ordem, e chamá-la mais acima lançaria `Cannot access before initialization`.
 */
assertCodewordTotals();