/**
 * Documentos (§17).
 *
 * Nota de arquitetura sobre os ficheiros. A versão original desta nota dizia que "a API
 * **não** serve bytes de documentos" e justificava-o com três razões — reimplementar um
 * servidor de ficheiros, custo de banda, e autorização por URL assinado. Duas dessas razões
 * continuam verdadeiras e valem a pena manter à vista, porque delimitam o que **não** se
 * construiu:
 *
 *  1. **Não há intervalos de bytes nem retoma de transferência.** `downloadDocument` serve
 *     a resposta inteira, de uma vez. É adequado aos ficheiros que este produto guarda
 *     (Documento Único, apólices, certificados — dezenas de KB a alguns MB) e é a razão pela
 *     qual não há um servidor de ficheiros: quando houver vídeo ou ficheiros de centenas de
 *     MB, é altura de emitir URLs assinados para o armazenamento de objetos e tirar isto do
 *     caminho da API, não de acrescentar intervalos aqui.
 *  2. **A autorização continua num único ponto, e não passou a estar num URL.** A diferença
 *     face ao plano original é que ela é verificada a cada pedido, em vez de ser congelada
 *     num URL temporário: `requireRecord` filtra por dono antes de o storage ser tocado, e o
 *     storage valida o prefixo `<userId>/` da chave. Não há links partilháveis, não há
 *     validade a gerir, e revogar o acesso é apagar o documento.
 *
 * O que **já** existe é o upload: `uploadDocumentContent` recebe os bytes, gera a chave no
 * servidor e escreve-os pelo armazenamento; `replaceDocumentContent` troca-os, pelo `PUT`.
 * Continua a haver uma segunda via de entrada — o importador de bundle
 * (`services/import/apply.ts`) — mas as três passam pela mesma abstração, e nenhuma delas
 * aceita uma localização vinda do cliente. O ciclo fecha-se em `deleteDocument`, que devolve
 * ao armazenamento os bytes que o registo já não referencia (`PROD-007`), e a substituição
 * (`PROD-008`) reutiliza essa mesma remoção em vez de a repetir.
 */

import type {
  DocumentCreateRequest,
  DocumentRecord,
  DocumentUpdateRequest,
  ListQuery,
  Page,
} from '@zemlo/shared';
import { todayIn, type CivilDate } from '@zemlo/shared';
import { prisma } from '../core/db.js';
import { badRequest, conflict, forbidden, notFound, translatePrismaError } from '../core/errors.js';
import { writeJson } from '../core/json.js';
import { logger } from '../core/logger.js';
import { mapDocument } from '../domain/payload.js';
import { recordEvent, removeEventsFor } from './events.js';
import { buildPage, civilToDateOrNull, cursorWhere, requireRecord } from './shared.js';
import { normalizeSource, requireVehicleAccess } from './vehicles.js';

async function userTimeZone(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } });
  return user?.timeZone ?? 'Europe/Lisbon';
}

export async function createDocument(
  userId: string,
  input: DocumentCreateRequest,
): Promise<DocumentRecord> {
  if (input.vehicleId) await requireVehicleAccess(userId, input.vehicleId);

  const timeZone = await userTimeZone(userId);
  const today = todayIn(timeZone);

  try {
    const document = await prisma.document.create({
      data: {
        userId,
        vehicleId: input.vehicleId ?? null,
        name: input.name,
        category: input.category,
        date: civilToDateOrNull(input.date),
        expiresAt: civilToDateOrNull(input.expiresAt),
        fileName: input.fileName ?? null,
        mimeType: input.mimeType ?? null,
        sizeBytes: input.sizeBytes ?? null,
        storageKey: input.storageKey ?? null,
        notes: input.notes ?? null,
        source: writeJson(normalizeSource(input.source, 'manual')),
      },
    });

    // Um documento sem veículo (ex.: carta de condução) não gera evento de veículo.
    if (document.vehicleId) {
      await recordEvent({
        vehicleId: document.vehicleId,
        userId,
        type: 'document.created',
        date: input.date ?? today,
        title: input.name,
        summary: input.fileName ?? null,
        amountCents: null,
        odometerKm: null,
        recordType: 'document',
        recordId: document.id,
        source: normalizeSource(input.source, 'manual'),
      });
    }

    // Documento com validade gera lembrete: é a razão pela qual o utilizador o guardou.
    if (input.expiresAt && document.vehicleId) {
      const reminder = await prisma.reminder.create({
        data: {
          vehicleId: document.vehicleId,
          userId,
          title: `Validade: ${input.name}`,
          trigger: 'time',
          dueDate: civilToDateOrNull(input.expiresAt),
          repeat: false,
          topic: 'document',
          origin: 'document',
          originRecordId: document.id,
          dedupeKey: `document:${document.id}`,
        },
      });
      await recordEvent({
        vehicleId: document.vehicleId,
        userId,
        type: 'document.expiring',
        date: today,
        title: 'Alerta de validade de documento',
        summary: `${input.name} · termina a ${input.expiresAt}`,
        amountCents: null,
        odometerKm: null,
        recordType: 'reminder',
        recordId: reminder.id,
        source: null,
      });
    }

    return getDocument(userId, document.id);
  } catch (error) {
    throw translatePrismaError(error, 'criar documento');
  }
}

