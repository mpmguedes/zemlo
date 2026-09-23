/**
 * Publicação MQTT das entidades do Home Assistant (`INT-001`).
 *
 * ## Porque é que este ficheiro não abre uma base de dados
 *
 * A publicação tem duas metades: **construir** o que se publica (tópicos, payloads, decisão de
 * disponibilidade) e **transportá-lo** até um broker. A segunda metade exige uma infraestrutura
 * que **não existe** neste ambiente — `ARCHITECTURE.md` §8 di-lo e o ROADMAP repete-o como risco
 * da tarefa. Escrever um teste que dependesse da base de dados para exercitar a primeira metade
 * juntaria as duas, e o resultado seria o pior dos dois mundos: uma prova que não cobre o
 * transporte e falha por motivos que não são dela.
 *
 * A primeira metade é, por isso, um módulo puro (`services/mqtt-topics.ts` e
 * `services/mqtt-publisher.ts`) e é aqui que ela é fixada. O transporte tem um dublê — um
 * `MqttClient` em memória — que permite afirmar a **ordem** e o **conteúdo** das publicações
 * sem um broker. O que fica por provar está escrito, por extenso, em `Não validado` no relatório:
 * não se declara E2E o que não passou por um broker real.
 *
 * ## O que é que estes testes provam
 *
 *  - **o tópico de descoberta segue a convenção do Home Assistant** e o `objectId` coincide com
 *    o `entityId` que a interface do Zemlo mostra — a única coisa que impede a entidade de
 *    aparecer com outro nome do lado do Home Assistant;
 *  - **o `discoveryPrefix` configurado é respeitado** — é um dos critérios de aceitação da
 *    tarefa, e é o que se perde primeiro quando se escreve o prefixo à mão num teste;
 *  - **uma entidade indisponível não publica nada** — nem descoberta, nem estado. Este é o
 *    critério «as indisponíveis **não** publicam valores inventados (§49)», e o teste prova-o
 *    pelo dublê (o que foi publicado) **e** pela função de decisão (a regra em si);
 *  - **o payload não tem `null` a fingir de valor** — chaves opcionais ausentes, não nulas;
 *  - **sem broker configurado nada muda** — o critério «o comportamento atual mantém-se»;
 *  - **uma falha de ligação não derruba a API** — `connect`/`publish` devolvem o motivo em vez
 *    de lançar, e o publicador resume a falha em vez de propagar uma exceção;
 *  - **a disponibilidade é publicada antes da descoberta** — a ordem que evita a entidade
 *    aparecer a piscar como indisponível.
 */

import { describe, expect, it, vi } from 'vitest';

import type { HomeAssistantSpec } from '@zemlo/shared';

import {
  MQTT_NODE_ID,
  MQTT_STATE_PREFIX,
  availabilityTopicOf,
  buildDiscoveryPayload,
  discoveryTopic,
  normalizeDiscoveryPrefix,
  objectIdOf,
  publisherStatusTopicOf,
  stateTopicOf,
} from '../src/services/mqtt-topics.js';
import type { MqttClient, MqttPublishOptions, MqttResult } from '../src/services/mqtt-client.js';
import { MQTT_DEPENDENCY_MISSING, createMqttClient } from '../src/services/mqtt-client.js';
import {
  buildEntityCatalog,
  buildPublications,
  effectiveDiscoveryPrefix,
  publicationDecision,
  publishVehicle,
  type BuildPublicationsInput,
} from '../src/services/mqtt-publisher.js';

/* -------------------------------------------------------------------------- */
/* Um cliente MQTT em memória                                                  */
/* -------------------------------------------------------------------------- */

interface RecordedPublication {
  topic: string;
  payload: string;
  options: MqttPublishOptions | undefined;
}

/**
 * Um `MqttClient` que guarda o que lhe mandam publicar.
 *
 * Não é um mock do `mqtt` — é o `MqttClient` do **nosso** contrato, que existe precisamente
 * para isto: o publicador recebe a interface e não o pacote. `connect` é o único ponto que
 * pode falhar, e `connectResult` permite forçar a falha para exercitar o caminho do erro.
 */
