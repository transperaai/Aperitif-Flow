// A free-play run, read for the Sandbox's verdict and four charts (capacity build P7, docs/plans/capacity/p7-sandbox-brief.md section 4).
//
// Everything that is a capacity figure comes from P5's `capacity-figures.ts`: DLER (`dler`, with the salaries of the people there that month),
// when a team goes over its line and when to hire (`hiringAdvice`), and the people and their lines (`busyShares`). This file only lines the engine's
// monthly series up with them, month by month, for a run with the levers moved and one without.

import type { EngineModel, SimulationResult } from "@transpera-flow/engine";
import type { CapacitySetup, SetupPerson } from "./capacity-setup";
import { clientFee, personSalary, tierCount, uniqueClients } from "./capacity-setup";
import { busyShares, dler, hiringAdvice, hiringDelayAt, hiringDelayBase } from "./capacity-figures";
import { hireFte, hirePay, playChangeId, type PlayHire, type PlayState } from "./sandbox-play";
import { hireMonthlySalary } from "./salary";
import type { PlayPersonSeries, PlaySeries } from "./sandbox-verdict";

export interface PlayLine {
  id: string;
  name: string;
  values: (number | null)[];
}

export interface PlayTeamLine extends PlayLine {
  /** The team's line (D17), 0-1. */
  line: number;
  /** The month's 90th percentile busy share: the busy share "in 9 of 10 runs" is at or under. Null when nobody of the role is there. */
  p90: (number | null)[];
}

export interface PlayCharts {
  /** Clients by department. */
  clients: PlayLine[];
  retainers: number[];
  /** DLER by department (D24). */
  dler: PlayLine[];
  dlerWhole: (number | null)[];
  /** Every team, the busiest over the run first, each with its line (the chart shows the first five). */
  teams: PlayTeamLine[];
  /** Clients won and lost in each month, every department together (the months' means). */
  won: number[];
  lost: number[];
  /** Clients lost to a price rise over the run, from the churn causes (D36); 0 with no rise. */
  lostToPrice: number;
}

export interface PlayOutcome extends PlaySeries {
  charts: PlayCharts;
  /** Each department's retainers in the run's first month, in `setup.departments` order: today's path's are the levers' path's anchor. */
  retainerAnchor: number[];
}

const mean = (s: { mean: number } | null | undefined): number => (s ? s.mean : 0);

/** What `setupInMonth` reads of a play: leavers and hires, and the pay change (Costs) when there is one. */
export type PlayPeople = Pick<PlayState, "leavers" | "hires"> & Partial<Pick<PlayState, "pay" | "payRole" | "payFrom">>;

/**
 * The setup as it stands in month `m` (0-based) of the play: leavers gone, hires there at their FTE and salary (`playHireSalary`, the
 * one the run costs them at too), and from the pay change's month every salary of its roles (the role's and its people's own) × the
 * change, as the run's profit scales their pay (a person's own salary by the mean over their roles, as the engine does).
 */
