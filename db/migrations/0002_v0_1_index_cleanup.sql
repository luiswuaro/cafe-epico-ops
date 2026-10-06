-- Remove duplicate indexes and add any remaining FK indexes.
drop index if exists checklist_task_schedules_task_idx;
drop index if exists inventory_locations_org_idx;
drop index if exists product_variants_org_idx;
drop index if exists products_org_idx;
drop index if exists recipe_components_recipe_version_idx;
drop index if exists recipes_org_idx;
drop index if exists sops_org_idx;
drop index if exists stores_org_idx;

do $$
declare
  r record;
  idx_name text;
  cols text;
begin
  for r in
    select
      c.conrelid::regclass as table_name,
      c.conname,
      c.conkey,
      n.nspname,
      cl.relname
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and not exists (
        select 1
        from pg_index i
        where i.indrelid = c.conrelid
          and i.indisvalid
          and (i.indkey::smallint[])[0:cardinality(c.conkey)-1] = c.conkey
      )
  loop
    select string_agg(quote_ident(a.attname), ', ' order by u.ord)
    into cols
    from unnest(r.conkey) with ordinality u(attnum, ord)
    join pg_attribute a on a.attrelid = r.table_name and a.attnum = u.attnum;

    idx_name := left(r.relname || '_' || regexp_replace(r.conname, '^' || r.relname || '_|_fkey$', '', 'g') || '_idx', 63);
    execute format('create index if not exists %I on %s (%s)', idx_name, r.table_name, cols);
  end loop;
end $$;
