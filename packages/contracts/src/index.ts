import { z } from "zod";

/**
 * Games, categories and sources are rows in PostgreSQL, not a closed set in
 * code, so that adding an event type is a data change rather than an edit to a
 * zod enum, a CHECK constraint and a label map in lockstep.
 *
 * These schemas therefore validate the *shape* of a slug. Whether a given slug
 * exists is checked against the registry the API serves from the database.
 */
const SlugSchema = z.string().trim().min(1).max(64).regex(
  /^[a-z0-9][a-z0-9-]*$/,
  "Slugs are lowercase alphanumeric words separated by hyphens",
);

export const GameSchema = SlugSchema;
export type Game = z.infer<typeof GameSchema>;

export const CategorySchema = SlugSchema;
export type Category = z.infer<typeof CategorySchema>;

export const SourceSchema = SlugSchema;
export type EventSource = z.infer<typeof SourceSchema>;

export const CategoryDefinitionSchema = z.object({
  id: CategorySchema,
  label: z.string().min(1),
});
export type CategoryDefinition = z.infer<typeof CategoryDefinitionSchema>;

export const GameDefinitionSchema = z.object({
  id: GameSchema,
  label: z.string().min(1),
  category: CategorySchema,
});
export type GameDefinition = z.infer<typeof GameDefinitionSchema>;

/** Response of `GET /v1/games`, ordered for display by the server. */
export const GameRegistrySchema = z.object({
  games: z.array(GameDefinitionSchema),
  categories: z.array(CategoryDefinitionSchema),
});
export type GameRegistry = z.infer<typeof GameRegistrySchema>;

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
  website: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
});
export type NormalizedVenue = z.infer<typeof VenueSchema>;

/**
 * Largest value PostgreSQL's `integer` and `numeric(10, 2)` accept, which is
 * what `events.capacity` and `events.price_amount` are declared as. A source
 * publishing something larger is publishing a sentinel or a bug, not a fact
 * about the event.
 */
const MAX_CAPACITY = 2_147_483_647;
const MAX_PRICE_AMOUNT = 99_999_999.99;

const NUL_PATTERN = /\u0000/g;

/**
 * Removes NUL, which PostgreSQL rejects in `text` and in `jsonb` alike.
 *
 * No source means to publish one; it arrives inside free text as an artefact of
 * whatever produced the upstream record. Stripped here rather than at the write
 * because `raw` is stored verbatim and carries the same hazard as the columns,
 * and because one such character in one event used to fail the whole batch.
 */
function withoutNulCharacters<T>(value: T): T {
  if (typeof value === "string") return value.replace(NUL_PATTERN, "") as T;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(withoutNulCharacters) as T;
  // Anything exotic is left alone rather than rebuilt as a plain object.
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      withoutNulCharacters(key),
      withoutNulCharacters(entry),
    ]),
  ) as T;
}

/**
 * An event as a collector produces it.
 *
 * Two kinds of field, treated differently on purpose. What identifies an
 * occurrence -- its id, title and start -- is validated strictly, and an event
 * missing any of it is not an event worth storing. Everything descriptive falls
 * back to null when a source publishes something unusable, because losing a
 * capacity is a better outcome than losing the event, and, since these are
 * written in batches, better than losing the events collected alongside it.
 */
const NormalizedEventShape = z.object({
  sourceEventId: z.string(),
  /**
   * Identifier for the recurring series this occurrence belongs to, when the
   * upstream source publishes one. Authoritative where present; otherwise the
   * series is derived from the occurrence's venue, game, format and local
   * schedule.
   */
  sourceSeriesId: z.string().nullable().default(null),
  game: GameSchema,
  title: z.string().min(1),
  description: z.string().nullable().default(null),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().nullable().default(null),
  timezone: z.string().nullable().default(null),
  status: z.string().nullable().default(null),
  format: z.string().nullable().default(null),
  eventType: z.string().nullable().default(null),
  sourceUrl: z.string().nullable().default(null),
  registrationUrl: z.string().nullable().default(null),
  // Bounded by the column rather than by anything about events: a price or a
  // headcount too large to store is dropped so the event survives the write.
  priceAmount: z.number().min(0).max(MAX_PRICE_AMOUNT).nullable().default(null).catch(null),
  priceCurrency: z.string().nullable().default(null),
  capacity: z.number().int().min(0).max(MAX_CAPACITY).nullable().default(null).catch(null),
  isOnline: z.boolean().default(false),
  venue: VenueSchema.nullable().default(null),
  raw: z.unknown(),
});

export const NormalizedEventSchema = NormalizedEventShape.transform(withoutNulCharacters);
export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>;

