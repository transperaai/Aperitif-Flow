import { describe, expect, it } from "vitest";
import { flattenModel, isNested, NestingError, northbeamModel, runOnce, simulate, type EngineModel, type EngineStep } from "../src";

// Issue #102: a step can hold its own steps (a group, or a child process). The
// engine flattens to leaf steps before simulating, so a nested model must give
// exactly the results of the same model drawn flat.

const step = (id: string): EngineStep => northbeamModel().steps.find((s) => s.id === id)!;

/** Northbeam with its steps in boxes: Sales (qualify, discovery) and Setup (seo, ppc, live), both inside Pipeline. */
function nestedNorthbeam(): EngineModel {
  const flat = northbeamModel();
  const inside = (id: string, parent: string, next?: EngineStep["next"]): EngineStep => ({ ...step(id), parent, ...(next ? { next } : {}) });
  return {
    ...flat,
    groups: {
      pipeline: { name: "Pipeline", entry: "sales", next: [] },
      sales: {
        name: "Sales",
        parent: "pipeline",
        entry: "qualify",
        // Discovery has no next of its own: it leaves through the group.
        next: [
          { to: "audit", p: 0.7 },
          { to: "lost", p: 0.3 },
        ],
      },
      setup: { name: "Setup", entry: "seo", next: [{ to: "won", p: 1 }] },
    },
    steps: flat.steps.map((s) => {
      if (s.id === "qualify") return inside("qualify", "sales");
      if (s.id === "discovery") return inside("discovery", "sales", []);
      if (s.id === "audit") return inside("audit", "pipeline");
      if (s.id === "decision") return inside("decision", "pipeline");
      if (s.id === "seo" || s.id === "ppc") return inside(s.id, "setup");
      if (s.id === "live") return inside("live", "setup", []);
      return s;
    }),
  };
}

