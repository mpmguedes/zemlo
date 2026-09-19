/**
 * Deteção e descodificação de codificação de ficheiros CSV (§10.2, §10.3).
 *
 * Este módulo é **puro**: não toca em disco, rede, base de dados nem relógio.
 * Recebe bytes e devolve texto + metadados sobre o que foi detetado e porquê.
 *
 * Codificações suportadas (§10.2):
 *  - UTF-8 com BOM  (Excel moderno, export do Zemlo)
 *  - UTF-8 sem BOM  (export do Zemlo, editores de texto)
 *  - CP1252 / Windows-1252 (Excel em português, o caso mais comum em Portugal)
 *  - fallback latin1 (CP1252 é um superconjunto prático; 0x80..0x9F são específicos)
 *
 * Porque não usamos `Buffer.toString('latin1')` como solução para CP1252:
 * o Node implementa latin1 como ISO-8859-1 puro, onde os bytes 0x80..0x9F são
 * caracteres de controlo C1. O Windows-1252 usa essa faixa para pontuação
 * tipográfica (€ ‘ ’ “ ” – —) que aparece frequentemente em ficheiros
 * exportados do Excel português. Sem a tabela abaixo, "Valor (€)" chegaria
 * corrompido.
 *
 * Não adicionamos qualquer dependência: a tabela CP1252 é pequena e fechada,
 * e a heurística de deteção precisa de ser explícita e testável.
 */

/** Codificações que este módulo consegue detetar. */
export const CSV_ENCODINGS = ['utf-8-bom', 'utf-8', 'windows-1252'] as const;
export type CsvEncoding = (typeof CSV_ENCODINGS)[number];

/**
 * Tabela de mapeamento do Windows-1252 para os pontos de código Unicode.
 * Só a faixa 0x80..0x9F difere do ISO-8859-1; todos os outros bytes são
 * idênticos e por isso são mapeados diretamente para o mesmo code point.
 *
 * Valores `undefined` são posições não atribuídas na norma; mapeamos para o
 * próprio code point de controlo (comportamento do WHATWG encoding standard
 * para estas posições é devolver o índice, que é o que fazemos por omissão).
 */
const CP1252_HIGH: Readonly<Record<number, string>> = {
  0x80: '\u20AC', // € EURO SIGN
  0x82: '\u201A', // ‚ SINGLE LOW-9 QUOTATION MARK
  0x83: '\u0192', // ƒ LATIN SMALL LETTER F WITH HOOK
  0x84: '\u201E', // „ DOUBLE LOW-9 QUOTATION MARK
  0x85: '\u2026', // … HORIZONTAL ELLIPSIS
  0x86: '\u2020', // † DAGGER
  0x87: '\u2021', // ‡ DOUBLE DAGGER
  0x88: '\u02C6', // ˆ MODIFIER LETTER CIRCUMFLEX ACCENT
  0x89: '\u2030', // ‰ PER MILLE SIGN
  0x8A: '\u0160', // Š LATIN CAPITAL LETTER S WITH CARON
  0x8B: '\u2039', // ‹ SINGLE LEFT-POINTING ANGLE QUOTATION MARK
  0x8C: '\u0152', // Œ LATIN CAPITAL LIGATURE OE
  0x8E: '\u017D', // Ž LATIN CAPITAL LETTER Z WITH CARON
  0x91: '\u2018', // ' LEFT SINGLE QUOTATION MARK
  0x92: '\u2019', // ' RIGHT SINGLE QUOTATION MARK
  0x93: '\u201C', // " LEFT DOUBLE QUOTATION MARK
  0x94: '\u201D', // " RIGHT DOUBLE QUOTATION MARK
  0x95: '\u2022', // • BULLET
  0x96: '\u2013', // – EN DASH
  0x97: '\u2014', // — EM DASH
  0x98: '\u02DC', // ˜ SMALL TILDE
  0x99: '\u2122', // ™ TRADE MARK SIGN
  0x9A: '\u0161', // š LATIN SMALL LETTER S WITH CARON
  0x9B: '\u203A', // › SINGLE RIGHT-POINTING ANGLE QUOTATION MARK
  0x9C: '\u0153', // œ LATIN SMALL LIGATURE OE
  0x9E: '\u017E', // ž LATIN SMALL LETTER Z WITH CARON
  0x9F: '\u0178', // Ÿ LATIN CAPITAL LETTER Y WITH DIAERESIS
};

/** Descodifica um buffer Windows-1252 (com fallback latin1 fora da faixa alta). */
export function decodeWindows1252(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    if (byte < 0x80 || byte >= 0xa0) {
      out += String.fromCharCode(byte);
    } else {
      out += CP1252_HIGH[byte] ?? String.fromCharCode(byte);
    }
  }
  return out;
}

/** Bytes da assinatura BOM UTF-8. */
const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;

