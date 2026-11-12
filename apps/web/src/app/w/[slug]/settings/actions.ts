"use server";

import { refresh } from "next/cache";
import type { SaveOutcome } from "@/lib/fields/field-controller";
import { saveCapacityFactor, saveCapacityFactorSwitch, saveField, saveFields, saveLinks } from "@/lib/fields/server";
import { DEFAULT_PURPOSES, MAX_PURPOSE_DESCRIPTION, MAX_PURPOSE_NAME, MAX_PURPOSES, loadAnalysisRules, newPurposeKey, parsePurposes, saveAnalysisRules, type PurposeCategory } from "@transpera-flow/db";
import { assumptionValues, isAssumptionKey, validAssumption, withAssumption, type AssumptionKey } from "@/lib/analysis/assumptions";
import { horizonWeeks, isHorizonMonths, monthsForWeeks } from "@/lib/horizon";
import { isGrowth, isMonth, isMultiplier, parseLeadSourceField, parseNewLeadSource, type LeadSourceField } from "@/lib/demand";
import { parseNewRole, parseRoleField, type RoleField } from "@/lib/roles";
import {
  CLIENT_GROUP_FIELDS,
  isBenchmarkBound,
  isClientGroupField,
  newGroupDefaults,
  type ClientGroupField,
} from "@/lib/client-groups";
import { isTagList, parseNewService, parseServiceField, type ServiceField } from "@/lib/services";
import { jsonb, pgCode } from "@/app/action-db";
import { getDb, getSessionUser } from "@/lib/auth/session";

// Writes from the workspace settings page. Every write runs as the signed-in
// user through RLS; these checks only reject malformed input early.

type Scalar = string | number | boolean | null;
type Check = (v: unknown) => boolean;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
/** A real calendar day as YYYY-MM-DD: the shape alone lets through 2026-02-31, and Date.parse may roll it over to March. */
const isDate = (v: unknown): v is string => {
  if (typeof v !== "string" || !DATE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d));
  return day.getUTCFullYear() === y && day.getUTCMonth() === m - 1 && day.getUTCDate() === d;
};
const text: Check = (v) => typeof v === "string" && v.trim().length > 0 && v.length <= 200;
const optionalText: Check = (v) => v === null || (typeof v === "string" && v.length <= 2000);
const number: Check = (v) => typeof v === "number" && Number.isFinite(v);
const optionalNumber: Check = (v) => v === null || number(v);
const optionalDate: Check = (v) => v === null || isDate(v);
const boolean: Check = (v) => typeof v === "boolean";
/** A stored value to compare against: any number (the database may hold one outside what the form offers). */
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const PERSON_FIELDS = {
  name: text,
  email: optionalText,
  notes: optionalText,
  fte: number,
  capacity_hours_week: optionalNumber,
  cost_rate: optionalNumber,
  active: boolean,
  start_date: optionalDate,
  end_date: optionalDate,
} as const satisfies Record<string, Check>;

export type PersonField = keyof typeof PERSON_FIELDS;

const invalid = { status: "error", message: "That value isn't valid." } as const;
const isScalar = (v: unknown): v is Scalar => v === null || ["string", "number", "boolean"].includes(typeof v);

async function signedIn(): Promise<boolean> {
  return Boolean(await getSessionUser());
}

const signedOut = { status: "error", message: "Your session has ended. Sign in again." } as const;

export async function savePersonField(
  personId: string,
  field: PersonField,
  base: Scalar,
  value: Scalar,
): Promise<SaveOutcome<Scalar>> {
  const check: Check | undefined = Object.hasOwn(PERSON_FIELDS, field) ? PERSON_FIELDS[field] : undefined;
  if (!isId(personId) || !check || !check(value) || !isScalar(base)) return invalid;
  if (!(await signedIn())) return signedOut;
  return saveField("people", { id: personId }, field, base, typeof value === "string" ? value.trim() : value);
}

export async function savePersonSet(
  personId: string,
  workspaceId: string,
  set: "roles" | "skills",
  base: string[],
  next: string[],
): Promise<SaveOutcome<string[]>> {
  const ids = (v: unknown) => Array.isArray(v) && v.length <= 500 && v.every(isId);
  if (!isId(personId) || !isId(workspaceId) || !ids(base) || !ids(next)) return invalid;
  if (set !== "roles" && set !== "skills") return invalid;
  if (!(await signedIn())) return signedOut;
  return saveLinks(set === "roles" ? "person_roles" : "person_skills", { person_id: personId, workspace_id: workspaceId }, base, next);
}

