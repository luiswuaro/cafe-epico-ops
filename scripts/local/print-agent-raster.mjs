import {spawn} from "node:child_process";
import {createInterface} from "node:readline";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {printAgentPayload} from "./print-agent-format.mjs";

const script=resolve(fileURLToPath(new URL("./Render-PrintTicketRaster.ps1",import.meta.url)));
let renderer=null;
let serialize=Promise.resolve();

function startRenderer(){
 if(renderer)return renderer;
 // El renderer solo dibuja: no necesita las claves Auth, DB ni impresoras.
 // Crear un entorno hijo mínimo para no heredar secretos del OPS.
 const inherited=["SystemRoot","WINDIR","TEMP","TMP","PATH","PATHEXT","USERPROFILE"];
 const safeEnv=Object.fromEntries(inherited.filter(key=>process.env[key])
   .map(key=>[key,process.env[key]]));
 const child=spawn("powershell.exe",[
   "-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass",
   "-File",script,"-Stream",
 ],{stdio:["pipe","pipe","pipe"],windowsHide:true,env:safeEnv});
 const state={child,pending:null,closed:false};
 renderer=state;
 // STDERR is deliberately discarded; it may contain customer data.
 child.stderr.resume();
 child.stdin.on("error",()=>{
   if(state.pending){state.pending.reject(Error("No se pudo comunicar con GDI."));state.pending=null;}
 });
 const reader=createInterface({input:child.stdout,crlfDelay:Infinity});
 reader.on("line",line=>{
   const job=state.pending;
   state.pending=null;
   if(job)job.resolve(line);
 });
 const stop=()=>{
   state.closed=true;
   if(state.pending){state.pending.reject(Error("El renderizador GDI se detuvo."));state.pending=null;}
   if(renderer===state)renderer=null;
 };
 child.once("error",stop);
 child.once("close",stop);
 return state;
}
process.once("exit",()=>{if(renderer)renderer.child.kill();});

async function renderOne(source){
 const state=startRenderer();
 if(state.closed||state.pending)throw Error("Proceso gráfico ocupado.");
 const output=await new Promise((resolveOutput,rejectOutput)=>{
   const timer=setTimeout(()=>{
     state.child.kill();
     if(state.pending){
       state.pending=null;
       rejectOutput(Error("GDI sin respuesta a los 30 segundos."));
     }
   },30000);
   state.pending={
     resolve:line=>{clearTimeout(timer);resolveOutput(line);},
     reject:error=>{clearTimeout(timer);rejectOutput(error);},
   };
   state.child.stdin.write(JSON.stringify(source)+"\n");
 });
 let result;
 try{result=JSON.parse(output);}catch{throw Error("Respuesta GDI inválida.");}
 if(result?.error)throw Error("GDI no pudo dibujar el ticket.");
 const raster=result?.raster;
 if(!raster||raster.width!==384||!Number.isInteger(raster.height)||
    raster.height<40||raster.height>5000||typeof raster.dataBase64!=="string"||
    Buffer.from(raster.dataBase64,"base64").length!==48*raster.height)
   throw Error("Bitmap GDI inválido.");
 return {raster:{dataBase64:raster.dataBase64,width:384,
   height:raster.height,align:"center"},feed:source.feed,cut:source.cut};
}

/** Mantener un proceso GDI+ por estación y secuenciar peticiones. El estado
 * CLAIM de la BD no se toca hasta que el render haya finalizado con éxito. */
export async function printAgentRasterPayload(job,template={}){
 if(process.platform!=="win32")throw Error("El modo raster necesita Windows.");
 const source=printAgentPayload(job,template);
 const task=serialize.then(()=>renderOne(source));
 serialize=task.catch(()=>{});
 return task;
}
