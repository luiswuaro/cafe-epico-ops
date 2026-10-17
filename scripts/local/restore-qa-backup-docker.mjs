/**
 * Recuperación QA estrictamente aislada. age -> Docker pg_restore en flujo
 * binario nativo Node, sin canalizaciones Windows PowerShell 5.1 ni dump claro.
 * Debe usarse sólo con la base VACÍA cafe_epico_restore_qa.
 */
import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {readFile,stat} from "node:fs/promises";
import {resolve,basename} from "node:path";
import {spawn} from "node:child_process";
import {pipeline} from "node:stream/promises";
import assert from "node:assert/strict";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";

const TARGET="cafe-epico-restore-supabase";
const DATABASE="cafe_epico_restore_qa";
const SOURCE="supabase-db";
const EXPECTED_EXTENSIONS=[
  "pg_net|extensions|0.20.3",
  "pg_stat_statements|extensions|1.11",
  "pgcrypto|extensions|1.3",
  "plpgsql|pg_catalog|1.0",
  "supabase_vault|vault|0.3.1",
  "uuid-ossp|extensions|1.1",
];

const snapshotSQL=[
"select row_to_json(q)::text from (select",
"(select count(*)::int from public.organizations) as organizations,",
"(select count(*)::int from public.stores) as stores,",
"(select count(*)::int from public.pos_orders) as orders,",
"(select coalesce(sum(total),0)::text from public.pos_orders) as order_total,",
"(select count(*)::int from public.pos_order_lines) as lines,",
"(select coalesce(sum(line_total),0)::text from public.pos_order_lines) as lines_total,",
"(select count(*)::int from public.pos_payments) as payments,",
"(select coalesce(sum(amount),0)::text from public.pos_payments) as payments_total,",
"(select count(*)::int from public.pos_customers) as customers,",
"(select coalesce(sum(points_balance),0)::text from public.pos_customers) as points,",
"(select count(*)::int from public.pos_loyalty_entries) as points_movements,",
"(select coalesce(sum(points),0)::text from public.pos_loyalty_entries) as points_delta,",
"(select count(*)::int from public.pos_cash_sessions) as cash_sessions,",
"(select count(*)::int from public.operational_inventory_balances) as stock,",
"(select coalesce(sum(quantity_native),0)::text from public.operational_inventory_balances) as stock_units,",
"(select count(*)::int from public.operational_inventory_movements) as stock_entries,",
"(select coalesce(sum(quantity_delta_native),0)::text from public.operational_inventory_movements) as stock_delta,",
"(select count(*)::int from auth.users) as auth_users,",
"(select count(*)::int from public.ops_local_migrations) as migrations",
") q"].join(" ");
const orphanSQL=[
"select",
"(select count(*)::int from public.pos_payments p left join public.pos_orders o on o.id=p.order_id where o.id is null) +",
"(select count(*)::int from public.pos_order_lines l left join public.pos_orders o on o.id=l.order_id where o.id is null) +",
"(select count(*)::int from public.pos_loyalty_entries l left join public.pos_customers c on c.id=l.customer_id where c.id is null)"
].join(" ");

