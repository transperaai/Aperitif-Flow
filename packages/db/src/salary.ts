// A person's effective monthly salary and the hourly cost it gives (role salaries, D73). Pure: callers decide what the viewer may see
// and pass only salaries they may use (a hidden one is null, never 0).

/** Weeks in a month, on average (52 weeks over 12 months). */
export const WEEKS_PER_MONTH = 52 / 12;

export interface SalaryPerson {
  /** Their own monthly salary; null or absent when not entered (or hidden). */
  salary_monthly?: number | string | null;
  fte: number | string;
  /** `contractor` never takes a role's salary: they keep their hourly cost rate. */
  label?: string | null;
}

const amount = (v: number | string | null | undefined): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * What a person is paid a month: their own salary when entered; else the mean of their roles' salaries that are entered (a full-time
 * person's) times their fte; else null. Contractors take no role salary. `roleSalaries` are the salaries of the roles they hold.
 */
export function effectiveMonthlySalary(person: SalaryPerson, roleSalaries: readonly (number | string | null | undefined)[]): number | null {
  const own = amount(person.salary_monthly);
  if (own !== null) return own;
  if (person.label === "contractor") return null;
  const set = roleSalaries.map(amount).filter((s): s is number => s !== null);
  if (!set.length) return null;
  const fte = Number(person.fte);
  if (!Number.isFinite(fte) || fte < 0) return null;
  return (set.reduce((a, b) => a + b, 0) / set.length) * fte;
}

/** A monthly salary as a cost per hour worked: salary ÷ (weekly hours × 52/12). Null when there are no hours to spread it over. */
export function hourlyCostFromSalary(monthly: number | null, weeklyHours: number): number | null {
  if (monthly === null || !(weeklyHours > 0)) return null;
  return monthly / (weeklyHours * WEEKS_PER_MONTH);
}
