import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVehicles } from '../api/hooks';
import type { VehicleSummary } from '@zemlo/shared';

/**
 * Pequenos hooks de interface.
 *
 * Nenhum deles guarda estado de servidor: esse é o trabalho do React Query. São utilitários
 * locais, e a sua existência evita repetir a mesma `useEffect` em cinco ecrãs.
 */

/** Valor atrasado — usado nos campos de pesquisa para não pedir à API a cada tecla. */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Consulta de media query reativa, para decisões que o CSS não pode tomar sozinho. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** `true` em ecrãs de ambiente de trabalho (≥ 900 px), onde há barra lateral e tabelas. */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 900px)');
}

/**
 * Copiar para a área de transferência, com indicador de sucesso.
 *
 * A `navigator.clipboard` só existe em contexto seguro (HTTPS ou `localhost`). Num acesso
 * por IP na rede local — que é como se testa a aplicação no telemóvel — está indisponível,
 * e a alternativa é a seleção explícita do texto. Devolvemos `false` em vez de lançar, para
 * que o ecrã possa dizer ao utilizador para copiar à mão.
 */
export function useCopyToClipboard(): [boolean, (text: string) => Promise<boolean>] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async (text: string) => {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }

    if (!ok) {
      // Recurso: um `<textarea>` temporário com `execCommand`. Está descontinuado, mas
      // continua a ser o único caminho em contexto não seguro.
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        ok = document.execCommand('copy');
        area.remove();
      } catch {
        ok = false;
      }
    }

    setCopied(ok);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2200);
    return ok;
  }, []);

  return [copied, copy];
}

/* -------------------------------------------------------------------------- */
/* Veículo em foco                                                             */
/* -------------------------------------------------------------------------- */

const SELECTED_VEHICLE_KEY = 'zemlo.selectedVehicle';

/**
 * Veículo em foco, partilhado por toda a aplicação.
 *
 * A escolha é guardada em `localStorage`, e não no estado de navegação: quem gere dois
 * carros escolhe o BMW porque é o que conduz naquela semana, e essa escolha tem de
 * sobreviver a um recarregamento de página e a uma sessão nova. É uma preferência de
 * utilizador, não um parâmetro de um ecrã.
 *
 * O valor `'all'` significa "toda a conta" — é o que os ecrãs de estatísticas usam para
 * agregar. Não é o mesmo que "nenhum veículo": uma conta sem veículos tem
 * `vehicles.length === 0` e o ecrã mostra o estado vazio do onboarding (§5, §46).
 */
export interface VehicleSelection {
  /** Identificador do veículo em foco, ou `'all'` para agregar a conta. */
  vehicleId: string | 'all';
  /** Veículo em foco resolvido; `null` quando a seleção é `'all'` ou não há veículos. */
  vehicle: VehicleSummary | null;
  vehicles: VehicleSummary[];
  isLoading: boolean;
  isError: boolean;
  select: (vehicleId: string) => void;
  /** `true` quando a conta ainda não tem qualquer veículo. */
  isEmpty: boolean;
}

export function useSelectedVehicle(): VehicleSelection {
  const { data, isLoading, isError } = useVehicles(false);
  const vehicles = useMemo(() => data?.items ?? [], [data]);

  const [stored, setStored] = useState<string | 'all'>(() => {
    try {
      return globalThis.localStorage?.getItem(SELECTED_VEHICLE_KEY) ?? 'all';
    } catch {
      return 'all';
    }
  });

  const select = useCallback((vehicleId: string) => {
    setStored(vehicleId);
    try {
      globalThis.localStorage?.setItem(SELECTED_VEHICLE_KEY, vehicleId);
    } catch {
      /* sem persistência: a escolha vale para esta sessão */
    }
  }, []);

  /*
   * Resolução da seleção guardada:
   *  - `'all'` mantém-se (é uma escolha explícita do utilizador);
   *  - um identificador que ainda não existe (a lista está a carregar, ou o veículo foi
   *    arquivado noutro dispositivo) cai para o **primeiro veículo da lista**, que a API
   *    ordena por atividade recente. É a aposta certa: quase sempre é o veículo que o
   *    utilizador quer ver. Só quando não há veículos nenhuns é que a seleção fica vazia.
   */
  const vehicleId: string | 'all' = useMemo(() => {
    if (stored === 'all') return 'all';
    if (vehicles.length === 0) return stored === 'all' ? 'all' : stored;
    if (vehicles.some((vehicle) => vehicle.id === stored)) return stored;
    return vehicles[0]?.id ?? 'all';
  }, [stored, vehicles]);

  const vehicle = useMemo(
    () => (vehicleId === 'all' ? null : vehicles.find((item) => item.id === vehicleId) ?? null),
    [vehicleId, vehicles],
  );

  return {
    vehicleId,
    vehicle,
    vehicles,
    isLoading,
    isError,
    select,
    isEmpty: !isLoading && vehicles.length === 0,
  };
}

/**
 * Seleção do veículo em ecrãs que exigem um veículo concreto.
 *
 * O dashboard e as estatísticas aceitam a conta inteira; a ficha do veículo, o seguro e os
 * lembretes não — não existe "seguro de todos os carros". Este hook resolve a seleção
 * global para um identificador concreto, caindo para o primeiro veículo.
 */
export function useFocusedVehicleId(): string | undefined {
  const { vehicleId, vehicles } = useSelectedVehicle();
  if (vehicleId !== 'all') return vehicleId;
  return vehicles[0]?.id;
}