/** Minimum share of each week left for pipeline work; null restores the default. */
export async function saveAvailabilityFloor(
  workspaceId: string,
  base: number | null,
  value: number | null,
): Promise<SaveOutcome<number | null>> {
  const fraction = (v: unknown) => v === null || (number(v) && (v as number) >= 0 && (v as number) < 1);
  if (!isId(workspaceId) || !fraction(value) || !isScalar(base)) return invalid;
  if (!(await signedIn())) return signedOut;
  return saveField("workspaces", { id: workspaceId }, "settings.availability_floor", base, value);
}

/**
 * Overtime someone may work when client work exceeds their week, as a share
 * of it (docs/PRD.md §6.3.4, decision D7); null restores the default (none).
 */
export async function saveOvertimeCap(workspaceId: string, base: number | null, value: number | null): Promise<SaveOutcome<number | null>> {
  const share = (v: unknown) => v === null || (number(v) && (v as number) >= 0 && (v as number) <= 1);
  if (!isId(workspaceId) || !share(value) || !isScalar(base)) return invalid;
  if (!(await signedIn())) return signedOut;
  return saveField("workspaces", { id: workspaceId }, "settings.overtime_cap", base, value);
}

/**
 * The normal working week in hours (above 0, at most 168: the rule the new-workspace form and `workspaces_hours_per_week` apply).
 * Required, so never null. Refreshes on a save: every figure that turns FTE into hours reads it.
 */
export async function saveHoursPerWeek(workspaceId: string, base: number | null, value: number | null): Promise<SaveOutcome<number | null>> {
  const hours = (v: unknown) => number(v) && (v as number) > 0 && (v as number) <= 168;
  if (!isId(workspaceId) || !hours(value) || !(base === null || isFiniteNumber(base))) return invalid;
  if (!(await signedIn())) return signedOut;
  const out = await saveField("workspaces", { id: workspaceId }, "settings.hours_per_week", base, value);
  if (out.status === "saved") refresh();
  return out;
}

/** Working days a week, 1 to 7 (`workspaces_working_days`); null restores the default of 5. */
export async function saveWorkingDays(workspaceId: string, base: number | null, value: number | null): Promise<SaveOutcome<number | null>> {
  const days = (v: unknown) => v === null || (number(v) && (v as number) >= 1 && (v as number) <= 7);
  if (!isId(workspaceId) || !days(value) || !(base === null || isFiniteNumber(base))) return invalid;
  if (!(await signedIn())) return signedOut;
  const out = await saveField("workspaces", { id: workspaceId }, "settings.working_days", base, value);
  if (out.status === "saved") refresh();
  return out;
}

/** Months from deciding to hire to the person starting, 0 to 24 (`workspaces_hiring_delay_months`); null clears it: `DEFAULT_HIRING_DELAY_MONTHS` for the hiring advice, no delay for scenario hires. */
export async function saveHiringDelay(workspaceId: string, base: number | null, value: number | null): Promise<SaveOutcome<number | null>> {
  const months = (v: unknown) => v === null || (number(v) && (v as number) >= 0 && (v as number) <= 24);
  if (!isId(workspaceId) || !months(value) || !(base === null || isFiniteNumber(base))) return invalid;
  if (!(await signedIn())) return signedOut;
  const out = await saveField("workspaces", { id: workspaceId }, "settings.hiring_delay_months", base, value);
  if (out.status === "saved") refresh();
  return out;
}

/**
 * What an overtime hour costs, as a multiple of the normal hourly rate (customisability audit 13 and 19): 0 (unpaid) to 5; null
 * restores the default (1, the normal rate). The database checks the same range (`workspaces_overtime_pay_factor`). Refreshes on a
 * save: the forecast's profit reads it.
 */
export async function saveOvertimePayFactor(workspaceId: string, base: number | null, value: number | null): Promise<SaveOutcome<number | null>> {
  const factor = (v: unknown) => v === null || (number(v) && (v as number) >= 0 && (v as number) <= 5);
  if (!isId(workspaceId) || !factor(value) || !(base === null || isFiniteNumber(base))) return invalid;
  if (!(await signedIn())) return signedOut;
  const out = await saveField("workspaces", { id: workspaceId }, "settings.overtime_pay_factor", base, value);
  if (out.status === "saved") refresh();
  return out;
}

