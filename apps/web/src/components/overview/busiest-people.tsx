"use client";

// "Busiest people" on the Overview (the Overview option BP1): only the people over their own utilisation threshold or close under it, the rest
// folded away. The same busy bar and threshold tick as the Capacity page; the full list lives there.

import Link from "next/link";
import { DEFAULT_AT_RISK_MARGIN } from "@transpera-flow/db";
import { BusyBar } from "@/components/capacity/widgets";
import { SectionCard } from "@/components/page-kit";
import { Skeleton } from "@/components/ui/skeleton";
import type { BusyPerson } from "./department-cards";
import { PanelActions } from "./panel-how";

/** The margin in whole percentage points, for the words. */
const pointsOf = (margin: number) => Math.round(margin * 100);

/**
 * Over their threshold, or within `margin` under it (busiest first), and everyone else. The margin is the workspace's at-risk margin
 * (`settings.at_risk_margin`, Settings > Simulation), the same one the Capacity page's "at risk" uses.
 */
export function closeToThreshold<P extends { busy: number; line: number }>(people: readonly P[], margin: number = DEFAULT_AT_RISK_MARGIN): { close: P[]; rest: P[] } {
  const ordered = [...people].sort((a, b) => b.busy - a.busy);
  const isClose = (p: P) => p.busy >= p.line - margin - 1e-9;
  return { close: ordered.filter(isClose), rest: ordered.filter((p) => !isClose(p)) };
}

/** The answer in a sentence: "1 over and 3 within 10 points of their utilisation threshold." */
export function busiestAnswer(close: readonly { busy: number; line: number }[], margin: number = DEFAULT_AT_RISK_MARGIN): string {
  const over = close.filter((p) => p.busy >= p.line).length;
  const near = close.length - over;
  const points = pointsOf(margin);
  if (!close.length) return `Nobody is over or within ${points} points of their utilisation threshold.`;
  const parts = [over ? `${over} over` : "", near ? `${near} within ${points} points` : ""].filter(Boolean);
  return `${parts.join(" and ")} of their utilisation threshold.`;
}

function PersonRow({ p, margin }: { p: BusyPerson; margin: number }) {
  return (
    <li className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)] items-center gap-3 text-sm" data-person={p.name} title={`${p.name}, ${p.roleName}`}>
      <span className="min-w-0 truncate">
        {p.name} <span className="text-xs text-muted-foreground">{p.departmentName ?? p.roleName}</span>
      </span>
      <BusyBar busy={p.busy} line={p.line} label={`${p.name}, ${p.roleName}`} margin={margin} />
    </li>
  );
}

const busiestHow = (points: number) => ({
  works: `Each person's busy share from a simulation of today's clients, against their own role's utilisation threshold (the tick on the bar). People over it, or within ${points} points under it (the at-risk margin in Settings), show here; everyone else is folded away. The Capacity page lists everyone.`,
  tells: "Who is stretched now, before they become the reason work waits.",
});

export function BusiestPeople({
  people,
  failed,
  capacityHref,
  className,
  margin = DEFAULT_AT_RISK_MARGIN,
}: {
  people: readonly BusyPerson[] | null;
  failed: boolean;
  capacityHref: string;
  className?: string;
  /** The workspace's at-risk margin (`CapacitySetup.atRiskMargin`). */
  margin?: number;
}) {
  const split = people ? closeToThreshold(people, margin) : null;
  const points = pointsOf(margin);
  return (
    <SectionCard
      id="busiest-people"
      section="busiest"
      level={2}
      title="Busiest people"
      className={className}
      description={split ? busiestAnswer(split.close, margin) : failed ? "Can't be worked out until the simulation runs." : "Working out who is busiest, from a simulation of today's clients…"}
      action={
        <PanelActions how={split ? busiestHow(points) : undefined}>
          <Link href={capacityHref} className="text-xs font-medium text-accent hover:underline">
            Capacity →
          </Link>
        </PanelActions>
      }
    >
      {split ? (
        <div className="flex flex-col gap-3" data-busiest>
          {split.close.length > 0 && (
            <ul className="flex flex-col gap-2" data-busiest-close>
              {split.close.map((p) => (
                <PersonRow key={p.id} p={p} margin={margin} />
              ))}
            </ul>
          )}
          {split.rest.length > 0 && (
            <details data-busiest-rest>
              <summary className="w-max cursor-pointer text-xs font-medium text-accent">
                {split.rest.length} {split.close.length ? "others" : split.rest.length === 1 ? "person" : "people"} more than {points} points under their utilisation threshold
              </summary>
              <ul className="mt-2 flex flex-col gap-2">
                {split.rest.map((p) => (
                  <PersonRow key={p.id} p={p} margin={margin} />
                ))}
              </ul>
            </details>
          )}
          {!people!.length && <p className="text-sm text-muted-foreground">Nobody is in the simulation yet.</p>}
        </div>
      ) : failed ? null : (
        <Skeleton className="h-24 w-full" aria-busy="true" data-running />
      )}
    </SectionCard>
  );
}
