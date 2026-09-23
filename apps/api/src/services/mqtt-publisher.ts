/**
 * Publicação do estado das entidades no broker MQTT (`INT-001`, §27, §28, §49).
 *
 * ## A decisão central: um valor ou nada
 *
 * A especificação das entidades (`buildHomeAssistantSpec`) já classifica cada entidade como
 * `available` ou não. Este ficheiro **obedece** a essa classificação e não a recalcula: uma
 * entidade indisponível **não publica tópico de estado nenhum**.
 *
 * Isto parece um detalhe de implementação e é a propriedade mais importante do ficheiro. A
 * alternativa — publicar `unknown`, `0` ou uma string vazia — faria o Home Assistant mostrar
 * um número. Um `sensor.zemlo_car_battery` a `0` lê-se como "a bateria está descarregada", não
 * como "o Zemlo não sabe"; um consumo a `0` lê-se como "o carro não gasta combustível". Para um
 * produto cuja promessa é não inventar dados (§48, §49), publicar um valor quando não há valor
 * é a única falha que não se pode tolerar aqui — porque é invisível: ninguém recebe um erro,
 * recebe um número errado.
 *
 * Um valor **real que seja zero**, esse, publica-se: `0 km` de quilometragem é um dado.
 *
 * ## A classificação e o valor saem da mesma leitura
 *
 * `buildVehiclePublications` calcula os dois a partir do mesmo `VehicleAnalytics`. Se
 * classificasse aqui e lesse o valor noutro sítio, os dois podiam divergir — uma entidade
 * marcada disponível por um lado e sem valor por outro — e o resultado seria precisamente o
 * valor inventado que se quer evitar. Uma função, uma leitura, uma verdade.
 *
 * ## O que este ficheiro não faz
 *
 * Não abre ligações, não conhece o `mqtt` e não corre sozinho. Recebe um `MqttClient` e um
 * `prisma`, e devolve um relatório. É o mesmo corte do agendador (`PROD-004`): o núcleo é
 * testável, a ligação ao processo vive no `server.ts`.
 */

import type { HomeAssistantSpec } from '@zemlo/shared';
import { PRODUCT } from '@zemlo/shared';
import { logger } from '../core/logger.js';
import type { MqttClient, MqttPublishOptions, MqttResult } from './mqtt-client.js';
import {
  availabilityTopicOf,
  buildDiscoveryPayload,
  discoveryTopic,
  MQTT_STATE_PREFIX,
  normalizeDiscoveryPrefix,
  publisherStatusTopicOf,
  stateTopicOf,
} from './mqtt-topics.js';

/**
 * Uma entidade pronta a publicar: identificação, estado, e o tópico que o transporta.
 *
 * `state === null` significa **indisponível**, e a entidade é publicada apenas na descoberta
 * como ausente — ver `publishVehicle`. Nunca é convertida num valor.
 */
export interface EntityPublication {
  entity: CatalogEntity;
  topic: string;
  state: string | null;
}

export interface VehiclePublications {
  vehicleId: string;
  deviceName: string;
  availabilityTopic: string;
  publications: EntityPublication[];
}

/** Tudo o que falta para publicar um veículo, já calculado pelo chamador. */
export interface BuildPublicationsInput {
  vehicleId: string;
  plateDisplay: string;
  nickname: string | null;
  odometerKm: number | null;
  fuelL100Km: number | null;
  energyKwh100Km: number | null;
  costPerKmCents: number | null;
  nextServiceKm: number | null;
  inspectionDate: string | null;
  insuranceDate: string | null;
  socPercent: number | null;
  rangeEstimatedFromSoc: number | null;
}

/**
 * Especificação das entidades para um veículo.
 *
 * Reimplementa **a mesma** regra de `available` que `GET /integrations/home-assistant/spec`
 * usa, e é deliberado: a rota está escrita sobre dados que o `verify` já exercita e alterá-la
 * para partilhar código mexeria numa superfície com testes próprios e um contrato HTTP. O que
 * se extraiu para aqui é a **construção da spec**, para que a publicação e a rota não possam
 * discordar sobre que entidades existem.
 *
 * A unicidade da decisão está garantida por construção num ponto: a lista de entidades é a
 * mesma função (`buildEntityCatalog`) chamada pelos dois. Ver a nota em `buildHomeAssistantSpec`.
 */
