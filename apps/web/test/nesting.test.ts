import { describe, expect, it } from "vitest";
import { northbeamStepIds as ids, rollUp, toEngineModel, visibleEdges, visibleSteps, type ProcessBundle } from "@transpera-flow/db";
import { RATING_LABELS, ratingRank, simulate } from "@transpera-flow/engine";
import { stepRatingOf } from "@/lib/issues/register";
import { DEMO_GROUP_IDS, withDemoGroups } from "@/lib/demo/nested";
import { copySteps, deleteSteps, kindProblem, pasteSteps, stepWarnings } from "@/lib/editor/commands";
import { parseNewStep } from "@/lib/editor/validate";
import { diffBundles } from "@/lib/drafts/diff";
import { demoBundle } from "@/lib/sources/demo";
import { GROUP_CARD, groupIds, openGroupSize } from "@/lib/map/groups";

// Groups on the process map (issue #102): the demo's nested view simulates as
// the flat demo does, closed groups roll their steps up, and the editor's
// commands treat a group and the steps inside it as one.

const START = "2026-10-05";
const flat = () => demoBundle();
const nested = () => withDemoGroups(demoBundle());
const modelOf = (b: ProcessBundle) => toEngineModel(b, { startDate: START });
const none = new Set<string>();

describe("the demo's nested view", () => {
  it("is the same model as the flat demo, so the same numbers", () => {
    expect(modelOf(nested())).toEqual(modelOf(flat()));
    expect(simulate(modelOf(nested()), 4, 1)).toEqual(simulate(modelOf(flat()), 4, 1));
  });

  it("has two groups, with their steps placed inside the box", () => {
    const b = nested();
    expect(groupIds(b.steps).sort()).toEqual([DEMO_GROUP_IDS.conversation, DEMO_GROUP_IDS.setup].sort());
    const qualify = b.steps.find((s) => s.id === ids.qualify)!;
    expect(qualify.parent_step_id).toBe(DEMO_GROUP_IDS.conversation);
    // Relative to the group: its padding in from the box's corner.
    expect([Number(qualify.x), Number(qualify.y)]).toEqual([24, 56]);
  });

  it("shows closed groups as one step each, with the connections rolled up to them", () => {
    const b = nested();
    expect(visibleSteps(b.steps, none).map((s) => s.name)).toEqual(
      expect.arrayContaining(["Sales conversation", "Campaign set-up", "Audit & proposal", "Client decision"]),
    );
    expect(visibleSteps(b.steps, none).map((s) => s.id)).not.toContain(ids.qualify);
    const edges = visibleEdges(b.steps, b.edges, none);
    // Start leads into the closed group; discovery's two branches leave it to audit and lost.
    expect(edges.find((e) => e.from === ids.start)).toMatchObject({ to: DEMO_GROUP_IDS.conversation, rolled: false });
    expect(edges.filter((e) => e.from === DEMO_GROUP_IDS.conversation).map((e) => e.to).sort()).toEqual([ids.audit, ids.lost].sort());
    // Open, every step and connection is back, and nothing is rolled up.
    const open = visibleEdges(b.steps, b.edges, new Set(groupIds(b.steps)));
    expect(open.some((e) => e.rolled)).toBe(false);
    expect(open).toHaveLength(b.edges.length);
  });

  it("rolls a closed group up: its steps, their hands-on time and their open issues", () => {
    const b = nested();
    const conversation = rollUp(b.steps, DEMO_GROUP_IDS.conversation, { issues: (id) => (id === ids.discovery ? 2 : 0) });
    expect(conversation).toEqual({ steps: 2, handsOnHours: 0.5 + 1.5, openIssues: 2, worstRating: null });
    const setup = rollUp(b.steps, DEMO_GROUP_IDS.setup);
    expect(setup.steps).toBe(3);
    expect(setup.handsOnHours).toBe(10 + 8 + 2);
  });

  it("takes the worst rating of the open issues on the steps inside a closed group", () => {
    const b = nested();
    const rating = stepRatingOf({
      [ids.qualify]: { count: 1, rating: "bad", titles: ["a"] },
      [ids.discovery]: { count: 2, rating: "risk", titles: ["b", "c"] },
      [ids.audit]: { count: 1, rating: "risk", titles: ["outside"] },
    });
    const roll = rollUp(b.steps, DEMO_GROUP_IDS.conversation, { rating: (id) => rating(id)?.rank ?? null });
    expect(roll.worstRating).toBe(ratingRank("risk"));
    expect(rating(ids.discovery)).toEqual({ rank: ratingRank("risk"), label: RATING_LABELS.risk });
    // The set-up group has no issues, so it shows no rating.
    expect(rollUp(b.steps, DEMO_GROUP_IDS.setup, { rating: (id) => rating(id)?.rank ?? null }).worstRating).toBeNull();
    // Only a worse step changes the answer: bad alone reads bad.
    expect(rollUp(b.steps, DEMO_GROUP_IDS.conversation, { rating: (id) => (id === ids.qualify ? rating(id)!.rank : null) }).worstRating).toBe(ratingRank("bad"));
  });

  it("sizes an open group around its steps, and falls back to a card when closed", () => {
    const b = nested();
    const box = openGroupSize(b.steps, DEMO_GROUP_IDS.conversation, new Set([DEMO_GROUP_IDS.conversation]));
    expect(box.width).toBeGreaterThan(24 + 176);
    expect(box.height).toBeGreaterThanOrEqual(120);
    expect(GROUP_CARD.width).toBeGreaterThan(176);
  });
});

