import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyPatches,
  compareHeadline,
  compareRuns,
  northbeamModel,
  simulate,
  type Comparison,
  type SimulationResult,
  type Stat,
} from "../src";

const ROLE_NAMES = Object.fromEntries(Object.entries(northbeamModel().roles).map(([id, r]) => [id, r.name]));
const base = { horizonWeeks: 13, hoursPerWeek: 40, currency: "GBP", roleNames: ROLE_NAMES };

const s = (mean: number, p10: number, p90: number): Stat => ({ mean, p10, p90 });
const flat = (v: number) => s(v, v, v);

/** A comparison with only the fields a test cares about set. */
function comparison(over: Partial<Comparison> = {}): Comparison {
  const zero = { baseline: flat(0), scenario: flat(0), delta: flat(0), paired: true };
  return {
    won: zero,
    lost: zero,
    mrrAdded: zero,
    billed: zero,
    labour: zero,
    wipEnd: zero,
    cycle: zero,
    bottleneck: { baseline: null, scenario: null },
    roles: {},
    people: {},
    ...over,
  };
}
const d = (delta: Stat) => ({ baseline: flat(0), scenario: flat(0), delta, paired: true });

describe("compareRuns", () => {
  it("pairs replications run with the same seed (common random numbers)", () => {
    const baseline = simulate(northbeamModel(), 20, 1);
    const scenario = simulate(applyPatches(northbeamModel(), [{ path: "roles.strat.headcount", op: "add", value: 1 }]).model, 20, 1);
    const c = compareRuns(baseline, scenario);
    expect(c.won.paired).toBe(true);
    expect(c.won.baseline).toEqual(baseline.kpi.won);
    expect(c.won.scenario).toEqual(scenario.kpi.won);
    expect(c.won.delta.mean).toBeCloseTo(scenario.kpi.won.mean - baseline.kpi.won.mean);
    // Pairing removes the shared noise: the delta's band is narrower than the sides' spread.
    expect(c.won.delta.p90 - c.won.delta.p10).toBeLessThan(scenario.kpi.won.p90 - baseline.kpi.won.p10);
    // Utilisation per role and per person on both sides; the hire only on the scenario side.
    expect(c.roles.strat!.baseline).toEqual(baseline.kpi.roles.strat!.util);
    expect(c.roles.strat!.scenario!.mean).toBeLessThan(c.roles.strat!.baseline!.mean);
    expect(c.people["strat#2"]).toEqual({ scenario: scenario.kpi.people["strat#2"]!.util });
    expect(c.bottleneck.baseline).toBe("strat");
  });

  it("falls back to the widest band when the runs can't be paired", () => {
    const a = simulate(northbeamModel(), 10, 1);
    const b = simulate(northbeamModel(), 10, 2);
    const c = compareRuns(a, b);
    expect(c.won.paired).toBe(false);
    expect(c.won.delta).toEqual({ mean: b.kpi.won.mean - a.kpi.won.mean, p10: b.kpi.won.p10 - a.kpi.won.p90, p90: b.kpi.won.p90 - a.kpi.won.p10 });
  });
});

