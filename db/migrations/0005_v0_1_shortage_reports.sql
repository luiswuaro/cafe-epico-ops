create table if not exists shortage_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  inventory_item_id uuid references inventory_items(id) on delete set null,
  reported_by uuid references employees(id) on delete set null,
  item_name text not null,
  quantity_needed numeric(18,3),
  unit varchar(20),
  priority varchar(20) not null default 'NORMAL',
  status varchar(20) not null default 'OPEN',
  note text,
  resolved_by uuid references employees(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shortage_reports_quantity_positive check (quantity_needed is null or quantity_needed > 0),
  constraint shortage_reports_status_check check (status in ('OPEN','RESOLVED')),
  constraint shortage_reports_priority_check check (priority in ('NORMAL','URGENT'))
);

create index if not exists shortage_reports_store_status_idx on shortage_reports(store_id,status,created_at);
create index if not exists shortage_reports_org_idx on shortage_reports(organization_id);
create index if not exists shortage_reports_item_idx on shortage_reports(inventory_item_id);
create index if not exists shortage_reports_reported_by_idx on shortage_reports(reported_by);
create index if not exists shortage_reports_resolved_by_idx on shortage_reports(resolved_by);
alter table shortage_reports enable row level security;

insert into permissions(code,description) values
  ('inventory.shortage.report','Reportar faltantes operativos'),
  ('inventory.shortage.resolve','Resolver faltantes operativos')
on conflict(code) do nothing;

insert into role_permissions(role_id,permission_id)
select r.id,p.id
from roles r
join permissions p on p.code in ('inventory.shortage.report','inventory.shortage.resolve')
where r.code='OWNER'
on conflict do nothing;

insert into role_permissions(role_id,permission_id)
select r.id,p.id
from roles r
join permissions p on p.code='inventory.shortage.report'
where r.code='BARISTA'
on conflict do nothing;
