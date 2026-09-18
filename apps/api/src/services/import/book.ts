/**
 * Livro de idempotência da importação (§9.5, A26).
 *
 * ## O que o livro é, e o que não é
 *
 * Regista cada registo criado por uma importação como
 * `(userId, bundleId, localId) → createdRecordId`. É o que faz **reimportar o mesmo bundle
 * não criar nada** e o que torna seguro retomar uma importação por lotes interrompida: a
 * retoma consulta o livro e não volta a criar o que já entrou.
 *
 * **Não é deduplicação.** São mecanismos diferentes e complementares (§8.2):
 *
 *  - o **livro** diz "já importei isto **deste ficheiro**" — é sobre a operação;
 *  - a **deduplicação** diz "já existe isto **na conta**" — é sobre o conteúdo.
 *
 * A diferença vê-se no caso que os distingue: reimportar o mesmo bundle noutra conta
 * **cria tudo**, porque a chave inclui o `userId`. É precisamente isso que torna possível
 * exportar de uma conta e importar noutra — se o livro fosse global, a segunda conta não
 * recebia nada. E apagar o livro não abre um buraco: a deduplicação por conteúdo continua a
 * proteger, como um teste verifica.
 *
 * ## As três invariantes deste ficheiro
 *
 *  1. **O `userId` nunca vem do bundle.** Vem sempre do contexto autenticado. Um bundle com
 *     um `userId` — ou um `bundleId` forjado — não dá acesso a nada: sem o `userId` certo,
 *     as consultas devolvem vazio.
 *  2. **O `bundleId` é identificador, não autorização.** Identifica a importação para que
 *     a idempotência funcione; não autoriza nem desbloqueia nada.
 *  3. **A retenção é de 12 meses** (decisão 12). Depois dessa data o livro já não reconhece
 *     uma reimportação — mas a deduplicação por conteúdo continua, e é isso que faz a
 *     expiração ser segura em vez de ser uma porta aberta.
 */

import type { PrismaClient } from '../../core/db.js';

/* -------------------------------------------------------------------------- */
/* Configuração                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Retenção do livro, em meses (decisão 12).
 *
 * Configurável e não uma constante espalhada: o valor é uma decisão de produto, e uma
 * decisão de produto que aparece em três sítios passa a ser três decisões diferentes.
 */
export const BOOK_RETENTION_MONTHS = 12;

/**
 * Calcula a expiração de uma entrada criada agora.
 *
 * `setUTCMonth` em vez de somar 365 dias: os meses têm comprimentos diferentes e somar
 * dias fixos acumularia um desvio. `getTime()` no fim porque a comparação com "agora" é
 * feita em instantes.
 */
export function bookExpiry(from: Date = new Date()): Date {
  const expiry = new Date(from.getTime());
  expiry.setUTCMonth(expiry.getUTCMonth() + BOOK_RETENTION_MONTHS);
  return expiry;
}

/* -------------------------------------------------------------------------- */
/* Escrita                                                                     */
/* -------------------------------------------------------------------------- */

/** Uma entrada a registar no livro. */
export interface BookEntryInput {
  readonly bundleId: string;
  readonly localId: string;
  readonly recordKind: string;
  readonly createdRecordId: string;
}

/**
 * Registos do livro, como o `read.ts` os devolve ao plano.
 *
 * É deliberadamente o mesmo tipo que o `ExistingAccountState.importedLocalIds` espera —
 * `ReadonlyMap<string, string>` do `localId` para o identificador do registo criado —
 * para que não haja uma conversão entre a leitura e o uso. Uma conversão seria um sítio a
 * mais onde a chave se podia perder.
 */
export type ImportedLocalIds = ReadonlyMap<string, string>;

/**
 * O que estas funções precisam de um cliente Prisma: poder consultar e escrever.
 *
 * Existe em vez de `PrismaClient` para que o **mesmo** código sirva tanto o cliente normal
 * como o `tx` de dentro de um `$transaction`. O tipo do `tx` é um `Omit<PrismaClient, …>`
 * que não inclui `$transaction`, `$connect`, `$disconnect` nem `$extends` — e é um tipo
 * estruturalmente mais estreito do que `PrismaClient`, pelo que não lhe é atribuível.
 *
 * A alternativa seria um `as unknown as PrismaClient` em cada chamada. Um cast desses não é
 * verificado por ninguém: no dia em que uma destas funções precisasse de `$transaction`
 * (que o `tx` não tem), o cast continuaria a compilar e a falha só apareceria em execução,
 * já dentro de uma transacção aberta. Alargar o tipo ao que é realmente usado deixa o
 * compilador recusar esse dia.
 */
