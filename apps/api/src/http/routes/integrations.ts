/**
 * Rotas de integrações (§26, §27, §28) e Home Assistant.
 *
 * O que está implementado no MVP e o que não está — dito sem rodeios:
 *
 *  - **Implementado**: o registo de integrações, o cofre de credenciais cifradas, o
 *    catálogo de entidades do Home Assistant com a especificação de que dados cada uma
 *    exige, e o estado de sincronização.
 *  - **Não implementado**: a publicação efetiva por MQTT e a ligação às APIs de
 *    fabricantes. Ambas exigem credenciais e infraestrutura que não existem num
 *    ambiente de desenvolvimento, e a especificação é explícita em não fazer engenharia
 *    reversa nem inventar dados (§26, §48).
 *
 * O endpoint `GET /integrations/home-assistant/spec` devolve a especificação completa
 * das entidades — quais estão disponíveis com os dados atuais e o que falta para as
 * outras. É a informação de que o utilizador precisa, apresentada como progresso e não
 * como erro (§6, §59).
 */

import { Router } from 'express';
import type { HomeAssistantSpec } from '@zemlo/shared';
import { PRODUCT, zIntegrationCreateRequest, zIntegrationUpdateRequest } from '@zemlo/shared';
import { asyncHandler, created, noContent, parseBody, requireUser } from '../../http/handlers.js';
import { requireAuth } from '../../http/middleware.js';
import { config } from '../../core/config.js';
import { prisma } from '../../core/db.js';
import { conflict, notFound, unprocessable } from '../../core/errors.js';
import { encryptJson, secretsAvailable } from '../../core/crypto.js';
import { writeJson, jsonOrNull } from '../../core/json.js';
import { logger } from '../../core/logger.js';
import { mapIntegration } from '../../domain/payload.js';
import { audit } from '../../services/audit.js';
import { buildStats, loadVehicleAnalytics, type VehicleAnalytics } from '../../services/analytics.js';
import { today } from '../../http/middleware.js';

/**
 * Converte um caminho com `:parametros` numa expressão regular ancorada.
 *
 * Ancorada nas duas pontas de propósito: `/dashboard` corresponde a `/dashboard` e não a
 * `/dashboard-x`, que é um endereço diferente e inexistente.
 */
function toRouteRegExp(route: string): RegExp {
  const source = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z0-9_]+/g, '[^/]+');
  return new RegExp('^' + source + '$');
}

export const integrationsRouter = Router();

/*
 * Autenticação com correspondência **exata** de rota.
 *
 * Só se aplica aos endereços que este router realmente serve, e é isso que torna a
 * distinção entre 401 e 404 previsível:
 *
 *  - endereço que não existe  -> **404**, com ou sem token;
 *  - endereço que existe sem autenticação -> **401**.
 *
 * Um `use(requireAuth())` sem âmbito correria para tudo e devolveria 401 num endereço
 * inexistente. Com prefixos, `/dashboard-x` receberia 401 por começar como um prefixo
 * conhecido. A correspondência exata elimina as duas ambiguidades.
 *
 * Os caminhos são declarados como texto e convertidos uma única vez aqui: uma expressão
 * regular escrita à mão precisa de escapar as barras, e um erro desses deixa o ficheiro
 * com sintaxe inválida.
 */
const integrationsRouterAuth = [
  '/integrations',
  '/integrations/:integrationId',
  '/integrations/home-assistant/spec',
].map(toRouteRegExp);

integrationsRouter.use((request, response, next) => {
  const belongsHere = integrationsRouterAuth.some((pattern) => pattern.test(request.path));
  if (!belongsHere) {
    next();
    return;
  }
  requireAuth()(request, response, next);
});

/* -------------------------------------------------------------------------- */
/* CRUD                                                                        */
/* -------------------------------------------------------------------------- */

integrationsRouter.get(
  '/integrations',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const rows = await prisma.integration.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    const items = rows.map(mapIntegration);
    response.json({ items, total: items.length });
  }),
);

