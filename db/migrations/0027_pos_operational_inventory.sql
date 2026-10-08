-- POS v0.3: saldo operativo independiente, descuento por receta y reversas.

create table if not exists operational_inventory_balances (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  loyverse_store_external_id text not null,
  variant_external_id text not null,
  item_name_snapshot text not null,
  quantity_native numeric(18,6) not null,
  source_quantity_native numeric(18,6) not null,
  source_synced_at timestamptz,
  initialized_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(store_id, variant_external_id)
);

create index if not exists operational_inventory_balances_variant_idx
  on public.operational_inventory_balances(
    organization_id,
    variant_external_id
  );

create table if not exists operational_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  variant_external_id text not null,
  item_name_snapshot text not null,
  movement_type varchar(40) not null,
  quantity_delta_native numeric(18,6) not null,
  source_type varchar(40) not null,
  source_id text,
  order_id uuid references public.pos_orders(id) on delete set null,
  employee_id uuid references public.employees(id) on delete set null,
  occurred_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists operational_inventory_movements_variant_idx
  on public.operational_inventory_movements(
    organization_id,
    store_id,
    variant_external_id,
    occurred_at desc
  );

create index if not exists operational_inventory_movements_order_idx
  on public.operational_inventory_movements(order_id);

create unique index if not exists operational_inventory_movements_source_uidx
  on public.operational_inventory_movements(
    organization_id,
    source_type,
    source_id,
    variant_external_id
  )
  where source_id is not null;

alter table public.operational_inventory_balances enable row level security;
alter table public.operational_inventory_movements enable row level security;

revoke all on table public.operational_inventory_balances from anon, authenticated;
revoke all on table public.operational_inventory_movements from anon, authenticated;

with internal_single as (
  select organization_id, min(id::text)::uuid as store_id
  from public.stores
  where is_active = true
  group by organization_id
  having count(*) = 1
),
loyverse_single as (
  select organization_id, min(external_id) as store_external_id
  from public.loyverse_stores
  group by organization_id
  having count(*) = 1
)
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
select
  lil.organization_id,
  si.store_id,
  lil.store_external_id,
  lil.variant_external_id,
  li.item_name,
  lil.in_stock,
  lil.in_stock,
  lil.synced_at,
  now(),
  now()
from public.loyverse_inventory_levels lil
join internal_single si
  on si.organization_id = lil.organization_id
join loyverse_single ls
  on ls.organization_id = lil.organization_id
 and ls.store_external_id = lil.store_external_id
join public.loyverse_variants lv
  on lv.organization_id = lil.organization_id
 and lv.external_id = lil.variant_external_id
join public.loyverse_items li
  on li.organization_id = lil.organization_id
 and li.external_id = lv.loyverse_item_external_id
where coalesce((li.payload->>'track_stock')::boolean,false) = true
on conflict(store_id, variant_external_id) do nothing;

insert into public.operational_inventory_movements(
  organization_id,
  store_id,
  variant_external_id,
  item_name_snapshot,
  movement_type,
  quantity_delta_native,
  source_type,
  source_id,
  occurred_at,
  note
)
select
  b.organization_id,
  b.store_id,
  b.variant_external_id,
  b.item_name_snapshot,
  'OPENING_BALANCE',
  b.quantity_native,
  'LOYVERSE_OPENING',
  b.loyverse_store_external_id,
  b.initialized_at,
  'Saldo inicial tomado del espejo de Loyverse'
from public.operational_inventory_balances b
on conflict do nothing;

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
begin
  select *
    into v_order
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
      max(coalesce(component->>'name','Insumo')) as item_name
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

    select
      lil.in_stock,
      lil.synced_at,
      li.item_name
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
      continue;
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
      v_order.organization_id,
      v_order.store_id,
      v_store_external_id,
      v_component.variant_external_id,
      coalesce(v_source.item_name, v_component.item_name),
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
      order_id,
      employee_id,
      occurred_at,
      note
    )
    values(
      v_order.organization_id,
      v_order.store_id,
      v_component.variant_external_id,
      coalesce(v_source.item_name, v_component.item_name),
      'SALE',
      -v_component.quantity_native,
      'POS_ORDER',
      p_order_id::text,
      p_order_id,
      p_employee_id,
      coalesce(v_order.paid_at, now()),
      v_order.folio
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

  update public.pos_orders
  set inventory_effect_applied = true, updated_at = now()
  where id = p_order_id;

  return jsonb_build_object('applied', true, 'components', v_applied);
end;
$$;

create or replace function public.reverse_pos_order_inventory(
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
  v_sale record;
  v_movement_id uuid;
  v_reversed integer := 0;
begin
  select *
    into v_order
  from public.pos_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Orden POS no encontrada';
  end if;

  if not v_order.inventory_effect_applied then
    return jsonb_build_object(
      'reversed', false,
      'reason', 'NO_ACTIVE_INVENTORY_EFFECT'
    );
  end if;

  for v_sale in
    select *
    from public.operational_inventory_movements
    where organization_id = v_order.organization_id
      and store_id = v_order.store_id
      and source_type = 'POS_ORDER'
      and source_id = p_order_id::text
      and movement_type = 'SALE'
  loop
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
      order_id,
      employee_id,
      occurred_at,
      note
    )
    values(
      v_order.organization_id,
      v_order.store_id,
      v_sale.variant_external_id,
      v_sale.item_name_snapshot,
      'SALE_REVERSAL',
      -v_sale.quantity_delta_native,
      'POS_ORDER_REVERSAL',
      p_order_id::text,
      p_order_id,
      p_employee_id,
      now(),
      'Reversa por cancelación · ' || v_order.folio
    )
    on conflict do nothing
    returning id into v_movement_id;

    if v_movement_id is not null then
      update public.operational_inventory_balances
      set
        quantity_native = quantity_native - v_sale.quantity_delta_native,
        updated_at = now()
      where store_id = v_order.store_id
        and variant_external_id = v_sale.variant_external_id;

      v_reversed := v_reversed + 1;
    end if;
  end loop;

  update public.pos_orders
  set inventory_effect_applied = false, updated_at = now()
  where id = p_order_id;

  return jsonb_build_object('reversed', true, 'components', v_reversed);
end;
$$;

revoke all on function public.apply_pos_order_inventory(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.reverse_pos_order_inventory(uuid, uuid)
  from public, anon, authenticated;
