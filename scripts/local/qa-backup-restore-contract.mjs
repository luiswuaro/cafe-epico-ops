/**
 * Prueba de recuperación desde PostgreSQL 17 efímero de CI, jamás productivo.
 *
 * 1. Crea muestra QA con pedidos, puntos, cliente, pago, caja, Auth.
 * 2. Ejecuta pg_dump -> age sin volcado claro a disco.
 * 3. Verifica checksum age y TOC con inspector existente.
 * 4. Descifra directamente a pg_restore en otra BD (ci_restore).
 * 5. Compara conteos y sumas e integridad FK entre ambas bases.
 *
 * No crea ni lee medios del usuario, no restaura en postgres fuente.
 */
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createReadStream,readdirSync} from "node:fs";
import {mkdtemp,readFile,stat,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,basename} from "node:path";
import {pipeline} from "node:stream/promises";
import postgres from "postgres";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";

function gate(){
 const e=process.env;
 if(e.GITHUB_ACTIONS!=="true"||e.OPS_CI_DB_TEST!=="true"||
    e.OPS_LOCAL_FIRST!=="true"||e.OPS_QA_MODE!=="true")
   throw Error("Prueba restringida al contenedor sintético de GitHub Actions.");
 if(!validateLocalQaConfig(e).ok)throw Error("Origen no es QA.");
 const url=new URL(e.DATABASE_URL??"");
 if(url.hostname!=="127.0.0.1"||url.pathname!=="/postgres")
   throw Error("Sólo usar la base PostgreSQL temporal de CI.");
}
function proc(command,args,{env=process.env,stdio=["ignore","pipe","pipe"]}={}){
 const child=spawn(command,args,{env,stdio,windowsHide:true,
   signal:AbortSignal.timeout(45000)});
 const finished=new Promise((resolve,reject)=>{
   child.once("error",reject);
   child.once("close",c=>c===0?resolve():reject(Error(command+" falló con salida "+c)));
 });
 let diagnostic="";
 child.stderr?.on("data",chunk=>{
   // Deliberately cap stderr. Never print arbitrary SQL or secrets.
   if(diagnostic.length<1200)diagnostic+=String(chunk).slice(0,1200);
 });
 return {child,finished,getDiagnostic:()=>diagnostic};
}
async function execute(command,args,{env=process.env}={}){
 const {child,finished,getDiagnostic}=proc(command,args,{env});
 let value="";
 child.stdout?.on("data",c=>{value+=c;if(value.length>20000)child.kill();});
 try{await finished;}catch{
   const safe=getDiagnostic().split(/\r?\n/)
     .find(line=>/^BLOQUEADO:|^ERROR:|^pg_restore: error:|^age: error:/i.test(line.trim()));
   throw Error((command===process.execPath?"node":"subproceso")+
     " terminó sin éxito"+(safe?": "+safe.slice(0,180):""));
 }
 return value.trim();
}
async function recordFixture(db){
 const [org]=await db`select id from public.organizations where slug='cafe-epico-qa'`;
 const [store]=await db`select id from public.stores where organization_id=${org.id} and code='QA-TEPEXI'`;
 assert.ok(org?.id&&store?.id,"Organización QA no encontrada.");
 const [customer]=await db`insert into public.pos_customers
   (organization_id,name,points_balance,source_external_id)
   values (${org.id},'Cliente ficticio respaldo QA',22.50,'ci-backup-client')
   returning id`;
 const [order]=await db`insert into public.pos_orders
   (organization_id,store_id,client_order_id,folio,mode,status,service_mode,
    business_date,subtotal,total,customer_id,loyalty_points_preview)
   values (${org.id},${store.id},'ci-backup-order','QA-BACKUP-001','SHADOW',
    'PAID','TAKEAWAY','2026-10-17',70,70,${customer.id},3.5) returning id`;
 await db`insert into public.pos_order_lines
   (organization_id,order_id,catalog_external_id,name_snapshot,category_snapshot,
    unit_price,quantity,line_total)
   values (${org.id},${order.id},'qa-moka',
    'Moka fría ficticia','BEBIDAS',70,1,70)`;
 await db`insert into public.pos_payments
   (organization_id,order_id,method,amount,reference)
   values (${org.id},${order.id},'TRANSFER',70,'CI-ONLY')`;
 await db`insert into public.pos_loyalty_entries
   (organization_id,customer_id,order_id,entry_type,points,note)
   values (${org.id},${customer.id},${order.id},'EARN',3.50,'PRUEBA CI')`;
 await db`insert into public.pos_cash_sessions
   (organization_id,store_id,status,opening_cash)
   values (${org.id},${store.id},'CLOSED',100)`;
 await db`insert into public.operational_inventory_movements
   (organization_id,store_id,variant_external_id,item_name_snapshot,
    movement_type,quantity_delta_native,source_type,source_id,note)
   values (${org.id},${store.id},'qa-leche',
    'Leche ficticia','ADJUSTMENT',0.125,'CI','backup-ci','PRUEBA CI')`;
 await db`insert into public.operational_inventory_balances
   (organization_id,store_id,loyverse_store_external_id,variant_external_id,
    item_name_snapshot,quantity_native,source_quantity_native)
   values (${org.id},${store.id},'qa-store','qa-leche','Leche ficticia',8.125,8)`;
 await db`insert into auth.users default values`;
}
async function snapshot(db){
 const [row]=await db`
  select
    (select count(*)::int from public.organizations) as organizations,
    (select count(*)::int from public.stores) as stores,
    (select count(*)::int from public.pos_orders) as orders,
    (select coalesce(sum(total),0)::text from public.pos_orders) as order_total,
    (select count(*)::int from public.pos_order_lines) as lines,
    (select coalesce(sum(line_total),0)::text from public.pos_order_lines) as lines_total,
    (select count(*)::int from public.pos_payments) as payments,
    (select coalesce(sum(amount),0)::text from public.pos_payments) as payments_total,
    (select count(*)::int from public.pos_customers) as customers,
    (select coalesce(sum(points_balance),0)::text from public.pos_customers) as points,
    (select count(*)::int from public.pos_loyalty_entries) as points_movements,
    (select coalesce(sum(points),0)::text from public.pos_loyalty_entries) as points_delta,
    (select count(*)::int from public.pos_cash_sessions) as cash_sessions,
    (select count(*)::int from public.operational_inventory_balances) as stock,
    (select coalesce(sum(quantity_native),0)::text from public.operational_inventory_balances) as stock_units,
    (select count(*)::int from public.operational_inventory_movements) as stock_entries,
    (select coalesce(sum(quantity_delta_native),0)::text from public.operational_inventory_movements) as stock_delta,
    (select count(*)::int from auth.users) as auth_users,
    (select count(*)::int from public.ops_local_migrations) as migrations
  `;
 return row;
}
async function assertForeignKeys(db){
 const [data]=await db`
  select
   (select count(*)::int from public.pos_payments p left join public.pos_orders o on o.id=p.order_id where o.id is null) as orphan_payments,
   (select count(*)::int from public.pos_order_lines l left join public.pos_orders o on o.id=l.order_id where o.id is null) as orphan_lines,
   (select count(*)::int from public.pos_loyalty_entries l left join public.pos_customers c on c.id=l.customer_id where c.id is null) as orphan_points
 `;
 assert.deepEqual(data,{orphan_payments:0,orphan_lines:0,orphan_points:0});
}
let stage="inicializar";
function checkpoint(next){
 stage=next;
 console.log("CI recuperación: "+next);
}
async function main(){
 gate();
 const mainDb=postgres(process.env.DATABASE_URL,{max:1,prepare:false});
 const root=await mkdtemp(join(tmpdir(),"ops-local-backup-ci-"));
 const archiveDir=join(root,"encrypted");
 const keyPath=join(root,"identity.txt");
 const restoreUrl=new URL(process.env.DATABASE_URL);
 restoreUrl.pathname="/ci_restore";
 let restorationStarted=false;
 try{
   checkpoint("crear_muestra");
   await recordFixture(mainDb);
   const original=await snapshot(mainDb);
   checkpoint("crear_claves_efimeras");
   const identity=await execute("age-keygen",["-o",keyPath]);
   void identity;
   const publicKey=await execute("age-keygen",["-y",keyPath]);
   assert.match(publicKey,/^age1[a-z0-9]{30,}$/);
   const env={...process.env,OPS_BACKUP_AGE_RECIPIENT:publicKey,
     OPS_BACKUP_DESTINATION:archiveDir};
   checkpoint("cifrar_pg_dump");
   await execute(process.execPath,["scripts/local/backup-ops-local.mjs"],{env});
   const archives=readdirSync(archiveDir).filter(name=>name.endsWith(".pgcustom.age"));
   assert.equal(archives.length,1,"Debe existir exactamente un archivo cifrado.");
   const file=join(archiveDir,archives[0]);
   const manifest=await readFile(file+".manifest.txt","utf8");
   assert.match(manifest,/restore_tested=no/);
   const size=(await stat(file)).size;
   assert.ok(size>256,"Backup age vacío.");
   checkpoint("inspeccionar_age_toc");
   await execute(process.execPath,["scripts/local/inspect-ops-local-backup.mjs"],{
     env:{...env,OPS_BACKUP_ARCHIVE:file,OPS_BACKUP_AGE_IDENTITY:keyPath},
   });
   const [exists]=await mainDb`select 1 from pg_database where datname='ci_restore'`;
   assert.equal(exists,undefined,"Nunca sobrescribir la DB de restauración.");
   checkpoint("crear_base_destino");
   await mainDb.unsafe("create database ci_restore");
   restorationStarted=true;
   // Pasamos flujo desencriptado directamente a pg_restore, sin dump claro
   // en el disco. ci_restore es otra DB del contenedor desechable de CI.
   checkpoint("restaurar_pg_restore");
   const age=proc("age",["--decrypt","--identity",keyPath,file]);
   const restore=proc("pg_restore",[
     "--clean","--if-exists","--no-owner","--no-acl","--exit-on-error",
     "--dbname="+restoreUrl.href,
   ],{stdio:["pipe","ignore","pipe"]});
   const outcomes=await Promise.allSettled([
     age.finished,restore.finished,pipeline(age.child.stdout,restore.child.stdin),
   ]);
   if(outcomes.some(x=>x.status!=="fulfilled")){
     const names=["age","pg_restore","tubería"];
     const states=outcomes.map((item,i)=>names[i]+":"+
       (item.status==="fulfilled"?"OK":
         (item.reason?.name==="AbortError"?"TIMEOUT":
           (item.reason?.code||item.reason?.name||"ERROR"))));
     const restoreError=restore.getDiagnostic().split(/\\r?\\n/)
       .find(line=>/^pg_restore: error:/.test(line.trim()));
     // CI usa datos sintéticos. No imprimir URLs ni parámetros de conexión.
     console.error("CI restauración: "+states.join(", ")+
       (restoreError?"; "+restoreError.replace(/postgres(?:ql)?:\\/\\/[^\\s]+/ig,"[DB]").slice(0,140):""));
     throw Error("pg_restore no terminó correctamente.");
   }
   const secondary=postgres(restoreUrl.href,{max:1,prepare:false});
   try{
     checkpoint("conciliar_datos");
     const recovered=await snapshot(secondary);
     assert.deepEqual(recovered,original,
       "Los importes, puntos, movimientos o usuarios difieren tras restaurar.");
     await assertForeignKeys(secondary);
     console.log("PASS: AGE -> pg_restore aislado, todos los registros e importes coinciden.");
     console.log("PASS: usuarios Auth, pagos, cliente, puntos, inventario, caja y SHA-256.");
     console.log("CI: prueba lógica de recuperación con datos ficticios; no validación física de disco ni archivos Storage.");
   }finally{await secondary.end({timeout:3});}
 }finally{
   if(restorationStarted){
     try{await mainDb.unsafe("drop database if exists ci_restore with (force)")}catch{}
   }
   await mainDb.end({timeout:3});
   await rm(root,{recursive:true,force:true});
 }
}
main().catch(error=>{
 // No imprimir URLs, contraseñas ni trazas. Sólo fase y código PostgreSQL.
 const code=typeof error?.code==="string"?error.code.slice(0,12):"sin_codigo";
 const reason=String(error?.message??"").replace(/postgres(?:ql)?:\/\/[^\s]+/ig,"[DB]").slice(0,220);
 console.error("ERROR: recuperación QA bloqueada en "+stage+" ("+code+"): "+reason);
 process.exitCode=1;
});
