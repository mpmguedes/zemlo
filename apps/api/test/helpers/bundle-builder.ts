/**
 * Construtor de **bundles de importação** para os testes (§5.2, §13).
 *
 * ## Porque é que isto existe
 *
 * A Fase 3 testa o importador contra bundles válidos segundo o contrato §5.2 — ZIP com
 * `manifest.json` e `*.jsonl`. O exportador actual (`services/export.ts`) emite um JSON
 * achatado único e **não** produz este formato; foi decidido (D3) não o reescrever nesta
 * fase. Sem este construtor, os testes teriam de levar o exportador a produzir, como efeito
 * secundário, um formato que ele ainda não implementa — o que seria escrever código
 * provisório no exportador só para desbloquear testes.
 *
 * Este helper é **independente do exportador**, tal como decidido: constrói o bundle a
 * partir de dados explícitos, e continuará a servir quando o Export v1 existir.
 *
 * ## O que ele permite
 *
 * Construir bundles **deliberadamente inválidos** — ficheiro não declarado, `sha256`
 * trocado, manifest malformado, versão incompatível, linha JSONL corrompida. É a mesma
 * disciplina do `zip-builder.ts`: a única forma honesta de testar uma recusa é produzir o
 * caso que deve ser recusado.
 *
 * Vive em `test/` para que seja impossível importá-lo em produção.
 */

import { createHash } from 'node:crypto';

import { BUNDLE_MANIFEST_FILE, EXPORT_FORMAT, FORMAT_VERSION, MANIFEST_VERSION } from '@zemlo/shared';
import { buildZip, utf8 } from './zip-builder.js';

/* ========================================================================== */
/* Configuração mínima de um bundle válido                                    */
/* ========================================================================== */

export interface BundleFileSpec {
  /** Caminho no ZIP (`vehicles.jsonl`, `account.json`, …). */
  readonly path: string;
  /** Conteúdo textual. Convertido para UTF-8. */
  readonly content: string;
}

/**
 * Um ficheiro do bundle cujo **hash declarado** é controlável.
 *
 * Existe para construir o caso adversário "o manifest declara um hash que não corresponde
 * aos bytes". Sem esta separação, o único bundle que um teste conseguiria construir seria
 * o coerente — e a verificação de integridade nunca seria exercitada.
 */
export interface DeclaredFileSpec {
  readonly path: string;
  /** Conteúdo real no ZIP. */
  readonly content: string;
  /** Hash a declarar no manifest. Quando omitido, é o hash real. */
  readonly declaredSha256?: string;
  /** Contagem de registos a declarar. Quando omitida, é a contagem real de linhas. */
  readonly declaredRecords?: number;
}

export interface BundleSpec {
  readonly bundleId?: string;
  readonly formatVersion?: number;
  readonly manifestVersion?: number;
  readonly format?: string;
  readonly dataFiles: readonly DeclaredFileSpec[];
  /** Ficheiros incluídos no ZIP mas **não** declarados no manifest (caso adversário). */
  readonly undeclaredFiles?: readonly BundleFileSpec[];
  /** Ficheiros declarados no manifest mas **ausentes** do ZIP (caso adversário). */
  readonly missingFromZip?: readonly string[];
  /** Bytes de documentos: caminho → conteúdo. */
  readonly documents?: Readonly<Record<string, string>>;
  /** Manifest cru, para os casos em que o JSON tem de ser inválido ou atípico. */
  readonly rawManifest?: string;
  /** Campos extra a fundir no manifest gerado. */
  readonly manifestPatch?: Record<string, unknown>;
  /** Contagens a declarar em `counts`, quando divergem do real. */
  readonly declaredCounts?: Record<string, number>;
}

/* ========================================================================== */
/* Utilitários                                                                */
/* ========================================================================== */