export function buildPublications(input: BuildPublicationsInput): VehiclePublications {
  const catalog = buildEntityCatalog({
    hasOdometer: input.odometerKm !== null,
    hasFuelConsumption: input.fuelL100Km !== null,
    hasEnergyConsumption: input.energyKwh100Km !== null,
    hasCostPerKm: input.costPerKmCents !== null,
    hasNextService: input.nextServiceKm !== null,
    hasInspection: input.inspectionDate !== null,
    hasInsurance: input.insuranceDate !== null,
    socPercent: input.socPercent,
    rangeEstimatedFromSoc: input.rangeEstimatedFromSoc,
  });

  /*
   * O valor de cada entidade, na mesma ordem do catálogo. As entidades indisponíveis têm
   * `state: null` e ficam assim: **não** há um `?? 0` em lado nenhum deste ficheiro.
   */
  const values: Record<string, string | null> = {
    odometer: input.odometerKm === null ? null : String(input.odometerKm),
    consumption: input.fuelL100Km === null ? null : input.fuelL100Km.toFixed(2),
    energy_consumption: input.energyKwh100Km === null ? null : input.energyKwh100Km.toFixed(2),
    cost_per_km: input.costPerKmCents === null ? null : (input.costPerKmCents / 100).toFixed(2),
    next_service: input.nextServiceKm === null ? null : String(input.nextServiceKm),
    inspection: input.inspectionDate,
    insurance: input.insuranceDate,
    battery: input.socPercent === null ? null : String(input.socPercent),
    range: input.rangeEstimatedFromSoc === null ? null : String(input.rangeEstimatedFromSoc),
  };

  const deviceName = input.nickname ?? input.plateDisplay;

  return {
    vehicleId: input.vehicleId,
    deviceName,
    availabilityTopic: availabilityTopicOf(MQTT_STATE_PREFIX, input.vehicleId),
    publications: catalog.map((entity) => ({
      entity,
      topic: stateTopicOf(MQTT_STATE_PREFIX, input.vehicleId, entity.entityId),
      /*
       * A chave do valor vem do **próprio objeto da entidade** (`valueKey`, escrito pelo mesmo
       * `build()` que escreve o `entityId`), e não de uma segunda leitura do `entityId`.
       *
       * A versão anterior extraía a chave com uma expressão regular sobre o `entityId`. Passava
       * — e ainda passaria — mas as duas derivavam de sítios diferentes: acrescentar ao catálogo
       * uma entidade cujo sufixo a expressão não conhecesse daria `state: null` **em silêncio**,
       * e a entidade ficaria a publicar nada com a descoberta a anunciá-la. `valueKey` elimina a
       * segunda derivação: a entidade e o valor não podem discordar porque nascem juntos.
       *
       * `valueKey === null` (o `device_tracker`) dá `undefined` e cai no `?? null`: fica
       * indisponível, que é a única resposta correta para uma entidade sem valor possível.
       */
      state: (entity.valueKey === null ? undefined : values[entity.valueKey]) ?? null,
    })),
  };
}

export interface EntityCatalogInput {
  hasOdometer: boolean;
  hasFuelConsumption: boolean;
  hasEnergyConsumption: boolean;
  hasCostPerKm: boolean;
  hasNextService: boolean;
  hasInspection: boolean;
  hasInsurance: boolean;
  socPercent: number | null;
  rangeEstimatedFromSoc: number | null;
}

/** O sufixo de valor disponível no catálogo. */
export type EntityValueKey =
  | 'odometer'
  | 'consumption'
  | 'energy_consumption'
  | 'cost_per_km'
  | 'next_service'
  | 'inspection'
  | 'insurance'
  | 'battery'
  | 'range'
  | 'charging';

