"use client";

import { useState, useTransition } from "react";
import { DEFAULT_AVAILABILITY_FLOOR, DEFAULT_WORKING_DAYS } from "@transpera-flow/engine";
import { DEFAULT_AT_RISK_MARGIN, DEFAULT_DLER_GOAL } from "@transpera-flow/db";
import { ChecklistField, DateField, FieldRows, NumberField, SelectField, TextField, ToggleField } from "@/components/fields";
import { ASSUMPTION_LIMITS, assumptionValues, type AssumptionKey } from "@/lib/analysis/assumptions";
import { HORIZON_MONTHS, horizonLabel, horizonWeeks, isHorizonMonths, monthsForWeeks } from "@/lib/horizon";
import { Help, HelpLabel } from "@/components/help";
import { Button } from "@/components/ui/button";
import { useAddForm } from "@/components/settings/use-add-form";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { SettingsSection } from "./section";
import { CapacityFactors, type SaveFactor } from "./capacity-factors-field";
import type { PersonDetail, WorkspaceSettingsData } from "@/lib/data";
import type { SaveOutcome, Saver } from "@/lib/fields/field-controller";
import { formatNumber } from "@/lib/format";
import { selectableRoles } from "@/lib/roles";
import {
  addLeave,
  createPerson,
  removeLeave,
  saveAnalysisAssumption,
  saveAtRiskMargin,
  saveAvailabilityFloor,
  saveCapacityFactorsEnabled,
  saveDlerGoal,
  saveForecastLength,
  saveHoursPerWeek,
  saveWorkingDays,
  saveOvertimeCap,
  savePersonField,
  savePersonSet,
  type ActionResult,
  type PersonField,
} from "./actions";
import { saveDlerIncludesLeadership } from "./setup-actions";

type Scalar = string | number | boolean | null;

/** A saver for one column of one person. */
const personSaver =
  <T extends Scalar>(personId: string, field: PersonField): Saver<T> =>
  (base, next) =>
    savePersonField(personId, field, base, next) as Promise<SaveOutcome<T>>;


/** The analysis assumptions as Settings shows them (`assumptionValues` of the stored analysis settings, defaults filled in). */
export type Assumptions = Record<AssumptionKey, number>;