describe("flattenModel", () => {
  it("returns a flat model untouched", () => {
    const flat = northbeamModel();
    expect(isNested(flat)).toBe(false);
    expect(flattenModel(flat)).toBe(flat);
  });

  it("turns Northbeam in boxes back into Northbeam", () => {
    const nested = nestedNorthbeam();
    expect(isNested(nested)).toBe(true);
    const flat = flattenModel(nested);
    expect(flat.groups).toBeUndefined();
    expect(flat.steps.every((s) => s.parent === undefined)).toBe(true);
    expect(flat).toEqual(northbeamModel());
  });

  it("sends the model's entry, and edges into a group, to the group's entry", () => {
    const nested = nestedNorthbeam();
    // The whole pipeline is one box: entering it enters Sales, then Qualify.
    const viaGroup: EngineModel = { ...nested, entry: "pipeline" };
    expect(flattenModel(viaGroup).entry).toBe("qualify");
    const edgeIn: EngineModel = {
      ...nested,
      steps: nested.steps.map((s) => (s.id === "kickoff" ? { ...s, next: [{ to: "setup", p: 1 }] } : s)),
    };
    expect(flattenModel(edgeIn).steps.find((s) => s.id === "kickoff")!.next).toEqual([{ to: "seo", p: 1 }]);
  });

  it("leaves a group through its parent's edges when its own are empty", () => {
    const nested = nestedNorthbeam();
    const m: EngineModel = {
      ...nested,
      groups: { ...nested.groups, inner: { name: "Inner", parent: "setup", entry: "live", next: [] } },
      steps: nested.steps.map((s) => (s.id === "live" ? { ...s, parent: "inner" } : s)),
    };
    // live → inner (no next) → setup's next (won).
    expect(flattenModel(m).steps.find((s) => s.id === "live")!.next).toEqual([{ to: "won", p: 1 }]);
  });

  it("treats a child process's done ends as leaving it, multiplying the probabilities", () => {
    const base: EngineModel = {
      ...northbeamModel(),
      steps: [
        { id: "a", name: "A", role: "sales", work: 1, wait: 0, rework: 0, next: [{ to: "holder", p: 1 }] },
        // The holder step is a child process: its steps are c1 and c2.
        { id: "c1", name: "C1", role: "am", work: 1, wait: 0, rework: 0, parent: "holder", next: [{ to: "c2", p: 0.8 }, { to: "c_lost", p: 0.2 }] },
        { id: "c2", name: "C2", role: "am", work: 1, wait: 2, rework: 0.1, parent: "holder", next: [{ to: "c_done", p: 1 }] },
        { id: "z", name: "Z", role: "fin", work: 1, wait: 0, rework: 0, next: [{ to: "won", p: 1 }] },
        { id: "y", name: "Y", role: "fin", work: 1, wait: 0, rework: 0, next: [{ to: "won", p: 1 }] },
      ],
      entry: "a",
    };
    const nested: EngineModel = {
      ...base,
      groups: {
        holder: { name: "Child process", entry: "c1", exits: ["c_done"], next: [{ to: "z", p: 0.6 }, { to: "y", p: 0.4, tag: "rush" }] },
      },
      ends: { c_done: { outcome: "done" }, c_lost: { outcome: "lost" } },
    };
    const flat = flattenModel(nested);
    expect(flat.ends).toEqual({ c_lost: { outcome: "lost" } });
    expect(flat.steps.find((s) => s.id === "c2")!.next).toEqual([
      { to: "z", p: 0.6 },
      { to: "y", p: 0.4, tag: "rush" },
    ]);
    expect(flat.steps.find((s) => s.id === "a")!.next).toEqual([{ to: "c1", p: 1 }]);
    // c1's edge to the child's lost end is kept as it is.
    expect(flat.steps.find((s) => s.id === "c1")!.next).toEqual([{ to: "c2", p: 0.8 }, { to: "c_lost", p: 0.2 }]);
  });

  it("refuses loops of groups and groups with no way out", () => {
    const nested = nestedNorthbeam();
    const loop: EngineModel = { ...nested, groups: { ...nested.groups, sales: { ...nested.groups!.sales!, parent: "setup" }, setup: { ...nested.groups!.setup!, parent: "sales" } } };
    expect(() => flattenModel(loop)).toThrow(NestingError);
    const entering: EngineModel = { ...nested, groups: { ...nested.groups, a: { name: "A", entry: "b", next: [] }, b: { name: "B", entry: "a", next: [] } }, entry: "a" };
    expect(() => flattenModel(entering)).toThrow(/entered through itself/);
    const noExit: EngineModel = { ...nested, groups: { ...nested.groups, setup: { ...nested.groups!.setup!, next: [] } } };
    expect(() => flattenModel(noExit)).toThrow(/nothing leaving/);
    const orphan: EngineModel = { ...nested, steps: nested.steps.map((s) => (s.id === "qualify" ? { ...s, parent: "nope" } : s)) };
    expect(() => flattenModel(orphan)).toThrow(/doesn't exist/);
  });
});

describe("simulating a nested model", () => {
  it("gives exactly the numbers of the same model drawn flat", () => {
    const nested = simulate(nestedNorthbeam(), 6, 1);
    const flat = simulate(northbeamModel(), 6, 1);
    expect(nested).toEqual(flat);
  });

  it("runs one replication the same way, trace included", () => {
    const nested = runOnce(nestedNorthbeam(), 7, true);
    const flat = runOnce(northbeamModel(), 7, true);
    expect(nested).toEqual(flat);
  });

  it("gives the flat numbers for a child process held by a step", () => {
    // Flat: lead → qualify → onboard → (c1 → c2) → live → won, with the child's lost end.
    const flat: EngineModel = {
      ...northbeamModel(),
      entry: "qualify",
      sinks: { won: "won", lost: "lost" },
      ends: { c_lost: { outcome: "lost" } },
      steps: [
        { id: "qualify", name: "Qualify", role: "sales", work: 0.5, wait: 4, rework: 0, next: [{ to: "c1", p: 1 }] },
        { id: "c1", name: "C1", role: "am", work: 1, wait: 1, rework: 0, next: [{ to: "c2", p: 0.9 }, { to: "c_lost", p: 0.1 }] },
        { id: "c2", name: "C2", role: "seo", work: 2, wait: 3, rework: 0.1, next: [{ to: "live", p: 1 }] },
        { id: "live", name: "Go live", role: "am", work: 2, wait: 0, rework: 0, next: [{ to: "won", p: 1 }] },
      ],
    };
    const nested: EngineModel = {
      ...flat,
      ends: { c_done: { outcome: "done" }, c_lost: { outcome: "lost" } },
      groups: { child: { name: "Child", entry: "c1", exits: ["c_done"], next: [{ to: "live", p: 1 }] } },
      steps: [
        { ...flat.steps[0]!, next: [{ to: "child", p: 1 }] },
        { ...flat.steps[1]!, parent: "child" },
        { ...flat.steps[2]!, parent: "child", next: [{ to: "c_done", p: 1 }] },
        flat.steps[3]!,
      ],
    };
    expect(flattenModel(nested)).toEqual(flat);
    expect(simulate(nested, 5, 3)).toEqual(simulate(flat, 5, 3));
  });
});
