"use client";

// The runs behind the Overview's MRR chart, in their own worker so they never hold up the headline cards.
// A newer model or horizon cancels the one in flight.

import { useEffect, useState } from "react";
import type { EngineModel } from "@transpera-flow/engine";
import type { RunSummary } from "./projection";

export interface ProjectionRequest {
  id: number;
  model: EngineModel;
  /** Run lengths in weeks, shortest first. */
  weeks: number[];
  reps: number;
  seed: number;
}

export type ProjectionResponse = { id: number; ok: true; runs: RunSummary[] } | { id: number; ok: false; error: string };

export type Projection = { status: "running" } | { status: "done"; runs: RunSummary[] } | { status: "error"; error: string };

const DEBOUNCE_MS = 60;
const RUNNING: Projection = { status: "running" };

/** The model run for each length in `weeks`; `running` until they are all in. Nothing runs without a model. */
export function useProjection(model: EngineModel | null, weeks: readonly number[], reps = 30, seed = 1): Projection {
  const key = weeks.join(",");
  const [state, setState] = useState<{ model: EngineModel | null; key: string; value: Projection }>({ model: null, key, value: RUNNING });

  useEffect(() => {
    if (!model) return;
    let worker: Worker | null = null;
    const settle = (value: Projection) => setState({ model, key, value });
    const timer = setTimeout(() => {
      worker = new Worker(new URL("../../workers/projection.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<ProjectionResponse>) => {
        settle(event.data.ok ? { status: "done", runs: event.data.runs } : { status: "error", error: event.data.error });
        worker?.terminate();
      };
      worker.onerror = (event) => settle({ status: "error", error: event.message || "The projection failed" });
      worker.postMessage({ id: 1, model, weeks: key ? key.split(",").map(Number) : [], reps, seed } satisfies ProjectionRequest);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      worker?.terminate();
    };
  }, [model, key, reps, seed]);

  // A result for an older model or horizon isn't shown against a newer one.
  return model && state.model === model && state.key === key ? state.value : RUNNING;
}
