// The compare view's KPI delta table and headline subject, as data and text
// (docs/PRD.md §4.1 compare view, §7.1 `compare_scenarios`, §7.3; issue #26).
//
// The app's compare view renders these rows, and the MCP `compare_scenarios`
// tool returns them, so both show the same labels, figures and ranges. Pure
// functions of a `Comparison` (compare.ts) and the model's calendar: no I/O,
// no clock and no language model.

import type { Delta, Comparison } from "./compare";
import type { Stat } from "./model";

const LOCALE = "en-GB";
const MINUS = "−";

/** A number with up to `digits` decimals, as the app formats it (apps/web lib/format.ts `formatNumber`). */
export function formatNumberText(value: number, digits = 1): string {
  return value.toLocaleString(LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

/** Money, compacted above 10,000 (£27k, £1.2m), as the app formats it (`formatCurrency`). */
export function formatMoneyText(value: number, currency: string): string {
  const compact = Math.abs(value) >= 10_000;
  return value.toLocaleString(LOCALE, {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 0,
  });
}

/** "+1.2", "−0.4", or plain zero when the value rounds to it. */
function signed(v: number, format: (x: number) => string): string {
  const s = format(Math.abs(v));
  if (s === format(0)) return format(0);
  return v > 0 ? `+${s}` : `${MINUS}${s}`;
}

/** The 10th–90th percentile band: "5 to 9", or one figure when both ends format the same. */
function band(stat: Stat, format: (v: number) => string, isDelta = false): string {
  const f = isDelta ? (v: number) => signed(v, format) : format;
  const lo = f(stat.p10);
  const hi = f(stat.p90);
  return lo === hi ? lo : `${lo} to ${hi}`;
}

export type CompareMetric = "won" | "lost" | "cycle" | "mrrAdded" | "labour" | "wipEnd";

export interface CompareRow {
  metric: CompareMetric;
  label: string;
  /** Whether a rise is good news; null when it is neither. */
  better: "up" | "down" | null;
  /** "good" or "bad" when the whole change points one way and `better` says which; null otherwise. */
  tone: "good" | "bad" | null;
  delta: Delta;
  /** The cells as the compare view shows them: mean, then the 10th–90th percentile range underneath. */
  text: { baseline: string; baselineRange: string; scenario: string; scenarioRange: string; change: string; changeRange: string };
}

export interface CompareTableOptions {
  horizonWeeks: number;
  hoursPerWeek: number;
  /** ISO 4217 code for the money rows. */
  currency: string;
}

/** The compare view's KPI delta table, row by row. */
export function compareTable(comparison: Comparison, { horizonWeeks, hoursPerWeek, currency }: CompareTableOptions): CompareRow[] {
  const whole = (v: number) => formatNumberText(v, 1);
  const days = (h: number) => `${formatNumberText(h / (hoursPerWeek / 5), 1)} d`;
  const money = (v: number) => formatMoneyText(v, currency);
  const rows: { metric: CompareMetric; label: string; format: (v: number) => string; better: CompareRow["better"] }[] = [
    { metric: "won", label: `Wins / ${horizonWeeks} wks`, format: whole, better: "up" },
    { metric: "lost", label: "Lost", format: whole, better: "down" },
    { metric: "cycle", label: "Cycle time", format: days, better: "down" },
    { metric: "mrrAdded", label: "New MRR", format: money, better: "up" },
    { metric: "labour", label: "Pipeline labour cost", format: money, better: null },
    { metric: "wipEnd", label: "WIP at horizon end", format: whole, better: "down" },
  ];
  return rows.map(({ metric, label, format, better }) => {
    const delta = comparison[metric];
    const d = delta.delta;
    const up = d.p10 > 0 || (d.p10 >= 0 && d.mean > 0);
    const down = d.p90 < 0 || (d.p90 <= 0 && d.mean < 0);
    const tone = !better || (!up && !down) ? null : (up && better === "up") || (down && better === "down") ? "good" : "bad";
    return {
      metric,
      label,
      better,
      tone,
      delta,
      text: {
        baseline: format(delta.baseline.mean),
        baselineRange: band(delta.baseline, format),
        scenario: format(delta.scenario.mean),
        scenarioRange: band(delta.scenario, format),
        change: signed(d.mean, format),
        changeRange: band(d, format, true),
      },
    };
  });
}

/** The compare headline's subject: “A”, “A” + “B”, “A” plus lever changes, These lever changes. */
export function headlineSubject(names: readonly string[], levers: boolean): { subject: string; plural: boolean } {
  const quoted = names.map((n) => `“${n}”`);
  if (!quoted.length) return { subject: "These lever changes", plural: true };
  const joined = quoted.join(" + ");
  if (levers) return { subject: `${joined} plus lever changes`, plural: true };
  return { subject: joined, plural: quoted.length > 1 };
}
