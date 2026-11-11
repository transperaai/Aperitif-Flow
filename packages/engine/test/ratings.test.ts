import { describe, expect, it } from "vitest";
import {
  DEFAULT_RATING_CONFIG,
  DEFAULT_RATING_CUTOFFS,
  RATING_RULES,
  RATING_RULE_IDS,
  bandOf,
  ratingOfStored,
  rateRule,
  rateValue,
  resolveRatingConfig,
  resolveRule,
  storedOfRating,
  STORED_SEVERITIES,
  RATINGS,
  type Rating,
  type RatingConfigInput,
  type RatingRuleId,
} from "../src";

// The rating model (issue #106, docs/analysis-rules.md): bands, cut-off
// boundaries for every migrated rule, the two escalators and overrides.

const rate = (rule: RatingRuleId, average: number, extra: { p90?: number; onBottleneck?: boolean } = {}, config: RatingConfigInput = {}) => {
  const c = resolveRatingConfig(config);
  return rateRule(c, rule, resolveRule(c, rule, {}), { average, ...extra });
};

describe("defaults match docs/analysis-rules.md", () => {
  it("has the agreed cut-offs", () => {
    expect(DEFAULT_RATING_CUTOFFS).toEqual({
      busy: [0.7, 0.85, 0.95],
      overtime: [0.01, 0.01, 0.95],
      queue: [0.5, 0.5, 0.5],
      wait: [1, 1.5, 3],
      rework: [0.05, 0.1, 0.2],
      sla: [0.05, 0.1, 0.25],
      spare: [0.4, 0, 0],
      spof: [0.05, 0.05, 0.2],
      dropoff: [1, 1.25, 1.5],
      cycle: [1, 1.25, 1.5],
      success: [0.8, 0.5, 0.2],
      driver: [0.3, 0.3, 50],
    });
    expect(DEFAULT_RATING_CONFIG.absence).toEqual({ weeks: 2, perYear: 2, recoveryCutoffs: [1, 1, 4] });
    expect(DEFAULT_RATING_CONFIG.expectedWaitDays).toEqual({ pipeline: 1, servicing: 2 });
    expect(DEFAULT_RATING_CONFIG.escalators).toEqual({ badMonth: true, bottleneck: true });
    for (const id of RATING_RULE_IDS) expect(DEFAULT_RATING_CONFIG.rules[id]).toMatchObject({ enabled: true, overrides: [] });
  });

  it("numbers the rules as the doc does", () => {
    expect(RATING_RULE_IDS.map((id) => RATING_RULES[id].number)).toEqual([1, 3, 4, 5, 6, 7, 2, 8, 12, 13, 11, 10]);
  });
});

