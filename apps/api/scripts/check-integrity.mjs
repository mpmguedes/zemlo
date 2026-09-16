#!/usr/bin/env node
/**
 * Verificação de integridade referencial e de cascata.
 *
 * Confirma que apagar uma entidade não deixa registos órfãos. É a classe de defeito que
 * não dá erro nenhum no momento da operação: a linha desaparece e as dependências ficam
 * a apontar para um identificador que já não existe, até algo tentar segui-lo.
 *
 * Uso: node scripts/check-integrity.mjs
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

let problems = 0;

function report(label, count, detail = '') {
  if (count === 0) {
    console.log(`  ok    ${label}`);
  } else {
    problems += 1;
    console.log(`  FALHA ${label} — ${count} registos órfãos${detail ? ` (${detail})` : ''}`);
  }
}

async function main() {
  console.log('\nIntegridade referencial\n');

  // Identificadores válidos para comparação.
  const userIds = new Set((await prisma.user.findMany({ select: { id: true } })).map((row) => row.id));
  const vehicleIds = new Set((await prisma.vehicle.findMany({ select: { id: true } })).map((row) => row.id));
  const expenseIds = new Set((await prisma.expense.findMany({ select: { id: true } })).map((row) => row.id));

  /*
   * 1. Tudo o que aponta para um veículo.
   *
   * A distinção entre `vehicleId` obrigatório e opcional importa: nas tabelas onde a
   * relação é obrigatória não existe filtro possível (não há nulos a excluir), e num
   * `where: { vehicleId: { not: null } }` o Prisma recusa o argumento. Só os documentos
   * e as integrações podem existir sem veículo.
   */
  const vehicleScopedRequired = [
    ['odometerReading', 'leituras de odómetro'],
    ['expense', 'despesas'],
    ['fuelSession', 'abastecimentos'],
    ['chargingSession', 'carregamentos'],
    ['maintenanceRecord', 'manutenções'],
    ['insurancePolicy', 'seguros'],
    ['inspectionRecord', 'inspeções'],
    ['taxRecord', 'impostos'],
    ['reminder', 'lembretes'],
    ['vehicleEvent', 'eventos'],
  ];

  const vehicleScopedOptional = [
    ['document', 'documentos'],
    ['integration', 'integrações'],
  ];

  for (const [model, label] of vehicleScopedRequired) {
    const rows = await prisma[model].findMany({ select: { vehicleId: true } });
    const orphaned = rows.filter((row) => !vehicleIds.has(row.vehicleId));
    report(`${label} apontam para um veículo existente`, orphaned.length, `${orphaned.length} de ${rows.length}`);
  }

  for (const [model, label] of vehicleScopedOptional) {
    const rows = await prisma[model].findMany({ select: { vehicleId: true } });
    const orphaned = rows.filter((row) => row.vehicleId !== null && !vehicleIds.has(row.vehicleId));
    report(`${label} apontam para um veículo existente (quando têm veículo)`, orphaned.length, `${orphaned.length} de ${rows.length}`);
  }

  // 2. Tudo o que aponta para um utilizador.
  const userScoped = [
    ['vehicle', 'veículos'],
    ['expense', 'despesas'],
    ['document', 'documentos'],
    ['reminder', 'lembretes'],
    ['notification', 'notificações'],
    ['suggestionState', 'estados de sugestão'],
    ['integration', 'integrações'],
    ['session', 'sessões'],
    ['vehicleEvent', 'eventos'],
  ];

  for (const [model, label] of userScoped) {
    const rows = await prisma[model].findMany({ select: { userId: true } });
    const orphaned = rows.filter((row) => !userIds.has(row.userId));
    report(`${label} apontam para um utilizador existente`, orphaned.length, `${orphaned.length} de ${rows.length}`);
  }

  // 3. Despesas ligadas a registos que existem.
  //
  // `linkedRecordType` guarda o tipo de **domínio** (`fuel`, `charging`, …), que é o que
  // os serviços usam e o que o cliente entende — não o nome do modelo Prisma. O mapa
  // abaixo traduz entre os dois; sem ele, a verificação reporta falsos positivos para
  // todos os tipos cujo nome difere (`fuel` → `fuelSession`).
  const RECORD_MODEL = {
    fuel: 'fuelSession',
    charging: 'chargingSession',
    maintenance: 'maintenanceRecord',
    insurance: 'insurancePolicy',
    inspection: 'inspectionRecord',
    tax: 'taxRecord',
    expense: 'expense',
    document: 'document',
    odometer: 'odometerReading',
    reminder: 'reminder',
    vehicle: 'vehicle',
  };

  const linked = await prisma.expense.findMany({
    where: { linkedRecordId: { not: null } },
    select: { id: true, linkedRecordType: true, linkedRecordId: true },
  });
  const dangling = [];
  for (const expense of linked) {
    if (!expense.linkedRecordId || !expense.linkedRecordType) continue;
    const model = RECORD_MODEL[expense.linkedRecordType];
    const delegate = model ? prisma[model] : null;
    if (!delegate) {
      dangling.push({ ...expense, reason: `tipo desconhecido: ${expense.linkedRecordType}` });
      continue;
    }
    const found = await delegate.findUnique({ where: { id: expense.linkedRecordId }, select: { id: true } });
    if (!found) dangling.push({ ...expense, reason: 'registo inexistente' });
  }
  report('despesas ligadas apontam para registos existentes', dangling.length, `${dangling.length} de ${linked.length}`);

  // 4. Registos que guardam um `expenseId` a apontar para uma despesa existente.
  for (const [model, label] of [
    ['fuelSession', 'abastecimentos'],
    ['chargingSession', 'carregamentos'],
    ['maintenanceRecord', 'manutenções'],
  ]) {
    const rows = await prisma[model].findMany({ where: { expenseId: { not: null } }, select: { id: true, expenseId: true } });
    const orphaned = rows.filter((row) => row.expenseId && !expenseIds.has(row.expenseId));
    report(`${label} com despesa associada existente`, orphaned.length, `${orphaned.length} de ${rows.length}`);
  }

  // 5. Lembretes gerados por outros registos continuam a ter origem válida.
  const generatedReminders = await prisma.reminder.findMany({
    where: { originRecordId: { not: null } },
    select: { id: true, origin: true, originRecordId: true, completedAt: true },
  });
  const originModels = {
    maintenance: 'maintenanceRecord',
    insurance: 'insurancePolicy',
    inspection: 'inspectionRecord',
    tax: 'taxRecord',
    document: 'document',
  };
  const originDangling = [];
  for (const reminder of generatedReminders) {
    const model = originModels[reminder.origin];
    if (!model || !reminder.originRecordId) continue;
    const found = await prisma[model].findUnique({ where: { id: reminder.originRecordId }, select: { id: true } });
    if (!found) originDangling.push(reminder);
  }
  report('lembretes gerados têm origem existente', originDangling.length, `${originDangling.length} de ${generatedReminders.length}`);

  // 6. Datas de validade coerentes (fim depois do início).
  const insurances = await prisma.insurancePolicy.findMany({ select: { startDate: true, endDate: true } });
  const badInsurance = insurances.filter((row) => row.endDate < row.startDate);
  report('apólices terminam depois de começarem', badInsurance.length, `${badInsurance.length} de ${insurances.length}`);

  // 7. Valores monetários e de quantidade plausíveis.
  const badExpenses = await prisma.expense.count({ where: { amountCents: { lt: -100_000_000 } } });
  report('despesas com valores dentro dos limites', badExpenses);

  const badFuel = await prisma.fuelSession.count({ where: { OR: [{ litres: { lte: 0 } }, { amountCents: { lt: 0 } }] } });
  report('abastecimentos com litros positivos', badFuel);

  const badCharging = await prisma.chargingSession.count({ where: { OR: [{ energyKwh: { lte: 0 } }, { amountCents: { lt: 0 } }] } });
  report('carregamentos com energia positiva', badCharging);

  const badSoc = await prisma.chargingSession.count({
    where: { OR: [{ startSocPercent: { lt: 0 } }, { startSocPercent: { gt: 100 } }, { endSocPercent: { gt: 100 } }] },
  });
  report('estados de carga entre 0 e 100%', badSoc);

  const badOdometer = await prisma.odometerReading.count({ where: { odometerKm: { lt: 0 } } });
  report('leituras de quilometragem não negativas', badOdometer);

  console.log('');
  if (problems === 0) {
    console.log('Sem problemas de integridade.\n');
  } else {
    console.log(`${problems} ${problems === 1 ? 'problema encontrado' : 'problemas encontrados'}.\n`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('A verificação falhou:', error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