integrationsRouter.post(
  '/integrations',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zIntegrationCreateRequest, request);

    if (body.vehicleId) {
      const vehicle = await prisma.vehicle.findFirst({
        where: { id: body.vehicleId, userId: user.id },
        select: { id: true },
      });
      if (!vehicle) throw notFound('Não encontrámos esse veículo.');
    }

    // Credenciais cifradas em repouso (§30). Sem chave de cifragem configurada,
    // recusamos em vez de guardar segredos em claro — guardá-los seria pior do que
    // não ter a funcionalidade.
    let credentials: string | null = null;
    if (body.credentials && Object.keys(body.credentials).length > 0) {
      if (!secretsAvailable()) {
        throw unprocessable(
          'As credenciais desta integração precisam de uma chave de cifragem configurada no servidor. Define ENCRYPTION_KEY.',
        );
      }
      credentials = encryptJson(body.credentials);
    }

    const existing = await prisma.integration.findFirst({
      where: { userId: user.id, category: body.category, provider: body.provider, vehicleId: body.vehicleId ?? null },
    });
    if (existing) throw conflict('Já tens uma integração igual configurada.');

    const integration = await prisma.integration.create({
      data: {
        userId: user.id,
        vehicleId: body.vehicleId ?? null,
        category: body.category,
        provider: body.provider,
        label: body.label ?? null,
        enabled: body.enabled ?? true,
        config: jsonOrNull(body.config ?? null),
        credentials: jsonOrNull(credentials),
        scopes: writeJson(['read']),
      },
    });

    await audit('integration.created', {
      userId: user.id,
      entityType: 'integration',
      entityId: integration.id,
      metadata: { categoria: body.category, fornecedor: body.provider },
    });

    created(response, `/api/v1/integrations/${integration.id}`, mapIntegration(integration));
  }),
);

integrationsRouter.patch(
  '/integrations/:integrationId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const body = parseBody(zIntegrationUpdateRequest, request);
    const existing = await prisma.integration.findFirst({
      where: { id: request.params.integrationId ?? '', userId: user.id },
    });
    if (!existing) throw notFound('Não encontrámos essa integração.');

    const data: Record<string, unknown> = {};
    if (body.label !== undefined) data.label = body.label;
    if (body.enabled !== undefined) data.enabled = body.enabled;
    if (body.config !== undefined) data.config = writeJson(body.config);
    if (body.vehicleId !== undefined) {
      /*
       * Verificar a propriedade do veículo também na atualização.
       *
       * A criação já o fazia; a atualização não, e aceitava o identificador de um veículo
       * de outra conta. Além de quebrar o isolamento entre contas que o resto da API
       * impõe, isso transformava o endpoint num oráculo de existência: um veículo alheio
       * devolvia 200 e um inexistente devolvia 400, o que permitia descobrir quais os
       * identificadores que existem — numa API que deliberadamente torna "não é teu" e
       * "não existe" indistinguíveis.
       */
      if (body.vehicleId === null) {
        data.vehicleId = null;
      } else {
        const vehicle = await prisma.vehicle.findFirst({
          where: { id: body.vehicleId, userId: user.id },
          select: { id: true },
        });
        if (!vehicle) throw notFound('Não encontrámos esse veículo.');
        data.vehicleId = body.vehicleId;
      }
    }
    if (body.credentials !== undefined) {
      if (!secretsAvailable()) {
        throw unprocessable('As credenciais precisam de uma chave de cifragem configurada no servidor.');
      }
      data.credentials = encryptJson(body.credentials);
    }

    const integration = await prisma.integration.update({
      where: { id: existing.id },
      data,
    });

    await audit('integration.updated', {
      userId: user.id,
      entityType: 'integration',
      entityId: integration.id,
      metadata: { campos: Object.keys(data) },
    });

    response.json(mapIntegration(integration));
  }),
);

