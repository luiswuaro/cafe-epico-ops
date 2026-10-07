alter table public.roast_coffee_lots
  add column if not exists hibean_bean_cloud_id text,
  add column if not exists hibean_bean_name text,
  add column if not exists hibean_green_inventory_g numeric(14,2),
  add column if not exists hibean_inventory_reported_g numeric(14,2),
  add column if not exists hibean_inventory_confirmed_at timestamptz,
  add column if not exists hibean_inventory_confirmed_by_employee_id uuid references public.employees(id) on delete set null,
  add column if not exists hibean_inventory_source_roast_id text;

create unique index if not exists roast_coffee_lots_hibean_bean_uidx
  on public.roast_coffee_lots(organization_id,hibean_bean_cloud_id)
  where hibean_bean_cloud_id is not null;

alter table public.roast_batches
  add column if not exists source_provider varchar(30),
  add column if not exists source_external_id text,
  add column if not exists source_file_name text,
  add column if not exists source_metadata jsonb;

create unique index if not exists roast_batches_source_uidx
  on public.roast_batches(organization_id,source_provider,source_external_id)
  where source_provider is not null and source_external_id is not null;

create table if not exists public.roast_green_inventory_confirmations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  coffee_lot_id uuid not null references public.roast_coffee_lots(id) on delete cascade,
  provider varchar(30) not null default 'HIBEAN',
  external_bean_id text,
  external_roast_id text,
  reported_quantity_g numeric(14,2),
  confirmed_quantity_g numeric(14,2) not null,
  corrected boolean not null default false,
  source_file_name text,
  confirmed_by_employee_id uuid references public.employees(id) on delete set null,
  confirmed_at timestamptz not null default now(),
  note text
);

create index if not exists roast_green_inventory_confirmations_lot_idx
  on public.roast_green_inventory_confirmations(coffee_lot_id,confirmed_at desc);

create index if not exists roast_green_inventory_confirmations_external_idx
  on public.roast_green_inventory_confirmations(
    organization_id,provider,external_bean_id,confirmed_at desc
  );

create table if not exists public.roast_import_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by_employee_id uuid references public.employees(id) on delete set null,
  source_provider varchar(30) not null,
  source_format varchar(40) not null,
  source_file_name text not null,
  source_sha256 varchar(64) not null,
  source_external_roast_id text,
  source_external_bean_id text,
  raw_payload jsonb not null,
  parsed_payload jsonb not null,
  matched_coffee_lot_id uuid references public.roast_coffee_lots(id) on delete set null,
  status varchar(20) not null default 'DRAFT',
  confirmed_batch_id uuid references public.roast_batches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists roast_import_drafts_hash_uidx
  on public.roast_import_drafts(organization_id,source_sha256);

create index if not exists roast_import_drafts_status_idx
  on public.roast_import_drafts(organization_id,status,created_at desc);

alter table public.roast_green_inventory_confirmations enable row level security;
alter table public.roast_import_drafts enable row level security;

revoke all on table public.roast_green_inventory_confirmations from anon,authenticated;
revoke all on table public.roast_import_drafts from anon,authenticated;
