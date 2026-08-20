import { recurrenceLabel } from "@town-map/contracts";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ExpandableEventCardModal } from "@/components/ui/expandable-card";
import { eventMetadata, formatPrice } from "@/components/ui/event-row";
import { ShopDetailPage } from "@/components/shop/ShopDetailPage";
import { Routes, Route } from "react-router-dom";
import { AppFrame } from "./app-frame";
import { DiscoverPanel } from "./discover-panel";
import { PreferencesPanel } from "./preferences-panel";
import { SavedPanel } from "./saved-panel";
import { guestAuth, type AppAuth } from "./town-map-model";
import { useTownMap } from "./use-town-map";

export type { AppAuth };

export function App({ auth = guestAuth }: { auth?: AppAuth }) {
  const tm = useTownMap(auth);
  const showOnboarding = auth.enabled && auth.loaded && auth.signedIn && tm.preferencesReady && !tm.onboardingCompleted;

  return (
    <Routes>
      <Route
        path="/shop/:shopSlug"
        element={
          <ShopDetailPage
            events={tm.events}
            savedEventIds={tm.savedIds}
            onToggleSave={tm.toggleSaved}
            catalog={tm.catalog}
          />
        }
      />
      <Route
        path="*"
        element={
          <TooltipProvider>
            <AppFrame
              auth={auth}
              tab={tm.tab}
              setTab={tm.setTab}
              canSave={tm.canSave}
              savedUpcomingCount={tm.savedUpcoming.length}
              onboarding={showOnboarding ? {
                homeDraft: tm.homeDraft,
                setHomeDraft: tm.setHomeDraft,
                preferenceGamesDraft: tm.preferenceGamesDraft,
                setPreferenceGamesDraft: tm.setPreferenceGamesDraft,
                catalog: tm.catalog,
                homeNotice: tm.homeNotice,
                preferenceStatus: tm.preferenceStatus,
                saveAccountPreferences: tm.saveAccountPreferences,
              } : null}
            >
              {tm.tab === "preferences" ? (
                <PreferencesPanel
                  saveAccountPreferences={tm.saveAccountPreferences}
                  homeDraft={tm.homeDraft}
                  setHomeDraft={tm.setHomeDraft}
                  preferenceGamesDraft={tm.preferenceGamesDraft}
                  setPreferenceGamesDraft={tm.setPreferenceGamesDraft}
                  catalog={tm.catalog}
                  homeNotice={tm.homeNotice}
                  preferenceStatus={tm.preferenceStatus}
                  canSave={tm.canSave}
                />
              ) : tm.tab === "my-events" ? (
                <SavedPanel
                  canSave={tm.canSave}
                  savedStatus={tm.savedStatus}
                  savedUpcoming={tm.savedUpcoming}
                  savedPast={tm.savedPast}
                  savedNotice={tm.savedNotice}
                  auth={auth}
                  preferencesReady={tm.preferencesReady}
                  setTab={() => tm.setTab("discover")}
                  setSavedReloadKey={tm.setSavedReloadKey}
                  savedEvents={tm.savedEvents}
                  handleSavedSelect={tm.handleSavedSelect}
                  toggleSaved={tm.toggleSaved}
                />
              ) : (
                <DiscoverPanel
                  catalog={tm.catalog}
                  selectedGames={tm.selectedGames}
                  setSelectedGames={tm.setSelectedGames}
                  formatFilter={tm.formatFilter}
                  setFormatFilter={tm.setFormatFilter}
                  formatChips={tm.formatChips}
                  placeQuery={tm.placeQuery}
                  setPlaceQuery={tm.setPlaceQuery}
                  searchPlace={tm.searchPlace}
                  locationStatus={tm.locationStatus}
                  useCurrentLocation={tm.useCurrentLocation}
                  authSignedIn={auth.signedIn}
                  homeAddress={tm.homeAddress}
                  resetToSavedHome={tm.resetToSavedHome}
                  filterValue={tm.filterValue}
                  handleFilterChange={tm.handleFilterChange}
                  defaultGames={tm.defaultGames}
                  visibleEvents={tm.visibleEvents}
                  locationNotice={tm.locationNotice}
                  locationResolved={tm.locationResolved}
                  locationLabel={tm.locationLabel}
                  status={tm.status}
                  location={tm.location}
                  mappableEvents={tm.mappableEvents}
                  activeEventId={tm.activeEventId}
                  selectedEventId={tm.selectedEventId}
                  handleMapSelect={tm.handleMapSelect}
                  setHighlightedEventId={tm.setHighlightedEventId}
                  handleClearSelectedEvent={tm.handleClearSelectedEvent}
                  emptyState={tm.emptyState}
                  eventGroups={tm.eventGroups}
                  savedIds={tm.savedIds}
                  canSave={tm.canSave}
                  handleDiscoverSelect={tm.handleDiscoverSelect}
                  toggleSaved={tm.toggleSaved}
                  visibleCount={tm.visibleCount}
                  setVisibleCount={tm.setVisibleCount}
                  resultsTruncated={tm.resultsTruncated}
                />
              )}
            </AppFrame>
            <ExpandableEventCardModal
              event={tm.expandedEvent}
              layoutIdPrefix={tm.expandedLayoutIdPrefix}
              onClose={() => tm.setExpandedEventId(null)}
              saved={tm.expandedEvent ? tm.savedIds.has(tm.expandedEvent.id) : false}
              canSave={tm.canSave}
              onToggleSave={tm.toggleSaved}
              eventMetadata={eventMetadata}
              formatPrice={formatPrice}
              recurrenceLabel={recurrenceLabel}
            />
          </TooltipProvider>
        }
      />
    </Routes>
  );
}
