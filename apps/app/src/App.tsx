import { Geolocation } from "@capacitor/geolocation";
import { SignInButton, useClerk, useUser } from "@clerk/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { recurrenceLabel, type EventListItem, type Game } from "@town-map/contracts";
import {
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  ChevronsUpDown,
  CircleAlert,
  Compass,
  ExternalLink,
  List,
  LocateFixed,
  LogOut,
  Map as MapIcon,
  MapPin,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  User,
  X,
} from "lucide-react";
import { motion } from "framer-motion";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  fetchEvents,
  fetchSavedEvents,
  fetchUserPreferences,
  geocodePlace,
  saveEvent,
  saveUserPreferences,
  unsaveEvent,
} from "./api";
import { demoEvents } from "./demo-events";
import { GameIcon } from "./GameIcon";
import { useGameCatalog, type GameCatalog } from "./games";
import { ExpandableEventCardModal } from "@/components/ui/expandable-card";
import { AnimatedTabs } from "@/components/ui/animated-tabs";
import { SpotlightSearch } from "@/components/ui/spotlight-search";
import { DotBackground } from "@/components/ui/dot-background";
import { AnimatedTooltip } from "@/components/ui/animated-tooltip";
import { Typography } from "@/components/ui/typography";

const EventMap = lazy(() => import("./EventMap").then((module) => ({ default: module.EventMap })));

const PAGE_SIZE = 24;

/**
 * How long typing has to settle before a search reaches the API. Text search
 * used to filter events already in memory, so it cost nothing per keystroke;
 * now that it is a query, this keeps a typed word to one round trip instead of
 * one per character.
 */
const SEARCH_DEBOUNCE_MS = 250;

type DateFilter = "all" | "today" | "tomorrow" | "week";
type ViewMode = "list" | "map";
type Tab = "my-events" | "discover" | "preferences";

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

// Null means "not specified", so every game in the catalog is selected once it
// loads. The slugs themselves are validated against the catalog, not a constant.
function initialGames(): Game[] | null {
  const rawGames = initialParams.get("games");
  if (rawGames === null) return null;
  return rawGames.split(",").filter(Boolean);
}

function initialDateFilter(): DateFilter {
  const value = initialParams.get("date");
  return DATE_OPTIONS.some((option) => option.value === value) ? value as DateFilter : "all";
}

function initialTab(authEnabled: boolean): Tab {
  const value = initialParams.get("tab");
  if (value === "preferences") return "preferences";
  if (!authEnabled) return "discover";
  if (value === "discover" || value === "my-events") return value;
  const hasDiscoveryParams =
    initialParams.has("q") ||
    initialParams.has("games") ||
    initialParams.has("date") ||
    initialParams.has("place") ||
    initialParams.has("lat") ||
    initialParams.has("lng") ||
    initialParams.has("view");
  return hasDiscoveryParams ? "discover" : "my-events";
}

