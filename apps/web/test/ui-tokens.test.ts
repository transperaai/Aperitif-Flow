import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// components/ui/* is vendored from shadcn. Our `accent` is the brand blue, not shadcn's neutral hover,
// so a later `shadcn add` must not bring the neutral meaning (or default rings and raw colours) back.
const dir = join(__dirname, "../src/components/ui");
const files = readdirSync(dir).filter((f) => f.endsWith(".tsx"));

describe("vendored shadcn components use our tokens", () => {
  it("has components to check", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const f of files) {
    const src = readFileSync(join(dir, f), "utf8");
    // Hover, focus and open state must be neutral (`muted`). Brand accent stays for selection: `data-[state=on]`, `data-[active=true]`.
    const accentHover = /(?:hover|focus|focus-visible|data-\[state=open\]):(?:[\w\[\]=&:-]+:)*(?:bg|text|border)-accent(?:-foreground)?\b/;

    it(`${f}: no accent for hover, focus or open state`, () => {
      expect(src).not.toMatch(accentHover);
    });
    it(`${f}: no 50%-alpha focus ring or 3px ring`, () => {
      expect(src).not.toContain("ring-ring/50");
      expect(src).not.toContain("ring-[3px]");
    });
    it(`${f}: no raw hex colour`, () => {
      expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    });
  }
});
