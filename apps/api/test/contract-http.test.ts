/**
 * Teste de contrato entre `packages/shared` e a API (`TEST-002`).
 *
 * ## O que é que isto prova
 *
 * O contrato partilhado é "a única definição de despesa ou lembrete no projeto"
 * (`docs/ROADMAP.md` §6). Nada verificava automaticamente que a API o cumpre. Esta suite
 * verifica as duas metades da afirmação, e cada uma tem uma fonte de verdade diferente:
 *
 *  1. **A API aplica os esquemas de `contracts.ts`.** As violações não são escritas à mão:
 *     são **derivadas do próprio esquema** — retirar um campo que o esquema declara
 *     obrigatório, ou substituir o valor de um campo por um valor do tipo errado. Cada
 *     violação derivada é **confirmada contra o esquema** antes de ser enviada, pelo que o
 *     teste não pode afirmar sobre a API algo que o contrato permite.
 *
 *  2. **A resposta real tem a forma declarada em `types.ts`.** O oráculo é o **mapeador da
 *     API** (`domain/payload.ts`): `mapVehicleSummary`, `mapVehicleDetail`, `mapExpense`,
 *     `mapReminder`, `mapSource`, e `evaluateReminder` para `ReminderEvaluation`. Todos
 *     estão anotados com o tipo do contrato (`: VehicleSummary`, …) e vivem em `src/`, pelo
 *     que o `typecheck` do projeto **obriga** o literal devolvido a ter exatamente os campos
 *     declarados — nem um a menos (erro de propriedade em falta) nem um a mais (verificação
 *     de propriedade excedente). Comparar as chaves da resposta com as chaves do mapeador
 *     é, por isso, comparar com o contrato **sem escrever uma segunda lista de campos** que
 *     pudesse divergir em silêncio. É a razão pela qual este teste não reimplementa nada:
 *     usa a produção como oráculo.
 *
 * ## O que é que a comparação apanha, se a compilação já garante o tipo
 *
 * A serialização. O mapeador devolve objetos TypeScript; o cliente recebe `JSON`. Um campo
 * declarado `string | null` que o mapeador devolva como `undefined` **desaparece** na
 * resposta (o `JSON.stringify` omite chaves indefinidas) e o cliente passa a ver uma chave
 * ausente onde o contrato promete uma chave presente. O `typecheck` não vê isso — o objeto
 * em memória está correto. Esta suite compara as chaves **depois** da serialização, e é
 * esse o buraco que fecha.
 *
 * ## Porque é que o oráculo é o mapeador, e não uma lista escrita aqui
 *
 * Uma lista de campos escrita neste ficheiro seria uma segunda definição do contrato. Nada
 * a obrigaria a acompanhar `types.ts`, e a divergência seria silenciosa — exatamente o
 * defeito que a suite existe para apanhar. Usar o mapeador elimina a lista. O que **fica
 * por garantir** está declarado em baixo.
 *
 * ## O que estes testes não fazem (declarado, para não se ler mais do que está provado)
 *
 *  - **Não verificam o corpo do mapeador.** Se a anotação de retorno de `mapExpense` for
 *    removida, a comparação continua verde e a garantia de completude desaparece sem ruído.
 *    A anotação é a única coisa que liga o mapeador ao contrato; a sua remoção não é
 *    detetada aqui (nem pelo `typecheck`, que deixaria de ter o que verificar).
 *  - **Não verificam os envelopes de lista que não estão declarados.** `Page<T>` declara
 *    `{ items, nextCursor, total? }`. `GET /records/expenses` devolve-o; `GET /vehicles`
 *    devolve `{ items, total }` e `GET /reminders` devolve `{ items, counts, total }`. Esses
 *    dois envelopes não têm tipo declarado em `types.ts` — são literais escritos na rota — e
 *    por isso **não são afirmados aqui**: afirmá-los obrigaria a decidir se a API passa a
 *    cumprir `Page<T>` ou se o contrato passa a declarar o que existe, e essa é uma decisão
 *    de contrato (§6), não de um teste. Está medido e registado como achado para o A9.
 *  - **Não cobrem todas as rotas.** O âmbito são os dois recursos que o §6 nomeia — despesas
 *    e lembretes — mais o veículo, que é a raiz de que ambos dependem. As restantes rotas
 *    (`documents`, `integrations`, `import`, `insights`, …) ficam fora, por âmbito fechado.
 *  - **`ApiErrorBody` é a única forma afirmada com uma lista escrita à mão.** Não há mapeador
 *    de erros: o envelope é construído no middleware de erros. A lista tem quatro chaves e
 *    está assinalada no teste.
 *
 * ## A base de dados
 *
 * `DATABASE_URL` antes do import da aplicação, base temporária fora do repositório,
 * destruída no fim, conta própria por teste — como em `financial-http.test.ts`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

import { createTestDb, type TestDb } from './helpers/db.js';

/* -------------------------------------------------------------------------- */
/* Infraestrutura                                                              */
/* -------------------------------------------------------------------------- */

