import { useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  Dices,
  FilterX,
  ListFilter,
  Route,
  Tag,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  FilterChip,
  FilterChipOperator,
  FilterChipRemove,
  FilterChipSubject,
  FilterChipValue,
} from "@/components/ui/filter-chip";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GameIcon } from "@/GameIcon";
import type { GameCatalog } from "@/games";
import { cn } from "@/lib/utils";
import type { Game } from "@town-map/contracts";

export type DateFilter = "all" | "today" | "tomorrow" | "3days" | "week" | "month";
export type PriceFilter = "all" | "free" | "under10" | "under25";
type FilterId = "date" | "distance" | "games" | "price";

export const DATE_OPTIONS: Array<{ value: DateFilter; label: string; chip: string }> = [
  { value: "all", label: "Any time", chip: "Any time" },
  { value: "today", label: "Today", chip: "Today" },
  { value: "tomorrow", label: "Tomorrow", chip: "Tomorrow" },
  { value: "3days", label: "Next 3 days", chip: "3 days" },
  { value: "week", label: "Next 7 days", chip: "7 days" },
  { value: "month", label: "Next 30 days", chip: "30 days" },
];

export const PRICE_OPTIONS: Array<{ value: PriceFilter; label: string; chip: string }> = [
  { value: "all", label: "Any price", chip: "Any price" },
  { value: "free", label: "Free", chip: "Free" },
  { value: "under10", label: "Under $10", chip: "< $10" },
  { value: "under25", label: "Under $25", chip: "< $25" },
];

/**
 * Preset radii rather than a slider. Nobody searches for 3.7 miles — the real
 * intents are walkable, short drive, across town, whole region — and presets are
 * keyboard-navigable, announce as a radio group, and clear the 24px target size
 * that a slider thumb on a short track does not.
 */
const RADIUS_PRESETS = [5, 10, 25, 50, 100];

export const DEFAULT_RADIUS_MILES = 25;

const FILTERS: Record<FilterId, { label: string; icon: LucideIcon; operator: string }> = {
  date: { label: "When", icon: CalendarClock, operator: "is" },
  distance: { label: "Distance", icon: Route, operator: "within" },
  games: { label: "Games", icon: Dices, operator: "is any of" },
  price: { label: "Price", icon: Tag, operator: "is" },
};

const FILTER_ORDER: FilterId[] = ["date", "distance", "games", "price"];

export type FilterBarValue = {
  dateFilter: DateFilter;
  radiusMiles: number;
  games: Game[];
  price: PriceFilter;
};

type FilterBarProps = {
  value: FilterBarValue;
  onChange: (next: Partial<FilterBarValue>) => void;
  catalog: GameCatalog;
  /** Games the user selects by default — their saved preferences, or the whole catalog. */
  defaultGames: Game[];
  resultCount: number;
  className?: string;
};

function optionRowClasses(selected: boolean) {
  return cn(
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors",
    "hover:bg-muted focus-visible:bg-muted",
    selected && "font-medium",
  );
}

