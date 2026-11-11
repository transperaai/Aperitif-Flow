import type { SourceLinkRow } from "@transpera-flow/db";

/**
 * The links an issue page shows: the issue's links, and one for each source on its own list that has none (the page shows the
 * union, as `loadIssue` does). Such a link is not a row: its id says so (`issue-source:<issue>:<source>`), and unlinking it takes
 * the source off the issue's list (see `unlinkSource`).
 */
export function withIssueSources(links: SourceLinkRow[], workspaceId: string, { issueId, sourceIds }: { issueId: string; sourceIds: readonly string[] }): SourceLinkRow[] {
  const have = new Set(links.filter((l) => l.kind === "issue" && l.issue_id === issueId).map((l) => l.source_id));
  const extra = sourceIds
    .filter((id) => !have.has(id))
    .map(
      (source_id): SourceLinkRow => ({
        id: `issue-source:${issueId}:${source_id}`,
        workspace_id: workspaceId,
        source_id,
        kind: "issue",
        process_id: null,
        step_id: null,
        insight_key: null,
        issue_id: issueId,
        solution_id: null,
        created_at: "",
        created_by: null,
      }),
    );
  return extra.length ? [...links, ...extra] : links;
}
