import { GameIcon } from "@/GameIcon";
import type { GameCatalog } from "@/games";
import { cn } from "@/lib/utils";
import type { Game } from "@town-map/contracts";

/** Tap All -> every game. Tap a game -> just that game. Tap it again -> All. */
export function nextGameSelection(selected: Game[], tapped: Game | "all"): Game[] {
  if (tapped === "all") return [];
  const onlyThis = selected.length === 1 && selected[0] === tapped;
  return onlyThis ? [] : [tapped];
}

export function GamePills({
  catalog,
  selected,
  onChange,
}: {
  catalog: GameCatalog;
  selected: Game[];
  onChange: (games: Game[]) => void;
}) {
  const allOn =
    selected.length === 0 || catalog.ids.every((id) => selected.includes(id));

  return (
    <div
      className="flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="toolbar"
      aria-label="Choose a game"
    >
      <button
        type="button"
        aria-pressed={allOn}
        className={pillClass(allOn)}
        onClick={() => onChange(nextGameSelection(selected, "all"))}
      >
        All
      </button>
      {catalog.ids.map((game) => {
        const on = !allOn && selected.includes(game);
        return (
          <button
            key={game}
            type="button"
            aria-pressed={on}
            className={pillClass(on)}
            onClick={() => onChange(nextGameSelection(selected, game))}
          >
            <GameIcon game={game} className="size-4 shrink-0 object-contain" decorative />
            <span className="truncate">{catalog.label(game)}</span>
          </button>
        );
      })}
    </div>
  );
}

function pillClass(on: boolean) {
  return cn(
    "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
    on
      ? "border-primary/40 bg-primary text-primary-foreground shadow-sm"
      : "border-border bg-card text-foreground hover:bg-muted",
  );
}
