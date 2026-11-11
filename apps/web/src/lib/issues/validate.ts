// Input checks behind the issue Server Actions (app/w/[slug]/issue-actions.ts)
// and the in-memory demo store. They only reject malformed input early: the
// database checks every enumerated column again, and RLS decides who may write.

import { ISSUE_STATUSES, RESOLVE_HOWS, type IssueLinkRef, type IssueStatus, type ResolveHow } from "@transpera-flow/db";
import { ISSUE_TYPES, STORED_SEVERITIES, type IssueType, type StoredSeverity } from "@transpera-flow/engine";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Same shape as the table's check: <detector>:<subject kind>:<id>. */
const DETECTED_KEY = /^[a-z_]+:[a-z_]+:\S{1,200}$/;

export { ISSUE_STATUSES };
/** The status a person can give an issue: the four visible ones. `dismissed` is only ever written for a dismissed insight. */
export const MAX_TITLE = 200;
export const MAX_EVIDENCE = 5000;
const MAX_METRICS = 50;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const optionalId = (v: unknown) => v === undefined || v === null || isId(v);
const isType = (v: unknown): v is IssueType => (ISSUE_TYPES as readonly unknown[]).includes(v);
/** The stored severity values: the four ratings, as the database keeps them (see `ratingOfStored`). */
const isSeverity = (v: unknown): v is StoredSeverity => (STORED_SEVERITIES as readonly unknown[]).includes(v);
const isStatus = (v: unknown): v is (typeof ISSUE_STATUSES)[number] => (ISSUE_STATUSES as readonly unknown[]).includes(v);
const isTitle = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.trim().length <= MAX_TITLE;
const isEvidence = (v: unknown) => v === null || (typeof v === "string" && v.length <= MAX_EVIDENCE);

/** Links an issue can carry (all optional). */
const LINKS = ["process_id", "step_id", "role_id", "person_id", "owner_person_id", "scenario_id"] as const;
type Links = Record<(typeof LINKS)[number], string | null>;

/** A manually logged issue: what the "Log an issue" form sends. */
export interface IssueInput extends Links {
  type: IssueType;
  severity: StoredSeverity;
  title: string;
  evidence: string | null;
  status: IssueStatus;
}

/** A detection to track: the detected issue's fields and its key. */
export interface PromoteInput extends Links {
  detected_key: string;
  type: IssueType;
  severity: StoredSeverity;
  title: string;
  evidence: string | null;
  evidence_metrics: Record<string, number>;
  /** The client it is about: a churn risk (issue #19). */
  client_id?: string | null;
  /** Tracked as dismissed in one write (an insight someone dismissed); omitted means open. */
  status?: "open" | "dismissed";
  /** With `dismissed`: the live revision of the process it was dismissed against; the dismissal lasts until that changes. */
  dismissed_revision_id?: string | null;
}

const object = (input: unknown): Record<string, unknown> | null =>
  typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : null;

function links(o: Record<string, unknown>): Links | null {
  const out = {} as Links;
  for (const k of LINKS) {
    if (!optionalId(o[k])) return null;
    out[k] = (o[k] as string | null | undefined) ?? null;
  }
  return out;
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function parseIssueInput(input: unknown): Parsed<IssueInput> {
  const o = object(input);
  if (!o) return { ok: false, error: "That issue isn't valid." };
  if (!isTitle(o.title)) return { ok: false, error: `Give the issue a title of up to ${MAX_TITLE} characters.` };
  if (!isType(o.type)) return { ok: false, error: "Pick a type." };
  if (!isSeverity(o.severity)) return { ok: false, error: "Pick a rating." };
  const status = o.status ?? "open";
  if (!isStatus(status)) return { ok: false, error: "Pick a status." };
  const evidence = o.evidence === undefined ? null : o.evidence;
  if (!isEvidence(evidence)) return { ok: false, error: `Keep the evidence to ${MAX_EVIDENCE} characters.` };
  const l = links(o);
  if (!l) return { ok: false, error: "That issue links to something that isn't valid." };
  return { ok: true, value: { ...l, type: o.type, severity: o.severity, title: o.title.trim(), evidence: text(evidence), status } };
}

/** What the Acknowledge dialog sends: a new issue (no `id`) or the edit of one (with its `id`), with what it touches. */
export interface SaveIssueInput {
  /** Set to edit that issue; omit to create. */
  id?: string;
  title: string;
  severity: StoredSeverity;
  /** A new issue's type; omitted, an issue logged by hand is an audit finding (`manual`). Ignored when editing. */
  type?: IssueType;
  evidence?: string | null;
  /** Only when editing and changing it. */
  status?: IssueStatus;
  target_measure: string | null;
  target_now: string | null;
  target_goal: string | null;
  /** What it touches: steps (by stable id), or one link with no step for the whole process. */
  links: IssueLinkRef[];
  owner_ids: string[];
  source_ids: string[];
  /** Acknowledging an insight: the detection it came from. New issues only. */
  from?: {
    detected_key: string;
    evidence_metrics: Record<string, number>;
    role_id: string | null;
    person_id: string | null;
    client_id: string | null;
    scenario_id: string | null;
  };
}

export const MAX_TARGET = 200;
const MAX_LINKS = 200;
const MAX_OWNERS = 20;
const MAX_SOURCES = 50;

const idList = (v: unknown, max: number): string[] | null => {
  if (!Array.isArray(v) || v.length > max || !v.every(isId)) return null;
  return [...new Set(v as string[])];
};
const targetText = (v: unknown): string | null | undefined => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || v.trim().length > MAX_TARGET) return undefined;
  return v.trim() || null;
};

