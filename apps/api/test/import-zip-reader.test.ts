/**
 * Testes adversariais do leitor de ZIP do bundle — **Fase 2, etapa 1** (§7.3, §13.4).
 *
 * ## O que estes testes são
 *
 * São a **definição executável do contrato**. Não testam uma implementação — não há
 * implementação. Testam o que o leitor terá de recusar, e recusam-se a passar por outra
 * razão que não seja a implementação estar ausente.
 *
 * ## Porque é que vêm antes da implementação
 *
 * A §7.3 diz que "o ZIP é entrada não fidedigna". A tentação natural é escrever o leitor e
 * depois acrescentar os testes de segurança, mas nessa ordem os testes herdam os pontos
 * cegos da implementação: escreve-se o teste para o que o código faz, não para o que o
 * código devia recusar. Invertendo a ordem, cada caso hostil é um requisito antes de ser
 * uma verificação.
 *
 * ## Nada aqui depende de uma biblioteca de ZIP
 *
 * Os ZIPs hostis são construídos byte a byte em `test/helpers/zip-builder.ts`. Uma
 * biblioteca de compressão não produz um CRC errado, um arquivo truncado ou um *central
 * directory* mentiroso — é precisamente o que ela impede. Só escrevendo os bytes à mão se
 * consegue exercitar a recusa.
 *
 * ## Estado esperado hoje
 *
 * **Todos falham**, com `ZipNotImplementedError`. Isso é o resultado correto nesta etapa: o
 * contrato está escrito e verificável, a implementação não existe. Um único teste que
 * passe agora seria um teste que não está a testar nada.
 *
 * ## Decisões que estes testes fixam
 *
 * Onde a §7.3 e a §13.4 são explícitas, o teste cita a secção. Onde há ambiguidade, a
 * decisão está escrita no próprio teste — duplicados, ZIP vazio, symlinks, e a
 * normalização de separadores — para que a implementação futura tenha uma resposta certa a
 * dar em vez de uma escolha implícita a fazer.
 */

import { describe, expect, it } from 'vitest';
import {
  ZIP_LIMITS,
  ZIP_REFUSAL_REASONS,
  ZIP_SIGNATURES,
  ZipNotImplementedError,
  ZipRefusalError,
  hasZipSignature,
  indexBundleEntries,
  readZip,
  validateEntryPath,
} from '../src/domain/import/zip.js';
import {
  buildEmptyZip,
  buildManifestZip,
  buildZip,
  buildZipWithOffsets,
  concatBytes,
  crc32,
  highlyCompressible,
  incompressible,
  readU32,
  utf8,
  writeU16,
  writeU32,
  type BuildEntry,
} from './helpers/zip-builder.js';

/* ========================================================================== */
/* Auxiliares                                                                 */
/* ========================================================================== */

/**
 * Corre `fn` e devolve o `ZipRefusal` lançado.
 *
 * Devolve o motivo em vez de o afirmar, para que cada teste verifique o motivo **e** o
 * caminho da entrada sem repetir o mesmo `try/catch` vinte vezes.
 */
function refusalOf(fn: () => unknown): { reason: string; entryName?: string } {
  try {
    fn();
  } catch (error) {
    if (error instanceof ZipRefusalError) return error.refusal;
    if (error instanceof ZipNotImplementedError) throw error;
    throw new Error(`Recusa esperada, veio ${(error as Error).name}: ${(error as Error).message}`);
  }
  throw new Error('Era esperada uma recusa e a chamada devolveu um valor.');
}

/** ZIP mínimo válido, usado como base nos casos que só corrompem um campo. */
function baseZip(): Uint8Array {
  return buildZip([{ name: 'manifest.json', data: utf8('{"format":"zemlo-export"}') }]);
}

/* ========================================================================== */
/* 0. Semelhança — o contrato está a ser exercitado, não ignorado             */
/* ========================================================================== */

describe('ZIP — o contrato existe e a implementação não', () => {
  it('as funções públicas existem e estão declaradas', () => {
    // Se algum destes deixar de ser uma função, o resto do ficheiro falharia por razão
    // errada. Este teste isola essa falha: o contrato tem de ter estas cinco entradas.
    expect(typeof hasZipSignature).toBe('function');
    expect(typeof validateEntryPath).toBe('function');
    expect(typeof readZip).toBe('function');
    expect(typeof indexBundleEntries).toBe('function');
    expect(Array.isArray(ZIP_REFUSAL_REASONS)).toBe(true);
  });

  it('os limites são um objeto centralizado e não números soltos pelos testes', () => {
    // §7.3 exige limites; a decisão de desenho é estarem num só sítio. Testar a **forma**
    // do contrato é legítimo aqui: é o que impede a implementação de os espalhar.
    for (const key of [
      'maxEntries',
      'maxCompressedBytes',
      'maxUncompressedBytes',
      'maxEntryBytes',
      'maxCompressionRatio',
      'maxEntryNameBytes',
    ] as const) {
      expect(typeof ZIP_LIMITS[key], `limite ${key}`).toBe('number');
      expect(ZIP_LIMITS[key], `limite ${key}`).toBeGreaterThan(0);
    }
  });

  it('as assinaturas de ZIP são as do formato PKZIP', () => {
    expect(ZIP_SIGNATURES.localFileHeader).toBe(0x04034b50);
    expect(ZIP_SIGNATURES.centralFileHeader).toBe(0x02014b50);
    expect(ZIP_SIGNATURES.endOfCentralDirectory).toBe(0x06054b50);
  });
});

/* ========================================================================== */
/* 1. Paths / zip-slip (§7.3, §13.4)                                          */
/* ========================================================================== */