describe("compareHeadline (templated)", () => {
  it("states a gain with its average and range, per quarter", () => {
    const h = compareHeadline({ ...base, comparison: comparison({ won: d(s(2.1, 1.4, 2.9)) }), subject: "“Automate proposals”" });
    expect(h.headline).toBe("“Automate proposals” adds avg 2.1 wins/quarter (range 1.4–2.9).");
  });

  it("scales to a quarter from the horizon", () => {
    const h = compareHeadline({ ...base, horizonWeeks: 26, comparison: comparison({ won: d(s(4.2, 2.8, 5.8)) }), subject: "X" });
    expect(h.headline).toBe("X adds avg 2.1 wins/quarter (range 1.4–2.9).");
  });

  it("states a loss, a no-change and an unclear change, with plural subjects", () => {
    const loss = compareHeadline({ ...base, comparison: comparison({ won: d(s(-1.5, -2.25, -0.5)) }), subject: "“Downturn”" });
    expect(loss.headline).toBe("“Downturn” costs avg 1.5 wins/quarter (range 0.5–2.3).");
    const none = compareHeadline({ ...base, comparison: comparison(), subject: "These lever changes", plural: true });
    expect(none.headline).toBe("These lever changes make no difference to wins per quarter.");
    const unclear = compareHeadline({ ...base, comparison: comparison({ won: d(s(0.4, -0.5, 1.1)) }), subject: "“A” + “B”", plural: true });
    expect(unclear.headline).toBe("“A” + “B” add avg 0.4 wins/quarter, but the range includes no change (−0.5 to 1.1).");
  });

  it("adds money, cycle time and bottleneck sentences", () => {
    const h = compareHeadline({
      ...base,
      subject: "“Hire a strategist”",
      comparison: comparison({
        won: d(s(2, 1, 3)),
        mrrAdded: d(s(4200, 3100, 5000)),
        cycle: d(s(-16, -24, -8)),
        bottleneck: { baseline: "strat", scenario: "seo" },
        roles: { strat: { baseline: s(0.97, 0.9, 1), scenario: s(0.6, 0.5, 0.7) }, seo: { baseline: s(0.8, 0.7, 0.9), scenario: s(0.88, 0.8, 0.95) } },
      }),
    });
    expect(h.details).toEqual([
      "New MRR rises by avg £4,200 a quarter (range £3,100–£5,000).",
      "Cycle time falls by avg 2 days (range 1–3).",
      "The bottleneck moves from Strategist (97%) to SEO specialist (88%).",
    ]);
    const same = compareHeadline({
      ...base,
      subject: "X",
      comparison: comparison({ bottleneck: { baseline: "strat", scenario: "strat" }, roles: { strat: { baseline: s(0.97, 0.9, 1), scenario: s(0.8, 0.7, 0.9) } } }),
    });
    expect(same.details).toEqual(["Strategist stays the bottleneck at 80% utilised (was 97%)."]);
  });

  it("works end to end on real runs", () => {
    const baseline = simulate(northbeamModel(), 30, 1);
    const scenario = simulate(applyPatches(northbeamModel(), [{ path: "steps.audit.work_hours", op: "multiply", value: 0.4 }]).model, 30, 1);
    const h = compareHeadline({ ...base, comparison: compareRuns(baseline, scenario), subject: "“Automate proposals”" });
    expect(h.headline).toMatch(/^“Automate proposals” (adds|costs|makes)/);
    // Deterministic: the same inputs always give the same words.
    expect(compareHeadline({ ...base, comparison: compareRuns(baseline, scenario), subject: "“Automate proposals”" })).toEqual(h);
  });
});

describe("no language model is involved in the headline", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is a synchronous pure function: no network, clock or randomness is touched", () => {
    const fetch = vi.fn(() => {
      throw new Error("network used");
    });
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("XMLHttpRequest", fetch);
    vi.stubGlobal("WebSocket", fetch);
    const random = vi.spyOn(Math, "random");
    const now = vi.spyOn(Date, "now");
    const input = { ...base, comparison: comparison({ won: d(s(2.1, 1.4, 2.9)) }), subject: "“Automate proposals”" };
    const out = compareHeadline(input);
    expect(out).not.toBeInstanceOf(Promise);
    expect(out.headline).toBe("“Automate proposals” adds avg 2.1 wins/quarter (range 1.4–2.9).");
    expect(fetch).not.toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });

  it("the module imports nothing but the engine's own code, and names no network or LLM API", () => {
    const src = readFileSync(new URL("../src/compare.ts", import.meta.url), "utf8");
    const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports.every((i) => i!.startsWith("./"))).toBe(true);
    expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|anthropic|openai|process\.env|import\(/i);
  });
});

describe("result shape", () => {
  it("carries per-replication samples and the seed", () => {
    const r: SimulationResult = simulate(northbeamModel(), 7, 5);
    expect(r.seed).toBe(5);
    expect(r.samples.won).toHaveLength(7);
    expect(r.samples.won.reduce((a, b) => a + b, 0) / 7).toBeCloseTo(r.kpi.won.mean);
  });
});
