/// <reference lib="webworker" />
import { simulate } from "@transpera-flow/engine";
import { summarise } from "@/lib/overview/projection";
import type { ProjectionRequest, ProjectionResponse } from "@/lib/overview/use-projection";

// The Overview's MRR chart: the model run for each length in turn (same seed, so the runs line up), off the main thread.
self.onmessage = (event: MessageEvent<ProjectionRequest>) => {
  const { id, model, weeks, reps, seed } = event.data;
  let response: ProjectionResponse;
  try {
    response = {
      id,
      ok: true,
      runs: weeks.map((w) => {
        const shorter = { ...model, horizonWeeks: w };
        return summarise(shorter, simulate(shorter, reps, seed));
      }),
    };
  } catch (err) {
    response = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(response);
};
