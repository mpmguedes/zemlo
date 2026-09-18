/**
 * Contrato adversarial do **leitor de bundle** (§5, §9.4, §12.1, §13; decisão A26).
 *
 * ## Método
 *
 * Escrito **antes** da implementação, como na Fase 2. Os testes chamam `readBundle` e
 * falham com `BundleNotImplementedError` enquanto a implementação não existir — falham
 * pela razão certa, e não por um `import` de um símbolo inexistente.
 *
 * ## O que cada grupo prova
 *
 * | Grupo | Prova |
 * | --- | --- |
 * | Manifest | JSON malformado, contrato violado, formato e versão (§12.1) |
 * | Ficheiros declarados | ausente → recusa, **não declarado → recusa** (A26) |
 * | Integridade | `sha256` divergente → recusa (§5.5) |
 * | Limites | aplicados aos dados **lidos**, não aos `counts` declarados (A26) |
 * | Linhas | linha malformada, linha não-objecto, linha enorme |
 * | Documentos | bytes verificados e não persistidos; `missingContent` mantido |
 * | Contagens | divergência → **aviso**, nunca recusa (A26) |
 * | Caminho válido | bundle bom → resultado completo e coerente |
 *
 * O grupo "limites" é o que testa a condição transversal da A26: um `count` enganador não
 * pode contornar um limite. Está escrito como teste dedicado porque é a regra mais fácil de
 * implementar mal em silêncio — bastaria ler o manifest em vez dos dados.
 */

import { describe, expect, it } from 'vitest';

import { BUNDLE_MANIFEST_FILE, EXPORT_FORMAT, MIN_SUPPORTED_FORMAT_VERSION } from '@zemlo/shared';
import {
  BUNDLE_LIMITS,
  BUNDLE_REFUSAL_REASONS,
  BundleRefusalError,
  readBundle,
  sha256Hex,
  verifyFileChecksum,
} from '../src/domain/import/bundle.js';
import type { ZipEntry } from '../src/domain/import/zip.js';
import { readZip } from '../src/domain/import/zip.js';
import {
  buildBundle,
  jsonl,
  minimalBundle,
  sha256Hex as builderSha256,
} from './helpers/bundle-builder.js';

/* -------------------------------------------------------------------------- */
/* Utilitários                                                                */
/* -------------------------------------------------------------------------- */

/** Extrai as entradas de um ZIP construído. Passa pelo leitor real (Fase 2). */
function entriesOf(zip: Uint8Array): ZipEntry[] {
  return [...readZip(zip).entries];
}

/** Lê um bundle e devolve o resultado, ou a recusa — nunca deixa subir. */
function readSafely(
  zip: Uint8Array,
  options?: Parameters<typeof readBundle>[1],
): { ok: true; value: ReturnType<typeof readBundle> } | { ok: false; refusal: BundleRefusalError } {
  try {
    return { ok: true, value: readBundle(entriesOf(zip), options) };
  } catch (error) {
    if (error instanceof BundleRefusalError) return { ok: false, refusal: error };
    throw error;
  }
}

/** Afirma que um bundle é recusado pelo motivo indicado. */
function expectRefusal(
  zip: Uint8Array,
  reason: string,
  options?: Parameters<typeof readBundle>[1],
): BundleRefusalError {
  const result = readSafely(zip, options);
  expect(result.ok, `esperava recusa "${reason}" mas a leitura passou`).toBe(false);
  if (result.ok) throw new Error('inalcançável');
  expect(result.refusal.refusal.reason).toBe(reason);
  return result.refusal;
}

/**
 * Ruído determinístico, pouco compressível.
 *
 * Necessário para isolar limites de **tamanho** do limite de **razão de compressão** do
 * leitor do ZIP: uma string repetida (`'x'.repeat(n)`) comprime a 1000:1 e é recusada por
 * `zip.compression_ratio_exceeded` antes de qualquer limite de documento ser avaliado. Um
 * teste assim passaria pela razão errada. Mesma técnica do `incompressible()` da Fase 2.
 */
