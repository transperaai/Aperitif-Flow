// The analysis assumptions an owner edits in Settings > Simulation (docs/customisability-audit.md findings 32 and 45), read from and
// written into the workspace's stored analysis settings (`analysis_rules.settings`). Pure: no I/O.
//
// - A lost client's value cap, the absence test's length and how often it happens: `money.capMonths`, `money.absenceWeeks`,
//   `money.absencesPerYear`.
// - The busy bands: rule 1's cut-offs. Each role's own utilisation threshold is the middle one (the engine's `withRoleLines`), so
//   what the workspace sets is how far under the threshold the "busy" band starts and how far over it is an Operational risk.

import {
  ANALYSIS_RULE_SPECS,
  DEFAULT_MONEY,
  MONEY_LIMITS,
  parseAnalysisSettings,
  resolveAnalysisRule,
  resolveMoney,
  type AnalysisSettings,
} from "@transpera-flow/engine";

export const ASSUMPTION_KEYS = ["capMonths", "absenceWeeks", "absencesPerYear", "busyBelow", "busyAbove"] as const;
export type AssumptionKey = (typeof ASSUMPTION_KEYS)[number];

export const isAssumptionKey = (v: unknown): v is AssumptionKey => typeof v === "string" && (ASSUMPTION_KEYS as readonly string[]).includes(v);

const BUSY_DEFAULTS = ANALYSIS_RULE_SPECS.busy.defaults as readonly [number, number, number];
const round = (v: number) => Math.round(v * 1e6) / 1e6;

/** Each assumption's default and the values it may take (in storage units: the busy bands are shares, 0.15 is 15 points). */
export const ASSUMPTION_LIMITS: Record<AssumptionKey, { min: number; max: number; default: number; whole: boolean }> = {
  capMonths: { ...MONEY_LIMITS.capMonths, default: DEFAULT_MONEY.capMonths, whole: true },
  absenceWeeks: { ...MONEY_LIMITS.absenceWeeks, default: DEFAULT_MONEY.absenceWeeks, whole: true },
  absencesPerYear: { ...MONEY_LIMITS.absencesPerYear, default: DEFAULT_MONEY.absencesPerYear, whole: true },
  busyBelow: { min: 0, max: 0.5, default: round(BUSY_DEFAULTS[1] - BUSY_DEFAULTS[0]), whole: false },
  busyAbove: { min: 0, max: 0.5, default: round(BUSY_DEFAULTS[2] - BUSY_DEFAULTS[1]), whole: false },
};

/** Whether `v` is a value `key` may be set to. */
export function validAssumption(key: AssumptionKey, v: unknown): v is number {
  const lim = ASSUMPTION_LIMITS[key];
  return typeof v === "number" && Number.isFinite(v) && v >= lim.min && v <= lim.max && (!lim.whole || Number.isInteger(v));
}

/** Every assumption's value in these settings, defaults filled in. */
export function assumptionValues(settings: AnalysisSettings): Record<AssumptionKey, number> {
  const money = resolveMoney(settings);
  const [c0, c1, c2] = resolveAnalysisRule(settings, "busy").inputs as [number, number, number];
  return {
    capMonths: money.capMonths,
    absenceWeeks: money.absenceWeeks,
    absencesPerYear: money.absencesPerYear,
    busyBelow: round(c1 - c0),
    busyAbove: round(c2 - c1),
  };
}

/** The settings with one assumption changed; null puts it back to its default. Everything else stored is kept as it is. */
export function withAssumption(settings: AnalysisSettings, key: AssumptionKey, value: number | null): AnalysisSettings {
  const s = parseAnalysisSettings(settings).value;
  const v = value ?? ASSUMPTION_LIMITS[key].default;
  if (key === "busyBelow" || key === "busyAbove") {
    const [c0, c1, c2] = resolveAnalysisRule(s, "busy").inputs as [number, number, number];
    const inputs = key === "busyBelow" ? [round(Math.max(0, c1 - v)), c1, c2] : [c0, c1, round(c1 + v)];
    const busy = { ...(s.rules?.busy ?? {}), inputs };
    return { ...s, rules: { ...(s.rules ?? {}), busy } };
  }
  return { ...s, money: { ...(s.money ?? {}), [key]: v } };
}
