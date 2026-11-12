import { describe, expect, test } from "vitest";
import { toRatingConfig } from "@transpera-flow/engine";
import { liveAnalysisSettings } from "../src";

// What the pages rate with (customisability audit 32 and 45): the assumptions Settings edits, and nothing else that was stored.

describe("liveAnalysisSettings", () => {
  test("keeps the value cap, the absence test and the busy cut-offs", () => {
    expect(liveAnalysisSettings({ money: { capMonths: 24, absenceWeeks: 4, absencesPerYear: 3 }, rules: { busy: { inputs: [0.6, 0.85, 1] } } })).toEqual({
      money: { capMonths: 24, absenceWeeks: 4, absencesPerYear: 3 },
      rules: { busy: { inputs: [0.6, 0.85, 1] } },
    });
  });
  test("leaves out what the removed rules editor stored and nothing in the app can change", () => {
    const stored = {
      rules: { busy: { enabled: false, overrides: [{ kind: "role" as const, id: "r", inputs: [0.5, 0.6, 0.7] }] }, wait: { inputs: [2, 3, 4] } },
      escalators: { badMonth: false },
      money: { waitHours: { pipeline: 4 } },
    };
    expect(liveAnalysisSettings(stored)).toEqual({});
    expect(liveAnalysisSettings({})).toEqual({});
  });
  test("reads only the busy bands' distances: a middle saved under the old editor is pinned to the default line", () => {
    const live = liveAnalysisSettings({ rules: { busy: { inputs: [0.6, 0.8, 0.9] } } });
    expect(live).toEqual({ rules: { busy: { inputs: [0.65, 0.85, 0.95] } } });
    // The workspace's own line then moves the bands, keeping their distances.
    const cut = toRatingConfig(live, 40, 0.75).rules.busy.cutoffs.map((v) => Math.round(v * 100) / 100);
    expect(cut).toEqual([0.55, 0.75, 0.85]);
    expect(toRatingConfig(live, 40, 0.85).rules.busy.cutoffs).toEqual([0.65, 0.85, 0.95]);
  });
});
