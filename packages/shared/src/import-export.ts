/**
 * Importação e exportação (§54) — contrato partilhado entre a API e os clientes.
 *
 * Este ficheiro descreve a **forma** dos artefactos de portabilidade: o manifest, as
 * convenções declaradas, o conteúdo dos ficheiros de dados e o relatório de importação.
 * É a concretização em tipos de `docs/IMPORT-EXPORT.md` §5, §6 e §9.
 *
 * Três distinções que este contrato recusa misturar (§2), porque é da confusão entre
 * elas que nascem os erros de desenho nesta área:
 *
 *  - `localId` — identidade de **transporte**, local ao bundle e opaca. Liga registos
 *    dentro do bundle e regista o que já foi importado. Não é identidade de domínio e
 *    não serve para decidir se dois registos são o mesmo;
 *  - **chave de deduplicação** — identidade de **conteúdo**. É o que responde a "este
 *    registo já existe?";
 *  - `externalIds` — identidade **na origem anterior**. Transportada, nunca descartada,
 *    para que uma segunda importação reconheça o que já entrou.
 *
 * O formato do `localId` nunca é interpretado pelo importador. É isso que permite
 * alterá-lo numa versão futura sem quebrar bundles antigos.
 */

import { z } from 'zod';
import { zCivilDate, zInstant } from './contracts.js';

/* -------------------------------------------------------------------------- */
/* Versões                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Versão da **estrutura do manifest** (§6.1). Sobe quando muda o próprio manifest:
 * campos, ficheiros, convenções. Um importador de v1 continua a ler um manifest v2
 * desde que as chaves que conhece continuem presentes — é a compatibilidade para a
 * frente exigida pela §12.1.
 */
export const MANIFEST_VERSION = 1;

/**
 * Versão da **semântica dos dados** (§6.1). Sobe quando um consumidor externo puder
 * interpretar mal os dados (§12.3): mudar a unidade de um campo, mudar o significado
 * de um campo, tornar obrigatória uma relação que era opcional, acrescentar ou remover
 * um ficheiro de dados.
 *
 * Não sobe por acrescentar um campo opcional, corrigir texto de `notes` ou acrescentar
 * uma categoria ao registo de domínio.
 */
export const FORMAT_VERSION = 1;

/** Valor do campo `format` do manifest. Distingue o bundle Zemlo de um CSV qualquer. */
export const EXPORT_FORMAT = 'zemlo-export';

/** Versão mais antiga de `formatVersion` que esta aplicação ainda consegue migrar. */
export const MIN_SUPPORTED_FORMAT_VERSION = 1;

/* -------------------------------------------------------------------------- */
/* Convenções declaradas (§5.4)                                                */
/* -------------------------------------------------------------------------- */

/**
 * O bundle declara a sua própria semântica.
 *
 * Sem isto, um ficheiro Zemlo só é interpretável por quem já conhece o Zemlo — que é
 * exatamente o que a portabilidade deve evitar. As unidades são declaradas, nunca
 * implícitas (§5.3).
 */
export const zConventions = z.object({
  money: z.object({
    unit: z.literal('cent'),
    currency: z.string().min(3).max(3),
    note: z.string().optional(),
  }),
  dates: z.object({
    civil: z.literal('YYYY-MM-DD'),
    instant: z.literal('ISO-8601 UTC'),
  }),
  distance: z.object({ unit: z.literal('km') }),
  volume: z.object({ unit: z.literal('L') }),
  energy: z.object({ unit: z.literal('kWh') }),
  /** Como a ausência de um valor é representada. Nunca `""`, que é um valor (§5.3). */
  missing: z.literal('chave omitida ou null'),
});
export type Conventions = z.infer<typeof zConventions>;

/** Conjunto de convenções que o exportador atual produz. Uma única fonte de verdade. */
export function defaultConventions(currency: string): Conventions {
  return {
    money: {
      unit: 'cent',
      currency,
      note: 'inteiro; divide por 100 para euros',
    },
    dates: { civil: 'YYYY-MM-DD', instant: 'ISO-8601 UTC' },
    distance: { unit: 'km' },
    volume: { unit: 'L' },
    energy: { unit: 'kWh' },
    missing: 'chave omitida ou null',
  };
}

