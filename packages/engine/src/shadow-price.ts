// Shadow price of the bottleneck (docs/PRD.md §6.4 "Bottleneck", §13; issue #26).
//
// Definition (PRD §13): the additional completed units per quarter from adding
// one FTE to the bottleneck role, computed by an automatic extra run. Made
// precise here:
//
// - **Completed units** are entities that reach a `won` or `done` end in the
//   measured window (lost ones are not completions). For a sales pipeline
//   that is wins; for a delivery or servicing process, finished items.
// - **One FTE** is the scenario patch `roles.<role>.headcount add 1`: one more
//   full-time person (the workspace's hours per week) in the role, able to do
//   every step of it (scenario.ts `setHeadcount`), or one more anonymous
//   person when the model has no named people.
// - **The extra run** is a second replication set on the patched model with
//   the baseline's seed and replication count. Replication i of both sides
//   draws the same random streams (common random numbers, docs/PRD.md §6.1),
//   so the change is measured replication by replication:
//   Δᵢ = completionsᵢ(+1 FTE) − completionsᵢ(baseline).
// - **Per quarter** scales the horizon's figures by 13 / horizon weeks.
//
// The shadow price is the mean of the Δᵢ per quarter, with the 10th–90th
// percentile of the Δᵢ as its range. It is the marginal value of capacity at
// the constraint: large when the role really limits throughput, near zero
// when it doesn't (demand, not capacity, is the limit).
//
// Pure and deterministic like the rest of the engine; `timeBudgetMs` lets a
// server caller cap it, in which case fewer replication pairs run and the
// result says `complete: false`.

import type { EngineModel, ReplicationResult, Stat } from "./model";
import type { ScenarioPatch } from "./scenario";
import { applyPatches } from "./scenario";
import { initialState, runOnce, SEED_STRIDE, stat } from "./simulate";

export const WEEKS_PER_QUARTER = 13;

/** Completed units in one replication: entities reaching a `won` or `done` end. */
export const completions = (r: ReplicationResult) => r.won + r.done;

export interface ShadowPrice {
  roleId: string;
  /** The patch the extra run applies. */
  patch: ScenarioPatch[];
  /** Extra completed units per quarter: the mean of the paired differences and their 10th–90th percentile. */
  perQuarter: Stat;
  /** Completed units per quarter without and with the extra FTE. */
  baselinePerQuarter: Stat;
  withFtePerQuarter: Stat;
  /** Replication pairs that ran; fewer than `requestedReps` when the time budget ran out. */
  reps: number;
  requestedReps: number;
  seed: number;
  complete: boolean;
}

export interface ShadowPriceOptions {
  /** Replications per side (default 30, the app's baseline). */
  reps?: number;
  /** Seed of replication 0 (default 1, the app's baseline). */
  seed?: number;
  /** Stop starting replication pairs after this many milliseconds (at least one pair always runs). */
  timeBudgetMs?: number;
  /** What to count: `completions` (won or done, the default) or `wins` only (the cost per month counts wins, cost.ts). */
  count?: "completions" | "wins";
  /** Clock, for tests. */
  now?: () => number;
}

/** The shadow price of `roleId` in `model`; null when the model has no such role. */
export function shadowPrice(
  model: EngineModel,
  roleId: string,
  { reps = 30, seed = 1, timeBudgetMs, count = "completions", now = () => performance.now() }: ShadowPriceOptions = {},
): ShadowPrice | null {
  if (!model.roles[roleId]) return null;
  const patch: ScenarioPatch[] = [{ path: `roles.${roleId}.headcount`, op: "add", value: 1 }];
  const plus = applyPatches(model, patch).model;
  const counted = (r: ReplicationResult) => (count === "wins" ? r.won : completions(r));
  const deadline = timeBudgetMs === undefined ? Infinity : now() + timeBudgetMs;
  const startA = initialState(model);
  const startB = initialState(plus);
  const a: number[] = [];
  const b: number[] = [];
  for (let i = 0; i < reps; i++) {
    if (i > 0 && now() >= deadline) break;
    const s = seed + i * SEED_STRIDE;
    a.push(counted(runOnce(model, s, false, startA)));
    b.push(counted(runOnce(plus, s, false, startB)));
  }
  const k = WEEKS_PER_QUARTER / model.horizonWeeks;
  const scaled = (x: number[]) => x.map((v) => v * k);
  return {
    roleId,
    patch,
    perQuarter: stat(scaled(b.map((v, i) => v - a[i]!))),
    baselinePerQuarter: stat(scaled(a)),
    withFtePerQuarter: stat(scaled(b)),
    reps: a.length,
    requestedReps: reps,
    seed,
    complete: a.length === reps,
  };
}

const LOCALE = "en-GB";
const MINUS = "−";
const num = (v: number) => {
  const s = Math.abs(v).toLocaleString(LOCALE, { maximumFractionDigits: 1, minimumFractionDigits: 0 });
  return v < 0 && s !== "0" ? `${MINUS}${s}` : s;
};

/**
 * The shadow price in one templated sentence, e.g. "One more full-time
 * Strategist adds avg 2.1 completions a quarter (range 1.4–2.9)."
 */
export function shadowPriceText(sp: ShadowPrice, roleName: string): string {
  const { mean, p10, p90 } = sp.perQuarter;
  const who = `One more full-time ${roleName}`;
  const partial = sp.complete ? "" : ` (from ${sp.reps} of ${sp.requestedReps} replications)`;
  if (Math.abs(mean) < 0.05 && Math.abs(p10) < 0.05 && Math.abs(p90) < 0.05) {
    return `${who} makes no difference to completions a quarter${partial}: capacity there isn't what limits throughput.`;
  }
  const lo = num(p10);
  const hi = num(p90);
  const range = lo === hi ? lo : p10 < 0 && p90 > 0 ? `${lo} to ${hi}` : `${lo}–${hi}`;
  const verb = mean >= 0 ? `adds avg ${num(mean)}` : `costs avg ${num(-mean)}`;
  return `${who} ${verb} completions a quarter (range ${range})${partial}.`;
}
