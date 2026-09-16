/**
 * Sugestões contextuais (§7, §6, §45).
 *
 * Decisão de arquitetura: as sugestões **não** são semeadas na base de dados. São
 * geradas em cada pedido a partir do estado real do veículo, e a base de dados guarda
 * apenas as decisões do utilizador sobre elas (`SuggestionState`).
 *
 * Porquê: semear sugestões obrigaria a uma migração de dados sempre que a lógica
 * mudasse, deixaria sugestões órfãs quando o utilizador apagasse o veículo que as
 * originou, e — o pior — voltaria a mostrar uma sugestão já concluída se o estado
 * guardado ficasse dessincronizado da realidade. Geradas a pedido, uma sugestão
 * desaparece no instante em que deixa de fazer sentido.
 *
 * Regras de comportamento (§7):
 *  - nunca bloqueiam;
 *  - podem ser adiadas;
 *  - desaparecem quando concluídas;
 *  - as de segurança podem reaparecer discretamente após um período de silêncio.
 */

import type { Suggestion, SuggestionType } from '@zemlo/shared';
import { addDays, optionIcon, todayIn, SUGGESTION_TYPES, type CivilDate } from '@zemlo/shared';
import { prisma } from '../core/db.js';
import { readJsonObject } from '../core/json.js';
import { needsSecurityNudge } from './notifications.js';

/* -------------------------------------------------------------------------- */
/* Chaves estáveis                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Chave de uma sugestão.
 *
 * O identificador tem de ser estável entre pedidos e entre versões da aplicação: é o
 * que liga uma sugestão à decisão que o utilizador tomou sobre ela. Prefixar com o
 * tipo e incluir o veículo garante que "guardar o seguro" do carro A não silencia
 * "guardar o seguro" do carro B.
 */
export function suggestionKey(type: SuggestionType, vehicleId?: string | null): string {
  return vehicleId ? `${type}:${vehicleId}` : type;
}

/* -------------------------------------------------------------------------- */
/* Geração                                                                     */
/* -------------------------------------------------------------------------- */

export interface SuggestionInput {
  userId: string;
  vehicle: {
    id: string;
    plateDisplay: string;
    odometerKm: number | null;
    fuelType: string;
    make: string | null;
    model: string | null;
    vin: string | null;
    year: number | null;
  } | null;
  counts: {
    expenses: number;
    fuelAndCharging: number;
    insurance: number;
    inspections: number;
    activeReminders: number;
    documents: number;
  };
  /** Categorias de despesa que o utilizador realmente usa (§45). */
  frequentCategories: string[];
  /** Quando `false`, o utilizador desligou as sugestões nas preferências (§7). */
  enabled: boolean;
  timeZone: string;
  /** Sugestões que já foram aceites uma vez; não voltam a aparecer. */
  completedKeys: Set<string>;
  /** Decisões de adiamento e silenciamento. */
  states: Map<string, { status: string; snoozedUntil: CivilDate | null; shownCount: number }>;
  /** `true` quando o utilizador tem 2FA ativo. */
  twoFactorEnabled: boolean;
  securityNudgeSnoozeDays: number;
  /** Última vez que a sugestão de segurança foi mostrada. */
  securityNudgeSnoozedUntil: CivilDate | null;
  accountCreatedAt: Date;
}

/**
 * Gera a lista de sugestões aplicáveis.
 *
 * A ordem é determinística e reflete o valor para o utilizador: primeiro o que
 * desbloqueia cálculos (quilometragem), depois o que evita uma surpresa (seguro,
 * inspeção), depois o que reduz esforço (plano de manutenção), depois a segurança.
 */
