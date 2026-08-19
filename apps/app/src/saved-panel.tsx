import { SignInButton } from "@clerk/react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Typography } from "@/components/ui/typography";
import { EventRow } from "@/components/ui/event-row";
import { Bookmark, CircleAlert, RefreshCw } from "lucide-react";
import type { EventListItem } from "@town-map/contracts";
import { LoadingCards } from "./account-chrome";
import { groupEventsByDate, SAVED_SECTIONS, type AppAuth } from "./town-map-model";

export type SavedPanelProps = {
  canSave: boolean;
  savedStatus: "idle" | "loading" | "ready" | "error";
  savedUpcoming: EventListItem[];
  savedPast: EventListItem[];
  savedNotice: string | null;
  auth: AppAuth;
  preferencesReady: boolean;
  setTab: (tab: "discover") => void;
  setSavedReloadKey: (update: (value: number) => number) => void;
  savedEvents: EventListItem[];
  handleSavedSelect: (eventId: string) => void;
  toggleSaved: (eventId: string) => void;
};

export function SavedPanel(p: SavedPanelProps) {
  const {
    canSave, savedStatus, savedUpcoming, savedPast, savedNotice, auth,
    preferencesReady, setTab, setSavedReloadKey, savedEvents, handleSavedSelect, toggleSaved,
  } = p;
  return (
                <section aria-label="My events" className="flex min-h-0 flex-1 flex-col">
                  {canSave && savedStatus !== "error" && (
                    <div className="flex min-h-9 shrink-0 items-center justify-between gap-3 border-b pb-2 text-sm">
                      <p className="text-xs text-muted-foreground">
                        {savedStatus === "loading"
                          ? "Loading your events…"
                          : [
                            `${savedUpcoming.length} upcoming`,
                            savedPast.length > 0 ? `${savedPast.length} past` : null,
                          ].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  )}

                  {savedNotice && (
                    <p role="status" className="flex items-start gap-1 py-2 text-xs text-destructive">
                      <CircleAlert className="mt-0.5 size-3.5 shrink-0" />{savedNotice}
                    </p>
                  )}

                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                    {!auth.loaded || (auth.signedIn && (savedStatus === "loading" || !preferencesReady)) ? (
                      <LoadingCards />
                    ) : !canSave ? (
                      <Empty className="py-16">
                        <EmptyHeader>
                          <EmptyMedia variant="icon"><Bookmark /></EmptyMedia>
                          <EmptyTitle>Sign in to keep events</EmptyTitle>
                          <EmptyDescription>
                            Saved events live on your account, so they are still here on your phone and on your laptop.
                          </EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent className="flex-row justify-center gap-2">
                          <SignInButton mode="modal"><Button className="min-h-11 px-4">Sign in</Button></SignInButton>
                          <Button variant="outline" className="min-h-11 px-4" onClick={() => setTab("discover")}>Browse events</Button>
                        </EmptyContent>
                      </Empty>
                    ) : savedStatus === "error" ? (
                      <Empty className="py-16">
                        <EmptyHeader>
                          <EmptyMedia variant="icon"><RefreshCw /></EmptyMedia>
                          <EmptyTitle>Your events could not be loaded</EmptyTitle>
                          <EmptyDescription>Nothing has been lost. Check your connection and try again.</EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent>
                          <Button variant="outline" className="min-h-11 px-4" onClick={() => setSavedReloadKey((value) => value + 1)}>
                            Try again
                          </Button>
                        </EmptyContent>
                      </Empty>
                    ) : savedEvents.length === 0 ? (
                      <Empty className="py-16">
                        <EmptyHeader>
                          <EmptyMedia variant="icon"><Bookmark /></EmptyMedia>
                          <EmptyTitle>Nothing saved yet</EmptyTitle>
                          <EmptyDescription>
                            Save an event from Discover and it will be waiting here, soonest first.
                          </EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent>
                          <Button className="min-h-11 px-4" onClick={() => setTab("discover")}>Find events</Button>
                        </EmptyContent>
                      </Empty>
                    ) : (
                      <div className="border-b" aria-label="Saved events">
                        {SAVED_SECTIONS.map(({ key, heading }) => {
                          const sectionEvents = key === "upcoming" ? savedUpcoming : savedPast;
                          if (sectionEvents.length === 0) return null;
                          return (
                            <section key={key} aria-labelledby={`saved-section-${key}`}>
                              <Typography
                                variant="kicker"
                                as="h3"
                                id={`saved-section-${key}`}
                                className="border-b bg-muted/60 px-3 py-2.5 block font-semibold"
                              >
                                {heading}
                              </Typography>
                              {groupEventsByDate(sectionEvents).map((group) => (
                                <section key={group.key} aria-labelledby={`saved-${key}-${group.key}`}>
                                  <Typography
                                    variant="kicker"
                                    as="h4"
                                    id={`saved-${key}-${group.key}`}
                                    className="border-b bg-muted/35 px-3 py-2 block"
                                  >
                                    {group.label}
                                  </Typography>
                                  {/* Past rows are dimmed rather than hidden behind a
                                      toggle: they are the record of where someone has
                                      been, and the point of keeping them is that they
                                      stay visible. */}
                                  <ol className={key === "past" ? "divide-y opacity-70" : "divide-y"}>
                                    {group.events.map((event) => (
                                      <EventRow
                                        key={event.id}
                                        event={event}
                                        active={false}
                                        saved
                                        canSave={canSave}
                                        layoutIdPrefix="saved"
                                        onPreview={() => undefined}
                                        onSelect={handleSavedSelect}
                                        onToggleSave={toggleSaved}
                                      />
                                    ))}
                                  </ol>
                                </section>
                              ))}
                            </section>
                          );
                        })}
                      </div>
                    )}
                    <p className="px-2 py-5 text-xs text-muted-foreground">
                      Verify details with the organizer. Events you have been to stay here after they finish.
                    </p>
                  </div>
                </section>

  );
}
