/*
 * Verificação do codificador de QR.
 *
 * Script de verificação, não parte da aplicação. A aplicação não tem câmara nem leitor de
 * QR no processo de construção, pelo que a correção tem de ser demonstrada de outra forma:
 *
 *  - **vetores publicados da norma ISO/IEC 18004** para o fluxo de bits, onde existem;
 *  - **ida e volta** (codificar → descodificar da própria matriz) para a colocação dos
 *    módulos, a máscara e as informações de formato — um deslocamento de um módulo
 *    produziria um SVG bonito e ilegível, e é precisamente isso que este teste apanha;
 *  - **valores de referência calculados à mão** onde o vetor publicado é de um outro modo
 *    de codificação (alfanumérico) e por isso não comparável byte a byte.
 *
 * Execução: node --experimental-strip-types apps/web/scripts/verify-qr.ts
 */

import {
  buildDataCodewords,
  decodeQr,
  encodeQr,
  qrToSvgMarkup,
  rsRemainder,
  type ErrorLevel,
} from '../src/lib/qr.ts';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}`);
  if (!ok) {
    console.log(`         esperado: ${JSON.stringify(expected)}`);
    console.log(`         obtido:   ${JSON.stringify(actual)}`);
  }
}

const bytes = (text: string): number[] => Array.from(new TextEncoder().encode(text));
const hex = (values: number[]): string =>
  values.map((value) => value.toString(16).padStart(2, '0').toUpperCase()).join(' ');

/* -------------------------------------------------------------------------- */
/* 1. Fluxo de bits                                                            */
/* -------------------------------------------------------------------------- */

/*
 * O vetor publicado mais citado da norma («01234567» em modo numérico, versão 1-M) não é
 * comparável com um codificador de modo byte. O que se verifica aqui é a **composição
 * exata** do fluxo byte a byte, calculada à mão a partir da especificação:
 *
 *   modo byte           0100
 *   contagem (8 bits)   00001011          → 11 bytes
 *   «HELLO WORLD»       H=0x48 ...
 *   = 0x40 0xB4 0x84 0x54 0xC4 0xC4 0xF2 0x05 0x74 0xF5 0x24
 *   terminador + alinhamento → 2 bits de zero no fim do último byte
 *   preenchimento       0xEC 0x11 alternados até 16 palavras (versão 1-M)
 *
 * O preenchimento não é decoração: sem ele, a área de dados ficaria com grandes blocos
 * uniformes e o leitor perderia a referência de sincronismo.
 */
check(
  'palavras de dados, versão 1-M, modo byte',
  hex(buildDataCodewords(bytes('HELLO WORLD'), 1, 'M')),
  hex([0x40, 0xb4, 0x84, 0x54, 0xc4, 0xc4, 0xf2, 0x05, 0x74, 0xf5, 0x24, 0xc4, 0x40, 0xec, 0x11, 0xec]),
);

check(
  'cabeçalho de 16 bits na versão 10 (contagem de 16 bits)',
  hex(buildDataCodewords(bytes('A'), 10, 'L').slice(0, 4)),
  // 0100 | 00000000 00000001 | 01000001 → os dois bytes seguintes levam o último bit da
  // contagem e os sete bits de maior peso do carácter.
  hex([0x40, 0x00, 0x14, 0x10]),
);

/* -------------------------------------------------------------------------- */
/* 2. Paridade Reed–Solomon                                                    */
/* -------------------------------------------------------------------------- */

/*
 * Com um bloco único (versão 1, qualquer nível) todas as palavras de dados são seguidas,
 * sem intercalação, das palavras de paridade — é a única situação em que a paridade pode
 * ser lida diretamente do fluxo.
 *
 * A paridade é comparada com uma **segunda implementação independente**, escrita abaixo
 * neste ficheiro: em vez de tabelas de logaritmos pré-calculadas, multiplica em GF(256)
 * por deslocamento e redução, e deriva o polinómio gerador por multiplicação sucessiva.
 * Duas implementações que partilham apenas a especificação, e não o código, concordarem no
 * resultado é uma verificação a sério — comparar `rsRemainder` com uma lista de números
 * copiada de um livro seria mais frágil do que isto.
 */

/*
 * Aritmética independente de GF(256), com o polinómio primitivo 0x11D (x⁸+x⁴+x³+x²+1).
 * `gfMul` multiplica por duplicações sucessivas — sem tabelas, e por isso sem o risco de
 * partilhar um erro com a implementação em teste.
 */
function gfMulReference(a: number, b: number): number {
  let result = 0;
  let x = a;
  let y = b;
  while (y > 0) {
    if (y & 1) result ^= x;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
    y >>= 1;
  }
  return result & 0xff;
}

/** Polinómio gerador de grau `degree`, com os coeficientes de maior para menor grau. */
function generatorReference(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const root = alphaPow(i);
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      const coefficient = poly[j] as number;
      // Coeficientes ascendentes: o termo de grau j sobe a j+1 ao multiplicar por x, e o
      // termo constante recebe o produto pela raiz α^i.
      next[j] = (next[j] as number) ^ coefficient;
      next[j + 1] = (next[j + 1] as number) ^ gfMulReference(coefficient, root);
    }
    poly = next;
  }
  return poly;
}

/** α^i em GF(256), calculado por duplicações, sem tabelas. */
function alphaPow(exponent: number): number {
  let value = 1;
  for (let i = 0; i < exponent % 255; i += 1) {
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  return value;
}

/** Resto da divisão de `data` (com `degree` zeros) pelo gerador — versão independente. */
function remainderReference(data: readonly number[], degree: number): number[] {
  const generator = generatorReference(degree);
  const remainder = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = (byte ^ (remainder[0] as number)) & 0xff;
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < degree; i += 1) {
      remainder[i] = (remainder[i] as number) ^ gfMulReference(generator[i + 1] as number, factor);
    }
  }
  return remainder;
}

const v1mData = buildDataCodewords(bytes('HELLO WORLD'), 1, 'M');
const v1mParity = rsRemainder(v1mData, 10);
check('paridade de 10 palavras na versão 1-M (tamanho)', v1mParity.length, 10);
check('paridade versão 1-M coincide com a implementação independente', hex(v1mParity), hex(remainderReference(v1mData, 10)));

const v1qData = buildDataCodewords(bytes('HELLO WORLD'), 1, 'Q');
const v1qParity = rsRemainder(v1qData, 13);
check('paridade versão 1-Q coincide com a implementação independente', hex(v1qParity), hex(remainderReference(v1qData, 13)));

const v5hData = buildDataCodewords(bytes('Zemlo — verificação de paridade'), 5, 'H');
const v5hParity = rsRemainder(v5hData, 22);
check(
  'paridade versão 5-H coincide com a implementação independente',
  hex(v5hParity),
  hex(remainderReference(v5hData, 22)),
);

// Propriedade algébrica: o bloco completo é divisível pelo gerador, ou seja, o resto é zero.
check('bloco completo é divisível pelo gerador (versão 1-M)', rsRemainder([...v1mData, ...v1mParity], 10), new Array(10).fill(0));
check('bloco completo é divisível pelo gerador (versão 1-Q, grau 13)', rsRemainder([...v1qData, ...v1qParity], 13), new Array(13).fill(0));
check('bloco completo é divisível pelo gerador (versão 5-H, grau 22)', rsRemainder([...v5hData, ...v5hParity], 22), new Array(22).fill(0));

// Uma única alteração num byte de dados tem de alterar a paridade: se não alterasse, a
// correção de erros não detetaria nada.
const flipped = [...v1mData];
flipped[0] = (flipped[0] as number) ^ 0xff;
check('paridade reage a um byte alterado', rsRemainder(flipped, 10).join() !== v1mParity.join(), true);

/* -------------------------------------------------------------------------- */
/* 3. Capacidade das versões                                                   */
/* -------------------------------------------------------------------------- */

check('versão 1-L: 19 palavras de dados', buildDataCodewords(bytes('z'.repeat(17)), 1, 'L').length, 19);
check('versão 1-Q: 13 palavras de dados', buildDataCodewords(bytes('z'.repeat(11)), 1, 'Q').length, 13);
check('versão 10-L: 274 palavras de dados', buildDataCodewords(bytes('z'.repeat(271)), 10, 'L').length, 274);
check('versão 10-H: 122 palavras de dados', buildDataCodewords(bytes('z'.repeat(119)), 10, 'H').length, 122);

let overflowThrew = false;
try {
  buildDataCodewords(bytes('z'.repeat(18)), 1, 'L');
} catch {
  overflowThrew = true;
}
check('18 bytes na versão 1-L são recusados', overflowThrew, true);

/* -------------------------------------------------------------------------- */
/* 4. Informação de formato — a tabela completa da norma                        */
/* -------------------------------------------------------------------------- */

/*
 * A norma publica os 32 valores de 15 bits da informação de formato. Verificá-los todos é
 * o teste mais valioso deste ficheiro: um erro no BCH ou na máscara fixa `0x5412` produz
 * códigos que nenhum leitor reconhece — e o defeito seria invisível no SVG gerado.
 */
const LEVELS: ErrorLevel[] = ['L', 'M', 'Q', 'H'];
const FORMAT_REFERENCE = [
  0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976,
  0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0,
  0x355f, 0x3068, 0x3f31, 0x3a06, 0x24b4, 0x2183, 0x2eda, 0x2bed,
  0x1689, 0x13be, 0x1ce7, 0x19d0, 0x0762, 0x0255, 0x0d0c, 0x083b,
];

function formatBitsFromModule(level: ErrorLevel, mask: number): number {
  const levelBits = { L: 1, M: 0, Q: 3, H: 2 }[level];
  const data = (levelBits << 3) | mask;
  let remainder = data << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((remainder >> i) & 1) remainder ^= 0b10100110111 << (i - 10);
  }
  return ((data << 10) | remainder) ^ 0b101010000010010;
}

const computedFormat: number[] = [];
for (const level of LEVELS) {
  for (let mask = 0; mask < 8; mask += 1) computedFormat.push(formatBitsFromModule(level, mask));
}
check('32 valores de informação de formato', computedFormat, FORMAT_REFERENCE);

/**
 * Lê a cópia da informação de formato junto ao localizador superior esquerdo.
 *
 * A ordem é a da norma — bit 0 primeiro — e passa por três segmentos: coluna 8 de cima
 * para baixo, o módulo (7,8) e depois a linha 8 da direita para a esquerda.
 */
function readFormatCopy(matrix: ReturnType<typeof encodeQr>): number {
  const read: number[] = [];
  for (let i = 0; i < 15; i += 1) {
    let x: number;
    let y: number;
    if (i < 6) {
      x = 8;
      y = i;
    } else if (i < 8) {
      x = 8;
      y = i + 1;
    } else if (i === 8) {
      x = 7;
      y = 8;
    } else {
      x = 14 - i;
      y = 8;
    }
    read.push(matrix.modules[y]?.[x] ? 1 : 0);
  }
  return read.reduce((acc, bit, index) => acc | (bit << index), 0);
}

for (const level of LEVELS) {
  const matrix = encodeQr('Zemlo', { level, version: 2 });
  check(
    `informação de formato gravada na matriz (nível ${level}, máscara ${matrix.mask})`,
    readFormatCopy(matrix),
    formatBitsFromModule(level, matrix.mask),
  );
}

/*
 * A segunda cópia (junto ao canto inferior esquerdo e ao superior direito) tem de
 * conter o mesmo valor: é a redundância que mantém o código legível com um canto danificado.
 */
const mirrored = encodeQr('Zemlo', { level: 'M', version: 2 });
const expectedFormat = formatBitsFromModule('M', mirrored.mask);
const secondCopy: number[] = [];
for (let i = 0; i < 15; i += 1) {
  if (i < 8) secondCopy.push(mirrored.modules[8]?.[mirrored.size - 1 - i] ? 1 : 0);
  else secondCopy.push(mirrored.modules[mirrored.size - 15 + i]?.[8] ? 1 : 0);
}
check(
  'segunda cópia da informação de formato é idêntica',
  secondCopy.reduce((acc, bit, index) => acc | (bit << index), 0),
  expectedFormat,
);

/* -------------------------------------------------------------------------- */
/* 5. Ida e volta                                                              */
/* -------------------------------------------------------------------------- */

/*
 * Limites efetivos do nível 10, já contando com os bits de modo e de contagem:
 * L=271, M=213, Q=151, H=119. Acima disso o codificador tem de **recusar** — nunca
 * produzir um código truncado.
 *
 * A igualdade é conseguida com um objecto construído a partir da tabela, para que uma
 * alteração ao limite de um nível se reflita automaticamente nos três usos abaixo.
 */
const MAX_BYTES: Record<ErrorLevel, number> = { L: 271, M: 213, Q: 151, H: 119 };

const ROUND_TRIP_TEXTS = [
  'otpauth://totp/Zemlo:miguel@zemlo.pt?secret=JBSWY3DPEHPK3PXP&issuer=Zemlo',
  'A',
  '1234567890',
  'acentos: ação, coração, ção — travessão',
  'x'.repeat(119),
  'x'.repeat(151),
  'x'.repeat(213),
  'x'.repeat(271),
  // Acima de qualquer limite: tem de ser recusado em todos os níveis.
  'y'.repeat(300),
];

for (const text of ROUND_TRIP_TEXTS) {
  for (const level of LEVELS) {
    const fits = text.length <= MAX_BYTES[level];
    try {
      const matrix = encodeQr(text, { level });
      check(
        `ida e volta — nível ${level}, ${text.length} bytes (versão ${matrix.version})`,
        decodeQr(matrix),
        text,
      );
      // Se o codificador aceitou, tinha de caber: um código aceite acima do limite
      // significaria que o limite calculado não é o real.
      check(`limite respeitado — nível ${level}, ${text.length} bytes`, fits, true);
    } catch (error) {
      check(
        `ida e volta — nível ${level}, ${text.length} bytes`,
        fits ? `erro inesperado: ${(error as Error).message}` : 'recusado por capacidade',
        fits ? 'ida e volta' : 'recusado por capacidade',
      );
    }
  }
}

/*
 * Fronteira exata da versão 2-L: 34 palavras-código de capacidade, mas apenas 32 bytes de
 * conteúdo, porque o cabeçalho do modo byte gasta 12 bits. Este caso apanhou um defeito
 * real — a escolha da versão estava a ser feita em bytes e aceitava 33 bytes na versão 2,
 * falhando depois ao construir o fluxo.
 */
check('32 bytes no nível L → versão 2', encodeQr('x'.repeat(32), { level: 'L' }).version, 2);
check('33 bytes no nível L → versão 3', encodeQr('x'.repeat(33), { level: 'L' }).version, 3);
check('ida e volta com 32 bytes na versão 2', decodeQr(encodeQr('x'.repeat(32), { level: 'L' })), 'x'.repeat(32));
check('ida e volta com 33 bytes na versão 3', decodeQr(encodeQr('x'.repeat(33), { level: 'L' })), 'x'.repeat(33));

// Todas as versões de 1 a 10 têm de sobreviver a uma ida e volta.
for (let version = 1; version <= 10; version += 1) {
  const text = `Zemlo v${version}`;
  check(`ida e volta forçando a versão ${version}`, decodeQr(encodeQr(text, { version, level: 'L' })), text);
}

/* -------------------------------------------------------------------------- */
/* 6. Estrutura da matriz                                                      */
/* -------------------------------------------------------------------------- */

const SIZE_BY_VERSION: Array<[number, number]> = [
  [1, 21], [2, 25], [3, 29], [4, 33], [5, 37], [6, 41], [7, 45], [8, 49], [9, 53], [10, 57],
];
for (const [version, expectedSize] of SIZE_BY_VERSION) {
  check(`versão ${version} → lado ${expectedSize}`, encodeQr('Z', { version, level: 'L' }).size, expectedSize);
}

const probe = encodeQr('Zemlo', { level: 'M' });
const dark = (x: number, y: number): boolean => probe.modules[y]?.[x] === true;

// Localizador 7×7: núcleo escuro 3×3 (distância ≤1), anel claro (distância 2) e anel
// escuro exterior (distância 3). O que se verifica é a alternância nos eixos que o leitor
// mede para encontrar a escala do módulo.
check('localizador superior esquerdo: núcleo escuro', [dark(3, 3), dark(4, 3), dark(3, 4)], [true, true, true]);
check('localizador superior esquerdo: anel claro em (1,3) e (5,3)', [dark(1, 3), dark(5, 3)], [false, false]);
check('localizador superior esquerdo: anel escuro em (0,3) e (6,3)', [dark(0, 3), dark(6, 3)], [true, true]);
check('separador claro em (7,7)', dark(7, 7), false);
check('localizador superior direito', dark(probe.size - 4, 3), true);
check('localizador inferior esquerdo', dark(3, probe.size - 4), true);
check('módulo escuro fixo', dark(8, probe.size - 8), true);
check('temporizador horizontal (linha 6)', [dark(8, 6), dark(9, 6), dark(10, 6)], [true, false, true]);
check('temporizador vertical (coluna 6)', [dark(6, 8), dark(6, 9), dark(6, 10)], [true, false, true]);

// Padrões de alinhamento da versão 7: centros em 6, 22 e 38. O centro é escuro e o anel
// imediatamente à sua volta é claro.
const v7 = encodeQr('z'.repeat(110), { version: 7, level: 'L' });
check('alinhamento v7: centro (22,22) escuro', v7.modules[22]?.[22], true);
check('alinhamento v7: anel claro em (21,22)', v7.modules[22]?.[21], false);
check('alinhamento v7: anel escuro em (20,22)', v7.modules[22]?.[20], true);

// Nenhum módulo pode ficar por decidir: `encodeQr` devolve sempre um valor booleano, e uma
// matriz com módulos indefinidos produziria um código com buracos.
let undecided = 0;
for (const row of probe.modules) {
  for (const module of row) if (typeof module !== 'boolean') undecided += 1;
}
check('nenhum módulo indefinido', undecided, 0);

/* -------------------------------------------------------------------------- */
/* 7. Escolha automática de versão e limite explícito                          */
/* -------------------------------------------------------------------------- */

check('17 bytes no nível L → versão 1', encodeQr('z'.repeat(17), { level: 'L' }).version, 1);
check('18 bytes no nível L → versão 2', encodeQr('z'.repeat(18), { level: 'L' }).version, 2);
check('15 bytes no nível H → versão 3', encodeQr('z'.repeat(15), { level: 'H' }).version, 3);
check(
  '255 bytes no nível L → versão 10 (contagem de 16 bits)',
  encodeQr('z'.repeat(255), { level: 'L' }).version,
  10,
);

let refused = false;
try {
  encodeQr('z'.repeat(272), { level: 'L' });
} catch {
  refused = true;
}
check('272 bytes no nível L são recusados com erro explícito', refused, true);

/* -------------------------------------------------------------------------- */
/* 8. SVG                                                                      */
/* -------------------------------------------------------------------------- */

const markup = qrToSvgMarkup(probe, { moduleSize: 4, quietZone: 4 });
const side = (probe.size + 8) * 4;
check('SVG com zona de silêncio', markup.includes(`width="${side}" height="${side}"`), true);
check('SVG sem elementos de texto', markup.includes('<text'), false);
check('SVG com fundo branco (não inverte com o tema)', markup.includes('fill="#ffffff"'), true);

console.log(failures === 0 ? '\nTodos os testes passaram.' : `\n${failures} teste(s) falharam.`);
process.exitCode = failures === 0 ? 0 : 1;
