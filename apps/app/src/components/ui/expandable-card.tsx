import React, { useEffect, useRef, useId } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { type EventListItem } from "@town-map/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Typography } from "@/components/ui/typography";
import { GameIcon } from "@/GameIcon";
import { useGameCatalog } from "@/games";
import {
  Bookmark,
  BookmarkCheck,
  Calendar,
  Clock,
  ExternalLink,
  MapPin,
  Tag,
  X,
  Navigation,
  DollarSign,
  Users,
  Repeat,
} from "lucide-react";

export function useOutsideClick(
  ref: React.RefObject<HTMLDivElement | null>,
  callback: (event: MouseEvent | TouchEvent) => void
) {
  useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      if (!ref.current || ref.current.contains(event.target as Node)) {
        return;
      }
      callback(event);
    };

    document.addEventListener("mousedown", listener);
    document.addEventListener("touchstart", listener);

    return () => {
      document.removeEventListener("mousedown", listener);
      document.removeEventListener("touchstart", listener);
    };
  }, [ref, callback]);
}

interface ExpandableEventCardProps {
  event: EventListItem | null;
  layoutIdPrefix?: string;
  onClose: () => void;
  saved: boolean;
  canSave: boolean;
  onToggleSave: (eventId: string) => void;
  eventMetadata: (event: EventListItem) => string[];
  formatPrice: (event: EventListItem) => string | null;
  recurrenceLabel: (series: EventListItem["series"]) => string | null;
}

export function ExpandableEventCardModal({
  event,
  layoutIdPrefix = "discover",
  onClose,
  saved,
  canSave,
  onToggleSave,
  eventMetadata,
  formatPrice,
  recurrenceLabel,
}: ExpandableEventCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const catalog = useGameCatalog();
  const id = useId();

  useOutsideClick(ref, () => {
    onClose();
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    if (event) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", onKeyDown);
    }

    return () => {
      document.body.style.overflow = "auto";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [event, onClose]);

  if (!event) return null;

  const fullAddress = [
    event.venue?.address,
    event.venue?.city,
    event.venue?.region,
    event.venue?.postalCode,
  ]
    .filter(Boolean)
    .join(", ");

  const mapsQuery = [
    event.venue?.name,
    event.venue?.address,
    event.venue?.city,
    event.venue?.region,
    event.venue?.postalCode,
  ]
    .filter(Boolean)
    .join(", ");

  const mapsUrl = mapsQuery
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`
    : null;

  const dateFormatted = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(event.startsAt));

  const timeFormatted = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(event.startsAt));

  const details = eventMetadata(event);
  const price = formatPrice(event);
  const recurrence = recurrenceLabel(event.series);

  return (
    <AnimatePresence>
      {event && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 md:p-10">
          {/* Aceternity Backdrop overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-xs"
            onClick={onClose}
          />

          {/* Aceternity Expanded Card Container */}
          <motion.div
            layoutId={`card-${layoutIdPrefix}-${event.id}`}
            ref={ref}
            transition={{ type: "spring", stiffness: 350, damping: 30 }}
            className="relative z-10 flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-border bg-card text-card-foreground shadow-2xl"
          >
            {/* Header with game info and close button */}
            <div className="relative flex items-center justify-between border-b bg-muted/40 px-6 py-5">
              <div className="flex items-center gap-3">
                <motion.div
                  layoutId={`game-icon-${layoutIdPrefix}-${event.id}`}
                  className="flex size-10 items-center justify-center rounded-xl bg-background p-1.5 shadow-xs ring-1 ring-border/50"
                >
                  <GameIcon game={event.game} className="size-7 object-contain" />
                </motion.div>
                <div>
                  <Badge variant="secondary" className="font-medium">
                    {catalog.label(event.game)}
                  </Badge>
                </div>
              </div>

              {/* Close Button */}
              <motion.button
                onClick={onClose}
                aria-label="Close details"
                className="grid size-9 place-items-center rounded-full bg-muted/80 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-hidden"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <X className="size-5" />
              </motion.button>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
              {/* Title & Timing */}
              <div>
                <motion.h3
                  layoutId={`title-${layoutIdPrefix}-${event.id}`}
                  className="text-2xl font-bold tracking-tight text-foreground"
                >
                  {event.title}
                </motion.h3>

                <div className="mt-3 flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-1.5 font-medium text-foreground">
                    <Calendar className="size-4 text-primary" />
                    <Typography variant="body" as="span" className="font-medium">
                      {dateFormatted}
                    </Typography>
                  </div>
                  <div className="flex items-center gap-1.5 font-medium text-foreground">
                    <Clock className="size-4 text-primary" />
                    <Typography variant="body" as="span" className="font-medium">
                      {timeFormatted}
                    </Typography>
                  </div>
                </div>
              </div>

              {/* Venue / Location Details */}
              <div className="rounded-2xl border bg-muted/20 p-4 space-y-2">
                <div className="flex items-start gap-2.5">
                  <MapPin className="size-5 shrink-0 text-primary mt-0.5" />
                  <div>
                    <Typography variant="h3" as="h4">
                      {event.venue?.name || "Venue to be announced"}
                    </Typography>
                    {fullAddress && (
                      <Typography variant="caption" className="mt-0.5 block leading-relaxed">
                        {fullAddress}
                      </Typography>
                    )}
                    {event.distanceMiles !== null && (
                      <Typography variant="caption" className="mt-1 flex items-center font-medium">
                        <Navigation className="inline size-3 mr-1 text-primary" />
                        {event.distanceMiles} miles away
                      </Typography>
                    )}
                  </div>
                </div>
              </div>

              {/* Metadata Badges / Info */}
              <div className="space-y-3">
                <Typography variant="kicker" as="h4">
                  Event Details
                </Typography>
                <div className="flex flex-wrap gap-2">
                  {price && (
                    <Badge variant="outline" className="gap-1 py-1 px-3 text-xs font-medium">
                      <DollarSign className="size-3 text-emerald-500" />
                      {price}
                    </Badge>
                  )}
                  {event.capacity !== null && (
                    <Badge variant="outline" className="gap-1 py-1 px-3 text-xs font-medium">
                      <Users className="size-3 text-blue-500" />
                      Capacity: {event.capacity}
                    </Badge>
                  )}
                  {recurrence && (
                    <Badge variant="outline" className="gap-1 py-1 px-3 text-xs font-medium">
                      <Repeat className="size-3 text-purple-500" />
                      {recurrence}
                    </Badge>
                  )}
                  {details.map((detail) => (
                    <Badge key={detail} variant="secondary" className="gap-1 py-1 px-3 text-xs font-medium">
                      <Tag className="size-3" />
                      {detail}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer with Links & Actions */}
            <div className="border-t bg-muted/30 px-6 py-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 flex-1">
                {event.sourceUrl && (
                  <a
                    href={event.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    <span>Event Website</span>
                    <ExternalLink className="size-4" />
                  </a>
                )}

                {mapsUrl && (
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    <MapPin className="size-4 text-muted-foreground" />
                    <span>Google Maps</span>
                  </a>
                )}
              </div>

              {canSave && (
                <Button
                  type="button"
                  variant={saved ? "secondary" : "outline"}
                  className="h-11 gap-2 rounded-xl px-4 font-medium"
                  onClick={() => onToggleSave(event.id)}
                >
                  {saved ? (
                    <>
                      <BookmarkCheck className="size-4 text-primary fill-primary/20" />
                      <span>Saved</span>
                    </>
                  ) : (
                    <>
                      <Bookmark className="size-4 text-muted-foreground" />
                      <span>Save Event</span>
                    </>
                  )}
                </Button>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

