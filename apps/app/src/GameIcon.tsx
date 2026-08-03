import { fallbackGameLabel, type Game } from "@town-map/contracts";
import { gameIconUrl } from "./games";

export function GameIcon({
  game,
  label,
  className = "size-5",
  decorative = false,
}: {
  game: Game;
  /** Registry label. Falls back to the slug when the caller has no catalog. */
  label?: string;
  className?: string;
  decorative?: boolean;
}) {
  return (
    <img
      src={gameIconUrl(game)}
      alt={decorative ? "" : label ?? fallbackGameLabel(game)}
      className={className}
      width={24}
      height={24}
      style={{ imageRendering: "pixelated" }}
    />
  );
}
