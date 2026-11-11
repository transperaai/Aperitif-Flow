import { describe, expect, it } from "vitest";
import {
  applyStepPatch,
  badgeQuote,
  checklistItems,
  citationsBySource,
  citeEvidence,
  confirmParameter,
  conflictRange,
  gapRatio,
  northbeamBundle,
  northbeamSourceIds,
  northbeamStepIds,
  openConflict,
  perceptionGaps,
  removeEvidence,
  toEngineModel,
  type ProcessBundle,
  type StepRow,
} from "../src";

// Sources, evidence and conflicts (issue #21): the pure rules in evidence.ts.

const stamp = { at: "2026-09-30T09:00:00.000Z", by: "00000000-0000-4000-8000-00000000aaaa" };
const { strategyInterview: interview, salesNotes: notes } = northbeamSourceIds;
const rosa = (value: number) => ({ source_id: interview, speaker: "Rosa Diaz", quote: "More like twelve hours.", timestamp: "00:16:40", value });

const bundle = () => northbeamBundle();
const step = (b: ProcessBundle, key: keyof typeof northbeamStepIds) => b.steps.find((s) => s.id === northbeamStepIds[key])!;
const withStep = (b: ProcessBundle, s: StepRow): ProcessBundle => ({ ...b, steps: b.steps.map((x) => (x.id === s.id ? s : x)) });

describe("conflict ranges", () => {
  it("spans the stated values, most likely at the median", () => {
    expect(conflictRange([6, 12])).toEqual({ min: 6, mode: 9, max: 12 });
    expect(conflictRange([12, 4, 6])).toEqual({ min: 4, mode: 6, max: 12 });
  });

  it("measures the gap as largest over smallest", () => {
    expect(gapRatio([6, 12])).toBe(2);
    expect(gapRatio([0, 3])).toBe(Infinity);
    expect(gapRatio([5])).toBe(1);
  });
});

