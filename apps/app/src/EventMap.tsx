import {
  Map,
  MapControls,
  useMap,
  type MapRef,
  type MapViewport,
} from "@/components/ui/map";
import { type EventListItem, type Game } from "@town-map/contracts";
import { X } from "lucide-react";
import type { ExpressionSpecification, GeoJSONSource, MapLayerMouseEvent } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { GameIcon } from "./GameIcon";
import { gameMarkerUrl, type GameCatalog } from "./games";

const MAP_STYLES = {
  light: "https://tiles.openfreemap.org/styles/bright",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

const SOURCE_ID = "event-locations";
const CLUSTER_LAYER_ID = "event-clusters";
const CLUSTER_COUNT_LAYER_ID = "event-cluster-count";
const ACTIVE_POINT_LAYER_ID = "active-event-point";
const POINT_LAYER_PREFIX = "event-points-";

function pointLayerId(game: Game) {
  return `${POINT_LAYER_PREFIX}${game}`;
}

type EventPointProperties = {
  id: string;
  eventId: string;
  gameCount: number;
  active: boolean;
  [key: string]: string | number | boolean;
};

type StoreGroup = {
  id: string;
  name: string;
  location: string;
  mapsQuery: string;
  latitude: number;
  longitude: number;
  events: EventListItem[];
  games: Game[];
};

function markerOffsetExpression(game: Game, gameOrder: Game[]): ExpressionSpecification {
  const precedingGames = gameOrder.slice(0, gameOrder.indexOf(game));
  const precedingRanks = precedingGames.map((precedingGame): ExpressionSpecification => [
      "case",
      ["==", ["get", `has_${precedingGame}`], true],
      1,
      0,
    ]);
  const rank: number | ExpressionSpecification = precedingRanks.length === 0
    ? 0
    : precedingRanks.length === 1
      ? precedingRanks[0]
      : ["+", ...precedingRanks];
  const expression: unknown[] = ["case"];
  for (let gameCount = 1; gameCount <= gameOrder.length; gameCount += 1) {
    for (let gameRank = 0; gameRank < gameCount; gameRank += 1) {
      expression.push(
        ["all", ["==", ["get", "gameCount"], gameCount], ["==", rank, gameRank]],
        ["literal", [(gameRank - (gameCount - 1) / 2) * 32, 0]],
      );
    }
  }
  expression.push(["literal", [0, 0]]);
  return expression as ExpressionSpecification;
}

function storeKey(event: EventListItem) {
  const venue = event.venue;
  if (!venue) return "";
  const name = venue.name.trim().toLowerCase();
  const coordinates = `${venue.latitude?.toFixed(4)}|${venue.longitude?.toFixed(4)}`;
  return `${name}|${coordinates}`;
}

function groupEventsByStore(events: EventListItem[], gameOrder: Game[]) {
  const stores = new globalThis.Map<string, StoreGroup>();
  for (const event of events) {
    const venue = event.venue;
    if (venue?.latitude == null || venue.longitude == null) continue;
    const id = storeKey(event);
    const existing = stores.get(id);
    if (existing) {
      existing.events.push(event);
      continue;
    }
    stores.set(id, {
      id,
      name: venue.name,
      location: [venue.city, venue.region].filter(Boolean).join(", "),
      mapsQuery: [venue.name, venue.address, venue.city, venue.region, venue.postalCode].filter(Boolean).join(", "),
      latitude: venue.latitude,
      longitude: venue.longitude,
      events: [event],
      games: [event.game],
    });
  }

  return [...stores.values()].map((store) => {
    store.events.sort((a, b) => {
      const gameDifference = gameOrder.indexOf(a.game) - gameOrder.indexOf(b.game);
      return gameDifference || new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
    });
    store.games = gameOrder.filter((game) => store.events.some((event) => event.game === game));
    return store;
  });
}

function StoreSchedule({
  store,
  onClose,
  catalog,
  onSelect,
}: {
  store: StoreGroup;
  onClose: () => void;
  catalog: GameCatalog;
  onSelect: (eventId: string) => void;
}) {
  return (
    <aside
      aria-label={`${store.name} events`}
      className="overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg"
    >
      <div className="relative border-b px-3 py-2.5 pr-11">
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(store.mapsQuery)}`}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-semibold leading-snug underline-offset-4 hover:underline"
        >
          {store.name}
        </a>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {store.location ? `${store.location} · ` : ""}{store.events.length} {store.events.length === 1 ? "event" : "events"}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close store events"
          className="absolute top-2 right-2 grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="max-h-[min(22rem,42svh)] overflow-y-auto overscroll-contain px-3">
        {catalog.ids.map((game) => {
          const gameEvents = store.events.filter((event) => event.game === game);
          if (gameEvents.length === 0) return null;
          return (
            <section key={game} className="py-2 first:pt-2 last:pb-0" aria-label={`${catalog.label(game)} events`}>
              <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <GameIcon game={game} className="size-4 shrink-0 object-contain" decorative />
                <span>{catalog.label(game)}</span>
              </div>
              <ol className="divide-y">
                {gameEvents.map((event) => (
                  <li
                    key={event.id}
                    className="py-2 first:pt-0 cursor-pointer hover:bg-muted/40 rounded px-1 transition-colors"
                    onClick={() => onSelect(event.id)}
                  >
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {new Intl.DateTimeFormat(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      }).format(new Date(event.startsAt))}
                    </p>
                    <p className="mt-0.5 text-sm font-medium leading-snug">{event.title}</p>
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </aside>
  );
}

function EventClusterLayer({
  data,
  onSelect,
  onPreview,
  gameOrder,
}: {
  data: GeoJSON.FeatureCollection<GeoJSON.Point, EventPointProperties>;
  onSelect: (eventId: string) => void;
  onPreview: (eventId: string | null) => void;
  gameOrder: Game[];
}) {
  const { map, isLoaded } = useMap();
  const dataRef = useRef(data);
  const onSelectRef = useRef(onSelect);
  const onPreviewRef = useRef(onPreview);
  dataRef.current = data;
  onSelectRef.current = onSelect;
  onPreviewRef.current = onPreview;

  useEffect(() => {
    if (!isLoaded || !map) return;
    const mapInstance = map;
    let cancelled = false;

    async function addEventLayers() {
      for (const game of gameOrder) {
        const imageId = `event-${game}`;
        if (mapInstance.hasImage(imageId)) continue;
        const image = await mapInstance.loadImage(gameMarkerUrl(game));
        if (cancelled) return;
        if (!mapInstance.hasImage(imageId)) mapInstance.addImage(imageId, image.data, { pixelRatio: 8 });
      }
      if (cancelled || mapInstance.getSource(SOURCE_ID)) return;

      mapInstance.addSource(SOURCE_ID, {
        type: "geojson",
        data: dataRef.current,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 48,
      });
      mapInstance.addLayer({
        id: CLUSTER_LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": ["step", ["get", "point_count"], "#fbbf24", 10, "#f59e0b", 50, "#d97706"],
          "circle-radius": ["step", ["get", "point_count"], 18, 10, 23, 50, 29],
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 2,
          "circle-opacity": 0.92,
        },
      });
      mapInstance.addLayer({
        id: CLUSTER_COUNT_LAYER_ID,
        type: "symbol",
        source: SOURCE_ID,
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Noto Sans Bold"],
          "text-size": 12,
        },
        paint: { "text-color": "#422006" },
      });
      mapInstance.addLayer({
        id: ACTIVE_POINT_LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "active"], true]],
        paint: {
          "circle-color": "#f59e0b",
          "circle-radius": ["interpolate", ["linear"], ["get", "gameCount"], 1, 20, 5, 80],
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 2,
          "circle-opacity": 0.88,
        },
      });
      for (const game of gameOrder) {
        mapInstance.addLayer({
          id: pointLayerId(game),
          type: "symbol",
          source: SOURCE_ID,
          filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", `has_${game}`], true]],
          layout: {
            "icon-image": `event-${game}`,
            "icon-size": 1,
            "icon-offset": markerOffsetExpression(game, gameOrder),
            "icon-allow-overlap": true,
          },
        });
      }
    }

    void addEventLayers().catch((error: unknown) => {
      console.error("Could not render event markers", error);
    });

    const handleClusterClick = async (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      const clusterId = feature?.properties?.cluster_id as number | undefined;
      if (!feature || clusterId === undefined) return;
      const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
      const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
      if (!source) return;
      const zoom = await source.getClusterExpansionZoom(clusterId);
      map.easeTo({ center: coordinates, zoom });
    };
    const handlePointClick = (event: MapLayerMouseEvent) => {
      const eventId = event.features?.[0]?.properties?.eventId as string | undefined;
      if (eventId) onSelectRef.current(eventId);
    };
    const handlePointEnter = (event: MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = "pointer";
      const eventId = event.features?.[0]?.properties?.eventId as string | undefined;
      onPreviewRef.current(eventId ?? null);
    };
    const handlePointLeave = () => {
      map.getCanvas().style.cursor = "";
      onPreviewRef.current(null);
    };
    const handleClusterEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const handleClusterLeave = () => {
      map.getCanvas().style.cursor = "";
    };

    map.on("click", CLUSTER_LAYER_ID, handleClusterClick);
    const pointLayerIds = gameOrder.map(pointLayerId);
    for (const layerId of pointLayerIds) {
      map.on("click", layerId, handlePointClick);
      map.on("mouseenter", layerId, handlePointEnter);
      map.on("mouseleave", layerId, handlePointLeave);
    }
    map.on("mouseenter", CLUSTER_LAYER_ID, handleClusterEnter);
    map.on("mouseleave", CLUSTER_LAYER_ID, handleClusterLeave);

    return () => {
      cancelled = true;
      map.off("click", CLUSTER_LAYER_ID, handleClusterClick);
      for (const layerId of pointLayerIds) {
        map.off("click", layerId, handlePointClick);
        map.off("mouseenter", layerId, handlePointEnter);
        map.off("mouseleave", layerId, handlePointLeave);
      }
      map.off("mouseenter", CLUSTER_LAYER_ID, handleClusterEnter);
      map.off("mouseleave", CLUSTER_LAYER_ID, handleClusterLeave);
      for (const layerId of [...pointLayerIds, ACTIVE_POINT_LAYER_ID, CLUSTER_COUNT_LAYER_ID, CLUSTER_LAYER_ID]) {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
      }
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
  }, [isLoaded, map, gameOrder]);

  useEffect(() => {
    if (!isLoaded || !map) return;
    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(data);
  }, [data, isLoaded, map]);

  return null;
}

export function EventMap({
  center,
  events,
  active,
  activeEventId,
  selectedEventId,
  onSelect,
  onPreview,
  onDeselect,
  catalog,
}: {
  center: { latitude: number; longitude: number };
  events: EventListItem[];
  active: boolean;
  activeEventId: string | null;
  selectedEventId: string | null;
  onSelect: (eventId: string) => void;
  onPreview: (eventId: string | null) => void;
  onDeselect: () => void;
  catalog: GameCatalog;
}) {
  const mapRef = useRef<MapRef>(null);
  const [viewport, setViewport] = useState<MapViewport>({
    center: [center.longitude, center.latitude],
    zoom: 10,
    bearing: 0,
    pitch: 0,
  });

  useEffect(() => {
    setViewport((current) => ({
      ...current,
      center: [center.longitude, center.latitude],
      zoom: 10,
    }));
  }, [center.latitude, center.longitude]);

  useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(() => mapRef.current?.resize());
    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  const gameOrder = catalog.ids;
  const stores = useMemo(() => groupEventsByStore(events, gameOrder), [events, gameOrder]);
  const pointData = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point, EventPointProperties>>(() => ({
    type: "FeatureCollection",
    features: stores.map((store) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [store.longitude, store.latitude] },
      properties: {
        id: store.id,
        eventId: store.events[0].id,
        gameCount: store.games.length,
        active: store.events.some((event) => event.id === activeEventId),
        ...Object.fromEntries(gameOrder.map((game) => [`has_${game}`, store.games.includes(game)])),
      },
    })),
  }), [activeEventId, stores, gameOrder]);

  const selectedStore = selectedEventId
    ? stores.find((store) => store.events.some((event) => event.id === selectedEventId)) ?? null
    : null;

  useEffect(() => {
    if (!active || !selectedStore) return;
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({
      center: [selectedStore.longitude, selectedStore.latitude],
      zoom: Math.max(map.getZoom(), 15),
      duration: 350,
    });
  }, [active, selectedStore]);

  return (
    <div
      className="relative h-full min-h-0 overflow-hidden border bg-muted/40"
      role="region"
      aria-label={`Map showing ${stores.length} stores with ${events.length} events near the selected location`}
    >
      <Map
        ref={mapRef}
        viewport={viewport}
        onViewportChange={setViewport}
        styles={MAP_STYLES}
        cooperativeGestures
        className="h-full min-h-0"
      >
        <MapControls position="top-left" showZoom />
        <EventClusterLayer data={pointData} onSelect={onSelect} onPreview={onPreview} gameOrder={gameOrder} />
      </Map>
      {selectedStore && (
        <div className="absolute right-2 bottom-12 left-2 z-10 sm:right-3 sm:left-auto sm:w-80">
          <StoreSchedule store={selectedStore} onClose={onDeselect} catalog={catalog} onSelect={onSelect} />
        </div>
      )}
    </div>
  );
}
