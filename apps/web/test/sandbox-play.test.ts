import { describe, expect, it } from "vitest";
import {
  applyPlay,
  capacitySetupFromModel,
  defaultPlay,
  hireIds,
  playChanges,
  playIsDefault,
  priceDriverEffect,
  splitWhole,
  toEngineStepChanges,
  winEntries,
  winMix,
  PLAY_MONTHS,
  PRICE_REACTION,
  PRICE_RISE_MONTHS,
  playSliderRanges,
  priceRiseMonths,
  type StoredStepChange,
  type PlayContext,
  type PlayState,
} from "@transpera-flow/db";
import { capacityModel, simulate, type EngineModel } from "@transpera-flow/engine";
import { prepareScenario } from "@transpera-flow/db/sandbox";
import { DEMO_FORECAST_SOLUTION, DEMO_FORECAST_START, demoForecastBundle } from "@/lib/forecast/demo";

// The free-play Sandbox's levers (capacity build P7, docs/plans/capacity/p7-sandbox-brief.md section 3): each prototype lever becomes the
// expected registry change or model edit, "Win new clients" lands N x k clients by tier, "Clients react" doubles from Barely to Normally,
// a named client leaves, and a map version runs its map and the automations and augmentations it holds (D53), from its month.

const START = "2026-11-02";

/** Today's example agency (no change in force: `changes` is unset, as in a real workspace, whose changes are part of solutions). */
const { changes: _changes, ...today } = capacityModel();
void _changes;
const model: EngineModel = today;
const setup = capacitySetupFromModel(model);
for (const s of setup.services) s.price_rise_churn = 0.5;
const ctx: PlayContext = { startDate: START, setup, winMix: (d) => winMix(setup, model, d) };
const play = (over: Partial<PlayState> = {}): PlayState => ({ ...defaultPlay(), ...over });

describe("the levers become registry changes", () => {
  it("nothing moved is no change at all, and the default is recognised", () => {
    expect(playChanges(defaultPlay(), ctx)).toEqual([]);
    expect(playIsDefault(defaultPlay())).toBe(true);
    expect(playIsDefault(play({ leads: 5 }))).toBe(false);
    expect(applyPlay(model, defaultPlay(), ctx)).toBe(model);
  });

  it("A1 leads and A3 win rate: a multiple, from the market's month", () => {
    const c = playChanges(play({ leads: 10, win: -20, marketFrom: 3 }), ctx);
    expect(c).toMatchObject([
      { lever: "A1", target: null, op: "multiply", value: 1.1, from: "2027-02" },
      { lever: "A3", target: null, op: "multiply", value: 0.8, from: "2027-02" },
    ]);
  });

  it("B3 churn: a multiple of base churn for the whole run", () => {
    const [c] = playChanges(play({ churn: 25 }), ctx);
    expect(c).toMatchObject({ lever: "B3", target: null, op: "multiply", value: 1.25 });
    expect(c!.from).toBeUndefined();
  });

  it("B5 prices: all tiers is one change, a tier is one per service of that tier in both departments", () => {
    expect(playChanges(play({ price: 8, priceFrom: 3 }), ctx)).toMatchObject([{ lever: "B5", target: null, op: "set", value: 0.08, from: "2027-02" }]);
    const t2 = playChanges(play({ price: 8, priceFrom: 0, priceTier: "T2" }), ctx);
    expect(t2.map((c) => c.target).sort()).toEqual(["org-T2", "perf-T2"]);
    expect(t2.every((c) => c.lever === "B5" && c.value === 0.08 && c.from === "2026-11")).toBe(true);
  });

  it("D2 someone leaves, D1 a hire, E6 a map version: each from its month", () => {
    const c = playChanges(play({ leavers: [{ person: "diya", month: 2 }], hires: [{ role: "links", month: 4 }], versions: { proc: { solution: "sol-1", month: 5 } } }), ctx);
    expect(c).toMatchObject([
      { lever: "D2", target: "diya", op: "set", value: 0, from: "2027-01" },
      { lever: "D1", target: "links", op: "set", value: 1, from: "2027-03" },
      { lever: "E6", target: "sol-1", op: "set", value: 1, from: "2027-04" },
    ]);
    expect(new Set(c.map((x) => x.id)).size).toBe(3);
    expect(hireIds(play({ hires: [{ role: "links", month: 4 }] }))).toEqual([c[1]!.id]);
  });

  it("the months are clamped to the run", () => {
    const c = playChanges(play({ leads: 5, marketFrom: 99 }), ctx);
    expect(c[0]!.from).toBe("2027-10");
  });
});

