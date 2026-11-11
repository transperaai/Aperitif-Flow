import { describe, expect, it } from "vitest";
import {
  CLIENT_HEALTH_CUTOFFS,
  churnRiskIssues,
  clientHealthSummary,
  groupClientKey,
  groupServiceOf,
  northbeamWithClientGroups,
  northbeamModel,
  northbeamWithClients,
  northbeamWithServices,
  northbeamWithServicing,
  rateClientHealth,
  rosterLoads,
  resolvePeople,
  simulate,
  withClientGroups,
  type EngineModel,
} from "../src";

// Client groups (docs/PRD.md decision D27; issue #120): clients counted per
// service, simulated as unnamed clients.

describe("expanding client groups", () => {
  it("makes one unnamed client per counted client, from the group's fee and starting health", () => {
    const m = withClientGroups(northbeamWithClientGroups());
    const keys = Object.keys(m.clients!);
    expect(keys).toHaveLength(29);
    expect(keys.filter((k) => groupServiceOf(k) === "seo")).toHaveLength(17);
    expect(keys.filter((k) => groupServiceOf(k) === "ppc")).toHaveLength(12);
    expect(m.clients![groupClientKey("seo", 1)]).toEqual({ name: "SEO retainer 1", services: ["seo"], mrr: 3456, health: 83, assignments: {} });
    expect(m.activeClients).toBe(29);
  });

  it("takes the group's normal churn and typical stay for its service", () => {
    const base = northbeamWithClientGroups();
    const m = withClientGroups({ ...base, clientGroups: { ...base.clientGroups!, seo: { ...base.clientGroups!.seo!, churnMonthly: 0.07, stayMonths: 9 } } });
    expect(m.services!.seo!.churnMonthly).toBe(0.07);
    expect(m.services!.seo!.tenureMonths).toBe(9);
    expect(m.services!.ppc!.churnMonthly).toBe(0.04);
  });

  it("is deterministic, memoised and leaves a model without groups alone", () => {
    const base = northbeamWithClientGroups();
    expect(withClientGroups(base)).toBe(withClientGroups(base));
    expect(withClientGroups(withClientGroups(base))).toBe(withClientGroups(base));
    expect(withClientGroups(structuredClone(base))).toEqual(withClientGroups(base));
    const named = northbeamWithServicing();
    expect(withClientGroups(named)).toBe(named);
    expect(withClientGroups({ ...named, clientGroups: {} })).toEqual({ ...named, clientGroups: {} });
  });

  it("replaces named clients, ignores groups for services it doesn't know, and rounds and caps counts", () => {
    const base = { ...northbeamWithServicing(), clientGroups: { seo: { count: 2.6, fee: 1000, churnMonthly: 0.02, stayMonths: 10, health: 70 }, nope: { count: 5, fee: 1, churnMonthly: 0, stayMonths: 1, health: 1 } } };
    const m = withClientGroups(base);
    expect(Object.keys(m.clients!)).toEqual(["group:seo:1", "group:seo:2", "group:seo:3"]);
    const huge = withClientGroups({ ...base, clientGroups: { seo: { count: 1e9, fee: 1, churnMonthly: 0, stayMonths: 1, health: 1 } } });
    expect(Object.keys(huge.clients!)).toHaveLength(2000);
  });

  it("shares each client's work across the role's people, as nobody is assigned", () => {
    // Without servicing processes, each client's services' fallback hours are its load.
    const m = withClientGroups({ ...northbeamWithClients(), clients: undefined, clientGroups: northbeamWithClientGroups().clientGroups });
    const loads = rosterLoads(m, resolvePeople(m));
    const total = Object.values(loads).reduce((a, l) => a + l.hours, 0);
    expect(total).toBeGreaterThan(0);
    expect(Object.values(loads).every((l) => l.clients === 0)).toBe(true);
  });
});

