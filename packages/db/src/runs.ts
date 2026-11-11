// Saved runs (docs/PRD.md §5 `runs`, §4.1; decision D19; issue #25): the
// results someone saw and a snapshot of the model behind them, so opening the
// run later can show "model changed since this run" with a list of changes.
// Pure: the app and MCP server load and store rows.

import type { EngineModel, SimulationResult, Stat } from "@transpera-flow/engine";
import { diffSnapshots, type ModelChange, type ModelSnapshot } from "./company";

/** The headline results a saved run keeps (means and 10th–90th percentile ranges). */
export type RunResults = {
  horizon_weeks: number;
  hours_per_week: number;
  currency: string;
  reps: number;
  won: Stat;
  lost: Stat;
  cycle: { mean: number; p50: number; p90: number };
  mrr_added: Stat;
  billed: Stat;
  overtime_hours: Stat;
  /** The busiest role: its name and utilisation. */
  bottleneck: { role: string; util: Stat } | null;
};

/** A saved run (the `runs` row). */
export interface RunRow {
  id: string;
  workspace_id: string;
  process_id: string | null;
  name: string;
  scenario_id: string | null;
  revision_ids: string[];
  /** The engine version that produced the results (`ENGINE_VERSION`; issue #22); null for runs saved before it was recorded. */
  engine_version: string | null;
  reps: number;
  seed: number;
  params_snapshot: ModelSnapshot;
  results: RunResults;
  duration_ms: number | null;
  created_at: string;
  created_by: string | null;
}

/** What a saved run keeps of a simulation. */
export function runResults(model: EngineModel, result: SimulationResult, currency: string): RunResults {
  const k = result.kpi;
  const bn = result.bnRole ? k.roles[result.bnRole] : undefined;
  return {
    horizon_weeks: model.horizonWeeks,
    hours_per_week: model.hoursPerWeek,
    currency,
    reps: result.reps,
    won: k.won,
    lost: k.lost,
    cycle: k.cycle,
    mrr_added: k.mrrAdded,
    billed: k.billed,
    overtime_hours: k.overtimeHours,
    bottleneck: result.bnRole && bn ? { role: model.roles[result.bnRole]?.name ?? result.bnRole, util: bn.util } : null,
  };
}

/** What has changed in the model since the run was saved; empty when nothing has. */
export function changesSinceRun(run: Pick<RunRow, "params_snapshot">, now: ModelSnapshot): ModelChange[] {
  return diffSnapshots(run.params_snapshot, now);
}
