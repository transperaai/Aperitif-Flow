// Ranked constraints of a run (docs/PRD.md §6.4 "Bottleneck", §7.1
// `get_bottlenecks`; issue #26): roles and people by utilisation, steps by
// average queue, each with the numbers behind it and a templated sentence.
// The app's bottleneck panel and the MCP tool both read this, so they rank
// and word things the same way.
//
// Pure function of the model and one simulation result: no I/O, no clock,
// no randomness and no language model.

import type { EngineModel, SimulationResult, Stat } from "./model";

export interface RoleConstraint {
  kind: "role";
  id: string;
  name: string;
  util: Stat;
  /** Shares of capacity on pipeline and client work (ongoing load and servicing tasks; means). */
  pipeline: number;
  ongoing: number;
  /** Hours of work a week asked of the role (pipeline + ongoing, means). */
  hoursPerWeek: number;
  /** People in the role in this run. */
  people: number;
  /** The role's step with the longest average queue, if it has one. */
  queueStep: { id: string; name: string; avgQueue: number } | null;
  overThreshold: boolean;
  evidence: string;
}

export interface PersonConstraint {
  kind: "person";
  id: string;
  name: string;
  roles: string[];
  util: Stat;
  hoursPerWeek: number;
  overThreshold: boolean;
  evidence: string;
}

export interface StepConstraint {
  kind: "step";
  id: string;
  name: string;
  roleId: string | null;
  avgQueue: number;
  maxQueue: number;
  /** Average hours an item waits before someone starts it. */
  avgWaitHours: number;
  /** Queue growth, in items per week (near 0 for a stable queue). */
  queueGrowth: number;
  evidence: string;
}

export interface Bottlenecks {
  /** Most utilised first. */
  roles: RoleConstraint[];
  /** Most utilised first. */
  people: PersonConstraint[];
  /** Staffed steps with a queue, longest average queue first. */
  steps: StepConstraint[];
  /** The top bottleneck: the most utilised role (the run's `bnRole`). */
  top: RoleConstraint | null;
  threshold: number;
}

const LOCALE = "en-GB";
const num = (v: number, digits = 1) => v.toLocaleString(LOCALE, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
const pct = (share: number) => `${Math.round(share * 100)}%`;
const range = (s: Stat) => (pct(s.p10) === pct(s.p90) ? pct(s.p10) : `${Math.round(s.p10 * 100)}–${pct(s.p90)}`);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface BottleneckOptions {
  /** Utilisation above which a role or person counts as over the ceiling (default 0.85, §13). */
  threshold?: number;
  /** Keep at most this many of each kind (default all). */
  limit?: number;
}

/** Rank the constraints of `result`, which must come from simulating `model`. */
export function rankBottlenecks(model: EngineModel, result: SimulationResult, { threshold = 0.85, limit }: BottleneckOptions = {}): Bottlenecks {
  const hoursPerDay = model.hoursPerWeek / 5;
  const people = result.resolvedPeople;

  const roles: RoleConstraint[] = Object.keys(model.roles)
    .filter((id) => result.kpi.roles[id])
    .map((id) => {
      const r = result.roles[id]!;
      const util = result.kpi.roles[id]!.util;
      const members = Object.values(people).filter((p) => p.roles.includes(id)).length;
      let queueStep: RoleConstraint["queueStep"] = null;
      for (const s of model.steps) {
        const q = result.steps[s.id];
        if (s.role !== id || !q || q.avgQueue <= 0) continue;
        if (!queueStep || q.avgQueue > queueStep.avgQueue) queueStep = { id: s.id, name: s.name, avgQueue: q.avgQueue };
      }
      const hours = r.pipelineHours + r.ongoingHours + r.servicingHours;
      const name = model.roles[id]!.name;
      let evidence =
        `${name} is ${pct(util.mean)} utilised (range ${range(util)}): ${num(hours)} h/week of work across ` +
        `${members} ${members === 1 ? "person" : "people"}, ${pct(r.pipeline)} on the pipeline and ${pct(r.ongoing + r.servicing)} on client work.`;
      if (queueStep) evidence += ` Work queues longest at “${queueStep.name}” (avg ${num(queueStep.avgQueue)} items waiting).`;
      return {
        kind: "role" as const,
        id,
        name,
        util,
        pipeline: r.pipeline,
        ongoing: r.ongoing + r.servicing,
        hoursPerWeek: hours,
        people: members,
        queueStep,
        overThreshold: util.mean > threshold,
        evidence,
      };
    })
    .sort((a, b) => b.util.mean - a.util.mean || cmp(a.id, b.id));
  // The run's bottleneck role leads, whatever the tie-break above.
  const bn = roles.findIndex((r) => r.id === result.bnRole);
  if (bn > 0) roles.unshift(...roles.splice(bn, 1));

  const personList: PersonConstraint[] = Object.keys(people)
    .filter((id) => result.kpi.people[id])
    .map((id) => {
      const p = people[id]!;
      const util = result.kpi.people[id]!.util;
      const r = result.people[id]!;
      const hours = r.pipelineHours + r.ongoingHours + r.servicingHours;
      const roleNames = p.roles.map((rid) => model.roles[rid]?.name ?? rid);
      return {
        kind: "person" as const,
        id,
        name: p.name,
        roles: p.roles,
        util,
        hoursPerWeek: hours,
        overThreshold: util.mean > threshold,
        evidence: `${p.name} (${roleNames.join(", ")}) is ${pct(util.mean)} utilised (range ${range(util)}): ${num(hours)} h/week of work.`,
      };
    })
    .sort((a, b) => b.util.mean - a.util.mean || cmp(a.id, b.id));

  const steps: StepConstraint[] = model.steps
    .filter((s) => (s.role || s.person) && (result.steps[s.id]?.avgQueue ?? 0) > 0)
    .map((s) => {
      const q = result.steps[s.id]!;
      const growing = q.queueGrowth >= 0.5;
      return {
        kind: "step" as const,
        id: s.id,
        name: s.name,
        roleId: s.role,
        avgQueue: q.avgQueue,
        maxQueue: q.maxQueue,
        avgWaitHours: q.avgWait,
        queueGrowth: q.queueGrowth,
        evidence:
          `“${s.name}” has avg ${num(q.avgQueue)} items waiting (peak ${num(q.maxQueue)}); ` +
          `each waits avg ${num(q.avgWait / hoursPerDay)} working days before work starts` +
          (growing ? `, and the queue grows by ${num(q.queueGrowth)} items a week.` : "."),
      };
    })
    .sort((a, b) => b.avgQueue - a.avgQueue || cmp(a.id, b.id));

  const cut = <T>(list: T[]) => (limit === undefined ? list : list.slice(0, limit));
  return { roles: cut(roles), people: cut(personList), steps: cut(steps), top: roles[0] ?? null, threshold };
}
