"use client";

import { useEffect, useRef, useState } from "react";
import { printKitchenSlip } from "./kitchen-print-button";
import {acknowledgeKitchenPrint} from "./print-timing-actions";
import {claimPrintStationJob,finishPrintStationJob} from "../printer/hub-actions";
import { type KitchenSlip } from "@/src/application/pos/kitchen-slip";
import {autoKitchenModes,type KitchenAutoEvent} from "@/src/domain/pos/kitchen-auto-policy";
import {
  AUTO_KITCHEN_DINE_IN_KEY,
  AUTO_KITCHEN_TAKEAWAY_KEY,
  AUTO_KITCHEN_ATTEMPT_PREFIX,
} from "./kitchen-print-settings";

export type AutoKitchenEvent = KitchenAutoEvent;

export function AutoKitchenPrint({
  slip,event,eventId,roundId,orderId,isLive=false,
}:{
  slip:KitchenSlip;
  event:AutoKitchenEvent;
  // Identificador de operación real: orden + ronda para guardado,
  // orden + pago o ID del split para cobro. Nunca un timestamp de página.
  eventId:string;
  roundId?:string;
  orderId?:string;
  isLive?:boolean;
}){
  const handled=useRef<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  const [error,setError]=useState(false);

  useEffect(()=>{
    // Estación central evita que esta pestaña dispare la misma comanda dos veces.
    try{const hub=JSON.parse(window.localStorage.getItem("cafe-epico-print-hub-pc-v1")||"null");
      if(hub?.enabled)return;}catch{/* seguir el modo local anterior */}
    const id=event+":"+eventId;
    if(handled.current===id)return;
    handled.current=id;

    const autoDineIn=window.localStorage.getItem(AUTO_KITCHEN_DINE_IN_KEY)==="1";
    const autoTakeaway=window.localStorage.getItem(AUTO_KITCHEN_TAKEAWAY_KEY)==="1";

    // GUARDADO (aquí o para llevar): imprimir exclusivamente la nueva ronda.
    // DIRECTO: imprimir la orden nueva después de confirmar cobro.
    // PAGO POSTERIOR de una comanda guardada: no reimprimirla jamás.
    const selectedModes=autoKitchenModes(event,autoDineIn,autoTakeaway);
    // Celulares no tienen el puente local de Windows; se imprime desde la PC.
    const hasBridge=Boolean(window.localStorage.getItem("cafe-epico-printer-bridge-v1")||
      window.localStorage.getItem("cafe-epico-kitchen-printer-bridge-v1"));
    if(!hasBridge)return;
    if(!selectedModes.length)return;
    const eligible=slip.lines.some(line=>
      selectedModes.some(mode=>line.serviceMode===mode)&&
      (event!=="saved"||!roundId||(line.roundId||"INITIAL")===roundId)
    );
    if(!eligible)return;
    const serviceFilter=selectedModes.length===2?"BOTH":selectedModes[0];

    // Reservar antes del I/O: un refresh, doble montaje de React o pestañas
    // concurrentes no deben enviar dos comandas a la misma impresora.
    const attempt=AUTO_KITCHEN_ATTEMPT_PREFIX+id;
    if(window.localStorage.getItem(attempt))return;
    window.localStorage.setItem(attempt,new Date().toISOString());

    let active=true;
    void (async()=>{
      const selectedRound=roundId??slip.lines.at(-1)?.roundId??"INITIAL";
      const jobKey=isLive&&orderId?"KITCHEN:"+orderId+":"+selectedRound:null;
      let stationId:string|null=null;
      try{
        if(jobKey){
          stationId=crypto.randomUUID();
          const claimed=await claimPrintStationJob(jobKey,stationId);
          if(!claimed){
            if(active)setMessage("La estación central ya está procesando o procesó esta comanda.");
            return;
          }
        }
        const printer=await printKitchenSlip(
          slip,event==="saved"?"latest":"all",serviceFilter,roundId);
        if(stationId&&jobKey)await finishPrintStationJob(jobKey,stationId,"DONE",printer);
        let logged=true;
        if(orderId){
          try{await acknowledgeKitchenPrint({orderId,roundId:selectedRound,printer})}
          catch{logged=false}
        }
        if(active){
          setError(!logged);
          setMessage(logged?"Comanda enviada automáticamente a "+printer:
            "Comanda enviada a "+printer+", sin métrica de impresión.");
        }
      }catch(cause){
        if(stationId&&jobKey){
          try{await finishPrintStationJob(jobKey,stationId,"FAILED",
            cause instanceof Error?cause.message:"Puente no disponible")}
          catch{/* Nunca reintentar automáticamente cuando falta ACK */}
        }
        if(active){
          setError(true);
          setMessage("No se confirmó la impresión: "+
            (cause instanceof Error?cause.message:"sin conexión")+
            ". Comprueba si ya salió papel antes de reimprimir.");
        }
      }
    })();
    return ()=>{active=false;};
  },[event,eventId,orderId,roundId,slip,isLive]);

  return message?<div role={error?"alert":"status"}
    className={"card no-print "+(error?"status-warn":"status-ok")}
    style={{marginBottom:12}}>{message}</div>:null;
}