integrationsRouter.delete(
  '/integrations/:integrationId',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const existing = await prisma.integration.findFirst({
      where: { id: request.params.integrationId ?? '', userId: user.id },
    });
    if (!existing) throw notFound('Não encontrámos essa integração.');

    await prisma.integration.delete({ where: { id: existing.id } });
    await audit('integration.deleted', {
      userId: user.id,
      entityType: 'integration',
      entityId: existing.id,
    });
    noContent(response);
  }),
);

/* -------------------------------------------------------------------------- */
/* Home Assistant (§27, §28)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Especificação das entidades do Home Assistant.
 *
 * Cada entidade declara o requisito de dados em linguagem de produto e se está
 * disponível agora. É por isso que a integração funciona mesmo com um veículo que só
 * tem matrícula e quilometragem (§27): as entidades aparecem à medida que os dados
 * existem, e o utilizador vê exatamente o que ganha ao acrescentar mais informação.
 */
integrationsRouter.get(
  '/integrations/home-assistant/spec',
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const vehicleId = typeof request.query.vehicleId === 'string' ? request.query.vehicleId : undefined;

    const vehicles = await prisma.vehicle.findMany({
      where: { userId: user.id, archived: false, ...(vehicleId ? { id: vehicleId } : {}) },
      select: { id: true, plateDisplay: true, odometerKm: true, fuelType: true, rangeKm: true },
    });
    if (vehicles.length === 0) throw notFound('Não encontrámos esse veículo.');

    const focus = vehicles[0];
    const analytics = focus ? await loadVehicleAnalytics(user.id, focus.id) : null;
    const stats = analytics
      ? buildStats(analytics, { months: 12, today: today(request) })
      : null;

    const spec = buildHomeAssistantSpec({
      plateDisplay: focus?.plateDisplay ?? 'car',
      hasOdometer: (focus?.odometerKm ?? null) !== null,
      hasFuelConsumption: stats?.consumption.fuelL100Km !== null && stats?.consumption.fuelL100Km !== undefined,
      hasEnergyConsumption:
        stats?.consumption.energyKwh100Km !== null && stats?.consumption.energyKwh100Km !== undefined,
      hasCostPerKm: (stats?.unitCosts.costPerKmCents ?? null) !== null,
      hasNextService: (analytics?.counts.activeReminders ?? 0) > 0,
      hasInspection: (analytics?.counts.inspections ?? 0) > 0,
      hasInsurance: (analytics?.counts.insurance ?? 0) > 0,
      socPercent: lastSocPercent(analytics),
      rangeEstimatedFromSoc: estimatedRangeKm(analytics),
      mqttConfigured: config.homeAssistant.enabled,
    });

    response.json(spec);
  }),
);

/**
 * Estado de carga mais recente registado.
 *
 * O Zemlo não fala com o carro: a única medição honesta de bateria é o valor que o
 * utilizador registou no último carregamento. Publicar um `sensor.zemlo_car_battery`
 * sem isto significaria inventar um valor (§48), e o Home Assistant passaria a mostrar um
 * número que não corresponde ao veículo.
 */
function lastSocPercent(analytics: VehicleAnalytics | null): number | null {
  return analytics?.latestSocPercent ?? null;
}

/**
 * Autonomia estimada a partir do estado de carga e da autonomia homologada.
 *
 * É uma proporção linear, e é apresentada como estimativa — a autonomia real depende da
 * temperatura, do relevo e do tipo de condução. Uma proporção linear é a aproximação mais
 * defensável sem telemetria, e a interface diz que é uma estimativa.
 */
function estimatedRangeKm(analytics: VehicleAnalytics | null): number | null {
  const soc = lastSocPercent(analytics);
  const nominal = analytics?.vehicle.nominalRangeKm ?? null;
  if (soc === null || nominal === null) return null;
  return Math.round((nominal * soc) / 100);
}

interface HomeAssistantSpecInput {
  plateDisplay: string;
  hasOdometer: boolean;
  hasFuelConsumption: boolean;
  hasEnergyConsumption: boolean;
  hasCostPerKm: boolean;
  hasNextService: boolean;
  hasInspection: boolean;
  hasInsurance: boolean;
  socPercent: number | null;
  rangeEstimatedFromSoc: number | null;
  mqttConfigured: boolean;
}

