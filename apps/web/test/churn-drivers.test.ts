import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BUILTIN_CHURN_DRIVER_IDS, CHURN_DRIVER_SPECS, DEFAULT_CHURN_LIMITS, simulate } from "@transpera-flow/engine";
import { HEALTH_SETTINGS } from "@/lib/servicing";
import { NORTHBEAM_WORKSPACE_ID, northbeamBundle, toEngineModel, type CapacitySetup, type ChurnDriverRow } from "@transpera-flow/db";
import { ChurnDriversSettings } from "@/app/w/[slug]/settings/churn-drivers-settings";
import { NormalChurnByTier } from "@/app/w/[slug]/settings/normal-churn-settings";
import {
  CHURN_LIMIT_KEYS,
  CHURN_LIMIT_SETTINGS,
  CONTROL_HELP,
  DRIVER_HELP,
  VALUE_HELP,
  driverStates,
  engineIdOf,
  isChurnLimitValue,
  limitsOf,
  parseDriverPatch,
  pressureKey,
  sourceLabel,
  toEngineDrivers,
  valueNow,
} from "@/lib/churn-drivers";

// The screen imports its Server Actions, which are server-only; nothing here calls them.
vi.mock("server-only", () => ({}));

// Settings, Churn drivers (A56, issue #121): the screen's state, wording and input checks.

const UUID = "00000000-0000-4000-8000-000000000042";
const row = (over: Partial<ChurnDriverRow>): ChurnDriverRow => ({
  id: UUID,
  workspace_id: NORTHBEAM_WORKSPACE_ID,
  driver: "late",
  name: null,
  description: null,
  example: null,
  weight: 1,
  enabled: true,
  value: null,
  month: null,
  chance: null,
  effect: null,
  effect_months: null,
  provenance: {},
  ...over,
});

describe("the ten drivers", () => {
  it("lists every built-in in the prototype's order with a plain description and an example", () => {
    const states = driverStates([]);
    expect(states.map((d) => d.key)).toEqual(["late", "resp", "onb", "rework", "load", "handoff", "results", "tenure", "price", "market"]);
    expect(states.map((d) => d.name)).toEqual([
      "Late or missed servicing work",
      "Response time to ad-hoc requests",
      "Onboarding speed (won to first delivery)",
      "Rework or errors on deliverables",
      "Account team overload",
      "Account manager changes",
      "Client results or satisfaction",
      "Early tenure",
      "Price changes",
      "Market conditions",
    ]);
    for (const id of BUILTIN_CHURN_DRIVER_IDS) {
      expect(DRIVER_HELP[id].description.length, id).toBeGreaterThan(10);
      expect(DRIVER_HELP[id].example.length, id).toBeGreaterThan(10);
    }
  });

  it("says where each number comes from, as the prototype does", () => {
    expect(Object.fromEntries(driverStates([]).map((d) => [d.key, sourceLabel(d)]))).toEqual({
      late: "Measured",
      resp: "Measured",
      onb: "Measured",
      rework: "Measured",
      load: "Measured",
      handoff: "Partly measured",
      results: "You enter it",
      tenure: "You enter it",
      price: "Lever",
      market: "From the Sandbox's Market lever",
    });
  });

  it("has an (i) wording for every number a built-in takes, and only those", () => {
    const takes = BUILTIN_CHURN_DRIVER_IDS.filter((id) => CHURN_DRIVER_SPECS[id].valueRange);
    expect(Object.keys(VALUE_HELP).sort()).toEqual([...takes].sort());
    for (const id of takes) expect(VALUE_HELP[id]!.example.length).toBeGreaterThan(10);
  });

  it("starts with only late work and the market on, at weight 1: how clients churned before drivers", () => {
    const on = driverStates([]).filter((d) => d.enabled);
    expect(on.map((d) => d.key)).toEqual(["late", "market"]);
    expect(driverStates([]).every((d) => d.weight === 1)).toBe(true);
  });
});

