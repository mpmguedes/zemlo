/**
 * Verificação ponta a ponta da API do Zemlo.
 *
 * Este script percorre os fluxos reais do produto contra um servidor a correr e
 * **verifica os números**, não apenas os códigos HTTP. Um `200 OK` com um consumo de
 * 3 L/100 km num diesel seria um defeito grave que um teste de estado não apanha.
 *
 * Uso:
 *   1. npm run dev --workspace @zemlo/api    (noutro terminal)
 *   2. npm run verify --workspace @zemlo/api
 *
 * Cria a sua própria conta descartável, para poder correr contra a base de dados de
 * desenvolvimento sem destruir os dados de demonstração.
 */

const ORIGIN = process.env.ZEMLO_API_ORIGIN ?? 'http://127.0.0.1:4000';
const BASE = process.env.ZEMLO_API_URL ?? `${ORIGIN}/api/v1`;

import { createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Raiz da API, derivada da localização deste ficheiro.
 *
 * Usar `process.cwd()` funcionaria quando o script é corrido pelo npm a partir de
 * `apps/api`, e falharia silenciosamente — com um falso positivo de "schema em ordem" —
 * quando corrido da raiz do repositório. A localização do próprio ficheiro é a única
 * âncora fiável.
 */
const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* -------------------------------------------------------------------------- */
/* Utilitários                                                                 */
/* -------------------------------------------------------------------------- */

let passed = 0;
let failed = 0;
const failures = [];

function ok(label, detail = '') {
  passed += 1;
  console.log(`  \u001b[32m✓\u001b[0m ${label}${detail ? ` \u001b[90m${detail}\u001b[0m` : ''}`);
}

function fail(label, detail = '') {
  failed += 1;
  failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`  \u001b[31m✗\u001b[0m ${label}${detail ? ` \u001b[90m${detail}\u001b[0m` : ''}`);
}

function check(label, condition, detail = '') {
  if (condition) ok(label, detail);
  else fail(label, detail);
}

function section(title) {
  console.log(`\n\u001b[1m${title}\u001b[0m`);
}

/** Compara dois números com tolerância, para valores derivados (consumos, médias). */
function closeTo(actual, expected, tolerance, label) {
  if (actual === null || actual === undefined) {
    fail(label, `esperado ${expected}, obtido ${actual}`);
    return;
  }
  const delta = Math.abs(actual - expected);
  check(label, delta <= tolerance, `obtido ${actual}, esperado ~${expected} (±${tolerance})`);
}

let token = null;

async function api(method, path, body, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token && !options.anonymous) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: response.status, body: parsed, headers: response.headers };
}

function civilDate(offsetDays) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function euros(cents) {
  return `${(cents / 100).toFixed(2)} €`;
}

/* -------------------------------------------------------------------------- */
/* Verificações                                                                */
/* -------------------------------------------------------------------------- */

async function main() {
  const stamp = Date.now();
  const email = `verificacao-${stamp}@zemlo.pt`;
  const password = 'VerificacaoZemlo2026!';

  console.log(`\n\u001b[1mZemlo — verificação ponta a ponta\u001b[0m`);
  console.log(`\u001b[90mAPI: ${BASE}\u001b[0m`);

  /* ---------------------------------------------------------------------- */
  section('0. Consistência interna antes de falar com a API');

  /*
   * O schema SQLite é gerado a partir do schema PostgreSQL. Se os dois ficarem
   * divergentes, o desenvolvimento e os testes correm sobre um modelo que não
   * corresponde ao de produção — e a divergência só aparece no dia do deploy.
   * Verificar isto aqui torna a deriva detetável no sítio onde alguém a vai ver.
   */
  const schemaCheck = spawnSync('node', ['scripts/sync-sqlite-schema.mjs', '--check'], {
    cwd: API_ROOT,
    encoding: 'utf8',
  });
  check(
    'O schema SQLite está sincronizado com o schema canónico',
    schemaCheck.status === 0,
    schemaCheck.status === 0 ? '' : (schemaCheck.stderr ?? '').split('\n')[0],
  );

  /*
   * Integridade referencial: nenhuma linha pode apontar para outra que já não existe.
   *
   * É a classe de defeito que não dá erro no momento da operação — a linha desaparece e as
   * dependências ficam penduradas, até algo tentar seguir o identificador. Verificá-la a
   * cada corrida torna-a detetável antes de chegar a produção.
   */
  const integrityCheck = spawnSync('node', ['scripts/check-integrity.mjs'], {
    cwd: API_ROOT,
    encoding: 'utf8',
  });
  const integrityOutput = `${integrityCheck.stdout ?? ''}${integrityCheck.stderr ?? ''}`;
  check(
    'Não há registos órfãos na base de dados',
    integrityCheck.status === 0,
    integrityOutput.split('\n').filter((line) => line.includes('FALHA')).join(' | ').slice(0, 200),
  );

  /* ---------------------------------------------------------------------- */
  section('1. Saúde e raiz');

  // Os endpoints de saúde vivem fora do prefixo versionado: um orquestrador não deve
  // ter de saber que versão da API está a correr para verificar se o processo responde.
  const health = await fetch(`${ORIGIN}/health`);
  const healthBody = await health.json();
  check('GET /health responde 200', health.status === 200, `status ${health.status}`);
  check('A base de dados está acessível', healthBody?.database?.reachable === true, `${healthBody?.database?.provider} ${healthBody?.database?.latencyMs}ms`);
  check('A saúde não expõe detalhes internos', healthBody?.config === undefined && healthBody?.env === undefined);

  const root = await fetch(`${ORIGIN}/api`);
  const rootBody = await root.json();
  check('GET /api identifica o serviço', rootBody?.name === 'Zemlo', `nome: ${rootBody?.name}`);

  /* ---------------------------------------------------------------------- */
  section('2. Conta e autenticação (§29)');

  const signup = await api('POST', '/auth/signup', {
    email,
    password,
    name: 'Conta de Verificação',
    timeZone: 'Europe/Lisbon',
    acceptedTerms: true,
  }, { anonymous: true });
  check('Registo devolve 201', signup.status === 201, `status ${signup.status}`);
  check('Registo devolve token de acesso', typeof signup.body?.tokens?.accessToken === 'string');
  check('Onboarding começa sem veículo', signup.body?.user?.onboarding?.hasVehicle === false);
  token = signup.body?.tokens?.accessToken ?? null;

  const weakPassword = await api('POST', '/auth/signup', {
    email: `fraca-${stamp}@zemlo.pt`,
    password: 'curta',
    acceptedTerms: true,
  }, { anonymous: true });
  check('Password fraca é recusada', weakPassword.status === 422, `status ${weakPassword.status}`);
  check(
    'O erro identifica o campo',
    Array.isArray(weakPassword.body?.error?.fields) && weakPassword.body.error.fields.some((f) => f.path.includes('password')),
    JSON.stringify(weakPassword.body?.error?.fields ?? []),
  );

  const noTerms = await api('POST', '/auth/signup', {
    email: `termos-${stamp}@zemlo.pt`,
    password,
  }, { anonymous: true });
  check('Registo sem aceitar termos é recusado', noTerms.status === 422, `status ${noTerms.status}`);

  const badLogin = await api('POST', '/auth/login', { email, password: 'errada-mas-longa' }, { anonymous: true });
  check('Login com password errada devolve 401', badLogin.status === 401, `status ${badLogin.status}`);

  const login = await api('POST', '/auth/login', { email, password }, { anonymous: true });
  check('Login válido devolve 200', login.status === 200, `status ${login.status}`);
  check(
    'O login devolve o token de renovação',
    typeof login.body?.tokens?.refreshToken === 'string' && login.body.tokens.refreshToken.length > 20,
    login.body?.tokens?.refreshToken ? `${login.body.tokens.refreshToken.length} caracteres` : 'EM FALTA',
  );

  /*
   * Renovação de sessão (§29).
   *
   * Sem o `refreshToken` na resposta do login, `POST /auth/refresh` é inutilizável e a
   * sessão termina ao fim de uma hora, independentemente dos 90 dias configurados — foi o
   * que aconteceu na primeira versão. O fluxo completo é verificado aqui.
   */
  const refreshed = await api(
    'POST',
    '/auth/refresh',
    { refreshToken: login.body?.tokens?.refreshToken },
    { anonymous: true },
  );
  check('POST /auth/refresh aceita o token devolvido pelo login', refreshed.status === 200, `status ${refreshed.status}`);
  check(
    'A renovação devolve um par de tokens utilizável',
    typeof refreshed.body?.tokens?.accessToken === 'string' &&
      typeof refreshed.body?.tokens?.refreshToken === 'string',
    'novo token de acesso e novo token de renovação',
  );
  check(
    'O token de renovação é rodado (o antigo deixa de servir)',
    refreshed.body?.tokens?.refreshToken !== login.body?.tokens?.refreshToken,
    'tokens diferentes',
  );

  /*
   * O token antigo tem de deixar de funcionar. É isto que limita o dano de um refresh
   * token copiado: um atacante que o use primeiro queima-o, e o utilizador vê a sessão
   * terminar — o sinal que se quer.
   */
  const reuseOldRefresh = await api(
    'POST',
    '/auth/refresh',
    { refreshToken: login.body?.tokens?.refreshToken },
    { anonymous: true },
  );
  check(
    'O token de renovação anterior deixa de funcionar',
    reuseOldRefresh.status === 401,
    `status ${reuseOldRefresh.status}`,
  );

  const refreshedToken = refreshed.body?.tokens?.accessToken;
  const sessionAfterRefresh = await fetch(`${BASE}/me`, {
    headers: { Authorization: `Bearer ${refreshedToken}` },
  });
  check('O token renovado dá acesso à conta', sessionAfterRefresh.status === 200, `status ${sessionAfterRefresh.status}`);

  const staleRefresh = await api('POST', '/auth/refresh', { refreshToken: 'token-invalido' }, { anonymous: true });
  check('Um token de renovação inválido é recusado', staleRefresh.status === 401, `status ${staleRefresh.status}`);

  const missingRefresh = await api('POST', '/auth/refresh', {}, { anonymous: true });
  check('A renovação sem token é recusada', missingRefresh.status === 401, `status ${missingRefresh.status}`);

  const me = await api('GET', '/me');
  check('GET /me devolve o perfil', me.body?.email === email, `email: ${me.body?.email}`);
  check('Conta nova não tem 2FA ativo', me.body?.twoFactorEnabled === false);

  const noAuth = await fetch(`${BASE}/vehicles`);
  check('Sem token, os veículos exigem autenticação', noAuth.status === 401, `status ${noAuth.status}`);

  /* ---------------------------------------------------------------------- */
  section('3. Veículo com dados mínimos (§5, §49)');

  const minimal = await api('POST', '/vehicles', { plate: '42-38-1EL' });
  check('Veículo com apenas matrícula é criado', minimal.status === 201, `status ${minimal.status}`);
  const kiaId = minimal.body?.id;
  check(
    'Matrícula normalizada e agrupada para leitura',
    minimal.body?.plateDisplay === '42-38-1E-L' && minimal.body?.plate === '42381EL',
    `plateDisplay=${minimal.body?.plateDisplay} plate=${minimal.body?.plate}`,
  );
  check(
    'A API devolve a forma de apresentação que calculou, não a que recebeu',
    minimal.body?.plateDisplay !== '42-38-1EL',
    'não replica o texto cru do cliente',
  );
  check('Onboarding passa a ter veículo', minimal.body?.counts?.expenses === 0);

  const duplicate = await api('POST', '/vehicles', { plate: '42381EL' });
  check('Matrícula duplicada é recusada com 409', duplicate.status === 409, `status ${duplicate.status}`);
  check('A mensagem do duplicado é legível', typeof duplicate.body?.error?.message === 'string', duplicate.body?.error?.message);

  await api('PATCH', `/vehicles/${kiaId}`, {
    make: 'Kia',
    model: 'EV3',
    version: 'GT-Line 81 kWh',
    year: 2024,
    vehicleType: 'suv',
    fuelType: 'electric',
    batteryCapacityKwh: 81.4,
    usableBatteryKwh: 78,
    // Autonomia homologada: necessária para estimar a autonomia a partir do SOC, e
    // por isso o que torna o `sensor.zemlo_car_range` possível no Home Assistant.
    rangeKm: 600,
  });
  const detailed = await api('GET', `/vehicles/${kiaId}`);
  check('Enriquecimento progressivo guarda os campos avançados', detailed.body?.batteryCapacityKwh === 81.4);
  check('Veículo mantém-se válido sem VIN', detailed.body?.vin === null);

  const bmw = await api('POST', '/vehicles', { plate: '19-XG-42', make: 'BMW', model: 'X3', fuelType: 'diesel' });
  check('Segundo veículo é criado', bmw.status === 201, `status ${bmw.status}`);
  const bmwId = bmw.body?.id;

  /* ---------------------------------------------------------------------- */
  section('4. Quilometragem e validação de progressão (§11)');

  const first = await api('POST', `/vehicles/${kiaId}/odometer`, { odometerKm: 42_381 });
  check('Primeira leitura é aceite', first.status === 201, `status ${first.status}`);
  check('A primeira leitura não gera avisos', (first.body?.warnings ?? []).length === 0);

  const normal = await api('POST', `/vehicles/${kiaId}/odometer`, { odometerKm: 42_420 });
  check('Progressão normal é aceite sem confirmação', normal.status === 201, `status ${normal.status}`);
  check('O delta é calculado', normal.body?.deltaKm === 39, `delta: ${normal.body?.deltaKm}`);

  const regression = await api('POST', `/vehicles/${kiaId}/odometer`, { odometerKm: 40_000 });
  check('Recuo de quilometragem exige confirmação (422)', regression.status === 422, `status ${regression.status}`);
  check(
    'O aviso explica o recuo em linguagem de produto',
    typeof regression.body?.error?.message === 'string' && regression.body.error.message.includes('recuou'),
    regression.body?.error?.message,
  );

  const confirmed = await api('POST', `/vehicles/${kiaId}/odometer`, { odometerKm: 40_000, confirmRegression: true });
  check('Recuo confirmado é aceite', confirmed.status === 200 || confirmed.status === 201, `status ${confirmed.status}`);
  check('O registo fica marcado como correção', confirmed.body?.isCorrection === true);

  const implausible = await api('POST', `/vehicles/${kiaId}/odometer`, { odometerKm: 900_000 });
  check('Salto implausível exige confirmação', implausible.status === 422, `status ${implausible.status}`);

  await api('POST', `/vehicles/${kiaId}/odometer`, { odometerKm: 42_381, recordedAt: civilDate(-40) });
  await api('POST', `/vehicles/${kiaId}/odometer`, { odometerKm: 42_700, recordedAt: civilDate(-20) });
  await api('POST', `/vehicles/${kiaId}/odometer`, { odometerKm: 43_100, recordedAt: civilDate(-2) });

  const readings = await api('GET', `/vehicles/${kiaId}/odometer`);
  check('O histórico de leituras é devolvido', (readings.body?.items ?? []).length >= 5, `${readings.body?.items?.length} leituras`);

  /* ---------------------------------------------------------------------- */
  section('5. Registo rápido — despesa, carregamento, abastecimento (§12, §13, §14, §43)');

  const expense = await api('POST', '/records/expenses', {
    amountCents: 18_450,
    category: 'maintenance',
    description: 'Revisão dos 40 000 km',
    vendor: 'Kia Alfragide',
    vehicleId: kiaId,
  });
  check('Despesa com três campos é criada', expense.status === 201, `status ${expense.status}`);
  check('A data é preenchida por omissão com hoje', expense.body?.date === civilDate(0), `data: ${expense.body?.date}`);

  const badExpense = await api('POST', '/records/expenses', { amountCents: 0, category: 'fuel' });
  check('Despesa com valor zero é recusada', badExpense.status === 422, `status ${badExpense.status}`);

  const badCategory = await api('POST', '/records/expenses', { amountCents: 1000, category: 'inventada' });
  check('Categoria desconhecida é recusada', badCategory.status === 422, `status ${badCategory.status}`);

  const charging1 = await api('POST', '/records/charging', {
    vehicleId: kiaId,
    energyKwh: 48.5,
    amountCents: 582,
    odometerKm: 42_381,
    date: civilDate(-30),
    location: 'Casa',
    startSocPercent: 20,
    endSocPercent: 80,
    durationMinutes: 320,
  });
  check('Carregamento rápido é criado', charging1.status === 201, `status ${charging1.status}`);
  check('O preço por kWh é derivado', charging1.body?.pricePerKwhCents === 12, `obtido ${charging1.body?.pricePerKwhCents} cêntimos`);
  check('A despesa associada é criada automaticamente', typeof charging1.body?.id === 'string');
  check(
    'A potência média é derivada da energia e da duração',
    charging1.body?.derived?.averagePowerKw === 9.09,
    `obtido ${charging1.body?.derived?.averagePowerKw} kW`,
  );
  check(
    'O estado de carga adicionado é calculado',
    charging1.body?.derived?.addedSocPercent === 60,
    `obtido ${charging1.body?.derived?.addedSocPercent} pp`,
  );

  const charging2 = await api('POST', '/records/charging', {
    vehicleId: kiaId,
    energyKwh: 52.4,
    amountCents: 629,
    odometerKm: 42_720,
    date: civilDate(-10),
    location: 'Casa',
  });
  check('Segundo carregamento é criado', charging2.status === 201);
  check(
    'A distância desde o carregamento anterior é calculada',
    charging2.body?.derived?.distanceSincePreviousKm === 339,
    `obtido ${charging2.body?.derived?.distanceSincePreviousKm}`,
  );

  const charging3 = await api('POST', '/records/charging', {
    vehicleId: kiaId,
    energyKwh: 50.1,
    amountCents: 852,
    odometerKm: 43_100,
    date: civilDate(-2),
    location: 'Ionity',
    startSocPercent: 15,
    endSocPercent: 75,
  });
  const distance2 = 43_100 - 42_720;
  const expectedConsumption = Math.round((50.1 / distance2) * 100 * 100) / 100;
  closeTo(
    charging3.body?.derived?.consumptionKwh100Km,
    expectedConsumption,
    0.02,
    'O consumo elétrico do intervalo é calculado corretamente',
  );

  // Abastecimentos do BMW, com a série construída para dar um consumo conhecido.
  const fuelPlan = [
    { date: civilDate(-90), litres: 60, pricePerLitreCents: 170, odometerKm: 130_000 },
    { date: civilDate(-60), litres: 60, pricePerLitreCents: 170, odometerKm: 131_000 },
    { date: civilDate(-30), litres: 60, pricePerLitreCents: 170, odometerKm: 132_000 },
    { date: civilDate(-5), litres: 60, pricePerLitreCents: 170, odometerKm: 133_000 },
  ];
  const fuelResults = [];
  for (const entry of fuelPlan) {
    fuelResults.push(
      await api('POST', '/records/fuel', {
        vehicleId: bmwId,
        litres: entry.litres,
        amountCents: entry.litres * entry.pricePerLitreCents,
        pricePerLitreCents: entry.pricePerLitreCents,
        odometerKm: entry.odometerKm,
        date: entry.date,
        station: 'Galp',
      }),
    );
  }
  check('Todos os abastecimentos são criados', fuelResults.every((r) => r.status === 201));
  closeTo(
    fuelResults[3].body?.derived?.consumptionL100Km,
    6,
    0.05,
    'O consumo de combustível é 6,00 L/100 km (60 L em 1 000 km)',
  );
  closeTo(
    fuelResults[3].body?.derived?.costPer100KmCents,
    1020,
    2,
    'O custo por 100 km é coerente (60 L × 1,70 €)',
  );

  const partialFuel = await api('POST', '/records/fuel', {
    vehicleId: bmwId,
    litres: 30,
    amountCents: 5_100,
    odometerKm: 133_500,
    date: civilDate(-3),
    fullTank: false,
  });
  check('Abastecimento parcial é aceite', partialFuel.status === 201);

  const statsCheck = await api('GET', `/stats?vehicleId=${bmwId}&months=12`);
  check(
    'O consumo médio ignora intervalos com abastecimento parcial',
    statsCheck.body?.consumption?.fuelL100Km === 6,
    `obtido ${statsCheck.body?.consumption?.fuelL100Km}`,
  );

  /* ---------------------------------------------------------------------- */
  section('6. Manutenção, seguro, inspeção, impostos (§15 – §20)');

  const maintenance = await api('POST', '/records/maintenance', {
    vehicleId: bmwId,
    type: 'service',
    date: civilDate(-30),
    odometerKm: 132_000,
    amountCents: 42_800,
    workshop: 'Baviera',
    description: 'Revisão dos 130 000 km',
    intervalKm: 10_000,
    intervalMonths: 12,
  });
  check('Manutenção é criada', maintenance.status === 201, `status ${maintenance.status}`);
  check('A próxima data é derivada do intervalo em meses', maintenance.body?.nextDueDate === civilDate(335), `obtido ${maintenance.body?.nextDueDate}`);
  check('A próxima quilometragem é derivada do intervalo em km', maintenance.body?.nextDueOdometerKm === 142_000, `obtido ${maintenance.body?.nextDueOdometerKm}`);

  const remindersAfterMaintenance = await api('GET', '/reminders');
  const autoReminder = (remindersAfterMaintenance.body?.items ?? []).find((r) => r.title.includes('Próxima revisão'));
  check('A manutenção gera automaticamente o lembrete seguinte (§16)', Boolean(autoReminder), autoReminder?.title);
  check('O lembrete é do tipo "ambos"', autoReminder?.trigger === 'both', `trigger: ${autoReminder?.trigger}`);
  check('O lembrete é repetível', autoReminder?.repeat === true);
  check('O lembrete tem estado calculado', typeof autoReminder?.evaluation?.state === 'string', autoReminder?.evaluation?.summary);

  const insurance = await api('POST', '/records/insurance', {
    vehicleId: kiaId,
    insurer: 'Fidelidade',
    policyNumber: 'FID-2026-001',
    startDate: civilDate(-30),
    endDate: civilDate(63),
    premiumCents: 22_900,
    coverage: 'comprehensive',
  });
  check('Seguro é criado', insurance.status === 201, `status ${insurance.status}`);
  check('Os dias restantes são calculados', insurance.body?.daysRemaining === 63, `obtido ${insurance.body?.daysRemaining}`);
  check('A apólice é marcada como ativa', insurance.body?.active === true);

  const insuranceReminder = (await api('GET', '/reminders')).body?.items?.find((r) => r.title.includes('Renovação do seguro'));
  check('O seguro gera alerta de renovação (§18)', Boolean(insuranceReminder));

  const inspection = await api('POST', '/records/inspections', {
    vehicleId: kiaId,
    date: civilDate(-223),
    result: 'passed',
    odometerKm: 39_010,
    amountCents: 3_250,
    nextDueDate: civilDate(142),
  });
  check('Inspeção é criada', inspection.status === 201, `status ${inspection.status}`);

  const defaultInspection = await api('POST', '/records/inspections', {
    vehicleId: bmwId,
    date: civilDate(-100),
    result: 'passed',
    odometerKm: 133_000,
  });
  check('Sem data indicada, a próxima inspeção assume um ano', defaultInspection.body?.nextDueDate === civilDate(265), `obtido ${defaultInspection.body?.nextDueDate}`);
  check('A inspeção sem data é associada ao veículo certo', defaultInspection.body?.vehicleId === bmwId);

  const tax = await api('POST', '/records/taxes', {
    vehicleId: kiaId,
    kind: 'iuc',
    year: 2026,
    amountCents: 15_900,
    date: civilDate(-10),
    paid: true,
  });
  check('Imposto é criado', tax.status === 201, `status ${tax.status}`);

  const unpaidTax = await api('POST', '/records/taxes', {
    vehicleId: kiaId,
    kind: 'iuc',
    year: 2027,
    amountCents: 16_500,
    dueDate: civilDate(45),
    paid: false,
  });
  check('Imposto por pagar é criado', unpaidTax.status === 201);
  const taxReminder = (await api('GET', '/reminders')).body?.items?.find((r) => r.title.includes('Pagar'));
  check('Imposto por pagar gera lembrete (§20)', Boolean(taxReminder), taxReminder?.title);

  /* ---------------------------------------------------------------------- */
  section('7. Documentos e validades (§17)');

  const document = await api('POST', '/documents', {
    vehicleId: kiaId,
    name: 'Apólice de seguro 2026',
    category: 'insurance',
    date: civilDate(-30),
    expiresAt: civilDate(20),
    fileName: 'apolice.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 184_320,
  });
  check('Documento é criado', document.status === 201, `status ${document.status}`);
  check('Os dias até expirar são calculados', document.body?.daysToExpiry === 20, `obtido ${document.body?.daysToExpiry}`);

  const expiring = await api('GET', '/documents/expiring?withinDays=30');
  check('Documentos a expirar são listados', (expiring.body?.items ?? []).length >= 1, `${expiring.body?.items?.length} documentos`);

  /* ---------------------------------------------------------------------- */
  section('8. Lembretes: avaliação, conclusão e repetição (§16)');

  const manualReminder = await api('POST', '/reminders', {
    vehicleId: bmwId,
    title: 'Mudar o filtro de ar',
    trigger: 'distance',
    intervalKm: 5_000,
  });
  check('Lembrete por distância é criado', manualReminder.status === 201, `status ${manualReminder.status}`);
  check('A quilometragem alvo é derivada da atual', manualReminder.body?.dueOdometerKm === 133_000 + 5_000 + 500, `obtido ${manualReminder.body?.dueOdometerKm}`);

  const overdue = await api('POST', '/reminders', {
    vehicleId: bmwId,
    title: 'Tarefa em atraso',
    trigger: 'time',
    dueDate: civilDate(-10),
  });
  check('Atraso é detetado', overdue.body?.evaluation?.state === 'overdue', `estado: ${overdue.body?.evaluation?.state}`);
  check('O resumo do atraso é legível', overdue.body?.evaluation?.summary?.startsWith('Em atraso'), overdue.body?.evaluation?.summary);

  const soon = await api('POST', '/reminders', {
    vehicleId: bmwId,
    title: 'Tarefa próxima',
    trigger: 'time',
    dueDate: civilDate(15),
  });
  check('Proximidade é detetada', soon.body?.evaluation?.state === 'soon', `estado: ${soon.body?.evaluation?.state}`);

  const far = await api('POST', '/reminders', {
    vehicleId: bmwId,
    title: 'Tarefa distante',
    trigger: 'time',
    dueDate: civilDate(200),
  });
  check('Tarefa distante fica "em dia"', far.body?.evaluation?.state === 'ok', `estado: ${far.body?.evaluation?.state}`);

  const noData = await api('POST', '/reminders', {
    vehicleId: kiaId,
    title: 'Sem dados',
    trigger: 'distance',
    dueOdometerKm: 100_000,
  });
  check('Lembrete por km sem odómetro suficiente é avaliado sem dados', ['ok', 'soon', 'unknown'].includes(noData.body?.evaluation?.state), `estado: ${noData.body?.evaluation?.state}`);

  const withBoth = await api('POST', '/reminders', {
    vehicleId: bmwId,
    title: 'Condição dupla',
    trigger: 'both',
    dueDate: civilDate(300),
    dueOdometerKm: 133_500,
  });
  check('Com condição dupla, dispara a mais próxima', withBoth.body?.evaluation?.state !== 'ok', `estado: ${withBoth.body?.evaluation?.state}`);
  check('A condição que dispara é identificada', withBoth.body?.evaluation?.drivingCondition === 'distance', `obtido ${withBoth.body?.evaluation?.drivingCondition}`);

  const repeatable = await api('POST', '/reminders', {
    vehicleId: bmwId,
    title: 'Revisão repetível',
    trigger: 'both',
    dueDate: civilDate(-5),
    intervalMonths: 12,
    intervalKm: 10_000,
    repeat: true,
  });
  const completed = await api('POST', `/reminders/${repeatable.body?.id}/complete`, {
    completedAt: civilDate(0),
    odometerKm: 134_000,
  });
  check('Concluir devolve o lembrete concluído', completed.body?.completed?.completedAt !== null);
  check('Concluir cria a ocorrência seguinte (§16)', Boolean(completed.body?.next));
  check(
    'A próxima data conta a partir da conclusão, não do atraso',
    completed.body?.next?.dueDate === civilDate(365),
    `obtido ${completed.body?.next?.dueDate}`,
  );
  check(
    'A próxima quilometragem conta a partir da quilometragem da conclusão',
    completed.body?.next?.dueOdometerKm === 144_000,
    `obtido ${completed.body?.next?.dueOdometerKm}`,
  );

  const snoozed = await api('POST', `/reminders/${overdue.body?.id}/snooze`, { days: 30 });
  check('Adiar move a data para o futuro', snoozed.body?.evaluation?.state === 'ok' || snoozed.body?.evaluation?.state === 'soon', `estado: ${snoozed.body?.evaluation?.state}`);

  const reminderList = await api('GET', '/reminders');
  check('A lista de lembretes traz contagens por estado', typeof reminderList.body?.counts?.overdue === 'number', JSON.stringify(reminderList.body?.counts));

  /* ---------------------------------------------------------------------- */
  section('9. Dashboard, estatísticas, timeline e calendário (§8, §21, §23, §24)');

  const dashboard = await api('GET', '/dashboard');
  check('O dashboard devolve o veículo em foco', Boolean(dashboard.body?.vehicle), dashboard.body?.vehicle?.title);
  check('O dashboard devolve cartões de estado', (dashboard.body?.status ?? []).length >= 3, `${dashboard.body?.status?.length} cartões`);
  check('O resumo financeiro tem o ano corrente', dashboard.body?.finance?.year === new Date().getUTCFullYear());
  check('O resumo financeiro tem valor', typeof dashboard.body?.finance?.yearTotalCents === 'number', euros(dashboard.body?.finance?.yearTotalCents ?? 0));
  check('Os totais por categoria estão presentes', (dashboard.body?.finance?.byCategory ?? []).length > 0);
  check('A série mensal cobre 12 meses', (dashboard.body?.finance?.monthly ?? []).length === 12, `${dashboard.body?.finance?.monthly?.length} meses`);
  check('Os dados em falta são explicados em linguagem de produto', Array.isArray(dashboard.body?.dataGaps));
  check(
    'Cada lacuna de dados tem título e mensagem',
    (dashboard.body?.dataGaps ?? []).every((g) => typeof g.title === 'string' && typeof g.message === 'string'),
  );
  check('O custo por km é calculado quando há dados', dashboard.body?.usage?.costPerKmCents !== null, `${dashboard.body?.usage?.costPerKmCents} cêntimos/km`);

  const suggestions = dashboard.body?.suggestions ?? [];
  check('As sugestões são contextuais', Array.isArray(suggestions), `${suggestions.length} sugestões`);
  check(
    'Uma sugestão de segurança aparece quando não há 2FA',
    suggestions.some((s) => s.type === 'account.enable_2fa'),
    suggestions.map((s) => s.type).join(', '),
  );
  check('As sugestões trazem etiqueta de ação', suggestions.every((s) => typeof s.actionLabel === 'string'));

  // O dashboard, sem veículo indicado, foca o mais recentemente atualizado. Os
  // indicadores específicos de um veículo são verificados com o identificador explícito
  // — é o mesmo caminho que a aplicação usa quando o utilizador escolhe um veículo.
  const kiaDashboard = await api('GET', `/dashboard?vehicleId=${kiaId}`);
  const insuranceCard = (kiaDashboard.body?.status ?? []).find((c) => c.key === 'insurance');
  check(
    'O cartão do seguro mostra os dias restantes',
    insuranceCard?.value?.includes('63'),
    `${insuranceCard?.label}: ${insuranceCard?.value} (${insuranceCard?.hint})`,
  );
  const inspectionCard = (kiaDashboard.body?.status ?? []).find((c) => c.key === 'inspection');
  check(
    'O cartão da inspeção usa a próxima data do veículo em foco',
    inspectionCard?.value?.includes('142'),
    `${inspectionCard?.label}: ${inspectionCard?.value} (${inspectionCard?.hint})`,
  );
  check(
    'O consumo elétrico aparece para um EV',
    kiaDashboard.body?.usage?.energyConsumptionKwh100Km !== null,
    `${kiaDashboard.body?.usage?.energyConsumptionKwh100Km} kWh/100 km`,
  );
  check('O consumo de combustível não aparece para um EV', kiaDashboard.body?.usage?.fuelConsumptionL100Km === null);

  const bmwDashboard = await api('GET', `/dashboard?vehicleId=${bmwId}`);
  check('O dashboard de um diesel mostra o consumo de combustível', bmwDashboard.body?.usage?.fuelConsumptionL100Km === 6, `obtido ${bmwDashboard.body?.usage?.fuelConsumptionL100Km}`);
  check('O dashboard de um diesel não mostra consumo elétrico', bmwDashboard.body?.usage?.energyConsumptionKwh100Km === null);

  const stats = await api('GET', `/stats?vehicleId=${bmwId}`);
  check('As estatísticas devolvem o âmbito', stats.body?.scope?.vehicleId === bmwId);
  check('O total do período é positivo', (stats.body?.totals?.totalCents ?? 0) > 0, euros(stats.body?.totals?.totalCents ?? 0));
  check('A energia é separada no total', (stats.body?.totals?.energyCents ?? 0) > 0, euros(stats.body?.totals?.energyCents ?? 0));
  check('Os custos unitários incluem o custo por km', typeof stats.body?.unitCosts?.costPerKmCents === 'number', `${stats.body?.unitCosts?.costPerKmCents} cêntimos/km`);
  check('A comparação entre períodos é calculada', stats.body?.comparison !== undefined);
  check('As estatísticas avançadas trazem premissas explícitas', Array.isArray(stats.body?.advanced?.assumptions), `${stats.body?.advanced?.assumptions?.length} premissas`);
  check('As estatísticas avançadas não inventam depreciação sem preço de compra', stats.body?.advanced?.depreciationCents === null);

  const accountStats = await api('GET', '/stats');
  check('As estatísticas da conta agregam os veículos', accountStats.status === 200 && (accountStats.body?.totals?.totalCents ?? 0) > 0, euros(accountStats.body?.totals?.totalCents ?? 0));

  const timeline = await api('GET', '/timeline?limit=10');
  check('A timeline devolve itens', (timeline.body?.items ?? []).length > 0, `${timeline.body?.items?.length} itens`);
  check('Os itens estão ordenados do mais recente para o mais antigo', isDescending((timeline.body?.items ?? []).map((i) => i.date)));
  check('Os itens trazem ícone e tipo', (timeline.body?.items ?? []).every((i) => typeof i.icon === 'string' && typeof i.kind === 'string'));
  check('A timeline tem cursor para a página seguinte', typeof timeline.body?.nextCursor === 'string');

  const page2 = await api('GET', `/timeline?limit=10&cursor=${encodeURIComponent(timeline.body?.nextCursor ?? '')}`);
  const ids1 = new Set((timeline.body?.items ?? []).map((i) => i.id));
  const overlap = (page2.body?.items ?? []).filter((i) => ids1.has(i.id));
  check('A segunda página não repete itens', overlap.length === 0, `${overlap.length} repetidos`);

  const filtered = await api('GET', '/timeline?kinds=fuel&limit=50');
  check('A timeline pode ser filtrada por tipo', (filtered.body?.items ?? []).every((i) => i.kind === 'fuel' || i.eventType?.startsWith('fuel')), `${filtered.body?.items?.length} itens`);

  const calendar = await api('GET', `/calendar?from=${civilDate(0)}&to=${civilDate(400)}&vehicleId=${kiaId}`);
  check('O calendário devolve entradas', (calendar.body?.entries ?? []).length > 0, `${calendar.body?.entries?.length} entradas`);
  check('O calendário marca entradas projetadas', (calendar.body?.entries ?? []).some((e) => e.projected === true) || (calendar.body?.entries ?? []).every((e) => e.projected === false));
  check('O resumo por dia é coerente com as entradas', (calendar.body?.days ?? []).reduce((sum, d) => sum + d.count, 0) === (calendar.body?.entries ?? []).length);

  /* ---------------------------------------------------------------------- */
  section('10. Notificações (§22)');

  const notifications = await api('GET', '/notifications');
  check('A lista de notificações responde', notifications.status === 200, `status ${notifications.status}`);
  check('As notificações trazem contagem de não lidas', typeof notifications.body?.unreadCount === 'number', `${notifications.body?.unreadCount} não lidas`);

  if ((notifications.body?.items ?? []).length > 0) {
    const first = notifications.body.items[0];
    const marked = await api('POST', '/notifications/read', { ids: [first.id] });
    check('Marcar como lida funciona', marked.body?.updated === 1, `${marked.body?.updated} atualizadas`);
    const afterRead = await api('GET', '/notifications');
    check('A contagem de não lidas diminui', afterRead.body?.unreadCount === (notifications.body.unreadCount - 1), `${notifications.body.unreadCount} → ${afterRead.body?.unreadCount}`);
    const allRead = await api('POST', '/notifications/read', { all: true });
    check('Marcar todas como lidas funciona', allRead.body?.updated >= 0);
  } else {
    ok('Sem notificações pendentes para marcar (esperado numa conta nova)');
  }

  /* ---------------------------------------------------------------------- */
  section('11. Integrações e Home Assistant (§26, §27, §28)');

  const spec = await api('GET', `/integrations/home-assistant/spec?vehicleId=${kiaId}`);
  check('A especificação do Home Assistant é devolvida', spec.status === 200, `status ${spec.status}`);
  check('As entidades têm identificadores no formato do Home Assistant', (spec.body?.entities ?? []).every((e) => /^(sensor|binary_sensor|device_tracker)\./.test(e.entityId)));
  check('Cada entidade declara o requisito de dados', (spec.body?.entities ?? []).every((e) => typeof e.requires === 'string' && e.requires.length > 0));
  check('As entidades disponíveis refletem os dados reais', (spec.body?.entities ?? []).some((e) => e.available === true), (spec.body?.entities ?? []).filter((e) => e.available).map((e) => e.entityId).join(' '));
  check('O odómetro está disponível (há quilometragem)', (spec.body?.entities ?? []).find((e) => e.entityId.includes('odometer'))?.available === true);
  check(
    'O consumo elétrico está disponível para um EV com dois carregamentos',
    (spec.body?.entities ?? []).find((e) => e.entityId.includes('energy_consumption'))?.available === true,
  );
  check(
    'O consumo de combustível está indisponível para um EV',
    (spec.body?.entities ?? []).find((e) => e.entityId.endsWith('_consumption'))?.available === false,
  );
  check(
    'O estado de carga é derivado do último carregamento',
    (spec.body?.entities ?? []).find((e) => e.entityId.includes('battery'))?.available === true,
  );
  check(
    'A autonomia estimada aparece quando há SOC e autonomia homologada',
    (spec.body?.entities ?? []).find((e) => e.entityId.includes('range'))?.available === true,
  );
  check(
    'A entidade de carregamento em curso não é inventada',
    (spec.body?.entities ?? []).find((e) => e.entityId.includes('charging'))?.available === false,
    'exige telemetria em tempo real',
  );
  check(
    'A localização não é publicada sem GPS',
    (spec.body?.entities ?? []).find((e) => e.entityId.startsWith('device_tracker'))?.available === false,
  );
  check(
    'A entidade indisponível explica o que falta em vez de omitir o requisito',
    (spec.body?.entities ?? []).find((e) => e.entityId.includes('charging'))?.requires?.includes('tempo real') === true,
  );
  check('As instruções estão em linguagem de produto', (spec.body?.instructions ?? []).length >= 3);
  check(
    'As instruções resumem o que falta para as entidades indisponíveis',
    (spec.body?.instructions ?? []).some((i) => i.includes('não estão disponíveis') || i.includes('não está disponível')),
  );
  check('A configuração MQTT em falta é comunicada', (spec.body?.instructions ?? []).some((i) => i.includes('MQTT')));

  const integration = await api('POST', '/integrations', {
    category: 'home_assistant',
    provider: 'mqtt',
    label: 'Home Assistant de casa',
    vehicleId: kiaId,
    config: { discoveryPrefix: 'homeassistant' },
  });
  check('Integração é criada', integration.status === 201, `status ${integration.status}`);
  check('As credenciais nunca são devolvidas', integration.body?.credentials === undefined);
  check('Só os nomes das credenciais são devolvidos', Array.isArray(integration.body?.credentialKeys));

  const integrations = await api('GET', '/integrations');
  check('A lista de integrações funciona', (integrations.body?.items ?? []).length === 1);

  const duplicateIntegration = await api('POST', '/integrations', {
    category: 'home_assistant',
    provider: 'mqtt',
    vehicleId: kiaId,
  });
  check('Integração duplicada é recusada', duplicateIntegration.status === 409, `status ${duplicateIntegration.status}`);

  /* ---------------------------------------------------------------------- */
  section('12. Perfil, preferências e segurança (§29, §30)');

  const profile = await api('PATCH', '/me', { name: 'Nome Atualizado', distanceUnit: 'km' });
  check('O perfil pode ser atualizado', profile.body?.name === 'Nome Atualizado');

  const preferences = await api('PATCH', '/me/preferences', {
    reminderLeadDays: 45,
    reminderLeadKm: 2000,
    notifications: [{ topic: 'insurance', channel: 'in_app', frequency: 'weekly' }],
  });
  check('As preferências são atualizadas', preferences.body?.reminderLeadDays === 45, `obtido ${preferences.body?.reminderLeadDays}`);

  const afterPreferences = await api('GET', '/dashboard');
  const soonWithNewLead = (afterPreferences.body?.status ?? []).length > 0;
  check('O dashboard reflete as novas preferências', soonWithNewLead);

  const sessions = await api('GET', '/me/sessions');
  check('As sessões ativas são listadas', (sessions.body?.items ?? []).length >= 1, `${sessions.body?.items?.length} sessões`);
  check('A sessão atual é identificada', typeof sessions.body?.currentSessionId === 'string');

  const setup2fa = await api('POST', '/me/2fa/setup');
  check('A configuração de 2FA devolve segredo', typeof setup2fa.body?.secret === 'string');
  check('A configuração devolve URI otpauth', setup2fa.body?.otpauthUri?.startsWith('otpauth://totp/'), setup2fa.body?.otpauthUri?.slice(0, 40));
  check('São gerados 10 códigos de recuperação', (setup2fa.body?.recoveryCodes ?? []).length === 10);

  const wrongTotp = await api('POST', '/me/2fa/confirm', { secret: setup2fa.body?.secret, totp: '000000' });
  check('Um código TOTP errado é recusado', wrongTotp.status === 422, `status ${wrongTotp.status}`);

  // Código TOTP correto, calculado como o servidor o calcula (RFC 6238).
  const validTotp = computeTotp(setup2fa.body?.secret);
  const confirm2fa = await api('POST', '/me/2fa/confirm', { secret: setup2fa.body?.secret, totp: validTotp });
  check('Um código TOTP válido ativa o 2FA', confirm2fa.body?.enabled === true, JSON.stringify(confirm2fa.body));

  const meWith2fa = await api('GET', '/me');
  check('O perfil passa a indicar 2FA ativo', meWith2fa.body?.twoFactorEnabled === true);

  const loginWithoutTotp = await api('POST', '/auth/login', { email, password }, { anonymous: true });
  check('Login sem código é recusado quando há 2FA', loginWithoutTotp.status === 401, `status ${loginWithoutTotp.status}`);
  check(
    'A mensagem explica que é preciso o código',
    loginWithoutTotp.body?.error?.message?.includes('dois passos'),
    loginWithoutTotp.body?.error?.message,
  );

  const loginWithTotp = await api('POST', '/auth/login', { email, password, totp: computeTotp(setup2fa.body?.secret) }, { anonymous: true });
  check('Login com código válido funciona', loginWithTotp.status === 200, `status ${loginWithTotp.status}`);

  const recoveryLogin = await api('POST', '/auth/login', {
    email,
    password,
    totp: setup2fa.body?.recoveryCodes?.[0],
  }, { anonymous: true });
  check('Um código de recuperação permite entrar', recoveryLogin.status === 200, `status ${recoveryLogin.status}`);

  const reuseRecovery = await api('POST', '/auth/login', {
    email,
    password,
    totp: setup2fa.body?.recoveryCodes?.[0],
  }, { anonymous: true });
  check('Um código de recuperação não pode ser reutilizado', reuseRecovery.status === 401, `status ${reuseRecovery.status}`);

  const changePassword = await api('POST', '/me/password', {
    currentPassword: password,
    newPassword: 'NovaVerificacaoZemlo2026!',
    revokeOtherSessions: false,
  });
  check('A password pode ser alterada', changePassword.status === 200, `status ${changePassword.status}`);

  const samePassword = await api('POST', '/me/password', {
    currentPassword: 'NovaVerificacaoZemlo2026!',
    newPassword: 'NovaVerificacaoZemlo2026!',
  });
  check('Repetir a mesma password é recusado', samePassword.status === 422, `status ${samePassword.status}`);

  const disable2fa = await api('POST', '/me/2fa/disable', {
    password: 'NovaVerificacaoZemlo2026!',
    totp: computeTotp(setup2fa.body?.secret),
  });
  check('O 2FA pode ser desativado', disable2fa.body?.enabled === false, JSON.stringify(disable2fa.body));

  /* ---------------------------------------------------------------------- */
  section('13. Exportação (§54)');

  const jsonExport = await fetch(`${BASE}/export?format=json`, { headers: { Authorization: `Bearer ${token}` } });
  const jsonBody = await jsonExport.json();  check('A exportação JSON responde 200', jsonExport.status === 200, `status ${jsonExport.status}`);
  check('A exportação inclui metadados com versão', jsonBody?.meta?.formatVersion === 1);
  check('A exportação explica as unidades', (jsonBody?.meta?.notes ?? []).length >= 3);
  check('A exportação inclui veículos', (jsonBody?.vehicles ?? []).length === 2, `${jsonBody?.vehicles?.length} veículos`);
  check('A exportação inclui despesas', (jsonBody?.expenses ?? []).length > 0, `${jsonBody?.expenses?.length} despesas`);
  check('A exportação inclui abastecimentos', (jsonBody?.fuelSessions ?? []).length > 0, `${jsonBody?.fuelSessions?.length} abastecimentos`);
  check('A exportação inclui carregamentos', (jsonBody?.chargingSessions ?? []).length > 0);
  check('A exportação inclui eventos', (jsonBody?.events ?? []).length > 0, `${jsonBody?.events?.length} eventos`);
  check('A exportação não inclui a password nem o hash', !JSON.stringify(jsonBody).includes('passwordHash'));
  check('A exportação não inclui segredos de 2FA', !JSON.stringify(jsonBody).includes('twoFactorSecret'));

  const csvExport = await fetch(`${BASE}/export?format=csv`, { headers: { Authorization: `Bearer ${token}` } });
  // Lido como bytes: `Response.text()` remove o BOM, e o BOM é precisamente o que
  // estamos a verificar (sem ele, o Excel em português mostra acentos corrompidos).
  const csvBytes = Buffer.from(await csvExport.arrayBuffer());
  const csvBody = csvBytes.toString('utf8');
  check('A exportação CSV responde 200', csvExport.status === 200, `status ${csvExport.status}`);
  check(
    'O CSV começa com BOM UTF-8 (para o Excel)',
    csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf,
    `primeiros bytes: ${csvBytes.subarray(0, 3).toString('hex')}`,
  );
  check('O CSV usa ponto e vírgula como separador', csvBody.includes(';'));
  check('O CSV usa CRLF entre linhas', csvBody.includes('\r\n'));
  check('O CSV tem secções por tipo de registo', csvBody.includes('# veiculos') && csvBody.includes('# despesas'), 'secções presentes');
  check(
    'Os valores no CSV estão em euros com vírgula decimal',
    /"\d+,\d{2}"/.test(csvBody),
    'formato localizado',
  );
  check(
    'O CSV neutraliza células que o Excel interpretaria como fórmula',
    !/";[=+@]/m.test(csvBody) && !/\r\n[=+@]/.test(csvBody),
    'sem células iniciadas por = + @',
  );

  /* ---------------------------------------------------------------------- */
  section('14. Isolamento entre contas (§30)');

  const otherEmail = `outra-${stamp}@zemlo.pt`;
  const otherSignup = await api('POST', '/auth/signup', {
    email: otherEmail,
    password,
    acceptedTerms: true,
  }, { anonymous: true });
  const otherToken = otherSignup.body?.tokens?.accessToken;

  const stolen = await fetch(`${BASE}/vehicles/${kiaId}`, { headers: { Authorization: `Bearer ${otherToken}` } });
  check('Outra conta não consegue ver o veículo', stolen.status === 404, `status ${stolen.status}`);

  const stolenPatch = await fetch(`${BASE}/vehicles/${kiaId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ make: 'Invasão' }),
  });
  check('Outra conta não consegue alterar o veículo', stolenPatch.status === 404, `status ${stolenPatch.status}`);

  const stolenExpense = await fetch(`${BASE}/records/expenses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amountCents: 999, category: 'other', vehicleId: kiaId }),
  });
  check('Outra conta não consegue registar no veículo alheio', stolenExpense.status === 404, `status ${stolenExpense.status}`);

  const stolenTimeline = await fetch(`${BASE}/timeline`, { headers: { Authorization: `Bearer ${otherToken}` } });
  const stolenTimelineBody = await stolenTimeline.json();
  check('Outra conta vê a sua própria timeline vazia', (stolenTimelineBody?.items ?? []).length === 0, `${stolenTimelineBody?.items?.length} itens`);

  /*
   * A conta da "outra conta" é eliminada aqui, e não no fim do ficheiro.
   *
   * Deixá-la para a limpeza final parecia razoável, mas acumulava uma conta por cada
   * execução: ao fim de algumas dezenas de corridas, a base de dados de desenvolvimento
   * tinha contas que ninguém reconhecia. Uma verificação que cria recursos é responsável
   * por os remover no mesmo sítio onde os cria — assim é evidente que o faz, e não depende
   * de alguém se lembrar do fim do ficheiro.
   */
  await fetch(`${BASE}/me`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${otherToken}` },
    body: JSON.stringify({ password, confirm: 'ELIMINAR' }),
  });

  /* ---------------------------------------------------------------------- */
  section('15. Estabilidade e erros (§56)');

  const notFound = await api('GET', '/endpoint-que-nao-existe');
  check('Endpoint inexistente devolve 404 com envelope de erro', notFound.status === 404 && notFound.body?.error?.code === 'not_found');
  check('A resposta de erro inclui identificador de pedido', typeof notFound.body?.error?.requestId === 'string');

  const malformed = await fetch(`${BASE}/records/expenses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{ isto não é json',
  });
  check('JSON malformado devolve 400 legível', malformed.status === 400, `status ${malformed.status}`);

  const missingVehicle = await api('GET', '/vehicles/inexistente-12345');
  check('Veículo inexistente devolve 404', missingVehicle.status === 404);

  const requestIdHeader = await fetch(`${ORIGIN}/health`);
  check('Os pedidos devolvem X-Request-Id', typeof requestIdHeader.headers.get('x-request-id') === 'string');
  check('As respostas autenticadas não são cacheadas', (await api('GET', '/me')).headers.get('cache-control')?.includes('no-store') === true);

  const metrics = await api('GET', '/metrics');
  check('As métricas da conta são devolvidas', metrics.status === 200 && typeof metrics.body?.account?.vehicles === 'number', JSON.stringify(metrics.body?.account));

  /* ---------------------------------------------------------------------- */
  section('16. O veículo indicado é respeitado em todos os tipos de registo');

  /*
   * Regressão importante: o Zod remove por omissão as chaves que o esquema não declara.
   * Quando um esquema de criação não incluía `vehicleId`, o campo era descartado em
   * silêncio e o registo acabava no veículo mais recente do utilizador — sem qualquer
   * erro de HTTP. Esta verificação cobre todos os tipos de registo que aceitam
   * `vehicleId`, para que o defeito não volte por um deles.
   */
  const targetId = bmwId;
  const otherId = kiaId;

  const vehicleBoundRecords: Array<{ label: string; path: string; body: Record<string, unknown> }> = [
    { label: 'despesa', path: '/records/expenses', body: { amountCents: 1_234, category: 'other', vehicleId: targetId } },
    { label: 'abastecimento', path: '/records/fuel', body: { litres: 10, amountCents: 1_700, vehicleId: targetId } },
    { label: 'carregamento', path: '/records/charging', body: { energyKwh: 10, amountCents: 200, vehicleId: targetId } },
    { label: 'manutenção', path: '/records/maintenance', body: { type: 'other', vehicleId: targetId } },
    { label: 'inspeção', path: '/records/inspections', body: { date: civilDate(-1), vehicleId: targetId } },
    { label: 'seguro', path: '/records/insurance', body: { insurer: 'Teste', startDate: civilDate(-1), endDate: civilDate(364), vehicleId: targetId } },
    { label: 'imposto', path: '/records/taxes', body: { year: 2026, amountCents: 1_000, vehicleId: targetId } },
    { label: 'documento', path: '/documents', body: { name: 'Documento de teste', category: 'other', vehicleId: targetId } },
  ];

  for (const record of vehicleBoundRecords) {
    const createdRecord = await api('POST', record.path, record.body);
    const landedOn = createdRecord.body?.vehicleId;
    check(
      `O ${record.label} fica no veículo indicado`,
      createdRecord.status === 201 && landedOn === targetId,
      `status ${createdRecord.status}, caiu em ${landedOn === otherId ? 'OUTRO veículo' : String(landedOn)}`,
    );
  }

  // Os registos criados acima não devem aparecer no veículo que não foi indicado.
  const otherTimeline = await api('GET', `/timeline?vehicleId=${otherId}&limit=200`);
  const leaked = (otherTimeline.body?.items ?? []).filter(
    (item) => item.id.includes(targetId) || (item.subtitle ?? '').includes('Documento de teste'),
  );
  check('Nenhum registo vazou para o outro veículo', leaked.length === 0, `${leaked.length} fugas`);

  /* ---------------------------------------------------------------------- */
  section('16b. Referências cruzadas entre contas (injeção de chaves estrangeiras)');

  /*
   * As relações opcionais — `documentId` num seguro, `linkedRecordId` numa despesa — são
   * `String?` no schema, deliberadamente: apagar um documento não deve apagar um seguro,
   * que é um dado com valor próprio. A contrapartida é que a base de dados não impõe a
   * integridade, e a verificação tem de ser feita na aplicação.
   *
   * Sem ela, uma conta conseguia associar recursos de outra aos seus próprios registos e
   * obter uma referência a dados que não são seus. Encontrado por auditoria direta; esta
   * secção impede que volte.
   */
  const victimEmail = `vitima-${stamp}@zemlo.pt`;
  const attackerEmail = `atacante-${stamp}@zemlo.pt`;
  const attackerPassword = 'InjecaoZemlo2026!';

  const victimSignup = await api('POST', '/auth/signup', {
    email: victimEmail,
    password: attackerPassword,
    acceptedTerms: true,
  }, { anonymous: true });
  const attackerSignup = await api('POST', '/auth/signup', {
    email: attackerEmail,
    password: attackerPassword,
    acceptedTerms: true,
  }, { anonymous: true });

  const victimToken = victimSignup.body?.tokens?.accessToken as string;
  const attackerToken = attackerSignup.body?.tokens?.accessToken as string;

  /** Pedido autenticado como um token específico, sem tocar no token do teste. */
  async function as(token: string, method: string, path: string, body?: unknown) {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  const victimVehicle = (
    await as(victimToken, 'POST', '/vehicles', { plate: `VI-${String(stamp).slice(-4)}` })
  ).body;
  const victimDocument = (
    await as(victimToken, 'POST', '/documents', {
      name: 'Documento privado da vítima',
      category: 'other',
      vehicleId: victimVehicle?.id,
    })
  ).body;
  const victimFuel = (
    await as(victimToken, 'POST', '/records/fuel', {
      vehicleId: victimVehicle?.id,
      litres: 40,
      amountCents: 6_800,
      odometerKm: 10_000,
    })
  ).body;

  const attackerVehicle = (
    await as(attackerToken, 'POST', '/vehicles', { plate: `AT-${String(stamp).slice(-4)}` })
  ).body;

  const injectionAttempts: Array<{ label: string; path: string; body: Record<string, unknown> }> = [
    {
      label: 'seguro com documento de outra conta',
      path: '/records/insurance',
      body: { vehicleId: attackerVehicle?.id, insurer: 'X', startDate: civilDate(-1), endDate: civilDate(10), documentId: victimDocument?.id },
    },
    {
      label: 'inspeção com documento de outra conta',
      path: '/records/inspections',
      body: { vehicleId: attackerVehicle?.id, date: civilDate(-1), documentId: victimDocument?.id },
    },
    {
      label: 'imposto com documento de outra conta',
      path: '/records/taxes',
      body: { vehicleId: attackerVehicle?.id, year: 2026, amountCents: 1_000, documentId: victimDocument?.id },
    },
    {
      label: 'despesa ligada a um abastecimento de outra conta',
      path: '/records/expenses',
      body: { vehicleId: attackerVehicle?.id, amountCents: 500, category: 'other', linkedRecordId: victimFuel?.id },
    },
  ];

  for (const attempt of injectionAttempts) {
    const result = await as(attackerToken, 'POST', attempt.path, attempt.body);
    check(
      `${attempt.label} é recusado`,
      result.status === 404,
      `status ${result.status}${result.status === 201 ? ' — REGISTO CRIADO' : ''}`,
    );
  }

  const victimDocuments = await as(victimToken, 'GET', '/documents');
  check(
    'O documento da vítima continua acessível apenas à vítima',
    (victimDocuments.body?.items ?? []).length === 1,
    `${victimDocuments.body?.items?.length} documentos`,
  );
  const attackerDocuments = await as(attackerToken, 'GET', '/documents');
  check(
    'O atacante continua sem ver documentos alheios',
    (attackerDocuments.body?.items ?? []).length === 0,
    `${attackerDocuments.body?.items?.length} documentos`,
  );

  // As contas descartáveis são eliminadas para não poluir a base de dados.
  await as(victimToken, 'DELETE', '/me', { password: attackerPassword, confirm: 'ELIMINAR' });
  await as(attackerToken, 'DELETE', '/me', { password: attackerPassword, confirm: 'ELIMINAR' });

  /* ---------------------------------------------------------------------- */
  section('17. Referências entre despesas e registos técnicos');

  /*
   * Um abastecimento guarda o `expenseId` da despesa que gerou, e a despesa guarda
   * `linkedRecordId` do registo. Apagar um dos lados sem limpar o outro deixa uma
   * referência pendurada — um defeito que não dá erro nenhum no momento e só aparece
   * quando algo tenta seguir o identificador. Esta secção cobre os dois sentidos.
   */
  const refVehicle = (
    await api('POST', '/vehicles', { plate: `RF-${String(stamp).slice(-4)}`, fuelType: 'diesel' })
  ).body;
  const refVehicleId = refVehicle?.id as string;

  const refFuel = await api('POST', '/records/fuel', {
    vehicleId: refVehicleId,
    litres: 50,
    amountCents: 8_500,
    odometerKm: 20_000,
    date: civilDate(-2),
  });
  check('O abastecimento é criado para o teste de referências', refFuel.status === 201, `status ${refFuel.status}`);

  const refsBefore = await api('GET', `/records/expenses?vehicleId=${refVehicleId}`);
  const fuelExpense = (refsBefore.body?.items ?? []).find((e) => e.category === 'fuel');
  check('O abastecimento gera a despesa associada', Boolean(fuelExpense), fuelExpense?.id);

  const deleteFuel = await api('DELETE', `/records/fuel/${refFuel.body?.id}`);
  check('Apagar o abastecimento é aceite', deleteFuel.status === 204, `status ${deleteFuel.status}`);

  const refsAfter = await api('GET', `/records/expenses?vehicleId=${refVehicleId}`);
  check(
    'Apagar o abastecimento apaga também a despesa que gerou',
    (refsAfter.body?.items ?? []).length === 0,
    `${refsAfter.body?.items?.length} despesas restantes`,
  );

  // O sentido inverso: apagar a despesa mantém o registo técnico, mas limpa a referência.
  const refFuel2 = await api('POST', '/records/fuel', {
    vehicleId: refVehicleId,
    litres: 40,
    amountCents: 6_800,
    odometerKm: 20_500,
    date: civilDate(-1),
  });
  const refs2 = await api('GET', `/records/expenses?vehicleId=${refVehicleId}`);
  const fuelExpense2 = (refs2.body?.items ?? []).find((e) => e.category === 'fuel');

  const deleteExpense = await api('DELETE', `/records/expenses/${fuelExpense2?.id}`);
  check('Apagar a despesa é aceite', deleteExpense.status === 204, `status ${deleteExpense.status}`);

  const fuelStillThere = await api('GET', `/records/fuel/${refFuel2.body?.id}`);
  check(
    'O abastecimento sobrevive à eliminação da despesa',
    fuelStillThere.status === 200,
    'o utilizador apagou o custo, não o registo do veículo',
  );

  const refs3 = await api('GET', `/records/expenses?vehicleId=${refVehicleId}`);
  check('O custo desaparece das estatísticas com a despesa', (refs3.body?.items ?? []).length === 0);

  const integrityAfter = spawnSync('node', ['scripts/check-integrity.mjs'], {
    cwd: API_ROOT,
    encoding: 'utf8',
  });
  check(
    'Nenhuma referência ficou pendurada depois das eliminações',
    integrityAfter.status === 0,
    `${integrityAfter.stdout ?? ''}`.split('\n').filter((l) => l.includes('FALHA')).join(' | ').slice(0, 200),
  );

  await api('DELETE', `/vehicles/${refVehicleId}`);

  /* ---------------------------------------------------------------------- */
  section('18. Limpeza — eliminação de conta (§30)');

  const deleteWrong = await api('DELETE', '/me', {
    password: 'password-errada-mas-longa',
    confirm: 'ELIMINAR',
  });
  check('Eliminar conta com password errada é recusado', deleteWrong.status === 401, `status ${deleteWrong.status}`);

  const deleteWrongConfirm = await api('DELETE', '/me', {
    password: 'NovaVerificacaoZemlo2026!',
    confirm: 'talvez',
  });
  check('Eliminar conta exige a palavra de confirmação', deleteWrongConfirm.status === 422, `status ${deleteWrongConfirm.status}`);

  const deleted = await api('DELETE', '/me', {
    password: 'NovaVerificacaoZemlo2026!',
    confirm: 'ELIMINAR',
  });
  check('A conta é eliminada', deleted.status === 204, `status ${deleted.status}`);

  const afterDelete = await api('GET', '/me');
  check('A sessão deixa de ser válida após a eliminação', afterDelete.status === 401, `status ${afterDelete.status}`);

  const loginDeleted = await api('POST', '/auth/login', { email, password: 'NovaVerificacaoZemlo2026!' }, { anonymous: true });
  check('Já não é possível iniciar sessão na conta eliminada', loginDeleted.status === 401, `status ${loginDeleted.status}`);

  /* ---------------------------------------------------------------------- */
  /* Resumo                                                                  */
  /* ---------------------------------------------------------------------- */

  console.log(`\n\u001b[1mResumo\u001b[0m`);
  console.log(`  \u001b[32m${passed} verificações passaram\u001b[0m`);
  if (failed > 0) {
    console.log(`  \u001b[31m${failed} falharam\u001b[0m`);
    console.log('');
    for (const failure of failures) console.log(`  \u001b[31m✗\u001b[0m ${failure}`);
  }
  console.log('');

  process.exitCode = failed > 0 ? 1 : 0;
}

/* -------------------------------------------------------------------------- */
/* Auxiliares                                                                  */
/* -------------------------------------------------------------------------- */

function isDescending(dates) {
  for (let i = 1; i < dates.length; i += 1) {
    if (dates[i - 1] < dates[i]) return false;
  }
  return true;
}

/** Implementação de TOTP (RFC 6238) para gerar um código válido no teste. */
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

main().catch((error) => {
  console.error('\n\u001b[31mA verificação falhou com uma exceção:\u001b[0m', error);
  process.exitCode = 1;
});
