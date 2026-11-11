"use client";

// The bottleneck's shadow price in the browser (docs/PRD.md §6.4, issue #26):
// once the baseline run is in, an extra replication set with one more FTE in
// the bottleneck role runs in its own worker, with the baseline's seed and
// replication count so the two pair up. A newer model or role cancels it.

import { useEffect, useState } from "react";
import type { EngineModel, ShadowPrice } from "@transpera-flow/engine";

export interface ShadowRequest {
  id: number;
  model: EngineModel;
  roleId: string;
  reps: number;
  seed: number;
}

export type ShadowResponse = { id: number; ok: true; value: ShadowPrice | null } | { id: number; ok: false; error: string };

export type ShadowState =
  | { status: "idle"; value: null }
  | { status: "running"; value: null }
  | { status: "done"; value: ShadowPrice | null }
  | { status: "error"; value: null; error: string };

const DEBOUNCE_MS = 250;
const IDLE: ShadowState = { status: "idle", value: null };

/** The shadow price of `roleId` in `model`, computed in a worker; idle while either is missing. */
export function useShadowPrice(model: EngineModel | null, roleId: string | null, reps = 30, seed = 1): ShadowState {
  const [state, setState] = useState<{ key: unknown[]; value: ShadowState }>({ key: [], value: IDLE });
  const key = [model, roleId, reps, seed];
  const current = state.key.length === key.length && state.key.every((k, i) => k === key[i]) ? state.value : model && roleId ? { status: "running" as const, value: null } : IDLE;

  useEffect(() => {
    if (!model || !roleId) return;
    let worker: Worker | null = null;
    const settle = (value: ShadowState) => setState({ key: [model, roleId, reps, seed], value });
    const timer = setTimeout(() => {
      worker = new Worker(new URL("../../workers/shadow-price.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<ShadowResponse>) => {
        const msg = event.data;
        settle(msg.ok ? { status: "done", value: msg.value } : { status: "error", value: null, error: msg.error });
        worker?.terminate();
      };
      worker.onerror = (event) => settle({ status: "error", value: null, error: event.message || "Shadow price worker failed" });
      worker.postMessage({ id: 1, model, roleId, reps, seed } satisfies ShadowRequest);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      worker?.terminate();
    };
  }, [model, roleId, reps, seed]);

  return current;
}
