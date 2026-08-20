import { cn } from "@/lib/utils";

export type MagicFormat = "commander" | "standard" | "modern" | "pioneer" | "draft" | "sealed";
export type FormatFilter = "all" | MagicFormat;

export const MAGIC_FORMAT_CHIPS: Array<{ value: FormatFilter; label: string }> = [
  { value: "all", label: "All formats" },
  { value: "commander", label: "Commander" },
  { value: "standard", label: "Standard" },
  { value: "modern", label: "Modern" },
  { value: "pioneer", label: "Pioneer" },
  { value: "draft", label: "Draft" },
  { value: "sealed", label: "Sealed" },
];

const MAGIC_FORMATS: MagicFormat[] = ["commander", "standard", "modern", "pioneer", "draft", "sealed"];

const ALIASES: Record<"commander" | "draft" | "sealed", string[]> = {
  commander: ["commander"],
  draft: ["booster draft", "booster_draft", "draft"],
  sealed: ["sealed", "sealed deck", "sealed_deck"],
};

const TITLE_FORMATS: MagicFormat[] = ["standard", "modern", "pioneer"];

function hasWord(haystack: string, word: string) {
  return new RegExp(`\\b${word}\\b`, "i").test(haystack);
}

/**
 * Players' language, not WPN's dump.
 * Commander / Draft / Sealed stay on the payload format.
 * Standard / Modern / Pioneer are derived from the title when WPN stuffed them into Constructed.
 */
export function playerFormat(format: string | null, title: string): MagicFormat | null {
  const raw = (format ?? "").trim().toLowerCase();
  if (ALIASES.commander.some((alias) => raw === alias || raw.includes(alias))) return "commander";
  if (ALIASES.draft.some((alias) => raw === alias || raw.includes(alias))) return "draft";
  if (ALIASES.sealed.some((alias) => raw === alias || raw.includes(alias))) return "sealed";
  const haystack = `${raw} ${title}`;
  for (const name of TITLE_FORMATS) {
    if (hasWord(haystack, name)) return name;
  }
  return null;
}

export function initialFormat(params: URLSearchParams): FormatFilter {
  const raw = params.get("format");
  return MAGIC_FORMATS.includes(raw as MagicFormat) ? (raw as MagicFormat) : "all";
}

export function nextFormatSelection(current: FormatFilter, tapped: FormatFilter): FormatFilter {
  if (tapped === "all") return "all";
  return current === tapped ? "all" : tapped;
}

export function matchesFormat(format: string | null, filter: FormatFilter, title = ""): boolean {
  if (filter === "all") return true;
  return playerFormat(format, title) === filter;
}

export function magicIsOn(selectedGames: string[]): boolean {
  return selectedGames.length === 0 || selectedGames.includes("magic");
}

export function formatChipsForEvents(events: Array<{ format: string | null; title: string }>) {
  const present = new Set(events.map((event) => playerFormat(event.format, event.title)));
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