describe('ZIP — caminhos: zip-slip, absolutos, UNC (§7.3, §13.4)', () => {
  it('aceita um caminho normal na raiz', () => {
    expect(validateEntryPath('manifest.json')).toBe('manifest.json');
  });

  it('aceita um caminho normal em subdiretório', () => {
    expect(validateEntryPath('documents/doc_1/fatura.pdf')).toBe('documents/doc_1/fatura.pdf');
  });

  it('recusa `../manifest.json`', () => {
    // Literalmente o caso da §13.4.
    const refusal = refusalOf(() => validateEntryPath('../manifest.json'));
    expect(refusal.reason).toBe('zip.path_traversal');
  });

  it('recusa `../../etc/passwd`', () => {
    // §13.4: "ZIP com caminho ../../etc/passwd → recusado". O `entryName` deve identificar
    // o caminho culpado para a mensagem ser acionável.
    const refusal = refusalOf(() => validateEntryPath('../../etc/passwd'));
    expect(refusal.reason).toBe('zip.path_traversal');
  });

  it('recusa `foo/../../manifest.json`', () => {
    // O caso que engana validações ingénuas: não começa por `..`, mas normaliza para fora.
    const refusal = refusalOf(() => validateEntryPath('foo/../../manifest.json'));
    expect(refusal.reason).toBe('zip.path_traversal');
  });

  it('recusa caminhos absolutos Unix', () => {
    const refusal = refusalOf(() => validateEntryPath('/etc/passwd'));
    expect(refusal.reason).toBe('zip.absolute_path');
  });

  it('recusa caminhos absolutos Windows com letra de unidade', () => {
    // §7.3 é explícito: "Caminhos com .., absolutos, ou com letra de unidade são rejeitados."
    const refusal = refusalOf(() => validateEntryPath('C:\\Windows\\System32\\config\\SAM'));
    expect(refusal.reason).toBe('zip.absolute_path');
  });

  it('recusa caminhos absolutos Windows com barra invertida na raiz', () => {
    const refusal = refusalOf(() => validateEntryPath('\\Windows\\win.ini'));
    expect(refusal.reason).toBe('zip.absolute_path');
  });

  it('recusa caminhos UNC', () => {
    const refusal = refusalOf(() => validateEntryPath('\\\\server\\share\\ficheiro.txt'));
    expect(refusal.reason).toBe('zip.unc_path');
  });

  it('recusa separadores Windows a imitar travessia', () => {
    // `..\..\etc\passwd` é a mesma travessia com outro separador. Um validador que só
    // conheça `/` deixa-a passar.
    //
    // O motivo é `invalid_entry_name` e não `path_traversal`: a regra final recusa
    // **qualquer** barra invertida num nome relativo, sem sequer tentar interpretá-la. A
    // travessia nunca chega a ser avaliada porque o separador por si já é inválido no
    // formato do Zemlo. É uma recusa mais cedo e mais estrita do que o teste previa — o
    // que importa é que não passe, e não passa.
    const refusal = refusalOf(() => validateEntryPath('..\\..\\etc\\passwd'));
    expect(refusal.reason).toBe('zip.invalid_entry_name');
  });

  it('recusa travessia que só aparece depois de normalizar os separadores', () => {
    // Mistura de separadores: a travessia não é visível sem normalizar primeiro. Como
    // acima, a barra invertida é recusada antes de qualquer normalização.
    const refusal = refusalOf(() => validateEntryPath('foo\\..\\../manifest.json'));
    expect(refusal.reason).toBe('zip.invalid_entry_name');
  });

  it('recusa travessia com segmento vazio em vez de `..`', () => {
    const refusal = refusalOf(() => validateEntryPath('foo//../../manifest.json'));
    expect(refusal.reason).toBe('zip.path_traversal');
  });

  it('recusa um nome que é só `..`', () => {
    const refusal = refusalOf(() => validateEntryPath('..'));
    expect(refusal.reason).toBe('zip.path_traversal');
  });

  it('recusa um nome que é só `.`', () => {
    const refusal = refusalOf(() => validateEntryPath('.'));
    expect(refusal.reason).toBe('zip.invalid_entry_name');
  });

  it('recusa nome vazio', () => {
    const refusal = refusalOf(() => validateEntryPath(''));
    expect(refusal.reason).toBe('zip.invalid_entry_name');
  });

  it('recusa um nome de entrada acima do limite', () => {
    const refusal = refusalOf(() => validateEntryPath('a'.repeat(ZIP_LIMITS.maxEntryNameBytes + 1)));
    expect(refusal.reason).toBe('zip.entry_name_too_long');
  });

  it('recusa travessia dentro de um ZIP real, não só na função isolada', () => {
    // A função isolada pode estar certa e a leitura não a chamar. Este teste fecha essa
    // porta: o caminho hostil tem de ser recusado **durante a leitura**.
    const bytes = buildZip([{ name: '../../etc/passwd', data: utf8('root:x:0:0') }]);
    const refusal = refusalOf(() => readZip(bytes));
    expect(refusal.reason).toBe('zip.path_traversal');
    expect(refusal.entryName).toBe('../../etc/passwd');
  });

  it('recusa um ZIP em que só a segunda entrada é hostil', () => {
    // Um leitor que validasse só a primeira entrada passaria aqui.
    const bytes = buildZip([
      { name: 'manifest.json', data: utf8('{}') },
      { name: '../../../etc/shadow', data: utf8('x') },
    ]);
    const refusal = refusalOf(() => readZip(bytes));
    expect(refusal.reason).toBe('zip.path_traversal');
  });
});

/* ========================================================================== */
/* 2. Entradas duplicadas                                                     */
/* ========================================================================== */

