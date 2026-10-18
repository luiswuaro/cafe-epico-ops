/**
 * Habilita/deshabilita EXCLUSIVAMENTE el modo de agente de impresión del OPS QA.
 * Preserva credenciales, genera respaldo local y NO inicia servidores ni imprime.
 *
 * node --env-file=.env.local scripts/local/toggle-qa-print-agent-mode.mjs --enable
 * node --env-file=.env.local scripts/local/toggle-qa-print-agent-mode.mjs --disable
 */
import {readFile,writeFile,mkdir,rename,unlink} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";
import {resolve,join} from "node:path";
import {fileURLToPath} from "node:url";
import {parseEnv} from "node:util";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";
import postgres from "postgres";

const root=resolve(fileURLToPath(new URL("../..",import.meta.url)));
const envPath=join(root,".env.local");
const folder=join(root,".local");
const flag="NEXT_PUBLIC_OPS_LOCAL_PRINT_AGENT_ENABLED";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function stop(){throw Error("BLOQUEADO: parámetros o QA inesperados; impresión sigue sin activarse desde este script.");}
function ignored(path){
 try{execFileSync("git",["check-ignore","-q","--",path],{cwd:root,stdio:"ignore"});return true}
 catch{return false}
}
function uniqueValue(raw,key){
 const matches=raw.split(/\r\n|\n/).filter(line=>
  new RegExp("^[ \t]*"+key+"[ \t]*=").test(line));
 if(matches.length!==1)stop();
 return matches[0].slice(matches[0].indexOf("=")+1).trim().replace(/^['"]|['"]$/g,"");
}
async function main(){
 if(process.argv.length!==3||!["--enable","--disable"].includes(process.argv[2]))stop();
 if(!validateLocalQaConfig(process.env).ok)stop();
 const enable=process.argv[2]==="--enable";
 if(!ignored(".env.local")||!ignored(".local/qa-private.tmp"))stop();
 const original=await readFile(envPath);
 const raw=original.toString("utf8");
 if(/\r(?!\n)/.test(raw))stop();
 const parsed=parseEnv(raw);
 if(!validateLocalQaConfig(parsed).ok)stop();
 const current=uniqueValue(raw,flag);
 if(!["true","false"].includes(current))stop();
 const token=uniqueValue(raw,"OPS_LOCAL_PRINT_AGENT_TOKEN");
 const user=uniqueValue(raw,"OPS_LOCAL_PRINT_AGENT_USER_ID");
 const bridgeToken=uniqueValue(raw,"OPS_LOCAL_TICKET_PRINTER_TOKEN");
 const port=uniqueValue(raw,"OPS_LOCAL_TICKET_PRINTER_PORT");
 if(!/^[0-9a-f]{64}$/i.test(token)||!uuid.test(user)||
    token===bridgeToken||bridgeToken.length<32||port!=="9137")stop();
 if(parsed.OPS_QA_MODE!=="true"||parsed.DEFAULT_ORGANIZATION_SLUG!=="cafe-epico-qa"||
    parsed.DEFAULT_STORE_CODE!=="QA-TEPEXI"||parsed.POS_LIVE_ENABLED==="true")stop();
 const db=postgres(parsed.DATABASE_URL,{max:1,prepare:false,connect_timeout:5});
 try{
  const org=await db.unsafe("select id,slug from public.organizations");
  const store=await db.unsafe("select organization_id,code from public.stores");
  if(org.length!==1||org[0].slug!=="cafe-epico-qa"||
     store.length!==1||store[0].code!=="QA-TEPEXI"||
     store[0].organization_id!==org[0].id)stop();
 }finally{await db.end({timeout:3})}
 const desired=enable?"true":"false";
 if(current===desired){
  console.log("PASS: el modo QA ya está en el estado solicitado; ningún cambio.");
  return;
 }
 const lines=raw.split(/(\r\n|\n)/);
 let changed=false;
 for(let i=0;i<lines.length;i+=2){
   if(/^[ \t]*NEXT_PUBLIC_OPS_LOCAL_PRINT_AGENT_ENABLED[ \t]*=/.test(lines[i])){
     if(changed)stop();
     lines[i]=flag+"="+desired;
     changed=true;
   }
 }
 if(!changed)stop();
 const updated=lines.join("");
 const tested=parseEnv(updated);
 if(tested[flag]!==desired||!validateLocalQaConfig(tested).ok||
   tested.OPS_LOCAL_PRINT_AGENT_TOKEN!==token||
   tested.OPS_LOCAL_PRINT_AGENT_USER_ID!==user||
   tested.OPS_LOCAL_TICKET_PRINTER_TOKEN!==bridgeToken)stop();
 await mkdir(folder,{recursive:true});
 const suffix=randomUUID();
 const backup=join(folder,"qa-env-before-agent-toggle-"+suffix+".bak");
 const temp=join(folder,"qa-env-toggle-"+suffix+".tmp");
 let complete=false;
 try{
  await writeFile(backup,original,{flag:"wx",mode:0o600});
  await writeFile(temp,updated,{encoding:"utf8",flag:"wx",mode:0o600});
  if(!(await readFile(envPath)).equals(original))stop();
  await rename(temp,envPath);
  if((await readFile(envPath,"utf8"))!==updated)
   throw Error("Revisión tras escritura falló; conservar respaldo privado.");
  complete=true;
 }finally{
  await unlink(temp).catch(()=>{});
 }
 if(complete){
   console.log("PASS: modo de agente QA "+(enable?"habilitado":"deshabilitado")+" en .env.local.");
   console.log("PASS: token e identidad preservados; respaldo privado en .local.");
   console.log("PENDIENTE: reconstruir/reiniciar Next.js QA para aplicar cambio a la app.");
   console.log("Sin imprimir, iniciar procesos, alterar el POS comercial o modificar PostgreSQL.");
 }
}
main().catch(()=>{
 console.error("BLOQUEADO: no se completó la modificación. Revisar configuración QA.");
 process.exitCode=1;
});