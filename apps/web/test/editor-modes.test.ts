import { describe, expect, it } from "vitest";
import { horizonWeeks } from "@/lib/horizon";
import { EDITOR_MODES, editorHorizonWeeks, MODE_INFO, SOLUTION_FOR_ISSUE, exitHref, isEditorPath, parseEditorMode, parseHorizon, parseIssueParam, withHorizon } from "@/lib/editor/modes";

// The Editor's modes and where it lives (issue #104).

describe("editor modes", () => {
  it("reads the mode from the address, and falls back to a draft", () => {
    expect(parseEditorMode("solution")).toBe("solution");
    expect(parseEditorMode(["block", "draft"])).toBe("block");
    expect(parseEditorMode("nonsense")).toBe("draft");
    expect(parseEditorMode(undefined)).toBe("draft");
    expect(parseHorizon("12")).toBe(12);
    expect(parseHorizon(["6"])).toBe(6);
    expect(parseHorizon("7")).toBeNull();
    expect(parseHorizon(undefined)).toBeNull();
    expect(withHorizon("/demo/edit", 12)).toBe("/demo/edit?horizon=12");
    expect(withHorizon("/demo/edit?nested=1", 3)).toBe("/demo/edit?nested=1&horizon=3");
    expect(withHorizon("/demo/edit", null)).toBe("/demo/edit");
  });

  it("says what each mode is in a hint and gives it its own save buttons", () => {
    for (const mode of EDITOR_MODES) {
      expect(MODE_INFO[mode].hint.length).toBeGreaterThan(20);
      expect(MODE_INFO[mode].save.length).toBeGreaterThan(0);
    }
    expect(MODE_INFO.draft.hint).toMatch(/live map doesn't change until you publish/);
    expect(MODE_INFO.draft.save.map((s) => s.label)).toEqual(["Save draft", "Publish…"]);
    expect(MODE_INFO.solution.save.map((s) => s.label)).toEqual(["Save solution"]);
    expect(MODE_INFO.block.save.map((s) => s.label)).toEqual(["Save to library"]);
    // All three modes are built (solutions: A49).
    expect(EDITOR_MODES.filter((m) => MODE_INFO[m].available)).toEqual(["draft", "solution", "block"]);
    expect(MODE_INFO.solution.hint).toMatch(/never change the live map/);
    expect(MODE_INFO.solution.title("Lead to live")).toBe("New solution · Lead to live");
    expect(SOLUTION_FOR_ISSUE.title({ number: 12, title: "Strategist bottleneck" })).toBe("Solution for #12 · Strategist bottleneck");
    expect(SOLUTION_FOR_ISSUE.title({ number: null, title: "Slow" })).toBe("Solution for issue · Slow");
    expect(SOLUTION_FOR_ISSUE.hint).toMatch(/red outline is the area this issue touches/);
    expect(parseIssueParam("3f1c2b4a-0000-4000-8000-000000000001")).toBe("3f1c2b4a-0000-4000-8000-000000000001");
    expect(parseIssueParam("not-an-id")).toBeNull();
    expect(parseIssueParam(undefined)).toBeNull();
    expect(MODE_INFO.draft.title("Lead to live")).toBe("Draft of Lead to live");
  });

  it("returns to the page it came from, but only a page of this site", () => {
    expect(exitHref("/w/acme/issues", "/w/acme/p/1")).toBe("/w/acme/issues");
    expect(exitHref(undefined, "/w/acme/p/1")).toBe("/w/acme/p/1");
    expect(exitHref("https://elsewhere.example/", "/demo")).toBe("/demo");
    expect(exitHref("//elsewhere.example/", "/demo")).toBe("/demo");
    expect(exitHref("/\\elsewhere.example", "/demo")).toBe("/demo");
    // What a browser strips or rewrites before it follows a link.
    expect(exitHref("/\t/example.org/phish", "/demo")).toBe("/demo");
    expect(exitHref("\t//example.org", "/demo")).toBe("/demo");
    expect(exitHref("/\n/example.org", "/demo")).toBe("/demo");
    expect(exitHref("\\\\example.org", "/demo")).toBe("/demo");
    expect(exitHref("javascript:alert(1)", "/demo")).toBe("/demo");
    // Encoded, it is only a path of this site.
    expect(exitHref("/%09/example.org/phish", "/demo")).toBe("/%09/example.org/phish");
    expect(exitHref("/w/acme/issues?x=1#top", "/demo")).toBe("/w/acme/issues?x=1#top");
  });

  it("knows which pages are the Editor, which show no sidebar", () => {
    expect(isEditorPath("/demo/edit")).toBe(true);
    expect(isEditorPath("/w/acme/p/3f1c/edit")).toBe(true);
    expect(isEditorPath("/w/acme/p/3f1c")).toBe(false);
    expect(isEditorPath("/demo")).toBe(false);
    expect(isEditorPath("/w/acme/edit")).toBe(false);
    expect(isEditorPath(null)).toBe(false);
  });
});

describe("the horizon in the Editor", () => {
  it("ignores the map's picked horizon in solution mode, so the footer matches the server", () => {
    expect(editorHorizonWeeks("solution", 12)).toBeNull();
    expect(editorHorizonWeeks("solution", null)).toBeNull();
    expect(editorHorizonWeeks("draft", null)).toBeNull();
    expect(editorHorizonWeeks("draft", 12)).toBe(horizonWeeks(12));
    expect(editorHorizonWeeks("block", 6)).toBe(horizonWeeks(6));
  });
});
