/**
 * Respaldo LOCAL cifrado sin volcar PG en disco:
 * pg_dump -> age -> archivo temporal cifrado -> renombrado.
 * Requiere pg_dump (compatible con PostgreSQL 17) y age en PATH.
 * NO equivale a una restauración validada y no incluye objetos físicos Storage.
 */
import {spawn} from "node:child_process";
import {createReadStream,createWriteStream,existsSync} from "node:fs";
import {mkdir,rename,rm,realpath,stat,writeFile} from "node:fs/promises";
import {pipeline} from "node:stream/promises";
import {createHash,randomUUID} from "node:crypto";
import {join,resolve,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {assessLocalBackup} from "./local-backup-policy.mjs";

const root=resolve(fileURLToPath(new URL("../..",import.meta.url)));
function subprocessExit(proc){
  return new Promise(resolve=>{
    proc.once("error",()=>resolve(-1));
    proc.once("close",code=>resolve(code??-1));
  });
}
function pgEnvironment(url){
  // Do not expose credentials on command lines. libpq receives them in env.
  return {...process.env,
    PGHOST:url.hostname,
    PGPORT:url.port||"5432",
    PGUSER:decodeURIComponent(url.username),
    PGPASSWORD:decodeURIComponent(url.password),
    PGDATABASE:url.pathname.slice(1),
    PGCONNECT_TIMEOUT:"15",
    PGSSLMODE:"prefer",
  };
}
async function digest(file){
  const hash=createHash("sha256");
  for await(const part of createReadStream(file))hash.update(part);
  return hash.digest("hex");
}
async function backup(){
  const check=assessLocalBackup(process.env,root);
  if(!check.ok)throw Error("Configuración local bloqueada: "+check.errors.join("; "));
  const ageKey=process.env.OPS_BACKUP_AGE_RECIPIENT;
  await mkdir(check.target,{recursive:true,mode:0o700});
  const destination=await realpath(check.target);
  if(destination===root||destination.startsWith(root+sep))
    throw Error("Destino real dentro del repositorio no autorizado.");

  const timestamp=new Date().toISOString().replace(/[-:]/g,"").replace(/\..*/,"Z");
  const archive=join(destination,"cafe-epico-local-"+timestamp+"-"+randomUUID().slice(0,8)+".pgcustom.age");
  const temp=archive+".partial";
  let published=false;
  try{
    const dump=spawn("pg_dump",[
      "--format=custom","--no-owner","--no-acl",
      "--schema=public","--schema=auth","--schema=storage",
    ],{env:pgEnvironment(check.db),stdio:["ignore","pipe","ignore"],windowsHide:true});
    const age=spawn("age",["--recipient",ageKey],{
      stdio:["pipe","pipe","ignore"],windowsHide:true,
    });
    const toDisk=createWriteStream(temp,{flags:"wx",mode:0o600});
    const results=await Promise.allSettled([
      subprocessExit(dump),subprocessExit(age),
      pipeline(dump.stdout,age.stdin),
      pipeline(age.stdout,toDisk),
    ]);
    const d=results[0],a=results[1],stream1=results[2],stream2=results[3];
    if(d.status!=="fulfilled"||d.value!==0||a.status!=="fulfilled"||a.value!==0||
       stream1.status!=="fulfilled"||stream2.status!=="fulfilled")
      throw Error("Falló pg_dump o age. Se descartó el archivo parcial cifrado.");
    const bytes=(await stat(temp)).size;
    if(bytes<256)throw Error("Archivo cifrado anormalmente pequeño.");
    const sha256=await digest(temp);
    if(existsSync(archive))throw Error("Colisión de archivo: respaldo no sobrescrito.");
    await rename(temp,archive);
    published=true;
    const manifest=[
      "format=pg_dump_custom_encrypted_age_v1",
      "created_utc="+timestamp,
      "schemas=public,auth,storage",
      "encrypted_file="+archive.split(/[\\/]/).pop(),
      "encrypted_bytes="+bytes,
      "sha256="+sha256,
      "restore_tested=no",
      "note=No incluye archivos fisicos Storage ni secretos/configuracion de Auth.",
      ""
    ].join("\n");
    await writeFile(archive+".manifest.txt",manifest,{flag:"wx",mode:0o600});
    console.log("PASS: copia CIFRADA generada y SHA-256 calculado.");
    console.log("Archivo: "+archive);
    console.log("ATENCION: falta inspección y restauración en otro servidor aislado.");
  } finally {
    if(!published)await rm(temp,{force:true}).catch(()=>{});
  }
}
backup().catch(error=>{
  const message=String(error?.message??"error");
  const safe=/password|postgresql:\/\/|secret|PGPASSWORD/i.test(message)
    ?"Revisa herramientas y parámetros locales.":message.slice(0,180);
  console.error("BLOQUEADO: "+safe);
  process.exitCode=1;
});