describe("simulating client groups", () => {
  const sim = (m: EngineModel) => simulate(m, 8, 1);

  it("reports every unnamed client, keyed by its group", () => {
    const m = northbeamWithClientGroups();
    const r = sim(m);
    expect(Object.keys(r.clients!)).toHaveLength(29);
    expect(r.clients![groupClientKey("ppc", 12)]!.name).toBe("PPC management 12");
    expect(r.kpi.clientsAtRisk).toBeDefined();
  });

  it("is the same model run twice: same seed, same result", () => {
    expect(sim(northbeamWithClientGroups()).kpi.clientsChurned).toEqual(sim(northbeamWithClientGroups()).kpi.clientsChurned);
  });

  it("late servicing work lowers the groups' health and raises churn", () => {
    const base = northbeamWithClientGroups();
    const slow: EngineModel = { ...base, steps: base.steps.map((s) => (s.id === "report_seo" || s.id === "report_ppc" ? { ...s, work: s.work * 4 } : s)) };
    const ok = clientHealthSummary(base, sim(base));
    const late = clientHealthSummary(slow, sim(slow));
    expect(late.score!).toBeLessThan(ok.score! - 3);
    for (const g of ok.groups) expect(late.groups.find((x) => x.service === g.service)!.health).toBeLessThan(g.health);
    expect(sim(slow).kpi.clientsChurned!.mean).toBeGreaterThan(sim(base).kpi.clientsChurned!.mean);
  });

  it("a higher normal churn loses more clients", () => {
    const base = northbeamWithClientGroups();
    const high: EngineModel = { ...base, clientGroups: Object.fromEntries(Object.entries(base.clientGroups!).map(([id, g]) => [id, { ...g, churnMonthly: g.churnMonthly * 3 }])) };
    expect(sim(high).kpi.clientsChurned!.mean).toBeGreaterThan(sim(base).kpi.clientsChurned!.mean);
  });

  it("a typical stay changes what a won client is worth", () => {
    const base = northbeamWithClientGroups();
    const long: EngineModel = { ...base, clientGroups: { ...base.clientGroups!, seo: { ...base.clientGroups!.seo!, stayMonths: 36 } } };
    expect(sim(long).kpi.ltvAdded.mean).toBeGreaterThan(sim(base).kpi.ltvAdded.mean);
  });

  it("raises one churn-risk issue per group rated Bad or Operational risk, not one per client, rated by rule 9", () => {
    const base = northbeamWithClientGroups();
    const at = (seo: number, ppc: number): EngineModel => ({
      ...base,
      clientGroups: { seo: { ...base.clientGroups!.seo!, health: seo }, ppc: { ...base.clientGroups!.ppc!, health: ppc } },
    });
    // Starting at 30 and 45, SEO ends below 50 (Operational risk) and PPC in the Bad band.
    const m = at(30, 45);
    const result = sim(m);
    const summary = clientHealthSummary(m, result);
    const issues = churnRiskIssues(m, result);
    const expected = summary.groups.filter((g) => g.rating === "bad" || g.rating === "risk");
    expect(issues.map((i) => i.key)).toEqual(expected.map((g) => `churn_risk:group:${g.service}`));
    expect(expected.length).toBe(2);
    for (const g of expected) expect(issues.find((i) => i.key === `churn_risk:group:${g.service}`)!.rating).toBe(rateClientHealth(g.health));
    expect(summary.groups.map((g) => [g.service, g.rating])).toEqual([["ppc", "bad"], ["seo", "risk"]]);
    expect(issues.every((i) => i.clientId === null)).toBe(true);
    // A healthy group raises nothing.
    expect(churnRiskIssues(at(95, 95), sim(at(95, 95)))).toEqual([]);
  });
});

describe("groups that count no clients", () => {
  it("leave the interim client count and named roster in place", () => {
    const named = northbeamWithServicing();
    const zero: EngineModel = { ...named, clientGroups: { seo: { count: 0, fee: 1, churnMonthly: 0.5, stayMonths: 1, health: 1 }, ppc: { count: 0.4, fee: 1, churnMonthly: 0.5, stayMonths: 1, health: 1 } } };
    expect(withClientGroups(zero)).toBe(zero);
    expect(withClientGroups(zero).clients).toBe(named.clients);
    const pooled: EngineModel = { ...northbeamModel(), activeClients: 26, services: northbeamWithServices().services, clientGroups: { seo: { count: 0, fee: 1, churnMonthly: 0, stayMonths: 1, health: 1 } } };
    const r = simulate(pooled, 3, 1);
    expect(r.clients).toBeUndefined();
    expect(withClientGroups(pooled).activeClients).toBe(26);
  });

  it("one counted group switches the model to counted clients only", () => {
    const named = northbeamWithServicing();
    const one: EngineModel = { ...named, clientGroups: { seo: { count: 2, fee: 1, churnMonthly: 0.01, stayMonths: 1, health: 70 }, ppc: { count: 0, fee: 1, churnMonthly: 0.01, stayMonths: 1, health: 70 } } };
    expect(Object.keys(withClientGroups(one).clients!)).toEqual(["group:seo:1", "group:seo:2"]);
  });
});

describe("client health, rule 9", () => {
  it("rates with the default cut-offs: Great 75+, Good 65 to 75, Bad 50 to 65, Operational risk under 50", () => {
    expect(CLIENT_HEALTH_CUTOFFS).toEqual([75, 65, 50]);
    expect(
      [100, 75, 74.9, 65, 64.9, 50, 49.9, 0].map((h) => rateClientHealth(h)),
    ).toEqual(["great", "great", "good", "good", "bad", "bad", "risk", "risk"]);
  });

  it("takes other cut-offs", () => {
    expect(rateClientHealth(70, [80, 70, 60])).toBe("good");
    expect(rateClientHealth(69, [80, 70, 60])).toBe("bad");
  });

  it("summarises the company and each group; the shares add up to one", () => {
    const m = northbeamWithClientGroups();
    const s = clientHealthSummary(m, simulate(m, 8, 1));
    expect(s.clients).toBe(29);
    expect(s.healthy + s.watch + s.atRisk).toBeCloseTo(1, 10);
    expect(s.groups.map((g) => g.service)).toEqual(["ppc", "seo"]);
    expect(s.groups.map((g) => g.clients)).toEqual([12, 17]);
    expect(s.rating).toBe(rateClientHealth(s.score!));
    for (const g of s.groups) expect(g.rating).toBe(rateClientHealth(g.health));
  });

  it("a model with named clients still gets a company score, and no groups", () => {
    const m = northbeamWithServicing();
    const s = clientHealthSummary(m, simulate(m, 4, 1));
    expect(s.clients).toBe(26);
    expect(s.groups).toEqual([]);
    expect(s.score).not.toBeNull();
  });

  it("is empty without a roster", () => {
    const s = clientHealthSummary({ ...northbeamWithServicing(), clients: undefined }, simulate({ ...northbeamWithServicing(), clients: undefined }, 2, 1));
    expect(s).toMatchObject({ score: null, rating: null, clients: 0, groups: [] });
  });
});
