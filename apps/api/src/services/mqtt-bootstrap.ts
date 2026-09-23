/**
 * Composição da publicação MQTT a partir da configuração (`INT-001`).
 *
 * ## Porque é que isto é um ficheiro separado do `server.ts`
 *
 * O `server.ts` chama `main()` no import, pelo que é **inimportável** num teste: importá-lo
 * arrancaria o servidor, abriria a porta e escreveria na base de dados. As duas peças que a
 * `INT-001` precisa de provar sem broker — **«sem `HA_MQTT_URL` não existe tarefa MQTT»** e
 * **«com MQTT configurado a tarefa é criada»** — viviam lá dentro, atrás desse import.
 *
 * Extraí-las para aqui é o que as torna afirmáveis. É o mesmo corte que `jobs/mqtt-sync.ts` faz
 * entre o núcleo e o processo: a decisão fica numa função pura sobre a configuração, e o
 * `server.ts` fica só com a ligação ao ciclo de vida (criar, arrancar, fechar). **O comportamento
 * não muda** — o corpo das funções é o mesmo, e o `server.ts` continua a chamá-las.
 *
 * ## O que é decidido aqui, e porquê
 *
 *  - **sem `HA_MQTT_URL` não há cliente nem tarefa.** Não é uma tarefa que corre e não faz nada:
 *    é uma tarefa que **não existe**. Um agendador com uma tarefa inerte a intervalos regulares
 *    encheria os registos com a mesma linha, e o operador deixaria de as ler — precisamente as que
 *    interessam no dia em que o broker for configurado.
 *  - **ninguém abre a ligação no arranque.** O cliente é preguiçoso (`services/mqtt-client.ts`):
 *    liga-se na primeira publicação. Um broker em baixo não atrasa o arranque nem deixa uma
 *    promessa pendente, e um `HA_MQTT_URL` errado não impede a API de servir.
 */

import type { ScheduledJob } from '../jobs/runner.js';
import { mqttSyncJobFor } from '../jobs/mqtt-sync.js';
import type { MqttClient } from './mqtt-client.js';
import { createMqttClient } from './mqtt-client.js';
import { normalizeDiscoveryPrefix } from './mqtt-topics.js';

/** A configuração que a composição consulta — o subconjunto de `config.homeAssistant`. */
export interface MqttCompositionConfig {
  readonly enabled: boolean;
  readonly mqttUrl: string | null;
  readonly username: string | null;
  readonly password: string | null;
  readonly discoveryPrefix: string;
}

export interface MqttComposition {
  /** O cliente, ou `null` quando não há broker configurado. */
  readonly client: MqttClient | null;
  /** Zero tarefas sem cliente; uma tarefa com cliente. */
  readonly jobs: ScheduledJob[];
  /** O prefixo de descoberta normalizado — o valor que o log de arranque mostra. */
  readonly discoveryPrefix: string;
}

/**
 * Decide o cliente e as tarefas a partir da configuração.
 *
 * Pura no que respeita a I/O: **não** abre ligação nenhuma (o `createMqttClient` é preguiçoso) e
 * não publica nada. É por isso que pode ser chamada num teste sem broker — e é esse o ponto.
 */
export function composeMqtt(config: MqttCompositionConfig): MqttComposition {
  const client =
    config.enabled && config.mqttUrl !== null
      ? createMqttClient({
          url: config.mqttUrl,
          username: config.username,
          password: config.password,
        })
      : null;

  return {
    client,
    jobs: client === null ? [] : [mqttSyncJobFor(client)],
    /*
     * O prefixo normalizado delega em `services/mqtt-topics.ts`, que é a **única** fonte da
     * normalização (`normalizeDiscoveryPrefix`): um prefixo vazio passa a `homeassistant`.
     * Repetir a regra aqui criaria duas versões da mesma decisão — e a que o log de arranque
     * mostra poderia divergir da que os tópicos usam.
     */
    discoveryPrefix: normalizeDiscoveryPrefix(config.discoveryPrefix),
  };
}

/**
 * Um URL de broker com as credenciais removidas, para registo.
 *
 * `mqtt://user:pass@broker:1883` é uma forma comum de configurar o `HA_MQTT_URL`, e o URL inteiro
 * já esteve em vários logs de arranque de integrações por esse mundo. Aqui o `username` e o
 * `password` são substituídos, e o resto — o esquema, o servidor e a porta — fica: é essa a parte
 * que o operador precisa de ver para confirmar a que broker se está a ligar.
 *
 * Um URL malformado devolve uma indicação, **sem o valor**: a função é usada para registar, e o
 * valor malformado pode conter precisamente o segredo que se quer esconder. Devolver o URL
 * original "para diagnóstico" seria deixá-lo entrar no log pela porta que se fechou.
 */
export function redactMqttUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username !== '') parsed.username = '***';
    if (parsed.password !== '') parsed.password = '***';
    return parsed.toString();
  } catch {
    return '(HA_MQTT_URL malformado)';
  }
}
