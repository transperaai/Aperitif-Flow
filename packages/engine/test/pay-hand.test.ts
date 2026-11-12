import { describe, expect, it } from "vitest";
import { onCostFactor, overtimeIssues, overtimePayFactor, paidFor, simulate, type EngineClient, type EngineModel, type EngineService } from "../src";

// How pay becomes cost (pay.ts: overtime pay factor, employer on-costs, paid for hours worked), checked by hand on one person with a
// constant load: Ann, 40 h a week at 50 an hour, 13 weeks, no leads. Every expected number is worked out from the inputs.

const HPW = 40;
const MONTH = 52 / 12;

const ret: EngineService = { name: "Retainer", pricingModel: "retainer", price: 1000 * MONTH, margin: 0, tenureMonths: 12, churnMonthly: 0, mixShare: 1, pathTags: [] };
const client: EngineClient = { name: "Acme", services: ["ret"], mrr: 1000 * MONTH, assignments: { r: "ann" } };

/** Ann carries one client whose servicing is `load` hours a week (the role's ongoing hours a client). */
function tiny(load: number, extra: Partial<EngineModel> = {}, ann: Partial<EngineModel["people"] extends Record<string, infer P> | undefined ? P : never> = {}): EngineModel {
  return {
    horizonWeeks: 13,
    hoursPerWeek: HPW,
    leadsPerWeek: 0,
    activeClients: 0,
    churnMonthly: 0,
    retainer: 1000,
    warmupWeeks: 0,
    roles: { r: { name: "R", count: 1, cost: 50, ongoing: load } },
    people: { ann: { name: "Ann", roles: ["r"], capacity: HPW, ...ann } },
    services: { ret },
    clients: { c: client },
    entry: "s",
    sinks: { won: "won", lost: "lost" },
    steps: [{ id: "s", name: "S", role: "r", work: 1, wait: 0, rework: 0, workDist: { kind: "constant" }, next: [{ to: "won", p: 1 }] }],
    ...extra,
  };
}

describe("pay rules (pay.ts)", () => {
  it("default to what every model ran at before", () => {
    expect(overtimePayFactor({})).toBe(1);
    expect(onCostFactor({}, undefined)).toBe(1);
    expect(onCostFactor({ employerOnCosts: 0.12 }, {})).toBeCloseTo(1.12, 12);
    expect(onCostFactor({ employerOnCosts: 0.12 }, { contractor: true })).toBe(1);
    expect(paidFor({})).toBe("contracted");
    expect(paidFor({ contractor: true })).toBe("worked");
    expect(paidFor({ contractor: true, paidFor: "contracted" })).toBe("contracted");
    expect(paidFor({ paidFor: "worked" })).toBe("worked");
    // Junk is clamped, never negative.
    expect(overtimePayFactor({ overtimePayFactor: -1 })).toBe(0);
    expect(onCostFactor({ employerOnCosts: Number.NaN }, undefined)).toBe(1);
  });
});

describe("hand-checked: overtime paid at a multiple of the normal rate", () => {
  // 44 h a week of client work against 40, a 10% cap: 4 h a week of overtime, 52 h over 13 weeks, at 50 an hour = 2,600 at 1x.
  const base = tiny(44, { overtimeCap: 0.1 });

  it("1x by default, 1.5x and unpaid when set", () => {
    const at = (f: number | undefined) => simulate(f === undefined ? base : { ...base, overtimePayFactor: f }, 2, 1).kpi;
    expect(at(undefined).overtimeHours.mean).toBeCloseTo(52, 6);
    expect(at(undefined).overtimeCost!.mean).toBeCloseTo(2600, 6);
    expect(at(1.5).overtimeCost!.mean).toBeCloseTo(3900, 6);
    expect(at(0).overtimeCost!.mean).toBe(0);
    // Paid hours don't change.
    expect(at(1.5).labourCost!.mean).toBeCloseTo(at(undefined).labourCost!.mean, 6);
  });

  it("the overtime insight costs its hours the same way", () => {
    const cost = (m: EngineModel) => overtimeIssues(m, simulate(m, 2, 1))[0]?.cost.perMonth ?? null;
    const at1 = cost(base);
    expect(at1).toBeCloseTo(4 * 50 * MONTH, 6);
    expect(cost({ ...base, overtimePayFactor: 1.5 })).toBeCloseTo(at1! * 1.5, 6);
    expect(cost({ ...base, overtimePayFactor: 1.5, employerOnCosts: 0.1 })).toBeCloseTo(at1! * 1.5 * 1.1, 6);
  });

  it("month by month too", () => {
    const mo = simulate({ ...base, overtimePayFactor: 1.5 }, 2, 1, { monthly: true }).monthly!;
    const total = mo.money!.overtimeCost.reduce((a, s) => a + s.mean, 0);
    expect(total).toBeCloseTo(3900, 6);
  });
});

