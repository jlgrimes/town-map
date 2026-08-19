import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CircleAlert } from "lucide-react";
import type { FormEvent } from "react";
import type { Game } from "@town-map/contracts";
import type { GameCatalog } from "./games";
import { AccountSettingsCard, GamePreferencePicker } from "./account-chrome";

export type PreferencesPanelProps = {
  saveAccountPreferences: (event: FormEvent<HTMLFormElement>) => void;
  homeDraft: string;
  setHomeDraft: (value: string) => void;
  preferenceGamesDraft: Game[];
  setPreferenceGamesDraft: (games: Game[]) => void;
  catalog: GameCatalog;
  homeNotice: string | null;
  preferenceStatus: "idle" | "loading" | "ready" | "saved" | "saving" | "error";
  canSave: boolean;
};

export function PreferencesPanel(p: PreferencesPanelProps) {
  const {
    saveAccountPreferences, homeDraft, setHomeDraft, preferenceGamesDraft,
    setPreferenceGamesDraft, catalog, homeNotice, preferenceStatus, canSave,
  } = p;
  return (
                <section aria-label="Preferences" className="mx-auto flex w-full max-w-2xl min-h-0 flex-1 flex-col py-2">
                  <div className="border-b pb-3">
                    <p className="text-sm text-muted-foreground">
                      Configure your default home location and preferred trading card games for tournament search.
                    </p>
                  </div>

                  <div className="mt-6 space-y-6">
                    <form onSubmit={saveAccountPreferences} className="space-y-6 rounded-xl border bg-card p-6 shadow-xs">
                      <div className="space-y-2">
                        <Label htmlFor="pref-home-address" className="text-base font-semibold">Home area</Label>
                        <Input
                          id="pref-home-address"
                          value={homeDraft}
                          onChange={(event) => setHomeDraft(event.target.value)}
                          placeholder="Chicago, IL or 60614"
                          autoComplete="street-address"
                          className="h-11"
                        />
                        <p className="text-xs text-muted-foreground">City, ZIP code, or full address work as your default search center.</p>
                      </div>

                      <div className="space-y-3">
                        <GamePreferencePicker value={preferenceGamesDraft} onChange={setPreferenceGamesDraft} catalog={catalog} />
                        {preferenceGamesDraft.length === 0 && <p className="text-xs text-destructive">Choose at least one game.</p>}
                      </div>

                      {homeNotice && (
                        <div role="status" className="flex items-center gap-2 text-sm text-destructive">
                          <CircleAlert className="size-4 shrink-0" />
                          <span>{homeNotice}</span>
                        </div>
                      )}

                      {preferenceStatus === "saved" && !homeNotice && (
                        <p role="status" className="text-xs text-emerald-600 dark:text-emerald-400">Preferences saved.</p>
                      )}

                      <Button
                        type="submit"
                        className="h-11 w-full sm:w-auto px-6"
                        disabled={!homeDraft.trim() || preferenceGamesDraft.length === 0 || preferenceStatus === "saving" || !canSave}
                      >
                        {preferenceStatus === "saving" ? "Saving…" : "Save preferences"}
                      </Button>
                      {!canSave && (
                        <p className="text-xs text-muted-foreground">Sign in to sync preferences to your account.</p>
                      )}
                    </form>

                    {canSave && <AccountSettingsCard />}
                  </div>
                </section>

  );
}
