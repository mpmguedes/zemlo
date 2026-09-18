/**
 * O plano de importação — a fase `plan` do fluxo (§7.1).
 *
 * ## O que esta fase faz, e o que não faz
 *
 * Recebe registos já validados e o estado atual da conta, deduplica-os e produz um
 * **plano revisto pelo utilizador** antes de qualquer escrita. Nada aqui escreve: até à
 * fase `apply`, o pedido é puramente de análise e pode ser abandonado sem consequência.
 * É isso que torna impossível o estado que mais dano causa — dados criados parcialmente
 * sem o utilizador saber.
 *
 * ## A distinção que não pode ser colapsada
 *
 * ```
 * exact ≠ probable ≠ new
 * ```
 *
 * Um plano que promovesse um `probable` a `exact` apagaria dados do utilizador. Um plano
 * que tratasse um `exact` como `probable` duplicaria dados. Nos dois casos, sem lhe dizer
 * nada. Por isso o veredicto é um campo obrigatório do plano, e não uma inferência que o
 * consumidor tenha de refazer — a especificação é explícita em que o consumidor **não**
 * deve ter de repetir a lógica de deduplicação para apresentar o resultado.
 *
 * ## Porque é que o plano é rico
 *
 * A §11 exige que a interface apresente, num ecrã, contagens como:
 *
 * ```
 * Criar              298
 * Já existem          14   Ver ▸
 * Precisam de decisão  3   Ver ▸
 * Não vou importar     0
 * ```
 *
 * Tudo o que esse ecrã precisa — incluindo os registos concretos por trás de cada
 * "Ver ▸" e a **razão** de cada decisão — vive no plano. A camada HTTP limita-se a
 * serializá-lo. Recalcular seja o que for a jusante seria duplicar esta lógica, e a
 * primeira divergência entre as duas cópias seria um erro de dados.
 *
 * ## A decisão pertence ao utilizador (§8.3, decisão 10)
 *
 * Este ficheiro classifica e **propõe**. Nunca resolve um provável duplicado por conta
 * própria: só o utilizador sabe se duas portagens no mesmo dia pelo mesmo valor são uma
 * ida e volta ou o mesmo registo introduzido duas vezes. O que o plano faz é tornar essa
 * decisão possível — individualmente, ou em bloco quando são 400 (§8.3).
 */

import type { ImportIssue, IssueSeverity } from '@zemlo/shared';
import {
  chargingKeys,
  datedTypeKeys,
  documentKeys,
  eventKeys,
  expenseKeys,
  fuelKeys,
  odometerKeys,
  reminderKeys,
  taxKeys,
  vehicleKeys,
  type DedupeKey,
} from './dedupe-keys.js';
import type { CanonicalRecord, IssueSummary } from './validate.js';
import { summarizeIssues } from './validate.js';

/* -------------------------------------------------------------------------- */
/* Veredictos (§8.3)                                                           */
/* -------------------------------------------------------------------------- */

/**
 * O que o plano propõe fazer com um registo.
 *
 * Os três primeiros correspondem aos níveis de certeza da §8.3:
 *
 *  - `create`  — **nenhum**. Não há coincidência. É criado;
 *  - `exact`   — **certo**. Uma chave forte coincide exatamente. Ignorado, com contagem;
 *  - `probable`— **provável**. Coincidência dentro de tolerância. **Perguntado**, com a
 *                razão concreta.
 *
 * Os dois últimos são situações que a §9.3 define e que têm de ser visíveis no plano, e
 * não submergidas:
 *
 *  - `quarantined` — o registo não pode entrar sem uma decisão (campo obrigatório em
 *                    falta, blocante ao nível do registo);
 *  - `skipped`     — excluído por uma decisão já tomada, neste plano ou numa revisão
 *                    anterior.
 */
export const PLAN_ACTIONS = [
  'create',
  'exact',
  'probable',
  'quarantined',
  'skipped',
] as const;
export type PlanAction = (typeof PLAN_ACTIONS)[number];

/**
 * Como um registo do bundle interage com um registo que já existe na conta.
 *
 *  - `new`      — não existe nada equivalente;
 *  - `duplicate`— existe um equivalente;
 *  - `enrich`   — existe um equivalente, e há campos vazios no existente que o bundle
 *                 pode preencher. É a **única** escrita automática permitida sobre um
 *                 registo existente (decisão 8);
 *  - `conflict` — existe um equivalente e o conteúdo **difere**. Nunca sobrescrito em
 *                 silêncio: exige decisão explícita (decisão 8, §9.3).
 */
export const CONFLICT_KINDS = ['new', 'duplicate', 'enrich', 'conflict'] as const;
export type ConflictKind = (typeof CONFLICT_KINDS)[number];

/**
 * A política de conflito (decisão 8).
 *
 * `fill-empty` é o valor por omissão, e a razão é assimétrica e deliberada: preencher
 * apenas o que está vazio nunca destrói nada, enquanto `prefer-incoming` destrói. A
 * decisão 8 diz explicitamente que o pior caso de uma importação errada deve passar a
 * ser "apareceram dados a mais que posso apagar" em vez de "perdi o meu histórico".
 *
 * `manual` representa "decidir caso a caso" — o modo avançado da §11.4.
 */
export const CONFLICT_POLICIES = ['keep-existing', 'prefer-incoming', 'fill-empty', 'manual'] as const;
export type ConflictPolicy = (typeof CONFLICT_POLICIES)[number];

/** Política por omissão (decisão 8). Nunca `prefer-incoming`. */
export const DEFAULT_CONFLICT_POLICY: ConflictPolicy = 'fill-empty';

/* -------------------------------------------------------------------------- */
/* Estado existente na conta                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Um registo que já existe na conta, reduzido ao que a deduplicação precisa.
 *
 * Deliberadamente **não** é nem pode ser o modelo Prisma. Este ficheiro é núcleo puro:
 * sem base de dados, sem Prisma, sem HTTP. Quem lê a base de dados — o serviço, na Fase
 * 3 — é que a converte para esta forma. A vantagem não é purismo: é que a lógica de
 * deduplicação fica testável sem uma base de dados, o que é o único modo de a testar
 * exaustivamente.
 *
 * `keys` são as chaves de deduplicação do registo existente, calculadas com as **mesmas
 * funções de `dedupe-keys.ts`** que o bundle usa. Isso é o que garante que os dois lados
 * comparam a mesma coisa.
 *
 * `filledFields` lista os campos do existente que estão preenchidos. É o que permite
 * decidir o que é "preencher um campo vazio" sem carregar o registo inteiro: um campo
 * ausente desta lista está vazio no destino.
 */