describe("band boundaries", () => {
  const eps = 1e-9;
  // For each rule: [value, expected rating] either side of every cut-off. A value on a cut-off belongs to the
  // higher band, except for rule 5 ("within 1×", "up to 1.5×"), where it belongs to the lower one.
  const table: Record<RatingRuleId, [number, Rating][]> = {
    busy: [
      [0, "great"], [0.7 - eps, "great"], [0.7, "good"], [0.85 - eps, "good"], [0.85, "bad"], [0.95 - eps, "bad"], [0.95, "risk"], [1.2, "risk"],
    ],
    overtime: [
      // Share of the overtime cap used: none is Great, any regular overtime Bad (no Good band), the cap used up Risk.
      [0, "great"], [0.01 - eps, "great"], [0.01, "bad"], [0.95 - eps, "bad"], [0.95, "risk"], [1, "risk"],
    ],
    queue: [
      // Items a week: only Operational risk, and always at 0.5 or more.
      [-1, "great"], [0, "great"], [0.5 - eps, "great"], [0.5, "risk"], [3, "risk"],
    ],
    wait: [
      [0, "great"], [1, "great"], [1 + eps, "good"], [1.5, "good"], [1.5 + eps, "bad"], [3, "bad"], [3 + eps, "risk"], [10, "risk"],
    ],
    rework: [
      [0, "great"], [0.05 - eps, "great"], [0.05, "good"], [0.1 - eps, "good"], [0.1, "bad"], [0.2 - eps, "bad"], [0.2, "risk"], [1, "risk"],
    ],
    sla: [
      [0, "great"], [0.05 - eps, "great"], [0.05, "good"], [0.1 - eps, "good"], [0.1, "bad"], [0.25 - eps, "bad"], [0.25, "risk"], [1, "risk"],
    ],
    // Rule 2: utilisation, lower is worse. Under 40% is a Good opportunity; 40% itself is Great. No Bad or Risk band.
    spare: [
      [0, "good"], [0.2, "good"], [0.4 - eps, "good"], [0.4, "great"], [0.9, "great"], [1.2, "great"],
    ],
    // Rule 8: the share of work lost. Under 5% Great, 5-20% Bad (no Good band), 20% or more Risk.
    spof: [
      [0, "great"], [0.05 - eps, "great"], [0.05, "bad"], [0.2 - eps, "bad"], [0.2, "risk"], [1, "risk"],
    ],
    // Rule 12: lost share / the step's benchmark. At or better than the benchmark is Great; a value on a cut-off stays in the lower band.
    dropoff: [
      [0, "great"], [1, "great"], [1 + eps, "good"], [1.25, "good"], [1.25 + eps, "bad"], [1.5, "bad"], [1.5 + eps, "risk"], [5, "risk"],
    ],
    // Rule 13: cycle time / the process's target. Same bands.
    cycle: [
      [0, "great"], [1, "great"], [1 + eps, "good"], [1.25, "good"], [1.25 + eps, "bad"], [1.5, "bad"], [1.5 + eps, "risk"], [5, "risk"],
    ],
    // Rule 11: the share of runs that meet the measure. 80% or more Great, 50-80% Good, 20-50% Bad, under 20% Risk.
    success: [
      [1, "great"], [0.8, "great"], [0.8 - eps, "good"], [0.5, "good"], [0.5 - eps, "bad"], [0.2, "bad"], [0.2 - eps, "risk"], [0, "risk"],
    ],
    // Rule 10: a driver's share of a group's churn. Under 30% Great (nothing to report), 30% or more Bad; the last cut-off is
    // the group health (0 to 100) below which it is Operational risk, so as a plain share it never reaches it.
    driver: [
      [0, "great"], [0.3 - eps, "great"], [0.3, "bad"], [1, "bad"], [50, "risk"],
    ],
  };

  for (const rule of RATING_RULE_IDS) {
    it(`rule ${RATING_RULES[rule].number} (${RATING_RULES[rule].name}) rates each side of every cut-off`, () => {
      for (const [value, expected] of table[rule]) expect({ value, rating: rate(rule, value).rating }).toEqual({ value, rating: expected });
    });
  }

  it("rates the weeks an absence takes to recover on its own cut-offs: within 1 week Great, up to 4 Bad, longer Risk", () => {
    const c = resolveRatingConfig();
    const weeks = (w: number) => rateValue(c.absence.recoveryCutoffs, { average: w }, { upperInclusive: true, badMonth: false, bottleneck: false }).rating;
    expect([0, 1, 1 + eps, 4, 4 + eps, 9].map(weeks)).toEqual(["great", "great", "bad", "bad", "risk", "risk"]);
  });

  it("bandOf counts the cut-offs a value reaches", () => {
    expect(bandOf([0.7, 0.85, 0.95], 0.9, false)).toBe(2);
    expect(bandOf([1, 1.5, 3], 1, true)).toBe(0);
    expect(bandOf([1, 1.5, 3], 1, false)).toBe(1);
  });
});

