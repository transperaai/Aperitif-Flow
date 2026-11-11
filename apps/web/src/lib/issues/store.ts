// Where tracked issues go. `live` (./live-store.ts) calls Server Actions that
// write to the database as the signed-in user; `MemoryIssueStore` keeps them
// in memory for the public demo (lost on reload) and for tests.

import { isVisibleIssue, type IssueEventKind, type IssueEventRow, type IssueRow, type ResolveHow } from "@transpera-flow/db";
import type { SaveOutcome } from "@/lib/fields/field-controller";
import {
  cleanFieldValue,
  parseResolveInput,
  isIssueField,
  parseIssueInput,
  parsePromoteInput,
  parseSaveInput,
  type IssueField,
  type IssueInput,
  type PromoteInput,
  type SaveIssueInput,
  type Scalar,
} from "./validate";

export type SaveIssueResult = { status: "ok"; issue: IssueRow } | { status: "error"; message: string };
export type RemoveIssueResult = { status: "ok" } | { status: "error"; message: string };

export const ALREADY_TRACKED = "That issue is already tracked.";
export const ALREADY_RESOLVED = "That issue is already resolved. Reopen it first if you want to resolve it again.";

export interface IssueStore {
  /** Log an issue by hand. */
  create(input: IssueInput): Promise<SaveIssueResult>;
  /** Track a detected issue: stored with `source: promoted` and its key, once per key. */
  promote(input: PromoteInput): Promise<SaveIssueResult>;
  /** Dismiss an insight again, against a newer live revision: the row stays dismissed and its revision moves on. */
  redismiss(id: string, revisionId: string | null): Promise<SaveIssueResult>;
  /** The Acknowledge dialog: create an issue (from an insight or by hand) or edit one, with its links, owners and sources. */
  save(input: SaveIssueInput): Promise<SaveIssueResult>;
  /** Save one field if its stored value is still `base` (per-field saves). */
  saveField(id: string, field: IssueField, base: Scalar, value: Scalar): Promise<SaveOutcome<Scalar>>;
  remove(id: string): Promise<RemoveIssueResult>;
  /** Mark an issue resolved, saying how and leaving a note. One history entry carries both. */
  resolve(id: string, how: ResolveHow, note: string | null, solution?: { id: string; name: string } | null): Promise<SaveIssueResult>;
  /** Set a resolved issue back to Open. Its history, resolved entry included, stays. */
  reopen(id: string): Promise<SaveIssueResult>;
  /** An issue's history, oldest first. */
  events(id: string): Promise<IssueEventRow[]>;
}

type NewRow = Omit<IssueRow, "id" | "workspace_id" | "created_at" | "updated_at" | "resolved_at" | "client_id" | "dismissed_revision_id" | "number" | "links" | "owner_ids" | "source_ids" | "target_measure" | "target_now" | "target_goal" | "resolved_how" | "resolved_solution_id" | "resolution_note"> &
  Partial<Pick<IssueRow, "client_id" | "dismissed_revision_id" | "resolved_how" | "resolved_solution_id" | "resolution_note" | "target_measure" | "target_now" | "target_goal" | "links" | "owner_ids" | "source_ids">>;

const closed = (s: string) => s === "resolved" || s === "wont_fix" || s === "dismissed";

export class MemoryIssueStore implements IssueStore {
  private rows: Map<string, IssueRow>;
  /** Numbers are never reused, as in the database. */
  private last: number;
  /** The history log, as the database's triggers write it. */
  private log = new Map<string, IssueEventRow[]>();

  constructor(
    private readonly workspaceId: string,
    initial: readonly IssueRow[] = [],
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.rows = new Map(initial.map((r) => [r.id, r]));
    this.last = Math.max(0, ...initial.map((r) => r.number ?? 0));
    for (const r of initial) if (isVisibleIssue(r)) this.record(r.id, "created", { status: r.status }, r.created_at);
  }

  private record(issueId: string, kind: IssueEventKind, detail: Record<string, unknown>, at = this.now()) {
    const list = this.log.get(issueId) ?? [];
    list.push({ id: crypto.randomUUID(), issue_id: issueId, workspace_id: this.workspaceId, seq: list.length + 1, kind, at, actor: null, detail, tx: null });
    this.log.set(issueId, list);
  }

