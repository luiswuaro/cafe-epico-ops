"use client";

/** Espera entre documentos en una impresora térmica sin guillotina.
 * Se aplica a TODAS las rutas ESC/POS: comanda automática, ticket y reimpresión.
 * Web Locks serializa las pestañas de OPS de la misma PC; el cursor
 * persistente evita que recargar la página suprima el tiempo de corte.
 */
export const PAPER_CUT_GAP_STORAGE="cafe-epico-paper-cut-gap-seconds-v1";
const LAST_PRINT_STORAGE="cafe-epico-paper-cut-last-bridge-ok-v1";
const PAPER_LOCK="cafe-epico-pos58-single-printer-v1";
export const DEFAULT_PAPER_CUT_GAP_SECONDS=12;
export const PAPER_CUT_GAP_OPTIONS=[0,8,12,18,25] as const;

export function getPaperCutGapSeconds():number{
 try{
  const raw=window.localStorage.getItem(PAPER_CUT_GAP_STORAGE);
  if(raw!==null){
   const value=Number(raw);
   if(PAPER_CUT_GAP_OPTIONS.some(option=>option===value))return value;
  }
 }catch{/* valor predeterminado */}
 return DEFAULT_PAPER_CUT_GAP_SECONDS;
}

export function setPaperCutGapSeconds(seconds:number){
 if(!PAPER_CUT_GAP_OPTIONS.some(option=>option===seconds))
  throw new Error("Tiempo de separación inválido");
 window.localStorage.setItem(PAPER_CUT_GAP_STORAGE,String(seconds));
}

function lastPrintAt(deviceKey:string):number{
 try{
  const value=Number(window.localStorage.getItem(LAST_PRINT_STORAGE+":"+deviceKey));
  return Number.isFinite(value)&&value>0?value:0;
 }catch{return 0}
}

const wait=(milliseconds:number)=>new Promise<void>(resolve=>
 window.setTimeout(resolve,milliseconds));
// Fallback: si el navegador no implementa Web Locks, protege al menos esta pestaña.
let localTail:Promise<void>=Promise.resolve();

/** No retiene ni duplica trabajos: la reserva en PostgreSQL ocurre antes.
 * Sólo se envía el siguiente documento cuando acaba el tiempo para cortar.
 */
export async function printWithPaperCutGap<T>(
 send:()=>Promise<T>,onWaiting?:(seconds:number)=>void,printerUrl="http://127.0.0.1:9137",
):Promise<T>{
 const url=new URL(printerUrl);
 const deviceKey=(url.hostname==="localhost"?"127.0.0.1":url.hostname)+":"+url.port;
 const operation=async()=>{
  const gapMs=getPaperCutGapSeconds()*1000;
  const remaining=Math.max(0,lastPrintAt(deviceKey)+gapMs-Date.now());
  if(remaining>0){
   onWaiting?.(Math.ceil(remaining/1000));
   await wait(remaining);
  }
  const result=await send();
  try{window.localStorage.setItem(LAST_PRINT_STORAGE+":"+deviceKey,String(Date.now()))}
  catch{/* Si no existe almacenamiento, los Web Locks aún serializan esta operación */}
  return result;
 };
 if(typeof navigator!=="undefined"&&navigator.locks){
  return navigator.locks.request(PAPER_LOCK+":"+deviceKey,{mode:"exclusive"},operation);
 }
 const scheduled=localTail.then(operation,operation);
 localTail=scheduled.then(()=>{},()=>{});
 return scheduled;
}
