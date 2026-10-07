create table if not exists loyverse_inventory_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  variant_external_id text not null,
  store_external_id text not null,
  in_stock numeric(18,3) not null,
  unit_cost numeric(14,4),
  low_stock numeric(18,3),
  optimal_stock numeric(18,3),
  external_updated_at timestamptz,
  captured_at timestamptz not null default now()
);

create index if not exists loyverse_inventory_snapshots_lookup_idx
  on loyverse_inventory_snapshots(
    organization_id,
    store_external_id,
    variant_external_id,
    captured_at desc
  );

create index if not exists loyverse_inventory_snapshots_captured_idx
  on loyverse_inventory_snapshots(organization_id, captured_at desc);

insert into loyverse_inventory_snapshots(
  organization_id,
  variant_external_id,
  store_external_id,
  in_stock,
  unit_cost,
  low_stock,
  optimal_stock,
  external_updated_at,
  captured_at
)
select
  lil.organization_id,
  lil.variant_external_id,
  lil.store_external_id,
  lil.in_stock,
  nullif(lv.payload->>'cost','')::numeric,
  nullif(store_cfg.value->>'low_stock','')::numeric,
  nullif(store_cfg.value->>'optimal_stock','')::numeric,
  lil.external_updated_at,
  now()
from loyverse_inventory_levels lil
left join loyverse_variants lv
  on lv.organization_id=lil.organization_id
 and lv.external_id=lil.variant_external_id
left join lateral jsonb_array_elements(
  case
    when jsonb_typeof(lv.payload->'stores')='array'
      then lv.payload->'stores'
    else '[]'::jsonb
  end
) store_cfg(value)
  on store_cfg.value->>'store_id'=lil.store_external_id
where not exists (
  select 1
  from loyverse_inventory_snapshots s
  where s.organization_id=lil.organization_id
    and s.variant_external_id=lil.variant_external_id
    and s.store_external_id=lil.store_external_id
);
