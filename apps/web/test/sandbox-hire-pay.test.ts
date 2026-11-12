import { describe, expect, it } from "vitest";
import {
  WEEKS_PER_MONTH,
  capacitySetupFromModel,
  defaultPlay,
  hireIds,
  hireMonthlySalary,
  northbeamRoleIds,
  playChanges,
  playHireSalary,
  playIsDefault,
  playSliderRanges,
  setupInMonth,
  winMix,
  type CapacitySetup,
  type PlayContext,
  type PlayState,
  type ProcessBundle,
} from "@transpera-flow/db";
import { capacityModel, simulate, type EngineModel } from "@transpera-flow/engine";
import { preparePlay, prepareScenario } from "@transpera-flow/db/sandbox";
import { DEMO_FORECAST_START, demoForecastBundle } from "@/lib/forecast/demo";

// A Sandbox hire's FTE and pay (customisability audit 4, 5 and 25), the pay change reaching people priced from a salary (C1, whole run and
// from a month), and the Work group's hours a week (D6).

const { changes: _changes, ...today } = capacityModel();
void _changes;
const model: EngineModel = today;
const setup = capacitySetupFromModel(model);
const ctx: PlayContext = { startDate: "2026-11-02", setup, winMix: (d) => winMix(setup, model, d) };
const play = (over: Partial<PlayState> = {}): PlayState => ({ ...defaultPlay(), ...over });

const ppc = northbeamRoleIds.ppc;

/** The demo bundle with the PPC people on salaries (one part-time) and no cost rates, so a hire's pay comes from them. */
function salaried(): { bundle: ProcessBundle; members: { salary: number; fte: number }[] } {
  const base = demoForecastBundle();
  const inPpc = new Set(base.personRoles.filter((r) => r.role_id === ppc).map((r) => r.person_id));
  const members: { salary: number; fte: number }[] = [];
  let k = 0;
  const people = base.people.map((p) => {
    if (!inPpc.has(p.id) || !p.active) return p;
    const fte = k === 0 ? 0.5 : 1;
    const salary = k === 0 ? 3000 : 7000;
    k++;
    members.push({ salary, fte });
    return { ...p, fte, capacity_hours_week: null, cost_rate: null, salary_monthly: salary };
  });
  return { bundle: { ...base, people }, members };
}

describe("a hire's FTE and pay", () => {
  it("the FTE is the D1 change's value, clamped to what the lever offers; 1 when not set", () => {
    const c = playChanges(play({ hires: [{ role: "r", month: 2 }, { role: "r", month: 2, fte: 0.5 }, { role: "r", month: 2, fte: 9 }] }), ctx);
    expect(c.map((x) => x.value)).toEqual([1, 0.5, 1.5]);
  });

  it("the default pay is the role's people's full-time pay × the hire's FTE; typed pay wins", () => {
    const members = [
      { salary: 3000, fte: 0.5 },
      { salary: 7000, fte: 1 },
      { salary: null, fte: 1 },
    ];
    expect(hireMonthlySalary(null, 1, members)).toBeCloseTo(6500, 9);
    expect(hireMonthlySalary(undefined, 0.5, members)).toBeCloseTo(3250, 9);
    expect(hireMonthlySalary(9000, 0.5, members)).toBe(9000);
    expect(hireMonthlySalary(null, 1, [{ salary: null, fte: 1 }])).toBeNull();
  });

  it("the Sandbox's DLER setup gives the hire the same salary and FTE", () => {
    const roleId = setup.roles[0]!.id;
    const s: CapacitySetup = {
      ...setup,
      payHidden: false,
      people: setup.people.map((p) => (p.role_ids.includes(roleId) ? { ...p, salary_monthly: 6000, fte: 1 } : p)),
    };
    const p = play({ hires: [{ role: roleId, month: 0, fte: 0.5 }] });
    const hire = setupInMonth(s, p, 0).people.find((x) => x.id === hireIds(p)[0])!;
    expect(hire.fte).toBe(0.5);
    expect(hire.salary_monthly).toBeCloseTo(3000, 9);
    expect(playHireSalary(s, { role: roleId, fte: 0.5, pay: 4000 })).toBe(4000);
    // Pay hidden: nothing, never a number.
    expect(playHireSalary({ ...s, payHidden: true }, { role: roleId, pay: 4000 })).toBeNull();
  });

  it("the run costs the hire in profit at that salary, from a typed pay or the role's people", () => {
    const { bundle, members } = salaried();
    const hpw = bundle.workspace.settings.hours_per_week;
    const demoCtx: PlayContext = { ...ctx, startDate: DEMO_FORECAST_START };
    const p = play({ hires: [{ role: ppc, month: 0, fte: 0.5 }, { role: ppc, month: 0, fte: 1, pay: 9000 }] });
    const [a, b] = hireIds(p);
    const prepared = preparePlay(bundle, p, demoCtx, []);
    expect(prepared.error).toBeNull();
    const people = prepared.segments[0]!.model.people!;
    const expectedA = hireMonthlySalary(null, 0.5, members)!;
    expect(people[a!]!.cost).toBeCloseTo(expectedA / (0.5 * hpw * WEEKS_PER_MONTH), 6);
    expect(people[a!]!.costFromSalary).toBe(true);
    expect(people[a!]!.capacity).toBeCloseTo(0.5 * hpw, 9);
    expect(people[b!]!.cost).toBeCloseTo(9000 / (hpw * WEEKS_PER_MONTH), 6);
  });
});

