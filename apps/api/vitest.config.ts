/**
 * Configuração mínima dos testes da API — uma linha, e o que a justifica.
 *
 * ## Porque é que este ficheiro passou a existir
 *
 * Até aqui o Vitest corria sem configuração. Isso funcionou enquanto nenhum teste importava
 * `src/app.ts`, mas o contrato HTTP da importação nativa (Fase 4) tem de ser provado
 * **através da composição real da aplicação**, e não do router isolado: a propriedade que
 * interessa é que a isenção do `requireJsonBody` acontece antes do middleware global e
 * apenas para dois caminhos exatos — e isso só é observável subindo a aplicação como a
 * produção a monta.
 *
 * ## O problema
 *
 * A cadeia `app.ts` → `core/db.ts` → `core/prisma-client.ts` → `client-postgres.ts` →
 * `core/prisma-client-identity.ts` termina em `import.meta.resolve(specifier, parent)`.
 *
 * O Vite, em modo SSR, **não implementa `import.meta.resolve`**: o `import.meta` que o
 * código transformado vê expõe apenas `dirname`, `env`, `filename` e `url`. A chamada falha
 * com `TypeError: __vite_ssr_import_meta__.resolve is not a function` (verificado — falha
 * mesmo com um só argumento, e `typeof import.meta.resolve` é `undefined`).
 *
 * O Node implementa-a, e é o Node que corre este código em produção. O módulo está a usar
 * uma API legítima que o transformador do Vite não reproduz — o defeito é da ferramenta,
 * não do código.
 *
 * ## A correção
 *
 * Uma entrada em `server.deps.external`, apontando ao **único** módulo que chama a API:
 * `src/core/prisma-client-identity.ts`. Externalizar diz ao Vite para não o transformar e
 * deixar o carregamento ao Node, que resolve nativamente. O código executado é o mesmo que
 * a produção executa.
 *
 * ## Porque é que o âmbito é este, e não maior
 *
 *  - **Não é `@zemlo/*` em bloco.** Testado: externalizar os pacotes Prisma não resolve
 *    nada, porque quem chama `import.meta.resolve` é um ficheiro **nosso** (`src/core/`), e
 *    não o pacote gerado. Além disso, `@zemlo/shared` continua a ser transformado pelo Vite,
 *    o que mantém a suite a correr sobre `src/` em vez de exigir um `build` prévio.
 *  - **É um caminho exato, não um padrão largo.** Só este ficheiro é isentado da
 *    transformação; todo o resto do `src/` continua a ser processado normalmente, e o
 *    `import.meta.url` dos outros módulos mantém-se o que o Vite fornece.
 *  - **`inline` não serve.** Verificado: marcar o mesmo ficheiro como `inline` mantém a
 *    falha — a transformação é precisamente o que perde a API.
 *
 * ## O que esta configuração não faz
 *
 * Não altera o comportamento de produção (é lida só pelo Vitest; o servidor corre
 * `node dist/server.js` sem lhe tocar). Não acrescenta `globalSetup`, nem aliases, nem
 * `environment` — o Node já é o ambiente por omissão do Vitest, e declará-lo seria uma
 * linha redundante.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    server: {
      deps: {
        /*
         * O único módulo que usa `import.meta.resolve`. Externalizá-lo faz o Node
         * carregá-lo em vez de o Vite o transformar, e é isso que preserva a API.
         *
         * A expressão aceita `/` e `\` porque o caminho é comparado depois de normalizado
         * pelo Vite e o projeto corre em Windows e em Linux.
         */
        external: [/src[\\/]core[\\/]prisma-client-identity\.ts$/],
      },
    },
  },
});