/**
 * The recurring series an event belongs to, when it belongs to one.
 *
 * `cadenceDays` stays null until the series has been observed often enough to
 * assert an interval, so a client can distinguish "known to repeat weekly" from
 * "grouped, but the schedule is not established yet".
 */
export const EventSeriesSummarySchema = z.object({
  id: z.string(),
  cadenceDays: z.number().int().positive().nullable(),
  occurrenceCount: z.number().int().nonnegative(),
  nextStartsAt: z.string().datetime().nullable(),
});
export type EventSeriesSummary = z.infer<typeof EventSeriesSummarySchema>;

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
  sourceUrl: z.string().nullable(),
  registrationUrl: z.string().nullable(),
  priceAmount: z.number().nullable(),
  priceCurrency: z.string().nullable(),
  capacity: z.number().int().nullable(),
  isOnline: z.boolean(),
  distanceMiles: z.number().nullable(),
  series: EventSeriesSummarySchema.nullable(),
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
  // Expanded to the games it contains before the query runs, so the hot path
  // never joins the taxonomy tables.
  categories: z.array(CategorySchema).default([]),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  /**
   * Free-text query, matched against the event's title, game, format, type and
   * venue. Parsed by PostgreSQL as a web search string, so quoted phrases and
   * `-exclusions` work and no input can be malformed enough to error.
   *
   * Bounded well above any real query: the length exists to keep a pathological
   * string out of the parser, not to constrain what someone can type.
   */
  q: z.string().trim().min(1).max(200).optional(),
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

/** A saved event is addressed by the event's own id, which is a UUID. */
export const EventIdSchema = z.string().uuid();

/**
 * Response of `GET /v1/saved-events`.
 *
 * Split by the server rather than returned flat with a date for the client to
 * compare against: "past" depends on the current time, and a device with a
 * skewed clock would otherwise file an event under the wrong heading. The two
 * lists are ordered by what each is for -- `upcoming` soonest first, because it
 * answers "what is next", and `past` most recent first, because it answers
 * "where have I been".
 *
 * A past entry may outlive the event it came from: saves carry their own copy of
 * the event, so retention deleting the event empties the copy's series summary
 * and freezes its details, but does not remove the entry.
 *
 * Uncursored, unlike `EventPage`: a saved list is bounded by how many events one
 * person chose to save, not by how many exist near them.
 */
export const SavedEventsSchema = z.object({
  upcoming: z.array(EventListItemSchema),
  past: z.array(EventListItemSchema),
  count: z.number().int().nonnegative(),
});
export type SavedEvents = z.infer<typeof SavedEventsSchema>;

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
  // When `upcomingEvents` was last recomputed. Null before a source has
  // completed its first collection run. Exposed so consumers can tell a genuine
  // zero from a snapshot that has not been refreshed yet.
  upcomingEventsComputedAt: z.string().datetime().nullable(),
  latestSuccessAt: z.string().datetime().nullable(),
});
export type CoverageSource = z.infer<typeof CoverageSourceSchema>;

export const CoverageResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  sources: z.array(CoverageSourceSchema),
  regions: z.array(CoverageRegionSchema),
});
export type CoverageResponse = z.infer<typeof CoverageResponseSchema>;

export const HomeLocationSchema = z.object({
  address: z.string().trim().min(1).max(500),
  label: z.string().trim().min(1).max(200),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type HomeLocation = z.infer<typeof HomeLocationSchema>;

export const HomeAddressSchema = z.string().trim().min(1).max(500);

export const UserPreferencesUpdateSchema = z.object({
  homeAddress: HomeAddressSchema,
  // Only the shape is checked here; the API rejects slugs that are not in the
  // registry, which no longer has a compile-time length to bound against.
  selectedGames: z.array(GameSchema).min(1).max(64),
});

export const UserPreferencesSchema = z.object({
  homeAddress: HomeAddressSchema.nullable(),
  selectedGames: z.array(GameSchema),
  onboardingCompleted: z.boolean(),
});
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

/**
 * How a series' observed cadence reads to a person, or null when there is not
 * enough evidence to describe one.
 *
 * Intervals are matched with tolerance because a store that runs "every month"
 * lands on 28, 30 or 31 days depending on the month.
 */
export function recurrenceLabel(series: EventSeriesSummary | null): string | null {
  const days = series?.cadenceDays;
  if (!days) return null;
  if (days === 1) return "Repeats daily";
  if (days === 7) return "Repeats weekly";
  if (days === 14) return "Repeats fortnightly";
  if (days >= 28 && days <= 31) return "Repeats monthly";
  if (days % 7 === 0) return `Repeats every ${days / 7} weeks`;
  return `Repeats every ${days} days`;
}

/**
 * Fallback label for a slug the client has no registry entry for, so an event
 * type added to the database still renders in a client built before it existed.
 */
export function fallbackGameLabel(game: Game) {
  return game
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