/**
 * Employer on-costs (super, payroll tax, insurance) as a share of employees' pay (customisability audit 21): 0 to 1; null restores
 * the default (none). Contractors never carry them. The database checks the same range (`workspaces_employer_on_costs`). Refreshes
 * on a save: the forecast's profit reads it.
 */
export async function saveEmployerOnCosts(workspaceId: string, base: number | null, value: number | null): Promise<SaveOutcome<number | null>> {
  const share = (v: unknown) => v === null || (number(v) && (v as number) >= 0 && (v as number) <= 1);
  if (!isId(workspaceId) || !share(value) || !(base === null || isFiniteNumber(base))) return invalid;
  if (!(await signedIn())) return signedOut;
  const out = await saveField("workspaces", { id: workspaceId }, "settings.employer_on_costs", base, value);
  if (out.status === "saved") refresh();
  return out;
}

/**
 * Fixed costs a month (rent, tools, insurance), in the workspace currency (sandbox phase 2): a number from 0 to 100,000,000, or
 * null to remove it. The database checks the same range (`workspaces_overhead_monthly`). Refreshes on a save: the forecast reads it.
 */
export async function saveOverheadMonthly(workspaceId: string, base: number | null, value: number | null): Promise<SaveOutcome<number | null>> {
  const money = (v: unknown) => v === null || (number(v) && (v as number) >= 0 && (v as number) <= 100_000_000);
  if (!isId(workspaceId) || !money(value) || !(base === null || isFiniteNumber(base))) return invalid;
  if (!(await signedIn())) return signedOut;
  const out = await saveField("workspaces", { id: workspaceId }, "settings.overhead_monthly", base, value);
  if (out.status === "saved") refresh();
  return out;
}

export type PurposesOutcome =
  | { status: "saved"; purposes: PurposeCategory[] }
  /** Someone else saved the list since it was loaded; `theirs` is what is stored now (null: the defaults). */
  | { status: "conflict"; theirs: PurposeCategory[] | null }
  | { status: "not_found" }
  | { status: "error"; message: string };

/**
 * The workspace's purpose categories (sandbox phase 4), saved whole with a compare-and-set on the list as it was loaded (`base`; null
 * while the workspace has none and uses the defaults). The same check as the database's (`parsePurposes`, `private.is_purpose_list`).
 * Agency admins and the Owner; anyone else gets the database's refusal as a message. Refreshes on a save: the Sandbox and Overview read it.
 */
export async function savePurposes(workspaceId: string, base: PurposeCategory[] | null, value: unknown): Promise<PurposesOutcome> {
  const parsed = parsePurposes(value);
  if (!isId(workspaceId) || !(base === null || parsePurposes(base).ok)) return invalid;
  if (!parsed.ok) return { status: "error", message: parsed.error };
  if (!(await signedIn())) return signedOut;
  const out = await saveFields<PurposeCategory[] | null>("workspaces", { id: workspaceId }, { "settings.purposes": base }, { "settings.purposes": parsed.purposes });
  if (out.status === "saved") {
    refresh();
    return { status: "saved", purposes: parsed.purposes };
  }
  if (out.status === "conflict") return { status: "conflict", theirs: out.theirs["settings.purposes"] ?? null };
  return out;
}

export type AddPurposeOutcome =
  /** `key` is the new purpose's key: the editor sets the step's purpose with it. `purposes` is the list now stored. */
  | { status: "saved"; key: string; purposes: PurposeCategory[] }
  | Exclude<PurposesOutcome, { status: "saved" }>;

/**
 * Add one purpose to the workspace's list straight from the process editor ("+ New purpose…", editor brainstorm item 1). It is
 * `savePurposes` with the list as loaded (`base`; null while the workspace uses the defaults) plus one category at the end, so it has the
 * same compare-and-set (someone else's save in between is a conflict that returns theirs), the same permission (the database's, as
 * `can_edit_workspace`: Agency admins and the Owner; anyone else is refused) and the same limits: 12 purposes at most, a name of 1 to 60
 * characters that no other purpose has, a description of at most 200. It makes no step edit: the editor sets the step's purpose with
 * the key it gets back. Refreshes on a save, like `savePurposes`.
 */