let db: TestDb;
let app: Express;
/** Tipo real do cliente ligado à base temporária — inferido, para não alargar o `as`. */
let appPrisma: (typeof import('../src/core/db.js'))['prisma'];
let payload: typeof import('../src/domain/payload.js');
let dominio: typeof import('../src/domain/reminders.js');
let contratos: typeof import('@zemlo/shared');
let token: string;

beforeAll(async () => {
  db = await createTestDb();

  process.env.DATABASE_URL = db.url;
  process.env.DATABASE_PROVIDER = 'sqlite';
  process.env.NODE_ENV = 'test';

  const [{ createApp }, { prisma }, payloadModule, dominioModule, shared] = await Promise.all([
    import('../src/app.js'),
    import('../src/core/db.js'),
    import('../src/domain/payload.js'),
    import('../src/domain/reminders.js'),
    import('@zemlo/shared'),
  ]);

  appPrisma = prisma;
  payload = payloadModule;
  dominio = dominioModule;
  contratos = shared;
  app = createApp();

  const sonda = await appPrisma.user.create({
    data: { email: 'sonda-contrato@zemlo.test', name: 'Sonda' },
    select: { id: true },
  });
  expect(
    await db.prisma.user.findUnique({ where: { id: sonda.id } }),
    'A aplicação não está ligada à base de dados temporária. O DATABASE_URL não foi aplicado antes de a app ser importada.',
  ).not.toBeNull();
  await appPrisma.user.deleteMany();
}, 120_000);

afterAll(async () => {
  await appPrisma.$disconnect();
  await db.destroy();
});

beforeEach(async () => {
  token = await signup(`contrato-${Math.random().toString(36).slice(2, 10)}@zemlo.test`);
});

/* -------------------------------------------------------------------------- */
/* Utilitários                                                                 */
/* -------------------------------------------------------------------------- */

async function signup(email: string): Promise<string> {
  const response = await request(app)
    .post('/api/v1/auth/signup')
    .set('Content-Type', 'application/json')
    .send({ email, password: 'Password123!', name: 'Teste', acceptedTerms: true });

  if (response.status !== 201) {
    throw new Error(
      `Não foi possível criar a sessão de teste (${response.status}): ${JSON.stringify(response.body)}`,
    );
  }

  return response.body.tokens.accessToken as string;
}

/** Envia um corpo para a rota de criação, autenticado. */
function enviar(rota: string, corpo: unknown) {
  return request(app)
    .post(rota)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .send(corpo as object);
}

function ler(url: string) {
  return request(app).get(url).set('Authorization', `Bearer ${token}`);
}

/** Cria um veículo e devolve o identificador. A raiz de que despesas e lembretes dependem. */
async function criarVeiculo(): Promise<string> {
  const resposta = await enviar('/api/v1/vehicles', { plate: 'AA-00-AA' });
  expect(resposta.status, JSON.stringify(resposta.body)).toBe(201);
  return resposta.body.id as string;
}