  /** What a change of status is in the history: the same kinds the database's trigger writes. */
  private recordStatus(row: IssueRow, next: IssueRow, solutionName?: string) {
    if (row.status === next.status) return;
    const closedNow = next.status === "resolved" || next.status === "wont_fix";
    const closedBefore = row.status === "resolved" || row.status === "wont_fix";
    const kind: IssueEventKind = next.status === "testing" && row.status === "open" ? "solution_tested" : closedNow && !closedBefore ? "resolved" : closedBefore && !closedNow ? "reopened" : "edited";
    this.record(row.id, kind, {
      from: row.status,
      to: next.status,
      ...(kind === "resolved" ? { ...(next.resolved_how ? { how: next.resolved_how } : {}), ...(next.resolution_note ? { note: next.resolution_note } : {}), ...(next.resolved_solution_id && solutionName ? { solution_id: next.resolved_solution_id, solution: solutionName } : {}) } : {}),
    });
  }

  private insert(fields: NewRow): IssueRow {
    const at = this.now();
    const row: IssueRow = {
      client_id: null,
      dismissed_revision_id: null,
      target_measure: null,
      target_now: null,
      target_goal: null,
      resolved_how: null,
      resolved_solution_id: null,
      resolution_note: null,
      // What it touches and who owns it, as the link tables would hold them.
      links: fields.step_id ? [{ process_id: fields.process_id, step_id: fields.step_id }] : fields.process_id ? [{ process_id: fields.process_id, step_id: null }] : [],
      owner_ids: fields.owner_person_id ? [fields.owner_person_id] : [],
      source_ids: [],
      ...fields,
      id: crypto.randomUUID(),
      workspace_id: this.workspaceId,
      // A dismissed insight is not an issue, so it has no number until it is acknowledged.
      number: fields.status === "dismissed" ? null : ++this.last,
      resolved_at: closed(fields.status) ? at : null,
      created_at: at,
      updated_at: at,
    };
    this.rows.set(row.id, row);
    if (row.status !== "dismissed") this.record(row.id, "created", { status: row.status });
    return row;
  }

  async create(input: IssueInput): Promise<SaveIssueResult> {
    const parsed = parseIssueInput(input);
    if (!parsed.ok) return { status: "error", message: parsed.error };
    return { status: "ok", issue: this.insert({ ...parsed.value, evidence_metrics: {}, source: "manual", detected_key: null }) };
  }

  async promote(input: PromoteInput): Promise<SaveIssueResult> {
    const parsed = parsePromoteInput(input);
    if (!parsed.ok) return { status: "error", message: parsed.error };
    if ([...this.rows.values()].some((r) => r.detected_key === parsed.value.detected_key)) return { status: "error", message: ALREADY_TRACKED };
    return { status: "ok", issue: this.insert({ ...parsed.value, status: parsed.value.status ?? "open", source: "promoted" }) };
  }

  async redismiss(id: string, revisionId: string | null): Promise<SaveIssueResult> {
    const row = this.rows.get(id);
    if (!row) return { status: "error", message: "That issue no longer exists." };
    const next: IssueRow = { ...row, status: "dismissed", dismissed_revision_id: revisionId, updated_at: this.now() };
    this.rows.set(id, next);
    return { status: "ok", issue: next };
  }

