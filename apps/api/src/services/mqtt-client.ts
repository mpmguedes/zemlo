/**
 * Cliente MQTT do Zemlo (`INT-001`).
 *
 * ## A regra que governa este ficheiro
 *
 * **O Zemlo não pode ficar pior por o broker estar em baixo.** A publicação para o Home
 * Assistant é uma comodidade: nenhuma funcionalidade da API depende dela. Por isso a interface
 * abaixo tem uma propriedade incomum para um cliente de rede — `publish()` **nunca lança**, e
 * `connect()` **nunca rejeita**.
 *
 * Isto não é tolerância a erros por hábito. Um `throw` a partir de um `publish` chamado de
 * dentro de uma rota transformaria uma avaria do broker numa resposta `500` ao utilizador, e
 * uma rejeição não tratada no arranque derrubaria a API por causa de uma integração opcional.
 * O erro é **devolvido** em vez de lançado, e quem chama decide o que fazer com ele.
 *
 * ## Porque é que a dependência é carregada dinamicamente
 *
 * `mqtt` é uma dependência **opcional** e não está instalada neste ambiente. Um `import`
 * estático faria a API não arrancar sem ela — trocar "o Home Assistant não publica" por "o
 * Zemlo não serve" é exatamente o que esta tarefa não pode fazer. O carregamento é por isso
 * dinâmico, acontece **na primeira ligação** e falha com uma mensagem que diz o que instalar
 * e porquê, devolvida como resultado — não como exceção.
 *
 * ## Reconexão
 *
 * `reconnectPeriod` é positivo: o cliente do `mqtt` volta a tentar sozinho, com recuo
 * exponencial. Sem isso, um broker que reinicia deixaria a integração morta até alguém
 * reiniciar a API — e ninguém repara, porque o sintoma (entidades que congelam no valor
 * antigo, que é o que a retenção serve) é indistinguível de "o carro não se mexeu".
 */

import { logger } from '../core/logger.js';

/** Resultado de uma operação, sem exceções. */
export type MqttResult = { ok: true } | { ok: false; reason: string };

export interface MqttPublishOptions {
  /** O broker guarda a última mensagem e entrega-a a quem se ligue depois. */
  retain?: boolean;
  qos?: 0 | 1;
}

export interface MqttClient {
  /** Liga-se ao broker se ainda não estiver ligado. Idempotente e sem exceções. */
  connect(): Promise<MqttResult>;
  /** Publica. Devolve o motivo em vez de lançar. */
  publish(topic: string, payload: string, options?: MqttPublishOptions): Promise<MqttResult>;
  /** Fecha a ligação. Não espera por publicações em voo. */
  close(): Promise<void>;
  /** `true` quando há uma ligação utilizável neste momento. */
  isConnected(): boolean;
}

export interface MqttClientOptions {
  url: string;
  username?: string | null;
  password?: string | null;
  /** Identificador da sessão no broker. Fixo por processo: ver a nota sobre a sessão limpa. */
  clientId?: string;
  /** Intervalo de reconexão, em ms. `0` desliga a reconexão automática. */
  reconnectPeriodMs?: number;
}

/** Razão de indisponibilidade quando falta a dependência. Exportada para o teste a poder afirmar. */
export const MQTT_DEPENDENCY_MISSING = 'a dependência `mqtt` não está instalada';

/**
 * Carrega o módulo `mqtt` sem o tornar obrigatório.
 *
 * O `import()` de um especificador que não existe lança `ERR_MODULE_NOT_FOUND`; o `catch`
 * converte-o numa razão legível. O `await` é feito com `import()` e não com
 * `createRequire` para que o empacotador veja a chamada — e para não deixar uma dependência
 * opcional a passar por obrigatória na análise estática.
 */
async function loadMqttModule(): Promise<
  { ok: true; module: { connect: (url: string, options: Record<string, unknown>) => MqttUnderlying } } | { ok: false; reason: string }
> {
  try {
    /*
     * O especificador é **construído** e não escrito como literal.
     *
     * Medido: `await import('mqtt')` com o pacote ausente dá
     * `TS2307: Cannot find module 'mqtt'` e o `typecheck` do workspace falha — apesar de o
     * `catch` tratar o erro em runtime. O `typecheck` é o que o CI corre (OPS-001) e não pode
     * ficar condicionado à instalação de uma dependência opcional: uma `import()` com um
     * literal continua a ser resolvida pelo compilador, e a resolução falha antes de o
     * `catch` existir.
     *
     * Com o especificador numa variável, a chamada é dinâmica para o compilador e o erro
     * passa a ser de runtime — que é o que o `catch` apanha e converte numa razão legível.
     */
    const specifier = 'mqtt';
    const module = (await import(/* @vite-ignore */ specifier)) as unknown as {
      connect: (url: string, options: Record<string, unknown>) => MqttUnderlying;
      default?: { connect: (url: string, options: Record<string, unknown>) => MqttUnderlying };
    };
    const connect = module.connect ?? module.default?.connect;
    if (typeof connect !== 'function') {
      return { ok: false, reason: 'o módulo `mqtt` não expõe `connect`' };
    }
    return { ok: true, module: { connect } };
  } catch (error) {
    const detail = error instanceof Error ? error.name : 'erro desconhecido';
    return {
      ok: false,
      reason: `${MQTT_DEPENDENCY_MISSING} (${detail}). Instala-a com \`npm install mqtt --workspace @zemlo/api\` para ativar a publicação.`,
    };
  }
}

