// Perception gaps as detected issues (issue #21, docs/PRD.md §4.1): sources
// that disagree by 2× or more on a step's value. They come from the steps'
// provenance, not from a run. The database logs each one as a tracked issue
// when the conflict is saved (migration 20261009000000_sources.sql); listing
// them as detections too shows them straight away (and on the demo, which has
// no database), and matches the stored row by its key.

import { perceptionGaps, type StepRow } from "@transpera-flow/db";
import { fixedRating, noCost } from "@transpera-flow/engine";
import type { DetectedIssue } from "@transpera-flow/engine";

export function perceptionGapDetections(steps: readonly StepRow[]): DetectedIssue[] {
  return perceptionGaps(steps).map((g) => {
    const values = g.values.map((v) => Number(v.value));
    return {
      key: g.key,
      type: "perception_gap",
      ...fixedRating("good"),
      cost: noCost("A data-quality finding: no money method."),
      title: g.title,
      evidence: g.evidence,
      metrics: { min: Math.min(...values), max: Math.max(...values), ...(Number.isFinite(g.ratio) ? { ratio: Math.round(g.ratio * 1000) / 1000 } : {}) },
      stepId: g.stepId,
      roleId: steps.find((s) => s.id === g.stepId)?.role_id ?? null,
      personId: null,
      fix: null,
    };
  });
}
