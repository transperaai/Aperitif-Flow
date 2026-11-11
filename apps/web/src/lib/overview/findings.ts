// "What the analysis found" on the Overview (issue #100, A35): the rule-based findings counted by rating and
// sorted worst first, the most costly first within a rating (decision D31). Pure.

import { RATINGS, compareCostsDesc, ratingRank, type DetectedIssue, type Rating } from "@transpera-flow/engine";

/** What a finding costs a month, when the engine priced it in money; null when it has no money price. */
export const costPerMonth = (finding: DetectedIssue): number | null => finding.cost.perMonth;

/** Findings in the register's order: worst rating first, then dearest first (priced before unpriced), then as found. */
export function sortFindings(findings: readonly DetectedIssue[]): DetectedIssue[] {
  return findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => {
      const byRating = ratingRank(b.f.rating) - ratingRank(a.f.rating);
      if (byRating) return byRating;
      const byCost = compareCostsDesc(a.f.cost, b.f.cost);
      if (byCost) return byCost;
      return a.i - b.i;
    })
    .map(({ f }) => f);
}

/** How many findings sit at each rating, worst first. */
export function ratingCounts(findings: readonly Pick<DetectedIssue, "rating">[]): { rating: Rating; count: number }[] {
  return [...RATINGS].reverse().map((rating) => ({ rating, count: findings.filter((f) => f.rating === rating).length }));
}