export type PrismaLike = Pick<
  PrismaClient,
  'importBookEntry' | 'vehicle' | 'expense' | 'fuelSession' | 'chargingSession'
  | 'odometerReading' | 'maintenanceRecord' | 'insurancePolicy' | 'inspectionRecord'
  | 'taxRecord' | 'document' | 'reminder' | 'vehicleEvent'
>;

/**
 * Lê as entradas do livro para um bundle e um utilizador.
 *
 * ## Porque é que as duas condições são obrigatórias na consulta
 *
 * `userId` **e** `bundleId`. O `userId` vem do contexto autenticado e é o que isola as
 * contas; o `bundleId` distingue as importações e é o que faz `veh_1` de um bundle não ser
 * confundido com `veh_1` de outro — um identificador que existe em todos eles.
 *
 * O `expiresAt` não é filtrado na consulta. Uma entrada expirada continua a ser um registo
 * histórico válido e o `plan.ts` não deve distingui-la; o que a expiração significa é que
 * **a retenção terminou**, e a limpeza é um trabalho da manutenção (`db:cleanup`), não do
 * caminho de leitura. Filtrar aqui faria uma reimportação lenta e não determinística:
 * o mesmo bundle comportar-se-ia de forma diferente conforme a limpeza já tivesse corrido.
 */
export async function readImportedLocalIds(
  prisma: PrismaClient,
  userId: string,
  bundleId: string,
): Promise<ImportedLocalIds | undefined> {
  const entries = await prisma.importBookEntry.findMany({
    where: { userId, bundleId },
    select: { localId: true, createdRecordId: true },
  });

  // `undefined` e não um mapa vazio: o `plan.ts` distingue "não há livro" de "há livro
  // sem esta entrada" e é essa distinção que evita uma consulta desnecessária ao mapa em
  // cada registo.
  if (entries.length === 0) return undefined;

  return new Map(entries.map((entry) => [entry.localId, entry.createdRecordId]));
}

/**
 * Regista no livro os registos criados por uma importação.
 *
 * ## Porque é que esta função recebe um cliente e não cria o seu
 *
 * O registo tem de acontecer **dentro** da mesma transacção que criou os registos. Se
 * fosse uma transacção separada, uma falha entre as duas deixaria registos criados sem
 * entrada no livro — e a reimportação seguinte, não os reconhecendo, tentaria criá-los
 * outra vez. O `prisma` recebido é o da transacção em curso.
 *
 * `createMany` e não um `create` por registo: numa importação de 10 000 registos, 10 000
 * idas à base de dados dentro de uma transacção é o tipo de coisa que faz uma transacção
 * demorar o suficiente para bloquear tudo o resto. O SQLite não suporta `skipDuplicates`
 * no `createMany`, e as duplicações são impossíveis aqui — a chave é única e cada
 * `localId` aparece uma vez no plano —, pelo que a ausência da opção não é uma limitação.
 */
export async function writeBookEntries(
  prisma: PrismaLike,
  userId: string,
  bundleId: string,
  entries: readonly BookEntryInput[],
): Promise<number> {
  if (entries.length === 0) return 0;

  const expiresAt = bookExpiry();

  const result = await prisma.importBookEntry.createMany({
    data: entries.map((entry) => ({
      userId,
      bundleId,
      localId: entry.localId,
      recordKind: entry.recordKind,
      createdRecordId: entry.createdRecordId,
      expiresAt,
    })),
  });

  return result.count;
}

/* -------------------------------------------------------------------------- */
/* Manutenção                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Apaga entradas expiradas.
 *
 * A retenção de 12 meses é um compromisso: o livro existe para tornar uma reimportação
 * segura, e mantê-lo para sempre faria crescer uma tabela que só serve para responder a
 * operações que já ninguém repete. Doze meses cobrem o ciclo real — exportar, mudar de
 * conta, reimportar — com folga.
 *
 * A operação é idempotente e não faz parte do caminho de leitura: é chamada pela limpeza
 * periódica (`db:cleanup`), nunca pelo `preview` nem pelo `apply`. Uma limpeza no caminho
 * de leitura tornaria o comportamento dependente do momento em que o utilizador clica.
 */
export async function pruneExpiredBookEntries(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<number> {
  const result = await prisma.importBookEntry.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return result.count;
}
