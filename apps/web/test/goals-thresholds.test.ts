import { describe, expect, it } from "vitest";
import { larkspurBundle, toEngineModel } from "@transpera-flow/db";
import { parseAnalysisSettings, resolveMoney, simulate, toRatingConfig } from "@transpera-flow/engine";
import { analysisRulesOf, ANALYSIS_DEFAULTS } from "@/lib/analysis/defaults";
import { ASSUMPTION_LIMITS, assumptionValues, validAssumption, withAssumption } from "@/lib/analysis/assumptions";
import { OVERVIEW_HORIZONS, nearestOverviewHorizon } from "@/lib/horizon";
import { BUSY_LIMIT, personRows, teamSummary } from "@/lib/people";
import { busyTone } from "@/lib/sandbox/play-results-data";
import { busiestAnswer, closeToThreshold } from "@/components/overview/busiest-people";
import { departmentsAnswer, dlerStatus, employeesLabel } from "@/components/overview/department-cards";
import { toneOf } from "@/components/capacity/widgets";

// Goals and busy thresholds an owner sets (docs/customisability-audit.md findings 3, 11, 12, 32, 35, 40, 45, 48 and 50).

describe("the DLER goal is the workspace's", () => {
  const row = { ratio: 3.2, hidden: false };
  it("judges DLER against the goal given, 4.5 when none is", () => {
    expect(dlerStatus(row)?.tone).toBe("warn");
    expect(dlerStatus(row, 3)).toEqual({ tone: "good", words: "At or above the 3 goal" });
  });
  it("says which departments are below the goal set", () => {
    const rows = [{ name: "Organic", dler: row, run: null }];
    expect(departmentsAnswer(rows, 3)).toMatch(/^Organic is at or above the 3 DLER goal/);
    expect(departmentsAnswer(rows)).toMatch(/^Organic is below the 4\.5 DLER goal/);
  });
});

describe("the at-risk margin is the workspace's", () => {
  const people = [
    { id: "a", busy: 0.7, line: 0.85 },
    { id: "b", busy: 0.8, line: 0.85 },
  ];
  it("puts people near their threshold by the margin given", () => {
    expect(closeToThreshold(people).close.map((p) => p.id)).toEqual(["b"]);
    expect(closeToThreshold(people, 0.2).close.map((p) => p.id)).toEqual(["b", "a"]);
    expect(busiestAnswer(closeToThreshold(people, 0.2).close, 0.2)).toBe("2 within 20 points of their utilisation threshold.");
  });
  it("colours the Capacity bars and the Sandbox heatmap by the same margin", () => {
    expect(toneOf(0.7, 0.85)).toBe("ok");
    expect(toneOf(0.7, 0.85, 0.2)).toBe("warn");
    expect(busyTone(0.7, 0.85, 0.2)).toBe("warn");
    expect(busyTone(0.75, 0.85)).toBe("warn");
  });
});

describe("revenue per employee counts FTE", () => {
  it("names whole people as people and fractions as FTE", () => {
    expect(employeesLabel(3)).toBe("3 people");
    expect(employeesLabel(1)).toBe("1 person");
    expect(employeesLabel(2.4)).toBe("2.4 FTE");
  });
});

describe("analysis assumptions (Settings > Simulation)", () => {
  it("reads the defaults when nothing is stored", () => {
    expect(assumptionValues({})).toEqual({ capMonths: 12, absenceWeeks: 2, absencesPerYear: 2, busyBelow: 0.15, busyAbove: 0.1 });
    expect(analysisRulesOf(null)).toBe(ANALYSIS_DEFAULTS);
    expect(analysisRulesOf({ analysisRules: { money: { capMonths: 24 } } })).toEqual({ money: { capMonths: 24 } });
  });
  it("writes one assumption and keeps the rest of what is stored", () => {
    const stored = { escalators: { badMonth: false }, money: { absenceWeeks: 4 } };
    const next = withAssumption(stored, "capMonths", 24);
    expect(next.escalators).toEqual({ badMonth: false });
    expect(resolveMoney(next)).toMatchObject({ capMonths: 24, absenceWeeks: 4 });
    expect(parseAnalysisSettings(next).ok).toBe(true);
    // Back to the default: nothing stored for it.
    expect(parseAnalysisSettings(withAssumption(next, "capMonths", null)).value.money).toEqual({ absenceWeeks: 4 });
  });
  it("moves the busy bands around the threshold, and the engine rates with them", () => {
    const wider = withAssumption(withAssumption({}, "busyBelow", 0.25), "busyAbove", 0.2);
    expect(assumptionValues(wider)).toMatchObject({ busyBelow: 0.25, busyAbove: 0.2 });
    expect(toRatingConfig(wider, 40).rules.busy.cutoffs).toEqual([0.6, 0.85, 1.05]);
    expect(toRatingConfig(withAssumption({}, "absenceWeeks", 4), 40).absence.weeks).toBe(4);
  });
  it("refuses values out of range", () => {
    expect(validAssumption("capMonths", 0)).toBe(false);
    expect(validAssumption("capMonths", 2.5)).toBe(false);
    expect(validAssumption("capMonths", ASSUMPTION_LIMITS.capMonths.max)).toBe(true);
    expect(validAssumption("busyBelow", 0.6)).toBe(false);
  });
});

describe("the People page holds each person to their role's threshold", () => {
  it("rates a bad month against the role's line, not a fixed 85%", () => {
    const bundle = larkspurBundle();
    const model = toEngineModel(bundle, { startDate: "2026-01-05" });
    const result = simulate(model, 4, 1);
    const rows = personRows(model, result, new Map());
    expect(rows.every((r) => r.line === BUSY_LIMIT)).toBe(true);
    const strict = { ...model, roles: Object.fromEntries(Object.entries(model.roles).map(([id, r]) => [id, { ...r, line: 0.01 }])) };
    const strictRows = personRows(strict, result, new Map());
    expect(strictRows.every((r) => r.line === 0.01)).toBe(true);
    expect(teamSummary(strictRows).busyInBadMonth).toBe(strictRows.filter((r) => r.p90 > 0.01).length);
    expect(teamSummary(strictRows).busyInBadMonth).toBeGreaterThanOrEqual(teamSummary(rows).busyInBadMonth);
  });
});

describe("the Overview can look a year ahead", () => {
  it("offers 12 months, and a 12-month workspace opens on it", () => {
    expect(OVERVIEW_HORIZONS).toContain(12);
    expect(nearestOverviewHorizon(52)).toBe(12);
    expect(nearestOverviewHorizon(13)).toBe(3);
  });
});
