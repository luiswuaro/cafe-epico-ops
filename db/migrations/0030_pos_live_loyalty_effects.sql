-- POS live: puntos de lealtad reales al 5% y reversa por cancelación.

create unique index if not exists pos_loyalty_order_entry_uidx
  on public.pos_loyalty_entries(order_id, entry_type)
  where order_id is not null;

create or replace function public.apply_pos_order_loyalty(
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.pos_orders%rowtype;
  v_points numeric(14,2);
  v_entry_id uuid;
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

  if v_order.loyalty_effect_applied then
    return jsonb_build_object('applied', false, 'reason', 'ALREADY_APPLIED');
  end if;

  if v_order.customer_id is null then
    return jsonb_build_object('applied', false, 'reason', 'NO_CUSTOMER');
  end if;

  v_points := round(coalesce(v_order.loyalty_points_preview, 0)::numeric, 2);

  if v_points <= 0 then
    return jsonb_build_object('applied', false, 'reason', 'NO_POINTS');
  end if;

  insert into public.pos_loyalty_entries(
    organization_id,
    customer_id,
    order_id,
    entry_type,
    points,
    note
  )
  values(
    v_order.organization_id,
    v_order.customer_id,
    v_order.id,
    'EARN',
    v_points,
    '5% de compra · ' || v_order.folio
  )
  on conflict (order_id, entry_type) where order_id is not null
  do nothing
  returning id into v_entry_id;

  if v_entry_id is null then
    update public.pos_orders
    set loyalty_effect_applied = true, updated_at = now()
    where id = v_order.id;

    return jsonb_build_object('applied', false, 'reason', 'ENTRY_EXISTS');
  end if;

  update public.pos_customers
  set
    points_balance = points_balance + v_points,
    updated_at = now()
  where id = v_order.customer_id
    and organization_id = v_order.organization_id;

  update public.pos_orders
  set
    loyalty_effect_applied = true,
    updated_at = now()
  where id = v_order.id;

  return jsonb_build_object(
    'applied', true,
    'points', v_points
  );
end;
$$;

create or replace function public.reverse_pos_order_loyalty(
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.pos_orders%rowtype;
  v_points numeric(14,2);
  v_entry_id uuid;
begin
  select * into v_order
  from public.pos_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Orden POS no encontrada';
  end if;

  if not v_order.loyalty_effect_applied then
    return jsonb_build_object(
      'reversed', false,
      'reason', 'NO_ACTIVE_LOYALTY_EFFECT'
    );
  end if;

  if v_order.customer_id is null then
    update public.pos_orders
    set loyalty_effect_applied = false, updated_at = now()
    where id = v_order.id;

    return jsonb_build_object('reversed', false, 'reason', 'NO_CUSTOMER');
  end if;

  v_points := round(coalesce(v_order.loyalty_points_preview, 0)::numeric, 2);

  insert into public.pos_loyalty_entries(
    organization_id,
    customer_id,
    order_id,
    entry_type,
    points,
    note
  )
  values(
    v_order.organization_id,
    v_order.customer_id,
    v_order.id,
    'REVERSAL',
    -v_points,
    'Reversa por cancelación · ' || v_order.folio
  )
  on conflict (order_id, entry_type) where order_id is not null
  do nothing
  returning id into v_entry_id;

  if v_entry_id is not null then
    update public.pos_customers
    set
      points_balance = points_balance - v_points,
      updated_at = now()
    where id = v_order.customer_id
      and organization_id = v_order.organization_id;
  end if;

  update public.pos_orders
  set
    loyalty_effect_applied = false,
    updated_at = now()
  where id = v_order.id;

  return jsonb_build_object(
    'reversed', true,
    'points', v_points
  );
end;
$$;

revoke all on function public.apply_pos_order_loyalty(uuid)
  from public, anon, authenticated;
revoke all on function public.reverse_pos_order_loyalty(uuid)
  from public, anon, authenticated;
