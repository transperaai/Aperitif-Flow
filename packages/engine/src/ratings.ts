// The rating model (docs/analysis-rules.md, "The rating scale" and "Escalators"; issue #106).
//
// Every rule turns one number from the simulation into one of four ratings.
// Each rule has three cut-offs that split its number into the four bands. The
// average across the replications sets the band; two escalators can each raise
// it one level (a bad month, and being on the bottleneck), and a rating can't
// go higher than Operational risk. Everything here is pure: the same numbers
// and the same config always give the same rating, so a stored run can be
// re-rated with a new config without simulating again.

/** Best first. */
export const RATINGS = ["great", "good", "bad", "risk"] as const;
export type Rating = (typeof RATINGS)[number];

export const RATING_LABELS: Record<Rating, string> = {
  great: "Great",
  good: "Good, could improve",
  bad: "Bad, not urgent",
  risk: "Operational risk",
};

/** 0 for Great up to 3 for Operational risk. */
export const ratingRank = (r: Rating): number => RATINGS.indexOf(r);

/** The worse of two ratings. */
export const worseRating = (a: Rating, b: Rating): Rating => (ratingRank(a) >= ratingRank(b) ? a : b);

/** Orders ratings most severe first, for sorting. */
export const compareRatingsDesc = (a: Rating, b: Rating): number => ratingRank(b) - ratingRank(a);

/** The three cut-offs between the four bands: Great|Good, Good|Bad, Bad|Risk. Equal neighbours leave a band empty ("n/a"). */
export type Cutoffs = readonly [good: number, bad: number, risk: number];

/** The rules this model rates (the numbers are those in docs/analysis-rules.md). */
export const RATING_RULE_IDS = ["busy", "overtime", "queue", "wait", "rework", "sla", "spare", "spof", "dropoff", "cycle", "success", "driver"] as const;
export type RatingRuleId = (typeof RATING_RULE_IDS)[number];

export interface RatingRuleMeta {
  /** The rule's number in docs/analysis-rules.md. */
  number: number;
  /** Plain-language name. */
  name: string;
  /**
   * Where a value exactly on a cut-off falls. Most rules read "under 70%",
   * "70–85%": the cut-off belongs to the higher band (`false`). Rule 5 reads
   * "within 1×", "up to 1.5×": it belongs to the lower band (`true`).
   */
  upperInclusive: boolean;
  /** Whether a bad month (P90) can raise the rating. Queue growth is too noisy per run to read a P90 from. */
  badMonth: boolean;
  /**
   * The rule rates a number where lower is worse (spare time: "under 40% busy"; goals met: "80% of runs or more
   * is Great"). Its cut-offs then run from high to low; `upperInclusive` still says which band a value on a
   * cut-off goes to (true: the better one).
   */
  lowerIsWorse?: boolean;
}

export const RATING_RULES: Record<RatingRuleId, RatingRuleMeta> = {
  busy: { number: 1, name: "Too busy", upperInclusive: false, badMonth: true },
  overtime: { number: 3, name: "Overtime", upperInclusive: false, badMonth: true },
  queue: { number: 4, name: "Work piling up", upperInclusive: false, badMonth: false },
  wait: { number: 5, name: "Waiting too long", upperInclusive: true, badMonth: true },
  rework: { number: 6, name: "Rework", upperInclusive: false, badMonth: true },
  sla: { number: 7, name: "Missed deadlines", upperInclusive: false, badMonth: true },
  spare: { number: 2, name: "Spare time", upperInclusive: true, badMonth: false, lowerIsWorse: true },
  spof: { number: 8, name: "Only one person can do it", upperInclusive: false, badMonth: false },
  dropoff: { number: 12, name: "Work lost at a step", upperInclusive: true, badMonth: true },
  cycle: { number: 13, name: "Too slow overall", upperInclusive: true, badMonth: true },
  success: { number: 11, name: "Goals met", upperInclusive: true, badMonth: false, lowerIsWorse: true },
  driver: { number: 10, name: "Cause of clients leaving", upperInclusive: false, badMonth: false },
};