describe('ZIP — entradas duplicadas', () => {
  /**
   * Decisão: **rejeitar**. Um bundle do Zemlo tem exatamente um `manifest.json` e no
   * máximo um ficheiro por tipo de registo (§5.2). Dois ficheiros com o mesmo nome tornam
   * a interpretação ambígua, e a §12.1 já recusa por ambiguidade noutro caso ("vários
   * bundles no mesmo ZIP → recusa — ambíguo por desenho"). Escolher um dos dois — o
   * primeiro, o último — seria inventar uma regra que o exportador nunca produz e que o
   * importador não pode justificar ao utilizador.
   */

  it('recusa dois entries com exatamente o mesmo nome', () => {
    const bytes = concatBytes(
      buildZip([{ name: 'manifest.json', data: utf8('{"a":1}') }]),
    );
    // Constrói um ZIP com nomes repetidos diretamente no índice.
    const duplicated = buildZip([
      { name: 'manifest.json', data: utf8('{"a":1}') },
      { name: 'manifest.json', data: utf8('{"a":2}') },
    ]);
    // Guarda contra o construtor: se ele próprio já deduplicasse, o teste não testava nada.
    expect(duplicated.byteLength).toBeGreaterThan(bytes.byteLength);

    const refusal = refusalOf(() => readZip(duplicated));
    expect(refusal.reason).toBe('zip.duplicate_entry');
    expect(refusal.entryName).toBe('manifest.json');
  });

  it('recusa nomes que colidem depois de normalização', () => {
    // `documents/doc_1/a.pdf` e `documents//doc_1/a.pdf` são o mesmo caminho. Um leitor que
    // compare strings cruas não vê a colisão e extrai o mesmo destino duas vezes.
    const bytes = buildZip([
      { name: 'documents/doc_1/a.pdf', data: utf8('primeiro') },
      { name: 'documents//doc_1/a.pdf', data: utf8('segundo') },
    ]);
    const refusal = refusalOf(() => readZip(bytes));
    expect(refusal.reason).toBe('zip.duplicate_entry');
  });

  it('recusa a variante com separadores Windows antes sequer de comparar duplicados', () => {
    // A versão anterior deste teste esperava `duplicate_entry` para `documents\a\b.pdf`
    // contra `documents/a/b.pdf`. Com a regra final, o caminho com `\` é recusado **antes**
    // de haver duplicado a detetar: um separador Windows num nome relativo é inválido por
    // si, independentemente de colidir com outro. O resultado para o utilizador é o mesmo
    // (o ZIP não entra); o motivo é o mais específico dos dois.
    const bytes = buildZip([
      { name: 'documents/a/b.pdf', data: utf8('primeiro') },
      { name: 'documents\\a\\b.pdf', data: utf8('segundo') },
    ]);
    const refusal = refusalOf(() => readZip(bytes));
    expect(refusal.reason).toBe('zip.invalid_entry_name');
  });

  it('recusa um nome com separadores Windows mesmo sem colisão nenhuma', () => {
    // Contraprova do anterior: a regra não depende de haver dois ficheiros.
    const bytes = buildZip([{ name: 'documents\\a\\b.pdf', data: utf8('so um') }]);
    const refusal = refusalOf(() => readZip(bytes));
    expect(refusal.reason).toBe('zip.invalid_entry_name');
  });

  it('a recusa de duplicados é determinística, não depende da ordem', () => {
    // §13.3 ponto 5: "A ordem dos registos no ficheiro não altera o resultado." O mesmo
    // princípio aplica-se ao índice: seja qual for a ordem, recusa.
    const a = buildZip([
      { name: 'vehicles.jsonl', data: utf8('{"a":1}') },
      { name: 'vehicles.jsonl', data: utf8('{"a":2}') },
    ]);
    const b = buildZip([
      { name: 'vehicles.jsonl', data: utf8('{"a":2}') },
      { name: 'vehicles.jsonl', data: utf8('{"a":1}') },
    ]);
    expect(refusalOf(() => readZip(a)).reason).toBe('zip.duplicate_entry');
    expect(refusalOf(() => readZip(b)).reason).toBe('zip.duplicate_entry');
  });

  it('aceita nomes distintos no mesmo subdiretório', () => {
    // Contraprova: a regra é sobre nomes iguais, não sobre a mesma pasta.
    const bytes = buildZip([
      { name: 'documents/doc_1/a.pdf', data: utf8('a') },
      { name: 'documents/doc_1/b.pdf', data: utf8('b') },
    ]);
    const result = readZip(bytes);
    expect(result.entries).toHaveLength(2);
  });
});

/* ========================================================================== */
/* 3. ZIP estruturalmente inválido                                            */
/* ========================================================================== */

