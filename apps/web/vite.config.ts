import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Configuração do Vite para a aplicação web do Zemlo.
 *
 * Duas decisões que valem explicação:
 *
 *  1. **O `@zemlo/shared` é consumido a partir de `dist/`, não de `src/`.** O pacote
 *     declara `exports` a apontar para o JavaScript compilado, tal como a API o consome.
 *     Isso obriga a correr `npm run build --workspace @zemlo/shared` antes do primeiro
 *     arranque — mas garante que a web e a API usam exatamente o mesmo domínio. Resolver
 *     `src/*.ts` diretamente criaria duas fontes de verdade em desenvolvimento: um erro
 *     corrigido no `src` apareceria na web e não na API (ou o inverso), e o defeito só se
 *     manifestaria em produção.
 *
 *  2. **`@zemlo/shared` é excluído de `optimizeDeps`.** É um pacote do próprio monorepo,
 *     ligado por `workspace:*`; o pré-empacotamento do esbuild guardaria uma cópia antiga
 *     em cache e as alterações ao domínio só apareceriam depois de limpar `node_modules`.
 */
const sharedPath = fileURLToPath(new URL('../../packages/shared/dist/index.js', import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Em desenvolvimento, o browser fala sempre com a mesma origem (`/api`) e o Vite
      // reencaminha para a API. Evita CORS e, mais importante, faz com que o código da
      // aplicação não tenha um caminho de desenvolvimento diferente do de produção.
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  resolve: {
    alias: {
      // Alias explícito: o Vite resolve `@zemlo/shared` pelo `exports` do pacote, mas em
      // `npm run dev` de uma instalação sem `dist` o erro seria um "module not found"
      // genérico. O alias torna a causa imediata na mensagem de erro.
      '@zemlo/shared': sharedPath,
    },
  },
  optimizeDeps: {
    exclude: ['@zemlo/shared'],
  },
});