describe("from stored rows", () => {
  it("takes a stored built-in's weight, switch and numbers, and your own after the ten", () => {
    const states = driverStates([
      row({ weight: 1.5 }),
      row({ id: "00000000-0000-4000-8000-000000000043", driver: "price", weight: 0.5, enabled: true, value: 10, month: 3 }),
      row({ id: UUID, driver: null, name: "A rival", description: "A cheaper agency.", example: "Two clients left.", weight: 2, value: 15 }),
    ]);
    expect(states).toHaveLength(11);
    expect(states[0]).toMatchObject({ key: "late", weight: 1.5, enabled: true, rowId: UUID });
    expect(states.find((d) => d.key === "price")).toMatchObject({ weight: 0.5, enabled: true, value: 10, month: 3 });
    expect(states[10]).toMatchObject({ key: UUID, builtin: null, name: "A rival", description: "A cheaper agency.", weight: 2, value: 15 });
  });

  it("gives the engine the same drivers: built-ins by key, your own as custom:<id>", () => {
    const states = driverStates([row({ weight: 1.5 }), row({ id: UUID, driver: null, name: "A rival", weight: 2, value: 15 })]);
    const engine = toEngineDrivers(states);
    expect(engine.find((d) => d.id === "late")).toEqual({ id: "late", weight: 1.5, enabled: true });
    expect(engine.find((d) => d.id === "onb")).toEqual({ id: "onb", weight: 1, enabled: false, value: 10 });
    expect(engine.find((d) => d.id === `custom:${UUID}`)).toEqual({ id: `custom:${UUID}`, name: "A rival", weight: 2, enabled: true, value: 15 });
    expect(engineIdOf(states[10]!)).toBe(`custom:${UUID}`);
  });

  it("runs the engine with the drivers as set: a heavier weight on late work loses more clients", () => {
    const model = toEngineModel(northbeamBundle(), { startDate: "2026-10-05" });
    const at = (weight: number) =>
      simulate({ ...model, churnDrivers: toEngineDrivers(driverStates([row({ weight })])) }, 8, 1).kpi.clientsChurned!.mean;
    expect(at(3)).toBeGreaterThan(at(0.5));
  });
});

describe("what needs a new simulation", () => {
  it("is the entered numbers and your own drivers, not weights or switches", () => {
    const base = driverStates([]);
    const key = pressureKey(base);
    expect(pressureKey(base.map((d) => ({ ...d, weight: 3, enabled: !d.enabled })))).toBe(key);
    expect(pressureKey(base.map((d) => (d.key === "results" ? { ...d, value: 4 } : d)))).not.toBe(key);
    expect(pressureKey(base.map((d) => (d.key === "price" ? { ...d, month: 5 } : d)))).not.toBe(key);
    expect(pressureKey([...base, { ...base[0]!, key: "x", builtin: null, name: "Mine", value: 20 }])).not.toBe(key);
  });
});

describe("the value now", () => {
  const model = toEngineModel(northbeamBundle(), { startDate: "2026-10-05" });
  const run = simulate({ ...model, churnDrivers: toEngineDrivers(driverStates([row({ weight: 1 })])) }, 6, 1).churnCauses!;
  const states = driverStates([]);
  const now = (id: string) => {
    const d = states.find((x) => x.key === id)!;
    return valueNow(d, run.causes.find((c) => c.id === engineIdOf(d)), model);
  };

  it("words what was measured", () => {
    expect(now("late")).toMatch(/^\d+% of servicing work late or missed$/);
    expect(now("load")).toMatch(/busy$/);
    expect(now("onb")).toMatch(/working days to first delivery$/);
  });

  it("says so when nothing could be measured, and shows the numbers you entered", () => {
    expect(now("resp")).toBe("no ad-hoc requests in the run");
    expect(now("results")).toBe("7 / 10 average");
    expect(now("tenure")).toBe("×1.6 while new");
    expect(now("price")).toBe("no change planned");
    expect(now("handoff")).toBe("30% of clients change account manager a year");
    expect(now("market")).toBe("Stable: no change to churn");
  });

  it("words a price rise and your own driver", () => {
    const price = { ...states.find((x) => x.key === "price")!, value: 10, month: 3 };
    expect(valueNow(price, undefined, null)).toBe("10% rise from month 3");
    expect(valueNow({ ...states[0]!, builtin: null, value: 15 }, undefined, null)).toBe("15% extra churn at weight 1");
  });
});

