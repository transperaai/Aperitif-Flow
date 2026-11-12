import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NORTHBEAM_WORKSPACE_ID } from "../src";
import { createTestDb, type TestDb } from "./harness";

// The DLER goal and the at-risk margin (migration 20270203003000_goal_and_margin_settings.sql; customisability audit 3, 12 and 48): two
// workspace settings, each checked by the database.

const ws = NORTHBEAM_WORKSPACE_ID;
let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const set = (key: string, value: string) => db.client.query("update workspaces set settings = settings || $2::jsonb where id = $1", [ws, `{"${key}": ${value}}`]);

describe("the checks", () => {
  it("are there and validated", async () => {
    const { rows } = await db.client.query("select conname, convalidated from pg_constraint where conname in ('workspaces_dler_goal', 'workspaces_at_risk_margin') order by conname");
    expect(rows).toEqual([
      { conname: "workspaces_at_risk_margin", convalidated: true },
      { conname: "workspaces_dler_goal", convalidated: true },
    ]);
  });

  it("take a DLER goal above 0 and up to 50, or null", async () => {
    for (const bad of ["0", "-1", "50.5", '"3"', "true"]) await expect(set("dler_goal", bad), bad).rejects.toThrow(/workspaces_dler_goal/);
    for (const good of ["3", "4.5", "50", "null"]) await expect(set("dler_goal", good), good).resolves.toBeDefined();
  });

  it("take an at-risk margin from 0 to 0.5, or null", async () => {
    for (const bad of ["-0.1", "0.6", '"0.1"', "[]"]) await expect(set("at_risk_margin", bad), bad).rejects.toThrow(/workspaces_at_risk_margin/);
    for (const good of ["0", "0.1", "0.5", "null"]) await expect(set("at_risk_margin", good), good).resolves.toBeDefined();
  });
});
