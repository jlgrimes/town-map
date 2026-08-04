import { useEffect, useRef } from "react";
import { Map, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

interface ShopStaticMapProps {
  latitude: number;
  longitude: number;
  shopName: string;
}

export function ShopStaticMap({ latitude, longitude, shopName }: ShopStaticMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const isDark = document.documentElement.classList.contains("dark");
    const styleUrl = isDark
      ? "https://tiles.openfreemap.org/styles/dark"
      : "https://tiles.openfreemap.org/styles/bright";

    const map = new Map({
      container: containerRef.current,
      style: styleUrl,
      center: [longitude, latitude],
      zoom: 14.5,
      interactive: false, // Disables drag, scroll zoom, rotation
      attributionControl: false,
    });

    // Create custom pin element
    const el = document.createElement("div");
    el.style.cssText = "position: relative; display: flex; flex-direction: column; align-items: center; transform: translate(0, -50%); pointer-events: none;";
    el.innerHTML = `
      <div style="background: rgba(15, 23, 42, 0.9); backdrop-filter: blur(8px); color: #ffffff; padding: 4px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; white-space: nowrap; box-shadow: 0 4px 14px rgba(0,0,0,0.25); margin-bottom: 6px; border: 1px solid rgba(255,255,255,0.15); letter-spacing: -0.01em;">
        ${escapeHtml(shopName)}
      </div>
      <div style="background-color: #3b82f6; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(59, 130, 246, 0.5); border: 2.5px solid white;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path>
          <circle cx="12" cy="10" r="3"></circle>
        </svg>
      </div>
    `;

    new Marker({ element: el })
      .setLngLat([longitude, latitude])
      .addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
    };
  }, [latitude, longitude, shopName]);

  return <div ref={containerRef} className="h-full w-full" />;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.innerText = text;
  return div.innerHTML;
}
