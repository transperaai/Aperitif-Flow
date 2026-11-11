// Broken scenarios (docs/PRD.md §4.1 "Levers and scenarios", §6.2, decision
// D10; issue #16).
//
// A saved scenario names its targets by id (`steps.<step_id>.work_hours`).
// When the model changes under it (a step is deleted, or split or replaced in
// the editor, a person leaves), a target can stop resolving. Such a scenario
// "needs attention": it is never run with the bad patch skipped, because that
// would quietly turn a saved fix into a fix worth nothing. Instead:
//
// - `checkScenario` re-resolves every patch against the current model and
//   says which ones broke, naming the old step and, when the editor recorded
//   `replaced_by` on it, the step(s) that replaced it (following replacements
//   of replacements), so the patch can be re-pointed;
// - `resolveScenario` is model resolution for a run: it refuses a broken
//   scenario with a `BrokenScenarioError` instead of skipping patches;
// - `detectBrokenScenarios` raises one `broken_scenario` detected issue per
//   broken scenario, with a stable key, so the register shows it while it is
//   broken and it disappears (resolves) once the scenario is fixed.
//
// Pure, deterministic and templated like the rest of the engine: no I/O, no
// clock, no language model.

import type { DetectedIssue } from "./issues";
import type { EngineModel } from "./model";
import { noCost } from "./cost";
import { fixedRating } from "./ratings";
import {
  applyPatches,
  isBlocking,
  parsePatchPath,
  type PatchIssue,
  type PatchTarget,
  type PatchedModel,
  type ScenarioPatch,
} from "./scenario";

/**
 * A step the current model no longer has, as the stored process remembers it:
 * a split or replaced step keeps its row with `replaced_by` (the steps that
 * took over its work); a deleted step has no replacements.
 */
export interface RetiredStep {
  name: string;
  /** Ids of the steps that replaced it; empty when it was simply deleted. */
  replacedBy: string[];
}

/** Retired steps by their (stable) id. */
export type RetiredSteps = Record<string, RetiredStep>;

/** What a scenario is for these checks: its patches, and an id and name for issues. */
export interface NamedPatchSet {
  id: string;
  name: string;
  patch: readonly ScenarioPatch[];
}

/** A patch whose target no longer resolves (a blocking `PatchIssue`, with what it pointed at). */
export interface BrokenPatch extends PatchIssue {
  problem: "invalid" | "missing_target";
  patch: ScenarioPatch;
  /** The collection the path addresses; null for a path outside the grammar. */
  kind: PatchTarget["kind"] | null;
  /** The id it names; null for a path outside the grammar or with no id. */
  targetId: string | null;
  /** The field it changes, in words ("hands-on time"); null for a path outside the grammar. */
  field: string | null;
  /** The name the target had, when the stored process remembers it. */
  targetName: string | null;
  /** True when the step was split or replaced (it has `replaced_by`), false when deleted or unknown. */
  replaced: boolean;
  /** Steps in the model now that took over its work, in the order recorded; empty when there are none. */
  replacements: { id: string; name: string }[];
}

export type ScenarioStatus = "ok" | "needs_attention";

export interface ScenarioCheck {
  status: ScenarioStatus;
  /** Every patch that no longer resolves, in patch order. */
  broken: BrokenPatch[];
}

const FIELD_WORDS: Record<string, string> = {
  leads_per_week: "leads per week",
  active_clients: "active clients",
  churn_monthly: "monthly churn",
  retainer: "monthly retainer",
  price: "price",
  mix_share: "mix share",
  headcount: "head-count",
  cost_rate: "cost rate",
  ongoing_hours: "client hours per client",
  fte: "FTE",
  work_hours: "hands-on time",
  wait_hours: "wait",
  rework_rate: "rework",
  churn_health_sensitivity: "churn sensitivity to health",
  initial: "starting client health",
  recover: "health gained per task on time",
  late_penalty: "health lost per late task",
  missed_penalty: "health lost per missed task",
};

const KIND_WORDS: Record<PatchTarget["kind"], string> = {
  demand: "demand",
  finances: "finances",
  health: "health rules",
  services: "service",
  roles: "role",
  people: "person",
  steps: "step",
};

/** "A", "A and B", "A, B and C". */
function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/**
 * The steps in the model that took over `stepId`'s work: its `replacedBy`,
 * with any of those that were themselves retired replaced in turn by theirs.
 * Deleted replacements drop out; cycles and repeats are ignored. In recorded
 * order.
 */
export function replacementsFor(model: Pick<EngineModel, "steps">, retired: RetiredSteps, stepId: string): string[] {
  const present = new Set(model.steps.map((s) => s.id));
  const out: string[] = [];
  const seen = new Set<string>([stepId]);
  const visit = (id: string) => {
    for (const next of retired[id]?.replacedBy ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      if (present.has(next)) out.push(next);
      else visit(next);
    }
  };
  if (!present.has(stepId)) visit(stepId);
  return out;
}

/** The templated sentence for one broken patch. */
function brokenMessage(b: Omit<BrokenPatch, "message">): string {
  if (b.problem === "invalid" || !b.kind) return `'${b.path}' isn't a change Aperitif Flow can make.`;
  const field = b.field ?? "value";
  if (b.kind === "steps") {
    if (b.targetId?.startsWith("@")) return `It changes the ${field} of the heaviest step, and the process has no staffed step.`;
    const named = b.targetName ? `“${b.targetName}”` : "A step";
    const names = b.replacements.map((r) => r.name);
    if (b.replaced && names.length === 1) return `${named} (${field}) was replaced by ${names[0]}. Re-point this change to it.`;
    if (b.replaced && names.length > 1) return `${named} (${field}) was split into ${list(names)}. Re-point this change to one of them.`;
    if (b.replaced) return `${named} (${field}) was replaced, and the steps that replaced it are gone too. Re-point this change or remove the scenario.`;
    if (b.targetName) return `${named} (${field}) was deleted from the process. Re-point this change or remove the scenario.`;
    return `It changes the ${field} of a step that is no longer in the process. Re-point this change or remove the scenario.`;
  }
  const what = KIND_WORDS[b.kind];
  if (b.targetId?.startsWith("@")) return `It changes the ${field} of the busiest ${what}, and the model has none.`;
  return `It changes the ${field} of a ${what} that is no longer in the model. Re-point this change or remove the scenario.`;
}

