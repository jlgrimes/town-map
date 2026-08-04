import React, { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { type EventListItem } from "@town-map/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Typography } from "@/components/ui/typography";
import { GameIcon } from "@/GameIcon";
import { useGameCatalog } from "@/games";
import { slugifyShop } from "@/lib/shop-utils";
import {
  Bookmark,
  BookmarkCheck,
  Building2,
  Calendar,
  Clock,
  MapPin,
  Tag,
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

  useOutsideClick(ref, () => onClose());

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    if (event) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [event, onClose]);

  if (!event) return null;

  const location = [event.venue?.name, event.venue?.city, event.venue?.region]
    .filter(Boolean)
    .join(" · ");

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
    <>
      <AnimatePresence>
        {event && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/20 h-full w-full z-40"
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {event ? (
          <div className="fixed inset-0 grid place-items-center z-50 p-4">
            <motion.div
              layoutId={`card-${layoutIdPrefix}-${event.id}`}
              ref={ref}
              className="w-full max-w-[520px] flex flex-col bg-card border border-border rounded-3xl overflow-hidden text-card-foreground shadow-2xl"
            >
              <div>
                <div className="flex justify-between items-start p-5 border-b bg-muted/40">
                  {/* Same grouping as the collapsed row: icon and text stay on one line,
                      vertically centered, at the row's gap. */}
                  <div className="flex gap-3.5 items-center min-w-0 flex-1">
                    <motion.div layoutId={`image-${layoutIdPrefix}-${event.id}`} className="shrink-0">
                      <div className="h-12 w-12 rounded-xl bg-background flex items-center justify-center p-1.5 border border-border shrink-0 shadow-xs ring-1 ring-border/50">
                        <GameIcon game={event.game} className="size-8 object-contain" />
                      </div>
                    </motion.div>
                    {/* Type matches the collapsed row. Still not layoutId-shared: the row
                        truncates inside a flex-1 box while this wraps at content width, so a
                        shared element could only bridge those widths by scaling the glyphs.
                        `layout` makes the outer node cancel the card's scale, and the inner
                        node fades in at its final size. */}
                    <motion.div layout className="min-w-0 flex-1">
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, transition: { duration: 0.05 } }}
                        transition={{ duration: 0.2, ease: "easeOut", delay: 0.08 }}
                      >
                        <h3 className="font-bold text-foreground text-sm leading-snug">
                          {event.title}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {location || "Venue to be announced"}
                        </p>
                      </motion.div>
                    </motion.div>
                  </div>
                </div>

                {/* `layout` makes this a projection node so it cancels the scale the expanding
                    card would otherwise stretch its contents by. The fade-up lives on the inner
                    div because layout and animating `y` both write to transform. */}
                <motion.div layout className="pt-4 relative px-5">
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8, transition: { duration: 0.1, ease: "easeIn" } }}
                    transition={{ duration: 0.25, ease: "easeOut", delay: 0.1 }}
                    className="text-muted-foreground text-sm pb-6 flex flex-col items-start gap-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 w-full pt-1">
                      <Badge variant="secondary" className="font-medium">
                        {catalog.label(event.game)}
                      </Badge>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="flex items-center gap-1 font-medium">
                          <Calendar className="size-3.5 text-primary" />
                          {dateFormatted}
                        </span>
                        <span className="flex items-center gap-1 font-medium">
                          <Clock className="size-3.5 text-primary" />
                          {timeFormatted}
                        </span>
                      </div>
                    </div>

                    <div className="w-full rounded-2xl border bg-neutral-50 dark:bg-neutral-800/50 p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="flex items-start gap-2.5">
                          <MapPin className="size-4 shrink-0 text-primary mt-0.5" />
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

                        {event.venue?.name && (
                          <Link
                            to={`/shop/${slugifyShop(event.venue.name, event.venue.city)}`}
                            onClick={() => onClose()}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline shrink-0 bg-background border rounded-lg px-2.5 py-1 shadow-xs"
                          >
                            <span>Shop Page</span>
                            <Building2 className="size-3" />
                          </Link>
                        )}
                      </div>
                    </div>

                    <div className="w-full space-y-2">
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

                    {event.description && (
                      <div className="w-full space-y-1.5 pt-1">
                        <Typography variant="kicker" as="h4">
                          Description
                        </Typography>
                        <p className="text-xs sm:text-sm text-foreground/90 leading-relaxed whitespace-pre-line bg-muted/30 border rounded-2xl p-4">
                          {event.description}
                        </p>
                      </div>
                    )}

                    <div className="w-full pt-2 flex flex-wrap items-center gap-3">
                      {mapsUrl && (
                        <a
                          href={mapsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-input bg-background px-4 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
                        >
                          <MapPin className="size-3.5 text-muted-foreground" />
                          <span>Open in Google Maps</span>
                        </a>
                      )}

                      {canSave && (
                        <Button
                          type="button"
                          variant={saved ? "secondary" : "outline"}
                          className="h-10 gap-2 rounded-xl px-4 text-xs font-medium"
                          onClick={() => onToggleSave(event.id)}
                        >
                          {saved ? (
                            <>
                              <BookmarkCheck className="size-3.5 text-primary fill-primary/20" />
                              <span>Saved to My Events</span>
                            </>
                          ) : (
                            <>
                              <Bookmark className="size-3.5 text-muted-foreground" />
                              <span>Save Event</span>
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </motion.div>
                </motion.div>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
