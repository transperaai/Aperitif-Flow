import { RATING_LABELS, type Rating } from "@transpera-flow/engine";
import { cn } from "@/lib/utils";

/** A rating as the map shows it: its colour dot and its plain name, in the rating's soft tint. */
export function RatingPill({ rating, className }: { rating: Rating; className?: string }) {
  return (
    <span
      className={cn("inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap text-foreground", className)}
      style={{ background: `var(--rate-${rating}-soft)` }}
    >
      <i aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: `var(--rate-${rating})` }} />
      {RATING_LABELS[rating]}
    </span>
  );
}
