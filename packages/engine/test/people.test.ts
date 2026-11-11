import { describe, expect, it } from "vitest";
import { northbeamModel, resolvePeople, runOnce, simulate, type EngineModel, type EnginePerson } from "../src";

/** Northbeam with named people instead of head-counts. */
function withPeople(extra: Partial<Record<string, Partial<EnginePerson>>> = {}): EngineModel {
  const base = northbeamModel();
  const people: Record<string, EnginePerson> = {};
  for (const [rid, role] of Object.entries(base.roles)) {
    for (let i = 1; i <= role.count; i++) {
      const id = `${rid}-${i}`;
      people[id] = { name: `${role.name} ${i}`, roles: [rid], capacity: base.hoursPerWeek, ...extra[id] };
    }
  }
  return { ...base, people };
}

/** Who started serving `step` in the measured window (the warm-up before t = 0 is history). */
const servedBy = (model: EngineModel, step: string, seed = 1) =>
  runOnce(model, seed, true).entities!.flatMap((e) =>
    e.trace.filter((s) => s.step === step && s.person && s.tS! >= 0).map((s) => s.person!),
  );

describe("named people", () => {
  it("synthesises one person per head-count when a model has no people", () => {
    const people = resolvePeople(northbeamModel());
    expect(Object.keys(people)).toHaveLength(11);
    expect(people["seo#3"]).toMatchObject({ name: "SEO specialist 3", roles: ["seo"], capacity: 40 });
  });

  it("dispatches to individuals and records who did each step", () => {
    const who = new Set(servedBy(withPeople(), "qualify"));
    expect(who).toEqual(new Set(["sales-1", "sales-2"]));
  });

  it("only lets the pinned person work a pinned step", () => {
    const model = withPeople();
    model.steps = model.steps.map((s) => (s.id === "seo" ? { ...s, person: "seo-2" } : s));
    expect(new Set(servedBy(model, "seo"))).toEqual(new Set(["seo-2"]));
    // SEO setup is the only SEO step, so the other SEO specialists stay idle.
    const res = simulate(model, 10, 1);
    expect(res.people["seo-1"]!.pipeline).toBe(0);
    expect(res.people["seo-2"]!.pipeline).toBeGreaterThan(0);
  });

  it("respects skills: a person only does the steps listed", () => {
    const model = withPeople({ "sales-2": { skills: ["discovery"] } });
    expect(servedBy(model, "qualify").every((p) => p === "sales-1")).toBe(true);
    expect(new Set(servedBy(model, "discovery"))).toEqual(new Set(["sales-1", "sales-2"]));
  });

  it("starts no work for a person on leave; colleagues pick up the queue", () => {
    const leave: [number, number] = [0, 13 * 40];
    const model = withPeople({ "am-1": { leave: [leave] } });
    const who = [...servedBy(model, "onboard"), ...servedBy(model, "live")];
    expect(who.length).toBeGreaterThan(0);
    expect(who.every((p) => p === "am-2")).toBe(true);
  });

  it("picks work back up after leave ends", () => {
    const model = withPeople({ "strat-1": { leave: [[40, 200]] } });
    const segs = runOnce(model, 1, true).entities!.flatMap((e) => e.trace.filter((s) => s.person === "strat-1"));
    expect(segs.some((s) => s.tS! >= 40 && s.tS! < 200)).toBe(false);
    expect(segs.some((s) => s.tS! >= 200)).toBe(true);
  });

  it("slows a part-time person down: half the capacity, longer elapsed service", () => {
    const full = withPeople();
    const half = withPeople({ "strat-1": { capacity: 20 } });
    expect(simulate(half, 30, 1).kpi.cycle.mean).toBeGreaterThan(simulate(full, 30, 1).kpi.cycle.mean);
    expect(simulate(half, 30, 1).people["strat-1"]!.util).toBeGreaterThan(simulate(full, 30, 1).people["strat-1"]!.util);
  });

  it("shares work fairly between identical people", () => {
    const res = simulate(withPeople(), 30, 1);
    const [a, b, c] = ["seo-1", "seo-2", "seo-3"].map((id) => res.people[id]!.pipeline);
    expect(Math.max(a!, b!, c!) - Math.min(a!, b!, c!)).toBeLessThan(0.05);
  });

  it("reports per-person utilisation that rolls up to the role", () => {
    const res = simulate(withPeople(), 30, 1);
    const avgSales = (res.people["sales-1"]!.util + res.people["sales-2"]!.util) / 2;
    expect(avgSales).toBeCloseTo(res.roles.sales!.util, 10);
    expect(res.kpi.people["strat-1"]!.util.mean).toBeCloseTo(res.people["strat-1"]!.util, 12);
    expect(res.bnPerson).toBe("strat-1");
  });

  it("uses the model's availability floor", () => {
    // Retainer load alone exceeds the strategist's week, so only the floor is left for pipeline work.
    const overloaded = withPeople();
    overloaded.roles = { ...overloaded.roles, strat: { ...overloaded.roles.strat!, ongoing: 5 } };
    const low = simulate({ ...overloaded, availabilityFloor: 0.05 }, 10, 1);
    const high = simulate({ ...overloaded, availabilityFloor: 0.3 }, 10, 1);
    expect(high.won).toBeGreaterThan(low.won);
  });
});
