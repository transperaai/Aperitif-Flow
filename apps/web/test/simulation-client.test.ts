import { describe, expect, it } from "vitest";
import { northbeamModel, simulate } from "@transpera-flow/engine";
import { SimulationCancelled, SimulationClient, type WorkerLike } from "@/lib/sim/client";
import type { SimRequest, SimResponse } from "@/lib/sim/protocol";

/** A worker that runs the real engine but only replies when told to. */
class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<SimResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  inbox: SimRequest[] = [];

  postMessage(message: SimRequest) {
    this.inbox.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  reply(response?: Partial<SimResponse>) {
    const req = this.inbox.shift()!;
    const result = simulate(req.model, req.reps, req.seed);
    this.onmessage?.({ data: { id: req.id, ok: true, result, durationMs: 1, ...response } } as MessageEvent<SimResponse>);
  }
}

function setup() {
  const workers: FakeWorker[] = [];
  const client = new SimulationClient(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w;
  });
  return { client, workers };
}

describe("SimulationClient", () => {
  it("returns the engine's result from the worker", async () => {
    const { client, workers } = setup();
    const run = client.run(northbeamModel(), { reps: 5, seed: 3 });
    workers[0]!.reply();
    const { result } = await run;
    expect(result.won).toBe(simulate(northbeamModel(), 5, 3).won);
  });

  it("reuses one worker across sequential runs", async () => {
    const { client, workers } = setup();
    const a = client.run(northbeamModel(), { reps: 2 });
    workers[0]!.reply();
    await a;
    const b = client.run(northbeamModel(), { reps: 2 });
    workers[0]!.reply();
    await b;
    expect(workers).toHaveLength(1);
  });

  it("cancels a stale run by terminating its worker", async () => {
    const { client, workers } = setup();
    const stale = client.run(northbeamModel(), { reps: 2 });
    const fresh = client.run({ ...northbeamModel(), leadsPerWeek: 24 }, { reps: 2 });
    await expect(stale).rejects.toBeInstanceOf(SimulationCancelled);
    expect(workers[0]!.terminated).toBe(true);
    expect(workers).toHaveLength(2);
    workers[1]!.reply();
    expect((await fresh).result.won).toBeGreaterThan(0);
  });

  it("surfaces engine errors", async () => {
    const { client, workers } = setup();
    const run = client.run(northbeamModel(), { reps: 1 });
    workers[0]!.onmessage?.({ data: { id: 1, ok: false, error: "boom" } } as MessageEvent<SimResponse>);
    await expect(run).rejects.toThrow("boom");
  });

  it("recovers after a worker crash", async () => {
    const { client, workers } = setup();
    const run = client.run(northbeamModel(), { reps: 1 });
    workers[0]!.onerror?.({ message: "crashed" } as ErrorEvent);
    await expect(run).rejects.toThrow("crashed");
    const next = client.run(northbeamModel(), { reps: 1 });
    workers[1]!.reply();
    await expect(next).resolves.toBeTruthy();
  });
});
