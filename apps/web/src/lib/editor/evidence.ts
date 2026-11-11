// Evidence edits for the process editor (issue #21). The rules live in
// @transpera-flow/db (evidence.ts); this turns their field patches into
// editor edits, so citing, confirming and settling save field by field and
// undo like any other change.

import {
  EVIDENCE_LABELS,
  citeEvidence,
  confirmParameter,
  removeEvidence,
  type EvidenceColumn,
  type EvidenceCitation,
  type EvidenceStamp,
  type ProcessBundle,
  type StepPatch,
} from "@transpera-flow/db";
import { updateStep } from "./commands";
import { readField, type Edit, type Patch } from "./ops";
import { provenanceFieldFor } from "./provenance";

/**
 * The edit a patch makes to a step. The patch sets the provenance of the
 * values it cites; the other columns it moves with them (a range's
 * distribution and params) keep theirs, instead of being stamped `entered`
 * as a person's own edit would be.
 */
export function stepPatchEdit(bundle: ProcessBundle, id: string, patch: StepPatch, label: string): Edit | null {
  const step = bundle.steps.find((s) => s.id === id);
  const edit = step ? updateStep(bundle, id, patch as Patch) : null;
  if (!step || !edit) return null;
  const ops = edit.ops.map((op) => {
    if (op.kind !== "update") return op;
    return {
      ...op,
      changes: op.changes.map((c) => {
        const before: Patch = { ...c.before };
        const after: Patch = { ...c.after };
        for (const field of Object.keys(c.after)) {
          const key = provenanceFieldFor(field);
          if (!key || key in after) continue;
          before[key] = readField(step, key);
          after[key] = before[key];
        }
        return { ...c, before, after };
      }),
    };
  });
  return { label, ops };
}

const stepName = (bundle: ProcessBundle, id: string) => bundle.steps.find((s) => s.id === id)?.name ?? "a step";

/** Cite a source for one of a step's values. */
export function citeEdit(bundle: ProcessBundle, id: string, column: EvidenceColumn, citation: EvidenceCitation, stamp: EvidenceStamp): Edit | null {
  const step = bundle.steps.find((s) => s.id === id);
  if (!step) return null;
  return stepPatchEdit(bundle, id, citeEvidence(step, column, citation, stamp), `Cited a source for ${stepName(bundle, id)}'s ${EVIDENCE_LABELS[column]}`);
}

/** Remove one citation of a step's value. */
export function removeCitationEdit(bundle: ProcessBundle, id: string, column: EvidenceColumn, index: number, stamp: EvidenceStamp): Edit | null {
  const step = bundle.steps.find((s) => s.id === id);
  if (!step) return null;
  return stepPatchEdit(bundle, id, removeEvidence(step, column, index, stamp), `Removed a citation from ${stepName(bundle, id)}`);
}

/** Confirm a value (or settle its conflict), optionally with a different value. */
export function confirmEdit(bundle: ProcessBundle, id: string, column: EvidenceColumn, stamp: EvidenceStamp, value?: number): Edit | null {
  const step = bundle.steps.find((s) => s.id === id);
  if (!step) return null;
  return stepPatchEdit(bundle, id, confirmParameter(step, column, stamp, value), `Confirmed ${stepName(bundle, id)}'s ${EVIDENCE_LABELS[column]}`);
}
