/**
 * Trabalho periódico: publicar o estado das entidades no broker MQTT (`INT-001`, §27).
 *
 * ## O corte, e porque é o mesmo do agendador
 *
 * Este núcleo percorre os veículos com uma integração Home Assistant ativa, monta as
 * publicações e entrega-as a um `MqttClient` — que recebe por parâmetro e **não** constrói.
 * Tal como `jobs/notification-sync.ts`, não sabe o que é um temporizador nem uma ligação de
 * rede: sabe percorrer, calcular e resumir. É o `server.ts` que liga este núcleo ao cliente
 * verdadeiro e ao relógio.
 *
 * ## Porque é que este núcleo **não** é agendado por omissão
 *
 * O `notification-sync` corre sozinho porque o seu efeito é interno: escreve notificações na
 * base de dados do Zemlo. Este fala com um serviço **de terceiros** que pode não existir, e
 * o ROADMAP diz explicitamente que sem broker o comportamento atual se mantém. Por isso o
 * núcleo é uma função — testável e invocável — e o `server.ts` só o liga ao relógio quando
 * há um `HA_MQTT_URL` configurado. Sem broker não há publicador, não há relógio, e nada muda.
 *
 * ## Best-effort por veículo
 *
 * Um veículo sem dados suficientes, ou um erro a calcular a sua analítica, não pode impedir
 * a publicação dos outros. A falha é contada, registada com o `vehicleId` e o motivo, e a
 * passagem continua — a mesma decisão de `notification-sync`.
 */

import { config } from '../core/config.js';
import { prisma } from '../core/db.js';
import { errorReason } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { buildStats, loadVehicleAnalytics, type VehicleAnalytics } from '../services/analytics.js';
import type { MqttClient } from '../services/mqtt-client.js';
import {
  buildPublications,
  effectiveDiscoveryPrefix,
  publishVehicle,
  type PublishReport,
  type VehiclePublications,
} from '../services/mqtt-publisher.js';
import type { ScheduledJob } from './runner.js';

export const MQTT_SYNC_JOB_NAME = 'mqtt-sync';

/** Quantos veículos são lidos por página. */
export const MQTT_SYNC_PAGE_SIZE = 100;

/** Travão de segurança da paginação — ver a nota equivalente em `notification-sync.ts`. */
const MAX_PAGES = 10_000;

export interface MqttSyncFailure {
  vehicleId: string;
  reason: string;
}

export interface MqttSyncReport {
  /** Veículos considerados nesta passagem. */
  vehiclesConsidered: number;
  /** Veículos cuja publicação terminou sem falha de cálculo. */
  vehiclesPublished: number;
  /** Entidades cuja descoberta foi publicada. */
  entitiesDiscovered: number;
  /** Entidades cujo estado foi publicado. */
  entitiesPublished: number;
  /** Entidades indisponíveis que **não** publicaram valor nenhum. */
  entitiesSkipped: number;
  failures: MqttSyncFailure[];
  durationMs: number;
}

export interface MqttSyncOptions {
  /** Limita a passagem a estes veículos. Existe para os testes serem determinísticos. */
  vehicleIds?: string[];
  /** Quantos veículos por página. */
  pageSize?: number;
  /** O cliente a usar. Sem ele, o núcleo não faz nada — ver `runMqttSync`. */
  client?: MqttClient;
  /** Prefixo de descoberta. Por omissão, o configurado (`HA_DISCOVERY_PREFIX`). */
  discoveryPrefix?: string;
  /** A data de hoje, para o `buildStats` ser determinístico nos testes. */
  today?: string;
}

/**
 * Publica o estado de todos os veículos com integração ativa.
 *
 * Devolve um relatório e **não lança** por falha de um veículo. Lança apenas se a própria
 * paginação falhar (base de dados indisponível), como `runNotificationSync`.
 *
 * Sem `client` — o caso do ambiente sem broker — devolve um relatório vazio com zero em
 * tudo. Não é um erro: é a resposta honesta a «não há para onde publicar». O `server.ts`
 * nem chega a chamar isto sem broker, mas o núcleo não pode depender disso para ser seguro:
 * uma passagem acidental sem cliente tem de ser inofensiva.
 */
