import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../src/migrations";
import { createTestDb, type TestDb } from "./harness";

// The working week and months to hire (migration 20270203004000_working_week_and_hiring_delay.sql; customisability audit 28, 36,
// 22/23/33): stored values are tidied, then hours_per_week, working_days and hiring_delay_months are checked on every write.

const BASE = "20270203003000";
let db: TestDb;
const ids: Record<string, string> = {};
const CASES: [string, string][] = [
  ["plain", '{"hours_per_week": 37.5, "working_days": 4, "hiring_delay_months": 3}'],
  ["strings", '{"hours_per_week": "38", "working_days": " 4.5 ", "hiring_delay_months": "1"}'],
  ["junk", '{"hours_per_week": "abc", "working_days": 9, "hiring_delay_months": {"a": 1}}'],
  ["zero", '{"hours_per_week": 0, "working_days": null, "hiring_delay_months": null}'],
  ["unset", '{"currency": "GBP"}'],
];

const stored = async (name: string) =>
  (await db.client.query("select settings -> 'hours_per_week' as h, settings -> 'working_days' as d, settings ? 'working_days' as has_d, settings -> 'hiring_delay_months' as m, settings ? 'hiring_delay_months' as has_m from workspaces where id = $1", [ids[name]])).rows[0] as {
    h: unknown;
    d: unknown;
    has_d: boolean;
    m: unknown;
    has_m: boolean;
  };

beforeAll(async () => {
  db = await createTestDb({ upTo: BASE });
  for (const [name, settings] of CASES) {
    ids[name] = (await db.client.query("insert into workspaces (name, slug, settings) values ($1, $2, $3::jsonb) returning id", [name, `week-${name}`, settings])).rows[0].id;
  }
  const applied = await applyMigrations(db.client, {});
  expect(applied.files[0]).toBe("20270203004000_working_week_and_hiring_delay.sql");
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("what the migration does to stored values", () => {
  it("keeps numbers in range, turns numbers written as strings into numbers, and keeps null", async () => {
    expect(await stored("plain")).toEqual({ h: 37.5, d: 4, has_d: true, m: 3, has_m: true });
    expect(await stored("strings")).toEqual({ h: 38, d: 4.5, has_d: true, m: 1, has_m: true });
    expect(await stored("zero")).toMatchObject({ h: 40, d: null, has_d: true, m: null, has_m: true });
  });

  it("puts a bad week back to 40 hours and removes bad working days and months to hire", async () => {
    expect(await stored("junk")).toEqual({ h: 40, d: null, has_d: false, m: null, has_m: false });
    expect(await stored("unset")).toEqual({ h: null, d: null, has_d: false, m: null, has_m: false });
  });

  it("the checks are there and validated", async () => {
    const { rows } = await db.client.query("select conname, convalidated from pg_constraint where conname in ('workspaces_hours_per_week', 'workspaces_working_days', 'workspaces_hiring_delay_months') order by conname");
    expect(rows).toEqual([
      { conname: "workspaces_hiring_delay_months", convalidated: true },
      { conname: "workspaces_hours_per_week", convalidated: true },
      { conname: "workspaces_working_days", convalidated: true },
    ]);
  });
});

describe("what the checks refuse", () => {
  const set = (value: string) => db.client.query("update workspaces set settings = settings || $2::jsonb where id = $1", [ids.unset, value]);
  const refused = async (value: string) => {
    await db.client.query("savepoint s");
    try {
      await set(value);
      await db.client.query("release savepoint s");
      return false;
    } catch (e) {
      await db.client.query("rollback to savepoint s");
      expect((e as { code?: string }).code).toBe("23514");
      return true;
    }
  };

  it("accepts the values Settings offers", async () => {
    await db.client.query("begin");
    try {
      for (const ok of ['{"hours_per_week": 1}', '{"hours_per_week": 168}', '{"working_days": 1}', '{"working_days": 7}', '{"working_days": null}', '{"hiring_delay_months": 0}', '{"hiring_delay_months": 24}', '{"hiring_delay_months": null}'])
        expect(await refused(ok), ok).toBe(false);
    } finally {
      await db.client.query("rollback");
    }
  });

  it("refuses values out of range or not numbers", async () => {
    await db.client.query("begin");
    try {
      for (const bad of ['{"hours_per_week": 0}', '{"hours_per_week": 169}', '{"hours_per_week": null}', '{"hours_per_week": "40"}', '{"working_days": 0}', '{"working_days": 8}', '{"working_days": "5"}', '{"hiring_delay_months": -1}', '{"hiring_delay_months": 25}', '{"hiring_delay_months": true}'])
        expect(await refused(bad), bad).toBe(true);
    } finally {
      await db.client.query("rollback");
    }
  });
});
