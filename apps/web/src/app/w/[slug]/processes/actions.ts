"use server";

import { isId } from "@/lib/editor/validate";
import { loadProcessCard, type ProcessCardData } from "@/lib/processes/data";

/** A row's map card, loaded when the row is first opened (as the signed-in user: RLS decides what is visible). */
export async function openProcessCard(slug: string, processId: string): Promise<ProcessCardData | null> {
  if (typeof slug !== "string" || !isId(processId)) return null;
  return loadProcessCard(slug, processId);
}