describe("escalator: a bad month (P90 crosses the next cut-off)", () => {
  it("raises one level when P90 reaches the next cut-off, and not before", () => {
    // Average 75% is Good; the next cut-off is 85%.
    expect(rate("busy", 0.75, { p90: 0.849 }).rating).toBe("good");
    const o = rate("busy", 0.75, { p90: 0.85 });
    expect(o).toMatchObject({ rating: "bad", base: "good", badMonth: true, bottleneck: false });
  });

  it("raises only one level even when P90 crosses several cut-offs", () => {
    expect(rate("busy", 0.75, { p90: 1.5 }).rating).toBe("bad");
    expect(rate("busy", 0.5, { p90: 1.5 }).rating).toBe("good");
  });

  it("does nothing when P90 is in the same band, or when there is no P90", () => {
    expect(rate("busy", 0.75, { p90: 0.8 })).toMatchObject({ rating: "good", badMonth: false });
    expect(rate("busy", 0.75)).toMatchObject({ rating: "good", badMonth: false });
  });

  it("can raise Great to Good, and stops at Operational risk", () => {
    expect(rate("busy", 0.6, { p90: 0.72 }).rating).toBe("good");
    expect(rate("busy", 0.97, { p90: 1.2 }).rating).toBe("risk");
  });

  it("skips a band a rule doesn't have (overtime has no Good)", () => {
    // Great on average; a bad month with any regular overtime goes to Bad, not to the empty Good.
    expect(rate("overtime", 0, { p90: 0.3 })).toMatchObject({ rating: "bad", badMonth: true });
    // Bad on average, P90 with the cap used up: Operational risk.
    expect(rate("overtime", 0.4, { p90: 0.96 }).rating).toBe("risk");
  });

  it("uses the wait ratio's own boundary (1.5× is still Good)", () => {
    expect(rate("wait", 0.9, { p90: 1.5 }).rating).toBe("good");
    expect(rate("wait", 1.2, { p90: 1.5 }).badMonth).toBe(false);
    expect(rate("wait", 1.2, { p90: 1.51 }).rating).toBe("bad");
  });

  it("can be switched off", () => {
    expect(rate("busy", 0.75, { p90: 0.97 }, { escalators: { badMonth: false } })).toMatchObject({ rating: "good", badMonth: false });
  });

  it("is not applied to queue growth, which is too noisy per run to read a P90 from", () => {
    expect(rate("queue", 0.1, { p90: 2 }).rating).toBe("great");
  });
});

describe("escalator: on the bottleneck", () => {
  it("raises a finding one level", () => {
    expect(rate("busy", 0.75, { onBottleneck: true })).toMatchObject({ rating: "bad", base: "good", badMonth: false, bottleneck: true });
    expect(rate("busy", 0.9, { onBottleneck: true }).rating).toBe("risk");
  });

  it("stays at Operational risk", () => {
    expect(rate("busy", 0.99, { onBottleneck: true })).toMatchObject({ rating: "risk", bottleneck: false });
  });

  it("leaves a Great alone: it isn't a finding", () => {
    expect(rate("busy", 0.3, { onBottleneck: true })).toMatchObject({ rating: "great", bottleneck: false });
  });

  it("can be switched off", () => {
    expect(rate("busy", 0.75, { onBottleneck: true }, { escalators: { bottleneck: false } }).rating).toBe("good");
  });

  it("stacks with a bad month, capped at Operational risk", () => {
    // Good, a bad month takes it to Bad, the bottleneck to Operational risk.
    expect(rate("busy", 0.82, { p90: 0.97, onBottleneck: true })).toMatchObject({ rating: "risk", base: "good", badMonth: true, bottleneck: true });
    // Bad + bad month = Operational risk already; the bottleneck adds nothing.
    expect(rate("busy", 0.9, { p90: 0.99, onBottleneck: true })).toMatchObject({ rating: "risk", badMonth: true, bottleneck: false });
    // Great on average, bad month to Good, bottleneck to Bad.
    expect(rate("busy", 0.6, { p90: 0.75, onBottleneck: true }).rating).toBe("bad");
  });
});

describe("rateValue", () => {
  it("is a pure function of its numbers", () => {
    const args = [[0.7, 0.85, 0.95], { average: 0.82, p90: 0.97, onBottleneck: true }] as const;
    expect(rateValue(...args)).toEqual(rateValue(...args));
    expect(rateValue(...args).rating).toBe("risk");
  });
});

