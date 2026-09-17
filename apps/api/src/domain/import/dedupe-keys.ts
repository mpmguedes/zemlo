/**
 * Chaves de deduplicação (§8).
 *
 * ## A pergunta que este ficheiro responde
 *
 * *"Este registo já existe?"* — e responde a ela **do conteúdo**, nunca do `localId`.
 * Um `localId` diferente não significa um registo diferente (§2.1); dois bundles
 * exportados da mesma conta em momentos diferentes terão `localId` novos para os mesmos
 * registos.
 *
 * ## Os três níveis (§8.3)
 *
 *  - **certo** — uma chave forte coincide exatamente. É ignorado por omissão.
 *  - **provável** — chave composta dentro de tolerância. É **perguntado** ao utilizador,
 *    com a razão concreta.
 *  - **nenhum** — sem coincidência. É criado.
 *
 * A distinção não é uma questão de grau de confiança: é a diferença entre apagar dados
 * do utilizador e duplicá-los. Um sistema que a confunde faz uma das duas coisas, nos
 * dois casos sem lhe dizer nada (§1).
 *
 * ## Porque é que "provável" nunca é resolvido aqui
 *
 * Estas funções classificam; **não decidem**. A decisão pertence ao utilizador (§8.3,
 * decisão 10), porque só ele sabe se duas portagens no mesmo dia pelo mesmo valor são
 * uma ida e volta ou o mesmo registo introduzido duas vezes. Um motor que "resolvesse"
 * isso sozinho estaria a adivinhar sobre dados que não são seus.
 */

import {
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
} from './normalize.js';

/* -------------------------------------------------------------------------- */
/* Níveis de certeza e tolerâncias                                             */
/* -------------------------------------------------------------------------- */

/**
 * Nível de certeza de uma coincidência (§8.3).
 *
 * `exact` corresponde a "certo" na especificação; `probable` a "provável". O nome
 * `exact` foi escolhido em vez de `certain` para que o par `exact`/`probable` descreva
 * a **comparação** e não a confiança — uma chave exata é exata, mesmo que a inferência
 * que a produziu seja uma hipótese sobre o mundo.
 */
export type MatchLevel = 'exact' | 'probable';

/**
 * Tolerâncias (§8.6).
 *
 * Só existem onde há uma **razão física**, e são sempre declaradas — nunca "aproximado".
 * Uma tolerância é uma hipótese sobre o mundo físico: o mesmo abastecimento registado em
 * dois sítios difere pelo arredondamento do odómetro, e não por ser outro abastecimento.
 * Onde não há razão física, a comparação é exata.
 */
export const TOLERANCES = {
  /** O mesmo abastecimento registado em dois sítios difere pelo arredondamento do odómetro. */
  odometerKm: 50,
  /** Arredondamentos de conversão de moeda na origem. */
  amountCents: 2,
  /** Arredondamento do mostrador da bomba. */
  litres: 0.05,
  /**
   * Zero, e é uma decisão: uma data errada por um dia é um **dado errado**, não um
   * duplicado. Tolerar um dia faria coincidir o abastecimento de ontem com o de hoje.
   */
  civilDateDays: 0,
} as const;

/* -------------------------------------------------------------------------- */
/* Chaves                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Uma chave de deduplicação.
 *
 * `value` é a representação canónica do conteúdo — comparável por igualdade depois de
 * normalizada. `level` diz o que fazer com uma coincidência. `reason` é o texto que o
 * utilizador verá quando houver um duplicado provável (§9.3), e por isso é escrito para
 * ser lido por uma pessoa: *"mesma data, mesmo valor, quilometragem a 4 km"*.
 *
 * `fields` lista os campos que a chave cobriu. Serve para o relatório poder explicar
 * **em que** os registos coincidem, em vez de afirmar vagamente que "são parecidos".
 */
