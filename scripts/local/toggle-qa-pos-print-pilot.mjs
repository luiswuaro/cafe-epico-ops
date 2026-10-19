/**
 * Activa/desactiva en .env.local un ÚNICO piloto de impresión desde POS QA.
 * No conecta a PostgreSQL, no crea comandas ni imprime.
 */
import {readFile,writeFile,mkdir,copyFile,stat} from "node:fs/promises";
import {resolve,join} from "node:path";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";

const action=process.argv[2];
if(process.argv.length!==3||!["--enable","--disable","--check"].includes(action)){
 console.error("Usar --check, --enable o --disable");
 process.exit(2);
}
function block(message){throw Error("BLOQUEADO: "+message);}
async function main(){
 const cfg=validateLocalQaConfig(process.env);
 if(!cfg.ok||process.env.POS_LIVE_ENABLED!=="false"||
    process.env.DEFAULT_STORE_CODE!=="QA-TEPEXI"||
    process.env.NEXT_PUBLIC_OPS_LOCAL_PRINT_AGENT_ENABLED!=="true")
   block("Solo OPS QA local, POS LIVE apagado, agente configurado.");
 const file=resolve(".env.local");
 const raw=await readFile(file,"utf8");
 const eol=raw.includes("\r\n")?"\r\n":"\n";
 const lines=raw.split(/\r?\n/);
 const matching=lines.map((line,i)=>({line,i})).filter(x=>/^\s*OPS_QA_POS_PRINT_PILOT\s*=/.test(x.line));
 if(matching.length>1)block("Configuración duplicada. Corregir manualmente.");
 const existing=matching.length?matching[0].line.split("=").slice(1).join("=").trim():"ausente";
 console.log("QA POS piloto: "+existing);
 if(action==="--check")return;
 const desired=action==="--enable"?"true":"false";
 if(existing===desired){console.log("PASS: configuración ya está "+desired+".");return;}
 // Copia privada: no imprimir datos del archivo.
 const dir=resolve(".local");
 await mkdir(dir,{recursive:true});
 const backup=join(dir,"qa-pos-pilot-env-before-"+Date.now()+".bak");
 await copyFile(file,backup);
 if(matching.length)lines[matching[0].i]="OPS_QA_POS_PRINT_PILOT="+desired;
 else lines.push("OPS_QA_POS_PRINT_PILOT="+desired);
 await writeFile(file,lines.join(eol),"utf8");
 console.log("PASS: piloto="+desired+"; respaldo privado en .local/");
 console.log("PENDIENTE: recompilar y reiniciar Next.js QA para aplicar.");
}
main().catch(e=>{
 console.error(e?.message?.startsWith("BLOQUEADO:")?e.message:"BLOQUEADO: archivo QA no disponible.");
 process.exitCode=1;
});
