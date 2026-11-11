/// <reference lib="webworker" />
import { shadowPricesFor } from "@transpera-flow/engine";
import type { IssueCostsRequest, IssueCostsResponse } from "@/lib/issues/use-detected";

// The extra runs behind the "too busy" cost (what one more person would bring), off the main thread.
self.onmessage = (event: MessageEvent<IssueCostsRequest>) => {
  const { id, model, roleIds, reps, seed } = event.data;
  let response: IssueCostsResponse;
  try {
    response = { id, ok: true, value: shadowPricesFor(model, roleIds, { reps, seed }) };
  } catch (err) {
    response = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(response);
};