function buildHomeAssistantSpec(input: HomeAssistantSpecInput): HomeAssistantSpec {
  const slug = 'car';
  const prefix = config.homeAssistant.discoveryPrefix;
  const stateTopic = `zemlo/${slug}/state`;

  const entities: HomeAssistantSpec['entities'] = [
    {
      entityId: `sensor.zemlo_${slug}_odometer`,
      name: 'Quilometragem',
      component: 'sensor',
      deviceClass: 'distance',
      unitOfMeasurement: 'km',
      stateClass: 'total_increasing',
      requires: 'Quilometragem registada no Zemlo.',
      available: input.hasOdometer,
    },
    {
      entityId: `sensor.zemlo_${slug}_consumption`,
      name: 'Consumo',
      component: 'sensor',
      deviceClass: null,
      unitOfMeasurement: 'L/100 km',
      stateClass: 'measurement',
      requires: 'Dois abastecimentos com depósito cheio e quilometragem.',
      available: input.hasFuelConsumption,
    },
    {
      entityId: `sensor.zemlo_${slug}_energy_consumption`,
      name: 'Consumo elétrico',
      component: 'sensor',
      deviceClass: null,
      unitOfMeasurement: 'kWh/100 km',
      stateClass: 'measurement',
      requires: 'Dois carregamentos com quilometragem.',
      available: input.hasEnergyConsumption,
    },
    {
      entityId: `sensor.zemlo_${slug}_cost_per_km`,
      name: 'Custo por km',
      component: 'sensor',
      deviceClass: 'monetary',
      unitOfMeasurement: 'EUR',
      stateClass: 'measurement',
      requires: 'Despesas registadas e quilometragem suficiente para calcular a distância.',
      available: input.hasCostPerKm,
    },
    {
      entityId: `sensor.zemlo_${slug}_next_service`,
      name: 'Próxima manutenção',
      component: 'sensor',
      deviceClass: null,
      unitOfMeasurement: 'km',
      stateClass: null,
      requires: 'Um lembrete de manutenção ativo.',
      available: input.hasNextService,
    },
    {
      entityId: `sensor.zemlo_${slug}_inspection`,
      name: 'Próxima inspeção',
      component: 'sensor',
      deviceClass: 'date',
      unitOfMeasurement: null,
      stateClass: null,
      requires: 'Inspeção registada com próxima data.',
      available: input.hasInspection,
    },
    {
      entityId: `sensor.zemlo_${slug}_insurance`,
      name: 'Fim do seguro',
      component: 'sensor',
      deviceClass: 'date',
      unitOfMeasurement: null,
      stateClass: null,
      requires: 'Apólice de seguro registada.',
      available: input.hasInsurance,
    },
    {
      entityId: `sensor.zemlo_${slug}_battery`,
      name: 'Estado de carga',
      component: 'sensor',
      deviceClass: 'battery',
      unitOfMeasurement: '%',
      stateClass: 'measurement',
      requires:
        'Estado de carga final registado num carregamento. Não é uma leitura em tempo real: tem a data do último carregamento, porque o Zemlo não fala com o carro.',
      available: input.socPercent !== null,
    },
    {
      entityId: `sensor.zemlo_${slug}_range`,
      name: 'Autonomia estimada',
      component: 'sensor',
      deviceClass: 'distance',
      unitOfMeasurement: 'km',
      stateClass: 'measurement',
      requires:
        'Estado de carga registado e autonomia homologada na ficha do veículo. É uma estimativa proporcional, não uma medição.',
      available: input.rangeEstimatedFromSoc !== null,
    },
    {
      entityId: `binary_sensor.zemlo_${slug}_charging`,
      name: 'A carregar',
      component: 'binary_sensor',
      deviceClass: 'battery_charging',
      unitOfMeasurement: null,
      stateClass: null,
      requires:
        'Exige telemetria em tempo real do veículo ou da wallbox. Com registos manuais o Zemlo não sabe se o carro está a carregar neste momento — e não o vai adivinhar.',
      available: false,
    },
    {
      entityId: `device_tracker.zemlo_${slug}`,
      name: 'Localização do veículo',
      component: 'device_tracker',
      deviceClass: null,
      unitOfMeasurement: null,
      stateClass: null,
      requires:
        'Exige localização em tempo real, que o Zemlo não recolhe. Registar a posição de um posto de abastecimento não é o mesmo que seguir o veículo, e tratá-lo como tal seria uma invasão de privacidade disfarçada de funcionalidade.',
      available: false,
    },
  ];

  const instructions: string[] = [
    'No Zemlo: Definições → Integrações → Home Assistant, e copia o token de acesso.',
    'No Home Assistant: Definições → Dispositivos e serviços → Adicionar integração → Zemlo.',
    'Cola o token, escolhe o veículo e termina. Não precisas de configurar MQTT, OAuth nem webhooks à mão.',
  ];

  // Ser explícito sobre o que não está disponível é mais útil do que omitir a entidade:
  // o utilizador percebe que o Zemlo sabe o que faria com esses dados e o que lhe falta
  // para os ter, em vez de concluir que a integração está incompleta (§6, §27).
  const unavailable = entities.filter((entity) => !entity.available);
  if (unavailable.length > 0) {
    instructions.push(
      `${unavailable.length} ${unavailable.length === 1 ? 'entidade ainda não está disponível' : 'entidades ainda não estão disponíveis'} com os dados atuais. O Zemlo explica o que falta a cada uma; nenhuma aparece no Home Assistant com um valor inventado.`,
    );
  }

  if (!input.mqttConfigured) {
    instructions.push(
      'O servidor do Zemlo ainda não tem um broker MQTT configurado. As entidades ficam listadas mas só passam a publicar estado depois de configurar HA_MQTT_URL.',
    );
  }

  return {
    discoveryVersion: 1,
    discoveryPrefix: prefix,
    stateTopic,
    entities,
    instructions,
  };
}