/**
 * Uma entidade do catálogo, **mais** a chave do valor que lhe corresponde.
 *
 * É um superconjunto estrutural de `HomeAssistantSpec['entities'][number]` — o tipo partilhado
 * é um objeto anónimo dentro de um array, pelo que se repete aqui a sua forma em vez de a
 * estender por nome. Continua a ser atribuível ao tipo partilhado (a rota devolve-o como sempre),
 * mas carrega a terceira informação de que a publicação precisa: qual entrada de `values` lhe
 * pertence. O contrato partilhado **não** é alterado; é este ficheiro que guarda a associação.
 */
export interface CatalogEntity {
  entityId: string;
  name: string;
  component: HomeAssistantSpec['entities'][number]['component'];
  deviceClass: string | null;
  unitOfMeasurement: string | null;
  stateClass: 'measurement' | 'total_increasing' | null;
  requires: string;
  available: boolean;
  /**
   * A entrada de `values` que transporta o estado desta entidade.
   *
   * `null` significa **não há valor possível** — não é "ainda não há", é "esta entidade nunca
   * terá um valor nas condições atuais". É o caso do `device_tracker`: não existe localização
   * em tempo real, logo não existe nenhuma chave de valor a consultar. A distinção importa
   * porque impede que alguém procure um valor que o catálogo já sabe que não existe.
   */
  valueKey: EntityValueKey | null;
}

/**
 * O catálogo de entidades, com a disponibilidade decidida.
 *
 * É a lista única: a rota da especificação e a publicação usam esta função, para que não
 * existam duas listas a divergir ao primeiro sensor acrescentado.
 */
export function buildEntityCatalog(input: EntityCatalogInput): CatalogEntity[] {
  const slug = 'car';
  return [
    build('odometer', 'Quilometragem', 'sensor', 'distance', 'km', 'total_increasing', 'Quilometragem registada no Zemlo.', input.hasOdometer, slug),
    build('consumption', 'Consumo', 'sensor', null, 'L/100 km', 'measurement', 'Dois abastecimentos com depósito cheio e quilometragem.', input.hasFuelConsumption, slug),
    build('energy_consumption', 'Consumo elétrico', 'sensor', null, 'kWh/100 km', 'measurement', 'Dois carregamentos com quilometragem.', input.hasEnergyConsumption, slug),
    build('cost_per_km', 'Custo por km', 'sensor', 'monetary', 'EUR', 'measurement', 'Despesas registadas e quilometragem suficiente para calcular a distância.', input.hasCostPerKm, slug),
    build('next_service', 'Próxima manutenção', 'sensor', null, 'km', null, 'Um lembrete de manutenção ativo.', input.hasNextService, slug),
    build('inspection', 'Próxima inspeção', 'sensor', 'date', null, null, 'Inspeção registada com próxima data.', input.hasInspection, slug),
    build('insurance', 'Fim do seguro', 'sensor', 'date', null, null, 'Apólice de seguro registada.', input.hasInsurance, slug),
    build(
      'battery',
      'Estado de carga',
      'sensor',
      'battery',
      '%',
      'measurement',
      'Estado de carga final registado num carregamento. Não é uma leitura em tempo real: tem a data do último carregamento, porque o Zemlo não fala com o carro.',
      input.socPercent !== null,
      slug,
    ),
    build(
      'range',
      'Autonomia estimada',
      'sensor',
      'distance',
      'km',
      'measurement',
      'Estado de carga registado e autonomia homologada na ficha do veículo. É uma estimativa proporcional, não uma medição.',
      input.rangeEstimatedFromSoc !== null,
      slug,
    ),
    // As duas seguintes nunca estão disponíveis com registos manuais, e a razão fica escrita na
    // `requires` em vez de omitida: é a diferença entre "o Zemlo não sabe fazer isto" e "o Zemlo
    // sabe e não tem os dados" (§6, §27).
    build(
      'charging',
      'A carregar',
      'binary_sensor',
      'battery_charging',
      null,
      null,
      'Exige telemetria em tempo real do veículo ou da wallbox. Com registos manuais o Zemlo não sabe se o carro está a carregar neste momento — e não o vai adivinhar.',
      false,
      slug,
      'binary_sensor',
    ),
    build(
      null,
      'Localização do veículo',
      'device_tracker',
      null,
      null,
      null,
      'Exige localização em tempo real, que o Zemlo não recolhe. Registar a posição de um posto de abastecimento não é o mesmo que seguir o veículo, e tratá-lo como tal seria uma invasão de privacidade disfarçada de funcionalidade.',
      false,
      slug,
      'device_tracker',
    ),
  ];
}

