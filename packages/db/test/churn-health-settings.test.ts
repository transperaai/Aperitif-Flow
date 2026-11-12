import { describe, expect, it } from "vitest";
import { WEEKS_PER_MONTH } from "@transpera-flow/engine";
import { churnLimitsOf, larkspurBundle, monthsBetween, toEngineModel, type CapacityInputs, type CapacityServiceRow, type ProcessBundle, type WorkspaceSettings } from "../src";

// Customisability audit, findings 1, 2, 8, 16, 34 and 38: the workspace's churn-driver limits, health bands, starting health and
// client start dates reach the engine model. A workspace that sets none of them maps exactly as before.

const START = "2026-10-05";
const base = larkspurBundle();
const withSettings = (extra: Partial<WorkspaceSettings>, b: ProcessBundle = base): ProcessBundle => ({ ...b, workspace: { ...b.workspace, settings: { ...b.workspace.settings, ...extra } } });
const model = (b: ProcessBundle) => toEngineModel(b, { startDate: START });

describe("churn-driver limits (findings 1 and 2)", () => {
  it("nothing set: no churnLimits on the model", () => {
    expect(model(base).churnLimits).toBeUndefined();
    expect(churnLimitsOf(base.workspace.settings)).toBeUndefined();
  });

  it("utilisation_threshold is the overload line; months become weeks; the rest map as stored", () => {
    const m = model(
      withSettings({
        utilisation_threshold: 0.75,
        churn_load_full: 0.95,
        churn_response_full_share: 0.3,
        churn_rework_full_share: 0.1,
        churn_onboarding_full_multiple: 3,
        churn_early_tenure_months: 3,
        churn_away_pressure: 1,
        churn_results_normal: 7,
        churn_price_months: 6,
      }),
    );
    expect(m.churnLimits).toEqual({
      loadThreshold: 0.75,
      loadFull: 0.95,
      responseFullShare: 0.3,
      reworkFullShare: 0.1,
      onboardingFullMultiple: 3,
      earlyTenureWeeks: 3 * WEEKS_PER_MONTH,
      awayPressure: 1,
      resultsNormal: 7,
      priceWeeks: 6 * WEEKS_PER_MONTH,
    });
  });

  it("a null leaves that one at the engine's default", () => {
    expect(model(withSettings({ utilisation_threshold: null, churn_results_normal: 9 })).churnLimits).toEqual({ resultsNormal: 9 });
  });
});

describe("health bands (findings 34 and 38)", () => {
  it("map onto the model; none set, none mapped", () => {
    expect(model(base).healthBands).toBeUndefined();
    expect(model(withSettings({ health_at_risk: 40, health_healthy_from: 85 })).healthBands).toEqual({ atRisk: 40, healthy: 85 });
  });
});

describe("start dates (finding 16)", () => {
  it("monthsBetween counts average months, 0 for none or backwards", () => {
    expect(monthsBetween("2026-01-05", "2027-01-05")).toBeCloseTo(12, 1);
    expect(monthsBetween("2026-10-05", "2026-10-05")).toBe(0);
    expect(monthsBetween("2026-11-05", "2026-10-05")).toBe(0);
  });

  it("a named client with a start date has monthsActive; one without has none", () => {
    const [a, b] = base.clients!.filter((c) => c.active) as [NonNullable<ProcessBundle["clients"]>[number], NonNullable<ProcessBundle["clients"]>[number]];
    const clients = base.clients!.map((c) => (c.id === a.id ? { ...c, start_date: "2026-07-05" } : c.id === b.id ? { ...c, start_date: null } : c));
    const m = model({ ...base, clients });
    expect(m.clients![a.id]!.monthsActive).toBeCloseTo(3, 1);
    expect(m.clients![b.id]!.monthsActive).toBeUndefined();
  });
});

describe("starting health of counted clients in a tier workspace (finding 8)", () => {
  const blank = { words: null, links: null, tech_hours: null, meetings: null, builds: null, creative_sets: null, channels: null } as const;
  const [S1] = base.services.map((s) => s.id) as [string];
  const T1 = "f0000000-0000-4000-8000-000000000001";
  const DEPT = "d0000000-0000-4000-8000-000000000001";
  const svc = (id: string): CapacityServiceRow => ({ id, department_id: DEPT, tier_id: T1, ...blank, adhoc_chance: null, adhoc_requests: null });
  const tiered = (b: ProcessBundle): ProcessBundle => {
    const capacity: CapacityInputs = {
      tiers: [{ id: T1, key: "T1", sort: 1 }],
      services: [svc(S1)],
      clients: [],
      roles: b.roles.map((r) => ({ id: r.id, kind: "client_facing", unit: null })),
      people: [],
      personTiers: [],
      portfolio: [{ person_id: b.people[0]!.id, service_id: S1, client_count: 3 }],
    };
    return { ...b, clientGroups: [], capacity };
  };

  it("with no group row, a counted client starts at the workspace's starting health, not a fixed 80", () => {
    const { health_initial: _drop, ...rest } = base.workspace.settings;
    const none = { ...base, workspace: { ...base.workspace, settings: rest as WorkspaceSettings } };
    expect(model(tiered(none)).clientGroups![S1]!.health).toBe(80);
    expect(model(tiered(withSettings({ health_initial: 62 }))).clientGroups![S1]!.health).toBe(62);
  });
});
