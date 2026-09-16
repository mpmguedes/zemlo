/**
 * Verificação da integração em modo de produção.
 *
 * Confirma que a API serve a aplicação web compilada, que o fallback da aplicação de
 * página única funciona para um URL profundo, e que as rotas da API continuam a devolver
 * JSON — e não o `index.html`. É a fronteira entre as duas metades do sistema e a única
 * coisa que só se pode verificar com o build de produção montado.
 *
 * Uso:
 *   1. npm run build && NODE_ENV=production JWT_SECRET=… npm run start:api
 *   2. node apps/api/scripts/verify-integration.mjs
 */

const ORIGIN = process.env.ZEMLO_API_ORIGIN ?? 'http://127.0.0.1:4000';

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  \u001b[32m✓\u001b[0m ${label}${detail ? ` \u001b[90m${detail}\u001b[0m` : ''}`);
  } else {
    failed += 1;
    console.log(`  \u001b[31m✗\u001b[0m ${label}${detail ? ` \u001b[90m${detail}\u001b[0m` : ''}`);
  }
}

console.log(`\n\u001b[1mZemlo — integração API + aplicação web (produção)\u001b[0m`);
console.log(`\u001b[90m${ORIGIN}\u001b[0m\n`);

/* -------------------------------------------------------------------------- */
/* A aplicação web é servida                                                   */
/* -------------------------------------------------------------------------- */

const root = await fetch(`${ORIGIN}/`);
const html = await root.text();

check('GET / devolve 200', root.status === 200, `status ${root.status}`);
check(
  'A resposta é o index.html da aplicação web',
  html.includes('id="root"') || html.includes('id="app"'),
  root.headers.get('content-type')?.split(';')[0] ?? '',
);
check(
  'O index.html não é cacheado (uma nova versão chega no pedido seguinte)',
  (root.headers.get('cache-control') ?? '').includes('no-cache'),
  root.headers.get('cache-control') ?? '(sem cabeçalho)',
);
check('O documento declara o idioma português', /<html[^>]+lang="pt/i.test(html));

/* -------------------------------------------------------------------------- */
/* O bundle compilado é acessível e cacheável                                  */
/* -------------------------------------------------------------------------- */

const scriptMatch = /<script[^>]+src="([^"]+\.js)"/.exec(html);
check('O index.html referencia um bundle JavaScript', scriptMatch !== null, scriptMatch?.[1] ?? '');

if (scriptMatch?.[1]) {
  const assetUrl = scriptMatch[1].startsWith('http') ? scriptMatch[1] : `${ORIGIN}${scriptMatch[1]}`;
  const asset = await fetch(assetUrl);
  const cacheControl = asset.headers.get('cache-control') ?? '';
  check('O bundle JavaScript é servido', asset.status === 200, `status ${asset.status}`);
  check(
    'O bundle tem hash no nome',
    /-[A-Za-z0-9_-]{8,}\.js$/.test(assetUrl),
    assetUrl.split('/').pop() ?? '',
  );
  /*
   * Um ficheiro com hash no nome é imutável por construção: o hash muda quando o conteúdo
   * muda. `no-store` num destes obriga o browser a descarregar o bundle completo em cada
   * navegação — o oposto do que o hash serve para fazer. A distinção entre o `index.html`
   * (nunca cacheado) e os assets (cacheados para sempre) é o que torna um deploy
   * instantâneo para quem já tem a versão anterior.
   */
  check(
    'O bundle é cacheado de forma imutável',
    cacheControl.includes('immutable') || cacheControl.includes('max-age='),
    cacheControl || '(sem cabeçalho)',
  );
  check(
    'O bundle não leva a política restritiva dos dados autenticados',
    !cacheControl.includes('no-store'),
    cacheControl || '(sem cabeçalho)',
  );
}

const styleMatch = /<link[^>]+href="([^"]+\.css)"/.exec(html);
if (styleMatch?.[1]) {
  const styleUrl = styleMatch[1].startsWith('http') ? styleMatch[1] : `${ORIGIN}${styleMatch[1]}`;
  const style = await fetch(styleUrl);
  const css = await style.text();
  check('A folha de estilos é servida', style.status === 200, `status ${style.status}`);
  check(
    'O CSS contém as cores da marca (verde-petróleo e âmbar)',
    css.toUpperCase().includes('#178186') && /#D99B0B/i.test(css),
    'petrol e âmbar presentes',
  );
}

/* -------------------------------------------------------------------------- */
/* Fallback da aplicação de página única                                       */
/* -------------------------------------------------------------------------- */

for (const route of ['/vehicles/abc123', '/settings/security', '/onboarding', '/rota-inexistente']) {
  const response = await fetch(`${ORIGIN}${route}`);
  const body = await response.text();
  check(
    `GET ${route} devolve o index.html (URL profundo funciona num recarregamento)`,
    response.status === 200 && (body.includes('id="root"') || body.includes('id="app"')),
    `status ${response.status}`,
  );
}

/* -------------------------------------------------------------------------- */
/* As rotas da API continuam a devolver JSON e o estado certo                  */
/* -------------------------------------------------------------------------- */

const apiRoutes = [
  ['/api', 200, 'a raiz da API identifica o serviço'],
  ['/api/v1/vehicles', 401, 'sem token, os veículos exigem autenticação'],
  ['/api/v1/nao-existe', 404, 'um endereço inexistente devolve 404, não 401'],
];

for (const [route, expected, description] of apiRoutes) {
  const response = await fetch(`${ORIGIN}${route}`);
  const body = await response.text();
  let isJson = false;
  let code = '';
  try {
    const parsed = JSON.parse(body);
    isJson = true;
    code = parsed.error?.code ?? '';
  } catch {
    isJson = false;
  }
  check(
    `GET ${route} — ${description}`,
    isJson && response.status === expected,
    `status ${response.status}${code ? ` (${code})` : ''}${isJson ? '' : ' — devolveu HTML!'}`,
  );
}

/* -------------------------------------------------------------------------- */
/* A plataforma continua funcional                                             */
/* -------------------------------------------------------------------------- */

const health = await fetch(`${ORIGIN}/health`);
const healthBody = await health.json();
check('GET /health responde', health.status === 200, healthBody.status);
check('A base de dados está acessível', healthBody.database?.reachable === true);

const login = await fetch(`${ORIGIN}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'demo@zemlo.pt', password: 'ZemloDemo2026' }),
});
const loginBody = await login.json();
check(
  'A conta de demonstração inicia sessão',
  login.status === 200,
  loginBody.user?.email ?? JSON.stringify(loginBody).slice(0, 80),
);

if (loginBody.tokens?.accessToken) {
  const token = loginBody.tokens.accessToken;
  const headers = { Authorization: `Bearer ${token}` };

  const dashboard = await fetch(`${ORIGIN}/api/v1/dashboard`, { headers });
  const dashboardBody = await dashboard.json();
  check('O dashboard responde com dados', dashboard.status === 200, dashboardBody.vehicle?.plateDisplay ?? '');
  check(
    'Os cartões de estado são calculados',
    (dashboardBody.status ?? []).length >= 3,
    (dashboardBody.status ?? []).map((card) => `${card.key}=${card.value}`).join(' · '),
  );
  check(
    'O resumo financeiro tem valor',
    typeof dashboardBody.finance?.yearTotalCents === 'number',
    `${((dashboardBody.finance?.yearTotalCents ?? 0) / 100).toFixed(2)} €`,
  );

  const timeline = await fetch(`${ORIGIN}/api/v1/timeline?limit=5`, { headers });
  const timelineBody = await timeline.json();
  check('A timeline responde', timeline.status === 200, `${timelineBody.items?.length ?? 0} itens`);

  const stats = await fetch(`${ORIGIN}/api/v1/stats`, { headers });
  check('As estatísticas respondem', stats.status === 200);

  const exportResponse = await fetch(`${ORIGIN}/api/v1/export?format=csv`, { headers });
  const csvBytes = Buffer.from(await exportResponse.arrayBuffer());
  check('A exportação CSV responde', exportResponse.status === 200, `${Math.round(csvBytes.length / 1024)} KB`);
  check(
    'A exportação CSV começa com BOM UTF-8',
    csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf,
    csvBytes.subarray(0, 3).toString('hex'),
  );
}

/* -------------------------------------------------------------------------- */

console.log(`\n  \u001b[32m${passed} verificações de integração passaram\u001b[0m`);
if (failed > 0) console.log(`  \u001b[31m${failed} falharam\u001b[0m`);
console.log('');

process.exitCode = failed > 0 ? 1 : 0;
