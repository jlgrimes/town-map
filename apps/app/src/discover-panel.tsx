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
import { EventRow } from "@/components/ui/event-row";
import { FilterBar, type FilterBarValue } from "@/components/filters/filter-bar";
import { GamePills } from "@/components/filters/game-pills";
import { CircleAlert, Home, LocateFixed, MapPin, RefreshCw, Search, X } from "lucide-react";
import { lazy, Suspense, type FormEvent } from "react";
import type { EventListItem, Game } from "@town-map/contracts";
import type { GameCatalog } from "./games";
import { LoadingCards } from "./account-chrome";
import { PAGE_SIZE } from "./town-map-model";

const EventMap = lazy(() => import("./EventMap").then((module) => ({ default: module.EventMap })));

export type DiscoverPanelProps = {
  catalog: GameCatalog;
  selectedGames: Game[];
  setSelectedGames: (games: Game[] | null) => void;
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

export function DiscoverPanel(p: DiscoverPanelProps) {
  const {
    catalog, selectedGames, setSelectedGames, placeQuery, setPlaceQuery, searchPlace,
    locationStatus, useCurrentLocation, authSignedIn, homeAddress, resetToSavedHome,
    filterValue, handleFilterChange, defaultGames, visibleEvents, locationNotice,
    locationResolved, locationLabel, status, location, mappableEvents, activeEventId,
    selectedEventId, handleMapSelect, setHighlightedEventId, handleClearSelectedEvent,
    emptyState, eventGroups, savedIds, canSave, handleDiscoverSelect, toggleSaved,
    visibleCount, setVisibleCount, resultsTruncated,
  } = p;

  return (
    <>
                  <section aria-label="Location and event filters" className="shrink-0 space-y-2 pb-2">
                    <GamePills
                      catalog={catalog}
                      selected={selectedGames}
                      onChange={setSelectedGames}
                    />
                    <SpotlightSearch className="w-full">
                      <form onSubmit={searchPlace} className="flex flex-wrap items-center gap-2">
                        <div className="relative min-w-0 flex-1">
                          <Label className="sr-only" htmlFor="place-search">City, state, or ZIP code</Label>
                          <MapPin className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground z-20" />
                          <Input
                            id="place-search"
                            value={placeQuery}
                            onChange={(event) => setPlaceQuery(event.target.value)}
                            placeholder="City, ZIP, or address"
                            autoFocus={!locationResolved}
                            autoComplete="postal-code"
                            className="h-11 pr-11 pl-10"
                          />
                          {placeQuery && <Button type="button" variant="ghost" size="icon" className="absolute top-1/2 right-1.5 size-9 -translate-y-1/2 z-20" aria-label="Clear location" onClick={() => setPlaceQuery("")}><X /></Button>}
                        </div>
                        <Button type="submit" className="h-11 shrink-0" disabled={!placeQuery.trim() || locationStatus === "searching"}>
                          {locationStatus === "searching" ? "Searching…" : "Search"}
                        </Button>
                        <Button type="button" variant="outline" size="icon" className="size-11 shrink-0" onClick={useCurrentLocation} disabled={locationStatus === "locating"} aria-label="Use my current location" title="Use my current location">
                          <LocateFixed />
                        </Button>
                      </form>
                    </SpotlightSearch>

                    {authSignedIn && homeAddress && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-1 text-xs text-muted-foreground hover:text-foreground"
                        onClick={resetToSavedHome}
                        disabled={locationStatus === "searching"}
                      >
                        <Home className="mr-1.5 size-3.5" />
                        Use saved home ({homeAddress})
                      </Button>
                    )}

                    <FilterBar
                      className="mt-1"
                      value={filterValue}
                      onChange={handleFilterChange}
                      catalog={catalog}
                      defaultGames={defaultGames}
                      resultCount={visibleEvents.length}
                      showGames={false}
                    />

                    {locationNotice && (
                      <p role="status" className="inline-flex items-center gap-1 text-xs text-destructive empty:hidden">
                        <CircleAlert className="size-3.5 shrink-0" />{locationNotice}
                      </p>
                    )}
                  </section>

                  <section aria-labelledby="events-heading" className="flex min-h-0 flex-1 flex-col">
                    <h2 id="events-heading" className="sr-only">Events</h2>
                    <p className="shrink-0 pb-2 text-xs text-muted-foreground">
                      {!locationResolved
                        ? (locationStatus === "locating" ? "Finding you…" : "Pick a place to see tonight’s events")
                        : status === "loading"
                          ? "Finding events…"
                          : `${visibleEvents.length} ${visibleEvents.length === 1 ? "event" : "events"} near ${locationLabel || "you"}`}
                      {status === "preview" ? " · preview data" : ""}
                    </p>

                    <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(20rem,24rem)_minmax(0,1fr)]">
                      <div className="relative min-h-[46svh] min-w-0 overflow-hidden lg:order-2 lg:min-h-0">
                        {!locationResolved ? (
                          <div className="grid h-full min-h-[46svh] place-items-center border bg-muted/20 p-8 text-center text-sm text-muted-foreground lg:min-h-0">
                            {locationStatus === "locating" ? "Finding your location…" : "Search a city to drop pins."}
                          </div>
                        ) : status === "loading" ? (
                          <div className="grid h-full min-h-[46svh] place-items-center border bg-muted/20 text-sm text-muted-foreground lg:min-h-0">Preparing the map…</div>
                        ) : mappableEvents.length === 0 ? (
                          <div className="grid h-full min-h-[46svh] place-items-center border bg-muted/20 p-8 text-center text-sm text-muted-foreground lg:min-h-0">No mapped venues match these filters.</div>
                        ) : (
                          <Suspense fallback={<div className="grid h-full min-h-[46svh] place-items-center border bg-muted/20 text-sm text-muted-foreground lg:min-h-0">Loading the map…</div>}>
                            <EventMap
                              center={location}
                              events={mappableEvents}
                              active
                              activeEventId={activeEventId}
                              selectedEventId={selectedEventId}
                              onSelect={handleMapSelect}
                              onPreview={setHighlightedEventId}
                              onDeselect={handleClearSelectedEvent}
                              catalog={catalog}
                            />
                          </Suspense>
                        )}
                      </div>

                      <div className="min-h-0 min-w-0 max-h-[42svh] overflow-y-auto overscroll-contain border-t lg:order-1 lg:max-h-none lg:border-t-0 lg:border-r">
                        {!locationResolved && locationStatus !== "locating" ? (
                            <DotBackground className="rounded-none">
                              <Empty className="py-10 border-none">
                                <EmptyHeader>
                                  <EmptyMedia variant="icon"><MapPin /></EmptyMedia>
                                  <EmptyTitle>{emptyState.title}</EmptyTitle>
                                  <EmptyDescription>{emptyState.description}</EmptyDescription>
                                </EmptyHeader>
                                <EmptyContent><Button className="min-h-11 px-4" variant="outline" onClick={emptyState.onClick}>{emptyState.action}</Button></EmptyContent>
                              </Empty>
                            </DotBackground>
                        ) : status === "loading" || locationStatus === "locating" ? (
                          <LoadingCards />
                        ) : visibleEvents.length === 0 ? (
                          <DotBackground className="rounded-none">
                            <Empty className="py-10 border-none">
                              <EmptyHeader>
                                <EmptyMedia variant="icon">{status === "error" ? <RefreshCw /> : <Search />}</EmptyMedia>
                                <EmptyTitle>{emptyState.title}</EmptyTitle>
                                <EmptyDescription>{emptyState.description}</EmptyDescription>
                              </EmptyHeader>
                              <EmptyContent><Button className="min-h-11 px-4" variant="outline" onClick={emptyState.onClick}>{emptyState.action}</Button></EmptyContent>
                            </Empty>
                          </DotBackground>
                        ) : (
                          <>
                            <div className="border-b" aria-label="Event results">
                              {eventGroups.map((group) => (
                                <section key={group.key} aria-labelledby={`date-${group.key}`}>
                                  <Typography
                                    variant="kicker"
                                    as="h3"
                                    id={`date-${group.key}`}
                                    className="border-b bg-muted/35 px-3 py-2 block"
                                  >
                                    {group.label}
                                  </Typography>
                                  <ol className="divide-y">
                                    {group.events.map((event) => (
                                      <EventRow
                                        key={event.id}
                                        event={event}
                                        active={event.id === activeEventId}
                                        saved={savedIds.has(event.id)}
                                        canSave={canSave}
                                        layoutIdPrefix="discover"
                                        onPreview={setHighlightedEventId}
                                        onSelect={handleDiscoverSelect}
                                        onToggleSave={toggleSaved}
                                      />
                                    ))}
                                  </ol>
                                </section>
                              ))}
                            </div>
                            {visibleCount < visibleEvents.length && (
                              <div className="py-5 text-center">
                                <Button variant="outline" className="min-h-11 px-5" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
                                  Load {Math.min(PAGE_SIZE, visibleEvents.length - visibleCount)} more
                                </Button>
                              </div>
                            )}
                            {resultsTruncated && visibleCount >= visibleEvents.length && (
                              <p className="px-2 pb-1 text-xs text-muted-foreground">
                                This area has more events than we can show at once. Narrow the distance or
                                pick fewer games to see the rest.
                              </p>
                            )}
                          </>
                        )}
                        <p className="px-2 py-5 text-xs text-muted-foreground">
                          Verify details with the organizer.
                        </p>
                      </div>
                    </div>
                  </section>

    </>
  );
}