export async function listDocuments(userId: string, query: ListQuery): Promise<Page<DocumentRecord>> {
  const where: Record<string, unknown> = { userId, ...cursorWhere(query.cursor) };
  if (query.vehicleId) where.vehicleId = query.vehicleId;

  const timeZone = await userTimeZone(userId);
  const today = todayIn(timeZone);

  const [rows, total] = await Promise.all([
    prisma.document.findMany({
      where,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    }),
    // O mesmo `where` da consulta: uma contagem que ignora os filtros mostra
    // "Combustível · 59" ao lado de uma lista com três itens.
    prisma.document.count({ where }),
  ]);

  return buildPage(
    rows.map((row) => mapDocument(row, today)),
    query.limit,
    total,
  );
}

export async function getDocument(userId: string, documentId: string): Promise<DocumentRecord> {
  const record = await requireRecord('document', userId, documentId);
  const timeZone = await userTimeZone(userId);
  return mapDocument(record as Parameters<typeof mapDocument>[0], todayIn(timeZone));
}

export async function updateDocument(
  userId: string,
  documentId: string,
  input: DocumentUpdateRequest,
): Promise<DocumentRecord> {
  await requireRecord('document', userId, documentId);
  if (input.vehicleId) await requireVehicleAccess(userId, input.vehicleId);

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.category !== undefined) data.category = input.category;
  if (input.date !== undefined) data.date = civilToDateOrNull(input.date);
  if (input.expiresAt !== undefined) data.expiresAt = civilToDateOrNull(input.expiresAt);
  if (input.vehicleId !== undefined) data.vehicleId = input.vehicleId;
  if (input.fileName !== undefined) data.fileName = input.fileName;
  if (input.mimeType !== undefined) data.mimeType = input.mimeType;
  if (input.sizeBytes !== undefined) data.sizeBytes = input.sizeBytes;
  if (input.storageKey !== undefined) data.storageKey = input.storageKey;
  if (input.notes !== undefined) data.notes = input.notes;

  await prisma.document.update({ where: { id: documentId }, data });

  // A validade do lembrete segue a do documento.
  if (input.expiresAt !== undefined) {
    await prisma.reminder.updateMany({
      where: { originRecordId: documentId, origin: 'document', completedAt: null },
      data: { dueDate: civilToDateOrNull(input.expiresAt) },
    });
  }

  return getDocument(userId, documentId);
}

/**
 * Elimina um documento, o que dele deriva e os bytes que lhe pertencem (§17).
 *
 * ## A ordem é a garantia, e é o contrário do que parece natural
 *
 * A tentação é apagar o ficheiro primeiro e o registo depois — "se o registo falhar, ao
 * menos o ficheiro já foi". Produz o pior dos dois estados: uma linha que anuncia um
 * ficheiro que já não existe, e um download a responder 404 para um documento que a lista
 * continua a mostrar. As duas invariantes desta tarefa **não são simétricas**:
 *
 *  - **o registo nunca pode apontar para um ficheiro inexistente** — por isso o registo sai
 *    primeiro. A partir do momento em que a linha desaparece, nada aponta para o ficheiro:
 *    uma falha posterior deixa bytes sem dono (o estado anterior a esta tarefa), nunca um
 *    registo quebrado;
 *  - **um ficheiro ainda referenciado nunca pode ser apagado** — por isso os bytes saem
 *    depois, e só depois de se confirmar que mais ninguém os referencia (ver
 *    `discardDocumentBytes`).
 *
 * ## Porque é que uma falha do armazenamento não faz falhar a eliminação
 *
 * O utilizador pediu para apagar o registo, e o registo foi apagado. Transformar uma falha
 * do armazenamento num erro HTTP obrigaria o cliente a repetir um pedido que já teve
 * efeito — e a repetição responderia 404, que é o pior resultado possível para quem só
 * queria apagar o que é seu. A remoção é, portanto, *best-effort* e registada.
 */
