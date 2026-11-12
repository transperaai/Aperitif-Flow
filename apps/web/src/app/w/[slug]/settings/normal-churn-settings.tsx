"use client";

// Settings, Churn drivers: Normal churn by tier. Each tier's normal churn a month (`services.churn_monthly_base`), one cell per department
// and tier, set here and only here (it used to be a column of the Tiers & clients tables). The drivers below raise or lower it. A save
// refreshes the page, so the projected churn above is worked out again from the new numbers.

import type { CapacitySetup } from "@transpera-flow/db";
import { HeadHelp, NumberCell } from "@/components/setup/cells";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { saveNormalChurn } from "./churn-drivers-actions";
import { SettingsSection } from "./section";

export const NORMAL_CHURN_HELP = {
  label: "Normal churn a month",
  description: "The share of a tier's clients who leave in a month when everything is going well. The churn drivers below raise or lower it.",
  example: "1% a month for Tier 1: about one client in a hundred.",
} as const;

export function NormalChurnByTier({ setup }: { setup: Pick<CapacitySetup, "departments" | "tiers" | "services" | "canEdit"> }) {
  const { departments, tiers, services, canEdit } = setup;
  if (!tiers.length || !departments.length) return null;
  const serviceOf = (deptId: string, tierId: string) => services.find((s) => s.department_id === deptId && s.tier_id === tierId && s.active);
  return (
    <SettingsSection
      id="normal-churn"
      title="Normal churn by tier"
      description={
        canEdit
          ? "The share of each tier's clients who leave in a month when everything is going well, per department. The drivers below raise or lower it."
          : "The share of each tier's clients who leave in a month when everything is going well. Agency admins and the Owner can change it."
      }
    >
      <div className="overflow-x-auto">
        <Table aria-label="Normal churn by tier" data-normal-churn>
          <TableHeader>
            <TableRow>
              <TableHead>Tier</TableHead>
              {departments.map((d) => (
                <HeadHelp key={d.id} help={{ ...NORMAL_CHURN_HELP, label: `${d.name}: normal churn a month` }}>
                  {d.name} %
                </HeadHelp>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {tiers.map((t) => (
              <TableRow key={t.id} data-tier={t.key}>
                <TableCell className="font-semibold">{t.key}</TableCell>
                {departments.map((d) => {
                  const svc = serviceOf(d.id, t.id);
                  return (
                    <TableCell key={d.id} className="text-right">
                      {svc ? (
                        <NumberCell
                          label={`${d.name} ${t.key}: Normal churn a month`}
                          value={svc.churn_monthly_base}
                          save={(base, next) => saveNormalChurn(svc.id, base, next)}
                          canEdit={canEdit}
                          optional={false}
                          scale={100}
                          unit=""
                          min={0}
                          max={100}
                          step={0.5}
                          provenance={svc.provenance}
                          column="churn_monthly_base"
                        />
                      ) : (
                        <span className="text-fg-3">–</span>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </SettingsSection>
  );
}