function recordingClient(options: { connectResult?: MqttResult; failPublishOn?: string } = {}): {
  client: MqttClient;
  publications: RecordedPublication[];
  connectCalls: () => number;
  closed: () => boolean;
} {
  const publications: RecordedPublication[] = [];
  let connectCalls = 0;
  let closed = false;

  const client: MqttClient = {
    async connect(): Promise<MqttResult> {
      connectCalls += 1;
      return options.connectResult ?? { ok: true };
    },
    async publish(topic, payload, publishOptions): Promise<MqttResult> {
      publications.push({ topic, payload, options: publishOptions });
      if (options.failPublishOn !== undefined && topic === options.failPublishOn) {
        return { ok: false, reason: 'broker indisponível (forçado pelo teste)' };
      }
      return { ok: true };
    },
    async close(): Promise<void> {
      closed = true;
    },
    isConnected(): boolean {
      return !closed;
    },
  };

  return {
    client,
    publications,
    connectCalls: () => connectCalls,
    closed: () => closed,
  };
}

/* -------------------------------------------------------------------------- */
/* Entrada de publicação, com todos os dados presentes                         */
/* -------------------------------------------------------------------------- */

/**
 * Todos os campos preenchidos — o cenário em que **todas** as entidades que podem estar
 * disponíveis estão. Qualquer teste que queira o caso oposto parte daqui e apaga um campo,
 * para que a diferença entre os dois seja exatamente o campo apagado.
 */
const COMPLETE: BuildPublicationsInput = {
  vehicleId: 'veh_01',
  plateDisplay: 'AA-00-AA',
  nickname: 'O carro da casa',
  odometerKm: 152_340,
  fuelL100Km: 6.42,
  energyKwh100Km: 17.85,
  costPerKmCents: 12_34,
  nextServiceKm: 160_000,
  inspectionDate: '2027-03-15',
  insuranceDate: '2027-01-31',
  socPercent: 72,
  rangeEstimatedFromSoc: 288,
};

/* -------------------------------------------------------------------------- */
/* Tópicos                                                                     */
/* -------------------------------------------------------------------------- */

