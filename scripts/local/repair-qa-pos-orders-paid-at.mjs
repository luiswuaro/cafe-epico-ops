/**
 * Reparación segura de QA: eliminar DEFAULT de public.pos_orders.paid_at.
 * --check: no modifica nada; --apply: DDL sólo en el PostgreSQL QA local.
 * Conserva la comanda de prueba anterior para auditoría (no altera filas).
 */
import postgres from "postgres";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";

function fail(message){throw Error("BLOQUEADO: "+message);}
const action=process.argv[2];
if(process.argv.length!==3||!["--check","--apply"].includes(action)){
 console.error("Uso: --check (solo lectura) o --apply (repara sólo columna QA)");
 process.exit(2);
}
const env=process.env;
const guard=validateLocalQaConfig(env);
if(!guard.ok||env.OPS_QA_MODE!=="true"||
  env.OPS_LOCAL_FIRST!=="true"||env.POS_LIVE_ENABLED!=="false"||
  env.DEFAULT_ORGANIZATION_SLUG!=="cafe-epico-qa"||
  env.DEFAULT_STORE_CODE!=="QA-TEPEXI")fail("Configuración ajena a QA.");
const url=new URL(env.DATABASE_URL);
if(url.hostname!=="127.0.0.1"||url.pathname!=="/postgres")
 fail("El destino debe ser PostgreSQL QA 127.0.0.1/postgres.");
const db=postgres(env.DATABASE_URL,{max:1,prepare:false,connect_timeout:5});

async function validate(tx){
 const identity=await tx.unsafe(
  "select current_database() db, current_setting('transaction_read_only') read_only");
 if(identity.length!==1||identity[0].db!=="postgres")fail("Base de datos desconocida.");
 const orgs=await tx.unsafe("select id,slug from public.organizations");
 const stores=await tx.unsafe("select id,organization_id,code from public.stores");
 if(orgs.length!==1||orgs[0].slug!=="cafe-epico-qa"||
   stores.length!==1||stores[0].code!=="QA-TEPEXI"||
   stores[0].organization_id!==orgs[0].id)fail("Se detectó organización o sucursal no QA.");
 const cols=await tx.unsafe(
  "select data_type,is_nullable,column_default from information_schema.columns "+
  "where table_schema='public' and table_name='pos_orders' and column_name='paid_at'");
 if(cols.length!==1||cols[0].data_type!=="timestamp with time zone"||
   cols[0].is_nullable!=="YES")fail("Definición de paid_at no reconocida.");
 return cols[0];
}

async function main(){
 try{
  const before=await validate(db);
  console.log("PASS: conexión local, única organización y sucursal QA; paid_at nullable.");
  console.log("DEFAULT_ACTUAL="+(before.column_default===null?"NINGUNO":"PRESENTE"));
  if(action==="--check"){
   console.log("SOLO LECTURA: la comanda antigua permanece intacta.");
   return;
  }
  if(before.column_default===null){
   console.log("PASS: paid_at ya no tiene DEFAULT. No hay cambios.");
   return;
  }
  await db.begin(async tx=>{
   // Revalidar dentro de la misma transacción antes de cambiar el esquema.
   const current=await validate(tx);
   if(current.column_default===null)return;
   await tx.unsafe("ALTER TABLE public.pos_orders ALTER COLUMN paid_at DROP DEFAULT");
   const updated=await validate(tx);
   if(updated.column_default!==null)fail("La base no confirmó el cambio.");
  });
  console.log("PASS: DEFAULT de paid_at retirado en PostgreSQL QA.");
  console.log("PASS: sin modificar pedidos, pagos, puntos, inventario ni auditorías.");
  console.log("La comanda anterior conserva su fecha: NO repetir --create-once.");
 }finally{await db.end({timeout:3});}
}
main().catch(error=>{
 const code=typeof error?.code==="string"&&/^[0-9A-Z]{5}$/.test(error.code)
  ?" SQLSTATE="+error.code:"";
 const detail=typeof error?.message==="string"&&error.message.startsWith("BLOQUEADO:")
  ?error.message:"Error SQL o de conexión (detalles privados ocultos).";
 console.error("BLOQUEADO"+code+": "+detail);
 process.exitCode=1;
});
