# 9. Golden baselines are exact, and a version ledger ties each baseline to an engine version

Date: 30 Sep 2026 · Status: accepted · Issue: #22 · Implements PRD §6.9 layer 3, D16

## Context

No engine change may move a number unnoticed. The PRD asks for golden models (Northbeam and a messier second
agency) whose key outputs are snapshotted, a CI failure on any change until the new baseline is approved, and an
`engine_version` bump that runs record.

## Decision

- **Three golden models** at the app's defaults (30 replications, seed 1): Northbeam's prototype model, Northbeam as
  seeded, and Larkspur Creative, the messier agency, whose rows are also seeded. Details in
  `docs/engine-versioning.md`.
- **Exact comparison, no tolerances.** The engine is deterministic across hosts (per-purpose streams, portable
  `log`/`exp`, and the browser-determinism tests cover every golden model). A tolerance would let small drifts pile
  up across changes, which is what the check exists to stop.
- **Baselines in the repo** as JSON with one metric per line, so review is a diff.
- **A ledger, `golden/versions.json`,** records each approved version with the date, the reason and a sha256 of the
  baselines. The test requires the baselines on disk to match the digest recorded for `ENGINE_VERSION`, so a
  baseline can't change without a new version, whether by hand or by regenerating it.
- **One command approves**: `pnpm --filter @transpera-flow/engine golden:approve "<why>"` writes the baselines,
  bumps `ENGINE_VERSION` to the next minor version and appends to the ledger. A reason is required.
- **The version travels with results**: `SimulationResult.engineVersion`, `runs.engine_version` (the column #25
  added; no migration), MCP results, and the PDF report's methodology page. Saved runs from an older engine say so.

## Consequences

- Any refactor that reorders floating-point arithmetic needs an approval and a version bump. That is deliberate:
  bumps are cheap, and saved runs then say truthfully that the engine changed.
- The version is semver-shaped but only minor bumps are automatic; a major bump is a hand edit before approving.
- Adding a golden model or an output kept is itself a baseline change and bumps the version.
