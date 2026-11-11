"use client";

import type { ReactNode } from "react";
import { PanelRightClose } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type PanelTabId = "step" | "draft" | "insights" | "scenarios";

/** `true` open, `false` closed, `"auto"` docked from lg up and hidden below (so server and client agree). */
export type PanelOpen = boolean | "auto";

/**
 * The map's side panel (issue #93): a docked, non-modal panel. Not a Sheet, because a Sheet is a dialog: it traps
 * focus and makes the map inert, and the core loop is to select a step, edit it, then select the next. Closed, it is
 * hidden but stays mounted, so the scenario levers and their worker keep their state.
 */
export function MapSidePanel({
  open,
  tab,
  onTab,
  onClose,
  stepTab,
  hasStep,
  draftTab,
  draftLabel = "Draft",
  unresolved,
  modelTabs,
  step,
  draft,
  insights,
  scenarios,
}: {
  open: PanelOpen;
  tab: PanelTabId;
  onTab: (tab: PanelTabId) => void;
  onClose: () => void;
  /** The Step tab exists (editable view). */
  stepTab: boolean;
  /** A step is inspected, so the Step tab has something to show. */
  hasStep: boolean;
  /** The Draft tab exists (not while showing live). */
  draftTab: boolean;
  /** What the tab is called: "Draft", or "To confirm" when there is no draft, only things to confirm. */
  draftLabel?: string;
  /** Steps still unconfirmed, shown on the Draft tab. */
  unresolved: number;
  /** Insights and Scenarios exist (there is a model to show). */
  modelTabs: boolean;
  step: ReactNode;
  draft: ReactNode;
  insights: ReactNode;
  scenarios: ReactNode;
}) {
  const wide = tab === "scenarios";
  return (
    <aside
      id="map-panel"
      aria-label="Map panel"
      data-wide={wide || undefined}
      hidden={open === false}
      className={[
        "flex w-96 shrink-0 flex-col overflow-hidden rounded-lg border bg-card shadow-token lg:sticky lg:top-16 lg:max-h-[calc(100svh-5rem)]",
        wide ? "lg:w-[32rem] xl:w-[40rem]" : "",
        "max-lg:absolute max-lg:inset-y-4 max-lg:right-4 max-lg:z-30 max-lg:w-[min(24rem,calc(100%-2rem))] max-lg:shadow-lg",
        open === "auto" ? "max-lg:hidden" : "",
      ].join(" ")}
    >
      <Tabs value={tab} onValueChange={(v) => onTab(v as PanelTabId)} className="min-h-0 flex-1 gap-0">
        <div className="flex items-center gap-2 border-b p-2">
          <TabsList className="h-8 flex-1 justify-start">
            {stepTab && (
              <TabsTrigger value="step" disabled={!hasStep} className="text-xs">
                Step
              </TabsTrigger>
            )}
            {draftTab && (
              <TabsTrigger value="draft" className="gap-1.5 text-xs">
                {draftLabel}
                {unresolved > 0 && (
                  <Badge variant="outline" className="border-warn bg-warn-soft px-1.5 py-0 text-2xs tabular-nums text-fg" aria-label={`${unresolved} to confirm`}>
                    {unresolved}
                  </Badge>
                )}
              </TabsTrigger>
            )}
            {modelTabs && (
              <>
                <TabsTrigger value="insights" className="text-xs">
                  Insights
                </TabsTrigger>
                <TabsTrigger value="scenarios" className="text-xs">
                  Scenarios
                </TabsTrigger>
              </>
            )}
          </TabsList>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Close panel" onClick={onClose}>
            <PanelRightClose />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-background p-3">
          {stepTab && (
            <TabsContent value="step" forceMount className="data-[state=inactive]:hidden">
              {hasStep ? step : <p className="py-6 text-center text-muted-foreground">Select a step on the map to edit it.</p>}
            </TabsContent>
          )}
          {draftTab && (
            <TabsContent value="draft" forceMount className="data-[state=inactive]:hidden">
              <div className="flex flex-col gap-3">{draft}</div>
            </TabsContent>
          )}
          {modelTabs && (
            <>
              <TabsContent value="insights" forceMount className="data-[state=inactive]:hidden">
                {insights}
              </TabsContent>
              <TabsContent value="scenarios" forceMount className="data-[state=inactive]:hidden">
                {scenarios}
              </TabsContent>
            </>
          )}
        </div>
      </Tabs>
    </aside>
  );
}
