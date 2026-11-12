-- A service's expected tenure is optional: blank means "worked out from churn" (1 / base churn a month), so lowering churn lengthens
-- the stay that values a won deal and a lost client, as it lengthens the stay in the simulation (customisability audit, finding 30).
--
-- What it does:
--   * `services.tenure_months` loses its not-null constraint and its default of 12. Existing rows keep their stored value, so every
--     workspace simulates as before until someone clears the field; a new service starts blank (from churn).
--   * `public.add_tier` copies the last tier's tenure as it is, blank included (it wrote 12 for a blank before). The rest of its body
--     is unchanged from 20270119000000_capacity_setup.sql.
-- No data changes.
--
-- Preflight: `select count(*) from public.schema_migrations where version >= '20270203001000';` expect 0.
-- Post-apply check: select is_nullable, column_default from information_schema.columns
--   where table_schema = 'public' and table_name = 'services' and column_name = 'tenure_months';  expect YES and null.
--
-- ROLLBACK (run as one transaction; fails if a service has a blank tenure, so fill those first, e.g. with round(1 / churn)):
--
--   begin;
--   update public.services set tenure_months = case when churn_monthly_base > 0 then least(1200, round(1 / churn_monthly_base)) else 12 end
--     where tenure_months is null;
--   alter table public.services alter column tenure_months set default 12, alter column tenure_months set not null;
--   -- Re-run the `create function public.add_tier ...` block from 20270119000000_capacity_setup.sql as `create or replace`.
--   delete from public.schema_migrations where version = '20270203001000';
--   commit;

alter table public.services alter column tenure_months drop default, alter column tenure_months drop not null;

comment on column public.services.tenure_months is
  'How many months a client typically stays. Null: worked out from churn (1 / churn_monthly_base; 0 when churn is 0).';

create or replace function public.add_tier(p_workspace uuid) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  last_tier public.tiers;
  new_id uuid;
  n integer;
begin
  if p_workspace is null or not coalesce(public.can_edit_workspace(p_workspace), false) then
    raise exception 'Only Agency admins and the Owner can change tiers.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tiers:' || p_workspace::text, 0));
  select * into last_tier from public.tiers where workspace_id = p_workspace order by sort desc, created_at desc limit 1;
  select coalesce(max((regexp_match(key, '^T([0-9]{1,6})$'))[1]::integer), 0) + 1 into n from public.tiers where workspace_id = p_workspace;
  insert into public.tiers (workspace_id, key, name, sort) values (p_workspace, 'T' || n, 'Tier ' || n, coalesce(last_tier.sort, 0) + 1) returning id into new_id;
  insert into public.services (workspace_id, name, pricing_model, price, margin, tenure_months, churn_monthly_base, churn_health_sensitivity, mix_share,
    price_low, price_high, department_id, tier_id, words, links, tech_hours, meetings, builds, creative_sets, channels, adhoc_chance, adhoc_requests,
    price_rise_churn, provenance)
  select p_workspace, regexp_replace(d.name, '\s*\(.*\)\s*$', '') || ' Tier ' || n,
    coalesce(s.pricing_model, 'retainer'), coalesce(s.price, 0), coalesce(s.margin, 0), s.tenure_months, coalesce(s.churn_monthly_base, 0),
    coalesce(s.churn_health_sensitivity, 3), coalesce(s.mix_share, 1), s.price_low, s.price_high, d.id, new_id,
    s.words, s.links, s.tech_hours, s.meetings, s.builds, s.creative_sets, s.channels, s.adhoc_chance, s.adhoc_requests,
    coalesce(s.price_rise_churn, 0.5), coalesce(s.provenance, '{}')
  from public.departments d
  left join public.services s on s.department_id = d.id and s.tier_id = last_tier.id and s.active
  where d.workspace_id = p_workspace
  order by d.sort, d.name;
  return new_id;
end;
$$;
