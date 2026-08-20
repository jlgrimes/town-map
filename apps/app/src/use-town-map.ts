import { Geolocation } from "@capacitor/geolocation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import type { EventListItem, Game } from "@town-map/contracts";
import {
  fetchEvents,
  fetchSavedEvents,
  fetchUserPreferences,
  geocodePlace,
  saveEvent,
  saveUserPreferences,
  unsaveEvent,
} from "./api";
import { demoEvents } from "./demo-events";
import { useGameCatalog } from "./games";
import {
  DEFAULT_RADIUS_MILES,
  type DateFilter,
  type FilterBarValue,
  type PriceFilter,
} from "@/components/filters/filter-bar";
import {
  initialFormat,
  magicIsOn,
  matchesFormat,
  type FormatFilter,
} from "@/components/filters/format-pills";
import {
  PAGE_SIZE,
  guestAuth,
  type AppAuth,
  type Tab,
  initialGames,
  initialDateFilter,
  initialPriceFilter,
  initialTab,
  initialNumber,
  sortEvents,
  groupEventsByDate,
  matchesDate,
  matchesPrice,
} from "./town-map-model";

const initialParams = new URLSearchParams(window.location.search);

export function useTownMap(auth: AppAuth = guestAuth) {
  const catalog = useGameCatalog();
  const [accountGames, setAccountGames] = useState<Game[]>([]);
  // Null until the user chooses, so a game added to the catalogue is selected by
  // default rather than being invisible to anyone with an existing URL.
  const [gameSelection, setSelectedGames] = useState<Game[] | null>(initialGames(initialParams));
  const selectedGames = useMemo(
    () => (gameSelection === null
      ? (auth.signedIn && accountGames.length > 0 ? accountGames : [])
      : gameSelection.filter((game) => catalog.ids.includes(game))),
    [gameSelection, catalog, auth.signedIn, accountGames],
  );
  const [events, setEvents] = useState<EventListItem[]>([]);
  // True when the area holds more events than one query will gather, so the map
  // is showing a subset rather than everything nearby.
  const [resultsTruncated, setResultsTruncated] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilter>(initialDateFilter(initialParams));
  const urlHasLocation =
    initialParams.has("place") || (initialParams.has("lat") && initialParams.has("lng"));
  const [location, setLocation] = useState({
    latitude: initialNumber(initialParams, "lat", 0),
    longitude: initialNumber(initialParams, "lng", 0),
  });
  const [locationLabel, setLocationLabel] = useState(initialParams.get("place") ?? "");
  const [locationResolved, setLocationResolved] = useState(urlHasLocation);
  const [homeAddress, setHomeAddress] = useState<string | null>(null);
  const [homeDraft, setHomeDraft] = useState("");
  const [preferenceGamesDraft, setPreferenceGamesDraft] = useState<Game[]>([]);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(!auth.enabled);
  const [preferencesReloadKey, setPreferencesReloadKey] = useState(0);
  const [homeNotice, setHomeNotice] = useState<string | null>(null);
  const [preferenceStatus, setPreferenceStatus] = useState<"idle" | "loading" | "ready" | "saved" | "saving" | "error">("idle");
  const [placeQuery, setPlaceQuery] = useState(initialParams.get("place") ?? "");
  const [radiusMiles, setRadiusMiles] = useState(initialNumber(initialParams, "radius", DEFAULT_RADIUS_MILES));
  const [priceFilter, setPriceFilter] = useState<PriceFilter>(initialPriceFilter(initialParams));
  const [formatFilter, setFormatFilter] = useState<FormatFilter>(initialFormat(initialParams));
  const [status, setStatus] = useState<"loading" | "live" | "preview" | "error">("loading");
  const [locationStatus, setLocationStatus] = useState<"idle" | "searching" | "locating">("idle");
  const [locationNotice, setLocationNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [expandedLayoutIdPrefix, setExpandedLayoutIdPrefix] = useState<string>("discover");
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);
  const locationHook = useLocation();
  const navigate = useNavigate();

  const tab: Tab = useMemo(() => {
    const pathname = locationHook.pathname;
    if (pathname === "/my-events") return "my-events";
    if (pathname === "/preferences") return "preferences";
    if (pathname === "/discover") return "discover";
    return initialTab(initialParams);
  }, [locationHook.pathname, auth.enabled]);

  const setTab = useCallback(
    (targetTab: Tab) => {
      const targetPath = targetTab === "discover" ? "/discover" : `/${targetTab}`;
      if (locationHook.pathname !== targetPath) {
        navigate(`${targetPath}${locationHook.search}${locationHook.hash}`);
      }
    },
    [locationHook.pathname, locationHook.search, locationHook.hash, navigate],
  );

  useEffect(() => {
    const pathname = locationHook.pathname;
    if (pathname === "/" || pathname === "") {
      const targetPath = tab === "discover" ? "/discover" : `/${tab}`;
      navigate(`${targetPath}${locationHook.search}${locationHook.hash}`, { replace: true });
    } else {
      const params = new URLSearchParams(locationHook.search);
      const legacyTab = params.get("tab");
      if (legacyTab && (legacyTab === "discover" || legacyTab === "my-events" || legacyTab === "preferences")) {
        const targetPath = legacyTab === "discover" ? "/discover" : `/${legacyTab}`;
        params.delete("tab");
        const nextSearch = params.toString() ? `?${params.toString()}` : "";
        navigate(`${targetPath}${nextSearch}${locationHook.hash}`, { replace: true });
      }
    }
  }, [locationHook.pathname, locationHook.search, locationHook.hash, navigate, tab]);

  // Kept apart rather than as one list with a date comparison at render time.
  // The two halves are ordered in opposite directions -- next event first,
  // most recent visit first -- and the server already decided which is which
  // against its own clock.
  const [savedUpcoming, setSavedUpcoming] = useState<EventListItem[]>([]);
  const [savedPast, setSavedPast] = useState<EventListItem[]>([]);
  const [savedStatus, setSavedStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [savedReloadKey, setSavedReloadKey] = useState(0);

  const savedEvents = useMemo(() => [...savedUpcoming, ...savedPast], [savedUpcoming, savedPast]);

  const expandedEvent = useMemo(
    () => events.find((candidate) => candidate.id === expandedEventId) ?? savedEvents.find((candidate) => candidate.id === expandedEventId) ?? null,
    [expandedEventId, events, savedEvents],
  );
  // Saving is an account feature, so there is nothing to write to until Clerk has
  // both loaded and reported somebody signed in.
  const canSave = auth.enabled && auth.loaded && auth.signedIn;
  const savedIds = useMemo(() => new Set(savedEvents.map((event) => event.id)), [savedEvents]);

  useEffect(() => {
    if (!auth.enabled || !auth.loaded) return;
    if (!auth.signedIn) {
      // Signing out has to clear the list rather than leave the previous
      // account's saves on screen for the next person to use this browser.
      setSavedUpcoming([]);
      setSavedPast([]);
      setSavedStatus("idle");
      setSavedNotice(null);
      return;
    }
    const controller = new AbortController();
    setSavedStatus("loading");
    fetchSavedEvents(auth.getToken, controller.signal)
      .then((saved) => {
        setSavedUpcoming(saved.upcoming);
        setSavedPast(saved.past);
        setSavedStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSavedStatus("error");
      });
    return () => controller.abort();
  }, [auth.enabled, auth.getToken, auth.loaded, auth.signedIn, savedReloadKey]);

  /**
   * Applied locally before the request is sent. The icon is the only feedback a
   * save has, and waiting a round trip to move it reads as a dropped tap; a
   * failure puts the previous list back and says so.
   */
  const toggleSaved = useCallback(async (eventId: string) => {
    if (!canSave) return;
    const previousUpcoming = savedUpcoming;
    const previousPast = savedPast;
    const wasSaved = savedEvents.some((candidate) => candidate.id === eventId);
    const event = savedEvents.find((candidate) => candidate.id === eventId)
      ?? events.find((candidate) => candidate.id === eventId);
    if (!event) return;
    setSavedNotice(null);
    if (wasSaved) {
      // Removal is tried against both lists: taking an event back out of your
      // history is the only way to correct one you saved but never went to.
      setSavedUpcoming(previousUpcoming.filter((candidate) => candidate.id !== eventId));
      setSavedPast(previousPast.filter((candidate) => candidate.id !== eventId));
    } else {
      // Only Discover offers a save, and Discover serves nothing in the past.
      setSavedUpcoming(sortEvents([...previousUpcoming, event]));
    }
    try {
      if (wasSaved) await unsaveEvent(eventId, auth.getToken);
      else await saveEvent(eventId, auth.getToken);
    } catch (error) {
      setSavedUpcoming(previousUpcoming);
      setSavedPast(previousPast);
      setSavedNotice(error instanceof Error && error.message
        ? error.message
        : (wasSaved
          ? "We couldn't remove that event. Please try again."
          : "We couldn't save that event. Please try again."));
      console.error("Updating saved events failed", error);
    }
  }, [auth.getToken, canSave, events, savedEvents, savedPast, savedUpcoming]);

  useEffect(() => {
    if (!auth.enabled || !auth.loaded) return;
    if (!auth.signedIn) {
      setHomeAddress(null);
      setAccountGames([]);
      setPreferenceGamesDraft([]);
      setOnboardingCompleted(false);
      setPreferencesReady(true);
      setSelectedGames(initialGames(initialParams));
      setPreferenceStatus("idle");
      return;
    }
    const controller = new AbortController();
    setPreferencesReady(false);
    setPreferenceStatus("loading");
    fetchUserPreferences(auth.getToken, controller.signal)
      .then(async (preferences) => {
        setHomeAddress(preferences.homeAddress);
        setHomeDraft(preferences.homeAddress ?? "");
        setAccountGames(preferences.selectedGames);
        setPreferenceGamesDraft(preferences.selectedGames);
        setOnboardingCompleted(preferences.onboardingCompleted);
        if (initialParams.get("games") === null && preferences.selectedGames.length > 0) {
          setSelectedGames(preferences.selectedGames);
        }
        if (preferences.homeAddress) setPlaceQuery(preferences.homeAddress);
        const hasUrlLocation = initialParams.has("place") || (initialParams.has("lat") && initialParams.has("lng"));
        if (preferences.homeAddress && !hasUrlLocation) {
          try {
            const result = await geocodePlace(preferences.homeAddress, controller.signal);
            if (controller.signal.aborted) return;
            if (result) {
              setLocation({ latitude: result.latitude, longitude: result.longitude });
              setLocationLabel(result.label);
              setLocationResolved(true);
            } else {
              setLocationNotice("Your home is saved, but we couldn't locate it right now.");
            }
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") return;
            setLocationNotice("Your home is saved, but we couldn't locate it right now.");
          }
        }
        if (controller.signal.aborted) return;
        setPreferencesReady(true);
        setPreferenceStatus("idle");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPreferencesReady(false);
        setPreferenceStatus("error");
      });
    return () => controller.abort();
  }, [auth.enabled, auth.getToken, auth.loaded, auth.signedIn, preferencesReloadKey]);

  useEffect(() => {
    if (
      (auth.enabled && (!auth.loaded || (auth.signedIn && !preferencesReady)))
      || locationStatus === "searching"
      || locationStatus === "locating"
    ) {
      setStatus("loading");
      return;
    }
    if (!locationResolved) {
      return;
    }
    const controller = new AbortController();
    setStatus("loading");
    const gamesToFetch = selectedGames.length === 0 ? catalog.ids : selectedGames;
    fetchEvents({ games: gamesToFetch, ...location, radiusMiles, signal: controller.signal })
      .then(({ events: nextEvents, truncated }) => {
        setEvents(nextEvents);
        setResultsTruncated(truncated);
        setStatus("live");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setResultsTruncated(false);
        if (import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === "true") {
          setEvents(demoEvents);
          setStatus("preview");
        } else {
          setEvents([]);
          setStatus("error");
        }
      });
    return () => controller.abort();
  }, [auth.enabled, auth.loaded, auth.signedIn, selectedGames, location, locationResolved, radiusMiles, locationStatus, preferencesReady, reloadKey, catalog.ids]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedGames.length > 0) params.set("games", selectedGames.join(","));
    if (dateFilter !== "today") params.set("date", dateFilter);
    if (priceFilter !== "all") params.set("price", priceFilter);
    if (formatFilter !== "all") params.set("format", formatFilter);
    if (locationResolved) {
      params.set("lat", location.latitude.toFixed(5));
      params.set("lng", location.longitude.toFixed(5));
      params.set("place", locationLabel);
    }
    params.set("radius", String(radiusMiles));
    const nextUrl = `${window.location.pathname}?${params}${window.location.hash}`;
    window.history.replaceState(null, "", nextUrl);
  }, [dateFilter, formatFilter, location, locationLabel, locationResolved, priceFilter, radiusMiles, selectedGames]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setSelectedEventId(null);
    setHighlightedEventId(null);
  }, [dateFilter, formatFilter, priceFilter, radiusMiles, selectedGames]);

  useEffect(() => {
    if (!magicIsOn(selectedGames) && formatFilter !== "all") setFormatFilter("all");
  }, [formatFilter, selectedGames]);

  // The date and price filters are derived from data already on screen; the
  // location and radius are what the API request itself is scoped to.
  const visibleEvents = useMemo(() => {
    const filtered = events.filter((event) =>
      (selectedGames.length === 0 || selectedGames.includes(event.game)) &&
      matchesDate(event, dateFilter) &&
      matchesPrice(event, priceFilter) &&
      (formatFilter === "all" || (event.game === "magic" && matchesFormat(event.format, formatFilter, event.title))));
    return sortEvents(filtered);
  }, [dateFilter, events, formatFilter, priceFilter, selectedGames]);

  const defaultGames = useMemo(
    () => (auth.signedIn && accountGames.length > 0 ? accountGames : []),
    [accountGames, auth.signedIn],
  );

  const filterValue = useMemo<FilterBarValue>(
    () => ({ dateFilter, radiusMiles, games: selectedGames, price: priceFilter }),
    [dateFilter, priceFilter, radiusMiles, selectedGames],
  );

  const handleFilterChange = useCallback((next: Partial<FilterBarValue>) => {
    if (next.dateFilter !== undefined) setDateFilter(next.dateFilter);
    if (next.radiusMiles !== undefined) setRadiusMiles(next.radiusMiles);
    if (next.games !== undefined) setSelectedGames(next.games);
    if (next.price !== undefined) setPriceFilter(next.price);
  }, []);

  const pagedEvents = visibleEvents.slice(0, visibleCount);
  const eventGroups = groupEventsByDate(pagedEvents);
  const mappableEvents = visibleEvents.filter((event) => event.venue?.latitude != null && event.venue.longitude != null);
  const activeEventId = highlightedEventId ?? selectedEventId;

  async function searchPlace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = placeQuery.trim();
    if (!normalized) return;
    setLocationStatus("searching");
    setLocationNotice(null);
    try {
      const result = await geocodePlace(normalized);
      if (!result) {
        setLocationNotice("We could not find that place. Try a city with its state or a ZIP code.");
        return;
      }
      setLocation({ latitude: result.latitude, longitude: result.longitude });
      setLocationLabel(result.label);
      setPlaceQuery(normalized);
      setLocationResolved(true);
    } catch {
      setLocationNotice("Place search is temporarily unavailable. You can still use your current location.");
    } finally {
      setLocationStatus("idle");
    }
  }

  const useCurrentLocation = useCallback(async () => {
    setLocationStatus("locating");
    setLocationNotice(null);
    try {
      const permission = await Geolocation.requestPermissions();
      if (permission.location === "denied") {
        setLocationNotice("Enter a city or ZIP code instead.");
        return;
      }
      const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 12_000 });
      setLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      setLocationLabel("Current location");
      setPlaceQuery("Current location");
      setLocationResolved(true);
    } catch {
      setLocationNotice("Enter a city or ZIP code instead.");
    } finally {
      setLocationStatus("idle");
    }
  }, []);


  const resetToSavedHome = useCallback(async () => {
    if (!homeAddress) return;
    setLocationStatus("searching");
    setLocationNotice(null);
    try {
      const result = await geocodePlace(homeAddress);
      if (!result) {
        setLocationNotice("We couldn't locate your home address right now.");
        return;
      }
      setLocation({ latitude: result.latitude, longitude: result.longitude });
      setLocationLabel(result.label);
      setPlaceQuery(homeAddress);
      setLocationResolved(true);
    } catch {
      setLocationNotice("We couldn't locate your home address right now.");
    } finally {
      setLocationStatus("idle");
    }
  }, [homeAddress]);

  async function saveAccountPreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = homeDraft.trim();
    if (!normalized || preferenceGamesDraft.length === 0 || !auth.signedIn) return;
    setPreferenceStatus("saving");
    setHomeNotice(null);
    try {
      const preferences = await saveUserPreferences({
        homeAddress: normalized,
        selectedGames: preferenceGamesDraft,
      }, auth.getToken);
      setHomeAddress(preferences.homeAddress);
      setHomeDraft(preferences.homeAddress ?? normalized);
      setAccountGames(preferences.selectedGames);
      setPreferenceGamesDraft(preferences.selectedGames);
      setSelectedGames(preferences.selectedGames);
      setOnboardingCompleted(preferences.onboardingCompleted);
      setPreferenceStatus("saved");
    } catch (error) {
      // Logged as well as shown: the surfaced text is deliberately short, and
      // the underlying error is what makes a failure diagnosable at all.
      console.error("Saving preferences failed", error);
      setPreferenceStatus("error");
      setHomeNotice(error instanceof Error && error.message
        ? `We couldn't save your preferences: ${error.message}`
        : "We couldn't save your preferences right now. Please try again.");
      return;
    }

    setLocationStatus("searching");
    try {
      const result = await geocodePlace(normalized);
      if (!result) {
        setLocationNotice("Home saved. We couldn't locate it yet; try a city with its state or a ZIP code.");
        return;
      }
      setLocation({ latitude: result.latitude, longitude: result.longitude });
      setLocationLabel(result.label);
      setPlaceQuery(normalized);
      setLocationResolved(true);
      setLocationNotice(null);
    } catch {
      setLocationNotice("Home saved. We couldn't locate it right now, but it remains your default.");
    } finally {
      setLocationStatus("idle");
    }
  }

  const handleMapSelect = useCallback((eventId: string) => {
    setSelectedEventId(eventId);
    setExpandedEventId(eventId);
    setExpandedLayoutIdPrefix("map");
    setHighlightedEventId(null);
  }, []);

  const handleDiscoverSelect = useCallback((eventId: string) => {
    setSelectedEventId(eventId);
    setExpandedEventId(eventId);
    setExpandedLayoutIdPrefix("discover");
  }, []);

  const handleSavedSelect = useCallback((eventId: string) => {
    setSelectedEventId(eventId);
    setExpandedEventId(eventId);
    setExpandedLayoutIdPrefix("saved");
  }, []);

  const handleClearSelectedEvent = useCallback(() => {
    setSelectedEventId(null);
  }, []);

  const emptyState = status === "error" ? {
    title: "Events could not be loaded",
    description: "The event service may be temporarily unavailable. Your filters are still saved in this URL.",
    action: "Try again",
    onClick: () => setReloadKey((value) => value + 1),
  } : !locationResolved ? {
    title: "Where should we look?",
    description: "Search a city, ZIP, or address to see tonight.",
    action: "Search a city",
    onClick: () => { document.getElementById("place-search")?.focus(); },
  } : {
    title: "Nothing tonight nearby",
    description: `Try a wider distance or another date near ${locationLabel || "you"}.`,
    action: "Show this week",
    onClick: () => { setDateFilter("week"); },
  };

  return {
    catalog, accountGames, selectedGames, setSelectedGames, events, resultsTruncated,
    dateFilter, setDateFilter, urlHasLocation, location, locationLabel, locationResolved,
    homeAddress, homeDraft, setHomeDraft, preferenceGamesDraft, setPreferenceGamesDraft,
    onboardingCompleted, preferencesReady, homeNotice, preferenceStatus, placeQuery, setPlaceQuery,
    radiusMiles, priceFilter, formatFilter, setFormatFilter, status, locationStatus, locationNotice, visibleCount, setVisibleCount,
    selectedEventId, expandedEventId, setExpandedEventId, expandedLayoutIdPrefix, highlightedEventId, setHighlightedEventId,
    tab, setTab, savedUpcoming, savedPast, savedStatus, savedNotice, setSavedReloadKey,
    savedEvents, expandedEvent, canSave, savedIds, toggleSaved, searchPlace, useCurrentLocation,
    resetToSavedHome, saveAccountPreferences, handleMapSelect, handleDiscoverSelect, handleSavedSelect,
    handleClearSelectedEvent, emptyState, defaultGames, filterValue, handleFilterChange,
    eventGroups, mappableEvents, activeEventId, visibleEvents, auth,
  };
}
