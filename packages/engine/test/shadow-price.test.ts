import { describe, expect, it } from "vitest";
import { northbeamModel, runOnce, shadowPrice, shadowPriceText, simulate, type EngineModel } from "../src";

// Shadow price of the bottleneck (docs/PRD.md §6.4, §13; issue #26): extra
// completed units per quarter from one more FTE in a role, measured with
// common random numbers against the baseline.

/**
 * One step, one person, a constant 10 hours per item, and 1,000 items already
 * waiting: the person is busy the whole horizon, so a 13-week quarter (520
 * working hours) completes exactly 52 items, and a second person doubles it.
 */
function saturated(overrides: Partial<EngineModel> = {}): EngineModel {
  return {
    horizonWeeks: 13,
    hoursPerWeek: 40,
    leadsPerWeek: 1,
    activeClients: 0,
    churnMonthly: 0,
    retainer: 0,
    roles: { dev: { name: "Developer", count: 1, cost: 50, ongoing: 0 } },
    entry: "build",
    sinks: { won: "won", lost: "lost" },
    steps: [
      {
        id: "build",
        name: "Build",
        role: "dev",
        work: 10,
        wait: 0,
        rework: 0,
        workDist: { kind: "constant" },
        currentWip: 1000,
        next: [{ to: "won", p: 1 }],
      },
    ],
    ...overrides,
  };
}

describe("shadowPrice", () => {
  it("is the capacity of one more person at a saturated single server: 520 h ÷ 10 h = 52 a quarter", () => {
    const sp = shadowPrice(saturated(), "dev", { reps: 5 })!;
    expect(sp.baselinePerQuarter).toEqual({ mean: 52, p10: 52, p90: 52 });
    expect(sp.withFtePerQuarter).toEqual({ mean: 104, p10: 104, p90: 104 });
    expect(sp.perQuarter).toEqual({ mean: 52, p10: 52, p90: 52 });
    expect(sp.patch).toEqual([{ path: "roles.dev.headcount", op: "add", value: 1 }]);
    expect(sp).toMatchObject({ roleId: "dev", reps: 5, requestedReps: 5, seed: 1, complete: true });
  });

  it("reports per quarter whatever the horizon", () => {
    // 26 weeks: 104 items without, 208 with; per quarter still 52.
    const sp = shadowPrice(saturated({ horizonWeeks: 26 }), "dev", { reps: 3 })!;
    expect(sp.perQuarter.mean).toBe(52);
  });

  it("adds a named person at the workspace's hours per week when the model has people", () => {
    // A half-time developer (20 h/week) completes 26 a quarter; one full-time hire adds 52.
    const sp = shadowPrice(saturated({ people: { ana: { name: "Ana", roles: ["dev"], capacity: 20 } } }), "dev", { reps: 3 })!;
    expect(sp.baselinePerQuarter.mean).toBe(26);
    expect(sp.perQuarter.mean).toBe(52);
  });

  it("is zero where capacity isn't the limit: demand is", () => {
    // One lead a week, 1 hour of constant work each: the developer is 2.5% busy,
    // every lead is finished within the hour, and a second developer changes nothing.
    const idle = saturated({ steps: [{ ...saturated().steps[0]!, work: 1, currentWip: 0 }], warmupWeeks: 0 });
    const sp = shadowPrice(idle, "dev", { reps: 20 })!;
    expect(sp.perQuarter.mean).toBe(0);
    expect(shadowPriceText(sp, "Developer")).toBe(
      "One more full-time Developer makes no difference to completions a quarter: capacity there isn't what limits throughput.",
    );
  });

  it("pairs replications with the baseline run: its baseline side is simulate()'s wins and done items", () => {
    const model = northbeamModel();
    const sp = shadowPrice(model, "strat", { reps: 10 })!;
    const run = simulate(model, 10, 1);
    const perRep = Array.from({ length: 10 }, (_, i) => {
      const r = runOnce(model, 1 + i * 7919, false, run.initialState);
      return r.won + r.done;
    });
    expect(sp.baselinePerQuarter.mean).toBeCloseTo(perRep.reduce((a, b) => a + b, 0) / 10, 10);
    expect(sp.baselinePerQuarter.mean).toBeCloseTo(run.kpi.won.mean + run.kpi.done.mean, 10);
  });

  it("on Northbeam: a second strategist adds wins; a second finance person adds none", () => {
    const model = northbeamModel();
    expect(simulate(model, 30, 1).bnRole).toBe("strat");
    const strat = shadowPrice(model, "strat")!;
    const fin = shadowPrice(model, "fin")!;
    expect(strat.perQuarter.mean).toBeGreaterThan(0.2);
    expect(strat.perQuarter.mean).toBeGreaterThan(fin.perQuarter.mean);
    // Finance does no pipeline work, so the paired runs are identical.
    expect(fin.perQuarter).toEqual({ mean: 0, p10: 0, p90: 0 });
    expect(shadowPriceText(strat, "Strategist")).toMatch(/^One more full-time Strategist adds avg [\d.]+ completions a quarter \(range .+\)\.$/);
  });

  it("stops early on a time budget and says so", () => {
    let t = 0;
    const sp = shadowPrice(northbeamModel(), "strat", { reps: 30, timeBudgetMs: 3, now: () => t++ })!;
    expect(sp.complete).toBe(false);
    expect(sp.reps).toBeGreaterThanOrEqual(1);
    expect(sp.reps).toBeLessThan(30);
    expect(shadowPriceText(sp, "Strategist")).toMatch(new RegExp(`from ${sp.reps} of 30 replications`));
  });

  it("is null for a role the model doesn't have", () => {
    expect(shadowPrice(saturated(), "nope")).toBeNull();
  });
});