export interface DedupeKey {
  /** Identificador do tipo de chave: `vin`, `date+litres+odometer`, … */
  readonly kind: string;
  readonly level: MatchLevel;
  /** Valor canónico, ou `null` quando o registo não tem dados suficientes para esta chave. */
  readonly value: string | null;
  readonly fields: readonly string[];
  /**
   * Campos numéricos já normalizados, para a comparação aplicar a tolerância da §8.6.
   *
   * Separado de `value` porque a tolerância não se aplica a uma igualdade de strings, e
   * porque um campo pode estar ausente de um dos lados — `null` aqui significa "não há
   * valor para comparar", nunca "vale zero".
   */
  readonly numeric?: Readonly<Record<string, number | null>>;
}

/** Constrói uma chave a partir de partes, omitindo-a quando falta qualquer parte. */
function compose(
  kind: string,
  level: MatchLevel,
  fields: readonly string[],
  parts: ReadonlyArray<string | number | null | undefined>,
): DedupeKey {
  // Uma chave composta exige **todas** as partes. Sem esta regra, dois registos sem
  // quilometragem coincidiriam numa chave `data+litros+km` com a km vazia, e o
  // resultado seria um falso "certo" — o pior erro possível, porque ignora em silêncio.
  if (parts.some((part) => part === null || part === undefined)) {
    return { kind, level, value: null, fields };
  }
  return { kind, level, value: parts.map((part) => String(part)).join('|'), fields };
}

/* -------------------------------------------------------------------------- */
/* Veículo (§8.4)                                                              */
/* -------------------------------------------------------------------------- */

export interface VehicleKeyInput {
  plate?: string | null;
  vin?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
}

/**
 * Chaves de um veículo (§8.4).
 *
 * Três níveis, e a ressalva da matrícula é a parte importante:
 *
 *  - **VIN** é `exact` — é único por desenho;
 *  - **matrícula** é `exact`, **com ressalva**: matrículas são reatribuídas entre países
 *    e ao longo do tempo. Quando existe VIN e difere, a matrícula passa a `probable`.
 *    Sem esta ressalva, um carro importado com uma matrícula que já foi de outro veículo
 *    seria considerado o mesmo veículo, e o histórico dos dois seria misturado — uma
 *    perda de dados silenciosa e irreversível;
 *  - **marca + modelo + ano** sem qualquer identificador é `probable` — dois VW Golf de
 *    2019 existem, e são carros diferentes.
 */
export function vehicleKeys(input: VehicleKeyInput): DedupeKey[] {
  const keys: DedupeKey[] = [];

  const vin = normalizeVinForCompare(input.vin);
  const hasVin = hasUsableVin(input.vin);
  if (hasVin) {
    keys.push({ kind: 'vin', level: 'exact', value: vin, fields: ['vin'] });
  }

  const plate = normalizePlateForCompare(input.plate);
  if (hasUsablePlate(input.plate)) {
    // A ressalva da §8.4: com VIN válido presente, a matrícula deixa de ser prova
    // suficiente. Sem VIN, a matrícula é a melhor identidade disponível.
    keys.push({
      kind: 'plate',
      level: hasVin ? 'probable' : 'exact',
      value: plate,
      fields: ['plate'],
    });
  }

  const make = normalizeTextForCompare(input.make);
  const model = normalizeTextForCompare(input.model);
  if (make && model) {
    keys.push({
      kind: 'make+model+year',
      level: 'probable',
      value: [make, model, input.year ?? ''].join('|'),
      fields: ['make', 'model', 'year'],
    });
  }

  return keys;
}

/* -------------------------------------------------------------------------- */
/* Despesa (§8.4)                                                              */
/* -------------------------------------------------------------------------- */

export interface ExpenseKeyInput {
  vehicleLocalId?: string | null;
  date?: string | null;
  amountCents?: number | null;
  category?: string | null;
  vendor?: string | null;
  description?: string | null;
}

/**
 * Chaves de uma despesa (§8.4).
 *
 * A parte subtil: `data + valor + veículo` é **provável**, não certo. Duas portagens no
 * mesmo dia pelo mesmo valor são um caso real e comum. Sobe a **certo** apenas quando
 * coincidem também a categoria, o fornecedor e a descrição todos preenchidos.
 *
 * É tentador tratar a primeira como certa — "o mesmo dia e o mesmo valor, só pode ser o
 * mesmo". Não é: apagar uma das portagens do utilizador é pior do que lhe perguntar.
 */