export interface ExistingRecord {
  readonly kind: CanonicalRecord['kind'];
  /** Identificador interno (`cuid`). Nunca sai no relatório de importação (§5.5). */
  readonly id: string;
  readonly keys: readonly DedupeKey[];
  readonly filledFields: readonly string[];
  /**
   * Os valores dos campos do existente, para distinguir "preenchido com o mesmo valor"
   * de "preenchido com outro valor".
   *
   * `filledFields` sozinho responde a "está preenchido?" e não a "é diferente?" — e a
   * diferença entre as duas perguntas é a diferença entre não fazer nada e pedir uma
   * decisão ao utilizador. Quando quem lê a conta não fornece isto, **não se declara
   * conflito nenhum** em campos preenchidos dos dois lados: um falso conflito em cada
   * importação de rotina ensinaria o utilizador a ignorar os avisos.
   *
   * Os valores devem vir na mesma forma normalizada que os do bundle, para que a
   * comparação seja entre coisas comparáveis.
   */
  readonly filledValues?: Readonly<Record<string, unknown>>;
  /** Campos que o bundle tem e o existente não, calculados por quem lê a conta. */
  readonly enrichableFields?: readonly string[];
  /** Campos preenchidos em ambos com valores diferentes. */
  readonly conflictingFields?: readonly string[];
}

/** O estado atual da conta, tal como a deduplicação o vê. */
export interface ExistingAccountState {
  readonly records: readonly ExistingRecord[];
  /**
   * Pares `(bundleId, localId)` já registados no livro de idempotência para este
   * utilizador (§9.5).
   *
   * É o que faz uma **reimportação do mesmo bundle não criar nada**. Note-se que isto
   * não é deduplicação: são mecanismos diferentes (§8.2) e a chave inclui o
   * `bundleId`, pelo que reimportar noutra conta cria tudo — que é o que torna possível
   * exportar de uma conta e importar noutra.
   */
  readonly importedLocalIds?: ReadonlyMap<string, string>;
}

/* -------------------------------------------------------------------------- */
/* A proposta                                                                  */
/* -------------------------------------------------------------------------- */

/** Um registo existente que a proposta tomou por equivalente. */
export interface MatchedRecord {
  readonly id: string;
  readonly kind: CanonicalRecord['kind'];
  readonly action: PlanAction;
  readonly conflict: ConflictKind;
  /** A chave que coincidiu, com os campos que cobriu. Explica **em que** coincidem. */
  readonly viaKey: DedupeKey;
  /**
   * Distância medida nos campos com tolerância (quilometragem, valor, litros).
   *
   * Existe para a interface poder dizer *"mesma data, mesmo valor, quilometragem a 4 km"*
   * (§9.3) em vez de um vago "parecido". É a razão concreta que a decisão 10 exige.
   */
  readonly distance?: Readonly<Record<string, number>>;
}

/** A proposta do plano para um registo do bundle. */
export interface PlanEntry {
  readonly localId: string;
  readonly kind: CanonicalRecord['kind'];
  readonly file?: string;
  readonly line?: number;
  readonly action: PlanAction;
  readonly conflict: ConflictKind;
  /**
   * A chave que fundamenta a classificação.
   *
   * `undefined` quando a ação é `create` — não houve coincidência — e por isso mesmo uma
   * entrada `create` nunca deve ser lida como "provavelmente novo": é novo.
   */
  readonly viaKey?: DedupeKey;
  /** Registos existentes que coincidiram. Mais do que um é um sinal a mostrar. */
  readonly matched: readonly MatchedRecord[];
  /** Razão legível, apresentada ao utilizador. Nunca um código técnico (§11.3). */
  readonly reason?: string;
  /** Campos que o bundle preencheria num registo existente (decisão 8). */
  readonly enrichableFields: readonly string[];
  /** Campos em que o bundle e o existente divergem. */
  readonly conflictingFields: readonly string[];
  /** Problemas deste registo, herdados da validação. Nunca descartados. */
  readonly issues: readonly ImportIssue[];
}

/* -------------------------------------------------------------------------- */
/* Contagens (§11.2)                                                           */
/* -------------------------------------------------------------------------- */

/**
 * As contagens que o ecrã de revisão apresenta.
 *
 * A forma segue exatamente os quatro números do §11.2, porque um plano que não os
 * conseguisse produzir obrigaria a interface a recalculá-los — e a primeira divergência
 * entre as duas contagens seria uma contradição visível ao utilizador.
 *
 * `create` e `exact` são diretamente apresentáveis ("Criar 298", "Já existem 14").
 * `probable` exige decisão ("Precisam de decisão 3"). `quarantined` fica em
 * `cannotImport`, que a §11.3 descreve como um estado de onde o utilizador consegue
 * sempre sair — o ficheiro não se perde e pode ser corrigido e reenviado.
 */
export interface PlanCounts {
  readonly create: number;
  readonly exact: number;
  readonly probable: number;
  readonly quarantined: number;
  readonly skipped: number;
  /** Total de registos considerados. A soma das ações acima. */
  readonly total: number;
  /** Registos existentes que seriam enriquecidos — não criados. */
  readonly enriching: number;
  /** Coincidências cujo conteúdo diverge. Exigem decisão (decisão 8). */
  readonly conflicting: number;
  /** Documentos cujo conteúdo não veio no bundle (§5.6). Sempre declarado. */
  readonly documentsMissingContent: number;
}

/** Contagem por tipo de registo, para o resumo em tabela. */
export type CountsByKind = Readonly<Record<string, number>>;

/* -------------------------------------------------------------------------- */
/* O plano                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * O estado do plano.
 *
 * `blocked` não é um plano aplicável: existe para que a interface possa apresentar os
 * problemas em vez de um ecrã vazio. A §11.3 exige que mesmo com erros bloqueantes o
 * ecrã diga o que fazer a seguir.
 */
export type PlanState = 'ready' | 'blocked' | 'nothing-to-do';

/**
 * O plano de importação — o artefacto que o utilizador revê antes de confirmar.
 *
 * ## Porque é que este é o contrato central da funcionalidade
 *
 * A §7.1 proíbe qualquer escrita antes da fase `apply`, e a §11.3 exige que "nada
 * acontece sem o utilizador ver o que vai acontecer". O plano é a materialização das
 * duas coisas: é simultaneamente a proposta que o utilizador aprova e o registo do que
 * foi aprovado.
 *
 * Contém tudo o que é preciso para responder às perguntas da interface — quantos, quais,
 * porquê, com que lacunas — **sem reconsultar a base de dados e sem repetir a
 * deduplicação**. É essa propriedade que a torna auditável: o que o utilizador viu é
 * exatamente o que foi aplicado.
 */