/**
 * Re-resolve a scenario's patches against the model. `needs_attention` when
 * any patch's target is missing (or its path isn't one the engine knows);
 * clamped values don't count. `retired` supplies names and `replaced_by` for
 * steps the model no longer has.
 */
export function checkScenario(model: EngineModel, patches: readonly ScenarioPatch[], retired: RetiredSteps = {}): ScenarioCheck {
  const issues = applyPatches(model, patches).issues.filter(isBlocking);
  const broken = issues.map((issue): BrokenPatch => {
    const patch = patches[issue.index]!;
    const target = typeof patch?.path === "string" ? parsePatchPath(patch.path) : null;
    const kind = target?.kind ?? null;
    const targetId = target && "id" in target ? target.id : null;
    const isStep = kind === "steps" && targetId !== null && !targetId.startsWith("@");
    const memory = isStep ? retired[targetId] : undefined;
    const replacements = isStep
      ? replacementsFor(model, retired, targetId).map((id) => ({ id, name: model.steps.find((s) => s.id === id)!.name }))
      : [];
    const base = {
      index: issue.index,
      path: issue.path,
      problem: issue.problem as BrokenPatch["problem"],
      patch,
      kind,
      targetId,
      field: target ? (FIELD_WORDS[target.field] ?? target.field) : null,
      targetName: memory?.name ?? null,
      replaced: Boolean(memory?.replacedBy.length),
      replacements,
    };
    return { ...base, message: brokenMessage(base) };
  });
  return { status: broken.length ? "needs_attention" : "ok", broken };
}

/** A scenario was asked to run while some of its patches don't resolve. */
export class BrokenScenarioError extends Error {
  constructor(
    readonly broken: BrokenPatch[],
    scenarioName?: string,
  ) {
    const subject = scenarioName ? `“${scenarioName}”` : "This scenario";
    super(
      `${subject} needs attention and can't be run: ${broken.length} of its changes no longer ${broken.length === 1 ? "resolves" : "resolve"}. ` +
        broken.map((b) => b.message).join(" "),
    );
    this.name = "BrokenScenarioError";
  }
}

/**
 * Model resolution for a run (PRD §6.2): the model with the scenario's
 * patches applied, or a `BrokenScenarioError` when any patch doesn't resolve.
 * A broken patch is never skipped. Clamped values are applied and reported in
 * `issues`, as `applyPatches` does.
 */
export function resolveScenario(
  model: EngineModel,
  patches: readonly ScenarioPatch[],
  { retired = {}, name }: { retired?: RetiredSteps; name?: string } = {},
): PatchedModel {
  const check = checkScenario(model, patches, retired);
  if (check.status === "needs_attention") throw new BrokenScenarioError(check.broken, name);
  return applyPatches(model, patches);
}

/**
 * The patches with patch `index` pointed at `targetId` instead (same
 * collection, field, op and value). Returns the list unchanged if the patch
 * has no id to re-point.
 */
export function repointPatch(patches: readonly ScenarioPatch[], index: number, targetId: string): ScenarioPatch[] {
  return patches.map((p, i) => {
    if (i !== index) return { ...p };
    const target = parsePatchPath(p.path);
    if (!target || !("id" in target)) return { ...p };
    return { ...p, path: `${target.kind}.${targetId}.${target.field}` };
  });
}

/** The stable key of a scenario's `broken_scenario` issue. */
export const brokenScenarioKey = (scenarioId: string) => `broken_scenario:scenario:${scenarioId}`;

/**
 * One `broken_scenario` issue per saved scenario that needs attention, in the
 * order given. Keys are stable (`broken_scenario:scenario:<id>`), so a tracked
 * issue is matched run after run, and the issue is gone once the scenario is
 * fixed. The issue sits on the first replacement step, if there is one.
 */
export function detectBrokenScenarios(model: EngineModel, scenarios: readonly NamedPatchSet[], retired: RetiredSteps = {}): DetectedIssue[] {
  const out: DetectedIssue[] = [];
  for (const s of scenarios) {
    const { broken } = checkScenario(model, s.patch, retired);
    if (!broken.length) continue;
    const total = s.patch.length;
    const step = broken.find((b) => b.replacements.length)?.replacements[0]?.id ?? null;
    out.push({
      key: brokenScenarioKey(s.id),
      type: "broken_scenario",
      ...fixedRating("bad"),
      cost: noCost("A broken saved scenario has no money method."),
      title: `Scenario “${s.name}” needs attention`,
      evidence:
        `${broken.length === total ? (total === 1 ? "Its only change" : `All ${total} of its changes`) : `${broken.length} of its ${total} changes`} ` +
        `no longer ${broken.length === 1 ? "resolves" : "resolve"} against the model: ${broken.map((b) => b.message).join(" ")} ` +
        `It is left out of comparisons and reports until it is fixed.`,
      metrics: { broken_changes: broken.length, changes: total },
      stepId: step,
      roleId: null,
      personId: null,
      fix: null,
      scenarioId: s.id,
    });
  }
  return out;
}
