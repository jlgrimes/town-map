import { Geolocation } from "@capacitor/geolocation";
import { SignInButton, UserButton } from "@clerk/react";
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
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { GAME_LABELS, type EventListItem, type Game, type HomeLocation } from "@town-map/contracts";
import {
  ChevronDown,
  CircleAlert,
  House,
  List,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { fetchEvents, fetchUserPreferences, geocodePlace, saveUserPreferences } from "./api";
import { demoEvents } from "./demo-events";
import { GameIcon } from "./GameIcon";

const EventMap = lazy(() => import("./EventMap").then((module) => ({ default: module.EventMap })));

const ALL_GAMES: Game[] = ["pokemon", "magic", "yugioh"];
const PAGE_SIZE = 24;

type DateFilter = "all" | "today" | "tomorrow" | "week";
type ViewMode = "list" | "map";

const DATE_OPTIONS: Array<{ value: DateFilter; label: string }> = [
  { value: "all", label: "All upcoming" },
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "week", label: "Next 7 days" },
];

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

const initialParams = new URLSearchParams(window.location.search);
const initialHasLocationOverride = initialParams.has("lat") && initialParams.has("lng");

export type AppAuth = {
  enabled: boolean;
  loaded: boolean;
  signedIn: boolean;
  getToken: () => Promise<string | null>;
};

const guestAuth: AppAuth = {
  enabled: false,
  loaded: true,
  signedIn: false,
  getToken: async () => null,
};

function initialGames() {
  const rawGames = initialParams.get("games");
  if (rawGames === null) return ALL_GAMES;
  return rawGames.split(",").filter((game): game is Game => ALL_GAMES.includes(game as Game));
}

function initialDateFilter(): DateFilter {
  const value = initialParams.get("date");
  return DATE_OPTIONS.some((option) => option.value === value) ? value as DateFilter : "all";
}

function initialNumber(name: string, fallback: number) {
  const rawValue = initialParams.get(name);
  if (rawValue === null || rawValue.trim() === "") return fallback;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : fallback;
}

function dateLabel(dateString: string) {
  const date = new Date(dateString);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(date);
}

function timeLabel(dateString: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(dateString));
}