export interface ImportPlan {
  readonly state: PlanState;
  readonly counts: PlanCounts;
  readonly byKind: CountsByKind;
  readonly entries: readonly PlanEntry[];
  /** Todos os problemas — de conjunto, de registo e de plano — numa lista só, agregada. */
  readonly issues: readonly ImportIssue[];
  readonly issueSummary: IssueSummary;
  /** Âmbito declarado pelo bundle. A interface mostra-o: "2 de 5 veículos" (§5.7). */
  readonly scopeNote?: string;
  /** Política de conflito em vigor (decisão 8). */
  readonly conflictPolicy: ConflictPolicy;
  /** Avisos que não se prendem com um registo concreto. */
  readonly notices: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Entradas de deduplicação por tipo de registo                                */
/* -------------------------------------------------------------------------- */

/**
 * Traduz um registo canónico nas suas chaves de deduplicação.
 *
 * Esta função é o único ponto que sabe **que campos** alimentam as chaves de cada tipo.
 * O resto da deduplicação — correspondência, tolerâncias, classificação — é genérico, e
 * é isso que permite acrescentar um tipo de registo novo mexendo só aqui.
 *
 * Os campos vêm de `record.fields`, já normalizados pelo Normalizer, pelo que a
 * normalização não é repetida aqui. Repeti-la seria uma segunda fonte de verdade para a
 * mesma regra, e as duas divergiriam.
 */
export function dedupeKeysFor(record: CanonicalRecord): DedupeKey[] {
  const f = record.fields;
  const vehicleLocalId = record.references.vehicleLocalId ?? null;

  switch (record.kind) {
    case 'vehicle':
      return vehicleKeys({
        plate: f.plate as string | null,
        vin: f.vin as string | null,
        make: f.make as string | null,
        model: f.model as string | null,
        year: f.year as number | null,
      });
    case 'expense':
      return expenseKeyBridge(record);
    case 'fuel':
      return fuelKeys({
        vehicleLocalId,
        date: f.date as string | null,
        litres: f.litres as number | null,
        odometerKm: f.odometerKm as number | null,
        amountCents: f.amountCents as number | null,
      });
    case 'charging':
      return chargingKeys({
        vehicleLocalId,
        date: f.date as string | null,
        energyKwh: f.energyKwh as number | null,
        odometerKm: f.odometerKm as number | null,
      });
    case 'maintenance':
      return datedTypeKeys({
        vehicleLocalId,
        date: f.date as string | null,
        type: f.type as string | null,
        amountCents: f.amountCents as number | null,
        odometerKm: f.odometerKm as number | null,
      });
    case 'insurance':
      return datedTypeKeys({
        vehicleLocalId,
        date: f.startDate as string | null,
        type: f.insurer as string | null,
        amountCents: f.premiumCents as number | null,
      });
    case 'inspection':
      return datedTypeKeys({
        vehicleLocalId,
        date: f.date as string | null,
        type: f.result as string | null,
        amountCents: f.amountCents as number | null,
        odometerKm: f.odometerKm as number | null,
      });
    case 'tax':
      return taxKeys({
        vehicleLocalId,
        kind: f.kind as string | null,
        year: f.year as number | null,
        amountCents: f.amountCents as number | null,
      });
    case 'odometer':
      return odometerKeys({
        vehicleLocalId,
        recordedAt: f.recordedAt as string | null,
        odometerKm: f.odometerKm as number | null,
      });
    case 'document':
      return documentKeys({
        vehicleLocalId,
        name: f.name as string | null,
        expiresAt: f.expiresAt as string | null,
        contentSha256: f.contentSha256 as string | null,
        storageKey: f.storageKey as string | null,
      });
    case 'reminder':
      return reminderKeys({
        vehicleLocalId,
        title: f.title as string | null,
        dueDate: f.dueDate as string | null,
        dueOdometerKm: f.dueOdometerKm as number | null,
      });
    case 'event':
      return eventKeys({
        vehicleLocalId,
        type: f.type as string | null,
        date: f.date as string | null,
        title: f.title as string | null,
        recordLocalId: record.references.recordLocalId ?? null,
      });
    // Sugestões e notificações são dados opcionais (decisão 5) e não participam na
    // deduplicação por conteúdo na v1: uma sugestão dispensada e uma notificação lida
    // têm `dedupeKey` próprio do Zemlo, reconstruído na origem. Não inventar uma chave
    // aqui é preferível a inventar uma errada.
    default:
      return [];
  }
}

/**
 * Ponte para as chaves de despesa.
 *
 * A despesa é o único tipo que precisa do veículo **e** de três campos de texto; mantê-la
 * inline tornaria o `switch` acima difícil de ler. As restantes cabem numa expressão.
 */
function expenseKeyBridge(record: CanonicalRecord): DedupeKey[] {
  const f = record.fields;
  return expenseKeys({
    vehicleLocalId: record.references.vehicleLocalId ?? null,
    date: f.date as string | null,
    amountCents: f.amountCents as number | null,
    category: f.category as string | null,
    vendor: f.vendor as string | null,
    description: f.description as string | null,
  });
}

/* -------------------------------------------------------------------------- */
/* Correspondência                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Compara duas chaves do mesmo `kind` e decide se coincidem e a que nível.
 *
 * Aplica as tolerâncias da §8.6 **apenas** onde estão declaradas. Onde não há razão
 * física, a comparação é exata — porque uma tolerância é uma hipótese sobre o mundo, e
 * inventá-la onde não existe é o mesmo que adivinhar sobre os dados do utilizador.
 */
function keysMatch(
  incoming: DedupeKey,
  existing: DedupeKey,
): { level: 'exact' | 'probable'; distance: Record<string, number> } | null {
  if (incoming.kind !== existing.kind) return null;

  // Uma chave sem valor não se compara: significa que o registo não tem dados
  // suficientes para essa chave, e dois registos sem dados não são o mesmo registo.
  if (incoming.value === null || existing.value === null) return null;

  // Chaves sem campos numéricos comparam-se por igualdade exata do valor canónico.
  if (!incoming.numeric || !existing.numeric) {
    return incoming.value === existing.value ? { level: incoming.level, distance: {} } : null;
  }

  // Chaves com campos numéricos: a igualdade do valor canónico é "exact"; caso
  // contrário, procura-se uma coincidência dentro da tolerância declarada.
  if (incoming.value === existing.value) {
    return { level: incoming.level, distance: {} };
  }

  const distance = toleranceDistance(incoming, existing);
  if (distance === null) return null;

  // **Uma coincidência por tolerância é sempre `probable`, mesmo que a chave seja
  // declarada `exact`.**
  //
  // Esta é a linha mais importante do ficheiro. Uma chave `date+litres+odometer` é
  // "exata" no sentido da §8.4 — a quilometragem é praticamente única por veículo — mas
  // quando os valores *não são iguais* e apenas caem dentro dos ±50 km, o que existe é
  // uma semelhança forte, não uma identidade. Tratá-la como certa ignoraria o registo em
  // silêncio, e o utilizador perderia um abastecimento que era dele.
  //
  // A regra vale nos dois sentidos: nunca se promove um provável a certo.
  return { level: 'probable', distance };
}

/**
 * Mede a distância em cada campo com tolerância declarada.
 *
 * Devolve `null` quando **algum** campo com tolerância excede a sua — não quando a soma
 * excede. A distinção não é subtil: um registo com a quilometragem 40 km acima e o valor
 * 1 cêntimo acima é o mesmo abastecimento; um com a quilometragem certa e 5 euros de
 * diferença não é. Somar as distâncias misturaria unidades diferentes e produziria uma
 * comparação sem significado.
 *
 * ## As partes sem tolerância têm de ser exatamente iguais
 *
 * Uma chave como `date+litres+odometer` tem uma parte que **não** é numérica — a data — e
 * essa parte não tem tolerância nenhuma (§8.6: a data civil tem tolerância zero). Se a
 * comparação só olhasse para os campos numéricos, dois abastecimentos com a mesma
 * quilometragem e os mesmos litros coincidiriam **em datas diferentes**, porque a única
 * parte que difere seria exatamente a que ninguém verificou. É o erro mais perigoso
 * possível: um falso "é o mesmo registo" que ignora dados do utilizador em silêncio.
 *
 * Por isso `stable` — a parte do valor canónico sem os campos numéricos — é comparada
 * diretamente. Quem constrói a chave é que sabe quais são essas partes; reconstruí-las
 * aqui a partir de `value` seria adivinhar.
 */
function toleranceDistance(
  incoming: DedupeKey,
  existing: DedupeKey,
): Record<string, number> | null {
  const tolerances: Record<string, number> = {
    odometerKm: 50,
    amountCents: 2,
    litres: 0.05,
    energyKwh: 0.05,
  };

  // As partes sem tolerância têm de coincidir exatamente. A verificação vem primeiro
  // porque é a mais restritiva: sem ela, uma coincidência de data errada passaria.
  if (incoming.stable !== existing.stable) return null;

  const distance: Record<string, number> = {};
  let compared = 0;

  for (const field of Object.keys(incoming.numeric ?? {})) {
    const tolerance = tolerances[field];
    // Um campo sem tolerância declarada não tolera nada: qualquer diferença exclui a
    // coincidência.
    if (tolerance === undefined) {
      const a = incoming.numeric?.[field];
      const b = existing.numeric?.[field];
      if (a !== b) return null;
      continue;
    }

    const a = incoming.numeric?.[field];
    const b = existing.numeric?.[field];
    const delta = Math.abs((a ?? 0) - (b ?? 0));
    if (delta > tolerance) return null;
    distance[field] = delta;
    compared += 1;
  }

  // Sem nenhum campo numérico comparado, a única base seria a igualdade do valor
  // canónico — que já falhou. Não há coincidência.
  if (compared === 0) return null;

  return distance;
}

/**
 * Calcula o que o bundle acrescentaria a um registo existente (decisão 8).
 *
 * A regra é estreita de propósito: a **única** escrita automática sobre um registo
 * existente é preencher campos que estão vazios no destino. Qualquer outra alteração
 * exige decisão explícita do utilizador.
 *
 * A assimetria é o ponto: preencher o que está vazio nunca destrói nada. Sobrescrever
 * pode destruir tudo, e o utilizador não tem como recuperar.
 *
 * ## Um campo igual não é um conflito
 *
 * A distinção entre "preenchido com o mesmo valor" e "preenchido com outro valor" é a
 * diferença entre não fazer nada e pedir uma decisão ao utilizador. Por isso o conflito
 * só é declarado quando os valores **diferem**:
 *
 *  - se o destino traz os valores (`filledValues`), compara-se valor a valor;
 *  - caso contrário, **um campo preenchido nos dois lados não é declarado em conflito**.
 *    Assumir que difere produziria um aviso falso em cada importação de rotina, e um aviso
 *    falso repetido é a forma mais rápida de ensinar o utilizador a ignorar avisos — o que
 *    destruiria precisamente o mecanismo que a decisão 8 criou para proteger os dados.
 */
function enrichment(
  incomingFields: Readonly<Record<string, unknown>>,
  existing: ExistingRecord,
): { enrichable: string[]; conflicting: string[] } {
  // Se quem leu a conta já fez este trabalho, não o repetimos: é a mesma regra aplicada
  // a um conhecimento do registo que aqui não temos.
  if (existing.enrichableFields || existing.conflictingFields) {
    return {
      enrichable: [...(existing.enrichableFields ?? [])],
      conflicting: [...(existing.conflictingFields ?? [])],
    };
  }

  const filled = new Set(existing.filledFields);
  const known = existing.filledValues;
  const enrichable: string[] = [];
  const conflicting: string[] = [];

  for (const [field, value] of Object.entries(incomingFields)) {
    // A ausência não enriquece: um campo que o bundle não traz não preenche nada.
    if (value === null || value === undefined || value === '') continue;

    // Sem os valores do destino não há forma honesta de afirmar que um campo preenchido dos
    // dois lados difere. A escolha é entre um aviso possivelmente falso em cada registo e
    // nenhum aviso — e a segunda é a segura, porque um conflito é uma pergunta e um
    // enriquecimento nunca sobrescreve. O que `filledFields` diz continua a valer.
    if (known === undefined) {
      if (!filled.has(field)) enrichable.push(field);
      continue;
    }

    // Um campo que o destino não tem — ou que tem com valor vazio — está vazio, e
    // preenchê-lo é enriquecimento. Tratar um `null` em `filledValues` como um valor seria
    // declarar conflito contra um campo que afinal não está preenchido.
    const target = known[field];
    const targetIsEmpty = target === null || target === undefined || target === '';

    if (!filled.has(field) || targetIsEmpty) {
      enrichable.push(field);
      continue;
    }

    if (target !== value) conflicting.push(field);
  }

  return { enrichable, conflicting };
}

/* -------------------------------------------------------------------------- */
/* Classificação                                                               */
/* -------------------------------------------------------------------------- */

/** Resultado da classificação de um registo, antes de se tornar uma entrada do plano. */
interface Classification {
  readonly action: PlanAction;
  readonly conflict: ConflictKind;
  readonly matched: MatchedRecord[];
  readonly viaKey?: DedupeKey;
  readonly reason: string;
  readonly enrichable: string[];
  readonly conflicting: string[];
}

/**
 * Classifica um registo face ao estado da conta.
 *
 * A ordem das verificações é significativa, e é a parte do ficheiro onde é mais fácil
 * introduzir um erro que só se manifesta meses depois:
 *
 *  1. **idempotência** primeiro — se este `localId` deste `bundleId` já entrou, nada mais
 *     interessa. É o que faz a reimportação não criar nada (§9.5), e é também o que
 *     torna a retoma após interrupção segura (§7.2);
 *  2. **correspondência por chave**, com os níveis da §8.3;
 *  3. **enriquecimento ou conflito**, conforme o conteúdo difere ou não (decisão 8).
 */
function classify(
  record: CanonicalRecord,
  keys: readonly DedupeKey[],
  state: ExistingAccountState,
  issues: readonly ImportIssue[],
): Classification {
  /* ---- 1. Idempotência (§9.5) ---- */

  const alreadyImported = state.importedLocalIds?.get(record.localId);
  if (alreadyImported !== undefined) {
    // Não é deduplicação: é o livro de idempotência. A distinção importa porque o
    // resultado é diferente — aqui sabemos que **nós** criámos este registo a partir
    // deste bundle, e por isso o relatório pode dizer "já importado" em vez de "já
    // existente".
    return {
      action: 'skipped',
      conflict: 'duplicate',
      matched: [],
      reason: `Este registo já foi importado deste ficheiro. Aponta para o registo que existe na tua conta.`,
      enrichable: [],
      conflicting: [],
    };
  }

  /* ---- 1b. Quarentena: não entra sem decisão (§9.2) ---- */

  // Um registo em quarentena não é classificado contra a conta: a classificação seria
  // sobre dados que ainda não sabemos se entram.
  if (issues.some((issue) => issue.severity === 'blocking')) {
    return {
      action: 'quarantined',
      conflict: 'new',
      matched: [],
      reason: 'Este registo tem um problema que impede a importação. Está descrito nos avisos.',
      enrichable: [],
      conflicting: [],
    };
  }

  /* ---- 2. Correspondência ---- */

  const matches: MatchedRecord[] = [];
  let bestExact: { key: DedupeKey; match: MatchedRecord } | null = null;
  let bestProbable: { key: DedupeKey; match: MatchedRecord } | null = null;

  for (const existing of state.records) {
    if (existing.kind !== record.kind) continue;

    for (const existingKey of existing.keys) {
      for (const key of keys) {
        const result = keysMatch(key, existingKey);

        // Promoção explícita e controlada: uma chave declarada `exact` que coincide
        // exatamente é certa. Tudo o resto é provável — incluindo uma coincidência por
        // tolerância numa chave declarada `exact`, que `keysMatch` já rebaixou.
        const level: 'exact' | 'probable' = result?.level === 'exact' ? 'exact' : 'probable';
        if (!result) continue;

        const matched: MatchedRecord = {
          id: existing.id,
          kind: existing.kind,
          action: level === 'exact' ? 'exact' : 'probable',
          conflict: 'duplicate',
          viaKey: key,
          ...(Object.keys(result.distance).length > 0 ? { distance: result.distance } : {}),
        };

        if (level === 'exact') {
          if (!bestExact) bestExact = { key, match: matched };
        } else if (!bestProbable) {
          bestProbable = { key, match: matched };
        }
      }
    }
  }

  /* ---- 3. Sem coincidência: criar ---- */

  if (!bestExact && !bestProbable) {
    return {
      action: 'create',
      conflict: 'new',
      matched: [],
      reason: 'Não existe nada equivalente na tua conta.',
      enrichable: [],
      conflicting: [],
    };
  }

  /* ---- 4. Exact contra probable — a distinção que não se colapsa ---- */

  const chosen = bestExact ?? bestProbable;
  if (!chosen) {
    return {
      action: 'create',
      conflict: 'new',
      matched: [],
      reason: 'Não existe nada equivalente na tua conta.',
      enrichable: [],
      conflicting: [],
    };
  }

  const existingRecord = state.records.find((item) => item.id === chosen.match.id);
  const { enrichable, conflicting } = existingRecord
    ? enrichment(record.fields, existingRecord)
    : { enrichable: [], conflicting: [] };

  // Enriquecimento só é proposto quando há campos vazios a preencher **e** nenhum campo
  // em conflito. Um registo com campos divergentes é um conflito, não um enriquecimento:
  // misturar os dois faria a escrita automática tocar em dados preenchidos.
  const conflictKind: ConflictKind =
    conflicting.length > 0 ? 'conflict' : enrichable.length > 0 ? 'enrich' : 'duplicate';

  if (bestExact) {
    matches.push(bestExact.match);
    return {
      action: 'exact',
      conflict: conflictKind,
      matched: matches,
      viaKey: bestExact.key,
      reason: exactReason(bestExact.key, enrichable, conflicting),
      enrichable,
      conflicting,
    };
  }

  matches.push(chosen.match);
  return {
    action: 'probable',
    conflict: conflictKind,
    matched: matches,
    viaKey: chosen.key,
    reason: probableReason(chosen.key, chosen.match, conflicting),
    enrichable,
    conflicting,
  };
}

/** Razão legível para um duplicado certo. */
function exactReason(key: DedupeKey, enrichable: string[], conflicting: string[]): string {
  if (conflicting.length > 0) {
    return `Já tens um registo equivalente, mas os dados não coincidem exatamente (${describeKey(key)}). Não vou alterar nada sem tu decidires.`;
  }
  if (enrichable.length > 0) {
    return `Já tens um registo equivalente (${describeKey(key)}). Posso preencher ${enrichable.length} campo(s) que estão vazios, sem alterar nada do que já lá está.`;
  }
  return `Já tens este registo na tua conta (${describeKey(key)}).`;
}

/**
 * Razão legível para um duplicado provável (§9.3).
 *
 * A mensagem tem de trazer a **razão concreta**, não um vago "parecido". É o que
 * distingue uma decisão que o utilizador consegue tomar de uma que ele vai ignorar — e
 * ignorar um provável significa ou perder o registo, ou ficar com dois.
 */
function probableReason(key: DedupeKey, match: MatchedRecord, conflicting: string[]): string {
  const distance = match.distance ?? {};
  const odometer = distance.odometerKm;
  const amount = distance.amountCents;
  const litres = distance.litres;
  const energy = distance.energyKwh;

  const parts: string[] = [];
  if (odometer !== undefined) parts.push(`quilometragem a ${odometer} km`);
  if (amount !== undefined) parts.push(`valor a ${(amount / 100).toFixed(2).replace('.', ',')} €`);
  if (litres !== undefined) parts.push(`litros a ${litres.toFixed(2).replace('.', ',')}`);
  if (energy !== undefined) parts.push(`energia a ${energy.toFixed(2).replace('.', ',')} kWh`);

  if (parts.length > 0) {
    const extra = conflicting.length > 0 ? ' Há também campos com valores diferentes.' : '';
    return `Muito parecido com um registo que já tens: ${parts.join(', ')}.${extra}`;
  }

  // Sem distância medida, a coincidência é de conteúdo mas não é uma identidade: em vez
  // de afirmar, descreve-se o que se comparou.
  const extra = conflicting.length > 0 ? ' Os dados não coincidem exatamente.' : '';
  return `Parecido com um registo que já tens (${describeKey(key)}), mas não é uma coincidência exata.${extra}`;
}

/** Descreve uma chave em linguagem corrente, para o utilizador. Nunca expõe o `kind` cru. */
function describeKey(key: DedupeKey): string {
  return KEY_DESCRIPTIONS[key.kind] ?? 'mesmos dados';
}

/**
 * Tradução das chaves para linguagem de utilizador.
 *
 * A §11.3 é explícita — "zero conceitos técnicos, não aparece ID, chave, transação,
 * referência, schema, localId". Um `kind` como `date+type+amount+odometer` é precisamente
 * o que não pode chegar ao ecrã.
 */
const KEY_DESCRIPTIONS: Readonly<Record<string, string>> = {
  vin: 'mesmo VIN',
  plate: 'mesma matrícula',
  'make+model+year': 'mesma marca, modelo e ano',
  'date+amount+vehicle': 'mesma data e valor',
  'date+amount+category+vendor+description+vehicle': 'mesma data, valor, categoria e descrição',
  'date+litres+odometer': 'mesma data, litros e quilometragem',
  'date+litres': 'mesma data e litros',
  'date+amount': 'mesma data e valor',
  'date+energy+odometer': 'mesma data, energia e quilometragem',
  'date+energy': 'mesma data e energia',
  'date+type': 'mesma data e tipo',
  'date+type+amount+odometer': 'mesma data, tipo, valor e quilometragem',
  'year+kind+amount': 'mesmo ano e tipo de imposto',
  'year+kind': 'mesmo ano e tipo de imposto',
  'date+odometer': 'mesma data e mesma leitura',
  contentSha256: 'mesmo ficheiro',
  storageKey: 'mesmo ficheiro',
  'name+vehicle+expiresAt': 'mesmo nome e validade',
  'title+vehicle+dueDate': 'mesmo título e data',
  'title+vehicle+dueOdometer': 'mesmo título e quilometragem',
  'type+date+record': 'mesmo acontecimento',
  'type+date+title': 'mesmo tipo e data',
};

/* -------------------------------------------------------------------------- */
/* Construção do plano                                                         */
/* -------------------------------------------------------------------------- */

export interface BuildPlanOptions {
  readonly records: readonly CanonicalRecord[];
  readonly state: ExistingAccountState;
  /** Problemas da validação, preservados no plano em vez de recalculados. */
  readonly validationIssues?: readonly ImportIssue[];
  /**
   * Avisos do **bundle** (não da validação), preservados no plano.
   *
   * É o canal pelo qual a divergência de `counts` chega ao utilizador (A26): o `bundle.ts`
   * deteta-a e classifica-a como `info`, e o plano tem de a transportar até à interface.
   * Sem isto, o aviso existiria no resultado da leitura e perder-se-ia antes de chegar a
   * quem o devia ver — o utilizador veria "importamos os N que existem" em lado nenhum.
   *
   * São issues **sem `localId`**, e por isso não entram nas entradas: não pertencem a
   * nenhum registo, e atribuí-las a um seria inventar um dono.
   */
  readonly bundleIssues?: readonly ImportIssue[];
  readonly conflictPolicy?: ConflictPolicy;
  /** Âmbito declarado pelo bundle (§5.7), para apresentação. */
  readonly scopeNote?: string;
  /** Decisões já tomadas pelo utilizador, numa revisão anterior. */
  readonly decisions?: ReadonlyMap<string, PlanAction>;
  /** `true` quando a validação detetou bloqueantes ao nível do bundle (§9.4). */
  readonly bundleBlocked?: boolean;
}

/**
 * Constrói o plano de importação.
 *
 * Função **pura**: o mesmo `(records, state, options)` produz sempre o mesmo plano. Não
 * lê a base de dados, não escreve, não depende da hora nem do ambiente. É o que permite
 * gravar um plano, mostrá-lo ao utilizador e depois aplicá-lo com a garantia de que é
 * exatamente o que ele aprovou.
 *
 * ## Nunca promove um provável a certo
 *
 * A promoção só acontece num sentido, e dentro do próprio `keysMatch`: uma chave
 * declarada `exact` que coincide **exatamente** é certa. Uma coincidência por tolerância
 * é rebaixada a provável mesmo que a chave seja declarada exata. Não existe nenhum
 * caminho neste ficheiro que transforme um provável em certo.
 */
export function buildPlan(options: BuildPlanOptions): ImportPlan {
  const {
    records,
    state,
    validationIssues = [],
    bundleIssues = [],
    conflictPolicy = DEFAULT_CONFLICT_POLICY,
    scopeNote,
    decisions,
    bundleBlocked = false,
  } = options;

  const inherited = new Map<string, readonly ImportIssue[]>();
  for (const issue of validationIssues) {
    if (!issue.localId) continue;
    const list = inherited.get(issue.localId) ?? [];
    inherited.set(issue.localId, [...list, issue]);
  }

  const entries: PlanEntry[] = records.map((record) => {
    const issues = inherited.get(record.localId) ?? [];
    const keys = dedupeKeysFor(record);

    const classification =
      decisions?.has(record.localId) === true
        ? applyDecision(decisions.get(record.localId) as PlanAction, issues)
        : classify(record, keys, state, issues);

    return {
      localId: record.localId,
      kind: record.kind,
      ...(record.file ? { file: record.file } : {}),
      ...(record.line !== undefined ? { line: record.line } : {}),
      action: classification.action,
      conflict: classification.conflict,
      ...(classification.viaKey ? { viaKey: classification.viaKey } : {}),
      matched: classification.matched,
      reason: classification.reason,
      enrichableFields: classification.enrichable,
      conflictingFields: classification.conflicting,
      issues,
    };
  });

  const counts = countPlan(entries);
  const notices = buildNotices(entries, bundleBlocked);

  // Uma importação bloqueada ao nível do bundle (§9.4) nunca é `ready`, mesmo que todos
  // os registos individuais estejam em ordem: o bundle está internamente inconsistente, e
  // o plano tem de dizer isso em vez de oferecer um botão que não pode funcionar.
  const state_: PlanState = bundleBlocked
    ? 'blocked'
    : counts.create + counts.probable + counts.enriching === 0
      ? 'nothing-to-do'
      : 'ready';

  // Os problemas de conjunto — sem `localId` — não pertencem a nenhuma entrada, e por
  // isso são preservados à parte. Descartá-los porque "não têm dono" seria esconder
  // exatamente os problemas que bloqueiam o bundle inteiro.
  const orphanIssues = validationIssues.filter((issue) => !issue.localId);

  /*
   * Os avisos do bundle juntam-se aos da validação num só conjunto. Não vão para as
   * entradas: são avisos de conjunto (o `counts` do manifest é sobre o ficheiro, não sobre
   * os registos), e o `inherited` acima só distribui por `localId` — um aviso sem dono não
   * tem por onde ser distribuído.
   *
   * A ordem preserva os da validação primeiro: a interface mostra-os pela ordem em que
   * chegam, e os problemas de um registo concreto são mais accionáveis do que um aviso de
   * contagem.
   */
  const allIssues = [...validationIssues, ...bundleIssues];

  return {
    state: state_,
    counts,
    byKind: countByKind(entries),
    entries,
    issues: allIssues,
    issueSummary: summarizeIssues([
      ...allIssues,
      ...orphanIssues.map((item) => ({ ...item })),
    ]),
    ...(scopeNote ? { scopeNote } : {}),
    conflictPolicy,
    notices,
  };
}

/** Aplica uma decisão já tomada pelo utilizador, sem reclassificar. */
function applyDecision(
  action: PlanAction,
  issues: readonly ImportIssue[],
): Classification {
  // Uma decisão do utilizador **não** contorna um problema bloqueante: quarentena é um
  // estado de dados, não uma preferência.
  if (action !== 'skipped' && issues.some((issue) => issue.severity === 'blocking')) {
    return {
      action: 'quarantined',
      conflict: 'new',
      matched: [],
      reason: 'Este registo tem um problema que impede a importação.',
      enrichable: [],
      conflicting: [],
    };
  }

  return {
    action,
    conflict: action === 'create' ? 'new' : 'duplicate',
    matched: [],
    reason:
      action === 'skipped'
        ? 'Decidiste não importar este registo.'
        : 'Decisão registada nesta revisão.',
    enrichable: [],
    conflicting: [],
  };
}

/** Conta o plano segundo a forma exigida pelo §11.2. */
function countPlan(entries: readonly PlanEntry[]): PlanCounts {
  let create = 0;
  let exact = 0;
  let probable = 0;
  let quarantined = 0;
  let skipped = 0;
  let enriching = 0;
  let conflicting = 0;
  let documentsMissingContent = 0;

  for (const entry of entries) {
    if (entry.action === 'create') create += 1;
    else if (entry.action === 'exact') exact += 1;
    else if (entry.action === 'probable') probable += 1;
    else if (entry.action === 'quarantined') quarantined += 1;
    else if (entry.action === 'skipped') skipped += 1;

    if (entry.conflict === 'enrich') enriching += 1;
    if (entry.conflict === 'conflict') conflicting += 1;

    if (
      entry.kind === 'document' &&
      entry.issues.some((issue) => issue.code === 'document.content_missing')
    ) {
      documentsMissingContent += 1;
    }
  }

  return {
    create,
    exact,
    probable,
    quarantined,
    skipped,
    total: entries.length,
    enriching,
    conflicting,
    documentsMissingContent,
  };
}

function countByKind(entries: readonly PlanEntry[]): CountsByKind {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
  }
  return counts;
}

