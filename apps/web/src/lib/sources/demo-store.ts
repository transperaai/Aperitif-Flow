// The demo's sources and links live in the tab, not in a database: one store for every page of the demo, so a link made on
// the process page is there on the Sources page, and gone when the tab reloads. The first page to ask gives it its sample.

import type { SourceLinkRow, SourceRow } from "@transpera-flow/db";
import { MemorySourceStore } from "./store";

let store: MemorySourceStore | null = null;

export function demoSourceStore(workspaceId: string, sources: readonly SourceRow[], links: readonly SourceLinkRow[]): MemorySourceStore {
  // On the server nothing is shared between visitors: each render starts from the sample.
  if (typeof window === "undefined") return new MemorySourceStore(workspaceId, sources, undefined, links);
  store ??= new MemorySourceStore(workspaceId, sources, undefined, links);
  return store;
}