describe("the pay change reaches people priced from a salary", () => {
  it("whole run: a role's people's own costs × the change, as from a month", () => {
    const { bundle } = salaried();
    const base = prepareScenario(bundle, [], [], 12, DEMO_FORECAST_START, { pair: false }).segments[0]!.model;
    const change = { id: "5ba00000-0000-4000-8000-000000000001", lever: "C1" as const, target: ppc, op: "multiply" as const, value: 1.1 };
    const whole = prepareScenario(bundle, [{ change, scenarioId: "s", scenarioName: "S", inherited: false }], [], 12, DEMO_FORECAST_START, { pair: false }).segments[0]!.model;
    const timed = prepareScenario(bundle, [{ change: { ...change, from: DEMO_FORECAST_START.slice(0, 7) }, scenarioId: "s", scenarioName: "S", inherited: false }], [], 12, DEMO_FORECAST_START, { pair: false });
    let checked = 0;
    for (const [id, p] of Object.entries(base.people!)) {
      if (!p.roles.includes(ppc) || p.cost === undefined) continue;
      expect(whole.people![id]!.cost).toBeCloseTo(p.cost * 1.1, 9);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    // The same change from the first month costs the run the same.
    const labour = (m: EngineModel) => simulate(m, 2, 1).kpi.labourCost!.mean;
    expect(labour(timed.segments[0]!.model)).toBeCloseTo(labour(whole), 3);
    // Set or add stays the role's own rate.
    const set = prepareScenario(bundle, [{ change: { ...change, op: "set", value: 80 }, scenarioId: "s", scenarioName: "S", inherited: false }], [], 12, DEMO_FORECAST_START, { pair: false }).segments[0]!.model;
    for (const [id, p] of Object.entries(base.people!)) if (p.cost !== undefined) expect(set.people![id]!.cost).toBe(p.cost);
  });

  it("the Sandbox's DLER salaries move with it from its month, a hire's typed pay too", () => {
    const roleId = setup.roles[0]!.id;
    const s: CapacitySetup = { ...setup, payHidden: false, people: setup.people.map((p) => (p.role_ids.includes(roleId) ? { ...p, salary_monthly: 6000 } : p)) };
    const p = play({ pay: 10, payRole: roleId, payFrom: 2, hires: [{ role: roleId, month: 0, pay: 5000 }] });
    const member = s.people.find((x) => x.role_ids.includes(roleId))!;
    const [hire] = hireIds(p);
    expect(setupInMonth(s, p, 1).people.find((x) => x.id === member.id)!.salary_monthly).toBe(6000);
    expect(setupInMonth(s, p, 2).people.find((x) => x.id === member.id)!.salary_monthly).toBeCloseTo(6600, 9);
    expect(setupInMonth(s, p, 2).people.find((x) => x.id === hire)!.salary_monthly).toBeCloseTo(5500, 9);
  });
});

describe("Work: hours a week", () => {
  it("a multiple of hours available (D6) from a month, everyone's or a role's, on the registry's range", () => {
    expect(playSliderRanges().hours).toEqual({ min: -90, max: 100, step: 1 });
    expect(playChanges(play({ hours: -20, hoursFrom: 3 }), ctx)).toMatchObject([{ lever: "D6", target: null, op: "multiply", value: 0.8, from: "2027-02" }]);
    expect(playChanges(play({ hours: 10, hoursRole: "r1" }), ctx)).toMatchObject([{ lever: "D6", target: "r1", value: 1.1, from: "2026-11" }]);
    expect(playIsDefault(play({ hours: 0 }))).toBe(true);
    expect(playIsDefault(play({ hours: 5 }))).toBe(false);
  });

  it("the run gives people fewer hours from that month", () => {
    const bundle = demoForecastBundle();
    const demoCtx: PlayContext = { ...ctx, startDate: DEMO_FORECAST_START };
    const prepared = preparePlay(bundle, play({ hours: -20, hoursFrom: 3 }), demoCtx, []);
    expect(prepared.error).toBeNull();
    expect(prepared.problems).toEqual([]);
    const plan = prepared.segments[0]!.model.channels!;
    const rows = Object.values(plan.capacity ?? {});
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row[0]).toBe(1);
      expect(row[3]).toBeCloseTo(0.8, 9);
    }
  });
});
