import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { EventListItem } from "@town-map/contracts";
import {
  ArrowLeft,
  Building2,
  Calendar,
  ExternalLink,
  Globe,
  MapPin,
  Share2,
  Sparkles,
  Check,
  Search,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Typography } from "@/components/ui/typography";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ExpandableEventCardModal } from "@/components/ui/expandable-card";
import { DotBackground } from "@/components/ui/dot-background";
import { EventRow, eventMetadata, formatPrice } from "@/components/ui/event-row";
import { useShopEvents } from "@/hooks/useShopEvents";
import { GameIcon } from "../../GameIcon";
import { ShopStaticMap } from "./ShopStaticMap";
import { type GameCatalog } from "../../games";
import { matchesShopSlug, slugifyShop, type ShopInfo } from "../../lib/shop-utils";

interface ShopDetailPageProps {
  events: EventListItem[];
  savedEventIds: Set<string>;
  onToggleSave: (eventId: string) => void;
  catalog: GameCatalog;
}

export function ShopDetailPage({
  events: initialEvents,
  savedEventIds,
  onToggleSave,
  catalog,
}: ShopDetailPageProps) {
  const { shopSlug } = useParams<{ shopSlug: string }>();
  const navigate = useNavigate();

  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // Derive initial matching events from prop
  const localShopEvents = useMemo(() => {
    if (!shopSlug) return [];
    return initialEvents.filter((evt: EventListItem) => {
      if (!evt.venue || !evt.venue.name) return false;
      return matchesShopSlug(evt.venue.name, evt.venue.city, shopSlug);
    });
  }, [initialEvents, shopSlug]);

  // Extract venue/shop details from available events
  const shopInfo = useMemo<ShopInfo | null>(() => {
    const firstEvent = localShopEvents[0];
    if (firstEvent && firstEvent.venue && firstEvent.venue.name) {
      const v = firstEvent.venue;
      return {
        id: shopSlug ?? slugifyShop(v.name, v.city),
        slug: shopSlug ?? slugifyShop(v.name, v.city),
        name: v.name,
        address: v.address ?? null,
        city: v.city ?? null,
        region: v.region ?? null,
        postalCode: v.postalCode ?? null,
        latitude: v.latitude ?? null,
        longitude: v.longitude ?? null,
        website: v.website ?? null,
      };
    }

    for (const evt of initialEvents) {
      if (evt.venue?.name && matchesShopSlug(evt.venue.name, evt.venue.city, shopSlug || "")) {
        const v = evt.venue;
        return {
          id: shopSlug || "",
          slug: shopSlug || "",
          name: v.name,
          address: v.address ?? null,
          city: v.city ?? null,
          region: v.region ?? null,
          postalCode: v.postalCode ?? null,
          latitude: v.latitude ?? null,
          longitude: v.longitude ?? null,
          website: v.website ?? null,
        };
      }
    }

    return null;
  }, [localShopEvents, initialEvents, shopSlug]);

  const queryTerm = shopInfo?.name ?? shopSlug?.replace(/-/g, " ") ?? "";
  const { events: fetchedEvents, isLoading: isLoadingBackend } = useShopEvents(queryTerm);

  // Combined shop events: SWR fetched events take priority once loaded, fallback to local
  const shopEvents = useMemo(() => {
    if (fetchedEvents && fetchedEvents.length > 0) {
      return fetchedEvents.filter((evt: EventListItem) => {
        if (!evt.venue || !evt.venue.name) return false;
        return matchesShopSlug(evt.venue.name, evt.venue.city, shopSlug || "");
      });
    }
    return localShopEvents;
  }, [fetchedEvents, localShopEvents, shopSlug]);

  // Filter shop events by text search query
  const filteredEvents = useMemo(() => {
    if (!searchQuery.trim()) return shopEvents;
    const query = searchQuery.toLowerCase();
    return shopEvents.filter(
      (evt: EventListItem) =>
        evt.title.toLowerCase().includes(query) ||
        evt.game.toLowerCase().includes(query) ||
        (evt.format && evt.format.toLowerCase().includes(query))
    );
  }, [shopEvents, searchQuery]);

  const handleShare = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Active event for expanded detail modal
  const activeEvent = useMemo(
    () => shopEvents.find((evt: EventListItem) => evt.id === selectedEventId) ?? null,
    [shopEvents, selectedEventId]
  );

  const shopName = shopInfo?.name || shopSlug?.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) || "Shop";
  const locationLabel = [shopInfo?.address, shopInfo?.city, shopInfo?.region].filter(Boolean).join(", ");

  const gamesFeatured = useMemo(() => {
    const set = new Set<string>();
    shopEvents.forEach((evt: EventListItem) => set.add(evt.game));
    return Array.from(set);
  }, [shopEvents]);

  return (
    <DotBackground className="min-h-screen bg-background pb-12">
      {/* Header Bar */}
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/")}
            className="gap-2 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to Discover</span>
          </Button>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleShare} className="gap-2">
              {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Share2 className="h-4 w-4" />}
              <span className="hidden sm:inline">{copied ? "Copied Link!" : "Share Shop"}</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
        {/* Shop Hero Card */}
        <div className="relative overflow-hidden rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="gap-1.5 px-2.5 py-1 text-xs font-semibold">
                  <Building2 className="h-3.5 w-3.5 text-primary" />
                  Local Game Store
                </Badge>
                {shopInfo?.city && (
                  <Badge variant="outline" className="gap-1 text-xs">
                    <MapPin className="h-3 w-3 text-muted-foreground" />
                    {shopInfo.city}
                  </Badge>
                )}
              </div>

              <Typography variant="h1" className="text-2xl font-extrabold tracking-tight sm:text-4xl">
                {shopName}
              </Typography>

              {locationLabel && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4 shrink-0 text-primary" />
                  <span>{locationLabel}</span>
                </p>
              )}

              {/* Game Chips */}
              {gamesFeatured.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <span className="text-xs font-medium text-muted-foreground">Games Hosted:</span>
                  {gamesFeatured.map((game) => (
                    <div
                      key={game}
                      className="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-2.5 py-0.5 text-xs font-medium"
                    >
                      <GameIcon game={game} className="h-3.5 w-3.5" />
                      <span className="capitalize">{catalog.label(game)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Action Links */}
            <div className="flex flex-wrap items-center gap-3 md:flex-col md:items-end">
              {shopInfo?.website && (
                <Button asChild variant="default" size="sm" className="gap-2">
                  <a href={shopInfo.website} target="_blank" rel="noopener noreferrer">
                    <Globe className="h-4 w-4" />
                    <span>Visit Website</span>
                    <ExternalLink className="h-3.5 w-3.5 opacity-70" />
                  </a>
                </Button>
              )}

              {shopInfo?.latitude && shopInfo?.longitude && (
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="gap-2 text-xs"
                >
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${shopInfo.latitude},${shopInfo.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MapPin className="h-3.5 w-3.5 text-primary" />
                    <span>Get Directions</span>
                  </a>
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Grid: Map & Events List */}
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* Left Column: Non-interactive Static Map View */}
          <div className="space-y-4 lg:col-span-5">
            <div className="flex items-center justify-between">
              <Typography variant="h3" className="flex items-center gap-2 text-lg font-bold">
                <MapPin className="h-5 w-5 text-primary" />
                Shop Location
              </Typography>
            </div>

            <div className="h-[300px] w-full overflow-hidden rounded-xl border bg-card shadow-sm sm:h-[380px]">
              {shopInfo?.latitude && shopInfo?.longitude ? (
                <ShopStaticMap
                  latitude={shopInfo.latitude}
                  longitude={shopInfo.longitude}
                  shopName={shopName}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center p-6 text-center bg-muted/20">
                  <MapPin className="h-10 w-10 text-muted-foreground/50 mb-2" />
                  <p className="text-sm font-medium">Location coordinates unavailable</p>
                  <p className="text-xs text-muted-foreground mt-1">{locationLabel || "Address details not listed"}</p>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Events List */}
          <div className="space-y-4 lg:col-span-7">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <Typography variant="h3" className="flex items-center gap-2 text-lg font-bold">
                  <Calendar className="h-5 w-5 text-primary" />
                  Upcoming Activities ({shopEvents.length})
                </Typography>
              </div>

              {shopEvents.length > 3 && (
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="search"
                    placeholder="Filter events..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 text-xs"
                  />
                </div>
              )}
            </div>

            {isLoadingBackend && shopEvents.length === 0 ? (
              <div className="rounded-xl border bg-card p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                <span>Loading shop events from database...</span>
              </div>
            ) : filteredEvents.length === 0 ? (
              <div className="rounded-xl border bg-card p-8">
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia>
                      <Sparkles className="h-10 w-10 text-muted-foreground/60" />
                    </EmptyMedia>
                    <EmptyTitle>No events found</EmptyTitle>
                    <EmptyDescription>
                      {searchQuery
                        ? `No events match "${searchQuery}" at this shop.`
                        : "There are currently no scheduled events listed for this shop."}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </div>
            ) : (
              <div className="divide-y rounded-2xl border bg-card p-1 shadow-xs">
                {filteredEvents.map((evt) => (
                  <EventRow
                    key={evt.id}
                    event={evt}
                    saved={savedEventIds.has(evt.id)}
                    canSave={true}
                    showLocation={false}
                    layoutIdPrefix="shop"
                    onSelect={(id) => setSelectedEventId(id)}
                    onToggleSave={onToggleSave}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Expandable Event Detail Modal */}
      <ExpandableEventCardModal
        event={activeEvent}
        onClose={() => setSelectedEventId(null)}
        saved={activeEvent ? savedEventIds.has(activeEvent.id) : false}
        canSave={true}
        onToggleSave={onToggleSave}
        eventMetadata={eventMetadata}
        formatPrice={formatPrice}
        recurrenceLabel={() => null}
      />
    </DotBackground>
  );
}
