-- Churn-driver limits and client health bands as workspace settings (customisability audit, findings 1, 2, 34 and 38).
--
-- Additive for data except one clean-up (step 2). Twelve `workspaces.settings` keys become savable by editors as well as owners, each
-- with its range, through `public.save_health_rules` (until now the four Client health rules only):
--
--   health_healthy_from, health_watch_from, health_at_risk   0 to 100 (health bands; defaults 75, 65, 50)
--   utilisation_threshold                                    0.05 to 1.5 (busy share above which a team is overloaded; 0.85)
--   churn_load_full                                          0.05 to 2 (busy share at which overload is full; 1)
--   churn_response_full_share, churn_rework_full_share       0.01 to 1 (shares that are full pressure; 0.5, 0.25)
--   churn_onboarding_full_multiple                           1.1 to 20 (a first delivery this many times normal is full; 2)
--   churn_early_tenure_months                                0 to 60 (months of early tenure; 26 weeks)
--   churn_away_pressure                                      0 to 5 (what an away account team adds to handoffs; 0.5)
--   churn_results_normal                                     0 to 10 (the results rating that adds nothing; 8)
--   churn_price_months                                       1 to 24 (months a price rise weighs; 13 weeks)
--
-- null (or a missing key) is the engine's default. `utilisation_threshold` was already an allowed settings key (PRD §5, 0.85) that
-- nothing read; it is now the overload driver's line.
--
--   1. `public.save_health_rules(ws, base, changes)`: re-created from 20261209000000_agency_list.sql with a range per key instead of
--      one list of four keys at 0 to 100. Everything else (the editor check, the per-key compare-and-set, the result shape, the
--      errors) is unchanged.
--   2. Two checks on `public.workspaces`: `workspaces_health_bands` and `workspaces_churn_limits`, each key null or a number in its
--      range. Owners writing through `save_fields('workspaces', ...)` and restores get the same ranges. Postgres re-checks a NOT VALID
--      check on every later UPDATE of a row, so a stored out-of-range value (say `utilisation_threshold` 85, typed as a percent, which
--      owners, suggestions and imports could write with no range) would block every later save of that workspace. So first each of
--      these keys holding something other than null or a number in its range is removed (a missing key is the engine's default, which
--      is what those workspaces already ran on: nothing read `utilisation_threshold`, and the other keys are new), then both checks
--      are added and validated. Pre-check: `select id, settings from public.workspaces where not private.settings_in_ranges(settings,
--      array(select jsonb_object_keys(private.settings_rule_ranges())))` lists the rows the clean-up touches.
--
-- ROLLBACK (one transaction):
--   begin;
--   alter table public.workspaces drop constraint if exists workspaces_health_bands;
--   alter table public.workspaces drop constraint if exists workspaces_churn_limits;
--   -- Restore the previous save_health_rules: re-run its `create function` body from 20261209000000_agency_list.sql as
--   -- `create or replace function`.
--   delete from supabase_migrations.schema_migrations where version = '20270203002000';
--   commit;

-- Each savable rule key and its [min, max]: what save_health_rules accepts and the checks below hold.
create or replace function private.settings_rule_ranges() returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{
    "health_initial": [0, 100], "health_recover": [0, 100], "health_late_penalty": [0, 100], "health_missed_penalty": [0, 100],
    "health_healthy_from": [0, 100], "health_watch_from": [0, 100], "health_at_risk": [0, 100],
    "utilisation_threshold": [0.05, 1.5], "churn_load_full": [0.05, 2],
    "churn_response_full_share": [0.01, 1], "churn_rework_full_share": [0.01, 1],
    "churn_onboarding_full_multiple": [1.1, 20], "churn_early_tenure_months": [0, 60],
    "churn_away_pressure": [0, 5], "churn_results_normal": [0, 10], "churn_price_months": [1, 24]
  }'::jsonb
$$;

-- True when each of `keys` that `settings` holds is null or a number in its range (private.settings_rule_ranges). Called by the checks below.
create or replace function private.settings_in_ranges(settings jsonb, keys text[]) returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(
    jsonb_typeof(settings -> k) is null
    or jsonb_typeof(settings -> k) = 'null'
    or (jsonb_typeof(settings -> k) = 'number'
        and (settings ->> k)::numeric between (private.settings_rule_ranges() -> k ->> 0)::numeric and (private.settings_rule_ranges() -> k ->> 1)::numeric)
  ), true)
  from unnest(keys) as k
