# 7. Evidence and conflicts live in each value's provenance

Date: 30 Sep 2026 · Status: accepted · Issue: #21 · Implements PRD §4.1 "Sources and evidence", §7.1b, D17

## Context

Every inferred number must trace to what someone said, disagreements must stay visible (a triangular range, a
perception-gap issue, a publish gate), and robustness must use the real range. Steps already carry per-column
provenance (`steps.provenance.<column> = {source, at, by}`, #11) and flags `assumption` and `conflict` that
`publish_process` checks (#9). Writers include the canvas now and the MCP server and JSON import later (#24).

## Decision

- Sources are rows (`sources`, per workspace). Citations are not: they sit in the value's provenance entry,
  `evidence: [{source_id, speaker, quote, timestamp, value?}]`, extending the §5 shape rather than adding a table.
  `value` (the number stated) is our addition; it is what makes a disagreement computable.
- A disagreement is `conflict: {values: [{value, source_id, speaker}], resolved?: {at, by, choice}}` on the same entry.
  The rules are pure functions in `packages/db/src/evidence.ts`, shared by the app and (later) the MCP server:
  an estimate becomes the triangular range (min, median, max) of what was said, stored in the step's own
  `*_dist`/`*_params`, so the engine needs nothing new; an `entered` or `measured` value is never overwritten, only
  flagged. Confirming or settling makes the value `entered` and keeps the conflict as history.
- The database backs the invariants every writer must keep: a trigger turns `steps.conflict` on while any entry has
  an unresolved conflict (so the publish gate counts it), and a `security definer` trigger logs a `perception_gap`
  issue for conflicts 2× apart or more. That issue is stored as a tracked detection (`source = 'promoted'`, keyed
  `perception_gap:step:<id>.<column>`) because rows with `source = 'detected'` are read-only and people must be able
  to close it; the register's unique key keeps it to one row however often the step is saved or copied into a draft.
- Robustness perturbs an unresolved conflict across its values even when the value was entered, and reports each
  conflicted input whose range flips the conclusion.

## Consequences

- No join to find a value's evidence; the Sources page scans provenance (live and draft steps, demand rows) to list
  what cites each source. Deleting a source leaves its quotes in place, shown as citing a deleted source.
- The perception-gap text is written twice (SQL trigger, `perceptionGaps()` in TS); a test keeps them identical.
- Screenshots are links (`file_url`) until Storage uploads land.
