import { describe, expect, it } from "vitest";
import {
  BrokenScenarioError,
  brokenScenarioKey,
  checkScenario,
  detectBrokenScenarios,
  northbeamModel,
  replacementsFor,
  repointPatch,
  resolveScenario,
  type EngineModel,
  type RetiredSteps,
  type ScenarioPatch,
} from "../src";

const automate: ScenarioPatch[] = [{ path: "steps.audit.work_hours", op: "multiply", value: 0.4 }];

/** Northbeam with a step removed (edges into it re-routed to `to`), as a published revision would resolve. */
function without(id: string, to: string[] = []): EngineModel {
  const m = northbeamModel();
  const gone = m.steps.find((s) => s.id === id)!;
  m.steps = m.steps.filter((s) => s.id !== id);
  for (const s of m.steps) s.next = s.next.map((e) => (e.to === id ? { ...e, to: to[0] ?? gone.next[0]!.to } : e));
  return m;
}

/** Northbeam with Audit & proposal split into Audit and Proposal. */
function split(): { model: EngineModel; retired: RetiredSteps } {
  const m = without("audit", ["audit_a"]);
  const old = northbeamModel().steps.find((s) => s.id === "audit")!;
  m.steps.push(
    { ...old, id: "audit_a", name: "Audit", work: 3, next: [{ to: "audit_b", p: 1 }] },
    { ...old, id: "audit_b", name: "Proposal", work: 3, next: old.next },
  );
  return { model: m, retired: { audit: { name: "Audit & proposal", replacedBy: ["audit_a", "audit_b"] } } };
}

describe("checkScenario", () => {
  it("is ok while every target resolves", () => {
    expect(checkScenario(northbeamModel(), automate)).toEqual({ status: "ok", broken: [] });
  });

  it("marks a scenario whose step was deleted as needs attention, naming the path and the step", () => {
    const r = checkScenario(without("audit"), automate, { audit: { name: "Audit & proposal", replacedBy: [] } });
    expect(r.status).toBe("needs_attention");
    expect(r.broken).toEqual([
      expect.objectContaining({
        index: 0,
        path: "steps.audit.work_hours",
        problem: "missing_target",
        kind: "steps",
        targetId: "audit",
        targetName: "Audit & proposal",
        replaced: false,
        replacements: [],
        message: "“Audit & proposal” (hands-on time) was deleted from the process. Re-point this change or remove the scenario.",
      }),
    ]);
  });

  it("marks a scenario whose step was split as needs attention and suggests the replacing steps", () => {
    const { model, retired } = split();
    const r = checkScenario(model, automate, retired);
    expect(r.status).toBe("needs_attention");
    expect(r.broken[0]).toMatchObject({
      replaced: true,
      replacements: [
        { id: "audit_a", name: "Audit" },
        { id: "audit_b", name: "Proposal" },
      ],
      message: "“Audit & proposal” (hands-on time) was split into Audit and Proposal. Re-point this change to one of them.",
    });
  });

  it("names a single replacement, and copes with a step it knows nothing about", () => {
    const m = without("audit");
    m.steps.push({ ...northbeamModel().steps.find((s) => s.id === "audit")!, id: "proposal", name: "Proposal" });
    const one = checkScenario(m, automate, { audit: { name: "Audit & proposal", replacedBy: ["proposal"] } });
    expect(one.broken[0]!.message).toBe("“Audit & proposal” (hands-on time) was replaced by Proposal. Re-point this change to it.");
    const unknown = checkScenario(without("audit"), automate);
    expect(unknown.broken[0]!.message).toMatch(/^It changes the hands-on time of a step that is no longer in the process/);
  });

  it("lists only the broken patches, and ignores clamped ones", () => {
    const patches: ScenarioPatch[] = [
      { path: "demand.leads_per_week", op: "multiply", value: 1.2 },
      { path: "steps.audit.rework_rate", op: "set", value: 5 },
      { path: "people.gone.fte", op: "set", value: 1 },
    ];
    const r = checkScenario(northbeamModel(), patches);
    expect(r.broken.map((b) => [b.index, b.kind, b.message])).toEqual([
      [2, "people", "It changes the FTE of a person that is no longer in the model. Re-point this change or remove the scenario."],
    ]);
  });
});

