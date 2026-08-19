import { SignInButton, useClerk, useUser } from "@clerk/react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { type Game } from "@town-map/contracts";
import { ChevronsUpDown, LogOut, SlidersHorizontal, User } from "lucide-react";
import { Link } from "react-router-dom";
import { GameIcon } from "./GameIcon";
import { type GameCatalog } from "./games";
import { type AppAuth, type Tab } from "./town-map-model";

export function SignedInUserFooter({ setTab }: { setTab: (tab: Tab) => void }) {
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
          <DropdownMenuItem asChild>
            <Link to="/preferences" className="cursor-pointer">
              <SlidersHorizontal className="mr-2 size-4" />
              App preferences
            </Link>
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

export function UserFooterMenu({ auth, setTab }: { auth: AppAuth; setTab: (tab: Tab) => void }) {
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

export function AccountSettingsCard() {
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

const SAVED_SECTIONS = [
  { key: "upcoming", heading: "Upcoming" },
  { key: "past", heading: "Past" },
] as const;

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

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(date.getDate() + days);
  return next;
}

const DATE_WINDOW_DAYS: Record<"today" | "3days" | "week" | "month", number> = {
  today: 1,
  "3days": 3,
  week: 7,
  month: 30,
};

function matchesDate(event: EventListItem, filter: DateFilter) {
  if (filter === "all") return true;
  const eventDate = new Date(event.startsAt);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (filter === "tomorrow") {
    const startOfTomorrow = addDays(startOfToday, 1);
    return eventDate >= startOfTomorrow && eventDate < addDays(startOfTomorrow, 1);
  }
  return eventDate >= startOfToday && eventDate < addDays(startOfToday, DATE_WINDOW_DAYS[filter]);
}

function matchesPrice(event: EventListItem, filter: PriceFilter) {
  if (filter === "all") return true;
  if (event.priceAmount === null) return false;
  if (filter === "free") return event.priceAmount === 0;
  if (filter === "under10") return event.priceAmount < 10;
  return event.priceAmount < 25;
}

function initialNumber(name: string, fallback: number) {
  const rawValue = initialParams.get(name);
  if (rawValue === null || rawValue.trim() === "") return fallback;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : fallback;
}

export function GamePreferencePicker({ value, onChange, catalog }: { value: Game[]; onChange: (games: Game[]) => void; catalog: GameCatalog }) {
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

export function LoadingCards() {
  return (
    <div role="status" aria-label="Finding nearby events" className="divide-y border-y">
      <span className="sr-only">Finding nearby events…</span>
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} aria-hidden="true" className="h-16 animate-pulse bg-muted/35" />
      ))}
    </div>
  );
}
