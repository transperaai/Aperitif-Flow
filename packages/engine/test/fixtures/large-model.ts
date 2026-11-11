import type { EngineModel, EngineStep } from "../../src";

/** A synthetic 40-step, 25-person process: 8 roles, a long chain with branches and rework. */
export function largeModel(): EngineModel {
  const roleIds = Array.from({ length: 8 }, (_, i) => `r${i}`);
  const counts = [4, 3, 3, 3, 3, 3, 3, 3];
  const steps: EngineStep[] = Array.from({ length: 40 }, (_, i) => {
    const id = `s${i}`;
    const nextId = i === 39 ? "won" : `s${i + 1}`;
    const next =
      i % 7 === 3 && i < 39
        ? [
            { to: nextId, p: 0.85 },
            { to: "lost", p: 0.15 },
          ]
        : [{ to: nextId, p: 1 }];
    return {
      id,
      name: `Step ${i}`,
      role: i % 10 === 9 ? null : roleIds[i % 8]!,
      work: 0.5 + (i % 5) * 0.4,
      wait: i % 3 === 0 ? 4 : 0,
      rework: i % 6 === 0 ? 0.1 : 0,
      next,
    };
  });
  return {
    horizonWeeks: 26,
    hoursPerWeek: 40,
    leadsPerWeek: 20,
    activeClients: 30,
    churnMonthly: 0.03,
    retainer: 2000,
    roles: Object.fromEntries(roleIds.map((id, i) => [id, { name: id, count: counts[i]!, cost: 50, ongoing: 0.3 }])),
    entry: "s0",
    sinks: { won: "won", lost: "lost" },
    steps,
  };
}
