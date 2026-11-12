-- Workspace settings an owner can now change in Settings > Simulation and Settings > People & roles (customisability audit
-- findings 28, 36, 22/23/33):
--
--   * hours_per_week: the normal working week, above 0 and at most 168 (the rule create_workspace already applies). Set when the
--     workspace is made; until now nothing could change it afterwards.
--   * working_days: working days a week, 1 to 7 (absent or null: 5). A working day of work is hours_per_week / working_days.
--   * hiring_delay_months: months from deciding to hire to the person starting, 0 to 24 (absent or null: 2). The base the
--     market's time-to-hire factor stretches on the Overview, in the Sandbox's advice and for a Sandbox hire.
--
-- Stored values are tidied first, so the checks can be validated (a check left `not valid` would still refuse every later settings
-- write to a workspace holding a bad value): a number written as a string becomes the number; an hours_per_week that still isn't a
-- number from above 0 to 168 becomes 40 (create_workspace's default); a working_days or hiring_delay_months that isn't in range is
-- removed (nothing read either key before, so removing one changes no figure).
--
-- Down:
--   alter table public.workspaces drop constraint if exists workspaces_hours_per_week;
--   alter table public.workspaces drop constraint if exists workspaces_working_days;
--   alter table public.workspaces drop constraint if exists workspaces_hiring_delay_months;
--   delete from public.schema_migrations where version = '20270203004000';
--   (The tidy of stored values is one-way: values it changed or removed stay so.)

-- A number written as a string ("37.5") becomes the number.
do $$
declare
  k text;
begin
  foreach k in array array['hours_per_week', 'working_days', 'hiring_delay_months'] loop
    update public.workspaces
    set settings = jsonb_set(settings, array[k], to_jsonb(trim(settings ->> k)::numeric))
    where jsonb_typeof(settings -> k) = 'string' and trim(settings ->> k) ~ '^[0-9]{1,6}(\.[0-9]{1,6})?$';
  end loop;
end;
$$;

update public.workspaces
set settings = jsonb_set(settings, '{hours_per_week}', '40'::jsonb)
where settings ? 'hours_per_week'
  and not (jsonb_typeof(settings -> 'hours_per_week') = 'number'
    and (settings ->> 'hours_per_week')::numeric > 0 and (settings ->> 'hours_per_week')::numeric <= 168);

update public.workspaces
set settings = settings - 'working_days'
where settings ? 'working_days' and jsonb_typeof(settings -> 'working_days') <> 'null'
  and not (jsonb_typeof(settings -> 'working_days') = 'number' and (settings ->> 'working_days')::numeric between 1 and 7);

update public.workspaces
set settings = settings - 'hiring_delay_months'
where settings ? 'hiring_delay_months' and jsonb_typeof(settings -> 'hiring_delay_months') <> 'null'
  and not (jsonb_typeof(settings -> 'hiring_delay_months') = 'number' and (settings ->> 'hiring_delay_months')::numeric between 0 and 24);

alter table public.workspaces add constraint workspaces_hours_per_week check (
  case
    when not (settings ? 'hours_per_week') then true
    when jsonb_typeof(settings -> 'hours_per_week') <> 'number' then false
    else (settings ->> 'hours_per_week')::numeric > 0 and (settings ->> 'hours_per_week')::numeric <= 168
  end);

alter table public.workspaces add constraint workspaces_working_days check (
  case
    when not (settings ? 'working_days') then true
    when jsonb_typeof(settings -> 'working_days') = 'null' then true
    when jsonb_typeof(settings -> 'working_days') <> 'number' then false
    else (settings ->> 'working_days')::numeric between 1 and 7
  end);

alter table public.workspaces add constraint workspaces_hiring_delay_months check (
  case
    when not (settings ? 'hiring_delay_months') then true
    when jsonb_typeof(settings -> 'hiring_delay_months') = 'null' then true
    when jsonb_typeof(settings -> 'hiring_delay_months') <> 'number' then false
    else (settings ->> 'hiring_delay_months')::numeric between 0 and 24
  end);
