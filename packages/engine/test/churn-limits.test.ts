import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHURN_LIMITS,
  DEFAULT_HEALTH_BANDS,
  DEFAULT_RATING_CUTOFFS,
  busyCutoffs,
  busyLine,
  churnLimits,
  churnRiskIssues,
  clientHealthSummary,
  healthBands,
  healthCutoffs,
  loadPressure,
  northbeamWithClientGroups,
  onboardingPressure,
  priceEffectOfWeight,
  rankBottlenecks,
  responsePressure,
  resultsPressure,
  reworkPressure,
  simulate,
  toRatingConfig,
  type EngineChurnDriver,
  type EngineModel,
} from "../src";

// The customisability audit's findings 1, 2, 16, 34 and 38: the churn drivers' thresholds, the early-tenure window and the health
// bands come from the workspace, with the old constants as defaults.

const withDrivers = (model: EngineModel, churnDrivers: EngineChurnDriver[]): EngineModel => ({ ...model, churnDrivers });
const groups = northbeamWithClientGroups;

describe("churn limits", () => {
  it("default to the old constants", () => {
    expect(churnLimits({})).toEqual(DEFAULT_CHURN_LIMITS);
    expect(DEFAULT_CHURN_LIMITS).toMatchObject({ loadThreshold: 0.85, loadFull: 1, responseFullShare: 0.5, reworkFullShare: 0.25, earlyTenureWeeks: 26, awayPressure: 0.5, resultsNormal: 8, priceWeeks: 13, onboardingFullMultiple: 2 });
  });

  it("take what is set, and fall back to the default for a number out of range", () => {
    const l = churnLimits({ churnLimits: { loadThreshold: 0.95, responseFullShare: 2, resultsNormal: 6, earlyTenureWeeks: 13 } });
    expect(l.loadThreshold).toBe(0.95);
    expect(l.loadFull).toBe(1);
    expect(l.responseFullShare).toBe(0.5);
    expect(l.resultsNormal).toBe(6);
    expect(l.earlyTenureWeeks).toBe(13);
  });

  it("keep full overload above where it starts", () => {
    const l = churnLimits({ churnLimits: { loadThreshold: 1.1, loadFull: 1 } });
    expect(l.loadFull).toBeGreaterThan(l.loadThreshold);
    expect(loadPressure(1.1, l.loadThreshold, l.loadFull)).toBe(0);
  });

  it("move each pressure curve", () => {
    expect(loadPressure(0.9)).toBeCloseTo(1 / 3, 9);
    expect(loadPressure(0.9, 0.95, 1)).toBe(0);
    expect(loadPressure(0.8, 0.7, 0.9)).toBeCloseTo(0.5, 9);
    expect(responsePressure(0.25)).toBe(0.5);
    expect(responsePressure(0.25, 0.25)).toBe(1);
    expect(reworkPressure(0.1, 0.5)).toBeCloseTo(0.2, 9);
    expect(resultsPressure(7)).toBe(0.25);
    expect(resultsPressure(7, 7)).toBe(0);
    expect(onboardingPressure(15, 10)).toBe(0.5);
    expect(onboardingPressure(15, 10, 3)).toBe(0.25);
  });

  it("a price rise remembered for longer converts to a bigger effect", () => {
    expect(priceEffectOfWeight(1, 3, 26)).toBeCloseTo(2 * priceEffectOfWeight(1, 3), 9);
  });

  it("a model whose limits are spelled out at the defaults simulates to the same numbers", () => {
    const base = withDrivers(groups(), [{ id: "load", weight: 1, enabled: true }]);
    const spelled = { ...base, churnLimits: { ...DEFAULT_CHURN_LIMITS } };
    expect(simulate(spelled, 6, 2).churnCauses).toEqual(simulate(base, 6, 2).churnCauses);
  });

  it("a higher overload line puts less pressure on clients (finding 2)", () => {
    const base = withDrivers(groups(), [{ id: "load", weight: 1, enabled: true }]);
    const at = (loadThreshold: number) => simulate({ ...base, churnLimits: { loadThreshold, loadFull: 1.5 } }, 6, 2).churnCauses!.causes.find((c) => c.id === "load")!.pressure;
    expect(at(0.5)).toBeGreaterThan(at(0.85));
    expect(at(1.4)).toBeLessThan(at(0.85));
  });
});