export function setupInMonth(setup: CapacitySetup, play: PlayPeople, m: number): CapacitySetup {
  const gone = new Set(play.leavers.filter((l) => l.month <= m).map((l) => l.person));
  let base = setup;
  let hireFactor = (_role: string) => 1;
  const pay = Number(play.pay) || 0;
  if (pay && !setup.payHidden && m >= (play.payFrom ?? 0)) {
    const factor = Math.max(0, 1 + pay / 100);
    const hit = (rid: string) => play.payRole === undefined || play.payRole === "all" || play.payRole === rid;
    hireFactor = (role) => (hit(role) ? factor : 1);
    const scale = (v: number | null, f: number) => (v === null ? null : v * f);
    base = {
      ...setup,
      roles: setup.roles.map((r) => (hit(r.id) ? { ...r, salary_monthly: scale(r.salary_monthly, factor) } : r)),
      people: setup.people.map((p) => {
        const held = p.role_ids.filter((rid) => setup.roles.some((r) => r.id === rid));
        if (!held.length || !held.some(hit)) return p;
        const f = held.reduce((a, rid) => a + (hit(rid) ? factor : 1), 0) / held.length;
        return { ...p, salary_monthly: scale(p.salary_monthly, f) };
      }),
    };
  }
  const people: SetupPerson[] = base.people.map((p) => (gone.has(p.id) ? { ...p, active: false } : p));
  play.hires.forEach((h, i) => {
    if (h.month > m) return;
    const fte = hireFte(h);
    people.push({
      id: playChangeId("D1", i),
      name: "New hire",
      email: null,
      active: true,
      fte,
      capacity_hours_week: null,
      cost_rate: null,
      start_date: null,
      end_date: null,
      notes: null,
      reserved_share: 0,
      salary_monthly: playHireSalary(base, hirePay(h) === null ? h : { ...h, pay: hirePay(h)! * hireFactor(h.role) }),
      label: null,
      ramp: null,
      provenance: {},
      role_ids: [h.role],
      tier_ids: [],
    });
  });
  return { ...base, people };
}

/**
 * A free-play hire's monthly salary (`hireMonthlySalary`): their typed pay, else the role's active people's full-time pay × their FTE;
 * null where pay is hidden or nobody in the role has one (then the role's salary pro rata, as for anyone).
 */
export function playHireSalary(setup: Pick<CapacitySetup, "roles" | "people" | "payHidden">, h: Pick<PlayHire, "role" | "fte" | "pay">): number | null {
  if (setup.payHidden) return null;
  const members = setup.people.filter((p) => p.active && p.role_ids.includes(h.role)).map((p) => ({ salary: personSalary(setup, p), fte: p.fte }));
  return hireMonthlySalary(hirePay(h), hireFte(h), members);
}

/**
 * The verdict's series and the charts' lines for one run. `model` is the model the run used (its people, for a hire's name); `result` has the monthly
 * series. Months are the run's months.
 */
