/**
 * Seleção do cliente Prisma — o ponto único onde o motor é decidido.
 *
 * ## O problema que este ficheiro resolve
 *
 * Até esta alteração existia **um só** cliente gerado, escrito em
 * `node_modules/.prisma/client`. Tanto o schema PostgreSQL como o schema SQLite geravam
 * para lá e, como `npm run db:generate` corria o SQLite por último, **o cliente SQLite
 * substituía o de PostgreSQL — sempre, e em silêncio**.
 *
 * O resultado era o pior tipo de falha: com `DATABASE_URL` a apontar para PostgreSQL e
 * `DATABASE_PROVIDER=postgresql`, a API arrancava, respondia 200 e escrevia num ficheiro
 * `dev.db` local, enquanto o `/health` anunciava `postgresql`. Só se descobria pela
 * ausência de dados.
 *
 * ## A correção
 *
 * 1. Cada schema gera para uma pasta **própria** (`prisma/generated/postgres` e
 *    `prisma/generated/sqlite`), pelo que a colisão deixou de ser possível.
 * 2. Este módulo importa o cliente correspondente a `DATABASE_PROVIDER` de forma
 *    **explícita**, em vez de depender de um caminho partilhado.
 * 3. No arranque confirma-se que o cliente carregado é o do motor configurado, e que a
 *    configuração é coerente com o cliente. Se não for, a aplicação **recusa arrancar**.
 * 4. Em produção um cliente SQLite é recusado incondicionalmente.
 *
 * `DATABASE_PROVIDER` deixa assim de ser uma etiqueta decorativa: passa a selecionar
 * fisicamente o cliente que é instanciado. Uma configuração mentirosa é detetada no
 * arranque em vez de se manifestar como dados a desaparecer.
 */

import { config } from './config.js';
import * as postgres from './client-postgres.js';
import * as sqlite from './client-sqlite.js';

/** Motor com que o processo está de facto a falar. É isto que o `/health` reporta. */
export type ActiveProvider = 'sqlite' | 'postgresql';

/** Nível de registo do Prisma; em testes silenciamos para manter a saída legível. */
const logLevels: Array<'warn' | 'error'> = config.isTest
  ? []
  : config.isDevelopment
    ? ['warn', 'error']
    : ['error'];

/**
 * Escolhe o cliente a partir da configuração.
 *
 * Nota sobre tipos: `selectClient` devolve uma união dos dois construtores, porque os dois
 * clientes gerados são tipos nominalmente distintos — o TypeScript não os considera
 * atribuíveis um ao outro, apesar de o schema SQLite ser derivado do canónico. Em
 * `buildClient` o resultado é fixado num só tipo, com uma conversão explícita e
 * localizada: em runtime existe sempre **um** cliente, nunca os dois.
 *
 * A ordem de verificações importa: o cliente é escolhido por `DATABASE_PROVIDER` e o
 * resultado é depois comparado com essa mesma variável em `assertCoherent()`. Sem a dupla
 * verificação, trocar os ficheiros `client-*.ts` faria o processo falar com um motor
 * diferente do configurado — o problema original, apenas por outra via.
 */
function selectClient() {
  const configured = config.database.provider;

  const options = {
    log: logLevels,
    errorFormat: config.isProduction ? ('minimal' as const) : ('pretty' as const),
  };

  if (configured === 'postgresql') {
    return {
      provider: postgres.CLIENT_PROVIDER,
      instance: new postgres.PrismaClient(options) as unknown as InstanceType<
        typeof postgres.PrismaClient
      >,
    };
  }

  /*
   * Cliente SQLite.
   *
   * A verificação é feita sobre `sqlite.CLIENT_PROVIDER` — o motor com que o cliente foi
   * de facto compilado — e não sobre a variável de configuração. Uma guarda que
   * perguntasse a `config.database.provider` deixaria passar exatamente o caso que
   * interessa travar: configuração a dizer PostgreSQL e um cliente SQLite carregado.
   *
   * Em produção, um cliente SQLite é recusado sempre. É um ficheiro local, sem
   * concorrência a sério e sem as garantias do PostgreSQL; recusar arrancar é preferível
   * a servir dados de um ficheiro que ninguém vai salvaguardar.
   */
  if (config.isProduction) {
    throw new Error(
      'Cliente Prisma SQLite carregado em produção. O Zemlo usa PostgreSQL em produção. ' +
        'Corre `npm run db:generate` com DATABASE_PROVIDER=postgresql e define DATABASE_URL ' +
        'com a cadeia de ligação PostgreSQL.',
    );
  }

  /*
   * A conversão é deliberada e está confinada a este ramo. Os dois clientes gerados
   * declaram a mesma superfície de modelos — o schema SQLite é derivado do canónico e
   * `npm run db:check-schema` falha se divergirem — mas o TypeScript considera-os tipos
   * nominalmente distintos e recusaria qualquer chamada sobre uma união. Aqui é
   * instanciado um só cliente, pelo que a conversão descreve a realidade em vez de a
   * esconder.
   */
  return {
    provider: sqlite.CLIENT_PROVIDER,
    instance: new sqlite.PrismaClient(options) as unknown as InstanceType<
      typeof postgres.PrismaClient
    >,
  };
}

const selected = selectClient();

/**
 * Confirmação de que o motor do cliente carregado corresponde ao configurado.
 *
 * `active` vem de `CLIENT_PROVIDER`, que é lido do `schema.prisma` que o `prisma generate`
 * copiou para a pasta de saída — uma observação sobre o cliente real, não uma afirmação
 * sobre ele. Se alguém trocar os ficheiros `client-*.ts` ou apontar uma pasta ao cliente
 * errado, é aqui que a aplicação recusa arrancar em vez de escrever no motor errado.
 */
function assertCoherent(active: string): void {
  if (active !== config.database.provider) {
    throw new Error(
      `Cliente Prisma incoerente com a configuração: o cliente carregado foi compilado para "${active}" ` +
        `mas DATABASE_PROVIDER diz "${config.database.provider}". ` +
        'Corre `npm run db:generate` para regenerar os clientes a partir dos schemas.',
    );
  }
}

assertCoherent(selected.provider);

/** Cliente Prisma do motor ativo. Só existe um por processo. */
export const prisma = selected.instance;

/**
 * Motor efetivamente em uso, lido do cliente que foi carregado — não da variável de
 * ambiente. O `/health` reporta este valor: repetir `DATABASE_PROVIDER` seria repetir a
 * configuração, que é precisamente a parte que pode estar errada.
 *
 * A coerção é segura porque `assertCoherent` já garantiu que este valor é igual a
 * `config.database.provider`, que só pode ser `'sqlite'` ou `'postgresql'`.
 */
export const activeProvider = selected.provider as ActiveProvider;

/** Namespace de tipos/valores do Prisma (use-se `Prisma.JsonNull`, etc.). */
export { Prisma } from './client-postgres.js';
export type { PrismaClient } from './client-postgres.js';