describe("start dates (finding 16)", () => {
  /** Groups expanded into named clients, the first of them with `monthsActive`. */
  const named = (monthsActive: number | undefined): EngineModel => {
    const m = groups();
    const clients: EngineModel["clients"] = {};
    let n = 0;
    for (const [sid, g] of Object.entries(m.clientGroups ?? {})) {
      for (let i = 0; i < Math.round(g.count); i++) {
        clients[`c${n}`] = { name: `c${n}`, services: [sid], mrr: g.fee, assignments: {}, ...(monthsActive !== undefined ? { monthsActive } : {}) };
        n++;
      }
    }
    return { ...m, clientGroups: undefined, clients, activeClients: n };
  };
  const tenure = (m: EngineModel) =>
    simulate(withDrivers(m, [{ id: "tenure", weight: 1, enabled: true, value: 3 }]), 6, 2).churnCauses!.causes.find((c) => c.id === "tenure")!;

  it("a roster client that started last month counts as early tenure; one of five years, or with no date, doesn't", () => {
    // Clients won in the run are in early tenure either way; only the roster's own pressure differs.
    const none = tenure(named(undefined)).pressure;
    expect(tenure(named(1)).pressure).toBeGreaterThan(none);
    expect(tenure(named(60)).pressure).toBe(none);
  });
});

describe("health bands (findings 34 and 38)", () => {
  it("default to 75, 65 and 50, kept in order", () => {
    expect(healthBands({})).toEqual(DEFAULT_HEALTH_BANDS);
    expect(healthCutoffs({})).toEqual([75, 65, 50]);
    expect(healthBands({ healthBands: { atRisk: 70, watch: 60 } })).toEqual({ healthy: 75, watch: 70, atRisk: 70 });
  });

  it("a higher at-risk line counts more clients at risk", () => {
    const m = groups();
    const r = simulate(m, 4, 1, { monthly: true });
    const raised = { ...m, healthBands: { atRisk: 100, watch: 100, healthy: 100 } };
    const rr = simulate(raised, 4, 1, { monthly: true });
    const sum = (x: typeof r) => Object.values(x.clients ?? {}).reduce((a, c) => a + c.atRisk, 0);
    expect(sum(rr)).toBeGreaterThan(sum(r));
    expect(clientHealthSummary(raised, rr).atRisk).toBeGreaterThan(clientHealthSummary(m, r).atRisk);
  });

  it("the churn-risk findings name the workspace's lines", () => {
    const m = { ...groups(), healthBands: { atRisk: 99, watch: 99.5, healthy: 100 } };
    const issues = churnRiskIssues(m, simulate(m, 4, 1));
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.evidence).toContain("Operational risk below 99");
  });
});

describe("the workspace's busy line (finding 2)", () => {
  it("is 85% unless the workspace sets one, and is the overload driver's line", () => {
    expect(busyLine({})).toBe(0.85);
    expect(busyLine({ churnLimits: { loadThreshold: 0.75 } })).toBe(0.75);
    expect(busyLine({ churnLimits: { loadThreshold: 0.75 } })).toBe(churnLimits({ churnLimits: { loadThreshold: 0.75 } }).loadThreshold);
  });

  it("is the middle busy cut-off, the others moving only to stay in order", () => {
    expect(busyCutoffs(0.85)).toEqual(DEFAULT_RATING_CUTOFFS.busy);
    expect(busyCutoffs(0.75)).toEqual([0.7, 0.75, 0.95]);
    expect(busyCutoffs(0.6)).toEqual([0.6, 0.6, 0.95]);
    expect(busyCutoffs(1)).toEqual([0.7, 1, 1]);
    expect(toRatingConfig({}, 40).rules.busy.cutoffs).toEqual(DEFAULT_RATING_CUTOFFS.busy);
    expect(toRatingConfig({}, 40, 0.85).rules.busy.cutoffs).toEqual(DEFAULT_RATING_CUTOFFS.busy);
    expect(toRatingConfig({}, 40, 0.75).rules.busy.cutoffs).toEqual([0.7, 0.75, 0.95]);
  });

  it("is the ceiling bottlenecks count against", () => {
    const model: EngineModel = groups();
    const result = simulate(model, 6, 2);
    expect(rankBottlenecks(model, result).threshold).toBe(0.85);
    const set: EngineModel = { ...model, churnLimits: { loadThreshold: 0.7 } };
    expect(rankBottlenecks(set, result).threshold).toBe(0.7);
    expect(rankBottlenecks(set, result, { threshold: 0.9 }).threshold).toBe(0.9);
  });
});