/**
 * What each rule rates, and its default cut-offs (docs/analysis-rules.md):
 *
 * - busy: utilisation, 70 / 85 / 95%.
 * - overtime: the share of the overtime cap used. Any regular overtime (1% of
 *   the cap) is Bad; the cap used up (95%) is Operational risk; no Good band.
 * - queue: queue growth in items a week. 0.5 or more is Operational risk, always.
 * - wait: average wait for a person ÷ the step's expected wait, 1 / 1.5 / 3.
 * - rework: simulated share of visits that repeat, 5 / 10 / 20%.
 * - sla: share of visits over the step's SLA, 5 / 10 / 25%.
 * - spare: utilisation, lower is worse: an opportunity (Good) under 40%; no Bad or Operational risk band (0 / 0).
 * - spof: the share of work lost while the person is away, 5 / 5 / 20% (no Good band). The weeks to recover are
 *   rated by `absence.recoveryCutoffs`.
 * - dropoff: share of work lost at a step ÷ the step's benchmark, 1 / 1.25 / 1.5.
 * - cycle: end-to-end time ÷ the process's target, 1 / 1.25 / 1.5.
 * - success: the share of runs that meet a success measure, lower is worse: 80 / 50 / 20%.
 * - driver: not a three-band number. The first is the share of a client group's churn one driver causes for Bad (30%);
 *   the last is the group's health below which that is Operational risk (50). See `churnCauseIssues`.
 */
export const DEFAULT_RATING_CUTOFFS: Record<RatingRuleId, Cutoffs> = {
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
};

/**
 * The absence test's settings (rule 8, docs/analysis-rules.md): how long the person is away, how often it
 * happens in a year (for the cost), and the cut-offs for the weeks their queues take to get back to normal
 * (within 1 week is Great, up to 4 is Bad, longer is Operational risk; no Good band).
 */
export interface AbsenceSettings {
  weeks: number;
  perYear: number;
  recoveryCutoffs: Cutoffs;
}

export const DEFAULT_ABSENCE: AbsenceSettings = { weeks: 2, perYear: 2, recoveryCutoffs: [1, 1, 4] };

/** What an override can be attached to. The most specific match wins (see `OVERRIDE_PRECEDENCE`). */
export const OVERRIDE_KINDS = ["person", "step", "role", "service", "process"] as const;
export type OverrideKind = (typeof OVERRIDE_KINDS)[number];

/** Which override wins when several match a finding: first in this list. */
export const OVERRIDE_PRECEDENCE: readonly OverrideKind[] = ["person", "step", "role", "service", "process"];

/** A rule setting for one role, person, step, service or process. */
export interface RatingOverride {
  kind: OverrideKind;
  id: string;
  enabled?: boolean;
  cutoffs?: Cutoffs;
  /** Rule 5 only: this subject's expected wait in hours (e.g. a shorter wait for replying to leads). */
  expectedWaitHours?: number;
}

export interface RatingRuleConfig {
  enabled: boolean;
  cutoffs: Cutoffs;
  overrides: RatingOverride[];
}

/** The workspace's analysis rules, as the engine needs them. Defaults match docs/analysis-rules.md. */
export interface RatingConfig {
  rules: Record<RatingRuleId, RatingRuleConfig>;
  escalators: {
    /** The 90th percentile crossing the next cut-off raises the rating one level. */
    badMonth: boolean;
    /** A finding on the current bottleneck (step, role or person) is raised one level. */
    bottleneck: boolean;
  };
  /** Rule 5's default expected wait for a person, in working days of the model's week (`hoursPerWeek / 5`), when nothing sets one. */
  expectedWaitDays: { pipeline: number; servicing: number };
  /** The absence test (rule 8). */
  absence: AbsenceSettings;
}

/** What a caller passes: any part of the config; the rest takes the defaults. */
export interface RatingConfigInput {
  rules?: { [R in RatingRuleId]?: Partial<RatingRuleConfig> };
  escalators?: Partial<RatingConfig["escalators"]>;
  expectedWaitDays?: Partial<RatingConfig["expectedWaitDays"]>;
  absence?: Partial<AbsenceSettings>;
}

export function defaultRatingConfig(): RatingConfig {
  const rules = {} as Record<RatingRuleId, RatingRuleConfig>;
  for (const id of RATING_RULE_IDS) rules[id] = { enabled: true, cutoffs: DEFAULT_RATING_CUTOFFS[id], overrides: [] };
  return { rules, escalators: { badMonth: true, bottleneck: true }, expectedWaitDays: { pipeline: 1, servicing: 2 }, absence: { ...DEFAULT_ABSENCE } };
}

export const DEFAULT_RATING_CONFIG: RatingConfig = defaultRatingConfig();

/** Fill a partial config in with the defaults. */
export function resolveRatingConfig(input: RatingConfigInput = {}): RatingConfig {
  const base = defaultRatingConfig();
  for (const id of RATING_RULE_IDS) base.rules[id] = { ...base.rules[id], ...input.rules?.[id] };
  return {
    rules: base.rules,
    escalators: { ...base.escalators, ...input.escalators },
    expectedWaitDays: { ...base.expectedWaitDays, ...input.expectedWaitDays },
    absence: { ...base.absence, ...input.absence },
  };
}

