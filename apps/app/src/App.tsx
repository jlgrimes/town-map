import { Geolocation } from "@capacitor/geolocation";
import { Badge } from "@/components/ui/badge";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GAME_LABELS, type EventListItem, type Game } from "@town-map/contracts";
import {
  CalendarDays,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  List,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  Navigation,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { fetchEvents, geocodePlace } from "./api";
import { demoEvents } from "./demo-events";

const EventMap = lazy(() => import("./EventMap").then((module) => ({ default: module.EventMap })));

const ALL_GAMES: Game[] = ["pokemon", "magic", "yugioh"];
const PAGE_SIZE = 24;

type SortOption = "soonest" | "nearest" | "name";
type DateFilter = "all" | "today" | "tomorrow" | "week";
type ViewMode = "list" | "map";

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: "soonest", label: "Soonest" },
  { value: "nearest", label: "Nearest" },
  { value: "name", label: "Event name" },
];

const DATE_OPTIONS: Array<{ value: DateFilter; label: string }> = [
  { value: "all", label: "All upcoming" },
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "week", label: "Next 7 days" },
];

const SOURCE_LABELS: Record<EventListItem["source"], string> = {
  "pokedata-events": "Pokémon event listing",
  "wotc-locator": "Wizards Event Locator",
  "konami-kcgn": "Konami Card Game Network",
  "konami-events": "Konami Events",
};

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

function initialGames() {
  const requested = initialParams.get("games")?.split(",").filter((game): game is Game => ALL_GAMES.includes(game as Game));
  return requested?.length ? requested : ALL_GAMES;
}

