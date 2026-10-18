/**
 * Diagnóstico solo lectura ANTES de activar el worker de impresión en QA.
 * No genera usuarios, no modifica .env.local, no reclama ni imprime trabajos.
 * Uso: node --env-file=.env.local scripts/local/inspect-qa-print-agent-ready.mjs
 */
import postgres from "postgres";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";

const env=process.env;
function status(ok,name,detail=""){
  console.log((ok?"PASS: ":"PENDIENTE: ")+name+(detail?" — "+detail:""));
}
async function main(){
  const guard=validateLocalQaConfig(env);
  if(!guard.ok)throw Error("La configuración no corresponde al QA local.");
  const dbUrl=new URL(env.DATABASE_URL);
  if(!["127.0.0.1","localhost"].includes(dbUrl.hostname))
    throw Error("Solo PostgreSQL en loopback.");
  const bridgeToken=env.OPS_LOCAL_TICKET_PRINTER_TOKEN;
  const port=Number(env.OPS_LOCAL_TICKET_PRINTER_PORT||9137);
  status(Boolean(bridgeToken&&bridgeToken.length>=32&&!bridgeToken.includes("REEMPLAZAR")),
    "Token de puente POS-58 presente (oculto)");
  status(port===9137,"Puerto de puente de tickets",String(port));
  status(env.POS_LIVE_ENABLED!=="true"&&env.OPS_QA_MODE==="true",
    "Caja LIVE comercial deshabilitada en QA");
  const flag=env.NEXT_PUBLIC_OPS_LOCAL_PRINT_AGENT_ENABLED==="true";
  status(flag,"Modo de agente de impresión habilitado en la compilación QA",
    flag?"aun verificar build en la PC":"mantener apagado hasta completar credenciales");
  const token=env.OPS_LOCAL_PRINT_AGENT_TOKEN;
  status(Boolean(token&&token.length>=32&&!token.includes("REEMPLAZAR")),
    "Token exclusivo del agente configurado (oculto)");
  const id=env.OPS_LOCAL_PRINT_AGENT_USER_ID||"";
  const validUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
  status(validUuid,"UUID del usuario de servicio configurado (oculto)");
  const db=postgres(env.DATABASE_URL,{max:1,prepare:false,connect_timeout:5});
  try{
    const orgs=await db`select id,slug from public.organizations`;
    const stores=await db`select organization_id,code from public.stores`;
    if(orgs.length!==1||orgs[0].slug!=="cafe-epico-qa"||
       stores.length!==1||stores[0].code!=="QA-TEPEXI"||
       stores[0].organization_id!==orgs[0].id)
      throw Error("Organización/sucursal QA no aisladas.");
    status(true,"Organización y sucursal QA únicas");
    const eligible=await db`
      select e.user_id
      from public.employees e
      where e.organization_id=${orgs[0].id}
        and e.is_active=true and e.home_store_id is not null
        and e.user_id is not null
        and exists (
          select 1 from auth.users a where a.id=e.user_id
        )
        and exists (
          select 1 from public.employee_roles er
          join public.role_permissions rp on rp.role_id=er.role_id
          join public.permissions p on p.id=rp.permission_id
          where er.employee_id=e.id and p.code='pos.sell'
          and (er.store_id is null or er.store_id=e.home_store_id)
        )`;
    status(eligible.length>0,"Cuentas QA con permiso de impresión pos.sell",
      String(eligible.length)+" elegibles, sin revelar identidades");
    status(validUuid&&eligible.some(x=>x.user_id===id),
      "Identidad del agente vinculada y autorizada");
    const [pending]=await db`
      select count(*)::int as total from public.pos_orders
      where organization_id=${orgs[0].id}
        and mode='LIVE' and status='SENT'`;
    status(pending.total===0,"Pedidos LIVE de ensayo abiertos",
      String(pending.total)+" en QA; los anteriores no se enviarán automáticamente");
  }finally{await db.end({timeout:3});}
  console.log("FIN: auditoría solo lectura, ningún trabajo enviado a la POS-58.");
}
main().catch(()=>{
  console.error("BLOQUEADO: preflight QA no completado. No iniciar el agente ni imprimir.");
  process.exitCode=1;
});
