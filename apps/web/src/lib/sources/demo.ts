// The public demo's Northbeam sample with sources in play (issue #21): Rosa's
// reading of the time logs disagrees with Maya on audits (a conflict, 2×
// apart, so a perception gap), and kickoff time is an assumption waiting to be
// confirmed. Built with the same rules the inspector uses.

import {
  applyStepPatch,
  citationsBySource,
  citeEvidence,
  NORTHBEAM_WORKSPACE_ID,
  northbeamBundle,
  northbeamIssues,
  northbeamSourceIds,
  northbeamSourceLinks,
  northbeamSources,
  northbeamStepIds,
  processesOf,
  type LinkTargets,
  type ProcessBundle,
  type SourceCitation,
  type SourceLinkRow,
  type SourceRow,
} from "@transpera-flow/db";

const AT = "2026-09-29T10:00:00.000Z";

export function demoBundle(): ProcessBundle {
  const bundle = northbeamBundle();
  const interview = northbeamSourceIds.strategyInterview;
  bundle.steps = bundle.steps.map((s) => {
    if (s.id === northbeamStepIds.audit) {
      return applyStepPatch(
        s,
        citeEvidence(
          s,
          "work_hours",
          {
            source_id: interview,
            speaker: "Rosa Diaz",
            quote: "From the time logs it looks more like twelve hours by the time it goes out.",
            timestamp: "00:16:40",
            value: 12,
          },
          { at: AT },
        ),
      );
    }
    if (s.id === northbeamStepIds.kickoff) {
      const cited = applyStepPatch(
        s,
        citeEvidence(s, "work_hours", { source_id: interview, speaker: "Maya Collins", quote: "Kickoffs are quicker, half a day.", timestamp: "00:21:10", value: 4 }, { at: AT }),
      );
      const entry = cited.provenance.work_hours!;
      return { ...cited, provenance: { ...cited.provenance, work_hours: { ...entry, note: "“Half a day” read as 4 working hours." } } };
    }
    return s;
  });
  return bundle;
}

export function demoSources(): SourceRow[] {
  return northbeamSources();
}

/** What cites each demo source: the demo process's steps and its lead sources. */
export function demoCitations(bundle: ProcessBundle = demoBundle()): Record<string, SourceCitation[]> {
  return Object.fromEntries(
    citationsBySource([
      ...bundle.steps.map((s) => ({ table: "steps", id: s.id, name: s.name, processId: s.process_id, revision: "live" as const, provenance: s.provenance })),
      ...(bundle.leadSources ?? []).map((l) => ({ table: "lead_sources", id: l.id, name: l.name, provenance: l.provenance })),
    ]),
  );
}

/**
 * The Sources page's own sample: the two sources the figures cite, plus one nobody has linked yet, so the warning (and the
 * sidebar's count) shows on the demo as it does on a real workspace after a plain "add source".
 */
export const DEMO_UNLINKED_SOURCE_ID = "30000000-0000-4000-8000-000000000003";

export function demoPageSources(): SourceRow[] {
  const at = "2026-09-29T09:00:00Z";
  return [
    ...demoSources(),
    {
      id: DEMO_UNLINKED_SOURCE_ID,
      workspace_id: NORTHBEAM_WORKSPACE_ID,
      kind: "notes",
      title: "Notes: ops walkthrough with Leah",
      speakers: ["Leah Brooks"],
      recorded_at: "2026-09-18",
      body: "Access requests go back and forth for about a week on most new clients.",
      file_url: null,
      created_at: at,
      updated_at: at,
    },
  ];
}

/** What each demo source is linked to: the same links a migrated database starts with (the steps whose figures cite it, the issue that lists it). */
export function demoSourceLinks(): SourceLinkRow[] {
  return northbeamSourceLinks().map((l, i) => ({ ...l, id: `b0000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, created_at: "2026-09-29T09:00:00Z", created_by: null }));
}

/** What the demo's pickers offer a source to be linked to: its processes, steps, issues and the insights it has acted on. */
export function demoLinkTargets(bundle: ProcessBundle = demoBundle()): LinkTargets {
  const parts = [{ process: bundle.process, steps: bundle.steps }, ...(bundle.otherProcesses ?? [])];
  const issues = northbeamIssues();
  return {
    processes: processesOf(bundle).map((p) => ({ id: p.id, name: p.name })),
    steps: parts.flatMap((p) => p.steps.filter((s) => (s.replaced_by?.length ?? 0) === 0).map((s) => ({ id: s.id, processId: s.process_id, name: s.name }))),
    insights: issues.flatMap((i) => (i.detected_key && i.status !== "dismissed" ? [{ key: i.detected_key, title: i.title }] : [])),
    issues: issues.map((i) => ({ id: i.id, number: i.number, title: i.title })),
    solutions: [],
  };
}
