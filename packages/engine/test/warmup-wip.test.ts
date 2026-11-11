import { describe, expect, it } from "vitest";
import { initialState, northbeamModel, runOnce, simulate, type EngineModel, type EngineStep } from "../src";

// Initial state (docs/PRD.md §6.3.1, decision D6): a run starts from entered
// current WIP, or after an automatic warm-up that is discarded before measuring.

/**
 * A stationary two-step pipeline: a 120-hour external wait (no resource), then
 * one person at ρ = 0.8. Starting empty, nothing reaches the person for the
 * first ~120 hours, which biases a 13-week quarter's utilisation low.
 */
function pipeline(overrides: Partial<EngineModel> = {}, steps: Partial<Record<string, Partial<EngineStep>>> = {}): EngineModel {
  const base: EngineStep[] = [
    { id: "brief", name: "Client brief", role: null, work: 0, wait: 120, rework: 0, next: [{ to: "build", p: 1 }] },
    {
      id: "build",
      name: "Build",
      role: "dev",
      work: 8,
      wait: 0,
      rework: 0,
      workDist: { kind: "exponential" },
      next: [{ to: "won", p: 1 }],
    },
  ];
  return {
    horizonWeeks: 13,
    hoursPerWeek: 40,
    leadsPerWeek: 4,
    activeClients: 0,
    churnMonthly: 0,
    retainer: 1000,
    roles: { dev: { name: "Developer", count: 1, cost: 50, ongoing: 0 } },
    entry: "brief",
    sinks: { won: "won", lost: "lost" },
    steps: base.map((s) => ({ ...s, ...steps[s.id] })),
    ...overrides,
  };
}

describe("warm-up", () => {
  it("removes the empty-start bias: a 13-week quarter's utilisation matches a long steady-state run", () => {
    const steady = simulate(pipeline({ horizonWeeks: 520, warmupWeeks: 0 }), 10, 1).roles.dev!.util;
    const empty = simulate(pipeline({ warmupWeeks: 0 }), 300, 1).roles.dev!.util;
    const warmed = simulate(pipeline(), 300, 1);
    expect(steady).toBeCloseTo(0.8, 1);
    expect(warmed.initialState.kind).toBe("warmup");
    // Empty start understates utilisation by roughly 120 of 520 hours.
    expect(steady - empty).toBeGreaterThan(0.1);
    expect(Math.abs(warmed.roles.dev!.util - steady)).toBeLessThan(0.02);
  });

  it("brings a short M/M/1 run's queue length closer to the analytic value", () => {
    // M/M/1 at ρ = 0.8: Lq = ρ² / (1 − ρ) = 3.2. Over 100 hours an empty start
    // still hasn't built the queue up.
    const mm1 = (warmupWeeks?: number): EngineModel => ({
      ...pipeline({ hoursPerWeek: 1, horizonWeeks: 100, leadsPerWeek: 1, warmupWeeks }),
      entry: "build",
      steps: [{ ...pipeline().steps[1]!, work: 0.8 }],
    });
    const lq = 3.2;
    const empty = simulate(mm1(0), 400, 1).steps.build!.avgQueue;
    const warmed = simulate(mm1(), 400, 1).steps.build!.avgQueue;
    expect(Math.abs(warmed - lq)).toBeLessThan(Math.abs(empty - lq) / 2);
    expect(Math.abs(warmed - lq) / lq).toBeLessThan(0.1);
  });

  it("sizes the automatic warm-up: at least 4 weeks, 2x the pilot's P90 cycle time if longer", () => {
    const quick = pipeline({ steps: [{ ...pipeline().steps[1]!, work: 0.1 }], entry: "build" });
    expect(initialState(quick)).toEqual({ kind: "warmup", hours: 4 * 40 });
    const slow = initialState(pipeline());
    expect(slow.kind === "warmup" && slow.hours > 4 * 40 && slow.hours <= 52 * 40).toBe(true);
    // Nothing completes within the pilot's horizon: the cap.
    const capped = initialState(pipeline({}, { brief: { wait: 5000 } }));
    expect(capped).toEqual({ kind: "warmup", hours: 52 * 40 });
  });

  it("honours an explicit warm-up length, and 0 starts empty", () => {
    expect(initialState(pipeline({ warmupWeeks: 2 }))).toEqual({ kind: "warmup", hours: 80 });
    expect(initialState(pipeline({ warmupWeeks: 0 }))).toEqual({ kind: "empty" });
    expect(simulate(pipeline({ warmupWeeks: 0 }), 3, 1).initialState).toEqual({ kind: "empty" });
  });

  it("excludes the warm-up from every reported metric", () => {
    const model = pipeline({ warmupWeeks: 6, horizonWeeks: 10 }, { build: { rework: 0.3 } });
    const r = runOnce(model, 5, true, initialState(model));
    expect(r.warmupHours).toBe(240);
    const entities = r.entities!;
    // Only entities still in flight at t = 0 carry over; nothing finished before it.
    expect(entities.some((e) => e.t0 < 0)).toBe(true);
    expect(entities.every((e) => e.done === undefined || e.done >= 0)).toBe(true);
    const wonInWindow = entities.filter((e) => e.outcome === "won");
    expect(r.won).toBe(wonInWindow.length);
    const byValue = (a: number, b: number) => a - b;
    expect([...r.cycle].sort(byValue)).toEqual(wonInWindow.map((e) => e.done! - e.t0).sort(byValue));
    const segs = entities.flatMap((e) => e.trace);
    for (const step of ["brief", "build"]) {
      expect(r.steps[step]!.arrivals).toBe(segs.filter((s) => s.step === step && s.tQ >= 0).length);
    }
    // A rework is a repeat visit to build that started in the measured window.
    const repeats = entities.flatMap((e) => e.trace.filter((s, i) => s.step === "build" && s.tQ >= 0 && i > 1));
    expect(r.steps.build!.reworks).toBe(repeats.length);
    expect(repeats.length).toBeGreaterThan(0);
    const completed = segs.filter((s) => s.person === "dev#1" && s.tE !== null && s.tE >= 0 && s.tE <= r.H).length;
    expect(r.people["dev#1"]!.completed).toBe(completed);
    // Hands-on time is only counted from t = 0: utilisation is a share of the measured window.
    expect(r.roles.dev!.util).toBeLessThanOrEqual(1.05);
  });

  it("holds the client count at the roster during the warm-up", () => {
    const model = { ...northbeamModel(), churnMonthly: 0 };
    const withWarmup = runOnce(model, 3, false);
    const empty = runOnce({ ...model, warmupWeeks: 0 }, 3, false);
    expect(withWarmup.activeEnd).toBe(model.activeClients + withWarmup.won);
    expect(empty.activeEnd).toBe(model.activeClients + empty.won);
  });
});

