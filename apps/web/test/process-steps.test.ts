import { describe, expect, it } from "vitest";
import { bundleForProcess, northbeamIssues, processesOf, type IssueRow } from "@transpera-flow/db";
import { entriesInProcess, registerEntries } from "../src/lib/issues/register";
import { processStepIds } from "../src/lib/process-steps";
import { demoBundle } from "../src/lib/sources/demo";

describe("a process page keeps to its own steps", () => {
  const pipeline = demoBundle();
  const servicing = processesOf(pipeline).find((p) => p.kind === "servicing")!;
  const servicingBundle = bundleForProcess(pipeline, servicing.id)!;

  it("the pipeline's steps do not include the servicing process's", () => {
    const ids = processStepIds(pipeline);
    expect(servicingBundle.steps.length).toBeGreaterThan(0);
    for (const s of servicingBundle.steps) expect(ids.has(s.id)).toBe(false);
  });

  it("a servicing process has its own steps", () => {
    const ids = processStepIds(servicingBundle);
    for (const s of servicingBundle.steps) expect(ids.has(s.id)).toBe(true);
  });

  it("leaves out detections and issues on another process's step", () => {
    const own = pipeline.steps.find((s) => s.kind === "task")!.id;
    const other = servicingBundle.steps.find((s) => s.kind === "task")!.id;
    const detection = (key: string, stepId: string | null) =>
      ({ key, title: key, evidence: "", type: "delay", rating: "bad", cost: null, stepId, personId: null }) as never;
    const tracked = northbeamIssues().filter((i): i is IssueRow => !!i.step_id);
    const entries = registerEntries(tracked, [detection("on-own", own), detection("on-other", other), detection("on-none", null)]);
    const kept = entriesInProcess(entries, pipeline.process.id, processStepIds(pipeline)).map((e) => (e.kind === "detected" ? e.detection.key : e.issue.id));
    expect(kept).toContain("on-own");
    expect(kept).toContain("on-none");
    expect(kept).not.toContain("on-other");
    for (const e of entriesInProcess(entries, pipeline.process.id, processStepIds(pipeline))) {
      const stepId = e.kind === "detected" ? e.detection.stepId : e.issue.step_id;
      if (stepId) expect(processStepIds(pipeline).has(stepId)).toBe(true);
    }
  });
});
