import { describe, expect, it } from "vitest";
import { simulate, type Distribution, type EngineModel, type EngineStep } from "../src";

// Textbook queueing models with exact answers. The engine must reproduce their
// utilisation (ρ), mean queue length (Lq) and mean wait in queue (Wq).
// Time unit: one "week" of one hour, so rates are per time unit. Horizons are
// long enough that the empty start doesn't matter.

const HORIZON = 20_000;
const REPS = 8;

interface Station {
  id: string;
  servers: number;
  meanService: number;
  dist?: Distribution;
  rework?: number;
  next: EngineStep["next"];
}

function model(arrivalRate: number, stations: Station[], entry = stations[0]!.id, extra: EngineStep[] = []): EngineModel {
  return {
    horizonWeeks: HORIZON,
    hoursPerWeek: 1,
    leadsPerWeek: arrivalRate,
    activeClients: 0,
    churnMonthly: 0,
    retainer: 0,
    roles: Object.fromEntries(stations.map((s) => [s.id, { name: s.id, count: s.servers, cost: 0, ongoing: 0 }])),
    entry,
    sinks: { won: "done", lost: "lost" },
    steps: [
      ...extra,
      ...stations.map(
        (s): EngineStep => ({
          id: s.id,
          name: s.id,
          role: s.id,
          work: s.meanService,
          wait: 0,
          rework: s.rework ?? 0,
          workDist: s.dist ?? { kind: "exponential" },
          next: s.next,
        }),
      ),
    ],
  };
}

const factorial = (n: number): number => (n <= 1 ? 1 : n * factorial(n - 1));

/** Erlang C: M/M/c mean queue length. */
function mmcLq(lambda: number, mu: number, c: number): number {
  const a = lambda / mu;
  const rho = a / c;
  let sum = 0;
  for (let k = 0; k < c; k++) sum += a ** k / factorial(k);
  const tail = a ** c / (factorial(c) * (1 - rho));
  const p0 = 1 / (sum + tail);
  return ((tail * p0) * rho) / (1 - rho);
}

/** Pollaczek–Khinchine: M/G/1 mean queue length for service CV `cv`. */
const mg1Lq = (rho: number, cv: number) => (rho * rho * (1 + cv * cv)) / (2 * (1 - rho));

function expectClose(actual: number, expected: number, relTol: number, label: string) {
  const rel = Math.abs(actual - expected) / expected;
  // Set QT_DEBUG=1 to print how close each metric lands.
  if (process.env.QT_DEBUG) console.log(label, `${(rel * 100).toFixed(2)}%`);
  expect(rel, `${label}: got ${actual.toFixed(4)}, expected ${expected.toFixed(4)}`).toBeLessThan(relTol);
}

function checkStation(res: ReturnType<typeof simulate>, id: string, lambda: number, rho: number, lq: number, lqTol = 0.06) {
  expectClose(res.roles[id]!.util, rho, 0.01, `${id} utilisation`);
  expectClose(res.steps[id]!.avgQueue, lq, lqTol, `${id} Lq`);
  expectClose(res.steps[id]!.avgWait, lq / lambda, lqTol, `${id} Wq`);
}