describe("overrides", () => {
  const config: RatingConfigInput = {
    rules: {
      busy: {
        overrides: [
          { kind: "process", id: "proc", cutoffs: [0.1, 0.2, 0.3] },
          { kind: "service", id: "svc", cutoffs: [0.2, 0.3, 0.4] },
          { kind: "role", id: "role", cutoffs: [0.3, 0.4, 0.5] },
          { kind: "step", id: "step", cutoffs: [0.4, 0.5, 0.6] },
          { kind: "person", id: "person", cutoffs: [0.5, 0.6, 0.7] },
        ],
      },
    },
  };
  const c = resolveRatingConfig(config);
  const cutoffs = (subject: Parameters<typeof resolveRule>[2]) => resolveRule(c, "busy", subject).cutoffs;

  it("each kind takes precedence over the defaults", () => {
    expect(cutoffs({})).toEqual([0.7, 0.85, 0.95]);
    expect(cutoffs({ processId: "proc" })).toEqual([0.1, 0.2, 0.3]);
    expect(cutoffs({ serviceIds: ["svc"] })).toEqual([0.2, 0.3, 0.4]);
    expect(cutoffs({ roleId: "role" })).toEqual([0.3, 0.4, 0.5]);
    expect(cutoffs({ stepId: "step" })).toEqual([0.4, 0.5, 0.6]);
    expect(cutoffs({ personId: "person" })).toEqual([0.5, 0.6, 0.7]);
  });

  it("the most specific one wins: person, then step, role, service, process", () => {
    expect(cutoffs({ processId: "proc", serviceIds: ["svc"], roleId: "role", stepId: "step", personId: "person" })).toEqual([0.5, 0.6, 0.7]);
    expect(cutoffs({ processId: "proc", serviceIds: ["svc"], roleId: "role", stepId: "step" })).toEqual([0.4, 0.5, 0.6]);
    expect(cutoffs({ processId: "proc", serviceIds: ["svc"], roleId: "role" })).toEqual([0.3, 0.4, 0.5]);
    expect(cutoffs({ processId: "proc", serviceIds: ["svc"] })).toEqual([0.2, 0.3, 0.4]);
  });

  it("an override for someone else doesn't apply", () => {
    expect(cutoffs({ personId: "other", roleId: "other", stepId: "other", serviceIds: ["other"], processId: "other" })).toEqual([0.7, 0.85, 0.95]);
  });

  it("changes the rating for its subject only", () => {
    const rated = (subject: Parameters<typeof resolveRule>[2]) => rateRule(c, "busy", resolveRule(c, "busy", subject), { average: 0.55 }).rating;
    expect(rated({})).toBe("great");
    expect(rated({ personId: "person" })).toBe("good");
    expect(rated({ stepId: "step" })).toBe("bad");
  });

  it("can switch a rule off for one subject, and a field it leaves out falls through", () => {
    const c2 = resolveRatingConfig({
      rules: {
        wait: {
          overrides: [
            { kind: "step", id: "reply", expectedWaitHours: 2 },
            { kind: "process", id: "proc", enabled: false, cutoffs: [2, 3, 4] },
          ],
        },
      },
    });
    const both = resolveRule(c2, "wait", { stepId: "reply", processId: "proc" });
    expect(both).toEqual({ enabled: false, cutoffs: [2, 3, 4], expectedWaitHours: 2, expectedWaitFrom: "step" });
    expect(resolveRule(c2, "wait", { stepId: "other" }).enabled).toBe(true);
  });
});

describe("config", () => {
  it("fills in defaults for what a caller leaves out and doesn't share state", () => {
    const c = resolveRatingConfig({ rules: { rework: { cutoffs: [0.01, 0.02, 0.03] } }, expectedWaitDays: { pipeline: 0.5 } });
    expect(c.rules.rework.cutoffs).toEqual([0.01, 0.02, 0.03]);
    expect(c.rules.busy.cutoffs).toEqual([0.7, 0.85, 0.95]);
    expect(c.expectedWaitDays).toEqual({ pipeline: 0.5, servicing: 2 });
    c.rules.busy.overrides.push({ kind: "role", id: "x" });
    expect(DEFAULT_RATING_CONFIG.rules.busy.overrides).toEqual([]);
  });
});

describe("stored severities", () => {
  it("map one to one onto the ratings", () => {
    expect(STORED_SEVERITIES.map(ratingOfStored)).toEqual(["risk", "bad", "good", "great"]);
    for (const r of RATINGS) expect(ratingOfStored(storedOfRating(r))).toBe(r);
  });
});
