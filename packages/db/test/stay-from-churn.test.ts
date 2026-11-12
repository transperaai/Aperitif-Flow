import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_STAY_MONTHS, type EngineModel } from "@transpera-flow/engine";
import { northbeamBundle, toEngineModel } from "../src";
import { applyModelChanges } from "../src/sandbox/edits";

// Finding 30 in the Sandbox: a stay worked out from churn (no expected tenure entered) follows a base-churn change, so a won deal
// and a lost client are valued at the stay the simulation gives them. An entered stay is the owner's and is kept.

const START = "2026-10-05";

function modelWith(blank: boolean): { model: EngineModel; sid: string } {
  const b = northbeamBundle();
  const sid = b.services[0]!.id;
  if (blank) b.services = b.services.map((sv) => (sv.id === sid ? { ...sv, tenure_months: null, churn_monthly_base: 0.04 } : sv));
  return { model: toEngineModel(b, { startDate: START }), sid };
}

describe("a Sandbox base-churn change and a stay worked out from churn", () => {
  it("works the stay out again from the new churn, capped", () => {
    const { model, sid } = modelWith(true);
    expect(model.services![sid]!.tenureMonths).toBeCloseTo(25, 12);
    const halve = applyModelChanges(model, [{ id: "c1", lever: "B3", target: sid, op: "multiply", value: 0.5 }], { churnDrivers: [] });
    expect(halve.problems).toEqual([]);
    expect(halve.model.services![sid]!.churnMonthly).toBeCloseTo(0.02, 12);
    expect(halve.model.services![sid]!.tenureMonths).toBeCloseTo(50, 12);
    const none = applyModelChanges(model, [{ id: "c2", lever: "B3", target: sid, op: "set", value: 0 }], { churnDrivers: [] });
    expect(none.model.services![sid]!.tenureMonths).toBe(DEFAULT_MAX_STAY_MONTHS);
    const group = halve.model.clientGroups?.[sid];
    if (group) expect(group.stayMonths).toBeCloseTo(model.clientGroups![sid]!.stayFromChurn ? 50 : model.clientGroups![sid]!.stayMonths, 12);
  });

  it("keeps an entered stay", () => {
    const { model, sid } = modelWith(false);
    const before = model.services![sid]!.tenureMonths;
    const out = applyModelChanges(model, [{ id: "c1", lever: "B3", target: sid, op: "multiply", value: 0.5 }], { churnDrivers: [] });
    expect(out.model.services![sid]!.tenureMonths).toBe(before);
  });
});
