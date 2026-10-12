"use client";
import {useEffect,useRef,useState} from "react";
import {PAPER_CUT_GAP_STORAGE,DEFAULT_PAPER_CUT_GAP_SECONDS,PAPER_CUT_GAP_OPTIONS,getPaperCutGapSeconds,setPaperCutGapSeconds} from "@/src/application/pos/print-paper-gap";
import {getPrintStationJobs,claimPrintStationJob,finishPrintStationJob,
} from "./hub-actions";
import {printKitchenSlip} from "../orders/kitchen-print-button";
import {acknowledgeKitchenPrint} from "../orders/print-timing-actions";
import {printReceiptWithBridge,type DirectReceiptTemplate} from "../receipt/[id]/direct-print-button";
const STORAGE="cafe-epico-print-hub-pc-v1";
const TICKET_CONFIG="cafe-epico-printer-bridge-v1";
type HubState={enabled:boolean;since:string;stationId:string};
export function PrintStation({template,preview,hiddenMode=false}:{
 template:DirectReceiptTemplate;preview:boolean;hiddenMode?:boolean;
}){
 const [state,setState]=useState<HubState|null>(null);
 const [status,setStatus]=useState("Activa esta PC para recibir impresión de los celulares.");
 const [processed,setProcessed]=useState<string[]>([]);
 const [pending,setPending]=useState(0);
 const [cutGap,setCutGap]=useState(DEFAULT_PAPER_CUT_GAP_SECONDS);
 const working=useRef(false);
 useEffect(()=>{
  try{const raw=window.localStorage.getItem(STORAGE);if(raw)
   window.requestAnimationFrame(()=>setState(JSON.parse(raw) as HubState))}
  catch{/* Ignorar configuración antigua */}
  window.requestAnimationFrame(()=>setCutGap(getPaperCutGapSeconds()));
 },[]);
 const update=(next:HubState)=>{
  window.localStorage.setItem(STORAGE,JSON.stringify(next));setState(next);
  window.dispatchEvent(new Event("ops-print-hub-config-changed"));
 };
 function start(){
  if(preview)return;
  if(!window.localStorage.getItem(TICKET_CONFIG)){
    setStatus("Configura primero la impresora de tickets y verifica el puente local.");
    return;
  }
  // Una reactivación voluntaria no reimprime una cola vieja. El refresh
  // normal conserva el cursor persistido mientras siga activa.
  const keep=new Date().toISOString();
  const id=state?.stationId||crypto.randomUUID();
  update({enabled:true,since:keep,stationId:id});
  setStatus("Estación activa. Escuchando comandas y tickets de todos los dispositivos.");
 }
 function stop(){
  if(!state)return;
  update({...state,enabled:false});
  setStatus("Estación pausada. Las siguientes impresiones quedarán pendientes.");
 }
 useEffect(()=>{
  if(!state?.enabled||preview||!hiddenMode)return;
  let alive=true;
  const tick=async()=>{
    if(!alive||working.current)return;
    working.current=true;
    try{
      const jobs=await getPrintStationJobs({since:state.since});
      if(alive)setPending(jobs.length);
      for(const job of jobs){
        if(!alive)break;
        const claimed=await claimPrintStationJob(job.key,state.stationId);
        if(!claimed)continue;
        try{
          let printer="POS";
          if(job.kind==="KITCHEN"&&job.slip){
            printer=await printKitchenSlip(job.slip,"all",undefined,undefined,(seconds)=>{
              if(alive)setStatus("Corta el papel anterior · próxima comanda en "+seconds+" s");
            });
            try{await acknowledgeKitchenPrint({
              orderId:job.orderId,roundId:job.roundId??"INITIAL",printer});
            }catch{/* Aceptada por puente; registramos el job como impreso */}
          }else if(job.ticket){
            printer=await printReceiptWithBridge(job.ticket,template,(seconds)=>{
              if(alive)setStatus("Corta la comanda · siguiente ticket en "+seconds+" s");
            });
          }else throw new Error("Trabajo de impresión incompleto");
          await finishPrintStationJob(job.key,state.stationId,"DONE",printer);
          if(alive){
            setStatus(job.title+" → enviada a "+printer);
            setProcessed(old=>[job.title,...old].slice(0,8));
          }
        }catch(error){
          const cause=error instanceof Error?error.message:"Error del puente";
          await finishPrintStationJob(job.key,state.stationId,"FAILED",cause);
          if(alive)setStatus("No se imprimió "+job.title+": "+cause+
            ". Revisa el puente y vuelve a imprimir manualmente; no se reintentará solo.");
        }
      }
    }catch(error){
      if(alive)setStatus(error instanceof Error?error.message:"Sin conexión con OPS");
    }finally{working.current=false;}
  };
  void tick();
  const timer=window.setInterval(()=>void tick(),4000);
  return ()=>{alive=false;window.clearInterval(timer)};
 },[state?.enabled,state?.since,state?.stationId,preview,template,hiddenMode]);
 const enabled=Boolean(state?.enabled)&&!preview;
 if(hiddenMode)return null;
 return <section className="card stack pos-print-station">
   <div className="section-heading"><div>
    <p className="eyebrow">4 · ESTACIÓN PRINCIPAL · PC</p>
    <h2>Imprimir pedidos enviados desde el celular</h2></div>
    <span className={enabled?"status-ok":"muted"}>{enabled?"ACTIVA":"APAGADA"}</span>
   </div>
   <p>Esta computadora recibe las comandas y los tickets enviados desde celular o PC.
    Puedes regresar al POS, tueste o finanzas: la estación funciona en segundo plano
    mientras OPS permanezca abierto en este equipo.</p>
   <div className="pos-print-cut-settings">
    <label htmlFor="pos-print-cut-gap"><strong>Corte de papel entre impresiones</strong></label>
    <select id="pos-print-cut-gap" value={cutGap}
      onChange={event=>{
       const seconds=Number(event.target.value);
       setPaperCutGapSeconds(seconds);setCutGap(seconds);
      }}>
      {PAPER_CUT_GAP_OPTIONS.map(seconds=><option key={seconds} value={seconds}>
        {seconds===0?"Sin espera · impresora con cortador":seconds+" segundos para cortar"}
      </option>)}
    </select>
    <small className="muted">En la POS-58 sin guillotina recomendamos 12 segundos.
     La separación se aplica al trabajo automático y manual sin duplicar papel.
    </small>
   </div>
   <div className="pos-result-actions">
    <button type="button" onClick={start} disabled={enabled||preview}>
     Activar estación de caja</button>
    <button type="button" className="button" onClick={stop} disabled={!enabled}>
     Pausar estación</button>
   </div>
   {preview&&<p className="status-warn">Preview de solo lectura: la estación real se
    activará únicamente después de publicar en producción.</p>}
   <p role="status" className="muted">{status}</p>
   {enabled&&<small className="muted">
    Eventos encontrados: {pending}. Una impresión confirmada jamás se repite.
    Si el puente o internet falla después de reclamar el trabajo,
    OPS no lo reintenta a ciegas: revisa el papel e imprime manualmente si corresponde.
   </small>}
   {processed.length>0&&<details><summary>Últimas impresiones confirmadas</summary>
    <ul>{processed.map((name,i)=><li key={i}>{name}</li>)}</ul></details>}
 </section>;
}
