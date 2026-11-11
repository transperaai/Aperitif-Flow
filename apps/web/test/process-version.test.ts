import { describe, expect, it } from "vitest";
import { parseVersion } from "../src/lib/process-version";

describe("parseVersion", () => {
  it("reads a whole version number", () => {
    expect(parseVersion("3")).toBe(3);
    expect(parseVersion(["2", "5"])).toBe(2);
  });
  it("shows live for anything else", () => {
    for (const v of [undefined, "", "0", "-1", "1.5", "abc", "1e3", "0x10", "99999999999"]) expect(parseVersion(v)).toBeNull();
  });
});
