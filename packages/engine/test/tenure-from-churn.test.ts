import { describe, expect, it } from "vitest";
import { averageDealValue, DEFAULT_MAX_STAY_MONTHS, northbeamModel, tenureFromChurn } from "../src";

describe("tenureFromChurn", () => {
  it("is 1 / churn up to the longest stay, and the longest stay at no churn", () => {
    expect(tenureFromChurn(0.02, 60)).toBeCloseTo(50, 12);
    expect(tenureFromChurn(0.01, 60)).toBe(60);
    expect(tenureFromChurn(0, 60)).toBe(60);
    expect(tenureFromChurn(Number.NaN, 24)).toBe(24);
  });

  it("with no longest stay keeps the old rule: 1 / churn uncapped, 0 at no churn", () => {
    expect(tenureFromChurn(0.005)).toBeCloseTo(200, 12);
    expect(tenureFromChurn(0)).toBe(0);
  });

  it("the implicit retainer follows the model's longest stay only when one is set", () => {
    const base = { ...northbeamModel(), services: undefined, churnMonthly: 0, retainer: 1000 };
    // As before: a retainer that never churns is valued at the analysis cap.
    expect(averageDealValue(base, 12)).toBe(12_000);
    expect(averageDealValue({ ...base, maxStayMonths: 24 }, 1e9)).toBe(24_000);
    expect(DEFAULT_MAX_STAY_MONTHS).toBeGreaterThan(0);
  });
});
