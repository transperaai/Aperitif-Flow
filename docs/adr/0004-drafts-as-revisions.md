# 4. Drafts are revisions; the live revision is never edited

Date: 29 Sep 2026 · Status: accepted · Issue: #9 · Implements PRD §7.1b, D18

## Context

Every process has one live (published) revision and at most one draft. Simulation, forecasts, reports and MCP reads use
live only. Editors (canvas, later MCP and JSON import) edit freely, and several people may edit at once.

## Decision

- A draft is an ordinary `process_revisions` row with `status = 'draft'`, holding a full copy of the process's steps
  and edges under **the same ids** as live. Diffing, discarding one change and publishing are all by id; no change log
  is kept.
- `open_draft(process)` copies live into a new draft, or returns the open one. It locks the process row, so two editors
  opening at once end up in the same draft; a partial unique index (one draft per process) is the backstop. The editor
  calls it lazily, before its first save.
- `publish_process(process, accept_estimates)` supersedes the old live, publishes the draft (its number is one above
  every other revision) and repoints the process, in one transaction. It refuses while steps are assumptions or
  conflicts unless `accept_estimates`. `discard_draft(process)` deletes the draft.
- All three are `security invoker`, so RLS decides who may do them. The audit entries (open, publish with the change
  summary and the accept-estimates choice, discard) are written by a `security definer` trigger on `process_revisions`,
  since clients can't write `audit_log`.
- A trigger refuses step and edge writes by signed-in users outside a draft revision, so "live never changes until
  Publish" holds at the database, not only in the app.
- In the app, `DraftSession` wraps the process editor: every edit is still an operation with an inverse, saved into the
  draft, so undo and redo work as before. Discarding one change is an ordinary (undoable) edit that puts the row or field
  back as it is live. Discarding the whole draft and publishing are confirmed and clear the undo history.

## Consequences

- A draft costs one copy of the process's rows; processes are small (tens of steps), so that is fine.
- Someone who loaded the page before another editor opened the draft keeps editing with per-field compare-and-set
  (ADR 0001): their saves go into the same draft and same-field clashes prompt as usual. They are told the draft was
  already open and to reload to see the other changes.
- Anything that reads a process for a live purpose must follow `processes.live_revision_id`, never the draft.
