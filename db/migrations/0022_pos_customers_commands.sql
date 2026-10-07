-- POS v0.1.2: clientes, puntos 5% y comandas abiertas.

create table if not exists pos_customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_external_id text,
  name text not null,
  phone text,
  email text,
  points_balance numeric(14,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists pos_customers_source_uidx
  on public.pos_customers(organization_id, source_external_id);
create index if not exists pos_customers_org_name_idx
  on public.pos_customers(organization_id, name);

insert into public.pos_customers(
  organization_id,
  source_external_id,
  name,
  phone,
  email,
  points_balance
)
select
  organization_id,
  external_id,
  coalesce(nullif(trim(name), ''), 'Cliente sin nombre'),
  nullif(payload->>'phone_number', ''),
  nullif(payload->>'email', ''),
  coalesce(nullif(payload->>'total_points','')::numeric, 0)
from public.loyverse_customers
where coalesce(payload->>'deleted_at','') = ''
on conflict (organization_id, source_external_id)
do update set
  name = excluded.name,
  phone = excluded.phone,
  email = excluded.email,
  points_balance = excluded.points_balance,
  updated_at = now();

alter table public.pos_orders
  add column if not exists customer_id uuid
    references public.pos_customers(id) on delete set null,
  add column if not exists loyalty_points_preview numeric(14,2) not null default 0,
  add column if not exists loyalty_effect_applied boolean not null default false;

alter table public.pos_orders
  alter column paid_at drop not null;

create table if not exists pos_loyalty_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.pos_customers(id) on delete cascade,
  order_id uuid references public.pos_orders(id) on delete set null,
  entry_type varchar(30) not null,
  points numeric(14,2) not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists pos_loyalty_customer_idx
  on public.pos_loyalty_entries(customer_id, created_at desc);
create index if not exists pos_loyalty_order_idx
  on public.pos_loyalty_entries(order_id);

insert into public.pos_loyalty_entries(
  organization_id,
  customer_id,
  entry_type,
  points,
  note
)
select
  c.organization_id,
  c.id,
  'MIGRATION',
  c.points_balance,
  'Saldo inicial migrado desde Loyverse'
from public.pos_customers c
where c.source_external_id is not null
  and c.points_balance <> 0
  and not exists (
    select 1
    from public.pos_loyalty_entries e
    where e.customer_id = c.id
      and e.entry_type = 'MIGRATION'
  );

alter table public.pos_customers enable row level security;
alter table public.pos_loyalty_entries enable row level security;

revoke all on table public.pos_customers from anon, authenticated;
revoke all on table public.pos_loyalty_entries from anon, authenticated;
