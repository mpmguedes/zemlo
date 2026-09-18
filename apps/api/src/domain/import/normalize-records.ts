/**
 * Normalizer — de `RawBundleRecord` para `CanonicalRecord` (§4.1).
 *
 * ## Onde vive na cadeia
 *
 * ```
 *   ImportSource → Parser → [Normalizer] → Validator → Deduplicator → ImportPlan → …
 *                            ^^^^^^^^^^
 * ```
 *
 * O Parser (`bundle.ts`) entrega os campos **deliberadamente não interpretados** — é o que
 * o A26 fixou, e os testes da Fase 3 verificam-no linha a linha. O Validator e o
 * Deduplicator só aceitam `CanonicalRecord`. Este ficheiro é o elo entre os dois: o único
 * sítio que sabe **que campos** um `vehicles.jsonl` tem, e como se chamam do lado do
 * domínio.
 *
 * Sem ele a cadeia está partida em dois: cada metade testada contra o seu próprio
 * contrato, e o contrato entre as duas nunca exercido — que foi exactamente como as três
 * lacunas do A27 passaram despercebidas.
 *
 * ## Puro
 *
 * Sem Prisma, sem HTTP, sem sistema de ficheiros, sem acesso à base de dados, sem
 * dependência da hora. Uma função pura de `(registos, referências) → registos`. É o que
 * permite testar o mapeamento dos catorze tipos sem levantar uma base de dados.
 *
 * ## Mapeia, não normaliza
 *
 * A normalização **por valor** — matrícula em maiúsculas, data civil canónica, cêntimos
 * inteiros — já existe em `normalize.ts` e é aí que continua. Este ficheiro chama-a; não
 * a repete. Repetir a regra criaria uma segunda fonte de verdade, e as duas divergiriam:
 * é a mesma razão pela qual o `dedupeKeysFor` não renormiza os campos que recebe.
 *
 * O que este ficheiro acrescenta é o **mapeamento semântico**: decidir que `odometer.jsonl`
 * traz `odometerKm` e `recordedAt`, que o `vehicleLocalId` de um abastecimento é uma aresta
 * do grafo, e que o `contentSha256` de um documento é a sua identidade forte. Essa decisão
 * não existia em lado nenhum.
 *
 * ## Referências em dois locais (A27)
 *
 * Uma referência conhecida (`vehicleLocalId`, `recordLocalId`, `linkedRecordLocalId`,
 * `documentLocalId`) é escrita **em `references` e em `fields`**, deliberadamente:
 *
 *  - `references` é a **aresta** do grafo, validada quanto a existência pelo
 *    `findBrokenReferences` antes de qualquer escrita;
 *  - `fields` é o **valor** que entra na composição das chaves de deduplicação — o
 *    `dedupe-keys.ts` procura `vehicleLocalId` nos `fields` para o incluir no valor da
 *    chave de despesa.
 *
 * São perguntas diferentes sobre o mesmo dado. Escrever num só dos dois sítios deixaria a
 * chave de despesa a comparar `undefined` do lado do bundle, e duas despesas de veículos
 * **diferentes** com o mesmo dia e o mesmo valor coincidiriam — a mistura de históricos
 * que a §8.4 proíbe. Ver A27 para as alternativas rejeitadas.
 */

import { normalizePlateForCompare } from './normalize.js';
import type { CanonicalRecord, RecordKind } from './validate.js';
import type { RawBundleRecord } from './bundle.js';

/* -------------------------------------------------------------------------- */
/* Referências                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Campos que são **referências** a outro registo do bundle, por tipo.
 *
 * Lista explícita e derivada da §5.5: um campo novo que seja referência tem de ser
 * acrescentado aqui, e é isso que impede que passe despercebido como se fosse um valor.
 *
 * Note-se que `documents` tem `vehicleLocalId` **opcional** (uma carta de condução não tem
 * veículo) e `events` tem `recordLocalId` opcional (um evento pode existir sozinho). A
 * ausência é um valor legítimo, não um problema de dados.
 */
const REFERENCE_FIELDS = [
  'vehicleLocalId',
  'recordLocalId',
  'linkedRecordLocalId',
  'documentLocalId',
] as const;

/* -------------------------------------------------------------------------- */
/* Vocabulário do mapeamento                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Um campo do bundle, tal como chega do Parser.
 *
 * `unknown` de propósito: o Parser não interpreta, e é este ficheiro que decide o que
 * cada chave significa. Coagir cedo seria interpretar no sítio errado.
 */
