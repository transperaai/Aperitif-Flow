"use client";

// The free-play Sandbox's levers, one full-width band under the company map (capacity build P7, brief "The short version"; the prototype's `.levers`).
// Every change is a new `PlayState`: the page re-runs, debounced, and nothing is saved. Market, Win new clients, Lose clients, Prices (with "Clients
// react", D36), People, Client service (health rules and how much health moves churn), Work (hours a week) and Costs (only for those who see pay) sit side by side as columns (wrapping on smaller screens), divided by hairlines; every
// group shows. The band's header counts the changes and resets them. The levers are business conditions only: an automation or augmentation is part
// of a process version, picked on the company map (D53).

import { MARKET_PRESETS, type MarketPresetKey } from "@transpera-flow/engine";
import Link from "next/link";
import {
  HIRE_FTE,
  PLAY_HEALTH_RANGE,
  PLAY_HEALTH_RULES,
  PLAY_SENSITIVITY_RANGE,
  PRICE_REACTION,
  PRICE_RISE_MONTHS,
  defaultPlay,
  healthMoved,
  overheadsMoved,
  hireFte,
  hiringDelayBase,
  playHireSalary,
  playSliderRanges,
  type CapacitySetup,
  type PlayHealthRule,
  type PlayMarket,
  type PlaySliderRange,
  type PlayState,
  type PriceReaction,
} from "@transpera-flow/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatNumber, formatWholeCurrency } from "@/lib/format";
import type { PlayMonths } from "./play-types";

const FIELD = "flex min-w-0 flex-col gap-1 text-xs text-muted-foreground";
/** A named leaver, hire or lost client, on two lines to fit a column: who (or which role), then the month and Remove. */
const ROW = "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 border-t border-line pt-2 first:border-t-0 first:pt-0";

/**
 * A group of levers: a column of the band, its heading then its fields stacked. Hairlines on its left and top divide it from its neighbours; the
 * grid is pulled a pixel up and left under the band's clipped edge, so the first column of each row and the first row show none, however it wraps.
 */
function Group({ title, children, id }: { title: string; children: React.ReactNode; id: string }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-3 border-t border-l border-line px-4 pt-3 pb-4" data-lever-details={id}>
      <h3 className="text-sm font-semibold">{title}</h3>
      <fieldset aria-label={title} className="flex min-w-0 flex-col gap-2 border-0 p-0" data-lever-group={id}>
        {children}
      </fieldset>
    </section>
  );
}

/** How many levers are off their default (the map's versions are counted on the map, not here). Pure. */
export function leverChanges(p: PlayState): number {
  const d = defaultPlay();
  return (
    (p.market !== d.market ? 1 : 0) +
    (p.leads ? 1 : 0) +
    (p.win ? 1 : 0) +
    (p.churn ? 1 : 0) +
    Object.values(p.add).filter((n) => n > 0).length +
    (p.price ? 1 : 0) +
    ((p.hiringDelay ?? null) !== null ? 1 : 0) +
    p.leavers.length +
    p.hires.length +
    p.lose.length +
    healthMoved(p).length +
    (Number(p.sensitivity) ? 1 : 0) +
    (overheadsMoved(p) ? 1 : 0) +
    (Number(p.pay) ? 1 : 0) +
    (Number(p.hours) ? 1 : 0)
  );
}

/** The Client service group's health rules, as the levers word them. */
const HEALTH_LEVERS: Record<PlayHealthRule, { label: string; title: string }> = {
  initial: { label: "Starting health", title: "Health a client starts at when it has none of its own (new wins, counted clients and named clients with no health set), out of 100" },
  recover: { label: "Task on time", title: "Health a client gains for each task done on time" },
  late_penalty: { label: "Task late", title: "Health a client loses for each late task" },
  missed_penalty: { label: "Task missed", title: "Health a client loses for each missed task" },
};