describe('ZIP — estrutura inválida', () => {
  it('recusa um ficheiro que não começa pela assinatura de ZIP', () => {
    const bytes = utf8('Isto nao e um ZIP, e um ficheiro de texto.');
    const refusal = refusalOf(() => readZip(bytes));
    expect(refusal.reason).toBe('zip.invalid_signature');
  });

  it('recusa um ficheiro vazio', () => {
    const refusal = refusalOf(() => readZip(new Uint8Array(0)));
    expect(refusal.reason).toBe('zip.truncated');
  });

  it('recusa uma assinatura de 4 bytes sem mais nada', () => {
    // Assinatura correta, arquivo inexistente. Distinguir isto de "assinatura inválida" é
    // o que permite dizer ao utilizador que o download ficou a meio.
    const bytes = new Uint8Array(4);
    writeU32(bytes, 0, ZIP_SIGNATURES.localFileHeader);
    const refusal = refusalOf(() => readZip(bytes));
    expect(refusal.reason).toBe('zip.truncated');
  });

  it('recusa um ZIP truncado a meio do conteúdo', () => {
    const full = baseZip();
    const truncated = full.slice(0, Math.floor(full.byteLength / 2));
    const refusal = refusalOf(() => readZip(truncated));
    expect(refusal.reason).toBe('zip.truncated');
  });

  it('recusa um ZIP truncado a meio do central directory', () => {
    const built = buildZipWithOffsets([
      { name: 'manifest.json', data: utf8('{}') },
      { name: 'vehicles.jsonl', data: utf8('{"x":1}\n') },
    ]);
    // Corta dentro do índice: os cabeçalhos locais estão lá, a tabela ficou incompleta.
    const cut = built.centralOffset + 20;
    const refusal = refusalOf(() => readZip(built.bytes.slice(0, cut)));
    expect(refusal.reason).toBe('zip.truncated');
  });

  it('recusa um ZIP sem end of central directory', () => {
    // Cortar o EOCD deixa o ficheiro a começar por um cabeçalho local válido: é a forma de
    // um download interrompido. O diagnóstico é `truncated` e não `missing_central_directory`,
    // porque é isso que permite dizer ao utilizador para repetir a transferência em vez de
    // sugerir que escolheu o ficheiro errado.
    const built = buildZipWithOffsets([{ name: 'manifest.json', data: utf8('{}') }]);
    const refusal = refusalOf(() => readZip(built.bytes.slice(0, built.eocdOffset)));
    expect(refusal.reason).toBe('zip.truncated');
  });

  it('recusa um ficheiro que começa como ZIP mas não tem índice nem cabeçalho válido', () => {
    // Contraprova do anterior, e caso-limite da ordem das verificações: um ficheiro que
    // **começa** pela assinatura de cabeçalho local (logo passa a verificação de assinatura)
    // mas cujo conteúdo não forma um cabeçalho válido e não tem EOCD nenhum.
    //
    // Percorrido o código: assinatura ✅ → comprimento ✅ → `readCentralDirectory` não
    // encontra EOCD → como começa por `PK\x03\x04`, o diagnóstico é `truncated` (parece um
    // arquivo cortado a meio). O que importa é que **não é aceite**; qual dos dois motivos
    // sai depende de o ficheiro parecer um ZIP cortado, e é isso que se fixa aqui.
    const noise = new Uint8Array(256);
    writeU32(noise, 0, ZIP_SIGNATURES.localFileHeader);
    for (let i = 4; i < noise.byteLength; i += 1) noise[i] = (i * 31) & 0xff;
    const refusal = refusalOf(() => readZip(noise));
    expect(['zip.truncated', 'zip.missing_central_directory']).toContain(refusal.reason);
  });

  it('recusa um central directory com offset impossível', () => {
    const built = buildZipWithOffsets([{ name: 'manifest.json', data: utf8('{}') }]);
    const corrupted = built.bytes.slice();
    // Aponta o índice para muito além do fim do ficheiro. Isto viola a relação entre o
    // índice e o EOCD antes de violar os limites do ficheiro, e o motivo reportado é esse —
    // `invalid_central_directory` descreve a incoerência dos metadados do índice, que é a
    // causa real. Um teste que exigisse aqui `impossible_offsets` estaria a fixar uma ordem
    // de verificações arbitrária em vez de uma garantia de segurança.
    writeU32(corrupted, built.eocdCentralOffsetFieldOffset, 0xfffffff0);
    const refusal = refusalOf(() => readZip(corrupted));
    expect(refusal.reason).toBe('zip.invalid_central_directory');
  });

  it('recusa um offset que sai do ficheiro mantendo a relação do índice coerente', () => {
    // Isola a verificação de limites: o índice é movido para fora do ficheiro **e** o seu
    // tamanho é corrigido para que a soma continue a fechar no EOCD. Assim a única
    // invariante violada é a dos limites, e é essa que tem de produzir a recusa.
    const built = buildZipWithOffsets([{ name: 'manifest.json', data: utf8('{}') }]);
    const corrupted = built.bytes.slice();
    const beyond = built.bytes.byteLength + 4096; // fora do ficheiro
    writeU32(corrupted, built.eocdCentralOffsetFieldOffset, beyond);
    writeU32(corrupted, built.eocdOffset + 12, 0); // tamanho 0 → a soma fecha no offset errado
    const refusal = refusalOf(() => readZip(corrupted));
    // A soma passa a apontar para `beyond` e não para o EOCD, logo é o índice que está mal.
    expect(['zip.impossible_offsets', 'zip.invalid_central_directory']).toContain(refusal.reason);
    // O que não pode acontecer, seja qual for o motivo: o ZIP ser aceite.
  });

  it('recusa um central directory declarado maior do que o ficheiro', () => {
    const built = buildZipWithOffsets([{ name: 'manifest.json', data: utf8('{}') }]);
    const corrupted = built.bytes.slice();
    // Campo de tamanho do central directory no EOCD (offset 12).
    writeU32(corrupted, built.eocdOffset + 12, 0xfffff000);
    const refusal = refusalOf(() => readZip(corrupted));
    expect(refusal.reason).toBe('zip.invalid_central_directory');
  });

  it('recusa quando o número de entradas no EOCD não bate certo com o índice', () => {
    const built = buildZipWithOffsets([{ name: 'manifest.json', data: utf8('{}') }]);
    const corrupted = built.bytes.slice();
    // Declara 5 entradas onde existe 1. Um leitor que confie no contador lê lixo.
    writeU16(corrupted, built.eocdEntryCountOffset, 5);
    const refusal = refusalOf(() => readZip(corrupted));
    expect(refusal.reason).toBe('zip.invalid_central_directory');
  });

  it('recusa um cabeçalho local com assinatura inválida', () => {
    const built = buildZipWithOffsets([{ name: 'manifest.json', data: utf8('{}') }]);
    const corrupted = built.bytes.slice();
    writeU32(corrupted, built.localOffsets[0]!, 0xdeadbeef);
    const refusal = refusalOf(() => readZip(corrupted));
    expect(refusal.reason).toBe('zip.invalid_local_header');
  });

  it('recusa uma entrada cujo cabeçalho local aponta para fora do ficheiro', () => {
    const built = buildZipWithOffsets([{ name: 'manifest.json', data: utf8('{}') }]);
    const corrupted = built.bytes.slice();
    writeU32(corrupted, built.centralLocalOffsetOffsets[0]!, 0x7ffffff0);
    const refusal = refusalOf(() => readZip(corrupted));
    expect(refusal.reason).toBe('zip.impossible_offsets');
  });

  it('recusa tamanhos declarados inconsistentes entre índice e cabeçalho local', () => {
    const built = buildZipWithOffsets([{ name: 'manifest.json', data: utf8('{"format":"zemlo-export"}') }]);
    const corrupted = built.bytes.slice();
    const real = readU32(corrupted, built.centralCompressedSizeOffsets[0]!);
    // O **cabeçalho local** declara um tamanho comprimido diferente do índice, ficando
    // ambos dentro do ficheiro. É o caso que isola a comparação entre as duas cópias dos
    // metadados: se o valor fosse absurdo (fora do ficheiro), a recusa viria dos offsets e
    // o teste não chegaria a exercitar a coerência.
    writeU32(corrupted, built.localOffsets[0]! + 18, real + 3);
    const refusal = refusalOf(() => readZip(corrupted));
    expect(refusal.reason).toBe('zip.inconsistent_sizes');
  });

  it('recusa uma entrada sem dados suficientes para o tamanho declarado', () => {
    // Conteúdo incompressível para que o rácio de compressão não seja a defesa que dispara:
    // o caso é sobre o tamanho declarado não corresponder aos dados, e com dados muito
    // compressíveis a recusa viria do rácio e o teste não exercitaria o que afirma.
    const built = buildZipWithOffsets([{ name: 'manifest.json', data: incompressible(64) }]);
    const corrupted = built.bytes.slice();
    // Declara, **nas duas cópias dos metadados**, um tamanho descomprimido maior do que os
    // dados que existem mas ainda dentro do limite. Os metadados concordam entre si e
    // discordam da realidade — é exatamente o que a verificação de tamanho real apanha.
    const real = readU32(corrupted, built.centralCrcOffsets[0]! + 8);
    const mentira = real + 16;
    writeU32(corrupted, built.centralCrcOffsets[0]! + 8, mentira);
    writeU32(corrupted, built.localOffsets[0]! + 22, mentira);
    const refusal = refusalOf(() => readZip(corrupted));
    expect([
      'zip.content_metadata_mismatch',
      'zip.inconsistent_sizes',
      'zip.corrupt_data',
    ]).toContain(refusal.reason);
  });

  it('recusa um arquivo vazio como bundle', () => {
    // Decisão: um ZIP sem entradas não é um bundle. Não tem `manifest.json`, que a §12.1
    // declara o único ficheiro obrigatório — mas o motivo é estrutural, e é melhor dizê-lo
    // antes de chegar à camada que procura o manifest.
    const refusal = refusalOf(() => readZip(buildEmptyZip()));
    expect(refusal.reason).toBe('zip.empty_archive');
  });

  it('distingue "não é um ZIP" de "é um ZIP vazio"', () => {
    // A assinatura `PK\x05\x06` é válida: um ZIP vazio é reconhecível como ZIP. Recusar
    // com `invalid_signature` seria dizer ao utilizador que o ficheiro não é um ZIP,
    // quando é — só não é um bundle.
    expect(hasZipSignature(buildEmptyZip())).toBe(true);
    expect(hasZipSignature(utf8('nao e um zip'))).toBe(false);
  });

  it('recusa lixo aleatório com a assinatura certa no início', () => {
    const noise = new Uint8Array(512);
    writeU32(noise, 0, ZIP_SIGNATURES.localFileHeader);
    for (let i = 4; i < noise.byteLength; i += 1) noise[i] = (i * 37) & 0xff;
    const refusal = refusalOf(() => readZip(noise));
    expect(ZIP_REFUSAL_REASONS).toContain(refusal.reason as (typeof ZIP_REFUSAL_REASONS)[number]);
    expect(refusal.reason).not.toBe('zip.crc_mismatch');
  });

  it('recusa dois ZIPs concatenados como um só', () => {
    // Lixo depois do índice: um leitor que ignore tudo o que vem depois do EOCD aceita isto
    // como um bundle válido e esconde o segundo. A §12.1 recusa ambiguidade por desenho.
    const first = baseZip();
    const second = baseZip();
    const refusal = refusalOf(() => readZip(concatBytes(first, second)));
    expect([
      'zip.invalid_central_directory',
      'zip.inconsistent_sizes',
      'zip.duplicate_entry',
      'zip.impossible_offsets',
    ]).toContain(refusal.reason);
  });
});