describe("editing a nested process", () => {
  it("deleting a group deletes the steps inside it and their connections, in one edit", () => {
    const b = nested();
    const edit = deleteSteps(b, [DEMO_GROUP_IDS.setup])!;
    const removed = edit.ops.flatMap((op) => (op.kind === "remove" ? op.steps.map((s) => s.id) : []));
    expect(removed.sort()).toEqual([DEMO_GROUP_IDS.setup, ids.seo, ids.ppc, ids.live].sort());
    const gone = edit.ops.flatMap((op) => (op.kind === "remove" ? op.edges : []));
    // Kickoff's two branches into the group's steps, and seo, ppc and go-live's edges out.
    expect(gone.length).toBeGreaterThanOrEqual(5);
  });

  it("doesn't flag a step inside a group for having nothing leave it, or a group that is left from inside", () => {
    const b = nested();
    // The groups have no connections of their own: they are left from the steps inside (discovery, go-live).
    expect(stepWarnings(b).has(DEMO_GROUP_IDS.conversation)).toBe(false);
    expect(stepWarnings(b).has(DEMO_GROUP_IDS.setup)).toBe(false);
    // Go-live loses its connection and nothing leaves the group either: both are flagged, as the engine could not simulate it.
    const edges = b.edges.filter((e) => e.from_step_id !== ids.live);
    const warned = stepWarnings({ ...b, edges });
    expect(warned.get(ids.live)).toMatch(/no group it is in has a connection out/);
    expect(warned.get(DEMO_GROUP_IDS.setup)).toMatch(/Nothing leaves this group/);
    // The same step outside any group is flagged itself.
    const plain = flat();
    expect(stepWarnings({ ...plain, edges: plain.edges.filter((e) => e.from_step_id !== ids.live) }).has(ids.live)).toBe(true);
  });

  it("copies a group with the steps inside it, into a group of its own", () => {
    const b = nested();
    const clip = copySteps(b, [DEMO_GROUP_IDS.setup])!;
    expect(clip.steps.map((s) => s.id).sort()).toEqual([DEMO_GROUP_IDS.setup, ids.seo, ids.ppc, ids.live].sort());
    const pasted = pasteSteps(b, clip, { x: 40, y: 40 })!;
    const rows = pasted.edit.ops.flatMap((op) => (op.kind === "insert" ? op.steps : []));
    const copy = rows.find((r) => r.kind === "group")!;
    expect(copy.id).not.toBe(DEMO_GROUP_IDS.setup);
    // The copies sit in the copy of the group, at the same place inside it, and the first step is the copy of the first.
    const inside = rows.filter((r) => r.kind !== "group");
    expect(inside.every((r) => r.parent_step_id === copy.id)).toBe(true);
    expect(copy.entry_step_id).toBe(inside.find((r) => r.name.startsWith("SEO"))!.id);
    const seo = b.steps.find((s) => s.id === ids.seo)!;
    expect([Number(inside.find((r) => r.name.startsWith("SEO"))!.x), Number(inside.find((r) => r.name.startsWith("SEO"))!.y)]).toEqual([Number(seo.x), Number(seo.y)]);
    // The group itself moves by the offset.
    const original = b.steps.find((s) => s.id === DEMO_GROUP_IDS.setup)!;
    expect(Number(copy.x)).toBe(Number(original.x) + 40);
  });

  it("copies a step alone into the group it was in", () => {
    const b = nested();
    const pasted = pasteSteps(b, copySteps(b, [ids.seo])!, { x: 40, y: 40 })!;
    const row = pasted.edit.ops.flatMap((op) => (op.kind === "insert" ? op.steps : []))[0]!;
    expect(row.parent_step_id).toBe(DEMO_GROUP_IDS.setup);
  });

  it("accepts a group, with its first step and the group it is in, as a step to restore (undo)", () => {
    const b = nested();
    const group = b.steps.find((s) => s.id === DEMO_GROUP_IDS.setup)!;
    expect(parseNewStep(group)).toMatchObject({ id: group.id, kind: "group", entry_step_id: ids.seo, parent_step_id: null });
    const inner = b.steps.find((s) => s.id === ids.seo)!;
    expect(parseNewStep(inner)).toMatchObject({ parent_step_id: DEMO_GROUP_IDS.setup });
  });

  it("shows a step moved into a group as a change in a draft", () => {
    const live = flat();
    const draft = nested();
    const changed = diffBundles(live, draft).steps.get(ids.seo)!;
    expect(changed.kind).toBe("changed");
    expect(changed.fields.map((f) => f.field)).toContain("parent_step_id");
  });

  it("won't turn a group that holds steps into a task", () => {
    const b = nested();
    expect(kindProblem(b, DEMO_GROUP_IDS.setup, "task")).toMatch(/holds steps/);
    expect(kindProblem(b, ids.seo, "wait")).toBeNull();
  });
});