/**
 * Avisos que não se prendem a um registo concreto.
 *
 * Existem porque há coisas que o utilizador tem de saber **antes** de confirmar e que não
 * cabem na contagem de nenhuma ação — sobretudo lacunas que já sabemos existir.
 */
function buildNotices(entries: readonly PlanEntry[], bundleBlocked: boolean): string[] {
  const notices: string[] = [];

  if (bundleBlocked) {
    notices.push(
      'Este ficheiro está internamente inconsistente: há registos que apontam para outros que não existem nele. Nada foi importado.',
    );
  }

  const missingContent = entries.filter(
    (entry) =>
      entry.kind === 'document' &&
      entry.issues.some((issue) => issue.code === 'document.content_missing'),
  ).length;

  // A decisão 2 é explícita: a limitação não pode ficar escondida. Este aviso é a forma
  // de a tornar visível antes da confirmação, e não depois.
  if (missingContent > 0) {
    notices.push(
      `${missingContent} documento(s) não trouxeram o ficheiro original. Os registos entram na mesma e podes adicionar os ficheiros mais tarde.`,
    );
  }

  const quarantined = entries.filter((entry) => entry.action === 'quarantined').length;
  if (quarantined > 0) {
    notices.push(
      `${quarantined} registo(s) não podem ser importados sem correção. Estão identificados nos avisos.`,
    );
  }

  return notices;
}

