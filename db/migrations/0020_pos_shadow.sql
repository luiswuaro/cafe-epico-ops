-- POS v0.1 shadow mode: registra ventas espejo sin afectar inventario.

insert into public.permissions(code, description) values
  ('pos.sell','Registrar ventas en el POS'),
  ('pos.mirror.read','Comparar ventas espejo contra Loyverse')
on conflict(code) do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.code in ('OWNER','BARISTA')
  and p.code in ('pos.sell','pos.mirror.read')
on conflict do nothing;

create table if not exists public.pos_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete restrict,
  client_order_id text not null,
  folio varchar(50) not null,
  mode varchar(20) not null default 'SHADOW',
  status varchar(20) not null default 'PAID',
  service_mode varchar(20) not null,
  table_label text,
  employee_id uuid references public.employees(id) on delete set null,
  business_date varchar(10) not null,
  subtotal numeric(14,2) not null,
  total numeric(14,2) not null,
  note text,
  inventory_effect_applied boolean not null default false,
  matched_external_receipt_id text,
  matched_at timestamptz,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists pos_orders_client_uidx
  on public.pos_orders(organization_id, client_order_id);
create unique index if not exists pos_orders_folio_uidx
  on public.pos_orders(store_id, folio);
create index if not exists pos_orders_store_paid_idx
  on public.pos_orders(store_id, paid_at desc);
create index if not exists pos_orders_employee_idx
  on public.pos_orders(employee_id, paid_at desc);

create table if not exists public.pos_order_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.pos_orders(id) on delete cascade,
  catalog_external_id text not null,
  variant_external_id text,
  name_snapshot text not null,
  category_snapshot varchar(40) not null,
  unit_price numeric(14,2) not null,
  quantity numeric(12,3) not null,
  line_total numeric(14,2) not null,
  expected_consumption jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists pos_order_lines_order_idx
  on public.pos_order_lines(order_id);
create index if not exists pos_order_lines_catalog_idx
  on public.pos_order_lines(organization_id, catalog_external_id);

create table if not exists public.pos_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.pos_orders(id) on delete cascade,
  method varchar(30) not null,
  amount numeric(14,2) not null,
  reference text,
  created_at timestamptz not null default now()
);

create index if not exists pos_payments_order_idx
  on public.pos_payments(order_id);

alter table public.pos_orders enable row level security;
alter table public.pos_order_lines enable row level security;
alter table public.pos_payments enable row level security;

revoke all on table public.pos_orders from anon, authenticated;
revoke all on table public.pos_order_lines from anon, authenticated;
revoke all on table public.pos_payments from anon, authenticated;