/* -------------------------------------------------------------------------- */
/* Âmbito (§5.7, decisão 6)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A exportação parcial é suportada e o âmbito é **sempre explícito**.
 *
 * Um bundle filtrado é indistinguível de um bundle corrompido para quem apenas conta
 * registos; declarar o âmbito é o que impede essa ambiguidade. Consequência na
 * importação: o que o âmbito exclui é uma **lacuna legítima**, não um erro, e a
 * importação não tenta completá-lo.
 */
export const zExportScope = z.object({
  kind: z.enum(['full-account', 'vehicles', 'date-range', 'combination']),
  vehicleLocalIds: z.array(z.string()).nullable(),
  from: zCivilDate.nullable(),
  to: zCivilDate.nullable(),
  includesDocuments: z.boolean(),
  /** Texto do utilizador, quando existir. */
  note: z.string().nullable(),
});
export type ExportScope = z.infer<typeof zExportScope>;

/* -------------------------------------------------------------------------- */
/* Classes de dados (§6.2, decisões 2, 4 e 5)                                   */
/* -------------------------------------------------------------------------- */

/**
 * O manifest declara, classe a classe, o que está e o que não está incluído.
 *
 * Uma exclusão silenciosa é indistinguível de uma perda de dados. Ao declarar
 * `included: false` com o motivo, o utilizador sabe o que ficou de fora antes de
 * confiar um histórico ao ficheiro.
 */
export const DATA_CLASS_NAMES = [
  'core',
  'account',
  'documents',
  'audit',
  'notifications',
  'suggestions',
  'integrationSecrets',
  'shared',
] as const;
export type DataClassName = (typeof DATA_CLASS_NAMES)[number];

export const zDataClass = z.object({
  name: z.enum(DATA_CLASS_NAMES),
  included: z.boolean(),
  requiredForMigration: z.boolean(),
  /** Obrigatório quando `included` é `false`: uma exclusão tem sempre motivo declarado. */
  reason: z.string().optional(),
});
export type DataClass = z.infer<typeof zDataClass>;

/**
 * As classes de dados que o export nativo produz.
 *
 * Duas exclusões merecem ser lidas com atenção, porque são decisões de produto e não
 * omissões:
 *
 *  - **`integrationSecrets`** (decisão 4): tokens, passwords e credenciais **nunca** são
 *    exportados. Um ficheiro de exportação circula por email, por pen drive e por
 *    armazenamento na nuvem; credenciais dentro dele são uma credencial perdida. As
 *    integrações são reconfiguradas no destino, e o `reason` diz isso ao utilizador.
 *  - **`shared`** (decisão 2): dados de agregações partilhadas envolvem terceiros. Exportar
 *    dados de outra pessoa porque partilha um veículo consigo seria exportar dados que não
 *    são do utilizador. Os veículos partilhados entram no destino como dados próprios —
 *    `sharedVehicles` declara quantos — mas os dados de terceiros nunca saem.
 */
