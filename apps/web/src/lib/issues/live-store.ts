import { createIssue, deleteIssue, issueEvents, promoteIssue, reopenIssue, resolveIssueAction, saveIssueField, redismissIssue, saveIssueFromDialog } from "@/app/w/[slug]/issue-actions";
import type { IssueStore } from "./store";

/** Saves issues to the database through Server Actions, as the signed-in user. */
export function liveIssueStore(workspaceId: string): IssueStore {
  return {
    create: (input) => createIssue(workspaceId, input),
    promote: (input) => promoteIssue(workspaceId, input),
    redismiss: (id, revisionId) => redismissIssue(workspaceId, id, revisionId),
    save: (input) => saveIssueFromDialog(workspaceId, input),
    saveField: (id, field, base, value) => saveIssueField(id, field, base, value),
    remove: (id) => deleteIssue(id),
    resolve: (id, how, note, solution) => resolveIssueAction(workspaceId, id, how, note, solution?.id ?? null),
    reopen: (id) => reopenIssue(workspaceId, id),
    events: (id) => issueEvents(workspaceId, id),
  };
}