function humanizeMeta(value: string | null) {
  if (!value) return null;
  if (META_LABELS[value]) return META_LABELS[value];
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function eventMetadata(event: EventListItem) {
  const values = [humanizeMeta(event.format), humanizeMeta(event.eventType)].filter(Boolean) as string[];
  return values.filter((value, index) => values.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index);
}

function sortEvents(events: EventListItem[]) {
  return [...events].sort((a, b) => {
    const dateDifference = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
    const distanceDifference = (a.distanceMiles ?? Number.POSITIVE_INFINITY) - (b.distanceMiles ?? Number.POSITIVE_INFINITY);
    return dateDifference || distanceDifference || a.title.localeCompare(b.title);
  });
}

function eventDateKey(dateString: string) {
  const date = new Date(dateString);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function groupEventsByDate(events: EventListItem[]) {
  const groups: Array<{ key: string; label: string; events: EventListItem[] }> = [];
  for (const event of events) {
    const key = eventDateKey(event.startsAt);
    const current = groups.at(-1);
    if (current?.key === key) current.events.push(event);
    else groups.push({ key, label: dateLabel(event.startsAt), events: [event] });
  }
  return groups;
}

function matchesDate(event: EventListItem, filter: DateFilter) {
  if (filter === "all") return true;
  const eventDate = new Date(event.startsAt);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const tomorrow = new Date(start);
  tomorrow.setDate(start.getDate() + 1);
  const dayAfterTomorrow = new Date(start);
  dayAfterTomorrow.setDate(start.getDate() + 2);
  const nextWeek = new Date(start);
  nextWeek.setDate(start.getDate() + 7);
  if (filter === "today") return eventDate >= start && eventDate < tomorrow;
  if (filter === "tomorrow") return eventDate >= tomorrow && eventDate < dayAfterTomorrow;
  return eventDate >= start && eventDate < nextWeek;
}

function formatPrice(event: EventListItem) {
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

function GameFilters({ value, onChange }: { value: Game[]; onChange: (games: Game[]) => void }) {
  function toggleGame(game: Game) {
    onChange(value.includes(game) ? value.filter((item) => item !== game) : [...value, game]);
  }

  return (
    <fieldset className="flex items-center gap-1" aria-label="Games">
      <legend className="sr-only">Games</legend>
      {ALL_GAMES.map((game) => {
        const selected = value.includes(game);
        return (
          <Button
            key={game}
            type="button"
            variant={selected ? "secondary" : "ghost"}
            size="icon"
            className={`size-11 ${selected ? "ring-1 ring-primary/40" : "opacity-45"}`}
            aria-label={`${selected ? "Exclude" : "Include"} ${GAME_LABELS[game]} events`}
            aria-pressed={selected}
            title={GAME_LABELS[game]}
            onClick={() => toggleGame(game)}
          >
            <GameIcon game={game} className="size-6 object-contain" decorative />
          </Button>
        );
      })}
    </fieldset>
  );
}

function DateFilters({ value, onChange }: { value: DateFilter; onChange: (value: DateFilter) => void }) {
  return (
    <fieldset className="flex min-w-max items-center gap-1" aria-label="Date">
      <legend className="sr-only">Date</legend>
      {DATE_OPTIONS.map((option) => (
        <Button
          key={option.value}
          type="button"
          variant={value === option.value ? "secondary" : "ghost"}
          className={`min-h-11 px-3 ${value === option.value ? "ring-1 ring-primary/40" : ""}`}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.value === "all" ? "Any date" : option.value === "week" ? "This week" : option.label}
        </Button>
      ))}
    </fieldset>
  );
}

function EventRow({
  event,
  active,
  onPreview,
  onSelect,
}: {
  event: EventListItem;
  active: boolean;
  onPreview: (eventId: string | null) => void;
  onSelect: (eventId: string) => void;
}) {
  const location = [event.venue?.name, event.venue?.city, event.venue?.region].filter(Boolean).join(" · ");
  const details = [
    ...eventMetadata(event),
    formatPrice(event),
    event.capacity !== null ? `Capacity ${event.capacity}` : null,
  ].filter((detail): detail is string => detail !== null);
  const mapsQuery = [
    event.venue?.name,
    event.venue?.address,
    event.venue?.city,
    event.venue?.region,
    event.venue?.postalCode,
  ].filter(Boolean).join(", ");

  return (
    <li
      id={`event-${event.id}`}
      className={`scroll-mt-4 px-1 py-4 transition-colors sm:px-2 ${active ? "bg-muted/70" : "hover:bg-muted/30"}`}
      onMouseEnter={() => onPreview(event.id)}
      onMouseLeave={() => onPreview(null)}
      onFocusCapture={() => onPreview(event.id)}
      onBlurCapture={(focusEvent) => {
        if (!focusEvent.currentTarget.contains(focusEvent.relatedTarget)) onPreview(null);
      }}
      onClick={() => onSelect(event.id)}
    >
      <article className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-x-3">
        <time dateTime={event.startsAt} className="pt-0.5 text-sm font-medium tabular-nums text-muted-foreground">
          {timeLabel(event.startsAt)}
        </time>

        <div className="min-w-0">
          <div className="flex items-start gap-2">
            <GameIcon game={event.game} className="size-5 shrink-0 object-contain" />
            <h3 className="min-w-0 text-base leading-snug font-semibold tracking-tight">
              {event.sourceUrl ? (
                <a
                  href={event.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
                  aria-label={`View details for ${event.title}`}
                >
                  {event.title}
                </a>
              ) : event.title}
            </h3>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {mapsQuery ? (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-sm text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
                aria-label={`Open ${location || "event location"} in Google Maps`}
              >
                {location || "View location"}
              </a>
            ) : (
              <span className="text-foreground">Venue to be announced</span>
            )}
            {event.distanceMiles !== null ? ` · ${event.distanceMiles} mi away` : " · Distance unavailable"}
          </p>
          {details.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">{details.join(" · ")}</p>
          )}
        </div>
      </article>
    </li>
  );
}

function LoadingCards() {
  return (
    <div role="status" aria-label="Finding nearby events" className="divide-y border-y">
      <span className="sr-only">Finding nearby events…</span>
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} aria-hidden="true" className="h-36 animate-pulse bg-muted/35" />
      ))}
    </div>
  );
}

