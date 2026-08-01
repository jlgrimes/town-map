import {
  Map,
  MapControls,
  MapMarker,
  MarkerContent,
  MarkerTooltip,
  type MapRef,
  type MapViewport,
} from "@/components/ui/map";
import type { EventListItem } from "@town-map/contracts";
import { useEffect, useRef, useState } from "react";
import { GameIcon } from "./GameIcon";

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
                  className={`grid size-10 cursor-pointer place-items-center rounded-lg border border-border bg-background/95 p-1 shadow-md transition-transform hover:scale-110 ${selected ? "scale-125 ring-4 ring-primary/30" : ""}`}
                >
                  <GameIcon game={event.game} className="size-7 object-contain" decorative />
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