/** A slider over the lever's whole range (the registry's), with a box beside it to type an exact change; both clamp to the range. */
function Slider({ id, label, value, range, unit, onChange }: { id: string; label: string; value: number; range: PlaySliderRange; unit: string; onChange: (v: number) => void }) {
  const { min, max, step } = range;
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(Number.isFinite(v) ? v : 0)));
  return (
    <div className="flex flex-col gap-1 text-sm" data-lever={id}>
      <span className="flex items-center justify-between gap-2">
        <span id={`lever-${id}-label`}>{label}</span>
        <span className="flex items-center gap-1">
          <b className="sr-only tabular-nums" data-lever-value>
            {value > 0 && min < 0 ? "+" : ""}
            {formatNumber(value, 0)}
            {unit}
          </b>
          <Input
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(clamp(Number(e.target.value)))}
            aria-label={`${label}, exact ${unit}`}
            className="h-7 w-20 text-right tabular-nums"
            data-lever-input={id}
          />
          <span className="text-xs text-muted-foreground">{unit}</span>
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(clamp(Number(e.target.value)))} aria-label={label} className="w-full accent-[var(--accent)]" />
    </div>
  );
}

/** "For" in Win new clients: these spans, up to the run's length. */
const ADD_SPANS = [1, 2, 3, 6, 9, 12, 18, 24, 36, 48, 60];

/** "Lasts" in Prices: how many months a rise can weigh on churn (the driver's own 1 to 24). */
const PRICE_SPANS = [1, 2, 3, 4, 6, 9, 12, 18, 24];

/** "Months to hire" in People: the saved scenario's D9 range (0 to 6) and a little past it. */
const HIRE_SPANS = [0, 1, 2, 3, 4, 5, 6, 9, 12];

/** A hire's FTE choices: the hire lever's offered range, in tenths. */
const HIRE_FTES = Array.from({ length: Math.round((HIRE_FTE.offered.max - HIRE_FTE.offered.min) * 10) + 1 }, (_, i) => Math.round((HIRE_FTE.offered.min + i / 10) * 10) / 10);

/** The sliders' ranges, from the lever registry the levers map to. */
const RANGES = playSliderRanges();

