import {
  Map,
  MapControls,
  MapPopup,
  useMap,
  type MapRef,
  type MapViewport,
} from "@/components/ui/map";
import type { EventListItem, Game } from "@town-map/contracts";
import type { GeoJSONSource, MapLayerMouseEvent } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { GameIcon } from "./GameIcon";

const MAP_STYLES = {
  light: "https://tiles.openfreemap.org/styles/bright",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

const GAME_IMAGES: Record<Game, string> = {
  pokemon: "/pokeball.png",
  magic: "/planeswalk.png",
  yugioh: "/blue-eyes.png",
};

const SOURCE_ID = "event-locations";
const CLUSTER_LAYER_ID = "event-clusters";
const CLUSTER_COUNT_LAYER_ID = "event-cluster-count";
const ACTIVE_POINT_LAYER_ID = "active-event-point";
const POINT_LAYER_ID = "event-points";

type EventPointProperties = {
  id: string;
  title: string;
  game: Game;
  active: boolean;
};

function EventClusterLayer({
  data,
  onSelect,
  onPreview,
}: {
  data: GeoJSON.FeatureCollection<GeoJSON.Point, EventPointProperties>;
  onSelect: (eventId: string) => void;
  onPreview: (eventId: string | null) => void;
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
      for (const [game, imageUrl] of Object.entries(GAME_IMAGES) as Array<[Game, string]>) {
        const imageId = `event-${game}`;
        if (mapInstance.hasImage(imageId)) continue;
        const image = await mapInstance.loadImage(imageUrl);
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
          "circle-radius": 20,
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 2,
          "circle-opacity": 0.88,
        },
      });
      mapInstance.addLayer({
        id: POINT_LAYER_ID,
        type: "symbol",
        source: SOURCE_ID,
        filter: ["!", ["has", "point_count"]],
        layout: {
          "icon-image": [
            "match",
            ["get", "game"],
            "pokemon", "event-pokemon",
            "magic", "event-magic",
            "yugioh", "event-yugioh",
            "event-pokemon",
          ],
          "icon-size": 1,
          "icon-allow-overlap": true,
        },
      });
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
      const eventId = event.features?.[0]?.properties?.id as string | undefined;
      if (eventId) onSelectRef.current(eventId);
    };
    const handlePointEnter = (event: MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = "pointer";
      const eventId = event.features?.[0]?.properties?.id as string | undefined;
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
    map.on("click", POINT_LAYER_ID, handlePointClick);
    map.on("mouseenter", POINT_LAYER_ID, handlePointEnter);
    map.on("mouseleave", POINT_LAYER_ID, handlePointLeave);
    map.on("mouseenter", CLUSTER_LAYER_ID, handleClusterEnter);
    map.on("mouseleave", CLUSTER_LAYER_ID, handleClusterLeave);

    return () => {
      cancelled = true;
      map.off("click", CLUSTER_LAYER_ID, handleClusterClick);
      map.off("click", POINT_LAYER_ID, handlePointClick);
      map.off("mouseenter", POINT_LAYER_ID, handlePointEnter);
      map.off("mouseleave", POINT_LAYER_ID, handlePointLeave);
      map.off("mouseenter", CLUSTER_LAYER_ID, handleClusterEnter);
      map.off("mouseleave", CLUSTER_LAYER_ID, handleClusterLeave);
      for (const layerId of [POINT_LAYER_ID, ACTIVE_POINT_LAYER_ID, CLUSTER_COUNT_LAYER_ID, CLUSTER_LAYER_ID]) {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
      }
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
  }, [isLoaded, map]);

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
}: {
  center: { latitude: number; longitude: number };
  events: EventListItem[];
  active: boolean;
  activeEventId: string | null;
  selectedEventId: string | null;
  onSelect: (eventId: string) => void;
  onPreview: (eventId: string | null) => void;
  onDeselect: () => void;
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

  const pointData = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point, EventPointProperties>>(() => ({
    type: "FeatureCollection",
    features: events.flatMap((event) => {
      const latitude = event.venue?.latitude;
      const longitude = event.venue?.longitude;
      if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) return [];
      return [{
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [longitude, latitude] },
        properties: {
          id: event.id,
          title: event.title,
          game: event.game,
          active: event.id === activeEventId,
        },
      }];
    }),
  }), [activeEventId, events]);

  const selectedEvent = selectedEventId ? events.find((event) => event.id === selectedEventId) ?? null : null;

  useEffect(() => {
    if (!active || selectedEvent?.venue?.latitude == null || selectedEvent.venue.longitude == null) return;
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({
      center: [selectedEvent.venue.longitude, selectedEvent.venue.latitude],
      zoom: Math.max(map.getZoom(), 15),
      duration: 350,
    });
  }, [active, selectedEvent]);

  return (
    <div
      className="relative h-full min-h-[28rem] overflow-hidden border bg-muted/40"
      role="region"
      aria-label={`Map showing ${events.length} events near the selected location`}
    >
      <Map
        ref={mapRef}
        viewport={viewport}
        onViewportChange={setViewport}
        styles={MAP_STYLES}
        cooperativeGestures
        className="h-full min-h-[28rem]"
      >
        <MapControls position="top-left" showZoom />
        <EventClusterLayer data={pointData} onSelect={onSelect} onPreview={onPreview} />
        {selectedEvent?.venue?.latitude != null && selectedEvent.venue.longitude != null && (
          <MapPopup
            longitude={selectedEvent.venue.longitude}
            latitude={selectedEvent.venue.latitude}
            closeButton
            onClose={onDeselect}
          >
            <div className="flex max-w-64 items-start gap-2 pr-5">
              <GameIcon game={selectedEvent.game} className="mt-0.5 size-5 shrink-0 object-contain" decorative />
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-snug">{selectedEvent.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(selectedEvent.startsAt))}
                  {selectedEvent.venue.name ? ` · ${selectedEvent.venue.name}` : ""}
                </p>
              </div>
            </div>
          </MapPopup>
        )}
      </Map>
    </div>
  );
}