export async function addPurpose(workspaceId: string, base: PurposeCategory[] | null, input: { name: string; description?: string }): Promise<AddPurposeOutcome> {
  const current = base === null ? DEFAULT_PURPOSES.map((c) => ({ ...c })) : parsePurposes(base).ok ? base : null;
  if (!isId(workspaceId) || !current || !input || typeof input.name !== "string" || !(input.description === undefined || typeof input.description === "string")) return invalid;
  const name = input.name.trim();
  const description = (input.description ?? "").trim();
  if (!name || [...name].length > MAX_PURPOSE_NAME) return { status: "error", message: `A purpose's name is 1 to ${MAX_PURPOSE_NAME} characters.` };
  if ([...description].length > MAX_PURPOSE_DESCRIPTION) return { status: "error", message: `A description is at most ${MAX_PURPOSE_DESCRIPTION} characters.` };
  if (current.length >= MAX_PURPOSES) return { status: "error", message: `A workspace can have at most ${MAX_PURPOSES} purposes. Remove one in Settings first.` };
  if (current.some((c) => c.name.trim().toLowerCase() === name.toLowerCase())) return { status: "error", message: `There is already a purpose called "${name}".` };
  const key = newPurposeKey(current.map((c) => c.key));
  const out = await savePurposes(workspaceId, base, [...current, { key, name, description }]);
  return out.status === "saved" ? { status: "saved", key, purposes: out.purposes } : out;
}

/**
 * Switch Per-person times (C6). Agency admins (a dedicated function writes only this key). Refreshes on a save, because the
 * page shows or hides the per-person fields.
 */
export async function saveCapacityFactorsEnabled(workspaceId: string, base: boolean | null, value: boolean): Promise<SaveOutcome<boolean>> {
  if (!isId(workspaceId) || typeof value !== "boolean" || !(base === null || typeof base === "boolean")) return invalid;
  if (!(await signedIn())) return signedOut;
  const outcome = await saveCapacityFactorSwitch(workspaceId, base, value);
  if (outcome.status === "saved") refresh();
  return outcome;
}

/** One person's time on one step (`stepId` null: every step they do), from 0.5 to 2 to two decimals; null removes it (C6). */
export async function savePersonCapacityFactor(
  personId: string,
  stepId: string | null,
  base: number | null,
  value: number | null,
): Promise<SaveOutcome<number | null>> {
  const inRange = (v: unknown) => v === null || (number(v) && (v as number) >= 0.5 && (v as number) <= 2);
  if (!isId(personId) || !(stepId === null || isId(stepId)) || !inRange(value) || !(base === null || isFiniteNumber(base))) return invalid;
  if (!(await signedIn())) return signedOut;
  const outcome = await saveCapacityFactor(personId, stepId, base, value === null ? null : Math.round(value * 100) / 100);
  // The page's other fields and its "Not used now" list read what is stored, so a save or a conflict (someone else's value) refreshes it.
  if (outcome.status === "saved" || outcome.status === "conflict") refresh();
  return outcome;
}

/**
 * A service's fallback ongoing load for one role: hours a month per client
 * while no servicing process is mapped (docs/PRD.md §6.3.4). Null clears it.
 */
export async function saveServiceFallback(
  serviceId: string,
  roleId: string,
  base: number | null,
  value: number | null,
): Promise<SaveOutcome<number | null>> {
  const hours = (v: unknown) => v === null || (number(v) && (v as number) >= 0 && (v as number) <= 1000);
  if (!isId(serviceId) || !isId(roleId) || !hours(value) || !(base === null || isFiniteNumber(base))) return invalid;
  if (!(await signedIn())) return signedOut;
  return saveField("services", { id: serviceId }, `fallback_ongoing_load.${roleId}`, base, value);
}

/**
 * One number of a service's client group (issue #120): how many clients nobody's portfolio holds, or their starting health. A
 * service with no group yet gets one on its first edit. The fee, churn and stay of a tier's counted clients are the tier's own
 * (services), so no copy of them is written here.
 */