describe("citing evidence", () => {
  it("turns an estimated duration into a triangular range when sources disagree, flagged as a conflict", () => {
    const audit = step(bundle(), "audit");
    const patch = citeEvidence(audit, "work_hours", rosa(12), stamp);
    expect(patch).toMatchObject({
      work_dist: "triangular",
      "work_params.min": 6,
      "work_params.mode": 9,
      "work_params.max": 12,
      work_hours: 9,
      conflict: true,
    });
    const next = applyStepPatch(audit, patch);
    expect(openConflict(next, "work_hours")!.values).toEqual([
      { value: 6, source_id: interview, speaker: "Maya Collins" },
      { value: 12, source_id: interview, speaker: "Rosa Diaz" },
    ]);
    // The evidence keeps both quotes.
    expect(next.provenance.work_hours!.evidence).toHaveLength(2);
  });

  it("simulates the conflicted value as the triangular range (the engine samples it)", () => {
    const b = bundle();
    const next = applyStepPatch(step(b, "audit"), citeEvidence(step(b, "audit"), "work_hours", rosa(12), stamp));
    const model = toEngineModel(withStep(b, next));
    const audit = model.steps.find((s) => s.id === northbeamStepIds.audit)!;
    expect(audit.work).toBe(9);
    expect(audit.workDist).toEqual({ kind: "triangular", min: 6, mode: 9, max: 12 });
  });

  it("uses the most likely value for a conflicted estimate that has no distribution", () => {
    const audit = step(bundle(), "audit");
    const patch = citeEvidence(audit, "rework_rate", { source_id: interview, speaker: "Maya Collins", quote: "Hardly any, maybe one in twenty.", value: 0.05 }, stamp);
    expect(patch).toMatchObject({ rework_rate: 0.1, conflict: true });
  });

  it("never overwrites an entered value: it keeps it and flags the conflict", () => {
    const entered = { ...step(bundle(), "onboard"), provenance: { work_hours: { source: "entered" as const, at: stamp.at } } };
    const patch = citeEvidence(entered, "work_hours", { source_id: notes, speaker: "Leah Brooks", quote: "Onboarding is a full day.", value: 8 }, stamp);
    expect(patch).not.toHaveProperty("work_hours");
    expect(patch).not.toHaveProperty("work_dist");
    expect(patch.conflict).toBe(true);
    expect((patch["provenance.work_hours"] as { conflict: unknown }).conflict).toEqual({
      values: [
        { value: 3, source_id: null, speaker: null },
        { value: 8, source_id: notes, speaker: "Leah Brooks" },
      ],
    });
    // Evidence that agrees just corroborates it.
    const agrees = citeEvidence(entered, "work_hours", { source_id: notes, speaker: "Leah Brooks", quote: "Three hours.", value: 3 }, stamp);
    expect(agrees).toEqual({ "provenance.work_hours": { source: "entered", at: stamp.at, evidence: [{ source_id: notes, speaker: "Leah Brooks", quote: "Three hours.", value: 3 }] } });
  });

  it("makes an estimate with one stated value take it, as an assumption to confirm", () => {
    const kickoff = step(bundle(), "kickoff");
    const patch = citeEvidence(kickoff, "work_hours", { source_id: interview, speaker: "Maya Collins", quote: "Kickoffs are quicker, half a day.", value: 4 }, stamp);
    expect(patch).toEqual({
      "provenance.work_hours": {
        source: "estimated",
        at: stamp.at,
        by: stamp.by,
        evidence: [{ source_id: interview, speaker: "Maya Collins", quote: "Kickoffs are quicker, half a day.", value: 4 }],
        assumption: true,
      },
      assumption: true,
    });
    const said = citeEvidence(kickoff, "work_hours", { source_id: interview, speaker: "Maya Collins", quote: "Five hours.", value: 5 }, stamp);
    expect(said.work_hours).toBe(5);
  });

  it("keeps one value per speaker: someone correcting themselves is no conflict", () => {
    const audit = step(bundle(), "audit");
    const patch = citeEvidence(audit, "work_hours", { source_id: interview, speaker: "Maya Collins", quote: "Actually, seven.", value: 7 }, stamp);
    expect(patch.conflict).toBeUndefined();
    expect(patch.work_hours).toBe(7);
  });

  it("works the conflict out again when a citation is removed", () => {
    const audit = step(bundle(), "audit");
    const conflicted = applyStepPatch(audit, citeEvidence(audit, "work_hours", rosa(12), stamp));
    const patch = removeEvidence(conflicted, "work_hours", 1, stamp);
    expect(patch).toMatchObject({ work_hours: 6, work_dist: "lognormal", conflict: false });
    expect(openConflict(applyStepPatch(conflicted, patch), "work_hours")).toBeNull();
  });
});

describe("confirming", () => {
  it("flips provenance to entered and clears the assumption, keeping the evidence", () => {
    const kickoff = step(bundle(), "kickoff");
    const assumed = applyStepPatch(kickoff, citeEvidence(kickoff, "work_hours", { source_id: interview, speaker: "Maya Collins", quote: "Half a day.", value: 4 }, stamp));
    expect(assumed.assumption).toBe(true);
    const patch = confirmParameter(assumed, "work_hours", stamp);
    expect(patch).toEqual({
      "provenance.work_hours": {
        source: "entered",
        at: stamp.at,
        by: stamp.by,
        evidence: [{ source_id: interview, speaker: "Maya Collins", quote: "Half a day.", value: 4 }],
      },
      assumption: false,
    });
  });

  it("settles a conflict by keeping the range or choosing a value, recorded as resolved", () => {
    const audit = step(bundle(), "audit");
    const conflicted = applyStepPatch(audit, citeEvidence(audit, "work_hours", rosa(12), stamp));
    const range = confirmParameter(conflicted, "work_hours", stamp);
    expect(range).toMatchObject({ conflict: false, "provenance.work_hours": { source: "entered", conflict: { resolved: { choice: "range" } } } });
    expect(range).not.toHaveProperty("work_dist");
    const chosen = confirmParameter(conflicted, "work_hours", stamp, 12);
    expect(chosen).toMatchObject({ work_hours: 12, work_dist: "lognormal", conflict: false });
    const settled = applyStepPatch(conflicted, chosen);
    expect(openConflict(settled, "work_hours")).toBeNull();
    // Only something said after it was settled can reopen it.
    expect(citeEvidence(settled, "work_hours", { source_id: notes, speaker: "Priya Shah", quote: "Twelve hours.", value: 12 }, stamp).conflict).toBeUndefined();
    expect(citeEvidence(settled, "work_hours", { source_id: notes, speaker: "Priya Shah", quote: "Two days.", value: 16 }, stamp).conflict).toBe(true);
  });
});

