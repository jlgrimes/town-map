import type { EventListItem } from "@town-map/contracts";

export interface ShopInfo {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  website: string | null;
}

/**
 * Converts a shop/venue name (and optional city) into a clean URL slug.
 * e.g., "Guardian Games", "Portland" => "guardian-games-portland"
 */
export function slugifyShop(name: string, city?: string | null): string {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!city) return base;

  const citySlug = city
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  // Avoid duplicating if city is already in the name
  if (base.includes(citySlug)) return base;
  return `${base}-${citySlug}`;
}

/**
 * Extracts normalized shop details from an EventListItem's venue field.
 */
export function extractShopFromEvent(event: EventListItem): ShopInfo | null {
  if (!event.venue || !event.venue.name) return null;

  const { name, address, city, region, postalCode, latitude, longitude, website } = event.venue;
  const slug = slugifyShop(name, city);

  return {
    id: slug,
    slug,
    name,
    address,
    city,
    region,
    postalCode,
    latitude,
    longitude,
    website,
  };
}

/**
 * Normalizes a slug or search term for fuzzy comparison against shop names.
 */
export function matchesShopSlug(eventVenueName: string, eventCity: string | null | undefined, slug: string): boolean {
  const generatedSlug = slugifyShop(eventVenueName, eventCity);
  if (generatedSlug === slug) return true;

  // Also check without city fallback
  const nameOnlySlug = slugifyShop(eventVenueName);
  if (nameOnlySlug === slug) return true;

  // Fuzzy check: slugified query contains or matches
  const target = slug.toLowerCase().replace(/-/g, " ");
  const name = eventVenueName.toLowerCase();
  return name.includes(target) || target.includes(name);
}
