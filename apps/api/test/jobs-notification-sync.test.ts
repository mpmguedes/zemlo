/**
 * Agendador de notificações (`PROD-004`, fecha `PC-9`).
 *
 * ## O que é que estes testes provam
 *
 * Até esta tarefa, `syncNotifications` tinha **um único chamador**: o handler do dashboard
 * (`routes/insights.ts`). Um lembrete legal — inspeção, seguro, IUC — só avisava quem
 * abrisse a aplicação, e o ecrã que mostrava o aviso era o mesmo que o gerava. Uma
 * asserção sobre "existe um agendador" não prova nada disso: o que prova é **uma
 * notificação a aparecer na base de dados sem nenhum pedido HTTP ter sido feito**.
 *
 * As propriedades verificadas:
 *
 *  - **o trabalho corre sem pedido** — nenhuma rota é chamada antes da passagem, e a
 *    notificação aparece na mesma (e é servida pela API, para não ser uma linha numa
 *    tabela paralela);
 *  - **idempotência** — correr duas vezes não duplica; e um reinício não perde trabalho
 *    por fazer (o estado está na base de dados, não na memória do processo);
 *  - **uma só implementação** — o dashboard e o agendador produzem as **mesmas**
 *    `dedupeKey` para o mesmo estado, porque partilham a função. Duas cópias da regra
 *    passariam num teste que só contasse notificações; é a comparação das chaves que as
 *    distingue;
 *  - **isolamento** — a passagem de um utilizador não cria nada para outro;
 *  - **as preferências mandam** — um tópico desligado pelo utilizador não gera
 *    notificação, e a preferência é escrita pela **API** (`PATCH /me/preferences`), não
 *    à mão na tabela;
 *  - **best-effort por utilizador** — a falha de uma conta não impede as outras, e fica
 *    observável (relatório + log com o `userId`);
 *  - **a guarda de reentrância** — a mesma tarefa não corre duas vezes ao mesmo tempo, e
 *    o intervalo `0` não arma relógio nenhum.
 *
 * ## Dois achados medidos, e não corrigidos aqui
 *
 *  1. **Um erro de base de dados ao criar uma notificação é engolido como "duplicado".**
 *     O `catch` de `syncNotifications` (que existe para a corrida entre dois pedidos) não
 *     distingue uma violação de unicidade de uma avaria, e registra as duas em `debug` —
 *     que não aparece nem em desenvolvimento nem em produção. O efeito é o pior possível
 *     para um trabalho periódico: uma avaria aparece como "não havia nada a fazer".
 *     Corrigir isto é alargar o âmbito desta tarefa; fica fixado num teste com o nome do
 *     defeito, para que a correção obrigue a mudar o teste.
 *  2. **As janelas de lembretes não são janelas.** `listReminders` recebe `windowDays` e
 *     `windowKm` e não os usa — o único limite é `take: 500`. Não é um defeito desta
 *     tarefa, mas é a razão pela qual nenhum teste aqui pode afirmar "só lembretes dos
 *     próximos 180 dias".
 *
 * ## A base de dados
 *
 * Como em `documents-delete.test.ts`: a `DATABASE_URL` é definida **antes** de a aplicação
 * ser importada, porque o `core/db.ts` instancia o cliente no import. Uma conta nova por
 * teste, e o núcleo é invocado com `userIds` — a base de dados é partilhada pelos ficheiros
 * da suíte, e uma passagem sobre **todos** os utilizadores tornaria as contagens deste
 * ficheiro dependentes da ordem de execução.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { addDays, todayIn } from '@zemlo/shared';

import type { PrismaClient } from '../src/core/db.js';
import type { TestDb } from './helpers/db.js';
import type { NotificationSyncReport } from '../src/jobs/notification-sync.js';
import type { JobRunOutcome, ScheduledJob } from '../src/jobs/runner.js';

/* -------------------------------------------------------------------------- */
/* Infraestrutura                                                              */
/* -------------------------------------------------------------------------- */

const BASE = '/api/v1';

/** O fuso por omissão do modelo (`User.timeZone`), e o que o `todayIn` usa aqui. */
const TIME_ZONE = 'Europe/Lisbon';

let db: TestDb;
let app: Express;
let appPrisma: PrismaClient;

/** O núcleo e o runner, carregados depois de a `DATABASE_URL` estar definida. */
let runNotificationSync: (options?: {
  userIds?: string[];
  pageSize?: number;
}) => Promise<NotificationSyncReport>;
let createJobRunner: typeof import('../src/jobs/runner.js').createJobRunner;

