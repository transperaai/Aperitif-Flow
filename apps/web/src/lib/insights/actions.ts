// What a person can do with an insight (issue #110, #112): acknowledge it into a tracked issue, or dismiss it. Both go
// through the issue store the page already has. `acknowledgeInsight` is the one place the Acknowledge dialog calls to
// save: the dialog (components/acknowledge-dialog.tsx) edits a draft prefilled from the insight and hands it here.

import type { IssueRow, ScenarioRow } from "@transpera-flow/db";
import { draftFromInsight, toSaveInput, type IssueDraft, type IssueFormOptions } from "@/lib/issues/draft";
import { promoteInput } from "@/lib/issues/register";
import type { IssuesState } from "@/lib/issues/use-issues";
import type { Insight } from "./insights";

export interface InsightContext {
  /** The process the issue is logged against when the insight's step doesn't say (the page's own process). */
  processId: string | null;
  /** The process a step belongs to, when the page shows several (the Overview). */
  processOfStep?: (stepId: string) => string | null | undefined;
  scenarios: readonly ScenarioRow[];
  /** What the Acknowledge dialog offers: steps, people and sources. Without it an acknowledged insight saves as found. */
  options?: Pick<IssueFormOptions, "steps">;
}

/**
 * The process an insight is about: the one its step belongs to (a step of a process inside the page's process is in
 * that one), else the page's own. A dismissal is measured against that process's versions, not the page's.
 */
export const processFor = (i: Insight, ctx: InsightContext): string | null => {
  const step = i.stepIds[0];
  if (!step) return ctx.processId;
  return ctx.options?.steps.find((s) => s.id === step)?.processId ?? ctx.processOfStep?.(step) ?? ctx.processId;
};

/** The draft the Acknowledge dialog opens with for an insight: its rating, steps and sources. */
export function acknowledgeDraft(insight: Insight, ctx: InsightContext): IssueDraft {
  const processId = processFor(insight, ctx);
  const scenarioId = promoteInput(insight.detection, processId, ctx.scenarios).scenario_id;
  const draft = draftFromInsight(insight, processId, ctx.options ?? { steps: [] }, scenarioId);
  // An insight whose earlier dismissal has expired still has its row: acknowledging turns that row into the issue.
  return insight.dismissed ? { ...draft, id: insight.dismissed.id } : draft;
}

/**
 * Turn an insight into a tracked issue, saved with what the person put in the dialog (`draft`); with no draft it is
 * saved as found, which is what the dialog starts from. An insight dismissed earlier, whose dismissal has expired, is
 * acknowledged by reopening its row.
 */
export function acknowledgeInsight(
  state: Pick<IssuesState, "save">,
  insight: Insight,
  ctx: InsightContext,
  draft: IssueDraft = acknowledgeDraft(insight, ctx),
): Promise<IssueRow | null> {
  const input = toSaveInput(draft, ctx.options ?? { steps: [] });
  return state.save(draft.id && insight.dismissed ? { ...input, status: "open" } : input);
}

/**
 * Dismiss an insight: it is tracked as dismissed in a single write, so it stays off the list and the map. It stays
 * gone until its process is published again (the revision it was dismissed against is stored with it); if the
 * analysis still finds it then, it is listed again, and dismissing it again moves that revision on.
 */
export async function dismissInsight(
  state: Pick<IssuesState, "promote" | "redismiss" | "revisionOf">,
  insight: Insight,
  ctx: InsightContext,
): Promise<boolean> {
  const processId = processFor(insight, ctx);
  const revision = state.revisionOf(processId) ?? null;
  // An expired dismissal still has its row (the key is unique): move it to the current revision.
  if (insight.dismissed) return (await state.redismiss(insight.dismissed.id, revision)) !== null;
  // One write, already dismissed: a failed save leaves nothing behind, and nothing is ever open (so never on the map).
  return (await state.promote({ ...promoteInput(insight.detection, processId, ctx.scenarios), status: "dismissed", dismissed_revision_id: revision })) !== null;
}
