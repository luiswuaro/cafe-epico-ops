import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import { loyverseCustomers, posCustomers } from "@/src/infrastructure/db/schema";

type Numbers = {
  ticket_count: number | string;
  distinct_days: number | string;
  total_spent: number | string;
  first_purchase: Date | null;
  last_purchase: Date | null;
};

type Favorite = {
  name: string;
  category: string;
  units: number | string;
  purchase_tickets: number | string;
};

export type Purchase = {
  source: "LOYVERSE" | "OPS";
  receipt_id: string;
  order_id: string | null;
  split_id: string | null;
  folio: string;
  occurred_at: Date;
  total: number | string;
  service: string | null;
  lines: unknown;
};

function sourceStats(payload: Record<string, unknown> | undefined) {
  const number = (value: unknown) =>
    typeof value === "number" || typeof value === "string"
      ? (value !== "" && Number.isFinite(Number(value)) ? Number(value) : null)
      : null;
  const str = (value: unknown) =>
    typeof value === "string" && value.trim() ? value : null;
  return {
    totalVisits: number(payload?.total_visits),
    totalSpent: number(payload?.total_spent),
    firstVisit: str(payload?.first_visit),
    lastVisit: str(payload?.last_visit),
  };
}

export async function getCustomerPurchaseProfile(input: {
  organizationId: string;
  storeId: string;
  customerId: string;
  page: number;
}) {
  const db = getDb();
  const [customer] = await db.select().from(posCustomers).where(and(
    eq(posCustomers.id, input.customerId),
    eq(posCustomers.organizationId, input.organizationId),
  )).limit(1);

  if (!customer) return null;
  const [source] = customer.sourceExternalId
    ? await db.select({
        payload: loyverseCustomers.payload,
      }).from(loyverseCustomers).where(and(
        eq(loyverseCustomers.organizationId, input.organizationId),
        eq(loyverseCustomers.externalId, customer.sourceExternalId),
      )).limit(1)
    : [];

  // Tickets sin cliente asignado NO se adjudican a nadie por nombre.
  // Sólo contamos pagos LIVE de OPS si no están reflejados por Loyverse.
  const receiptCustomerId = customer.sourceExternalId ?? "";
  // A cada cliente sólo se le atribuyen las unidades de SU cuenta pagada.
  // No inferir identidad desde nombres, mesa o texto de puntos.
  const base = sql`
    with purchased as (
      select 'LOYVERSE'::text as source,
        r.external_id::text as receipt_id,
        null::uuid as order_id,null::uuid as split_id,
        r.receipt_date as occurred_at,
        coalesce(r.total_money,0)::numeric as total
      from loyverse_receipts r
      where r.organization_id=${input.organizationId}::uuid
        and r.payload->>'customer_id'=${receiptCustomerId}
        and r.receipt_type='SALE'
        and coalesce(r.payload->>'cancelled_at','')=''

      union all

      select 'OPS'::text as source,
        o.id::text as receipt_id,
        o.id as order_id,null::uuid as split_id,
        coalesce(o.paid_at,o.created_at) as occurred_at,
        o.total::numeric as total
      from pos_orders o
      where o.organization_id=${input.organizationId}::uuid
        and o.store_id=${input.storeId}::uuid
        and o.customer_id=${input.customerId}::uuid
        and o.mode='LIVE' and o.status='PAID'
        and not exists (select 1 from pos_order_splits s where s.order_id=o.id)
        and not exists (
          select 1 from loyverse_receipts r
          where r.organization_id=o.organization_id
            and r.external_id=o.matched_external_receipt_id
        )

      union all

      select 'OPS'::text as source,
        s.id::text as receipt_id,
        o.id as order_id,s.id as split_id,
        coalesce(s.paid_at,o.paid_at,o.created_at) as occurred_at,
        s.total::numeric as total
      from pos_order_splits s
      join pos_orders o on o.id=s.order_id and o.organization_id=s.organization_id
      where s.organization_id=${input.organizationId}::uuid
        and o.store_id=${input.storeId}::uuid
        and s.customer_id=${input.customerId}::uuid
        and s.status='PAID'
        and o.mode='LIVE' and o.status in ('PAID','PARTIALLY_PAID')
        and not exists (
          select 1 from loyverse_receipts r
          where r.organization_id=o.organization_id
            and r.external_id=o.matched_external_receipt_id
        )
    )
  `;

  const [summaryRows, favoriteRows] = await Promise.all([
    db.execute(sql<Numbers>`
      ${base}
      select count(*)::int as ticket_count,
        count(distinct to_char(occurred_at at time zone 'America/Mexico_City','YYYY-MM-DD'))::int as distinct_days,
        coalesce(sum(total),0)::numeric as total_spent,
        min(occurred_at) as first_purchase,
        max(occurred_at) as last_purchase
      from purchased
    `),
    db.execute(sql<Favorite>`
      ${base},
      beverage_lines as (
        select upper(btrim(li.payload->>'item_name'))::text as name,
          coalesce(c.name,'')::text as category,
          li.quantity::numeric as units,
          p.receipt_id
        from purchased p
        join loyverse_receipts r on p.source='LOYVERSE'
          and r.external_id=p.receipt_id and r.organization_id=${input.organizationId}::uuid
        join loyverse_receipt_lines li on li.organization_id=r.organization_id
          and li.receipt_external_id=r.external_id
        left join loyverse_items i on i.organization_id=r.organization_id
          and i.external_id=li.payload->>'item_id'
        left join loyverse_categories c on c.organization_id=r.organization_id
          and c.external_id=i.payload->>'category_id'
        where c.name ilike 'BEBIDAS FRIAS%'
           or c.name ilike 'CALIENTES%'
           or c.name ilike 'CACAO%'
           or c.name ilike 'BREW BAR%'
        union all
        select upper(btrim(l.name_snapshot))::text as name,
          l.category_snapshot::text as category,
          l.quantity::numeric as units,
          p.receipt_id
        from purchased p
        join pos_order_lines l on l.order_id=p.order_id
          and l.organization_id=${input.organizationId}::uuid
        where p.source='OPS' and p.split_id is null
          and l.category_snapshot in ('CALIENTES','FRÍAS')
        union all
        select upper(btrim(l.name_snapshot))::text as name,
          l.category_snapshot::text as category,
          sl.quantity::numeric as units,
          p.receipt_id
        from purchased p
        join pos_order_split_lines sl on sl.split_id=p.split_id
          and sl.organization_id=${input.organizationId}::uuid
        join pos_order_lines l on l.id=sl.order_line_id
          and l.organization_id=${input.organizationId}::uuid
        where p.source='OPS' and p.split_id is not null
          and l.category_snapshot in ('CALIENTES','FRÍAS')
      )
      select name, min(category) as category,
        sum(units)::numeric as units,
        count(distinct receipt_id)::int as purchase_tickets
      from beverage_lines where name is not null and name<>''
      group by name
      order by sum(units) desc, count(distinct receipt_id) desc, name
      limit 5
    `),
  ]);

  const page = Math.max(1, Math.min(100, Math.floor(input.page) || 1));
  const take = 20;
  const historyRows = await db.execute(sql<Purchase>`
    ${base}
    select
      p.source,p.receipt_id,
      p.order_id::text as order_id,p.split_id::text as split_id,
      case when p.source='LOYVERSE'
        then coalesce(r.payload->>'receipt_number',p.receipt_id)
        when p.split_id is not null then o.folio || ' · ' || s.label
        else o.folio end as folio,
      p.occurred_at,p.total,
      case when p.source='LOYVERSE'
        then r.payload->>'dining_option' else o.service_mode end as service,
      case when p.source='LOYVERSE'
        then coalesce(r.payload->'line_items','[]'::jsonb)
        when p.split_id is not null
        then coalesce((select jsonb_agg(jsonb_build_object(
          'item_name',l.name_snapshot,'quantity',sl.quantity,
          'total_money',sl.line_total
        ) order by sl.created_at)
          from pos_order_split_lines sl
          join pos_order_lines l on l.id=sl.order_line_id
          where sl.split_id=p.split_id), '[]'::jsonb)
        else coalesce((select jsonb_agg(jsonb_build_object(
          'item_name',l.name_snapshot,'quantity',l.quantity,
          'total_money',l.line_total
        ) order by l.created_at)
          from pos_order_lines l where l.order_id=p.order_id), '[]'::jsonb)
      end as lines
    from purchased p
    left join loyverse_receipts r on p.source='LOYVERSE'
      and r.organization_id=${input.organizationId}::uuid and r.external_id=p.receipt_id
    left join pos_orders o on p.source='OPS' and o.id=p.order_id
    left join pos_order_splits s on s.id=p.split_id
    order by p.occurred_at desc nulls last,p.receipt_id desc
    limit ${take + 1} offset ${(page-1)*take}
  `);

  const summary = (summaryRows as unknown as Numbers[])[0];
  const rows = historyRows as unknown as Purchase[];
  return {
    customer,
    importedStats: sourceStats(source?.payload),
    summary: {
      tickets: Number(summary?.ticket_count ?? 0),
      distinctDays: Number(summary?.distinct_days ?? 0),
      spent: Number(summary?.total_spent ?? 0),
      firstPurchase: summary?.first_purchase ?? null,
      lastPurchase: summary?.last_purchase ?? null,
    },
    favoriteBeverages: (favoriteRows as unknown as Favorite[]).map(row => ({
      name: row.name,
      category: row.category,
      units: Number(row.units),
      tickets: Number(row.purchase_tickets),
    })),
    history: rows.slice(0,take),
    hasMore: rows.length > take,
    page,
  };
}