export async function saveClientGroupField(
  workspaceId: string,
  serviceId: string,
  field: ClientGroupField,
  base: number | null,
  value: number | null,
): Promise<SaveOutcome<number | null>> {
  if (!isId(workspaceId) || !isId(serviceId) || !isClientGroupField(field) || value === null || !CLIENT_GROUP_FIELDS[field](value)) return invalid;
  if (!(base === null || isFiniteNumber(base))) return invalid;
  if (!(await signedIn())) return signedOut;
  const db = await getDb();
  let existing;
  try {
    existing = await db.selectFrom("client_groups").select("id").where("service_id", "=", serviceId).executeTakeFirst();
  } catch {
    return { status: "error", message: "Couldn't save. Try again." };
  }
  if (existing) return saveField("client_groups", { service_id: serviceId }, field, base, value);
  const service = await db
    .selectFrom("services")
    .select(["id", "tier_id"])
    .where("id", "=", serviceId)
    .where("workspace_id", "=", workspaceId)
    .executeTakeFirst()
    .catch(() => undefined);
  if (!service) return { status: "not_found" };
  const ws = await db.selectFrom("workspaces").select("settings").where("id", "=", workspaceId).executeTakeFirst().catch(() => undefined);
  if (!ws) return { status: "not_found" };
  // Counted clients are set up on a tier, whose fee, churn and stay they take. A service that isn't a tier would bill and churn at
  // the group row's own columns, which this screen no longer writes, so it is refused rather than given a fee and churn of 0.
  if (service.tier_id === null) return { status: "error", message: "Counted clients belong to a tier. Add them on a tier's row." };
  try {
    await db
      .insertInto("client_groups")
      .values({ workspace_id: workspaceId, service_id: serviceId, ...newGroupDefaults((ws.settings ?? {}) as { health_initial?: number | null }), [field]: value })
      .execute();
  } catch (e) {
    const code = pgCode(e);
    // Someone set this group up a moment ago: ask for a fresh look rather than overwrite them.
    if (code === "23505") return { status: "error", message: "Someone just set this up. Reload to see it." };
    return { status: "error", message: code === "42501" ? "You don't have permission to change this." : "Couldn't save. Try again." };
  }
  return { status: "saved", value };
}

/** One end of the client-health benchmark the People page compares against (0 to 100); null clears it. */
export async function saveClientHealthBenchmark(
  workspaceId: string,
  bound: "low" | "high",
  base: number | null,
  value: number | null,
): Promise<SaveOutcome<number | null>> {
  if (!isId(workspaceId) || (bound !== "low" && bound !== "high") || !isBenchmarkBound(value) || !(base === null || isFiniteNumber(base))) return invalid;
  if (!(await signedIn())) return signedOut;
  return saveField("workspaces", { id: workspaceId }, `settings.client_health_benchmark_${bound}`, base, value);
}

export interface ActionResult {
  error?: string;
}

const failure = (e: unknown): ActionResult =>
  pgCode(e) === "42501"
    ? { error: "You don't have permission to do that." }
    : pgCode(e) === "23514"
      ? { error: "Some of those values aren't allowed." }
      : { error: "Couldn't save. Try again." };

export async function createPerson(workspaceId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  const name = String(form.get("name") ?? "").trim();
  const roleId = String(form.get("role_id") ?? "");
  if (!isId(workspaceId) || !text(name)) return { error: "Enter a name." };
  if (roleId && !isId(roleId)) return { error: "Pick a role." };
  const db = await getDb();
  let person;
  try {
    person = await db.insertInto("people").values({ workspace_id: workspaceId, name }).returning("id").executeTakeFirstOrThrow();
  } catch (e) {
    return failure(e);
  }
  if (roleId) {
    try {
      await db.insertInto("person_roles").values({ person_id: person.id, role_id: roleId, workspace_id: workspaceId }).execute();
    } catch (e) {
      return failure(e);
    }
  }
  refresh();
  return {};
}

export async function addLeave(
  personId: string,
  workspaceId: string,
  _prev: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const start = String(form.get("start_date") ?? "");
  const end = String(form.get("end_date") ?? "") || start;
  const note = String(form.get("note") ?? "").trim() || null;
  if (!isId(personId) || !isId(workspaceId)) return { error: "Couldn't save. Try again." };
  if (!isDate(start) || !isDate(end)) return { error: "Enter the first and last day." };
  if (end < start) return { error: "The last day must be on or after the first." };
  const db = await getDb();
  try {
    await db.insertInto("person_leave").values({ person_id: personId, workspace_id: workspaceId, start_date: start, end_date: end, note }).execute();
  } catch (e) {
    return failure(e);
  }
  refresh();
  return {};
}

export async function removeLeave(leaveId: string): Promise<ActionResult> {
  if (!isId(leaveId)) return { error: "Couldn't remove it. Try again." };
  const db = await getDb();
  let data;
  try {
    data = await db.deleteFrom("person_leave").where("id", "=", leaveId).returning("id").execute();
  } catch (e) {
    return failure(e);
  }
  if (!data.length) return { error: "That leave was already removed, or you can't edit it." };
  refresh();
  return {};
}