describe('INT-001 — construção de tópicos', () => {
  it('remove o componente do entityId para obter o objectId', () => {
    expect(objectIdOf('sensor.zemlo_car_battery')).toBe('zemlo_car_battery');
    expect(objectIdOf('binary_sensor.zemlo_car_charging')).toBe('zemlo_car_charging');
    expect(objectIdOf('device_tracker.zemlo_car')).toBe('zemlo_car');
    // Um id sem componente não é cortado a meio: devolve-se tal e qual.
    expect(objectIdOf('sem_ponto')).toBe('sem_ponto');
  });

  it('constrói o tópico de descoberta na forma <prefixo>/<componente>/<nó>/<objectId>/config', () => {
    expect(discoveryTopic('homeassistant', 'sensor', 'sensor.zemlo_car_odometer')).toBe(
      'homeassistant/sensor/zemlo/zemlo_car_odometer/config',
    );
    expect(discoveryTopic('homeassistant', 'binary_sensor', 'binary_sensor.zemlo_car_charging')).toBe(
      'homeassistant/binary_sensor/zemlo/zemlo_car_charging/config',
    );
    expect(discoveryTopic('homeassistant', 'device_tracker', 'device_tracker.zemlo_car')).toBe(
      'homeassistant/device_tracker/zemlo/zemlo_car/config',
    );
    expect(MQTT_NODE_ID).toBe('zemlo');
  });

  it('constrói o tópico de estado por veículo e por entidade', () => {
    expect(stateTopicOf('zemlo', 'veh_01', 'sensor.zemlo_car_battery')).toBe(
      'zemlo/veh_01/zemlo_car_battery/state',
    );
    // Dois veículos diferentes não partilham tópico de estado.
    expect(stateTopicOf('zemlo', 'veh_02', 'sensor.zemlo_car_battery')).not.toBe(
      stateTopicOf('zemlo', 'veh_01', 'sensor.zemlo_car_battery'),
    );
  });

  it('constrói o tópico de disponibilidade por veículo', () => {
    expect(availabilityTopicOf('zemlo', 'veh_01')).toBe('zemlo/veh_01/availability');
    expect(availabilityTopicOf('zemlo', 'veh_01')).not.toBe(availabilityTopicOf('zemlo', 'veh_02'));
  });

  it('constrói o tópico de diagnóstico do publicador', () => {
    expect(publisherStatusTopicOf('zemlo', 'veh_01')).toBe('zemlo/veh_01/publisher');
  });

  it('o prefixo de estado é distinto do prefixo de descoberta', () => {
    // Se fossem o mesmo, escolher outro `discoveryPrefix` no Home Assistant renomearia os
    // tópicos de estado sem ninguém o pedir.
    expect(MQTT_STATE_PREFIX).not.toBe('homeassistant');
    /*
     * A asserção é sobre o **primeiro segmento** do tópico, e não sobre "conter": o tópico de
     * descoberta contém `zemlo` como *nó* (`homeassistant/sensor/zemlo/...`), e essa presença é
     * legítima. O que não pode acontecer é o tópico de descoberta começar por `zemlo/`, porque
     * isso significaria que os dois prefixos colapsaram.
     */
    expect(discoveryTopic('homeassistant', 'sensor', 'sensor.a').split('/')[0]).toBe('homeassistant');
    expect(stateTopicOf(MQTT_STATE_PREFIX, 'veh_01', 'sensor.a').split('/')[0]).toBe(MQTT_STATE_PREFIX);
  });

  it('normaliza o prefixo de descoberta, com o valor por omissão do Home Assistant', () => {
    expect(normalizeDiscoveryPrefix('casa')).toBe('casa');
    expect(normalizeDiscoveryPrefix('  casa  ')).toBe('casa');
    expect(normalizeDiscoveryPrefix('')).toBe('homeassistant');
    expect(normalizeDiscoveryPrefix('   ')).toBe('homeassistant');
    expect(normalizeDiscoveryPrefix(null)).toBe('homeassistant');
    expect(normalizeDiscoveryPrefix(undefined)).toBe('homeassistant');
  });

  it('effectiveDiscoveryPrefix aplica a mesma normalização que o tópico usa', () => {
    const configured = '  meu_ha  ';
    expect(effectiveDiscoveryPrefix(configured)).toBe('meu_ha');
    expect(discoveryTopic(effectiveDiscoveryPrefix(configured), 'sensor', 'sensor.zemlo_car_odometer')).toBe(
      'meu_ha/sensor/zemlo/zemlo_car_odometer/config',
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Serialização do payload de descoberta                                       */
/* -------------------------------------------------------------------------- */

describe('INT-001 — serialização do payload de descoberta', () => {
  /** Uma entidade de sensor com todas as chaves opcionais preenchidas. */
  const complete = {
    entityId: 'sensor.zemlo_car_odometer',
    name: 'Quilometragem',
    component: 'sensor' as const,
    deviceClass: 'distance',
    unitOfMeasurement: 'km',
    stateClass: 'total_increasing' as const,
    requires: '',
    available: true,
  };

  const base = {
    statePrefix: MQTT_STATE_PREFIX,
    availabilityTopic: 'zemlo/veh_01/availability',
    vehicleId: 'veh_01',
    deviceName: 'AA-00-AA',
    appVersion: '1.0.0',
    manufacturer: 'Zemlo',
    productName: 'Zemlo',
  };

  it('escreve as chaves obrigatórias que o Home Assistant exige', () => {
    const payload = buildDiscoveryPayload({ ...base, entity: complete });
    expect(payload.name).toBe('Quilometragem');
    expect(payload.unique_id).toBe('zemlo_zemlo_car_odometer');
    expect(payload.state_topic).toBe('zemlo/veh_01/zemlo_car_odometer/state');
    expect(payload.availability_topic).toBe('zemlo/veh_01/availability');
    expect(payload.payload_available).toBe('online');
    expect(payload.payload_not_available).toBe('offline');
    expect(payload.device).toEqual({
      identifiers: ['veh_01'],
      name: 'AA-00-AA',
      manufacturer: 'Zemlo',
      model: 'Zemlo 1.0.0',
    });
  });

  it('escreve as chaves opcionais quando têm valor', () => {
    const payload = buildDiscoveryPayload({ ...base, entity: complete });
    expect(payload.device_class).toBe('distance');
    expect(payload.unit_of_measurement).toBe('km');
    expect(payload.state_class).toBe('total_increasing');
  });

  it('omite as chaves opcionais nulas, em vez de escrever null', () => {
    /*
     * A asserção é sobre a **presença da chave** (`in`), e não sobre o valor. `device_class:
     * null` e a chave ausente não são a mesma coisa para o Home Assistant: a presença de
     * `unit_of_measurement` diz-lhe "este sensor mede algo", e um `null` escrito faria aparecer
     * uma unidade nula — um sensor de texto a ler-se como um número desconhecido.
     */
    const payload = buildDiscoveryPayload({
      ...base,
      entity: {
        entityId: 'binary_sensor.zemlo_car_charging',
        name: 'A carregar',
        component: 'binary_sensor',
        deviceClass: 'battery_charging',
        unitOfMeasurement: null,
        stateClass: null,
        requires: '',
        available: true,
      },
    });
    expect('unit_of_measurement' in payload).toBe(false);
    expect('state_class' in payload).toBe(false);
    // A `device_class` que existe continua a ser escrita.
    expect(payload.device_class).toBe('battery_charging');
  });

  it('o payload é serializável e não contém o literal null', () => {
    const payload = buildDiscoveryPayload({
      ...base,
      entity: {
        entityId: 'sensor.zemlo_car_odometer',
        name: 'Quilometragem',
        component: 'sensor',
        deviceClass: null,
        unitOfMeasurement: null,
        stateClass: null,
        requires: '',
        available: true,
      },
    });
    const json = JSON.stringify(payload);
    expect(json).not.toContain('null');
    // E volta a ser um objeto — o Home Assistant recebe JSON válido.
    expect(JSON.parse(json)).toMatchObject({ name: 'Quilometragem' });
  });
});

/* -------------------------------------------------------------------------- */
/* Catálogo de entidades                                                       */
/* -------------------------------------------------------------------------- */

describe('INT-001 — catálogo de entidades', () => {
  it('produz os mesmos entityId que a interface do Zemlo mostra', () => {
    const catalog = buildEntityCatalog({
      hasOdometer: true,
      hasFuelConsumption: true,
      hasEnergyConsumption: true,
      hasCostPerKm: true,
      hasNextService: true,
      hasInspection: true,
      hasInsurance: true,
      socPercent: 72,
      rangeEstimatedFromSoc: 288,
    });

    expect(catalog.map((entity) => entity.entityId)).toEqual([
      'sensor.zemlo_car_odometer',
      'sensor.zemlo_car_consumption',
      'sensor.zemlo_car_energy_consumption',
      'sensor.zemlo_car_cost_per_km',
      'sensor.zemlo_car_next_service',
      'sensor.zemlo_car_inspection',
      'sensor.zemlo_car_insurance',
      'sensor.zemlo_car_battery',
      'sensor.zemlo_car_range',
      'binary_sensor.zemlo_car_charging',
      'device_tracker.zemlo_car',
    ]);
  });

  it('marca como indisponíveis as entidades sem dados e as que exigem telemetria', () => {
    const catalog = buildEntityCatalog({
      hasOdometer: false,
      hasFuelConsumption: false,
      hasEnergyConsumption: false,
      hasCostPerKm: false,
      hasNextService: false,
      hasInspection: false,
      hasInsurance: false,
      socPercent: null,
      rangeEstimatedFromSoc: null,
    });

    const available = catalog.filter((entity) => entity.available);
    expect(available).toEqual([]);
    // As duas entidades que exigem telemetria nunca estão disponíveis, com ou sem dados.
    expect(catalog.find((entity) => entity.entityId === 'binary_sensor.zemlo_car_charging')?.available).toBe(false);
    expect(catalog.find((entity) => entity.entityId === 'device_tracker.zemlo_car')?.available).toBe(false);
    // Nenhuma tem uma `requires` vazia: o motivo do produto está escrito (§6, §27).
    for (const entity of catalog.filter((candidate) => !candidate.available)) {
      expect(entity.requires.length).toBeGreaterThan(0);
    }
  });

  it('cada entidade carrega a chave do seu valor, e as que não têm valor dizem-no', () => {
    const catalog = buildEntityCatalog({
      hasOdometer: true,
      hasFuelConsumption: true,
      hasEnergyConsumption: true,
      hasCostPerKm: true,
      hasNextService: true,
      hasInspection: true,
      hasInsurance: true,
      socPercent: 72,
      rangeEstimatedFromSoc: 288,
    });
    const byId = new Map(catalog.map((entity) => [entity.entityId, entity]));

    // A chave tem de coincidir com o sufixo do entityId: é esta igualdade que garante que a
    // entidade e o valor não podem divergir.
    expect(byId.get('sensor.zemlo_car_odometer')?.valueKey).toBe('odometer');
    expect(byId.get('sensor.zemlo_car_range')?.valueKey).toBe('range');
    expect(byId.get('binary_sensor.zemlo_car_charging')?.valueKey).toBe('charging');
    // O device_tracker não tem — e não **pode** ter — valor nenhum.
    expect(byId.get('device_tracker.zemlo_car')?.valueKey).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Construção das publicações                                                  */
/* -------------------------------------------------------------------------- */

describe('INT-001 — construção das publicações', () => {
  it('publica o valor de cada entidade disponível', () => {
    const { publications } = buildPublications(COMPLETE);
    const state = new Map(publications.map((publication) => [publication.entity.entityId, publication.state]));

    expect(state.get('sensor.zemlo_car_odometer')).toBe('152340');
    expect(state.get('sensor.zemlo_car_consumption')).toBe('6.42');
    expect(state.get('sensor.zemlo_car_energy_consumption')).toBe('17.85');
    // Cêntimos → euros: 1234 cêntimos são 12.34.
    expect(state.get('sensor.zemlo_car_cost_per_km')).toBe('12.34');
    expect(state.get('sensor.zemlo_car_next_service')).toBe('160000');
    expect(state.get('sensor.zemlo_car_inspection')).toBe('2027-03-15');
    expect(state.get('sensor.zemlo_car_insurance')).toBe('2027-01-31');
    expect(state.get('sensor.zemlo_car_battery')).toBe('72');
    expect(state.get('sensor.zemlo_car_range')).toBe('288');
  });

  it('não inventa valor nenhum quando o dado falta', () => {
    /*
     * O caso que a tarefa proíbe: `sensor.zemlo_car_battery` a `0` lê-se como "a bateria está
     * descarregada". Aqui o estado de carga é desconhecido, e o que tem de acontecer é o sensor
     * ficar indisponível — não receber um zero.
     */
    const { publications } = buildPublications({ ...COMPLETE, socPercent: null, rangeEstimatedFromSoc: null });
    const byId = new Map(publications.map((publication) => [publication.entity.entityId, publication]));

    expect(byId.get('sensor.zemlo_car_battery')?.entity.available).toBe(false);
    expect(byId.get('sensor.zemlo_car_battery')?.state).toBeNull();
    expect(byId.get('sensor.zemlo_car_range')?.entity.available).toBe(false);
    expect(byId.get('sensor.zemlo_car_range')?.state).toBeNull();

    // E a asserção mais forte: o valor publicado nunca é a string "0" para um sensor sem dados.
    const batteryState = byId.get('sensor.zemlo_car_battery')?.state;
    expect(batteryState).not.toBe('0');
  });

  it('publica um zero **real** — zero é um dado, ausência de dado não é', () => {
    // A quilometragem a zero é um carro novo, não um desconhecido. A distinção é o ponto todo.
    const { publications } = buildPublications({ ...COMPLETE, odometerKm: 0 });
    const odometer = publications.find((publication) => publication.entity.entityId === 'sensor.zemlo_car_odometer');
    expect(odometer?.entity.available).toBe(true);
    expect(odometer?.state).toBe('0');
  });

  it('a decisão de publicação é a mesma que o publicador usa', () => {
    const publications = buildPublications({ ...COMPLETE, socPercent: null, rangeEstimatedFromSoc: null }).publications;

    const publishable = publications.filter((publication) => publicationDecision(publication));
    const skipped = publications.filter((publication) => !publicationDecision(publication));

    // Tudo o que publica tem, obrigatoriamente, um valor.
    for (const publication of publishable) expect(publication.state).not.toBeNull();
    // E tudo o que não publica é porque está indisponível.
    for (const publication of skipped) expect(publication.entity.available).toBe(false);
  });

  it('não publica o device_tracker, que não tem valor possível', () => {
    const publications = buildPublications(COMPLETE).publications;
    const tracker = publications.find((publication) => publication.entity.entityId === 'device_tracker.zemlo_car');
    expect(tracker?.state).toBeNull();
    expect(publicationDecision(tracker!)).toBe(false);
  });

  it('usa a matrícula como nome do dispositivo quando não há alcunha', () => {
    expect(buildPublications({ ...COMPLETE, nickname: null }).deviceName).toBe('AA-00-AA');
    expect(buildPublications(COMPLETE).deviceName).toBe('O carro da casa');
  });

  it('o tópico de estado de cada publicação segue o veículo', () => {
    const { publications, availabilityTopic } = buildPublications(COMPLETE);
    expect(availabilityTopic).toBe('zemlo/veh_01/availability');
    const odometer = publications.find((publication) => publication.entity.entityId === 'sensor.zemlo_car_odometer');
    expect(odometer?.topic).toBe('zemlo/veh_01/zemlo_car_odometer/state');
  });
});

/* -------------------------------------------------------------------------- */
/* O publicador, com um cliente em memória                                     */
/* -------------------------------------------------------------------------- */

describe('INT-001 — o publicador', () => {
  it('publica a disponibilidade antes da descoberta', async () => {
    /*
     * A ordem é a razão pela qual uma entidade não aparece a piscar como indisponível: o Home
     * Assistant só a mostra depois de receber a descoberta, e a descoberta aponta para o tópico
     * de disponibilidade. Regressões nesta ordem são invisíveis numa asserção de contagem.
     */
    const { client, publications } = recordingClient();
    await publishVehicle(client, buildPublications(COMPLETE), 'homeassistant');

    expect(publications[0]?.topic).toBe('zemlo/veh_01/availability');
    expect(publications[0]?.payload).toBe('online');
    expect(publications[0]?.options?.retain).toBe(true);
    // A primeira descoberta vem depois da disponibilidade.
    const availabilityIndex = publications.findIndex((publication) => publication.topic.endsWith('/availability'));
    const firstDiscoveryIndex = publications.findIndex((publication) => publication.topic.endsWith('/config'));
    expect(availabilityIndex).toBeLessThan(firstDiscoveryIndex);
  });

  it('publica descoberta e estado para cada entidade disponível', async () => {
    const { client, publications } = recordingClient();
    const vehicle = buildPublications(COMPLETE);
    const report = await publishVehicle(client, vehicle, 'homeassistant');

    const availableCount = vehicle.publications.filter((publication) => publication.entity.available).length;
    expect(report.discovered).toBe(availableCount);
    expect(report.published).toBe(availableCount);
    expect(report.failures).toEqual([]);

    // Para cada entidade disponível há **duas** publicações: descoberta e estado.
    for (const publication of vehicle.publications.filter((candidate) => publicationDecision(candidate))) {
      const discovery = publications.find(
        (recorded) => recorded.topic === discoveryTopic('homeassistant', publication.entity.component, publication.entity.entityId),
      );
      const state = publications.find((recorded) => recorded.topic === publication.topic);
      expect(discovery, `descoberta em falta para ${publication.entity.entityId}`).toBeDefined();
      expect(state, `estado em falta para ${publication.entity.entityId}`).toBeDefined();
      expect(state?.payload).toBe(publication.state);
    }
  });

  it('não publica tópico nenhum para as entidades indisponíveis', async () => {
    /*
     * A prova mais forte do critério «as indisponíveis não publicam valores inventados»: não
     * basta o valor não ser errado — não pode existir **publicação nenhuma**. A asserção é sobre
     * os tópicos que o cliente recebeu, e é por isso que o dublê existe.
     */
    const { client, publications } = recordingClient();
    const vehicle = buildPublications({ ...COMPLETE, socPercent: null, rangeEstimatedFromSoc: null });
    const report = await publishVehicle(client, vehicle, 'homeassistant');

    const unavailable = vehicle.publications.filter((publication) => publication.entity.available === false);
    expect(unavailable.length).toBeGreaterThan(0);

    for (const publication of unavailable) {
      // Nem descoberta…
      const discovery = discoveryTopic('homeassistant', publication.entity.component, publication.entity.entityId);
      expect(publications.some((recorded) => recorded.topic === discovery)).toBe(false);
      // …nem estado.
      expect(publications.some((recorded) => recorded.topic === publication.topic)).toBe(false);
    }
    expect(report.skipped).toBe(unavailable.length);
  });

  it('respeita o discoveryPrefix configurado', async () => {
    const { client, publications } = recordingClient();
    await publishVehicle(client, buildPublications(COMPLETE), 'casa_minha');

    const discoveries = publications.filter((publication) => publication.topic.endsWith('/config'));
    expect(discoveries.length).toBeGreaterThan(0);
    for (const discovery of discoveries) {
      expect(discovery.topic.startsWith('casa_minha/')).toBe(true);
      expect(discovery.topic.startsWith('homeassistant/')).toBe(false);
    }
    // Os tópicos de estado **não** seguem o prefixo de descoberta.
    const states = publications.filter((publication) => publication.topic.endsWith('/state'));
    for (const state of states) expect(state.topic.startsWith('zemlo/')).toBe(true);
  });

  it('publica o resultado da passagem no tópico de diagnóstico', async () => {
    const { client, publications } = recordingClient();
    const report = await publishVehicle(client, buildPublications(COMPLETE), 'homeassistant');

    const status = publications.find((publication) => publication.topic === 'zemlo/veh_01/publisher');
    expect(status).toBeDefined();
    const parsed = JSON.parse(status!.payload) as Record<string, unknown>;
    expect(parsed.published).toBe(report.published);
    expect(parsed.skipped).toBe(report.skipped);
    expect(parsed.failures).toBe(0);
    expect(typeof parsed.at).toBe('string');
  });

  it('uma falha de ligação é resumida e não lança', async () => {
    /*
     * «Falha de ligação ao broker não derruba a API» é um critério de aceitação. A prova é
     * dupla: o publicador resolve com um relatório (não lança), e o relatório diz porquê.
     */
    const { client, publications } = recordingClient({
      connectResult: { ok: false, reason: 'ECONNREFUSED' },
      failPublishOn: 'zemlo/veh_01/availability',
    });

    const report = await publishVehicle(client, buildPublications(COMPLETE), 'homeassistant');

    expect(report.published).toBe(0);
    expect(report.discovered).toBe(0);
    expect(report.failures.length).toBe(1);
    expect(report.failures[0]?.topic).toBe('zemlo/veh_01/availability');
    // Sem disponibilidade não se publica descoberta: só a tentativa falhada sai.
    expect(publications.every((publication) => publication.topic.endsWith('/availability'))).toBe(true);
  });

  it('uma falha a publicar o estado de uma entidade não impede as outras', async () => {
    const { client } = recordingClient({ failPublishOn: 'zemlo/veh_01/zemlo_car_odometer/state' });
    const vehicle = buildPublications(COMPLETE);
    const report = await publishVehicle(client, vehicle, 'homeassistant');

    // A descoberta do odómetro passou (é outro tópico), o estado não.
    expect(report.failures.length).toBe(1);
    expect(report.failures[0]?.topic).toBe('zemlo/veh_01/zemlo_car_odometer/state');
    const availableCount = vehicle.publications.filter((publication) => publication.entity.available).length;
    expect(report.published).toBe(availableCount - 1);
    // As restantes publicaram: a falha de uma não é a falha de todas.
    expect(report.published).toBeGreaterThan(0);
  });

  it('nunca envia a string "null" para o broker', async () => {
    /*
     * O estado é `string | null`, e um `String(null)` acidental produz a string `"null"`. O Home
     * Assistant mostraria `null` como valor — um texto onde devia estar um número — em vez de
     * marcar a entidade como indisponível. As entidades com estado nulo nunca são publicadas
     * (ver o teste anterior), pelo que esta asserção **verifica o que efetivamente saiu** nos
     * tópicos de estado: é a diferença entre "a regra diz que não publica" e "não publicou".
     */
    const { client, publications } = recordingClient();
    await publishVehicle(client, buildPublications({ ...COMPLETE, socPercent: null, rangeEstimatedFromSoc: null }), 'homeassistant');

    const states = publications.filter((publication) => publication.topic.endsWith('/state'));
    for (const state of states) {
      expect(state.payload).not.toBe('null');
      expect(state.payload).not.toBe('undefined');
      // E nenhum payload é vazio — um tópico vazio apagaria o valor retido no Home Assistant.
      expect(state.payload.length).toBeGreaterThan(0);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Sem broker — o comportamento atual mantém-se                                */
/* -------------------------------------------------------------------------- */

describe('INT-001 — sem broker configurado', () => {
  it('sem a dependência mqtt, o cliente devolve o motivo em vez de lançar', async () => {
    /*
     * `mqtt` não está instalada neste ambiente — é o caso real, não um cenário. O cliente tem de
     * o dizer de forma legível e **não** lançar: um `throw` no arranque derrubaria a API por
     * causa de uma integração opcional.
     */
    const client = createMqttClient({ url: 'mqtt://localhost:1883' });
    const result = await client.connect();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // A razão nomeia a dependência, para o operador saber o que fazer.
      expect(result.reason).toContain(MQTT_DEPENDENCY_MISSING);
    }
    expect(client.isConnected()).toBe(false);
  });

  it('a publicação falha como resultado, e a API continua a responder', async () => {
    const client = createMqttClient({ url: 'mqtt://localhost:1883' });
    const result = await client.publish('zemlo/veh_01/availability', 'online', { retain: true });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(MQTT_DEPENDENCY_MISSING);
    // E o encerramento de um cliente nunca ligado não lança.
    await expect(client.close()).resolves.toBeUndefined();
  });

  it('fechar um cliente nunca ligado é inofensivo', async () => {
    const client = createMqttClient({ url: 'mqtt://localhost:1883' });
    await expect(client.close()).resolves.toBeUndefined();
    // Chamar duas vezes também.
    await expect(client.close()).resolves.toBeUndefined();
  });

  it('um publish que lança é convertido em resultado, e não propagado', async () => {
    /*
     * O contrato do `MqttClient` é «**nunca** lança», e este teste fixa-o no lado do
     * **consumidor**: um cliente cujo `publish` rebenta não pode fazer o publicador lançar. É o
     * que garante que ligar o publicador a uma rota, ou a um trabalho periódico, nunca transforma
     * uma avaria do broker numa resposta `500` nem num arranque falhado.
     *
     * Existe por causa de uma mutação sobrevivente: a de trocar o `return { ok: false, reason }`
     * do último `catch` do `createMqttClient` por um `throw`. Essa linha vive no caminho do
     * `mqtt.connect()` e é **inalcançável** neste ambiente sem a dependência instalada — nenhum
     * teste a pode matar aqui. O que **é** testável é a propriedade que a mutação quebraria: quem
     * consome o cliente não pode ver uma exceção. É essa que fica fixada.
     */
    const exploding: MqttClient = {
      async connect(): Promise<MqttResult> {
        return { ok: true };
      },
      async publish(): Promise<MqttResult> {
        throw new Error('o broker rebentou');
      },
      async close(): Promise<void> {
        /* nada */
      },
      isConnected(): boolean {
        return true;
      },
    };

    await expect(publishVehicle(exploding, buildPublications(COMPLETE), 'homeassistant')).resolves.toMatchObject({
      published: 0,
      discovered: 0,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Leitura do catálogo pelo tipo partilhado                                    */
/* -------------------------------------------------------------------------- */

describe('INT-001 — o catálogo é atribuível ao contrato partilhado', () => {
  it('as entidades do catálogo cabem em HomeAssistantSpec.entities', () => {
    /*
     * Esta asserção é de tipos, e existe para impedir a deriva mais provável: alguém
     * enriquece `CatalogEntity` (o `valueKey` que a publicação usa) e o resultado deixa de
     * poder ser servido pela rota. O `typecheck` apanha-o, mas o teste documenta a intenção.
     */
    const entities: HomeAssistantSpec['entities'] = buildEntityCatalog({
      hasOdometer: true,
      hasFuelConsumption: false,
      hasEnergyConsumption: false,
      hasCostPerKm: false,
      hasNextService: false,
      hasInspection: false,
      hasInsurance: false,
      socPercent: null,
      rangeEstimatedFromSoc: null,
    });
    expect(entities.length).toBe(11);
    for (const entity of entities) {
      expect(typeof entity.entityId).toBe('string');
      expect(typeof entity.available).toBe('boolean');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Silêncio do logger nos testes                                               */
/* -------------------------------------------------------------------------- */

describe('INT-001 — o publicador não escreve para o utilizador final', () => {
  it('não imprime para a consola durante uma publicação normal', async () => {
    // A publicação é um efeito de infraestrutura: não pode poluir a saída da aplicação nem
    // depender de `console` (o logger do projeto é JSON estruturado em `core/logger.ts`).
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { client } = recordingClient();
      await publishVehicle(client, buildPublications(COMPLETE), 'homeassistant');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