describe("Win new clients", () => {
  it("shares a total across tiers by largest remainder, to the total exactly", () => {
    expect(splitWhole(6, [0.1, 0.4, 0.5])).toEqual([1, 2, 3]);
    expect(splitWhole(7, [0.1, 0.4, 0.5])).toEqual([1, 3, 3]);
    expect(splitWhole(5, [1, 1])).toEqual([3, 2]);
    expect(splitWhole(0, [1, 1])).toEqual([0, 0]);
  });

  it("N clients a month for k months land N x k clients, in the usual mix by tier", () => {
    const entries = winEntries(play({ add: { org: 2, perf: 1 }, addFrom: 1, addMonths: 6 }), ctx);
    const total = (dept: string) => entries.filter((e) => e.service.startsWith(dept)).reduce((s, e) => s + e.count, 0);
    expect(total("org")).toBe(12);
    expect(total("perf")).toBe(6);
    // The mix is 10 / 40 / 50: 12 -> 1, 5, 6 (largest remainder: 1.2, 4.8, 6 -> 1, 5, 6).
    const byTier = (dept: string) => Object.fromEntries(["T1", "T2", "T3"].map((t) => [t, entries.filter((e) => e.service === `${dept}-${t}`).reduce((s, e) => s + e.count, 0)]));
    expect(byTier("org")).toEqual({ T1: 1, T2: 5, T3: 6 });
    // Six months, from month 2 (1-based) to month 7.
    expect(Math.min(...entries.map((e) => e.month))).toBe(2);
    expect(Math.max(...entries.map((e) => e.month))).toBe(7);
  });

  it("one tier takes them all, spread over the months with the extra ones first", () => {
    const entries = winEntries(play({ add: { org: 1 }, addFrom: 0, addMonths: 3, addTier: "T2" }), ctx);
    expect(entries).toEqual([
      { service: "org-T2", month: 1, count: 1 },
      { service: "org-T2", month: 2, count: 1 },
      { service: "org-T2", month: 3, count: 1 },
    ]);
    expect(winEntries(play({ add: { org: 1, perf: 0 }, addMonths: 1, addTier: "T9" }), ctx)).toEqual([]);
  });

  it("run through the engine, the clients land and are placed least busy", () => {
    const m = applyPlay(model, play({ add: { org: 2 }, addFrom: 1, addMonths: 3, addTier: "T2" }), ctx);
    expect(m.placeNewClients).toBe("least-busy");
    expect(m.wonClients).toHaveLength(3);
    const a = simulate(model, 3, 1, { monthly: true });
    const b = simulate(m, 3, 1, { monthly: true });
    const last = (r: typeof a) => r.monthly!.clients["org-T2"]!.at(-1)!.mean;
    // 2 a month for 3 months = 6, less what the example's churn takes of them in the months after.
    expect(last(b) - last(a)).toBeGreaterThan(4.3);
    expect(last(b) - last(a)).toBeLessThan(6.6);
    expect(b.kpi.won.mean).toBeGreaterThanOrEqual(a.kpi.won.mean + 5);
  });
});

