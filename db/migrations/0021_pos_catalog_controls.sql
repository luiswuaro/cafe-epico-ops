-- POS v0.1.1: catálogo administrable, recetas override, impresión y cancelación admin.

insert into public.permissions(code, description) values
  ('pos.cancel','Cancelar cuentas y tickets del POS'),
  ('pos.catalog.manage','Administrar productos y recetas del POS')
on conflict(code) do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.code = 'OWNER'
  and p.code in ('pos.cancel','pos.catalog.manage')
on conflict do nothing;

create table if not exists pos_catalog_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_external_id text not null,
  is_enabled boolean not null default true,
  display_name text,
  display_price numeric(14,2),
  recipe_dine_in jsonb,
  recipe_takeaway jsonb,
  updated_by_employee_id uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists pos_catalog_overrides_source_uidx
  on public.pos_catalog_overrides(organization_id, source_external_id);

create table if not exists pos_manual_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  category varchar(40) not null,
  price numeric(14,2) not null,
  is_active boolean not null default true,
  recipe_dine_in jsonb not null default '{}'::jsonb,
  recipe_takeaway jsonb not null default '{}'::jsonb,
  created_by_employee_id uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pos_manual_products_org_active_idx
  on public.pos_manual_products(organization_id, is_active);

alter table public.pos_orders
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by_employee_id uuid
    references public.employees(id) on delete set null,
  add column if not exists cancel_reason text;

alter table public.pos_catalog_overrides enable row level security;
alter table public.pos_manual_products enable row level security;

revoke all on table public.pos_catalog_overrides from anon, authenticated;
revoke all on table public.pos_manual_products from anon, authenticated;
