import { describe, expect, test } from "vitest";
import { capacityModel, simulate } from "@transpera-flow/engine";
import { capacitySetupFromModel, dler, playSeries } from "../src";

// The Sandbox's DLER (customisability audit 18): with no lever moved, its first month is the Overview's and Capacity's DLER, and the levers'
// path moves from today's by its own retainers.

describe("playSeries DLER", () => {
  const model = { ...capacityModel(), horizonWeeks: 26 };
  const setup = capacitySetupFromModel(model);
  const result = simulate(model, 4, 1, { monthly: true });
  const today = playSeries(setup, { leavers: [], hires: [] }, model, result);

  test("today's path starts at the Overview's DLER, department by department", () => {
    const overview = dler(setup);
    expect(overview.whole.ratio).not.toBeNull();
    expect(today.charts.dlerWhole[0]).toBeCloseTo(overview.whole.ratio!, 9);
    for (const [i, d] of overview.departments.entries()) {
      if (d.ratio !== null) expect(today.charts.dler[i]!.values[0]).toBeCloseTo(d.ratio, 9);
    }
  });

  test("a run measured against today's first month moves with its own retainers", () => {
    const doubled = { ...result, monthly: { ...result.monthly!, mrr: result.monthly!.mrr.map((s) => ({ ...s, mean: s.mean * 2 })) } };
    const moved = playSeries(setup, { leavers: [], hires: [] }, model, doubled, undefined, today.retainerAnchor);
    expect(moved.charts.dlerWhole[0]).toBeCloseTo(2 * today.charts.dlerWhole[0]!, 9);
    // Without the anchor a run is measured from its own first month.
    const own = playSeries(setup, { leavers: [], hires: [] }, model, doubled);
    expect(own.charts.dlerWhole[0]).toBeCloseTo(today.charts.dlerWhole[0]!, 9);
  });
});
