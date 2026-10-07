create table if not exists roast_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  roaster_name text not null default 'Skywalker v1',
  nominal_power_w integer not null default 1000,
  electricity_rate_per_kwh numeric(10,4),
  labor_cost_per_hour numeric(10,2),
  default_store_id uuid references public.stores(id) on delete set null,
  default_location_id uuid references public.inventory_locations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists roast_settings_org_uidx
  on public.roast_settings(organization_id);

create table if not exists roast_coffee_lots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  origin text,
  farm text,
  producer text,
  variety text,
  process text,
  altitude_masl integer,
  target_use varchar(30) not null default 'OMNI',
  green_inventory_item_id uuid references public.inventory_items(id) on delete set null,
  roasted_inventory_item_id uuid references public.inventory_items(id) on delete set null,
  loyverse_roasted_variant_external_id text,
  loyverse_unit_to_g numeric(18,6) not null default 1000,
  green_cost_per_kg numeric(14,2),
  density_g_per_l numeric(10,2),
  moisture_pct numeric(6,3),
  min_rest_days integer not null default 4,
  peak_rest_days integer not null default 10,
  max_rest_days integer not null default 30,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists roast_coffee_lots_org_idx
  on public.roast_coffee_lots(organization_id,is_active);
create index if not exists roast_coffee_lots_loyverse_idx
  on public.roast_coffee_lots(organization_id,loyverse_roasted_variant_external_id);

create table if not exists roast_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  coffee_lot_id uuid references public.roast_coffee_lots(id) on delete cascade,
  name text not null,
  roaster_name text not null default 'Skywalker v1',
  target_use varchar(30) not null default 'OMNI',
  batch_size_g numeric(10,2),
  charge_temp_c numeric(7,2),
  target_yellowing_s integer,
  target_first_crack_s integer,
  target_drop_s integer,
  target_first_crack_temp_c numeric(7,2),
  target_drop_temp_c numeric(7,2),
  target_dtr_pct numeric(6,2),
  dtr_tolerance_pct numeric(6,2) not null default 2,
  target_weight_loss_pct numeric(6,2),
  weight_loss_tolerance_pct numeric(6,2) not null default 2,
  time_tolerance_s integer not null default 20,
  power_plan jsonb not null default '[]'::jsonb,
  fan_plan jsonb not null default '[]'::jsonb,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists roast_profiles_lot_idx
  on public.roast_profiles(coffee_lot_id,is_active);

create table if not exists roast_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  coffee_lot_id uuid not null references public.roast_coffee_lots(id) on delete restrict,
  profile_id uuid references public.roast_profiles(id) on delete set null,
  batch_code varchar(80) not null,
  roaster_name text not null default 'Skywalker v1',
  roasted_at timestamptz not null,
  operator_employee_id uuid references public.employees(id) on delete set null,
  green_weight_g numeric(10,2) not null,
  roasted_weight_g numeric(10,2) not null,
  weight_loss_pct numeric(7,3) not null,
  charge_temp_c numeric(7,2),
  turning_point_time_s integer,
  turning_point_temp_c numeric(7,2),
  yellowing_time_s integer,
  yellowing_temp_c numeric(7,2),
  first_crack_time_s integer,
  first_crack_temp_c numeric(7,2),
  drop_time_s integer,
  drop_temp_c numeric(7,2),
  development_time_s integer,
  dtr_pct numeric(7,3),
  curve_data jsonb not null default '[]'::jsonb,
  status varchar(30) not null default 'ROASTED',
  inventory_posted boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists roast_batches_code_uidx
  on public.roast_batches(organization_id,batch_code);
create index if not exists roast_batches_lot_date_idx
  on public.roast_batches(coffee_lot_id,roasted_at);
create index if not exists roast_batches_profile_idx
  on public.roast_batches(profile_id,roasted_at);

create table if not exists roast_sensory_evaluations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  roast_batch_id uuid not null references public.roast_batches(id) on delete cascade,
  evaluator_employee_id uuid references public.employees(id) on delete set null,
  evaluated_at timestamptz not null default now(),
  brew_method varchar(40) not null default 'CUPPING',
  aroma numeric(4,1),
  acidity numeric(4,1),
  sweetness numeric(4,1),
  body numeric(4,1),
  bitterness numeric(4,1),
  aftertaste numeric(4,1),
  balance numeric(4,1),
  overall_score numeric(5,2),
  descriptors text,
  defects text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists roast_sensory_batch_idx
  on public.roast_sensory_evaluations(roast_batch_id,evaluated_at);

create table if not exists roast_bar_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  roast_batch_id uuid not null references public.roast_batches(id) on delete cascade,
  bar_role varchar(30) not null default 'ESPRESSO',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  is_active boolean not null default true,
  assigned_by_employee_id uuid references public.employees(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists roast_bar_assignments_store_idx
  on public.roast_bar_assignments(store_id,bar_role,is_active);
create index if not exists roast_bar_assignments_batch_idx
  on public.roast_bar_assignments(roast_batch_id,is_active);

alter table public.espresso_quality_checks
  add column if not exists roast_batch_id uuid references public.roast_batches(id) on delete set null;

create index if not exists espresso_quality_checks_roast_batch_idx
  on public.espresso_quality_checks(roast_batch_id,created_at);

insert into public.permissions(code,description)
values
  ('roast.read','Consultar producción, perfiles y calidad de tueste'),
  ('roast.manage','Administrar lotes, perfiles, batches y asignaciones de tueste')
on conflict(code) do nothing;

insert into public.role_permissions(role_id,permission_id)
select r.id,p.id
from public.roles r
join public.permissions p on p.code in ('roast.read','roast.manage')
where r.code='OWNER'
on conflict do nothing;

alter table public.roast_settings enable row level security;
alter table public.roast_coffee_lots enable row level security;
alter table public.roast_profiles enable row level security;
alter table public.roast_batches enable row level security;
alter table public.roast_sensory_evaluations enable row level security;
alter table public.roast_bar_assignments enable row level security;

revoke all on table public.roast_settings from anon,authenticated;
revoke all on table public.roast_coffee_lots from anon,authenticated;
revoke all on table public.roast_profiles from anon,authenticated;
revoke all on table public.roast_batches from anon,authenticated;
revoke all on table public.roast_sensory_evaluations from anon,authenticated;
revoke all on table public.roast_bar_assignments from anon,authenticated;