/** Who a finding is about, to find the overrides that apply to it. */
export interface RatingSubject {
  roleId?: string | null;
  personId?: string | null;
  stepId?: string | null;
  /** Services whose clients the finding touches (a servicing step: the services that run its process). */
  serviceIds?: readonly string[];
  /** The process it belongs to. */
  processId?: string | null;
}

/** A rule's settings for one finding, after overrides. */
export interface ResolvedRule {
  enabled: boolean;
  cutoffs: Cutoffs;
  /** Rule 5: an override's expected wait in hours, when one sets it. */
  expectedWaitHours: number | null;
  /** The kind of the override that set `expectedWaitHours`. */
  expectedWaitFrom: OverrideKind | null;
}

/**
 * A rule's settings for a subject. Overrides take precedence over the rule's
 * own settings; when several apply, the most specific one wins (person, then
 * step, role, service, process), and a field it leaves out falls through to the
 * next one that sets it.
 */
export function resolveRule(config: RatingConfig, rule: RatingRuleId, subject: RatingSubject): ResolvedRule {
  const r = config.rules[rule];
  const ids: Record<OverrideKind, readonly string[]> = {
    person: subject.personId ? [subject.personId] : [],
    step: subject.stepId ? [subject.stepId] : [],
    role: subject.roleId ? [subject.roleId] : [],
    service: subject.serviceIds ?? [],
    process: subject.processId ? [subject.processId] : [],
  };
  const matching: RatingOverride[] = [];
  for (const kind of OVERRIDE_PRECEDENCE) {
    for (const o of r.overrides) if (o.kind === kind && ids[kind].includes(o.id)) matching.push(o);
  }
  const first = <T>(pick: (o: RatingOverride) => T | undefined): T | undefined => {
    for (const o of matching) {
      const v = pick(o);
      if (v !== undefined) return v;
    }
    return undefined;
  };
  return {
    enabled: first((o) => o.enabled) ?? r.enabled,
    cutoffs: first((o) => o.cutoffs) ?? r.cutoffs,
    expectedWaitHours: first((o) => o.expectedWaitHours) ?? null,
    expectedWaitFrom: matching.find((o) => o.expectedWaitHours !== undefined)?.kind ?? null,
  };
}

/** The band a value falls in, 0 (Great) to 3 (Operational risk). */
export function bandOf(cutoffs: Cutoffs, value: number, upperInclusive: boolean): number {
  let band = 0;
  for (const c of cutoffs) if (upperInclusive ? value > c : value >= c) band++;
  return band;
}

/** Whether a band exists for these cut-offs (equal neighbouring cut-offs leave one out, e.g. no Good band for overtime). */
function bandExists(cutoffs: Cutoffs, band: number): boolean {
  return band === 0 || band === 3 || cutoffs[band - 1]! < cutoffs[band]!;
}

/** The next band up from `band` that exists, capped at Operational risk. */
function nextBand(cutoffs: Cutoffs, band: number): number {
  let b = Math.min(3, band + 1);
  while (b < 3 && !bandExists(cutoffs, b)) b++;
  return b;
}

export interface RatingInput {
  /** The average across the replications: sets the band. */
  average: number;
  /** The 90th percentile across the replications (a bad month); omitted when the run has none. */
  p90?: number | null;
  /** Whether the finding is on the current bottleneck (step, role or person). */
  onBottleneck?: boolean;
}

export interface RatingOutcome {
  rating: Rating;
  /** The band the average alone gives. */
  base: Rating;
  /** The 90th percentile crossed the next cut-off, and raised the rating one level. */
  badMonth: boolean;
  /** The finding is on the bottleneck and was raised one level. */
  bottleneck: boolean;
}

/**
 * Rate one number. The average's band is the base. If the 90th percentile
 * crosses the next cut-off the rating rises one level; then, if the finding is
 * on the bottleneck and already worse than Great, it rises one more. A
 * finding is something worse than Great, so a Great that is merely on the
 * bottleneck stays Great. Never above Operational risk. A band a rule doesn't
 * have (equal cut-offs) is skipped.
 */