function initialSort(): SortOption {
  const value = initialParams.get("sort");
  return SORT_OPTIONS.some((option) => option.value === value) ? value as SortOption : "soonest";
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

function sortEvents(events: EventListItem[], sort: SortOption) {
  return [...events].sort((a, b) => {
    const dateDifference = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
    if (sort === "nearest") {
      const distanceDifference = (a.distanceMiles ?? Number.POSITIVE_INFINITY) - (b.distanceMiles ?? Number.POSITIVE_INFINITY);
      return distanceDifference || dateDifference;
    }
    if (sort === "name") return a.title.localeCompare(b.title) || dateDifference;
    return dateDifference;
  });
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

function GameMultiSelect({ value, onChange }: { value: Game[]; onChange: (games: Game[]) => void }) {
  const summary = value.length === ALL_GAMES.length
    ? "All games"
    : value.length === 0
      ? "No games selected"
      : value.map((game) => GAME_LABELS[game]).join(", ");

  function toggleGame(game: Game) {
    onChange(value.includes(game) ? value.filter((item) => item !== game) : [...value, game]);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          aria-label={`Filter by game: ${summary}`}
          aria-haspopup="dialog"
          className="h-11 w-full justify-between px-3 font-normal"
        >
          <span className="truncate">{summary}</span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] p-2">
        <fieldset>
          <legend className="px-2 pb-1 text-sm font-semibold">Include games</legend>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-muted">
            <input
              type="checkbox"
              className="size-5 accent-[var(--primary)]"
              checked={value.length === ALL_GAMES.length}
              onChange={() => onChange(value.length === ALL_GAMES.length ? [] : ALL_GAMES)}
            />
            <span>All games</span>
          </label>
          <div className="my-1 h-px bg-border" />
          {ALL_GAMES.map((game) => (
            <label key={game} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-muted">
              <input
                type="checkbox"
                className="size-5 accent-[var(--primary)]"
                checked={value.includes(game)}
                onChange={() => toggleGame(game)}
              />
              <span>{GAME_LABELS[game]}</span>
            </label>
          ))}
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}

function EventRow({ event, selected }: { event: EventListItem; selected: boolean }) {
  const location = [event.venue?.name, event.venue?.city, event.venue?.region].filter(Boolean).join(" · ");
  const metadata = eventMetadata(event);
  const price = formatPrice(event);
  const sourceLabel = SOURCE_LABELS[event.source];
  const directionsQuery = event.venue?.latitude !== null && event.venue?.latitude !== undefined
    ? `${event.venue.latitude},${event.venue.longitude}`
    : [event.venue?.address, event.venue?.city, event.venue?.region, event.venue?.postalCode].filter(Boolean).join(", ");

  return (
    <li
      id={`event-${event.id}`}
      className={`scroll-mt-24 rounded-xl border bg-card p-4 shadow-xs transition sm:p-5 ${selected ? "border-primary ring-2 ring-primary/15" : "hover:border-foreground/20 hover:shadow-sm"}`}
    >
      <article className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-x-4 gap-y-3 sm:grid-cols-[5.75rem_minmax(0,1fr)]">
        <div className="row-span-2 border-r pr-3">
          <time dateTime={event.startsAt} className="block text-sm font-semibold">{dateLabel(event.startsAt)}</time>
          <span className="mt-1 block text-sm tabular-nums text-muted-foreground">{timeLabel(event.startsAt)}</span>
        </div>

        <div className="min-w-0">
          <h3 className="text-base leading-snug font-semibold tracking-tight sm:text-[1.05rem]">
            {event.sourceUrl ? (
              <a
                href={event.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
                aria-label={`View ${event.title} on ${sourceLabel}`}
              >
                {event.title}
              </a>
            ) : event.title}
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge className={`game-badge game-${event.game}`} variant="outline">{GAME_LABELS[event.game]}</Badge>
            {metadata.map((value) => <span key={value}>{value}</span>)}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            <span className="text-foreground">{location || "Venue to be announced"}</span>
            {event.distanceMiles !== null ? ` · ${event.distanceMiles} mi away` : " · Distance unavailable"}
          </p>
          {(event.venue?.address || price || event.capacity) && (
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {event.venue?.address && <span>{event.venue.address}</span>}
              {price && <span>{price}</span>}
              {event.capacity && <span>Capacity {event.capacity}</span>}
            </div>
          )}
        </div>

        <div className="col-start-2 flex flex-wrap items-center gap-2 pt-1">
          {event.registrationUrl && (
            <Button asChild className="min-h-11 px-4">
              <a href={event.registrationUrl} target="_blank" rel="noreferrer" aria-label={`Register for ${event.title}`}>
                Register <ExternalLink data-icon="inline-end" />
              </a>
            </Button>
          )}
          {directionsQuery && (
            <Button asChild variant="outline" className="min-h-11 px-4">
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(directionsQuery)}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`Get directions to ${event.title}`}
              >
                Directions <Navigation data-icon="inline-end" />
              </a>
            </Button>
          )}
          <span className="text-xs text-muted-foreground">Source: {sourceLabel}</span>
        </div>
      </article>
    </li>
  );
}

function LoadingCards() {
  return (
    <div role="status" aria-label="Finding nearby events" className="space-y-3">
      <span className="sr-only">Finding nearby events…</span>
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} aria-hidden="true" className="h-40 animate-pulse rounded-xl border bg-muted/45" />
      ))}
    </div>
  );
}