  async save(input: SaveIssueInput): Promise<SaveIssueResult> {
    const parsed = parseSaveInput(input);
    if (!parsed.ok) return { status: "error", message: parsed.error };
    const v = parsed.value;
    const first = v.links[0]!;
    const compat = { process_id: first.process_id, step_id: first.step_id, owner_person_id: v.owner_ids[0] ?? null };
    const shared = {
      title: v.title,
      severity: v.severity,
      evidence: v.evidence ?? null,
      target_measure: v.target_measure,
      target_now: v.target_now,
      target_goal: v.target_goal,
      links: v.links,
      owner_ids: v.owner_ids,
      source_ids: v.source_ids,
      ...compat,
    };
    if (v.id) {
      const row = this.rows.get(v.id);
      if (!row) return { status: "error", message: "That issue no longer exists." };
      const at = this.now();
      const status = v.status ?? row.status;
      // Acknowledging a dismissed insight makes it an issue: it gets the next number and forgets the revision.
      const number = row.number ?? (status === "dismissed" ? null : ++this.last);
      const next: IssueRow = {
        ...row,
        ...shared,
        status,
        number,
        dismissed_revision_id: status === "dismissed" ? row.dismissed_revision_id : null,
        resolved_at: closed(status) ? (closed(row.status) ? row.resolved_at : at) : null,
        updated_at: at,
      };
      if (row.number == null) {
        // An insight being acknowledged: the issue is born now.
        if (next.number != null) this.record(v.id, "created", { status: next.status, acknowledged: true });
      } else {
        const changed = (["title", "severity", "evidence", "target_measure", "target_now", "target_goal"] as const).filter((f) => row[f] !== next[f]);
        this.recordStatus(row, next);
        if (changed.length) this.record(v.id, "edited", { fields: changed });
      }
      this.rows.set(v.id, next);
      return { status: "ok", issue: next };
    }
    if (v.from && [...this.rows.values()].some((r) => r.detected_key === v.from!.detected_key)) return { status: "error", message: ALREADY_TRACKED };
    return {
      status: "ok",
      issue: this.insert({
        ...shared,
        type: v.type ?? "manual",
        status: "open",
        role_id: v.from?.role_id ?? null,
        person_id: v.from?.person_id ?? null,
        client_id: v.from?.client_id ?? null,
        scenario_id: v.from?.scenario_id ?? null,
        evidence_metrics: v.from?.evidence_metrics ?? {},
        source: v.from ? "promoted" : "manual",
        detected_key: v.from?.detected_key ?? null,
      }),
    };
  }

  async saveField(id: string, field: IssueField, base: Scalar, value: Scalar): Promise<SaveOutcome<Scalar>> {
    const row = this.rows.get(id);
    if (!row) return { status: "not_found" };
    const clean = isIssueField(field) ? cleanFieldValue(field, value) : null;
    if (!clean) return { status: "error", message: "That value isn't valid." };
    const stored = row[field] as Scalar;
    if (stored !== base && stored !== clean.value) return { status: "conflict", theirs: stored };
    const at = this.now();
    const next = { ...row, [field]: clean.value, updated_at: at } as IssueRow;
    if (field === "status") {
      next.resolved_at = closed(next.status) ? (closed(row.status) ? row.resolved_at : at) : null;
      // As the database's trigger: what was recorded about a resolution goes when the issue is not resolved any more.
      if (next.status !== "resolved" && next.status !== "wont_fix") Object.assign(next, { resolved_how: null, resolved_solution_id: null, resolution_note: null });
      this.recordStatus(row, next);
    }
    this.rows.set(id, next);
    return { status: "saved", value: clean.value };
  }

  async remove(id: string): Promise<RemoveIssueResult> {
    this.rows.delete(id);
    return { status: "ok" };
  }

  async resolve(id: string, how: ResolveHow, note: string | null, solution: { id: string; name: string } | null = null): Promise<SaveIssueResult> {
    const parsed = parseResolveInput({ how, note, solutionId: solution?.id ?? null });
    if (!parsed.ok) return { status: "error", message: parsed.error };
    const row = this.rows.get(id);
    if (!row || row.status === "dismissed") return { status: "error", message: "That issue no longer exists." };
    if (row.status === "resolved" || row.status === "wont_fix") return { status: "error", message: ALREADY_RESOLVED };
    const at = this.now();
    const next: IssueRow = {
      ...row,
      status: "resolved",
      resolved_how: parsed.value.how,
      resolved_solution_id: parsed.value.solutionId,
      resolution_note: parsed.value.note,
      resolved_at: closed(row.status) ? row.resolved_at : at,
      updated_at: at,
    };
    this.rows.set(id, next);
    this.recordStatus(row, next, solution?.name);
    return { status: "ok", issue: next };
  }

  async reopen(id: string): Promise<SaveIssueResult> {
    const row = this.rows.get(id);
    if (!row || row.status === "dismissed") return { status: "error", message: "That issue no longer exists." };
    const at = this.now();
    const next: IssueRow = { ...row, status: "open", resolved_how: null, resolved_solution_id: null, resolution_note: null, resolved_at: null, updated_at: at };
    this.rows.set(id, next);
    this.recordStatus(row, next);
    return { status: "ok", issue: next };
  }

  async events(id: string): Promise<IssueEventRow[]> {
    return [...(this.log.get(id) ?? [])];
  }

  /** Every stored row that is an issue a person sees (not a dismissed insight), for tests. */
  visible(): IssueRow[] {
    return [...this.rows.values()].filter(isVisibleIssue);
  }
}
