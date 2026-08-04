import { fallbackGameLabel, type Game, type GameRegistry } from "@town-map/contracts";
import { useEffect, useState } from "react";
import { fetchGameRegistry } from "./api";

/**
 * Icons and map markers are bundled assets, so they stay in the client while the
 * taxonomy itself lives in PostgreSQL. A game added to the database renders with
 * the generic marker until an asset ships for it, rather than breaking the map.
 */
const GAME_ASSETS: Record<string, { icon: string; marker: string }> = {
  pokemon: { icon: "/pokeball.png", marker: "/pokeball.png" },
  magic: { icon: "/planeswalk.png", marker: "/planeswalk.png" },
  yugioh: { icon: "/blue-eyes.png", marker: "/blue-eyes.png" },
  onepiece: { icon: "/onepiece.svg", marker: "/onepiece.png" },
  riftbound: { icon: "/riftbound.svg", marker: "/riftbound.png" },
};

const FALLBACK_ASSET = { icon: "/event.svg", marker: "/event.png" };

export function gameIconUrl(game: Game) {
  return GAME_ASSETS[game]?.icon ?? FALLBACK_ASSET.icon;
}

export function gameMarkerUrl(game: Game) {
  return GAME_ASSETS[game]?.marker ?? FALLBACK_ASSET.marker;
}

/**
 * Used only until the registry loads, and when the API is unreachable so the
 * demo events still render. The server remains authoritative.
 */
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
  const [catalog, setCatalog] = useState(() => toCatalog(FALLBACK_REGISTRY, false));

  useEffect(() => {
    const controller = new AbortController();
    fetchGameRegistry(controller.signal)
      .then((registry) => {
        if (registry.games.length) setCatalog(toCatalog(registry, true));
      })
      .catch(() => {
        // Keeps the bundled fallback; the events request surfaces the outage.
      });
    return () => controller.abort();
  }, []);

  return catalog;
}
