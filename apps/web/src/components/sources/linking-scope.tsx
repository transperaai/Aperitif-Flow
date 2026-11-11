import type { ReactNode } from "react";
import type { SourceRow } from "@transpera-flow/db";
import { SourceLinkingProvider } from "@/components/sources/linking";
import { loadSourceLinking } from "@/lib/data";
import { withIssueSources } from "@/lib/sources/issue-links";
import { demoLinkTargets, demoPageSources, demoSourceLinks } from "@/lib/sources/demo";

/**
 * Gives the screen inside it "+ Link" (issue #118): loads the workspace's source links and link targets and wraps the page in
 * the provider the Sources blocks read. A page passes the sources it already loaded. If the links can't be read, the page
 * shows as it did before rather than failing.
 */
export async function SourceLinkingScope({
  workspaceId,
  sources,
  canEdit,
  issueSources,
  children,
}: {
  workspaceId: string;
  sources: SourceRow[];
  canEdit: boolean;
  /** On an issue's page: the sources the issue lists (`issue_sources`), so one without a link still shows (and can be taken off). */
  issueSources?: { issueId: string; sourceIds: readonly string[] };
  children: ReactNode;
}) {
  let loaded: Awaited<ReturnType<typeof loadSourceLinking>> | null = null;
  try {
    loaded = await loadSourceLinking(workspaceId);
  } catch (err) {
    console.error("Couldn't load the source links; showing the page without them.", err instanceof Error ? err.message : err);
  }
  if (!loaded) return <>{children}</>;
  const links = issueSources ? withIssueSources(loaded.links, workspaceId, issueSources) : loaded.links;
  return (
    <SourceLinkingProvider workspaceId={workspaceId} mode={canEdit ? "live" : "readonly"} sources={sources} links={links} targets={loaded.targets}>
      {children}
    </SourceLinkingProvider>
  );
}

/** The same on the demo: Northbeam's sample sources and links, changed in the tab only. */
export function DemoSourceLinkingScope({ workspaceId, children }: { workspaceId: string; children: ReactNode }) {
  return (
    <SourceLinkingProvider workspaceId={workspaceId} mode="demo" sources={demoPageSources()} links={demoSourceLinks()} targets={demoLinkTargets()}>
      {children}
    </SourceLinkingProvider>
  );
}
