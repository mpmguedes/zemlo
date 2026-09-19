import { describe, expect, it } from 'vitest';
import { decodeWindows1252, detectEncoding, hasUtf8Bom, inspectUtf8 } from '../src/domain/import/csv/encoding.js';
import {
  CSV_DELIMITERS,
  detectDelimiter,
  looksNumeric,
  parseCsv,
  type CsvDelimiter,
} from '../src/domain/import/csv/parse.js';

/** Codifica texto em UTF-8 sem BOM. */
function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Codifica texto em UTF-8 com BOM. */
function utf8Bom(text: string): Uint8Array {
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(body.length + 3);
  out[0] = 0xef;
  out[1] = 0xbb;
  out[2] = 0xbf;
  out.set(body, 3);
  return out;
}

/**
 * Codifica texto em Windows-1252 usando a tabela inversa da norma.
 * Assim os testes produzem bytes reais de Excel português, não aproximações.
 */
function cp1252(text: string): Uint8Array {
  const inverse: Record<string, number> = {
    '\u20ac': 0x80,
    '\u201a': 0x82,
    '\u0192': 0x83,
    '\u201e': 0x84,
    '\u2026': 0x85,
    '\u2020': 0x86,
    '\u2021': 0x87,
    '\u02c6': 0x88,
    '\u2030': 0x89,
    '\u0160': 0x8a,
    '\u2039': 0x8b,
    '\u0152': 0x8c,
    '\u017d': 0x8e,
    '\u2018': 0x91,
    '\u2019': 0x92,
    '\u201c': 0x93,
    '\u201d': 0x94,
    '\u2022': 0x95,
    '\u2013': 0x96,
    '\u2014': 0x97,
    '\u02dc': 0x98,
    '\u2122': 0x99,
    '\u0161': 0x9a,
    '\u203a': 0x9b,
    '\u0153': 0x9c,
    '\u017e': 0x9e,
    '\u0178': 0x9f,
  };
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) as number;
    if (code <= 0x7f || (code >= 0xa0 && code <= 0xff)) {
      bytes.push(code);
    } else if (inverse[ch] !== undefined) {
      bytes.push(inverse[ch] as number);
    } else {
      throw new Error(`Carater não representável em Windows-1252: ${ch}`);
    }
  }
  return new Uint8Array(bytes);
}

