import { describe, expect, it } from "vitest";
import { northbeamModel } from "@transpera-flow/engine";
import { applyOverrides, ToolError } from "../src";

// run_scenario's `overrides`: the same patches saved scenarios hold (issue #15).

describe("applyOverrides", () => {
  it("applies patches in order", () => {
    const assumptions: string[] = [];
    const model = applyOverrides(
      northbeamModel(),
      [
        { path: "steps.audit.work_hours", op: "multiply", value: 0.5 },
        { path: "steps.audit.work_hours", op: "add", value: 1 },
      ],
      assumptions,
    );
    expect(model.steps.find((s) => s.id === "audit")!.work).toBe(4);
    expect(assumptions).toEqual([]);
  });

  it("fails the call on a patch it can't apply, naming it", () => {
    let error: unknown;
    try {
      applyOverrides(northbeamModel(), [{ path: "steps.gone.work_hours", op: "set", value: 1 }], []);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe("invalid_overrides");
    expect((error as ToolError).candidates).toMatchObject([{ index: 0, problem: "missing_target" }]);
  });

  it("lists clamped values as assumptions", () => {
    const assumptions: string[] = [];
    applyOverrides(northbeamModel(), [{ path: "steps.audit.rework_rate", op: "set", value: 2 }], assumptions);
    expect(assumptions).toEqual(["Override 1: steps.audit.rework_rate would be 2; using 0.95."]);
  });
});
