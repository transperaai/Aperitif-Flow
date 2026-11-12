// The analysis settings every page rates a run with (decision D40, issue #175; docs/customisability-audit.md findings 32 and 45). Rule
// cut-offs don't create findings: they only pick which of the engine's facts are worth showing as evidence. The workspace's own
// assumptions (a lost client's value cap, the absence test, the busy bands) are edited in Settings > Simulation and stored in
// `analysis_rules`; the bundle carries them (`ProcessBundle.analysisRules`), and every page reads them through `analysisRulesOf`.
// Nothing stored: the documented defaults (docs/analysis-rules.md).

import type { ProcessBundle } from "@transpera-flow/db";
import type { AnalysisSettings } from "@transpera-flow/engine";

export const ANALYSIS_DEFAULTS: AnalysisSettings = Object.freeze({}) as AnalysisSettings;

/** The workspace's stored analysis settings, or the defaults when it has none. */
export function analysisRulesOf(bundle: Pick<ProcessBundle, "analysisRules"> | null | undefined): AnalysisSettings {
  return bundle?.analysisRules ?? ANALYSIS_DEFAULTS;
}
