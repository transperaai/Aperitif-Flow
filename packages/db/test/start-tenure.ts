import { expect } from "vitest";
import type { EngineModel } from "@transpera-flow/engine";
import { monthsBetween, type ProcessBundle } from "../src";

/**
 * The engine's golden fixtures predate client start dates (audit finding 16): each named client with a start date now carries
 * `monthsActive`, the months from that date to the run start. This checks that number for every client, then drops it, so the
 * rest of the model can still be compared with a fixture.
 */
export function withoutStartTenure(model: EngineModel, bundle: ProcessBundle, startDate: string): EngineModel {
  if (!model.clients) return model;
  const byId = new Map((bundle.clients ?? []).map((c) => [c.id, c]));
  const clients = Object.fromEntries(
    Object.entries(model.clients).map(([id, c]) => {
      const row = byId.get(id);
      const { monthsActive, ...rest } = c;
      expect(monthsActive, `client ${id}'s months active`).toBe(row?.start_date ? monthsBetween(row.start_date, startDate) : undefined);
      return [id, rest];
    }),
  );
  return { ...model, clients };
}