export function generateSuggestions(input: SuggestionInput): Suggestion[] {
  if (!input.enabled) return [];

  const today = todayIn(input.timeZone);
  const suggestions: Suggestion[] = [];

  const push = (
    type: SuggestionType,
    vehicleId: string | null,
    content: Omit<Suggestion, 'id' | 'type' | 'vehicleId' | 'dismissibleForever' | 'priority'>,
    priority: number,
    dismissibleForever = true,
  ): void => {
    const key = suggestionKey(type, vehicleId);
    if (input.completedKeys.has(key)) return;

    const state = input.states.get(key);
    if (state) {
      if (state.status === 'never' || state.status === 'dismissed' || state.status === 'done') return;
      if (state.status === 'snoozed' && state.snoozedUntil !== null && state.snoozedUntil > today) return;
    }

    suggestions.push({
      id: key,
      type,
      vehicleId,
      dismissibleForever,
      priority,
      ...content,
    });
  };

  if (input.vehicle) {
    const vehicleId = input.vehicle.id;
    const name = input.vehicle.plateDisplay;

    // 1. Quilometragem: sem ela, custo/km, lembretes por distância e projeções ficam
    //    todos indisponíveis. É a sugestão com maior efeito de rede (§3.3).
    if (input.vehicle.odometerKm === null) {
      push(
        'vehicle.add_odometer',
        vehicleId,
        {
          title: 'Quilometragem em falta',
          body: `Adiciona a quilometragem do ${name} para começares a acompanhar os custos por km.`,
          actionLabel: 'Adicionar quilometragem',
          actionHref: `/vehicles/${vehicleId}?sheet=odometer`,
        },
        10,
      );
    }

    // 2. Seguro: um seguro esquecido é uma surpresa caro e, em Portugal, conduzir sem
    //    seguro é uma contraordenação grave.
    if (input.counts.insurance === 0) {
      push(
        'vehicle.add_insurance',
        vehicleId,
        {
          title: 'Falta apenas o seguro',
          body: `Guarda a apólice do ${name} e avisamos-te antes da renovação.`,
          actionLabel: 'Guardar seguro',
          actionHref: `/vehicles/${vehicleId}?sheet=insurance`,
        },
        20,
      );
    }

    // 3. Inspeção.
    if (input.counts.inspections === 0) {
      push(
        'vehicle.add_inspection',
        vehicleId,
        {
          title: 'Inspeção por registar',
          body: `Regista a última inspeção do ${name} e lembramos-te da próxima na altura certa.`,
          actionLabel: 'Registar inspeção',
          actionHref: `/vehicles/${vehicleId}?sheet=inspection`,
        },
        30,
      );
    }

    // 4. Plano de manutenção: só faz sentido depois de haver quilometragem, porque o
    //    lembrete por distância precisa dela para ser calculado (§16).
    if (input.counts.activeReminders === 0 && input.vehicle.odometerKm !== null) {
      push(
        'vehicle.add_maintenance_plan',
        vehicleId,
        {
          title: 'Próxima revisão',
          body: `Define quando é a próxima revisão do ${name} — por quilómetros, por tempo, ou o que ocorrer primeiro.`,
          actionLabel: 'Definir próxima revisão',
          actionHref: `/vehicles/${vehicleId}?sheet=reminder`,
        },
        40,
      );
    }

    // 5. Ficha do veículo: utilidade real quando o utilizador já usa a aplicação.
    const detailsMissing = input.vehicle.make === null || input.vehicle.year === null;
    if (detailsMissing && input.counts.expenses >= 3) {
      push(
        'vehicle.add_details',
        vehicleId,
        {
          title: 'Ficha do veículo',
          body: `Com a marca e o ano do ${name}, os relatórios ficam mais completos e a depreciação passa a fazer sentido.`,
          actionLabel: 'Completar ficha',
          actionHref: `/vehicles/${vehicleId}?sheet=details`,
        },
        60,
      );
    }

    // 6. Documentos, sugerido apenas depois de o utilizador já registar atividade.
    if (input.counts.documents === 0 && input.counts.expenses >= 3) {
      push(
        'documents.add_first',
        vehicleId,
        {
          title: 'Documentos do veículo',
          body: 'Guarda o Documento Único Automóvel, faturas e certificados. Ficam todos no mesmo sítio.',
          actionLabel: 'Guardar documento',
          actionHref: `/vehicles/${vehicleId}?sheet=document`,
        },
        70,
      );
    }
  }

  // 7. Km numa despesa: existe depois de o utilizador já ter despesas.
  if (input.counts.expenses > 0 && input.vehicle !== null && input.vehicle.odometerKm === null) {
    // Já coberto pela sugestão de quilometragem; não duplicar ruído.
  } else if (input.counts.expenses > 0 && input.frequentCategories.includes('fuel')) {
    const key = 'expense.add_odometer';
    const state = input.states.get(key);
    const alreadyHandled =
      input.completedKeys.has(key) ||
      state?.status === 'never' ||
      state?.status === 'dismissed' ||
      (state?.status === 'snoozed' && state.snoozedUntil !== null && state.snoozedUntil > today);

    if (!alreadyHandled && input.counts.expenses >= 2) {
      suggestions.push({
        id: key,
        type: 'expense.add_odometer',
        vehicleId: null,
        title: 'Custo por km mais preciso',
        body: 'Se registares a quilometragem nos abastecimentos, calculamos o custo por km com precisão.',
        actionLabel: 'Ver abastecimentos',
        actionHref: '/records/fuel',
        dismissibleForever: true,
        priority: 65,
      });
    }
  }

  // 8. Segurança (2FA). Só depois de a conta ter conteúdo — pedir 2FA a alguém que
  //    acabou de criar conta é fricção sem contrapartida (§3.1).
  const accountAgeDays = Math.floor((Date.now() - input.accountCreatedAt.getTime()) / 86_400_000);
  if (!input.twoFactorEnabled && (input.counts.expenses >= 1 || accountAgeDays >= 7)) {
    const key = suggestionKey('account.enable_2fa');
    const state = input.states.get(key);
    const completed = input.completedKeys.has(key);
    const snoozedUntil = state?.snoozedUntil ?? input.securityNudgeSnoozedUntil;
    const silenced = state?.status === 'dismissed' || state?.status === 'never';
    // A segurança é a exceção à regra do "nunca mostrar novamente": reaparece após o
    // período de silêncio, porque o risco continua a existir (§7).
    const nudgeDue = needsSecurityNudge(snoozedUntil, today);

    if (!completed && !silenced && nudgeDue) {
      suggestions.push({
        id: key,
        type: 'account.enable_2fa',
        vehicleId: null,
        title: 'Protege a tua conta',
        body: 'Uma app autenticadora impede que alguém entre na tua conta mesmo que descubra a password.',
        actionLabel: 'Ativar verificação em dois passos',
        actionHref: '/settings/security',
        dismissibleForever: false,
        priority: 80,
      });
    }
  }

  return suggestions.sort((a, b) => a.priority - b.priority);
}

