-- Una bebida de cortesía por empleado y día operativo (Tepexi).
-- Registro nominal, independiente de ingresos, puntos y caja.
create table if not exists public.pos_staff_drinks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete restrict,
  beneficiary_employee_id uuid not null references public.employees(id) on delete restrict,
  business_date varchar(10) not null,
  order_id uuid not null references public.pos_orders(id) on delete restrict,
  listed_price numeric(14,2) not null check (listed_price > 0),
  recorded_by_employee_id uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint pos_staff_drinks_day_uidx unique (organization_id, beneficiary_employee_id, business_date),
  constraint pos_staff_drinks_order_uidx unique (order_id)
);
create index if not exists pos_staff_drinks_store_day_idx
  on public.pos_staff_drinks(store_id, business_date);
alter table public.pos_staff_drinks enable row level security;
revoke all on public.pos_staff_drinks from anon, authenticated;
comment on table public.pos_staff_drinks is
  'Cortesías de personal LIVE: una bebida por empleado/día. La cancelación del ticket no libera automáticamente el beneficio; requiere revisión administrativa.';
