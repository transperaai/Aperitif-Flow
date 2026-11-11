// Axis maths for the Overview's charts (issue #100). Pure, so the choices are tested without a browser.

/** A "nice" set of axis values spanning `min` to `max`. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || Math.max(1, Math.abs(max));
  const rough = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + step * 1e-9; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

/** "Now", then the weeks of a short horizon, or the months of a longer one. */
export function monthLabel(month: number, horizonMonths: number): string {
  if (month === 0) return "Now";
  if (horizonMonths <= 1) return `Week ${Math.round(month * (52 / 12))}`;
  return `Month ${Number.isInteger(month) ? month : Math.round(month * 10) / 10}`;
}

/**
 * Which of `count` points on the x axis get a label, at most `max` of them: the first and the last always, and
 * evenly spaced ones between. A label too close to the last one is dropped (it would print over it).
 */
export function labelIndexes(count: number, max: number): number[] {
  if (count <= 0) return [];
  const last = count - 1;
  if (last === 0) return [0];
  const step = Math.max(1, Math.ceil(last / Math.max(1, max - 1)));
  const out: number[] = [];
  for (let i = 0; i < last; i += step) if (last - i >= step * 0.75 || i === 0) out.push(i);
  out.push(last);
  return out;
}
