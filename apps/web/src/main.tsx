import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { createQueryClient } from './api/queryClient';
import { SessionProvider } from './app/SessionContext';
import { ToastProvider } from './ui/Toaster';
import { App } from './App';
import './styles/theme.css';
import './styles/app.css';

/**
 * Ponto de entrada.
 *
 * A ordem dos provedores não é arbitrária:
 *
 *  1. `QueryClientProvider` — tudo o que lê do servidor, incluindo a sessão, depende dele;
 *  2. `SessionProvider` — precisa do cliente para ler o perfil e para o limpar ao sair;
 *  3. `ToastProvider` — os avisos são desencadeados por mutações, que precisam do cliente;
 *  4. `BrowserRouter` — a última camada de infraestrutura, porque nenhum dos anteriores
 *     conhece rotas.
 *
 * O `QueryClient` é criado **uma vez, fora do componente**: criado dentro do `App`, cada
 * renderização de topo produziria um cliente novo e a cache seria descartada a cada
 * mudança de estado.
 */
const queryClient = createQueryClient();

const container = document.getElementById('root');
if (!container) {
  // Falhar alto em vez de deixar um ecrã branco silencioso: se o `index.html` deixar de ter
  // o `#root`, o defeito tem de ser imediato e óbvio, não uma página vazia.
  throw new Error('Elemento #root não encontrado no index.html.');
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <ToastProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
