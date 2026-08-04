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
          <div className="fixed inset-0 grid place-items-center z-50 p-4 sm:p-6">
            <motion.button
              key={`button-close-${event.id}-${id}`}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.05 } }}
              className="flex absolute top-4 right-4 z-50 items-center justify-center bg-white dark:bg-neutral-800 text-black dark:text-white rounded-full h-7 w-7 shadow-md"
              onClick={onClose}
              aria-label="Close modal"
            >
              <X className="h-4 w-4" />
            </motion.button>
            <motion.div
              layoutId={`card-${layoutIdPrefix}-${event.id}`}
              ref={ref}
              className="w-full max-w-[500px] h-full md:h-fit md:max-h-[90%] flex flex-col bg-white dark:bg-neutral-900 sm:rounded-3xl overflow-hidden text-neutral-800 dark:text-neutral-200 shadow-2xl"
            >
              <div>
                <div className="flex justify-between items-start p-4 border-b dark:border-neutral-800">
                  <div className="flex gap-4 flex-col md:flex-row items-start">
                    <motion.div layoutId={`image-${layoutIdPrefix}-${event.id}`}>
                      <div className="h-14 w-14 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center p-2 border border-neutral-200 dark:border-neutral-700 shrink-0">
                        <GameIcon game={event.game} className="size-10 object-contain" />
                      </div>
                    </motion.div>
                    <div>
                      <motion.h3
                        layoutId={`title-${layoutIdPrefix}-${event.id}`}
                        className="font-bold text-neutral-700 dark:text-neutral-200 text-lg leading-tight"
                      >
                        {event.title}
                      </motion.h3>
                      <motion.p
                        layoutId={`description-${layoutIdPrefix}-${event.id}`}
                        className="text-neutral-600 dark:text-neutral-400 text-sm mt-0.5"
                      >
                        {location || "Venue to be announced"}
                      </motion.p>
                    </div>
                  </div>

                  {event.sourceUrl ? (
                    <motion.a
                      layoutId={`button-${layoutIdPrefix}-${event.id}`}
                      href={event.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-4 py-3 text-sm rounded-full font-bold bg-green-500 hover:bg-green-600 text-white shrink-0 transition-colors"
                    >
                      Event Page
                    </motion.a>
                  ) : (
                    <motion.button
                      layoutId={`button-${layoutIdPrefix}-${event.id}`}
                      className="px-4 py-2 text-sm rounded-full font-bold bg-gray-100 dark:bg-neutral-800 text-black dark:text-white shrink-0"
                    >
                      Event
                    </motion.button>
                  )}
                </div>

                <div className="pt-4 relative px-4">
                  <motion.div
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-neutral-600 text-xs md:text-sm lg:text-base md:h-fit pb-6 flex flex-col items-start gap-4 overflow-auto dark:text-neutral-400"
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

                    <div className="w-full pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
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
                </div>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
