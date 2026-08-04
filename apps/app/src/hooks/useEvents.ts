import useSWR from "swr";
import type { EventListItem } from "@town-map/contracts";
import { fetchEvents, type EventFetchOptions } from "../api";

export interface UseEventsResult {
  events: EventListItem[];
  truncated: boolean;
  isLoading: boolean;
  isValidating: boolean;
  error: Error | null;
  mutate: () => Promise<unknown>;
}

export function useEvents(options: EventFetchOptions & { enabled?: boolean }): UseEventsResult {
  const { enabled = true, games, query, latitude, longitude, radiusMiles } = options;

  // Build SWR cache key based on query options
  const key = enabled
    ? [
        "events",
        games.slice().sort().join(","),
        query?.trim() ?? "",
        latitude ?? null,
        longitude ?? null,
        radiusMiles ?? 25,
      ]
    : null;

  const { data, error, isLoading, isValidating, mutate } = useSWR(
    key,
    async () => {
      const res = await fetchEvents({
        games,
        query,
        latitude,
        longitude,
        radiusMiles,
      });
      return res;
    },
    {
      revalidateOnFocus: true,
      dedupingInterval: 10000, // 10s deduplication
      keepPreviousData: true, // Smooth transitions between filter changes
    }
  );

  return {
    events: data?.events ?? [],
    truncated: data?.truncated ?? false,
    isLoading: isLoading && !data,
    isValidating,
    error: error ?? null,
    mutate,
  };
}