export function expenseKeys(input: ExpenseKeyInput): DedupeKey[] {
  const keys: DedupeKey[] = [];
  const date = normalizeCivilDateForCompare(input.date);
  const amount = normalizeCentsForCompare(input.amountCents);
  const vehicle = input.vehicleLocalId ?? null;

  const base = compose('date+amount+vehicle', 'probable', ['date', 'amountCents', 'vehicleLocalId'], [
    vehicle,
    date,
    amount,
  ]);
  if (base.value !== null) keys.push(base);

  // Sobe a certo com categoria, fornecedor e descrição não vazios. `hasUsableText`
  // impede que três campos vazios contem como coincidência.
  const category = input.category ?? null;
  const vendor = normalizeTextForCompare(input.vendor);
  const description = normalizeTextForCompare(input.description);
  if (
    vehicle !== null &&
    date !== null &&
    amount !== null &&
    category !== null &&
    hasUsableText(input.vendor) &&
    hasUsableText(input.description)
  ) {
    keys.push({
      kind: 'date+amount+category+vendor+description+vehicle',
      level: 'exact',
      value: [vehicle, date, amount, category, vendor, description].join('|'),
      fields: ['date', 'amountCents', 'category', 'vendor', 'description', 'vehicleLocalId'],
    });
  }

  return keys;
}

/* -------------------------------------------------------------------------- */
/* Abastecimento (§8.4)                                                        */
/* -------------------------------------------------------------------------- */

export interface FuelKeyInput {
  vehicleLocalId?: string | null;
  date?: string | null;
  litres?: number | null;
  odometerKm?: number | null;
  amountCents?: number | null;
}

/**
 * Chaves de um abastecimento (§8.4).
 *
 * `data + litros + quilometragem` é **certo**: a quilometragem é praticamente única por
 * veículo, pelo que dois abastecimentos com a mesma leitura no mesmo dia são o mesmo.
 *
 * A tolerância de ±50 km (§8.6) aplica-se **aqui** e não na normalização, e é o que faz
 * coincidir um abastecimento registado em dois sítios com leituras 4 km diferentes.
 */
export function fuelKeys(input: FuelKeyInput): DedupeKey[] {
  const keys: DedupeKey[] = [];
  const date = normalizeCivilDateForCompare(input.date);
  const litres = normalizeLitresForCompare(input.litres);
  const odometer = normalizeOdometerForCompare(input.odometerKm);
  const amount = normalizeCentsForCompare(input.amountCents);
  const vehicle = input.vehicleLocalId ?? null;

  const strong = compose('date+litres+odometer', 'exact', ['date', 'litres', 'odometerKm'], [
    vehicle,
    date,
    litres,
    odometer,
  ]);
  if (strong.value !== null) {
    keys.push({ ...strong, numeric: { litres, odometerKm: odometer, amountCents: amount } });
  }

  const byLitres = compose('date+litres', 'probable', ['date', 'litres'], [vehicle, date, litres]);
  if (byLitres.value !== null) {
    keys.push({ ...byLitres, numeric: { litres, odometerKm: odometer, amountCents: amount } });
  }

  const byAmount = compose('date+amount', 'probable', ['date', 'amountCents'], [vehicle, date, amount]);
  if (byAmount.value !== null) keys.push({ ...byAmount, numeric: { litres, odometerKm: odometer, amountCents: amount } });

  return keys;
}

/* -------------------------------------------------------------------------- */
/* Carregamento (§8.4)                                                         */
/* -------------------------------------------------------------------------- */

export interface ChargingKeyInput {
  vehicleLocalId?: string | null;
  date?: string | null;
  energyKwh?: number | null;
  odometerKm?: number | null;
}

/**
 * Chaves de um carregamento (§8.4).
 *
 * `data + energia + quilometragem` é **certo**; `data + energia` é **provável**. Mesma
 * lógica do abastecimento: a quilometragem é o que torna a coincidência praticamente
 * impossível por acaso.
 */
