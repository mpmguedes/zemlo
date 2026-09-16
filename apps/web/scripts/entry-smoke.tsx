/*
 * Ponto de entrada do arranque em Node para a verificação de renderização.
 *
 * Exporta `run`, que recebe as respostas reais da API já recolhidas pelo script que o invoca,
 * instala-as na cache do React Query e renderiza cada ecrã para texto. Não faz pedidos: os
 * dados vêm todos de fora, para que a verificação seja determinística e rápida.
 */

import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, createElement as h } from 'react';
import { createQueryClient } from '../src/api/queryClient';
import { SessionProvider } from '../src/app/SessionContext';
import { ToastProvider } from '../src/ui/Toaster';
import { App } from '../src/App';

export interface SmokeInput {
  cacheEntries: Array<[unknown[], unknown]>;
  /** Consultas infinitas: chave e página, convertida aqui na forma `{ pages, pageParams }`. */
  infiniteEntries: Array<[unknown[], unknown]>;
  session: { tokens: { accessToken: string; expiresIn: number; tokenType: 'Bearer' }; user: unknown };
  vehicleId: string;
  apiUrl: string;
}

interface SmokeResult {
  name: string;
  bytes: number;
  error: string | null;
  /** Início do HTML, para diagnóstico quando o ecrã renderiza conteúdo inesperado. */
  excerpt: string;
  /** `true` quando o ecrã é um passo curto, para o qual 4 000 bytes seria um limiar errado. */
  minimal: boolean;
}

/** Rotas verificadas, cobrindo todos os ecrãs ligados no encaminhador. */
function routes(vehicleId: string): Array<[string, string]> {
  return [
    ['Painel', '/'],
    ['Veículos', '/vehicles'],
    ['Novo veículo', '/vehicles/new'],
    ['Ficha do veículo', `/vehicles/${vehicleId}`],
    ['Ficha — seguro', `/vehicles/${vehicleId}?tab=insurance`],
    ['Ficha — inspeções', `/vehicles/${vehicleId}?tab=inspections`],
    ['Ficha — impostos', `/vehicles/${vehicleId}?tab=taxes`],
    ['Ficha — documentos', `/vehicles/${vehicleId}?tab=documents`],
    ['Ficha — lembretes', `/vehicles/${vehicleId}?tab=reminders`],
    ['Ficha — estatísticas', `/vehicles/${vehicleId}?tab=stats`],
    ['Ficha — histórico', `/vehicles/${vehicleId}?tab=timeline`],
    ['Ficha — ficha técnica', `/vehicles/${vehicleId}?tab=sheet`],
    ['Despesas', '/records/expenses'],
    ['Abastecimentos', '/records/fuel'],
    ['Carregamentos', '/records/charging'],
    ['Manutenção', '/records/maintenance'],
    ['Lembretes', '/records/reminders'],
    ['Documentos', '/documents'],
    ['Estatísticas', '/stats'],
    ['Estatísticas — veículo', `/stats?vehicleId=${vehicleId}`],
    ['Histórico', '/timeline'],
    ['Calendário', '/calendar'],
    ['Notificações', '/notifications'],
    ['Integrações', '/integrations'],
    ['Home Assistant', '/integrations/home-assistant'],
    ['Exportar', '/export'],
    ['Definições', '/settings'],
    ['Definições — perfil', '/settings/profile'],
    ['Definições — preferências', '/settings/preferences'],
    ['Definições — segurança', '/settings/security'],
    ['Página inexistente', '/nao-existe'],
  ];
}

/**
 * Rotas verificadas com conteúdo mínimo aceitável.
 *
 * `/onboarding/conta` é a exceção: é um passo de confirmação com uma frase e um botão, pelo
 * que tem naturalmente pouco HTML. As restantes têm de passar dos 4 000 bytes — o limiar que
 * distingue um ecrã real de um estado de carregamento.
 */
const MINIMAL_ROUTES = new Set(['/onboarding/conta']);

export async function run(input: SmokeInput): Promise<SmokeResult[]> {
  /*
   * A aplicação decide se há sessão a partir do armazenamento, antes de qualquer pedido à
   * rede (ver `SessionProvider`). Esta verificação tem de imitar esse estado: sem ele, todos
   * os ecrãs autenticados renderizariam a página de login — e a verificação passaria sem
   * verificar nada.
   */
  const memoryStorage = new Map<string, string>();
  const fakeStorage = {
    getItem: (key: string) => memoryStorage.get(key) ?? null,
    setItem: (key: string, value: string) => void memoryStorage.set(key, value),
    removeItem: (key: string) => void memoryStorage.delete(key),
    clear: () => memoryStorage.clear(),
    key: () => null,
    length: 0,
  };
  globalThis.localStorage = fakeStorage as unknown as Storage;
  globalThis.sessionStorage = fakeStorage as unknown as Storage;
  fakeStorage.setItem('zemlo.accessToken', input.session.tokens.accessToken);
  fakeStorage.setItem('zemlo.refreshToken', 'smoke-render-token');

  const results: SmokeResult[] = [];

  for (const [name, path] of routes(input.vehicleId)) {
    // Um cliente novo por ecrã: assim cada renderização parte de uma cache limpa e conhecida,
    // e uma consulta que falhe num ecrã não contamina os seguintes.
    const client = createQueryClient();
    for (const [key, value] of input.cacheEntries) {
      client.setQueryData(key, value);
    }
    for (const [key, page] of input.infiniteEntries) {
      client.setQueryData(key, { pages: [page], pageParams: [undefined] });
    }

    try {
      const html = renderToString(
        h(
          StrictMode,
          null,
          h(
            QueryClientProvider,
            { client },
            h(
              SessionProvider,
              null,
              h(
                ToastProvider,
                null,
                h(MemoryRouter, { initialEntries: [path] }, h(App)),
              ),
            ),
          ),
        ),
      );
      results.push({
        name,
        bytes: html.length,
        error: null,
        // Primeiros 200 caracteres do `<body>`: o suficiente para distinguir um ecrã real de
        // um estado de carregamento quando algo corre mal.
        excerpt: html.slice(html.indexOf('<body'), html.indexOf('<body') + 200),
        minimal: MINIMAL_ROUTES.has(path),
      });
    } catch (error) {
      const stack = error instanceof Error ? (error.stack ?? '') : '';
      // A pilha é o que torna esta verificação útil: sem ela, um erro de renderização é uma
      // mensagem de uma linha sem qualquer indicação do componente que falhou.
      const location = stack.split('\n').find((line) => line.includes('entry-smoke') || line.includes('/src/'));
      results.push({
        name,
        bytes: 0,
        error: error instanceof Error ? `${error.message}${location ? ` — ${location.trim()}` : ''}` : String(error),
        excerpt: stack.split('\n').slice(0, 6).join(' | '),
        minimal: false,
      });
    }
  }

  return results;
}
