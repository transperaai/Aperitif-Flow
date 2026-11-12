import { describe, expect, it } from "vitest";
import { simulate } from "@transpera-flow/engine";
import {
  dler,
  dlerSalariesMissing,
  effectiveMonthlySalary,
  hourlyCostFromSalary,
  missingForCapacity,
  northbeamBundle,
  northbeamPersonIds,
  northbeamRoleIds,
  personSalary,
  rolesForViewer,
  setupInMonth,
  SETUP_FIELDS,
  toEngineModel,
  WEEKS_PER_MONTH,
  type CapacitySetup,
  type ProcessBundle,
  type SetupPerson,
  type SetupRole,
} from "../src";

// Role salaries (D73): a role's monthly salary stands in for anyone in it without their own, pro rata to their fte, and salaries
// count in profit: a person's hourly cost is their rate, else their salary over their hours, else the role's default rate.

const OPTS = { startDate: "2026-10-05" };
const nb = northbeamPersonIds;

/** Northbeam with role salaries and per-person pay set; `edit` changes anything else. */
function bundle(edit: (b: ProcessBundle) => void = () => {}): ProcessBundle {
  const b = northbeamBundle();
  edit(b);
  return b;
}
const setRole = (b: ProcessBundle, key: keyof typeof northbeamRoleIds, salary: number | null) => {
  b.roles = b.roles.map((r) => (r.id === northbeamRoleIds[key] ? { ...r, salary_monthly: salary } : r));
};
const setPerson = (b: ProcessBundle, name: string, patch: Partial<ProcessBundle["people"][number]>) => {
  b.people = b.people.map((p) => (p.id === nb[name] ? { ...p, ...patch } : p));
};
const costOf = (b: ProcessBundle, name: string) => toEngineModel(b, OPTS).people![nb[name]!]!.cost;
/** Northbeam's week is 40 hours. */
const perHour = (monthly: number, hours = 40) => monthly / (hours * WEEKS_PER_MONTH);

describe("effectiveMonthlySalary and hourlyCostFromSalary", () => {
  it("own salary first, then the mean of the roles' entered salaries × fte, never a role's for a contractor", () => {
    expect(effectiveMonthlySalary({ salary_monthly: 9000, fte: 0.5 }, [6000])).toBe(9000);
    expect(effectiveMonthlySalary({ salary_monthly: null, fte: 0.5 }, [6000])).toBe(3000);
    expect(effectiveMonthlySalary({ salary_monthly: null, fte: 1 }, [6000, null, 8000])).toBe(7000);
    expect(effectiveMonthlySalary({ salary_monthly: null, fte: 1 }, [null])).toBeNull();
    expect(effectiveMonthlySalary({ salary_monthly: null, fte: 1, label: "contractor" }, [6000])).toBeNull();
    expect(effectiveMonthlySalary({ salary_monthly: 4000, fte: 1, label: "contractor" }, [6000])).toBe(4000);
    expect(effectiveMonthlySalary({ salary_monthly: null, fte: 1, label: "offshore" }, [6000])).toBe(6000);
    // numeric as text, as some readers give it
    expect(effectiveMonthlySalary({ salary_monthly: "1200.50", fte: "1" }, [])).toBe(1200.5);
  });

  it("spreads a month's salary over the hours of 52/12 weeks, and gives nothing for no hours", () => {
    expect(hourlyCostFromSalary(5200, 40)).toBeCloseTo(5200 / (40 * 52 / 12), 10);
    expect(hourlyCostFromSalary(5200, 0)).toBeNull();
    expect(hourlyCostFromSalary(null, 40)).toBeNull();
  });
});

