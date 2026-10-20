/** Auditoría sólo lectura de todas las comandas de la sesión POS QA activa. */
import postgres from "postgres";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";
const env=process.env,check=validateLocalQaConfig(env);
const runId=env.OPS_QA_POS_PRINT_PILOT_RUN_ID?.trim()??"";
if(runId&&!/^R[0-9]{8}[A-Z0-9]{2}$/.test(runId))
 throw Error("BLOQUEADO: identificador de sesión QA inválido.");
const limitRaw=env.OPS_QA_POS_PRINT_PILOT_MAX_ORDERS??"1";
if(!/^(?:[1-9]|10)$/.test(limitRaw)||(Number(limitRaw)>1&&!runId))
 throw Error("BLOQUEADO: límite de órdenes QA inválido.");
const maxOrders=Number(limitRaw);
const pilotLike=runId?"QA-POS-PILOT-"+runId+"-%":"QA-POS-PILOT-%";
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
   "from public.pos_orders where organization_id=$1 and store_id=$2 and folio like $3 order by created_at",
   [orgs[0].id,stores[0].id,pilotLike]);
  console.log("SESION="+(runId||"PILOTO ORIGINAL")+" COMANDAS="+orders.length+" LIMITE="+maxOrders);
  if(orders.length>maxOrders)throw Error("BLOQUEADO: se excedió el límite de la sesión QA.");
  if(!orders.length){console.log("PENDIENTE: ninguna comanda en esta sesión QA.");return;}
  let claimed=0,done=0,failed=0,expired=0;
  for(const o of orders){
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
   const claim=count("POS_PRINT_HUB_CLAIMED"),finish=count("POS_PRINT_HUB_DONE");
   const fail=count("POS_PRINT_HUB_FAILED"),expire=count("POS_PRINT_HUB_EXPIRED");
   console.log("FOLIO="+o.folio+" TOTAL="+o.total+" MODO="+o.mode+" ESTADO="+o.status);
   console.log("CLAIM="+claim+" DONE="+finish+" FAILED="+fail+" EXPIRED="+expire+" ACK="+ack[0].n);
   console.log("PAGOS="+paid[0].n+" PUNTOS="+points[0].n+
    " PAID_AT_NULL="+(o.paid_at===null)+
    " INVENTARIO_INTACTO="+(o.inventory_effect_applied===false)+
    " PUNTOS_INTACTOS="+(o.loyalty_effect_applied===false));
   if(paid[0].n!==0||points[0].n!==0||o.mode!=="SHADOW"||o.status!=="SENT"||
      o.paid_at!==null||o.inventory_effect_applied||o.loyalty_effect_applied||
      claim>1||finish>1)
    throw Error("BLOQUEADO: integridad o deduplicación anómala en sesión QA.");
   claimed+=claim;done+=finish;failed+=fail;expired+=expire;
  }
  console.log("TOTALES: CLAIM="+claimed+" DONE="+done+" FAILED="+failed+" EXPIRED="+expired);
  console.log("PASS: piloto sin pagos, puntos ni movimientos de inventario.");
 }finally{await db.end({timeout:3});}
}
main().catch(e=>{
 console.error(e?.message?.startsWith("BLOQUEADO:")?e.message:
  "BLOQUEADO: error de lectura QA. Consultar logs privados.");
 process.exitCode=1;
});