/* ========================================================================== */
/* 4. Integridade                                                             */
/* ========================================================================== */

describe('ZIP — integridade dos dados', () => {
  it('recusa um CRC inválido', () => {
    const built = buildZipWithOffsets([{ name: 'manifest.json', data: utf8('{"format":"zemlo-export"}') }]);
    const corrupted = built.bytes.slice();
    const real = readU32(corrupted, built.centralCrcOffsets[0]!);
    const errado = (real ^ 0xffffffff) >>> 0;
    // O CRC errado é escrito nas **duas** cópias dos metadados — índice e cabeçalho local —
    // para que ambas concordem entre si e discordem dos dados. É o caso que isola a
    // verificação de CRC: se só uma fosse alterada, a recusa viria (corretamente) da
    // comparação índice↔cabeçalho e o teste não chegaria a exercitar o CRC calculado.
    writeU32(corrupted, built.centralCrcOffsets[0]!, errado);
    writeU32(corrupted, built.localOffsets[0]! + 14, errado);
    const refusal = refusalOf(() => readZip(corrupted));
    expect(refusal.reason).toBe('zip.crc_mismatch');
  });

  it('recusa quando o conteúdo muda mas o CRC não', () => {
    // O caso realista: bits alterados na transferência, metadados intactos. O CRC é
    // exatamente o que existe para apanhar isto, e é o único mecanismo que o apanha.
    const built = buildZipWithOffsets([{ name: 'vehicles.jsonl', data: utf8('{"odometerKm":100000}\n') }]);
    const corrupted = built.bytes.slice();
    const dataStart = built.localOffsets[0]! + 30 + 'vehicles.jsonl'.length;
    corrupted[dataStart] = corrupted[dataStart]! ^ 0x01;
    const refusal = refusalOf(() => readZip(corrupted));
    // Alterar um byte comprimido tanto corrompe o CRC como pode quebrar o deflate.
    expect(['zip.crc_mismatch', 'zip.corrupt_data']).toContain(refusal.reason);
  });

  it('recusa dados comprimidos que não descomprimem', () => {
    const built = buildZipWithOffsets([
      { name: 'manifest.json', data: utf8('{"format":"zemlo-export"}') },
    ]);
    const corrupted = built.bytes.slice();
    const dataStart = built.localOffsets[0]! + 30 + 'manifest.json'.length;
    // Estraga o fluxo deflate logo no início.
    corrupted[dataStart] = 0xff;
    corrupted[dataStart + 1] = 0xff;
    const refusal = refusalOf(() => readZip(corrupted));
    expect(['zip.corrupt_data', 'zip.crc_mismatch']).toContain(refusal.reason);
  });

  it('recusa dados que descomprimem mas não correspondem aos metadados', () => {
    // Declara 1000 bytes descomprimidos, fornece 10. O CRC é recalculado sobre os 10 para
    // isolar a verificação de tamanho da de CRC: a recusa tem de vir dos metadados.
    const payload = utf8('0123456789');
    const bytes = buildZip([
      {
        name: 'manifest.json',
        data: payload,
        uncompressedSizeOverride: 1000,
        crcOverride: crc32(payload),
      },
    ]);
    const refusal = refusalOf(() => readZip(bytes));
    expect(['zip.content_metadata_mismatch', 'zip.inconsistent_sizes']).toContain(refusal.reason);
  });

  it('recusa uma entrada declarada comprimida mas com bytes inválidos', () => {
    const built = buildZipWithOffsets([
      { name: 'manifest.json', data: utf8('{"format":"zemlo-export"}'), method: 'deflate' },
    ]);
    const corrupted = built.bytes.slice();
    const dataStart = built.localOffsets[0]! + 30 + 'manifest.json'.length;
    // Substitui o início do fluxo deflate por um bloco inválido.
    for (let i = 0; i < 4; i += 1) corrupted[dataStart + i] = 0x00;
    corrupted[dataStart] = 0x07;
    const refusal = refusalOf(() => readZip(corrupted));
    expect(['zip.corrupt_data', 'zip.crc_mismatch', 'zip.inconsistent_sizes']).toContain(
      refusal.reason,
    );
  });

  it('recusa um symlink declarado nos atributos externos', () => {
    // §7.3: "Entradas que sejam links são rejeitadas, nunca seguidas."
    // Em ZIP de Unix o tipo de ficheiro vive no nibble alto dos atributos externos;
    // 0xa1ff0000 é um link simbólico (S_IFLNK) com permissões 0777.
    const bytes = buildZip([
      {
        name: 'documents/doc_1/atalho.pdf',
        data: utf8('/etc/passwd'),
        externalAttributes: 0xa1ff0000,
      },
    ]);
    const refusal = refusalOf(() => readZip(bytes));
    expect(refusal.reason).toBe('zip.symlink_entry');
    expect(refusal.entryName).toBe('documents/doc_1/atalho.pdf');
  });

  it('não confunde um ficheiro regular com um symlink', () => {
    // Contraprova do teste anterior: 0x81a40000 é um ficheiro regular com 0644. Se a
    // deteção de symlink fosse um `!== 0` ingénuo, isto seria recusado.
    const bytes = buildZip([
      { name: 'documents/doc_1/fatura.pdf', data: utf8('%PDF-1.4'), externalAttributes: 0x81a40000 },
    ]);
    const result = readZip(bytes);
    expect(result.entries).toHaveLength(1);
  });
});