function MonthSelect({ value, months, onChange, label, id, disabled }: { value: number; months: PlayMonths; onChange: (m: number) => void; label: string; id?: string; disabled?: boolean }) {
  return (
    <label className={FIELD}>
      {label}
      <NativeSelect value={value} onChange={(e) => onChange(Number(e.target.value))} data-lever={id} aria-label={label} disabled={disabled}>
        {months.long.map((m, i) => (
          <option key={i} value={i}>
            {m}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}

export function PlayLevers({
  play,
  setPlay,
  setup,
  months,
  expectedWinsPerMonth,
  priceDriverMonths = PRICE_RISE_MONTHS,
  settingsHref,
  note,
  healthToday,
}: {
  play: PlayState;
  setPlay: (next: PlayState) => void;
  setup: CapacitySetup;
  months: PlayMonths;
  /** What the lead flow brings a month, in clients, for the note under "Win new clients". */
  expectedWinsPerMonth: number | null;
  /** How long a price rise weighs on churn by the workspace's own price churn driver (`priceRiseMonths`), for "Lasts" and its note. */
  priceDriverMonths?: number;
  /** The workspace's Settings page, for the links in the notes. */
  settingsHref?: string;
  /** Under the columns: where the baselines are set. */
  note?: React.ReactNode;
  /** The workspace's own health rules (today's run), shown in the Client service fields until one is changed. */
  healthToday?: Record<PlayHealthRule, number>;
}) {
  const set = (p: Partial<PlayState>) => setPlay({ ...play, ...p });
  const hiringBase = hiringDelayBase({ hiring_delay_months: setup.hiringDelayMonths });
  const people = setup.people.filter((p) => p.active);
  const roles = setup.roles.filter((r) => r.active !== false);
  const clients = setup.clients.filter((c) => c.active);
  const tiers = setup.tiers;
  const listEdit = <T,>(key: "leavers" | "hires" | "lose", i: number, patch: Partial<T>) => set({ [key]: (play[key] as unknown as T[]).map((x, j) => (j === i ? { ...x, ...patch } : x)) } as Partial<PlayState>);
  const listDel = (key: "leavers" | "hires" | "lose", i: number) => set({ [key]: (play[key] as unknown[]).filter((_, j) => j !== i) } as Partial<PlayState>);
  const changes = leverChanges(play);

  return (
    <aside aria-label="Levers" className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-panel" data-play-levers data-lever-changes={changes}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2" data-levers-header>
        <h2 className="text-sm font-semibold">Levers</h2>
        <span className="text-xs text-muted-foreground tabular-nums" data-levers-count>
          {changes ? `${changes} change${changes === 1 ? "" : "s"}` : "No changes"}
        </span>
        <span className="hidden text-xs text-muted-foreground sm:inline">Move one and the results below follow.</span>
        <span className="flex-1" />
        <Button type="button" variant="ghost" size="sm" disabled={!changes} onClick={() => setPlay({ ...defaultPlay(), versions: play.versions })} data-levers-reset>
          Reset
        </Button>
      </div>
      <div className="-mt-px -ml-px grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(13rem,100%),1fr))]" data-lever-columns>
        <Group title="Market" id="market">
          <div className="grid grid-cols-2 gap-2">
            <label className={FIELD}>
              Conditions
              <NativeSelect value={play.market} onChange={(e) => set({ market: e.target.value as PlayMarket })} data-lever="market" aria-label="Market conditions">
                <option value="today">As today</option>
                {(Object.keys(MARKET_PRESETS) as MarketPresetKey[]).map((k) => (
                  <option key={k} value={k}>
                    {MARKET_PRESETS[k].name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <MonthSelect value={play.marketFrom} months={months} onChange={(m) => set({ marketFrom: m })} label="From" id="marketFrom" />
          </div>
          <Slider id="leads" label="Leads" value={play.leads} range={RANGES.leads} unit="%" onChange={(v) => set({ leads: v })} />
          <Slider id="win" label="Win rate" value={play.win} range={RANGES.win} unit="%" onChange={(v) => set({ win: v })} />
        </Group>

        <Group title="Win new clients" id="add">
          <div className="grid grid-cols-2 gap-2">
            {setup.departments.map((d) => (
              <label key={d.id} className={FIELD}>
                {d.name} a month
                <Input
                  type="number"
                  min={0}
                  max={50}
                  inputMode="numeric"
                  value={play.add[d.id] ?? 0}
                  onChange={(e) => set({ add: { ...play.add, [d.id]: Math.max(0, Math.min(50, Math.round(Number(e.target.value) || 0))) } })}
                  data-lever={`add:${d.id}`}
                  aria-label={`${d.name} clients a month`}
                />
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MonthSelect value={play.addFrom} months={months} onChange={(m) => set({ addFrom: m })} label="Starting" id="addFrom" />
            <label className={FIELD}>
              For
              <NativeSelect value={play.addMonths} onChange={(e) => set({ addMonths: Number(e.target.value) })} data-lever="addMonths" aria-label="For how many months">
                {ADD_SPANS.filter((n) => n <= Math.max(12, months.long.length)).map((n) => (
                  <option key={n} value={n}>
                    {n} month{n > 1 ? "s" : ""}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className={FIELD}>
              Tier
              <NativeSelect value={play.addTier} onChange={(e) => set({ addTier: e.target.value })} data-lever="addTier" aria-label="Tier of the new clients">
                <option value="mix">Usual mix</option>
                {tiers.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            {expectedWinsPerMonth !== null ? `On top of the ${formatNumber(expectedWinsPerMonth, 1)} a month expected from lead flow. ` : "On top of lead flow. "}
            They go straight to onboarding and servicing, on the least busy people.
          </p>
        </Group>

        <Group title="Lose clients" id="lose">
          <Slider id="churn" label="Churn" value={play.churn} range={RANGES.churn} unit="%" onChange={(v) => set({ churn: v })} />
          {play.lose.map((x, i) => (
            <div key={i} className={ROW} data-lose-row>
              <NativeSelect className="col-span-full" value={x.id} onChange={(e) => listEdit<{ id: string }>("lose", i, { id: e.target.value })} aria-label="Client who leaves">
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
              <span className="text-xs">leaves in</span>
              <NativeSelect value={x.month} onChange={(e) => listEdit<{ month: number }>("lose", i, { month: Number(e.target.value) })} aria-label="Month they leave">
                {months.long.map((m, j) => (
                  <option key={j} value={j}>
                    {m}
                  </option>
                ))}
              </NativeSelect>
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => listDel("lose", i)} aria-label="Remove">
                ✕
              </Button>
            </div>
          ))}
          {clients.length > 0 && (
            <div>
              <Button type="button" variant="outline" size="sm" data-lever="addLose" onClick={() => set({ lose: [...play.lose, { id: clients[0]!.id, month: 3 }] })}>
                + A named client leaves
              </Button>
            </div>
          )}
        </Group>

        <Group title="Prices" id="price">
          <Slider id="price" label="Price change" value={play.price} range={RANGES.price} unit="%" onChange={(v) => set({ price: v })} />
          <div className="grid grid-cols-2 gap-2">
            <label className={FIELD}>
              Tiers
              <NativeSelect value={play.priceTier} onChange={(e) => set({ priceTier: e.target.value })} data-lever="priceTier" aria-label="Tiers the price change is for">
                <option value="all">All</option>
                {tiers.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <MonthSelect value={play.priceFrom} months={months} onChange={(m) => set({ priceFrom: m })} label="From" id="priceFrom" />
            <label className={FIELD}>
              Clients react
              <NativeSelect value={play.priceReaction} onChange={(e) => set({ priceReaction: e.target.value as PriceReaction })} data-lever="priceReaction" aria-label="How clients react to a price change">
                {(Object.keys(PRICE_REACTION) as PriceReaction[]).map((k) => (
                  <option key={k} value={k}>
                    {PRICE_REACTION[k].label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className={FIELD}>
              Lasts
              <NativeSelect
                value={play.priceMonths ?? ""}
                onChange={(e) => set({ priceMonths: e.target.value === "" ? null : Number(e.target.value) })}
                data-lever="priceMonths"
                aria-label="How long a price rise weighs on churn"
              >
                <option value="">
                  {priceDriverMonths} month{priceDriverMonths === 1 ? "" : "s"} (Settings)
                </option>
                {PRICE_SPANS.filter((n) => n !== priceDriverMonths).map((n) => (
                  <option key={n} value={n}>
                    {n} month{n === 1 ? "" : "s"}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            A rise lifts churn for {play.priceMonths ?? priceDriverMonths} month{(play.priceMonths ?? priceDriverMonths) === 1 ? "" : "s"} (the price driver in Settings, under Churn drivers, unless you pick another). How much
            depends on the reaction, from each tier&apos;s own &ldquo;extra churn for each 10% rise&rdquo; in Settings, under Tiers & clients.
          </p>
        </Group>

        <Group title="People" id="people">
          {play.leavers.map((x, i) => (
            <div key={`l${i}`} className={ROW} data-leaver-row>
              <NativeSelect className="col-span-full" value={x.person} onChange={(e) => listEdit<{ person: string }>("leavers", i, { person: e.target.value })} aria-label="Person who leaves">
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
              <span className="text-xs">leaves in</span>
              <NativeSelect value={x.month} onChange={(e) => listEdit<{ month: number }>("leavers", i, { month: Number(e.target.value) })} aria-label="Month they leave">
                {months.long.map((m, j) => (
                  <option key={j} value={j}>
                    {m}
                  </option>
                ))}
              </NativeSelect>
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => listDel("leavers", i)} aria-label="Remove">
                ✕
              </Button>
            </div>
          ))}
          {play.hires.map((x, i) => (
            <div key={`h${i}`} className={ROW} data-hire-row>
              <span className="text-xs">Hire</span>
              <NativeSelect className="col-span-2" value={x.role} onChange={(e) => listEdit<{ role: string }>("hires", i, { role: e.target.value })} aria-label="Role to hire">
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </NativeSelect>
              <span className="text-xs">from</span>
              <NativeSelect value={x.month} onChange={(e) => listEdit<{ month: number }>("hires", i, { month: Number(e.target.value) })} aria-label="Month they start">
                {months.long.map((m, j) => (
                  <option key={j} value={j}>
                    {m}
                  </option>
                ))}
              </NativeSelect>
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => listDel("hires", i)} aria-label="Remove">
                ✕
              </Button>
              <span className="text-xs">at</span>
              <NativeSelect
                className={setup.payHidden ? "col-span-2" : undefined}
                value={String(hireFte(x))}
                onChange={(e) => listEdit<{ fte: number }>("hires", i, { fte: Number(e.target.value) })}
                aria-label="FTE of the hire"
                data-lever="hireFte"
              >
                {HIRE_FTES.map((f) => (
                  <option key={f} value={String(f)}>
                    {formatNumber(f, 1)} FTE
                  </option>
                ))}
              </NativeSelect>
              {!setup.payHidden && (
                <Input
                  type="number"
                  min={0}
                  step={100}
                  inputMode="decimal"
                  value={typeof x.pay === "number" ? x.pay : ""}
                  placeholder={(() => {
                    const usual = playHireSalary(setup, { ...x, pay: null });
                    return usual === null ? "Pay a month" : `${formatWholeCurrency(usual, setup.currency)} a month`;
                  })()}
                  title="What they'd be paid a month at this FTE. Blank: what the role's people are paid for a full-time week, times the FTE. Profit and DLER both cost the hire at it."
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    const v = Number(raw);
                    listEdit<{ pay: number | null }>("hires", i, { pay: raw === "" || !Number.isFinite(v) || v < 0 ? null : v });
                  }}
                  aria-label="Pay a month"
                  data-lever="hirePay"
                />
              )}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {people.length > 0 && (
              <Button type="button" variant="outline" size="sm" data-lever="addLeaver" onClick={() => set({ leavers: [...play.leavers, { person: people[0]!.id, month: 3 }] })}>
                + Someone leaves
              </Button>
            )}
            {roles.length > 0 && (
              <Button type="button" variant="outline" size="sm" data-lever="addHire" onClick={() => set({ hires: [...play.hires, { role: roles[0]!.id, month: 3 }] })}>
                + Hire
              </Button>
            )}
          </div>
          {play.hires.length > 0 && (
            <label className={FIELD}>
              Hires get up to speed
              <NativeSelect
                value={play.hireRamp ?? "workspace"}
                onChange={(e) => set({ hireRamp: e.target.value === "none" ? "none" : undefined })}
                data-lever="hireRamp"
                aria-label="How the hires get up to speed"
              >
                <option value="workspace">Over the new starter ramp (Settings)</option>
                <option value="none">At full speed from day one</option>
              </NativeSelect>
            </label>
          )}
          <label className={FIELD}>
            Months to hire
            <NativeSelect
              value={play.hiringDelay ?? ""}
              onChange={(e) => set({ hiringDelay: e.target.value === "" ? null : Number(e.target.value) })}
              data-lever="hiringDelay"
              aria-label="Months from deciding to hire to the person starting"
            >
              <option value="">
                {hiringBase} month{hiringBase === 1 ? "" : "s"} (Settings)
              </option>
              {HIRE_SPANS.filter((n) => n !== hiringBase).map((n) => (
                <option key={n} value={n}>
                  {n} month{n === 1 ? "" : "s"}
                </option>
              ))}
            </NativeSelect>
          </label>
          <p className="text-xs text-muted-foreground">
            &ldquo;Start hiring by&rdquo; allows this long to hire, stretched by the market. New hires take about {setup.rampDefault.length} months to reach full speed (the new starter ramp in{" "}
            {settingsHref ? (
              <Link href={`${settingsHref}#new-starters-heading`} className="font-medium text-accent hover:underline">
                Settings, under People &amp; roles
              </Link>
            ) : (
              "Settings, under People & roles"
            )}
            ).
          </p>
        </Group>

        <Group title="Client service" id="service">
          <div className="grid grid-cols-2 gap-2">
            {PLAY_HEALTH_RULES.map((k) => {
              const v = play.health?.[k];
              return (
                <label key={k} className={FIELD} title={HEALTH_LEVERS[k].title}>
                  {HEALTH_LEVERS[k].label}
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={PLAY_HEALTH_RANGE.min}
                    max={PLAY_HEALTH_RANGE.max}
                    step={PLAY_HEALTH_RANGE.step}
                    value={typeof v === "number" ? v : ""}
                    placeholder={healthToday ? formatNumber(healthToday[k], 0) : undefined}
                    onChange={(e) => {
                      const text = e.target.value.trim();
                      const n = text === "" ? null : Number(text);
                      set({ health: { ...play.health, [k]: n !== null && Number.isFinite(n) ? n : null } });
                    }}
                    data-lever={`health-${k}`}
                    aria-label={HEALTH_LEVERS[k].title}
                  />
                </label>
              );
            })}
          </div>
          <Slider
            id="sensitivity"
            label="How much health moves churn"
            value={Number(play.sensitivity) || 0}
            range={PLAY_SENSITIVITY_RANGE}
            unit="%"
            onChange={(v) => set({ sensitivity: v })}
          />
          <p className="text-xs text-muted-foreground">Blank keeps your own rules from Settings, under Churn drivers. -100% means health doesn&apos;t change churn at all.</p>
        </Group>

        <Group title="Work" id="work">
          <Slider id="hours" label="Hours a week" value={Number(play.hours) || 0} range={RANGES.hours} unit="%" onChange={(v) => set({ hours: v })} />
          <div className="grid grid-cols-2 gap-2">
            <label className={FIELD}>
              For
              <NativeSelect value={play.hoursRole ?? "all"} onChange={(e) => set({ hoursRole: e.target.value })} data-lever="hoursRole" aria-label="Whose hours change">
                <option value="all">Everyone</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <MonthSelect value={play.hoursFrom ?? 0} months={months} onChange={(m) => set({ hoursFrom: m })} label="From" id="hoursFrom" />
          </div>
          <p className="text-xs text-muted-foreground">
            The hours people have for work each week, from a month: -20% is a four-day week. Step times are part of a process version, picked on the company map.
          </p>
        </Group>

        {!setup.payHidden && (
          <Group title="Costs" id="costs">
            <div className="grid grid-cols-2 gap-2">
              <label className={FIELD}>
                Overheads a month
                <NativeSelect value={play.overheadsOp} onChange={(e) => set({ overheadsOp: e.target.value === "set" ? "set" : "add" })} data-lever="overheadsOp" aria-label="Change overheads by">
                  <option value="add">Add to today&apos;s</option>
                  <option value="set">Set to</option>
                </NativeSelect>
              </label>
              <label className={FIELD}>
                Amount
                <Input
                  type="number"
                  step={100}
                  min={play.overheadsOp === "set" ? 0 : -100_000_000}
                  max={100_000_000}
                  inputMode="decimal"
                  value={play.overheads ?? ""}
                  placeholder={play.overheadsOp === "set" ? "As today" : "0"}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    const v = Number(raw);
                    set({ overheads: raw === "" || !Number.isFinite(v) ? null : Math.max(play.overheadsOp === "set" ? 0 : -100_000_000, Math.min(100_000_000, v)) });
                  }}
                  data-lever="overheads"
                  aria-label="Overheads a month"
                />
              </label>
              <MonthSelect value={play.overheadsFrom} months={months} onChange={(m) => set({ overheadsFrom: m })} label="From" id="overheadsFrom" />
            </div>
            <Slider id="pay" label="Pay change" value={Number(play.pay) || 0} range={RANGES.pay} unit="%" onChange={(v) => set({ pay: v })} />
            <div className="grid grid-cols-2 gap-2">
              <label className={FIELD}>
                For
                <NativeSelect value={play.payRole} onChange={(e) => set({ payRole: e.target.value })} data-lever="payRole" aria-label="Whose pay changes">
                  <option value="all">Everyone</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <MonthSelect value={play.payFrom} months={months} onChange={(m) => set({ payFrom: m })} label="From" id="payFrom" />
            </div>
            <p className="text-xs text-muted-foreground">
              Rent, tools and other fixed costs, and a pay rise or cut from a month. Profit counts both; today&apos;s overheads, overtime pay and on-costs are in Settings.
            </p>
          </Group>
        )}
      </div>
      {note && <div className="border-t border-line px-4 py-2">{note}</div>}
    </aside>
  );
}
