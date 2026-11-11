import { describe, expect, it } from "vitest";
import { northbeamBundle, northbeamStepIds as ids, type ProcessBundle, type StepRow } from "@transpera-flow/db";
import { moveSteps, updateStep } from "@/lib/editor/commands";
import { ProcessEditor } from "@/lib/editor/editor";
import { applyEdit, invertEdit } from "@/lib/editor/ops";
import { provenanceSource, stampProvenance, stepProvenance, type Stamp } from "@/lib/editor/provenance";
import { MemoryStore } from "@/lib/editor/store";
import { parseFieldUpdate } from "@/lib/editor/validate";
import { formatInitialState } from "@/lib/format";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const stampAt =
  (by: string, at = "2026-09-29T10:00:00.000Z"): (() => Stamp) =>
  () => ({ at, by });
const step = (b: { steps: StepRow[] }, id: string) => b.steps.find((s) => s.id === id)!;

function setup(by = USER) {
  const bundle = northbeamBundle();
  const store = new MemoryStore(bundle);
  const editor = new ProcessEditor(bundle, store, stampAt(by));
  return { bundle, store, editor, now: () => editor.getState().bundle };
}

const setWip = (editor: ProcessEditor, id: string, wip: number | null) => editor.run((b: ProcessBundle) => updateStep(b, id, { current_wip: wip }));

