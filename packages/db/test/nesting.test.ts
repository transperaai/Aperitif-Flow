import { describe, expect, it } from "vitest";
import { absolutePositions, companyMap, flattenCompanyMap, leavesIn, rollUp, visibleEdges, visibleEndpoint, visibleSteps, type EdgeRow, type StepRow } from "../src";

// What a map shows of nested steps (issue #102): groups open or closed, edges
// rolled up to the closed group that hides their end, and a closed group's roll-up.

const s = (id: string, over: Partial<StepRow> = {}): StepRow =>
  ({ id, name: id, kind: "task", parent_step_id: null, entry_step_id: null, child_process_id: null, work_hours: 1, x: 0, y: 0, ...over }) as StepRow;
const e = (id: string, from: string, to: string, over: Partial<EdgeRow> = {}): EdgeRow =>
  ({ id, from_step_id: from, to_step_id: to, probability: 1, condition_tag: null, label: null, ...over }) as EdgeRow;

// start → A → [Box: b1 → [Inner: i1, i2] → b2] → Z → won, and b1 → lost.
const steps = [
  s("start", { kind: "start", work_hours: 0 }),
  s("A", { work_hours: 2 }),
  s("Box", { kind: "group", work_hours: 0, x: 100, y: 50 }),
  s("b1", { parent_step_id: "Box", x: 10, y: 10, work_hours: 3 }),
  s("Inner", { kind: "group", parent_step_id: "Box", work_hours: 0, x: 10, y: 80 }),
  s("i1", { parent_step_id: "Inner", x: 5, y: 5, work_hours: 0.5 }),
  s("i2", { parent_step_id: "Inner", x: 5, y: 60, work_hours: 0.25 }),
  s("b2", { parent_step_id: "Box", x: 10, y: 200, work_hours: 4 }),
  s("Z", { work_hours: 1 }),
  s("won", { kind: "end", work_hours: 0 }),
  s("lost", { kind: "end", work_hours: 0 }),
];
const edges = [
  e("e1", "start", "A"),
  e("e2", "A", "Box"),
  e("e3", "b1", "i1", { probability: 0.7 }),
  e("e4", "b1", "lost", { probability: 0.3 }),
  e("e5", "i1", "i2"),
  e("e6", "i2", "b2"),
  e("e7", "Box", "Z"),
  e("e8", "b2", "Z"),
  e("e9", "Z", "won"),
];
const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

describe("visibleSteps", () => {
  it("shows a closed group as one step", () => {
    expect(ids(visibleSteps(steps, new Set()))).toEqual(["A", "Box", "Z", "lost", "start", "won"]);
  });

  it("shows the steps of an open group, and keeps an inner group closed until it is opened", () => {
    expect(ids(visibleSteps(steps, new Set(["Box"])))).toEqual(["A", "Box", "Inner", "Z", "b1", "b2", "lost", "start", "won"]);
    expect(ids(visibleSteps(steps, new Set(["Box", "Inner"])))).toEqual(ids(steps));
    expect(ids(visibleSteps(steps, "all"))).toEqual(ids(steps));
  });

  it("hides what is inside a closed group even if an inner group is marked open", () => {
    expect(ids(visibleSteps(steps, new Set(["Inner"])))).toEqual(["A", "Box", "Z", "lost", "start", "won"]);
  });
});

describe("visibleEndpoint", () => {
  const byId = new Map(steps.map((x) => [x.id, x]));
  it("is the outermost closed group, or the step itself", () => {
    expect(visibleEndpoint("i1", byId, new Set())).toBe("Box");
    expect(visibleEndpoint("i1", byId, new Set(["Box"]))).toBe("Inner");
    expect(visibleEndpoint("i1", byId, "all")).toBe("i1");
    expect(visibleEndpoint("A", byId, new Set())).toBe("A");
  });
});

