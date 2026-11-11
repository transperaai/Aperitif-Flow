import { describe, expect, it } from "vitest";
import { exp, log } from "../src/det-math";
import { mulberry32 } from "../src/random";

/** Distance in units in the last place between two doubles. */
function ulps(a: number, b: number): number {
  if (a === b) return 0;
  const buf = new DataView(new ArrayBuffer(16));
  buf.setFloat64(0, a);
  buf.setFloat64(8, b);
  return Number(buf.getBigInt64(0) - buf.getBigInt64(8));
}

describe("portable log and exp", () => {
  const rng = mulberry32(2024);

  it("log is within 1 ulp of Math.log across magnitudes", () => {
    for (let i = 0; i < 100_000; i++) {
      const x = rng() * 10 ** (Math.floor(rng() * 40) - 20);
      if (x === 0) continue;
      expect(Math.abs(ulps(log(x), Math.log(x)))).toBeLessThanOrEqual(1);
    }
  });

  it("exp is within 1 ulp of Math.exp across the useful range", () => {
    for (let i = 0; i < 100_000; i++) {
      const x = (rng() - 0.5) * 1400;
      expect(Math.abs(ulps(exp(x), Math.exp(x)))).toBeLessThanOrEqual(1);
    }
  });

  it("handles special values like Math", () => {
    expect(log(0)).toBe(-Infinity);
    expect(log(-1)).toBeNaN();
    expect(log(1)).toBe(0);
    expect(log(Infinity)).toBe(Infinity);
    expect(log(Number.MIN_VALUE)).toBe(Math.log(Number.MIN_VALUE)); // subnormal input
    expect(exp(0)).toBe(1);
    expect(exp(-Infinity)).toBe(0);
    expect(exp(Infinity)).toBe(Infinity);
    expect(exp(1000)).toBe(Infinity);
    expect(exp(-1000)).toBe(0);
    expect(exp(-740)).toBe(Math.exp(-740)); // subnormal result
  });
});
