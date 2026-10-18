/** Estado de la única comanda piloto creada desde POS QA. SOLO LECTURA. */
import postgres from "postgres";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";
const env=process.env,check=validateLocalQaConfig(env);
if(!check.ok||env.POS_LIVE_ENABLED!=="false"||env.DEFAULT_STORE_CODE!=="QA-TEPEXI")
 throw Error("BLOQUEADO: sólo consultar PostgreSQL QA.");
const url=new URL(env.DATABASE_URL);
if(url.hostname!=="127.0.0.1"||url.pathname!=="/postgres")
 throw Error("BLOQUEADO: destino de base QA inesperado.");
const db=postgres(env.DATABASE_URL,{max:1,prepare:false,connect_timeout:5});
async function main(){
 try{
  const orgs=await db.unsafe("select id from public.organizations where slug='cafe-epico-qa'");
  const stores=await db.unsafe("select id,organization_id from public.stores where code='QA-TEPEXI'");
  if(orgs.length!==1||stores.length!==1||stores[0].organization_id!==orgs[0].id)
   throw Error("BLOQUEADO: organización/sucursal no exclusiva QA.");
  const orders=await db.unsafe(
   "select id,folio,mode,status,total,paid_at,inventory_effect_applied,loyalty_effect_applied "+
   "from public.pos_orders where organization_id=$1 and store_id=$2 and folio like 'QA-POS-PILOT-%'",
   [orgs[0].id,stores[0].id]);
  if(orders.length>1)throw Error("BLOQUEADO: existe más de un piloto.");
  if(!orders.length){console.log("PENDIENTE: aún no se creó una comanda piloto desde POS.");return;}
  const o=orders[0];
  const events=await db.unsafe(
   "select action,count(*)::int n from public.audit_events where "+
   "organization_id=$1 and store_id=$2 and entity_type='pos_print_job' "+
   "and entity_id like $3 group by action",
   [orgs[0].id,stores[0].id,"KITCHEN:"+o.id+":%"]);
  const paid=await db.unsafe("select count(*)::int n from public.pos_payments where order_id=$1",[o.id]);
  const points=await db.unsafe("select count(*)::int n from public.pos_loyalty_entries where order_id=$1",[o.id]);
  const ack=await db.unsafe(
   "select count(*)::int n from public.audit_events where organization_id=$1 "+
   "and entity_type='pos_order' and entity_id=$2 and action='POS_COMMAND_PRINT_ACKNOWLEDGED'",
   [orgs[0].id,o.id]);
  const count=action=>events.find(x=>x.action===action)?.n??0;
  console.log("FOLIO="+o.folio+" TOTAL="+o.total+" MODO="+o.mode+" ESTADO="+o.status);
  console.log("CLAIM="+count("POS_PRINT_HUB_CLAIMED")+
   " DONE="+count("POS_PRINT_HUB_DONE")+
   " FAILED="+count("POS_PRINT_HUB_FAILED")+
   " EXPIRED="+count("POS_PRINT_HUB_EXPIRED")+
   " ACK="+ack[0].n);
  console.log("PAGOS="+paid[0].n+" PUNTOS="+points[0].n+
   " PAID_AT_NULL="+(o.paid_at===null)+
   " INVENTARIO_INTACTO="+(o.inventory_effect_applied===false)+
   " PUNTOS_INTACTOS="+(o.loyalty_effect_applied===false));
  if(paid[0].n!==0||points[0].n!==0||o.mode!=="SHADOW"||o.paid_at!==null||
     o.inventory_effect_applied||o.loyalty_effect_applied)
   throw Error("BLOQUEADO: el piloto presenta efectos comerciales inesperados.");
  console.log("PASS: piloto sin efectos financieros ni de inventario.");
 }finally{await db.end({timeout:3});}
}
main().catch(e=>{
 console.error(e?.message?.startsWith("BLOQUEADO:")?e.message:
  "BLOQUEADO: error de consulta QA. Revisar consola del servidor sin mostrar credenciales.");
 process.exitCode=1;
});