/** Chaves de um valor, ordenadas. */
function chaves(valor: unknown): string[] {
  if (valor === null || typeof valor !== 'object') return [];
  return Object.keys(valor as Record<string, unknown>).sort();
}

/** Chaves como elas chegam ao cliente: depois do `JSON.stringify` que a API faz. */
function chavesNaRede(valor: unknown): string[] {
  return chaves(JSON.parse(JSON.stringify(valor)) as unknown);
}

/**
 * Compara a forma da resposta com a forma declarada.
 *
 * A mensagem imprime as duas listas: quando isto falha, a pergunta "que campo mudou?" tem de
 * ser respondível sem abrir o depurador.
 */
function compararForma(rotulo: string, real: unknown, oraculo: unknown): void {
  const naResposta = chaves(real);
  const declaradas = chavesNaRede(oraculo);
  expect(
    naResposta,
    `${rotulo}\n  chaves na resposta: ${naResposta.join(', ')}\n  declaradas no tipo: ${declaradas.join(', ')}`,
  ).toEqual(declaradas);
}

/* -------------------------------------------------------------------------- */
/* Derivação de violações a partir do próprio esquema                          */
/* -------------------------------------------------------------------------- */

/**
 * Vista estrutural de um esquema Zod.
 *
 * O contrato é importado como `unknown` — o teste não deve depender da forma interna do Zod
 * para além do que precisa (`shape`, `isOptional`, `safeParse`). A conversão está confinada
 * a esta função e é o único `as` do ficheiro.
 */
interface EsquemaObservavel {
  shape: Record<string, unknown>;
  safeParse: (valor: unknown) => {
    success: boolean;
    error?: { issues: Array<{ path: Array<string | number>; message: string }> };
  };
}

function comoEsquema(esquema: unknown): EsquemaObservavel {
  return esquema as EsquemaObservavel;
}

/** Campos que o esquema exige. `isOptional()` cobre `.optional()`, `.nullish()` e `.default()`. */
function camposObrigatorios(esquema: unknown): string[] {
  const { shape } = comoEsquema(esquema);
  return Object.entries(shape)
    .filter(([, campo]) => !(campo as { isOptional: () => boolean }).isOptional())
    .map(([nome]) => nome);
}

/** Pergunta ao esquema o que ele faz com um corpo. A fonte de verdade é o contrato, não o teste. */
function analisar(esquema: unknown, corpo: unknown): { aceita: boolean; caminhos: string[]; mensagens: string[] } {
  const resultado = comoEsquema(esquema).safeParse(corpo);
  if (resultado.success) return { aceita: true, caminhos: [], mensagens: [] };
  const issues = resultado.error?.issues ?? [];
  return {
    aceita: false,
    caminhos: issues.map((issue) => issue.path.join('.')),
    mensagens: issues.map((issue) => issue.message),
  };
}

/** Vista estrutural de um nó de esquema, para desembrulhar modificadores. */
interface NoZod {
  _def?: { typeName?: string; innerType?: NoZod; schema?: NoZod };
}

/**
 * Valor que o esquema recusa **por tipo**, derivado do tipo que o campo declara.
 *
 * Cobre os tipos primitivos que aparecem nos esquemas de criação e os enums. Devolve `null`
 * para o que não sabe derivar (objetos aninhados, arrays): uma substituição inventada não
 * seria uma violação garantida, e o teste prefere não afirmar a afirmar mal.
 */
