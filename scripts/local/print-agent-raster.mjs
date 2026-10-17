import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {printAgentPayload} from "./print-agent-format.mjs";

const script=resolve(fileURLToPath(new URL("./Render-PrintTicketRaster.ps1",import.meta.url)));

/** Render a full 384px Unicode bitmap with Windows GDI (no browser or fonts
 * shipped). This does not talk to the printer: claim remains in PostgreSQL.
 * Fail before claim if drawing fails; never silently fallback to text.
 */
export async function printAgentRasterPayload(job,template={}){
 if(process.platform!=="win32")throw Error("Render raster requiere Windows.");
 const source=printAgentPayload(job,template);
 const worker=spawn("powershell.exe",[
   "-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass",
   "-File",script,
 ],{stdio:["pipe","pipe","pipe"],windowsHide:true});
 let stdout="",stderr="";
 const limit=2_000_000;
 const done=new Promise((resolveDone,reject)=>{
   worker.once("error",reject);
   worker.once("close",code=>resolveDone(code));
 });
 worker.stdout.setEncoding("utf8");
 worker.stdout.on("data",part=>{
   stdout+=part;
   if(stdout.length>limit)worker.kill();
 });
 worker.stderr.setEncoding("utf8");
 worker.stderr.on("data",part=>{
   stderr+=part;
   if(stderr.length>limit)worker.kill();
 });
 const timer=setTimeout(()=>worker.kill(),30000);
 try{
   worker.stdin.end(JSON.stringify(source));
   const exitCode=await done;
   if(exitCode!==0||!stdout||stderr.length>limit||stdout.length>limit)
     throw Error("Falló raster GDI del ticket. No se reclamó ni imprimió.");
   let payload;
   try{payload=JSON.parse(stdout)}catch{throw Error("Renderer GDI respondió JSON inválido.");}
   const raster=payload?.raster;
   if(!raster||raster.width!==384||!Number.isInteger(raster.height)||
      raster.height<40||raster.height>5000||typeof raster.dataBase64!=="string"||
      Buffer.from(raster.dataBase64,"base64").length!==48*raster.height)
     throw Error("Renderer GDI devolvió un bitmap de tamaño incorrecto.");
   return {
     raster:{dataBase64:raster.dataBase64,width:384,height:raster.height,align:"center"},
     feed:source.feed,cut:source.cut,
   };
 }finally{clearTimeout(timer);}
}