describe("queueing theory", () => {
  it("M/M/1 at ρ = 0.5", () => {
    const res = simulate(model(1, [{ id: "s", servers: 1, meanService: 0.5, next: [{ to: "done", p: 1 }] }]), REPS, 1);
    checkStation(res, "s", 1, 0.5, mmcLq(1, 2, 1));
  });

  it("M/M/1 at ρ = 0.8", () => {
    const res = simulate(model(1, [{ id: "s", servers: 1, meanService: 0.8, next: [{ to: "done", p: 1 }] }]), REPS, 1);
    checkStation(res, "s", 1, 0.8, mmcLq(1, 1.25, 1), 0.08);
  });

  it("M/M/2 at ρ = 0.7", () => {
    const res = simulate(model(1, [{ id: "s", servers: 2, meanService: 1.4, next: [{ to: "done", p: 1 }] }]), REPS, 1);
    checkStation(res, "s", 1, 0.7, mmcLq(1, 1 / 1.4, 2));
  });

  it("M/M/3 at ρ = 0.85", () => {
    const res = simulate(model(2, [{ id: "s", servers: 3, meanService: 1.275, next: [{ to: "done", p: 1 }] }]), REPS, 1);
    checkStation(res, "s", 2, 0.85, mmcLq(2, 1 / 1.275, 3), 0.08);
  });

  it("M/D/1 (constant service) at ρ = 0.7", () => {
    const res = simulate(
      model(1, [{ id: "s", servers: 1, meanService: 0.7, dist: { kind: "constant" }, next: [{ to: "done", p: 1 }] }]),
      REPS,
      1,
    );
    checkStation(res, "s", 1, 0.7, mg1Lq(0.7, 0));
  });

  it("M/G/1 (lognormal service, CV 0.35) at ρ = 0.7", () => {
    const res = simulate(
      model(1, [{ id: "s", servers: 1, meanService: 0.7, dist: { kind: "lognormal", cv: 0.35 }, next: [{ to: "done", p: 1 }] }]),
      REPS,
      1,
    );
    checkStation(res, "s", 1, 0.7, mg1Lq(0.7, 0.35));
  });

  it("M/G/1 (triangular service) at ρ = 0.6", () => {
    // Triangular(0.2, 0.6, 1.0): mean 0.6, variance (a²+b²+c²−ab−ac−bc)/18.
    const variance = (0.04 + 0.36 + 1 - 0.12 - 0.2 - 0.6) / 18;
    const res = simulate(
      model(1, [
        { id: "s", servers: 1, meanService: 0.6, dist: { kind: "triangular", min: 0.2, mode: 0.6, max: 1 }, next: [{ to: "done", p: 1 }] },
      ]),
      REPS,
      1,
    );
    checkStation(res, "s", 1, 0.6, mg1Lq(0.6, Math.sqrt(variance) / 0.6));
  });

  it("two M/M/1 stations in series (Jackson tandem)", () => {
    const res = simulate(
      model(1, [
        { id: "a", servers: 1, meanService: 0.6, next: [{ to: "b", p: 1 }] },
        { id: "b", servers: 1, meanService: 0.75, next: [{ to: "done", p: 1 }] },
      ]),
      REPS,
      1,
    );
    checkStation(res, "a", 1, 0.6, mmcLq(1, 1 / 0.6, 1));
    checkStation(res, "b", 1, 0.75, mmcLq(1, 1 / 0.75, 1));
  });

  it("M/M/1 with rework feedback (Jackson)", () => {
    // 20% rework: effective arrival rate λ / (1 − p) = 1.25, ρ = 0.625.
    const res = simulate(
      model(1, [{ id: "s", servers: 1, meanService: 0.5, rework: 0.2, next: [{ to: "done", p: 1 }] }]),
      REPS,
      1,
    );
    checkStation(res, "s", 1.25, 0.625, mmcLq(1.25, 2, 1));
  });

  it("probabilistic split into two M/M/1 queues (Poisson splitting)", () => {
    const split: EngineStep = {
      id: "split",
      name: "split",
      role: null,
      work: 0,
      wait: 0,
      rework: 0,
      next: [
        { to: "a", p: 0.3 },
        { to: "b", p: 0.7 },
      ],
    };
    const res = simulate(
      model(
        2,
        [
          { id: "a", servers: 1, meanService: 1, next: [{ to: "done", p: 1 }] },
          { id: "b", servers: 1, meanService: 0.5, next: [{ to: "done", p: 1 }] },
        ],
        "split",
        [split],
      ),
      REPS,
      1,
    );
    checkStation(res, "a", 0.6, 0.6, mmcLq(0.6, 1, 1));
    checkStation(res, "b", 1.4, 0.7, mmcLq(1.4, 2, 1));
  });
});
