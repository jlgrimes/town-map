import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { recurrenceLabel, type EventListItem } from "@town-map/contracts";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GameIcon } from "@/GameIcon";
import { slugifyShop } from "@/lib/shop-utils";

const META_LABELS: Record<string, string> = {
  booster_draft: "Booster Draft",
  commander: "Commander",
  commander_party: "Commander Party",
  friday_night_magic: "Friday Night Magic",
  magic_prerelease: "Prerelease",
  new_player_event: "New Player Event",
  sealed_deck: "Sealed Deck",
  standard: "Standard",
  modern: "Modern",
  pauper: "Pauper",
  other: "Other",
  SWISSDRAW: "Swiss draw",
};

export function humanizeMeta(value: string | null) {
  if (!value) return null;
  if (META_LABELS[value]) return META_LABELS[value];
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function eventMetadata(event: EventListItem) {
  const values = [humanizeMeta(event.format), humanizeMeta(event.eventType)].filter(Boolean) as string[];
  return values.filter((value, index) => values.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index);
}

export function formatPrice(event: EventListItem) {
  if (event.priceAmount === null) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: event.priceCurrency ?? "USD",
      maximumFractionDigits: event.priceAmount % 1 === 0 ? 0 : 2,
    }).format(event.priceAmount);
  } catch {
    return `${event.priceAmount} ${event.priceCurrency ?? ""}`.trim();
  }
}

export function dateLabel(dateString: string) {
  const date = new Date(dateString);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(date);
}

export function timeLabel(dateString: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(dateString));
}

export interface EventRowProps {
  event: EventListItem;
  active?: boolean;
  saved: boolean;
  canSave: boolean;
  layoutIdPrefix?: string;
  showLocation?: boolean;
  onPreview?: (eventId: string | null) => void;
  onSelect: (eventId: string) => void;
  onToggleSave: (eventId: string) => void;
}

export function EventRow({
  event,
  active = false,
  saved,
  canSave,
  layoutIdPrefix = "discover",
  showLocation = true,
  onPreview,
  onSelect,
  onToggleSave,
}: EventRowProps) {
  const location = [event.venue?.name, event.venue?.city, event.venue?.region].filter(Boolean).join(" · ");
  const formattedTime = timeLabel(event.startsAt);
  const formattedDate = dateLabel(event.startsAt);

  const metaText = [
    ...eventMetadata(event),
    formatPrice(event),
  ].filter(Boolean).join(" · ");

  return (
    <motion.div
      layoutId={`card-${layoutIdPrefix}-${event.id}`}
      key={`card-${layoutIdPrefix}-${event.id}`}
      id={`event-${event.id}`}
      onClick={() => onSelect(event.id)}
      onMouseEnter={() => onPreview?.(event.id)}
      onMouseLeave={() => onPreview?.(null)}
      className={`p-3 sm:p-4 flex flex-row items-center justify-between gap-3 hover:bg-muted/40 rounded-2xl cursor-pointer transition-colors border border-transparent ${
        active ? "bg-muted/70 border-border/50" : ""
      }`}
    >
      <div className="flex gap-3 items-center min-w-0 flex-1">
        <motion.div layout className="w-16 shrink-0 text-xs font-semibold text-muted-foreground whitespace-nowrap">
          {showLocation ? formattedTime : `${formattedDate}`}
        </motion.div>
        <motion.div layoutId={`image-${layoutIdPrefix}-${event.id}`} className="shrink-0">
          <div className="h-12 w-12 rounded-xl bg-background flex items-center justify-center p-1.5 border border-border shadow-xs ring-1 ring-border/50 shrink-0">
            <GameIcon game={event.game} className="size-8 object-contain" />
          </div>
        </motion.div>
        <motion.div layout className="min-w-0 flex-1">
          <h3 className="font-bold text-foreground text-sm leading-snug truncate">
            {event.title}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {showLocation ? (
              <>
                {event.venue?.name ? (
                  <Link
                    to={`/shop/${slugifyShop(event.venue.name, event.venue.city)}`}
                    onClick={(e) => e.stopPropagation()}
                    className="hover:underline hover:text-primary transition-colors font-medium text-foreground/80"
                  >
                    {event.venue.name}
                  </Link>
                ) : (
                  "Venue to be announced"
                )}
                {event.venue?.city ? ` · ${event.venue.city}` : ""}
                {event.distanceMiles !== null ? ` · ${event.distanceMiles} mi away` : ""}
              </>
            ) : (
              <span>{metaText || `${formattedTime} · ${event.venue?.city ?? ""}`}</span>
            )}
          </p>
        </motion.div>
      </div>

      <motion.div layout className="flex items-center gap-1.5 sm:gap-2 shrink-0 self-center">
        {event.sourceUrl ? (
          <motion.a
            layoutId={`button-${layoutIdPrefix}-${event.id}`}
            href={event.sourceUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="px-3.5 py-1.5 text-xs rounded-full font-bold bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 shrink-0 shadow-xs transition-colors"
          >
            Event Page
          </motion.a>
        ) : (
          <motion.button
            layoutId={`button-${layoutIdPrefix}-${event.id}`}
            className="px-3.5 py-1.5 text-xs rounded-full font-bold bg-secondary text-secondary-foreground shrink-0 transition-colors"
          >
            Event
          </motion.button>
        )}

        {canSave && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={`size-8 rounded-full ${saved ? "text-primary" : "text-muted-foreground"}`}
            aria-pressed={saved}
            aria-label={saved ? `Remove ${event.title} from My events` : `Save ${event.title} to My events`}
            title={saved ? "Saved" : "Save"}
            onClick={(clickEvent) => {
              clickEvent.stopPropagation();
              onToggleSave(event.id);
            }}
          >
            {saved ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
          </Button>
        )}
      </motion.div>
    </motion.div>
  );
}
