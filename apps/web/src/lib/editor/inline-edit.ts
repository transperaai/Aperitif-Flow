// The node's inline editor (issue #8): what the user typed into one field on a
// step card, turned into an edit, or a reason it can't be. Each field commits
// on its own (Enter or leaving the field), so each is its own per-field save
// and its own undo step; Escape drops the draft and nothing is saved.

import type { ProcessBundle } from "@transpera-flow/db";
import { setMeanHours, updateStep } from "./commands";
import type { Edit } from "./ops";

/** Fields the step card edits in place. */
export const INLINE_FIELDS = ["name", "role_id", "person_id", "work_hours", "wait_hours"] as const;
export type InlineField = (typeof INLINE_FIELDS)[number];

export type InlineResult = { edit: Edit | null } | { error: string };

/** Hours as typed: "1.5", "1.5h" or "1.5 h". */
export function parseHours(text: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*h?\s*$/i.exec(text);
  return m ? Number(m[1]) : null;
}

/** The field's value as the inline editor shows it, to start a draft from. */
export function inlineDraft(bundle: ProcessBundle, id: string, field: InlineField): string {
  const step = bundle.steps.find((s) => s.id === id);
  if (!step) return "";
  const value = step[field];
  return value === null ? "" : field.endsWith("_hours") ? String(Number(value)) : String(value);
}

/** The edit that commits `text` to `field` (null when nothing changes), or why it can't be saved. */
export function commitInline(bundle: ProcessBundle, id: string, field: InlineField, text: string): InlineResult {
  const step = bundle.steps.find((s) => s.id === id);
  if (!step) return { error: "That step no longer exists." };
  switch (field) {
    case "name": {
      const name = text.trim();
      if (!name) return { error: "A step needs a name." };
      if (name.length > 200) return { error: "Keep the name under 200 characters." };
      const edit = updateStep(bundle, id, { name });
      return { edit: edit && { ...edit, label: `Renamed ${step.name} to ${name}` } };
    }
    case "role_id":
    case "person_id": {
      const value = text || null;
      const known = field === "role_id" ? bundle.roles : bundle.people;
      if (value !== null && !known.some((r) => r.id === value)) return { error: "Pick one from the list." };
      return { edit: updateStep(bundle, id, { [field]: value }) };
    }
    case "work_hours":
    case "wait_hours": {
      const hours = parseHours(text);
      if (hours === null) return { error: "Enter hours, 0 or more." };
      return { edit: setMeanHours(bundle, id, field === "work_hours" ? "work" : "wait", hours) };
    }
  }
}
