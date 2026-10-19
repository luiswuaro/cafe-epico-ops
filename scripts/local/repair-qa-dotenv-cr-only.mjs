/**
 * Reparación mínima del .env.local del OPS QA: CR aislados antes de las
 * dos variables de impresión -> CRLF, sin tocar ningún otro byte.
 * Conserva respaldo local privado y no revela credenciales.
 * No inicia agentes, no imprime y no altera la base de datos.
 *
 * node --env-file=.env.local scripts/local/repair-qa-dotenv-cr-only.mjs
 */
import {readFile,writeFile,mkdir,rename,unlink} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";
import {resolve,join} from "node:path";
import {fileURLToPath} from "node:url";
import {parseEnv} from "node:util";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";

const root=resolve(fileURLToPath(new URL("../..",import.meta.url)));
const envPath=join(root,".env.local");
const backupDir=join(root,".local");
const keys=["OPS_LOCAL_PRINT_AGENT_TOKEN","OPS_LOCAL_PRINT_AGENT_USER_ID"];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function stop(){throw Error("BLOQUEADO: formato QA inesperado. No se modificó ningún archivo comercial.");}
function ignored(path){
  try{execFileSync("git",["check-ignore","-q","--",path],{cwd:root,stdio:"ignore"});return true;}
  catch{return false;}
}
function countBareCR(bytes){
  const positions=[];
  for(let i=0;i<bytes.length;i++)
    if(bytes[i]===13 && bytes[i+1]!==10)positions.push(i);
  return positions;
}
function countKeyLines(text,key){
  return text.split(/\r\n|\n|\r/).filter(line=>
    new RegExp("^[ \t]*"+key+"[ \t]*=").test(line)
  ).length;
}
async function main(){
  if(process.argv.length!==2)stop();
  if(!validateLocalQaConfig(process.env).ok)stop();
  if(!ignored(".env.local")||!ignored(".local/qa-private.tmp"))stop();
  const original=await readFile(envPath);
  const raw=original.toString("utf8");
  const bare=countBareCR(original);
  if(bare.length===0){
    const env=parseEnv(raw);
    if(keys.every(key=>countKeyLines(raw,key)===1 && env[key]===process.env[key])){
      console.log("PASS: CR aislados=0. Las variables QA ya son legibles; no se modificó el archivo.");
      return;
    }
    stop();
  }
  // Condición específica de la captura: exactamente dos CR sueltos,
  // ubicados justo antes de las variables de identidad del agente.
  if(bare.length!==2)stop();
  const expected=keys.map(key=>{
    const index=original.indexOf(Buffer.from(key+"=","ascii"));
    if(index<1||original.lastIndexOf(Buffer.from(key+"=","ascii"))!==index||original[index-1]!==13)stop();
    return index-1;
  });
  if(!bare.every(position=>expected.includes(position)))stop();
  // Se conserva byte por byte todo lo previo y posterior a cada CR.
  const pieces=[];
  let start=0;
  for(const position of bare){
    pieces.push(original.subarray(start,position+1));
    pieces.push(Buffer.from([10]));  // añade LF después del CR aislado
    start=position+1;
  }
  pieces.push(original.subarray(start));
  const normalized=Buffer.concat(pieces);
  const corrected=normalized.toString("utf8");
  if(countBareCR(normalized).length!==0||normalized.length!==original.length+2)stop();
  if(!keys.every(key=>countKeyLines(corrected,key)===1))stop();
  const parsed=parseEnv(corrected);
  if(!validateLocalQaConfig(parsed).ok)stop();
  const agentToken=parsed.OPS_LOCAL_PRINT_AGENT_TOKEN;
  const agentId=parsed.OPS_LOCAL_PRINT_AGENT_USER_ID;
  if(!/^[0-9a-f]{64}$/i.test(agentToken??"")||!uuid.test(agentId??""))stop();
  if(agentToken===parsed.OPS_LOCAL_TICKET_PRINTER_TOKEN)stop();
  if(parsed.NEXT_PUBLIC_OPS_LOCAL_PRINT_AGENT_ENABLED==="true")stop();

  await mkdir(backupDir,{recursive:true});
  const nonce=randomUUID();
  const backup=join(backupDir,"qa-dotenv-before-crfix-"+nonce+".bak");
  const temp=join(backupDir,"qa-dotenv-staged-"+nonce+".tmp");
  let committed=false;
  try{
    await writeFile(backup,original,{flag:"wx",mode:0o600});
    await writeFile(temp,normalized,{flag:"wx",mode:0o600});
    if(!(await readFile(envPath)).equals(original))stop();
    await rename(temp,envPath);
    committed=true;
    if(!(await readFile(envPath)).equals(normalized))
      throw Error("Verificación de escritura fallida. Conservar copia privada en .local.");
  }finally{
    await unlink(temp).catch(()=>{});
  }
  if(committed){
    console.log("PASS: CR sueltos corregidos: 2. CRLF reparados: 2.");
    console.log("PASS: identidad y token QA reconocidos en el .env.local reparado (valores ocultos).");
    console.log("PASS: copia anterior protegida en .local/ (excluida de Git).");
    console.log("PENDIENTE: volver a lanzar el diagnóstico en un proceso Node NUEVO.");
    console.log("Sin impresión, cobro, reinicios ni modificaciones a PostgreSQL.");
  }
}
main().catch(()=>{
  console.error("BLOQUEADO: no se completó la reparación. No activar la impresión.");
  process.exitCode=1;
});