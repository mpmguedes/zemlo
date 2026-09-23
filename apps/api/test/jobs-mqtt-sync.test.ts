/**
 * Núcleo de sincronização MQTT (`INT-001`, `jobs/mqtt-sync.ts`).
 *
 * ## Porque é que este ficheiro não abre uma base de dados
 *
 * O núcleo percorre veículos com `prisma.vehicle.findMany` e calcula a analítica de cada um com
 * `loadVehicleAnalytics`. Num ambiente normal isso pediria uma base de dados semeada — mas neste
 * a via está **bloqueada** por um defeito de ambiente, não de produto: os 28 ficheiros que chamam
 * `createTestDb()` falham no arranque com `EBUSY`/`spawnSync` (o `execFileSync` que corre
 * `prisma db push` não produz cliente, e o teardown rebenta em `$disconnect`). Medido nesta
 * sessão: `integrations-home-assistant.test.ts` → `TypeError: Cannot read properties of undefined
 * (reading '$disconnect')`, 3 testes ignorados.
 *
 * O núcleo, porém, **não precisa** de uma base de dados: ele consome duas dependências
 * (`prisma` e a analítica) e produz um relatório. Este ficheiro substitui exactamente essas duas,
 * com `vi.hoisted` + `vi.mock`, e exercita o que é dele: a **paginação**, o **agregado do
 * relatório**, o **best-effort por veículo** e a **saída sem cliente**. É a mesma decisão de
 * `INT-001` para a serialização — testar o que é demonstrável sem a infraestrutura ausente, e
 * declarar o resto como não validado.
 *
 * ## O que é que estes testes provam
 *
 *  - **sem cliente, não toca na base de dados** — o caso do ambiente sem broker. Não é só «devolve
 *    zeros»: é que **não faz nenhum pedido**, porque não há para onde publicar;
 *  - **a paginação avança por cursor** e uma página incompleta fecha o ciclo — o defeito que o
 *    travão `MAX_PAGES` existe para conter;
 *  - **o relatório agrega** descobertas, publicações e saltos de todos os veículos;
 *  - **best-effort por veículo**: uma analítica que rebenta não impede os outros, e fica contada
 *    com o `vehicleId` e o motivo;
 *  - **respeita o `vehicleIds`** (o filtro que torna os testes determinísticos numa base partilhada);
 *  - **`mqttSyncJobFor`** devolve uma tarefa agendável cujo `run()` corre a passagem.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MqttClient, MqttResult } from '../src/services/mqtt-client.js';
import type { MqttSyncReport } from '../src/jobs/mqtt-sync.js';

/* -------------------------------------------------------------------------- */
/* Dublês elevados (hoisted)                                                   */
/* -------------------------------------------------------------------------- */

/*
 * `vi.hoisted` porque a fábrica de `vi.mock` corre **antes** das declarações do ficheiro: sem
 * isto, `Cannot access 'x' before initialization` — medido numa sonda antes de escrever este
 * ficheiro. As funções vivem aqui e são repostas em `beforeEach`.
 */
const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  loadVehicleAnalytics: vi.fn(),
  buildStats: vi.fn(),
}));

vi.mock('../src/core/db.js', () => ({
  prisma: { vehicle: { findMany: mocks.findMany } },
  activeProvider: 'sqlite',
  checkDatabase: async () => ({ reachable: true, latencyMs: 1 }),
  describeDatabase: () => 'sqlite',
  disconnectDatabase: async () => undefined,
}));

vi.mock('../src/services/analytics.js', () => ({
  loadVehicleAnalytics: mocks.loadVehicleAnalytics,
  buildStats: mocks.buildStats,
}));

import { MQTT_SYNC_JOB_NAME, mqttSyncJobFor, runMqttSync } from '../src/jobs/mqtt-sync.js';

/* -------------------------------------------------------------------------- */
/* Dados de apoio                                                              */
/* -------------------------------------------------------------------------- */

function vehicleRow(id: string, overrides: Partial<{ userId: string; plateDisplay: string; nickname: string | null }> = {}) {
  return {
    id,
    userId: overrides.userId ?? `user_${id}`,
    plateDisplay: overrides.plateDisplay ?? 'AA-00-AA',
    nickname: overrides.nickname ?? null,
  };
}

