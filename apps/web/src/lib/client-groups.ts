// Input checks for the client groups settings (issue #120). Pure, so they can be unit tested. They only reject
// malformed input early: every write still runs as the signed-in user through RLS and the table's check constraints.

type Check = (v: unknown) => boolean;

const number: Check = (v) => typeof v === "number" && Number.isFinite(v);
const between = (min: number, max: number): Check => (v) => number(v) && (v as number) >= min && (v as number) <= max;
const whole = (min: number, max: number): Check => (v) => between(min, max)(v) && Number.isInteger(v);

/** Upper bounds that catch typos, inside what the database stores. */
export const MAX_GROUP_COUNT = 2000;
const MAX_FEE = 1e8;
const MAX_STAY_MONTHS = 1200;

/** Client group columns saved one at a time, and what each accepts. */
export const CLIENT_GROUP_FIELDS = {
  client_count: whole(0, MAX_GROUP_COUNT),
  fee: between(0, MAX_FEE),
  churn_monthly: between(0, 1),
  stay_months: between(0, MAX_STAY_MONTHS),
  starting_health: between(0, 100),
} as const satisfies Record<string, Check>;

export type ClientGroupField = keyof typeof CLIENT_GROUP_FIELDS;

export const isClientGroupField = (v: unknown): v is ClientGroupField => typeof v === "string" && Object.hasOwn(CLIENT_GROUP_FIELDS, v);

/** A benchmark bound for company client health: 0 to 100, or null to clear it. */
export const isBenchmarkBound = (v: unknown): v is number | null => v === null || between(0, 100)(v);

/** Where a group's numbers start when one is first set up for a service: its price, its base churn and its tenure. */
export function newGroupDefaults(service: { price: number; churn_monthly_base: number; tenure_months: number }): Record<ClientGroupField, number> {
  return {
    client_count: 0,
    fee: Number(service.price),
    churn_monthly: Number(service.churn_monthly_base),
    stay_months: Number(service.tenure_months),
    starting_health: 80,
  };
}

export interface Benchmark {
  low: number;
  high: number;
}

/** The benchmark from the workspace settings: both bounds, low first, or null if either is missing. */
export function benchmarkOf(settings: { client_health_benchmark_low?: number | null; client_health_benchmark_high?: number | null }): Benchmark | null {
  const low = settings.client_health_benchmark_low;
  const high = settings.client_health_benchmark_high;
  if (low === undefined || low === null || high === undefined || high === null) return null;
  const a = Number(low);
  const b = Number(high);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { low: Math.min(a, b), high: Math.max(a, b) };
}

/** Where a score sits against the benchmark. */
export type BenchmarkPosition = "below" | "in range" | "above";

export function positionAgainst(score: number, benchmark: Benchmark): BenchmarkPosition {
  const s = Math.round(score);
  return s < benchmark.low ? "below" : s > benchmark.high ? "above" : "in range";
}