export function chargingKeys(input: ChargingKeyInput): DedupeKey[] {
  const keys: DedupeKey[] = [];
  const date = normalizeCivilDateForCompare(input.date);
  const energy = normalizeKwhForCompare(input.energyKwh);
  const odometer = normalizeOdometerForCompare(input.odometerKm);
  const vehicle = input.vehicleLocalId ?? null;

  const strong = compose('date+energy+odometer', 'exact', ['date', 'energyKwh', 'odometerKm'], [
    vehicle,
    date,
    energy,
    odometer,
  ]);
  if (strong.value !== null) {
    keys.push({ ...strong, numeric: { energyKwh: energy, odometerKm: odometer } });
  }

  const weak = compose('date+energy', 'probable', ['date', 'energyKwh'], [vehicle, date, energy]);
  if (weak.value !== null) keys.push({ ...weak, numeric: { energyKwh: energy, odometerKm: odometer } });

  return keys;
}

/* -------------------------------------------------------------------------- */
/* Manutenção, inspeção, seguro e imposto (§8.4)                               */
/* -------------------------------------------------------------------------- */

export interface DatedTypeKeyInput {
  vehicleLocalId?: string | null;
  date?: string | null;
  type?: string | null;
  amountCents?: number | null;
  odometerKm?: number | null;
}

/**
 * Chave partilhada por manutenção, inspeção e seguro (§8.4).
 *
 * `data + tipo` é **provável**; `data + tipo + valor + quilometragem` é **certo**.
 *
 * As três entidades partilham a forma porque partilham o problema: são intervenções
 * datadas, tipadas, com um custo e uma leitura de odómetro. A inspeção usa `result` no
 * lugar de `type`, e o chamador passa esse valor — a chave não precisa de saber a
 * diferença, e é isso que permite acrescentar um tipo de registo novo sem duplicar o
 * motor (§4.3).
 */
export function datedTypeKeys(input: DatedTypeKeyInput): DedupeKey[] {
  const keys: DedupeKey[] = [];
  const date = normalizeCivilDateForCompare(input.date);
  const type = normalizeTextForCompare(input.type);
  const amount = normalizeCentsForCompare(input.amountCents);
  const odometer = normalizeOdometerForCompare(input.odometerKm);
  const vehicle = input.vehicleLocalId ?? null;

  const weak = compose('date+type', 'probable', ['date', 'type'], [vehicle, date, type]);
  if (weak.value !== null) keys.push(weak);

  const strong = compose(
    'date+type+amount+odometer',
    'exact',
    ['date', 'type', 'amountCents', 'odometerKm'],
    [vehicle, date, type, amount, odometer],
  );
  if (strong.value !== null) {
    keys.push({ ...strong, numeric: { amountCents: amount, odometerKm: odometer } });
  }

  return keys;
}

export interface TaxKeyInput {
  vehicleLocalId?: string | null;
  kind?: string | null;
  year?: number | null;
  amountCents?: number | null;
}

/**
 * Chaves de um imposto (§8.4).
 *
 * `ano + tipo` é **certo**: um veículo tem um IUC por ano. Não há razão para tolerância
 * aqui — duas entradas do mesmo imposto no mesmo ano são a mesma obrigação registada
 * duas vezes.
 */
export function taxKeys(input: TaxKeyInput): DedupeKey[] {
  const keys: DedupeKey[] = [];
  const kind = normalizeTextForCompare(input.kind);
  const vehicle = input.vehicleLocalId ?? null;

  const strong = compose('year+kind', 'exact', ['year', 'kind'], [vehicle, input.year, kind]);
  if (strong.value !== null) keys.push(strong);

  // A data fica deliberadamente **fora** da chave: o mesmo imposto pago em datas
  // diferentes é a mesma obrigação, e incluí-la transformaria a mesma obrigação em dois
  // registos. Não é lida de todo, para não sugerir que participa na comparação.
  const amount = normalizeCentsForCompare(input.amountCents);
  const weak = compose('year+kind+amount', 'probable', ['year', 'kind', 'amountCents'], [
    vehicle,
    input.year,
    kind,
    amount,
  ]);
  if (weak.value !== null) keys.push({ ...weak, numeric: { amountCents: amount } });

  return keys;
}

