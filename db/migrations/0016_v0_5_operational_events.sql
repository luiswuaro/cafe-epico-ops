create table if not exists operational_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  store_id uuid references stores(id) on delete set null,
  employee_id uuid references employees(id) on delete set null,
  event_type varchar(30) not null,
  severity varchar(20) not null default 'NORMAL',
  variant_external_id text,
  item_name_snapshot text,
  quantity numeric(18,3),
  unit_label varchar(30),
  note text,
  occurred_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_employee_id uuid references employees(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists operational_events_org_date_idx
  on operational_events(organization_id, occurred_at);

create index if not exists operational_events_store_open_idx
  on operational_events(store_id, resolved_at, occurred_at);

create index if not exists operational_events_variant_idx
  on operational_events(organization_id, variant_external_id, occurred_at);