const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function SimulationSettings({ data, assumptions = assumptionValues({}) }: { data: WorkspaceSettingsData; assumptions?: Assumptions }) {
  const { workspace, canManage } = data;
  const floor = workspace.settings.availability_floor ?? null;
  const overtime = workspace.settings.overtime_cap ?? null;
  const ownersOnly = canManage ? undefined : "Only Agency admins can change this.";
  const editorsOnly = data.canEdit ? undefined : "Only Agency admins can change this.";
  const weeks = workspace.settings.horizon_weeks;
  const months = monthsForWeeks(weeks);
  const lengthOptions = [
    ...HORIZON_MONTHS.map((m) => ({ value: String(m), label: horizonLabel(m) })),
    ...(months === null ? [{ value: "custom", label: `${weeks} weeks (pick a length to change it)` }] : []),
  ];
  const assumption = (key: AssumptionKey) => (base: number | null, next: number | null) => saveAnalysisAssumption(workspace.id, key, base, next);
  return (
    <SettingsSection id="simulation" band title="Simulation" description="The working week, limits on how the simulation treats people's time, the goals the figures are judged against, and the assumptions behind them.">
      <FieldRows>
        <NumberField
          label="Normal working week"
          value={workspace.settings.hours_per_week}
          save={(base, next) => saveHoursPerWeek(workspace.id, base, next)}
          unit="hours"
          min={1}
          max={168}
          step={0.5}
          disabled={!canManage}
          hint={ownersOnly}
          help={{
            description: "The hours in a normal full-time week. Anyone without their own hours a week has this times their working time.",
            example: "37.5: someone at 0.8 working time has 30 hours a week.",
          }}
        />
        <NumberField
          label="Working days a week"
          value={workspace.settings.working_days ?? null}
          save={(base, next) => saveWorkingDays(workspace.id, base, next)}
          optional
          unit="days"
          min={1}
          max={7}
          step={0.5}
          placeholder={`${DEFAULT_WORKING_DAYS} (default)`}
          disabled={!canManage}
          hint={ownersOnly ?? "Leave blank for a 5-day week."}
          help={{
            description: "How many days the normal week is spread over. A working day is the week's hours over these days, wherever days are turned into hours: first delivery, waits and days in findings.",
            example: "A 4-day week of 32 hours: a working day is 8 hours, so 10 working days to first delivery is 80 hours.",
          }}
        />
        <SelectField
          label="Default forecast length"
          value={months === null ? "custom" : String(months)}
          save={(base, next) => saveForecastLength(workspace.id, base !== null && isHorizonMonths(Number(base)) ? horizonWeeks(Number(base)) : weeks, next)}
          options={lengthOptions}
          disabled={!canManage}
          hint={ownersOnly}
          help={{
            description: "How far ahead the Overview and the People page run when they open. You can still pick another length on each page.",
            example: "12 months: the Overview's team load and hiring advice look a year ahead, as the Capacity page does.",
          }}
        />
        <NumberField
          label="DLER goal"
          value={numOrNull(workspace.settings.dler_goal)}
          save={(base, next) => saveDlerGoal(workspace.id, base, next)}
          optional
          min={0.1}
          max={50}
          step={0.1}
          unit="× salaries"
          placeholder={`${DEFAULT_DLER_GOAL} (default)`}
          disabled={!canManage}
          hint={ownersOnly ?? "Leave blank to use the default."}
          help={{
            description: "The DLER you aim for: what clients pay a month for every dollar of salary. The Overview, Capacity and the Sandbox mark each department at or below it.",
            example: "3 for a 3:1 goal: someone on 8,000 a month should look after clients paying 24,000 a month.",
          }}
        />
        <ToggleField
          label="DLER counts leadership"
          value={workspace.settings.dler_includes_leadership === true}
          save={(base, next) => saveDlerIncludesLeadership(workspace.id, base, next)}
          onLabel="On: directors and managers count"
          offLabel="Off: directors and managers are left out"
          disabled={!canManage}
          hint={ownersOnly}
          help={{
            description: "Whether roles marked as leadership count in DLER and in MRR per person. Off leaves their salaries and their time out of both.",
            example: "Off: a director who also manages two clients doesn't pull the department's DLER down.",
          }}
        />
        <NumberField
          label="At-risk margin"
          value={numOrNull(workspace.settings.at_risk_margin)}
          save={(base, next) => saveAtRiskMargin(workspace.id, base, next)}
          optional
          scale={100}
          unit="points"
          min={0}
          max={50}
          step={1}
          placeholder={`${DEFAULT_AT_RISK_MARGIN * 100} (default)`}
          disabled={!canManage}
          hint={ownersOnly ?? "Leave blank to use the default."}
          help={{
            description: "How close under their role's utilisation threshold someone can be before they show as at risk (amber) on Capacity, the Overview and the Sandbox.",
            example: "At 10, a role with an 85% threshold shows people from 75% busy as at risk.",
          }}
        />
        <ToggleField
          label="Per-person times"
          value={workspace.settings.capacity_factor_enabled === true}
          save={(base, next) => saveCapacityFactorsEnabled(workspace.id, base, next)}
          onLabel="On: people can have their own times"
          offLabel="Off: everyone works at their role's normal time"
          disabled={!data.canEdit}
          hint={data.canEdit ? undefined : "Only Agency admins can change this."}
          help={{
            description:
              "Let Agency admins say that one person takes more or less time than their role's normal time on some steps. Off: everyone in a role works at the role's normal time. Each person sees only their own times; they are never ranked or compared across people. Members' and viewers' simulations always use the role's normal time.",
            example: "Maya has run kickoffs for years and takes about 0.8 of the normal time on Kickoff, 20% faster. Switch this on and set 0.8 on Kickoff in her detail under People.",
          }}
        />
        <NumberField
          label="Availability floor"
          value={floor}
          save={(base, next) => saveAvailabilityFloor(workspace.id, base, next)}
          optional
          scale={100}
          unit="%"
          min={0}
          max={50}
          step={1}
          placeholder={`${DEFAULT_AVAILABILITY_FLOOR * 100} (default)`}
          disabled={!canManage}
          hint={ownersOnly ?? "Leave blank to use the default."}
          help={{
            description: "The share of each person's week that is always left for sales work, however busy client work gets. This stops client work from squeezing the sales process to a standstill.",
            example: "At 8%, someone with a 40-hour week always has about 3 hours for sales work, even in a month when client work would fill the rest.",
          }}
        />
        <NumberField
          label="Overtime cap"
          value={overtime}
          save={(base, next) => saveOvertimeCap(workspace.id, base, next)}
          optional
          scale={100}
          unit="% of a week"
          min={0}
          max={100}
          step={5}
          placeholder="0 (default: none)"
          disabled={!canManage}
          hint={ownersOnly ?? "Leave blank for no overtime."}
          help={{
            description: "How much extra, beyond a normal week, people work to keep up when their client work is more than their week. The simulation counts the extra hours and their cost. Past this limit, people show as too busy and an Operational risk is raised.",
            example: "At 10%, someone with a 40-hour week can work up to 4 hours extra before they count as overloaded.",
          }}
        />
        <NumberField
          label="Busy warning starts"
          value={assumptions.busyBelow}
          save={assumption("busyBelow")}
          scale={100}
          unit="points under the threshold"
          min={ASSUMPTION_LIMITS.busyBelow.min * 100}
          max={ASSUMPTION_LIMITS.busyBelow.max * 100}
          step={1}
          disabled={!data.canEdit}
          hint={editorsOnly}
          help={{
            description: "How far under a role's utilisation threshold the facts start calling someone busy. Each role's own threshold is the too-busy line.",
            example: `At ${ASSUMPTION_LIMITS.busyBelow.default * 100}, a role with an 85% threshold is busy from 70%.`,
          }}
        />
        <NumberField
          label="Overloaded from"
          value={assumptions.busyAbove}
          save={assumption("busyAbove")}
          scale={100}
          unit="points over the threshold"
          min={ASSUMPTION_LIMITS.busyAbove.min * 100}
          max={ASSUMPTION_LIMITS.busyAbove.max * 100}
          step={1}
          disabled={!data.canEdit}
          hint={editorsOnly}
          help={{
            description: "How far over a role's utilisation threshold someone counts as an operational risk, not just too busy.",
            example: `At ${Math.round(ASSUMPTION_LIMITS.busyAbove.default * 100)}, a role with an 85% threshold is an operational risk from 95%.`,
          }}
        />
        <NumberField
          label="A lost client is worth up to"
          value={assumptions.capMonths}
          save={assumption("capMonths")}
          unit="months of fees"
          min={ASSUMPTION_LIMITS.capMonths.min}
          max={ASSUMPTION_LIMITS.capMonths.max}
          step={1}
          disabled={!data.canEdit}
          hint={editorsOnly}
          help={{
            description: "The most a lost deal or a client who leaves is counted as costing, in months of their fee. Used for the cost a month of each fact.",
            example: "At 24, a client paying 3,000 a month who leaves with years to go counts as 72,000 lost.",
          }}
        />
        <NumberField
          label="Absence test: weeks away"
          value={assumptions.absenceWeeks}
          save={assumption("absenceWeeks")}
          unit="weeks"
          min={ASSUMPTION_LIMITS.absenceWeeks.min}
          max={ASSUMPTION_LIMITS.absenceWeeks.max}
          step={1}
          disabled={!data.canEdit}
          hint={editorsOnly}
          help={{
            description: "How long the \u201cIf someone is away\u201d test takes a person out, to see what only they can do.",
            example: "4 weeks for a typical summer holiday.",
          }}
        />
        <NumberField
          label="Absences a year"
          value={assumptions.absencesPerYear}
          save={assumption("absencesPerYear")}
          unit="a year"
          min={ASSUMPTION_LIMITS.absencesPerYear.min}
          max={ASSUMPTION_LIMITS.absencesPerYear.max}
          step={1}
          disabled={!data.canEdit}
          hint={editorsOnly}
          help={{
            description: "How often such an absence happens in a year, for what it costs.",
            example: "2: a long break in summer and one in winter.",
          }}
        />
      </FieldRows>
    </SettingsSection>
  );
}

