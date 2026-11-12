// How pay becomes cost (customisability audit 13, 19, 20, 21). Each rule starts at the value that leaves a model exactly as it ran
// before the field existed:
//
//   overtimePayFactor   an overtime hour costs the person's rate × this (1: the normal rate; 1.5: time and a half; 0: unpaid).
//   employerOnCosts     an employee's pay costs × (1 + this) (super, payroll tax, insurance); a contractor's never does. 0: none.
//   EnginePerson.paidFor  "contracted": paid for their contracted hours while on the team, leave included (everyone before this);
//                       "worked": paid only for the hours they work, up to their contracted hours, with no paid leave (overtime is
//                       still costed as overtime). Omitted: "worked" for a contractor, "contracted" for everyone else.
//
// Pure: simulate.ts, the issue detectors and the app read these, so a number is worked out one way everywhere.

import type { EngineModel, EnginePerson } from "./model";

/** An overtime hour at the normal rate: the default, and what every model ran at before the setting existed. */
export const DEFAULT_OVERTIME_PAY_FACTOR = 1;
/** No employer on-costs: the default, and what every model ran at before the setting existed. */
export const DEFAULT_EMPLOYER_ON_COSTS = 0;
/** The highest overtime multiple and on-cost share a model may carry (the Settings fields offer less). */
export const MAX_OVERTIME_PAY_FACTOR = 5;
export const MAX_EMPLOYER_ON_COSTS = 1;

export type PaidFor = "contracted" | "worked";

const bounded = (v: number | undefined, fallback: number, max: number): number => (v !== undefined && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : fallback);

/** × an overtime hour's normal rate. */
export function overtimePayFactor(model: Pick<EngineModel, "overtimePayFactor">): number {
  return bounded(model.overtimePayFactor, DEFAULT_OVERTIME_PAY_FACTOR, MAX_OVERTIME_PAY_FACTOR);
}

/** × a person's pay for employer on-costs: 1 + the model's share for an employee, exactly 1 for a contractor. */
export function onCostFactor(model: Pick<EngineModel, "employerOnCosts">, person: Pick<EnginePerson, "contractor"> | undefined): number {
  if (person?.contractor) return 1;
  return 1 + bounded(model.employerOnCosts, DEFAULT_EMPLOYER_ON_COSTS, MAX_EMPLOYER_ON_COSTS);
}

/** What a person is paid for: their own choice, else hours worked for a contractor and contracted hours for everyone else. */
export function paidFor(person: Pick<EnginePerson, "paidFor" | "contractor">): PaidFor {
  if (person.paidFor === "worked" || person.paidFor === "contracted") return person.paidFor;
  return person.contractor ? "worked" : "contracted";
}
