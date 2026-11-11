// Sample market conditions for the read-only demo (/demo/market) and the tests: the four presets, one custom
// condition and a schedule like the prototype's (Stable, then Soft from month 7, then "Cautious 2027" from month 15).

import { MARKET_PRESETS, percentsFromFactors, type MarketPresetKey } from "@transpera-flow/engine";
import type { MarketConditionRow, MarketScheduleRow } from "@transpera-flow/db";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export function demoMarket(): { workspaceId: string; marketConditions: MarketConditionRow[]; marketSchedule: MarketScheduleRow[] } {
  const keys = Object.keys(MARKET_PRESETS) as MarketPresetKey[];
  const presets = keys.map(
    (k, i): MarketConditionRow => ({ id: id(i + 1), workspace_id: WORKSPACE, name: MARKET_PRESETS[k].name, preset: k, ...percentsFromFactors(MARKET_PRESETS[k].factors) }),
  );
  const custom: MarketConditionRow = { id: id(9), workspace_id: WORKSPACE, name: "Cautious 2027", preset: null, leads: 92, conv: 95, cycle: 110, price: 97, churn: 108, hire: 100, pay: 110 };
  const soft = presets.find((c) => c.preset === "soft")!;
  return {
    workspaceId: WORKSPACE,
    marketConditions: [...presets, custom],
    marketSchedule: [
      { id: id(21), workspace_id: WORKSPACE, from_month: 7, to_month: 14, condition_id: soft.id },
      { id: id(22), workspace_id: WORKSPACE, from_month: 15, to_month: 24, condition_id: custom.id },
    ],
  };
}