export async function deleteDocument(userId: string, documentId: string): Promise<void> {
  /*
   * 1. Propriedade **e** a chave, lidas antes de a linha desaparecer: depois do `delete`
   * já não há de onde a ler. A consulta continua a ser a mesma porta de entrada do download
   * e do upload, pelo que um documento de outra conta responde 404 sem que nenhum byte
   * seja tocado.
   */
  const record = await requireRecord('document', userId, documentId);
  const storageKey =
    typeof record.storageKey === 'string' && record.storageKey.length > 0 ? record.storageKey : null;

  // 2. O registo, e tudo o que dele deriva. A partir daqui, o ficheiro não tem dono.
  await prisma.document.delete({ where: { id: documentId } });
  await removeEventsFor('document', documentId);
  const reminders = await prisma.reminder.findMany({
    where: { originRecordId: documentId, origin: 'document' },
    select: { id: true },
  });
  if (reminders.length > 0) {
    await prisma.reminder.deleteMany({ where: { id: { in: reminders.map((reminder) => reminder.id) } } });
    for (const reminder of reminders) await removeEventsFor('reminder', reminder.id);
  }

  // 3. Os bytes. Um documento sem ficheiro salta este passo — e é o caso comum.
  if (storageKey !== null) await discardDocumentBytes(userId, documentId, storageKey);
}

/**
 * Apaga do armazenamento os bytes de um documento **já eliminado**.
 *
 * ## Porque é que isto é uma função e não três linhas dentro de `deleteDocument`
 *
 * São três linhas com três decisões dentro, e todas as três se perdem numa revisão rápida:
 * a verificação de referências, o `try` que não pode propagar, e a forma do log. Isoladas,
 * cada uma tem um teste que a fixa.
 *
 * ## A contagem de referências (e o que ela tem a ver com `PC-21`)
 *
 * `storageKey` **não é única** no modelo, e não é por descuido: `updateDocument` aceita uma
 * `storageKey` vinda do cliente (`PC-21`, ainda aberto), pelo que dois registos da mesma
 * conta podem apontar para o mesmo ficheiro. Sem esta verificação, apagar um deles apagaria
 * o ficheiro do outro — precisamente o "apagar prematuramente um ficheiro ainda
 * referenciado" que esta tarefa tem de impedir. O upload e o importador nunca produzem duas
 * chaves iguais (16 bytes aleatórios), mas a via de `updateDocument` produz.
 *
 * A corrida entre duas eliminações concorrentes empurra na direcção segura: no pior caso as
 * duas contagens lêem 1 e nenhuma remove, deixando um órfão — um ficheiro a mais, nunca um
 * registo sem ficheiro.
 *
 * ## A higiene do log
 *
 * A mensagem do erro **não** é registada. Os erros do sistema de ficheiros trazem o caminho
 * na própria mensagem — `EACCES: permission denied, unlink '…/documents-storage/<userId>/<chave>'`
 * — e o caminho contém a chave, que é exactamente o que não pode entrar num log. Só o
 * `documentId` e o código do erro (`EACCES`, `EPERM`, …) são escritos; ver
 * `storageErrorCode`.
 */
async function discardDocumentBytes(
  userId: string,
  documentId: string,
  storageKey: string,
): Promise<void> {
  const references = await prisma.document.count({ where: { storageKey } });
  if (references > 0) {
    logger.info('bytes do documento mantidos: ainda referenciados por outro registo', {
      documentId,
      references,
    });
    return;
  }

  const { documentStorage, StorageKeyError } = await import('./document-storage.js');

  try {
    await documentStorage().remove(userId, storageKey);
  } catch (error) {
    /*
     * Chegar aqui não desfaz a eliminação: o registo já não existe, e o utilizador pediu
     * exactamente isso. O que fica é o estado anterior a esta tarefa — bytes sem dono —, e
     * é isso que o log regista para que o resíduo seja observável.
     *
     * Uma `StorageKeyError` é um caso à parte e merece um rótulo próprio: significa que o
     * armazenamento **recusou** a chave (pertence a outra conta, ou aponta para fora da
     * raiz). Nesse caso o ficheiro não foi tocado, e o que existe é um defeito de dados —
     * não uma falha de infraestrutura.
     */
    logger.warn('não foi possível remover os bytes do documento', {
      documentId,
      reason:
        error instanceof StorageKeyError ? 'chave recusada pelo armazenamento' : storageErrorCode(error),
    });
  }
}

