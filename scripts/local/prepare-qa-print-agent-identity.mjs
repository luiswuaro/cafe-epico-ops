/**
 * Preparación exclusivamente QA del agente de impresión.
 * Usa el BARISTA SINTÉTICO QA, nunca cuentas comerciales.
 * Genera token independiente del puente y lo guarda sin mostrarlo.
 * NO habilita el agente, NO inicia procesos, NO imprime.
 */
import {randomBytes,randomUUID} from "node:crypto";
import {readFile,writeFile,copyFile,rename,unlink,mkdir} from "node:fs/promises";
import {constants as fsConstants} from "node:fs";
import {resolve,join} from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import postgres from "postgres";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";

const root=resolve(fileURLToPath(new URL("../..",import.meta.url)));
const envPath=join(root,".env.local");
const secretDir=join(root,".local");
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(){throw Error("BLOQUEADO: credenciales o identidad QA inesperadas. Sin activar agente.")}
function ignored(path){
 try{execFileSync("git",["check-ignore","-q","--",path],{cwd:root,stdio:"ignore"});return true}
 catch{return false}
}
function envValue(contents,key){
 const matches=[...contents.matchAll(new RegExp("^\\s*"+key+"\\s*=([^\\r\\n]*)$","gm"))];
 if(matches.length>1)fail();
 return matches.length?matches[0][1].trim().replace(/^["']|["']$/g,""):"";
}
function setEnv(contents,key,value){
 const rex=new RegExp("^\\s*"+key+"\\s*=[^\\r\\n]*$","gm");
 const matches=[...contents.matchAll(rex)];
 if(matches.length>1)fail();
 if(matches.length===1)return contents.replace(rex,key+"="+value);
 const eol=contents.includes("\r\n")?"\r\n":"\n";
 return contents+(contents.endsWith("\n")?"":eol)+key+"="+value+eol;
}
function placeholder(s){return !s || /^(?:REEMPLAZAR|CHANGE_ME|GENERAR|TOKEN_|UUID_)/i.test(s)}
async function main(){
 if(process.argv.length!==2)fail();
 const cfg=validateLocalQaConfig(process.env);
 if(!cfg.ok)fail();
 if(!ignored(".env.local")||!ignored(".local/qa-private.tmp"))fail();
 const before=await readFile(envPath,"utf8");
 if(envValue(before,"NEXT_PUBLIC_OPS_LOCAL_PRINT_AGENT_ENABLED")==="true")
   throw Error("BLOQUEADO: el agente ya está habilitado.");
 const bridgeToken=envValue(before,"OPS_LOCAL_TICKET_PRINTER_TOKEN");
 if(bridgeToken.length<32||placeholder(bridgeToken)||envValue(before,"OPS_LOCAL_TICKET_PRINTER_PORT")!=="9137")
   throw Error("BLOQUEADO: primero validar el puente POS-58 / 9137.");
 if(envValue(before,"OPS_LOCAL_KITCHEN_PRINTER_TOKEN") &&
    !placeholder(envValue(before,"OPS_LOCAL_KITCHEN_PRINTER_TOKEN")))
   throw Error("BLOQUEADO: ya hay otro puente de barra configurado.");
 const db=postgres(process.env.DATABASE_URL,{max:1,prepare:false,connect_timeout:5});
 let id;
 try{
   const orgs=await db.unsafe("select id,slug from public.organizations");
   const stores=await db.unsafe("select id,organization_id,code from public.stores");
   if(orgs.length!==1||orgs[0].slug!=="cafe-epico-qa"||
      stores.length!==1||stores[0].organization_id!==orgs[0].id||
      stores[0].code!=="QA-TEPEXI")fail();
   const sql=[
    "select e.user_id from public.employees e",
    "join auth.users a on a.id=e.user_id",
    "where e.organization_id=$1 and e.home_store_id=$2",
    "and e.is_active=true and e.name='Azucena'",
    "and a.email='barista-qa@example.test'",
    "and exists(select 1 from public.employee_roles er",
    "join public.roles r on r.id=er.role_id",
    "join public.role_permissions rp on rp.role_id=r.id",
    "join public.permissions p on p.id=rp.permission_id",
    "where er.employee_id=e.id and r.code='BARISTA'",
    "and r.organization_id=$1 and p.code='pos.sell'",
    "and (er.store_id is null or er.store_id=$2))",
    "and not exists(select 1 from public.employee_roles er",
    "join public.roles r on r.id=er.role_id",
    "where er.employee_id=e.id and r.code='OWNER')"
   ].join(" ");
   const rows=await db.unsafe(sql,[orgs[0].id,stores[0].id]);
   if(rows.length!==1||!uuid.test(rows[0].user_id))fail();
   id=rows[0].user_id;
 }finally{await db.end({timeout:3})}
 const oldId=envValue(before,"OPS_LOCAL_PRINT_AGENT_USER_ID");
 if(!placeholder(oldId)&&oldId!==id)fail();
 const oldSecret=envValue(before,"OPS_LOCAL_PRINT_AGENT_TOKEN");
 if(!placeholder(oldSecret) && !/^[0-9a-f]{64}$/i.test(oldSecret))fail();
 const secret=placeholder(oldSecret)?randomBytes(32).toString("hex"):oldSecret;
 if(secret===bridgeToken)fail();
 let changed=setEnv(before,"OPS_LOCAL_PRINT_AGENT_TOKEN",secret);
 changed=setEnv(changed,"OPS_LOCAL_PRINT_AGENT_USER_ID",id);
 if(changed===before){
   console.log("PASS: identidad QA del agente ya preparada. Token e identidad ocultos.");
   console.log("PENDIENTE: habilitación controlada, rebuild y papel físico.");
   return;
 }
 await mkdir(secretDir,{recursive:true});
 const nonce=randomUUID();
 const temp=join(secretDir,"qa-agent-"+nonce+".tmp");
 const backup=join(secretDir,"qa-agent-"+nonce+".bak");
 let saved=false;
 try{
   await copyFile(envPath,backup,fsConstants.COPYFILE_EXCL);
   await writeFile(temp,changed,{encoding:"utf8",flag:"wx",mode:0o600});
   if(await readFile(envPath,"utf8")!==before)fail();
   await rename(temp,envPath);
   if(await readFile(envPath,"utf8")!==changed)
     throw Error("Verificación fallida. Conservar respaldo privado en .local.");
   saved=true;
 }finally{
   await unlink(temp).catch(()=>{});
   if(saved)await unlink(backup).catch(()=>{});
 }
 console.log("PASS: token independiente del agente QA generado/validado (oculto).");
 console.log("PASS: BARISTA sintético QA vinculado con pos.sell (UUID oculto).");
 console.log("PASS: .env.local actualizado; sin cobros, impresión ni arranque.");
 console.log("PENDIENTE: habilitación controlada y prueba física.");
}
main().catch(()=>{
 console.error("BLOQUEADO: configuración QA no completada. No publicar .env.local ni activar impresión.");
 process.exitCode=1;
});
