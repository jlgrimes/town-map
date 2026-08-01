import type { EventListItem, Game } from "@town-map/contracts";
import L, { type LayerGroup, type Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

const GAME_COLORS: Record<Game, string> = {
  pokemon: "#eab308",
  magic: "#ef4444",
  yugioh: "#6366f1",
};

const GAME_INITIALS: Record<Game, string> = {
  pokemon: "P",
  magic: "M",
  yugioh: "Y",
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
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: true,
      scrollWheelZoom: false,
    }).setView([center.latitude, center.longitude], 10);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(map);

    mapRef.current = map;
    markersRef.current = L.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = null;
    };
  }, []);

  useEffect(() => {
    mapRef.current?.setView([center.latitude, center.longitude], mapRef.current.getZoom());
  }, [center.latitude, center.longitude]);

  useEffect(() => {
    const layer = markersRef.current;
    if (!layer) return;
    layer.clearLayers();

    for (const event of events) {
      const latitude = event.venue?.latitude;
      const longitude = event.venue?.longitude;
      if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) continue;

      const selected = event.id === selectedEventId;
      const marker = L.marker([latitude, longitude], {
        icon: L.divIcon({
          className: "town-map-marker-wrap",
          html: `<span aria-hidden="true" class="town-map-marker${selected ? " is-selected" : ""}" style="--marker-color:${GAME_COLORS[event.game]}">${GAME_INITIALS[event.game]}</span>`,
          iconSize: selected ? [38, 38] : [30, 30],
          iconAnchor: selected ? [19, 19] : [15, 15],
        }),
        keyboard: true,
        title: event.title,
      });

      const tooltip = document.createElement("span");
      tooltip.textContent = event.title;
      marker.bindTooltip(tooltip, { direction: "top", offset: [0, -12] });
      marker.on("click", () => onSelect(event.id));
      marker.addTo(layer);
      marker.getElement()?.setAttribute("aria-label", `Show ${event.title} in the event list`);
    }
  }, [events, onSelect, selectedEventId]);

  useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(() => mapRef.current?.invalidateSize());
    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  return (
    <div className="relative h-full min-h-[28rem] overflow-hidden rounded-2xl border bg-muted/40">
      <div
        ref={containerRef}
        className="absolute inset-0"
        role="region"
        aria-label={`Map showing ${events.length} events near the selected location`}
      />
      <div className="pointer-events-none absolute top-3 right-3 z-[500] max-w-[calc(100%-4.5rem)] rounded-lg border bg-background/95 px-3 py-2 text-xs shadow-sm backdrop-blur">
        <span className="font-semibold">Map view</span>
        <span className="ml-1.5 text-muted-foreground">Select a pin to highlight its event.</span>
      </div>
    </div>
  );
}
