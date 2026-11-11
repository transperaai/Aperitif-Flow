import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Help } from "@/components/help";
import { HELP_CLOSED, helpStep, type HelpEvent, type HelpState } from "@/lib/shell/help-state";

// The (i) help button (issue #98): when it is open, and what it renders.

const run = (events: HelpEvent[], from: HelpState = HELP_CLOSED) => events.reduce(helpStep, from);

describe("helpStep: mouse", () => {
  it("opens on hover and closes when the pointer leaves", () => {
    expect(run(["pointer-enter"]).open).toBe(true);
    expect(run(["pointer-enter", "pointer-leave"]).open).toBe(false);
  });
  it("stays open after a click even when the pointer leaves", () => {
    // A mouse click hovers, focuses, then clicks.
    const s = run(["pointer-enter", "focus", "activate", "pointer-leave"]);
    expect(s).toEqual({ open: true, pinned: true });
  });
  it("closes on a second click", () => expect(run(["pointer-enter", "focus", "activate", "activate"]).open).toBe(false));
});

describe("helpStep: touch", () => {
  it("opens on the first tap and closes on the second (a touch has no hover; the tap focuses then clicks)", () => {
    expect(run(["focus", "activate"])).toEqual({ open: true, pinned: true });
    expect(run(["focus", "activate", "activate"]).open).toBe(false);
  });
  it("closes when the person taps elsewhere", () => expect(run(["focus", "activate", "outside"])).toEqual(HELP_CLOSED));
});

describe("helpStep: keyboard", () => {
  it("opens when the button gets focus and closes when focus leaves", () => {
    expect(run(["focus"]).open).toBe(true);
    expect(run(["focus", "blur"])).toEqual(HELP_CLOSED);
  });
  it("pins on Enter or Space, and a second press closes", () => {
    expect(run(["focus", "activate"]).pinned).toBe(true);
    expect(run(["focus", "activate", "activate"]).open).toBe(false);
  });
  it("closes on Escape, even when pinned, and forgets the pin", () => expect(run(["focus", "activate", "escape"])).toEqual(HELP_CLOSED));
  it("closes when focus moves on, even when pinned", () => expect(run(["focus", "activate", "blur"])).toEqual(HELP_CLOSED));
});

describe("Help", () => {
  const html = renderToStaticMarkup(
    createElement(Help, { label: "Availability floor", description: "Share of the week kept for sales work.", example: "At 20%, a 40-hour week keeps 8 hours." }),
  );
  it("is a button with an accessible name that says what it is about", () => {
    expect(html).toContain('<button ');
    expect(html).toContain('aria-label="About Availability floor"');
  });
  it("is type=button, so it never submits a form it sits in", () => expect(html).toContain('type="button"'));
  it("starts closed", () => {
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Example</b>");
  });
  it("describes itself to screen readers, open or not", () => {
    const id = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`<span id="${id}" class="sr-only">Share of the week kept for sales work. Example: At 20%, a 40-hour week keeps 8 hours.</span>`);
  });
  it("shows the letter i, hidden from screen readers", () => expect(html).toContain('<span aria-hidden="true">i</span>'));
});