/* -------------------------------------------------------------------------- */
/* Exportação (§54)                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Rotas de exportação — **dois artefactos diferentes, dois endereços diferentes**.
 *
 * ## Porque é que o bundle nativo não substituiu `GET /export`
 *
 * As duas rotas exportam "os dados do utilizador", e é precisamente por isso que a
 * tentação de as fundir é grande. A §54 descreve a exportação legada como um JSON achatado
 * e um CSV para folha de cálculo — um formato **de leitura**, sem `localId`, sem
 * referências normalizadas, sem `manifest`. O bundle nativo (§5.2) é outra coisa: um ZIP
 * com `manifest.json`, `.jsonl` por tipo e os bytes dos documentos, pensado para ser
 * **reimportado** com fidelidade total (§3.1).
 *
 * Confundi-los teria dois efeitos, ambos maus:
 *
 *  1. o `ExportPage` passaria a oferecer um ZIP onde o utilizador espera um JSON para
 *     abrir numa ferramenta, e vice-versa;
 *  2. os consumidores existentes de `GET /export` — a interface, o `verify`, o
 *     `verify:integration` e o `verify:auth` — verificam a **forma** do JSON legado
 *     (`meta.formatVersion === 1`, `vehicles.length === 2`, o BOM do CSV) e deixariam de
 *     passar. Não é uma questão de gosto: é um contrato em uso.
 *
 * O bundle nativo ganha, por isso, um endereço próprio: `GET /export/bundle`.
 *
 * ## Porque é que o caminho é `/export/bundle`
 *
 * O sufixo nomeia o **artefacto**, com o vocabulário que o resto do código já usa
 * (`export-bundle.ts`, `domain/import/bundle.ts`, `readBundle`, `manifest.bundleId`).
 * `/export/native` descreveria a implementação em vez do resultado, e `/bundle` sozinho
 * perderia a associação a "levar os meus dados", que é a pergunta a que esta família de
 * rotas responde.
 *
 * ## A autenticação é a mesma, e é exacta
 *
 * Os dois caminhos estão na lista abaixo e ambos passam pelo mesmo `requireAuth()`. A
 * correspondência é **exacta** pelo motivo explicado em `vehicles.ts`: um `use()` sem
 * âmbito devolveria 401 num endereço inexistente, e um prefixo faria `/export-x` parecer
 * autenticado. Um caminho novo tem de ser acrescentado à lista — e é isso que torna o
 * esquecimento um erro visível, não uma porta aberta.
 */
