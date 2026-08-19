import { type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bookmark, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Typography } from "@/components/ui/typography";
import type { Game } from "@town-map/contracts";
import type { GameCatalog } from "./games";
import { GamePreferencePicker, UserFooterMenu } from "./account-chrome";
import type { AppAuth, Tab } from "./town-map-model";

export function AppFrame({
  auth,
  tab,
  setTab,
  canSave,
  savedUpcomingCount,
  children,
  onboarding,
}: {
  auth: AppAuth;
  tab: Tab;
  setTab: (tab: Tab) => void;
  canSave: boolean;
  savedUpcomingCount: number;
  children: ReactNode;
  onboarding: null | {
    homeDraft: string;
    setHomeDraft: (value: string) => void;
    preferenceGamesDraft: Game[];
    setPreferenceGamesDraft: (games: Game[]) => void;
    catalog: GameCatalog;
    homeNotice: string | null;
    preferenceStatus: string;
    saveAccountPreferences: (event: FormEvent<HTMLFormElement>) => void;
  };
}) {
  return (
    <SidebarProvider defaultOpen={false}>
      <div className="flex min-h-svh w-full bg-background text-foreground">
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <div className="flex h-12 items-center gap-2.5 px-2">
              <img src="/town-map.png" alt="Town Map logo" className="size-8 object-contain shrink-0" />
              <span className="font-semibold text-sm group-data-[collapsible=icon]:hidden">Town Map</span>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={tab === "discover"} tooltip="Discover">
                      <Link to="/discover">
                        <Compass />
                        <span>Discover</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={tab === "my-events"} tooltip="My events">
                      <Link to="/my-events">
                        <Bookmark />
                        <span>My events</span>
                        {canSave && savedUpcomingCount > 0 && (
                          <SidebarMenuBadge className="font-medium group-data-[collapsible=icon]:hidden">
                            {savedUpcomingCount}
                          </SidebarMenuBadge>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <UserFooterMenu auth={auth} setTab={setTab} />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>
        <SidebarInset className="flex flex-1 flex-col min-w-0 h-svh overflow-hidden">
          <a href="#main-content" className="sr-only z-[1000] bg-background px-4 py-3 font-semibold focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
            Skip to events
          </a>
          {onboarding && (
            <div className="fixed inset-0 z-[100] overflow-y-auto bg-background/95 px-4 py-8 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
              <div className="mx-auto flex min-h-full max-w-lg items-center justify-center">
                <div className="w-full rounded-xl border bg-card p-5 text-card-foreground shadow-xl sm:p-7">
                  <div className="flex items-center gap-3">
                    <img src="/town-map.png" alt="" className="size-11 object-contain" />
                    <div>
                      <h2 id="onboarding-title" className="text-lg font-semibold">Find tournaments near you</h2>
                      <p className="text-sm text-muted-foreground">Tell us where to look and which games you play.</p>
                    </div>
                  </div>
                  <form onSubmit={onboarding.saveAccountPreferences} className="mt-6 space-y-5">
                    <div className="space-y-1.5">
                      <Label htmlFor="onboarding-home">Home area</Label>
                      <Input
                        id="onboarding-home"
                        value={onboarding.homeDraft}
                        onChange={(event) => onboarding.setHomeDraft(event.target.value)}
                        placeholder="Chicago, IL or 60614"
                        autoComplete="street-address"
                        className="h-11"
                        autoFocus
                      />
                      <p className="text-xs text-muted-foreground">A city, ZIP code, or full address works.</p>
                    </div>
                    <GamePreferencePicker value={onboarding.preferenceGamesDraft} onChange={onboarding.setPreferenceGamesDraft} catalog={onboarding.catalog} />
                    {onboarding.preferenceGamesDraft.length === 0 && <p className="text-xs text-muted-foreground">Choose at least one game.</p>}
                    {onboarding.homeNotice && <p role="status" className="text-sm text-destructive">{onboarding.homeNotice}</p>}
                    <Button
                      type="submit"
                      className="h-11 w-full"
                      disabled={!onboarding.homeDraft.trim() || onboarding.preferenceGamesDraft.length === 0 || onboarding.preferenceStatus === "saving"}
                    >
                      {onboarding.preferenceStatus === "saving" ? "Saving…" : "Show nearby tournaments"}
                    </Button>
                  </form>
                </div>
              </div>
            </div>
          )}
          <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4 lg:px-6">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-4" />
            <Typography variant="h2" as="h1">
              {tab === "my-events" ? "My events" : tab === "preferences" ? "Preferences" : "Discover"}
            </Typography>
          </header>
          <main id="main-content" className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-4 py-3 sm:px-6 lg:px-8">
            {children}
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