type RawFields = Readonly<Record<string, unknown>>;

/** Resultado do mapeamento de um lote. */
export interface NormalizeRecordsResult {
  readonly records: readonly CanonicalRecord[];
  /**
   * Campos que o bundle trouxe e o mapeamento **não** reconheceu, por tipo.
   *
   * Existe para que a lacuna seja **declarada** em vez de silenciosa (§9.2): um campo que
   * o exportador escreve e a importação ignora é uma perda de dados que ninguém vê. Não
   * é um erro — o contrato tolera campos desconhecidos (§5.3, `extensions`) — mas é
   * informação que o relatório deve poder dizer.
   */
  readonly unmappedFields: Readonly<Record<string, readonly string[]>>;
}

/* -------------------------------------------------------------------------- */
/* Leitura defensiva de valores                                                */
/* -------------------------------------------------------------------------- */

/*
 * O bundle é JSON não fidedigno: um campo pode vir com o tipo errado, e um `litres` que
 * chega como string não pode fazer o mapeamento rebentar. As três funções abaixo devolvem
 * `undefined` em vez de lançar — o Validator transforma a ausência num problema
 * localizado, com o `localId` e a linha certos, que é onde a mensagem é útil. Uma excepção
 * aqui perderia o `localId` e transformaria um erro de um registo num erro do bundle.
 *
 * `undefined` é sempre "ausente". `null` no bundle conta como ausente (§5.3), e
 * `readString`/`readNumber` colapsam os dois para que o resto do ficheiro não tenha de
 * distinguir.
 */

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.length === 0 ? undefined : value;
}

/**
 * Escreve um campo em `fields` **apenas se estiver presente e for do tipo aceite**.
 *
 * A §5.3 diz que a ausência é representada por chave omitida ou `null`. Propagar a chave
 * com `undefined` faria `Object.keys` contar campos que não existem, e o realce de campos
 * em branco no ecrã de revisão passaria a mostrar campos que o bundle nunca trouxe.
 *
 * ## Porque é que a coerção de tipo acontece **aqui** e não na leitura
 *
 * Uma versão anterior copiava o valor cru e deixava a coerção para o Validator. Estava
 * errada, e os testes apanharam-no: `litres: "42.35"` (string) e `fullTank: "true"`
 * chegavam intactos ao `CanonicalRecord`, e o `dedupeKeysFor` — que faz
 * `f.litres as number | null` — recebia uma string onde esperava um número. O `as` é uma
 * asserção, não uma verificação: passaria a comparar `"42.35"` com `42.35` numa tolerância
 * numérica, e o resultado seria uma comparação silenciosamente sempre falsa.
 *
 * O tipo faz parte do **contrato do campo**, e por isso é verificado onde o campo é
 * mapeado — no único sítio que sabe que `litres` é um número. Deixá-lo para o Validator
 * obrigaria o Validator a conhecer o tipo de cada campo de cada tipo de registo, que é
 * precisamente o conhecimento que este ficheiro existe para concentrar.
 *
 * Um valor do tipo errado é tratado como **ausente**, não como erro bloqueante: o bundle
 * é JSON não fidedigno, e o Validator transforma a ausência num problema localizado com o
 * `localId` e a linha certos. Recusar o registo inteiro por um campo mal tipado seria
 * recusar dados reais por causa de uma representação.
 */
function put(
  fields: Record<string, unknown>,
  key: string,
  value: unknown,
  type: 'string' | 'number' | 'boolean' | 'any',
): void {
  if (value === undefined || value === null || value === '') return;

  if (type === 'string') {
    if (typeof value !== 'string') return;
  } else if (type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
  } else if (type === 'boolean') {
    if (typeof value !== 'boolean') return;
  }

  fields[key] = value;
}

/**
 * O tipo de cada campo de domínio, por nome.
 *
 * Uma tabela **global** e não por tipo de registo, porque o mesmo nome significa a mesma
 * coisa onde quer que apareça: `date` é uma data civil (string) num abastecimento, numa
 * despesa e numa manutenção; `amountCents` é um inteiro em todos eles. Tê-la por tipo
 * obrigaria a repetir `date: 'string'` catorze vezes, e a repetição é onde as divergências
 * nascem — bastaria um tipo onde `odometerKm` ficasse como `string` para a comparação
 * desse tipo passar a ser sempre falsa em silêncio.
 *
 * Um campo que não conste daqui é transportado sem verificação de tipo. É o caso dos
 * campos de texto livre e dos que o domínio ainda não compara; a ausência de entrada não
 * é uma afirmação de que o campo aceita tudo, é a admissão de que ainda não foi
 * classificado — e a lista está deliberadamente completa para os campos que as chaves de
 * deduplicação leem.
 */