describe("current WIP", () => {
  it("starts from entered WIP instead of a warm-up", () => {
    const model = pipeline({ warmupWeeks: 8 }, { build: { currentWip: 5 }, brief: { currentWip: 2 } });
    expect(initialState(model)).toEqual({ kind: "wip", items: 7 });
    const res = simulate(model, 5, 1);
    expect(res.initialState).toEqual({ kind: "wip", items: 7 });
    expect(runOnce(model, 1, false).warmupHours).toBe(0);
  });

  it("treats WIP entered as 0 as entered: the run starts from it, not a warm-up", () => {
    expect(initialState(pipeline({}, { build: { currentWip: 0 } }))).toEqual({ kind: "wip", items: 0 });
  });

  it("starts with that many items at each step and processes all of them", () => {
    // No new leads: exactly the WIP flows through.
    const model = pipeline({ leadsPerWeek: 0, horizonWeeks: 40 }, { build: { currentWip: 6 }, brief: { currentWip: 3 } });
    const r = runOnce(model, 2, true);
    const entities = r.entities!;
    expect(entities).toHaveLength(9);
    expect(entities.filter((e) => e.trace[0]!.step === "build")).toHaveLength(6);
    expect(entities.filter((e) => e.trace[0]!.step === "brief")).toHaveLength(3);
    expect(r.won).toBe(9);
    expect(r.cycle).toHaveLength(9);
    // WIP arrived before the run: it is queued, not counted as new arrivals.
    expect(r.steps.build!.arrivals).toBe(3);
    expect(r.steps.brief!.arrivals).toBe(0);
    // The developer takes the oldest at t = 0; the other five queue.
    expect(r.steps.build!.maxQueue).toBe(5);
    expect(r.steps.build!.wip).toBe(0);
  });

  it("samples ages uniformly over the step's expected wait", () => {
    const model = pipeline({ leadsPerWeek: 0 }, { brief: { currentWip: 400 }, build: { currentWip: 400 } });
    const first = runOnce(model, 4, true).entities!.map((e) => e.trace[0]!);
    const ages = (step: string) => first.filter((s) => s.step === step).map((s) => -s.tQ);
    const brief = ages("brief");
    const build = ages("build");
    // brief: its 120-hour wait; build has no wait, so its 8-hour work time.
    expect(Math.min(...brief)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...brief)).toBeLessThanOrEqual(120);
    expect(brief.reduce((a, b) => a + b, 0) / brief.length).toBeCloseTo(60, -1);
    expect(Math.max(...build)).toBeLessThanOrEqual(8);
    expect(build.reduce((a, b) => a + b, 0) / build.length).toBeCloseTo(4, 0);
  });

  it("serves WIP before anything that arrives during the run, oldest first", () => {
    const model = pipeline({ leadsPerWeek: 8 }, { build: { currentWip: 10 } });
    const entities = runOnce(model, 9, true).entities!;
    const builds = entities
      .flatMap((e) => e.trace.filter((s) => s.step === "build" && s.tS !== null).map((s) => ({ s, wip: e.t0 < 0 })))
      .sort((a, b) => a.s.tS! - b.s.tS!);
    expect(builds.slice(0, 10).every((b) => b.wip)).toBe(true);
    const wipStarts = builds.slice(0, 10).map((b) => b.s.tQ);
    expect(wipStarts).toEqual([...wipStarts].sort((a, b) => a - b));
  });

  it("counts WIP towards throughput and cycle time, measured from its sampled age", () => {
    const model = pipeline({ leadsPerWeek: 0 }, { build: { currentWip: 4 } });
    const r = runOnce(model, 1, true);
    for (const e of r.entities!) {
      expect(e.outcome).toBe("won");
      expect(r.cycle).toContain(e.done! - e.t0);
      expect(e.done! - e.t0).toBeGreaterThan(e.done!);
    }
  });

  it("is deterministic and leaves other streams alone", () => {
    const model = { ...northbeamModel() };
    model.steps = model.steps.map((s) => (s.id === "audit" ? { ...s, currentWip: 8 } : s.id === "onboard" ? { ...s, currentWip: 3 } : s));
    expect(simulate(model, 10, 7)).toEqual(simulate(model, 10, 7));
    // Arrivals during the run do not depend on the WIP entered.
    const arrivals = (m: EngineModel) =>
      runOnce(m, 7, true)
        .entities!.map((e) => e.t0)
        .filter((t) => t >= 0);
    const more = { ...model, steps: model.steps.map((s) => (s.id === "audit" ? { ...s, currentWip: 20 } : s)) };
    expect(arrivals(more)).toEqual(arrivals(model));
  });
});
