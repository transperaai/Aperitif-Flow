import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NORTHBEAM_WORKSPACE_ID, loadCapacitySetup, loadProcessBySlug, northbeamPersonIds, northbeamRoleIds, toEngineModel, WEEKS_PER_MONTH } from "../src";
import { createTestDb, createUser, type TestDb } from "./harness";

// Role salaries (D73, migration 20270203000500_role_salary.sql): the column and its check, provenance when saved, and that a role's
// salary is pay everywhere a person's is: the Set up loader, the process bundle and `team_capacity` give it only to whoever sees everyone.

let db: TestDb;
type User = { id: string; claims: Record<string, unknown> };
let owner: User;
let viewer: User;
const ws = NORTHBEAM_WORKSPACE_ID;
const seo = northbeamRoleIds.seo;
const sam = northbeamPersonIds["Sam Patel"]!;
const chloe = northbeamPersonIds["Chloe Evans"]!;

beforeAll(async () => {
  db = await createTestDb();
  owner = await createUser(db, "owner@role-salary.example.com", { agency_admin: true });
  viewer = await createUser(db, "viewer@role-salary.example.com");
  await db.client.query("insert into memberships (workspace_id, user_id, role, person_id) values ($1, $2, 'viewer', $3)", [ws, viewer.id, sam]);
  await db.client.query("update people set salary_monthly = 7800, label = 'offshore' where id = $1", [chloe]);
  await db.client.query("update people set salary_monthly = 5000 where id = $1", [sam]);
}, 120_000);
afterAll(async () => {
  await db?.close();
});

const q = async (sql: string, params: unknown[] = []) => (await db.client.query(sql, params)).rows as Record<string, unknown>[];
const ownerDb = () => db.dbAs({ sub: owner.id, role: "authenticated", app_metadata: { agency_admin: true } });
const viewerDb = () => db.dbAs({ sub: viewer.id, role: "authenticated" });

describe("the column", () => {
  it("is a nullable amount, refused below 0, and null on every existing role", async () => {
    expect(await q("select count(*)::int as n from roles where salary_monthly is not null")).toEqual([{ n: 0 }]);
    await expect(q("update roles set salary_monthly = -1 where id = $1", [seo])).rejects.toThrow(/roles_salary_monthly/);
  });

  it("is saved through save_fields by an Owner and stamped as entered", async () => {
    const r = await db.as(owner.claims, async (c) =>
      (await c.query("select public.save_fields('roles', $1::jsonb, $2::jsonb, $3::jsonb) as r", [JSON.stringify({ id: seo }), JSON.stringify({ salary_monthly: null }), JSON.stringify({ salary_monthly: 6500 })])).rows[0].r,
    );
    expect(r.status).toBe("saved");
    // `as` rolls back: save it for the rest of the file the same way, committed.
    await q("update roles set salary_monthly = 6500 where id = $1", [seo]);
    const [row] = await q("select salary_monthly, provenance -> 'salary_monthly' ->> 'source' as source from roles where id = $1", [seo]);
    expect(row).toEqual({ salary_monthly: "6500", source: "entered" });
  });
});

describe("who gets it", () => {
  it("Set up: the Owner reads the role's salary; a Viewer reads null", async () => {
    const o = (await loadCapacitySetup(ownerDb(), ws))!;
    expect(o.roles.find((r) => r.id === seo)!.salary_monthly).toBe(6500);
    const v = (await loadCapacitySetup(viewerDb(), ws))!;
    expect(v.roles.every((r) => r.salary_monthly === null)).toBe(true);
  });

  it("team_capacity: everyone's salary and label to the Owner, only their own to a Viewer", async () => {
    const team = async (u: User) => db.as(u.claims, async (c) => (await c.query("select public.team_capacity($1) as t", [ws])).rows[0].t.people as Record<string, unknown>[]);
    const o = await team(owner);
    expect(o.find((p) => p.id === chloe)).toMatchObject({ salary_monthly: 7800, label: "offshore" });
    const v = await team(viewer);
    expect(v.find((p) => p.id === sam)).toMatchObject({ salary_monthly: 5000 });
    for (const p of v) if (p.id !== sam) expect([p.salary_monthly, p.label], String(p.id)).toEqual([null, null]);
  });

  it("the process bundle: the Owner's model prices hours from salaries; a Viewer's bundle has no role salary and its model no cost", async () => {
    const o = (await loadProcessBySlug(ownerDb(), "northbeam"))!.live;
    expect(o.roles.find((r) => r.id === seo)!.salary_monthly).toBe(6500);
    const model = toEngineModel(o, { startDate: "2026-10-05" });
    const perHour = (m: number) => m / (40 * WEEKS_PER_MONTH);
    expect(model.people![chloe]!.cost).toBeCloseTo(perHour(7800), 10);
    expect(model.people![northbeamPersonIds["Arjun Mehta"]!]!.cost).toBeCloseTo(perHour(6500), 10);

    const v = (await loadProcessBySlug(viewerDb(), "northbeam"))!.live;
    expect(v.roles.every((r) => r.salary_monthly === null)).toBe(true);
    const vm = toEngineModel(v, { startDate: "2026-10-05" });
    expect(vm.payHidden).toBe(true);
    for (const p of Object.values(vm.people!)) expect(p.cost).toBeUndefined();
  });
});
