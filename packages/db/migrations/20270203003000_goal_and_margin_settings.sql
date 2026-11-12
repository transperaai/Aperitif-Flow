-- Two workspace settings an owner sets in Settings (docs/customisability-audit.md findings 3, 12 and 48):
--
--   settings.dler_goal        The DLER the agency aims for (fees a month ÷ salaries a month), e.g. 3 for 3:1. The Overview, Capacity
--                             and the Sandbox judge every DLER against it. Absent or null: 4.5, the goal every workspace used before.
--   settings.at_risk_margin   How close under their own utilisation threshold someone may be before they count as at risk ("near"),
--                             as a share: 0.1 is 10 points. Capacity, the Overview's Busiest people and the People page read it.
--                             Absent or null: 0.1, as before.
--
-- Nothing stored changes: both keys are new, so every workspace keeps its numbers until someone sets them. Only the shape checks are
-- added, beside workspaces_overhead_monthly; no workspace holds either key yet, so they are validated at once.
--
-- Preflight: select count(*) from public.workspaces where settings ? 'dler_goal' or settings ? 'at_risk_margin'; expect 0.
-- Post-apply checks: \d public.workspaces lists workspaces_dler_goal and workspaces_at_risk_margin.
-- Rollback:
--   alter table public.workspaces drop constraint workspaces_dler_goal, drop constraint workspaces_at_risk_margin;
--   update public.workspaces set settings = settings - 'dler_goal' - 'at_risk_margin';
--   delete from public.schema_migrations where version = '20270203003000';

alter table public.workspaces add constraint workspaces_dler_goal check (
  case
    when not (settings ? 'dler_goal') then true
    when jsonb_typeof(settings -> 'dler_goal') = 'null' then true
    when jsonb_typeof(settings -> 'dler_goal') = 'number' then (settings ->> 'dler_goal')::numeric > 0 and (settings ->> 'dler_goal')::numeric <= 50
    else false
  end) not valid;
alter table public.workspaces validate constraint workspaces_dler_goal;

alter table public.workspaces add constraint workspaces_at_risk_margin check (
  case
    when not (settings ? 'at_risk_margin') then true
    when jsonb_typeof(settings -> 'at_risk_margin') = 'null' then true
    when jsonb_typeof(settings -> 'at_risk_margin') = 'number' then (settings ->> 'at_risk_margin')::numeric between 0 and 0.5
    else false
  end) not valid;
alter table public.workspaces validate constraint workspaces_at_risk_margin;
