// Highlighting the part of the map an insight or issue touches (issue #99): the
// steps it names are outlined, the rest dimmed. A step inside a closed group is
// shown by the group; groups that hold a highlighted step are opened so the step
// itself is on show. Pure.

import { visibleEndpoint, type Expanded, type StepRow } from "@transpera-flow/db";

type Row = Pick<StepRow, "id" | "kind" | "parent_step_id">;

/** The groups to open so every highlighted step is drawn: its ancestors. */
export function groupsToOpen(steps: readonly Row[], hl: readonly string[]): string[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const out = new Set<string>();
  for (const id of hl) {
    const seen = new Set<string>([id]);
    for (let p = byId.get(id)?.parent_step_id ?? null; p && !seen.has(p); p = byId.get(p)?.parent_step_id ?? null) {
      seen.add(p);
      if (byId.get(p)?.kind === "group") out.add(p);
    }
  }
  return [...out];
}

/** `expanded` with the groups a highlight needs open added. The same set when nothing is added. */
export function withHighlightOpen(steps: readonly Row[], expanded: ReadonlySet<string>, hl: readonly string[] | null | undefined): ReadonlySet<string> {
  if (!hl?.length) return expanded;
  const add = groupsToOpen(steps, hl).filter((g) => !expanded.has(g));
  return add.length ? new Set([...expanded, ...add]) : expanded;
}

/** The ids on the map that stand for the highlighted steps: each step itself, or the closed group hiding it. */
export function litIds(steps: readonly Row[], expanded: Expanded, hl: readonly string[] | null | undefined): Set<string> {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const out = new Set<string>();
  for (const id of hl ?? []) if (byId.has(id)) out.add(visibleEndpoint(id, byId, expanded));
  return out;
}