/**
 * O código de um erro do sistema de ficheiros — nunca a mensagem.
 *
 * A mensagem de um erro do `node:fs` inclui o caminho, e o caminho inclui a `storageKey`.
 * O código (`EACCES`, `EPERM`, `EBUSY`, …) identifica a causa sem revelar onde o ficheiro
 * vive. Um valor que não tenha a forma de um código do sistema é substituído por um rótulo
 * genérico: o log não é um sítio para texto que veio de uma excepção.
 */
function storageErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(code) ? code : 'falha do armazenamento';
}

/**
 * Documentos a expirar dentro de um horizonte de dias.
 * Alimenta os cartões de estado do dashboard (§8) e o calendário (§21).
 */
export async function documentsExpiringSoon(
  userId: string,
  today: CivilDate,
  withinDays: number,
): Promise<DocumentRecord[]> {
  const [year, month, day] = today.split('-').map(Number) as [number, number, number];
  const limit = new Date(Date.UTC(year, month - 1, day + withinDays)).toISOString().slice(0, 10);

  const rows = await prisma.document.findMany({
    where: {
      userId,
      expiresAt: {
        not: null,
        lte: new Date(`${limit}T00:00:00.000Z`),
      },
    },
    orderBy: { expiresAt: 'asc' },
    take: 50,
  });

  return rows.map((row) => mapDocument(row, today));
}

/* -------------------------------------------------------------------------- */
/* Conteúdo (§17)                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Um documento e os seus bytes, prontos a servir.
 *
 * `downloadedName` já vem **construído e sanitizado** — quem serve não tem de decidir o
 * nome. Deixar essa decisão para a rota faria com que a única linha que escreve um
 * cabeçalho HTTP a partir de dados do utilizador ficasse fora do sítio onde os dados são
 * validados, que é onde ela é mais fácil de rever.
 */
export interface DocumentContent {
  readonly bytes: Buffer;
  readonly contentType: string;
  readonly fileName: string;
  /** `sha256` dos bytes servidos. Não vai para o cabeçalho; serve o registo e os testes. */
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly vehicleId: string | null;
}

/**
 * Lê os bytes de um documento, para os servir a quem é dono deles.
 *
 * ## A ordem das verificações é a garantia
 *
 * Dono primeiro, bytes depois — e não o contrário:
 *
 *  1. `requireRecord('document', userId, documentId)` resolve o documento **filtrado pelo
 *     `userId` autenticado**. Um id de outra conta não é encontrado, e o pedido termina em
 *     404 antes de o armazenamento ser tocado. Um 403 aqui seria pior: confirmaria que o
 *     documento existe.
 *  2. Só então a `storageKey` — que veio da base de dados, não do pedido — é entregue ao
 *     storage, que verifica outra vez que o prefixo é o do utilizador.
 *
 * ## Porque é que esta função não decide autorização
 *
 * Não recebe o documento do pedido, não aceita uma `storageKey` de fora e não tem um
 * parâmetro para saltar a verificação. A única forma de a chamar é com um `userId` e um
 * `documentId`; a propriedade é uma consequência da consulta, e não uma condição que
 * alguém tenha de se lembrar de testar. Uma variante "confia no id porque já foi
 * verificado" seria a porta pela qual o isolamento se perde num refactor.
 *
 * ## Os três desfechos, e porque é que dois deles são erros diferentes
 *
 *  - **Sem `storageKey`, ou bytes ausentes no armazenamento** → `notFound`, com a mesma
 *    mensagem dos outros documentos. A partir de fora, "o documento não tem ficheiro" e
 *    "o documento não é teu" são indistinguíveis — e é isso que se pretende.
 *  - **`storageKey` fora do espaço do utilizador** → `forbidden`. O storage lança
 *    `StorageKeyError` sem incluir a chave na mensagem, e essa distinção sobrevive: um
 *    registo com uma chave de outra conta é um defeito de dados que vale a pena ver como
 *    diferente de "não há ficheiro". Não chega ao utilizador como 403 — a rota converte-o
 *    no mesmo 404, para não distinguir os casos na resposta.
 *  - **Chave sintaticamente perigosa** (`..`, caminho absoluto) → também `StorageKeyError`.
 *    A mensagem do storage é específica no log e genérica na resposta.
 *
 * ## O nome do ficheiro
 *
 * `sanitizeDownloadName` produz um nome que não pode sair do cabeçalho `Content-Disposition`
 * nem enganar quem o vê. A ordem de preferência vai do mais para o menos significativo:
 * `fileName` (o nome real, que o utilizador reconhece) → `name` + extensão inferida do
 * `mimeType` → um nome genérico. O resultado nunca está vazio e nunca contém caminhos.
 */
