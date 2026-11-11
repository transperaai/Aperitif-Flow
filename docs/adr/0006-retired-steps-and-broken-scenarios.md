# 6. Split steps stay in the revision, retired; broken scenarios are refused, never trimmed

Date: 30 Sep 2026 · Status: accepted · Issue: #16 · Implements PRD §4.1 "Levers and scenarios", §6.2, D10

## Context

Saved scenarios name their targets by stable id (`steps.<step_id>.work_hours`). When the model changes under them (a
step is deleted, split or replaced; a person leaves) a patch can stop resolving. Skipping it would make a saved fix
quietly worth £0, which D10 rules out. The PRD also says the editor records `replaced_by` on a split or replaced step,
so the scenario can say what took over. Steps are keyed by `(revision_id, id)` and drafts are full copies (ADR 0004), so
a step removed in a draft has nowhere to keep `replaced_by` unless its row stays.

## Decision

- **Retired rows.** Splitting a step (node menu → Split in two) removes it and inserts, under the same id, a row with
  `replaced_by = [first half, second half]` (and `assumption = false`, so it never blocks Publish). Its edges move to
  the halves. `steps.replaced_by` has existed since the first migration, so there is no migration.
- A step with a non-empty `replaced_by` is **retired**: never drawn, diffed or simulated. Loaders sort rows into
  `ProcessBundle.steps` and `ProcessBundle.retired` (`partitionSteps`, packages/db): `loadProcessBundle`, the editor's
  local ops, Realtime upserts and catch-up reads. `open_draft` copies retired rows like any other, so replacements are
  remembered across revisions, and replacements of replacements are followed.
- **Scenario status is derived, not stored.** `checkScenario` (packages/engine/src/broken.ts) re-resolves every patch
  against the model on screen; any missing target makes the scenario `needs_attention`, naming the path and, from the
  retired rows (or the live revision, for a step deleted in a draft), the old step's name and its replacements.
  There is no `scenarios.status` column: the answer depends on which revision is shown (draft or live), and a stored
  flag would go stale whenever someone else publishes.
- **Model resolution refuses.** `resolveScenario` throws `BrokenScenarioError` instead of skipping; the scenario panel
  leaves a broken scenario out of the run and says why in the compare view; the MCP `run_scenario` already fails on
  overrides that don't resolve.
- **Issues.** `detectBrokenScenarios` raises one `broken_scenario` detected issue per broken scenario, keyed
  `broken_scenario:scenario:<id>` and linked to it. Like every detection it vanishes once the scenario resolves; a
  tracked (promoted) one is set to done automatically by an editor's page when its detection goes away.
- **Re-pointing** replaces one patch's id (`repointPatch`) and saves the scenario's `patch` with an ordinary update
  (RLS: editors). Suggested replacements are offered first, then any target of the same kind.
- Publishing a draft that would break saved scenarios warns in the draft bar and the publish dialog; it is not refused.

## Consequences

- Anything new that reads a revision's steps must go through `partitionSteps` (or `loadProcessBundle`), or it will draw
  or simulate retired rows. `toEngineModel` assumes it is given steps in use.
- A plain delete leaves no retired row: after that draft is published, a scenario aimed at the step says "a step that is
  no longer in the process" without its name (while the draft is open, the live revision still names it).
- Scenario re-points are last-write-wins, like the rest of a scenario row.
- A colleague's split reaches other open editors through Realtime; the retired row is filed away, not drawn.
