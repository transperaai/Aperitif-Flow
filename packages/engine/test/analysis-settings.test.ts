import { describe, expect, it } from "vitest";
import {
  ANALYSIS_RULE_IDS,
  ANALYSIS_RULE_SPECS,
  DEFAULT_RATING_CONFIG,
  RATING_RULE_IDS,
  detectIssues,
  isDefaultAnalysisSettings,
  parseAnalysisSettings,
  resolveAnalysisRule,
  resolveMoney,
  simulate,
  toRatingConfig,
  withoutDisabledRules,
  type AnalysisSettings,
  type EngineModel,
} from "../src";

// Analysis rules as stored (issue #109): defaults, validation, the rating config they make, and re-rating a run.

function busyLine(leadsPerWeek: number): EngineModel {
  return {
    horizonWeeks: 26,
    hoursPerWeek: 40,
    leadsPerWeek,
    activeClients: 0,
    churnMonthly: 0,
    retainer: 0,
    warmupWeeks: 4,
    roles: { r: { name: "Role r", count: 1, cost: 0, ongoing: 0 } },
    entry: "a",
    sinks: { won: "won", lost: "lost" },
    steps: [{ id: "a", name: "Step a", role: "r", work: 4, wait: 0, rework: 0, workDist: { kind: "constant" }, next: [{ to: "won", p: 1 }] }],
  };
}

