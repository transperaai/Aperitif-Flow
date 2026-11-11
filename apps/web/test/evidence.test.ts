import { describe, expect, it } from "vitest";
import {
  checklistItems,
  northbeamBundle,
  northbeamSourceIds,
  northbeamStepIds as ids,
  northbeamSources,
  openConflict,
  toEngineModel,
  type StepRow,
} from "@transpera-flow/db";
import { updateStep } from "@/lib/editor/commands";
import { ProcessEditor } from "@/lib/editor/editor";
import { citeEdit, confirmEdit, removeCitationEdit } from "@/lib/editor/evidence";
import { splitStep } from "@/lib/editor/split";
import { MemoryStore } from "@/lib/editor/store";
import { unresolvedSteps } from "@/lib/drafts/diff";
import { parseFieldUpdate } from "@/lib/editor/validate";
import { perceptionGapDetections } from "@/lib/issues/perception";
import { demoBundle, demoCitations } from "@/lib/sources/demo";
import { MemorySourceStore } from "@/lib/sources/store";
import { cleanSourceField, parseSourceInput, parseSpeakers } from "@/lib/sources/validate";

// Sources, evidence and conflicts in the app (issue #21).

const USER = "11111111-1111-4111-8111-111111111111";
const at = "2026-09-30T10:00:00.000Z";
const stamp = () => ({ at, by: USER });
const step = (b: { steps: StepRow[] }, id: string) => b.steps.find((s) => s.id === id)!;
const rosa = { source_id: northbeamSourceIds.strategyInterview, speaker: "Rosa Diaz", quote: "More like twelve hours.", timestamp: "00:16:40", value: 12 };

function setup() {
  const bundle = northbeamBundle();
  const store = new MemoryStore(bundle);
  const editor = new ProcessEditor(bundle, store, stamp);
  return { store, editor, now: () => editor.getState().bundle };
}

describe("citing and confirming through the editor", () => {
  it("saves a conflict as a triangular range, lists it first, and settles it with one undoable edit", async () => {
    const { store, editor, now } = setup();
    expect(editor.run((b) => citeEdit(b, ids.audit, "work_hours", rosa, stamp()))).toBe(true);
    await editor.settled();
    const saved = step(store.snapshot(), ids.audit);
    expect(saved).toMatchObject({ work_dist: "triangular", work_hours: 9, conflict: true });
    expect(saved.work_params).toMatchObject({ min: 6, mode: 9, max: 12 });
    // The range's distribution and params are not stamped as a person's entry.
    expect(saved.provenance.work_dist ?? null).toBeNull();
    expect(saved.provenance.work_params ?? null).toBeNull();
    expect(toEngineModel(now()).steps.find((s) => s.id === ids.audit)!.workDist).toEqual({ kind: "triangular", min: 6, mode: 9, max: 12 });
    expect(checklistItems(now().steps)[0]).toMatchObject({ kind: "conflict", stepId: ids.audit, column: "work_hours" });
    expect(perceptionGapDetections(now().steps).map((d) => d.key)).toEqual([`perception_gap:step:${ids.audit}.work_hours`]);

    editor.run((b) => confirmEdit(b, ids.audit, "work_hours", stamp(), 12));
    await editor.settled();
    const settled = step(store.snapshot(), ids.audit);
    expect(settled).toMatchObject({ work_hours: 12, work_dist: "lognormal", conflict: false });
    expect(settled.provenance.work_hours).toMatchObject({ source: "entered", by: USER, conflict: { resolved: { choice: "value" } } });
    expect(checklistItems(now().steps)).toEqual([]);

    editor.undo();
    await editor.settled();
    expect(step(store.snapshot(), ids.audit).conflict).toBe(true);
    expect(openConflict(step(store.snapshot(), ids.audit), "work_hours")).not.toBeNull();
  });

  it("keeps the evidence, and settles the conflict, when a person types a value", async () => {
    const { store, editor } = setup();
    editor.run((b) => citeEdit(b, ids.audit, "work_hours", rosa, stamp()));
    editor.run((b) => updateStep(b, ids.audit, { work_dist: "lognormal", work_hours: 8 }));
    await editor.settled();
    const saved = step(store.snapshot(), ids.audit);
    expect(saved.conflict).toBe(false);
    expect(saved.provenance.work_hours).toMatchObject({ source: "entered", evidence: [{ speaker: "Maya Collins" }, { speaker: "Rosa Diaz" }] });
    expect(openConflict(saved, "work_hours")).toBeNull();
  });

  it("removes a citation, working the conflict out again", async () => {
    const { store, editor } = setup();
    editor.run((b) => citeEdit(b, ids.audit, "work_hours", rosa, stamp()));
    editor.run((b) => removeCitationEdit(b, ids.audit, "work_hours", 1, stamp()));
    await editor.settled();
    expect(step(store.snapshot(), ids.audit)).toMatchObject({ work_hours: 6, conflict: false });
  });

  it("splitting a step with a hands-on conflict leaves no stray conflict flag on the halves or the retired row (issue #16)", async () => {
    const { store, editor, now } = setup();
    editor.run((b) => citeEdit(b, ids.audit, "work_hours", rosa, stamp()));
    expect(editor.run((b) => splitStep(b, ids.audit)?.edit ?? null)).toBe(true);
    await editor.settled();
    expect(now().steps.filter((s) => s.conflict)).toEqual([]);
    expect(unresolvedSteps(now())).toEqual([]);
    expect(checklistItems(now().steps)).toEqual([]);
    expect(perceptionGapDetections([...now().steps, ...(now().retired ?? [])])).toEqual([]);
    expect(step(store.snapshot(), ids.audit)).toMatchObject({ replaced_by: expect.any(Array), conflict: false });
  });

  it("lets the server actions save the conflict flag and evidence provenance", () => {
    const entry = { source: "estimated", evidence: [rosa], conflict: { values: [{ value: 6, source_id: null, speaker: null }, { value: 12, source_id: rosa.source_id, speaker: "Rosa Diaz" }] } };
    expect(parseFieldUpdate("steps", { conflict: false, "provenance.work_hours": null }, { conflict: true, "provenance.work_hours": entry })).not.toBeNull();
    expect(parseFieldUpdate("steps", { conflict: false }, { conflict: "yes" })).toBeNull();
  });
});