function run(command,args,options={}){
 const {input="ignore",output="pipe",capture=true}=options;
 const child=spawn(command,args,{windowsHide:true,stdio:[input,output,"pipe"]});
 let stdout="",stderr="";
 if(capture)child.stdout?.on("data",bytes=>{if(stdout.length<120000) stdout+=String(bytes);});
 child.stderr?.on("data",bytes=>{stderr=(stderr+String(bytes)).slice(-24000);});
 const done=new Promise((ok,bad)=>{
   child.once("error",bad);
   child.once("close",code=>{
     if(code===0){ok(stdout.trim());return;}
     const lines=stderr.split(/\r?\n/).map(x=>x.trim());
     const line=lines.find(x=>/^(?:pg_restore: error:|ERROR:|Error:)/i.test(x));
     // Sólo nombres de objetos y clase de error; no imprimir SQL, URLs o datos.
     const operations=lines.filter(x=>/^pg_restore: (?:creating|processing|restoring|executing|dropping) /i.test(x));
     const lastOperation=operations.at(-1);
     const detail=lines.find(x=>/^ERROR:\s+(?:schema|relation|type|function|permission|role|extension|duplicate|could not|invalid)/i.test(x));
     bad(Error(command+" terminó con código "+code+
       (lastOperation?"; objeto="+lastOperation.slice(0,130):"")+
       (detail?"; detalle="+detail.slice(0,150):"")+
       (line?"; "+line.slice(0,100):"")));
   });
 });
 return {child,done};
}
const cmd=(name,args)=>run(name,args).done;
const docker=(args)=>cmd("docker",args);
async function query(container,database,sql){
 return docker(["exec",container,"psql","-X","-U","postgres","-d",database,
   "-A","-t","-v","ON_ERROR_STOP=1","-c",sql]);
}
async function sha256(file){
 const hash=createHash("sha256");
 for await(const chunk of createReadStream(file))hash.update(chunk);
 return hash.digest("hex");
}
function verifyEnvironment(){
 const e=process.env,guard=validateLocalQaConfig(e);
 assert(guard.ok, "Configuración QA inválida: "+guard.errors.join("; "));
 assert(e.OPS_QA_MODE==="true"&&e.OPS_LOCAL_FIRST==="true"&&
   e.POS_LIVE_ENABLED==="false", "Ventas LIVE deben permanecer deshabilitadas.");
 const u=new URL(e.DATABASE_URL);
 assert(u.hostname==="127.0.0.1"&&u.pathname==="/postgres",
   "Origen debe ser PostgreSQL loopback QA.");
}
async function verifyTarget(){
 const [image,network,ports,mountsText]=await Promise.all([
  docker(["inspect",TARGET,"--format","{{.Config.Image}}"]),
  docker(["inspect",TARGET,"--format","{{.HostConfig.NetworkMode}}"]),
  docker(["inspect",TARGET,"--format","{{json .HostConfig.PortBindings}}"]),
  docker(["inspect",TARGET,"--format","{{json .Mounts}}"])
 ]);
 assert.equal(image,"supabase/postgres:17.6.1.136","Imagen de recuperación desconocida.");
 assert.equal(network,"none","El destino debe tener red deshabilitada.");
 assert(ports==="null"||ports==="{}","El destino publica puertos.");
 const mounts=JSON.parse(mountsText);
 assert(mounts.length===1&&mounts[0].Type==="volume"&&
   mounts[0].Name==="cafe_epico_restore_supabase_data"&&
   mounts[0].Destination==="/var/lib/postgresql/data",
   "Volumen exclusivo de recuperación no verificado.");
 assert.equal(await query(TARGET,DATABASE,"select current_database()"),DATABASE);
 const tables=await query(TARGET,DATABASE,
  "select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace "+
  "where n.nspname in ('public','auth','storage') and c.relkind in ('r','p')");
 assert.equal(tables,"0","Destino contiene tablas: detener y examinar antes de repetir.");
 const exts=await query(TARGET,DATABASE,
  "select e.extname||'|'||n.nspname||'|'||e.extversion from pg_extension e "+
  "join pg_namespace n on n.oid=e.extnamespace order by e.extname");
 assert.deepEqual(exts.split(/\r?\n/),EXPECTED_EXTENSIONS,
  "Versiones o esquemas de extensiones distintos.");
 const org=await query(SOURCE,"postgres","select slug from public.organizations order by slug");
 assert.equal(org,"cafe-epico-qa","No es la organización QA sintética.");
}
async function verifyArchive(){
 const fileArg=process.env.OPS_BACKUP_ARCHIVE;
 const identityArg=process.env.OPS_BACKUP_AGE_IDENTITY;
 assert(fileArg&&fileArg.endsWith(".pgcustom.age")&&identityArg,
   "Configurar OPS_BACKUP_ARCHIVE y OPS_BACKUP_AGE_IDENTITY.");
 const file=resolve(fileArg),identity=resolve(identityArg);
 const manifest=await readFile(file+".manifest.txt","utf8");
 const properties=Object.fromEntries(manifest.trim().split(/\r?\n/).map(line=>{
   const i=line.indexOf("=");return [line.slice(0,i),line.slice(i+1)];
 }));
 assert.equal(properties.format,"pg_dump_custom_encrypted_age_v1");
 assert.equal(properties.encrypted_file,basename(file));
 assert.equal(properties.schemas,"public,auth,storage");
 assert.match(properties.sha256??"",/^[a-f0-9]{64}$/);
 assert.equal(Number(properties.encrypted_bytes),(await stat(file)).size);
 assert.equal(await sha256(file),properties.sha256,"SHA-256 del archivo no coincide.");
 const audit=await cmd(process.execPath,["scripts/local/inspect-ops-local-backup.mjs"]);
 assert(audit.includes("PASS: SHA-256"),"Inspector no aprobó el respaldo.");
 return {file,identity};
}
async function restore(archive){
 const age=run("age",["--decrypt","--identity",archive.identity,archive.file],{capture:false});
 // La base destino YA fue comprobada vacía: --clean provocaba DROP de
 // tablas en storage antes de existir ese esquema (PostgreSQL 3F000).
 // Restaurar sin limpieza; --single-transaction revierte cualquier fallo.
 const pg=run("docker",["exec","-i",TARGET,"pg_restore",
  "--no-owner","--no-acl",
  "--single-transaction","--exit-on-error","--verbose",
  "--username=postgres","--dbname="+DATABASE],{input:"pipe",output:"ignore"});
 const outcomes=await Promise.allSettled([
  age.done,pg.done,pipeline(age.child.stdout,pg.child.stdin)
 ]);
 const failed=outcomes.filter(x=>x.status==="rejected");
 if(failed.length)throw Error("Flujo age/pg_restore falló: "+
   failed.map(x=>String(x.reason?.message??"error").slice(0,180)).join("; "));
}
async function main(){
 verifyEnvironment();
 console.log("QA RESTORE: verificando aislamiento y base vacía...");
 await verifyTarget();
 console.log("QA RESTORE: comprobando manifiesto, SHA-256 y archivo age...");
 const archive=await verifyArchive();
 const original=JSON.parse(await query(SOURCE,"postgres",snapshotSQL));
 console.log("PASS: destino aislado, origen QA y respaldo íntegro.");
 console.log("QA RESTORE: restaurando en "+DATABASE+"...");
 await restore(archive);
 console.log("QA RESTORE: comparando saldos y conteos...");
 const recovered=JSON.parse(await query(TARGET,DATABASE,snapshotSQL));
 const differences=Object.keys(original).filter(k=>
   String(original[k])!==String(recovered[k]));
 assert.deepEqual(differences,[],"Diferencias encontradas: "+differences.join(", ")+
   ". El origen pudo haber cambiado después del respaldo.");
 assert.equal(await query(TARGET,DATABASE,orphanSQL),"0",
   "Existen pagos, líneas o puntos sin registros padre.");
 console.log("PASS: archivo age restaurado en PostgreSQL Supabase independiente.");
 console.log("PASS: conteos, pagos, montos, puntos, inventario, Auth y migraciones coinciden.");
 console.log("PASS: no se detectaron referencias huérfanas en relaciones críticas.");
 console.log("PENDIENTE: acceso Auth real, permisos, archivos Storage y prueba de otro equipo.");
}
main().catch(error=>{
 const msg=String(error?.message??"error")
  .replace(/postgres(?:ql)?:\/\/\S+/ig,"[DB]").slice(0,550);
 console.error("BLOQUEADO QA RESTORE: "+msg);
 process.exitCode=1;
});