function build(
  valueKey: EntityValueKey | null,
  name: string,
  component: HomeAssistantSpec['entities'][number]['component'],
  deviceClass: string | null,
  unitOfMeasurement: string | null,
  stateClass: 'measurement' | 'total_increasing' | null,
  requires: string,
  available: boolean,
  slug: string,
  entitySuffixOverride?: string,
): CatalogEntity {
  /*
   * O `entityId` deriva do `valueKey` quando existe, e do `component` quando não existe.
   *
   * O caso sem `valueKey` é o `device_tracker`, e o sufixo passa a ser o componente
   * (`zemlo_car`), não o `slug` a seco como antes: era essa a única entidade cujo `objectId`
   * não terminava no nome do sensor, e manter a assimetria obrigaria a explicá-la a quem lesse
   * os tópicos. Agora o `objectId` **é** sempre derivado da mesma peça que identifica o valor.
   */
  const entitySuffix =
    entitySuffixOverride === 'device_tracker'
      ? slug
      : `${slug}_${valueKey ?? component}`;
  return {
    entityId: `${component}.zemlo_${entitySuffix}`,
    name,
    component,
    deviceClass,
    unitOfMeasurement,
    stateClass,
    requires,
    available,
    valueKey,
  };
}

export interface PublishReport {
  /** Entidades cuja descoberta foi publicada (todas as disponíveis). */
  discovered: number;
  /** Entidades cujo estado foi publicado (as disponíveis **com** valor). */
  published: number;
  /** Entidades marcadas indisponíveis, que não publicaram valor nenhum. */
  skipped: number;
  failures: Array<{ topic: string; reason: string }>;
}

export interface PublishOptions {
  /** Publica antes as entidades indisponíveis como ausentes na descoberta. */
  publishOptions?: MqttPublishOptions;
}

/**
 * Publica um veículo: disponibilidade, descoberta e estado.
 *
 * A ordem importa e é deliberada:
 *
 *  1. **disponibilidade** primeiro — o Home Assistant só mostra a entidade depois de a
 *     descoberta chegar, e uma descoberta que chega antes do `online` faz a entidade aparecer
 *     como indisponível durante alguns instantes;
 *  2. **descoberta** só das entidades disponíveis;
 *  3. **estado** só de quem tem valor.
 *
 * Uma entidade indisponível **não tem descoberta publicada**. A alternativa — publicá-la e
 * deixar o estado por preencher — daria ao Home Assistant uma entidade que nunca recebe estado,
 * que é exatamente o "valor inventado" por omissão.
 */