describe("hand-checked: employer on-costs", () => {
  // Ann is paid 40 h × 13 weeks × 50 = 26,000; with 12% on-costs 29,120.
  const base = tiny(10);

  it("load an employee's pay and overtime", () => {
    expect(simulate(base, 2, 1).kpi.labourCost!.mean).toBeCloseTo(26_000, 6);
    expect(simulate({ ...base, employerOnCosts: 0.12 }, 2, 1).kpi.labourCost!.mean).toBeCloseTo(29_120, 6);
    const ot = tiny(44, { overtimeCap: 0.1, employerOnCosts: 0.12 });
    expect(simulate(ot, 2, 1).kpi.overtimeCost!.mean).toBeCloseTo(2600 * 1.12, 6);
    const mo = simulate({ ...base, employerOnCosts: 0.12 }, 2, 1, { monthly: true }).monthly!;
    expect(mo.money!.labour.reduce((a, b) => a + b, 0)).toBeCloseTo(29_120, 6);
  });

  it("never a contractor's (here paid for contracted hours, so only the on-costs differ)", () => {
    const m = tiny(10, { employerOnCosts: 0.12 }, { contractor: true, paidFor: "contracted" });
    expect(simulate(m, 2, 1).kpi.labourCost!.mean).toBeCloseTo(26_000, 6);
  });

  it("apply to a person's own rate", () => {
    const m = tiny(10, { employerOnCosts: 0.5 }, { cost: 60 });
    expect(simulate(m, 2, 1).kpi.labourCost!.mean).toBeCloseTo(40 * 13 * 60 * 1.5, 6);
  });
});

describe("hand-checked: paid for the hours worked", () => {
  it("a contractor is paid for 10 h a week of work, not 40 contracted", () => {
    const m = tiny(10, {}, { contractor: true });
    const r = simulate(m, 2, 1, { monthly: true });
    expect(r.kpi.labourCost!.mean).toBeCloseTo(10 * 13 * 50, 6);
    expect(r.monthly!.money!.labour.reduce((a, b) => a + b, 0)).toBeCloseTo(10 * 13 * 50, 6);
    expect(r.monthly!.money!.labourByPerson.ann!.reduce((a, b) => a + b, 0)).toBeCloseTo(10 * 13 * 50, 6);
    expect(r.monthly!.money!.labourByRole.r!.reduce((a, b) => a + b, 0)).toBeCloseTo(10 * 13 * 50, 6);
  });

  it("set to contracted hours, a contractor is paid as before", () => {
    expect(simulate(tiny(10, {}, { contractor: true, paidFor: "contracted" }), 2, 1).kpi.labourCost!.mean).toBeCloseTo(26_000, 6);
  });

  it("an employee can be paid for hours worked too", () => {
    expect(simulate(tiny(10, {}, { paidFor: "worked" }), 2, 1).kpi.labourCost!.mean).toBeCloseTo(6_500, 6);
  });

  it("never more than their contracted hours; overtime stays overtime", () => {
    // 44 h of work, 4 h of it overtime: 40 h a week at the normal rate, the overtime at 1.5x.
    const m = tiny(44, { overtimeCap: 0.1, overtimePayFactor: 1.5 }, { contractor: true });
    const k = simulate(m, 2, 1).kpi;
    expect(k.labourCost!.mean).toBeCloseTo(26_000, 6);
    expect(k.overtimeCost!.mean).toBeCloseTo(3900, 6);
  });

  it("no paid leave: a week off is a week unpaid", () => {
    // Leave the second week: 12 working weeks of 10 h (the client's hours that week go to nobody).
    const m = tiny(10, {}, { contractor: true, leave: [[HPW, 2 * HPW]] });
    const r = simulate(m, 2, 1, { monthly: true });
    expect(r.kpi.labourCost!.mean).toBeCloseTo(12 * 10 * 50, 6);
    expect(r.monthly!.money!.labour.reduce((a, b) => a + b, 0)).toBeCloseTo(12 * 10 * 50, 6);
    // An employee on contracted hours is paid for the leave.
    expect(simulate(tiny(10, {}, { leave: [[HPW, 2 * HPW]] }), 2, 1).kpi.labourCost!.mean).toBeCloseTo(26_000, 6);
  });
});

describe("hand-checked: a role-cost channel reaches a person's own rate", () => {
  it("x1.1 from the second month on a person with their own cost", () => {
    const m = tiny(10, { channels: { starts: [HPW * MONTH], roleCost: { r: [1, 1.1] } } }, { cost: 60 });
    const weeks2 = 13 - MONTH;
    const k = simulate(m, 2, 1).kpi;
    expect(k.labourCost!.mean).toBeCloseTo(40 * 60 * (MONTH + weeks2 * 1.1), 6);
  });
});