/**
 * A forma mínima do cliente subjacente que este ficheiro usa.
 *
 * Declarada aqui, e não importada dos tipos de `mqtt`, porque a dependência é opcional: um
 * `import type` seria apagado na compilação e não a tornaria obrigatória, mas deixaria o
 * `typecheck` a falhar enquanto `mqtt` não estiver instalada — e a tarefa não pode condicionar
 * o `typecheck` do projeto à instalação de uma dependência opcional.
 */
interface MqttUnderlying {
  on(event: string, listener: (...args: unknown[]) => void): void;
  publish(topic: string, payload: string, options: MqttPublishOptions, callback: (error?: Error) => void): void;
  end(force: boolean, callback?: () => void): void;
  connected?: boolean;
}

/**
 * Cria um cliente MQTT com ligação preguiçosa.
 *
 * A ligação é preguiçosa de propósito: o `server.ts` arranca o publicador no arranque, e um
 * broker em baixo não pode atrasar o arranque da API nem deixar uma promessa pendente. Aqui, a
 * primeira publicação é que tenta ligar.
 */
export function createMqttClient(options: MqttClientOptions): MqttClient {
  const { url, username = null, password = null } = options;
  const reconnectPeriodMs = options.reconnectPeriodMs ?? 5_000;
  const clientId = options.clientId ?? `zemlo-api-${process.pid}`;

  let underlying: MqttUnderlying | null = null;
  let connecting: Promise<MqttResult> | null = null;
  let lastReason: string | null = null;

  function isConnected(): boolean {
    return underlying !== null && underlying.connected === true;
  }

  async function connect(): Promise<MqttResult> {
    if (isConnected()) return { ok: true };
    // Uma ligação já em curso é partilhada: sem isto, duas publicações simultâneas na primeira
    // passagem abririam duas ligações e uma delas ficaria órfã.
    if (connecting !== null) return connecting;

    connecting = (async (): Promise<MqttResult> => {
      const loaded = await loadMqttModule();
      if (!loaded.ok) {
        lastReason = loaded.reason;
        return { ok: false, reason: loaded.reason };
      }

      try {
        const client = loaded.module.connect(url, {
          clientId,
          ...(username !== null ? { username } : {}),
          ...(password !== null ? { password } : {}),
          reconnectPeriod: reconnectPeriodMs,
          /*
           * Sessão não persistente. Uma sessão limpa evita que o broker acumule publicações
           * de uma instância que morreu sem se despedir — o estado é retido no tópico, que é
           * onde a recuperação acontece, e não na fila de sessão.
           */
          clean: true,
          connectTimeout: 5_000,
        });

        client.on('error', (error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error);
          lastReason = reason;
          logger.warn('broker MQTT: erro de ligação', { reason });
        });
        client.on('reconnect', () => {
          logger.info('broker MQTT: a reconectar');
        });
        client.on('connect', () => {
          lastReason = null;
          logger.info('broker MQTT: ligado');
        });

        underlying = client;
        /*
         * Não esperamos pelo evento `connect`.
         *
         * `mqtt.connect()` devolve já o cliente e liga-se em segundo plano. Esperar aqui
         * significaria que uma primeira passagem de publicação bloquearia até ao
         * `connectTimeout` com o broker em baixo — e a passagem existe precisamente para o
         * caso de ele estar em baixo. As publicações feitas antes do `connect` ficam em fila
         * no próprio cliente, que as entrega quando a ligação abrir.
         */
        return { ok: true };
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'erro desconhecido';
        lastReason = reason;
        return { ok: false, reason };
      }
    })();

    try {
      return await connecting;
    } finally {
      connecting = null;
    }
  }

  async function publish(
    topic: string,
    payload: string,
    publishOptions: MqttPublishOptions = {},
  ): Promise<MqttResult> {
    const connected = await connect();
    if (!connected.ok) return connected;
    if (underlying === null) return { ok: false, reason: lastReason ?? 'sem ligação' };

    return new Promise<MqttResult>((resolve) => {
      let settled = false;
      /*
       * O `callback` do `publish` do `mqtt` é opcional para `qos: 0` e nunca chega a ser
       * chamado se a ligação cair a meio. Sem um limite, a passagem ficaria presa numa
       * promessa que ninguém resolve — e é por isso que o tempo-limite existe, e não por
       * precaução.
       */
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, reason: 'sem confirmação de publicação dentro de 5 s' });
      }, 5_000);
      timer.unref();

      try {
        underlying!.publish(
          topic,
          payload,
          { retain: publishOptions.retain ?? true, qos: publishOptions.qos ?? 0 },
          (error?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) {
              lastReason = error.message;
              resolve({ ok: false, reason: error.message });
              return;
            }
            resolve({ ok: true });
          },
        );
      } catch (error) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          const reason = error instanceof Error ? error.message : 'erro desconhecido';
          lastReason = reason;
          resolve({ ok: false, reason });
        }
      }
    });
  }

  async function close(): Promise<void> {
    const client = underlying;
    underlying = null;
    if (client === null) return;
    await new Promise<void>((resolve) => {
      try {
        // `force = false`: dá a saída limpa ao broker em vez de cortar a ligação.
        client.end(false, () => resolve());
      } catch {
        resolve();
      }
    });
  }

  return { connect, publish, close, isConnected };
}
