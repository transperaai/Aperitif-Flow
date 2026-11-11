// What "Save to library" sends, and the checks behind the Server Action (app/w/[slug]/block-actions.ts) and the in-memory
// demo store. They only reject malformed input early: the table checks the name, type and bundle again, and row-level
// security decides who may write.

import type { BlockBundle, BlockRow } from "@transpera-flow/db";
import { blockProblem } from "./blocks";

export const MAX_NAME = 200;
export const MAX_DESCRIPTION = 2000;
/** The table refuses a bundle over 1,000,000 bytes of JSON (`octet_length`). */
export const MAX_BUNDLE = 1_000_000;

/** What the Editor sends to save a block. Blocks saved by hand are always "manual"; AI blocks come from A52. */
export interface BlockInput {
  name: string;
  description: string;
  bundle: BlockBundle;
}

export type SaveBlockResult = { status: "ok"; block: BlockRow } | { status: "error"; message: string };

/** A plain-English reason the input can't be saved, or the cleaned input. */
export function parseBlockInput(input: unknown): { ok: true; value: BlockInput } | { ok: false; error: string } {
  const i = input as Partial<BlockInput> | null;
  if (!i || typeof i !== "object") return { ok: false, error: "That block isn't valid." };
  const name = typeof i.name === "string" ? i.name.trim() : "";
  if (!name) return { ok: false, error: "Name the block first." };
  if (name.length > MAX_NAME) return { ok: false, error: `Keep the name under ${MAX_NAME} characters.` };
  const description = typeof i.description === "string" ? i.description.trim() : "";
  if (description.length > MAX_DESCRIPTION) return { ok: false, error: `Keep the description under ${MAX_DESCRIPTION} characters.` };
  const problem = blockProblem(i.bundle);
  if (problem) return { ok: false, error: problem };
  const bundle = i.bundle as BlockBundle;
  if (new TextEncoder().encode(JSON.stringify(bundle)).length > MAX_BUNDLE) return { ok: false, error: "That block is too big to save." };
  return { ok: true, value: { name, description, bundle: { steps: bundle.steps, edges: bundle.edges, entry_step_id: bundle.entry_step_id ?? null } } };
}
