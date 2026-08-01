import { z } from "zod";

export const GameSchema = z.enum(["pokemon", "magic", "yugioh"]);
export type Game = z.infer<typeof GameSchema>;

export const SourceSchema = z.enum([
  "pokedata-events",
  "wotc-locator",
  "konami-kcgn",
  "konami-events",
]);
export type EventSource = z.infer<typeof SourceSchema>;

export const VenueSchema = z.object({
  sourceVenueId: z.string(),
  name: z.string(),
  address: z.string().nullable().default(null),
  city: z.string().nullable().default(null),
  region: z.string().nullable().default(null),
  postalCode: z.string().nullable().default(null),
  country: z.string().nullable().default(null),
  latitude: z.number().nullable().default(null),
  longitude: z.number().nullable().default(null),
  website: z.string().url().nullable().default(null),
  phone: z.string().nullable().default(null),
});
export type NormalizedVenue = z.infer<typeof VenueSchema>;

export const NormalizedEventSchema = z.object({
  sourceEventId: z.string(),
  game: GameSchema,
  title: z.string().min(1),
  description: z.string().nullable().default(null),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().nullable().default(null),
  timezone: z.string().nullable().default(null),
  status: z.string().nullable().default(null),
  format: z.string().nullable().default(null),
  eventType: z.string().nullable().default(null),
  sourceUrl: z.string().url().nullable().default(null),
  registrationUrl: z.string().url().nullable().default(null),
  priceAmount: z.number().nullable().default(null),
  priceCurrency: z.string().nullable().default(null),
  capacity: z.number().int().nullable().default(null),
  isOnline: z.boolean().default(false),
  venue: VenueSchema.nullable().default(null),
  raw: z.unknown(),
});
export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>;

export const EventListItemSchema = z.object({
  id: z.string(),
  source: SourceSchema,
  sourceEventId: z.string(),
  game: GameSchema,
  title: z.string(),
  description: z.string().nullable(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().nullable(),
  timezone: z.string().nullable(),
  status: z.string().nullable(),
  format: z.string().nullable(),
  eventType: z.string().nullable(),
  sourceUrl: z.string().url().nullable(),
  registrationUrl: z.string().url().nullable(),
  priceAmount: z.number().nullable(),
  priceCurrency: z.string().nullable(),
  capacity: z.number().int().nullable(),
  isOnline: z.boolean(),
  distanceMiles: z.number().nullable(),
  venue: VenueSchema.pick({
    name: true,
    address: true,
    city: true,
    region: true,
    postalCode: true,
    latitude: true,
    longitude: true,
    website: true,
  }).nullable(),
});
export type EventListItem = z.infer<typeof EventListItemSchema>;

export const EventQuerySchema = z.object({
  games: z.array(GameSchema).default([]),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  radiusMiles: z.coerce.number().positive().max(500).default(50),
  limit: z.coerce.number().int().positive().max(250).default(100),
  cursor: z.string().max(1024).optional(),
}).refine(
  ({ latitude, longitude }) => (latitude === undefined) === (longitude === undefined),
  { message: "Latitude and longitude must be provided together", path: ["latitude"] },
);
export type EventQuery = z.infer<typeof EventQuerySchema>;

export const EventPageSchema = z.object({
  events: z.array(EventListItemSchema),
  count: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
});
export type EventPage = z.infer<typeof EventPageSchema>;

export const CoverageRegionStatusSchema = z.enum([
  "disabled",
  "pending",
  "running",
  "fresh",
  "stale",
  "failing",
]);
export type CoverageRegionStatus = z.infer<typeof CoverageRegionStatusSchema>;

export const CoverageRegionSchema = z.object({
  source: SourceSchema,
  key: z.string(),
  label: z.string(),
  countryCode: z.string().nullable(),
  enabled: z.boolean(),
  status: CoverageRegionStatusSchema,
  due: z.boolean(),
  cadenceMinutes: z.number().int().positive(),
  nextRunAt: z.string().datetime(),
  lastStartedAt: z.string().datetime().nullable(),
  lastSuccessAt: z.string().datetime().nullable(),
  lastFailureAt: z.string().datetime().nullable(),
});
export type CoverageRegion = z.infer<typeof CoverageRegionSchema>;

export const CoverageSourceSchema = z.object({
  source: SourceSchema,
  totalRegions: z.number().int().nonnegative(),
  enabledRegions: z.number().int().nonnegative(),
  freshRegions: z.number().int().nonnegative(),
  pendingRegions: z.number().int().nonnegative(),
  staleRegions: z.number().int().nonnegative(),
  failingRegions: z.number().int().nonnegative(),
  runningRegions: z.number().int().nonnegative(),
  upcomingEvents: z.number().int().nonnegative(),
  latestSuccessAt: z.string().datetime().nullable(),
});
export type CoverageSource = z.infer<typeof CoverageSourceSchema>;

export const CoverageResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  sources: z.array(CoverageSourceSchema),
  regions: z.array(CoverageRegionSchema),
});
export type CoverageResponse = z.infer<typeof CoverageResponseSchema>;

export const GAME_LABELS: Record<Game, string> = {
  pokemon: "Pokémon",
  magic: "Magic",
  yugioh: "Yu-Gi-Oh!",
};
