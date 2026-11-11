// Processes inside processes (issue #102): the structure of a process's steps
// when some of them hold others, as the map needs it. Pure: no I/O, no layout.
//
// A step is top level (`parent_step_id` null) or sits in a group; a group's
// steps may be groups themselves, to any depth. A step holding a child process
// is a leaf here: the child's steps are in its own revision. The engine never
// sees any of this (flattenModel drops it), so what is shown expanded or
// collapsed never changes a number.

import type { EdgeRow, StepRow } from "./types";

type Nested = Pick<StepRow, "id" | "kind" | "parent_step_id">;

/** Steps by parent: the key is a group's id, or null for the top level of the process. */
export function childrenOf<T extends Nested>(steps: readonly T[]): Map<string | null, T[]> {
  const out = new Map<string | null, T[]>();
  for (const s of steps) {
    const key = s.parent_step_id ?? null;
    const list = out.get(key);
    if (list) list.push(s);
    else out.set(key, [s]);
  }
  return out;
}

/** Whether the step is a group (a box of steps; a child process's holder is not). */
export const isGroup = (step: Pick<StepRow, "kind">): boolean => step.kind === "group";

/** The groups a step sits in, nearest first. Stops (rather than loops) on bad data. */
export function ancestorsOf(id: string, byId: ReadonlyMap<string, Nested>): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  for (let p = byId.get(id)?.parent_step_id ?? null; p !== null && !seen.has(p); p = byId.get(p)?.parent_step_id ?? null) {
    out.push(p);
    seen.add(p);
  }
  return out;
}

/** Which groups are open: `"all"`, or the ids listed. */
export type Expanded = ReadonlySet<string> | "all";

const isOpen = (expanded: Expanded, id: string) => expanded === "all" || expanded.has(id);

/**
 * The steps shown: every step whose groups are all open. A closed group is
 * shown as one step, its steps hidden.
 */
export function visibleSteps<T extends Nested>(steps: readonly T[], expanded: Expanded): T[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  return steps.filter((s) => ancestorsOf(s.id, byId).every((g) => byId.get(g)?.kind !== "group" || isOpen(expanded, g)));
}

/** The step standing for `id` on the map: itself, or the outermost closed group that holds it. */
export function visibleEndpoint(id: string, byId: ReadonlyMap<string, Nested>, expanded: Expanded): string {
  let shown = id;
  // Walking up, the last closed group met is the outermost: it hides everything below it.
  for (const g of ancestorsOf(id, byId)) if (!isOpen(expanded, g)) shown = g;
  return shown;
}

/** A connection as drawn: real ones keep their edge; those that cross a closed group's border are rolled up to it. */
export interface MapEdge {
  /** The edge's id, or for a rolled-up one the first of `edgeIds`. */
  id: string;
  edgeIds: string[];
  from: string;
  to: string;
  /** The share of the first edge; a rolled-up connection merges several, so it carries none. */
  probability: number | null;
  condition_tag: string | null;
  label: string | null;
  /** Drawn to or from a closed group in place of the steps inside it. */
  rolled: boolean;
}

/**
 * The connections shown. An edge with an end inside a closed group is drawn
 * to that group instead; edges between steps of one closed group are hidden;
 * edges that become the same connection are merged into one.
 */
export function visibleEdges(steps: readonly Nested[], edges: readonly EdgeRow[], expanded: Expanded): MapEdge[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const out: MapEdge[] = [];
  const merged = new Map<string, MapEdge>();
  for (const e of edges) {
    if (!byId.has(e.from_step_id) || !byId.has(e.to_step_id)) continue;
    const from = visibleEndpoint(e.from_step_id, byId, expanded);
    const to = visibleEndpoint(e.to_step_id, byId, expanded);
    if (from === to) continue;
    const rolled = from !== e.from_step_id || to !== e.to_step_id;
    if (!rolled) {
      out.push({ id: e.id, edgeIds: [e.id], from, to, probability: Number(e.probability), condition_tag: e.condition_tag, label: e.label, rolled: false });
      continue;
    }
    const key = `${from}\u0000${to}`;
    const m = merged.get(key);
    if (m) {
      m.edgeIds.push(e.id);
      m.probability = null;
      m.condition_tag = m.condition_tag === e.condition_tag ? m.condition_tag : null;
      m.label = null;
    } else {
      const made: MapEdge = { id: e.id, edgeIds: [e.id], from, to, probability: Number(e.probability), condition_tag: e.condition_tag, label: null, rolled: true };
      merged.set(key, made);
      out.push(made);
    }
  }
  return out;
}

/** Positions on the whole canvas: a step in a group is placed relative to the group, so add up the groups' own. */
export function absolutePositions(steps: readonly (Nested & Pick<StepRow, "x" | "y">)[]): Map<string, { x: number; y: number }> {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const out = new Map<string, { x: number; y: number }>();
  for (const s of steps) {
    let x = Number(s.x);
    let y = Number(s.y);
    for (const g of ancestorsOf(s.id, byId)) {
      x += Number(byId.get(g)!.x);
      y += Number(byId.get(g)!.y);
    }
    out.set(s.id, { x, y });
  }
  return out;
}

