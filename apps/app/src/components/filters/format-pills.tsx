import { cn } from "@/lib/utils";

export type MagicFormat = "commander" | "constructed" | "draft" | "sealed";
export type FormatFilter = "all" | MagicFormat;

export const MAGIC_FORMAT_CHIPS: Array<{ value: FormatFilter; label: string }> = [
  { value: "all", label: "All formats" },
  { value: "commander", label: "Commander" },
  { value: "constructed", label: "Constructed" },
  { value: "draft", label: "Draft" },
  { value: "sealed", label: "Sealed" },
];

const MAGIC_FORMATS: MagicFormat[] = ["commander", "constructed", "draft", "sealed"];

const ALIASES: Record<MagicFormat, string[]> = {
  commander: ["commander"],
  constructed: ["constructed"],
  draft: ["booster draft", "booster_draft", "draft"],
  sealed: ["sealed", "sealed deck", "sealed_deck"],
};

export function initialFormat(params: URLSearchParams): FormatFilter {
  const raw = params.get("format");
  return MAGIC_FORMATS.includes(raw as MagicFormat) ? (raw as MagicFormat) : "all";
}

export function nextFormatSelection(current: FormatFilter, tapped: FormatFilter): FormatFilter {
  if (tapped === "all") return "all";
  return current === tapped ? "all" : tapped;
}

export function matchesFormat(format: string | null, filter: FormatFilter): boolean {
  if (filter === "all") return true;
  const raw = (format ?? "").trim().toLowerCase();
  if (raw.length === 0) return false;
  return ALIASES[filter].some((alias) => raw === alias || raw.includes(alias));
}

export function magicIsOn(selectedGames: string[]): boolean {
  return selectedGames.length === 0 || selectedGames.includes("magic");
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
}: {
  selected: FormatFilter;
  onChange: (next: FormatFilter) => void;
}) {
  return (
    <div
      className="flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="toolbar"
      aria-label="Choose a Magic format"
    >
      {MAGIC_FORMAT_CHIPS.map((chip) => {
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