/* -------------------------------------------------------------------------- */
/* Revisão pelo utilizador (decisão 10)                                        */
/* -------------------------------------------------------------------------- */

/**
 * Regista a decisão do utilizador sobre um duplicado provável.
 *
 * Devolve um novo plano — nunca muta o recebido. A imutabilidade é o que permite que a
 * interface mostre o plano antes e depois de cada decisão sem ter de o reconstruir, e é
 * também o que garante que "o que o utilizador viu" e "o que foi aplicado" são o mesmo
 * objeto.
 *
 * `skip` é a decisão segura: não importar um registo ambíguo deixa a conta intacta e o
 * ficheiro do utilizador continua a existir para tentar outra vez.
 */
export function decideEntry(
  plan: ImportPlan,
  localId: string,
  decision: 'create' | 'skip',
): ImportPlan {
  const entries = plan.entries.map((entry) => {
    if (entry.localId !== localId) return entry;
    if (entry.action === 'quarantined') return entry;

    return {
      ...entry,
      action: (decision === 'skip' ? 'skipped' : 'create') as PlanAction,
      reason:
        decision === 'skip'
          ? 'Decidiste não importar este registo.'
          : 'Decidiste importar este registo como novo.',
    };
  });

  const counts = countPlan(entries);

  return {
    ...plan,
    entries,
    counts,
    byKind: countByKind(entries),
    state: counts.create + counts.probable + counts.enriching === 0 ? 'nothing-to-do' : plan.state,
  };
}