const FIELD_TYPES: Readonly<Record<string, 'string' | 'number' | 'boolean' | 'any'>> = {
  /* Veículo */
  plate: 'string',
  plateDisplay: 'string',
  vin: 'string',
  make: 'string',
  model: 'string',
  version: 'string',
  year: 'number',
  vehicleType: 'string',
  fuelType: 'string',
  color: 'string',
  nickname: 'string',

  /* Odómetro e datas civis */
  recordedAt: 'string',
  odometerKm: 'number',
  origin: 'string',
  isCorrection: 'boolean',

  /* Dinheiro e quantidades */
  amountCents: 'number',
  vatCents: 'number',
  premiumCents: 'number',
  pricePerLitreCents: 'number',
  pricePerKwhCents: 'number',
  litres: 'number',
  energyKwh: 'number',
  startSocPercent: 'number',
  endSocPercent: 'number',
  durationMinutes: 'number',
  latitude: 'number',
  longitude: 'number',
  sizeBytes: 'number',
  dueOdometerKm: 'number',
  nextOdometerKm: 'number',
  severity: 'string',

  /* Datas civis */
  date: 'string',
  dueDate: 'string',
  startDate: 'string',
  endDate: 'string',
  expiresAt: 'string',
  nextDate: 'string',

  /* Lógicos */
  paid: 'boolean',
  fullTank: 'boolean',
  isPublic: 'boolean',

  /* Texto */
  category: 'string',
  vendor: 'string',
  description: 'string',
  station: 'string',
  location: 'string',
  paymentMethod: 'string',
  notes: 'string',
  name: 'string',
  fileName: 'string',
  mimeType: 'string',
  title: 'string',
  body: 'string',
  topic: 'string',
  key: 'string',
  type: 'string',
  status: 'string',
  reason: 'string',
  result: 'string',
  kind: 'string',
  insurer: 'string',
  policyNumber: 'string',
  coverage: 'string',
  contentPath: 'string',
  contentState: 'string',
  contentSha256: 'string',
};

/* -------------------------------------------------------------------------- */
/* Mapeadores por tipo                                                         */
/* -------------------------------------------------------------------------- */

/** Um mapeador por tipo de registo. Recebe os campos crus, devolve os do domínio. */
interface Mapped {
  readonly fields: Record<string, unknown>;
}

/**
 * Campos que cada tipo de registo reconhece.
 *
 * É a tabela que antes não existia em lado nenhum. As chaves de `fields` são **as que o
 * `dedupeKeysFor` lê** — e é essa correspondência, e não a semelhança com o nome do
 * ficheiro, que a torna correta.
 */
const FIELD_MAP: Readonly<Record<RecordKind, readonly string[]>> = {
  vehicle: ['plate', 'plateDisplay', 'vin', 'make', 'model', 'version', 'year', 'vehicleType', 'fuelType', 'color', 'nickname'],
  odometer: ['odometerKm', 'recordedAt', 'origin', 'isCorrection', 'notes'],
  expense: ['amountCents', 'vatCents', 'category', 'date', 'vendor', 'odometerKm', 'description', 'paymentMethod', 'paid'],
  fuel: ['date', 'litres', 'amountCents', 'pricePerLitreCents', 'odometerKm', 'fullTank', 'station', 'fuelType', 'latitude', 'longitude', 'paymentMethod', 'notes'],
  charging: ['date', 'energyKwh', 'amountCents', 'pricePerKwhCents', 'odometerKm', 'startSocPercent', 'endSocPercent', 'durationMinutes', 'location', 'isPublic', 'paymentMethod', 'notes'],
  maintenance: ['date', 'type', 'amountCents', 'odometerKm', 'vendor', 'description', 'nextDate', 'nextOdometerKm', 'notes'],
  insurance: ['insurer', 'policyNumber', 'startDate', 'endDate', 'premiumCents', 'amountCents', 'coverage', 'notes'],
  inspection: ['date', 'result', 'amountCents', 'odometerKm', 'expiresAt', 'station', 'notes'],
  tax: ['kind', 'year', 'amountCents', 'date', 'dueDate', 'paid', 'notes'],
  document: ['name', 'category', 'date', 'expiresAt', 'fileName', 'mimeType', 'sizeBytes', 'contentPath', 'contentState', 'contentSha256', 'notes'],
  reminder: ['title', 'dueDate', 'dueOdometerKm', 'origin', 'notes'],
  event: ['type', 'date', 'title', 'description'],
  suggestion: ['key', 'type', 'status', 'reason'],
  notification: ['topic', 'title', 'body', 'severity'],
};

