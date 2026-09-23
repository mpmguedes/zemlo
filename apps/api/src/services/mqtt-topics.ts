/**
 * O contrato de tópicos e payloads do MQTT do Home Assistant (`INT-001`, §27, §28).
 *
 * ## Porque é que isto é um ficheiro **puro**
 *
 * Um tópico mal construído não se vê na aplicação: vê-se no Home Assistant, onde a entidade
 * simplesmente não aparece — ou aparece com um identificador diferente do que a interface do
 * Zemlo mostra. Como não há broker no ambiente de desenvolvimento (§8 da `ARCHITECTURE`), uma
 * função que exigisse uma ligação para ser exercitada ficaria **sem prova nenhuma**.
 *
 * Este ficheiro não tem I/O, não tem relógio e não conhece o broker: recebe o prefixo e o
 * `vehicleId` e devolve strings. É a parte que a suite pode fixar sem infraestrutura, e é
 * também onde vive a decisão que mais facilmente diverge — o `discoveryPrefix` configurado.
 *
 * ## A forma canónica do Home Assistant
 *
 * A descoberta por MQTT segue a convenção do Home Assistant para `<component>/<node>/<object>`:
 *
 *     <discoveryPrefix>/<component>/<nodeId>/<objectId>/config      (retenção: sim)
 *     <statePrefix>/<nodeId>/<objectId>/state                       (retenção: sim)
 *     <availabilityTopic>                                           (retenção: sim, "online"/"offline")
 *
 * O `objectId` é único dentro do nó, e é o `entityId` da especificação sem `<component>.`
 * — é essa a razão pela qual o `entityId` que a interface do Zemlo mostra e o objeto que o
 * Home Assistant cria não podem divergir.
 */

import type { HomeAssistantSpec } from '@zemlo/shared';

/** O componente do Home Assistant, tal como aparece no tópico e no `entityId`. */
export type HomeAssistantComponent = HomeAssistantSpec['entities'][number]['component'];

/**
 * Identificador do nó na descoberta.
 *
 * É **fixo** e não derivado do utilizador ou do veículo: o nó é a instalação do Zemlo, e um
 * nó por veículo obrigaria o Home Assistant a reconhecer um dispositivo novo sempre que o
 * utilizador acrescentasse um carro. Os veículos distinguem-se no `objectId`.
 */
export const MQTT_NODE_ID = 'zemlo';

/**
 * Prefixo dos tópicos de estado.
 *
 * Diferente do prefixo de descoberta de propósito: a descoberta é efémera (o Home Assistant
 * consome-a uma vez e pode apagá-la), o estado é o que o Zemlo publica continuamente. Misturá-los
 * faria com que uma limpeza da descoberta apagasse o estado, ou que um `discoveryPrefix`
 * escolhido pelo utilizador renomeasse os tópicos de estado sem ninguém o pedir.
 */
export const MQTT_STATE_PREFIX = 'zemlo';

/** O `entityId` sem o `<component>.` que o Home Assistant não quer no `objectId`. */
export function objectIdOf(entityId: string): string {
  const separator = entityId.indexOf('.');
  return separator === -1 ? entityId : entityId.slice(separator + 1);
}

/** Tópico de descoberta de uma entidade: `<prefixo>/<componente>/<nó>/<objectId>/config`. */
export function discoveryTopic(discoveryPrefix: string, component: string, entityId: string): string {
  return `${discoveryPrefix}/${component}/${MQTT_NODE_ID}/${objectIdOf(entityId)}/config`;
}

/**
 * Tópico de estado de uma entidade.
 *
 * Um só por entidade — não um objeto com o estado de todas. Uma publicação por entidade é o
 * que permite publicar **só** as entidades disponíveis: um documento único com todos os valores
 * obrigaria a decidir o que pôr nos campos sem dados, e a resposta honesta seria omiti-los
 * (uma chave em falta) ou pôr `null` (um valor que o Home Assistant mostraria como
 * desconhecido). Os dois são piores do que não publicar o tópico de todo.
 */
