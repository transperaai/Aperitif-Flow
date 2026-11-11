import { describe, expect, it } from "vitest";
import { absenceTest, detectIssues, flattenModel, simulate, type EngineModel } from "../src";

// Groups and child processes (A37) are only a view: the new rules' step fields survive flattening, and the
// absence test and the lost-work count give the same answers for a nested model as for the same model drawn flat.

const base = (): EngineModel => ({
  horizonWeeks: 20,
  hoursPerWeek: 40,
  leadsPerWeek: 3,
  activeClients: 0,
  churnMonthly: 0,
  retainer: 0,
  warmupWeeks: 4,
  roles: { solo: { name: "Solo", count: 1, cost: 0, ongoing: 0 }, r: { name: "R", count: 2, cost: 0, ongoing: 0 } },
  entry: "a",
  sinks: { won: "won", lost: "lost" },
  targetCycleHours: 50,
  steps: [
    { id: "a", name: "A", role: "solo", work: 10, wait: 0, rework: 0, workDist: { kind: "constant" }, expectedWaitHours: 4, lostPerDayWaiting: 0.05, dropoffBenchmark: 0.2, next: [{ to: "b", p: 0.6 }, { to: "lost", p: 0.4 }] },
    { id: "b", name: "B", role: "r", work: 2, wait: 0, rework: 0, workDist: { kind: "constant" }, next: [{ to: "won", p: 1 }] },
  ],
});

const nested = (): EngineModel => {
  const m = base();
  return {
    ...m,
    entry: "g",
    steps: [{ ...m.steps[0]!, parent: "g" }, { ...m.steps[1]!, parent: "g" }],
    groups: { g: { name: "Group", entry: "a", next: [] } },
  };
};

describe("new rules on a nested model", () => {
  it("keeps the step fields and the time target through flattening", () => {
    const flat = flattenModel(nested());
    expect(flat.targetCycleHours).toBe(50);
    expect(flat.steps[0]).toMatchObject({ expectedWaitHours: 4, lostPerDayWaiting: 0.05, dropoffBenchmark: 0.2 });
    expect(flat).not.toHaveProperty("groups");
  });

  it("counts work lost at a step and runs the absence test the same as the flat model", () => {
    const f = simulate(base(), 6, 1);
    const n = simulate(nested(), 6, 1);
    expect(n.steps.a!.lostHere).toBe(f.steps.a!.lostHere);
    expect(f.steps.a!.lostHere).toBeGreaterThan(0);
    expect(absenceTest(nested(), { reps: 3 })).toEqual(absenceTest(base(), { reps: 3 }));
    expect(absenceTest(nested(), { reps: 3 }).people.map((p) => p.personId)).toEqual(["solo#1"]);
    const keys = (m: EngineModel, r: ReturnType<typeof simulate>) => detectIssues(m, r, {}, { absence: absenceTest(m, { reps: 3 }) }).map((i) => i.key);
    expect(keys(nested(), n)).toEqual(keys(base(), f));
  });
});
