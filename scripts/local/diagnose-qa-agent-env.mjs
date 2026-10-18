/**
 * Diagnóstico QA de variables de impresión: solo lectura.
 * Contrasta valores cargados por Node con .env.local sin divulgar secretos.
 * NO modifica configuración, NO conecta a impresora, NO crea trabajos.
 */
import {readFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {fileURLToPath} from "node:url";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";

const root=resolve(fileURLToPath(new URL("../..",import.meta.url)));
const variables=[
 "OPS_LOCAL_PRINT_AGENT_TOKEN",
 "OPS_LOCAL_PRINT_AGENT_USER_ID",
 "NEXT_PUBLIC_OPS_LOCAL_PRINT_AGENT_ENABLED",
];
const validUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validity(key,value){
 if(!value || /REEMPLAZAR|CHANGE_ME/i.test(value))return false;
 if(key.endsWith("_TOKEN"))return value.length>=32;
 if(key.endsWith("_USER_ID"))return validUuid.test(value);
 return value==="true"||value==="false";
}
function readEntries(contents,key){
 return contents.split(/\r?\n/).filter(line=>
   new RegExp("^\\s*"+key+"\\s*=").test(line)
 ).map(line=>{
   const raw=line.slice(line.indexOf("=")+1).trim();
   const q=raw[0];
   return (q==='"'||q==="'")&&raw.at(-1)===q?raw.slice(1,-1):raw;
 });
}
async function main(){
 if(process.argv.length!==2)throw Error("Argumentos no admitidos.");
 const guard=validateLocalQaConfig(process.env);
 if(!guard.ok)throw Error("BLOQUEADO: configuración actual no es QA local.");
 const contents=await readFile(join(root,".env.local"),"utf8");
 console.log("=== QA: DIAGNÓSTICO PRIVADO DEL AGENTE, SOLO LECTURA ===");
 let bad=false;
 for(const key of variables){
   const entries=readEntries(contents,key);
   const fileValue=entries.length===1?entries[0]:null;
   const runtimeValue=process.env[key];
   const fileOk=entries.length===1&&validity(key,fileValue);
   const runtimeOk=validity(key,runtimeValue);
   const same=fileValue!==null&&runtimeValue===fileValue;
   console.log(key+": archivo="+(entries.length===0?"ausente":entries.length>1?"DUPLICADA":fileOk?"válido":"no válido")+
     "; Node="+(runtimeOk?"válido":runtimeValue===undefined?"ausente":"no válido")+
     "; coincide="+(same?"SÍ":"NO"));
   if(key!=="NEXT_PUBLIC_OPS_LOCAL_PRINT_AGENT_ENABLED"&&(!fileOk||!runtimeOk||!same))bad=true;
 }
 if(bad){
  console.log("PENDIENTE: diferencias entre .env.local y proceso Node. No iniciar el agente.");
  console.log("NOTA: variables heredadas de Windows pueden prevalecer sobre --env-file.");
 }else{
  console.log("PASS: credenciales privadas consistentes entre .env.local y Node.");
  console.log("PENDIENTE: todavía no equivale a impresión física ni activación del agente.");
 }
 console.log("FIN: no se mostraron valores privados, no se modificó ni imprimió nada.");
 process.exitCode=bad?2:0;
}
main().catch(()=>{
 console.error("BLOQUEADO: no se pudo auditar configuración QA. No iniciar el agente.");
 process.exitCode=1;
});