/**
 * Aplica uma decisão a **todos** os prováveis de uma vez (decisão 10).
 *
 * Existe porque as duas metades da decisão 10 são necessárias e nenhuma serve sozinha:
 * numa importação de 8 000 registos com 400 prováveis, exigir 400 decisões individuais
 * torna a funcionalidade inutilizável; e resolver os 400 em silêncio apaga dados.
 *
 * Deliberadamente **não** afeta duplicados certos — esses estão resolvidos pela
 * deduplicação, e uma ação em bloco sobre eles seria uma forma discreta de forçar a
 * duplicação de tudo.
 */
export function decideAllProbables(plan: ImportPlan, decision: 'create' | 'skip'): ImportPlan {
  const entries = plan.entries.map((entry) => {
    if (entry.action !== 'probable') return entry;
    return {
      ...entry,
      action: (decision === 'skip' ? 'skipped' : 'create') as PlanAction,
      reason:
        decision === 'skip'
          ? 'Decidiste não importar os registos ambíguos.'
          : 'Decidiste importar os registos ambíguos como novos.',
    };
  });

  const counts = countPlan(entries);

  return {
    ...plan,
    entries,
    counts,
    byKind: countByKind(entries),
    state: counts.create + counts.probable + counts.enriching === 0 ? 'nothing-to-do' : plan.state,
  };
}