export const exportRouter = Router();

/**
 * Caminho da exportação legada (§54): JSON achatado ou CSV.
 *
 * Declarado como constante porque o guarda de autenticação e a rota têm de concordar sobre
 * ele, e uma divergência entre os dois seria uma rota sem autenticação.
 */
const LEGACY_EXPORT_PATH = '/export';

/** Caminho do bundle nativo (§5.2, §13): ZIP reimportável. */
const NATIVE_EXPORT_PATH = '/export/bundle';

// Ver a nota sobre autenticação com correspondência exata em `vehicles.ts`.
exportRouter.use((request, response, next) => {
  if (request.path !== LEGACY_EXPORT_PATH && request.path !== NATIVE_EXPORT_PATH) {
    next();
    return;
  }
  requireAuth()(request, response, next);
});

/**
 * Exporta todos os dados do utilizador.
 *
 * `Content-Disposition: attachment` com um nome de ficheiro datado, para que uma
 * transferência no browser não seja confundida com uma página. O download é registado
 * em auditoria: é uma operação sobre dados pessoais e o utilizador tem de a poder
 * identificar mais tarde (§30, §56).
 */
exportRouter.get(
  LEGACY_EXPORT_PATH,
  asyncHandler(async (request, response) => {
    const user = requireUser(request);
    const format = request.query.format === 'csv' ? 'csv' : 'json';

    const { buildExportBundle, bundleToCsv, exportFileName } = await import('../../services/export.js');
    const bundle = await buildExportBundle(user.id, {
      format,
      vehicleId: typeof request.query.vehicleId === 'string' ? request.query.vehicleId : undefined,
      from: typeof request.query.from === 'string' ? request.query.from : undefined,
      to: typeof request.query.to === 'string' ? request.query.to : undefined,
    });

    const fileName = exportFileName(format, today(request));
    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    if (format === 'csv') {
      response.type('text/csv; charset=utf-8').send(bundleToCsv(bundle));
      return;
    }

    response.type('application/json; charset=utf-8').send(JSON.stringify(bundle, null, 2));
    logger.info('exportação de dados concluída', { userId: user.id, formato: format });
  }),
);