beforeAll(async () => {
  const { createTestDb } = await import('./helpers/db.js');
  db = await createTestDb();

  process.env.DATABASE_URL = db.url;
  process.env.DATABASE_PROVIDER = 'sqlite';
  process.env.NODE_ENV = 'test';

  const [{ createApp }, { prisma }, jobs, runner] = await Promise.all([
    import('../src/app.js'),
    import('../src/core/db.js'),
    import('../src/jobs/notification-sync.js'),
    import('../src/jobs/runner.js'),
  ]);

  appPrisma = prisma;
  app = createApp();
  runNotificationSync = jobs.runNotificationSync;
  createJobRunner = runner.createJobRunner;

  /*
   * A sonda: confirma que a aplicação está ligada à base de dados temporária. Sem isto,
   * uma `DATABASE_URL` mal aplicada faria a limpeza no fim apagar dados que não são de
   * teste.
   */
  const probe = await appPrisma.user.create({
    data: { email: 'sonda-agendador@zemlo.test', name: 'Sonda' },
    select: { id: true },
  });
  expect(
    await db.prisma.user.findUnique({ where: { id: probe.id } }),
    'A aplicação não está ligada à base de dados temporária. O DATABASE_URL não foi aplicado antes de a app ser importada.',
  ).not.toBeNull();
  await appPrisma.user.deleteMany();
}, 120_000);