describe("visibleEdges", () => {
  const summary = (xs: ReturnType<typeof visibleEdges>) => xs.map((x) => `${x.from}>${x.to}${x.rolled ? "*" : ""}`).sort();

  it("draws everything when all is open", () => {
    expect(summary(visibleEdges(steps, edges, "all"))).toEqual(["A>Box", "Box>Z", "Z>won", "b1>i1", "b1>lost", "b2>Z", "i1>i2", "i2>b2", "start>A"].sort());
  });

  it("hides the edges inside a closed group and rolls up the ones that cross its border", () => {
    const shown = visibleEdges(steps, edges, new Set());
    // b1 → lost leaves the group, b2 → Z merges with the group's own edge to Z.
    expect(summary(shown)).toEqual(["A>Box", "Box>Z", "Box>Z*", "Box>lost*", "Z>won", "start>A"].sort());
    const toZ = shown.find((x) => x.rolled && x.to === "Z")!;
    expect(toZ).toMatchObject({ edgeIds: ["e8"], probability: 1 });
    expect(shown.find((x) => x.to === "lost")).toMatchObject({ rolled: true, edgeIds: ["e4"] });
  });

  it("merges edges that become the same connection, with no single share", () => {
    const more = [...edges, e("e10", "i2", "Z", { probability: 0.5 })];
    const shown = visibleEdges(steps, more, new Set());
    const merged = shown.find((x) => x.rolled && x.to === "Z")!;
    expect(merged.edgeIds.sort()).toEqual(["e10", "e8"]);
    expect(merged.probability).toBeNull();
  });

  it("opens one level at a time", () => {
    expect(summary(visibleEdges(steps, edges, new Set(["Box"])))).toEqual(["A>Box", "Box>Z", "Z>won", "b1>Inner*", "b1>lost", "Inner>b2*", "b2>Z", "start>A"].sort());
  });
});

describe("absolutePositions", () => {
  it("adds up the groups a step sits in", () => {
    const at = absolutePositions(steps);
    expect(at.get("A")).toEqual({ x: 0, y: 0 });
    expect(at.get("b1")).toEqual({ x: 110, y: 60 });
    expect(at.get("i2")).toEqual({ x: 115, y: 190 });
  });
});

describe("companyMap", () => {
  const p = (id: string, parent: string | null = null) => ({ id, parent_process_id: parent });

  it("makes the top-level processes the map's steps, with children under them to any depth", () => {
    const tree = companyMap([p("sales"), p("onboarding"), p("qualify", "sales"), p("check", "qualify"), p("report", "onboarding"), p("finance")]);
    expect(tree.map((n) => n.process.id)).toEqual(["sales", "onboarding", "finance"]);
    expect(tree.every((n) => n.depth === 1)).toBe(true);
    expect(tree[0]!.children[0]!.children[0]).toMatchObject({ process: { id: "check" }, depth: 3 });
    expect(flattenCompanyMap(tree).map((x) => `${x.depth}:${x.process.id}`)).toEqual(["1:sales", "2:qualify", "3:check", "1:onboarding", "2:report", "1:finance"]);
  });

  it("treats a process whose parent isn't listed as top level, and cuts a loop", () => {
    expect(companyMap([p("orphan", "gone")]).map((n) => n.process.id)).toEqual(["orphan"]);
    // Not possible in the database; the picker must still not hang.
    expect(flattenCompanyMap(companyMap([p("a", "b"), p("b", "a")]))).toEqual([]);
  });

  it("reads the picker's parentId too", () => {
    const tree = companyMap([{ id: "a", parentId: null }, { id: "b", parentId: "a" }]);
    expect(flattenCompanyMap(tree).map((x) => x.process.id)).toEqual(["a", "b"]);
  });
});

describe("rollUp", () => {
  it("counts working steps at any depth, adds their hands-on time and issues, and takes the worst rating", () => {
    const r = rollUp(steps, "Box", { issues: (id) => (id === "i1" ? 2 : id === "b2" ? 1 : 0), rating: (id) => ({ b1: 1, i2: 3, b2: 2 })[id] ?? null });
    expect(r).toEqual({ steps: 4, handsOnHours: 3 + 0.5 + 0.25 + 4, openIssues: 3, worstRating: 3 });
    expect(rollUp(steps, "Inner")).toEqual({ steps: 2, handsOnHours: 0.75, openIssues: 0, worstRating: null });
  });

  it("includes the steps of a child process held by a step", () => {
    const held = s("holder", { kind: "subprocess", parent_step_id: "Box", child_process_id: "child-1", work_hours: 0 });
    const childSteps = [s("c1", { work_hours: 5 }), s("c2", { work_hours: 6 })];
    const r = rollUp([...steps, held], "Box", { childLeaves: (pid) => (pid === "child-1" ? childSteps : []) });
    expect(r.steps).toBe(6);
    expect(r.handsOnHours).toBe(7.75 + 11);
    expect(leavesIn([...steps, held], "Box").map((x) => x.id)).toContain("holder");
  });
});