describe("the demo", () => {
  it("has a conflict 2× apart on audits and an assumption on kickoffs, and lists what cites each source", () => {
    const b = demoBundle();
    expect(checklistItems(b.steps).map((i) => [i.kind, i.stepName, i.column])).toEqual([
      ["conflict", "Audit & proposal", "work_hours"],
      ["assumption", "Kickoff & strategy", "work_hours"],
    ]);
    const cites = demoCitations(b);
    expect(cites[northbeamSourceIds.strategyInterview]!.map((c) => [c.rowName, c.speaker])).toEqual([
      ["Audit & proposal", "Maya Collins"],
      ["Audit & proposal", "Rosa Diaz"],
      ["Kickoff & strategy", "Maya Collins"],
    ]);
    expect(toEngineModel(b)).toBeTruthy();
  });
});

describe("sources", () => {
  it("checks new sources and their fields", () => {
    expect(parseSpeakers(" Maya Collins, Rosa Diaz;Maya Collins\n")).toEqual(["Maya Collins", "Rosa Diaz"]);
    expect(parseSourceInput({ title: "Call", speakers: ["A"], recorded_at: "2026-09-01", body: null, file_url: null })).toEqual({
      ok: true,
      value: { kind: "transcript", title: "Call", speakers: ["A"], recorded_at: "2026-09-01", body: null, file_url: null },
    });
    expect(parseSourceInput({ title: " " }).ok).toBe(false);
    expect(parseSourceInput({ title: "Shot", kind: "screenshot", file_url: "javascript:alert(1)" }).ok).toBe(false);
    expect(cleanSourceField("recorded_at", "")).toEqual({ value: null });
    expect(cleanSourceField("kind", "video")).toBeNull();
  });

  it("keeps sources in memory on the demo, with compare-and-set edits", async () => {
    const [first] = northbeamSources();
    const store = new MemorySourceStore(first!.workspace_id, [first!], () => at);
    const added = await store.create({ kind: "notes", title: "Ops call", speakers: ["Rosa Diaz"], recorded_at: null, body: null, file_url: null }, [
      { kind: "insight", insightKey: "spof:step:abc" },
    ]);
    expect(added.status).toBe("ok");
    expect(await store.saveField(first!.id, "speakers", "Maya Collins, Rosa Diaz", "Maya Collins")).toEqual({ status: "saved", value: "Maya Collins" });
    expect(await store.saveField(first!.id, "title", "Old", "New")).toEqual({ status: "conflict", theirs: "Strategy walkthrough" });
    expect(await store.remove(first!.id)).toEqual({ status: "ok" });
    expect(await store.saveField(first!.id, "title", "Strategy walkthrough", "New")).toEqual({ status: "not_found" });
  });
});