export function dataClassesForExport(): DataClass[] {
  return [
    { name: 'core', included: true, requiredForMigration: true },
    { name: 'account', included: true, requiredForMigration: true },
    { name: 'documents', included: true, requiredForMigration: false },
    { name: 'audit', included: false, requiredForMigration: false },
    { name: 'notifications', included: false, requiredForMigration: false },
    { name: 'suggestions', included: false, requiredForMigration: false },
    {
      name: 'integrationSecrets',
      included: false,
      requiredForMigration: false,
      reason: 'tokens, passwords e credenciais de integrações nunca são exportados',
    },
    {
      name: 'shared',
      included: false,
      requiredForMigration: false,
      reason:
        'dados de agregações partilhadas envolvem outros utilizadores',
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Ficheiros e integridade (§5.1, §6)                                          */
/* -------------------------------------------------------------------------- */

export const zManifestFile = z.object({
  path: z.string().min(1),
  /** Ausente para ficheiros binários (documentos), onde a contagem não se aplica. */
  records: z.number().int().min(0).optional(),
  bytes: z.number().int().min(0),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ManifestFile = z.infer<typeof zManifestFile>;

/**
 * Estado do conteúdo binário de um documento.
 *
 * ## Porque é que isto é um estado, e não um booleano
 *
 * A v1 (decisão 1) exporta os bytes originais. Mas há documentos cujos bytes não estão
 * disponíveis no momento da exportação — e, mais importante para o futuro, haverá
 * documentos cujo conteúdo exista **noutra camada** (um backend de armazenamento) e
 * possa vir a ser incluído sem alterar este contrato.
 *
 * Um booleano `hasContent` colapsaria estas situações e obrigaria a quebrar o formato
 * quando a camada de armazenamento chegasse. Um estado nomeado não:
 *
 *  - `included`           — os bytes vão no bundle;
 *  - `missingContent`     — os bytes não estão disponíveis; o registo é exportado como
 *                           metadados e a lacuna é **declarada** (§5.6);
 *  - `externalReference`  — os bytes existem, mas ficam por referência (camada de
 *                           armazenamento). Reservado; não produzido pela v1.
 *
 * `missingContent` nunca é silencioso: aparece no manifest por `localId` e no relatório
 * de importação. Inventar conteúdo para preencher a lacuna é a única coisa que este
 * contrato proíbe de forma absoluta.
 */
export const DOCUMENT_CONTENT_STATES = ['included', 'missingContent', 'externalReference'] as const;
export type DocumentContentState = (typeof DOCUMENT_CONTENT_STATES)[number];

export const zDocumentContentState = z.enum(DOCUMENT_CONTENT_STATES);

/**
 * Declaração do estado dos documentos no manifest (§5.6).
 *
 * Os `localId` sem conteúdo são listados individualmente: numa importação, "4 de 12
 * documentos sem ficheiro" sem os nomear é informação inútil — o utilizador não sabe
 * quais recuperar mais tarde.
 */
export const zManifestDocuments = z.object({
  included: z.boolean(),
  count: z.number().int().min(0),
  totalBytes: z.number().int().min(0),
  missingContent: z.object({
    count: z.number().int().min(0),
    localIds: z.array(z.string()),
  }),
  /** Reservado para a camada de armazenamento. Ausente enquanto não existir. */
  externalReference: z
    .object({ count: z.number().int().min(0), localIds: z.array(z.string()) })
    .optional(),
});
export type ManifestDocuments = z.infer<typeof zManifestDocuments>;

/* -------------------------------------------------------------------------- */
/* Identificadores (§5.5)                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Os `cuid` internos não aparecem por omissão: são informação interna e sugerem uma
 * identidade que não sobrevive à importação. Quando o utilizador ativa "incluir
 * identificadores internos" — para depuração ou para reimportar na mesma conta —
 * surgem em `manifest.identifiers`, **nunca no meio dos dados**.
 */
export const zManifestIdentifiers = z.object({
  internalIdsIncluded: z.boolean(),
  /** Presente apenas quando `internalIdsIncluded` é `true`. */
  map: z.record(z.string()).optional(),
});

/* -------------------------------------------------------------------------- */
/* Manifest (§6)                                                               */
/* -------------------------------------------------------------------------- */

export const zManifestCreatedBy = z.object({
  product: z.literal('Zemlo'),
  appVersion: z.string().min(1),
  /** `production`, `staging`, `development` — de onde o bundle saiu. */
  sourceEnvironment: z.string().min(1),
});

/**
 * `manifest.json` — o único ficheiro obrigatório do bundle.
 *
 * Todas as chaves desconhecidas são ignoradas por um importador (§12.1) e há
 * `extensions` reservado para quem precisar de acrescentar algo sem colidir com o
 * formato. O parse é deliberadamente **não** estrito nas chaves extra: recusar um
 * manifest por trazer um campo novo quebraria a compatibilidade para a frente.
 */
export const zManifest = z.object({
  manifestVersion: z.number().int().min(1),
  format: z.literal(EXPORT_FORMAT),
  formatVersion: z.number().int().min(1),
  createdAt: zInstant,

  createdBy: zManifestCreatedBy,

  /** Identifica **este** bundle. É a chave da idempotência (§9.5). */
  bundleId: z.string().min(1).max(64),

  scope: zExportScope,
  conventions: zConventions,

  /** Contagem por tipo de registo. Alimenta a apresentação do plano de importação. */
  counts: z.record(z.number().int().min(0)),

  files: z.array(zManifestFile),

  documents: zManifestDocuments,

  integrity: z.object({
    algorithm: z.literal('sha256'),
    covered: z.literal('all-files'),
  }),

  dataClasses: z.array(zDataClass),

  sharedVehicles: z.object({
    count: z.number().int().min(0),
    note: z.string(),
  }),

  identitySeed: z.object({
    strategy: z.literal('bundle-unique-local-ids'),
    opaque: z.boolean(),
  }),

  identifiers: zManifestIdentifiers,

  csv: z.object({
    included: z.boolean(),
    files: z.array(z.string()),
  }),

  /** Espaço reservado; um importador ignora chaves que não conhece. */
  extensions: z.record(z.unknown()),

  /** Texto do utilizador, quando existir. */
  note: z.string().nullable().optional(),
});
export type Manifest = z.infer<typeof zManifest>;

/* -------------------------------------------------------------------------- */
/* Registos do bundle (§5.5)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Identidade na origem anterior (§2.3).
 *
 * É o que distingue "o mesmo registo que já importei" de "um registo parecido": uma
 * segunda importação da mesma aplicação de origem reconhece registos que já entraram,
 * mesmo que os dados tenham sido entretanto editados no Zemlo.
 */
export const zExternalId = z.object({
  source: z.string().min(1).max(80),
  id: z.string().min(1).max(200),
});
export type ExternalId = z.infer<typeof zExternalId>;

/**
 * Campos comuns a todos os registos do bundle.
 *
 * O `source` acompanha cada registo desde a origem, para que a procedência não se perca
 * na migração (§5.3). Nem todos os tipos o exportam hoje — a presença é opcional para
 * que acrescentá-lo a um tipo novo não seja uma mudança de formato.
 */
export const zBundleRecordBase = z.object({
  localId: z.string().min(1).max(80),
  externalIds: z.array(zExternalId).optional(),
  /** Forma bruta do `source` tal como persistida (objeto JSON), quando existir. */
  source: z.record(z.unknown()).optional(),
  createdAt: zInstant.optional(),
  updatedAt: zInstant.optional(),
});
export type BundleRecordBase = z.infer<typeof zBundleRecordBase>;

/** Veículo, com tudo o que aponta para ele por `vehicleLocalId`. */
export const zBundleVehicle = zBundleRecordBase.extend({
  plate: z.string(),
  plateDisplay: z.string(),
  vin: z.string().nullable().optional(),
  make: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  year: z.number().int().nullable().optional(),
});
export type BundleVehicle = z.infer<typeof zBundleVehicle>;

/**
 * Documento (§5.6).
 *
 * Os metadados vão em `documents.jsonl`; os bytes, quando existem, em
 * `documents/<localId>/<nome-original>`. Este contrato descreve os metadados e **o
 * estado do conteúdo** — nunca o conteúdo em si, que não passa pelo JSON.
 *
 * O `contentBytes` é nulo (ou ausente) exactamente quando `contentState` é
 * `missingContent` ou `externalReference`. Não é um erro: é a representação honesta de
 * uma lacuna declarada.
 */
export const zBundleDocument = zBundleRecordBase.extend({
  vehicleLocalId: z.string().nullable().optional(),
  name: z.string(),
  category: z.string(),
  date: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  fileName: z.string().nullable().optional(),
  mimeType: z.string().nullable().optional(),
  sizeBytes: z.number().int().nullable().optional(),
  /** Caminho dentro do ZIP, quando `contentState` é `included`. */
  contentPath: z.string().nullable().optional(),
  contentState: zDocumentContentState,
  /** `sha256` dos bytes. Chave de deduplicação forte quando existe (§8.4). */
  contentSha256: z.string().nullable().optional(),
});
export type BundleDocument = z.infer<typeof zBundleDocument>;

/**
 * Imposto (§5.5).
 *
 * O `kind` é **obrigatório e explícito** e não se deriva de mais nada. O modelo
 * `TaxRecord` guarda-o (`kind String @default("iuc")`) e a chave de deduplicação
 * `year+kind` depende dele como componente **certo** (§8.4): derivá-lo do ano, da
 * descrição ou da categoria seria inventar uma regra de negócio que ninguém escreveu, e
 * uma derivação errada faria duas obrigações fiscais distintas passarem pela mesma —
 * perdendo uma delas na importação. Ver A27.
 *
 * Acrescentado em A27: o domínio já consumia `kind` desde a Fase 1, mas `taxes.jsonl`
 * era o único ficheiro de dados sem forma declarada no contrato.
 */
export const zBundleTax = zBundleRecordBase.extend({
  vehicleLocalId: z.string(),
  /** Tipo de imposto: `iuc`, `imi`, `circulation`, `toll`, … */
  kind: z.string().min(1),
  year: z.number().int(),
  amountCents: z.number().int(),
  date: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  paid: z.boolean().optional(),
});
export type BundleTax = z.infer<typeof zBundleTax>;

/* -------------------------------------------------------------------------- */
/* Importação — resultado estruturado (§9)                                     */
/* -------------------------------------------------------------------------- */

/**
 * Gravidade de um problema (§9.1).
 *
 *  - `blocking`    — a importação não avança. Detetado antes de escrever;
 *  - `recoverable` — o registo entra com a lacuna declarada, ou fica em quarentena;
 *  - `info`        — nada muda no resultado.
 *
 * A distinção não é decorativa: é o que permite dizer ao utilizador *o que aconteceu*
 * em vez de *que falhou*.
 */
export const ISSUE_SEVERITIES = ['blocking', 'recoverable', 'info'] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

/**
 * Um problema concreto, localizado.
 *
 * Numa importação de 8 000 registos, "3 registos com problemas" sem os nomear é
 * informação inútil (§9.2). Por isso cada problema traz o registo, o campo e uma
 * mensagem escrita para ser lida.
 */
export const zImportIssue = z.object({
  severity: z.enum(ISSUE_SEVERITIES),
  /** Código estável, para agrupamento e para o cliente decidir o comportamento. */
  code: z.string().min(1).max(80),
  message: z.string().min(1),
  /** `localId` do registo afetado, quando o problema é de um registo. */
  localId: z.string().max(80).optional(),
  /** Caminho do campo dentro do registo (`date`, `amountCents`, …). */
  field: z.string().max(80).optional(),
  /** Ficheiro do bundle onde o problema foi detetado. */
  file: z.string().max(200).optional(),
  /** Linha do ficheiro (`.jsonl`), quando aplicável. */
  line: z.number().int().min(1).optional(),
});
export type ImportIssue = z.infer<typeof zImportIssue>;

/** Veredicto de deduplicação (§8.3). */
export const DEDUPE_VERDICTS = ['new', 'exact-duplicate', 'probable-duplicate', 'enrichment'] as const;
export type DedupeVerdict = (typeof DEDUPE_VERDICTS)[number];

/**
 * Qualidade de um registo normalizado (§9.2).
 *
 * A regra de ouro: um registo com problemas **nunca** é criado parcialmente em silêncio.
 * Ou entra completo, ou entra com uma lacuna que o relatório nomeia, ou não entra e o
 * relatório diz porquê.
 */
export const RECORD_QUALITIES = ['complete', 'partial', 'quarantined'] as const;
export type RecordQuality = (typeof RECORD_QUALITIES)[number];

/** Contagens do plano ou do relatório, por tipo de registo. */
export const zImportCounts = z.object({
  vehicles: z.number().int().min(0).default(0),
  odometer: z.number().int().min(0).default(0),
  expenses: z.number().int().min(0).default(0),
  fuel: z.number().int().min(0).default(0),
  charging: z.number().int().min(0).default(0),
  maintenance: z.number().int().min(0).default(0),
  insurance: z.number().int().min(0).default(0),
  inspections: z.number().int().min(0).default(0),
  taxes: z.number().int().min(0).default(0),
  documents: z.number().int().min(0).default(0),
  reminders: z.number().int().min(0).default(0),
  events: z.number().int().min(0).default(0),
});
export type ImportCounts = z.infer<typeof zImportCounts>;

/** Ficheiro de dados reconhecido dentro do bundle (§5.2). */
export const zBundleDataFile = z.object({
  path: z.string(),
  records: z.number().int().min(0),
  bytes: z.number().int().min(0),
  sha256: z.string(),
});
export type BundleDataFile = z.infer<typeof zBundleDataFile>;

/* -------------------------------------------------------------------------- */
/* Nomes de ficheiro e pastas do bundle (§5.2)                                 */
/* -------------------------------------------------------------------------- */

/** Ficheiros de dados, um por tipo de registo. */
export const BUNDLE_DATA_FILES = {
  account: 'account.json',
  vehicles: 'vehicles.jsonl',
  odometer: 'odometer.jsonl',
  expenses: 'expenses.jsonl',
  fuel: 'fuel.jsonl',
  charging: 'charging.jsonl',
  maintenance: 'maintenance.jsonl',
  insurance: 'insurance.jsonl',
  inspections: 'inspections.jsonl',
  taxes: 'taxes.jsonl',
  reminders: 'reminders.jsonl',
  events: 'events.jsonl',
  documents: 'documents.jsonl',
  suggestions: 'suggestions.jsonl',
  notifications: 'notifications.jsonl',
  audit: 'audit.jsonl',
} as const;
export type BundleDataFileKey = keyof typeof BUNDLE_DATA_FILES;

export const BUNDLE_MANIFEST_FILE = 'manifest.json';
export const BUNDLE_README_FILE = 'README.txt';
/**
 * `manifest.json` visto do lado de quem lê.
 *
 * É o **único ficheiro obrigatório** do bundle (§12.1). A ausência de qualquer outro é
 * uma lacuna legítima — um `scope` parcial não traz `audit.jsonl` — mas a ausência deste
 * torna o ficheiro impossível de interpretar com segurança.
 */
export const BUNDLE_DOCUMENT_FILE = BUNDLE_MANIFEST_FILE;
/** Pasta dos bytes originais dos documentos: `documents/<localId>/<nome>`. */
export const BUNDLE_DOCUMENTS_DIR = 'documents';
/**
 * A mesma pasta, vista do lado de quem lê.
 *
 * Os bytes originais vivem em `documents/<localId>/<nome-original>` (§5.6): a pasta por
 * `localId` é o que garante unicidade quando dois documentos têm o mesmo nome de
 * ficheiro, e o nome original é preservado dentro dela.
 */
export const BUNDLE_DOCUMENT_DIR = BUNDLE_DOCUMENTS_DIR;
/** Pasta da camada de leitura humana (decisão 11): `csv/<tipo>.csv`. */
export const BUNDLE_CSV_DIR = 'csv';

/**
 * Nome do ficheiro de exportação, com data, para a transferência ser identificável.
 *
 * Vive aqui, e não em `services/export.ts`, porque é parte do contrato do artefacto e
 * não da sua produção — e porque a importação precisa de o reconhecer.
 */
export function bundleFileName(today: string, extension: 'zip' | 'json' | 'csv' = 'zip'): string {
  return `zemlo-export-${today}.${extension}`;
}
