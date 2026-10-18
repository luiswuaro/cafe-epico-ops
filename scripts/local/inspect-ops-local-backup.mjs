/**
 * Lee un respaldo de OPS local sin persistir la copia descifrada.
 * SHA-256 + age decrypt -> pg_restore --list (TOC). Sigue pendiente
 * restaurar en una segunda base aislada para certificar recuperación.
 */
import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {readFile} from "node:fs/promises";

import {resolve} from "node:path";

function finished(process){
 return new Promise(resolve=>{
  process.once("error",()=>resolve(-1));
  process.once("close",code=>resolve(code??-1));
 });
}
async function sha256(file){
 const hash=createHash("sha256");
 for await(const chunk of createReadStream(file))hash.update(chunk);
 return hash.digest("hex");
}
async function inspect(){
 const archive=process.env.OPS_BACKUP_ARCHIVE;
 const key=process.env.OPS_BACKUP_AGE_IDENTITY;
 if(!archive||!key||!archive.endsWith(".pgcustom.age"))
  throw Error("Falta archivo de respaldo cifrado o archivo privado de identidad age.");
 const file=resolve(archive);
 const manifest=await readFile(file+".manifest.txt","utf8");
 const rows=Object.fromEntries(manifest.split(/\r?\n/).filter(Boolean).map(row=>{
   const at=row.indexOf("=");return at<1?["",""]:[row.slice(0,at),row.slice(at+1)];
 }));
 if(rows.format!=="pg_dump_custom_encrypted_age_v1" ||
    rows.encrypted_file!==file.split(/[\\/]/).pop() ||
    !/^[a-f0-9]{64}$/.test(rows.sha256??""))
   throw Error("Manifiesto no reconocido o incompleto.");
 if((await sha256(file))!==rows.sha256)throw Error("SHA-256 no coincide: respaldo alterado.");
 const age=spawn("age",["--decrypt","--identity",resolve(key),file],{
   stdio:["ignore","pipe","ignore"],windowsHide:true,
 });
 const restore=spawn("pg_restore",["--list"],{
   stdio:["pipe","pipe","ignore"],windowsHide:true,
 });
 let toc="";
 restore.stdout.setEncoding("utf8");
 restore.stdout.on("data",chunk=>{
   if(toc.length<2_000_000)toc+=chunk;
 });
 // pg_restore --list necesita leer el índice, pero puede cerrar stdin
 // ANTES de consumir el archivo completo. No es un error de integridad.
 // Debemos seguir drenando TODO age.stdout hasta EOF para comprobar el tag
 // de autenticación del respaldo cifrado; jamás escribimos texto plano.
 let writerOpen=true;
 let writerError=null;
 restore.stdin.on("error",error=>{
   if(error?.code!=="EPIPE"&&error?.code!=="ERR_STREAM_DESTROYED")
     writerError=error;
   writerOpen=false;
 });
 restore.stdin.on("close",()=>{writerOpen=false});
 async function consumeEntireArchive(){
   for await (const block of age.stdout){
     if(!writerOpen)continue;
     try{
       if(!restore.stdin.write(block)){
         await new Promise(resolveDone=>{
           const done=()=>{
             restore.stdin.off("drain",done);
             restore.stdin.off("close",done);
             resolveDone();
           };
           restore.stdin.once("drain",done);
           restore.stdin.once("close",done);
           if(!writerOpen)done();
         });
       }
     }catch(error){
       if(error?.code!=="EPIPE"&&error?.code!=="ERR_STREAM_DESTROYED")
         writerError=error;
       writerOpen=false;
     }
   }
   if(writerOpen)restore.stdin.end();
 }
 const [ageCode,restoreCode,drained]=await Promise.allSettled([
   finished(age),finished(restore),consumeEntireArchive(),
 ]);
 if(ageCode.status!=="fulfilled"||ageCode.value!==0||
    restoreCode.status!=="fulfilled"||restoreCode.value!==0||
    drained.status!=="fulfilled"||writerError)
   throw Error("Falló verificación age/pg_restore: age="+
     (ageCode.status==="fulfilled"?ageCode.value:"error")+
     ", restore="+(restoreCode.status==="fulfilled"?restoreCode.value:"error")+
     ", flujo="+drained.status+", tubería="+(writerError?"error":"ok"));
 for(const table of [
   "TABLE public organizations",
   "TABLE public pos_orders",
   "TABLE public pos_payments",
   "TABLE public pos_customers",
   "TABLE public operational_inventory_movements",
   "TABLE public operational_inventory_balances",
   "TABLE auth users",
 ]){
   if(!toc.includes(table))throw Error("Backup incompleto; falta "+table);
 }
 if(process.argv.includes("--show-schemas")) {
   // Muestra solo existencia de estructuras del TOC, nunca datos ni claves.
   const lines=toc.split(/\r?\n/).filter(v=>v && !v.startsWith(";"));
   for(const schema of ["public","auth","storage"]) {
     const match=lines.some(v=>new RegExp("\\bSCHEMA\\s+-\\s+"+schema+"(?:\\s|$)","i").test(v));
     const objects=lines.filter(v=>new RegExp("\\b(?:TABLE|VIEW|SEQUENCE|FUNCTION)\\s+"+schema+"\\s","i").test(v)).length;
     console.log("DIAGNOSTICO TOC: schema="+schema+"; CREATE_SCHEMA="+
       (match?"SI":"NO")+"; objetos="+objects);
   }
 }
 if(process.argv.includes("--show-acls")) {
   const lines=toc.split(/\r?\n/).filter(v=>v && !v.startsWith(";"));
   const aclLines=lines.filter(v=>/\bACL\b/i.test(v));
   const count=(schema)=>aclLines.filter(v=>new RegExp("\\bACL\\s+"+schema+"\\s","i").test(v)).length;
   const pub=count("public"),storage=count("storage"),auth=count("auth");
   console.log("DIAGNOSTICO ACL TOC: total="+aclLines.length+
     "; public="+pub+"; auth="+auth+"; storage="+storage);
   if(process.argv.includes("--require-acls")&&(pub===0||storage===0))
     throw Error("Respaldo sin ACL de tablas en public/storage. Generar NUEVO backup con pg_dump sin --no-acl.");
 }
 console.log("PASS: SHA-256, age y pg_restore TOC: tablas críticas presentes.");
 console.log("PENDIENTE: restaurar en segundo PostgreSQL aislado y cotejar datos/usuarios.");
}
inspect().catch(error=>{
  const msg=String(error?.message??"Error");
  const safe=/postgresql:\/\/|password|secret/i.test(msg)?"Revisa los archivos locales.":msg.slice(0,160);
  console.error("BLOQUEADO: "+safe);
  process.exitCode=1;
});