afterAll(async () => {
  await appPrisma.$disconnect();
  await db.destroy();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* Utilitários                                                                 */
/* -------------------------------------------------------------------------- */

let emailCounter = 0;

async function signup(): Promise<{ token: string; userId: string }> {
  emailCounter += 1;
  const email = `agendador-${emailCounter}-${Math.random().toString(36).slice(2, 8)}@zemlo.test`;

  const response = await request(app)
    .post(`${BASE}/auth/signup`)
    .send({ email, password: 'Password-de-teste-1', name: 'Dono', acceptedTerms: true });

  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return {
    token: response.body.tokens.accessToken as string,
    userId: response.body.user.id as string,
  };
}

async function createVehicle(userId: string): Promise<string> {
  const { createVehicle: helper } = await import('./helpers/db.js');
  const vehicle = await helper(db, userId);
  return vehicle.id;
}

/**
 * Um lembrete de tempo já vencido.
 *
 * `overdue` é o estado mais simples de garantir sem depender da data de execução: uma data
 * no passado está sempre vencida. Os estados `soon`/`due` dependem de `leadDays`, que é
 * uma preferência do utilizador, e um teste que dependesse dela passaria a medir outra
 * coisa no dia em que a preferência por omissão mudasse.
 */
async function createOverdueReminder(
  token: string,
  vehicleId: string,
  title = 'Inspeção',
): Promise<string> {
  const response = await request(app)
    .post(`${BASE}/reminders`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      vehicleId,
      title,
      trigger: 'time',
      dueDate: addDays(todayIn(TIME_ZONE), -3),
    });

  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.id as string;
}

async function notificationRows(userId: string): Promise<Array<{ dedupeKey: string | null; topic: string }>> {
  return appPrisma.notification.findMany({
    where: { userId },
    select: { dedupeKey: true, topic: true },
    orderBy: { dedupeKey: 'asc' },
  });
}

function listNotifications(token: string): Promise<request.Response> {
  return request(app).get(`${BASE}/notifications`).set('Authorization', `Bearer ${token}`);
}

/**
 * Corre `run` com as **duas** saídas do processo capturadas, sem as silenciar.
 *
 * Captura `stdout` e `stderr` de propósito, e a distinção não é decorativa: o logger
 * escreve `error` em `stderr` e tudo o resto em `stdout` (`core/logger.ts`). A primeira
 * versão deste ficheiro capturava só `stdout` e afirmava que "a tarefa agendada falhou"
 * aparecia na saída — a asserção falhava porque o registo estava no outro fluxo, não
 * porque o registo não existisse. Um auxiliar que só olha para metade da saída faz uma
 * asserção sobre observabilidade depender do **nível** do registo em vez de depender de
 * ele existir.
 *
 * `output` é a concatenação das duas, para as asserções sobre "é observável"; `stdout` e
 * `stderr` ficam separados para quem precise de afirmar **como** foi registado.
 */
async function captureLogs<T>(
  run: () => Promise<T>,
): Promise<{ result: T; stdout: string; stderr: string; output: string }> {
  const streams = [
    { name: 'stdout' as const, stream: process.stdout },
    { name: 'stderr' as const, stream: process.stderr },
  ];
  const chunks: Record<'stdout' | 'stderr', string[]> = { stdout: [], stderr: [] };

  const spies = streams.map(({ name, stream }) => {
    const original = stream.write.bind(stream);
    return vi.spyOn(stream, 'write').mockImplementation(((
      chunk: unknown,
      ...rest: unknown[]
    ) => {
      chunks[name].push(
        typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : '',
      );
      return (original as unknown as (...args: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof stream.write);
  });

  try {
    const result = await run();
    const stdout = chunks.stdout.join('');
    const stderr = chunks.stderr.join('');
    return { result, stdout, stderr, output: stdout + stderr };
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/* ========================================================================== */
/* 1. O trabalho corre sem pedido nenhum                                      */
/* ========================================================================== */

describe('o trabalho corre sem pedido', () => {
  it('materializa a notificação de um lembrete vencido sem nenhuma rota ser chamada', async () => {
    const { token, userId } = await signup();
    const vehicleId = await createVehicle(userId);
    await createOverdueReminder(token, vehicleId);

    /*
     * Nada foi pedido à API desde a criação: nenhum dashboard, nenhuma lista de
     * notificações. É esta asserção que separa "o agendador existe" de "o agendador
     * funciona" — sem ela, o `GET /notifications` do fim poderia estar a ler algo que um
     * pedido anterior tinha criado.
     */
    expect(await appPrisma.notification.count({ where: { userId } })).toBe(0);

    const report = await runNotificationSync({ userIds: [userId] });

    expect(report.usersConsidered).toBe(1);
    expect(report.usersSynced).toBe(1);
    expect(report.notificationsCreated).toBe(1);
    expect(report.failures).toStrictEqual([]);

    const rows = await notificationRows(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.topic).toBe('inspection');

    /*
     * E a notificação é a **real**: servida pela rota que o utilizador consulta. Uma
     * passagem que escrevesse numa tabela paralela, ou que só contasse, passaria nas
     * asserções acima.
     */
    const listed = await listNotifications(token);
    expect(listed.status).toBe(200);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0].title).toContain('Inspeção');
    expect(listed.body.unreadCount).toBe(1);
  });

  it('não cria nada quando não há nada a vencer', async () => {
    const { userId } = await signup();
    await createVehicle(userId);

    // Um veículo sem lembretes e sem documentos: a passagem corre, não encontra nada, e
    // não é um erro. Sem esta asserção, uma implementação que criasse notificações
    // genéricas ("bem-vindo") passaria no teste anterior.
    const report = await runNotificationSync({ userIds: [userId] });

    expect(report.usersConsidered).toBe(1);
    expect(report.notificationsCreated).toBe(0);
    expect(report.failures).toStrictEqual([]);
    expect(await appPrisma.notification.count({ where: { userId } })).toBe(0);
  });
});

/* ========================================================================== */
/* 2. Idempotência                                                            */
/* ========================================================================== */

describe('idempotência', () => {
  it('correr duas vezes não duplica a notificação', async () => {
    const { token, userId } = await signup();
    const vehicleId = await createVehicle(userId);
    await createOverdueReminder(token, vehicleId);

    const primeira = await runNotificationSync({ userIds: [userId] });
    expect(primeira.notificationsCreated).toBe(1);

    /*
     * A segunda passagem corre sobre o mesmo estado. Se a idempotência dependesse de
     * memória do processo, esta seria a execução que duplicava — e é por isso que a
     * asserção é sobre o **total de linhas**, e não apenas sobre o `created` da segunda
     * passagem: uma implementação que contasse mal mas escrevesse duas vezes passaria.
     */
    const segunda = await runNotificationSync({ userIds: [userId] });
    expect(segunda.notificationsCreated).toBe(0);
    expect(segunda.usersSynced).toBe(1);

    expect(await appPrisma.notification.count({ where: { userId } })).toBe(1);
  });

  it('um reinício não duplica o que já existe nem perde o que ficou por fazer', async () => {
    const { token, userId } = await signup();
    const vehicleId = await createVehicle(userId);
    await createOverdueReminder(token, vehicleId, 'Inspeção');

    expect((await runNotificationSync({ userIds: [userId] })).notificationsCreated).toBe(1);

    /*
     * "Reiniciar" é, aqui, criar um runner novo e correr outra passagem: o núcleo não
     * guarda estado nenhum entre execuções, e é isso que se está a medir. Se guardasse —
     * um `Set` de lembretes já vistos, um cursor em memória —, o trabalho ficaria perdido
     * com o processo.
     */
    const runner = createJobRunner({
      intervalMinutes: 0,
      jobs: [
        {
          name: 'notification-sync',
          run: () => runNotificationSync({ userIds: [userId] }),
        },
      ],
    });
    const depoisDoReinicio = await runner.runNow('notification-sync');

    expect(depoisDoReinicio[0]?.status).toBe('completed');
    expect((depoisDoReinicio[0]?.result as NotificationSyncReport).notificationsCreated).toBe(0);
    expect(await appPrisma.notification.count({ where: { userId } })).toBe(1);

    // E o trabalho que **apareceu** depois da primeira passagem é apanhado: um reinício
    // não perde o que ficou por fazer. Um segundo lembrete vencido, e uma segunda
    // passagem cria exatamente uma notificação nova.
    await createOverdueReminder(token, vehicleId, 'IUC');
    expect((await runNotificationSync({ userIds: [userId] })).notificationsCreated).toBe(1);
    expect(await appPrisma.notification.count({ where: { userId } })).toBe(2);
  });
});

/* ========================================================================== */
/* 3. Uma só implementação: o dashboard e o agendador concordam               */
/* ========================================================================== */

describe('dashboard e agendador', () => {
  it('produzem as mesmas notificações, com as mesmas chaves de deduplicação', async () => {
    const peloDashboard = await signup();
    const peloAgendador = await signup();

    // Estado idêntico: um veículo e um lembrete vencido em cada conta, com a **mesma**
    // data de vencimento — é isso que torna os dois lados comparáveis.
    const dueDate = addDays(todayIn(TIME_ZONE), -3);
    await createOverdueReminder(peloDashboard.token, await createVehicle(peloDashboard.userId));
    await createOverdueReminder(peloAgendador.token, await createVehicle(peloAgendador.userId));

    // Um lado pelo pedido do dashboard (o caminho antigo), o outro pela passagem.
    const dashboard = await request(app)
      .get(`${BASE}/dashboard`)
      .set('Authorization', `Bearer ${peloDashboard.token}`);
    expect(dashboard.status, JSON.stringify(dashboard.body)).toBe(200);

    expect((await runNotificationSync({ userIds: [peloAgendador.userId] })).notificationsCreated).toBe(1);

    const doDashboard = await notificationRows(peloDashboard.userId);
    const doAgendador = await notificationRows(peloAgendador.userId);

    expect(doDashboard).toHaveLength(1);
    expect(doAgendador).toHaveLength(1);

    /*
     * A chave é `<id do lembrete>:<estado>:<data efetiva>`, e o **id do lembrete é um
     * uuid da conta**: duas contas distintas têm identificadores distintos, pelo que
     * comparar as chaves cruas compara dois uuid e nunca poderia dar igual. A primeira
     * versão deste teste afirmava exatamente isso e era, por construção, insatisfazível —
     * o que estava errado era a asserção, não o código. O prefixo é retirado por isso, e
     * a linha abaixo verifica que os prefixos são mesmo diferentes: é o que justifica a
     * normalização em vez de a deixar como suposição.
     */
    const prefixo = (chave: string) => chave.slice(0, chave.indexOf(':'));
    const derivado = (chave: string) => chave.slice(chave.indexOf(':') + 1);
    const chaveDoAgendador = doAgendador[0]?.dedupeKey ?? '';
    const chaveDoDashboard = doDashboard[0]?.dedupeKey ?? '';

    expect(prefixo(chaveDoAgendador)).not.toBe(prefixo(chaveDoDashboard));

    /*
     * A asserção que interessa não é "os dois criaram uma notificação" — isso passaria com
     * duas implementações parecidas. É a **igualdade do que a chave codifica**: o estado
     * avaliado e a data efetiva. Duas regras que divergissem num detalhe (a data de
     * referência, a janela, o estado) produziriam aqui sufixos diferentes — e é isso que
     * se está a medir.
     */
    expect(derivado(chaveDoAgendador)).toBe(derivado(chaveDoDashboard));

    /*
     * E o sufixo é o do lembrete vencido, não "hoje": a data efetiva vem do próprio
     * lembrete (`projectedDate ?? dueDate ?? today`, e `projectedDate` é `null` para um
     * lembrete de tempo). É esta escolha que faz a chave mudar quando o estado muda, e é
     * a razão pela qual uma notificação não se repete no mesmo dia.
     */
    expect(derivado(chaveDoAgendador)).toBe(`overdue:${dueDate}`);

    // O tópico inferido é a outra metade da regra partilhada, e não está na chave.
    expect(doAgendador[0]?.topic).toBe('inspection');
    expect(doDashboard[0]?.topic).toBe(doAgendador[0]?.topic);
  });
});

/* ========================================================================== */
/* 4. Isolamento entre contas                                                 */
/* ========================================================================== */

describe('isolamento entre contas', () => {
  it('a passagem de uma conta não cria nada para outra', async () => {
    const comTrabalho = await signup();
    const semTrabalho = await signup();

    await createOverdueReminder(comTrabalho.token, await createVehicle(comTrabalho.userId));
    await createVehicle(semTrabalho.userId);

    const report = await runNotificationSync({
      userIds: [comTrabalho.userId, semTrabalho.userId],
    });

    expect(report.usersConsidered).toBe(2);
    expect(report.notificationsCreated).toBe(1);

    // A conta com trabalho fica com uma; a outra, com zero — e a zero **na sua própria
    // conta**, não apenas "sem notificações a mais": uma implementação que gravasse tudo
    // no primeiro utilizador passaria na primeira asserção e falharia nesta.
    expect(await appPrisma.notification.count({ where: { userId: comTrabalho.userId } })).toBe(1);
    expect(await appPrisma.notification.count({ where: { userId: semTrabalho.userId } })).toBe(0);

    // E cada notificação pertence a quem a devia receber.
    const daOutra = await listNotifications(semTrabalho.token);
    expect(daOutra.body.items).toHaveLength(0);
  });
});

/* ========================================================================== */
/* 5. As preferências do utilizador mandam                                    */
/* ========================================================================== */

describe('preferências do utilizador', () => {
  it('um tópico desligado não gera notificação, mesmo com o lembrete vencido', async () => {
    const { token, userId } = await signup();
    const vehicleId = await createVehicle(userId);
    await createOverdueReminder(token, vehicleId, 'Inspeção');

    /*
     * A preferência é escrita pela **API**, e não à mão na tabela: o que se está a medir é
     * que o agendador respeita o que o utilizador conseguiu desligar pela interface, e uma
     * linha inserida pelo teste poderia ter uma forma que a API nunca produz.
     */
    const preference = await request(app)
      .patch(`${BASE}/me/preferences`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notifications: [{ topic: 'inspection', channel: 'in_app', frequency: 'off' }] });
    expect(preference.status, JSON.stringify(preference.body)).toBe(200);

    const report = await runNotificationSync({ userIds: [userId] });

    expect(report.usersSynced).toBe(1);
    expect(report.notificationsCreated).toBe(0);
    expect(await appPrisma.notification.count({ where: { userId } })).toBe(0);
  });

  it('um tópico ligado continua a gerar notificação', async () => {
    const { token, userId } = await signup();
    const vehicleId = await createVehicle(userId);
    await createOverdueReminder(token, vehicleId, 'Inspeção');

    // O sentido positivo do teste anterior: desligar o **seguro** não pode desligar a
    // inspeção. Sem isto, uma implementação que desligasse tudo à primeira preferência
    // passaria no teste acima.
    const preference = await request(app)
      .patch(`${BASE}/me/preferences`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notifications: [{ topic: 'insurance', channel: 'in_app', frequency: 'off' }] });
    expect(preference.status, JSON.stringify(preference.body)).toBe(200);

    const report = await runNotificationSync({ userIds: [userId] });

    expect(report.notificationsCreated).toBe(1);
    expect((await notificationRows(userId))[0]?.topic).toBe('inspection');
  });
});

/* ========================================================================== */
/* 6. Best-effort por utilizador                                              */
/* ========================================================================== */

describe('falha de um utilizador', () => {
  it('não impede os outros e fica observável, com o userId e sem travar a passagem', async () => {
    const quebrado = await signup();
    const saudavel = await signup();

    await createOverdueReminder(quebrado.token, await createVehicle(quebrado.userId));
    await createOverdueReminder(saudavel.token, await createVehicle(saudavel.userId));

    /*
     * A falha é injectada na **descoberta** (`vehicle.findMany`, que o núcleo usa por
     * `syncNotificationsForUser`), e não na criação da notificação. A escolha é deliberada
     * e está medida: um erro na criação é engolido por `syncNotifications` como se fosse
     * um duplicado (ver o teste seguinte), pelo que não chegaria ao relatório.
     *
     * A troca é manual, e não um `vi.spyOn` — medido em `PROD-007`: o `spyOn` sobre o
     * delegado do Prisma não se repõe com `mockRestore()`. Uma troca directa repõe-se de
     * forma verificável, e a reposição é verificada no fim deste teste.
     */
    const delegate = appPrisma.vehicle as unknown as {
      findMany: (args: { where?: { userId?: string } }) => Promise<unknown>;
    };
    const realFindMany = delegate.findMany;
    delegate.findMany = (args) => {
      if (args?.where?.userId === quebrado.userId) {
        return Promise.reject(new Error('a base de dados recusou a consulta de veículos'));
      }
      return realFindMany(args);
    };

    let report: NotificationSyncReport;
    let output: string;
    try {
      ({ result: report, output } = await captureLogs(() =>
        runNotificationSync({ userIds: [quebrado.userId, saudavel.userId] }),
      ));
    } finally {
      delegate.findMany = realFindMany;
    }

    /*
     * A passagem **não** aborta: a conta com o problema conta-se como falha, a outra
     * recebe o aviso. Um trabalho periódico que parasse na primeira exceção transformaria
     * um problema de uma conta num problema de todas.
     */
    expect(report.usersConsidered).toBe(2);
    expect(report.usersSynced).toBe(1);
    expect(report.notificationsCreated).toBe(1);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.userId).toBe(quebrado.userId);
    expect(report.failures[0]?.reason).toContain('recusou a consulta de veículos');

    expect(await appPrisma.notification.count({ where: { userId: saudavel.userId } })).toBe(1);
    expect(await appPrisma.notification.count({ where: { userId: quebrado.userId } })).toBe(0);

    // A falha é observável, e nomeia o utilizador que a causou — sem isso, uma passagem
    // que ignorasse contas seria indistinguível de uma passagem sem trabalho.
    expect(output).toContain('não foi possível sincronizar as notificações de um utilizador');
    expect(output).toContain(quebrado.userId);

    /*
     * A reposição do duplo é **verificada**, não assumida: a mesma passagem volta a correr
     * contra a base de dados verdadeira e tem de criar a notificação que faltava.
     */
    expect((await runNotificationSync({ userIds: [quebrado.userId] })).notificationsCreated).toBe(1);
    expect(await appPrisma.notification.count({ where: { userId: quebrado.userId } })).toBe(1);
  });

  it('um erro ao criar é hoje engolido como "duplicado" — achado, não comportamento desejado', async () => {
    const { token, userId } = await signup();
    const vehicleId = await createVehicle(userId);
    await createOverdueReminder(token, vehicleId);

    /*
     * ## Este teste fixa um defeito, de propósito
     *
     * O `catch` de `syncNotifications` existe para a corrida entre dois pedidos
     * simultâneos (a chave única rejeita o segundo). O problema é que apanha **tudo**: uma
     * avaria da base de dados ao criar é registada como "Notificação duplicada ignorada",
     * em `debug` — um nível que não aparece nem em desenvolvimento nem em produção.
     *
     * O efeito num trabalho periódico é o pior possível: uma avaria fica indistinguível de
     * "não havia nada a fazer", e o relatório diz que a conta foi sincronizada com sucesso.
     *
     * Não se corrige aqui: estreitar o `catch` para `P2002` é uma alteração de
     * comportamento fora do âmbito de `PROD-004`, e o projeto exige que trabalho novo vire
     * tarefa antes de ser implementado. O teste fica com o nome do defeito para que a
     * correção **obrigue** a mudá-lo — se ele continuar verde depois de o `catch` ser
     * estreitado, a correção não foi feita.
     */
    const delegate = appPrisma.notification as unknown as {
      create: (args: unknown) => Promise<unknown>;
    };
    const realCreate = delegate.create;
    delegate.create = () => Promise.reject(new Error('a base de dados recusou a notificação'));

    let report: NotificationSyncReport;
    try {
      report = await runNotificationSync({ userIds: [userId] });
    } finally {
      delegate.create = realCreate;
    }

    // O estado medido hoje: a conta conta como sincronizada, e nada foi criado.
    expect(report.usersSynced).toBe(1);
    expect(report.failures).toStrictEqual([]);
    expect(report.notificationsCreated).toBe(0);
    expect(await appPrisma.notification.count({ where: { userId } })).toBe(0);

    // E a reposição é verificada: sem o duplo, a notificação é criada.
    expect((await runNotificationSync({ userIds: [userId] })).notificationsCreated).toBe(1);
  });
});

/* ========================================================================== */
/* 7. Paginação                                                               */
/* ========================================================================== */

describe('paginação', () => {
  it('percorre todos os utilizadores, mesmo com páginas de um', async () => {
    const contas = await Promise.all([signup(), signup(), signup()]);
    for (const conta of contas) {
      await createOverdueReminder(conta.token, await createVehicle(conta.userId));
    }

    /*
     * `pageSize: 1` obriga a três páginas. Sem a reposição do cursor, o ciclo ou parava no
     * primeiro utilizador, ou repetia o mesmo — e as duas coisas aparecem aqui: a contagem
     * de utilizadores considerados e o número de notificações criadas têm de ser **três**,
     * e cada conta tem de ficar com exatamente uma.
     */
    const report = await runNotificationSync({
      userIds: contas.map((conta) => conta.userId),
      pageSize: 1,
    });

    expect(report.usersConsidered).toBe(3);
    expect(report.usersSynced).toBe(3);
    expect(report.notificationsCreated).toBe(3);

    for (const conta of contas) {
      expect(await appPrisma.notification.count({ where: { userId: conta.userId } })).toBe(1);
    }
  });
});

/* ========================================================================== */
/* 8. O runner: guarda de reentrância e relógio                               */
/* ========================================================================== */

describe('runner', () => {
  it('não deixa a mesma tarefa correr duas vezes ao mesmo tempo', async () => {
    const portao = deferred();
    let chamadas = 0;

    const tarefa: ScheduledJob = {
      name: 'tarefa-de-teste',
      async run() {
        chamadas += 1;
        await portao.promise;
        return 'feito';
      },
    };

    // `intervalMinutes: 0` e sem `start()`: este teste é sobre a guarda, e um relógio
    // armado só acrescentaria ruído (e um temporizador a manter o processo vivo).
    const runner = createJobRunner({ intervalMinutes: 0, jobs: [tarefa], runOnStart: false });

    const primeira = runner.runNow();
    const segunda = runner.runNow();

    /*
     * A segunda chamada tem de resolver **antes** de o portão abrir: a guarda decide antes
     * do primeiro `await` de `runOne`, e é isso que impede duas execuções simultâneas.
     *
     * A corrida com tempo-limite existe por uma razão medida: com um `await segunda`
     * directo, a versão **sem** guarda fica presa no portão (a segunda execução espera por
     * um `resolve` que só acontece depois destas asserções) e o teste expira aos 5 s. Um
     * vermelho por expiração não diz qual asserção falhou e é indistinguível de uma máquina
     * lenta — a mesma ambiguidade que `PC-26` obriga a desfazer à mão. Assim, a versão sem
     * guarda falha em ~1 s, na asserção que nomeia o que se passou.
     */
    const ESPERA_MAXIMA_MS = 1_000;
    const corrida = await Promise.race([
      segunda.then((resultado) => ({ resolveu: true as const, resultado })),
      new Promise<{ resolveu: false }>((resolve) =>
        setTimeout(() => resolve({ resolveu: false }), ESPERA_MAXIMA_MS),
      ),
    ]);

    /*
     * O `throw` em vez de um `expect`: além de ser a mensagem de falha, é o que **estreita
     * o tipo** para o resto do teste. Medido: `expect(x).not.toBeNull()` não estreita nada
     * — o `tsc` restrito de `PC-15` apanhou `Property 'status' does not exist on type
     * 'never'` nas duas asserções seguintes.
     */
    if (!corrida.resolveu) {
      throw new Error(
        `a segunda execução não resolveu em ${ESPERA_MAXIMA_MS} ms: a guarda de reentrância não a ignorou`,
      );
    }

    /*
     * A segunda é ignorada, e a tarefa correu **uma** vez. Sem a guarda, um trabalho mais
     * lento do que o intervalo empilha execuções — cada uma a ler a mesma base de dados —
     * e a carga multiplica-se sozinha. É esta asserção que fixa a guarda; o `status` só,
     * sem a contagem de chamadas, passaria com uma implementação que corresse a tarefa e
     * devolvesse "ignorada" por engano.
     */
    expect(corrida.resultado[0]?.status).toBe('skipped');
    expect(corrida.resultado[0]?.reason).toBe('execução em curso');
    expect(chamadas).toBe(1);

    portao.resolve();
    const resultado = await primeira;
    expect(resultado[0]?.status).toBe('completed');
    expect(resultado[0]?.result).toBe('feito');

    // E depois de a primeira terminar, a tarefa volta a poder correr: a guarda é sobre a
    // execução em curso, não um bloqueio permanente.
    const terceira = await runner.runNow();
    expect(terceira[0]?.status).toBe('completed');
    expect(chamadas).toBe(2);
  });

  it('uma falha da tarefa é contida e não desarma o relógio', async () => {
    const outcomes: JobRunOutcome[] = [];
    const tarefa: ScheduledJob = {
      name: 'tarefa-que-falha',
      run: () => Promise.reject(new Error('avaria simulada')),
    };
    const runner = createJobRunner({ intervalMinutes: 0, jobs: [tarefa], runOnStart: false });

    const { result, stderr, output } = await captureLogs(() => runner.runNow());
    outcomes.push(...result);

    expect(outcomes[0]?.status).toBe('failed');
    expect(outcomes[0]?.reason).toContain('avaria simulada');

    /*
     * A falha é observável **e** registada como erro. As duas coisas são afirmadas de
     * propósito: `output` prova que a falha não desapareceu em silêncio; `stderr` prova
     * que foi registada em `error` e não em `info` — o logger encaminha `error` para
     * `stderr`. Uma falha periódica registada a `info` fica no meio do ruído de pedidos e
     * não é vista por quem opera; a distinção é o que faz o registo servir para algo.
     */
    expect(output).toContain('tarefa agendada falhou');
    expect(stderr).toContain('tarefa agendada falhou');

    // A exceção não saiu do runner — e por isso o `setInterval` que a chamaria continua
    // vivo, e a passagem seguinte é uma nova oportunidade.
    expect((await runner.runNow())[0]?.status).toBe('failed');
  });

  it('o intervalo 0 não arma relógio nenhum, e diz porquê', async () => {
    let chamadas = 0;
    const tarefa: ScheduledJob = {
      name: 'tarefa-desligada',
      async run() {
        chamadas += 1;
      },
    };

    const runner = createJobRunner({ intervalMinutes: 0, jobs: [tarefa] });

    let output: string;
    try {
      ({ output } = await captureLogs(async () => {
        runner.start();
        // Se um relógio tivesse sido armado com `setInterval(fn, 0)`, dispararia aqui — e
        // repetidamente. É este intervalo de espera que torna a asserção discriminante.
        await new Promise((resolve) => setTimeout(resolve, 30));
      }));
    } finally {
      /*
       * `stop()` no `finally`, como no teste seguinte, e não por simetria: com a guarda
       * avariada é **este** teste que arma um relógio de 1 ms, e um relógio deixado armado
       * mantém o processo vivo — a suíte ficaria pendurada em vez de mostrar a falha. Um
       * teste que, ao falhar, impede os outros de correr é pior do que um teste ausente.
       */
      runner.stop();
    }

    expect(runner.started).toBe(false);
    expect(chamadas).toBe(0);
    expect(output).toContain('agendador desligado por configuração');
  });

  it('arma o relógio, corre uma passagem no arranque e para quando lhe pedem', async () => {
    const arrancou = deferred();
    let chamadas = 0;

    const tarefa: ScheduledJob = {
      name: 'tarefa-de-arranque',
      async run() {
        chamadas += 1;
        arrancou.resolve();
        return { utilizadores: 0 };
      },
    };

    const runner = createJobRunner({ intervalMinutes: 60, jobs: [tarefa] });

    try {
      runner.start();
      expect(runner.started).toBe(true);

      /*
       * A passagem de arranque é o que garante que uma instância reiniciada não deixa
       * passar um intervalo inteiro por trabalho que já estava por fazer. Sem
       * `runOnStart`, este teste ficaria 60 minutos à espera.
       */
      await arrancou.promise;
      expect(chamadas).toBe(1);

      // Armar duas vezes não cria dois relógios: o segundo `start` é um no-op.
      runner.start();
      expect(runner.started).toBe(true);
    } finally {
      // Sempre, mesmo se uma asserção falhar: um temporizador de 60 minutos deixado
      // armado manteria o processo vivo e a suíte nunca terminaria.
      runner.stop();
    }

    expect(runner.started).toBe(false);
    expect(runner.intervalMinutes).toBe(60);
  });
});