/**
 * `true` quando o plano pode ser aplicado tal como está.
 *
 * Um plano com prováveis pendentes **pode** ser aplicado: a §8.3 diz que a ação por
 * omissão de um provável é perguntar, mas a decisão 10 permite aplicá-los em bloco. O que
 * não pode acontecer é aplicá-los sem o utilizador saber — e é por isso que
 * `pendingDecisions` existe, para a interface ter de o dizer explicitamente antes de
 * avançar.
 */
export function canApply(plan: ImportPlan): boolean {
  if (plan.state === 'blocked') return false;
  if (plan.state === 'nothing-to-do') return false;
  return true;
}

/** Quantos registos ainda exigem uma decisão antes de aplicar. */
export function pendingDecisions(plan: ImportPlan): number {
  return plan.counts.probable;
}

/**
 * Os registos que a aplicação vai criar, na ordem em que devem ser criados.
 *
 * A ordem é significativa e não é alfabética: **veículos primeiro**, porque todos os
 * outros tipos lhes apontam, e os documentos antes dos registos que os referenciam. Uma
 * ordem ingénua produziria violações de chave estrangeira em registos perfeitamente
 * válidos — um erro que apareceria na escrita, longe da causa.
 */
const KIND_ORDER: readonly CanonicalRecord['kind'][] = [
  'vehicle',
  'odometer',
  'expense',
  'fuel',
  'charging',
  'maintenance',
  'insurance',
  'inspection',
  'tax',
  'document',
  'reminder',
  'event',
  'suggestion',
  'notification',
];