// Services (issue #12). Agency admins manage them; RLS enforces that.

export async function saveServiceField(
  serviceId: string,
  field: ServiceField,
  base: Scalar,
  value: Scalar,
): Promise<SaveOutcome<Scalar>> {
  const parsed = parseServiceField(serviceId, field, base, value);
  if (!parsed) return invalid;
  if (!(await signedIn())) return signedOut;
  return saveField("services", { id: parsed.serviceId }, parsed.field, parsed.base, parsed.value);
}

/** A service's path tags, saved as one list. */
export async function saveServiceTags(serviceId: string, base: string[], next: string[]): Promise<SaveOutcome<string[]>> {
  if (!isId(serviceId) || !isTagList(base) || !isTagList(next)) return invalid;
  if (!(await signedIn())) return signedOut;
  return saveField<string[]>("services", { id: serviceId }, "path_tags", base, next);
}

export async function createService(workspaceId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  if (!isId(workspaceId)) return { error: "Couldn't save. Try again." };
  const service = parseNewService(form);
  if ("error" in service) return service;
  const db = await getDb();
  // The first service takes every arrival; later ones start at a share of 0,
  // so adding one doesn't change the simulation until its share is set.
  let count: number;
  try {
    const counted = await db.selectFrom("services").select((eb) => eb.fn.countAll<number>().as("count")).where("workspace_id", "=", workspaceId).executeTakeFirstOrThrow();
    count = Number(counted.count);
  } catch (e) {
    return failure(e);
  }
  // The churn sensitivity starts at the PRD's estimated default (§6.3.5), so it is marked as an
  // estimate (the robustness check perturbs it, issue #79) rather than stamped entered.
  const provenance = { churn_health_sensitivity: { source: "estimated", at: new Date().toISOString(), note: "Default" } };
  try {
    await db.insertInto("services").values({ workspace_id: workspaceId, ...service, mix_share: count ? 0 : 1, provenance: jsonb(provenance) }).execute();
  } catch (e) {
    return failure(e);
  }
  refresh();
  return {};
}

export async function removeService(serviceId: string): Promise<ActionResult> {
  if (!isId(serviceId)) return { error: "Couldn't remove it. Try again." };
  const db = await getDb();
  let data;
  try {
    data = await db.deleteFrom("services").where("id", "=", serviceId).returning("id").execute();
  } catch (e) {
    return failure(e);
  }
  if (!data.length) return { error: "That service was already removed, or you can't edit it." };
  refresh();
  return {};
}

// Roles (issue #88). Agency admins manage them; RLS enforces that.

export async function saveRoleField(roleId: string, field: RoleField, base: Scalar, value: Scalar): Promise<SaveOutcome<Scalar>> {
  const parsed = parseRoleField(roleId, field, base, value);
  if (!parsed) return invalid;
  if (!(await signedIn())) return signedOut;
  const outcome = await saveField("roles", { id: parsed.roleId }, parsed.field, parsed.base, parsed.value);
  // People and service labels use role names.
  if (outcome.status === "saved") refresh();
  return outcome;
}

export async function createRole(workspaceId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  if (!isId(workspaceId)) return { error: "Couldn't save. Try again." };
  const role = parseNewRole(form);
  if ("error" in role) return role;
  const db = await getDb();
  try {
    await db.insertInto("roles").values({ workspace_id: workspaceId, name: role.name }).execute();
  } catch (e) {
    return pgCode(e) === "23505" ? { error: `There is already a role called '${role.name}'.` } : failure(e);
  }
  refresh();
  return {};
}

export async function removeRole(roleId: string): Promise<ActionResult> {
  if (!isId(roleId)) return { error: "Couldn't remove it. Try again." };
  const db = await getDb();
  let data;
  try {
    data = await db.deleteFrom("roles").where("id", "=", roleId).returning("id").execute();
  } catch (e) {
    return pgCode(e) === "23503" ? { error: "That role is still used by steps, people, clients or a service's fallback load. Make it inactive instead." } : failure(e);
  }
  if (!data.length) return { error: "That role was already removed, or you can't edit it." };
  refresh();
  return {};
}

// Demand (issue #13): lead sources, seasonality and growth. Agency admins
// manage them; RLS enforces that. Changing a value makes its provenance
// `entered` (a database trigger), and each save refreshes the page so the
// totals and provenance shown catch up.