describe("provenance of step parameters", () => {
  it("records an entered value in the same row change as the value, and its inverse restores both", () => {
    const b = northbeamBundle();
    const edit = stampProvenance(b, updateStep(b, ids.audit, { current_wip: 7 })!, { at: "2026-09-29T10:00:00.000Z", by: USER });
    const change = edit.ops[0]!.kind === "update" ? edit.ops[0]!.changes[0]! : null;
    expect(change).toEqual({
      table: "steps",
      id: ids.audit,
      before: { current_wip: null, "provenance.current_wip": null },
      after: { current_wip: 7, "provenance.current_wip": { source: "entered", at: "2026-09-29T10:00:00.000Z", by: USER } },
    });
    const after = applyEdit(b, edit);
    expect(provenanceSource(step(after, ids.audit), "current_wip")).toBe("entered");
    const undone = applyEdit(after, invertEdit(edit));
    expect(step(undone, ids.audit).current_wip).toBeNull();
    expect(stepProvenance(step(undone, ids.audit), "current_wip")).toBeNull();
  });

  it("stamps each parameter column once, jsonb params under their column, and leaves other edits alone", () => {
    const b = northbeamBundle();
    const range = stampProvenance(b, updateStep(b, ids.audit, { work_hours: 9, "work_params.cv": 0.5, "work_params.min": 1 })!, { at: "t", by: USER });
    const after = range.ops[0]!.kind === "update" ? range.ops[0]!.changes[0]!.after : {};
    expect(Object.keys(after).filter((f) => f.startsWith("provenance.")).sort()).toEqual(["provenance.work_hours", "provenance.work_params"]);

    const rename = updateStep(b, ids.audit, { name: "Audit" })!;
    expect(stampProvenance(b, rename, { at: "t", by: USER })).toBe(rename);
    const move = moveSteps(b, [{ id: ids.audit, x: 1, y: 2 }])!;
    expect(stampProvenance(b, move, { at: "t", by: USER })).toBe(move);
  });

  it("saves current WIP as entered, by whom and when; undo and redo move both together", async () => {
    const { editor, store, now } = setup();
    setWip(editor, ids.audit, 7);
    await editor.settled();
    const entry = { source: "entered", at: "2026-09-29T10:00:00.000Z", by: USER };
    expect(stepProvenance(step(store.snapshot(), ids.audit), "current_wip")).toEqual(entry);
    expect(stepProvenance(step(now(), ids.audit), "current_wip")).toEqual(entry);

    editor.undo();
    await editor.settled();
    expect(step(store.snapshot(), ids.audit).current_wip).toBeNull();
    expect(provenanceSource(step(store.snapshot(), ids.audit), "current_wip")).toBe("estimated");

    editor.redo();
    await editor.settled();
    expect(step(store.snapshot(), ids.audit).current_wip).toBe(7);
    expect(stepProvenance(step(store.snapshot(), ids.audit), "current_wip")).toEqual(entry);
    expect(editor.getState().conflicts).toEqual([]);
  });

  it("settles a clashing value's provenance with it: keep mine saves both, keep theirs takes both", async () => {
    const bundle = northbeamBundle();
    const store = new MemoryStore(bundle);
    const mine = new ProcessEditor(bundle, store, stampAt(USER, "2026-09-29T10:00:00.000Z"));
    const theirs = new ProcessEditor(bundle, store, stampAt(OTHER, "2026-09-29T09:00:00.000Z"));
    setWip(theirs, ids.audit, 3);
    await theirs.settled();
    setWip(mine, ids.audit, 7);
    await mine.settled();

    const conflicts = mine.getState().conflicts;
    expect(conflicts.map((c) => c.field).sort()).toEqual(["current_wip", "provenance.current_wip"]);
    const wip = conflicts.find((c) => c.field === "current_wip")!;

    await mine.keepMine(wip);
    expect(mine.getState().conflicts).toEqual([]);
    const saved = step(store.snapshot(), ids.audit);
    expect(saved.current_wip).toBe(7);
    expect(stepProvenance(saved, "current_wip")?.by).toBe(USER);

    // And the other way round: keep theirs adopts their value and their provenance.
    setWip(theirs, ids.audit, 5);
    await theirs.settled();
    const clash = theirs.getState().conflicts.find((c) => c.field === "current_wip")!;
    theirs.keepTheirs(clash);
    expect(theirs.getState().conflicts).toEqual([]);
    const shown = step(theirs.getState().bundle, ids.audit);
    expect(shown.current_wip).toBe(7);
    expect(stepProvenance(shown, "current_wip")?.by).toBe(USER);
  });

  it("takes the stored provenance without asking when both entered the same value", async () => {
    const bundle = northbeamBundle();
    const store = new MemoryStore(bundle);
    const a = new ProcessEditor(bundle, store, stampAt(OTHER, "2026-09-29T09:00:00.000Z"));
    const b = new ProcessEditor(bundle, store, stampAt(USER));
    setWip(a, ids.audit, 4);
    await a.settled();
    setWip(b, ids.audit, 4);
    await b.settled();
    expect(b.getState().conflicts).toEqual([]);
    expect(stepProvenance(step(b.getState().bundle, ids.audit), "current_wip")?.by).toBe(OTHER);
  });

  it("the save action accepts provenance entries and rejects malformed ones", () => {
    const entry = { source: "entered", at: "2026-09-29T10:00:00.000Z", by: USER };
    expect(
      parseFieldUpdate("steps", { current_wip: null, "provenance.current_wip": null }, { current_wip: 7, "provenance.current_wip": entry }),
    ).toEqual({ table: "steps", base: { current_wip: null, "provenance.current_wip": null }, changes: { current_wip: 7, "provenance.current_wip": entry } });
    const bad = [
      { source: "guessed", at: entry.at },
      { source: "entered", at: "yesterday" },
      { source: "entered", by: "someone" },
      "entered",
    ];
    for (const value of bad) expect(parseFieldUpdate("steps", { "provenance.current_wip": null }, { "provenance.current_wip": value })).toBeNull();
    // Only parameter columns carry provenance.
    expect(parseFieldUpdate("steps", { "provenance.name": null }, { "provenance.name": entry })).toBeNull();
  });
});

describe("how a run started", () => {
  it("says whether the run used entered WIP or a warm-up excluded from results", () => {
    expect(formatInitialState({ kind: "wip", items: 7 }, 40)).toBe("Started from entered WIP (7 items)");
    expect(formatInitialState({ kind: "wip", items: 1 }, 40)).toBe("Started from entered WIP (1 item)");
    expect(formatInitialState({ kind: "warmup", hours: 432 }, 40)).toBe("Started after a 10.8-week warm-up, excluded from results");
    expect(formatInitialState({ kind: "empty" }, 40)).toBe("Started empty (no WIP entered, no warm-up)");
  });
});
