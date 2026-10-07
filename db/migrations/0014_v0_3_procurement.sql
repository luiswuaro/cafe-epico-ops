alter table public.suppliers
  add column if not exists city text,
  add column if not exists contact text,
  add column if not exists notes text;

create table if not exists loyverse_item_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  variant_external_id text not null,
  display_unit varchar(20),
  display_factor numeric(18,6) not null default 1,
  unit_cost_override numeric(14,4),
  supplier_id uuid references public.suppliers(id) on delete set null,
  package_name text,
  package_quantity_native numeric(18,3),
  package_price numeric(14,2),
  lead_days integer not null default 0,
  safety_days integer not null default 3,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists loyverse_item_settings_variant_uidx
  on public.loyverse_item_settings(organization_id,variant_external_id);
create index if not exists loyverse_item_settings_supplier_idx
  on public.loyverse_item_settings(supplier_id);

create table if not exists purchase_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.stores(id) on delete set null,
  title text not null,
  destination text,
  planned_for timestamptz,
  status varchar(20) not null default 'DRAFT',
  notes text,
  estimated_budget numeric(14,2),
  actual_spend numeric(14,2),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists purchase_plans_org_status_idx
  on public.purchase_plans(organization_id,status);
create index if not exists purchase_plans_date_idx
  on public.purchase_plans(organization_id,planned_for);

create table if not exists purchase_plan_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purchase_plan_id uuid not null references public.purchase_plans(id) on delete cascade,
  variant_external_id text,
  item_name_snapshot text not null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  requested_native_quantity numeric(18,3),
  package_count numeric(18,3),
  package_name_snapshot text,
  package_quantity_snapshot numeric(18,3),
  unit_cost_snapshot numeric(14,4),
  package_price_snapshot numeric(14,2),
  estimated_total numeric(14,2),
  actual_total numeric(14,2),
  status varchar(20) not null default 'PENDING',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists purchase_plan_lines_plan_idx
  on public.purchase_plan_lines(purchase_plan_id);
create index if not exists purchase_plan_lines_variant_idx
  on public.purchase_plan_lines(organization_id,variant_external_id);

insert into public.permissions(code,description)
values
  ('purchase.read','Consultar requisiciones y listas de compra'),
  ('purchase.manage','Administrar proveedores, costos y planes de compra')
on conflict(code) do nothing;

insert into public.role_permissions(role_id,permission_id)
select r.id,p.id
from public.roles r
join public.permissions p on p.code in ('purchase.read','purchase.manage')
where r.code='OWNER'
on conflict do nothing;

alter table public.loyverse_item_settings enable row level security;
alter table public.purchase_plans enable row level security;
alter table public.purchase_plan_lines enable row level security;

revoke all on table public.loyverse_item_settings from anon,authenticated;
revoke all on table public.purchase_plans from anon,authenticated;
revoke all on table public.purchase_plan_lines from anon,authenticated;
