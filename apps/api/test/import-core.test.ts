/**
 * Testes do núcleo do Import/Export — bloco 1 + 2 + 3 (`docs/IMPORT-EXPORT.md`).
 *
 * Cobrem o contrato partilhado, a geração de identificadores e as normalizações que as
 * chaves de deduplicação exigem. Tudo puro: sem base de dados, sem HTTP, sem ZIP.
 *
 * A escolha de testar estas três coisas primeiro não é arbitrária. São a base de que a
 * deduplicação depende, e uma falha numa normalização **não** produz um erro visível:
 * produz um bundle que importa com dados a menos, ou com dados a mais, sem que ninguém
 * perceba. É o único tipo de falha nesta área que não tem sintoma.
 */

import { describe, expect, it } from 'vitest';
import {
  FORMAT_VERSION,
  MANIFEST_VERSION,
  DOCUMENT_CONTENT_STATES,
  BUNDLE_DATA_FILES,
  BUNDLE_DOCUMENT_FILE,
  BUNDLE_DOCUMENT_DIR,
  dataClassesForExport,
  defaultConventions,
  zManifest,
  zBundleDocument,
  bundleFileName,
  zExternalId,
  zImportIssue,
  zExportScope,
} from '@zemlo/shared';
import {
  LOCAL_ID_MAX_LENGTH,
  LOCAL_ID_PREFIXES,
  LocalIdGenerator,
  createLocalIdFactory,
  generateBundleId,
  isValidBundleId,
  isValidLocalId,
  normalizeExternalId,
  normalizeExternalSource,
} from '../src/domain/import/ids.js';
import {
  equalOptional,
  hasUsablePlate,
  hasUsableText,
  hasUsableVin,
  normalizeCentsForCompare,
  normalizeCivilDateForCompare,
  normalizeKwhForCompare,
  normalizeLitresForCompare,
  normalizeOdometerForCompare,
  normalizePlateForCompare,
  normalizeTextForCompare,
  normalizeVinForCompare,
} from '../src/domain/import/normalize.js';

/* ========================================================================== */
/* 1. Contrato partilhado (packages/shared/src/import-export.ts)              */
/* ========================================================================== */

describe('Contrato do bundle — versões e convenções', () => {
  it('manifestVersion e formatVersion são números independentes (§6.1)', () => {
    // A distinção é o que permite acrescentar `documents/` (formatVersion) sem tocar na
    // estrutura do manifest (manifestVersion). Se fossem o mesmo número, qualquer
    // alteração de conteúdo obrigaria a subir a estrutura e quebraria leitores antigos.
    expect(MANIFEST_VERSION).toBe(1);
    expect(FORMAT_VERSION).toBe(1);
  });

  it('as convenções declaram todas as unidades exigidas pela §5.4', () => {
    const conventions = defaultConventions('EUR');
    expect(conventions.money).toEqual({
      unit: 'cent',
      currency: 'EUR',
      note: expect.any(String),
    });
    expect(conventions.distance.unit).toBe('km');
    expect(conventions.volume.unit).toBe('L');
    expect(conventions.energy.unit).toBe('kWh');
    expect(conventions.dates.civil).toBe('YYYY-MM-DD');
    expect(conventions.dates.instant).toBe('ISO-8601 UTC');
  });

  it('a ausência de valor é declarada como omissão ou null, nunca como string vazia (§5.3)', () => {
    expect(defaultConventions('EUR').missing).toBe('chave omitida ou null');
  });

  it('a moeda é declarada, porque o bundle não a pode assumir (§5.4)', () => {
    expect(defaultConventions('GBP').money.currency).toBe('GBP');
  });
});

