import { describe, expect, it } from "vitest";
import {
  ANALYSIS_RULE_SPECS,
  DEFAULT_RATING_CONFIG,
  DEFAULT_RATING_CUTOFFS,
  detectIssues,
  inputsToCutoffs,
  ruleOfFinding,
  simulate,
  toRatingConfig,
  type AbsenceTest,
  type AnalysisRuleId,
  type EngineModel,
} from "../src";

// The stored analysis rules (A44, analysis-settings.ts) feed the new rules (A42).

describe("the stored analysis rules feed the new rules", () => {
  it("gives every rule on the rating model exactly its default cut-offs, and the default config overall", () => {
    for (const [rule, spec] of Object.entries(ANALYSIS_RULE_SPECS)) {
      if (!spec.engine) continue;
      expect(inputsToCutoffs(rule as AnalysisRuleId, spec.defaults), rule).toEqual(DEFAULT_RATING_CUTOFFS[spec.engine]);
    }
    expect(toRatingConfig({}, 40)).toEqual(DEFAULT_RATING_CONFIG);
    expect(toRatingConfig({}, 40).absence).toEqual({ weeks: 2, perYear: 2, recoveryCutoffs: [1, 1, 4] });
  });

  it("rates every new rule from its stored id, and maps the absence test's settings", () => {
    for (const rule of ["spare", "spof", "success", "dropoff", "cycle"] as const) expect(ANALYSIS_RULE_SPECS[rule].engine).toBe(rule);
    const cfg = toRatingConfig(
      { rules: { spof: { inputs: [0.1, 0.3, 2, 6] }, dropoff: { inputs: [1.5, 2] }, spare: { inputs: [0.3] } }, money: { absenceWeeks: 3, absencesPerYear: 4 } },
      40,
    );
    expect(cfg.rules.spof.cutoffs).toEqual([0.1, 0.1, 0.3]);
    expect(cfg.rules.dropoff.cutoffs).toEqual([1, 1.5, 2]);
    expect(cfg.rules.spare.cutoffs).toEqual([0.3, 0, 0]);
    expect(cfg.absence).toEqual({ weeks: 3, perYear: 4, recoveryCutoffs: [2, 2, 6] });
  });

  it("maps findings of the new rules to their rules, spare time not to busy", () => {
    expect(ruleOfFinding({ key: "spare:person:x" })).toBe("spare");
    expect(ruleOfFinding({ key: "dropoff:step:x" })).toBe("dropoff");
    expect(ruleOfFinding({ key: "cycle:process:x" })).toBe("cycle");
    expect(ruleOfFinding({ key: "success:measure:x" })).toBe("success");
    expect(ruleOfFinding({ key: "spof:step:x" })).toBe("spof");
  });

  it("rates a queue that never recovers as Operational risk, even on a run too short to see four weeks", () => {
    const m: EngineModel = {
      horizonWeeks: 4,
      hoursPerWeek: 40,
      leadsPerWeek: 2,
      activeClients: 0,
      churnMonthly: 0,
      retainer: 0,
      warmupWeeks: 4,
      roles: { solo: { name: "Role solo", count: 1, cost: 0, ongoing: 0 } },
      entry: "a",
      sinks: { won: "won", lost: "lost" },
      steps: [{ id: "a", name: "Step a", role: "solo", work: 10, wait: 0, rework: 0, workDist: { kind: "constant" }, next: [{ to: "won", p: 1 }] }],
    };
    const t: AbsenceTest = {
      reps: 2,
      seed: 1,
      weeksAway: 2,
      startWeek: 0,
      complete: true,
      people: [{ personId: "solo#1", stepIds: ["a"], workLost: 0, itemsLost: 0, winsLost: 0, recoveryWeeks: 2, recovered: false, extraMissed: 0, clientDeadlineMissed: false }],
    };
    const issue = detectIssues(m, simulate(m, 4, 1), {}, { absence: t }).find((i) => i.key === "spof:step:a");
    expect(issue?.rating).toBe("risk");
  });
});
