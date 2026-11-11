import { describe, expect, it } from "vitest";
import { northbeamModel, pct, runOnce, simulate, type Stat } from "../src";

const SEED_STRIDE = 7919;

function expectOrdered(s: Stat) {
  expect(s.p10).toBeLessThanOrEqual(s.mean + 1e-9);
  expect(s.mean).toBeLessThanOrEqual(s.p90 + 1e-9);
}

describe("ranges across replications", () => {
  const model = northbeamModel();
  const res = simulate(model, 30, 1);
  const runs = Array.from({ length: 30 }, (_, i) => runOnce(model, 1 + i * SEED_STRIDE, false));

  it("reports mean, P10 and P90 for every global headline metric", () => {
    for (const key of ["won", "lost", "labour", "costPerWin", "mrrAdded", "wipEnd"] as const) {
      expectOrdered(res.kpi[key]);
    }
  });

  it("matches the per-replication values", () => {
    const won = runs.map((r) => r.won);
    expect(res.kpi.won).toEqual({ mean: won.reduce((a, b) => a + b, 0) / 30, p10: pct(won, 0.1), p90: pct(won, 0.9) });
    expect(res.kpi.won.mean).toBe(res.won);
    expect(res.kpi.lost.mean).toBe(res.lost);
    const mrr = runs.map((r) => r.won * model.retainer);
    expect(res.kpi.mrrAdded.p90).toBe(pct(mrr, 0.9));
  });

  it("gives labour in the same units as the legacy total", () => {
    expect(res.kpi.labour.mean).toBeCloseTo(res.labour, 6);
  });

  it("reports cycle time as mean, P50 and P90 across all completed items", () => {
    const all = runs.flatMap((r) => r.cycle);
    expect(res.kpi.cycle.p50).toBe(res.cycleP50);
    expect(res.kpi.cycle.p90).toBe(res.cycleP90);
    expect(res.kpi.cycle.mean).toBeCloseTo(all.reduce((a, b) => a + b, 0) / all.length, 9);
    expect(res.kpi.cycle.p50).toBeLessThanOrEqual(res.kpi.cycle.p90);
  });

  it("reports a utilisation band per role", () => {
    for (const rid of Object.keys(model.roles)) {
      const band = res.kpi.roles[rid]!;
      expectOrdered(band.util);
      expectOrdered(band.pipeline);
      expect(band.util.mean).toBeCloseTo(res.roles[rid]!.util, 12);
      expect(band.util.p90).toBe(pct(runs.map((r) => r.roles[rid]!.util), 0.9));
    }
  });

  it("skips replications with no wins when averaging cost per win", () => {
    const starved = { ...northbeamModel(), leadsPerWeek: 0.3, horizonWeeks: 4 };
    const r = simulate(starved, 20, 1);
    expect(Number.isFinite(r.kpi.costPerWin.mean)).toBe(true);
    expect(r.kpi.costPerWin.p10).toBeGreaterThanOrEqual(0);
  });
});
