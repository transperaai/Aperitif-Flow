import { deleteProcessRows, insertProcessRows, saveProcessFields } from "@/app/w/[slug]/actions";
import type { ProcessStore } from "./store";

/** Saves to the database through the editor's Server Actions, as the signed-in user. */
export function liveStore(revisionId: string): ProcessStore {
  return {
    insert: (steps, edges) => insertProcessRows(revisionId, steps, edges),
    remove: (stepIds, edgeIds) => deleteProcessRows(revisionId, stepIds, edgeIds),
    update: (table, id, base, next) => saveProcessFields(revisionId, table, id, base, next),
  };
}