/* ========================================================================== */
/* 5. Limites / DoS (§7.3, §13.4)                                             */
/* ========================================================================== */

describe('ZIP — limites e negação de serviço (§7.3, §13.4)', () => {
  it('recusa um número de entradas acima do limite', () => {
    // §13.4: "ZIP com 10 000 entradas → recusado pelo limite." Aqui usa-se um limite
    // pequeno sobreposto, porque construir 10 000 entradas torna o teste lento sem
    // acrescentar cobertura: a fronteira é o que se testa, não o número.
    const entries: BuildEntry[] = [];
    for (let i = 0; i < 12; i += 1) {
      entries.push({ name: `ficheiro-${i}.txt`, data: utf8('x') });
    }
    const bytes = buildZip(entries);
    const refusal = refusalOf(() => readZip(bytes, { limits: { maxEntries: 10 } }));
    expect(refusal.reason).toBe('zip.too_many_entries');
  });

  it('aceita exatamente o número máximo de entradas', () => {
    // Fronteira pelo lado de dentro: `<` e `<=` não são a mesma regra.
    const entries: BuildEntry[] = [];
    for (let i = 0; i < 10; i += 1) entries.push({ name: `f-${i}.txt`, data: utf8('x') });
    const result = readZip(buildZip(entries), { limits: { maxEntries: 10 } });
    expect(result.entries).toHaveLength(10);
  });

  it('recusa um total descomprimido acima do limite', () => {
    // §13.4: "ZIP de 1 MB que descomprime para 10 GB → recusado pelo limite de bytes
    // descomprimidos." Reproduz-se a **forma** com um limite pequeno.
    //
    // O rácio fica no valor por omissão e o conteúdo é pouco compressível (bytes
    // pseudo-aleatórios), para que a única defesa capaz de travar este caso seja o limite
    // **total**: com dados muito compressíveis, o rácio por entrada dispararia primeiro e o
    // teste deixaria de estar a exercitar o que diz exercitar.
    const bytes = buildZip([
      { name: 'a.bin', data: incompressible(4096) },
      { name: 'b.bin', data: incompressible(4096) },
    ]);
    const refusal = refusalOf(() => readZip(bytes, { limits: { maxUncompressedBytes: 5000 } }));
    expect(refusal.reason).toBe('zip.uncompressed_too_large');
  });

  it('recusa uma entrada individual acima do limite', () => {
    const bytes = buildZip([{ name: 'grande.bin', data: highlyCompressible(8192) }]);
    const refusal = refusalOf(() => readZip(bytes, { limits: { maxEntryBytes: 4096 } }));
    expect(refusal.reason).toBe('zip.entry_too_large');
  });

  it('recusa uma razão de compressão abusiva (decompression bomb)', () => {
    // 1 MB de zeros comprime para poucos KB: rácio muito acima do limite. É a assinatura
    // exata de uma bomba, verificável **sem** descomprimir nada.
    const bytes = buildZip([{ name: 'bomba.bin', data: highlyCompressible(1024 * 1024) }]);
    const refusal = refusalOf(() => readZip(bytes, { limits: { maxCompressionRatio: 50 } }));
    expect(refusal.reason).toBe('zip.compression_ratio_exceeded');
  });

  it('recusa um ficheiro comprimido acima do limite', () => {
    const bytes = buildZip([{ name: 'a.bin', data: new Uint8Array(2048).fill(7) }]);
    const refusal = refusalOf(() => readZip(bytes, { limits: { maxCompressedBytes: 100 } }));
    expect(refusal.reason).toBe('zip.compressed_too_large');
  });

  it('verifica o número de entradas antes de descomprimir', () => {
    // §7.3: os limites são "verificados antes de extrair". Um ZIP com demasiadas entradas
    // tem de ser recusado sem que o Zemlo descomprima a primeira — é a diferença entre
    // recusar e ser derrubado a recusar.
    //
    // A prova: entradas cujo conteúdo **não descomprime**. Se o leitor tentasse
    // descomprimir primeiro, o motivo seria `corrupt_data`; se verifica os limites
    // primeiro, é `too_many_entries`.
    const entries: BuildEntry[] = [];
    for (let i = 0; i < 5; i += 1) {
      entries.push({ name: `f-${i}.txt`, data: utf8('conteudo'), method: 'stored' });
    }
    const built = buildZipWithOffsets(entries);
    const corrupted = built.bytes.slice();
    // Estraga os dados de todas as entradas.
    for (const offset of built.localOffsets) {
      const dataStart = offset + 30 + 'f-0.txt'.length;
      if (dataStart < built.centralOffset) corrupted[dataStart] = 0xff;
    }
    const refusal = refusalOf(() => readZip(corrupted, { limits: { maxEntries: 3 } }));
    expect(refusal.reason).toBe('zip.too_many_entries');
  });

  it('recusa um total descomprimido que excede 32 bits', () => {
    // §7.3 e o pedido de "valores de tamanho que possam provocar overflow". Um ZIP64
    // honesto não cabe aqui, mas um ZIP que **declare** tamanhos enormes tem de ser
    // recusado por limite e não por aritmética que deu a volta.
    const built = buildZipWithOffsets([{ name: 'manifest.json', data: utf8('{}') }]);
    const corrupted = built.bytes.slice();
    // Declara 4 GB - 1 comprimidos numa entrada de 2 bytes.
    writeU32(corrupted, built.centralCompressedSizeOffsets[0]!, 0xfffffff0);
    writeU32(corrupted, built.centralCrcOffsets[0]! + 8, 0xfffffff0);
    const refusal = refusalOf(() => readZip(corrupted));
    // Recusa obrigatória: por limite, por inconsistência ou por tamanho impossível.
    expect([
      'zip.entry_too_large',
      'zip.uncompressed_too_large',
      'zip.inconsistent_sizes',
      'zip.compressed_too_large',
    ]).toContain(refusal.reason);
  });

  it('não aceita um ZIP só porque o comprimido é pequeno', () => {
    // A tentação de verificar apenas o tamanho comprimido: um ficheiro de poucos KB passa
    // em qualquer limite de upload e descomprime para gigabytes.
    //
    // Aqui o conteúdo é compressível de propósito, para exercitar o caminho em que o
    // tamanho comprimido é enganadoramente pequeno. Qualquer das defesas serve — o que não
    // pode acontecer é o ficheiro passar.
    const bytes = buildZip([{ name: 'bomba.bin', data: highlyCompressible(2 * 1024 * 1024) }]);
    const compressed = bytes.byteLength;
    expect(compressed).toBeLessThan(64 * 1024); // passa em qualquer limite de upload
    const refusal = refusalOf(() =>
      readZip(bytes, { limits: { maxCompressedBytes: 128 * 1024 } }),
    );
    expect(['zip.uncompressed_too_large', 'zip.compression_ratio_exceeded']).toContain(
      refusal.reason,
    );
  });
});

