import useSWR from "swr";
import type { EventListItem } from "@town-map/contracts";
import { fetchSavedEvents, saveEvent, unsaveEvent } from "../api";

export type AppAuth = {
  enabled: boolean;
  loaded: boolean;
  signedIn: boolean;
  getToken: () => Promise<string | null>;
};

export interface UseSavedEventsResult {
  savedEvents: EventListItem[];
  savedIds: Set<string>;
  isLoading: boolean;
  error: Error | null;
  toggleSaved: (eventId: string) => Promise<void>;
  mutate: () => Promise<unknown>;
}

export function useSavedEvents(auth: AppAuth, allEvents: EventListItem[] = []): UseSavedEventsResult {
  const key = auth.enabled && auth.loaded && auth.signedIn ? "saved-events" : null;

  const { data, error, isLoading, mutate } = useSWR(
    key,
    async () => {
      const res = await fetchSavedEvents(auth.getToken);
      return res;
    },
    {
      revalidateOnFocus: true,
      dedupingInterval: 15000,
    }
  );

  const savedEvents = data?.events ?? [];
  const savedIds = new Set(savedEvents.map((evt) => evt.id));

  const toggleSaved = async (eventId: string) => {
    if (!auth.signedIn) return;

    const isCurrentlySaved = savedIds.has(eventId);
    const targetEvent = allEvents.find((evt) => evt.id === eventId) ?? savedEvents.find((evt) => evt.id === eventId);

    // Optimistic mutation
    const updatedEvents = isCurrentlySaved
      ? savedEvents.filter((evt) => evt.id !== eventId)
      : targetEvent
      ? [...savedEvents, targetEvent]
      : savedEvents;

    await mutate(
      { events: updatedEvents, count: updatedEvents.length },
      {
        optimisticData: { events: updatedEvents, count: updatedEvents.length },
        rollbackOnError: true,
        revalidate: false,
      }
    );

    try {
      if (isCurrentlySaved) {
        await unsaveEvent(eventId, auth.getToken);
      } else {
        await saveEvent(eventId, auth.getToken);
      }
      mutate();
    } catch (err) {
      mutate();
      throw err;
    }
  };

  return {
    savedEvents,
    savedIds,
    isLoading,
    error: error ?? null,
    toggleSaved,
    mutate,
  };
}
