/**
 * Base de dados temporária para os testes que precisam de Prisma.
 *
 * ## Porque é que este ficheiro existe
 *
 * Dos 635 testes do projeto, **nenhum** tocava em Prisma até aqui: os `verify:*` são
 * scripts de linha de comando que correm contra a `prisma/sqlite/dev.db`, e o Vitest corre
 * sem `.env` (injecta `NODE_ENV=test`, e o `core/config.ts` só carrega o `.env` fora de
 * teste) — pelo que `DATABASE_URL` nem sequer existe no processo.
 *
 * A importação nativa é a primeira funcionalidade cujo comportamento **não é observável
 * sem uma base de dados a sério**. O rollback, a atomicidade de um lote, a violação de um
 * `@@unique`, a cascata de um `onDelete` e o isolamento por `userId` são propriedades do
 * motor, não do código: um duplo em memória testaria a nossa imitação das regras, não as
 * regras. É por isso que este helper levanta uma base de dados real.
 *
 * ## Porque é que não invade a infraestrutura existente
 *
 * Não altera `verify:*`, não altera `db:integrity`, não acrescenta `vitest.config` nem
 * `globalSetup`. Cada ficheiro de teste que precise de base de dados chama `createTestDb()`
 * e fica com a sua — criada, usada e destruída dentro do próprio ficheiro. Os testes que
 * não precisam continuam a não precisar, e a ausência de configuração global é o que
 * garante que assim continue.
 *
 * ## O que este helper garante
 *
 *  - **Isolamento.** Um ficheiro por chamada, num directório temporário do sistema. Duas
 *    suites a correr em paralelo não se vêem uma à outra.
 *  - **Nunca toca na `dev.db`.** O `DATABASE_URL` é sempre um caminho temporário; a
 *    `dev.db` do projeto não é aberta, copiada nem referida.
 *  - **Destruição mesmo depois de uma falha.** A limpeza é registada no `afterAll` pelo
 *    próprio chamador, e a remoção do directório é `force` — um teste que rebente a meio
 *    não deixa lixo para trás.
 *  - **Sem artefactos no working tree.** O directório temporário vive fora do repositório.
 *
 * ## Como se usa
 *
 * ```ts
 * let db: TestDb;
 * beforeAll(async () => { db = await createTestDb(); }, 120_000);
 * afterAll(async () => { await db.destroy(); });
 * ```
 *
 * O `timeout` alargado no `beforeAll` não é decorativo: o primeiro `db push` compila o
 * esquema e leva cerca de vinte segundos, acima do limite de dez do Vitest.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@zemlo/prisma-sqlite';

const here = dirname(fileURLToPath(import.meta.url));
/** Raiz da API: este ficheiro vive em `apps/api/test/helpers/`. */
const apiRoot = resolve(here, '..', '..');

/** Caminho do esquema SQLite derivado (A1: o canónico é o PostgreSQL). */
const SQLITE_SCHEMA = 'prisma/sqlite/schema.sqlite.prisma';

/** Base de dados de teste, com o cliente já ligado. */
export interface TestDb {
  readonly prisma: PrismaClient;
  /** Cadeia de ligação em uso. Útil para diagnosticar e para asserções de isolamento. */
  readonly url: string;
  /** Directório temporário. */
  readonly dir: string;
  /** Fecha o cliente e apaga o ficheiro e o directório. Idempotente. */
  destroy(): Promise<void>;
}

/**
 * Cria uma base de dados SQLite temporária com o esquema completo.
 *
 * O esquema é aplicado com `prisma db push` sobre **o mesmo** `schema.sqlite.prisma` que a
 * aplicação usa. Não há um esquema de teste separado: um segundo esquema divergiria do
 * primeiro, e os testes passariam a validar uma base de dados que ninguém põe em produção.
 * É a razão pela qual esta opção foi escolhida em vez de usar um duplo em memória.
 */
