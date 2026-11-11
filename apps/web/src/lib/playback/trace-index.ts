// Playback of a run (issue #14, docs/PRD.md §4.1 Simulation, §8.1): an index
// over replication 0's trace that answers "what does the process look like at
// time t?" cheaply for any t, so playing and scrubbing render the same frame.
// Framework-free: no React, no DOM.
//
// Trace semantics (packages/engine/src/model.ts `TraceSegment`): each visit of
// an entity to a step is queued at tQ, starts service at tS, ends service at
// tE, and leaves at tL after any external wait; null means "not by the
// horizon". The engine moves an entity from one step to the next instantly
// (the next visit's tQ is the previous visit's tL), so the drawn trip along an
// edge is a choice: a token leaves a step when its service ends and drifts
// along the edge it will take through the step's external wait (waiting on
// the client is being on the way to the next step), arriving when the wait
// ends. With no wait, the trip takes a short `hop` instead, which runs into
// the first moments at the next step. Counts always follow the trace exactly;
// only the drawn dot is on the edge meanwhile.

import type { Outcome, TraceEntity } from "@transpera-flow/engine";

/** The edges and terminals of the drawn map, which the trace refers to by step id. */
export interface PlaybackGraph {
  edges: { id: string; from: string; to: string }[];
  /** The start step: new arrivals travel from it to the entry step. */
  start: string | null;
  /** End step reached for each outcome (the engine's sinks). */
  ends: Partial<Record<Outcome, string>>;
}

export interface PlaybackRun {
  entities: TraceEntity[];
  /** Measured horizon in hours; playback runs over [0, H]. */
  H: number;
  /** True when the run started from entered WIP: items there at t = 0 were seeded, not arrivals. */
  seededWip: boolean;
}

/** Where an entity is at a time t. */
export type Location =
  | { kind: "moving"; edge: string; progress: number; to: string; outcome: Outcome | null }
  | { kind: "queued" | "service" | "waiting"; step: string; since: number };

/** Sorted entry and exit times of intervals [in, out) that sit at one step. */
interface Intervals {
  ins: Float64Array;
  outs: Float64Array;
}

