// A pool of workers for the robustness check (docs/PRD.md §6.5, decision
// D11): one worker per core minus one, at least one. The pool knows nothing
// about the browser: it is given a factory for worker-like objects, so the
// app passes `new Worker(...)`, tests pass fakes, and the benchmark passes
// blob workers in headless Chromium.
//
// A worker script answers each `RobustnessRequest` with a `RobustnessResponse`
// via `handleRobustnessRequest`. The engine is synchronous, so cancelling
// terminates the busy workers; the pool starts fresh ones for the next batch.

import { RobustnessCancelled, runRobustnessTask, type ChunkResult, type RobustnessExecutor, type RobustnessTask } from "./robustness";

export interface RobustnessRequest {
  id: number;
  task: RobustnessTask;
}

export type RobustnessResponse = { id: number; ok: true; result: ChunkResult } | { id: number; ok: false; error: string };

/** What a worker script does with a request. */
export function handleRobustnessRequest({ id, task }: RobustnessRequest): RobustnessResponse {
  try {
    return { id, ok: true, result: runRobustnessTask(task) };
  } catch (err) {
    return { id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** The parts of a Web Worker the pool uses. */
export interface PoolWorker {
  postMessage(message: RobustnessRequest): void;
  terminate(): void;
  onmessage: ((event: { data: RobustnessResponse }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

/** One worker per core, minus one for the page, and at least one. */
export function poolSize(hardwareConcurrency: number | undefined): number {
  const cores = Number.isFinite(hardwareConcurrency) && hardwareConcurrency! > 0 ? Math.floor(hardwareConcurrency!) : 2;
  return Math.max(1, cores - 1);
}

interface Slot {
  worker: PoolWorker;
  busy: boolean;
}

/**
 * Runs robustness tasks across up to `size` workers. `execute` is a
 * `RobustnessExecutor`: pass it to `checkRobustness`. One batch at a time.
 */
export class RobustnessPool {
  private slots: Slot[] = [];
  private nextId = 1;

  constructor(
    private readonly createWorker: () => PoolWorker,
    readonly size: number,
  ) {}

  /** Workers started so far (for tests and diagnostics). */
  get workers(): number {
    return this.slots.length;
  }

  execute: RobustnessExecutor = (tasks, { onResult, signal }) =>
    new Promise<ChunkResult[]>((resolve, reject) => {
      if (signal?.aborted) return reject(new RobustnessCancelled());
      const results: ChunkResult[] = new Array(tasks.length);
      let next = 0;
      let finished = 0;
      let settled = false;
      const inFlight = new Map<number, { slot: Slot; index: number }>();

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", abort);
        // Busy workers may be mid-task: stop them; idle ones are kept.
        for (const { slot } of inFlight.values()) this.drop(slot);
        inFlight.clear();
        reject(err);
      };
      const abort = () => fail(new RobustnessCancelled());
      signal?.addEventListener("abort", abort);

      const dispatch = (slot: Slot) => {
        if (settled) return;
        if (next >= tasks.length) {
          slot.busy = false;
          return;
        }
        const index = next++;
        const id = this.nextId++;
        slot.busy = true;
        inFlight.set(id, { slot, index });
        slot.worker.onmessage = (event) => {
          const msg = event.data;
          const entry = inFlight.get(msg.id);
          if (!entry || settled) return;
          inFlight.delete(msg.id);
          if (!msg.ok) return fail(new Error(msg.error));
          results[entry.index] = msg.result;
          finished++;
          onResult(entry.index, msg.result);
          if (finished === tasks.length) {
            settled = true;
            slot.busy = false;
            signal?.removeEventListener("abort", abort);
            resolve(results);
            return;
          }
          dispatch(slot);
        };
        slot.worker.onerror = (event) => fail(new Error(event.message || "Robustness worker failed"));
        slot.worker.postMessage({ id, task: tasks[index]! });
      };

      if (!tasks.length) {
        settled = true;
        signal?.removeEventListener("abort", abort);
        return resolve(results);
      }
      const wanted = Math.min(this.size, tasks.length);
      while (this.slots.length < wanted) this.slots.push({ worker: this.createWorker(), busy: false });
      for (const slot of this.slots.slice(0, wanted)) dispatch(slot);
    });

  /** Stop every worker. The pool can still be used; it starts new ones. */
  dispose(): void {
    for (const slot of this.slots) slot.worker.terminate();
    this.slots = [];
  }

  private drop(slot: Slot) {
    slot.worker.terminate();
    this.slots = this.slots.filter((s) => s !== slot);
  }
}
