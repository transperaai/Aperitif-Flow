import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NORTHBEAM_WORKSPACE_ID } from "@transpera-flow/db";
import { addMember, signInAs, signOut, type TestUser } from "./action-harness";
import { createTestDb, type TestDb } from "../../../packages/db/test/harness";

// The Settings actions for "Overtime paid at" and "Employer on-costs" (customisability audit 13, 19 and 21): input checks, what
// reaches the database (and its own checks, workspaces_overtime_pay_factor and workspaces_employer_on_costs), who may write, and the
// page refreshing on a save. Runs against a real database as an editor, and as a viewer, who is refused.

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: mocks.refresh, revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", async () => (await import("./action-harness")).sessionMock);
const { saveEmployerOnCosts, saveOvertimePayFactor } = await import("@/app/w/[slug]/settings/actions");

const WS = NORTHBEAM_WORKSPACE_ID;
let tdb: TestDb;
let editor: TestUser;
let viewer: TestUser;

beforeAll(async () => {
  tdb = await createTestDb();
  editor = await addMember(tdb, WS, "editor");
  viewer = await addMember(tdb, WS, "viewer");
}, 120_000);

afterAll(async () => {
  await tdb?.close();
});

beforeEach(async () => {
  mocks.refresh.mockClear();
  await tdb.client.query("update workspaces set settings = settings - 'overtime_pay_factor' - 'employer_on_costs' where id = $1", [WS]);
  signInAs({ tdb }, editor);
});

const stored = async (key: string) => (await tdb.client.query("select settings -> $2::text as v, settings ? $2::text as has from workspaces where id = $1", [WS, key])).rows[0] as { v: unknown; has: boolean };

describe.each([
  { name: "saveOvertimePayFactor", save: (b: number | null, v: number | null) => saveOvertimePayFactor(WS, b, v), key: "overtime_pay_factor", good: [1.5, 0, 5, 1], bad: [-0.1, 5.01] },
  { name: "saveEmployerOnCosts", save: (b: number | null, v: number | null) => saveEmployerOnCosts(WS, b, v), key: "employer_on_costs", good: [0.12, 0, 1, 0.155], bad: [-0.01, 1.01] },
])("$name", ({ save, key, good, bad }) => {
  it("saves a value in range, and refreshes the page; null restores the default", async () => {
    let base: number | null = null;
    for (const value of good) {
      expect(await save(base, value)).toEqual({ status: "saved", value });
      expect((await stored(key)).v).toBe(value);
      base = value;
    }
    expect(await save(base, null)).toEqual({ status: "saved", value: null });
    expect((await stored(key)).v).toBeNull();
    expect(mocks.refresh).toHaveBeenCalledTimes(good.length + 1);
  });

  it("refuses a value out of range or not a number, writing nothing", async () => {
    for (const v of [...bad, Number.NaN, Number.POSITIVE_INFINITY, "1" as never, true as never]) expect((await save(null, v)).status, String(v)).toBe("error");
    expect(await stored(key)).toEqual({ v: null, has: false });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("is refused to a viewer and a signed-out user", async () => {
    signInAs({ tdb }, viewer);
    expect((await save(null, good[0]!)).status).not.toBe("saved");
    signOut({ tdb });
    expect((await save(null, good[0]!)).status).toBe("error");
    expect(await stored(key)).toEqual({ v: null, has: false });
  });
});