/** True se os primeiros três bytes forem o BOM UTF-8. */
export function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === UTF8_BOM[0] && bytes[1] === UTF8_BOM[1] && bytes[2] === UTF8_BOM[2];
}

/**
 * Validação estrita de UTF-8 sobre os bytes.
 *
 * Não usamos `TextDecoder('utf-8', { fatal: true })` sozinho como decisão final
 * porque queremos também medir *quantos* pontos de substituição apareceriam;
 * essa métrica é o sinal mais fiável para distinguir CP1252 de UTF-8 mal
 * formado. Implementamos a validação manualmente para conseguir essa contagem
 * sem tentar descodificar duas vezes.
 *
 * Devolve `{ valid, replacementCount }` onde `replacementCount` é o número de
 * sequências que seriam substituídas por U+FFFD (assumindo três bytes de
 * avanço, o mesmo comportamento do WHATWG).
 */
export function inspectUtf8(bytes: Uint8Array): { valid: boolean; replacementCount: number } {
  let i = 0;
  let replacements = 0;
  const len = bytes.length;

  while (i < len) {
    const b0 = bytes[i] as number;

    if (b0 <= 0x7f) {
      i += 1;
      continue;
    }

    let needed: number;
    let min: number;
    let codePoint: number;

    if (b0 >= 0xc2 && b0 <= 0xdf) {
      needed = 1;
      min = 0x80;
      codePoint = b0 & 0x1f;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      needed = 2;
      min = 0x800;
      codePoint = b0 & 0x0f;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      needed = 3;
      min = 0x10000;
      codePoint = b0 & 0x07;
    } else {
      // 0x80..0xC1 e 0xF5..0xFF nunca são início válido em UTF-8.
      replacements += 1;
      i += 1;
      continue;
    }

    if (i + needed >= len + 0 && i + needed > len - 1) {
      replacements += 1;
      i += 1;
      continue;
    }

    let ok = true;
    for (let k = 1; k <= needed; k += 1) {
      const bk = bytes[i + k] as number;
      if (bk < 0x80 || bk > 0xbf) {
        ok = false;
        break;
      }
      codePoint = (codePoint << 6) | (bk & 0x3f);
    }

    if (!ok || codePoint < min || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      replacements += 1;
      i += 1;
      continue;
    }

    i += needed + 1;
  }

  return { valid: replacements === 0, replacementCount: replacements };
}

/** Resultado da deteção de codificação. */
export interface EncodingDetection {
  /** Codificação escolhida. */
  readonly encoding: CsvEncoding;
  /** Texto já descodificado e sem BOM. */
  readonly text: string;
  /** Confiança da decisão (0..1). */
  readonly confidence: number;
  /** True quando a decisão foi tomada por heurística e não por evidência forte. */
  readonly uncertain: boolean;
  /** Motivo legível da decisão (para apresentar na UI e nos relatórios). */
  readonly reason: string;
}

/**
 * Deteta a codificação e devolve o texto descodificado.
 *
 * Ordem de decisão:
 *  1. BOM UTF-8 → `utf-8-bom` (evidência forte, confiança 1).
 *  2. UTF-8 válido → `utf-8` (confiança 0.95).
 *  3. UTF-8 inválido → `windows-1252` (é o que o Excel português produz).
 *
 * Nota deliberada: CP1252 e UTF-8 concordam em todo o ASCII, portanto um
 * ficheiro CP1252 que só contenha ASCII é indistinguível de UTF-8. Nesse caso
 * escolhemos `utf-8`, que produz o mesmo texto — a escolha é irrelevante e
 * marcamos `uncertain: true` para que a UI possa dizê-lo.
 */
export function detectEncoding(bytes: Uint8Array): EncodingDetection {
  if (hasUtf8Bom(bytes)) {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(3));
    return {
      encoding: 'utf-8-bom',
      text,
      confidence: 1,
      uncertain: false,
      reason: 'Ficheiro começa com a marca de ordem de bytes (BOM) UTF-8.',
    };
  }

  const inspection = inspectUtf8(bytes);

  if (inspection.valid) {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const onlyAscii = bytes.every((b) => b < 0x80);
    return {
      encoding: 'utf-8',
      text,
      confidence: onlyAscii ? 0.6 : 0.95,
      uncertain: onlyAscii,
      reason: onlyAscii
        ? 'Apenas carateres ASCII: UTF-8 e Windows-1252 produzem o mesmo resultado.'
        : 'Sequências de bytes válidas em UTF-8.',
    };
  }

  return {
    encoding: 'windows-1252',
    text: decodeWindows1252(bytes),
    confidence: 0.9,
    uncertain: false,
    reason: `Bytes inválidos em UTF-8 (${inspection.replacementCount} sequência(s)); interpretado como Windows-1252, típico do Excel em português.`,
  };
}
