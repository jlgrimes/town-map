import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DotBackground } from "@/components/ui/dot-background";
import { SpotlightSearch } from "@/components/ui/spotlight-search";
import { Typography } from "@/components/ui/typography";
import { FilterBar, type FilterBarValue } from "@/components/filters/filter-bar";
import { GamePills } from "@/components/filters/game-pills";
import { FormatPills, magicIsOn, type FormatFilter } from "@/components/filters/format-pills";
import { GameIcon } from "@/GameIcon";
import { dateLabel, timeLabel } from "@/components/ui/event-row";
import { cn } from "@/lib/utils";
import { CircleAlert, Home, LocateFixed, MapPin, RefreshCw, Search, X } from "lucide-react";
import { lazy, Suspense, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { EventListItem, Game } from "@town-map/contracts";
import type { GameCatalog } from "./games";
import { LoadingCards } from "./account-chrome";
import { FIRST_PAINT_PLACE_ASK, discoverFirstPaint, discoverResultsPaint } from "./town-map-model";
import {
  buildCarousels,
  defaultHomeChipFor,
  homeChipsFor,
  rankForChip,
  registrationHref,
  type EventCarousel,
  type HomeChip,
} from "./discover-rank";

const EventMap = lazy(() => import("./EventMap").then((module) => ({ default: module.EventMap })));

export type DiscoverPanelProps = {
  catalog: GameCatalog;
  selectedGames: Game[];
  setSelectedGames: (games: Game[] | null) => void;
  formatFilter: FormatFilter;
  setFormatFilter: (next: FormatFilter) => void;
  formatChips: Array<{ value: FormatFilter; label: string }>;
  placeQuery: string;
  setPlaceQuery: (value: string) => void;
  searchPlace: (event: FormEvent<HTMLFormElement>) => void;
  locationStatus: "idle" | "searching" | "locating";
  useCurrentLocation: () => void;
  authSignedIn: boolean;
  homeAddress: string | null;
  resetToSavedHome: () => void;
  filterValue: FilterBarValue;
  handleFilterChange: (next: Partial<FilterBarValue>) => void;
  defaultGames: Game[];
  visibleEvents: EventListItem[];
  locationNotice: string | null;
  locationResolved: boolean;
  locationLabel: string;
  status: "loading" | "live" | "preview" | "error";
  location: { latitude: number; longitude: number };
  mappableEvents: EventListItem[];
  activeEventId: string | null;
  selectedEventId: string | null;
  handleMapSelect: (eventId: string) => void;
  setHighlightedEventId: (eventId: string | null) => void;
  handleClearSelectedEvent: () => void;
  emptyState: { title: string; description: string; action: string; onClick: () => void };
  eventGroups: Array<{ key: string; label: string; events: EventListItem[] }>;
  savedIds: Set<string>;
  canSave: boolean;
  handleDiscoverSelect: (eventId: string) => void;
  toggleSaved: (eventId: string) => void;
  visibleCount: number;
  setVisibleCount: (update: (count: number) => number) => void;
  resultsTruncated: boolean;
};

function pillClass(on: boolean) {
  return cn(
    "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
    on
      ? "border-primary/40 bg-primary text-primary-foreground shadow-sm"
      : "border-border bg-card text-foreground hover:bg-muted",
  );
}

function PlaceSearchForm({
  placeQuery,
  setPlaceQuery,
  searchPlace,
  locationStatus,
  useCurrentLocation,
  autoFocus,
  compact,
  extra,
}: {
  placeQuery: string;
  setPlaceQuery: (value: string) => void;
  searchPlace: (event: FormEvent<HTMLFormElement>) => void;
  locationStatus: "idle" | "searching" | "locating";
  useCurrentLocation: () => void;
  autoFocus: boolean;
  compact?: boolean;
  extra?: ReactNode;
}) {
  const field = compact ? "h-9 pr-9 pl-9" : "h-11 pr-11 pl-10";
  const action = compact ? "h-9 shrink-0" : "h-11 shrink-0";
  const iconBtn = compact ? "size-9 shrink-0" : "size-11 shrink-0";
  return (
    <SpotlightSearch className="w-full">
      <form onSubmit={searchPlace} className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Label className="sr-only" htmlFor="place-search">City, state, or ZIP code</Label>
          <MapPin className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground z-20" />
          <Input
            id="place-search"
            value={placeQuery}
            onChange={(event) => setPlaceQuery(event.target.value)}
            placeholder="City or ZIP"
            autoFocus={autoFocus}
            autoComplete="postal-code"
            className={field}
          />
          {placeQuery && <Button type="button" variant="ghost" size="icon" className={`absolute top-1/2 right-1.5 ${compact ? "size-7" : "size-9"} -translate-y-1/2 z-20`} aria-label="Clear location" onClick={() => setPlaceQuery("")}><X /></Button>}
        </div>
        <Button type="submit" className={action} disabled={!placeQuery.trim() || locationStatus === "searching"}>
          {locationStatus === "searching" ? "Searching…" : "Search"}
        </Button>
        <Button type="button" variant="outline" size="icon" className={iconBtn} onClick={useCurrentLocation} disabled={locationStatus === "locating"} aria-label="Use my current location" title="Use my current location">
          <LocateFixed />
        </Button>
        {extra}
      </form>
    </SpotlightSearch>
  );
}

function SavedHomeButton({
  authSignedIn,
  homeAddress,
  resetToSavedHome,
  locationStatus,
}: {
  authSignedIn: boolean;
  homeAddress: string | null;
  resetToSavedHome: () => void;
  locationStatus: "idle" | "searching" | "locating";
}) {
  if (!authSignedIn || !homeAddress) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 px-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={resetToSavedHome}
      disabled={locationStatus === "searching"}
    >
      <Home className="mr-1.5 size-3.5" />
      Use saved home ({homeAddress})
    </Button>
  );
}