/**
 * Aplica o mapa de campos a um registo cru.
 *
 * Percorre a lista de campos **reconhecidos** para o tipo e copia os que existem. Campos
 * do bundle que não estejam na lista não são copiados e são reportados em
 * `unmappedFields` — nunca descartados em silêncio.
 */
function mapFields(kind: RecordKind, raw: RawFields): Mapped {
  const known = FIELD_MAP[kind];
  const fields: Record<string, unknown> = {};

  for (const name of known) {
    put(fields, name, raw[name], FIELD_TYPES[name] ?? 'any');
  }

  /*
   * A matrícula e o `plateDisplay` estão ambos no bundle, e ambos são copiados: o
   * `plateDisplay` é a forma legível que o cliente usa sem recalcular, e o `plate` é a
   * forma canónica comparável. O padrão de armazenamento (`normalizeVehicle` em
   * `@zemlo/shared`) é aplicado na escrita, não aqui — aqui preserva-se o que o bundle
   * trouxe, e a comparação usa `normalizePlateForCompare` por cima.
   *
   * Se o bundle trouxer uma matrícula mas não a forma legível (ou vice-versa), a que falta
   * é preenchida a partir da outra. Não é inventar: é a mesma identidade escrita nas duas
   * formas que o modelo exige, e sem isto a escrita falharia num campo NOT NULL por causa
   * de uma omissão sem significado.
   */
  if (kind === 'vehicle') {
    const plate = readString(raw.plate);
    const display = readString(raw.plateDisplay);
    if (plate !== undefined) {
      put(fields, 'plate', normalizePlateForCompare(plate), 'string');
      if (display === undefined) put(fields, 'plateDisplay', plate, 'string');
    } else if (display !== undefined) {
      put(fields, 'plate', normalizePlateForCompare(display), 'string');
      put(fields, 'plateDisplay', display, 'string');
    }
  }

  return { fields };
}

/**
 * Campos conhecidos que não alimentam nenhum mapa.
 *
 * `localId`, `externalIds`, `source`, `createdAt` e `updatedAt` vêm em todos os registos
 * (§5.3) e são **metadados**, não dados de domínio: têm tratamento próprio e não contam
 * como campos por mapear. Sem esta lista, todos os registos de todos os bundles
 * reportariam cinco campos por mapear, e o aviso tornava-se ruído que ninguém lê.
 */
const RECORD_METADATA_FIELDS = new Set([
  'localId',
  'externalIds',
  'source',
  'createdAt',
  'updatedAt',
]);

/* -------------------------------------------------------------------------- */
/* O normalizador                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Converte um lote de registos crus em registos canónicos.
 *
 * Uma função pura, sem I/O. A mesma entrada produz sempre a mesma saída — é o que permite
 * testar o mapeamento dos catorze tipos sem base de dados, e o que torna o plano
 * reprodutível a partir do mesmo bundle (§7.1: nada é escrito antes do `apply`).
 *
 * ## O que faz, por registo
 *
 *  1. Copia os campos reconhecidos para o tipo (§`FIELD_MAP`);
 *  2. Separa as referências conhecidas, escrevendo-as em `references` **e** em `fields` (A27);
 *  3. Transporta os `externalIds` tal como vierem, sem os interpretar (§2.3 — a identidade
 *     na origem anterior é da Fase 4; aqui só não se perde);
 *  4. Preserva `file` e `line` do Parser, para que um problema continue a apontar para a
 *     linha exata do `.jsonl`.
 *
 * ## O que não faz
 *
 * Não valida. Um registo sem matrícula sai daqui e é o Validator que o põe em quarentena,
 * com a mensagem certa e no sítio certo. Fazer a validação aqui duplicaria a regra e
 * dividiria por dois sítios a decisão de "o que impede uma importação".
 */