function valorDeTipoErrado(campo: unknown): { valor: unknown; motivo: string } | null {
  let no = campo as NoZod;
  // Desembrulha `.optional()`, `.nullish()`, `.default()` e `.refine()` até ao tipo que
  // valida o valor: um modificador não muda o tipo do que é aceite, só a sua presença.
  while (no?._def?.innerType || no?._def?.schema) {
    no = (no._def.innerType ?? no._def.schema) as NoZod;
  }

  switch (no?._def?.typeName) {
    case 'ZodString':
      return { valor: 12345, motivo: 'número onde o contrato exige texto' };
    case 'ZodNumber':
      return { valor: 'não é um número', motivo: 'texto onde o contrato exige número' };
    case 'ZodBoolean':
      return { valor: 'sim', motivo: 'texto onde o contrato exige booleano' };
    case 'ZodEnum':
      return { valor: '__valor_que_o_contrato_nao_conhece__', motivo: 'valor fora do enum do contrato' };
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Os recursos cobertos                                                        */
/* -------------------------------------------------------------------------- */

interface Recurso {
  nome: string;
  /** Rota de criação real. O `POST` é o ponto onde o contrato é aplicado. */
  rota: string;
  esquema: () => unknown;
  /** Corpo que o contrato aceita. Só é usado depois de confirmado contra o esquema. */
  valido: (veiculoId: string) => Record<string, unknown>;
  /**
   * Valores que o esquema recusa por **conteúdo** e não por tipo — não são deriváveis a
   * partir do tipo do campo, pelo que estão declarados. Cada um é confirmado contra o
   * esquema antes de ser enviado.
   */
  conteudo: Array<{ campo: string; valor: unknown; motivo: string }>;
}

function recursos(): Recurso[] {
  return [
    {
      nome: 'zVehicleCreateRequest',
      rota: '/api/v1/vehicles',
      esquema: () => contratos.zVehicleCreateRequest,
      // Matrícula distinta da de `criarVeiculo()`: a mesma matrícula na mesma conta é
      // recusada com 409 (matrícula duplicada), e o controlo positivo mediria isso em vez
      // do que quer medir — que o contrato aceita o corpo.
      valido: () => ({ plate: 'BB-11-BB', make: 'Seat', model: 'Ibiza', year: 2019 }),
      conteudo: [{ campo: 'plate', valor: '', motivo: 'matrícula vazia — abaixo do mínimo do esquema' }],
    },
    {
      nome: 'zExpenseCreateRequest',
      rota: '/api/v1/records/expenses',
      esquema: () => contratos.zExpenseCreateRequest,
      valido: (veiculoId) => ({ amountCents: 1234, category: 'fuel', vehicleId: veiculoId, vendor: 'Galp' }),
      conteudo: [
        { campo: 'amountCents', valor: 0, motivo: 'o esquema recusa explicitamente o valor zero' },
        { campo: 'date', valor: '2026-02-30', motivo: 'data que não existe no calendário' },
      ],
    },
    {
      nome: 'zReminderCreateRequest',
      rota: '/api/v1/reminders',
      esquema: () => contratos.zReminderCreateRequest,
      valido: (veiculoId) => ({
        vehicleId: veiculoId,
        title: 'Trocar óleo',
        trigger: 'time',
        dueDate: '2026-12-01',
      }),
      conteudo: [
        { campo: 'intervalKm', valor: 50, motivo: 'intervalo abaixo do mínimo de 100 km do esquema' },
      ],
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* 1. A API cumpre os esquemas de `contracts.ts`                               */
/* -------------------------------------------------------------------------- */

describe('contrato: a API cumpre os esquemas de `contracts.ts`', () => {
  it('cada esquema declara pelo menos um campo obrigatório', () => {
    // Sem isto, a derivação de "corpo a que falta um campo obrigatório" produziria zero
    // casos e o teste seguinte passaria por vacuidade — um verde que não prova nada.
    for (const recurso of recursos()) {
      expect(
        camposObrigatorios(recurso.esquema()).length,
        `${recurso.nome} não declara nenhum campo obrigatório: a derivação de violações ficaria vazia`,
      ).toBeGreaterThan(0);
    }
  });

  it('recusa um corpo a que falta cada campo obrigatório do esquema, nomeando o campo', async () => {
    const veiculoId = await criarVeiculo();
    const falhas: string[] = [];

    for (const recurso of recursos()) {
      for (const campo of camposObrigatorios(recurso.esquema())) {
        const corpo: Record<string, unknown> = { ...recurso.valido(veiculoId) };
        delete corpo[campo];

        const veredicto = analisar(recurso.esquema(), corpo);
        if (veredicto.aceita) {
          falhas.push(
            `esquema: ${recurso.nome} aceita um corpo sem «${campo}» — deixou de ser uma violação, a asserção ficou vazia`,
          );
          continue;
        }

        const resposta = await enviar(recurso.rota, corpo);
        if (resposta.status !== 422) {
          falhas.push(
            `API: POST ${recurso.rota} sem «${campo}» -> ${resposta.status} (esperado 422) ${JSON.stringify(resposta.body)}`,
          );
          continue;
        }
        if (resposta.body?.error?.code !== 'validation_error') {
          falhas.push(
            `API: POST ${recurso.rota} sem «${campo}» -> 422 com código «${resposta.body?.error?.code}» (esperado validation_error)`,
          );
          continue;
        }
        // A recusa tem de vir da **validação do esquema**, e não de uma regra do serviço que
        // por acaso também recusa este corpo. `fields` só é preenchido por `validationFailed`
        // (`core/errors.ts:49`); um `unprocessable` do serviço não o traz.
        const nomeados = (resposta.body.error.fields ?? []).map((f: { path: string }) => f.path);
        if (!nomeados.includes(campo)) {
          falhas.push(
            `API: POST ${recurso.rota} sem «${campo}» -> recusado, mas o erro não nomeia esse campo (${nomeados.join(', ') || 'nenhum'}) — a recusa não veio da validação do esquema`,
          );
        }
      }
    }

    expect(falhas, falhas.join('\n')).toEqual([]);
  });

  it('recusa um valor de tipo errado em cada campo que o esquema declara', async () => {
    const veiculoId = await criarVeiculo();
    const falhas: string[] = [];
    let derivadas = 0;

    for (const recurso of recursos()) {
      const base = recurso.valido(veiculoId);
      const { shape } = comoEsquema(recurso.esquema());

      for (const [campo, definicao] of Object.entries(shape)) {
        const substituicao = valorDeTipoErrado(definicao);
        if (!substituicao) continue;
        derivadas += 1;

        const corpo = { ...base, [campo]: substituicao.valor };
        const veredicto = analisar(recurso.esquema(), corpo);
        if (veredicto.aceita) {
          falhas.push(`esquema: ${recurso.nome}.${campo} aceita ${substituicao.motivo} — não é uma violação`);
          continue;
        }
        if (!veredicto.caminhos.includes(campo)) {
          falhas.push(
            `derivação: ${recurso.nome}.${campo} é recusado em «${veredicto.caminhos.join(', ')}» e não no próprio campo — a asserção apontaria ao campo errado`,
          );
          continue;
        }

        const resposta = await enviar(recurso.rota, corpo);
        if (resposta.status !== 422) {
          falhas.push(
            `API: POST ${recurso.rota} com ${substituicao.motivo} em «${campo}» -> ${resposta.status} (esperado 422)`,
          );
          continue;
        }
        const nomeados = (resposta.body?.error?.fields ?? []).map((f: { path: string }) => f.path);
        if (!nomeados.includes(campo)) {
          falhas.push(
            `API: POST ${recurso.rota} com ${substituicao.motivo} em «${campo}» -> recusado sem nomear esse campo (${nomeados.join(', ') || 'nenhum'})`,
          );
        }
      }
    }

    // Se a derivação deixar de produzir casos, o teste acima passa sem afirmar nada.
    expect(derivadas, 'a derivação de substituições de tipo não produziu nenhum caso').toBeGreaterThan(0);
    expect(falhas, falhas.join('\n')).toEqual([]);
  });

  it('recusa os valores que o esquema recusa por conteúdo', async () => {
    const veiculoId = await criarVeiculo();
    const falhas: string[] = [];

    for (const recurso of recursos()) {
      for (const caso of recurso.conteudo) {
        const corpo = { ...recurso.valido(veiculoId), [caso.campo]: caso.valor };

        const veredicto = analisar(recurso.esquema(), corpo);
        if (veredicto.aceita) {
          falhas.push(
            `esquema: ${recurso.nome} aceita «${caso.campo}: ${JSON.stringify(caso.valor)}» (${caso.motivo}) — a asserção ficou vazia`,
          );
          continue;
        }

        const resposta = await enviar(recurso.rota, corpo);
        if (resposta.status !== 422) {
          falhas.push(
            `API: POST ${recurso.rota} com «${caso.campo}: ${JSON.stringify(caso.valor)}» (${caso.motivo}) -> ${resposta.status} (esperado 422)`,
          );
          continue;
        }
        const nomeados = (resposta.body?.error?.fields ?? []).map((f: { path: string }) => f.path);
        if (!nomeados.includes(caso.campo)) {
          falhas.push(
            `API: POST ${recurso.rota} com «${caso.campo}: ${JSON.stringify(caso.valor)}» -> recusado sem nomear esse campo (${nomeados.join(', ') || 'nenhum'})`,
          );
        }
      }
    }

    expect(falhas, falhas.join('\n')).toEqual([]);
  });

  it('aceita o corpo que o esquema aceita — controlo positivo', async () => {
    const veiculoId = await criarVeiculo();

    for (const recurso of recursos()) {
      const corpo = recurso.valido(veiculoId);
      const veredicto = analisar(recurso.esquema(), corpo);
      expect(
        veredicto.aceita,
        `${recurso.nome} devia aceitar o corpo base do teste, e recusou-o em [${veredicto.caminhos.join(', ')}]: ${veredicto.mensagens.join('; ')}`,
      ).toBe(true);

      const resposta = await enviar(recurso.rota, corpo);
      expect(
        resposta.status,
        `POST ${recurso.rota} -> ${resposta.status} ${JSON.stringify(resposta.body)}`,
      ).toBe(201);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 2. A resposta real tem a forma declarada em `types.ts`                      */
/* -------------------------------------------------------------------------- */

const AGORA = new Date('2026-09-22T10:00:00.000Z');
const FONTE = { kind: 'manual', label: 'Manual', integrationId: null, observedAt: null };

/** Oráculo de `VehicleSummary`: o mapeador da API, anotado com o tipo do contrato. */
function oraculoResumo() {
  return payload.mapVehicleSummary({
    id: 'v-oraculo',
    plate: 'AA-00-AA',
    plateDisplay: 'AA-00-AA',
    make: 'Seat',
    model: 'Ibiza',
    version: null,
    year: 2019,
    vehicleType: 'car',
    fuelType: 'diesel',
    nickname: null,
    archived: false,
    odometerKm: 42_000,
    odometerSource: FONTE,
    odometerUpdatedAt: AGORA,
    createdAt: AGORA,
    updatedAt: AGORA,
  });
}

/** Oráculo de `VehicleDetail`. */
function oraculoDetalhe() {
  return payload.mapVehicleDetail(
    {
      id: 'v-oraculo',
      plate: 'AA-00-AA',
      plateDisplay: 'AA-00-AA',
      make: 'Seat',
      model: 'Ibiza',
      version: null,
      year: 2019,
      vehicleType: 'car',
      fuelType: 'diesel',
      nickname: null,
      archived: false,
      odometerKm: 42_000,
      odometerSource: FONTE,
      odometerUpdatedAt: AGORA,
      createdAt: AGORA,
      updatedAt: AGORA,
    },
    { expenses: 1, fuel: 0, charging: 0, maintenance: 0, documents: 0, reminders: 1 },
    1234,
  );
}

/** Oráculo de `Expense`. */
function oraculoDespesa() {
  return payload.mapExpense({
    id: 'e-oraculo',
    vehicleId: 'v-oraculo',
    amountCents: 1234,
    vatCents: null,
    category: 'fuel',
    date: new Date('2026-09-22T00:00:00.000Z'),
    vendor: 'Galp',
    odometerKm: 42_100,
    description: null,
    paymentMethod: null,
    paid: true,
    linkedRecordId: null,
    notes: null,
    source: FONTE,
    createdAt: AGORA,
    updatedAt: AGORA,
  });
}

/**
 * Oráculo de `ReminderEvaluation`.
 *
 * `evaluateReminder` devolve `ReminderEvaluation` por anotação (`domain/reminders.ts:75`),
 * pelo que o literal tem de ter todos os campos declarados. É a mesma garantia dos mapeadores.
 */
function oraculoAvaliacao() {
  return dominio.evaluateReminder(
    {
      id: 'r-oraculo',
      title: 'Trocar óleo',
      trigger: 'time',
      dueDate: '2026-12-01',
      dueOdometerKm: null,
      completedAt: null,
    },
    {
      today: '2026-09-22',
      odometerKm: 42_000,
      usage: { kmPerDay: null, kmPerMonth: null, kmPerYear: null, samplesUsed: 0, confident: false },
      leadDays: 30,
      leadKm: 1000,
    },
  );
}

/** Oráculo de `Reminder`. */
function oraculoLembrete() {
  return payload.mapReminder(
    {
      id: 'r-oraculo',
      vehicleId: 'v-oraculo',
      title: 'Trocar óleo',
      trigger: 'time',
      dueDate: new Date('2026-12-01T00:00:00.000Z'),
      dueOdometerKm: null,
      intervalMonths: null,
      intervalKm: null,
      repeat: false,
      notes: null,
      completedAt: null,
      createdAt: AGORA,
      updatedAt: AGORA,
    },
    oraculoAvaliacao(),
  );
}

describe('contrato: a resposta real tem a forma declarada em `types.ts`', () => {
  it('POST /vehicles e GET /vehicles/:id devolvem exatamente `VehicleDetail`', async () => {
    const criado = await enviar('/api/v1/vehicles', { plate: 'AA-00-AA', make: 'Seat', model: 'Ibiza' });
    expect(criado.status, JSON.stringify(criado.body)).toBe(201);
    compararForma('POST /vehicles ↔ VehicleDetail', criado.body, oraculoDetalhe());

    const detalhe = await ler(`/api/v1/vehicles/${criado.body.id}`);
    expect(detalhe.status, JSON.stringify(detalhe.body)).toBe(200);
    compararForma('GET /vehicles/:id ↔ VehicleDetail', detalhe.body, oraculoDetalhe());

    // `counts` e `odometerSource` são formas aninhadas declaradas; o tipo garante-as, mas a
    // serialização pode esvaziá-las, e é isso que aqui se mede.
    compararForma('VehicleDetail.counts', detalhe.body.counts, oraculoDetalhe().counts);
    compararForma('VehicleDetail.odometerSource', detalhe.body.odometerSource, payload.mapSource(FONTE));
  });

  it('o item de GET /vehicles tem exatamente a forma de `VehicleSummary`', async () => {
    await criarVeiculo();

    const lista = await ler('/api/v1/vehicles');
    expect(lista.status, JSON.stringify(lista.body)).toBe(200);
    expect(Array.isArray(lista.body.items), 'GET /vehicles não devolveu `items` como lista').toBe(true);
    expect(lista.body.items.length).toBeGreaterThan(0);

    compararForma('GET /vehicles[].item ↔ VehicleSummary', lista.body.items[0], oraculoResumo());
    compararForma(
      'VehicleSummary.odometerSource',
      lista.body.items[0].odometerSource,
      payload.mapSource(FONTE),
    );
  });

  it('POST /records/expenses devolve exatamente `Expense`, com `SourceInfo` completo', async () => {
    const veiculoId = await criarVeiculo();

    const criada = await enviar('/api/v1/records/expenses', {
      amountCents: 1234,
      category: 'fuel',
      vehicleId: veiculoId,
      vendor: 'Galp',
    });
    expect(criada.status, JSON.stringify(criada.body)).toBe(201);

    compararForma('POST /records/expenses ↔ Expense', criada.body, oraculoDespesa());
    compararForma('Expense.source ↔ SourceInfo', criada.body.source, payload.mapSource(FONTE));
  });

  it('o item de GET /records/expenses tem exatamente a forma de `Expense`', async () => {
    const veiculoId = await criarVeiculo();
    await enviar('/api/v1/records/expenses', { amountCents: 1234, category: 'fuel', vehicleId: veiculoId });

    const lista = await ler('/api/v1/records/expenses');
    expect(lista.status, JSON.stringify(lista.body)).toBe(200);
    expect(Array.isArray(lista.body.items)).toBe(true);
    expect(lista.body.items.length).toBeGreaterThan(0);

    compararForma('GET /records/expenses[].item ↔ Expense', lista.body.items[0], oraculoDespesa());
  });

  it('o envelope de GET /records/expenses é `Page<Expense>`', async () => {
    // `listExpenses` está anotado `Promise<Page<ExpenseView>>` e a rota devolve-o sem o
    // reembrulhar, pelo que a anotação é a fonte de verdade. A lista de chaves do envelope é
    // **escrita à mão** — `Page<T>` é pequeno e estável, e não existe mapeador de envelopes.
    const esperado = ['items', 'nextCursor', 'total'];

    await criarVeiculo();
    const lista = await ler('/api/v1/records/expenses');
    expect(lista.status, JSON.stringify(lista.body)).toBe(200);

    const presentes = chaves(lista.body);
    expect(
      presentes.filter((chave) => !esperado.includes(chave)),
      `GET /records/expenses devolveu chaves que \`Page<T>\` não declara: ${presentes.join(', ')}`,
    ).toEqual([]);
    for (const chave of ['items', 'nextCursor']) {
      expect(presentes, `\`Page<T>\` declara «${chave}» como obrigatório e ele não veio`).toContain(chave);
    }
  });

  it('POST /reminders devolve exatamente `Reminder`, com `ReminderEvaluation` completo', async () => {
    const veiculoId = await criarVeiculo();

    const criado = await enviar('/api/v1/reminders', {
      vehicleId: veiculoId,
      title: 'Trocar óleo',
      trigger: 'time',
      dueDate: '2026-12-01',
    });
    expect(criado.status, JSON.stringify(criado.body)).toBe(201);

    compararForma('POST /reminders ↔ Reminder', criado.body, oraculoLembrete());
    compararForma(
      'Reminder.evaluation ↔ ReminderEvaluation',
      criado.body.evaluation,
      oraculoAvaliacao(),
    );
  });

  it('o envelope de erro é `ApiErrorBody`', async () => {
    // Única forma afirmada com lista escrita à mão: não há mapeador de erros — o envelope é
    // construído no middleware. `fields` e `requestId` são opcionais no tipo; `code` e
    // `message` não são.
    const declaradas = ['code', 'fields', 'message', 'requestId'];

    const resposta = await enviar('/api/v1/vehicles', { plate: '' });
    expect(resposta.status, JSON.stringify(resposta.body)).toBe(422);

    expect(chaves(resposta.body), '`ApiErrorBody` declara exatamente a chave `error`').toEqual(['error']);
    const dentro = chaves(resposta.body.error);
    expect(
      dentro.filter((chave) => !declaradas.includes(chave)),
      `o envelope de erro trouxe chaves que \`ApiErrorBody\` não declara: ${dentro.join(', ')}`,
    ).toEqual([]);
    for (const chave of ['code', 'message']) {
      expect(dentro, `\`ApiErrorBody\` exige «${chave}»`).toContain(chave);
    }
    expect(typeof resposta.body.error.code).toBe('string');
    expect(typeof resposta.body.error.message).toBe('string');
  });
});