describe('encoding — deteção', () => {
  it('deteta UTF-8 com BOM e remove a marca', () => {
    const result = detectEncoding(utf8Bom('Data;Valor\n2026-01-01;10\n'));
    expect(result.encoding).toBe('utf-8-bom');
    expect(result.text.startsWith('Data;')).toBe(true);
    expect(result.text.includes('\uFEFF')).toBe(false);
    expect(result.confidence).toBe(1);
    expect(result.uncertain).toBe(false);
  });

  it('deteta UTF-8 sem BOM quando há acentos válidos', () => {
    const result = detectEncoding(utf8('Fornecedor;Descrição\nGalp;Revisão geral\n'));
    expect(result.encoding).toBe('utf-8');
    expect(result.text).toContain('Descrição');
    expect(result.text).toContain('Revisão');
    expect(result.uncertain).toBe(false);
  });

  it('assinala incerteza quando o ficheiro é apenas ASCII', () => {
    const result = detectEncoding(utf8('Data;Valor\n2026-01-01;10\n'));
    expect(result.encoding).toBe('utf-8');
    expect(result.uncertain).toBe(true);
    expect(result.reason).toMatch(/ASCII/i);
  });

  it('deteta CP1252 quando os bytes são inválidos em UTF-8', () => {
    const bytes = cp1252('Descrição;Valor (€)\nRevisão;12,50\n');
    const result = detectEncoding(bytes);
    expect(result.encoding).toBe('windows-1252');
    expect(result.text).toContain('Descrição');
    expect(result.text).toContain('Valor (€)');
    expect(result.text).toContain('Revisão');
    expect(result.uncertain).toBe(false);
  });

  it('descodifica a faixa 0x80..0x9F como pontuação, não como controlos', () => {
    // O euro é 0x80 em CP1252 mas um caráter de controlo C1 em ISO-8859-1 puro.
    expect(decodeWindows1252(new Uint8Array([0x80]))).toBe('€');
    // 0x93/0x94 são as aspas tipográficas “ ”, distinta das aspas retas.
    expect(decodeWindows1252(new Uint8Array([0x93, 0x94]))).toBe('\u201C\u201D');
    expect(decodeWindows1252(new Uint8Array([0x96, 0x97]))).toBe('\u2013\u2014');
    expect(decodeWindows1252(new Uint8Array([0xe7, 0xe3]))).toBe('çã');
  });

  it('preserva acentos portugueses maiúsculos e minúsculos', () => {
    const bytes = cp1252('ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç');
    expect(decodeWindows1252(bytes)).toBe('ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç');
  });

  it('reconhece BOM UTF-8 apenas nos primeiros três bytes', () => {
    expect(hasUtf8Bom(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe(true);
    expect(hasUtf8Bom(new Uint8Array([0x41, 0xef, 0xbb]))).toBe(false);
    expect(hasUtf8Bom(new Uint8Array([0xef, 0xbb]))).toBe(false);
  });

  it('conta sequências de substituição sem rebentar', () => {
    const mixed = new Uint8Array([0x41, 0xff, 0x42]);
    const result = inspectUtf8(mixed);
    expect(result.valid).toBe(false);
    expect(result.replacementCount).toBeGreaterThan(0);
  });

  it('aceita UTF-8 de 4 bytes (emoji) como válido', () => {
    const result = inspectUtf8(utf8('Notas;🚗\n'));
    expect(result.valid).toBe(true);
  });
});

describe('separador — deteção estrutural', () => {
  it('deteta ponto e vírgula com decimais de vírgula (caso português)', () => {
    const text = [
      'Matrícula;Data;Valor',
      'AA-00-AA;2026-01-01;1.234,56',
      'BB-11-BB;2026-01-02;12,50',
      'CC-22-CC;2026-01-03;99,90',
    ].join('\n');
    const result = detectDelimiter(text);
    expect(result.delimiter).toBe(';');
    expect(result.uncertain).toBe(false);
    expect(result.reason).toMatch(/Ponto e vírgula/);
  });

  it('deteta vírgula quando é o separador real, apesar de pontos decimais', () => {
    const text = ['Plate,Date,Amount', 'AA-00-AA,2026-01-01,1234.56', 'BB-11-BB,2026-01-02,12.50'].join('\n');
    const result = detectDelimiter(text);
    expect(result.delimiter).toBe(',');
  });

  it('deteta tabulação', () => {
    const text = ['Matrícula\tData\tValor', 'AA-00-AA\t2026-01-01\t10,00', 'BB-11-BB\t2026-01-02\t20,00'].join('\n');
    const result = detectDelimiter(text);
    expect(result.delimiter).toBe('\t');
  });

  it('não se deixa enganar por vírgulas dentro de texto com separador ;', () => {
    const text = [
      'Matrícula;Descrição;Valor',
      'AA-00-AA;"Rua do Comércio, 12, 3.º";10,00',
      'BB-11-BB;"Oficina Silva, Lda, Lisboa";20,00',
      'CC-22-CC;"Peças, mão de obra e IVA";30,00',
    ].join('\n');
    const result = detectDelimiter(text);
    expect(result.delimiter).toBe(';');
    expect(result.consistency).toBe(1);
  });

  it('assinala incerteza quando dois separadores produzem a mesma estrutura', () => {
    const text = ['A;B\tC', '1;2\t3', '4;5\t6'].join('\n');
    const result = detectDelimiter(text);
    expect(result.uncertain).toBe(true);
    expect(result.reason).toMatch(/confirmação/i);
  });

  it('sinaliza ficheiro de coluna única', () => {
    const text = ['Matrícula', 'AA-00-AA', 'BB-11-BB'].join('\n');
    const result = detectDelimiter(text);
    expect(result.uncertain).toBe(true);
    expect(result.reason).toMatch(/única coluna/i);
  });

  it('mede a consistência estrutural, não a frequência bruta dos caracteres', () => {
    // Este é o caso real que motiva a heurística: um ficheiro com 4 colunas
    // (3 separadores ';') mas 3 colunas decimais com vírgula por linha. Contar
    // caracteres escolheria ',' — errado — porque há mais vírgulas do que ';'
    // assim que o ficheiro tenha linhas de dados suficientes.
    const text = [
      'Data;Valor;Quantidade;Preço',
      '2026-01-01;1.234,56;2,5;493,82',
      '2026-01-02;2.345,67;3,5;670,19',
      '2026-01-03;3.456,78;4,5;768,17',
      '2026-01-04;4.567,89;5,5;830,52',
      '2026-01-05;5.678,90;6,5;873,68',
      '2026-01-06;6.789,01;7,5;905,20',
    ].join('\n');
    const result = detectDelimiter(text);
    // A contagem bruta de vírgulas aproxima-se da de pontos e vírgulas — e,
    // com mais linhas de dados, ultrapassá-la-ia. Não distingue nada.
    expect(result.counts[',']).toBe(18);
    expect(result.counts[';']).toBe(21);
    // Só a consistência estrutural decide corretamente: ';' produz 4 campos
    // estáveis em todas as linhas; ',' produz contagens erráticas porque os
    // decimais variam entre 1 e 2 casas.
    expect(result.delimiter).toBe(';');
    expect(result.consistency).toBe(1);
  });
});

describe('parser — estrutura RFC 4180', () => {
  it('analisa um CSV simples com cabeçalho', () => {
    const table = parseCsv(utf8('Data;Valor\n2026-01-01;10,00\n2026-01-02;20,00\n'));
    expect(table.delimiter).toBe(';');
    expect(table.hasHeader).toBe(true);
    expect(table.headers).toEqual(['Data', 'Valor']);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]?.values).toEqual(['2026-01-01', '10,00']);
    expect(table.rows[0]?.line).toBe(2);
    expect(table.rows[1]?.line).toBe(3);
  });

  it('mantém separadores dentro de campos entre aspas', () => {
    const table = parseCsv(utf8('Nome;Descrição\nGalp;"Combustível, gasóleo, 45 L"\n'));
    expect(table.rows[0]?.values).toEqual(['Galp', 'Combustível, gasóleo, 45 L']);
  });

  it('interpreta aspas escapadas como um único caráter de aspas', () => {
    const table = parseCsv(utf8('Nome;Nota\nX;"Ele disse ""olá"" hoje"\n'));
    expect(table.rows[0]?.values[1]).toBe('Ele disse "olá" hoje');
  });

  it('aceita quebras de linha dentro de campos entre aspas', () => {
    const table = parseCsv(utf8('Nome;Nota\nX;"linha 1\nlinha 2"\n'));
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]?.values[1]).toBe('linha 1\nlinha 2');
    // A linha física seguinte conta, mas pertence ao mesmo registo.
    expect(table.rows[0]?.line).toBe(2);
  });

  it('trata CRLF e LF no mesmo ficheiro', () => {
    const table = parseCsv(utf8('Data;Valor\r\n2026-01-01;10\r\n2026-01-02;20\n'));
    expect(table.rows).toHaveLength(2);
    expect(table.rows[1]?.values).toEqual(['2026-01-02', '20']);
  });

  it('trata CR isolado (clássico Mac)', () => {
    const table = parseCsv(utf8('Data;Valor\r2026-01-01;10\r2026-01-02;20\r'));
    expect(table.rows).toHaveLength(2);
  });

  it('ignora linhas totalmente vazias', () => {
    const table = parseCsv(utf8('Data;Valor\n2026-01-01;10\n\n2026-01-02;20\n\n'));
    expect(table.rows).toHaveLength(2);
  });

  it('preserva campos vazios no meio da linha', () => {
    const table = parseCsv(utf8('A;B;C\n1;;3\n'));
    expect(table.rows[0]?.values).toEqual(['1', '', '3']);
  });

  it('preenche linhas curtas e registra o diagnóstico', () => {
    const table = parseCsv(utf8('A;B;C\n1;2\n'));
    expect(table.rows[0]?.values).toEqual(['1', '2', '']);
    expect(table.rows[0]?.padded).toBe(true);
    const issue = table.issues.find((i) => i.code === 'linha-irregular');
    expect(issue?.line).toBe(2);
    expect(issue?.message).toContain('2');
    expect(issue?.message).toContain('3');
  });

  it('trunca linhas longas e registra o diagnóstico', () => {
    const table = parseCsv(utf8('A;B\n1;2;3\n'));
    expect(table.rows[0]?.values).toEqual(['1', '2']);
    expect(table.issues.some((i) => i.code === 'linha-irregular')).toBe(true);
  });

  it('reporta aspas de abertura que nunca fecham', () => {
    const table = parseCsv(utf8('A;B\n1;"sem fim\n'));
    expect(table.issues.some((i) => i.code === 'aspas-nao-fechadas')).toBe(true);
  });

  it('aceita aspas literais no meio de um campo (polegadas)', () => {
    const table = parseCsv(utf8('Peça;Nota\nPneu;aro 17"\n'));
    expect(table.rows[0]?.values[1]).toBe('aro 17"');
    expect(table.issues.some((i) => i.code === 'aspas-nao-fechadas')).toBe(false);
  });

  it('preserva acentos portugueses de ponta a ponta em CP1252', () => {
    const table = parseCsv(cp1252('Descrição;Categoria\nRevisão geral;Manutenção\n'));
    expect(table.encoding).toBe('windows-1252');
    expect(table.headers).toEqual(['Descrição', 'Categoria']);
    expect(table.rows[0]?.values).toEqual(['Revisão geral', 'Manutenção']);
  });

  it('trata ficheiro vazio', () => {
    const table = parseCsv(new Uint8Array());
    expect(table.rows).toEqual([]);
    expect(table.headers).toEqual([]);
    expect(table.issues.some((i) => i.code === 'ficheiro-vazio')).toBe(true);
  });

  it('trata ficheiro só com cabeçalho', () => {
    const table = parseCsv(utf8('Data;Valor\n'));
    expect(table.headers).toEqual(['Data', 'Valor']);
    expect(table.rows).toEqual([]);
    expect(table.issues.some((i) => i.code === 'ficheiro-vazio')).toBe(true);
  });

  it('trata ficheiro com apenas uma linha de dados', () => {
    const table = parseCsv(utf8('A;B\n1;2\n'));
    expect(table.rows).toHaveLength(1);
  });

  it('não perde a última linha sem quebra final', () => {
    const table = parseCsv(utf8('A;B\n1;2'));
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]?.values).toEqual(['1', '2']);
  });

  it('gera nomes de coluna quando não há cabeçalho', () => {
    const table = parseCsv(utf8('1;2;3\n4;5;6\n'), { hasHeader: false });
    expect(table.hasHeader).toBe(false);
    expect(table.headers).toEqual(['Coluna 1', 'Coluna 2', 'Coluna 3']);
    expect(table.rows).toHaveLength(2);
  });

  it('respeita um separador forçado pelo utilizador', () => {
    const table = parseCsv(utf8('A,B\n1,2\n'), { delimiter: ',' });
    expect(table.delimiter).toBe(',');
    expect(table.headers).toEqual(['A', 'B']);
    expect(table.delimiterConfidence).toBe(1);
  });

  it('respeita uma codificação forçada pelo utilizador', () => {
    // Bytes CP1252 forçados como windows-1252 continuam legíveis.
    const table = parseCsv(cp1252('Descrição;Valor\nRevisão;1\n'), { encoding: 'windows-1252' });
    expect(table.encoding).toBe('windows-1252');
    expect(table.headers[0]).toBe('Descrição');
  });

  it('desambigua cabeçalhos duplicados sem perder o primeiro', () => {
    const table = parseCsv(utf8('Valor;Valor;Notas\n1;2;3\n'));
    expect(table.headers).toEqual(['Valor', 'Valor (2)', 'Notas']);
    expect(table.issues.some((i) => i.code === 'cabecalho-duplicado')).toBe(true);
  });

  it('preserva cabeçalhos vazios em vez de inventar um nome', () => {
    const table = parseCsv(utf8('Data;;Valor\n1;2;3\n'));
    // O cabeçalho vazio fica vazio: é informação real do ficheiro e o mapeador
    // precisa dela para explicar ao utilizador que a coluna não tem título.
    expect(table.headers).toEqual(['Data', '', 'Valor']);
  });

  it('conta as linhas físicas do ficheiro', () => {
    const table = parseCsv(utf8('A;B\n1;2\n3;4\n'));
    expect(table.physicalLineCount).toBe(3);
  });

  it('limita o número de linhas quando pedido (preview)', () => {
    const lines = ['A;B'];
    for (let i = 0; i < 100; i += 1) lines.push(`${i};${i * 2}`);
    const table = parseCsv(utf8(`${lines.join('\n')}\n`), { maxRows: 20 });
    expect(table.rows).toHaveLength(20);
  });

  it('é determinístico: a mesma entrada produz a mesma saída', () => {
    const bytes = cp1252('Matrícula;Descrição\nAA-00-AA;"Rua, 12"\n');
    expect(parseCsv(bytes)).toEqual(parseCsv(bytes));
  });

  it('suporta um ficheiro grande sem degradação quadrática', () => {
    const lines = ['Matrícula;Data;Valor'];
    for (let i = 0; i < 20000; i += 1) lines.push(`AA-${i}-AA;2026-01-01;10,00`);
    const started = Date.now();
    const table = parseCsv(utf8(`${lines.join('\n')}\n`));
    const elapsed = Date.now() - started;
    expect(table.rows).toHaveLength(20000);
    expect(elapsed).toBeLessThan(5000);
  });
});