describe("input checks", () => {
  it("accepts a weight from 0 to 3, a switch and an in-range number, and refuses the rest", () => {
    expect(parseDriverPatch("late", { weight: 1.5 })).toEqual({ weight: 1.5 });
    expect(parseDriverPatch("late", { weight: 3, enabled: false })).toEqual({ weight: 3, enabled: false });
    expect(parseDriverPatch("late", { weight: 3.1 })).toBeNull();
    expect(parseDriverPatch("late", { weight: -1 })).toBeNull();
    expect(parseDriverPatch("late", { weight: Number.NaN })).toBeNull();
    expect(parseDriverPatch("late", { enabled: "yes" })).toBeNull();
    expect(parseDriverPatch("late", {})).toBeNull();
    expect(parseDriverPatch("late", { colour: "red" })).toBeNull();
    expect(parseDriverPatch("weather", { weight: 1 })).toBeNull();
    expect(parseDriverPatch("late", null)).toBeNull();
  });

  it("keeps each built-in's number in its own range, and a month for price changes only", () => {
    expect(parseDriverPatch("results", { value: 10 })).toEqual({ value: 10 });
    expect(parseDriverPatch("results", { value: 11 })).toBeNull();
    expect(parseDriverPatch("tenure", { value: 0.5 })).toBeNull();
    expect(parseDriverPatch("tenure", { value: 1.6 })).toEqual({ value: 1.6 });
    expect(parseDriverPatch("price", { value: 10, month: 3 })).toEqual({ value: 10, month: 3 });
    expect(parseDriverPatch("price", { month: 25 })).toBeNull();
    expect(parseDriverPatch("price", { month: 2.5 })).toBeNull();
    expect(parseDriverPatch("results", { month: 3 })).toBeNull();
    // A driver that takes no number refuses one.
    expect(parseDriverPatch("late", { value: 5 })).toBeNull();
  });

  it("accepts the chance mode's chance, effect and months for a driver with events, null to clear them, and refuses the rest", () => {
    expect(parseDriverPatch("late", { chance: 5, effect: 40, effectMonths: 4 })).toEqual({ chance: 5, effect: 40, effectMonths: 4 });
    expect(parseDriverPatch("late", { chance: null, effect: null, effectMonths: null })).toEqual({ chance: null, effect: null, effectMonths: null });
    expect(parseDriverPatch(UUID, { effect: 500 })).toEqual({ effect: 500 });
    expect(parseDriverPatch("late", { chance: 101 })).toBeNull();
    expect(parseDriverPatch("late", { chance: -1 })).toBeNull();
    expect(parseDriverPatch("late", { effect: 501 })).toBeNull();
    expect(parseDriverPatch("late", { effectMonths: 0 })).toBeNull();
    expect(parseDriverPatch("late", { effectMonths: 25 })).toBeNull();
    expect(parseDriverPatch("late", { effectMonths: 2.5 })).toBeNull();
    // Early tenure and the market have no events to hit.
    for (const key of ["tenure", "market"]) expect(parseDriverPatch(key, { chance: 5 })).toBeNull();
  });

  it("lets your own driver be named and described, within the limits", () => {
    expect(parseDriverPatch(UUID, { name: "  A rival  ", description: "  Cheaper.  ", example: "" })).toEqual({ name: "A rival", description: "Cheaper.", example: null });
    expect(parseDriverPatch(UUID, { name: "   " })).toBeNull();
    expect(parseDriverPatch(UUID, { name: "x".repeat(81) })).toBeNull();
    expect(parseDriverPatch(UUID, { description: "x".repeat(301) })).toBeNull();
    expect(parseDriverPatch(UUID, { value: 500 })).toEqual({ value: 500 });
    expect(parseDriverPatch(UUID, { value: 501 })).toBeNull();
    // A built-in has no name of its own.
    expect(parseDriverPatch("late", { name: "Renamed" })).toBeNull();
  });
});