function SignedInUserFooter({ setTab }: { setTab: (tab: Tab) => void }) {
  const clerk = useClerk();
  const { user } = useUser();
  const avatarUrl = user?.imageUrl;
  const displayName = user?.fullName || user?.firstName || user?.primaryEmailAddress?.emailAddress || "Account";
  const email = user?.primaryEmailAddress?.emailAddress;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
          size="lg"
          tooltip="Account & preferences"
          className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt={displayName} className="size-8 rounded-lg object-cover shrink-0" />
          ) : (
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-xs font-semibold">
              {displayName.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="grid flex-1 text-left text-xs leading-tight">
            <span className="truncate font-semibold">{displayName}</span>
            {email && <span className="truncate text-muted-foreground">{email}</span>}
          </div>
          <ChevronsUpDown className="ml-auto size-4 shrink-0" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
        side="top"
        align="start"
        sideOffset={6}
      >
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex items-center gap-2 px-2 py-2 text-left text-sm">
            {avatarUrl ? (
              <img src={avatarUrl} alt={displayName} className="size-8 rounded-lg object-cover shrink-0" />
            ) : (
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-xs font-semibold">
                {displayName.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="grid flex-1 text-left text-xs leading-tight">
              <span className="truncate font-semibold">{displayName}</span>
              {email && <span className="truncate text-muted-foreground">{email}</span>}
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => clerk.openUserProfile()}>
            <User className="mr-2 size-4" />
            Account settings
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTab("preferences")}>
            <SlidersHorizontal className="mr-2 size-4" />
            App preferences
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => clerk.signOut()}>
          <LogOut className="mr-2 size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserFooterMenu({ auth, setTab }: { auth: AppAuth; setTab: (tab: Tab) => void }) {
  if (!auth.enabled) {
    return (
      <SidebarMenuButton tooltip="Guest mode" className="cursor-default opacity-70">
        <User className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-xs text-muted-foreground">Guest mode</span>
      </SidebarMenuButton>
    );
  }

  if (!auth.loaded) {
    return (
      <SidebarMenuButton disabled>
        <div className="size-6 animate-pulse rounded-full bg-muted" />
        <div className="h-4 w-20 animate-pulse rounded bg-muted" />
      </SidebarMenuButton>
    );
  }

  if (!auth.signedIn) {
    return (
      <SignInButton mode="modal">
        <SidebarMenuButton tooltip="Sign in">
          <User className="size-4 shrink-0" />
          <span>Sign in</span>
        </SidebarMenuButton>
      </SignInButton>
    );
  }

  return <SignedInUserFooter setTab={setTab} />;
}

function AccountSettingsCard() {
  const clerk = useClerk();
  return (
    <div className="rounded-xl border bg-card p-5 shadow-xs flex items-center justify-between gap-4 max-w-xl">
      <div>
        <h3 className="font-semibold text-sm">Account settings</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Manage your user profile, email addresses, and security settings via Clerk.</p>
      </div>
      <Button variant="outline" size="sm" onClick={() => clerk.openUserProfile()}>
        Manage account
      </Button>
    </div>
  );
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

function GameFilters({ value, onChange, catalog }: { value: Game[]; onChange: (games: Game[]) => void; catalog: GameCatalog }) {
  function toggleGame(game: Game) {
    onChange(value.includes(game) ? value.filter((item) => item !== game) : [...value, game]);
  }

  return (
    <fieldset className="flex min-w-0 items-center gap-1 overflow-x-auto py-1" aria-label="Games">
      <legend className="sr-only">Games</legend>
      {catalog.ids.map((game) => {
        const selected = value.includes(game);
        return (
          <AnimatedTooltip key={game} title={catalog.label(game)}>
            <Button
              type="button"
              variant={selected ? "secondary" : "ghost"}
              size="icon"
              className={`size-10 ${selected ? "ring-1 ring-primary/40" : "opacity-45 hover:opacity-100"}`}
              aria-label={`${selected ? "Exclude" : "Include"} ${catalog.label(game)} events`}
              aria-pressed={selected}
              onClick={() => toggleGame(game)}
            >
              <GameIcon game={game} className="size-5 object-contain" decorative />
            </Button>
          </AnimatedTooltip>
        );
      })}
    </fieldset>
  );
}

function GamePreferencePicker({ value, onChange, catalog }: { value: Game[]; onChange: (games: Game[]) => void; catalog: GameCatalog }) {
  function toggleGame(game: Game) {
    onChange(value.includes(game) ? value.filter((item) => item !== game) : [...value, game]);
  }

  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">Games you play</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {catalog.ids.map((game) => {
          const selected = value.includes(game);
          return (
            <Button
              key={game}
              type="button"
              variant={selected ? "secondary" : "outline"}
              className={`h-12 justify-start px-3 ${selected ? "ring-1 ring-primary/50" : "opacity-65"}`}
              aria-pressed={selected}
              onClick={() => toggleGame(game)}
            >
              <GameIcon game={game} className="size-6 shrink-0 object-contain" decorative />
              <span className="truncate">{catalog.label(game)}</span>
            </Button>
          );
        })}
      </div>
    </fieldset>
  );
}

function DateFilters({ value, onChange }: { value: DateFilter; onChange: (value: DateFilter) => void }) {
  const options = DATE_OPTIONS.map((opt) => ({
    value: opt.value,
    label: opt.value === "all" ? "Any date" : opt.value === "week" ? "This week" : opt.label,
  }));

  return (
    <div aria-label="Date filter">
      <AnimatedTabs
        options={options}
        value={value}
        onChange={onChange}
        layoutId="date-filter-pill"
      />
    </div>
  );
}

