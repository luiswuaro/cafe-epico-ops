-- POS v0.3.1: ajustes del saldo operativo por conteo, merma y reabasto.

create or replace function public.post_operational_inventory_delta(
  p_organization_id uuid,
  p_store_id uuid,
  p_variant_external_id text,
  p_employee_id uuid,
  p_movement_type varchar,
  p_quantity_delta numeric,
  p_source_type varchar,
  p_source_id text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_external_id text;
  v_source record;
  v_movement_id uuid;
  v_quantity numeric;
begin
  if p_quantity_delta = 0 then
    return jsonb_build_object('applied', false, 'reason', 'ZERO_DELTA');
  end if;

  select b.loyverse_store_external_id
    into v_store_external_id
  from public.operational_inventory_balances b
  where b.organization_id = p_organization_id
    and b.store_id = p_store_id
    and b.variant_external_id = p_variant_external_id
  limit 1;

  if v_store_external_id is null then
    select case when count(*) = 1 then min(external_id) else null end
      into v_store_external_id
    from public.loyverse_stores
    where organization_id = p_organization_id;
  end if;

  if v_store_external_id is null then
    raise exception 'No hay una sucursal Loyverse unívoca';
  end if;

  select lil.in_stock, lil.synced_at, li.item_name
    into v_source
  from public.loyverse_inventory_levels lil
  join public.loyverse_variants lv
    on lv.organization_id = lil.organization_id
   and lv.external_id = lil.variant_external_id
  join public.loyverse_items li
    on li.organization_id = lil.organization_id
   and li.external_id = lv.loyverse_item_external_id
  where lil.organization_id = p_organization_id
    and lil.store_external_id = v_store_external_id
    and lil.variant_external_id = p_variant_external_id
    and coalesce((li.payload->>'track_stock')::boolean,false) = true
  limit 1;

  if not found then
    raise exception 'El insumo no tiene stock rastreable en Loyverse';
  end if;

  insert into public.operational_inventory_balances(
    organization_id,
    store_id,
    loyverse_store_external_id,
    variant_external_id,
    item_name_snapshot,
    quantity_native,
    source_quantity_native,
    source_synced_at,
    initialized_at,
    updated_at
  )
  values(
    p_organization_id,
    p_store_id,
    v_store_external_id,
    p_variant_external_id,
    v_source.item_name,
    v_source.in_stock,
    v_source.in_stock,
    v_source.synced_at,
    now(),
    now()
  )
  on conflict(store_id, variant_external_id) do nothing;

  v_movement_id := null;

  insert into public.operational_inventory_movements(
    organization_id,
    store_id,
    variant_external_id,
    item_name_snapshot,
    movement_type,
    quantity_delta_native,
    source_type,
    source_id,
    employee_id,
    occurred_at,
    note
  )
  values(
    p_organization_id,
    p_store_id,
    p_variant_external_id,
    v_source.item_name,
    p_movement_type,
    p_quantity_delta,
    p_source_type,
    p_source_id,
    p_employee_id,
    now(),
    p_note
  )
  on conflict do nothing
  returning id into v_movement_id;

  if v_movement_id is null then
    select quantity_native into v_quantity
    from public.operational_inventory_balances
    where store_id = p_store_id
      and variant_external_id = p_variant_external_id;

    return jsonb_build_object(
      'applied', false,
      'reason', 'DUPLICATE',
      'quantity_native', v_quantity
    );
  end if;

  update public.operational_inventory_balances
  set
    quantity_native = quantity_native + p_quantity_delta,
    updated_at = now()
  where store_id = p_store_id
    and variant_external_id = p_variant_external_id
  returning quantity_native into v_quantity;

  return jsonb_build_object(
    'applied', true,
    'movement_id', v_movement_id,
    'quantity_native', v_quantity
  );
end;
$$;

create or replace function public.set_operational_inventory_count(
  p_organization_id uuid,
  p_store_id uuid,
  p_variant_external_id text,
  p_employee_id uuid,
  p_target_quantity numeric,
  p_source_id text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_external_id text;
  v_source record;
  v_before numeric;
  v_delta numeric;
  v_movement_id uuid;
begin
  if p_target_quantity < 0 then
    raise exception 'El conteo físico no puede ser negativo';
  end if;

  select b.loyverse_store_external_id
    into v_store_external_id
  from public.operational_inventory_balances b
  where b.organization_id = p_organization_id
    and b.store_id = p_store_id
    and b.variant_external_id = p_variant_external_id
  limit 1;

  if v_store_external_id is null then
    select case when count(*) = 1 then min(external_id) else null end
      into v_store_external_id
    from public.loyverse_stores
    where organization_id = p_organization_id;
  end if;

  if v_store_external_id is null then
    raise exception 'No hay una sucursal Loyverse unívoca';
  end if;

  select lil.in_stock, lil.synced_at, li.item_name
    into v_source
  from public.loyverse_inventory_levels lil
  join public.loyverse_variants lv
    on lv.organization_id = lil.organization_id
   and lv.external_id = lil.variant_external_id
  join public.loyverse_items li
    on li.organization_id = lil.organization_id
   and li.external_id = lv.loyverse_item_external_id
  where lil.organization_id = p_organization_id
    and lil.store_external_id = v_store_external_id
    and lil.variant_external_id = p_variant_external_id
    and coalesce((li.payload->>'track_stock')::boolean,false) = true
  limit 1;

  if not found then
    raise exception 'El insumo no tiene stock rastreable en Loyverse';
  end if;

  insert into public.operational_inventory_balances(
    organization_id,
    store_id,
    loyverse_store_external_id,
    variant_external_id,
    item_name_snapshot,
    quantity_native,
    source_quantity_native,
    source_synced_at,
    initialized_at,
    updated_at
  )
  values(
    p_organization_id,
    p_store_id,
    v_store_external_id,
    p_variant_external_id,
    v_source.item_name,
    v_source.in_stock,
    v_source.in_stock,
    v_source.synced_at,
    now(),
    now()
  )
  on conflict(store_id, variant_external_id) do nothing;

  select quantity_native
    into v_before
  from public.operational_inventory_balances
  where store_id = p_store_id
    and variant_external_id = p_variant_external_id
  for update;

  v_delta := p_target_quantity - v_before;

  if abs(v_delta) < 0.0000005 then
    return jsonb_build_object(
      'applied', false,
      'reason', 'NO_CHANGE',
      'before_native', v_before,
      'after_native', p_target_quantity,
      'delta_native', 0
    );
  end if;

  v_movement_id := null;

  insert into public.operational_inventory_movements(
    organization_id,
    store_id,
    variant_external_id,
    item_name_snapshot,
    movement_type,
    quantity_delta_native,
    source_type,
    source_id,
    employee_id,
    occurred_at,
    note
  )
  values(
    p_organization_id,
    p_store_id,
    p_variant_external_id,
    v_source.item_name,
    'COUNT_ADJUSTMENT',
    v_delta,
    'PHYSICAL_COUNT',
    p_source_id,
    p_employee_id,
    now(),
    p_note
  )
  on conflict do nothing
  returning id into v_movement_id;

  if v_movement_id is null then
    return jsonb_build_object(
      'applied', false,
      'reason', 'DUPLICATE',
      'before_native', v_before
    );
  end if;

  update public.operational_inventory_balances
  set quantity_native = p_target_quantity, updated_at = now()
  where store_id = p_store_id
    and variant_external_id = p_variant_external_id;

  return jsonb_build_object(
    'applied', true,
    'movement_id', v_movement_id,
    'before_native', v_before,
    'after_native', p_target_quantity,
    'delta_native', v_delta
  );
end;
$$;

revoke all on function public.post_operational_inventory_delta(
  uuid, uuid, text, uuid, varchar, numeric, varchar, text, text
) from public, anon, authenticated;

revoke all on function public.set_operational_inventory_count(
  uuid, uuid, text, uuid, numeric, text, text
) from public, anon, authenticated;