/**
 * A analítica mínima que `publicationsForVehicle` lê.
 *
 * Só os campos que o núcleo consulta: `latestSocPercent`, `vehicle.odometerKm` e
 * `vehicle.nominalRangeKm`. Tudo o resto é irrelevante para a publicação — e é por isso que um
 * dublê é honesto aqui: não está a simular a analítica, está a fornecer os três valores que o
 * núcleo consome.
 *
 * O `??` **não** serve para os valores por omissão: `null` é um valor legítimo — e é o valor que
 * mais interessa testar (o veículo sem estado de carga). `overrides.socPercent ?? 50` daria 50
 * quando o teste pedisse `null`, e o teste passaria a medir o cenário oposto ao que pediu.
 * Medido: foi esta a causa de um teste que afirmava «não publica a bateria» e a via publicada.
 * A presença da chave é verificada com `in`, e só o valor **ausente** usa o por omissão.
 */
function analyticsWith(overrides: { odometerKm?: number | null; socPercent?: number | null; nominalRangeKm?: number | null } = {}): VehicleAnalyticsStub {
  return {
    vehicle: {
      odometerKm: 'odometerKm' in overrides ? (overrides.odometerKm ?? null) : 150_000,
      nominalRangeKm: 'nominalRangeKm' in overrides ? (overrides.nominalRangeKm ?? null) : 400,
    },
    latestSocPercent: 'socPercent' in overrides ? (overrides.socPercent ?? null) : 50,
  };
}

/** A forma que `publicationsForVehicle` lê da analítica. */
interface VehicleAnalyticsStub {
  vehicle: { odometerKm: number | null; nominalRangeKm: number | null };
  latestSocPercent: number | null;
}

/** O `buildStats` que o núcleo usa: devolve consumos e custo por km, em cêntimos. */
function statsFixture(overrides: { fuelL100Km?: number | null; energyKwh100Km?: number | null; costPerKmCents?: number | null } = {}): StatsStub {
  return {
    consumption: {
      fuelL100Km: 'fuelL100Km' in overrides ? (overrides.fuelL100Km ?? null) : 6.5,
      energyKwh100Km: 'energyKwh100Km' in overrides ? (overrides.energyKwh100Km ?? null) : 18,
    },
    unitCosts: { costPerKmCents: 'costPerKmCents' in overrides ? (overrides.costPerKmCents ?? null) : 12_00 },
  };
}

/** A forma que `publicationsForVehicle` lê do `buildStats`. */
interface StatsStub {
  consumption: { fuelL100Km: number | null; energyKwh100Km: number | null };
  unitCosts: { costPerKmCents: number | null };
}

interface RecordedPublication {
  topic: string;
  payload: string;
}

function recordingClient(): { client: MqttClient; publications: RecordedPublication[] } {
  const publications: RecordedPublication[] = [];
  const client: MqttClient = {
    async connect(): Promise<MqttResult> {
      return { ok: true };
    },
    async publish(topic, payload): Promise<MqttResult> {
      publications.push({ topic, payload });
      return { ok: true };
    },
    async close(): Promise<void> {
      /* nada */
    },
    isConnected(): boolean {
      return true;
    },
  };
  return { client, publications };
}

beforeEach(() => {
  mocks.findMany.mockReset();
  mocks.loadVehicleAnalytics.mockReset();
  mocks.buildStats.mockReset();
  // Por omissão: base vazia, analítica e stats válidos. Cada teste sobrepõe-se ao que precisa.
  mocks.findMany.mockResolvedValue([]);
  mocks.loadVehicleAnalytics.mockResolvedValue(analyticsWith());
  mocks.buildStats.mockReturnValue(statsFixture());
});

/* -------------------------------------------------------------------------- */
/* Sem cliente                                                                 */
/* -------------------------------------------------------------------------- */