describe("the checklist rail", () => {
  it("lists conflicts first, then every assumption, with value, reasoning and quote", () => {
    const b = bundle();
    const audit = applyStepPatch(step(b, "audit"), citeEvidence(step(b, "audit"), "work_hours", rosa(12), stamp));
    const kickoff = applyStepPatch(step(b, "kickoff"), {
      assumption: true,
      "provenance.work_hours": { source: "estimated", assumption: true, note: "Not in any source; assumed like onboarding." },
    });
    const qualify = { ...step(b, "qualify"), assumption: true };
    const items = checklistItems([qualify, kickoff, audit, step(b, "seo")]);
    expect(items.map((i) => [i.kind, i.stepName, i.column])).toEqual([
      ["conflict", "Audit & proposal", "work_hours"],
      ["assumption", "Kickoff & strategy", "work_hours"],
      ["assumption", "Qualify lead", null],
    ]);
    expect(items[0]!.values).toHaveLength(2);
    expect(items[0]!.evidence.map((e) => e.speaker)).toEqual(["Maya Collins", "Rosa Diaz"]);
    expect(items[1]).toMatchObject({ value: 4, reasoning: "Not in any source; assumed like onboarding." });
    expect(badgeQuote(audit)).toBe("“A proper audit and proposal is a day's work, call it six hours.” (Maya Collins) vs “More like twelve hours.” (Rosa Diaz)");
  });
});

describe("perception gaps", () => {
  it("are open conflicts 2× apart or more", () => {
    const audit = step(bundle(), "audit");
    const two = applyStepPatch(audit, citeEvidence(audit, "work_hours", rosa(12), stamp));
    expect(perceptionGaps([two]).map((g) => [g.key, g.title])).toEqual([
      [`perception_gap:step:${audit.id}.work_hours`, "Sources disagree on Audit & proposal: hands-on time"],
    ]);
    const under = applyStepPatch(audit, citeEvidence(audit, "work_hours", rosa(11), stamp));
    expect(perceptionGaps([under])).toEqual([]);
    const settled = applyStepPatch(two, confirmParameter(two, "work_hours", stamp));
    expect(perceptionGaps([settled])).toEqual([]);
  });
});

describe("retired steps (issue #16)", () => {
  it("are left out of the checklist, badges and perception gaps", () => {
    const audit = step(bundle(), "audit");
    const conflicted = applyStepPatch(audit, citeEvidence(audit, "work_hours", rosa(12), stamp));
    const retired = { ...conflicted, replaced_by: [northbeamStepIds.kickoff] };
    expect(checklistItems([retired])).toEqual([]);
    expect(perceptionGaps([retired])).toEqual([]);
    expect(badgeQuote(retired)).toBeNull();
  });
});

describe("the Sources page", () => {
  it("lists every value citing each source, once when live and draft cite the same words", () => {
    const b = bundle();
    const rows = (revision: "live" | "draft") => b.steps.map((s) => ({ table: "steps", id: s.id, name: s.name, processId: s.process_id, revision, provenance: s.provenance }));
    const by = citationsBySource([...rows("draft"), ...rows("live")]);
    expect(by.get(interview)!.map((c) => [c.rowName, c.column, c.speaker, c.revision])).toEqual([["Audit & proposal", "work_hours", "Maya Collins", "live"]]);
    expect(by.get(notes)!.map((c) => [c.rowName, c.column])).toEqual([
      ["Discovery call", "wait_hours"],
      ["Audit & proposal", "rework_rate"],
      ["Client decision", "wait_hours"],
    ]);
  });
});
