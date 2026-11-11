import { unlinkSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "../src";
import {
  GOLDEN_MODELS,
  baselineDigest,
  baselineNames,
  compareVersions,
  goldenPath,
  nextMinor,
  parseVersion,
  readBaseline,
  readLedger,
  runGolden,
  writeBaseline,
  writeEngineVersion,
  writeLedger,
  type KeyOutputs,
} from "./golden";

// Golden models (docs/PRD.md §6.9 layer 3; issue #22). Each golden model's key
// outputs at a fixed seed must equal its baseline in packages/engine/golden/
// exactly, and the baselines must be the ones approved for ENGINE_VERSION in
// golden/versions.json. So any change that moves a snapshotted number fails
// here until `pnpm --filter @transpera-flow/engine golden:approve "<why>"`
// writes new baselines and bumps the version (docs/engine-versioning.md).
// That command runs this file with GOLDEN_APPROVE=1.

/** Straight to the terminal: vitest holds back console output of passing tests. */
const say = (line: string) => process.stderr.write(`${line}\n`);

const APPROVE_COMMAND ='pnpm --filter @transpera-flow/engine golden:approve "<why the numbers moved>"';

/** "path: old → new" for every number or value that differs, for the approval log. */
function differences(before: unknown, after: unknown, path = ""): string[] {
  if (before && after && typeof before === "object" && typeof after === "object") {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((k) =>
      differences((before as Record<string, unknown>)[k], (after as Record<string, unknown>)[k], path ? `${path}.${k}` : k),
    );
  }
  return Object.is(before, after) ? [] : [`${path}: ${JSON.stringify(before)} → ${JSON.stringify(after)}`];
}

function approve(): void {
  const actual: Record<string, KeyOutputs> = Object.fromEntries(GOLDEN_MODELS.map((g) => [g.name, runGolden(g)]));
  const digest = baselineDigest(actual);
  const ledger = readLedger();
  const last = ledger.at(-1);
  const changed = GOLDEN_MODELS.filter((g) => {
    const b = readBaseline(g.name);
    return !b || b.engineVersion !== ENGINE_VERSION || b.seed !== g.seed || b.reps !== g.reps || differences(b.outputs, actual[g.name]).length > 0;
  });
  const stale = baselineNames().filter((n) => !GOLDEN_MODELS.some((g) => g.name === n));
  const bump = process.env.GOLDEN_BUMP === "1";
  if (!changed.length && !stale.length && last?.version === ENGINE_VERSION && last.digest === digest && !bump) {
    say(`Golden baselines already match engine ${ENGINE_VERSION}; nothing to approve.`);
    return;
  }
  const note = (process.env.GOLDEN_NOTE ?? "").trim();
  if (!note) throw new Error(`Say why the numbers moved: ${APPROVE_COMMAND}`);
  if (!parseVersion(ENGINE_VERSION)) throw new Error(`ENGINE_VERSION "${ENGINE_VERSION}" isn't major.minor.patch`);
  // The first approval keeps ENGINE_VERSION; later ones take the next minor
  // version, or ENGINE_VERSION if someone raised it by hand (a new major).
  const version = !last ? ENGINE_VERSION : compareVersions(ENGINE_VERSION, last.version) > 0 ? ENGINE_VERSION : nextMinor(last.version);

  for (const g of GOLDEN_MODELS) {
    const before = readBaseline(g.name);
    const moved = before ? differences(before.outputs, actual[g.name]) : ["(new baseline)"];
    if (moved.length) {
      say(`\n${g.name}: ${moved.length} value(s) moved`);
      for (const line of moved.slice(0, 40)) say(`  ${line}`);
      if (moved.length > 40) say(`  … and ${moved.length - 40} more`);
    }
    writeBaseline({ model: g.name, description: g.description, engineVersion: version, seed: g.seed, reps: g.reps, outputs: actual[g.name]! });
  }
  for (const n of stale) unlinkSync(goldenPath(n));
  writeEngineVersion(version);
  writeLedger([...ledger, { version, date: new Date().toISOString().slice(0, 10), note, digest }]);
  say(`\nApproved engine ${version}: wrote packages/engine/golden/ and src/version.ts. Commit them together.`);
}

if (process.env.GOLDEN_APPROVE === "1") {
  describe("approving the golden baselines", () => {
    it("writes the baselines, bumps ENGINE_VERSION and records the version", approve, 120_000);
  });
} else {
  describe("golden models", () => {
    for (const g of GOLDEN_MODELS) {
      it(`${g.name}: key outputs at seed ${g.seed} match the approved baseline exactly`, () => {
        const baseline = readBaseline(g.name);
        expect(baseline, `No baseline for ${g.name}: run ${APPROVE_COMMAND}`).not.toBeNull();
        expect({ seed: baseline!.seed, reps: baseline!.reps }).toEqual({ seed: g.seed, reps: g.reps });
        expect(
          runGolden(g),
          `Engine behaviour changed: ${g.name}'s snapshotted outputs moved. If that is intended, approve the new baseline with ${APPROVE_COMMAND} (docs/engine-versioning.md).`,
        ).toEqual(baseline!.outputs);
      }, 60_000);
    }

    it("has a baseline for every golden model and no others", () => {
      expect(baselineNames()).toEqual(GOLDEN_MODELS.map((g) => g.name).sort());
    });
  });

  describe("engine version", () => {
    const ledger = readLedger();

    it("is major.minor.patch", () => {
      expect(parseVersion(ENGINE_VERSION)).not.toBeNull();
    });

    it("every baseline was produced with ENGINE_VERSION", () => {
      for (const g of GOLDEN_MODELS) {
        expect(readBaseline(g.name)?.engineVersion, `${g.name}'s baseline is from another engine version: run ${APPROVE_COMMAND}`).toBe(ENGINE_VERSION);
      }
    });

    it("is the latest approved version, and the baselines on disk are the ones approved with it", () => {
      // A baseline edited without approving (and so without a version bump)
      // no longer matches the digest recorded for the current version.
      const last = ledger.at(-1);
      expect(last?.version, `ENGINE_VERSION isn't the last entry of golden/versions.json: run ${APPROVE_COMMAND}`).toBe(ENGINE_VERSION);
      const onDisk = Object.fromEntries(GOLDEN_MODELS.map((g) => [g.name, readBaseline(g.name)!.outputs]));
      expect(baselineDigest(onDisk), `The baselines changed without a version bump: run ${APPROVE_COMMAND}`).toBe(last!.digest);
    });

    it("has a ledger of increasing versions, each with a reason", () => {
      expect(ledger.length).toBeGreaterThan(0);
      for (const [i, e] of ledger.entries()) {
        expect(parseVersion(e.version), e.version).not.toBeNull();
        expect(e.note.trim().length, `${e.version} needs a note saying why the numbers moved`).toBeGreaterThan(0);
        expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(e.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
        if (i > 0) expect(compareVersions(e.version, ledger[i - 1]!.version), `${e.version} must come after ${ledger[i - 1]!.version}`).toBeGreaterThan(0);
      }
    });

    it("bumps to the next minor version", () => {
      expect(nextMinor("1.0.0")).toBe("1.1.0");
      expect(nextMinor("2.9.3")).toBe("2.10.0");
      expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    });
  });
}
