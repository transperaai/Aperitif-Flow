# 1. Per-field saves checked against the value the editor last saw

Date: 2026-09-30 · Status: accepted · Implements PRD D14

## Context

Several people (consultant, owner, ops manager) edit the same workspace, sometimes at once. D14 asks for per-field saves with a version check: edits to different fields merge, and a same-field conflict prompts "keep mine / keep theirs". The people settings form (#6) is the first write path; canvas editing (#8) and later forms reuse it.

## Decision

The "version" is **the field's own value**, not a row version. Each save sends, per field, the value the editor loaded (`base`) and the new value. Postgres compares them under a row lock in one function, `public.save_fields(target, key, base, changes)`:

- stored = base: write it.
- stored = new value: already saved (a retry), nothing to do.
- otherwise: conflict. Nothing is written for that field, and the stored value comes back as `theirs`.

Only the fields sent are written, so edits to different fields of one row merge without a merge step. "Keep mine" is the same call again with `base = theirs`; "keep theirs" just adopts `theirs`. A field can also be one key of a jsonb column (`settings.availability_floor`). Values go through the column types before comparing, so `1` and `1.0` match.

Sets held in link tables (a person's roles and skills) use `public.save_links(target, owner, member, base, next)`, which compares the whole set the same way.

Both functions are `security invoker`: they run as the signed-in user, so grants and RLS decide what can be written. A row the user can't update reads as `not_found`. Tables and columns are allow-listed. Keys, `workspace_id` and audit columns can't be changed.

In the app, `FieldController` (`apps/web/src/lib/fields/field-controller.ts`, no framework code, unit tested) holds each field's base, draft and phase. It runs saves one at a time so a second save uses the base the first one stored. `useField` and `components/fields.tsx` wrap it for React. `lib/fields/server.ts` calls the RPCs. Server Actions validate their inputs and then call those helpers.

## Consequences

- There's no `version` column to maintain, and no false conflicts when two people edit different fields of one row. Creating and deleting rows (new person, add or remove leave) are plain inserts and deletes under RLS, because they can't clash with an edit of the same field.
- A conflict is noticed at save time, not while typing. Live presence and refresh come with Realtime (A7).
- Adding a table to per-field editing means updating the allow-list in the migration and `EditableTable` / `LINK_MEMBERS` in the app.
- If one person sets a field to X and changes it back to its old value, someone else's stale save goes through silently. That's the usual compare-and-set trade-off, and it's acceptable here.