export function stateTopicOf(statePrefix: string, vehicleId: string, entityId: string): string {
  return `${statePrefix}/${vehicleId}/${objectIdOf(entityId)}/state`;
}

/**
 * Tópico de disponibilidade, por veículo (`online`/`offline`).
 *
 * É por veículo e não por instalação: o Zemlo pode estar a responder e um veículo específico
 * pode não ter dados para nenhuma entidade. Publicar `offline` global marcaria todas as
 * entidades como indisponíveis no Home Assistant por causa de um carro.
 */
export function availabilityTopicOf(statePrefix: string, vehicleId: string): string {
  return `${statePrefix}/${vehicleId}/availability`;
}

/**
 * Tópico de diagnóstico do publicador.
 *
 * Existe para que a operação consiga responder a "o Zemlo chegou a publicar?" sem acesso ao
 * processo: o resultado da última passagem fica no broker. Não é um tópico de descoberta —
 * nada o consome automaticamente — e é por isso que não aparece em `HomeAssistantSpec`.
 */
export function publisherStatusTopicOf(statePrefix: string, vehicleId: string): string {
  return `${statePrefix}/${vehicleId}/publisher`;
}

/** Payload de descoberta de uma entidade `available`, no formato do Home Assistant. */
export interface DiscoveryPayload {
  name: string;
  unique_id: string;
  state_topic: string;
  availability_topic: string;
  payload_available: string;
  payload_not_available: string;
  device: {
    identifiers: string[];
    name: string;
    manufacturer: string;
    model: string;
  };
  [key: string]: unknown;
}

export interface DiscoveryInput {
  entity: HomeAssistantSpec['entities'][number];
  statePrefix: string;
  availabilityTopic: string;
  vehicleId: string;
  /** Como o veículo é mostrado no Home Assistant (matrícula ou nome). */
  deviceName: string;
  /** Versão da aplicação, publicada no dispositivo para diagnóstico. */
  appVersion: string;
  manufacturer: string;
  productName: string;
}

/**
 * Monta o payload de descoberta de **uma** entidade disponível.
 *
 * As chaves opcionais são escritas **só quando têm valor**. `device_class: null` e
 * `unit_of_measurement: null` não são o mesmo que a chave ausente: o Home Assistant interpreta
 * a presença de `unit_of_measurement` como "este sensor mede algo" e a ausência como "é um
 * valor sem unidade". Escrever `null` fá-lo-ia criar uma unidade nula — que é como um sensor de
 * texto passa a aparecer como um número desconhecido.
 */
export function buildDiscoveryPayload(input: DiscoveryInput): DiscoveryPayload {
  const { entity } = input;
  const payload: DiscoveryPayload = {
    name: entity.name,
    unique_id: `${MQTT_NODE_ID}_${objectIdOf(entity.entityId)}`,
    state_topic: stateTopicOf(input.statePrefix, input.vehicleId, entity.entityId),
    availability_topic: input.availabilityTopic,
    payload_available: 'online',
    payload_not_available: 'offline',
    device: {
      identifiers: [input.vehicleId],
      name: input.deviceName,
      manufacturer: input.manufacturer,
      model: `${input.productName} ${input.appVersion}`,
    },
  };

  if (entity.deviceClass !== null) payload.device_class = entity.deviceClass;
  if (entity.unitOfMeasurement !== null) payload.unit_of_measurement = entity.unitOfMeasurement;
  if (entity.stateClass !== null) payload.state_class = entity.stateClass;

  return payload;
}

/** Prefixo de descoberta normalizado, ou o valor por omissão se estiver vazio. */
export function normalizeDiscoveryPrefix(configured: string | null | undefined): string {
  return configured !== null && configured !== undefined && configured.trim().length > 0
    ? configured.trim()
    : 'homeassistant';
}