export async function downloadDocument(
  userId: string,
  documentId: string,
): Promise<DocumentContent> {
  // 1. Propriedade, pela consulta. Um documento de outra conta nem chega a ser lido.
  const record = await requireRecord('document', userId, documentId);

  const storageKey = record.storageKey;
  if (typeof storageKey !== 'string' || storageKey.length === 0) {
    throw notFound('Este documento não tem o ficheiro associado.');
  }

  // 2. Os bytes, pelo caminho único de acesso. `documentStorage()` e não uma instância
  // nova: a abstração é a mesma que o exportador usa, e é isso que garante que os dois
  // lêem o mesmo sítio.
  const { documentStorage, StorageKeyError } = await import('./document-storage.js');

  let stored;
  try {
    stored = await documentStorage().read(userId, storageKey);
  } catch (error) {
    if (error instanceof StorageKeyError) {
      /*
       * Uma chave que não pertence a esta conta, ou que aponta para fora do armazenamento.
       * A mensagem do storage descreve o caso para o log; o `details` não é propagado
       * porque a chave em si não pode entrar numa resposta nem num registo de erro.
       */
      throw forbidden('Este documento não está disponível para transferência.');
    }
    throw error;
  }

  if (stored === null) {
    throw notFound('Este documento não tem o ficheiro associado.');
  }

  const mimeType = typeof record.mimeType === 'string' ? record.mimeType : null;
  const fileName = typeof record.fileName === 'string' ? record.fileName : null;
  const name = typeof record.name === 'string' ? record.name : 'documento';

  return {
    bytes: stored.bytes,
    contentType: safeContentType(mimeType),
    fileName: sanitizeDownloadName(fileName, name, mimeType),
    sha256: stored.sha256,
    sizeBytes: stored.sizeBytes,
    vehicleId: typeof record.vehicleId === 'string' ? record.vehicleId : null,
  };
}

/**
 * Guarda os bytes de um documento — a via de entrada (§17).
 *
 * É o espelho de `downloadDocument`, e a simetria é deliberada: um recebe bytes e escreve a
 * chave, o outro lê a chave e devolve bytes. Ambos partem do **mesmo** primeiro passo —
 * `requireRecord('document', userId, documentId)` — e é por isso que a autorização não pode
 * divergir entre eles.
 *
 * ## A chave é gerada aqui, e não recebida
 *
 * Esta função **não aceita** uma `storageKey`, um caminho, um nome de ficheiro nem um
 * directório. A chave nasce de `documentStorage().save(userId, bytes)`, que a constrói a
 * partir do `userId` autenticado e de 16 bytes aleatórios. Não há, portanto, nada a validar
 * quanto à localização: não existe um caminho de código em que o cliente a possa sugerir.
 * Uma variante que aceitasse a chave "para o cliente poder escolher o sítio" seria a porta
 * pela qual o isolamento se perde — e a razão pela qual o modelo guarda uma referência
 * **opaca**.
 *
 * ## Porque é que um documento com ficheiro é recusado, e não substituído
 *
 * Um documento tem um ficheiro, e o `POST` cria-o. Para trocar o que já existe há o `PUT`
 * (`replaceDocumentContent`), e a separação entre os dois é a decisão de `PROD-008`. Deixar a
 * substituição no mesmo verbo torná-la-ia um efeito lateral de um pedido que o cliente pode
 * repetir: um envio repetido por uma rede instável passaria a destruir o ficheiro anterior
 * sem que ninguém o tivesse pedido. Um `409` é honesto — o pedido está bem formado, o estado
 * é que não o aceita — e a resposta diz qual é o verbo certo.
 */