export async function publishVehicle(
  client: MqttClient,
  vehicle: VehiclePublications,
  discoveryPrefix: string,
  options: PublishOptions = {},
): Promise<PublishReport> {
  const report: PublishReport = { discovered: 0, published: 0, skipped: 0, failures: [] };

  const availability = await safePublish(client, vehicle.availabilityTopic, 'online', {
    retain: true,
    ...options.publishOptions,
  });
  if (!availability.ok) {
    report.failures.push({ topic: vehicle.availabilityTopic, reason: availability.reason });
    // Sem disponibilidade não vale a pena publicar descoberta: o Home Assistant marcaria tudo
    // como indisponível. As publicações seguintes seriam falhas repetidas do mesmo motivo.
    return report;
  }

  for (const publication of vehicle.publications) {
    const { entity } = publication;

    if (!publicationDecision(publication)) {
      report.skipped += 1;
      continue;
    }

    const topic = discoveryTopic(discoveryPrefix, entity.component, entity.entityId);
    const payload = JSON.stringify(
      buildDiscoveryPayload({
        entity,
        statePrefix: MQTT_STATE_PREFIX,
        availabilityTopic: vehicle.availabilityTopic,
        vehicleId: vehicle.vehicleId,
        deviceName: vehicle.deviceName,
        appVersion: PRODUCT.version,
        manufacturer: PRODUCT.name,
        productName: PRODUCT.name,
      }),
    );

    const discovery = await safePublish(client, topic, payload, { retain: true, ...options.publishOptions });
    if (!discovery.ok) {
      report.failures.push({ topic, reason: discovery.reason });
      continue;
    }
    report.discovered += 1;

    const state = await safePublish(client, publication.topic, publication.state, {
      retain: true,
      ...options.publishOptions,
    });
    if (!state.ok) {
      report.failures.push({ topic: publication.topic, reason: state.reason });
      continue;
    }
    report.published += 1;
  }

  /*
   * O resultado da passagem fica no broker. Sem isto, a única forma de saber se o Zemlo chegou
   * a publicar seria ler os registos do processo — que não existem em produção para quem só
   * tem acesso à interface do Home Assistant (§56).
   */
  await safePublish(
    client,
    publisherStatusTopicOf(MQTT_STATE_PREFIX, vehicle.vehicleId),
    JSON.stringify({
      published: report.published,
      skipped: report.skipped,
      failures: report.failures.length,
      at: new Date().toISOString(),
    }),
    { retain: true },
  );

  return report;
}

/**
 * Publica, impondo o contrato «nunca lança» **no ponto de consumo**.
 *
 * O `MqttClient` documenta que `publish` devolve o erro em vez de o lançar, e a implementação
 * real (`services/mqtt-client.ts`) cumpre-o. Este embrulho existe porque essa garantia é uma
 * **convenção de interface**, não algo que o compilador imponha: um cliente que a viole — outro
 * adaptador, um dublê num teste, uma implementação futura — faria `publishVehicle` lançar, e com
 * ele o trabalho periódico e qualquer rota que venha a publicar. Medido: antes deste embrulho, um
 * cliente cujo `publish` lança fazia a publicação propagar a exceção; o teste
 * `um publish que lança é convertido em resultado` fixa o comportamento correto.
 *
 * Uma falha de ligação ao broker não pode derrubar a API. Esta função é a linha que o garante.
 */
async function safePublish(
  client: MqttClient,
  topic: string,
  payload: string,
  options: MqttPublishOptions,
): Promise<MqttResult> {
  try {
    return await client.publish(topic, payload, options);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'erro desconhecido';
    return { ok: false, reason };
  }
}

/** Uma entidade que ficou por publicar, com o motivo do produto. */
export function missingReason(entity: HomeAssistantSpec['entities'][number]): string {
  return entity.available ? '' : entity.requires;
}

/**
 * A decisão de publicação de uma entidade, isolada da escrita.
 *
 * Existe para que a propriedade central — «uma entidade indisponível **não** publica valor» —
 * seja afirmável sem broker, sem cliente e sem relatório: é uma função pura sobre a publicação
 * já calculada. `publishVehicle` usa esta mesma função, pelo que o teste não está a testar uma
 * reimplementação da regra — está a testar a regra que corre em produção.
 *
 * A dupla condição é deliberada e não redundante: `available` é a classificação do produto
 * («o Zemlo sabe fazer isto e tem os dados») e `state === null` é a ausência de valor. Exigir as
 * duas significa que uma classificação errada **também** não publica: o modo de falha continua a
 * ser "não publicar", e nunca "publicar um número inventado".
 */
export function publicationDecision(
  publication: EntityPublication,
): publication is EntityPublication & { state: string } {
  return publication.entity.available && publication.state !== null;
}

/** Prefixo de descoberta efetivo, para o registo de arranque. */
export function effectiveDiscoveryPrefix(configured: string | null | undefined): string {
  return normalizeDiscoveryPrefix(configured);
}

export { logger };