describe("Clients react to a price rise (D36)", () => {
  const rise = (reaction: PlayState["priceReaction"]) => play({ price: 10, priceFrom: 2, priceReaction: reaction });

  it("the price driver is set to 0.5x, 1x and 2x the tier's extra churn for a 10% rise", () => {
    expect(PRICE_REACTION.barely.factor).toBe(0.5);
    expect(PRICE_REACTION.normally.factor).toBe(1);
    expect(PRICE_REACTION.strongly.factor).toBe(2);
    expect(priceDriverEffect(rise("barely"), setup)).toBeCloseTo(0.25, 12);
    expect(priceDriverEffect(rise("normally"), setup)).toBeCloseTo(0.5, 12);
    expect(priceDriverEffect(rise("strongly"), setup)).toBeCloseTo(1, 12);
    expect(priceDriverEffect(rise("normally"), setup)).toBe(2 * priceDriverEffect(rise("barely"), setup));
  });

  it("one tier takes that tier's own rate, and all tiers the mean weighted by clients", () => {
    const s2 = { ...setup, services: setup.services.map((s) => ({ ...s, price_rise_churn: s.tier_id === "T1" ? 2 : 0.4 })) };
    expect(priceDriverEffect(play({ price: 10, priceTier: "T1", priceReaction: "normally" }), s2)).toBeCloseTo(2, 12);
    expect(priceDriverEffect(play({ price: 10, priceTier: "T3", priceReaction: "normally" }), s2)).toBeCloseTo(0.4, 12);
    const all = priceDriverEffect(play({ price: 10, priceReaction: "normally" }), s2);
    expect(all).toBeGreaterThan(0.4);
    expect(all).toBeLessThan(2);
  });

  // Two 6-month engine runs: about 2 s alone, but over the default 5 s on a busy CI runner beside the rest of the suite.
  it("run through the engine, Normally loses about twice the clients Barely does to the rise", { timeout: 60_000 }, () => {
    // The workspace's own price driver is on with a planned 10% rise in month 3; the lever sets how hard clients react.
    const base: EngineModel = { ...model, churnDrivers: [{ id: "price", weight: 1, enabled: true, value: 10, month: 3 }] };
    const lost = (reaction: PlayState["priceReaction"]) => {
      const r = simulate(applyPlay(base, rise(reaction), ctx), 6, 1, { monthly: true });
      return r.churnCauses!.causes.find((c) => c.id === "price")!.clients;
    };
    const barely = lost("barely");
    const normally = lost("normally");
    expect(barely).toBeGreaterThan(0);
    expect(normally / barely).toBeGreaterThan(1.6);
    expect(normally / barely).toBeLessThan(2.4);
    const driver = applyPlay(base, rise("normally"), ctx).churnDrivers!.find((d) => d.id === "price")!;
    expect(driver).toMatchObject({ enabled: true, effect: 0.5, effectMonths: 3, value: 10, month: 3 });
  });
});

describe("a named client leaves in a month", () => {
  it("sets leavesMonth on that client only", () => {
    const id = Object.keys(model.clients!)[0]!;
    const m = applyPlay(model, play({ lose: [{ id, month: 3 }, { id: "nobody", month: 1 }] }), ctx);
    expect(m.clients![id]!.leavesMonth).toBe(4);
    expect(Object.values(m.clients!).filter((c) => c.leavesMonth !== undefined)).toHaveLength(1);
    expect(model.clients![id]!.leavesMonth).toBeUndefined();
  });

  it("run through the engine, that client is gone from that month and counts as lost", () => {
    const id = Object.keys(model.clients!)[0]!;
    const svc = model.clients![id]!.services[0]!;
    const a = simulate(model, 4, 1, { monthly: true });
    const b = simulate(applyPlay(model, play({ lose: [{ id, month: 3 }] }), ctx), 4, 1, { monthly: true });
    const at = (r: typeof a, m: number) => r.monthly!.clients[svc]![m]!.mean;
    expect(at(b, 1)).toBeCloseTo(at(a, 1), 6);
    expect(at(a, 6) - at(b, 6)).toBeGreaterThan(0.9);
    expect(at(a, 6) - at(b, 6)).toBeLessThan(1.1);
  });
});

