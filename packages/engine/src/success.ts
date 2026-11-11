// Goals met (docs/analysis-rules.md rule 11; issue #107).
//
// A process's first principles name success measures ("win 6 clients a
// quarter", "proposals out within 5 days"). This rule reads them and rates
// each by the share of replications that meet its target, using a number the
// engine computes (a `SuccessKpi`). A measure that doesn't map to one is not
// rated; it is reported as "not checked by simulation".
//
// Where the measures come from is A54's job (first principles stored with the
// process). Until then `NO_SUCCESS_MEASURES` is the source and nothing is
// rated. A54 implements `SuccessMeasureSource` and passes it in
// `DetectOptions.successMeasures`.

import type { EngineModel, SimulationResult } from "./model";

/** The engine numbers a success measure can be checked against, one value per replication. */
export const SUCCESS_KPIS = {
  /** Items won over the horizon. */
  won: "Items won over the run",
  /** Items won a week. */
  winsPerWeek: "Items won a week",
  /** Won ÷ (won + lost). Replications that finished nothing are skipped. */
  winRate: "Share of finished items that are won",
  /** New monthly recurring revenue won over the run. */
  newMrr: "New monthly recurring revenue",
  /** Revenue billed over the run. */
  billed: "Revenue billed",
  /** Mean cycle time of the items completed, in working hours. Replications that completed none are skipped. */
  cycleHours: "Average time to complete, in working hours",
  /** Labour cost of the pipeline work over the run. */
  labour: "Labour cost",
  /** Items still waiting at the end of the run. */
  wipEnd: "Work in progress at the end",
} as const;
export type SuccessKpi = keyof typeof SUCCESS_KPIS;

/** A success measure from a process's first principles. */
export interface SuccessMeasure {
  id: string;
  name: string;
  /** The engine number it maps to; null when the simulation can't compute it (rated: no, "not checked by simulation"). */
  kpi: SuccessKpi | null;
  /** Met when the number is at least (`atLeast`) or at most (`atMost`) the target, in the KPI's own unit. */
  direction: "atLeast" | "atMost";
  target: number;
  /** The process it belongs to, for overrides on a process. */
  processId?: string | null;
}

/** Where success measures come from. A54 implements this over the stored first principles. */
export interface SuccessMeasureSource {
  measures(): readonly SuccessMeasure[];
}

/** The stub source: no measures, so nothing is rated. */
export const NO_SUCCESS_MEASURES: SuccessMeasureSource = { measures: () => [] };

export type SuccessCheck =
  | { measure: SuccessMeasure; status: "rated"; reps: number; met: number; metShare: number; mean: number }
  | { measure: SuccessMeasure; status: "not_checked"; reason: string };

/** The KPI's value in each replication of `result`; empty when it can't be read. */
export function successKpiValues(model: EngineModel, result: SimulationResult, kpi: SuccessKpi): number[] {
  const s = result.samples;
  const weeks = model.horizonWeeks;
  switch (kpi) {
    case "won":
      return s.won;
    case "winsPerWeek":
      return weeks > 0 ? s.won.map((w) => w / weeks) : [];
    case "winRate": {
      const out: number[] = [];
      for (let i = 0; i < s.won.length; i++) if (s.won[i]! + s.lost[i]! > 0) out.push(s.won[i]! / (s.won[i]! + s.lost[i]!));
      return out;
    }
    case "newMrr":
      return s.mrrAdded;
    case "billed":
      return s.billed;
    case "cycleHours":
      return s.cycleMean.filter((c) => c > 0);
    case "labour":
      return s.labour;
    case "wipEnd":
      return s.wipEnd;
  }
}

/** Check each measure from `source` against a run: rated by the share of replications that meet it, or not checked. */
export function checkSuccessMeasures(source: SuccessMeasureSource, model: EngineModel, result: SimulationResult): SuccessCheck[] {
  return source.measures().map((measure): SuccessCheck => {
    if (!measure.kpi) return { measure, status: "not_checked", reason: "Not checked by simulation" };
    if (!Number.isFinite(measure.target)) return { measure, status: "not_checked", reason: "No target set" };
    const values = successKpiValues(model, result, measure.kpi);
    if (!values.length) return { measure, status: "not_checked", reason: "Not checked by simulation: the run has no value for it" };
    const met = values.filter((v) => (measure.direction === "atLeast" ? v >= measure.target : v <= measure.target)).length;
    return { measure, status: "rated", reps: values.length, met, metShare: met / values.length, mean: values.reduce((a, b) => a + b, 0) / values.length };
  });
}