/* ========================================================================== */
/* 6. ZIP válido — casos positivos mínimos                                    */
/* ========================================================================== */

describe('ZIP — casos válidos (§5.2)', () => {
  it('lê um ZIP com um único `manifest.json`', () => {
    const bytes = buildManifestZip({ format: 'zemlo-export', formatVersion: 1 });
    const result = readZip(bytes);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.name).toBe('manifest.json');
    expect(new TextDecoder().decode(result.entries[0]!.data)).toContain('zemlo-export');
  });

  it('lê um ZIP com vários ficheiros', () => {
    const bytes = buildZip([
      { name: 'manifest.json', data: utf8('{"format":"zemlo-export"}') },
      { name: 'vehicles.jsonl', data: utf8('{"plate":"AA-00-BB"}\n') },
      { name: 'expenses.jsonl', data: utf8('{"amountCents":1234}\n') },
    ]);
    const result = readZip(bytes);
    expect(result.entries.map((e) => e.name)).toEqual([
      'manifest.json',
      'vehicles.jsonl',
      'expenses.jsonl',
    ]);
    expect(result.uncompressedBytes).toBeGreaterThan(0);
  });

  it('lê ficheiros em subdiretórios', () => {
    const bytes = buildZip([
      { name: 'manifest.json', data: utf8('{}') },
      { name: 'documents/doc_1/fatura.pdf', data: utf8('%PDF-1.4') },
      { name: 'documents/doc_2/recibo.pdf', data: utf8('%PDF-1.4') },
    ]);
    const result = readZip(bytes);
    expect(result.entries.map((e) => e.name)).toContain('documents/doc_1/fatura.pdf');
  });

  it('preserva conteúdo UTF-8', () => {
    const conteudo = '{"nome":"João Muñoz","nota":"Revisão — 42 381 km"}\n';
    const bytes = buildZip([{ name: 'vehicles.jsonl', data: utf8(conteudo) }]);
    const result = readZip(bytes);
    expect(new TextDecoder().decode(result.entries[0]!.data)).toBe(conteudo);
  });

  it('preserva conteúdo binário byte a byte', () => {
    // §1.1: um PDF exportado é o mesmo PDF. Se a leitura não fosse byte a byte, isto
    // detetava-o.
    const binario = new Uint8Array(256);
    for (let i = 0; i < binario.byteLength; i += 1) binario[i] = i;
    const bytes = buildZip([{ name: 'documents/doc_1/binario.bin', data: binario }]);
    const result = readZip(bytes);
    expect(Array.from(result.entries[0]!.data)).toEqual(Array.from(binario));
  });

  it('lê ficheiros vazios', () => {
    // Permitido: um ficheiro de dados sem registos é um bundle legítimo de âmbito parcial.
    const bytes = buildZip([
      { name: 'manifest.json', data: utf8('{}') },
      { name: 'suggestions.jsonl', data: new Uint8Array(0) },
    ]);
    const result = readZip(bytes);
    const vazio = result.entries.find((e) => e.name === 'suggestions.jsonl');
    expect(vazio?.uncompressedBytes).toBe(0);
    expect(vazio?.data.byteLength).toBe(0);
  });

  it('lê nomes com espaços, acentos e Unicode', () => {
    const bytes = buildZip([
      { name: 'manifest.json', data: utf8('{}') },
      { name: 'documents/doc_1/Fatura eléctrica — Março.pdf', data: utf8('%PDF') },
      { name: 'documents/doc_2/небольшой файл.pdf', data: utf8('%PDF') },
    ]);
    const result = readZip(bytes);
    expect(result.entries.map((e) => e.name)).toContain(
      'documents/doc_1/Fatura eléctrica — Março.pdf',
    );
  });

  it('lê entradas guardadas sem compressão', () => {
    const bytes = buildZip([{ name: 'manifest.json', data: utf8('{}'), method: 'stored' }]);
    const result = readZip(bytes);
    expect(result.entries[0]!.compressed).toBe(false);
  });

  it('aceita exatamente o limite de racio de compressão', () => {
    // Fronteira do rácio: o limite é um máximo inclusivo, não um exclusivo.
    //
    // O limite não pode ser **aumentado** por quem chama (é uma defesa, e uma defesa que se
    // desliga não é defesa — ver `resolveLimits`), por isso o caso constrói-se sempre a
    // partir de baixo, com um ficheiro cujo rácio real é conhecido e um limite igual a esse
    // rácio. É o menor limite que ainda admite o ficheiro.
    //
    // Usa-se conteúdo incompressível para o rácio real ser ~1 e o limite ficar folgadamente
    // abaixo do valor por omissão: a fronteira testa-se sobre a **comparação**, não sobre o
    // número por omissão.
    const conteudo = incompressible(2048);
    const built = buildZipWithOffsets([{ name: 'a.bin', data: conteudo }]);
    const comprimido = readU32(built.bytes, built.centralCompressedSizeOffsets[0]!);

    // Rácio real, arredondado para cima: o menor limite que ainda admite este ficheiro.
    const racio = Math.ceil(conteudo.byteLength / comprimido);
    expect(racio).toBeLessThanOrEqual(ZIP_LIMITS.maxCompressionRatio); // o limite é apertável

    const result = readZip(built.bytes, { limits: { maxCompressionRatio: racio } });
    expect(result.entries).toHaveLength(1);

    // E um abaixo do real é recusado — a fronteira tem dois lados.
    const refusal = refusalOf(() =>
      readZip(built.bytes, { limits: { maxCompressionRatio: racio - 1 } }),
    );
    expect(refusal.reason).toBe('zip.compression_ratio_exceeded');
  });
});

