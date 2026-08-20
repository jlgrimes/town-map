import { withPlayerMagicFormat, type EventPage, type SavedEvents } from "@town-map/contracts";

export function eventsWithPlayerFormats(page: EventPage): EventPage {
  return { ...page, events: page.events.map(withPlayerMagicFormat) };
}

export function savedEventsWithPlayerFormats(saved: SavedEvents): SavedEvents {
  return {
    ...saved,
    upcoming: saved.upcoming.map(withPlayerMagicFormat),
    past: saved.past.map(withPlayerMagicFormat),
  };
}
