/**
 * Identificadores do bundle de importação/exportação (§2.1, §9.5).
 *
 * ## O que é um `localId`
 *
 * Um `localId` é um identificador **local ao bundle**, gerado pelo exportador, estável
 * dentro desse bundle e **opaco** para quem o lê (`veh_1`, `exp_7`, `doc_3`).
 *
 * Serve exatamente duas coisas, e nada mais:
 *
 *  1. **ligar registos dentro do bundle** — as relações usam `localId`, nunca o `cuid`
 *     interno da base de dados, porque o `cuid` sugere uma identidade que não sobrevive
 *     à importação (§5.5);
 *  2. **registar o que já foi importado**, no livro de idempotência (§9.5), para que
 *     reimportar o mesmo bundle não crie nada de novo.
 *
 * ## O que ele *não* é
 *
 * Não é identidade de domínio, e **não** é usado para decidir se dois registos são o
 * mesmo. Um `localId` diferente não significa um registo diferente: dois bundles
 * exportados da mesma conta em momentos diferentes terão `localId` novos para os mesmos
 * registos. É por isso que a deduplicação não pode depender deles — essa pergunta é
 * respondida pelas chaves de conteúdo (§8).
 *
 * ## Porque é que o formato é opaco
 *
 * O importador **nunca** interpreta o `localId`: não faz `split('_')`, não extrai
 * números de sequência, não assume prefixo. É essa disciplina que permite alterar o
 * formato numa versão futura sem quebrar bundles antigos.
 */

import { randomBytes } from 'node:crypto';

/** Prefixos por tipo de registo. Puramente legíveis — o importador não os interpreta. */
export const LOCAL_ID_PREFIXES = {
  vehicle: 'veh',
  odometer: 'odo',
  expense: 'exp',
  fuel: 'fuel',
  charging: 'chg',
  maintenance: 'mnt',
  insurance: 'ins',
  inspection: 'isp',
  tax: 'tax',
  document: 'doc',
  reminder: 'rem',
  event: 'evt',
  suggestion: 'sug',
  notification: 'ntf',
  audit: 'aud',
} as const;

export type LocalIdPrefix = (typeof LOCAL_ID_PREFIXES)[keyof typeof LOCAL_ID_PREFIXES];

/**
 * Comprimento máximo de um `localId`.
 *
 * Um limite explícito evita que um bundle hostil faça crescer a tabela do livro de
 * idempotência ou os cabeçalhos de resposta sem limite. 80 caracteres acomodam
 * folgadamente o esquema `prefixo_sequência` com margem para adaptadores externos.
 */
export const LOCAL_ID_MAX_LENGTH = 80;

/**
 * Formato aceite num `localId` vindo de um bundle.
 *
 * Deliberadamente permissivo quanto ao conteúdo — um adaptador externo pode usar
 * identificadores seus — mas restrito quanto à **forma**: nada de espaços, barras,
 * pontos, dois-pontos ou caracteres de controlo. Um `localId` acaba num caminho de
 * pasta (`documents/<localId>/<nome>`, §5.6) e a validação é a primeira linha de defesa
 * contra escrita fora da área temporária (§13.4).
 *
 * A regra `..` é recusada explicitamente: é o padrão clássico de travessia de caminho.
 */
const LOCAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * `true` quando uma string é um `localId` sintaticamente aceitável.
 *
 * Rejeita, além do padrão: strings vazias, strings acima do limite, e qualquer valor
 * que contenha `..` — mesmo que passasse no padrão, o que hoje não acontece, a
 * verificação explícita documenta a intenção e sobrevive a uma futura flexibilização
 * do padrão.
 */
export function isValidLocalId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > LOCAL_ID_MAX_LENGTH) return false;
  if (value.includes('..')) return false;
  return LOCAL_ID_PATTERN.test(value);
}

/**
 * Gera `localId` sequenciais e estáveis para um bundle.
 *
 * O contador é local à criação do gerador, pelo que duas exportações produzem
 * sequências independentes — exatamente o que a §2.1 descreve. A estabilidade dentro do
 * bundle é o que importa: o mesmo registo tem de receber o mesmo `localId` em todas as
 * referências que apontam para ele.
 */