export function parseSaveInput(input: unknown): Parsed<SaveIssueInput> {
  const o = object(input);
  if (!o) return { ok: false, error: "That issue isn't valid." };
  if (!optionalId(o.id)) return { ok: false, error: "That issue isn't valid." };
  if (!isTitle(o.title)) return { ok: false, error: `Give the issue a title of up to ${MAX_TITLE} characters.` };
  if (!isSeverity(o.severity)) return { ok: false, error: "Pick how bad it is." };
  if (o.type !== undefined && !isType(o.type)) return { ok: false, error: "Pick a type." };
  if (o.status !== undefined && !isStatus(o.status)) return { ok: false, error: "Pick a status." };
  const evidence = o.evidence === undefined ? null : o.evidence;
  if (!isEvidence(evidence)) return { ok: false, error: `Keep the evidence to ${MAX_EVIDENCE} characters.` };
  const [measure, now, goal] = [targetText(o.target_measure), targetText(o.target_now), targetText(o.target_goal)];
  if (measure === undefined || now === undefined || goal === undefined) return { ok: false, error: `Keep each target to ${MAX_TARGET} characters.` };
  const rawLinks = o.links;
  if (!Array.isArray(rawLinks) || rawLinks.length > MAX_LINKS) return { ok: false, error: "That issue links to something that isn't valid." };
  const links: IssueLinkRef[] = [];
  for (const raw of rawLinks) {
    const l = object(raw);
    if (!l || !optionalId(l.process_id) || !optionalId(l.step_id)) return { ok: false, error: "That issue links to something that isn't valid." };
    const link = { process_id: (l.process_id as string | null | undefined) ?? null, step_id: (l.step_id as string | null | undefined) ?? null };
    if (!link.process_id && !link.step_id) return { ok: false, error: "That issue links to something that isn't valid." };
    if (!links.some((x) => x.process_id === link.process_id && x.step_id === link.step_id)) links.push(link);
  }
  // Steps, or the whole process: not both, and not nothing.
  if (links.length === 0) return { ok: false, error: "Pick at least one step, or choose the whole process." };
  if (links.some((l) => !l.step_id) && links.some((l) => l.step_id)) return { ok: false, error: "Choose the whole process, or pick steps, not both." };
  const owners = idList(o.owner_ids ?? [], MAX_OWNERS);
  const sources = idList(o.source_ids ?? [], MAX_SOURCES);
  if (!owners || !sources) return { ok: false, error: "That issue links to something that isn't valid." };
  let from: SaveIssueInput["from"];
  if (o.from !== undefined) {
    const f = object(o.from);
    const metrics = f ? object(f.evidence_metrics ?? {}) : null;
    if (
      !f ||
      typeof f.detected_key !== "string" ||
      !DETECTED_KEY.test(f.detected_key) ||
      !metrics ||
      Object.keys(metrics).length > MAX_METRICS ||
      !Object.entries(metrics).every(([k, v]) => k.length <= 60 && typeof v === "number" && Number.isFinite(v)) ||
      !optionalId(f.role_id) ||
      !optionalId(f.person_id) ||
      !optionalId(f.client_id) ||
      !optionalId(f.scenario_id)
    ) {
      return { ok: false, error: "That detected issue isn't valid." };
    }
    from = {
      detected_key: f.detected_key,
      evidence_metrics: metrics as Record<string, number>,
      role_id: (f.role_id as string | null | undefined) ?? null,
      person_id: (f.person_id as string | null | undefined) ?? null,
      client_id: (f.client_id as string | null | undefined) ?? null,
      scenario_id: (f.scenario_id as string | null | undefined) ?? null,
    };
  }
  return {
    ok: true,
    value: {
      ...(o.id ? { id: o.id as string } : {}),
      title: o.title.trim(),
      severity: o.severity,
      ...(o.type ? { type: o.type } : {}),
      evidence: text(evidence),
      ...(o.status ? { status: o.status } : {}),
      target_measure: measure,
      target_now: now,
      target_goal: goal,
      links,
      owner_ids: owners,
      source_ids: sources,
      ...(from ? { from } : {}),
    },
  };
}

