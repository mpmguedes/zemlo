/*
 * Verificação de arranque da aplicação.
 *
 * Não é um teste unitário: é uma verificação de que a aplicação **renderiza** cada ecrã sem
 * lançar, contra respostas reais da API. Existe porque o `tsc` e o `vite build` não apanham
 * a classe de defeitos mais provável numa aplicação deste tamanho — um `useEffect` que
 * rebenta, um acesso a `data.items` sobre um tipo que na prática vem `null`, um hook usado
 * fora de um provedor. Todos esses compilam e falham no primeiro segundo de utilização.
 *
 * A abordagem é a única possível sem um browser: a API **é** chamada a sério (login real,
 * pedidos reais), as respostas são instaladas na cache do React Query, e o ecrã é renderizado
 * com `react-dom/server`. Se um ecrã lançar, o processo falha com a mensagem exata.
 *
 * Execução: node apps/web/scripts/smoke-render.mjs
 */

import { createRequire } from 'node:module';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { build } = require('vite');

const API = 'http://127.0.0.1:4000/api/v1';
/** Diretório temporário do pacote, removido no fim. Está no `.gitignore` por sufixo. */
const SMOKE_DIR = 'apps/web/.smoke';

const errors = [];
const rendered = [];

/* -------------------------------------------------------------------------- */
/* Autenticação e respostas reais da API                                       */
/* -------------------------------------------------------------------------- */

async function login() {
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@zemlo.pt', password: 'ZemloDemo2026' }),
  });
  if (!response.ok) throw new Error(`Login recusado: ${response.status}`);
  return response.json();
}

async function call(path, token) {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    return { __failed: response.status, __path: path };
  }
  return response.json();
}

/* -------------------------------------------------------------------------- */
/* Cache do React Query                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Constrói as chaves exatamente como a aplicação as constrói.
 *
 * Esta duplicação é o único ponto frágil da verificação: se uma chave divergir, a consulta não
 * encontra dados e o ecrã mostra o estado de carregamento — que não falha, mas também não
 * verifica nada. Por isso a verificação **conta** os ecrãs que renderizaram conteúdo, e não
 * apenas os que não lançaram.
 */
function buildCache(vehicleId, accountVehicleId) {
  return [
    ['me', null],
    ['me', 'preferences'],
    ['me', 'sessions'],
    ['vehicles', 'list', { includeArchived: false }],
    ['vehicles', 'detail', vehicleId],
    ['vehicles', 'odometer', vehicleId],
    ['dashboard', vehicleId],
    ['stats', accountVehicleId, 'current', 12],
    ['stats', vehicleId, 'current', 12],
    ['timeline', 'all', 'all', '', ''],
    ['timeline', vehicleId, 'all', '', ''],
    ['calendar', null],
    ['reminders', 'list', vehicleId, 'any', false],
    ['records', 'expenses', 'all', 'all', '', '', 100],
    ['records', 'expenses', 'all', 'all', '', '', 1],
    ['records', 'fuel', 'all', '', '', 100],
    ['records', 'fuel', 'all', '', '', 1],
    ['records', 'charging', 'all', '', '', 100],
    ['records', 'charging', 'all', '', '', 1],
    ['records', 'maintenance', 'all', '', '', 100],
    ['records', 'maintenance', 'all', '', '', 1],
    ['records', 'insurance', vehicleId],
    ['records', 'inspections', vehicleId],
    ['records', 'taxes', vehicleId],
    ['records', 'insurance', 'all'],
    ['records', 'inspections', 'all'],
    ['records', 'taxes', 'all'],
    ['documents', 'list', 'all', 100],
    ['documents', 'list', vehicleId, 100],
    ['documents', 'list', undefined, 200],
    ['documents', 'expiring', 60],
    ['notifications', { unreadOnly: false }],
    ['integrations', 'list'],
    ['integrations', 'home-assistant', vehicleId],
    ['integrations', 'home-assistant', 'auto'],
    ['metrics', null],
    ['records', 'detail', 'fuel', null],
  ];
}

