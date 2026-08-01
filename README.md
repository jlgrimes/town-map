# Town Map

Town Map is a web and mobile event finder for Pokémon, Magic: The Gathering, Yu-Gi-Oh!, One Piece, and Riftbound. It is a pnpm/Turborepo monorepo with a Vite + React + Capacitor client, a Fastify read API, PostgreSQL storage, and one independently deployable collector per game.

## Project layout

```text
apps/app                    Vite web app plus iOS and Android Capacitor shells
apps/api                    Public event API
packages/contracts          Shared schemas and TypeScript types
packages/db                 PostgreSQL access and migrations
packages/ingestion          Shared collector runner and sync tracking
services/ingest-magic       Wizards locator GraphQL collector
services/ingest-yugioh      KONAMI Card Game Network collector
services/ingest-pokemon     Pokedata Pokémon TCG collector
services/ingest-onepiece    Bandai TCG+ One Piece collector
services/ingest-riftbound   Riftbound locator collector
```

## Local development

Prerequisites: Node.js 22+, pnpm 9+, and PostgreSQL 15+.

1. Copy `.env.example` to `.env` and update `DATABASE_URL`.
2. Run `pnpm install`.
3. Run `pnpm db:migrate`.
4. Run `pnpm dev`.

The app runs at `http://localhost:5173`; the API runs at `http://localhost:3001`. In development, the app displays clearly labeled preview events when the API or database is unavailable.

The read API exposes `GET /v1/events`, `GET /v1/games`, `GET /v1/coverage`, and `GET /v1/geocode`. Coverage reports region freshness and upcoming event totals without exposing collector configuration or upstream error details.

Signed-in users can persist a home address as plain text through `GET /v1/preferences` and `PUT /v1/preferences`. The routes require a Clerk session token; the browser sends it as a bearer token. A saved home becomes the default search location unless the incoming URL already contains explicit coordinates. Resolving that string to map coordinates happens separately and never blocks saving the preference.

Place searches run through the API's configurable `GEOCODER_URL`. The default OpenStreetMap Nominatim integration identifies Town Map, serializes requests below one per second, and caches repeated results for 24 hours in each API instance. Review the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) before changing this integration or scaling traffic.

## Collector checks

Collectors use dry-run mode automatically when `DATABASE_URL` is absent:

```bash
DRY_RUN=true pnpm --filter @town-map/ingest-magic start
DRY_RUN=true pnpm --filter @town-map/ingest-yugioh start
DRY_RUN=true pnpm --filter @town-map/ingest-pokemon dev
DRY_RUN=true pnpm --filter @town-map/ingest-onepiece dev
DRY_RUN=true pnpm --filter @town-map/ingest-riftbound dev
```

The Pokémon service uses Pokedata's structured CSV export for upcoming TCG Cups, Challenges, and Prereleases. It rejects PHP error pages and empty exports instead of writing questionable results.

## Capacitor

The generated native projects live in `apps/app/ios` and `apps/app/android`.
Native builds require current Xcode for iOS and JDK 21 plus the Android SDK for Android.

```bash
pnpm --filter @town-map/app cap:sync
pnpm --filter @town-map/app cap:open:ios
pnpm --filter @town-map/app cap:open:android
```

Set `VITE_API_URL` to the public HTTPS Railway API before syncing a release build.

## Deployment

### Vercel

Create a Vercel project from the repository root. The root `vercel.json` builds only the Vite application and serves `apps/app/dist`. Add:

```text
VITE_API_URL=https://your-api.up.railway.app
VITE_DEMO_MODE=false
VITE_CLERK_PUBLISHABLE_KEY=pk_live_your_key
```

The root `vercel.json` supplies the monorepo build settings and SPA route fallback.

### Railway

Create one PostgreSQL database and six services from the same repository. Keep the repository root as `/` so the services can consume shared workspace packages. For each service, select its config file:

| Railway service | Config-as-code path |
| --- | --- |
| API | `/apps/api/railway.toml` |
| Magic cron | `/services/ingest-magic/railway.toml` |
| Yu-Gi-Oh! cron | `/services/ingest-yugioh/railway.toml` |
| Pokémon cron | `/services/ingest-pokemon/railway.toml` |
| One Piece cron | `/services/ingest-onepiece/railway.toml` |
| Riftbound cron | `/services/ingest-riftbound/railway.toml` |

Expose only the API service publicly. Give the API and all collectors the same `DATABASE_URL` reference variable. Configure `CORS_ORIGINS` on the API with the production and preview Vercel origins.

Set `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` on the API service. Set the matching `VITE_CLERK_PUBLISHABLE_KEY` on Vercel. Enable Google in Clerk's SSO connections. Clerk development instances can use shared Google credentials; production requires a production Clerk instance plus custom Google OAuth credentials and an authorized redirect URI. Home addresses are private account data stored in PostgreSQL and are never returned by public endpoints.

The five collector services wake on staggered hourly schedules, but each configured region has its own six-hour default cadence in PostgreSQL. A worker atomically leases only due regions, records per-region freshness and failures, and safely retries expired leases. This makes scheduler checks cheap while keeping upstream request volume conservative. Run each collector manually once in Railway before relying on its cron, and monitor `collection_regions` and `sync_runs`.

Start with Illinois for Yu-Gi-Oh! and One Piece plus the example Chicago Magic and Riftbound search centers. Expand coverage deliberately after measuring source runtime and request volume. Multiple Magic centers can be passed in `MAGIC_SEARCH_CENTERS_JSON`; Riftbound uses `RIFTBOUND_SEARCH_CENTERS_JSON`; One Piece uses country/subdivision entries in `ONEPIECE_REGIONS_JSON`; Yu-Gi-Oh! accepts comma-separated postal abbreviations in `YUGIOH_STATES`. Pokémon defaults to one worldwide competitive-TCG region; `POKEMON_COUNTRIES=US,CA` splits it into bounded country regions. Removing a configured region disables future jobs for it without deleting previously collected events.

Tune regional scheduling with `COLLECTOR_REGION_CADENCE_MINUTES`, cap work per wake-up with `COLLECTOR_JOB_LIMIT`, and set lease/retry behavior with `COLLECTOR_LEASE_MINUTES` and `COLLECTOR_RETRY_MINUTES`. `COLLECTOR_ENABLED=false` is an emergency stop. `COLLECTOR_REGION_ALLOWLIST` and `COLLECTOR_MAX_REGION_PRIORITY` support staged activation while disabled catalog entries remain visible through `/v1/coverage`.

Before production-scale collection, review each source's terms, identify the application in its user agent, keep the schedules conservative, and pursue official permission where appropriate. The concrete expansion gates are documented in [docs/global-coverage.md](docs/global-coverage.md).

## Quality checks

```bash
pnpm check
pnpm test
pnpm build
```

The database package also has opt-in integration tests for global-scale spatial search and regional job coordination. They create and remove isolated schemas, seed 100,000 venues and events, verify radius correctness and index usage, and exercise concurrent leases and crash recovery:

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/town_map_test \
  pnpm --filter @town-map/db test
```