describe("the screen", () => {
  const html = renderToStaticMarkup(createElement(ChurnDriversSettings, { mode: "demo", workspaceId: null, bundle: null, rows: [] }));

  it("shows every driver with its switch, weight and contribution, and an (i) on each", () => {
    for (const d of driverStates([])) {
      expect(html, d.name).toContain(`aria-label="Use ${d.name}"`);
      expect(html, d.name).toContain(`aria-label="Weight for ${d.name}"`);
      expect(html, d.name).toContain(`aria-label="About ${d.name}"`);
      expect(html, d.name).toContain(`aria-label="About Use ${d.name}"`);
      expect(html, d.name).toContain(`aria-label="About Weight for ${d.name}"`);
      expect(html, d.name).toContain(`aria-label="Delete ${d.name}"`);
      expect(html, d.name).toContain(`aria-label="About Delete ${d.name}"`);
    }
    expect(html).toContain("Churn drivers");
    expect(html).toContain("Projected churn");
    expect(html).toContain("+ Add driver");
    expect(html).toContain("About Normal churn");
  });

  it("leaves a deleted built-in off the list, and keeps the others with their switches", () => {
    const less = renderToStaticMarkup(createElement(ChurnDriversSettings, { mode: "demo", workspaceId: null, bundle: null, rows: [], removed: ["price"] }));
    const price = driverStates([]).find((d) => d.key === "price")!;
    expect(less).not.toContain(`aria-label="Use ${price.name}"`);
    expect(less).toContain(`aria-label="Use ${driverStates([])[0]!.name}"`);
  });

  it("gives every number you enter an (i) of its own", () => {
    for (const id of ["onb", "handoff", "results", "tenure", "price"] as const) expect(html).toContain(`aria-label="About ${VALUE_HELP[id]!.label}"`);
    expect(html).toContain("About Takes effect in month");
  });

  it("explains the weight in plain words", () => {
    expect(html).toContain(CONTROL_HELP.weight.description);
    expect(html).toContain("1 is normal. 0 means ignore it. 3 means it matters three times as much.");
  });

  it("is read-only for someone who can't edit, and the sliders are disabled", () => {
    const readonly = renderToStaticMarkup(createElement(ChurnDriversSettings, { mode: "readonly", workspaceId: null, bundle: null, rows: [] }));
    expect(readonly).toContain("Only Agency admins can change the churn drivers.");
    expect(readonly).toMatch(/<input[^>]*type="range"[^>]*disabled/);
  });
});

