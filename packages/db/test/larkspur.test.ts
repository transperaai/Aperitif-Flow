import { describe, expect, it } from "vitest";
import { LARKSPUR_START, larkspurModel, simulate, type EngineModel } from "@transpera-flow/engine";
import {
  larkspurBundle,
  larkspurClientIds,
  larkspurPersonIds,
  larkspurProcessIds,
  larkspurRoleIds,
  larkspurServiceIds,
  larkspurStepIds,
  toEngineModel,
} from "../src";

// Larkspur Creative's seed rows (issue #22) must resolve to exactly the
// engine's golden larkspurModel(), so the golden baselines describe the
// business the seed loads.

/** Swap the fixture's uuids back to the engine fixture's readable keys. */
function withKeys(model: EngineModel): EngineModel {
  const names = new Map<string, string>(
    [larkspurStepIds, larkspurRoleIds, larkspurServiceIds, larkspurClientIds, larkspurProcessIds, larkspurPersonIds].flatMap((ids) =>
      Object.entries(ids).map(([k, v]) => [v, k] as const),
    ),
  );
  const key = (id: string) => names.get(id) ?? id;
  const keyed = <T>(record: Record<string, T>, value: (v: T) => T = (v) => v) =>
    Object.fromEntries(Object.entries(record).map(([id, v]) => [key(id), value(v)]));
  return {
    ...model,
    services: keyed(model.services!, (sv) => ({
      ...sv,
      ...(sv.fallbackOngoing ? { fallbackOngoing: keyed(sv.fallbackOngoing) } : {}),
      ...(sv.servicing ? { servicing: sv.servicing.map((l) => ({ ...l, process: key(l.process) })) } : {}),
    })),
    people: keyed(model.people!, (p) => ({ ...p, roles: p.roles.map(key), ...(p.skills ? { skills: p.skills.map(key) } : {}) })),
    clients: keyed(model.clients!, (c) => ({
      ...c,
      services: c.services.map(key).sort(),
      assignments: Object.fromEntries(Object.entries(c.assignments).map(([r, p]) => [key(r), key(p)])),
    })),
    servicingProcesses: keyed(model.servicingProcesses!, (p) => ({ ...p, entry: key(p.entry), steps: p.steps.map(key) })),
    ends: keyed(model.ends!),
    entry: key(model.entry),
    sinks: { won: key(model.sinks.won), lost: key(model.sinks.lost) },
    roles: keyed(model.roles),
    steps: model.steps.map((s) => ({
      ...s,
      id: key(s.id),
      role: s.role && key(s.role),
      ...(s.person ? { person: key(s.person) } : {}),
      next: s.next.map((n) => ({ ...n, to: key(n.to) })),
    })),
  };
}

describe("Larkspur Creative's seed rows", () => {
  it("resolve on its start date into exactly the engine's golden Larkspur model", () => {
    expect(withKeys(toEngineModel(larkspurBundle(), { startDate: LARKSPUR_START }))).toEqual(larkspurModel());
  });

  it("don't depend on row order", () => {
    const shuffled = larkspurBundle();
    for (const rows of [shuffled.steps, shuffled.edges, shuffled.roles, shuffled.people, shuffled.personRoles, shuffled.clients!, shuffled.services]) rows.reverse();
    expect(toEngineModel(shuffled, { startDate: LARKSPUR_START })).toEqual(toEngineModel(larkspurBundle(), { startDate: LARKSPUR_START }));
  });

  it("simulate as the messier agency: overtime, clients at risk and churned", () => {
    const run = simulate(toEngineModel(larkspurBundle(), { startDate: LARKSPUR_START }), 30, 1);
    expect(run.kpi.overtimeHours.mean).toBeGreaterThan(0);
    expect(run.kpi.clientsAtRisk!.mean).toBeGreaterThan(0);
    expect(run.kpi.clientsChurned!.mean).toBeGreaterThan(0);
  });
});
