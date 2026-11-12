import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BUNDLE_TABLES,
  IMPORT_COLUMNS,
  NORTHBEAM_WORKSPACE_ID,
  WORKSPACE_SETTING_KEYS,
  exportWorkspaceBundle,
  planWorkspaceImport,
  type Row,
  type TableReader,
  type WorkspaceBundle,
} from "../src";
import { headerRollback } from "./header-rollback";
import { createTestDb, createUser, type TestDb } from "./harness";

// How pay becomes cost (migration 20270203005000_pay_costs.sql): `people.paid_for`, the two workspace settings keys
// `overtime_pay_factor` and `employer_on_costs`, row-level security on the new column, the restore, and the header's rollback.

let db: TestDb;
type User = { id: string; claims: Record<string, unknown> };
const users: Record<string, User> = {};
const ws = NORTHBEAM_WORKSPACE_ID;
let seq = 0;

beforeAll(async () => {
  db = await createTestDb({ supabaseDefaultPrivileges: true });
  users.owner = await createUser(db, "owner@pay-costs.example.com", { agency_admin: true });
  users.viewer = await createUser(db, "viewer@pay-costs.example.com");
  await db.client.query("insert into memberships (workspace_id, user_id, role) values ($1, $2, 'viewer'::membership_role)", [ws, users.viewer.id]);
}, 120_000);
afterAll(async () => {
  await db?.close();
});

async function as<T>(user: User, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  await db.client.query("begin");
  try {
    await db.client.query("set local role authenticated");
    await db.client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(user.claims)]);
    const r = await fn(db.client);
    await db.client.query("commit");
    return r;
  } catch (e) {
    await db.client.query("rollback");
    throw e;
  }
}
const q = async (sql: string, params: unknown[] = []) => (await db.client.query(sql, params)).rows as Row[];
const newWorkspace = (name: string) =>
  as(users.owner!, async (c) => (await c.query("select public.create_workspace($1, $2) as id", [name, `pay-${++seq}-${Date.now()}`])).rows[0].id as string);

describe("the settings keys", () => {
  const set = (key: string, value: string) => db.client.query("update workspaces set settings = settings || jsonb_build_object($2::text, $3::jsonb) where id = $1", [ws, key, value]);

  it("overtime paid at: a number from 0 to 5, or null", async () => {
    for (const bad of ["-0.5", "5.5", '"1.5"', "true", "[]"]) await expect(set("overtime_pay_factor", bad), bad).rejects.toThrow(/workspaces_overtime_pay_factor/);
    for (const good of ["0", "1", "1.5", "5", "null"]) await expect(set("overtime_pay_factor", good), good).resolves.toBeDefined();
  });

  it("employer on-costs: a share from 0 to 1, or null", async () => {
    for (const bad of ["-0.01", "1.2", '"0.12"', "false"]) await expect(set("employer_on_costs", bad), bad).rejects.toThrow(/workspaces_employer_on_costs/);
    for (const good of ["0", "0.12", "1", "null"]) await expect(set("employer_on_costs", good), good).resolves.toBeDefined();
  });

  it("both checks are validated, and both keys are workspace settings a backup carries", async () => {
    const { rows } = await db.client.query("select conname, convalidated from pg_constraint where conname in ('workspaces_overtime_pay_factor', 'workspaces_employer_on_costs') order by conname");
    expect(rows).toEqual([
      { conname: "workspaces_employer_on_costs", convalidated: true },
      { conname: "workspaces_overtime_pay_factor", convalidated: true },
    ]);
    expect(WORKSPACE_SETTING_KEYS).toEqual(expect.arrayContaining(["overtime_pay_factor", "employer_on_costs"]));
  });

  it("an Agency admin saves them through save_fields; a Viewer can't", async () => {
    const save = (c: pg.Client, value: unknown) =>
      c.query("select public.save_fields('workspaces', $1::jsonb, $2::jsonb, $3::jsonb) as r", [
        JSON.stringify({ id: ws }),
        JSON.stringify({ "settings.employer_on_costs": null }),
        JSON.stringify({ "settings.employer_on_costs": value }),
      ]);
    await set("employer_on_costs", "null");
    const viewer = await as(users.viewer!, (c) => save(c, 0.12)).then((r) => r.rows[0].r as { status: string }, (e: Error) => ({ status: e.message }));
    expect(viewer.status).not.toBe("saved");
    const owner = (await as(users.owner!, (c) => save(c, 0.12))).rows[0].r as { status: string };
    expect(owner.status).toBe("saved");
    expect((await q("select settings -> 'employer_on_costs' as v from workspaces where id = $1", [ws]))[0]!.v).toBe(0.12);
  });
});

