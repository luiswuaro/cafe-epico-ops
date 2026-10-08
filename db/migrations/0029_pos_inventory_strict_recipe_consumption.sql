-- POS v0.3.2: descuento de inventario estricto para bebidas.
create or replace function public.apply_pos_order_inventory(
  p_order_id uuid,
  p_employee_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.pos_orders%rowtype;
  v_store_external_id text;
  v_component record;
  v_source record;
  v_movement_id uuid;
  v_applied integer := 0;
  v_drink_lines integer := 0;
  v_missing_links integer := 0;
begin
  select * into v_order
  from public.pos_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Orden POS no encontrada';
  end if;

  if v_order.status <> 'PAID' then
    return jsonb_build_object('applied', false, 'reason', 'ORDER_NOT_PAID');
  end if;

  if v_order.inventory_effect_applied then
    return jsonb_build_object('applied', false, 'reason', 'ALREADY_APPLIED');
  end if;

  select count(*) into v_drink_lines
  from public.pos_order_lines
  where order_id = p_order_id
    and category_snapshot in ('CALIENTES','FRÍAS');

  select count(*) into v_missing_links
  from public.pos_order_lines pol
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(pol.expected_consumption->'components') = 'array'
        then pol.expected_consumption->'components'
      else '[]'::jsonb
    end
  ) component
  where pol.order_id = p_order_id
    and pol.category_snapshot in ('CALIENTES','FRÍAS')
    and coalesce((component->>'quantity')::numeric,0) > 0
    and nullif(component->>'variantExternalId','') is null;

  if v_missing_links > 0 then
    raise exception
      'Hay % componente(s) de bebida sin vínculo de inventario',
      v_missing_links;
  end if;

  if v_drink_lines > 0 and not exists (
    select 1
    from public.pos_order_lines pol
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(pol.expected_consumption->'components') = 'array'
          then pol.expected_consumption->'components'
        else '[]'::jsonb
      end
    ) component
    where pol.order_id = p_order_id
      and pol.category_snapshot in ('CALIENTES','FRÍAS')
      and nullif(component->>'variantExternalId','') is not null
      and coalesce((component->>'quantity')::numeric,0) > 0
  ) then
    raise exception 'La orden contiene bebida(s) sin consumo de inventario configurado';
  end if;

  select b.loyverse_store_external_id
    into v_store_external_id
  from public.operational_inventory_balances b
  where b.organization_id = v_order.organization_id
    and b.store_id = v_order.store_id
  limit 1;

  if v_store_external_id is null then
    select case when count(*) = 1 then min(external_id) else null end
      into v_store_external_id
    from public.loyverse_stores
    where organization_id = v_order.organization_id;
  end if;

  if v_store_external_id is null then
    raise exception
      'No hay una sucursal Loyverse unívoca para inicializar el inventario OPS';
  end if;

  for v_component in
    select
      component->>'variantExternalId' as variant_external_id,
      sum(
        case
          when nullif(component->>'quantity','') is null then 0
          else (component->>'quantity')::numeric
        end
      ) as quantity_native,
      max(coalesce(component->>'name','Insumo')) as item_name,
      bool_or(pol.category_snapshot in ('CALIENTES','FRÍAS')) as required_for_drink
    from public.pos_order_lines pol
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(pol.expected_consumption->'components') = 'array'
          then pol.expected_consumption->'components'
        else '[]'::jsonb
      end
    ) component
    where pol.order_id = p_order_id
      and nullif(component->>'variantExternalId','') is not null
    group by component->>'variantExternalId'
  loop
    if v_component.quantity_native <= 0 then
      continue;
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
    where lil.organization_id = v_order.organization_id
      and lil.store_external_id = v_store_external_id
      and lil.variant_external_id = v_component.variant_external_id
      and coalesce((li.payload->>'track_stock')::boolean,false) = true
    limit 1;

    if not found then
      if v_component.required_for_drink then
        raise exception
          'El insumo % no tiene stock rastreable; no se aplicó ningún descuento',
          v_component.item_name;
      end if;
      continue;
    end if;

    insert into public.operational_inventory_balances(
      organization_id, store_id, loyverse_store_external_id,
      variant_external_id, item_name_snapshot, quantity_native,
      source_quantity_native, source_synced_at, initialized_at, updated_at
    )
    values(
      v_order.organization_id, v_order.store_id, v_store_external_id,
      v_component.variant_external_id,
      coalesce(v_source.item_name, v_component.item_name),
      v_source.in_stock, v_source.in_stock, v_source.synced_at, now(), now()
    )
    on conflict(store_id, variant_external_id) do nothing;

    v_movement_id := null;

    insert into public.operational_inventory_movements(
      organization_id, store_id, variant_external_id, item_name_snapshot,
      movement_type, quantity_delta_native, source_type, source_id,
      order_id, employee_id, occurred_at, note
    )
    values(
      v_order.organization_id, v_order.store_id,
      v_component.variant_external_id,
      coalesce(v_source.item_name, v_component.item_name),
      'SALE', -v_component.quantity_native, 'POS_ORDER',
      p_order_id::text, p_order_id, p_employee_id,
      coalesce(v_order.paid_at, now()), v_order.folio
    )
    on conflict do nothing
    returning id into v_movement_id;

    if v_movement_id is not null then
      update public.operational_inventory_balances
      set
        quantity_native = quantity_native - v_component.quantity_native,
        updated_at = now()
      where store_id = v_order.store_id
        and variant_external_id = v_component.variant_external_id;

      v_applied := v_applied + 1;
    end if;
  end loop;

  if v_drink_lines > 0 and v_applied = 0 then
    raise exception
      'La orden contiene bebida(s), pero no se pudo aplicar consumo de inventario';
  end if;

  update public.pos_orders
  set inventory_effect_applied = true, updated_at = now()
  where id = p_order_id;

  return jsonb_build_object('applied', true, 'components', v_applied);
end;
$$;

revoke all on function public.apply_pos_order_inventory(uuid, uuid)
  from public, anon, authenticated;
