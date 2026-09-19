/**
 * Persistência do mapa de colunas da Camada 2 (§10.2 passo 9, §11.3).
 *
 * ## O que guarda, e o que recusa guardar
 *
 * Guarda **decisões**: que coluna é que campo, que convenções o utilizador confirmou
 * (§10.4: "a resposta fica guardada no mapa"), e que tipo de registo o mapa serve.
 *
 * Não guarda valores. Guardar amostras de linhas seria guardar dados do utilizador que não
 * são precisos para reaplicar o mapa, e a §7.3 pede o mínimo. Os cabeçalhos são a única
 * informação do ficheiro aqui presente, e são sobre a **forma**, não sobre o conteúdo.
 *
 * ## Isolamento por conta (§7.3)
 *
 * Não existe mapa global. A leitura é sempre um `findUnique` sobre a chave composta
 * `(userId, kind, shapeKey)` — nunca uma pesquisa por `shapeKey` sozinha. A diferença não é
 * cosmética: uma pesquisa por `shapeKey` encontraria mapas de **outras contas** e o
 * utilizador veria sugestões de mapeamento derivadas de ficheiros que não são dele. É a
 * mesma regra do livro de idempotência, e é verificada por teste.
 *
 * ## Porque é que guardar é uma operação de atualização, não de criação
 *
 * O `@@unique([userId, kind, shapeKey])` significa que o mesmo utilizador a importar o
 * mesmo formato duas vezes tem **um** mapa, não dois. Sem isto, a tabela cresceria com
 * duplicados a cada importação e a leitura teria de escolher entre eles — uma escolha sem
 * critério, que é o mesmo que uma escolha aleatória.
 *
 * A atualização é **substituição total das decisões**: um mapa guardado é o resultado da
 * última confirmação do utilizador, não uma acumulação. Acumular decisões de importações
 * sucessivas faria com que uma correção antiga sobrevivesse a uma correção nova — o
 * utilizador corrigiria o mesmo erro em cada importação e o mapa continuaria a trazê-lo.
 */

import type { PrismaClient } from '../../core/db.js';
import { shapeKey } from '../../domain/import/csv/shape.js';
import type { RecordKind } from '../../domain/import/validate.js';

/* -------------------------------------------------------------------------- */
/* Formas guardadas                                                            */
/* -------------------------------------------------------------------------- */

/** Uma decisão de coluna, tal como é guardada. Espelha `ColumnDecision`. */
export interface StoredDecision {
  readonly index: number;
  /** `null` = coluna declaradamente ignorada (§10.4). */
  readonly field: string | null;
}

/**
 * Um mapa de colunas guardado.
 *
 * O `index` de cada decisão é o índice da coluna **no ficheiro que a confirmou**. Quando
 * o mapa é reaplicado a um ficheiro com as colunas noutra ordem, os índices são
 * traduzidos por nome — ver `applySavedMap`.
 */
export interface SavedColumnMap {
  readonly id: string;
  readonly shapeKey: string;
  readonly headers: readonly string[];
  readonly kind: RecordKind;
  readonly decisions: readonly StoredDecision[];
  readonly delimiter: string;
  readonly encoding: string;
  readonly dateOrder: string | null;
  readonly decimalStyle: string | null;
  readonly timesUsed: number;
  readonly lastUsedAt: Date;
}

/** O que se guarda ao confirmar um mapa. */
export interface SaveColumnMapInput {
  readonly userId: string;
  readonly kind: RecordKind;
  readonly headers: readonly string[];
  readonly decisions: readonly StoredDecision[];
  readonly delimiter: string;
  readonly encoding: string;
  readonly dateOrder?: string | null;
  readonly decimalStyle?: string | null;
}