export function FilterBar({
  value,
  onChange,
  catalog,
  defaultGames,
  resultCount,
  className,
}: FilterBarProps) {
  const gamesAreDefault =
    value.games.length === defaultGames.length &&
    value.games.every((game) => defaultGames.includes(game));

  // A chip exists because the user put it there. Seeded from whatever arrived
  // narrowed in the URL so a shared link shows the filters it is actually using.
  const [active, setActive] = useState<FilterId[]>(() =>
    FILTER_ORDER.filter((id) =>
      id === "date" ? value.dateFilter !== "all"
      : id === "distance" ? value.radiusMiles !== DEFAULT_RADIUS_MILES
      : id === "games" ? !gamesAreDefault
      : value.price !== "all",
    ),
  );
  const [openFilter, setOpenFilter] = useState<FilterId | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [radiusDraft, setRadiusDraft] = useState("");

  const availableFilters = FILTER_ORDER.filter((id) => !active.includes(id));

  const dateOption = DATE_OPTIONS.find((option) => option.value === value.dateFilter) ?? DATE_OPTIONS[0];
  const priceOption = PRICE_OPTIONS.find((option) => option.value === value.price) ?? PRICE_OPTIONS[0];

  const gamesSummary = useMemo(() => {
    if (catalog.ids.length > 0 && value.games.length === catalog.ids.length) return "All games";
    if (value.games.length === 0) return "None";
    if (value.games.length === 1) return catalog.label(value.games[0]);
    return `${catalog.label(value.games[0])} +${value.games.length - 1}`;
  }, [catalog, value.games]);

  const summaries: Record<FilterId, string> = {
    date: dateOption.chip,
    distance: `${value.radiusMiles} mi`,
    games: gamesSummary,
    price: priceOption.chip,
  };

  function addFilter(id: FilterId) {
    setActive((current) => (current.includes(id) ? current : [...current, id]));
    setAddMenuOpen(false);
    // Opening the value popover straight away saves the second click — adding a
    // filter and choosing its value are one intent.
    setTimeout(() => setOpenFilter(id), 0);
  }

  function removeFilter(id: FilterId) {
    setActive((current) => current.filter((item) => item !== id));
    if (id === "date") onChange({ dateFilter: "all" });
    if (id === "distance") onChange({ radiusMiles: DEFAULT_RADIUS_MILES });
    if (id === "games") onChange({ games: defaultGames });
    if (id === "price") onChange({ price: "all" });
  }

  function toggleGame(game: Game) {
    onChange({
      games: value.games.includes(game)
        ? value.games.filter((item) => item !== game)
        : [...value.games, game],
    });
  }

  function clearAll() {
    setActive([]);
    onChange({
      dateFilter: "all",
      radiusMiles: DEFAULT_RADIUS_MILES,
      games: defaultGames,
      price: "all",
    });
  }

  function commitRadiusDraft() {
    const parsed = Number(radiusDraft);
    if (Number.isFinite(parsed) && parsed > 0) {
      onChange({ radiusMiles: Math.min(500, Math.round(parsed)) });
    }
    setRadiusDraft("");
  }

  function renderPopoverBody(id: FilterId) {
    if (id === "date" || id === "price") {
      const options = id === "date" ? DATE_OPTIONS : PRICE_OPTIONS;
      const current = id === "date" ? value.dateFilter : value.price;
      return options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={optionRowClasses(option.value === current)}
          onClick={() => {
            onChange(id === "date"
              ? { dateFilter: option.value as DateFilter }
              : { price: option.value as PriceFilter });
            setOpenFilter(null);
          }}
        >
          <span className="flex-1">{option.label}</span>
          {option.value === current && <Check className="size-3.5" />}
        </button>
      ));
    }

    if (id === "distance") {
      return (
        <>
          <div className="grid grid-cols-5 gap-1">
            {RADIUS_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-pressed={preset === value.radiusMiles}
                className={cn(
                  "rounded-md border py-1.5 text-xs transition-colors",
                  preset === value.radiusMiles
                    ? "border-primary/40 bg-secondary font-medium"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                onClick={() => onChange({ radiusMiles: preset })}
              >
                {preset}
              </button>
            ))}
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              commitRadiusDraft();
            }}
          >
            <Input
              type="number"
              min={1}
              max={500}
              inputMode="numeric"
              aria-label="Custom radius in miles"
              placeholder="Custom"
              value={radiusDraft}
              onChange={(event) => setRadiusDraft(event.target.value)}
              onBlur={commitRadiusDraft}
              className="h-8"
            />
            <span className="text-xs text-muted-foreground">miles</span>
          </form>
          <p className="text-xs text-muted-foreground">
            {resultCount} {resultCount === 1 ? "event" : "events"} match
          </p>
        </>
      );
    }

    return (
      <>
        {catalog.ids.map((game) => {
          const selected = value.games.includes(game);
          return (
            <button
              key={game}
              type="button"
              role="checkbox"
              aria-checked={selected}
              className={optionRowClasses(selected)}
              onClick={() => toggleGame(game)}
            >
              <GameIcon game={game} className="size-4 shrink-0 object-contain" decorative />
              <span className="flex-1 truncate">{catalog.label(game)}</span>
              {selected && <Check className="size-3.5 shrink-0" />}
            </button>
          );
        })}
        <div className="mt-1 flex gap-1 border-t border-border pt-1">
          <Button variant="ghost" size="xs" className="flex-1" onClick={() => onChange({ games: catalog.ids })}>
            Select all
          </Button>
          <Button variant="ghost" size="xs" className="flex-1" onClick={() => onChange({ games: defaultGames })}>
            Reset
          </Button>
        </div>
      </>
    );
  }

  const popoverWidths: Record<FilterId, string> = {
    date: "w-52 p-1",
    distance: "w-60 gap-3 p-3",
    games: "w-56 gap-1 p-1",
    price: "w-44 p-1",
  };

  return (
    <div className={cn("flex w-full items-start justify-between gap-2", className)} aria-label="Filters">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {availableFilters.length > 0 && (
          <Popover open={addMenuOpen} onOpenChange={setAddMenuOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 shrink-0 rounded-2xl text-xs">
                <ListFilter />
                Filter
              </Button>
            </PopoverTrigger>
            {/*
              Returning focus to this trigger on close would land as a focus
              event outside the value popover that addFilter opens, dismissing it
              on the same tick.
            */}
            <PopoverContent
              align="start"
              className="w-44 p-1"
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              {availableFilters.map((id) => {
                const definition = FILTERS[id];
                const Icon = definition.icon;
                return (
                  <button
                    key={id}
                    type="button"
                    className={optionRowClasses(false)}
                    onClick={() => addFilter(id)}
                  >
                    <Icon className="size-3.5 text-muted-foreground" />
                    <span className="flex-1">{definition.label}</span>
                  </button>
                );
              })}
            </PopoverContent>
          </Popover>
        )}

        {active.map((id) => {
          const definition = FILTERS[id];
          const Icon = definition.icon;
          return (
            <FilterChip key={id}>
              <FilterChipSubject>
                <Icon />
                {definition.label}
              </FilterChipSubject>
              <FilterChipOperator>{definition.operator}</FilterChipOperator>
              <Popover
                open={openFilter === id}
                onOpenChange={(open) => setOpenFilter(open ? id : null)}
              >
                <PopoverTrigger asChild>
                  <FilterChipValue>{summaries[id]}</FilterChipValue>
                </PopoverTrigger>
                <PopoverContent align="start" className={popoverWidths[id]}>
                  {renderPopoverBody(id)}
                </PopoverContent>
              </Popover>
              <FilterChipRemove
                label={`Remove ${definition.label.toLowerCase()} filter`}
                onClick={() => removeFilter(id)}
              />
            </FilterChip>
          );
        })}
      </div>

      {active.length > 0 && (
        <Button variant="destructive" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={clearAll}>
          <FilterX />
          <span className="hidden sm:block">Clear</span>
        </Button>
      )}
    </div>
  );
}
