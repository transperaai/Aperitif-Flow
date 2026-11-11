// How an issue's status is stored and how it is shown (issue #112, A47).
//
// The `issues.status` check allows the four values production has always had (`open`, `in_progress`, `done`,
// `dismissed`), so the new statuses are held as the old ones plus a `resolution` column:
//
//   shown               stored status   stored resolution
//   Open                open            null
//   Testing solutions   in_progress     null
//   Resolved            done            null
//   Won't fix           done            wont_fix
//   (a dismissed insight, never shown as an issue)  dismissed  null
//
// This is the one place that maps between the two. The app and the MCP server read and write the shown names
// (`IssueStatus`); `loadIssues` converts on the way out, and `save_issue` and the per-field status save convert on the
// way in. A later "contract" migration, with Austin's go-ahead, can rewrite the stored values and tighten the check.

import type { IssueStatus } from "./types";

export type StoredIssueStatus = "open" | "in_progress" | "done" | "dismissed";
export type StoredResolution = "wont_fix" | null;

/** The stored statuses an issue still to be dealt with has: Open and Testing solutions. */
export const ACTIVE_STORED_STATUSES: StoredIssueStatus[] = (["open", "testing"] as const).map((s) => storedStatus(s).status);

/** The status a stored row is shown with. */
export function uiStatus(status: StoredIssueStatus, resolution: StoredResolution | string | null): IssueStatus {
  if (status === "in_progress") return "testing";
  if (status === "done") return resolution === "wont_fix" ? "wont_fix" : "resolved";
  return status;
}

/** What to store for a status as shown. */
export function storedStatus(ui: IssueStatus): { status: StoredIssueStatus; resolution: StoredResolution } {
  switch (ui) {
    case "testing":
      return { status: "in_progress", resolution: null };
    case "resolved":
      return { status: "done", resolution: null };
    case "wont_fix":
      return { status: "done", resolution: "wont_fix" };
    default:
      return { status: ui, resolution: null };
  }
}