/**
 * Exporta o **bundle nativo** — o ZIP que `POST /import/preview` já sabe ler.
 *
 * ## O que esta rota é, e o que não é
 *
 * É a metade que faltava do ciclo da §13: `buildBundle` e `writeZip` existiam, estavam
 * testados (`import-export-cycle.test.ts`), e não tinham **nenhum consumidor de produção**.
 * Um utilizador não conseguia obter o formato que o importador aceita — a exportação
 * devolvia JSON e CSV, e nenhum dos dois é um bundle. Esta rota fecha esse circuito sem
 * construir um segundo escritor: chama os dois serviços que já existem, na ordem em que os
 * testes os exercitam.
 *
 * ## O que garante a compatibilidade com o leitor
 *
 * Nada aqui decide o formato. `buildBundle` produz as entradas a partir do contrato do
 * bundle, e `writeZip` escreve-as cumprindo os invariantes que `readZip` verifica. A
 * garantia de que o resultado atravessa o leitor sem uma alteração neste não é uma
 * promessa desta rota — é uma propriedade dos dois serviços, provada pela §13.2. A rota
 * limita-se a não a estragar: não reescreve entradas, não as reordena, não as recomprime.
 *
 * ## Os filtros
 *
 * Só `vehicleId`, e de propósito. O bundle nativo tem referências entre registos
 * (`localId`) e um âmbito temporal exigiria decidir o que fazer com um documento cujo
 * veículo está fora da janela, ou com um lembrete que aponta para uma leitura omitida —
 * decisões de produto que a §5.7 não toma e que não se inventam aqui. O âmbito por veículo
 * é o que a §5.7 permite, e é declarado no `manifest` para que um bundle filtrado nunca
 * seja confundido com um bundle incompleto.
 *
 * ## O `skipDocumentBytes` não é usado
 *
 * O armazenamento de produção (`documentStorage()`) é passado sempre. A opção de omitir os
 * bytes existe para o caso de o armazenamento não estar disponível, e nesse caso
 * `buildBundle` **declara** os documentos como `missingContent` em vez de os esconder. Uma
 * exportação nunca pode falhar por causa de um anexo (§5.6), e é por isso que a ausência
 * de um ficheiro é um campo do resultado e não uma excepção — mas omitir os bytes quando o
 * armazenamento existe seria exportar menos do que o utilizador pediu.
 *
 * ## A auditoria
 *
 * Registada como a exportação legada, com o tipo de artefacto explícito: distinguir as
 * duas no registo é o que permite responder mais tarde à pergunta "que exportação foi
 * esta?" sem inferir do tamanho (§30, §56).
 */
exportRouter.get(
  NATIVE_EXPORT_PATH,
  asyncHandler(async (request, response) => {
    const user = requireUser(request);

    const [{ buildBundle }, { writeZip }, { documentStorage }] = await Promise.all([
      import('../../services/export-bundle.js'),
      import('../../domain/import/zip-writer.js'),
      import('../../services/document-storage.js'),
    ]);

    const bundle = await buildBundle({
      userId: user.id,
      prisma,
      // A versão da aplicação e o ambiente vão para `manifest.createdBy`: são o que
      // permite, mais tarde, perceber com que versão do Zemlo este bundle foi escrito.
      appVersion: config.version,
      environment: config.nodeEnv,
      today: today(request),
      // O âmbito por veículo (§5.7). Ausente, exporta a conta inteira.
      ...(typeof request.query.vehicleId === 'string' ? { vehicleId: request.query.vehicleId } : {}),
      storage: documentStorage(),
    });

    const bytes = writeZip(bundle.entries);

    /*
     * O nome do ficheiro segue a convenção do legado — `zemlo-export-<data>.<ext>` — e
     * acrescenta `bundle`, para que dois ficheiros descarregados no mesmo dia não sejam
     * indistinguíveis na pasta de transferências do utilizador. É a diferença entre os dois
     * formatos que o utilizador precisa de reconhecer, e o nome do ficheiro é onde ele a vê
     * primeiro.
     *
     * O produto vem de `PRODUCT.name` e não de um literal: o legado usa `zemlo-` escrito à
     * mão, e repeti-lo aqui criaria uma segunda fonte para o nome do produto — a primeira
     * vez que divergissem, os dois ficheiros deixariam de partilhar o prefixo que os
     * agrupa.
     */
    const fileName = `${PRODUCT.name.toLowerCase()}-bundle-${today(request)}.zip`;
    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    response.type('application/zip');

    /*
     * Os bytes vão tal como saíram do escritor. `writeZip` devolve um `Uint8Array` sobre o
     * buffer que construiu; o `send` do Express envia-o sem conversão, o que é o que
     * preserva o CRC calculado sobre os bytes reais. Qualquer normalização aqui —
     * reencodar, juntar, cortar — invalidaria o arquivo que o leitor valida.
     */
    response.send(Buffer.from(bytes));

    logger.info('exportação do bundle nativo concluída', {
      userId: user.id,
      artefacto: 'bundle',
      entradas: bundle.entries.length,
      documentosSemConteudo: bundle.missingContent.length,
      bytes: bytes.byteLength,
    });
  }),
);
