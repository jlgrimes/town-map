/**
 * Players' language for Magic formats, not WPN's dump bucket.
 *
 * Commander / Draft / Sealed stay on the payload format (`Booster Draft` → Draft).
 * Standard / Modern / Pioneer are lifted from the title when WPN stuffed them
 * into Constructed. Constructed itself is not a format we ship.
 */
export const PLAYER_MAGIC_FORMATS = [
  "Commander",
  "Standard",
  "Modern",
  "Pioneer",
  "Draft",
  "Sealed",
] as const;
export type PlayerMagicFormat = (typeof PLAYER_MAGIC_FORMATS)[number];

const MAGIC_FORMAT_ALIASES: Record<"commander" | "draft" | "sealed", string[]> = {
  commander: ["commander"],
  draft: ["booster draft", "booster_draft", "draft"],
  sealed: ["sealed", "sealed deck", "sealed_deck"],
};

const TITLE_MAGIC_FORMATS = ["standard", "modern", "pioneer"] as const;

function hasWord(haystack: string, word: string) {
  return new RegExp(`\\b${word}\\b`, "i").test(haystack);
}

export function playerMagicFormat(format: string | null, title: string): PlayerMagicFormat | null {
  const raw = (format ?? "").trim().toLowerCase();
  if (MAGIC_FORMAT_ALIASES.commander.some((alias) => raw === alias || raw.includes(alias))) return "Commander";
  if (MAGIC_FORMAT_ALIASES.draft.some((alias) => raw === alias || raw.includes(alias))) return "Draft";
  if (MAGIC_FORMAT_ALIASES.sealed.some((alias) => raw === alias || raw.includes(alias))) return "Sealed";
  const haystack = `${raw} ${title}`;
  for (const name of TITLE_MAGIC_FORMATS) {
    if (hasWord(haystack, name)) {
      return (name.charAt(0).toUpperCase() + name.slice(1)) as PlayerMagicFormat;
    }
  }
  return null;
}

export function withPlayerMagicFormat<T extends { game: string; format: string | null; title: string }>(event: T): T {
  if (event.game !== "magic") return event;
  return { ...event, format: playerMagicFormat(event.format, event.title) };
}