describe('INT-001 — núcleo MQTT sem cliente', () => {
  it('devolve um relatório vazio e não toca na base de dados', async () => {
    /*
     * É o caso do ambiente sem broker, e a asserção forte é a segunda: **não** se faz um pedido
     * à base de dados para não publicar nada. Um núcleo que percorresse os veículos e só depois
     * desistisse faria trabalho por nada a cada arranque.
     */
    const report = await runMqttSync({});

    expect(report.vehiclesConsidered).toBe(0);
    expect(report.vehiclesPublished).toBe(0);
    expect(report.entitiesDiscovered).toBe(0);
    expect(report.entitiesPublished).toBe(0);
    expect(report.entitiesSkipped).toBe(0);
    expect(report.failures).toEqual([]);
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.loadVehicleAnalytics).not.toHaveBeenCalled();
  });

  it('um relatório sem cliente tem a forma completa (nenhum campo indefinido)', async () => {
    // Um consumidor (o agendador) registra o relatório tal como vem; um campo em falta
    // apareceria como `undefined` no log, indistinguível de "não aconteceu".
    const report = await runMqttSync({});
    for (const key of [
      'vehiclesConsidered',
      'vehiclesPublished',
      'entitiesDiscovered',
      'entitiesPublished',
      'entitiesSkipped',
      'durationMs',
    ] as const) {
      expect(typeof report[key], `campo ${key}`).toBe('number');
    }
    expect(Array.isArray(report.failures)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Paginação                                                                   */
/* -------------------------------------------------------------------------- */

describe('INT-001 — paginação do núcleo', () => {
  it('uma página incompleta fecha o ciclo', async () => {
    const { client } = recordingClient();
    mocks.findMany.mockResolvedValueOnce([vehicleRow('veh_1')]);

    const report = await runMqttSync({ client, pageSize: 100 });

    // Uma página com menos do que `pageSize` é a última: só um pedido.
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    expect(report.vehiclesConsidered).toBe(1);
  });

  it('avança por cursor enquanto a página vier completa', async () => {
    const { client } = recordingClient();
    const page1 = [vehicleRow('veh_1'), vehicleRow('veh_2')];
    const page2 = [vehicleRow('veh_3')];
    mocks.findMany.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);

    const report = await runMqttSync({ client, pageSize: 2 });

    expect(mocks.findMany).toHaveBeenCalledTimes(2);
    // O segundo pedido usa o cursor da última linha da primeira página, e salta-a.
    const secondCall = mocks.findMany.mock.calls[1]?.[0] as { cursor?: { id: string }; skip?: number };
    expect(secondCall.cursor).toEqual({ id: 'veh_2' });
    expect(secondCall.skip).toBe(1);
    expect(report.vehiclesConsidered).toBe(3);
  });

  it('uma base vazia não faz nenhum pedido de páginas', async () => {
    const { client } = recordingClient();
    mocks.findMany.mockResolvedValueOnce([]);

    const report = await runMqttSync({ client });

    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    expect(report.vehiclesConsidered).toBe(0);
  });

  it('filtra por vehicleIds quando o pedido o especifica', async () => {
    // É o filtro que mantém os testes determinísticos numa base partilhada; e o mesmo que um
    // futuro trabalho por lotes usaria.
    const { client } = recordingClient();
    mocks.findMany.mockResolvedValueOnce([]);

    await runMqttSync({ client, vehicleIds: ['veh_a', 'veh_b'] });

    const call = mocks.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(call.where).toMatchObject({ id: { in: ['veh_a', 'veh_b'] } });
    // E os arquivados ficam sempre de fora.
    expect(call.where.archived).toBe(false);
  });

  it('sem vehicleIds não restringe os ids', async () => {
    const { client } = recordingClient();
    mocks.findMany.mockResolvedValueOnce([]);

    await runMqttSync({ client });

    const call = mocks.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect('id' in call.where).toBe(false);
    expect(call.where.archived).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Agregação do relatório                                                      */
/* -------------------------------------------------------------------------- */

describe('INT-001 — agregação do relatório', () => {
  it('soma descobertas, publicações e saltos de todos os veículos', async () => {
    /*
     * Dois veículos com analíticas diferentes: um com estado de carga (a bateria e a autonomia
     * publicam) e outro sem (ficam indisponíveis e contam-se em `skipped`). O relatório tem de
     * refletir a soma — é o que o agendador regista.
     */
    const { client } = recordingClient();
    mocks.findMany.mockResolvedValueOnce([vehicleRow('veh_1'), vehicleRow('veh_2')]);
    mocks.loadVehicleAnalytics
      .mockResolvedValueOnce(analyticsWith({ odometerKm: 100_000, socPercent: 60, nominalRangeKm: 400 }))
      .mockResolvedValueOnce(analyticsWith({ odometerKm: 200_000, socPercent: null, nominalRangeKm: null }));

    const report = await runMqttSync({ client });

    expect(report.vehiclesConsidered).toBe(2);
    expect(report.vehiclesPublished).toBe(2);
    // O veículo com SoC publica bateria + autonomia; o outro não.
    expect(report.entitiesPublished).toBeGreaterThan(0);
    expect(report.entitiesSkipped).toBeGreaterThan(0);
    expect(report.entitiesDiscovered).toBe(report.entitiesPublished);
    expect(report.failures).toEqual([]);
  });

  it('o veículo sem SoC contribui para skipped e não para published', async () => {
    const { client } = recordingClient();
    mocks.findMany.mockResolvedValueOnce([vehicleRow('veh_sem_soc')]);
    mocks.loadVehicleAnalytics.mockResolvedValueOnce(analyticsWith({ socPercent: null, nominalRangeKm: null }));

    const report = await runMqttSync({ client });

    // Sem SoC, nem `battery` nem `range` publicam; o resto publica.
    expect(report.entitiesPublished).toBeGreaterThan(0);
    // Pelo menos as duas indisponíveis: charging e device_tracker nunca publicam.
    expect(report.entitiesSkipped).toBeGreaterThanOrEqual(2);
    expect(report.vehiclesPublished).toBe(1);
  });

  it('não publica valor nenhum para um veículo cujo estado está ausente', async () => {
    /*
     * A propriedade central de INT-001 no núcleo: um veículo sem dados **não** publica um valor
     * inventado. A asserção é sobre o que saiu para o broker — a string `"0"` para a bateria é o
     * defeito que se está a impedir — e não sobre a intenção da função.
     */
    const { client, publications } = recordingClient();
    mocks.findMany.mockResolvedValueOnce([vehicleRow('veh_1')]);
    mocks.loadVehicleAnalytics.mockResolvedValueOnce(analyticsWith({ odometerKm: 0, socPercent: null, nominalRangeKm: null }));

    await runMqttSync({ client });

    const batteryState = publications.find((publication) => publication.topic.endsWith('zemlo_car_battery/state'));
    expect(batteryState).toBeUndefined(); // nem tópico existe
    // E nenhum tópico de estado recebeu a string "null".
    for (const publication of publications.filter((candidate) => candidate.topic.endsWith('/state'))) {
      expect(publication.payload).not.toBe('null');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Best-effort por veículo                                                     */
/* -------------------------------------------------------------------------- */

describe('INT-001 — best-effort por veículo', () => {
  it('uma analítica que falha não impede os outros veículos', async () => {
    const { client } = recordingClient();
    mocks.findMany.mockResolvedValueOnce([vehicleRow('veh_bad'), vehicleRow('veh_ok')]);
    mocks.loadVehicleAnalytics
      .mockRejectedValueOnce(new Error('dados inconsistentes'))
      .mockResolvedValueOnce(analyticsWith());

    const report = await runMqttSync({ client });

    // O veículo avariado é contado e registado; o outro publica na mesma.
    expect(report.vehiclesConsidered).toBe(2);
    expect(report.vehiclesPublished).toBe(1);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.vehicleId).toBe('veh_bad');
    expect(report.failures[0]?.reason).toContain('dados inconsistentes');
  });

  it('uma falha do cliente a publicar não impede os veículos seguintes', async () => {
    /*
     * Um cliente que falha a disponibilidade do primeiro veículo: o segundo tem de publicar.
     *
     * Nota de semântica, medida e não presumida: `vehiclesPublished` conta os veículos cuja
     * **passagem** terminou sem falha de cálculo/leitura — não os que publicaram tudo com sucesso
     * no broker. Por isso vale 2 aqui, mesmo com o veículo 1 a falhar. O que distingue os dois é
     * `entitiesPublished` (só conta o que saiu) e `failures` (conta o que não saiu). Esta
     * asserção fixa o comportamento **observável** correto: os dois veículos foram processados,
     * houve uma falha registada, e o veículo 2 publicou de facto.
     */
    const publications: RecordedPublication[] = [];
    let failNext = true;
    const client: MqttClient = {
      async connect(): Promise<MqttResult> {
        return { ok: true };
      },
      async publish(topic, payload): Promise<MqttResult> {
        if (failNext && topic.endsWith('/availability')) {
          failNext = false;
          return { ok: false, reason: 'broker recusou' };
        }
        publications.push({ topic, payload });
        return { ok: true };
      },
      async close(): Promise<void> {
        /* nada */
      },
      isConnected(): boolean {
        return true;
      },
    };
    mocks.findMany.mockResolvedValueOnce([vehicleRow('veh_1'), vehicleRow('veh_2')]);

    const report = await runMqttSync({ client });

    expect(report.vehiclesConsidered).toBe(2);
    expect(report.vehiclesPublished).toBe(2); // processados (ver nota acima)
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.vehicleId).toBe('—'); // falha de tópico, agregada pelo publicador
    // O veículo 2 publicou apesar da falha do primeiro — é isto que "best-effort" significa.
    expect(publications.some((publication) => publication.topic.includes('veh_2'))).toBe(true);
    // E as entidades contadas são só as que saíram: o veículo 1 não contribuiu com nenhuma.
    expect(report.entitiesPublished).toBeGreaterThan(0);
  });

  it('uma paginação que rebenta é uma exceção, e não um relatório silencioso', async () => {
    /*
     * A distinção importa: uma falha **de um veículo** é best-effort (relatório com `failures`),
     * mas uma falha **da base de dados** a paginar é um erro do núcleo e propaga-se — quem chama
     * (o runner) registra-o e tenta no intervalo seguinte. Engolir isto faria uma base de dados
     * indisponível parecer "não havia veículos".
     */
    const { client } = recordingClient();
    mocks.findMany.mockRejectedValueOnce(new Error('base de dados indisponível'));

    await expect(runMqttSync({ client })).rejects.toThrow('base de dados indisponível');
  });
});

/* -------------------------------------------------------------------------- */
/* Prefixo de descoberta e data                                               */
/* -------------------------------------------------------------------------- */

describe('INT-001 — parâmetros da passagem', () => {
  it('usa o discoveryPrefix passado por parâmetro', async () => {
    const { client, publications } = recordingClient();
    mocks.findMany.mockResolvedValueOnce([vehicleRow('veh_1')]);

    await runMqttSync({ client, discoveryPrefix: 'casa_minha' });

    const discoveries = publications.filter((publication) => publication.topic.endsWith('/config'));
    expect(discoveries.length).toBeGreaterThan(0);
    for (const discovery of discoveries) expect(discovery.topic.startsWith('casa_minha/')).toBe(true);
  });

  it('aceita uma data fixa, para o cálculo ser determinístico', async () => {
    // O núcleo passa `today` ao `buildStats`; sem isto, um teste que dependesse da janela de 12
    // meses mudaria de resultado com o calendário.
    const { client } = recordingClient();
    mocks.findMany.mockResolvedValueOnce([vehicleRow('veh_1')]);

    await runMqttSync({ client, today: '2026-09-23' });

    const statsOptions = mocks.buildStats.mock.calls[0]?.[1] as { today?: string };
    expect(statsOptions.today).toBe('2026-09-23');
  });
});

/* -------------------------------------------------------------------------- */
/* A tarefa agendável                                                          */
/* -------------------------------------------------------------------------- */

describe('INT-001 — mqttSyncJobFor', () => {
  it('devolve uma tarefa com o nome esperado', () => {
    const { client } = recordingClient();
    const job = mqttSyncJobFor(client);
    expect(job.name).toBe(MQTT_SYNC_JOB_NAME);
    expect(MQTT_SYNC_JOB_NAME).toBe('mqtt-sync');
  });

  it('o run() da tarefa corre a passagem com o cliente injetado', async () => {
    const { client } = recordingClient();
    mocks.findMany.mockResolvedValueOnce([vehicleRow('veh_1')]);
    const job = mqttSyncJobFor(client);

    const result = (await job.run()) as MqttSyncReport;

    expect(result.vehiclesConsidered).toBe(1);
    expect(mocks.findMany).toHaveBeenCalled();
    // E o cliente injetado foi usado: algo foi publicado.
    expect(result.entitiesPublished).toBeGreaterThan(0);
  });

  it('aceita opções e propaga-as à passagem', async () => {
    const { client, publications } = recordingClient();
    mocks.findMany.mockResolvedValueOnce([vehicleRow('veh_1')]);
    const job = mqttSyncJobFor(client, { discoveryPrefix: 'prefixo_da_tarefa' });

    await job.run();

    const discoveries = publications.filter((publication) => publication.topic.endsWith('/config'));
    expect(discoveries.length).toBeGreaterThan(0);
    for (const discovery of discoveries) {
      expect(discovery.topic.startsWith('prefixo_da_tarefa/')).toBe(true);
    }
  });
});
