-- Café Épico Ops V0.1 hardening
-- Adds a stable PK for scoped employee roles and indexes the high-traffic FK/join paths.

alter table public.employee_roles
  add column if not exists id uuid default gen_random_uuid();

update public.employee_roles set id = gen_random_uuid() where id is null;
alter table public.employee_roles alter column id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.employee_roles'::regclass and contype = 'p'
  ) then
    alter table public.employee_roles add constraint employee_roles_pkey primary key (id);
  end if;
end $$;

alter table public.employee_roles
  drop constraint if exists employee_roles_employee_id_role_id_store_id_key;
drop index if exists public.employee_role_scope_uidx;

create unique index if not exists employee_role_global_uidx
  on public.employee_roles(employee_id, role_id)
  where store_id is null;
create unique index if not exists employee_role_store_uidx
  on public.employee_roles(employee_id, role_id, store_id)
  where store_id is not null;

-- Auth / tenancy lookups
create index if not exists stores_organization_idx on public.stores(organization_id);
create index if not exists inventory_locations_organization_idx on public.inventory_locations(organization_id);
create index if not exists employees_user_idx on public.employees(user_id) where user_id is not null;
create index if not exists employees_home_store_idx on public.employees(home_store_id) where home_store_id is not null;
create index if not exists roles_organization_idx on public.roles(organization_id) where organization_id is not null;
create index if not exists role_permissions_permission_idx on public.role_permissions(permission_id);
create index if not exists employee_roles_role_idx on public.employee_roles(role_id);
create index if not exists employee_roles_store_idx on public.employee_roles(store_id) where store_id is not null;

-- Catalog / recipes / SOPs
create index if not exists item_purchase_units_item_idx on public.item_purchase_units(inventory_item_id);
create index if not exists item_purchase_units_supplier_idx on public.item_purchase_units(supplier_id) where supplier_id is not null;
create index if not exists products_organization_idx on public.products(organization_id);
create index if not exists product_variants_product_idx on public.product_variants(product_id);
create index if not exists product_variants_organization_idx on public.product_variants(organization_id);
create index if not exists recipes_organization_idx on public.recipes(organization_id);
create index if not exists recipes_product_variant_idx on public.recipes(product_variant_id) where product_variant_id is not null;
create index if not exists recipes_current_version_idx on public.recipes(current_version_id) where current_version_id is not null;
create index if not exists recipe_components_version_idx on public.recipe_components(recipe_version_id);
create index if not exists recipe_components_item_idx on public.recipe_components(inventory_item_id);
create index if not exists sops_organization_idx on public.sops(organization_id);
create index if not exists sops_current_version_idx on public.sops(current_version_id) where current_version_id is not null;

-- Checklist / quality
create index if not exists checklist_templates_org_idx on public.checklist_templates(organization_id);
create index if not exists checklist_tasks_template_idx on public.checklist_tasks(checklist_template_id);
create index if not exists checklist_tasks_role_idx on public.checklist_tasks(assigned_role_id) where assigned_role_id is not null;
create index if not exists checklist_tasks_sop_idx on public.checklist_tasks(sop_id) where sop_id is not null;
create index if not exists checklist_schedules_task_idx on public.checklist_task_schedules(checklist_task_id);
create index if not exists checklist_runs_template_idx on public.checklist_runs(checklist_template_id);
create index if not exists checklist_runs_employee_idx on public.checklist_runs(started_by_employee_id) where started_by_employee_id is not null;
create index if not exists checklist_run_tasks_run_idx on public.checklist_run_tasks(checklist_run_id);
create index if not exists checklist_run_tasks_source_idx on public.checklist_run_tasks(source_task_id) where source_task_id is not null;
create index if not exists espresso_quality_store_created_idx on public.espresso_quality_checks(store_id, created_at desc);
create index if not exists espresso_quality_employee_idx on public.espresso_quality_checks(employee_id) where employee_id is not null;

-- Inventory / audit
create index if not exists inventory_balances_org_idx on public.inventory_balances(organization_id);
create index if not exists inventory_counts_store_idx on public.inventory_counts(store_id, started_at desc);
create index if not exists inventory_counts_location_idx on public.inventory_counts(location_id);
create index if not exists inventory_count_lines_item_idx on public.inventory_count_lines(inventory_item_id);
create index if not exists inventory_movements_employee_idx on public.inventory_movements(employee_id) where employee_id is not null;
create index if not exists integration_connections_org_idx on public.integration_connections(organization_id);
create index if not exists sync_runs_connection_idx on public.sync_runs(integration_connection_id, started_at desc);
create index if not exists webhook_events_org_received_idx on public.webhook_events(organization_id, received_at desc) where organization_id is not null;
create index if not exists audit_org_created_idx on public.audit_events(organization_id, created_at desc);
create index if not exists audit_store_created_idx on public.audit_events(store_id, created_at desc) where store_id is not null;