function deterministicNoise(length: number): string {
  let state = 0x12345678;
  let out = '';
  for (let i = 0; i < length; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    // Caracteres ASCII imprimíveis, para o conteúdo continuar a ser texto válido.
    out += String.fromCharCode(33 + (state % 94));
  }
  return out;
}

/* ========================================================================== */
/* 1. O contrato existe                                                       */
/* ========================================================================== */

describe('contrato do leitor de bundle existe', () => {
  it('exporta os limites, com um teto absoluto de registos', () => {
    expect(BUNDLE_LIMITS.maxRecords).toBe(100_000);
    expect(BUNDLE_LIMITS.maxDataFileBytes).toBeGreaterThan(0);
    expect(BUNDLE_LIMITS.maxLineChars).toBeGreaterThan(0);
    expect(BUNDLE_LIMITS.maxDocumentBytes).toBeGreaterThan(0);
  });

  it('declara os motivos de recusa sem duplicados', () => {
    expect(BUNDLE_REFUSAL_REASONS.length).toBeGreaterThan(10);
    expect(new Set(BUNDLE_REFUSAL_REASONS).size).toBe(BUNDLE_REFUSAL_REASONS.length);
  });

  it('exporta `sha256Hex` no formato do manifest (hex minúsculo, 64 chars)', () => {
    const digest = sha256Hex('zemlo');
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('`verifyFileChecksum` aceita o digest correto e recusa outro', () => {
    const data = new TextEncoder().encode('conteúdo');
    const good = sha256Hex(data);
    expect(verifyFileChecksum(data, good)).toBe(true);
    expect(verifyFileChecksum(data, 'a'.repeat(64))).toBe(false);
  });
});

/* ========================================================================== */
/* 2. Manifest — §12.1                                                        */
/* ========================================================================== */

describe('manifest — formato, versão e validade', () => {
  it('recusa quando o manifest não é JSON válido', () => {
    const { zip } = buildBundle({
      dataFiles: [{ path: 'vehicles.jsonl', content: jsonl([{ localId: 'veh_1', plate: 'AA-00-BB' }]) }],
      rawManifest: '{ isto não é JSON',
    });
    expectRefusal(zip, 'bundle.manifest_malformed');
  });

  it('recusa quando o manifest é JSON mas não satisfaz o contrato', () => {
    const { zip } = buildBundle({
      dataFiles: [{ path: 'vehicles.jsonl', content: jsonl([{ localId: 'veh_1', plate: 'AA-00-BB' }]) }],
      // `counts` obrigatório em falta — o manifest está incompleto, não corrompido.
      manifestPatch: { removeCounts: true },
      rawManifest: '{"manifestVersion": 1}',
    });
    expectRefusal(zip, 'bundle.manifest_invalid');
  });

  it('recusa um `format` desconhecido (§12.1)', () => {
    const { zip } = buildBundle({
      format: 'outra-coisa',
      dataFiles: [{ path: 'vehicles.jsonl', content: jsonl([{ localId: 'veh_1', plate: 'AA-00-BB' }]) }],
    });
    expectRefusal(zip, 'bundle.format_unknown');
  });

  it('recusa uma `formatVersion` superior à suportada (§12.1)', () => {
    const { zip } = buildBundle({
      formatVersion: 99,
      dataFiles: [{ path: 'vehicles.jsonl', content: jsonl([{ localId: 'veh_1', plate: 'AA-00-BB' }]) }],
    });
    expectRefusal(zip, 'bundle.version_too_new');
  });

  it('recusa uma `formatVersion` que não é uma versão válida', () => {
    const { zip } = buildBundle({
      formatVersion: 0,
      dataFiles: [{ path: 'vehicles.jsonl', content: jsonl([{ localId: 'veh_1', plate: 'AA-00-BB' }]) }],
    });
    // A versão 0 não é "demasiado antiga" — não é uma versão. `checkCompatibility` (Fase 1)
    // classifica-a como `malformed`, e o diagnóstico útil para o utilizador é "o manifest
    // não declara uma versão válida", não "atualiza o Zemlo para uma versão antiga".
    const result = readSafely(zip);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.refusal.reason).toBe('bundle.manifest_invalid');
  });

  it('o ramo `too-old` é inalcançável enquanto o mínimo for 1 (§12.1)', () => {
    // Documenta a mesma limitação registada na Fase 1 para `migrate.ts`: com
    // `MIN_SUPPORTED_FORMAT_VERSION === 1` e `FORMAT_VERSION === 1`, não existe hoje uma
    // versão abaixo do mínimo que seja simultaneamente uma versão válida. O ramo existe no
    // código e é testado directamente (em `import-plan-migrate.test.ts`), mas não é
    // alcançável por um bundle real — e um teste que o tentasse exercitar por esta via
    // estaria a afirmar algo falso.
    expect(MIN_SUPPORTED_FORMAT_VERSION).toBe(1);
  });

  it('recusa um ZIP sem manifest.json (§12.1 — único ficheiro obrigatório)', () => {
    // ZIP com um ficheiro de dados e nada mais: não é um bundle.
    const bundle = buildBundle({
      dataFiles: [{ path: 'vehicles.jsonl', content: jsonl([{ localId: 'veh_1', plate: 'AA-00-BB' }]) }],
      rawManifest: '',
    });
    // Sem manifest não há bundle: a recusa vem do índice (zip) antes do leitor.
    const result = readSafely(bundle.zip);
    expect(result.ok).toBe(false);
  });

  it('aceita `manifestVersion` desconhecido quando as chaves necessárias existem (§12.1)', () => {
    const { zip } = buildBundle({
      manifestVersion: 7,
      dataFiles: [{ path: 'vehicles.jsonl', content: jsonl([{ localId: 'veh_1', plate: 'AA-00-BB' }]) }],
    });
    // A §12.1 é explícita: uma versão de manifest mais alta com as chaves que precisamos
    // é importável. Recusar por um número que não usamos seria recusar dados legítimos.
    const result = readSafely(zip);
    expect(result.ok).toBe(true);
  });

  it('o `bundleId` do manifest é exposto no resultado (chave da idempotência)', () => {
    const { zip, manifest } = minimalBundle({
      bundleId: 'bnd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    const result = readSafely(zip);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.bundleId).toBe('bnd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(result.value.bundleId).toBe(manifest.bundleId);
  });
});

/* ========================================================================== */
/* 3. Ficheiros declarados vs presentes — A26                                 */
/* ========================================================================== */

describe('ficheiros declarados e presentes (A26)', () => {
  it('recusa quando um ficheiro declarado no manifest não existe no ZIP', () => {
    const { zip } = buildBundle({
      dataFiles: [
        { path: 'vehicles.jsonl', content: jsonl([{ localId: 'veh_1', plate: 'AA-00-BB' }]) },
        { path: 'expenses.jsonl', content: jsonl([{ localId: 'exp_1', amountCents: 1000, date: '2026-01-01', category: 'fuel' }]) },
      ],
      // `expenses.jsonl` está declarado mas não é colocado no ZIP.
      missingFromZip: ['expenses.jsonl'],
    });
    expectRefusal(zip, 'bundle.missing_file');
  });

  it('recusa um ficheiro presente mas NÃO declarado no manifest (A26, regra 1)', () => {
    const { zip } = buildBundle({
      dataFiles: [{ path: 'vehicles.jsonl', content: jsonl([{ localId: 'veh_1', plate: 'AA-00-BB' }]) }],
      // O utilizador manipulou o ZIP: há dados que o bundle não assume.
      undeclaredFiles: [
        { path: 'expenses.jsonl', content: jsonl([{ localId: 'exp_9', amountCents: 999999, date: '2026-01-01', category: 'x' }]) },
      ],
    });
    expectRefusal(zip, 'bundle.undeclared_file');
  });

  it('recusa um ficheiro de dados que não pertence ao contrato', () => {
    const { zip } = buildBundle({
      dataFiles: [{ path: 'vehicles.jsonl', content: jsonl([{ localId: 'veh_1', plate: 'AA-00-BB' }]) }],
      undeclaredFiles: [{ path: 'segredos.jsonl', content: jsonl([{ o: 'que' }]) }],
    });
    // Um ficheiro que não está no contrato nem declarado: recusado. A distinção entre
    // "não declarado" e "desconhecido" não muda o resultado — não entra.
    const result = readSafely(zip);
    expect(result.ok).toBe(false);
  });

  it('o `README.txt` e a pasta `csv/` não são tratados como ficheiros de dados (§5.2)', () => {
    const { zip } = buildBundle({
      dataFiles: [{ path: 'vehicles.jsonl', content: jsonl([{ localId: 'veh_1', plate: 'AA-00-BB' }]) }],
      undeclaredFiles: [
        { path: 'README.txt', content: 'Este ficheiro explica o conteúdo do bundle.' },
        { path: 'csv/veiculos.csv', content: 'matricula;marca\nAA-00-BB;Kia\n' },
      ],
    });
    // Fazem parte do contrato do artefacto (§5.2) e não são dados a importar: a presença
    // deles não pode tornar um bundle válido em recusado.
    const result = readSafely(zip);
    expect(result.ok).toBe(true);
  });
});

/* ========================================================================== */
/* 4. Integridade — §5.5                                                      */
/* ========================================================================== */

describe('integridade dos ficheiros de dados (§5.5)', () => {
  it('recusa quando o `sha256` de um ficheiro não corresponde ao declarado', () => {
    const { zip } = buildBundle({
      dataFiles: [
        {
          path: 'vehicles.jsonl',
          content: jsonl([{ localId: 'veh_1', plate: 'AA-00-BB' }]),
          declaredSha256: 'b'.repeat(64),
        },
      ],
    });
    expectRefusal(zip, 'bundle.checksum_mismatch');
  });

  it('aceita quando o `sha256` corresponde', () => {
    const content = jsonl([{ localId: 'veh_1', plate: 'AA-00-BB' }]);
    const { zip } = buildBundle({
      dataFiles: [{ path: 'vehicles.jsonl', content, declaredSha256: builderSha256(content) }],
    });
    const result = readSafely(zip);
    expect(result.ok).toBe(true);
  });

  it('um `sha256` em maiúsculas é recusado — o contrato exige minúsculas', () => {
    const content = jsonl([{ localId: 'veh_1', plate: 'AA-00-BB' }]);
    const { zip } = buildBundle({
      dataFiles: [{ path: 'vehicles.jsonl', content, declaredSha256: builderSha256(content).toUpperCase() }],
    });
    // O contrato partilhado (`zManifestFile`, `packages/shared/src/import-export.ts`)
    // exige `^[a-f0-9]{64}$`. Um digest em maiúsculas viola o contrato antes de chegar a
    // qualquer comparação — e é o diagnóstico certo: um ficheiro que não cumpre o contrato
    // é um manifest inválido, não um ficheiro com o conteúdo alterado.
    const result = readSafely(zip);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.refusal.reason).toBe('bundle.manifest_invalid');
  });

  it('`verifyFileChecksum` aceita o digest em qualquer caixa (a comparação normaliza)', () => {
    // Ao nível da função isolada, a caixa é formatação e não valor: quem chama já garantiu
    // o formato. É esta separação que permite o contrato ser estrito sobre o formato do
    // manifest sem tornar a comparação frágil.
    const data = new TextEncoder().encode('conteúdo');
    const digest = sha256Hex(data);
    expect(verifyFileChecksum(data, digest.toUpperCase())).toBe(true);
    expect(verifyFileChecksum(data, digest)).toBe(true);
  });
});

/* ========================================================================== */
/* 5. Limites — aplicados aos DADOS, nunca aos counts declarados (A26)         */
/* ========================================================================== */

describe('limites aplicados aos dados efectivamente lidos (A26)', () => {
  it('recusa um ficheiro de dados acima do limite de bytes', () => {
    const vehicles = jsonl([{ localId: 'veh_1', plate: 'AA-00-BB', nota: 'x'.repeat(2000) }]);
    const { zip } = buildBundle({
      dataFiles: [{ path: 'vehicles.jsonl', content: vehicles }],
    });
    // Aperta-se o limite em vez de construir um ficheiro de 64 MB: a fronteira é o que se
    // testa, e um limite que só se pode exercitar com 64 MB de dados não se testa.
    expectRefusal(zip, 'bundle.file_too_large', { limits: { maxDataFileBytes: 100 } });
  });

  it('recusa quando o total de registos excede o teto absoluto', () => {
    const vehicles = jsonl(
      Array.from({ length: 10 }, (_, i) => ({ localId: `veh_${i}`, plate: `AA-00-B${i}` })),
    );
    const { zip } = buildBundle({
      dataFiles: [{ path: 'vehicles.jsonl', content: vehicles }],
    });
    expectRefusal(zip, 'bundle.too_many_records', { limits: { maxRecords: 5 } });
  });

  it('um `counts` declarado a mentir NÃO contorna o teto de registos', () => {
    const vehicles = jsonl(
      Array.from({ length: 10 }, (_, i) => ({ localId: `veh_${i}`, plate: `AA-00-B${i}` })),
    );
    const { zip } = buildBundle({
      dataFiles: [{ path: 'vehicles.jsonl', content: vehicles }],
      // O manifest diz que há 1 registo; há 10. É a condição transversal da A26: o
      // declarado não pode autorizar trabalho que os dados não justificam.
      declaredCounts: { vehicles: 1 },
    });
    expectRefusal(zip, 'bundle.too_many_records', { limits: { maxRecords: 5 } });
  });

  it('um `counts` declarado a mentir NÃO contorna o limite de bytes', () => {
    const vehicles = jsonl([{ localId: 'veh_1', plate: 'AA-00-BB', nota: 'y'.repeat(3000) }]);
    const { zip } = buildBundle({
      dataFiles: [{ path: 'vehicles.jsonl', content: vehicles }],
      declaredCounts: { vehicles: 1 },
    });
    expectRefusal(zip, 'bundle.file_too_large', { limits: { maxDataFileBytes: 200 } });
  });

  it('recusa uma linha acima do limite de comprimento', () => {
    const vehicles = jsonl([{ localId: 'veh_1', plate: 'AA-00-BB', nota: 'z'.repeat(500) }]);
    const { zip } = buildBundle({
      dataFiles: [{ path: 'vehicles.jsonl', content: vehicles }],
    });
    expectRefusal(zip, 'bundle.line_too_long', { limits: { maxLineChars: 50 } });
  });

  it('recusa bytes de documento acima do limite', () => {
    // Conteúdo **incompressível**: um texto repetitivo comprimiria a uma razão enorme e o
    // leitor do ZIP recusá-lo-ia por `zip.compression_ratio_exceeded` — o teste passaria
    // pela razão errada e nunca chegaria a exercitar o limite de documento.
    const incompressible = deterministicNoise(5000);
    const { zip } = buildBundle({
      dataFiles: [{ path: 'vehicles.jsonl', content: jsonl([{ localId: 'veh_1', plate: 'AA-00-BB' }]) }],
      documents: { 'documents/doc_1/seguro.pdf': incompressible },
    });
    expectRefusal(zip, 'bundle.document_too_large', { limits: { maxDocumentBytes: 100 } });
  });

  it('um limite pedido não pode ser afrouxado para além do contrato', () => {
    const { zip } = minimalBundle();
    // Mesma disciplina de `resolveLimits` no ZIP: um pedido pode apertar, nunca desligar.
    const result = readSafely(zip, { limits: { maxRecords: Number.MAX_SAFE_INTEGER } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.refusal.reason).toBe('bundle.manifest_invalid');
  });
});

/* ========================================================================== */
/* 6. Linhas JSONL                                                            */
/* ========================================================================== */

describe('linhas JSONL', () => {
  it('recusa uma linha que não é JSON válido, com o número da linha', () => {
    const content =
      JSON.stringify({ localId: 'veh_1', plate: 'AA-00-BB' }) + '\n{ isto não é json\n';
    const { zip } = buildBundle({
      dataFiles: [{ path: 'vehicles.jsonl', content }],
    });
    const refusal = expectRefusal(zip, 'bundle.line_malformed');
    expect(refusal.refusal.line).toBe(2);
    expect(refusal.refusal.file).toBe('vehicles.jsonl');
  });

  it('recusa uma linha que é JSON mas não é um objecto', () => {
    const content = '["não", "é", "objecto"]\n';
    const { zip } = buildBundle({
      dataFiles: [{ path: 'vehicles.jsonl', content }],
    });
    expectRefusal(zip, 'bundle.line_not_an_object');
  });

  it('uma linha vazia é ignorada, não é erro', () => {
    const content = '\n' + JSON.stringify({ localId: 'veh_1', plate: 'AA-00-BB' }) + '\n\n';
    const { zip } = buildBundle({
      dataFiles: [{ path: 'vehicles.jsonl', content }],
    });
    const result = readSafely(zip);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Uma linha vazia a mais é ruído de edição manual, não corrupção. Recusá-la tornaria
    // o bundle irrecuperável por causa de uma tecla Enter.
    expect(result.value.records).toHaveLength(1);
  });

  it('o número da linha é 1-based e conta as linhas reais do ficheiro', () => {
    const content =
      JSON.stringify({ localId: 'veh_1', plate: 'AA-00-BB' }) +
      '\n' +
      JSON.stringify({ localId: 'veh_2', plate: 'CC-00-DD' }) +
      '\n' +
      'lixo\n';
    const { zip } = buildBundle({
      dataFiles: [{ path: 'vehicles.jsonl', content }],
    });
    const refusal = expectRefusal(zip, 'bundle.line_malformed');
    expect(refusal.refusal.line).toBe(3);
  });

  it('um ficheiro de dados vazio é válido e produz zero registos', () => {
    const { zip } = buildBundle({
      dataFiles: [{ path: 'vehicles.jsonl', content: '' }],
    });
    const result = readSafely(zip);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.records).toHaveLength(0);
  });
});

/* ========================================================================== */
/* 7. Documentos — decisão 2 / A26 regra 4                                    */
/* ========================================================================== */

describe('documentos — bytes verificados, não persistidos (A26)', () => {
  it('lê os bytes de um documento e calcula o `sha256` real', () => {
    const pdf = '%PDF-1.4 conteúdo de teste';
    const { zip } = buildBundle({
      dataFiles: [{ path: 'vehicles.jsonl', content: jsonl([{ localId: 'veh_1', plate: 'AA-00-BB' }]) }],
      documents: { 'documents/doc_1/seguro.pdf': pdf },
    });
    const result = readSafely(zip);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.documentBytes).toHaveLength(1);
    const doc = result.value.documentBytes[0]!;
    expect(doc.localId).toBe('doc_1');
    expect(doc.fileName).toBe('seguro.pdf');
    expect(doc.path).toBe('documents/doc_1/seguro.pdf');
    // O digest é sobre os bytes REAIS, não sobre nada declarado.
    expect(doc.sha256).toBe(sha256Hex(new TextEncoder().encode(pdf)));
    expect(doc.bytes).toBe(new TextEncoder().encode(pdf).byteLength);
  });

  it('um bundle sem bytes de documentos é válido — `missingContent` mantém-se', () => {
    const { zip } = buildBundle({
      dataFiles: [{ path: 'vehicles.jsonl', content: jsonl([{ localId: 'veh_1', plate: 'AA-00-BB' }]) }],
      documents: {},
    });
    const result = readSafely(zip);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A limitação não é um erro: o registo do documento entra na mesma (§5.6).
    expect(result.value.documentBytes).toHaveLength(0);
  });

  it('recusa um caminho de documento sem o `localId` do documento', () => {
    const { zip } = buildBundle({
      dataFiles: [{ path: 'vehicles.jsonl', content: jsonl([{ localId: 'veh_1', plate: 'AA-00-BB' }]) }],
      // `documents/seguro.pdf` está na pasta de documentos mas não tem a subpasta do
      // `localId`. Sem ela não há forma de ligar os bytes aos metadados do documento, e
      // bytes que não pertencem a nenhum documento são inúteis.
      documents: { 'documents/seguro.pdf': 'conteudo' },
    });
    expectRefusal(zip, 'bundle.document_path_invalid');
  });
});

/* ========================================================================== */
/* 8. Contagens divergentes → aviso, nunca recusa (A26 regra 3)                */
/* ========================================================================== */

describe('contagens divergentes (A26 regra 3)', () => {
  it('declarar menos registos do que existem é um AVISO, não uma recusa', () => {
    const vehicles = jsonl([
      { localId: 'veh_1', plate: 'AA-00-BB' },
      { localId: 'veh_2', plate: 'CC-00-DD' },
    ]);
    const { zip } = buildBundle({
      dataFiles: [{ path: 'vehicles.jsonl', content: vehicles }],
      declaredCounts: { vehicles: 1 },
    });
    const result = readSafely(zip);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // A verdade são as linhas. O utilizador é informado, não impedido.
    expect(result.value.records).toHaveLength(2);
    expect(result.value.issues.length).toBeGreaterThan(0);
    expect(result.value.issues.some((issue) => issue.severity !== 'blocking')).toBe(true);
  });

  it('declarar mais registos do que existem também é aviso, não recusa', () => {
    const vehicles = jsonl([{ localId: 'veh_1', plate: 'AA-00-BB' }]);
    const { zip } = buildBundle({
      dataFiles: [{ path: 'vehicles.jsonl', content: vehicles }],
      declaredCounts: { vehicles: 50 },
    });
    const result = readSafely(zip);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.records).toHaveLength(1);
  });

  it('contagens coincidentes não produzem aviso', () => {
    const { zip } = minimalBundle();
    const result = readSafely(zip);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.issues.filter((issue) => issue.severity !== 'blocking')).toHaveLength(0);
  });
});

