import { describe, expect, it } from "vitest";
import { pooledChurnMonthly, type EngineModel } from "@transpera-flow/engine";
import { northbeamBundle, toEngineModel } from "../src";
import { applyModelChanges } from "../src/sandbox/edits";

// Finding 37: clients kept as one pool churn at the services' base churn (mix-weighted), so a Sandbox change to one type's base churn
// moves today's clients too, by the same ratio, on top of any change to all of them.

const pooled = (): EngineModel =>
  toEngineModel({ ...northbeamBundle(), clients: [], clientGroups: [], clientServices: [], clientAssignments: [], servicingLinks: [], otherProcesses: [] }, { startDate: "2026-10-05" });

describe("base churn on a pooled model", () => {
  it("a type's base churn moves the pool's churn by the mix-weighted ratio", () => {
    const m = pooled();
    const sid = Object.keys(m.services!)[0]!;
    const out = applyModelChanges(m, [{ id: "c1", lever: "B3", target: sid, op: "multiply", value: 2 }], { churnDrivers: [] });
    expect(out.problems).toEqual([]);
    const next = out.model.services!;
    expect(next[sid]!.churnMonthly).toBeCloseTo(m.services![sid]!.churnMonthly * 2, 12);
    expect(out.model.churnMonthly).toBeCloseTo(pooledChurnMonthly(next, m.churnMonthly), 12);
  });
});