export async function saveLeadSourceField(
  sourceId: string,
  field: LeadSourceField,
  base: Scalar,
  value: Scalar,
): Promise<SaveOutcome<Scalar>> {
  const parsed = parseLeadSourceField(sourceId, field, base, value);
  if (!parsed) return invalid;
  if (!(await signedIn())) return signedOut;
  const outcome = await saveField("lead_sources", { id: parsed.sourceId }, parsed.field, parsed.base, parsed.value);
  if (outcome.status === "saved") refresh();
  return outcome;
}

export async function createLeadSource(workspaceId: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  if (!isId(workspaceId)) return { error: "Couldn't save. Try again." };
  const source = parseNewLeadSource(form);
  if ("error" in source) return source;
  const db = await getDb();
  try {
    await db.insertInto("lead_sources").values({ workspace_id: workspaceId, ...source }).execute();
  } catch (e) {
    return failure(e);
  }
  refresh();
  return {};
}

export async function removeLeadSource(sourceId: string): Promise<ActionResult> {
  if (!isId(sourceId)) return { error: "Couldn't remove it. Try again." };
  const db = await getDb();
  let data;
  try {
    data = await db.deleteFrom("lead_sources").where("id", "=", sourceId).returning("id").execute();
  } catch (e) {
    return failure(e);
  }
  if (!data.length) return { error: "That lead source was already removed, or you can't edit it." };
  refresh();
  return {};
}

/**
 * Save a value held in a row that may not exist yet: a month of the
 * seasonality curve (no row means 1) or the growth (no row means 0). With no
 * row the stored value is that default, so compare-and-set still holds: a
 * base equal to it inserts the row, any other base is a conflict (someone
 * reset it). An insert that loses a race to another one saves against it.
 */
async function saveOrInsert(
  save: () => Promise<SaveOutcome<number>>,
  insert: () => Promise<unknown>,
  fallback: number,
  base: number,
  value: number,
): Promise<SaveOutcome<number>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const outcome = await save();
    if (outcome.status !== "not_found") return outcome;
    if (base !== fallback) return { status: "conflict", theirs: fallback };
    try {
      await insert();
      return { status: "saved", value };
    } catch (e) {
      const code = pgCode(e);
      // A viewer, or a workspace the user can't edit: as for an update.
      if (code === "42501") return { status: "not_found" };
      // 23505: another insert got there first; loop to save against it.
      if (code !== "23505") return { status: "error", message: "Couldn't save. Try again." };
    }
  }
  return { status: "error", message: "Couldn't save. Try again." };
}

/** One month's seasonality multiplier (1 = January). */
export async function saveSeasonality(
  workspaceId: string,
  month: number,
  base: number | null,
  value: number | null,
): Promise<SaveOutcome<number | null>> {
  if (!isId(workspaceId) || !isMonth(month) || !isFiniteNumber(base) || !isMultiplier(value)) return invalid;
  if (!(await signedIn())) return signedOut;
  const db = await getDb();
  const outcome = await saveOrInsert(
    () => saveField<number>("seasonality", { workspace_id: workspaceId, month: String(month) }, "multiplier", base, value),
    () => db.insertInto("seasonality").values({ workspace_id: workspaceId, month, multiplier: value }).execute(),
    1,
    base,
    value,
  );
  if (outcome.status === "saved") refresh();
  return outcome;
}

/** Remove the seasonality curve: every month back to 1. */
export async function resetSeasonality(workspaceId: string): Promise<ActionResult> {
  if (!isId(workspaceId)) return { error: "Couldn't reset it. Try again." };
  const db = await getDb();
  try {
    await db.deleteFrom("seasonality").where("workspace_id", "=", workspaceId).execute();
  } catch (e) {
    return failure(e);
  }
  refresh();
  return {};
}

/** Monthly growth in demand, as a fraction (0.02 is +2% a month). */
export async function saveGrowth(workspaceId: string, base: number | null, value: number | null): Promise<SaveOutcome<number | null>> {
  if (!isId(workspaceId) || !isFiniteNumber(base) || !isGrowth(value)) return invalid;
  if (!(await signedIn())) return signedOut;
  const db = await getDb();
  const outcome = await saveOrInsert(
    () => saveField<number>("demand_settings", { workspace_id: workspaceId }, "growth_monthly", base, value),
    () => db.insertInto("demand_settings").values({ workspace_id: workspaceId, growth_monthly: value }).execute(),
    0,
    base,
    value,
  );
  if (outcome.status === "saved") refresh();
  return outcome;
}