describe("hires and the market", () => {
  it("a hire takes the workspace's ramp unless it has its own", () => {
    const people = { ...model.people!, [hireIds(play({ hires: [{ role: "links", month: 3 }] }))[0]!]: { name: "New links", roles: ["links"], capacity: 40 } };
    const id = Object.keys(people).at(-1)!;
    const m = applyPlay({ ...model, people }, play({ hires: [{ role: "links", month: 3 }] }), ctx, new Set([id]));
    expect(m.people![id]!.ramp).toEqual([0.4, 0.6, 0.8]);
    expect(m.people!.diya?.ramp).toBeUndefined();
  });

  it("conditions apply from the month, with the workspace's own schedule before it", () => {
    const m = applyPlay(model, play({ market: "downturn", marketFrom: 4 }), ctx);
    expect(m.market!.months).toHaveLength(PLAY_MONTHS);
    expect(m.market!.months[3]!.leads).toBe(1);
    expect(m.market!.months[4]!.leads).toBe(0.65);
    expect(m.market!.months[11]!.churn).toBe(1.35);
  });
});

describe("a map version per process", () => {
  const bundle = demoForecastBundle();
  const demoCtx: PlayContext = { ...ctx, startDate: DEMO_FORECAST_START };

  it("picking a solution runs its map from the month it is live, and today's map before", () => {
    const c = playChanges(play({ versions: { [DEMO_FORECAST_SOLUTION.process_id]: { solution: DEMO_FORECAST_SOLUTION.id, month: 3 } } }), demoCtx);
    expect(c).toHaveLength(1);
    const eff = c.map((change) => ({ change, scenarioId: "play", scenarioName: "Free play", inherited: false }));
    const prepared = prepareScenario(bundle, eff, [DEMO_FORECAST_SOLUTION], 12, DEMO_FORECAST_START, { pair: false });
    expect(prepared.error).toBeNull();
    expect(prepared.problems).toEqual([]);
    // Two runs: today's map from the start, the solution's from month 3; the solution halves the PPC set-up step.
    expect(prepared.segments.map((s) => s.from)).toEqual([0, 3]);
    const ppc = (m: EngineModel) => m.steps.find((s) => s.id === DEMO_FORECAST_SOLUTION.changed_step_ids[0])!.work;
    expect(ppc(prepared.segments[1]!.model)).toBe(ppc(prepared.segments[0]!.model) / 2);
    // Picking nothing is one run of today's map.
    const none = prepareScenario(bundle, [], [DEMO_FORECAST_SOLUTION], 12, DEMO_FORECAST_START, { pair: false });
    expect(none.segments).toHaveLength(1);
    expect(ppc(none.segments[0]!.model)).toBe(ppc(prepared.segments[0]!.model));
  });

  it("a solution live from the first month is one run of its map", () => {
    const c = playChanges(play({ versions: { p: { solution: DEMO_FORECAST_SOLUTION.id, month: 0 } } }), demoCtx);
    const prepared = prepareScenario(bundle, c.map((change) => ({ change, scenarioId: "play", scenarioName: "Free play", inherited: false })), [DEMO_FORECAST_SOLUTION], 12, DEMO_FORECAST_START, { pair: false });
    expect(prepared.segments).toHaveLength(1);
    expect(prepared.segments[0]!.model.steps.find((s) => s.id === DEMO_FORECAST_SOLUTION.changed_step_ids[0])!.work).toBe(4);
  });
});

