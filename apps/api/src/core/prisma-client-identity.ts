/**
 * Identificação do motor de um cliente Prisma gerado.
 *
 * ## Porque existe
 *
 * Os dois clientes (PostgreSQL e SQLite) têm saídas distintas, mas a aplicação tem de
 * provar *qual* deles carregou, e não afirmá-lo. Uma constante escrita à mão
 * (`CLIENT_PROVIDER = 'postgresql'`) seria apenas uma declaração de intenção: continuaria
 * a dizer "PostgreSQL" mesmo que a pasta de produção contivesse o cliente SQLite — que é
 * exatamente a falha descrita em `core/prisma-client.ts`.
 *
 * ## Como prova
 *
 * O `prisma generate` copia o `schema.prisma` de origem para dentro da pasta de saída, ao
 * lado do `index.js`. O `provider` desse schema é, por isso, um facto sobre o cliente
 * carregado.
 *
 * O ponto crítico é **de que pasta** se lê o schema. Ler de um caminho construído por
 * convenção (`../../prisma/generated/postgres/`) desliga a verificação do que foi
 * importado: durante a auditoria, essa versão declarou "PostgreSQL" enquanto o módulo
 * importado era o cliente SQLite. Aqui a pasta é resolvida a partir do **próprio
 * especificador importado**, com `import.meta.resolve`, pelo que as duas coisas não se
 * podem separar.
 *
 * O especificador é passado como literal em cada ficheiro `client-*.ts`, para que
 * continue a coincidir com o `import` que lá está.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Lê o `provider` do schema do cliente numa pasta gerada.
 *
 * `generatedName` é `postgres` ou `sqlite`, e o caminho é derivado da posição deste
 * módulo (`src/core/` e `dist/core/` estão à mesma profundidade). É esta leitura — feita
 * sobre a pasta, e não sobre o especificador importado — que detecta a substituição do
 * cliente de produção pelo de desenvolvimento, que foi o defeito original.
 */
export function readGeneratedProviderAt(generatedName: 'postgres' | 'sqlite'): string {
  const schemaPath = fileURLToPath(
    new URL(`../../prisma/generated/${generatedName}/schema.prisma`, import.meta.url),
  );

  let schema: string;
  try {
    schema = readFileSync(schemaPath, 'utf8');
  } catch (error) {
    throw new Error(
      `Não foi possível ler o schema do cliente "${generatedName}" em ${schemaPath}. ` +
        'Corre `npm run db:generate` para o reconstruir.',
      { cause: error },
    );
  }

  const match = /datasource\s+db\s*\{[^}]*?provider\s*=\s*"([^"]+)"/s.exec(schema);
  if (!match?.[1]) {
    throw new Error(
      `O schema do cliente "${generatedName}" (${schemaPath}) não declara um provider de datasource. ` +
        'Corre `npm run db:generate`.',
    );
  }
  return match[1];
}

/**
 * Resolve o especificador a partir do módulo indicado.
 *
 * O `parent` é obrigatório de propósito. `import.meta.resolve` resolve a partir do módulo
 * onde é **chamado**, e este é um módulo auxiliar: sem o `parent`, a resolução partiria
 * daqui em vez de partir de `client-*.ts`, e a verificação deixaria de estar ligada ao
 * módulo que faz o import.
 */
function resolveFrom(specifier: string, parent: string): string {
  try {
    return import.meta.resolve(specifier, parent);
  } catch (error) {
    throw new Error(
      `O cliente Prisma "${specifier}" não está gerado. Corre \`npm run db:generate\`.`,
      { cause: error },
    );
  }
}

/** Pasta onde vive o cliente indicado, derivada do módulo resolvido. */
export function generatedClientDirectory(specifier: string, parent: string): string {
  return fileURLToPath(new URL('.', resolveFrom(specifier, parent)));
}