describe("a person's hourly cost in the model", () => {
  it("is their rate, else their salary, else their role's salary × fte, else none (the role's default rate)", () => {
    const b = bundle((b) => {
      setRole(b, "seo", 6500);
      setPerson(b, "Sam Patel", { cost_rate: 61, salary_monthly: 9000 });
      setPerson(b, "Chloe Evans", { salary_monthly: 7800 });
      setPerson(b, "Arjun Mehta", { fte: 0.5 });
    });
    expect(costOf(b, "Sam Patel")).toBe(61);
    expect(costOf(b, "Chloe Evans")).toBeCloseTo(perHour(7800), 10);
    // Half time: half the role's salary over half the hours, so the same per hour as a full-timer on the role's salary.
    expect(costOf(b, "Arjun Mehta")).toBeCloseTo(perHour(3250, 20), 10);
    expect(costOf(b, "Arjun Mehta")).toBeCloseTo(perHour(6500), 10);
    // No salary anywhere: no person cost, so the engine prices their hours at the role's default rate.
    expect(costOf(b, "Nina Kowalski")).toBeUndefined();
    expect(toEngineModel(b, OPTS).roles[northbeamRoleIds.ppc]!.cost).toBe(50);
    // The role's own engine cost is still its default rate, salary or not.
    expect(toEngineModel(b, OPTS).roles[northbeamRoleIds.seo]!.cost).toBe(50);
  });

  it("uses their own hours a week when set", () => {
    const b = bundle((b) => {
      setRole(b, "am", 5000);
      setPerson(b, "Leah Brooks", { capacity_hours_week: 30 });
    });
    expect(costOf(b, "Leah Brooks")).toBeCloseTo(perHour(5000, 30), 10);
  });

  it("averages the salaries of the roles a person holds that have one", () => {
    const b = bundle((b) => {
      setRole(b, "strat", 9000);
      setRole(b, "am", 5000);
      b.personRoles.push({ person_id: nb["Maya Collins"]!, role_id: northbeamRoleIds.am, workspace_id: b.workspace.id });
      b.personRoles.push({ person_id: nb["Rosa Diaz"]!, role_id: northbeamRoleIds.am, workspace_id: b.workspace.id });
    });
    expect(costOf(b, "Maya Collins")).toBeCloseTo(perHour(7000), 10);
    // Finance has no salary: only the account manager's counts.
    expect(costOf(b, "Rosa Diaz")).toBeCloseTo(perHour(5000), 10);
  });

  it("never gives a contractor the role's salary: they keep their rate, or the role's default", () => {
    const b = bundle((b) => {
      setRole(b, "ppc", 6000);
      setPerson(b, "Nina Kowalski", { label: "contractor" });
      setPerson(b, "Ben Carter", { label: "contractor", cost_rate: 85 });
    });
    expect(costOf(b, "Nina Kowalski")).toBeUndefined();
    expect(costOf(b, "Ben Carter")).toBe(85);
  });

  it("derives nothing where pay is hidden: no rate, no salary, no role salary", () => {
    const edit = (b: ProcessBundle) => {
      setRole(b, "seo", 6500);
      setPerson(b, "Sam Patel", { cost_rate: 61 });
      setPerson(b, "Chloe Evans", { salary_monthly: 7800 });
    };
    for (const hide of [(b: ProcessBundle) => (b.payHidden = true), (b: ProcessBundle) => (b.viewer = { seesEveryone: false, ownPersonId: nb["Chloe Evans"]! })]) {
      const model = toEngineModel(bundle((b) => (edit(b), hide(b))), OPTS);
      expect(model.payHidden).toBe(true);
      for (const p of Object.values(model.people!)) expect(p.cost).toBeUndefined();
    }
  });

  it("counts in profit: a role salary above the default rate lowers profit, and changes nothing else", () => {
    const base = simulate(toEngineModel(bundle(), OPTS), 5, 7);
    // 20,000 a month is about 115 an hour, well above SEO's default 50.
    const paid = simulate(toEngineModel(bundle((b) => setRole(b, "seo", 20_000)), OPTS), 5, 7);
    expect(paid.kpi.revenue).toEqual(base.kpi.revenue);
    expect(paid.kpi.labourCost!.mean).toBeGreaterThan(base.kpi.labourCost!.mean);
    expect(paid.kpi.profit!.mean).toBeLessThan(base.kpi.profit!.mean);
  });
});

describe("rolesForViewer", () => {
  it("drops a role's salary for whoever doesn't see everyone", () => {
    const roles = [{ id: "a", salary_monthly: 6000 }, { id: "b", salary_monthly: null }];
    expect(rolesForViewer(roles, { seesEveryone: true, ownPersonId: null })).toEqual(roles);
    expect(rolesForViewer(roles, { seesEveryone: false, ownPersonId: "x" })).toEqual([{ id: "a", salary_monthly: null }, { id: "b", salary_monthly: null }]);
  });
});

// ---- Set up: DLER, the missing list and the Sandbox's hires ------------------------------------------------------------------