describe("the automations and augmentations a map version holds (D53)", () => {
  const bundle = demoForecastBundle();
  const demoCtx: PlayContext = { ...ctx, startDate: DEMO_FORECAST_START };
  const ppc = DEMO_FORECAST_SOLUTION.changed_step_ids[0]!;
  const change: StoredStepChange = {
    id: "5c000000-0000-4000-8000-000000000001",
    name: "Draft set-ups with a template",
    kind: "automation",
    effects: [{ step: ppc, part: "automatable", remove: 0.5, residualHours: 0.25 }],
    adoption: 0.8,
    ramp_months: 2,
    tiers: ["T1"],
    cost_monthly: 90,
  };
  const holding = { ...DEMO_FORECAST_SOLUTION, step_changes: [change] };
  const prepare = (months: number, solutions = [holding], issueOf?: PlayContext["issueOf"]) => {
    const c = playChanges(play({ versions: { [holding.process_id]: { solution: holding.id, month: months } } }), demoCtx);
    return prepareScenario(bundle, c.map((x) => ({ change: x, scenarioId: "play", scenarioName: "Free play", inherited: false })), solutions, 12, DEMO_FORECAST_START, { pair: false, ...(issueOf ? { issueOf } : {}) });
  };

  it("become engine changes starting in the month the version is picked (1-based), in the segments from then on and not before", () => {
    const prepared = prepare(3);
    expect(prepared.segments.map((s) => s.from)).toEqual([0, 3]);
    expect(prepared.segments[0]!.model.changes).toBeUndefined();
    expect(prepared.segments[1]!.model.changes).toEqual(toEngineStepChanges(holding, 4));
    expect(prepared.segments[1]!.model.changes).toEqual([
      { id: change.id, name: change.name, kind: "automation", effects: change.effects, adoption: 0.8, startMonth: 4, rampMonths: 2, tiers: ["T1"] },
    ]);
  });

  it("from the first month it is one run with the change starting in month 1", () => {
    const prepared = prepare(0);
    expect(prepared.segments).toHaveLength(1);
    expect(prepared.segments[0]!.model.changes).toMatchObject([{ id: change.id, startMonth: 1 }]);
  });

  it("carry the issue the solution is for, as the change did (reporting only), and a missing id falls back to the solution's", () => {
    expect(prepare(0, [holding], (id) => (id === holding.id ? "issue-1" : undefined)).segments[0]!.model.changes).toMatchObject([{ issueId: "issue-1" }]);
    const bare = { ...holding, step_changes: [{ ...change, id: undefined }] };
    expect(prepare(0, [bare]).segments[0]!.model.changes![0]!.id).toBe(`${holding.id}:0`);
  });

  it("are not in force when the version is not picked, and only the latest version of a process counts", () => {
    const none = prepareScenario(bundle, [], [holding], 12, DEMO_FORECAST_START, { pair: false });
    expect(none.segments).toHaveLength(1);
    expect(none.segments[0]!.model.changes).toBeUndefined();
    // Two versions of the process picked from different months: the later one's changes alone.
    const second = { ...holding, id: "00000000-0000-4000-8000-0000000f0202", step_changes: [{ ...change, id: "5c000000-0000-4000-8000-000000000002", name: "Second" }] };
    const c = [
      ...playChanges(play({ versions: { [holding.process_id]: { solution: holding.id, month: 2 } } }), demoCtx),
      ...playChanges(play({ versions: { other: { solution: second.id, month: 5 } } }), demoCtx),
    ];
    const prepared = prepareScenario(bundle, c.map((x, i) => ({ change: { ...x, id: `${x.id}${i}` }, scenarioId: "play", scenarioName: "Free play", inherited: false })), [holding, second], 12, DEMO_FORECAST_START, { pair: false });
    const last = prepared.segments[prepared.segments.length - 1]!.model.changes!;
    expect(last.map((x) => x.name)).toEqual(["Second"]);
    expect(last[0]!.startMonth).toBe(6);
  });
});

