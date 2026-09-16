import { useInfiniteQuery } from '@tanstack/react-query';
import type { TimelineItem, TimelineItemKind } from '@zemlo/shared';
import { fetchTimeline } from '../api/queries';
import { queryKeys } from '../api/queryKeys';

/**
 * Histórico paginado por cursor (§24).
 *
 * `useInfiniteQuery` e não `useQuery` com um `page`: a API pagina por **cursor** e não por
 * deslocamento, precisamente porque o utilizador insere registos com datas retroativas. Com
 * `offset`, inserir uma despesa de ontem enquanto se percorre o histórico faria com que a
 * página seguinte repetisse itens já vistos ou saltasse os que ficaram entre páginas. O
 * cursor aponta para uma posição *no tempo*, que é imune a inserções.
 *
 * Os itens são desduplicados ao juntar as páginas: mesmo com cursor, uma alteração ao
 * registo que serve de âncora pode fazer reaparecer um item na fronteira — e uma timeline
 * com a mesma despesa duas vezes é um defeito visível.
 */
export interface TimelineFilters {
  vehicleId?: string;
  kinds?: TimelineItemKind[];
  from?: string;
  to?: string;
  limit?: number;
}

export interface TimelineFeed {
  items: TimelineItem[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => Promise<unknown>;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  totalLoaded: number;
}

export function useTimeline(filters: TimelineFilters): TimelineFeed {
  const kinds = filters.kinds && filters.kinds.length > 0 ? filters.kinds.slice().sort().join(',') : undefined;

  const query = useInfiniteQuery({
    queryKey: queryKeys.timeline({
      vehicleId: filters.vehicleId,
      kinds,
      from: filters.from,
      to: filters.to,
    }),
    queryFn: ({ pageParam }) =>
      fetchTimeline({
        vehicleId: filters.vehicleId,
        kinds,
        from: filters.from,
        to: filters.to,
        limit: filters.limit ?? 30,
        cursor: pageParam as string | undefined,
      }),
    initialPageParam: undefined as string | undefined,
    // Defensivo de propósito: `getNextPageParam` corre sobre dados que já vieram do servidor,
    // e uma resposta sem `nextCursor` (não prevista pelo contrato, mas possível num pedido
    // servido por uma versão diferente da API) rebentaria dentro do React Query e derrubaria
    // o ecrã inteiro. Nesta camada, a diferença entre "não há mais páginas" e "não sei" não
    // interessa ao utilizador: ambas param o botão «Carregar mais».
    //
    // O tipo é alargado a `Page<TimelineItem> | undefined` por isso mesmo: o estado que o
    // React Query pode entregar aqui não é exatamente o tipo da promessa.
    getNextPageParam: (lastPage: { nextCursor?: string | null } | undefined) =>
      lastPage?.nextCursor ?? undefined,
  });

  const items: TimelineItem[] = [];
  const seen = new Set<string>();
  for (const page of query.data?.pages ?? []) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }

  return {
    items,
    hasNextPage: query.hasNextPage ?? false,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
    totalLoaded: items.length,
  };
}