export function creationOrder(plan: ImportPlan): readonly PlanEntry[] {
  const rank = new Map(KIND_ORDER.map((kind, index) => [kind, index]));
  return [...plan.entries]
    .filter((entry) => entry.action === 'create')
    .sort((a, b) => (rank.get(a.kind) ?? 99) - (rank.get(b.kind) ?? 99));
}

/* -------------------------------------------------------------------------- */
/* Serialização para a interface (§11.2)                                       */
/* -------------------------------------------------------------------------- */

/**
 * Resumo pronto a apresentar, com os quatro números do §11.2.
 *
 * Existe para que a camada HTTP **não** construa contagens a partir das entradas. Se o
 * fizesse, teria uma segunda implementação da mesma regra, e a primeira divergência
 * entre as duas seria uma contradição visível ao utilizador — "Criar 298" no topo e 297
 * registos na lista.
 */
export interface PlanSummary {
  readonly state: PlanState;
  readonly toCreate: number;
  readonly alreadyExists: number;
  readonly needsDecision: number;
  readonly cannotImport: number;
  readonly skipped: number;
  readonly total: number;
  readonly enriching: number;
  readonly conflicting: number;
  readonly documentsMissingContent: number;
  readonly notices: readonly string[];
  readonly scopeNote?: string;
}

export function summarizePlan(plan: ImportPlan): PlanSummary {
  return {
    state: plan.state,
    toCreate: plan.counts.create,
    alreadyExists: plan.counts.exact,
    needsDecision: plan.counts.probable,
    // Apresentado como "Não vou importar" no §11.2: agrega o que ficou de fora, por
    // quarentena ou por decisão — nos dois casos, o que o utilizador não vai receber.
    cannotImport: plan.counts.quarantined,
    skipped: plan.counts.skipped,
    total: plan.counts.total,
    enriching: plan.counts.enriching,
    conflicting: plan.counts.conflicting,
    documentsMissingContent: plan.counts.documentsMissingContent,
    notices: plan.notices,
    ...(plan.scopeNote ? { scopeNote: plan.scopeNote } : {}),
  };
}

/** Filtra as entradas por ação, para as listas do modo avançado (§11.4). */
export function entriesByAction(
  plan: ImportPlan,
  action: PlanAction,
): readonly PlanEntry[] {
  return plan.entries.filter((entry) => entry.action === action);
}

/** Problemas por gravidade, para as listas de avisos e de quarentena (§11.4). */
export function issuesBySeverity(
  plan: ImportPlan,
  severity: IssueSeverity,
): readonly ImportIssue[] {
  return plan.issues.filter((issue) => issue.severity === severity);
}