/** O que se guarda quando um mapa já existente é reaplicado com sucesso. */
export interface TouchColumnMapInput {
  readonly userId: string;
  readonly kind: RecordKind;
  readonly headers: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Leitura                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Procura o mapa guardado para esta forma de ficheiro, **nesta conta**.
 *
 * Devolve `null` quando não existe — e `null` é a resposta normal na primeira importação de
 * um formato novo, não um erro. Distinguir "não há mapa" de "falhou a procurar" é
 * responsabilidade de quem chama: aqui uma falha de base de dados propaga-se, porque
 * silenciá-la devolveria `null` e o utilizador voltaria a mapear sem saber porquê.
 *
 * A assinatura é calculada aqui a partir dos cabeçalhos: quem chama não tem de saber que a
 * forma é normalizada antes de comparada, e não pode esquecer-se de o fazer.
 */
export async function findSavedMap(
  prisma: PrismaClient,
  options: { userId: string; kind: RecordKind; headers: readonly string[] },
): Promise<SavedColumnMap | null> {
  const key = shapeKey(options.headers);

  // Assinatura vazia: não há forma que se possa reconhecer (ver `isUsableShapeKey`).
  // Não se consulta a base de dados porque a resposta é conhecida, e uma consulta por uma
  // chave que nunca é guardada seria trabalho sem efeito.
  if (key === '' || key.startsWith('0:')) return null;

  const row = await prisma.columnMap.findUnique({
    where: {
      userId_kind_shapeKey: {
        userId: options.userId,
        kind: options.kind,
        shapeKey: key,
      },
    },
  });

  return row === null ? null : toSavedMap(row);
}

/**
 * Lista os mapas guardados de um utilizador, do mais recente para o mais antigo.
 *
 * Existe para o modo avançado (§11.4 "mapa de colunas editável") e para o utilizador poder
 * ver o que está guardado em seu nome — que é o mínimo que se deve a quem tem dados
 * guardados por nós. O `kind` é opcional por simetria com a leitura principal, não por
 * necessidade de produto.
 */
export async function listSavedMaps(
  prisma: PrismaClient,
  options: { userId: string; kind?: RecordKind; limit?: number },
): Promise<readonly SavedColumnMap[]> {
  const rows = await prisma.columnMap.findMany({
    where: options.kind === undefined
      ? { userId: options.userId }
      : { userId: options.userId, kind: options.kind },
    orderBy: { lastUsedAt: 'desc' },
    take: options.limit ?? 50,
  });

  return rows.map(toSavedMap);
}

/* -------------------------------------------------------------------------- */
/* Escrita                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Guarda (ou substitui) o mapa de colunas confirmado por um utilizador.
 *
 * ## Porque é que a assinatura é recalculada aqui
 *
 * Os cabeçalhos entram, a assinatura sai. Aceitar a assinatura como parâmetro deixaria a
 * chave dependente de quem chama, e duas chamadas com a mesma forma e assinaturas
 * calculadas de maneiras diferentes criariam duas entradas para o mesmo formato. A função
 * é a única autoridade sobre a forma.
 *
 * ## Porque é que é `upsert` e não `create`
 *
 * Ver o docblock do módulo: o mesmo formato confirmado duas vezes é **um** mapa. O `upsert`
 * torna a operação idempotente, o que importa porque a confirmação pode chegar duas vezes
 * (o utilizador carrega duas vezes, ou a rede repete o pedido).
 *
 * ## O que **não** é tocado na atualização
 *
 * O `timesUsed` e o `lastUsedAt` não são reiniciados. Confirmar de novo um formato que já
 * foi usado não é um mapa novo: o contador é sobre **utilizações**, e o utilizador veria o
 * número descer ao corrigir uma coluna. O `createdAt` também se mantém — a idade do mapa é
 * informação sobre o formato, não sobre a última confirmação.
 *
 * A assinatura vazia é recusada com um erro e não com uma escrita silenciosa. Um mapa sem
 * forma aplicável a qualquer ficheiro é um mapa errado guardado em nome do utilizador, e a
 * §11.3 proíbe becos sem saída — um erro explícito é o que permite a quem chama responder
 * com "não consegui guardar o mapa" em vez de o guardar mal.
 */
export async function saveColumnMap(
  prisma: PrismaClient,
  input: SaveColumnMapInput,
): Promise<SavedColumnMap> {
  const key = shapeKey(input.headers);

  if (key === '' || key.startsWith('0:')) {
    throw new Error(
      'Não é possível guardar um mapa de colunas sem cabeçalhos reconhecíveis: a chave de forma ficaria vazia e o mapa aplicar-se-ia a qualquer ficheiro.',
    );
  }

  const headers = [...input.headers];
  const decisions = input.decisions.map((decision) => ({
    index: decision.index,
    field: decision.field,
  }));

  const row = await prisma.columnMap.upsert({
    where: {
      userId_kind_shapeKey: {
        userId: input.userId,
        kind: input.kind,
        shapeKey: key,
      },
    },
    create: {
      userId: input.userId,
      kind: input.kind,
      shapeKey: key,
      headers,
      decisions,
      delimiter: input.delimiter,
      encoding: input.encoding,
      dateOrder: input.dateOrder ?? null,
      decimalStyle: input.decimalStyle ?? null,
    },
    // Substituição total: as decisões do mapa são as da última confirmação. Ver o
    // docblock do módulo para a razão de não acumular.
    update: {
      headers,
      decisions,
      delimiter: input.delimiter,
      encoding: input.encoding,
      dateOrder: input.dateOrder ?? null,
      decimalStyle: input.decimalStyle ?? null,
    },
  });

  return toSavedMap(row);
}

/**
 * Marca um mapa como utilizado — uma escrita, e só isso.
 *
 * ## Porque é que isto é uma operação separada de `saveColumnMap`
 *
 * Porque são momentos diferentes com significados diferentes. Guardar é o utilizador a
 * **decidir**; tocar é o mapa a **funcionar** sem o utilizador ter decidido nada. Juntá-las
 * faria uma importação que reutilizou um mapa parecer uma confirmação, e o contador
 * deixaria de distinguir as duas coisas.
 *
 * ## Porque é que não bloqueia nem falha a importação
 *
 * O contador é telemetria de produto, não correção de dados. Uma falha a registá-lo não
 * pode impedir um utilizador de importar — e por isso esta função **devolve um booleano**
 * em vez de lançar: quem chama pode registá-lo no relatório e continuar. É a diferença
 * entre "o mapa foi usado" (facto, importa) e "consegui contar que foi usado" (detalhe).
 *
 * Uma contagem a falhar é registada e não propagada por quem chama; aqui devolve-se
 * `false` e a decisão é de quem chama.
 */
export async function touchColumnMap(
  prisma: PrismaClient,
  input: TouchColumnMapInput,
): Promise<boolean> {
  const key = shapeKey(input.headers);
  if (key === '' || key.startsWith('0:')) return false;

  try {
    await prisma.columnMap.update({
      where: {
        userId_kind_shapeKey: {
          userId: input.userId,
          kind: input.kind,
          shapeKey: key,
        },
      },
      data: {
        timesUsed: { increment: 1 },
        lastUsedAt: new Date(),
      },
    });
    return true;
  } catch {
    /*
     * Um mapa que entretanto foi apagado, ou uma base de dados ocupada. Nenhum dos casos
     * justifica abortar a importação do utilizador por causa de um contador — e devolver
     * `false` é o que permite ao relatório ser honesto ("o mapa foi usado; não consegui
     * atualizar o contador") em vez de mentir sobre ter guardado algo que não guardou.
     */
    return false;
  }
}

/**
 * Apaga o mapa guardado para uma forma de ficheiro.
 *
 * Existe porque a §7.3 exige que o utilizador possa ver e controlar o que está guardado em
 * seu nome. A operação é idempotente: apagar um mapa que não existe é sucesso, não um erro
 * — o estado final é o pedido, e um erro obrigaria quem chama a distinguir "não existia"
 * de "falhou", que é uma distinção sem consequência para o utilizador.
 */
export async function deleteSavedMap(
  prisma: PrismaClient,
  options: { userId: string; kind: RecordKind; headers: readonly string[] },
): Promise<boolean> {
  const key = shapeKey(options.headers);
  if (key === '' || key.startsWith('0:')) return false;

  const result = await prisma.columnMap.deleteMany({
    where: { userId: options.userId, kind: options.kind, shapeKey: key },
  });

  return result.count > 0;
}

/**
 * Quantos mapas um utilizador tem guardados. Para o relatório e para os testes.
 */
export async function countSavedMaps(
  prisma: PrismaClient,
  userId: string,
): Promise<number> {
  return prisma.columnMap.count({ where: { userId } });
}

/* -------------------------------------------------------------------------- */
/* Conversão                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Converte a linha da base de dados na forma do domínio.
 *
 * O `headers` e o `decisions` chegam como `Json` — um tipo que o Prisma declara como
 * `JsonValue` e que não tem a forma que o domínio espera. A conversão é feita aqui e não
 * no domínio porque é uma preocupação do armazenamento: o domínio não conhece `JsonValue`.
 *
 * A leitura é **defensiva**. O conteúdo foi escrito por este módulo, pelo que um formato
 * inesperado significa corrupção ou uma migração futura — e nesse caso a resposta certa é
 * devolver listas vazias em vez de deixar um `as` mentiroso lançar mais tarde, no meio de
 * uma importação, num sítio onde a causa já não é visível. Um mapa vazio faz o utilizador
 * reconfirmar; um `TypeError` a meio da importação faz o utilizador perder o trabalho.
 */
function toSavedMap(row: {
  id: string;
  shapeKey: string;
  headers: unknown;
  kind: string;
  decisions: unknown;
  delimiter: string;
  encoding: string;
  dateOrder: string | null;
  decimalStyle: string | null;
  timesUsed: number;
  lastUsedAt: Date;
}): SavedColumnMap {
  return {
    id: row.id,
    shapeKey: row.shapeKey,
    headers: Array.isArray(row.headers)
      ? row.headers.filter((value): value is string => typeof value === 'string')
      : [],
    kind: row.kind as RecordKind,
    decisions: readDecisions(row.decisions),
    delimiter: row.delimiter,
    encoding: row.encoding,
    dateOrder: row.dateOrder,
    decimalStyle: row.decimalStyle,
    timesUsed: row.timesUsed,
    lastUsedAt: row.lastUsedAt,
  };
}

/** Lê a lista de decisões de um valor `Json`, descartando o que não tiver forma válida. */
function readDecisions(value: unknown): readonly StoredDecision[] {
  if (!Array.isArray(value)) return [];

  const decisions: StoredDecision[] = [];

  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;

    const candidate = entry as { index?: unknown; field?: unknown };
    if (typeof candidate.index !== 'number' || !Number.isInteger(candidate.index)) continue;
    if (candidate.field !== null && typeof candidate.field !== 'string') continue;
    if (candidate.index < 0) continue;

    decisions.push({ index: candidate.index, field: candidate.field });
  }

  return decisions;
}