const DEPT = "00000000-0000-4000-8000-00000000d001";
const role = (id: string, extra: Partial<SetupRole> = {}): SetupRole => ({
  id, name: id, color: null, active: true, default_cost_rate: 0, headcount: 1, ongoing_hours_per_client_week: 0, department_id: DEPT, kind: "client_facing", line: 0.85,
  rule_of_thumb: null, unit: null, leadership: false, salary_monthly: null, provenance: {}, ...extra,
});
const person = (id: string, role_ids: string[], extra: Partial<SetupPerson> = {}): SetupPerson => ({
  id, name: id, email: null, active: true, fte: 1, capacity_hours_week: null, cost_rate: null, start_date: null, end_date: null, notes: null, reserved_share: 0, salary_monthly: null,
  label: null, ramp: null, provenance: {}, role_ids, tier_ids: [], ...extra,
});
const setupOf = (roles: SetupRole[], people: SetupPerson[], extra: Partial<CapacitySetup> = {}): CapacitySetup => ({
  workspaceId: "ws", currency: "USD", departments: [{ id: DEPT, name: "Organic (SEO)", sort: 0 }], tiers: [], services: [], groups: [], clients: [], roles, people,
  portfolio: [], rampDefault: [0.4, 0.6, 0.8], rampDefaultProvenance: null, dlerIncludesLeadership: false, dlerProvenance: null, maxStayStored: null, maxStayMonths: 60, dlerGoal: 4.5, atRiskMargin: 0.1, canEdit: true, payHidden: false, ...extra,
});

describe("personSalary in Set up", () => {
  const setup = setupOf([role("mgr", { salary_monthly: 6000 }), role("none")], [
    person("own", ["mgr"], { salary_monthly: 8000 }),
    person("half", ["mgr"], { fte: 0.5 }),
    person("contractor", ["mgr"], { label: "contractor" }),
    person("bare", ["none"]),
  ]);

  it("is their own, else the role's pro rata, else null", () => {
    expect(setup.people.map((p) => personSalary(setup, p))).toEqual([8000, 3000, null, null]);
  });

  it("DLER counts a person a role's salary covers", () => {
    const s = setupOf([role("mgr", { salary_monthly: 6000 })], [person("a", ["mgr"]), person("b", ["mgr"], { salary_monthly: 12_000 })]);
    // No clients, so fees are 0, but both are counted: the role salary makes "a" a member.
    expect(dler(s).whole.people).toBe(2);
    expect(dler(setupOf([role("mgr")], s.people)).whole.people).toBe(1);
    expect(dlerSalariesMissing(s, null)).toBe(false);
    expect(dlerSalariesMissing(setupOf([role("mgr")], s.people), null)).toBe(true);
  });

  it("the missing list leaves out anyone a role's salary covers, and still lists the rest", () => {
    const missing = missingForCapacity(setup).filter((m) => m.kind === "person_salary").map((m) => m.id);
    expect(missing).toEqual(["bare"]);
  });

  it("a Sandbox hire takes the mean of the role's people's full-time salaries times its FTE, or the role's own when none has one", () => {
    const hires = { leavers: [], hires: [{ role: "mgr", month: 0 }] };
    const hireOf = (s: CapacitySetup) => setupInMonth(s, hires, 0).people.at(-1)!;
    // own 8000 and half 3000 at 0.5 FTE, 6000 full time (contractor and bare have none): 7000 for a full-time hire (audit 5).
    expect(hireOf(setupOf(setup.roles, setup.people.slice(0, 2))).salary_monthly).toBe(7000);
    expect(setupInMonth(setupOf(setup.roles, setup.people.slice(0, 2)), { leavers: [], hires: [{ role: "mgr", month: 0, fte: 0.5 }] }, 0).people.at(-1)!.salary_monthly).toBe(3500);
    const onlyRole = setupOf([role("mgr", { salary_monthly: 6000 })], []);
    const hire = hireOf(onlyRole);
    expect(hire.salary_monthly).toBeNull();
    expect(personSalary(onlyRole, hire)).toBe(6000);
  });

  it("is saved as an amount, like a person's", () => {
    expect(SETUP_FIELDS.roles.salary_monthly).toEqual(SETUP_FIELDS.people.salary_monthly);
  });
});