/* ========================================================================== */
/* 9. Caminho válido                                                          */
/* ========================================================================== */

describe('bundle válido', () => {
  it('lê um bundle mínimo e devolve o resultado completo', () => {
    const { zip } = minimalBundle();
    const result = readSafely(zip);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.formatVersion).toBe(1);
    expect(result.value.records).toHaveLength(1);
    expect(result.value.records[0]!.kind).toBe('vehicle');
    expect(result.value.records[0]!.file).toBe('vehicles.jsonl');
    expect(result.value.records[0]!.line).toBe(1);
    expect(result.value.records[0]!.fields['plate']).toBe('AA-00-BB');
  });

  it('lê vários ficheiros e mantém a contagem por tipo', () => {
    const { zip } = buildBundle({
      dataFiles: [
        { path: 'vehicles.jsonl', content: jsonl([{ localId: 'veh_1', plate: 'AA-00-BB' }]) },
        {
          path: 'expenses.jsonl',
          content: jsonl([
            { localId: 'exp_1', amountCents: 1000, date: '2026-01-01', category: 'fuel' },
            { localId: 'exp_2', amountCents: 2000, date: '2026-01-02', category: 'fuel' },
          ]),
        },
      ],
    });
    const result = readSafely(zip);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.records).toHaveLength(3);
    expect(result.value.files.find((f) => f.path === 'expenses.jsonl')?.records).toBe(2);
    expect(result.value.files.find((f) => f.path === 'vehicles.jsonl')?.records).toBe(1);
  });

  it('o leitor NÃO interpreta os campos dos registos', () => {
    // Um campo que não é do domínio tem de sobreviver à leitura: traduzir campos é
    // trabalho do Normalizer, e um leitor que os conhecesse seria uma segunda fonte de
    // verdade para o formato.
    const { zip } = buildBundle({
      dataFiles: [
        {
          path: 'vehicles.jsonl',
          content: jsonl([{ localId: 'veh_1', plate: 'AA-00-BB', campoDesconhecido: 42 }]),
        },
      ],
    });
    const result = readSafely(zip);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.records[0]!.fields['campoDesconhecido']).toBe(42);
  });

  it('a ordem das linhas no ficheiro não altera o conjunto lido (§13.1)', () => {
    const a = [
      { localId: 'veh_1', plate: 'AA-00-BB' },
      { localId: 'veh_2', plate: 'CC-00-DD' },
    ];
    const b = [...a].reverse();

    const first = readSafely(buildBundle({ dataFiles: [{ path: 'vehicles.jsonl', content: jsonl(a) }] }).zip);
    const second = readSafely(buildBundle({ dataFiles: [{ path: 'vehicles.jsonl', content: jsonl(b) }] }).zip);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const ids = (r: typeof first.value) => [...r.records].map((x) => x.fields['localId']).sort();
    expect(ids(first.value)).toEqual(ids(second.value));
  });

  it('`account.json` é lido à parte dos registos', () => {
    const { zip } = buildBundle({
      dataFiles: [
        { path: 'account.json', content: JSON.stringify({ name: 'Ana', locale: 'pt-PT' }) },
        { path: 'vehicles.jsonl', content: jsonl([{ localId: 'veh_1', plate: 'AA-00-BB' }]) },
      ],
    });
    const result = readSafely(zip);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.account).toEqual({ name: 'Ana', locale: 'pt-PT' });
    // `account.json` não é um registo: não entra na lista a importar.
    expect(result.value.records).toHaveLength(1);
  });

  it('o manifest devolvido corresponde ao do bundle', () => {
    const { zip } = minimalBundle({ bundleId: 'bnd_ffffeeeeddddccccbbbbaaaa99998888' });
    const result = readSafely(zip);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.manifest.format).toBe(EXPORT_FORMAT);
    expect(result.value.manifest.bundleId).toBe('bnd_ffffeeeeddddccccbbbbaaaa99998888');
    expect(result.value.manifest.files.length).toBeGreaterThan(0);
  });

  it('as entradas do manifest e do ZIP concordam no nome do ficheiro obrigatório', () => {
    expect(BUNDLE_MANIFEST_FILE).toBe('manifest.json');
    const { zip } = minimalBundle();
    const entries = entriesOf(zip);
    expect(entries.some((entry) => entry.name === BUNDLE_MANIFEST_FILE)).toBe(true);
  });
});

/* ========================================================================== */
/* 10. Honestidade do construtor de fixtures                                  */
/* ========================================================================== */

describe('honestidade do construtor de bundles', () => {
  it('produz um ZIP que o leitor da Fase 2 aceita', () => {
    const { zip } = minimalBundle();
    const result = readZip(zip);
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it('o `sha256Hex` do construtor e o do leitor coincidem', () => {
    const data = new TextEncoder().encode('verificação cruzada');
    expect(builderSha256(data)).toBe(sha256Hex(data));
  });

  it('um bundle declarado como coerente não é recusado por engano', () => {
    // Contraprova: se o construtor produzisse bundles inválidos por defeito, todos os
    // testes de recusa passariam pela razão errada.
    const { zip } = buildBundle({
      dataFiles: [
        { path: 'vehicles.jsonl', content: jsonl([{ localId: 'veh_1', plate: 'AA-00-BB' }]) },
        { path: 'expenses.jsonl', content: jsonl([{ localId: 'exp_1', amountCents: 1, date: '2026-01-01', category: 'x' }]) },
      ],
      documents: { 'documents/doc_1/x.pdf': '%PDF' },
    });
    const result = readSafely(zip);
    expect(result.ok).toBe(true);
  });
});