describe("defaults", () => {
  it("an empty document is the agreed defaults", () => {
    expect(toRatingConfig(undefined, 40)).toEqual(DEFAULT_RATING_CONFIG);
    expect(toRatingConfig({}, 40)).toEqual(DEFAULT_RATING_CONFIG);
    expect(isDefaultAnalysisSettings({})).toBe(true);
  });

  it("covers every rule of the spec, 15 in all, with the engine ids all among them", () => {
    expect(ANALYSIS_RULE_IDS).toHaveLength(15);
    expect(ANALYSIS_RULE_IDS.map((id) => ANALYSIS_RULE_SPECS[id].number)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    for (const id of RATING_RULE_IDS) expect(ANALYSIS_RULE_SPECS[id].engine).toBe(id);
  });

  it("each engine rule's default inputs give the engine's default cut-offs", () => {
    for (const id of RATING_RULE_IDS) {
      const defaults = [...ANALYSIS_RULE_SPECS[id].defaults];
      // Same numbers written out explicitly: a stored copy of the defaults rates exactly like no setting at all.
      const same = toRatingConfig({ rules: { [id]: { inputs: defaults } } }, 40);
      expect(same.rules[id].cutoffs).toEqual(DEFAULT_RATING_CONFIG.rules[id].cutoffs);
    }
  });

  it("drops what equals the default, so a default that changes later reaches everyone who never edited it", () => {
    const parsed = parseAnalysisSettings({
      rules: { busy: { enabled: true, inputs: [0.7, 0.85, 0.95] } },
      escalators: { badMonth: true },
      money: { capMonths: 12, absenceWeeks: 2 },
    });
    expect(parsed).toEqual({ ok: true, value: {} });
  });
});

describe("what a setting does to the rating config", () => {
  it("switches a rule off, edits cut-offs and expands the shorter input lists", () => {
    const c = toRatingConfig(
      { rules: { busy: { enabled: false }, overtime: { inputs: [0.05, 0.9] }, queue: { inputs: [1] }, wait: { inputs: [2, 3, 4] } } },
      40,
    );
    expect(c.rules.busy.enabled).toBe(false);
    expect(c.rules.overtime.cutoffs).toEqual([0.05, 0.05, 0.9]);
    expect(c.rules.queue.cutoffs).toEqual([1, 1, 1]);
    expect(c.rules.wait.cutoffs).toEqual([2, 3, 4]);
    expect(c.rules.rework).toEqual(DEFAULT_RATING_CONFIG.rules.rework);
  });

  it("turns each escalator off", () => {
    expect(toRatingConfig({ escalators: { badMonth: false } }, 40).escalators).toEqual({ badMonth: false, bottleneck: true });
    expect(toRatingConfig({ escalators: { bottleneck: false } }, 40).escalators).toEqual({ badMonth: true, bottleneck: false });
  });

  it("carries overrides across, with an expected wait in hours kept as hours", () => {
    const c = toRatingConfig(
      {
        rules: {
          wait: { overrides: [{ kind: "step", id: "s1", expectedWaitHours: 4, inputs: [1, 2, 4] }] },
          busy: { overrides: [{ kind: "person", id: "p1", enabled: false }] },
        },
      },
      40,
    );
    expect(c.rules.wait.overrides).toEqual([{ kind: "step", id: "s1", cutoffs: [1, 2, 4], expectedWaitHours: 4 }]);
    expect(c.rules.busy.overrides).toEqual([{ kind: "person", id: "p1", enabled: false }]);
  });

  it("turns the normal waits (hours) into working days of the model's week", () => {
    const c = toRatingConfig({ money: { waitHours: { pipeline: 4, servicing: 24 } } }, 40);
    expect(c.expectedWaitDays).toEqual({ pipeline: 0.5, servicing: 3 });
    expect(toRatingConfig({ money: { waitHours: { pipeline: 4 } } }, 20).expectedWaitDays).toEqual({ pipeline: 1, servicing: 2 });
  });

  it("reads the money settings with defaults", () => {
    expect(resolveMoney({})).toEqual({ capMonths: 12, absenceWeeks: 2, absencesPerYear: 2, waitHours: { pipeline: null, servicing: null } });
    expect(resolveMoney({ money: { capMonths: 6 } }).capMonths).toBe(6);
    expect(resolveAnalysisRule({}, "busy")).toEqual({ enabled: true, inputs: [0.7, 0.85, 0.95], overrides: [], changed: false });
  });
});

describe("validation", () => {
  const bad = (input: unknown) => {
    const r = parseAnalysisSettings(input);
    expect(r.ok).toBe(false);
    return r;
  };

  it("rejects cut-offs out of order, wrong length, negative or too big", () => {
    bad({ rules: { busy: { inputs: [0.9, 0.8, 0.95] } } });
    bad({ rules: { busy: { inputs: [0.7, 0.85] } } });
    bad({ rules: { busy: { inputs: [-1, 0.85, 0.95] } } });
    bad({ rules: { busy: { inputs: [0.7, 0.85, 99] } } });
    bad({ rules: { health: { inputs: [50, 65, 75] } } });
    bad({ rules: { spof: { inputs: [0.05, 0.2, 4, 1] } } });
  });

  it("accepts descending cut-offs where better is higher", () => {
    expect(parseAnalysisSettings({ rules: { health: { inputs: [80, 70, 40] } } }).ok).toBe(true);
  });

  it("drops the invalid part and keeps the rest", () => {
    const r = parseAnalysisSettings({ rules: { busy: { inputs: [0.9, 0.8, 0.95] }, rework: { enabled: false } }, nope: 1, money: { capMonths: 0 } });
    expect(r.value).toEqual({ rules: { rework: { enabled: false } } });
    expect(r.ok).toBe(false);
  });

  it("rejects unknown rules, bad money and non-objects", () => {
    bad({ rules: { bogus: { enabled: false } } });
    bad({ money: { capMonths: 100 } });
    bad({ money: { waitHours: { pipeline: 0 } } });
    bad({ escalators: { badMonth: "no" } });
    bad("text");
    bad([]);
  });

  it("checks overrides: kind, subject, duplicates, change, expected wait only on the wait rule", () => {
    bad({ rules: { busy: { overrides: [{ kind: "team", id: "x", enabled: false }] } } });
    bad({ rules: { busy: { overrides: [{ kind: "role", id: "", enabled: false }] } } });
    bad({ rules: { busy: { overrides: [{ kind: "role", id: "x" }] } } });
    bad({ rules: { busy: { overrides: [{ kind: "role", id: "x", enabled: false }, { kind: "role", id: "x", enabled: false }] } } });
    bad({ rules: { busy: { overrides: [{ kind: "role", id: "x", expectedWaitHours: 4 }] } } });
    bad({ rules: { busy: { overrides: [{ kind: "role", id: "x", inputs: [0.9, 0.8, 0.95] }] } } });
    bad({ rules: { sources: { overrides: [{ kind: "role", id: "x", enabled: false }] } } });
    expect(parseAnalysisSettings({ rules: { wait: { overrides: [{ kind: "step", id: "s", expectedWaitHours: 4 }] } } }).ok).toBe(true);
  });

  it("is idempotent: parsing a parsed document changes nothing", () => {
    const doc: AnalysisSettings = {
      rules: {
        busy: { inputs: [0.6, 0.75, 0.9], overrides: [{ kind: "person", id: "p", label: "Maya", inputs: [0.5, 0.7, 0.9], why: "Only strategist" }] },
        spare: { enabled: false },
      },
      escalators: { bottleneck: false },
      money: { capMonths: 6, waitHours: { pipeline: 4 } },
    };
    const once = parseAnalysisSettings(doc);
    expect(once).toEqual({ ok: true, value: doc });
    expect(parseAnalysisSettings(once.value)).toEqual(once);
  });
});

describe("re-rating a stored run without simulating again", () => {
  // 9 leads a week × 4 h on 40 h is ~90% busy: Bad on the defaults.
  const model = busyLine(9);
  const result = simulate(model, 12, 1);
  const noEsc: AnalysisSettings = { escalators: { badMonth: false, bottleneck: false } };
  const rate = (s: AnalysisSettings) =>
    detectIssues(model, result, toRatingConfig({ ...noEsc, ...s }, model.hoursPerWeek)).find((i) => i.key === "capacity:role:r");

  it("moves the rating when a cut-off moves, and drops the issue when the rule is switched off", () => {
    expect(rate({})?.rating).toBe("bad");
    expect(rate({ rules: { busy: { inputs: [0.5, 0.6, 0.8] } } })?.rating).toBe("risk");
    expect(rate({ rules: { busy: { inputs: [0.95, 0.97, 0.99] } } })).toBeUndefined();
    expect(rate({ rules: { busy: { enabled: false } } })).toBeUndefined();
  });

  it("applies an override to the role it names and to nothing else", () => {
    const o = (id: string) => ({ rules: { busy: { overrides: [{ kind: "role" as const, id, inputs: [0.95, 0.97, 0.99] }] } } });
    expect(rate(o("r"))).toBeUndefined();
    expect(rate(o("other"))?.rating).toBe("bad");
  });

  it("does not need a simulation: the same result object serves every config", () => {
    const before = JSON.stringify(result);
    rate({ rules: { busy: { enabled: false } } });
    rate({});
    expect(JSON.stringify(result)).toBe(before);
  });
});

describe("money settings from other tickets", () => {
  it("keeps keys it doesn't know, so saving never strips them", () => {
    const doc = { money: { capMonths: 6, costPerMonth: { basis: "mrr", months: 3 } } } as AnalysisSettings;
    const r = parseAnalysisSettings(doc);
    expect(r).toEqual({ ok: true, value: doc });
    expect(parseAnalysisSettings(r.value)).toEqual(r);
  });
});

describe("findings of switched-off rules", () => {
  it("are dropped by rule, whatever detector made them", () => {
    const f = [
      { key: "spof:step:a", type: "spof" },
      { key: "capacity:role:r", type: "capacity" },
      { key: "churn_risk:client:c", type: "churn_risk" },
      { key: "manual:1", type: "manual" },
    ];
    const keys = (s: AnalysisSettings) => withoutDisabledRules(s, f).map((x) => x.key);
    expect(keys({})).toHaveLength(4);
    expect(keys({ rules: { spof: { enabled: false } } })).toEqual(["capacity:role:r", "churn_risk:client:c", "manual:1"]);
    expect(keys({ rules: { health: { enabled: false } } })).not.toContain("churn_risk:client:c");
  });
});
