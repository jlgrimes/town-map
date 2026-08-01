import { GAME_LABELS, type Game } from "@town-map/contracts";

const GAME_ICONS: Record<Game, string> = {
  pokemon: "/pokeball.png",
  magic: "/planeswalk.png",
  yugioh: "/blue-eyes.png",
};

export function GameIcon({
  game,
  className = "size-5",
  decorative = false,
}: {
  game: Game;
  className?: string;
  decorative?: boolean;
}) {
  return (
    <img
      src={GAME_ICONS[game]}
      alt={decorative ? "" : GAME_LABELS[game]}
      className={className}
      width={24}
      height={24}
      style={{ imageRendering: "pixelated" }}
    />
  );
}