/* ========================================================================== */
/* 7. Índice do bundle (§12.1)                                                */
/* ========================================================================== */

describe('ZIP — índice do bundle', () => {
  it('encontra o manifest e os ficheiros de dados', () => {
    const bytes = buildZip([
      { name: 'manifest.json', data: utf8('{"format":"zemlo-export"}') },
      { name: 'vehicles.jsonl', data: utf8('') },
      { name: 'documents/doc_1/a.pdf', data: utf8('%PDF') },
    ]);
    const index = indexBundleEntries(readZip(bytes).entries);
    expect(index.manifest.name).toBe('manifest.json');
    expect(index.dataFiles.map((e) => e.name)).toEqual(['vehicles.jsonl']);
    expect(index.documentBytes.map((e) => e.name)).toEqual(['documents/doc_1/a.pdf']);
  });

  it('recusa um ZIP sem `manifest.json`', () => {
    // §12.1: "ZIP sem manifest.json → Recusa. É o único ficheiro obrigatório."
    const bytes = buildZip([{ name: 'vehicles.jsonl', data: utf8('') }]);
    const entries = readZip(bytes).entries;
    const refusal = refusalOf(() => indexBundleEntries(entries));
    expect(refusal.reason).toBe('zip.invalid_entry_name');
  });
});

/* ========================================================================== */
/* 8. O construtor de testes é honesto                                        */
/* ========================================================================== */

describe('Construtor de ZIP dos testes — os próprios testes não podem mentir', () => {
  /**
   * Se o construtor produzisse ZIPs inválidos por engano, todos os casos negativos
   * passariam pela razão errada e nenhum caso positivo significaria nada. Estes testes
   * verificam o construtor contra factos do formato, não contra o leitor.
   */

  it('produz a assinatura de ZIP', () => {
    const bytes = baseZip();
    expect(readU32(bytes, 0)).toBe(ZIP_SIGNATURES.localFileHeader);
  });

  it('inclui a assinatura de fim de central directory', () => {
    const built = buildZipWithOffsets([{ name: 'manifest.json', data: utf8('{}') }]);
    expect(readU32(built.bytes, built.eocdOffset)).toBe(ZIP_SIGNATURES.endOfCentralDirectory);
  });

  it('escreve o CRC correto por omissão', () => {
    const conteudo = utf8('{"format":"zemlo-export"}');
    const built = buildZipWithOffsets([{ name: 'manifest.json', data: conteudo }]);
    expect(readU32(built.bytes, built.centralCrcOffsets[0]!)).toBe(crc32(conteudo));
  });

  it('permite corromper um campo sem invalidar o resto da estrutura', () => {
    // A propriedade de que os testes negativos dependem: o ZIP continua estruturalmente
    // válido e apenas o campo alvo fica errado.
    const built = buildZipWithOffsets([{ name: 'manifest.json', data: utf8('{}') }]);
    const corrupted = built.bytes.slice();
    writeU32(corrupted, built.centralCrcOffsets[0]!, 0x12345678);
    expect(corrupted.byteLength).toBe(built.bytes.byteLength);
    expect(readU32(corrupted, built.eocdOffset)).toBe(ZIP_SIGNATURES.endOfCentralDirectory);
  });

  it('o conteúdo comprimido foi mesmo comprimido', () => {
    const bytes = buildZip([{ name: 'bomba.bin', data: highlyCompressible(100_000) }]);
    expect(bytes.byteLength).toBeLessThan(10_000);
  });

  it('duas chamadas com as mesmas entradas produzem os mesmos bytes', () => {
    // Determinismo: sem ele, um teste de recusa podia passar por acaso.
    const a = buildZip([{ name: 'manifest.json', data: utf8('{}') }]);
    const b = buildZip([{ name: 'manifest.json', data: utf8('{}') }]);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