describe("churn-driver limits (customisability audit, findings 1 and 2)", () => {
  it("each driver with a fixed line gets its fields; late work and the market have none", () => {
    expect(limitsOf("load")).toEqual(["utilisation_threshold", "churn_load_full"]);
    expect(limitsOf("resp")).toEqual(["churn_response_full_share"]);
    expect(limitsOf("rework")).toEqual(["churn_rework_full_share"]);
    expect(limitsOf("onb")).toEqual(["churn_onboarding_full_multiple"]);
    expect(limitsOf("tenure")).toEqual(["churn_early_tenure_months"]);
    expect(limitsOf("handoff")).toEqual(["churn_away_pressure"]);
    expect(limitsOf("results")).toEqual(["churn_results_normal"]);
    expect(limitsOf("price")).toEqual(["churn_price_months"]);
    expect(limitsOf("late")).toEqual([]);
    expect(limitsOf("market")).toEqual([]);
    expect(limitsOf(null)).toEqual([]);
  });

  it("the ranges are the database's (save_health_rules and the settings checks), and a blank shows the engine's default", () => {
    const sql = readFileSync(new URL("../../../packages/db/migrations/20270203002000_churn_and_health_settings.sql", import.meta.url), "utf8");
    const ranges = JSON.parse(/select '(\{[\s\S]*?\})'::jsonb/.exec(sql)![1]!) as Record<string, [number, number]>;
    for (const k of CHURN_LIMIT_KEYS) {
      const s = CHURN_LIMIT_SETTINGS[k];
      expect([s.min, s.max], k).toEqual(ranges[k]);
      expect(isChurnLimitValue(k, s.min) && isChurnLimitValue(k, s.max) && isChurnLimitValue(k, null), k).toBe(true);
      expect(isChurnLimitValue(k, s.max + 1), k).toBe(false);
    }
    for (const k of Object.keys(HEALTH_SETTINGS)) expect(ranges[k], k).toEqual([0, 100]);
    expect(CHURN_LIMIT_SETTINGS.utilisation_threshold.fallback).toBe(DEFAULT_CHURN_LIMITS.loadThreshold * 100);
    expect(CHURN_LIMIT_SETTINGS.churn_load_full.fallback).toBe(DEFAULT_CHURN_LIMITS.loadFull * 100);
    expect(CHURN_LIMIT_SETTINGS.churn_response_full_share.fallback).toBe(DEFAULT_CHURN_LIMITS.responseFullShare * 100);
    expect(CHURN_LIMIT_SETTINGS.churn_rework_full_share.fallback).toBe(DEFAULT_CHURN_LIMITS.reworkFullShare * 100);
    expect(CHURN_LIMIT_SETTINGS.churn_results_normal.fallback).toBe(DEFAULT_CHURN_LIMITS.resultsNormal);
    expect(CHURN_LIMIT_SETTINGS.churn_away_pressure.fallback).toBe(DEFAULT_CHURN_LIMITS.awayPressure * 100);
    expect(CHURN_LIMIT_SETTINGS.churn_onboarding_full_multiple.fallback).toBe(DEFAULT_CHURN_LIMITS.onboardingFullMultiple);
  });

  it("the screen shows the limit fields under their drivers, at the stored value or the default", () => {
    const bundle = northbeamBundle();
    const withLimit = { ...bundle, workspace: { ...bundle.workspace, settings: { ...bundle.workspace.settings, utilisation_threshold: 0.9 } } };
    const html = renderToStaticMarkup(createElement(ChurnDriversSettings, { mode: "demo", workspaceId: null, bundle: withLimit, rows: [] }));
    expect(html).toContain("Overloaded above");
    expect(html).toContain("Early tenure lasts");
    expect(html).toMatch(/value="90"/);
    expect(html).toContain("100 (default)");
  });
});

describe("normal churn by tier (owner request: set in one place, on Churn drivers)", () => {
  const D1 = "d0000000-0000-4000-8000-000000000001";
  const D2 = "d0000000-0000-4000-8000-000000000002";
  const T1 = "f0000000-0000-4000-8000-000000000001";
  const svc = (id: string, department_id: string, churn: number) =>
    ({ id, name: id, active: true, department_id, tier_id: T1, churn_monthly_base: churn, provenance: {} }) as unknown as CapacitySetup["services"][number];
  const setup = (canEdit: boolean) =>
    ({
      canEdit,
      departments: [{ id: D1, name: "Organic (SEO)", sort: 1 }, { id: D2, name: "Performance", sort: 2 }],
      tiers: [{ id: T1, key: "T1", name: "Tier 1", sort: 1 }],
      services: [svc("00000000-0000-4000-8000-0000000000a1", D1, 0.01), svc("00000000-0000-4000-8000-0000000000a2", D2, 0.025)],
    }) as unknown as CapacitySetup;

  it("shows one cell per department and tier, as a percentage, and goes above the drivers", () => {
    const table = renderToStaticMarkup(createElement(NormalChurnByTier, { setup: setup(false) }));
    expect(table).toContain("Normal churn by tier");
    expect(table).toContain("Organic (SEO) %");
    expect(table).toContain("Performance %");
    expect(table).toContain(">1<");
    expect(table).toContain(">2.5<");
    const page = renderToStaticMarkup(createElement(ChurnDriversSettings, { mode: "readonly", workspaceId: null, bundle: null, rows: [], normalChurn: createElement(NormalChurnByTier, { setup: setup(false) }) }));
    expect(page.indexOf("Normal churn by tier")).toBeLessThan(page.indexOf("Drivers that raise or lower it"));
  });

  it("an editor gets inputs", () => {
    const html = renderToStaticMarkup(createElement(NormalChurnByTier, { setup: setup(true) }));
    expect(html).toMatch(/<input/);
    expect(html).toContain("Organic (SEO) T1: Normal churn a month");
  });
});