export function createLocalIdFactory(prefix: LocalIdPrefix = LOCAL_ID_PREFIXES.vehicle): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `${prefix}_${counter}`;
  };
}

/**
 * Gerador de `localId` por tipo de registo, com contadores independentes.
 *
 * Existe porque uma exportação precisa de numerar cada tipo pela sua própria sequência
 * (`veh_1`, `exp_1`, `exp_2`, `doc_1`) e porque esquecer-se de avançar um contador
 * produziria dois registos com o mesmo `localId` — uma colisão que só se manifestaria
 * na importação, longe da causa.
 */
export class LocalIdGenerator {
  private readonly counters = new Map<string, number>();

  /** Devolve o `localId` seguinte para um tipo, avançando apenas o contador desse tipo. */
  next(prefix: LocalIdPrefix): string {
    const current = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, current);
    return `${prefix}_${current}`;
  }

  /** Quantos identificadores já foram emitidos para um tipo. Útil em testes e no manifest. */
  count(prefix: LocalIdPrefix): number {
    return this.counters.get(prefix) ?? 0;
  }
}

/* -------------------------------------------------------------------------- */
/* `bundleId` (§6, §9.5)                                                       */
/* -------------------------------------------------------------------------- */

/** Prefixo do identificador de bundle, pela mesma razão dos prefixos de `localId`. */
export const BUNDLE_ID_PREFIX = 'bnd';

/**
 * Gera o identificador de **este** bundle.
 *
 * É a chave da idempotência: o livro registra `(userId, bundleId, localId)` e é isso
 * que faz com que reimportar o mesmo ficheiro não crie nada (§9.5).
 *
 * Usa aleatoriedade criptográfica e não um contador nem um timestamp. Duas razões
 * concretas:
 *
 *  - um `bundleId` previsível permitiria a uma conta forjar um bundle com o
 *    `bundleId` de outra e colidir com o livro de idempotência dessa conta;
 *  - um `bundleId` derivado do tempo colidiria entre duas exportações no mesmo
 *    milissegundo, o que é plausível num pedido repetido.
 */
export function generateBundleId(): string {
  return `${BUNDLE_ID_PREFIX}_${randomBytes(16).toString('hex')}`;
}

/**
 * `true` quando um `bundleId` tem a forma esperada.
 *
 * Só a forma é verificada — nunca a autenticidade. Um `bundleId` não é um segredo nem
 * uma credencial: é um rótulo de correlação. A autorização vem do token de sessão e a
 * chave do livro inclui sempre o `userId` (§13.4).
 */
export function isValidBundleId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length < 4 || value.length > 64) return false;
  return /^bnd_[a-f0-9]{8,60}$/.test(value);
}

/* -------------------------------------------------------------------------- */
/* Normalização de identificadores vindos de fora                              */
/* -------------------------------------------------------------------------- */

/**
 * Normaliza um `externalId` vindo de outra aplicação (§2.3).
 *
 * Só remove espaços nas pontas. **Não** colapsa espaços internos, não muda maiúsculas e
 * não remove separadores: um identificador de origem é opaco também para nós, e
 * "normalizá-lo" com base numa suposição sobre o sistema de origem é a forma mais
 * rápida de deixar de reconhecer registos que já importámos.
 */
export function normalizeExternalId(value: string): string {
  return value.trim();
}

/**
 * Normaliza o nome da aplicação de origem, para que `Outra App`, `outra app` e
 * ` outra  app ` contem como a mesma origem.
 *
 * Ao contrário do identificador, o **nome da origem é nosso** e é comparado por nós:
 * uma diferença de maiúsculas aqui não é uma origem diferente, é a mesma origem escrita
 * de outra maneira. Não fazer esta normalização faria com que uma segunda importação da
 * mesma aplicação não reconhecesse os registos da primeira.
 */
export function normalizeExternalSource(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