describe("people.paid_for", () => {
  it("is contracted, worked or null, and starts null for everyone", async () => {
    expect((await q("select count(*)::int as n from people where paid_for is not null"))[0]!.n).toBe(0);
    const p = (await q("select id from people where workspace_id = $1 limit 1", [ws]))[0]!.id as string;
    await expect(q("update people set paid_for = 'hourly' where id = $1", [p])).rejects.toThrow(/people_paid_for/);
    for (const v of ["contracted", "worked", null]) await expect(q("update people set paid_for = $2 where id = $1", [p, v])).resolves.toBeDefined();
  });

  it("follows the table's own rule: an Agency admin may set it, a Viewer may not", async () => {
    const p = (await q("select id from people where workspace_id = $1 limit 1", [ws]))[0]!.id as string;
    await as(users.owner!, (c) => c.query("update people set paid_for = 'worked' where id = $1", [p]));
    expect((await q("select paid_for from people where id = $1", [p]))[0]!.paid_for).toBe("worked");
    const n = await as(users.viewer!, async (c) => (await c.query("update people set paid_for = 'contracted' where id = $1", [p])).rowCount);
    expect(n).toBe(0);
    expect((await q("select paid_for from people where id = $1", [p]))[0]!.paid_for).toBe("worked");
  });
});

describe("a backup round-trips them", () => {
  it("exports and restores paid_for and the two settings", async () => {
    expect(IMPORT_COLUMNS.people).toContain("paid_for");
    const src = await newWorkspace("Pay Source");
    await q("update workspaces set settings = settings || '{\"overtime_pay_factor\": 1.5, \"employer_on_costs\": 0.12}'::jsonb where id = $1", [src]);
    await q("insert into people (workspace_id, name, label, paid_for) values ($1, 'Free', 'contractor', 'contracted'), ($1, 'Kim', null, null)", [src]);
    const bundle = await db.as(users.owner!.claims, async (c) => {
      const read: TableReader = async (table, wsId) => {
        const spec = Object.values(BUNDLE_TABLES).find((t) => t.table === table)!;
        return (await c.query(`select to_jsonb(t) as j from (select * from public.${table} where workspace_id = $1 order by ${spec.order.join(", ")}) t`, [wsId])).rows.map((r) => r.j) as Row[];
      };
      const readWorkspace = async (id: string) => (await c.query("select id, name, slug, plan, settings, provenance from workspaces where id = $1", [id])).rows[0] ?? null;
      return exportWorkspaceBundle(src, readWorkspace, read, { canEdit: true, now: new Date("2026-11-12T12:00:00Z") });
    });
    const { plan } = planWorkspaceImport(JSON.parse(JSON.stringify(bundle)) as WorkspaceBundle, { canManage: true });
    const dst = await newWorkspace("Pay Restored");
    await as(users.owner!, (c) => c.query("select public.import_workspace_bundle($1::uuid, $2::jsonb, 'backup.json')", [dst, JSON.stringify(plan)]));
    expect(await q("select name, label, paid_for from people where workspace_id = $1 order by name", [dst])).toEqual([
      { name: "Free", label: "contractor", paid_for: "contracted" },
      { name: "Kim", label: null, paid_for: null },
    ]);
    expect((await q("select settings from workspaces where id = $1", [dst]))[0]!.settings).toMatchObject({ overtime_pay_factor: 1.5, employer_on_costs: 0.12 });
  });
});

describe("the header's rollback", () => {
  it("removes the column, the keys and the checks", async () => {
    const own = await createTestDb();
    try {
      await own.client.query("update workspaces set settings = settings || '{\"overtime_pay_factor\": 1.5}'::jsonb");
      await own.client.query(headerRollback("20270203005000_pay_costs.sql"));
      expect((await own.client.query("select count(*)::int as n from information_schema.columns where table_name = 'people' and column_name = 'paid_for'")).rows[0].n).toBe(0);
      expect((await own.client.query("select count(*)::int as n from pg_constraint where conname in ('workspaces_overtime_pay_factor', 'workspaces_employer_on_costs')")).rows[0].n).toBe(0);
      expect((await own.client.query("select count(*)::int as n from workspaces where settings ? 'overtime_pay_factor'")).rows[0].n).toBe(0);
    } finally {
      await own.close();
    }
  }, 120_000);
});
