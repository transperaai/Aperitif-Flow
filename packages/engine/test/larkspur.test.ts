import { describe, expect, it } from "vitest";
import { LARKSPUR_ROSTER, larkspurClientKey, larkspurModel, simulate, type EngineModel } from "../src";

// Larkspur Creative is the messier golden agency (docs/PRD.md §6.9 layer 3).
// Its baseline (golden.test.ts) locks the numbers; these check it still
// exercises what it is there for, so a re-approved baseline can't quietly
// turn it into a tidy business.

describe("Larkspur, the messier golden agency", () => {
  const model = larkspurModel();
  const run = simulate(model, 30, 1);

  it("is overloaded: the copywriter's client work is past her week and designers are near full", () => {
    expect(run.kpi.people.imogen!.util.mean).toBeGreaterThan(1);
    expect(run.kpi.roles.design!.util.mean).toBeGreaterThan(0.8);
    expect(run.steps.concepts!.queueGrowth).toBeGreaterThan(0);
  });

  it("works overtime, up to the 15% cap", () => {
    expect(run.kpi.overtimeHours.mean).toBeGreaterThan(0);
    expect(run.kpi.people.imogen!.overtime.mean).toBeGreaterThan(0);
    expect(run.kpi.people.imogen!.overtime.mean).toBeLessThanOrEqual(0.15 + 1e-12);
  });

  it("starts from the work in progress entered, not a warm-up", () => {
    expect(run.initialState).toEqual({ kind: "wip", items: 8 });
  });

  it("misses servicing touchpoints, so clients fall below 50 health and churn", () => {
    expect(run.kpi.touchpoints!.missed.mean).toBeGreaterThan(0);
    expect(run.kpi.touchpoints!.late.mean).toBeGreaterThan(0);
    expect(run.kpi.clientsAtRisk!.mean).toBeGreaterThan(0);
    expect(run.kpi.clientsChurned!.mean).toBeGreaterThan(0);
  });

  it("churn follows health: without health sensitivity, fewer clients churn", () => {
    const flat: EngineModel = {
      ...model,
      services: Object.fromEntries(Object.entries(model.services!).map(([id, sv]) => [id, { ...sv, churnSensitivity: 0 }])),
    };
    expect(simulate(flat, 30, 1).kpi.clientsChurned!.mean).toBeLessThan(run.kpi.clientsChurned!.mean);
  });

  it("has a named roster, one client with no health entered, which starts at the workspace's 75", () => {
    expect(Object.keys(run.clients!)).toHaveLength(LARKSPUR_ROSTER.length);
    const unrated = LARKSPUR_ROSTER.findIndex((c) => c.health === null);
    expect(unrated).toBeGreaterThanOrEqual(0);
    expect(run.clients![larkspurClientKey(unrated)]!.trajectory[0]).toBe(75);
  });
});