export async function runMqttSync(options: MqttSyncOptions = {}): Promise<MqttSyncReport> {
  const startedAt = process.hrtime.bigint();
  const pageSize = options.pageSize ?? MQTT_SYNC_PAGE_SIZE;

  const report: MqttSyncReport = {
    vehiclesConsidered: 0,
    vehiclesPublished: 0,
    entitiesDiscovered: 0,
    entitiesPublished: 0,
    entitiesSkipped: 0,
    failures: [],
    durationMs: 0,
  };

  const client = options.client;
  if (client === undefined) {
    logger.info('publicação MQTT ignorada: sem cliente ligado', { job: MQTT_SYNC_JOB_NAME });
    return { ...report, durationMs: elapsed(startedAt) };
  }

  const discoveryPrefix = options.discoveryPrefix ?? effectiveDiscoveryPrefix(config.homeAssistant.discoveryPrefix);
  const today = options.today ?? new Date().toISOString().slice(0, 10);

  let cursor: string | undefined;
  let pages = 0;

  for (;;) {
    if (pages >= MAX_PAGES) {
      logger.warn('publicação MQTT truncada: limite de páginas atingido', {
        job: MQTT_SYNC_JOB_NAME,
        pages,
        vehiclesConsidered: report.vehiclesConsidered,
      });
      break;
    }

    const vehicles = await prisma.vehicle.findMany({
      where: {
        archived: false,
        ...(options.vehicleIds === undefined ? {} : { id: { in: options.vehicleIds } }),
      },
      orderBy: { id: 'asc' },
      take: pageSize,
      ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
      select: { id: true, userId: true, plateDisplay: true, nickname: true },
    });

    pages += 1;
    if (vehicles.length === 0) break;

    for (const vehicle of vehicles) {
      report.vehiclesConsidered += 1;
      try {
        const publications = await publicationsForVehicle(vehicle, today);
        const result = await publishVehicle(client, publications, discoveryPrefix);
        accumulate(report, result);
        report.vehiclesPublished += 1;
      } catch (error) {
        const reason = errorReason(error);
        report.failures.push({ vehicleId: vehicle.id, reason });
        logger.warn('não foi possível publicar um veículo', {
          job: MQTT_SYNC_JOB_NAME,
          vehicleId: vehicle.id,
          reason,
        });
      }
    }

    if (vehicles.length < pageSize) break;
    cursor = vehicles[vehicles.length - 1]?.id;
    if (cursor === undefined) break;
  }

  report.durationMs = elapsed(startedAt);
  logger.info('publicação MQTT concluída', {
    job: MQTT_SYNC_JOB_NAME,
    vehiclesConsidered: report.vehiclesConsidered,
    entitiesPublished: report.entitiesPublished,
    entitiesSkipped: report.entitiesSkipped,
    failures: report.failures.length,
    durationMs: report.durationMs,
  });
  return report;
}

interface VehicleRow {
  id: string;
  userId: string;
  plateDisplay: string;
  nickname: string | null;
}

/**
 * Monta as publicações de um veículo.
 *
 * Existe como função separada para que a ligação à analítica esteja num só sítio: o cálculo
 * (`loadVehicleAnalytics` + `buildStats`) e a extração dos valores que a publicação usa. O
 * `buildPublications` é quem decide disponibilidade; aqui só se lhe entrega o que a analítica
 * sabe, e nada se inventa quando não sabe (`null`).
 */
async function publicationsForVehicle(
  vehicle: VehicleRow,
  today: string,
): Promise<VehiclePublications> {
  const analytics = await loadVehicleAnalytics(vehicle.userId, vehicle.id);
  const stats = buildStats(analytics, { months: 12, today });

  return buildPublications({
    vehicleId: vehicle.id,
    plateDisplay: vehicle.plateDisplay,
    nickname: vehicle.nickname,
    odometerKm: odometerKmOf(vehicle.id, analytics),
    fuelL100Km: stats.consumption.fuelL100Km,
    energyKwh100Km: stats.consumption.energyKwh100Km,
    costPerKmCents: stats.unitCosts.costPerKmCents,
    nextServiceKm: null,
    inspectionDate: null,
    insuranceDate: null,
    socPercent: analytics.latestSocPercent,
    rangeEstimatedFromSoc: estimatedRangeKm(analytics),
  });
}

/** Quilometragem do veículo, ou `null` se nunca foi registada. */
function odometerKmOf(_vehicleId: string, analytics: VehicleAnalytics): number | null {
  return analytics.vehicle.odometerKm ?? null;
}

/**
 * Autonomia estimada a partir do estado de carga e da autonomia homologada.
 *
 * **A mesma conta** de `routes/integrations.ts`. Está duplicada — e é uma duplicação
 * assumida, não um descuido: a rota tem testes próprios e um contrato HTTP, e extrair a
 * função para aqui obrigaria a mexer nela. O que importa é que as duas produzem o mesmo
 * número; se um dia divergirem, o sintoma é o Home Assistant mostrar uma autonomia diferente
 * da que a interface do Zemlo mostra, e é por isso que o teste fixa o valor.
 */
function estimatedRangeKm(analytics: VehicleAnalytics): number | null {
  const soc = analytics.latestSocPercent;
  const nominal = analytics.vehicle.nominalRangeKm ?? null;
  if (soc === null || nominal === null) return null;
  return Math.round((nominal * soc) / 100);
}

function accumulate(report: MqttSyncReport, result: PublishReport): void {
  report.entitiesDiscovered += result.discovered;
  report.entitiesPublished += result.published;
  report.entitiesSkipped += result.skipped;
  for (const failure of result.failures) {
    report.failures.push({ vehicleId: '—', reason: `${failure.topic}: ${failure.reason}` });
  }
}

function elapsed(startedAt: bigint): number {
  return Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
}

/**
 * O núcleo como tarefa agendável, **condicionada ao cliente**.
 *
 * Ao contrário de `notificationSyncJob`, este objeto só existe quando há cliente: é a
 * função `mqttSyncJobFor(client)` e não uma constante, porque um trabalho agendado sem
 * cliente não é um trabalho — é uma passagem que não faz nada a intervalos regulares, e o
 * log encher-se-ia com "ignorada" para sempre. O `server.ts` decide, uma vez, se o
 * publicador existe.
 */
export function mqttSyncJobFor(client: MqttClient, options: Omit<MqttSyncOptions, 'client'> = {}): ScheduledJob {
  return {
    name: MQTT_SYNC_JOB_NAME,
    run: () => runMqttSync({ ...options, client }),
  };
}