async function main() {
  const session = await login();
  const token = session.tokens.accessToken;

  const vehicles = await call('/vehicles', token);

  /*
   * Guarda explícita para o caso de a API não estar a servir as rotas versionadas.
   *
   * Aconteceu durante o desenvolvimento desta aplicação: o processo da API foi reiniciado em
   * modo de produção com as rotas de `/api/v1` por montar, e a verificação rebentava com
   * `Cannot read properties of undefined` — uma mensagem que aponta para o script e não para a
   * causa. Aqui a causa é dita: a verificação **não pode** correr contra uma API sem rotas, e
   * quem a lê tem de saber que o problema é do ambiente e não do código da aplicação.
   */
  if (vehicles.__failed || !Array.isArray(vehicles.items) || vehicles.items.length === 0) {
    console.error(
      `\nA API não devolveu veículos (resposta: ${vehicles.__failed ?? 'sem items'}).\n` +
        `Verifica que a API está a servir as rotas de ${API} com os dados de demonstração:\n` +
        '  npm run db:seed --workspace @zemlo/api\n' +
        '  npm run dev:api   (ou npm run start:api)\n',
    );
    rmSync(SMOKE_DIR, { recursive: true, force: true });
    process.exit(2);
  }

  const vehicleId = vehicles.items[0].id;

  const endpoints = {
    me: '/me',
    preferences: '/me/preferences',
    sessions: '/me/sessions',
    vehicleList: '/vehicles',
    vehicleDetail: `/vehicles/${vehicleId}`,
    odometer: `/vehicles/${vehicleId}/odometer`,
    dashboard: `/dashboard?vehicleId=${vehicleId}`,
    statsAccount: '/stats',
    statsVehicle: `/stats?vehicleId=${vehicleId}`,
    timeline: '/timeline?limit=30',
    timelineVehicle: `/timeline?vehicleId=${vehicleId}&limit=30`,
    calendar: `/calendar?from=2026-09-01&to=2026-09-30&vehicleId=${vehicleId}`,
    reminders: `/reminders?vehicleId=${vehicleId}&includeCompleted=false`,
    expenses: '/records/expenses?limit=100',
    fuel: '/records/fuel?limit=100',
    charging: '/records/charging?limit=100',
    maintenance: '/records/maintenance?limit=100',
    insurance: `/records/insurance?vehicleId=${vehicleId}&limit=200`,
    inspections: `/records/inspections?vehicleId=${vehicleId}&limit=200`,
    taxes: `/records/taxes?vehicleId=${vehicleId}&limit=200`,
    documents: '/documents?limit=100',
    expiring: '/documents/expiring?withinDays=60',
    notifications: '/notifications?unreadOnly=false&limit=100',
    integrations: '/integrations',
    homeAssistant: `/integrations/home-assistant/spec?vehicleId=${vehicleId}`,
    metrics: '/metrics',
  };

  const data = {};
  for (const [key, path] of Object.entries(endpoints)) {
    data[key] = await call(path, token);
    if (data[key].__failed) console.log(`  ! ${key} (${path}) devolveu ${data[key].__failed}`);
  }

  // O React Query só entrega dados em cache se a chave corresponder exatamente. Construímos
  // a cache a partir dos valores reais, mapeando cada chave para a resposta correspondente.
  const cacheEntries = [];
  const push = (key, value) => {
    if (value !== undefined && value !== null) cacheEntries.push([key, value]);
  };

  /*
   * As chaves têm de ser **literalmente** as que a aplicação constrói em `queryKeys.ts`.
   *
   * Isto é o ponto frágil da verificação, e já falhou uma vez: com `['me', null]` em vez de
   * `['me']`, o React Query não encontrava o perfil, a aplicação renderizava o estado de
   * carregamento e a verificação passava sem verificar nada. Por isso o script compara os
   * tamanhos do HTML no fim e falha se todos os ecrãs forem iguais.
   */
  push(['me'], data.me);
  push(['me', 'preferences'], data.preferences);
  push(['me', 'sessions'], data.sessions);
  push(['vehicles', 'list', { includeArchived: false }], data.vehicleList);
  push(['vehicles', 'list', { includeArchived: true }], data.vehicleList);
  push(['vehicles', 'detail', vehicleId], data.vehicleDetail);
  push(['vehicles', 'odometer', vehicleId], data.odometer);
  push(['dashboard', vehicleId], data.dashboard);
  push(['stats', 'account', 'current', 12], data.statsAccount);
  push(['stats', vehicleId, 'current', 12], data.statsVehicle);
  push(['stats', vehicleId, String(new Date().getUTCFullYear()), 12], data.statsVehicle);
  /*
   * O histórico não entra aqui: é a única consulta **infinita** da aplicação e a forma dos
   * dados em cache é diferente (`{ pages, pageParams }`, não a página crua). Está tratado
   * mais abaixo, com a explicação do porquê.
   */
  push(['calendar', '2026-09-01', '2026-09-30', vehicleId], data.calendar);
  push(['reminders', 'list', vehicleId, 'any', false], data.reminders);
  push(['records', 'expenses', 'all', 'all', '', '', 100], data.expenses);
  push(['records', 'expenses', 'all', 'all', '', '', 1], data.expenses);
  push(['records', 'fuel', 'all', '', '', 100], data.fuel);
  push(['records', 'fuel', 'all', '', '', 1], data.fuel);
  push(['records', 'charging', 'all', '', '', 100], data.charging);
  push(['records', 'charging', 'all', '', '', 1], data.charging);
  push(['records', 'maintenance', 'all', '', '', 100], data.maintenance);
  push(['records', 'maintenance', 'all', '', '', 1], data.maintenance);
  push(['records', 'insurance', vehicleId], data.insurance);
  push(['records', 'inspections', vehicleId], data.inspections);
  push(['records', 'taxes', vehicleId], data.taxes);
  push(['records', 'insurance', 'all'], data.insurance);
  push(['records', 'inspections', 'all'], data.inspections);
  push(['records', 'taxes', 'all'], data.taxes);
  push(['documents', 'list', 'all', 100], data.documents);
  push(['documents', 'list', vehicleId, 100], data.documents);
  push(['documents', 'list', undefined, 200], data.documents);
  push(['documents', 'expiring', 60], data.expiring);
  push(['notifications', { unreadOnly: false }], data.notifications);
  push(['integrations', 'list'], data.integrations);
  push(['integrations', 'home-assistant', vehicleId], data.homeAssistant);
  push(['integrations', 'home-assistant', 'auto'], data.homeAssistant);
  push(['metrics', null], data.metrics);

  /*
   * Consultas infinitas.
   *
   * O histórico (`useInfiniteQuery`) guarda `{ pages, pageParams }` na cache, e não a resposta
   * crua. Instalar a resposta direta produzia um erro em `getNextPageParam` (`lastPage`
   * indefinido) que só aparecia durante a verificação — e que, sem esta explicação, seria
   * facilmente interpretado como um defeito da aplicação. `pageParams` tem de acompanhar
   * `pages`: sem ele, o mesmo erro regressa em `hasNextPage`.
   */
  const infiniteEntries = [
    [['timeline', vehicleId, 'all', '', ''], data.timelineVehicle],
    [['timeline', 'all', 'all', '', ''], data.timeline],
  ];

  /* ---------------------------------------------------------------------- */
  /* Build em memória                                                        */
  /* ---------------------------------------------------------------------- */

  const bundle = await build({
    root: 'apps/web',
    configFile: false,
    logLevel: 'warn',
    define: {
      'process.env.NODE_ENV': '"development"',
      'import.meta.env.VITE_API_URL': JSON.stringify(API),
      'import.meta.env.MODE': '"test"',
      'import.meta.env.DEV': 'true',
      'import.meta.env.PROD': 'false',
    },
    resolve: {
      alias: { '@zemlo/shared': `${process.cwd()}/packages/shared/dist/index.js` },
    },
    build: {
      ssr: 'scripts/entry-smoke.tsx',
      write: false,
      minify: false,
      target: 'node20',
      rollupOptions: { output: { format: 'es', entryFileNames: 'smoke.mjs' } },
    },
  });

  const chunk = Array.isArray(bundle) ? bundle[0] : bundle;
  const output = chunk.output.find((item) => item.type === 'chunk');

  /*
   * O código é escrito num ficheiro dentro do pacote, e não importado de um URL `data:`.
   *
   * Um URL `data:` não tem base hierárquica, pelo que o Node não consegue resolver os
   * especificadores nus (`react-dom/server`) a partir dele — a importação falha com
   * `ERR_INVALID_URL`. Um ficheiro em `apps/web/.smoke/` resolve-os pela hierarquia normal de
   * `node_modules`, e é apagado no fim.
   */
  mkdirSync(SMOKE_DIR, { recursive: true });
  const smokeFile = `${SMOKE_DIR}/smoke.mjs`;
  writeFileSync(smokeFile, output.code, 'utf8');

  const smoke = await import(pathToFileURL(smokeFile).href);

  const results = await smoke.run({
    cacheEntries,
    infiniteEntries,
    session,
    vehicleId,
    apiUrl: API,
  });

  for (const result of results) {
    rendered.push(result);
    if (result.error) {
      errors.push(result);
      console.log(`  FALHA ${result.name}: ${result.error}`);
      if (result.excerpt) console.log(        );
    } else {
      console.log(`  OK    ${result.name} (${result.bytes} bytes)`);
    }
  }

  /*
   * Verificação de que a renderização não é vazia.
   *
   * Este passo existe porque a primeira versão desta verificação passou com todos os ecrãs a
   * devolver o mesmo HTML de carregamento: as chaves da cache não correspondiam às que a
   * aplicação usa, e o teste passou sem testar nada. Um ecrã que renderiza o estado de
   * carregamento não falha — diz apenas que ainda não há dados. Comparar o tamanho mínimo e
   * exigir que os ecrãs difiram entre si é o que impede que isso volte a acontecer.
   */
  const sizes = new Set(results.map((result) => result.bytes));
  const tooSmall = results.filter((result) => !result.minimal && result.bytes < 4000);
  if (sizes.size === 1) {
    errors.push({ name: 'diversidade', bytes: 0, error: 'todos os ecrãs renderizaram exatamente o mesmo HTML — a cache não está a ser usada' });
    console.log(`  FALHA todos os ecrãs com ${[...sizes][0]} bytes: a cache não corresponde às chaves da aplicação`);
  }
  if (tooSmall.length > 0) {
    errors.push({ name: 'conteudo', bytes: 0, error: `${tooSmall.length} ecrãs com menos de 4000 bytes` });
    console.log(`  FALHA ${tooSmall.length} ecrãs renderizaram conteúdo mínimo: ${tooSmall.map((result) => result.name).join(', ')}`);
    for (const result of tooSmall) console.log(`        ${result.name}: ${result.excerpt}`);
  }

  console.log(
    errors.length === 0
      ? `\n${rendered.length} ecrãs renderizados com conteúdo, sem erros.`
      : `\n${errors.length} problema(s) em ${rendered.length} ecrãs.`,
  );
  rmSync(SMOKE_DIR, { recursive: true, force: true });
  // `process.exit` explícito: o cliente HTTP do Node mantém ligações vivas em `keep-alive`,
  // pelo que o processo ficaria pendurado mesmo depois de o trabalho estar feito.
  process.exit(errors.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\nA verificação não pôde correr: ${error.message}`);
  console.error(
    `Isto é um problema do ambiente, não da aplicação: a verificação precisa da API em ${API}\n` +
      'com os dados de demonstração (npm run db:seed --workspace @zemlo/api).\n',
  );
  rmSync(SMOKE_DIR, { recursive: true, force: true });
  process.exit(2);
});
