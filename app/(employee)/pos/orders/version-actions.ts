"use server";

import { sql } from "drizzle-orm";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";

/**
 * Sonda mínima para el tablero de comandas (una fila, un solo viaje a BD).
 * No devuelve pedidos ni información de clientes al navegador.
 * Autoriza en CADA solicitud: nunca almacenar permisos ni sesiones en caché.
 * Todos los datos completos continúan leyéndose por el servidor al actualizar.
 */
export async function getCommandBoardVersion():Promise<string>{
  const {employee}=await getCurrentEmployee();
  if(!employee.homeStoreId)throw new Error("Sin sucursal asignada");
  await assertEmployeePermission(employee.id,"pos.sell",employee.homeStoreId);
  const org=employee.organizationId,store=employee.homeStoreId;
  const [row]=await getDb().execute(sql`
    select concat_ws(':',
      (select md5(coalesce(string_agg(concat_ws('|',
        o.id::text,o.status,o.updated_at::text,o.total::text,
        coalesce(o.customer_id::text,''),coalesce(o.table_label,''),
        coalesce(o.note,''),coalesce(o.paid_at::text,'')
      ), ';' order by o.id),''))
       from public.pos_orders o
       where o.organization_id=${org}::uuid and o.store_id=${store}::uuid
       and (o.status in ('SENT','PREPARING','READY','PARTIALLY_PAID')
         or (o.mode='LIVE' and o.status='PAID'
           and o.paid_at>=now()-interval '12 hours'))),
      (select md5(coalesce(string_agg(concat_ws('|',
        l.id::text,l.quantity::text,l.line_total::text,coalesce(l.note,''),
        l.expected_consumption::text
      ), ';' order by l.id),''))
       from public.pos_order_lines l
       join public.pos_orders o on o.id=l.order_id
       where o.organization_id=${org}::uuid and o.store_id=${store}::uuid
       and (o.status in ('SENT','PREPARING','READY','PARTIALLY_PAID')
         or (o.mode='LIVE' and o.status='PAID'
           and o.paid_at>=now()-interval '12 hours'))),
      (select count(*)::text||'/'||coalesce(max(a.created_at)::text,'')
       from public.audit_events a
       where a.organization_id=${org}::uuid and a.store_id=${store}::uuid
       and a.entity_type='pos_order'
       and a.action in ('POS_COMMAND_PRINT_ACKNOWLEDGED',
         'POS_COMMAND_STATUS_CHANGED','POS_TAKEAWAY_DISPATCHED')
       and a.created_at>=now()-interval '24 hours'),
      (select count(*)::text||'/'||coalesce(max(s.updated_at)::text,'')
       from public.pos_order_splits s
       join public.pos_orders o on o.id=s.order_id
       where o.organization_id=${org}::uuid and o.store_id=${store}::uuid
         and o.created_at>=now()-interval '24 hours'),
      (select count(*)::text||'/'||coalesce(max(p.created_at)::text,'')
       from public.pos_payments p
       join public.pos_orders o on o.id=p.order_id
       where o.organization_id=${org}::uuid and o.store_id=${store}::uuid
         and p.created_at>=now()-interval '24 hours'),
      (select count(*)::text||'/'||coalesce(max(c.updated_at)::text,'')
       from public.pos_customers c where c.organization_id=${org}::uuid),
      (select count(*)::text||'/'||coalesce(max(c.updated_at)::text,'')
       from public.pos_cash_sessions c
       where c.organization_id=${org}::uuid and c.store_id=${store}::uuid),
      (select count(*)::text||'/'||coalesce(max(m.created_at)::text,'')
       from public.pos_cash_movements m
       where m.organization_id=${org}::uuid and m.store_id=${store}::uuid
         and m.created_at>=now()-interval '24 hours'),
      (select count(*)::text||'/'||coalesce(max(p.updated_at)::text,'')
       from public.pos_catalog_overrides p
       where p.organization_id=${org}::uuid),
      (select count(*)::text||'/'||coalesce(max(p.updated_at)::text,'')
       from public.pos_manual_products p
       where p.organization_id=${org}::uuid)
    ) as version
  `);
  return String((row as {version?:string}|undefined)?.version??"");
}
