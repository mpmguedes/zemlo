/**
 * Composição do publicador MQTT (`INT-001`, critérios de aceitação 1 e 2).
 *
 * ## O que este ficheiro prova, e o que **não** prova
 *
 * Prova a **decisão** de composição a partir da configuração:
 *
 *  - sem `HA_MQTT_URL` **não existe** tarefa MQTT (zero tarefas, não uma tarefa inerte);
 *  - com MQTT configurado é criada exatamente **uma** tarefa `mqtt-sync`;
 *  - o prefixo de descoberta é o normalizado.
 *
 * E prova a **redação** das credenciais do URL de broker: o que sai daqui para os logs não
 * contém o utilizador nem a palavra-passe, nem sequer quando o URL é malformado.
 *
 * **Não** prova que a tarefa publica no broker. Nenhuma destas asserções abre ligação: o
 * `createMqttClient` é preguiçoso e só liga na primeira publicação, e estes testes nunca
 * publicam. Uma publicação real continua por validar — ver o relatório («E2E MQTT real:
 * NÃO VALIDADO»).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * A base de dados é substituída, tal como em `jobs-mqtt-sync.test.ts`.
 *
 * Sem isto, a execução da tarefa no último teste deste ficheiro chega à base de dados real e
 * percorre os veículos que lá estiverem — o resultado deixa de depender só do que o teste
 * monta. Medido: uma primeira versão devolveu `vehiclesConsidered: 19` porque havia 19 veículos
 * na base de dados do ambiente de testes. Isso não é um defeito do produto (a passagem correu
 * corretamente, best-effort, e falhou por falta de `mqtt`); é o teste a depender do estado
 * externo. Com a base vazia, a asserção passa a medir apenas o que este ficheiro controla.
 */
const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock('../src/core/db.js', () => ({
  prisma: { vehicle: { findMany } },
  activeProvider: 'sqlite',
}));

vi.mock('../src/services/analytics.js', () => ({
  loadVehicleAnalytics: vi.fn(),
  buildStats: vi.fn(),
}));

import { composeMqtt, redactMqttUrl, type MqttCompositionConfig } from '../src/services/mqtt-bootstrap.js';

beforeEach(() => {
  findMany.mockReset();
  findMany.mockResolvedValue([]);
});

/** Configuração base: MQTT desligado, como no ambiente sem broker. */
function config(overrides: Partial<MqttCompositionConfig> = {}): MqttCompositionConfig {
  return {
    enabled: false,
    mqttUrl: null,
    username: null,
    password: null,
    discoveryPrefix: 'homeassistant',
    ...overrides,
  };
}

describe('composeMqtt — sem HA_MQTT_URL', () => {
  it('não cria cliente nem tarefa quando a integração está desligada', () => {
    const composition = composeMqtt(config());

    expect(composition.client).toBeNull();
    expect(composition.jobs).toHaveLength(0);
  });

  it('não cria cliente nem tarefa quando `enabled` é verdadeiro mas o URL é nulo', () => {
    /*
     * O caso realista de uma configuração inconsistente: a flag ligada sem broker. A decisão
     * tem de ser "sem broker, sem publicador" — e não "ligar a um URL `null`". É a guarda
     * `config.mqttUrl !== null` que o impede, e é por isso que ela é testada isoladamente.
     */
    const composition = composeMqtt(config({ enabled: true, mqttUrl: null }));

    expect(composition.client).toBeNull();
    expect(composition.jobs).toHaveLength(0);
  });

  it('não cria cliente nem tarefa quando o URL existe mas a integração está desligada', () => {
    const composition = composeMqtt(config({ enabled: false, mqttUrl: 'mqtt://broker.local:1883' }));

    expect(composition.client).toBeNull();
    expect(composition.jobs).toHaveLength(0);
  });

  it('normaliza o prefixo de descoberta mesmo sem cliente', () => {
    // O prefixo é registado no arranque independentemente de haver cliente: um prefixo vazio
    // não pode entrar nos logs como se fosse válido.
    const composition = composeMqtt(config({ discoveryPrefix: '' }));

    expect(composition.discoveryPrefix).toBe('homeassistant');
  });
});

