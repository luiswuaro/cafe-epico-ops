-- POS v0.1.3: caja de efectivo y cuentas divididas.

insert into public.permissions(code, description) values
  ('pos.cash.manage','Abrir, operar y cerrar la caja de efectivo')
on conflict(code) do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.code in ('OWNER','BARISTA')
  and p.code = 'pos.cash.manage'
on conflict do nothing;

create table if not exists pos_order_splits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.pos_orders(id) on delete cascade,
  label text not null,
  status varchar(20) not null default 'OPEN',
  total numeric(14,2) not null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists pos_order_splits_label_uidx
  on public.pos_order_splits(order_id, label);
create index if not exists pos_order_splits_order_idx
  on public.pos_order_splits(order_id, status);

create table if not exists pos_order_split_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  split_id uuid not null references public.pos_order_splits(id) on delete cascade,
  order_line_id uuid not null references public.pos_order_lines(id) on delete cascade,
  quantity numeric(12,3) not null,
  line_total numeric(14,2) not null,
  created_at timestamptz not null default now()
);

create unique index if not exists pos_order_split_lines_uidx
  on public.pos_order_split_lines(split_id, order_line_id);
create index if not exists pos_order_split_lines_order_line_idx
  on public.pos_order_split_lines(order_line_id);

alter table public.pos_payments
  add column if not exists split_id uuid
    references public.pos_order_splits(id) on delete set null;

create unique index if not exists pos_payments_split_uidx
  on public.pos_payments(split_id)
  where split_id is not null;

create table if not exists pos_cash_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete restrict,
  status varchar(20) not null default 'OPEN',
  opening_cash numeric(14,2) not null,
  opened_by_employee_id uuid references public.employees(id) on delete set null,
  opened_at timestamptz not null default now(),
  counted_cash numeric(14,2),
  expected_cash_snapshot numeric(14,2),
  difference numeric(14,2),
  closed_by_employee_id uuid references public.employees(id) on delete set null,
  closed_at timestamptz,
  closing_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists pos_cash_sessions_one_open_uidx
  on public.pos_cash_sessions(store_id)
  where status = 'OPEN';
create index if not exists pos_cash_sessions_store_status_idx
  on public.pos_cash_sessions(store_id, status, opened_at desc);

create table if not exists pos_cash_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete restrict,
  session_id uuid not null references public.pos_cash_sessions(id) on delete restrict,
  order_id uuid references public.pos_orders(id) on delete set null,
  split_id uuid references public.pos_order_splits(id) on delete set null,
  employee_id uuid references public.employees(id) on delete set null,
  movement_type varchar(30) not null,
  amount numeric(14,2) not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists pos_cash_movements_session_idx
  on public.pos_cash_movements(session_id, created_at desc);
create index if not exists pos_cash_movements_order_idx
  on public.pos_cash_movements(order_id);
create unique index if not exists pos_cash_movements_sale_order_uidx
  on public.pos_cash_movements(order_id)
  where movement_type = 'SALE' and split_id is null;
create unique index if not exists pos_cash_movements_sale_split_uidx
  on public.pos_cash_movements(split_id)
  where movement_type = 'SALE' and split_id is not null;

alter table public.pos_order_splits enable row level security;
alter table public.pos_order_split_lines enable row level security;
alter table public.pos_cash_sessions enable row level security;
alter table public.pos_cash_movements enable row level security;

revoke all on table public.pos_order_splits from anon, authenticated;
revoke all on table public.pos_order_split_lines from anon, authenticated;
revoke all on table public.pos_cash_sessions from anon, authenticated;
revoke all on table public.pos_cash_movements from anon, authenticated;
