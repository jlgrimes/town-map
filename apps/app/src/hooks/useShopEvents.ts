import useSWR from "swr";
import type { EventListItem } from "@town-map/contracts";
import { fetchEventsForShop } from "../api";

export interface UseShopEventsResult {
  events: EventListItem[];
  truncated: boolean;
  isLoading: boolean;
  error: Error | null;
  mutate: () => Promise<unknown>;
}

export function useShopEvents(shopQuery: string | null | undefined): UseShopEventsResult {
  const query = shopQuery?.trim() ?? "";
  const key = query ? ["shop-events", query] : null;

  const { data, error, isLoading, mutate } = useSWR(
    key,
    async () => {
      const res = await fetchEventsForShop(query);
      return res;
    },
    {
      revalidateOnFocus: true,
      dedupingInterval: 15000,
      keepPreviousData: true,
    }
  );

  return {
    events: data?.events ?? [],
    truncated: data?.truncated ?? false,
    isLoading: isLoading && !data,
    error: error ?? null,
    mutate,
  };
}
