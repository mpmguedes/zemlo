/**
 * Carregamento do `.env` para os scripts que correm fora do servidor.
 *
 * ## Porque é necessário
 *
 * A API lê o `.env` no arranque, através de `core/config.ts`, e por isso o servidor
 * funciona. Os scripts de manutenção e de verificação correm com `node` ou `tsx` e
 * **não** passam por lá: criam o `PrismaClient` diretamente. Sem carregar o `.env`,
 * `DATABASE_URL` simplesmente não existe no processo, e o cliente falha na construção
 * com `Environment variable not found: DATABASE_URL`.
 *
 * O Prisma carrega o `.env` sozinho em alguns comandos e a partir de alguns diretórios,
 * mas isso é comportamento implícito da ferramenta, depende da versão e do diretório de
 * trabalho, e não é de que se dependa: foi exatamente assim que `db:integrity` passou a
 * funcionar numa máquina e a falhar noutra com o mesmo código. Carregar o ficheiro de
 * forma explícita torna o comportamento igual em qualquer ambiente.
 *
 * ## Porque é um `.mjs` partilhado
 *
 * Os dois formatos coexistem no projeto: há scripts `.mjs` (JavaScript puro) e `.ts`
 * (corridos com `tsx`). Um módulo `.mjs` é importável dos dois, pelo que este padrão vive
 * num único sítio em vez de ficar repetido — e a repetição é o que faz as cópias divergirem.
 *
 * ## Porque segue o `config.ts` em vez de o importar
 *
 * `core/config.ts` é TypeScript e valida configuração de servidor (segredo JWT, chave de
 * cifragem, limites). Os scripts não precisam dessas validações e não podem importar
 * TypeScript diretamente; o que precisam é da mesma **localização** e da mesma
 * precedência. Duplicar aqui as duas linhas de carregamento mantém o comportamento igual
 * sem arrastar o resto.
 *
 * Uso:
 *   import { loadEnv } from './load-env.mjs';
 *   loadEnv();
 *
 * A chamada tem de acontecer **antes** de instanciar o `PrismaClient`.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotEnv } from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));
/** Pasta da API: este ficheiro vive em `apps/api/scripts/`. */
const apiRoot = resolve(here, '..');

/**
 * Locais procurados, pela ordem em que o `config.ts` os procura.
 *
 * `override: false` é essencial e não é o comportamento por omissão do `dotenv`: sem
 * isto, um `.env` presente no servidor sobreporia as variáveis injetadas pelo
 * orquestrador. Variáveis reais ganham sempre ao ficheiro — em produção é o gestor de
 * segredos que manda, não um ficheiro no disco.
 */
export const envFiles = [resolve(apiRoot, '.env'), resolve(apiRoot, '..', '..', '.env')];

/** Carrega o `.env` da API e da raiz do monorepo, se existirem. Idempotente. */
export function loadEnv() {
  const loaded = [];
  for (const candidate of envFiles) {
    if (existsSync(candidate)) {
      loadDotEnv({ path: candidate, override: false });
      loaded.push(candidate);
    }
  }
  return loaded;
}