export function App() {
  const [selectedGames, setSelectedGames] = useState<Game[]>(initialGames);
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [query, setQuery] = useState(initialParams.get("q") ?? "");
  const [sort, setSort] = useState<SortOption>(initialSort);
  const [dateFilter, setDateFilter] = useState<DateFilter>(initialDateFilter);
  const [viewMode, setViewMode] = useState<ViewMode>(initialParams.get("view") === "map" ? "map" : "list");
  const [location, setLocation] = useState({
    latitude: initialNumber("lat", 41.8781),
    longitude: initialNumber("lng", -87.6298),
  });
  const [locationLabel, setLocationLabel] = useState(initialParams.get("place") ?? "Chicago, IL");
  const [placeQuery, setPlaceQuery] = useState("");
  const [radiusMiles, setRadiusMiles] = useState(initialNumber("radius", 25));
  const [status, setStatus] = useState<"loading" | "live" | "preview" | "error">("loading");
  const [locationStatus, setLocationStatus] = useState<"idle" | "searching" | "locating">("idle");
  const [locationNotice, setLocationNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

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
    if (sort !== "soonest") params.set("sort", sort);
    if (dateFilter !== "all") params.set("date", dateFilter);
    if (viewMode !== "list") params.set("view", viewMode);
    params.set("lat", location.latitude.toFixed(5));
    params.set("lng", location.longitude.toFixed(5));
    params.set("radius", String(radiusMiles));
    params.set("place", locationLabel);
    const nextUrl = `${window.location.pathname}?${params}${window.location.hash}`;
    window.history.replaceState(null, "", nextUrl);
  }, [dateFilter, location, locationLabel, query, radiusMiles, selectedGames, sort, viewMode]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setSelectedEventId(null);
  }, [dateFilter, query, radiusMiles, selectedGames, sort]);

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
    return sortEvents(filtered, sort);
  }, [dateFilter, events, query, selectedGames, sort]);

  const pagedEvents = visibleEvents.slice(0, visibleCount);
  const mappableEvents = visibleEvents.filter((event) => event.venue?.latitude != null && event.venue.longitude != null).slice(0, 120);

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
      setPlaceQuery("");
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
    } catch {
      setLocationNotice("We could not access your location. Enter a city or ZIP code instead.");
    } finally {
      setLocationStatus("idle");
    }
  }

  const handleMapSelect = useCallback((eventId: string) => {
    setSelectedEventId(eventId);
    if (window.innerWidth < 1024) setViewMode("list");
    window.requestAnimationFrame(() => document.getElementById(`event-${eventId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, []);

  const statusLabel = status === "live" ? "Listings live" : status === "preview" ? "Preview data" : status === "loading" ? "Updating" : "Service offline";
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
      <a href="#main-content" className="sr-only z-[1000] rounded-md bg-background px-4 py-3 font-semibold focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to event finder
      </a>

      <header className="sticky top-0 z-[600] border-b bg-background/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[90rem] items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href="#top" className="flex min-h-11 items-center gap-2.5 rounded-lg text-sm font-semibold tracking-tight">
            <img src="/town-map-sprite.png" alt="" className="size-8 object-contain [image-rendering:pixelated]" aria-hidden="true" />
            <span>Town Map</span>
          </a>
          <nav aria-label="Primary" className="flex items-center gap-1 sm:gap-3">
            <a href="#about" className="hidden min-h-11 items-center rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground sm:flex">About</a>
            <Badge variant="outline" className="h-8 gap-2 px-3 text-xs">
              <span className={`size-2 rounded-full ${status === "live" ? "bg-emerald-500" : status === "error" ? "bg-destructive" : "bg-amber-500"}`} />
              {statusLabel}
            </Badge>
          </nav>
        </div>
      </header>

      <main id="main-content">
        <section id="top" className="hero-grid border-b">
          <div className="mx-auto max-w-[90rem] px-4 py-9 sm:px-6 sm:py-12 lg:px-8">
            <div className="max-w-3xl">
              <Badge variant="outline" className="mb-4 bg-background/70"><MapPin className="size-3.5" /> Local card-game events</Badge>
              <h1 className="text-balance text-3xl font-bold tracking-[-0.035em] sm:text-5xl">Find your next card night.</h1>
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                Explore Pokémon, Magic, and Yu-Gi-Oh! events on a map, then head straight to the official listing.
              </p>
            </div>

            <section aria-labelledby="location-heading" className="mt-7 rounded-2xl border bg-background/90 p-4 shadow-sm backdrop-blur sm:p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 id="location-heading" className="font-semibold">Where do you want to play?</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">Location access is optional—search any city or ZIP code.</p>
                </div>
                <span className="rounded-full bg-muted px-3 py-1.5 text-sm font-medium">{locationLabel} · {radiusMiles} mi</span>
              </div>
              <form onSubmit={searchPlace} className="grid gap-3 md:grid-cols-[minmax(15rem,1fr)_9rem_auto]">
                <div>
                  <Label htmlFor="place-search" className="sr-only">City or ZIP code</Label>
                  <div className="relative">
                    <MapPin className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="place-search"
                      value={placeQuery}
                      onChange={(event) => setPlaceQuery(event.target.value)}
                      placeholder="City, state, or ZIP code"
                      autoComplete="postal-code"
                      className="h-11 pl-10"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="radius" className="sr-only">Search radius</Label>
                  <select
                    id="radius"
                    className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    value={radiusMiles}
                    onChange={(event) => setRadiusMiles(Number(event.target.value))}
                  >
                    {[10, 25, 50, 100].map((radius) => <option key={radius} value={radius}>{radius} miles</option>)}
                  </select>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" className="h-11 flex-1 px-4" disabled={!placeQuery.trim() || locationStatus === "searching"}>
                    {locationStatus === "searching" ? "Searching…" : "Search area"}
                  </Button>
                  <Button type="button" variant="outline" className="h-11 px-4" onClick={useCurrentLocation} disabled={locationStatus === "locating"}>
                    <LocateFixed /> <span className="sr-only sm:not-sr-only">{locationStatus === "locating" ? "Locating…" : "Use my location"}</span>
                  </Button>
                </div>
              </form>
              {locationNotice && <p role="status" className="mt-3 flex items-start gap-2 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" />{locationNotice}</p>}
            </section>
          </div>
        </section>

        <section aria-label="Event filters" className="sticky top-16 z-[550] border-b bg-background/94 backdrop-blur-xl">
          <div className="mx-auto max-w-[90rem] px-4 py-3 sm:px-6 lg:px-8">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[13rem_minmax(14rem,1fr)_11rem_11rem]">
              <div>
                <Label className="mb-1.5 block text-sm">Games</Label>
                <GameMultiSelect value={selectedGames} onChange={setSelectedGames} />
              </div>
              <div>
                <Label className="mb-1.5 block text-sm" htmlFor="event-search">Search events</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="event-search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Event, game, store, or format"
                    className="h-11 pr-11 pl-10"
                  />
                  {query && <Button type="button" variant="ghost" size="icon" className="absolute top-1/2 right-1.5 size-9 -translate-y-1/2" aria-label="Clear search" onClick={() => setQuery("")}><X /></Button>}
                </div>
              </div>
              <div>
                <Label className="mb-1.5 block text-sm" htmlFor="event-date">Date</Label>
                <Select value={dateFilter} onValueChange={(value) => setDateFilter(value as DateFilter)}>
                  <SelectTrigger id="event-date" className="min-h-11 w-full px-3"><CalendarDays /><SelectValue /></SelectTrigger>
                  <SelectContent position="popper">{DATE_OPTIONS.map((option) => <SelectItem className="min-h-10" key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block text-sm" htmlFor="event-sort">Sort by</Label>
                <Select value={sort} onValueChange={(value) => setSort(value as SortOption)}>
                  <SelectTrigger id="event-sort" className="min-h-11 w-full px-3"><SelectValue /></SelectTrigger>
                  <SelectContent position="popper">{SORT_OPTIONS.map((option) => <SelectItem className="min-h-10" key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[90rem] px-4 py-6 sm:px-6 lg:px-8 lg:py-8" aria-labelledby="events-heading">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-primary">Near {locationLabel}</p>
              <h2 id="events-heading" className="mt-1 text-2xl font-semibold tracking-tight">Upcoming events</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {status === "loading" ? "Finding official listings…" : `${visibleEvents.length} matching ${visibleEvents.length === 1 ? "event" : "events"} within ${radiusMiles} miles`}
              </p>
            </div>
            <div className="flex rounded-xl border bg-muted/40 p-1 lg:hidden" aria-label="Choose results view">
              <Button variant={viewMode === "list" ? "default" : "ghost"} className="min-h-11 px-4" onClick={() => setViewMode("list")} aria-pressed={viewMode === "list"}><List /> List</Button>
              <Button variant={viewMode === "map" ? "default" : "ghost"} className="min-h-11 px-4" onClick={() => setViewMode("map")} aria-pressed={viewMode === "map"}><MapIcon /> Map</Button>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,0.88fr)_minmax(25rem,1.12fr)] lg:items-start">
            <div className={`${viewMode === "map" ? "hidden" : "block"} min-w-0 lg:block`}>
              {status === "loading" ? (
                <LoadingCards />
              ) : visibleEvents.length === 0 ? (
                <Empty className="rounded-2xl border py-16">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">{status === "error" ? <RefreshCw /> : <Search />}</EmptyMedia>
                    <EmptyTitle>{emptyState.title}</EmptyTitle>
                    <EmptyDescription>{emptyState.description}</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent><Button className="min-h-11 px-4" variant="outline" onClick={emptyState.onClick}>{emptyState.action}</Button></EmptyContent>
                </Empty>
              ) : (
                <>
                  <ol className="space-y-3" aria-label="Event results">
                    {pagedEvents.map((event) => <EventRow key={event.id} event={event} selected={event.id === selectedEventId} />)}
                  </ol>
                  {visibleCount < visibleEvents.length && (
                    <div className="mt-5 rounded-xl border border-dashed p-4 text-center">
                      <p className="mb-3 text-sm text-muted-foreground">Showing {pagedEvents.length} of {visibleEvents.length} events</p>
                      <Button variant="outline" className="min-h-11 px-5" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>Load {Math.min(PAGE_SIZE, visibleEvents.length - visibleCount)} more</Button>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className={`${viewMode === "list" ? "hidden" : "block"} lg:sticky lg:top-[12.5rem] lg:block lg:h-[calc(100svh-14rem)]`}>
              {status === "loading" ? (
                <div className="grid h-[28rem] place-items-center rounded-2xl border bg-muted/35 text-sm text-muted-foreground">Preparing the map…</div>
              ) : mappableEvents.length === 0 ? (
                <div className="grid h-[28rem] place-items-center rounded-2xl border bg-muted/35 p-8 text-center text-sm text-muted-foreground">No mapped venues match these filters.</div>
              ) : (
                <Suspense fallback={<div className="grid h-[28rem] place-items-center rounded-2xl border bg-muted/35 text-sm text-muted-foreground">Loading the map…</div>}>
                  <EventMap center={location} events={mappableEvents} active={viewMode === "map" || window.innerWidth >= 1024} selectedEventId={selectedEventId} onSelect={handleMapSelect} />
                </Suspense>
              )}
              {mappableEvents.length > 0 && mappableEvents.length < visibleEvents.length && <p className="mt-2 text-xs text-muted-foreground">{mappableEvents.length} of {visibleEvents.length} events include map coordinates.</p>}
            </div>
          </div>
        </section>

        <section id="about" className="border-t bg-muted/35">
          <div className="mx-auto grid max-w-[90rem] gap-8 px-4 py-10 sm:px-6 md:grid-cols-3 lg:px-8">
            <div>
              <h2 className="font-semibold">About Town Map</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Town Map brings official trading-card event listings into one local view. Always confirm final details with the organizer.</p>
            </div>
            <div>
              <h2 className="font-semibold">Data sources</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Listings link to Wizards Event Locator, Konami Card Game Network, and Pokedata Pokémon event data.</p>
            </div>
            <div>
              <h2 className="font-semibold">Location and privacy</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Location access is optional. Search a city or ZIP code whenever you prefer not to share your current position.</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t bg-background">
        <div className="mx-auto flex max-w-[90rem] flex-col gap-2 px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <span>Town Map · Independent event discovery · Map and place search © OpenStreetMap contributors</span>
          <span>Listings can change. Verify time, location, and registration with the organizer.</span>
        </div>
      </footer>
    </div>
  );
}