/* -------------------------------------------------------------------------- */
/* Quilometragem (§8.4)                                                        */
/* -------------------------------------------------------------------------- */

export interface OdometerKeyInput {
  vehicleLocalId?: string | null;
  recordedAt?: string | null;
  odometerKm?: number | null;
}

/**
 * Chave de uma leitura de odómetro (§8.4).
 *
 * `data + valor` é **certo**: uma leitura por dia por veículo é a regra, e duas iguais
 * são a mesma leitura registada duas vezes.
 *
 * Nota deliberada: a chave **não** distingue `origin` nem `isCorrection`. Uma leitura
 * corrigida e uma leitura manual com os mesmos valores e a mesma data são a mesma
 * observação do mundo, mesmo que tenham chegado por caminhos diferentes.
 */
export function odometerKeys(input: OdometerKeyInput): DedupeKey[] {
  const date = normalizeCivilDateForCompare(input.recordedAt);
  const odometer = normalizeOdometerForCompare(input.odometerKm);
  const vehicle = input.vehicleLocalId ?? null;

  const key = compose('date+odometer', 'exact', ['recordedAt', 'odometerKm'], [
    vehicle,
    date,
    odometer,
  ]);
  return key.value === null ? [] : [key];
}

/* -------------------------------------------------------------------------- */
/* Documento (§8.4)                                                            */
/* -------------------------------------------------------------------------- */

export interface DocumentKeyInput {
  vehicleLocalId?: string | null;
  name?: string | null;
  expiresAt?: string | null;
  /** `sha256` dos bytes, quando existem. Chave mais forte de todas. */
  contentSha256?: string | null;
  storageKey?: string | null;
}

/**
 * Chaves de um documento (§8.4), por ordem de força.
 *
 *  1. `sha256` do conteúdo — **certo**. O mesmo ficheiro é o mesmo documento. Depende
 *     dos bytes, que a decisão 1 passou a exportar; quando o documento é
 *     `missingContent`, esta chave simplesmente não existe, e a deduplicação cai na
 *     seguinte. É por isso que a lacuna declarada não impede a importação;
 *  2. `storageKey` — **certo**, quando presente;
 *  3. `nome + veículo + validade` — **provável**.
 *
 * O caso do documento sem bytes é o mais interessante do conjunto: o registo entra, é
 * deduplicado por uma chave mais fraca, e a lacuna é nomeada no relatório (§5.6, §9.3).
 * Nada é inventado para preencher o lugar da chave que falta.
 */
export function documentKeys(input: DocumentKeyInput): DedupeKey[] {
  const keys: DedupeKey[] = [];

  if (input.contentSha256 && /^[a-f0-9]{64}$/.test(input.contentSha256)) {
    keys.push({
      kind: 'contentSha256',
      level: 'exact',
      value: input.contentSha256,
      fields: ['contentSha256'],
    });
  }

  if (input.storageKey) {
    keys.push({
      kind: 'storageKey',
      level: 'exact',
      value: input.storageKey,
      fields: ['storageKey'],
    });
  }

  const name = normalizeTextForCompare(input.name);
  const date = normalizeCivilDateForCompare(input.expiresAt);
  const vehicle = input.vehicleLocalId ?? null;
  if (name) {
    keys.push({
      kind: 'name+vehicle+expiresAt',
      level: 'probable',
      value: [name, vehicle ?? '', date ?? ''].join('|'),
      fields: ['name', 'vehicleLocalId', 'expiresAt'],
    });
  }

  return keys;
}

/* -------------------------------------------------------------------------- */
/* Lembrete (§8.4)                                                             */
/* -------------------------------------------------------------------------- */

export interface ReminderKeyInput {
  vehicleLocalId?: string | null;
  title?: string | null;
  dueDate?: string | null;
  dueOdometerKm?: number | null;
}

