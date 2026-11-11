// Nested models (issue #102): a step can hold its own steps, as a group or a
// child process (`EngineModel.groups`). The engine only ever simulates leaf
// steps, so every run starts by flattening: edges into a group go to its
// entry, leaving a group goes through its own edges, and the groups are dropped.
// A model with no groups comes back untouched (the same object), so flat
// models simulate exactly as before nesting existed.

import type { EngineEdge, EngineGroup, EngineModel, EngineStep } from "./model";

/** A nested model that can't be flattened: a loop of groups, or a group with no way in or out. */
export class NestingError extends Error {}

/** Whether the model holds any groups or steps inside them. */
export function isNested(model: EngineModel): boolean {
  return (model.groups !== undefined && Object.keys(model.groups).length > 0) || model.steps.some((s) => s.parent !== undefined);
}

/**
 * The same model with groups removed, so only leaf steps remain:
 *
 * - An edge into a group goes to the group's entry (and on, if that is a group).
 * - A step inside a group that has no `next` leaves through the group's `next`
 *   (or, if the group has none, its parent's). An edge to one of a group's
 *   `exits` does the same, its probability multiplied into each of the group's
 *   edges. A step outside every group with no `next` is left as it is.
 * - The model's entry, the services' and servicing processes' entries and
 *   hand-offs that point at a group point at its entry instead.
 *
 * Step ids, order and every number are kept, so a nested model and the same
 * model drawn flat give identical results.
 */
export function flattenModel(model: EngineModel): EngineModel {
  if (!isNested(model)) return model;
  const groups: Record<string, EngineGroup> = model.groups ?? {};

  // Containment must be a tree: every parent exists and no group sits inside itself.
  const checkChain = (name: string, parent: string | undefined) => {
    const seen = new Set<string>();
    for (let g = parent; g !== undefined; g = groups[g]?.parent) {
      if (!groups[g]) throw new NestingError(`${name} is inside a group that doesn't exist (${g})`);
      if (seen.has(g)) throw new NestingError(`${name} is inside a group that contains itself`);
      seen.add(g);
    }
  };
  for (const [id, g] of Object.entries(groups)) {
    if (g.parent === id) throw new NestingError(`Group '${g.name}' can't contain itself`);
    checkChain(`Group '${g.name}'`, g.parent);
  }
  for (const s of model.steps) checkChain(`Step '${s.name}'`, s.parent);

  /** Where an edge to `id` really goes: groups are entered at their entry. */
  const into = (id: string): string => {
    const seen = new Set<string>();
    let at = id;
    while (groups[at]) {
      if (seen.has(at)) throw new NestingError(`Group '${groups[at]!.name}' is entered through itself`);
      seen.add(at);
      at = groups[at]!.entry;
    }
    return at;
  };

  /** Edges from inside `scope` (a group, or the top level), with groups and exits resolved. */
  const resolve = (edges: EngineEdge[], scope: string | undefined): EngineEdge[] => {
    const out: EngineEdge[] = [];
    for (const e of edges) {
      let exited: string | undefined;
      for (let g = scope; g !== undefined; g = groups[g]!.parent) {
        if (groups[g]!.exits?.includes(e.to)) {
          exited = g;
          break;
        }
      }
      if (exited === undefined) {
        out.push({ ...e, to: into(e.to) });
        continue;
      }
      for (const n of leaving(exited)) {
        const tag = e.tag ?? n.tag;
        out.push({ to: n.to, p: e.p * n.p, ...(tag !== undefined ? { tag } : {}) });
      }
    }
    return out;
  };

  /** The edges that take an entity out of a group, as the parent graph's. */
  const leaving = (gid: string): EngineEdge[] => {
    const g = groups[gid]!;
    if (g.next.length) return resolve(g.next, g.parent);
    if (g.parent !== undefined) return leaving(g.parent);
    throw new NestingError(`Group '${g.name}' has nothing leaving it: give it a next step`);
  };

  const steps = model.steps.map((s): EngineStep => {
    const { parent, ...rest } = s;
    return { ...rest, next: s.next.length ? resolve(s.next, parent) : parent !== undefined ? leaving(parent) : s.next };
  });

  const exits = new Set(Object.values(groups).flatMap((g) => g.exits ?? []));
  const ends = model.ends
    ? Object.fromEntries(
        Object.entries(model.ends)
          .filter(([id]) => !exits.has(id))
          .map(([id, end]) => [id, end.handoff !== undefined ? { ...end, handoff: into(end.handoff) } : end]),
      )
    : undefined;
  const { groups: _groups, ends: _ends, ...rest } = model;
  return {
    ...rest,
    ...(model.services
      ? {
          services: Object.fromEntries(
            Object.entries(model.services).map(([id, sv]) => [id, sv.entry !== undefined ? { ...sv, entry: into(sv.entry) } : sv]),
          ),
        }
      : {}),
    ...(model.servicingProcesses
      ? {
          servicingProcesses: Object.fromEntries(
            Object.entries(model.servicingProcesses).map(([id, p]) => [id, { ...p, entry: into(p.entry) }]),
          ),
        }
      : {}),
    ...(ends && Object.keys(ends).length ? { ends } : {}),
    entry: into(model.entry),
    steps,
  };
}
