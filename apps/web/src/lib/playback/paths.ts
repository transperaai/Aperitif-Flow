// Points along the edges React Flow actually drew. Sampling a path once (with
// the SVG path's own getTotalLength/getPointAtLength) and interpolating the
// samples each frame keeps per-token cost to a few multiplications; a path is
// re-sampled only when its `d` changes (an edit, a drag, the swimlane view).

/** The part of SVGPathElement used here, so the sampling is testable without a DOM. */
export interface PathLike {
  getTotalLength(): number;
  getPointAtLength(length: number): { x: number; y: number };
}

export interface SampledPath {
  /** The path data it was sampled from. */
  d: string;
  /** x, y pairs at equal steps of length from the start to the end. */
  points: Float64Array;
}

/** Samples per 100 px of path, and the bounds on the number of samples. */
const DENSITY = 8;
const MIN_SAMPLES = 16;
const MAX_SAMPLES = 256;

export function samplePath(path: PathLike, d: string): SampledPath {
  const length = path.getTotalLength();
  const n = Math.min(MAX_SAMPLES, Math.max(MIN_SAMPLES, Math.ceil((length / 100) * DENSITY)));
  const points = new Float64Array((n + 1) * 2);
  for (let i = 0; i <= n; i++) {
    const p = path.getPointAtLength((length * i) / n);
    points[i * 2] = p.x;
    points[i * 2 + 1] = p.y;
  }
  return { d, points };
}

/** The point a share `progress` (clamped to [0, 1]) of the way along a sampled path. */
export function pointAlong(path: SampledPath, progress: number, out: { x: number; y: number }): { x: number; y: number } {
  const n = path.points.length / 2 - 1;
  const f = Math.min(1, Math.max(0, progress)) * n;
  const i = Math.min(n - 1, Math.floor(f));
  const r = f - i;
  const p = path.points;
  out.x = p[i * 2]! + (p[i * 2 + 2]! - p[i * 2]!) * r;
  out.y = p[i * 2 + 1]! + (p[i * 2 + 3]! - p[i * 2 + 1]!) * r;
  return out;
}

/** Where the i-th queued item sits, left of a step's card: columns filling leftwards, then rows down. */
export function queueSlot(
  i: number,
  node: { x: number; y: number; height: number },
  out: { x: number; y: number },
): { x: number; y: number } {
  const col = i % QUEUE_COLUMNS;
  const row = Math.floor(i / QUEUE_COLUMNS);
  out.x = node.x - QUEUE_GAP - col * QUEUE_PITCH;
  out.y = node.y + Math.min(node.height / 2 - QUEUE_PITCH, QUEUE_TOP) + row * QUEUE_PITCH;
  return out;
}

export const QUEUE_COLUMNS = 4;
/** Most queued items drawn at a step; the count badge says how many there are. */
export const QUEUE_MAX_DRAWN = QUEUE_COLUMNS * 5;
const QUEUE_GAP = 9;
const QUEUE_PITCH = 11;
const QUEUE_TOP = 12;
