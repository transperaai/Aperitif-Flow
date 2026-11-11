// The area of a process an issue touches, as the Editor's solution mode shows it (issue #114, A49): the issue's steps are
// outlined with their groups open, an "Issue area" panel lists them with the target, and the automatic verdict reads the
// target over them. Pure.

import type { IssueRow, StepRow } from "@transpera-flow/db";

/** What the Editor needs of an issue: small and serialisable, so a Server Component can hand it to the screen. */
export interface SolutionIssue {
  id: string;
  /** "Issue #12"'s number; null for an issue that has none. */
  number: number | null;
  title: string;
  /** The steps of the process being edited that the issue touches (stable ids; groups included). */
  stepIds: string[];
  /** The issue touches the whole process, not particular steps. */
  whole: boolean;
  /** What is measured, its value now and the goal: free text from the issue. */
  target: { measure: string | null; now: string | null; goal: string | null };
}

/** The process an issue is about: the first one it links, else its own. Null for an issue that names none. */
export function issueProcessId(issue: Pick<IssueRow, "links" | "process_id">): string | null {
  return issue.links.find((l) => l.process_id)?.process_id ?? issue.process_id;
}

/** Whether the issue is about the process: its own process, or one of its links. */
export const issueAboutProcess = (issue: Pick<IssueRow, "process_id" | "links">, processId: string): boolean =>
  issue.process_id === processId || issue.links.some((l) => l.process_id === processId);

/** An issue as the Editor shows it, for the map of process `processId` whose steps are `steps`. */
export function solutionIssueOf(issue: IssueRow, processId: string, steps: readonly Pick<StepRow, "id">[]): SolutionIssue {
  const here = new Set(steps.map((s) => s.id));
  const linked = issue.links.flatMap((l) => (l.step_id && (l.process_id === null || l.process_id === processId) ? [l.step_id] : []));
  const named = linked.length ? linked : issue.step_id ? [issue.step_id] : [];
  const stepIds = [...new Set(named)].filter((id) => here.has(id));
  return {
    id: issue.id,
    number: issue.number,
    title: issue.title,
    stepIds,
    whole: stepIds.length === 0,
    target: { measure: issue.target_measure, now: issue.target_now, goal: issue.target_goal },
  };
}

/** The steps that do the work inside `ids`: a group stands for the steps in it, at any depth. Start and end markers are left out. */
export function leafIds(steps: readonly Pick<StepRow, "id" | "kind" | "parent_step_id">[], ids: readonly string[]): string[] {
  const children = new Map<string, string[]>();
  for (const s of steps) if (s.parent_step_id) children.set(s.parent_step_id, [...(children.get(s.parent_step_id) ?? []), s.id]);
  const byId = new Map(steps.map((s) => [s.id, s]));
  const out = new Set<string>();
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const s = byId.get(id);
    if (!s) return;
    if (s.kind === "group") for (const c of children.get(id) ?? []) visit(c);
    else if (s.kind !== "start" && s.kind !== "end") out.add(id);
  };
  for (const id of ids) visit(id);
  return [...out];
}

/**
 * The steps that are the issue's area right now. They are the issue's own steps while they are in the map. When the solution
 * has taken one out (replaced it with a block, say), what the solution added stands in for it, so the outline and the verdict
 * follow the area to what now does that work.
 */
export function currentArea(
  issue: Pick<SolutionIssue, "stepIds" | "whole">,
  steps: readonly Pick<StepRow, "id">[],
  added: readonly string[],
): string[] {
  if (issue.whole) return [];
  const here = new Set(steps.map((s) => s.id));
  const present = issue.stepIds.filter((id) => here.has(id));
  return present.length === issue.stepIds.length ? present : [...new Set([...present, ...added.filter((id) => here.has(id))])];
}

/** The steps the verdict reads: the issue's area, or (an issue about the whole process) every working step. */
export function verdictArea(
  steps: readonly Pick<StepRow, "id" | "kind" | "parent_step_id">[],
  issue: Pick<SolutionIssue, "stepIds" | "whole">,
  added: readonly string[] = [],
): string[] {
  return leafIds(steps, issue.whole ? steps.filter((s) => s.parent_step_id === null).map((s) => s.id) : currentArea(issue, steps, added));
}