export function rateValue(
  cutoffs: Cutoffs,
  input: RatingInput,
  opts: { upperInclusive?: boolean; badMonth?: boolean; bottleneck?: boolean; lowerIsWorse?: boolean } = {},
): RatingOutcome {
  if (opts.lowerIsWorse) {
    // Mirror the number and the cut-offs, so the same bands apply (`upperInclusive` keeps its meaning).
    const neg = (v: number) => (v === 0 ? 0 : -v);
    return rateValue(
      [neg(cutoffs[0]), neg(cutoffs[1]), neg(cutoffs[2])],
      { ...input, average: neg(input.average), p90: input.p90 == null ? input.p90 : neg(input.p90) },
      { ...opts, lowerIsWorse: false },
    );
  }
  const upper = opts.upperInclusive ?? false;
  const base = bandOf(cutoffs, input.average, upper);
  let band = base;
  let badMonth = false;
  if ((opts.badMonth ?? true) && input.p90 != null && bandOf(cutoffs, input.p90, upper) > band) {
    band = nextBand(cutoffs, band);
    badMonth = true;
  }
  let bottleneck = false;
  if ((opts.bottleneck ?? true) && input.onBottleneck && band > 0 && band < 3) {
    band = nextBand(cutoffs, band);
    bottleneck = true;
  }
  return { rating: RATINGS[band]!, base: RATINGS[bandOf(cutoffs, input.average, upper)]!, badMonth, bottleneck };
}

/** Rate a number under a rule's resolved cut-offs and the config's escalator switches. */
export function rateRule(
  config: RatingConfig,
  rule: RatingRuleId,
  resolved: ResolvedRule,
  input: RatingInput,
): RatingOutcome {
  const meta = RATING_RULES[rule];
  return rateValue(resolved.cutoffs, input, {
    upperInclusive: meta.upperInclusive,
    lowerIsWorse: meta.lowerIsWorse,
    badMonth: meta.badMonth && config.escalators.badMonth,
    bottleneck: config.escalators.bottleneck,
  });
}

/** How an issue's rating was reached: the average's band, and what raised it. */
export interface RatingEscalation {
  base: Rating;
  badMonth: boolean;
  bottleneck: boolean;
}

/** The rating fields of an issue, from how its number was rated. */
export function ratingFields(o: RatingOutcome): { rating: Rating; escalation: RatingEscalation } {
  return { rating: o.rating, escalation: { base: o.base, badMonth: o.badMonth, bottleneck: o.bottleneck } };
}

/** Rating fields for a finding rated by hand rather than by cut-offs (rules not yet on the rating model). */
export function fixedRating(rating: Rating): { rating: Rating; escalation: RatingEscalation } {
  return { rating, escalation: { base: rating, badMonth: false, bottleneck: false } };
}

/** The sentence an escalated rating adds to its evidence ("" when nothing was raised). */
export function escalationNote(o: RatingOutcome): string {
  const parts: string[] = [];
  if (o.badMonth) parts.push("a bad month (the 90th percentile) crosses the next cut-off");
  if (o.bottleneck) parts.push("it is on the current bottleneck");
  if (!parts.length) return "";
  return `Rated ${RATING_LABELS[o.base]} on the average, raised to ${RATING_LABELS[o.rating]} because ${parts.join(" and ")}.`;
}

/**
 * The four stored severities of manual and promoted issues (the database's
 * `issues.severity` check) and the rating each stands for. One to one, so
 * nothing is lost either way; the database column keeps its values because
 * other SQL writes them.
 */
export const STORED_SEVERITIES = ["critical", "serious", "warning", "info"] as const;
export type StoredSeverity = (typeof STORED_SEVERITIES)[number];

const STORED_TO_RATING: Record<StoredSeverity, Rating> = { critical: "risk", serious: "bad", warning: "good", info: "great" };
const RATING_TO_STORED: Record<Rating, StoredSeverity> = { risk: "critical", bad: "serious", good: "warning", great: "info" };

export const ratingOfStored = (s: StoredSeverity): Rating => STORED_TO_RATING[s];
export const storedOfRating = (r: Rating): StoredSeverity => RATING_TO_STORED[r];

/**
 * Rule 9, client health (docs/analysis-rules.md): a client group's simulated
 * health, 0 to 100, where higher is better. Great from 75, Good from 65, Bad
 * from 50, Operational risk under 50. The cut-offs are listed best first, so
 * they run the other way round to the other rules'.
 */
export const CLIENT_HEALTH_CUTOFFS: Cutoffs = [75, 65, 50];

/** Rate a client group's (or the company's) health. A cut-off belongs to the better band: 75 is Great, 65 is Good, 50 is Bad. */
export function rateClientHealth(health: number, cutoffs: Cutoffs = CLIENT_HEALTH_CUTOFFS): Rating {
  if (health >= cutoffs[0]) return "great";
  if (health >= cutoffs[1]) return "good";
  if (health >= cutoffs[2]) return "bad";
  return "risk";
}