function EventRow({
  event,
  active,
  saved,
  canSave,
  layoutIdPrefix = "discover",
  onPreview,
  onSelect,
  onToggleSave,
}: {
  event: EventListItem;
  active: boolean;
  saved: boolean;
  /** False when nobody is signed in, in which case there is nowhere to save to. */
  canSave: boolean;
  layoutIdPrefix?: string;
  onPreview: (eventId: string | null) => void;
  onSelect: (eventId: string) => void;
  onToggleSave: (eventId: string) => void;
}) {
  const location = [event.venue?.name, event.venue?.city, event.venue?.region].filter(Boolean).join(" · ");
  const details = [
    ...eventMetadata(event),
    formatPrice(event),
    event.capacity !== null ? `Capacity ${event.capacity}` : null,
  ].filter((detail): detail is string => detail !== null);
  const recurrence = recurrenceLabel(event.series);

  return (
    <motion.div
      layoutId={`card-${layoutIdPrefix}-${event.id}`}
      key={`card-${layoutIdPrefix}-${event.id}`}
      id={`event-${event.id}`}
      onClick={() => onSelect(event.id)}
      onMouseEnter={() => onPreview(event.id)}
      onMouseLeave={() => onPreview(null)}
      className={`p-3.5 sm:p-4 flex flex-col md:flex-row justify-between items-start md:items-center hover:bg-muted/40 rounded-2xl cursor-pointer transition-colors border border-transparent ${active ? "bg-muted/70 border-border/50" : ""}`}
    >
      <div className="flex gap-3.5 items-center min-w-0 flex-1 w-full md:w-auto">
        <motion.div layoutId={`image-${layoutIdPrefix}-${event.id}`} className="shrink-0">
          <div className="h-12 w-12 rounded-xl bg-background flex items-center justify-center p-1.5 border border-border shadow-xs ring-1 ring-border/50 shrink-0">
            <GameIcon game={event.game} className="size-8 object-contain" />
          </div>
        </motion.div>
        {/* Deliberately not layoutId-shared with the modal: this box is truncated and
            full-width, the modal's is content-width at a larger size, so a shared element
            could only bridge them by scaling the text. `layout` still has to be here — on
            close this row is the lead instance and would otherwise inherit the card's
            shrink transform. */}
        <motion.div layout className="min-w-0 flex-1">
          <h3 className="font-bold text-foreground text-sm leading-snug truncate">
            {event.title}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {location || "Venue to be announced"}
            {event.distanceMiles !== null ? ` · ${event.distanceMiles} mi away` : ""}
          </p>
        </motion.div>
      </div>

      {/* Same reason as the text block: the bookmark button has no layoutId of its own, so
          this needs to be a projection node or it distorts as the card shrinks back. */}
      <motion.div layout className="flex items-center gap-2 mt-2 md:mt-0 shrink-0 self-end md:self-center">
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
  const catalog = useGameCatalog();
  // Null until the user chooses, so a game added to the catalogue is selected by
  // default rather than being invisible to anyone with an existing URL.
  const [gameSelection, setSelectedGames] = useState<Game[] | null>(initialGames);
  const selectedGames = useMemo(
    () => (gameSelection === null
      ? catalog.ids
      : gameSelection.filter((game) => catalog.ids.includes(game))),
    [gameSelection, catalog],
  );
  const [events, setEvents] = useState<EventListItem[]>([]);
  // True when the area holds more events than one query will gather, so the map
  // is showing a subset rather than everything nearby.
  const [resultsTruncated, setResultsTruncated] = useState(false);
  const [query, setQuery] = useState(initialParams.get("q") ?? "");
  const [dateFilter, setDateFilter] = useState<DateFilter>(initialDateFilter);
  const [viewMode, setViewMode] = useState<ViewMode>(initialParams.get("view") === "map" ? "map" : "list");
  const [location, setLocation] = useState({
    latitude: initialNumber("lat", 41.8781),
    longitude: initialNumber("lng", -87.6298),
  });
  const [locationLabel, setLocationLabel] = useState(initialParams.get("place") ?? "Chicago, IL");
  const [homeAddress, setHomeAddress] = useState<string | null>(null);
  const [homeDraft, setHomeDraft] = useState("");
  const [accountGames, setAccountGames] = useState<Game[]>([]);
  const [preferenceGamesDraft, setPreferenceGamesDraft] = useState<Game[]>([]);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(!auth.enabled);
  const [preferencesReloadKey, setPreferencesReloadKey] = useState(0);
  const [homeNotice, setHomeNotice] = useState<string | null>(null);
  const [preferenceStatus, setPreferenceStatus] = useState<"idle" | "loading" | "ready" | "saved" | "saving" | "error">("idle");
  const [placeQuery, setPlaceQuery] = useState(initialParams.get("place") ?? "Chicago, IL");
  const [radiusMiles, setRadiusMiles] = useState(initialNumber("radius", 25));
  const [status, setStatus] = useState<"loading" | "live" | "preview" | "error">("loading");
  const [locationStatus, setLocationStatus] = useState<"idle" | "searching" | "locating">("idle");
  const [locationNotice, setLocationNotice] = useState<string | null>(null);
  const [locationEditorOpen, setLocationEditorOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [expandedLayoutIdPrefix, setExpandedLayoutIdPrefix] = useState<string>("discover");
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => initialTab(auth.enabled));
  const [savedEvents, setSavedEvents] = useState<EventListItem[]>([]);
  const [savedStatus, setSavedStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [savedReloadKey, setSavedReloadKey] = useState(0);

  const expandedEvent = useMemo(
    () => events.find((candidate) => candidate.id === expandedEventId) ?? savedEvents.find((candidate) => candidate.id === expandedEventId) ?? null,
    [expandedEventId, events, savedEvents],
  );
  // Saving is an account feature, so there is nothing to write to until Clerk has
  // both loaded and reported somebody signed in.
  const canSave = auth.enabled && auth.loaded && auth.signedIn;
  const savedIds = useMemo(() => new Set(savedEvents.map((event) => event.id)), [savedEvents]);

  useEffect(() => {
    if (!auth.enabled || !auth.loaded) return;
    if (!auth.signedIn) {
      // Signing out has to clear the list rather than leave the previous
      // account's saves on screen for the next person to use this browser.
      setSavedEvents([]);
      setSavedStatus("idle");
      setSavedNotice(null);
      return;
    }
    const controller = new AbortController();
    setSavedStatus("loading");
    fetchSavedEvents(auth.getToken, controller.signal)
      .then((saved) => {
        setSavedEvents(saved.events);
        setSavedStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSavedStatus("error");
      });
    return () => controller.abort();
  }, [auth.enabled, auth.getToken, auth.loaded, auth.signedIn, savedReloadKey]);

  /**
   * Applied locally before the request is sent. The icon is the only feedback a
   * save has, and waiting a round trip to move it reads as a dropped tap; a
   * failure puts the previous list back and says so.
   */
  const toggleSaved = useCallback(async (eventId: string) => {
    if (!canSave) return;
    const previous = savedEvents;
    const wasSaved = previous.some((candidate) => candidate.id === eventId);
    const event = previous.find((candidate) => candidate.id === eventId)
      ?? events.find((candidate) => candidate.id === eventId);
    if (!event) return;
    setSavedNotice(null);
    setSavedEvents(wasSaved
      ? previous.filter((candidate) => candidate.id !== eventId)
      : sortEvents([...previous, event]));
    try {
      if (wasSaved) await unsaveEvent(eventId, auth.getToken);
      else await saveEvent(eventId, auth.getToken);
    } catch (error) {
      setSavedEvents(previous);
      setSavedNotice(error instanceof Error && error.message
        ? error.message
        : (wasSaved
          ? "We couldn't remove that event. Please try again."
          : "We couldn't save that event. Please try again."));
      console.error("Updating saved events failed", error);
    }
  }, [auth.getToken, canSave, events, savedEvents]);

  useEffect(() => {
    if (!auth.enabled || !auth.loaded) return;
    if (!auth.signedIn) {
      setHomeAddress(null);
      setAccountGames([]);
      setPreferenceGamesDraft([]);
      setOnboardingCompleted(false);
      setPreferencesReady(true);
      setSelectedGames(initialGames());
      setPreferenceStatus("idle");
      return;
    }
    const controller = new AbortController();
    setPreferencesReady(false);
    setPreferenceStatus("loading");
    fetchUserPreferences(auth.getToken, controller.signal)
      .then(async (preferences) => {
        setHomeAddress(preferences.homeAddress);
        setHomeDraft(preferences.homeAddress ?? "");
        setAccountGames(preferences.selectedGames);
        setPreferenceGamesDraft(preferences.selectedGames);
        setOnboardingCompleted(preferences.onboardingCompleted);
        if (initialParams.get("games") === null && preferences.selectedGames.length > 0) {
          setSelectedGames(preferences.selectedGames);
        }
        if (preferences.homeAddress) setPlaceQuery(preferences.homeAddress);
        const hasUrlLocation = initialParams.has("place") || (initialParams.has("lat") && initialParams.has("lng"));
        if (preferences.homeAddress && !hasUrlLocation) {
          try {
            const result = await geocodePlace(preferences.homeAddress, controller.signal);
            if (controller.signal.aborted) return;
            if (result) {
              setLocation({ latitude: result.latitude, longitude: result.longitude });
              setLocationLabel(result.label);
            } else {
              setLocationNotice("Your home is saved, but we couldn't locate it right now.");
            }
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") return;
            setLocationNotice("Your home is saved, but we couldn't locate it right now.");
          }
        }
        if (controller.signal.aborted) return;
        setPreferencesReady(true);
        setPreferenceStatus("idle");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPreferencesReady(false);
        setPreferenceStatus("error");
      });
    return () => controller.abort();
  }, [auth.enabled, auth.getToken, auth.loaded, auth.signedIn, preferencesReloadKey]);

  // Trails `query` by one debounce interval. The input stays fully controlled by
  // `query` so typing never lags; this is only what the request is keyed on.
  const [searchTerm, setSearchTerm] = useState(query.trim());

  useEffect(() => {
    const trimmed = query.trim();
    // Clearing the box should restore the unfiltered list immediately — there is
    // no half-typed word to wait out.
    if (!trimmed) {
      setSearchTerm("");
      return;
    }
    const timer = setTimeout(() => setSearchTerm(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if ((auth.enabled && (!auth.loaded || (auth.signedIn && !preferencesReady))) || locationStatus === "searching") {
      setStatus("loading");
      return;
    }
    if (selectedGames.length === 0) {
      setEvents([]);
      setStatus("live");
      return;
    }

    const controller = new AbortController();
    setStatus("loading");
    fetchEvents({ games: selectedGames, query: searchTerm, ...location, radiusMiles, signal: controller.signal })
      .then(({ events: nextEvents, truncated }) => {
        setEvents(nextEvents);
        setResultsTruncated(truncated);
        setStatus("live");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setResultsTruncated(false);
        if (import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === "true") {
          setEvents(demoEvents);
          setStatus("preview");
        } else {
          setEvents([]);
          setStatus("error");
        }
      });
    return () => controller.abort();
  }, [auth.enabled, auth.loaded, auth.signedIn, selectedGames, searchTerm, location, radiusMiles, locationStatus, preferencesReady, reloadKey]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (auth.enabled) params.set("tab", tab);
    if (selectedGames.length !== catalog.ids.length) params.set("games", selectedGames.join(","));
    if (query) params.set("q", query);
    if (dateFilter !== "all") params.set("date", dateFilter);
    if (viewMode !== "list") params.set("view", viewMode);
    params.set("lat", location.latitude.toFixed(5));
    params.set("lng", location.longitude.toFixed(5));
    params.set("radius", String(radiusMiles));
    params.set("place", locationLabel);
    const nextUrl = `${window.location.pathname}?${params}${window.location.hash}`;
    window.history.replaceState(null, "", nextUrl);
  }, [auth.enabled, catalog.ids.length, dateFilter, location, locationLabel, query, radiusMiles, selectedGames, tab, viewMode]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setSelectedEventId(null);
    setHighlightedEventId(null);
    // Keyed on the debounced term, not the raw input: the list a selection
    // refers to only changes when a request has actually been made for it.
  }, [dateFilter, searchTerm, radiusMiles, selectedGames]);

  // The text query is applied by the API, against every event in range rather
  // than only the pages gathered here. What is left to do locally is the date
  // filter, which is derived from data already on screen.
  const visibleEvents = useMemo(() => {
    const filtered = events.filter((event) =>
      selectedGames.includes(event.game) && matchesDate(event, dateFilter));
    return sortEvents(filtered);
  }, [dateFilter, events, selectedGames]);

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

  async function saveAccountPreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = homeDraft.trim();
    if (!normalized || preferenceGamesDraft.length === 0 || !auth.signedIn) return;
    setPreferenceStatus("saving");
    setHomeNotice(null);
    try {
      const preferences = await saveUserPreferences({
        homeAddress: normalized,
        selectedGames: preferenceGamesDraft,
      }, auth.getToken);
      setHomeAddress(preferences.homeAddress);
      setHomeDraft(preferences.homeAddress ?? normalized);
      setAccountGames(preferences.selectedGames);
      setPreferenceGamesDraft(preferences.selectedGames);
      setSelectedGames(preferences.selectedGames);
      setOnboardingCompleted(preferences.onboardingCompleted);
      setPreferenceStatus("saved");
    } catch (error) {
      // Logged as well as shown: the surfaced text is deliberately short, and
      // the underlying error is what makes a failure diagnosable at all.
      console.error("Saving preferences failed", error);
      setPreferenceStatus("error");
      setHomeNotice(error instanceof Error && error.message
        ? `We couldn't save your preferences: ${error.message}`
        : "We couldn't save your preferences right now. Please try again.");
      return;
    }

    setLocationStatus("searching");
    try {
      const result = await geocodePlace(normalized);
      if (!result) {
        setLocationNotice("Home saved. We couldn't locate it yet; try a city with its state or a ZIP code.");
        return;
      }
      setLocation({ latitude: result.latitude, longitude: result.longitude });
      setLocationLabel(result.label);
      setPlaceQuery(normalized);
      setLocationNotice(null);
    } catch {
      setLocationNotice("Home saved. We couldn't locate it right now, but it remains your default.");
    } finally {
      setLocationStatus("idle");
    }
  }

  const handleMapSelect = useCallback((eventId: string) => {
    setSelectedEventId(eventId);
    setExpandedEventId(eventId);
    setExpandedLayoutIdPrefix("map");
    setHighlightedEventId(null);
  }, []);

  const handleDiscoverSelect = useCallback((eventId: string) => {
    setSelectedEventId(eventId);
    setExpandedEventId(eventId);
    setExpandedLayoutIdPrefix("discover");
  }, []);

  const handleSavedSelect = useCallback((eventId: string) => {
    setSelectedEventId(eventId);
    setExpandedEventId(eventId);
    setExpandedLayoutIdPrefix("saved");
  }, []);

  const handleClearSelectedEvent = useCallback(() => {
    setSelectedEventId(null);
  }, []);

  const emptyState = selectedGames.length === 0 ? {
    title: "Choose at least one game",
    description: "Select the games you want to include in the event list.",
    action: "Select all games",
    onClick: () => setSelectedGames(catalog.ids),
  } : status === "error" ? {
    title: "Events could not be loaded",
    description: "The event service may be temporarily unavailable. Your filters are still saved in this URL.",
    action: "Try again",
    onClick: () => setReloadKey((value) => value + 1),
  } : {
    title: "No matching events",
    description: `Try a wider distance, another date, or fewer search terms near ${locationLabel}.`,
    action: "Clear filters",
    onClick: () => { setQuery(""); setDateFilter("all"); setSelectedGames(catalog.ids); },
  };

  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={true}>
        <div className="flex min-h-svh w-full bg-background text-foreground">
          <Sidebar collapsible="icon">
            <SidebarHeader>
              <div className="flex h-12 items-center gap-2.5 px-2">
                <img src="/town-map.png" alt="Town Map logo" className="size-8 object-contain shrink-0" />
                <span className="font-semibold text-sm group-data-[collapsible=icon]:hidden">Town Map</span>
              </div>
            </SidebarHeader>

            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        isActive={tab === "discover"}
                        tooltip="Discover"
                        onClick={() => setTab("discover")}
                      >
                        <Compass />
                        <span>Discover</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>

                    <SidebarMenuItem>
                      <SidebarMenuButton
                        isActive={tab === "my-events"}
                        tooltip="My events"
                        onClick={() => setTab("my-events")}
                      >
                        <Bookmark />
                        <span>My events</span>
                        {canSave && savedEvents.length > 0 && (
                          <SidebarMenuBadge className="font-medium group-data-[collapsible=icon]:hidden">
                            {savedEvents.length}
                          </SidebarMenuBadge>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>

            <SidebarFooter>
              <SidebarMenu>
                <SidebarMenuItem>
                  <UserFooterMenu auth={auth} setTab={setTab} />
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarFooter>

            <SidebarRail />
          </Sidebar>

          <SidebarInset className="flex flex-1 flex-col min-w-0 h-svh overflow-hidden">
            <a href="#main-content" className="sr-only z-[1000] bg-background px-4 py-3 font-semibold focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
              Skip to events
            </a>

            {auth.enabled && auth.loaded && auth.signedIn && preferencesReady && !onboardingCompleted && (
              <div className="fixed inset-0 z-[100] overflow-y-auto bg-background/95 px-4 py-8 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
                <div className="mx-auto flex min-h-full max-w-lg items-center justify-center">
                  <div className="w-full rounded-xl border bg-card p-5 text-card-foreground shadow-xl sm:p-7">
                    <div className="flex items-center gap-3">
                      <img src="/town-map.png" alt="" className="size-11 object-contain" />
                      <div>
                        <h2 id="onboarding-title" className="text-lg font-semibold">Find tournaments near you</h2>
                        <p className="text-sm text-muted-foreground">Tell us where to look and which games you play.</p>
                      </div>
                    </div>
                    <form onSubmit={saveAccountPreferences} className="mt-6 space-y-5">
                      <div className="space-y-1.5">
                        <Label htmlFor="onboarding-home">Home area</Label>
                        <Input
                          id="onboarding-home"
                          value={homeDraft}
                          onChange={(event) => setHomeDraft(event.target.value)}
                          placeholder="Chicago, IL or 60614"
                          autoComplete="street-address"
                          className="h-11"
                          autoFocus
                        />
                        <p className="text-xs text-muted-foreground">A city, ZIP code, or full address works.</p>
                      </div>
                      <GamePreferencePicker value={preferenceGamesDraft} onChange={setPreferenceGamesDraft} catalog={catalog} />
                      {preferenceGamesDraft.length === 0 && <p className="text-xs text-muted-foreground">Choose at least one game.</p>}
                      {homeNotice && <p role="status" className="text-sm text-destructive">{homeNotice}</p>}
                      <Button
                        type="submit"
                        className="h-11 w-full"
                        disabled={!homeDraft.trim() || preferenceGamesDraft.length === 0 || preferenceStatus === "saving"}
                      >
                        {preferenceStatus === "saving" ? "Saving…" : "Show nearby tournaments"}
                      </Button>
                    </form>
                  </div>
                </div>
              </div>
            )}

            <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4 lg:px-6">
              <div className="flex items-center gap-3">
                <SidebarTrigger />
                <Separator orientation="vertical" className="h-4" />
                <Typography variant="h2" as="h1">
                  {tab === "my-events" ? "My events" : tab === "preferences" ? "Preferences" : "Discover"}
                </Typography>
              </div>
              {tab === "discover" && auth.loaded && !auth.signedIn && (
                <div className="flex items-center gap-2">
                  <Popover open={locationEditorOpen} onOpenChange={setLocationEditorOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-9 gap-2 font-normal">
                        <MapPin className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate max-w-40 sm:max-w-xs">{locationLabel}</span>
                        <ChevronDown className="size-3.5 shrink-0 opacity-60" />
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
                      </form>
                    </PopoverContent>
                  </Popover>
                </div>
              )}
            </header>

            <main id="main-content" className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-4 py-3 sm:px-6 lg:px-8">
              {tab === "preferences" ? (
                <section aria-label="Preferences" className="mx-auto flex w-full max-w-2xl min-h-0 flex-1 flex-col py-2">
                  <div className="border-b pb-3">
                    <p className="text-sm text-muted-foreground">
                      Configure your default home location and preferred trading card games for tournament search.
                    </p>
                  </div>

                  <div className="mt-6 space-y-6">
                    <form onSubmit={saveAccountPreferences} className="space-y-6 rounded-xl border bg-card p-6 shadow-xs">
                      <div className="space-y-2">
                        <Label htmlFor="pref-home-address" className="text-base font-semibold">Home area</Label>
                        <Input
                          id="pref-home-address"
                          value={homeDraft}
                          onChange={(event) => setHomeDraft(event.target.value)}
                          placeholder="Chicago, IL or 60614"
                          autoComplete="street-address"
                          className="h-11"
                        />
                        <p className="text-xs text-muted-foreground">City, ZIP code, or full address work as your default search center.</p>
                      </div>

                      <div className="space-y-3">
                        <GamePreferencePicker value={preferenceGamesDraft} onChange={setPreferenceGamesDraft} catalog={catalog} />
                        {preferenceGamesDraft.length === 0 && <p className="text-xs text-destructive">Choose at least one game.</p>}
                      </div>

                      {homeNotice && (
                        <div role="status" className="flex items-center gap-2 text-sm text-destructive">
                          <CircleAlert className="size-4 shrink-0" />
                          <span>{homeNotice}</span>
                        </div>
                      )}

                      {preferenceStatus === "saved" && !homeNotice && (
                        <p role="status" className="text-xs text-emerald-600 dark:text-emerald-400">Preferences saved.</p>
                      )}

                      <Button
                        type="submit"
                        className="h-11 w-full sm:w-auto px-6"
                        disabled={!homeDraft.trim() || preferenceGamesDraft.length === 0 || preferenceStatus === "saving" || !canSave}
                      >
                        {preferenceStatus === "saving" ? "Saving…" : "Save preferences"}
                      </Button>
                      {!canSave && (
                        <p className="text-xs text-muted-foreground">Sign in to sync preferences to your account.</p>
                      )}
                    </form>

                    {canSave && <AccountSettingsCard />}
                  </div>
                </section>
              ) : tab === "my-events" ? (
                <section aria-label="My events" className="flex min-h-0 flex-1 flex-col">
                  {canSave && savedStatus !== "error" && (
                    <div className="flex min-h-9 shrink-0 items-center justify-between gap-3 border-b pb-2 text-sm">
                      <p className="text-xs text-muted-foreground">
                        {savedStatus === "loading"
                          ? "Loading your events…"
                          : `${savedEvents.length} ${savedEvents.length === 1 ? "event" : "events"} saved`}
                      </p>
                    </div>
                  )}

                  {savedNotice && (
                    <p role="status" className="flex items-start gap-1 py-2 text-xs text-destructive">
                      <CircleAlert className="mt-0.5 size-3.5 shrink-0" />{savedNotice}
                    </p>
                  )}

                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                    {!auth.loaded || (auth.signedIn && (savedStatus === "loading" || !preferencesReady)) ? (
                      <LoadingCards />
                    ) : !canSave ? (
                      <Empty className="py-16">
                        <EmptyHeader>
                          <EmptyMedia variant="icon"><Bookmark /></EmptyMedia>
                          <EmptyTitle>Sign in to keep events</EmptyTitle>
                          <EmptyDescription>
                            Saved events live on your account, so they are still here on your phone and on your laptop.
                          </EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent className="flex-row justify-center gap-2">
                          <SignInButton mode="modal"><Button className="min-h-11 px-4">Sign in</Button></SignInButton>
                          <Button variant="outline" className="min-h-11 px-4" onClick={() => setTab("discover")}>Browse events</Button>
                        </EmptyContent>
                      </Empty>
                    ) : savedStatus === "error" ? (
                      <Empty className="py-16">
                        <EmptyHeader>
                          <EmptyMedia variant="icon"><RefreshCw /></EmptyMedia>
                          <EmptyTitle>Your events could not be loaded</EmptyTitle>
                          <EmptyDescription>Nothing has been lost. Check your connection and try again.</EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent>
                          <Button variant="outline" className="min-h-11 px-4" onClick={() => setSavedReloadKey((value) => value + 1)}>
                            Try again
                          </Button>
                        </EmptyContent>
                      </Empty>
                    ) : savedEvents.length === 0 ? (
                      <Empty className="py-16">
                        <EmptyHeader>
                          <EmptyMedia variant="icon"><Bookmark /></EmptyMedia>
                          <EmptyTitle>Nothing saved yet</EmptyTitle>
                          <EmptyDescription>
                            Save an event from Discover and it will be waiting here, soonest first.
                          </EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent>
                          <Button className="min-h-11 px-4" onClick={() => setTab("discover")}>Find events</Button>
                        </EmptyContent>
                      </Empty>
                    ) : (
                      <div className="border-b" aria-label="Saved events">
                        {groupEventsByDate(savedEvents).map((group) => (
                          <section key={group.key} aria-labelledby={`saved-${group.key}`}>
                            <Typography
                              variant="kicker"
                              as="h3"
                              id={`saved-${group.key}`}
                              className="border-b bg-muted/35 px-3 py-2 block"
                            >
                              {group.label}
                            </Typography>
                            <ol className="divide-y">
                              {group.events.map((event) => (
                                <EventRow
                                  key={event.id}
                                  event={event}
                                  active={false}
                                  saved
                                  canSave={canSave}
                                  layoutIdPrefix="saved"
                                  onPreview={() => undefined}
                                  onSelect={handleSavedSelect}
                                  onToggleSave={toggleSaved}
                                />
                              ))}
                            </ol>
                          </section>
                        ))}
                      </div>
                    )}
                    <p className="px-2 py-5 text-xs text-muted-foreground">
                      Verify details with the organizer. Past events drop off this list automatically.
                    </p>
                  </div>
                </section>
              ) : (
                <>
                  <section aria-label="Location and event filters" className="shrink-0 border-b pb-3">
                    <div className={`grid gap-2 ${auth.loaded && !auth.signedIn ? "sm:grid-cols-[minmax(0,1fr)_auto]" : ""}`}>
                      <SpotlightSearch className="w-full">
                        <div className="relative">
                          <Label className="sr-only" htmlFor="event-search">Search events or venues</Label>
                          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground z-20" />
                          <Input
                            id="event-search"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search events or venues"
                            className="h-11 pr-11 pl-10"
                          />
                          {query && <Button type="button" variant="ghost" size="icon" className="absolute top-1/2 right-1.5 size-9 -translate-y-1/2 z-20" aria-label="Clear search" onClick={() => setQuery("")}><X /></Button>}
                        </div>
                      </SpotlightSearch>

                      {auth.loaded && !auth.signedIn && (
                        <Popover open={locationEditorOpen} onOpenChange={setLocationEditorOpen}>
                          <PopoverTrigger asChild>
                            <Button variant="outline" className="h-11 w-full justify-between gap-2 px-3 font-normal sm:w-auto sm:max-w-72">
                              <span className="flex min-w-0 items-center gap-2">
                                <MapPin className="shrink-0" />
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
                            </form>
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>

                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="max-w-full overflow-x-auto pb-1 sm:pb-0">
                        <DateFilters value={dateFilter} onChange={setDateFilter} />
                      </div>
                      <div className="flex items-center justify-between gap-2 sm:justify-end">
                        {auth.loaded && !auth.signedIn && <GameFilters value={selectedGames} onChange={setSelectedGames} catalog={catalog} />}
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

                  <section aria-labelledby="events-heading" className="flex min-h-0 flex-1 flex-col">
                    <h2 id="events-heading" className="sr-only">Events</h2>
                    <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b py-2 text-sm">
                      <p className="text-muted-foreground">
                        {status === "loading" ? "Finding events…" : `${visibleEvents.length} ${visibleEvents.length === 1 ? "event" : "events"} near ${locationLabel}`}
                        {status === "preview" ? " · preview data" : ""}
                      </p>
                      <div className="flex lg:hidden" aria-label="Choose results view">
                        <AnimatedTabs
                          options={[
                            { value: "list", label: <span className="flex items-center gap-1.5"><List className="size-3.5" /> List</span> },
                            { value: "map", label: <span className="flex items-center gap-1.5"><MapIcon className="size-3.5" /> Map</span> },
                          ]}
                          value={viewMode}
                          onChange={setViewMode}
                          layoutId="view-mode-pill"
                        />
                      </div>
                    </div>

                    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,0.88fr)_minmax(25rem,1.12fr)]">
                      <div className={`${viewMode === "map" ? "hidden" : "block"} min-h-0 min-w-0 overflow-y-auto overscroll-contain lg:block`}>
                        {status === "loading" ? (
                          <LoadingCards />
                        ) : visibleEvents.length === 0 ? (
                          <DotBackground className="rounded-2xl border my-4">
                            <Empty className="py-12 border-none">
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

                      <div className={`${viewMode === "list" ? "hidden" : "block"} min-h-0 overflow-hidden lg:block`}>
                        {status === "loading" ? (
                          <div className="grid h-full min-h-0 place-items-center border bg-muted/20 text-sm text-muted-foreground">Preparing the map…</div>
                        ) : mappableEvents.length === 0 ? (
                          <div className="grid h-full min-h-0 place-items-center border bg-muted/20 p-8 text-center text-sm text-muted-foreground">No mapped venues match these filters.</div>
                        ) : (
                          <Suspense fallback={<div className="grid h-full min-h-0 place-items-center border bg-muted/20 text-sm text-muted-foreground">Loading the map…</div>}>
                            <EventMap
                              center={location}
                              events={mappableEvents}
                              active={viewMode === "map" || window.innerWidth >= 1024}
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
                    </div>
                  </section>
                </>
              )}
            </main>
          </SidebarInset>
        </div>
      </SidebarProvider>
      <ExpandableEventCardModal
        event={expandedEvent}
        layoutIdPrefix={expandedLayoutIdPrefix}
        onClose={() => setExpandedEventId(null)}
        saved={expandedEvent ? savedIds.has(expandedEvent.id) : false}
        canSave={canSave}
        onToggleSave={toggleSaved}
        eventMetadata={eventMetadata}
        formatPrice={formatPrice}
        recurrenceLabel={recurrenceLabel}
      />
    </TooltipProvider>
  );
}