/* -------------------------------------------------------------------------- */
/* Persistência das decisões                                                   */
/* -------------------------------------------------------------------------- */

export interface SuggestionDecisionInput {
  action: 'done' | 'dismiss' | 'snooze' | 'never';
  snoozeDays: number;
}

/**
 * Registra a decisão do utilizador sobre uma sugestão.
 *
 * Guardamos um contador de apresentações porque o Zemlo não deve insistir: se uma
 * sugestão foi mostrada dez vezes sem ser aceite, a probabilidade de a mostrar uma
 * décima primeira vez ajudar é baixa e o custo em confiança é real (§7).
 */
export async function recordSuggestionDecision(
  userId: string,
  key: string,
  input: SuggestionDecisionInput,
  timeZone: string,
): Promise<void> {
  const today = todayIn(timeZone);
  const status =
    input.action === 'done'
      ? 'done'
      : input.action === 'never'
        ? 'never'
        : input.action === 'snooze'
          ? 'snoozed'
          : 'dismissed';

  const type = key.split(':')[0] ?? key;
  const vehicleId = key.includes(':') ? key.split(':').slice(1).join(':') : null;

  await prisma.suggestionState.upsert({
    where: { userId_key: { userId, key } },
    create: {
      userId,
      key,
      type,
      vehicleId,
      status,
      snoozedUntil: input.action === 'snooze' ? new Date(`${addDays(today, input.snoozeDays)}T00:00:00.000Z`) : null,
      actedAt: input.action === 'done' ? new Date() : null,
      lastShownAt: new Date(),
      shownCount: 1,
    },
    update: {
      status,
      snoozedUntil: input.action === 'snooze' ? new Date(`${addDays(today, input.snoozeDays)}T00:00:00.000Z`) : null,
      actedAt: input.action === 'done' ? new Date() : null,
    },
  });
}

/** Carrega o estado guardado das sugestões de um utilizador. */
export async function loadSuggestionState(userId: string): Promise<{
  completedKeys: Set<string>;
  states: Map<string, { status: string; snoozedUntil: CivilDate | null; shownCount: number }>;
}> {
  const rows = await prisma.suggestionState.findMany({ where: { userId }, take: 500 });
  const completedKeys = new Set<string>();
  const states = new Map<string, { status: string; snoozedUntil: CivilDate | null; shownCount: number }>();

  for (const row of rows) {
    if (row.status === 'done') completedKeys.add(row.key);
    states.set(row.key, {
      status: row.status,
      snoozedUntil: row.snoozedUntil ? row.snoozedUntil.toISOString().slice(0, 10) : null,
      shownCount: row.shownCount,
    });
  }

  return { completedKeys, states };
}

/** Ícone e etiqueta de um tipo de sugestão, para a interface. */
export function describeSuggestionType(type: SuggestionType): { label: string; icon: string } {
  const found = SUGGESTION_TYPES.find((option) => option.code === type);
  return {
    label: found?.label ?? 'Sugestão',
    icon: found ? optionIcon(SUGGESTION_TYPES, type) : '•',
  };
}

/** Lê os campos que o utilizador escondeu, para não os apresentar (§45). */
export async function hiddenFieldsFor(userId: string): Promise<string[]> {
  const preferences = await prisma.userPreference.findUnique({ where: { userId } });
  const raw = readJsonObject<{ fields?: string[] }>(preferences?.hiddenFields);
  const fields = Array.isArray(raw.fields) ? raw.fields : [];
  return fields.filter((field): field is string => typeof field === 'string');
}
