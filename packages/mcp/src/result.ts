import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Every tool returns {ok, data, assumptions[]} (docs/PRD.md §7.1): `assumptions`
// lists any parameter that was defaulted rather than given.

export type ToolPayload<T> =
  | { ok: true; data: T; assumptions: string[] }
  | { ok: false; data: null; error: { code: string; message: string; candidates?: unknown[] }; assumptions: string[] };

/** A failure the caller can act on (bad input, nothing visible, ambiguous name). */
export class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly candidates?: unknown[],
  ) {
    super(message);
  }
}

export function toCallToolResult<T>(payload: ToolPayload<T>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    ...(payload.ok ? {} : { isError: true }),
  };
}

/** Run a tool body, turning ToolErrors into `{ok: false}` results. */
export async function runTool<T>(body: (assumptions: string[]) => Promise<T>): Promise<CallToolResult> {
  const assumptions: string[] = [];
  try {
    return toCallToolResult({ ok: true, data: await body(assumptions), assumptions });
  } catch (err) {
    if (err instanceof ToolError) {
      return toCallToolResult({
        ok: false,
        data: null,
        error: { code: err.code, message: err.message, ...(err.candidates ? { candidates: err.candidates } : {}) },
        assumptions,
      });
    }
    throw err;
  }
}
