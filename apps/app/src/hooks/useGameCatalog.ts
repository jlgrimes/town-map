import useSWR from "swr";
import { fallbackGameLabel, type Game, type GameRegistry } from "@town-map/contracts";
import { fetchGameRegistry } from "../api";

const FALLBACK_REGISTRY: GameRegistry = {
  categories: [{ id: "card-game", label: "Card games" }],
  games: [
    { id: "pokemon", label: "Pokémon", category: "card-game" },
    { id: "magic", label: "Magic", category: "card-game" },
    { id: "yugioh", label: "Yu-Gi-Oh!", category: "card-game" },
    { id: "onepiece", label: "One Piece", category: "card-game" },
    { id: "riftbound", label: "Riftbound", category: "card-game" },
  ],
};

export type GameCatalog = {
  registry: GameRegistry;
  /** Every game id in display order. */
  ids: Game[];
  /** Registry label, falling back to a readable form of the slug. */
  label: (game: Game) => string;
  loaded: boolean;
};

function toCatalog(registry: GameRegistry, loaded: boolean): GameCatalog {
  const labels = new Map(registry.games.map((game) => [game.id, game.label]));
  return {
    registry,
    ids: registry.games.map((game) => game.id),
    label: (game) => labels.get(game) ?? fallbackGameLabel(game),
    loaded,
  };
}

export function useGameCatalog(): GameCatalog {
  const { data, error } = useSWR(
    "/v1/games",
    async () => {
      const registry = await fetchGameRegistry();
      return registry;
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 300000, // 5 minutes
    }
  );

  const registry = data && data.games?.length ? data : FALLBACK_REGISTRY;
  const isLoaded = Boolean(data && data.games?.length && !error);

  return toCatalog(registry, isLoaded);
}