/** Number of values ≤ t in a sorted array. */
export function countAtOrBefore(sorted: ArrayLike<number>, t: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function intervals(pairs: [number, number | null][]): Intervals {
  const ins = Float64Array.from(pairs.map(([a]) => a)).sort();
  const outs = Float64Array.from(pairs.flatMap(([, b]) => (b === null ? [] : [b]))).sort();
  return { ins, outs };
}

/** Intervals [in, out) containing t: every one that started by t minus every one that also ended by t. */
const openAt = (iv: Intervals | undefined, t: number) => (iv ? countAtOrBefore(iv.ins, t) - countAtOrBefore(iv.outs, t) : 0);

export interface FrameToken {
  entity: number;
  edge: string;
  /** Share of the edge's length travelled, in [0, 1). */
  progress: number;
  /** Heading to an end step with this outcome; null for a working step. */
  outcome: Outcome | null;
}

export interface StepCounts {
  queued: number;
  service: number;
  waiting: number;
}

export interface Frame {
  t: number;
  /** Tokens on an edge. */
  moving: FrameToken[];
  /** Entities queued at each step (and drawn there), oldest first. Excludes any still on their way in. */
  queued: Map<string, number[]>;
}

const BUCKETS = 256;

export class PlaybackIndex {
  readonly H: number;
  /** Longest hop the active-entity buckets allow for. */
  readonly maxHop: number;
  private readonly entities: TraceEntity[];
  private readonly seededWip: boolean;
  private readonly edgeByPair = new Map<string, string>();
  private readonly graph: PlaybackGraph;
  private readonly queue = new Map<string, Intervals>();
  private readonly service = new Map<string, Intervals>();
  private readonly wait = new Map<string, Intervals>();
  /** Sorted times entities reached each end step within the measured window. */
  private readonly ended = new Map<string, Float64Array>();
  /** Per bucket of [0, H]: indices of entities that may be on the map during it. */
  private readonly buckets: Int32Array[];
  private readonly bucketWidth: number;

  constructor(run: PlaybackRun, graph: PlaybackGraph, { maxHop = 0 }: { maxHop?: number } = {}) {
    this.H = run.H;
    this.maxHop = Math.max(0, maxHop);
    this.entities = run.entities;
    this.seededWip = run.seededWip;
    this.graph = graph;
    // The first edge wins when two connect the same steps (the editor doesn't allow that).
    for (const e of [...graph.edges].reverse()) this.edgeByPair.set(`${e.from}>${e.to}`, e.id);

    const q = new Map<string, [number, number | null][]>();
    const s = new Map<string, [number, number | null][]>();
    const w = new Map<string, [number, number | null][]>();
    const add = (m: Map<string, [number, number | null][]>, step: string, a: number, b: number | null) => {
      let list = m.get(step);
      if (!list) m.set(step, (list = []));
      list.push([a, b]);
    };
    const ends = new Map<string, number[]>();
    for (const e of run.entities) {
      for (const seg of e.trace) {
        // A visit is queued until it starts service, in service until it ends, then waiting until it leaves.
        add(q, seg.step, seg.tQ, seg.tS);
        if (seg.tS !== null) add(s, seg.step, seg.tS, seg.tE);
        if (seg.tE !== null) add(w, seg.step, seg.tE, seg.tL);
      }
      const end = e.outcome ? graph.ends[e.outcome] : undefined;
      if (end && e.done !== undefined && e.done >= 0) {
        let times = ends.get(end);
        if (!times) ends.set(end, (times = []));
        times.push(e.done);
      }
    }
    for (const [step, list] of q) this.queue.set(step, intervals(list));
    for (const [step, list] of s) this.service.set(step, intervals(list));
    for (const [step, list] of w) this.wait.set(step, intervals(list));
    for (const [step, times] of ends) this.ended.set(step, Float64Array.from(times).sort());

    // Buckets of entities by when they are on the map: from their first visit to the end of their last trip.
    this.bucketWidth = this.H > 0 ? this.H / BUCKETS : 1;
    const lists: number[][] = Array.from({ length: BUCKETS }, () => []);
    run.entities.forEach((e, i) => {
      const first = e.trace[0];
      if (!first) return;
      const from = Math.max(0, first.tQ);
      const to = e.done !== undefined ? e.done + this.maxHop : Infinity;
      if (to < 0 || from > this.H) return;
      const k0 = this.bucketOf(from);
      const k1 = to === Infinity ? BUCKETS - 1 : this.bucketOf(to);
      for (let k = k0; k <= k1; k++) lists[k]!.push(i);
    });
    this.buckets = lists.map((l) => Int32Array.from(l));
  }

  private bucketOf(t: number): number {
    return Math.min(BUCKETS - 1, Math.max(0, Math.floor(t / this.bucketWidth)));
  }

  /** The edge drawn from one step to another, if the map has one. */
  edgeBetween(from: string, to: string): string | null {
    return this.edgeByPair.get(`${from}>${to}`) ?? null;
  }

  /** Items waiting for someone to start them at a step at time t (the engine's queue length). */
  queuedAt(step: string, t: number): number {
    return openAt(this.queue.get(step), t);
  }

  /** Items being worked on at a step at time t. */
  inServiceAt(step: string, t: number): number {
    return openAt(this.service.get(step), t);
  }

  /** Items in a step's external wait (e.g. waiting on the client) at time t. */
  waitingAt(step: string, t: number): number {
    return openAt(this.wait.get(step), t);
  }

  counts(step: string, t: number): StepCounts {
    return { queued: this.queuedAt(step, t), service: this.inServiceAt(step, t), waiting: this.waitingAt(step, t) };
  }

  /** Entities that reached an end step during the measured window, by time t. */
  endedBy(endStep: string, t: number): number {
    const times = this.ended.get(endStep);
    return times ? countAtOrBefore(times, t) : 0;
  }

  /** Where an entity is at time t, or null when it isn't on the map (not arrived yet, or finished). */
  locate(entity: TraceEntity, t: number, hop: number): Location | null {
    const segs = entity.trace;
    if (!segs.length || t < segs[0]!.tQ) return null;
    // The latest visit that had begun by t.
    let lo = 0;
    let hi = segs.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (segs[mid]!.tQ <= t) lo = mid + 1;
      else hi = mid;
    }
    const i = lo - 1;
    const seg = segs[i]!;
    // On the way out: from the end of service through the external wait (at least a hop).
    if (seg.tE !== null && t >= seg.tE) {
      const trip = this.tripFrom(entity, i, hop);
      if (trip && t < trip.until) return { kind: "moving", edge: trip.edge, progress: (t - seg.tE) / (trip.until - seg.tE), to: trip.to, outcome: trip.outcome };
      // Arrived at an end step.
      if (seg.tL !== null && t >= seg.tL) return null;
      return { kind: "waiting", step: seg.step, since: seg.tE };
    }
    // Still finishing the trip in, when the last step had no wait long enough to cover it.
    if (i > 0) {
      const trip = this.tripFrom(entity, i - 1, hop);
      const left = segs[i - 1]!.tE!;
      if (trip && t < trip.until) return { kind: "moving", edge: trip.edge, progress: (t - left) / (trip.until - left), to: trip.to, outcome: null };
    } else {
      const from = this.arrivedFrom(entity);
      const edge = from ? this.edgeBetween(from, seg.step) : null;
      if (edge && t < seg.tQ + hop) return { kind: "moving", edge, progress: (t - seg.tQ) / hop, to: seg.step, outcome: null };
    }
    if (seg.tS === null || t < seg.tS) return { kind: "queued", step: seg.step, since: seg.tQ };
    return { kind: "service", step: seg.step, since: seg.tS };
  }

  /**
   * The trip out of visit i: along the edge to where the entity went next,
   * from the end of service until the later of leaving and a hop after
   * service. Null when it has no drawn edge (still there at the horizon, a
   * rework of the same step, or no edge on the map).
   */
  private tripFrom(entity: TraceEntity, i: number, hop: number): { edge: string; to: string; outcome: Outcome | null; until: number } | null {
    const seg = entity.trace[i]!;
    if (seg.tE === null || seg.tL === null) return null;
    const next = entity.trace[i + 1];
    const outcome = next ? null : (entity.outcome ?? null);
    const to = next ? next.step : outcome ? this.graph.ends[outcome] : undefined;
    // A rework visit to the same step has no edge to travel.
    if (!to || to === seg.step) return null;
    const edge = this.edgeBetween(seg.step, to);
    if (!edge) return null;
    return { edge, to, outcome, until: Math.max(seg.tL, seg.tE + hop) };
  }

  /** New arrivals come in from the start step; starting WIP was already there. */
  private arrivedFrom(entity: TraceEntity): string | null {
    if (this.seededWip && entity.t0 <= 0) return null;
    return this.graph.start;
  }

  /**
   * The frame at time t (clamped to [0, H]): tokens on edges (a trip with no
   * external wait takes `hop` hours, capped at `maxHop`), and who is queued
   * at each step. The same t and hop always give the same frame.
   */
  frame(time: number, hop: number): Frame {
    const t = Math.min(this.H, Math.max(0, time));
    const tr = Math.min(Math.max(0, hop), this.maxHop);
    const moving: FrameToken[] = [];
    const byStep = new Map<string, { id: number; since: number }[]>();
    for (const i of this.buckets[this.bucketOf(t)]!) {
      const e = this.entities[i]!;
      const at = this.locate(e, t, tr);
      if (!at) continue;
      if (at.kind === "moving") moving.push({ entity: e.id, edge: at.edge, progress: at.progress, outcome: at.outcome });
      else if (at.kind === "queued") {
        let list = byStep.get(at.step);
        if (!list) byStep.set(at.step, (list = []));
        list.push({ id: e.id, since: at.since });
      }
    }
    const queued = new Map<string, number[]>();
    for (const [step, list] of byStep) {
      list.sort((a, b) => a.since - b.since || a.id - b.id);
      queued.set(step, list.map((x) => x.id));
    }
    return { t, moving, queued };
  }
}
