import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NORTHBEAM_PROCESS_ID, northbeamStepIds } from "../src";
import { createTestDb, type TestDb } from "./harness";

// The step fields behind the new analysis rules (issue #107, migration
// 20261110000000): expected wait, lost per day of waiting, the work-lost
// benchmark and, on the start step, the process's time target.

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.close();
});

const COLUMNS = ["expected_wait_hours", "lost_per_day_waiting", "dropoff_benchmark", "target_cycle_hours"];

describe("step rule fields", () => {
  it("are nullable columns with no default, so existing steps are unchanged", async () => {
    const { rows } = await db.client.query(
      "select column_name, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = 'steps' and column_name = any($1) order by column_name",
      [COLUMNS],
    );
    expect(rows.map((r) => [r.column_name, r.is_nullable, r.column_default])).toEqual(COLUMNS.slice().sort().map((c) => [c, "YES", null]));
    const { rows: used } = await db.client.query(
      "select count(*)::int as n from public.steps where expected_wait_hours is not null or dropoff_benchmark is not null or target_cycle_hours is not null",
    );
    expect(used[0].n).toBe(0);
    // Only Northbeam's audit step carries a lost-per-day of waiting, so its waiting insight shows money (issue #108).
    const { rows: lost } = await db.client.query("select count(*)::int as n from public.steps where lost_per_day_waiting is not null");
    expect(lost[0].n).toBe(1);
  });

  it("accept values in range", async () => {
    await db.client.query(
      "update public.steps set expected_wait_hours = 8, lost_per_day_waiting = 0.05, dropoff_benchmark = 0.3 where id = $1",
      [northbeamStepIds.audit],
    );
    await db.client.query("update public.steps set target_cycle_hours = 120 where id = $1 and kind = 'start'", [northbeamStepIds.start]);
    const { rows } = await db.client.query(
      "select expected_wait_hours::float8 e, lost_per_day_waiting::float8 l, dropoff_benchmark::float8 d from public.steps where id = $1",
      [northbeamStepIds.audit],
    );
    expect(rows[0]).toEqual({ e: 8, l: 0.05, d: 0.3 });
    await db.client.query("update public.steps set expected_wait_hours = null, lost_per_day_waiting = null, dropoff_benchmark = null where id = $1", [northbeamStepIds.audit]);
    await db.client.query("update public.steps set target_cycle_hours = null where id = $1", [northbeamStepIds.start]);
  });

  it("refuse values out of range", async () => {
    const bad = (set: string) => expect(db.client.query(`update public.steps set ${set} where id = $1`, [northbeamStepIds.audit])).rejects.toThrow(/check constraint/);
    await bad("expected_wait_hours = -1");
    await bad("lost_per_day_waiting = 1.5");
    await bad("lost_per_day_waiting = -0.1");
    await bad("dropoff_benchmark = 2");
    await bad("target_cycle_hours = 0");
    await bad("target_cycle_hours = -5");
  });

  it("are copied into a draft with the rest of the step (open_draft copies every column)", async () => {
    await db.client.query("update public.steps set dropoff_benchmark = 0.25, expected_wait_hours = 6 where id = $1", [northbeamStepIds.audit]);
    const { rows: before } = await db.client.query("select count(*)::int as n from public.process_revisions where process_id = $1", [NORTHBEAM_PROCESS_ID]);
    expect(before[0].n).toBeGreaterThan(0);
    // Copy the way open_draft does: every column, through jsonb_populate_record.
    const { rows } = await db.client.query(
      "select (jsonb_populate_record(null::public.steps, to_jsonb(s))).dropoff_benchmark::float8 as d, (jsonb_populate_record(null::public.steps, to_jsonb(s))).expected_wait_hours::float8 as e from public.steps s where s.id = $1",
      [northbeamStepIds.audit],
    );
    expect(rows[0]).toEqual({ d: 0.25, e: 6 });
  });
});
