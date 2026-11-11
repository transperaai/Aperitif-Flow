// What a source is evidence for (issue #118, A53; migration 20261124500000_source_links.sql).
//
// Every source must be linked to at least one process, step, insight, issue or solution, and can have several links.
// The table keeps one column per kind and a check that sets exactly the right ones; here a link is a tagged union
// (`SourceLinkTarget`) so the app can't build a half-filled one. Pure functions: no I/O and no clock.

import type { SourceLinkKind, SourceLinkRow, SourceRow } from "./types";

export const SOURCE_LINK_KINDS = ["process", "step", "insight", "issue", "solution"] as const satisfies readonly SourceLinkKind[];

/** What a source is linked to. A step is a stable step id and the process it is in; an insight is its detection key. */
export type SourceLinkTarget =
  | { kind: "process"; processId: string }
  | { kind: "step"; processId: string; stepId: string }
  | { kind: "insight"; insightKey: string }
  | { kind: "issue"; issueId: string }
  | { kind: "solution"; solutionId: string };

/** The columns a link row carries for a target (every target column, the unused ones null). */
export type SourceLinkColumns = Pick<SourceLinkRow, "kind" | "process_id" | "step_id" | "insight_key" | "issue_id" | "solution_id">;

/** A link's columns, as `add_source` and an insert into `source_links` take them. */
export function linkColumns(target: SourceLinkTarget): SourceLinkColumns {
  const none = { process_id: null, step_id: null, insight_key: null, issue_id: null, solution_id: null };
  switch (target.kind) {
    case "process":
      return { ...none, kind: "process", process_id: target.processId };
    case "step":
      return { ...none, kind: "step", process_id: target.processId, step_id: target.stepId };
    case "insight":
      return { ...none, kind: "insight", insight_key: target.insightKey };
    case "issue":
      return { ...none, kind: "issue", issue_id: target.issueId };
    case "solution":
      return { ...none, kind: "solution", solution_id: target.solutionId };
  }
}

/** The target a link row names, or null for a row that does not have the columns its kind needs. */
export function linkTarget(row: Pick<SourceLinkRow, "kind" | "process_id" | "step_id" | "insight_key" | "issue_id" | "solution_id">): SourceLinkTarget | null {
  switch (row.kind) {
    case "process":
      return row.process_id ? { kind: "process", processId: row.process_id } : null;
    case "step":
      return row.process_id && row.step_id ? { kind: "step", processId: row.process_id, stepId: row.step_id } : null;
    case "insight":
      return row.insight_key ? { kind: "insight", insightKey: row.insight_key } : null;
    case "issue":
      return row.issue_id ? { kind: "issue", issueId: row.issue_id } : null;
    case "solution":
      return row.solution_id ? { kind: "solution", solutionId: row.solution_id } : null;
  }
}

/** Whether two targets are the same thing (a source can be linked to a target only once). */
export function sameTarget(a: SourceLinkTarget, b: SourceLinkTarget): boolean {
  const x = linkColumns(a);
  const y = linkColumns(b);
  return x.kind === y.kind && x.process_id === y.process_id && x.step_id === y.step_id && x.insight_key === y.insight_key && x.issue_id === y.issue_id && x.solution_id === y.solution_id;
}

/** Links grouped by source id, in the order given. */
export function linksBySource(links: readonly SourceLinkRow[]): Map<string, SourceLinkRow[]> {
  const out = new Map<string, SourceLinkRow[]>();
  for (const l of links) out.set(l.source_id, [...(out.get(l.source_id) ?? []), l]);
  return out;
}

/** The sources that are linked to nothing: they don't count as evidence until someone links them. */
export function unlinkedSources<S extends Pick<SourceRow, "id">>(sources: readonly S[], links: readonly Pick<SourceLinkRow, "source_id">[]): S[] {
  const linked = new Set(links.map((l) => l.source_id));
  return sources.filter((s) => !linked.has(s.id));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The link rows without their generated columns (`id`, `created_at`, `created_by`). */
export type NewSourceLink = SourceLinkColumns & Pick<SourceLinkRow, "workspace_id" | "source_id">;

/**
 * The links today's citations give: a step link for every source a step's values cite (once per source and step, from any
 * revision), and an issue link for every source an issue lists. Citations of a source that isn't in the same workspace are
 * skipped. This is what the migration copies; the seed uses it so a fresh database starts as a migrated one does.
 */
export function derivedSourceLinks(
  steps: readonly { id: string; workspace_id: string; process_id: string; provenance: unknown }[],
  issues: readonly { id: string; workspace_id: string; source_ids: readonly string[] }[],
  sources: readonly Pick<SourceRow, "id" | "workspace_id">[],
): NewSourceLink[] {
  const exists = new Set(sources.map((s) => `${s.workspace_id}:${s.id}`));
  const out = new Map<string, NewSourceLink>();
  const add = (row: NewSourceLink) => {
    const key = [row.source_id, row.kind, row.process_id, row.step_id, row.issue_id].join("|");
    if (!out.has(key) && exists.has(`${row.workspace_id}:${row.source_id}`)) out.set(key, row);
  };
  for (const st of steps) {
    if (!isObject(st.provenance)) continue;
    for (const entry of Object.values(st.provenance)) {
      const evidence = isObject(entry) && Array.isArray(entry.evidence) ? entry.evidence : [];
      for (const ev of evidence) {
        if (!isObject(ev) || typeof ev.source_id !== "string" || !UUID.test(ev.source_id)) continue;
        add({ workspace_id: st.workspace_id, source_id: ev.source_id.toLowerCase(), ...linkColumns({ kind: "step", processId: st.process_id, stepId: st.id }) });
      }
    }
  }
  for (const i of issues) for (const source_id of i.source_ids) add({ workspace_id: i.workspace_id, source_id, ...linkColumns({ kind: "issue", issueId: i.id }) });
  return [...out.values()];
}

/**
 * What a source can be linked to, for the pickers: the workspace's processes, the steps in their current versions (a
 * stable id, once), the insights it has acted on (a detection's key and title), its issues and its solutions.
 */
export interface LinkTargets {
  processes: { id: string; name: string }[];
  steps: { id: string; processId: string; name: string }[];
  insights: { key: string; title: string }[];
  issues: { id: string; number: number | null; title: string }[];
  solutions: { id: string; name: string }[];
  /** Linked steps that are in no current version (an earlier version, or one removed since), by their latest name: so a chip can say so. */
  olderSteps?: { id: string; name: string }[];
}

export const NO_LINK_TARGETS: LinkTargets = { processes: [], steps: [], insights: [], issues: [], solutions: [] };
