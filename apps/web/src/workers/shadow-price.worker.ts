/// <reference lib="webworker" />
import { shadowPrice } from "@transpera-flow/engine";
import type { ShadowRequest, ShadowResponse } from "@/lib/sim/shadow-price";

// The shadow price's extra replication set (docs/PRD.md §6.4), off the main thread.
self.onmessage = (event: MessageEvent<ShadowRequest>) => {
  const { id, model, roleId, reps, seed } = event.data;
  let response: ShadowResponse;
  try {
    response = { id, ok: true, value: shadowPrice(model, roleId, { reps, seed }) };
  } catch (err) {
    response = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(response);
};