$$;

create or replace function public.save_health_rules(ws uuid, base jsonb, changes jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ranges constant jsonb := private.settings_rule_ranges();
  k text;
  v jsonb;
  stored jsonb;
  theirs jsonb;
  seen jsonb;
  patch jsonb := '{}';
  conflicts jsonb := '{}';
  result jsonb := '{}';
begin
  if base is null or jsonb_typeof(base) <> 'object' then
    raise exception 'save_health_rules: base must be a json object' using errcode = '22023';
  end if;
  if changes is null or jsonb_typeof(changes) <> 'object' or changes = '{}' then
    raise exception 'save_health_rules: changes must be a non-empty json object' using errcode = '22023';
  end if;

  for k, v in select * from jsonb_each(changes) loop
    if not ranges ? k then
      raise exception 'save_health_rules: % cannot be saved', k using errcode = '42501';
    end if;
    if not base ? k then
      raise exception 'save_health_rules: % has no base value', k using errcode = '22023';
    end if;
    if not (jsonb_typeof(v) = 'null' or (jsonb_typeof(v) = 'number'
        and (v #>> '{}')::numeric between (ranges -> k ->> 0)::numeric and (ranges -> k ->> 1)::numeric)) then
      raise exception 'save_health_rules: % must be null or a number from % to %', k, ranges -> k ->> 0, ranges -> k ->> 1 using errcode = '23514';
    end if;
  end loop;

  -- The same answer save_fields gives under RLS to a caller who can't write.
  if ws is null or not coalesce(public.can_edit_workspace(ws), false) then
    return jsonb_build_object('status', 'not_found');
  end if;

  select w.settings into stored from public.workspaces w where w.id = ws for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  stored := coalesce(stored, '{}');

  for k, v in select * from jsonb_each(changes) loop
    seen := base -> k;
    theirs := coalesce(stored -> k, 'null');
    if theirs is distinct from seen and theirs is distinct from v then
      conflicts := conflicts || jsonb_build_object(k, theirs);
    elsif theirs is distinct from v then
      patch := patch || jsonb_build_object(k, v);
    end if;
  end loop;

  if patch <> '{}' then
    update public.workspaces w set settings = coalesce(w.settings, '{}') || patch where w.id = ws returning w.settings into stored;
  end if;

  for k in select jsonb_object_keys(changes) loop
    result := result || jsonb_build_object(k, coalesce(stored -> k, 'null'));
  end loop;

  return jsonb_build_object(
    'status', case when conflicts <> '{}' then 'conflict' else 'saved' end,
    'row', jsonb_build_object('settings', result),
    'conflicts', conflicts);
end;
$$;

revoke execute on function public.save_health_rules(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_health_rules(uuid, jsonb, jsonb) to authenticated;

select set_config('transpera.actor_kind', 'system', true);

-- Remove each band or limit key whose stored value is out of its range (step 2), so the checks below can be validated.
update public.workspaces w
set settings = w.settings - array(
  select k from unnest(array['health_healthy_from', 'health_watch_from', 'health_at_risk', 'utilisation_threshold', 'churn_load_full',
    'churn_response_full_share', 'churn_rework_full_share', 'churn_onboarding_full_multiple', 'churn_early_tenure_months',
    'churn_away_pressure', 'churn_results_normal', 'churn_price_months']) as k
  where not private.settings_in_ranges(w.settings, array[k]))
where not private.settings_in_ranges(w.settings, array['health_healthy_from', 'health_watch_from', 'health_at_risk', 'utilisation_threshold',
  'churn_load_full', 'churn_response_full_share', 'churn_rework_full_share', 'churn_onboarding_full_multiple', 'churn_early_tenure_months',
  'churn_away_pressure', 'churn_results_normal', 'churn_price_months']);

alter table public.workspaces add constraint workspaces_health_bands check (
  private.settings_in_ranges(settings, array['health_healthy_from', 'health_watch_from', 'health_at_risk'])) not valid;
alter table public.workspaces add constraint workspaces_churn_limits check (
  private.settings_in_ranges(settings, array['utilisation_threshold', 'churn_load_full', 'churn_response_full_share', 'churn_rework_full_share',
    'churn_onboarding_full_multiple', 'churn_early_tenure_months', 'churn_away_pressure', 'churn_results_normal', 'churn_price_months'])) not valid;
alter table public.workspaces validate constraint workspaces_health_bands;
alter table public.workspaces validate constraint workspaces_churn_limits;