/**
 * Whether anything leaves a group: a connection from the group itself, or from
 * a step inside it (at any depth) to something outside it. A group with none is
 * a dead end the process can't get out of.
 */
export function groupHasExit(steps: readonly Nested[], edges: readonly Pick<EdgeRow, "from_step_id" | "to_step_id">[], groupId: string): boolean {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const within = (id: string) => id === groupId || ancestorsOf(id, byId).includes(groupId);
  return edges.some((e) => within(e.from_step_id) && !within(e.to_step_id));
}

/**
 * Whether a step with no connection of its own can still leave: it leaves through
 * the connections of the nearest group it is in that has any. False when none of
 * its groups has one, which the engine can't simulate.
 */
export function groupsLetOut(steps: readonly Nested[], edges: readonly Pick<EdgeRow, "from_step_id">[], stepId: string): boolean {
  const byId = new Map(steps.map((s) => [s.id, s]));
  return ancestorsOf(stepId, byId).some((g) => edges.some((e) => e.from_step_id === g));
}

/** The steps that do work inside a group, at any depth (child processes' steps through `childLeaves`). */
export function leavesIn<T extends Nested & Pick<StepRow, "child_process_id">>(
  steps: readonly T[],
  groupId: string,
  childLeaves?: (processId: string) => readonly T[],
): T[] {
  const kids = childrenOf(steps);
  const out: T[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const s of kids.get(id) ?? []) {
      if (s.kind === "group") walk(s.id);
      else if (s.kind === "start" || s.kind === "end") continue;
      else if (s.child_process_id && childLeaves) out.push(...childLeaves(s.child_process_id));
      else out.push(s);
    }
  };
  walk(groupId);
  return out;
}

/** What a closed group shows in place of its steps. */
export interface RollUp {
  /** Steps that do work inside it, at any depth. */
  steps: number;
  /** Their hands-on hours added up (the mean per item, not a share of anyone's week). */
  handsOnHours: number;
  /** Open issues on any of them. */
  openIssues: number;
  /** The worst of their ratings (the highest rank), or null when none is rated. */
  worstRating: number | null;
}

/**
 * The roll-up of a group: its working steps counted, their hands-on time
 * added up, their open issues counted and their worst rating. Ratings are
 * ranks where higher is worse; `rating` returns null for a step with none.
 */
export function rollUp<T extends Nested & Pick<StepRow, "child_process_id" | "work_hours">>(
  steps: readonly T[],
  groupId: string,
  opts: { childLeaves?: (processId: string) => readonly T[]; issues?: (stepId: string) => number; rating?: (stepId: string) => number | null } = {},
): RollUp {
  const leaves = leavesIn(steps, groupId, opts.childLeaves);
  let worst: number | null = null;
  for (const s of leaves) {
    const r = opts.rating?.(s.id) ?? null;
    if (r !== null && (worst === null || r > worst)) worst = r;
  }
  return {
    steps: leaves.length,
    handsOnHours: leaves.reduce((sum, s) => sum + Number(s.work_hours), 0),
    openIssues: leaves.reduce((sum, s) => sum + (opts.issues?.(s.id) ?? 0), 0),
    worstRating: worst,
  };
}

// ---------------------------------------------------------------------------
// The company map: the process tree
// ---------------------------------------------------------------------------

/** A process in the company map's tree. */
export interface ProcessNode<P> {
  process: P;
  /** 1 for a top-level process (a step of the company map), 2 for its children, and so on. */
  depth: number;
  children: ProcessNode<P>[];
}

type Parented = { id: string; parent_process_id?: string | null; parentId?: string | null };

const parentOfProcess = (p: Parented): string | null => p.parent_process_id ?? p.parentId ?? null;

/**
 * The company map as a tree: the map itself is the root and holds no row, its
 * steps are the processes with no parent, and each process holds its child
 * processes, to any depth. Order within a level is the order given. A process
 * whose parent isn't in the list (hidden, or deleted) counts as top level, and
 * a loop (the database refuses them) is cut at the process that closes it.
 */
export function companyMap<P extends Parented>(processes: readonly P[]): ProcessNode<P>[] {
  const ids = new Set(processes.map((p) => p.id));
  const kids = new Map<string | null, P[]>();
  for (const p of processes) {
    const parent = parentOfProcess(p);
    const key = parent !== null && ids.has(parent) && parent !== p.id ? parent : null;
    kids.set(key, [...(kids.get(key) ?? []), p]);
  }
  const build = (key: string | null, depth: number, seen: ReadonlySet<string>): ProcessNode<P>[] =>
    (kids.get(key) ?? []).filter((p) => !seen.has(p.id)).map((p) => ({ process: p, depth, children: build(p.id, depth + 1, new Set([...seen, p.id])) }));
  return build(null, 1, new Set());
}

/** The company map as one list, each process followed by its children (for a picker or an indented list). */
export function flattenCompanyMap<P extends Parented>(nodes: readonly ProcessNode<P>[]): { process: P; depth: number }[] {
  return nodes.flatMap((n) => [{ process: n.process, depth: n.depth }, ...flattenCompanyMap(n.children)]);
}
