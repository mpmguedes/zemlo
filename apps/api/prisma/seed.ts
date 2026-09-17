/**
 * Seed de desenvolvimento.
 *
 * Duas contas, com propósitos diferentes:
 *
 *  - `demo@zemlo.pt` — **a conta principal**, com dois veículos e um ano e meio de
 *    histórico realista: abastecimentos com consumos coerentes, carregamentos de um
 *    EV, revisões, pneus, seguro, inspeções, IUC e documentos. É com estes dados que se
 *    verifica se o dashboard, as estatísticas e a timeline dizem coisas verdadeiras —
 *    por exemplo, se o consumo calculado bate certo com o que foi semeado.
 *
 *  - `vazio@zemlo.pt` — uma conta **sem veículos**, para verificar o onboarding e os
 *    estados vazios (§5, §46). É o caminho que a maioria dos utilizadores percorre
 *    primeiro e o mais fácil de deixar por testar.
 *
 * Execução: `npm run db:seed`
 */

import { PrismaClient } from '@zemlo/prisma-sqlite';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/* -------------------------------------------------------------------------- */
/* Utilitários de datas                                                        */
/* -------------------------------------------------------------------------- */

/**
 * "Hoje" é fixado no arranque para que todas as datas relativas do seed sejam
 * coerentes entre si. Datas absolutas (a data de uma revisão específica) são relativas
 * a este valor para que o conjunto de dados nunca fique "no passado" — o que faria
 * todos os lembretes aparecerem em atraso e tornaria a demonstração inútil.
 */
const TODAY = new Date();
TODAY.setUTCHours(0, 0, 0, 0);

function dateOnly(offsetDays: number): Date {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d;
}

