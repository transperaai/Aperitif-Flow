// Seeded random helpers. `mulberry32` gives a deterministic stream per seed,
// and all transcendental maths goes through det-math so results are identical
// in every JS engine (browser and server).

import { exp, log } from "./det-math";

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample via Marsaglia's polar method (no trigonometry). */
export function randn(rng: Rng): number {
  let u: number;
  let v: number;
  let s: number;
  do {
    u = 2 * rng() - 1;
    v = 2 * rng() - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  return u * Math.sqrt((-2 * log(s)) / s);
}

/** Lognormal sample with the given mean and coefficient of variation. */
export function lognormal(rng: Rng, mean: number, cv: number): number {
  return lognormalSampler(rng, mean, cv)();
}

/** Repeated lognormal draws, with the parameters' logs computed once. Same values as `lognormal`. */
export function lognormalSampler(rng: Rng, mean: number, cv: number): () => number {
  if (mean <= 0) return () => 0;
  const s2 = log(1 + cv * cv);
  const mu = log(mean) - s2 / 2;
  const sigma = Math.sqrt(s2);
  return () => exp(mu + sigma * randn(rng));
}

/** Exponential sample with the given mean. */
export function expo(rng: Rng, mean: number): number {
  return -log(1 - rng()) * mean;
}

/** Triangular sample on [min, max] with the given mode. */
export function triangular(rng: Rng, min: number, mode: number, max: number): number {
  if (max <= min) return min;
  const u = rng();
  const c = (mode - min) / (max - min);
  return u < c ? min + Math.sqrt(u * (max - min) * (mode - min)) : max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}

/** 32-bit hash of a seed and a label (cyrb53-style mixing, truncated). */
export function hashSeed(seed: number, label: string): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < label.length; i++) {
    const ch = label.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

/**
 * Independent random streams per purpose ("arrivals", "work:<step>", ...),
 * all derived from one replication seed. Changing how often one stream is
 * drawn from leaves every other stream's sequence untouched, which gives
 * common random numbers between a baseline and a scenario.
 */
interface LabelNode {
  label: string;
  next: Map<string, LabelNode> | null;
}

/**
 * Stream labels ("servicing:<client>:<service>:<process>", ...) joined from
 * their parts once and then reused, so replications after the first neither
 * build nor rehash them (issue #19: a roster's clients each have streams).
 */
export class StreamLabels {
  private readonly root: LabelNode = { label: "", next: null };

  /** The parts joined with ":". */
  join(...parts: string[]): string {
    let node = this.root;
    for (const part of parts) {
      const next = (node.next ??= new Map());
      let child = next.get(part);
      if (!child) {
        child = { label: node === this.root ? part : `${node.label}:${part}`, next: null };
        next.set(part, child);
      }
      node = child;
    }
    return node.label;
  }
}

export class Streams {
  private readonly streams = new Map<string, Rng>();

  constructor(private readonly seed: number) {}

  get(label: string): Rng {
    let rng = this.streams.get(label);
    if (!rng) {
      rng = mulberry32(hashSeed(this.seed, label));
      this.streams.set(label, rng);
    }
    return rng;
  }
}
