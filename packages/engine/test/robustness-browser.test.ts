import { build } from "esbuild";
import { chromium, type Browser } from "playwright-core";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { estimatedParameters, northbeamModel, robustness, type EngineModel, type RobustnessOptions, type RobustnessResult, type ScenarioPatch } from "../src";
import { largeModel } from "./fixtures/large-model";

// The robustness check in headless Chromium, through the real worker pool
// (one worker per core minus one): it must give the Node result exactly.
//
// Benchmark (issue #20): ROBUSTNESS_BENCH=1 also runs the full default check
// on the 40-step, 25-person model in Node (one thread) and in Chromium with
// the pool, and prints the timings. Measured on the 4-core CI container
// (3 workers): 72 estimated parameters, 3,340 replications (both sides),
// a scenario hiring one more into the busiest role:
//
//   Node, one thread ........ 62 s
//   Chromium, 3 workers ..... 23 s
//
// An 8-core laptop runs 7 workers, so ~10 s; a 4-core one ~23 s: inside the
// 10–30 s target (docs/PRD.md §6.5).

const BENCH = process.env.ROBUSTNESS_BENCH === "1";

let browser: Browser;
let engineBundle: string;

beforeAll(async () => {
  const out = await build({
    entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
    bundle: true,
    format: "iife",
    globalName: "TransperaFlowEngine",
    write: false,
    platform: "browser",
  });
  engineBundle = out.outputFiles[0]!.text;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

/** Run the check in a page, on a pool of blob workers; returns the result and the wall time. */
async function runInPool(model: EngineModel, scenario: ScenarioPatch[], opts: RobustnessOptions) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(
      async ({ bundle, model, scenario, opts }) => {
        // The page gets the engine too (for the driver and the pool).
        new Function(bundle)();
        const E = (globalThis as unknown as { TransperaFlowEngine: typeof import("../src") }).TransperaFlowEngine;
        const src = `${bundle}\nself.onmessage = (e) => self.postMessage(TransperaFlowEngine.handleRobustnessRequest(e.data));`;
        const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
        const size = E.poolSize(navigator.hardwareConcurrency);
        const pool = new E.RobustnessPool(() => new Worker(url) as never, size);
        const t = performance.now();
        const result = await E.checkRobustness(model, scenario, { ...opts, execute: pool.execute });
        const ms = performance.now() - t;
        pool.dispose();
        return { result: JSON.stringify(result), ms, workers: size };
      },
      { bundle: engineBundle.replace("var TransperaFlowEngine", "globalThis.TransperaFlowEngine"), model, scenario, opts },
    );
  } finally {
    await page.close();
  }
}

const strip = (r: RobustnessResult) => ({ ...r, stats: { ...r.stats, cached: 0 } });

describe("robustness in a browser worker pool", () => {
  it("gives exactly the Node result on Northbeam", async () => {
    const hire: ScenarioPatch[] = [{ path: "roles.strat.headcount", op: "add", value: 1 }];
    const opts = { parameters: estimatedParameters(northbeamModel()).slice(0, 8) };
    const { result } = await runInPool(northbeamModel(), hire, opts);
    expect(JSON.parse(result)).toEqual(JSON.parse(JSON.stringify(strip(robustness(northbeamModel(), hire, opts)))));
  }, 60_000);

  it.skipIf(!BENCH)(
    "benchmark: 40 steps, 25 people, default check",
    async () => {
      const model = largeModel();
      const hire: ScenarioPatch[] = [{ path: "roles.@busiest.headcount", op: "add", value: 1 }];
      const params = estimatedParameters(model).length;
      const browserRun = await runInPool(model, hire, {});
      const t = performance.now();
      const node = robustness(model, hire);
      const nodeMs = performance.now() - t;
      console.log(
        `robustness benchmark: ${params} parameters, ${node.stats.replications} replications; ` +
          `Node one thread ${(nodeMs / 1000).toFixed(1)} s; Chromium ${browserRun.workers} workers ${(browserRun.ms / 1000).toFixed(1)} s`,
      );
      expect(JSON.parse(browserRun.result)).toEqual(JSON.parse(JSON.stringify(node)));
    },
    600_000,
  );
});