/** `sha256` em hexadecimal minúsculo — o formato que o manifest usa. */
export function sha256Hex(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? utf8(data) : data;
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Converte uma lista de objectos em JSONL.
 *
 * Uma linha por registo, com `\n` final — o mesmo que a §5.2 descreve ("cada linha é um
 * registo independente"). O `\n` final não é decorativo: um ficheiro sem ele deixaria a
 * última linha indistinguível de um ficheiro truncado.
 */
export function jsonl(records: readonly Record<string, unknown>[]): string {
  return records.map((record) => JSON.stringify(record)).join('\n') + (records.length > 0 ? '\n' : '');
}

/** Conta as linhas não vazias de um JSONL. */
export function countLines(content: string): number {
  return content.split('\n').filter((line) => line.trim() !== '').length;
}

/* ========================================================================== */
/* Construção do manifest                                                     */
/* ========================================================================== */

/** Um manifest mínimo mas **completo** segundo `zManifest`. */
export function buildManifest(spec: BundleSpec): Record<string, unknown> {
  const dataFiles = spec.dataFiles.filter((file) => file.path !== 'account.json');

  const counts: Record<string, number> = spec.declaredCounts
    ? { ...spec.declaredCounts }
    : countByKind(spec.dataFiles);

  // O manifest declara **todos** os ficheiros de dados, incluindo os que
  // `missingFromZip` retira do ZIP. É precisamente essa divergência que o caso adversário
  // "ficheiro declarado mas ausente" testa: se o manifest também os omitisse, o bundle
  // seria internamente coerente e nada haveria a recusar.
  const files = dataFiles.map((file) => ({
    path: file.path,
    records: file.declaredRecords ?? countLines(file.content),
    bytes: utf8(file.content).byteLength,
    sha256: file.declaredSha256 ?? sha256Hex(file.content),
  }));

  const accountFile = spec.dataFiles.find((file) => file.path === 'account.json');
  if (accountFile) {
    files.push({
      path: 'account.json',
      bytes: utf8(accountFile.content).byteLength,
      sha256: accountFile.declaredSha256 ?? sha256Hex(accountFile.content),
    });
  }

  const documentPaths = Object.keys(spec.documents ?? {});

  const manifest: Record<string, unknown> = {
    manifestVersion: spec.manifestVersion ?? MANIFEST_VERSION,
    format: spec.format ?? EXPORT_FORMAT,
    formatVersion: spec.formatVersion ?? FORMAT_VERSION,
    createdAt: '2026-09-18T10:00:00.000Z',
    createdBy: { product: 'Zemlo', appVersion: '0.1.0', sourceEnvironment: 'production' },
    bundleId: spec.bundleId ?? 'bnd_0123456789abcdef0123456789abcdef',
    scope: {
      kind: 'full-account',
      vehicleLocalIds: [],
      from: null,
      to: null,
      includesDocuments: documentPaths.length > 0,
      note: null,
    },
    conventions: {
      money: { unit: 'cent', currency: 'EUR' },
      dates: { civil: 'YYYY-MM-DD', instant: 'ISO-8601 UTC' },
      distance: { unit: 'km' },
      volume: { unit: 'L' },
      energy: { unit: 'kWh' },
      missing: 'chave omitida ou null',
    },
    counts,
    files,
    documents: {
      included: documentPaths.length > 0,
      count: documentPaths.length,
      totalBytes: documentPaths.reduce((n, path) => n + utf8(spec.documents![path]!).byteLength, 0),
      missingContent: { count: 0, localIds: [] },
    },
    integrity: { algorithm: 'sha256', covered: 'all-files' },
    dataClasses: [
      { name: 'core', included: true, requiredForMigration: true },
      { name: 'account', included: true, requiredForMigration: false },
      { name: 'documents', included: true, requiredForMigration: false },
      { name: 'audit', included: false, requiredForMigration: false },
    ],
    sharedVehicles: { count: 0, note: 'Nenhum veículo partilhado.' },
    identitySeed: { strategy: 'bundle-unique-local-ids', opaque: true },
    identifiers: { internalIdsIncluded: false },
    csv: { included: false, files: [] },
    extensions: {},
    ...spec.manifestPatch,
  };

  return manifest;
}

/** Mapeia `vehicles.jsonl` → `vehicles`, como o manifest exige. */
function countByKind(files: readonly DeclaredFileSpec[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of files) {
    if (file.path === 'account.json') continue;
    const key = file.path.replace(/\.jsonl$/, '');
    counts[key] = countLines(file.content);
  }
  return counts;
}

/* ========================================================================== */
/* Construção do ZIP                                                          */
/* ========================================================================== */

/** Um bundle pronto: os bytes do ZIP e o manifest que ele contém. */
export interface BuiltBundle {
  readonly zip: Uint8Array;
  readonly manifest: Record<string, unknown>;
}

/**
 * Constrói um ZIP de bundle a partir de uma especificação.
 *
 * O manifest é gerado (ou substituído por `rawManifest`) e os ficheiros são colocados por
 * ordem: manifest primeiro, depois os dados, depois os documentos. A ordem não é
 * significativa para a importação — a §13.3 exige até que ela não altere o resultado — mas
 * é determinística para os testes poderem afirmar sobre bytes quando precisarem.
 */
export function buildBundle(spec: BundleSpec): BuiltBundle {
  const manifest = buildManifest(spec);
  const manifestText = spec.rawManifest ?? JSON.stringify(manifest, null, 2);

  const entries: { name: string; data: Uint8Array }[] = [
    { name: BUNDLE_MANIFEST_FILE, data: utf8(manifestText) },
  ];

  for (const file of spec.dataFiles) {
    if (spec.missingFromZip?.includes(file.path)) continue;
    entries.push({ name: file.path, data: utf8(file.content) });
  }

  for (const file of spec.undeclaredFiles ?? []) {
    entries.push({ name: file.path, data: utf8(file.content) });
  }

  for (const [path, content] of Object.entries(spec.documents ?? {})) {
    entries.push({ name: path, data: utf8(content) });
  }

  const zip = buildZip(entries);

  return { zip, manifest };
}

/* ========================================================================== */
/* Atalhos para bundles comuns                                                */
/* ========================================================================== */

/**
 * Bundle mínimo válido, com um veículo.
 *
 * O veículo traz matrícula porque a **A25** exige identidade mínima — um veículo sem
 * matrícula vai para quarentena, e usá-lo como "bundle válido" faria um teste afirmar algo
 * diferente do que diz.
 */
export function minimalBundle(
  overrides: Partial<BundleSpec> & { vehicleLocalId?: string; plate?: string } = {},
): BuiltBundle {
  const localId = overrides.vehicleLocalId ?? 'veh_1';
  const plate = overrides.plate ?? 'AA-00-BB';

  const vehicles = jsonl([
    {
      localId,
      plate,
      plateDisplay: plate,
      make: 'Kia',
      model: 'EV3',
      year: 2025,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ]);

  return buildBundle({
    dataFiles: [{ path: 'vehicles.jsonl', content: vehicles }],
    ...overrides,
  });
}
