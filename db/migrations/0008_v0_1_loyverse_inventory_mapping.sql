create table if not exists loyverse_inventory_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  location_id uuid not null references inventory_locations(id) on delete restrict,
  inventory_item_id uuid not null references inventory_items(id) on delete cascade,
  loyverse_store_external_id text not null,
  loyverse_variant_external_id text not null,
  source_mode varchar(20) not null default 'UNIT',
  source_unit varchar(20) not null default 'pz',
  factor_to_canonical numeric(18,6) not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loyverse_inventory_mappings_source_mode_chk
    check (source_mode in ('UNIT','FRACTIONAL')),
  constraint loyverse_inventory_mappings_source_unit_chk
    check (source_unit in ('pz','kg','g','L','ml')),
  constraint loyverse_inventory_mappings_factor_chk
    check (factor_to_canonical > 0)
);

create unique index if not exists loyverse_inventory_mapping_variant_uidx
  on loyverse_inventory_mappings(
    organization_id,
    store_id,
    loyverse_store_external_id,
    loyverse_variant_external_id
  );

create unique index if not exists loyverse_inventory_mapping_balance_uidx
  on loyverse_inventory_mappings(store_id, location_id, inventory_item_id);

create index if not exists loyverse_inventory_mapping_item_idx
  on loyverse_inventory_mappings(inventory_item_id);

create index if not exists loyverse_inventory_mapping_location_idx
  on loyverse_inventory_mappings(location_id);

alter table loyverse_inventory_mappings enable row level security;