export async function createTestDb(): Promise<TestDb> {
  const dir = mkdtempSync(join(tmpdir(), 'zemlo-test-'));
  const file = join(dir, 'test.db');
  const url = `file:${file}`;

  /*
   * `db push` e não `migrate deploy`: o `push` deriva o esquema do ficheiro `.prisma` e é
   * o comando que o projeto já usa para preparar a base de dados local (`db:reset`).
   * `--skip-generate` é essencial — a geração do cliente é um passo caro que não muda
   * nada aqui, e reexecutá-la por cada ficheiro de teste multiplicaria o custo sem
   * benefício. O cliente já está gerado e é importado de `@zemlo/prisma-sqlite`.
   */
  execFileSync(
    'npx',
    ['prisma', 'db', 'push', '--schema', SQLITE_SCHEMA, '--skip-generate'],
    {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
      shell: true,
    },
  );

  const prisma = new PrismaClient({ datasources: { db: { url } } });

  let destroyed = false;

  return {
    prisma,
    url,
    dir,
    async destroy(): Promise<void> {
      if (destroyed) return;
      destroyed = true;
      await prisma.$disconnect();
      await removeTree(dir);
    },
  };
}

/**
 * Apaga a árvore temporária, com repetição sobre o bloqueio do ficheiro.
 *
 * `$disconnect()` resolve **antes** de o sistema libertar o handle do SQLite. No Windows essa
 * janela é suficiente para o `rmSync` rebentar com `EBUSY`, e a consequência medida foi
 * desproporcionada: **exit code 1 com todos os testes verdes** — um ficheiro marcado como falhado
 * por causa do teardown (`PC-26`). Num CI isso é pior do que um erro: é um semáforo vermelho ao
 * acaso, e ao segundo dia alguém desliga o CI.
 *
 * A repetição é **limitada** e o erro original é **relançado** quando as tentativas se esgotam —
 * não se engole nada. Um bloqueio persistente continua a ser uma falha, e é isso que se quer.
 *
 * Exportada para poder ser exercida directamente contra um erro transitório injectado
 * (`test/teardown-retry.test.ts`) — a corrida não se reproduz de forma fiável, pelo que um teste
 * que dependesse de a provocar a sério seria intermitente, que é precisamente o defeito.
 */
export async function removeTree(dir: string, attempts = 5): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      // `force` e `recursive`: um teste que falhe a meio pode ter deixado o ficheiro
      // aberto, e o objectivo é não deixar lixo em disco.
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const transitorio = code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY';
      if (!transitorio || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Construção de dados                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Cria um utilizador com o mínimo necessário.
 *
 * `email` é único no modelo, pelo que dois utilizadores do mesmo teste precisam de emails
 * diferentes — é isso que permite testar o isolamento por `userId`, que é uma das
 * propriedades que a §7.3 exige e que só uma base de dados real prova.
 */
export async function createUser(
  db: TestDb,
  overrides: { email?: string; name?: string } = {},
): Promise<{ id: string; email: string }> {
  const email = overrides.email ?? `user-${Math.random().toString(36).slice(2, 10)}@zemlo.test`;
  const user = await db.prisma.user.create({
    data: { email, name: overrides.name ?? 'Utilizador de teste' },
    select: { id: true, email: true },
  });
  return user;
}

/**
 * Cria um veículo pertencente a um utilizador.
 *
 * A matrícula tem de ser normalizada (maiúsculas, sem separadores) e única por utilizador
 * — `@@unique([userId, plate])` —, pelo que dois veículos do mesmo utilizador com a mesma
 * matrícula falham na base de dados. É exactamente o tipo de constraint que se pretende
 * exercer.
 */
export async function createVehicle(
  db: TestDb,
  userId: string,
  overrides: { plate?: string; make?: string; model?: string; year?: number } = {},
): Promise<{ id: string; plate: string }> {
  const plate = overrides.plate ?? `AA${Math.floor(10_000 + Math.random() * 89_999)}`;
  const vehicle = await db.prisma.vehicle.create({
    data: {
      userId,
      plate,
      plateDisplay: plate,
      make: overrides.make ?? 'Kia',
      model: overrides.model ?? 'EV3',
      year: overrides.year ?? 2025,
    },
    select: { id: true, plate: true },
  });
  return vehicle;
}
