import useSWR from "swr";
import type { Game, UserPreferences } from "@town-map/contracts";
import { fetchUserPreferences, saveUserPreferences } from "../api";
import type { AppAuth } from "./useSavedEvents";

export interface UseUserPreferencesResult {
  preferences: UserPreferences | null;
  isLoading: boolean;
  error: Error | null;
  updatePreferences: (newPref: { homeAddress: string; selectedGames: Game[] }) => Promise<UserPreferences>;
  mutate: () => Promise<unknown>;
}

export function useUserPreferences(auth: AppAuth): UseUserPreferencesResult {
  const key = auth.enabled && auth.loaded && auth.signedIn ? "user-preferences" : null;

  const { data, error, isLoading, mutate } = useSWR(
    key,
    async () => {
      const res = await fetchUserPreferences(auth.getToken);
      return res;
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  );

  const updatePreferences = async (newPref: { homeAddress: string; selectedGames: Game[] }) => {
    const optimistic: UserPreferences = {
      homeAddress: newPref.homeAddress,
      selectedGames: newPref.selectedGames,
      onboardingCompleted: true,
    };

    await mutate(optimistic, {
      optimisticData: optimistic,
      rollbackOnError: true,
      revalidate: false,
    });

    const updated = await saveUserPreferences(newPref, auth.getToken);
    mutate(updated, false);
    return updated;
  };

  return {
    preferences: data ?? null,
    isLoading,
    error: error ?? null,
    updatePreferences,
    mutate,
  };
}