function civilDate(offsetDays: number): string {
  return dateOnly(offsetDays).toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* Dados de demonstração                                                       */
/* -------------------------------------------------------------------------- */

interface FuelEntry {
  /** Dias antes de hoje. */
  daysAgo: number;
  litres: number;
  pricePerLitreCents: number;
  odometerKm: number;
  station: string;
}

interface ChargingEntry {
  daysAgo: number;
  energyKwh: number;
  pricePerKwhCents: number;
  odometerKm: number;
  location: string;
  isPublic: boolean;
  durationMinutes: number;
  startSoc: number;
  endSoc: number;
}

/**
 * Abastecimentos do BMW X3.
 *
 * Os valores foram construídos para produzir um consumo plausível e **verificável**:
 * cerca de 1 100 km entre abastecimentos de ~65 L, o que dá aproximadamente
 * 5,9 L/100 km. Ao inspecionar as estatísticas, este é o número que deve aparecer — se
 * aparecer outro, há um erro no cálculo e não nos dados.
 */
const BMW_FUEL: FuelEntry[] = [
  { daysAgo: 545, litres: 62.4, pricePerLitreCents: 172, odometerKm: 121_300, station: 'Galp — A5 Oeiras' },
  { daysAgo: 500, litres: 64.1, pricePerLitreCents: 175, odometerKm: 122_410, station: 'BP — Algés' },
  { daysAgo: 455, litres: 61.8, pricePerLitreCents: 169, odometerKm: 123_520, station: 'Repsol — Cascais' },
  { daysAgo: 410, litres: 65.2, pricePerLitreCents: 178, odometerKm: 124_640, station: 'Galp — A5 Oeiras' },
  { daysAgo: 365, litres: 63.9, pricePerLitreCents: 181, odometerKm: 125_730, station: 'BP — Algés' },
  { daysAgo: 320, litres: 64.8, pricePerLitreCents: 176, odometerKm: 126_850, station: 'Cepsa — Sintra' },
  { daysAgo: 275, litres: 62.1, pricePerLitreCents: 173, odometerKm: 127_940, station: 'Galp — A5 Oeiras' },
  { daysAgo: 230, litres: 66.3, pricePerLitreCents: 179, odometerKm: 129_070, station: 'Repsol — Cascais' },
  { daysAgo: 185, litres: 63.4, pricePerLitreCents: 182, odometerKm: 130_180, station: 'BP — Algés' },
  { daysAgo: 140, litres: 65.7, pricePerLitreCents: 177, odometerKm: 131_300, station: 'Galp — A5 Oeiras' },
  { daysAgo: 95, litres: 64.2, pricePerLitreCents: 174, odometerKm: 132_410, station: 'Cepsa — Sintra' },
  { daysAgo: 50, litres: 66.8, pricePerLitreCents: 180, odometerKm: 133_540, station: 'BP — Algés' },
  { daysAgo: 12, litres: 65.1, pricePerLitreCents: 183, odometerKm: 134_650, station: 'Galp — A5 Oeiras' },
];

/**
 * Carregamentos do Kia EV3.
 *
 * O consumo alvo é de cerca de 15,5 kWh/100 km. Como a maior parte dos carregamentos é
 * doméstica, o custo por km fica muito abaixo do BMW — que é exatamente a comparação
 * que o produto deve tornar visível (§23).
 */
const KIA_CHARGING: ChargingEntry[] = [
  { daysAgo: 540, energyKwh: 48.2, pricePerKwhCents: 12, odometerKm: 38_900, location: 'Casa', isPublic: false, durationMinutes: 320, startSoc: 22, endSoc: 80 },
  { daysAgo: 500, energyKwh: 52.4, pricePerKwhCents: 12, odometerKm: 39_240, location: 'Casa', isPublic: false, durationMinutes: 340, startSoc: 18, endSoc: 82 },
  { daysAgo: 460, energyKwh: 61.8, pricePerKwhCents: 45, odometerKm: 39_640, location: 'Ionity — A1 Santarém', isPublic: true, durationMinutes: 28, startSoc: 12, endSoc: 80 },
  { daysAgo: 420, energyKwh: 49.6, pricePerKwhCents: 13, odometerKm: 39_960, location: 'Casa', isPublic: false, durationMinutes: 315, startSoc: 24, endSoc: 80 },
  { daysAgo: 380, energyKwh: 53.1, pricePerKwhCents: 13, odometerKm: 40_310, location: 'Casa', isPublic: false, durationMinutes: 335, startSoc: 20, endSoc: 82 },
  { daysAgo: 340, energyKwh: 50.7, pricePerKwhCents: 14, odometerKm: 40_640, location: 'Casa', isPublic: false, durationMinutes: 320, startSoc: 22, endSoc: 80 },
  { daysAgo: 300, energyKwh: 58.3, pricePerKwhCents: 49, odometerKm: 41_020, location: 'Powerdot — Lisboa', isPublic: true, durationMinutes: 32, startSoc: 15, endSoc: 80 },
  { daysAgo: 260, energyKwh: 51.9, pricePerKwhCents: 14, odometerKm: 41_350, location: 'Casa', isPublic: false, durationMinutes: 325, startSoc: 19, endSoc: 81 },
  { daysAgo: 220, energyKwh: 48.8, pricePerKwhCents: 15, odometerKm: 41_670, location: 'Casa', isPublic: false, durationMinutes: 310, startSoc: 25, endSoc: 80 },
  { daysAgo: 180, energyKwh: 54.2, pricePerKwhCents: 15, odometerKm: 42_020, location: 'Casa', isPublic: false, durationMinutes: 330, startSoc: 21, endSoc: 82 },
  { daysAgo: 140, energyKwh: 50.1, pricePerKwhCents: 16, odometerKm: 42_350, location: 'Casa', isPublic: false, durationMinutes: 318, startSoc: 23, endSoc: 80 },
  { daysAgo: 100, energyKwh: 31.4, pricePerKwhCents: 52, odometerKm: 42_560, location: 'Continente — Almada', isPublic: true, durationMinutes: 22, startSoc: 30, endSoc: 62 },
  { daysAgo: 60, energyKwh: 57.6, pricePerKwhCents: 16, odometerKm: 42_900, location: 'Casa', isPublic: false, durationMinutes: 345, startSoc: 14, endSoc: 82 },
  { daysAgo: 25, energyKwh: 52.8, pricePerKwhCents: 17, odometerKm: 43_240, location: 'Casa', isPublic: false, durationMinutes: 328, startSoc: 20, endSoc: 81 },
  { daysAgo: 6, energyKwh: 49.3, pricePerKwhCents: 17, odometerKm: 43_560, location: 'Casa', isPublic: false, durationMinutes: 312, startSoc: 24, endSoc: 80 },
];

interface ExpenseSeed {
  daysAgo: number;
  amountCents: number;
  category: string;
  vendor?: string;
  description?: string;
  odometerKm?: number;
  vatCents?: number;
}

const KIA_EXPENSES: ExpenseSeed[] = [
  { daysAgo: 510, amountCents: 38_700, category: 'insurance', vendor: 'Fidelidade', description: 'Seguro anual — danos próprios' },
  { daysAgo: 495, amountCents: 14_200, category: 'tax', vendor: 'AT — Autoridade Tributária', description: 'IUC 2024' },
  { daysAgo: 470, amountCents: 3_250, category: 'inspection', vendor: 'Centro de Inspeção de Oeiras', description: 'Inspeção periódica', odometerKm: 39_010 },
  { daysAgo: 430, amountCents: 4_890, category: 'tyres', vendor: 'Norauto', description: 'Pneus de inverno — jogo completo' },
  { daysAgo: 300, amountCents: 18_450, category: 'maintenance', vendor: 'Kia Alfragide', description: 'Revisão dos 40 000 km', odometerKm: 40_020 },
  { daysAgo: 250, amountCents: 1_290, category: 'wash', vendor: 'Elephant Blue', description: 'Lavagem detalhada' },
  { daysAgo: 200, amountCents: 890, category: 'parking', vendor: 'EMEL', description: 'Estacionamento mensal' },
  { daysAgo: 150, amountCents: 6_400, category: 'tyres', vendor: 'Pneus Online', description: 'Pneus de verão — 2 unidades' },
  { daysAgo: 120, amountCents: 2_180, category: 'tolls', vendor: 'Via Verde', description: 'Portagens — trimestre' },
  { daysAgo: 90, amountCents: 22_900, category: 'insurance', vendor: 'Fidelidade', description: 'Renovação do seguro' },
  { daysAgo: 60, amountCents: 4_500, category: 'maintenance', vendor: 'Kia Alfragide', description: 'Substituição do filtro de habitáculo', odometerKm: 42_900 },
  { daysAgo: 35, amountCents: 15_900, category: 'tax', vendor: 'AT — Autoridade Tributária', description: 'IUC 2025' },
  { daysAgo: 15, amountCents: 1_450, category: 'accessories', vendor: 'Amazon', description: 'Cabo de carregamento Tipo 2 — 5 m' },
];

const BMW_EXPENSES: ExpenseSeed[] = [
  { daysAgo: 520, amountCents: 58_400, category: 'insurance', vendor: 'Allianz', description: 'Seguro anual' },
  { daysAgo: 500, amountCents: 21_600, category: 'tax', vendor: 'AT — Autoridade Tributária', description: 'IUC 2024' },
  { daysAgo: 480, amountCents: 3_250, category: 'inspection', vendor: 'Centro de Inspeção de Sintra', description: 'Inspeção periódica', odometerKm: 122_100 },
  { daysAgo: 360, amountCents: 42_800, category: 'maintenance', vendor: 'Baviera — Lisboa', description: 'Revisão dos 125 000 km', odometerKm: 125_400 },
  { daysAgo: 340, amountCents: 52_000, category: 'tyres', vendor: 'Baviera — Lisboa', description: 'Pneus runflat — jogo completo' },
  { daysAgo: 280, amountCents: 12_400, category: 'repairs', vendor: 'Oficina Silva', description: 'Substituição de discos e pastilhas traseiros', odometerKm: 128_100 },
  { daysAgo: 220, amountCents: 9_800, category: 'maintenance', vendor: 'Baviera — Lisboa', description: 'Mudança de óleo e filtros', odometerKm: 130_200 },
  { daysAgo: 160, amountCents: 62_300, category: 'insurance', vendor: 'Allianz', description: 'Renovação do seguro' },
  { daysAgo: 120, amountCents: 21_600, category: 'tax', vendor: 'AT — Autoridade Tributária', description: 'IUC 2025' },
  { daysAgo: 80, amountCents: 5_600, category: 'repairs', vendor: 'Oficina Silva', description: 'Sensor de estacionamento traseiro' },
  { daysAgo: 40, amountCents: 3_900, category: 'maintenance', vendor: 'Baviera — Lisboa', description: 'Revisão intermédia — verificação geral', odometerKm: 133_900 },
];

/* -------------------------------------------------------------------------- */
/* Seed                                                                        */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  console.log('A preparar dados de demonstração…\n');

  // Idempotência: apagar as contas de demonstração antes de as recriar. Correr o seed
  // duas vezes tem de produzir o mesmo estado, não o dobro dos registos.
  const demoEmails = ['demo@zemlo.pt', 'vazio@zemlo.pt'];
  const existing = await prisma.user.findMany({
    where: { email: { in: demoEmails } },
    select: { id: true, email: true },
  });
  if (existing.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: existing.map((u) => u.id) } } });
    console.log(`  Contas de demonstração anteriores removidas (${existing.length}).`);
  }

  const passwordHash = await bcrypt.hash('ZemloDemo2026', 12);

  /* ---------------------------------------------------------------------- */
  /* Conta de demonstração                                                   */
  /* ---------------------------------------------------------------------- */

  const demo = await prisma.user.create({
    data: {
      email: 'demo@zemlo.pt',
      passwordHash,
      name: 'Miguel Ferreira',
      timeZone: 'Europe/Lisbon',
      emailVerified: true,
      emailVerifiedAt: new Date(),
      acceptedTermsAt: new Date(),
      termsVersion: '0.1',
      preferences: {
        create: {
          reminderLeadDays: 30,
          reminderLeadKm: 1000,
          suggestionsEnabled: true,
          frequentExpenseCategories: JSON.stringify(['fuel', 'charging', 'maintenance', 'insurance']),
        },
      },
      notificationPreferences: {
        create: [
          { topic: 'maintenance', channel: 'in_app', frequency: 'immediate' },
          { topic: 'inspection', channel: 'in_app', frequency: 'immediate' },
          { topic: 'insurance', channel: 'in_app', frequency: 'immediate' },
          { topic: 'tax', channel: 'in_app', frequency: 'immediate' },
          { topic: 'document', channel: 'in_app', frequency: 'immediate' },
          { topic: 'summary', channel: 'in_app', frequency: 'weekly' },
          { topic: 'security', channel: 'in_app', frequency: 'immediate' },
        ],
      },
    },
  });

  /* ---------------------------------------------------------------------- */
  /* Kia EV3 — veículo elétrico, com histórico completo                      */
  /* ---------------------------------------------------------------------- */

  const kia = await prisma.vehicle.create({
    data: {
      userId: demo.id,
      plate: '4238EL',
      plateDisplay: '42-38-EL',
      make: 'Kia',
      model: 'EV3',
      version: 'GT-Line 81 kWh',
      year: 2024,
      vehicleType: 'suv',
      fuelType: 'electric',
      color: 'Branco Neve',
      vin: 'KNAAB81ABRA123456',
      powerCv: 204,
      batteryCapacityKwh: 81.4,
      usableBatteryKwh: 78.0,
      rangeKm: 600,
      transmission: 'automatic',
      drivetrain: 'fwd',
      co2GKm: 0,
      tyreSize: '215/60 R17',
      weightKg: 1885,
      purchaseDate: dateOnly(-560),
      purchasePriceCents: 4_150_000,
      purchaseOdometerKm: 38_500,
      firstRegistrationDate: dateOnly(-580),
      odometerKm: 43_560,
      odometerSource: JSON.stringify({ kind: 'manual', label: 'Manual' }),
      odometerUpdatedAt: dateOnly(-6),
    },
  });

  // Leituras de odómetro: uma por cada registo com quilometragem, para que o ritmo de
  // utilização (§11) seja calculado sobre dados reais e não sobre dois pontos.
  const kiaOdometerPoints: Array<{ km: number; daysAgo: number }> = [
    { km: 38_500, daysAgo: 560 },
    ...KIA_CHARGING.map((entry) => ({ km: entry.odometerKm, daysAgo: entry.daysAgo })),
    ...KIA_EXPENSES.filter((expense) => expense.odometerKm !== undefined).map((expense) => ({
      km: expense.odometerKm as number,
      daysAgo: expense.daysAgo,
    })),
  ].sort((a, b) => b.daysAgo - a.daysAgo);

  for (const point of kiaOdometerPoints) {
    await prisma.odometerReading.create({
      data: {
        vehicleId: kia.id,
        odometerKm: point.km,
        recordedAt: dateOnly(-point.daysAgo),
        origin: 'charging',
        source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
      },
    });
  }

  for (const entry of KIA_CHARGING) {
    const amountCents = Math.round((entry.energyKwh * entry.pricePerKwhCents) / 1);
    const session = await prisma.chargingSession.create({
      data: {
        vehicleId: kia.id,
        userId: demo.id,
        date: dateOnly(-entry.daysAgo),
        energyKwh: entry.energyKwh,
        amountCents,
        pricePerKwhCents: entry.pricePerKwhCents,
        odometerKm: entry.odometerKm,
        location: entry.location,
        durationMinutes: entry.durationMinutes,
        startSocPercent: entry.startSoc,
        endSocPercent: entry.endSoc,
        powerKw: entry.isPublic ? 120 : 11,
        provider: entry.isPublic ? entry.location.split(' — ')[0] : 'EDP Comercial',
        isPublic: entry.isPublic,
        isHome: !entry.isPublic,
        source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
      },
    });

    const expense = await prisma.expense.create({
      data: {
        vehicleId: kia.id,
        userId: demo.id,
        amountCents,
        category: 'charging',
        date: dateOnly(-entry.daysAgo),
        vendor: entry.location,
        odometerKm: entry.odometerKm,
        description: `${entry.energyKwh.toFixed(2)} kWh`,
        linkedRecordType: 'charging',
        linkedRecordId: session.id,
        source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
      },
    });
    await prisma.chargingSession.update({ where: { id: session.id }, data: { expenseId: expense.id } });

    await prisma.vehicleEvent.create({
      data: {
        vehicleId: kia.id,
        userId: demo.id,
        type: 'charging.created',
        date: dateOnly(-entry.daysAgo),
        title: 'Carregamento',
        summary: `${entry.energyKwh.toFixed(2)} kWh · ${entry.location}`,
        icon: '🔌',
        amountCents,
        odometerKm: entry.odometerKm,
        recordType: 'charging',
        recordId: session.id,
        source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
      },
    });
  }

  for (const expense of KIA_EXPENSES) {
    const created = await prisma.expense.create({
      data: {
        vehicleId: kia.id,
        userId: demo.id,
        amountCents: expense.amountCents,
        category: expense.category,
        date: dateOnly(-expense.daysAgo),
        vendor: expense.vendor ?? null,
        description: expense.description ?? null,
        odometerKm: expense.odometerKm ?? null,
        paid: true,
        source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
      },
    });

    await prisma.vehicleEvent.create({
      data: {
        vehicleId: kia.id,
        userId: demo.id,
        type: 'expense.created',
        date: dateOnly(-expense.daysAgo),
        title: expenseCategoryTitle(expense.category),
        summary: expense.description ?? expense.vendor ?? null,
        amountCents: expense.amountCents,
        odometerKm: expense.odometerKm ?? null,
        recordType: 'expense',
        recordId: created.id,
        source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
      },
    });
  }

  // Revisões do Kia, com plano de manutenção que gera o lembrete dos 50 000 km (§16).
  const kiaServices = [
    { daysAgo: 300, odometerKm: 40_020, amountCents: 18_450, description: 'Revisão dos 40 000 km', intervalKm: 10_000, intervalMonths: 12 },
    { daysAgo: 60, odometerKm: 42_900, amountCents: 4_500, description: 'Substituição do filtro de habitáculo', intervalKm: null, intervalMonths: null },
  ];

  for (const service of kiaServices) {
    const record = await prisma.maintenanceRecord.create({
      data: {
        vehicleId: kia.id,
        userId: demo.id,
        date: dateOnly(-service.daysAgo),
        type: 'service',
        odometerKm: service.odometerKm,
        amountCents: service.amountCents,
        workshop: 'Kia Alfragide',
        description: service.description,
        warrantyMonths: 24,
        nextDueOdometerKm: service.intervalKm ? service.odometerKm + service.intervalKm : null,
        nextDueDate: service.intervalMonths ? dateOnly(-service.daysAgo + service.intervalMonths * 30) : null,
        source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
      },
    });

    await prisma.vehicleEvent.create({
      data: {
        vehicleId: kia.id,
        userId: demo.id,
        type: 'maintenance.created',
        date: dateOnly(-service.daysAgo),
        title: 'Revisão',
        summary: service.description,
        icon: '🔧',
        amountCents: service.amountCents,
        odometerKm: service.odometerKm,
        recordType: 'maintenance',
        recordId: record.id,
        source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
      },
    });

    if (service.intervalKm) {
      // 43 560 km atuais, próxima aos 50 000 → faltam 1 440 km.
      const reminder = await prisma.reminder.create({
        data: {
          vehicleId: kia.id,
          userId: demo.id,
          title: 'Revisão dos 50 000 km',
          trigger: 'both',
          dueOdometerKm: service.odometerKm + service.intervalKm,
          dueDate: dateOnly(-service.daysAgo + 365),
          intervalKm: service.intervalKm,
          intervalMonths: service.intervalMonths,
          repeat: true,
          topic: 'maintenance',
          origin: 'maintenance',
          originRecordId: record.id,
          dedupeKey: `maintenance:${record.id}`,
        },
      });
      await prisma.maintenanceRecord.update({ where: { id: record.id }, data: { reminderId: reminder.id } });
    }
  }

  // Pneus: um intervenção que não gera lembrete mas entra nas estatísticas de manutenção.
  const kiaTyres = await prisma.maintenanceRecord.create({
    data: {
      vehicleId: kia.id,
      userId: demo.id,
      date: dateOnly(-430),
      type: 'tyres',
      odometerKm: 39_010,
      amountCents: 48_900,
      workshop: 'Norauto',
      description: 'Pneus de inverno — jogo completo',
      source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
    },
  });
  await prisma.vehicleEvent.create({
    data: {
      vehicleId: kia.id,
      userId: demo.id,
      type: 'maintenance.created',
      date: dateOnly(-430),
      title: 'Pneus',
      summary: 'Pneus de inverno — jogo completo',
      icon: '🛞',
      amountCents: 48_900,
      odometerKm: 39_010,
      recordType: 'maintenance',
      recordId: kiaTyres.id,
      source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
    },
  });

  /* ---------------------------------------------------------------------- */
  /* Kia — seguro, inspeções, impostos, documentos e lembretes               */
  /* ---------------------------------------------------------------------- */

  // A apólice termina daqui a 63 dias — o valor do exemplo do dashboard (§8).
  const kiaInsurance = await prisma.insurancePolicy.create({
    data: {
      vehicleId: kia.id,
      userId: demo.id,
      insurer: 'Fidelidade',
      policyNumber: 'FID-2025-884213',
      startDate: dateOnly(-90),
      endDate: dateOnly(63),
      premiumCents: 22_900,
      coverage: 'comprehensive',
      deductibleCents: 30_000,
      contactPhone: '+351 213 000 000',
      notes: 'Franquia de 300 € em danos próprios.',
      source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
    },
  });
  const kiaInsuranceReminder = await prisma.reminder.create({
    data: {
      vehicleId: kia.id,
      userId: demo.id,
      title: 'Renovação do seguro (Fidelidade)',
      trigger: 'time',
      dueDate: dateOnly(63),
      topic: 'insurance',
      origin: 'insurance',
      originRecordId: kiaInsurance.id,
      dedupeKey: `insurance:${kiaInsurance.id}`,
    },
  });
  await prisma.insurancePolicy.update({
    where: { id: kiaInsurance.id },
    data: { reminderId: kiaInsuranceReminder.id },
  });
  await prisma.vehicleEvent.create({
    data: {
      vehicleId: kia.id,
      userId: demo.id,
      type: 'insurance.created',
      date: dateOnly(-90),
      title: 'Seguro',
      summary: 'Fidelidade',
      icon: '🛡️',
      amountCents: 22_900,
      recordType: 'insurance',
      recordId: kiaInsurance.id,
      source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
    },
  });

  // Inspeção: a próxima é daqui a 142 dias — o valor do exemplo do dashboard (§8).
  const kiaInspection = await prisma.inspectionRecord.create({
    data: {
      vehicleId: kia.id,
      userId: demo.id,
      date: dateOnly(-223),
      result: 'passed',
      odometerKm: 39_010,
      amountCents: 3_250,
      nextDueDate: dateOnly(142),
      station: 'Centro de Inspeção de Oeiras',
      source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
    },
  });
  const kiaInspectionReminder = await prisma.reminder.create({
    data: {
      vehicleId: kia.id,
      userId: demo.id,
      title: 'Inspeção periódica',
      trigger: 'time',
      dueDate: dateOnly(142),
      intervalMonths: 12,
      repeat: true,
      topic: 'inspection',
      origin: 'inspection',
      originRecordId: kiaInspection.id,
      dedupeKey: `inspection:${kiaInspection.id}`,
    },
  });
  await prisma.inspectionRecord.update({
    where: { id: kiaInspection.id },
    data: { reminderId: kiaInspectionReminder.id },
  });
  await prisma.vehicleEvent.create({
    data: {
      vehicleId: kia.id,
      userId: demo.id,
      type: 'inspection.created',
      date: dateOnly(-223),
      title: 'Inspeção',
      summary: 'Aprovada',
      icon: '📋',
      amountCents: 3_250,
      odometerKm: 39_010,
      recordType: 'inspection',
      recordId: kiaInspection.id,
      source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
    },
  });

  // IUC: dois anos, o último pago.
  for (const [index, tax] of [
    { daysAgo: 495, year: 2024, amountCents: 14_200, paid: true },
    { daysAgo: 35, year: 2025, amountCents: 15_900, paid: true },
  ].entries()) {
    const record = await prisma.taxRecord.create({
      data: {
        vehicleId: kia.id,
        userId: demo.id,
        kind: 'iuc',
        year: tax.year,
        amountCents: tax.amountCents,
        date: dateOnly(-tax.daysAgo),
        dueDate: dateOnly(-tax.daysAgo + 5),
        paid: tax.paid,
        notes: index === 0 ? 'Pago por Multibanco.' : null,
        source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
      },
    });
    await prisma.vehicleEvent.create({
      data: {
        vehicleId: kia.id,
        userId: demo.id,
        type: 'tax.created',
        date: dateOnly(-tax.daysAgo),
        title: `IUC ${tax.year}`,
        summary: 'Pago',
        icon: '🏛️',
        amountCents: tax.amountCents,
        recordType: 'tax',
        recordId: record.id,
        source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
      },
    });
  }

  // Documentos, incluindo um com validade próxima para exercitar o alerta de expiração.
  const kiaDocuments = [
    { name: 'Documento Único Automóvel', category: 'registration', daysAgo: 560, expiresAt: null as number | null },
    { name: 'Apólice de seguro 2025/2026', category: 'insurance', daysAgo: 90, expiresAt: 63 },
    { name: 'Certificado de inspeção', category: 'inspection', daysAgo: 223, expiresAt: 142 },
    { name: 'Fatura da revisão dos 40 000 km', category: 'invoice', daysAgo: 300, expiresAt: null },
    { name: 'Certificado de garantia da bateria', category: 'warranty', daysAgo: 560, expiresAt: 2_190 },
  ];

  for (const document of kiaDocuments) {
    const created = await prisma.document.create({
      data: {
        userId: demo.id,
        vehicleId: kia.id,
        name: document.name,
        category: document.category,
        date: dateOnly(-document.daysAgo),
        expiresAt: document.expiresAt !== null ? dateOnly(document.expiresAt) : null,
        fileName: `${document.category}-${kia.plate.toLowerCase()}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 184_320,
        notes: null,
        source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
      },
    });

    await prisma.vehicleEvent.create({
      data: {
        vehicleId: kia.id,
        userId: demo.id,
        type: 'document.created',
        date: dateOnly(-document.daysAgo),
        title: document.name,
        summary: 'application/pdf',
        icon: '📄',
        recordType: 'document',
        recordId: created.id,
        source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
      },
    });
  }

  // Lembrete manual: pneus, por tempo (§16).
  await prisma.reminder.create({
    data: {
      vehicleId: kia.id,
      userId: demo.id,
      title: 'Rodar pneus',
      trigger: 'time',
      dueDate: dateOnly(21),
      intervalMonths: 6,
      repeat: true,
      topic: 'maintenance',
      origin: 'manual',
      notes: 'Alternar entre eixos dianteiro e traseiro.',
    },
  });

  /* ---------------------------------------------------------------------- */
  /* BMW X3 — veículo a combustão, para comparação entre tecnologias         */
  /* ---------------------------------------------------------------------- */

  const bmw = await prisma.vehicle.create({
    data: {
      userId: demo.id,
      plate: '19XG42',
      plateDisplay: '19-XG-42',
      make: 'BMW',
      model: 'X3',
      version: 'xDrive20d M Sport',
      year: 2019,
      vehicleType: 'suv',
      fuelType: 'diesel',
      color: 'Cinzento Mineral',
      vin: 'WBAUJ51050L123456',
      powerCv: 190,
      engineDisplacementCc: 1995,
      transmission: 'automatic',
      drivetrain: 'awd',
      tankCapacityL: 68,
      co2GKm: 148,
      tyreSize: '245/50 R19',
      weightKg: 1820,
      purchaseDate: dateOnly(-1_100),
      purchasePriceCents: 3_200_000,
      purchaseOdometerKm: 108_000,
      firstRegistrationDate: dateOnly(-2_400),
      odometerKm: 134_650,
      odometerSource: JSON.stringify({ kind: 'manual', label: 'Manual' }),
      odometerUpdatedAt: dateOnly(-12),
    },
  });

  for (const [index, entry] of BMW_FUEL.entries()) {
    const amountCents = Math.round(entry.litres * entry.pricePerLitreCents);
    const session = await prisma.fuelSession.create({
      data: {
        vehicleId: bmw.id,
        userId: demo.id,
        date: dateOnly(-entry.daysAgo),
        litres: entry.litres,
        amountCents,
        pricePerLitreCents: entry.pricePerLitreCents,
        odometerKm: entry.odometerKm,
        fullTank: true,
        station: entry.station,
        fuelType: 'diesel',
        source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
      },
    });

    const expense = await prisma.expense.create({
      data: {
        vehicleId: bmw.id,
        userId: demo.id,
        amountCents,
        category: 'fuel',
        date: dateOnly(-entry.daysAgo),
        vendor: entry.station,
        odometerKm: entry.odometerKm,
        description: `${entry.litres.toFixed(2)} L`,
        linkedRecordType: 'fuel',
        linkedRecordId: session.id,
        source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
      },
    });
    await prisma.fuelSession.update({ where: { id: session.id }, data: { expenseId: expense.id } });

    await prisma.odometerReading.create({
      data: {
        vehicleId: bmw.id,
        odometerKm: entry.odometerKm,
        recordedAt: dateOnly(-entry.daysAgo),
        origin: 'fuel',
        originRecordId: session.id,
        source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
      },
    });

    await prisma.vehicleEvent.create({
      data: {
        vehicleId: bmw.id,
        userId: demo.id,
        type: 'fuel.created',
        date: dateOnly(-entry.daysAgo),
        title: 'Abastecimento',
        summary: `${entry.litres.toFixed(2)} L · ${entry.station}`,
        icon: '⛽',
        amountCents,
        odometerKm: entry.odometerKm,
        recordType: 'fuel',
        recordId: session.id,
        source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
      },
    });

    void index;
  }

  for (const expense of BMW_EXPENSES) {
    const created = await prisma.expense.create({
      data: {
        vehicleId: bmw.id,
        userId: demo.id,
        amountCents: expense.amountCents,
        category: expense.category,
        date: dateOnly(-expense.daysAgo),
        vendor: expense.vendor ?? null,
        description: expense.description ?? null,
        odometerKm: expense.odometerKm ?? null,
        paid: true,
        source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
      },
    });

    await prisma.vehicleEvent.create({
      data: {
        vehicleId: bmw.id,
        userId: demo.id,
        type: 'expense.created',
        date: dateOnly(-expense.daysAgo),
        title: expenseCategoryTitle(expense.category),
        summary: expense.description ?? expense.vendor ?? null,
        amountCents: expense.amountCents,
        odometerKm: expense.odometerKm ?? null,
        recordType: 'expense',
        recordId: created.id,
        source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
      },
    });
  }

  for (const service of [
    { daysAgo: 360, odometerKm: 125_400, amountCents: 42_800, description: 'Revisão dos 125 000 km' },
    { daysAgo: 220, odometerKm: 130_200, amountCents: 9_800, description: 'Mudança de óleo e filtros' },
    { daysAgo: 40, odometerKm: 133_900, amountCents: 3_900, description: 'Revisão intermédia — verificação geral' },
  ]) {
    const record = await prisma.maintenanceRecord.create({
      data: {
        vehicleId: bmw.id,
        userId: demo.id,
        date: dateOnly(-service.daysAgo),
        type: 'service',
        odometerKm: service.odometerKm,
        amountCents: service.amountCents,
        workshop: 'Baviera — Lisboa',
        description: service.description,
        nextDueOdometerKm: service.odometerKm + 10_000,
        nextDueDate: dateOnly(-service.daysAgo + 365),
        source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
      },
    });

    await prisma.vehicleEvent.create({
      data: {
        vehicleId: bmw.id,
        userId: demo.id,
        type: 'maintenance.created',
        date: dateOnly(-service.daysAgo),
        title: 'Revisão',
        summary: service.description,
        icon: '🔧',
        amountCents: service.amountCents,
        odometerKm: service.odometerKm,
        recordType: 'maintenance',
        recordId: record.id,
        source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
      },
    });
  }

  // Revisão do BMW em atraso — para que o dashboard mostre, nos dados de demonstração,
  // um caso `overdue` e não apenas casos confortáveis.
  const bmwReminder = await prisma.reminder.create({
    data: {
      vehicleId: bmw.id,
      userId: demo.id,
      title: 'Revisão dos 135 000 km',
      trigger: 'both',
      dueOdometerKm: 133_900,
      dueDate: dateOnly(-20),
      intervalKm: 10_000,
      intervalMonths: 12,
      repeat: true,
      topic: 'maintenance',
      origin: 'manual',
      notes: 'A oficina recomendou tratar antes do verão.',
    },
  });
  await prisma.vehicleEvent.create({
    data: {
      vehicleId: bmw.id,
      userId: demo.id,
      type: 'reminder.created',
      date: dateOnly(-20),
      title: bmwReminder.title,
      summary: 'Por quilometragem ou tempo',
      icon: '🔔',
      recordType: 'reminder',
      recordId: bmwReminder.id,
      source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
    },
  });

  // BMW: seguro, inspeção e documentos mínimos.
  const bmwInsurance = await prisma.insurancePolicy.create({
    data: {
      vehicleId: bmw.id,
      userId: demo.id,
      insurer: 'Allianz',
      policyNumber: 'ALL-2025-119872',
      startDate: dateOnly(-160),
      endDate: dateOnly(205),
      premiumCents: 62_300,
      coverage: 'third_party_fire_theft',
      source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
    },
  });
  await prisma.reminder.create({
    data: {
      vehicleId: bmw.id,
      userId: demo.id,
      title: 'Renovação do seguro (Allianz)',
      trigger: 'time',
      dueDate: dateOnly(205),
      topic: 'insurance',
      origin: 'insurance',
      originRecordId: bmwInsurance.id,
      dedupeKey: `insurance:${bmwInsurance.id}`,
    },
  });

  await prisma.inspectionRecord.create({
    data: {
      vehicleId: bmw.id,
      userId: demo.id,
      date: dateOnly(-480),
      result: 'passed_with_defects',
      odometerKm: 122_100,
      amountCents: 3_250,
      nextDueDate: dateOnly(-115),
      station: 'Centro de Inspeção de Sintra',
      defects: 'Fuga ligeira no amortecedor dianteiro direito — a corrigir.',
      source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
    },
  });

  await prisma.document.create({
    data: {
      userId: demo.id,
      vehicleId: bmw.id,
      name: 'Documento Único Automóvel',
      category: 'registration',
      date: dateOnly(1_100),
      fileName: `registration-${bmw.plate.toLowerCase()}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 152_480,
      source: JSON.stringify({ kind: 'manual', label: 'Manual' }),
    },
  });

  /* ---------------------------------------------------------------------- */
  /* Conta vazia — para verificar o onboarding e os estados vazios (§5, §46) */
  /* ---------------------------------------------------------------------- */

  await prisma.user.create({
    data: {
      email: 'vazio@zemlo.pt',
      passwordHash,
      name: null,
      timeZone: 'Europe/Lisbon',
      acceptedTermsAt: new Date(),
      termsVersion: '0.1',
      preferences: { create: { reminderLeadDays: 30, reminderLeadKm: 1000 } },
      notificationPreferences: {
        create: [
          { topic: 'maintenance', channel: 'in_app', frequency: 'immediate' },
          { topic: 'inspection', channel: 'in_app', frequency: 'immediate' },
          { topic: 'insurance', channel: 'in_app', frequency: 'immediate' },
        ],
      },
    },
  });

  /* ---------------------------------------------------------------------- */
  /* Resumo                                                                  */
  /* ---------------------------------------------------------------------- */

  const counts = {
    veiculos: await prisma.vehicle.count({ where: { userId: demo.id } }),
    abastecimentos: await prisma.fuelSession.count({ where: { userId: demo.id } }),
    carregamentos: await prisma.chargingSession.count({ where: { userId: demo.id } }),
    despesas: await prisma.expense.count({ where: { userId: demo.id } }),
    manutencoes: await prisma.maintenanceRecord.count({ where: { userId: demo.id } }),
    lembretes: await prisma.reminder.count({ where: { userId: demo.id } }),
    documentos: await prisma.document.count({ where: { userId: demo.id } }),
    eventos: await prisma.vehicleEvent.count({ where: { userId: demo.id } }),
  };

  console.log('\nDados de demonstração criados.\n');
  console.log('  Conta com histórico completo:');
  console.log('    Email:    demo@zemlo.pt');
  console.log('    Password: ZemloDemo2026');
  console.log('    Veículos: Kia EV3 (42-38-EL, 43 560 km) · BMW X3 (19-XG-42, 134 650 km)');
  console.log(`    Registos: ${counts.abastecimentos} abastecimentos · ${counts.carregamentos} carregamentos · ${counts.despesas} despesas`);
  console.log(`              ${counts.manutencoes} manutenções · ${counts.lembretes} lembretes · ${counts.documentos} documentos`);
  console.log(`              ${counts.eventos} eventos na timeline`);
  console.log('\n  Conta vazia (para verificar o onboarding):');
  console.log('    Email:    vazio@zemlo.pt');
  console.log('    Password: ZemloDemo2026');
  console.log('');
}

/** Título de evento para uma categoria de despesa. */
function expenseCategoryTitle(category: string): string {
  const titles: Record<string, string> = {
    fuel: 'Combustível',
    charging: 'Carregamento',
    maintenance: 'Manutenção',
    tyres: 'Pneus',
    insurance: 'Seguro',
    tax: 'Imposto',
    inspection: 'Inspeção',
    wash: 'Lavagem',
    parking: 'Estacionamento',
    tolls: 'Portagens',
    repairs: 'Reparações',
    accessories: 'Acessórios',
    fines: 'Multas',
    other: 'Outros',
  };
  return titles[category] ?? 'Despesa';
}

/** Data civil relativa, mantida exportada para uso em testes. */
export { civilDate };

main()
  .catch((error) => {
    console.error('O seed falhou:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