const NOT_SENT: ActionResult = {};

/** `onAdded` runs once a person has been added (the Set up page closes its dialog); `className` replaces the form's spacing. */
export function AddPerson({ data, onAdded, className }: { data: WorkspaceSettingsData; onAdded?: () => void; className?: string }) {
  const { state, pending, onSubmit } = useAddForm<ActionResult>(createPerson.bind(null, data.workspace.id), NOT_SENT, onAdded);
  return (
    <form onSubmit={onSubmit} className={cn("flex flex-wrap items-end gap-2", className ?? "mb-4")}>
      <label className="flex flex-col gap-1">
        <HelpLabel label="Name" description="The person's name, as it appears across the app." example="Maya Collins" />
        <Input name="name" required maxLength={200} />
      </label>
      <label className="flex flex-col gap-1">
        <HelpLabel label="Role" description="The kind of work they do. A step that needs a role can be done by anyone who has it. You can add more roles later." example="Strategist, if Maya runs the strategy steps." />
        <NativeSelect name="role_id">
          <option value="">No role yet</option>
          {selectableRoles(data.roles).map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </NativeSelect>
      </label>
      <Button
        type="submit"
        disabled={pending}
      >
        {pending ? "Adding…" : "Add person"}
      </Button>
      {state.error && (
        <p role="alert" className="w-full text-crit">
          {state.error}
        </p>
      )}
    </form>
  );
}

/** Which part of a person the Set up panel asks for: its Basics, its Time group, or its More group. Without one, every field (the old layout). */
export type PersonPart = "basics" | "time" | "more";

/**
 * Everything else about a person (the part of a row that opens). The Set up panel asks for one `part` at a time and sets `compact` for a
 * single narrow column; hours a week is not in a part, because the panel keys it through Set up (which records its source).
 */
export function PersonMore({ person: p, data, saveFactor, part, compact }: { person: PersonDetail; data: WorkspaceSettingsData; saveFactor?: SaveFactor; part?: PersonPart; compact?: boolean }) {
  const roleIds = data.personRoles.filter((r) => r.person_id === p.id).map((r) => r.role_id);
  const skillIds = data.personSkills.filter((s) => s.person_id === p.id).map((s) => s.step_id);
  const leave = data.personLeave.filter((l) => l.person_id === p.id);
  const hoursPerWeek = data.workspace.settings.hours_per_week;
  const disabled = !data.canEdit;
  const roleName = new Map(data.roles.map((r) => [r.id, r.name]));
  const factorsOn = data.workspace.settings.capacity_factor_enabled === true;
  const hasStoredFactors = data.personCapacityFactors.some((f) => f.person_id === p.id);
  const show = (which: PersonPart) => part === undefined || part === which;
  const grid = compact ? "grid gap-4 sm:grid-cols-2" : "grid gap-4 px-1 pt-3 pb-2 sm:grid-cols-2 lg:grid-cols-3";
  const full = compact ? "sm:col-span-2" : "sm:col-span-2 lg:col-span-3";

  return (
      <div className={grid} data-person-part={part}>
        {show("basics") && (
          <>
            <TextField label="Name" value={p.name} save={personSaver(p.id, "name")} disabled={disabled} help={{ description: "The person's name, as it appears across the app.", example: "Maya Collins" }} />
            <TextField label="Email" type="email" value={p.email} save={personSaver(p.id, "email")} optional disabled={disabled} help={{ description: "Their work email. Optional, and not used by the simulation.", example: "maya@northbeam.example" }} />
            <ToggleField
              label="Status"
              value={p.active}
              save={personSaver(p.id, "active")}
              onLabel="Active"
              offLabel="Inactive: left out of simulations"
              disabled={disabled} help={{ description: "Inactive people are left out of simulations, but their record is kept.", example: "Mark someone inactive when they leave. Past data stays; future runs no longer count their time." }} />
            <NumberField
              label="Working time (1 = full time)"
              value={Number(p.fte)}
              save={personSaver(p.id, "fte")}
              min={0.05}
              max={1.5}
              step={0.1}
              disabled={disabled} help={{ description: "How much of a full week they work: 1 is full time, 0.5 is half time. It sets how many hours they have each week, unless you type the hours yourself.", example: "At 0.8 with a 40-hour week, they have 32 hours a week." }} />
          </>
        )}
        {part === undefined && (
          <NumberField
            label="Capacity"
            value={p.capacity_hours_week === null ? null : Number(p.capacity_hours_week)}
            save={personSaver(p.id, "capacity_hours_week")}
            optional
            unit="h/week"
            min={0.5}
            max={80}
            step={0.5}
            placeholder={`${formatNumber(Number(p.fte) * hoursPerWeek, 1)} from working time`}
            hint="Blank: working time × the workspace week."
            disabled={disabled} help={{ description: "The hours they can work each week, when that isn't simply their working time times the working week. Leave blank to use working time.", example: "A full-time person who works four 7.5-hour days: enter 30." }} />
        )}
        {show("basics") && (
          <NumberField
            label="Cost rate"
            value={p.cost_rate === null ? null : Number(p.cost_rate)}
            save={personSaver(p.id, "cost_rate")}
            optional
            unit={`${data.workspace.settings.currency}/h`}
            min={0}
            step={1}
            placeholder="Role default"
            disabled={disabled} help={{ description: "What an hour of this person's time costs. Leave blank to use the role's rate. The simulation uses it to cost overtime.", example: "35 means each overtime hour costs 35." }} />
        )}
        {show("time") && (
          <>
            <DateField label="Start date" value={p.start_date} save={personSaver(p.id, "start_date")} disabled={disabled} help={{ description: "The first day they work here. Runs that start before it leave them out.", example: "A new hire starting on 3 November is not counted in runs that start in October." }} />
            <DateField label="End date" value={p.end_date} save={personSaver(p.id, "end_date")} disabled={disabled} help={{ description: "Their last day. Runs that start after it leave them out. Leave blank if they are staying.", example: "Someone leaving at the end of March: enter 31 March." }} />
          </>
        )}
        {show("more") && (
          <div className={full}>
            <TextField label="Notes" value={p.notes} save={personSaver(p.id, "notes")} optional multiline disabled={disabled} help={{ description: "Anything worth remembering about this person's time. Not used by the simulation.", example: "Does school pick-ups on Fridays, so unavailable after 2pm." }} />
          </div>
        )}

        {show("basics") && (
          <div className={full}>
            <ChecklistField
              label="Roles"
              value={roleIds}
              save={(base, next) => savePersonSet(p.id, p.workspace_id, "roles", [...base], [...next])}
              options={selectableRoles(data.roles, roleIds).map((r) => ({ id: r.id, label: r.name }))}
              emptyLabel="no roles"
              disabled={disabled} help={{ description: "The kinds of work they do. A step that needs a role can be done by anyone who has it.", example: "Tick Strategist and Account manager if Maya does both." }} />
          </div>
        )}
        {show("more") && data.steps.length > 0 && (
          <div className={full}>
            <ChecklistField
              label="Skills: steps they can do"
              value={skillIds}
              save={(base, next) => savePersonSet(p.id, p.workspace_id, "skills", [...base], [...next])}
              options={data.steps.map((s) => ({
                id: s.id,
                label: s.name,
                sublabel: s.role_id ? roleName.get(s.role_id) : undefined,
              }))}
              hint="None ticked: every step of their roles."
              emptyLabel="every step of their roles"
              disabled={disabled} help={{ description: "Limit this person to particular steps within their roles. If nothing is ticked, they can do every step of their roles.", example: "Tick only Kickoff and strategy if Tom does kickoffs but not audits." }} />
          </div>
        )}
        {show("more") &&
          (factorsOn ? (
            <div className={full}>
              <CapacityFactors person={p} data={data} saveFactor={saveFactor} />
            </div>
          ) : hasStoredFactors ? (
            <p className={cn("text-fg-3", full)} data-factors-off>
              Per-person times are off, so these aren&apos;t used.
            </p>
          ) : null)}
        {show("time") && (
          <div className={full}>
            <Leave personId={p.id} workspaceId={p.workspace_id} leave={leave} disabled={disabled} />
          </div>
        )}
      </div>
  );
}

function Leave({
  personId,
  workspaceId,
  leave,
  disabled,
}: {
  personId: string;
  workspaceId: string;
  leave: WorkspaceSettingsData["personLeave"];
  disabled: boolean;
}) {
  const { state, pending, onSubmit } = useAddForm<ActionResult>(addLeave.bind(null, personId, workspaceId), {});
  const [removeError, setRemoveError] = useState<string>();
  return (
    <fieldset>
      <legend className="mb-1 flex items-center text-xs font-medium text-fg-2">
        Leave
        <Help
          label="Leave"
          description="Days when this person is away. The simulation takes those working days off their hours."
          example="Add 4 to 15 August, holiday, and Maya has no hours in those two weeks."
        />
      </legend>
      {leave.length === 0 ? (
        <p className="text-fg-3">No leave booked.</p>
      ) : (
        <ul className="mb-2 flex flex-col gap-1">
          {leave.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-x-3">
              <span className="tabular-nums">
                {l.start_date === l.end_date ? l.start_date : `${l.start_date} to ${l.end_date}`}
              </span>
              {l.note && <span className="text-fg-2">{l.note}</span>}
              {!disabled && <RemoveLeave id={l.id} when={l.start_date === l.end_date ? l.start_date : `${l.start_date} to ${l.end_date}`} onDone={setRemoveError} />}
            </li>
          ))}
        </ul>
      )}
      {removeError && (
        <p role="alert" className="text-crit">
          {removeError}
        </p>
      )}
      {!disabled && (
        <form onSubmit={onSubmit} className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <HelpLabel label="First day" description="The first day of the leave." example="Monday 14 July." />
            <Input type="date" name="start_date" required />
          </label>
          <label className="flex flex-col gap-1">
            <HelpLabel label="Last day" description="The last day of the leave. Leave blank for a single day." example="Friday 25 July, for a two-week holiday." />
            <Input type="date" name="end_date" />
          </label>
          <label className="flex flex-col gap-1">
            <HelpLabel label="Note" description="Anything worth remembering about this leave. Not used by the simulation." example="Annual leave." />
            <Input name="note" maxLength={200} />
          </label>
          <Button variant="outline" size="sm"
            type="submit"
            disabled={pending}
          >
            {pending ? "Adding…" : "Add leave"}
          </Button>
          {state.error && (
            <p role="alert" className="w-full text-crit">
              {state.error}
            </p>
          )}
        </form>
      )}
    </fieldset>
  );
}

/** Remove for one booking of leave, asked once first ("Remove leave 4 to 15 August?"), as a role's Remove is. */
function RemoveLeave({ id, when, onDone }: { id: string; when: string; onDone: (error: string | undefined) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [removing, start] = useTransition();
  if (!confirming) {
    return (
      <Button variant="link" size="xs" className="h-auto p-0 text-muted-foreground underline hover:text-destructive" type="button" onClick={() => setConfirming(true)}>
        Remove
      </Button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2" data-confirm-remove-leave>
      <span>Remove leave {when}?</span>
      <Button
        variant="destructive"
        size="xs"
        type="button"
        disabled={removing}
        onClick={() =>
          start(async () => {
            const r = await removeLeave(id);
            onDone(r.error);
            if (r.error) setConfirming(false);
          })
        }
      >
        {removing ? "Removing…" : "Remove"}
      </Button>
      <Button variant="outline" size="xs" type="button" disabled={removing} onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </span>
  );
}
