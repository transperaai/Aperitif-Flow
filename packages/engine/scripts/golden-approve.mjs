// Approve new golden baselines (docs/engine-versioning.md):
//
//   pnpm --filter @transpera-flow/engine golden:approve "why the numbers moved"
//   pnpm --filter @transpera-flow/engine golden:approve --bump "why"   (bump even if no number moved)
//
// Runs the golden test in approve mode, which rewrites packages/engine/golden/,
// bumps ENGINE_VERSION in src/version.ts and records the version in
// golden/versions.json, then runs it again normally to check the result.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2).filter((a) => a !== "--");
const bump = args.includes("--bump");
const note = args
  .filter((a) => a !== "--bump")
  .join(" ")
  .trim();
const cwd = fileURLToPath(new URL("..", import.meta.url));
const vitest = (env) =>
  spawnSync("pnpm", ["exec", "vitest", "run", "test/golden.test.ts"], { cwd, stdio: "inherit", env: { ...process.env, ...env } });

const approved = vitest({ GOLDEN_APPROVE: "1", GOLDEN_NOTE: note, GOLDEN_BUMP: bump ? "1" : "0" });
if (approved.status !== 0) process.exit(approved.status ?? 1);
const check = vitest({ GOLDEN_APPROVE: "0" });
process.exit(check.status ?? 1);
