"use client";
import {useEffect,useState} from "react";
import {getPrintStationJobStatus} from "@/app/(employee)/pos/printer/hub-actions";
/** Distingue comanda en cola de comanda efectivamente enviada al puente. */
export function PrintJobIndicator({jobKey,kind}:{jobKey:string;kind:"comanda"|"ticket"}){
 const [state,setState]=useState<"UNCLAIMED"|"CLAIMED"|"DONE"|"FAILED"|null>(null);
 useEffect(()=>{
   let active=true;
   const refresh=async()=>{
     try{
       const result=await getPrintStationJobStatus(jobKey);
       if(active)setState(result);
     }catch{/* No afirmar que se imprimió si falla la conexión */}
   };
   void refresh();
   const interval=window.setInterval(()=>void refresh(),3000);
   return ()=>{active=false;window.clearInterval(interval)};
 },[jobKey]);
 const texts={
   UNCLAIMED:"Pedido guardado. La "+kind+" está pendiente de la estación de impresión.",
   CLAIMED:"La "+kind+" está en proceso de impresión. No pulses imprimir otra vez.",
   DONE:"La "+kind+" fue enviada a la impresora (puente confirmado).",
   FAILED:"La impresión no se confirmó: revisa el papel antes de solicitar reimpresión.",
 };
 if(!state)return <p role="status" className="muted">Consultando cola de impresión…</p>;
 return <p role="status" className={"card no-print "+(state==="DONE"?"status-ok":state==="FAILED"?"status-warn":"muted")}
   style={{marginBottom:10}}>{texts[state]}</p>;
}
