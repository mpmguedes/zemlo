import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './client';

/**
 * Política de cache do React Query.
 *
 * Os valores não são arbitrários — decorrem da forma como o Zemlo é usado:
 *
 *  - **`staleTime` de 60 s.** Quem registou um abastecimento há dez segundos e volta ao
 *    dashboard não deve ver um novo pedido à rede; as mutações já invalidam explicitamente
 *    o que mudou. Um `staleTime` de zero transformaria navegar entre separadores numa
 *    tempestade de pedidos.
 *  - **Uma repetição, com recuo exponencial.** Duas, no máximo: um erro do servidor não
 *    melhora com insistência, e um utilizador em 4G não deve ficar à espera de três rondas
 *    falhadas. Recuo porque um 503 momentâneo (reinício do servidor) resolve-se com
 *    segundos de espera, não com pedidos imediatos.
 *  - **`refetchOnWindowFocus: false`.** A revalidação ao voltar à janela é uma boa
 *    omissão numa aplicação de chat; aqui provoca consultas completas ao dashboard — que
 *    agrega um ano de registos — cada vez que o utilizador alterna para o browser.
 *    `refetchOnReconnect` fica ligado: voltar de uma perda de rede é o momento em que a
 *    informação no ecrã tem maior probabilidade de estar errada.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: (failureCount, error) => {
          if (error instanceof ApiError) {
            // 4xx é uma resposta definitiva: repetir um pedido mal formado, não autorizado
            // ou inexistente só gasta tempo. 429 é a exceção parcial — mas a API envia
            // `Retry-After`, e insistir antes disso pioraria a limitação.
            if (error.status >= 400 && error.status < 500) return false;
          }
          return failureCount < 1;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
      mutations: {
        // As mutações não se repetem automaticamente: registar um abastecimento duas vezes
        // é um dado errado na conta do utilizador, e não há chave de idempotência nos
        // endpoints de criação.
        retry: false,
      },
    },
  });
}
