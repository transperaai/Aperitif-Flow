import { describe, expect, it } from "vitest";
import {
  FieldController,
  NOT_FOUND_MESSAGE,
  SAVE_FAILED_MESSAGE,
  mapOutcome,
  sameValue,
  type FieldValue,
  type SaveOutcome,
  type Saver,
} from "@/lib/fields/field-controller";

/** An in-memory stand-in for save_fields: one stored value, compare-and-set. */
interface Store<T extends FieldValue> {
  value: T;
  calls: [T, T][];
  save: Saver<T>;
}

function store<T extends FieldValue>(initial: T): Store<T> {
  const s: Store<T> = {
    value: initial,
    calls: [],
    save: async (base, next) => {
      s.calls.push([base, next]);
      if (!sameValue(s.value, base) && !sameValue(s.value, next)) return { status: "conflict", theirs: s.value };
      s.value = next;
      return { status: "saved", value: next };
    },
  };
  return s;
}

describe("FieldController", () => {
  it("saves an edit against the value it loaded", async () => {
    const db = store<string>("Priya");
    const f = new FieldController<string>("Priya", db.save);
    f.edit("Priya S.");
    expect(f.getState()).toMatchObject({ draft: "Priya S.", base: "Priya", phase: "idle" });
    await f.commit();
    expect(db.calls).toEqual([["Priya", "Priya S."]]);
    expect(f.getState()).toMatchObject({ base: "Priya S.", draft: "Priya S.", phase: "idle" });
  });

  it("does not save when nothing changed", async () => {
    const db = store<number>(1);
    const f = new FieldController<number>(1, db.save);
    await f.commit(1);
    expect(db.calls).toEqual([]);
  });

  it("queues saves so a later one uses the base the earlier one stored", async () => {
    const db = store<readonly string[]>([]);
    const f = new FieldController<readonly string[]>([], db.save);
    await Promise.all([f.commit(["a"]), f.commit(["a", "b"])]);
    expect(db.calls).toEqual([
      [[], ["a"]],
      [["a"], ["a", "b"]],
    ]);
    expect(f.getState()).toMatchObject({ base: ["a", "b"], phase: "idle" });
  });

  it("keeps what was typed while a save was in flight", async () => {
    let release!: (o: SaveOutcome<string>) => void;
    const f = new FieldController<string>("a", () => new Promise((r) => (release = r)));
    const saving = f.commit("ab");
    await Promise.resolve();
    expect(f.getState().phase).toBe("saving");
    f.edit("abc");
    release({ status: "saved", value: "ab" });
    await saving;
    expect(f.getState()).toMatchObject({ base: "ab", draft: "abc", phase: "idle" });
  });

  it("adopts the server's normalised value", async () => {
    const f = new FieldController<string | null>(null, async () => ({ status: "saved", value: "trimmed" }));
    await f.commit(" trimmed ");
    expect(f.getState()).toMatchObject({ base: "trimmed", draft: "trimmed" });
  });

  describe("same-field conflict", () => {
    async function clash() {
      const db = store<number>(40);
      const f = new FieldController<number>(40, db.save);
      db.value = 45; // someone else saved
      await f.commit(55);
      return { db, f };
    }

    it("reports theirs without overwriting it", async () => {
      const { db, f } = await clash();
      expect(f.getState()).toMatchObject({ phase: "conflict", theirs: 45, draft: 55, base: 40 });
      expect(db.value).toBe(45);
    });

    it("keep mine saves over theirs", async () => {
      const { db, f } = await clash();
      await f.keepMine();
      expect(db.calls.at(-1)).toEqual([45, 55]);
      expect(db.value).toBe(55);
      expect(f.getState()).toMatchObject({ phase: "idle", base: 55, draft: 55 });
    });

    it("keep theirs takes the stored value without saving", async () => {
      const { db, f } = await clash();
      f.keepTheirs();
      expect(db.calls).toHaveLength(1);
      expect(f.getState()).toMatchObject({ phase: "idle", base: 45, draft: 45, theirs: undefined });
    });

    it("keep mine can conflict again if a third edit landed", async () => {
      const { db, f } = await clash();
      db.value = 50;
      await f.keepMine();
      expect(f.getState()).toMatchObject({ phase: "conflict", theirs: 50 });
    });

    it("holds further commits until the user picks", async () => {
      const { db, f } = await clash();
      await f.commit(60);
      expect(db.calls).toHaveLength(1);
    });
  });

  it("merges with edits to other fields: each field only checks its own value", async () => {
    const row = { name: store<string>("Tom"), fte: store<number>(1) };
    const name = new FieldController<string>("Tom", row.name.save);
    const fte = new FieldController<number>(1, row.fte.save);
    await name.commit("Thomas");
    await fte.commit(0.5);
    expect([row.name.value, row.fte.value]).toEqual(["Thomas", 0.5]);
  });

  it("shows why a save failed, and lets the user undo", async () => {
    const f = new FieldController<number>(1, async () => ({ status: "not_found" }));
    await f.commit(2);
    expect(f.getState()).toMatchObject({ phase: "error", message: NOT_FOUND_MESSAGE, draft: 2 });
    f.revert();
    expect(f.getState()).toMatchObject({ phase: "idle", draft: 1, message: undefined });
  });

  it("turns a thrown save into an error", async () => {
    const f = new FieldController<number>(1, async () => {
      throw new Error("network down");
    });
    await f.commit(2);
    expect(f.getState()).toMatchObject({ phase: "error", message: SAVE_FAILED_MESSAGE });
  });

  it("follows the server's value when clean, not over unsaved work", () => {
    const f = new FieldController<string>("a", store<string>("a").save);
    f.external("b");
    expect(f.getState()).toMatchObject({ base: "b", draft: "b" });
    f.edit("mine");
    f.external("c");
    expect(f.getState()).toMatchObject({ base: "b", draft: "mine" });
  });

  it("notifies subscribers", async () => {
    const f = new FieldController<number>(1, store<number>(1).save);
    let calls = 0;
    const off = f.subscribe(() => calls++);
    f.edit(2);
    off();
    f.edit(3);
    expect(calls).toBe(1);
  });
});

describe("helpers", () => {
  it("compares id sets regardless of order", () => {
    expect(sameValue(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameValue(["a"], ["a", "b"])).toBe(false);
    expect(sameValue(null, "")).toBe(false);
  });

  it("maps outcome values", () => {
    expect(mapOutcome({ status: "saved", value: 0.08 }, (v) => String(v * 100))).toEqual({ status: "saved", value: "8" });
    expect(mapOutcome({ status: "conflict", theirs: 1 }, String)).toEqual({ status: "conflict", theirs: "1" });
    expect(mapOutcome({ status: "not_found" }, String)).toEqual({ status: "not_found" });
  });
});