describe('Contrato do bundle — manifest', () => {
  /** Manifest mínimo válido. Construído a partir do contrato, não copiado do documento. */
  function validManifest(): Record<string, unknown> {
    return {
      manifestVersion: MANIFEST_VERSION,
      format: 'zemlo-export',
      formatVersion: FORMAT_VERSION,
      createdAt: '2026-02-14T10:12:00.000Z',
      createdBy: { product: 'Zemlo', appVersion: '0.1.0', sourceEnvironment: 'production' },
      bundleId: 'bnd_9f3c1a2b3c4d5e6f',
      scope: {
        kind: 'full-account',
        vehicleLocalIds: null,
        from: null,
        to: null,
        includesDocuments: true,
        note: null,
      },
      conventions: defaultConventions('EUR'),
      counts: { vehicles: 2, expenses: 52 },
      files: [
        { path: 'vehicles.jsonl', records: 2, bytes: 4096, sha256: 'a'.repeat(64) },
      ],
      documents: {
        included: true,
        count: 4,
        totalBytes: 1843200,
        missingContent: { count: 0, localIds: [] },
      },
      integrity: { algorithm: 'sha256', covered: 'all-files' },
      dataClasses: dataClassesForExport(),
      sharedVehicles: { count: 0, note: 'sem veículos partilhados' },
      identitySeed: { strategy: 'bundle-unique-local-ids', opaque: true },
      identifiers: { internalIdsIncluded: false },
      csv: { included: true, files: ['veiculos.csv'] },
      extensions: {},
    };
  }

  it('aceita um manifest completo e válido', () => {
    const result = zManifest.safeParse(validManifest());
    expect(result.success).toBe(true);
  });

  it('recusa um manifest com format desconhecido — um CSV não é um bundle (§12.1)', () => {
    const manifest = { ...validManifest(), format: 'csv' };
    const result = zManifest.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  it('recusa um manifest sem bundleId, porque sem ele não há idempotência (§9.5)', () => {
    const manifest = { ...validManifest() };
    delete manifest.bundleId;
    expect(zManifest.safeParse(manifest).success).toBe(false);
  });

  it('ignora chaves desconhecidas — compatibilidade para a frente (§12.1)', () => {
    // Um manifest v2 lido por um importador v1 tem de continuar a importar. Zod remove
    // chaves não declaradas em vez de recusar, que é exatamente o comportamento exigido.
    const manifest = { ...validManifest(), campoDeUmaVersaoFutura: { algo: true } };
    const result = zManifest.safeParse(manifest);
    expect(result.success).toBe(true);
  });

  it('exige hash sha256 com 64 caracteres hexadecimais', () => {
    const manifest = validManifest();
    (manifest.files as Array<Record<string, unknown>>)[0] = {
      path: 'vehicles.jsonl',
      bytes: 10,
      sha256: 'curto-demais',
    };
    expect(zManifest.safeParse(manifest).success).toBe(false);
  });

  it('aceita createdAt com deslocamento, não só em UTC (§5.3)', () => {
    const manifest = { ...validManifest(), createdAt: '2026-02-14T10:12:00.000+00:00' };
    expect(zManifest.safeParse(manifest).success).toBe(true);
  });
});

describe('Contrato do bundle — documentos e missingContent (§5.6)', () => {
  function document(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      localId: 'doc_1',
      name: 'Fatura da revisão',
      category: 'maintenance',
      contentState: 'included',
      ...overrides,
    };
  }

  it('representa um documento com conteúdo incluído no bundle', () => {
    const result = zBundleDocument.safeParse(
      document({
        contentPath: 'documents/doc_1/fatura.pdf',
        contentSha256: 'b'.repeat(64),
        fileName: 'fatura.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 184320,
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contentState).toBe('included');
      expect(result.data.contentPath).toBe('documents/doc_1/fatura.pdf');
    }
  });

  it('representa um documento cujo conteúdo não está disponível como missingContent', () => {
    // O ponto central da decisão 2: o registo é exportado, a lacuna é declarada, e
    // nenhum conteúdo é inventado para a preencher.
    const result = zBundleDocument.safeParse(
      document({ contentState: 'missingContent', fileName: 'fatura.pdf', sizeBytes: 184320 }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contentState).toBe('missingContent');
      expect(result.data.contentPath).toBeUndefined();
      expect(result.data.contentSha256).toBeUndefined();
    }
  });

  it('o estado do conteúdo é um estado nomeado, não um booleano (§5.6)', () => {
    // A razão de ser: quando existir uma camada de armazenamento, o conteúdo passa a
    // estar disponível por referência. Um booleano `hasContent` não conseguiria
    // distinguir "não existe" de "existe noutro sítio" e obrigaria a quebrar o formato.
    expect(DOCUMENT_CONTENT_STATES).toContain('included');
    expect(DOCUMENT_CONTENT_STATES).toContain('missingContent');
    expect(DOCUMENT_CONTENT_STATES).toContain('externalReference');
  });

  it('aceita externalReference — o estado reservado para a camada de armazenamento', () => {
    // Reservado e não produzido pela v1, mas o contrato já o aceita. É isto que garante
    // que acrescentar bytes por referência não obriga a subir formatVersion.
    const result = zBundleDocument.safeParse(
      document({ contentState: 'externalReference' }),
    );
    expect(result.success).toBe(true);
  });

  it('recusa um contentState inventado', () => {
    expect(zBundleDocument.safeParse(document({ contentState: 'talvez' })).success).toBe(false);
  });

  it('um documento sem veículo é válido — uma carta de condução não tem veículo (§5.5)', () => {
    const result = zBundleDocument.safeParse(document({ contentState: 'missingContent' }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.vehicleLocalId).toBeUndefined();
  });

  it('o nome do ficheiro do bundle identifica documento e versão', () => {
    expect(bundleFileName('2026-02-14')).toBe('zemlo-export-2026-02-14.zip');
  });
});

describe('Contrato do bundle — classes de dados e nomes de ficheiro', () => {
  it('declara a exclusão de segredos com motivo, nunca em silêncio (§6.2, decisão 4)', () => {
    const classes = dataClassesForExport();
    const secrets = classes.find((entry) => entry.name === 'integrationSecrets');
    expect(secrets?.included).toBe(false);
    expect(secrets?.reason).toBeTruthy();
  });

  it('AuditLog, Notifications e SuggestionState ficam excluídos por omissão (decisão 5)', () => {
    const classes = dataClassesForExport();
    for (const name of ['audit', 'notifications', 'suggestions'] as const) {
      const entry = classes.find((item) => item.name === name);
      expect(entry?.included).toBe(false);
    }
  });

  it('o núcleo e a conta são obrigatórios para uma migração (§6.2)', () => {
    const classes = dataClassesForExport();
    expect(classes.find((entry) => entry.name === 'core')?.requiredForMigration).toBe(true);
    expect(classes.find((entry) => entry.name === 'account')?.requiredForMigration).toBe(true);
  });

  it('os ficheiros de dados seguem a estrutura da §5.2 e a decisão 11 (csv/<tipo>.csv)', () => {
    expect(BUNDLE_DATA_FILES.expenses).toBe('expenses.jsonl');
    expect(BUNDLE_DATA_FILES.documents).toBe('documents.jsonl');
    expect(BUNDLE_DATA_FILES.vehicles).toBe('vehicles.jsonl');
  });

  it('os documentos ficam em documents/<localId>/<nome> e o manifest em manifest.json', () => {
    expect(BUNDLE_DOCUMENT_FILE).toBe('manifest.json');
    expect(BUNDLE_DOCUMENT_DIR).toBe('documents');
  });
});

/* ========================================================================== */
/* 2. Identificadores (domain/import/ids.ts)                                   */
/* ========================================================================== */

describe('localId — validação (§2.1, §13.4)', () => {
  it('aceita os formatos que o exportador produz', () => {
    for (const id of ['veh_1', 'exp_42', 'doc_3', 'fuel_1000']) {
      expect(isValidLocalId(id)).toBe(true);
    }
  });

  it('recusa a travessia de caminho — o localId acaba num caminho de pasta (§5.6)', () => {
    // Crítico: `documents/<localId>/<nome>`. Um localId controlado pelo atacante que
    // passe por aqui escreve ficheiros fora da área temporária.
    expect(isValidLocalId('../../etc/passwd')).toBe(false);
    expect(isValidLocalId('..')).toBe(false);
    expect(isValidLocalId('veh_1/../../x')).toBe(false);
    expect(isValidLocalId('veh..1')).toBe(false);
  });

  it('recusa caminhos absolutos e separadores', () => {
    expect(isValidLocalId('/etc/passwd')).toBe(false);
    expect(isValidLocalId('C:\\Windows')).toBe(false);
    expect(isValidLocalId('veh/1')).toBe(false);
    expect(isValidLocalId('veh\\1')).toBe(false);
  });

  it('recusa espaços, caracteres de controlo e pontuação de caminho', () => {
    expect(isValidLocalId('veh 1')).toBe(false);
    expect(isValidLocalId('veh:1')).toBe(false);
    expect(isValidLocalId('veh\u0000')).toBe(false);
    expect(isValidLocalId('veh_1\n')).toBe(false);
  });

  it('recusa vazio, não-string e valores acima do limite', () => {
    expect(isValidLocalId('')).toBe(false);
    expect(isValidLocalId(null)).toBe(false);
    expect(isValidLocalId(42)).toBe(false);
    expect(isValidLocalId('v'.repeat(LOCAL_ID_MAX_LENGTH + 1))).toBe(false);
  });

  it('aceita exactamente o comprimento máximo', () => {
    const atLimit = 'v'.repeat(LOCAL_ID_MAX_LENGTH);
    expect(isValidLocalId(atLimit)).toBe(true);
  });
});

describe('localId — geração', () => {
  it('numera por tipo, com contadores independentes', () => {
    const generator = new LocalIdGenerator();
    expect(generator.next(LOCAL_ID_PREFIXES.vehicle)).toBe('veh_1');
    expect(generator.next(LOCAL_ID_PREFIXES.vehicle)).toBe('veh_2');
    // O contador de despesas não é afetado pelo de veículos.
    expect(generator.next(LOCAL_ID_PREFIXES.expense)).toBe('exp_1');
    expect(generator.next(LOCAL_ID_PREFIXES.vehicle)).toBe('veh_3');
  });

  it('expõe a contagem emitida, para o manifest e para os testes', () => {
    const generator = new LocalIdGenerator();
    generator.next(LOCAL_ID_PREFIXES.document);
    generator.next(LOCAL_ID_PREFIXES.document);
    expect(generator.count(LOCAL_ID_PREFIXES.document)).toBe(2);
    expect(generator.count(LOCAL_ID_PREFIXES.expense)).toBe(0);
  });

  it('nunca emite dois identificadores iguais dentro de um bundle', () => {
    const generator = new LocalIdGenerator();
    const emitted = new Set<string>();
    for (let index = 0; index < 500; index += 1) {
      emitted.add(generator.next(LOCAL_ID_PREFIXES.event));
    }
    expect(emitted.size).toBe(500);
  });

  it('todos os identificadores emitidos são válidos', () => {
    const generator = new LocalIdGenerator();
    for (const prefix of Object.values(LOCAL_ID_PREFIXES)) {
      expect(isValidLocalId(generator.next(prefix))).toBe(true);
    }
  });

  it('duas exportações produzem sequências independentes (§2.1)', () => {
    const first = createLocalIdFactory(LOCAL_ID_PREFIXES.vehicle);
    const second = createLocalIdFactory(LOCAL_ID_PREFIXES.vehicle);
    expect(first()).toBe('veh_1');
    expect(first()).toBe('veh_2');
    // A segunda exportação recomeça: é isso que torna o localId local ao bundle.
    expect(second()).toBe('veh_1');
  });
});

describe('bundleId (§9.5)', () => {
  it('tem a forma esperada', () => {
    const id = generateBundleId();
    expect(isValidBundleId(id)).toBe(true);
    expect(id.startsWith('bnd_')).toBe(true);
  });

  it('é único entre milhares de gerações', () => {
    const ids = new Set<string>();
    for (let index = 0; index < 5000; index += 1) ids.add(generateBundleId());
    expect(ids.size).toBe(5000);
  });

  it('recusa identificadores de bundle malformados', () => {
    expect(isValidBundleId('9f3c1a2b')).toBe(false);
    expect(isValidBundleId('bnd_')).toBe(false);
    expect(isValidBundleId('bnd_ZZZZ')).toBe(false);
    expect(isValidBundleId(null)).toBe(false);
  });
});

describe('externalIds — normalização (§2.3)', () => {
  it('remove espaços nas pontas do identificador', () => {
    expect(normalizeExternalId('  12345  ')).toBe('12345');
  });

  it('não altera o conteúdo do identificador — é opaco também para nós', () => {
    // "Normalizar" um identificador alheio com base numa suposição sobre o sistema de
    // origem é a forma mais rápida de deixar de reconhecer registos já importados.
    expect(normalizeExternalId('ABC-123/xy')).toBe('ABC-123/xy');
    expect(normalizeExternalId('ID 42')).toBe('ID 42');
  });

  it('normaliza o nome da origem, que é nosso e comparado por nós', () => {
    expect(normalizeExternalSource('  Outra   App ')).toBe('outra app');
    expect(normalizeExternalSource('OUTRA APP')).toBe('outra app');
    // Duas grafias da mesma origem têm de coincidir, ou a segunda importação não
    // reconhece o que a primeira já importou.
    expect(normalizeExternalSource('Outra App')).toBe(normalizeExternalSource('outra   app'));
  });

  it('aceita o par origem/identificador no contrato', () => {
    expect(zExternalId.safeParse({ source: 'outra-app', id: '12345' }).success).toBe(true);
    expect(zExternalId.safeParse({ source: '', id: '1' }).success).toBe(false);
  });
});

/* ========================================================================== */
/* 3. Normalizações (domain/import/normalize.ts) — §8.5                        */
/* ========================================================================== */

describe('normalizePlateForCompare (§8.5)', () => {
  it('devolve a mesma chave para todas as grafias da mesma matrícula', () => {
    // A razão de existir: se `42-38-1EL` e `42381EL` produzirem chaves diferentes, o
    // mesmo veículo é importado duas vezes e o utilizador fica com dois veículos.
    const expected = '42381EL';
    for (const input of ['42-38-1EL', '42381EL', '42 38 1E L', '4238.1EL', '42-38-1el']) {
      expect(normalizePlateForCompare(input)).toBe(expected);
    }
  });

  it('devolve string vazia para entrada ausente, nunca null', () => {
    expect(normalizePlateForCompare(null)).toBe('');
    expect(normalizePlateForCompare(undefined)).toBe('');
    expect(normalizePlateForCompare('')).toBe('');
  });

  it('é idempotente — condição da propriedade "importar duas vezes = uma" (§13.3)', () => {
    for (const input of ['42-38-1EL', 'AA-00-BB', '1234 XY']) {
      const once = normalizePlateForCompare(input);
      expect(normalizePlateForCompare(once)).toBe(once);
    }
  });

  it('não rejeita matrículas estrangeiras — a §8.4 exige que sejam deduplicáveis', () => {
    expect(normalizePlateForCompare('B-AB 1234')).toBe('BAB1234');
    expect(hasUsablePlate('B-AB 1234')).toBe(true);
  });

  it('considera inutilizável uma matrícula demasiado curta para ser chave', () => {
    expect(hasUsablePlate('AB')).toBe(false);
    expect(hasUsablePlate(null)).toBe(false);
    expect(hasUsablePlate('1234')).toBe(true);
  });
});

describe('normalizeVinForCompare (§8.5)', () => {
  it('normaliza maiúsculas e remove separadores', () => {
    expect(normalizeVinForCompare(' wvwzzz1kz9w123456 ')).toBe('WVWZZZ1KZ9W123456');
    expect(normalizeVinForCompare('WVW-ZZZ1KZ-9W123456')).toBe('WVWZZZ1KZ9W123456');
  });

  it('aceita um VIN de forma válida como chave certa', () => {
    expect(hasUsableVin('WVWZZZ1KZ9W123456')).toBe(true);
  });

  it('recusa um VIN com I, O ou Q — não pode passar por coincidência exata (§8.4)', () => {
    // I, O e Q confundem-se com 1 e 0. Um VIN que os contenha está mal transcrito e
    // fazer dele uma chave "certa" produziria um falso duplicado exato.
    expect(hasUsableVin('WVWIZZ1KZ9W123456')).toBe(false);
    expect(hasUsableVin('WVWOZZ1KZ9W123456')).toBe(false);
    expect(hasUsableVin('WVWQZZ1KZ9W123456')).toBe(false);
  });

  it('recusa um VIN com comprimento errado', () => {
    expect(hasUsableVin('WVWZZZ1KZ9W12345')).toBe(false);
    expect(hasUsableVin('WVWZZZ1KZ9W1234567')).toBe(false);
  });

  it('um VIN inválido continua a ser normalizado, para poder ser exportado e mostrado', () => {
    // Separar normalização de validação permite que o dado atípico sobreviva (§49) sem
    // contaminar a deduplicação.
    expect(normalizeVinForCompare('wvwizz1kz9w123456')).toBe('WVWIZZ1KZ9W123456');
  });

  it('é idempotente', () => {
    const once = normalizeVinForCompare('wvw-zzz');
    expect(normalizeVinForCompare(once)).toBe(once);
  });
});

describe('normalizeTextForCompare (§8.5)', () => {
  it('colapsa maiúsculas, acentos e pontuação', () => {
    expect(normalizeTextForCompare('Auto-Silva')).toBe('auto silva');
    expect(normalizeTextForCompare('AUTO SILVA')).toBe('auto silva');
    expect(normalizeTextForCompare('Autosilva')).toBe('autosilva');
  });

  it('remove a forma societária, que é ruído e não identidade', () => {
    // "Oficina Silva, Lda" e "Oficina Silva" são o mesmo fornecedor para efeitos de
    // duplicação. Sem isto, o mesmo fornecedor aparece duas vezes na conta.
    const expected = 'oficina silva';
    for (const input of [
      'Oficina Silva, Lda',
      'OFICINA SILVA LDA',
      'Oficina Silva, S.A.',
      'Oficina Silva, Unipessoal Lda',
      'Oficina Silva Sociedade Unipessoal Limitada',
    ]) {
      expect(normalizeTextForCompare(input)).toBe(expected);
    }
  });

  it('remove acentos, para que a mesma palavra coincida', () => {
    expect(normalizeTextForCompare('Combustível')).toBe('combustivel');
    expect(normalizeTextForCompare('Confecções')).toBe('confeccoes');
  });

  it('remove a forma societária só como palavra — não a retira de dentro de palavras', () => {
    // Sem fronteira de palavra, `sa` seria removido de `casa` e `lda` de `solda`.
    expect(normalizeTextForCompare('Casa das Peças')).toBe('casa das pecas');
    expect(normalizeTextForCompare('Solda Rápida')).toBe('solda rapida');
  });

  it('colapsa espaços múltiplos, incluindo os deixados pela remoção de sufixos', () => {
    expect(normalizeTextForCompare('  Auto   Silva,   Lda  ')).toBe('auto silva');
    expect(normalizeTextForCompare('Posto   GALP')).toBe('posto galp');
  });

  it('é idempotente — condição de "importar duas vezes = uma" (§13.3)', () => {
    for (const input of ['Oficina Silva, Lda', 'Combustível', '  AUTO  SILVA ']) {
      const once = normalizeTextForCompare(input);
      expect(normalizeTextForCompare(once)).toBe(once);
    }
  });

  it('trata a ausência de texto como inutilizável para comparação', () => {
    // Sem este guarda, duas despesas do mesmo dia e valor, ambas sem descrição,
    // coincidiriam em três campos vazios e passariam a duplicado certo.
    expect(hasUsableText(null)).toBe(false);
    expect(hasUsableText('')).toBe(false);
    expect(hasUsableText('   ')).toBe(false);
    expect(hasUsableText('Lda')).toBe(false);
    expect(hasUsableText('Oficina')).toBe(true);
  });
});

describe('normalizeCivilDateForCompare (§8.5, §8.6)', () => {
  it('mantém a forma canónica', () => {
    expect(normalizeCivilDateForCompare('2026-02-10')).toBe('2026-02-10');
  });

  it('preenche zeros à esquerda em falta', () => {
    expect(normalizeCivilDateForCompare('2026-2-1')).toBe('2026-02-01');
  });

  it('reduz um instante completo à data civil em UTC', () => {
    expect(normalizeCivilDateForCompare('2026-02-10T18:33:58.892Z')).toBe('2026-02-10');
    expect(normalizeCivilDateForCompare('2026-02-10T00:00:00.000+00:00')).toBe('2026-02-10');
  });

  it('interpreta a forma portuguesa com o dia primeiro', () => {
    // A alternativa americanizada leria 10/02/2026 como 2 de outubro e deslocaria cada
    // despesa em oito meses — um erro silencioso e devastador numa migração.
    expect(normalizeCivilDateForCompare('10/02/2026')).toBe('2026-02-10');
    expect(normalizeCivilDateForCompare('10-02-2026')).toBe('2026-02-10');
    expect(normalizeCivilDateForCompare('1/3/2026')).toBe('2026-03-01');
  });

  it('recusa uma data que não existe no calendário', () => {
    // `2026-02-30` passa a expressão regular e não existe no calendário.
    expect(normalizeCivilDateForCompare('2026-02-30')).toBeNull();
    expect(normalizeCivilDateForCompare('2026-13-01')).toBeNull();
    expect(normalizeCivilDateForCompare('2026-00-10')).toBeNull();
    expect(normalizeCivilDateForCompare('2026-04-31')).toBeNull();
  });

  it('aceita 29 de fevereiro num ano bissexto e recusa-o noutro', () => {
    expect(normalizeCivilDateForCompare('2024-02-29')).toBe('2024-02-29');
    expect(normalizeCivilDateForCompare('2026-02-29')).toBeNull();
  });

  it('devolve null para o que não consegue interpretar — nunca uma data adivinhada', () => {
    // Uma data errada por um dia é um dado errado, não um duplicado (§8.6).
    expect(normalizeCivilDateForCompare('ontem')).toBeNull();
    expect(normalizeCivilDateForCompare('')).toBeNull();
    expect(normalizeCivilDateForCompare(null)).toBeNull();
    expect(normalizeCivilDateForCompare('10/2026')).toBeNull();
  });

  it('é idempotente', () => {
    for (const input of ['10/02/2026', '2026-2-1', '2026-02-10T18:33:58.892Z']) {
      const once = normalizeCivilDateForCompare(input);
      expect(once).not.toBeNull();
      expect(normalizeCivilDateForCompare(once)).toBe(once);
    }
  });
});

describe('normalize numérico (§8.5, §8.6)', () => {
  it('arredonda valores monetários ao cêntimo', () => {
    expect(normalizeCentsForCompare(4210.4)).toBe(4210);
    expect(normalizeCentsForCompare(4210.6)).toBe(4211);
    expect(normalizeCentsForCompare(4210)).toBe(4210);
  });

  it('arredonda o odómetro a inteiro', () => {
    expect(normalizeOdometerForCompare(123456.7)).toBe(123457);
  });

  it('não aplica tolerância na normalização — a tolerância pertence à comparação', () => {
    // Misturar as duas tornaria impossível dizer se dois valores são iguais ou apenas
    // próximos, e é essa distinção que separa "certo" de "provável".
    expect(normalizeOdometerForCompare(100000)).toBe(100000);
    expect(normalizeOdometerForCompare(100049)).toBe(100049);
    expect(normalizeOdometerForCompare(100049)).not.toBe(normalizeOdometerForCompare(100000));
  });

  it('remove ruído de vírgula flutuante nos litros', () => {
    // `42.350000000000001` e `42.35` são o mesmo valor medido na mesma bomba.
    expect(normalizeLitresForCompare(42.350000000000001)).toBe(42.35);
    expect(normalizeLitresForCompare(42.35)).toBe(42.35);
  });

  it('normaliza energia com a mesma regra dos litros', () => {
    expect(normalizeKwhForCompare(31.200000000000003)).toBe(31.2);
  });

  it('devolve null para valores ausentes ou não finitos, nunca zero', () => {
    // `null` é ausência; `0` é um valor. Confundi-los faria um abastecimento sem
    // quilometragem coincidir com outro com 0 km.
    expect(normalizeCentsForCompare(null)).toBeNull();
    expect(normalizeCentsForCompare(undefined)).toBeNull();
    expect(normalizeLitresForCompare(Number.NaN)).toBeNull();
    expect(normalizeKwhForCompare(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('equalOptional — dois null não são iguais', () => {
  it('trata dois valores ausentes como não coincidentes', () => {
    // O erro mais comum das chaves compostas: dois registos sem data, ou sem valor,
    // coincidiriam num campo que nenhum preenche e subiriam a duplicado certo.
    expect(equalOptional(null, null)).toBe(false);
    expect(equalOptional(undefined, undefined)).toBe(false);
    expect(equalOptional(null, undefined)).toBe(false);
  });

  it('trata valores iguais como coincidentes', () => {
    expect(equalOptional(0, 0)).toBe(true);
    expect(equalOptional('', '')).toBe(true);
    expect(equalOptional('a', 'a')).toBe(true);
  });

  it('trata valores diferentes como não coincidentes', () => {
    expect(equalOptional(1, 2)).toBe(false);
    expect(equalOptional('a', 'b')).toBe(false);
    expect(equalOptional(null, 0)).toBe(false);
    expect(equalOptional(0, null)).toBe(false);
  });
});

/* ========================================================================== */
/* 4. Âmbito e problemas (§5.7, §9.1)                                          */
/* ========================================================================== */

describe('Âmbito da exportação (§5.7, decisão 6)', () => {
  it('aceita uma exportação total com âmbito explícito', () => {
    const result = zExportScope.safeParse({
      kind: 'full-account',
      vehicleLocalIds: null,
      from: null,
      to: null,
      includesDocuments: true,
      note: null,
    });
    expect(result.success).toBe(true);
  });

  it('aceita uma exportação parcial, declarando os veículos e o intervalo', () => {
    const result = zExportScope.safeParse({
      kind: 'combination',
      vehicleLocalIds: ['veh_1', 'veh_2'],
      from: '2024-01-01',
      to: '2026-02-14',
      includesDocuments: true,
      note: 'Migração para conta nova',
    });
    expect(result.success).toBe(true);
  });

  it('recusa um âmbito de tipo inventado — um bundle filtrado não pode ser ambíguo', () => {
    const result = zExportScope.safeParse({
      kind: 'parcial',
      vehicleLocalIds: null,
      from: null,
      to: null,
      includesDocuments: true,
      note: null,
    });
    expect(result.success).toBe(false);
  });

  it('recusa uma data de âmbito inexistente no calendário', () => {
    const result = zExportScope.safeParse({
      kind: 'date-range',
      vehicleLocalIds: null,
      from: '2026-02-30',
      to: null,
      includesDocuments: true,
      note: null,
    });
    expect(result.success).toBe(false);
  });
});

describe('Problemas de importação (§9.1, §9.2)', () => {
  it('distingue bloqueante, recuperável e informativo', () => {
    // A distinção não é decorativa: é o que permite dizer "o que aconteceu" em vez de
    // "que falhou".
    for (const severity of ['blocking', 'recoverable', 'info'] as const) {
      const result = zImportIssue.safeParse({
        severity,
        code: 'test',
        message: 'Mensagem legível para o utilizador.',
      });
      expect(result.success).toBe(true);
    }
  });

  it('recusa uma gravidade inventada', () => {
    const result = zImportIssue.safeParse({
      severity: 'grave',
      code: 'test',
      message: 'x',
    });
    expect(result.success).toBe(false);
  });

  it('localiza o problema no registo, no campo, no ficheiro e na linha', () => {
    // Numa importação de 8 000 registos, "3 registos com problemas" sem os nomear é
    // informação inútil (§9.2).
    const result = zImportIssue.safeParse({
      severity: 'recoverable',
      code: 'expense.negative_amount',
      message: 'O valor desta despesa é negativo. Vai entrar com a lacuna declarada.',
      localId: 'exp_42',
      field: 'amountCents',
      file: 'expenses.jsonl',
      line: 17,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.localId).toBe('exp_42');
      expect(result.data.line).toBe(17);
    }
  });

  it('exige uma mensagem, porque um problema sem descrição não é acionável', () => {
    const result = zImportIssue.safeParse({ severity: 'blocking', code: 'x' });
    expect(result.success).toBe(false);
  });
});
