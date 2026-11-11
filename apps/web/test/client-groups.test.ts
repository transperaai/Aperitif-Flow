import { describe, expect, it } from "vitest";
import { clientHealthSummary, simulate } from "@transpera-flow/engine";
import { northbeamBundle, toEngineModel } from "@transpera-flow/db";
import {
  CLIENT_GROUP_FIELDS,
  benchmarkOf,
  isBenchmarkBound,
  isClientGroupField,
  newGroupDefaults,
  positionAgainst,
} from "@/lib/client-groups";
import { BUSY_LIMIT, personRows, teamSummary } from "@/lib/people";

// Client groups (issue #120): the settings' input checks, the benchmark, and what the People page works out from a run.

describe("client group fields", () => {
  it("knows the five fields", () => {
    for (const f of ["client_count", "fee", "churn_monthly", "stay_months", "starting_health"]) expect(isClientGroupField(f)).toBe(true);
    for (const f of ["service_id", "workspace_id", "id", "toString", "__proto__", 3, null]) expect(isClientGroupField(f)).toBe(false);
  });

  it("accepts whole client counts only", () => {
    const ok = CLIENT_GROUP_FIELDS.client_count;
    expect([0, 15, 2000].map(ok)).toEqual([true, true, true]);
    expect([-1, 1.5, 2001, NaN, "3", null].map(ok)).toEqual([false, false, false, false, false, false]);
  });

  it("keeps churn a share, health 0 to 100, and fee and stay non-negative", () => {
    expect([0, 0.015, 1].map(CLIENT_GROUP_FIELDS.churn_monthly)).toEqual([true, true, true]);
    expect([-0.1, 1.1].map(CLIENT_GROUP_FIELDS.churn_monthly)).toEqual([false, false]);
    expect([0, 80, 100].map(CLIENT_GROUP_FIELDS.starting_health)).toEqual([true, true, true]);
    expect([-1, 101].map(CLIENT_GROUP_FIELDS.starting_health)).toEqual([false, false]);
    expect([0, 3600].map(CLIENT_GROUP_FIELDS.fee)).toEqual([true, true]);
    expect(CLIENT_GROUP_FIELDS.fee(-5)).toBe(false);
    expect([0, 22].map(CLIENT_GROUP_FIELDS.stay_months)).toEqual([true, true]);
    expect(CLIENT_GROUP_FIELDS.stay_months(2000)).toBe(false);
  });

  it("starts a new group from its service's price, churn and tenure, at health 80 with no clients", () => {
    expect(newGroupDefaults({ price: 3500, churn_monthly_base: 0.03, tenure_months: 18 })).toEqual({
      client_count: 0,
      fee: 3500,
      churn_monthly: 0.03,
      stay_months: 18,
      starting_health: 80,
    });
  });
});

describe("the benchmark", () => {
  it("is a range from the settings, low first, or none when either end is missing", () => {
    expect(benchmarkOf({ client_health_benchmark_low: 70, client_health_benchmark_high: 80 })).toEqual({ low: 70, high: 80 });
    expect(benchmarkOf({ client_health_benchmark_low: 80, client_health_benchmark_high: 70 })).toEqual({ low: 70, high: 80 });
    expect(benchmarkOf({ client_health_benchmark_low: 70 })).toBeNull();
    expect(benchmarkOf({ client_health_benchmark_high: 80, client_health_benchmark_low: null })).toBeNull();
    expect(benchmarkOf({})).toBeNull();
  });

  it("takes bounds from 0 to 100, or null to clear", () => {
    expect([0, 70, 100, null].map(isBenchmarkBound)).toEqual([true, true, true, true]);
    expect([-1, 101, NaN, "70", undefined].map(isBenchmarkBound)).toEqual([false, false, false, false, false]);
  });

  it("places a score below, in or above the range, to the whole number", () => {
    const b = { low: 70, high: 80 };
    expect([69.4, 69.5, 70, 80, 80.4, 80.5, 95].map((s) => positionAgainst(s, b))).toEqual(["below", "in range", "in range", "in range", "in range", "above", "above"]);
  });
});

describe("Northbeam's People page numbers", () => {
  const model = toEngineModel(northbeamBundle(), { startDate: "2026-10-05" });
  const result = simulate(model, 10, 1);

  it("counts the groups' clients, not the named roster, and rates each group", () => {
    expect(northbeamBundle().clients).toHaveLength(26);
    const health = clientHealthSummary(model, result);
    expect(health.clients).toBe(29);
    expect(health.groups.map((g) => g.clients).sort()).toEqual([12, 17]);
    expect(health.score).toBeGreaterThan(0);
    expect(health.healthy + health.watch + health.atRisk).toBeCloseTo(1, 10);
  });

  it("lists everyone with their average, P90 and FTE, and totals the team", () => {
    const fte = new Map(northbeamBundle().people.map((p) => [p.id, Number(p.fte)]));
    const rows = personRows(model, result, fte);
    expect(rows).toHaveLength(11);
    expect(rows.every((r) => r.p90 >= r.average - 1e-9 && r.fte === 1)).toBe(true);
    expect(rows[0]!.role).toBe("Sales");
    const team = teamSummary(rows);
    expect(team).toMatchObject({ people: 11, fte: 11 });
    expect(team.busyInBadMonth).toBe(rows.filter((r) => r.p90 > BUSY_LIMIT).length);
  });

  it("leaves FTE out for people the model made up", () => {
    const rows = personRows(model, result, new Map());
    expect(rows.every((r) => r.fte === null)).toBe(true);
    expect(teamSummary(rows).fte).toBeNull();
  });
});
