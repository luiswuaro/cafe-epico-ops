import { sql } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";

export type TicketSource = "TODOS" | "OPS" | "LOYVERSE";

export type TicketHistoryRow = {
  source: "OPS" | "LOYVERSE";
  id: string;
  folio: string;
  occurred_at: Date;
  status: string;
  total: string;
  customer: string | null;
  payment: string | null;
  mode: string;
  service_mode: string | null;
  cancel_reason: string | null;
  inventory_effect_applied: boolean;
  loyalty_effect_applied: boolean;
  lines: unknown;
};

export async function getTicketHistory(input: {
  organizationId: string;
  storeId: string;
  source: TicketSource;
  q: string;
  day: string;
  page: number;
}) {
  const page = Math.max(1, Math.min(200, Math.floor(input.page)));
  const limit = 40;
  const offset = (page - 1) * limit;
  const term = "%" + input.q.slice(0, 80).trim() + "%";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(input.day) ? input.day : "";
  const rows = await getDb().execute(sql<TicketHistoryRow>`
    with tickets as (
      select
        'OPS'::text as source,
        o.id::text as id,
        o.folio::text as folio,
        coalesce(o.paid_at, o.created_at) as occurred_at,
        o.status::text as status,
        o.total as total,
        c.name::text as customer,
        (select string_agg(distinct p.method, ', ') from pos_payments p where p.order_id=o.id)::text as payment,
        o.mode::text as mode,
        o.service_mode::text as service_mode,
        o.cancel_reason::text as cancel_reason,
        o.inventory_effect_applied,
        o.loyalty_effect_applied,
        coalesce((select jsonb_agg(jsonb_build_object(
          'name',l.name_snapshot,'quantity',l.quantity,'total',l.line_total,
          'note',l.note
        ) order by l.created_at)
          from pos_order_lines l where l.order_id=o.id), '[]'::jsonb) as lines
      from pos_orders o
      left join pos_customers c on c.id=o.customer_id
      where o.organization_id=${input.organizationId}::uuid
        and o.store_id=${input.storeId}::uuid

      union all

      select
        'LOYVERSE'::text as source,
        r.external_id as id,
        coalesce(r.payload->>'receipt_number',r.external_id)::text as folio,
        r.receipt_date as occurred_at,
        (case when r.receipt_type='REFUND' then 'REFUND'
              when nullif(r.payload->>'cancelled_at','') is not null then 'CANCELLED'
              else 'PAID' end)::text as status,
        coalesce(r.total_money,0) as total,
        nullif(r.payload->>'customer_name','')::text as customer,
        coalesce((select string_agg(distinct p->>'name', ', ')
          from jsonb_array_elements(
            case when jsonb_typeof(r.payload->'payments')='array' then r.payload->'payments' else '[]'::jsonb end
          ) p), null)::text as payment,
        'HISTORICAL'::text as mode,
        r.payload->>'dining_option' as service_mode,
        null::text as cancel_reason,
        false as inventory_effect_applied,
        false as loyalty_effect_applied,
        coalesce(r.payload->'line_items','[]'::jsonb) as lines
      from loyverse_receipts r
      where r.organization_id=${input.organizationId}::uuid
    )
    select * from tickets
    where (${input.source}='TODOS' or source=${input.source})
      and (folio ilike ${term} or coalesce(customer,'') ilike ${term} or id ilike ${term})
      and (${day}='' or to_char(occurred_at at time zone 'America/Mexico_City','YYYY-MM-DD')=${day})
    order by occurred_at desc nulls last, id desc
    limit ${limit + 1} offset ${offset}
  `);
  const tickets = rows as unknown as TicketHistoryRow[];
  return {
    tickets: tickets.slice(0, limit),
    hasNext: tickets.length > limit,
    page,
  };
}
