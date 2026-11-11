// Draft vs live (issue #9): the headline KPIs of both runs side by side, with
// the change. Both runs use the same seed, so a difference comes from the
// draft's changes, not from different random draws.

import type { EngineModel, SimulationResult } from "@transpera-flow/engine";
import { formatCurrency, formatDays, formatNumber, formatPercent } from "@/lib/format";

export interface CompareRow {
  label: string;
  live: string;
  draft: string;
  /** "+1.5", "−2 d", or "no change". */
  delta: string;
  /** Whether the draft is better (true), worse (false) or neither (null) on this measure. */
  better: boolean | null;
}

interface Measure {
  label: string;
  value: (r: SimulationResult, m: EngineModel) => number;
  format: (v: number, m: EngineModel) => string;
  /** Higher is better (true), lower is better (false). */
  higherIsBetter: boolean;
}

/** Relative changes below this count as no change (run-to-run noise in the last digit). */
const EPSILON = 1e-9;

function measures(currency: string): Measure[] {
  const money = (v: number) => formatCurrency(v, currency);
  return [
    { label: "Wins", value: (r) => r.kpi.won.mean, format: (v) => formatNumber(v), higherIsBetter: true },
    { label: "Lost", value: (r) => r.kpi.lost.mean, format: (v) => formatNumber(v), higherIsBetter: false },
    { label: "Cycle time", value: (r) => r.kpi.cycle.mean, format: (v, m) => formatDays(v, m.hoursPerWeek), higherIsBetter: false },
    { label: "Cycle time P90", value: (r) => r.kpi.cycle.p90, format: (v, m) => formatDays(v, m.hoursPerWeek), higherIsBetter: false },
    { label: "New MRR", value: (r) => r.kpi.mrrAdded.mean, format: money, higherIsBetter: true },
    { label: "Cost per win", value: (r) => r.kpi.costPerWin.mean, format: money, higherIsBetter: false },
    { label: "WIP at the end", value: (r) => r.kpi.wipEnd.mean, format: (v) => formatNumber(v), higherIsBetter: false },
    {
      label: "Bottleneck utilisation",
      value: (r) => (r.bnRole ? (r.kpi.roles[r.bnRole]?.util.mean ?? 0) : 0),
      format: (v) => formatPercent(v),
      higherIsBetter: false,
    },
  ];
}

export function compareRuns(
  live: { model: EngineModel; result: SimulationResult },
  draft: { model: EngineModel; result: SimulationResult },
  currency: string,
): CompareRow[] {
  const rows: CompareRow[] = measures(currency).map((m) => {
    const a = m.value(live.result, live.model);
    const b = m.value(draft.result, draft.model);
    const diff = b - a;
    const same = Math.abs(diff) <= EPSILON * Math.max(1, Math.abs(a));
    const shown = m.format(Math.abs(diff), draft.model);
    return {
      label: m.label,
      live: m.format(a, live.model),
      draft: m.format(b, draft.model),
      delta: same ? "no change" : `${diff > 0 ? "+" : "−"}${m.label === "Bottleneck utilisation" ? `${shown.replace("%", "")} pts` : shown}`,
      better: same ? null : diff > 0 === m.higherIsBetter,
    };
  });
  const roleName = (r: SimulationResult, m: EngineModel) => (r.bnRole ? (m.roles[r.bnRole]?.name ?? "–") : "–");
  const a = roleName(live.result, live.model);
  const b = roleName(draft.result, draft.model);
  rows.push({ label: "Bottleneck", live: a, draft: b, delta: a === b ? "no change" : "moved", better: null });
  return rows;
}
