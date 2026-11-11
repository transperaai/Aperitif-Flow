// How a step's rating is drawn on the map (issue #99): one of four colours, each
// with a plain name. Colours come from the --rate-* tokens, never raw values.

import { RATINGS, type Rating } from "@transpera-flow/engine";

/** What a rating looks like: its stripe and its soft tint (CSS colours, from the tokens). */
export const RATING_STYLE: Record<Rating, { stripe: string; soft: string; hint: string }> = {
  great: { stripe: "var(--rate-great)", soft: "var(--rate-great-soft)", hint: "Working well. Protect it." },
  good: { stripe: "var(--rate-good)", soft: "var(--rate-good-soft)", hint: "Fine today, with something to gain." },
  bad: { stripe: "var(--rate-bad)", soft: "var(--rate-bad-soft)", hint: "Costing time or money. Plan a fix." },
  risk: { stripe: "var(--rate-risk)", soft: "var(--rate-risk-soft)", hint: "Could break delivery or lose clients. Fix now." },
};

/** The legend, worst first (the prototype's order). */
export const LEGEND_ORDER: readonly Rating[] = [...RATINGS].reverse();

/** The rating a rank (0 Great … 3 Operational risk) stands for, or null for anything else. */
export const ratingOfRank = (rank: number): Rating | null => RATINGS[rank] ?? null;