describe("replacementsFor", () => {
  it("follows replacements of replacements, dropping deleted ones and cycles", () => {
    const m = northbeamModel();
    const retired: RetiredSteps = {
      x: { name: "X", replacedBy: ["y", "audit"] },
      y: { name: "Y", replacedBy: ["kickoff", "gone", "x"] },
    };
    expect(replacementsFor(m, retired, "x")).toEqual(["kickoff", "audit"]);
    // A step that still exists isn't replaced by anything.
    expect(replacementsFor(m, retired, "audit")).toEqual([]);
  });
});

describe("resolveScenario", () => {
  it("refuses to run a broken scenario instead of skipping the patch", () => {
    const { model, retired } = split();
    expect(() => resolveScenario(model, automate, { retired, name: "Automate proposals" })).toThrow(BrokenScenarioError);
    try {
      resolveScenario(model, [{ path: "demand.leads_per_week", op: "multiply", value: 2 }, ...automate], { retired, name: "Automate proposals" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BrokenScenarioError);
      expect((err as BrokenScenarioError).broken.map((b) => b.index)).toEqual([1]);
      expect((err as Error).message).toMatch(/^“Automate proposals” needs attention and can't be run: 1 of its changes no longer resolves\. “Audit & proposal”/);
    }
  });

  it("applies a scenario that resolves, clamps included", () => {
    const r = resolveScenario(northbeamModel(), [...automate, { path: "steps.audit.rework_rate", op: "set", value: 5 }]);
    expect(r.model.steps.find((s) => s.id === "audit")!.work).toBeCloseTo(2.4);
    expect(r.issues.map((i) => i.problem)).toEqual(["clamped"]);
  });
});

describe("repointPatch", () => {
  it("re-points one patch, which clears the needs-attention status", () => {
    const { model, retired } = split();
    const patches = repointPatch(automate, 0, "audit_b");
    expect(patches).toEqual([{ path: "steps.audit_b.work_hours", op: "multiply", value: 0.4 }]);
    expect(checkScenario(model, patches, retired).status).toBe("ok");
    expect(automate[0]!.path).toBe("steps.audit.work_hours");
  });

  it("leaves paths without an id alone", () => {
    const p: ScenarioPatch[] = [{ path: "demand.leads_per_week", op: "add", value: 1 }];
    expect(repointPatch(p, 0, "x")).toEqual(p);
  });
});

describe("detectBrokenScenarios", () => {
  const scenarios = [
    { id: "s1", name: "Hire a strategist", patch: [{ path: "roles.strat.headcount", op: "add", value: 1 }] as ScenarioPatch[] },
    { id: "s2", name: "Automate proposals", patch: automate },
  ];

  it("raises one broken_scenario issue per broken scenario, with a stable key", () => {
    const { model, retired } = split();
    const issues = detectBrokenScenarios(model, scenarios, retired);
    expect(issues).toEqual([
      {
        key: brokenScenarioKey("s2"),
        type: "broken_scenario",
        rating: "bad",
        escalation: { base: "bad", badMonth: false, bottleneck: false },
        cost: { perMonth: null, hoursPerMonth: null, method: "A broken saved scenario has no money method." },
        title: "Scenario “Automate proposals” needs attention",
        evidence:
          "Its only change no longer resolves against the model: “Audit & proposal” (hands-on time) was split into Audit and Proposal. " +
          "Re-point this change to one of them. It is left out of comparisons and reports until it is fixed.",
        metrics: { broken_changes: 1, changes: 1 },
        stepId: "audit_a",
        roleId: null,
        personId: null,
        fix: null,
        scenarioId: "s2",
      },
    ]);
    expect(issues[0]!.key).toBe("broken_scenario:scenario:s2");
    expect(detectBrokenScenarios(model, scenarios, retired)).toEqual(issues);
  });

  it("resolves (raises nothing) once the scenario is re-pointed", () => {
    const { model, retired } = split();
    const fixed = scenarios.map((s) => (s.id === "s2" ? { ...s, patch: repointPatch(s.patch, 0, "audit_a") } : s));
    expect(detectBrokenScenarios(model, fixed, retired)).toEqual([]);
    expect(detectBrokenScenarios(northbeamModel(), scenarios)).toEqual([]);
  });
});
