-- Café Épico Ops V0.1 core schema
-- PostgreSQL / Supabase
create extension if not exists pgcrypto;

create type canonical_unit as enum ('g','ml','pz');
create type version_status as enum ('DRAFT','ACTIVE','ARCHIVED');
create type checklist_input_type as enum ('BOOLEAN','NUMBER','TEXT','SELECT','TEMPERATURE','WEIGHT','TIME');
create type checklist_run_status as enum ('OPEN','COMPLETED','CANCELLED');
create type checklist_task_status as enum ('PENDING','COMPLETED','SKIPPED','FAILED');
create type inventory_movement_type as enum ('PURCHASE','SALE','WASTE','PRODUCTION_CONSUMPTION','PRODUCTION_OUTPUT','TRANSFER_IN','TRANSFER_OUT','COUNT_ADJUSTMENT','MANUAL_ADJUSTMENT','OPENING_BALANCE');
create type sync_status as enum ('IDLE','RUNNING','SUCCESS','FAILED');
create type webhook_status as enum ('RECEIVED','PROCESSING','PROCESSED','FAILED','DUPLICATE');

create table organizations (
 id uuid primary key default gen_random_uuid(), name text not null, slug varchar(80) not null unique,
 currency_code varchar(3) not null default 'MXN', timezone text not null default 'America/Mexico_City',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table stores (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 name text not null, code varchar(40) not null, store_type varchar(40) not null default 'CAFE', timezone text not null default 'America/Mexico_City', is_active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,code)
);
create table inventory_locations (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 store_id uuid not null references stores(id) on delete cascade, name text not null, location_type varchar(40) not null default 'STORAGE', is_active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(store_id,name)
);
create table user_profiles (
 id uuid primary key references auth.users(id) on delete cascade, display_name text not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table employees (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 user_id uuid references user_profiles(id) on delete set null, home_store_id uuid references stores(id) on delete set null,
 name text not null, is_active boolean not null default true, hire_date timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index employees_org_idx on employees(organization_id);
create table roles (
 id uuid primary key default gen_random_uuid(), organization_id uuid references organizations(id) on delete cascade,
 code varchar(60) not null, name text not null, description text, is_system_role boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,code)
);
create table permissions (
 id uuid primary key default gen_random_uuid(), code varchar(100) not null unique, description text not null, created_at timestamptz not null default now()
);
create table role_permissions (
 role_id uuid not null references roles(id) on delete cascade, permission_id uuid not null references permissions(id) on delete cascade, primary key(role_id,permission_id)
);
create table employee_roles (
 employee_id uuid not null references employees(id) on delete cascade, role_id uuid not null references roles(id) on delete cascade,
 store_id uuid references stores(id) on delete cascade, created_at timestamptz not null default now(), unique(employee_id,role_id,store_id)
);

create table inventory_items (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 name text not null, sku varchar(100), category varchar(80) not null, canonical_unit canonical_unit not null,
 tracking_type varchar(40) not null default 'QUANTITY', minimum_stock numeric(18,3), density_g_per_ml numeric(12,6), is_active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,sku)
);
create index inventory_items_org_idx on inventory_items(organization_id);
create table suppliers (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 name text not null, is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table item_purchase_units (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 inventory_item_id uuid not null references inventory_items(id) on delete cascade, supplier_id uuid references suppliers(id) on delete set null,
 name text not null, supplier_sku text, canonical_quantity numeric(18,3) not null check(canonical_quantity > 0), is_default boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table products (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 name text not null, category varchar(80) not null, is_active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table product_variants (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 product_id uuid not null references products(id) on delete cascade, name text not null, size_oz numeric(6,2), temperature varchar(20), selling_price numeric(12,2) not null,
 is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table recipes (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 product_variant_id uuid references product_variants(id) on delete set null, name text not null, current_version_id uuid, is_active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table recipe_versions (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 recipe_id uuid not null references recipes(id) on delete cascade, major_version integer not null, minor_version integer not null,
 status version_status not null default 'DRAFT', yield_quantity numeric(18,3), yield_unit canonical_unit, instructions text not null,
 presentation_spec jsonb not null default '{}'::jsonb, quality_spec jsonb not null default '{}'::jsonb, reference_image_path text,
 effective_from timestamptz, effective_until timestamptz, created_by uuid references user_profiles(id) on delete set null,
 approved_by uuid references user_profiles(id) on delete set null, published_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(recipe_id,major_version,minor_version)
);
alter table recipes add constraint recipes_current_version_fk foreign key(current_version_id) references recipe_versions(id) on delete set null;
create table recipe_components (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 recipe_version_id uuid not null references recipe_versions(id) on delete cascade, inventory_item_id uuid not null references inventory_items(id) on delete restrict,
 quantity numeric(18,3) not null check(quantity >= 0), waste_factor numeric(8,6) not null default 0 check(waste_factor >= 0), sequence integer not null default 0, notes text
);
create table item_cost_history (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 inventory_item_id uuid not null references inventory_items(id) on delete cascade, cost_per_canonical_unit numeric(18,8) not null check(cost_per_canonical_unit >= 0),
 source varchar(60) not null, effective_from timestamptz not null, effective_until timestamptz, created_by uuid references user_profiles(id) on delete set null,
 created_at timestamptz not null default now()
);
create index item_cost_history_lookup_idx on item_cost_history(inventory_item_id,effective_from);

create table sops (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 title text not null, category varchar(80) not null, current_version_id uuid, is_active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table sop_versions (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 sop_id uuid not null references sops(id) on delete cascade, major_version integer not null, minor_version integer not null,
 status version_status not null default 'DRAFT', content text not null, effective_from timestamptz, effective_until timestamptz,
 created_by uuid references user_profiles(id) on delete set null, approved_by uuid references user_profiles(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(sop_id,major_version,minor_version)
);
alter table sops add constraint sops_current_version_fk foreign key(current_version_id) references sop_versions(id) on delete set null;

create table checklist_templates (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 store_id uuid references stores(id) on delete cascade, name text not null, shift_type varchar(40) not null, is_active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table checklist_tasks (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 checklist_template_id uuid not null references checklist_templates(id) on delete cascade, title text not null, description text,
 area varchar(60) not null, priority varchar(40) not null default 'NORMAL', is_required boolean not null default true, sort_order integer not null default 0,
 input_type checklist_input_type not null default 'BOOLEAN', min_value numeric(18,3), max_value numeric(18,3), config jsonb not null default '{}'::jsonb,
 assigned_role_id uuid references roles(id) on delete set null, sop_id uuid references sops(id) on delete set null, is_active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table checklist_task_schedules (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 checklist_task_id uuid not null references checklist_tasks(id) on delete cascade, rrule text not null, start_date timestamptz not null,
 timezone text not null default 'America/Mexico_City', is_active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table checklist_runs (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 store_id uuid not null references stores(id) on delete cascade, checklist_template_id uuid not null references checklist_templates(id) on delete restrict,
 business_date varchar(10) not null, shift_type varchar(40) not null, status checklist_run_status not null default 'OPEN',
 started_by_employee_id uuid references employees(id) on delete set null, started_at timestamptz not null default now(), completed_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index checklist_runs_store_date_idx on checklist_runs(store_id,business_date);
create unique index checklist_runs_daily_uidx on checklist_runs(store_id,checklist_template_id,business_date);
create table checklist_run_tasks (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 checklist_run_id uuid not null references checklist_runs(id) on delete cascade, source_task_id uuid references checklist_tasks(id) on delete set null,
 title_snapshot text not null, description_snapshot text, required_snapshot boolean not null, input_type_snapshot checklist_input_type not null,
 sop_version_id uuid references sop_versions(id) on delete set null, status checklist_task_status not null default 'PENDING',
 completed_by_employee_id uuid references employees(id) on delete set null, completed_at timestamptz,
 numeric_value numeric(18,3), text_value text, boolean_value boolean, comment text, validation_status varchar(40), created_at timestamptz not null default now()
);
create table espresso_quality_checks (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 store_id uuid not null references stores(id) on delete cascade, employee_id uuid references employees(id) on delete set null,
 recipe_version_id uuid references recipe_versions(id) on delete set null, dose_g numeric(8,3) not null, yield_g numeric(8,3) not null,
 brew_time_s numeric(8,2) not null, sensory_rating varchar(40) not null, sensory_notes text, within_time_spec boolean not null,
 within_yield_spec boolean, created_at timestamptz not null default now()
);

create table inventory_movements (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 store_id uuid not null references stores(id) on delete cascade, location_id uuid not null references inventory_locations(id) on delete restrict,
 inventory_item_id uuid not null references inventory_items(id) on delete restrict, movement_type inventory_movement_type not null,
 quantity_delta numeric(18,3) not null, source_type varchar(60) not null, source_id text, occurred_at timestamptz not null,
 employee_id uuid references employees(id) on delete set null, note text, external_provider varchar(40), external_id text, created_at timestamptz not null default now()
);
create index inventory_movements_balance_idx on inventory_movements(store_id,location_id,inventory_item_id,occurred_at);
create unique index inventory_movements_external_uidx on inventory_movements(external_provider,external_id,inventory_item_id,location_id) where external_provider is not null and external_id is not null;
create table inventory_balances (
 organization_id uuid not null references organizations(id) on delete cascade, store_id uuid not null references stores(id) on delete cascade,
 location_id uuid not null references inventory_locations(id) on delete cascade, inventory_item_id uuid not null references inventory_items(id) on delete cascade,
 theoretical_quantity numeric(18,3) not null default 0, updated_at timestamptz not null default now(), primary key(store_id,location_id,inventory_item_id)
);
create table inventory_counts (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 store_id uuid not null references stores(id) on delete cascade, location_id uuid not null references inventory_locations(id) on delete restrict,
 status varchar(30) not null default 'OPEN', started_by uuid references employees(id) on delete set null, started_at timestamptz not null default now(),
 completed_by uuid references employees(id) on delete set null, completed_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table inventory_count_lines (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 inventory_count_id uuid not null references inventory_counts(id) on delete cascade, inventory_item_id uuid not null references inventory_items(id) on delete restrict,
 theoretical_quantity_snapshot numeric(18,3) not null, physical_quantity numeric(18,3) not null, deviation_quantity numeric(18,3) not null,
 deviation_percentage numeric(12,6), adjustment_movement_id uuid references inventory_movements(id) on delete set null,
 counted_by uuid references employees(id) on delete set null, counted_at timestamptz not null default now(), unique(inventory_count_id,inventory_item_id)
);

create table integration_connections (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 provider varchar(40) not null, status varchar(30) not null default 'DISCONNECTED', external_account_id text, config jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,provider)
);
create table sync_states (
 id uuid primary key default gen_random_uuid(), integration_connection_id uuid not null references integration_connections(id) on delete cascade,
 resource varchar(80) not null, cursor text, last_successful_sync_at timestamptz, last_attempt_at timestamptz,
 status sync_status not null default 'IDLE', error_message text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(integration_connection_id,resource)
);
create table sync_runs (
 id uuid primary key default gen_random_uuid(), integration_connection_id uuid not null references integration_connections(id) on delete cascade,
 resource varchar(80) not null, started_at timestamptz not null default now(), completed_at timestamptz, records_read integer not null default 0,
 records_created integer not null default 0, records_updated integer not null default 0, records_failed integer not null default 0,
 status sync_status not null default 'RUNNING', error text
);

create table loyverse_stores (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 external_id text not null, name text not null, payload jsonb not null, external_updated_at timestamptz, synced_at timestamptz not null default now(), unique(organization_id,external_id)
);
create table loyverse_items (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 external_id text not null, item_name text not null, deleted_at timestamptz, payload jsonb not null, external_updated_at timestamptz, synced_at timestamptz not null default now(), unique(organization_id,external_id)
);
create table loyverse_variants (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 external_id text not null, loyverse_item_external_id text, variant_name text, sku text, payload jsonb not null, synced_at timestamptz not null default now(), unique(organization_id,external_id)
);
create table loyverse_inventory_levels (
 organization_id uuid not null references organizations(id) on delete cascade, variant_external_id text not null, store_external_id text not null,
 in_stock numeric(18,3) not null, external_updated_at timestamptz, synced_at timestamptz not null default now(), primary key(organization_id,variant_external_id,store_external_id)
);
create table loyverse_receipts (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade, external_id text not null,
 store_external_id text, receipt_type varchar(40), total_money numeric(14,2), receipt_date timestamptz, external_updated_at timestamptz, payload jsonb not null, synced_at timestamptz not null default now(), unique(organization_id,external_id)
);
create table loyverse_receipt_lines (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 receipt_external_id text not null, line_external_id text, variant_external_id text, quantity numeric(18,3) not null, gross_total_money numeric(14,2), payload jsonb not null
);
create index loyverse_receipt_lines_receipt_idx on loyverse_receipt_lines(organization_id,receipt_external_id);
create table loyverse_customers (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade, external_id text not null, name text,
 payload jsonb not null, external_updated_at timestamptz, synced_at timestamptz not null default now(), unique(organization_id,external_id)
);
create table external_entity_mappings (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 provider varchar(40) not null, entity_type varchar(60) not null, external_id text not null, internal_id uuid not null,
 created_at timestamptz not null default now(), unique(organization_id,provider,entity_type,external_id)
);
create table webhook_events (
 id uuid primary key default gen_random_uuid(), organization_id uuid references organizations(id) on delete cascade,
 provider varchar(40) not null, event_type varchar(100) not null, external_event_key text not null, received_at timestamptz not null default now(),
 payload jsonb not null, payload_hash varchar(64) not null, status webhook_status not null default 'RECEIVED', attempt_count integer not null default 0,
 processed_at timestamptz, last_error text, unique(provider,external_event_key)
);
create table audit_events (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 store_id uuid references stores(id) on delete set null, actor_user_id uuid references user_profiles(id) on delete set null,
 actor_employee_id uuid references employees(id) on delete set null, action varchar(100) not null, entity_type varchar(80) not null, entity_id text not null,
 before_data jsonb, after_data jsonb, request_id text, created_at timestamptz not null default now()
);
create index audit_entity_idx on audit_events(entity_type,entity_id,created_at);

-- Browser access to public tables is closed by default. Server-side database access uses the trusted connection/service role.
do $$ declare r record; begin
  for r in select tablename from pg_tables where schemaname='public' and tablename in (
    'organizations','stores','inventory_locations','user_profiles','employees','roles','permissions','role_permissions','employee_roles',
    'inventory_items','suppliers','item_purchase_units','products','product_variants','recipes','recipe_versions','recipe_components','item_cost_history',
    'sops','sop_versions','checklist_templates','checklist_tasks','checklist_task_schedules','checklist_runs','checklist_run_tasks','espresso_quality_checks',
    'inventory_movements','inventory_balances','inventory_counts','inventory_count_lines','integration_connections','sync_states','sync_runs',
    'loyverse_stores','loyverse_items','loyverse_variants','loyverse_inventory_levels','loyverse_receipts','loyverse_receipt_lines','loyverse_customers',
    'external_entity_mappings','webhook_events','audit_events'
  ) loop execute format('alter table public.%I enable row level security', r.tablename); end loop;
end $$;
