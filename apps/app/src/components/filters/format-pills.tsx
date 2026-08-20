import { PLAYER_MAGIC_FORMATS } from "@town-map/contracts";
import { cn } from "@/lib/utils";

export type MagicFormat = "commander" | "standard" | "modern" | "pioneer" | "draft" | "sealed";
export type FormatFilter = "all" | MagicFormat;

export const MAGIC_FORMAT_CHIPS: Array<{ value: FormatFilter; label: string }> = [
  { value: "all", label: "All formats" },
  ...PLAYER_MAGIC_FORMATS.map((label) => ({
    value: label.toLowerCase() as MagicFormat,
    label,
  })),
];

const MAGIC_FORMATS = PLAYER_MAGIC_FORMATS.map((label) => label.toLowerCase() as MagicFormat);

/** Read GET /v1/events format. The API already lifted player language; do not map titles here. */
export function playerFormat(format: string | null): MagicFormat | null {
  const raw = (format ?? "").trim().toLowerCase();
  return MAGIC_FORMATS.includes(raw as MagicFormat) ? (raw as MagicFormat) : null;
}

export function initialFormat(params: URLSearchParams): FormatFilter {
  const raw = params.get("format");
  return MAGIC_FORMATS.includes(raw as MagicFormat) ? (raw as MagicFormat) : "all";
}

export function nextFormatSelection(current: FormatFilter, tapped: FormatFilter): FormatFilter {
  if (tapped === "all") return "all";
  return current === tapped ? "all" : tapped;
}

export function matchesFormat(format: string | null, filter: FormatFilter, _title?: string): boolean {
  if (filter === "all") return true;
  return playerFormat(format) === filter;
}

export function magicIsOn(selectedGames: string[]): boolean {
  return selectedGames.length === 0 || selectedGames.includes("magic");
}

export function formatChipsForEvents(events: Array<{ format: string | null }>) {
  const present = new Set(events.map((event) => playerFormat(event.format)));
  return MAGIC_FORMAT_CHIPS.filter((chip) => chip.value === "all" || present.has(chip.value));
}

function pillClass(on: boolean) {
  return cn(
    "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
    on
      ? "border-primary/40 bg-primary text-primary-foreground shadow-sm"
      : "border-border bg-card text-foreground hover:bg-muted",
  );
}

export function FormatPills({
  selected,
  onChange,
  chips = MAGIC_FORMAT_CHIPS,
}: {
  selected: FormatFilter;
  onChange: (next: FormatFilter) => void;
  chips?: Array<{ value: FormatFilter; label: string }>;
}) {
  return (
    <div
      className="flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="toolbar"
      aria-label="Choose a Magic format"
    >
      {chips.map((chip) => {
        const on = selected === chip.value;
        return (
          <button
            key={chip.value}
            type="button"
            aria-pressed={on}
            className={pillClass(on)}
            onClick={() => onChange(nextFormatSelection(selected, chip.value))}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
