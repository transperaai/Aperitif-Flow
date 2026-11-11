import { describe, expect, it } from "vitest";
import { applyPatches, compareRuns, compareTable, headlineSubject, northbeamModel, rankBottlenecks, simulate } from "../src";

describe("rankBottlenecks", () => {
  const model = northbeamModel();
  const result = simulate(model, 30, 1);
  const b = rankBottlenecks(model, result);

  it("leads with the run's bottleneck role and ranks roles and people by utilisation", () => {
    expect(b.top?.id).toBe(result.bnRole);
    expect(b.top?.id).toBe("strat");
    expect(b.roles.map((r) => r.id)).toHaveLength(Object.keys(model.roles).length);
    for (let i = 1; i < b.roles.length; i++) expect(b.roles[i - 1]!.util.mean).toBeGreaterThanOrEqual(b.roles[i]!.util.mean);
    for (let i = 1; i < b.people.length; i++) expect(b.people[i - 1]!.util.mean).toBeGreaterThanOrEqual(b.people[i]!.util.mean);
    expect(b.people[0]!.id).toBe(result.bnPerson);
  });

  it("gives the numbers behind each constraint, in templated sentences", () => {
    const strat = b.top!;
    expect(strat.util).toEqual(result.kpi.roles.strat!.util);
    expect(strat.people).toBe(1);
    expect(strat.queueStep?.id).toBe("audit");
    expect(strat.evidence).toMatch(/^Strategist is \d+% utilised \(range \d+–\d+%\): [\d.]+ h\/week of work across 1 person, \d+% on the pipeline and \d+% on client work\. Work queues longest at “Audit & proposal” \(avg [\d.]+ items waiting\)\.$/);
    expect(b.steps[0]!.id).toBe(result.bnStep);
    expect(b.steps[0]!.evidence).toMatch(/^“.+” has avg [\d.]+ items waiting \(peak [\d.]+\); each waits avg [\d.]+ working days before work starts/);
  });

  it("limits each list", () => {
    const top = rankBottlenecks(model, result, { limit: 2 });
    expect(top.roles).toHaveLength(2);
    expect(top.people.length).toBeLessThanOrEqual(2);
    expect(top.top?.id).toBe("strat");
  });
});

describe("compareTable", () => {
  const model = northbeamModel();
  const base = simulate(model, 10, 1);
  const hire = simulate(applyPatches(model, [{ path: "roles.strat.headcount", op: "add", value: 1 }]).model, 10, 1);
  const rows = compareTable(compareRuns(base, hire), { horizonWeeks: 13, hoursPerWeek: 40, currency: "GBP" });

  it("has the compare view's six rows, labelled as the app labels them", () => {
    expect(rows.map((r) => r.label)).toEqual(["Wins / 13 wks", "Lost", "Cycle time", "New MRR", "Pipeline labour cost", "WIP at horizon end"]);
  });

  it("formats means, ranges and signed changes", () => {
    const won = rows[0]!;
    expect(won.text.baseline).toBe(won.delta.baseline.mean.toLocaleString("en-GB", { maximumFractionDigits: 1 }));
    expect(won.text.change).toMatch(/^(\+|−)?[\d.]+$/);
    expect(rows[2]!.text.baseline).toMatch(/ d$/);
    expect(rows[3]!.text.baseline).toMatch(/^£/);
    // More strategist capacity shortens the cycle: good news for a "down is better" row.
    expect(rows[2]!.tone === "good" || rows[2]!.tone === null).toBe(true);
  });

  it("words the subject as the app does", () => {
    expect(headlineSubject(["Hire"], false)).toEqual({ subject: "“Hire”", plural: false });
    expect(headlineSubject(["A", "B"], true)).toEqual({ subject: "“A” + “B” plus lever changes", plural: true });
    expect(headlineSubject([], true)).toEqual({ subject: "These lever changes", plural: true });
  });
});
