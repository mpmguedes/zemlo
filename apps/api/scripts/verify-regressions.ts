/**
 * Regressões da revisão adversarial.
 *
 * Cada verificação aqui corresponde a um defeito **real**, reproduzido contra a API e
 * depois corrigido. O objetivo não é confirmar que o código faz o que se espera — é
 * confirmar que os casos concretos que falhavam deixaram de falhar. Uma correção sem uma
 * verificação que a fixe é uma correção que volta na próxima alteração ao mesmo ficheiro.
 *
 * Uso (com a API a correr):
 *   npx tsx apps/api/scripts/verify-regressions.ts
 */

import { createHmac } from 'node:crypto';
import { loadEnv } from './load-env.mjs';

/*
 * O `.env` tem de ser carregado antes de qualquer `PrismaClient`. Este script cria um
 * diretamente (para gravar um fuso inválido e confirmar que a conta degrada em vez de
 * rebentar), e corre fora do servidor — logo não passa por `core/config.ts`, que é quem
 * carrega o ambiente no arranque da API.
 */
loadEnv();

const ORIGIN = process.env.ZEMLO_API_ORIGIN ?? 'http://127.0.0.1:4000';
const BASE = `${ORIGIN}/api/v1`;

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`  \u001b[32m✓\u001b[0m ${label}${detail ? ` \u001b[90m${detail}\u001b[0m` : ''}`);
  } else {
    failed += 1;
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  \u001b[31m✗\u001b[0m ${label}${detail ? ` \u001b[90m${detail}\u001b[0m` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n\u001b[1m${title}\u001b[0m`);
}

function civilDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

interface Result {
  status: number;
  body: any;
}

async function request(
  method: string,
  path: string,
  options: { token?: string; body?: unknown; contentType?: string | null } = {},
): Promise<Result> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.contentType !== null) headers['Content-Type'] = options.contentType ?? 'application/json';

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
  });
  const text = await response.text();
  let parsed: any = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: response.status, body: parsed };
}

function computeTotp(secret: string): string {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buffer.writeUInt32BE(counter % 2 ** 32, 4);
  const hmac = createHmac('sha1', Buffer.from(bytes)).update(buffer).digest();
  const offset = (hmac[hmac.length - 1] as number) & 0x0f;
  const binary =
    (((hmac[offset] as number) & 0x7f) << 24) |
    (((hmac[offset + 1] as number) & 0xff) << 16) |
    (((hmac[offset + 2] as number) & 0xff) << 8) |
    ((hmac[offset + 3] as number) & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

const stamp = Date.now();
const password = 'RegressaoZemlo2026!';

async function signUp(tag: string, timeZone?: string): Promise<string> {
  const result = await request('POST', '/auth/signup', {
    body: {
      email: `${tag}-${stamp}-${Math.random().toString(36).slice(2, 7)}@example.test`,
      password,
      acceptedTerms: true,
      ...(timeZone ? { timeZone } : {}),
    },
  });
  return result.body?.tokens?.accessToken as string;
}

async function main(): Promise<void> {
  console.log(`\n\u001b[1mZemlo — regressões da revisão adversarial\u001b[0m`);
  console.log(`\u001b[90mAPI: ${BASE}\u001b[0m`);

  const token = await signUp('reg');
  const vehicleResult = await request('POST', '/vehicles', {
    token,
    body: { plate: `RG-${String(stamp).slice(-4)}`, make: 'Regressão', fuelType: 'diesel' },
  });
  const vehicleId = vehicleResult.body?.id as string;
  check('Conta e veículo de teste criados', Boolean(vehicleId), vehicleId ? '' : JSON.stringify(vehicleResult.body));

  /* ---------------------------------------------------------------------- */
  section('P1. Um fuso horário inválido já não deixa a conta inutilizável');

  const badZone = await request('PATCH', '/me', { token, body: { timeZone: 'Not/AZone' } });
  check(
    'PATCH /me recusa um fuso horário inexistente',
    badZone.status === 422,
    `status ${badZone.status}`,
  );

  const emptyZone = await request('PATCH', '/me', { token, body: { timeZone: '' } });
  check('PATCH /me recusa um fuso horário vazio', emptyZone.status === 422, `status ${emptyZone.status}`);

  const goodZone = await request('PATCH', '/me', { token, body: { timeZone: 'Pacific/Kiritimati' } });
  check('PATCH /me aceita um fuso horário válido', goodZone.status === 200, `status ${goodZone.status}`);

  const afterBad = await request('GET', '/dashboard', { token });
  check(
    'O dashboard continua a responder depois das tentativas inválidas',
    afterBad.status === 200,
    `status ${afterBad.status}`,
  );

  /*
   * O segundo aspeto do defeito: um fuso inválido **já gravado** (por um cliente antigo,
   * por uma migração) não pode inutilizar a conta. Verificamos isso contra a base de dados
   * diretamente, porque a API já não permite gravar um valor inválido.
   */
  const { PrismaClient } = await import('@zemlo/prisma-sqlite');
  const prisma = new PrismaClient();
  const me = await request('GET', '/me', { token });
  await prisma.user.update({ where: { id: me.body?.id }, data: { timeZone: 'Fuso/Que/Nao/Existe' } });
  const selfHeal = await request('GET', '/dashboard', { token });
  check(
    'Um fuso inválido já na base de dados degrada em vez de rebentar (§ A4)',
    selfHeal.status === 200,
    `status ${selfHeal.status} — cai para Europe/Lisbon`,
  );
  await prisma.user.update({ where: { id: me.body?.id }, data: { timeZone: 'Europe/Lisbon' } });
  await prisma.$disconnect();

  /* ---------------------------------------------------------------------- */
  section('P2. Valores monetários negativos são recusados');

  const negativeExpense = await request('POST', '/records/expenses', {
    token,
    body: { vehicleId, amountCents: -100_000_000, category: 'other' },
  });
  check('Despesa com valor negativo é recusada', negativeExpense.status === 422, `status ${negativeExpense.status}`);

  const negativeFuel = await request('POST', '/records/fuel', {
    token,
    body: { vehicleId, litres: 50, amountCents: -5_000 },
  });
  check('Abastecimento com valor negativo é recusado', negativeFuel.status === 422, `status ${negativeFuel.status}`);

  const negativeCharging = await request('POST', '/records/charging', {
    token,
    body: { vehicleId, energyKwh: 40, amountCents: -500 },
  });
  check('Carregamento com valor negativo é recusado', negativeCharging.status === 422, `status ${negativeCharging.status}`);

  const negativeTax = await request('POST', '/records/taxes', {
    token,
    body: { vehicleId, year: 2026, amountCents: -1_000 },
  });
  check('Imposto com valor negativo é recusado', negativeTax.status === 422, `status ${negativeTax.status}`);

  /* ---------------------------------------------------------------------- */
  section('P3. Datas impossíveis no calendário são recusadas');

  const impossibleDates = [
    ['30 de fevereiro', '2026-02-30'],
    ['29 de fevereiro de um ano não bissexto', '2026-02-29'],
    ['31 de abril', '2026-04-31'],
    ['mês 00', '2026-00-10'],
    ['mês 13', '2026-13-01'],
  ];

  for (const [label, date] of impossibleDates) {
    const result = await request('POST', '/records/expenses', {
      token,
      body: { vehicleId, amountCents: 1000, category: 'other', date },
    });
    check(
      `${label} é recusada como erro de validação`,
      result.status === 422,
      `status ${result.status}${result.status === 500 ? ' (era um 500!)' : ''}`,
    );
  }

  const impossibleInspection = await request('POST', '/records/inspections', {
    token,
    body: { vehicleId, date: '2026-02-30' },
  });
  check('Data de inspeção impossível é recusada', impossibleInspection.status === 422, `status ${impossibleInspection.status}`);

  const impossibleReminder = await request('POST', '/reminders', {
    token,
    body: { vehicleId, title: 'X', trigger: 'time', dueDate: '2026-02-30' },
  });
  check('Data de lembrete impossível é recusada', impossibleReminder.status === 422, `status ${impossibleReminder.status}`);

  const impossibleOdometer = await request('POST', `/vehicles/${vehicleId}/odometer`, {
    token,
    body: { odometerKm: 5000, recordedAt: '2026-00-10' },
  });
  check('Data de leitura impossível é recusada', impossibleOdometer.status === 422, `status ${impossibleOdometer.status}`);

  const impossibleCalendar = await request('GET', '/calendar?from=2026-13-01&to=2026-13-30', { token });
  check(
    'Intervalo impossível no calendário é recusado com 422 (não 500)',
    impossibleCalendar.status === 422,
    `status ${impossibleCalendar.status}`,
  );

  const impossibleList = await request('GET', '/records/expenses?from=2026-00-10', { token });
  check('Filtro de data impossível na lista é recusado com 422', impossibleList.status === 422, `status ${impossibleList.status}`);

  /*
   * Um 29 de fevereiro de um ano bissexto tem de continuar a ser aceite: a validação
   * recusa datas que não existem, não datas futuras. Usamos um ano bissexto passado para
   * que a verificação não dependa da regra (correta) de que a data não pode estar no
   * futuro distante — `assertNotFarFuture` recusaria 2028 por esse motivo, e não pelo
   * calendário, o que tornaria a verificação ambígua.
   */
  const validLeapDay = await request('POST', '/records/expenses', {
    token,
    body: { vehicleId, amountCents: 1000, category: 'other', date: '2024-02-29' },
  });
  check('29 de fevereiro de um ano bissexto continua a ser aceite', validLeapDay.status === 201, `status ${validLeapDay.status}`);
  check('A data bissexta é guardada sem deslocamento', validLeapDay.body?.date === '2024-02-29', `date: ${validLeapDay.body?.date}`);

  /* ---------------------------------------------------------------------- */
  section('P4. A quilometragem não avança por um valor implausível vindo de um registo');

  await request('POST', `/vehicles/${vehicleId}/odometer`, {
    token,
    body: { odometerKm: 100_000, recordedAt: civilDate(-10) },
  });

  const implausibleViaExpense = await request('POST', '/records/expenses', {
    token,
    body: { vehicleId, amountCents: 100, category: 'other', date: civilDate(-1), odometerKm: 900_000 },
  });
  check('A despesa com quilometragem implausível é aceite', implausibleViaExpense.status === 201, `status ${implausibleViaExpense.status}`);

  const vehicleAfter = await request('GET', `/vehicles/${vehicleId}`, { token });
  check(
    'A quilometragem do veículo NÃO foi contaminada pelo valor implausível',
    vehicleAfter.body?.odometerKm === 100_000,
    `odómetro do veículo: ${vehicleAfter.body?.odometerKm} (esperado 100 000)`,
  );

  const implausibleViaInspection = await request('POST', '/records/inspections', {
    token,
    body: { vehicleId, date: civilDate(-2), odometerKm: 1_200_000 },
  });
  check('A inspeção com quilometragem implausível é aceite', implausibleViaInspection.status === 201, `status ${implausibleViaInspection.status}`);

  const vehicleAfterInspection = await request('GET', `/vehicles/${vehicleId}`, { token });
  check(
    'A inspeção também não contamina a quilometragem do veículo',
    vehicleAfterInspection.body?.odometerKm === 100_000,
    `odómetro: ${vehicleAfterInspection.body?.odometerKm}`,
  );

  const plausibleViaFuel = await request('POST', '/records/fuel', {
    token,
    body: { vehicleId, litres: 50, amountCents: 8_500, odometerKm: 100_500, date: civilDate(-1) },
  });
  check('Um salto plausível é aceite', plausibleViaFuel.status === 201, `status ${plausibleViaFuel.status}`);
  const vehicleAfterFuel = await request('GET', `/vehicles/${vehicleId}`, { token });
  check(
    'Um salto plausível avança a quilometragem do veículo',
    vehicleAfterFuel.body?.odometerKm === 100_500,
    `odómetro: ${vehicleAfterFuel.body?.odometerKm}`,
  );

  const readings = await request('GET', `/vehicles/${vehicleId}/odometer`, { token });
  const flagged = (readings.body?.items ?? []).filter((item: any) => (item.notes ?? '').includes('Não usada'));
  check(
    'As leituras não usadas ficam registadas com a razão',
    flagged.length === 2,
    `${flagged.length} leituras marcadas`,
  );

  /* ---------------------------------------------------------------------- */
  section('P5. O calendário de um veículo não mostra documentos de outro');

  const secondVehicle = await request('POST', '/vehicles', {
    token,
    body: { plate: `R2-${String(stamp).slice(-4)}`, make: 'Segundo' },
  });
  const secondVehicleId = secondVehicle.body?.id as string;

  await request('POST', '/documents', {
    token,
    body: { name: 'DOCUMENTO-DO-PRIMEIRO', category: 'other', vehicleId, expiresAt: civilDate(20) },
  });
  await request('POST', '/documents', {
    token,
    body: { name: 'DOCUMENTO-DO-SEGUNDO', category: 'other', vehicleId: secondVehicleId, expiresAt: civilDate(21) },
  });

  const calendar = await request(
    'GET',
    `/calendar?from=${civilDate(0)}&to=${civilDate(60)}&vehicleId=${vehicleId}`,
    { token },
  );
  const entries = calendar.body?.entries ?? [];
  const leakedDocuments = entries.filter((entry: any) => entry.title?.includes('DOCUMENTO-DO-SEGUNDO'));
  check(
    'O calendário do primeiro veículo não inclui o documento do segundo',
    leakedDocuments.length === 0,
    `${leakedDocuments.length} entradas alheias`,
  );
  // O documento gera duas entradas: o próprio documento (validade) e o lembrete que o
  // acompanha. Ambas pertencem ao veículo, e é isso que importa verificar.
  const ownDocumentEntries = entries.filter((entry: any) => entry.title?.includes('DOCUMENTO-DO-PRIMEIRO'));
  check(
    'O documento do próprio veículo continua a aparecer',
    ownDocumentEntries.length >= 1,
    `${ownDocumentEntries.length} entradas`,
  );
  check(
    'Todas as entradas de documento pertencem ao veículo pedido',
    entries
      .filter((entry: any) => entry.kind === 'document' || entry.kind === 'reminder')
      .every((entry: any) => entry.vehicleId === vehicleId),
    entries
      .filter((entry: any) => entry.kind === 'document' || entry.kind === 'reminder')
      .map((entry: any) => entry.vehicleId)
      .join(','),
  );

  const dayCount = (calendar.body?.days ?? []).reduce((sum: number, day: any) => sum + day.count, 0);
  check('O resumo por dia bate certo com as entradas', dayCount === entries.length, `${dayCount} vs ${entries.length}`);

  /* ---------------------------------------------------------------------- */
  section('P6. Concluir um lembrete repetível duas vezes não duplica');

  const repeatable = await request('POST', '/reminders', {
    token,
    body: {
      vehicleId,
      title: 'Revisão anual',
      trigger: 'time',
      dueDate: civilDate(-5),
      intervalMonths: 12,
      repeat: true,
    },
  });
  const repeatableId = repeatable.body?.id as string;

  const first = await request('POST', `/reminders/${repeatableId}/complete`, {
    token,
    body: { completedAt: civilDate(-2), odometerKm: 100_400 },
  });
  check('A primeira conclusão cria a ocorrência seguinte', Boolean(first.body?.next), first.body?.next?.dueDate);

  const second = await request('POST', `/reminders/${repeatableId}/complete`, {
    token,
    body: { completedAt: civilDate(0), odometerKm: 100_600 },
  });
  check('A segunda conclusão é aceite sem erro', second.status === 200, `status ${second.status}`);
  check(
    'A segunda conclusão devolve a MESMA ocorrência seguinte',
    second.body?.next?.id === first.body?.next?.id,
    `${second.body?.next?.id} vs ${first.body?.next?.id}`,
  );
  check(
    'A data de conclusão original não foi sobrescrita',
    second.body?.completed?.completedAt?.startsWith(civilDate(-2)) === true,
    `completedAt: ${second.body?.completed?.completedAt}`,
  );

  const allReminders = await request('GET', `/reminders?vehicleId=${vehicleId}&includeCompleted=true`, { token });
  const futureRevisions = (allReminders.body?.items ?? []).filter(
    (item: any) => item.title === 'Revisão anual' && item.completedAt === null,
  );
  check(
    'Existe exatamente uma ocorrência futura, não duas',
    futureRevisions.length === 1,
    `${futureRevisions.length} ocorrências futuras`,
  );

  /* ---------------------------------------------------------------------- */
  section('P7. Manutenção sem veículo indicado usa o veículo por omissão');

  const maintenanceNoVehicle = await request('POST', '/records/maintenance', {
    token,
    body: { type: 'other', description: 'Sem vehicleId' },
  });
  check(
    'POST /records/maintenance sem vehicleId devolve 201 (e não 500)',
    maintenanceNoVehicle.status === 201,
    `status ${maintenanceNoVehicle.status}`,
  );
  check(
    'O registo foi associado a um veículo do utilizador',
    maintenanceNoVehicle.body?.vehicleId === vehicleId || maintenanceNoVehicle.body?.vehicleId === secondVehicleId,
    `vehicleId: ${maintenanceNoVehicle.body?.vehicleId}`,
  );

  /* ---------------------------------------------------------------------- */
  section('P8. O total de uma lista respeita os filtros');

  /*
   * Verificado num veículo próprio, criado aqui.
   *
   * As secções anteriores já criaram despesas de várias categorias neste veículo, e uma
   * contagem que dependa do que foi criado antes é uma verificação que vai falhar por
   * razões que não têm a ver com o defeito. Um veículo dedicado torna os números
   * conhecidos e a verificação legível.
   */
  const countVehicle = await request('POST', '/vehicles', {
    token,
    body: { plate: `CT-${String(stamp).slice(-4)}`, make: 'Contagem' },
  });
  const countVehicleId = countVehicle.body?.id as string;

  for (let index = 0; index < 4; index += 1) {
    await request('POST', '/records/expenses', {
      token,
      body: { vehicleId: countVehicleId, amountCents: 1000 + index, category: 'fuel', date: civilDate(-index) },
    });
  }
  await request('POST', '/records/expenses', {
    token,
    body: { vehicleId: countVehicleId, amountCents: 5000, category: 'other', date: civilDate(0) },
  });

  const filtered = await request('GET', `/records/expenses?vehicleId=${countVehicleId}&category=fuel&limit=2`, { token });
  check(
    'O total com filtro de categoria conta só essa categoria (4)',
    filtered.body?.total === 4,
    `total: ${filtered.body?.total} (esperado 4)`,
  );
  check(
    'Todos os itens devolvidos têm a categoria pedida',
    (filtered.body?.items ?? []).every((item: any) => item.category === 'fuel'),
    `categorias: ${(filtered.body?.items ?? []).map((item: any) => item.category).join(',')}`,
  );
  check(
    'A paginação continua a respeitar o limite',
    (filtered.body?.items ?? []).length === 2,
    `${(filtered.body?.items ?? []).length} itens com limit=2`,
  );

  const unfiltered = await request('GET', `/records/expenses?vehicleId=${countVehicleId}`, { token });
  check(
    'Sem filtro de categoria, o total inclui as cinco despesas',
    unfiltered.body?.total === 5,
    `total: ${unfiltered.body?.total} (esperado 5)`,
  );

  /*
   * As despesas foram criadas em `civilDate(0)` a `civilDate(-3)`, mais uma `other` em
   * `civilDate(0)`. O intervalo `[-1, 0]` apanha portanto três: as de dia 0 (duas) e a de
   * dia −1.
   */
  const filteredByDate = await request(
    'GET',
    `/records/expenses?vehicleId=${countVehicleId}&from=${civilDate(-1)}&to=${civilDate(0)}`,
    { token },
  );
  check(
    'O total com filtro de datas conta só o intervalo (3 de 5)',
    filteredByDate.body?.total === 3,
    `total: ${filteredByDate.body?.total} (esperado 3)`,
  );
  check(
    'Todas as despesas devolvidas estão dentro do intervalo',
    (filteredByDate.body?.items ?? []).every(
      (item: any) => item.date >= civilDate(-1) && item.date <= civilDate(0),
    ),
    `datas: ${(filteredByDate.body?.items ?? []).map((item: any) => item.date).join(', ')}`,
  );

  const emptyRange = await request(
    'GET',
    `/records/expenses?vehicleId=${countVehicleId}&from=2000-01-01&to=2000-01-02`,
    { token },
  );
  check(
    'Um intervalo sem resultados devolve total 0, não o total geral',
    emptyRange.body?.total === 0,
    `total: ${emptyRange.body?.total}, itens: ${emptyRange.body?.items?.length}`,
  );

  /* ---------------------------------------------------------------------- */
  section('P9. O VIN é validado na forma');

  const badVin = await request('POST', '/vehicles', {
    token,
    body: { plate: `VN-${String(stamp).slice(-4)}`, vin: 'INVALIDVIN1234567' },
  });
  check('Um VIN com forma inválida é recusado', badVin.status === 422, `status ${badVin.status}`);

  const shortVin = await request('POST', '/vehicles', {
    token,
    body: { plate: `VS-${String(stamp).slice(-4)}`, vin: 'WBAUJ51050L12' },
  });
  check('Um VIN demasiado curto é recusado', shortVin.status === 422, `status ${shortVin.status}`);

  // VIN com forma válida e letra de controlo correta.
  const goodVin = await request('POST', '/vehicles', {
    token,
    body: { plate: `VG-${String(stamp).slice(-4)}`, vin: 'WBAUJ51050L123456' },
  });
  check('Um VIN com forma válida é aceite', goodVin.status === 201, `status ${goodVin.status}`);

  // Forma válida mas letra de controlo errada: aceite, com um aviso na timeline.
  const suspectVin = await request('POST', '/vehicles', {
    token,
    body: { plate: `VX-${String(stamp).slice(-4)}`, vin: 'WBAUJ51050L123457' },
  });
  check('Forma válida com letra de controlo suspeita é aceite (não bloqueia, §49)', suspectVin.status === 201, `status ${suspectVin.status}`);
  const suspectTimeline = await request('GET', `/timeline?vehicleId=${suspectVin.body?.id}`, { token });
  check(
    'O VIN suspeito gera um aviso na timeline',
    (suspectTimeline.body?.items ?? []).some((item: any) => item.title === 'Confirma o número de chassis'),
    (suspectTimeline.body?.items ?? []).map((item: any) => item.title).join(', '),
  );

  /* ---------------------------------------------------------------------- */
  section('P10. "Hoje" é o dia do utilizador, não o do servidor');

  const kiribatiToken = await signUp('kir', 'Pacific/Kiritimati');
  const kiribatiVehicle = await request('POST', '/vehicles', {
    token: kiribatiToken,
    body: { plate: `KI-${String(stamp).slice(-4)}` },
  });
  const kiribatiVehicleId = kiribatiVehicle.body?.id as string;

  const kiribatiOdometer = await request('POST', `/vehicles/${kiribatiVehicleId}/odometer`, {
    token: kiribatiToken,
    body: { odometerKm: 1000 },
  });
  const kiribatiExpense = await request('POST', '/records/expenses', {
    token: kiribatiToken,
    body: { vehicleId: kiribatiVehicleId, amountCents: 500, category: 'other' },
  });

  check(
    'A leitura de odómetro e a despesa usam o mesmo "hoje"',
    kiribatiOdometer.body?.recordedAt === kiribatiExpense.body?.date,
    `odómetro: ${kiribatiOdometer.body?.recordedAt} vs despesa: ${kiribatiExpense.body?.date}`,
  );
  check(
    'A data corresponde ao dia local do utilizador (UTC+14)',
    typeof kiribatiOdometer.body?.recordedAt === 'string' && kiribatiOdometer.body.recordedAt >= civilDate(0),
    `data: ${kiribatiOdometer.body?.recordedAt}, referência UTC: ${civilDate(0)}`,
  );

  const middayToken = await signUp('mid', 'Pacific/Midway');
  const middayVehicle = await request('POST', '/vehicles', {
    token: middayToken,
    body: { plate: `MW-${String(stamp).slice(-4)}` },
  });
  const middayOdometer = await request('POST', `/vehicles/${middayVehicle.body?.id}/odometer`, {
    token: middayToken,
    body: { odometerKm: 500 },
  });
  check(
    'Um utilizador a UTC-11 também obtém uma data coerente',
    typeof middayOdometer.body?.recordedAt === 'string' &&
      Math.abs(
        (Date.parse(`${middayOdometer.body.recordedAt}T00:00:00Z`) - Date.parse(`${civilDate(0)}T00:00:00Z`)) /
          86_400_000,
      ) <= 1,
    `data: ${middayOdometer.body?.recordedAt}`,
  );

  /* ---------------------------------------------------------------------- */
  section('P11. A edição de uma despesa também valida a data');

  const editable = await request('POST', '/records/expenses', {
    token,
    body: { vehicleId, amountCents: 1000, category: 'other' },
  });
  const patched = await request('PATCH', `/records/expenses/${editable.body?.id}`, {
    token,
    body: { date: '2099-01-01' },
  });
  check('PATCH com data no futuro distante é recusado', patched.status === 422, `status ${patched.status}`);

  /* ---------------------------------------------------------------------- */
  section('P12. Uma integração não pode apontar para um veículo de outra conta');

  const attackerToken = await signUp('atk');
  const attackerIntegration = await request('POST', '/integrations', {
    token: attackerToken,
    body: { category: 'other', provider: 'teste', label: 'Integração do atacante' },
  });
  const attackerIntegrationId = attackerIntegration.body?.id as string;

  const hijack = await request('PATCH', `/integrations/${attackerIntegrationId}`, {
    token: attackerToken,
    body: { vehicleId },
  });
  check(
    'Vincular a integração a um veículo alheio é recusado com 404',
    hijack.status === 404,
    `status ${hijack.status}${hijack.status === 200 ? ' — VAZOU' : ''}`,
  );

  const ownLink = await request('POST', '/integrations', {
    token: attackerToken,
    body: { category: 'other', provider: 'teste-proprio', vehicleId: attackerIntegrationId ? undefined : undefined },
  });
  void ownLink;
  const attackerVehicle = await request('POST', '/vehicles', {
    token: attackerToken,
    body: { plate: `AV-${String(stamp).slice(-4)}` },
  });
  const legitLink = await request('PATCH', `/integrations/${attackerIntegrationId}`, {
    token: attackerToken,
    body: { vehicleId: attackerVehicle.body?.id },
  });
  check('Vincular a integração ao próprio veículo funciona', legitLink.status === 200, `status ${legitLink.status}`);

  /* ---------------------------------------------------------------------- */
  section('P13. Um corpo não-JSON é reportado como tal');

  const noContentType = await request('POST', '/records/expenses', {
    token,
    body: '{"amountCents":1000,"category":"other"}',
    contentType: 'text/plain',
  });
  check(
    'Um corpo JSON enviado como text/plain devolve 415 com explicação',
    noContentType.status === 415,
    `status ${noContentType.status} — ${noContentType.body?.error?.message?.slice(0, 60)}`,
  );

  const noHeader = await request('POST', '/records/expenses', {
    token,
    body: '{"amountCents":1000,"category":"other"}',
    contentType: null,
  });
  check(
    'Um corpo sem Content-Type é recusado, em vez de dizer "campo obrigatório"',
    noHeader.status === 415,
    `status ${noHeader.status}`,
  );

  const malformed = await request('POST', '/records/expenses', {
    token,
    body: '{ isto não é json',
  });
  check('JSON malformado continua a devolver 400 legível', malformed.status === 400, `status ${malformed.status}`);

  /* ---------------------------------------------------------------------- */
  section('P14. O estado de carga tem uma única unidade, sem ambiguidade');

  /*
   * O que mudou: antes aceitavam-se **duas** unidades (fração 0–1 e percentagem 0–100) e
   * o serviço adivinhava qual era. `0.5` podia significar meio por cento ou cinquenta por
   * cento, e depois de gravado já não havia forma de recuperar a intenção. Agora o
   * contrato fixa a percentagem.
   *
   * Consequência que importa verificar: `0.5` continua a ser aceite — mas como **0,5 %**,
   * que é o que diz literalmente. Já não é multiplicado por 100 para virar 50 %.
   */
  const socFraction = await request('POST', '/records/charging', {
    token,
    body: { vehicleId, energyKwh: 10, amountCents: 200, odometerKm: 100_800, startSocPercent: 0.5, endSocPercent: 0.8 },
  });
  check('0,5 é aceite como 0,5 % e não convertido em 50 %', socFraction.status === 201, `status ${socFraction.status}`);
  check(
    'O valor é guardado tal como foi interpretado',
    socFraction.body?.startSocPercent === 0.5 && socFraction.body?.endSocPercent === 0.8,
    `${socFraction.body?.startSocPercent}% → ${socFraction.body?.endSocPercent}%`,
  );

  const socOutOfRange = await request('POST', '/records/charging', {
    token,
    body: { vehicleId, energyKwh: 10, amountCents: 200, startSocPercent: 150 },
  });
  check('Um estado de carga acima de 100 % é recusado', socOutOfRange.status === 422, `status ${socOutOfRange.status}`);

  const socNegative = await request('POST', '/records/charging', {
    token,
    body: { vehicleId, energyKwh: 10, amountCents: 200, startSocPercent: -5 },
  });
  check('Um estado de carga negativo é recusado', socNegative.status === 422, `status ${socNegative.status}`);

  const socPercent = await request('POST', '/records/charging', {
    token,
    body: {
      vehicleId,
      energyKwh: 10,
      amountCents: 200,
      odometerKm: 101_000,
      startSocPercent: 20,
      endSocPercent: 80,
    },
  });
  check('Uma percentagem 0–100 é aceite', socPercent.status === 201, `status ${socPercent.status}`);
  check(
    'O estado de carga é guardado em percentagem',
    socPercent.body?.startSocPercent === 20 && socPercent.body?.endSocPercent === 80,
    `${socPercent.body?.startSocPercent}% → ${socPercent.body?.endSocPercent}%`,
  );

  /* ---------------------------------------------------------------------- */
  section('P15. A comparação entre períodos usa janelas de igual duração');

  const stats = await request('GET', `/stats?vehicleId=${vehicleId}&months=1`, { token });
  const comparison = stats.body?.comparison;
  check('As estatísticas devolvem a comparação', comparison !== undefined);
  check(
    'A comparação devolve os dois totais e a diferença',
    typeof comparison?.previousPeriodTotalCents === 'number' && typeof comparison?.deltaCents === 'number',
    `anterior: ${comparison?.previousPeriodTotalCents}, atual: ${stats.body?.totals?.totalCents}`,
  );
  check(
    'A diferença é coerente com os dois totais',
    comparison?.deltaCents === (stats.body?.totals?.totalCents ?? 0) - (comparison?.previousPeriodTotalCents ?? 0),
    `delta: ${comparison?.deltaCents}`,
  );

  /* ---------------------------------------------------------------------- */
  /* Limpeza                                                                 */
  /* ---------------------------------------------------------------------- */

  for (const cleanupToken of [token, kiribatiToken, middayToken, attackerToken]) {
    await request('DELETE', '/me', { token: cleanupToken, body: { password, confirm: 'ELIMINAR' } });
  }

  console.log(`\n\u001b[1mResumo\u001b[0m`);
  console.log(`  \u001b[32m${passed} regressões confirmadas corrigidas\u001b[0m`);
  if (failed > 0) {
    console.log(`  \u001b[31m${failed} ainda falham\u001b[0m`);
    console.log('');
    for (const failure of failures) console.log(`  \u001b[31m✗\u001b[0m ${failure}`);
  }
  console.log('');
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error('\n\u001b[31mA verificação de regressões falhou com uma exceção:\u001b[0m', error);
  process.exitCode = 1;
});