export function parsePromoteInput(input: unknown): Parsed<PromoteInput> {
  const o = object(input);
  if (!o || typeof o.detected_key !== "string" || !DETECTED_KEY.test(o.detected_key)) return { ok: false, error: "That detected issue isn't valid." };
  const base = parseIssueInput({ ...o, status: "open", owner_person_id: o.owner_person_id ?? null });
  if (!base.ok) return base;
  const metrics = object(o.evidence_metrics ?? {});
  if (
    !metrics ||
    Object.keys(metrics).length > MAX_METRICS ||
    !Object.entries(metrics).every(([k, v]) => k.length <= 60 && typeof v === "number" && Number.isFinite(v))
  ) {
    return { ok: false, error: "That detected issue isn't valid." };
  }
  if (!optionalId(o.client_id) || !optionalId(o.dismissed_revision_id)) return { ok: false, error: "That detected issue isn't valid." };
  // A tracked detection starts open, or dismissed when that is what the person chose; nothing else.
  if (o.status !== undefined && o.status !== "open" && o.status !== "dismissed") return { ok: false, error: "That detected issue isn't valid." };
  const rest: Partial<IssueInput> = { ...base.value };
  delete rest.status;
  return {
    ok: true,
    value: {
      ...(rest as Omit<IssueInput, "status">),
      detected_key: o.detected_key,
      status: o.status === "dismissed" ? "dismissed" : "open",
      evidence_metrics: metrics as Record<string, number>,
      ...(o.client_id ? { client_id: o.client_id as string } : {}),
      ...(o.status === "dismissed" && o.dismissed_revision_id ? { dismissed_revision_id: o.dismissed_revision_id as string } : {}),
    },
  };
}

/** Fields edited one at a time (save_fields), and what each accepts. */
export const ISSUE_FIELDS = {
  title: isTitle,
  type: isType,
  severity: isSeverity,
  status: isStatus,
  evidence: isEvidence,
  role_id: optionalId,
  person_id: optionalId,
  scenario_id: optionalId,
} as const satisfies Record<string, (v: unknown) => boolean>;

export type IssueField = keyof typeof ISSUE_FIELDS;
export type Scalar = string | number | boolean | null;

export const isIssueField = (f: unknown): f is IssueField => typeof f === "string" && Object.hasOwn(ISSUE_FIELDS, f);

/** A new value for one field, cleaned (titles trimmed, blank evidence as null), or null if invalid. */
export function cleanFieldValue(field: IssueField, value: unknown): { value: Scalar } | null {
  const v = typeof value === "string" ? (field === "title" ? value.trim() : value.trim() || null) : value;
  if (v !== null && typeof v !== "string") return null;
  return (ISSUE_FIELDS[field] as (x: unknown) => boolean)(v) ? { value: v } : null;
}

export const MAX_NOTE = 2000;

/** What the Resolve dialog sends: how it was resolved, and a note (optional). */
export interface ResolveInput {
  how: ResolveHow;
  note: string | null;
  /** The solution that fixed it (A50): only with "A solution fixed it", and only one linked to the issue (the database checks). */
  solutionId: string | null;
}

export function parseResolveInput(input: unknown): Parsed<ResolveInput> {
  const o = object(input);
  if (!o) return { ok: false, error: "That isn't valid." };
  if (!(RESOLVE_HOWS as readonly unknown[]).includes(o.how)) return { ok: false, error: "Say how it was resolved." };
  if (o.note !== undefined && o.note !== null && typeof o.note !== "string") return { ok: false, error: "The note isn't valid." };
  const note = typeof o.note === "string" ? o.note.trim() : "";
  if (note.length > MAX_NOTE) return { ok: false, error: `Keep the note to ${MAX_NOTE} characters.` };
  if (o.solutionId !== undefined && o.solutionId !== null && (typeof o.solutionId !== "string" || !UUID.test(o.solutionId))) return { ok: false, error: "That solution isn't valid." };
  const solutionId = typeof o.solutionId === "string" ? o.solutionId : null;
  if (solutionId && o.how !== "solution") return { ok: false, error: "A solution can only be named when a solution fixed it." };
  return { ok: true, value: { how: o.how as ResolveHow, note: note || null, solutionId } };
}