describe('composeMqtt — com MQTT configurado', () => {
  it('cria o cliente e exatamente uma tarefa `mqtt-sync`', () => {
    const composition = composeMqtt(
      config({ enabled: true, mqttUrl: 'mqtt://broker.local:1883', username: 'zemlo', password: 'segredo' }),
    );

    expect(composition.client).not.toBeNull();
    expect(composition.jobs).toHaveLength(1);
    expect(composition.jobs[0]?.name).toBe('mqtt-sync');
  });

  it('não abre ligação ao construir o cliente (não depende de um broker)', () => {
    /*
     * Esta é a asserção que torna o resto do ficheiro executável num ambiente sem broker.
     * Se `createMqttClient` ligasse ao construir, este teste ficaria pendurado até ao
     * `connectTimeout` — e deixaria de ser possível testar a composição aqui.
     *
     * O cliente preguiçoso reporta `isConnected() === false` antes de qualquer publicação,
     * mesmo com um URL apontado a um broker inexistente.
     */
    const composition = composeMqtt(
      config({ enabled: true, mqttUrl: 'mqtt://127.0.0.1:1883' }),
    );

    expect(composition.client?.isConnected()).toBe(false);
  });

  it('preserva o prefixo de descoberta configurado', () => {
    const composition = composeMqtt(
      config({ enabled: true, mqttUrl: 'mqtt://broker.local:1883', discoveryPrefix: 'casa' }),
    );

    expect(composition.discoveryPrefix).toBe('casa');
  });

  it('a tarefa criada executa o núcleo e devolve um relatório', async () => {
    /*
     * A tarefa existe para ser agendada: `run()` tem de devolver o relatório do núcleo. Com a
     * base vazia (mock), a passagem não encontra veículos, não publica nada e resume-o — em vez
     * de lançar. É a prova de que a tarefa criada por `composeMqtt` é a tarefa certa e não um
     * invólucro que não faz nada.
     *
     * Nota: o cliente construído por `composeMqtt` é **real**, mas a passagem não publica porque
     * não há veículos — pelo que nenhuma ligação é tentada e o teste não depende de um broker.
     */
    const composition = composeMqtt(
      config({ enabled: true, mqttUrl: 'mqtt://127.0.0.1:1883' }),
    );

    const report = await composition.jobs[0]!.run();
    expect(report).toMatchObject({
      vehiclesConsidered: 0,
      entitiesPublished: 0,
      failures: [],
    });
    // Prova que a tarefa é a tarefa de sincronização e não um invólucro vazio: consultou a base.
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});

describe('redactMqttUrl', () => {
  it('remove utilizador e palavra-passe, mantendo o servidor e a porta', () => {
    const redacted = redactMqttUrl('mqtt://zemlo:segredo@broker.local:1883');

    expect(redacted).not.toContain('segredo');
    expect(redacted).not.toContain('zemlo');
    // A parte que o operador precisa de ver para confirmar o broker fica.
    expect(redacted).toContain('broker.local');
    expect(redacted).toContain('1883');
  });

  it('remove as credenciais de um URL com TLS (`mqtts`)', () => {
    const redacted = redactMqttUrl('mqtts://admin:hunter2@mqtt.exemplo.pt:8883');

    expect(redacted).not.toContain('hunter2');
    expect(redacted).not.toContain('admin');
    expect(redacted).toContain('mqtt.exemplo.pt');
    expect(redacted).toContain('8883');
  });

  it('devolve o URL inalterado quando não há credenciais', () => {
    // Medido: `URL.toString()` não acrescenta barra final a um URL sem caminho — o valor
    // devolvido é byte-a-byte o de entrada. A asserção fixa isso em vez de o assumir.
    const redacted = redactMqttUrl('mqtt://broker.local:1883');

    expect(redacted).toBe('mqtt://broker.local:1883');
  });

  it('redige um URL só com utilizador (sem palavra-passe)', () => {
    /*
     * `mqtt://user@host:1883` tem `username` preenchido e `password` vazio. É para este caso —
     * e para o simétrico — que existem as guardas `!== ''`: sem elas, o valor vazio seria
     * substituído por `***` e o URL passaria a ter um campo que não tinha.
     */
    const redacted = redactMqttUrl('mqtt://utilizador@broker.local:1883');

    expect(redacted).not.toContain('utilizador');
    expect(redacted).toContain('broker.local');
    expect(redacted).toContain('1883');
  });

  it('redige um URL só com palavra-passe (sem utilizador)', () => {
    const redacted = redactMqttUrl('mqtt://:so-senha@broker.local:1883');

    expect(redacted).not.toContain('so-senha');
    expect(redacted).toContain('broker.local');
    expect(redacted).toContain('1883');
  });

  it('devolve uma indicação — e nunca o valor — quando o URL é malformado', () => {
    /*
     * O ponto sensível: um URL malformado é precisamente onde é mais provável que o segredo
     * apareça colado a algo que o torna inválido. Devolver o original "para diagnóstico"
     * deixaria entrar no log exatamente o que se quer esconder.
     */
    const redacted = redactMqttUrl('isto não é um url: user:segredo@broker');

    expect(redacted).toBe('(HA_MQTT_URL malformado)');
    expect(redacted).not.toContain('segredo');
  });

  it('não lança para nenhuma forma de URL, mesmo vazio', () => {
    for (const value of ['', '::: ', 'mqtt://', '://']) {
      expect(() => redactMqttUrl(value)).not.toThrow();
    }
  });
});