export function playSeries(
  setup: CapacitySetup,
  play: PlayPeople,
  model: EngineModel,
  result: SimulationResult,
  /** Months to hire before the market stretches it: the workspace's own (`setup.hiringDelayMonths`), else the default. */
  hiringBase: number = hiringDelayBase({ hiring_delay_months: setup.hiringDelayMonths }),
  /**
   * Each department's retainers in the first month of TODAY's path (`PlayOutcome.retainerAnchor` of today's outcome), in `setup.departments`
   * order: the levers' path's DLER moves from today's by its own retainers against these. Omitted: this run's own first month (today's path).
   */
  anchor?: readonly number[],
): PlayOutcome {
  const monthly = result.monthly;
  if (!monthly) throw new Error("playSeries: the run has no monthly series");
  const n = monthly.months.length;
  const range = Array.from({ length: n }, (_, i) => i);

  // Clients: each department's services added up, and everyone once (a client taking both is in both departments).
  const servicesOf = (deptId: string) => setup.services.filter((s) => s.department_id === deptId && s.tier_id).map((s) => s.id);
  const clientsOf = (sid: string, m: number) => mean(monthly.clients[sid]?.[m]);
  const deptClients = setup.departments.map((d) => ({ id: d.id, name: d.name, values: range.map((m) => servicesOf(d.id).reduce((s, sid) => s + clientsOf(sid, m), 0)) }));
  const both = uniqueClients(setup).both;
  const clients = range.map((m) => Math.max(0, deptClients.reduce((s, d) => s + d.values[m]!, 0) - both));

  // Retainers: the engine's total for the month, shared out by clients x the average fee of each service.
  const fee = new Map(
    setup.services.map((s) => {
      const count = tierCount(s.id, setup);
      const named = setup.clients.filter((c) => c.active && c.service_ids.includes(s.id));
      const total = named.reduce((a, c) => a + clientFee(setup, c), 0) + Math.max(0, count - named.length) * s.price;
      return [s.id, count > 0 ? total / count : s.price] as const;
    }),
  );
  const weight = (sid: string, m: number) => clientsOf(sid, m) * (fee.get(sid) ?? 0);
  const retainers = range.map((m) => mean(monthly.mrr[m]));
  const deptRetainers = deptClients.map((d) => ({
    id: d.id,
    values: range.map((m) => {
      const all = setup.departments.reduce((s, x) => s + servicesOf(x.id).reduce((a, sid) => a + weight(sid, m), 0), 0);
      const mine = servicesOf(d.id).reduce((a, sid) => a + weight(sid, m), 0);
      return all > 0 ? (retainers[m]! * mine) / all : 0;
    }),
  }));

  // DLER (D40): P5's `dler`, the average of each client-facing person's DLER, on the people there that month. A department's fees in month m are
  // today's (what the Overview and Capacity count) moved by the engine's change in that department's retainers since the first month, so with no
  // lever moved the first month's DLER is the Overview's (customisability audit 18). Hires take the department's average share.
  const today = dler(setup).departments;
  const newcomers = new Set(play.hires.map((_, i) => playChangeId("D1", i)));
  const retainerAnchor = deptRetainers.map((d) => d.values[0] ?? 0);
  const poolOf = (i: number, m: number) => {
    const first = anchor?.[i] ?? retainerAnchor[i]!;
    const growth = first > 0 ? deptRetainers[i]!.values[m]! / first : 1;
    return (today[i]?.retainers ?? 0) * growth;
  };
  const dlers = range.map((m) => dler(setupInMonth(setup, play, m), Object.fromEntries(setup.departments.map((d, i) => [d.id, poolOf(i, m)])), newcomers));
  const dlerWhole = dlers.map((x) => x.whole.ratio);
  const dlerDepts: PlayLine[] = setup.departments.map((d) => ({
    id: d.id,
    name: d.name,
    values: dlers.map((x) => x.departments.find((r) => r.departmentId === d.id)?.ratio ?? null),
  }));

  // Teams over their line, and when to hire (P5).
  // Stretched by the run's own market (the workspace's, or the Sandbox's market lever), as the Overview stretches it.
  const advice = hiringAdvice(setup, result, (m) => hiringDelayAt(model.market, m, hiringBase));

  // People and their lines (P5's busy shares for those in Set up; a hire is on its role's line).
  const known = busyShares(setup, model, result).people;
  const roleLine = new Map(setup.roles.map((r) => [r.id, r.line]));
  const people: PlayPersonSeries[] = Object.entries(monthly.people).map(([id, series]) => {
    const p = known.find((k) => k.id === id);
    const mp = model.people?.[id];
    return {
      id,
      name: p?.name ?? mp?.name ?? "New hire",
      line: p?.line ?? roleLine.get(mp?.roles[0] ?? "") ?? 0.85,
      roleId: p?.roleId ?? mp?.roles[0] ?? null,
      busy: range.map((m) => series[m]?.mean ?? null),
    };
  });

  const teams: PlayTeamLine[] = setup.roles
    .filter((r) => r.active !== false && monthly.roles[r.id])
    .map((r) => ({ id: r.id, name: r.name, line: r.line, values: range.map((m) => monthly.roles[r.id]![m]?.mean ?? null), p90: range.map((m) => monthly.roles[r.id]![m]?.p90 ?? null) }))
    .sort((a, b) => Math.max(0, ...b.values.map((v) => v ?? 0)) - Math.max(0, ...a.values.map((v) => v ?? 0)));

  const lostToPrice = result.churnCauses?.causes.find((c) => c.id === "price")?.clients ?? 0;
  return {
    clients,
    retainers,
    dler: dlerWhole,
    advice,
    people,
    charts: { clients: deptClients, retainers, dler: dlerDepts, dlerWhole, teams, won: range.map((m) => mean(monthly.clientsWon[m])), lost: range.map((m) => mean(monthly.clientsLost[m])), lostToPrice },

    retainerAnchor,
  };
}
