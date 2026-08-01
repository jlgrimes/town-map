# Town Map

Town Map is a web and mobile event finder for Pokémon, Magic: The Gathering, and Yu-Gi-Oh! It is a pnpm/Turborepo monorepo with a Vite + React + Capacitor client, a Fastify read API, PostgreSQL storage, and one independently deployable collector per game.

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
```

## Local development

Prerequisites: Node.js 22+, pnpm 9+, and PostgreSQL 15+.

1. Copy `.env.example` to `.env` and update `DATABASE_URL`.
2. Run `pnpm install`.
3. Run `pnpm db:migrate`.
4. Run `pnpm dev`.

The app runs at `http://localhost:5173`; the API runs at `http://localhost:3001`. In development, the app displays clearly labeled preview events when the API or database is unavailable.

## Collector checks

Collectors use dry-run mode automatically when `DATABASE_URL` is absent:

```bash
DRY_RUN=true pnpm --filter @town-map/ingest-magic start
DRY_RUN=true pnpm --filter @town-map/ingest-yugioh start
DRY_RUN=true pnpm --filter @town-map/ingest-pokemon dev
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
```

The root `vercel.json` supplies the monorepo build settings and SPA route fallback.

### Railway

Create one PostgreSQL database and four services from the same repository. Keep the repository root as `/` so the services can consume shared workspace packages. For each service, select its config file:

| Railway service | Config-as-code path |
| --- | --- |
| API | `/apps/api/railway.toml` |
| Magic cron | `/services/ingest-magic/railway.toml` |
| Yu-Gi-Oh! cron | `/services/ingest-yugioh/railway.toml` |
| Pokémon cron | `/services/ingest-pokemon/railway.toml` |

Expose only the API service publicly. Give the API and all collectors the same `DATABASE_URL` reference variable. Configure `CORS_ORIGINS` on the API with the production and preview Vercel origins.

The three collector configs use staggered six-hour schedules. Run each one manually once in Railway before relying on its cron, and monitor sync failures and source runtimes.

Start with `YUGIOH_STATES=IL` and the example Chicago Magic search center. Expand coverage deliberately after measuring source runtime and request volume. Multiple Magic centers can be passed in `MAGIC_SEARCH_CENTERS_JSON`; Yu-Gi-Oh! accepts comma-separated postal abbreviations in `YUGIOH_STATES`. Pokémon defaults to worldwide competitive TCG coverage; `POKEMON_COUNTRIES=US,CA` can bound it to selected countries.

Before production-scale collection, review each source's terms, identify the application in its user agent, keep the schedules conservative, and pursue official permission where appropriate.

## Quality checks

```bash
pnpm check
pnpm test
pnpm build
```

The database package also has an opt-in global-scale PostGIS integration test. It creates and removes an isolated schema, seeds 100,000 venues and events, verifies radius correctness, and confirms the GiST index is used:

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/town_map_test \
  pnpm --filter @town-map/db test
```
