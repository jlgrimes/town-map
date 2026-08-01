# Event source contracts

These endpoints are public interfaces used by official event locators, but they are not documented partner APIs. Treat every collector as an adapter with its own monitoring and failure policy.

## Magic: Wizards Store and Event Locator

- Endpoint: `https://api.tabletop.wizards.com/silverbeak-griffin-service/graphql`
- Operation: `searchEvents`
- Stable source keys: event `id`; organization `id`
- Current strategy: query coordinate/radius centers with the `magic:_the_gathering` tag and paginate in blocks of 200
- Notable transforms: `entryFee.amount` is cents; events outside the next 180 days are ignored
- Failure policy: fail the whole run on GraphQL or contract errors; retain previously stored records

## Yu-Gi-Oh!: KONAMI Card Game Network

- Endpoint: `https://cardgame-network.konami.net/mt/user/rest/tournament/US/tournament_gsearch`
- Stable source keys: `tournamentNo`; `storeCode`
- Current strategy: search each configured state over a rolling 90-day window
- Exclusions: finished events and digital-only Master Duel, Duel Links, or Legacy of the Duelist events
- Failure policy: fail the whole run when any configured state fails, avoiding a misleading partial successful sync

## Pokémon: Pokedata events export

- Page: `https://www.pokedata.ovh/events/`
- Endpoint: `https://www.pokedata.ovh/events/tocsv.php`
- Stable source keys: event `guid`; venue `league`
- Current strategy: submit the page's documented filter fields as form data and parse the semicolon-delimited CSV export; include upcoming TCG Cups, Challenges, and Prereleases only
- Time handling: Pokedata supplies local wall time plus coordinates; the collector derives an IANA timezone from the coordinates before converting to UTC
- Coverage caveat: Friendly TCG is not enabled because that export currently exhausts the source server's PHP memory; add it only through a bounded, validated strategy
- Provenance caveat: Pokedata is a third-party index, and its own page warns that event edits may not be reflected; link users to the official Pokémon event page and keep collection conservative
- Failure policy: reject HTML/PHP errors, unexpected CSV contracts, or empty results and retain previously stored records

## Normalization rules

- All timestamps are stored as UTC `timestamptz`; the source timezone is retained separately when available.
- Events are idempotent on `(source, source_event_id)`.
- Venues are idempotent on `(source, source_venue_id)`.
- `source_url` is the canonical event-details page at the upstream source; `registration_url` is populated only when a distinct, direct signup page is available.
- Raw source records are retained as JSONB for debugging and future reprocessing.
- A sync run records its status, source counts, write counts, timestamps, and error message.
