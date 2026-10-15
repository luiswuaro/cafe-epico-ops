"use server";

import { sql, type SQL } from "drizzle-orm";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { getVerifiedHotPathUserId } from "@/src/infrastructure/auth/verified-hot-path-user";
import { getDb } from "@/src/infrastructure/db/client";

/**
 * La firma devuelve una fila pequeña y nunca transmite pedidos completos.
 * Se ejecuta sólo si un empleado ACTIVO con pos.sell autorizó la sonda.
 */
function commandBoardFingerprint(org:SQL,store:SQL):SQL{
  return sql`
        concat_ws(':',
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
        )
  `;
}

/**
 * En cada refresh: verificar JWT firmado y consultar identidad, permiso y
 * versión de Comandas en una sola lectura PostgreSQL. Nunca cachear permisos.
 * Si la sonda no funciona, recuperar el comportamiento original (seguro).
 */
export async function getCommandBoardVersion():Promise<string>{
  const userId=await getVerifiedHotPathUserId();
  const organizationSlug=process.env.DEFAULT_ORGANIZATION_SLUG??"cafe-epico";
  const db=getDb();
  try{
    const [row]=await db.execute(sql`
      with staff as (
        select e.id,e.organization_id,e.home_store_id
        from public.employees e
        join public.organizations org on org.id=e.organization_id
        where e.user_id=${userId}::uuid
          and org.slug=${organizationSlug}
          and e.is_active=true
        limit 1
      ), access as (
        select s.id,s.organization_id,s.home_store_id,
          exists (
            select 1 from public.employee_roles er
            join public.role_permissions rp on rp.role_id=er.role_id
            join public.permissions p on p.id=rp.permission_id
            where er.employee_id=s.id and p.code='pos.sell'
              and (er.store_id is null or er.store_id=s.home_store_id)
          ) as allowed
        from staff s
      )
      select staff_access.allowed,staff_access.home_store_id as store_id,
        case when staff_access.allowed and staff_access.home_store_id is not null
          then ${commandBoardFingerprint(sql`staff_access.organization_id`,sql`staff_access.home_store_id`)}
          else null end as version
      from access staff_access
    `);
    const candidate=row as {allowed?:boolean;store_id?:string|null;version?:string|null}|undefined;
    if(!candidate||typeof candidate.allowed!=="boolean")
      throw new Error("Empleado no vinculado a la sonda.");
    // Una denegación de permisos siempre es explícita y nunca entrega datos.
    if(!candidate.store_id)throw new Error("Sin sucursal asignada");
    if(!candidate.allowed)throw new Error("Missing permission: pos.sell");
    return String(candidate.version??"");
  }catch(error){
    // La vía anterior admite vínculos bootstrap y vuelve a verificar
    // empleado activo y permiso ANTES de consultar la firma del tablero.
    const {employee}=await getCurrentEmployee();
    if(!employee.homeStoreId)throw new Error("Sin sucursal asignada");
    await assertEmployeePermission(employee.id,"pos.sell",employee.homeStoreId);
    const [row]=await db.execute(sql`
      select ${commandBoardFingerprint(sql`${employee.organizationId}::uuid`,
        sql`${employee.homeStoreId}::uuid`)} as version
    `);
    return String((row as {version?:string}|undefined)?.version??"");
  }
}
