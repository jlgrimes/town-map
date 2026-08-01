import {
  Map,
  MapControls,
  MapMarker,
  MarkerContent,
  MarkerTooltip,
  type MapRef,
  type MapViewport,
} from "@/components/ui/map";
import type { EventListItem, Game } from "@town-map/contracts";
import { useEffect, useRef, useState } from "react";

const GAME_INITIALS: Record<Game, string> = {
  pokemon: "P",
  magic: "M",
  yugioh: "Y",
};

const MAP_STYLES = {
  light: "https://tiles.openfreemap.org/styles/bright",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

export function EventMap({
  center,
  events,
  active,
  selectedEventId,
  onSelect,
}: {
  center: { latitude: number; longitude: number };
  events: EventListItem[];
  active: boolean;
  selectedEventId: string | null;
  onSelect: (eventId: string) => void;
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
    }));
  }, [center.latitude, center.longitude]);

  useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(() => mapRef.current?.resize());
    return () => window.cancelAnimationFrame(frame);
  }, [active]);

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
        {events.map((event) => {
          const latitude = event.venue?.latitude;
          const longitude = event.venue?.longitude;
          if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) return null;

          const selected = event.id === selectedEventId;
          return (
            <MapMarker
              key={event.id}
              longitude={longitude}
              latitude={latitude}
              onClick={() => onSelect(event.id)}
            >
              <MarkerContent>
                <button
                  type="button"
                  aria-label={`Show ${event.title} in the event list`}
                  className={`grid size-8 cursor-pointer place-items-center rounded-full border-2 border-white bg-primary text-xs font-bold text-primary-foreground shadow-md transition-transform hover:scale-110 ${selected ? "scale-125 ring-4 ring-primary/30" : ""}`}
                >
                  {GAME_INITIALS[event.game]}
                </button>
              </MarkerContent>
              <MarkerTooltip>{event.title}</MarkerTooltip>
            </MapMarker>
          );
        })}
      </Map>
    </div>
  );
}
