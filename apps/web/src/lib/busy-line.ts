// The workspace's busy line (settings.utilisation_threshold, 85% unless set; audit finding 2), for screens that hold the workspace
// settings rather than a built model. The engine's `busyLine` is the one rule; this only builds its input from the settings.

import { churnLimitsOf, type WorkspaceSettings } from "@transpera-flow/db";
import { busyLine } from "@transpera-flow/engine";

export function workspaceBusyLine(settings: WorkspaceSettings): number {
  const limits = churnLimitsOf(settings);
  return busyLine(limits ? { churnLimits: limits } : {});
}