/**
 * Chave de um lembrete (§8.4).
 *
 * `título normalizado + veículo + condição` é **certo**.
 *
 * A "condição" é a data **ou** a quilometragem, conforme o tipo de gatilho — um lembrete
 * por tempo e um lembrete por distância com o mesmo título são coisas diferentes, e
 * uni-los numa só chave faria um deles desaparecer. Por isso a chave distingue o ramo e
 * exige a parte da condição que se aplica.
 */
export function reminderKeys(input: ReminderKeyInput): DedupeKey[] {
  const keys: DedupeKey[] = [];
  const title = normalizeTextForCompare(input.title);
  const vehicle = input.vehicleLocalId ?? null;
  if (!title) return keys;

  const date = normalizeCivilDateForCompare(input.dueDate);
  if (date !== null) {
    keys.push({
      kind: 'title+vehicle+dueDate',
      level: 'exact',
      value: [title, vehicle ?? '', date].join('|'),
      fields: ['title', 'vehicleLocalId', 'dueDate'],
    });
  }

  const odometer = normalizeOdometerForCompare(input.dueOdometerKm);
  if (odometer !== null) {
    keys.push({
      kind: 'title+vehicle+dueOdometer',
      level: 'exact',
      value: [title, vehicle ?? '', odometer].join('|'),
      fields: ['title', 'vehicleLocalId', 'dueOdometerKm'],
      numeric: { dueOdometerKm: odometer },
    });
  }

  return keys;
}

/* -------------------------------------------------------------------------- */
/* Evento (§8.4)                                                               */
/* -------------------------------------------------------------------------- */

export interface EventKeyInput {
  vehicleLocalId?: string | null;
  type?: string | null;
  date?: string | null;
  title?: string | null;
  recordLocalId?: string | null;
}

/**
 * Chave de um evento (§8.4).
 *
 * `tipo + data + recordLocalId` é **certo** — o evento aponta para o registo que o
 * originou, e essa ligação é uma identidade.
 *
 * Sem `recordLocalId`, `tipo + data + título` é apenas **provável**: um evento pode
 * existir sem registo associado, e nesse caso só resta comparar o que ele diz de si.
 */
export function eventKeys(input: EventKeyInput): DedupeKey[] {
  const keys: DedupeKey[] = [];
  const type = normalizeTextForCompare(input.type);
  const date = normalizeCivilDateForCompare(input.date);
  const vehicle = input.vehicleLocalId ?? null;

  if (input.recordLocalId) {
    const strong = compose('type+date+record', 'exact', ['type', 'date', 'recordLocalId'], [
      vehicle,
      type,
      date,
      input.recordLocalId,
    ]);
    if (strong.value !== null) keys.push(strong);
  }

  const title = normalizeTextForCompare(input.title);
  if (title) {
    const weak = compose('type+date+title', 'probable', ['type', 'date', 'title'], [
      vehicle,
      type,
      date,
      title,
    ]);
    if (weak.value !== null) keys.push(weak);
  }

  return keys;
}

/* -------------------------------------------------------------------------- */
/* Comparação com tolerância (§8.6)                                            */
/* -------------------------------------------------------------------------- */

/**
 * Comparação numérica com tolerância, para uso entre um registo do bundle e um registo
 * existente na conta.
 *
 * A tolerância só se aplica onde a §8.6 a declara. `null` de um dos lados devolve
 * `false`: um valor ausente não está "dentro da tolerância" de nada — está ausente.
 */
export function withinTolerance(
  a: number | null | undefined,
  b: number | null | undefined,
  tolerance: number,
): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= tolerance;
}

/**
 * Compara duas datas civis.
 *
 * Existe para tornar explícito que a tolerância é **zero** (§8.6). Uma data errada por
 * um dia é um dado errado, não um duplicado — e escrever `===` num sítio onde o leitor
 * esperaria uma tolerância é a forma de o documentar.
 */
export function sameCivilDate(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeCivilDateForCompare(a);
  const right = normalizeCivilDateForCompare(b);
  if (left === null || right === null) return false;
  return left === right;
}