function HomeChips({
  selected,
  onChange,
  chips,
}: {
  selected: HomeChip;
  onChange: (next: HomeChip) => void;
  chips: Array<{ value: HomeChip; label: string }>;
}) {
  return (
    <div
      className="flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="tablist"
      aria-label={chips.map((chip) => chip.label).join(", ")}
    >
      {chips.map((chip) => {
        const on = selected === chip.value;
        return (
          <button
            key={chip.value}
            type="button"
            role="tab"
            aria-selected={on}
            className={pillClass(on)}
            onClick={() => onChange(chip.value)}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}

function CompactEventCard({
  event,
  active,
  onPreview,
  onOpen,
}: {
  event: EventListItem;
  active: boolean;
  onPreview: (eventId: string | null) => void;
  onOpen: (event: EventListItem) => void;
}) {
  const miles = event.distanceMiles != null ? `${event.distanceMiles} mi` : null;
  return (
    <button
      type="button"
      onClick={() => onOpen(event)}
      onMouseEnter={() => onPreview(event.id)}
      onMouseLeave={() => onPreview(null)}
      className={cn(
        "flex w-56 shrink-0 flex-col gap-2 rounded-2xl border bg-card p-3 text-left shadow-xs transition-colors hover:bg-muted/40",
        active && "border-border/50 bg-muted/70",
      )}
    >
      <div className="flex items-center gap-2">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-background p-1.5">
          <GameIcon game={event.game} className="size-7 object-contain" />
        </div>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold leading-snug">{event.title}</p>
      </div>
      <p className="truncate text-xs text-muted-foreground">
        {dateLabel(event.startsAt)} · {timeLabel(event.startsAt)}
      </p>
      <p className="truncate text-xs text-muted-foreground">
        {event.venue?.name ?? "Venue to be announced"}
        {miles ? ` · ${miles}` : ""}
      </p>
    </button>
  );
}

function CarouselRow({
  carousel,
  activeEventId,
  onPreview,
  onOpen,
}: {
  carousel: EventCarousel;
  activeEventId: string | null;
  onPreview: (eventId: string | null) => void;
  onOpen: (event: EventListItem) => void;
}) {
  return (
    <section aria-labelledby={`carousel-${carousel.key}`} className="space-y-2">
      <Typography variant="kicker" as="h3" id={`carousel-${carousel.key}`} className="px-0.5 block">
        {carousel.heading}
      </Typography>
      <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {carousel.events.map((event) => (
          <CompactEventCard
            key={`${carousel.key}-${event.id}`}
            event={event}
            active={event.id === activeEventId}
            onPreview={onPreview}
            onOpen={onOpen}
          />
        ))}
      </div>
    </section>
  );
}

function openOfficialRegister(event: EventListItem) {
  const href = registrationHref(event);
  if (!href) return false;
  window.open(href, "_blank", "noopener,noreferrer");
  return true;
}

export function DiscoverPanel(p: DiscoverPanelProps) {
  const {
    catalog, selectedGames, setSelectedGames, formatFilter, setFormatFilter, formatChips, placeQuery, setPlaceQuery, searchPlace,
    locationStatus, useCurrentLocation, authSignedIn, homeAddress, resetToSavedHome,
    filterValue, handleFilterChange, defaultGames, visibleEvents, locationNotice,
    locationResolved, locationLabel, status, location, activeEventId,
    handleMapSelect, setHighlightedEventId, handleClearSelectedEvent,
    emptyState, handleDiscoverSelect, resultsTruncated,
  } = p;

  const visibleChips = useMemo(
    () => homeChipsFor({ selectedGames, formatFilter }),
    [formatFilter, selectedGames],
  );
  const [homeChip, setHomeChip] = useState<HomeChip>(() => defaultHomeChipFor({ selectedGames, formatFilter }));
  const resolvedChip = visibleChips.some((chip) => chip.value === homeChip)
    ? homeChip
    : defaultHomeChipFor({ selectedGames, formatFilter });
  const [mapOpen, setMapOpen] = useState(false);
  const now = useMemo(() => new Date(), [visibleEvents, resolvedChip]);
  const sliced = useMemo(
    () => rankForChip(visibleEvents, resolvedChip, { now, selectedGames, formatFilter }),
    [formatFilter, now, resolvedChip, selectedGames, visibleEvents],
  );
  const carousels = useMemo(
    () => buildCarousels(sliced, { forYou: resolvedChip === "for-you" }),
    [resolvedChip, sliced],
  );
  const slicedMappable = sliced.filter((event) => event.venue?.latitude != null && event.venue.longitude != null);

  const mapToggle = (
    <Button
      type="button"
      variant="outline"
      className="h-9 shrink-0"
      aria-pressed={mapOpen}
      aria-label={mapOpen ? "Hide map" : "Show map"}
      onClick={() => setMapOpen((open) => !open)}
    >
      Map
    </Button>
  );

  const heroForm = (
    <PlaceSearchForm
      placeQuery={placeQuery}
      setPlaceQuery={setPlaceQuery}
      searchPlace={searchPlace}
      locationStatus={locationStatus}
      useCurrentLocation={useCurrentLocation}
      autoFocus={!locationResolved}
    />
  );

  const compactForm = (
    <PlaceSearchForm
      placeQuery={placeQuery}
      setPlaceQuery={setPlaceQuery}
      searchPlace={searchPlace}
      locationStatus={locationStatus}
      useCurrentLocation={useCurrentLocation}
      autoFocus={false}
      compact
      extra={mapToggle}
    />
  );

  if (discoverFirstPaint(locationResolved) === "place-ask") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <section aria-label="Game filters" className="shrink-0 space-y-2 pb-2">
          <GamePills
            catalog={catalog}
            selected={selectedGames}
            onChange={setSelectedGames}
          />
        </section>
        <section aria-labelledby="place-heading" className="flex min-h-0 flex-1 flex-col">
          <h2 id="place-heading" className="sr-only">Choose a place</h2>
          <DotBackground className="flex min-h-[52svh] flex-1 items-center justify-center rounded-none">
            <Empty className="w-full max-w-lg py-10 border-none">
              <EmptyHeader>
                <EmptyMedia variant="icon"><MapPin /></EmptyMedia>
                <EmptyTitle className="text-lg">
                  {locationStatus === "locating" ? "Finding you…" : FIRST_PAINT_PLACE_ASK.title}
                </EmptyTitle>
                <EmptyDescription>
                  {locationStatus === "locating"
                    ? "We’ll drop pins once we have a spot."
                    : FIRST_PAINT_PLACE_ASK.description}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent className="max-w-lg">
                {heroForm}
                <SavedHomeButton
                  authSignedIn={authSignedIn}
                  homeAddress={homeAddress}
                  resetToSavedHome={resetToSavedHome}
                  locationStatus={locationStatus}
                />
                {locationNotice && (
                  <p role="status" className="inline-flex items-center gap-1 text-xs text-destructive">
                    <CircleAlert className="size-3.5 shrink-0" />{locationNotice}
                  </p>
                )}
              </EmptyContent>
            </Empty>
          </DotBackground>
        </section>
      </div>
    );
  }

  return (
    <>
      <section aria-label="Location and event filters" className="shrink-0 space-y-2 pb-2">
        <GamePills
          catalog={catalog}
          selected={selectedGames}
          onChange={setSelectedGames}
        />
        {magicIsOn(selectedGames) && formatChips.length > 1 && (
          <FormatPills
            selected={formatFilter}
            onChange={setFormatFilter}
            chips={formatChips}
          />
        )}
        <HomeChips selected={resolvedChip} onChange={setHomeChip} chips={visibleChips} />
        {compactForm}
        <SavedHomeButton
          authSignedIn={authSignedIn}
          homeAddress={homeAddress}
          resetToSavedHome={resetToSavedHome}
          locationStatus={locationStatus}
        />
        <FilterBar
          className="mt-1"
          value={filterValue}
          onChange={handleFilterChange}
          catalog={catalog}
          defaultGames={defaultGames}
          resultCount={sliced.length}
          showGames={false}
          showDate={false}
        />
        {locationNotice && (
          <p role="status" className="inline-flex items-center gap-1 text-xs text-destructive empty:hidden">
            <CircleAlert className="size-3.5 shrink-0" />{locationNotice}
          </p>
        )}
      </section>

      {discoverResultsPaint({ status, visibleCount: visibleEvents.length }) === "empty" ? (
        <section aria-labelledby="events-heading" className="flex min-h-0 flex-1 flex-col">
          <h2 id="events-heading" className="sr-only">Events</h2>
          <p className="shrink-0 pb-2 text-xs text-muted-foreground">
            {`${visibleEvents.length} ${visibleEvents.length === 1 ? "event" : "events"} near ${locationLabel || "you"}`}
            {status === "preview" ? " · preview data" : ""}
          </p>
          <DotBackground className="flex min-h-[52svh] flex-1 items-center justify-center rounded-none">
            <Empty className="w-full max-w-lg py-10 border-none">
              <EmptyHeader>
                <EmptyMedia variant="icon">{status === "error" ? <RefreshCw /> : <Search />}</EmptyMedia>
                <EmptyTitle className="text-lg">{emptyState.title}</EmptyTitle>
                <EmptyDescription>{emptyState.description}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button className="min-h-11 px-4" variant="outline" onClick={emptyState.onClick}>{emptyState.action}</Button>
              </EmptyContent>
            </Empty>
          </DotBackground>
        </section>
      ) : (
        <section aria-labelledby="events-heading" className="flex min-h-0 flex-1 flex-col gap-4">
          <h2 id="events-heading" className="sr-only">Events</h2>
          <p className="shrink-0 text-xs text-muted-foreground">
            {status === "loading"
              ? "Finding events…"
              : `${sliced.length} ${sliced.length === 1 ? "event" : "events"} near ${locationLabel || "you"}`}
            {status === "preview" ? " · preview data" : ""}
          </p>

          {mapOpen && (
            <div className="relative min-h-[36svh] min-w-0 overflow-hidden rounded-xl border">
              {status === "loading" ? (
                <div className="grid h-full min-h-[36svh] place-items-center bg-muted/20 text-sm text-muted-foreground">Preparing the map…</div>
              ) : slicedMappable.length === 0 ? (
                <div className="grid h-full min-h-[36svh] place-items-center bg-muted/20 p-8 text-center text-sm text-muted-foreground">No mapped venues match these filters.</div>
              ) : (
                <Suspense fallback={<div className="grid h-full min-h-[36svh] place-items-center bg-muted/20 text-sm text-muted-foreground">Loading the map…</div>}>
                  <EventMap
                    center={location}
                    events={slicedMappable}
                    active
                    activeEventId={activeEventId}
                    selectedEventId={p.selectedEventId}
                    onSelect={handleMapSelect}
                    onPreview={setHighlightedEventId}
                    onDeselect={handleClearSelectedEvent}
                    catalog={catalog}
                  />
                </Suspense>
              )}
            </div>
          )}

          {status === "loading" || locationStatus === "locating" ? (
            <LoadingCards />
          ) : carousels.length === 0 ? (
            <p className="py-8 text-sm text-muted-foreground">Nothing in this window. Try All or For you.</p>
          ) : (
            <div className="flex min-h-0 flex-col gap-6">
              {carousels.map((carousel) => (
                <CarouselRow
                  key={carousel.key}
                  carousel={carousel}
                  activeEventId={activeEventId}
                  onPreview={setHighlightedEventId}
                  onOpen={(event) => { if (!openOfficialRegister(event)) handleDiscoverSelect(event.id); }}
                />
              ))}
            </div>
          )}
          {resultsTruncated && (
            <p className="text-xs text-muted-foreground">
              This area has more events than we can show at once. Narrow the distance or
              pick fewer games to see the rest.
            </p>
          )}
          <p className="pb-5 text-xs text-muted-foreground">
            Verify details with the organizer.
          </p>
        </section>
      )}
    </>
  );
}
