// Which tabs the map's side panel has, and which one it opens on (issue #104). Pure, so it is tested without a page.
//
// The "draft" tab holds the checklist of what still needs confirming (conflicts, estimates) and, when the process has a
// draft, its changes against live. The checklist is about the process itself, so it shows with no draft too.

import type { PanelTabId } from "@/components/map/side-panel";

export interface PanelTabInput {
  /** The process has a draft. */
  hasDraft: boolean;
  /** The draft exists but the live model is what is on screen. */
  showingLive: boolean;
  /** Steps still to confirm. */
  unresolved: number;
  /** Changes of the draft against live. */
  changes: number;
  /** The model on screen can be simulated, so Insights and Scenarios exist. */
  hasModel: boolean;
  /** The tab that was showing, or asked for. */
  wanted: PanelTabId;
}

export interface PanelTabs {
  has: Record<PanelTabId, boolean>;
  /** The tab to show: the wanted one if it exists, else one that does. */
  active: PanelTabId;
  /** There is something on the draft tab to look at. */
  hasContent: boolean;
  /** The draft tab's label: it is the draft's, or just what to confirm. */
  draftLabel: "Draft" | "To confirm";
}

export function panelTabs({ hasDraft, showingLive, unresolved, changes, hasModel, wanted }: PanelTabInput): PanelTabs {
  const hasContent = !showingLive && (unresolved > 0 || changes > 0);
  const has: Record<PanelTabId, boolean> = {
    step: false,
    draft: !showingLive && (hasDraft || unresolved > 0),
    insights: hasModel,
    scenarios: hasModel,
  };
  const active: PanelTabId = has[wanted] ? wanted : hasContent && has.draft ? "draft" : has.insights ? "insights" : has.draft ? "draft" : "step";
  return { has, active, hasContent, draftLabel: hasDraft ? "Draft" : "To confirm" };
}