/**
 * The DLER the agency aims for (`settings.dler_goal`, customisability audit 3 and 12): more than 0 and at most 50, or null for the
 * default (4.5). The database checks the same range (`workspaces_dler_goal`). Refreshes: the Overview, Capacity and the Sandbox read it.
 */
export async function saveDlerGoal(workspaceId: string, base: number | null, value: number | null): Promise<SaveOutcome<number | null>> {
  const goal = (v: unknown) => v === null || (number(v) && (v as number) > 0 && (v as number) <= 50);
  if (!isId(workspaceId) || !goal(value) || !(base === null || isFiniteNumber(base))) return invalid;
  if (!(await signedIn())) return signedOut;
  const out = await saveField("workspaces", { id: workspaceId }, "settings.dler_goal", base, value);
  if (out.status === "saved") refresh();
  return out;
}

/**
 * How far under their own utilisation threshold someone counts as at risk (`settings.at_risk_margin`, customisability audit 48): a share
 * from 0 to 0.5, or null for the default (0.1). The database checks the same range (`workspaces_at_risk_margin`).
 */
export async function saveAtRiskMargin(workspaceId: string, base: number | null, value: number | null): Promise<SaveOutcome<number | null>> {
  const share = (v: unknown) => v === null || (number(v) && (v as number) >= 0 && (v as number) <= 0.5);
  if (!isId(workspaceId) || !share(value) || !(base === null || isFiniteNumber(base))) return invalid;
  if (!(await signedIn())) return signedOut;
  const out = await saveField("workspaces", { id: workspaceId }, "settings.at_risk_margin", base, value);
  if (out.status === "saved") refresh();
  return out;
}

/**
 * The workspace's default forecast length (`settings.horizon_weeks`, customisability audit 50): one of the horizon picker's lengths in
 * months (1, 3, 6, 12 or 24), stored in weeks. `base` is the stored weeks. Until now only the new-workspace form set it.
 */
export async function saveForecastLength(workspaceId: string, baseWeeks: number | null, months: string | null): Promise<SaveOutcome<string | null>> {
  const m = months === null ? NaN : Number(months);
  if (!isId(workspaceId) || !isHorizonMonths(m) || !(baseWeeks === null || isFiniteNumber(baseWeeks))) return invalid;
  if (!(await signedIn())) return signedOut;
  const out = await saveField("workspaces", { id: workspaceId }, "settings.horizon_weeks", baseWeeks, horizonWeeks(m));
  if (out.status === "saved") {
    refresh();
    return { status: "saved", value: String(m) };
  }
  if (out.status === "conflict") return { status: "conflict", theirs: typeof out.theirs === "number" ? String(monthsForWeeks(out.theirs) ?? "") || null : null };
  return out;
}

/**
 * One analysis assumption (customisability audit 32 and 45): a lost client's value cap, the absence test, or a busy band, in the
 * workspace's stored analysis settings. `base` is the value the field showed; when someone has saved another since, they are asked.
 */
export async function saveAnalysisAssumption(workspaceId: string, key: AssumptionKey, base: number | null, value: number | null): Promise<SaveOutcome<number | null>> {
  if (!isId(workspaceId) || !isAssumptionKey(key) || !(base === null || isFiniteNumber(base)) || !(value === null || validAssumption(key, value))) return invalid;
  if (!(await signedIn())) return signedOut;
  const db = await getDb();
  let current;
  try {
    current = await loadAnalysisRules(db, workspaceId);
  } catch {
    return { status: "error", message: "Couldn't save. Try again." };
  }
  const stored = assumptionValues(current.settings)[key];
  if (base !== null && Math.abs(base - stored) > 1e-9) return { status: "conflict", theirs: stored };
  const out = await saveAnalysisRules(db, workspaceId, withAssumption(current.settings, key, value), current.version);
  if (out.status === "saved") {
    refresh();
    return { status: "saved", value: assumptionValues(out.rules.settings)[key] };
  }
  if (out.status === "conflict") return { status: "conflict", theirs: assumptionValues(out.rules.settings)[key] };
  if (out.status === "forbidden") return { status: "error", message: "Only Agency admins can change this." };
  if (out.status === "invalid") return invalid;
  return out;
}