export function normalizeRecords(
  records: readonly RawBundleRecord[],
): NormalizeRecordsResult {
  const canonical: CanonicalRecord[] = [];
  const unmapped: Record<string, string[]> = {};

  for (const record of records) {
    const kind = record.kind;

    /*
     * Um tipo vindo do Parser que não conste do mapa não é mapeável, e é melhor continuar
     * do que rebentar: o Validator põe-no em quarentena com o `localId`, e o utilizador vê
     * o registo em vez de uma importação falhada. O `kindFromFileName` do Parser só produz
     * tipos desta lista, pelo que este ramo é defesa em profundidade — mas existe porque
     * `RawBundleRecord.kind` é um `string` e a ligação é dinâmica.
     */
    const known = FIELD_MAP[kind as RecordKind];
    if (known === undefined) {
      canonical.push({
        kind: kind as RecordKind,
        localId: readString(record.fields.localId) ?? '',
        ...(record.file ? { file: record.file } : {}),
        ...(record.line !== undefined ? { line: record.line } : {}),
        fields: {},
        references: {},
      });
      continue;
    }

    const mapped = mapFields(kind as RecordKind, record.fields);

    /*
     * O `localId` é uma chave do objeto JSON como qualquer outra — o Parser não a
     * interpreta — e é promovida aqui a campo do canónico. Não é validada quanto a forma
     * nesta função: o `validateRecords` já tem `invalidLocalIdIssues` e
     * `findDuplicateLocalIds`, e fazê-lo aqui duplicaria a regra em dois sítios.
     *
     * Uma string vazia é o valor de recurso quando o `localId` vem ausente ou mal tipado.
     * Não é um valor válido e será apanhado pela validação, mas mantém o registo no lote
     * com um identificador em vez de o perder — um registo sem identidade ainda pode ser
     * contado e relatado.
     */
    const localId = readString(record.fields.localId) ?? '';

    /* ---- Referências: em `references` e em `fields` (A27) ---- */

    const references: Record<string, string | null | undefined> = {};
    for (const name of REFERENCE_FIELDS) {
      const value = readString(record.fields[name]);
      if (value === undefined) continue;
      references[name] = value;
      /*
       * O mesmo valor entra também em `fields`. É intencional e é o que A27 fixa: o
       * `dedupe-keys.ts` procura `vehicleLocalId` nos `fields` para compor o valor da
       * chave de despesa. Ver o cabeçalho deste ficheiro.
       */
      put(mapped.fields, name, value, 'string');
    }

    /* ---- Metadados ---- */

    const externalIds = readExternalIds(record.fields.externalIds);

    /* ---- Campos por reconhecer ---- */

    const unknownHere = Object.keys(record.fields).filter((name) => {
      if (RECORD_METADATA_FIELDS.has(name)) return false;
      if (known.includes(name)) return false;
      if ((REFERENCE_FIELDS as readonly string[]).includes(name)) return false;
      return true;
    });

    if (unknownHere.length > 0) {
      const list = unmapped[kind] ?? [];
      for (const name of unknownHere) {
        if (!list.includes(name)) list.push(name);
      }
      unmapped[kind] = list;
    }

    canonical.push({
      kind: kind as RecordKind,
      localId,
      ...(record.file ? { file: record.file } : {}),
      ...(record.line !== undefined ? { line: record.line } : {}),
      fields: mapped.fields,
      references,
      ...(externalIds.length > 0 ? { externalIds } : {}),
    });
  }

  return { records: canonical, unmappedFields: unmapped };
}

/**
 * Lê os `externalIds` sem os interpretar (§2.3).
 *
 * Aqui **não** se resolve identidade nenhuma: `externalIds` são a identidade na origem
 * anterior, e essa é a Fase 4. Nesta fase o único objectivo é não os perder — um
 * `externalId` descartado agora é um dado que já não se recupera quando a Fase 4
 * precisar dele.
 *
 * A forma é validada de leve: um `externalId` sem `source` ou sem `id` não é um
 * identificador, é lixo que passaria a poluir o índice. Os que não têm ambos são
 * descartados — e note-se que **não** se descarta o registo por causa disso: perder o
 * registo inteiro por causa de um identificador malformado seria pior do que perder o
 * identificador.
 */
function readExternalIds(value: unknown): Array<{ source: string; id: string }> {
  if (!Array.isArray(value)) return [];

  const out: Array<{ source: string; id: string }> = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const entry = item as Record<string, unknown>;
    const source = readString(entry.source);
    const id = readString(entry.id);
    if (source === undefined || id === undefined) continue;
    out.push({ source, id });
  }
  return out;
}