describe('separadores suportados', () => {
  it('declara exatamente ; , e tab', () => {
    expect([...CSV_DELIMITERS]).toEqual([';', ',', '\t']);
  });

  it('analisa corretamente todos os separadores declarados', () => {
    for (const d of CSV_DELIMITERS as readonly CsvDelimiter[]) {
      const table = parseCsv(utf8(`A${d}B\n1${d}2\n`));
      expect(table.delimiter).toBe(d);
      expect(table.headers).toEqual(['A', 'B']);
    }
  });
});

describe('heurística numérica', () => {
  it('aceita números e datas portuguesas', () => {
    expect(looksNumeric('1.234,56')).toBe(true);
    expect(looksNumeric('12,50')).toBe(true);
    expect(looksNumeric('12.50')).toBe(true);
    expect(looksNumeric('100 €')).toBe(true);
    expect(looksNumeric('50%')).toBe(true);
    expect(looksNumeric('2026-01-01')).toBe(true);
    expect(looksNumeric('03/04/2026')).toBe(true);
    expect(looksNumeric('-45,20')).toBe(true);
  });

  it('rejeita texto', () => {
    expect(looksNumeric('Galp')).toBe(false);
    expect(looksNumeric('Revisão geral')).toBe(false);
    expect(looksNumeric('')).toBe(false);
    expect(looksNumeric('AA-00-AA')).toBe(false);
  });
});
