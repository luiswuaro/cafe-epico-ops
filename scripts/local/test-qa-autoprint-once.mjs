/**
 * Prueba E2E de comanda automática: orden SHADOW de $0 SOLO QA.
 * --check: inspección sin escrituras | --create-once: inserción única
 * --status: auditar CLAIM/DONE/FAILED y confirmar ausencia de pagos.
 * No hay impresión directa: el agente real recibe y confirma la comanda.
 */
import postgres from "postgres";
import {randomUUID} from "node:crypto";
import {open,mkdir,stat} from "node:fs/promises";
import {resolve,join} from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";

const env=process.env;
const root=resolve(fileURLToPath(new URL("../..",import.meta.url)));
const markerRel=".local/qa-autoprint-e2e.once";
const marker=join(root,markerRel);
const note="QA_PRINT_SMOKE_TEST_ONLY";
let diagnosticStage="validar configuración QA";
function fail(msg){throw Error("BLOQUEADO: "+msg);}
function checkEnvironment(){
 const action=process.argv[2];
 if(process.argv.length!==3||!["--check","--create-once","--status"].includes(action))
   fail("Modo inválido.");
 if(!validateLocalQaConfig(env).ok||env.OPS_LOCAL_FIRST!=="true"||
    env.DEFAULT_STORE_CODE!=="QA-TEPEXI"||env.POS_LIVE_ENABLED!=="false"||
    env.NEXT_PUBLIC_OPS_LOCAL_PRINT_AGENT_ENABLED!=="true"||
    env.OPS_LOCAL_TICKET_PRINTER_PORT!=="9137")fail("No es QA aislado.");
 const dbUrl=new URL(env.DATABASE_URL);
 if(!["localhost","127.0.0.1","::1"].includes(dbUrl.hostname))
   fail("PostgreSQL no es loopback.");
 try{
  execFileSync("git",["check-ignore","-q","--",markerRel],{cwd:root,stdio:"ignore"});
 }catch{fail("La reserva no está excluida de Git.");}
 return action;
}
async function inspect(db,org,store){
 diagnosticStage="consultar comanda QA";
 const orders=await db.unsafe(
  "select id,folio,mode,status,total,paid_at,inventory_effect_applied,loyalty_effect_applied from public.pos_orders where organization_id=$1 and store_id=$2 and note=$3 and folio like 'QA-PRINT-%' order by created_at desc limit 3",
  [org,store,note]);
 if(orders.length>1)fail("Varias órdenes QA: revisar manualmente.");
 if(orders.length===0){
  console.log("PENDIENTE: todavía no hay comanda E2E QA.");
  return false;
 }
 diagnosticStage="verificar integridad de comanda QA";
 const o=orders[0];
 if(o.mode!=="SHADOW"||o.status!=="SENT"||Number(o.total)!==0||
   o.paid_at!==null||o.inventory_effect_applied||o.loyalty_effect_applied)
   fail("Comanda fuera del contrato $0: "+
     "SHADOW="+(o.mode==="SHADOW")+"; SENT="+(o.status==="SENT")+
     "; importe_cero="+(Number(o.total)===0)+"; sin_cobro="+(o.paid_at===null)+
     "; sin_inventario="+(o.inventory_effect_applied===false)+
     "; sin_puntos="+(o.loyalty_effect_applied===false));
 diagnosticStage="consultar auditoria CLAIM/DONE/FAILED";
 const key="KITCHEN:"+o.id+":QA_ONE_SHOT";
 const events=await db.unsafe(
  "select action from public.audit_events where organization_id=$1 and store_id=$2 and entity_type='pos_print_job' and entity_id=$3 order by created_at",
  [org,store,key]);
 diagnosticStage="verificar ausencia de pagos";
 const paid=await db.unsafe(
  "select count(*)::int n from public.pos_payments where organization_id=$1 and order_id=$2",
  [org,o.id]);
 diagnosticStage="verificar ausencia de puntos";
 const points=await db.unsafe(
  "select count(*)::int n from public.pos_loyalty_entries where organization_id=$1 and order_id=$2",
  [org,o.id]);
 diagnosticStage="comprobar deduplicacion e integridad";
 const n=action=>events.filter(e=>e.action===action).length;
 console.log("COMANDA SHADOW QA: "+o.folio+" / $0.00");
 console.log("CLAIM="+n("POS_PRINT_HUB_CLAIMED")+
  " DONE="+n("POS_PRINT_HUB_DONE")+
  " FAILED="+n("POS_PRINT_HUB_FAILED")+
  " EXPIRED="+n("POS_PRINT_HUB_EXPIRED"));
 console.log("PAGOS="+paid[0].n+" PUNTOS="+points[0].n);
 if(paid[0].n!==0||points[0].n!==0||
    n("POS_PRINT_HUB_CLAIMED")>1||n("POS_PRINT_HUB_DONE")>1)
   fail("Anomalía en integridad o deduplicación.");
 if(n("POS_PRINT_HUB_DONE")===1)
   console.log("PASS: la cola reporta UNA confirmación de impresión.");
 else if(n("POS_PRINT_HUB_CLAIMED")>0)
   console.log("PENDIENTE: reclamada pero sin DONE; revisar papel y NO reintentar.");
 else console.log("PENDIENTE: agente todavía no la ha reclamado; solo 5 minutos de vigencia.");
 return true;
}
async function main(){
 const action=checkEnvironment();
 const db=postgres(env.DATABASE_URL,{max:1,prepare:false,connect_timeout:5});
 try{
  diagnosticStage="comprobar organizacion QA";
  const orgs=await db.unsafe("select id,slug from public.organizations");
  diagnosticStage="comprobar sucursal QA";
  const stores=await db.unsafe("select id,organization_id,code from public.stores");
  if(orgs.length!==1||orgs[0].slug!=="cafe-epico-qa"||
     stores.length!==1||stores[0].code!=="QA-TEPEXI"||
     stores[0].organization_id!==orgs[0].id)fail("Organización/sucursal no QA.");
  const org=orgs[0].id,store=stores[0].id;
  if(action==="--status"){await inspect(db,org,store);return;}
  const heart=await db.unsafe(
   "select bridge_ready,last_seen from public.pos_print_station_status where organization_id=$1 and store_id=$2",
   [org,store]);
  if(heart.length!==1||heart[0].bridge_ready!==true||
     Date.now()-new Date(heart[0].last_seen).getTime()>55000)
    fail("Agente sin pulso reciente o impresora no lista.");
  const token=env.OPS_LOCAL_TICKET_PRINTER_TOKEN;
  if(typeof token!=="string"||token.length<32)fail("Puente sin token.");
  const res=await fetch("http://127.0.0.1:9137/status",{
   headers:{"X-Cafe-Epico-Token":token},signal:AbortSignal.timeout(3500)
  });
  const physical=await res.json().catch(()=>({}));
  if(!res.ok||physical.ok!==true||physical.mode!=="RAW_ESC_POS"||
     physical.rasterBands!==true||physical.printer!=="POS-58 (copy 1)")
    fail("Puente físico no listo.");
  console.log("PASS: QA exclusivo, agente con pulso reciente, POS-58 USB disponible.");
  const existing=await inspect(db,org,store);
  const marked=await stat(marker).then(()=>true).catch(()=>false);
  if(existing||marked){
   console.log("PENDIENTE: prueba ya registrada/reservada. Consultar solo --status.");
   if(action==="--create-once")fail("Bloqueo anti-duplicados.");
   return;
  }
  if(action==="--check"){
   console.log("PASS: chequeo sin escrituras ni papel. Preparado para --create-once.");
   return;
  }
  await mkdir(join(root,".local"),{recursive:true});
  // Reservar antes del INSERT. Si hubiera caída, revisar --status.
  const lock=await open(marker,"wx",0o600).catch(()=>fail("Reserva ya existente."));
  try{await lock.writeFile("Prueba QA E2E reservada. Revisar --status antes de cualquier acción.\n");
      await lock.sync();}
  finally{await lock.close();}
  const id=randomUUID(),folio="QA-PRINT-"+id.slice(0,8).toUpperCase();
  const parts=Object.fromEntries(new Intl.DateTimeFormat("en-US",{
   timeZone:"America/Mexico_City",year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(new Date()).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
  const date=[parts.year,parts.month,parts.day].join("-");
  await db.begin(async tx=>{
   const existing=await tx.unsafe(
    "select id from public.pos_orders where organization_id=$1 and store_id=$2 and note=$3 and folio like 'QA-PRINT-%' limit 1",
    [org,store,note]);
   if(existing.length)fail("Orden QA preexistente.");
   const rows=await tx.unsafe(
    "insert into public.pos_orders (id,organization_id,store_id,client_order_id,folio,mode,status,service_mode,table_label,business_date,subtotal,total,note,inventory_effect_applied,loyalty_effect_applied) values ($1,$2,$3,$4,$5,'SHADOW','SENT','DINE_IN','MESA PRUEBA',$6,0,0,$7,false,false) returning id",
    [id,org,store,"qa-e2e-"+id,folio,date,note]);
   if(rows.length!==1)fail("No se insertó orden QA.");
   await tx.unsafe(
    "insert into public.pos_order_lines (organization_id,order_id,catalog_external_id,name_snapshot,category_snapshot,unit_price,quantity,line_total,note,expected_consumption) values ($1,$2,$3,'COMANDA DE PRUEBA','CALIENTES',0,1,0,'NO PREPARAR NI COBRAR',$4::jsonb)",
    [org,id,"qa-e2e-"+id,JSON.stringify({roundId:"QA_ONE_SHOT",serviceMode:"DINE_IN"})]);
  });
  console.log("PASS: comanda SHADOW $0.00 creada sin pago, puntos ni consumo.");
  console.log("FOLIO: "+folio);
  console.log("Agente seguirá flujo POLL -> CLAIM -> ESC/POS -> DONE.");
  console.log("No repetir --create-once. Consultar --status para resultado.");
 }finally{await db.end({timeout:3});}
}
main().catch(error=>{
 // Mostrar sólo etapa, código SQL y violaciones redactadas por este script.
 // Nunca volcar el objeto postgres.js: podría contener query o conexión.
 const sqlCode=typeof error?.code==="string"&&/^[0-9A-Z]{5}$/.test(error.code)
   ?" SQLSTATE="+error.code:"";
 const detail=typeof error?.message==="string"&&error.message.startsWith("BLOQUEADO:")
   ?" "+error.message:" Error no clasificado (detalles internos ocultos)";
 console.error("DIAGNOSTICO QA ["+diagnosticStage+"]"+sqlCode+":"+detail);
 console.error("BLOQUEADO/RESULTADO INCIERTO: no repetir --create-once; solo consultas --status.");
 process.exitCode=1;
});