export function App({ auth = guestAuth }: { auth?: AppAuth }) {
  const [selectedGames, setSelectedGames] = useState<Game[]>(initialGames);
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [query, setQuery] = useState(initialParams.get("q") ?? "");
  const [dateFilter, setDateFilter] = useState<DateFilter>(initialDateFilter);
  const [viewMode, setViewMode] = useState<ViewMode>(initialParams.get("view") === "map" ? "map" : "list");
  const [location, setLocation] = useState({
    latitude: initialNumber("lat", 41.8781),
    longitude: initialNumber("lng", -87.6298),
  });
  const [locationLabel, setLocationLabel] = useState(initialParams.get("place") ?? "Chicago, IL");
  const [homeAddress, setHomeAddress] = useState<string | null>(null);
  const [homeLocation, setHomeLocation] = useState<HomeLocation | null>(null);
  const [homeEditorOpen, setHomeEditorOpen] = useState(false);
  const [homeDraft, setHomeDraft] = useState("");
  const [homeNotice, setHomeNotice] = useState<string | null>(null);
  const [preferenceStatus, setPreferenceStatus] = useState<"idle" | "loading" | "ready" | "saving" | "error">("idle");
  const [placeQuery, setPlaceQuery] = useState(initialParams.get("place") ?? "Chicago, IL");
  const [radiusMiles, setRadiusMiles] = useState(initialNumber("radius", 25));
  const [status, setStatus] = useState<"loading" | "live" | "preview" | "error">("loading");
  const [locationStatus, setLocationStatus] = useState<"idle" | "searching" | "locating">("idle");
  const [locationNotice, setLocationNotice] = useState<string | null>(null);
  const [locationEditorOpen, setLocationEditorOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.enabled || !auth.loaded) return;
    if (!auth.signedIn) {
      setHomeAddress(null);
      setHomeLocation(null);
      setPreferenceStatus("idle");
      return;
    }
    const controller = new AbortController();
    setPreferenceStatus("loading");
    fetchUserPreferences(auth.getToken, controller.signal)
      .then(async (preferences) => {
        setHomeAddress(preferences.homeAddress);
        setHomeLocation(null);
        setHomeDraft(preferences.homeAddress ?? "");
        if (preferences.homeAddress && !initialHasLocationOverride) setPlaceQuery(preferences.homeAddress);
        setPreferenceStatus("ready");
        if (preferences.homeAddress && !initialHasLocationOverride) {
          try {
            const result = await geocodePlace(preferences.homeAddress, controller.signal);
            if (!result || controller.signal.aborted) return;
            setHomeLocation(result);
            setLocation({ latitude: result.latitude, longitude: result.longitude });
            setLocationLabel(result.label);
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") return;
            setLocationNotice("Your home is saved, but we couldn't locate it right now.");
          }
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPreferenceStatus("error");
      });
    return () => controller.abort();
  }, [auth.enabled, auth.getToken, auth.loaded, auth.signedIn]);

  useEffect(() => {
    if (selectedGames.length === 0) {
      setEvents([]);
      setStatus("live");
      return;
    }

    const controller = new AbortController();
    setStatus("loading");
    fetchEvents({ games: selectedGames, ...location, radiusMiles, signal: controller.signal })
      .then(({ events: nextEvents }) => {
        setEvents(nextEvents);
        setStatus("live");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === "true") {
          setEvents(demoEvents);
          setStatus("preview");
        } else {
          setEvents([]);
          setStatus("error");
        }
      });
    return () => controller.abort();
  }, [selectedGames, location, radiusMiles, reloadKey]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedGames.length !== ALL_GAMES.length) params.set("games", selectedGames.join(","));
    if (query) params.set("q", query);
    if (dateFilter !== "all") params.set("date", dateFilter);
    if (viewMode !== "list") params.set("view", viewMode);
    params.set("lat", location.latitude.toFixed(5));
    params.set("lng", location.longitude.toFixed(5));
    params.set("radius", String(radiusMiles));
    params.set("place", locationLabel);
    const nextUrl = `${window.location.pathname}?${params}${window.location.hash}`;
    window.history.replaceState(null, "", nextUrl);
  }, [dateFilter, location, locationLabel, query, radiusMiles, selectedGames, viewMode]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setSelectedEventId(null);
    setHighlightedEventId(null);
  }, [dateFilter, query, radiusMiles, selectedGames]);

  const visibleEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = events.filter((event) => {
      if (!selectedGames.includes(event.game) || !matchesDate(event, dateFilter)) return false;
      const text = [
        event.title,
        GAME_LABELS[event.game],
        event.venue?.name,
        event.venue?.address,
        event.venue?.city,
        event.venue?.region,
        event.format,
        event.eventType,
      ].filter(Boolean).join(" ").toLowerCase();
      return text.includes(normalizedQuery);
    });
    return sortEvents(filtered);
  }, [dateFilter, events, query, selectedGames]);

  const pagedEvents = visibleEvents.slice(0, visibleCount);
  const eventGroups = groupEventsByDate(pagedEvents);
  const mappableEvents = visibleEvents.filter((event) => event.venue?.latitude != null && event.venue.longitude != null);
  const activeEventId = highlightedEventId ?? selectedEventId;

  async function searchPlace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = placeQuery.trim();
    if (!normalized) return;
    setLocationStatus("searching");
    setLocationNotice(null);
    try {
      const result = await geocodePlace(normalized);
      if (!result) {
        setLocationNotice("We could not find that place. Try a city with its state or a ZIP code.");
        return;
      }
      setLocation({ latitude: result.latitude, longitude: result.longitude });
      setLocationLabel(result.label);
      setPlaceQuery(normalized);
      setLocationEditorOpen(false);
    } catch {
      setLocationNotice("Place search is temporarily unavailable. You can still use your current location.");
    } finally {
      setLocationStatus("idle");
    }
  }

  async function useCurrentLocation() {
    setLocationStatus("locating");
    setLocationNotice(null);
    try {
      const permission = await Geolocation.requestPermissions();
      if (permission.location === "denied") {
        setLocationNotice("Location access was denied. Enter a city or ZIP code instead.");
        return;
      }
      const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 12_000 });
      setLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      setLocationLabel("Current location");
      setPlaceQuery("Current location");
      setLocationEditorOpen(false);
    } catch {
      setLocationNotice("We could not access your location. Enter a city or ZIP code instead.");
    } finally {
      setLocationStatus("idle");
    }
  }

  const isHomeLocation = homeLocation !== null
    && Math.abs(location.latitude - homeLocation.latitude) < 0.00001
    && Math.abs(location.longitude - homeLocation.longitude) < 0.00001;

  async function saveHomeAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = homeDraft.trim();
    if (!normalized || !auth.signedIn) return;
    setPreferenceStatus("saving");
    setHomeNotice(null);
    try {
      const preferences = await saveUserPreferences(normalized, auth.getToken);
      setHomeAddress(preferences.homeAddress);
      setHomeLocation(null);
      setHomeDraft(preferences.homeAddress ?? normalized);
      setPreferenceStatus("ready");
      setHomeEditorOpen(false);
    } catch {
      setPreferenceStatus("error");
      setHomeNotice("We couldn't save your home right now. Please try again.");
      return;
    }

    try {
      const result = await geocodePlace(normalized);
      if (!result) {
        setLocationNotice("Home saved. We couldn't locate it yet; try a city with its state or a ZIP code.");
        return;
      }
      setHomeLocation(result);
      setLocation({ latitude: result.latitude, longitude: result.longitude });
      setLocationLabel(result.label);
      setPlaceQuery(normalized);
      setLocationNotice(null);
    } catch {
      setLocationNotice("Home saved. We couldn't locate it right now, but it remains your default.");
    }
  }

  async function useHomeLocation() {
    if (!homeAddress) return;
    let result = homeLocation;
    if (!result) {
      setLocationStatus("searching");
      setLocationNotice(null);
      try {
        result = await geocodePlace(homeAddress);
        if (!result) {
          setLocationNotice("We couldn't locate your saved home. Try updating it with a city and state.");
          return;
        }
        setHomeLocation(result);
      } catch {
        setLocationNotice("Place search is temporarily unavailable. Your home is still saved.");
        return;
      } finally {
        setLocationStatus("idle");
      }
    }
    setLocation({ latitude: result.latitude, longitude: result.longitude });
    setLocationLabel(result.label);
    setPlaceQuery(homeAddress);
    setLocationNotice(null);
    setLocationEditorOpen(false);
  }

  const handleMapSelect = useCallback((eventId: string) => {
    setSelectedEventId(eventId);
    setHighlightedEventId(null);
    if (window.innerWidth < 1024) setViewMode("list");
    window.requestAnimationFrame(() => document.getElementById(`event-${eventId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, []);

  const handleListSelect = useCallback((eventId: string) => {
    setSelectedEventId(eventId);
  }, []);

  const handleClearSelectedEvent = useCallback(() => {
    setSelectedEventId(null);
  }, []);

  const emptyState = selectedGames.length === 0 ? {
    title: "Choose at least one game",
    description: "Select the games you want to include in the event list.",
    action: "Select all games",
    onClick: () => setSelectedGames(ALL_GAMES),
  } : status === "error" ? {
    title: "Events could not be loaded",
    description: "The event service may be temporarily unavailable. Your filters are still saved in this URL.",
    action: "Try again",
    onClick: () => setReloadKey((value) => value + 1),
  } : {
    title: "No matching events",
    description: `Try a wider distance, another date, or fewer search terms near ${locationLabel}.`,
    action: "Clear filters",
    onClick: () => { setQuery(""); setDateFilter("all"); setSelectedGames(ALL_GAMES); },
  };

  return (
    <div className="min-h-svh bg-background text-foreground">
      <a href="#main-content" className="sr-only z-[1000] bg-background px-4 py-3 font-semibold focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to events
      </a>

      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-[90rem] items-center px-4 sm:px-6 lg:px-8">
          <a href="/" className="inline-flex items-center gap-2 text-sm font-semibold" aria-label="Town Map home">
            <img src="/town-map.png" alt="" className="size-8 object-contain" />
            <span>Town Map</span>
          </a>
          {auth.enabled && auth.loaded && (
            <div className="ml-auto flex items-center gap-1">
              {auth.signedIn ? (
                <>
                  <Popover open={homeEditorOpen} onOpenChange={(open) => {
                    setHomeEditorOpen(open);
                    setHomeNotice(null);
                    if (open) setHomeDraft(homeAddress ?? "");
                  }}>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" className="min-h-10 px-3">
                        <House /> Home
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-4">
                      <PopoverHeader>
                        <PopoverTitle>Home address</PopoverTitle>
                        <PopoverDescription>Saved as text and looked up when it is used for event search.</PopoverDescription>
                      </PopoverHeader>
                      <form onSubmit={saveHomeAddress} className="space-y-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="home-address">Address, city, or ZIP code</Label>
                          <Input
                            id="home-address"
                            value={homeDraft}
                            onChange={(event) => setHomeDraft(event.target.value)}
                            placeholder="123 Main St, Chicago, IL"
                            autoComplete="street-address"
                            className="h-10"
                          />
                        </div>
                        {homeNotice && <p role="status" className="text-xs text-destructive">{homeNotice}</p>}
                        <div className="flex items-center justify-between gap-3">
                          {homeAddress ? <p className="min-w-0 truncate text-xs text-muted-foreground">Saved: {homeAddress}</p> : <span />}
                          <Button type="submit" disabled={!homeDraft.trim() || preferenceStatus === "saving"}>
                            {preferenceStatus === "saving" ? "Saving…" : homeAddress ? "Update home" : "Save home"}
                          </Button>
                        </div>
                      </form>
                    </PopoverContent>
                  </Popover>
                  <UserButton />
                </>
              ) : (
                <SignInButton mode="modal">
                  <Button variant="ghost" className="min-h-10 px-3">Sign in</Button>
                </SignInButton>
              )}
            </div>
          )}
        </div>
      </header>

      <main id="main-content" className="mx-auto max-w-[90rem] px-4 py-4 sm:px-6 lg:px-8">
        <h1 className="sr-only">Town Map events</h1>

        <section aria-label="Location and event filters" className="border-b pb-4">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="relative">
              <Label className="sr-only" htmlFor="event-search">Search events or venues</Label>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="event-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search events or venues"
                className="h-11 pr-11 pl-10"
              />
              {query && <Button type="button" variant="ghost" size="icon" className="absolute top-1/2 right-1.5 size-9 -translate-y-1/2" aria-label="Clear search" onClick={() => setQuery("")}><X /></Button>}
            </div>

            <Popover open={locationEditorOpen} onOpenChange={setLocationEditorOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="h-11 w-full justify-between gap-2 px-3 font-normal sm:w-auto sm:max-w-72">
                  <span className="flex min-w-0 items-center gap-2">
                    {isHomeLocation ? <House className="shrink-0" /> : <MapPin className="shrink-0" />}
                    <span className="truncate">{locationLabel}</span>
                  </span>
                  <ChevronDown className="shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-4">
                <PopoverHeader>
                  <PopoverTitle>Search location</PopoverTitle>
                  <PopoverDescription>Choose where to look for nearby events.</PopoverDescription>
                </PopoverHeader>
                <form onSubmit={searchPlace} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="place-search">City, state, or ZIP code</Label>
                    <Input
                      id="place-search"
                      value={placeQuery}
                      onChange={(event) => setPlaceQuery(event.target.value)}
                      placeholder="Chicago, IL"
                      autoComplete="postal-code"
                      className="h-11"
                      autoFocus
                    />
                  </div>
                  {locationNotice && (
                    <p role="status" className="flex items-start gap-1 text-xs text-destructive">
                      <CircleAlert className="mt-0.5 size-3.5 shrink-0" />{locationNotice}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button type="submit" className="min-h-11 flex-1" disabled={!placeQuery.trim() || locationStatus === "searching"}>
                      {locationStatus === "searching" ? "Searching…" : "Search"}
                    </Button>
                    <Button type="button" variant="outline" size="icon" className="size-11" onClick={useCurrentLocation} disabled={locationStatus === "locating"} aria-label="Use my current location">
                      <LocateFixed />
                    </Button>
                  </div>
                  {homeAddress && !isHomeLocation && (
                    <Button type="button" variant="ghost" className="min-h-11 w-full justify-start px-3" onClick={useHomeLocation}>
                      <House /> Use saved home
                    </Button>
                  )}
                </form>
              </PopoverContent>
            </Popover>
          </div>

          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-full overflow-x-auto pb-1 sm:pb-0">
              <DateFilters value={dateFilter} onChange={setDateFilter} />
            </div>
            <div className="flex items-center justify-between gap-2 sm:justify-end">
              <GameFilters value={selectedGames} onChange={setSelectedGames} />
              <div>
                <Label htmlFor="radius" className="sr-only">Search radius</Label>
                <select
                  id="radius"
                  className="h-11 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  value={radiusMiles}
                  onChange={(event) => setRadiusMiles(Number(event.target.value))}
                >
                  {[10, 25, 50, 100].map((radius) => <option key={radius} value={radius}>{radius} mi</option>)}
                </select>
              </div>
            </div>
          </div>

          {locationNotice && (
            <p role="status" className="mt-2 inline-flex items-center gap-1 text-xs text-destructive empty:hidden">
              <CircleAlert className="size-3.5 shrink-0" />{locationNotice}
            </p>
          )}
        </section>

        <section aria-labelledby="events-heading">
          <h2 id="events-heading" className="sr-only">Events</h2>
          <div className="flex min-h-14 items-center justify-between gap-3 border-b py-2 text-sm">
            <p className="text-muted-foreground">
              {status === "loading" ? "Finding events…" : `${visibleEvents.length} ${visibleEvents.length === 1 ? "event" : "events"} near ${locationLabel}`}
              {status === "preview" ? " · preview data" : ""}
            </p>
            <div className="flex lg:hidden" aria-label="Choose results view">
              <Button variant="ghost" className="min-h-10 px-3" onClick={() => setViewMode("list")} aria-pressed={viewMode === "list"}><List /> List</Button>
              <Button variant="ghost" className="min-h-10 px-3" onClick={() => setViewMode("map")} aria-pressed={viewMode === "map"}><MapIcon /> Map</Button>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,0.88fr)_minmax(25rem,1.12fr)] lg:items-start">
            <div className={`${viewMode === "map" ? "hidden" : "block"} min-w-0 lg:block`}>
              {status === "loading" ? (
                <LoadingCards />
              ) : visibleEvents.length === 0 ? (
                <Empty className="border-b py-16">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">{status === "error" ? <RefreshCw /> : <Search />}</EmptyMedia>
                    <EmptyTitle>{emptyState.title}</EmptyTitle>
                    <EmptyDescription>{emptyState.description}</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent><Button className="min-h-11 px-4" variant="outline" onClick={emptyState.onClick}>{emptyState.action}</Button></EmptyContent>
                </Empty>
              ) : (
                <>
                  <div className="border-b" aria-label="Event results">
                    {eventGroups.map((group) => (
                      <section key={group.key} aria-labelledby={`date-${group.key}`}>
                        <h3 id={`date-${group.key}`} className="border-b bg-muted/35 px-2 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                          {group.label}
                        </h3>
                        <ol className="divide-y">
                          {group.events.map((event) => (
                            <EventRow
                              key={event.id}
                              event={event}
                              active={event.id === activeEventId}
                              onPreview={setHighlightedEventId}
                              onSelect={handleListSelect}
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
                </>
              )}
            </div>

            <div className={`${viewMode === "list" ? "hidden" : "block"} pt-5 lg:sticky lg:top-4 lg:block lg:h-[calc(100svh-2rem)] lg:pt-0`}>
              {status === "loading" ? (
                <div className="grid h-[28rem] place-items-center border bg-muted/20 text-sm text-muted-foreground">Preparing the map…</div>
              ) : mappableEvents.length === 0 ? (
                <div className="grid h-[28rem] place-items-center border bg-muted/20 p-8 text-center text-sm text-muted-foreground">No mapped venues match these filters.</div>
              ) : (
                <Suspense fallback={<div className="grid h-[28rem] place-items-center border bg-muted/20 text-sm text-muted-foreground">Loading the map…</div>}>
                  <EventMap
                    center={location}
                    events={mappableEvents}
                    active={viewMode === "map" || window.innerWidth >= 1024}
                    activeEventId={activeEventId}
                    selectedEventId={selectedEventId}
                    onSelect={handleMapSelect}
                    onPreview={setHighlightedEventId}
                    onDeselect={handleClearSelectedEvent}
                  />
                </Suspense>
              )}
            </div>
          </div>
        </section>

        <p className="py-5 text-xs text-muted-foreground">
          Verify details with the organizer. Map and place search © OpenStreetMap contributors.
        </p>
      </main>
    </div>
  );
}