export async function uploadDocumentContent(
  userId: string,
  documentId: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<DocumentRecord> {
  // 1. Propriedade, pela consulta — a mesma porta de entrada do download. Um documento de
  // outra conta responde 404 antes de qualquer byte ser escrito.
  const record = await requireRecord('document', userId, documentId);

  // 2. Um documento tem um ficheiro. Ver a nota acima: trocar o que existe é o `PUT`.
  if (typeof record.storageKey === 'string' && record.storageKey.length > 0) {
    throw conflict(
      'Este documento já tem um ficheiro associado. Para o substituir, envia o novo com PUT para este mesmo endereço.',
    );
  }

  await storeContentAndPointRecord(userId, documentId, bytes, mimeType);

  return getDocument(userId, documentId);
}

/**
 * Substitui os bytes de um documento — a segunda via de escrita (§17, `PROD-008`).
 *
 * ## Porque é que isto é um verbo próprio
 *
 * Ver a nota em `uploadDocumentContent`: a recusa do `POST` e a existência do `PUT` são a
 * mesma decisão vista dos dois lados. O `PUT` é o verbo que a especificação HTTP reserva para
 * "define o conteúdo deste endereço", e é por isso que a semântica aqui é a do verbo e não a
 * do caso: **um documento sem ficheiro passa a tê-lo, e um que já tem passa a ter o novo**.
 * Não há um `404` para "não havia nada para substituir" — o pedido define o conteúdo, exista
 * ele ou não, e o resultado é o mesmo dos dois lados.
 *
 * ## A ordem: guardar, apontar, e só então limpar
 *
 *  1. os bytes **novos** são guardados primeiro. Se isto falhar, nada mudou: o registo
 *     continua a apontar para o ficheiro antigo, que existe;
 *  2. o registo passa a apontar para a chave **nova**. Se isto falhar, a chave nova é
 *     removida (compensação, dentro de `storeContentAndPointRecord`) e o documento continua
 *     a apontar para a antiga — o estado de partida, outra vez;
 *  3. só agora, e já sem nada a apontar para ela, a chave **antiga** é removida — pela
 *     **mesma** função que a eliminação usa (`discardDocumentBytes`), com a mesma contagem de
 *     referências e a mesma higiene de log.
 *
 * Inverter 1 e 3 é o erro que se comete por reflexo — "liberta espaço antes de ocupar mais" —
 * e produz o pior estado possível: um registo a apontar para um ficheiro que já não existe,
 * que a lista mostra e o download recusa, e que o utilizador não consegue compor pela API. É
 * por isso que a ordem é afirmada por um teste com a base de dados a falhar, e não apenas
 * descrita aqui.
 *
 * ## O que fica intocado
 *
 * `name`, `category`, `date`, `expiresAt`, `vehicleId`, `notes` e `fileName`. Trocar a
 * digitalização de um documento não é reescrever a ficha, e o nome do ficheiro não viaja num
 * corpo cru — a mesma razão do `POST`.
 */
export async function replaceDocumentContent(
  userId: string,
  documentId: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<DocumentRecord> {
  /*
   * 1. Propriedade **e** a chave antiga, lidas antes de tudo. A mesma porta de entrada do
   * download e do upload: um documento de outra conta responde 404 sem nada ser escrito.
   */
  const record = await requireRecord('document', userId, documentId);
  const previousKey =
    typeof record.storageKey === 'string' && record.storageKey.length > 0 ? record.storageKey : null;

  // 2. Os bytes novos, e o registo a apontar para eles.
  await storeContentAndPointRecord(userId, documentId, bytes, mimeType);

  /*
   * 3. A chave antiga, agora que nada neste registo aponta para ela. Um documento que não
   * tinha ficheiro chega aqui sem nada a limpar.
   *
   * A remoção é a **mesma** função da eliminação (`PROD-007`), e não uma segunda
   * implementação: a contagem de referências (o `PC-21` permite que dois registos partilhem
   * uma chave) e a higiene do log têm de ser as mesmas nos dois caminhos, senão divergem com
   * o primeiro refactor que toque em apenas um deles.
   */
  if (previousKey !== null) await discardDocumentBytes(userId, documentId, previousKey);

  return getDocument(userId, documentId);
}

/**
 * Guarda os bytes e aponta o registo para eles — o passo que o `POST` e o `PUT` partilham.
 *
 * ## Porque é que isto é uma função
 *
 * Não é só para não repetir vinte linhas. É porque a **ordem** dentro destas vinte linhas é a
 * garantia: guardar primeiro, escrever a chave depois. Se o `update` falhar, os bytes já
 * estão no disco e nenhum registo lhes aponta — ficariam órfãos por um erro que não é do
 * utilizador. A remoção compensatória é *best-effort* (`catch` que ignora): o erro que
 * interessa reportar é o da base de dados, não uma falha de limpeza que o esconderia.
 *
 * Isto **não** é a remoção de `PROD-007` nem a de `PROD-008`. Aquelas devolvem ao
 * armazenamento bytes que o utilizador decidiu deixar de usar; esta desfaz o que o próprio
 * servidor acabou de escrever, dentro do mesmo pedido. Duas funções com nomes diferentes
 * porque são duas coisas diferentes.
 *
 * ## Os três campos, e só três
 *
 * `storageKey`, `sizeBytes` e `mimeType` são os campos do ficheiro. `name`, `category`,
 * `date`, `expiresAt`, `vehicleId` e `notes` são do utilizador e ficam como estavam: enviar
 * bytes não é reescrever a ficha. O `fileName` **não** é tocado — o corpo cru não transporta
 * um nome, e o download já sabe derivar um nome utilizável a partir do nome do documento e
 * do tipo (ver `sanitizeDownloadName`).
 */
async function storeContentAndPointRecord(
  userId: string,
  documentId: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<void> {
  // Um ficheiro de zero bytes não é um ficheiro: é um envio que falhou a meio. Recusá-lo
  // evita um registo que anuncia um ficheiro que não abre — e vale para os dois verbos.
  if (bytes.byteLength === 0) {
    throw badRequest('O ficheiro está vazio. Escolhe um ficheiro com conteúdo.');
  }

  const { documentStorage } = await import('./document-storage.js');

  // A chave, gerada pelo servidor. O `userId` vem do pedido autenticado e é o prefixo.
  const storageKey = await documentStorage().save(userId, bytes);

  try {
    await prisma.document.update({
      where: { id: documentId },
      data: {
        storageKey,
        sizeBytes: bytes.byteLength,
        mimeType,
      },
    });
  } catch (error) {
    await documentStorage().remove(userId, storageKey).catch(() => undefined);
    throw translatePrismaError(error, 'guardar o ficheiro do documento');
  }
}

/**
 * O tipo de conteúdo a anunciar, restringido ao que é seguro servir inline.
 *
 * Um `mimeType` gravado na base de dados é **entrada não confiável**: vem do cliente que
 * criou o documento, e pode dizer `text/html` ou `image/svg+xml`. Servido com esse
 * cabeçalho, o ficheiro executa-se na origem da API — e a partir daí lê os tokens do
 * utilizador, que esta aplicação guarda em armazenamento acessível por script (ver a nota
 * do modelo de ameaça em `apps/web/src/api/client.ts`). Um documento carregado por um
 * utilizador tornar-se-ia XSS contra esse mesmo utilizador.
 *
 * A defesa não é validar o valor — é não confiar nele para decidir execução. Tipos ativos
 * são rebaixados a `application/octet-stream`, que o browser descarrega em vez de
 * renderizar. A lista é de **permissão**, e não de proibição: um tipo novo que ninguém
 * previu cai no lado seguro. `Content-Disposition: attachment` (na rota) é a segunda
 * linha: mesmo que um tipo ativo escapasse, o browser não o renderiza na origem da API.
 */
function safeContentType(mimeType: string | null): string {
  if (mimeType === null || mimeType.length === 0) return 'application/octet-stream';

  // Comparação sem parâmetros (`; charset=…`) e sem maiúsculas. Um `text/plain;charset=utf-8`
  // é o mesmo tipo que `text/plain`.
  const base = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';

  const servableInline = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/heic',
    'image/heif',
    'text/plain',
  ]);

  return servableInline.has(base) ? base : 'application/octet-stream';
}

/**
 * Um nome de ficheiro seguro para o cabeçalho `Content-Disposition`.
 *
 * ## O que está a ser defendido
 *
 * Um `fileName` vem do utilizador. Interpolado como `filename="${name}"` num cabeçalho,
 * produz três problemas distintos, e cada um é tratado aqui:
 *
 *  1. **Injeção de cabeçalho.** Um `\r\n` no nome insere cabeçalhos novos na resposta — o
 *     clássico *response splitting*. O nome é também usado pelo próprio Node para lançar
 *     `ERR_INVALID_CHAR`, o que transformaria um pedido legítimo num 500.
 *  2. **Fuga de caminho.** `../../etc/passwd` num cabeçalho revela a estrutura do servidor a
 *     quem o lê, e alguns clientes guardam o ficheiro fora da pasta de transferências.
 *  3. **Conteúdo enganador.** Um nome a começar por `.` esconde o ficheiro; controlos
 *     bidirecionais (`U+202E`) invertem a ordem visual, fazendo `gnp.exe` passar por
 *     `exe.png` — a técnica clássica para disfarçar uma extensão.
 *
 * ## O que **não** se faz
 *
 * Não se recorre ao parâmetro `filename*=UTF-8''…` do RFC 5987, que transmitiria nomes com
 * acentos ouvidos corretamente. Acrescentaria uma codificação a um caminho de resposta que
 * ainda não serve nomes não-ASCII em condições, e a versão actual degrada de forma
 * previsível: um acento vira `_`. Um nome ligeiramente feio é preferível a um cabeçalho
 * malformado em clientes que não o interpretam.
 *
 * O resultado tem sempre entre 1 e 120 caracteres e é sempre `filename="…"`-seguro.
 */
export function sanitizeDownloadName(
  fileName: string | null,
  documentName: string,
  mimeType: string | null,
): string {
  /*
   * O nome de partida: o ficheiro declarado, se houver; senão o nome do documento — sem
   * extensão, um download chega como "documento" e o sistema operativo do utilizador não
   * sabe com que o abrir, pelo que a extensão do tipo é acrescentada mais abaixo.
   */
  const base = fileName !== null && fileName.length > 0 ? fileName : documentName;
  const fallbackExtension = extensionFor(mimeType);

  let name = base;

  // 1. Só o último segmento. Aplicado antes de tudo: `../../a.pdf` passa a `a.pdf`, e é
  //    esse valor que as regras seguintes avaliam.
  name = name.split(/[/\\]/).pop() ?? '';

  /*
   * 2. Caracteres de controlo e separadores de cabeçalho removidos — não substituídos por
   *    `_`, mas **retirados**. Substituir manteria o comprimento e o `\r\n` viraria `__`,
   *    deixando um nome que sugere ter havido algo ali; retirar produz o nome que a pessoa
   *    reconhece.
   */
  name = name.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');

  /*
   * 3. Controlos bidirecionais, isolados à esquerda e à direita, e o resto dos formatadores
   *    invisíveis. Estes são a arma do disfarce de extensão: não são "lixo a limpar", são
   *    uma tentativa de enganar quem lê o nome.
   */
  name = name.replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\u061c\ufeff]/g, '');

  // 4. Caracteres com significado na sintaxe do cabeçalho: aspas fechariam o valor antes do
  //    fim e um `;` começaria um parâmetro novo.
  name = name.replace(/[";]/g, '');

  // 5. O que sobra é reduzido ao conjunto seguro. As letras acentuadas caem em `_` — ver a
  //    nota sobre o RFC 5987 acima.
  name = name.replace(/[^\w.\- ]/g, '_');

  // 6. Pontos e espaços das pontas: um nome a começar por `.` fica oculto em sistemas
  //    Unix, e `..` não é um nome de ficheiro.
  name = name.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');

  if (name.length === 0) {
    name = fallbackExtension === '' ? 'documento' : `documento${fallbackExtension}`;
  }

  // 7. Sem extensão, mas com tipo conhecido, acrescenta-se — para o ficheiro abrir na
  //    aplicação certa. Só quando o nome não tem já uma.
  if (fallbackExtension !== '' && !/\.[A-Za-z0-9]{1,8}$/.test(name)) {
    name = `${name}${fallbackExtension}`;
  }

  /*
   * 8. Truncagem a 120 caracteres, feita **antes** da extensão para não a cortar ao meio.
   *    O limite protege contra nomes absurdos e mantém o cabeçalho dentro do que qualquer
   *    cliente aceita.
   */
  if (name.length > 120) {
    const extension = /\.[A-Za-z0-9]{1,8}$/.exec(name)?.[0] ?? '';
    name = name.slice(0, 120 - extension.length) + extension;
  }

  return name;
}

/** Extensão sugerida por um tipo conhecido. Vazio quando não há sugestão segura. */
function extensionFor(mimeType: string | null): string {
  if (mimeType === null) return '';
  const base = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  const map: Record<string, string> = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/heic': '.heic',
    'image/heif': '.heif',
    'text/plain': '.txt',
  };
  return map[base] ?? '';
}
