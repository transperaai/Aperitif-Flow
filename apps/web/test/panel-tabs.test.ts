import { describe, expect, it } from "vitest";
import { panelTabs, type PanelTabInput } from "@/lib/map/panel-tabs";

// The map's side panel always opens on a tab that exists (issue #104), including a live process with things to confirm and no draft.

const base: PanelTabInput = { hasDraft: false, showingLive: false, unresolved: 0, changes: 0, hasModel: true, wanted: "draft" };

describe("the map's side panel tabs", () => {
  it("shows the to-confirm tab with no draft when steps need confirming, and opens on it", () => {
    const t = panelTabs({ ...base, unresolved: 2 });
    expect(t.has.draft).toBe(true);
    expect(t.active).toBe("draft");
    expect(t.draftLabel).toBe("To confirm");
    expect(t.has[t.active]).toBe(true);
  });

  it("has no draft tab, and opens on insights, when there is nothing to confirm and no draft", () => {
    const t = panelTabs(base);
    expect(t.has.draft).toBe(false);
    expect(t.active).toBe("insights");
  });

  it("calls it the draft when there is one, and hides it while the live model is shown", () => {
    expect(panelTabs({ ...base, hasDraft: true, changes: 1 }).draftLabel).toBe("Draft");
    const live = panelTabs({ ...base, hasDraft: true, showingLive: true, changes: 1, unresolved: 1 });
    expect(live.has.draft).toBe(false);
    expect(live.has[live.active]).toBe(true);
  });

  it("always picks a tab that exists", () => {
    for (const hasDraft of [false, true])
      for (const showingLive of [false, true])
        for (const unresolved of [0, 3])
          for (const changes of [0, 2])
            for (const wanted of ["draft", "insights", "scenarios", "step"] as const) {
              const t = panelTabs({ hasDraft: hasDraft, showingLive: showingLive && hasDraft, unresolved, changes, hasModel: true, wanted });
              expect(t.has[t.active] || t.active === "step", JSON.stringify({ hasDraft, showingLive, unresolved, changes, wanted })).toBe(true);
              expect(t.has[t.active]).toBe(true);
            }
  });
});