// Customisability audit 26: lever months run to the end of the horizon, not just the first year.
describe("lever months cover the whole horizon", () => {
  const long: PlayContext = { ...ctx, months: 36 };

  it("a hire in month 18 and a price rise in year 2 keep their months on a 36-month run", () => {
    const c = playChanges(play({ hires: [{ role: "links", month: 18 }], price: 5, priceFrom: 14 }), long);
    expect(c.find((x) => x.lever === "D1")!.from).toBe("2028-05");
    expect(c.find((x) => x.lever === "B5")!.from).toBe("2028-01");
    // Past the horizon, clamped to its last month; with no horizon, the first year as before.
    expect(playChanges(play({ leads: 5, marketFrom: 99 }), long)[0]!.from).toBe("2029-10");
    expect(playChanges(play({ hires: [{ role: "links", month: 18 }] }), ctx)[0]!.from).toBe("2027-10");
  });

  it("a market from month 15 runs to the end of the horizon, and a named client can leave in month 20", () => {
    const m = applyPlay(model, play({ market: "downturn", marketFrom: 15 }), long);
    expect(m.market!.months).toHaveLength(36);
    expect(m.market!.months[14]!.leads).toBe(1);
    expect(m.market!.months[15]!.leads).toBe(0.65);
    const id = Object.keys(model.clients ?? {})[0];
    if (id) expect(applyPlay(model, play({ lose: [{ id, month: 20 }] }), long).clients![id]!.leavesMonth).toBe(21);
  });

  it("wins can start after the first year", () => {
    const [dept] = setup.departments;
    const wins = winEntries(play({ add: { [dept!.id]: 1 }, addFrom: 20, addMonths: 2, addTier: "T1" }), long);
    expect(wins.map((w) => w.month)).toEqual([21, 22]);
  });
});

// Customisability audit 24: the sliders offer the lever registry's ranges, in steps of 1.
describe("the sliders' ranges", () => {
  it("come from the registry: leads, win rate, churn and prices -100% to +400%", () => {
    const r = playSliderRanges();
    expect(r.leads).toEqual({ min: -100, max: 400, step: 1 });
    expect(r.win).toEqual({ min: -100, max: 400, step: 1 });
    expect(r.churn).toEqual({ min: -100, max: 400, step: 1 });
    expect(r.price).toEqual({ min: -100, max: 400, step: 1 });
  });

  it("doubling leads, +3% win rate and a 50% price rise become the registry's changes", () => {
    const c = playChanges(play({ leads: 100, win: 3, price: 50 }), ctx);
    expect(c).toMatchObject([
      { lever: "A1", value: 2 },
      { lever: "A3", value: 1.03 },
      { lever: "B5", value: 0.5 },
    ]);
  });
});

// Customisability audit 7: a free-play price rise keeps the price churn driver's own chance and months from Settings.
describe("a price rise and the price churn driver's own settings", () => {
  const withDriver = (d: Partial<NonNullable<EngineModel["churnDrivers"]>[number]>): EngineModel => ({ ...model, churnDrivers: [{ id: "price", weight: 1, enabled: false, ...d }] });
  const priceOf = (m: EngineModel) => m.churnDrivers!.find((d) => d.id === "price")!;

  it("keeps the driver's months and chance, and falls back to a sure hit for 3 months", () => {
    const own = priceOf(applyPlay(withDriver({ chance: 0.4, effectMonths: 6 }), play({ price: 10 }), ctx));
    expect(own).toMatchObject({ enabled: true, chance: 0.4, effectMonths: 6 });
    expect(own.effect).toBeCloseTo(0.5, 12);
    const none = priceOf(applyPlay({ ...model, churnDrivers: [] }, play({ price: 10 }), ctx));
    expect(none).toMatchObject({ enabled: true, chance: 1, effectMonths: PRICE_RISE_MONTHS });
  });

  it("'Lasts' replaces the months for the run only", () => {
    expect(priceOf(applyPlay(withDriver({ effectMonths: 6 }), play({ price: 10, priceMonths: 2 }), ctx)).effectMonths).toBe(2);
    expect(priceRiseMonths({}, { effectMonths: 6 })).toBe(6);
    expect(priceRiseMonths({ priceMonths: null }, undefined)).toBe(PRICE_RISE_MONTHS);
    expect(priceRiseMonths({ priceMonths: 30 }, { effectMonths: 6 })).toBe(6);
  });
});

// Customisability audit 22/23/33: "Months to hire" in free play changes the advice, not the run's changes.
describe("months to hire in free play", () => {
  it("a chosen months to hire moves the levers off today's path but makes no registry change", () => {
    expect(playIsDefault(play({ hiringDelay: 3 }))).toBe(false);
    expect(playIsDefault(play({ hiringDelay: null }))).toBe(true);
    expect(playChanges(play({ hiringDelay: 3 }), ctx)).toEqual([]);
  });
});
