"use client";

import type { ServiceRow } from "@transpera-flow/db";
import { NumberField } from "@/components/fields";
import { Help, type HelpProps } from "@/components/help";
import type { WorkspaceSettingsData } from "@/lib/data";
import { newGroupDefaults, MAX_GROUP_COUNT, type ClientGroupField } from "@/lib/client-groups";
import { saveClientGroupField, saveClientHealthBenchmark } from "./actions";

// Settings, counted clients (issue #120): the clients counted per tier instead of named. The simulation creates unnamed clients
// from the count, at the tier's own fee, churn and stay, so late work still lowers health and drives churn.

type HelpText = Omit<HelpProps, "className">;

const HELP: Record<"count" | "health" | "benchmark", HelpText> = {
  count: {
    label: "Clients",
    description: "How many clients you have on this tier today that nobody's portfolio holds. They pay the tier's fee and churn at its rate.",
    example: "15 clients on SEO.",
  },
  health: {
    label: "Starting health",
    description: "How happy these clients are today, from 0 to 100. Servicing that runs on time lifts it; late or missed work lowers it, and lower health makes clients leave sooner.",
    example: "SEO clients start at 80.",
  },
  benchmark: {
    label: "Client health benchmark",
    description: "The range of client health that is normal for a business like yours. The People page shows your simulated client health against it.",
    example: "70 to 80 is typical for a small SEO and PPC agency.",
  },
};

const GROUP_FIELD = {
  client_count: "count",
  starting_health: "health",
} as const satisfies Record<ClientGroupField, keyof typeof HELP>;

/** The range of client health that is normal for the business (the People page shows the simulated score against it). */
export function ClientHealthBenchmark({ data }: { data: WorkspaceSettingsData }) {
  const { canManage, workspace } = data;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 flex items-center text-xs font-medium text-fg-2">
        Client health benchmark
        <Help {...HELP.benchmark} />
      </legend>
      <div className="grid max-w-md gap-4 sm:grid-cols-2">
        <NumberField
          label="From"
          help={{ description: "The low end of the client health that is normal for a business like yours.", example: "70 for a small SEO and PPC agency." }}
          value={workspace.settings.client_health_benchmark_low ?? null}
          save={(base, next) => saveClientHealthBenchmark(workspace.id, "low", base, next)}
          optional
          min={0}
          max={100}
          step={1}
          placeholder="70"
          disabled={!canManage}
        />
        <NumberField
          label="To"
          help={{ description: "The high end of the client health that is normal for a business like yours.", example: "80 for a small SEO and PPC agency." }}
          value={workspace.settings.client_health_benchmark_high ?? null}
          save={(base, next) => saveClientHealthBenchmark(workspace.id, "high", base, next)}
          optional
          min={0}
          max={100}
          step={1}
          placeholder="80"
          disabled={!canManage}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {canManage ? "The People page shows your client health against this range. Leave both blank for no benchmark." : "Only Agency admins can change this."}
      </p>
  </fieldset>
  );
}

/**
 * One tier's counted-clients numbers (Set up shows it under "More" for a tier): the count and the starting health. Their fee, churn
 * and stay are the tier's own, edited in the tier table, so there is one number for each and nothing here to fall out of step.
 */
export function GroupFields({ service, data }: { service: ServiceRow; data: WorkspaceSettingsData }) {
  const group = data.clientGroups.find((g) => g.service_id === service.id);
  const field = (f: ClientGroupField, label: string, extra: { min: number; max: number; step: number }) => (
    <NumberField
      label={label}
      help={HELP[GROUP_FIELD[f]]}
      value={group ? Number(group[f]) : null}
      save={(base, next) => saveClientGroupField(data.workspace.id, service.id, f, base, next)}
      placeholder={group ? undefined : String(newGroupDefaults(data.workspace.settings)[f])}
      disabled={!data.canEdit}
      {...extra}
    />
  );
  return (
    <fieldset className="sm:col-span-2 lg:col-span-3">
      <legend className="mb-1 text-xs font-medium text-fg-2">Counted clients: clients nobody is named for. They pay this tier&apos;s fee and churn at its rate.</legend>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {field("client_count", "Counted clients nobody's portfolio holds yet", { min: 0, max: MAX_GROUP_COUNT, step: 1 })}
        {field("starting_health", "Starting health", { min: 0, max: 100, step: 1 })}
      </div>
    </fieldset>
  );
}
